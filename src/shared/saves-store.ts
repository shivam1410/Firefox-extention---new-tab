/* The local mirror of the Notion database.

   Notion is the source of truth; this is the cache that lets the new tab paint
   saves before any network request finishes. It lives in `storage.local` and is
   shared by the app page, the toolbar popup and the background event page, so
   whichever context writes it, every open surface hears about it through
   `storage.onChanged`.

   Nothing here decides *what* the mirror should contain — that is
   `saves-model.ts`. This module only reads, writes, validates and watches. */

import { EMPTY_MIRROR, type LegacySave, type SavedItem, type SavesMirror } from './saves-model'

export const MIRROR_KEY = 'saves'

/* Keys from the retired storage.sync store, read once during migration and
   then removed. See docs/adr/0001-notion-is-the-system-of-record.md. */
export const LEGACY_SAVES_KEY = 'savedTabs'
export const LEGACY_FAVICON_KEY = 'savedFavicons'
export const LEGACY_NOTION_CACHE_KEY = 'notionCache'

export interface StorageHost {
  local: WebExtStorageArea
  sync?: WebExtStorageArea
  onChanged: WebExtStorageChangeEvent
}

/* ---------- host resolution (extension, or the plain-browser dev preview) ---------- */

function localStorageArea(): WebExtStorageArea {
  const k = (key: string): string => `lt-${key}`
  return {
    get: (keys) => {
      const key = Array.isArray(keys) ? (keys[0] ?? '') : keys
      try {
        const raw = localStorage.getItem(k(key))
        return Promise.resolve(raw ? { [key]: JSON.parse(raw) as unknown } : {})
      } catch {
        return Promise.resolve({}) // preview without storage: start empty
      }
    },
    set: (items) => {
      try {
        for (const [key, value] of Object.entries(items)) localStorage.setItem(k(key), JSON.stringify(value))
      } catch {
        /* preview without storage: the mirror simply does not persist */
      }
      return Promise.resolve()
    },
    remove: (keys) => {
      try {
        for (const key of Array.isArray(keys) ? keys : [keys]) localStorage.removeItem(k(key))
      } catch {
        /* as above */
      }
      return Promise.resolve()
    },
  }
}

export function defaultHost(): StorageHost {
  const g = globalThis as { browser?: typeof browser }
  const storage = g.browser?.storage
  if (storage) return storage
  // dev preview: no extension APIs, so back onto page localStorage and accept
  // that cross-surface change events are not available there
  return { local: localStorageArea(), onChanged: { addListener: () => undefined, removeListener: () => undefined } }
}

async function readKey(area: WebExtStorageArea, key: string): Promise<unknown> {
  const box = await area.get(key)
  return box[key]
}

/* ---------- validation ---------- */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function isOptional(v: unknown, type: 'string' | 'boolean'): boolean {
  return v === undefined || typeof v === type
}

/** A stored row is only usable if it still carries an identity and every field
    the UI renders, at the right type. This is the trust boundary in front of
    the render path: `favicon`, `hot` and `saveType` are all painted, so a
    corrupt value here would reach `esc()` or a DOM attribute rather than being
    dropped. Anything that fails is discarded rather than painted half-broken. */
function isSavedItem(v: unknown): v is SavedItem {
  if (!isRecord(v)) return false
  return (
    typeof v['pageId'] === 'string' &&
    v['pageId'] !== '' &&
    typeof v['title'] === 'string' &&
    typeof v['url'] === 'string' &&
    v['url'] !== '' &&
    typeof v['notionUrl'] === 'string' &&
    v['notionUrl'] !== '' &&
    typeof v['createdAt'] === 'number' &&
    typeof v['editedAt'] === 'number' &&
    isOptional(v['favicon'], 'string') &&
    isOptional(v['hot'], 'boolean') &&
    isOptional(v['saveType'], 'string')
  )
}

/** Never throws. A mirror we cannot read is treated as no mirror at all — the
    next refresh repopulates it from Notion, which has lost nothing. */
function parseMirror(raw: unknown): SavesMirror {
  if (!isRecord(raw)) return EMPTY_MIRROR
  if (raw['version'] !== 2) return EMPTY_MIRROR // older or newer layout: rebuild from Notion
  if (!Array.isArray(raw['items'])) return EMPTY_MIRROR
  return {
    version: 2,
    items: raw['items'].filter(isSavedItem),
    syncedAt: typeof raw['syncedAt'] === 'number' ? raw['syncedAt'] : 0,
    hotIsLocal: raw['hotIsLocal'] === true,
  }
}

/* ---------- mirror ---------- */

export async function loadMirror(host: StorageHost = defaultHost()): Promise<SavesMirror> {
  try {
    return parseMirror(await readKey(host.local, MIRROR_KEY))
  } catch (err) {
    console.warn('[library-tab] could not read the saves mirror, starting empty:', err)
    return EMPTY_MIRROR
  }
}

export async function saveMirror(mirror: SavesMirror, host: StorageHost = defaultHost()): Promise<void> {
  try {
    await host.local.set({ [MIRROR_KEY]: mirror })
  } catch (err) {
    console.warn('[library-tab] could not write the saves mirror:', err)
  }
}

/** Calls back whenever the mirror changes — including when this very context
    wrote it, which is what keeps every open new tab in step. Repaints driven by
    this must therefore be idempotent. */
export function watchMirror(cb: (mirror: SavesMirror) => void, host: StorageHost = defaultHost()): void {
  host.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return
    const change = changes[MIRROR_KEY]
    if (!change) return
    cb(parseMirror(change.newValue))
  })
}

/* ---------- retired stores, read only for the one-time migration ---------- */

/** Both retired areas are read and merged — never one or the other.

    The old writer (`saved-tabs.ts`) wrote to `storage.sync` and, when that threw
    on the ~100KB quota, wrote the full list to `storage.local` instead. `sync`
    then keeps a stale, smaller snapshot while `local` holds the complete list,
    so preferring either area on its own can hide real saves. */
async function legacyRows(host: StorageHost): Promise<unknown[]> {
  const areas = host.sync ? [host.sync, host.local] : [host.local]
  const rows: unknown[] = []
  for (const area of areas) {
    const found = await readKey(area, LEGACY_SAVES_KEY)
    if (Array.isArray(found)) rows.push(...found)
  }
  return rows
}

export interface LegacyReadResult {
  /** False when a read actually failed. Callers MUST NOT treat this like an
      empty result: an empty list means migration is finished, whereas a failed
      read means the legacy keys may still hold the only copy of that data. */
  ok: boolean
  rows: LegacySave[]
}

export async function loadLegacySaves(host: StorageHost = defaultHost()): Promise<LegacyReadResult> {
  try {
    const rows = await legacyRows(host)
    if (!rows.length) return { ok: true, rows: [] }
    const cached = await readKey(host.local, LEGACY_FAVICON_KEY)
    const favicons = isRecord(cached) ? cached : {}
    const seen = new Set<string>()
    const out: LegacySave[] = []
    for (const row of rows) {
      if (!isRecord(row)) continue
      const url = typeof row['url'] === 'string' ? row['url'] : ''
      if (!url || seen.has(url)) continue // nothing to save, or the other area listed it too
      seen.add(url)
      const favicon = favicons[url]
      const title = typeof row['title'] === 'string' && row['title'] ? row['title'] : url
      out.push({
        id: typeof row['id'] === 'string' ? row['id'] : url,
        title,
        url,
        favicon: typeof favicon === 'string' ? favicon : undefined,
        savedAt: typeof row['savedAt'] === 'number' ? row['savedAt'] : 0,
      })
    }
    return { ok: true, rows: out }
  } catch (err) {
    console.warn('[library-tab] could not read the legacy saved-tabs store:', err)
    return { ok: false, rows: [] }
  }
}

/** Run only once every legacy row has reached Notion — until then these keys
    are the only copy of that data. In particular, never call this off the back
    of a `loadLegacySaves` result whose `ok` was false. */
export async function clearLegacySaves(host: StorageHost = defaultHost()): Promise<void> {
  await host.sync?.remove(LEGACY_SAVES_KEY)
  await host.local.remove(LEGACY_SAVES_KEY)
  await host.local.remove(LEGACY_FAVICON_KEY)
  await host.local.remove(LEGACY_NOTION_CACHE_KEY)
}
