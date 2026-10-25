// Word-level karaoke maths. Pure functions: the renderer only applies them.

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * How much of a timed word has been sung at `ms`, 0 to 1.
 *
 * The sweep uses the word's real start and end. A word with no known end is
 * not given an invented duration: it counts as sung once it has started. The
 * same step is used when the listener prefers reduced motion.
 */
export const wordProgress = (ms, start, end, step) => {
  if (step || end == null || end <= start) return ms >= start ? 1 : 0
  if (ms <= start) return 0
  return ms >= end ? 1 : (ms - start) / (end - start)
}

/** Progress for every segment of a line; untimed text follows its neighbour word. */
export const segmentProgress = (words, ms, step) => {
  const out = new Array(words.length).fill(null)
  let previous = null
  words.forEach((w, i) => {
    if (w.start != null) previous = wordProgress(ms, w.start, w.end, step)
    out[i] = previous
  })
  // Text before the first timed word follows the first timed word
  let next = null
  for (let i = words.length - 1; i >= 0; i--) {
    if (out[i] == null) out[i] = next ?? 0
    else next = out[i]
  }
  return out
}
