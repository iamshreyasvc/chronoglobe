import { useEffect, useRef, useState } from 'react'
import { CATEGORY_META } from '../lib/categories'
import { searchAll, type SearchHit } from '../lib/search'
import type { Place } from '../lib/places'
import { formatYear } from '../lib/years'

interface Props {
  onPick: (hit: SearchHit) => void
  onPickPlace: (place: Place) => void
}

type Result = { kind: 'place'; place: Place } | { kind: 'event'; hit: SearchHit }

const PLACE_KIND: Record<string, string> = {
  city: 'City',
  country: 'Country',
  adm1st: 'Region',
  adm2nd: 'Region',
  adm3rd: 'District',
  landmark: 'Landmark',
  isle: 'Island',
  mountain: 'Mountain',
  waterbody: 'Water',
}

export function SearchBar({ onPick, onPickPlace }: Props) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Result[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) {
      setHits([])
      setStatus('idle')
      return
    }
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      setStatus('loading')
      searchAll(term, ctrl.signal).then(
        ({ places, events }) => {
          setHits([
            ...places.map((place): Result => ({ kind: 'place', place })),
            ...events.map((hit): Result => ({ kind: 'event', hit })),
          ])
          setActive(0)
          setStatus('done')
        },
        (e: Error) => {
          if (e.name !== 'AbortError') setStatus('error')
        },
      )
    }, 320)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [q])

  // Close when clicking anywhere else.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [])

  // "/" focuses search, like many map apps.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const pick = (r: Result) => {
    if (r.kind === 'place') onPickPlace(r.place)
    else onPick(r.hit)
    setOpen(false)
    inputRef.current?.blur()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, hits.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && hits[active]) {
      pick(hits[active])
    } else if (e.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  const showDropdown = open && q.trim().length >= 2

  return (
    <div className="search-root" ref={rootRef}>
      <div className="glass search-bar">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          ref={inputRef}
          value={q}
          placeholder="Search events or places…"
          aria-label="Search historical events"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls="search-results"
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {status === 'loading' && <span className="spinner" aria-hidden />}
        {q && status !== 'loading' && (
          <button className="search-clear" onClick={() => { setQ(''); inputRef.current?.focus() }} aria-label="Clear search">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        )}
      </div>

      {showDropdown && (status === 'done' || status === 'error' || hits.length > 0) && (
        <div className="glass search-results" id="search-results" role="listbox">
          {status === 'error' && <p className="search-note">Search is unavailable right now.</p>}
          {status === 'done' && hits.length === 0 && (
            <p className="search-note">No dated, mappable events found for “{q.trim()}”.</p>
          )}
          {hits.map((r, i) => {
            const header =
              i === 0 || r.kind !== hits[i - 1].kind ? (
                <p className="search-section">{r.kind === 'place' ? 'Places · explore their history' : 'Events'}</p>
              ) : null
            const common = {
              role: 'option',
              'aria-selected': i === active,
              className: `search-hit${i === active ? ' is-active' : ''}`,
              onPointerEnter: () => setActive(i),
              onClick: () => pick(r),
            } as const
            if (r.kind === 'place') {
              const p = r.place
              return (
                <div key={`p${p.id}`} className="search-group">
                  {header}
                  <button {...common}>
                    <span className="thumb-bubble place-bubble">
                      {p.thumbnail ? <img src={p.thumbnail} alt="" /> : <PinIcon />}
                      {p.thumbnail && <span className="place-pin"><PinIcon /></span>}
                    </span>
                    <span className="search-hit-text">
                      <strong>{p.title}</strong>
                      <span className="muted">
                        {[p.kind && PLACE_KIND[p.kind], p.description].filter(Boolean).join(' · ') || 'Place'}
                      </span>
                    </span>
                  </button>
                </div>
              )
            }
            const h = r.hit
            const meta = CATEGORY_META[h.event.category]
            return (
              <div key={`e${h.event.id}`} className="search-group">
                {header}
                <button {...common}>
                  <span className="thumb-bubble" style={{ '--chip': meta.color } as React.CSSProperties}>
                    {h.thumbnail ? <img src={h.thumbnail} alt="" /> : <span className="dot" />}
                  </span>
                  <span className="search-hit-text">
                    <strong>{h.event.title}</strong>
                    <span className="muted">
                      {formatYear(h.event.year)}
                      {h.description ? ` · ${h.description}` : ''}
                    </span>
                  </span>
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
      <path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />
    </svg>
  )
}
