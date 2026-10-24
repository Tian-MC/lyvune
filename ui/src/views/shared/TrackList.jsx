import React, { memo, useCallback, useRef } from 'react'
import clsx from 'clsx'
import { Link } from 'react-router-dom'
import { useSelector } from 'react-redux'
import { useDrag, useDrop } from 'react-dnd'
import { Virtuoso } from 'react-virtuoso'
import { useT } from '../../i18n/useT'
import { Artwork } from '../../common/Artwork'
import { LoveToggle } from '../../design/LoveToggle'
import { PlayingBars } from '../../design/Section'
import { useActionMenu } from '../../design/useActionMenu'
import { AlertIcon, CheckIcon, PlayIcon, PauseIcon } from '../../design/icons'
import { DraggableTypes } from '../../consts'
import { formatClock } from '../../utils/formatters'
import { selectCurrentItem } from '../../reducers/playerReducer'
import { useTransport } from '../../playback/hooks'
import engine from '../../playback/engine'
import { MenuTrigger, SongMenuPopup } from './CollectionMenu'
import styles from './TrackList.module.css'

const songIdOf = (r) => r.mediaFileId || r.id

const LONG_PRESS_MS = 450

// Lets touch users enter selection with a long press
const useLongPress = (onLongPress) => {
  const timer = useRef(null)
  const fired = useRef(false)
  const cancel = () => clearTimeout(timer.current)
  return {
    fired,
    handlers: onLongPress
      ? {
          onPointerDown: (e) => {
            if (e.pointerType !== 'touch') return
            fired.current = false
            timer.current = setTimeout(() => {
              fired.current = true
              onLongPress()
            }, LONG_PRESS_MS)
          },
          onPointerUp: cancel,
          onPointerMove: cancel,
          onPointerCancel: cancel,
        }
      : {},
  }
}

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
    selectable,
    selected,
    selectionActive,
    onToggleSelect,
    onSelectAll,
    onReorder,
    listKey,
  }) => {
    const t = useT()
    const menu = useActionMenu()
    const ref = useRef(null)
    // Rows drag as songs (onto sidebar playlists); within a reorderable list
    // the same drag moves the row.
    const [, dragRef] = useDrag(
      () => ({
        type: DraggableTypes.SONG,
        item: { ids: [songIdOf(record)], listKey, index: position },
        options: { dropEffect: onReorder ? 'move' : 'copy' },
      }),
      [record, listKey, position, onReorder],
    )
    const [{ over }, dropRef] = useDrop(
      () => ({
        accept: onReorder ? DraggableTypes.SONG : [],
        canDrop: (item) => item.listKey === listKey && item.index !== position,
        collect: (m) => ({ over: m.isOver() && m.canDrop() }),
        drop: (item) => onReorder(item.index, position),
      }),
      [onReorder, listKey, position],
    )
    dragRef(dropRef(ref))
    // Selectable lists are ARIA grids (rows carry aria-selected)
    const cellRole = selectable ? 'gridcell' : 'cell'
    const longPress = useLongPress(
      selectable ? () => onToggleSelect(record.id, {}) : null,
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

    const onClick = (e) => {
      if (!selectable || e.target.closest('a, button, input')) return
      if (e.shiftKey) onToggleSelect(record.id, { range: true })
      else if (e.metaKey || e.ctrlKey || selectionActive)
        onToggleSelect(record.id, {})
    }

    const onKeyDown = (e) => {
      if (e.target !== e.currentTarget) return
      if (e.key === 'Enter') play()
      else if (selectable && e.key === ' ') {
        // Space selects here instead of toggling playback
        e.preventDefault()
        e.stopPropagation()
        onToggleSelect(record.id, { range: e.shiftKey })
      } else if (selectable && e.key === 'a' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        onSelectAll()
      } else if (
        onReorder &&
        e.altKey &&
        (e.key === 'ArrowUp' || e.key === 'ArrowDown')
      ) {
        e.preventDefault()
        const target = position + (e.key === 'ArrowUp' ? -1 : 1)
        onReorder(position, target)
        // Rows are keyed by position: keep focus on the moved track
        e.currentTarget
          .closest('[role=grid],[role=table]')
          ?.querySelector(`[data-position="${target}"]`)
          ?.focus()
      }
    }

    return (
      <div
        ref={ref}
        role="row"
        className={clsx(
          styles.row,
          isCurrent && styles.current,
          missing && styles.missing,
          menu.state && styles.menuOpen,
          selected && styles.selected,
          selectable && styles.withCheck,
          selectionActive && styles.selecting,
          over && styles.dropOver,
        )}
        onDoubleClick={play}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => {
          // A long press already toggled selection on touch devices
          if (longPress.fired.current) {
            e.preventDefault()
            longPress.fired.current = false
            return
          }
          menu.openAt(e)
        }}
        {...longPress.handlers}
        tabIndex={0}
        data-position={position}
        aria-current={isCurrent ? 'true' : undefined}
        aria-selected={selectable ? selected : undefined}
      >
        {selectable && (
          <div className={styles.checkCell} role={cellRole}>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={selected}
                onChange={(e) =>
                  onToggleSelect(record.id, {
                    range: e.nativeEvent.shiftKey,
                  })
                }
                aria-label={`${t('ui.selection.select', 'Select')}: ${record.title}`}
              />
              <span aria-hidden>
                <CheckIcon size={13} />
              </span>
            </label>
          </div>
        )}
        <div className={styles.lead} role={cellRole}>
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

        <div className={styles.main} role={cellRole}>
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
          <div className={clsx(styles.album, styles.hideSm)} role={cellRole}>
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
            role={cellRole}
          >
            {record.playCount > 0 ? record.playCount : ''}
          </div>
        )}

        <div className={styles.trail} role={cellRole}>
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
  selection,
  onReorder,
}) => {
  const currentTrackId = useSelector(selectCurrentTrackId)
  const { paused } = useTransport()
  // Identifies drags that started in this list (for reordering)
  const listKey = useRef(Math.random().toString(36)).current

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
          selectable={!!selection}
          selected={!!selection && selection.isSelected(id)}
          selectionActive={!!selection && selection.active}
          onToggleSelect={selection?.toggle}
          onSelectAll={selection?.selectAll}
          onReorder={onReorder}
          listKey={listKey}
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
      selection,
      onReorder,
      listKey,
    ],
  )

  if (virtualized) {
    return (
      <div
        className={clsx(styles.list, className)}
        role={selection ? 'grid' : 'table'}
        aria-label={label}
        aria-multiselectable={selection ? true : undefined}
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
      role={selection ? 'grid' : 'table'}
      aria-label={label}
      aria-multiselectable={selection ? true : undefined}
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
