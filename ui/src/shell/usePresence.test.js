import { renderHook, act } from '@testing-library/react-hooks'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { usePresence } from './usePresence'

const setReducedMotion = (matches) => {
  window.matchMedia = vi.fn().mockReturnValue({ matches })
}

describe('usePresence', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setReducedMotion(false)
  })
  afterEach(() => vi.useRealTimers())

  it('is mounted and not closing while open', () => {
    const { result } = renderHook(() => usePresence(true, 240))
    expect(result.current).toEqual({ mounted: true, closing: false })
  })

  it('stays mounted, closing, until the exit time has passed', () => {
    const { result, rerender } = renderHook(
      ({ open }) => usePresence(open, 240),
      {
        initialProps: { open: true },
      },
    )
    rerender({ open: false })
    expect(result.current).toEqual({ mounted: true, closing: true })
    act(() => {
      vi.advanceTimersByTime(239)
    })
    expect(result.current.mounted).toBe(true)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toEqual({ mounted: false, closing: false })
  })

  it('cancels the exit when it reopens in time', () => {
    const { result, rerender } = renderHook(
      ({ open }) => usePresence(open, 240),
      {
        initialProps: { open: true },
      },
    )
    rerender({ open: false })
    act(() => {
      vi.advanceTimersByTime(100)
    })
    rerender({ open: true })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(result.current).toEqual({ mounted: true, closing: false })
  })

  it('unmounts at once with reduced motion', () => {
    setReducedMotion(true)
    const { result, rerender } = renderHook(
      ({ open }) => usePresence(open, 240),
      {
        initialProps: { open: true },
      },
    )
    rerender({ open: false })
    expect(result.current).toEqual({ mounted: false, closing: false })
  })
})
