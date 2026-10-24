import { useGetList } from 'react-admin'

export const genreAlbumsLink = (id) =>
  `/album/all?filter=${encodeURIComponent(
    JSON.stringify({ genre_id: [id] }),
  )}&order=ASC&sort=name`

export const useGenres = () =>
  useGetList(
    'genre',
    { page: 1, perPage: 0 },
    { field: 'name', order: 'ASC' },
    {},
  )
