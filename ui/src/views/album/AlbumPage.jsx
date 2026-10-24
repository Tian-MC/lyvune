import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useDispatch } from 'react-redux'
import { Link } from 'react-router-dom'
import { useGetList, useShowController } from 'react-admin'
import Lightbox from 'react-image-lightbox'
import 'react-image-lightbox/style.css'
import { useT } from '../../i18n/useT'
import { useDateLocale } from '../../i18n/useDateLocale'
import subsonic from '../../subsonic'
import config from '../../config'
import { ArtistLinkField, RatingField, useResourceRefresh } from '../../common'
import { SafeHTML } from '../../common/SafeHTML'
import { formatBytes } from '../../utils'
import { formatDuration2 } from '../../utils/formatters'
import { playTracks, shuffleTracks } from '../../actions'
import { Cover } from '../../design/Cover'
import { Button } from '../../design/Button'
import { IconButton } from '../../design/IconButton'
import { LoveToggle } from '../../design/LoveToggle'
import { EmptyState, Section, Shelf, Skeleton } from '../../design/Section'
import {
  AlbumIcon,
  ExternalIcon,
  PlayIcon,
  ShuffleIcon,
} from '../../design/icons'
import { songQuery, useCollectionPlayback } from '../../playback/actions'
import { albumDateParts } from './albumDates'
import { useAlbumInfo } from './useAlbumInfo'
import { Hero } from '../shared/Hero'
import { TrackList } from '../shared/TrackList'
import { AlbumCard } from '../shared/Cards'
import { CollectionMenu } from '../shared/CollectionMenu'
import { SelectionBar } from '../shared/SelectionBar'
import { useTrackSelection } from '../shared/useTrackSelection'
import { genreAlbumsLink } from '../library/genres'
import styles from './AlbumPage.module.css'

const tag = (record, name) => record?.tags?.[name]?.[0]

const useAlbumDates = (record) => {
  const locale = useDateLocale()
  const t = useT()
  return albumDateParts(record, {
    locale,
    labels: {
      original: t('resources.album.fields.originalDate', 'Original'),
      released: t('resources.album.fields.releaseDate', 'Released'),
    },
  })
}

const DiscHeader = ({ album, record, discs }) => {
  const t = useT()
  const run = useCollectionPlayback()
  const disc = record.discNumber
  const subtitle = record.discSubtitle || discs?.[disc]
  return (
    <div className={styles.disc} role="row">
      <img
        src={subsonic.getDiscCoverArtUrl(album.id, disc, album.updatedAt, 96)}
        alt=""
        loading="lazy"
        className={styles.discArt}
      />
      <div className={styles.discText}>
        <span className={styles.discLabel}>
          {t('resources.song.fields.disc', 'Disc')} {disc}
        </span>
        {subtitle && <span className={styles.discSubtitle}>{subtitle}</span>}
      </div>
      <IconButton
        size="sm"
        icon={PlayIcon}
        label={`${t('resources.album.actions.playAll', 'Play')} — ${t('resources.song.fields.disc', 'Disc')} ${disc}`}
        onClick={() => run('play', songQuery.album(album.id, disc))}
      />
    </div>
  )
}

const MoreByArtist = ({ album }) => {
  const t = useT()
  const { ids, data, loaded } = useGetList(
    'album',
    { page: 1, perPage: 13 },
    { field: 'max_year', order: 'DESC' },
    { artist_id: album.albumArtistId },
    { enabled: !!album.albumArtistId },
  )
  const others = ids.filter((id) => id !== album.id)
  if (!loaded || others.length === 0) return null
  return (
    <Section
      id="album-more"
      title={t('ui.album.moreBy', 'More by %{artist}', {
        artist: album.albumArtist,
      })}
      to={`/artist/${album.albumArtistId}/show`}
      linkLabel={t('ui.home.seeAll', 'See all')}
    >
      <Shelf>
        {others.map(
          (id) =>
            data[id] && (
              <AlbumCard key={id} record={data[id]} subtitle="year" />
            ),
        )}
      </Shelf>
    </Section>
  )
}

const About = ({ album }) => {
  const t = useT()
  const info = useAlbumInfo(album)
  const [expanded, setExpanded] = useState(false)
  const notes = info?.notes || album.notes
  if (!notes && !album.comment) return null
  return (
    <Section id="album-about" title={t('ui.album.about', 'About this album')}>
      <div className={styles.about}>
        {album.comment && <p className={styles.comment}>{album.comment}</p>}
        {notes && (
          <>
            <div className={expanded ? styles.notesOpen : styles.notes}>
              <SafeHTML>{notes}</SafeHTML>
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
          </>
        )}
      </div>
    </Section>
  )
}

const ExternalLinks = ({ album }) => {
  const t = useT()
  if (!config.enableExternalServices) return null
  const links = []
  if (config.lastFMEnabled) {
    links.push({
      key: 'lastfm',
      href: `https://last.fm/music/${encodeURIComponent(album.albumArtist)}/${encodeURIComponent(album.name)}`,
      label: t('message.openIn.lastfm', 'Open in Last.fm'),
    })
  }
  if (album.mbzAlbumId) {
    links.push({
      key: 'mbz',
      href: `https://musicbrainz.org/release/${album.mbzAlbumId}`,
      label: t('message.openIn.musicbrainz', 'Open in MusicBrainz'),
    })
  }
  return links.map((l) => (
    <a
      key={l.key}
      href={l.href}
      target="_blank"
      rel="noopener noreferrer"
      className={styles.external}
    >
      {l.label}
      <ExternalIcon size={13} aria-hidden />
    </a>
  ))
}

const AlbumBody = ({ album }) => {
  const t = useT()
  const dispatch = useDispatch()
  const [lightbox, setLightbox] = useState(false)
  const dates = useAlbumDates(album)
  useResourceRefresh('album', 'song')

  const { ids, data, loaded } = useGetList(
    'song',
    { page: 1, perPage: -1 },
    { field: 'album', order: 'ASC' },
    { album_id: album.id },
  )

  const playable = useMemo(
    () => ids.filter((id) => data[id] && !data[id].missing),
    [ids, data],
  )
  const selection = useTrackSelection(ids)
  const onPlay = useCallback(
    (record) => dispatch(playTracks(data, playable, record.id)),
    [dispatch, data, playable],
  )

  const discNumbers = useMemo(
    () => new Set(ids.map((id) => data[id]?.discNumber || 0)),
    [ids, data],
  )
  const multiDisc = discNumbers.size > 1
  const variousArtists = useMemo(
    () => ids.some((id) => data[id] && data[id].artist !== album.albumArtist),
    [ids, data, album.albumArtist],
  )

  const releaseType = tag(album, 'releasetype')
  const eyebrow = [
    releaseType
      ? releaseType.replace(/^\w/, (c) => c.toUpperCase())
      : t('resources.album.name', 'Album', { smart_count: 1 }),
    album.compilation && t('resources.album.fields.compilation', 'Compilation'),
  ]
    .filter(Boolean)
    .join(' · ')

  const meta = [
    ...dates,
    t('ui.count.songs', '%{smart_count} songs', {
      smart_count: album.songCount,
    }),
    formatDuration2(album.duration),
  ]

  const footer = [
    tag(album, 'recordlabel'),
    tag(album, 'catalognumber') &&
      `${t('resources.album.fields.catalogNum', 'Catalog #')} ${tag(album, 'catalognumber')}`,
    tag(album, 'media'),
    album.size && formatBytes(album.size),
  ].filter(Boolean)

  return (
    <>
      <Hero
        thumbHash={album.thumbHash}
        dominantColor={album.dominantColor}
        eyebrow={eyebrow}
        title={album.name}
        art={
          <button
            type="button"
            className={styles.artButton}
            onClick={() => setLightbox(true)}
            aria-label={t('ui.album.viewArtwork', 'View artwork')}
          >
            <Cover record={album} size={config.uiCoverArtSize} />
          </button>
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
            <LoveToggle record={album} resource="album" size="lg" />
            <CollectionMenu
              resource="album"
              record={album}
              query={songQuery.album(album.id)}
              size="lg"
            />
          </>
        }
      >
        <span className={styles.artists}>
          <ArtistLinkField record={album} source="albumArtist" />
        </span>
        {tag(album, 'albumversion') && (
          <span className={styles.version}>{tag(album, 'albumversion')}</span>
        )}
      </Hero>

      <div className={styles.secondary}>
        {album.genres?.length > 0 && (
          <ul
            className={styles.genres}
            aria-label={t('resources.album.fields.genre', 'Genre')}
          >
            {album.genres.map((g) => (
              <li key={g.id}>
                <Link to={genreAlbumsLink(g.id)} className={styles.genre}>
                  {g.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {config.enableStarRating && (
          <RatingField record={album} resource="album" size="small" />
        )}
        <div className={styles.links}>
          <ExternalLinks album={album} />
        </div>
      </div>

      {album.missing && (
        <p className={styles.missing}>
          {t(
            'ui.album.missing',
            'Some files of this album are missing from the library.',
          )}
        </p>
      )}

      <section
        className={styles.tracks}
        aria-label={t('resources.song.name', 'Songs', { smart_count: 2 })}
      >
        {!loaded ? (
          Array.from({ length: Math.min(album.songCount || 8, 12) }).map(
            (_, i) => <Skeleton key={i} className={styles.rowSkeleton} />,
          )
        ) : ids.length === 0 ? (
          <EmptyState
            icon={AlbumIcon}
            title={t('ui.album.noTracks', 'No tracks available')}
            compact
          />
        ) : (
          <TrackList
            ids={ids}
            data={data}
            columns={[
              'number',
              ...(variousArtists ? ['artist'] : []),
              'love',
              'duration',
              'menu',
            ]}
            onPlay={onPlay}
            selection={selection}
            groupBy={multiDisc ? (r) => r?.discNumber : undefined}
            renderGroup={(r) => (
              <DiscHeader album={album} record={r} discs={album.discs} />
            )}
            label={album.name}
          />
        )}
        {footer.length > 0 && (
          <p className={styles.footer}>{footer.join(' · ')}</p>
        )}
      </section>

      <SelectionBar selection={selection} data={data} />

      <About album={album} />
      <MoreByArtist album={album} />

      {lightbox && (
        <Lightbox
          imagePadding={50}
          animationDuration={200}
          imageTitle={album.name}
          mainSrc={subsonic.getCoverArtUrl(album)}
          onCloseRequest={() => setLightbox(false)}
        />
      )}
    </>
  )
}

const AlbumPage = (props) => {
  const { record } = useShowController(props)
  if (!record) {
    return <div className={styles.loading} aria-busy="true" />
  }
  return <AlbumBody album={record} key={record.id} />
}

export default AlbumPage
