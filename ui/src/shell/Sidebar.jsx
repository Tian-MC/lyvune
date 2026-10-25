import React, { memo } from 'react'
import clsx from 'clsx'
import { Link, useLocation } from 'react-router-dom'
import Tooltip from '@material-ui/core/Tooltip'
import { useT } from '../i18n/useT'
import { useShell } from './useShell'
import { libraryNav, navLabel, primaryNav } from './navigation'
import SidebarPlaylists from './SidebarPlaylists'
import { IconButton } from '../design/IconButton'
import {
  SettingsIcon,
  SidebarCloseIcon,
  SidebarOpenIcon,
  PlaylistIcon,
} from '../design/icons'
import LibrarySelector from '../common/LibrarySelector'
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

export const Sidebar = memo(() => {
  const t = useT()
  const { collapsed, toggleSidebar } = useShell()
  return (
    <aside
      className={clsx(styles.root, collapsed && styles.collapsed)}
      aria-label={t('ui.nav.main', 'Main navigation')}
    >
      <div className={styles.brand}>
        <Link to="/" className={styles.logoLink} aria-label="Lyvune">
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

        {!collapsed && config.devSidebarPlaylists && <SidebarPlaylists />}
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
