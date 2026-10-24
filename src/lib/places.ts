import type { HistEvent } from '../types'
import { CLASS_CATEGORY } from './categories'
import { loadSeed } from './seed'
import { buildEventQuery, fetchJson, runEventQuery } from './wikidata'

export interface Place {
  /** Wikidata Q-id */
  id: string
  title: string
  description?: string
  thumbnail?: string
  lat: number
  lon: number
  /** Wikipedia coordinate type: city, country, adm1st, landmark, … */
  kind?: string
  radiusKm: number
}

/** Search radius for a place, from its Wikipedia coordinate type and size (meters). */
export function placeRadiusKm(kind: string | undefined, dim: number | undefined): number {
  switch (kind) {
    case 'city':
      return 25
    case 'adm3rd':
    case 'adm2nd':
      return 50
    case 'adm1st':
      return 150
    case 'country':
      return Math.min(600, Math.max(150, (dim ?? 600000) / 2000))
    default:
      return Math.min(150, Math.max(10, ((dim ?? 10000) / 1000) * 1.5))
  }
}

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180
  const dLat = (lat2 - lat1) * toRad
  const dLon = (lon2 - lon1) * toRad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(a))
}

const CLASS_IDS = CLASS_CATEGORY.map(([q]) => q).join('|')

/** Events with their own coordinates near the place, via Wikidata's search index (~0.3 s). */
async function nearbyEventIds(p: Place, signal: AbortSignal): Promise<string[]> {
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: `nearcoord:${Math.round(p.radiusKm)}km,${p.lat},${p.lon} haswbstatement:P31=${CLASS_IDS}`,
    srlimit: '500',
    srnamespace: '0',
    srprop: '',
    format: 'json',
    origin: '*',
  })
  const j = await fetchJson(`https://www.wikidata.org/w/api.php?${params}`, {}, signal)
  return ((j.query?.search ?? []) as { title: string }[]).map((r) => r.title)
}

/**
 * Events located in the place or in places up to two levels inside it
 * (Bastille → 4th arrondissement → Paris); for countries, everything with
 * that country. The most complete tier; ~0.2–11 s.
 */
function hierarchyQuery(p: Place): string {
  const place = `wd:${p.id}`
  // Countries: walking sub-places is too slow (WDQS times out), and the
  // country statement (P17) already covers them (~7 s for France).
  const select =
    p.kind === 'country'
      ? `{ ?item wdt:P17 ${place} } UNION { ?item wdt:P276 ${place} } UNION { ?item wdt:P131 ${place} }`
      : `{ BIND(${place} AS ?loc) } UNION { ?loc wdt:P131 ${place} } UNION { ?loc wdt:P131/wdt:P131 ${place} }
    { ?item wdt:P276 ?loc } UNION { ?item wdt:P131 ?loc }`
  return buildEventQuery({ select, limit: 500, optionalCoord: true })
}

/**
 * All events at a place, in three tiers. `onUpdate` receives the merged list
 * after each tier: nearby seed events (instant), nearby events from the search
 * index, then the full located-in query.
 */
export async function fetchPlaceEvents(
  p: Place,
  onUpdate: (events: HistEvent[], done: boolean) => void,
  signal: AbortSignal,
): Promise<void> {
  const byId = new Map<string, HistEvent>()
  const merge = (list: HistEvent[]) => list.forEach((e) => byId.set(e.id, e))
  const emit = (done: boolean) => !signal.aborted && onUpdate([...byId.values()], done)
  const fallbackPoint: [number, number] = [p.lon, p.lat]

  const seed = await loadSeed()
  merge(seed.filter((e) => distanceKm(p.lat, p.lon, e.lat, e.lon) <= p.radiusKm))
  emit(false)

  const nearby = nearbyEventIds(p, signal)
    .then((ids) => {
      if (!ids.length) return []
      const values = `VALUES ?item { ${ids.slice(0, 300).map((id) => `wd:${id}`).join(' ')} }`
      return runEventQuery(buildEventQuery({ select: values, limit: 500 }), { signal })
    })
    .then((list) => {
      merge(list)
      emit(false)
    })
    .catch(() => {})

  const located = runEventQuery(hierarchyQuery(p), { signal, fallbackPoint })
    .then((list) => {
      merge(list)
      emit(false)
    })
    .catch(() => {})

  await Promise.all([nearby, located])
  emit(true)
}
