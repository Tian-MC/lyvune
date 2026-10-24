import { useCallback, useState } from 'react'

const read = (key, fallback) => {
  try {
    return localStorage.getItem(key) || fallback
  } catch {
    return fallback
  }
}

/** Per-list layout preference ('grid' | 'table'), remembered per browser. */
export const useViewMode = (resource, fallback = 'grid') => {
  const key = `nd-view-${resource}`
  const [mode, setMode] = useState(() => read(key, fallback))
  const set = useCallback(
    (m) => {
      setMode(m)
      try {
        localStorage.setItem(key, m)
      } catch {
        // ignore
      }
    },
    [key],
  )
  return [mode, set]
}
