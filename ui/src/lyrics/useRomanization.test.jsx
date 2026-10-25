import { renderHook } from '@testing-library/react-hooks'
import { describe, it, expect } from 'vitest'
import { useRomanization } from './useRomanization'

const lyrics = (texts, extra = {}) => ({
  synced: false,
  lang: '',
  hasPronunciation: false,
  lines: texts.map((text) => ({ text, start: null, pronunciation: null })),
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

  it('leaves a provider romanization alone', () => {
    const l = lyrics(['안녕하세요'], { hasPronunciation: true })
    const { result } = renderHook(() => useRomanization(l, true))
    expect(result.current.available).toBe(false)
    expect(result.current.lyrics).toBe(l)
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
