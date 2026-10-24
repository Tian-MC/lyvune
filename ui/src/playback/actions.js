import { useCallback, useMemo, useState } from 'react'
import { useDispatch } from 'react-redux'
import { useHistory } from 'react-router-dom'
import { useDataProvider, useNotify, usePermissions } from 'react-admin'
import {
  addTracks,
  openAddToPlaylist,
  openDownloadMenu,
  openExtendedInfoDialog,
  openShareMenu,
  playNext,
  playTracks,
  setTrack,
  shuffleTracks,
  DOWNLOAD_MENU_ALBUM,
  DOWNLOAD_MENU_ARTIST,
  DOWNLOAD_MENU_PLAY,
  DOWNLOAD_MENU_SONG,
} from '../actions'
import { playSimilar } from '../common/playbackActions'
import { useRefreshMetadata } from '../common/useRefreshMetadata'
import { artistDownloadSize } from '../common/artist'
import { formatBytes } from '../utils'
import { useT } from '../i18n/useT'
import config from '../config'
import {
  AddToQueueIcon,
  AlbumIcon,
  ArtistIcon,
  DownloadIcon,
  InfoIcon,
  MixIcon,
  PlayIcon,
  PlayNextIcon,
  PlaylistIcon,
  PlusIcon,
  RefreshIcon,
  ShareIcon,
  ShuffleIcon,
} from '../design/icons'

// Song queries for collections (same parameters as the previous menus)
export const songQuery = {
  album: (id, discNumber) => ({
    resource: 'song',
    sort: { field: 'album', order: 'ASC' },
    filter: {
      album_id: id,
      ...(discNumber !== undefined && { disc_number: discNumber }),
      missing: false,
    },
    perPage: -1,
  }),
  artist: (id) => ({
    resource: 'song',
    sort: { field: 'album', order: 'ASC' },
    filter: { album_artist_id: id, missing: false },
    perPage: 200,
  }),
  playlist: (id) => ({
    resource: 'playlistTrack',
    sort: { field: 'id', order: 'ASC' },
    filter: { playlist_id: id },
    perPage: 0,
  }),
  genre: (id) => ({
    resource: 'song',
    sort: { field: 'random', order: 'ASC' },
    filter: { genre_id: id, missing: false },
    perPage: 500,
  }),
}

export const fetchSongs = (dataProvider, query) =>
  dataProvider
    .getList(query.resource || 'song', {
      pagination: { page: 1, perPage: query.perPage ?? -1 },
      sort: query.sort || { field: 'album', order: 'ASC' },
      filter: query.filter,
    })
    .then((response) => {
      const data = {}
      const ids = []
      response.data.forEach((r) => {
        data[r.id] = r
        ids.push(r.id)
      })
      return { data, ids }
    })

const creators = {
  play: playTracks,
  shuffle: shuffleTracks,
  playNext,
  addToQueue: addTracks,
}

/** Fetches a collection's songs and hands them to the queue. */
export const useCollectionPlayback = () => {
  const dataProvider = useDataProvider()
  const dispatch = useDispatch()
  const notify = useNotify()
  return useCallback(
    (kind, query) =>
      fetchSongs(dataProvider, query)
        .then(({ data, ids }) => {
          if (ids.length) dispatch(creators[kind](data, ids))
          return ids
        })
        .catch(() => notify('ra.page.error', 'warning')),
    [dataProvider, dispatch, notify],
  )
}

/** Menu items for a single track (songs, album tracks, playlist tracks). */
export const useSongMenuItems = (record, { onAddToPlaylist } = {}) => {
  const t = useT()
  const dispatch = useDispatch()
  const history = useHistory()
  const notify = useNotify()
  const dataProvider = useDataProvider()
  const { permissions } = usePermissions()
  const [playlists, setPlaylists] = useState(null)

  const songId = record?.mediaFileId || record?.id

  // Loaded when the menu opens ("Show in playlist" submenu)
  const loadPlaylists = useCallback(() => {
    if (playlists || !songId) return
    dataProvider
      .getPlaylists(songId)
      .then((res) => setPlaylists(res.data || []))
      .catch(() => setPlaylists([]))
  }, [dataProvider, playlists, songId])

  const items = useMemo(() => {
    if (!record) return []
    return [
      {
        key: 'playNow',
        icon: PlayIcon,
        label: t('resources.song.actions.playNow', 'Play Now'),
        onSelect: () => dispatch(setTrack(record)),
      },
      {
        key: 'playNext',
        icon: PlayNextIcon,
        label: t('resources.song.actions.playNext', 'Play Next'),
        onSelect: () => dispatch(playNext({ [record.id]: record })),
      },
      {
        key: 'addToQueue',
        icon: AddToQueueIcon,
        label: t('resources.song.actions.addToQueue', 'Play Later'),
        onSelect: () => dispatch(addTracks({ [record.id]: record })),
      },
      config.enableExternalServices && {
        key: 'instantMix',
        icon: MixIcon,
        label: t('resources.song.actions.instantMix', 'Instant Mix'),
        onSelect: async () => {
          notify('message.startingInstantMix', { type: 'info' })
          try {
            await playSimilar(dispatch, notify, songId, {
              seedRecord: record,
              shuffle: false,
            })
          } catch (e) {
            notify('ra.page.error', { type: 'warning' })
          }
        },
      },
      { key: 'd1', divider: true },
      {
        key: 'addToPlaylist',
        icon: PlusIcon,
        label: t('resources.song.actions.addToPlaylist', 'Add to Playlist'),
        onSelect: () =>
          dispatch(
            openAddToPlaylist({
              selectedIds: [songId],
              onSuccess: (id) => onAddToPlaylist && onAddToPlaylist(id),
            }),
          ),
      },
      {
        key: 'showInPlaylist',
        icon: PlaylistIcon,
        label: t('resources.song.actions.showInPlaylist', 'Show in Playlist'),
        disabled: !playlists || playlists.length === 0,
        submenu: (playlists || []).map((p) => ({
          key: p.id,
          label: p.name,
          onSelect: () => history.push(`/playlist/${p.id}/show`),
        })),
      },
      record.albumId && {
        key: 'goToAlbum',
        icon: AlbumIcon,
        label: t('ui.actions.goToAlbum', 'Go to album'),
        onSelect: () => history.push(`/album/${record.albumId}/show`),
      },
      record.artistId && {
        key: 'goToArtist',
        icon: ArtistIcon,
        label: t('ui.actions.goToArtist', 'Go to artist'),
        onSelect: () => history.push(`/artist/${record.artistId}/show`),
      },
      { key: 'd2', divider: true },
      config.enableSharing && {
        key: 'share',
        icon: ShareIcon,
        label: t('ra.action.share', 'Share'),
        onSelect: () => dispatch(openShareMenu([songId], 'song', record.title)),
      },
      config.enableDownloads && {
        key: 'download',
        icon: DownloadIcon,
        label: `${t('ra.action.download', 'Download')} (${formatBytes(record.size || 0)})`,
        onSelect: () => dispatch(openDownloadMenu(record, DOWNLOAD_MENU_SONG)),
      },
      {
        key: 'info',
        icon: InfoIcon,
        label: t('resources.song.actions.info', 'Get Info'),
        onSelect: async () => {
          let fullRecord = record
          if (permissions === 'admin' && !record.missing) {
            try {
              const data = await dataProvider.inspect(songId)
              fullRecord = { ...record, rawTags: data.data.rawTags }
            } catch (error) {
              notify(
                t('ra.notification.http_error', 'Error') + ': ' + error.message,
                { type: 'warning', multiLine: true, duration: 0 },
              )
            }
          }
          dispatch(openExtendedInfoDialog(fullRecord))
        },
      },
    ].filter(Boolean)
  }, [
    record,
    songId,
    t,
    dispatch,
    history,
    notify,
    dataProvider,
    permissions,
    playlists,
    onAddToPlaylist,
  ])

  return { items, onOpen: loadPlaylists }
}

/** Menu items for albums, artists and playlists. */
export const useCollectionMenuItems = (resource, record, query) => {
  const t = useT()
  const dispatch = useDispatch()
  const { permissions } = usePermissions()
  const refreshMetadata = useRefreshMetadata()
  const runPlayback = useCollectionPlayback()
  const dataProvider = useDataProvider()
  const notify = useNotify()

  return useMemo(() => {
    if (!record) return []
    const isArtist = resource === 'artist'
    const isPlaylist = resource === 'playlist'
    const downloadSize = isArtist ? artistDownloadSize(record) : record.size
    const label = (key, fallback) =>
      t(`resources.album.actions.${key}`, fallback)
    return [
      {
        key: 'play',
        icon: PlayIcon,
        label: label('playAll', 'Play'),
        onSelect: () => runPlayback('play', query),
      },
      {
        key: 'shuffle',
        icon: ShuffleIcon,
        label: label('shuffle', 'Shuffle'),
        onSelect: () => runPlayback('shuffle', query),
      },
      {
        key: 'playNext',
        icon: PlayNextIcon,
        label: label('playNext', 'Play Next'),
        onSelect: () => runPlayback('playNext', query),
      },
      {
        key: 'addToQueue',
        icon: AddToQueueIcon,
        label: label('addToQueue', 'Play Later'),
        onSelect: () => runPlayback('addToQueue', query),
      },
      { key: 'd1', divider: true },
      {
        key: 'addToPlaylist',
        icon: PlusIcon,
        label: label('addToPlaylist', 'Add to Playlist'),
        onSelect: () =>
          fetchSongs(dataProvider, query)
            .then(({ data, ids }) =>
              dispatch(
                openAddToPlaylist({
                  selectedIds: ids.map((id) => data[id].mediaFileId || id),
                }),
              ),
            )
            .catch(() => notify('ra.page.error', 'warning')),
      },
      config.enableSharing &&
        (!isArtist || downloadSize) && {
          key: 'share',
          icon: ShareIcon,
          label: t('ra.action.share', 'Share'),
          onSelect: () =>
            dispatch(openShareMenu([record.id], resource, record.name)),
        },
      config.enableDownloads &&
        downloadSize && {
          key: 'download',
          icon: DownloadIcon,
          label: `${t('ra.action.download', 'Download')} (${formatBytes(downloadSize)})`,
          onSelect: () =>
            dispatch(
              openDownloadMenu(
                record,
                isPlaylist
                  ? DOWNLOAD_MENU_PLAY
                  : isArtist
                    ? DOWNLOAD_MENU_ARTIST
                    : DOWNLOAD_MENU_ALBUM,
              ),
            ),
        },
      permissions === 'admin' &&
        (resource === 'album' || isArtist) && {
          key: 'refresh',
          icon: RefreshIcon,
          label: label('refresh', 'Refresh Metadata'),
          onSelect: () => refreshMetadata(resource, record.id),
        },
      resource === 'album' && {
        key: 'info',
        icon: InfoIcon,
        label: label('info', 'Get Info'),
        onSelect: () => dispatch(openExtendedInfoDialog(record)),
      },
    ].filter(Boolean)
  }, [
    resource,
    record,
    query,
    t,
    dispatch,
    permissions,
    refreshMetadata,
    runPlayback,
    dataProvider,
    notify,
  ])
}
