/* Mapping between Notion's API shapes and our own save model.

   Notion databases are user-owned, so we never demand fixed property names —
   the schema is read and matched by property *type*, and anything we cannot
   find is simply absent. This module is pure so those branches, which fail
   silently against a real database, can be tested. */

import type { SavedItem } from './saves-model'

export interface NotionSchema {
  titleProp: string
  urlProp?: string
  dateProp?: string
  tagsProp?: string
  domainProp?: string
  typeProp?: string
  /** Checkbox holding the 🔥 hot-app flag. Absent on databases that have no
      checkbox at all, in which case hot is remembered per-device instead. */
  hotProp?: string
}

const SAVE_TYPES = ['Quick', 'Summary'] as const

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/** Matches a database's properties to the roles we need.
    Returns a human-readable reason when the database cannot work at all. */
export function mapProperties(props: Record<string, { type?: string }>): NotionSchema | string {
  const entries = Object.entries(props)
  const titleProp = entries.find(([, def]) => def.type === 'title')?.[0]
  if (!titleProp) return 'The database has no title property (every Notion database should).'

  const firstOfType = (type: string): string | undefined => entries.find(([, def]) => def.type === type)?.[0]
  const checkboxes = entries.filter(([, def]) => def.type === 'checkbox').map(([name]) => name)
  const selects = entries.filter(([, def]) => def.type === 'select').map(([name]) => name)

  return {
    titleProp,
    urlProp: firstOfType('url'),
    dateProp: firstOfType('date'),
    tagsProp: firstOfType('multi_select'),
    typeProp: selects.find((name) => /^(type|kind)$/i.test(name)),
    domainProp: selects.find((name) => /domain|site|source/i.test(name)),
    // a database may well have several checkboxes; prefer one that reads like
    // ours before falling back to whatever it has
    hotProp: checkboxes.find((name) => /hot|warm|pin/i.test(name)) ?? checkboxes[0],
  }
}

function plainText(prop: unknown): string {
  if (!isRecord(prop) || !Array.isArray(prop['title'])) return ''
  return prop['title']
    .map((chunk) => (isRecord(chunk) && typeof chunk['plain_text'] === 'string' ? chunk['plain_text'] : ''))
    .join('')
}

function propOf(page: Record<string, unknown>, name: string | undefined): unknown {
  if (!name) return undefined
  const props = page['properties']
  return isRecord(props) ? props[name] : undefined
}

/** Notion timestamps are ISO strings; a missing or unparseable one becomes 0
    rather than NaN, which would make every sort comparison false. */
function epoch(value: unknown): number {
  if (typeof value !== 'string') return 0
  const at = Date.parse(value)
  return Number.isNaN(at) ? 0 : at
}

/** Converts one Notion page into a save, or null when the page could never be
    rendered or opened (no id, or no Notion URL to link back to). */
export function pageToSavedItem(page: unknown, schema: NotionSchema): SavedItem | null {
  if (!isRecord(page)) return null
  const pageId = typeof page['id'] === 'string' ? page['id'] : ''
  const notionUrl = typeof page['url'] === 'string' ? page['url'] : ''
  if (!pageId || !notionUrl) return null

  const urlProp = propOf(page, schema.urlProp)
  const linked = isRecord(urlProp) && typeof urlProp['url'] === 'string' ? urlProp['url'] : ''

  const item: SavedItem = {
    pageId,
    title: plainText(propOf(page, schema.titleProp)) || 'Untitled',
    url: linked || notionUrl, // databases without a url property link back to Notion
    notionUrl,
    createdAt: epoch(page['created_time']),
    editedAt: epoch(page['last_edited_time']),
  }

  const typeProp = propOf(page, schema.typeProp)
  const select = isRecord(typeProp) ? typeProp['select'] : undefined
  const typeName = isRecord(select) && typeof select['name'] === 'string' ? select['name'] : ''
  if ((SAVE_TYPES as readonly string[]).includes(typeName)) item.saveType = typeName as SavedItem['saveType']

  const hotProp = propOf(page, schema.hotProp)
  if (isRecord(hotProp) && typeof hotProp['checkbox'] === 'boolean') item.hot = hotProp['checkbox']

  return item
}

/* ---------- paginated listing ---------- */

/** One raw response from the database-query endpoint. Injected rather than
    fetched here, so the paging rules stay testable and this module stays free
    of both network and browser APIs. */
export interface QueryResult {
  ok: boolean
  status: number
  json: Record<string, unknown>
}
export type QuerySaves = (cursor?: string) => Promise<QueryResult>

export interface CollectResult {
  ok: boolean
  message: string
  items: SavedItem[]
}

/** How many pages of 100 we are willing to walk in one refresh. Bounds the
    work independently of what the API reports, so the loop terminates even if
    a page claims `has_more` forever. */
export const MAX_QUERY_PAGES = 20

function queryError(status: number, json: Record<string, unknown>): string {
  if (status === 401) return 'Notion rejected the token — reconnect in Notion settings.'
  const message = typeof json['message'] === 'string' ? json['message'] : `HTTP ${status}`
  return `Notion error: ${message}`
}

/** Walks every page of the database and maps the rows.

    Returns `ok: false` **with an empty list** for any outcome that is not a
    complete listing — a failed page, or a database larger than the ceiling.
    That matters because `reconcile` trusts its input completely and reads an
    empty listing as "the user archived everything"; handing it a partial page
    set would silently delete the rows we never fetched. */
export async function collectSaves(
  query: QuerySaves,
  schema: NotionSchema,
  maxPages: number = MAX_QUERY_PAGES,
): Promise<CollectResult> {
  const items: SavedItem[] = []
  let cursor: string | undefined
  for (let page = 0; page < maxPages; page++) {
    const r = await query(cursor)
    if (!r.ok) return { ok: false, message: queryError(r.status, r.json), items: [] }
    for (const row of (r.json['results'] as unknown[] | undefined) ?? []) {
      const item = pageToSavedItem(row, schema)
      if (item) items.push(item)
    }
    const more = r.json['has_more'] === true && typeof r.json['next_cursor'] === 'string'
    if (!more) return { ok: true, message: `${items.length} save${items.length === 1 ? '' : 's'}`, items }
    cursor = r.json['next_cursor'] as string
  }
  return {
    ok: false,
    message: `This database holds more than ${maxPages * 100} saves — too many to sync in one pass. Archive some in Notion, then refresh.`,
    items: [],
  }
}
