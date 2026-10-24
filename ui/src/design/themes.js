import { NavidromeTheme, NavidromeOledTheme } from './muiTheme'

// The redesigned UI ships two variants of the black-and-blue identity.
// Ids persisted by the legacy theme picker resolve to the closest variant.
const themes = {
  NavidromeTheme,
  NavidromeOledTheme,
}

export const DEFAULT_THEME_ID = 'NavidromeTheme'

const legacyAliases = {
  ExtraDarkTheme: 'NavidromeOledTheme',
}

export const resolveThemeId = (id) => {
  if (themes[id]) return id
  return legacyAliases[id] || DEFAULT_THEME_ID
}

export const getTheme = (id) => themes[resolveThemeId(id)]

export default themes
