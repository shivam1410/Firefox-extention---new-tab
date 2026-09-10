/* Page-side client for the background rich-icon/title pipeline.
   Keeps an in-memory origin → data-URL icon map; callers queue URLs after
   rendering and get a single callback when new icons arrive. Silently does
   nothing in plain-browser dev preview or before the permission opt-in. */

declare const window: Window & { browser?: typeof browser }
const api = typeof window !== 'undefined' ? window.browser : undefined

interface MetaResult {
  title?: string
  icon?: string
}

const icons = new Map<string, string>()
const asked = new Set<string>()

function originOf(url: string): string | null {
  try {
    const u = new URL(url)
    return /^https?:$/.test(u.protocol) ? u.origin : null
  } catch {
    return null
  }
}

/** Cached icon (data: URL) for a page URL, if the pipeline fetched one. */
export function iconFor(url: string): string | undefined {
  const o = originOf(url)
  return o ? icons.get(o) : undefined
}

/** Fetch title+icon for one URL (used for auto-titling new links). */
export async function fetchMeta(url: string): Promise<MetaResult> {
  if (!api?.runtime?.sendMessage) return {}
  try {
    const r = (await api.runtime.sendMessage({ type: 'meta.ensure', url })) as MetaResult | undefined
    const o = originOf(url)
    if (r?.icon && o) icons.set(o, r.icon)
    return r ?? {}
  } catch {
    return {}
  }
}

/** Queue icon lookups for many URLs; fires onDone once if anything new arrived. */
export function queueIcons(urls: string[], onDone: () => void): void {
  if (!api?.runtime?.sendMessage) return
  const need = [...new Set(urls.map(originOf).filter((o): o is string => Boolean(o)))].filter(
    (o) => !icons.has(o) && !asked.has(o),
  )
  if (!need.length) return
  const byOrigin = new Map<string, string>()
  for (const u of urls) {
    const o = originOf(u)
    if (o && need.includes(o) && !byOrigin.has(o)) byOrigin.set(o, u)
  }
  need.forEach((o) => asked.add(o))
  void Promise.allSettled(
    [...byOrigin.entries()].map(async ([o, u]) => {
      const r = await fetchMeta(u)
      return Boolean(r.icon) && icons.has(o)
    }),
  ).then((results) => {
    if (results.some((r) => r.status === 'fulfilled' && r.value)) onDone()
  })
}

export async function richIconsEnabled(): Promise<boolean> {
  if (!api?.permissions?.contains) return false
  try {
    return await api.permissions.contains({ origins: ['<all_urls>'] })
  } catch {
    return false
  }
}

/** Must be called from a user gesture (button click) in an extension page. */
export async function requestRichIcons(): Promise<boolean> {
  if (!api?.permissions?.request) return false
  try {
    const ok = await api.permissions.request({ origins: ['<all_urls>'] })
    if (ok) asked.clear() // retry origins that were skipped pre-permission
    return ok
  } catch {
    return false
  }
}
