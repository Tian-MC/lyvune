import React from 'react'
import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('react-admin', () => ({
  useTranslate: () => (key, opts) => opts?._ ?? key,
}))
const mocks = vi.hoisted(() => ({
  lyrics: null,
  time: 0,
  currentTimeCalls: 0,
  reads: [],
}))
vi.mock('./useLyrics', () => ({ useLyrics: () => mocks.lyrics }))
vi.mock('./LyricsSourceBar', () => ({ LyricsSourceBar: () => null }))
vi.mock('../playback/engine', () => ({
  default: {
    seek: vi.fn(),
    play: vi.fn(),
    currentTime: () => {
      mocks.currentTimeCalls += 1
      return mocks.time
    },
    getMedia: () => ({ paused: false }),
  },
}))

import { LyricsView } from './LyricsView'
import { parseLyrics } from './parse'

// FIXTURE: synthetic text with timings authored for these tests. It is NOT a
// real recording's lyrics. It goes through the production parser and renderer.
const FIXTURE = [
  {
    lang: 'jpn',
    kind: 'main',
    synced: true,
    line: [
      { start: 1000, value: 'FIXTURE one' },
      { start: 2000, value: 'Hello, world' },
      { start: 5000, value: '終わりです。' },
      { start: 8000, value: 'plain fixture line' },
      { start: 9000, value: 'one two' },
    ],
    cueLine: [
      {
        index: 0,
        start: 1000,
        end: 1900,
        value: 'FIXTURE one',
        cue: [
          {
            start: 1000,
            end: 1400,
            byteStart: 0,
            byteEnd: 7,
            value: 'FIXTURE ',
          },
          { start: 1400, end: 1900, byteStart: 8, byteEnd: 10, value: 'one' },
        ],
      },
      {
        index: 1,
        start: 2000,
        end: 4500,
        value: 'Hello, world',
        cue: [
          { start: 2000, end: 2500, byteStart: 0, byteEnd: 4, value: 'Hello' },
          { start: 3000, end: 4000, byteStart: 7, byteEnd: 11, value: 'world' },
        ],
      },
      {
        index: 2,
        start: 5000,
        end: 7000,
        value: '終わりです。',
        cue: [
          { start: 5000, end: 5600, byteStart: 0, byteEnd: 5, value: '終わ' },
          {
            start: 5600,
            end: 6400,
            byteStart: 6,
            byteEnd: 14,
            value: 'りです',
          },
        ],
      },
      // last word has no end of its own, and neither does the line
      {
        index: 4,
        start: 9000,
        value: 'one two',
        cue: [
          { start: 9000, end: 9500, byteStart: 0, byteEnd: 3, value: 'one ' },
          { start: 9500, byteStart: 4, byteEnd: 6, value: 'two' },
        ],
      },
    ],
  },
]

let frame
const tick = async (seconds) => {
  if (seconds !== undefined) mocks.time = seconds
  await act(async () => {
    vi.advanceTimersToNextFrame()
  })
}
const activeButton = () => document.querySelector('button[aria-current="true"]')
const wordSpans = () => [
  ...activeButton().querySelectorAll(':scope > span > span > span'),
]
const progress = () =>
  wordSpans().map((s) => Number(s.style.getPropertyValue('--p')))

describe('word-level karaoke (production parser and renderer, synthetic fixture)', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['requestAnimationFrame', 'cancelAnimationFrame'],
    })
    window.matchMedia = () => ({ matches: false })
    Element.prototype.scrollTo = vi.fn()
    mocks.time = 0
    mocks.currentTimeCalls = 0
    mocks.lyrics = { status: 'ready', lyrics: parseLyrics(FIXTURE) }
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const show = async (time = 0) => {
    mocks.time = time
    const view = render(<LyricsView trackId="k1" />)
    await tick()
    return view
  }

  it('is recognised as genuine word timing', () => {
    const lyrics = parseLyrics(FIXTURE)
    expect(lyrics.hasWords).toBe(true)
    expect(lyrics.lines[1].words.filter((w) => w.start != null)).toHaveLength(2)
    expect(lyrics.lines[3].words).toBeNull()
  })

  it('changes line on the frame the audio clock crosses it, not a quarter second later', async () => {
    await show(1.99)
    expect(activeButton().textContent).toContain('FIXTURE one')
    await tick(2.0)
    expect(activeButton().textContent).toContain('Hello, world')
    await tick(4.99)
    expect(activeButton().textContent).toContain('Hello, world')
    await tick(5.0)
    expect(activeButton().textContent).toContain('終わりです')
  })

  it('fills a word from its real start to its real end', async () => {
    await show(2.0)
    expect(progress()[0]).toBe(0)
    await tick(2.25)
    expect(progress()[0]).toBeCloseTo(0.5, 2)
    await tick(2.5)
    expect(progress()[0]).toBe(1)
    await tick(2.9)
    expect(progress()[2]).toBe(0) // "world" has not started
    await tick(3.5)
    expect(progress()[2]).toBeCloseTo(0.5, 2)
  })

  it('lets punctuation fill with the word it belongs to', async () => {
    await show(2.25)
    const spans = wordSpans()
    expect(spans.map((s) => s.textContent)).toEqual(['Hello', ', ', 'world'])
    const p = progress()
    expect(p[1]).toBe(p[0])
    await tick(9.9)
  })

  it('handles Japanese text with multi-byte characters and its trailing punctuation', async () => {
    await show(5.3)
    const spans = wordSpans()
    expect(spans.map((s) => s.textContent)).toEqual(['終わ', 'りです', '。'])
    expect(spans.map((s) => s.textContent).join('')).toBe('終わりです。')
    await tick(6.0)
    const p = progress()
    expect(p[0]).toBe(1)
    expect(p[1]).toBeCloseTo((6000 - 5600) / 800, 2)
    expect(p[2]).toBe(p[1]) // the full stop follows
  })

  it('never makes up a duration for a last word without an end', async () => {
    await show(9.0)
    expect(wordSpans().map((s) => s.textContent)).toEqual(['one ', 'two'])
    for (const t of [9.5, 9.6, 9.8, 10.5]) {
      await tick(t)
      expect([0, 1]).toContain(progress()[1])
    }
    await tick(9.49)
    expect(progress()[1]).toBe(0)
    await tick(9.5)
    expect(progress()[1]).toBe(1)
  })

  it('follows a seek backwards and forwards on the next frame', async () => {
    await show(3.5)
    expect(activeButton().textContent).toContain('Hello, world')
    await tick(6.0)
    expect(activeButton().textContent).toContain('終わりです')
    await tick(2.1) // back to the previous line
    expect(activeButton().textContent).toContain('Hello, world')
    expect(progress()[0]).toBeCloseTo(0.2, 2)
    expect(progress()[2]).toBe(0)
  })

  it('stops writing styles while the clock stands still (paused) and resumes from where it is', async () => {
    await show(2.25)
    const spy = vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty')
    await tick()
    await tick()
    await tick()
    expect(spy).not.toHaveBeenCalled()
    await tick(2.4) // resume
    expect(spy).toHaveBeenCalled()
    expect(progress()[0]).toBeCloseTo(0.8, 2)
    spy.mockRestore()
  })

  it('shows a line without word timing as an ordinary active line, not as karaoke', async () => {
    await show(8.2)
    expect(activeButton().textContent).toBe('plain fixture line')
    expect(activeButton().querySelectorAll('span span span')).toHaveLength(0)
  })

  it('steps from unsung to sung for reduced motion', async () => {
    window.matchMedia = (q) => ({ matches: /reduce/.test(q) })
    await show(2.0)
    await tick(2.25)
    expect(progress()[0]).toBe(1)
    await tick(2.99)
    expect(progress()[2]).toBe(0)
    await tick(3.0)
    expect(progress()[2]).toBe(1)
  })

  it('reads the audio clock and nothing else, and stops when the view goes away', async () => {
    const { unmount } = await show(2.0)
    await tick()
    unmount()
    const calls = mocks.currentTimeCalls
    await act(async () => {
      vi.advanceTimersByTime(500)
    })
    expect(mocks.currentTimeCalls).toBe(calls)
  })

  it('shows the first line of a new track from the audio clock, with no stale highlight', async () => {
    const { rerender } = await show(3.5)
    expect(activeButton().textContent).toContain('Hello, world')
    mocks.time = 0.5
    rerender(<LyricsView trackId="k2" />)
    await tick()
    expect(document.querySelector('button[aria-current="true"]')).toBeNull()
    await tick(1.2)
    expect(activeButton().textContent).toContain('FIXTURE one')
    expect(progress()[0]).toBeCloseTo(0.5, 1)
  })

  it('keeps the lyrics readable for assistive technology while highlighting', async () => {
    await show(2.25)
    expect(
      screen.getByRole('button', { name: /Hello ?, ?world/ }),
    ).toBeInTheDocument()
  })
})
