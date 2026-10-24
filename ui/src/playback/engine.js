import ReactGA from 'react-ga'
import { showNotification } from 'react-admin'
import subsonic from '../subsonic'
import dataProvider from '../dataProvider'
import config from '../config'
import { decisionService, detectBrowserProfile } from '../transcode'
import { calculateGain } from '../utils/calculateReplayGain'
import { sendNotification } from '../utils'
import {
  nextTrack,
  prevTrack,
  setTranscodingProfile,
  setVolume as setVolumeAction,
  trackEnded,
} from '../actions'
import { createReporter } from './reporter'
import { setupMediaSession, updateMediaSession } from './mediaSession'

/**
 * The playback engine owns the single HTMLAudioElement of the application.
 * It lives outside React, so route changes, Now Playing and any page
 * mounting/unmounting can never interrupt audio.
 *
 * Redux (`state.player`) holds the intent — queue, current index, repeat,
 * shuffle, volume — and the engine follows it. Media state that changes many
 * times per second (time, buffering) is published through `subscribe()` and
 * never goes through redux.
 */

const POSITION_KEY = 'nd-playback-position'
const RESTART_THRESHOLD_S = 3
const PREFETCH_AHEAD = 3

const isMobileDevice =
  typeof navigator !== 'undefined' &&
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent,
  )

let store = null
let audio = null
let reporter = null

// What is loaded into the audio element
let loadedItem = null
let srcReady = false
let pendingStart = 0
let loadToken = 0
let retriedUuid = null
let lastPlayRequest = 0
let lastVolume = null
let lastGainKey = null
let announcedUuid = null
// Switching tracks pauses the element briefly; keep the UI in "playing"
let switching = false

// Web Audio graph for ReplayGain (created lazily, only when enabled)
let audioContext = null
let gainNode = null

const listeners = new Set()
let media = {
  currentTime: 0,
  duration: 0,
  buffered: 0,
  paused: true,
  waiting: false,
  error: null,
  uuid: null,
}

const emit = (patch) => {
  media = { ...media, ...patch }
  listeners.forEach((l) => l(media))
}

const getPlayerState = () => store.getState().player
const currentItemOf = (s) => s.queue[s.savedPlayIndex] || null

// ---------------------------------------------------------------------------
// Position persistence (resume after reload)

const savePosition = () => {
  if (!loadedItem || loadedItem.isRadio) return
  try {
    localStorage.setItem(
      POSITION_KEY,
      JSON.stringify({ uuid: loadedItem.uuid, t: media.currentTime }),
    )
  } catch {
    // storage full or unavailable
  }
}

const readSavedPosition = (uuid) => {
  try {
    const saved = JSON.parse(localStorage.getItem(POSITION_KEY))
    return saved && saved.uuid === uuid ? saved.t || 0 : 0
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// Sources

const resolveUrl = (item) => {
  if (item.isRadio) return Promise.resolve(item.musicSrc)
  if (decisionService.getProfile()) {
    return decisionService
      .resolveStreamUrl(item.trackId)
      .catch(() => subsonic.streamUrl(item.trackId))
  }
  return Promise.resolve(subsonic.streamUrl(item.trackId))
}

const prefetchUpcoming = () => {
  const s = getPlayerState()
  const ids = s.queue
    .slice(s.savedPlayIndex + 1, s.savedPlayIndex + 1 + PREFETCH_AHEAD)
    .filter((i) => !i.isRadio)
    .map((i) => i.trackId)
  if (ids.length && decisionService.getProfile()) {
    decisionService.prefetchDecisions(ids)
  }
}

// ---------------------------------------------------------------------------
// ReplayGain

const applyGain = () => {
  const gainInfo = store.getState().replayGain || {}
  const wantsGain =
    config.enableReplayGain &&
    (gainInfo.gainMode === 'album' || gainInfo.gainMode === 'track')

  if (!audioContext && wantsGain && 'AudioContext' in window) {
    audioContext = new AudioContext()
    // we need this to support radios in firefox
    audio.crossOrigin = 'anonymous'
    const source = audioContext.createMediaElementSource(audio)
    gainNode = audioContext.createGain()
    source.connect(gainNode)
    gainNode.connect(audioContext.destination)
  }
  if (gainNode) {
    const song = loadedItem?.song || {}
    gainNode.gain.setValueAtTime(
      calculateGain(gainInfo, song),
      audioContext.currentTime,
    )
  }
}

// ---------------------------------------------------------------------------
// Loading

const setDocumentTitle = (item) => {
  document.title = item
    ? `${item.song?.title || item.name} - ${item.song?.artist || item.singer || ''} - Navidrome`
    : 'Navidrome'
}

const unload = () => {
  reporter.stop(media.currentTime)
  loadToken++
  loadedItem = null
  srcReady = false
  switching = false
  audio.pause()
  audio.removeAttribute('src')
  audio.load()
  setDocumentTitle(null)
  updateMediaSession(null)
  emit({
    currentTime: 0,
    duration: 0,
    buffered: 0,
    paused: true,
    waiting: false,
    error: null,
    uuid: null,
  })
}

const attachSource = async (item, { autoplay, startAt = 0 }) => {
  const token = ++loadToken
  srcReady = false
  pendingStart = startAt
  emit({ waiting: autoplay, error: null })
  let url
  try {
    url = await resolveUrl(item)
  } catch {
    url = subsonic.streamUrl(item.trackId)
  }
  if (token !== loadToken) return
  audio.src = url
  srcReady = true
  applyGain()
  if (autoplay) {
    doPlay()
  }
}

const load = (item, { autoplay, startAt = 0 }) => {
  if (loadedItem && loadedItem.uuid !== item.uuid) {
    reporter.trackChange(media.currentTime)
  }
  loadedItem = item
  retriedUuid = null
  emit({
    uuid: item.uuid,
    currentTime: startAt,
    duration: item.isRadio ? 0 : item.duration || 0,
    buffered: 0,
    paused: !autoplay,
    waiting: !!autoplay,
    error: null,
  })
  setDocumentTitle(item)
  updateMediaSession(item)
  prefetchUpcoming()

  if (autoplay) {
    switching = !audio.paused
    audio.pause()
    attachSource(item, { autoplay, startAt })
  } else {
    // Restored queue: defer the network request until the user presses play
    audio.pause()
    audio.removeAttribute('src')
    srcReady = false
    pendingStart = startAt
    loadToken++
  }
}

const doPlay = () => {
  if (!loadedItem) return
  if (!srcReady) {
    attachSource(loadedItem, { autoplay: true, startAt: pendingStart })
    return
  }
  if (audioContext && audioContext.state !== 'running') {
    audioContext.resume()
  }
  const p = audio.play()
  if (p && p.catch) {
    p.catch((e) => {
      if (e.name === 'NotAllowedError') {
        // Autoplay blocked: show as paused, user can press play
        switching = false
        emit({ paused: true, waiting: false })
      }
    })
  }
}

// ---------------------------------------------------------------------------
// Redux → engine

const onStoreChange = () => {
  const s = getPlayerState()
  const item = currentItemOf(s)
  const playRequest = s.playRequest || 0
  const requested = playRequest !== lastPlayRequest
  lastPlayRequest = playRequest

  if (s.volume !== lastVolume) {
    lastVolume = s.volume
    const v = typeof s.volume === 'number' ? s.volume : 1
    audio.volume = isMobileDevice ? 1 : Math.min(1, Math.max(0, v * v))
  }

  const gainInfo = store.getState().replayGain
  const gainKey = gainInfo && `${gainInfo.gainMode}:${gainInfo.preAmp}`
  if (gainKey !== lastGainKey) {
    lastGainKey = gainKey
    if (loadedItem) applyGain()
  }

  if (!item) {
    if (loadedItem) unload()
    return
  }

  if (!loadedItem || item.uuid !== loadedItem.uuid) {
    const wasPlaying = !!loadedItem && !audio.paused
    const autoplay = requested || wasPlaying
    load(item, {
      autoplay,
      startAt: autoplay ? 0 : readSavedPosition(item.uuid),
    })
    return
  }

  if (requested) {
    // Same item requested again (repeat one, "previous" at the head of the
    // queue, selecting the current row): restart it.
    if (srcReady) {
      audio.currentTime = 0
    } else {
      pendingStart = 0
    }
    emit({ currentTime: 0 })
    doPlay()
  }
}

// ---------------------------------------------------------------------------
// Audio element events

const bindAudioEvents = () => {
  audio.addEventListener('loadedmetadata', () => {
    if (pendingStart > 0 && Number.isFinite(audio.duration)) {
      audio.currentTime = Math.min(pendingStart, audio.duration - 1)
    }
    pendingStart = 0
    emit({
      duration: Number.isFinite(audio.duration)
        ? audio.duration
        : media.duration,
    })
  })
  audio.addEventListener('durationchange', () => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      emit({ duration: audio.duration })
    }
  })
  audio.addEventListener('timeupdate', () => {
    emit({ currentTime: audio.currentTime })
    reporter.position(audio.currentTime)
  })
  audio.addEventListener('progress', () => {
    const b = audio.buffered
    if (b.length) emit({ buffered: b.end(b.length - 1) })
  })
  audio.addEventListener('waiting', () => emit({ waiting: true }))
  audio.addEventListener('playing', () => emit({ waiting: false }))
  audio.addEventListener('canplay', () => emit({ waiting: false }))

  audio.addEventListener('play', () => {
    switching = false
    emit({ paused: false })
    if (!loadedItem) return
    // A restored position is applied once metadata loads, after this event
    reporter.play(
      loadedItem,
      pendingStart > 0 ? pendingStart : audio.currentTime,
    )
    if (announcedUuid !== loadedItem.uuid) {
      announcedUuid = loadedItem.uuid
      announce(loadedItem)
    }
  })

  audio.addEventListener('pause', () => {
    if (switching) return
    emit({ paused: true })
    // 'pause' also fires right before 'ended'
    if (audio.ended || !loadedItem) return
    reporter.pause(audio.currentTime)
    savePosition()
  })

  audio.addEventListener('ended', () => {
    announcedUuid = null
    emit({ paused: true })
    reporter.ended(loadedItem, audio.duration)
    if (loadedItem && !loadedItem.isRadio) {
      dataProvider
        .getOne('keepalive', { id: loadedItem.trackId })
        // eslint-disable-next-line no-console
        .catch((e) => console.log('Keepalive error:', e))
    }
    store.dispatch(trackEnded())
  })

  audio.addEventListener('seeked', () => {
    emit({ currentTime: audio.currentTime })
    reporter.seeked(audio.currentTime, audio.paused)
  })

  audio.addEventListener('volumechange', () => emit({ muted: audio.muted }))

  audio.addEventListener('error', () => {
    if (!loadedItem || !audio.getAttribute('src')) return
    // Invalidate all cached decisions — token may be stale
    decisionService.invalidateAll()
    if (retriedUuid !== loadedItem.uuid) {
      retriedUuid = loadedItem.uuid
      attachSource(loadedItem, {
        autoplay: true,
        startAt: audio.currentTime || 0,
      })
      return
    }
    emit({ error: 'load', waiting: false, paused: true })
    store.dispatch(showNotification('ra.notification.http_error', 'warning'))
    const s = getPlayerState()
    if (s.savedPlayIndex < s.queue.length - 1) {
      store.dispatch(nextTrack())
    }
  })
}

const announce = (item) => {
  const song = item.song || {}
  if (config.gaTrackingId) {
    ReactGA.event({
      category: 'Player',
      action: 'Play song',
      label: `${song.title} - ${song.artist}`,
    })
  }
  if (store.getState().settings?.notifications) {
    sendNotification(
      song.title || item.name,
      `${song.artist || ''} - ${song.album || ''}`,
      item.cover,
    )
  }
}

const bindWindowEvents = () => {
  window.addEventListener('beforeunload', (e) => {
    if (loadedItem && !audio.paused) {
      e.preventDefault()
      e.returnValue = ''
    }
  })
  window.addEventListener('pagehide', () => {
    savePosition()
    reporter.pageHide()
  })
  // Throttled persistence of the position while playing
  setInterval(() => {
    if (loadedItem && !audio.paused) savePosition()
  }, 5000)
}

// ---------------------------------------------------------------------------
// Public API

const init = (reduxStore) => {
  if (store) return
  store = reduxStore
  audio = new Audio()
  audio.preload = 'auto'
  reporter = createReporter()

  const profile = detectBrowserProfile()
  decisionService.setProfile(profile)
  store.dispatch(setTranscodingProfile(profile))

  lastPlayRequest = getPlayerState().playRequest || 0
  bindAudioEvents()
  bindWindowEvents()
  setupMediaSession(api)
  onStoreChange()
  store.subscribe(onStoreChange)
}

const play = () => doPlay()

const pause = () => {
  if (audio) audio.pause()
}

const toggle = () => {
  if (!loadedItem) return
  if (audio.paused) play()
  else pause()
}

const seek = (time) => {
  if (!loadedItem || loadedItem.isRadio) return
  const t = Math.max(0, Math.min(time, media.duration || time))
  if (srcReady) {
    audio.currentTime = t
  } else {
    pendingStart = t
  }
  emit({ currentTime: t })
}

const seekBy = (delta) => seek(media.currentTime + delta)

const next = () => store.dispatch(nextTrack())

const prev = () => {
  if (media.currentTime > RESTART_THRESHOLD_S && !loadedItem?.isRadio) {
    seek(0)
    return
  }
  store.dispatch(prevTrack())
}

const setVolume = (value) =>
  store.dispatch(setVolumeAction(Math.min(1, Math.max(0, value))))

const toggleMute = () => {
  if (audio) {
    audio.muted = !audio.muted
    emit({ muted: audio.muted })
  }
}

const subscribe = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const getMedia = () => media

// Precise clock for word-level lyrics (media.currentTime updates at ~4 Hz)
const currentTime = () => (audio ? audio.currentTime : 0)

const api = {
  init,
  play,
  pause,
  toggle,
  seek,
  seekBy,
  next,
  prev,
  setVolume,
  toggleMute,
  subscribe,
  getMedia,
  currentTime,
  canControlVolume: !isMobileDevice,
}

export default api

// Hot-swapping this module would leave a second audio element playing;
// edits to the engine reload the page instead (development only).
if (import.meta.hot) {
  import.meta.hot.decline()
}
