import { loaders } from './engines'
import { hasHan, needs, planFor } from './scripts'

export { planFor }

const ready = new Map()
const load = (engine) => {
  if (!ready.has(engine)) {
    const p = loaders[engine](hasHan)
    p.catch(() => ready.delete(engine))
    ready.set(engine, p)
  }
  return ready.get(engine)
}

/**
 * Romanize each line of a song. A line with nothing to romanize, or that came
 * out unchanged, gives null. One line failing never loses the others.
 *
 * @param {string[]} texts
 * @param {string[]} engines  from planFor
 * @returns {Promise<(string|null)[]>}
 */
export const romanizeLines = async (texts, engines) => {
  const fns = await Promise.all(engines.map(load))
  const out = []
  let tried = 0
  let failed = 0
  for (const text of texts) {
    let current = text
    for (let i = 0; i < engines.length; i++) {
      if (!current || !needs(engines[i], current)) continue
      tried++
      try {
        current = await fns[i](current)
      } catch {
        failed++
        current = text
        break
      }
    }
    out.push(current && current !== text ? current : null)
  }
  // Every attempt failing means the romanizer itself is broken, not the lines
  if (tried > 0 && failed === tried) throw new Error('romanization failed')
  return out
}
