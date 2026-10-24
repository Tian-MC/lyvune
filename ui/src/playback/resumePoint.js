/**
 * Where to pick a track up again after a reload. Kept in localStorage, one
 * entry for the current track.
 */
const KEY = 'nd-playback-position'

// A finished (or all but finished) track starts over instead of resuming a
// second before its end
const END_MARGIN_S = 3

export const saveResumePoint = (uuid, seconds) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ uuid, t: seconds }))
  } catch {
    // storage full or unavailable
  }
}

export const readResumePoint = (uuid, durationSeconds) => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY))
    if (!saved || saved.uuid !== uuid) return 0
    const t = saved.t || 0
    return durationSeconds && t >= durationSeconds - END_MARGIN_S ? 0 : t
  } catch {
    return 0
  }
}

export const clearResumePoint = () => {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // storage unavailable
  }
}
