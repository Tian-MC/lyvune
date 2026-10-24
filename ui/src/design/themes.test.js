import { describe, it, expect } from 'vitest'
import themes, { getTheme, pickerThemeId, resolveThemeId } from './themes'

describe('pickerThemeId', () => {
  it('shows the official variants as themselves', () => {
    expect(pickerThemeId('NavidromeTheme')).toBe('NavidromeTheme')
    expect(pickerThemeId('NavidromeOledTheme')).toBe('NavidromeOledTheme')
  })

  // The server default for new users is "Dark": the picker has no such entry
  it('shows the legacy Dark and Extra Dark ids as their successors', () => {
    expect(pickerThemeId('DarkTheme')).toBe('NavidromeTheme')
    expect(pickerThemeId('ExtraDarkTheme')).toBe('NavidromeOledTheme')
  })

  it('keeps tinted and unsupported legacy ids, which the picker lists', () => {
    expect(pickerThemeId('DraculaTheme')).toBe('DraculaTheme')
    expect(pickerThemeId('LightTheme')).toBe('LightTheme')
  })

  it('falls back to the default for an unknown id', () => {
    expect(pickerThemeId('NoSuchTheme')).toBe(resolveThemeId('NoSuchTheme'))
    expect(themes[pickerThemeId('NoSuchTheme')]).toBeTruthy()
  })

  it('never offers an id the picker cannot show', () => {
    for (const id of ['DarkTheme', 'ExtraDarkTheme', 'GreenTheme', 'x']) {
      expect(getTheme(pickerThemeId(id))).toBeTruthy()
    }
  })
})
