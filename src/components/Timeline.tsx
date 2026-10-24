import { useEffect, useRef, useState } from 'react'
import type { YearRange } from '../types'
import {
  ERAS,
  MAX_YEAR,
  MIN_YEAR,
  TICKS,
  clampYear,
  formatYear,
  parseYearInput,
  posToYear,
  yearToPos,
} from '../lib/years'

interface Props {
  range: YearRange
  onChange: (r: YearRange) => void
  playing: boolean
  onTogglePlay: () => void
  speed: number
  onSpeed: (s: number) => void
  status: string
  loading: boolean
  /** Years to tick on the track (a place's events) */
  marks?: number[]
  /** Year of the tick to highlight */
  activeMark?: number
  /** "Load more here": force-load events in the area in view */
  onLoadArea?: () => void
  areaLoading?: boolean
}

type Drag = { kind: 'from' | 'to' } | { kind: 'move'; startYear: number; orig: YearRange }

const SPEEDS = [0.5, 1, 2, 4]

function YearField({ value, onCommit, label }: { value: number; onCommit: (y: number) => void; label: string }) {
  const [text, setText] = useState<string | null>(null)
  const commit = () => {
    if (text === null) return
    const y = parseYearInput(text)
    if (y !== null) onCommit(clampYear(y))
    setText(null)
  }
  return (
    <input
      className="year-field"
      aria-label={label}
      value={text ?? formatYear(value)}
      onFocus={(e) => {
        setText(formatYear(value))
        requestAnimationFrame(() => e.target.select())
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setText(null)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}

/** Glass bubble showing the current speed; expands on hover (or tap) to show every option. */
function SpeedPicker({ speed, onSpeed }: { speed: number; onSpeed: (s: number) => void }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [open])

  return (
    <div
      ref={rootRef}
      className={`glass speed-picker${open ? ' is-open' : ''}`}
      role="radiogroup"
      aria-label="Playback speed"
      onPointerEnter={(e) => e.pointerType === 'mouse' && setOpen(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setOpen(false)}
    >
      {SPEEDS.map((s) => (
        <button
          key={s}
          role="radio"
          aria-checked={s === speed}
          className={`speed-opt${s === speed ? ' is-on' : ''}`}
          onFocus={() => setOpen(true)}
          onClick={() => {
            // Touch: the first tap opens the picker, the next one chooses.
            if (!open) return setOpen(true)
            onSpeed(s)
          }}
        >
          {s}×
        </button>
      ))}
    </div>
  )
}

export function Timeline({ range, onChange, playing, onTogglePlay, speed, onSpeed, status, loading, marks, activeMark, onLoadArea, areaLoading }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)

  const yearAt = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect()
    return posToYear((clientX - r.left) / r.width)
  }

  const onPointerDown = (kind: 'from' | 'to' | 'move') => (e: React.PointerEvent) => {
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = kind === 'move' ? { kind, startYear: yearAt(e.clientX), orig: range } : { kind }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const y = yearAt(e.clientX)
    if (d.kind === 'from') onChange({ from: Math.min(y, range.to - 1), to: range.to })
    else if (d.kind === 'to') onChange({ from: range.from, to: Math.max(y, range.from + 1) })
    else if (d.kind === 'move') {
      const span = d.orig.to - d.orig.from
      let from = d.orig.from + (y - d.startYear)
      from = Math.max(MIN_YEAR, Math.min(MAX_YEAR - span, from))
      onChange({ from, to: from + span })
    }
  }

  const onTrackDown = (e: React.PointerEvent) => {
    // Click on the bare track: center the current window there.
    const y = yearAt(e.clientX)
    const span = range.to - range.from
    const from = Math.max(MIN_YEAR, Math.min(MAX_YEAR - span, Math.round(y - span / 2)))
    onChange({ from, to: from + span })
  }

  const keyStep = (which: 'from' | 'to') => (e: React.KeyboardEvent) => {
    const step = (e.shiftKey ? 10 : 1) * (e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0)
    if (!step) return
    e.preventDefault()
    if (which === 'from') onChange({ from: clampYear(Math.min(range.from + step, range.to - 1)), to: range.to })
    else onChange({ from: range.from, to: clampYear(Math.max(range.to + step, range.from + 1)) })
  }

  const pFrom = yearToPos(range.from) * 100
  const pTo = yearToPos(range.to) * 100

  return (
    <div className="glass timeline">
      <div className="timeline-top">
        <button
          className={`glass tl-btn play-button${playing ? ' is-playing' : ''}`}
          onClick={onTogglePlay}
          aria-label={playing ? 'Pause' : 'Play through time'}
        >
          {playing ? (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.5" /><rect x="14" y="5" width="4" height="14" rx="1.5" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" /></svg>
          )}
        </button>

        <div className="range-readout">
          <YearField label="Start year" value={range.from} onCommit={(y) => onChange({ from: Math.min(y, range.to - 1), to: range.to })} />
          <span className="range-dash">—</span>
          <YearField label="End year" value={range.to} onCommit={(y) => onChange({ from: range.from, to: Math.max(y, range.from + 1) })} />
        </div>

        <div className="timeline-status">
          {loading && <span className="spinner" aria-hidden />}
          <span className="status-text">{status}</span>
        </div>
        {onLoadArea && (
          <button
            className={`glass tl-btn tl-expand${areaLoading ? ' is-busy' : ''}`}
            onClick={onLoadArea}
            disabled={areaLoading}
            aria-label="Load more events in the area you're viewing"
          >
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={areaLoading ? 'spin' : ''} aria-hidden>
              <path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5" />
            </svg>
            <span className="tl-label">{areaLoading ? 'Loading this area…' : 'Load more here'}</span>
          </button>
        )}

        <SpeedPicker speed={speed} onSpeed={onSpeed} />
      </div>

      <div className="track-wrap" onPointerMove={onPointerMove} onPointerUp={() => (drag.current = null)}>
        <div className="track" ref={trackRef} onPointerDown={onTrackDown}>
          {ERAS.map((era) => (
            <div
              key={era.name}
              className="era"
              style={{ left: `${yearToPos(era.from) * 100}%`, width: `${(yearToPos(era.to) - yearToPos(era.from)) * 100}%` }}
            >
              <span>{era.name}</span>
            </div>
          ))}
          {marks?.map((y, i) => (
            <span
              key={i}
              className={`mark${y === activeMark ? ' is-active' : ''}`}
              style={{ left: `${yearToPos(y) * 100}%` }}
            />
          ))}
          <div className="selection" style={{ left: `${pFrom}%`, width: `${Math.max(pTo - pFrom, 0.4)}%` }} onPointerDown={onPointerDown('move')} />
          <div
            className="handle"
            style={{ left: `${pFrom}%` }}
            role="slider"
            tabIndex={0}
            aria-label="Start year"
            aria-valuemin={MIN_YEAR}
            aria-valuemax={MAX_YEAR}
            aria-valuenow={range.from}
            aria-valuetext={formatYear(range.from)}
            onPointerDown={onPointerDown('from')}
            onKeyDown={keyStep('from')}
          />
          <div
            className="handle"
            style={{ left: `${pTo}%` }}
            role="slider"
            tabIndex={0}
            aria-label="End year"
            aria-valuemin={MIN_YEAR}
            aria-valuemax={MAX_YEAR}
            aria-valuenow={range.to}
            aria-valuetext={formatYear(range.to)}
            onPointerDown={onPointerDown('to')}
            onKeyDown={keyStep('to')}
          />
        </div>
        <div className="ticks">
          {TICKS.map((t) => (
            <span key={t} style={{ left: `${yearToPos(t) * 100}%` }}>
              {t <= 0 ? `${1 - t} BC` : t === 1 ? '1 AD' : t}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
