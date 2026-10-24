import { useCallback, useState } from 'react'

/**
 * Menu state shared by the "…" button and right-click (context menu).
 * `open(event)` anchors to the button; `openAt(event)` to the pointer.
 */
export const useActionMenu = (onOpen) => {
  const [state, setState] = useState(null)
  const open = useCallback(
    (e) => {
      e.preventDefault()
      e.stopPropagation()
      onOpen && onOpen()
      setState({ anchorEl: e.currentTarget })
    },
    [onOpen],
  )
  const openAt = useCallback(
    (e) => {
      e.preventDefault()
      e.stopPropagation()
      onOpen && onOpen()
      setState({ position: { top: e.clientY, left: e.clientX } })
    },
    [onOpen],
  )
  const close = useCallback(() => setState(null), [])
  return { state, open, openAt, close }
}
