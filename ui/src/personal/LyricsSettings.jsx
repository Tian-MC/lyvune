import React, { useCallback, useEffect, useRef, useState } from 'react'
import { FormControlLabel, Switch } from '@material-ui/core'
import { useT } from '../i18n/useT'
import { Button } from '../design/Button'
import { ProviderCard } from './ProviderCard'
import { errorCode, lyricsApi } from '../lyrics/manageApi'
import styles from './LyricsSettings.module.css'

const POLL_MS = 1500

const SWITCHES = [
  [
    'preferLocal',
    'ui.lyrics.settings.preferLocal',
    'Prefer local files',
    'ui.lyrics.settings.preferLocalHint',
    'Lyrics next to your audio or inside it win over downloaded ones. Turn off to let the best quality win.',
  ],
  [
    'autoRetrieve',
    'ui.lyrics.settings.autoRetrieve',
    'Find missing lyrics automatically',
    'ui.lyrics.settings.autoRetrieveHint',
    'When a track without lyrics plays, look for them online and save them next to the file.',
  ],
  [
    'autoPersist',
    'ui.lyrics.settings.autoPersist',
    'Save found lyrics automatically',
    'ui.lyrics.settings.autoPersistHint',
    'Keep what is found next to the audio, for the providers set to save below. Turn it off to only show results. Nothing is saved over lyrics you added yourself.',
  ],
  [
    'autoUpgrade',
    'ui.lyrics.settings.autoUpgrade',
    'Upgrade downloaded lyrics automatically',
    'ui.lyrics.settings.autoUpgradeHint',
    'Replace downloaded lyrics with better ones (plain to synced, synced to karaoke). Never the other way round.',
  ],
  [
    'autoReplaceManual',
    'ui.lyrics.settings.autoReplaceManual',
    'Also upgrade lyrics I added myself',
    'ui.lyrics.settings.autoReplaceManualHint',
    'Lets an upgrade supersede a .lrc or embedded lyrics. Your files stay untouched, and locked tracks are skipped. Off by default.',
  ],
  [
    'includeProviderTranslations',
    'ui.lyrics.settings.includeProviderTranslations',
    'Include provider translations automatically',
    'ui.lyrics.settings.includeProviderTranslationsHint',
    'Keep the translation that QQ Music, KuGou or NetEase send with the original lyrics when lyrics are found or upgraded automatically. Original lyrics, word timing and romanization are always kept. Saved files are not changed. Off by default.',
  ],
  [
    'exposeTranslationsToClients',
    'ui.lyrics.settings.exposeTranslationsToClients',
    'Send translations to external players',
    'ui.lyrics.settings.exposeTranslationsToClientsHint',
    'External players such as Symfonium show whatever the server sends, and often cannot hide translations. Off, they receive the original lyrics and romanization only. This also applies to this web player. Saved lyrics are not changed. Off by default.',
  ],
]

const BULK = [
  ['missing', 'ui.lyrics.bulk.missing', 'Download missing lyrics'],
  ['upgrade', 'ui.lyrics.bulk.upgrade', 'Look for better lyrics'],
  ['recheck', 'ui.lyrics.bulk.recheck', 'Re-check everything'],
]

const Progress = ({ job, onCancel }) => {
  const t = useT()
  const pct = job.total ? Math.round((job.done / job.total) * 100) : 100
  return (
    <div className={styles.job} role="status">
      <progress
        value={job.done}
        max={job.total || 1}
        aria-label={t('ui.lyrics.bulk.progress', 'Progress')}
      />
      <p className={styles.hint}>
        {t(
          'ui.lyrics.bulk.summary',
          '%{done} of %{total} tracks (%{pct}%) · %{found} found · %{upgraded} upgraded · %{missing} not found · %{unsaved} found but not saveable · %{failed} failed',
          {
            done: job.done,
            total: job.total,
            pct,
            found: job.found,
            upgraded: job.upgraded,
            missing: job.missing,
            unsaved: job.unsaved ?? 0,
            failed: job.failed,
          },
        )}
      </p>
      {job.message && <p className={styles.hint}>{job.message}</p>}
      {job.state === 'running' ? (
        <Button size="sm" onClick={onCancel}>
          {t('ra.action.cancel', 'Cancel')}
        </Button>
      ) : (
        <p className={styles.hint}>
          {job.state === 'cancelled'
            ? t(
                'ui.lyrics.bulk.cancelled',
                'Cancelled. Run it again to continue: tracks that are done are skipped.',
              )
            : t('ui.lyrics.bulk.done', 'Finished.')}
        </p>
      )}
    </div>
  )
}

/** Server-wide lyrics settings, providers and bulk operations (administrators). */
export const LyricsSettings = () => {
  const t = useT()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [job, setJob] = useState(null)
  const [replaceManual, setReplaceManual] = useState(false)
  const [checking, setChecking] = useState(false)
  const timer = useRef(null)

  useEffect(() => {
    let alive = true
    lyricsApi
      .settings()
      .then((d) => alive && setData(d))
      .catch(() => alive && setError('load'))
    return () => {
      alive = false
      clearTimeout(timer.current)
    }
  }, [])

  const save = useCallback(
    async (settings) => {
      const previous = data
      setData((d) => ({ ...d, settings }))
      setError(null)
      try {
        setData(await lyricsApi.saveSettings(settings))
      } catch {
        setData(previous)
        setError('save')
      }
    },
    [data],
  )

  const checkProviders = async () => {
    setChecking(true)
    setError(null)
    try {
      const res = await lyricsApi.checkProviders()
      setData((d) => ({ ...d, providers: res.providers }))
    } catch {
      setError('check')
    } finally {
      setChecking(false)
    }
  }

  const poll = useCallback((id) => {
    lyricsApi
      .bulk(id)
      .then((j) => {
        setJob(j)
        if (j.state === 'running')
          timer.current = setTimeout(() => poll(id), POLL_MS)
      })
      .catch(() => {})
  }, [])

  const start = async (action) => {
    setError(null)
    try {
      const j = await lyricsApi.startBulk({
        action,
        all: true,
        confirm: action === 'replace-manual',
      })
      setJob(j)
      timer.current = setTimeout(() => poll(j.id), POLL_MS)
    } catch (e) {
      setError(errorCode(e) === 'busy' ? 'busy' : 'start')
    }
  }

  const cancel = () =>
    job &&
    lyricsApi
      .cancelBulk(job.id)
      .then(() => poll(job.id))
      .catch(() => {})

  const errorText =
    error &&
    {
      load: t(
        'ui.lyrics.settings.loadFailed',
        'Lyrics settings could not be loaded.',
      ),
      save: t(
        'ui.lyrics.settings.saveFailed',
        'The settings could not be saved.',
      ),
      busy: t('ui.lyrics.bulk.busy', 'Another bulk job is already running.'),
      start: t('ui.lyrics.bulk.failed', 'The job could not be started.'),
      check: t(
        'ui.lyrics.provider.checkFailed',
        'The providers could not be checked.',
      ),
    }[error]

  if (!data) {
    return error ? (
      <p role="alert" className={styles.error}>
        {errorText}
      </p>
    ) : null
  }
  const { settings, providers } = data
  const running = job?.state === 'running'
  const toggleProvider = (id, on) =>
    save({
      ...settings,
      providers: on
        ? [...settings.providers, id]
        : settings.providers.filter((p) => p !== id),
    })

  const setSavePref = (id, on) =>
    save({
      ...settings,
      storePref: { ...(settings.storePref ?? {}), [id]: on },
    })

  // Settings that differ from the recommended ones are never changed behind the
  // administrator's back
  const differences = [
    !settings.preferLocal &&
      t('ui.lyrics.settings.diffPreferLocal', 'Prefer local files is off'),
    settings.autoReplaceManual &&
      t(
        'ui.lyrics.settings.diffReplaceManual',
        'Also upgrade lyrics I added myself is on',
      ),
  ].filter(Boolean)
  const showRecommended =
    differences.length > 0 && !(settings.ack ?? []).includes('recommended')

  return (
    <div className={styles.root}>
      {error && (
        <p role="alert" className={styles.error}>
          {errorText}
        </p>
      )}

      {showRecommended && (
        <div className={styles.notice} role="note">
          <strong>
            {t(
              'ui.lyrics.settings.recommendedTitle',
              'Your settings differ from the recommended ones',
            )}
          </strong>
          <p className={styles.hint}>{differences.join(' · ')}</p>
          <p className={styles.hint}>
            {t(
              'ui.lyrics.settings.recommendedBody',
              'Recommended: local lyrics first, and never replace lyrics you added yourself automatically. Nothing changes unless you choose.',
            )}
          </p>
          <div className={styles.actions}>
            <Button
              size="sm"
              variant="primary"
              onClick={() =>
                save({
                  ...settings,
                  preferLocal: true,
                  autoReplaceManual: false,
                  ack: [...(settings.ack ?? []), 'recommended'],
                })
              }
            >
              {t(
                'ui.lyrics.settings.recommendedUse',
                'Use the recommended settings',
              )}
            </Button>
            <Button
              size="sm"
              onClick={() =>
                save({
                  ...settings,
                  ack: [...(settings.ack ?? []), 'recommended'],
                })
              }
            >
              {t('ui.lyrics.settings.recommendedKeep', 'Keep my settings')}
            </Button>
          </div>
        </div>
      )}

      <p className={styles.hint}>
        {t(
          'ui.lyrics.settings.storage',
          'Downloaded lyrics are saved next to each audio file as .lyrics.json. Replaced versions are kept in the server data folder so they can be restored. Audio files are never modified.',
        )}
      </p>

      <div className={styles.switches}>
        {SWITCHES.map(([key, label, labelDefault, hint, hintDefault]) => (
          <div key={key} className={styles.switch}>
            <FormControlLabel
              labelPlacement="start"
              control={
                <Switch
                  color="primary"
                  checked={!!settings[key]}
                  onChange={(e) =>
                    save({ ...settings, [key]: e.target.checked })
                  }
                />
              }
              label={t(label, labelDefault)}
            />
            <p className={styles.hint}>{t(hint, hintDefault)}</p>
          </div>
        ))}
      </div>

      <h3 className={styles.subtitle}>
        {t('ui.lyrics.settings.providers', 'Providers')}
      </h3>
      <div className={styles.actions}>
        <Button size="sm" disabled={checking} onClick={checkProviders}>
          {checking
            ? t('ui.lyrics.provider.checking', 'Checking…')
            : t('ui.lyrics.provider.check', 'Check providers')}
        </Button>
        <p className={styles.hint}>
          {t(
            'ui.lyrics.provider.checkHint',
            'Asks each provider that is turned on for one well-known song, so the status shows whether it answers now. "Seen working" and "karaoke seen" are measured since the server started and start empty after a restart.',
          )}
        </p>
      </div>
      <ul className={styles.providers}>
        {providers.map((p) => (
          <ProviderCard
            key={p.id}
            p={p}
            onToggle={toggleProvider}
            onSavePref={setSavePref}
          />
        ))}
      </ul>

      <h3 className={styles.subtitle}>
        {t('ui.lyrics.bulk.title', 'Whole library')}
      </h3>
      <p className={styles.hint}>
        {t(
          'ui.lyrics.bulk.hint',
          'One job runs at a time and works on 4 tracks at once, without asking any provider faster than it allows. It can be cancelled. Tracks that are already done are skipped, so running it again continues where it stopped.',
        )}
      </p>
      <div className={styles.actions}>
        {BULK.map(([action, key, label]) => (
          <Button
            key={action}
            size="sm"
            disabled={running}
            onClick={() => start(action)}
          >
            {t(key, label)}
          </Button>
        ))}
      </div>
      <div className={styles.danger}>
        <FormControlLabel
          labelPlacement="start"
          control={
            <Switch
              checked={replaceManual}
              onChange={(e) => setReplaceManual(e.target.checked)}
              inputProps={{
                'aria-label': t(
                  'ui.lyrics.bulk.replaceManualConfirm',
                  'I understand',
                ),
              }}
            />
          }
          label={t('ui.lyrics.bulk.replaceManualConfirm', 'I understand')}
        />
        <p className={styles.hint}>
          {t(
            'ui.lyrics.bulk.replaceManualHint',
            'Supersede .lrc and embedded lyrics with better downloaded ones, across the library. Your files are kept, and locked tracks are skipped.',
          )}
        </p>
        <Button
          size="sm"
          variant="secondary"
          disabled={running || !replaceManual}
          onClick={() => start('replace-manual')}
        >
          {t('ui.lyrics.bulk.replaceManual', 'Upgrade lyrics I added myself')}
        </Button>
      </div>
      {job && <Progress job={job} onCancel={cancel} />}
    </div>
  )
}

export default LyricsSettings
