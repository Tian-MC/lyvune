// Which writing systems a song uses, so only the matching romanizer is loaded.
const SCRIPTS = {
  kana: /[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9f]/g,
  han: /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g,
  hangul: /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/g,
  greek: /[\u0370-\u03ff\u1f00-\u1fff]/g,
  cyrillic: /[\u0400-\u04ff]/g,
  arabic:
    /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/g,
}

const UKRAINIAN = /[\u0456\u0457\u0454\u0491\u0406\u0407\u0404\u0490]/

/** Number of characters of each script in `text`. */
export const countScripts = (text) => {
  const found = {}
  for (const [name, re] of Object.entries(SCRIPTS)) {
    const n = (text.match(re) || []).length
    if (n) found[name] = n
  }
  return found
}

const langIs = (lang, ...codes) =>
  codes.some((c) => (lang || '').toLowerCase().startsWith(c))

/**
 * Engines a song needs: ja, zh, ko, el, ru, uk, ar. A script has to appear in
 * a few characters and in a real share of the lines, so a stray Greek letter
 * in an English song does not offer a romanization. Han characters alone are
 * Chinese unless the song has kana or says it is Japanese.
 */
export const planFor = (texts, lang, han = 'auto') => {
  const totals = {}
  const lineHits = {}
  let ukrainian = false
  texts.forEach((text) => {
    const found = countScripts(text)
    for (const [name, n] of Object.entries(found)) {
      totals[name] = (totals[name] || 0) + n
      lineHits[name] = (lineHits[name] || 0) + 1
    }
    if (found.cyrillic && UKRAINIAN.test(text)) ukrainian = true
  })
  const real = (name) =>
    (totals[name] || 0) >= 3 &&
    lineHits[name] >= Math.max(1, Math.round(texts.length * 0.1))

  const engines = []
  // The listener's own choice beats everything the song says about itself
  const japanese =
    han === 'ja' ||
    (han === 'auto' &&
      (real('kana') || (real('han') && langIs(lang, 'ja', 'jp'))))
  if (han === 'zh' && real('han')) engines.push('zh')
  else if (japanese && (real('kana') || real('han'))) engines.push('ja')
  else if (real('han')) engines.push('zh')
  if (real('hangul')) engines.push('ko')
  if (real('greek')) engines.push('el')
  if (real('cyrillic'))
    engines.push(ukrainian || langIs(lang, 'uk') ? 'uk' : 'ru')
  if (real('arabic')) engines.push('ar')
  return engines
}

/**
 * Han characters are the one script that is ambiguous: kanji with no kana in
 * the song and no language tag could be Chinese or Japanese.
 */
export const hanIsAmbiguous = (texts, lang) => {
  const all = texts.join('\n')
  const c = countScripts(all)
  return (
    (c.han || 0) >= 3 &&
    !c.kana &&
    !langIs(lang, 'ja', 'jp', 'zh', 'zho', 'chi', 'cmn', 'yue')
  )
}

/** Whether `text` has anything the given engine would change. */
const NEEDS = {
  ja: /[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/,
  zh: /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/,
  ko: /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/,
  el: /[\u0370-\u03ff\u1f00-\u1fff]/,
  ru: /[\u0400-\u04ff]/,
  uk: /[\u0400-\u04ff]/,
  ar: /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/,
}

export const needs = (engine, text) => NEEDS[engine].test(text)
export const hasHan = (text) => NEEDS.zh.test(text)
