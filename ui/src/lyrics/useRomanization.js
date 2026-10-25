import { useEffect, useMemo, useState } from 'react'
import { cachedLines, planFor, romanizeLines } from './romanize'
import { hanIsAmbiguous, needs } from './romanize/scripts'

/**
 * Romanization made in the browser for the lines of a song that came without
 * one. It only does anything once `enabled`, so the libraries load when a
 * listener asks. What the provider supplied is always kept as it is; only the
 * lines it left empty (or echoed unchanged) are filled in, and the original
 * text, the timing and the words of the karaoke are never touched.
 *
 * @param {object|null} lyrics  from parseLyrics
 * @param {boolean} enabled
 * @param {{ style?: 'macron'|'ascii', han?: 'auto'|'ja'|'zh' }} options
 * @returns {{ available: boolean, engines: string[], ambiguous: boolean, status: 'idle'|'loading'|'ready'|'error', lyrics: object|null }}
 */
export const useRomanization = (
  lyrics,
  enabled,
  { style = 'ascii', han = 'auto' } = {},
) => {
  const plan = useMemo(() => {
    if (!lyrics) return { engines: [], gaps: [], ambiguous: false }
    const texts = lyrics.lines.map((l) => l.text)
    const engines = planFor(texts, lyrics.lang, han)
    // A provider line that is empty or merely repeats the text is no romanization
    const provided = lyrics.lines.map((l) => {
      const p = (l.pronunciation || '').trim()
      return p && p !== l.text.trim() ? l.pronunciation : null
    })
    const gaps = []
    texts.forEach((text, i) => {
      if (!provided[i] && text.trim() && engines.some((e) => needs(e, text)))
        gaps.push(i)
    })
    return {
      engines,
      gaps,
      provided,
      ambiguous: hanIsAmbiguous(texts, lyrics.lang),
    }
  }, [lyrics, han])

  const available = plan.gaps.length > 0
  const active = available && enabled
  const key = `${plan.engines.join('+')}|${style}`
  const [state, setState] = useState({
    lyrics: null,
    key: '',
    lines: null,
    status: 'idle',
  })

  useEffect(() => {
    if (!active) return undefined
    let stale = false
    setState((s) =>
      s.lyrics === lyrics && s.key === key
        ? s
        : {
            lyrics,
            key,
            lines: s.lyrics === lyrics ? s.lines : null,
            status: 'loading',
          },
    )
    romanizeLines(
      plan.gaps.map((i) => lyrics.lines[i].text),
      plan.engines,
      { style },
    ).then(
      (lines) => !stale && setState({ lyrics, key, lines, status: 'ready' }),
      () => !stale && setState({ lyrics, key, lines: null, status: 'error' }),
    )
    return () => {
      stale = true
    }
  }, [active, lyrics, key, plan, style])

  // What is already known is shown at once; otherwise the previous romanization
  // of the same song stays on screen until the new one is ready, so switching
  // style or reading never blanks the lines in between
  const known = useMemo(
    () =>
      active
        ? cachedLines(
            plan.gaps.map((i) => lyrics.lines[i].text),
            plan.engines,
            { style },
          )
        : null,
    [active, plan, lyrics, style],
  )
  const mine = state.lyrics === lyrics && state.key === key
  const shown = known || (state.lyrics === lyrics ? state.lines : null)
  const merged = useMemo(() => {
    if (!active || !shown) return lyrics
    const generated = new Map(plan.gaps.map((i, n) => [i, shown[n]]))
    const lines = lyrics.lines.map((l, i) => ({
      ...l,
      pronunciation: plan.provided[i] ?? generated.get(i) ?? null,
    }))
    return {
      ...lyrics,
      hasPronunciation: lines.some((l) => l.pronunciation),
      lines,
    }
  }, [active, shown, lyrics, plan])

  return {
    available,
    engines: plan.engines,
    ambiguous: plan.ambiguous,
    status: !active
      ? 'idle'
      : known
        ? 'ready'
        : mine
          ? state.status
          : 'loading',
    lyrics: merged,
  }
}
