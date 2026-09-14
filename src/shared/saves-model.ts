/* Pure save-model logic — the reconcile rules between the Notion database
   (the source of truth) and the local mirror that paints the UI.

   This module imports nothing and touches no browser API, so it stays unit
   testable and is the single place the merge rules live. Every function
   returns a new object; nothing here mutates its input. */

/** One save. Identity is the Notion page id — never the URL, because the
    same URL may legitimately be saved twice and a URL can be edited. */
export interface SavedItem {
  pageId: string
  title: string
  /** The page's url property, or `notionUrl` when the database has none. */
  url: string
  /** Always set — the "Open in Notion" target. */
  notionUrl: string
  saveType?: 'Quick' | 'Summary'
  hot?: boolean
  /** Device-local: favicons are never written to Notion. */
  favicon?: string
  createdAt: number
  editedAt: number
}

export interface SavesMirror {
  version: 2
  items: SavedItem[]
  syncedAt: number
  /** True when the database has no checkbox property, so `hot` can only be
      remembered on this device. */
  hotIsLocal: boolean
}

/** A row from the retired `storage.sync` saved-tabs store. */
export interface LegacySave {
  id: string
  title: string
  url: string
  favicon?: string
  savedAt: number
}

const emptyMirror: SavesMirror = { version: 2, items: [], syncedAt: 0, hotIsLocal: false }
Object.freeze(emptyMirror.items) // shared singleton: freeze the array too, not just the wrapper
export const EMPTY_MIRROR: SavesMirror = Object.freeze(emptyMirror)

function byPageId(items: SavedItem[]): Map<string, SavedItem> {
  return new Map(items.map((i) => [i.pageId, i]))
}

/** Re-attaches the fields Notion does not store, so that every path which folds
    a Notion row into the mirror — `reconcile` and `upsert` alike — preserves
    them identically. `favicon` is always device-local; `hot` is device-local
    only when the database has no checkbox property to hold it. */
function carryLocal(remote: SavedItem, local: SavedItem | undefined, hotIsLocal: boolean): SavedItem {
  const merged: SavedItem = { ...remote }

  const favicon = remote.favicon ?? local?.favicon
  if (favicon === undefined) delete merged.favicon
  else merged.favicon = favicon

  // when hot lives only on this device, a value coming back from Notion is
  // meaningless and must not overwrite what this device remembers
  const hot = hotIsLocal ? local?.hot : remote.hot
  if (hot === undefined) delete merged.hot
  else merged.hot = hot

  return merged
}

/** Folds a fresh Notion listing into the mirror.

    Remote wins outright: writes are optimistic-with-rollback, so a mirror row
    can never hold an edit Notion has not already accepted. Rows missing from
    `remote` were archived (by us or in Notion) and are dropped.

    The exceptions are the fields Notion does not store — see `carryLocal`.

    `remote` is trusted completely, including when it is empty: that means the
    user archived everything, and the mirror is emptied to match. Callers must
    therefore pass a listing only when the Notion query actually succeeded, and
    keep the existing mirror untouched on any error. */
export function reconcile(
  prev: SavesMirror,
  remote: SavedItem[],
  opts: { hotIsLocal: boolean; at: number },
): SavesMirror {
  const known = byPageId(prev.items)
  // page ids are unique in the mirror (I2); a paginated listing that retried
  // could hand us the same page twice, so collapse before merging
  const items = [...byPageId(remote).values()]
    .map((r) => carryLocal(r, known.get(r.pageId), opts.hotIsLocal))
    .sort((a, b) => b.createdAt - a.createdAt)
  return { version: 2, items, syncedAt: opts.at, hotIsLocal: opts.hotIsLocal }
}

function mapRow(m: SavesMirror, pageId: string, fn: (i: SavedItem) => SavedItem): SavesMirror {
  return { ...m, items: m.items.map((i) => (i.pageId === pageId ? fn(i) : i)) }
}

export function applyRename(m: SavesMirror, pageId: string, title: string): SavesMirror {
  return mapRow(m, pageId, (i) => ({ ...i, title }))
}

/** Removing a save is archiving it — the row leaves the mirror, and the caller
    sets `archived: true` on the Notion page. Nothing is ever deleted. */
export function applyArchive(m: SavesMirror, pageId: string): SavesMirror {
  return { ...m, items: m.items.filter((i) => i.pageId !== pageId) }
}

export function applyHot(m: SavesMirror, pageId: string, hot: boolean): SavesMirror {
  return mapRow(m, pageId, (i) => ({ ...i, hot }))
}

/** Undoes one failed optimistic edit by putting a single row back the way it
    was — `undefined` meaning it did not exist and should be removed again.

    Deliberately row-scoped rather than restoring a whole pre-edit snapshot: a
    save landing while the write was in flight must survive the rollback, and
    replaying a stale mirror would delete it. */
export function restoreRow(m: SavesMirror, pageId: string, row: SavedItem | undefined): SavesMirror {
  if (!row) return applyArchive(m, pageId)
  const others = m.items.filter((i) => i.pageId !== pageId)
  return { ...m, items: [...others, row].sort((a, b) => b.createdAt - a.createdAt) }
}

/** Adds a newly created save, or refreshes one already present.

    Refreshing goes through the same `carryLocal` merge as `reconcile`, so a
    page that Notion deduped onto an existing row keeps the favicon and
    device-local hot flag this device had already cached for it. */
export function upsert(m: SavesMirror, item: SavedItem): SavesMirror {
  const existing = m.items.find((i) => i.pageId === item.pageId)
  const merged = carryLocal(item, existing, m.hotIsLocal)
  return existing
    ? mapRow(m, item.pageId, () => merged)
    : { ...m, items: [merged, ...m.items] }
}

/** The legacy rows still worth pushing to Notion: those with a usable URL that
    the mirror does not already cover, deduped against each other. */
export function pendingMigration(m: SavesMirror, legacy: LegacySave[]): LegacySave[] {
  const seen = new Set(m.items.map((i) => i.url))
  const out: LegacySave[] = []
  for (const row of legacy) {
    if (!row.url || seen.has(row.url)) continue
    seen.add(row.url)
    out.push(row)
  }
  return out
}

/** The one-line result of a refresh, in the user's terms: what actually moved,
    or the total when nothing did. Pure so the wording is pinned by tests. */
export function syncSummary(beforeIds: string[], afterIds: string[]): string {
  const before = new Set(beforeIds)
  const after = new Set(afterIds)
  const added = afterIds.filter((id) => !before.has(id)).length
  const archived = beforeIds.filter((id) => !after.has(id)).length
  if (!added && !archived) return `In sync — ${after.size} save${after.size === 1 ? '' : 's'}`
  const parts: string[] = []
  if (added) parts.push(`${added} new`)
  if (archived) parts.push(`${archived} archived`)
  return `Synced with Notion — ${parts.join(', ')}`
}
