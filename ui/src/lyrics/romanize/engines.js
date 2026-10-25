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

// The Japanese dictionary is only fetched for lines with kanji; kana alone
// is converted by a small table.
const DICT = 'kuromoji-dict/'
const DICT_TIMEOUT_MS = 60000

let tokenizer = null
const dictionary = () => {
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
    // A failed load may be retried the next time
    tokenizer.catch(() => (tokenizer = null))
  }
  return tokenizer
}

// Particles are read as they are pronounced
const PARTICLE = { は: 'wa', へ: 'e', を: 'o' }
const ATTACHED = new Set(['助動詞'])

/** Romanize Japanese from kuromoji's tokens, words separated by spaces. */
const japanese = (tokens, toRomaji) => {
  let out = ''
  tokens.forEach((t) => {
    const piece =
      t.pos === '助詞' && PARTICLE[t.surface_form]
        ? PARTICLE[t.surface_form]
        : t.reading && t.reading !== '*'
          ? toRomaji(t.reading)
          : toRomaji(t.surface_form)
    const attach =
      ATTACHED.has(t.pos) ||
      ['非自立', '接尾'].includes(t.pos_detail_1) ||
      (t.pos === '助詞' && ['て', 'で'].includes(t.surface_form))
    out += (out && !attach ? ' ' : '') + piece
  })
  return out
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
  async ja(hasHan) {
    const { toRomaji } = await import('wanakana')
    return async (text) => {
      if (!hasHan(text)) return tidy(toRomaji(text))
      const t = await dictionary()
      return tidy(japanese(t.tokenize(text), toRomaji))
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
