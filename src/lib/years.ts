// Years are stored as astronomical years, the same numbering Wikidata's query
// service uses: 1 CE = 1, 1 BCE = 0, 480 BCE = -479.

export const MIN_YEAR = -2999 // 3000 BCE
export const MAX_YEAR = new Date().getFullYear()

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function clampYear(y: number): number {
  return Math.min(MAX_YEAR, Math.max(MIN_YEAR, Math.round(y)))
}

export function parseWikidataYear(iso: string): number {
  const m = /^([+-]?)(\d+)-/.exec(iso)
  if (!m) return NaN
  return (m[1] === '-' ? -1 : 1) * parseInt(m[2], 10)
}

export function formatYear(y: number): string {
  if (y <= 0) return `${1 - y} BCE`
  if (y < 1000) return `${y} CE`
  return String(y)
}

/**
 * Human date for an event. Wikidata stores year-precision dates as Jan 1, so
 * a Jan 1 date is shown as just the year (occasionally hiding a real Jan 1).
 */
export function formatEventDate(iso: string, year: number): string {
  const m = /^[+-]?\d+-(\d{2})-(\d{2})/.exec(iso)
  if (!m || year <= 0 || (m[1] === '01' && m[2] === '01')) return formatYear(year)
  const month = MONTHS[parseInt(m[1], 10) - 1]
  const day = parseInt(m[2], 10)
  return day === 1 ? `${month} ${formatYear(year)}` : `${day} ${month} ${formatYear(year)}`
}

/** Accepts "1944", "-479", "480 BC", "480 BCE", "800 AD", "800 CE". */
export function parseYearInput(text: string): number | null {
  const m = /^\s*(-?\d+)\s*(bce?|b\.c\.e?\.?|ad|a\.d\.|ce|c\.e\.)?\s*$/i.exec(text)
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (m[2] && /^b/i.test(m[2])) return n <= 0 ? null : 1 - n
  return n
}

// The timeline is non-linear so that dense recent centuries get more room
// than the sparse ancient past. Piecewise-linear between these anchors.
const ANCHORS: [pos: number, year: number][] = [
  [0, MIN_YEAR],
  [0.12, -500],
  [0.28, 500],
  [0.48, 1500],
  [0.7, 1800],
  [0.88, 1950],
  [1, MAX_YEAR],
]

export function posToYear(p: number): number {
  p = Math.min(1, Math.max(0, p))
  for (let i = 1; i < ANCHORS.length; i++) {
    const [p0, y0] = ANCHORS[i - 1]
    const [p1, y1] = ANCHORS[i]
    if (p <= p1) return Math.round(y0 + ((p - p0) / (p1 - p0)) * (y1 - y0))
  }
  return MAX_YEAR
}

export function yearToPos(y: number): number {
  y = Math.min(MAX_YEAR, Math.max(MIN_YEAR, y))
  for (let i = 1; i < ANCHORS.length; i++) {
    const [p0, y0] = ANCHORS[i - 1]
    const [p1, y1] = ANCHORS[i]
    if (y <= y1) return p0 + ((y - y0) / (y1 - y0)) * (p1 - p0)
  }
  return 1
}

export const ERAS: { name: string; from: number; to: number }[] = [
  { name: 'Ancient', from: MIN_YEAR, to: -500 },
  { name: 'Classical', from: -500, to: 500 },
  { name: 'Medieval', from: 500, to: 1500 },
  { name: 'Early modern', from: 1500, to: 1800 },
  { name: 'Modern', from: 1800, to: 1950 },
  { name: 'Recent', from: 1950, to: MAX_YEAR },
]

/** Tick marks (astronomical years): 2500 BC, 1000 BC, 1 AD, 1000, 1500, 1800, 1900, 2000 */
export const TICKS = [-2499, -999, 1, 1000, 1500, 1800, 1900, 2000]
