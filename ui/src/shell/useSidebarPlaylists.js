import { useCallback, useMemo, useState } from 'react'
import { useSelector } from 'react-redux'
import { useQueryWithStore } from 'react-admin'
import { useRefreshOnEvents } from '../common'
import config from '../config'

/**
 * Playlists shown in the sidebar, split into own and shared playlists.
 * Same data contract as the previous sidebar: name-sorted, capped at
 * `maxSidebarPlaylists`, optionally favourites only.
 */
export const useSidebarPlaylists = () => {
  const onlyFavourites = useSelector(
    (state) => state.settings.sidebarPlaylistsOnlyFavourites,
  )
  const showFavouritesOnly = config.enableFavourites && onlyFavourites
  const playlistData = useSelector(
    (state) => state.admin.resources.playlist?.data,
  )
  // Changes only when a playlist is (un)starred locally
  const starFingerprint = useMemo(() => {
    const data = playlistData || {}
    return Object.keys(data)
      .filter((id) => data[id]?.starred)
      .sort()
      .join(',')
  }, [playlistData])
  const [refreshCount, setRefreshCount] = useState(0)

  const onRefresh = useCallback(async () => {
    if (showFavouritesOnly) setRefreshCount((count) => count + 1)
  }, [showFavouritesOnly])
  useRefreshOnEvents({ events: ['playlist'], onRefresh })

  const { data, loaded } = useQueryWithStore({
    type: 'getList',
    resource: 'playlist',
    payload: {
      pagination: { page: 0, perPage: config.maxSidebarPlaylists },
      sort: { field: 'name' },
      ...(showFavouritesOnly && {
        filter: { starred: true },
        starFingerprint,
        refresh: refreshCount,
      }),
    },
  })

  return useMemo(() => {
    const userId = localStorage.getItem('userId')
    const mine = []
    const shared = []
    if (loaded && data) {
      Object.keys(data).forEach((id) => {
        const pls = data[id]
        if (!pls) return
        if (pls.ownerId === userId) mine.push(pls)
        else shared.push(pls)
      })
    }
    return { mine, shared, loaded, onlyFavourites: !!onlyFavourites }
  }, [data, loaded, onlyFavourites])
}
