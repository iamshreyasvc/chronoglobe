import type { Category, HistEvent } from '../types'
import { parseWikidataYear } from './years'

// The bundled seed of notable events (built by scripts/build-seed.ts).
// Fetched once; every caller shares the same promise.

type SeedRow = [id: string, title: string, date: string, lat: number, lon: number, cat: number, sitelinks: number]

let seedPromise: Promise<HistEvent[]> | null = null

export function loadSeed(): Promise<HistEvent[]> {
  seedPromise ??= fetch(`${import.meta.env.BASE_URL}data/seed-events.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { categories: Category[]; rows: SeedRow[] } | null) =>
      (j?.rows ?? []).map(([id, title, date, lat, lon, cat, sitelinks]) => ({
        id,
        title,
        date,
        year: parseWikidataYear(date),
        lat,
        lon,
        category: j!.categories[cat],
        sitelinks,
      })),
    )
    .catch(() => [])
  return seedPromise
}
