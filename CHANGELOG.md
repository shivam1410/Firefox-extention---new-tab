# Changelog

All notable changes to Library Tab. Versions follow the extension's
`manifest.json`, and each released version is tagged and attached to a
[GitHub release](https://github.com/shivam1410/Firefox-extention---new-tab/releases).

## [0.4.2] — 2026-10-09

### Fixed

- **Saves made before 0.4.1 kept their letter monogram.** Only new saves captured
  an icon, so everything older stayed a coloured initial. Existing saves now
  borrow an icon on startup from what this device already knows — the rich-icon
  cache, or an open tab on the same site — and the result is stored with the
  save, so it survives refreshes rather than being worked out again on every
  page load.

### Known limitations

- A save whose site is not open anywhere, and that the rich-icon pipeline has
  not already fetched, still shows a monogram. Enabling **Wallpaper → ✨ Rich
  icons** fills those in.

## [0.4.1] — 2026-10-09

### Added

- **Type and press Enter.** The home search preselects the first result; ↑/↓ move
  through the list (wrapping, and the caret stays where it is), Enter opens the
  selected one, Escape closes. Hovering with the mouse moves the selection too.
- **Start page.** `chrome_settings_overrides.homepage` lets the new tab also be
  the page Firefox opens on startup. Firefox will ask you to allow the change,
  and it only applies when **Settings → General → Startup** is *not* set to
  "Open previous windows and tabs" — session restore wins over any extension.

### Fixed

- **Saved pages ranked last in search.** Results were gathered in source order,
  which put Notion saves behind open tabs, bookmarks and history — so the pages
  you deliberately kept were the ones cut by the 7-result limit. Saves now rank
  first, then your library, then browser data.
- **Saved tiles showed letter monograms instead of real icons.** Notion has no
  favicon field and the local row never captured one, leaving only the opt-in
  rich-icon pipeline to fill them in. The tab's own icon now travels with the
  save — from the popup, quick save, save-all and the migration — and stays on
  the local row across refreshes.

### Known limitations

- Saves made before 0.4.1 keep their monogram unless rich icons are enabled;
  only new saves capture an icon.

## [0.4.0] — 2026-10-01

**Notion becomes the source of truth for saves.** Every save is a page in your own
database; the extension keeps a local copy purely so the new tab paints instantly.
See [ADR 0001](docs/adr/0001-notion-is-the-system-of-record.md) for the decision
and the costs it accepts.

### Breaking

- **Saving now requires Notion.** The local fallback list is gone. Without a
  connected database, 🔖 says so rather than stashing the page somewhere you
  would later have to find.
- **Firebase cloud sync removed** — `src/app/cloud-sync.ts`, its setup dialog, and
  the **`identity` permission** it needed. Notion already syncs across devices;
  two sync engines over one dataset had no arbiter. Existing Firestore data can
  be deleted at your convenience — nothing needs migrating.
- **The "📑 Saved Tabs" bookmarks folder is gone.** That legacy mirror was how
  saves reached mobile Firefox; the Notion app replaces it.
- **Backup format changed.** Export now writes a `saves` key. Import reads both
  the new and the old (`savedTabs`) keys, and restores saved pages *into Notion*,
  because that is where saves live — so restoring needs Notion connected.

### Added

- **Rename a save**, writing the Notion page title. Previously impossible.
- **🔥 Hot apps for Quick saves** — pre-warmed in a background tab at browser
  startup, like library links. Uses a `checkbox` property when the database has
  one; otherwise remembered on that device only, and the UI says so.
- **Open in Notion** on every surface — tiles, home rows, explorer, and the
  context menu. Previously on one surface only.
- **Quick refresh** on the Summarized panel and in the explorer's Notion section,
  reporting what actually moved: *"In sync — 12 saves"* or *"Synced with Notion —
  3 new, 1 archived"*.
- **One-time migration banner** for saves still held in the retired local store,
  with a **Move to Notion** button. It verifies against Notion first, copies rows
  one at a time (deduplicated by URL, so re-running is safe), and clears the old
  keys only once every row has landed.
- **Unit tests** — the first in this repo: 117 covering the save model, the local
  mirror, Notion mapping and pagination, with an 80% coverage gate on
  `src/shared` (`npm test`, `npm run test:coverage`).

### Fixed

- **Saves past the 50th were invisible.** The Notion query fetched a single page
  of 50 rows with no pagination, so any save beyond that never appeared anywhere
  in the extension.
- **Local saves were hidden rather than migrated** the moment Notion was
  connected — they vanished from the UI while still occupying `storage.sync`
  quota.
- **Archiving was fire-and-forget.** If Notion refused, the row disappeared
  locally anyway and the two lists silently disagreed. Removals now roll back
  with the reason shown.
- **Concurrent saves could overwrite each other** in the local copy, so a tab you
  had just saved could disappear from every open new tab until the next refresh.
- **The popup's quick save wrote to a store nothing displayed** when Notion was
  unconfigured, while reporting *"Saved — it's on your new tab."*
- A backup taken on the new format restored zero saves while reporting success.

### Changed

- Removals **archive** the Notion page (`archived: true`) and are never deleted,
  so anything removed by mistake is recoverable from Notion's trash for 30 days.
  No code path can issue a Notion `DELETE` — the HTTP client's method type makes
  it a compile error.
- A failed Notion query **keeps the local copy as-is** instead of partially
  overwriting it, and says so.
- Changes made in one window appear in every other open new tab immediately,
  without a refresh.
- Fewer permissions (`identity` dropped) and a smaller app bundle: **84.2 kB →
  66.5 kB**.
- `docs/SETUP.md` rewritten for the new save model; `README.md` states the source
  of truth; `docs/RELEASING.md` notes that *removing* a permission does not
  trigger AMO's extended review.

### Known limitations

- **Not yet verified against a live Notion database.** Saving, rename, the hot
  checkbox, archive and the migration have been exercised only on their failure
  paths; no success path has run against a real database.
- Writes need a connection. Rename, archive and 🔥 revert with an explanation
  when Notion is unreachable — there is no offline queue, by design.
- Updating from 0.3.4 without connecting Notion leaves saving unavailable until
  you do. Nothing is deleted: the old store is cleared only after you click
  **Move to Notion** and every row has reached Notion.

## [0.3.4] — 2026-09-11

One-click archive/remove: hover ✕ on tiles and summarized rows, cache eviction,
home repaint after delete.

## [0.3.3] — 2026-09-11

Save types (Quick/Summary), type-based layout, Notion cache for instant paint.

## [0.3.2] — 2026-09-11

Saved panel polish; Save-all moved to Open tabs; backup moved to the Wallpaper menu.

## [0.3.1] — 2026-09-10

Notion-unified saves, tag and link properties, AI tags, model tiers.

## [0.3.0] — 2026-09-10

Notion save & summarize, AI models (Anthropic/OpenRouter), cloud sync, toolbar popup.
