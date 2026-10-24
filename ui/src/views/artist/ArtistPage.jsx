import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useDispatch } from 'react-redux'
import {
  useDataProvider,
  useGetList,
  useNotify,
  useShowController,
} from 'react-admin'
import Lightbox from 'react-image-lightbox'
import 'react-image-lightbox/style.css'
import { useT } from '../../i18n/useT'
import subsonic from '../../subsonic'
import config from '../../config'
import {
  RatingField,
  ImageUploadOverlay,
  useResourceRefresh,
} from '../../common'
import { SafeHTML } from '../../common/SafeHTML'
import {
  processSongsForPlayback,
  playSimilar,
} from '../../common/playbackActions'
import { playShuffle, playTopSongs } from '../../artist/actions'
import ArtistExternalLinks from '../../artist/ArtistExternalLink'
import { playTracks } from '../../actions'
import { Cover } from '../../design/Cover'
import { Button } from '../../design/Button'
import { LoveToggle } from '../../design/LoveToggle'
import { EmptyState, Section, Shelf } from '../../design/Section'
import { AlbumIcon, PlayIcon, RadioIcon, ShuffleIcon } from '../../design/icons'
import { songQuery } from '../../playback/actions'
import { useArtistInfo } from './useArtistInfo'
import { Hero } from '../shared/Hero'
import { TrackList } from '../shared/TrackList'
import { AlbumCard, ArtistCard, CardGrid, CardSkeletons } from '../shared/Cards'
import { CollectionMenu } from '../shared/CollectionMenu'
import styles from './ArtistPage.module.css'

const TOP_SONGS = 10

const useTopSongs = (name) => {
  const [state, setState] = useState({ loaded: false, data: {}, ids: [] })
  useEffect(() => {
    let alive = true
    subsonic
      .getTopSongs(name, 50)
      .then((res) => res.json['subsonic-response'])
      .then((data) => {
        if (!alive) return
        const songs = data.status === 'ok' ? data.topSongs?.song || [] : []
        const { songData, ids } = processSongsForPlayback(songs)
        setState({ loaded: true, data: songData, ids })
      })
      .catch(() => alive && setState({ loaded: true, data: {}, ids: [] }))
    return () => {
      alive = false
    }
  }, [name])
  return state
}

const TopSongs = ({ artist }) => {
  const t = useT()
  const dispatch = useDispatch()
  const [expanded, setExpanded] = useState(false)
  const { loaded, data, ids } = useTopSongs(artist.name)
  const onPlay = useCallback(
    (record) => dispatch(playTracks(data, ids, record.id)),
    [dispatch, data, ids],
  )
  if (!loaded || ids.length === 0) return null
  const shown = ids.slice(0, expanded ? TOP_SONGS : 5)
  return (
    <Section
      id="artist-top"
      title={t('resources.artist.actions.topSongs', 'Top Songs')}
    >
      <div className={styles.tracks}>
        <TrackList
          ids={shown}
          data={data}
          columns={['index', 'cover', 'album', 'duration', 'menu']}
          onPlay={onPlay}
          label={t('resources.artist.actions.topSongs', 'Top Songs')}
        />
      </div>
      {ids.length > 5 && (
        <button
          type="button"
          className={styles.more}
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
        >
          {expanded
            ? t('ui.actions.showLess', 'Show less')
            : t('ui.actions.showMore', 'Show more')}
        </button>
      )}
    </Section>
  )
}

const Discography = ({ artist }) => {
  const t = useT()
  const { ids, data, loaded } = useGetList(
    'album',
    { page: 1, perPage: 500 },
    { field: 'max_year', order: 'DESC' },
    { artist_id: artist.id },
  )
  const [own, appears] = useMemo(() => {
    const a = []
    const b = []
    ids.forEach((id) => {
      const album = data[id]
      if (!album) return
      const isAlbumArtist =
        album.albumArtistId === artist.id ||
        album.participants?.albumartist?.some((p) => p.id === artist.id)
      ;(isAlbumArtist ? a : b).push(id)
    })
    return [a, b]
  }, [ids, data, artist.id])

  if (!loaded) {
    return (
      <Section
        id="artist-albums"
        title={t('resources.album.name', 'Albums', { smart_count: 2 })}
      >
        <CardGrid>
          <CardSkeletons count={6} />
        </CardGrid>
      </Section>
    )
  }
  if (ids.length === 0) {
    return (
      <EmptyState
        icon={AlbumIcon}
        title={t('ui.library.noAlbums', 'No albums yet')}
        compact
      />
    )
  }
  return (
    <>
      {own.length > 0 && (
        <Section
          id="artist-albums"
          title={t('resources.album.name', 'Albums', { smart_count: 2 })}
        >
          <CardGrid>
            {own.map((id) => (
              <AlbumCard key={id} record={data[id]} subtitle="year" />
            ))}
          </CardGrid>
        </Section>
      )}
      {appears.length > 0 && (
        <Section
          id="artist-appears"
          title={t('ui.artist.appearsOn', 'Appears on')}
        >
          <Shelf>
            {appears.map((id) => (
              <AlbumCard key={id} record={data[id]} subtitle="artistYear" />
            ))}
          </Shelf>
        </Section>
      )}
    </>
  )
}

const About = ({ artist, info }) => {
  const t = useT()
  const [expanded, setExpanded] = useState(false)
  const biography = info?.biography || artist.biography
  if (!biography) return null
  return (
    <Section id="artist-about" title={t('ui.artist.about', 'About')}>
      <div className={styles.about}>
        <div className={expanded ? styles.bioOpen : styles.bio}>
          <SafeHTML>{biography}</SafeHTML>
        </div>
        <button
          type="button"
          className={styles.more}
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
        >
          {expanded
            ? t('ui.actions.showLess', 'Show less')
            : t('ui.actions.showMore', 'Show more')}
        </button>
      </div>
    </Section>
  )
}

const Similar = ({ info }) => {
  const t = useT()
  // Only artists that exist in this library carry an id
  const similar = (info?.similarArtist || []).filter((a) => a.id)
  if (similar.length === 0) return null
  return (
    <Section
      id="artist-similar"
      title={t('ui.artist.similar', 'Similar artists in your library')}
    >
      <Shelf>
        {similar.map((a) => (
          <ArtistCard key={a.id} record={{ id: a.id, name: a.name }} />
        ))}
      </Shelf>
    </Section>
  )
}

const ArtistBody = ({ artist }) => {
  const t = useT()
  const dispatch = useDispatch()
  const notify = useNotify()
  const dataProvider = useDataProvider()
  const info = useArtistInfo(artist)
  const [busy, setBusy] = useState(null)
  const [lightbox, setLightbox] = useState(false)
  useResourceRefresh('artist', 'album')

  const runAction = (key, fn) => async () => {
    setBusy(key)
    try {
      await fn()
    } catch (e) {
      notify('ra.page.error', 'warning')
    } finally {
      setBusy(null)
    }
  }

  // Same behaviour as before: warns when there are no top songs
  const playTop = runAction('top', () =>
    playTopSongs(dispatch, notify, artist.name),
  )

  const albumCount = artist.stats?.maincredit?.albumCount ?? artist.albumCount
  const songCount = artist.stats?.maincredit?.songCount ?? artist.songCount
  const meta = [
    albumCount > 0 &&
      t('ui.count.albums', '%{smart_count} albums', {
        smart_count: albumCount,
      }),
    songCount > 0 &&
      t('ui.count.songs', '%{smart_count} songs', { smart_count: songCount }),
  ].filter(Boolean)

  return (
    <>
      <Hero
        round
        thumbHash={artist.thumbHash}
        dominantColor={artist.dominantColor}
        eyebrow={t('resources.artist.name', 'Artist', { smart_count: 1 })}
        title={artist.name}
        art={
          <div className={styles.art}>
            <button
              type="button"
              className={styles.artButton}
              onClick={() => setLightbox(true)}
              aria-label={t('ui.album.viewArtwork', 'View artwork')}
            >
              <Cover record={artist} size={config.uiCoverArtSize} round />
            </button>
            <ImageUploadOverlay
              entityType="artist"
              entityId={artist.id}
              hasUploadedImage={!!artist.uploadedImage}
            />
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
              disabled={!!busy}
              onClick={playTop}
            >
              {t('resources.artist.actions.topSongs', 'Top Songs')}
            </Button>
            <Button
              variant="secondary"
              size="lg"
              icon={ShuffleIcon}
              disabled={!!busy}
              onClick={runAction('shuffle', () =>
                playShuffle(dataProvider, dispatch, artist.id),
              )}
            >
              {t('resources.artist.actions.shuffle', 'Shuffle')}
            </Button>
            {config.enableExternalServices && (
              <Button
                variant="secondary"
                size="lg"
                icon={RadioIcon}
                disabled={!!busy}
                onClick={runAction('radio', () =>
                  playSimilar(dispatch, notify, artist.id),
                )}
              >
                {t('resources.artist.actions.radio', 'Radio')}
              </Button>
            )}
            <LoveToggle record={artist} resource="artist" size="lg" />
            <CollectionMenu
              resource="artist"
              record={artist}
              query={songQuery.artist(artist.id)}
              size="lg"
            />
          </>
        }
      />

      <div className={styles.secondary}>
        {config.enableStarRating && (
          <RatingField record={artist} resource="artist" size="small" />
        )}
        {config.enableExternalServices && (
          <div className={styles.links}>
            <ArtistExternalLinks artistInfo={info} record={artist} />
          </div>
        )}
      </div>

      <TopSongs artist={artist} />
      <Discography artist={artist} />
      <About artist={artist} info={info} />
      <Similar info={info} />

      {lightbox && (
        <Lightbox
          imagePadding={50}
          animationDuration={200}
          imageTitle={artist.name}
          mainSrc={subsonic.getCoverArtUrl(artist)}
          onCloseRequest={() => setLightbox(false)}
        />
      )}
    </>
  )
}

const ArtistPage = (props) => {
  const { record } = useShowController(props)
  if (!record) return <div style={{ minHeight: '60vh' }} aria-busy="true" />
  return <ArtistBody artist={record} key={record.id} />
}

export default ArtistPage
