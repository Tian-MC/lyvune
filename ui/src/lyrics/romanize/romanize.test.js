import { describe, it, expect, vi } from 'vitest'

// The dictionary is fetched over HTTP, which a test has no server for
vi.mock('kuromoji/build/kuromoji.js', () => ({
  default: {
    builder: () => ({
      build: (done) =>
        done(null, {
          tokenize: () => [
            { surface_form: '君', pos: '名詞', reading: 'キミ' },
            { surface_form: 'は', pos: '助詞', reading: 'ハ' },
            { surface_form: '行く', pos: '動詞', reading: 'イク' },
            { surface_form: 'た', pos: '助動詞', reading: 'タ' },
            { surface_form: 'ハッピー', pos: '名詞', reading: undefined },
          ],
        }),
    }),
  },
}))

import { planFor, romanizeLines } from '.'
import { countScripts } from './scripts'

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
  it('romanizes kana without the dictionary', async () => {
    const out = await romanizeLines(['ありがとう', 'ゴジラ', ''], ['ja'])
    expect(out).toEqual(['arigatou', 'gojira', null])
  })

  it('uses the dictionary only for kanji', async () => {
    const out = await romanizeLines(['ありがとう', '君を探した'], ['ja'])
    expect(out[0]).toBe('arigatou')
    expect(out[1]).toBe('kimi wa ikuta happii')
  })

  it('writes Chinese as pinyin with tones', async () => {
    const [line] = await romanizeLines(['我爱你，中国'], ['zh'])
    expect(line).toBe('wǒ ài nǐ, zhōng guó')
  })

  it('puts a space after punctuation that is followed by a word', async () => {
    expect(await romanizeLines(['ラブ、ラブ'], ['ja'])).toEqual(['rabu, rabu'])
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

  it('reports a romanizer that cannot work at all', async () => {
    const broken = vi.spyOn(String.prototype, 'trim').mockImplementation(() => {
      throw new Error('boom')
    })
    await expect(romanizeLines(['안녕하세요'], ['ko'])).rejects.toThrow()
    broken.mockRestore()
  })

  it('leaves Latin lines out and keeps Latin words in mixed lines', async () => {
    const out = await romanizeLines(['Hello there', 'Hello 我爱你'], ['zh'])
    expect(out[0]).toBeNull()
    expect(out[1]).toBe('Hello wǒ ài nǐ')
  })
})
