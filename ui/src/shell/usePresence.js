import { useEffect, useState } from 'react'

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Keeps something mounted for `ms` after `open` turns false so it can play an
 * exit animation. Returns `{ mounted, closing }`; with reduced motion it
 * unmounts at once.
 */
export const usePresence = (open, ms) => {
  const [mounted, setMounted] = useState(open)

  useEffect(() => {
    if (open) {
      setMounted(true)
      return undefined
    }
    if (reducedMotion()) {
      setMounted(false)
      return undefined
    }
    const timer = setTimeout(() => setMounted(false), ms)
    return () => clearTimeout(timer)
  }, [open, ms])

  return { mounted: open || mounted, closing: !open && mounted }
}
