import React, { useState } from 'react'
import { useActionMenu } from './useActionMenu'
import Menu from '@material-ui/core/Menu'
import MenuItem from '@material-ui/core/MenuItem'
import ListItemIcon from '@material-ui/core/ListItemIcon'
import Divider from '@material-ui/core/Divider'
import { ChevronRightIcon, MoreIcon } from './icons'
import { IconButton } from './IconButton'
import styles from './ActionMenu.module.css'

/**
 * items: [{ key, label, icon, onSelect, disabled, divider, submenu: [{key,label,onSelect}] }]
 */
export const ActionMenuList = ({ menu, items, label }) => {
  const [sub, setSub] = useState(null)
  const { state, close } = menu
  const closeAll = () => {
    setSub(null)
    close()
  }
  const visible = items.filter(Boolean)
  return (
    <>
      <Menu
        open={!!state}
        onClose={closeAll}
        anchorEl={state?.anchorEl}
        anchorReference={state?.position ? 'anchorPosition' : 'anchorEl'}
        anchorPosition={state?.position}
        getContentAnchorEl={null}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        onClick={(e) => e.stopPropagation()}
        MenuListProps={{ 'aria-label': label, dense: true }}
      >
        {visible.map((item) =>
          item.divider ? (
            <Divider key={item.key} className={styles.divider} />
          ) : (
            <MenuItem
              key={item.key}
              disabled={item.disabled}
              onClick={(e) => {
                e.stopPropagation()
                if (item.submenu) {
                  setSub({ anchorEl: e.currentTarget, items: item.submenu })
                  return
                }
                closeAll()
                item.onSelect && item.onSelect(e)
              }}
              aria-haspopup={item.submenu ? 'menu' : undefined}
            >
              {item.icon && (
                <ListItemIcon className={styles.icon}>
                  <item.icon size={17} />
                </ListItemIcon>
              )}
              <span className={styles.label}>{item.label}</span>
              {item.submenu && (
                <ChevronRightIcon size={16} className={styles.chevron} />
              )}
            </MenuItem>
          ),
        )}
      </Menu>
      <Menu
        open={!!sub}
        anchorEl={sub?.anchorEl}
        onClose={() => setSub(null)}
        getContentAnchorEl={null}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        onClick={(e) => e.stopPropagation()}
        MenuListProps={{ dense: true }}
      >
        {(sub?.items || []).map((item) => (
          <MenuItem
            key={item.key}
            onClick={(e) => {
              e.stopPropagation()
              closeAll()
              item.onSelect()
            }}
          >
            <span className={styles.label}>{item.label}</span>
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}

/** The "…" button plus its menu. */
export const ActionMenu = ({
  items,
  label = 'More',
  size = 'sm',
  className,
  menu: externalMenu,
  onOpen,
}) => {
  const internal = useActionMenu(onOpen)
  const menu = externalMenu || internal
  return (
    <>
      <IconButton
        size={size}
        icon={MoreIcon}
        label={label}
        className={className}
        aria-haspopup="menu"
        aria-expanded={!!menu.state}
        onClick={menu.open}
      />
      {menu.state && <ActionMenuList menu={menu} items={items} label={label} />}
    </>
  )
}

export default ActionMenu
