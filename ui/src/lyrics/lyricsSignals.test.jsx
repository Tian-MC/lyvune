import { describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react-hooks'
import {
  bumpLyrics,
  isResolving,
  lyricsVersion,
  setResolving,
  subscribeLyrics,
  useLyricsSignals,
} from './lyricsSignals'

describe('lyrics signals', () => {
  it('counts versions per track', () => {
    const before = lyricsVersion('sig-a')
    bumpLyrics('sig-a')
    bumpLyrics('sig-a')
    expect(lyricsVersion('sig-a')).toBe(before + 2)
    expect(lyricsVersion('sig-never')).toBe(0)
  })

  it('notifies subscribers, and stops after they unsubscribe', () => {
    const listener = vi.fn()
    const off = subscribeLyrics(listener)
    bumpLyrics('sig-b')
    expect(listener).toHaveBeenCalledTimes(1)
    off()
    bumpLyrics('sig-b')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('tracks which tracks are being searched, without repeating notifications', () => {
    const listener = vi.fn()
    const off = subscribeLyrics(listener)
    setResolving('sig-c', true)
    setResolving('sig-c', true)
    expect(isResolving('sig-c')).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
    setResolving('sig-c', false)
    expect(isResolving('sig-c')).toBe(false)
    off()
  })

  it('updates a hook when its track changes, and ignores other tracks', () => {
    const { result } = renderHook(() => useLyricsSignals('sig-d'))
    const first = result.current
    act(() => bumpLyrics('sig-other'))
    expect(result.current).toBe(first)
    act(() => bumpLyrics('sig-d'))
    expect(result.current.version).toBe(first.version + 1)
    act(() => setResolving('sig-d', true))
    expect(result.current.resolving).toBe(true)
    act(() => setResolving('sig-d', false))
  })

  it('follows the track it is given', () => {
    act(() => setResolving('sig-e', true))
    const { result, rerender } = renderHook(({ id }) => useLyricsSignals(id), {
      initialProps: { id: 'sig-f' },
    })
    expect(result.current.resolving).toBe(false)
    rerender({ id: 'sig-e' })
    expect(result.current.resolving).toBe(true)
    act(() => setResolving('sig-e', false))
  })
})
