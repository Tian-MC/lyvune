import React, { useEffect, useRef } from 'react'
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
