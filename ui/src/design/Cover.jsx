import React from 'react'
import clsx from 'clsx'
import { Artwork } from '../common/Artwork'
import config from '../config'
import styles from './Cover.module.css'

/**
 * Square artwork tile used everywhere in the product. Builds on the shared
 * Artwork loader (blob cache + thumbhash placeholder) and adds the design-system
 * shape, a neutral backdrop for missing art and optional elevation.
 */
export const Cover = ({
  record,
  size = 300,
  round = false,
  elevated = false,
  className,
  alt = '',
}) => (
  <div
    className={clsx(
      styles.root,
      round && styles.round,
      elevated && styles.elevated,
      className,
    )}
  >
    {record && (
      <Artwork
        record={record}
        size={Math.min(size, config.uiCoverArtSize || size)}
        square={!round}
        className={styles.art}
        title={alt}
      />
    )}
  </div>
)

export default Cover
