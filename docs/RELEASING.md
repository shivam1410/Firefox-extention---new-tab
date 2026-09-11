# Releasing Library Tab

The full routine for shipping a new version. Everything here has been battle-tested
across v0.1.0 → v0.3.4.

## Golden rules

1. **Never change the extension ID** (`library-tab@shivam1410.dev` in
   `public/manifest.json`). The ID is the extension's identity: changing it makes
   Firefox/AMO treat it as a brand-new extension and orphans all user data.
   (This happened once, at the shivamhl.dev → shivam1410.dev migration — never again.)
2. **Bump the version for every AMO upload.** AMO permanently refuses a version
   number it has seen before, even for failed/disabled uploads.
3. Build output (`dist/`) and packages (`web-ext-artifacts/`) are git-ignored —
   never commit them; they're reproducible and attached to GitHub releases instead.

## Prerequisites

- Node 20 (`npm ci` for a clean install)
- An addons.mozilla.org account (same Firefox account as sync)
- `gh` CLI with the **shivam1410** account logged in
  (`gh auth switch --user shivam1410` — switch back to the work account afterwards)
- Git identity is repo-local: `shivam1410 <gargshivam482@gmail.com>` (do not commit
  with the global work identity)

## Release steps

### 1. Bump + package

```bash
# edit "version" in public/manifest.json (e.g. 0.3.4 → 0.3.5), then:
npm run package
```

This type-checks, builds `dist/`, and produces two files in `web-ext-artifacts/`:
- `library_tab-<version>.zip` — the extension package (AMO + GitHub release asset)
- `source.zip` — the source archive AMO requires (because Vite bundles/transpiles)

Optional sanity: `npm run lint:ext` should report **0 errors** (the ~14 innerHTML
warnings are known and non-blocking on the self-distributed channel).

### 2. Test locally (optional but wise)

`about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → `dist/manifest.json`.
Same ID = temporarily replaces the installed copy with the same data.
Temporary add-ons vanish when Firefox fully quits — that's expected.

### 3. Commit, tag, GitHub release

```bash
git add -A && git commit -m "feat: <what changed>"
git push origin main
git tag -a v<version> -m "v<version> — <one-liner>"
git push origin v<version>
gh auth switch --user shivam1410
gh release create v<version> "web-ext-artifacts/library_tab-<version>.zip#Extension package (unsigned build)" \
  --repo shivam1410/Firefox-extention---new-tab --title "v<version>" --notes "<changelog>"
gh auth switch --user ShivamHL
```

### 4. Upload to AMO

1. addons.mozilla.org → **Developer Hub → My Add-ons → Library Tab → Upload a New Version**
2. Upload `library_tab-<version>.zip` → validation runs (expect 0 errors)
3. Compatibility: **Firefox ✓, Firefox for Android ✗** (Android lacks the APIs we use)
4. "Do you need to submit source code?" → **Yes** → upload `source.zip`
5. Reviewer note (paste as-is):
   > Built with Vite + TypeScript (bundling only — minification disabled, dist output
   > is readable). Reproduce with Node 20: `npm ci && npm run build`; the package is
   > the dist/ folder via web-ext build. Full instructions in README.md. No remote
   > code, no external services, no data collection.
6. Submit. Self-distributed versions usually auto-sign in minutes; versions that add
   **new permissions** or ship source can sit in **human review for hours–days** —
   that's normal, you'll get an email.

### 5. Install the signed build

Manage Status & Versions → click the version → download the signed **`.xpi`** →
drag it onto any Firefox window → **Add**. It upgrades in place; all user data
(storage, Notion config, keys) survives. Never remove the old version first.

The installed signed file also lives at
`~/Library/Application Support/Firefox/Profiles/<profile>/extensions/library-tab@shivam1410.dev.xpi`
— byte-identical to AMO's download; handy for attaching to the GitHub release:

```bash
cp "$HOME/Library/Application Support/Firefox/Profiles/"*/extensions/library-tab@shivam1410.dev.xpi \
   web-ext-artifacts/library_tab-<version>-signed.xpi
gh auth switch --user shivam1410
gh release upload v<version> "web-ext-artifacts/library_tab-<version>-signed.xpi#Signed extension — drag into Firefox to install" \
  --repo shivam1410/Firefox-extention---new-tab
gh auth switch --user ShivamHL
```

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "Version X already exists" | That number was uploaded before — bump again. |
| "data_collection_permissions is missing" | Keep the `data_collection_permissions: { required: ["none"] }` block in the manifest (requires Firefox ≥140/142). |
| Stuck "Awaiting Review" | Normal after permission changes or source uploads; wait for the email. The installed version keeps working meanwhile. |
| Validator: "Unsafe assignment to innerHTML" | Known warning (all dynamic strings are escaped via `esc()`); refactor to DOM-building is planned before any public ("On this site") listing. |
| Extension gone after Firefox restart | It was a temporary add-on; install the signed `.xpi` instead. |

## Going public later

The current channel is **self-distributed (unlisted)** — not searchable on AMO.
To publish publicly: finish the innerHTML→DOM refactor, then submit a version to
the **"On this site"** channel with listing copy, screenshots, an icon upload
(Edit Product Page → Images — the section only exists for listed add-ons), and a
data-collection disclosure. Listed versions get human review and auto-update for users.
