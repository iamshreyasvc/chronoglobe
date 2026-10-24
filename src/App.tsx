import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Category, YearRange } from './types'
import { CATEGORIES } from './lib/categories'
import { MAX_YEAR } from './lib/years'
import { useEvents } from './hooks/useEvents'
import { useThumbs } from './hooks/useThumbs'
import { Globe } from './components/Globe'
import { Timeline } from './components/Timeline'
import { EventPanel } from './components/EventPanel'
import { CategoryFilter } from './components/CategoryFilter'

const THUMB_COUNT = 150

export default function App() {
  const [range, setRange] = useState<YearRange>({ from: 1939, to: 1945 })
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [enabled, setEnabled] = useState<Set<Category>>(() => new Set(CATEGORIES))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [flyNonce, setFlyNonce] = useState(0)
  const [panelCollapsed, setPanelCollapsed] = useState(false)

  const span = range.to - range.from
  const { events: all, pending, error } = useEvents(range, playing ? span * 3 + 10 : 0)

  const events = useMemo(() => all.filter((e) => enabled.has(e.category)), [all, enabled])
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
  const [selectedEvent, setSelectedEvent] = useState<(typeof all)[number] | null>(null)
  useEffect(() => {
    if (!selectedId) return setSelectedEvent(null)
    const e = all.find((x) => x.id === selectedId)
    if (e) setSelectedEvent(e)
  }, [selectedId, all])

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
        <div className="glass brand">
          <span className="brand-orb" />
          <div>
            <h1>Chronoglobe</h1>
            <p>History from Wikipedia, mapped</p>
          </div>
        </div>
        <CategoryFilter enabled={enabled} counts={counts} onToggle={toggleCategory} />
      </header>

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
