import { CHANGE_THEME } from '../actions'
import config from '../config'
import { DEFAULT_THEME_ID, resolveThemeId } from '../design/themes'
import { legacyIdByName } from '../design/legacyThemes'

// The server-side DefaultTheme names a theme by its display name
const defaultTheme = () =>
  resolveThemeId(legacyIdByName(config.defaultTheme) || DEFAULT_THEME_ID)

export const themeReducer = (
  previousState = defaultTheme(),
  { type, payload },
) => {
  if (type === CHANGE_THEME) {
    return resolveThemeId(payload)
  }
  return previousState
}
