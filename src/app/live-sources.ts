/* Live adapters over the WebExtension APIs. Each loader returns a TreeNode
   tree for the explorer; ops perform real mutations; watchers fire a
   callback (debounced by the caller) whenever the underlying data changes.
   Everything degrades: when an API is missing (plain-browser dev preview),
   `live.*` is false and the UI falls back to preview data. */

import { F, L, type FolderNode, type TreeNode } from './model'

declare const window: Window & { browser?: typeof browser }
const api = typeof window !== 'undefined' ? window.browser : undefined

export const live = {
  tabs: Boolean(api?.tabs?.query),
  bookmarks: Boolean(api?.bookmarks?.getTree),
  history: Boolean(api?.history?.search),
}

/* ---------------- Open Tabs ---------------- */

export async function loadTabs(): Promise<TreeNode[]> {
  if (!api) return []
  const all = await api.tabs.query({})
  const self = await api.tabs.getCurrent().catch(() => undefined)
  const byWindow = new Map<number, TreeNode[]>()
  for (const t of all) {
    if (t.id === undefined || t.windowId === undefined) continue
    if (self?.id !== undefined && t.id === self.id) continue // don't list this new-tab page itself
    const kids = byWindow.get(t.windowId) ?? []
    kids.push(
      L(t.title || t.url || 'Untitled tab', t.url ?? '', {
        tabId: t.id,
        windowId: t.windowId,
        when: t.active ? 'active' : 'open',
        favicon: t.favIconUrl,
      }),
    )
    byWindow.set(t.windowId, kids)
  }
  const windows = [...byWindow.entries()].sort((a, b) => a[0] - b[0])
  return windows.map(([winId, kids], i) => F(`Window ${i + 1}`, kids, { windowId: winId }))
}

export async function activateTab(tabId: number, windowId?: number): Promise<void> {
  if (!api) return
  await api.tabs.update(tabId, { active: true })
  if (windowId !== undefined) await api.windows.update(windowId, { focused: true })
}

export async function closeTab(tabId: number): Promise<void> {
  if (!api) return
  await api.tabs.remove(tabId)
}

export async function openUrl(url: string, background = false): Promise<void> {
  if (!api) {
    window.location.assign(url)
    return
  }
  await api.tabs.create({ url, active: !background })
}

export function watchTabs(cb: () => void): void {
  if (!api?.tabs?.onCreated) return
  for (const ev of [api.tabs.onCreated, api.tabs.onRemoved, api.tabs.onUpdated, api.tabs.onMoved, api.tabs.onActivated, api.tabs.onAttached])
    ev.addListener(cb)
}

/* ---------------- Bookmarks ---------------- */

function mapBookmark(n: WebExtBookmarkNode, locked: boolean): TreeNode | null {
  if (n.type === 'separator') return null
  if (n.url !== undefined && n.type !== 'folder') {
    return L(n.title || n.url, n.url, { bmId: n.id })
  }
  const kids: TreeNode[] = []
  for (const c of n.children ?? []) {
    const m = mapBookmark(c, false)
    if (m) kids.push(m)
  }
  return F(n.title || 'Untitled folder', kids, { bmId: n.id, locked })
}

export async function loadBookmarks(): Promise<TreeNode[]> {
  if (!api) return []
  const [root] = await api.bookmarks.getTree()
  const out: TreeNode[] = []
  for (const top of root?.children ?? []) {
    // top-level containers (Toolbar / Menu / Other / Mobile) are locked roots
    const m = mapBookmark(top, true)
    if (m && !(m.type === 'folder' && m.children.length === 0 && m.title === 'Mobile Bookmarks')) out.push(m)
  }
  return out
}

export async function renameBookmark(bmId: string, title: string): Promise<void> {
  if (api) await api.bookmarks.update(bmId, { title })
}
export async function removeBookmark(bmId: string, isFolder: boolean): Promise<void> {
  if (!api) return
  if (isFolder) await api.bookmarks.removeTree(bmId)
  else await api.bookmarks.remove(bmId)
}
export async function moveBookmark(bmId: string, newParentBmId: string): Promise<void> {
  if (api) await api.bookmarks.move(bmId, { parentId: newParentBmId })
}
/** Create a bookmark; parent defaults to "Other Bookmarks" when omitted. */
export async function createBookmark(title: string, url: string, parentBmId?: string): Promise<void> {
  if (api) await api.bookmarks.create({ parentId: parentBmId ?? 'unfiled_____', title, url })
}

export function watchBookmarks(cb: () => void): void {
  if (!api?.bookmarks?.onCreated) return
  for (const ev of [api.bookmarks.onCreated, api.bookmarks.onChanged, api.bookmarks.onMoved, api.bookmarks.onRemoved]) ev.addListener(cb)
}

/* ---------------- History ---------------- */

const DAY = 86_400_000

function timeLabel(t: number | undefined, style: 'time' | 'day'): string {
  if (!t) return ''
  const d = new Date(t)
  return style === 'time'
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { weekday: 'short' })
}

function hostOf(u: string): string {
  try {
    return new URL(u).host.replace(/^www\./, '')
  } catch {
    return u
  }
}

export async function loadHistory(): Promise<TreeNode[]> {
  if (!api) return []
  const now = Date.now()
  const todayStart = new Date(new Date(now).setHours(0, 0, 0, 0)).getTime()
  const search = (startTime: number, endTime: number, max: number): Promise<WebExtHistoryItem[]> =>
    api.history.search({ text: '', startTime, endTime, maxResults: max })

  const [today, yesterday, week] = await Promise.all([
    search(todayStart, now, 300),
    search(todayStart - DAY, todayStart, 300),
    search(todayStart - 7 * DAY, todayStart - DAY, 500),
  ])

  const toNodes = (items: WebExtHistoryItem[], style: 'time' | 'day'): TreeNode[] =>
    items
      .filter((h) => h.url)
      .map((h) => L(h.title || h.url || '', h.url ?? '', { when: timeLabel(h.lastVisitTime, style) }))

  /* By-site: group the whole 7-day window (incl. today) by host */
  const byHost = new Map<string, TreeNode[]>()
  for (const h of [...today, ...yesterday, ...week]) {
    if (!h.url) continue
    const host = hostOf(h.url)
    const kids = byHost.get(host) ?? []
    kids.push(L(h.title || h.url, h.url, { when: timeLabel(h.lastVisitTime, 'day') }))
    byHost.set(host, kids)
  }
  const siteFolders = [...byHost.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 15)
    .map(([host, kids]) => F(host, kids))

  return [
    F('Today', toNodes(today, 'time')),
    F('Yesterday', toNodes(yesterday, 'time')),
    F('Last 7 days', toNodes(week, 'day')),
    F('By site', siteFolders),
  ]
}

/** Removes every visit of this URL from history. */
export async function deleteHistoryUrl(url: string): Promise<void> {
  if (api) await api.history.deleteUrl({ url })
}

export function watchHistory(cb: () => void): void {
  if (!api?.history?.onVisited) return
  for (const ev of [api.history.onVisited, api.history.onVisitRemoved]) ev.addListener(cb)
}
