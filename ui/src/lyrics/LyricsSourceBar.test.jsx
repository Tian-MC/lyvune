import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('react-admin', () => ({
  useTranslate: () => (key, opts) =>
    String(opts?._ ?? key).replace(/%\{(\w+)\}/g, (_, k) => opts?.[k] ?? ''),
}))
const api = vi.hoisted(() => ({ status: vi.fn() }))
vi.mock('./manageApi', async () => ({
  ...(await vi.importActual('./manageApi')),
  lyricsApi: api,
}))
vi.mock('./LyricsManager', () => ({
  LyricsManager: ({ trackId, onClose }) => (
    <div data-testid="manager" data-track={trackId}>
      <button onClick={onClose}>close manager</button>
    </div>
  ),
}))

import { LyricsSourceBar } from './LyricsSourceBar'

const status = (over = {}) => ({
  current: {
    id: 'managed',
    source: 'managed',
    provider: 'lrclib',
    quality: 'synced',
  },
  local: [],
  locked: false,
  offsetMs: 0,
  history: [],
  writable: true,
  ...over,
})

describe('<LyricsSourceBar />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.status.mockResolvedValue(status())
  })
  afterEach(() => localStorage.removeItem('role'))

  it('says where the lyrics come from, and how well they are synced', async () => {
    render(<LyricsSourceBar trackId="sb-1" />)
    expect(
      await screen.findByText('Downloaded from LRCLIB'),
    ).toBeInTheDocument()
    expect(screen.getByText('Synced')).toBeInTheDocument()
  })

  it('shows the lock, the offset and the provider attribution', async () => {
    api.status.mockResolvedValue(
      status({
        locked: true,
        offsetMs: -300,
        current: {
          id: 'managed',
          source: 'managed',
          provider: 'lrclib',
          quality: 'karaoke',
          attribution: 'Lyrics from LRCLIB (lrclib.net)',
        },
      }),
    )
    render(<LyricsSourceBar trackId="sb-2" />)
    expect(await screen.findByText('-300 ms')).toBeInTheDocument()
    expect(screen.getByLabelText('Locked')).toBeInTheDocument()
    expect(
      screen.getByText('Lyrics from LRCLIB (lrclib.net)'),
    ).toBeInTheDocument()
    expect(screen.getByText('Karaoke')).toBeInTheDocument()
  })

  it('says it is looking while the server searches', async () => {
    api.status.mockResolvedValue(status({ current: null }))
    render(<LyricsSourceBar trackId="sb-3" searching />)
    expect(await screen.findByText('Looking for lyrics…')).toBeInTheDocument()
  })

  it('is invisible to a regular user when there is nothing to say', async () => {
    api.status.mockResolvedValue(status({ current: null }))
    const { container } = render(<LyricsSourceBar trackId="sb-4" />)
    await waitFor(() => expect(api.status).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('offers the manager only to administrators', async () => {
    const { unmount } = render(<LyricsSourceBar trackId="sb-5" />)
    await screen.findByText('Downloaded from LRCLIB')
    expect(
      screen.queryByRole('button', { name: 'Manage' }),
    ).not.toBeInTheDocument()
    unmount()

    localStorage.setItem('role', 'admin')
    render(<LyricsSourceBar trackId="sb-5" title="Song" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Manage' }))
    expect(screen.getByTestId('manager')).toHaveAttribute('data-track', 'sb-5')
    fireEvent.click(screen.getByText('close manager'))
    expect(screen.queryByTestId('manager')).not.toBeInTheDocument()
  })

  it('lets an administrator add lyrics to a track that has none', async () => {
    localStorage.setItem('role', 'admin')
    api.status.mockResolvedValue(status({ current: null }))
    render(<LyricsSourceBar trackId="sb-6" />)
    expect(
      await screen.findByRole('button', { name: 'Manage' }),
    ).toBeInTheDocument()
  })

  it('stays quiet if the state cannot be loaded', async () => {
    api.status.mockRejectedValue(new Error('down'))
    const { container } = render(<LyricsSourceBar trackId="sb-7" />)
    await waitFor(() => expect(api.status).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
