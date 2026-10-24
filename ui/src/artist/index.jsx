import React from 'react'
import ArtistsPage from '../views/library/ArtistsPage'
import ArtistPage from '../views/artist/ArtistPage'
import DynamicMenuIcon from '../layout/DynamicMenuIcon'
import MicNoneOutlinedIcon from '@material-ui/icons/MicNoneOutlined'
import MicIcon from '@material-ui/icons/Mic'

export default {
  list: ArtistsPage,
  show: ArtistPage,
  icon: (
    <DynamicMenuIcon
      path={'artist'}
      icon={MicNoneOutlinedIcon}
      activeIcon={MicIcon}
    />
  ),
}
