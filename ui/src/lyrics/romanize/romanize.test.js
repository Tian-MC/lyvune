import { beforeEach, describe, it, expect, vi } from 'vitest'

// The browser build fetches its dictionary over HTTP; the tests read the same
// dictionary from node_modules instead
vi.mock('kuromoji/build/kuromoji.js', async () => {
  const { realTokenizer } = await import('./testTokenizer')
  return {
    default: {
      builder: () => ({
        build: (done) => realTokenizer().then((t) => done(null, t), done),
      }),
    },
  }
})

import { clearRomanizationCache, planFor, romanizeLines } from '.'
import { countScripts, hanIsAmbiguous } from './scripts'

// FIXTURE data: short invented phrases, not lyrics of any recording
describe('planFor', () => {
  it('chooses a romanizer from the writing system', () => {
    expect(planFor(['こんにちは', 'ありがとう'], '')).toEqual(['ja'])
    expect(planFor(['我爱你', '谢谢你'], '')).toEqual(['zh'])
    expect(planFor(['안녕하세요', '사랑해요'], '')).toEqual(['ko'])
    expect(planFor(['Καλημέρα', 'αγάπη μου'], '')).toEqual(['el'])
    expect(planFor(['Привет мир', 'спасибо'], '')).toEqual(['ru'])
    expect(planFor(['مرحبا بك', 'يا حبيبي'], '')).toEqual(['ar'])
  })

  it('reads kanji as Japanese when there is kana or the song says so', () => {
    expect(planFor(['東京大阪', '京都神戸'], '')).toEqual(['zh'])
    expect(planFor(['東京大阪', '京都神戸'], 'jpn')).toEqual(['ja'])
    expect(planFor(['君を探していた', '東京'], '')).toEqual(['ja'])
  })

  it('lets the listener decide for Han characters, over everything else', () => {
    expect(planFor(['東京大阪', '京都神戸'], '', 'ja')).toEqual(['ja'])
    expect(planFor(['東京大阪', '京都神戸'], 'jpn', 'zh')).toEqual(['zh'])
    expect(planFor(['君を探していた', '東京'], '', 'zh')).toEqual(['zh'])
  })

  it('offers a choice only where the Han characters are really ambiguous', () => {
    expect(hanIsAmbiguous(['東京大阪', '京都神戸'], '')).toBe(true)
    expect(hanIsAmbiguous(['東京大阪', '京都神戸'], 'jpn')).toBe(false)
    expect(hanIsAmbiguous(['東京大阪', '京都神戸'], 'zho')).toBe(false)
    expect(hanIsAmbiguous(['君を探していた', '東京'], '')).toBe(false)
    expect(hanIsAmbiguous(['안녕하세요'], '')).toBe(false)
  })

  it('tells Ukrainian from Russian', () => {
    expect(planFor(['Привіт світе', 'їжак'], '')).toEqual(['uk'])
    expect(planFor(['Привет', 'мир'], 'ukr')).toEqual(['uk'])
  })

  it('does not offer a romanization for a stray character', () => {
    expect(planFor(['Hello world', 'Δ', 'Goodbye'], '')).toEqual([])
    expect(planFor(['Just English here', 'and here'], '')).toEqual([])
  })

  it('finds several writing systems in one song', () => {
    expect(
      planFor(['안녕하세요', 'こんにちは', 'ありがとう', '사랑해요'], ''),
    ).toEqual(['ja', 'ko'])
  })

  it('counts characters per script', () => {
    expect(countScripts('abc ひらがな 漢')).toEqual({ kana: 4, han: 1 })
  })
})

describe('romanizeLines', () => {
  beforeEach(() => clearRomanizationCache())

  it('romanizes Japanese, with and without kanji, from the dictionary', async () => {
    const out = await romanizeLines(['ありがとう', '君を探した', ''], ['ja'])
    expect(out).toEqual(['arigatou', 'kimi o sagashita', null])
  })

  it('writes the style it is asked for, from the same analysis', async () => {
    const a = await romanizeLines(['東京へ行こう'], ['ja'], { style: 'ascii' })
    const m = await romanizeLines(['東京へ行こう'], ['ja'], { style: 'macron' })
    expect(a).toEqual(['toukyou e ikou'])
    expect(m).toEqual(['tōkyō e ikō'])
  })

  it('writes Chinese as pinyin with tones', async () => {
    const [line] = await romanizeLines(['我爱你，中国'], ['zh'])
    expect(line).toBe('wǒ ài nǐ, zhōng guó')
  })

  it('romanizes Korean', async () => {
    expect(await romanizeLines(['안녕하세요'], ['ko'])).toEqual([
      'annyeonghaseyo',
    ])
  })

  it('romanizes Greek', async () => {
    const [line] = await romanizeLines(['Καλημέρα κόσμε'], ['el'])
    expect(line).toBe('Kalēmera kosme')
  })

  it('romanizes Russian and Ukrainian differently', async () => {
    expect(await romanizeLines(['Привет, мир'], ['ru'])).toEqual([
      'Privet, mir',
    ])
    expect(await romanizeLines(['Привіт, світе'], ['uk'])).toEqual([
      'Pryvit, svite',
    ])
  })

  it('romanizes Arabic without short vowels', async () => {
    const [line] = await romanizeLines(['مرحبا بك'], ['ar'])
    expect(line).toBe('mrḥba bk')
  })

  it('leaves Latin lines out and keeps Latin words in mixed lines', async () => {
    const out = await romanizeLines(['Hello there', 'Hello 我爱你'], ['zh'])
    expect(out[0]).toBeNull()
    expect(out[1]).toBe('Hello wǒ ài nǐ')
  })

  it('romanizes each script of a mixed song with its own romanizer', async () => {
    const out = await romanizeLines(['안녕하세요', 'こんにちは'], ['ja', 'ko'])
    expect(out).toEqual(['annyeonghaseyo', 'konnichiwa'])
  })

  it('answers a repeated line from the cache', async () => {
    const first = await romanizeLines(['ずっと君を'], ['ja'])
    const spy = vi.spyOn(String.prototype, 'replace')
    const second = await romanizeLines(['ずっと君を'], ['ja'])
    const calls = spy.mock.calls.length
    spy.mockRestore()
    expect(second).toEqual(first)
    expect(calls).toBe(0)
  })

  it('reports a romanizer that cannot work at all', async () => {
    const broken = vi.spyOn(String.prototype, 'trim').mockImplementation(() => {
      throw new Error('boom')
    })
    await expect(romanizeLines(['안녕하세요'], ['ko'])).rejects.toThrow()
    broken.mockRestore()
  })
})
