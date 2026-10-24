import React, { forwardRef } from 'react'
import clsx from 'clsx'
import styles from './Button.module.css'

export const Button = forwardRef(
  (
    {
      variant = 'secondary',
      size = 'md',
      icon: Icon,
      className,
      children,
      as: Component = 'button',
      ...rest
    },
    ref,
  ) => (
    <Component
      ref={ref}
      type={Component === 'button' ? 'button' : undefined}
      className={clsx(styles.root, styles[variant], styles[size], className)}
      {...rest}
    >
      {Icon && <Icon size={size === 'sm' ? 15 : 18} aria-hidden />}
      {children && <span className={styles.label}>{children}</span>}
    </Component>
  ),
)

Button.displayName = 'Button'

export default Button
