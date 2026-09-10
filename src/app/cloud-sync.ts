/* Optional cloud sync for saved tabs via the user's OWN Firebase project.
   Dependency-free: Firebase Auth (Identity Toolkit) and Firestore are used
   over their public REST APIs, so nothing heavy is bundled and the shipped
   code stays reviewer-readable.

   Security model:
   - The API key + project ID identify the user's Firebase project; they are
     not secrets (Firebase's design) — isolation comes from Firestore rules:
       match /users/{uid}/{doc=**} { allow read, write:
         if request.auth != null && request.auth.uid == uid; }
   - The account password is sent only to Google's auth endpoint over HTTPS
     and never stored; we keep the refresh token in storage.local.

   Sync model (v1): one Firestore document holds the whole saved-tabs list.
   A local "synced snapshot" makes the loop safe: push only when local state
   differs from the snapshot; adopt remote only when local state equals the
   snapshot (i.e. no unsynced local edits). On true conflicts, local wins. */

import { loadSavedTabs, replaceSavedTabs, type SavedTab } from './saved-tabs'

declare const window: Window & { browser?: typeof browser }
const api = typeof window !== 'undefined' ? window.browser : undefined

export interface CloudConfig {
  apiKey: string
  projectId: string
  googleClientId?: string
}
interface CloudAuth {
  uid: string
  email: string
  refreshToken: string
}
interface Snapshot {
  json: string
  at: number
}

/* ---------- small storage helpers (storage.local, localStorage fallback) ---------- */

async function getStored<T>(key: string): Promise<T | null> {
  if (api?.storage?.local) {
    const box = await api.storage.local.get(key)
    return (box[key] as T | undefined) ?? null
  }
  try {
    const raw = localStorage.getItem(`lt-${key}`)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}
async function setStored(key: string, value: unknown): Promise<void> {
  if (api?.storage?.local) {
    await api.storage.local.set({ [key]: value })
    return
  }
  try {
    localStorage.setItem(`lt-${key}`, JSON.stringify(value))
  } catch {
    /* preview mode without storage: sync state just won't persist */
  }
}
async function removeStored(key: string): Promise<void> {
  if (api?.storage?.local) {
    await api.storage.local.remove(key)
    return
  }
  try {
    localStorage.removeItem(`lt-${key}`)
  } catch {
    /* ignore */
  }
}

/* ---------- config & auth state ---------- */

export function getCloudConfig(): Promise<CloudConfig | null> {
  return getStored<CloudConfig>('cloudCfg')
}
export async function setCloudConfig(cfg: CloudConfig): Promise<void> {
  await setStored('cloudCfg', cfg)
}
export function getCloudAuth(): Promise<CloudAuth | null> {
  return getStored<CloudAuth>('cloudAuth')
}
export async function cloudSignOut(): Promise<void> {
  await removeStored('cloudAuth')
  await removeStored('cloudSnap')
  cachedToken = null
}

interface AuthErrorBody {
  error?: { message?: string }
}
function friendlyAuthError(code: string): string {
  const map: Record<string, string> = {
    EMAIL_EXISTS: 'That email already has an account — use Sign in.',
    EMAIL_NOT_FOUND: 'No account for that email — use Create account.',
    INVALID_PASSWORD: 'Wrong password.',
    INVALID_LOGIN_CREDENTIALS: 'Wrong email or password.',
    WEAK_PASSWORD: 'Password too weak (Firebase requires 6+ characters).',
    INVALID_EMAIL: 'That email address looks invalid.',
    OPERATION_NOT_ALLOWED: 'Enable Email/Password sign-in in Firebase → Authentication.',
    API_KEY_INVALID: 'The Firebase API key looks wrong.',
  }
  for (const k of Object.keys(map)) if (code.includes(k)) return map[k] ?? code
  return `Firebase said: ${code}`
}

/** Sign in (or create an account). Returns an error message, or null on success. */
export async function cloudSignIn(email: string, password: string, create: boolean): Promise<string | null> {
  const cfg = await getCloudConfig()
  if (!cfg) return 'Add your Firebase API key and project ID first.'
  const endpoint = create ? 'signUp' : 'signInWithPassword'
  try {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${endpoint}?key=${encodeURIComponent(cfg.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    })
    const body = (await res.json()) as AuthErrorBody & { localId?: string; refreshToken?: string; email?: string }
    if (!res.ok || !body.localId || !body.refreshToken)
      return friendlyAuthError(body.error?.message ?? `HTTP ${res.status}`)
    await setStored('cloudAuth', { uid: body.localId, email: body.email ?? email, refreshToken: body.refreshToken })
    cachedToken = null
    return null
  } catch {
    return 'Could not reach Firebase — check your connection.'
  }
}

/** The redirect URL Google must allow for this install (shown in the setup UI). */
export function googleRedirectUrl(): string | null {
  return api?.identity?.getRedirectURL ? api.identity.getRedirectURL() : null
}

/** Google sign-in via Firefox's identity API → Firebase. Returns an error message, or null on success. */
export async function cloudSignInGoogle(): Promise<string | null> {
  const cfg = await getCloudConfig()
  if (!cfg) return 'Add your Firebase API key and project ID first.'
  if (!cfg.googleClientId) return 'Add the Google Web client ID first (Firebase → Authentication → Google provider).'
  if (!api?.identity?.launchWebAuthFlow) return 'Google sign-in only works in the installed extension, not the dev preview.'
  const redirect = api.identity.getRedirectURL()
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36)
  const authUrl =
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    new URLSearchParams({
      client_id: cfg.googleClientId,
      response_type: 'id_token',
      redirect_uri: redirect,
      scope: 'openid email',
      nonce,
      prompt: 'select_account',
    }).toString()
  let resultUrl: string
  try {
    resultUrl = await api.identity.launchWebAuthFlow({ url: authUrl, interactive: true })
  } catch {
    return 'Google sign-in was cancelled or blocked.'
  }
  const fragment = new URLSearchParams(resultUrl.split('#')[1] ?? '')
  const googleIdToken = fragment.get('id_token')
  if (!googleIdToken) return 'Google returned no token — check the client ID and the authorised redirect URI.'
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${encodeURIComponent(cfg.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postBody: `id_token=${googleIdToken}&providerId=google.com`,
          requestUri: redirect,
          returnSecureToken: true,
        }),
      },
    )
    const body = (await res.json()) as AuthErrorBody & { localId?: string; refreshToken?: string; email?: string }
    if (!res.ok || !body.localId || !body.refreshToken)
      return friendlyAuthError(body.error?.message ?? `HTTP ${res.status}`)
    await setStored('cloudAuth', { uid: body.localId, email: body.email ?? 'Google account', refreshToken: body.refreshToken })
    cachedToken = null
    return null
  } catch {
    return 'Could not reach Firebase — check your connection.'
  }
}

/* ---------- id token (cached, refreshed via the refresh token) ---------- */

let cachedToken: { token: string; expiresAt: number } | null = null

async function idToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token
  const [cfg, auth] = await Promise.all([getCloudConfig(), getCloudAuth()])
  if (!cfg || !auth) return null
  try {
    const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(cfg.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(auth.refreshToken)}`,
    })
    const body = (await res.json()) as { id_token?: string; expires_in?: string; refresh_token?: string }
    if (!res.ok || !body.id_token) return null
    if (body.refresh_token && body.refresh_token !== auth.refreshToken)
      await setStored('cloudAuth', { ...auth, refreshToken: body.refresh_token })
    cachedToken = { token: body.id_token, expiresAt: Date.now() + (parseInt(body.expires_in ?? '3600', 10) - 120) * 1000 }
    return cachedToken.token
  } catch {
    return null
  }
}

/* ---------- Firestore document (whole saved-tabs list as one doc) ---------- */

function docUrl(cfg: CloudConfig, uid: string): string {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/databases/(default)/documents/users/${encodeURIComponent(uid)}/sync/savedTabs`
}

interface RemoteDoc {
  json: string
  at: number
}

async function fetchRemote(cfg: CloudConfig, uid: string, token: string): Promise<RemoteDoc | null | 'error'> {
  try {
    const res = await fetch(docUrl(cfg, uid), { headers: { Authorization: `Bearer ${token}` } })
    if (res.status === 404) return null
    if (!res.ok) return 'error'
    const body = (await res.json()) as { fields?: { data?: { stringValue?: string }; updatedAt?: { integerValue?: string } } }
    const json = body.fields?.data?.stringValue
    if (typeof json !== 'string') return null
    return { json, at: parseInt(body.fields?.updatedAt?.integerValue ?? '0', 10) }
  } catch {
    return 'error'
  }
}

async function pushRemote(cfg: CloudConfig, uid: string, token: string, json: string, at: number): Promise<boolean> {
  try {
    const res = await fetch(`${docUrl(cfg, uid)}?updateMask.fieldPaths=data&updateMask.fieldPaths=updatedAt`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { data: { stringValue: json }, updatedAt: { integerValue: String(at) } } }),
    })
    return res.ok
  } catch {
    return false
  }
}

/* ---------- sync ---------- */

function stableJson(items: SavedTab[]): string {
  return JSON.stringify(
    items.map((s) => ({ title: s.title, url: s.url, savedAt: s.savedAt })).sort((a, b) => a.url.localeCompare(b.url)),
  )
}

export interface SyncResult {
  ok: boolean
  message: string
  changedLocal: boolean
}

let busy = false

export async function syncNow(): Promise<SyncResult> {
  if (busy) return { ok: true, message: 'Sync already running', changedLocal: false }
  busy = true
  try {
    const [cfg, auth] = await Promise.all([getCloudConfig(), getCloudAuth()])
    if (!cfg || !auth) return { ok: false, message: 'Cloud sync is not set up', changedLocal: false }
    const token = await idToken()
    if (!token) return { ok: false, message: 'Sign-in expired — sign in again', changedLocal: false }

    const localItems = await loadSavedTabs()
    const localJson = stableJson(localItems)
    const snap = (await getStored<Snapshot>('cloudSnap')) ?? { json: '', at: 0 }
    const remote = await fetchRemote(cfg, auth.uid, token)
    if (remote === 'error') return { ok: false, message: 'Firestore refused — check project ID & security rules', changedLocal: false }

    if (remote && remote.json === localJson) {
      await setStored('cloudSnap', { json: localJson, at: remote.at })
      return { ok: true, message: 'In sync', changedLocal: false }
    }
    if (remote && localJson === snap.json) {
      // no local edits since last sync → adopt remote
      try {
        const items = JSON.parse(remote.json) as Array<Partial<SavedTab>>
        const revived: SavedTab[] = items
          .filter((s): s is { title: string; url: string; savedAt: number } => typeof s.url === 'string')
          .map((s, i) => ({
            id: `c${remote.at.toString(36)}${i.toString(36)}`,
            title: s.title || s.url,
            url: s.url,
            savedAt: typeof s.savedAt === 'number' ? s.savedAt : Date.now(),
          }))
        await replaceSavedTabs(revived)
        await setStored('cloudSnap', { json: remote.json, at: remote.at })
        return { ok: true, message: `Downloaded ${revived.length} saved tab${revived.length === 1 ? '' : 's'} from cloud`, changedLocal: true }
      } catch {
        return { ok: false, message: 'Cloud data looked corrupt — kept local copy', changedLocal: false }
      }
    }
    // no remote yet, or local has unsynced edits (conflict → local wins)
    const at = Date.now()
    const pushed = await pushRemote(cfg, auth.uid, token, localJson, at)
    if (!pushed) return { ok: false, message: 'Upload failed — check Firestore rules', changedLocal: false }
    await setStored('cloudSnap', { json: localJson, at })
    return { ok: true, message: `Uploaded ${localItems.length} saved tab${localItems.length === 1 ? '' : 's'} to cloud`, changedLocal: false }
  } finally {
    busy = false
  }
}

/** Debounced push after local changes; cheap no-op when nothing changed. */
let pushTimer: number | undefined
export function scheduleCloudPush(onChangedLocal: () => void): void {
  window.clearTimeout(pushTimer)
  pushTimer = window.setTimeout(() => {
    void (async () => {
      const auth = await getCloudAuth()
      if (!auth || busy) return
      const [items, snap] = await Promise.all([loadSavedTabs(), getStored<Snapshot>('cloudSnap')])
      if (stableJson(items) === (snap?.json ?? '')) return // nothing new (incl. our own writes)
      const r = await syncNow()
      if (r.changedLocal) onChangedLocal()
    })()
  }, 2500)
}
