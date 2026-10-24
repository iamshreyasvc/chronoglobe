import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArcGisMapServerImageryProvider,
  BillboardGraphics,
  Cartesian2,
  Cartesian3,
  Ellipsoid,
  EllipsoidalOccluder,
  CustomDataSource,
  Entity,
  HeightReference,
  HorizontalOrigin,
  Math as CMath,
  ImageryLayer,
  Ion,
  NearFarScalar,
  SceneTransforms,
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
import { loadPhoto, markerGeometry, markerImage, type MarkerImage, type MarkerSpec } from '../lib/markerArt'
import type { ViewRect } from '../lib/area'
import { INTRO, divideFrom, rememberedRect, riseIn } from '../lib/intro'

const ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined

/** How many of the most notable visible events are drawn as photo bubbles. */
const MAX_BUBBLES = 45
const MARKER_SCALE = new NearFarScalar(1e5, 1.2, 2e7, 0.8)
/** Extra space kept between markers/labels, CSS px */
const SPACING = 3
/** Minimum time between collision passes while the camera moves */
const DECLUTTER_MS = 100
/** Floating UI that markers must not peek out from under */
const UI_SELECTOR = '.brand-menu, .filter-bubble, .home-button, .search-bar, .search-results, .place-chip, .panel, .timeline'
const UI_OWNER = '__ui'

type Placement = { mode: 'full' | 'dot' | 'hidden'; hidden: number }

interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
  owner: string
}

/** Markers scale with distance; same interpolation Cesium applies for MARKER_SCALE. */
function scaleAt(distance: number): number {
  const { near, nearValue, far, farValue } = MARKER_SCALE
  const t = Math.min(1, Math.max(0, (distance - near) / (far - near)))
  return nearValue + (farValue - nearValue) * t
}

/** Uniform grid of placed rectangles for fast overlap checks. */
class CollisionGrid {
  private cells = new Map<number, Rect[]>()
  private static SIZE = 96
  private keys(r: Rect): number[] {
    const out: number[] = []
    const s = CollisionGrid.SIZE
    for (let gx = Math.floor(r.x0 / s); gx <= Math.floor(r.x1 / s); gx++)
      for (let gy = Math.floor(r.y0 / s); gy <= Math.floor(r.y1 / s); gy++) out.push(gx * 100003 + gy)
    return out
  }
  /** Owner of the first placed rect that overlaps r, or null. */
  hit(r: Rect): string | null {
    for (const k of this.keys(r))
      for (const o of this.cells.get(k) ?? [])
        if (r.x0 < o.x1 && r.x1 > o.x0 && r.y0 < o.y1 && r.y1 > o.y0) return o.owner
    return null
  }
  add(r: Rect) {
    for (const k of this.keys(r)) {
      let list = this.cells.get(k)
      if (!list) this.cells.set(k, (list = []))
      list.push(r)
    }
  }
}

interface Props {
  events: HistEvent[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** Changes whenever the camera should fly to the selected event */
  flyNonce: number
  /** Changes whenever new thumbnails are available */
  thumbVersion: number
  /** Camera height in meters, reported when the camera stops moving */
  onCameraHeight?: (h: number) => void
  /** Visible area in degrees, reported when the camera stops moving */
  onViewChange?: (rect: ViewRect) => void
  /** Event to emphasize (hovered in the side panel) */
  highlightId?: string | null
  /** Fly to a place; a new `nonce` triggers the flight */
  focus?: { lat: number; lon: number; height: number; nonce: number } | null
}

function billboard(img: MarkerImage): BillboardGraphics {
  return new BillboardGraphics({
    image: img.url,
    width: img.width,
    height: img.height,
    horizontalOrigin: HorizontalOrigin.LEFT,
    verticalOrigin: VerticalOrigin.CENTER,
    // Put the marker's center (not the image's left edge) on the location.
    pixelOffset: new Cartesian2(-img.anchorX, 0),
    pixelOffsetScaleByDistance: MARKER_SCALE,
    scaleByDistance: MARKER_SCALE,
    heightReference: HeightReference.CLAMP_TO_GROUND,
  })
}

/** Whole-globe view; pulled back on portrait screens so the globe fits the width. */
function homeDestination(canvas: HTMLCanvasElement): Cartesian3 {
  const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight)
  const height = aspect < 1 ? 2.0e7 * Math.min(1.6, 0.6 / aspect) : 2.0e7
  return Cartesian3.fromDegrees(15, 30, height)
}

export function Globe({ events, selectedId, onSelect, flyNonce, thumbVersion, onCameraHeight, focus, highlightId, onViewChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<Viewer | null>(null)
  const sourceRef = useRef<CustomDataSource | null>(null)
  const eventsById = useRef(new Map<string, HistEvent>())
  /** id -> loaded photo, for events currently shown as photo bubbles */
  const photos = useRef(new Map<string, { key: string; canvas: HTMLCanvasElement }>())
  const positions = useRef(new Map<string, Cartesian3>())
  /** Result of the last collision pass */
  const placement = useRef(new Map<string, Placement>())
  /** Set when events, photos or selection change, so the next frame re-places markers */
  const dirty = useRef(true)
  const selectedRef = useRef(selectedId)
  selectedRef.current = selectedId
  const highlightRef = useRef(highlightId)
  highlightRef.current = highlightId
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const onCameraHeightRef = useRef(onCameraHeight)
  onCameraHeightRef.current = onCameraHeight
  const onViewChangeRef = useRef(onViewChange)
  onViewChangeRef.current = onViewChange
  const [hover, setHover] = useState<{ x: number; y: number; event: HistEvent } | null>(null)
  /** id -> description of the marker currently shown, to skip no-op updates */
  const applied = useRef(new Map<string, string>())

  const specFor = (e: HistEvent, label: boolean, hidden = 0): MarkerSpec => ({
    title: e.title,
    color: CATEGORY_META[e.category].color,
    sitelinks: e.sitelinks,
    photo: photos.current.get(e.id),
    label,
    // A hovered event is drawn like the selected one: larger, with its full name.
    selected: e.id === selectedRef.current || e.id === highlightRef.current,
    hidden,
  })

  /** Show an entity as placed: marker with name, marker only, or hidden. */
  const applyGraphics = (ent: Entity, e: HistEvent) => {
    const p = placement.current.get(e.id) ?? { mode: 'hidden', hidden: 0 }
    const spec = specFor(e, p.mode === 'full', p.hidden)
    const state = p.mode === 'hidden' ? 'hidden' : `${spec.photo?.key ?? ''}|${spec.label}|${spec.selected}|${p.hidden}`
    if (applied.current.get(e.id) === state) return
    applied.current.set(e.id, state)
    ent.show = p.mode !== 'hidden'
    if (ent.show) ent.billboard = billboard(markerImage(spec))
  }

  /**
   * Label placement, as map apps do it: project every event to the screen and
   * place them in priority order (selected, photo bubbles, then notability).
   * Each gets its marker and name if both fit, else just the marker, else it
   * is hidden and counted on the marker that covers it ("+N"). Nothing that
   * is drawn overlaps.
   */
  const declutter = () => {
    const viewer = viewerRef.current
    const coll = sourceRef.current?.entities
    if (!viewer || !coll) return
    const scene = viewer.scene
    const camPos = scene.camera.positionWC
    const occluder = new EllipsoidalOccluder(Ellipsoid.WGS84, camPos)
    const sel = selectedRef.current
    const hi = highlightRef.current
    const rank = (e: HistEvent) =>
      (e.id === sel ? 2e9 : e.id === hi ? 1e9 : photos.current.has(e.id) ? 1e6 : 0) + e.sitelinks
    const ordered = [...eventsById.current.values()].sort((a, b) => rank(b) - rank(a))

    const grid = new CollisionGrid()
    const next = new Map<string, Placement>()
    // Reserve the space taken by floating UI.
    const origin = viewer.canvas.getBoundingClientRect()
    for (const el of document.querySelectorAll(UI_SELECTOR)) {
      const r = el.getBoundingClientRect()
      if (r.width && r.height)
        grid.add({ x0: r.left - origin.left, y0: r.top - origin.top, x1: r.right - origin.left, y1: r.bottom - origin.top, owner: UI_OWNER })
    }
    const win = new Cartesian2()
    const rectOf = (e: HistEvent, label: boolean, s: number): Rect => {
      const g = markerGeometry(specFor(e, label))
      const left = win.x - g.anchorX * s
      const top = win.y - (g.height / 2) * s
      return {
        x0: left + g.pad * s - SPACING,
        y0: top + g.pad * s - SPACING,
        x1: left + (g.width - g.pad) * s + SPACING,
        y1: top + (g.height - g.pad) * s + SPACING,
        owner: e.id,
      }
    }

    for (const e of ordered) {
      const pos = positions.current.get(e.id)!
      if (!occluder.isPointVisible(pos) || !SceneTransforms.worldToWindowCoordinates(scene, pos, win)) {
        next.set(e.id, { mode: 'hidden', hidden: 0 })
        continue
      }
      const s = scaleAt(Cartesian3.distance(camPos, pos))
      const full = rectOf(e, true, s)
      const onScreen = full.x0 >= 0 && full.y0 >= 0 && full.x1 <= origin.width && full.y1 <= origin.height
      if (e.id === sel || e.id === hi || (onScreen && !grid.hit(full))) { // selected/hovered always show
        grid.add(full)
        next.set(e.id, { mode: 'full', hidden: 0 })
        continue
      }
      const dot = rectOf(e, false, s)
      const blocker = grid.hit(dot)
      if (!blocker) {
        grid.add(dot)
        next.set(e.id, { mode: 'dot', hidden: 0 })
      } else {
        next.set(e.id, { mode: 'hidden', hidden: 0 })
        if (blocker !== UI_OWNER) next.get(blocker)!.hidden++
      }
    }

    placement.current = next
    for (const e of eventsById.current.values()) {
      const ent = coll.getById(e.id)
      if (ent) applyGraphics(ent, e)
    }
  }

  // ---- intro: the globe button divides off the search bar, then the globe rises in ----
  const homeRef = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    divideFrom(homeRef.current, rememberedRect('search'), INTRO.home)
    riseIn(containerRef.current, INTRO.globe)
  }, [])

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
    // Render at the device's pixel ratio instead of CSS pixels (sharp on Retina).
    viewer.useBrowserRecommendedResolution = false
    viewer.scene.globe.enableLighting = false
    viewer.scene.globe.depthTestAgainstTerrain = false
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 500
    viewer.camera.setView({ destination: homeDestination(viewer.canvas) })

    const onCameraStop = () => {
      onCameraHeightRef.current?.(viewer.camera.positionCartographic.height)
      const r = viewer.camera.computeViewRectangle()
      onViewChangeRef.current?.(
        r
          ? { west: CMath.toDegrees(r.west), south: CMath.toDegrees(r.south), east: CMath.toDegrees(r.east), north: CMath.toDegrees(r.north) }
          : { west: -180, south: -90, east: 180, north: 90 },
      )
      dirty.current = true
    }
    viewer.camera.moveEnd.addEventListener(onCameraStop)
    // Re-place markers after each rendered frame when the view or the data
    // changed, at most every DECLUTTER_MS while moving.
    let lastRun = 0
    const lastView = new Cartesian3()
    const lastDir = new Cartesian3()
    // Floating UI can move (the panel slides under search results, the filter
    // bubble expands); markers must then re-flow around it.
    let uiCheck = 0
    let uiSignature = ''
    const uiMoved = (now: number) => {
      if (now - uiCheck < 250) return false
      uiCheck = now
      let sig = ''
      for (const el of document.querySelectorAll(UI_SELECTOR)) {
        const r = el.getBoundingClientRect()
        sig += `${r.left | 0},${r.top | 0},${r.width | 0},${r.height | 0};`
      }
      if (sig === uiSignature) return false
      uiSignature = sig
      return true
    }
    viewer.scene.postRender.addEventListener(() => {
      const cam = viewer.camera
      if (uiMoved(performance.now())) dirty.current = true
      const moved = !cam.positionWC.equalsEpsilon(lastView, 0, 1) || !cam.directionWC.equalsEpsilon(lastDir, 1e-7)
      if (!moved && !dirty.current) return
      const now = performance.now()
      if (now - lastRun < DECLUTTER_MS) return
      lastRun = now
      Cartesian3.clone(cam.positionWC, lastView)
      Cartesian3.clone(cam.directionWC, lastDir)
      dirty.current = false
      declutter()
    })

    const source = new CustomDataSource('events')
    viewer.dataSources.add(source)

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction((m: { position: Cartesian2 }) => {
      const picked = viewer.scene.pick(m.position)
      if (!defined(picked)) return onSelectRef.current(null)
      if (picked.id instanceof Entity && eventsById.current.has(picked.id.id)) {
        onSelectRef.current(picked.id.id)
      }
    }, ScreenSpaceEventType.LEFT_CLICK)
    handler.setInputAction((m: { endPosition: Cartesian2 }) => {
      const picked = viewer.scene.pick(m.endPosition)
      const ev =
        defined(picked) && picked.id instanceof Entity ? eventsById.current.get(picked.id.id) : undefined
      viewer.canvas.style.cursor = ev ? 'pointer' : ''
      setHover(ev ? { x: m.endPosition.x, y: m.endPosition.y, event: ev } : null)
    }, ScreenSpaceEventType.MOUSE_MOVE)

    viewerRef.current = viewer
    sourceRef.current = source
    onCameraStop()
    return () => {
      handler.destroy()
      viewer.destroy()
      viewerRef.current = null
      sourceRef.current = null
      photos.current.clear()
      applied.current.clear()
    }
  }, [])

  // ---- sync entities with events (diff by id) and load photo bubbles ----
  useEffect(() => {
    const source = sourceRef.current
    if (!source) return
    const next = new Map(events.map((e) => [e.id, e]))
    eventsById.current = next
    const coll = source.entities
    const byNotability = [...events].sort((a, b) => b.sitelinks - a.sitelinks)

    const wantPhoto = new Set(
      byNotability
        .filter((e) => getThumb(e.title))
        .slice(0, MAX_BUBBLES)
        .map((e) => e.id),
    )

    coll.suspendEvents()
    for (const ent of [...coll.values]) {
      if (!next.has(ent.id)) {
        coll.remove(ent)
        photos.current.delete(ent.id)
        applied.current.delete(ent.id)
        positions.current.delete(ent.id)
      }
    }
    // Drop photos for events that left the top set.
    for (const id of [...photos.current.keys()]) if (!wantPhoto.has(id)) photos.current.delete(id)
    for (const e of events) {
      if (coll.getById(e.id)) continue
      const position = Cartesian3.fromDegrees(e.lon, e.lat)
      positions.current.set(e.id, position)
      coll.add(new Entity({ id: e.id, position, show: false })) // shown once placed
    }
    coll.resumeEvents()
    dirty.current = true

    for (const id of wantPhoto) {
      if (photos.current.has(id)) continue
      const e = next.get(id)!
      const url = getThumb(e.title)!
      loadPhoto(url)
        .then((canvas) => {
          const ent = coll.getById(id)
          if (!ent || eventsById.current.get(id) !== e) return
          photos.current.set(id, { key: url, canvas })
          dirty.current = true
        })
        .catch(() => {}) // keep the dot if the image can't be loaded
    }
  }, [events, thumbVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- highlight the selected event ----
  useEffect(() => {
    dirty.current = true // the selected (or hovered) event is placed first, larger, with its full name
  }, [selectedId, highlightId])

  // ---- fly to the selected event ----
  useEffect(() => {
    const viewer = viewerRef.current
    const ev = selectedId ? eventsById.current.get(selectedId) : undefined
    if (!viewer || !ev || flyNonce === 0) return
    const height = Math.min(Math.max(viewer.camera.positionCartographic.height * 0.5, 4e5), 2.5e6)
    viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(ev.lon, ev.lat, height), duration: 1.6 })
  }, [flyNonce]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- fly to a place ----
  useEffect(() => {
    if (!focus) return
    viewerRef.current?.camera.flyTo({ destination: Cartesian3.fromDegrees(focus.lon, focus.lat, focus.height), duration: 2 })
  }, [focus?.nonce]) // eslint-disable-line react-hooks/exhaustive-deps

  const flyHome = () =>
    viewerRef.current &&
    viewerRef.current.camera.flyTo({ destination: homeDestination(viewerRef.current.canvas), duration: 1.5 })

  const hoverThumb = hover ? getThumb(hover.event.title) : null

  return (
    <div className="globe">
      <div ref={containerRef} className="globe-canvas" />
      <button ref={homeRef} className="glass glass-button home-button" onClick={flyHome} title="Reset view" aria-label="Reset view">
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
