import type { HistEvent } from '../types'
import { categoryForClasses } from './categories'
import { parseWikidataYear } from './years'

export interface SearchHit {
  event: HistEvent
  description?: string
  thumbnail?: string
}

// Global search: Wikipedia full-text search finds the articles, then one
// Wikidata query resolves each article's date and place. Articles without a
// date and a mappable place (people, concepts, lists…) are dropped.

const DATE_PROPS = ['P585', 'P580', 'P619', 'P606', 'P1619', 'P575', 'P571']
// Most to least precise place: own coordinates, location, start point (launch
// sites), administrative area, then the country as a last resort.
const PLACE_PROPS = ['wdt:P625', 'wdt:P276/wdt:P625', 'wdt:P1427/wdt:P625', 'wdt:P131/wdt:P625', 'wdt:P17/wdt:P625']

interface WikiPage {
  title: string
  index: number
  description?: string
  thumbnail?: { source: string }
  pageprops?: { wikibase_item?: string }
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
    prop: 'pageprops|pageimages|description',
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
  const out = new Map<string, Omit<HistEvent, 'title'>>()
  for (const b of j.results.bindings as Record<string, { value: string } | undefined>[]) {
    const id = b.item!.value.split('/').pop()!
    const date = dateVars.map((v) => b[`${v.slice(1)}x`]?.value).find(Boolean)
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
    })
  }
  return out
}

export async function searchEvents(q: string, signal: AbortSignal): Promise<SearchHit[]> {
  const pages = (await searchWikipedia(q, signal)).filter((p) => p.pageprops?.wikibase_item)
  if (!pages.length) return []
  const resolved = await resolveEvents(
    pages.map((p) => p.pageprops!.wikibase_item!),
    signal,
  )
  const hits: SearchHit[] = []
  for (const p of pages) {
    const e = resolved.get(p.pageprops!.wikibase_item!)
    if (!e) continue
    hits.push({ event: { ...e, title: p.title }, description: p.description, thumbnail: p.thumbnail?.source })
  }
  return hits.slice(0, 10)
}
