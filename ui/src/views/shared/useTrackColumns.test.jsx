import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { Provider } from 'react-redux'
import { createStore, combineReducers } from 'redux'
import { renderHook, act } from '@testing-library/react-hooks'
import { settingsReducer } from '../../reducers/settingsReducer'
import { gridTemplate } from './trackColumns'
import { useTrackColumns } from './useTrackColumns'

vi.mock('../../config', () => ({
  default: { enableStarRating: true, losslessFormats: 'FLAC' },
}))

const setup = (settings, list = 'album', defaults = ['rating', 'quality']) => {
  const store = createStore(combineReducers({ settings: settingsReducer }), {
    settings: { notifications: false, toggleableFields: {}, ...settings },
  })
  const wrapper = ({ children }) => (
    <Provider store={store}>{children}</Provider>
  )
  return {
    store,
    ...renderHook(() => useTrackColumns(list, defaults), { wrapper }),
  }
}

describe('useTrackColumns', () => {
  it('uses the defaults when nothing was chosen before', () => {
    const { result } = setup({})
    expect(result.current.active).toEqual(['rating', 'quality'])
  })

  it('honours the choices made in the previous song tables', () => {
    const { result } = setup({
      toggleableFields: { albumSong: { rating: false, year: true, bpm: true } },
    })
    // quality was not in the legacy set, so its default applies
    expect(result.current.active).toEqual(['quality', 'year', 'bpm'])
  })

  it('prefers the new choice over the legacy one', () => {
    const { result } = setup({
      toggleableFields: { albumSong: { year: true } },
      trackColumns: { album: { year: false } },
    })
    expect(result.current.enabled.year).toBe(false)
  })

  it('toggles a column and keeps lists independent', () => {
    const { result, store } = setup({})
    act(() => result.current.toggle('year'))
    expect(result.current.enabled.year).toBe(true)
    expect(result.current.active).toContain('year')
    expect(store.getState().settings.trackColumns.album.year).toBe(true)
    expect(store.getState().settings.trackColumns.playlist).toBeUndefined()
  })
})

describe('gridTemplate', () => {
  const base = ['love', 'duration', 'menu']

  it('lays out lead, title and trailing actions', () => {
    expect(gridTemplate(base, [], false)).toBe('40px minmax(0, 1fr) 116px')
  })

  it('adds a checkbox track, the album and the optional columns in order', () => {
    expect(gridTemplate([...base, 'album'], ['rating', 'year'], true)).toBe(
      '22px 40px minmax(0, 1fr) minmax(0, 0.7fr) 112px 56px 116px',
    )
  })
})
