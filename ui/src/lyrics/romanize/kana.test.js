import { describe, it, expect } from 'vitest'
import { contractLongVowels, kanaToRomaji } from './kana'

describe('kanaToRomaji', () => {
  it('writes the basic syllables, with Hepburn spellings', () => {
    expect(kanaToRomaji('しちつふじ')).toBe('shichitsufuji')
    expect(kanaToRomaji('ヂヅヲ')).toBe('jizuo')
  })

  it('reads yōon, including small kana after other kana', () => {
    expect(kanaToRomaji('ピャ きゃ シュ ジョ チェ')).toBe('pya kya shu jo che')
    expect(kanaToRomaji('ティ ディ ウィ ファ フィ ヴァ トゥ')).toBe(
      'ti di wi fa fi va tu',
    )
  })

  it('reads a small vowel that repeats the vowel as a long vowel', () => {
    expect(kanaToRomaji('ピャッチィ')).toBe('pyacchii')
  })

  it('doubles the consonant after a sokuon, and drops one at the end', () => {
    expect(kanaToRomaji('きっと')).toBe('kitto')
    expect(kanaToRomaji('ホップ')).toBe('hoppu')
    expect(kanaToRomaji('マッチャ')).toBe('maccha')
    expect(kanaToRomaji('ざっし')).toBe('zasshi')
    expect(kanaToRomaji('あっ')).toBe('a')
  })

  it('separates ん from a following vowel', () => {
    expect(kanaToRomaji('しんあい')).toBe("shin'ai")
    expect(kanaToRomaji('こんや')).toBe("kon'ya")
    expect(kanaToRomaji('ジャンプ')).toBe('janpu')
  })

  it('writes the katakana long-vowel mark as doubled letters or as a macron', () => {
    expect(kanaToRomaji('ハード', 'ascii')).toBe('haado')
    expect(kanaToRomaji('ハード', 'macron')).toBe('hādo')
    expect(kanaToRomaji('ピンキー', 'ascii')).toBe('pinkii')
    expect(kanaToRomaji('ピンキー', 'macron')).toBe('pinkī')
  })

  it('passes everything that is not kana through', () => {
    expect(kanaToRomaji('abc 123 !?')).toBe('abc 123 !?')
    expect(kanaToRomaji('ラブ、ラブ')).toBe('rabu、rabu')
  })
})

describe('contractLongVowels', () => {
  it('turns the long vowels of hiragana into macrons', () => {
    expect(contractLongVowels('toukyou')).toBe('tōkyō')
    expect(contractLongVowels('ookii')).toBe('ōkii')
    expect(contractLongVowels('jaa')).toBe('jā')
    expect(contractLongVowels('yuuki')).toBe('yūki')
  })

  it('leaves the ending of a verb alone', () => {
    expect(contractLongVowels('omou', true)).toBe('omou')
    expect(contractLongVowels('omou')).toBe('omō')
  })

  it('leaves ii and ei as they are', () => {
    expect(contractLongVowels('oishii sensei')).toBe('oishii sensei')
  })
})
