// One romanizer per language, each loaded the first time a song needs it.
// Every loader resolves to a function from a line of text to its romanization.

// CommonJS packages reach the browser bundle as `default`, `default.default`
// or named exports depending on the bundler, so look for the export by shape
const pick = (mod, key) => {
  for (const c of [mod, mod?.default, mod?.default?.default]) {
    try {
      const v = key ? c?.[key] : c
      if (typeof v === 'function') return v
    } catch {
      // a namespace without that export
    }
  }
  throw new Error('romanizer export not found')
}

// The Japanese dictionary (about 17 MB) is fetched the first time a Japanese
// line is romanized, never at startup, and only once. A load that fails is not
// retried for a while, so a missing dictionary does not stall every line.
const DICT = 'kuromoji-dict/'
const DICT_TIMEOUT_MS = 60000
const DICT_RETRY_MS = 30000

let tokenizer = null
let failedAt = 0
const dictionary = () => {
  if (Date.now() - failedAt < DICT_RETRY_MS)
    return Promise.reject(new Error('dictionary unavailable'))
  if (!tokenizer) {
    tokenizer = (async () => {
      const builder = pick(
        await import('kuromoji/build/kuromoji.js'),
        'builder',
      )
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('dictionary timed out')),
          DICT_TIMEOUT_MS,
        )
        builder({ dicPath: new URL(DICT, document.baseURI).pathname }).build(
          (err, t) => {
            clearTimeout(timer)
            return err ? reject(err) : resolve(t)
          },
        )
      })
    })()
    tokenizer.catch(() => {
      tokenizer = null
      failedAt = Date.now()
    })
  }
  return tokenizer
}

// Punctuation the source languages write full-width
const PUNCTUATION = {
  '，': ',',
  '。': '.',
  '、': ',',
  '！': '!',
  '？': '?',
  '：': ':',
  '；': ';',
  '（': '(',
  '）': ')',
  '「': '"',
  '」': '"',
  '『': '"',
  '』': '"',
  '・': ' ',
}
const ascii = (s) =>
  s.replace(/[，。、！？：；（）「」『』・]/g, (c) => PUNCTUATION[c])

const tidy = (s) =>
  ascii(s)
    .replace(/\s+([,.;:!?)])/g, '$1')
    .replace(/([,;:!?])(?=\p{L})/gu, '$1 ')
    .replace(/\s{2,}/g, ' ')
    .trim()

export const loaders = {
  async ja() {
    const { romanizeJapanese, hasKanji } = await import('./japanese')
    const { kanaToRomaji } = await import('./kana')
    const cache = new Map()
    return async (text, { style } = {}) => {
      let tk
      try {
        tk = await dictionary()
      } catch (e) {
        // Without the dictionary kana can still be read, kanji cannot
        if (hasKanji(text)) throw e
        return tidy(kanaToRomaji(text, style))
      }
      return romanizeJapanese(tk, text, { style, cache })
    }
  },
  async zh() {
    const { pinyin } = await import('pinyin-pro')
    return (text) =>
      tidy(pinyin(text, { toneType: 'symbol', nonZh: 'consecutive' }))
  },
  async ko() {
    const convert = pick(await import('hangul-romanization'), 'convert')
    return (text) => tidy(convert(text))
  },
  async el() {
    const transliterate = pick(
      await import('greek-transliteration'),
      'transliterate',
    )
    return (text) => tidy(transliterate(text))
  },
  async ru() {
    const Translit = pick(await import('cyrillic-to-translit-js'))
    const t = new Translit({ preset: 'ru' })
    return (text) => tidy(t.transform(text))
  },
  async uk() {
    const Translit = pick(await import('cyrillic-to-translit-js'))
    const t = new Translit({ preset: 'uk' })
    return (text) => tidy(t.transform(text))
  },
  async ar() {
    const convert = pick(await import('arabic-transliterate'))
    return (text) => tidy(convert(text, 'arabic2latin', 'Arabic'))
  },
}
