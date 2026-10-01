import { describe, expect, it } from 'vitest'
import { collectSaves, mapProperties, pageToSavedItem, type NotionSchema, type QueryResult } from './notion-map'

/* ---------- schema mapping ---------- */

const title = { type: 'title' }

describe('mapProperties', () => {
  it('refuses a database with no title property', () => {
    expect(typeof mapProperties({ Link: { type: 'url' } })).toBe('string')
  })

  it('finds the title, url, date, tags and type properties by shape', () => {
    const schema = mapProperties({
      Name: title,
      Link: { type: 'url' },
      Saved: { type: 'date' },
      Tags: { type: 'multi_select' },
      Type: { type: 'select' },
    })
    expect(schema).toMatchObject({
      titleProp: 'Name',
      urlProp: 'Link',
      dateProp: 'Saved',
      tagsProp: 'Tags',
      typeProp: 'Type',
    })
  })

  it('maps a domain-ish select separately from the type select', () => {
    const schema = mapProperties({ Name: title, Site: { type: 'select' }, Kind: { type: 'select' } })
    expect(schema).toMatchObject({ domainProp: 'Site', typeProp: 'Kind' })
  })

  it('prefers a checkbox named for hotness over any other checkbox', () => {
    const schema = mapProperties({ Name: title, Archived: { type: 'checkbox' }, Hot: { type: 'checkbox' } })
    expect(schema).toMatchObject({ hotProp: 'Hot' })
  })

  it('falls back to the only checkbox when none is named for hotness', () => {
    const schema = mapProperties({ Name: title, Starred: { type: 'checkbox' } })
    expect(schema).toMatchObject({ hotProp: 'Starred' })
  })

  it('leaves hotProp undefined when the database has no checkbox at all', () => {
    const schema = mapProperties({ Name: title, Link: { type: 'url' } })
    expect(schema).toMatchObject({ hotProp: undefined })
  })

  it('ignores properties it has no use for', () => {
    const schema = mapProperties({ Name: title, Notes: { type: 'rich_text' }, Owner: { type: 'people' } })
    expect(schema).toMatchObject({ titleProp: 'Name', urlProp: undefined })
  })
})

/* ---------- page mapping ---------- */

const schema: NotionSchema = { titleProp: 'Name', urlProp: 'Link', typeProp: 'Type', hotProp: 'Hot' }

function page(over: Record<string, unknown> = {}, props: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'page-1',
    url: 'https://notion.so/page-1',
    created_time: '2026-01-02T03:04:05.000Z',
    last_edited_time: '2026-02-02T03:04:05.000Z',
    properties: {
      Name: { title: [{ plain_text: 'Hello ' }, { plain_text: 'world' }] },
      Link: { url: 'https://example.com/article' },
      ...props,
    },
    ...over,
  }
}

describe('pageToSavedItem', () => {
  it('maps a complete page', () => {
    expect(pageToSavedItem(page(), schema)).toEqual({
      pageId: 'page-1',
      title: 'Hello world',
      url: 'https://example.com/article',
      notionUrl: 'https://notion.so/page-1',
      createdAt: Date.parse('2026-01-02T03:04:05.000Z'),
      editedAt: Date.parse('2026-02-02T03:04:05.000Z'),
    })
  })

  it('falls back to the Notion page url when the database has no url property', () => {
    const item = pageToSavedItem(page(), { titleProp: 'Name' })
    expect(item?.url).toBe('https://notion.so/page-1')
  })

  it('falls back to the Notion page url when the url property is empty', () => {
    const item = pageToSavedItem(page({}, { Link: { url: null } }), schema)
    expect(item?.url).toBe('https://notion.so/page-1')
  })

  it('titles an untitled page rather than rendering a blank row', () => {
    const item = pageToSavedItem(page({}, { Name: { title: [] } }), schema)
    expect(item?.title).toBe('Untitled')
  })

  it('reads the save type when Notion reports a known one', () => {
    const item = pageToSavedItem(page({}, { Type: { select: { name: 'Quick' } } }), schema)
    expect(item?.saveType).toBe('Quick')
  })

  it('ignores a select value that is not one of our save types', () => {
    const item = pageToSavedItem(page({}, { Type: { select: { name: 'Something else' } } }), schema)
    expect(item?.saveType).toBeUndefined()
  })

  it('reads the hot checkbox', () => {
    const item = pageToSavedItem(page({}, { Hot: { checkbox: true } }), schema)
    expect(item?.hot).toBe(true)
  })

  it('leaves hot undefined when the database has no checkbox property', () => {
    const item = pageToSavedItem(page({}, { Hot: { checkbox: true } }), { titleProp: 'Name' })
    expect(item?.hot).toBeUndefined()
  })

  it('rejects a page with no id', () => {
    expect(pageToSavedItem(page({ id: undefined }), schema)).toBeNull()
  })

  it('rejects a page with no Notion url, which could never be opened in Notion', () => {
    expect(pageToSavedItem(page({ url: '' }), schema)).toBeNull()
  })

  it('rejects anything that is not a page object', () => {
    expect(pageToSavedItem(null, schema)).toBeNull()
    expect(pageToSavedItem('nope', schema)).toBeNull()
  })

  it('survives unparseable timestamps rather than producing NaN', () => {
    const item = pageToSavedItem(page({ created_time: 'not a date', last_edited_time: undefined }), schema)
    expect(item?.createdAt).toBe(0)
    expect(item?.editedAt).toBe(0)
  })
})

/* ---------- pagination ---------- */

function okPage(ids: string[], nextCursor?: string): QueryResult {
  return {
    ok: true,
    status: 200,
    json: {
      results: ids.map((id) => ({
        id,
        url: `https://notion.so/${id}`,
        created_time: '2026-01-01T00:00:00.000Z',
        last_edited_time: '2026-01-01T00:00:00.000Z',
        properties: { Name: { title: [{ plain_text: id }] } },
      })),
      has_more: nextCursor !== undefined,
      next_cursor: nextCursor ?? null,
    },
  }
}

const nameOnly: NotionSchema = { titleProp: 'Name' }

describe('collectSaves', () => {
  it('returns everything from a single page', async () => {
    const r = await collectSaves(() => Promise.resolve(okPage(['a', 'b'])), nameOnly)
    expect(r.ok).toBe(true)
    expect(r.items.map((i) => i.pageId)).toEqual(['a', 'b'])
  })

  it('follows the cursor across pages and concatenates them', async () => {
    const cursors: Array<string | undefined> = []
    const r = await collectSaves((cursor) => {
      cursors.push(cursor)
      return Promise.resolve(cursor === 'p2' ? okPage(['c']) : okPage(['a', 'b'], 'p2'))
    }, nameOnly)
    expect(cursors).toEqual([undefined, 'p2'])
    expect(r.items.map((i) => i.pageId)).toEqual(['a', 'b', 'c'])
  })

  it('refuses the whole listing when a later page fails, rather than returning a partial one', async () => {
    const r = await collectSaves(
      (cursor) =>
        Promise.resolve(
          cursor === 'p2' ? { ok: false, status: 500, json: { message: 'boom' } } : okPage(['a'], 'p2'),
        ),
      nameOnly,
    )
    expect(r.ok).toBe(false)
    expect(r.items).toEqual([]) // reconcile reads an empty listing as "all archived" — it must never see this
    expect(r.message).toContain('boom')
  })

  it('names the token as the problem on a 401', async () => {
    const r = await collectSaves(() => Promise.resolve({ ok: false, status: 401, json: {} }), nameOnly)
    expect(r.message).toMatch(/token/i)
  })

  it('refuses rather than silently truncating a database bigger than the page ceiling', async () => {
    // has_more never goes false: the database is larger than we will page through
    const r = await collectSaves((cursor) => Promise.resolve(okPage([`p${cursor ?? '0'}`], 'more')), nameOnly, 3)
    expect(r.ok).toBe(false)
    expect(r.items).toEqual([])
    expect(r.message).toMatch(/too many|archive/i)
  })

  it('terminates on a page that reports more but yields nothing', async () => {
    let calls = 0
    const r = await collectSaves(() => {
      calls++
      return Promise.resolve(okPage([], 'always-more'))
    }, nameOnly, 4)
    expect(calls).toBe(4) // bounded by pages, not by how many items came back
    expect(r.ok).toBe(false)
  })

  it('drops pages that cannot be mapped without failing the listing', async () => {
    const r = await collectSaves(
      () => Promise.resolve({ ok: true, status: 200, json: { results: [{ id: 'no-url' }, ...(okPage(['a']).json['results'] as unknown[])], has_more: false } }),
      nameOnly,
    )
    expect(r.ok).toBe(true)
    expect(r.items.map((i) => i.pageId)).toEqual(['a'])
  })
})
