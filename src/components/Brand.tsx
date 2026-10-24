import { useEffect, useState } from 'react'

/** Globe inside a counter-clockwise "rewind" arc: places across time. */
export function Logo({ size = 38 }: { size?: number }) {
  return (
    <svg className="logo" viewBox="0 0 40 40" width={size} height={size} aria-hidden>
      <defs>
        <linearGradient id="logo-rim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.7" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0.1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.35" />
        </linearGradient>
      </defs>
      {/* glass disc */}
      <circle cx="20" cy="20" r="19.25" fill="rgba(15,23,42,0.45)" stroke="url(#logo-rim)" strokeWidth="1.5" />
      {/* time arc with arrowhead (history runs backwards) */}
      <path d="M31.5 13.5A13.5 13.5 0 1 0 33.5 20" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" />
      <path d="M30.9 22.4l2.6-2.7 2.6 2.7" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {/* globe */}
      <g fill="none" stroke="#fff" strokeWidth="1.4" strokeLinecap="round">
        <circle cx="20" cy="20" r="8.5" />
        <ellipse cx="20" cy="20" rx="3.6" ry="8.5" />
        <path d="M11.8 17.2h16.4M11.8 22.8h16.4" strokeOpacity="0.75" />
      </g>
    </svg>
  )
}

/** Logo pill that tucks its wordmark away after a few seconds; hover or focus reveals it. */
export function Brand() {
  const [collapsed, setCollapsed] = useState(false)
  const [hovered, setHovered] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setCollapsed(true), 3500)
    return () => clearTimeout(t)
  }, [])

  const expanded = !collapsed || hovered
  return (
    <div
      className={`glass brand${expanded ? '' : ' is-collapsed'}`}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      tabIndex={0}
      aria-label="Chronoglobe: history from Wikipedia, mapped"
    >
      <Logo />
      <div className="brand-text" aria-hidden={!expanded}>
        <h1>Chronoglobe</h1>
        <p>History from Wikipedia, mapped</p>
      </div>
    </div>
  )
}
