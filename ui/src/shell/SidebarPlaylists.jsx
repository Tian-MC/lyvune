import React from 'react'
import clsx from 'clsx'
import { Link, NavLink, useHistory } from 'react-router-dom'
import { useDispatch } from 'react-redux'
import { useDataProvider, useNotify } from 'react-admin'
import { useDrop } from 'react-dnd'
import { useT } from '../i18n/useT'
import { useSidebarPlaylists } from './useSidebarPlaylists'
import { IconButton } from '../design/IconButton'
import { HeartIcon, PlusIcon } from '../design/icons'
import { canChangeTracks } from '../common'
import { DraggableTypes } from '../consts'
import { setSidebarPlaylistsOnlyFavourites } from '../actions'
import config from '../config'
import styles from './Sidebar.module.css'

const PlaylistLink = ({ pls }) => {
  const dataProvider = useDataProvider()
  const notify = useNotify()
  // Songs can be dragged from tracklists onto a playlist
  const [{ isOver }, dropRef] = useDrop(() => ({
    accept: canChangeTracks(pls) ? DraggableTypes.ALL : [],
    collect: (monitor) => ({ isOver: monitor.isOver() && monitor.canDrop() }),
    drop: (item) =>
      dataProvider
        .addToPlaylist(pls.id, item)
        .then((res) =>
          notify('message.songsAddedToPlaylist', 'info', {
            smart_count: res.data?.added,
          }),
        )
        .catch(() => notify('ra.page.error', 'warning')),
  }))
  return (
    <NavLink
      ref={dropRef}
      to={`/playlist/${pls.id}/show`}
      className={clsx(styles.playlist, isOver && styles.dropTarget)}
      activeClassName={styles.playlistActive}
      title={pls.name}
    >
      <span className={styles.playlistName}>{pls.name}</span>
    </NavLink>
  )
}

const SidebarPlaylists = () => {
  const t = useT()
  const dispatch = useDispatch()
  const history = useHistory()
  const { mine, shared, onlyFavourites } = useSidebarPlaylists()
  return (
    <div className={styles.playlists}>
      <div className={styles.groupHeader}>
        <Link to="/playlist" className={styles.groupTitle}>
          {t('menu.playlists', 'Playlists')}
        </Link>
        <div className={styles.groupActions}>
          {config.enableFavourites && (
            <IconButton
              size="xs"
              icon={HeartIcon}
              label={t('menu.onlyFavourites', 'Only show favourites')}
              pressed={onlyFavourites}
              active={onlyFavourites}
              onClick={() =>
                dispatch(setSidebarPlaylistsOnlyFavourites(!onlyFavourites))
              }
            />
          )}
          <IconButton
            size="xs"
            icon={PlusIcon}
            label={t('ra.action.create', 'Create')}
            onClick={() => history.push('/playlist/create')}
          />
        </div>
      </div>
      <nav aria-label={t('menu.playlists', 'Playlists')}>
        {mine.map((pls) => (
          <PlaylistLink key={pls.id} pls={pls} />
        ))}
        {shared.length > 0 && (
          <>
            <p className={styles.subGroup}>
              {t('menu.sharedPlaylists', 'Shared Playlists')}
            </p>
            {shared.map((pls) => (
              <PlaylistLink key={pls.id} pls={pls} />
            ))}
          </>
        )}
        {mine.length === 0 && shared.length === 0 && (
          <p className={styles.emptyPlaylists}>
            {t('resources.playlist.message.noPlaylists', 'No playlists')}
          </p>
        )}
      </nav>
    </div>
  )
}

export default SidebarPlaylists
