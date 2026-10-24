// Canvas art for globe markers: glass dots, photo bubbles, glass name pills
// and cluster badges.
//
// Everything is drawn in CSS pixels on a canvas scaled by K, so it is sharp on
// Retina screens and when markers scale up near the camera. Images are handed
// to Cesium as data URLs: Cesium keys billboard textures by URL, so a repeated
// image is uploaded once (a canvas object would get a new texture every time).

const K = Math.min(3, Math.max(2, Math.ceil(globalThis.devicePixelRatio || 1)))

export const PHOTO_R = 23 // photo bubble radius, CSS px
const PAD = 6 // room for drop shadows
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif'

export interface MarkerImage {
  url: string
  /** CSS size */
  width: number
  height: number
  /** CSS px from the image's left edge to the marker's center */
  anchorX: number
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = Math.ceil(w * K)
  c.height = Math.ceil(h * K)
  const g = c.getContext('2d')!
  g.scale(K, K)
  return [c, g]
}

function shadow(g: CanvasRenderingContext2D, blur: number, y: number, alpha = 0.45) {
  // Shadow geometry is in canvas pixels and ignores the transform, so scale it.
  g.shadowColor = `rgba(0,0,0,${alpha})`
  g.shadowBlur = blur * K
  g.shadowOffsetY = y * K
}

function noShadow(g: CanvasRenderingContext2D) {
  g.shadowColor = 'transparent'
  g.shadowBlur = 0
  g.shadowOffsetY = 0
}

/** Glass edge: rim lit top-left, darker refraction at the edge, a small highlight. */
function glassDisc(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, refraction = 0.3) {
  const edge = g.createRadialGradient(cx, cy, r * 0.6, cx, cy, r)
  edge.addColorStop(0, 'rgba(0,0,0,0)')
  edge.addColorStop(1, `rgba(0,0,0,${refraction})`)
  g.fillStyle = edge
  g.beginPath()
  g.arc(cx, cy, r, 0, Math.PI * 2)
  g.fill()

  g.save()
  g.beginPath()
  g.arc(cx, cy, r, 0, Math.PI * 2)
  g.clip()
  const spec = g.createLinearGradient(cx - r, cy - r, cx, cy)
  spec.addColorStop(0, 'rgba(255,255,255,0.45)')
  spec.addColorStop(1, 'rgba(255,255,255,0)')
  g.strokeStyle = spec
  g.lineWidth = Math.max(1, r * 0.12)
  g.lineCap = 'round'
  g.beginPath()
  g.arc(cx, cy, r * 0.74, Math.PI * 1.08, Math.PI * 1.45)
  g.stroke()
  g.restore()

  const rim = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r)
  rim.addColorStop(0, 'rgba(255,255,255,0.8)')
  rim.addColorStop(0.5, 'rgba(255,255,255,0.15)')
  rim.addColorStop(1, 'rgba(255,255,255,0.4)')
  g.strokeStyle = rim
  g.lineWidth = r > 10 ? 1 : 0.8
  g.beginPath()
  g.arc(cx, cy, r - 0.4, 0, Math.PI * 2)
  g.stroke()
}

function roundRectPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath()
  g.roundRect(x, y, w, h, r)
}

// ---------- photos ----------

const photos = new Map<string, Promise<HTMLCanvasElement>>()

/** Load an image (CORS) and cut it into a circle of radius PHOTO_R. */
export function loadPhoto(url: string): Promise<HTMLCanvasElement> {
  let p = photos.get(url)
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        const d = PHOTO_R * 2
        const [c, g] = canvas(d, d)
        g.imageSmoothingQuality = 'high'
        g.beginPath()
        g.arc(PHOTO_R, PHOTO_R, PHOTO_R, 0, Math.PI * 2)
        g.clip()
        const s = Math.max(d / img.width, d / img.height) // cover
        g.drawImage(img, PHOTO_R - (img.width * s) / 2, PHOTO_R - (img.height * s) / 2, img.width * s, img.height * s)
        resolve(c)
      }
      img.onerror = reject
      img.src = url
    })
    p.catch(() => photos.delete(url))
    photos.set(url, p)
  }
  return p
}

// ---------- event markers ----------

export function dotRadius(sitelinks: number): number {
  return 5 + Math.min(4.5, Math.sqrt(sitelinks) * 0.45)
}

function drawDot(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  shadow(g, 4, 1.5, 0.5)
  const body = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r)
  body.addColorStop(0, mix(color, '#ffffff', 0.35))
  body.addColorStop(0.7, color)
  body.addColorStop(1, mix(color, '#000000', 0.25))
  g.fillStyle = body
  g.beginPath()
  g.arc(cx, cy, r, 0, Math.PI * 2)
  g.fill()
  noShadow(g)
  glassDisc(g, cx, cy, r, 0.18)
}

function drawPhoto(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, photo: HTMLCanvasElement, ring: string) {
  shadow(g, 8, 2.5)
  g.fillStyle = 'rgba(0,0,0,0.6)'
  g.beginPath()
  g.arc(cx, cy, r - 0.5, 0, Math.PI * 2)
  g.fill()
  noShadow(g)
  g.drawImage(photo, cx - r, cy - r, r * 2, r * 2)
  // Thin category tint just inside the rim.
  g.globalAlpha = 0.9
  g.strokeStyle = ring
  g.lineWidth = 1.6
  g.beginPath()
  g.arc(cx, cy, r - 1.4, 0, Math.PI * 2)
  g.stroke()
  g.globalAlpha = 1
  glassDisc(g, cx, cy, r)
}

const PILL_H = 22
const PILL_H_SELECTED = 26

/** Liquid-glass capsule with the event name. Returns its width. */
function drawPill(g: CanvasRenderingContext2D, x: number, cy: number, text: string, selected: boolean): number {
  const h = selected ? PILL_H_SELECTED : PILL_H
  g.font = selected ? `650 13.5px ${FONT}` : `590 12px ${FONT}`
  const padX = selected ? 11 : 9
  const w = Math.ceil(g.measureText(text).width) + padX * 2
  const y = cy - h / 2
  const r = h / 2

  // Body: smoky translucent glass.
  shadow(g, 6, 2, 0.35)
  g.fillStyle = selected ? 'rgba(15,23,42,0.8)' : 'rgba(15,23,42,0.58)'
  roundRectPath(g, x, y, w, h, r)
  g.fill()
  noShadow(g)

  // Sheen across the top half.
  g.save()
  roundRectPath(g, x, y, w, h, r)
  g.clip()
  const sheen = g.createLinearGradient(0, y, 0, y + h)
  sheen.addColorStop(0, 'rgba(255,255,255,0.2)')
  sheen.addColorStop(0.5, 'rgba(255,255,255,0.04)')
  sheen.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = sheen
  g.fillRect(x, y, w, h)
  g.restore()

  // Rim: bright on top, fading below.
  const rim = g.createLinearGradient(0, y, 0, y + h)
  rim.addColorStop(0, `rgba(255,255,255,${selected ? 0.7 : 0.5})`)
  rim.addColorStop(0.6, 'rgba(255,255,255,0.1)')
  rim.addColorStop(1, 'rgba(255,255,255,0.22)')
  g.strokeStyle = rim
  g.lineWidth = 0.8
  roundRectPath(g, x + 0.4, y + 0.4, w - 0.8, h - 0.8, r - 0.4)
  g.stroke()

  g.fillStyle = '#fff'
  g.textBaseline = 'middle'
  g.shadowColor = 'rgba(0,0,0,0.5)'
  g.shadowBlur = 2 * K
  g.fillText(text, x + padX, cy + 0.5)
  noShadow(g)
  return w
}

function shortTitle(t: string): string {
  t = t.replace(/\s*\([^)]*\)$/, '') // "Battle of Himera (480 BC)" -> "Battle of Himera"
  return t.length > 30 ? `${t.slice(0, 28).trimEnd()}…` : t
}

const PILL_GAP = 9 // marker edge to pill; leaves room for a count badge
let measureCtx: CanvasRenderingContext2D | null = null
const textWidths = new Map<string, number>()

function pillWidth(text: string, selected: boolean): number {
  const key = `${selected}|${text}`
  let w = textWidths.get(key)
  if (w === undefined) {
    measureCtx ??= document.createElement('canvas').getContext('2d')!
    measureCtx.font = selected ? `650 13.5px ${FONT}` : `590 12px ${FONT}`
    w = Math.ceil(measureCtx.measureText(text).width) + (selected ? 22 : 18)
    textWidths.set(key, w)
  }
  return w
}

export interface MarkerSpec {
  title: string
  color: string
  sitelinks: number
  photo?: { key: string; canvas: HTMLCanvasElement }
  label: boolean
  selected: boolean
  /** Events hidden behind this marker; drawn as a "+N" badge */
  hidden?: number
}

export interface MarkerGeometry {
  width: number
  height: number
  anchorX: number
  /** Margin around the visible shape (shadow room), excluded from collisions */
  pad: number
}

function labelText(m: MarkerSpec): string {
  return m.label ? (m.selected ? m.title : shortTitle(m.title)) : ''
}

function radius(m: MarkerSpec): number {
  return (m.photo ? PHOTO_R : dotRadius(m.sitelinks)) * (m.selected ? 1.3 : 1)
}

/** Size of a marker image without drawing it (for collision tests). */
export function markerGeometry(m: MarkerSpec): MarkerGeometry {
  const text = labelText(m)
  const r = radius(m)
  const pillH = m.selected ? PILL_H_SELECTED : PILL_H
  const width = PAD + r * 2 + (text ? PILL_GAP + pillWidth(text, m.selected) : 0) + PAD
  const height = Math.max(r * 2, pillH) + PAD * 2
  return { width, height, anchorX: PAD + r, pad: PAD }
}

const markerCache = new Map<string, MarkerImage>()

/** One image per marker: dot or photo bubble, optional name pill and "+N" badge. */
export function markerImage(m: MarkerSpec): MarkerImage {
  const text = labelText(m)
  const hidden = m.hidden ?? 0
  const key = `${m.photo?.key ?? m.color}|${m.photo ? '' : dotRadius(m.sitelinks).toFixed(1)}|${text}|${m.selected}|${hidden}`
  const hit = markerCache.get(key)
  if (hit) return hit

  const { width, height, anchorX } = markerGeometry(m)
  const r = radius(m)
  const cx = anchorX
  const cy = height / 2
  const [c, g] = canvas(width, height)
  if (m.photo) drawPhoto(g, cx, cy, r, m.photo.canvas, m.color)
  else drawDot(g, cx, cy, r, m.color)
  if (text) drawPill(g, cx + r + PILL_GAP, cy, text, m.selected)
  if (hidden > 0) drawBadge(g, cx + r * 0.72, cy - r * 0.72, hidden > 99 ? '99+' : `+${hidden}`)

  const img = { url: c.toDataURL(), width, height, anchorX }
  markerCache.set(key, img)
  return img
}

/** Small dark glass capsule with a count, e.g. "+4". */
function drawBadge(g: CanvasRenderingContext2D, cx: number, cy: number, text: string) {
  g.font = `700 9.5px ${FONT}`
  const h = 15
  const w = Math.max(h, Math.ceil(g.measureText(text).width) + 9)
  const x = cx - w / 2
  const y = cy - h / 2
  shadow(g, 3, 1, 0.4)
  g.fillStyle = 'rgba(15,23,42,0.92)'
  roundRectPath(g, x, y, w, h, h / 2)
  g.fill()
  noShadow(g)
  const rim = g.createLinearGradient(0, y, 0, y + h)
  rim.addColorStop(0, 'rgba(255,255,255,0.65)')
  rim.addColorStop(1, 'rgba(255,255,255,0.15)')
  g.strokeStyle = rim
  g.lineWidth = 0.8
  roundRectPath(g, x + 0.4, y + 0.4, w - 0.8, h - 0.8, h / 2 - 0.4)
  g.stroke()
  g.fillStyle = '#fff'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, cx, cy + 0.5)
  g.textAlign = 'left'
}

// ---------- utils ----------

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (p: number, s: number) => (p >> s) & 255
  const m = (s: number) => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * t)
  return `rgb(${m(16)},${m(8)},${m(0)})`
}
