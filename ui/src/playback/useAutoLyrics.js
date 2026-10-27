import { useEffect } from 'react'
import { lyricsApi } from '../lyrics/manageApi'
import { bumpLyrics, setResolving } from '../lyrics/lyricsSignals'
import { useCurrentItem } from './hooks'

// Skipping through a queue must not search for every track that flashes by
const START_DELAY_MS = 1500
const MAX_REMEMBERED = 500

// Tracks already asked about this session. The server remembers the answer too
// (including "nothing found recently"), so asking again later is cheap.
const asked = new Set()

// When a provider did not answer or asked to slow down, the track is asked
// about again the next time it plays, but not before this (or the wait the
// provider asked for, when longer).
export const TRANSIENT_RETRY_MS = 60 * 1000
const retryAt = new Map()

// "Unavailable" with no explanation is a provider that did not answer; with a
// wait it is a rate limit. Both pass. One with an explanation ("no provider is
// enabled", "the folder is read-only") does not change by asking again.
const transient = (res) =>
  res?.result === 'unavailable' && (!res.message || res.retryAfter > 0)

const askLater = (trackId, waitSeconds = 0) => {
  asked.delete(trackId)
  retryAt.set(
    trackId,
    Date.now() + Math.max(TRANSIENT_RETRY_MS, waitSeconds * 1000),
  )
}

// Fetching lyrics is for administrators only; everyone else just reads what is
// already there. The server refuses anyone else, so this only avoids the call.
const isAdmin = () => localStorage.getItem('role') === 'admin'

/**
 * Asks the server to look for lyrics when a track starts playing: it fills in
 * missing lyrics and, if upgrades are on, looks for better ones. It never
 * delays playback, and the result appears in the lyrics panel by itself.
 * Only runs for administrators.
 */
export const useAutoLyrics = () => {
  const item = useCurrentItem()
  const trackId = item && !item.isRadio ? item.trackId : null

  useEffect(() => {
    if (!trackId || asked.has(trackId) || !isAdmin()) return undefined
    if (Date.now() < (retryAt.get(trackId) ?? 0)) return undefined
    const controller = new AbortController()
    let inFlight = false
    const timer = setTimeout(() => {
      inFlight = true
      asked.add(trackId)
      if (asked.size > MAX_REMEMBERED) asked.clear()
      setResolving(trackId, true)
      lyricsApi
        .resolve(trackId, { signal: controller.signal })
        .then((res) => {
          if (res.result === 'found' || res.result === 'upgraded') {
            bumpLyrics(trackId)
          }
          if (transient(res)) askLater(trackId, res.retryAfter)
          else retryAt.delete(trackId)
        })
        .catch((e) => {
          // Offline or signed out: nothing to show now, ask again on a later play
          if (e?.name !== 'AbortError') askLater(trackId)
        })
        .finally(() => {
          inFlight = false
          setResolving(trackId, false)
        })
    }, START_DELAY_MS)

    return () => {
      clearTimeout(timer)
      if (inFlight) {
        // Left the track mid-search: the server finishes it, so forget that we
        // asked and drop any "no lyrics" that was cached meanwhile
        controller.abort()
        asked.delete(trackId)
        setResolving(trackId, false)
        bumpLyrics(trackId)
      }
    }
  }, [trackId])
}

export default useAutoLyrics
