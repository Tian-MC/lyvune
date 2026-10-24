import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router-dom'
import { createStore, combineReducers } from 'redux'
import { settingsReducer, activityReducer } from '../reducers'
import { processEvent, EVENT_REFRESH_RESOURCE } from '../actions'
import SidebarPlaylists from './SidebarPlaylists'

const mockUseQueryWithStore = vi.fn()

vi.mock('react-dnd', () => ({
  useDrop: () => [{}, () => {}],
}))

vi.mock('react-admin', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useTranslate: () => (key, opts) => opts?._ ?? key,
    useDataProvider: () => ({ addToPlaylist: vi.fn() }),
    useNotify: () => vi.fn(),
    useQueryWithStore: (query) => mockUseQueryWithStore(query),
  }
})

const playlists = {
  'pl-1': { id: 'pl-1', name: 'Mine', ownerId: 'user-1' },
  'pl-2': { id: 'pl-2', name: 'Theirs', ownerId: 'user-2' },
}

const SET_PLAYLIST_DATA = 'TEST/SET_PLAYLIST_DATA'
const adminReducer = (state = { resources: {} }, action) =>
  action.type === SET_PLAYLIST_DATA
    ? { resources: { playlist: { data: action.data } } }
    : state

const renderSection = (preloadedSettings = {}, preloadedPlaylistData) => {
  const store = createStore(
    combineReducers({
      settings: settingsReducer,
      activity: activityReducer,
      admin: adminReducer,
    }),
    {
      settings: preloadedSettings,
      activity: {},
      admin: {
        resources: preloadedPlaylistData
          ? { playlist: { data: preloadedPlaylistData } }
          : {},
      },
    },
  )
  render(
    <Provider store={store}>
      <MemoryRouter>
        <SidebarPlaylists />
      </MemoryRouter>
    </Provider>,
  )
  return store
}

const lastQuery = () =>
  mockUseQueryWithStore.mock.calls[
    mockUseQueryWithStore.mock.calls.length - 1
  ][0]

describe('<SidebarPlaylists />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.setItem('userId', 'user-1')
    mockUseQueryWithStore.mockReturnValue({ data: playlists, loaded: true })
  })

  it('lists own and shared playlists, queried without a starred filter', () => {
    renderSection()
    expect(lastQuery().payload.filter).toBeUndefined()
    expect(screen.getByText('Mine')).not.toBeNull()
    expect(screen.getByText('Shared Playlists')).not.toBeNull()
    expect(screen.getByText('Theirs')).not.toBeNull()
  })

  it('adds the starred filter when favourites-only is enabled', () => {
    renderSection({ sidebarPlaylistsOnlyFavourites: true })
    expect(lastQuery().payload.filter).toEqual({ starred: true })
  })

  it('toggles the setting when the heart action is clicked', () => {
    const store = renderSection()
    const heart = screen.getByRole('button', { name: 'Only show favourites' })
    expect(heart.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(heart)
    expect(store.getState().settings.sidebarPlaylistsOnlyFavourites).toBe(true)
    expect(lastQuery().payload.filter).toEqual({ starred: true })
    expect(
      screen
        .getByRole('button', { name: 'Only show favourites' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
  })

  it('refetches on a playlist SSE event when favourites-only is on', async () => {
    const store = renderSection({ sidebarPlaylistsOnlyFavourites: true })
    const before = lastQuery().payload.refresh
    // useRefreshOnEvents compares Date.now() timestamps; make sure it advances
    await act(() => new Promise((resolve) => setTimeout(resolve, 5)))
    act(() => {
      store.dispatch(
        processEvent(EVENT_REFRESH_RESOURCE, { playlist: ['pl-1'] }),
      )
    })
    expect(lastQuery().payload.refresh).toBe(before + 1)
  })

  it('does not change the query signature on an SSE event when favourites-only is off', async () => {
    const store = renderSection()
    const before = JSON.stringify(lastQuery().payload)
    await act(() => new Promise((resolve) => setTimeout(resolve, 5)))
    act(() => {
      store.dispatch(
        processEvent(EVENT_REFRESH_RESOURCE, { playlist: ['pl-1'] }),
      )
    })
    // Signature unchanged → useQueryWithStore dedupes, no wasted refetch
    expect(lastQuery().payload.refresh).toBeUndefined()
    expect(JSON.stringify(lastQuery().payload)).toBe(before)
  })

  it('refetches when a playlist is starred locally (no SSE echo)', () => {
    const store = renderSection(
      { sidebarPlaylistsOnlyFavourites: true },
      { 'pl-1': { id: 'pl-1', name: 'Mine', ownerId: 'user-1' } },
    )
    const before = lastQuery().payload.starFingerprint
    act(() => {
      store.dispatch({
        type: SET_PLAYLIST_DATA,
        data: {
          'pl-1': {
            id: 'pl-1',
            name: 'Mine',
            ownerId: 'user-1',
            starred: true,
          },
        },
      })
    })
    expect(lastQuery().payload.starFingerprint).not.toBe(before)
    expect(lastQuery().payload.starFingerprint).toContain('pl-1')
  })
})
