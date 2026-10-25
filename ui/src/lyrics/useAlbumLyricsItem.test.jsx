import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react-hooks'

const mocks = vi.hoisted(() => ({ notify: vi.fn(), startBulk: vi.fn() }))
vi.mock('react-admin', () => ({
  useTranslate: () => (key, opts) =>
    String(opts?._ ?? key).replace(/%\{(\w+)\}/g, (_, k) => opts?.[k] ?? ''),
  useNotify: () => mocks.notify,
}))
vi.mock('./manageApi', async () => ({
  ...(await vi.importActual('./manageApi')),
  lyricsApi: { startBulk: mocks.startBulk },
}))

import { useAlbumLyricsItem } from './useAlbumLyricsItem'

describe('useAlbumLyricsItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.startBulk.mockResolvedValue({ total: 12 })
  })
  afterEach(() => localStorage.removeItem('role'))

  it('is not offered to anyone but administrators', () => {
    const { result } = renderHook(() => useAlbumLyricsItem('al-1'))
    expect(result.current).toBe(false)
  })

  it('starts a job for just that album and says so', async () => {
    localStorage.setItem('role', 'admin')
    const { result } = renderHook(() => useAlbumLyricsItem('al-1'))
    expect(result.current.label).toBe('Find lyrics for this album')
    await act(() => result.current.onSelect())
    expect(mocks.startBulk).toHaveBeenCalledWith({
      action: 'missing',
      albumIds: ['al-1'],
    })
    expect(mocks.notify).toHaveBeenCalledWith(
      'Looking for lyrics for 12 tracks in the background.',
      'info',
    )
  })

  it('warns when another job is running', async () => {
    localStorage.setItem('role', 'admin')
    mocks.startBulk.mockRejectedValue(
      Object.assign(new Error('x'), { status: 409, body: { error: 'busy' } }),
    )
    const { result } = renderHook(() => useAlbumLyricsItem('al-1'))
    await act(() => result.current.onSelect())
    expect(mocks.notify).toHaveBeenCalledWith(
      'Another bulk job is already running.',
      'warning',
    )
  })

  it('warns when the job cannot be started', async () => {
    localStorage.setItem('role', 'admin')
    mocks.startBulk.mockRejectedValue(new Error('down'))
    const { result } = renderHook(() => useAlbumLyricsItem('al-1'))
    await act(() => result.current.onSelect())
    expect(mocks.notify).toHaveBeenCalledWith(
      'The job could not be started.',
      'warning',
    )
  })
})
