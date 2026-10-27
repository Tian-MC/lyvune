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

// The browser build fetches its dictionary over HTTP; tests read it from node_modules
vi.mock('kuromoji/build/kuromoji.js', async () => {
  const { realTokenizer } = await import('./romanize/testTokenizer')
  return {
    default: {
      builder: () => ({
        build: (done) => realTokenizer().then((t) => done(null, t), done),
      }),
    },
  }
})

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

  it('shows text that looks like HTML as plain text, never as markup', () => {
    show({
      synced: true,
      lang: '',
      hasWords: false,
      hasTranslation: false,
      hasPronunciation: false,
      lines: [
        line("it's <b>bold</b> <img src=x onerror=alert(1)> & done", 1),
        line('<script>alert(1)</script>', 2),
      ],
    })
    expect(
      screen.getByText("it's <b>bold</b> <img src=x onerror=alert(1)> & done"),
    ).toBeInTheDocument()
    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument()
    expect(document.querySelector('b, img, script')).toBeNull()
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

  it('writes Japanese in the style chosen, and remembers it', async () => {
    localStorage.clear()
    show({
      synced: false,
      hasWords: false,
      lang: '',
      hasTranslation: false,
      hasPronunciation: false,
      lines: [line('東京へ行こう'), line('ありがとう')],
    })
    fireEvent.click(screen.getByText('Romanization'))
    expect(await screen.findByText('toukyou e ikou')).toBeTruthy()
    fireEvent.click(screen.getByTitle('Macrons (ō, ā)'))
    expect(await screen.findByText('tōkyō e ikō')).toBeTruthy()
    expect(localStorage.getItem('lyrics.romanization.style')).toBe('macron')
    expect(
      screen.getByTitle('Macrons (ō, ā)').getAttribute('aria-pressed'),
    ).toBe('true')
  })

  it('lets the listener say how ambiguous Han characters are read, per song', async () => {
    localStorage.clear()
    show({
      synced: false,
      hasWords: false,
      lang: '',
      hasTranslation: false,
      hasPronunciation: false,
      lines: [line('東京大阪'), line('京都神戸')],
    })
    fireEvent.click(screen.getByText('Romanization'))
    expect(await screen.findByText(/dōng jīng/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Read Han characters as'), {
      target: { value: 'ja' },
    })
    expect(await screen.findByText(/toukyou/)).toBeTruthy()
    expect(localStorage.getItem('lyrics.romanization.han.t1')).toBe('ja')
  })

  it('does not offer the Han choice when the song says what it is', async () => {
    localStorage.clear()
    show({
      synced: false,
      hasWords: false,
      lang: 'jpn',
      hasTranslation: false,
      hasPronunciation: false,
      lines: [line('東京大阪'), line('京都神戸')],
    })
    fireEvent.click(screen.getByText('Romanization'))
    expect(await screen.findByText(/toukyou/)).toBeTruthy()
    expect(screen.queryByLabelText('Read Han characters as')).toBeNull()
  })
})
