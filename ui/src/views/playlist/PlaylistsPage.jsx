import React, { cloneElement } from 'react'
import { useHistory } from 'react-router-dom'
import { sanitizeListRestProps, TopToolbar, useListContext } from 'react-admin'
import { useT } from '../../i18n/useT'
import { List, useResourceRefresh } from '../../common'
import { PlaylistFilter } from '../../playlist/PlaylistList'
import LegacyPlaylistList from '../../playlist/PlaylistList'
import { PageHeader } from '../../design/Section'
import { Button } from '../../design/Button'
import { PlaylistIcon, PlusIcon } from '../../design/icons'
import { CardGrid, CardSkeletons, PlaylistCard } from '../shared/Cards'
import { ListEmpty, SortMenu } from '../library/LibraryChrome'
import { ViewToggle } from '../library/ViewToggle'
import { useViewMode } from '../library/useViewMode'
import { playlistMeta } from './playlistMeta'

const PlaylistGrid = () => {
  const t = useT()
  const { ids, data, loaded } = useListContext()
  if (loaded && ids.length === 0) {
    return (
      <ListEmpty
        icon={PlaylistIcon}
        title={t('resources.playlist.message.noPlaylists', 'No playlists yet')}
      />
    )
  }
  return (
    <CardGrid>
      {loaded ? (
        ids.map(
          (id) =>
            data[id] && (
              <PlaylistCard
                key={id}
                record={data[id]}
                meta={playlistMeta(t, data[id])}
              />
            ),
        )
      ) : (
        <CardSkeletons count={12} />
      )}
    </CardGrid>
  )
}

const PlaylistsActions = ({
  className,
  filters,
  resource,
  showFilter,
  displayedFilters,
  filterValues,
  ...rest
}) => {
  const t = useT()
  const field = (key, fallback) =>
    t(`resources.playlist.fields.${key}`, fallback)
  return (
    <TopToolbar className={className} {...sanitizeListRestProps(rest)}>
      <SortMenu
        options={[
          { field: 'name', label: field('name', 'Name') },
          {
            field: 'updatedAt',
            label: field('updatedAt', 'Updated'),
            order: 'DESC',
          },
          {
            field: 'songCount',
            label: field('songCount', 'Songs'),
            order: 'DESC',
          },
          {
            field: 'duration',
            label: field('duration', 'Duration'),
            order: 'DESC',
          },
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

const PlaylistsPage = (props) => {
  const t = useT()
  const history = useHistory()
  const [mode, setMode] = useViewMode('playlist')
  useResourceRefresh('playlist')
  const header = (
    <PageHeader
      title={t('resources.playlist.name', 'Playlists', { smart_count: 2 })}
      actions={
        <>
          <ViewToggle mode={mode} onChange={setMode} />
          <Button
            variant="primary"
            icon={PlusIcon}
            onClick={() => history.push('/playlist/create')}
          >
            {t('ui.playlist.new', 'New playlist')}
          </Button>
        </>
      }
    />
  )
  if (mode === 'table') {
    // Management table: ownership, public flag, bulk actions
    return (
      <div>
        {header}
        <LegacyPlaylistList {...props} title={<span />} />
      </div>
    )
  }
  return (
    <div>
      {header}
      <List
        {...props}
        title={<span />}
        exporter={false}
        bulkActionButtons={false}
        sort={{ field: 'name', order: 'ASC' }}
        filters={<PlaylistFilter />}
        actions={<PlaylistsActions />}
      >
        <PlaylistGrid />
      </List>
    </div>
  )
}

export default PlaylistsPage
