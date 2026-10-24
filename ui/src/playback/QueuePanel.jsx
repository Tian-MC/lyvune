import React, { useEffect, useRef } from 'react'
import { useSelector } from 'react-redux'
import { useT } from '../i18n/useT'
import { useShell } from '../shell/useShell'
import { IconButton } from '../design/IconButton'
import { CloseIcon } from '../design/icons'
import { QueueList } from './QueueList'
import styles from './QueuePanel.module.css'

/** Side panel next to the player bar (desktop); a sheet on small screens. */
const QueuePanel = () => {
  const t = useT()
  const { closeQueue } = useShell()
  const ref = useRef(null)
  const queueLength = useSelector((state) => state.player.queue.length)

  // The player bar (and its queue button) disappears with the last track, so
  // an open panel would be left covering the page with no way to close it
  useEffect(() => {
    if (queueLength === 0) closeQueue()
  }, [queueLength, closeQueue])

  useEffect(() => {
    const previous = document.activeElement
    ref.current?.focus()
    const onKey = (e) => e.key === 'Escape' && closeQueue()
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previous && previous.focus && previous.focus()
    }
  }, [closeQueue])

  return (
    <>
      <div className={styles.scrim} onClick={closeQueue} aria-hidden />
      <aside
        ref={ref}
        className={styles.panel}
        role="dialog"
        aria-label={t('player.playListsText', 'Play Queue')}
        tabIndex={-1}
      >
        <header className={styles.header}>
          <h2 className={styles.title}>
            {t('player.playListsText', 'Play Queue')}
          </h2>
          <IconButton
            size="sm"
            icon={CloseIcon}
            label={t('ra.action.close', 'Close')}
            onClick={closeQueue}
          />
        </header>
        <QueueList className={styles.list} />
      </aside>
    </>
  )
}

export default QueuePanel
