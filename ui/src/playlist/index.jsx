import React from 'react'
import QueueMusicOutlinedIcon from '@material-ui/icons/QueueMusicOutlined'
import QueueMusicIcon from '@material-ui/icons/QueueMusic'
import DynamicMenuIcon from '../layout/DynamicMenuIcon'
import PlaylistsPage from '../views/playlist/PlaylistsPage'
import PlaylistEdit from './PlaylistEdit'
import PlaylistCreate from './PlaylistCreate'
import PlaylistPage from '../views/playlist/PlaylistPage'

export default {
  list: PlaylistsPage,
  create: PlaylistCreate,
  edit: PlaylistEdit,
  show: PlaylistPage,
  icon: (
    <DynamicMenuIcon
      path={'playlist'}
      icon={QueueMusicOutlinedIcon}
      activeIcon={QueueMusicIcon}
    />
  ),
}
