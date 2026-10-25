import { CHANGE_THEME } from '../actions'
import config from '../config'
import { resolveThemeId, themeIdForServerName } from '../design/themes'

const defaultTheme = () =>
  resolveThemeId(themeIdForServerName(config.defaultTheme))

export const themeReducer = (
  previousState = defaultTheme(),
  { type, payload },
) => {
  if (type === CHANGE_THEME) {
    return resolveThemeId(payload)
  }
  return previousState
}
