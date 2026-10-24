import React from 'react'
import { render } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Provider } from 'react-redux'
import { createStore } from 'redux'

const closeQueue = vi.fn()

vi.mock('../shell/useShell', () => ({ useShell: () => ({ closeQueue }) }))
vi.mock('./QueueList', () => ({ QueueList: () => <div data-testid="list" /> }))
vi.mock('react-admin', () => ({
  useTranslate: () => (key, opts) => opts?._ ?? key,
}))

import QueuePanel from './QueuePanel'

const renderPanel = (queue) =>
  render(
    <Provider store={createStore((s) => s, { player: { queue } })}>
      <QueuePanel />
    </Provider>,
  )

describe('<QueuePanel />', () => {
  beforeEach(() => closeQueue.mockClear())

  it('stays open while there are tracks', () => {
    const { getByRole } = renderPanel([{ uuid: 'a' }])
    expect(getByRole('dialog')).toBeInTheDocument()
    expect(closeQueue).not.toHaveBeenCalled()
  })

  it('closes itself when the queue is empty (the player bar, and so the toggle, is gone)', () => {
    renderPanel([])
    expect(closeQueue).toHaveBeenCalled()
  })

  it('closes on Escape', () => {
    renderPanel([{ uuid: 'a' }])
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(closeQueue).toHaveBeenCalled()
  })
})
