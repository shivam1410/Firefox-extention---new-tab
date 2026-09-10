/* Rich icon & title pipeline (background event page).
   Runs here because host-permissioned fetch bypasses CORS and Firefox MV3
   backgrounds are real pages → DOMParser + canvas are available.
   No durable in-memory state: everything cacheable lives in storage.local,
   so it survives event-page unloads. Requires the optional <all_urls>
   permission — without it, callers just get {} and fall back to monograms. */

export interface MetaResult {
  title?: string
  icon?: string // small data: URL
}

interface IconEntry {
  icon?: string
  fetchedAt: number
  failUntil?: number
}
interface TitleEntry {
  title: string
  fetchedAt: number
}

const ICON_KEY = 'iconCache' // by origin
const TITLE_KEY = 'titleCache' // by url
const FRESH_MS = 14 * 86_400_000
const FAIL_MS = 24 * 3_600_000
const inflight = new Map<string, Promise<MetaResult>>()

async function getCache<T>(key: string): Promise<Record<string, T>> {
  const box = await browser.storage.local.get(key)
  return (box[key] as Record<string, T> | undefined) ?? {}
}

export async function ensureMeta(url: string): Promise<MetaResult> {
  let origin: string
  try {
    origin = new URL(url).origin
  } catch {
    return {}
  }
  if (!(await browser.permissions.contains({ origins: ['<all_urls>'] }))) return {}

  const [icons, titles] = await Promise.all([getCache<IconEntry>(ICON_KEY), getCache<TitleEntry>(TITLE_KEY)])
  const iconHit = icons[origin]
  const titleHit = titles[url]
  const now = Date.now()
  if (iconHit?.failUntil && iconHit.failUntil > now) return { title: titleHit?.title }
  if (iconHit && now - iconHit.fetchedAt < FRESH_MS && titleHit && now - titleHit.fetchedAt < FRESH_MS)
    return { title: titleHit.title, icon: iconHit.icon }

  const running = inflight.get(url)
  if (running) return running
  const p = fetchMeta(url, origin).finally(() => inflight.delete(url))
  inflight.set(url, p)
  return p
}

async function fetchMeta(url: string, origin: string): Promise<MetaResult> {
  try {
    const res = await fetch(url, { credentials: 'omit', redirect: 'follow', signal: AbortSignal.timeout(8000) })
    const html = (await res.text()).slice(0, 400_000)
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const base = res.url || url

    const title =
      doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim() ||
      doc.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() ||
      doc.title.trim() ||
      undefined

    const iconUrl = pickIconUrl(doc, base, origin)
    const icon = iconUrl ? await fetchIconAsDataUrl(iconUrl) : undefined

    const [icons, titles] = await Promise.all([getCache<IconEntry>(ICON_KEY), getCache<TitleEntry>(TITLE_KEY)])
    icons[origin] = icon ? { icon, fetchedAt: Date.now() } : { fetchedAt: Date.now(), failUntil: Date.now() + FAIL_MS }
    if (title) titles[url] = { title, fetchedAt: Date.now() }
    await browser.storage.local.set({ [ICON_KEY]: icons, [TITLE_KEY]: titles })
    return { title, icon }
  } catch {
    const icons = await getCache<IconEntry>(ICON_KEY)
    icons[origin] = { fetchedAt: Date.now(), failUntil: Date.now() + FAIL_MS }
    await browser.storage.local.set({ [ICON_KEY]: icons })
    return {}
  }
}

function pickIconUrl(doc: Document, base: string, origin: string): string | null {
  const abs = (href: string): string | null => {
    try {
      return new URL(href, base).href
    } catch {
      return null
    }
  }
  const touch = [...doc.querySelectorAll<HTMLLinkElement>('link[rel~="apple-touch-icon"]')]
    .map((l) => ({ href: l.getAttribute('href'), size: parseInt(l.getAttribute('sizes') ?? '180', 10) || 180 }))
    .sort((a, b) => b.size - a.size)[0]
  if (touch?.href) return abs(touch.href)
  const icon = [...doc.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')]
    .map((l) => ({ href: l.getAttribute('href'), size: parseInt(l.getAttribute('sizes') ?? '32', 10) || 32 }))
    .sort((a, b) => b.size - a.size)[0]
  if (icon?.href) return abs(icon.href)
  return `${origin}/favicon.ico`
}

async function fetchIconAsDataUrl(iconUrl: string): Promise<string | undefined> {
  try {
    const res = await fetch(iconUrl, { credentials: 'omit', signal: AbortSignal.timeout(8000) })
    if (!res.ok) return undefined
    const blob = await res.blob()
    if (blob.size === 0 || blob.size > 512_000) return undefined
    const bitmap = await createImageBitmap(blob)
    const size = 64
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    ctx.drawImage(bitmap, 0, 0, size, size)
    return canvas.toDataURL('image/png')
  } catch {
    return undefined
  }
}
