import { useEffect, useState } from 'react'

// Which lyrics were changed since they were loaded, and which tracks are being
// searched for right now. Kept outside React so the player, the lyrics panel
// and the manager stay in step.
const listeners = new Set()
const versions = new Map()
const resolving = new Set()

const emit = () => listeners.forEach((l) => l())

export const lyricsVersion = (id) => versions.get(id) ?? 0
export const isResolving = (id) => resolving.has(id)

/** Tell every view that the lyrics of a track changed. */
export const bumpLyrics = (id) => {
  versions.set(id, lyricsVersion(id) + 1)
  emit()
}

export const setResolving = (id, on) => {
  if (on === resolving.has(id)) return
  if (on) resolving.add(id)
  else resolving.delete(id)
  emit()
}

export const subscribeLyrics = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** `{ version, resolving }` for a track, updating when either changes. */
export const useLyricsSignals = (id) => {
  const read = () => ({
    version: lyricsVersion(id),
    resolving: isResolving(id),
  })
  const [state, setState] = useState(read)
  useEffect(() => {
    const update = () =>
      setState((prev) => {
        const next = read()
        return prev.version === next.version &&
          prev.resolving === next.resolving
          ? prev
          : next
      })
    update()
    return subscribeLyrics(update)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  return state
}
