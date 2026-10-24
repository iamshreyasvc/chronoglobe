import { useEffect, useSyncExternalStore } from 'react'
import { onThumbs, requestThumbs } from '../lib/wikipedia'

let version = 0
const listeners = new Set<() => void>()
onThumbs(() => {
  version++
  listeners.forEach((l) => l())
})

/**
 * Requests lead thumbnails for `titles` and returns a counter that changes
 * whenever new thumbnails arrive (read them with getThumb).
 */
export function useThumbs(titles: string[]): number {
  useEffect(() => {
    if (titles.length) requestThumbs(titles)
  }, [titles])
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => version,
  )
}
