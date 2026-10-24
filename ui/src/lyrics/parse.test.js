import { describe, it, expect } from 'vitest'
import { activeLineIndex, buildWords, parseLyrics } from './parse'

describe('parseLyrics', () => {
  it('returns null when there are no main lyrics', () => {
    expect(parseLyrics([])).toBeNull()
    expect(parseLyrics(undefined)).toBeNull()
    expect(
      parseLyrics([
        { kind: 'translation', synced: true, line: [{ start: 0, value: 'x' }] },
      ]),
    ).toBeNull()
  })

  it('keeps unsynced lyrics unsynced', () => {
    const r = parseLyrics([
      {
        lang: 'eng',
        synced: false,
        line: [{ value: 'one' }, { value: 'two' }],
      },
    ])
    expect(r.synced).toBe(false)
    expect(r.lines.map((l) => l.start)).toEqual([null, null])
    expect(r.hasWords).toBe(false)
  })

  it('applies the offset (positive = sooner) and prefers synced main lyrics', () => {
    const r = parseLyrics([
      { synced: false, line: [{ value: 'plain' }] },
      {
        synced: true,
        offset: 500,
        line: [
          { start: 1000, value: 'a' },
          { start: 3000, value: 'b' },
        ],
      },
    ])
    expect(r.synced).toBe(true)
    expect(r.lines.map((l) => l.start)).toEqual([500, 2500])
  })

  it('aligns translations by timestamp and pronunciations by position', () => {
    const r = parseLyrics([
      {
        kind: 'main',
        synced: true,
        line: [
          { start: 0, value: 'こんにちは' },
          { start: 2000, value: 'さようなら' },
        ],
      },
      {
        kind: 'translation',
        synced: true,
        line: [{ start: 2000, value: 'goodbye' }],
      },
      {
        kind: 'pronunciation',
        synced: false,
        line: [{ value: 'konnichiwa' }, { value: 'sayounara' }],
      },
    ])
    expect(r.lines[0].translation).toBeNull()
    expect(r.lines[1].translation).toBe('goodbye')
    expect(r.lines.map((l) => l.pronunciation)).toEqual([
      'konnichiwa',
      'sayounara',
    ])
    expect(r.hasTranslation).toBe(true)
    expect(r.hasPronunciation).toBe(true)
  })

  it('builds word timings only from real cues', () => {
    const r = parseLyrics([
      {
        synced: true,
        line: [{ start: 0, value: 'hello world' }],
        cueLine: [
          {
            index: 0,
            value: 'hello world',
            cue: [
              { start: 0, end: 400, byteStart: 0, byteEnd: 4, value: 'hello' },
              {
                start: 500,
                end: 900,
                byteStart: 6,
                byteEnd: 10,
                value: 'world',
              },
            ],
          },
        ],
      },
    ])
    expect(r.hasWords).toBe(true)
    expect(r.lines[0].words).toEqual([
      { text: 'hello', start: 0, end: 400 },
      { text: ' ' },
      { text: 'world', start: 500, end: 900 },
    ])
  })
})

describe('buildWords', () => {
  it('slices multi-byte text by UTF-8 byte offsets', () => {
    // "愛 love": 愛 is 3 bytes in UTF-8
    const words = buildWords('愛 love', [
      { start: 0, byteStart: 0, byteEnd: 2, value: '愛' },
      { start: 300, byteStart: 4, byteEnd: 7, value: 'love' },
    ])
    expect(words.map((w) => w.text)).toEqual(['愛', ' ', 'love'])
    expect(words[0].end).toBe(300)
  })
})

describe('activeLineIndex', () => {
  const lines = [{ start: 0 }, { start: 1000 }, { start: 5000 }]
  it('finds the line active at a time', () => {
    expect(activeLineIndex(lines, 0)).toBe(0)
    expect(activeLineIndex(lines, 999)).toBe(0)
    expect(activeLineIndex(lines, 1000)).toBe(1)
    expect(activeLineIndex(lines, 99999)).toBe(2)
  })
  it('returns -1 before the first line', () => {
    expect(activeLineIndex([{ start: 2000 }], 100)).toBe(-1)
  })
})
