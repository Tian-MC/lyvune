import React, { useCallback, useEffect, useRef, useState } from 'react'
import { FormControlLabel, Switch } from '@material-ui/core'
import { useT } from '../i18n/useT'
import { Button } from '../design/Button'
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
          '%{done} of %{total} tracks (%{pct}%) · %{found} found · %{upgraded} upgraded · %{missing} not found · %{failed} failed',
          {
            done: job.done,
            total: job.total,
            pct,
            found: job.found,
            upgraded: job.upgraded,
            missing: job.missing,
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

  return (
    <div className={styles.root}>
      {error && (
        <p role="alert" className={styles.error}>
          {errorText}
        </p>
      )}

      <div className={styles.switches}>
        {SWITCHES.map(([key, label, labelDefault, hint, hintDefault]) => (
          <div key={key} className={styles.switch}>
            <FormControlLabel
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
      <ul className={styles.providers}>
        {providers.map((p) => (
          <li key={p.id} className={styles.provider}>
            <FormControlLabel
              control={
                <Switch
                  color="primary"
                  checked={p.enabled}
                  disabled={p.status !== 'ready'}
                  onChange={(e) => toggleProvider(p.id, e.target.checked)}
                  inputProps={{ 'aria-label': p.name }}
                />
              }
              label={<strong>{p.name}</strong>}
            />
            <p className={styles.hint}>
              {p.status === 'ready'
                ? p.verified
                  ? t(
                      'ui.lyrics.provider.verified',
                      'Ready · checked against the live service',
                    )
                  : t(
                      'ui.lyrics.provider.unverified',
                      'Ready · not checked against the live service',
                    )
                : p.reason}
              {p.status === 'ready' &&
                !p.storable &&
                ` · ${t('ui.lyrics.provider.notStored', 'lyrics are shown but not saved')}`}
              {p.status === 'ready' &&
                p.wordSync &&
                ` · ${t('ui.lyrics.manager.wordTiming', 'Word timing')}`}
            </p>
            {p.note && <p className={styles.hint}>{p.note}</p>}
          </li>
        ))}
      </ul>

      <h3 className={styles.subtitle}>
        {t('ui.lyrics.bulk.title', 'Whole library')}
      </h3>
      <p className={styles.hint}>
        {t(
          'ui.lyrics.bulk.hint',
          'One job runs at a time, slowly, and can be cancelled. Tracks that are already done are skipped, so running it again continues where it stopped.',
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
