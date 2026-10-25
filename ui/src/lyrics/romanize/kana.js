// Kana to Hepburn romaji, written here instead of taken from a library because
// the output has to be controlled in detail: long vowels as macrons or doubled
// letters, a small ィ after チ read as "chii", ティ as "ti", ウィ as "wi", and
// a sokuon that can span two dictionary tokens.

const BASE = {
  ア: 'a',
  イ: 'i',
  ウ: 'u',
  エ: 'e',
  オ: 'o',
  カ: 'ka',
  キ: 'ki',
  ク: 'ku',
  ケ: 'ke',
  コ: 'ko',
  ガ: 'ga',
  ギ: 'gi',
  グ: 'gu',
  ゲ: 'ge',
  ゴ: 'go',
  サ: 'sa',
  シ: 'shi',
  ス: 'su',
  セ: 'se',
  ソ: 'so',
  ザ: 'za',
  ジ: 'ji',
  ズ: 'zu',
  ゼ: 'ze',
  ゾ: 'zo',
  タ: 'ta',
  チ: 'chi',
  ツ: 'tsu',
  テ: 'te',
  ト: 'to',
  ダ: 'da',
  ヂ: 'ji',
  ヅ: 'zu',
  デ: 'de',
  ド: 'do',
  ナ: 'na',
  ニ: 'ni',
  ヌ: 'nu',
  ネ: 'ne',
  ノ: 'no',
  ハ: 'ha',
  ヒ: 'hi',
  フ: 'fu',
  ヘ: 'he',
  ホ: 'ho',
  バ: 'ba',
  ビ: 'bi',
  ブ: 'bu',
  ベ: 'be',
  ボ: 'bo',
  パ: 'pa',
  ピ: 'pi',
  プ: 'pu',
  ペ: 'pe',
  ポ: 'po',
  マ: 'ma',
  ミ: 'mi',
  ム: 'mu',
  メ: 'me',
  モ: 'mo',
  ヤ: 'ya',
  ユ: 'yu',
  ヨ: 'yo',
  ラ: 'ra',
  リ: 'ri',
  ル: 'ru',
  レ: 're',
  ロ: 'ro',
  ワ: 'wa',
  ヰ: 'i',
  ヱ: 'e',
  ヲ: 'o',
  ヴ: 'vu',
  ヵ: 'ka',
  ヶ: 'ke',
}

const SMALL_VOWEL = { ァ: 'a', ィ: 'i', ゥ: 'u', ェ: 'e', ォ: 'o' }
const SMALL_Y = { ャ: 'a', ュ: 'u', ョ: 'o' }
const VOWELS = 'aiueo'
const MACRON = { a: 'ā', i: 'ī', u: 'ū', e: 'ē', o: 'ō' }
const PLAIN = { ā: 'a', ī: 'i', ū: 'u', ē: 'e', ō: 'o' }
// Kana that start a vowel sound, which makes a preceding ン "n'"
const VOWEL_KANA = new Set('アイウエオヤユヨァィゥェォ')

/** Hiragana to katakana by code point; everything else is left alone. */
export const toKatakana = (s) =>
  s.replace(/[ぁ-ゖゝゞ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))

const consonantOf = (romaji) =>
  VOWELS.includes(romaji[romaji.length - 1]) ? romaji.slice(0, -1) : romaji

// A kana followed by a small ャ/ュ/ョ or ァ/ィ/ゥ/ェ/ォ is one syllable
const combine = (base, next) => {
  if (next in SMALL_Y) {
    const v = SMALL_Y[next]
    if (!base.endsWith('i')) return base.slice(0, -1) + 'y' + v
    const c = consonantOf(base)
    return ['sh', 'ch', 'j'].includes(c) ? c + v : c + 'y' + v
  }
  if (next in SMALL_VOWEL) {
    const v = SMALL_VOWEL[next]
    if (base === 'u') return 'w' + v
    if (base === 'i') return v === 'e' ? 'ye' : 'i' + v
    // The same vowel again is a long vowel: チィ is "chii"
    if (base.endsWith(v)) return base + v
    return consonantOf(base) + v
  }
  return null
}

/**
 * @param {string} input hiragana and/or katakana; other characters pass through
 * @param {'macron'|'ascii'} style how long vowels are written
 */
export const kanaToRomaji = (input, style = 'ascii') => {
  const chars = [...toKatakana(input)]
  const macron = style === 'macron'
  let out = ''
  let sokuon = false
  const add = (r) => {
    if (sokuon) {
      if (r.startsWith('ch')) r = 'c' + r
      else if (!VOWELS.includes(r[0]) && /[a-z]/.test(r[0])) r = r[0] + r
      sokuon = false
    }
    out += r
  }
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]
    if (c === 'ッ') {
      sokuon = true
    } else if (c === 'ー') {
      const last = out[out.length - 1]
      const v = last && (PLAIN[last] || (VOWELS.includes(last) ? last : null))
      // ー after a macron changes nothing, and after a non-vowel it is a dash
      if (!v) out += '-'
      else if (!(last in PLAIN))
        out = out.slice(0, -1) + (macron ? MACRON[v] : v + v)
    } else if (c === 'ン') {
      const next = chars[i + 1]
      add(next && VOWEL_KANA.has(next) ? "n'" : 'n')
    } else if (c in BASE) {
      const next = chars[i + 1]
      const merged = next ? combine(BASE[c], next) : null
      if (merged) {
        add(merged)
        i++
      } else {
        add(BASE[c])
      }
    } else if (c in SMALL_VOWEL) {
      add(SMALL_VOWEL[c])
    } else if (c in SMALL_Y) {
      add('y' + SMALL_Y[c])
    } else {
      sokuon = false
      out += c
    }
  }
  return out
}

/**
 * Write long vowels from a hiragana-style reading as macrons: おう/おお → ō,
 * ああ → ā, うう → ū, ええ → ē. A verb's final う is a verb ending, not a
 * lengthening (思う is "omou"), so `keepFinalU` leaves that one alone.
 */
export const contractLongVowels = (romaji, keepFinalU = false) => {
  const squeeze = (s) =>
    s
      .replace(/aa/g, 'ā')
      .replace(/uu/g, 'ū')
      .replace(/ee/g, 'ē')
      .replace(/o[ou]/g, 'ō')
  if (keepFinalU && romaji.endsWith('ou'))
    return squeeze(romaji.slice(0, -1)) + 'u'
  return squeeze(romaji)
}

/** Turn the last "o" into "ō": the volitional う after an o-ending stem. */
export const lengthenLastO = (romaji) => romaji.replace(/o$/, 'ō')
