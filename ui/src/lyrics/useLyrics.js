import { useEffect, useState } from 'react'
import subsonic from '../subsonic'
import { parseLyrics } from './parse'

// Small session cache: reopening Now Playing never refetches
const cache = new Map()
const MAX = 50

const load = (id) => {
  if (cache.has(id)) return cache.get(id)
  const promise = subsonic
    .getLyricsBySongId(id)
    .then((res) => {
      const data = res.json['subsonic-response']
      if (data.status !== 'ok') throw new Error(data.error?.message)
      return parseLyrics(data.lyricsList?.structuredLyrics)
    })
    .catch((e) => {
      cache.delete(id)
      throw e
    })
  cache.set(id, promise)
  if (cache.size > MAX) cache.delete(cache.keys().next().value)
  return promise
}

/** { status: 'idle'|'loading'|'ready'|'error', lyrics: parsed|null } */
export const useLyrics = (trackId, enabled = true) => {
  const [state, setState] = useState({ status: 'idle', lyrics: null })
  useEffect(() => {
    if (!trackId || !enabled) {
      setState({ status: 'idle', lyrics: null })
      return undefined
    }
    let alive = true
    setState({ status: 'loading', lyrics: null })
    load(trackId)
      .then((lyrics) => alive && setState({ status: 'ready', lyrics }))
      .catch(() => alive && setState({ status: 'error', lyrics: null }))
    return () => {
      alive = false
    }
  }, [trackId, enabled])
  return state
}
