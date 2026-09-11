# Library Tab — Feature Setup Guide

Everything is optional; the extension works out of the box as a new-tab manager.
All setup lives on the new tab under the **Wallpaper** menu (bottom-right).

## The save model

Two gestures, both writing to your **Notion database** once connected:

| Gesture | What it does | Where it appears |
|---|---|---|
| **🔖 Save** (toolbar popup, hover 🔖 on tab rows, ＋ Save all) | Instant lightweight page: title, Link, domain Tag, date, `Type = Quick` | Center grid tiles (📔 badge) |
| **📔 Summarize & save** (toolbar popup) | Full capture: Readability extraction, summary (+ AI if configured), images, topic tags, `Type = Summary` | Right-side "Summarized" panel |

Other surfaces: left panel = live Bookmarks tree; right-bottom = Open tabs;
the Explorer (⊞ Open library) shows everything, including a Notion section.
Remove anything with hover **✕** (Notion saves are *archived* — recoverable from
Notion's trash for 30 days). Without Notion connected, saves fall back to a local list.
The Notion list is cached locally, so new tabs paint instantly and refresh in the background.

## Notion (recommended — the storage backend)

1. notion.so/my-integrations → **New integration** → copy the **Internal Integration Secret** (PAT).
2. In Notion, open the database that should receive saves → **⋯ → Connections →** add your integration.
3. Extension: **Wallpaper → 📔 Connect Notion** → paste PAT → **Connect** → pick the database → **Save**.

Recognized database properties (all adaptive — matched by *type*, mostly regardless of name):

| Property | Type | Filled with |
|---|---|---|
| (any title) | Title | Page title |
| e.g. `Link` | **URL** | The page URL (also powers duplicate detection) |
| e.g. `Tags` | **Multi-select** | Domain + topic tags (AI-generated when a key is set) |
| `Type` / `Kind` | **Select** | `Quick` or `Summary` (drives the home layout split) |
| e.g. `Date` | Date | Save timestamp |
| name matching *domain/site/source* | Select | The site's domain |

Pages saved before the `Type` property existed count as "Summarized"; set them to
`Quick` in Notion to move them to the grid.

## AI summaries (optional)

**Wallpaper → 📔 Connect Notion → AI key** field. Two key types, auto-detected:

- **Anthropic** (`sk-ant-…`, console.anthropic.com) — cheapest & most private for
  Claude; leave the model on **Auto** (Claude Haiku 4.5, ~0.5¢/summary; $5 ≈ 1000 articles).
- **OpenRouter** (`sk-or-…`, openrouter.ai) — one key, any model. The **Free** tier
  in the model dropdown lists live $0 models (rate-limited: ~20/min, ~50/day without
  credit; a one-time $10 top-up raises the daily cap). Recommended free: Llama 3.3 70B.

No key = local extractive summaries (private, free, decent). Any AI failure silently
falls back to local — saves never break. With a key, the extracted article text
(only that — never cookies/credentials) is sent to the chosen provider.

## Rich icons (optional)

**Wallpaper → ✨ Enable rich icons** — one-time permission; tiles then fetch each
site's real logo and name (cached locally). Without it, letter monograms.

## Cloud sync via Firebase (optional, mostly superseded by Notion)

Syncs the *local fallback* saved list across desktops via your own Firebase project.
Setup: console.firebase.google.com → create project → Authentication (Email/Password
and/or Google) → Firestore → rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

Then **Wallpaper → ☁ Cloud sync** → paste Web API key + project ID → sign in.
For **Sign in with Google**: enable the Google provider in Firebase Auth, copy its
Web client ID into the dialog, and add the dialog's displayed redirect URI to that
OAuth client in Google Cloud Console → Credentials.

## Backup & restore

**Wallpaper → Backup**: **⬇ Export** downloads a JSON of the grid, library, and local
saves; **⬆ Import** restores it (merging, deduped by URL). Notion data needs no backup —
it lives in Notion. The 📑 Saved Tabs bookmarks folder (legacy mirror) syncs via
Firefox Sync and is visible on mobile Firefox.

## Quirks worth knowing

- **Hot apps (🔥)**: right-click a grid/library link → *Mark as hot* — pre-warmed in a
  background tab at browser startup; clicking switches instantly. Startup warm-up only
  works on the permanently installed (signed) extension.
- **Mobile**: no extension APIs on Firefox iOS/Android for our features — the Notion
  app *is* the mobile experience for saves; the bookmarks folder covers the rest.
- **Keys & tokens** live in `storage.local`, sent only to their own vendors over HTTPS.
  Use dedicated, spend-capped keys; rotate on any suspicion.
- Keyboard: `/` focuses search; in the Explorer: click opens, ⌘-click selects,
  ⌘A select-all, ⌫ delete, Return renames.
