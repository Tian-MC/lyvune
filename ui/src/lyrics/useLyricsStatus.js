import { useCallback, useEffect, useState } from 'react'
import { lyricsApi } from './manageApi'
import { useLyricsSignals } from './lyricsSignals'

/**
 * The lyrics state of a track (`SongStatus` from the API): where the current
 * lyrics come from, local alternatives, lock, offset and history.
 *
 * `reload` fetches it again; `set` takes a status an action already returned.
 */
export const useLyricsStatus = (trackId, enabled = true) => {
  const [state, setState] = useState({ status: 'idle', data: null })
  const { version } = useLyricsSignals(trackId)

  useEffect(() => {
    if (!trackId || !enabled) {
      setState({ status: 'idle', data: null })
      return undefined
    }
    const controller = new AbortController()
    setState((prev) => (prev.data ? prev : { status: 'loading', data: null }))
    lyricsApi
      .status(trackId, { signal: controller.signal })
      .then((data) => setState({ status: 'ready', data }))
      .catch((e) => {
        if (e?.name !== 'AbortError') setState({ status: 'error', data: null })
      })
    return () => controller.abort()
  }, [trackId, enabled, version])

  const set = useCallback((data) => setState({ status: 'ready', data }), [])
  return { ...state, set }
}

export default useLyricsStatus
