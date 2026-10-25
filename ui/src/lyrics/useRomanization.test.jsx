import { renderHook } from '@testing-library/react-hooks'
import { describe, it, expect, vi } from 'vitest'
// The browser build fetches its dictionary over HTTP; tests read it from node_modules
vi.mock('kuromoji/build/kuromoji.js', async () => {
  const { realTokenizer } = await import('./romanize/testTokenizer')
  return {
    default: {
      builder: () => ({
        build: (done) => realTokenizer().then((t) => done(null, t), done),
      }),
    },
  }
})

import { useRomanization } from './useRomanization'

const lyrics = (texts, extra = {}) => ({
  synced: false,
  lang: '',
  hasPronunciation: false,
  lines: texts.map((text, i) => ({
    text,
    start: i * 1000,
    words: null,
    pronunciation: null,
  })),
  ...extra,
})

describe('useRomanization', () => {
  it('is available for a supported script but does no work until asked', () => {
    const l = lyrics(['안녕하세요', '사랑해요'])
    const { result } = renderHook(() => useRomanization(l, false))
    expect(result.current.available).toBe(true)
    expect(result.current.status).toBe('idle')
    expect(result.current.lyrics).toBe(l)
  })

  it('adds a romanization line when enabled', async () => {
    const l = lyrics(['안녕하세요', 'hello'])
    const { result, waitFor } = renderHook(() => useRomanization(l, true))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.lyrics.hasPronunciation).toBe(true)
    expect(result.current.lyrics.lines[0].pronunciation).toBe('annyeonghaseyo')
    expect(result.current.lyrics.lines[1].pronunciation).toBeNull()
  })

  it('leaves the text, the timing and the karaoke words exactly as they were', async () => {
    const words = [{ text: '안', start: 0, end: 400 }]
    const l = lyrics(['안녕하세요'])
    l.lines[0].words = words
    const { result, waitFor } = renderHook(() => useRomanization(l, true))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    const [line] = result.current.lyrics.lines
    expect(line.words).toBe(words)
    expect(line.text).toBe('안녕하세요')
    expect(line.start).toBe(0)
    expect(l.lines[0].pronunciation).toBeNull()
  })

  it('keeps a provider romanization that covers every line', () => {
    const l = lyrics(['안녕하세요'], { hasPronunciation: true })
    l.lines[0].pronunciation = 'provider reading'
    const { result } = renderHook(() => useRomanization(l, true))
    expect(result.current.available).toBe(false)
    expect(result.current.lyrics).toBe(l)
  })

  it('fills only the lines a provider left out, and never replaces its own', async () => {
    const l = lyrics(['안녕하세요', '사랑해요', '고마워요'], {
      hasPronunciation: true,
    })
    l.lines[0].pronunciation = 'provider one'
    l.lines[2].pronunciation = '고마워요'
    const { result, waitFor } = renderHook(() => useRomanization(l, true))
    expect(result.current.available).toBe(true)
    await waitFor(() => expect(result.current.status).toBe('ready'))
    const got = result.current.lyrics.lines.map((x) => x.pronunciation)
    expect(got[0]).toBe('provider one')
    expect(got[1]).toBe('saranghaeyo')
    // a provider line that only repeats the text is no romanization
    expect(got[2]).toBe('gomawoyo')
  })

  it('writes Japanese in the style it is given', async () => {
    const l = lyrics(['東京へ行こう', 'ありがとう'])
    const { result, waitFor, rerender } = renderHook(
      ({ style }) => useRomanization(l, true, { style }),
      { initialProps: { style: 'ascii' } },
    )
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.lyrics.lines[0].pronunciation).toBe('toukyou e ikou')
    rerender({ style: 'macron' })
    await waitFor(() =>
      expect(result.current.lyrics.lines[0].pronunciation).toBe('tōkyō e ikō'),
    )
    expect(result.current.status).toBe('ready')
  })

  it('never blanks the lines while it switches style', async () => {
    const l = lyrics(['東京へ行こう', 'ありがとう'])
    const { result, waitFor, rerender } = renderHook(
      ({ style }) => useRomanization(l, true, { style }),
      { initialProps: { style: 'ascii' } },
    )
    await waitFor(() => expect(result.current.status).toBe('ready'))
    const before = result.all.length
    rerender({ style: 'macron' })
    await waitFor(() =>
      expect(result.current.lyrics.lines[0].pronunciation).toBe('tōkyō e ikō'),
    )
    // every render after the switch still had a romanization on every line
    result.all.slice(before).forEach((r) => {
      expect(r.lyrics.lines.every((x) => x.pronunciation)).toBe(true)
    })
    // and going back is answered from the cache in the same render
    rerender({ style: 'ascii' })
    expect(result.current.lyrics.lines[0].pronunciation).toBe('toukyou e ikou')
    expect(result.current.status).toBe('ready')
  })

  it('reads ambiguous Han characters as the listener chose', async () => {
    const l = lyrics(['東京大阪', '京都神戸'])
    const { result, waitFor } = renderHook(
      ({ han }) => useRomanization(l, true, { han }),
      { initialProps: { han: 'auto' } },
    )
    expect(result.current.ambiguous).toBe(true)
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.engines).toEqual(['zh'])
    expect(result.current.lyrics.lines[0].pronunciation).toMatch(/dōng jīng/)
  })

  it('is not available for Latin-script lyrics', () => {
    const { result } = renderHook(() =>
      useRomanization(lyrics(['plain English', 'more']), true),
    )
    expect(result.current.available).toBe(false)
  })

  it('copes with no lyrics', () => {
    const { result } = renderHook(() => useRomanization(null, true))
    expect(result.current.available).toBe(false)
    expect(result.current.lyrics).toBeNull()
  })
})
