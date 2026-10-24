import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router-dom'
import { createStore } from 'redux'
import config from '../config'

const mocks = vi.hoisted(() => ({
  resources: [],
  permissions: 'admin',
  messages: { 'resources.player.menuName': 'Players (custom label)' },
}))

vi.mock('react-admin', () => ({
  useTranslate: () => (key, opts) => mocks.messages[key] ?? opts?._ ?? key,
  usePermissions: () => ({ permissions: mocks.permissions }),
  useGetIdentity: () => ({ loaded: true, identity: { fullName: 'Dev Admin' } }),
  getResources: () => mocks.resources,
}))
vi.mock('../dialogs', () => ({
  AboutDialog: () => <div />,
  QuickConnectDialog: () => <div />,
}))

import UserMenu from './UserMenu'

const openMenu = () => {
  render(
    <Provider store={createStore((s) => s, {})}>
      <MemoryRouter>
        <UserMenu logout={<li>logout-item</li>} />
      </MemoryRouter>
    </Provider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
}

describe('<UserMenu />', () => {
  beforeEach(() => {
    config.enableQuickConnect = false
    config.enableUserEditing = true
    mocks.resources = []
    mocks.permissions = 'admin'
  })

  it('shows the Quick Connect item when enabled', () => {
    config.enableQuickConnect = true
    openMenu()
    expect(screen.queryAllByText('Quick Connect')).not.toHaveLength(0)
  })

  it('hides the Quick Connect item when disabled, keeping About', () => {
    openMenu()
    expect(screen.queryAllByText('Quick Connect')).toHaveLength(0)
    expect(screen.queryAllByText('About')).not.toHaveLength(0)
  })

  it('uses the resource label for settings items when set', () => {
    mocks.resources = [
      {
        name: 'player',
        hasList: true,
        options: { subMenu: 'settings', label: 'resources.player.menuName' },
      },
      { name: 'transcoding', hasList: true, options: { subMenu: 'settings' } },
    ]
    openMenu()
    // the explicit label is translated; the other falls back to its resource
    expect(screen.getByText('Players (custom label)')).toBeInTheDocument()
    expect(screen.getByText('transcoding')).toBeInTheDocument()
    expect(screen.queryByText('player')).toBeNull()
  })

  it('shows the identity and the logout item', () => {
    openMenu()
    expect(screen.getByText('Dev Admin')).toBeInTheDocument()
    expect(screen.getByText('logout-item')).toBeInTheDocument()
  })

  it('links regular users to their own profile only when editing is allowed', () => {
    mocks.permissions = 'regular'
    mocks.resources = [{ name: 'user', hasList: true, options: {} }]
    localStorage.setItem('userId', 'u1')
    openMenu()
    expect(screen.getByText('User')).toBeInTheDocument()
  })

  it('hides the profile link for regular users when editing is disabled', () => {
    mocks.permissions = 'regular'
    mocks.resources = [{ name: 'user', hasList: true, options: {} }]
    config.enableUserEditing = false
    openMenu()
    expect(screen.queryByText('User')).toBeNull()
  })
})
