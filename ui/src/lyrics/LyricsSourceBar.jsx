import React, { useState } from 'react'
import { useT } from '../i18n/useT'
import { Button } from '../design/Button'
import { LockIcon } from '../design/icons'
import { LyricsManager } from './LyricsManager'
import { formatOffset, qualityLabel, sourceLabel } from './lyricsSource'
import { useLyricsStatus } from './useLyricsStatus'
import styles from './LyricsSourceBar.module.css'

const isAdmin = () => localStorage.getItem('role') === 'admin'

/**
 * A quiet line under the lyrics saying where they come from, with the lyrics
 * manager one click away for administrators.
 */
export const LyricsSourceBar = ({ trackId, title, searching }) => {
  const t = useT()
  const { data } = useLyricsStatus(trackId)
  const [managing, setManaging] = useState(false)
  const admin = isAdmin()
  const cur = data?.current

  if (!searching && !cur && !admin) return null

  return (
    <div className={styles.bar}>
      <p className={styles.source} aria-live="polite">
        {searching ? (
          t('ui.lyrics.searching', 'Looking for lyrics…')
        ) : cur ? (
          <>
            <span>{sourceLabel(t, cur)}</span>
            <span className={styles.dot} aria-hidden>
              ·
            </span>
            <span>{qualityLabel(t, cur.quality)}</span>
            {data.locked && (
              <span
                className={styles.lock}
                title={t('ui.lyrics.manager.locked', 'Locked')}
              >
                <LockIcon
                  size={12}
                  aria-label={t('ui.lyrics.manager.locked', 'Locked')}
                />
              </span>
            )}
            {data.offsetMs !== 0 && (
              <span className={styles.offset}>
                {formatOffset(data.offsetMs)}
              </span>
            )}
            {cur.attribution && (
              <span className={styles.attribution}>{cur.attribution}</span>
            )}
            {cur.id === 'display' && (
              <span className={styles.attribution}>
                {t(
                  'ui.lyrics.source.shownHint',
                  'Held in memory: gone after a restart, not available offline.',
                )}
              </span>
            )}
          </>
        ) : null}
      </p>
      {admin && (
        <Button size="sm" variant="ghost" onClick={() => setManaging(true)}>
          {t('ui.lyrics.manage', 'Manage')}
        </Button>
      )}
      {managing && (
        <LyricsManager
          trackId={trackId}
          title={title}
          onClose={() => setManaging(false)}
        />
      )}
    </div>
  )
}

export default LyricsSourceBar
