import { useEffect, useState } from 'react'
import engine from '../playback/engine'
import { activeLineIndex } from './parse'

/**
 * Index of the line being sung, from the audio clock itself.
 *
 * The clock is read every animation frame and a render happens only when the
 * line changes. The media events the rest of the player uses fire about four
 * times a second, which would make a line change up to a quarter of a second
 * after the audio; a seek, a pause or a track change is picked up on the very
 * next frame. There is no timer of its own that could drift.
 */
export const useActiveLine = (lines) => {
  const [active, setActive] = useState(() =>
    activeLineIndex(lines, engine.currentTime() * 1000),
  )
  useEffect(() => {
    let frame
    let last = null
    const tick = () => {
      const index = activeLineIndex(lines, engine.currentTime() * 1000)
      if (index !== last) {
        last = index
        setActive(index)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [lines])
  return active
}

export default useActiveLine
