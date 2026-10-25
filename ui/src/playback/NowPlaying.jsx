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
import { useDialogFocus } from './useDialogFocus'
import { coverRecordFor } from './coverRecord'
import { trackTitle } from './trackTitle'
import { TrackQuality } from './TrackQuality'
import styles from './NowPlaying.module.css'

const noop = () => {}

const NowPlaying = ({ closing = false }) => {
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
  // Songs queued from a playlist remember it: link back there, as before
  const { data: playlist } = useGetOne('playlist', song?.playlistId, {
    enabled: !!song?.playlistId && !isRadio,
  })
  const origin =
    song?.playlistId && playlist
      ? { to: `/playlist/${playlist.id}/show`, name: playlist.name }
      : song?.album
        ? { to: `/album/${song.albumId}/show`, name: song.album }
        : null

  // Escape while the exit animation plays must not close (and pop history) twice
  useDialogFocus(ref, closing ? noop : closeNowPlaying)

  // The queue was cleared while open
  useEffect(() => {
    if (!item) closeNowPlaying()
  }, [item, closeNowPlaying])

  if (!item) return null

  const title = trackTitle(song, item.name)
  const toggle = (p) => setNowPlayingPanel(panel === p ? null : p)

  return (
    <div
      ref={ref}
      className={clsx(
        styles.root,
        panel && styles.withPanel,
        closing && styles.leaving,
      )}
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
          {origin && !isRadio && (
            <>
              <span className={styles.contextLabel}>
                {t('ui.player.playingFrom', 'Playing from')}
              </span>
              <Link to={origin.to} className={styles.contextLink}>
                {origin.name}
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
              <TrackQuality
                item={item}
                song={song}
                className={styles.quality}
              />
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
              <LyricsView
                trackId={item.trackId}
                title={title}
                isRadio={isRadio}
              />
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
