import React, { useEffect } from 'react'
import { useT } from '../../i18n/useT'
import { ActionMenuList } from '../../design/ActionMenu'
import { useActionMenu } from '../../design/useActionMenu'
import { IconButton } from '../../design/IconButton'
import { MoreIcon } from '../../design/icons'
import {
  useCollectionMenuItems,
  useSongMenuItems,
} from '../../playback/actions'

// Menu contents are computed only while open, so long grids and lists stay cheap.
const CollectionItems = ({ menu, resource, record, query, extraItems }) => {
  const t = useT()
  const base = useCollectionMenuItems(resource, record, query)
  const items = extraItems?.filter(Boolean).length
    ? [...base, { key: 'dx', divider: true }, ...extraItems]
    : base
  return (
    <ActionMenuList
      menu={menu}
      items={items}
      label={t('ui.actions.more', 'More')}
    />
  )
}

const SongItems = ({ menu, record, onAddToPlaylist, extraItems }) => {
  const t = useT()
  const { items, onOpen } = useSongMenuItems(record, { onAddToPlaylist })
  // Fetch the playlists containing this song for "Show in playlist"
  useEffect(() => onOpen(), [onOpen])
  return (
    <ActionMenuList
      menu={menu}
      items={
        extraItems
          ? [...extraItems, { key: 'dx', divider: true }, ...items]
          : items
      }
      label={t('ui.actions.more', 'More')}
    />
  )
}

export const MenuTrigger = ({ menu, size = 'sm', className, label }) => {
  const t = useT()
  return (
    <IconButton
      size={size}
      icon={MoreIcon}
      label={label || t('ui.actions.more', 'More')}
      className={className}
      aria-haspopup="menu"
      aria-expanded={!!menu.state}
      onClick={menu.open}
    />
  )
}

/** "…" menu for albums/artists/playlists. Pass `menu` to share it with right-click. */
export const CollectionMenu = ({
  resource,
  record,
  query,
  menu: external,
  size,
  className,
  extraItems,
}) => {
  const internal = useActionMenu()
  const menu = external || internal
  return (
    <>
      <MenuTrigger menu={menu} size={size} className={className} />
      {menu.state && (
        <CollectionItems
          menu={menu}
          resource={resource}
          record={record}
          query={query}
          extraItems={extraItems}
        />
      )}
    </>
  )
}

export const SongMenuPopup = ({ menu, record, onAddToPlaylist, extraItems }) =>
  menu.state ? (
    <SongItems
      menu={menu}
      record={record}
      onAddToPlaylist={onAddToPlaylist}
      extraItems={extraItems}
    />
  ) : null
