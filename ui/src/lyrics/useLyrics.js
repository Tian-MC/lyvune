import { useEffect, useState } from 'react'
import subsonic from '../subsonic'
import { parseLyrics } from './parse'
import { useLyricsSignals } from './lyricsSignals'

// Small session cache: reopening Now Playing never refetches. An entry is only
// good for one version of a track's lyrics; changing them drops it.
const cache = new Map()
const MAX = 50

const load = (id, version) => {
  const key = `${id}:${version}`
  if (cache.has(key)) return cache.get(key)
  const promise = subsonic
    .getLyricsBySongId(id)
    .then((res) => {
      const data = res.json['subsonic-response']
      if (data.status !== 'ok') throw new Error(data.error?.message)
      return parseLyrics(data.lyricsList?.structuredLyrics)
    })
    .catch((e) => {
      cache.delete(key)
      throw e
    })
  cache.set(key, promise)
  if (cache.size > MAX) cache.delete(cache.keys().next().value)
  return promise
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
