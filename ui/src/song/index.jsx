import React from 'react'
import SongsPage from '../views/library/SongsPage'
import MusicNoteOutlinedIcon from '@material-ui/icons/MusicNoteOutlined'
import MusicNoteIcon from '@material-ui/icons/MusicNote'
import DynamicMenuIcon from '../layout/DynamicMenuIcon'

export default {
  list: SongsPage,
  icon: (
    <DynamicMenuIcon
      path={'song'}
      icon={MusicNoteOutlinedIcon}
      activeIcon={MusicNoteIcon}
    />
  ),
}
