# IFC 3D Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** View large project `.ifc` models in 3D (full BIM) by converting them to xeokit `.xkt` server-side in a Cloudflare Container and rendering with xeokit-sdk, for both staff and member-clients.

**Architecture:** A standalone `ifc-convert/` Container Worker (mirrors `stirling/` and `weasyprint/`) converts IFC → `.glb` (IfcConvert) → metadata JSON (ifcopenshell) → `.xkt` (convert2xkt), reading/writing R2 directly. The MGL backend triggers conversion on IFC upload (async), receives a webhook callback, and stores the result in the existing `model_xkt_url` / `model_conversion_status` columns. A lazy-loaded `ModelViewer.tsx` polls status and renders the cached `.xkt`.

**Tech Stack:** Cloudflare Containers (`@cloudflare/containers`), IfcOpenShell `IfcConvert`, `ifcopenshell` (Python), `@xeokit/xeokit-convert` (`convert2xkt`), Node 20 container, Hono backend, React 19 + `xeokit-sdk`, D1, R2.

## Global Constraints

- **No test framework exists in this repo** (CLAUDE.md). "Verify" steps use real commands: `docker build`/`docker run` + `curl`, `npx tsc -b --force`, `npm run build`, `wrangler deploy --dry-run`, and manual viewer checks — NOT invented `pytest`/`jest`.
- **Concurrent WIP / branch isolation:** other agents have uncommitted changes on `main`. Execute this plan in an isolated git worktree/branch (the executing skill creates it). Commit steps stage ONLY the files each task names — never `git add -A`.
- **TypeScript strict everywhere; backend `noUncheckedIndexedAccess` on.** Don't loosen it.
- **`backend/src/types.ts` is the source of truth for the `Env` interface.** `worker-configuration.d.ts` is generated/gitignored — don't edit it.
- **New user-facing strings go in BOTH `frontend/src/shared/i18n/en.json` and `mn.json`.** `mn` is the default.
- **Container Workers deploy on their own** (`cd <dir> && npx wrangler deploy`), NOT via MGL CI / the backend DO-migration list. Requires Workers Paid + Docker on the deploy machine.
- **Account id (all wrangler configs):** `c78d4826fa106e778000785594e921a3`.
- **R2 bucket:** `mgl-progress-media` (binding `MEDIA_BUCKET`).
- **Spec:** `docs/superpowers/specs/2026-06-24-ifc-3d-viewer-design.md`.
- **Spec correction:** the spec says the staff viewer sits "next to Тоо хэмжээ" on project detail, but QTO is now a top-level `/app/qto` page, not a project-detail tab. The staff viewer is therefore a **new tab on `ProjectDetailPage.tsx`** (alongside `overview`/`info`/`mail`/`report`/`charts`).

---

## Phase 1 — Conversion service (container image)

### Task 1: Scaffold `ifc-convert/` package + Node conversion server

**Files:**
- Create: `ifc-convert/package.json`
- Create: `ifc-convert/server.mjs`
- Create: `ifc-convert/metadata.py`

**Interfaces:**
- Produces: an HTTP service with `POST /convert-file` (raw `.ifc` body → `.xkt` body) and `GET /health`, listening on port `8080`.

- [ ] **Step 1: Create `ifc-convert/package.json`**

```json
{
  "name": "mgl-ifc-convert-service",
  "private": true,
  "type": "module",
  "dependencies": {
    "@xeokit/xeokit-convert": "^1.4.0"
  }
}
```

- [ ] **Step 2: Create `ifc-convert/metadata.py`** — ifcopenshell → xeokit metaModel JSON (spatial tree + property sets)

```python
#!/usr/bin/env python3
"""Emit a xeokit metaModel JSON (metaObjects + propertySets) from an IFC file.
Usage: python3 metadata.py <model.ifc> <out.metadata.json>
Mesh ids in the .glb are IFC GlobalIds (IfcConvert --use-element-guids), so
metaObject ids use GlobalId to line up with picked entities in the viewer."""
import json, sys
import ifcopenshell
import ifcopenshell.util.element as ue

def main(ifc_path: str, out_path: str) -> None:
    f = ifcopenshell.open(ifc_path)
    meta_objects = []
    property_sets = []
    seen = set()

    def add(obj, parent_gid):
        gid = getattr(obj, "GlobalId", None)
        if not gid or gid in seen:
            return
        seen.add(gid)
        meta_objects.append({
            "id": gid,
            "name": getattr(obj, "Name", None) or obj.is_a(),
            "type": obj.is_a(),
            "parent": parent_gid,
        })
        psets = ue.get_psets(obj)
        if psets:
            property_sets.append({
                "id": gid,
                "originalSystemId": gid,
                "name": getattr(obj, "Name", None) or obj.is_a(),
                "properties": [
                    {"name": f"{pset}.{k}", "value": v}
                    for pset, props in psets.items()
                    for k, v in props.items() if k != "id"
                ],
            })
        # IfcRelAggregates (spatial) + IfcRelContainedInSpatialStructure (elements)
        for rel in getattr(obj, "IsDecomposedBy", []) or []:
            for child in rel.RelatedObjects:
                add(child, gid)
        for rel in getattr(obj, "ContainsElements", []) or []:
            for child in rel.RelatedElements:
                add(child, gid)

    for project in f.by_type("IfcProject"):
        add(project, None)

    json.dump(
        {"metaObjects": meta_objects, "propertySets": property_sets},
        open(out_path, "w"), ensure_ascii=False,
    )

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
```

- [ ] **Step 3: Create `ifc-convert/server.mjs`** — HTTP service that shells out IfcConvert → metadata.py → convert2xkt

```javascript
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 8080;

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}: ${err.slice(-500)}`)),
    );
  });
}

async function convert(ifcBuffer) {
  const dir = await mkdtemp(join(tmpdir(), 'ifc-'));
  const ifc = join(dir, 'model.ifc');
  const glb = join(dir, 'model.glb');
  const meta = join(dir, 'model.metadata.json');
  const xkt = join(dir, 'model.xkt');
  try {
    await writeFile(ifc, ifcBuffer);
    await run('IfcConvert', ['--use-element-guids', '-y', ifc, glb]);
    await run('python3', ['metadata.py', ifc, meta]);
    await run('npx', ['convert2xkt', '-s', glb, '-m', meta, '-o', xkt]);
    return await readFile(xkt);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200).end('ok');
    return;
  }
  if (req.method === 'POST' && req.url === '/convert-file') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      try {
        const out = await convert(Buffer.concat(chunks));
        res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(out);
      } catch (e) {
        res.writeHead(500, { 'content-type': 'text/plain' }).end(String(e?.message ?? e));
      }
    });
    return;
  }
  res.writeHead(404).end('not found');
});

server.listen(PORT, () => console.log(`ifc-convert service on :${PORT}`));
```

- [ ] **Step 4: Verify the service deps install**

Run: `cd ifc-convert && npm install`
Expected: installs `@xeokit/xeokit-convert`; `node_modules/.bin/convert2xkt` exists.

- [ ] **Step 5: Commit**

```bash
git add ifc-convert/package.json ifc-convert/server.mjs ifc-convert/metadata.py
git commit -m "feat(ifc-convert): conversion service (IfcConvert + ifcopenshell + convert2xkt)"
```

### Task 2: Dockerfile + local end-to-end conversion of a sample IFC

**Files:**
- Create: `ifc-convert/Dockerfile`
- Create: `ifc-convert/.dockerignore`

**Interfaces:**
- Produces: a container image exposing port `8080` that converts an IFC posted to `/convert-file` into an `.xkt`.

- [ ] **Step 1: Create `ifc-convert/.dockerignore`**

```
node_modules
*.ifc
*.xkt
*.glb
```

- [ ] **Step 2: Create `ifc-convert/Dockerfile`**

```dockerfile
# IFC → .xkt converter for Cloudflare Containers. Node service that shells out to
# IfcOpenShell's IfcConvert (geometry), ifcopenshell-python (metadata), and
# xeokit's convert2xkt. Mirrors stirling/ + weasyprint/ — standalone Worker image.
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip ca-certificates curl unzip libgl1 libx11-6 \
 && rm -rf /var/lib/apt/lists/*

# IfcConvert binary from IfcOpenShell builds. PIN a current linux64 build:
# browse https://github.com/IfcOpenShell/IfcOpenShell/releases (or the
# ifcopenshell-builds S3 bucket) and set IFCCONVERT_URL to the latest
# IfcConvert-*-linux64.zip. Validated in Step 4 (`IfcConvert -v`).
ARG IFCCONVERT_URL="https://s3.amazonaws.com/ifcopenshell-builds/IfcConvert-v0.8.0-linux64.zip"
RUN curl -fsSL -o /tmp/ifc.zip "$IFCCONVERT_URL" \
 && unzip /tmp/ifc.zip -d /usr/local/bin \
 && chmod +x /usr/local/bin/IfcConvert \
 && rm /tmp/ifc.zip

# ifcopenshell python (metadata extraction). --break-system-packages: slim image
# has no venv and this container does one job.
RUN pip3 install --no-cache-dir --break-system-packages ifcopenshell

WORKDIR /app
COPY package.json .
RUN npm install --omit=dev
COPY server.mjs metadata.py ./

# Must match defaultPort in src/index.ts — Container blocks until this listens.
EXPOSE 8080
CMD ["node", "server.mjs"]
```

- [ ] **Step 3: Build the image**

Run: `cd ifc-convert && docker build -t mgl-ifc-convert .`
Expected: image builds; no error on the IfcConvert download/unzip.

- [ ] **Step 4: Verify the toolchain inside the image**

Run: `docker run --rm mgl-ifc-convert sh -c "IfcConvert -v && python3 -c 'import ifcopenshell' && npx convert2xkt --help >/dev/null && echo OK"`
Expected: prints an IfcConvert version line and `OK`.

- [ ] **Step 5: End-to-end convert a real model**

Run (replace the path with a real project `.ifc`, e.g. the MAX_URGUU model):
```bash
docker run --rm -d -p 8080:8080 --name ifcc mgl-ifc-convert
curl -sS -X POST --data-binary @"/path/to/model.ifc" \
  -H "content-type: application/octet-stream" \
  http://localhost:8080/convert-file --output out.xkt
docker stop ifcc
ls -la out.xkt
```
Expected: `out.xkt` is non-empty (typically 10–50 MB for a ~500 MB IFC). If `IfcConvert` OOMs, note the peak memory (`docker stats`) — this informs the `instance_type` choice in Task 3.

- [ ] **Step 6: Commit**

```bash
git add ifc-convert/Dockerfile ifc-convert/.dockerignore
git commit -m "feat(ifc-convert): Dockerfile + verified local IFC->xkt conversion"
```

---

## Phase 2 — Container Worker (R2 + async + callback)

### Task 3: `ifc-convert` Worker + wrangler config, deploy `mgl-ifc-convert`

**Files:**
- Create: `ifc-convert/src/index.ts`
- Create: `ifc-convert/tsconfig.json`
- Create: `ifc-convert/wrangler.toml`
- Create: `ifc-convert/README.md`
- Modify: `ifc-convert/package.json` (add `@cloudflare/containers` + wrangler devDeps)

**Interfaces:**
- Consumes: the container service from Task 1/2 (`/convert-file`, `/health`).
- Produces: a Worker reachable by service binding with `POST /convert` accepting
  `{ key: string, xktKey: string, projectId: number, callbackUrl: string }`, returning
  `202`, and POSTing the callback `{ projectId, status: 'done'|'failed', xktKey, error: string|null }`
  with header `x-convert-secret`.

- [ ] **Step 1: Add Worker deps to `ifc-convert/package.json`**

```json
{
  "name": "mgl-ifc-convert-service",
  "private": true,
  "type": "module",
  "dependencies": {
    "@cloudflare/containers": "^0.0.40",
    "@xeokit/xeokit-convert": "^1.4.0"
  },
  "devDependencies": {
    "wrangler": "^4.0.0",
    "typescript": "^5.6.0"
  }
}
```
(Pin `@cloudflare/containers` / `wrangler` to the same versions `weasyprint/package.json` uses — check that file and match.)

- [ ] **Step 2: Create `ifc-convert/tsconfig.json`** (copy `weasyprint/tsconfig.json` verbatim if present; otherwise:)

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "es2022",
    "moduleResolution": "bundler",
    "lib": ["es2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create `ifc-convert/src/index.ts`**

```typescript
import { Container, getContainer } from '@cloudflare/containers';

export interface Env {
  IFC_CONVERT: DurableObjectNamespace<IfcConvertContainer>;
  MEDIA_BUCKET: R2Bucket;
  CONVERT_CALLBACK_SECRET: string;
}

interface ConvertJob {
  key: string;
  xktKey: string;
  projectId: number;
  callbackUrl: string;
}

// One container instance per project id → different projects convert
// concurrently (up to max_instances); repeat conversions of the same project
// serialize, which is what we want.
export class IfcConvertContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = '10m';
  override onError(error: unknown) {
    console.log('[ifc-convert] container error', error);
  }
}

async function runConversion(env: Env, job: ConvertJob): Promise<void> {
  let status: 'done' | 'failed' = 'failed';
  let error: string | null = null;
  try {
    const obj = await env.MEDIA_BUCKET.get(job.key);
    if (!obj) throw new Error(`R2 object not found: ${job.key}`);
    const container = getContainer(env.IFC_CONVERT, String(job.projectId));
    // NOTE (spike): streams the (up to ~500 MB) .ifc body to the container.
    // If the proxy rejects bodies this large, switch to presigned R2 GET/PUT
    // (see spec §5.1 fallback) — the container process curls input/output.
    const res = await container.fetch('https://ifc-convert/convert-file', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: obj.body,
    });
    if (!res.ok) {
      throw new Error(`convert-file HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    await env.MEDIA_BUCKET.put(job.xktKey, res.body, {
      httpMetadata: { contentType: 'application/octet-stream' },
    });
    status = 'done';
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    console.log('[ifc-convert] conversion failed', error);
  }
  await fetch(job.callbackUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-convert-secret': env.CONVERT_CALLBACK_SECRET },
    body: JSON.stringify({ projectId: job.projectId, status, xktKey: job.xktKey, error }),
  }).catch((e) => console.log('[ifc-convert] callback failed', e));
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return new Response('ok');
    if (url.pathname !== '/convert' || request.method !== 'POST') {
      return new Response('not found', { status: 404 });
    }
    if (request.headers.get('x-convert-secret') !== env.CONVERT_CALLBACK_SECRET) {
      return new Response('unauthorized', { status: 401 });
    }
    const job = (await request.json()) as ConvertJob;
    ctx.waitUntil(runConversion(env, job));
    return new Response(JSON.stringify({ accepted: true }), {
      status: 202,
      headers: { 'content-type': 'application/json' },
    });
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 4: Create `ifc-convert/wrangler.toml`**

```toml
# Dedicated Worker that runs the IFC -> .xkt converter container. Deployed on its
# own (NOT part of the MGL backend deploy). Requires Workers Paid + Docker.
name = "mgl-ifc-convert"
main = "src/index.ts"
compatibility_date = "2025-05-01"
account_id = "c78d4826fa106e778000785594e921a3"

# standard-4 = 4 vCPU / 12 GiB / 20 GB disk — headroom for ~500 MB IFC. Drop to
# standard-3 (8 GiB) after measuring real peak memory (Task 2, Step 5).
[[containers]]
class_name = "IfcConvertContainer"
image = "./Dockerfile"
instance_type = "standard-4"
max_instances = 2

[[durable_objects.bindings]]
name = "IFC_CONVERT"
class_name = "IfcConvertContainer"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["IfcConvertContainer"]

# Same bucket as the MGL backend — reads the .ifc and writes the .xkt directly,
# so the 500 MB model never hops through the MGL Worker.
[[r2_buckets]]
binding = "MEDIA_BUCKET"
bucket_name = "mgl-progress-media"
```

- [ ] **Step 5: Set the shared secret and deploy**

Run:
```bash
cd ifc-convert
npx wrangler secret put CONVERT_CALLBACK_SECRET   # paste a long random string; reuse the SAME value for the MGL backend in Task 5
npx wrangler deploy
```
Expected: builds + pushes the image, deploys `mgl-ifc-convert`.

- [ ] **Step 6: Smoke-test `/health` via the deployed Worker**

Run: `curl -sS https://mgl-ifc-convert.<your-subdomain>.workers.dev/health`
Expected: `ok`. (`/convert` is exercised end-to-end in Task 6.)

- [ ] **Step 7: Create `ifc-convert/README.md`** documenting deploy + the secret (mirror `weasyprint/README.md`), then commit

```bash
git add ifc-convert/src/index.ts ifc-convert/tsconfig.json ifc-convert/wrangler.toml ifc-convert/README.md ifc-convert/package.json
git commit -m "feat(ifc-convert): container Worker (R2 read/write, async + callback) + deploy config"
```

---

## Phase 3 — Backend wiring

### Task 4: DB migration for the failure reason + Env binding

**Files:**
- Create: `backend/migrations/0111_model_conversion_error.sql`
- Modify: `backend/src/types.ts` (add to `Env`)
- Modify: `backend/wrangler.toml` (add service binding)

**Interfaces:**
- Produces: `projects.model_conversion_error TEXT`; `Env.IFC_CONVERT_SVC: Fetcher`; `Env.CONVERT_CALLBACK_SECRET: string`.

- [ ] **Step 1: Create `backend/migrations/0111_model_conversion_error.sql`**

```sql
-- Short, human-readable reason a model conversion failed (shown in the viewer).
-- Companion to model_xkt_url / model_conversion_status (migration 0067).
ALTER TABLE projects ADD COLUMN model_conversion_error TEXT;
```

- [ ] **Step 2: Apply it to local D1**

Run: `cd backend && npx wrangler d1 execute mgl-progress-db --local --file=./migrations/0111_model_conversion_error.sql`
Expected: `executed 1 command`.

- [ ] **Step 3: Add bindings to `backend/src/types.ts`** — inside the `Env` interface, next to the other service/secret bindings:

```typescript
  /** Service binding to the mgl-ifc-convert container Worker (IFC -> .xkt). */
  IFC_CONVERT_SVC: Fetcher;
  /** Shared secret authenticating the convert Worker's webhook callback. */
  CONVERT_CALLBACK_SECRET: string;
```

- [ ] **Step 4: Add the service binding to `backend/wrangler.toml`** — next to the existing `[[services]]` blocks (STIRLING_SVC / WEASYPRINT_SVC):

```toml
# Internal binding to the IFC->.xkt converter container Worker (ifc-convert/).
# Deploy that Worker separately: cd ifc-convert && npx wrangler deploy.
[[services]]
binding = "IFC_CONVERT_SVC"
service = "mgl-ifc-convert"
```

- [ ] **Step 5: Set the backend secret (same value as Task 3 Step 5)**

Run: `cd backend && npx wrangler secret put CONVERT_CALLBACK_SECRET`
Expected: secret stored. (Local dev: add `CONVERT_CALLBACK_SECRET=...` to `backend/.dev.vars`.)

- [ ] **Step 6: Typecheck + commit**

Run: `cd backend && npx tsc -b --force`
Expected: no new errors in `types.ts`.
```bash
git add backend/migrations/0111_model_conversion_error.sql backend/src/types.ts backend/wrangler.toml
git commit -m "feat(qto): model_conversion_error column + IFC_CONVERT_SVC binding"
```

### Task 5: Trigger conversion + webhook callback + reconvert

**Files:**
- Create: `backend/src/lib/ifcConvert.ts`
- Modify: `backend/src/routes/qto.ts` (trigger on model PUT; callback route; reconvert route)
- Modify: `backend/src/index.ts` (exempt the callback path from `authMiddleware` if needed — verify how other webhooks are exempted)

**Interfaces:**
- Consumes: `Env.IFC_CONVERT_SVC`, `Env.CONVERT_CALLBACK_SECRET`, the convert Worker's `POST /convert`.
- Produces: `startIfcConversion(c, projectId, modelUrl)`; routes `POST /api/qto/conversion-callback` and `POST /api/qto/projects/:id/reconvert`.

- [ ] **Step 1: Create `backend/src/lib/ifcConvert.ts`**

```typescript
import type { Context } from 'hono';
import type { Env } from '../types';

/** Derive the .xkt R2 key from the .ifc media url/key (overwrite-on-reconvert). */
export function xktKeyFor(modelUrl: string): string {
  // model media urls look like "/media/<key>" or "<key>"; strip the mount + .ifc
  const key = modelUrl.replace(/^\/?media\//, '').replace(/\.ifc$/i, '');
  return `${key}.xkt`;
}

/** Public /media url for an R2 key. */
export function mediaUrl(key: string): string {
  return `/media/${key}`;
}

/**
 * Fire-and-forget: mark the project 'converting' and kick the container Worker.
 * Call inside `c.executionCtx.waitUntil(...)` so the user's request returns now.
 */
export async function startIfcConversion(
  env: Env,
  projectId: number,
  modelUrl: string,
  origin: string,
): Promise<void> {
  if (!env.IFC_CONVERT_SVC) return; // binding absent (e.g. local) → leave status null
  const key = modelUrl.replace(/^\/?media\//, '');
  const xktKey = xktKeyFor(modelUrl);
  await env.IFC_CONVERT_SVC.fetch('https://ifc-convert/convert', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-convert-secret': env.CONVERT_CALLBACK_SECRET },
    body: JSON.stringify({
      key,
      xktKey,
      projectId,
      callbackUrl: `${origin}/api/qto/conversion-callback`,
    }),
  });
}
```

- [ ] **Step 2: Trigger on model upload** — in `backend/src/routes/qto.ts`, the `qto.put('/projects/:id/model', ...)` handler (around line 88). The UPDATE already nulls `model_xkt_url`/`model_conversion_status`; change it to set `'converting'` and kick conversion. Replace the existing UPDATE + return with:

```typescript
    await c.env.DB.prepare(
      `UPDATE projects
          SET model_url = ?, model_xkt_url = NULL,
              model_conversion_status = 'converting', model_conversion_error = NULL
        WHERE id = ?`,
    )
      .bind(modelUrl, id)
      .run();

    // Kick the container converter in the background (returns 202 immediately).
    const origin = new URL(c.req.url).origin;
    c.executionCtx.waitUntil(
      startIfcConversion(c.env, id, modelUrl, origin).catch(async (e) => {
        await c.env.DB.prepare(
          `UPDATE projects SET model_conversion_status='failed', model_conversion_error=? WHERE id=?`,
        )
          .bind(String(e).slice(0, 300), id)
          .run();
      }),
    );

    return c.json({ message: 'Model updated', model_url: modelUrl });
```
Add at the top of `qto.ts`: `import { startIfcConversion } from '../lib/ifcConvert';`

- [ ] **Step 3: Add the callback route** in `qto.ts` (this is hit by the container Worker, authed by the shared secret, NOT a user):

```typescript
// POST /api/qto/conversion-callback — the ifc-convert Worker reports completion.
qto.post('/conversion-callback', async (c) => {
  if (c.req.header('x-convert-secret') !== c.env.CONVERT_CALLBACK_SECRET) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const body = await c.req.json<{
    projectId: number; status: 'done' | 'failed'; xktKey: string; error: string | null;
  }>();
  const xktUrl = body.status === 'done' ? `/media/${body.xktKey}` : null;
  await c.env.DB.prepare(
    `UPDATE projects
        SET model_xkt_url = ?, model_conversion_status = ?, model_conversion_error = ?
      WHERE id = ?`,
  )
    .bind(xktUrl, body.status, body.error ?? null, body.projectId)
    .run();
  return c.json({ ok: true });
});
```

- [ ] **Step 4: Add the staff reconvert route** in `qto.ts`:

```typescript
// POST /api/qto/projects/:id/reconvert — staff retry after a failed conversion.
qto.post('/projects/:id/reconvert', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const row = await c.env.DB.prepare('SELECT model_url FROM projects WHERE id = ?')
    .bind(id)
    .first<{ model_url: string | null }>();
  if (!row?.model_url) return c.json({ error: 'No model to convert' }, 400);
  await c.env.DB.prepare(
    `UPDATE projects SET model_conversion_status='converting', model_xkt_url=NULL,
            model_conversion_error=NULL WHERE id=?`,
  )
    .bind(id)
    .run();
  const origin = new URL(c.req.url).origin;
  c.executionCtx.waitUntil(startIfcConversion(c.env, id, row.model_url, origin));
  return c.json({ message: 'Reconversion started' });
});
```

- [ ] **Step 5: Exempt the callback from auth** — `/api/qto/*` runs through `authMiddleware`. The callback has no user JWT. Locate how `authMiddleware` whitelists public paths in `backend/src/middleware/auth.ts` (e.g. the `path.startsWith('/api/quotes/public')` check) and add `path === '/api/qto/conversion-callback'` to the same exemption list. (The shared-secret header is its auth.)

- [ ] **Step 6: Verify build**

Run: `cd backend && npx tsc -b --force`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/lib/ifcConvert.ts backend/src/routes/qto.ts backend/src/middleware/auth.ts
git commit -m "feat(qto): trigger IFC->xkt conversion on upload + webhook callback + reconvert"
```

### Task 6: Expose conversion fields on project payloads + end-to-end backend test

**Files:**
- Modify: `backend/src/routes/projects.ts` (ensure `model_xkt_url`, `model_conversion_status`, `model_conversion_error` are selected on the project-detail payload staff AND clients read; and when `model_url` changes here too, trigger conversion)
- Modify: `frontend/src/shared/types/index.ts` (add the fields to the project type the frontend consumes)

**Interfaces:**
- Produces: project read payloads carrying `model_xkt_url: string | null`, `model_conversion_status: string | null`, `model_conversion_error: string | null`.

- [ ] **Step 1: Select the fields** — find the project-detail `SELECT` in `routes/projects.ts` (`GET /:id`) and ensure it returns `model_xkt_url`, `model_conversion_status`, `model_conversion_error` (add any missing column to the select list). The client path uses the same row, so this covers both.

- [ ] **Step 2: Trigger on the projects.ts model change too** — locate where `routes/projects.ts` updates `model_url` (it already nulls the xkt columns per CLAUDE.md). Mirror Task 5 Step 2: set status `'converting'` and `c.executionCtx.waitUntil(startIfcConversion(...))`. Import `startIfcConversion`.

- [ ] **Step 3: Add the fields to the frontend type** in `frontend/src/shared/types/index.ts` on the project interface (`ProjectWithProgress` or equivalent):

```typescript
  model_xkt_url?: string | null;
  model_conversion_status?: 'converting' | 'done' | 'failed' | null;
  model_conversion_error?: string | null;
```

- [ ] **Step 4: Full local end-to-end test** — with `backend` running (`npm run dev`) and the deployed `mgl-ifc-convert`:
  1. Upload an `.ifc` to a test project (or `PUT /api/qto/projects/:id/model`).
  2. Confirm `model_conversion_status` flips to `converting` (query D1).
  3. Wait for conversion; confirm the callback sets `done` + `model_xkt_url`, and the `.xkt` exists in R2 (`npx wrangler r2 object get mgl-progress-media <xktKey>`).

Run (status check): `cd backend && npx wrangler d1 execute mgl-progress-db --local --command "SELECT id, model_conversion_status, model_xkt_url, model_conversion_error FROM projects WHERE id=<test>"`
Expected: progresses `converting` → `done` with a `/media/...xkt` url.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/projects.ts frontend/src/shared/types/index.ts
git commit -m "feat(qto): expose conversion status/url on project payloads + projects.ts trigger"
```

---

## Phase 4 — Frontend viewer

### Task 7: Add `xeokit-sdk` dependency + lazy chunk

**Files:**
- Modify: `frontend/package.json` (add `xeokit-sdk`)
- Delete: `frontend/patches/@xeokit+xeokit-sdk+2.6.108.patch` (stale leftover)
- Modify: `frontend/vite.config.ts` (manualChunks: `xeokit`)

**Interfaces:**
- Produces: `xeokit-sdk` importable; isolated into its own build chunk.

- [ ] **Step 1: Install xeokit-sdk**

Run: `cd frontend && npm install xeokit-sdk@^2.6` (pin the version the patch targeted: 2.6.x).

- [ ] **Step 2: Remove the stale patch** so `patch-package` doesn't fail

Run: `git rm frontend/patches/@xeokit+xeokit-sdk+2.6.108.patch`
(If the project runs `patch-package` postinstall, confirm install still succeeds without it.)

- [ ] **Step 3: Add a manual chunk** in `frontend/vite.config.ts` — in the `manualChunks` map alongside `web-ifc`/`exceljs`/`maplibre`:

```typescript
            if (id.includes('xeokit-sdk')) return 'xeokit';
```
(Match the exact existing `manualChunks` shape — it may be a function or an object; follow the file's pattern.)

- [ ] **Step 4: Verify build still works**

Run: `cd frontend && npm run build`
Expected: builds; a `xeokit-*.js` chunk appears in the output.

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vite.config.ts frontend/patches
git commit -m "build(frontend): add xeokit-sdk as a lazy chunk; drop stale xeokit patch"
```

### Task 8: `ModelViewer.tsx` — the xeokit BIM viewer

**Files:**
- Create: `frontend/src/features/projects/components/ModelViewer.tsx`
- Modify: `frontend/src/shared/i18n/en.json` + `mn.json` (add `modelViewer.*`)

**Interfaces:**
- Consumes: a `project` with `model_xkt_url` / `model_conversion_status` / `model_conversion_error`; `MEDIA_BASE_URL` from `@/shared/api/client`; `apiFetch`.
- Produces: `<ModelViewer project={project} canReconvert={boolean} />` (default export), lazy-loadable via `React.lazy`.

- [ ] **Step 1: Add i18n keys** to BOTH dictionaries (insert in the `modelViewer.*` group; append cleanly — do not edit unrelated keys):

```json
"modelViewer.title": "3D загвар",
"modelViewer.converting": "Загвар бэлтгэж байна… (эхний удаа хэдэн минут болж магадгүй)",
"modelViewer.failed": "Загвар бэлтгэхэд алдаа гарлаа",
"modelViewer.noModel": "Энэ төсөлд .ifc загвар оруулаагүй байна.",
"modelViewer.reconvert": "Дахин бэлтгэх",
"modelViewer.desktopHint": "3D загвар нь том файлтай тул компьютер дээр илүү тохиромжтой.",
"modelViewer.properties": "Шинж чанар",
"modelViewer.tree": "Бүтэц",
"modelViewer.section": "Огтлол",
"modelViewer.measure": "Хэмжих",
"modelViewer.resetView": "Харагдацыг сэргээх"
```
(English values in `en.json`: "3D model", "Preparing the model… (the first time can take a few minutes)", "Failed to prepare the model", "No .ifc model uploaded for this project.", "Re-generate", "The 3D model is large — best viewed on a computer.", "Properties", "Structure", "Section", "Measure", "Reset view".)

- [ ] **Step 2: Create `frontend/src/features/projects/components/ModelViewer.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { Viewer } from '@xeokit/xeokit-sdk/dist/xeokit-sdk.es.js';
import { XKTLoaderPlugin } from '@xeokit/xeokit-sdk/dist/xeokit-sdk.es.js';
import { TreeViewPlugin } from '@xeokit/xeokit-sdk/dist/xeokit-sdk.es.js';
import { SectionPlanesPlugin } from '@xeokit/xeokit-sdk/dist/xeokit-sdk.es.js';
import { DistanceMeasurementsPlugin } from '@xeokit/xeokit-sdk/dist/xeokit-sdk.es.js';
import { NavCubePlugin } from '@xeokit/xeokit-sdk/dist/xeokit-sdk.es.js';
import { apiFetch, MEDIA_BASE_URL } from '@/shared/api/client';
import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import { toast } from '@/shared/components/Toast';
import type { ProjectWithProgress } from '@/shared/types';

interface ModelViewerProps {
  project: ProjectWithProgress;
  canReconvert?: boolean;
}

export default function ModelViewer({ project, canReconvert = false }: ModelViewerProps) {
  const { t } = useLanguage();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const treeRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState(project.model_conversion_status ?? null);
  const [xktUrl, setXktUrl] = useState(project.model_xkt_url ?? null);

  // Poll while converting.
  useEffect(() => {
    if (status !== 'converting') return;
    const iv = window.setInterval(async () => {
      try {
        const r = await apiFetch<{ project: ProjectWithProgress }>(`/projects/${project.id}`);
        setStatus(r.project.model_conversion_status ?? null);
        setXktUrl(r.project.model_xkt_url ?? null);
      } catch {
        /* keep polling */
      }
    }, 5000);
    return () => window.clearInterval(iv);
  }, [status, project.id]);

  // Mount the xeokit viewer once we have a ready .xkt.
  useEffect(() => {
    if (status !== 'done' || !xktUrl || !canvasRef.current) return;
    const viewer = new Viewer({ canvasElement: canvasRef.current, transparent: true });
    new NavCubePlugin(viewer, { canvasId: undefined });
    const xkt = new XKTLoaderPlugin(viewer);
    new SectionPlanesPlugin(viewer);
    new DistanceMeasurementsPlugin(viewer);
    if (treeRef.current) {
      new TreeViewPlugin(viewer, { containerElement: treeRef.current, hierarchy: 'storeys' });
    }
    const src = xktUrl.startsWith('http') ? xktUrl : `${MEDIA_BASE_URL}${xktUrl}`;
    const model = xkt.load({ id: `model-${project.id}`, src, edges: true, saoEnabled: true });
    model.on('error', () => toast.error(t('modelViewer.failed')));
    return () => viewer.destroy();
  }, [status, xktUrl, project.id, t]);

  if (!project.model_url) {
    return <p className="text-sm text-muted-foreground p-6">{t('modelViewer.noModel')}</p>;
  }
  if (status === 'converting') {
    return (
      <div className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> {t('modelViewer.converting')}
      </div>
    );
  }
  if (status === 'failed') {
    return (
      <div className="p-6 space-y-3">
        <p className="text-sm text-danger">
          {t('modelViewer.failed')}
          {project.model_conversion_error ? ` — ${project.model_conversion_error}` : ''}
        </p>
        {canReconvert && (
          <Button
            size="sm"
            onClick={async () => {
              await apiFetch(`/qto/projects/${project.id}/reconvert`, { method: 'POST' });
              setStatus('converting');
            }}
          >
            <RotateCcw className="w-4 h-4 mr-1.5" /> {t('modelViewer.reconvert')}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground lg:hidden">{t('modelViewer.desktopHint')}</p>
      <div className="grid gap-3 lg:grid-cols-[260px_1fr]">
        <div
          ref={treeRef}
          className="hidden lg:block max-h-[70vh] overflow-auto rounded-lg border border-border bg-card p-2 text-xs"
        />
        <div className="relative rounded-lg border border-border overflow-hidden bg-[#0e1726]">
          <canvas ref={canvasRef} className="w-full h-[70vh] block" />
        </div>
      </div>
    </div>
  );
}
```
(Adjust the xeokit import path if the installed package exposes a different entry — verify against `node_modules/xeokit-sdk/package.json` `exports`. The CSS for `TreeViewPlugin`/measurements ships with xeokit; import it if the tree/markers render unstyled.)

- [ ] **Step 3: Verify build + typecheck**

Run: `cd frontend && npx tsc -b --force && npm run build`
Expected: no errors; `xeokit` chunk emitted.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/projects/components/ModelViewer.tsx frontend/src/shared/i18n/en.json frontend/src/shared/i18n/mn.json
git commit -m "feat(projects): xeokit ModelViewer (status polling, BIM tools, reconvert)"
```

### Task 9: Mount the viewer — staff tab + client view

**Files:**
- Modify: `frontend/src/features/projects/ProjectDetailPage.tsx` (new "3D загвар" tab)
- Modify: the client project view (locate the component that renders a client's project, under the `/client` route — likely `frontend/src/features/client/ClientDashboardPage.tsx` or a client project page)

**Interfaces:**
- Consumes: `ModelViewer` (lazy), the loaded `project`.

- [ ] **Step 1: Lazy-import in `ProjectDetailPage.tsx`** (top of file):

```tsx
const ModelViewer = lazy(() => import('@/features/projects/components/ModelViewer'));
```

- [ ] **Step 2: Add the tab trigger** next to the existing triggers (`overview`/`info`/`mail`/`report`/`charts`, around line 1184):

```tsx
          <TabsTrigger value="model" className="gap-2">
            {t('modelViewer.title')}
          </TabsTrigger>
```

- [ ] **Step 3: Add the tab content** (alongside the other `<TabsContent>` blocks). Staff can reconvert:

```tsx
          <TabsContent value="model">
            <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">…</div>}>
              <ModelViewer project={project} canReconvert />
            </Suspense>
          </TabsContent>
```
(Ensure `Suspense`/`lazy` are imported from `react`.)

- [ ] **Step 4: Mount in the client project view** — in the client's project component, render the same viewer (no reconvert):

```tsx
<Suspense fallback={null}>
  <ModelViewer project={project} />
</Suspense>
```
Member-gating is already enforced by the client project route + the backend's `project_members` check; the client only ever sees the cached `.xkt`.

- [ ] **Step 5: Verify build**

Run: `cd frontend && npx tsc -b --force && npm run build`
Expected: no errors.

- [ ] **Step 6: Manual viewer check** — `npm run dev`, open a project whose `.xkt` is ready:
  - Staff: project detail → "3D загвар" tab → model renders; tree, orbit, section, measure, click-element work.
  - Client: log in as a member-client → their project → viewer renders.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/projects/ProjectDetailPage.tsx <client-project-file>
git commit -m "feat(projects): mount 3D ModelViewer on staff project detail + client view"
```

---

## Phase 5 — Docs

### Task 10: Correct CLAUDE.md + document the converter

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Fix the outdated "avoids Docker" claims.** In the QTO section, the line "the converter never ran in production — it needed Docker, which this project deliberately doesn't use" is now false. Replace with a note that the project DOES use Cloudflare Containers (`stirling/`, `weasyprint/`, and now `ifc-convert/`), and that the `.ifc` 3D viewer is back via the `ifc-convert/` container (IFC→.xkt) + the xeokit `ModelViewer`. Keep the `model_xkt_url` / `model_conversion_status` description but note they are now LIVE (no longer dormant) plus the new `model_conversion_error`.

- [ ] **Step 2: Add `ifc-convert/` to the repo-layout / containers description** next to `stirling/` and `weasyprint/`.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: ifc-convert container + restored 3D viewer; correct the no-Docker note"
```

---

## Self-Review

**Spec coverage:**
- §5.1 container (Dockerfile, conversion pipeline, R2, 202+callback) → Tasks 1–3. ✓
- §5.2 backend (Env, service binding, trigger, callback, reconvert, expose fields) → Tasks 4–6. ✓
- §5.3 frontend (xeokit dep+chunk, ModelViewer, staff tab, client view, status polling, mobile notice, i18n) → Tasks 7–9. ✓
- §6 data model (`model_conversion_error` migration; reuse `model_xkt_url`/`status`; `.xkt` key convention) → Task 4 + `xktKeyFor` in Task 5. ✓
- §7 access control (staff trigger, member-gated client view, public `/media` `.xkt`) → Tasks 5/6/9. ✓
- §8 error handling (failed status + reason, reconvert, re-upload nulls) → Tasks 5/8. ✓
- §9 performance (lazy chunk, desktop notice, xeokit LOD/SAO) → Tasks 7/8. ✓
- §10 ops/deploy → Tasks 3/4 + README. ✓
- §11 phases → mapped 1:1. ✓
- §12 risks (500 MB streaming spike, conversion memory, metadata fidelity) → called out in Task 2 Step 5, Task 3 Step 3 NOTE, and Task 6 Step 4. ✓

**Placeholder scan:** External-artifact items (IfcConvert binary URL, exact xeokit import path/version, the client project file, the `authMiddleware` exemption list location, the `manualChunks` shape) are written as concrete "locate X / pin Y / verify against Z" instructions with the code to add — not vague TODOs. No `add appropriate error handling`-style gaps.

**Type consistency:** `startIfcConversion(env, projectId, modelUrl, origin)`, `xktKeyFor(modelUrl)`, the `/convert` job shape `{key,xktKey,projectId,callbackUrl}`, and the callback shape `{projectId,status,xktKey,error}` are used identically across the container Worker (Task 3), backend lib + routes (Task 5), and DB columns (Tasks 4/6). The frontend `model_conversion_status` union `'converting'|'done'|'failed'|null` matches the backend writes.
