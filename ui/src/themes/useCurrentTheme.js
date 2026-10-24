import { useSelector } from 'react-redux'
import { useEffect } from 'react'
import { getTheme } from '../design/themes'

const useCurrentTheme = () => {
  const theme = useSelector((state) => getTheme(state.theme))

  useEffect(() => {
    // Token overrides for the OLED variant live in design/tokens.css
    document.documentElement.dataset.theme = theme.oled ? 'oled' : 'default'
    document.body.style.backgroundColor = theme.palette.background.default
  }, [theme])

  return theme
}

export default useCurrentTheme
