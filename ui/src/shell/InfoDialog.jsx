import React from 'react'
import { useSelector } from 'react-redux'
import ExpandInfoDialog from '../dialogs/ExpandInfoDialog'
import AlbumInfo from '../album/AlbumInfo'
import { SongInfo } from '../common'

/** One "Get Info" dialog for the whole app: album or song details. */
export const InfoDialog = () => {
  const record = useSelector((state) => state.expandInfoDialog?.record)
  const isAlbum =
    !!record && record.albumArtist !== undefined && record.title === undefined
  return (
    <ExpandInfoDialog
      title={isAlbum ? 'resources.album.actions.info' : undefined}
      content={isAlbum ? <AlbumInfo /> : <SongInfo />}
    />
  )
}

export default InfoDialog
