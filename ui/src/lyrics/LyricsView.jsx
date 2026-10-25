import React, {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import clsx from 'clsx'
import { useT } from '../i18n/useT'
import { EmptyState } from '../design/Section'
import { Button } from '../design/Button'
import { LyricsIcon, TranslateIcon, QuoteIcon } from '../design/icons'
import engine from '../playback/engine'
import { prefersReducedMotion, segmentProgress } from './karaoke'
import { useActiveLine } from './useActiveLine'
import { LyricsSourceBar } from './LyricsSourceBar'
import { useLyrics } from './useLyrics'
import { useRomanization } from './useRomanization'
import styles from './LyricsView.module.css'

const MANUAL_SCROLL_GRACE_MS = 4000
const ROMANIZATION_KEY = 'lyrics.romanization'

// The listener's choice is remembered in this browser; storage may be blocked
const readStored = (key, fallback) => {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}
const writeStored = (key, value) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // not remembered
  }
}
const readRomanization = () => readStored(ROMANIZATION_KEY, 'off') === 'on'
const writeRomanization = (on) =>
  writeStored(ROMANIZATION_KEY, on ? 'on' : 'off')

// How Japanese is written is one choice for every song; how Han characters are
// read is per song, because it depends on the song
const STYLE_KEY = 'lyrics.romanization.style'
const HAN_KEY = 'lyrics.romanization.han.'
const readStyle = () =>
  readStored(STYLE_KEY, 'ascii') === 'macron' ? 'macron' : 'ascii'
const readHan = (trackId) => {
  const v = readStored(HAN_KEY + trackId, 'auto')
  return v === 'ja' || v === 'zh' ? v : 'auto'
}

/**
 * Word-level karaoke for the active line only. Progress is written to CSS
 * variables from a rAF loop that reads the audio clock itself, so React does
 * not re-render per frame, a seek or a pause is followed on the next frame,
 * and nothing runs on a timer of its own.
 */
const KaraokeLine = ({ words }) => {
  const ref = useRef(null)
  // Layout effect: the first progress is written before the line is painted, so
  // a line that becomes active in the middle (after a seek) never shows a frame
  // of unsung words
  useLayoutEffect(() => {
    let frame
    let lastMs = null
    const written = []
    const step = prefersReducedMotion()
    const apply = () => {
      const el = ref.current
      const ms = engine.currentTime() * 1000
      // Nothing to do while the clock stands still (paused)
      if (!el || ms === lastMs) return
      lastMs = ms
      const progress = segmentProgress(words, ms, step)
      const spans = el.children
      for (let i = 0; i < progress.length; i++) {
        const value = progress[i].toFixed(3)
        if (written[i] !== value) {
          written[i] = value
          spans[i].style.setProperty('--p', value)
        }
      }
    }
    const tick = () => {
      apply()
      frame = requestAnimationFrame(tick)
    }
    apply()
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [words])
  return (
    <span ref={ref}>
      {words.map((w, i) => (
        <span key={i} className={styles.word}>
          {w.text}
        </span>
      ))}
    </span>
  )
}

const Line = memo(
  ({
    line,
    index,
    state,
    onSeek,
    showTranslation,
    showPronunciation,
    synced,
  }) => {
    const content =
      state === 'active' && line.words ? (
        <KaraokeLine words={line.words} />
      ) : (
        line.text || ' '
      )
    const body = (
      <>
        {showPronunciation && line.pronunciation && (
          <span className={styles.pronunciation}>{line.pronunciation}</span>
        )}
        <span className={styles.text}>{content}</span>
        {showTranslation && line.translation && (
          <span className={styles.translation}>{line.translation}</span>
        )}
      </>
    )
    if (!synced) {
      return (
        <p
          className={clsx(styles.line, styles.plain, !line.text && styles.gap)}
        >
          {body}
        </p>
      )
    }
    return (
      <button
        type="button"
        data-index={index}
        className={clsx(
          styles.line,
          styles[state],
          !line.text && styles.gap,
          line.words && state === 'active' && styles.karaoke,
        )}
        onClick={() => onSeek(line.start)}
        aria-current={state === 'active' ? 'true' : undefined}
      >
        {body}
      </button>
    )
  },
)

Line.displayName = 'Line'

const SyncedLyrics = ({ lyrics, showTranslation, showPronunciation }) => {
  const t = useT()
  const containerRef = useRef(null)
  const manualUntil = useRef(0)
  const [following, setFollowing] = useState(true)
  const active = useActiveLine(lyrics.lines)

  const scrollToActive = useCallback(
    (behavior = 'smooth') => {
      const el = containerRef.current?.querySelector(
        `[data-index="${Math.max(active, 0)}"]`,
      )
      if (el && containerRef.current) {
        const c = containerRef.current
        const top = el.offsetTop - c.clientHeight * 0.38 + el.clientHeight / 2
        c.scrollTo({ top, behavior })
      }
    },
    [active],
  )

  // Follow the active line unless the listener is reading elsewhere
  useEffect(() => {
    if (Date.now() < manualUntil.current) return
    setFollowing(true)
    scrollToActive(
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    )
  }, [scrollToActive])

  const onUserScroll = () => {
    manualUntil.current = Date.now() + MANUAL_SCROLL_GRACE_MS
    setFollowing(false)
  }

  const onSeek = useCallback((ms) => {
    if (ms == null) return
    manualUntil.current = 0
    engine.seek(ms / 1000)
    if (engine.getMedia().paused) engine.play()
  }, [])

  return (
    <div className={styles.syncedWrap}>
      <div
        ref={containerRef}
        className={styles.scroller}
        onWheel={onUserScroll}
        onTouchMove={onUserScroll}
        onKeyDown={(e) => {
          if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(e.key))
            onUserScroll()
        }}
        lang={lyrics.lang && lyrics.lang !== 'xxx' ? lyrics.lang : undefined}
      >
        <div className={styles.pad} />
        {lyrics.lines.map((line, i) => (
          <Line
            key={i}
            index={i}
            line={line}
            synced
            state={i === active ? 'active' : i < active ? 'past' : 'future'}
            onSeek={onSeek}
            showTranslation={showTranslation}
            showPronunciation={showPronunciation}
          />
        ))}
        <div className={styles.pad} />
      </div>
      {!following && (
        <Button
          size="sm"
          variant="secondary"
          className={styles.resync}
          onClick={() => {
            manualUntil.current = 0
            setFollowing(true)
            scrollToActive()
          }}
        >
          {t('ui.lyrics.backToCurrent', 'Back to current line')}
        </Button>
      )}
    </div>
  )
}

const PlainLyrics = ({ lyrics, showTranslation, showPronunciation }) => {
  const t = useT()
  return (
    <div
      className={clsx(styles.scroller, styles.plainScroller)}
      lang={lyrics.lang && lyrics.lang !== 'xxx' ? lyrics.lang : undefined}
    >
      <p className={styles.notice}>
        {t('ui.lyrics.unsynced', 'These lyrics are not synced to the music.')}
      </p>
      {lyrics.lines.map((line, i) => (
        <Line
          key={i}
          index={i}
          line={line}
          showTranslation={showTranslation}
          showPronunciation={showPronunciation}
        />
      ))}
    </div>
  )
}

/** Lyrics for the given track: synced, unsynced, or a quiet fallback. */
export const LyricsView = ({ trackId, title, isRadio, className }) => {
  const t = useT()
  const { status, lyrics: found, searching } = useLyrics(trackId, !isRadio)
  const [showTranslation, setShowTranslation] = useState(true)
  const [showPronunciation, setShowPronunciation] = useState(readRomanization)
  const [style, setStyle] = useState(readStyle)
  const [han, setHan] = useState(() => readHan(trackId))
  // Another song has its own reading of Han characters
  useEffect(() => setHan(readHan(trackId)), [trackId])
  const roman = useRomanization(found, showPronunciation, { style, han })
  const lyrics = roman.lyrics

  let body
  if (isRadio || !trackId) {
    body = (
      <EmptyState
        icon={LyricsIcon}
        title={t(
          'ui.lyrics.unavailable',
          'Lyrics are not available for this stream',
        )}
        compact
      />
    )
  } else if (status === 'loading' || status === 'idle') {
    body = <div className={styles.loading} aria-busy="true" />
  } else if (searching) {
    body = (
      <EmptyState
        icon={LyricsIcon}
        title={t('ui.lyrics.searching', 'Looking for lyrics…')}
        compact
      />
    )
  } else if (status === 'error' || !lyrics || lyrics.lines.length === 0) {
    body = (
      <EmptyState
        icon={LyricsIcon}
        title={t('ui.lyrics.none', 'No lyrics for this song')}
        compact
      >
        {t(
          'ui.lyrics.noneHint',
          'Lyrics embedded in your files or stored alongside them (.lrc, .txt) show up here.',
        )}
      </EmptyState>
    )
  } else if (lyrics.synced) {
    body = (
      <SyncedLyrics
        key={trackId}
        lyrics={lyrics}
        showTranslation={showTranslation}
        showPronunciation={showPronunciation}
      />
    )
  } else {
    body = (
      <PlainLyrics
        lyrics={lyrics}
        showTranslation={showTranslation}
        showPronunciation={showPronunciation}
      />
    )
  }

  const toggles =
    lyrics &&
    (lyrics.hasTranslation || lyrics.hasPronunciation || roman.available)
  return (
    <div className={clsx(styles.root, className)}>
      {toggles && (
        <div className={styles.toggles}>
          {lyrics.hasTranslation && (
            <Button
              size="sm"
              variant="chip"
              icon={TranslateIcon}
              aria-pressed={showTranslation}
              onClick={() => setShowTranslation((v) => !v)}
            >
              {t('ui.lyrics.translation', 'Translation')}
            </Button>
          )}
          {(lyrics.hasPronunciation || roman.available) && (
            <Button
              size="sm"
              variant="chip"
              icon={QuoteIcon}
              aria-pressed={showPronunciation}
              aria-busy={roman.status === 'loading'}
              title={
                roman.available
                  ? t(
                      'ui.lyrics.romanizationAuto',
                      'Generated on this device. It is approximate, and Arabic is written without short vowels.',
                    )
                  : undefined
              }
              onClick={() =>
                setShowPronunciation((v) => {
                  writeRomanization(!v)
                  return !v
                })
              }
            >
              {t('ui.lyrics.pronunciation', 'Romanization')}
            </Button>
          )}
          {showPronunciation &&
            roman.available &&
            roman.engines.includes('ja') && (
              <span
                className={styles.segmented}
                data-value={style}
                role="group"
                aria-label={t('ui.lyrics.romajiStyle', 'Romaji style')}
              >
                <span className={styles.thumb} aria-hidden="true" />
                {[
                  [
                    'ascii',
                    'ou · aa',
                    t('ui.lyrics.romajiAscii', 'Doubled vowels (ou, aa)'),
                  ],
                  [
                    'macron',
                    'ō · ā',
                    t('ui.lyrics.romajiMacron', 'Macrons (ō, ā)'),
                  ],
                ].map(([value, label, title]) => (
                  <button
                    key={value}
                    type="button"
                    className={styles.segment}
                    aria-pressed={style === value}
                    title={title}
                    onClick={() => {
                      writeStored(STYLE_KEY, value)
                      setStyle(value)
                    }}
                  >
                    {label}
                  </button>
                ))}
              </span>
            )}
          {showPronunciation &&
            roman.available &&
            (roman.ambiguous || han !== 'auto') && (
              <select
                className={styles.toggleSelect}
                aria-label={t('ui.lyrics.hanReading', 'Read Han characters as')}
                value={han}
                onChange={(e) => {
                  writeStored(HAN_KEY + trackId, e.target.value)
                  setHan(e.target.value)
                }}
              >
                <option value="auto">
                  {t('ui.lyrics.hanAuto', 'Han characters: automatic')}
                </option>
                <option value="zh">
                  {t('ui.lyrics.hanChinese', 'Han characters: Chinese')}
                </option>
                <option value="ja">
                  {t('ui.lyrics.hanJapanese', 'Han characters: Japanese')}
                </option>
              </select>
            )}
          {showPronunciation && roman.status === 'error' && (
            <span role="alert" className={styles.toggleError}>
              {t(
                'ui.lyrics.romanizationFailed',
                'Romanization could not be loaded.',
              )}
            </span>
          )}
        </div>
      )}
      {body}
      {!isRadio && trackId && (
        <LyricsSourceBar
          trackId={trackId}
          title={title}
          searching={searching}
        />
      )}
    </div>
  )
}

export default LyricsView
