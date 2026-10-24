import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react-hooks'
import {
  openShareMenu,
  openDownloadMenu,
  DOWNLOAD_MENU_ARTIST,
  DOWNLOAD_MENU_ALBUM,
  DOWNLOAD_MENU_PLAY,
} from '../actions'

const mockDispatch = vi.fn()
vi.mock('react-redux', () => ({ useDispatch: () => mockDispatch }))

const { mockConfig, mockPermissions, mockRefreshMetadata } = vi.hoisted(() => ({
  mockConfig: {
    enableSharing: true,
    enableDownloads: true,
    enableExternalServices: true,
  },
  mockPermissions: { value: 'admin' },
  mockRefreshMetadata: vi.fn(),
}))
vi.mock('../config', () => ({ default: mockConfig }))
vi.mock('../common/useRefreshMetadata', () => ({
  useRefreshMetadata: () => mockRefreshMetadata,
}))
vi.mock('react-router-dom', () => ({ useHistory: () => ({ push: vi.fn() }) }))
vi.mock('react-admin', () => ({
  useNotify: () => vi.fn(),
  useDataProvider: () => ({ getList: vi.fn() }),
  usePermissions: () => ({ permissions: mockPermissions.value }),
  useTranslate: () => (key, opts) => opts?._ ?? key,
}))

import { useCollectionMenuItems } from './actions'

const items = (resource, record) =>
  renderHook(() => useCollectionMenuItems(resource, record, {})).result.current
const keys = (list) => list.map((i) => i.key)
const select = (list, key) => list.find((i) => i.key === key).onSelect()

describe('useCollectionMenuItems', () => {
  const artist = {
    id: 'ar1',
    name: 'Artist',
    stats: { albumartist: { songCount: 3, albumCount: 1, size: 1024 } },
  }
  const album = { id: 'al1', name: 'Album', size: 2048, duration: 100 }

  beforeEach(() => {
    vi.clearAllMocks()
    mockConfig.enableSharing = true
    mockConfig.enableDownloads = true
    mockPermissions.value = 'admin'
  })

  describe('artist', () => {
    it('offers share and download sized by the album-artist content', () => {
      const list = items('artist', artist)
      expect(keys(list)).toEqual(
        expect.arrayContaining(['share', 'download', 'refresh']),
      )
      expect(list.find((i) => i.key === 'download').label).toContain('1 KB')
      select(list, 'share')
      expect(mockDispatch).toHaveBeenCalledWith(
        openShareMenu(['ar1'], 'artist', 'Artist'),
      )
      select(list, 'download')
      expect(mockDispatch).toHaveBeenCalledWith(
        openDownloadMenu(artist, DOWNLOAD_MENU_ARTIST),
      )
    })

    it('hides share when sharing is disabled and download when downloads are', () => {
      mockConfig.enableSharing = false
      expect(keys(items('artist', artist))).not.toContain('share')
      mockConfig.enableSharing = true
      mockConfig.enableDownloads = false
      expect(keys(items('artist', artist))).not.toContain('download')
    })

    it('hides share and download for artists with no album-artist content', () => {
      const list = keys(items('artist', { id: 'ar1', name: 'A', stats: {} }))
      expect(list).not.toContain('share')
      expect(list).not.toContain('download')
    })

    it('hides share and download for a missing artist', () => {
      const list = keys(items('artist', { ...artist, missing: true }))
      expect(list).not.toContain('share')
      expect(list).not.toContain('download')
    })

    it('does not offer album info', () => {
      expect(keys(items('artist', artist))).not.toContain('info')
    })
  })

  describe('refresh metadata', () => {
    it('refreshes the artist or album for admins', () => {
      select(items('artist', artist), 'refresh')
      expect(mockRefreshMetadata).toHaveBeenCalledWith('artist', 'ar1')
      select(items('album', album), 'refresh')
      expect(mockRefreshMetadata).toHaveBeenCalledWith('album', 'al1')
    })

    it('is hidden for regular users and for playlists', () => {
      mockPermissions.value = 'regular'
      expect(keys(items('artist', artist))).not.toContain('refresh')
      mockPermissions.value = 'admin'
      expect(
        keys(items('playlist', { id: 'p1', name: 'P', size: 1 })),
      ).not.toContain('refresh')
    })
  })

  describe('album and playlist', () => {
    it('album offers download and info', () => {
      const list = items('album', album)
      expect(keys(list)).toEqual(
        expect.arrayContaining([
          'play',
          'shuffle',
          'playNext',
          'addToQueue',
          'download',
          'info',
          'share',
        ]),
      )
      select(list, 'download')
      expect(mockDispatch).toHaveBeenCalledWith(
        openDownloadMenu(album, DOWNLOAD_MENU_ALBUM),
      )
    })

    it('playlist downloads as a playlist and has no album info', () => {
      const pls = { id: 'p1', name: 'P', size: 10 }
      const list = items('playlist', pls)
      expect(keys(list)).not.toContain('info')
      select(list, 'download')
      expect(mockDispatch).toHaveBeenCalledWith(
        openDownloadMenu(pls, DOWNLOAD_MENU_PLAY),
      )
    })
  })
})
