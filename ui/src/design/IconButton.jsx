import React, { forwardRef } from 'react'
import clsx from 'clsx'
import Tooltip from '@material-ui/core/Tooltip'
import styles from './IconButton.module.css'

/**
 * Icon-only button. `label` is mandatory: it becomes the accessible name and,
 * unless `tooltip={false}`, a hover/focus tooltip.
 */
export const IconButton = forwardRef(
  (
    {
      label,
      icon: Icon,
      size = 'md',
      variant = 'ghost',
      active = false,
      pressed,
      tooltip = true,
      className,
      iconSize,
      children,
      ...rest
    },
    ref,
  ) => {
    const button = (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        className={clsx(
          styles.root,
          styles[size],
          styles[variant],
          active && styles.active,
          className,
        )}
        {...rest}
      >
        {Icon && <Icon size={iconSize || ICON_SIZES[size]} aria-hidden />}
        {children}
      </button>
    )
    if (!tooltip || rest.disabled) return button
    return (
      <Tooltip title={label} placement="top">
        {button}
      </Tooltip>
    )
  },
)

IconButton.displayName = 'IconButton'

const ICON_SIZES = { xs: 15, sm: 17, md: 20, lg: 22, xl: 26 }

export default IconButton
