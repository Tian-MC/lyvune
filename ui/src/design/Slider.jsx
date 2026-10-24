import React, { useCallback, useState } from 'react'
import clsx from 'clsx'
import styles from './Slider.module.css'

/**
 * Accessible range slider built on <input type="range"> (keyboard, screen
 * readers and touch for free). While the user drags, the visual value follows
 * the pointer and `onCommit` fires on release, so seeking does not stutter.
 */
export const Slider = ({
  value,
  max = 1,
  step = 0.001,
  label,
  valueText,
  onChange,
  onCommit,
  disabled,
  buffered,
  className,
  variant = 'default',
}) => {
  const [dragValue, setDragValue] = useState(null)
  const shown = dragValue ?? value ?? 0
  const pct = max > 0 ? Math.min(100, (shown / max) * 100) : 0
  const bufferedPct =
    buffered != null && max > 0 ? Math.min(100, (buffered / max) * 100) : 0

  const handleInput = useCallback(
    (e) => {
      const v = parseFloat(e.target.value)
      if (onCommit) setDragValue(v)
      onChange && onChange(v)
    },
    [onChange, onCommit],
  )

  const commit = useCallback(() => {
    if (dragValue != null) {
      onCommit && onCommit(dragValue)
      setDragValue(null)
    }
  }, [dragValue, onCommit])

  return (
    <div
      className={clsx(
        styles.root,
        styles[variant],
        disabled && styles.disabled,
        dragValue != null && styles.dragging,
        className,
      )}
      style={{ '--pct': `${pct}%`, '--buffered': `${bufferedPct}%` }}
    >
      <div className={styles.track} aria-hidden>
        <div className={styles.buffered} />
        <div className={styles.fill} />
      </div>
      <input
        type="range"
        className={styles.input}
        min={0}
        max={max || 0}
        step={step}
        value={shown}
        aria-label={label}
        aria-valuetext={valueText}
        disabled={disabled}
        onChange={handleInput}
        onPointerUp={commit}
        onKeyUp={commit}
        onTouchEnd={commit}
        onBlur={commit}
      />
    </div>
  )
}

export default Slider
