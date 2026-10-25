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
export const ProviderCard = ({ p, onToggle, onSavePref }) => {
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
            {t(
              'ui.lyrics.provider.devChecked',
              'Checked by the developers once (not a live status)',
            )}
          </Tag>
        )}
        {p.implemented && (
          <Tag
            on={p.storeStatus === 'granted'}
            warn={p.storeStatus !== 'granted'}
          >
            {p.storeStatus === 'granted'
              ? t('ui.lyrics.provider.rightsGranted', 'Rights documented')
              : p.storeStatus === 'restricted'
                ? t('ui.lyrics.provider.rightsRestricted', 'Saving restricted')
                : t('ui.lyrics.provider.rightsUnclear', 'Rights unclear')}
          </Tag>
        )}
        {p.implemented && p.storeAllowed && (
          <Tag on={p.savePreference}>
            {p.savePreference
              ? t('ui.lyrics.provider.tagSaved', 'Saved automatically')
              : t('ui.lyrics.provider.tagNotSaved', 'Not saved automatically')}
          </Tag>
        )}
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

      <p className={styles.hint}>
        {p.wordSync
          ? p.karaokeVerified
            ? t('ui.lyrics.provider.karaokeYes', 'Real karaoke: seen working')
            : t(
                'ui.lyrics.provider.karaokeCan',
                'Real karaoke when the song has it (not seen yet)',
              )
          : t('ui.lyrics.provider.karaokeNo', 'No word-level karaoke')}
      </p>

      {p.implemented && (
        <div className={styles.store}>
          <FormControlLabel
            labelPlacement="start"
            control={
              <Switch
                color="primary"
                size="small"
                checked={!!p.savePreference}
                disabled={!p.storeAllowed || p.status !== 'ready'}
                onChange={(e) => onSavePref(p.id, e.target.checked)}
                inputProps={{
                  'aria-label': t(
                    'ui.lyrics.provider.saveSwitch',
                    'Save lyrics from %{name} locally',
                    { name: p.name },
                  ),
                }}
              />
            }
            label={t(
              'ui.lyrics.provider.saveSwitchLabel',
              'Save its lyrics locally',
            )}
          />
          <p className={styles.hint}>
            {p.storeStatus === 'restricted'
              ? t(
                  'ui.lyrics.provider.permRestricted',
                  'Saving is restricted by the terms recorded for this provider: %{basis} (%{reference}). Its results are only shown.',
                  { basis: p.storeBasis, reference: p.storeReference },
                )
              : p.storeStatus === 'granted'
                ? t(
                    'ui.lyrics.provider.permGranted',
                    'A written authorization is recorded: %{basis} (%{reference}). Saving is still your choice.',
                    { basis: p.storeBasis, reference: p.storeReference },
                  )
                : t(
                    'ui.lyrics.provider.permUnclear',
                    'Rights unclear: %{basis} Turning this on is your decision; it is not a permission from the provider.',
                    { basis: p.storeBasis },
                  )}
          </p>
          <p className={styles.hint}>
            {p.storeAllowed && p.savePreference
              ? t(
                  'ui.lyrics.provider.savedOffline',
                  'Results are saved next to the audio and stay available offline.',
                )
              : p.display === 'session'
                ? t(
                    'ui.lyrics.provider.notSavedShown',
                    'Results are shown while playing, not saved, and not available offline. You can still save one by hand in the lyrics manager.',
                  )
                : t(
                    'ui.lyrics.provider.notSavedPreview',
                    'Results can only be previewed in the lyrics manager, and are not available offline unless you save one by hand.',
                  )}
            {p.savePreferenceSource === 'legacy' &&
              ` ${t(
                'ui.lyrics.provider.prefLegacy',
                'This choice was carried over from an earlier version.',
              )}`}
          </p>
          {p.lastSave && (
            <p className={styles.hint} role="status">
              {p.lastSave.ok
                ? t(
                    'ui.lyrics.provider.lastSaveOk',
                    'Last save: succeeded and was read back (%{time}).',
                    { time: when(p.lastSave.at) },
                  )
                : t(
                    'ui.lyrics.provider.lastSaveFailed',
                    'Last save failed: %{message} (%{time})',
                    { message: p.lastSave.message, time: when(p.lastSave.at) },
                  )}
            </p>
          )}
        </div>
      )}

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
