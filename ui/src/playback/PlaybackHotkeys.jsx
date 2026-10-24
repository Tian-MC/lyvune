import React, { useMemo } from 'react'
import { useHistory } from 'react-router-dom'
import { useStore } from 'react-redux'
import { GlobalHotKeys } from 'react-hotkeys'
import { keyMap } from '../hotkeys'
import { useToggleLove } from '../common/useToggleLove'
import { useShell } from '../shell/useShell'
import engine from './engine'
import { useCurrentItem, useCurrentSong } from './hooks'

const VOLUME_STEP = 0.1

/** Global keyboard shortcuts (same bindings as before, see hotkeys.js). */
export const PlaybackHotkeys = () => {
  const history = useHistory()
  const store = useStore()
  const item = useCurrentItem()
  const song = useCurrentSong(item)
  const [toggleLove] = useToggleLove('song', song || {})
  const { toggleSidebar } = useShell()

  const handlers = useMemo(
    () => ({
      TOGGLE_PLAY: (e) => {
        e && e.preventDefault()
        engine.toggle()
      },
      PREV_SONG: (e) => {
        if (!e?.metaKey) engine.prev()
      },
      NEXT_SONG: (e) => {
        if (!e?.metaKey) engine.next()
      },
      VOL_UP: () =>
        engine.setVolume((store.getState().player.volume ?? 1) + VOLUME_STEP),
      VOL_DOWN: () =>
        engine.setVolume((store.getState().player.volume ?? 1) - VOLUME_STEP),
      CURRENT_SONG: () => {
        if (song?.albumId) history.push(`/album/${song.albumId}/show`)
      },
      TOGGLE_LOVE: () => {
        if (song) toggleLove()
      },
      TOGGLE_MENU: () => toggleSidebar(),
    }),
    [history, store, song, toggleLove, toggleSidebar],
  )

  return <GlobalHotKeys keyMap={keyMap} handlers={handlers} allowChanges />
}

export default PlaybackHotkeys
