import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { HistEvent } from '../types'
import { CATEGORY_META } from '../lib/categories'
import { fetchMedia, fetchSummary, getThumb, type WikiImage, type WikiSummary } from '../lib/wikipedia'
import { formatEventDate } from '../lib/years'
import { PeriodView } from './PeriodView'

interface Props {
  events: HistEvent[]
  /** List heading; defaults to "In this period" */
  title?: string
  /** Line under the heading, e.g. "1939 – 1945 · 306 events" */
  subtitle: string
  /** Sort by date instead of notability */
  chronological?: boolean
  /** Hovering an event in the list highlights it on the globe */
  onHover: (id: string | null) => void
  selected: HistEvent | null
  onSelect: (id: string | null, fly: boolean) => void
  thumbVersion: number
  collapsed: boolean
  onToggleCollapsed: () => void
}

function Detail({ event, onClose }: { event: HistEvent; onClose: () => void }) {
  const [summary, setSummary] = useState<WikiSummary | null>(null)
  const [media, setMedia] = useState<WikiImage[]>([])
  const [error, setError] = useState(false)
  const [lightbox, setLightbox] = useState<number | null>(null)

  useEffect(() => {
    let live = true
    setSummary(null)
    setMedia([])
    setError(false)
    fetchSummary(event.title).then((s) => live && setSummary(s), () => live && setError(true))
    fetchMedia(event.title).then((m) => live && setMedia(m), () => {})
    return () => {
      live = false
    }
  }, [event.title])

  const meta = CATEGORY_META[event.category]
  const hero = summary?.image ?? getThumb(event.title) ?? undefined
  // Gallery = article photos, minus the hero if it repeats.
  const gallery = useMemo(() => {
    const heroFile = hero ? decodeURIComponent(hero.split('/').pop()!.replace(/^\d+px-/, '')) : null
    return media.filter((m) => !heroFile || !decodeURIComponent(m.src).includes(`/${heroFile}/`))
  }, [media, hero])

  useEffect(() => {
    if (lightbox === null) return
    const n = gallery.length || 1
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null)
      if (e.key === 'ArrowRight') setLightbox((i) => (i === null ? i : (i + 1) % n))
      if (e.key === 'ArrowLeft') setLightbox((i) => (i === null ? i : (i - 1 + n) % n))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox, gallery.length])

  return (
    <article className="detail">
      <div className={`hero${hero ? '' : ' hero-empty'}`} style={{ '--cat': meta.color } as React.CSSProperties}>
        {hero && <img src={hero} alt="" className="hero-img" />}
        <div className="hero-shade" />
        <button className="glass-button close-button" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        <div className="hero-text">
          <div className="pills">
            <span className="pill" style={{ '--chip': meta.color } as React.CSSProperties}>
              <span className="dot" />
              {meta.label}
            </span>
            <span className="pill">{formatEventDate(event.date, event.year)}</span>
          </div>
          <h2>{event.title}</h2>
          {summary?.description && <p className="hero-desc">{summary.description}</p>}
        </div>
      </div>

      <div className="detail-body">
        {!summary && !error && (
          <div className="skeleton">
            <span /><span /><span />
          </div>
        )}
        {error && <p className="muted">Couldn't load the Wikipedia summary.</p>}
        {summary && <p className="extract">{summary.extract}</p>}

        {gallery.length > 0 && (
          <div className="gallery" aria-label="Images from the article">
            {gallery.map((m, i) => (
              <button key={m.src} className="gallery-item" onClick={() => setLightbox(i)} title={m.caption}>
                <img src={m.src} alt={m.caption ?? ''} loading="lazy" />
              </button>
            ))}
          </div>
        )}

        <div className="detail-actions">
          <a className="glass-button wiki-button" href={summary?.url ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(event.title)}`} target="_blank" rel="noreferrer">
            Read on Wikipedia
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M7 17L17 7M9 7h8v8" /></svg>
          </a>
          <a className="glass-chip" href={`https://www.wikidata.org/wiki/${event.id}`} target="_blank" rel="noreferrer">
            Wikidata
          </a>
        </div>
      </div>

      {lightbox !== null && gallery[lightbox] && createPortal(
        <div className="lightbox" onClick={() => setLightbox(null)} role="dialog" aria-label="Image viewer">
          <img src={gallery[lightbox].src.replace(/\/\d+px-/, '/1280px-')} alt={gallery[lightbox].caption ?? ''} onError={(e) => ((e.target as HTMLImageElement).src = gallery[lightbox].src)} />
          {gallery[lightbox].caption && <p className="glass lightbox-caption">{gallery[lightbox].caption}</p>}
          <button className="glass-button lightbox-nav prev" onClick={(e) => { e.stopPropagation(); setLightbox((lightbox - 1 + gallery.length) % gallery.length) }} aria-label="Previous image">‹</button>
          <button className="glass-button lightbox-nav next" onClick={(e) => { e.stopPropagation(); setLightbox((lightbox + 1) % gallery.length) }} aria-label="Next image">›</button>
        </div>,
        // Portal: the glass panel's backdrop-filter would otherwise trap position:fixed.
        document.body,
      )}
    </article>
  )
}

export function EventPanel({ events, title, subtitle, chronological, selected, onSelect, onHover, thumbVersion, collapsed, onToggleCollapsed }: Props) {
  void thumbVersion // re-render when thumbnails arrive

  return (
    <aside className={`glass panel${collapsed ? ' is-collapsed' : ''}`}>
      <button className="panel-grabber" onClick={onToggleCollapsed} aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}>
        <span />
      </button>
      {selected ? (
        <Detail key={selected.id} event={selected} onClose={() => onSelect(null, false)} />
      ) : (
        <PeriodView
          events={events}
          title={title ?? 'In this period'}
          subtitle={subtitle}
          chronological={chronological}
          onSelect={onSelect}
          onHover={onHover}
        />
      )}
    </aside>
  )
}
