# Library Tab — Feature Setup Guide

The extension works out of the box as a new-tab manager for tabs, bookmarks and
history. **Saving pages is the one feature that needs setup** — it writes to your
own Notion database. Everything after that is optional.

All setup lives on the new tab under the **Wallpaper** menu (bottom-right).

## The save model

**Notion is the source of truth.** Every save is a page in your own database;
the extension keeps a local copy purely so the new tab paints instantly. Nothing
is saved anywhere else, so a save is never trapped in one browser profile.

Two gestures, both writing to your **Notion database**:

| Gesture | What it does | Where it appears |
|---|---|---|
| **🔖 Save** (toolbar popup, hover 🔖 on tab rows, ＋ Save all) | Instant lightweight page: title, Link, domain Tag, date, `Type = Quick` | Center grid tiles (📔 badge) |
| **📔 Summarize & save** (toolbar popup) | Full capture: Readability extraction, summary (+ AI if configured), images, topic tags, `Type = Summary` | Right-side "Summarized" panel |

Other surfaces: left panel = live Bookmarks tree; right-bottom = Open tabs;
the Explorer (⊞ Open library) shows everything, including a Notion section.

**Saving needs Notion connected.** Until it is, 🔖 tells you so rather than
stashing pages somewhere you would later have to find.

### Local copy and refresh

The local copy is a cache, never a second source of truth:

- The new tab paints from it **before** any network request finishes.
- **↻ Refresh** (Summarized panel, and in the Explorer's Notion section)
  re-reads Notion and reconciles: pages you added in Notion appear, pages you
  archived there disappear. It reports what moved — *"In sync — 12 saves"* or
  *"Synced with Notion — 3 new, 1 archived"*.
- Anything you change in one window shows up in every other open new tab
  immediately, with no refresh.
- If Notion cannot be reached, the local copy is **kept as-is** and you are told.
  It is never partially overwritten.

### Rename, remove, and 🔥 hot

- **Rename** — hover ✎ or right-click → *Rename*. Writes the Notion page title.
- **Remove** — hover ✕ or right-click → *Archive in Notion*. Saves are **archived,
  never deleted**, so anything removed by mistake is recoverable from Notion's
  trash for 30 days.
- **🔥 Hot** — right-click a **Quick** save → *Mark as hot app*. Hot pages are
  pre-warmed in a background tab at browser startup so they open instantly.
  Summary saves are long reads, so they are deliberately not offered this.

All three apply immediately and are sent to Notion in the background. **If Notion
refuses, the change is undone** and the reason is shown — the list always matches
what Notion actually holds. This also means these actions need a connection;
there is no offline queue.

### Moving saves made before this version

Earlier versions kept saves in a local browser list. If any are still there, the
Summarized panel shows a banner.

- **Notion connected** — *"N saved tabs from the old local list are not in Notion
  yet"*, with a **Move to Notion** button.
- **Not connected yet** — *"N saved tabs waiting — connect Notion to move them
  in"*, with no button, so you know they are safe and where they went.

Moving checks Notion first, then copies them in one at a time (deduplicated by
URL, so re-running is safe) and clears the old list only once **every** one has
landed. If some fail, the rest stay exactly where they are and the banner offers
a retry. If Notion cannot be reached, nothing is moved and nothing is cleared.

## Notion (required for saving)

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
| name matching *hot/warm/pin* | **Checkbox** | The 🔥 hot-app flag |

Pages saved before the `Type` property existed count as "Summarized"; set them to
`Quick` in Notion to move them to the grid.

**About the checkbox**: if your database has no checkbox property, 🔥 still works
but is remembered on that computer only — the extension says so when you set it.
Add any checkbox property to have it travel with the page instead.

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

## Backup & restore

**Wallpaper → Backup**: **⬇ Export** downloads a JSON of your grid, library and
saves. **⬆ Import** restores it — the grid and library go back locally, and saved
pages are **pushed into Notion** (deduplicated by URL), because that is where
saves live. Importing therefore needs Notion connected; if it is not, the library
still restores and you are told the saves were skipped.

Your saves need no backup of their own — they are already in Notion.

> **Replacing Firebase cloud sync.** Earlier versions could sync the local saved
> list through your own Firebase project. Notion now does that job across every
> device, so Firebase sync has been removed along with the `identity` permission
> it required. Nothing needs migrating — your saves are in Notion — and any old
> Firestore data can be deleted at your convenience.

## Quirks worth knowing

- **Hot apps (🔥)**: right-click a grid/library link, or a **Quick** Notion save →
  *Mark as hot* — pre-warmed in a background tab at browser startup; clicking
  switches instantly. Startup warm-up only works on the permanently installed
  (signed) extension.
- **Writes need a connection**: rename, archive and 🔥 all talk to Notion. Offline,
  they revert with an explanation rather than queueing up.
- **Mobile**: no extension APIs on Firefox iOS/Android for our features — the Notion
  app *is* the mobile experience for saves, and because Notion holds everything,
  your saves are there already.
- **Keys & tokens** live in `storage.local`, sent only to their own vendors over HTTPS.
  Use dedicated, spend-capped keys; rotate on any suspicion.
- Keyboard: `/` focuses search; in the Explorer: click opens, ⌘-click selects,
  ⌘A select-all, ⌫ delete, Return renames.
