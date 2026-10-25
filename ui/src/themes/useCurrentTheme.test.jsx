import React from 'react'
import { Provider } from 'react-redux'
import { createStore } from 'redux'
import { renderHook } from '@testing-library/react-hooks'
import useCurrentTheme from './useCurrentTheme'

const wrapperFor = (theme) => {
  const Wrapper = ({ children }) => (
    <Provider store={createStore((s) => s, { theme })}>{children}</Provider>
  )
  return Wrapper
}

describe('useCurrentTheme', () => {
  it('returns the Lyvune theme by default', () => {
    const { result } = renderHook(() => useCurrentTheme(), {
      wrapper: wrapperFor('NavidromeTheme'),
    })
    expect(result.current.themeName).toBe('Lyvune')
    expect(result.current.palette.primary.main).toBe('#1faf8b')
    expect(document.documentElement.dataset.theme).toBe('default')
  })

  it('falls back to the default theme for one that no longer exists', () => {
    const { result } = renderHook(() => useCurrentTheme(), {
      wrapper: wrapperFor('DraculaTheme'),
    })
    expect(result.current.themeName).toBe('Lyvune')
    expect(result.current.oled).toBe(false)
    expect(document.documentElement.dataset.theme).toBe('default')
  })

  it('maps Dark and Extra Dark to the two themes', () => {
    const dark = renderHook(() => useCurrentTheme(), {
      wrapper: wrapperFor('DarkTheme'),
    })
    expect(dark.result.current.themeName).toBe('Lyvune')
    const extra = renderHook(() => useCurrentTheme(), {
      wrapper: wrapperFor('ExtraDarkTheme'),
    })
    expect(extra.result.current.oled).toBe(true)
  })

  it('applies the OLED variant', () => {
    const { result } = renderHook(() => useCurrentTheme(), {
      wrapper: wrapperFor('NavidromeOledTheme'),
    })
    expect(result.current.oled).toBe(true)
    expect(document.documentElement.dataset.theme).toBe('oled')
    expect(document.body.style.backgroundColor).toBe('rgb(0, 0, 0)')
  })
})
