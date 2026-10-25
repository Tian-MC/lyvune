// Japanese romanization on top of a morphological analyzer (kuromoji).
//
// The analyzer gives readings, not romaji, and its token boundaries are not
// word boundaries: it splits katakana words into pieces, reads a hiragana
// fragment as a particle, and does not know 々. The stages here repair that:
//
//   1. analyze      every line, kana-only ones too
//   2. repair       々, unknown katakana runs, suffix readings
//   3. group        tokens into written words (particles stand alone)
//   4. convert      readings to Hepburn, with long vowels and sokuon
//   5. assemble     spacing and punctuation of the source are kept
//
// `tk` is anything with kuromoji's `tokenize(text)`.
import {
  contractLongVowels,
  kanaToRomaji,
  lengthenLastO,
  toKatakana,
} from './kana'

const KANJI = /[㐀-䶿一-鿿豈-﫿]/
const KATAKANA = /^[ァ-ヺーヽヾ]+$/
const HIRAGANA = /^[ぁ-ゖゝゞー]+$/
const SPACE = /^\s+$/
// Nothing but punctuation and symbols
const NO_WORD = /^[^\p{L}\p{N}\p{M}々ー]+$/u

// Punctuation the source writes full-width, and where it sits against words
const PUNCT = {
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
  '…': '...',
  '‥': '..',
  '〜': '~',
  '～': '~',
  '\u3000': ' ',
}
const OPENING = /^[(「『（]$/
const mark = (s) =>
  s.replace(/[，。、！？：；（）「」『』・…‥〜～\u3000]/g, (c) => PUNCT[c])
const CLOSING = /^[,.!?:;)"~]+$|^\.\.+$/

// The unvoiced counterpart of a voiced kana, for rendaku
const VOICE = {
  か: 'が',
  き: 'ぎ',
  く: 'ぐ',
  け: 'げ',
  こ: 'ご',
  さ: 'ざ',
  し: 'じ',
  す: 'ず',
  せ: 'ぜ',
  そ: 'ぞ',
  た: 'だ',
  ち: 'ぢ',
  つ: 'づ',
  て: 'で',
  と: 'ど',
  は: 'ば',
  ひ: 'び',
  ふ: 'ぶ',
  へ: 'べ',
  ほ: 'ぼ',
}
const UNVOICE = Object.fromEntries(
  Object.entries(VOICE).map(([a, b]) => [b, a]),
)
const VOICED = /[がぎぐげござじずぜぞだぢづでどばびぶべぼ]/

const hira = (s) =>
  s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))

// The sound a particle is written differently from
const PARTICLE_SOUND = { は: 'ワ', へ: 'エ', を: 'オ' }
const SPOKEN = { コンニチハ: 'コンニチワ', コンバンハ: 'コンバンワ' }

// Content words, which a stray single kana may belong to
const CONTENT = new Set(['名詞', '動詞', '形容詞', '副詞'])
// Conjunctive particles written onto the verb or adjective before them
const ATTACHING_PARTICLES = new Set([
  'て',
  'で',
  'ば',
  'ちゃ',
  'ながら',
  'つつ',
])
const COPULA = new Set([
  'だ',
  'です',
  'でし',
  'だっ',
  'じゃ',
  'では',
  'で',
  'だろ',
  'でしょ',
])

const norm = (t) => ({
  s: t.surface_form,
  pos: t.pos,
  d1: t.pos_detail_1,
  reading: t.reading && t.reading !== '*' ? t.reading : null,
  known: t.word_type === 'KNOWN',
})

/** Kana of a token: its dictionary reading, or its own spelling when it has none. */
const kanaOf = (t) => {
  let k = t.reading || t.s
  if (t.pos === '助詞' && PARTICLE_SOUND[t.s]) k = PARTICLE_SOUND[t.s]
  return SPOKEN[k] || k
}

const isKnownWord = (tk, seg, cache) => {
  if (!cache.has(seg)) {
    const t = tk.tokenize(seg)
    cache.set(
      seg,
      t.length === 1 &&
        t[0].surface_form === seg &&
        t[0].word_type === 'KNOWN' &&
        t[0].pos !== '記号',
    )
  }
  return cache.get(seg)
}

/**
 * Cut an unknown katakana run into the words it is made of. A run that
 * repeats ("ギブミーギブミー") is cut into its repeats; otherwise the cheapest
 * cut into dictionary words wins, so one long unknown piece is the worst
 * choice and a known word at either end is taken.
 */
const splitKatakana = (tk, word, cache) => {
  const chars = [...word]
  const n = chars.length
  if (n < 4 || n > 24) return [word]
  for (let size = 2; size <= n / 2; size++) {
    if (n % size === 0 && word === word.slice(0, size).repeat(n / size))
      return Array(n / size).fill(word.slice(0, size))
  }
  const bad = (c) => 'ッャュョァィゥェォー'.includes(c)
  const cost = Array(n + 1).fill(Infinity)
  const cut = Array(n + 1).fill(0)
  cost[0] = 0
  for (let end = 1; end <= n; end++) {
    for (let start = 0; start < end; start++) {
      if (cost[start] === Infinity || bad(chars[start])) continue
      const seg = chars.slice(start, end).join('')
      const len = end - start
      const c =
        len >= 2 && isKnownWord(tk, seg, cache) ? 0.5 : 1 + 0.05 * len * len
      if (cost[start] + c < cost[end]) {
        cost[end] = cost[start] + c
        cut[end] = start
      }
    }
  }
  const out = []
  for (let end = n; end > 0; end = cut[end])
    out.unshift(chars.slice(cut[end], end).join(''))
  return out
}

/** 々 repeats the kanji before it, with rendaku where the sounds allow it. */
const iterationReading = (previous) => {
  if (
    !previous?.reading ||
    [...previous.s].length !== 1 ||
    !KANJI.test(previous.s)
  )
    return null
  const first = hira(previous.reading)
  const lead = first[0]
  // Lyman's law: no rendaku when the repeated word already has a voiced obstruent
  const voiced = VOICE[lead] && !VOICED.test(first)
  const second = voiced ? VOICE[lead] + first.slice(1) : first
  return toKatakana(second)
}

// Does the voicing of the first kana make the only difference between two readings?
const sameButVoicing = (a, b) => {
  const [x, y] = [hira(a), hira(b)]
  if (x.length !== y.length) return false
  const first = (c) => UNVOICE[c] || c
  return first(x[0]) === first(y[0]) && x.slice(1) === y.slice(1)
}

const analyze = (tk, text, cache) => {
  const tokens = tk.tokenize(text).map(norm)
  const out = []
  tokens.forEach((t, i) => {
    const previous = out[out.length - 1]
    if (t.s === '々') {
      const reading = iterationReading(previous)
      if (reading) {
        out.push({ ...t, pos: '名詞', reading, known: true, joinPrev: true })
        return
      }
    }
    // The dictionary reads some single kanji only as a suffix (手 as シュ);
    // after kana it is the plain word unless the suffix differs by rendaku alone
    if (
      t.pos === '名詞' &&
      t.d1 === '接尾' &&
      [...t.s].length === 1 &&
      KANJI.test(t.s) &&
      previous &&
      !KANJI.test(previous.s.slice(-1))
    ) {
      const alone = tk.tokenize(t.s)
      const plain =
        alone.length === 1 && alone[0].reading && alone[0].reading !== '*'
          ? alone[0].reading
          : null
      if (plain && t.reading && !sameButVoicing(t.reading, plain)) {
        out.push({ ...t, reading: plain, d1: '一般' })
        return
      }
    }
    if (!t.known && !t.reading && KATAKANA.test(t.s)) {
      const parts = splitKatakana(tk, t.s, cache)
      if (parts.length > 1) {
        parts.forEach((p) => out.push({ ...t, s: p, reading: p, known: true }))
        return
      }
    }
    out.push(t)
  })
  return out
}

const isKanaOnly = (t) => KATAKANA.test(t.s) || HIRAGANA.test(t.s)

// A short run of kana the analyzer cut into pieces of one letter, one of which
// is a content word, is a single word it could not read: いち+に+ち is いちにち
const brokenRuns = (tokens) => {
  const join = new Set()
  let start = 0
  const flush = (end) => {
    const run = tokens.slice(start, end)
    const letters = run.reduce((n, t) => n + [...t.s].length, 0)
    const singles = run.filter((t) => [...t.s].length === 1)
    if (
      run.length >= 3 &&
      // starting on a particle it is a phrase (の+よ+こ), not one word
      CONTENT.has(run[0].pos) &&
      letters <= 6 &&
      singles.length >= 2 &&
      singles.some((t) => CONTENT.has(t.pos))
    )
      for (let k = start + 1; k < end; k++) join.add(k)
  }
  tokens.forEach((t, i) => {
    if (!isKanaOnly(t) || !HIRAGANA.test(t.s)) {
      flush(i)
      start = i + 1
    }
  })
  flush(tokens.length)
  return join
}

/** For each token: does it belong to the written word before it? */
const grouping = (tokens) => {
  const broken = brokenRuns(tokens)
  return tokens.map((t, i) => {
    if (broken.has(i)) return true
    const p = tokens[i - 1]
    if (!p || SPACE.test(p.s) || SPACE.test(t.s)) return false
    if (t.joinPrev) return true
    if (NO_WORD.test(p.s) || NO_WORD.test(t.s)) return false
    // A sentence-final particle cannot be followed by kana of the same phrase:
    // it is the start of a word the analyzer cut ("よこ顔")
    if (
      p.pos === '助詞' &&
      p.d1 === '終助詞' &&
      isKanaOnly(t) &&
      CONTENT.has(t.pos)
    )
      return true
    if (p.attachNext) return true
    if (p.pos === '接頭詞') return true
    const inflecting =
      ['動詞', '形容詞', '助動詞'].includes(p.pos) ||
      (p.pos === '助詞' && ATTACHING_PARTICLES.has(p.s))
    if (t.pos === '助動詞') return inflecting && !COPULA.has(t.s)
    if (
      (t.pos === '動詞' || t.pos === '形容詞') &&
      (t.d1 === '非自立' || t.d1 === '接尾')
    )
      return inflecting
    if (t.pos === '名詞' && t.d1 === '接尾') return true
    if (t.pos === '助詞')
      return t.d1 === '接続助詞' && ATTACHING_PARTICLES.has(t.s)
    // Pieces of one katakana word: ピン + キー
    if (
      KATAKANA.test(p.s) &&
      KATAKANA.test(t.s) &&
      [...t.s].length <= 2 &&
      [...p.s].length + [...t.s].length <= 6
    )
      return true
    // A lone kana that is part of the kana word next to it: なか + み
    if (
      CONTENT.has(t.pos) &&
      [...t.s].length === 1 &&
      HIRAGANA.test(t.s) &&
      CONTENT.has(p.pos) &&
      isKanaOnly(p)
    )
      return true
    return false
  })
}

const convert = (words, style) => {
  const macron = style === 'macron'
  return words.map((word) => {
    // A sokuon at the end of one token belongs to the sound of the next
    const units = []
    word.forEach((t) => {
      const kana = kanaOf(t)
      const last = units[units.length - 1]
      if (last && last.kana.endsWith('ッ')) {
        last.kana += kana
        last.verbU = t.pos === '動詞' && kana.endsWith('ウ')
      } else {
        units.push({
          kana,
          verbU: t.pos === '動詞' && kana.endsWith('ウ'),
          aux: t.pos === '助動詞' && kana === 'ウ',
        })
      }
    })
    let out = ''
    units.forEach((u) => {
      let r = kanaToRomaji(u.kana, style)
      if (macron) {
        if (u.aux && out.endsWith('o')) {
          out = lengthenLastO(out)
          return
        }
        r = contractLongVowels(r, u.verbU)
      }
      out += r
    })
    return out
  })
}

/**
 * @param {{ tokenize: (text: string) => object[] }} tk
 * @param {string} text one line
 * @param {{ style?: 'macron'|'ascii', cache?: Map }} options
 */
export const romanizeJapanese = (
  tk,
  text,
  { style = 'ascii', cache = new Map() } = {},
) => {
  const tokens = analyze(tk, text, cache)
  // Mark a non-final sentence particle as the start of the word that follows
  tokens.forEach((t, i) => {
    const n = tokens[i + 1]
    if (!n || SPACE.test(n.s) || !isKanaOnly(n) || !CONTENT.has(n.pos)) return
    if (t.pos === '助詞' && t.d1 === '終助詞') t.attachNext = true
    // A lone hiragana that is the start of the kana word after it: め + たい
    else if (
      CONTENT.has(t.pos) &&
      [...t.s].length === 1 &&
      HIRAGANA.test(t.s) &&
      (!tokens[i - 1] ||
        !isKanaOnly(tokens[i - 1]) ||
        !CONTENT.has(tokens[i - 1].pos))
    )
      t.attachNext = true
  })
  const joined = grouping(tokens)
  // Words are runs of tokens; spaces and punctuation are their own entries
  const entries = []
  tokens.forEach((t, i) => {
    if (SPACE.test(t.s)) entries.push({ kind: 'space' })
    else if (NO_WORD.test(t.s))
      entries.push({ kind: 'punct', text: mark(t.s), open: OPENING.test(t.s) })
    else if (
      joined[i] &&
      entries.length &&
      entries[entries.length - 1].kind === 'word'
    )
      entries[entries.length - 1].tokens.push(t)
    else entries.push({ kind: 'word', tokens: [t] })
  })
  const romaji = convert(
    entries.filter((e) => e.kind === 'word').map((e) => e.tokens),
    style,
  )
  let w = 0
  let out = ''
  let spaced = false
  let opened = false
  entries.forEach((e) => {
    if (e.kind === 'space') {
      spaced = true
      return
    }
    const piece = e.kind === 'word' ? romaji[w++] : e.text
    if (!piece) return
    const closing = e.kind === 'punct' && !e.open && CLOSING.test(piece)
    if (out && !closing && !opened) out += ' '
    else if (out && closing && spaced) out += ' '
    out += piece
    opened = e.kind === 'punct' && e.open
    spaced = false
  })
  return out.replace(/\s{2,}/g, ' ').trim()
}

/** Whether a line has kanji, which only the dictionary can read. */
export const hasKanji = (text) => KANJI.test(text)
