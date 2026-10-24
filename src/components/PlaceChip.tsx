import type { Place } from '../lib/places'

interface Props {
  place: Place
  /** Events at the place (after category filters) */
  total: number
  loading: boolean
  /** 1-based position of the open event in the tour, if any */
  position: number | null
  playing: boolean
  onExit: () => void
}

/** Glass pill shown while exploring a place: "📍 Paris · 115 events ✕". */
export function PlaceChip({ place, total, loading, position, playing, onExit }: Props) {
  return (
    <div className="glass place-chip" role="status">
      <span className="place-chip-pin" aria-hidden>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
          <path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />
        </svg>
      </span>
      <span className="place-chip-text">
        <strong>{place.title}</strong>
        <span className="muted">
          {position ? `${position} / ${total}` : `${total} event${total === 1 ? '' : 's'}`}
          {loading ? ' · finding more' : playing ? ' · touring' : position ? '' : ' · press play for a tour'}
        </span>
      </span>
      {loading && <span className="spinner" aria-hidden />}
      <button className="search-clear" onClick={onExit} aria-label={`Stop exploring ${place.title}`} title="Back to all events (Esc)">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  )
}
