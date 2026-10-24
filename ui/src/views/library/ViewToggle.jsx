import React from 'react'
import { useT } from '../../i18n/useT'
import { IconButton } from '../../design/IconButton'
import { GridIcon, ListIcon, RowsIcon } from '../../design/icons'
import styles from './LibraryChrome.module.css'

/** Grid/table switch; `primary` names the first layout ('grid' or 'list'). */
export const ViewToggle = ({ mode, onChange, primary = 'grid' }) => {
  const t = useT()
  const first =
    primary === 'list'
      ? {
          id: 'list',
          icon: ListIcon,
          label: t('ui.library.listView', 'List'),
        }
      : {
          id: 'grid',
          icon: GridIcon,
          label: t('ra.toggleFieldsMenu.grid', 'Grid'),
        }
  return (
    <div
      className={styles.viewToggle}
      role="group"
      aria-label={t('ra.toggleFieldsMenu.layout', 'Layout')}
    >
      <IconButton
        size="sm"
        icon={first.icon}
        label={first.label}
        pressed={mode === first.id}
        active={mode === first.id}
        onClick={() => onChange(first.id)}
      />
      <IconButton
        size="sm"
        icon={RowsIcon}
        label={t('ra.toggleFieldsMenu.table', 'Table')}
        pressed={mode === 'table'}
        active={mode === 'table'}
        onClick={() => onChange('table')}
      />
    </div>
  )
}
