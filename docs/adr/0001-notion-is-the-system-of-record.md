# ADR 0001 — Notion is the system of record for saves

- **Status:** Accepted
- **Date:** 2026-09-14
- **Supersedes:** the `storage.sync` saved-tabs store, the "📑 Saved Tabs" bookmarks
  mirror, and the Firebase/Firestore cloud sync in `src/app/cloud-sync.ts`

## Context

Saves lived in two unrelated systems that could disagree about the same page:

- `savedTabs` in `storage.sync`, mirrored best-effort into a bookmarks folder,
  optionally synced through the user's own Firebase project.
- Notion pages, written by the background page and cached wholesale under a
  `notionCache` key.

When Notion was connected the local list was hidden rather than migrated, so
previously-saved tabs silently vanished from the UI while still consuming
`storage.sync` quota. Two sync engines also meant two conflict models, neither of
which the other knew about.

## Decision

**The Notion database is the single system of record for saves.** Local storage
holds a mirror — a cache — and never a second truth.

1. Identity is the Notion `pageId`. Not the URL: the same URL can legitimately be
   saved twice, and a URL can be edited.
2. The mirror lives in `storage.local` under `saves` and is shared by the app
   page, the popup and the background event page.
3. Writes are **optimistic with rollback**. The UI applies the change against a
   whole-mirror snapshot, then calls Notion; if Notion refuses, the snapshot is
   restored verbatim and the error is surfaced. There is no pending-op queue and
   no offline write support.
4. Because of (3), **reconcile is remote-wins**. A mirror row can never hold an
   edit Notion has not already accepted, so a fresh listing simply replaces the
   mirror. Rows absent from the listing were archived and are dropped.
5. The only exceptions to (4) are fields Notion does not store: `favicon` always,
   and `hot` when the database has no checkbox property. Those carry over by
   `pageId` and are understood to be device-local.
6. **Removal is archival.** Every delete path issues
   `PATCH /pages/{id} { archived: true }`. No code path may issue a Notion
   `DELETE`, so any mistaken removal stays recoverable from Notion's own trash.
7. Notion HTTP stays confined to `src/background/`; the PAT never reaches an app
   page.

## Alternatives considered

**Last-writer-wins per field, using `last_edited_time`.** Rejected. It only pays
off alongside a pending-op queue, which decision (3) rules out, and it would
silently resurrect rows the user had archived in the Notion UI.

**Keep the local store as a parallel offline-first source.** Rejected. That is
the status quo that produced the disagreement, and it forces a conflict model
onto every read path.

**Keep Firebase for cross-device sync.** Rejected as redundant — Notion already
syncs across devices, and running two sync engines over one dataset means they
can disagree with no arbiter.

## Consequences

**Good**
- One truth, one conflict model, and a reconcile function small enough to unit
  test exhaustively.
- An entire sync subsystem (331 lines plus its dialog and auth flow) is deleted,
  along with the `identity` permission it was the only consumer of — a smaller
  review surface for AMO.
- Saves become visible and editable outside the browser, in Notion itself.

**Bad, and accepted**
- **Saving requires Notion.** Without a connected database there is no save
  feature. This is a deliberate narrowing.
- **Writes require the network.** A rename or archive made offline fails and
  reverts rather than queueing.
- `favicon` and (on databases without a checkbox property) `hot` do not travel
  between devices.
- Notion's rate limit (~3 requests/second) bounds bulk operations; the one-time
  migration of legacy saves is paced sequentially because of it.

## Compliance

- Invariant **I1** — no `DELETE` in `src/background/notion.ts` — is checked by
  `grep -rn "'DELETE'" src/background/` during build.
- Invariants **I3** and **I5** — purity and immutability of `saves-model.ts` —
  are pinned by `src/shared/saves-model.test.ts`.
