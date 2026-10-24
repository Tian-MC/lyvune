import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useDispatch } from 'react-redux'
import { Link, useHistory, useLocation } from 'react-router-dom'
import { useGetList } from 'react-admin'
import { useT } from '../../i18n/useT'
import { EmptyState, PageHeader, Section } from '../../design/Section'
import { Cover } from '../../design/Cover'
import { SearchIcon, CloseIcon } from '../../design/icons'
import { playTracks } from '../../actions'
import { AlbumCard, ArtistCard, CardGrid, CardSkeletons } from '../shared/Cards'
import { TrackList } from '../shared/TrackList'
import { GenreTiles } from '../library/GenresPage'
import { useGenres } from '../library/genres'
import config from '../../config'
import styles from './SearchPage.module.css'

const ARTISTS = 12
const ALBUMS = 18
const SONGS = 30

const nameSort = { field: 'name', order: 'ASC' }

/** Inline field for phones, where the top bar has no search box. */
const MobileSearchField = ({ query }) => {
  const t = useT()
  const history = useHistory()
  const [value, setValue] = useState(query)
  const ref = useRef(null)
  useEffect(() => setValue(query), [query])
  useEffect(() => {
    if (value === query) return undefined
    const timer = setTimeout(
      () =>
        history.replace(
          `/search${value ? `?q=${encodeURIComponent(value)}` : ''}`,
        ),
      config.uiSearchDebounceMs || 200,
    )
    return () => clearTimeout(timer)
  }, [value, query, history])
  const label = t('ui.search.placeholder', 'Search your library')
  return (
    <div className={styles.mobileField} role="search">
      <SearchIcon size={18} aria-hidden className={styles.mobileIcon} />
      <input
        ref={ref}
        type="search"
        value={value}
        placeholder={label}
        aria-label={label}
        onChange={(e) => setValue(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
      />
      {value && (
        <button
          type="button"
          aria-label={t('ra.action.clear_input_value', 'Clear')}
          onClick={() => {
            setValue('')
            ref.current?.focus()
          }}
        >
          <CloseIcon size={16} aria-hidden />
        </button>
      )}
    </div>
  )
}

const TopResult = ({ artist, album }) => {
  const t = useT()
  const record = artist || album
  if (!record) return null
  const to = artist ? `/artist/${artist.id}/show` : `/album/${album.id}/show`
  return (
    <Link to={to} className={styles.top}>
      <div className={styles.topArt}>
        <Cover record={record} size={300} round={!!artist} />
      </div>
      <div className={styles.topBody}>
        <span className={styles.topName}>{record.name}</span>
        <span className={styles.topKind}>
          {artist
            ? t('resources.artist.name', 'Artist', { smart_count: 1 })
            : `${t('resources.album.name', 'Album', { smart_count: 1 })} · ${album.albumArtist}`}
        </span>
      </div>
    </Link>
  )
}

const Results = ({ q }) => {
  const t = useT()
  const dispatch = useDispatch()
  const artists = useGetList(
    'artist',
    { page: 1, perPage: ARTISTS },
    nameSort,
    { name: q },
  )
  const albums = useGetList('album', { page: 1, perPage: ALBUMS }, nameSort, {
    name: q,
  })
  const songs = useGetList(
    'song',
    { page: 1, perPage: SONGS },
    { field: 'title', order: 'ASC' },
    { title: q, missing: false },
  )
  const onPlay = useCallback(
    (record) => dispatch(playTracks(songs.data, songs.ids, record.id)),
    [dispatch, songs.data, songs.ids],
  )

  const loaded = artists.loaded && albums.loaded && songs.loaded
  const none =
    loaded && !artists.ids.length && !albums.ids.length && !songs.ids.length
  if (none) {
    return (
      <EmptyState
        icon={SearchIcon}
        title={t('ui.search.noResults', 'No results for “%{q}”', { q })}
      >
        {t('ui.search.noResultsHint', 'Check the spelling or try fewer words.')}
      </EmptyState>
    )
  }

  const lower = q.trim().toLowerCase()
  const artistList = artists.ids.map((id) => artists.data[id]).filter(Boolean)
  const topArtist =
    artistList.find((a) => a.name?.toLowerCase() === lower) ||
    artistList.find((a) => a.name?.toLowerCase().startsWith(lower)) ||
    null
  const topAlbum =
    !topArtist && albums.ids.length ? albums.data[albums.ids[0]] : null

  return (
    <div aria-live="polite">
      {(topArtist || topAlbum || songs.ids.length > 0) && (
        <div className={styles.lead}>
          {(topArtist || topAlbum) && (
            <section className={styles.leadTop} aria-labelledby="search-top">
              <h2 className={styles.heading} id="search-top">
                {t('ui.search.topResult', 'Top result')}
              </h2>
              <TopResult artist={topArtist} album={topAlbum} />
            </section>
          )}
          {songs.ids.length > 0 && (
            <section
              className={styles.leadSongs}
              aria-labelledby="search-songs"
            >
              <h2 className={styles.heading} id="search-songs">
                {t('resources.song.name', 'Songs', { smart_count: 2 })}
              </h2>
              <TrackList
                ids={songs.ids.slice(0, 6)}
                data={songs.data}
                columns={['cover', 'artist', 'love', 'duration', 'menu']}
                onPlay={onPlay}
                label={t('resources.song.name', 'Songs', { smart_count: 2 })}
              />
            </section>
          )}
        </div>
      )}

      {artists.ids.length > 0 && (
        <Section
          id="search-artists"
          title={t('resources.artist.name', 'Artists', { smart_count: 2 })}
        >
          <CardGrid dense>
            {artists.ids.map(
              (id) =>
                artists.data[id] && (
                  <ArtistCard key={id} record={artists.data[id]} />
                ),
            )}
          </CardGrid>
        </Section>
      )}
      {albums.ids.length > 0 && (
        <Section
          id="search-albums"
          title={t('resources.album.name', 'Albums', { smart_count: 2 })}
        >
          <CardGrid>
            {albums.ids.map(
              (id) =>
                albums.data[id] && (
                  <AlbumCard
                    key={id}
                    record={albums.data[id]}
                    subtitle="artistYear"
                  />
                ),
            )}
          </CardGrid>
        </Section>
      )}
      {songs.ids.length > 6 && (
        <Section
          id="search-more-songs"
          title={t('ui.search.moreSongs', 'More songs')}
        >
          <TrackList
            ids={songs.ids.slice(6)}
            data={songs.data}
            columns={['cover', 'artist', 'album', 'love', 'duration', 'menu']}
            onPlay={onPlay}
          />
        </Section>
      )}
      {!loaded && (
        <CardGrid>
          <CardSkeletons count={6} />
        </CardGrid>
      )}
    </div>
  )
}

const Browse = () => {
  const t = useT()
  const genres = useGenres()
  if (genres.loaded && genres.ids.length === 0) {
    return (
      <EmptyState
        icon={SearchIcon}
        title={t('ui.search.prompt', 'Find artists, albums and songs')}
      />
    )
  }
  return (
    <Section
      id="search-browse"
      title={t('ui.search.browseGenres', 'Browse by genre')}
    >
      <GenreTiles {...genres} />
    </Section>
  )
}

const SearchPage = () => {
  const t = useT()
  const { search } = useLocation()
  const q = (new URLSearchParams(search).get('q') || '').trim()
  return (
    <div>
      <PageHeader
        title={
          q
            ? t('ui.search.resultsFor', 'Results for “%{q}”', { q })
            : t('ui.nav.search', 'Search')
        }
      />
      <MobileSearchField query={q} />
      {q ? <Results q={q} /> : <Browse />}
    </div>
  )
}

export default SearchPage
