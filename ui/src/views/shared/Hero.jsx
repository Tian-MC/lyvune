import React from 'react'
import clsx from 'clsx'
import { Ambient } from '../../design/Ambient'
import styles from './Hero.module.css'

/**
 * Cinematic page header for albums, artists and playlists: artwork-lit
 * backdrop, large art, editorial title and an action row. It bleeds under the
 * top bar and to the page edges; text sits on a scrim for contrast.
 */
export const Hero = ({
  art,
  eyebrow,
  title,
  children,
  meta,
  actions,
  thumbHash,
  dominantColor,
  round = false,
  className,
}) => (
  <header className={clsx(styles.hero, 'nd-bleed', className)}>
    <Ambient thumbHash={thumbHash} dominantColor={dominantColor} />
    <div className={styles.inner}>
      {art && (
        <div className={clsx(styles.art, round && styles.round)}>{art}</div>
      )}
      <div className={styles.body}>
        {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
        <h1
          className={clsx(
            styles.title,
            typeof title === 'string' && title.length > 40 && styles.titleLong,
          )}
        >
          {title}
        </h1>
        {children && <div className={styles.subtitle}>{children}</div>}
        {meta && <div className={styles.meta}>{meta}</div>}
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </div>
  </header>
)

export default Hero
