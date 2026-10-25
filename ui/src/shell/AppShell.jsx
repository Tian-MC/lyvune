import React, { Component, lazy, Suspense, useEffect, useMemo } from 'react'
import clsx from 'clsx'
import { useDispatch, useSelector } from 'react-redux'
import { useHistory } from 'react-router-dom'
import { createTheme, ThemeProvider } from '@material-ui/core/styles'
import useCurrentTheme from '../themes/useCurrentTheme'
import { useT } from '../i18n/useT'
import { useScrollRestoration, useSearchRefocus } from '../common'
import authProvider from '../authProvider'
import { startEventStream } from '../eventStream'
import config from '../config'
import Notification from '../layout/Notification'
import { Dialogs } from '../dialogs/Dialogs'
import InfoDialog from './InfoDialog'
import { Button } from '../design/Button'
import { EmptyState } from '../design/Section'
import { AlertIcon } from '../design/icons'
import { ShellProvider } from './ShellContext'
import { useAutoLyrics } from '../playback/useAutoLyrics'
import { useCheckboxNames } from './useCheckboxNames'
import { usePresence } from './usePresence'
import { useShell } from './useShell'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import MobileNav from './MobileNav'
import PlayerBar from '../playback/PlayerBar'
import PlaybackHotkeys from '../playback/PlaybackHotkeys'
import styles from './AppShell.module.css'

// Keep in step with the `leave` animation in playback/NowPlaying.module.css
const NOW_PLAYING_EXIT_MS = 240

const NowPlaying = lazy(() => import('../playback/NowPlaying'))
const QueuePanel = lazy(() => import('../playback/QueuePanel'))

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidMount() {
    // Reset on navigation, like react-admin's layout did
    this.unlisten = this.props.history.listen(() => {
      if (this.state.error) this.setState({ error: null })
    })
  }

  componentWillUnmount() {
    this.unlisten && this.unlisten()
  }

  render() {
    if (this.state.error) {
      return (
        <EmptyState
          icon={AlertIcon}
          title={this.props.t('ui.error.title', 'Something went wrong')}
          action={
            <Button onClick={() => this.setState({ error: null })}>
              {this.props.t('ui.error.retry', 'Try again')}
            </Button>
          }
        >
          {String(this.state.error?.message || this.state.error)}
        </EmptyState>
      )
    }
    return this.props.children
  }
}

const ShellLayout = ({ children, logout }) => {
  const t = useT()
  const history = useHistory()
  const hasQueue = useSelector((state) => state.player.queue.length > 0)
  const { collapsed, nowPlaying, queueOpen } = useShell()
  const npPresence = usePresence(nowPlaying.open, NOW_PLAYING_EXIT_MS)
  // New pages open at the top; going back restores the previous offset
  useScrollRestoration()
  // Clearing a react-admin search box puts the cursor back in it
  useSearchRefocus()
  // react-admin's table checkboxes come without an accessible name
  useCheckboxNames()
  // Looks for lyrics online when a track without any starts playing
  useAutoLyrics()

  return (
    <div
      className={clsx(
        styles.app,
        hasQueue && styles.withPlayer,
        collapsed && styles.collapsed,
      )}
    >
      {/* A button, not an anchor: "#main-content" would be read as a route */}
      <button
        type="button"
        className={styles.skipLink}
        onClick={() => document.getElementById('main-content')?.focus()}
      >
        {t('ui.nav.skipToContent', 'Skip to content')}
      </button>
      <Sidebar />
      <div className={styles.main}>
        <TopBar logout={logout} />
        <main id="main-content" className={styles.content} tabIndex={-1}>
          {/* react-admin <Title> portals here: every screen gets the same heading */}
          <h1 id="react-admin-title" className={styles.pageTitle} />
          <ErrorBoundary history={history} t={t}>
            {children}
          </ErrorBoundary>
        </main>
      </div>
      <PlayerBar />
      <MobileNav />
      <Suspense fallback={null}>
        {queueOpen && <QueuePanel />}
        {npPresence.mounted && <NowPlaying closing={npPresence.closing} />}
      </Suspense>
      <Notification />
      <Dialogs />
      <InfoDialog />
      <PlaybackHotkeys />
    </div>
  )
}

/** react-admin `layout`: the application shell of the redesigned UI. */
export const AppShell = ({ children, logout }) => {
  const theme = useCurrentTheme()
  const muiTheme = useMemo(() => createTheme(theme), [theme])
  const dispatch = useDispatch()

  useEffect(() => {
    if (config.devActivityPanel) {
      authProvider
        .checkAuth()
        .then(() => startEventStream(dispatch))
        .catch(() => {})
    }
  }, [dispatch])

  return (
    <ThemeProvider theme={muiTheme}>
      <ShellProvider>
        <ShellLayout logout={logout}>{children}</ShellLayout>
      </ShellProvider>
    </ThemeProvider>
  )
}

export default AppShell
