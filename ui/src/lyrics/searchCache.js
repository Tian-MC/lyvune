import { lyricsApi } from './manageApi'
import { lyricsVersion } from './lyricsSignals'

// The server keeps a search's results for 15 minutes so one of them can be
// chosen by its ID. The browser keeps them a little less, so a result it shows
// from memory can still be used.
export const SEARCH_TTL_MS = 10 * 60 * 1000
const MAX = 30

// trackId -> { version, at, promise, value }. One entry per track: a search for
// a changed version of a track's lyrics replaces it.
const entries = new Map()

const fresh = (id, e) =>
  !!e && e.version === lyricsVersion(id) && Date.now() - e.at < SEARCH_TTL_MS

/**
 * The results of the last search for a track in this page session, if they
 * are still good: same lyrics as when it ran (a change of the lyrics bumps the
 * version) and recent enough to be used. An empty result counts.
 */
export const peekSearch = (id) => {
  const e = entries.get(id)
  return fresh(id, e) && e.value ? e.value : null
}

/**
 * Searches every provider for a track, once: the same search while one is
 * running, or again within SEARCH_TTL_MS, gets the same answer without asking
 * the server. `refresh` asks again whatever is remembered, unless a search is
 * already on its way. A failure is not remembered.
 */
export const searchLyrics = (id, { refresh = false } = {}) => {
  const e = entries.get(id)
  if (fresh(id, e) && (!refresh || !e.value)) return e.promise
  const entry = { version: lyricsVersion(id), at: Date.now(), value: null }
  entry.promise = lyricsApi.search(id).then(
    (res) => {
      entry.value = {
        candidates: res?.candidates || [],
        providers: res?.providers || [],
      }
      return entry.value
    },
    (err) => {
      if (entries.get(id) === entry) entries.delete(id)
      throw err
    },
  )
  entries.delete(id)
  entries.set(id, entry)
  if (entries.size > MAX) entries.delete(entries.keys().next().value)
  return entry.promise
}

/** Forget a track's search, e.g. when the server no longer has its results. */
export const forgetSearch = (id) => entries.delete(id)
