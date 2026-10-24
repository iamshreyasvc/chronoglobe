import { useEffect, useRef, useState } from 'react'
import { AboutContent, type AboutInfo } from './AboutDrawer'
import { Logo } from './Logo'

/**
 * The logo, which is also the About menu. One glass shape that grows in two
 * steps: on hover it first stretches sideways into a pill with the name (like
 * the filter bubble), then the About content drops down from it. Leaving
 * reverses the motion. A click pins it open; Esc or ✕ closes it.
 * On first load the name shows for a few seconds as an introduction.
 */
export function BrandMenu({ info }: { info: AboutInfo }) {
  const [intro, setIntro] = useState(true)
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    const t = setTimeout(() => setIntro(false), 3500)
    return () => clearTimeout(t)
  }, [])

  const close = () => {
    setOpen(false)
    setPinned(false)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const state = open ? 'is-open' : intro ? 'is-intro' : ''

  return (
    <div
      className={`glass brand-menu ${state}`}
      onPointerEnter={(e) => {
        if (e.pointerType !== 'mouse') return
        clearTimeout(closeTimer.current)
        setOpen(true)
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== 'mouse' || pinned) return
        closeTimer.current = setTimeout(() => setOpen(false), 400)
      }}
    >
      <div className="brand-row">
        <button
          className="brand"
          onClick={() => {
            if (open && pinned) close()
            else {
              setOpen(true)
              setPinned(true)
            }
          }}
          aria-expanded={open}
          aria-controls="about-menu"
          aria-label="About Chronoglobe"
        >
          <Logo />
          <span className="brand-text" aria-hidden>
            <span className="brand-name">Chronoglobe</span>
            <span className="brand-tagline">History from Wikipedia, mapped</span>
          </span>
        </button>
        <button className="glass-button brand-close" onClick={close} aria-label="Close" tabIndex={open ? 0 : -1}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div className="brand-drop" id="about-menu" aria-hidden={!open} inert={!open || undefined}>
        <div className="brand-drop-inner">
          <AboutContent open={open} info={info} />
        </div>
      </div>
    </div>
  )
}
