import { useEffect, useRef, useState } from 'react'
import { CATEGORY_META } from '../lib/categories'
import { searchEvents, type SearchHit } from '../lib/search'
import { formatYear } from '../lib/years'

interface Props {
  onPick: (hit: SearchHit) => void
}

export function SearchBar({ onPick }: Props) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
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
      searchEvents(term, ctrl.signal).then(
        (h) => {
          setHits(h)
          setActive(0)
          setStatus('done')
        },
        (e) => {
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

  const pick = (h: SearchHit) => {
    onPick(h)
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
          placeholder="Search any historical event…"
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
          {hits.map((h, i) => {
            const meta = CATEGORY_META[h.event.category]
            return (
              <button
                key={h.event.id}
                role="option"
                aria-selected={i === active}
                className={`search-hit${i === active ? ' is-active' : ''}`}
                onPointerEnter={() => setActive(i)}
                onClick={() => pick(h)}
              >
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
            )
          })}
        </div>
      )}
    </div>
  )
}
