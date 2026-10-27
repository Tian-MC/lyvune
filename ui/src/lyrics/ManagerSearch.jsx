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

// What playing the track would do with a result (the server's verdict), and why
// a version is not taken: shown for word-timed results and for the one taken
const AUTO = {
  chosen: [
    'ui.lyrics.manager.auto.chosen',
    'Chosen automatically when the track plays.',
  ],
  outranked: [
    'ui.lyrics.manager.auto.outranked',
    'Not chosen automatically: another result ranks higher.',
  ],
  'not-better': [
    'ui.lyrics.manager.auto.not_better',
    'Not chosen automatically: the current lyrics are already as well synchronized.',
  ],
  match: [
    'ui.lyrics.manager.auto.match',
    'Not chosen automatically: the match with this track is not certain enough.',
  ],
  duration: [
    'ui.lyrics.manager.auto.duration',
    "Not chosen automatically: its length differs from the track's by more than 5 seconds, so it may be another recording.",
  ],
  rights: [
    'ui.lyrics.manager.auto.rights',
    "Not chosen automatically: this provider's lyrics may be neither saved nor shown while playing.",
  ],
  'provider-off': [
    'ui.lyrics.manager.auto.provider_off',
    'Not chosen automatically: this provider is not turned on in the lyrics settings.',
  ],
  locked: [
    'ui.lyrics.manager.auto.locked',
    "Not chosen automatically: this track's lyrics are locked.",
  ],
  'user-choice': [
    'ui.lyrics.manager.auto.user_choice',
    'Not chosen automatically: lyrics chosen by hand are never replaced automatically.',
  ],
  manual: [
    'ui.lyrics.manager.auto.manual',
    'Not chosen automatically: lyrics files and embedded lyrics are kept unless "Also upgrade lyrics I added myself" is on.',
  ],
  off: [
    'ui.lyrics.manager.auto.off',
    'Not chosen automatically: automatic retrieval or upgrades are turned off.',
  ],
}

const AutoNote = ({ c }) => {
  const t = useT()
  const text = AUTO[c.auto]
  if (!text || (!c.wordTiming && c.auto !== 'chosen')) return null
  return (
    <p
      className={clsx(styles.hint, c.auto !== 'chosen' && styles.autoSkipped)}
      data-auto={c.auto}
    >
      {t(text[0], text[1])}
    </p>
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
          {c.storable ? (
            <>
              <span className={styles.tag}>
                {t('ui.lyrics.manager.canSave', 'Can be saved')}
              </span>
              {c.rights && (
                <span
                  className={clsx(
                    styles.tag,
                    c.rights !== 'granted' && styles.tagWarn,
                  )}
                  title={t(
                    'ui.lyrics.manager.rightsHint',
                    "What is known about the provider's terms on keeping its lyrics. Saving is your choice, not a permission from the provider.",
                  )}
                >
                  {c.rights === 'granted'
                    ? t('ui.lyrics.provider.rightsGranted', 'Rights documented')
                    : t('ui.lyrics.provider.rightsUnclear', 'Rights unclear')}
                </span>
              )}
              {c.autoSave && (
                <span className={styles.tag}>
                  {t('ui.lyrics.provider.tagSaved', 'Saved automatically')}
                </span>
              )}
            </>
          ) : c.displayOnly ? (
            <span
              className={clsx(styles.tag, styles.tagWarn)}
              title={t(
                'ui.lyrics.manager.shownTagHint',
                'May be shown while playing but not kept. Gone after a restart; not available offline.',
              )}
            >
              {t('ui.lyrics.manager.shownTag', 'Shown only, not saved')}
            </span>
          ) : (
            <span
              className={clsx(styles.tag, styles.tagWarn)}
              title={t(
                'ui.lyrics.manager.previewTagHint',
                'These lyrics can be read here, but are neither shown while playing nor kept.',
              )}
            >
              {t('ui.lyrics.manager.previewTag', 'Preview only')}
            </span>
          )}
        </p>
        {c.attribution && <p className={styles.hint}>{c.attribution}</p>}
        <AutoNote c={c} />
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
        {c.storable ? (
          <>
            <Button
              size="sm"
              variant="primary"
              disabled={busy || !c.lines}
              onClick={() => onUse(c, 'save')}
            >
              {t('ui.lyrics.manager.saveLocally', 'Save lyrics locally')}
            </Button>
            {c.canShow && (
              <Button
                size="sm"
                disabled={busy || !c.lines}
                onClick={() => onUse(c, 'show')}
              >
                {t('ui.lyrics.manager.showOnly', 'Show only')}
              </Button>
            )}
          </>
        ) : (
          <Button
            size="sm"
            variant="primary"
            disabled={busy || !c.displayOnly || !c.lines}
            onClick={() => onUse(c, 'show')}
          >
            {t('ui.lyrics.manager.useShown', 'Show this version (not saved)')}
          </Button>
        )}
      </div>
      {open && <Preview lines={c.preview} truncated={c.truncated} />}
    </li>
  )
}

/** The "Find lyrics" tab: search every provider and choose a version. */
export const ManagerSearch = ({ search, busy, onSearch, onUse }) => {
  const t = useT()
  const [only, setOnly] = useState('')
  const providers = [...new Set(search.candidates.map((c) => c.provider))]
  // A filter whose provider no longer has results (new search) is ignored
  const active = providers.includes(only) ? only : ''
  const shown = active
    ? search.candidates.filter((c) => c.provider === active)
    : search.candidates
  return (
    <div className={styles.panel}>
      <div className={styles.row}>
        <Button
          variant="primary"
          icon={SearchIcon}
          onClick={() => onSearch(search.done)}
          disabled={search.loading}
        >
          {search.loading
            ? t('ui.lyrics.manager.searching', 'Searching…')
            : search.done
              ? t('ui.lyrics.manager.searchAgain', 'Search again')
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
      {providers.length > 1 && (
        <div
          className={styles.row}
          role="group"
          aria-label={t(
            'ui.lyrics.manager.filterProvider',
            'Show results from',
          )}
        >
          {['', ...providers].map((id) => (
            <Button
              key={id || 'all'}
              size="sm"
              variant={active === id ? 'primary' : 'ghost'}
              aria-pressed={active === id}
              onClick={() => setOnly(id)}
            >
              {id
                ? providerName(id)
                : t('ui.lyrics.manager.allProviders', 'All')}
            </Button>
          ))}
        </div>
      )}
      <ul className={styles.candidates} aria-busy={search.loading}>
        {shown.map((c) => (
          <Candidate key={c.id} c={c} busy={busy} onUse={onUse} />
        ))}
      </ul>
    </div>
  )
}

export default ManagerSearch
