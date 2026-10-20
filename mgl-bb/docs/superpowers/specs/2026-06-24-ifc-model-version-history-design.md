# IFC Model Version History (3D viewer) — Design

- **Date:** 2026-06-24
- **Status:** Approved (brainstorming) — pending spec review → implementation
- **Builds on:** `2026-06-24-ifc-3d-viewer-design.md` (the `ifc-convert/` container + `ModelViewer`)

## 1. Summary

Let staff upload a project's `.ifc` **many times**; retain every upload as a dated
**version** with its own converted `.xkt`, and let staff + member-clients pick any past
version in the 3D viewer to eyeball differences between revisions. A dedicated
`project_models` history table (Approach A) is the source of truth; the `.xkt` per
version already persists in R2 (unique key per upload), so only tracking + a version
picker are new.

## 2. Goals / Non-goals

**Goals**
- Each `.ifc` upload becomes a retained, timestamped version (file name + uploader).
- The 3D viewer shows a **version dropdown** (date/time + uploader); selecting one loads
  that version's `.xkt`. Default = the latest converted version.
- Works for both staff and member-clients (view); staff can reconvert a version.
- Decoupled from QTO compute, so an oversized model that skips the in-browser take-off
  still gets a 3D version row.

**Non-goals (this iteration)**
- Visual side-by-side / overlay compare, or per-element change highlighting.
- Linking the 3D version picker to the QTO quantity diff (QTO already diffs runs).
- Renaming / annotating / pinning versions; deleting old versions (a follow-up).

## 3. Data model

New migration `0112_project_models.sql`:

```sql
CREATE TABLE project_models (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id              INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  model_url               TEXT NOT NULL,          -- the .ifc media url
  model_xkt_url           TEXT,                   -- converted .xkt media url (null until done)
  conversion_status       TEXT NOT NULL DEFAULT 'converting', -- 'converting'|'done'|'failed'
  conversion_error        TEXT,
  file_name               TEXT,
  file_size               INTEGER,
  uploaded_by             INTEGER REFERENCES users(id),
  created_at              TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_project_models_project ON project_models(project_id, created_at DESC);

-- Backfill: one version row for each project that currently has a model, so the
-- existing model shows up as the first version instead of vanishing.
INSERT INTO project_models (project_id, model_url, model_xkt_url, conversion_status, created_at)
SELECT id, model_url, model_xkt_url,
       COALESCE(model_conversion_status, CASE WHEN model_xkt_url IS NOT NULL THEN 'done' ELSE 'converting' END),
       datetime('now')
FROM projects WHERE model_url IS NOT NULL;
```

`projects.model_url` / `model_xkt_url` / `model_conversion_status` / `model_conversion_error`
stay as a denormalised **"latest version" pointer** (existing readers + the viewer's first
paint keep working); the callback updates both the version row and these when the version
is the project's latest.

## 4. Flow

```
Staff uploads .ifc  (PUT /api/qto/projects/:id/model)
  └─ INSERT project_models row (status 'converting', file_name, file_size, uploaded_by)  → versionId
  └─ UPDATE projects SET model_url=…, model_conversion_status='converting', model_xkt_url=NULL
  └─ ctx.waitUntil(startIfcConversion(env, projectId, modelUrl, origin, versionId))
        → IFC_CONVERT_SVC POST /convert { key, xktKey, projectId, versionId, callbackUrl }
        → container converts, writes .xkt to R2, POSTs callback { …, versionId, status, xktKey, error }
  └─ callback (POST /api/qto/conversion-callback):
        UPDATE project_models SET model_xkt_url, conversion_status, conversion_error WHERE id = versionId
        if versionId is the project's latest row → also UPDATE projects.model_xkt_url/status/error
```

The `xktKey` already derives from `model_url`, which is unique per upload → each version's
`.xkt` lands at a distinct R2 key and never overwrites a prior one.

## 5. API

- `PUT /api/qto/projects/:id/model` (existing): also inserts the version row, passes
  `versionId` to conversion. Body unchanged (`{ model_url, file_name?, file_size? }` —
  add optional `file_name`/`file_size` so the version row records them; the frontend
  already has the `File`).
- `POST /api/qto/conversion-callback` (existing): accepts `versionId`, updates the version
  row (+ project latest). Shared-secret auth unchanged.
- `POST /api/qto/projects/:id/reconvert` (existing): becomes `…/reconvert?version=<id>`
  (default latest) — reconverts a specific version row.
- **New** `GET /api/qto/projects/:id/models` → `{ models: ProjectModelRow[] }` ordered
  newest first. Member-gated for clients (mirror `GET /projects/:id`). Staff-or-member only.

`ProjectModelRow`: `{ id, model_url, model_xkt_url, conversion_status, conversion_error,
file_name, file_size, uploaded_by, uploaded_by_name, created_at }`.

## 6. Container change (minimal)

`ifc-convert/src/index.ts`: the `ConvertJob` gains an optional `versionId`; `runConversion`
echoes it back verbatim in the callback body. No conversion-logic change.

## 7. Frontend (ModelViewer)

- On mount, fetch `GET /qto/projects/:id/models`. State: `versions[]` + `selectedId`
  (default = newest `done`, else newest).
- Render a **version dropdown** in the toolbar: `<date> · <file_name> · <uploader>` with a
  status dot (converting/failed). Selecting a version loads its `model_xkt_url` (destroy +
  reload the xeokit model).
- Poll `GET …/models` every 5 s while any version is `converting`; stop when none are.
- `failed` version → error + (staff) reconvert that version.
- No model rows → the existing "no model" empty state.
- Clients: same dropdown, member-gated, no reconvert.

The component keeps using `MEDIA_BASE_URL + model_xkt_url`; only the *source of the url*
moves from the single project field to the selected version row.

## 8. Access control

- Upload / reconvert: staff (admin+senior, the existing `/qto` gate).
- List + view: staff any; clients only their member projects (`GET …/models` repeats the
  `project_members` check from `GET /projects/:id`).
- `.xkt` served via the public `/media/*` mount (unchanged posture).

## 9. Error handling & edge cases

- Re-upload while a prior version still `converting` → fine, independent rows + R2 keys.
- Backfilled rows whose `.xkt` predates this feature: if `model_xkt_url` is set they show
  as `done`; if a backfilled row is `converting` with no live job it can be reconverted.
- A version whose `.xkt` was never produced (`failed`) is selectable but shows the error.
- Deleting the project cascades the rows (FK `ON DELETE CASCADE`).

## 10. Out of scope / future
Visual compare/overlay, change-highlight, version delete/rename/pin, linking to the QTO
quantity diff, retention limits.

## 11. Build steps
1. Migration `0112_project_models.sql` (+ backfill).
2. Backend: insert version row on upload; thread `versionId` through `lib/ifcConvert.ts` +
   the callback + reconvert; new `GET …/models`; `ProjectModelRow` type.
3. Container: pass `versionId` through the callback.
4. Frontend: `ProjectModelRow` type; ModelViewer version dropdown + list fetch/poll;
   wire staff reconvert-by-version.
