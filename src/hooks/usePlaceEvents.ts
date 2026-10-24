import { useEffect, useState } from 'react'
import type { HistEvent } from '../types'
import { fetchPlaceEvents, type Place } from '../lib/places'

const memory = new Map<string, HistEvent[]>()

/** All events at `place` (empty when null), growing as each loading tier lands. */
export function usePlaceEvents(place: Place | null): { events: HistEvent[]; loading: boolean } {
  const [state, setState] = useState<{ id: string | null; events: HistEvent[]; loading: boolean }>({
    id: null,
    events: [],
    loading: false,
  })

  useEffect(() => {
    if (!place) return setState({ id: null, events: [], loading: false })
    const cached = memory.get(place.id)
    if (cached) return setState({ id: place.id, events: cached, loading: false })
    const ctrl = new AbortController()
    setState({ id: place.id, events: [], loading: true })
    fetchPlaceEvents(
      place,
      (events, done) => {
        if (done) memory.set(place.id, events)
        setState({ id: place.id, events, loading: !done })
      },
      ctrl.signal,
    )
    return () => ctrl.abort()
  }, [place])

  return place && state.id === place.id ? state : { events: [], loading: !!place }
}
