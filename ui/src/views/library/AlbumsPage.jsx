import React from 'react'
import { useSelector } from 'react-redux'
import { Redirect, useLocation } from 'react-router-dom'
import { useListContext, useRefresh, useVersion } from 'react-admin'
import withWidth from '@material-ui/core/withWidth'
import { useT } from '../../i18n/useT'
import { List, useAlbumsPerPage, useResourceRefresh } from '../../common'
import { Pagination } from '../../common/Pagination'
import { useSetToggleableFields } from '../../common/useSelectedFields'
import { AlbumFilter } from '../../album/AlbumList'
import AlbumListActions from '../../album/AlbumListActions'
import AlbumTableView from '../../album/AlbumTableView'
import albumLists from '../../album/albumLists'
import { PageHeader } from '../../design/Section'
import { AlbumIcon } from '../../design/icons'
import { AlbumCard, CardGrid, CardSkeletons } from '../shared/Cards'
import { ChipTabs, ListEmpty, SortMenu } from './LibraryChrome'

const DEFAULT_TYPE = 'all'
const randomStartingSeed = Math.random().toString()

const AlbumGrid = () => {
  const t = useT()
  const { ids, data, loaded } = useListContext()
  if (loaded && ids.length === 0) {
    return (
      <ListEmpty
        icon={AlbumIcon}
        title={t('ui.library.noAlbums', 'No albums yet')}
      />
    )
  }
  return (
    <CardGrid>
      {loaded ? (
        ids.map(
          (id) =>
            data[id] && (
              <AlbumCard key={id} record={data[id]} subtitle="artistYear" />
            ),
        )
      ) : (
        <CardSkeletons count={18} />
      )}
    </CardGrid>
  )
}

const AlbumsActions = (props) => {
  const t = useT()
  const field = (key, fallback) => t(`resources.album.fields.${key}`, fallback)
  return (
    <>
      <SortMenu
        options={[
          { field: 'name', label: field('name', 'Name') },
          { field: 'artist', label: field('artist', 'Artist') },
          { field: 'max_year', label: field('year', 'Year'), order: 'DESC' },
          {
            field: 'recently_added',
            label: t('resources.album.lists.recentlyAdded', 'Recently Added'),
            order: 'DESC',
          },
          {
            field: 'play_count',
            label: field('playCount', 'Plays'),
            order: 'DESC',
          },
          { field: 'rating', label: field('rating', 'Rating'), order: 'DESC' },
          {
            field: 'random',
            label: t('resources.album.lists.random', 'Random'),
          },
        ]}
      />
      <AlbumListActions {...props} />
    </>
  )
}

const AlbumsPage = (props) => {
  const { width } = props
  const t = useT()
  const location = useLocation()
  const albumView = useSelector((state) => state.albumView)
  const [perPage, perPageOptions] = useAlbumsPerPage(width)
  const version = useVersion()
  const refresh = useRefresh()
  useResourceRefresh('album')

  // Columns for the table layout (same set as before)
  useSetToggleableFields(
    'album',
    [
      'artist',
      'songCount',
      'playCount',
      'year',
      'mood',
      'duration',
      'rating',
      'size',
      'createdAt',
    ],
    ['createdAt', 'size'],
  )

  const seed = `${randomStartingSeed}-${version}`
  const type =
    location.pathname.replace(/^\/album/, '').replace(/^\//, '') || ''

  // Lists are addressed by type; bare URLs get that list's sort/filter params
  if (!location.search) {
    const listType = type || DEFAULT_TYPE
    const listParams = albumLists[listType]
    if (listType === 'random') refresh()
    if (listParams) {
      return <Redirect to={`/album/${listType}?${listParams.params}`} />
    }
  }

  const tabs = Object.keys(albumLists).map((id) => ({
    id,
    to: `/album/${id}`,
    label: t(`resources.album.lists.${id}`, id),
  }))

  return (
    <div>
      <PageHeader
        title={t('resources.album.name', 'Albums', { smart_count: 2 })}
      />
      <ChipTabs
        items={tabs}
        active={type || DEFAULT_TYPE}
        label={t('menu.albumList', 'Albums')}
      />
      <List
        {...props}
        title={<span />}
        exporter={false}
        bulkActionButtons={false}
        filter={{ seed }}
        actions={<AlbumsActions />}
        filters={<AlbumFilter />}
        perPage={perPage}
        pagination={<Pagination rowsPerPageOptions={perPageOptions} />}
      >
        {albumView.grid ? <AlbumGrid /> : <AlbumTableView {...props} />}
      </List>
    </div>
  )
}

const AlbumsPageWithWidth = withWidth()(AlbumsPage)

export default AlbumsPageWithWidth
