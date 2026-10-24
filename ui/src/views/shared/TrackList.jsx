import React, { memo, useCallback } from 'react'
import clsx from 'clsx'
import { Link } from 'react-router-dom'
import { useSelector } from 'react-redux'
import { useDrag } from 'react-dnd'
import { Virtuoso } from 'react-virtuoso'
import { useT } from '../../i18n/useT'
import { Artwork } from '../../common/Artwork'
import { LoveToggle } from '../../design/LoveToggle'
import { PlayingBars } from '../../design/Section'
import { useActionMenu } from '../../design/useActionMenu'
import { AlertIcon, PlayIcon, PauseIcon } from '../../design/icons'
import { DraggableTypes } from '../../consts'
import { formatClock } from '../../utils/formatters'
import { selectCurrentItem } from '../../reducers/playerReducer'
import { useTransport } from '../../playback/hooks'
import engine from '../../playback/engine'
import { MenuTrigger, SongMenuPopup } from './CollectionMenu'
import styles from './TrackList.module.css'

const songIdOf = (r) => r.mediaFileId || r.id

/**
 * Columns: 'number' (track number), 'index' (position), 'cover',
 * 'artist' (under the title), 'album', 'duration', 'plays', 'love', 'menu'.
 */
const TrackRow = memo(
  ({
    record,
    position,
    columns,
    isCurrent,
    isPlaying,
    onPlay,
    onAddToPlaylist,
    extraMenuItems,
  }) => {
    const t = useT()
    const menu = useActionMenu()
    const [, dragRef] = useDrag(
      () => ({
        type: DraggableTypes.SONG,
        item: { ids: [songIdOf(record)] },
        options: { dropEffect: 'copy' },
      }),
      [record],
    )
    const missing = !!record.missing
    const has = (c) => columns.includes(c)
    const number =
      has('number') && record.trackNumber ? record.trackNumber : position + 1

    const play = () => !missing && onPlay && onPlay(record)
    const togglePlay = (e) => {
      e.stopPropagation()
      if (isCurrent) engine.toggle()
      else play()
    }

    return (
      <div
        ref={dragRef}
        role="row"
        className={clsx(
          styles.row,
          isCurrent && styles.current,
          missing && styles.missing,
          menu.state && styles.menuOpen,
        )}
        onDoubleClick={play}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.target === e.currentTarget) play()
        }}
        onContextMenu={menu.openAt}
        tabIndex={0}
        aria-current={isCurrent ? 'true' : undefined}
      >
        <div className={styles.lead} role="cell">
          {has('cover') ? (
            <div className={styles.coverWrap}>
              <Artwork
                record={{
                  ...record,
                  id: songIdOf(record),
                  album: record.album || ' ',
                }}
                size={96}
                className={styles.cover}
              />
              {isCurrent && (
                <span className={styles.coverPlaying}>
                  <PlayingBars playing={isPlaying} />
                </span>
              )}
            </div>
          ) : isCurrent ? (
            <PlayingBars
              playing={isPlaying}
              className={styles.bars}
              label={t('ui.player.nowPlaying', 'Now playing')}
            />
          ) : (
            <span className={clsx(styles.number, 'nd-tabular')}>{number}</span>
          )}
          {!missing && (
            <button
              type="button"
              className={styles.rowPlay}
              aria-label={
                isCurrent && isPlaying
                  ? t('player.clickToPauseText', 'Pause')
                  : `${t('player.clickToPlayText', 'Play')}: ${record.title}`
              }
              onClick={togglePlay}
              tabIndex={-1}
            >
              {isCurrent && isPlaying ? (
                <PauseIcon size={15} fill="currentColor" />
              ) : (
                <PlayIcon size={15} fill="currentColor" />
              )}
            </button>
          )}
        </div>

        <div className={styles.main} role="cell">
          <span className={styles.title} title={record.title}>
            {record.title}
            {missing && (
              <AlertIcon
                size={14}
                className={styles.missingIcon}
                aria-label={t('ui.track.missing', 'Missing file')}
              />
            )}
          </span>
          {has('artist') && (
            <span className={styles.artist}>
              {record.artistId ? (
                <Link
                  to={`/artist/${record.artistId}/show`}
                  className={styles.link}
                  onClick={(e) => e.stopPropagation()}
                >
                  {record.artist}
                </Link>
              ) : (
                record.artist
              )}
            </span>
          )}
        </div>

        {has('album') && (
          <div className={clsx(styles.album, styles.hideSm)} role="cell">
            {record.albumId ? (
              <Link
                to={`/album/${record.albumId}/show`}
                className={styles.link}
                title={record.album}
              >
                {record.album}
              </Link>
            ) : (
              record.album
            )}
          </div>
        )}

        {has('plays') && (
          <div
            className={clsx(styles.plays, styles.hideSm, 'nd-tabular')}
            role="cell"
          >
            {record.playCount > 0 ? record.playCount : ''}
          </div>
        )}

        <div className={styles.trail} role="cell">
          {has('love') && !missing && (
            <LoveToggle
              record={{ ...record, id: songIdOf(record) }}
              resource="song"
              size="xs"
              className={clsx(styles.love, record.starred && styles.loved)}
            />
          )}
          {has('duration') && (
            <span className={clsx(styles.duration, 'nd-tabular')}>
              {formatClock(record.duration)}
            </span>
          )}
          {has('menu') && (
            <MenuTrigger menu={menu} size="xs" className={styles.more} />
          )}
        </div>
        <SongMenuPopup
          menu={menu}
          record={record}
          onAddToPlaylist={onAddToPlaylist}
          extraItems={extraMenuItems && extraMenuItems(record, position)}
        />
      </div>
    )
  },
)

TrackRow.displayName = 'TrackRow'

const selectCurrentTrackId = (state) => selectCurrentItem(state)?.trackId

/**
 * Tracklist. Pass `virtualized` for long lists: rows are windowed against the
 * page scroll so 10 000 songs cost the same as 50.
 */
export const TrackList = ({
  ids,
  data,
  columns = ['number', 'artist', 'love', 'duration', 'menu'],
  onPlay,
  onAddToPlaylist,
  extraMenuItems,
  virtualized = false,
  endReached,
  groupBy,
  renderGroup,
  className,
  label,
}) => {
  const currentTrackId = useSelector(selectCurrentTrackId)
  const { paused } = useTransport()

  const renderRow = useCallback(
    (index, id) => {
      const record = data[id]
      if (!record) return <div className={styles.placeholderRow} />
      const isCurrent = !!currentTrackId && songIdOf(record) === currentTrackId
      return (
        <TrackRow
          record={record}
          position={index}
          columns={columns}
          isCurrent={isCurrent}
          isPlaying={isCurrent && !paused}
          onPlay={onPlay}
          onAddToPlaylist={onAddToPlaylist}
          extraMenuItems={extraMenuItems}
        />
      )
    },
    [
      data,
      currentTrackId,
      paused,
      columns,
      onPlay,
      onAddToPlaylist,
      extraMenuItems,
    ],
  )

  if (virtualized) {
    return (
      <div
        className={clsx(styles.list, className)}
        role="table"
        aria-label={label}
      >
        <Virtuoso
          useWindowScroll
          data={ids}
          computeItemKey={(index, id) => `${id}-${index}`}
          itemContent={renderRow}
          endReached={endReached}
          increaseViewportBy={400}
        />
      </div>
    )
  }

  return (
    <div
      className={clsx(styles.list, className)}
      role="table"
      aria-label={label}
    >
      {ids.map((id, index) => {
        const record = data[id]
        const group =
          groupBy &&
          record &&
          (index === 0 || groupBy(data[ids[index - 1]]) !== groupBy(record))
        return (
          <React.Fragment key={`${id}-${index}`}>
            {group && renderGroup && renderGroup(record)}
            {renderRow(index, id)}
          </React.Fragment>
        )
      })}
    </div>
  )
}

export default TrackList
