import React, { useState } from 'react'
import Menu from '@material-ui/core/Menu'
import MenuItem from '@material-ui/core/MenuItem'
import Checkbox from '@material-ui/core/Checkbox'
import { useT } from '../../i18n/useT'
import { IconButton } from '../../design/IconButton'
import { ColumnsIcon } from '../../design/icons'
import { COLUMN_FIELD_LABELS, optionalColumnKeys } from './trackColumns'

/** Choose which optional columns a tracklist shows (see useTrackColumns). */
export const TrackColumnsMenu = ({ columns }) => {
  const t = useT()
  const [anchor, setAnchor] = useState(null)
  const label = t('ra.toggleFieldsMenu.columnsToDisplay', 'Columns to display')
  return (
    <>
      <IconButton
        size="xs"
        icon={ColumnsIcon}
        label={label}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        onClick={(e) => setAnchor(e.currentTarget)}
      />
      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => setAnchor(null)}
        getContentAnchorEl={null}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        MenuListProps={{ dense: true, 'aria-label': label }}
      >
        {optionalColumnKeys().map((key) => (
          <MenuItem
            key={key}
            role="menuitemcheckbox"
            aria-checked={!!columns.enabled[key]}
            onClick={() => columns.toggle(key)}
          >
            <Checkbox
              checked={!!columns.enabled[key]}
              size="small"
              tabIndex={-1}
              disableRipple
              inputProps={{ 'aria-hidden': true }}
            />
            {t(...COLUMN_FIELD_LABELS[key])}
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}

export default TrackColumnsMenu
