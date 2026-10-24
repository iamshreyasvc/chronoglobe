import type { HistEvent } from '../types'
import { CLASS_CATEGORY, categoryForClasses } from './categories'
import { parseWikidataYear } from './years'

const ENDPOINT = 'https://query.wikidata.org/sparql'
const CLASS_VALUES = CLASS_CATEGORY.map(([q]) => `wd:${q}`).join(' ')

// Notes from tuning against WDQS:
// - The class VALUES list keeps the scan bounded; filtering dates over all of
//   Wikidata times out.
// - The English article name (schema:name) is used instead of the label
//   service, which was ~4x slower and also gives us the exact Wikipedia title.
// - Subqueries made the optimizer pick a far worse plan (504s), so keep it flat.
function buildQuery(fromYear: number, toYearExclusive: number, limit: number): string {
  return `SELECT ?item (SAMPLE(?name) AS ?title) (MIN(?d) AS ?date) (SAMPLE(?c) AS ?coord)
  (GROUP_CONCAT(DISTINCT STRAFTER(STR(?cls), "entity/"); separator=",") AS ?classes)
  (SAMPLE(?sl) AS ?sitelinks) WHERE {
  VALUES ?cls { ${CLASS_VALUES} }
  ?item wdt:P31 ?cls .
  { ?item wdt:P585 ?d } UNION { ?item wdt:P580 ?d }
  FILTER(YEAR(?d) >= ${fromYear} && YEAR(?d) < ${toYearExclusive})
  { ?item wdt:P625 ?c } UNION { ?item wdt:P276/wdt:P625 ?c }
  ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?name .
  ?item wikibase:sitelinks ?sl .
} GROUP BY ?item ORDER BY DESC(?sitelinks) LIMIT ${limit}`
}

interface Binding {
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
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

/** Fetch events whose start/point-in-time year is in [fromYear, toYearExclusive). */
export async function fetchEvents(
  fromYear: number,
  toYearExclusive: number,
  limit = 250,
  signal?: AbortSignal,
): Promise<HistEvent[]> {
  const url = `${ENDPOINT}?query=${encodeURIComponent(buildQuery(fromYear, toYearExclusive, limit))}`
  const res = await fetch(url, {
    headers: { Accept: 'application/sparql-results+json' },
    signal,
  })
  if (!res.ok) throw new WikidataError(`Wikidata query failed (${res.status})`, res.status)
  const json = (await res.json()) as { results: { bindings: Binding[] } }

  const events: HistEvent[] = []
  for (const b of json.results.bindings) {
    const item = b.item?.value
    const title = b.title?.value
    const date = b.date?.value
    const point = b.coord && parsePoint(b.coord.value)
    if (!item || !title || !date || !point) continue
    const year = parseWikidataYear(date)
    if (!isFinite(year)) continue
    events.push({
      id: item.slice(item.lastIndexOf('/') + 1),
      title,
      date,
      year,
      lon: point[0],
      lat: point[1],
      category: categoryForClasses((b.classes?.value ?? '').split(',')),
      sitelinks: parseInt(b.sitelinks?.value ?? '0', 10),
    })
  }
  return events
}
