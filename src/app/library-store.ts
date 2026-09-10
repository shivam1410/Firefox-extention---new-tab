/* Persistent store for the user's Library tree and new-tab grid.
   Lives in browser.storage.local (localStorage fallback for plain-browser
   dev preview). Nodes are stored without runtime ids; fresh ids are
   assigned on load. */

import { F, L, type TreeNode } from './model'

declare const window: Window & { browser?: typeof browser }
const api = typeof window !== 'undefined' ? window.browser : undefined
const KEY = 'library'

interface StoredNode {
  t: 'f' | 'l'
  title: string
  url?: string
  favicon?: string
  hot?: boolean
  kids?: StoredNode[]
}
interface StoredLibrary {
  version: 1
  root: StoredNode[]
  grid: StoredNode[]
}
export interface LibraryData {
  root: TreeNode[]
  grid: TreeNode[]
}

function serializeNodes(nodes: TreeNode[]): StoredNode[] {
  return nodes.map((n) =>
    n.type === 'folder'
      ? { t: 'f', title: n.title, kids: serializeNodes(n.children) }
      : { t: 'l', title: n.title, url: n.url, favicon: n.favicon, hot: n.hot || undefined },
  )
}
function deserializeNodes(stored: StoredNode[]): TreeNode[] {
  const out: TreeNode[] = []
  for (const s of stored) {
    if (s.t === 'f') out.push(F(s.title, deserializeNodes(s.kids ?? [])))
    else if (s.url) out.push(L(s.title, s.url, { favicon: s.favicon, hot: s.hot }))
  }
  return out
}

function fromLocalStorage(): StoredLibrary | null {
  try {
    const raw = localStorage.getItem(`lt-${KEY}`)
    return raw ? (JSON.parse(raw) as StoredLibrary) : null
  } catch {
    return null
  }
}
function toLocalStorage(data: StoredLibrary): void {
  try {
    localStorage.setItem(`lt-${KEY}`, JSON.stringify(data))
  } catch {
    /* storage unavailable (permanent private browsing): library won't persist */
  }
}

export async function loadLibrary(): Promise<LibraryData> {
  let stored: StoredLibrary | null = null
  if (api?.storage?.local) {
    const box = await api.storage.local.get(KEY)
    stored = (box[KEY] as StoredLibrary | undefined) ?? null
  } else {
    stored = fromLocalStorage()
  }
  if (!stored) return { root: [], grid: [] }
  return { root: deserializeNodes(stored.root), grid: deserializeNodes(stored.grid) }
}

export async function saveLibrary(data: LibraryData): Promise<void> {
  const stored: StoredLibrary = { version: 1, root: serializeNodes(data.root), grid: serializeNodes(data.grid) }
  if (api?.storage?.local) await api.storage.local.set({ [KEY]: stored })
  else toLocalStorage(stored)
}

export function watchLibrary(cb: () => void): void {
  api?.storage?.onChanged.addListener(cb)
}
