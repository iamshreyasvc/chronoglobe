import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Category, HistEvent, YearRange } from './types'
import { CATEGORIES } from './lib/categories'
import { MAX_YEAR, MIN_YEAR, formatYear } from './lib/years'
import { setThumb } from './lib/wikipedia'
import { INTRO, cellAppear, divideFrom, flowFrom, rememberRect, startIntro } from './lib/intro'
import type { SearchHit } from './lib/search'
import type { Place } from './lib/places'
import { usePlaceEvents } from './hooks/usePlaceEvents'
import { PlaceChip } from './components/PlaceChip'
import { useEvents } from './hooks/useEvents'
import { useThumbs } from './hooks/useThumbs'
import { Timeline } from './components/Timeline'
import { EventPanel } from './components/EventPanel'
import { FilterBubble } from './components/FilterBubble'
import { BrandMenu } from './components/Brand'
import { useAreaEvents } from './hooks/useAreaEvents'
import type { ViewRect } from './lib/area'
import { SearchBar } from './components/SearchBar'

// Cesium is ~4 MB; load it in its own chunk so the interface (and the seed
// events in the list) appear before the globe engine has arrived.
const Globe = lazy(() => import('./components/Globe').then((m) => ({ default: m.Globe })))

/** Search sets a window this many years wide, centered on the event. */
const SEARCH_WINDOW = 10
/** Below this camera height (meters) the map counts as zoomed in. */
const ZOOMED_IN_HEIGHT = 9e6
/** Timeline windows this narrow count as zoomed in too. */
const NARROW_SPAN = 30

const THUMB_COUNT = 150
/** Time each event stays open during a place tour at 1× speed */
const TOUR_DWELL_MS = 3500

/** A window SEARCH_WINDOW years wide centered on `year`. */
function windowAround(year: number): YearRange {
  const from = Math.max(MIN_YEAR, Math.min(MAX_YEAR - SEARCH_WINDOW, year - SEARCH_WINDOW / 2))
  return { from, to: from + SEARCH_WINDOW }
}

export default function App() {
  const [range, setRange] = useState<YearRange>({ from: 1939, to: 1945 })
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [enabled, setEnabled] = useState<Set<Category>>(() => new Set(CATEGORIES))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [flyNonce, setFlyNonce] = useState(0)
  /** Event hovered in the side panel, highlighted on the globe */
  const [hoverId, setHoverId] = useState<string | null>(null)
  // On phones the list starts tucked away so the globe is visible.
  const [panelCollapsed, setPanelCollapsed] = useState(() => window.matchMedia('(max-width: 820px)').matches)

  const span = range.to - range.from

  // Place mode: a place picked from search shows only its events, across all
  // of history, and Play tours them in date order.
  const [place, setPlace] = useState<Place | null>(null)
  const [focus, setFocus] = useState<{ lat: number; lon: number; height: number; nonce: number } | null>(null)
  const rangeBeforePlace = useRef<YearRange | null>(null)
  // The side panel sits below the search column (bar, results, place chip) and
  // follows its height as results open and close.
  const appRef = useRef<HTMLDivElement>(null)
  const stackRef = useRef<HTMLDivElement>(null)

  // Page-load intro, like cells dividing: the logo appears, the search bar
  // divides off it, the side panel and filter bubble divide off the search bar,
  // and once the panel has formed the timeline divides off the panel (see
  // lib/intro.ts). Runs before the first paint so nothing flashes.
  useLayoutEffect(() => {
    if (!startIntro()) return
    const q = (sel: string) => appRef.current?.querySelector(sel) ?? null
    const logo = q('.brand-menu')
    const search = q('.search-bar')
    // Measure every source before any animation moves things.
    const logoRect = logo?.getBoundingClientRect()
    const searchRect = search?.getBoundingClientRect()
    const panel = q('.panel')
    const panelRect = panel?.getBoundingClientRect()
    rememberRect('logo', logoRect)
    rememberRect('search', searchRect)
    cellAppear(logo, INTRO.logo)
    divideFrom(search, logoRect ?? null, INTRO.search)
    // Long bars pour out like a dropdown; small controls bud off as round cells.
    flowFrom(panel, searchRect ?? null, INTRO.panel)
    divideFrom(q('.filter-bubble'), searchRect ?? null, INTRO.filter)
    flowFrom(q('.timeline'), panelRect ?? null, INTRO.timeline)
  }, [])
  useEffect(() => {
    const stack = stackRef.current
    if (!stack) return
    const ro = new ResizeObserver(() => appRef.current?.style.setProperty('--stack-h', `${stack.offsetHeight}px`))
    ro.observe(stack)
    return () => ro.disconnect()
  }, [])
  /** While true, the timeline keeps stretching to cover the place's events as they load */
  const autoFitPlace = useRef(false)
  const { events: placeAll, loading: placeLoading } = usePlaceEvents(place)

  // Notable events come from the bundled seed instantly; live detail loads
  // only once the user zooms in on the map or narrows the timeline.
  const [cameraHeight, setCameraHeight] = useState(Infinity)
  const detail = !place && (cameraHeight < ZOOMED_IN_HEIGHT || span <= NARROW_SPAN)
  const periodData = useEvents(range, detail, playing && !place ? span * 3 + 10 : 0)
  const { seeding, pending, error } = periodData

  // "Load more here": events force-loaded for the area in view.
  const area = useAreaEvents()
  const viewRect = useRef<ViewRect>({ west: -180, south: -90, east: 180, north: 90 })

  const all = useMemo(() => {
    const inRange = (e: HistEvent) => e.year >= range.from && e.year <= range.to
    if (place) return placeAll.filter(inRange)
    if (!area.events.size) return periodData.events
    const byId = new Map(periodData.events.map((e) => [e.id, e]))
    for (const e of area.events.values()) if (inRange(e)) byId.set(e.id, e)
    return [...byId.values()]
  }, [place, placeAll, periodData.events, area.events, range.from, range.to])

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
    for (const e of place ? placeAll : all) c[e.category]++
    return c
  }, [all, place, placeAll])

  /** The place's events in date order, as toured by Play */
  const tour = useMemo(
    () =>
      placeAll
        .filter((e) => enabled.has(e.category))
        .sort((a, b) => a.year - b.year || a.date.localeCompare(b.date)),
    [placeAll, enabled],
  )

  // Stretch the timeline over the place's history as its events arrive.
  useEffect(() => {
    if (!place || !autoFitPlace.current || !tour.length) return
    setRange({ from: Math.max(MIN_YEAR, tour[0].year - 5), to: Math.min(MAX_YEAR, tour[tour.length - 1].year + 5) })
  }, [place, tour])

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
    if (!playing || place) return
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
  }, [playing, speed, span, place])

  const select = useCallback((id: string | null, fly = false) => {
    setSelectedId(id)
    if (id) {
      setPanelCollapsed(false)
      if (fly) setFlyNonce((n) => n + 1)
    }
  }, [])

  // Play in place mode: open each event in date order, jumping the timeline to it.
  const tourIndex = selectedId ? tour.findIndex((e) => e.id === selectedId) : -1
  useEffect(() => {
    if (!playing || !place) return
    if (!tour.length) return
    const show = (i: number) => {
      autoFitPlace.current = false
      setRange(windowAround(tour[i].year))
      select(tour[i].id, true)
    }
    if (tourIndex === -1) return show(0) // start (or restart) from the first event
    const t = setTimeout(() => {
      if (tourIndex + 1 >= tour.length) setPlaying(false)
      else show(tourIndex + 1)
    }, TOUR_DWELL_MS / speed)
    return () => clearTimeout(t)
  }, [playing, place, tour, tourIndex, speed, select])

  const pickPlace = (p: Place) => {
    if (p.thumbnail) setThumb(p.title, p.thumbnail)
    setPlaying(false)
    if (!place) rangeBeforePlace.current = range
    autoFitPlace.current = true
    setPinned(null)
    setPlace(p)
    select(null)
    setFocus({
      lat: p.lat,
      lon: p.lon,
      height: Math.min(1.2e7, Math.max(1.5e5, p.radiusKm * 1000 * 4)),
      nonce: Date.now(),
    })
  }

  const exitPlace = useCallback(() => {
    setPlace(null)
    setPlaying(false)
    select(null)
    if (rangeBeforePlace.current) setRange(rangeBeforePlace.current)
    rangeBeforePlace.current = null
  }, [select])

  // Esc leaves place mode (unless a photo viewer or text field has the key).
  useEffect(() => {
    if (!place) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.lightbox')) return
      if ((document.activeElement as HTMLElement | null)?.tagName === 'INPUT') return
      exitPlace()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [place, exitPlace])

  const pickSearchHit = ({ event, thumbnail }: SearchHit) => {
    if (thumbnail) setThumb(event.title, thumbnail)
    if (place) exitPlace()
    setPlaying(false)
    setPinned(event)
    // Focus the timeline on a 10-year window around the event.
    setRange(windowAround(event.year))
    select(event.id, true)
  }

  const toggleCategory = (c: Category) =>
    setEnabled((s) => {
      const n = new Set(s)
      if (n.has(c)) n.delete(c)
      else n.add(c)
      return n
    })

  const loadHere = () => area.load(viewRect.current, range, new Set(all.map((e) => e.id)))
  const areaNote =
    area.loading || area.lastAdded === null
      ? ''
      : area.lastAdded < 0
        ? " · couldn't load this area"
        : area.lastAdded === 0
          ? ' · nothing new here'
          : ` · +${area.lastAdded} here`

  const status = place
    ? placeLoading
      ? `${events.length} events · finding more in ${place.title}…`
      : `${events.length} of ${tour.length} events in ${place.title}`
    : seeding
    ? 'Loading events…'
    : error
      ? `${events.length} events · Wikidata busy`
      : pending
        ? `${events.length} events · loading more…`
        : area.loading
          ? `${events.length} events · loading this area…`
          : detail
            ? `${events.length} events${areaNote}`
            : `${events.length} notable events${areaNote || ' · zoom in for more'}`

  return (
    <div ref={appRef} className={`app${place ? ' has-place' : ''}`}>
      <Suspense fallback={<div className="globe globe-loading" />}>
        <Globe
          events={events}
          selectedId={selectedId}
          onSelect={(id) => select(id, false)}
          flyNonce={flyNonce}
          thumbVersion={thumbVersion}
          onCameraHeight={setCameraHeight}
          focus={focus}
          highlightId={hoverId}
          onViewChange={(r) => (viewRect.current = r)}
        />
      </Suspense>

      <header className="topbar">
        <BrandMenu info={{ eventsShown: events.length, eventsKnown: all.length }} />
      </header>

      <FilterBubble
        enabled={enabled}
        counts={counts}
        onToggle={toggleCategory}
        onShowAll={() => setEnabled(new Set(CATEGORIES))}
      />

      <div className="search-stack" ref={stackRef}>
        <SearchBar onPick={pickSearchHit} onPickPlace={pickPlace} />
        {place && (
        <PlaceChip
          place={place}
          total={tour.length}
          loading={placeLoading}
          position={tourIndex >= 0 ? tourIndex + 1 : null}
          playing={playing}
          onExit={exitPlace}
        />
        )}
      </div>

      <EventPanel
        events={events}
        title={place ? `${place.title} through history` : undefined}
        subtitle={`${formatYear(range.from)} – ${formatYear(range.to)} · ${events.length} event${events.length === 1 ? '' : 's'}`}
        onHover={setHoverId}
        chronological={!!place}
        selected={selectedId ? selectedEvent : null}
        onSelect={select}
        thumbVersion={thumbVersion}
        collapsed={panelCollapsed}
        onToggleCollapsed={() => setPanelCollapsed((c) => !c)}
      />

      <Timeline
        range={range}
        onChange={(r) => {
          autoFitPlace.current = false
          setRange(r)
        }}
        marks={place ? tour.map((e) => e.year) : undefined}
        activeMark={place && tourIndex >= 0 ? tour[tourIndex].year : undefined}
        playing={playing}
        onTogglePlay={() => setPlaying((p) => !p)}
        speed={speed}
        onSpeed={setSpeed}
        status={status}
        loading={place ? placeLoading : seeding || pending > 0 || area.loading}
        onLoadArea={place ? undefined : loadHere}
        areaLoading={area.loading}
      />
    </div>
  )
}
