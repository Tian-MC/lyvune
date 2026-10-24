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
  it('returns the Navidrome theme by default', () => {
    const { result } = renderHook(() => useCurrentTheme(), {
      wrapper: wrapperFor('NavidromeTheme'),
    })
    expect(result.current.themeName).toBe('Navidrome')
    expect(result.current.palette.primary.main).toBe('#0084ff')
    expect(document.documentElement.dataset.theme).toBe('default')
  })

  it('maps legacy theme ids to the Navidrome theme', () => {
    const { result } = renderHook(() => useCurrentTheme(), {
      wrapper: wrapperFor('DraculaTheme'),
    })
    expect(result.current.themeName).toBe('Navidrome')
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
