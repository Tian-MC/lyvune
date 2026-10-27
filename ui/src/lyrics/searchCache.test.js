import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({ search: vi.fn() }))
vi.mock('./manageApi', () => ({ lyricsApi: { search: mocks.search } }))

import {
  SEARCH_TTL_MS,
  forgetSearch,
  peekSearch,
  searchLyrics,
} from './searchCache'
import { bumpLyrics } from './lyricsSignals'

const answer = (ids) => ({
  candidates: ids.map((id) => ({ id })),
  providers: [{ id: 'lrclib', status: 'ok', count: ids.length }],
})

describe('searchCache', () => {
  beforeEach(() => {
    mocks.search.mockReset()
    mocks.search.mockResolvedValue(answer(['lrclib:1']))
  })
  afterEach(() => vi.useRealTimers())

  it('shares one request between searches made at the same time', async () => {
    const [a, b] = await Promise.all([
      searchLyrics('sc-1'),
      searchLyrics('sc-1'),
    ])
    expect(mocks.search).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
  })

  it('answers again from memory, an empty result included', async () => {
    mocks.search.mockResolvedValue(answer([]))
    await searchLyrics('sc-2')
    const again = await searchLyrics('sc-2')
    expect(mocks.search).toHaveBeenCalledTimes(1)
    expect(again.candidates).toEqual([])
    expect(peekSearch('sc-2')).toEqual(again)
  })

  it('asks the server again when told to refresh', async () => {
    await searchLyrics('sc-3')
    mocks.search.mockResolvedValue(answer(['lrclib:2']))
    const fresh = await searchLyrics('sc-3', { refresh: true })
    expect(mocks.search).toHaveBeenCalledTimes(2)
    expect(fresh.candidates[0].id).toBe('lrclib:2')
    expect(peekSearch('sc-3').candidates[0].id).toBe('lrclib:2')
  })

  it('does not start a second request when a refresh meets one on its way', async () => {
    const first = searchLyrics('sc-4')
    const second = searchLyrics('sc-4', { refresh: true })
    await Promise.all([first, second])
    expect(mocks.search).toHaveBeenCalledTimes(1)
  })

  it('forgets the results when the lyrics of the track change', async () => {
    await searchLyrics('sc-5')
    bumpLyrics('sc-5')
    expect(peekSearch('sc-5')).toBeNull()
    await searchLyrics('sc-5')
    expect(mocks.search).toHaveBeenCalledTimes(2)
  })

  it('forgets them before the server does, so a shown result can still be used', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-27T10:00:00Z'))
    await searchLyrics('sc-6')
    vi.setSystemTime(Date.now() + SEARCH_TTL_MS - 1000)
    expect(peekSearch('sc-6')).not.toBeNull()
    vi.setSystemTime(Date.now() + 2000)
    expect(peekSearch('sc-6')).toBeNull()
    expect(SEARCH_TTL_MS).toBeLessThan(15 * 60 * 1000)
  })

  it('does not remember a failure', async () => {
    mocks.search.mockRejectedValueOnce(new Error('offline'))
    await expect(searchLyrics('sc-7')).rejects.toThrow('offline')
    expect(peekSearch('sc-7')).toBeNull()
    await searchLyrics('sc-7')
    expect(mocks.search).toHaveBeenCalledTimes(2)
  })

  it('can be told to forget a track', async () => {
    await searchLyrics('sc-8')
    forgetSearch('sc-8')
    expect(peekSearch('sc-8')).toBeNull()
  })
})
