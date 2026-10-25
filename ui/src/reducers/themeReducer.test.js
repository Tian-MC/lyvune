import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CHANGE_THEME } from '../actions'

describe('themeReducer', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it.each([
    { configTheme: 'Auto', expected: 'NavidromeTheme' },
    { configTheme: 'Dark', expected: 'NavidromeTheme' },
    { configTheme: 'Extra Dark', expected: 'NavidromeOledTheme' },
    { configTheme: 'Dracula', expected: 'NavidromeTheme' },
    { configTheme: 'NonExistent', expected: 'NavidromeTheme' },
  ])(
    'returns $expected when defaultTheme config is $configTheme',
    async ({ configTheme, expected }) => {
      vi.doMock('../config', () => ({
        default: { defaultTheme: configTheme },
      }))
      const { themeReducer } = await import('./themeReducer')
      expect(themeReducer(undefined, { type: 'UNKNOWN' })).toBe(expected)
    },
  )

  it('stores only the two themes that exist', async () => {
    const { themeReducer } = await import('./themeReducer')
    expect(
      themeReducer('NavidromeTheme', {
        type: CHANGE_THEME,
        payload: 'DraculaTheme',
      }),
    ).toBe('NavidromeTheme')
    expect(
      themeReducer('NavidromeTheme', { type: CHANGE_THEME, payload: 'nope' }),
    ).toBe('NavidromeTheme')
    expect(
      themeReducer('NavidromeTheme', {
        type: CHANGE_THEME,
        payload: 'NavidromeOledTheme',
      }),
    ).toBe('NavidromeOledTheme')
  })
})
