import { describe, expect, it } from 'vitest'
import { collectHotUrls, type HotLibraryNode } from './hot-apps'
import type { SavedItem } from './saves-model'

function save(pageId: string, over: Partial<SavedItem> = {}): SavedItem {
  return {
    pageId,
    title: pageId,
    url: `https://example.com/${pageId}`,
    notionUrl: `https://notion.so/${pageId}`,
    createdAt: 1,
    editedAt: 1,
    ...over,
  }
}
const link = (url: string, hot?: boolean): HotLibraryNode => ({ t: 'l', url, hot })
const folder = (kids: HotLibraryNode[]): HotLibraryNode => ({ t: 'f', kids })

describe('collectHotUrls', () => {
  it('returns nothing when there is no library and no saves', () => {
    expect(collectHotUrls(undefined, [])).toEqual([])
  })

  it('picks hot links out of the grid and the library root', () => {
    const lib = { grid: [link('https://a.example', true), link('https://b.example')], root: [link('https://c.example', true)] }
    expect(collectHotUrls(lib, [])).toEqual(['https://a.example', 'https://c.example'])
  })

  it('walks nested folders', () => {
    const lib = { root: [folder([folder([link('https://deep.example', true)])])] }
    expect(collectHotUrls(lib, [])).toEqual(['https://deep.example'])
  })

  it('includes hot Quick saves from Notion', () => {
    const saves = [save('a', { hot: true, saveType: 'Quick' })]
    expect(collectHotUrls(undefined, saves)).toEqual(['https://example.com/a'])
  })

  it('leaves Summary saves out — only Quick saves are pre-warmed', () => {
    const saves = [save('a', { hot: true, saveType: 'Summary' })]
    expect(collectHotUrls(undefined, saves)).toEqual([])
  })

  it('leaves saves that are not marked hot out', () => {
    expect(collectHotUrls(undefined, [save('a', { saveType: 'Quick' })])).toEqual([])
  })

  it('opens a url once when it is both a hot library node and a hot Quick save', () => {
    const lib = { grid: [link('https://same.example', true)] }
    const saves = [save('a', { hot: true, saveType: 'Quick', url: 'https://same.example' })]
    expect(collectHotUrls(lib, saves)).toEqual(['https://same.example'])
  })

  it('skips library links with no url', () => {
    const lib = { grid: [{ t: 'l' as const, hot: true }] }
    expect(collectHotUrls(lib, [])).toEqual([])
  })

  it('ignores a library object of the wrong shape rather than throwing', () => {
    expect(collectHotUrls({ grid: undefined, root: undefined }, [])).toEqual([])
  })
})
