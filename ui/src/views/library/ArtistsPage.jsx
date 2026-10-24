import React, { cloneElement } from 'react'
import { sanitizeListRestProps, TopToolbar, useListContext } from 'react-admin'
import { useT } from '../../i18n/useT'
import { List, useResourceRefresh } from '../../common'
import { ArtistFilter } from '../../artist/ArtistList'
import { PageHeader } from '../../design/Section'
import { ArtistIcon } from '../../design/icons'
import { ArtistCard, CardGrid, CardSkeletons } from '../shared/Cards'
import { ListEmpty, SortMenu } from './LibraryChrome'
import { ViewToggle } from './ViewToggle'
import { useViewMode } from './useViewMode'
import LegacyArtistList from '../../artist/ArtistList'

const ArtistGrid = () => {
  const t = useT()
  const { ids, data, loaded, filterValues } = useListContext()
  const role = filterValues?.role
  if (loaded && ids.length === 0) {
    return (
      <ListEmpty
        icon={ArtistIcon}
        title={t('ui.library.noArtists', 'No artists yet')}
      />
    )
  }
  const meta = (record) => {
    const count = role ? record.stats?.[role]?.albumCount : record.albumCount
    return count
      ? t('ui.count.albums', '%{smart_count} albums', { smart_count: count })
      : null
  }
  return (
    <CardGrid dense>
      {loaded ? (
        ids.map(
          (id) =>
            data[id] && (
              <ArtistCard key={id} record={data[id]} meta={meta(data[id])} />
            ),
        )
      ) : (
        <CardSkeletons count={18} round />
      )}
    </CardGrid>
  )
}

const ArtistsActions = ({
  className,
  filters,
  resource,
  showFilter,
  displayedFilters,
  filterValues,
  ...rest
}) => {
  const t = useT()
  const field = (key, fallback) => t(`resources.artist.fields.${key}`, fallback)
  return (
    <TopToolbar className={className} {...sanitizeListRestProps(rest)}>
      <SortMenu
        options={[
          { field: 'name', label: field('name', 'Name') },
          {
            field: 'albumCount',
            label: field('albumCount', 'Albums'),
            order: 'DESC',
          },
          {
            field: 'songCount',
            label: field('songCount', 'Songs'),
            order: 'DESC',
          },
          {
            field: 'playCount',
            label: field('playCount', 'Plays'),
            order: 'DESC',
          },
          { field: 'rating', label: field('rating', 'Rating'), order: 'DESC' },
        ]}
      />
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

const ArtistsPage = (props) => {
  const t = useT()
  const [mode, setMode] = useViewMode('artist')
  useResourceRefresh('artist')
  const header = (
    <PageHeader
      title={t('resources.artist.name', 'Artists', { smart_count: 2 })}
      actions={<ViewToggle mode={mode} onChange={setMode} />}
    />
  )
  if (mode === 'table') {
    // Detailed table with column toggles (the previous artist list)
    return (
      <div>
        {header}
        <LegacyArtistList {...props} title={<span />} />
      </div>
    )
  }
  return (
    <div>
      {header}
      <List
        {...props}
        title={<span />}
        sort={{ field: 'name', order: 'ASC' }}
        exporter={false}
        bulkActionButtons={false}
        filters={<ArtistFilter />}
        filterDefaultValues={{ role: 'albumartist' }}
        actions={<ArtistsActions />}
      >
        <ArtistGrid />
      </List>
    </div>
  )
}

export default ArtistsPage
