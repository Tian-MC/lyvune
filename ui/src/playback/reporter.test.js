import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../subsonic', () => ({
  default: {
    reportPlayback: vi.fn(() => Promise.resolve()),
    reportPlaybackKeepalive: vi.fn(),
  },
}))
vi.mock('../config', () => ({ default: { playbackReportIntervalMs: 1000 } }))

import subsonic from '../subsonic'
import { createReporter } from './reporter'

const song = { trackId: 't1', uuid: 'u1' }
const calls = () =>
  subsonic.reportPlayback.mock.calls.map(([id, ms, state]) => [id, ms, state])

describe('playback reporter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    subsonic.reportPlayback.mockClear()
    subsonic.reportPlaybackKeepalive.mockClear()
  })
  afterEach(() => vi.useRealTimers())

  it('reports starting then playing for a new track', async () => {
    const r = createReporter()
    r.play(song, 1.5)
    await Promise.resolve()
    await Promise.resolve()
    expect(calls()).toEqual([
      ['t1', 1500, 'starting'],
      ['t1', 1500, 'playing'],
    ])
  })

  it('reports playing on resume, paused on pause, and a heartbeat', async () => {
    const r = createReporter()
    r.play(song, 0)
    await Promise.resolve()
    subsonic.reportPlayback.mockClear()
    r.position(3)
    vi.advanceTimersByTime(1000)
    expect(calls()).toEqual([['t1', 3000, 'playing']])
    r.pause(4)
    r.play(song, 4)
    expect(calls().slice(1)).toEqual([
      ['t1', 4000, 'paused'],
      ['t1', 4000, 'playing'],
    ])
  })

  it('stops the heartbeat when paused', () => {
    const r = createReporter()
    r.play(song, 0)
    r.pause(1)
    subsonic.reportPlayback.mockClear()
    vi.advanceTimersByTime(5000)
    expect(calls()).toEqual([])
  })

  it('reports stopped at the duration when a track ends', () => {
    const r = createReporter()
    r.play(song, 0)
    subsonic.reportPlayback.mockClear()
    r.ended(song, 200)
    expect(calls()).toEqual([['t1', 200000, 'stopped']])
  })

  it('reports stopped with the last position on track change', () => {
    const r = createReporter()
    r.play(song, 0)
    r.position(42)
    subsonic.reportPlayback.mockClear()
    r.trackChange()
    expect(calls()).toEqual([['t1', 42000, 'stopped']])
  })

  it('debounces seek reports', () => {
    const r = createReporter()
    r.play(song, 0)
    subsonic.reportPlayback.mockClear()
    r.seeked(10, false)
    r.seeked(20, false)
    r.seeked(30, true)
    vi.advanceTimersByTime(300)
    expect(calls()).toEqual([['t1', 30000, 'paused']])
  })

  it('never reports radios', () => {
    const r = createReporter()
    r.play({ ...song, isRadio: true }, 0)
    r.ended({ ...song, isRadio: true }, 10)
    expect(calls()).toEqual([])
  })

  it('sends a keepalive stop when the page is hidden', () => {
    const r = createReporter()
    r.play(song, 0)
    r.position(7)
    r.pageHide()
    expect(subsonic.reportPlaybackKeepalive).toHaveBeenCalledWith(
      't1',
      7000,
      'stopped',
    )
  })
})
