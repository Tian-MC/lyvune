import { beforeAll, describe, it, expect } from 'vitest'
import { realTokenizer } from './testTokenizer'
import { romanizeJapanese } from './japanese'

// FIXTURE data: short phrases, some taken from a single song to reproduce the
// errors seen there, others made up. No song is reproduced in full.
let tk
beforeAll(async () => {
  tk = await realTokenizer()
}, 60000)

const ascii = (text) => romanizeJapanese(tk, text, { style: 'ascii' })
const macron = (text) => romanizeJapanese(tk, text, { style: 'macron' })

describe('word boundaries', () => {
  it('separates the words of a line written entirely in hiragana', () => {
    expect(ascii('どうしようもなかったから')).toBe('dou shiyou mo nakatta kara')
    expect(macron('どうしようもなかったから')).toBe('dō shiyō mo nakatta kara')
  })

  it('does not cut a katakana word into pieces', () => {
    expect(ascii('ハード ピンキー ジャンキー 手に')).toBe(
      'haado pinkii jankii te ni',
    )
    expect(macron('ハード ピンキー ジャンキー 手に')).toBe(
      'hādo pinkī jankī te ni',
    )
  })

  it('joins the pieces of a word the analyzer cut', () => {
    expect(ascii('君のよこ顔')).toBe('kimi no yokogao')
    expect(ascii('君のなかみ')).toBe('kimi no nakami')
  })

  it('cuts a long katakana run into the words it is made of', () => {
    expect(ascii('じゃあホップステップジャンプで')).toBe(
      'jaa hoppu suteppu janpu de',
    )
    expect(macron('じゃあホップステップジャンプで')).toBe(
      'jā hoppu suteppu janpu de',
    )
  })

  it('cuts a repeated unknown run into its repeats', () => {
    expect(macron('ギブミーギブミー')).toBe('gibumī gibumī')
  })

  it('keeps the spaces the source has, and no others', () => {
    expect(ascii('ねえ 本当に')).toBe('nee hontouni')
    expect(ascii('今すぐ  君に')).toBe('ima sugu kimi ni')
  })

  it('does not regress a line that was already right', () => {
    expect(ascii('今すぐ君に会いたい。')).toBe('ima sugu kimi ni aitai.')
    expect(ascii('ずっと君を探していた')).toBe('zutto kimi o sagashiteita')
  })

  it('writes an inflected word as one word and the copula as its own', () => {
    expect(ascii('食べさせられた')).toBe('tabesaserareta')
    expect(ascii('楽しかったです')).toBe('tanoshikatta desu')
    expect(ascii('雨が降っています')).toBe('ame ga futteimasu')
    expect(ascii('おはようございます')).toBe('ohayou gozaimasu')
  })
})

describe('readings', () => {
  it('reads は, へ and を as particles, and は inside a word as ha', () => {
    expect(ascii('エピローグはピャッチィだけが')).toBe(
      'epiroogu wa pyacchii dake ga',
    )
    expect(ascii('東京へ行こう')).toBe('toukyou e ikou')
    expect(ascii('手をつなごう')).toBe('te o tsunagou')
    expect(ascii('はなび')).not.toMatch(/^wa/)
    expect(ascii('こんにちは、私は学生です')).toBe(
      'konnichiwa, watashi wa gakusei desu',
    )
  })

  it('joins a sokuon across the end of one token and the start of the next', () => {
    expect(ascii('手をとって')).toBe('te o totte')
    expect(ascii('行ってきます')).toBe('ittekimasu')
  })

  it('reads a kanji that the dictionary only has as a suffix as the word it is', () => {
    expect(ascii('つめたい手をとって')).toContain('te o totte')
    expect(ascii('運転手')).toBe('untenshu')
  })

  it('reads the iteration mark with rendaku where the sounds allow it', () => {
    expect(ascii('君々')).toBe('kimigimi')
    expect(ascii('人々')).toBe('hitobito')
    expect(ascii('時々')).toBe('tokidoki')
    expect(ascii('色々')).toBe('iroiro')
  })

  it('keeps a 々 it cannot resolve rather than invent a reading', () => {
    expect(ascii('々')).toBe('々')
  })

  it('reads katakana names it does not know as they are spelled', () => {
    expect(macron('オー！マイピャッチィがきっと')).toBe(
      'ō! mai pyacchii ga kitto',
    )
    expect(ascii('オー！マイピャッチィがきっと')).toBe(
      'oo! mai pyacchii ga kitto',
    )
  })
})

describe('long vowels', () => {
  it('writes macrons or doubled vowels, never a mixture', () => {
    expect(ascii('東京')).toBe('toukyou')
    expect(macron('東京')).toBe('tōkyō')
    expect(ascii('大きな夢')).toBe('ookina yume')
    expect(macron('大きな夢')).toBe('ōkina yume')
    expect(macron('ストーリー')).toBe('sutōrī')
  })

  it('does not lengthen the ending of a verb', () => {
    expect(macron('思う')).toBe('omou')
    expect(macron('行こう')).toBe('ikō')
  })
})

describe('punctuation and other writing', () => {
  it('keeps punctuation against the word before it', () => {
    expect(ascii('ねえ、聞こえてる？')).toBe('nee, kikoeteru?')
    expect(ascii('愛してるよ、ずっと')).toBe('aishiteru yo, zutto')
    expect(ascii('ねえ…')).toBe('nee...')
  })

  it('keeps quotation marks against the quoted words', () => {
    expect(ascii('「さよなら」と言った')).toBe('"sayonara" to itta')
  })

  it('keeps a colon after a credit label', () => {
    expect(ascii('曲:さたぱんp')).toMatch(/^kyoku: /)
  })

  it('keeps Latin text and numbers', () => {
    expect(ascii('HELLO 世界 2024')).toBe('HELLO sekai 2024')
    expect(ascii('(Oh, yeah) 君と')).toBe('(Oh, yeah) kimi to')
  })

  it('gives nothing for text with nothing Japanese in it', () => {
    expect(ascii('Hello there')).toBe('Hello there')
    expect(ascii('')).toBe('')
  })
})
