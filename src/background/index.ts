// Event page (Firefox MV3). Holds no state anyone depends on — it can
// unload at any time; everything durable lives in storage.

import { ensureMeta } from './metadata'
import { captureTab } from './capture'
import { archivePage, listDatabases, listRecent, saveToNotion } from './notion'
import { llmSummarize, setOpenRouterConfig } from './llm'

async function flashBadge(text: string): Promise<void> {
  await browser.action.setBadgeBackgroundColor({ color: '#1E9E5A' })
  await browser.action.setBadgeText({ text })
  setTimeout(() => {
    void browser.action.setBadgeText({ text: '' })
  }, 1600)
}

/** Quick save: a lightweight Notion page — title, link, domain tag, date.
    No capture, no AI; works on any page and returns in ~a second. */
async function quickSaveToNotion(title: string, url: string): Promise<{ ok: boolean; message: string; pageUrl?: string }> {
  let domain = ''
  try {
    domain = new URL(url).host.replace(/^www\./, '')
  } catch {
    return { ok: false, message: 'That URL can\'t be saved.' }
  }
  const result = await saveToNotion({ title: title || url, url, summary: '', images: [], domain, tags: [domain] })
  if (result.ok) void browser.storage.local.set({ notionLastSave: Date.now() })
  void flashBadge(result.ok ? '✓' : '!')
  return result
}

/** Capture the live page, summarize, save to Notion. Keeps running even if
    the popup that requested it closes; the badge reports the outcome. */
async function saveTabToNotion(tabId: number): Promise<{ ok: boolean; message: string; pageUrl?: string }> {
  const captured = await captureTab(tabId)
  if (typeof captured === 'string') return { ok: false, message: captured }
  // upgrade the local extractive summary + tags to AI ones when a key is configured
  const ai = await llmSummarize(captured.title, captured.url, captured.fullText ?? captured.summary)
  if (ai) {
    captured.summary = ai.summary
    if (ai.tags.length) captured.tags = [captured.domain, ...ai.tags.filter((t) => t.toLowerCase() !== captured.domain)]
  }
  const result = await saveToNotion(captured)
  if (result.ok) void browser.storage.local.set({ notionLastSave: Date.now() }) // nudges open pages to refresh their Notion list
  void flashBadge(result.ok ? '✓' : '!')
  return result
}

// Message router for the app pages and the toolbar popup.
browser.runtime.onMessage.addListener((msg) => {
  const m = msg as {
    type?: string
    url?: string
    title?: string
    token?: string
    tabId?: number
    key?: string
    model?: string
    pageId?: string
  }
  if (m?.type === 'notion.saveQuick' && typeof m.url === 'string') return quickSaveToNotion(m.title ?? '', m.url)
  if (m?.type === 'meta.ensure' && typeof m.url === 'string') return ensureMeta(m.url)
  if (m?.type === 'notion.listDbs' && typeof m.token === 'string') return listDatabases(m.token)
  if (m?.type === 'notion.saveTab' && typeof m.tabId === 'number') return saveTabToNotion(m.tabId)
  if (m?.type === 'notion.recent') return listRecent()
  if (m?.type === 'notion.archive' && typeof m.pageId === 'string') return archivePage(m.pageId).then((ok) => ({ ok }))
  if (m?.type === 'llm.setCfg')
    return setOpenRouterConfig(typeof m.key === 'string' && m.key ? { key: m.key, model: m.model ?? '' } : null).then(() => ({ ok: true }))
  return undefined
})

// Hot apps: pre-warm each 🔥 link in a background tab at browser startup,
// deduped against tabs that are already open. No polling afterwards —
// zero standby cost; if Firefox discards a warm tab it simply reloads
// from cache when activated.
browser.runtime.onStartup.addListener(() => {
  void warmHotTabs()
})

interface StoredNode {
  t: 'f' | 'l'
  url?: string
  hot?: boolean
  kids?: StoredNode[]
}

async function warmHotTabs(): Promise<void> {
  const box = await browser.storage.local.get('library')
  const lib = box['library'] as { root?: StoredNode[]; grid?: StoredNode[] } | undefined
  if (!lib) return
  const hot: string[] = []
  const walk = (nodes: StoredNode[] | undefined): void => {
    for (const n of nodes ?? []) {
      if (n.t === 'l' && n.hot && n.url) hot.push(n.url)
      if (n.t === 'f') walk(n.kids)
    }
  }
  walk(lib.grid)
  walk(lib.root)
  if (!hot.length) return
  const open = await browser.tabs.query({})
  for (const url of [...new Set(hot)]) {
    if (!open.some((t) => t.url === url)) await browser.tabs.create({ url, active: false })
  }
}
