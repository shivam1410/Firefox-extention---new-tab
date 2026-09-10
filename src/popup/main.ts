import './popup.css'
import { saveTab } from '../app/saved-tabs'

declare const window: Window & { browser?: typeof browser }
const api = window.browser

function el<T extends HTMLElement>(sel: string): T {
  const n = document.querySelector<T>(sel)
  if (!n) throw new Error(`missing element: ${sel}`)
  return n
}

const status = el<HTMLDivElement>('#pStatus')
function setStatus(msg: string, kind: 'ok' | 'err' | 'busy' | '' = ''): void {
  status.textContent = msg
  status.className = `p-status ${kind}`
}

let current: WebExtTab | undefined

async function init(): Promise<void> {
  if (!api?.tabs) {
    setStatus('Open this from the Firefox toolbar.', 'err')
    return
  }
  const [tab] = await api.tabs.query({ active: true, currentWindow: true })
  current = tab
  el<HTMLSpanElement>('#pTitle').textContent = tab?.title || tab?.url || 'This page'
  const fav = el<HTMLImageElement>('#pFav')
  if (tab?.favIconUrl) {
    fav.src = tab.favIconUrl
    fav.hidden = false
  }
  const savable = /^https?:/i.test(tab?.url ?? '')
  el<HTMLButtonElement>('#pQuick').disabled = !savable
  el<HTMLButtonElement>('#pNotion').disabled = !savable
  if (!savable) setStatus('This page can\'t be saved (internal page).')
}

el<HTMLButtonElement>('#pQuick').addEventListener('click', () => {
  if (!current?.url || !api) return
  const t = current
  void (async () => {
    const box = await api.storage.local.get('notionCfg')
    if (box['notionCfg']) {
      setStatus('Saving to Notion…', 'busy')
      const r = (await api.runtime.sendMessage({ type: 'notion.saveQuick', title: t.title ?? '', url: t.url ?? '' })) as
        | { ok: boolean; message: string }
        | undefined
      setStatus(r?.message ?? 'No response — try again.', r?.ok ? 'ok' : 'err')
      return
    }
    const added = await saveTab({ title: t.title || t.url || '', url: t.url ?? '', favicon: t.favIconUrl })
    setStatus(added ? 'Saved 🔖 — it\'s on your new tab.' : 'Already in your saved tabs.', 'ok')
  })()
})

el<HTMLButtonElement>('#pNotion').addEventListener('click', () => {
  if (current?.id === undefined || !api?.runtime) return
  setStatus('Reading page & summarizing…', 'busy')
  el<HTMLButtonElement>('#pNotion').disabled = true
  void api.runtime
    .sendMessage({ type: 'notion.saveTab', tabId: current.id })
    .then((raw) => {
      const r = raw as { ok: boolean; message: string; pageUrl?: string } | undefined
      if (!r) {
        setStatus('No response — try again.', 'err')
        return
      }
      setStatus(r.message, r.ok ? 'ok' : 'err')
      if (r.ok && r.pageUrl) {
        const open = document.createElement('button')
        open.className = 'p-link'
        open.textContent = 'Open in Notion ↗'
        open.addEventListener('click', () => void api.tabs.create({ url: r.pageUrl ?? '' }))
        status.appendChild(document.createElement('br'))
        status.appendChild(open)
      }
    })
    .finally(() => {
      el<HTMLButtonElement>('#pNotion').disabled = false
    })
})

el<HTMLButtonElement>('#pOpenLib').addEventListener('click', () => {
  void api?.tabs.create({ url: api.runtime.getURL('app.html#/explorer') })
  window.close()
})
el<HTMLButtonElement>('#pSettings').addEventListener('click', () => {
  void api?.tabs.create({ url: api.runtime.getURL('app.html?notion=1#/home') })
  window.close()
})

void init()
