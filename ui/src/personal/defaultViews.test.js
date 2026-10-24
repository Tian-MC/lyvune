import {
  getDefaultViewChoices,
  getStoredDefaultView,
  isResourceDefaultView,
  resourceDefaultViews,
  defaultViewPath,
  HOME_VIEW,
} from './defaultViews'
import albumLists from '../album/albumLists'

describe('defaultViews', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('includes album lists and top-level resource lists as choices', () => {
    const choices = getDefaultViewChoices((key, options) =>
      options?.smart_count ? `${key}:${options.smart_count}` : key,
    )

    expect(choices.map((choice) => choice.id)).toEqual([
      HOME_VIEW,
      ...Object.keys(albumLists),
      ...resourceDefaultViews,
    ])
    expect(choices).toEqual(
      expect.arrayContaining([
        { id: 'artist', name: 'resources.artist.name:2' },
        { id: 'song', name: 'resources.song.name:2' },
        { id: 'playlist', name: 'resources.playlist.name:2' },
        { id: 'radio', name: 'resources.radio.name:2' },
      ]),
    )
  })

  it('identifies resource-backed default views', () => {
    expect(isResourceDefaultView('artist')).toBe(true)
    expect(isResourceDefaultView('song')).toBe(true)
    expect(isResourceDefaultView('playlist')).toBe(true)
    expect(isResourceDefaultView('radio')).toBe(true)
    expect(isResourceDefaultView('recentlyAdded')).toBe(false)
  })

  it('falls back to Home when no default view is stored', () => {
    expect(getStoredDefaultView()).toBe(HOME_VIEW)
  })

  it('maps default views to routes', () => {
    expect(defaultViewPath(HOME_VIEW)).toBeNull()
    expect(defaultViewPath('artist')).toBe('/artist')
    expect(defaultViewPath('recentlyAdded')).toBe('/album/recentlyAdded')
    expect(defaultViewPath('unknown')).toBeNull()
  })

  it('returns the stored default view', () => {
    localStorage.setItem('defaultView', 'playlist')

    expect(getStoredDefaultView()).toBe('playlist')
  })
})
