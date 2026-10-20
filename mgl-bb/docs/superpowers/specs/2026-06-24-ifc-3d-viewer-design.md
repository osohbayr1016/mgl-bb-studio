# IFC 3D Viewer (xeokit + Cloudflare Containers) — Design

- **Date:** 2026-06-24
- **Status:** Approved (brainstorming) — pending spec review → implementation plan
- **Owner:** (MGL engineering)

## 1. Summary

Add an interactive 3D BIM viewer for the `.ifc` models already uploaded per project.
Models are typically large (300–500 MB+), so the IFC is converted **server-side** to
xeokit's compressed, tiled `.xkt` format inside a dedicated **Cloudflare Containers**
worker, cached in R2, and rendered in the browser with the **xeokit-sdk** (full BIM:
orbit/section/measure/tree/picking). Conversion runs **automatically on upload**. The
viewer is available to **both staff and member-clients**.

## 2. Goals / Non-goals

**Goals**
- View any project's `.ifc` model in 3D with full BIM interaction (orbit/pan/zoom,
  spatial tree, hide/isolate, storey filter, section planes, distance measurement,
  click-element → properties + linked QTO).
- Handle 300–500 MB+ IFC without crashing the browser (server-side conversion).
- Auto-convert when an IFC is uploaded; cache the result so viewing is instant.
- Staff (project detail) and member-clients (their project view) can both open it.

**Non-goals (this iteration)**
- In-browser IFC parsing for the viewer (web-ifc already powers QTO; the viewer uses
  the pre-converted `.xkt`, not raw IFC).
- Editing/markup/BCF authoring, federation of multiple models, clash detection.
- Re-using the viewer for non-IFC formats.

## 3. Context & constraints

- The repo **already runs Cloudflare Containers**: `stirling/` (Stirling-PDF,
  `standard-1`) and `weasyprint/` (`basic`), each a standalone Worker with its own
  `Dockerfile`, deployed separately (`cd <dir> && wrangler deploy`), bound to the MGL
  backend via a `*_SVC` service binding. The "this project avoids Docker" note in
  `CLAUDE.md` is **outdated** and should be corrected as part of this work.
- A previous xeokit viewer + `IfcConverter` Durable Object existed but never shipped
  (no container at the time); the DO was created by migration `v2` and deleted by `v4`
  in `backend/wrangler.toml`. Those tags stay (append-only history).
- DB columns `projects.model_xkt_url` and `projects.model_conversion_status` (migration
  `0067`) **still exist** and are nulled whenever `model_url` changes
  (`routes/projects.ts`). We reuse them; the null-on-change is our natural
  "needs reconversion" signal.
- `web-ifc@0.0.77` is already a frontend dependency (QTO worker); `xeokit-sdk` is NOT
  installed (a leftover `frontend/patches/@xeokit+xeokit-sdk+2.6.108.patch` remains and
  should be removed/replaced when we re-add the dependency).
- Cloudflare Containers instance types (verified against Cloudflare docs, 2026):

  | Type | vCPU | Memory | Disk |
  |------|------|--------|------|
  | basic | ¼ | 1 GiB | 4 GB |
  | standard-1 | ½ | 4 GiB | 8 GB |
  | standard-3 | 2 | 8 GiB | 16 GB |
  | standard-4 | 4 | 12 GiB | 20 GB |
  | custom | ≤4 | ≤12 GiB | ≤20 GB |

  Conversion of a ~500 MB IFC fits `standard-4` (12 GiB RAM, 20 GB disk). Containers
  scale to zero; we pay only for active conversion seconds.

## 4. Architecture

```
 Staff uploads .ifc (ProjectQtoTab / model PUT)
   └─ backend: store .ifc in R2 (MEDIA_BUCKET); null model_xkt_url;
              set model_conversion_status='converting'
   └─ backend: ctx.waitUntil → IFC_CONVERT_SVC.fetch(POST /convert {key, projectId, callbackUrl})
        ┌──────────── ifc-convert container Worker (standard-4) ────────────┐
        │ accepts job, returns 202, runs conversion in ctx.waitUntil:        │
        │   1. read .ifc from R2 (MEDIA_BUCKET binding) → stream to container │
        │   2. IfcConvert (IfcOpenShell): model.ifc → model.glb              │
        │        (--use-element-guids → mesh ids == IFC GlobalIds)           │
        │   3. ifcopenshell-python: spatial tree + property sets             │
        │        → xeokit metaModel JSON                                     │
        │   4. convert2xkt -s model.glb -m metadata.json -o model.xkt        │
        │        (metadata embedded INTO the single .xkt)                    │
        │   5. write model.xkt back to R2 (MEDIA_BUCKET binding)             │
        │   6. POST callbackUrl {projectId, status, xktKey|error, secret}    │
        └───────────────────────────────────────────────────────────────────┘
   └─ backend webhook (POST /api/qto/conversion-callback, shared-secret auth):
              set model_xkt_url=<media url>, model_conversion_status='done'|'failed',
              model_conversion_error=<reason|null>
 Frontend "3D загвар":
   poll model_conversion_status → 'done' → load .xkt via xeokit from /media/<key>
```

**Why a callback (not a blocking call):** conversion takes minutes; the backend marks
`converting` and returns immediately, mirroring the existing Speechmatics async webhook
pattern. The container keeps its instance alive via `ctx.waitUntil` while converting and
calls back when finished.

## 5. Components

### 5.1 `ifc-convert/` container Worker (new, standalone)

Mirrors `stirling/` and `weasyprint/` exactly (own `wrangler.toml`, `Dockerfile`,
`src/index.ts`, deployed independently; NOT part of MGL CI / DO-migration list).

- **`Dockerfile`** (multi-stage): IfcOpenShell `IfcConvert` binary + Python +
  `ifcopenshell` (metadata extraction) + Node + `@xeokit/xeokit-convert` (`convert2xkt`).
  A small **Node** HTTP server (one runtime; shells out to `IfcConvert`, the
  `ifcopenshell` python metadata script, then `convert2xkt`) exposes `POST /convert-file`
  (raw IFC body in, `.xkt` body out) and `GET /health`. `EXPOSE` port matches
  `defaultPort`.
- **`src/index.ts`**: `IfcConvertContainer extends Container` (`@cloudflare/containers`),
  `defaultPort` = container port, `sleepAfter='10m'`. The Worker:
  - binds **`MEDIA_BUCKET`** (same R2 bucket as MGL) so it reads the `.ifc` and writes the
    `.xkt` directly — no 500 MB hop through the MGL backend, no public URL.
  - `POST /convert`: validates the shared secret, returns **202**, and in
    `ctx.waitUntil` streams R2 `.ifc` → container `/convert-file` → writes returned
    `.xkt` to R2 → POSTs the MGL `callbackUrl` with `{projectId, status, xktKey, error?}`
    + the shared secret.
- **`wrangler.toml`**: `name="mgl-ifc-convert"`, same `account_id`, `[[containers]]`
  `instance_type="standard-4"` (start here; tune down if models are smaller),
  `max_instances=2`, `[[r2_buckets]] binding="MEDIA_BUCKET"`, container DO migration `v1`.
- **Secrets**: `CONVERT_CALLBACK_SECRET` (shared with MGL backend).

**Risk to validate during implementation (spike):** streaming a ~500 MB request body
through `container.fetch` to the container process. If the proxy rejects bodies that
large, fall back to **R2 presigned GET/PUT URLs** (container process `curl`s input and
PUTs output directly; the Worker only generates the URLs). Presigning needs R2 S3
credentials as secrets — kept as the documented fallback, not the default.

### 5.2 Backend wiring (MGL Worker)

- **Trigger:** in the IFC-upload path (`routes/qto.ts` `PUT /qto/projects/:id/model` and
  `routes/projects.ts` where `model_url` changes), after persisting the model: set
  `model_conversion_status='converting'`, `model_xkt_url=NULL`,
  `model_conversion_error=NULL`, then `ctx.waitUntil(IFC_CONVERT_SVC.fetch(...))`.
- **Service binding:** add `[[services]] binding="IFC_CONVERT_SVC" service="mgl-ifc-convert"`
  to `backend/wrangler.toml`; add `IFC_CONVERT_SVC` + `CONVERT_CALLBACK_SECRET` to the
  `Env` interface in `backend/src/types.ts` (source of truth).
- **Callback route:** `POST /api/qto/conversion-callback` — exempt from `authMiddleware`
  like other webhooks, authenticated by the shared secret header. Writes
  `model_xkt_url` / `model_conversion_status` / `model_conversion_error`.
- **Read:** the existing project read endpoints already return `model_xkt_url` /
  `model_conversion_status`; ensure the client-visible project payload includes them
  (member-gated, same as today's client project access).
- **Manual re-trigger:** a staff-only `POST /api/qto/projects/:id/reconvert` for the rare
  retry after a `failed` status (no UI churn; one button on the staff tab).

### 5.3 Frontend viewer (xeokit)

- **Dependency:** add `xeokit-sdk` (remove the stale patch file). Heavy → its own lazy
  chunk in `vite.config.ts` `manualChunks` (same treatment as `web-ifc` / `exceljs`).
- **Component:** `frontend/src/features/projects/components/ModelViewer.tsx` (lazy).
  - `Viewer` + `XKTLoaderPlugin` (loads `.xkt` from `/media/<key>`; metadata embedded)
    + `TreeViewPlugin` (storey/element tree) + `SectionPlanesPlugin` +
    `DistanceMeasurementsPlugin` + `NavCubePlugin`; picking → a side panel showing the
    clicked element's name/type/storey and, when a QTO run exists, its quantities.
  - Reads project `model_conversion_status`: `converting` → progress note (poll every few
    s); `done` → load `.xkt`; `failed` → error + (staff only) "reconvert" button;
    `idle`/no model → empty state.
  - Performance: enable xeokit culling/LOD/SAO defaults; for very large models, load with
    `xkt` edges/SAO tuned down. Mobile/narrow viewport → a "best on desktop" notice
    (reuse the existing `DesktopOnlyNotice` pattern) but do not hard-block.
- **Placement:**
  - Staff: a new **"3D загвар"** tab on project detail, next to "Тоо хэмжээ".
  - Client: the same component rendered in the member-client's project view under
    `/client/...` (member-gated; clients never trigger conversion, only view the cached
    `.xkt`).
- **i18n:** new strings in both `en.json` and `mn.json` (`modelViewer.*`), `mn` default.

## 6. Data model

Reuse migration `0067` columns; one small additive migration:

```sql
-- NNNN_model_conversion_error.sql
ALTER TABLE projects ADD COLUMN model_conversion_error TEXT;
```

- `model_xkt_url` TEXT NULL — R2 media URL of the converted `.xkt` (metadata embedded).
- `model_conversion_status` TEXT NULL — `'converting' | 'done' | 'failed'` (NULL = none).
- `model_conversion_error` TEXT NULL — short failure reason for the UI.
- `.xkt` R2 key convention: `models/<projectId>/<ifcBasename>.xkt` (derived from the
  `.ifc` key so reconversion overwrites cleanly).

## 7. Access control

- **Conversion** is staff-triggered only (upload path + staff reconvert endpoint).
- **Viewing**: staff see any project; clients see only projects they are a
  `project_members` row for — identical to the existing client project gate.
- **`.xkt` delivery**: served by the public `/media/*` mount (same posture as the
  already-public `.ifc`, avatars, uploads). No new auth surface; the `.xkt` is no more
  sensitive than the `.ifc` it derives from. (If stricter control is wanted later, switch
  `.xkt` to a signed `/media` route — out of scope now.)

## 8. Error handling & edge cases

- IFC too large/dense for 12 GiB, malformed IFC, or `IfcConvert`/`convert2xkt` non-zero
  exit → container reports `status='failed'` + stderr summary; backend stores
  `model_conversion_error`; viewer shows the reason; **QTO is unaffected** (separate path).
- Container/callback never arrives (crash) → status stays `converting`; a staff
  "reconvert" button and a stale-timeout (e.g. status shown as "stuck" after N minutes)
  let the user retry. (Timeout sweep can be a follow-up; manual reconvert covers v1.)
- Re-upload of a new IFC nulls the columns (existing behavior) → fresh conversion.
- Callback spoofing → rejected unless the shared secret matches.

## 9. Performance

- Conversion is the heavy step and is server-side + cached → viewing is loading a
  compressed `.xkt`, which xeokit streams/culls. The browser never parses raw IFC.
- The `.xkt` for a 500 MB IFC is roughly 10–50 MB; still GPU-heavy on phones → desktop
  notice for clients, xeokit LOD/culling on.
- xeokit chunk is lazy-loaded so it never enters the main bundle (Cloudflare Pages
  per-asset limit respected, same as `web-ifc`).

## 10. Ops / deploy

- `ifc-convert/` deploys on its own: `cd ifc-convert && npx wrangler deploy` (needs
  Workers Paid + Docker on the deploy machine — already true for stirling/weasyprint).
- MGL backend deploy adds the `IFC_CONVERT_SVC` service binding + the callback route +
  the secret; remote migration for `model_conversion_error` runs via CI (or manual per
  the team's current manual-deploy note).
- Instance sizing: start `standard-4`; revisit to `standard-3`/custom after measuring
  real conversion memory.

## 11. Build phases (for the implementation plan)

1. **Container**: `ifc-convert/` Dockerfile + conversion script (IfcConvert →
   ifcopenshell metadata → convert2xkt), `/convert-file` + `/health`, local test with a
   sample IFC. Validate the 500 MB streaming spike (or switch to presigned fallback).
2. **Container Worker**: `src/index.ts` (R2 read/write, 202 + waitUntil + callback),
   `wrangler.toml` (standard-4, MEDIA_BUCKET, secret); deploy `mgl-ifc-convert`.
3. **Backend**: `Env` + service binding + secret; conversion trigger on upload;
   `POST /api/qto/conversion-callback`; staff `reconvert`; `model_conversion_error`
   migration; expose status/url on staff + client project payloads.
4. **Frontend**: add `xeokit-sdk` (+ chunk); `ModelViewer.tsx`; staff "3D загвар" tab;
   client project view; status polling; i18n; mobile notice.
5. **Docs**: correct the `CLAUDE.md` "avoids Docker" note; document `ifc-convert/` like
   stirling/weasyprint.

## 12. Open risks

- 500 MB request-body streaming through `container.fetch` (spike in phase 1; presigned
  fallback documented).
- Real conversion memory vs the 12 GiB ceiling for the densest models (measure; densest
  models may simply report `failed` and remain QTO-only).
- `convert2xkt` metadata fidelity for property sets (validate the tree + a few Psets in
  the viewer against the source model).
