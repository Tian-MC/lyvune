import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react-hooks'
import subsonic from '../../subsonic'
import { useArtistInfo } from './useArtistInfo'

vi.mock('../../subsonic', () => ({
  default: { getArtistInfo: vi.fn() },
}))

const reply = (artistInfo) => ({
  json: { 'subsonic-response': { status: 'ok', artistInfo } },
})

describe('useArtistInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    subsonic.getArtistInfo.mockResolvedValue(reply({ biography: 'fetched' }))
  })

  it('returns the fetched info', async () => {
    const { result, waitFor } = renderHook(() =>
      useArtistInfo({ id: 'ar1', name: 'Artist' }),
    )
    await waitFor(() =>
      expect(result.current).toEqual({ biography: 'fetched' }),
    )
    expect(subsonic.getArtistInfo).toHaveBeenCalledWith('ar1')
  })

  it('re-fetches when the record object changes', async () => {
    const record = { id: 'ar1', name: 'Artist', biography: 'old' }
    const { rerender, waitFor } = renderHook(({ r }) => useArtistInfo(r), {
      initialProps: { r: record },
    })
    await waitFor(() => expect(subsonic.getArtistInfo).toHaveBeenCalledTimes(1))
    rerender({ r: { ...record, biography: 'new' } })
    await waitFor(() => expect(subsonic.getArtistInfo).toHaveBeenCalledTimes(2))
  })

  it('does not re-fetch when the same record object is passed again', async () => {
    const record = { id: 'ar1', name: 'Artist' }
    const { rerender, waitFor } = renderHook(({ r }) => useArtistInfo(r), {
      initialProps: { r: record },
    })
    await waitFor(() => expect(subsonic.getArtistInfo).toHaveBeenCalledTimes(1))
    rerender({ r: record })
    expect(subsonic.getArtistInfo).toHaveBeenCalledTimes(1)
  })

  it('ignores a failed response', async () => {
    subsonic.getArtistInfo.mockResolvedValue({
      json: { 'subsonic-response': { status: 'failed' } },
    })
    const { result } = renderHook(() => useArtistInfo({ id: 'ar1' }))
    await new Promise((r) => setTimeout(r, 10))
    expect(result.current).toBeNull()
  })
})
