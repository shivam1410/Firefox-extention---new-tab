/* Saved tabs — tabs the user deliberately keeps.
   Storage strategy:
   - Primary store: browser.storage.sync → backed up & synced through the
     user's Firefox account (same pipe as bookmarks; ~100KB quota).
   - Favicons are kept OUT of sync (quota) in a storage.local side-cache.
   - Best-effort mirror into a real bookmarks folder ("📑 Saved Tabs" under
     Other Bookmarks) so Firefox's native sync — including mobile — sees them.
   - Plain-browser dev preview falls back to page localStorage. */

declare const window: Window & { browser?: typeof browser }
const api = typeof window !== 'undefined' ? window.browser : undefined
const KEY = 'savedTabs'
const FAV_KEY = 'savedFavicons'
const MIRROR_FOLDER = '📑 Saved Tabs'

export interface SavedTab {
  id: string
  title: string
  url: string
  favicon?: string
  savedAt: number
}

/* ---------- storage areas ---------- */

function fromLocalStorage(): SavedTab[] {
  try {
    const raw = localStorage.getItem(`lt-${KEY}`)
    return raw ? (JSON.parse(raw) as SavedTab[]) : []
  } catch {
    return []
  }
}
function toLocalStorage(items: SavedTab[]): void {
  try {
    localStorage.setItem(`lt-${KEY}`, JSON.stringify(items))
  } catch {
    /* storage unavailable (permanent private browsing): saves won't persist */
  }
}

async function readArea(area: WebExtStorageArea): Promise<SavedTab[] | null> {
  try {
    const box = await area.get(KEY)
    const items = box[KEY]
    return Array.isArray(items) ? (items as SavedTab[]) : null
  } catch {
    return null
  }
}

async function faviconCache(): Promise<Record<string, string>> {
  if (!api?.storage?.local) return {}
  const box = await api.storage.local.get(FAV_KEY)
  return (box[FAV_KEY] as Record<string, string> | undefined) ?? {}
}

export async function loadSavedTabs(): Promise<SavedTab[]> {
  if (!api?.storage?.sync) return fromLocalStorage()
  let items = await readArea(api.storage.sync)
  if (items === null || items.length === 0) {
    // one-time migration from the old storage.local store
    const local = await readArea(api.storage.local)
    if (local && local.length) {
      items = local
      await writeSavedTabs(items)
    }
  }
  if (!items) return []
  const favs = await faviconCache()
  return items.map((s) => ({ ...s, favicon: s.favicon ?? favs[s.url] }))
}

async function writeSavedTabs(items: SavedTab[]): Promise<void> {
  if (!api?.storage?.sync) {
    toLocalStorage(items)
    return
  }
  // favicons go to the local side-cache, never into the sync quota
  const favs = await faviconCache()
  for (const s of items) if (s.favicon) favs[s.url] = s.favicon
  const lean = items.map(({ favicon: _favicon, ...rest }) => rest)
  try {
    await api.storage.sync.set({ [KEY]: lean })
  } catch {
    await api.storage.local.set({ [KEY]: lean }) // sync quota/unavailable → keep data safe locally
  }
  if (api.storage.local) await api.storage.local.set({ [FAV_KEY]: favs })
}

/* ---------- bookmarks mirror (best-effort) ---------- */

async function mirrorFolderId(): Promise<string | null> {
  if (!api?.bookmarks?.search) return null
  try {
    const hits = await api.bookmarks.search({ title: MIRROR_FOLDER })
    const folder = hits.find((h) => h.url === undefined)
    if (folder) return folder.id
    const created = await api.bookmarks.create({ parentId: 'unfiled_____', title: MIRROR_FOLDER })
    return created.id
  } catch {
    return null
  }
}
async function mirrorAdd(title: string, url: string): Promise<void> {
  const folderId = await mirrorFolderId()
  if (!folderId || !api) return
  try {
    const existing = (await api.bookmarks.search({ url })).filter((b) => b.parentId === folderId)
    if (!existing.length) await api.bookmarks.create({ parentId: folderId, title, url })
  } catch {
    /* mirror is best-effort; the sync store is the source of truth */
  }
}
async function mirrorRemove(url: string): Promise<void> {
  const folderId = await mirrorFolderId()
  if (!folderId || !api) return
  try {
    for (const b of (await api.bookmarks.search({ url })).filter((x) => x.parentId === folderId))
      await api.bookmarks.remove(b.id)
  } catch {
    /* best-effort */
  }
}
async function mirrorRename(url: string, title: string): Promise<void> {
  const folderId = await mirrorFolderId()
  if (!folderId || !api) return
  try {
    for (const b of (await api.bookmarks.search({ url })).filter((x) => x.parentId === folderId))
      await api.bookmarks.update(b.id, { title })
  } catch {
    /* best-effort */
  }
}

/* ---------- public API ---------- */

/** Saves a tab unless its URL is already saved. Returns true if added. */
export async function saveTab(tab: { title: string; url: string; favicon?: string }): Promise<boolean> {
  if (!tab.url) return false
  const items = await loadSavedTabs()
  if (items.some((s) => s.url === tab.url)) return false
  items.unshift({
    id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    title: tab.title || tab.url,
    url: tab.url,
    favicon: tab.favicon,
    savedAt: Date.now(),
  })
  await writeSavedTabs(items)
  void mirrorAdd(tab.title || tab.url, tab.url)
  return true
}

/** Saves every given tab (deduped); returns how many were new. */
export async function saveTabs(tabs: Array<{ title: string; url: string; favicon?: string }>): Promise<number> {
  let added = 0
  for (const t of tabs) if (await saveTab(t)) added++
  return added
}

export async function removeSavedTab(id: string): Promise<void> {
  const items = await loadSavedTabs()
  const hit = items.find((s) => s.id === id)
  await writeSavedTabs(items.filter((s) => s.id !== id))
  if (hit) void mirrorRemove(hit.url)
}

export async function renameSavedTab(id: string, title: string): Promise<void> {
  const items = await loadSavedTabs()
  const hit = items.find((s) => s.id === id)
  if (!hit) return
  hit.title = title
  await writeSavedTabs(items)
  void mirrorRename(hit.url, title)
}

/** Wholesale replace (used by cloud sync when adopting the remote copy). */
export async function replaceSavedTabs(items: SavedTab[]): Promise<void> {
  await writeSavedTabs(items)
}

/** Bulk-restore from a backup; existing URLs are kept, new ones added. Returns count added. */
export async function importSavedTabs(incoming: Array<Partial<SavedTab>>): Promise<number> {
  const items = await loadSavedTabs()
  const have = new Set(items.map((s) => s.url))
  let added = 0
  for (const t of incoming) {
    if (typeof t.url !== 'string' || !t.url || have.has(t.url)) continue
    items.push({
      id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      title: typeof t.title === 'string' && t.title ? t.title : t.url,
      url: t.url,
      favicon: typeof t.favicon === 'string' ? t.favicon : undefined,
      savedAt: typeof t.savedAt === 'number' ? t.savedAt : Date.now(),
    })
    have.add(t.url)
    added++
    void mirrorAdd(typeof t.title === 'string' && t.title ? t.title : t.url, t.url)
  }
  if (added) await writeSavedTabs(items)
  return added
}

export function watchSavedTabs(cb: () => void): void {
  api?.storage?.onChanged.addListener(cb)
}
