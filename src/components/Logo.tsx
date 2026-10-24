/**
 * A globe whose equator is a timeline: it runs past the globe's edges with
 * end ticks, and one amber event marker sits on it.
 */
export function Logo({ size = 38 }: { size?: number }) {
  return (
    <svg className="logo" viewBox="0 0 40 40" width={size} height={size} aria-hidden>
      <defs>
        <linearGradient id="logo-rim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0.08" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.3" />
        </linearGradient>
      </defs>
      <circle cx="20" cy="20" r="19.25" fill="#0b1220" fillOpacity="0.72" stroke="url(#logo-rim)" strokeWidth="1.5" />
      <g fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="20" cy="20" r="10" />
        <ellipse cx="20" cy="20" rx="4.2" ry="10" strokeOpacity="0.5" />
        <path d="M5.5 20h29" />
        <path d="M7.8 17.8v4.4M32.2 17.8v4.4" strokeOpacity="0.6" />
      </g>
      <circle cx="25.2" cy="20" r="3.2" fill="#fbbf24" stroke="#0b1220" strokeWidth="1.5" />
    </svg>
  )
}
