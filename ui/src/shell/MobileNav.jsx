import React from 'react'
import clsx from 'clsx'
import { Link, useLocation } from 'react-router-dom'
import { useT } from '../i18n/useT'
import { mobileNav, navLabel } from './navigation'
import styles from './MobileNav.module.css'

/** Bottom tab bar for phones and small tablets. */
export const MobileNav = () => {
  const t = useT()
  const { pathname } = useLocation()
  return (
    <nav
      className={styles.root}
      aria-label={t('ui.nav.main', 'Main navigation')}
    >
      {mobileNav.map((item) => {
        const active = item.match(pathname)
        const Icon = item.icon
        return (
          <Link
            key={item.id}
            to={item.to}
            className={clsx(styles.tab, active && styles.active)}
            aria-current={active ? 'page' : undefined}
          >
            <Icon size={22} aria-hidden />
            <span>{navLabel(t, item)}</span>
          </Link>
        )
      })}
    </nav>
  )
}

export default MobileNav
