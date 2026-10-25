import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('react-admin', () => ({
  useTranslate: () => (key, opts) =>
    String(opts?._ ?? key).replace(/%\{(\w+)\}/g, (_, k) => opts?.[k] ?? ''),
}))
const api = vi.hoisted(() => ({
  settings: vi.fn(),
  saveSettings: vi.fn(),
  startBulk: vi.fn(),
  bulk: vi.fn(),
  cancelBulk: vi.fn(),
}))
vi.mock('../lyrics/manageApi', async () => ({
  ...(await vi.importActual('../lyrics/manageApi')),
  lyricsApi: api,
}))

import { LyricsSettings } from './LyricsSettings'

const settings = {
  preferLocal: true,
  autoRetrieve: true,
  autoUpgrade: true,
  autoReplaceManual: false,
  providers: ['lrclib'],
  minConfidence: 0.85,
}
const providers = [
  {
    id: 'lrclib',
    name: 'LRCLIB',
    status: 'ready',
    enabled: true,
    verified: true,
    storable: true,
    wordSync: true,
    note: 'Free community service.',
  },
  {
    id: 'musixmatch',
    name: 'Musixmatch',
    status: 'needs-credentials',
    enabled: false,
    verified: false,
    storable: false,
    reason: 'Set Lyrics.Musixmatch.ApiKey in the configuration',
    note: 'Results are not saved.',
  },
  {
    id: 'kugou',
    name: 'KuGou Music',
    status: 'unavailable',
    enabled: false,
    verified: false,
    reason: 'KuGou has no public developer API for lyrics.',
  },
  {
    id: 'apple',
    name: 'Apple Music',
    status: 'unavailable',
    enabled: false,
    verified: false,
    reason: 'The Apple Music API documents only the hasLyrics flag.',
  },
]
const job = (over = {}) => ({
  id: 'bulk-1',
  action: 'missing',
  state: 'running',
  total: 10,
  done: 4,
  found: 3,
  upgraded: 0,
  kept: 0,
  missing: 1,
  failed: 0,
  ...over,
})
const httpError = (error) =>
  Object.assign(new Error('http'), { status: 409, body: { error } })

describe('<LyricsSettings />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.settings.mockResolvedValue({ settings, providers })
    api.saveSettings.mockImplementation(async (s) => ({
      settings: s,
      providers,
    }))
  })

  const load = async () => {
    render(<LyricsSettings />)
    await screen.findByText('Prefer local files')
  }
  const toggle = (name) => screen.getByRole('checkbox', { name })

  it('shows the recommended defaults', async () => {
    await load()
    expect(toggle('Prefer local files')).toBeChecked()
    expect(toggle('Find missing lyrics automatically')).toBeChecked()
    expect(toggle('Upgrade downloaded lyrics automatically')).toBeChecked()
    expect(toggle('Also upgrade lyrics I added myself')).not.toBeChecked()
  })

  it('saves a changed setting, keeping the rest', async () => {
    await load()
    fireEvent.click(toggle('Also upgrade lyrics I added myself'))
    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith({
        ...settings,
        autoReplaceManual: true,
      }),
    )
    await waitFor(() =>
      expect(toggle('Also upgrade lyrics I added myself')).toBeChecked(),
    )
  })

  it('reverts and says so when saving fails', async () => {
    api.saveSettings.mockRejectedValue(new Error('down'))
    await load()
    fireEvent.click(toggle('Prefer local files'))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'could not be saved',
    )
    expect(toggle('Prefer local files')).toBeChecked()
  })

  it('says when the settings cannot be loaded', async () => {
    api.settings.mockRejectedValue(new Error('down'))
    render(<LyricsSettings />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'could not be loaded',
    )
  })

  describe('providers', () => {
    it("tells each provider's real status, and never claims what is not verified", async () => {
      await load()
      expect(
        screen.getByText(/Ready · checked against the live service/),
      ).toBeInTheDocument()
      expect(
        screen.getByText('Set Lyrics.Musixmatch.ApiKey in the configuration'),
      ).toBeInTheDocument()
      expect(
        screen.getByText('KuGou has no public developer API for lyrics.'),
      ).toBeInTheDocument()
      expect(
        screen.getByText(/documents only the hasLyrics flag/),
      ).toBeInTheDocument()
      expect(screen.getByText('Results are not saved.')).toBeInTheDocument()
    })

    it('switches a ready provider off and on', async () => {
      await load()
      fireEvent.click(toggle('LRCLIB'))
      await waitFor(() =>
        expect(api.saveSettings).toHaveBeenCalledWith({
          ...settings,
          providers: [],
        }),
      )
    })

    it('cannot turn on a provider that is not usable', async () => {
      await load()
      for (const name of ['Musixmatch', 'KuGou Music', 'Apple Music'])
        expect(toggle(name)).toBeDisabled()
    })

    it('says an unverified provider is unverified, and that its lyrics are not saved', async () => {
      api.settings.mockResolvedValue({
        settings,
        providers: [
          {
            id: 'musixmatch',
            name: 'Musixmatch',
            status: 'ready',
            enabled: true,
            verified: false,
            storable: false,
          },
        ],
      })
      await load()
      expect(
        screen.getByText(/not checked against the live service/),
      ).toBeInTheDocument()
      expect(
        screen.getByText(/lyrics are shown but not saved/),
      ).toBeInTheDocument()
    })
  })

  describe('whole-library jobs', () => {
    it.each([
      ['Download missing lyrics', 'missing'],
      ['Look for better lyrics', 'upgrade'],
      ['Re-check everything', 'recheck'],
    ])(
      'starts "%s" for the whole library without confirming anything',
      async (label, action) => {
        api.startBulk.mockResolvedValue(job({ action }))
        api.bulk.mockResolvedValue(job({ action, state: 'done', done: 10 }))
        await load()
        fireEvent.click(screen.getByRole('button', { name: label }))
        await waitFor(() =>
          expect(api.startBulk).toHaveBeenCalledWith({
            action,
            all: true,
            confirm: false,
          }),
        )
      },
    )

    it('shows progress, then the result', async () => {
      api.startBulk.mockResolvedValue(job())
      api.bulk.mockResolvedValue(
        job({ state: 'done', done: 10, found: 8, missing: 2 }),
      )
      await load()
      fireEvent.click(
        screen.getByRole('button', { name: 'Download missing lyrics' }),
      )
      expect(
        await screen.findByText(/4 of 10 tracks \(40%\) · 3 found/),
      ).toBeInTheDocument()
      expect(
        await screen.findByText(
          /10 of 10 tracks \(100%\) · 8 found/,
          {},
          { timeout: 4000 },
        ),
      ).toBeInTheDocument()
      expect(screen.getByText('Finished.')).toBeInTheDocument()
    })

    it('can be cancelled, and explains it can be continued', async () => {
      api.startBulk.mockResolvedValue(job())
      api.cancelBulk.mockResolvedValue()
      api.bulk.mockResolvedValue(job({ state: 'cancelled' }))
      await load()
      fireEvent.click(
        screen.getByRole('button', { name: 'Download missing lyrics' }),
      )
      fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
      await waitFor(() => expect(api.cancelBulk).toHaveBeenCalledWith('bulk-1'))
      expect(
        await screen.findByText(/Run it again to continue/),
      ).toBeInTheDocument()
    })

    it('disables the other jobs while one runs', async () => {
      api.startBulk.mockResolvedValue(job())
      await load()
      fireEvent.click(
        screen.getByRole('button', { name: 'Download missing lyrics' }),
      )
      await screen.findByText(/4 of 10 tracks/)
      expect(
        screen.getByRole('button', { name: 'Look for better lyrics' }),
      ).toBeDisabled()
    })

    it('reports that another job is already running', async () => {
      api.startBulk.mockRejectedValue(httpError('busy'))
      await load()
      fireEvent.click(
        screen.getByRole('button', { name: 'Download missing lyrics' }),
      )
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'already running',
      )
    })

    it('tells a message the server attached, such as a rate limit', async () => {
      api.startBulk.mockResolvedValue(job())
      api.bulk.mockResolvedValue(
        job({ state: 'done', message: 'A provider asked to slow down.' }),
      )
      await load()
      fireEvent.click(
        screen.getByRole('button', { name: 'Download missing lyrics' }),
      )
      expect(
        await screen.findByText(
          'A provider asked to slow down.',
          {},
          { timeout: 4000 },
        ),
      ).toBeInTheDocument()
    })

    it('keeps the job that replaces lyrics added by hand off until it is confirmed', async () => {
      api.startBulk.mockResolvedValue(job({ action: 'replace-manual' }))
      await load()
      const replace = screen.getByRole('button', {
        name: 'Upgrade lyrics I added myself',
      })
      expect(replace).toBeDisabled()
      fireEvent.click(screen.getByRole('checkbox', { name: 'I understand' }))
      expect(replace).toBeEnabled()
      fireEvent.click(replace)
      await waitFor(() =>
        expect(api.startBulk).toHaveBeenCalledWith({
          action: 'replace-manual',
          all: true,
          confirm: true,
        }),
      )
    })
  })
})
