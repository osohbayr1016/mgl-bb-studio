# Server-side QTO (Тоо хэмжээ) — Design Spec & Deferred Implementation Plan

> Status: **approved design, implementation deferred** until the `ifc-convert` container
> (`server.mjs`) lands and `backend/src/routes/qto.ts` stabilises. Authored 2026-06-25.

## Context

The Тоо хэмжээ (quantity take-off) tool computes quantities **in the browser** via
`frontend/src/features/projects/lib/qto.worker.ts` (web-ifc, a 32-bit WASM build with a
~4 GB address-space ceiling). Large IFC models OOM-crash the tab: the real
`250918_MAX_URGUU_BA_B__detached.ifc` model (project 31) is **518.9 MB** and cannot be
parsed in-browser even after raising `MAX_QTO_BYTES` to 1 GiB — the WASM heap is exhausted.

Web research confirmed the industry-standard fix: process large IFC **server-side** with
native IfcOpenShell (no 4 GB limit) and return only results to the browser (Speckle,
Autodesk APS, BIMData all do this). This project **already has** a server-side Cloudflare
Container at `ifc-convert/` (native `IfcConvert` + `ifcopenshell` python, `standard-4` =
12 GiB RAM) being built for the 3D viewer — the perfect home for server-side QTO.

**Goal:** compute QTO server-side for large models using ifcopenshell, producing the exact
same `QtoSummary` JSON the existing storage (`qto_runs`), UI (`ProjectQtoTab.tsx`) and MCP
(`get_project_quantities`) already consume — so nothing downstream changes.

### ⚠️ Dependency / timing (critical)

This feature sits on top of another agent's **in-progress, incomplete WIP**:
- `ifc-convert/server.mjs` (the container's HTTP server — where QTO compute would run) is
  referenced by the `Dockerfile` and `README.md` but **does not exist** in the working tree.
  The container cannot build/deploy yet.
- `backend/src/routes/qto.ts` is being **actively edited** (it grew from 237 lines to a
  much larger file with `/conversion-callback`, `/conversion-result`, `project_models`
  versioning and `startIfcConversion` wiring).
- `ifc-convert/`, `ModelViewer.tsx`, `lib/ifcConvert.ts`, migrations 0111/0112 are all that
  agent's work.

Per CLAUDE.md (concurrent agents), we do **not** finish or collide with that work.
**Decision: write this spec now; implement once the `ifc-convert` container (server.mjs)
lands and `qto.ts` stabilises.** Implementation must add new files where possible (a
separate route file) rather than editing the live `qto.ts`.

## Decisions (from brainstorming)

1. **Design-only now**; implement when the container is ready.
2. **Core parity** scope for the Python port (see below).
3. **Hybrid routing**: small files compute in-browser (fast, no container cold-start);
   large files (> threshold) route to the server.

## Architecture & data flow

```
ProjectQtoTab (upload/compute)
  └─ file.size ≤ CLIENT_LIMIT ─→ existing in-browser web-ifc path (unchanged)
  └─ file.size  > CLIENT_LIMIT ─→ POST /api/qto/server-runs {project_id, model_url}
        backend trigger (lib/qtoConvert.ts, mirrors lib/ifcConvert.ts)
          └─ IFC_CONVERT_SVC.fetch('/qto', {ifcUrl, projectId, resultUrl, secret})
                container server.mjs `/qto` route:
                  reads .ifc from R2 → runs qto.py (ifcopenshell) → QtoSummary JSON
                  └─ POST resultUrl (/api/qto/qto-result, shared-secret)
        backend callback: validate + INSERT into qto_runs (same table, same shape)
  └─ frontend polls existing GET /api/qto/runs until the new run appears → renders it
```

The container path mirrors the existing IFC→.xkt conversion (`lib/ifcConvert.ts` →
container `/convert` → `/api/qto/conversion-result`); QTO is a sibling `/qto` job.

## Components

### 1. Container QTO compute — `ifc-convert/qto.py` (NEW)
Port the **behaviour** of `qto.worker.ts` to ifcopenshell + IfcGeom. Reference the TS file
as the source-of-truth algorithm. Reuse the Dockerfile's already-installed `ifcopenshell`.
- **Quantities:** `ifcopenshell.util.element.get_psets()` for `Qto_*` (NetVolume/…); IfcGeom
  (OpenCascade) for geometry volume/area as the cross-check, exactly like the worker's
  "always also compute from geometry".
- **Materials:** `get_material()` — layer sets (split by thickness), profile sets,
  constituent sets, material lists; same share logic.
- **Mass:** IfcQuantityWeight → Tekla/BaseQuantities `Weight` pset → volume × name-based
  density heuristic (`DENSITY_RULES`).
- **Summaries:** materials / classes / storeys / types (per-profile BOQ), unit scale.
- **Flags (core parity):** `qty_mismatch`, `no_material`, `no_storey`, `no_volume`,
  `aggregate_parent`. **Defer** the geometry-heavy flags `open_mesh` (Gauss watertightness),
  `duplicate` (centroid+volume buckets), `implausible_thickness` — emit them as
  "not computed server-side" so the UI can label them.
- Emit JSON **matching `QtoSummary`** (`frontend/src/features/projects/lib/qtoTypes.ts`)
  plus a marker `computed_by: 'server'`.

### 2. Container HTTP route — `/qto` in `ifc-convert/server.mjs`
Added **when server.mjs exists** (owned by the container agent — coordinate). Same
shared-secret + detached-job pattern as `/convert`: 202 fast, run qto.py, POST result.

### 3. Backend — NEW files (avoid editing live `qto.ts`)
- `backend/src/lib/qtoConvert.ts` — `startServerQto(env, projectId, modelUrl, origin, …)`,
  mirrors `lib/ifcConvert.ts`.
- `backend/src/routes/qtoServer.ts` — `POST /server-runs` (admin+senior, triggers) and
  `POST /qto-result` (shared-secret, authMiddleware-exempt, validates ≤ `MAX_SUMMARY_BYTES`,
  INSERTs into `qto_runs` with `created_by` = triggering user). Mount under `/api/qto` in
  `index.ts` alongside the existing `qto` router. Reuse the existing `qto_runs` schema
  (migration 0098) — **no new migration** unless a status row is needed.
- Auth exemption for `/api/qto/qto-result` in `middleware/auth.ts` (one line, next to the
  existing `/api/qto/conversion-*` exemptions).

### 4. Frontend — `ProjectQtoTab.tsx`
- Route by size: `file.size > SERVER_THRESHOLD` → trigger server run instead of
  `computeFromBuffer`. Reuse `MAX_QTO_BYTES` (1 GiB) as the threshold, OR lower it and let
  the in-browser ceiling and server-threshold be the same value.
- New "Серверт тооцоолж байна…" state; poll `GET /api/qto/runs` (existing `runsQuery`,
  `invalidateQueries`) until the run lands, then show it via the existing run-detail path.
- New i18n keys (`mn` + `en`) for the server-compute states.

## Output contract (the integration test)
The container's JSON **is** `QtoSummary`. Keep `qtoTypes.ts` the single contract; the
Python emitter and the backend callback both validate against it. A small parity check
(run a mid-size model both client- and server-side, diff totals) guards drift.

## Build sequence (when the container lands)
1. `ifc-convert/qto.py` (core parity) + `/qto` route in `server.mjs` (coordinate w/ owner).
2. `backend/src/lib/qtoConvert.ts` + `backend/src/routes/qtoServer.ts` + auth exemption + mount.
3. `ProjectQtoTab.tsx` hybrid routing + server-compute UI + i18n.
4. End-to-end verify (below).

## Risks / open items
- **server.mjs missing** — hard blocker; implementation deferred until it exists.
- **Live `qto.ts` edits** — keep new backend code in `qtoServer.ts`/`qtoConvert.ts`; only a
  1-line auth exemption + 1-line mount touch shared files.
- **IfcGeom is slow on huge models** — container has 12 GiB + long `sleepAfter`; set a
  generous job timeout; the user already expects "a few minutes".
- **TS↔Python parity drift** — documented core-parity scope; `QtoSummary` is the contract.
- **Cloudflare Containers cost** — Workers Paid plan + per-instance compute; large jobs only.

## Verification (end-to-end, at implementation time)
1. Upload/select the 518.9 MB `MAX_URGUU` model (project 31); confirm it routes to the
   server (not the in-browser worker).
2. Confirm a `qto_runs` row appears with sane `total_volume_m3` / `element_count` and the
   UI renders the summary + history entry.
3. Parity: run a ~50 MB model (project 30/32) both in-browser and server-side; diff totals
   and material/class tables — they should match within rounding for the core-parity fields.
4. Confirm deferred flags (`open_mesh`/`duplicate`/`implausible_thickness`) are labelled
   "not computed server-side", not silently zero.

## References
- Handling large IFC in the browser (culling/tiling, ~1.7 GB even optimised):
  https://altersquare.io/handling-large-ifc-files-in-web-applications-performance-optimization-guide/
- web-ifc memory-access-out-of-bounds on large models:
  https://github.com/ThatOpen/engine_web-ifc/issues/55
- IfcOpenShell quantity take-off (IfcGeom + OpenCascade volume/area):
  https://community.osarch.org/discussion/1346/ifcopenshell-python-calculate-quantities
- Speckle server-side IFC processing: https://speckle.systems/integrations/ifc/
