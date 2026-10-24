import React, { Component, lazy, Suspense, useEffect, useMemo } from 'react'
import clsx from 'clsx'
import { useDispatch, useSelector } from 'react-redux'
import { useHistory } from 'react-router-dom'
import { createTheme, ThemeProvider } from '@material-ui/core/styles'
import useCurrentTheme from '../themes/useCurrentTheme'
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
import { useShell } from './useShell'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import MobileNav from './MobileNav'
import PlayerBar from '../playback/PlayerBar'
import PlaybackHotkeys from '../playback/PlaybackHotkeys'
import styles from './AppShell.module.css'

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
          title="Something went wrong"
          action={
            <Button onClick={() => this.setState({ error: null })}>
              Try again
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
  const history = useHistory()
  const hasQueue = useSelector((state) => state.player.queue.length > 0)
  const { collapsed, nowPlaying, queueOpen } = useShell()

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
        Skip to content
      </button>
      <Sidebar />
      <div className={styles.main}>
        <TopBar logout={logout} />
        <main id="main-content" className={styles.content} tabIndex={-1}>
          {/* react-admin <Title> portals here: every screen gets the same heading */}
          <h1 id="react-admin-title" className={styles.pageTitle} />
          <ErrorBoundary history={history}>{children}</ErrorBoundary>
        </main>
      </div>
      <PlayerBar />
      <MobileNav />
      <Suspense fallback={null}>
        {queueOpen && <QueuePanel />}
        {nowPlaying.open && <NowPlaying />}
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
