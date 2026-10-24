import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * Selection state for a tracklist. `ids` is the list order; selections are
 * returned in that order so bulk actions queue tracks as displayed.
 */
export const useTrackSelection = (ids) => {
  const [selected, setSelected] = useState(() => new Set())
  const anchor = useRef(null)

  // Drop selections that are no longer in the list (refetch, filter change)
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev
      const present = new Set(ids)
      const next = new Set([...prev].filter((id) => present.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [ids])

  const toggle = useCallback(
    (id, { range = false } = {}) => {
      setSelected((prev) => {
        const next = new Set(prev)
        if (range && anchor.current != null) {
          const a = ids.indexOf(anchor.current)
          const b = ids.indexOf(id)
          if (a !== -1 && b !== -1) {
            const [from, to] = a < b ? [a, b] : [b, a]
            ids.slice(from, to + 1).forEach((x) => next.add(x))
            return next
          }
        }
        if (next.has(id)) next.delete(id)
        else next.add(id)
        anchor.current = id
        return next
      })
    },
    [ids],
  )

  const selectAll = useCallback(() => setSelected(new Set(ids)), [ids])
  const clear = useCallback(() => {
    anchor.current = null
    setSelected(new Set())
  }, [])

  const ordered = useMemo(
    () => ids.filter((id) => selected.has(id)),
    [ids, selected],
  )

  return useMemo(
    () => ({
      selected,
      ordered,
      count: selected.size,
      active: selected.size > 0,
      isSelected: (id) => selected.has(id),
      toggle,
      selectAll,
      clear,
    }),
    [selected, ordered, toggle, selectAll, clear],
  )
}
