import { useEffect, useMemo, useState } from 'react'
import { planFor, romanizeLines } from './romanize'

/**
 * Romanization made in the browser for lyrics that came without one. It only
 * does anything once `enabled`, so the libraries load when a listener asks.
 * Whatever the provider supplied is always preferred.
 *
 * @returns {{ available: boolean, status: 'idle'|'loading'|'ready'|'error', lyrics: object }}
 */
export const useRomanization = (lyrics, enabled) => {
  const engines = useMemo(
    () =>
      lyrics && !lyrics.hasPronunciation
        ? planFor(
            lyrics.lines.map((l) => l.text),
            lyrics.lang,
          )
        : [],
    [lyrics],
  )
  const available = engines.length > 0
  const [state, setState] = useState({
    lyrics: null,
    lines: null,
    status: 'idle',
  })
  const active = available && enabled

  useEffect(() => {
    if (!active) return undefined
    let stale = false
    setState((s) =>
      s.lyrics === lyrics ? s : { lyrics, lines: null, status: 'loading' },
    )
    romanizeLines(
      lyrics.lines.map((l) => l.text),
      engines,
    ).then(
      (lines) => !stale && setState({ lyrics, lines, status: 'ready' }),
      () => !stale && setState({ lyrics, lines: null, status: 'error' }),
    )
    return () => {
      stale = true
    }
  }, [active, lyrics, engines])

  const mine = state.lyrics === lyrics
  const merged = useMemo(() => {
    if (!active || !mine || !state.lines) return lyrics
    return {
      ...lyrics,
      hasPronunciation: state.lines.some(Boolean),
      lines: lyrics.lines.map((l, i) => ({
        ...l,
        pronunciation: state.lines[i],
      })),
    }
  }, [active, mine, state.lines, lyrics])

  return {
    available,
    status: !active ? 'idle' : mine ? state.status : 'loading',
    lyrics: merged,
  }
}
