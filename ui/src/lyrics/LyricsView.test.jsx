import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  lyrics: { status: 'ready', lyrics: null },
  seek: vi.fn(),
  play: vi.fn(),
  paused: true,
  time: 0,
}))

vi.mock('react-admin', () => ({
  useTranslate: () => (key, opts) => opts?._ ?? key,
}))
vi.mock('./useLyrics', () => ({ useLyrics: () => mocks.lyrics }))
vi.mock('./LyricsSourceBar', () => ({
  LyricsSourceBar: ({ searching }) => (
    <div data-testid="source-bar" data-searching={String(!!searching)} />
  ),
}))
vi.mock('../playback/engine', () => ({
  default: {
    seek: mocks.seek,
    play: mocks.play,
    currentTime: () => mocks.time,
    getMedia: () => ({ paused: mocks.paused }),
  },
}))

import { LyricsView } from './LyricsView'

// FIXTURE data: synthetic text, not lyrics of any real recording
const line = (text, start = null, extra = {}) => ({
  start,
  text,
  words: null,
  translation: null,
  pronunciation: null,
  ...extra,
})

const show = (lyrics, props = {}) => {
  mocks.lyrics = { status: 'ready', lyrics }
  return render(<LyricsView trackId="t1" {...props} />)
}

describe('<LyricsView /> (fixtures)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // jsdom has neither
    window.matchMedia = () => ({ matches: false })
    Element.prototype.scrollTo = vi.fn()
    mocks.paused = true
    mocks.time = 0
    mocks.lyrics = { status: 'ready', lyrics: null }
  })

  it('shows where the lyrics come from, for a track', () => {
    show(null)
    expect(screen.getByTestId('source-bar')).toBeInTheDocument()
  })

  it('has no source line for a radio stream', () => {
    show(null, { isRadio: true })
    expect(screen.queryByTestId('source-bar')).not.toBeInTheDocument()
  })

  it('says it is looking while the server searches online', () => {
    mocks.lyrics = { status: 'ready', lyrics: null, searching: true }
    render(<LyricsView trackId="t1" />)
    expect(screen.getByText('Looking for lyrics…')).toBeInTheDocument()
    expect(
      screen.queryByText('No lyrics for this song'),
    ).not.toBeInTheDocument()
    expect(screen.getByTestId('source-bar')).toHaveAttribute(
      'data-searching',
      'true',
    )
  })

  it('explains that streams have no lyrics', () => {
    show(null, { isRadio: true })
    expect(
      screen.getByText('Lyrics are not available for this stream'),
    ).toBeInTheDocument()
  })

  it('shows a quiet fallback when the song has no lyrics', () => {
    show(null)
    expect(screen.getByText('No lyrics for this song')).toBeInTheDocument()
  })

  it('also falls back when loading fails', () => {
    mocks.lyrics = { status: 'error', lyrics: null }
    render(<LyricsView trackId="t1" />)
    expect(screen.getByText('No lyrics for this song')).toBeInTheDocument()
  })

  it('shows unsynchronized lyrics as plain text with a notice', () => {
    show({
      synced: false,
      lang: '',
      hasWords: false,
      hasTranslation: false,
      hasPronunciation: false,
      lines: [line('first'), line('second')],
    })
    expect(
      screen.getByText('These lyrics are not synced to the music.'),
    ).toBeInTheDocument()
    expect(screen.getByText('first')).toBeInTheDocument()
    expect(document.querySelectorAll('button[data-index]')).toHaveLength(0)
  })

  it('renders synchronized lines as buttons that seek and start playback', () => {
    mocks.time = 3
    show({
      synced: true,
      lang: 'xxx',
      hasWords: false,
      hasTranslation: false,
      hasPronunciation: false,
      lines: [line('one', 0), line('two', 2500), line('終わり', 5000)],
    })
    const buttons = document.querySelectorAll('button[data-index]')
    expect(buttons).toHaveLength(3)
    // the audio clock (3 s) makes line 1 the active one
    expect(buttons[1].getAttribute('aria-current')).toBe('true')
    fireEvent.click(buttons[2])
    expect(mocks.seek).toHaveBeenCalledWith(5)
    expect(mocks.play).toHaveBeenCalled()
  })

  it('offers translation and romanization only when they exist', () => {
    show({
      synced: false,
      lang: 'jpn',
      hasWords: false,
      hasTranslation: false,
      hasPronunciation: false,
      lines: [line('test')],
    })
    expect(screen.queryByText('Translation')).toBeNull()
    expect(screen.queryByText('Romanization')).toBeNull()
  })

  it('shows translations by default and romanization on demand', () => {
    show({
      synced: false,
      lang: 'jpn',
      hasWords: false,
      hasTranslation: true,
      hasPronunciation: true,
      lines: [
        line('テスト', null, {
          translation: 'FIXTURE TRANSLATION',
          pronunciation: 'fixture romanization',
        }),
      ],
    })
    expect(screen.getByText('FIXTURE TRANSLATION')).toBeInTheDocument()
    expect(screen.queryByText('fixture romanization')).toBeNull()

    fireEvent.click(screen.getByText('Romanization'))
    expect(screen.getByText('fixture romanization')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Translation'))
    expect(screen.queryByText('FIXTURE TRANSLATION')).toBeNull()
  })

  it('offers a romanization made here when the source has none', async () => {
    localStorage.clear()
    show({
      synced: false,
      hasWords: false,
      lang: '',
      hasTranslation: false,
      hasPronunciation: false,
      lines: [line('안녕하세요'), line('사랑해요')],
    })
    const toggle = screen.getByText('Romanization')
    expect(screen.queryByText('annyeonghaseyo')).toBeNull()
    fireEvent.click(toggle)
    expect(await screen.findByText('annyeonghaseyo')).toBeTruthy()
    expect(localStorage.getItem('lyrics.romanization')).toBe('on')
  })

  it('has no romanization button for lyrics in the Latin alphabet', () => {
    show({
      synced: false,
      hasWords: false,
      lang: '',
      hasTranslation: false,
      hasPronunciation: false,
      lines: [line('first line'), line('second line')],
    })
    expect(screen.queryByText('Romanization')).toBeNull()
  })
})
