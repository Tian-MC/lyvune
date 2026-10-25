import React, { useState } from 'react'
import clsx from 'clsx'
import { useT } from '../i18n/useT'
import { Button } from '../design/Button'
import { SearchIcon } from '../design/icons'
import { percent, providerName, qualityLabel } from './lyricsSource'
import styles from './LyricsManager.module.css'

const formatDelta = (seconds) =>
  seconds ? `${seconds > 0 ? '+' : '-'}${Math.abs(Math.round(seconds))} s` : ''

const Outcomes = ({ providers }) => {
  const t = useT()
  if (!providers?.length) return null
  const text = (o) => {
    switch (o.status) {
      case 'ok':
        return t('ui.lyrics.manager.outcome.ok', '%{count} found', {
          count: o.count,
        })
      case 'rate-limited':
        return t(
          'ui.lyrics.manager.outcome.limited',
          'asked to slow down, retry in %{seconds} s',
          { seconds: o.retryAfter },
        )
      case 'disabled':
        return t('ui.lyrics.manager.outcome.disabled', 'not set up')
      case 'unavailable':
        return t('ui.lyrics.manager.outcome.unavailable', 'unavailable')
      default:
        return t('ui.lyrics.manager.outcome.error', 'did not answer')
    }
  }
  return (
    <ul
      className={styles.outcomes}
      aria-label={t('ui.lyrics.manager.providers', 'Providers')}
    >
      {providers.map((o) => (
        <li
          key={o.id}
          className={clsx(
            styles.outcome,
            o.status !== 'ok' && styles.outcomeBad,
          )}
          title={o.message}
        >
          <strong>{providerName(o.id)}</strong> {text(o)}
        </li>
      ))}
    </ul>
  )
}

const Preview = ({ lines, truncated }) => {
  const t = useT()
  return (
    <div
      className={styles.preview}
      tabIndex={0}
      aria-label={t('ui.lyrics.manager.preview', 'Preview')}
    >
      {lines.map((l, i) => (
        <p key={i} className={styles.previewLine}>
          {l.text || ' '}
        </p>
      ))}
      {truncated && <p className={styles.hint}>…</p>}
    </div>
  )
}

const Candidate = ({ c, busy, onUse }) => {
  const t = useT()
  const [open, setOpen] = useState(false)
  const delta = formatDelta(c.match?.durationDelta)
  return (
    <li className={styles.candidate}>
      <div className={styles.candidateHead}>
        <div className={styles.candidateTitle}>
          <span className={styles.candidateName}>
            {providerName(c.provider)}
          </span>
          <span className={clsx(styles.chip, styles[`q_${c.quality}`])}>
            {qualityLabel(t, c.quality)}
          </span>
          <span
            className={clsx(
              styles.chip,
              c.verified ? styles.chipGood : styles.chipWarn,
            )}
          >
            {c.verified
              ? t('ui.lyrics.manager.verified', 'Matches the track')
              : t('ui.lyrics.manager.uncertain', 'Uncertain match')}{' '}
            · {percent(c.match?.confidence)}
          </span>
        </div>
        <p className={styles.candidateMeta}>
          {[c.meta?.title, c.meta?.artist, c.meta?.album]
            .filter(Boolean)
            .join(' · ')}
          {delta && ` · ${t('ui.lyrics.manager.length', 'length')} ${delta}`}
          {c.meta?.lang && ` · ${c.meta.lang}`}
        </p>
        <p className={styles.tags}>
          {c.wordTiming && (
            <span className={styles.tag}>
              {t('ui.lyrics.manager.wordTiming', 'Word timing')}
            </span>
          )}
          {c.translation && (
            <span className={styles.tag}>
              {t('ui.lyrics.translation', 'Translation')}
            </span>
          )}
          {c.romanization && (
            <span className={styles.tag}>
              {t('ui.lyrics.pronunciation', 'Romanization')}
            </span>
          )}
          {c.meta?.instrumental && (
            <span className={styles.tag}>
              {t('ui.lyrics.manager.instrumental', 'Marked instrumental')}
            </span>
          )}
          {!c.storable && (
            <span
              className={clsx(styles.tag, styles.tagWarn)}
              title={t(
                'ui.lyrics.manager.notStorableHint',
                'This provider does not allow its lyrics to be saved.',
              )}
            >
              {t('ui.lyrics.manager.notStorable', 'Cannot be saved')}
            </span>
          )}
        </p>
        {c.attribution && <p className={styles.hint}>{c.attribution}</p>}
      </div>
      <div className={styles.candidateActions}>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          disabled={!c.lines}
        >
          {open
            ? t('ui.lyrics.manager.hidePreview', 'Hide preview')
            : t('ui.lyrics.manager.showPreview', 'Preview')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={busy || !c.storable || !c.lines}
          onClick={() => onUse(c)}
        >
          {t('ui.lyrics.manager.use', 'Use this version')}
        </Button>
      </div>
      {open && <Preview lines={c.preview} truncated={c.truncated} />}
    </li>
  )
}

/** The "Find lyrics" tab: search every provider and choose a version. */
export const ManagerSearch = ({ search, busy, onSearch, onUse }) => {
  const t = useT()
  return (
    <div className={styles.panel}>
      <div className={styles.row}>
        <Button
          variant="primary"
          icon={SearchIcon}
          onClick={onSearch}
          disabled={search.loading}
        >
          {search.loading
            ? t('ui.lyrics.manager.searching', 'Searching…')
            : t('ui.lyrics.manager.search', 'Search online')}
        </Button>
        <p className={styles.hint}>
          {t(
            'ui.lyrics.manager.searchHint',
            'Nothing changes until you choose a version.',
          )}
        </p>
      </div>
      <Outcomes providers={search.providers} />
      {search.error && (
        <p role="alert" className={styles.error}>
          {search.error}
        </p>
      )}
      {search.done && search.candidates.length === 0 && !search.error && (
        <p className={styles.hint}>
          {t('ui.lyrics.manager.noResults', 'No matching lyrics were found.')}
        </p>
      )}
      <ul className={styles.candidates} aria-busy={search.loading}>
        {search.candidates.map((c) => (
          <Candidate key={c.id} c={c} busy={busy} onUse={onUse} />
        ))}
      </ul>
    </div>
  )
}

export default ManagerSearch
