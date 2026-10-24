import React, { memo, useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { useDispatch, useSelector } from 'react-redux'
import { useDrag, useDrop } from 'react-dnd'
import { Virtuoso } from 'react-virtuoso'
import { useT } from '../i18n/useT'
import { Artwork } from '../common/Artwork'
import { IconButton } from '../design/IconButton'
import { Button } from '../design/Button'
import { EmptyState, PlayingBars } from '../design/Section'
import {
  ChevronDownIcon,
  ChevronUpIcon,
  ClearIcon,
  CloseIcon,
  DragIcon,
  QueueIcon,
  SaveIcon,
} from '../design/icons'
import {
  clearQueue,
  jumpTo,
  moveInQueue,
  openSaveQueueDialog,
  removeFromQueue,
} from '../actions'
import { formatClock } from '../utils/formatters'
import { useTransport } from './hooks'
import { coverRecordFor } from './coverRecord'
import styles from './QueueList.module.css'

const QUEUE_ITEM = 'nd-queue-item'

const QueueRow = memo(
  ({ item, index, isCurrent, isPast, playing, total, variant }) => {
    const t = useT()
    const dispatch = useDispatch()
    const ref = useRef(null)
    const [{ isDragging }, drag, preview] = useDrag(
      () => ({
        type: QUEUE_ITEM,
        item: { index },
        collect: (m) => ({ isDragging: m.isDragging() }),
      }),
      [index],
    )
    const [{ over }, drop] = useDrop(
      () => ({
        accept: QUEUE_ITEM,
        collect: (m) => ({ over: m.isOver() && m.getItem()?.index !== index }),
        drop: (dragged) => {
          if (dragged.index !== index)
            dispatch(moveInQueue(dragged.index, index))
        },
      }),
      [index],
    )
    preview(drop(ref))

    const song = item.song || {}
    const title = song.title || item.name
    const artist = item.isRadio ? null : song.artist || item.singer

    return (
      <div
        ref={ref}
        className={clsx(
          styles.row,
          styles[variant],
          isCurrent && styles.current,
          isPast && styles.past,
          isDragging && styles.dragging,
          over && styles.over,
        )}
        role="listitem"
        aria-current={isCurrent ? 'true' : undefined}
      >
        <span
          ref={drag}
          className={styles.handle}
          aria-hidden
          title={t('ui.queue.drag', 'Drag to reorder')}
        >
          <DragIcon size={16} />
        </span>
        <button
          type="button"
          className={styles.main}
          onClick={() => dispatch(jumpTo(index))}
          aria-label={`${t('player.clickToPlayText', 'Play')}: ${title}`}
        >
          <span className={styles.coverWrap}>
            <Artwork
              record={coverRecordFor(item)}
              size={96}
              className={styles.cover}
            />
            {isCurrent && (
              <span className={styles.coverOverlay}>
                <PlayingBars playing={playing} />
              </span>
            )}
          </span>
          <span className={styles.text}>
            <span className={styles.title}>{title}</span>
            {artist && <span className={styles.artist}>{artist}</span>}
          </span>
          {!item.isRadio && item.duration > 0 && (
            <span className={clsx(styles.duration, 'nd-tabular')}>
              {formatClock(item.duration)}
            </span>
          )}
        </button>
        <div className={styles.actions}>
          <IconButton
            size="xs"
            icon={ChevronUpIcon}
            label={t('ui.queue.moveUp', 'Move up')}
            disabled={index === 0}
            tooltip={false}
            onClick={() => dispatch(moveInQueue(index, index - 1))}
          />
          <IconButton
            size="xs"
            icon={ChevronDownIcon}
            label={t('ui.queue.moveDown', 'Move down')}
            disabled={index === total - 1}
            tooltip={false}
            onClick={() => dispatch(moveInQueue(index, index + 1))}
          />
          <IconButton
            size="xs"
            icon={CloseIcon}
            label={t('ui.queue.remove', 'Remove from queue')}
            tooltip={false}
            onClick={() => dispatch(removeFromQueue(item.uuid))}
          />
        </div>
      </div>
    )
  },
)

QueueRow.displayName = 'QueueRow'

/** The play queue, virtualised inside its own scroll container. */
export const QueueList = ({ variant = 'panel', className }) => {
  const t = useT()
  const dispatch = useDispatch()
  const queue = useSelector((state) => state.player.queue)
  const index = useSelector((state) => state.player.savedPlayIndex)
  const { paused } = useTransport()
  const virtuoso = useRef(null)
  const [scroller, setScroller] = useState(null)

  // Bring the current track into view when the panel opens
  useEffect(() => {
    if (virtuoso.current && index > 0) {
      virtuoso.current.scrollToIndex({
        index: Math.max(0, index - 1),
        align: 'start',
      })
    }
    // only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const upNext = queue.length - index - 1
  const renderRow = useCallback(
    (i, item) => (
      <QueueRow
        item={item}
        index={i}
        isCurrent={i === index}
        isPast={i < index}
        playing={i === index && !paused}
        total={queue.length}
        variant={variant}
      />
    ),
    [index, paused, queue.length, variant],
  )

  if (queue.length === 0) {
    return (
      <EmptyState
        icon={QueueIcon}
        title={t('ui.queue.empty', 'Your queue is empty')}
        compact
      >
        {t(
          'ui.queue.emptyHint',
          'Play an album or add songs to start listening.',
        )}
      </EmptyState>
    )
  }

  return (
    <div className={clsx(styles.root, className)}>
      <div className={styles.header}>
        <p className={styles.summary}>
          {upNext > 0
            ? t('ui.queue.upNext', '%{smart_count} up next', {
                smart_count: upNext,
              })
            : t('ui.queue.lastTrack', 'Last track in the queue')}
        </p>
        <div className={styles.headerActions}>
          <Button
            size="sm"
            variant="ghost"
            icon={SaveIcon}
            onClick={() => dispatch(openSaveQueueDialog())}
          >
            {t('ui.queue.save', 'Save')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={ClearIcon}
            onClick={() => dispatch(clearQueue())}
          >
            {t('ui.queue.clear', 'Clear')}
          </Button>
        </div>
      </div>
      <div
        className={styles.scroller}
        ref={setScroller}
        role="list"
        aria-label={t('player.playListsText', 'Play Queue')}
      >
        {scroller && (
          <Virtuoso
            ref={virtuoso}
            customScrollParent={scroller}
            data={queue}
            computeItemKey={(i, item) => item.uuid}
            itemContent={renderRow}
            increaseViewportBy={300}
          />
        )}
      </div>
    </div>
  )
}

export default QueueList
