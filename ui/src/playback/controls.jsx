import React, { memo, useEffect, useRef } from 'react'
import clsx from 'clsx'
import { useDispatch } from 'react-redux'
import { useT } from '../i18n/useT'
import { IconButton } from '../design/IconButton'
import { Slider } from '../design/Slider'
import {
  MuteIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShuffleIcon,
  VolumeIcon,
  VolumeLowIcon,
} from '../design/icons'
import { setRepeat, toggleShuffle } from '../actions'
import { REPEAT_ALL, REPEAT_OFF, REPEAT_ONE } from '../reducers/playerReducer'
import { formatClock } from '../utils/formatters'
import engine from './engine'
import {
  useCurrentItem,
  useMedia,
  usePlaybackTime,
  usePlayerSettings,
  useTransport,
} from './hooks'
import styles from './controls.module.css'

const nextRepeat = { off: REPEAT_ALL, all: REPEAT_ONE, one: REPEAT_OFF }

export const PlayPauseButton = memo(({ size = 'lg', variant = 'light' }) => {
  const t = useT()
  const { paused, waiting } = useTransport()
  const label = paused
    ? t('player.clickToPlayText', 'Play')
    : t('player.clickToPauseText', 'Pause')
  return (
    <IconButton
      size={size}
      variant={variant}
      icon={paused ? PlayIcon : PauseIcon}
      iconSize={size === 'xl' ? 28 : size === 'lg' ? 22 : 18}
      label={label}
      className={clsx(styles.playPause, paused && styles.isPaused)}
      onClick={(e) => {
        e.stopPropagation()
        engine.toggle()
      }}
      aria-busy={waiting && !paused ? true : undefined}
      data-primary
    >
      {waiting && !paused && <span className={styles.spinner} aria-hidden />}
    </IconButton>
  )
})

PlayPauseButton.displayName = 'PlayPauseButton'

export const TransportControls = memo(
  ({ size = 'md', playSize = 'lg', showModes = true, className }) => {
    const t = useT()
    const dispatch = useDispatch()
    const { shuffle, repeat } = usePlayerSettings()
    const item = useCurrentItem()
    const isRadio = !!item?.isRadio
    const stop = (fn) => (e) => {
      e.stopPropagation()
      fn()
    }
    const repeatLabel = {
      off: t('ui.player.repeatOff', 'Repeat: off'),
      all: t('player.playModeText.orderLoop', 'Repeat'),
      one: t('player.playModeText.singleLoop', 'Repeat One'),
    }[repeat]
    return (
      <div className={clsx(styles.transport, className)}>
        {showModes && (
          <IconButton
            size={size}
            icon={ShuffleIcon}
            label={t('player.playModeText.shufflePlay', 'Shuffle')}
            active={shuffle}
            pressed={shuffle}
            disabled={isRadio}
            onClick={stop(() => dispatch(toggleShuffle()))}
          />
        )}
        <IconButton
          size={size}
          icon={PrevIcon}
          label={t('player.previousTrackText', 'Previous track')}
          onClick={stop(engine.prev)}
          className={styles.skip}
        />
        <PlayPauseButton size={playSize} />
        <IconButton
          size={size}
          icon={NextIcon}
          label={t('player.nextTrackText', 'Next track')}
          onClick={stop(engine.next)}
          className={styles.skip}
        />
        {showModes && (
          <IconButton
            size={size}
            icon={repeat === 'one' ? RepeatOneIcon : RepeatIcon}
            label={repeatLabel}
            active={repeat !== 'off'}
            pressed={repeat !== 'off'}
            onClick={stop(() => dispatch(setRepeat(nextRepeat[repeat])))}
          />
        )}
      </div>
    )
  },
)

TransportControls.displayName = 'TransportControls'

export const Timeline = memo(({ variant = 'default', className }) => {
  const t = useT()
  const { currentTime, duration, buffered } = usePlaybackTime()
  const item = useCurrentItem()
  const isRadio = !!item?.isRadio
  if (isRadio) {
    return (
      <div className={clsx(styles.timeline, styles.live, className)}>
        <span className={styles.liveBadge}>{t('ui.player.live', 'Live')}</span>
      </div>
    )
  }
  return (
    <div className={clsx(styles.timeline, styles[variant], className)}>
      <span className={clsx(styles.time, 'nd-tabular')}>
        {formatClock(currentTime)}
      </span>
      <Slider
        className={styles.seek}
        value={currentTime}
        max={duration || 0}
        step={0.1}
        buffered={buffered}
        variant={variant === 'large' ? 'large' : 'default'}
        label={t('ui.player.seek', 'Seek')}
        valueText={`${formatClock(currentTime)} / ${formatClock(duration)}`}
        disabled={!duration}
        onCommit={(v) => engine.seek(v)}
      />
      <span className={clsx(styles.time, styles.timeEnd, 'nd-tabular')}>
        {formatClock(duration)}
      </span>
    </div>
  )
})

Timeline.displayName = 'Timeline'

/** Thin progress line (mobile mini player). */
export const ProgressLine = memo(() => {
  const pct = useMedia((m) =>
    m.duration > 0 ? Math.round((m.currentTime / m.duration) * 400) / 4 : 0,
  )
  return (
    <div className={styles.progressLine} aria-hidden>
      <div style={{ transform: `scaleX(${pct / 100})` }} />
    </div>
  )
})

ProgressLine.displayName = 'ProgressLine'

const WHEEL_VOLUME_STEP = 0.05

export const VolumeControl = memo(({ className }) => {
  const t = useT()
  const { volume } = usePlayerSettings()
  const muted = useMedia((m) => !!m.muted)
  const rootRef = useRef(null)
  const current = useRef({ volume, muted })
  current.current = { volume, muted }

  // Scrolling over the control changes the volume. The listener is not passive,
  // or the page would scroll along with it
  useEffect(() => {
    const el = rootRef.current
    if (!el) return undefined
    const onWheel = (e) => {
      if (!e.deltaY) return
      e.preventDefault()
      const { volume: v, muted: m } = current.current
      if (m && e.deltaY < 0) engine.toggleMute()
      const base = m ? 0 : v
      const next =
        base + (e.deltaY < 0 ? WHEEL_VOLUME_STEP : -WHEEL_VOLUME_STEP)
      engine.setVolume(Math.round(next * 100) / 100)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  if (!engine.canControlVolume) return null
  const Icon =
    muted || volume === 0 ? MuteIcon : volume < 0.5 ? VolumeLowIcon : VolumeIcon
  return (
    <div ref={rootRef} className={clsx(styles.volume, className)}>
      <IconButton
        size="sm"
        icon={Icon}
        label={t('player.volumeText', 'Volume')}
        pressed={muted}
        onClick={(e) => {
          e.stopPropagation()
          engine.toggleMute()
        }}
      />
      <Slider
        className={styles.volumeSlider}
        value={muted ? 0 : volume}
        max={1}
        step={0.01}
        label={t('player.volumeText', 'Volume')}
        valueText={`${Math.round((muted ? 0 : volume) * 100)}%`}
        onChange={(v) => engine.setVolume(v)}
      />
    </div>
  )
})

VolumeControl.displayName = 'VolumeControl'
