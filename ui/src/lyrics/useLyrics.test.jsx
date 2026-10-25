import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react-hooks'

const mocks = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('../subsonic', () => ({ default: { getLyricsBySongId: mocks.get } }))

import { useLyrics } from './useLyrics'
import { bumpLyrics, setResolving } from './lyricsSignals'

const reply = (lines) => ({
  json: {
    'subsonic-response': {
      status: 'ok',
      lyricsList: {
        structuredLyrics: lines.length
          ? [
              {
                lang: 'eng',
                synced: false,
                line: lines.map((value) => ({ value })),
              },
            ]
          : [],
      },
    },
  },
})

const flush = () => act(() => new Promise((r) => setTimeout(r, 10)))

describe('useLyrics', () => {
  beforeEach(() => mocks.get.mockReset())

  it('loads the lyrics of a track', async () => {
    mocks.get.mockResolvedValue(reply(['hello']))
    const { result } = renderHook(() => useLyrics('ul-1'))
    expect(result.current.status).toBe('loading')
    await flush()
    expect(result.current.status).toBe('ready')
    expect(result.current.lyrics.lines[0].text).toBe('hello')
  })

  it('does not fetch when disabled or without a track', async () => {
    renderHook(() => useLyrics('ul-2', false))
    renderHook(() => useLyrics(null))
    await flush()
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it('reuses what it loaded instead of fetching again', async () => {
    mocks.get.mockResolvedValue(reply(['hello']))
    const first = renderHook(() => useLyrics('ul-3'))
    await flush()
    first.unmount()
    renderHook(() => useLyrics('ul-3'))
    await flush()
    expect(mocks.get).toHaveBeenCalledTimes(1)
  })

  it('reloads when the lyrics of the track change, and keeps showing the old ones meanwhile', async () => {
    mocks.get.mockResolvedValueOnce(reply(['old']))
    const { result } = renderHook(() => useLyrics('ul-4'))
    await flush()
    expect(result.current.lyrics.lines[0].text).toBe('old')

    let release
    mocks.get.mockImplementationOnce(
      () => new Promise((r) => (release = () => r(reply(['new'])))),
    )
    act(() => bumpLyrics('ul-4'))
    expect(result.current.lyrics.lines[0].text).toBe('old')
    await act(async () => release())
    expect(result.current.lyrics.lines[0].text).toBe('new')
  })

  it('does not reload for another track', async () => {
    mocks.get.mockResolvedValue(reply(['hello']))
    renderHook(() => useLyrics('ul-5'))
    await flush()
    act(() => bumpLyrics('ul-other'))
    await flush()
    expect(mocks.get).toHaveBeenCalledTimes(1)
  })

  it('reports an error without lyrics', async () => {
    mocks.get.mockRejectedValueOnce(new Error('down'))
    const { result } = renderHook(() => useLyrics('ul-6'))
    await flush()
    expect(result.current.status).toBe('error')
    expect(result.current.lyrics).toBeNull()
  })

  it('retries after an error instead of caching it', async () => {
    mocks.get.mockRejectedValueOnce(new Error('down'))
    const first = renderHook(() => useLyrics('ul-7'))
    await flush()
    first.unmount()
    mocks.get.mockResolvedValueOnce(reply(['back']))
    const second = renderHook(() => useLyrics('ul-7'))
    await flush()
    expect(second.result.current.status).toBe('ready')
  })

  it('says it is searching only while the server looks and there are no lyrics', async () => {
    mocks.get.mockResolvedValue(reply([]))
    const { result } = renderHook(() => useLyrics('ul-8'))
    await flush()
    expect(result.current.searching).toBe(false)
    act(() => setResolving('ul-8', true))
    expect(result.current.searching).toBe(true)
    act(() => setResolving('ul-8', false))
    expect(result.current.searching).toBe(false)
  })

  it('does not claim to be searching when there are lyrics', async () => {
    mocks.get.mockResolvedValue(reply(['hello']))
    const { result } = renderHook(() => useLyrics('ul-9'))
    await flush()
    act(() => setResolving('ul-9', true))
    expect(result.current.searching).toBe(false)
    act(() => setResolving('ul-9', false))
  })

  it('never shows the lyrics of the previous track', async () => {
    mocks.get.mockImplementation((id) =>
      Promise.resolve(reply([`text of ${id}`])),
    )
    const { result, rerender } = renderHook(({ id }) => useLyrics(id), {
      initialProps: { id: 'ul-a' },
    })
    await flush()
    expect(result.current.lyrics.lines[0].text).toBe('text of ul-a')
    rerender({ id: 'ul-b' })
    expect(result.current.lyrics).toBeNull()
    await flush()
    expect(result.current.lyrics.lines[0].text).toBe('text of ul-b')
  })
})
