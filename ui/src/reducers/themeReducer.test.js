import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CHANGE_THEME } from '../actions'

describe('themeReducer', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it.each([
    { configTheme: 'Auto', expected: 'NavidromeTheme' },
    { configTheme: 'Dark', expected: 'DarkTheme' },
    { configTheme: 'Extra Dark', expected: 'ExtraDarkTheme' },
    { configTheme: 'Dracula', expected: 'DraculaTheme' },
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

  it('keeps legacy theme ids so the previous choice is not lost', async () => {
    const { themeReducer } = await import('./themeReducer')
    expect(
      themeReducer('NavidromeTheme', {
        type: CHANGE_THEME,
        payload: 'DraculaTheme',
      }),
    ).toBe('DraculaTheme')
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
