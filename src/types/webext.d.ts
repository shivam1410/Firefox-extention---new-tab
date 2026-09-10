// Minimal typings for the WebExtension APIs this project uses so far.
// Grows with each phase; kept hand-rolled to stay dependency-free.

interface WebExtEvent {
  addListener(cb: () => void): void
  removeListener(cb: () => void): void
}

interface WebExtTab {
  id?: number
  windowId?: number
  title?: string
  url?: string
  favIconUrl?: string
  active?: boolean
}

interface WebExtBookmarkNode {
  id: string
  parentId?: string
  title: string
  url?: string
  type?: 'bookmark' | 'folder' | 'separator'
  children?: WebExtBookmarkNode[]
}

interface WebExtHistoryItem {
  id: string
  url?: string
  title?: string
  lastVisitTime?: number
  visitCount?: number
}

interface WebExtStorageArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
  remove(keys: string | string[]): Promise<void>
}

declare const browser: {
  action: {
    onClicked: {
      addListener(cb: (tab: WebExtTab) => void): void
      removeListener(cb: (tab: WebExtTab) => void): void
    }
    setBadgeText(details: { text: string }): Promise<void>
    setBadgeBackgroundColor(details: { color: string }): Promise<void>
  }
  runtime: {
    getURL(path: string): string
    sendMessage(msg: unknown): Promise<unknown>
    onMessage: {
      addListener(cb: (msg: unknown) => Promise<unknown> | undefined): void
    }
    onStartup: WebExtEvent
    onInstalled: WebExtEvent
  }
  identity: {
    getRedirectURL(): string
    launchWebAuthFlow(details: { url: string; interactive?: boolean }): Promise<string>
  }
  permissions: {
    request(p: { origins: string[] }): Promise<boolean>
    contains(p: { origins: string[] }): Promise<boolean>
  }
  scripting: {
    executeScript<T>(injection: { target: { tabId: number }; func: () => T }): Promise<Array<{ result?: T }>>
  }
  tabs: {
    query(q: { currentWindow?: boolean; active?: boolean }): Promise<WebExtTab[]>
    create(props: { url: string; active?: boolean }): Promise<unknown>
    update(tabId: number, props: { active: boolean }): Promise<unknown>
    remove(tabIds: number | number[]): Promise<void>
    getCurrent(): Promise<WebExtTab | undefined>
    onCreated: WebExtEvent
    onRemoved: WebExtEvent
    onUpdated: WebExtEvent
    onMoved: WebExtEvent
    onActivated: WebExtEvent
    onAttached: WebExtEvent
  }
  windows: {
    update(windowId: number, props: { focused: boolean }): Promise<unknown>
    onCreated: WebExtEvent
    onRemoved: WebExtEvent
  }
  bookmarks: {
    getTree(): Promise<WebExtBookmarkNode[]>
    search(q: { url?: string; title?: string }): Promise<WebExtBookmarkNode[]>
    create(props: { parentId?: string; title: string; url?: string }): Promise<WebExtBookmarkNode>
    update(id: string, props: { title?: string; url?: string }): Promise<unknown>
    move(id: string, props: { parentId?: string; index?: number }): Promise<unknown>
    remove(id: string): Promise<void>
    removeTree(id: string): Promise<void>
    onCreated: WebExtEvent
    onChanged: WebExtEvent
    onMoved: WebExtEvent
    onRemoved: WebExtEvent
  }
  storage: {
    local: WebExtStorageArea
    sync: WebExtStorageArea
    onChanged: WebExtEvent
  }
  history: {
    search(q: { text: string; startTime?: number; endTime?: number; maxResults?: number }): Promise<WebExtHistoryItem[]>
    deleteUrl(props: { url: string }): Promise<void>
    onVisited: WebExtEvent
    onVisitRemoved: WebExtEvent
  }
}
