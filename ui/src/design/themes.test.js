import { describe, it, expect } from 'vitest'
import themes, {
  DEFAULT_THEME_ID,
  getTheme,
  resolveThemeId,
  themeIdForServerName,
} from './themes'

describe('themes', () => {
  it('has the default theme and the OLED one, and nothing else', () => {
    expect(Object.keys(themes)).toEqual([
      'NavidromeTheme',
      'NavidromeOledTheme',
    ])
    expect(themes.NavidromeTheme.themeName).toBe('Lyvune')
    expect(themes.NavidromeOledTheme.oled).toBe(true)
  })
})

describe('resolveThemeId', () => {
  it('keeps the two ids', () => {
    expect(resolveThemeId('NavidromeTheme')).toBe('NavidromeTheme')
    expect(resolveThemeId('NavidromeOledTheme')).toBe('NavidromeOledTheme')
  })

  it('maps the ids earlier versions used for Dark and Extra Dark', () => {
    expect(resolveThemeId('DarkTheme')).toBe('NavidromeTheme')
    expect(resolveThemeId('ExtraDarkTheme')).toBe('NavidromeOledTheme')
  })

  it('falls back to the default for a theme that was removed or never existed', () => {
    for (const id of [
      'DraculaTheme',
      'LightTheme',
      'GreenTheme',
      'nope',
      undefined,
    ]) {
      expect(resolveThemeId(id)).toBe(DEFAULT_THEME_ID)
    }
  })
})

describe('getTheme', () => {
  it('always returns a theme', () => {
    for (const id of [
      'NavidromeTheme',
      'NavidromeOledTheme',
      'DraculaTheme',
      'x',
    ]) {
      expect(getTheme(id).palette.background.default).toBeTruthy()
    }
    expect(getTheme('ExtraDarkTheme').oled).toBe(true)
    expect(getTheme('SpotifyTheme').oled).toBe(false)
  })
})

describe('themeIdForServerName', () => {
  it('reads the display names the server setting uses', () => {
    expect(themeIdForServerName('Extra Dark')).toBe('NavidromeOledTheme')
    expect(themeIdForServerName('Dark')).toBe('NavidromeTheme')
    expect(themeIdForServerName('Dracula')).toBe('NavidromeTheme')
    expect(themeIdForServerName('Auto')).toBe('NavidromeTheme')
  })
})
