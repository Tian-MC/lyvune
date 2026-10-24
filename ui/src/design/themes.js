import {
  NavidromeTheme,
  NavidromeOledTheme,
  createNavidromeTheme,
} from './muiTheme'
import { describeLegacyTheme } from './legacyThemes'

// The two official variants of the black-and-blue identity
const themes = {
  NavidromeTheme,
  NavidromeOledTheme,
}

export const DEFAULT_THEME_ID = 'NavidromeTheme'

/**
 * Normalises a theme id for storage. Official and legacy ids are kept as
 * they are, so a previous choice is never lost; unknown ids fall back.
 */
export const resolveThemeId = (id) => {
  if (themes[id] || describeLegacyTheme(id)) return id
  return DEFAULT_THEME_ID
}

/**
 * The id the theme picker should show as selected. Dark and Extra Dark are not
 * listed on their own (they became the official variants), so a stored one is
 * shown as its successor. The stored id itself is left untouched.
 */
export const pickerThemeId = (id) => {
  const legacy = describeLegacyTheme(resolveThemeId(id))
  return legacy?.support === 'successor' ? legacy.successor : resolveThemeId(id)
}

const tinted = new Map()

/**
 * The theme to render for a stored id. Legacy themes carry a `legacy`
 * descriptor; unsupported ones render the default theme.
 */
export const getTheme = (id) => {
  if (themes[id]) return themes[id]
  const legacy = describeLegacyTheme(id)
  if (!legacy) return themes[DEFAULT_THEME_ID]
  if (legacy.support === 'successor') return themes[legacy.successor]
  if (legacy.support === 'tinted') {
    if (!tinted.has(id)) {
      tinted.set(
        id,
        createNavidromeTheme({ name: legacy.name, tint: legacy.tint, legacy }),
      )
    }
    return tinted.get(id)
  }
  return { ...themes[DEFAULT_THEME_ID], legacy }
}

export default themes
