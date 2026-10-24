import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useHistory } from 'react-router-dom'

import { ShellContext } from './useShell'

const SIDEBAR_KEY = 'nd-sidebar-collapsed'

const readCollapsed = () => {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'true'
  } catch {
    return false
  }
}

/**
 * UI state of the application shell: sidebar collapse, the queue panel and
 * the Now Playing overlay. Opening Now Playing pushes a history entry so the
 * browser/Android Back button closes it without leaving the current page.
 */
export const ShellProvider = ({ children }) => {
  const history = useHistory()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [queueOpen, setQueueOpen] = useState(false)
  const [nowPlaying, setNowPlaying] = useState({ open: false, panel: null })
  const openRef = useRef(false)
  openRef.current = nowPlaying.open

  const toggleSidebar = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, String(!c))
      } catch {
        // ignore
      }
      return !c
    })
  }, [])

  // The app uses hash history, which has no location state; a same-URL
  // entry pushed on window.history gives Back something to pop instead.
  const openNowPlaying = useCallback((panel = null) => {
    setQueueOpen(false)
    if (!openRef.current) {
      window.history.pushState({ ndNowPlaying: true }, '')
    }
    setNowPlaying({ open: true, panel })
  }, [])

  const closeNowPlaying = useCallback(() => {
    if (window.history.state?.ndNowPlaying) {
      window.history.back()
    } else {
      setNowPlaying((np) => ({ ...np, open: false }))
    }
  }, [])

  const setNowPlayingPanel = useCallback(
    (panel) => setNowPlaying((np) => ({ ...np, panel })),
    [],
  )

  useEffect(() => {
    const close = () =>
      setNowPlaying((np) => (np.open ? { ...np, open: false } : np))
    const onPop = (e) => {
      if (!e.state?.ndNowPlaying) close()
    }
    window.addEventListener('popstate', onPop)
    // Following a link from inside Now Playing closes it
    const unlisten = history.listen(close)
    return () => {
      window.removeEventListener('popstate', onPop)
      unlisten()
    }
  }, [history])

  const toggleQueue = useCallback(() => setQueueOpen((o) => !o), [])
  const closeQueue = useCallback(() => setQueueOpen(false), [])

  const value = useMemo(
    () => ({
      collapsed,
      toggleSidebar,
      queueOpen,
      toggleQueue,
      closeQueue,
      nowPlaying,
      openNowPlaying,
      closeNowPlaying,
      setNowPlayingPanel,
    }),
    [
      collapsed,
      toggleSidebar,
      queueOpen,
      toggleQueue,
      closeQueue,
      nowPlaying,
      openNowPlaying,
      closeNowPlaying,
      setNowPlayingPanel,
    ],
  )

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
}
