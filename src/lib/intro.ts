// Page-load choreography, like cells dividing under a microscope:
//
//   logo ─▶ search bar ─▶ side panel ─▶ timeline
//                       └─▶ filter bubble, globe button
//                                            …then the globe rises in
//
// Each division happens on a "gooey" layer beneath the UI: an SVG filter
// (blur, then a sharp alpha threshold) makes nearby blobs melt together like
// membranes and snap apart as they separate. A daughter cell swells out of its
// parent, stretches a neck, pinches off, swims to its place and spreads into
// the element's shape. The real glass element then fades in on top and the
// cell dissolves. Times are ms from when the page first lays out.

type Step = { at: number; duration: number }

export const INTRO = {
  logo: { at: 60, duration: 650 },
  search: { at: 450, duration: 1050 },
  panel: { at: 1350, duration: 1100 },
  filter: { at: 1450, duration: 900 },
  darkToggle: { at: 1520, duration: 880 },
  home: { at: 1600, duration: 850 },
  // Starts once the panel has fully formed (panel.at + panel.duration).
  timeline: { at: 2450, duration: 1150 },
  globe: { at: 3150, duration: 1100 },
} satisfies Record<string, Step>

const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
// WebKit (Safari, and every browser on iOS) doesn't apply SVG filters like the
// goo filter to HTML content, so there the cells draw their glass with CSS
// instead (no merging necks, but the same look).
const webkitOnly =
  typeof navigator !== 'undefined' && /AppleWebKit/.test(navigator.userAgent) && !/(Chrome|Chromium|Edg)\//.test(navigator.userAgent)
const goo = !webkitOnly
let startedAt: number | null = null
const rects = new Map<string, DOMRect>()

/** Mark the start of the intro (call once, on first layout). Returns false if motion is reduced. */
export function startIntro(): boolean {
  startedAt ??= performance.now()
  return !reduced
}

/** Remember where an element sat before anything moved (source for late joiners like the globe button). */
export function rememberRect(name: string, rect: DOMRect | undefined) {
  if (rect) rects.set(name, rect)
}
export function rememberedRect(name: string): DOMRect | null {
  return rects.get(name) ?? null
}

/** Delay until `at` ms into the intro (0 if already past, e.g. a late-loading chunk). */
function delayFor(at: number): number {
  if (startedAt === null) return at
  return Math.max(0, startedAt + at - performance.now())
}

// Per-stage easings (timing stays linear so keyframe offsets are real moments).
const SWELL = 'cubic-bezier(0.3, 0, 0.3, 1.25)' // grow with a slight overshoot
const FLOW = 'cubic-bezier(0.45, 0, 0.55, 1)' // smooth in-out, like cytoplasm
const SETTLE = 'cubic-bezier(0.2, 0.8, 0.2, 1)' // decelerate into place

// ---------- the gooey cell layer ----------

let layer: HTMLDivElement | null = null
let live = 0

function cellLayer(): HTMLDivElement {
  if (layer) return layer
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '0')
  svg.setAttribute('height', '0')
  svg.style.position = 'absolute'
  // 1. Shape: blur the blobs' alpha, then crush it, so soft overlaps become one
  //    smooth membrane and thin bridges break cleanly as cells pull apart.
  // 2. Paint that shape as liquid glass: a faint frosted body, a thin bright
  //    rim, and a glossy highlight lit from the top-left (specular lighting on
  //    the softened shape, so the shine flows over necks as cells divide).
  svg.innerHTML = `<filter id="cell-goo" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceAlpha" stdDeviation="9" result="blur"/>
      <feColorMatrix in="blur" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 26 -11" result="shape"/>
      <feFlood flood-color="#ffffff" flood-opacity="0.1"/>
      <feComposite in2="shape" operator="in" result="body"/>
      <feMorphology in="shape" operator="erode" radius="1.3" result="inner"/>
      <feComposite in="shape" in2="inner" operator="out" result="ring"/>
      <feFlood flood-color="#ffffff" flood-opacity="0.6"/>
      <feComposite in2="ring" operator="in" result="rim"/>
      <feGaussianBlur in="shape" stdDeviation="5" result="soft"/>
      <feSpecularLighting in="soft" surfaceScale="7" specularConstant="0.75" specularExponent="26" lighting-color="#ffffff" result="spec">
        <feDistantLight azimuth="225" elevation="48"/>
      </feSpecularLighting>
      <feComposite in="spec" in2="inner" operator="in" result="shine"/>
      <feMerge><feMergeNode in="body"/><feMergeNode in="shine"/><feMergeNode in="rim"/></feMerge>
    </filter>`
  document.body.appendChild(svg)
  layer = document.createElement('div')
  layer.className = goo ? 'cell-layer' : 'cell-layer no-goo'
  document.body.appendChild(layer)
  return layer
}

/** A blob in the cell layer, removed when its animation ends (the layer goes when the last one does). */
function blob(rect: { x: number; y: number; w: number; h: number; r: number }): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'cell'
  Object.assign(el.style, {
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.w}px`,
    height: `${rect.h}px`,
    borderRadius: `${rect.r}px`,
    opacity: '0', // invisible until its animation starts (animations only fill forwards)
  })
  cellLayer().appendChild(el)
  live++
  return el
}

function retire(el: HTMLElement, anim: Animation) {
  anim.finished
    .catch(() => {})
    .finally(() => {
      el.remove()
      if (--live === 0) {
        layer?.remove()
        layer = null
      }
    })
}

const center = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
const radiusOf = (el: Element, r: DOMRect) => {
  const br = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0
  return Math.min(br, r.height / 2, r.width / 2)
}

/** Fade the real element in over the last part of its cell's animation. */
function reveal(el: Element, step: Step, from: number) {
  el.animate(
    [
      { opacity: 0, transform: 'scale(0.97)', offset: 0 },
      { opacity: 0, transform: 'scale(0.97)', offset: from, easing: SETTLE },
      { opacity: 1, transform: 'none' },
    ],
    // Linear overall so keyframe offsets are real moments in time; easing is per stage.
    { duration: step.duration, delay: delayFor(step.at), fill: 'backwards' },
  )
}

// ---------- public animations ----------

/** The first cell: appears at the logo, swells, and the logo surfaces from it. */
export function cellAppear(el: Element | null, step: Step) {
  if (!el || reduced) return
  // A cell the shape of the logo pill, swelling from nothing.
  const r = el.getBoundingClientRect()
  const cell = blob({ x: r.left, y: r.top, w: r.width, h: r.height, r: radiusOf(el, r) })
  const anim = cell.animate(
    [
      { transform: 'scale(0)', opacity: 1, easing: SWELL },
      { transform: 'scale(1.12)', opacity: 1, offset: 0.5, easing: SETTLE },
      { transform: 'scale(1)', opacity: 1, offset: 0.75 },
      { transform: 'scale(1)', opacity: 0 },
    ],
    { duration: step.duration + 300, delay: delayFor(step.at), fill: 'forwards' },
  )
  retire(cell, anim)
  reveal(el, step, 0.45)
}

/**
 * Divide `el` out of `source`, like a cell: a bud swells from the parent, a
 * neck stretches and pinches off, the daughter swims to `el`'s place and
 * spreads into its shape, then `el` fades in on top.
 */
export function divideFrom(el: Element | null, source: DOMRect | null, step: Step) {
  if (!el || !source || reduced) return
  const t = el.getBoundingClientRect()
  if (!t.width || !t.height) return
  const s = source
  const sc = center(s)
  const tc = center(t)
  const dx = tc.x - sc.x
  const dy = tc.y - sc.y
  const dist = Math.hypot(dx, dy) || 1
  const ux = dx / dist
  const uy = dy / dist

  // Parent membrane: just inside the source's edge facing the destination, so
  // the bud grows out of that side and fuses with it through a neck.
  const pd = Math.min(s.width, s.height)
  const toEdge = Math.min(Math.abs(ux) > 1e-3 ? s.width / 2 / Math.abs(ux) : Infinity, Math.abs(uy) > 1e-3 ? s.height / 2 / Math.abs(uy) : Infinity)
  const inset = Math.max(0, toEdge - pd * 0.38)
  const pc = { x: sc.x + ux * inset, y: sc.y + uy * inset }
  const parent = blob({ x: pc.x - pd / 2, y: pc.y - pd / 2, w: pd, h: pd, r: pd / 2 })
  const delay = delayFor(step.at)
  const pAnim = parent.animate(
    [
      { transform: 'scale(0.85)', opacity: 1, easing: FLOW },
      // The parent stretches toward the bud as the neck forms…
      { transform: `translate(${ux * pd * 0.18}px, ${uy * pd * 0.18}px) scale(1.12, 0.95)`, opacity: 1, offset: 0.3, easing: FLOW },
      // …then relaxes back once the daughter has pinched off.
      { transform: 'scale(0.9)', opacity: 1, offset: 0.55, easing: FLOW },
      { transform: 'scale(0.6)', opacity: 0 },
    ],
    { duration: step.duration * 0.75, delay, fill: 'forwards' },
  )
  retire(parent, pAnim)

  // Daughter cell: starts as a bud at the parent's center, ends as el's shape.
  const bd = Math.max(26, pd * 0.8)
  const r = radiusOf(el, t)
  const daughter = blob({ x: t.left, y: t.top, w: t.width, h: t.height, r })
  // Express every pose relative to the final box, so only transforms animate.
  const pose = (cx: number, cy: number, w: number, h: number) =>
    `translate(${cx - tc.x}px, ${cy - tc.y}px) scale(${w / t.width}, ${h / t.height})`
  const budOut = Math.min((dist - inset) * 0.35, pd * 0.75 + bd * 0.35) // how far the bud bulges before pinching
  const dAnim = daughter.animate(
    [
      { transform: pose(pc.x, pc.y, bd * 0.6, bd * 0.6), opacity: 1, easing: SWELL },
      // Bud bulges out of the parent (still fused: the goo draws a neck).
      { transform: pose(pc.x + ux * budOut, pc.y + uy * budOut, bd, bd), opacity: 1, offset: 0.3, easing: FLOW },
      // Pinch: a quick squeeze as the neck snaps.
      { transform: pose(pc.x + ux * budOut * 1.35, pc.y + uy * budOut * 1.35, bd * 0.86, bd * 1.08), opacity: 1, offset: 0.4, easing: FLOW },
      // Swim toward the destination, gently elongated along the way.
      { transform: pose(pc.x + (tc.x - pc.x) * 0.82, pc.y + (tc.y - pc.y) * 0.82, bd * 1.12, bd * 0.92), opacity: 1, offset: 0.68, easing: SETTLE },
      // Spread into the element's shape, then dissolve as the element surfaces.
      { transform: 'none', opacity: 1, offset: 0.84, easing: 'ease-out' },
      { transform: 'none', opacity: 0, offset: 0.95 },
      { transform: 'none', opacity: 0 },
    ],
    { duration: step.duration, delay, fill: 'forwards' },
  )
  retire(daughter, dAnim)
  reveal(el, step, 0.8)
}

/**
 * For long bars (the side panel, the timeline): instead of budding as a round
 * cell, the membrane pours out of `source` like a dropdown, with a soft
 * rounded leading edge, fused to the source by a neck that pinches off once the
 * bar has formed. Flows down/up or left/right depending on where `el` sits.
 */
export function flowFrom(el: Element | null, source: DOMRect | null, step: Step) {
  if (!el || !source || reduced) return
  const t = el.getBoundingClientRect()
  if (!t.width || !t.height) return
  const s = source
  const r = radiusOf(el, t)
  const delay = delayFor(step.at)

  // Flow along the axis that leads away from the source.
  const overlapX = Math.min(s.right, t.right) - Math.max(s.left, t.left)
  const vertical = overlapX > Math.min(s.width, t.width) * 0.3
  const dir = vertical ? (t.top >= s.top ? 'down' : 'up') : t.left < s.left ? 'left' : 'right'
  // Clip-path insets keep the leading edge properly rounded the whole way.
  const hidden = { down: '0 0 100% 0', up: '100% 0 0 0', left: '0 0 0 100%', right: '0 100% 0 0' }[dir]
  const clip = (inset: string) => `inset(${inset} round ${r}px)`

  const cell = blob({ x: t.left, y: t.top, w: t.width, h: t.height, r })
  const anim = cell.animate(
    [
      { clipPath: clip(hidden), opacity: 1, easing: FLOW },
      // Pour out; the leading edge is still bulging forward.
      { clipPath: clip(dir === 'down' ? '0 0 12% 0' : dir === 'up' ? '12% 0 0 0' : dir === 'left' ? '0 0 0 12%' : '0 12% 0 0'), opacity: 1, offset: 0.55, easing: SETTLE },
      { clipPath: clip('0 0 0 0'), opacity: 1, offset: 0.78, easing: 'ease-out' },
      { clipPath: clip('0 0 0 0'), opacity: 0, offset: 0.95 },
      { clipPath: clip('0 0 0 0'), opacity: 0 },
    ],
    { duration: step.duration, delay, fill: 'forwards' },
  )
  retire(cell, anim)

  if (goo) {
    // The leading edge: a round "pseudopod" riding the front, which the goo
    // filter melts into the bar as a bulging, cell-like front.
    // A wide disc mostly inside the bar, so the front reads as a gentle convex
    // curve (like a cell's membrane pushing forward), not a separate knob.
    const across = vertical ? t.width : t.height
    const pd = Math.min(across * 0.9, 340)
    const sink = pd * 0.44 // how far the disc's center sits behind the front
    const lead = (p: number) => {
      // Center of the bulge when `p` of the bar has poured out.
      if (dir === 'down') return { x: t.left + t.width / 2, y: t.top + t.height * p - sink }
      if (dir === 'up') return { x: t.left + t.width / 2, y: t.bottom - t.height * p + sink }
      if (dir === 'left') return { x: t.right - t.width * p + sink, y: t.top + t.height / 2 }
      return { x: t.left + t.width * p - sink, y: t.top + t.height / 2 }
    }
    const start = lead(0)
    const bulge = blob({ x: start.x - pd / 2, y: start.y - pd / 2, w: pd, h: pd, r: pd / 2 })
    const at = (p: number, sc: number) => {
      const c = lead(p)
      return `translate(${c.x - start.x}px, ${c.y - start.y}px) scale(${sc})`
    }
    const bAnim = bulge.animate(
      [
        { transform: at(0, 0.4), opacity: 1, easing: FLOW },
        // Rides the front while it pours (the bar is 88% out at this point)…
        { transform: at(0.88, 1), opacity: 1, offset: 0.55, easing: SETTLE },
        // …then sinks back as the front flattens into the bar's rounded end.
        { transform: at(0.92, 0.55), opacity: 1, offset: 0.78 },
        { transform: at(0.92, 0.2), opacity: 0 },
      ],
      { duration: step.duration, delay, fill: 'forwards' }, // same timeline as the bar it rides on
    )
    retire(bulge, bAnim)

    // The neck: a membrane at the source's edge, fused with the bar's root,
    // that thins and lets go once the bar has formed.
    const nd = Math.min(vertical ? t.width : t.height, 90) * 0.7
    const root =
      dir === 'down' ? { x: t.left + t.width / 2, y: (s.bottom + t.top) / 2 }
      : dir === 'up' ? { x: t.left + t.width / 2, y: (s.top + t.bottom) / 2 }
      : dir === 'left' ? { x: (s.left + t.right) / 2, y: t.top + t.height / 2 }
      : { x: (s.right + t.left) / 2, y: t.top + t.height / 2 }
    const neck = blob({ x: root.x - nd / 2, y: root.y - nd / 2, w: nd, h: nd, r: nd / 2 })
    const squeeze = vertical ? 'scale(0.35, 1.25)' : 'scale(1.25, 0.35)'
    const nAnim = neck.animate(
      [
        { transform: 'scale(0.6)', opacity: 1, easing: SWELL },
        { transform: 'scale(1)', opacity: 1, offset: 0.25, easing: FLOW },
        { transform: squeeze, opacity: 1, offset: 0.6 },
        { transform: 'scale(0)', opacity: 1, offset: 0.75 },
        { transform: 'scale(0)', opacity: 0 },
      ],
      { duration: step.duration, delay, fill: 'forwards' },
    )
    retire(neck, nAnim)
  }

  reveal(el, step, 0.74)
}

/** The globe: fades up and settles from slightly smaller. */
export function riseIn(el: Element | null, step: Step) {
  if (!el || reduced) return
  el.animate(
    [
      { transform: 'scale(0.86)', opacity: 0 },
      { transform: 'none', opacity: 1 },
    ],
    { duration: step.duration, delay: delayFor(step.at), easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'backwards' },
  )
}
