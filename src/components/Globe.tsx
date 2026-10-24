import { useEffect, useRef, useState } from 'react'
import {
  ArcGisMapServerImageryProvider,
  BillboardGraphics,
  Cartesian2,
  Cartesian3,
  Color,
  CustomDataSource,
  Entity,
  HeightReference,
  HorizontalOrigin,
  ImageryLayer,
  Ion,
  LabelGraphics,
  LabelStyle,
  NearFarScalar,
  PointGraphics,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Terrain,
  VerticalOrigin,
  Viewer,
  defined,
} from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import type { HistEvent } from '../types'
import { CATEGORY_META } from '../lib/categories'
import { getThumb } from '../lib/wikipedia'
import { formatYear } from '../lib/years'

const ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined

/** How many of the most notable visible events are drawn as photo bubbles. */
const MAX_BUBBLES = 45
const BUBBLE_PX = 54

interface Props {
  events: HistEvent[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** Changes whenever the camera should fly to the selected event */
  flyNonce: number
  /** Changes whenever new thumbnails are available */
  thumbVersion: number
}

// ---------- canvas art: glass cluster + photo bubbles ----------
// Real glass reads through edges, not white fill: a thin rim that is bright
// where light hits (top-left) and fades away from it, darker refraction at
// the edge, and one small, crisp specular highlight.

function glassFinish(g: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  // Edge refraction: the content darkens slightly toward the rim.
  const edge = g.createRadialGradient(cx, cy, r * 0.62, cx, cy, r)
  edge.addColorStop(0, 'rgba(0,0,0,0)')
  edge.addColorStop(1, 'rgba(0,0,0,0.32)')
  g.fillStyle = edge
  g.beginPath()
  g.arc(cx, cy, r, 0, Math.PI * 2)
  g.fill()

  // Small specular crescent near the top-left edge.
  g.save()
  g.beginPath()
  g.arc(cx, cy, r, 0, Math.PI * 2)
  g.clip()
  const spec = g.createLinearGradient(cx - r, cy - r, cx, cy)
  spec.addColorStop(0, 'rgba(255,255,255,0.38)')
  spec.addColorStop(1, 'rgba(255,255,255,0)')
  g.strokeStyle = spec
  g.lineWidth = r * 0.09
  g.lineCap = 'round'
  g.beginPath()
  g.arc(cx, cy, r * 0.8, Math.PI * 1.08, Math.PI * 1.42)
  g.stroke()
  g.restore()

  // Rim: light catches the top-left edge and fades toward the bottom-right.
  const rim = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r)
  rim.addColorStop(0, 'rgba(255,255,255,0.7)')
  rim.addColorStop(0.5, 'rgba(255,255,255,0.12)')
  rim.addColorStop(1, 'rgba(255,255,255,0.35)')
  g.strokeStyle = rim
  g.lineWidth = 1.5
  g.beginPath()
  g.arc(cx, cy, r - 0.75, 0, Math.PI * 2)
  g.stroke()
}

function dropShadow(g: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  g.save()
  g.shadowColor = 'rgba(0,0,0,0.45)'
  g.shadowBlur = 10
  g.shadowOffsetY = 3
  g.fillStyle = 'rgba(0,0,0,0.6)'
  g.beginPath()
  g.arc(cx, cy, r - 1, 0, Math.PI * 2)
  g.fill()
  g.restore()
}

const clusterIcons = new Map<string, HTMLCanvasElement>()

function clusterIcon(count: number): HTMLCanvasElement {
  const label = count >= 1000 ? `${Math.floor(count / 1000)}k` : String(count)
  const cached = clusterIcons.get(label)
  if (cached) return cached
  const size = count < 10 ? 38 : count < 100 ? 46 : 54
  const pad = 8
  const r = size - pad // drawn at 2x
  const c = document.createElement('canvas')
  c.width = c.height = size * 2
  const g = c.getContext('2d')!
  const cx = size
  dropShadow(g, cx, cx, r)
  // Keep the shadow only outside the disc so the body stays translucent.
  g.globalCompositeOperation = 'destination-out'
  g.beginPath()
  g.arc(cx, cx, r - 1, 0, Math.PI * 2)
  g.fill()
  g.globalCompositeOperation = 'source-over'
  g.fillStyle = 'rgba(30,41,59,0.55)'
  g.beginPath()
  g.arc(cx, cx, r, 0, Math.PI * 2)
  g.fill()
  glassFinish(g, cx, cx, r)
  g.fillStyle = '#fff'
  g.font = `600 ${size < 44 ? 24 : 27}px -apple-system, system-ui, sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(label, cx, cx + 1)
  clusterIcons.set(label, c)
  return c
}

const photoClusterIcons = new Map<string, HTMLCanvasElement>()

/** A cluster drawn as its most notable member's photo bubble plus a count badge. */
function photoClusterIcon(id: string, photo: HTMLCanvasElement, count: number): HTMLCanvasElement {
  const label = count >= 1000 ? `${Math.floor(count / 1000)}k` : String(count)
  const key = `${id}:${label}`
  const cached = photoClusterIcons.get(key)
  if (cached) return cached
  const r = BUBBLE_PX + 4 // drawn at 2x, a little larger than single bubbles
  const pad = 14
  const c = document.createElement('canvas')
  c.width = c.height = r * 2 + pad * 2
  const g = c.getContext('2d')!
  // A second glass disc peeking out behind, so it reads as a group.
  const bx0 = pad + r + 9
  const by0 = pad + r - 7
  g.fillStyle = 'rgba(30,41,59,0.45)'
  g.beginPath()
  g.arc(bx0, by0, r - 8, 0, Math.PI * 2)
  g.fill()
  glassFinish(g, bx0, by0, r - 8)
  g.drawImage(photo, pad, pad, r * 2, r * 2)
  // Count badge: small dark glass pill, top-right.
  const br = 19
  const bx = c.width - br - 3
  const by = br + 3
  dropShadow(g, bx, by, br)
  g.fillStyle = 'rgba(15,23,42,0.88)'
  g.beginPath()
  g.arc(bx, by, br, 0, Math.PI * 2)
  g.fill()
  glassFinish(g, bx, by, br)
  g.fillStyle = '#fff'
  g.font = `650 ${label.length > 2 ? 15 : 19}px -apple-system, system-ui, sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(label, bx, by + 1)
  photoClusterIcons.set(key, c)
  return c
}

const bubbles = new Map<string, Promise<HTMLCanvasElement>>()

function photoBubble(url: string, ring: string): Promise<HTMLCanvasElement> {
  const key = `${url}|${ring}`
  let p = bubbles.get(key)
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        const size = BUBBLE_PX // canvas is 2x the on-screen size
        const r = size - 8 // leave room for the drop shadow
        const c = document.createElement('canvas')
        c.width = c.height = size * 2
        const g = c.getContext('2d')!
        const cx = size
        dropShadow(g, cx, cx, r)
        g.save()
        g.beginPath()
        g.arc(cx, cx, r, 0, Math.PI * 2)
        g.clip()
        const s = Math.max((r * 2) / img.width, (r * 2) / img.height) // cover
        g.drawImage(img, cx - (img.width * s) / 2, cx - (img.height * s) / 2, img.width * s, img.height * s)
        g.restore()
        // Thin category tint just inside the rim.
        g.globalAlpha = 0.85
        g.strokeStyle = ring
        g.lineWidth = 3
        g.beginPath()
        g.arc(cx, cx, r - 2.5, 0, Math.PI * 2)
        g.stroke()
        g.globalAlpha = 1
        glassFinish(g, cx, cx, r)
        resolve(c)
      }
      img.onerror = reject
      img.src = url
    })
    bubbles.set(key, p)
  }
  return p
}

// ---------- entity graphics ----------

function pointSize(e: HistEvent): number {
  return 7 + Math.min(9, Math.sqrt(e.sitelinks) * 0.9)
}

function pointGraphics(e: HistEvent, selected: boolean): PointGraphics {
  const color = Color.fromCssColorString(CATEGORY_META[e.category].color)
  return new PointGraphics({
    pixelSize: pointSize(e) + (selected ? 7 : 0),
    color: color.withAlpha(0.9),
    outlineColor: selected ? Color.WHITE : Color.WHITE.withAlpha(0.7),
    outlineWidth: selected ? 3 : 1.5,
    heightReference: HeightReference.CLAMP_TO_GROUND,
    scaleByDistance: new NearFarScalar(1e5, 1.3, 2e7, 0.8),
  })
}

function bubbleGraphics(image: HTMLCanvasElement, selected: boolean): BillboardGraphics {
  return new BillboardGraphics({
    image,
    width: BUBBLE_PX * (selected ? 1.35 : 1),
    height: BUBBLE_PX * (selected ? 1.35 : 1),
    heightReference: HeightReference.CLAMP_TO_GROUND,
    verticalOrigin: VerticalOrigin.CENTER,
    scaleByDistance: new NearFarScalar(1e5, 1.25, 2e7, 0.7),
  })
}

function labelGraphics(e: HistEvent, hasBubble: boolean): LabelGraphics {
  return new LabelGraphics({
    text: e.title,
    font: '600 15px -apple-system, system-ui, sans-serif',
    fillColor: Color.WHITE,
    outlineColor: Color.fromCssColorString('rgba(0,0,0,0.75)'),
    outlineWidth: 4,
    style: LabelStyle.FILL_AND_OUTLINE,
    horizontalOrigin: HorizontalOrigin.LEFT,
    verticalOrigin: VerticalOrigin.CENTER,
    pixelOffset: new Cartesian2(hasBubble ? 44 : 16, 0),
    heightReference: HeightReference.CLAMP_TO_GROUND,
  })
}

// ---------- component ----------

export function Globe({ events, selectedId, onSelect, flyNonce, thumbVersion }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<Viewer | null>(null)
  const sourceRef = useRef<CustomDataSource | null>(null)
  const eventsById = useRef(new Map<string, HistEvent>())
  /** id -> rendered bubble canvas, for entities currently shown as bubbles */
  const bubbleImages = useRef(new Map<string, HTMLCanvasElement>())
  const selectedRef = useRef(selectedId)
  selectedRef.current = selectedId
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const [hover, setHover] = useState<{ x: number; y: number; event: HistEvent } | null>(null)

  // ---- create the viewer once ----
  useEffect(() => {
    if (ION_TOKEN) Ion.defaultAccessToken = ION_TOKEN

    const viewer = new Viewer(containerRef.current!, {
      baseLayer: ION_TOKEN
        ? ImageryLayer.fromWorldImagery({})
        : ImageryLayer.fromProviderAsync(
            ArcGisMapServerImageryProvider.fromUrl(
              'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
            ),
          ),
      terrain: ION_TOKEN ? Terrain.fromWorldTerrain() : undefined,
      baseLayerPicker: false,
      geocoder: false,
      timeline: false,
      animation: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      infoBox: false,
      selectionIndicator: false,
      fullscreenButton: false,
      homeButton: false,
    })
    viewer.scene.globe.enableLighting = false
    viewer.scene.globe.depthTestAgainstTerrain = false
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 500
    viewer.camera.setView({ destination: Cartesian3.fromDegrees(15, 35, 2.0e7) })

    const source = new CustomDataSource('events')
    source.clustering.enabled = true
    source.clustering.pixelRange = 34
    source.clustering.minimumClusterSize = 3
    source.clustering.clusterEvent.addEventListener((entities, cluster) => {
      // Lead the cluster with its most notable member that has a photo.
      let lead: Entity | undefined
      let best = -1
      for (const ent of entities) {
        const sl = eventsById.current.get(ent.id)?.sitelinks ?? 0
        if (sl > best && bubbleImages.current.has(ent.id)) {
          best = sl
          lead = ent
        }
      }
      const icon = lead
        ? photoClusterIcon(lead.id, bubbleImages.current.get(lead.id)!, entities.length)
        : clusterIcon(entities.length)
      cluster.label.show = false
      cluster.point.show = false
      cluster.billboard.show = true
      cluster.billboard.id = cluster.label.id
      cluster.billboard.image = icon as never
      cluster.billboard.width = icon.width / 2
      cluster.billboard.height = icon.height / 2
      cluster.billboard.verticalOrigin = VerticalOrigin.CENTER
    })
    viewer.dataSources.add(source)

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction((m: { position: Cartesian2 }) => {
      const picked = viewer.scene.pick(m.position)
      if (!defined(picked)) return onSelectRef.current(null)
      if (Array.isArray(picked.id)) {
        viewer.flyTo(picked.id as Entity[], { duration: 1.2 }) // cluster: zoom to members
      } else if (picked.id instanceof Entity && eventsById.current.has(picked.id.id)) {
        onSelectRef.current(picked.id.id)
      }
    }, ScreenSpaceEventType.LEFT_CLICK)
    handler.setInputAction((m: { endPosition: Cartesian2 }) => {
      const picked = viewer.scene.pick(m.endPosition)
      const ev =
        defined(picked) && picked.id instanceof Entity ? eventsById.current.get(picked.id.id) : undefined
      viewer.canvas.style.cursor = defined(picked) && (ev || Array.isArray(picked.id)) ? 'pointer' : ''
      setHover(ev ? { x: m.endPosition.x, y: m.endPosition.y, event: ev } : null)
    }, ScreenSpaceEventType.MOUSE_MOVE)

    viewerRef.current = viewer
    sourceRef.current = source
    return () => {
      handler.destroy()
      viewer.destroy()
      viewerRef.current = null
      sourceRef.current = null
      bubbleImages.current.clear()
    }
  }, [])

  // ---- sync markers with events (diff by id) and upgrade top events to photo bubbles ----
  useEffect(() => {
    const source = sourceRef.current
    if (!source) return
    const next = new Map(events.map((e) => [e.id, e]))
    eventsById.current = next
    const coll = source.entities

    coll.suspendEvents()
    for (const ent of [...coll.values]) {
      if (!next.has(ent.id)) {
        coll.remove(ent)
        bubbleImages.current.delete(ent.id)
      }
    }
    for (const e of events) {
      if (!coll.getById(e.id)) {
        coll.add(new Entity({ id: e.id, position: Cartesian3.fromDegrees(e.lon, e.lat), point: pointGraphics(e, false) }))
      }
    }

    const wanted = new Set(
      [...events]
        .sort((a, b) => b.sitelinks - a.sitelinks)
        .filter((e) => getThumb(e.title))
        .slice(0, MAX_BUBBLES)
        .map((e) => e.id),
    )
    // Downgrade events that dropped out of the top set back to dots.
    for (const id of [...bubbleImages.current.keys()]) {
      const ent = coll.getById(id)
      const e = next.get(id)
      if (!wanted.has(id) && ent && e) {
        bubbleImages.current.delete(id)
        ent.billboard = undefined
        ent.point = pointGraphics(e, id === selectedRef.current)
        if (ent.label) ent.label = labelGraphics(e, false)
      }
    }
    coll.resumeEvents()

    for (const id of wanted) {
      if (bubbleImages.current.has(id)) continue
      const e = next.get(id)!
      photoBubble(getThumb(e.title)!, CATEGORY_META[e.category].color)
        .then((img) => {
          const ent = coll.getById(id)
          if (!ent || eventsById.current.get(id) !== e) return
          bubbleImages.current.set(id, img)
          const sel = id === selectedRef.current
          ent.point = undefined
          ent.billboard = bubbleGraphics(img, sel)
          if (sel) ent.label = labelGraphics(e, true)
        })
        .catch(() => {}) // keep the dot if the image can't be loaded
    }
  }, [events, thumbVersion])

  // ---- highlight the selected event ----
  useEffect(() => {
    const coll = sourceRef.current?.entities
    if (!coll) return
    for (const ent of coll.values) {
      const e = eventsById.current.get(ent.id)
      if (!e) continue
      const sel = ent.id === selectedId
      const wasSel = !!ent.label
      if (sel === wasSel) continue
      const img = bubbleImages.current.get(ent.id)
      if (img) ent.billboard = bubbleGraphics(img, sel)
      else ent.point = pointGraphics(e, sel)
      ent.label = sel ? labelGraphics(e, !!img) : undefined
    }
  }, [selectedId, events])

  // ---- fly to the selected event ----
  useEffect(() => {
    const viewer = viewerRef.current
    const ev = selectedId ? eventsById.current.get(selectedId) : undefined
    if (!viewer || !ev || flyNonce === 0) return
    const height = Math.min(Math.max(viewer.camera.positionCartographic.height * 0.5, 4e5), 2.5e6)
    viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(ev.lon, ev.lat, height), duration: 1.6 })
  }, [flyNonce]) // eslint-disable-line react-hooks/exhaustive-deps

  const flyHome = () =>
    viewerRef.current?.camera.flyTo({ destination: Cartesian3.fromDegrees(15, 35, 2.0e7), duration: 1.5 })

  const hoverThumb = hover ? getThumb(hover.event.title) : null

  return (
    <div className="globe">
      <div ref={containerRef} className="globe-canvas" />
      <button className="glass glass-button home-button" onClick={flyHome} title="Reset view" aria-label="Reset view">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18" />
        </svg>
      </button>
      {hover && (
        <div className="glass tooltip" style={{ left: hover.x + 18, top: hover.y + 18 }}>
          {hoverThumb && <img src={hoverThumb} alt="" />}
          <div className="tooltip-body">
            <strong>{hover.event.title}</strong>
            <span className="tooltip-meta">
              <span className="dot" style={{ background: CATEGORY_META[hover.event.category].color }} />
              {CATEGORY_META[hover.event.category].label} · {formatYear(hover.event.year)}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
