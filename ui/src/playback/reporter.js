import subsonic from '../subsonic'
import config from '../config'

/**
 * Server playback reporting (Subsonic `reportPlayback`), with the exact
 * semantics of the previous player: `starting` + `playing` when a track
 * starts, `playing` on resume and as a heartbeat, `paused`, `stopped` on track
 * change / end / queue clear, debounced reports after seeking, and a keepalive
 * `stopped` when the page is hidden. Radios are never reported.
 */
export const createReporter = () => {
  let trackId = null
  let lastPositionMs = 0
  let heartbeat = null
  let seekTimer = null
  let pageHidden = false

  const stopHeartbeat = () => {
    if (heartbeat) clearInterval(heartbeat)
    heartbeat = null
  }

  const startHeartbeat = () => {
    stopHeartbeat()
    heartbeat = setInterval(() => {
      if (trackId && !pageHidden) {
        subsonic.reportPlayback(trackId, lastPositionMs, 'playing')
      }
    }, config.playbackReportIntervalMs)
  }

  const toMs = (seconds) => Math.floor((seconds || 0) * 1000)

  const finish = (positionMs) => {
    if (trackId) {
      subsonic.reportPlayback(trackId, positionMs, 'stopped')
    }
    stopHeartbeat()
    trackId = null
  }

  return {
    /** Playback started or resumed. */
    play(item, seconds) {
      pageHidden = false
      if (item.isRadio) return
      const posMs = toMs(seconds)
      lastPositionMs = posMs
      if (item.trackId !== trackId) {
        trackId = item.trackId
        const id = trackId
        subsonic
          .reportPlayback(id, posMs, 'starting')
          .then(() => subsonic.reportPlayback(id, posMs, 'playing'))
          .catch(() => {})
      } else {
        subsonic.reportPlayback(trackId, posMs, 'playing')
      }
      startHeartbeat()
    },

    pause(seconds) {
      if (!trackId) return
      lastPositionMs = toMs(seconds)
      subsonic.reportPlayback(trackId, lastPositionMs, 'paused')
      stopHeartbeat()
    },

    ended(item, durationSeconds) {
      if (item && item.isRadio) return
      finish(toMs(durationSeconds || item?.duration))
    },

    trackChange() {
      finish(lastPositionMs)
    },

    stop() {
      finish(lastPositionMs)
    },

    position(seconds) {
      if (trackId) lastPositionMs = toMs(seconds)
    },

    /** Every seek is reported; the debounce coalesces drag bursts. */
    seeked(seconds, paused) {
      if (seekTimer) clearTimeout(seekTimer)
      seekTimer = setTimeout(() => {
        seekTimer = null
        if (!trackId) return
        lastPositionMs = toMs(seconds)
        subsonic.reportPlayback(
          trackId,
          lastPositionMs,
          paused ? 'paused' : 'playing',
        )
      }, 250)
    },

    pageHide() {
      if (!trackId) return
      pageHidden = true
      try {
        subsonic.reportPlaybackKeepalive(trackId, lastPositionMs, 'stopped')
      } catch {
        // fetch/sendBeacon may throw; ignore
      }
    },
  }
}
