import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDispatch } from 'react-redux'
import { useHistory } from 'react-router-dom'
import {
  useDataProvider,
  useGetList,
  useNotify,
  useRefresh,
  useShowController,
} from 'react-admin'
import Lightbox from 'react-image-lightbox'
import 'react-image-lightbox/style.css'
import { useT } from '../../i18n/useT'
import { useDateLocale } from '../../i18n/useDateLocale'
import subsonic from '../../subsonic'
import { httpClient } from '../../dataProvider'
import { REST_URL, M3U_MIME_TYPE } from '../../consts'
import {
  ImageUploadOverlay,
  canChangeTracks,
  isWritable,
  useResourceRefresh,
} from '../../common'
import { formatBytes, formatDuration2 } from '../../utils/formatters'
import { playTracks, shuffleTracks } from '../../actions'
import { Cover } from '../../design/Cover'
import { Button } from '../../design/Button'
import { LoveToggle } from '../../design/LoveToggle'
import { EmptyState, Skeleton } from '../../design/Section'
import {
  ChevronDownIcon,
  ChevronUpIcon,
  DownloadIcon,
  EditIcon,
  EyeIcon,
  PlayIcon,
  PlaylistIcon,
  ShuffleIcon,
  TrashIcon,
} from '../../design/icons'
import { songQuery } from '../../playback/actions'
import { Hero } from '../shared/Hero'
import { TrackList } from '../shared/TrackList'
import { CollectionMenu } from '../shared/CollectionMenu'
import { TrackColumnsMenu } from '../shared/TrackColumnsMenu'
import { useTrackColumns } from '../shared/useTrackColumns'
import { SelectionBar } from '../shared/SelectionBar'
import { useTrackSelection } from '../shared/useTrackSelection'
import styles from './PlaylistPage.module.css'

const DEFAULT_COLUMNS = ['rating', 'quality']

const exportM3U = (record) =>
  httpClient(`${REST_URL}/playlist/${record.id}/tracks`, {
    headers: new Headers({ Accept: M3U_MIME_TYPE }),
  }).then((res) => {
    const blob = new Blob([res.body], { type: M3U_MIME_TYPE })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${record.name}.m3u`
    document.body.appendChild(link)
    link.click()
    link.parentNode.removeChild(link)
  })

const PlaylistBody = ({ playlist }) => {
  const t = useT()
  const dispatch = useDispatch()
  const history = useHistory()
  const notify = useNotify()
  const refresh = useRefresh()
  const dataProvider = useDataProvider()
  const locale = useDateLocale()
  const [lightbox, setLightbox] = useState(false)
  useResourceRefresh('playlistTrack', 'song', 'playlist')

  const writable = isWritable(playlist.ownerId)
  const editable = canChangeTracks(playlist)

  const { ids, data, loaded } = useGetList(
    'playlistTrack',
    { page: 1, perPage: 0 },
    { field: 'id', order: 'ASC' },
    { playlist_id: playlist.id },
  )

  const playable = useMemo(
    () => ids.filter((id) => data[id] && !data[id].missing),
    [ids, data],
  )
  const selection = useTrackSelection(ids)
  const trackColumns = useTrackColumns('playlist', DEFAULT_COLUMNS)

  // Tracks changed elsewhere (another tab, another client): the playlist
  // record is refreshed by SSE, so reload the entries when it changes.
  const seenUpdate = useRef(playlist.updatedAt)
  useEffect(() => {
    if (playlist.updatedAt !== seenUpdate.current) {
      seenUpdate.current = playlist.updatedAt
      refresh()
    }
  }, [playlist.updatedAt, refresh])
  const onPlay = useCallback(
    (record) => dispatch(playTracks(data, playable, record.id)),
    [dispatch, data, playable],
  )

  // Playlist rows are entries whose ids are 1-based positions; the server
  // moves the entry to the position given as `insert_before`
  const move = useCallback(
    (fromIndex, toIndex) =>
      dataProvider
        .update('playlistTrack', {
          id: ids[fromIndex],
          data: { insert_before: ids[toIndex] },
          filter: { playlist_id: playlist.id },
        })
        .then(() => refresh())
        .catch(() => notify('ra.page.error', 'warning')),
    [dataProvider, ids, playlist.id, refresh, notify],
  )

  const onReorder = useCallback(
    (from, to) => {
      if (to < 0 || to >= ids.length || from === to) return
      move(from, to)
    },
    [ids.length, move],
  )

  const remove = useCallback(
    (entryIds) =>
      dataProvider
        .deleteMany(`playlist/${playlist.id}/tracks`, {
          ids: Array.isArray(entryIds) ? entryIds : [entryIds],
        })
        .then(() => refresh())
        .catch(() => notify('ra.page.error', 'warning')),
    [dataProvider, playlist.id, refresh, notify],
  )

  const extraMenuItems = useCallback(
    (record, index) =>
      editable
        ? [
            {
              key: 'moveUp',
              icon: ChevronUpIcon,
              label: t('ui.queue.moveUp', 'Move up'),
              disabled: index === 0,
              onSelect: () => move(index, index - 1),
            },
            {
              key: 'moveDown',
              icon: ChevronDownIcon,
              label: t('ui.queue.moveDown', 'Move down'),
              disabled: index >= ids.length - 1,
              onSelect: () => move(index, index + 1),
            },
            {
              key: 'remove',
              icon: TrashIcon,
              label: t('ui.playlist.removeTrack', 'Remove from this playlist'),
              onSelect: () => remove(record.id),
            },
          ]
        : null,
    [editable, ids.length, move, remove, t],
  )

  const togglePublic = () =>
    dataProvider
      .update('playlist', {
        id: playlist.id,
        data: { ...playlist, public: !playlist.public },
        previousData: playlist,
      })
      .then(() => refresh())
      .catch(() => notify('ra.page.error', 'warning'))

  const manageItems = [
    writable && {
      key: 'edit',
      icon: EditIcon,
      label: t('ra.action.edit', 'Edit'),
      onSelect: () => history.push(`/playlist/${playlist.id}`),
    },
    writable && {
      key: 'public',
      icon: EyeIcon,
      label: playlist.public
        ? t('resources.playlist.actions.makePrivate', 'Make Private')
        : t('resources.playlist.actions.makePublic', 'Make Public'),
      onSelect: togglePublic,
    },
    {
      key: 'export',
      icon: DownloadIcon,
      label: t('resources.playlist.actions.export', 'Export'),
      onSelect: () => exportM3U(playlist),
    },
  ]

  const eyebrow = [
    playlist.rules
      ? t('ui.playlist.smart', 'Smart playlist')
      : t('resources.playlist.name', 'Playlist', { smart_count: 1 }),
    playlist.public && t('resources.playlist.fields.public', 'Public'),
  ]
    .filter(Boolean)
    .join(' · ')

  const meta = [
    !writable && playlist.ownerName,
    t('ui.count.songs', '%{smart_count} songs', {
      smart_count: playlist.songCount || 0,
    }),
    playlist.duration > 0 && formatDuration2(playlist.duration),
    playlist.size > 0 && formatBytes(playlist.size),
    playlist.updatedAt &&
      `${t('resources.playlist.fields.updatedAt', 'Updated')} ${new Date(
        playlist.updatedAt,
      ).toLocaleDateString(locale)}`,
  ].filter(Boolean)

  return (
    <>
      <Hero
        eyebrow={eyebrow}
        title={playlist.name}
        art={
          <div className={styles.art}>
            <button
              type="button"
              className={styles.artButton}
              onClick={() => setLightbox(true)}
              aria-label={t('ui.album.viewArtwork', 'View artwork')}
            >
              <Cover record={playlist} size={600} />
            </button>
            {writable && (
              <ImageUploadOverlay
                entityType="playlist"
                entityId={playlist.id}
                hasUploadedImage={!!playlist.uploadedImage}
              />
            )}
          </div>
        }
        meta={meta.map((m, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span aria-hidden>·</span>}
            <span>{m}</span>
          </React.Fragment>
        ))}
        actions={
          <>
            <Button
              variant="primary"
              size="lg"
              icon={PlayIcon}
              disabled={!playable.length}
              onClick={() => dispatch(playTracks(data, playable))}
            >
              {t('resources.album.actions.playAll', 'Play')}
            </Button>
            <Button
              variant="secondary"
              size="lg"
              icon={ShuffleIcon}
              disabled={!playable.length}
              onClick={() => dispatch(shuffleTracks(data, playable))}
            >
              {t('resources.album.actions.shuffle', 'Shuffle')}
            </Button>
            <LoveToggle record={playlist} resource="playlist" size="lg" />
            <CollectionMenu
              resource="playlist"
              record={playlist}
              query={songQuery.playlist(playlist.id)}
              size="lg"
              extraItems={manageItems}
            />
          </>
        }
      >
        {playlist.comment && (
          <p className={styles.comment}>{playlist.comment}</p>
        )}
      </Hero>

      <section
        className={styles.tracks}
        aria-label={t('resources.song.name', 'Songs', { smart_count: 2 })}
      >
        {!loaded ? (
          Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className={styles.rowSkeleton} />
          ))
        ) : ids.length === 0 ? (
          <EmptyState
            icon={PlaylistIcon}
            title={t('ui.playlist.empty', 'This playlist is empty')}
          >
            {editable &&
              t(
                'ui.playlist.emptyHint',
                'Add songs from any track menu, or drag them onto the playlist in the sidebar.',
              )}
          </EmptyState>
        ) : (
          <TrackList
            ids={ids}
            data={data}
            columns={['index', 'cover', 'album', 'love', 'duration', 'menu']}
            onPlay={onPlay}
            extraMenuItems={extraMenuItems}
            selection={selection}
            optional={trackColumns.active}
            columnsMenu={<TrackColumnsMenu columns={trackColumns} />}
            onReorder={editable ? onReorder : undefined}
            virtualized={ids.length > 100}
            label={playlist.name}
          />
        )}
      </section>

      <SelectionBar
        selection={selection}
        data={data}
        onRemove={editable ? remove : undefined}
        removeLabel={t('ui.playlist.removeTracks', 'Remove from playlist')}
      />

      {lightbox && (
        <Lightbox
          imagePadding={50}
          animationDuration={200}
          imageTitle={playlist.name}
          mainSrc={subsonic.getCoverArtUrl(playlist)}
          onCloseRequest={() => setLightbox(false)}
        />
      )}
    </>
  )
}

const PlaylistPage = (props) => {
  const { record } = useShowController(props)
  if (!record) return <div style={{ minHeight: '60vh' }} aria-busy="true" />
  return <PlaylistBody playlist={record} key={record.id} />
}

export default PlaylistPage
