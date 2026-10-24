import { useEffect } from 'react'

const BOXES = 'input[type="checkbox"]'

const hasName = (input) =>
  !!(
    input.getAttribute('aria-label') ||
    input.getAttribute('aria-labelledby') ||
    input.title ||
    input.labels?.length
  )

// react-admin 3 gives its selection checkboxes an `aria-label`, but Material-UI
// puts it on the wrapper span instead of the <input>, so assistive technology
// finds an unnamed control.
const wrapperLabel = (input) =>
  input.parentElement?.parentElement?.getAttribute('aria-label') || ''

// "Select this row" alone does not say which row
const rowContext = (input) => {
  const row = input.closest('tr')
  if (!row || row.closest('thead')) return ''
  const cell = [...row.cells].find(
    (c) => !c.contains(input) && c.textContent.trim(),
  )
  return cell ? cell.textContent.trim().replace(/\s+/g, ' ').slice(0, 60) : ''
}

const nameInput = (input) => {
  if (hasName(input)) return
  const base = wrapperLabel(input)
  if (!base) return
  const context = rowContext(input)
  input.setAttribute('aria-label', context ? `${base}: ${context}` : base)
}

const scan = (root) => {
  if (root.nodeType !== 1) return
  if (root.matches(BOXES)) nameInput(root)
  root.querySelectorAll?.(BOXES).forEach(nameInput)
}

/**
 * Names the selection checkboxes that react-admin renders in data tables.
 * Watches the document because dialogs and menus render in portals.
 */
export const useCheckboxNames = () => {
  useEffect(() => {
    scan(document.body)
    let pending = []
    let frame = 0
    const flush = () => {
      frame = 0
      const nodes = pending
      pending = []
      nodes.forEach(scan)
    }
    const observer = new MutationObserver((records) => {
      records.forEach((r) => pending.push(...r.addedNodes))
      if (!frame && pending.length) frame = requestAnimationFrame(flush)
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])
}
