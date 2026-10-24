import { useEffect, useRef, useState } from 'react'
import { useSelector, shallowEqual } from 'react-redux'
import { useGetOne } from 'react-admin'
import engine from './engine'
import { selectCurrentItem } from '../reducers/playerReducer'

/**
 * Subscribes to a slice of the engine's media state. The component only
 * re-renders when the selected value changes, so a play button does not
 * re-render on every `timeupdate`.
 */
export const useMedia = (selector, isEqual = Object.is) => {
  const selectorRef = useRef(selector)
  selectorRef.current = selector
  const [value, setValue] = useState(() => selector(engine.getMedia()))
  const valueRef = useRef(value)

  useEffect(() => {
    const check = (media) => {
      const next = selectorRef.current(media)
      if (!isEqual(next, valueRef.current)) {
        valueRef.current = next
        setValue(next)
      }
    }
    check(engine.getMedia())
    return engine.subscribe(check)
  }, [isEqual])

  return value
}

const selectTransport = (m) => ({
  paused: m.paused,
  waiting: m.waiting,
  error: m.error,
  uuid: m.uuid,
})

/** Play/pause/buffering state — changes rarely. */
export const useTransport = () => useMedia(selectTransport, shallowEqual)

const selectTime = (m) => ({
  currentTime: m.currentTime,
  duration: m.duration,
  buffered: m.buffered,
})

/** Time state — changes ~4×/s while playing. Use only where displayed. */
export const usePlaybackTime = () => useMedia(selectTime, shallowEqual)

export const useCurrentItem = () => useSelector(selectCurrentItem)

export const usePlayerSettings = () =>
  useSelector(
    (state) => ({
      shuffle: !!state.player.shuffle,
      repeat: state.player.repeat || 'off',
      volume: typeof state.player.volume === 'number' ? state.player.volume : 1,
      queueLength: state.player.queue.length,
      index: state.player.savedPlayIndex,
    }),
    shallowEqual,
  )

/** True when `trackId` is the current track. */
export const useIsCurrentTrack = (trackId) =>
  useSelector((state) => {
    const item = selectCurrentItem(state)
    return !!item && !!trackId && item.trackId === trackId
  })

/** Current song record from the shared cache (keeps love state in sync). */
export const useCurrentSong = (item) => {
  const isRadio = !!item?.isRadio
  const { data } = useGetOne('song', item?.trackId, {
    enabled: !!item?.trackId && !isRadio,
  })
  return isRadio ? null : data || item?.song
}
