import { SelectInput, useTranslate } from 'react-admin'
import { useDispatch, useSelector } from 'react-redux'
import themes, { pickerThemeId, resolveThemeId } from '../design/themes'
import { describeLegacyTheme, legacyThemeIds } from '../design/legacyThemes'
import { changeTheme } from '../actions'

// Official variants first; legacy dark themes are offered as tints; light
// legacy themes are listed but disabled, so a stored one stays visible.
export const SelectTheme = (props) => {
  const translate = useTranslate()
  const dispatch = useDispatch()
  const currentTheme = useSelector((state) => resolveThemeId(state.theme))
  const shownTheme = pickerThemeId(currentTheme)
  const t = (key, fallback) => translate(key, { _: fallback })
  const legacy = legacyThemeIds
    .map(describeLegacyTheme)
    .filter((d) => d.support !== 'successor')
  const choices = [
    ...Object.keys(themes).map((key) => ({
      id: key,
      name: themes[key].themeName,
    })),
    ...legacy
      .filter((d) => d.support === 'tinted')
      .map((d) => ({
        id: d.id,
        name: `${d.name} — ${t('ui.settings.legacyTinted', 'legacy, colours only')}`,
      })),
    ...legacy
      .filter((d) => d.support === 'unsupported')
      .map((d) => ({
        id: d.id,
        name: `${d.name} — ${t('ui.settings.legacyUnsupported', 'light, not supported')}`,
        disabled: true,
      })),
  ]
  const stored = describeLegacyTheme(currentTheme)
  return (
    <SelectInput
      {...props}
      source="theme"
      label={translate('menu.personal.options.theme')}
      defaultValue={shownTheme}
      translateChoice={false}
      choices={choices}
      helperText={
        stored?.support === 'unsupported'
          ? t(
              'ui.settings.legacyNotice',
              'Your saved theme is not supported by the new interface, so Lyvune is shown instead. Choose a theme to replace it.',
            )
          : undefined
      }
      onChange={(event) => dispatch(changeTheme(event.target.value))}
    />
  )
}
