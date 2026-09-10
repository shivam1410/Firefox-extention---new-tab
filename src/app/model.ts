/* Shared UI model: nodes, sources, capability matrix. Browser-API-free. */

export type SourceKey = 'library' | 'tabs' | 'bookmarks' | 'history' | 'notion'

export interface BaseNode {
  id: string
  title: string
  hot?: boolean
  locked?: boolean
  /* right-aligned metadata column (visit time, "open", …) */
  when?: string
  /* live-source handles */
  tabId?: number
  windowId?: number
  bmId?: string
  notionId?: string
  notionUrl?: string
  favicon?: string
}
export interface LinkNode extends BaseNode {
  type: 'link'
  url: string
  children?: undefined
}
export interface FolderNode extends BaseNode {
  type: 'folder'
  url?: undefined
  children: TreeNode[]
}
export type TreeNode = LinkNode | FolderNode

export interface Caps {
  createFolder?: boolean
  createItem?: boolean
  rename?: boolean
  move?: boolean
  del?: boolean
  acceptCopies?: boolean
}

let uidCounter = 0
export function nextId(): string {
  return `n${++uidCounter}`
}
export function F(title: string, children: TreeNode[], extra?: Partial<BaseNode>): FolderNode {
  return { id: nextId(), type: 'folder', title, children, ...extra }
}
export function L(title: string, url: string, extra?: Partial<BaseNode>): LinkNode {
  return { id: nextId(), type: 'link', title, url, ...extra }
}
