import { useEffect, useState } from 'react'
import { Logo } from './Logo'
import { getSeedMeta } from '../lib/seed'
import { WDQS_CACHE } from '../lib/wikidata'

export interface AboutInfo {
  /** Events currently on the map */
  eventsShown: number
  /** Events loaded for the current period (before category filters) */
  eventsKnown: number
}

const REPO = 'https://github.com/iamshreyasvc/chronoglobe'
const ION = !!import.meta.env.VITE_CESIUM_ION_TOKEN

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 ** 2).toFixed(1)} MB`
}

/** Round icon bubble, the same shape as the thumbnails in the right sidebar's list. */
function IconBubble({ children }: { children: React.ReactNode }) {
  return <span className="thumb-bubble icon-bubble">{children}</span>
}

function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  )
}

const HOW_TO: [React.ReactNode, string, string][] = [
  [<path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5" />, 'Search', 'Press / to find any event or place'],
  [<path d="M8 5.5v13l10.5-6.5z" />, 'Play', 'Move through time, or tour a place'],
  [<path d="M12 21s7-7.8 7-13a7 7 0 1 0-14 0c0 5.2 7 13 7 13zM12 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />, 'Places', 'Pick a place to see its whole history'],
  [<path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5" />, 'Load more here', 'Every event in the area you are viewing'],
  [<path d="M6 6l12 12M18 6L6 18" />, 'Esc', 'Close panels, leave a place'],
]

/** About content: what Chronoglobe is, the (guest) account, and technical details. */
export function AboutContent({ open, info }: { open: boolean; info: AboutInfo }) {
  const [cesiumVersion, setCesiumVersion] = useState<string | null>(null)
  const [storage, setStorage] = useState<number | null>(null)
  const [cleared, setCleared] = useState(false)

  // Gather technical details when the menu opens.
  useEffect(() => {
    if (!open) return
    import('cesium').then((m) => setCesiumVersion((m as unknown as { VERSION?: string }).VERSION ?? null)).catch(() => {})
    navigator.storage?.estimate?.().then((e) => setStorage(e.usage ?? null)).catch(() => {})
    setCleared(false)
  }, [open])

  const clearCache = async () => {
    await caches?.delete(WDQS_CACHE).catch(() => false)
    const e = await navigator.storage?.estimate?.().catch(() => null)
    setStorage(e?.usage ?? null)
    setCleared(true)
  }

  const seed = getSeedMeta()
  const tech: [string, React.ReactNode][] = [
    ['Version', `${__APP_VERSION__} · built ${__BUILD_DATE__}`],
    ['Globe engine', cesiumVersion ? `CesiumJS ${cesiumVersion}` : 'CesiumJS'],
    ['Imagery', ION ? 'Cesium World Imagery + Terrain' : 'Esri World Imagery'],
    ['Event data', 'Wikidata (SPARQL + search)'],
    ['Articles & photos', 'Wikipedia APIs'],
    ['Bundled seed', seed ? `${seed.count.toLocaleString()} events${seed.generated ? ` · ${seed.generated}` : ''}` : '—'],
    ['On the map', `${info.eventsShown.toLocaleString()} of ${info.eventsKnown.toLocaleString()} this period`],
    ['Rendering', `${window.devicePixelRatio || 1}× pixel ratio`],
  ]

  return (
    <div className="about-content">
      {/* Hero card, styled like the right sidebar's Spotlight */}
      <section className="about-hero">
        <span className="about-hero-logo">
          <Logo size={64} />
        </span>
        <span className="about-hero-text">
          <span className="pills">
            <span className="pill">v{__APP_VERSION__}</span>
            <span className="pill">3000 BCE – today</span>
          </span>
          <strong>Every event, where it happened</strong>
          <span className="about-hero-body">
            A 3D globe of world history. Thousands of Wikipedia events appear where they took place. Drag the
            timeline, press play, or search an event or a place.
          </span>
        </span>
      </section>

      <section>
        <header className="section-head">
          <h3>How to use</h3>
        </header>
        <ul className="info-list">
          {HOW_TO.map(([icon, title, text]) => (
            <li key={title} className="info-row">
              <IconBubble>
                <Svg>{icon}</Svg>
              </IconBubble>
              <span className="event-card-text">
                <strong>{title}</strong>
                <span className="muted">{text}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <header className="section-head">
          <h3>Account</h3>
          <button className="glass-chip section-action" onClick={clearCache} disabled={cleared}>
            {cleared ? 'Cleared' : 'Clear cache'}
          </button>
        </header>
        <div className="info-row">
          <IconBubble>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
              <circle cx="12" cy="8.5" r="4" />
              <path d="M4.5 20c.8-4 3.9-6 7.5-6s6.7 2 7.5 6z" />
            </svg>
          </IconBubble>
          <span className="event-card-text">
            <strong>Guest</strong>
            <span className="muted wrap">
              No sign-in needed. Nothing about you is stored; this browser caches Wikipedia and Wikidata answers (
              {storage === null ? '—' : formatBytes(storage)}) to load faster.
            </span>
          </span>
        </div>
      </section>

      <section>
        <header className="section-head">
          <h3>Technical</h3>
          <a className="glass-chip section-action" href={REPO} target="_blank" rel="noreferrer">
            GitHub
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M7 17L17 7M9 7h8v8" />
            </svg>
          </a>
        </header>
        <dl className="about-tech">
          {tech.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="about-foot muted">
        Text and photos from Wikipedia (CC BY-SA 4.0) and Wikimedia Commons; event data from Wikidata (CC0).
      </p>
    </div>
  )
}
