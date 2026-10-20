# design-sync notes — MGL `mgl_design`

This repo is an **application**, not a published component library. The design system is
`frontend/src/ui/` (30 shadcn/Radix + bespoke components), synced via **synth-entry**.

## Run (first sync / re-sync)

```sh
# 1. Rebuild the frontend so the compiled Tailwind CSS exists, then UPDATE cfg.cssEntry
#    to the new hash (it changes every build — see risks).
( cd frontend && npm run build )       # produces dist/assets/index-<hash>.css
# 2. (re-create the staged scripts if stale) cp -r <skill>/... .ds-sync/ ; (cd .ds-sync && npm i esbuild ts-morph @types/react playwright)
# 3. Build + validate + capture
node .ds-sync/package-build.mjs --config .design-sync/config.json \
  --node-modules ./frontend/node_modules --entry ./frontend/.ds-sync-entry.tsx --out ./ds-bundle
node .ds-sync/package-validate.mjs ./ds-bundle
node .ds-sync/package-capture.mjs --out ./ds-bundle
```

- **`--entry ./frontend/.ds-sync-entry.tsx`** is a generated re-export of all 30 `src/ui` files (gitignored).
  PKG_DIR walk-up needs it inside `frontend/`. If missing, regenerate: one `export * from './src/ui/<file>';`
  per component file. Regenerate whenever the `src/ui` set changes.
- Project: `mgl_design` (`95d99aba-c5ad-4db6-989d-a031de9bc412`).

## Gotchas (learned this run)

- **cssEntry = the app's compiled Tailwind** (`frontend/dist/assets/index-<hash>.css`). Tailwind v4
  emits only used utilities, so the whole-app CSS is what styles the components. There is NO standalone
  component stylesheet.
- **Barrel imports**: `.design-sync/tsconfig.dssync.json` pins every bare-directory `@/<barrel>` import
  (e.g. `@/shared/i18n`) to its `/index`. The bundled `tsconfigPathsPlugin` returns the DIRECTORY for a
  bare barrel (empty-extension `existsSync` hit) → Windows "Incorrect function". If a NEW barrel import
  enters the dependency graph, add a `"@/<dir>": ["./src/<dir>/index"]` line BEFORE `@/*`.
- **Provider**: `LanguageProvider` (merged via `extraEntries` from `src/shared/i18n`) wraps every card.
  `Sidebar`, `Dialog`, `PolishableTextarea` call `useLanguage()`, which THROWS without it.
- **Fonts**: Inter / Cormorant Garamond / Manrope / Space Grotesk are Google-Fonts-CDN (runtime). Shipped
  via `.design-sync/fonts/brand-fonts.css` — a fetched snapshot of the Google `css2` response (remote
  `@font-face`, incl. **cyrillic** subsets). `extractFonts` keeps remote `url()`s as-is, so they load at
  runtime in previews AND designs. Re-fetch if Google rotates font versions.
- **Theme**: components are DARK by default (`:root` carries the dark token set; `.light` is the
  client-only scope). Previews wrap content in a dark `Frame` using `hsl(var(--background))` — do NOT use
  Tailwind classes the app doesn't already use (they won't be in the compiled CSS); inline styles + the
  component's own classes only.
- **cardMode**: overlays (Dialog, AlertDialog, Sheet, Popover, DropdownMenu, Select, Tooltip) + Sidebar →
  `single` + a viewport; Table, ResponsiveTable, Tabs → `column`. Overlays/menus are authored in their
  **open** state (`open` / `defaultOpen`). Add cardMode/viewport overrides BEFORE the build that captures —
  adding them AFTER a build trips `[CONFIG_STALE]` (per-component stamp); the fix is a full
  `package-build.mjs` re-stamp (NOT hand-patching `.stories-map.json`).
- **ChartContainer**: recharts `ResponsiveContainer` renders blank headless — the preview gives the chart
  explicit `width`/`height` and a hardcoded bar fill. Imports recharts primitives directly from `recharts`.
- **Sidebar**: the real component is `hidden lg:flex` + `useIsMobile()` → renders blank/closed below
  1024px (the capture viewport). Its preview is authored as a hand-built div layout (NOT the component
  shell) so it renders — see the re-sync risk below.

## Known render warns

None — render check is 30/30 clean.

## Re-sync risks (watch list)

- **cssEntry hash drift** — `cfg.cssEntry` pins a hashed filename; it changes on every `frontend` build.
  Re-run the frontend build and update the hash before re-syncing, or the build prints `[CSS_IMPORT_MISSING]`.
- **Sidebar preview is a hand-built layout**, not the real `Sidebar` shell — it will NOT reflect changes to
  the real Sidebar API/markup. Revisit if Sidebar is restyled.
- **ChartContainer preview hardcodes width/height + bar fill** — won't track chart restyling.
- **brand-fonts.css is a fetched snapshot** — Google font version bumps won't propagate until re-fetched.
- **`frontend/.ds-sync-entry.tsx` (gitignored)** must be regenerated if the `src/ui` component set changes;
  `componentSrcMap` in config.json also enumerates the 30 — keep both in sync.
