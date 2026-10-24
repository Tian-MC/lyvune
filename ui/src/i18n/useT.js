import { useCallback } from 'react'
import { useTranslate } from 'react-admin'

/**
 * `t(key, fallback, options)` — translate with an inline English fallback, so
 * new keys render correctly before every language has caught up.
 */
export const useT = () => {
  const translate = useTranslate()
  return useCallback(
    (key, fallback, options) =>
      translate(key, { _: fallback ?? key, ...options }),
    [translate],
  )
}

export default useT
