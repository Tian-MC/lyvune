// OS-level media controls (lock screen, hardware keys, notification shade).

const supported = () =>
  typeof navigator !== 'undefined' && 'mediaSession' in navigator

let engine = null

const artworkFor = (item) => {
  if (!item?.cover) return []
  const big = item.cover.replace(/([?&]size=)\d+/, '$1512')
  return [
    { src: item.cover, sizes: '300x300', type: 'image/jpeg' },
    { src: big, sizes: '512x512', type: 'image/jpeg' },
  ]
}

export const updateMediaSession = (item) => {
  if (!supported()) return
  if (!item) {
    navigator.mediaSession.metadata = null
    return
  }
  const song = item.song || {}
  try {
    navigator.mediaSession.metadata = new window.MediaMetadata({
      title: song.title || item.name || '',
      artist: song.artist || item.singer || '',
      album: song.album || '',
      artwork: artworkFor(item),
    })
  } catch {
    // MediaMetadata unsupported
  }
}

const updatePosition = (media) => {
  if (!supported() || !navigator.mediaSession.setPositionState) return
  if (!media.duration || !Number.isFinite(media.duration)) return
  try {
    navigator.mediaSession.setPositionState({
      duration: media.duration,
      playbackRate: 1,
      position: Math.min(media.currentTime, media.duration),
    })
  } catch {
    // invalid state while switching tracks
  }
}

export const setupMediaSession = (api) => {
  if (!supported()) return
  engine = api
  const handlers = {
    play: () => engine.play(),
    pause: () => engine.pause(),
    stop: () => engine.pause(),
    previoustrack: () => engine.prev(),
    nexttrack: () => engine.next(),
    seekbackward: (d) => engine.seekBy(-(d.seekOffset || 10)),
    seekforward: (d) => engine.seekBy(d.seekOffset || 10),
    seekto: (d) => engine.seek(d.seekTime),
  }
  Object.entries(handlers).forEach(([action, handler]) => {
    try {
      navigator.mediaSession.setActionHandler(action, handler)
    } catch {
      // action not supported by this browser
    }
  })

  let lastUuid = null
  let lastPaused = null
  let lastDuration = null
  let lastTime = 0
  engine.subscribe((media) => {
    if (media.paused !== lastPaused) {
      lastPaused = media.paused
      navigator.mediaSession.playbackState = media.uuid
        ? media.paused
          ? 'paused'
          : 'playing'
        : 'none'
      updatePosition(media)
    }
    // Track change, duration known, or a jump in time (seek)
    const jumped = Math.abs(media.currentTime - lastTime) > 2
    lastTime = media.currentTime
    if (media.uuid !== lastUuid || media.duration !== lastDuration || jumped) {
      lastUuid = media.uuid
      lastDuration = media.duration
      updatePosition(media)
    }
  })
}
