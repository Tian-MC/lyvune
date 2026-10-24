import React, { memo } from 'react'
import { Link } from 'react-router-dom'
import { useDrag } from 'react-dnd'
import { useT } from '../i18n/useT'
import { useShell } from '../shell/useShell'
import { IconButton } from '../design/IconButton'
import { LoveToggle } from '../design/LoveToggle'
import { Artwork } from '../common/Artwork'
import { ExpandIcon, LyricsIcon, NextIcon, QueueIcon } from '../design/icons'
import engine from './engine'
import { useCurrentItem, useCurrentSong } from './hooks'
import { coverRecordFor } from './coverRecord'
import { trackTitle } from './trackTitle'
import { TrackQuality } from './TrackQuality'
import { DraggableTypes } from '../consts'
import {
  PlayPauseButton,
  ProgressLine,
  Timeline,
  TransportControls,
  VolumeControl,
} from './controls'
import styles from './PlayerBar.module.css'

const TrackInfo = ({ item, song, compact }) => {
  const title = trackTitle(song, item.name)
  const artist = item.isRadio ? null : song?.artist || item.singer
  // The playing song can be dragged onto a playlist in the sidebar
  const [, dragRef] = useDrag(
    () => ({
      type: DraggableTypes.SONG,
      item: { ids: [item.trackId] },
      canDrag: !item.isRadio,
      options: { dropEffect: 'copy' },
    }),
    [item.trackId, item.isRadio],
  )
  return (
    <div className={styles.info} ref={dragRef}>
      <span className={styles.titleRow}>
        <span className={styles.title} title={title}>
          {title}
        </span>
        {!compact && (
          <TrackQuality item={item} song={song} className={styles.quality} />
        )}
      </span>
      {artist && (
        <span className={styles.artist}>
          {!compact && song?.artistId ? (
            <Link
              to={`/artist/${song.artistId}/show`}
              onClick={(e) => e.stopPropagation()}
              className={styles.link}
            >
              {artist}
            </Link>
          ) : (
            artist
          )}
          {!compact && song?.album && (
            <>
              <span className={styles.dot} aria-hidden>
                ·
              </span>
              <Link
                to={`/album/${song.albumId}/show`}
                onClick={(e) => e.stopPropagation()}
                className={styles.link}
              >
                {song.album}
              </Link>
            </>
          )}
        </span>
      )}
    </div>
  )
}

/**
 * The persistent player. Clicking anywhere that is not a control opens Now
 * Playing; buttons and sliders keep their own behaviour.
 */
export const PlayerBar = memo(() => {
  const t = useT()
  const item = useCurrentItem()
  const song = useCurrentSong(item)
  const { openNowPlaying, toggleQueue, queueOpen } = useShell()

  if (!item) return null

  const open = () => openNowPlaying()
  const onKeyOpen = (e) => {
    if (e.key === 'Enter' && e.target === e.currentTarget) open()
  }
  const nowPlayingLabel = t('ui.player.openNowPlaying', 'Open Now Playing')

  return (
    <section
      className={styles.root}
      aria-label={t('ui.player.label', 'Player')}
    >
      {/* Desktop / tablet */}
      <div className={styles.desktop}>
        <div className={styles.left}>
          <button
            type="button"
            className={styles.coverButton}
            aria-label={nowPlayingLabel}
            onClick={(e) => {
              e.stopPropagation()
              open()
            }}
          >
            <Artwork
              record={coverRecordFor(item)}
              size={128}
              className={styles.cover}
            />
            <span className={styles.coverHint} aria-hidden>
              <ExpandIcon size={16} />
            </span>
          </button>
          <TrackInfo item={item} song={song} />
          {song && (
            <LoveToggle record={song} resource="song" className={styles.love} />
          )}
        </div>

        <div className={styles.center}>
          <TransportControls size="sm" playSize="md" />
          <Timeline />
        </div>

        <div className={styles.right}>
          <IconButton
            size="sm"
            icon={LyricsIcon}
            label={t('player.toggleLyricText', 'Lyrics')}
            disabled={item.isRadio}
            onClick={(e) => {
              e.stopPropagation()
              openNowPlaying('lyrics')
            }}
          />
          <IconButton
            size="sm"
            icon={QueueIcon}
            label={t('player.playListsText', 'Play Queue')}
            active={queueOpen}
            pressed={queueOpen}
            onClick={(e) => {
              e.stopPropagation()
              toggleQueue()
            }}
          />
          <VolumeControl />
          <IconButton
            size="sm"
            icon={ExpandIcon}
            label={nowPlayingLabel}
            onClick={(e) => {
              e.stopPropagation()
              open()
            }}
          />
        </div>
      </div>

      {/* Phone mini player */}
      <div
        className={styles.mobile}
        role="button"
        tabIndex={0}
        aria-label={nowPlayingLabel}
        onClick={open}
        onKeyDown={onKeyOpen}
      >
        <Artwork
          record={coverRecordFor(item)}
          size={96}
          className={styles.mobileCover}
        />
        <TrackInfo item={item} song={song} compact />
        <div className={styles.mobileControls}>
          {song && <LoveToggle record={song} resource="song" />}
          <PlayPauseButton size="md" variant="ghost" />
          <IconButton
            size="md"
            icon={NextIcon}
            label={t('player.nextTrackText', 'Next track')}
            onClick={(e) => {
              e.stopPropagation()
              engine.next()
            }}
          />
        </div>
        <ProgressLine />
      </div>
    </section>
  )
})

PlayerBar.displayName = 'PlayerBar'

export default PlayerBar
