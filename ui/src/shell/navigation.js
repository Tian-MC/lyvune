import config from '../config'
import {
  AlbumIcon,
  ArtistIcon,
  HeartIcon,
  HomeIcon,
  LibraryIcon,
  PlaylistIcon,
  RadioIcon,
  SearchIcon,
  ShareIcon,
  SongIcon,
  TagIcon,
} from '../design/icons'

// Primary destinations. `match` decides the active state for nested routes.
export const primaryNav = [
  {
    id: 'home',
    to: '/',
    icon: HomeIcon,
    labelKey: 'ui.nav.home',
    label: 'Home',
    match: (p) => p === '/',
  },
]

export const libraryNav = () =>
  [
    {
      id: 'albums',
      to: '/album/all',
      icon: AlbumIcon,
      labelKey: 'resources.album.name',
      label: 'Albums',
      count: 2,
      match: (p) => p.startsWith('/album'),
    },
    {
      id: 'artists',
      to: '/artist',
      icon: ArtistIcon,
      labelKey: 'resources.artist.name',
      label: 'Artists',
      count: 2,
      match: (p) => p.startsWith('/artist'),
    },
    {
      id: 'songs',
      to: '/song',
      icon: SongIcon,
      labelKey: 'resources.song.name',
      label: 'Songs',
      count: 2,
      match: (p) => p.startsWith('/song'),
    },
    {
      id: 'genres',
      to: '/genre',
      icon: TagIcon,
      labelKey: 'ui.nav.genres',
      label: 'Genres',
      match: (p) => p.startsWith('/genre'),
    },
    config.enableFavourites && {
      id: 'favorites',
      to: '/favorites',
      icon: HeartIcon,
      labelKey: 'ui.nav.favorites',
      label: 'Favourites',
      match: (p) => p.startsWith('/favorites'),
    },
    {
      id: 'radios',
      to: '/radio',
      icon: RadioIcon,
      labelKey: 'resources.radio.name',
      label: 'Radios',
      count: 2,
      match: (p) => p.startsWith('/radio'),
    },
    config.enableSharing && {
      id: 'shares',
      to: '/share',
      icon: ShareIcon,
      labelKey: 'resources.share.name',
      label: 'Shares',
      count: 2,
      match: (p) => p.startsWith('/share'),
    },
  ].filter(Boolean)

export const mobileNav = [
  {
    id: 'home',
    to: '/',
    icon: HomeIcon,
    labelKey: 'ui.nav.home',
    label: 'Home',
    match: (p) => p === '/',
  },
  {
    id: 'search',
    to: '/search',
    icon: SearchIcon,
    labelKey: 'ui.nav.search',
    label: 'Search',
    match: (p) => p.startsWith('/search'),
  },
  {
    id: 'library',
    to: '/library',
    icon: LibraryIcon,
    labelKey: 'menu.library',
    label: 'Library',
    match: (p) =>
      [
        '/library',
        '/album',
        '/artist',
        '/song',
        '/genre',
        '/favorites',
        '/radio',
        '/share',
      ].some((r) => p.startsWith(r)),
  },
  {
    id: 'playlists',
    to: '/playlist',
    icon: PlaylistIcon,
    labelKey: 'menu.playlists',
    label: 'Playlists',
    match: (p) => p.startsWith('/playlist'),
  },
]

export const navLabel = (t, item) =>
  item.count
    ? t(item.labelKey, item.label, { smart_count: item.count })
    : t(item.labelKey, item.label)
