import React from 'react'
import styles from './Logo.module.css'

/** The Lyvune vinyl mark (vector rendition of the official logo). */
export const LogoMark = ({ size = 28 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    aria-hidden
    className={styles.mark}
  >
    <circle cx="32" cy="32" r="30" fill="#1faf8b" />
    <g fill="none" stroke="#0a1110" strokeWidth="2.6" strokeLinecap="round">
      <path d="M12.5 26.5A21 21 0 0 1 26.5 12.5" />
      <path d="M17.6 28.4A15 15 0 0 1 28.4 17.6" />
      <path d="M51.5 37.5A21 21 0 0 1 37.5 51.5" />
      <path d="M46.4 35.6A15 15 0 0 1 35.6 46.4" />
    </g>
    <circle cx="32" cy="32" r="9.5" fill="#ddfbf1" />
    <circle cx="32" cy="32" r="4.2" fill="#0a1110" />
    <circle cx="32" cy="32" r="1.6" fill="#ddfbf1" />
  </svg>
)

export const Logo = ({ compact }) => (
  <span className={styles.root}>
    <LogoMark />
    {!compact && <span className={styles.word}>Lyvune</span>}
  </span>
)

export default Logo
