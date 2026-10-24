import React, { memo } from 'react'
import clsx from 'clsx'
import { ThumbHashCanvas } from '../common/ThumbHashCanvas'
import { ambientFrom } from './color'
import styles from './Ambient.module.css'

/**
 * Artwork-derived atmospheric lighting. Uses the server-provided thumbhash
 * (a ~32px canvas, upscaled and blurred by the compositor) plus the dominant
 * colour, under a dark scrim that guarantees text contrast. Static by design:
 * no animation loops, a single cross-fade when the artwork changes.
 */
export const Ambient = memo(
  ({ thumbHash, dominantColor, intensity = 'subtle', className }) => {
    const ambient = ambientFrom(dominantColor)
    return (
      <div
        className={clsx(styles.root, styles[intensity], className)}
        style={{ '--ambient': ambient }}
        aria-hidden
      >
        {thumbHash && (
          <ThumbHashCanvas
            key={thumbHash}
            hash={thumbHash}
            fit="cover"
            className={styles.canvas}
          />
        )}
        <div className={styles.wash} />
        <div className={styles.scrim} />
      </div>
    )
  },
)

Ambient.displayName = 'Ambient'

export default Ambient
