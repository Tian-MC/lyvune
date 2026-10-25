import React, { useRef } from 'react'
import clsx from 'clsx'
import { useT } from '../i18n/useT'
import { Button } from '../design/Button'
import { IconButton } from '../design/IconButton'
import {
  HistoryIcon,
  LockIcon,
  MinusIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
  UndoIcon,
  UnlockIcon,
  UploadIcon,
} from '../design/icons'
import {
  formatOffset,
  percent,
  providerName,
  qualityLabel,
  sourceLabel,
} from './lyricsSource'
import styles from './LyricsManager.module.css'

const IMPORT_ACCEPT = '.lrc,.elrc,.ttml,.srt,.txt,.yaml,.yml,.json'
const OFFSET_STEP_MS = 100

const when = (iso, locale) => {
  try {
    return new Date(iso).toLocaleString(locale)
  } catch {
    return iso
  }
}

/** The "Current lyrics" tab: where they come from, and what can be done. */
export const ManagerCurrent = ({
  data,
  busy,
  onLock,
  onOffset,
  onUse,
  onRestore,
  onDelete,
  onImport,
  onFindBetter,
}) => {
  const t = useT()
  const fileInput = useRef(null)
  const cur = data?.current
  const canDelete = cur && (cur.source === 'managed' || cur.source === 'user')

  return (
    <div className={styles.panel}>
      {!data?.writable && data?.writeError && (
        <p role="note" className={styles.warning}>
          {data.writeError}
        </p>
      )}

      <section className={styles.block} aria-labelledby="lm-current">
        <h3 id="lm-current" className={styles.blockTitle}>
          {t('ui.lyrics.manager.current', 'Showing now')}
        </h3>
        {cur ? (
          <>
            <p className={styles.sourceLine}>
              <strong>{sourceLabel(t, cur)}</strong>
              <span className={clsx(styles.chip, styles[`q_${cur.quality}`])}>
                {qualityLabel(t, cur.quality)}
              </span>
              {cur.confidence > 0 && (
                <span className={styles.hint}>{percent(cur.confidence)}</span>
              )}
            </p>
            {cur.attribution && (
              <p className={styles.hint}>{cur.attribution}</p>
            )}
            {cur.retrievedAt && (
              <p className={styles.hint}>
                {t('ui.lyrics.manager.savedOn', 'Saved %{date}', {
                  date: when(cur.retrievedAt),
                })}
              </p>
            )}
          </>
        ) : (
          <p className={styles.hint}>
            {t(
              'ui.lyrics.manager.noLyrics',
              'There are no lyrics for this track yet.',
            )}
          </p>
        )}
      </section>

      <section className={styles.block} aria-labelledby="lm-controls">
        <h3 id="lm-controls" className={styles.blockTitle}>
          {t('ui.lyrics.manager.controls', 'Controls')}
        </h3>
        <div className={styles.row}>
          <Button
            size="sm"
            variant="chip"
            icon={data?.locked ? LockIcon : UnlockIcon}
            aria-pressed={!!data?.locked}
            disabled={busy || !cur}
            onClick={() => onLock(!data?.locked)}
          >
            {data?.locked
              ? t('ui.lyrics.manager.locked', 'Locked')
              : t('ui.lyrics.manager.lock', 'Lock these lyrics')}
          </Button>
          <p className={styles.hint}>
            {t(
              'ui.lyrics.manager.lockHint',
              'A locked version is never replaced by an automatic upgrade.',
            )}
          </p>
        </div>
        <div
          className={styles.row}
          role="group"
          aria-label={t('ui.lyrics.manager.offset', 'Timing offset')}
        >
          <IconButton
            size="sm"
            icon={MinusIcon}
            label={t('ui.lyrics.manager.later', 'Show lyrics later')}
            disabled={busy || !cur}
            onClick={() => onOffset((data?.offsetMs || 0) - OFFSET_STEP_MS)}
          />
          <output className={styles.offset} aria-live="polite">
            {formatOffset(data?.offsetMs) ||
              t('ui.lyrics.manager.noOffset', 'In time')}
          </output>
          <IconButton
            size="sm"
            icon={PlusIcon}
            label={t('ui.lyrics.manager.sooner', 'Show lyrics sooner')}
            disabled={busy || !cur}
            onClick={() => onOffset((data?.offsetMs || 0) + OFFSET_STEP_MS)}
          />
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !data?.offsetMs}
            onClick={() => onOffset(0)}
          >
            {t('ui.lyrics.manager.resetOffset', 'Reset')}
          </Button>
        </div>
      </section>

      {data?.local?.length > 1 && (
        <section className={styles.block} aria-labelledby="lm-local">
          <h3 id="lm-local" className={styles.blockTitle}>
            {t('ui.lyrics.manager.versions', 'Versions on this server')}
          </h3>
          <ul className={styles.list}>
            {data.local.map((s) => (
              <li key={s.id} className={styles.listItem}>
                <span>
                  {sourceLabel(t, s)}{' '}
                  <span className={clsx(styles.chip, styles[`q_${s.quality}`])}>
                    {qualityLabel(t, s.quality)}
                  </span>
                  {s.id === cur?.id && (
                    <span className={styles.hint}>
                      {' '}
                      · {t('ui.lyrics.manager.inUse', 'in use')}
                    </span>
                  )}
                </span>
                {s.id !== cur?.id && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => onUse(s)}
                  >
                    {t('ui.lyrics.manager.use', 'Use this version')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <p className={styles.hint}>
            {t(
              'ui.lyrics.manager.embeddedHint',
              'Embedded lyrics stay in the audio file as they are. Choosing one saves a preferred copy next to it.',
            )}
          </p>
        </section>
      )}

      <section className={styles.block} aria-labelledby="lm-actions">
        <h3 id="lm-actions" className={styles.blockTitle}>
          {t('ui.lyrics.manager.actions', 'Change lyrics')}
        </h3>
        <div className={styles.row}>
          <Button size="sm" icon={SearchIcon} onClick={onFindBetter}>
            {cur
              ? t('ui.lyrics.manager.findBetter', 'Search for better lyrics')
              : t('ui.lyrics.manager.find', 'Find lyrics')}
          </Button>
          <Button
            size="sm"
            icon={UploadIcon}
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            {t('ui.lyrics.manager.import', 'Import a file')}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept={IMPORT_ACCEPT}
            hidden
            data-testid="lyrics-import"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) onImport(file)
            }}
          />
          {canDelete && (
            <Button
              size="sm"
              variant="ghost"
              icon={TrashIcon}
              disabled={busy}
              onClick={onDelete}
            >
              {t('ui.lyrics.manager.delete', 'Delete saved lyrics')}
            </Button>
          )}
        </div>
      </section>

      <section className={styles.block} aria-labelledby="lm-history">
        <h3 id="lm-history" className={styles.blockTitle}>
          <HistoryIcon size={15} aria-hidden />{' '}
          {t('ui.lyrics.manager.history', 'History')}
        </h3>
        {data?.history?.length ? (
          <ul className={styles.list}>
            {data.history.map((v) => (
              <li key={v.id} className={styles.listItem}>
                <span>
                  {v.existed
                    ? `${providerName(v.provider) || t('ui.lyrics.manager.version', 'Version')} · ${qualityLabel(t, v.quality)}`
                    : t('ui.lyrics.manager.noneBefore', 'No saved lyrics')}
                  <span className={styles.hint}> · {when(v.at)}</span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={UndoIcon}
                  disabled={busy}
                  onClick={() => onRestore(v.id)}
                >
                  {t('ui.lyrics.manager.restore', 'Restore')}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.hint}>
            {t('ui.lyrics.manager.noHistory', 'Nothing to restore yet.')}
          </p>
        )}
      </section>
    </div>
  )
}

export default ManagerCurrent
