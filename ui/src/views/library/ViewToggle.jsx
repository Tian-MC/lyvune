import React from 'react'
import { useT } from '../../i18n/useT'
import { IconButton } from '../../design/IconButton'
import { GridIcon, RowsIcon } from '../../design/icons'
import styles from './LibraryChrome.module.css'

export const ViewToggle = ({ mode, onChange }) => {
  const t = useT()
  return (
    <div
      className={styles.viewToggle}
      role="group"
      aria-label={t('ra.toggleFieldsMenu.layout', 'Layout')}
    >
      <IconButton
        size="sm"
        icon={GridIcon}
        label={t('ra.toggleFieldsMenu.grid', 'Grid')}
        pressed={mode === 'grid'}
        active={mode === 'grid'}
        onClick={() => onChange('grid')}
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
