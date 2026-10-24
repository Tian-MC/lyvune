import {
  AutocompleteArrayInput,
  AutocompleteInput,
  Filter,
  NullableBooleanInput,
  NumberInput,
  ReferenceArrayInput,
  ReferenceInput,
  SearchInput,
  usePermissions,
  useTranslate,
} from 'react-admin'
import FavoriteIcon from '@material-ui/icons/Favorite'
import { humanize } from 'inflection'
import { makeStyles } from '@material-ui/core/styles'
import config from '../config'

const useStyles = makeStyles({
  chip: {
    margin: 0,
    height: '24px',
  },
})

const formatReleaseType = (record) =>
  record?.tagValue ? humanize(record?.tagValue) : '-- None --'

const AlbumFilter = (props) => {
  const classes = useStyles()
  const translate = useTranslate()
  const { permissions } = usePermissions()
  const isAdmin = permissions === 'admin'
  return (
    <Filter {...props} variant={'outlined'}>
      <SearchInput id="search" source="name" alwaysOn />
      <ReferenceInput
        label={translate('resources.album.fields.artist')}
        source="artist_id"
        reference="artist"
        sort={{ field: 'name', order: 'ASC' }}
        filterToQuery={(searchText) => ({ name: [searchText] })}
      >
        <AutocompleteInput emptyText="-- None --" />
      </ReferenceInput>
      <ReferenceArrayInput
        label={translate('resources.album.fields.genre')}
        source="genre_id"
        reference="genre"
        perPage={0}
        sort={{ field: 'name', order: 'ASC' }}
        filterToQuery={(searchText) => ({ name: [searchText] })}
      >
        <AutocompleteArrayInput emptyText="-- None --" classes={classes} />
      </ReferenceArrayInput>
      <ReferenceInput
        label={translate('resources.album.fields.recordLabel')}
        source="recordlabel"
        reference="tag"
        perPage={0}
        sort={{ field: 'tagValue', order: 'ASC' }}
        filter={{ tag_name: 'recordlabel' }}
        filterToQuery={(searchText) => ({
          tag_value: [searchText],
        })}
      >
        <AutocompleteInput emptyText="-- None --" optionText="tagValue" />
      </ReferenceInput>
      <ReferenceArrayInput
        label={translate('resources.album.fields.grouping')}
        source="grouping"
        reference="tag"
        perPage={0}
        sort={{ field: 'tagValue', order: 'ASC' }}
        filter={{ tag_name: 'grouping' }}
        filterToQuery={(searchText) => ({
          tag_value: [searchText],
        })}
      >
        <AutocompleteArrayInput
          emptyText="-- None --"
          classes={classes}
          optionText="tagValue"
        />
      </ReferenceArrayInput>
      <ReferenceArrayInput
        label={translate('resources.album.fields.mood')}
        source="mood"
        reference="tag"
        perPage={0}
        sort={{ field: 'tagValue', order: 'ASC' }}
        filter={{ tag_name: 'mood' }}
        filterToQuery={(searchText) => ({
          tag_value: [searchText],
        })}
      >
        <AutocompleteArrayInput
          emptyText="-- None --"
          classes={classes}
          optionText="tagValue"
        />
      </ReferenceArrayInput>
      <ReferenceInput
        label={translate('resources.album.fields.media')}
        source="media"
        reference="tag"
        perPage={0}
        sort={{ field: 'tagValue', order: 'ASC' }}
        filter={{ tag_name: 'media' }}
        filterToQuery={(searchText) => ({
          tag_value: [searchText],
        })}
      >
        <AutocompleteInput emptyText="-- None --" optionText="tagValue" />
      </ReferenceInput>
      <ReferenceInput
        label={translate('resources.album.fields.releaseType')}
        source="releasetype"
        reference="tag"
        perPage={0}
        sort={{ field: 'tagValue', order: 'ASC' }}
        filter={{ tag_name: 'releasetype' }}
        filterToQuery={(searchText) => ({
          tag_value: [searchText],
        })}
      >
        <AutocompleteInput
          emptyText="-- None --"
          optionText={formatReleaseType}
        />
      </ReferenceInput>
      <NullableBooleanInput source="compilation" />
      <NullableBooleanInput source="played" defaultValue={false} />
      <NumberInput source="year" />
      {config.enableFavourites && (
        <NullableBooleanInput
          source="starred"
          label={<FavoriteIcon fontSize={'small'} />}
        />
      )}
      {isAdmin && <NullableBooleanInput source="missing" />}
    </Filter>
  )
}

export default AlbumFilter
