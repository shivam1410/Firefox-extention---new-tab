import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_MIRROR, type SavedItem, type SavesMirror } from './saves-model'
import {
  LEGACY_FAVICON_KEY,
  LEGACY_NOTION_CACHE_KEY,
  LEGACY_SAVES_KEY,
  MIRROR_KEY,
  defaultHost,
  clearLegacySaves,
  loadLegacySaves,
  updateMirror,
  loadMirror,
  saveMirror,
  watchMirror,
  type StorageHost,
} from './saves-store'

/* ---------- a fake of the slice of browser.storage we actually use ---------- */

interface Fake extends StorageHost {
  localData: Map<string, unknown>
  syncData: Map<string, unknown>
}

function fakeHost(): Fake {
  const localData = new Map<string, unknown>()
  const syncData = new Map<string, unknown>()
  const listeners: Array<(c: Record<string, { newValue?: unknown }>, area: string) => void> = []
  const area = (data: Map<string, unknown>, name: string) => ({
    get: (key: string): Promise<Record<string, unknown>> =>
      Promise.resolve(data.has(key) ? { [key]: data.get(key) } : {}),
    set: (items: Record<string, unknown>): Promise<void> => {
      for (const [k, v] of Object.entries(items)) {
        data.set(k, v)
        for (const l of listeners) l({ [k]: { newValue: v } }, name)
      }
      return Promise.resolve()
    },
    remove: (key: string): Promise<void> => {
      data.delete(key)
      for (const l of listeners) l({ [key]: {} }, name)
      return Promise.resolve()
    },
  })
  return {
    localData,
    syncData,
    local: area(localData, 'local'),
    sync: area(syncData, 'sync'),
    onChanged: {
      addListener: (cb) => void listeners.push(cb),
      removeListener: (cb) => {
        const at = listeners.indexOf(cb)
        if (at >= 0) listeners.splice(at, 1)
      },
    },
  }
}

function item(pageId: string, over: Partial<SavedItem> = {}): SavedItem {
  return {
    pageId,
    title: `page ${pageId}`,
    url: `https://example.com/${pageId}`,
    notionUrl: `https://notion.so/${pageId}`,
    createdAt: 1_000,
    editedAt: 1_000,
    ...over,
  }
}

let host: Fake
beforeEach(() => {
  host = fakeHost()
})

/* ---------- loadMirror ---------- */

describe('loadMirror', () => {
  it('returns the empty mirror when nothing is stored yet', async () => {
    await expect(loadMirror(host)).resolves.toEqual(EMPTY_MIRROR)
  })

  it('returns the empty mirror for a value of the wrong shape', async () => {
    host.localData.set(MIRROR_KEY, 'not a mirror')
    await expect(loadMirror(host)).resolves.toEqual(EMPTY_MIRROR)
  })

  it('returns the empty mirror for a mirror from a future version', async () => {
    host.localData.set(MIRROR_KEY, { version: 99, items: [], syncedAt: 0, hotIsLocal: false })
    await expect(loadMirror(host)).resolves.toEqual(EMPTY_MIRROR)
  })

  it('returns the empty mirror when items is not an array', async () => {
    host.localData.set(MIRROR_KEY, { version: 2, items: { nope: true }, syncedAt: 0, hotIsLocal: false })
    await expect(loadMirror(host)).resolves.toEqual(EMPTY_MIRROR)
  })

  it('returns the empty mirror instead of throwing when storage itself fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const broken: StorageHost = { ...host, local: { ...host.local, get: () => Promise.reject(new Error('quota')) } }
    await expect(loadMirror(broken)).resolves.toEqual(EMPTY_MIRROR)
    expect(warn).toHaveBeenCalled() // the failure is reported, not swallowed
    warn.mockRestore()
  })

  it('drops rows whose optional fields carry the wrong type, before they reach the render path', async () => {
    host.localData.set(MIRROR_KEY, {
      version: 2,
      items: [
        { ...item('good') },
        { ...item('badFavicon'), favicon: 12345 },
        { ...item('badHot'), hot: 'yes' },
        { ...item('badType'), saveType: 7 },
      ],
      syncedAt: 0,
      hotIsLocal: false,
    })
    const m = await loadMirror(host)
    expect(m.items.map((i) => i.pageId)).toEqual(['good'])
  })

  it('drops rows with an empty url or notion url, which could only paint a dead link', async () => {
    host.localData.set(MIRROR_KEY, {
      version: 2,
      items: [{ ...item('a'), url: '' }, { ...item('b'), notionUrl: '' }, item('c')],
      syncedAt: 0,
      hotIsLocal: false,
    })
    const m = await loadMirror(host)
    expect(m.items.map((i) => i.pageId)).toEqual(['c'])
  })

  it('drops malformed rows but keeps the good ones', async () => {
    host.localData.set(MIRROR_KEY, {
      version: 2,
      items: [item('a'), { pageId: 'b' }, null, { ...item('c'), createdAt: 'soon' }],
      syncedAt: 7,
      hotIsLocal: false,
    })
    const m = await loadMirror(host)
    expect(m.items.map((i) => i.pageId)).toEqual(['a'])
  })
})

/* ---------- saveMirror ---------- */

describe('saveMirror', () => {
  it('round-trips a mirror through storage', async () => {
    const m: SavesMirror = { version: 2, items: [item('a', { hot: true })], syncedAt: 9, hotIsLocal: true }
    await saveMirror(m, host)
    await expect(loadMirror(host)).resolves.toEqual(m)
  })

  it('writes to the local area, never to sync', async () => {
    await saveMirror({ ...EMPTY_MIRROR, items: [item('a')] }, host)
    expect(host.localData.has(MIRROR_KEY)).toBe(true)
    expect(host.syncData.has(MIRROR_KEY)).toBe(false)
  })
})

describe('updateMirror', () => {
  it('serializes concurrent read-modify-writes so neither save is lost', async () => {
    // two saves landing at once: without serialization both read the same
    // mirror and the second write silently drops the first
    await Promise.all([
      updateMirror((m) => ({ ...m, items: [...m.items, item('a')] }), host),
      updateMirror((m) => ({ ...m, items: [...m.items, item('b')] }), host),
    ])
    const m = await loadMirror(host)
    expect(m.items.map((i) => i.pageId).sort()).toEqual(['a', 'b'])
  })

  it('applies a whole burst of updates in order', async () => {
    await Promise.all(
      ['a', 'b', 'c', 'd', 'e'].map((id) => updateMirror((m) => ({ ...m, items: [...m.items, item(id)] }), host)),
    )
    const m = await loadMirror(host)
    expect(m.items).toHaveLength(5)
  })

  it('resolves with the mirror it just wrote', async () => {
    const written = await updateMirror((m) => ({ ...m, items: [item('a')] }), host)
    expect(written.items.map((i) => i.pageId)).toEqual(['a'])
  })

  it('does not wedge the queue when one update throws', async () => {
    await expect(
      updateMirror(() => {
        throw new Error('bad change')
      }, host),
    ).rejects.toThrow('bad change')
    await updateMirror((m) => ({ ...m, items: [item('after')] }), host)
    const m = await loadMirror(host)
    expect(m.items.map((i) => i.pageId)).toEqual(['after'])
  })
})

/* ---------- watchMirror ---------- */

describe('watchMirror', () => {
  it('fires with the new mirror when the mirror key changes', async () => {
    const seen: SavesMirror[] = []
    watchMirror((m) => seen.push(m), host)
    await saveMirror({ ...EMPTY_MIRROR, items: [item('a')] }, host)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.items.map((i) => i.pageId)).toEqual(['a'])
  })

  it('ignores changes to unrelated keys', async () => {
    const seen: SavesMirror[] = []
    watchMirror((m) => seen.push(m), host)
    await host.local.set({ library: { root: [] } })
    expect(seen).toHaveLength(0)
  })

  it('ignores changes in the sync area', async () => {
    const seen: SavesMirror[] = []
    watchMirror((m) => seen.push(m), host)
    await host.sync?.set({ [MIRROR_KEY]: { version: 2, items: [], syncedAt: 0, hotIsLocal: false } })
    expect(seen).toHaveLength(0)
  })
})

/* ---------- legacy migration sources ---------- */

describe('loadLegacySaves', () => {
  it('returns an empty list when there is no legacy store', async () => {
    await expect(loadLegacySaves(host)).resolves.toEqual({ ok: true, rows: [] })
  })

  it('reads rows out of the retired storage.sync store', async () => {
    host.syncData.set(LEGACY_SAVES_KEY, [{ id: 's1', title: 'One', url: 'https://one.example', savedAt: 5 }])
    const { rows } = await loadLegacySaves(host)
    expect(rows).toEqual([{ id: 's1', title: 'One', url: 'https://one.example', savedAt: 5 }])
  })

  it('re-attaches favicons from the local side-cache', async () => {
    host.syncData.set(LEGACY_SAVES_KEY, [{ id: 's1', title: 'One', url: 'https://one.example', savedAt: 5 }])
    host.localData.set(LEGACY_FAVICON_KEY, { 'https://one.example': 'icon-data' })
    const { rows } = await loadLegacySaves(host)
    expect(rows[0]?.favicon).toBe('icon-data')
  })

  it('falls back to the local area when sync holds nothing', async () => {
    host.localData.set(LEGACY_SAVES_KEY, [{ id: 's1', title: 'One', url: 'https://one.example', savedAt: 5 }])
    await expect(loadLegacySaves(host)).resolves.toMatchObject({ ok: true, rows: [{ id: 's1' }] })
  })

  it('merges both retired areas — sync going stale on quota must not hide local-only saves', async () => {
    // the old writer fell back to storage.local when sync threw on quota, so
    // sync can hold an older, smaller snapshot than local
    host.syncData.set(LEGACY_SAVES_KEY, [{ id: 's1', title: 'Old', url: 'https://one.example', savedAt: 1 }])
    host.localData.set(LEGACY_SAVES_KEY, [
      { id: 's1', title: 'Old', url: 'https://one.example', savedAt: 1 },
      { id: 's2', title: 'Only in local', url: 'https://two.example', savedAt: 2 },
    ])
    const { rows } = await loadLegacySaves(host)
    expect(rows.map((r) => r.url)).toEqual(['https://one.example', 'https://two.example'])
  })

  it('reports ok:false when a read fails, so it cannot be mistaken for "nothing left to migrate"', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const broken: StorageHost = { ...host, local: { ...host.local, get: () => Promise.reject(new Error('boom')) } }
    await expect(loadLegacySaves(broken)).resolves.toEqual({ ok: false, rows: [] })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('skips rows with no usable url', async () => {
    host.syncData.set(LEGACY_SAVES_KEY, [
      { id: 's1', title: 'No url', savedAt: 5 },
      { id: 's2', title: 'Fine', url: 'https://ok.example', savedAt: 5 },
    ])
    const { rows } = await loadLegacySaves(host)
    expect(rows.map((r) => r.url)).toEqual(['https://ok.example'])
  })

  it('titles a row by its url when the stored title is missing', async () => {
    host.syncData.set(LEGACY_SAVES_KEY, [{ id: 's1', url: 'https://ok.example', savedAt: 5 }])
    const { rows } = await loadLegacySaves(host)
    expect(rows[0]?.title).toBe('https://ok.example')
  })
})

describe('clearLegacySaves', () => {
  it('removes every retired key across both areas', async () => {
    host.syncData.set(LEGACY_SAVES_KEY, [{ id: 's1', title: 'One', url: 'https://one.example', savedAt: 5 }])
    host.localData.set(LEGACY_SAVES_KEY, [])
    host.localData.set(LEGACY_FAVICON_KEY, {})
    host.localData.set(LEGACY_NOTION_CACHE_KEY, [])
    await clearLegacySaves(host)
    expect(host.syncData.has(LEGACY_SAVES_KEY)).toBe(false)
    expect(host.localData.has(LEGACY_SAVES_KEY)).toBe(false)
    expect(host.localData.has(LEGACY_FAVICON_KEY)).toBe(false)
    expect(host.localData.has(LEGACY_NOTION_CACHE_KEY)).toBe(false)
  })

  it('leaves the mirror itself alone', async () => {
    await saveMirror({ ...EMPTY_MIRROR, items: [item('a')] }, host)
    await clearLegacySaves(host)
    expect(host.localData.has(MIRROR_KEY)).toBe(true)
  })
})

/* ---------- host resolution: extension vs. the plain-browser dev preview ---------- */

describe('defaultHost', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the extension storage API when it is available', () => {
    const storage = { local: {}, sync: {}, onChanged: {} }
    vi.stubGlobal('browser', { storage })
    expect(defaultHost()).toBe(storage)
  })

  it('falls back to page localStorage in the dev preview, namespaced by prefix', async () => {
    const cells = new Map<string, string>()
    vi.stubGlobal('browser', undefined)
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => cells.get(k) ?? null,
      setItem: (k: string, v: string) => void cells.set(k, v),
      removeItem: (k: string) => void cells.delete(k),
    })
    const preview = defaultHost()
    await saveMirror({ ...EMPTY_MIRROR, items: [item('a')], syncedAt: 3 }, preview)
    expect([...cells.keys()]).toEqual([`lt-${MIRROR_KEY}`])
    const back = await loadMirror(preview)
    expect(back.items.map((i) => i.pageId)).toEqual(['a'])
  })

  it('degrades to an empty mirror when the preview has no usable storage', async () => {
    vi.stubGlobal('browser', undefined)
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('storage disabled in private browsing')
      },
      setItem: () => {
        throw new Error('storage disabled in private browsing')
      },
      removeItem: () => {
        throw new Error('storage disabled in private browsing')
      },
    })
    const preview = defaultHost()
    await expect(saveMirror({ ...EMPTY_MIRROR, items: [item('a')] }, preview)).resolves.toBeUndefined()
    await expect(loadMirror(preview)).resolves.toEqual(EMPTY_MIRROR)
    await expect(clearLegacySaves(preview)).resolves.toBeUndefined()
  })

  it('has no cross-surface change events in the preview, but still accepts a listener', () => {
    vi.stubGlobal('browser', undefined)
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
    const preview = defaultHost()
    expect(() => watchMirror(() => undefined, preview)).not.toThrow()
  })
})
