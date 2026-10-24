import type { HistEvent, YearRange } from '../types'
import { buildEventQuery, runEventQuery } from './wikidata'

/** Visible part of the globe, in degrees. west > east when it crosses the antimeridian. */
export interface ViewRect {
  west: number
  south: number
  east: number
  north: number
}

const SLICES = 4 // a long period is split so results spread across it
const PER_SLICE = 300

/**
 * Events in the time range whose coordinates fall inside the view: the normal
 * time query plus a latitude/longitude filter (~3 s per slice). Unlike the
 * global period buckets, every result is in the area being looked at.
 */
export async function fetchAreaEvents(rect: ViewRect, range: YearRange, signal: AbortSignal): Promise<HistEvent[]> {
  const lat = 'geof:latitude(?c)'
  const lon = 'geof:longitude(?c)'
  const f = (n: number) => n.toFixed(3)
  const lonFilter =
    rect.west <= rect.east
      ? `${lon} >= ${f(rect.west)} && ${lon} <= ${f(rect.east)}`
      : `(${lon} >= ${f(rect.west)} || ${lon} <= ${f(rect.east)})`
  const area = `FILTER(${lat} >= ${f(rect.south)} && ${lat} <= ${f(rect.north)} && ${lonFilter})`

  const span = range.to - range.from + 1
  const n = span > 200 ? SLICES : 1
  const step = Math.ceil(span / n)
  const slices = Array.from({ length: n }, (_, i) => [range.from + i * step, Math.min(range.to + 1, range.from + (i + 1) * step)])

  const results = await Promise.all(
    slices.map(([from, to]) =>
      runEventQuery(
        // A SPARQL FILTER applies to its whole group, so the area filter can sit
        // next to the date filter even though ?c is bound further down.
        buildEventQuery({ filter: `FILTER(YEAR(?d) >= ${from} && YEAR(?d) < ${to})\n  ${area}`, limit: PER_SLICE }),
        { signal },
      ),
    ),
  )
  return results.flat()
}
