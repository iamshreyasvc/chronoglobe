import type { HistEvent } from '../types'
// .ts extensions let Node run this module directly (scripts/build-seed.ts).
import { CLASS_CATEGORY, categoryForClasses } from './categories.ts'
import { parseWikidataYear } from './years.ts'

const ENDPOINT = 'https://query.wikidata.org/sparql'
export const CLASS_VALUES = CLASS_CATEGORY.map(([q]) => `wd:${q}`).join(' ')
const ACCEPT = { Accept: 'application/sparql-results+json' }

// Notes from tuning against WDQS:
// - The class VALUES list keeps the scan bounded; filtering dates over all of
//   Wikidata times out.
// - The English article name (schema:name) is used instead of the label
//   service, which was ~4x slower and also gives us the exact Wikipedia title.
// - Subqueries made the optimizer pick a far worse plan (504s), so keep it flat.

/**
 * Event query shared by the time-bucket and place loaders. `select` holds
 * patterns that pick candidate items (placed first so the optimizer starts
 * there), `filter` constrains the date. Coordinates are optional when
 * `optionalCoord` is set (place queries fall back to the place's location).
 */
export function buildEventQuery(opts: { select?: string; filter?: string; limit: number; optionalCoord?: boolean }): string {
  const coord = '{ ?item wdt:P625 ?c } UNION { ?item wdt:P276/wdt:P625 ?c }'
  return `SELECT ?item (SAMPLE(?name) AS ?title) (MIN(?d) AS ?date) (SAMPLE(?c) AS ?coord)
  (GROUP_CONCAT(DISTINCT STRAFTER(STR(?cls), "entity/"); separator=",") AS ?classes)
  (SAMPLE(?sl) AS ?sitelinks) WHERE {
  ${opts.select ?? ''}
  VALUES ?cls { ${CLASS_VALUES} }
  ?item wdt:P31 ?cls .
  { ?item wdt:P585 ?d } UNION { ?item wdt:P580 ?d }
  ${opts.filter ?? ''}
  ${opts.optionalCoord ? `OPTIONAL { ${coord} }` : coord}
  ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?name .
  ?item wikibase:sitelinks ?sl .
} GROUP BY ?item ORDER BY DESC(?sitelinks) LIMIT ${opts.limit}`
}

export interface Binding {
  [k: string]: { value: string } | undefined
}

function parsePoint(wkt: string): [lon: number, lat: number] | null {
  const m = /Point\(\s*(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s*\)/.exec(wkt)
  if (!m) return null
  const lon = parseFloat(m[1])
  const lat = parseFloat(m[2])
  if (!isFinite(lon) || !isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return [lon, lat]
}

export class WikidataError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

// Responses are kept in Cache Storage for a week, so revisiting an era (or the
// whole site) is instant. Wikidata changes slowly; a week-old answer is fine.
const CACHE_NAME = 'chronoglobe-wdqs-v1'
const CACHE_TTL_MS = 7 * 24 * 3600 * 1000

export async function fetchJson(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<any> {
  const store = typeof caches !== 'undefined' ? await caches.open(CACHE_NAME).catch(() => null) : null
  const hit = await store?.match(url)
  if (hit && Date.now() - Number(hit.headers.get('x-cached-at')) < CACHE_TTL_MS) return hit.json()

  const res = await fetch(url, { headers, signal })
  if (!res.ok) throw new WikidataError(`Wikidata query failed (${res.status})`, res.status)
  const body = await res.text()
  store
    ?.put(url, new Response(body, { headers: { 'content-type': 'application/json', 'x-cached-at': String(Date.now()) } }))
    .catch(() => {})
  return JSON.parse(body)
}

/** Run an event query (see buildEventQuery) and parse its rows. */
export async function runEventQuery(
  query: string,
  opts: { signal?: AbortSignal; headers?: Record<string, string>; fallbackPoint?: [lon: number, lat: number] } = {},
): Promise<HistEvent[]> {
  const url = `${ENDPOINT}?query=${encodeURIComponent(query)}`
  const json = (await fetchJson(url, { ...ACCEPT, ...opts.headers }, opts.signal)) as {
    results: { bindings: Binding[] }
  }
  const events: HistEvent[] = []
  for (const b of json.results.bindings) {
    const e = parseEventBinding(b, opts.fallbackPoint)
    if (e) events.push(e)
  }
  return events
}

export function parseEventBinding(b: Binding, fallbackPoint?: [number, number]): HistEvent | null {
  const item = b.item?.value
  const title = b.title?.value
  const date = b.date?.value
  const point = (b.coord && parsePoint(b.coord.value)) || fallbackPoint
  if (!item || !title || !date || !point) return null
  const year = parseWikidataYear(date)
  if (!isFinite(year)) return null
  return {
    id: item.slice(item.lastIndexOf('/') + 1),
    title,
    date,
    year,
    lon: point[0],
    lat: point[1],
    category: categoryForClasses((b.classes?.value ?? '').split(',')),
    sitelinks: parseInt(b.sitelinks?.value ?? '0', 10),
  }
}

/** Fetch events whose start/point-in-time year is in [fromYear, toYearExclusive). */
export function fetchEvents(
  fromYear: number,
  toYearExclusive: number,
  limit = 250,
  signal?: AbortSignal,
  extraHeaders: Record<string, string> = {},
): Promise<HistEvent[]> {
  const query = buildEventQuery({ filter: `FILTER(YEAR(?d) >= ${fromYear} && YEAR(?d) < ${toYearExclusive})`, limit })
  return runEventQuery(query, { signal, headers: extraHeaders })
}
