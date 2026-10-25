import React from 'react'
import clsx from 'clsx'
import { FormControlLabel, Switch } from '@material-ui/core'
import { useT } from '../i18n/useT'
import styles from './LyricsSettings.module.css'

const AVAILABILITY = {
  available: ['ui.lyrics.provider.available', 'Available', 'good'],
  off: ['ui.lyrics.provider.off', 'Off', ''],
  'needs-credentials': [
    'ui.lyrics.provider.needsKey',
    'Needs your API key',
    'warn',
  ],
  'not-available': ['ui.lyrics.provider.notAvailable', 'Not available', 'warn'],
  'rate-limited': ['ui.lyrics.provider.rateLimited', 'Rate limited', 'warn'],
  'temporarily-unavailable': [
    'ui.lyrics.provider.temporarily',
    'Temporarily unavailable',
    'warn',
  ],
}

const AUTH = {
  none: ['ui.lyrics.provider.authNone', 'No account or key needed'],
  'api-key': ['ui.lyrics.provider.authKey', 'Needs your own API key'],
  'optional-key': [
    'ui.lyrics.provider.authOptional',
    'Works without a key; a key adds more',
  ],
}

const when = (iso) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString()
}

const Tag = ({ on, children, warn }) => (
  <span
    className={clsx(styles.tag, on && styles.tagOn, warn && styles.tagWarn)}
  >
    {children}
  </span>
)

/**
 * One provider, described from what the running backend reports: whether it is
 * implemented, set up, seen working and seen returning karaoke are separate
 * facts, and none is inferred from another.
 */
export const ProviderCard = ({ p, onToggle }) => {
  const t = useT()
  const [availKey, availDefault, tone] = AVAILABILITY[p.availability] ?? [
    'ui.lyrics.provider.unknown',
    p.availability || p.status,
    '',
  ]
  const [authKey, authDefault] = AUTH[p.auth] ?? AUTH.none
  return (
    <li className={styles.provider} data-testid={`provider-${p.id}`}>
      <div className={styles.providerHead}>
        <FormControlLabel
          labelPlacement="start"
          control={
            <Switch
              color="primary"
              checked={p.enabled}
              disabled={p.status !== 'ready'}
              onChange={(e) => onToggle(p.id, e.target.checked)}
              inputProps={{ 'aria-label': p.name }}
            />
          }
          label={<strong>{p.name}</strong>}
        />
        <span
          className={clsx(
            styles.state,
            tone === 'good' && styles.stateGood,
            tone === 'warn' && styles.stateWarn,
          )}
        >
          {t(availKey, availDefault)}
        </span>
      </div>

      {p.reason && <p className={styles.hint}>{p.reason}</p>}

      <p className={styles.tags}>
        <Tag on={p.implemented}>
          {p.implemented
            ? t('ui.lyrics.provider.implemented', 'Implemented')
            : t('ui.lyrics.provider.notImplemented', 'Not implemented')}
        </Tag>
        <Tag on={p.configured}>
          {p.configured
            ? t('ui.lyrics.provider.configured', 'Set up')
            : t('ui.lyrics.provider.notConfigured', 'Not set up')}
        </Tag>
        <Tag on={p.liveVerified}>
          {p.liveVerified
            ? t('ui.lyrics.provider.seenWorking', 'Seen working')
            : t('ui.lyrics.provider.notSeenWorking', 'Not seen working yet')}
        </Tag>
        {p.wordSync && (
          <Tag on={p.karaokeVerified}>
            {p.karaokeVerified
              ? t('ui.lyrics.provider.karaokeSeen', 'Karaoke seen')
              : t('ui.lyrics.provider.karaokeNotSeen', 'Karaoke not seen yet')}
          </Tag>
        )}
        {p.verified && (
          <Tag on>
            {t('ui.lyrics.provider.devChecked', 'Checked in development')}
          </Tag>
        )}
        <Tag on={p.storable} warn={!p.storable && p.implemented}>
          {p.storable
            ? t('ui.lyrics.provider.canStore', 'Lyrics can be saved')
            : t('ui.lyrics.provider.notStoredShort', 'Preview only')}
        </Tag>
      </p>

      <p className={styles.hint}>
        {[
          t(authKey, authDefault),
          p.plain && t('ui.lyrics.quality.plain', 'Plain'),
          p.synced && t('ui.lyrics.quality.synced', 'Synced'),
          p.wordSync && t('ui.lyrics.manager.wordTiming', 'Word timing'),
          p.translation && t('ui.lyrics.translation', 'Translation'),
          p.romanization && t('ui.lyrics.pronunciation', 'Romanization'),
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>

      {p.formats?.length > 0 && (
        <p className={styles.hint}>
          {t('ui.lyrics.provider.formats', 'Reads: %{formats}', {
            formats: p.formats.join(', '),
          })}
        </p>
      )}

      {p.modes?.length > 0 && (
        <ul
          className={styles.modes}
          aria-label={t('ui.lyrics.provider.modes', 'Ways to use it')}
        >
          {p.modes.map((m) => (
            <li key={m.id} className={styles.mode}>
              <span className={m.active ? styles.modeOn : styles.modeOff}>
                {m.active
                  ? t('ui.lyrics.provider.modeActive', 'In use')
                  : t('ui.lyrics.provider.modeInactive', 'Not in use')}
              </span>{' '}
              <strong>{m.name}</strong>
              {m.note && <span className={styles.hint}> · {m.note}</span>}
            </li>
          ))}
        </ul>
      )}

      {p.lastSuccess && (
        <p className={styles.hint}>
          {t('ui.lyrics.provider.lastSuccess', 'Last answer: %{time}', {
            time: when(p.lastSuccess),
          })}
        </p>
      )}
      {p.lastError && (
        <p className={styles.hint}>
          {t('ui.lyrics.provider.lastError', 'Last error: %{message}', {
            message: p.lastError,
          })}
          {p.lastFailure && ` (${when(p.lastFailure)})`}
        </p>
      )}
      {p.note && <p className={styles.hint}>{p.note}</p>}
    </li>
  )
}

export default ProviderCard
