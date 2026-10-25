import React from 'react'
import { render, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  volume: 0.5,
  muted: false,
  setVolume: vi.fn(),
  toggleMute: vi.fn(),
}))

vi.mock('react-redux', () => ({ useDispatch: () => vi.fn() }))
vi.mock('../i18n/useT', () => ({
  useT: () => (key, fallback) => fallback ?? key,
}))
vi.mock('./engine', () => ({
  default: {
    canControlVolume: true,
    setVolume: mocks.setVolume,
    toggleMute: mocks.toggleMute,
  },
}))
vi.mock('./hooks', () => ({
  useCurrentItem: vi.fn(),
  useMedia: () => mocks.muted,
  usePlaybackTime: vi.fn(),
  usePlayerSettings: () => ({ volume: mocks.volume }),
  useTransport: vi.fn(),
}))

import { VolumeControl } from './controls'

const wheel = (container, deltaY) => {
  const event = new WheelEvent('wheel', {
    deltaY,
    bubbles: true,
    cancelable: true,
  })
  container.firstChild.dispatchEvent(event)
  return event
}

describe('<VolumeControl /> wheel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.volume = 0.5
    mocks.muted = false
  })

  it('raises the volume when scrolling up and lowers it when scrolling down', () => {
    const { container } = render(<VolumeControl />)
    wheel(container, -100)
    expect(mocks.setVolume).toHaveBeenLastCalledWith(0.55)
    wheel(container, 100)
    expect(mocks.setVolume).toHaveBeenLastCalledWith(0.45)
  })

  it('does not let the page scroll along', () => {
    const { container } = render(<VolumeControl />)
    expect(wheel(container, -100).defaultPrevented).toBe(true)
  })

  it('unmutes when scrolling up while muted, and stays muted going down', () => {
    mocks.muted = true
    const { container } = render(<VolumeControl />)
    wheel(container, -100)
    expect(mocks.toggleMute).toHaveBeenCalledTimes(1)
    expect(mocks.setVolume).toHaveBeenLastCalledWith(0.05)
    mocks.toggleMute.mockClear()
    wheel(container, 100)
    expect(mocks.toggleMute).not.toHaveBeenCalled()
    expect(mocks.setVolume).toHaveBeenLastCalledWith(-0.05)
  })

  it('ignores a wheel event without vertical movement', () => {
    const { container } = render(<VolumeControl />)
    wheel(container, 0)
    expect(mocks.setVolume).not.toHaveBeenCalled()
  })
})
