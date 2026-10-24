import { describe, it, expect } from 'vitest'
import {
  playerReducer,
  selectCurrentItem,
  REPEAT_ALL,
  REPEAT_ONE,
} from './playerReducer'
import {
  addTracks,
  clearQueue,
  jumpTo,
  moveInQueue,
  nextTrack,
  playNext,
  playTracks,
  prevTrack,
  removeFromQueue,
  setRepeat,
  setTrack,
  setVolume,
  toggleShuffle,
  trackEnded,
} from '../actions'

const song = (id) => ({ id, title: `Song ${id}`, artist: 'A', album: 'B' })
const songs = (...ids) =>
  ids.reduce((acc, id) => ({ ...acc, [id]: song(id) }), {})

const reduce = (actions, state) => actions.reduce(playerReducer, state)
const titles = (state) => state.queue.map((i) => i.trackId)
const current = (state) => selectCurrentItem({ player: state })?.trackId

describe('playerReducer', () => {
  const base = playerReducer(undefined, { type: '@@INIT' })

  it('starts empty', () => {
    expect(base.queue).toEqual([])
    expect(base.repeat).toBe('off')
    expect(base.shuffle).toBe(false)
  })

  describe('loading a queue', () => {
    it('plays tracks from the selected one and requests playback', () => {
      const s = playerReducer(base, playTracks(songs('1', '2', '3'), null, '2'))
      expect(titles(s)).toEqual(['1', '2', '3'])
      expect(current(s)).toBe('2')
      expect(s.playRequest).toBe(base.playRequest + 1)
    })

    it('skips missing songs', () => {
      const data = { ...songs('1', '2'), 3: { ...song('3'), missing: true } }
      const s = playerReducer(base, playTracks(data))
      expect(titles(s)).toEqual(['1', '2'])
    })

    it('setTrack replaces the queue with one song', () => {
      const s = reduce([playTracks(songs('1', '2')), setTrack(song('9'))], base)
      expect(titles(s)).toEqual(['9'])
      expect(current(s)).toBe('9')
    })

    it('playlist tracks use mediaFileId as track id', () => {
      const s = playerReducer(
        base,
        playTracks({ 1: { ...song('1'), mediaFileId: 'mf1' } }),
      )
      expect(s.queue[0].trackId).toBe('mf1')
    })

    it('radios keep their stream url', () => {
      const s = playerReducer(
        base,
        setTrack({
          id: 'r',
          name: 'Radio',
          streamUrl: 'http://x',
          isRadio: true,
        }),
      )
      expect(s.queue[0].isRadio).toBe(true)
      expect(s.queue[0].musicSrc).toBe('http://x')
    })
  })

  describe('adding', () => {
    it('adds to the end without changing the current track', () => {
      const s0 = playerReducer(base, playTracks(songs('1', '2'), null, '1'))
      const s = playerReducer(s0, addTracks(songs('3')))
      expect(titles(s)).toEqual(['1', '2', '3'])
      expect(current(s)).toBe('1')
      expect(s.playRequest).toBe(s0.playRequest)
      expect(s0.queue).toHaveLength(2) // previous state not mutated
    })

    it('starts playing when adding to an empty queue', () => {
      const s = playerReducer(base, addTracks(songs('1')))
      expect(current(s)).toBe('1')
      expect(s.playRequest).toBe(base.playRequest + 1)
    })

    it('plays next right after the current track', () => {
      const s = reduce(
        [playTracks(songs('1', '2', '3'), null, '2'), playNext(songs('9'))],
        base,
      )
      expect(titles(s)).toEqual(['1', '2', '9', '3'])
      expect(current(s)).toBe('2')
    })
  })

  describe('navigation', () => {
    const loaded = playerReducer(base, playTracks(songs('1', '2', '3')))

    it('next and previous move through the queue', () => {
      const s = reduce([nextTrack(), nextTrack()], loaded)
      expect(current(s)).toBe('3')
      expect(current(playerReducer(s, prevTrack()))).toBe('2')
    })

    it('stops at the end unless repeating all', () => {
      const atEnd = reduce([jumpTo(2)], loaded)
      expect(current(playerReducer(atEnd, trackEnded()))).toBe('3')
      const wrapped = reduce([setRepeat(REPEAT_ALL), trackEnded()], atEnd)
      expect(current(wrapped)).toBe('1')
    })

    it('repeat one replays the same track', () => {
      const s0 = reduce([setRepeat(REPEAT_ONE)], loaded)
      const s = playerReducer(s0, trackEnded())
      expect(current(s)).toBe('1')
      expect(s.playRequest).toBe(s0.playRequest + 1)
    })

    it('previous at the head restarts the first track', () => {
      const s = playerReducer(loaded, prevTrack())
      expect(current(s)).toBe('1')
      expect(s.playRequest).toBe(loaded.playRequest + 1)
    })

    it('ignores jumps outside the queue', () => {
      expect(playerReducer(loaded, jumpTo(7))).toBe(loaded)
    })
  })

  describe('editing', () => {
    const loaded = playerReducer(
      base,
      playTracks(songs('1', '2', '3', '4'), null, '3'),
    )

    it('removing an earlier track keeps the current one', () => {
      const s = playerReducer(loaded, removeFromQueue(loaded.queue[0].uuid))
      expect(titles(s)).toEqual(['2', '3', '4'])
      expect(current(s)).toBe('3')
    })

    it('removing the current track moves to the following one', () => {
      const s = playerReducer(loaded, removeFromQueue(loaded.queue[2].uuid))
      expect(current(s)).toBe('4')
    })

    it('removing everything clears the queue but keeps preferences', () => {
      const s0 = reduce([setVolume(0.4), setRepeat(REPEAT_ALL)], loaded)
      const s = playerReducer(s0, removeFromQueue(s0.queue.map((i) => i.uuid)))
      expect(s.queue).toEqual([])
      expect(s.volume).toBe(0.4)
      expect(s.repeat).toBe(REPEAT_ALL)
    })

    it('moving tracks follows the current one', () => {
      const s = playerReducer(loaded, moveInQueue(2, 0))
      expect(titles(s)).toEqual(['3', '1', '2', '4'])
      expect(current(s)).toBe('3')
      const t = playerReducer(loaded, moveInQueue(0, 3))
      expect(titles(t)).toEqual(['2', '3', '4', '1'])
      expect(current(t)).toBe('3')
    })

    it('clearing keeps volume', () => {
      const s = reduce([setVolume(0.3), clearQueue()], loaded)
      expect(s.queue).toEqual([])
      expect(s.volume).toBe(0.3)
    })
  })

  describe('shuffle', () => {
    const ids = Array.from({ length: 30 }, (_, i) => String(i))
    const loaded = playerReducer(base, playTracks(songs(...ids), null, '4'))

    it('shuffles only what is up next and restores the original order', () => {
      const on = playerReducer(loaded, toggleShuffle())
      expect(on.shuffle).toBe(true)
      expect(titles(on).slice(0, 5)).toEqual(['0', '1', '2', '3', '4'])
      expect([...titles(on)].sort()).toEqual([...ids].sort())
      expect(current(on)).toBe('4')

      const moved = playerReducer(on, nextTrack())
      const off = playerReducer(moved, toggleShuffle())
      expect(off.shuffle).toBe(false)
      expect(titles(off)).toEqual(ids)
      expect(current(off)).toBe(current(moved))
    })
  })
})
