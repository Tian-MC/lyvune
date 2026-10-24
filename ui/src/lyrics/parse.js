// Normalises OpenSubsonic `structuredLyrics` into a single model the UI can
// render. Nothing here invents timing: line times come from `line.start`,
// word times only from real `cueLine` cues, translations/romanisations only
// from entries of the matching kind.

// LRC "ID tags" ([ti:Title], [ar:Artist], [by:Creator]…) are metadata about
// the lyrics file, not words to sing; files sometimes carry them as text.
const ID_TAG =
  /^\[(ti|ar|al|au|by|re|ve|tool|length|offset|la|lang|#)\s*:[^\]]*\]$/i

const dropLeadingIdTags = (lines) => {
  let i = 0
  while (i < lines.length && ID_TAG.test(lines[i].text.trim())) i++
  return i ? lines.slice(i) : lines
}

const MAIN = 'main'
const TRANSLATION = 'translation'
const PRONUNCIATION = 'pronunciation'

const kindOf = (l) => (l.kind && l.kind.trim()) || MAIN

const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null
const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null

// Cue byte offsets are UTF-8 byte positions inside the line value
const sliceBytes = (bytes, start, end) =>
  decoder.decode(bytes.slice(Math.max(0, start), Math.max(0, end)))

/**
 * Splits a line into timed word segments using its cues. Text between cues
 * (spaces, punctuation) is kept as untimed segments so the line reads exactly
 * as written.
 */
export const buildWords = (value, cues) => {
  if (!cues || cues.length === 0 || !encoder || !decoder) return null
  const bytes = encoder.encode(value)
  const sorted = [...cues].sort((a, b) => a.byteStart - b.byteStart)
  const words = []
  let cursor = 0
  sorted.forEach((cue, i) => {
    if (cue.byteStart > cursor) {
      words.push({ text: sliceBytes(bytes, cursor, cue.byteStart) })
    }
    const next = sorted[i + 1]
    words.push({
      text: sliceBytes(bytes, cue.byteStart, cue.byteEnd + 1) || cue.value,
      start: cue.start,
      end: cue.end ?? (next ? next.start : undefined),
    })
    cursor = Math.max(cursor, cue.byteEnd + 1)
  })
  if (cursor < bytes.length) {
    words.push({ text: sliceBytes(bytes, cursor, bytes.length) })
  }
  return words
}

const pickMain = (list) => {
  const mains = list.filter((l) => kindOf(l) === MAIN)
  // Prefer synced lyrics, then the one with most lines
  return (
    mains.find((l) => l.synced && l.line?.length) ||
    mains.find((l) => l.line?.length) ||
    null
  )
}

// Companion lines (translation/pronunciation) align by timestamp when both are
// synced, otherwise by position when the line counts match exactly.
const alignCompanion = (main, companion) => {
  if (!companion?.line?.length) return null
  const lines = companion.line
  if (main.synced && companion.synced) {
    const byStart = new Map(lines.map((l) => [l.start, l.value]))
    return main.line.map((l) => byStart.get(l.start) ?? null)
  }
  if (lines.length === main.line.length) {
    return lines.map((l) => l.value)
  }
  return null
}

/**
 * @returns {null | {
 *   synced: boolean, hasWords: boolean, lang: string,
 *   hasTranslation: boolean, hasPronunciation: boolean,
 *   lines: Array<{ start: number|null, text: string, words: Array|null,
 *                  translation: string|null, pronunciation: string|null }>
 * }}
 */
export const parseLyrics = (structuredLyrics) => {
  const list = Array.isArray(structuredLyrics) ? structuredLyrics : []
  const main = pickMain(list)
  if (!main) return null

  const offset = main.offset || 0
  const translation = alignCompanion(
    main,
    list.find((l) => kindOf(l) === TRANSLATION),
  )
  const pronunciation = alignCompanion(
    main,
    list.find((l) => kindOf(l) === PRONUNCIATION),
  )

  // First cue line per index belongs to the main (lead) agent
  const cuesByIndex = new Map()
  ;(main.cueLine || []).forEach((cl) => {
    if (!cuesByIndex.has(cl.index) && cl.cue?.length) {
      cuesByIndex.set(cl.index, cl)
    }
  })

  // OpenSubsonic: a positive offset makes lyrics appear sooner
  const shift = (t) => (t == null ? null : Math.max(0, t - offset))

  const mapped = main.line.map((l, i) => {
    const cueLine = cuesByIndex.get(i)
    let words = null
    if (main.synced && cueLine) {
      const built = buildWords(
        cueLine.value || l.value,
        cueLine.cue.map((c) => ({
          ...c,
          start: shift(c.start),
          end: c.end == null ? undefined : shift(c.end),
        })),
      )
      words = built
    }
    return {
      start: main.synced ? shift(l.start ?? null) : null,
      text: l.value || '',
      words,
      translation: translation ? translation[i] : null,
      pronunciation: pronunciation ? pronunciation[i] : null,
    }
  })

  const lines = dropLeadingIdTags(mapped)

  return {
    synced: !!main.synced && lines.some((l) => l.start != null),
    hasWords: lines.some((l) => l.words),
    lang: main.lang || '',
    hasTranslation: !!translation && translation.some(Boolean),
    hasPronunciation: !!pronunciation && pronunciation.some(Boolean),
    lines,
  }
}

/** Index of the line active at `ms` (binary search), or -1 before the first. */
export const activeLineIndex = (lines, ms) => {
  let lo = 0
  let hi = lines.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const start = lines[mid].start
    if (start != null && start <= ms) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}
