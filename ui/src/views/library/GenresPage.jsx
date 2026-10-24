import React from 'react'
import { Link } from 'react-router-dom'
import { genreAlbumsLink, useGenres } from './genres'
import { useT } from '../../i18n/useT'
import { EmptyState, PageHeader, Skeleton } from '../../design/Section'
import { TagIcon } from '../../design/icons'
import styles from './GenresPage.module.css'

export const GenreTiles = ({ ids, data, loaded, limit }) => {
  const list = limit ? ids.slice(0, limit) : ids
  return (
    <ul className={styles.grid}>
      {loaded
        ? list.map(
            (id) =>
              data[id] && (
                <li key={id}>
                  <Link to={genreAlbumsLink(id)} className={styles.tile}>
                    <span className={styles.name}>{data[id].name}</span>
                  </Link>
                </li>
              ),
          )
        : Array.from({ length: 12 }).map((_, i) => (
            <li key={i}>
              <Skeleton className={styles.skeleton} />
            </li>
          ))}
    </ul>
  )
}

const GenresPage = () => {
  const t = useT()
  const { ids, data, loaded } = useGenres()
  return (
    <div>
      <PageHeader title={t('ui.nav.genres', 'Genres')} />
      {loaded && ids.length === 0 ? (
        <EmptyState
          icon={TagIcon}
          title={t('ui.library.noGenres', 'No genres in your library')}
        />
      ) : (
        <GenreTiles ids={ids} data={data} loaded={loaded} />
      )}
    </div>
  )
}

export default GenresPage
