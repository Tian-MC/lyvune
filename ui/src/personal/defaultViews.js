import albumLists from '../album/albumLists'

export const HOME_VIEW = 'home'

export const resourceDefaultViews = ['artist', 'song', 'playlist', 'radio']

export const isResourceDefaultView = (defaultView) =>
  resourceDefaultViews.includes(defaultView)

export const getDefaultViewChoices = (translate) => [
  { id: HOME_VIEW, name: translate('ui.nav.home', { _: 'Home' }) },
  ...Object.keys(albumLists).map((type) => ({
    id: type,
    name: translate(`resources.album.lists.${type}`),
  })),
  ...resourceDefaultViews.map((resource) => ({
    id: resource,
    name: translate(`resources.${resource}.name`, { smart_count: 2 }),
  })),
]

export const getStoredDefaultView = () =>
  localStorage.getItem('defaultView') || HOME_VIEW

/** Route of a default view, or null for Home. */
export const defaultViewPath = (view) => {
  if (!view || view === HOME_VIEW) return null
  if (isResourceDefaultView(view)) return `/${view}`
  if (albumLists[view]) return `/album/${view}`
  return null
}
