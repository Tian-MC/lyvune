import { CHANGE_THEME } from '../actions'
import config from '../config'
import { DEFAULT_THEME_ID, resolveThemeId } from '../design/themes'

// The server-side DefaultTheme names a legacy theme ("Dark", "Auto", ...);
// "Extra Dark" maps to the OLED variant, everything else to the default one.
const defaultTheme = () =>
  config.defaultTheme === 'Extra Dark'
    ? resolveThemeId('ExtraDarkTheme')
    : DEFAULT_THEME_ID

export const themeReducer = (
  previousState = defaultTheme(),
  { type, payload },
) => {
  if (type === CHANGE_THEME) {
    return resolveThemeId(payload)
  }
  return previousState
}
