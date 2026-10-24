import React, { useEffect, useRef } from 'react'
import clsx from 'clsx'
import { Link } from 'react-router-dom'
import { useGetOne } from 'react-admin'
import { useT } from '../i18n/useT'
import { useShell } from '../shell/useShell'
import { Ambient } from '../design/Ambient'
import { Cover } from '../design/Cover'
import { IconButton } from '../design/IconButton'
import { LoveToggle } from '../design/LoveToggle'
import { useActionMenu } from '../design/useActionMenu'
import { ChevronDownIcon, LyricsIcon, QueueIcon } from '../design/icons'
import { LyricsView } from '../lyrics/LyricsView'
import { MenuTrigger, SongMenuPopup } from '../views/shared/CollectionMenu'
import config from '../config'
import { QueueList } from './QueueList'
import { Timeline, TransportControls, VolumeControl } from './controls'
import { useCurrentItem, useCurrentSong } from './hooks'
import { coverRecordFor } from './coverRecord'
import styles from './NowPlaying.module.css'

/** Traps Tab inside the dialog and restores focus on close. */
const useDialogFocus = (ref, onClose) => {
  useEffect(() => {
    const previous = document.activeElement
    const root = ref.current
    root?.querySelector('[data-autofocus]')?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab' || !root) return
      const focusable = root.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      previous && previous.focus && previous.focus()
    }
  }, [ref, onClose])
}

const NowPlaying = () => {
  const t = useT()
  const ref = useRef(null)
  const item = useCurrentItem()
  const song = useCurrentSong(item)
  const menu = useActionMenu()
  const { nowPlaying, closeNowPlaying, setNowPlayingPanel } = useShell()
  const panel = nowPlaying.panel
  const isRadio = !!item?.isRadio

  const { data: album } = useGetOne('album', song?.albumId, {
    enabled: !!song?.albumId && !isRadio,
  })

  useDialogFocus(ref, closeNowPlaying)

  // The queue was cleared while open
  useEffect(() => {
    if (!item) closeNowPlaying()
  }, [item, closeNowPlaying])

  if (!item) return null

  const title = song?.title || item.name
  const toggle = (p) => setNowPlayingPanel(panel === p ? null : p)

  return (
    <div
      ref={ref}
      className={clsx(styles.root, panel && styles.withPanel)}
      role="dialog"
      aria-modal="true"
      aria-label={t('ui.player.nowPlaying', 'Now playing')}
    >
      <Ambient
        thumbHash={album?.thumbHash}
        dominantColor={album?.dominantColor}
        intensity="immersive"
      />

      <header className={styles.top}>
        <IconButton
          size="md"
          icon={ChevronDownIcon}
          label={t('ra.action.close', 'Close')}
          onClick={closeNowPlaying}
          data-autofocus
          tooltip={false}
          className={styles.light}
        />
        <div className={styles.context}>
          {song?.album && !isRadio && (
            <>
              <span className={styles.contextLabel}>
                {t('ui.player.playingFrom', 'Playing from')}
              </span>
              <Link
                to={`/album/${song.albumId}/show`}
                className={styles.contextLink}
              >
                {song.album}
              </Link>
            </>
          )}
        </div>
        <div className={styles.panelToggles}>
          <IconButton
            size="md"
            icon={LyricsIcon}
            label={t('player.toggleLyricText', 'Lyrics')}
            active={panel === 'lyrics'}
            pressed={panel === 'lyrics'}
            disabled={isRadio}
            onClick={() => toggle('lyrics')}
            className={styles.light}
          />
          <IconButton
            size="md"
            icon={QueueIcon}
            label={t('player.playListsText', 'Play Queue')}
            active={panel === 'queue'}
            pressed={panel === 'queue'}
            onClick={() => toggle('queue')}
            className={styles.light}
          />
        </div>
      </header>

      <div className={styles.stage}>
        <section className={styles.player}>
          <div className={styles.artWrap}>
            <Cover
              key={item.uuid}
              record={coverRecordFor(item)}
              size={config.uiCoverArtSize}
              elevated
              className={styles.art}
            />
          </div>

          <div className={styles.meta}>
            <div className={styles.titles}>
              <h2 className={styles.title} title={title}>
                {title}
              </h2>
              {!isRadio && (
                <p className={styles.artist}>
                  {song?.artistId ? (
                    <Link to={`/artist/${song.artistId}/show`}>
                      {song.artist}
                    </Link>
                  ) : (
                    song?.artist || item.singer
                  )}
                </p>
              )}
            </div>
            {song && (
              <div className={styles.metaActions}>
                <LoveToggle
                  record={song}
                  resource="song"
                  size="md"
                  className={styles.light}
                />
                <MenuTrigger menu={menu} size="md" className={styles.light} />
                <SongMenuPopup menu={menu} record={song} />
              </div>
            )}
          </div>

          <Timeline variant="large" className={styles.timeline} />
          <TransportControls
            size="lg"
            playSize="xl"
            className={styles.transport}
          />
          <div className={styles.bottom}>
            <VolumeControl className={styles.volume} />
          </div>
        </section>

        {panel && (
          <section
            className={styles.panel}
            aria-label={
              panel === 'lyrics'
                ? t('player.toggleLyricText', 'Lyrics')
                : t('player.playListsText', 'Play Queue')
            }
          >
            {panel === 'lyrics' ? (
              <LyricsView trackId={item.trackId} isRadio={isRadio} />
            ) : (
              <QueueList variant="immersive" />
            )}
          </section>
        )}
      </div>
    </div>
  )
}

export default NowPlaying
