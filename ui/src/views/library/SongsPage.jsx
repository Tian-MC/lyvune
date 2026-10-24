import React, { cloneElement, useCallback } from 'react'
import { useDispatch } from 'react-redux'
import { sanitizeListRestProps, TopToolbar, useListContext } from 'react-admin'
import { useT } from '../../i18n/useT'
import { List, ShuffleAllButton, useResourceRefresh } from '../../common'
import { SongFilter } from '../../song/SongList'
import LegacySongList from '../../song/SongList'
import { playTracks } from '../../actions'
import { PageHeader, Skeleton } from '../../design/Section'
import { SongIcon } from '../../design/icons'
import { TrackList } from '../shared/TrackList'
import { TrackColumnsMenu } from '../shared/TrackColumnsMenu'
import { useTrackColumns } from '../shared/useTrackColumns'
import { SelectionBar } from '../shared/SelectionBar'
import { useTrackSelection } from '../shared/useTrackSelection'
import { ListEmpty, SortMenu } from './LibraryChrome'
import { ViewToggle } from './ViewToggle'
import { useViewMode } from './useViewMode'
import styles from './SongsPage.module.css'

const DEFAULT_COLUMNS = ['year', 'playCount', 'quality', 'rating']

const SongRows = () => {
  const t = useT()
  const dispatch = useDispatch()
  const { ids, data, loaded } = useListContext()
  const selection = useTrackSelection(ids)
  const trackColumns = useTrackColumns('songs', DEFAULT_COLUMNS)
  const onPlay = useCallback(
    (record) => dispatch(playTracks(data, ids, record.id)),
    [dispatch, data, ids],
  )
  if (!loaded) {
    return Array.from({ length: 10 }).map((_, i) => (
      <Skeleton key={i} className={styles.rowSkeleton} />
    ))
  }
  if (ids.length === 0) {
    return (
      <ListEmpty
        icon={SongIcon}
        title={t('ui.library.noSongs', 'No songs yet')}
      />
    )
  }
  return (
    <div className={styles.rows}>
      <TrackList
        ids={ids}
        data={data}
        columns={['cover', 'artist', 'album', 'love', 'duration', 'menu']}
        onPlay={onPlay}
        selection={selection}
        optional={trackColumns.active}
        columnsMenu={<TrackColumnsMenu columns={trackColumns} />}
        label={t('resources.song.name', 'Songs', { smart_count: 2 })}
      />
      <SelectionBar selection={selection} data={data} />
    </div>
  )
}

const SongsActions = ({
  className,
  filters,
  resource,
  showFilter,
  displayedFilters,
  filterValues,
  ...rest
}) => {
  const t = useT()
  const field = (key, fallback) => t(`resources.song.fields.${key}`, fallback)
  return (
    <TopToolbar className={className} {...sanitizeListRestProps(rest)}>
      <SortMenu
        options={[
          { field: 'title', label: field('title', 'Title') },
          { field: 'artist', label: field('artist', 'Artist') },
          { field: 'album', label: field('album', 'Album') },
          { field: 'year', label: field('year', 'Year'), order: 'DESC' },
          {
            field: 'playCount',
            label: field('playCount', 'Plays'),
            order: 'DESC',
          },
          {
            field: 'recently_added',
            label: field('createdAt', 'Added'),
            order: 'DESC',
          },
          { field: 'duration', label: field('duration', 'Time') },
          { field: 'rating', label: field('rating', 'Rating'), order: 'DESC' },
        ]}
      />
      <ShuffleAllButton filters={filterValues} />
      {filters &&
        cloneElement(filters, {
          resource,
          showFilter,
          displayedFilters,
          filterValues,
          context: 'button',
        })}
    </TopToolbar>
  )
}

const SongsPage = (props) => {
  const t = useT()
  const [mode, setMode] = useViewMode('song', 'list')
  useResourceRefresh('song')
  const header = (
    <PageHeader
      title={t('resources.song.name', 'Songs', { smart_count: 2 })}
      actions={<ViewToggle mode={mode} onChange={setMode} primary="list" />}
    />
  )
  if (mode === 'table') {
    // Configurable columns (the previous song table)
    return (
      <div>
        {header}
        <LegacySongList {...props} title={<span />} />
      </div>
    )
  }
  return (
    <div>
      {header}
      <List
        {...props}
        title={<span />}
        sort={{ field: 'title', order: 'ASC' }}
        exporter={false}
        bulkActionButtons={false}
        actions={<SongsActions />}
        filters={<SongFilter />}
      >
        <SongRows />
      </List>
    </div>
  )
}

export default SongsPage
