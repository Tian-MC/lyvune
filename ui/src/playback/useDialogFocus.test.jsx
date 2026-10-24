import React, { useRef } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { useDialogFocus } from './useDialogFocus'

const Dialog = ({ onClose }) => {
  const ref = useRef(null)
  useDialogFocus(ref, onClose)
  return (
    // Mirrors the app's hotkeys wrapper, which stops keydown from bubbling
    <div onKeyDown={(e) => e.stopPropagation()}>
      <div ref={ref} role="dialog">
        <button data-autofocus>first</button>
        <button>middle</button>
        <button disabled>disabled</button>
        <button>last</button>
      </div>
    </div>
  )
}

const tab = (shiftKey = false) =>
  fireEvent.keyDown(document.activeElement, { key: 'Tab', shiftKey })

describe('useDialogFocus', () => {
  // jsdom has no layout: report every element as rendered
  beforeAll(() => {
    HTMLElement.prototype.getClientRects = () => [{}]
  })

  it('focuses the autofocus element on open', () => {
    render(<Dialog onClose={() => {}} />)
    expect(screen.getByText('first')).toHaveFocus()
  })

  it('wraps Tab from the last control to the first, even if keydown is stopped before document', () => {
    render(<Dialog onClose={() => {}} />)
    screen.getByText('last').focus()
    tab()
    expect(screen.getByText('first')).toHaveFocus()
  })

  it('wraps Shift+Tab from the first control to the last, skipping disabled ones', () => {
    render(<Dialog onClose={() => {}} />)
    tab(true)
    expect(screen.getByText('last')).toHaveFocus()
  })

  it('leaves Tab alone between the edges', () => {
    render(<Dialog onClose={() => {}} />)
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
    expect(screen.getByText('first').dispatchEvent(event)).toBe(true)
    expect(event.defaultPrevented).toBe(false)
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<Dialog onClose={onClose} />)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls the latest onClose without re-running the focus effect', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<Dialog onClose={first} />)
    screen.getByText('middle').focus()
    rerender(<Dialog onClose={second} />)
    expect(screen.getByText('middle')).toHaveFocus()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('restores focus to the opener and the page scroll on close', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const { unmount } = render(<Dialog onClose={() => {}} />)
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(opener).toHaveFocus()
    expect(document.body.style.overflow).toBe('')
    opener.remove()
  })
})
