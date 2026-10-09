import { describe, expect, it } from 'vitest'
import {
  EMPTY_MIRROR,
  applyArchive,
  applyHot,
  applyRename,
  pendingMigration,
  reconcile,
  restoreRow,
  syncSummary,
  upsert,
  withFavicons,
  type LegacySave,
  type SavedItem,
  type SavesMirror,
} from './saves-model'

/* ---------- fixtures ---------- */

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
function mirror(items: SavedItem[], over: Partial<SavesMirror> = {}): SavesMirror {
  return { version: 2, items, syncedAt: 0, hotIsLocal: false, ...over }
}

/* ---------- reconcile ---------- */

describe('reconcile', () => {
  it('takes the remote title over the local one', () => {
    const prev = mirror([item('a', { title: 'stale' })])
    const next = reconcile(prev, [item('a', { title: 'fresh' })], { hotIsLocal: false, at: 5 })
    expect(next.items[0]?.title).toBe('fresh')
  })

  it('drops rows that are absent from remote (archived in Notion)', () => {
    const prev = mirror([item('a'), item('b')])
    const next = reconcile(prev, [item('a')], { hotIsLocal: false, at: 5 })
    expect(next.items.map((i) => i.pageId)).toEqual(['a'])
  })

  it('adds rows that exist only in remote', () => {
    const next = reconcile(mirror([item('a')]), [item('a'), item('b')], { hotIsLocal: false, at: 5 })
    expect(next.items.map((i) => i.pageId)).toEqual(['a', 'b'])
  })

  it('carries the device-local favicon over by pageId', () => {
    const prev = mirror([item('a', { favicon: 'data:image/png;base64,AAA' })])
    const next = reconcile(prev, [item('a')], { hotIsLocal: false, at: 5 })
    expect(next.items[0]?.favicon).toBe('data:image/png;base64,AAA')
  })

  it('prefers a favicon the remote actually supplies', () => {
    const prev = mirror([item('a', { favicon: 'old' })])
    const next = reconcile(prev, [item('a', { favicon: 'new' })], { hotIsLocal: false, at: 5 })
    expect(next.items[0]?.favicon).toBe('new')
  })

  it('carries hot over from the mirror when the database has no checkbox', () => {
    const prev = mirror([item('a', { hot: true })], { hotIsLocal: true })
    const next = reconcile(prev, [item('a', { hot: false })], { hotIsLocal: true, at: 5 })
    expect(next.items[0]?.hot).toBe(true)
  })

  it('takes hot from remote when the database has a checkbox', () => {
    const prev = mirror([item('a', { hot: true })])
    const next = reconcile(prev, [item('a', { hot: false })], { hotIsLocal: false, at: 5 })
    expect(next.items[0]?.hot).toBe(false)
  })

  it('sorts newest createdAt first', () => {
    const remote = [item('old', { createdAt: 10 }), item('new', { createdAt: 30 }), item('mid', { createdAt: 20 })]
    const next = reconcile(EMPTY_MIRROR, remote, { hotIsLocal: false, at: 5 })
    expect(next.items.map((i) => i.pageId)).toEqual(['new', 'mid', 'old'])
  })

  it('takes remote verbatim when there is no previous mirror', () => {
    const next = reconcile(EMPTY_MIRROR, [item('a')], { hotIsLocal: false, at: 5 })
    expect(next.items).toEqual([item('a')])
  })

  it('records syncedAt and hotIsLocal from the options', () => {
    const next = reconcile(EMPTY_MIRROR, [], { hotIsLocal: true, at: 42 })
    expect(next).toMatchObject({ version: 2, syncedAt: 42, hotIsLocal: true })
  })

  it('empties the mirror when remote is empty — the caller must not reconcile a failed query', () => {
    const next = reconcile(mirror([item('a'), item('b')]), [], { hotIsLocal: false, at: 5 })
    expect(next.items).toEqual([])
  })

  it('collapses a page id that remote listed twice (retried pagination)', () => {
    const next = reconcile(EMPTY_MIRROR, [item('a', { title: 'first' }), item('a', { title: 'second' })], {
      hotIsLocal: false,
      at: 5,
    })
    expect(next.items).toHaveLength(1)
    expect(next.items[0]?.title).toBe('second')
  })

  it('ignores a hot value from Notion when hot is device-local', () => {
    const next = reconcile(EMPTY_MIRROR, [item('a', { hot: true })], { hotIsLocal: true, at: 5 })
    expect(next.items[0]?.hot).toBeUndefined()
  })

  it('drops an explicitly-undefined favicon key rather than carrying it through', () => {
    const next = reconcile(EMPTY_MIRROR, [{ ...item('a'), favicon: undefined }], { hotIsLocal: false, at: 5 })
    expect(Object.hasOwn(next.items[0] ?? {}, 'favicon')).toBe(false)
  })

  it('does not mutate the previous mirror', () => {
    const prev = mirror([item('a', { title: 'stale' })])
    const snapshot = structuredClone(prev)
    reconcile(prev, [item('a', { title: 'fresh' })], { hotIsLocal: false, at: 5 })
    expect(prev).toEqual(snapshot)
  })
})

/* ---------- optimistic edits ---------- */

describe('applyRename', () => {
  it('renames the matching row and leaves the input untouched', () => {
    const before = mirror([item('a'), item('b')])
    const snapshot = structuredClone(before)
    const after = applyRename(before, 'a', 'renamed')
    expect(after.items[0]?.title).toBe('renamed')
    expect(after.items[1]?.title).toBe('page b')
    expect(before).toEqual(snapshot)
  })

  it('is a no-op for an unknown pageId', () => {
    const before = mirror([item('a')])
    expect(applyRename(before, 'nope', 'x').items).toEqual(before.items)
  })
})

describe('applyArchive', () => {
  it('removes the matching row and leaves the input untouched', () => {
    const before = mirror([item('a'), item('b')])
    const snapshot = structuredClone(before)
    const after = applyArchive(before, 'a')
    expect(after.items.map((i) => i.pageId)).toEqual(['b'])
    expect(before).toEqual(snapshot)
  })

  it('is a no-op for an unknown pageId', () => {
    const before = mirror([item('a')])
    expect(applyArchive(before, 'nope').items).toHaveLength(1)
  })
})

describe('applyHot', () => {
  it('sets hot on the matching row and leaves the input untouched', () => {
    const before = mirror([item('a'), item('b')])
    const snapshot = structuredClone(before)
    const after = applyHot(before, 'a', true)
    expect(after.items[0]?.hot).toBe(true)
    expect(after.items[1]?.hot).toBeUndefined()
    expect(before).toEqual(snapshot)
  })

  it('clears hot when set to false', () => {
    const after = applyHot(mirror([item('a', { hot: true })]), 'a', false)
    expect(after.items[0]?.hot).toBe(false)
  })

  it('is a no-op for an unknown pageId', () => {
    const before = mirror([item('a')])
    expect(applyHot(before, 'nope', true).items).toEqual(before.items)
  })
})

describe('upsert', () => {
  it('prepends a new pageId', () => {
    const after = upsert(mirror([item('a')]), item('b'))
    expect(after.items.map((i) => i.pageId)).toEqual(['b', 'a'])
  })

  it('replaces an existing pageId in place without duplicating it', () => {
    const before = mirror([item('a'), item('b')])
    const after = upsert(before, item('b', { title: 'updated' }))
    expect(after.items.map((i) => i.pageId)).toEqual(['a', 'b'])
    expect(after.items[1]?.title).toBe('updated')
  })

  it('keeps the cached favicon when refreshing a row Notion deduped onto', () => {
    const before = mirror([item('a', { favicon: 'cached-icon' })])
    const after = upsert(before, item('a', { title: 'from notion' }))
    expect(after.items[0]).toMatchObject({ title: 'from notion', favicon: 'cached-icon' })
  })

  it('keeps a device-local hot flag when refreshing an existing row', () => {
    const before = mirror([item('a', { hot: true })], { hotIsLocal: true })
    const after = upsert(before, item('a', { title: 'from notion' }))
    expect(after.items[0]?.hot).toBe(true)
  })

  it('does not mutate the input', () => {
    const before = mirror([item('a')])
    const snapshot = structuredClone(before)
    upsert(before, item('b'))
    expect(before).toEqual(snapshot)
  })
})

/* ---------- migration ---------- */

function legacy(url: string, over: Partial<LegacySave> = {}): LegacySave {
  return { id: `s-${url}`, title: `local ${url}`, url, savedAt: 1, ...over }
}

describe('pendingMigration', () => {
  it('excludes legacy rows whose url is already in the mirror', () => {
    const m = mirror([item('a', { url: 'https://kept.example' })])
    const out = pendingMigration(m, [legacy('https://kept.example'), legacy('https://new.example')])
    expect(out.map((l) => l.url)).toEqual(['https://new.example'])
  })

  it('collapses duplicate urls within the legacy list', () => {
    const out = pendingMigration(EMPTY_MIRROR, [legacy('https://dup.example'), legacy('https://dup.example')])
    expect(out).toHaveLength(1)
  })

  it('returns an empty list when there is nothing legacy', () => {
    expect(pendingMigration(EMPTY_MIRROR, [])).toEqual([])
  })

  it('skips rows with no usable url', () => {
    const out = pendingMigration(EMPTY_MIRROR, [legacy(''), legacy('https://ok.example')])
    expect(out.map((l) => l.url)).toEqual(['https://ok.example'])
  })
})

describe('EMPTY_MIRROR', () => {
  it('is frozen deeply enough that a stray push cannot corrupt the shared constant', () => {
    expect(Object.isFrozen(EMPTY_MIRROR)).toBe(true)
    expect(Object.isFrozen(EMPTY_MIRROR.items)).toBe(true)
  })
})

describe('syncSummary', () => {
  it('reports a quiet sync with the total', () => {
    expect(syncSummary(['a', 'b'], ['a', 'b'])).toBe('In sync — 2 saves')
  })

  it('uses the singular for one save', () => {
    expect(syncSummary(['a'], ['a'])).toBe('In sync — 1 save')
  })

  it('reports additions', () => {
    expect(syncSummary(['a'], ['a', 'b', 'c'])).toBe('Synced with Notion — 2 new')
  })

  it('reports pages archived in Notion', () => {
    expect(syncSummary(['a', 'b'], ['a'])).toBe('Synced with Notion — 1 archived')
  })

  it('reports both directions at once', () => {
    expect(syncSummary(['a', 'b'], ['a', 'c'])).toBe('Synced with Notion — 1 new, 1 archived')
  })

  it('handles a first sync from empty', () => {
    expect(syncSummary([], ['a', 'b'])).toBe('Synced with Notion — 2 new')
  })

  it('handles an emptied database', () => {
    expect(syncSummary(['a'], [])).toBe('Synced with Notion — 1 archived')
  })

  it('says so when there is nothing at all', () => {
    expect(syncSummary([], [])).toBe('In sync — 0 saves')
  })
})

describe('restoreRow', () => {
  it('puts an archived row back when Notion refuses the archive', () => {
    const before = mirror([item('a'), item('b')])
    const removed = applyArchive(before, 'a')
    const back = restoreRow(removed, 'a', item('a'))
    expect(back.items.map((i) => i.pageId).sort()).toEqual(['a', 'b'])
  })

  it('puts the row back in date order, not at the end', () => {
    const rowA = item('a', { createdAt: 20 })
    const before = mirror([item('c', { createdAt: 30 }), rowA, item('b', { createdAt: 10 })])
    const back = restoreRow(applyArchive(before, 'a'), 'a', rowA)
    expect(back.items.map((i) => i.pageId)).toEqual(['c', 'a', 'b'])
  })

  it('restores the previous title when Notion refuses a rename', () => {
    const original = item('a', { title: 'original' })
    const renamed = applyRename(mirror([original]), 'a', 'attempted')
    const back = restoreRow(renamed, 'a', original)
    expect(back.items[0]?.title).toBe('original')
  })

  it('restores the previous hot flag when Notion refuses the checkbox write', () => {
    const original = item('a', { hot: false })
    const toggled = applyHot(mirror([original]), 'a', true)
    expect(restoreRow(toggled, 'a', original).items[0]?.hot).toBe(false)
  })

  it('removes the row when it did not exist before the change', () => {
    const added = upsert(mirror([item('b')]), item('a'))
    const back = restoreRow(added, 'a', undefined)
    expect(back.items.map((i) => i.pageId)).toEqual(['b'])
  })

  it('leaves rows that arrived during the failed write alone', () => {
    // a save landing mid-flight must survive the rollback — restoring a whole
    // stale snapshot would have deleted it
    const before = mirror([item('a', { createdAt: 10 })])
    const during = upsert(applyArchive(before, 'a'), item('new', { createdAt: 99 }))
    const back = restoreRow(during, 'a', item('a', { createdAt: 10 }))
    expect(back.items.map((i) => i.pageId)).toEqual(['new', 'a'])
  })

  it('does not mutate the input', () => {
    const m = mirror([item('a')])
    const snapshot = structuredClone(m)
    restoreRow(m, 'a', item('a', { title: 'x' }))
    expect(m).toEqual(snapshot)
  })
})

describe('upsert ordering', () => {
  it('files an older restored row by date instead of pinning it to the top', () => {
    const m = mirror([item('new', { createdAt: 100 }), item('mid', { createdAt: 50 })])
    const after = upsert(m, item('old', { createdAt: 10 }))
    expect(after.items.map((i) => i.pageId)).toEqual(['new', 'mid', 'old'])
  })

  it('still puts a genuinely new save first, since it has the newest date', () => {
    const m = mirror([item('a', { createdAt: 10 })])
    const after = upsert(m, item('fresh', { createdAt: 999 }))
    expect(after.items.map((i) => i.pageId)).toEqual(['fresh', 'a'])
  })
})

describe('withFavicons', () => {
  const icon = (i: SavedItem): string | undefined => (i.pageId === 'a' ? 'icon-a' : undefined)

  it('fills a row that has no favicon', () => {
    const after = withFavicons(mirror([item('a')]), () => 'found')
    expect(after.items[0]?.favicon).toBe('found')
  })

  it('leaves a row that already has one alone', () => {
    const after = withFavicons(mirror([item('a', { favicon: 'kept' })]), () => 'other')
    expect(after.items[0]?.favicon).toBe('kept')
  })

  it('fills only the rows a lookup can answer for', () => {
    const after = withFavicons(mirror([item('a'), item('b')]), icon)
    expect(after.items.map((i) => i.favicon)).toEqual(['icon-a', undefined])
  })

  it('returns the same object when nothing changed, so callers skip the write', () => {
    const m = mirror([item('a', { favicon: 'kept' })])
    expect(withFavicons(m, () => undefined)).toBe(m)
    expect(withFavicons(m, () => 'ignored')).toBe(m)
  })

  it('does not mutate the input', () => {
    const m = mirror([item('a')])
    const snapshot = structuredClone(m)
    withFavicons(m, () => 'found')
    expect(m).toEqual(snapshot)
  })
})
