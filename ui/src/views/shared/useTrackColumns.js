import { useCallback, useMemo } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { setTrackColumns } from '../../actions'
import { optionalColumnKeys } from './trackColumns'

// Preferences saved by the previous tables, keyed by their resource name
const LEGACY_RESOURCE = {
  album: 'albumSong',
  songs: 'song',
  playlist: 'playlistTrack',
}

/**
 * Which optional columns a tracklist shows. Stored per list in the settings
 * slice; until the user changes something, the choices made in the previous
 * song tables (settings.toggleableFields) are honoured.
 */
export const useTrackColumns = (list, defaults) => {
  const dispatch = useDispatch()
  const stored = useSelector((state) => state.settings.trackColumns?.[list])
  const legacy = useSelector(
    (state) => state.settings.toggleableFields?.[LEGACY_RESOURCE[list]],
  )

  const enabled = useMemo(() => {
    const keys = optionalColumnKeys()
    const on = {}
    keys.forEach((k) => {
      on[k] = stored?.[k] ?? legacy?.[k] ?? defaults.includes(k)
    })
    return on
  }, [stored, legacy, defaults])

  const toggle = useCallback(
    (key) =>
      dispatch(setTrackColumns(list, { ...enabled, [key]: !enabled[key] })),
    [dispatch, list, enabled],
  )

  const active = useMemo(
    () => Object.keys(enabled).filter((k) => enabled[k]),
    [enabled],
  )
  return { enabled, active, toggle }
}
