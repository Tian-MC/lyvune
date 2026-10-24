import { useSelector } from 'react-redux'
import { useEffect } from 'react'
import { getTheme } from '../design/themes'
import { tintCssVars } from '../design/legacyThemes'

const TINT_VARS = Object.keys(tintCssVars({}))

const useCurrentTheme = () => {
  const theme = useSelector((state) => getTheme(state.theme))

  useEffect(() => {
    const root = document.documentElement
    // Token overrides for the OLED variant live in design/tokens.css
    root.dataset.theme = theme.oled ? 'oled' : 'default'
    // Legacy dark themes tint the accent and surfaces through tokens
    const vars = theme.tint ? tintCssVars(theme.tint) : {}
    TINT_VARS.forEach((name) =>
      vars[name]
        ? root.style.setProperty(name, vars[name])
        : root.style.removeProperty(name),
    )
    document.body.style.backgroundColor = theme.palette.background.default
  }, [theme])

  return theme
}

export default useCurrentTheme
