import { render, act, screen, fireEvent } from '@testing-library/react'

const mockShare = vi.hoisted(() => ({
  info: {
    id: 'share-1',
    description: 'Road trip',
    downloadable: true,
    tracks: [
      { id: 't1', title: 'One', artist: 'A', album: 'X', duration: 100 },
      { id: 't2', title: 'Two', artist: 'B', album: 'X', duration: 200 },
    ],
  },
}))

vi.mock('../config', () => ({
  default: { enableDownloads: true },
  get shareInfo() {
    return mockShare.info
  },
}))

vi.mock('../utils', () => ({
  shareDownloadUrl: (id) => `/share/d/${id}`,
  shareStreamUrl: (id) => `/share/s/${id}`,
  shareCoverUrl: (id) => `/share/img/${id}`,
}))

vi.mock('../i18n', () => ({
  i18nProvider: { translate: (key, opts) => opts?._ ?? key },
}))

import SharePlayer, { DOWNLOAD_FEEDBACK_MS } from './SharePlayer'

// jsdom has no media playback; unmounting pauses the page's audio element
window.HTMLMediaElement.prototype.pause = () => {}

describe('SharePlayer', () => {
  let clickSpy

  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() =>
      Promise.resolve(),
    )
    // Downloading for real would navigate the jsdom window.
    clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {})
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows the share description and every shared track', () => {
    render(<SharePlayer />)
    expect(screen.getByRole('heading', { name: 'Road trip' })).toBeTruthy()
    expect(screen.getAllByText('One').length).toBeGreaterThan(0)
    expect(screen.getByText('Two')).toBeTruthy()
  })

  it('downloads via an anchor so the service worker does not intercept it', () => {
    render(<SharePlayer />)
    let anchor
    clickSpy.mockImplementation(function () {
      anchor = { href: this.href, download: this.download }
    })
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    })
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(anchor.href).toContain('/share/d/share-1')
    // Empty, so the server's Content-Disposition filename wins.
    expect(anchor.download).toBe('')
    expect(document.querySelectorAll('a[download]')).toHaveLength(0)
  })

  it('keeps the download button inert during the feedback window', () => {
    render(<SharePlayer />)
    const button = screen.getByRole('button', { name: 'Download' })
    act(() => {
      fireEvent.click(button)
    })
    expect(button.disabled).toBe(true)
    act(() => {
      vi.advanceTimersByTime(DOWNLOAD_FEEDBACK_MS)
    })
    expect(button.disabled).toBe(false)
  })

  it('selects a track from the list', () => {
    render(<SharePlayer />)
    const row = () =>
      screen
        .getAllByText('Two')
        .map((el) => el.closest('button'))
        .find(Boolean)
    act(() => {
      fireEvent.click(row())
    })
    expect(row().getAttribute('aria-current')).toBe('true')
  })

  it('disables next for a single shared track and hides the list', () => {
    mockShare.info = {
      id: 'share-2',
      downloadable: false,
      tracks: [{ id: 't1', title: 'Solo', artist: 'A', duration: 10 }],
    }
    render(<SharePlayer />)
    expect(screen.getByRole('button', { name: 'Next track' }).disabled).toBe(
      true,
    )
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('explains an empty share instead of rendering a broken player', () => {
    mockShare.info = { id: 'share-3', tracks: [] }
    render(<SharePlayer />)
    expect(screen.getByText('Nothing to play')).toBeTruthy()
  })
})
