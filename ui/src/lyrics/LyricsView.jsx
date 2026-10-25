import React, { memo, useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { useT } from '../i18n/useT'
import { EmptyState } from '../design/Section'
import { Button } from '../design/Button'
import { LyricsIcon, TranslateIcon, QuoteIcon } from '../design/icons'
import engine from '../playback/engine'
import { useMedia } from '../playback/hooks'
import { activeLineIndex } from './parse'
import { LyricsSourceBar } from './LyricsSourceBar'
import { useLyrics } from './useLyrics'
import styles from './LyricsView.module.css'

const MANUAL_SCROLL_GRACE_MS = 4000

/**
 * Word-level karaoke for the active line only. Progress is written to CSS
 * variables from a rAF loop, so React does not re-render per frame.
 */
const KaraokeLine = ({ words }) => {
  const ref = useRef(null)
  useEffect(() => {
    let frame
    const tick = () => {
      const el = ref.current
      if (el) {
        const ms = engine.currentTime() * 1000
        const spans = el.children
        for (let i = 0; i < words.length; i++) {
          const w = words[i]
          if (w.start == null) continue
          const end = w.end ?? w.start + 400
          const p =
            ms <= w.start ? 0 : ms >= end ? 1 : (ms - w.start) / (end - w.start)
          spans[i].style.setProperty('--p', p.toFixed(3))
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [words])
  return (
    <span ref={ref}>
      {words.map((w, i) => (
        <span key={i} className={w.start != null ? styles.word : undefined}>
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
  const active = useMedia((m) =>
    activeLineIndex(lyrics.lines, m.currentTime * 1000),
  )

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
  const { status, lyrics, searching } = useLyrics(trackId, !isRadio)
  const [showTranslation, setShowTranslation] = useState(true)
  const [showPronunciation, setShowPronunciation] = useState(false)

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

  const toggles = lyrics && (lyrics.hasTranslation || lyrics.hasPronunciation)
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
          {lyrics.hasPronunciation && (
            <Button
              size="sm"
              variant="chip"
              icon={QuoteIcon}
              aria-pressed={showPronunciation}
              onClick={() => setShowPronunciation((v) => !v)}
            >
              {t('ui.lyrics.pronunciation', 'Romanization')}
            </Button>
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
