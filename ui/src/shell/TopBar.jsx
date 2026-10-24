import React, { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { useHistory, useLocation } from 'react-router-dom'
import { usePermissions } from 'react-admin'
import { useT } from '../i18n/useT'
import { IconButton } from '../design/IconButton'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  SearchIcon,
} from '../design/icons'
import NowPlayingPanel from '../layout/NowPlayingPanel'
import ActivityPanel from '../layout/ActivityPanel'
import config from '../config'
import { LogoMark } from './Logo'
import UserMenu from './UserMenu'
import styles from './TopBar.module.css'

const useScrolled = () => {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setScrolled(window.scrollY > 8))
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
    }
  }, [])
  return scrolled
}

const isTypingTarget = (el) =>
  el &&
  (el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable)

/** Global search field. "/" or Ctrl/⌘+K focuses it from anywhere. */
const SearchField = () => {
  const t = useT()
  const history = useHistory()
  const location = useLocation()
  const inputRef = useRef(null)
  const onSearchPage = location.pathname === '/search'
  const urlQuery = onSearchPage
    ? new URLSearchParams(location.search).get('q') || ''
    : ''
  const [value, setValue] = useState(urlQuery)

  useEffect(() => {
    if (onSearchPage) setValue(urlQuery)
  }, [onSearchPage, urlQuery])

  // Leaving the search page clears the field
  useEffect(() => {
    if (location.pathname !== '/search') setValue('')
  }, [location.pathname])

  useEffect(() => {
    const onKey = (e) => {
      const k = e.key.toLowerCase()
      if (
        (k === '/' && !isTypingTarget(e.target)) ||
        (k === 'k' && (e.metaKey || e.ctrlKey))
      ) {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Debounced navigation keeps results live while typing
  useEffect(() => {
    if (value === urlQuery) return undefined
    const timer = setTimeout(() => {
      const to = `/search${value ? `?q=${encodeURIComponent(value)}` : ''}`
      if (onSearchPage) history.replace(to)
      else if (value) history.push(to)
    }, config.uiSearchDebounceMs || 200)
    return () => clearTimeout(timer)
  }, [value, urlQuery, onSearchPage, history])

  const label = t('ui.search.placeholder', 'Search your library')
  return (
    <form
      role="search"
      className={styles.search}
      onSubmit={(e) => {
        e.preventDefault()
        history[onSearchPage ? 'replace' : 'push'](
          `/search?q=${encodeURIComponent(value)}`,
        )
      }}
    >
      <SearchIcon size={17} className={styles.searchIcon} aria-hidden />
      <input
        ref={inputRef}
        type="search"
        className={styles.searchInput}
        placeholder={label}
        aria-label={label}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setValue('')
            e.currentTarget.blur()
          }
        }}
        autoComplete="off"
        spellCheck={false}
      />
      {value ? (
        <button
          type="button"
          className={styles.searchClear}
          aria-label={t('ra.action.clear_input_value', 'Clear')}
          onClick={() => {
            setValue('')
            inputRef.current?.focus()
          }}
        >
          <CloseIcon size={15} aria-hidden />
        </button>
      ) : (
        <kbd className={styles.kbd} aria-hidden>
          /
        </kbd>
      )}
    </form>
  )
}

export const TopBar = ({ logout }) => {
  const t = useT()
  const history = useHistory()
  const { pathname } = useLocation()
  const scrolled = useScrolled()
  // Phones: detail pages get a back button in place of the logo
  const isRootTab = ['/', '/search', '/library', '/playlist'].includes(pathname)
  const { permissions } = usePermissions()
  const isAdmin = permissions === 'admin'

  return (
    <header className={clsx(styles.root, scrolled && styles.scrolled)}>
      <div className={styles.left}>
        <span className={styles.mobileLogo}>
          {isRootTab ? (
            <LogoMark size={26} />
          ) : (
            <IconButton
              size="sm"
              variant="subtle"
              icon={ChevronLeftIcon}
              label={t('ra.action.back', 'Back')}
              onClick={() => history.goBack()}
            />
          )}
        </span>
        <div className={styles.history}>
          <IconButton
            size="sm"
            variant="subtle"
            icon={ChevronLeftIcon}
            label={t('ra.action.back', 'Back')}
            onClick={() => history.goBack()}
          />
          <IconButton
            size="sm"
            variant="subtle"
            icon={ChevronRightIcon}
            label={t('ui.nav.forward', 'Forward')}
            onClick={() => history.goForward()}
          />
        </div>
      </div>
      <div className={styles.center}>
        <SearchField />
      </div>
      <div className={styles.right}>
        {config.devActivityPanel && isAdmin && config.enableNowPlaying && (
          <NowPlayingPanel />
        )}
        {config.devActivityPanel && isAdmin && <ActivityPanel />}
        <UserMenu logout={logout} />
      </div>
    </header>
  )
}

export default TopBar
