import React, { useState } from 'react'
import { useSelector } from 'react-redux'
import { useHistory } from 'react-router-dom'
import { getResources, useGetIdentity, usePermissions } from 'react-admin'
import Menu from '@material-ui/core/Menu'
import MenuItem from '@material-ui/core/MenuItem'
import ListItemIcon from '@material-ui/core/ListItemIcon'
import Divider from '@material-ui/core/Divider'
import Tooltip from '@material-ui/core/Tooltip'
import { useT } from '../i18n/useT'
import { AboutDialog, QuickConnectDialog } from '../dialogs'
import {
  AccountIcon,
  AdminIcon,
  InfoIcon,
  SettingsIcon,
  UserIcon,
} from '../design/icons'
import config from '../config'
import styles from './TopBar.module.css'

const settingsResources = (resource) =>
  resource.name !== 'user' &&
  resource.hasList &&
  resource.options?.subMenu === 'settings'

/**
 * Account menu: personal settings, profile/users, server administration
 * (same destinations as before), about and logout.
 */
export const UserMenu = ({ logout }) => {
  const t = useT()
  const history = useHistory()
  const [anchor, setAnchor] = useState(null)
  const [dialog, setDialog] = useState(null)
  const { loaded, identity } = useGetIdentity()
  const { permissions } = usePermissions()
  const resources = useSelector(getResources)
  const isAdmin = permissions === 'admin'

  const close = () => setAnchor(null)
  const go = (to) => () => {
    close()
    history.push(to)
  }

  const userResource = resources.find((r) => r?.name === 'user')
  const showUser = userResource && (isAdmin || config.enableUserEditing)
  const userLink = isAdmin ? '/user' : `/user/${localStorage.getItem('userId')}`
  const userLabel = isAdmin
    ? t('resources.user.name', 'Users', { smart_count: 2 })
    : t('resources.user.name', 'User', { smart_count: 1 })

  const label = t('menu.settings', 'Settings')
  return (
    <>
      <Tooltip title={loaded ? identity?.fullName || label : label}>
        <button
          type="button"
          className={styles.avatarButton}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={!!anchor}
          onClick={(e) => setAnchor(e.currentTarget)}
        >
          {loaded && identity?.avatar ? (
            <img src={identity.avatar} alt="" className={styles.avatar} />
          ) : (
            <AccountIcon size={22} aria-hidden />
          )}
        </button>
      </Tooltip>
      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={close}
        getContentAnchorEl={null}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{ style: { marginTop: 8, minWidth: 240 } }}
      >
        {loaded && identity?.fullName && (
          <div className={styles.menuIdentity}>
            <span className={styles.menuName}>{identity.fullName}</span>
            {isAdmin && (
              <span className={styles.menuRole}>
                {t('ui.account.admin', 'Administrator')}
              </span>
            )}
          </div>
        )}
        <MenuItem onClick={go('/personal')}>
          <ListItemIcon>
            <SettingsIcon size={18} />
          </ListItemIcon>
          {t('menu.personal.name', 'Personal')}
        </MenuItem>
        {config.enableQuickConnect && (
          <MenuItem
            onClick={() => {
              close()
              setDialog('quickConnect')
            }}
          >
            <ListItemIcon>
              <AccountIcon size={18} />
            </ListItemIcon>
            {t('menu.quickConnect.name', 'Quick Connect')}
          </MenuItem>
        )}
        {showUser && (
          <MenuItem onClick={go(userLink)}>
            <ListItemIcon>
              <UserIcon size={18} />
            </ListItemIcon>
            {userLabel}
          </MenuItem>
        )}
        {resources.filter(settingsResources).length > 0 && <Divider />}
        {resources.filter(settingsResources).map((r) => (
          <MenuItem key={r.name} onClick={go(`/${r.name}`)}>
            <ListItemIcon>
              <AdminIcon size={18} />
            </ListItemIcon>
            {r.options.label
              ? t(r.options.label, r.name)
              : t(`resources.${r.name}.name`, r.name, { smart_count: 2 })}
          </MenuItem>
        ))}
        <Divider />
        <MenuItem
          onClick={() => {
            close()
            setDialog('about')
          }}
        >
          <ListItemIcon>
            <InfoIcon size={18} />
          </ListItemIcon>
          {t('menu.about', 'About')}
        </MenuItem>
        {(!config.auth || !!config.extAuthLogoutURL) && logout}
      </Menu>
      <AboutDialog open={dialog === 'about'} onClose={() => setDialog(null)} />
      {config.enableQuickConnect && (
        <QuickConnectDialog
          open={dialog === 'quickConnect'}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  )
}

export default UserMenu
