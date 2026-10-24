import React, { memo } from 'react'
import clsx from 'clsx'
import { Link } from 'react-router-dom'
import { useDrag } from 'react-dnd'
import { useT } from '../../i18n/useT'
import { Cover } from '../../design/Cover'
import { IconButton } from '../../design/IconButton'
import { useActionMenu } from '../../design/useActionMenu'
import { PlayIcon } from '../../design/icons'
import { DraggableTypes } from '../../consts'
import { songQuery, useCollectionPlayback } from '../../playback/actions'
import { CollectionMenu } from './CollectionMenu'
import styles from './Cards.module.css'

const yearOf = (album) => {
  const y = album.maxYear || album.minYear || album.year
  return y > 0 ? y : null
}

export const AlbumCard = memo(
  ({ record, subtitle = 'artist', className, size = 300 }) => {
    const t = useT()
    const run = useCollectionPlayback()
    const menu = useActionMenu()
    const query = songQuery.album(record.id)
    const [, dragRef] = useDrag(
      () => ({
        type: DraggableTypes.ALBUM,
        item: { albumIds: [record.id] },
        options: { dropEffect: 'copy' },
      }),
      [record.id],
    )
    const to = `/album/${record.id}/show`
    const year = yearOf(record)
    return (
      <article
        className={clsx(styles.card, className)}
        onContextMenu={menu.openAt}
        ref={dragRef}
      >
        <div className={styles.artWrap}>
          <Link to={to} className={styles.artLink} tabIndex={-1} aria-hidden>
            <Cover record={record} size={size} />
          </Link>
          <div className={styles.overlay}>
            <IconButton
              size="md"
              variant="filled"
              icon={PlayIcon}
              iconSize={18}
              className={styles.play}
              label={`${t('resources.album.actions.playAll', 'Play')}: ${record.name}`}
              onClick={(e) => {
                e.preventDefault()
                run('play', query)
              }}
            />
            <CollectionMenu
              resource="album"
              record={record}
              query={query}
              menu={menu}
              size="sm"
              className={styles.more}
            />
          </div>
        </div>
        <Link to={to} className={styles.title} title={record.name}>
          {record.name}
        </Link>
        <p className={styles.subtitle}>
          {subtitle === 'year' ? (
            year || ' '
          ) : (
            <>
              {record.albumArtistId ? (
                <Link
                  to={`/artist/${record.albumArtistId}/show`}
                  className={styles.subLink}
                >
                  {record.albumArtist || record.artist}
                </Link>
              ) : (
                record.albumArtist || record.artist
              )}
              {subtitle === 'artistYear' && year && (
                <span className={styles.meta}> · {year}</span>
              )}
            </>
          )}
        </p>
      </article>
    )
  },
)

AlbumCard.displayName = 'AlbumCard'

export const ArtistCard = memo(({ record, className, meta }) => {
  const menu = useActionMenu()
  const to = `/artist/${record.id}/show`
  return (
    <article
      className={clsx(styles.card, styles.artistCard, className)}
      onContextMenu={menu.openAt}
    >
      <div className={styles.artWrap}>
        <Link to={to} className={styles.artLink} tabIndex={-1} aria-hidden>
          <Cover record={record} size={300} round />
        </Link>
        <div className={clsx(styles.overlay, styles.overlayRound)}>
          <CollectionMenu
            resource="artist"
            record={record}
            query={songQuery.artist(record.id)}
            menu={menu}
            size="sm"
            className={styles.more}
          />
        </div>
      </div>
      <Link
        to={to}
        className={clsx(styles.title, styles.center)}
        title={record.name}
      >
        {record.name}
      </Link>
      {meta && <p className={clsx(styles.subtitle, styles.center)}>{meta}</p>}
    </article>
  )
})

ArtistCard.displayName = 'ArtistCard'

export const PlaylistCard = memo(({ record, className, meta }) => {
  const t = useT()
  const run = useCollectionPlayback()
  const menu = useActionMenu()
  const to = `/playlist/${record.id}/show`
  const query = songQuery.playlist(record.id)
  return (
    <article
      className={clsx(styles.card, className)}
      onContextMenu={menu.openAt}
    >
      <div className={styles.artWrap}>
        <Link to={to} className={styles.artLink} tabIndex={-1} aria-hidden>
          <Cover record={record} size={300} />
        </Link>
        <div className={styles.overlay}>
          <IconButton
            size="md"
            variant="filled"
            icon={PlayIcon}
            iconSize={18}
            className={styles.play}
            label={`${t('resources.album.actions.playAll', 'Play')}: ${record.name}`}
            onClick={(e) => {
              e.preventDefault()
              run('play', query)
            }}
          />
          <CollectionMenu
            resource="playlist"
            record={record}
            query={query}
            menu={menu}
            size="sm"
            className={styles.more}
          />
        </div>
      </div>
      <Link to={to} className={styles.title} title={record.name}>
        {record.name}
      </Link>
      <p className={styles.subtitle}>{meta}</p>
    </article>
  )
})

PlaylistCard.displayName = 'PlaylistCard'

/** Responsive auto-fill grid for cards. */
export const CardGrid = ({ children, className, dense }) => (
  <div className={clsx(styles.grid, dense && styles.gridDense, className)}>
    {children}
  </div>
)

export const CardSkeletons = ({ count = 12, round }) => (
  <>
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className={styles.card} aria-hidden>
        <div
          className={clsx(styles.skeletonArt, round && styles.skeletonRound)}
        />
        <div className={styles.skeletonLine} />
        <div className={clsx(styles.skeletonLine, styles.skeletonShort)} />
      </div>
    ))}
  </>
)
