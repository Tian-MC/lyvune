import { useEffect, useState } from 'react'
import subsonic from '../subsonic'
import { parseLyrics } from './parse'
import { useLyricsSignals } from './lyricsSignals'

// Small session cache: reopening Now Playing never refetches. An entry is only
// good for one version of a track's lyrics; changing them drops it. "No lyrics"
// is remembered too, but only for a few minutes: lyrics can be found meanwhile
// without this browser changing them (another administrator, a library job).
const cache = new Map()
const MAX = 50
export const EMPTY_TTL_MS = 5 * 60 * 1000

const load = (id, version) => {
  const key = `${id}:${version}`
  const hit = cache.get(key)
  if (hit && !(hit.empty && Date.now() - hit.at > EMPTY_TTL_MS)) {
    return hit.promise
  }
  // Older versions of this track's lyrics are never asked for again
  for (const k of cache.keys()) {
    if (k !== key && k.startsWith(`${id}:`)) cache.delete(k)
  }
  const entry = { at: Date.now(), empty: false }
  entry.promise = subsonic
    .getLyricsBySongId(id)
    .then((res) => {
      const data = res.json['subsonic-response']
      if (data.status !== 'ok') throw new Error(data.error?.message)
      const parsed = parseLyrics(data.lyricsList?.structuredLyrics)
      entry.empty = !parsed || parsed.lines.length === 0
      return parsed
    })
    .catch((e) => {
      if (cache.get(key) === entry) cache.delete(key)
      throw e
    })
  cache.delete(key)
  cache.set(key, entry)
  if (cache.size > MAX) cache.delete(cache.keys().next().value)
  return entry.promise
}

/**
 * { status: 'idle'|'loading'|'ready'|'error', lyrics: parsed|null,
 *   searching: boolean }
 *
 * `searching` is true while the server is looking for lyrics for this track
 * online; the lyrics are reloaded by themselves when it finds some.
 */
export const useLyrics = (trackId, enabled = true) => {
  const [state, setState] = useState({ status: 'idle', lyrics: null })
  const { version, resolving } = useLyricsSignals(trackId)
  useEffect(() => {
    if (!trackId || !enabled) {
      setState({ status: 'idle', lyrics: null })
      return undefined
    }
    let alive = true
    setState((prev) =>
      // Keep showing the current lyrics while a changed version loads
      prev.lyrics && prev.trackId === trackId
        ? prev
        : { status: 'loading', lyrics: null },
    )
    load(trackId, version)
      .then((lyrics) => alive && setState({ status: 'ready', lyrics, trackId }))
      .catch(() => alive && setState({ status: 'error', lyrics: null }))
    return () => {
      alive = false
    }
  }, [trackId, enabled, version])
  const empty = !state.lyrics || state.lyrics.lines.length === 0
  return { ...state, searching: resolving && empty }
}
