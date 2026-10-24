import { useEffect, useState } from 'react'
import subsonic from '../../subsonic'

/** External album info (notes); re-fetched when the record is refreshed. */
export const useAlbumInfo = (record) => {
  const [info, setInfo] = useState(null)
  useEffect(() => {
    let alive = true
    subsonic
      .getAlbumInfo(record.id)
      .then((resp) => resp.json['subsonic-response'])
      .then((data) => {
        if (alive && data.status === 'ok') setInfo(data.albumInfo)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [record])
  return info
}
