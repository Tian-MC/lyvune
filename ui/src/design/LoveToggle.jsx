import React from 'react'
import { useToggleLove } from '../common/useToggleLove'
import { useT } from '../i18n/useT'
import config from '../config'
import { HeartIcon } from './icons'
import { IconButton } from './IconButton'
import styles from './LoveToggle.module.css'

/** Favourite toggle (star/unstar) for songs, albums, artists, playlists. */
export const LoveToggle = ({
  record,
  resource,
  size = 'sm',
  className,
  disabled,
}) => {
  const t = useT()
  const [toggleLove, loading] = useToggleLove(resource, record)
  if (!config.enableFavourites) return null
  const loved = !!record?.starred
  return (
    <IconButton
      size={size}
      className={`${styles.root} ${loved ? styles.loved : ''} ${className || ''}`}
      icon={HeartIcon}
      label={
        loved
          ? t('ui.actions.removeFavourite', 'Remove from favourites')
          : t('ui.actions.addFavourite', 'Add to favourites')
      }
      pressed={loved}
      disabled={disabled || loading || !record}
      onClick={(e) => {
        e.stopPropagation()
        toggleLove()
      }}
    />
  )
}

export default LoveToggle
