import React from 'react'
import { Link } from 'react-router-dom'
import { useT } from '../../i18n/useT'
import { PageHeader } from '../../design/Section'
import {
  ChevronRightIcon,
  PlaylistIcon,
  SettingsIcon,
} from '../../design/icons'
import { libraryNav, navLabel } from '../../shell/navigation'
import LibrarySelector from '../../common/LibrarySelector'
import styles from './LibraryHub.module.css'

/** Library index — the mobile entry point to every collection. */
const LibraryHub = () => {
  const t = useT()
  const items = [
    ...libraryNav(),
    {
      id: 'playlists',
      to: '/playlist',
      icon: PlaylistIcon,
      labelKey: 'menu.playlists',
      label: 'Playlists',
    },
    {
      id: 'settings',
      to: '/personal',
      icon: SettingsIcon,
      labelKey: 'menu.settings',
      label: 'Settings',
    },
  ]
  return (
    <div>
      <PageHeader title={t('menu.library', 'Library')} />
      <div className={styles.selector}>
        <LibrarySelector />
      </div>
      <nav aria-label={t('menu.library', 'Library')}>
        <ul className={styles.list}>
          {items.map((item) => {
            const Icon = item.icon
            return (
              <li key={item.id}>
                <Link to={item.to} className={styles.item}>
                  <span className={styles.icon}>
                    <Icon size={20} aria-hidden />
                  </span>
                  <span className={styles.label}>{navLabel(t, item)}</span>
                  <ChevronRightIcon
                    size={18}
                    className={styles.chevron}
                    aria-hidden
                  />
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}

export default LibraryHub
