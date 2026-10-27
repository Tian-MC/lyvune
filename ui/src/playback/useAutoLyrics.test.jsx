import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react-hooks'

const mocks = vi.hoisted(() => ({ item: null, resolve: vi.fn() }))
vi.mock('./hooks', () => ({ useCurrentItem: () => mocks.item }))
vi.mock('../lyrics/manageApi', () => ({
  lyricsApi: { resolve: mocks.resolve },
}))

import { useAutoLyrics } from './useAutoLyrics'
import { isResolving, lyricsVersion } from '../lyrics/lyricsSignals'

const track = (trackId, extra = {}) => ({
  trackId,
  uuid: `u-${trackId}`,
  ...extra,
})
const flush = () => new Promise((r) => vi.advanceTimersByTimeAsync(0).then(r))

describe('useAutoLyrics', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.resolve.mockReset()
    mocks.resolve.mockResolvedValue({ result: 'have-lyrics' })
    mocks.item = null
    localStorage.setItem('role', 'admin')
  })
  afterEach(() => {
    vi.useRealTimers()
    localStorage.removeItem('role')
  })

  it('never asks the server to fetch lyrics for anyone but an administrator', async () => {
    localStorage.setItem('role', 'regular')
    mocks.item = track('al-user')
    renderHook(() => useAutoLyrics())
    await vi.advanceTimersByTimeAsync(5000)
    expect(mocks.resolve).not.toHaveBeenCalled()
    expect(isResolving('al-user')).toBe(false)

    localStorage.removeItem('role')
    mocks.item = track('al-nobody')
    renderHook(() => useAutoLyrics())
    await vi.advanceTimersByTimeAsync(5000)
    expect(mocks.resolve).not.toHaveBeenCalled()
  })

  it('does nothing without a track, and never for a radio stream', async () => {
    renderHook(() => useAutoLyrics())
    mocks.item = track('r1', { isRadio: true })
    renderHook(() => useAutoLyrics())
    await vi.advanceTimersByTimeAsync(5000)
    expect(mocks.resolve).not.toHaveBeenCalled()
  })

  it('asks the server once a track has been playing a moment', async () => {
    mocks.item = track('al-1')
    renderHook(() => useAutoLyrics())
    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.resolve).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(600)
    expect(mocks.resolve).toHaveBeenCalledTimes(1)
    expect(mocks.resolve.mock.calls[0][0]).toBe('al-1')
    expect(mocks.resolve.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it('does not search for tracks skipped within the first moment', async () => {
    mocks.item = track('al-2')
    const { rerender } = renderHook(() => useAutoLyrics())
    await vi.advanceTimersByTimeAsync(800)
    mocks.item = track('al-3')
    rerender()
    await vi.advanceTimersByTimeAsync(1600)
    expect(mocks.resolve).toHaveBeenCalledTimes(1)
    expect(mocks.resolve.mock.calls[0][0]).toBe('al-3')
  })

  it('does not ask twice about the same track in a session', async () => {
    mocks.item = track('al-4')
    const first = renderHook(() => useAutoLyrics())
    await vi.advanceTimersByTimeAsync(2000)
    first.unmount()
    renderHook(() => useAutoLyrics())
    await vi.advanceTimersByTimeAsync(2000)
    expect(mocks.resolve).toHaveBeenCalledTimes(1)
  })

  it('marks the track as being searched meanwhile, and refreshes its lyrics when some are found', async () => {
    let finish
    mocks.resolve.mockImplementation(
      () => new Promise((r) => (finish = () => r({ result: 'found' }))),
    )
    mocks.item = track('al-5')
    renderHook(() => useAutoLyrics())
    await vi.advanceTimersByTimeAsync(1600)
    expect(isResolving('al-5')).toBe(true)
    const before = lyricsVersion('al-5')
    finish()
    await flush()
    expect(isResolving('al-5')).toBe(false)
    expect(lyricsVersion('al-5')).toBe(before + 1)
  })

  it('also refreshes after an upgrade, but not when nothing changed', async () => {
    mocks.resolve
      .mockResolvedValueOnce({ result: 'upgraded' })
      .mockResolvedValueOnce({ result: 'not-found' })
    mocks.item = track('al-6')
    renderHook(() => useAutoLyrics())
    await vi.advanceTimersByTimeAsync(1600)
    await flush()
    expect(lyricsVersion('al-6')).toBe(1)

    mocks.item = track('al-7')
    renderHook(() => useAutoLyrics())
    await vi.advanceTimersByTimeAsync(1600)
    await flush()
    expect(lyricsVersion('al-7')).toBe(0)
  })

  it('stays silent when the server cannot be reached', async () => {
    mocks.resolve.mockRejectedValue(new Error('offline'))
    mocks.item = track('al-8')
    renderHook(() => useAutoLyrics())
    await vi.advanceTimersByTimeAsync(1600)
    await flush()
    expect(isResolving('al-8')).toBe(false)
    expect(lyricsVersion('al-8')).toBe(0)
  })

  it('leaving a track mid-search cancels the request and lets the track be asked about again', async () => {
    let signal
    mocks.resolve.mockImplementation((_id, opts) => {
      signal = opts.signal
      return new Promise(() => {})
    })
    mocks.item = track('al-9')
    const first = renderHook(() => useAutoLyrics())
    await vi.advanceTimersByTimeAsync(1600)
    const before = lyricsVersion('al-9')
    first.unmount()
    expect(signal.aborted).toBe(true)
    expect(isResolving('al-9')).toBe(false)
    expect(lyricsVersion('al-9')).toBe(before + 1)

    mocks.resolve.mockResolvedValue({ result: 'have-lyrics' })
    renderHook(() => useAutoLyrics())
    await vi.advanceTimersByTimeAsync(1600)
    expect(mocks.resolve).toHaveBeenCalledTimes(2)
  })
  describe('after a provider did not answer', () => {
    // Plays the track and lets the request run; returns how often the server was asked
    const play = async (id) => {
      mocks.item = track(id)
      const h = renderHook(() => useAutoLyrics())
      await vi.advanceTimersByTimeAsync(1600)
      h.unmount()
      mocks.item = null
      return mocks.resolve.mock.calls.filter((c) => c[0] === id).length
    }

    it('asks again on a later play, not straight away', async () => {
      mocks.resolve.mockResolvedValueOnce({ result: 'unavailable' })
      expect(await play('al-t1')).toBe(1)
      await vi.advanceTimersByTimeAsync(30 * 1000)
      expect(await play('al-t1')).toBe(1)
      await vi.advanceTimersByTimeAsync(30 * 1000)
      expect(await play('al-t1')).toBe(2)
      // it answered this time: the track is not asked about again this session
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
      expect(await play('al-t1')).toBe(2)
    })

    it('waits as long as a provider that asked to slow down wants', async () => {
      mocks.resolve.mockResolvedValueOnce({
        result: 'unavailable',
        retryAfter: 120,
        message: 'A provider asked to slow down',
      })
      expect(await play('al-t2')).toBe(1)
      await vi.advanceTimersByTimeAsync(90 * 1000)
      expect(await play('al-t2')).toBe(1)
      await vi.advanceTimersByTimeAsync(40 * 1000)
      expect(await play('al-t2')).toBe(2)
    })

    it('does not ask again for what asking cannot change', async () => {
      mocks.resolve.mockResolvedValueOnce({
        result: 'unavailable',
        message: 'No lyrics provider is enabled',
      })
      expect(await play('al-t3')).toBe(1)
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
      expect(await play('al-t3')).toBe(1)
    })

    it('asks again later when the server could not be reached', async () => {
      mocks.resolve.mockRejectedValueOnce(new Error('offline'))
      expect(await play('al-t4')).toBe(1)
      await vi.advanceTimersByTimeAsync(61 * 1000)
      expect(await play('al-t4')).toBe(2)
    })
  })
})
