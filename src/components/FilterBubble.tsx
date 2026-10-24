import { useEffect, useRef, useState } from 'react'
import type { Category } from '../types'
import { CATEGORIES } from '../lib/categories'
import { CategoryFilter } from './CategoryFilter'

interface Props {
  enabled: Set<Category>
  counts: Record<Category, number>
  onToggle: (c: Category) => void
  onShowAll: () => void
}

/**
 * Round glass button beside the globe button that expands sideways into a
 * capsule of category pills. A badge shows how many categories are hidden.
 */
export function FilterBubble({ enabled, counts, onToggle, onShowAll }: Props) {
  const [open, setOpen] = useState(false)
  /** Opened by a click (stays open) rather than by hovering (closes on leave) */
  const [pinned, setPinned] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const close = () => {
    setOpen(false)
    setPinned(false)
  }
  const hidden = CATEGORIES.length - enabled.size

  // Close on outside click or Esc.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div
      ref={rootRef}
      className={`glass filter-bubble${open ? ' is-open' : ''}`}
      // Mouse: open on hover, close shortly after leaving unless pinned by a click.
      onPointerEnter={(e) => {
        if (e.pointerType !== 'mouse') return
        clearTimeout(closeTimer.current)
        setOpen(true)
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== 'mouse' || pinned) return
        closeTimer.current = setTimeout(() => setOpen(false), 350)
      }}
    >
      <div
        className="filter-tray"
        aria-hidden={!open}
        inert={!open || undefined}
        // A mouse wheel scrolls the pills sideways.
        onWheel={(e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY
        }}
      >
        <CategoryFilter enabled={enabled} counts={counts} onToggle={onToggle} />
        {hidden > 0 && (
          <button className="glass-chip filter-reset" onClick={onShowAll}>
            Show all
          </button>
        )}
      </div>
      <button
        className="filter-toggle"
        onClick={() => {
          // Click pins it open (or closes it if it was already pinned).
          if (open && pinned) close()
          else {
            setOpen(true)
            setPinned(true)
          }
        }}
        aria-expanded={open}
        aria-label={open ? 'Close category filters' : 'Filter event categories'}
        title="Filter categories"
      >
        {open ? (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
            <circle cx="16" cy="7" r="2.2" />
            <circle cx="10" cy="17" r="2.2" />
          </svg>
        )}
        {!open && hidden > 0 && <span className="filter-badge">{hidden}</span>}
      </button>
    </div>
  )
}
