import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Category, HistEvent, YearRange } from './types'
import { CATEGORIES } from './lib/categories'
import { MAX_YEAR, MIN_YEAR } from './lib/years'
import { setThumb } from './lib/wikipedia'
import type { SearchHit } from './lib/search'
import { useEvents } from './hooks/useEvents'
import { useThumbs } from './hooks/useThumbs'
import { Globe } from './components/Globe'
import { Timeline } from './components/Timeline'
import { EventPanel } from './components/EventPanel'
import { CategoryFilter } from './components/CategoryFilter'
import { Brand } from './components/Brand'
import { SearchBar } from './components/SearchBar'

const THUMB_COUNT = 150

export default function App() {
  const [range, setRange] = useState<YearRange>({ from: 1939, to: 1945 })
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [enabled, setEnabled] = useState<Set<Category>>(() => new Set(CATEGORIES))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [flyNonce, setFlyNonce] = useState(0)
  // On phones the list starts tucked away so the globe is visible.
  const [panelCollapsed, setPanelCollapsed] = useState(() => window.matchMedia('(max-width: 820px)').matches)

  const span = range.to - range.from
  const { events: all, pending, error } = useEvents(range, playing ? span * 3 + 10 : 0)

  // An event picked from search stays on the map even if it isn't among the
  // notable events loaded for this period (or its category is filtered out).
  const [pinned, setPinned] = useState<HistEvent | null>(null)
  const events = useMemo(() => {
    const list = all.filter((e) => enabled.has(e.category))
    if (pinned && pinned.year >= range.from && pinned.year <= range.to && !list.some((e) => e.id === pinned.id)) {
      list.push(pinned)
    }
    return list
  }, [all, enabled, pinned, range.from, range.to])
  const counts = useMemo(() => {
    const c = Object.fromEntries(CATEGORIES.map((k) => [k, 0])) as Record<Category, number>
    for (const e of all) c[e.category]++
    return c
  }, [all])

  // Lead images for the most notable events: globe bubbles, list and tooltips.
  const thumbTitles = useMemo(
    () => [...events].sort((a, b) => b.sitelinks - a.sitelinks).slice(0, THUMB_COUNT).map((e) => e.title),
    [events],
  )
  const thumbVersion = useThumbs(thumbTitles)

  // Keep the selected event even if it scrolls out of the window while playing.
  const [selectedEvent, setSelectedEvent] = useState<HistEvent | null>(null)
  useEffect(() => {
    if (!selectedId) return setSelectedEvent(null)
    const e = events.find((x) => x.id === selectedId) ?? (pinned?.id === selectedId ? pinned : undefined)
    if (e) setSelectedEvent(e)
  }, [selectedId, events, pinned])

  // Play: slide the window forward one step per tick.
  useEffect(() => {
    if (!playing) return
    const step = Math.max(1, Math.round(span / 6))
    const t = setInterval(() => {
      setRange((r) => {
        if (r.to + step > MAX_YEAR) {
          setPlaying(false)
          return { from: MAX_YEAR - (r.to - r.from), to: MAX_YEAR }
        }
        return { from: r.from + step, to: r.to + step }
      })
    }, 1400 / speed)
    return () => clearInterval(t)
  }, [playing, speed, span])

  const select = useCallback((id: string | null, fly = false) => {
    setSelectedId(id)
    if (id) {
      setPanelCollapsed(false)
      if (fly) setFlyNonce((n) => n + 1)
    }
  }, [])

  const pickSearchHit = ({ event, thumbnail }: SearchHit) => {
    if (thumbnail) setThumb(event.title, thumbnail)
    setPlaying(false)
    setPinned(event)
    // Move the window to include the event, keeping its span.
    setRange((r) => {
      if (event.year >= r.from && event.year <= r.to) return r
      const span = r.to - r.from
      const from = Math.max(MIN_YEAR, Math.min(MAX_YEAR - span, event.year - Math.floor(span / 2)))
      return { from, to: from + span }
    })
    select(event.id, true)
  }

  const toggleCategory = (c: Category) =>
    setEnabled((s) => {
      const n = new Set(s)
      if (n.has(c)) n.delete(c)
      else n.add(c)
      return n
    })

  const status = error
    ? 'Wikidata is busy, retrying…'
    : pending
      ? `Loading events… ${events.length ? `(${events.length} so far)` : ''}`
      : `${events.length} events`

  return (
    <div className="app">
      <Globe
        events={events}
        selectedId={selectedId}
        onSelect={(id) => select(id, false)}
        flyNonce={flyNonce}
        thumbVersion={thumbVersion}
      />

      <header className="topbar">
        <Brand />
        <CategoryFilter enabled={enabled} counts={counts} onToggle={toggleCategory} />
      </header>

      <SearchBar onPick={pickSearchHit} />

      <EventPanel
        events={events}
        selected={selectedId ? selectedEvent : null}
        onSelect={select}
        thumbVersion={thumbVersion}
        collapsed={panelCollapsed}
        onToggleCollapsed={() => setPanelCollapsed((c) => !c)}
      />

      <Timeline
        range={range}
        onChange={(r) => setRange(r)}
        playing={playing}
        onTogglePlay={() => setPlaying((p) => !p)}
        speed={speed}
        onSpeed={setSpeed}
        status={status}
        loading={pending > 0}
      />
    </div>
  )
}
