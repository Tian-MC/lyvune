import { loaders } from './engines'
import { needs, planFor } from './scripts'

export { planFor }

const ready = new Map()
const load = (engine) => {
  if (!ready.has(engine)) {
    const p = loaders[engine]()
    p.catch(() => ready.delete(engine))
    ready.set(engine, p)
  }
  return ready.get(engine)
}

// Romanized lines by engine, style and text: switching style or coming back to
// a song costs no analysis. Bounded, oldest out first.
const MAX_CACHED = 4000
const cache = new Map()
const remember = (key, value) => {
  cache.delete(key)
  cache.set(key, value)
  if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value)
}

/**
 * Romanize each line of a song. A line with nothing to romanize, or that came
 * out unchanged, gives null. One line failing never loses the others.
 *
 * @param {string[]} texts
 * @param {string[]} engines  from planFor
 * @param {{ style?: 'macron'|'ascii' }} options
 * @returns {Promise<(string|null)[]>}
 */
export const romanizeLines = async (
  texts,
  engines,
  { style = 'ascii' } = {},
) => {
  const fns = await Promise.all(engines.map(load))
  const tag = `${engines.join('+')}|${style}|`
  const out = []
  let tried = 0
  let failed = 0
  for (const text of texts) {
    const key = tag + text
    if (cache.has(key)) {
      out.push(cache.get(key))
      continue
    }
    let current = text
    let ok = true
    for (let i = 0; i < engines.length; i++) {
      if (!current || !needs(engines[i], current)) continue
      tried++
      try {
        current = await fns[i](current, { style })
      } catch {
        failed++
        ok = false
        current = text
        break
      }
    }
    const result = current && current !== text ? current : null
    if (ok) remember(key, result)
    out.push(result)
  }
  // Nothing romanized and every attempt failed: the romanizer itself is broken
  // (a missing dictionary), not the lines. Anything that did work is kept.
  if (tried > 0 && failed === tried && out.every((line) => line === null))
    throw new Error('romanization failed')
  return out
}

/**
 * The romanization of every line, if all of it is already known, so a switch
 * between styles can show the other one in the same frame instead of waiting.
 * @returns {(string|null)[]|null}
 */
export const cachedLines = (texts, engines, { style = 'ascii' } = {}) => {
  const tag = `${engines.join('+')}|${style}|`
  const out = []
  for (const text of texts) {
    const key = tag + text
    if (!cache.has(key)) return null
    out.push(cache.get(key))
  }
  return out
}

/** Forget what was romanized (tests, and a changed dictionary). */
export const clearRomanizationCache = () => cache.clear()
