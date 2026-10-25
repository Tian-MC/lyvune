import React from 'react'
import markUrl from './logo-mark.svg'
import horizontalUrl from './logo-horizontal.svg'
import styles from './Logo.module.css'

// The icon is 129 x 240 and the horizontal logo 709 x 200: both are set by
// their height, so they stay as drawn
const MARK_RATIO = 129 / 240
const HORIZONTAL_RATIO = 709 / 200

/** The Lyvune icon: three bars cut by a diagonal. */
export const LogoMark = ({ size = 28 }) => (
  <img
    src={markUrl}
    alt=""
    aria-hidden
    height={size}
    width={Math.round(size * MARK_RATIO)}
    className={styles.mark}
  />
)

/** The icon with the wordmark, or the icon alone when the sidebar is collapsed. */
export const Logo = ({ compact, size = 30 }) => (
  <span className={styles.root}>
    {compact ? (
      <LogoMark size={size} />
    ) : (
      <img
        src={horizontalUrl}
        alt=""
        aria-hidden
        height={size}
        width={Math.round(size * HORIZONTAL_RATIO)}
        className={styles.mark}
      />
    )}
  </span>
)

export default Logo
