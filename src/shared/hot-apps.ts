/* Which URLs get pre-warmed in a background tab at browser startup.

   Two sources feed this: 🔥 links in the user's own library/grid, and 🔥 Quick
   saves from Notion. Summary saves are excluded — those are long reads kept for
   later, not apps you want already running. */

import type { SavedItem } from './saves-model'

/** The stored shape of a library node, as persisted by `library-store.ts`. */
export interface HotLibraryNode {
  t: 'f' | 'l'
  url?: string
  hot?: boolean
  kids?: HotLibraryNode[]
}

export interface HotLibrary {
  root?: HotLibraryNode[]
  grid?: HotLibraryNode[]
}

function isLibrary(v: unknown): v is HotLibrary {
  return typeof v === 'object' && v !== null
}

function walk(nodes: unknown, into: string[]): void {
  // a partially-written or older `library` value may hold something that is not
  // an array here; pre-warming should quietly do nothing rather than throw
  if (!Array.isArray(nodes)) return
  for (const node of nodes as HotLibraryNode[]) {
    if (node.t === 'l' && node.hot && node.url) into.push(node.url)
    if (node.t === 'f') walk(node.kids, into)
  }
}

/** Deduped, in a stable order: library first, then Notion Quick saves. A URL
    that is both only opens once. */
export function collectHotUrls(library: unknown, saves: SavedItem[]): string[] {
  const urls: string[] = []
  if (isLibrary(library)) {
    walk(library.grid, urls)
    walk(library.root, urls)
  }
  for (const save of saves) if (save.hot && save.saveType === 'Quick' && save.url) urls.push(save.url)
  return [...new Set(urls)]
}
