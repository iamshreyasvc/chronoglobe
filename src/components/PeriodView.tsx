import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Category, HistEvent } from '../types'
import { CATEGORIES, CATEGORY_META } from '../lib/categories'
import { fetchSummary, getThumb, type WikiSummary } from '../lib/wikipedia'
import { formatEventDate, formatYear } from '../lib/years'
import { useThumbs } from '../hooks/useThumbs'

interface Props {
  events: HistEvent[]
  title: string
  subtitle: string
  chronological?: boolean
  onSelect: (id: string, fly: boolean) => void
  onHover: (id: string | null) => void
}

const LIST_LIMIT = 150
const SPOTLIGHT_COUNT = 8
const SPOTLIGHT_MS = 7000
const GEM_COUNT = 10

const NO_TITLES: string[] = []

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Small deterministic PRNG so "hidden gems" are stable until reshuffled. */
function seeded(seed: number) {
  let s = seed >>> 0 || 1
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

function hashIds(events: HistEvent[]): number {
  let h = 2166136261
  for (const e of events) for (let i = 0; i < e.id.length; i++) h = Math.imul(h ^ e.id.charCodeAt(i), 16777619)
  return h >>> 0
}

function firstSentences(text: string, max = 260): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '))
  return end > 80 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`
}

// ---------- Spotlight: auto-cycling feature of the period's headline events ----------

function Spotlight({ events, onSelect, onHover }: { events: HistEvent[]; onSelect: Props['onSelect']; onHover: Props['onHover'] }) {
  const key = events.map((e) => e.id).join(',')
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [summaries, setSummaries] = useState<Record<string, WikiSummary>>({})
  const auto = useRef(!prefersReducedMotion())

  useEffect(() => setIndex(0), [key])

  const current = events[Math.min(index, events.length - 1)]
  const next = events[(index + 1) % events.length]

  // Load the current slide's summary and prefetch the next one.
  useEffect(() => {
    for (const e of [current, next]) {
      if (!e || summaries[e.id]) continue
      fetchSummary(e.title).then(
        (s) => setSummaries((m) => ({ ...m, [e.id]: s })),
        () => {},
      )
    }
  }, [current, next, summaries])

  if (!current) return null
  const summary = summaries[current.id]
  const image = summary?.image ?? getThumb(current.title) ?? undefined
  const meta = CATEGORY_META[current.category]
  const go = (i: number) => setIndex((i + events.length) % events.length)

  return (
    <section
      className={`spotlight${paused ? ' is-paused' : ''}`}
      aria-roledescription="carousel"
      aria-label="Spotlight"
      onPointerEnter={() => {
        setPaused(true)
        onHover(current.id)
      }}
      onPointerLeave={() => {
        setPaused(false)
        onHover(null)
      }}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <button key={current.id} className="spotlight-slide" onClick={() => onSelect(current.id, true)} style={{ '--cat': meta.color } as React.CSSProperties}>
        {image && <img src={image} alt="" className="spotlight-img" />}
        <span className="spotlight-shade" />
        <span className="spotlight-label">Spotlight</span>
        <span className="spotlight-text">
          <span className="pills">
            <span className="pill" style={{ '--chip': meta.color } as React.CSSProperties}>
              <span className="dot" />
              {meta.label}
            </span>
            <span className="pill">{formatEventDate(current.date, current.year)}</span>
          </span>
          <strong>{current.title}</strong>
          <span className="spotlight-extract">
            {summary ? firstSentences(summary.extract) : <span className="skeleton-line" />}
          </span>
        </span>
      </button>
      {events.length > 1 && (
        <div className="spotlight-controls">
          <button className="spotlight-arrow" onClick={() => go(index - 1)} aria-label="Previous">
            ‹
          </button>
          <div className="spotlight-dots" role="tablist">
            {events.map((e, i) => (
              <button
                key={e.id}
                role="tab"
                aria-selected={i === index}
                aria-label={e.title}
                className={`spotlight-dot${i === index ? ' is-active' : ''}`}
                onClick={() => go(i)}
              >
                {i === index && auto.current && (
                  <span
                    key={`${key}:${index}`}
                    className="spotlight-progress"
                    style={{ animationDuration: `${SPOTLIGHT_MS}ms` }}
                    onAnimationEnd={() => go(index + 1)}
                  />
                )}
              </button>
            ))}
          </div>
          <button className="spotlight-arrow" onClick={() => go(index + 1)} aria-label="Next">
            ›
          </button>
        </div>
      )}
    </section>
  )
}

// ---------- Hidden gems: lesser-known events with photos ----------

function HiddenGems({ events, onSelect, onHover }: { events: HistEvent[]; onSelect: Props['onSelect']; onHover: Props['onHover'] }) {
  const [shuffle, setShuffle] = useState(0)
  const candidates = useMemo(() => {
    // Skip the headline events; sample the rest.
    const rest = [...events].sort((a, b) => b.sitelinks - a.sitelinks).slice(12)
    const rand = seeded(hashIds(rest) + shuffle * 7919)
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[rest[i], rest[j]] = [rest[j], rest[i]]
    }
    return rest.slice(0, 40)
  }, [events, shuffle])
  const titles = useMemo(() => candidates.map((e) => e.title), [candidates])
  useThumbs(titles)
  const gems = candidates.filter((e) => getThumb(e.title)).slice(0, GEM_COUNT)
  // Gems appear as their photos load, sometimes ahead of ones already shown;
  // keep the row at its start so the first card lines up with the Spotlight.
  const rowRef = useRef<HTMLDivElement>(null)
  const gemKey = gems.map((e) => e.id).join()
  useLayoutEffect(() => {
    if (rowRef.current) rowRef.current.scrollLeft = 0
  }, [gemKey])
  if (gems.length < 3) return null

  return (
    <section className="gems">
      <header className="section-head">
        <h3>Hidden gems</h3>
        <button className="glass-chip section-action" onClick={() => setShuffle((s) => s + 1)} aria-label="Show other hidden gems">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
          </svg>
          Shuffle
        </button>
      </header>
      <div className="gem-row" ref={rowRef}>
        {gems.map((e) => (
          <button
            key={e.id}
            className="gem"
            onClick={() => onSelect(e.id, true)}
            onPointerEnter={() => onHover(e.id)}
            onPointerLeave={() => onHover(null)}
            style={{ '--chip': CATEGORY_META[e.category].color } as React.CSSProperties}
          >
            <span className="gem-img">
              <img src={getThumb(e.title)!} alt="" loading="lazy" />
            </span>
            <strong>{e.title}</strong>
            <span className="muted">{formatYear(e.year)}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

// ---------- Category mix ----------

function CategoryMix({ events }: { events: HistEvent[] }) {
  const counts = useMemo(() => {
    const c = new Map<Category, number>()
    for (const e of events) c.set(e.category, (c.get(e.category) ?? 0) + 1)
    return CATEGORIES.filter((k) => c.get(k)).map((k) => [k, c.get(k)!] as const).sort((a, b) => b[1] - a[1])
  }, [events])
  if (!counts.length) return null
  const total = events.length
  return (
    <section className="mix" aria-label="What this period is made of">
      <div className="mix-bar">
        {counts.map(([k, n]) => (
          <span
            key={k}
            className="mix-seg"
            style={{ flexGrow: n, background: CATEGORY_META[k].color }}
            title={`${CATEGORY_META[k].label}: ${n}`}
          />
        ))}
      </div>
      <p className="mix-legend">
        {counts.slice(0, 3).map(([k, n]) => (
          <span key={k}>
            <span className="dot" style={{ '--chip': CATEGORY_META[k].color } as React.CSSProperties} />
            {Math.round((n / total) * 100)}% {CATEGORY_META[k].label.toLowerCase()}
          </span>
        ))}
      </p>
    </section>
  )
}

// ---------- the list ----------

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
  return `${n}${s}`
}

function centuryLabel(year: number): string {
  if (year <= 0) return `${ordinal(Math.floor(-year / 100) + 1)} century BCE`
  return `${ordinal(Math.floor((year - 1) / 100) + 1)} century`
}

export function PeriodView({ events, title, subtitle, chronological, onSelect, onHover }: Props) {
  const [sort, setSort] = useState<'notable' | 'timeline'>(chronological ? 'timeline' : 'notable')
  useEffect(() => setSort(chronological ? 'timeline' : 'notable'), [chronological])

  const byNotability = useMemo(() => [...events].sort((a, b) => b.sitelinks - a.sitelinks), [events])
  // Prefer headline events that have photos. Thumbnails arrive over time, so
  // re-pick until enough have photos, then keep the pick stable for the period.
  const thumbVersion = useThumbs(NO_TITLES)
  const pick = useRef<{ events: HistEvent[]; spotlight: HistEvent[]; settled: boolean } | null>(null)
  const spotlight = useMemo(() => {
    if (pick.current?.events === events && pick.current.settled) return pick.current.spotlight
    const withPhotos = byNotability.filter((e) => getThumb(e.title))
    const settled = withPhotos.length >= Math.min(SPOTLIGHT_COUNT, byNotability.length)
    const chosen = (withPhotos.length >= 3 ? withPhotos : byNotability).slice(0, SPOTLIGHT_COUNT)
    const same = pick.current?.spotlight.map((e) => e.id).join() === chosen.map((e) => e.id).join()
    pick.current = { events, spotlight: same ? pick.current!.spotlight : chosen, settled }
    return pick.current.spotlight
  }, [events, byNotability, thumbVersion])

  const list = useMemo(() => {
    const l = sort === 'timeline' ? [...events].sort((a, b) => a.year - b.year || a.date.localeCompare(b.date)) : byNotability
    return l.slice(0, LIST_LIMIT)
  }, [events, byNotability, sort])

  // Timeline headers: years for short spans, centuries for long ones.
  const yearsSpan = list.length ? list[list.length - 1].year - list[0].year : 0
  const groupOf = (e: HistEvent) => (yearsSpan > 150 ? centuryLabel(e.year) : formatYear(e.year))

  return (
    <div className="list-view">
      <header className="list-header">
        <h2>{title}</h2>
        <p className="muted">{subtitle}</p>
      </header>

      {events.length === 0 ? (
        <div className="empty">
          <div className="empty-bubble">🌍</div>
          <p className="muted">No events here yet. Widen the timeline or wait for results to load.</p>
        </div>
      ) : (
        <>
          <Spotlight events={spotlight} onSelect={onSelect} onHover={onHover} />
          <CategoryMix events={events} />
          <HiddenGems events={events} onSelect={onSelect} onHover={onHover} />

          <section className="all-events">
            <header className="section-head">
              <h3>All events</h3>
              <div className="segmented" role="radiogroup" aria-label="Sort events">
                {(['notable', 'timeline'] as const).map((s) => (
                  <button key={s} role="radio" aria-checked={sort === s} className={sort === s ? 'is-on' : ''} onClick={() => setSort(s)}>
                    {s === 'notable' ? 'Notable' : 'Timeline'}
                  </button>
                ))}
              </div>
            </header>
            <ul className="event-list">
              {list.map((e, i) => {
                const thumb = getThumb(e.title)
                const color = CATEGORY_META[e.category].color
                const group = sort === 'timeline' ? groupOf(e) : null
                const showGroup = group && (i === 0 || groupOf(list[i - 1]) !== group)
                return (
                  <li key={e.id}>
                    {showGroup && <p className="list-group">{group}</p>}
                    <button
                      className="event-card"
                      onClick={() => onSelect(e.id, true)}
                      onPointerEnter={() => onHover(e.id)}
                      onPointerLeave={() => onHover(null)}
                      onFocus={() => onHover(e.id)}
                      onBlur={() => onHover(null)}
                    >
                      <span className="thumb-bubble" style={{ '--chip': color } as React.CSSProperties}>
                        {thumb ? <img src={thumb} alt="" loading="lazy" /> : <span className="dot" />}
                      </span>
                      <span className="event-card-text">
                        <strong>{e.title}</strong>
                        <span className="muted">
                          {formatYear(e.year)} · {CATEGORY_META[e.category].label}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
            {events.length > LIST_LIMIT && (
              <p className="muted list-more">Showing {LIST_LIMIT} of {events.length}. Narrow the timeline to see the rest.</p>
            )}
          </section>
        </>
      )}
    </div>
  )
}
