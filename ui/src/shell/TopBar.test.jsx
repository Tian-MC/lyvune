import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import config from '../config'

const mocks = vi.hoisted(() => ({ permissions: 'admin' }))

vi.mock('react-admin', () => ({
  useTranslate: () => (key, opts) => opts?._ ?? key,
  usePermissions: () => ({ permissions: mocks.permissions }),
}))
vi.mock('../layout/NowPlayingPanel', () => ({
  default: () => <div data-testid="now-playing-panel" />,
}))
vi.mock('../layout/ActivityPanel', () => ({
  default: () => <div data-testid="activity-panel" />,
}))
vi.mock('./UserMenu', () => ({
  default: () => <div data-testid="user-menu" />,
}))

import TopBar from './TopBar'

const renderBar = () =>
  render(
    <MemoryRouter>
      <TopBar />
    </MemoryRouter>,
  )

describe('<TopBar />', () => {
  beforeEach(() => {
    config.devActivityPanel = true
    config.enableNowPlaying = true
    mocks.permissions = 'admin'
  })

  it('renders the now-playing and activity panels for admins', () => {
    renderBar()
    expect(screen.getByTestId('now-playing-panel')).toBeInTheDocument()
    expect(screen.getByTestId('activity-panel')).toBeInTheDocument()
    expect(screen.getByTestId('user-menu')).toBeInTheDocument()
  })

  it('hides the now-playing panel when it is disabled', () => {
    config.enableNowPlaying = false
    renderBar()
    expect(screen.queryByTestId('now-playing-panel')).toBeNull()
    expect(screen.getByTestId('activity-panel')).toBeInTheDocument()
  })

  it('hides both panels for regular users', () => {
    mocks.permissions = 'regular'
    renderBar()
    expect(screen.queryByTestId('now-playing-panel')).toBeNull()
    expect(screen.queryByTestId('activity-panel')).toBeNull()
  })

  it('offers a global search box', () => {
    renderBar()
    expect(
      screen.getByRole('search').querySelector('input[type="search"]'),
    ).not.toBeNull()
  })
})
