import React from 'react'
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react'
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
  checkProviders: vi.fn(),
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
  store: [],
  minConfidence: 0.85,
}
const providers = [
  {
    id: 'lrclib',
    name: 'LRCLIB',
    status: 'ready',
    enabled: true,
    verified: true,
    implemented: true,
    configured: true,
    auth: 'none',
    availability: 'available',
    liveVerified: true,
    karaokeVerified: true,
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
    implemented: true,
    configured: false,
    auth: 'api-key',
    availability: 'needs-credentials',
    modes: [
      { id: 'official', name: 'Official API (your own key)', active: false },
      {
        id: 'keyless',
        name: 'Without a key',
        active: false,
        note: 'No authorized keyless route exists',
      },
    ],
    storable: false,
    reason: 'Set Lyrics.Musixmatch.ApiKey in the configuration',
    note: 'Results are not saved.',
  },
  {
    id: 'kugou',
    name: 'KuGou Music',
    status: 'ready',
    enabled: true,
    verified: true,
    implemented: true,
    configured: true,
    auth: 'none',
    availability: 'temporarily-unavailable',
    liveVerified: true,
    karaokeVerified: false,
    wordSync: true,
    storable: false,
    storeOptIn: true,
    storeAllowed: false,
    formats: ['krc', 'lrc'],
    lastError: 'KuGou answered 503',
    lastFailure: '2026-10-25T12:00:00Z',
  },
  {
    id: 'apple',
    name: 'Apple Music',
    status: 'unavailable',
    enabled: false,
    verified: false,
    implemented: false,
    configured: false,
    auth: 'none',
    availability: 'not-available',
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
    const card = (name) => within(screen.getByTestId(`provider-${name}`))

    it('keeps implemented, set up, seen working and karaoke seen apart', async () => {
      await load()
      const lrclib = card('lrclib')
      expect(lrclib.getByText('Available')).toBeInTheDocument()
      expect(lrclib.getByText('Implemented')).toBeInTheDocument()
      expect(lrclib.getByText('Seen working')).toBeInTheDocument()
      expect(lrclib.getByText('Karaoke seen')).toBeInTheDocument()
      expect(lrclib.getByText('Lyrics can be saved')).toBeInTheDocument()

      // KuGou has the adapter and word timing, but no karaoke was seen yet
      const kugou = card('kugou')
      expect(kugou.getByText('Implemented')).toBeInTheDocument()
      expect(kugou.getByText('Karaoke not seen yet')).toBeInTheDocument()
      expect(kugou.getByText('Preview only')).toBeInTheDocument()
      expect(kugou.getByText(/Reads: krc, lrc/)).toBeInTheDocument()
    })

    it('tells an outage from a missing implementation', async () => {
      await load()
      const kugou = card('kugou')
      expect(kugou.getByText('Temporarily unavailable')).toBeInTheDocument()
      expect(
        kugou.getByText(/Last error: KuGou answered 503/),
      ).toBeInTheDocument()
      expect(kugou.queryByText('Not implemented')).toBeNull()
      expect(kugou.queryByText(/not supported/i)).toBeNull()

      const apple = card('apple')
      expect(apple.getByText('Not available')).toBeInTheDocument()
      expect(apple.getByText('Not implemented')).toBeInTheDocument()
      expect(
        apple.getByText(/documents only the hasLyrics flag/),
      ).toBeInTheDocument()
    })

    it('separates the official key mode from the keyless one', async () => {
      await load()
      const mm = card('musixmatch')
      expect(mm.getByText('Needs your API key')).toBeInTheDocument()
      expect(mm.getByText('Needs your own API key')).toBeInTheDocument()
      expect(mm.getByText('Official API (your own key)')).toBeInTheDocument()
      expect(mm.getByText('Without a key')).toBeInTheDocument()
      expect(
        mm.getByText(/No authorized keyless route exists/),
      ).toBeInTheDocument()
      expect(
        mm.getByText('Set Lyrics.Musixmatch.ApiKey in the configuration'),
      ).toBeInTheDocument()
      expect(mm.getByText('Results are not saved.')).toBeInTheDocument()
    })

    it('refreshes the status on request', async () => {
      api.checkProviders.mockResolvedValue({
        providers: providers.map((p) =>
          p.id === 'kugou'
            ? { ...p, availability: 'available', lastError: undefined }
            : p,
        ),
      })
      await load()
      fireEvent.click(screen.getByRole('button', { name: 'Check providers' }))
      await waitFor(() => expect(api.checkProviders).toHaveBeenCalledTimes(1))
      await waitFor(() =>
        expect(card('kugou').getByText('Available')).toBeInTheDocument(),
      )
      expect(card('kugou').queryByText(/Last error/)).toBeNull()
    })

    it('reports a failed check', async () => {
      api.checkProviders.mockRejectedValue(new Error('x'))
      await load()
      fireEvent.click(screen.getByRole('button', { name: 'Check providers' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'could not be checked',
      )
    })

    it('lets the administrator allow saving for a provider that grants no permission itself', async () => {
      await load()
      const kugou = card('kugou')
      expect(kugou.getByText('Preview only')).toBeInTheDocument()
      fireEvent.click(
        kugou.getByRole('checkbox', {
          name: 'Save lyrics from KuGou Music next to my audio',
        }),
      )
      await waitFor(() =>
        expect(api.saveSettings).toHaveBeenCalledWith({
          ...settings,
          store: ['kugou'],
        }),
      )
    })

    it('takes the permission back, and offers none for a provider that may already save', async () => {
      api.settings.mockResolvedValue({
        settings: { ...settings, store: ['kugou'] },
        providers: providers.map((p) =>
          p.id === 'kugou' ? { ...p, storeAllowed: true, storable: true } : p,
        ),
      })
      await load()
      expect(card('kugou').getByText('Lyrics can be saved')).toBeInTheDocument()
      fireEvent.click(
        card('kugou').getByRole('checkbox', {
          name: 'Save lyrics from KuGou Music next to my audio',
        }),
      )
      await waitFor(() =>
        expect(api.saveSettings).toHaveBeenCalledWith({
          ...settings,
          store: [],
        }),
      )
      expect(
        within(screen.getByTestId('provider-lrclib')).queryByRole('checkbox', {
          name: /Save lyrics from/,
        }),
      ).toBeNull()
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
      for (const name of ['Musixmatch', 'Apple Music'])
        expect(toggle(name)).toBeDisabled()
    })

    it('does not claim a provider works before it has been seen working', async () => {
      api.settings.mockResolvedValue({
        settings,
        providers: [
          {
            id: 'qq',
            name: 'QQ Music',
            status: 'ready',
            enabled: true,
            implemented: true,
            configured: true,
            auth: 'optional-key',
            availability: 'available',
            liveVerified: false,
            karaokeVerified: false,
            wordSync: true,
            storable: false,
          },
        ],
      })
      await load()
      const qq = card('qq')
      expect(qq.getByText('Not seen working yet')).toBeInTheDocument()
      expect(qq.getByText('Karaoke not seen yet')).toBeInTheDocument()
      expect(
        qq.getByText('Works without a key; a key adds more', { exact: false }),
      ).toBeInTheDocument()
      expect(qq.getByText('Preview only')).toBeInTheDocument()
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
