import React from 'react'
import { Link } from 'react-router-dom'
import { QualityInfo } from '../../common/QualityInfo'
import { RatingField } from '../../common/RatingField'
import { formatBytes } from '../../utils/formatters'
import config from '../../config'

const names = (record, role) => record.participants?.[role] || []

const dateTime = (value, locale) =>
  value && new Date(value).getFullYear() > 1
    ? new Date(value).toLocaleString(locale)
    : ''

/**
 * Optional tracklist columns (the set the previous song tables offered).
 * `width` is the grid track; `render(record, ctx)` the cell content.
 */
export const OPTIONAL_COLUMNS = {
  rating: {
    width: '112px',
    available: () => config.enableStarRating,
    render: (r) => (
      <RatingField
        record={{ ...r, id: r.mediaFileId || r.id }}
        resource="song"
        size="small"
      />
    ),
  },
  quality: {
    width: '104px',
    render: (r) => <QualityInfo record={r} />,
  },
  year: { width: '56px', render: (r) => r.year || '' },
  playCount: {
    width: '64px',
    render: (r) => (r.playCount > 0 ? r.playCount : ''),
  },
  playDate: {
    width: '168px',
    render: (r, { locale }) => dateTime(r.playDate, locale),
  },
  albumArtist: { width: '144px', render: (r) => r.albumArtist || '' },
  composer: {
    width: '144px',
    render: (r) =>
      names(r, 'composer').map((p, i) => (
        <React.Fragment key={p.id}>
          {i > 0 && ', '}
          <Link to={`/artist/${p.id}/show`}>{p.name}</Link>
        </React.Fragment>
      )),
  },
  genre: { width: '112px', render: (r) => r.genre || '' },
  mood: { width: '104px', render: (r) => r.tags?.mood?.[0] || '' },
  bpm: { width: '56px', render: (r) => r.bpm || '' },
  channels: { width: '72px', render: (r) => r.channels || '' },
  size: {
    width: '80px',
    render: (r) => (r.size ? formatBytes(r.size, 1) : ''),
  },
}

/** Translation key and English fallback of each optional column. */
export const COLUMN_FIELD_LABELS = {
  rating: ['resources.song.fields.rating', 'Rating'],
  quality: ['resources.song.fields.quality', 'Quality'],
  year: ['resources.song.fields.year', 'Year'],
  playCount: ['resources.song.fields.playCount', 'Plays'],
  playDate: ['resources.song.fields.playDate', 'Last played'],
  albumArtist: ['resources.song.fields.albumArtist', 'Album Artist'],
  composer: ['resources.song.fields.composer', 'Composer'],
  genre: ['resources.song.fields.genre', 'Genre'],
  mood: ['resources.song.fields.mood', 'Mood'],
  bpm: ['resources.song.fields.bpm', 'BPM'],
  channels: ['resources.song.fields.channels', 'Channels'],
  size: ['resources.song.fields.size', 'Size'],
}

export const optionalColumnKeys = () =>
  Object.keys(OPTIONAL_COLUMNS).filter(
    (k) => !OPTIONAL_COLUMNS[k].available || OPTIONAL_COLUMNS[k].available(),
  )

// Grid tracks of a row: [checkbox] lead | title | [album] | optional… | trail
export const gridTemplate = (columns, optional, selectable) => {
  const has = (c) => columns.includes(c)
  const trail =
    (has('love') ? 30 : 0) +
    (has('duration') ? 48 : 0) +
    (has('menu') ? 30 : 0) +
    4 * 2
  return [
    selectable ? '22px 40px' : '40px',
    'minmax(0, 1fr)',
    has('album') && 'minmax(0, 0.7fr)',
    ...optional.map((k) => OPTIONAL_COLUMNS[k].width),
    `${trail}px`,
  ]
    .filter(Boolean)
    .join(' ')
}
