/* Notion client — talks to api.notion.com directly from the background page
   (host permission bypasses CORS; the PAT never leaves the browser except to
   Notion over HTTPS). The database schema is read and mapped adaptively, so
   any database works: we find the title property, plus url/date/multi-select
   properties when present, instead of demanding fixed names. */

export interface NotionConfig {
  token: string
  databaseId: string
  databaseName: string
}

const NOTION = 'https://api.notion.com/v1'
const VERSION = '2022-06-28'

async function getStoredCfg(): Promise<NotionConfig | null> {
  const box = await browser.storage.local.get('notionCfg')
  return (box['notionCfg'] as NotionConfig | undefined) ?? null
}
export async function setNotionConfig(cfg: NotionConfig | null): Promise<void> {
  if (cfg) await browser.storage.local.set({ notionCfg: cfg })
  else await browser.storage.local.remove('notionCfg')
}
export function getNotionConfig(): Promise<NotionConfig | null> {
  return getStoredCfg()
}

interface NotionError {
  message?: string
  code?: string
}

async function notionFetch(token: string, path: string, method: string, body?: unknown): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${NOTION}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': VERSION,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { ok: res.ok, status: res.status, json }
}

export interface DbInfo {
  id: string
  title: string
}

/** Lists databases the integration can see (i.e. that were shared with it). */
export async function listDatabases(token: string): Promise<{ ok: boolean; message: string; dbs: DbInfo[] }> {
  try {
    const r = await notionFetch(token, '/search', 'POST', {
      filter: { property: 'object', value: 'database' },
      page_size: 25,
    })
    if (!r.ok) {
      const err = r.json as NotionError
      const msg =
        r.status === 401
          ? 'Notion rejected the token — check the PAT.'
          : `Notion error: ${err.message ?? `HTTP ${r.status}`}`
      return { ok: false, message: msg, dbs: [] }
    }
    const results = (r.json['results'] as Array<Record<string, unknown>> | undefined) ?? []
    const dbs: DbInfo[] = results.map((d) => {
      const titleArr = d['title'] as Array<{ plain_text?: string }> | undefined
      return { id: String(d['id']), title: titleArr?.map((t) => t.plain_text ?? '').join('') || 'Untitled database' }
    })
    if (!dbs.length)
      return { ok: false, message: 'Token works, but no databases are shared with the integration yet — open your database in Notion → ⋯ → Connections → add your integration.', dbs: [] }
    return { ok: true, message: `Found ${dbs.length} database${dbs.length === 1 ? '' : 's'}`, dbs }
  } catch {
    return { ok: false, message: 'Could not reach Notion — check your connection.', dbs: [] }
  }
}

interface SchemaMap {
  titleProp: string
  urlProp?: string
  dateProp?: string
  tagsProp?: string
  domainProp?: string
  typeProp?: string
}

async function mapSchema(token: string, databaseId: string): Promise<SchemaMap | string> {
  const r = await notionFetch(token, `/databases/${databaseId}`, 'GET')
  if (!r.ok) return `Could not read the database (${(r.json as NotionError).message ?? r.status})`
  const props = (r.json['properties'] as Record<string, { type?: string }> | undefined) ?? {}
  let titleProp = ''
  let urlProp: string | undefined
  let dateProp: string | undefined
  let tagsProp: string | undefined
  let domainProp: string | undefined
  let typeProp: string | undefined
  for (const [name, def] of Object.entries(props)) {
    if (def.type === 'title') titleProp = name
    else if (def.type === 'url' && !urlProp) urlProp = name
    else if (def.type === 'date' && !dateProp) dateProp = name
    else if (def.type === 'multi_select' && !tagsProp) tagsProp = name
    else if (def.type === 'select' && !typeProp && /^(type|kind)$/i.test(name)) typeProp = name
    else if (def.type === 'select' && !domainProp && /domain|site|source/i.test(name)) domainProp = name
  }
  if (!titleProp) return 'The database has no title property (every Notion database should).'
  return { titleProp, urlProp, dateProp, tagsProp, domainProp, typeProp }
}

export interface SaveInput {
  title: string
  url: string
  summary: string
  fullText?: string
  excerpt?: string
  byline?: string
  images: string[]
  domain: string
  tags?: string[]
  saveType?: 'Quick' | 'Summary'
}

/** Renders a summary that may contain "- " bullet lines into Notion blocks. */
function summaryBlocks(summary: string): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = []
  const paragraphLines: string[] = []
  for (const line of summary.split('\n').map((l) => l.trim())) {
    if (/^[-•*]\s+/.test(line)) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: [{ text: { content: trim(line.replace(/^[-•*]\s+/, ''), 1900) } }] },
      })
    } else if (line) {
      paragraphLines.push(line)
    }
  }
  if (paragraphLines.length)
    blocks.unshift({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ text: { content: trim(paragraphLines.join(' '), 1900) } }] },
    })
  return blocks
}

const trim = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export interface RecentSave {
  pageId: string
  title: string
  url?: string
  notionUrl: string
  createdAt: string
  type?: string
}

/** Most recent saves in the configured database (newest first). */
export async function listRecent(): Promise<{ ok: boolean; message: string; items: RecentSave[] }> {
  const cfg = await getStoredCfg()
  if (!cfg) return { ok: false, message: 'Notion is not connected', items: [] }
  try {
    const schema = await mapSchema(cfg.token, cfg.databaseId)
    if (typeof schema === 'string') return { ok: false, message: schema, items: [] }
    const r = await notionFetch(cfg.token, `/databases/${cfg.databaseId}/query`, 'POST', {
      sorts: [{ timestamp: 'created_time', direction: 'descending' }],
      page_size: 50,
    })
    if (!r.ok) return { ok: false, message: `Notion error: ${(r.json as NotionError).message ?? r.status}`, items: [] }
    const results = (r.json['results'] as Array<Record<string, unknown>> | undefined) ?? []
    const items: RecentSave[] = []
    for (const p of results) {
      const props = (p['properties'] as Record<string, Record<string, unknown>> | undefined) ?? {}
      const titleArr = props[schema.titleProp]?.['title'] as Array<{ plain_text?: string }> | undefined
      const title = titleArr?.map((t) => t.plain_text ?? '').join('') || 'Untitled'
      const url = schema.urlProp ? ((props[schema.urlProp]?.['url'] as string | null | undefined) ?? undefined) : undefined
      const typeSel = schema.typeProp
        ? (props[schema.typeProp]?.['select'] as { name?: string } | null | undefined)
        : undefined
      items.push({
        pageId: String(p['id']),
        title,
        url,
        notionUrl: String(p['url'] ?? ''),
        createdAt: String(p['created_time'] ?? ''),
        type: typeSel?.name,
      })
    }
    return { ok: true, message: `${items.length} saved`, items }
  } catch {
    return { ok: false, message: 'Could not reach Notion', items: [] }
  }
}

/** Archives (soft-deletes) a saved page in Notion. */
export async function archivePage(pageId: string): Promise<boolean> {
  const cfg = await getStoredCfg()
  if (!cfg) return false
  try {
    const r = await notionFetch(cfg.token, `/pages/${pageId}`, 'PATCH', { archived: true })
    return r.ok
  } catch {
    return false
  }
}

/** Creates (or detects an existing) Notion page for this URL. */
export async function saveToNotion(input: SaveInput): Promise<{ ok: boolean; message: string; pageUrl?: string }> {
  const cfg = await getStoredCfg()
  if (!cfg) return { ok: false, message: 'Notion is not set up yet — open Notion settings on the new tab.' }
  try {
    const schema = await mapSchema(cfg.token, cfg.databaseId)
    if (typeof schema === 'string') return { ok: false, message: schema }

    // duplicate check by URL property when the database has one
    if (schema.urlProp) {
      const q = await notionFetch(cfg.token, `/databases/${cfg.databaseId}/query`, 'POST', {
        filter: { property: schema.urlProp, url: { equals: input.url } },
        page_size: 1,
      })
      const hits = (q.json['results'] as Array<Record<string, unknown>> | undefined) ?? []
      if (q.ok && hits.length) {
        const first = hits[0]
        return { ok: true, message: 'Already in Notion — opened existing page', pageUrl: first ? String(first['url'] ?? '') : undefined }
      }
    }

    const properties: Record<string, unknown> = {
      [schema.titleProp]: { title: [{ text: { content: trim(input.title || input.url, 200) } }] },
    }
    if (schema.urlProp) properties[schema.urlProp] = { url: input.url }
    if (schema.dateProp) properties[schema.dateProp] = { date: { start: new Date().toISOString() } }
    if (schema.domainProp) properties[schema.domainProp] = { select: { name: trim(input.domain, 100) } }
    if (schema.tagsProp && input.tags?.length)
      properties[schema.tagsProp] = {
        multi_select: input.tags.slice(0, 5).map((t) => ({ name: trim(t.replace(/,/g, ' '), 90) })),
      }
    if (schema.typeProp && input.saveType) properties[schema.typeProp] = { select: { name: input.saveType } }

    const children: Array<Record<string, unknown>> = []
    if (input.summary) children.push(...summaryBlocks(input.summary))
    for (const img of input.images.slice(0, 5))
      children.push({ object: 'block', type: 'image', image: { type: 'external', external: { url: img } } })
    if (input.excerpt && input.excerpt !== input.summary)
      children.push({
        object: 'block',
        type: 'quote',
        quote: { rich_text: [{ text: { content: trim(input.excerpt, 1900) } }] },
      })
    children.push({ object: 'block', type: 'bookmark', bookmark: { url: input.url } })

    const r = await notionFetch(cfg.token, '/pages', 'POST', {
      parent: { database_id: cfg.databaseId },
      properties,
      children,
    })
    if (!r.ok) {
      const err = r.json as NotionError
      // some sites' image URLs are rejected by Notion — retry once without images
      if (input.images.length && /image|external/i.test(err.message ?? '')) {
        return saveToNotion({ ...input, images: [] })
      }
      return { ok: false, message: `Notion refused the save: ${err.message ?? `HTTP ${r.status}`}` }
    }
    return { ok: true, message: 'Saved to Notion 📔', pageUrl: String(r.json['url'] ?? '') }
  } catch {
    return { ok: false, message: 'Could not reach Notion — check your connection.' }
  }
}
