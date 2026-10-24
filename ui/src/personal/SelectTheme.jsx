import { SelectInput, useTranslate } from 'react-admin'
import { useDispatch, useSelector } from 'react-redux'
import themes, { resolveThemeId } from '../design/themes'
import { changeTheme } from '../actions'

export const SelectTheme = (props) => {
  const translate = useTranslate()
  const dispatch = useDispatch()
  const currentTheme = useSelector((state) => resolveThemeId(state.theme))
  const themeChoices = Object.keys(themes).map((key) => ({
    id: key,
    name: themes[key].themeName,
  }))
  return (
    <SelectInput
      {...props}
      source="theme"
      label={translate('menu.personal.options.theme')}
      defaultValue={currentTheme}
      translateChoice={false}
      choices={themeChoices}
      onChange={(event) => dispatch(changeTheme(event.target.value))}
    />
  )
}
