import { describe, it, expect } from 'vitest'
import legacyThemes from '../themes'
import {
  computeTint,
  describeLegacyTheme,
  legacyIdByName,
  legacyThemeIds,
  tintCssVars,
} from './legacyThemes'
import { contrast } from './color'

const tinted = legacyThemeIds.filter(
  (id) => describeLegacyTheme(id).support === 'tinted',
)

describe('legacy theme compatibility', () => {
  it('classifies every community theme', () => {
    expect(legacyThemeIds.length).toBeGreaterThan(0)
    legacyThemeIds.forEach((id) =>
      expect(['successor', 'tinted', 'unsupported']).toContain(
        describeLegacyTheme(id).support,
      ),
    )
  })

  it('maps Dark and Extra Dark to the official variants', () => {
    expect(describeLegacyTheme('DarkTheme')).toMatchObject({
      support: 'successor',
      successor: 'NavidromeTheme',
    })
    expect(describeLegacyTheme('ExtraDarkTheme')).toMatchObject({
      support: 'successor',
      successor: 'NavidromeOledTheme',
    })
  })

  it('never treats a light theme as supported', () => {
    legacyThemeIds
      .filter((id) => describeLegacyTheme(id).support === 'unsupported')
      .forEach((id) => {
        expect(legacyThemes[id].palette?.type).not.toBe('dark')
      })
    ;['LightTheme', 'NutballTheme', 'SolarizedLightTheme'].forEach((id) =>
      expect(describeLegacyTheme(id).support).toBe('unsupported'),
    )
  })

  it('tints dark themes and keeps their accent', () => {
    expect(describeLegacyTheme('DraculaTheme').tint.blue).toBe('#bd93f9')
    expect(describeLegacyTheme('SpotifyTheme').tint.blue).toBe('#1db954')
  })

  it('resolves a server DefaultTheme name to a theme id', () => {
    expect(legacyIdByName('Dracula')).toBe('DraculaTheme')
    expect(legacyIdByName('nope')).toBeUndefined()
  })

  it('exposes only known css custom properties', () => {
    Object.keys(tintCssVars(computeTint('#0084ff', '#08090b'))).forEach(
      (name) => expect(name).toMatch(/^--[a-z0-9-]+$/),
    )
  })

  describe.each(tinted)('%s', (id) => {
    const { tint } = describeLegacyTheme(id)

    it('keeps secondary text readable on cards', () => {
      expect(contrast(tint.text2, tint.surface2)).toBeGreaterThanOrEqual(7)
      expect(contrast(tint.text3, tint.surface2)).toBeGreaterThanOrEqual(4.5)
    })

    it('keeps accent text and filled controls readable', () => {
      expect(contrast(tint.blueText, tint.bgApp)).toBeGreaterThanOrEqual(4.5)
      expect(
        contrast(tint.textOnAccent, tint.blueSolid),
      ).toBeGreaterThanOrEqual(4.5)
    })

    it('keeps the accent visible against the background', () => {
      expect(contrast(tint.blue, tint.bgApp)).toBeGreaterThanOrEqual(3)
    })

    it('keeps a dark canvas', () => {
      expect(contrast(tint.bgApp, '#000000')).toBeLessThan(2)
    })
  })
})
