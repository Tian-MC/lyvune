import { NavidromeTheme, NavidromeOledTheme } from './muiTheme'

// The two themes there are: the default one, and a pure-black variant for OLED screens
const themes = {
  NavidromeTheme,
  NavidromeOledTheme,
}

export const DEFAULT_THEME_ID = 'NavidromeTheme'

// Ids that earlier versions stored. Dark and Extra Dark became the two themes
// above; every other theme was removed and falls back to the default
const RENAMED = {
  DarkTheme: 'NavidromeTheme',
  ExtraDarkTheme: 'NavidromeOledTheme',
}

/** The id to use and store for whatever id was stored before. */
export const resolveThemeId = (id) =>
  themes[id] ? id : RENAMED[id] || DEFAULT_THEME_ID

/** The theme to render for a stored id. */
export const getTheme = (id) => themes[resolveThemeId(id)]

/**
 * The theme the server's DefaultTheme setting names. It uses display names from
 * the old interface ("Dark", "Extra Dark", "Light", ...).
 */
export const themeIdForServerName = (name) =>
  name === 'Extra Dark' ? 'NavidromeOledTheme' : DEFAULT_THEME_ID

export default themes
