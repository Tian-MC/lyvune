import React, { useCallback } from 'react'
import { useDispatch } from 'react-redux'
import { Link, useLocation } from 'react-router-dom'
import { useGetList } from 'react-admin'
import clsx from 'clsx'
import { useT } from '../../i18n/useT'
import { EmptyState, PageHeader } from '../../design/Section'
import { Button } from '../../design/Button'
import { HeartIcon, PlayIcon, ShuffleIcon } from '../../design/icons'
import { playTracks, shuffleTracks } from '../../actions'
import { AlbumCard, ArtistCard, CardGrid, CardSkeletons } from '../shared/Cards'
import { TrackList } from '../shared/TrackList'
import { TrackColumnsMenu } from '../shared/TrackColumnsMenu'
import { useTrackColumns } from '../shared/useTrackColumns'
import { SelectionBar } from '../shared/SelectionBar'
import { useTrackSelection } from '../shared/useTrackSelection'
import chrome from './LibraryChrome.module.css'
import styles from './FavoritesPage.module.css'

const DEFAULT_COLUMNS = ['year', 'playCount', 'quality', 'rating']
const TABS = ['songs', 'albums', 'artists']
const starredSort = { field: 'starred_at', order: 'DESC' }

const FavouriteSongs = () => {
  const t = useT()
  const dispatch = useDispatch()
  const { ids, data, loaded } = useGetList(
    'song',
    { page: 1, perPage: 1000 },
    starredSort,
    { starred: true, missing: false },
  )
  const onPlay = useCallback(
    (record) => dispatch(playTracks(data, ids, record.id)),
    [dispatch, data, ids],
  )
  const selection = useTrackSelection(ids)
  const trackColumns = useTrackColumns('favourites', DEFAULT_COLUMNS)
  if (loaded && ids.length === 0) {
    return (
      <EmptyState
        icon={HeartIcon}
        title={t('ui.favourites.noSongs', 'No favourite songs yet')}
      >
        {t(
          'ui.favourites.hint',
          'Tap the heart on anything you love and it will appear here.',
        )}
      </EmptyState>
    )
  }
  return (
    <>
      {loaded && (
        <div className={styles.actions}>
          <Button
            variant="primary"
            icon={PlayIcon}
            onClick={() => dispatch(playTracks(data, ids))}
          >
            {t('resources.album.actions.playAll', 'Play')}
          </Button>
          <Button
            variant="secondary"
            icon={ShuffleIcon}
            onClick={() => dispatch(shuffleTracks(data, ids))}
          >
            {t('resources.album.actions.shuffle', 'Shuffle')}
          </Button>
        </div>
      )}
      <TrackList
        ids={ids}
        data={data}
        columns={['cover', 'artist', 'album', 'love', 'duration', 'menu']}
        onPlay={onPlay}
        selection={selection}
        optional={trackColumns.active}
        columnsMenu={<TrackColumnsMenu columns={trackColumns} />}
        virtualized={ids.length > 100}
        label={t('ui.favourites.songs', 'Favourite songs')}
      />
      <SelectionBar selection={selection} data={data} />
    </>
  )
}

const FavouriteGrid = ({ resource }) => {
  const t = useT()
  const { ids, data, loaded } = useGetList(
    resource,
    { page: 1, perPage: 500 },
    starredSort,
    { starred: true },
  )
  if (loaded && ids.length === 0) {
    return (
      <EmptyState
        icon={HeartIcon}
        title={
          resource === 'album'
            ? t('ui.favourites.noAlbums', 'No favourite albums yet')
            : t('ui.favourites.noArtists', 'No favourite artists yet')
        }
      />
    )
  }
  const Card = resource === 'album' ? AlbumCard : ArtistCard
  return (
    <CardGrid dense={resource === 'artist'}>
      {loaded ? (
        ids.map((id) => data[id] && <Card key={id} record={data[id]} />)
      ) : (
        <CardSkeletons count={12} round={resource === 'artist'} />
      )}
    </CardGrid>
  )
}

const FavoritesPage = () => {
  const t = useT()
  const { search } = useLocation()
  const tab = new URLSearchParams(search).get('tab')
  const active = TABS.includes(tab) ? tab : 'songs'
  const labels = {
    songs: t('resources.song.name', 'Songs', { smart_count: 2 }),
    albums: t('resources.album.name', 'Albums', { smart_count: 2 }),
    artists: t('resources.artist.name', 'Artists', { smart_count: 2 }),
  }
  return (
    <div>
      <PageHeader title={t('ui.nav.favorites', 'Favourites')} />
      <nav
        className={chrome.chips}
        aria-label={t('ui.nav.favorites', 'Favourites')}
      >
        {TABS.map((id) => (
          <Link
            key={id}
            to={`/favorites?tab=${id}`}
            replace
            className={clsx(chrome.chip, id === active && chrome.chipActive)}
            aria-current={id === active ? 'page' : undefined}
          >
            {labels[id]}
          </Link>
        ))}
      </nav>
      <div className={styles.body}>
        {active === 'songs' && <FavouriteSongs />}
        {active === 'albums' && <FavouriteGrid resource="album" />}
        {active === 'artists' && <FavouriteGrid resource="artist" />}
      </div>
    </div>
  )
}

export default FavoritesPage
