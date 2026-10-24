import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { HistEvent, YearRange } from '../types'
import { fetchEvents, WikidataError } from '../lib/wikidata'

// The timeline range is split into aligned buckets (e.g. 1930–1939, 1940–1949)
// so that results can be cached and reused as the window slides. The bucket
// size grows with the window span to keep the number of queries small; each
// bucket returns its most notable events (by sitelink count).

const BUCKET_SIZES = [10, 25, 50, 100, 250, 500, 1000]
const MAX_BUCKETS = 5
const PER_BUCKET_LIMIT = 250
const MAX_CONCURRENT = 3 // WDQS allows 5 parallel queries per client
const DEBOUNCE_MS = 400

interface Bucket {
  key: string
  start: number
  size: number
}

function bucketSizeFor(span: number): number {
  return BUCKET_SIZES.find((s) => Math.ceil(span / s) + 1 <= MAX_BUCKETS) ?? BUCKET_SIZES.at(-1)!
}

function bucketsFor(from: number, to: number, size: number): Bucket[] {
  const out: Bucket[] = []
  for (let s = Math.floor(from / size) * size; s <= to; s += size) {
    out.push({ key: `${size}:${s}`, start: s, size })
  }
  return out
}

// ---- module-level store: survives re-renders and StrictMode remounts ----

const cache = new Map<string, HistEvent[]>()
const failed = new Map<string, number>() // key -> time of failure
const running = new Set<string>()
let queue: Bucket[] = []
let lastError: string | null = null
let snapshot = 0
const listeners = new Set<() => void>()

function emit() {
  snapshot++
  listeners.forEach((l) => l())
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function load(b: Bucket) {
  running.add(b.key)
  emit()
  try {
    let events: HistEvent[]
    try {
      events = await fetchEvents(b.start, b.start + b.size, PER_BUCKET_LIMIT)
    } catch (e) {
      // One retry for rate limiting / transient server errors.
      if (e instanceof WikidataError && e.status !== 429 && e.status < 500) throw e
      await sleep(2500)
      events = await fetchEvents(b.start, b.start + b.size, PER_BUCKET_LIMIT)
    }
    cache.set(b.key, events)
    failed.delete(b.key)
    lastError = null
  } catch (e) {
    failed.set(b.key, Date.now())
    lastError = e instanceof Error ? e.message : String(e)
  } finally {
    running.delete(b.key)
    pump()
    emit()
  }
}

function pump() {
  while (running.size < MAX_CONCURRENT && queue.length) load(queue.shift()!)
}

/** Replace the pending queue with `wanted` (in priority order), skipping work already done. */
function request(wanted: Bucket[]) {
  const now = Date.now()
  queue = wanted.filter(
    (b) => !cache.has(b.key) && !running.has(b.key) && !(now - (failed.get(b.key) ?? 0) < 15000),
  )
  pump()
  emit()
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

// ---- hook ----

export interface EventsState {
  events: HistEvent[]
  /** Number of buckets for the visible range still loading */
  pending: number
  error: string | null
}

/**
 * Events whose year lies in `range`. `lookahead` (years past `range.to`) is
 * prefetched at lower priority, used while the timeline is playing.
 */
export function useEvents(range: YearRange, lookahead = 0): EventsState {
  const [debounced, setDebounced] = useState(range)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(range), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [range.from, range.to]) // eslint-disable-line react-hooks/exhaustive-deps

  const version = useSyncExternalStore(subscribe, () => snapshot)

  const size = bucketSizeFor(debounced.to - debounced.from + 1)
  const visible = useMemo(
    () => bucketsFor(debounced.from, debounced.to, size),
    [debounced.from, debounced.to, size],
  )

  useEffect(() => {
    const ahead = lookahead > 0 ? bucketsFor(debounced.to + 1, debounced.to + lookahead, size) : []
    request([...visible, ...ahead])
  }, [visible, lookahead, size, debounced.to])

  // Combine every cached bucket that overlaps the live (non-debounced) range,
  // whatever its size, so zooming the window shows existing data immediately.
  const events = useMemo(() => {
    const byId = new Map<string, HistEvent>()
    for (const [key, list] of cache) {
      const [s, start] = key.split(':').map(Number)
      if (start > range.to || start + s - 1 < range.from) continue
      for (const e of list) {
        if (e.year >= range.from && e.year <= range.to && !byId.has(e.id)) byId.set(e.id, e)
      }
    }
    return [...byId.values()]
  }, [range.from, range.to, version])

  const pending = visible.filter((b) => !cache.has(b.key) && !failed.has(b.key)).length
  return { events, pending, error: lastError }
}
