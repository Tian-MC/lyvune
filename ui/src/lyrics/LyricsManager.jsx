import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@material-ui/core'
import clsx from 'clsx'
import { useT } from '../i18n/useT'
import { Button } from '../design/Button'
import { CloseIcon } from '../design/icons'
import { IconButton } from '../design/IconButton'
import { ManagerCurrent } from './ManagerCurrent'
import { ManagerSearch } from './ManagerSearch'
import { bumpLyrics } from './lyricsSignals'
import { errorCode, lyricsApi } from './manageApi'
import { sourceLabel } from './lyricsSource'
import { forgetSearch, peekSearch, searchLyrics } from './searchCache'
import { useLyricsStatus } from './useLyricsStatus'
import styles from './LyricsManager.module.css'

const MAX_IMPORT_BYTES = 2 * 1024 * 1024

const readText = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })

/** Wording for each failure the API can report. */
const errorText = (t, e) => {
  switch (errorCode(e)) {
    case 'locked':
      return t('ui.lyrics.error.locked', 'These lyrics are locked.')
    case 'storage-restricted':
      return t(
        'ui.lyrics.error.storageRestricted',
        'The terms recorded for this provider do not allow keeping its lyrics. They can still be shown.',
      )
    case 'save-unverified':
      return t(
        'ui.lyrics.error.saveUnverified',
        'The lyrics were written but could not be read back as saved, so they are not reported as saved.',
      )
    case 'not-storable':
      return t(
        'ui.lyrics.error.notStorable',
        'These lyrics may neither be kept nor shown by this server. They can only be previewed.',
      )
    case 'no-candidate':
      return t(
        'ui.lyrics.error.noCandidate',
        'That result is no longer available. Search again.',
      )
    case 'empty':
      return t('ui.lyrics.error.empty', 'There are no usable lyrics in that.')
    case 'not-found':
      return t(
        'ui.lyrics.error.notFound',
        'There is nothing to restore or delete.',
      )
    case 'not-local':
      return t(
        'ui.lyrics.error.notLocal',
        'Lyrics can only be saved for libraries on a local disk.',
      )
    case 'read-only':
      return t(
        'ui.lyrics.error.readOnly',
        'The library folder cannot be written to.',
      )
    case 'unsafe-path':
      return t(
        'ui.lyrics.error.unsafePath',
        'That location is not safe to write to.',
      )
    case 'not-managed':
      return t(
        'ui.lyrics.error.notManaged',
        'A file with that name exists that Lyvune did not write, so it was left alone.',
      )
    default:
      return e?.status === 403
        ? t(
            'ui.lyrics.error.forbidden',
            'Only an administrator can change lyrics.',
          )
        : t('ui.lyrics.error.failed', 'The lyrics could not be changed.')
  }
}

const emptySearch = {
  loading: false,
  done: false,
  candidates: [],
  providers: [],
  error: null,
}

/**
 * Lyrics manager: see where a track's lyrics come from and change them. Every
 * replacement of lyrics someone supplied or chose is confirmed first, says what
 * happens to the original files, and can be undone.
 */
export const LyricsManager = ({ trackId, title, onClose }) => {
  const t = useT()
  const { data, status, set } = useLyricsStatus(trackId)
  const [tab, setTab] = useState('current')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [pending, setPending] = useState(null)
  const [search, setSearch] = useState(emptySearch)
  const alive = useRef(true)
  useEffect(() => () => (alive.current = false), [])
  // The track a search answer is for: one that arrives after switching to
  // another track is not shown for it
  const shownTrack = useRef(trackId)
  // A different track means a different manager: forget its prompts, and show
  // the results of a search made for it earlier in this session, if any
  useEffect(() => {
    shownTrack.current = trackId
    const cached = peekSearch(trackId)
    setSearch(cached ? { ...emptySearch, done: true, ...cached } : emptySearch)
    setPending(null)
    setNotice(null)
  }, [trackId])

  const changed = useCallback(
    (res) => {
      if (res?.status) set(res.status)
      bumpLyrics(trackId)
    },
    [set, trackId],
  )

  const run = useCallback(
    async (action, success) => {
      setBusy(true)
      setNotice(null)
      try {
        const res = await action()
        if (!alive.current) return null
        changed(res)
        if (success) setNotice({ kind: 'ok', text: success, undo: res?.undo })
        return res
      } catch (e) {
        if (alive.current)
          setNotice({
            kind: 'error',
            text: errorText(t, e),
            code: errorCode(e),
          })
        throw e
      } finally {
        if (alive.current) setBusy(false)
      }
    },
    [changed, t],
  )

  const reload = useCallback(
    () => lyricsApi.status(trackId).then(set),
    [set, trackId],
  )

  const restore = useCallback(
    (version) =>
      run(
        () => lyricsApi.restore(trackId, version),
        t('ui.lyrics.manager.restored', 'Restored.'),
      ).catch(() => {}),
    [run, t, trackId],
  )

  // Ask for what the user chose, and turn "needs confirmation" / "locked" into a prompt
  const attempt = useCallback(
    async (kind, payload, opts = {}) => {
      const call =
        kind === 'import'
          ? () =>
              lyricsApi.importLyrics(trackId, {
                ...payload,
                confirm: !!opts.confirm,
                force: !!opts.force,
              })
          : () =>
              lyricsApi.apply(trackId, {
                candidateId: payload.id,
                confirm: !!opts.confirm,
                force: !!opts.force,
                ...(opts.mode && { mode: opts.mode }),
              })
      setBusy(true)
      setNotice(null)
      try {
        const res = await call()
        if (!alive.current) return
        setPending(null)
        changed(res)
        setNotice({
          kind: 'ok',
          text: res?.notSaved
            ? t(
                'ui.lyrics.manager.appliedShown',
                'Shown, not saved. It is held in memory only: gone after a restart and not available offline.',
              )
            : opts.mode === 'save' || payload.storable
              ? t(
                  'ui.lyrics.manager.appliedSaved',
                  'Saved locally and read back. It stays available offline.',
                )
              : t('ui.lyrics.manager.applied', 'Lyrics updated.'),
          undo: res?.undo,
        })
      } catch (e) {
        if (!alive.current) return
        const code = errorCode(e)
        if (code === 'no-candidate') {
          // The server no longer has that search: so the results shown are stale
          forgetSearch(trackId)
          setSearch(emptySearch)
        }
        if (code === 'confirm-required')
          setPending({ kind, payload, locked: false, mode: opts.mode })
        else if (code === 'locked')
          setPending({ kind, payload, locked: true, mode: opts.mode })
        else {
          setPending(null)
          setNotice({ kind: 'error', text: errorText(t, e) })
        }
      } finally {
        if (alive.current) setBusy(false)
      }
    },
    [changed, t, trackId],
  )

  // A search made earlier in this page session is shown again without asking
  // the server; `refresh` (the "Search again" button) always asks
  const doSearch = useCallback(
    async (refresh = false) => {
      setTab('find')
      const id = trackId
      const cached = !refresh && peekSearch(id)
      if (cached) {
        setSearch({ ...emptySearch, done: true, ...cached })
        return
      }
      setSearch({ ...emptySearch, loading: true })
      try {
        const res = await searchLyrics(id, { refresh })
        if (alive.current && shownTrack.current === id)
          setSearch({ ...emptySearch, done: true, ...res })
      } catch (e) {
        if (alive.current && shownTrack.current === id)
          setSearch({ ...emptySearch, done: true, error: errorText(t, e) })
      }
    },
    [t, trackId],
  )

  const importFile = useCallback(
    async (file) => {
      if (file.size > MAX_IMPORT_BYTES) {
        setNotice({
          kind: 'error',
          text: t(
            'ui.lyrics.manager.tooLarge',
            'That file is too large (2 MB at most).',
          ),
        })
        return
      }
      try {
        const content = await readText(file)
        await attempt('import', { fileName: file.name, content })
      } catch {
        setNotice({
          kind: 'error',
          text: t('ui.lyrics.error.unreadable', 'That file could not be read.'),
        })
      }
    },
    [attempt, t],
  )

  const cur = data?.current
  const explain = () => {
    const where = cur ? sourceLabel(t, cur) : ''
    if (pending.locked) {
      return t(
        'ui.lyrics.manager.confirmLocked',
        'These lyrics are locked. Replace them anyway? The lock stays on.',
      )
    }
    switch (cur?.source) {
      case 'sidecar':
        return t(
          'ui.lyrics.manager.confirmSidecar',
          '%{where} stays where it is, untouched, but the version you chose is shown instead.',
          { where },
        )
      case 'embedded':
        return t(
          'ui.lyrics.manager.confirmEmbedded',
          'The lyrics inside the audio file are not changed, but the version you chose is shown instead.',
        )
      default:
        return t(
          'ui.lyrics.manager.confirmUser',
          'This replaces the version you chose earlier. You can restore it from the history.',
        )
    }
  }

  const choose = (candidate, mode) => attempt('apply', candidate, { mode })

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="md"
      aria-labelledby="lyrics-manager-title"
    >
      <DialogTitle disableTypography className={styles.title}>
        <div>
          <h2 id="lyrics-manager-title" className={styles.heading}>
            {t('ui.lyrics.manager.title', 'Manage lyrics')}
          </h2>
          {title && <p className={styles.subtitle}>{title}</p>}
        </div>
        <IconButton
          size="sm"
          icon={CloseIcon}
          label={t('ra.action.close', 'Close')}
          onClick={onClose}
        />
      </DialogTitle>
      <DialogContent className={styles.content}>
        <div className={styles.tabs} role="tablist">
          {[
            ['current', t('ui.lyrics.manager.tabCurrent', 'Current lyrics')],
            ['find', t('ui.lyrics.manager.tabFind', 'Find lyrics')],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={clsx(styles.tab, tab === id && styles.tabActive)}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div aria-live="polite">
          {notice && (
            <p
              role={notice.kind === 'error' ? 'alert' : 'status'}
              className={
                notice.kind === 'error' ? styles.error : styles.success
              }
            >
              {notice.text}
              {notice.undo && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => restore(notice.undo)}
                  disabled={busy}
                >
                  {t('ui.lyrics.manager.undo', 'Undo')}
                </Button>
              )}
            </p>
          )}
        </div>

        {pending && (
          <div
            role="group"
            aria-label={t('ui.lyrics.manager.confirm', 'Confirm')}
            className={styles.confirm}
          >
            <p>{explain()}</p>
            <div className={styles.row}>
              <Button
                size="sm"
                onClick={() => setPending(null)}
                disabled={busy}
              >
                {t('ra.action.cancel', 'Cancel')}
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={busy}
                onClick={() =>
                  attempt(pending.kind, pending.payload, {
                    confirm: true,
                    force: pending.locked,
                    mode: pending.mode,
                  })
                }
              >
                {pending.locked
                  ? t('ui.lyrics.manager.replaceAnyway', 'Replace anyway')
                  : t('ui.lyrics.manager.replace', 'Replace')}
              </Button>
            </div>
          </div>
        )}

        {status === 'error' && (
          <p role="alert" className={styles.error}>
            {t(
              'ui.lyrics.manager.loadFailed',
              'The lyrics state could not be loaded.',
            )}
          </p>
        )}

        {tab === 'current' && data && (
          <ManagerCurrent
            data={data}
            busy={busy}
            onLock={(locked) =>
              run(() =>
                lyricsApi.lock(trackId, locked).then((s) => ({ status: s })),
              ).catch(() => {})
            }
            onOffset={(ms) =>
              run(() =>
                lyricsApi.offset(trackId, ms).then((s) => ({ status: s })),
              ).catch(() => {})
            }
            onUse={(source) => choose({ id: source.id })}
            onRestore={restore}
            onDelete={() =>
              run(
                () => lyricsApi.remove(trackId),
                t('ui.lyrics.manager.deleted', 'Saved lyrics deleted.'),
              ).catch(() => {})
            }
            onImport={importFile}
            onFindBetter={() => doSearch()}
          />
        )}
        {tab === 'find' && (
          <ManagerSearch
            search={search}
            busy={busy}
            onSearch={doSearch}
            onUse={choose}
          />
        )}
        {tab === 'current' && !data && status === 'loading' && (
          <div className={styles.loading} aria-busy="true" />
        )}
      </DialogContent>
    </Dialog>
  )
}

export default LyricsManager
