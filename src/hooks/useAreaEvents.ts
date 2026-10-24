import { useCallback, useRef, useState } from 'react'
import type { HistEvent, YearRange } from '../types'
import { fetchAreaEvents, type ViewRect } from '../lib/area'

/**
 * Events force-loaded for the area being viewed ("Load more here"). Results
 * accumulate across loads; callers filter them to the current time range.
 */
export function useAreaEvents() {
  const [events, setEvents] = useState<Map<string, HistEvent>>(new Map())
  const [loading, setLoading] = useState(false)
  const [lastAdded, setLastAdded] = useState<number | null>(null)
  const ctrl = useRef<AbortController | null>(null)

  const load = useCallback(async (rect: ViewRect, range: YearRange, alreadyShown: Set<string>) => {
    ctrl.current?.abort()
    const c = (ctrl.current = new AbortController())
    setLoading(true)
    setLastAdded(null)
    try {
      const found = await fetchAreaEvents(rect, range, c.signal)
      if (c.signal.aborted) return
      setLastAdded(found.filter((e) => !alreadyShown.has(e.id)).length)
      setEvents((prev) => {
        const next = new Map(prev)
        for (const e of found) next.set(e.id, e)
        return next
      })
    } catch {
      if (!c.signal.aborted) setLastAdded(-1) // error
    } finally {
      if (!c.signal.aborted) setLoading(false)
    }
  }, [])

  return { events, loading, lastAdded, load }
}
