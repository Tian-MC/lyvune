import React, { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { Link } from 'react-router-dom'
import { ChevronLeftIcon, ChevronRightIcon } from './icons'
import { IconButton } from './IconButton'
import styles from './Section.module.css'

/** Titled block of content with an optional "see all" link and actions. */
export const Section = ({
  title,
  eyebrow,
  to,
  linkLabel,
  actions,
  children,
  className,
  id,
}) => {
  const headingId = id ? `${id}-title` : undefined
  return (
    <section
      className={clsx(styles.section, className)}
      aria-labelledby={headingId}
    >
      {(title || actions) && (
        <header className={styles.header}>
          <div className={styles.titles}>
            {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
            {title && (
              <h2 className={styles.title} id={headingId}>
                {to ? (
                  <Link to={to} className={styles.titleLink}>
                    {title}
                  </Link>
                ) : (
                  title
                )}
              </h2>
            )}
          </div>
          <div className={styles.actions}>
            {actions}
            {to && linkLabel && (
              <Link to={to} className={styles.seeAll}>
                {linkLabel}
              </Link>
            )}
          </div>
        </header>
      )}
      {children}
    </section>
  )
}

/**
 * Horizontally scrolling row (native scroll-snap, touch friendly) with
 * previous/next buttons on pointer devices.
 */
export const Shelf = ({ children, label, className, itemClassName }) => {
  const ref = useRef(null)
  const [edges, setEdges] = useState({ start: true, end: true })

  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    setEdges({
      start: el.scrollLeft <= 4,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4,
    })
  }, [])

  useEffect(() => {
    update()
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [update, children])

  const page = (dir) => {
    const el = ref.current
    if (!el) return
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' })
  }

  return (
    <div className={clsx(styles.shelf, className)}>
      <IconButton
        label="Previous"
        icon={ChevronLeftIcon}
        size="sm"
        variant="subtle"
        className={clsx(styles.nav, styles.prev)}
        onClick={() => page(-1)}
        disabled={edges.start}
        tabIndex={-1}
        tooltip={false}
      />
      <ul
        className={styles.track}
        ref={ref}
        onScroll={update}
        aria-label={label}
      >
        {React.Children.map(children, (child) =>
          child ? (
            <li className={clsx(styles.item, itemClassName)}>{child}</li>
          ) : null,
        )}
      </ul>
      <IconButton
        label="Next"
        icon={ChevronRightIcon}
        size="sm"
        variant="subtle"
        className={clsx(styles.nav, styles.next)}
        onClick={() => page(1)}
        disabled={edges.end}
        tabIndex={-1}
        tooltip={false}
      />
    </div>
  )
}

export const EmptyState = ({
  icon: Icon,
  title,
  children,
  action,
  compact,
}) => (
  <div
    className={clsx(styles.empty, compact && styles.emptyCompact)}
    role="status"
  >
    {Icon && (
      <div className={styles.emptyIcon}>
        <Icon size={compact ? 22 : 28} aria-hidden />
      </div>
    )}
    {title && <p className={styles.emptyTitle}>{title}</p>}
    {children && <p className={styles.emptyText}>{children}</p>}
    {action && <div className={styles.emptyAction}>{action}</div>}
  </div>
)

export const Skeleton = ({ className, round, style }) => (
  <span
    className={clsx(styles.skeleton, round && styles.skeletonRound, className)}
    style={style}
    aria-hidden
  />
)

export const PageHeader = ({ title, subtitle, actions, children }) => (
  <header className={styles.pageHeader}>
    <div className={styles.pageTitles}>
      <h1 className={styles.pageTitle}>{title}</h1>
      {subtitle && <p className={styles.pageSubtitle}>{subtitle}</p>}
    </div>
    {actions && <div className={styles.pageActions}>{actions}</div>}
    {children}
  </header>
)

/** Animated equaliser marking the playing track; static when paused. */
export const PlayingBars = ({ playing, className, label }) => (
  <span
    className={clsx(styles.bars, playing && styles.barsPlaying, className)}
    role="img"
    aria-label={label}
  >
    <span />
    <span />
    <span />
  </span>
)
