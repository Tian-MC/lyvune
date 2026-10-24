import { useEffect, useState } from 'react'
import subsonic from '../../subsonic'

/**
 * External artist info (biography, similar artists). Keyed on the record, not
 * its id: a refreshed record must re-fetch, or stale info would keep winning
 * over the new data.
 */
export const useArtistInfo = (record) => {
  const [info, setInfo] = useState(null)
  useEffect(() => {
    let alive = true
    subsonic
      .getArtistInfo(record.id)
      .then((resp) => resp.json['subsonic-response'])
      .then((data) => {
        if (alive && data.status === 'ok') setInfo(data.artistInfo)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [record])
  return info
}
