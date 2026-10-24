import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { ThemeProvider, createTheme } from '@material-ui/core/styles'
import config, { shareInfo } from '../config'
import { shareCoverUrl, shareDownloadUrl, shareStreamUrl } from '../utils'
import { formatClock } from '../utils/formatters'
import { i18nProvider } from '../i18n'
import { NavidromeTheme } from '../design/muiTheme'
import { IconButton } from '../design/IconButton'
import { Button } from '../design/Button'
import { Slider } from '../design/Slider'
import { EmptyState, PlayingBars } from '../design/Section'
import {
  AlertIcon,
  DownloadIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  SongIcon,
} from '../design/icons'
import { LogoMark } from '../shell/Logo'
import styles from './SharePlayer.module.css'

// How long the download button stays inert after a click. The browser needs a
// moment to show its own download UI; until then the page looks unresponsive.
export const DOWNLOAD_FEEDBACK_MS = 5000

const RESTART_THRESHOLD_S = 3

// The public page has no react-admin context; translate straight from the
// provider (bundled English, or the visitor's cached language).
const t = (key, fallback, options) =>
  i18nProvider.translate(key, { _: fallback, ...options })

const muiTheme = createTheme(NavidromeTheme)

/** One audio element for the page; the share page never navigates. */
const useShareAudio = (tracks) => {
  const audio = useMemo(() => {
    const a = new Audio()
    a.preload = 'metadata'
    return a
  }, [])
  const [index, setIndex] = useState(0)
  const [state, setState] = useState({
    paused: true,
    time: 0,
    duration: tracks[0]?.duration || 0,
    error: false,
  })
  const pendingPlay = useRef(false)

  useEffect(() => {
    const track = tracks[index]
    if (!track) return
    audio.src = shareStreamUrl(track.id)
    setState((s) => ({
      ...s,
      time: 0,
      duration: track.duration || 0,
      error: false,
    }))
    if (pendingPlay.current) audio.play().catch(() => {})
  }, [audio, index, tracks])

  useEffect(() => {
    const update = (patch) => setState((s) => ({ ...s, ...patch }))
    const handlers = {
      play: () => update({ paused: false }),
      pause: () => update({ paused: true }),
      timeupdate: () => update({ time: audio.currentTime }),
      durationchange: () =>
        Number.isFinite(audio.duration) && update({ duration: audio.duration }),
      error: () => update({ error: true, paused: true }),
      ended: () => {
        setIndex((i) => {
          if (i < tracks.length - 1) {
            pendingPlay.current = true
            return i + 1
          }
          return i
        })
      },
    }
    Object.entries(handlers).forEach(([e, h]) => audio.addEventListener(e, h))
    return () => {
      Object.entries(handlers).forEach(([e, h]) =>
        audio.removeEventListener(e, h),
      )
      audio.pause()
    }
  }, [audio, tracks.length])

  const play = useCallback(() => {
    pendingPlay.current = true
    audio.play().catch(() => {})
  }, [audio])
  const pause = useCallback(() => {
    pendingPlay.current = false
    audio.pause()
  }, [audio])
  const toggle = useCallback(
    () => (audio.paused ? play() : pause()),
    [audio, play, pause],
  )
  const select = useCallback(
    (i) => {
      pendingPlay.current = true
      if (i === index) {
        audio.currentTime = 0
        audio.play().catch(() => {})
      } else {
        setIndex(i)
      }
    },
    [audio, index],
  )
  const next = useCallback(() => {
    if (index < tracks.length - 1) select(index + 1)
  }, [index, tracks.length, select])
  const prev = useCallback(() => {
    if (audio.currentTime > RESTART_THRESHOLD_S || index === 0) {
      audio.currentTime = 0
    } else {
      select(index - 1)
    }
  }, [audio, index, select])
  const seek = useCallback((v) => (audio.currentTime = v), [audio])

  return { index, ...state, play, pause, toggle, select, next, prev, seek }
}

const useMediaSession = (track, player) => {
  useEffect(() => {
    if (!('mediaSession' in navigator) || !track) return
    try {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: track.album,
        artwork: [{ src: shareCoverUrl(track.id, true), sizes: '300x300' }],
      })
      navigator.mediaSession.setActionHandler('play', player.play)
      navigator.mediaSession.setActionHandler('pause', player.pause)
      navigator.mediaSession.setActionHandler('nexttrack', player.next)
      navigator.mediaSession.setActionHandler('previoustrack', player.prev)
    } catch {
      // unsupported action
    }
  }, [track, player.play, player.pause, player.next, player.prev])
}

const SharePlayerView = ({ info }) => {
  const tracks = info.tracks
  const player = useShareAudio(tracks)
  const track = tracks[player.index]
  const [downloading, setDownloading] = useState(false)
  const timer = useRef(null)
  const single = tracks.length === 1
  const canDownload = info.downloadable && config.enableDownloads
  useMediaSession(track, player)

  useEffect(() => () => clearTimeout(timer.current), [])

  useEffect(() => {
    document.title = track ? `${track.title} - ${track.artist}` : 'Navidrome'
  }, [track])

  // Space toggles playback unless a control has focus
  useEffect(() => {
    const onKey = (e) => {
      if (e.code === 'Space' && !e.target.closest?.('button, input, a')) {
        e.preventDefault()
        player.toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [player])

  // An anchor, not a navigation: the service worker's NavigationRoute would
  // intercept the streamed archive and fail it.
  const download = useCallback(() => {
    const link = document.createElement('a')
    link.href = shareDownloadUrl(info.id)
    link.download = ''
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)

    setDownloading(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(
      () => setDownloading(false),
      DOWNLOAD_FEEDBACK_MS,
    )
  }, [info.id])

  const title = info.description || (single ? track.title : track.album)

  return (
    <div className={styles.page}>
      <div className={styles.backdrop} aria-hidden>
        <img key={track.id} src={shareCoverUrl(track.id, true)} alt="" />
      </div>

      <header className={styles.brand}>
        <LogoMark size={26} />
        <span>Navidrome</span>
      </header>

      <main className={styles.main}>
        <section
          className={styles.player}
          aria-label={t('ui.player.label', 'Player')}
        >
          <div className={styles.cover}>
            <img key={track.id} src={shareCoverUrl(track.id, true)} alt="" />
          </div>

          <div className={styles.info}>
            <p className={styles.eyebrow}>
              {t('ui.share.shared', 'Shared with you')}
            </p>
            <h1 className={styles.shareTitle}>{title}</h1>
            <p className={styles.trackLine}>
              {track.title !== title && (
                <span className={styles.trackTitle}>{track.title}</span>
              )}
              <span className={styles.trackArtist}>{track.artist}</span>
            </p>
          </div>

          {player.error ? (
            <p className={styles.error} role="alert">
              <AlertIcon size={16} aria-hidden />
              {t(
                'ui.share.playbackError',
                'This track cannot be played. The link may have expired.',
              )}
            </p>
          ) : (
            <div className={styles.timeline}>
              <Slider
                variant="large"
                value={player.time}
                max={player.duration || 0}
                step={0.1}
                label={t('ui.player.seek', 'Seek')}
                valueText={`${formatClock(player.time)} / ${formatClock(player.duration)}`}
                disabled={!player.duration}
                onCommit={player.seek}
              />
              <div className={clsx(styles.times, 'nd-tabular')}>
                <span>{formatClock(player.time)}</span>
                <span>{formatClock(player.duration)}</span>
              </div>
            </div>
          )}

          <div className={styles.controls}>
            <IconButton
              size="lg"
              icon={PrevIcon}
              label={t('player.previousTrackText', 'Previous track')}
              onClick={player.prev}
            />
            <IconButton
              size="xl"
              variant="light"
              icon={player.paused ? PlayIcon : PauseIcon}
              iconSize={26}
              label={
                player.paused
                  ? t('player.clickToPlayText', 'Play')
                  : t('player.clickToPauseText', 'Pause')
              }
              onClick={player.toggle}
              className={styles.play}
            />
            <IconButton
              size="lg"
              icon={NextIcon}
              label={t('player.nextTrackText', 'Next track')}
              onClick={player.next}
              disabled={single || player.index >= tracks.length - 1}
            />
          </div>

          {canDownload && (
            <Button
              variant="secondary"
              icon={DownloadIcon}
              onClick={download}
              disabled={downloading}
              className={styles.download}
            >
              {t('ra.action.download', 'Download')}
            </Button>
          )}
        </section>

        {!single && (
          <section
            className={styles.list}
            aria-label={t('resources.song.name', 'Songs', { smart_count: 2 })}
          >
            <ol>
              {tracks.map((tr, i) => {
                const current = i === player.index
                return (
                  <li key={tr.id}>
                    <button
                      type="button"
                      className={clsx(styles.row, current && styles.current)}
                      onClick={() => player.select(i)}
                      aria-current={current ? 'true' : undefined}
                    >
                      <span className={clsx(styles.num, 'nd-tabular')}>
                        {current ? (
                          <PlayingBars playing={!player.paused} />
                        ) : (
                          i + 1
                        )}
                      </span>
                      <span className={styles.rowText}>
                        <span className={styles.rowTitle}>{tr.title}</span>
                        <span className={styles.rowArtist}>{tr.artist}</span>
                      </span>
                      <span className={clsx(styles.rowTime, 'nd-tabular')}>
                        {formatClock(tr.duration)}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </section>
        )}
      </main>
    </div>
  )
}

/** Public page for a shared link (rendered instead of the app). */
const SharePlayer = () => (
  <ThemeProvider theme={muiTheme}>
    {shareInfo?.tracks?.length ? (
      <SharePlayerView info={shareInfo} />
    ) : (
      <div className={styles.page}>
        <main className={styles.emptyMain}>
          <EmptyState
            icon={SongIcon}
            title={t('ui.share.empty', 'Nothing to play')}
          >
            {t(
              'ui.share.emptyHint',
              'This shared link has no playable tracks. It may have been changed or removed.',
            )}
          </EmptyState>
        </main>
      </div>
    )}
  </ThemeProvider>
)

export default SharePlayer
