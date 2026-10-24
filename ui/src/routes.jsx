import React from 'react'
import { Route } from 'react-router-dom'
import Personal from './personal/Personal'
import SearchPage from './views/search/SearchPage'
import GenresPage from './views/library/GenresPage'
import FavoritesPage from './views/library/FavoritesPage'
import LibraryHub from './views/library/LibraryHub'

const routes = [
  <Route exact path="/personal" render={() => <Personal />} key={'personal'} />,
  <Route exact path="/search" render={() => <SearchPage />} key={'search'} />,
  <Route exact path="/genre" render={() => <GenresPage />} key={'genre'} />,
  <Route
    exact
    path="/favorites"
    render={() => <FavoritesPage />}
    key={'favorites'}
  />,
  <Route exact path="/library" render={() => <LibraryHub />} key={'library'} />,
]

export default routes
