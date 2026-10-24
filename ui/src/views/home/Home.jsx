import React, { useEffect } from 'react'
import { Redirect } from 'react-router-dom'
import { useGetIdentity, useGetList, useGetOne } from 'react-admin'
import { useT } from '../../i18n/useT'
import { Section, Shelf } from '../../design/Section'
import { Ambient } from '../../design/Ambient'
import { Cover } from '../../design/Cover'
import { Button } from '../../design/Button'
import { PlayIcon, PauseIcon, ShuffleIcon } from '../../design/icons'
import {
  AlbumCard,
  ArtistCard,
  CardSkeletons,
  PlaylistCard,
} from '../shared/Cards'
import {
  useCurrentItem,
  usePlaybackTime,
  useTransport,
} from '../../playback/hooks'
import engine from '../../playback/engine'
import { useCollectionPlayback } from '../../playback/actions'
import { useShell } from '../../shell/useShell'
import { formatClock } from '../../utils/formatters'
import {
  defaultViewPath,
  getStoredDefaultView,
} from '../../personal/defaultViews'
import config from '../../config'
import styles from './Home.module.css'

const SHELF_SIZE = 18

// The "Default View" preference applies once, when the app opens
let initialRedirectDone = false

const greetingKey = () => {
  const h = new Date().getHours()
  if (h < 5) return ['ui.home.greetingNight', 'Good night']
  if (h < 12) return ['ui.home.greetingMorning', 'Good morning']
  if (h < 18) return ['ui.home.greetingAfternoon', 'Good afternoon']
  return ['ui.home.greetingEvening', 'Good evening']
}

const useAlbums = (sort, filter, enabled = true) =>
  useGetList('album', { page: 1, perPage: SHELF_SIZE }, sort, filter, {
    enabled,
  })

const AlbumShelf = ({ id, title, eyebrow, to, list, subtitle }) => {
  const t = useT()
  const { ids, data, loaded } = list
  if (loaded && ids.length === 0) return null
  return (
    <Section
      id={id}
      title={title}
      eyebrow={eyebrow}
      to={to}
      linkLabel={t('ui.home.seeAll', 'See all')}
    >
      <Shelf label={title}>
        {loaded
          ? ids.map(
              (aid) =>
                data[aid] && (
                  <AlbumCard key={aid} record={data[aid]} subtitle={subtitle} />
                ),
            )
          : [<CardSkeletons key="s" count={1} />]}
      </Shelf>
    </Section>
  )
}

const ContinueListening = () => {
  const t = useT()
  const item = useCurrentItem()
  const { paused } = useTransport()
  const { currentTime, duration } = usePlaybackTime()
  const { openNowPlaying } = useShell()
  const song = item?.song
  const { data: album } = useGetOne('album', song?.albumId, {
    enabled: !!song?.albumId && !item?.isRadio,
  })
  if (!item) return null
  const pct = duration > 0 ? (currentTime / duration) * 100 : 0
  return (
    <section className={styles.resume} aria-labelledby="home-resume">
      <Ambient
        thumbHash={album?.thumbHash}
        dominantColor={album?.dominantColor}
        intensity="subtle"
      />
      <button
        type="button"
        className={styles.resumeArt}
        onClick={() => openNowPlaying()}
        aria-label={t('ui.player.openNowPlaying', 'Open Now Playing')}
      >
        <Cover
          record={
            item.isRadio
              ? item.song
              : { ...song, id: item.trackId, album: song?.album || ' ' }
          }
          size={300}
          elevated
        />
      </button>
      <div className={styles.resumeBody}>
        <p className={styles.eyebrow} id="home-resume">
          {paused
            ? t('ui.home.continueListening', 'Continue listening')
            : t('ui.player.nowPlaying', 'Now playing')}
        </p>
        <h2 className={styles.resumeTitle}>{song?.title || item.name}</h2>
        <p className={styles.resumeMeta}>
          {[song?.artist, song?.album].filter(Boolean).join(' · ')}
        </p>
        {!item.isRadio && duration > 0 && (
          <div className={styles.resumeProgress}>
            <div className={styles.track}>
              <div style={{ width: `${pct}%` }} />
            </div>
            <span className="nd-tabular">
              {formatClock(currentTime)} / {formatClock(duration)}
            </span>
          </div>
        )}
        <div className={styles.resumeActions}>
          <Button
            variant="primary"
            icon={paused ? PlayIcon : PauseIcon}
            onClick={() => engine.toggle()}
          >
            {paused
              ? t('ui.home.resume', 'Resume')
              : t('player.clickToPauseText', 'Pause')}
          </Button>
          <Button variant="secondary" onClick={() => openNowPlaying()}>
            {t('ui.player.openNowPlaying', 'Open Now Playing')}
          </Button>
        </div>
      </div>
    </section>
  )
}

const Home = () => {
  const t = useT()
  const { identity } = useGetIdentity()
  const run = useCollectionPlayback()

  const recentlyPlayed = useAlbums(
    { field: 'play_date', order: 'DESC' },
    { recently_played: true },
  )
  const recentlyAdded = useAlbums(
    { field: 'recently_added', order: 'DESC' },
    {},
  )
  const favourites = useAlbums(
    { field: 'starred_at', order: 'DESC' },
    { starred: true },
    config.enableFavourites,
  )
  const mostPlayed = useAlbums(
    { field: 'play_count', order: 'DESC' },
    { recently_played: true },
  )
  const rediscover = useAlbums({ field: 'random', order: 'ASC' }, {})
  const favArtists = useGetList(
    'artist',
    { page: 1, perPage: SHELF_SIZE },
    { field: 'starred_at', order: 'DESC' },
    { starred: true },
    { enabled: config.enableFavourites },
  )
  const playlists = useGetList(
    'playlist',
    { page: 1, perPage: SHELF_SIZE },
    { field: 'updatedAt', order: 'DESC' },
    {},
  )

  useEffect(() => {
    initialRedirectDone = true
  }, [])

  if (!initialRedirectDone) {
    const path = defaultViewPath(getStoredDefaultView())
    if (path) {
      initialRedirectDone = true
      return <Redirect to={path} />
    }
  }

  const [gKey, gFallback] = greetingKey()
  const name = identity?.fullName?.split(' ')[0]
  const everythingEmpty = recentlyAdded.loaded && recentlyAdded.ids.length === 0

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <h1 className={styles.greeting}>
          {t(gKey, gFallback)}
          {name ? <span className={styles.name}>, {name}</span> : null}
        </h1>
        {!everythingEmpty && (
          <Button
            variant="secondary"
            icon={ShuffleIcon}
            onClick={() =>
              run('play', {
                resource: 'song',
                sort: { field: 'random', order: 'ASC' },
                filter: { missing: false },
                perPage: 200,
              })
            }
          >
            {t('ui.home.shuffleLibrary', 'Shuffle library')}
          </Button>
        )}
      </header>

      <ContinueListening />

      {everythingEmpty && (
        <p className={styles.empty}>
          {t(
            'ui.home.emptyLibrary',
            'Your library is empty. Once the scanner finds music, it will appear here.',
          )}
        </p>
      )}

      <AlbumShelf
        id="home-recent-played"
        title={t('resources.album.lists.recentlyPlayed', 'Recently Played')}
        to="/album/recentlyPlayed"
        list={recentlyPlayed}
      />
      <AlbumShelf
        id="home-recent-added"
        title={t('resources.album.lists.recentlyAdded', 'Recently Added')}
        to="/album/recentlyAdded"
        list={recentlyAdded}
      />
      {config.enableFavourites && (
        <AlbumShelf
          id="home-favourites"
          title={t('ui.home.favouriteAlbums', 'Favourite albums')}
          to="/album/starred"
          list={favourites}
        />
      )}
      {config.enableFavourites &&
        favArtists.loaded &&
        favArtists.ids.length > 0 && (
          <Section
            id="home-fav-artists"
            title={t('ui.home.favouriteArtists', 'Favourite artists')}
            to="/favorites"
            linkLabel={t('ui.home.seeAll', 'See all')}
          >
            <Shelf>
              {favArtists.ids.map(
                (id) =>
                  favArtists.data[id] && (
                    <ArtistCard key={id} record={favArtists.data[id]} />
                  ),
              )}
            </Shelf>
          </Section>
        )}
      <AlbumShelf
        id="home-most-played"
        title={t('resources.album.lists.mostPlayed', 'Most Played')}
        to="/album/mostPlayed"
        list={mostPlayed}
      />
      {playlists.loaded && playlists.ids.length > 0 && (
        <Section
          id="home-playlists"
          title={t('menu.playlists', 'Playlists')}
          to="/playlist"
          linkLabel={t('ui.home.seeAll', 'See all')}
        >
          <Shelf>
            {playlists.ids.map((id) => {
              const pls = playlists.data[id]
              return (
                pls && (
                  <PlaylistCard
                    key={id}
                    record={pls}
                    meta={t('ui.count.songs', '%{smart_count} songs', {
                      smart_count: pls.songCount,
                    })}
                  />
                )
              )
            })}
          </Shelf>
        </Section>
      )}
      <AlbumShelf
        id="home-rediscover"
        eyebrow={t('ui.home.fromYourLibrary', 'From your library')}
        title={t('ui.home.rediscover', 'Rediscover')}
        to="/album/random"
        list={rediscover}
        subtitle="artistYear"
      />
    </div>
  )
}

export default Home
