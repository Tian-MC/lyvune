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
        })
        .catch(() => {
          // Offline, signed out, or the provider is down: nothing to show
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
