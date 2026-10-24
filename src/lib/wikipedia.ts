export interface WikiSummary {
  title: string
  description?: string
  extract: string
  thumbnail?: string
  /** Larger lead image for the hero banner */
  image?: string
  url: string
}

export interface WikiImage {
  src: string
  caption?: string
}

const summaryCache = new Map<string, Promise<WikiSummary>>()
const mediaCache = new Map<string, Promise<WikiImage[]>>()

const slug = (title: string) => encodeURIComponent(title.replace(/ /g, '_'))

export function articleUrl(title: string): string {
  return `https://en.wikipedia.org/wiki/${slug(title)}`
}

function cached<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let p = cache.get(key)
  if (!p) {
    p = load()
    p.catch(() => cache.delete(key)) // allow retry after a failure
    cache.set(key, p)
  }
  return p
}

export function fetchSummary(title: string): Promise<WikiSummary> {
  return cached(summaryCache, title, async () => {
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${slug(title)}`)
    if (!res.ok) throw new Error(`Wikipedia summary failed (${res.status})`)
    const j = await res.json()
    return {
      title: j.title ?? title,
      description: j.description,
      extract: j.extract ?? '',
      thumbnail: j.thumbnail?.source,
      image: j.originalimage?.source && j.originalimage.width <= 1600 ? j.originalimage.source : j.thumbnail?.source,
      url: j.content_urls?.desktop?.page ?? articleUrl(title),
    }
  })
}

/** Photos used in the article body, for the gallery. Skips icons, maps and flags. */
export function fetchMedia(title: string): Promise<WikiImage[]> {
  return cached(mediaCache, title, async () => {
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/media-list/${slug(title)}`)
    if (!res.ok) return []
    const j = await res.json()
    const out: WikiImage[] = []
    for (const it of j.items ?? []) {
      if (it.type !== 'image' || it.showInGallery === false) continue
      const name: string = it.title ?? ''
      if (/\.svg$/i.test(name) || /flag|icon|logo|symbol|coat_of_arms|locator|map/i.test(name)) continue
      const src: string | undefined = it.srcset?.[0]?.src
      if (!src) continue
      out.push({ src: src.startsWith('//') ? `https:${src}` : src, caption: it.caption?.text })
      if (out.length >= 12) break
    }
    return out
  })
}

// ---- batched lead thumbnails (up to 50 titles per request) ----

const thumbs = new Map<string, string | null>() // title -> url, null = no image
const thumbWaiters = new Set<() => void>()
const pendingTitles = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

export function getThumb(title: string): string | null | undefined {
  return thumbs.get(title)
}

/** Seed a known thumbnail (e.g. from search results) without a lookup. */
export function setThumb(title: string, url: string) {
  if (thumbs.get(title)) return
  thumbs.set(title, url)
  thumbWaiters.forEach((cb) => cb())
}

export function onThumbs(cb: () => void): () => void {
  thumbWaiters.add(cb)
  return () => thumbWaiters.delete(cb)
}

/** Queue titles for thumbnail lookup; listeners fire as batches resolve. */
export function requestThumbs(titles: string[]) {
  for (const t of titles) if (!thumbs.has(t)) pendingTitles.add(t)
  if (pendingTitles.size && !flushTimer) flushTimer = setTimeout(flushThumbs, 60)
}

async function flushThumbs() {
  flushTimer = null
  const titles = [...pendingTitles]
  pendingTitles.clear()
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50)
    batch.forEach((t) => thumbs.set(t, null)) // mark in-flight so we don't re-request
    try {
      const params = new URLSearchParams({
        action: 'query',
        prop: 'pageimages',
        piprop: 'thumbnail',
        pithumbsize: '250',
        redirects: '1',
        format: 'json',
        formatversion: '2',
        origin: '*',
        titles: batch.join('|'),
      })
      const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`)
      const j = await res.json()
      // Map normalized/redirected titles back to the titles we asked for.
      const alias = new Map<string, string>()
      for (const n of [...(j.query?.normalized ?? []), ...(j.query?.redirects ?? [])]) alias.set(n.to, n.from)
      for (const p of j.query?.pages ?? []) {
        if (!p.thumbnail?.source) continue
        let t: string = p.title
        while (alias.has(t) && !batch.includes(t)) t = alias.get(t)!
        thumbs.set(t, p.thumbnail.source)
      }
    } catch {
      batch.forEach((t) => thumbs.delete(t)) // retry on a later request
    }
    thumbWaiters.forEach((cb) => cb())
  }
}
