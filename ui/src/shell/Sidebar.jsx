import React, { memo } from 'react'
import clsx from 'clsx'
import { Link, NavLink, useHistory, useLocation } from 'react-router-dom'
import { useDispatch } from 'react-redux'
import { useDataProvider, useNotify } from 'react-admin'
import { useDrop } from 'react-dnd'
import Tooltip from '@material-ui/core/Tooltip'
import { useT } from '../i18n/useT'
import { useShell } from './useShell'
import { libraryNav, navLabel, primaryNav } from './navigation'
import { useSidebarPlaylists } from './useSidebarPlaylists'
import { IconButton } from '../design/IconButton'
import {
  HeartIcon,
  PlusIcon,
  SettingsIcon,
  SidebarCloseIcon,
  SidebarOpenIcon,
  PlaylistIcon,
} from '../design/icons'
import LibrarySelector from '../common/LibrarySelector'
import { canChangeTracks } from '../common'
import { DraggableTypes } from '../consts'
import { setSidebarPlaylistsOnlyFavourites } from '../actions'
import config from '../config'
import Logo from './Logo'
import styles from './Sidebar.module.css'

const NavItem = ({ item, collapsed, label }) => {
  const { pathname } = useLocation()
  const active = item.match(pathname)
  const Icon = item.icon
  const link = (
    <Link
      to={item.to}
      className={clsx(styles.item, active && styles.active)}
      aria-current={active ? 'page' : undefined}
    >
      <Icon size={19} aria-hidden className={styles.itemIcon} />
      <span className={styles.itemLabel}>{label}</span>
    </Link>
  )
  return collapsed ? (
    <Tooltip title={label} placement="right">
      {link}
    </Tooltip>
  ) : (
    link
  )
}

const PlaylistLink = ({ pls }) => {
  const dataProvider = useDataProvider()
  const notify = useNotify()
  // Songs can be dragged from tracklists onto a playlist
  const [{ isOver }, dropRef] = useDrop(() => ({
    accept: canChangeTracks(pls) ? DraggableTypes.ALL : [],
    collect: (monitor) => ({ isOver: monitor.isOver() && monitor.canDrop() }),
    drop: (item) =>
      dataProvider
        .addToPlaylist(pls.id, item)
        .then((res) =>
          notify('message.songsAddedToPlaylist', 'info', {
            smart_count: res.data?.added,
          }),
        )
        .catch(() => notify('ra.page.error', 'warning')),
  }))
  return (
    <NavLink
      ref={dropRef}
      to={`/playlist/${pls.id}/show`}
      className={clsx(styles.playlist, isOver && styles.dropTarget)}
      activeClassName={styles.playlistActive}
      title={pls.name}
    >
      <span className={styles.playlistName}>{pls.name}</span>
    </NavLink>
  )
}

const PlaylistsSection = () => {
  const t = useT()
  const dispatch = useDispatch()
  const history = useHistory()
  const { mine, shared, onlyFavourites } = useSidebarPlaylists()
  return (
    <div className={styles.playlists}>
      <div className={styles.groupHeader}>
        <Link to="/playlist" className={styles.groupTitle}>
          {t('menu.playlists', 'Playlists')}
        </Link>
        <div className={styles.groupActions}>
          {config.enableFavourites && (
            <IconButton
              size="xs"
              icon={HeartIcon}
              label={t('menu.onlyFavourites', 'Only show favourites')}
              pressed={onlyFavourites}
              active={onlyFavourites}
              onClick={() =>
                dispatch(setSidebarPlaylistsOnlyFavourites(!onlyFavourites))
              }
            />
          )}
          <IconButton
            size="xs"
            icon={PlusIcon}
            label={t('ra.action.create', 'Create')}
            onClick={() => history.push('/playlist/create')}
          />
        </div>
      </div>
      <nav aria-label={t('menu.playlists', 'Playlists')}>
        {mine.map((pls) => (
          <PlaylistLink key={pls.id} pls={pls} />
        ))}
        {shared.length > 0 && (
          <>
            <p className={styles.subGroup}>
              {t('menu.sharedPlaylists', 'Shared Playlists')}
            </p>
            {shared.map((pls) => (
              <PlaylistLink key={pls.id} pls={pls} />
            ))}
          </>
        )}
        {mine.length === 0 && shared.length === 0 && (
          <p className={styles.emptyPlaylists}>
            {t('resources.playlist.message.noPlaylists', 'No playlists')}
          </p>
        )}
      </nav>
    </div>
  )
}

export const Sidebar = memo(() => {
  const t = useT()
  const { collapsed, toggleSidebar } = useShell()
  return (
    <aside
      className={clsx(styles.root, collapsed && styles.collapsed)}
      aria-label={t('ui.nav.main', 'Main navigation')}
    >
      <div className={styles.brand}>
        <Link to="/" className={styles.logoLink} aria-label="Navidrome">
          <Logo compact={collapsed} />
        </Link>
        <IconButton
          size="sm"
          className={styles.collapseButton}
          icon={collapsed ? SidebarOpenIcon : SidebarCloseIcon}
          label={
            collapsed
              ? t('ui.nav.expand', 'Expand sidebar')
              : t('ui.nav.collapse', 'Collapse sidebar')
          }
          onClick={toggleSidebar}
        />
      </div>

      <div className={styles.scroll}>
        <nav className={styles.group}>
          {primaryNav.map((item) => (
            <NavItem
              key={item.id}
              item={item}
              collapsed={collapsed}
              label={navLabel(t, item)}
            />
          ))}
        </nav>

        <nav className={styles.group} aria-label={t('menu.library', 'Library')}>
          {!collapsed && (
            <p className={styles.groupLabel}>{t('menu.library', 'Library')}</p>
          )}
          {libraryNav().map((item) => (
            <NavItem
              key={item.id}
              item={item}
              collapsed={collapsed}
              label={navLabel(t, item)}
            />
          ))}
          {collapsed && (
            <NavItem
              item={{
                id: 'playlists',
                to: '/playlist',
                icon: PlaylistIcon,
                match: (p) => p.startsWith('/playlist'),
              }}
              collapsed
              label={t('menu.playlists', 'Playlists')}
            />
          )}
        </nav>

        {!collapsed && config.devSidebarPlaylists && <PlaylistsSection />}
      </div>

      <div className={styles.footer}>
        {!collapsed && (
          <div className={styles.librarySelector}>
            <LibrarySelector />
          </div>
        )}
        <NavItem
          item={{
            id: 'settings',
            to: '/personal',
            icon: SettingsIcon,
            match: (p) => p.startsWith('/personal'),
          }}
          collapsed={collapsed}
          label={t('menu.settings', 'Settings')}
        />
      </div>
    </aside>
  )
})

Sidebar.displayName = 'Sidebar'

export default Sidebar
