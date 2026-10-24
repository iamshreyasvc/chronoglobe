import type { HistEvent } from '../types'
import { categoryForClasses } from './categories'
import { parseWikidataYear } from './years'
import { placeRadiusKm, type Place } from './places'

export interface SearchHit {
  event: HistEvent
  description?: string
  thumbnail?: string
}

export interface SearchResults {
  places: Place[]
  events: SearchHit[]
}

// Global search: Wikipedia full-text search finds the articles, then one
// Wikidata query resolves each article's date and place. Articles that are
// places (Wikipedia gives their coordinate type: city, country, …) become place
// results; articles without a date and a mappable place (people, concepts,
// lists…) are dropped.

const DATE_PROPS = ['P585', 'P580', 'P619', 'P606', 'P1619', 'P575', 'P571']
const INCEPTION = DATE_PROPS.indexOf('P571')
// Most to least precise place: own coordinates, location, start point (launch
// sites), administrative area, then the country as a last resort.
const PLACE_PROPS = ['wdt:P625', 'wdt:P276/wdt:P625', 'wdt:P1427/wdt:P625', 'wdt:P131/wdt:P625', 'wdt:P17/wdt:P625']

interface WikiPage {
  title: string
  index: number
  description?: string
  thumbnail?: { source: string }
  pageprops?: { wikibase_item?: string }
  coordinates?: { lat: number; lon: number; type?: string; dim?: number }[]
}

function parsePoint(wkt: string | undefined): [number, number] | null {
  const m = wkt && /Point\(\s*(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s*\)/.exec(wkt)
  return m ? [parseFloat(m[1]), parseFloat(m[2])] : null
}

async function searchWikipedia(q: string, signal: AbortSignal): Promise<WikiPage[]> {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: q,
    gsrlimit: '20',
    prop: 'pageprops|pageimages|description|coordinates',
    coprop: 'type|dim',
    ppprop: 'wikibase_item',
    piprop: 'thumbnail',
    pithumbsize: '250',
    format: 'json',
    formatversion: '2',
    origin: '*',
  })
  const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, { signal })
  if (!res.ok) throw new Error(`Search failed (${res.status})`)
  const j = await res.json()
  return ((j.query?.pages ?? []) as WikiPage[]).sort((a, b) => a.index - b.index)
}

async function resolveEvents(qids: string[], signal: AbortSignal) {
  const dateVars = DATE_PROPS.map((_, i) => `?d${i}`)
  const placeVars = PLACE_PROPS.map((_, i) => `?c${i}`)
  const query = `SELECT ?item ${dateVars.map((v) => `(MIN(${v}) AS ${v}x)`).join(' ')}
  ${placeVars.map((v) => `(SAMPLE(${v}) AS ${v}x)`).join(' ')}
  (GROUP_CONCAT(DISTINCT STRAFTER(STR(?cls), "entity/"); separator=",") AS ?classes)
  (SAMPLE(?sl) AS ?sitelinks) WHERE {
  VALUES ?item { ${qids.map((q) => `wd:${q}`).join(' ')} }
  ${DATE_PROPS.map((p, i) => `OPTIONAL { ?item wdt:${p} ?d${i} }`).join('\n  ')}
  ${PLACE_PROPS.map((p, i) => `OPTIONAL { ?item ${p} ?c${i} }`).join('\n  ')}
  OPTIONAL { ?item wdt:P31 ?cls }
  ?item wikibase:sitelinks ?sl .
} GROUP BY ?item`
  const res = await fetch(`https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}`, {
    headers: { Accept: 'application/sparql-results+json' },
    signal,
  })
  if (!res.ok) throw new Error(`Wikidata lookup failed (${res.status})`)
  const j = await res.json()
  const out = new Map<string, Omit<HistEvent, 'title'> & { onlyInception: boolean }>()
  for (const b of j.results.bindings as Record<string, { value: string } | undefined>[]) {
    const id = b.item!.value.split('/').pop()!
    const dateIdx = dateVars.findIndex((v) => b[`${v.slice(1)}x`]?.value)
    const date = dateIdx >= 0 ? b[`${dateVars[dateIdx].slice(1)}x`]!.value : undefined
    const point = placeVars.map((v) => parsePoint(b[`${v.slice(1)}x`]?.value)).find(Boolean)
    if (!date || !point) continue
    const year = parseWikidataYear(date)
    if (!isFinite(year)) continue
    out.set(id, {
      id,
      date,
      year,
      lon: point[0],
      lat: point[1],
      category: categoryForClasses((b.classes?.value ?? '').split(',')),
      sitelinks: parseInt(b.sitelinks?.value ?? '0', 10),
      onlyInception: dateIdx === INCEPTION,
    })
  }
  return out
}

export async function searchAll(q: string, signal: AbortSignal): Promise<SearchResults> {
  const pages = (await searchWikipedia(q, signal)).filter((p) => p.pageprops?.wikibase_item)
  if (!pages.length) return { places: [], events: [] }
  const resolved = await resolveEvents(
    pages.map((p) => p.pageprops!.wikibase_item!),
    signal,
  )
  const places: Place[] = []
  const events: SearchHit[] = []
  for (const p of pages) {
    if (/^(List|Lists|Timeline|Outline|Index) of /.test(p.title)) continue // overview articles, not places or events
    const qid = p.pageprops!.wikibase_item!
    const coord = p.coordinates?.[0]
    const e = resolved.get(qid)
    // A page is a place when it has coordinates but no event date. A founding
    // date alone (cities, countries) doesn't make it an event; a real event
    // date wins even if Wikipedia tags the coordinates as a city (Paris Commune).
    const isPlace = coord && coord.type !== 'event' && (!e || e.onlyInception)
    if (isPlace) {
      places.push({
        id: qid,
        title: p.title,
        description: p.description,
        thumbnail: p.thumbnail?.source,
        lat: coord.lat,
        lon: coord.lon,
        kind: coord.type,
        radiusKm: placeRadiusKm(coord.type, coord.dim),
      })
    } else if (e && !e.onlyInception) {
      // A founding date alone (clubs, companies, schools) isn't a historical event.
      const { onlyInception: _, ...event } = e
      events.push({ event: { ...event, title: p.title }, description: p.description, thumbnail: p.thumbnail?.source })
    }
  }
  return { places: places.slice(0, 4), events: events.slice(0, 8) }
}
