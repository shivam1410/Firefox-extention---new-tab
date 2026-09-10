import './styles.css'
import { F, L, type Caps, type FolderNode, type LinkNode, type SourceKey, type TreeNode } from './model'
import {
  activateTab,
  closeTab,
  createBookmark,
  deleteHistoryUrl,
  live,
  loadBookmarks,
  loadHistory,
  loadTabs,
  moveBookmark,
  openUrl,
  removeBookmark,
  renameBookmark,
  watchBookmarks,
  watchHistory,
  watchTabs,
} from './live-sources'
import { PREVIEW_BOOKMARKS, PREVIEW_HISTORY, PREVIEW_TABS } from './preview-data'
import {
  importSavedTabs,
  loadSavedTabs,
  removeSavedTab,
  renameSavedTab,
  saveTab,
  saveTabs,
  watchSavedTabs,
  type SavedTab,
} from './saved-tabs'
import { loadLibrary, saveLibrary, watchLibrary } from './library-store'
import { fetchMeta, iconFor, queueIcons, requestRichIcons, richIconsEnabled } from './meta'
import {
  cloudSignIn,
  cloudSignInGoogle,
  cloudSignOut,
  getCloudAuth,
  getCloudConfig,
  googleRedirectUrl,
  scheduleCloudPush,
  setCloudConfig,
  syncNow,
} from './cloud-sync'

/* the user's persistent grid + library (loaded from storage at boot) */
let GRID: TreeNode[] = []

/* =============================================================
   Library Tab — app page.
   Live sources: Open Tabs, Bookmarks, History (real browser data
   when running as an extension). Preview-only for now: Library
   (P1) and the new-tab grid (P2).
   ============================================================= */

interface Source {
  key: SourceKey
  label: string
  glyph: string
  caps: Caps
  delLabel: string
  isLive: boolean
  root: TreeNode[]
}

const SOURCES: Record<SourceKey, Source> = {
  library: {
    key: 'library', label: 'Library', glyph: '📁', delLabel: 'Delete', isLive: true,
    caps: { createFolder: true, createItem: true, rename: true, move: true, del: true, acceptCopies: true },
    root: [],
  },
  tabs: {
    key: 'tabs', label: 'Open Tabs', glyph: '⊞', delLabel: 'Close tab', isLive: live.tabs,
    caps: { del: true },
    root: PREVIEW_TABS,
  },
  bookmarks: {
    key: 'bookmarks', label: 'Bookmarks', glyph: '★', delLabel: 'Delete', isLive: live.bookmarks,
    caps: { createFolder: true, createItem: true, rename: true, move: true, del: true, acceptCopies: true },
    root: PREVIEW_BOOKMARKS,
  },
  history: {
    key: 'history', label: 'History', glyph: '🕓', delLabel: 'Remove from history', isLive: live.history,
    caps: { del: true },
    root: PREVIEW_HISTORY,
  },
  notion: {
    key: 'notion', label: 'Notion', glyph: '📔', delLabel: 'Archive in Notion', isLive: false,
    caps: { del: true },
    root: [],
  },
}

/* ---------- helpers ---------- */
function el<T extends HTMLElement>(sel: string): T {
  const n = document.querySelector<T>(sel)
  if (!n) throw new Error(`missing element: ${sel}`)
  return n
}
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function hueOf(str: string): number {
  let h = 0
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h % 360
}
function mono(host: string, title: string): { bg: string; ch: string } {
  const h = hueOf(host || title)
  return {
    bg: `linear-gradient(150deg,hsl(${h} 52% 56%),hsl(${(h + 38) % 360} 55% 42%))`,
    ch: esc((title || host || '?').replace(/^www\./, '').charAt(0).toUpperCase()),
  }
}
function fmtHost(u: string): string {
  try {
    return new URL(u).host.replace(/^www\./, '')
  } catch {
    return u
  }
}
function debounce(fn: () => void, ms: number): () => void {
  let t: number | undefined
  return () => {
    window.clearTimeout(t)
    t = window.setTimeout(fn, ms)
  }
}

/* minimal glyphs for well-known hosts (used by the preview grid tiles) */
const GLYPH: Record<string, string> = {
  'github.com':
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><circle cx="7" cy="6" r="2.4"/><circle cx="17" cy="6" r="2.4"/><circle cx="12" cy="18" r="2.4"/><path d="M7 8.4v2.2a4 4 0 0 0 4 4h0M17 8.4v2.2a4 4 0 0 1-4 4h0" stroke="currentColor" stroke-width="1.9" fill="none"/></svg>',
  'mail.google.com':
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="3" y="5.5" width="18" height="13" rx="2.4"/><path d="M4 7.5 12 13.5 20 7.5"/></svg>',
  'youtube.com':
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M9.5 8.2 16 12 9.5 15.8Z"/></svg>',
  'news.ycombinator.com':
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M7 5.5 12 12.5 17 5.5M12 12.5V19"/></svg>',
  'calendar.google.com':
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="4" y="5" width="16" height="15" rx="2.4"/><path d="M4 9.6H20M8.5 3.4V6.4M15.5 3.4V6.4"/></svg>',
  'figma.com':
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><circle cx="9.5" cy="6" r="3"/><circle cx="14.5" cy="6" r="3" fill-opacity=".65"/><circle cx="9.5" cy="12" r="3" fill-opacity=".8"/><circle cx="14.5" cy="12" r="3" fill-opacity=".45"/><circle cx="9.5" cy="18" r="3" fill-opacity=".55"/></svg>',
  'linear.app':
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><path d="M5 15.5 15.5 5M8 19 19 8M12.5 20.5 20.5 12.5"/></svg>',
}

/* ---------- indices ---------- */
const PARENT = new Map<string, FolderNode | null>()
const OWNER = new Map<string, SourceKey | 'grid'>()
function indexTree(list: TreeNode[], par: FolderNode | null, owner: SourceKey | 'grid'): void {
  for (const n of list) {
    PARENT.set(n.id, par)
    OWNER.set(n.id, owner)
    if (n.type === 'folder') indexTree(n.children, n, owner)
  }
}
function reindexAll(): void {
  PARENT.clear()
  OWNER.clear()
  for (const s of Object.values(SOURCES)) indexTree(s.root, null, s.key)
  indexTree(GRID, null, 'grid')
}
reindexAll()

/* ---------- state ---------- */
interface State {
  src: SourceKey
  folder: FolderNode | null
  mode: 'list' | 'grid'
  sel: Set<string>
  expanded: Set<string>
  q: string
}
const state: State = { src: 'library', folder: null, mode: 'list', sel: new Set(), expanded: new Set(), q: '' }

/* ---------- live loading ---------- */
interface RecentSave {
  pageId: string
  title: string
  url?: string
  notionUrl: string
  createdAt: string
}
async function loadNotionRecent(): Promise<TreeNode[]> {
  const w = window as Window & { browser?: typeof browser }
  if (!w.browser?.runtime) return []
  const r = (await w.browser.runtime.sendMessage({ type: 'notion.recent' })) as
    | { ok: boolean; items: RecentSave[] }
    | undefined
  if (!r?.ok) return []
  SOURCES.notion.isLive = true
  return r.items.map((it) =>
    L(it.title, it.url ?? it.notionUrl, {
      notionId: it.pageId,
      notionUrl: it.notionUrl,
      when: it.createdAt ? new Date(it.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '',
    }),
  )
}
async function refreshSource(k: SourceKey): Promise<void> {
  const s = SOURCES[k]
  if (!s.isLive && k !== 'notion') return
  try {
    if (k === 'tabs') s.root = await loadTabs()
    else if (k === 'bookmarks') s.root = await loadBookmarks()
    else if (k === 'history') s.root = await loadHistory()
    else if (k === 'notion') s.root = await loadNotionRecent()
  } catch (err) {
    console.error(`[library-tab] failed to load ${k}:`, err)
    toast(`Couldn't load ${s.label} — see console`)
    return
  }
  // keep the open-folder reference valid across refreshes (match by title path)
  if (state.src === k && state.folder) {
    const path: string[] = []
    let f: FolderNode | null = state.folder
    while (f) {
      path.unshift(f.title)
      f = PARENT.get(f.id) ?? null
    }
    reindexAll()
    let list = s.root
    let target: FolderNode | null = null
    for (const title of path) {
      const hit = list.find((n): n is FolderNode => n.type === 'folder' && n.title === title)
      if (!hit) {
        target = null
        break
      }
      target = hit
      list = hit.children
    }
    state.folder = target
  } else {
    reindexAll()
  }
}

/* Never re-render while the user is renaming — a live tabs/bookmarks event
   would replace the DOM node under the caret and kill the edit box. */
function isEditing(): boolean {
  return Boolean((document.activeElement as HTMLElement | null)?.isContentEditable)
}
const rerender = debounce(() => {
  if (isEditing()) return
  if (location.hash.startsWith('#/explorer')) renderExplorer()
  else renderHomePanels()
}, 80)

/* ---------- library persistence ---------- */
let suppressLibraryReload = false
const persistLibrary = debounce(() => {
  suppressLibraryReload = true
  void saveLibrary({ root: SOURCES.library.root, grid: GRID }).finally(() => {
    window.setTimeout(() => {
      suppressLibraryReload = false
    }, 400)
  })
}, 250)
async function reloadLibraryFromStore(): Promise<void> {
  const data = await loadLibrary()
  SOURCES.library.root = data.root
  GRID = data.grid
  if (state.src === 'library') {
    state.folder = null
    state.sel.clear()
  }
  reindexAll()
  if (isEditing()) return
  renderHome()
  rerender()
}

/* ---------- add link / add folder dialog ---------- */
interface DlgResult {
  title: string
  url?: string
}
function promptDialog(opts: { heading: string; needUrl: boolean; okLabel?: string }): Promise<DlgResult | null> {
  const modal = el<HTMLDivElement>('#dlg')
  const form = el<HTMLFormElement>('#dlgForm')
  const titleIn = el<HTMLInputElement>('#dlgTitleIn')
  const urlIn = el<HTMLInputElement>('#dlgUrlIn')
  el<HTMLHeadingElement>('#dlgHeading').textContent = opts.heading
  el<HTMLButtonElement>('#dlgOk').textContent = opts.okLabel ?? 'Add'
  el<HTMLLabelElement>('#dlgUrlField').style.display = opts.needUrl ? '' : 'none'
  titleIn.value = ''
  urlIn.value = ''
  modal.classList.add('on')
  ;(opts.needUrl ? urlIn : titleIn).focus()
  return new Promise((resolve) => {
    const close = (result: DlgResult | null): void => {
      modal.classList.remove('on')
      form.onsubmit = null
      el<HTMLButtonElement>('#dlgCancel').onclick = null
      modal.onclick = null
      resolve(result)
    }
    form.onsubmit = (e) => {
      e.preventDefault()
      let url = urlIn.value.trim()
      if (opts.needUrl) {
        if (!url) {
          urlIn.focus()
          return
        }
        if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`
      }
      const title = titleIn.value.trim() || (opts.needUrl ? fmtHost(url) : '')
      if (!title) {
        titleIn.focus()
        return
      }
      close(opts.needUrl ? { title, url } : { title })
    }
    el<HTMLButtonElement>('#dlgCancel').onclick = () => close(null)
    modal.onclick = (e) => {
      if (e.target === modal) close(null)
    }
  })
}
function addLinkTo(target: 'grid' | FolderNode | null): void {
  void promptDialog({ heading: target === 'grid' ? 'Add to new tab' : 'Add link', needUrl: true }).then((r) => {
    if (!r || !r.url) return
    const url = r.url
    const autoTitled = r.title === fmtHost(url) // user left the title empty
    const node = L(r.title, url)
    if (target === 'grid') GRID.push(node)
    else (target ? target.children : SOURCES.library.root).unshift(node)
    reindexAll()
    persistLibrary()
    renderHome()
    if (location.hash.startsWith('#/explorer')) renderExplorer()
    toast(`Added “${r.title}”`)
    if (autoTitled)
      void fetchMeta(url).then((m) => {
        if (m.title && node.title === fmtHost(url)) {
          node.title = m.title
          persistLibrary()
          iconArrived()
        } else if (m.icon) {
          iconArrived()
        }
      })
  })
}
function addFolderTo(target: FolderNode | null): void {
  void promptDialog({ heading: 'New folder', needUrl: false, okLabel: 'Create' }).then((r) => {
    if (!r) return
    const node = F(r.title, [])
    ;(target ? target.children : SOURCES.library.root).unshift(node)
    reindexAll()
    persistLibrary()
    if (location.hash.startsWith('#/explorer')) renderExplorer()
    toast(`Created “${r.title}”`)
  })
}
function isLibraryNode(n: TreeNode): boolean {
  const o = OWNER.get(n.id)
  return o === 'library' || o === 'grid'
}

function wireLiveEvents(): void {
  const onChange = (k: SourceKey): (() => void) =>
    debounce(() => {
      void refreshSource(k).then(rerender)
    }, 150)
  if (live.tabs) watchTabs(onChange('tabs'))
  if (live.bookmarks) watchBookmarks(onChange('bookmarks'))
  if (live.history) watchHistory(onChange('history'))
}

/* ---------- shared render bits ---------- */
function iconHTML(n: TreeNode): string {
  if (n.type === 'folder') return '<span class="fic fold">📁</span>'
  const src = n.favicon ?? iconFor(n.url)
  if (src) return `<span class="fic img"><img src="${esc(src)}" alt=""></span>`
  const m = mono(fmtHost(n.url), n.title)
  return `<span class="fic" style="background:${m.bg}">${m.ch}</span>`
}
/* after painting, ask the background pipeline for any icons we lack */
const iconArrived = debounce(() => {
  if (isEditing()) return
  renderHome()
  if (location.hash.startsWith('#/explorer')) renderExplorer()
  else renderHomePanels()
}, 120)
function requestIconsFor(urls: string[]): void {
  queueIcons(urls, iconArrived)
}
let toastTimer: number | undefined
function toast(msg: string): void {
  const t = el<HTMLDivElement>('#toast')
  t.textContent = msg
  t.classList.add('on')
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => t.classList.remove('on'), 2400)
}

/* ---------- opening things ---------- */
function openNode(n: LinkNode, where: 'here' | 'newtab'): void {
  if (n.tabId !== undefined) {
    void activateTab(n.tabId, n.windowId)
    return
  }
  if (!n.url) return
  if (where === 'here') window.location.assign(n.url)
  else void openUrl(n.url, false)
}

/* ---------- HOME ---------- */
function tileIcon(n: TreeNode): string {
  if (n.type === 'folder') {
    const minis = n.children
      .slice(0, 4)
      .map((c) => `<span class="mini" style="background:${mono(fmtHost(c.type === 'link' ? c.url : ''), c.title).bg}"></span>`)
      .join('')
    return `<span class="ic">${minis}</span>`
  }
  const src = n.favicon ?? iconFor(n.url)
  if (src) return `<span class="ic img"><img src="${esc(src)}" alt=""></span>`
  const host = fmtHost(n.url)
  const m = mono(host, n.title)
  const g = GLYPH[host]
  return `<span class="ic" style="background:${m.bg}">${g ?? `<span style="font-size:24px;font-weight:600">${m.ch}</span>`}</span>`
}
function renderHome(): void {
  const g = el<HTMLDivElement>('#homeGrid')
  g.innerHTML = ''
  for (const n of GRID) {
    const b = document.createElement('div')
    b.className = 'tile' + (n.type === 'folder' ? ' folder' : '')
    b.tabIndex = 0
    b.setAttribute('role', 'button')
    b.innerHTML =
      tileIcon(n) +
      `<span class="lb">${esc(n.title)}</span>` +
      (n.hot ? '<span class="hotb" title="Hot app — pre-warmed at startup, opens instantly">🔥</span>' : '')
    b.addEventListener('click', (e) => {
      if (clickedControl(e)) return
      if (n.type === 'folder') {
        openFolderOverlay(n)
        return
      }
      // hot tiles switch to the pre-warmed tab instead of reloading
      if (n.hot) {
        const warm = openTabsAsLinks().find((t) => t.url === n.url)
        if (warm?.tabId !== undefined) {
          void activateTab(warm.tabId, warm.windowId)
          return
        }
      }
      openNode(n, 'here')
    })
    b.addEventListener('contextmenu', (e) => ctxMenu(e, n, 'grid'))
    g.appendChild(b)
  }
  /* saved pages appear as tiles too (from Notion when connected; local fallback otherwise) */
  const pinnedUrls = new Set(GRID.filter((x): x is LinkNode => x.type === 'link').map((x) => x.url))
  const localByUrl = new Map(savedTabs.map((s) => [s.url, s]))
  const useNotion = SOURCES.notion.isLive || SOURCES.notion.root.length > 0
  const savedNodes: LinkNode[] = useNotion
    ? SOURCES.notion.root.filter((x): x is LinkNode => x.type === 'link' && !pinnedUrls.has(x.url)).slice(0, 24)
    : savedTabs.filter((s) => !pinnedUrls.has(s.url)).map((s) => L(s.title, s.url, { favicon: s.favicon }))
  for (const n of savedNodes) {
    const b = document.createElement('div')
    b.className = 'tile'
    b.tabIndex = 0
    b.setAttribute('role', 'button')
    b.innerHTML = tileIcon(n) + `<span class="lb">${esc(n.title)}</span><span class="savb" title="Saved${n.notionId ? ' in Notion' : ''}">📔</span>`
    b.addEventListener('click', (e) => {
      if (clickedControl(e)) return
      openNode(n, 'here')
    })
    b.addEventListener('contextmenu', (e) => {
      if (n.notionId) {
        ctxMenu(e, n, 'notion')
        return
      }
      const s = localByUrl.get(n.url)
      if (!s) return
      showCtxMenu(e, [
        { lbl: 'Open', on: () => openNode(n, 'here') },
        { lbl: 'Open in new tab', on: () => openNode(n, 'newtab') },
        { hr: true },
        {
          lbl: 'Rename',
          on: () => {
            const lbl = b.querySelector<HTMLElement>('.lb')
            if (lbl)
              inlineRename(lbl, s.title, (t) => {
                void renameSavedTab(s.id, t).then(refreshSavedTabs)
                toast(`Renamed to “${t}”`)
              })
          },
        },
        {
          lbl: 'Pin permanently',
          on: () => {
            GRID.push(L(s.title, s.url, { favicon: s.favicon }))
            reindexAll()
            persistLibrary()
            renderHome()
            toast(`Pinned “${s.title}”`)
          },
        },
        {
          lbl: 'Remove from saved tabs',
          danger: true,
          on: () => {
            void removeSavedTab(s.id).then(refreshSavedTabs)
            toast(`Removed “${s.title}”`)
          },
        },
      ])
    })
    g.appendChild(b)
  }
  const savedTiles = savedNodes
  const add = document.createElement('button')
  add.className = 'tile add'
  add.innerHTML = '<span class="ic">+</span><span class="lb" style="opacity:.7">Add</span>'
  add.addEventListener('click', () => addLinkTo('grid'))
  g.appendChild(add)
  if (!GRID.length && !savedTiles.length) {
    const hint = document.createElement('div')
    hint.className = 'gridhint'
    hint.textContent =
      'Sites you save (toolbar click or 🔖) show up here automatically. You can also pin permanently — click Add, or right-click anything and choose “Pin to new tab”.'
    g.appendChild(hint)
  }
  requestIconsFor(
    [...GRID, ...savedTiles.map((s) => L(s.title, s.url))]
      .filter((x): x is LinkNode => x.type === 'link' && !x.favicon)
      .map((x) => x.url),
  )
}
function openFolderOverlay(n: FolderNode): void {
  el<HTMLHeadingElement>('#fpTitle').textContent = n.title
  const g = el<HTMLDivElement>('#fpGrid')
  g.innerHTML = ''
  for (const c of n.children) {
    const b = document.createElement('button')
    b.className = 'tile'
    b.innerHTML = tileIcon(c) + `<span class="lb">${esc(c.title)}</span>`
    b.addEventListener('click', () => {
      if (c.type === 'link') openNode(c, 'here')
    })
    g.appendChild(b)
  }
  el<HTMLDivElement>('#foldOverlay').classList.add('on')
}
el<HTMLDivElement>('#foldOverlay').addEventListener('click', (e) => {
  if ((e.target as HTMLElement).id === 'foldOverlay') el<HTMLDivElement>('#foldOverlay').classList.remove('on')
})

/* ---------- inline rename (shared by explorer + panels) ---------- */
function inlineRename(ttl: HTMLElement, fallback: string, commit: (title: string) => void): void {
  ttl.contentEditable = 'true'
  ttl.focus()
  document.getSelection()?.selectAllChildren(ttl)
  const done = (ok: boolean): void => {
    ttl.contentEditable = 'false'
    const t = ttl.textContent?.trim() ?? ''
    if (ok && t && t !== fallback) commit(t)
    else ttl.textContent = fallback
  }
  ttl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      done(true)
    }
    if (e.key === 'Escape') done(false)
  })
  ttl.addEventListener('blur', () => done(true), { once: true })
}

/* small hover action button (✕ close, ✎ rename, 🔖 save) */
function actBtn(glyph: string, title: string, on: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = 'hact'
  b.title = title
  b.textContent = glyph
  b.addEventListener('click', (e) => {
    e.stopPropagation()
    on()
  })
  return b
}
function clickedControl(e: MouseEvent): boolean {
  const t = e.target as HTMLElement
  return Boolean(t.closest('.hact')) || t.isContentEditable
}

/* ---------- HOME side panels: saved tabs (left) + bookmarks (right) ---------- */
let savedTabs: SavedTab[] = []
async function refreshSavedTabs(): Promise<void> {
  savedTabs = await loadSavedTabs()
  if (isEditing()) return
  renderHome()
  if (!location.hash.startsWith('#/explorer')) renderHomePanels()
}
function openTabsAsLinks(): LinkNode[] {
  const out: LinkNode[] = []
  for (const win of SOURCES.tabs.root)
    if (win.type === 'folder') for (const t of win.children) if (t.type === 'link' && t.url) out.push(t)
  return out
}

const hpExpanded = new Set<string>()
function hrow(n: TreeNode, opts: { indent?: boolean; head?: boolean; chev?: boolean } = {}): HTMLDivElement {
  const b = document.createElement('div')
  b.className = 'hrow' + (opts.indent ? ' indent' : '') + (opts.head ? ' head' : '')
  b.tabIndex = 0
  b.setAttribute('role', 'button')
  const chev = opts.chev ? `<span class="chev ${hpExpanded.has(n.id) ? 'open' : ''}">▸</span>` : ''
  const icon = n.type === 'folder' ? '<span class="fic" style="background:transparent">📁</span>' : iconHTML(n)
  b.innerHTML = `${chev}${icon}<span class="ttl">${esc(n.title)}</span>`
  return b
}
function savedRow(s: SavedTab): HTMLDivElement {
  const n = L(s.title, s.url, { favicon: s.favicon })
  const b = hrow(n)
  b.addEventListener('click', (e) => {
    if (clickedControl(e)) return
    void openUrl(s.url, false)
  })
  b.appendChild(
    actBtn('✎', 'Rename', () => {
      const ttl = b.querySelector<HTMLElement>('.ttl')
      if (ttl)
        inlineRename(ttl, s.title, (t) => {
          void renameSavedTab(s.id, t).then(refreshSavedTabs)
        })
    }),
  )
  b.appendChild(
    actBtn('✕', 'Remove from saved tabs', () => {
      void removeSavedTab(s.id).then(refreshSavedTabs)
      toast(`Removed “${s.title}” from saved tabs`)
    }),
  )
  return b
}
/** Quick save: goes to Notion when connected (title/link/tags, no summary),
    otherwise to the local saved-tabs list. */
function saveTabAndShow(t: { title: string; url: string; favicon?: string }): void {
  void (async () => {
    const configured = (await getNotionCfg()) !== null
    if (configured && extApi?.runtime) {
      toast('Saving to Notion…')
      const r = (await extApi.runtime.sendMessage({ type: 'notion.saveQuick', title: t.title, url: t.url })) as
        | { ok: boolean; message: string }
        | undefined
      toast(r?.message ?? 'No response — try again')
      return
    }
    const added = await saveTab(t)
    void refreshSavedTabs()
    if (!location.hash.startsWith('#/explorer')) renderHomePanels()
    toast(added ? `Saved “${t.title}”` : 'Already in your saved tabs')
  })()
}

function openTabRow(t: LinkNode, indent: boolean): HTMLDivElement {
  const b = hrow(t, { indent })
  b.addEventListener('click', (e) => {
    if (clickedControl(e)) return
    openNode(t, 'newtab') // tab node → switches to the real tab
  })
  b.addEventListener('contextmenu', (e) => ctxMenu(e, t, 'tabs'))
  b.appendChild(
    actBtn('🔖', 'Save tab', () => {
      saveTabAndShow({ title: t.title, url: t.url, favicon: t.favicon })
    }),
  )
  b.appendChild(
    actBtn('✕', 'Close tab', () => {
      deleteNode(t)
      renderHomePanels()
      toast(`Closed “${t.title}”`)
    }),
  )
  return b
}

function renderHomePanels(): void {
  /* left: saved pages — Notion is the home for saves; local list is the
     fallback shown only until Notion is connected */
  const notionBox = el<HTMLDivElement>('#homeNotion')
  notionBox.innerHTML = ''
  const notionLinks = SOURCES.notion.root.filter((n): n is LinkNode => n.type === 'link')
  if (SOURCES.notion.isLive || notionLinks.length) {
    if (!notionLinks.length)
      notionBox.innerHTML =
        '<span class="hempty">No saves yet — hover any open tab and hit 🔖, or use the toolbar button on the page you\'re reading.</span>'
    for (const n of notionLinks.slice(0, 30)) {
      const b = hrow(n)
      b.addEventListener('click', (e) => {
        if (clickedControl(e)) return
        openNode(n, 'newtab')
      })
      b.addEventListener('contextmenu', (e) => ctxMenu(e, n, 'notion'))
      b.appendChild(
        actBtn('↗', 'Open in Notion', () => {
          void openUrl(n.notionUrl ?? '', false)
        }),
      )
      notionBox.appendChild(b)
    }
  } else {
    if (!savedTabs.length)
      notionBox.innerHTML =
        '<span class="hempty">Connect Notion (Wallpaper → 📔) to save pages with summaries — or just hit 🔖 on any tab to save locally.</span>'
    for (const s of savedTabs) notionBox.appendChild(savedRow(s))
  }
  /* right column, lower box: open tabs */
  const tabsBox = el<HTMLDivElement>('#homeTabs')
  tabsBox.innerHTML = ''
  const windows = SOURCES.tabs.root.filter((n): n is FolderNode => n.type === 'folder')
  const openCount = windows.reduce((sum, w) => sum + w.children.length, 0)
  if (!openCount) tabsBox.innerHTML = '<span class="hempty">No other tabs open</span>'
  const manyWindows = windows.length > 1
  for (const win of windows) {
    if (manyWindows && win.children.length) tabsBox.appendChild(hrow(win, { head: true }))
    for (const t of win.children) if (t.type === 'link') tabsBox.appendChild(openTabRow(t, manyWindows))
  }
  /* right: bookmarks tree with inline expand/collapse + hover actions */
  const bmBox = el<HTMLDivElement>('#homeBm')
  bmBox.innerHTML = ''
  const renderBmLevel = (list: TreeNode[], depth: number): void => {
    for (const n of list) {
      const b = hrow(n, { indent: depth > 0, chev: n.type === 'folder' })
      if (n.type === 'folder') {
        b.addEventListener('click', (e) => {
          if (clickedControl(e)) return
          hpExpanded.has(n.id) ? hpExpanded.delete(n.id) : hpExpanded.add(n.id)
          renderHomePanels()
        })
      } else {
        b.addEventListener('click', (e) => {
          if (clickedControl(e)) return
          openNode(n, 'newtab')
        })
        b.addEventListener('contextmenu', (e) => ctxMenu(e, n, 'bookmarks'))
      }
      if (!n.locked) {
        b.appendChild(
          actBtn('✎', 'Rename bookmark', () => {
            const ttl = b.querySelector<HTMLElement>('.ttl')
            if (ttl)
              inlineRename(ttl, n.title, (t) => {
                n.title = t
                if (n.bmId && SOURCES.bookmarks.isLive)
                  void renameBookmark(n.bmId, t).catch(() => toast('Firefox refused that rename'))
                toast(`Renamed to “${t}”`)
              })
          }),
        )
        b.appendChild(
          actBtn('✕', n.type === 'folder' ? 'Delete folder (and contents)' : 'Delete bookmark', () => {
            deleteNode(n)
            renderHomePanels()
            toast(`Deleted “${n.title}”`)
          }),
        )
      }
      bmBox.appendChild(b)
      if (n.type === 'folder' && hpExpanded.has(n.id)) renderBmLevel(n.children, depth + 1)
    }
  }
  if (!SOURCES.bookmarks.root.length) bmBox.innerHTML = '<span class="hempty">No bookmarks</span>'
  else renderBmLevel(SOURCES.bookmarks.root, 0)
  const visibleBmLinks: string[] = []
  const collect = (list: TreeNode[]): void => {
    for (const n of list) {
      if (n.type === 'link' && !n.favicon) visibleBmLinks.push(n.url)
      else if (n.type === 'folder' && hpExpanded.has(n.id)) collect(n.children)
    }
  }
  collect(SOURCES.bookmarks.root)
  requestIconsFor(visibleBmLinks)
}
el<HTMLButtonElement>('#saveAllBtn').addEventListener('click', () => {
  void (async () => {
    const tabs = openTabsAsLinks()
    if (!tabs.length) {
      toast('No open tabs to save')
      return
    }
    if ((await getNotionCfg()) !== null && extApi?.runtime) {
      toast(`Saving ${tabs.length} tab${tabs.length > 1 ? 's' : ''} to Notion…`)
      let added = 0
      for (const t of tabs) {
        const r = (await extApi.runtime.sendMessage({ type: 'notion.saveQuick', title: t.title, url: t.url })) as
          | { ok: boolean; message: string }
          | undefined
        if (r?.ok && !r.message.startsWith('Already')) added++
      }
      toast(added ? `Saved ${added} tab${added > 1 ? 's' : ''} to Notion 📔` : 'All open tabs were already saved')
      return
    }
    const added = await saveTabs(tabs.map((t) => ({ title: t.title, url: t.url, favicon: t.favicon })))
    void refreshSavedTabs()
    renderHomePanels()
    toast(added ? `Saved ${added} tab${added > 1 ? 's' : ''}` : 'All open tabs were already saved')
  })()
})

/* clock */
function tick(): void {
  const d = new Date()
  el<HTMLDivElement>('#clockT').textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  el<HTMLDivElement>('#clockD').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
}
tick()
window.setInterval(tick, 20000)

/* wallpaper */
el<HTMLButtonElement>('#wpBtn').addEventListener('click', (e) => {
  e.stopPropagation()
  el<HTMLDivElement>('#wpop').classList.toggle('on')
})
document.addEventListener('click', (e) => {
  if (!(e.target as HTMLElement).closest('#wpop')) el<HTMLDivElement>('#wpop').classList.remove('on')
  hideCtx()
})
/* ---------- Notion dialog ---------- */
declare const window: Window & { browser?: typeof browser }
const extApi = typeof window !== 'undefined' ? window.browser : undefined

interface NotionCfg {
  token: string
  databaseId: string
  databaseName: string
}
interface DbInfo {
  id: string
  title: string
}
/* AI model dropdown: curated groups + live free-model list from OpenRouter */
const FREE_RECOMMENDED = 'meta-llama/llama-3.3-70b-instruct:free'
const MODEL_GROUPS: Array<{ label: string; tier: 'paid' | 'free'; models: Array<[string, string]> }> = [
  {
    label: 'Anthropic (direct sk-ant-… key)',
    tier: 'paid',
    models: [['claude-haiku-4-5', 'Claude Haiku 4.5 — ~0.5¢/summary']],
  },
  {
    label: 'OpenRouter — popular & cheap',
    tier: 'paid',
    models: [
      ['anthropic/claude-haiku-4.5', 'Claude Haiku 4.5'],
      ['google/gemini-2.5-flash-lite', 'Gemini 2.5 Flash Lite'],
      ['deepseek/deepseek-chat', 'DeepSeek Chat'],
    ],
  },
  {
    label: 'OpenRouter — free ($0, rate-limited)',
    tier: 'free',
    models: [[FREE_RECOMMENDED, '★ Llama 3.3 70B (recommended free)']],
  },
]
function applyTier(tier: 'paid' | 'free'): void {
  const sel = el<HTMLSelectElement>('#orModelSel')
  el<HTMLButtonElement>('#tierPaid').classList.toggle('on', tier === 'paid')
  el<HTMLButtonElement>('#tierFree').classList.toggle('on', tier === 'free')
  const autoOpt = sel.querySelector<HTMLOptionElement>('option[value=""]')
  if (autoOpt) autoOpt.hidden = tier === 'free'
  for (const og of Array.from(sel.querySelectorAll('optgroup'))) {
    const show = (og.dataset['tier'] ?? 'paid') === tier
    og.hidden = !show
    for (const o of Array.from(og.querySelectorAll('option'))) o.hidden = !show
  }
  const current = sel.selectedOptions[0]
  if (!current || current.hidden) {
    sel.value = tier === 'free' ? FREE_RECOMMENDED : ''
    el<HTMLLabelElement>('#orCustomField').hidden = true
  }
}
let freeModelsLoaded = false
async function populateModelSelect(): Promise<void> {
  const sel = el<HTMLSelectElement>('#orModelSel')
  if (sel.options.length <= 1) {
    for (const g of MODEL_GROUPS) {
      const og = document.createElement('optgroup')
      og.label = g.label
      og.dataset['tier'] = g.tier
      for (const [value, label] of g.models) {
        const o = document.createElement('option')
        o.value = value
        o.textContent = label
        og.appendChild(o)
      }
      sel.appendChild(og)
    }
    const custom = document.createElement('option')
    custom.value = 'custom'
    custom.textContent = 'Custom model id…'
    sel.appendChild(custom)
  }
  if (!freeModelsLoaded) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models')
      const body = (await res.json()) as { data?: Array<{ id: string; name?: string; pricing?: { prompt?: string } }> }
      const free = (body.data ?? [])
        .filter((m) => m.id.endsWith(':free') && m.pricing?.prompt === '0')
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, 12)
      const og = sel.querySelector<HTMLOptGroupElement>('optgroup[data-tier="free"]')
      if (free.length && og) {
        const have = new Set([...og.querySelectorAll('option')].map((o) => o.value))
        for (const m of free) {
          if (have.has(m.id)) continue
          const o = document.createElement('option')
          o.value = m.id
          o.textContent = m.name ? `${m.name} (free)` : m.id
          o.hidden = og.hidden
          og.appendChild(o)
        }
        freeModelsLoaded = true
      }
    } catch {
      /* offline — curated list is enough */
    }
  }
}
function selectedModel(): string {
  const sel = el<HTMLSelectElement>('#orModelSel')
  return sel.value === 'custom' ? el<HTMLInputElement>('#orModel').value.trim() : sel.value
}
function reflectModel(model: string): void {
  const sel = el<HTMLSelectElement>('#orModelSel')
  applyTier(model.endsWith(':free') ? 'free' : 'paid')
  const has = model === '' || [...sel.options].some((o) => o.value === model && o.value !== 'custom')
  sel.value = has ? model : 'custom'
  el<HTMLLabelElement>('#orCustomField').hidden = sel.value !== 'custom'
  if (!has) el<HTMLInputElement>('#orModel').value = model
}

const notionDlg = el<HTMLDivElement>('#notionDlg')
const ntStatus = el<HTMLDivElement>('#ntStatus')
function setNtStatus(msg: string, kind: 'ok' | 'err' | '' = ''): void {
  ntStatus.textContent = msg
  ntStatus.className = `dlg-status ${kind}`
}
async function getNotionCfg(): Promise<NotionCfg | null> {
  if (!extApi?.storage?.local) return null
  const box = await extApi.storage.local.get('notionCfg')
  return (box['notionCfg'] as NotionCfg | undefined) ?? null
}
let ntDbs: DbInfo[] = []
async function renderNotionDlg(): Promise<void> {
  await populateModelSelect()
  let storedModel = ''
  if (extApi?.storage?.local) {
    const box = await extApi.storage.local.get('openrouterCfg')
    const or = box['openrouterCfg'] as { key?: string; model?: string } | undefined
    if (or?.key) el<HTMLInputElement>('#orKey').value = or.key
    storedModel = or?.model ?? ''
  }
  reflectModel(storedModel)
  const cfg = await getNotionCfg()
  if (cfg) {
    el<HTMLInputElement>('#ntToken').value = cfg.token
    setNtStatus(`Connected — saving into “${cfg.databaseName}”. Use the toolbar popup on any page: 📔 Save to Notion.`, 'ok')
    el<HTMLButtonElement>('#ntDisconnect').style.display = ''
  } else {
    el<HTMLButtonElement>('#ntDisconnect').style.display = 'none'
  }
}
el<HTMLButtonElement>('#notionBtn').addEventListener('click', () => {
  el<HTMLDivElement>('#wpop').classList.remove('on')
  notionDlg.classList.add('on')
  void renderNotionDlg()
})
el<HTMLSelectElement>('#orModelSel').addEventListener('change', () => {
  el<HTMLLabelElement>('#orCustomField').hidden = el<HTMLSelectElement>('#orModelSel').value !== 'custom'
})
el<HTMLButtonElement>('#tierPaid').addEventListener('click', () => applyTier('paid'))
el<HTMLButtonElement>('#tierFree').addEventListener('click', () => applyTier('free'))
el<HTMLButtonElement>('#ntClose').addEventListener('click', () => notionDlg.classList.remove('on'))
notionDlg.addEventListener('click', (e) => {
  if (e.target === notionDlg) notionDlg.classList.remove('on')
})
el<HTMLFormElement>('#notionForm').addEventListener('submit', (e) => {
  e.preventDefault()
  void (async () => {
    const token = el<HTMLInputElement>('#ntToken').value.trim()
    if (!token) {
      setNtStatus('Paste your integration token first.', 'err')
      return
    }
    if (!extApi?.runtime) {
      setNtStatus('Notion connect only works in the installed extension, not the dev preview.', 'err')
      return
    }
    // persist the (optional) AI settings on every submit
    await extApi.runtime.sendMessage({
      type: 'llm.setCfg',
      key: el<HTMLInputElement>('#orKey').value.trim(),
      model: selectedModel(),
    })
    const dbField = el<HTMLLabelElement>('#ntDbField')
    const dbSel = el<HTMLSelectElement>('#ntDb')
    // second press with a chosen database = save the configuration
    if (!dbField.hidden && dbSel.value) {
      const chosen = ntDbs.find((d) => d.id === dbSel.value)
      await extApi.storage.local.set({
        notionCfg: { token, databaseId: dbSel.value, databaseName: chosen?.title ?? 'database' },
      })
      dbField.hidden = true
      el<HTMLButtonElement>('#ntConnect').textContent = 'Connect'
      void renderNotionDlg()
      toast('Notion connected 📔')
      return
    }
    setNtStatus('Checking token & listing databases…')
    const r = (await extApi.runtime.sendMessage({ type: 'notion.listDbs', token })) as
      | { ok: boolean; message: string; dbs: DbInfo[] }
      | undefined
    if (!r?.ok) {
      setNtStatus(r?.message ?? 'No response from the extension.', 'err')
      return
    }
    ntDbs = r.dbs
    dbSel.innerHTML = ''
    for (const d of r.dbs) {
      const opt = document.createElement('option')
      opt.value = d.id
      opt.textContent = d.title
      dbSel.appendChild(opt)
    }
    dbField.hidden = false
    el<HTMLButtonElement>('#ntConnect').textContent = 'Save'
    setNtStatus(`${r.message} — pick where saves should go, then press Save.`, 'ok')
  })()
})
el<HTMLButtonElement>('#ntDisconnect').addEventListener('click', () => {
  void extApi?.storage.local.remove('notionCfg').then(() => {
    el<HTMLInputElement>('#ntToken').value = ''
    setNtStatus('Disconnected. The token was removed from this browser.')
    void renderNotionDlg()
  })
})
if (new URLSearchParams(location.search).get('notion') === '1') {
  notionDlg.classList.add('on')
  void renderNotionDlg()
}

/* ---------- cloud sync dialog ---------- */
const cloudDlg = el<HTMLDivElement>('#cloudDlg')
const cloudStatus = el<HTMLDivElement>('#cloudStatus')
function setCloudStatus(msg: string, kind: 'ok' | 'err' | '' = ''): void {
  cloudStatus.textContent = msg
  cloudStatus.className = `dlg-status ${kind}`
}
async function renderCloudDlg(): Promise<void> {
  const [cfg, auth] = await Promise.all([getCloudConfig(), getCloudAuth()])
  if (cfg) {
    el<HTMLInputElement>('#cfApiKey').value = cfg.apiKey
    el<HTMLInputElement>('#cfProjectId').value = cfg.projectId
    el<HTMLInputElement>('#cfGoogleId').value = cfg.googleClientId ?? ''
  }
  const redirect = googleRedirectUrl()
  const hint = el<HTMLDivElement>('#cloudRedirect')
  hint.hidden = !redirect
  if (redirect) hint.textContent = `Authorised redirect URI for the Google OAuth client: ${redirect}`
  const signedIn = Boolean(auth)
  el<HTMLDivElement>('#cloudCredFields').style.display = signedIn ? 'none' : ''
  el<HTMLButtonElement>('#cloudSignOutBtn').style.display = signedIn ? '' : 'none'
  el<HTMLButtonElement>('#cloudSyncNowBtn').style.display = signedIn ? '' : 'none'
  el<HTMLButtonElement>('#cloudSignInBtn').style.display = signedIn ? 'none' : ''
  el<HTMLButtonElement>('#cloudCreateBtn').style.display = signedIn ? 'none' : ''
  if (signedIn && auth) setCloudStatus(`Signed in as ${auth.email} — saved tabs sync automatically.`, 'ok')
  else if (!cfg)
    setCloudStatus(
      'One-time setup: in console.firebase.google.com create a project, enable Authentication → Email/Password, create a Firestore database, then paste the Web API key and project ID here.',
    )
  else setCloudStatus('Sign in, or create an account for this Firebase project.')
}
async function saveCloudConfigFromFields(): Promise<boolean> {
  const apiKey = el<HTMLInputElement>('#cfApiKey').value.trim()
  const projectId = el<HTMLInputElement>('#cfProjectId').value.trim()
  const googleClientId = el<HTMLInputElement>('#cfGoogleId').value.trim() || undefined
  if (!apiKey || !projectId) {
    setCloudStatus('Both the API key and project ID are needed.', 'err')
    return false
  }
  await setCloudConfig({ apiKey, projectId, googleClientId })
  return true
}
async function afterCloudSignIn(err: string | null): Promise<void> {
  if (err) {
    setCloudStatus(err, 'err')
    return
  }
  setCloudStatus('Signed in — syncing…')
  const r = await syncNow()
  if (r.changedLocal) void refreshSavedTabs()
  setCloudStatus(r.message, r.ok ? 'ok' : 'err')
  void renderCloudDlg()
}
async function cloudAuthAction(create: boolean): Promise<void> {
  if (!(await saveCloudConfigFromFields())) return
  const email = el<HTMLInputElement>('#cfEmail').value.trim()
  const password = el<HTMLInputElement>('#cfPassword').value
  if (!email || !password) {
    setCloudStatus('Enter an email and password.', 'err')
    return
  }
  setCloudStatus(create ? 'Creating account…' : 'Signing in…')
  const err = await cloudSignIn(email, password, create)
  if (!err) el<HTMLInputElement>('#cfPassword').value = ''
  await afterCloudSignIn(err)
}
el<HTMLButtonElement>('#cloudBtn').addEventListener('click', () => {
  el<HTMLDivElement>('#wpop').classList.remove('on')
  cloudDlg.classList.add('on')
  void renderCloudDlg()
})
el<HTMLButtonElement>('#cloudClose').addEventListener('click', () => cloudDlg.classList.remove('on'))
cloudDlg.addEventListener('click', (e) => {
  if (e.target === cloudDlg) cloudDlg.classList.remove('on')
})
el<HTMLFormElement>('#cloudForm').addEventListener('submit', (e) => {
  e.preventDefault()
  void cloudAuthAction(false)
})
el<HTMLButtonElement>('#cloudCreateBtn').addEventListener('click', () => void cloudAuthAction(true))
el<HTMLButtonElement>('#cloudGoogleBtn').addEventListener('click', () => {
  void (async () => {
    if (!(await saveCloudConfigFromFields())) return
    setCloudStatus('Opening Google sign-in…')
    await afterCloudSignIn(await cloudSignInGoogle())
  })()
})
el<HTMLButtonElement>('#cloudSignOutBtn').addEventListener('click', () => {
  void cloudSignOut().then(() => {
    setCloudStatus('Signed out. Your local saved tabs are untouched.')
    void renderCloudDlg()
  })
})
el<HTMLButtonElement>('#cloudSyncNowBtn').addEventListener('click', () => {
  setCloudStatus('Syncing…')
  void syncNow().then((r) => {
    if (r.changedLocal) void refreshSavedTabs()
    setCloudStatus(r.message, r.ok ? 'ok' : 'err')
  })
})

/* rich icons opt-in */
const richBtn = el<HTMLButtonElement>('#richBtn')
function refreshRichBtn(): void {
  void richIconsEnabled().then((on) => {
    richBtn.disabled = on
    richBtn.textContent = on ? '✓ Rich icons enabled' : '✨ Enable rich icons'
  })
}
richBtn.addEventListener('click', () => {
  void requestRichIcons().then((ok) => {
    refreshRichBtn()
    if (ok) {
      toast('Rich icons enabled — fetching site logos…')
      renderHome()
      if (location.hash.startsWith('#/explorer')) renderExplorer()
      else renderHomePanels()
    } else {
      toast('Permission not granted — keeping letter icons')
    }
  })
})
refreshRichBtn()

/* JSON backup download */
el<HTMLButtonElement>('#exportBtn').addEventListener('click', () => {
  const backup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    savedTabs,
    library: { root: SOURCES.library.root, grid: GRID },
  }
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `library-tab-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  toast('Backup downloaded')
})

/* JSON backup restore */
function reviveNodes(raw: unknown): TreeNode[] {
  if (!Array.isArray(raw)) return []
  const out: TreeNode[] = []
  for (const item of raw as Array<Record<string, unknown>>) {
    if (!item || typeof item !== 'object') continue
    if (item['type'] === 'folder' && typeof item['title'] === 'string') {
      out.push(F(item['title'], reviveNodes(item['children'])))
    } else if (item['type'] === 'link' && typeof item['title'] === 'string' && typeof item['url'] === 'string') {
      out.push(
        L(item['title'], item['url'], {
          favicon: typeof item['favicon'] === 'string' ? item['favicon'] : undefined,
          hot: item['hot'] === true || undefined,
        }),
      )
    }
  }
  return out
}
const importFile = el<HTMLInputElement>('#importFile')
el<HTMLButtonElement>('#importBtn').addEventListener('click', () => importFile.click())
importFile.addEventListener('change', () => {
  const file = importFile.files?.[0]
  importFile.value = ''
  if (!file) return
  void file.text().then(async (text) => {
    let backup: { savedTabs?: unknown; library?: { root?: unknown; grid?: unknown } }
    try {
      backup = JSON.parse(text) as typeof backup
    } catch {
      toast('That file isn\'t a valid Library Tab backup')
      return
    }
    const addedSaved = Array.isArray(backup.savedTabs)
      ? await importSavedTabs(backup.savedTabs as Array<Partial<SavedTab>>)
      : 0
    const root = reviveNodes(backup.library?.root)
    const grid = reviveNodes(backup.library?.grid)
    const gridUrls = new Set(GRID.filter((n): n is LinkNode => n.type === 'link').map((n) => n.url))
    let addedLib = 0
    for (const n of grid) {
      if (n.type === 'link' && gridUrls.has(n.url)) continue
      GRID.push(n)
      addedLib++
    }
    for (const n of root) {
      SOURCES.library.root.push(n)
      addedLib++
    }
    reindexAll()
    persistLibrary()
    await refreshSavedTabs()
    renderHome()
    if (location.hash.startsWith('#/explorer')) renderExplorer()
    toast(`Restored ${addedSaved} saved tab${addedSaved === 1 ? '' : 's'} and ${addedLib} library item${addedLib === 1 ? '' : 's'}`)
  })
})

const wpButtons = document.querySelectorAll<HTMLButtonElement>('#wpop .sw button')
function setWallpaper(wp: string): void {
  el<HTMLElement>('#home').dataset['wp'] = wp
  wpButtons.forEach((x) => x.classList.toggle('on', x.dataset['wp'] === wp))
  try {
    localStorage.setItem('lt-wp', wp)
  } catch {
    /* storage may be blocked in permanent private browsing; wallpaper just won't persist */
  }
}
wpButtons.forEach((b) =>
  b.addEventListener('click', () => {
    const wp = b.dataset['wp']
    if (wp) setWallpaper(wp)
  }),
)
try {
  const saved = localStorage.getItem('lt-wp')
  if (saved) setWallpaper(saved)
} catch {
  /* see above */
}

/* home search across all sources */
interface Hit {
  n: LinkNode
  src: string
}
function allLinks(): Hit[] {
  const out: Hit[] = []
  for (const s of Object.values(SOURCES)) {
    const walk = (l: TreeNode[]): void => {
      for (const n of l) {
        if (n.type === 'link') out.push({ n, src: s.label })
        else walk(n.children)
      }
    }
    walk(s.root)
  }
  return out
}
const homeQ = el<HTMLInputElement>('#homeQ')
homeQ.addEventListener('input', () => {
  const q = homeQ.value.trim().toLowerCase()
  const box = el<HTMLDivElement>('#homeR')
  if (!q) {
    box.classList.remove('on')
    box.innerHTML = ''
    return
  }
  const seen = new Set<string>()
  const hits = allLinks()
    .filter((x) => x.n.title.toLowerCase().includes(q) || x.n.url.toLowerCase().includes(q))
    .filter((x) => {
      const key = `${x.src}|${x.n.url}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 7)
  box.innerHTML = hits.length
    ? hits.map((x) => `<button class="r">${iconHTML(x.n)}<span class="ttl">${esc(x.n.title)}</span><span class="src">${x.src}</span></button>`).join('')
    : '<span class="r none">No matches</span>'
  box.classList.add('on')
  box.querySelectorAll<HTMLButtonElement>('button.r').forEach((b, i) =>
    b.addEventListener('click', () => {
      const hit = hits[i]
      box.classList.remove('on')
      homeQ.value = ''
      if (hit) openNode(hit.n, 'here')
    }),
  )
})
homeQ.addEventListener('blur', () => window.setTimeout(() => el<HTMLDivElement>('#homeR').classList.remove('on'), 150))

/* ---------- EXPLORER: sidebar ---------- */
function renderSidebar(): void {
  const sb = el<HTMLElement>('#sidebar')
  sb.innerHTML = ''
  for (const s of Object.values(SOURCES)) {
    const sec = document.createElement('div')
    sec.className = 'sec'
    const h = document.createElement('h3')
    h.textContent = s.label
    sec.appendChild(h)
    sec.appendChild(nodeBtn(null, s.key))
    for (const n of s.root) if (n.type === 'folder') sec.appendChild(treeNode(n, s.key))
    sb.appendChild(sec)
  }
}
function treeNode(n: FolderNode, src: SourceKey): HTMLElement {
  const wrap = document.createElement('div')
  wrap.appendChild(nodeBtn(n, src))
  if (state.expanded.has(n.id)) {
    const kids = document.createElement('div')
    kids.className = 'kids'
    for (const c of n.children) if (c.type === 'folder') kids.appendChild(treeNode(c, src))
    wrap.appendChild(kids)
  }
  return wrap
}
function nodeBtn(n: FolderNode | null, src: SourceKey): HTMLButtonElement {
  const s = SOURCES[src]
  const isRoot = n === null
  const b = document.createElement('button')
  b.className = 'node'
  const active = state.src === src && (isRoot ? !state.folder : state.folder?.id === n.id)
  if (active) b.classList.add('on')
  const hasKids = !isRoot && n.children.some((c) => c.type === 'folder')
  b.innerHTML =
    (hasKids ? `<span class="chev ${n && state.expanded.has(n.id) ? 'open' : ''}">▸</span>` : '<span class="chev"></span>') +
    `<span class="glyph">${isRoot ? s.glyph : '📁'}</span><span class="lbl">${isRoot ? `All ${s.label.toLowerCase()}` : esc(n.title)}</span>`
  b.addEventListener('click', (e) => {
    if (n && hasKids && (e.target as HTMLElement).closest('.chev')) {
      state.expanded.has(n.id) ? state.expanded.delete(n.id) : state.expanded.add(n.id)
      renderSidebar()
      return
    }
    state.src = src
    state.folder = n
    state.sel.clear()
    state.q = ''
    el<HTMLInputElement>('#xQ').value = ''
    if (n && hasKids) state.expanded.add(n.id)
    renderExplorer()
  })
  b.addEventListener('dragover', (e) => {
    e.preventDefault()
    b.classList.add('droptgt')
  })
  b.addEventListener('dragleave', () => b.classList.remove('droptgt'))
  b.addEventListener('drop', (e) => {
    e.preventDefault()
    b.classList.remove('droptgt')
    doDrop(src, n, e)
  })
  return b
}

/* ---------- EXPLORER: main pane ---------- */
function curList(): TreeNode[] {
  const s = SOURCES[state.src]
  const list = state.folder ? state.folder.children : s.root
  if (!state.q) return list
  const q = state.q.toLowerCase()
  const out: TreeNode[] = []
  const walk = (l: TreeNode[]): void => {
    for (const n of l) {
      if (n.title.toLowerCase().includes(q)) out.push(n)
      if (n.type === 'folder') walk(n.children)
    }
  }
  walk(list)
  return out
}
function crumbPath(): FolderNode[] {
  const out: FolderNode[] = []
  let n: FolderNode | null = state.folder
  while (n) {
    out.unshift(n)
    n = PARENT.get(n.id) ?? null
  }
  return out
}
function renderCrumbs(): void {
  const c = el<HTMLDivElement>('#crumbs')
  const s = SOURCES[state.src]
  c.innerHTML = ''
  const mk = (lbl: string, fn: () => void, cur: boolean): HTMLButtonElement => {
    const b = document.createElement('button')
    b.textContent = lbl
    if (cur) b.classList.add('cur')
    else b.addEventListener('click', fn)
    return b
  }
  c.appendChild(mk(s.label, () => { state.folder = null; renderExplorer() }, !state.folder))
  for (const n of crumbPath()) {
    const sep = document.createElement('span')
    sep.className = 'sep'
    sep.textContent = '›'
    c.appendChild(sep)
    c.appendChild(mk(n.title, () => { state.folder = n; renderExplorer() }, n === state.folder))
  }
}
function capHint(): void {
  const s = SOURCES[state.src]
  const c = s.caps
  const yes: string[] = []
  const no: string[] = []
  ;(c.createFolder ? yes : no).push('new folder')
  ;(c.rename ? yes : no).push('rename')
  ;(c.move ? yes : no).push('move')
  ;(c.del ? yes : no).push(s.delLabel.toLowerCase())
  ;(c.acceptCopies ? yes : no).push('accept drops')
  const hint = el<HTMLDivElement>('#caphint')
  hint.innerHTML =
    `<b>${s.label}</b>&nbsp;· can: ${yes.join(', ')}` +
    (no.length ? `&nbsp;· <span style="opacity:.75">can't: ${no.join(', ')}</span>` : '')
  if (s.key === 'library') {
    const bar = document.createElement('span')
    bar.className = 'libbar'
    const addLink = document.createElement('button')
    addLink.textContent = '＋ Link'
    addLink.addEventListener('click', () => addLinkTo(state.folder))
    const addFolder = document.createElement('button')
    addFolder.textContent = '＋ Folder'
    addFolder.addEventListener('click', () => addFolderTo(state.folder))
    bar.append(addLink, addFolder)
    hint.appendChild(bar)
  }
  if (s.key === 'notion') {
    const bar = document.createElement('span')
    bar.className = 'libbar'
    const refresh = document.createElement('button')
    refresh.textContent = '↻ Refresh'
    refresh.addEventListener('click', () => {
      toast('Refreshing from Notion…')
      void refreshSource('notion').then(() => renderExplorer())
    })
    bar.appendChild(refresh)
    hint.appendChild(bar)
  }
  const pill = el<HTMLSpanElement>('.preview-pill')
  pill.textContent = s.isLive ? 'live' : 'preview data'
  pill.classList.toggle('live', s.isLive)
  pill.title = s.isLive ? 'Real data from your browser' : 'Sample data — this source is wired up in a later phase'
}
function subFor(n: TreeNode): string {
  if (n.type === 'folder') {
    const c = n.children.length
    return `${c} item${c === 1 ? '' : 's'}`
  }
  return fmtHost(n.url)
}
function commonItemWiring(elx: HTMLElement, n: TreeNode): void {
  elx.addEventListener('click', (e) => {
    if (clickedControl(e)) return
    // ⌘/Ctrl-click selects (for bulk ops); a plain click opens.
    if (e.metaKey || e.ctrlKey) {
      state.sel.has(n.id) ? state.sel.delete(n.id) : state.sel.add(n.id)
      renderPane()
      return
    }
    state.sel.clear()
    activate(n)
  })
  elx.addEventListener('contextmenu', (e) => ctxMenu(e, n, state.src))
  elx.draggable = true
  elx.addEventListener('dragstart', (e) => {
    e.dataTransfer?.setData('text/plain', JSON.stringify({ id: n.id, src: state.src }))
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copyMove'
  })
  if (n.type === 'folder') {
    elx.addEventListener('dragover', (e) => {
      e.preventDefault()
      elx.classList.add('droptgt')
    })
    elx.addEventListener('dragleave', () => elx.classList.remove('droptgt'))
    elx.addEventListener('drop', (e) => {
      e.preventDefault()
      elx.classList.remove('droptgt')
      doDrop(state.src, n, e)
    })
  }
}
function rowEl(n: TreeNode): HTMLElement {
  const r = document.createElement('div')
  r.className = 'row' + (state.sel.has(n.id) ? ' sel' : '')
  r.innerHTML =
    `${iconHTML(n)}<span class="ttl">${esc(n.title)}</span>` +
    (n.hot ? '<span class="hotdot" title="Hot app">🔥</span>' : '') +
    `<span class="sub">${esc(subFor(n))}</span><span class="meta">${esc(n.when ?? '')}</span>`
  commonItemWiring(r, n)
  const s = SOURCES[state.src]
  if (n.type === 'link' && n.tabId !== undefined)
    r.appendChild(
      actBtn('🔖', 'Save tab', () => {
        saveTabAndShow({ title: n.title, url: n.url, favicon: n.favicon })
      }),
    )
  if (s.caps.rename && !n.locked)
    r.appendChild(
      actBtn('✎', 'Rename', () => {
        startRename(n)
      }),
    )
  if (s.caps.del && !n.locked)
    r.appendChild(
      actBtn('✕', s.delLabel, () => {
        deleteNode(n)
        renderExplorer()
        toast(`${s.delLabel}: “${n.title}”`)
      }),
    )
  return r
}
function cardEl(n: TreeNode): HTMLElement {
  const c = document.createElement('div')
  c.className = 'card' + (state.sel.has(n.id) ? ' sel' : '')
  if (n.type === 'folder') {
    c.innerHTML = `<span class="fic fold">📁</span><span class="ttl">${esc(n.title)}</span>`
  } else {
    c.innerHTML = `${iconHTML(n)}<span class="ttl">${esc(n.title)}</span>`
  }
  commonItemWiring(c, n)
  return c
}
function renderPane(): void {
  const pane = el<HTMLDivElement>('#pane')
  pane.innerHTML = ''
  const list = curList()
  if (!list.length) {
    pane.innerHTML =
      state.src === 'library' && !state.q && !state.folder
        ? '<div class="empty">Your library is empty.<br>Use ＋ Link / ＋ Folder above, or drag items in from Open Tabs, Bookmarks or History.</div>'
        : state.src === 'notion' && !state.q
          ? '<div class="empty">No Notion saves yet.<br>Connect Notion (Wallpaper → 📔), then use the toolbar popup on any page: Save to Notion.</div>'
          : `<div class="empty">Nothing here${state.q ? ` for “${esc(state.q)}”` : ''}.</div>`
    return
  }
  const wrap = document.createElement('div')
  wrap.className = state.mode === 'list' ? 'rows' : 'cards'
  for (const n of list) wrap.appendChild(state.mode === 'list' ? rowEl(n) : cardEl(n))
  pane.appendChild(wrap)
  requestIconsFor(list.filter((n): n is LinkNode => n.type === 'link' && !n.favicon).map((n) => n.url))
}
function activate(n: TreeNode): void {
  if (n.type === 'folder') {
    state.folder = n
    state.sel.clear()
    state.q = ''
    el<HTMLInputElement>('#xQ').value = ''
    renderExplorer()
  } else {
    openNode(n, 'newtab')
  }
}
function renderExplorer(): void {
  renderSidebar()
  renderCrumbs()
  capHint()
  renderPane()
}

/* ---------- drag & drop (move within / copy across) ---------- */
function findNode(idv: string): TreeNode | null {
  let hit: TreeNode | null = null
  const walk = (l: TreeNode[]): void => {
    for (const n of l) {
      if (n.id === idv) hit = n
      if (n.type === 'folder') walk(n.children)
    }
  }
  for (const s of Object.values(SOURCES)) {
    walk(s.root)
    if (hit) return hit
  }
  return null
}
function detach(n: TreeNode): void {
  const owner = OWNER.get(n.id)
  const par = PARENT.get(n.id)
  const arr = par ? par.children : owner && owner !== 'grid' ? SOURCES[owner].root : GRID
  const i = arr.indexOf(n)
  if (i >= 0) arr.splice(i, 1)
}
function doDrop(targetSrc: SourceKey, targetFolder: FolderNode | null, e: DragEvent): void {
  let pay: { id: string; src: SourceKey }
  try {
    pay = JSON.parse(e.dataTransfer?.getData('text/plain') ?? '') as { id: string; src: SourceKey }
  } catch {
    return
  }
  const n = findNode(pay.id)
  if (!n) return
  const tgt = SOURCES[targetSrc]
  if (pay.src === targetSrc) {
    if (!tgt.caps.move) {
      toast(`${tgt.label}: items can't be moved`)
      return
    }
    if (n === targetFolder) return
    if (targetSrc === 'bookmarks' && tgt.isLive) {
      if (!targetFolder?.bmId) {
        toast('Drop into a bookmark folder (Toolbar, Menu, …)')
        return
      }
      if (n.locked) {
        toast('Built-in bookmark folders can\'t be moved')
        return
      }
      if (n.bmId) void moveBookmark(n.bmId, targetFolder.bmId).catch(() => toast('Firefox refused that move'))
    }
    detach(n)
    const arr = targetFolder ? targetFolder.children : tgt.root
    arr.unshift(n)
    PARENT.set(n.id, targetFolder)
    if (targetSrc === 'library') persistLibrary()
    toast(`Moved “${n.title}”${targetFolder ? ' → ' + targetFolder.title : ''}`)
  } else {
    if (!tgt.caps.acceptCopies) {
      toast(`${tgt.label} can't receive items — try Library or Bookmarks`)
      return
    }
    if (n.type !== 'link') {
      toast('Folder copies across sources come in P7')
      return
    }
    if (targetSrc === 'bookmarks' && tgt.isLive) {
      void createBookmark(n.title, n.url, targetFolder?.bmId).catch(() => toast('Firefox refused that bookmark'))
      toast(`Bookmarked “${n.title}”${targetFolder ? ' → ' + targetFolder.title : ' → Other Bookmarks'}`)
      return // the bookmarks.onCreated event refreshes the tree
    }
    const copy = L(n.title, n.url, { favicon: n.favicon })
    const arr = targetFolder ? targetFolder.children : tgt.root
    arr.unshift(copy)
    PARENT.set(copy.id, targetFolder)
    OWNER.set(copy.id, targetSrc)
    if (targetSrc === 'library') persistLibrary()
    toast(`Copied “${n.title}” → ${tgt.label}${targetFolder ? ' / ' + targetFolder.title : ''}`)
  }
  renderExplorer()
}

/* ---------- deletion (per source) ---------- */
function deleteNode(n: TreeNode): void {
  const owner = OWNER.get(n.id)
  if (owner === 'tabs' && n.type === 'link' && n.tabId !== undefined) {
    void closeTab(n.tabId).catch(() => toast('Couldn\'t close that tab'))
  } else if (owner === 'bookmarks' && n.bmId && SOURCES.bookmarks.isLive) {
    void removeBookmark(n.bmId, n.type === 'folder').catch(() => toast('Firefox refused that delete'))
  } else if (owner === 'history' && n.type === 'link' && SOURCES.history.isLive) {
    void deleteHistoryUrl(n.url).catch(() => toast('Couldn\'t remove that URL'))
  } else if (owner === 'notion' && n.notionId) {
    void extApi?.runtime.sendMessage({ type: 'notion.archive', pageId: n.notionId })
  }
  detach(n) // optimistic; live events re-sync the authoritative tree
  if (owner === 'library' || owner === 'grid') persistLibrary()
}

/* ---------- context menu ---------- */
interface CtxItem {
  lbl?: string
  hr?: boolean
  dis?: boolean
  danger?: boolean
  on?: () => void
}
const ctx = el<HTMLDivElement>('#ctx')
function hideCtx(): void {
  ctx.classList.remove('on')
}
function showCtxMenu(e: MouseEvent, items: CtxItem[]): void {
  e.preventDefault()
  e.stopPropagation()
  ctx.innerHTML = items
    .map((it) => (it.hr ? '<hr>' : `<button ${it.dis ? 'disabled' : ''} class="${it.danger ? 'danger' : ''}">${it.lbl ?? ''}</button>`))
    .join('')
  const btns = [...ctx.querySelectorAll<HTMLButtonElement>('button')]
  let bi = 0
  for (const it of items) {
    if (it.hr) continue
    const b = btns[bi++]
    if (b && !it.dis)
      b.addEventListener('click', () => {
        hideCtx()
        it.on?.()
      })
  }
  ctx.classList.add('on')
  ctx.style.left = `${Math.min(e.clientX, window.innerWidth - 210)}px`
  ctx.style.top = `${Math.min(e.clientY, window.innerHeight - ctx.offsetHeight - 12)}px`
}
function ctxMenu(e: MouseEvent, n: TreeNode, src: SourceKey | 'grid'): void {
  e.preventDefault()
  e.stopPropagation()
  const srcEl = e.currentTarget instanceof HTMLElement ? e.currentTarget : null
  const isGrid = src === 'grid'
  const s = isGrid ? SOURCES.library : SOURCES[src]
  const c = s.caps
  const locked = Boolean(n.locked)
  const items: CtxItem[] = []
  items.push({
    lbl: n.type === 'folder' ? 'Open folder' : n.tabId !== undefined ? 'Switch to tab' : 'Open',
    on: () => {
      if (isGrid && n.type === 'link') openNode(n, 'here')
      else activate(n)
    },
  })
  if (n.type === 'link' && n.tabId === undefined) items.push({ lbl: 'Open in new tab', on: () => openNode(n, 'newtab') })
  if (n.notionUrl)
    items.push({
      lbl: 'Open in Notion ↗',
      on: () => {
        void openUrl(n.notionUrl ?? '', false)
      },
    })
  if (n.type === 'link' && n.tabId !== undefined)
    items.push({
      lbl: 'Save tab 🔖',
      on: () => {
        saveTabAndShow({ title: n.title, url: n.url, favicon: n.favicon })
      },
    })
  items.push({ hr: true })
  items.push({
    lbl: 'Rename',
    dis: !c.rename || locked,
    on: () => {
      // In the explorer list, rename via the pane row; anywhere else
      // (grid tiles, home panels) edit the right-clicked element in place.
      if (location.hash.startsWith('#/explorer') && !isGrid) {
        startRename(n)
        return
      }
      const lbl = srcEl?.querySelector<HTMLElement>('.lb, .ttl')
      if (!lbl) return
      inlineRename(lbl, n.title, (t) => {
        n.title = t
        if (OWNER.get(n.id) === 'bookmarks' && n.bmId && SOURCES.bookmarks.isLive)
          void renameBookmark(n.bmId, t).catch(() => toast('Firefox refused that rename'))
        if (isLibraryNode(n)) persistLibrary()
        toast(`Renamed to “${t}”`)
        renderHome()
        if (!location.hash.startsWith('#/explorer')) renderHomePanels()
      })
    },
  })
  items.push({ lbl: 'Move to…', dis: !c.move || locked, on: () => toast('Coming in P7: folder picker dialog') })
  items.push({
    lbl: 'Pin to new tab',
    dis: n.type === 'folder' && src !== 'library',
    on: () => {
      if (n.type === 'link') {
        if (GRID.some((g) => g.type === 'link' && g.url === n.url)) {
          toast('Already pinned to the new tab')
          return
        }
        GRID.push(L(n.title, n.url, { favicon: n.favicon }))
      }
      reindexAll()
      persistLibrary()
      renderHome()
      toast(`Pinned “${n.title}” to the new-tab grid`)
    },
  })
  if (n.type === 'link' && isLibraryNode(n))
    items.push({
      lbl: n.hot ? 'Remove from hot apps' : 'Mark as hot app 🔥',
      on: () => {
        n.hot = !n.hot
        persistLibrary()
        renderHome()
        if (location.hash.includes('explorer')) renderPane()
        toast(n.hot ? 'Marked hot 🔥 — pre-warms at browser startup, opens instantly' : `“${n.title}” unmarked`)
      },
    })
  if (n.type === 'link') items.push({ lbl: 'Refresh icon', on: () => toast('Coming in P3: re-fetch icon & title from page metadata') })
  items.push({ hr: true })
  items.push({
    lbl: s.delLabel,
    dis: !c.del || locked,
    danger: true,
    on: () => {
      if (isGrid) {
        const i = GRID.indexOf(n)
        if (i >= 0) GRID.splice(i, 1)
        persistLibrary()
        renderHome()
      } else {
        deleteNode(n)
        renderExplorer()
      }
      toast(`${s.delLabel}: “${n.title}”${src === 'history' ? ' — removes every visit of this URL' : ''}`)
    },
  })
  showCtxMenu(e, items)
}
function startRename(n: TreeNode): void {
  renderPane()
  const pane = el<HTMLDivElement>('#pane')
  const els = [...pane.querySelectorAll<HTMLElement>('.row,.card')]
  const list = curList()
  const idx = list.indexOf(n)
  const target = els[idx]
  if (idx < 0 || !target) return
  const ttl = target.querySelector<HTMLElement>('.ttl')
  if (!ttl) return
  inlineRename(ttl, n.title, (t) => {
    n.title = t
    if (OWNER.get(n.id) === 'bookmarks' && n.bmId && SOURCES.bookmarks.isLive)
      void renameBookmark(n.bmId, t).catch(() => toast('Firefox refused that rename'))
    if (isLibraryNode(n)) persistLibrary()
    toast(`Renamed to “${t}”`)
    renderExplorer()
  })
}

/* ---------- routing (#/home | #/explorer) ---------- */
function route(): void {
  const isExplorer = location.hash.startsWith('#/explorer')
  el<HTMLElement>('#home').classList.toggle('on', !isExplorer)
  el<HTMLElement>('#explorer').classList.toggle('on', isExplorer)
  document.title = isExplorer ? 'Library — Explorer' : 'New Tab'
  if (isExplorer) renderExplorer()
  else renderHomePanels()
}
window.addEventListener('hashchange', route)
el<HTMLButtonElement>('#openLib').addEventListener('click', () => {
  location.hash = '#/explorer'
})
el<HTMLButtonElement>('#goHome').addEventListener('click', () => {
  location.hash = '#/home'
})

/* view toggles + filter */
el<HTMLButtonElement>('#vtList').addEventListener('click', () => {
  state.mode = 'list'
  el<HTMLButtonElement>('#vtList').classList.add('on')
  el<HTMLButtonElement>('#vtGrid').classList.remove('on')
  renderPane()
})
el<HTMLButtonElement>('#vtGrid').addEventListener('click', () => {
  state.mode = 'grid'
  el<HTMLButtonElement>('#vtGrid').classList.add('on')
  el<HTMLButtonElement>('#vtList').classList.remove('on')
  renderPane()
})
el<HTMLInputElement>('#xQ').addEventListener('input', (e) => {
  state.q = (e.target as HTMLInputElement).value.trim()
  renderPane()
})

/* keyboard */
document.addEventListener('keydown', (e) => {
  const editing = (e.target as HTMLElement).closest('input,[contenteditable=true]')
  const inExplorer = location.hash.startsWith('#/explorer')
  if (e.key === '/' && !editing) {
    e.preventDefault()
    ;(inExplorer ? el<HTMLInputElement>('#xQ') : el<HTMLInputElement>('#homeQ')).focus()
    return
  }
  if (editing || !inExplorer) return
  if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
    e.preventDefault()
    curList().forEach((n) => state.sel.add(n.id))
    renderPane()
  }
  if (e.key === 'Backspace' || e.key === 'Delete') {
    const s = SOURCES[state.src]
    if (!s.caps.del) {
      toast(`${s.label}: delete not available`)
      return
    }
    const del = curList().filter((n) => state.sel.has(n.id) && !n.locked)
    del.forEach(deleteNode)
    state.sel.clear()
    renderExplorer()
    if (del.length) toast(`${s.delLabel}: ${del.length} item${del.length > 1 ? 's' : ''}`)
  }
  if (e.key === 'Enter' && state.sel.size === 1) {
    const s = SOURCES[state.src]
    if (!s.caps.rename) return
    const n = curList().find((x) => state.sel.has(x.id))
    if (n && !n.locked) {
      e.preventDefault()
      startRename(n)
    }
  }
  if (e.key === 'Escape') {
    state.sel.clear()
    renderPane()
  }
})

/* ---------- boot ---------- */
renderHome()
route()
wireLiveEvents()
let notionStamp = 0
async function maybeRefreshNotion(): Promise<void> {
  if (!extApi?.storage?.local) return
  const box = await extApi.storage.local.get('notionLastSave')
  const stamp = (box['notionLastSave'] as number | undefined) ?? 0
  if (stamp > notionStamp) {
    notionStamp = stamp
    await refreshSource('notion')
    rerender()
  }
}
watchSavedTabs(() => {
  void refreshSavedTabs()
  void maybeRefreshNotion()
  scheduleCloudPush(() => void refreshSavedTabs())
})
void refreshSavedTabs().then(() => {
  // pull-on-open: adopt cloud changes made on other devices
  void getCloudAuth().then((auth) => {
    if (!auth) return
    void syncNow().then((r) => {
      if (r.changedLocal) {
        void refreshSavedTabs()
        toast(r.message)
      }
    })
  })
})
watchLibrary(() => {
  if (!suppressLibraryReload) void reloadLibraryFromStore()
})
void reloadLibraryFromStore()
void Promise.all([refreshSource('tabs'), refreshSource('bookmarks'), refreshSource('history'), refreshSource('notion')]).then(() => {
  if (location.hash.startsWith('#/explorer')) renderExplorer()
  else renderHomePanels()
})
