import React, { useState } from 'react'
import clsx from 'clsx'
import { Link } from 'react-router-dom'
import { useListContext } from 'react-admin'
import Menu from '@material-ui/core/Menu'
import MenuItem from '@material-ui/core/MenuItem'
import ListItemIcon from '@material-ui/core/ListItemIcon'
import { useT } from '../../i18n/useT'
import { Button } from '../../design/Button'
import { EmptyState } from '../../design/Section'
import { CheckIcon, SortIcon } from '../../design/icons'
import styles from './LibraryChrome.module.css'

/** Horizontal "chip" navigation between sibling lists (e.g. album lists). */
export const ChipTabs = ({ items, active, label }) => (
  <nav className={styles.chips} aria-label={label}>
    {items.map((item) => (
      <Link
        key={item.id}
        to={item.to}
        className={clsx(styles.chip, item.id === active && styles.chipActive)}
        aria-current={item.id === active ? 'page' : undefined}
      >
        {item.label}
      </Link>
    ))}
  </nav>
)

/**
 * Sort selector for react-admin lists. options: [{ field, label, order }]
 * Selecting the active field again flips the order.
 */
export const SortMenu = ({ options }) => {
  const t = useT()
  const { currentSort, setSort } = useListContext()
  const [anchor, setAnchor] = useState(null)
  const active = options.find((o) => o.field === currentSort?.field)
  return (
    <>
      <Button
        variant="chip"
        icon={SortIcon}
        aria-haspopup="menu"
        onClick={(e) => setAnchor(e.currentTarget)}
      >
        {active ? active.label : t('ui.library.sort', 'Sort')}
        {active && (currentSort.order === 'DESC' ? ' ↓' : ' ↑')}
      </Button>
      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => setAnchor(null)}
        getContentAnchorEl={null}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        MenuListProps={{ dense: true }}
      >
        {options.map((o) => {
          const selected = o.field === currentSort?.field
          return (
            <MenuItem
              key={o.field}
              selected={selected}
              onClick={() => {
                setAnchor(null)
                const order = selected
                  ? currentSort.order === 'ASC'
                    ? 'DESC'
                    : 'ASC'
                  : o.order || 'ASC'
                setSort(o.field, order)
              }}
            >
              <ListItemIcon>
                {selected ? <CheckIcon size={16} /> : <span />}
              </ListItemIcon>
              {o.label}
            </MenuItem>
          )
        })}
      </Menu>
    </>
  )
}

/** Empty state for a react-admin list (no results for the current filters). */
export const ListEmpty = ({ icon, title }) => {
  const t = useT()
  const { filterValues, setFilters } = useListContext()
  const filtered = Object.keys(filterValues || {}).some(
    (k) => !['seed', 'missing'].includes(k),
  )
  return (
    <EmptyState
      icon={icon}
      title={
        filtered
          ? t('ui.library.noResults', 'Nothing matches these filters')
          : title
      }
      action={
        filtered && (
          <Button onClick={() => setFilters({}, {})}>
            {t('ui.library.clearFilters', 'Clear filters')}
          </Button>
        )
      }
    />
  )
}
