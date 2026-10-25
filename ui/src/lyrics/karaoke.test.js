import { describe, it, expect } from 'vitest'
import { segmentProgress, wordProgress } from './karaoke'

describe('wordProgress', () => {
  it('sweeps between the real start and end of the word', () => {
    expect(wordProgress(1000, 1000, 2000)).toBe(0)
    expect(wordProgress(1500, 1000, 2000)).toBe(0.5)
    expect(wordProgress(2000, 1000, 2000)).toBe(1)
    expect(wordProgress(9000, 1000, 2000)).toBe(1)
    expect(wordProgress(500, 1000, 2000)).toBe(0)
  })

  it('does not invent a duration for a word with no known end', () => {
    expect(wordProgress(999, 1000, undefined)).toBe(0)
    expect(wordProgress(1000, 1000, undefined)).toBe(1)
    expect(wordProgress(1100, 1000, null)).toBe(1)
    // never an in-between value, however close to the start
    for (const ms of [1000, 1001, 1100, 1399, 5000]) {
      expect([0, 1]).toContain(wordProgress(ms, 1000, undefined))
    }
  })

  it('treats a degenerate end (not after the start) as unknown', () => {
    expect(wordProgress(1000, 1000, 1000)).toBe(1)
    expect(wordProgress(1000, 1000, 900)).toBe(1)
  })

  it('steps instead of sweeping for reduced motion', () => {
    expect(wordProgress(1100, 1000, 2000, true)).toBe(1)
    expect(wordProgress(999, 1000, 2000, true)).toBe(0)
    expect(wordProgress(1500, 1000, 2000, true)).toBe(1)
  })
})

describe('segmentProgress', () => {
  const words = [
    { text: '(' },
    { text: 'Hello', start: 1000, end: 2000 },
    { text: ', ' },
    { text: 'world', start: 3000, end: 4000 },
    { text: '!' },
  ]

  it('lets untimed text follow the word before it', () => {
    const p = segmentProgress(words, 1500, false)
    expect(p[1]).toBe(0.5)
    expect(p[2]).toBe(0.5) // the comma is filled with "Hello"
    expect(p[3]).toBe(0)
    expect(p[4]).toBe(0) // "!" follows "world"
  })

  it('lets untimed text before the first word follow that word', () => {
    expect(segmentProgress(words, 1500, false)[0]).toBe(0.5)
  })

  it('is all sung after the line and all unsung before it', () => {
    expect(segmentProgress(words, 9000, false)).toEqual([1, 1, 1, 1, 1])
    expect(segmentProgress(words, 0, false)).toEqual([0, 0, 0, 0, 0])
  })

  it('copes with a line that has no timed word at all', () => {
    expect(
      segmentProgress([{ text: 'a' }, { text: 'b' }], 1000, false),
    ).toEqual([0, 0])
  })
})
