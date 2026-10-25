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
  status: vi.fn(),
  search: vi.fn(),
  apply: vi.fn(),
  importLyrics: vi.fn(),
  lock: vi.fn(),
  offset: vi.fn(),
  restore: vi.fn(),
  remove: vi.fn(),
}))
vi.mock('./manageApi', async () => {
  const actual = await vi.importActual('./manageApi')
  return { ...actual, lyricsApi: api }
})

import { LyricsManager } from './LyricsManager'
import { lyricsVersion } from './lyricsSignals'

// FIXTURE data: synthetic text, not lyrics of any real recording
const sidecar = {
  id: 'sidecar:.lrc',
  source: 'sidecar',
  quality: 'plain',
  file: '01 - Song.lrc',
  lines: 2,
}
const embedded = {
  id: 'embedded',
  source: 'embedded',
  quality: 'plain',
  lines: 2,
}
const managed = {
  id: 'managed',
  source: 'managed',
  quality: 'synced',
  provider: 'lrclib',
  file: '01 - Song.lyrics.json',
  lines: 3,
  confidence: 0.97,
  retrievedAt: '2026-10-24T12:00:00Z',
  attribution: 'Lyrics from LRCLIB (lrclib.net)',
}

const status = (over = {}) => ({
  current: sidecar,
  local: [sidecar],
  locked: false,
  offsetMs: 0,
  history: [],
  writable: true,
  missingRecently: false,
  ...over,
})

const candidate = (over = {}) => ({
  id: 'lrclib:1',
  provider: 'lrclib',
  source: 'remote',
  quality: 'karaoke',
  verified: true,
  match: { confidence: 0.97, durationDelta: 1 },
  meta: { title: 'Song', artist: 'Band', album: 'Album', lang: 'eng' },
  storable: true,
  lines: 2,
  wordTiming: true,
  translation: false,
  romanization: false,
  preview: [{ text: 'first fixture line' }, { text: 'second fixture line' }],
  ...over,
})

const open = async (id = 'tm-1') => {
  const onClose = vi.fn()
  render(<LyricsManager trackId={id} title="Song — Band" onClose={onClose} />)
  await screen.findByText('Showing now')
  return onClose
}

const httpError = (status, error) =>
  Object.assign(new Error('http'), {
    status,
    body: error ? { error } : undefined,
  })

describe('<LyricsManager />', () => {
  let n = 0
  beforeEach(() => {
    vi.clearAllMocks()
    n += 1
    api.status.mockResolvedValue(status())
    api.search.mockResolvedValue({
      candidates: [candidate()],
      providers: [{ id: 'lrclib', status: 'ok', count: 1 }],
    })
    api.apply.mockResolvedValue({
      action: 'created-preferred',
      undo: 'v1',
      status: status({ current: managed }),
    })
  })

  const id = () => `tm-${n}`

  describe('current lyrics', () => {
    it('says where the lyrics come from', async () => {
      await open(id())
      expect(screen.getByText('Local file: 01 - Song.lrc')).toBeInTheDocument()
      expect(screen.getByText('Plain')).toBeInTheDocument()
      expect(screen.getByText('Song — Band')).toBeInTheDocument()
    })

    it('shows the provenance of downloaded lyrics', async () => {
      api.status.mockResolvedValue(
        status({ current: managed, local: [managed] }),
      )
      await open(id())
      expect(screen.getByText('Downloaded from LRCLIB')).toBeInTheDocument()
      expect(
        screen.getByText('Lyrics from LRCLIB (lrclib.net)'),
      ).toBeInTheDocument()
      expect(screen.getByText('97%')).toBeInTheDocument()
    })

    it('says so when there are no lyrics', async () => {
      api.status.mockResolvedValue(status({ current: null, local: [] }))
      await open(id())
      expect(
        screen.getByText('There are no lyrics for this track yet.'),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Find lyrics' }),
      ).toBeInTheDocument()
    })

    it('warns when lyrics cannot be saved for this library', async () => {
      api.status.mockResolvedValue(
        status({
          writable: false,
          writeError: 'Lyrics can only be saved for libraries on a local disk.',
        }),
      )
      await open(id())
      expect(screen.getByRole('note')).toHaveTextContent('local disk')
    })

    it('reports a state that could not be loaded', async () => {
      api.status.mockRejectedValue(new Error('down'))
      render(<LyricsManager trackId={id()} onClose={() => {}} />)
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'could not be loaded',
      )
    })

    it('closes', async () => {
      const onClose = await open(id())
      fireEvent.click(screen.getByRole('button', { name: 'Close' }))
      expect(onClose).toHaveBeenCalled()
    })
  })

  describe('lock and offset', () => {
    it('locks the lyrics and shows it', async () => {
      api.lock.mockResolvedValue(status({ locked: true }))
      // the server answers consistently once the lock is on
      api.lock.mockImplementation(async () => {
        api.status.mockResolvedValue(status({ locked: true }))
        return status({ locked: true })
      })
      await open(id())
      fireEvent.click(screen.getByRole('button', { name: 'Lock these lyrics' }))
      await waitFor(() => expect(api.lock).toHaveBeenCalledWith(id(), true))
      expect(
        await screen.findByRole('button', { name: 'Locked' }),
      ).toHaveAttribute('aria-pressed', 'true')
    })

    it('unlocks locked lyrics', async () => {
      api.status.mockResolvedValue(status({ locked: true }))
      api.lock.mockResolvedValue(status({ locked: false }))
      await open(id())
      fireEvent.click(screen.getByRole('button', { name: 'Locked' }))
      await waitFor(() => expect(api.lock).toHaveBeenCalledWith(id(), false))
    })

    it('moves the timing in small steps, in both directions, and resets it', async () => {
      api.status.mockResolvedValue(status({ offsetMs: 200 }))
      // the server remembers the offset it was last given
      api.offset.mockImplementation(async (_id, ms) => {
        api.status.mockResolvedValue(status({ offsetMs: ms }))
        return status({ offsetMs: ms })
      })
      await open(id())
      expect(screen.getByText('+200 ms')).toBeInTheDocument()
      fireEvent.click(
        screen.getByRole('button', { name: 'Show lyrics sooner' }),
      )
      await waitFor(() => expect(api.offset).toHaveBeenCalledWith(id(), 300))
      expect(await screen.findByText('+300 ms')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Show lyrics later' }))
      await waitFor(() =>
        expect(api.offset).toHaveBeenLastCalledWith(id(), 200),
      )
      fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
      await waitFor(() => expect(api.offset).toHaveBeenLastCalledWith(id(), 0))
    })

    it('has nothing to lock or shift without lyrics', async () => {
      api.status.mockResolvedValue(status({ current: null, local: [] }))
      await open(id())
      expect(
        screen.getByRole('button', { name: 'Lock these lyrics' }),
      ).toBeDisabled()
      expect(
        screen.getByRole('button', { name: 'Show lyrics sooner' }),
      ).toBeDisabled()
    })
  })

  describe('finding and choosing lyrics', () => {
    const search = async () => {
      await open(id())
      fireEvent.click(
        screen.getByRole('button', { name: 'Search for better lyrics' }),
      )
      await screen.findByText('Matches the track · 97%')
    }

    it('lists candidates with provider, quality, match and what they carry', async () => {
      await search()
      expect(
        screen.getByRole('tab', { name: 'Find lyrics', selected: true }),
      ).toBeInTheDocument()
      expect(screen.getByText('Karaoke')).toBeInTheDocument()
      expect(screen.getByText('Word timing')).toBeInTheDocument()
      expect(screen.getByText(/Song · Band · Album/)).toBeInTheDocument()
      expect(screen.getByText(/length \+1 s/)).toBeInTheDocument()
      expect(screen.getByText('1 found')).toBeInTheDocument()
    })

    it('previews a candidate without choosing it', async () => {
      await search()
      fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
      expect(screen.getByText('first fixture line')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Hide preview' }))
      expect(screen.queryByText('first fixture line')).not.toBeInTheDocument()
      expect(api.apply).not.toHaveBeenCalled()
    })

    it('flags an uncertain match and a candidate that cannot be saved', async () => {
      api.search.mockResolvedValue({
        candidates: [
          candidate({
            id: 'musixmatch:x',
            provider: 'musixmatch',
            verified: false,
            storable: false,
            match: { confidence: 0.7 },
            attribution: 'Lyrics powered by Musixmatch',
          }),
        ],
        providers: [],
      })
      await open(id())
      fireEvent.click(
        screen.getByRole('button', { name: 'Search for better lyrics' }),
      )
      expect(
        await screen.findByText('Uncertain match · 70%'),
      ).toBeInTheDocument()
      expect(screen.getByText('Cannot be saved')).toBeInTheDocument()
      expect(
        screen.getByText('Lyrics powered by Musixmatch'),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Use this version' }),
      ).toBeDisabled()
    })

    it('says when a provider is not set up, slow or down, and when nothing matched', async () => {
      api.search.mockResolvedValue({
        candidates: [],
        providers: [
          { id: 'musixmatch', status: 'disabled' },
          { id: 'lrclib', status: 'rate-limited', retryAfter: 30 },
          { id: 'kugou', status: 'unavailable' },
          { id: 'netease', status: 'error' },
        ],
      })
      await open(id())
      fireEvent.click(
        screen.getByRole('button', { name: 'Search for better lyrics' }),
      )
      expect(
        await screen.findByText('No matching lyrics were found.'),
      ).toBeInTheDocument()
      expect(
        screen.getByText(/asked to slow down, retry in 30 s/),
      ).toBeInTheDocument()
      expect(screen.getByText(/not set up/)).toBeInTheDocument()
      expect(screen.getByText(/did not answer/)).toBeInTheDocument()
    })

    it('shows a search that failed', async () => {
      api.search.mockRejectedValue(httpError(500))
      await open(id())
      fireEvent.click(
        screen.getByRole('button', { name: 'Search for better lyrics' }),
      )
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'could not be changed',
      )
    })

    it('uses a version: asks first, with nothing sent that is not the candidate id', async () => {
      api.apply.mockRejectedValueOnce(httpError(409, 'confirm-required'))
      await search()
      fireEvent.click(screen.getByRole('button', { name: 'Use this version' }))
      await waitFor(() =>
        expect(api.apply).toHaveBeenCalledWith(id(), {
          candidateId: 'lrclib:1',
          confirm: false,
          force: false,
        }),
      )
      const prompt = await screen.findByRole('group', { name: 'Confirm' })
      expect(prompt).toHaveTextContent('01 - Song.lrc')
      expect(prompt).toHaveTextContent('untouched')
    })

    it('replaces after confirmation, and can undo it', async () => {
      api.apply.mockRejectedValueOnce(httpError(409, 'confirm-required'))
      api.restore.mockResolvedValue({ action: 'restored', status: status() })
      await search()
      fireEvent.click(screen.getByRole('button', { name: 'Use this version' }))
      const prompt = await screen.findByRole('group', { name: 'Confirm' })
      fireEvent.click(within(prompt).getByRole('button', { name: 'Replace' }))
      await waitFor(() =>
        expect(api.apply).toHaveBeenLastCalledWith(id(), {
          candidateId: 'lrclib:1',
          confirm: true,
          force: false,
        }),
      )
      expect(await screen.findByText('Lyrics updated.')).toBeInTheDocument()
      expect(
        screen.queryByRole('group', { name: 'Confirm' }),
      ).not.toBeInTheDocument()
      expect(lyricsVersion(id())).toBeGreaterThan(0)

      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
      await waitFor(() => expect(api.restore).toHaveBeenCalledWith(id(), 'v1'))
    })

    it('does nothing more when the confirmation is cancelled', async () => {
      api.apply.mockRejectedValueOnce(httpError(409, 'confirm-required'))
      await search()
      fireEvent.click(screen.getByRole('button', { name: 'Use this version' }))
      const prompt = await screen.findByRole('group', { name: 'Confirm' })
      fireEvent.click(within(prompt).getByRole('button', { name: 'Cancel' }))
      expect(
        screen.queryByRole('group', { name: 'Confirm' }),
      ).not.toBeInTheDocument()
      expect(api.apply).toHaveBeenCalledTimes(1)
    })

    it('offers "replace anyway" for locked lyrics and then forces it', async () => {
      api.apply.mockRejectedValueOnce(httpError(409, 'locked'))
      await search()
      fireEvent.click(screen.getByRole('button', { name: 'Use this version' }))
      const prompt = await screen.findByRole('group', { name: 'Confirm' })
      expect(prompt).toHaveTextContent('locked')
      fireEvent.click(
        within(prompt).getByRole('button', { name: 'Replace anyway' }),
      )
      await waitFor(() =>
        expect(api.apply).toHaveBeenLastCalledWith(id(), {
          candidateId: 'lrclib:1',
          confirm: true,
          force: true,
        }),
      )
    })

    it.each([
      ['not-storable', 'does not allow its lyrics to be saved'],
      ['no-candidate', 'no longer available'],
      ['read-only', 'cannot be written to'],
      ['not-managed', 'did not write'],
    ])('explains the "%s" failure', async (code, text) => {
      api.apply.mockRejectedValueOnce(httpError(422, code))
      await search()
      fireEvent.click(screen.getByRole('button', { name: 'Use this version' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(text)
    })

    it('tells a non-administrator that only administrators can change lyrics', async () => {
      api.apply.mockRejectedValueOnce(httpError(403))
      await search()
      fireEvent.click(screen.getByRole('button', { name: 'Use this version' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Only an administrator',
      )
    })
  })

  describe('versions on the server', () => {
    it('lets the user choose an embedded alternative, noting the audio is not changed', async () => {
      api.status.mockResolvedValue(status({ local: [sidecar, embedded] }))
      api.apply.mockRejectedValueOnce(httpError(409, 'confirm-required'))
      await open(id())
      expect(screen.getByText('Embedded in the audio file')).toBeInTheDocument()
      expect(
        screen.getByText(/stay in the audio file as they are/),
      ).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Use this version' }))
      await waitFor(() =>
        expect(api.apply).toHaveBeenCalledWith(id(), {
          candidateId: 'embedded',
          confirm: false,
          force: false,
        }),
      )
    })

    it('does not offer to use the version that is already in use', async () => {
      api.status.mockResolvedValue(status({ local: [sidecar, embedded] }))
      await open(id())
      expect(screen.getByText(/in use/)).toBeInTheDocument()
      expect(
        screen.getAllByRole('button', { name: 'Use this version' }),
      ).toHaveLength(1)
    })
  })

  describe('history and deleting', () => {
    const history = [
      {
        id: 'h2',
        at: '2026-10-24T12:00:00Z',
        existed: true,
        provider: 'lrclib',
        quality: 'synced',
        origin: 'managed',
      },
      { id: 'h1', at: '2026-10-23T12:00:00Z', existed: false },
    ]

    it('restores a previous version', async () => {
      api.status.mockResolvedValue(status({ history }))
      api.restore.mockResolvedValue({
        action: 'restored',
        status: status({ history }),
      })
      await open(id())
      const restores = screen.getAllByRole('button', { name: 'Restore' })
      expect(restores).toHaveLength(2)
      expect(
        screen.getByText('Before any lyrics were saved'),
      ).toBeInTheDocument()
      fireEvent.click(restores[0])
      await waitFor(() => expect(api.restore).toHaveBeenCalledWith(id(), 'h2'))
      expect(await screen.findByText('Restored.')).toBeInTheDocument()
    })

    it('names a history entry after where its lyrics came from', async () => {
      api.status.mockResolvedValue(
        status({
          history: [
            {
              id: 'a',
              at: '2026-10-24T12:00:00Z',
              existed: true,
              provider: 'import',
              quality: 'synced',
            },
            {
              id: 'b',
              at: '2026-10-23T12:00:00Z',
              existed: true,
              provider: 'embedded',
              quality: 'plain',
            },
            {
              id: 'c',
              at: '2026-10-22T12:00:00Z',
              existed: true,
              provider: 'lrclib',
              quality: 'karaoke',
            },
          ],
        }),
      )
      await open(id())
      expect(screen.getByText(/Imported file · Synced/)).toBeInTheDocument()
      expect(screen.getByText(/Embedded lyrics · Plain/)).toBeInTheDocument()
      expect(screen.getByText(/LRCLIB · Karaoke/)).toBeInTheDocument()
    })

    it('says there is nothing to restore yet', async () => {
      await open(id())
      expect(screen.getByText('Nothing to restore yet.')).toBeInTheDocument()
    })

    it('deletes saved lyrics, only offered for lyrics Navidrome stored', async () => {
      api.status.mockResolvedValue(
        status({ current: managed, local: [managed] }),
      )
      api.remove.mockResolvedValue({
        action: 'deleted',
        undo: 'h9',
        status: status(),
      })
      await open(id())
      fireEvent.click(
        screen.getByRole('button', { name: 'Delete saved lyrics' }),
      )
      await waitFor(() => expect(api.remove).toHaveBeenCalledWith(id()))
      expect(
        await screen.findByText('Saved lyrics deleted.'),
      ).toBeInTheDocument()
    })

    it('does not offer to delete a sidecar or embedded lyrics', async () => {
      await open(id())
      expect(
        screen.queryByRole('button', { name: 'Delete saved lyrics' }),
      ).not.toBeInTheDocument()
    })

    it('reports that there was nothing to delete', async () => {
      api.status.mockResolvedValue(
        status({ current: managed, local: [managed] }),
      )
      api.remove.mockRejectedValue(httpError(404, 'not-found'))
      await open(id())
      fireEvent.click(
        screen.getByRole('button', { name: 'Delete saved lyrics' }),
      )
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'nothing to restore or delete',
      )
    })
  })

  describe('importing a file', () => {
    const pick = (file) =>
      fireEvent.change(screen.getByTestId('lyrics-import'), {
        target: { files: [file] },
      })

    it('imports the text of the chosen file', async () => {
      api.importLyrics.mockResolvedValue({
        action: 'created-preferred',
        status: status({
          current: { ...sidecar, source: 'user', provider: 'import' },
        }),
      })
      await open(id())
      pick(
        new File(['[00:01.00]fixture line'], 'mine.lrc', {
          type: 'text/plain',
        }),
      )
      await waitFor(() =>
        expect(api.importLyrics).toHaveBeenCalledWith(id(), {
          fileName: 'mine.lrc',
          content: '[00:01.00]fixture line',
          confirm: false,
          force: false,
        }),
      )
      expect(await screen.findByText('Lyrics updated.')).toBeInTheDocument()
    })

    it('asks before importing over a sidecar, then confirms with the same content', async () => {
      api.importLyrics
        .mockRejectedValueOnce(httpError(409, 'confirm-required'))
        .mockResolvedValue({ action: 'created-preferred', status: status() })
      await open(id())
      pick(new File(['[00:01.00]x'], 'mine.lrc'))
      const prompt = await screen.findByRole('group', { name: 'Confirm' })
      fireEvent.click(within(prompt).getByRole('button', { name: 'Replace' }))
      await waitFor(() =>
        expect(api.importLyrics).toHaveBeenLastCalledWith(id(), {
          fileName: 'mine.lrc',
          content: '[00:01.00]x',
          confirm: true,
          force: false,
        }),
      )
    })

    it('refuses a file that is too large without sending it', async () => {
      await open(id())
      pick(new File([new Uint8Array(3 * 1024 * 1024)], 'huge.lrc'))
      expect(await screen.findByRole('alert')).toHaveTextContent('too large')
      expect(api.importLyrics).not.toHaveBeenCalled()
    })

    it('accepts only lyrics file types', async () => {
      await open(id())
      const accept = screen.getByTestId('lyrics-import').getAttribute('accept')
      for (const ext of [
        '.lrc',
        '.elrc',
        '.ttml',
        '.srt',
        '.txt',
        '.yaml',
        '.json',
      ])
        expect(accept).toContain(ext)
    })
  })

  it("forgets one track's search and prompts when the track changes", async () => {
    api.apply.mockRejectedValueOnce(httpError(409, 'confirm-required'))
    const { rerender } = render(
      <LyricsManager trackId={id()} onClose={() => {}} />,
    )
    await screen.findByText('Showing now')
    fireEvent.click(
      screen.getByRole('button', { name: 'Search for better lyrics' }),
    )
    await screen.findByText('Matches the track · 97%')
    fireEvent.click(screen.getByRole('button', { name: 'Use this version' }))
    await screen.findByRole('group', { name: 'Confirm' })

    rerender(<LyricsManager trackId="other-track" onClose={() => {}} />)
    await waitFor(() =>
      expect(
        screen.queryByRole('group', { name: 'Confirm' }),
      ).not.toBeInTheDocument(),
    )
    expect(
      screen.queryByText('Matches the track · 97%'),
    ).not.toBeInTheDocument()
  })
})
