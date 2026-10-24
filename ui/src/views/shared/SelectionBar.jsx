import React, { useEffect } from 'react'
import { useDispatch } from 'react-redux'
import { useT } from '../../i18n/useT'
import { Button } from '../../design/Button'
import { IconButton } from '../../design/IconButton'
import {
  AddToQueueIcon,
  CloseIcon,
  PlayIcon,
  PlayNextIcon,
  PlusIcon,
  ShareIcon,
  TrashIcon,
} from '../../design/icons'
import {
  addTracks,
  openAddToPlaylist,
  openShareMenu,
  playNext,
  playTracks,
} from '../../actions'
import config from '../../config'
import styles from './SelectionBar.module.css'

const songIdOf = (r) => r.mediaFileId || r.id

/**
 * Bulk actions for selected tracks (same actions as the previous song list
 * bulk toolbar, plus "remove" where the list allows it).
 */
export const SelectionBar = ({ selection, data, onRemove, removeLabel }) => {
  const t = useT()
  const dispatch = useDispatch()
  const { ordered, count, clear } = selection

  useEffect(() => {
    if (!count) return undefined
    const onKey = (e) => e.key === 'Escape' && clear()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [count, clear])

  if (!count) return null

  const playable = ordered.filter((id) => data[id] && !data[id].missing)
  const run = (creator) => () => {
    dispatch(creator(data, playable))
    clear()
  }
  const songIds = ordered.map((id) => data[id] && songIdOf(data[id]))

  return (
    <div
      className={styles.bar}
      role="toolbar"
      aria-label={t('ui.selection.label', 'Selected songs')}
    >
      <span className={styles.count} aria-live="polite">
        {t('ui.selection.count', '%{smart_count} selected', {
          smart_count: count,
        })}
      </span>
      <div className={styles.actions}>
        <Button
          size="sm"
          variant="primary"
          icon={PlayIcon}
          onClick={run(playTracks)}
          disabled={!playable.length}
        >
          {t('resources.song.actions.playNow', 'Play Now')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={PlayNextIcon}
          onClick={run(playNext)}
          disabled={!playable.length}
        >
          <span className={styles.label}>
            {t('resources.song.actions.playNext', 'Play Next')}
          </span>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={AddToQueueIcon}
          onClick={run(addTracks)}
          disabled={!playable.length}
        >
          <span className={styles.label}>
            {t('resources.song.actions.addToQueue', 'Play Later')}
          </span>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={PlusIcon}
          onClick={() =>
            dispatch(
              openAddToPlaylist({ selectedIds: songIds, onSuccess: clear }),
            )
          }
        >
          <span className={styles.label}>
            {t('resources.song.actions.addToPlaylist', 'Add to Playlist')}
          </span>
        </Button>
        {config.enableSharing && (
          <Button
            size="sm"
            variant="ghost"
            icon={ShareIcon}
            onClick={() => {
              dispatch(
                openShareMenu(
                  songIds,
                  'song',
                  t('ui.selection.shareName', 'Songs'),
                ),
              )
              clear()
            }}
          >
            <span className={styles.label}>
              {t('ra.action.share', 'Share')}
            </span>
          </Button>
        )}
        {onRemove && (
          <Button
            size="sm"
            variant="ghost"
            icon={TrashIcon}
            onClick={() => {
              onRemove(ordered)
              clear()
            }}
          >
            <span className={styles.label}>{removeLabel}</span>
          </Button>
        )}
      </div>
      <IconButton
        size="sm"
        icon={CloseIcon}
        label={t('ui.selection.clear', 'Clear selection')}
        onClick={clear}
      />
    </div>
  )
}

export default SelectionBar
