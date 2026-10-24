// Builds public/data/seed-events.json: the most notable events of every era,
// shipped with the site so the globe has events the instant it loads. Live
// Wikidata queries then add detail as the user zooms in.
//
//   npm run seed        (Node 23.6+ runs this TypeScript file directly)

import { writeFile, mkdir } from 'node:fs/promises'
import { fetchEvents } from '../src/lib/wikidata.ts'
import { CATEGORIES } from '../src/lib/categories.ts'
import { MAX_YEAR } from '../src/lib/years.ts'
import type { HistEvent } from '../src/types.ts'

// Denser slices for recent history, where far more is recorded.
const ERAS: [from: number, to: number, step: number][] = [
  [-2999, -499, 250],
  [-499, 1000, 100],
  [1000, 1500, 50],
  [1500, 1800, 20],
  [1800, MAX_YEAR + 1, 5],
]
const PER_SLICE = 50
const CONCURRENCY = 3
const HEADERS = { 'User-Agent': 'Chronoglobe seed builder (https://github.com/iamshreyasvc/chronoglobe)' }

const slices: [number, number][] = []
for (const [from, to, step] of ERAS) for (let y = from; y < to; y += step) slices.push([y, Math.min(y + step, to)])

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function load([from, to]: [number, number]): Promise<HistEvent[]> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetchEvents(from, to, PER_SLICE, undefined, HEADERS)
    } catch (e) {
      if (attempt >= 4) throw e
      await sleep(3000 * attempt)
    }
  }
}

const byId = new Map<string, HistEvent>()
let done = 0
const queue = [...slices]
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const slice = queue.shift()!
      for (const e of await load(slice)) byId.set(e.id, e)
      process.stdout.write(`\r${++done}/${slices.length} slices, ${byId.size} events`)
    }
  }),
)

// Compact rows: [id, title, date, lat, lon, categoryIndex, sitelinks]
const rows = [...byId.values()]
  .sort((a, b) => a.year - b.year)
  .map((e) => [
    e.id,
    e.title,
    e.date.slice(0, e.date.indexOf('T')),
    +e.lat.toFixed(3),
    +e.lon.toFixed(3),
    CATEGORIES.indexOf(e.category),
    e.sitelinks,
  ])

await mkdir('public/data', { recursive: true })
await writeFile(
  'public/data/seed-events.json',
  JSON.stringify({ version: 1, generated: new Date().toISOString().slice(0, 10), categories: CATEGORIES, rows }),
)
console.log(`\nWrote ${rows.length} events to public/data/seed-events.json`)
