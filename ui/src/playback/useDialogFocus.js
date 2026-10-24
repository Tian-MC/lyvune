import { useEffect, useRef } from 'react'

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'

const isShown = (el) =>
  el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'

/**
 * Focuses `[data-autofocus]` on open, keeps Tab inside `ref` while open, closes
 * on Escape and restores focus on close.
 *
 * Tab is handled while the event is still travelling down (capture): the app's
 * hotkeys wrapper stops keydown events from bubbling, so a bubbling listener
 * never sees them. Escape stays on the bubbling phase so that a menu opened
 * inside the dialog closes first.
 */
export const useDialogFocus = (ref, onClose) => {
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    const previous = document.activeElement
    const root = ref.current
    root?.querySelector('[data-autofocus]')?.focus()

    const onEscape = (e) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close.current()
    }
    const onTab = (e) => {
      if (e.key !== 'Tab' || !root || !root.contains(document.activeElement)) {
        return
      }
      const focusable = [...root.querySelectorAll(FOCUSABLE)].filter(isShown)
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onEscape)
    document.addEventListener('keydown', onTab, true)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onEscape)
      document.removeEventListener('keydown', onTab, true)
      document.body.style.overflow = overflow
      previous && previous.focus && previous.focus()
    }
  }, [ref])
}
