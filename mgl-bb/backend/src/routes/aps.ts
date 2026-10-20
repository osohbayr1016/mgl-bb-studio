import { Hono } from 'hono';
import type { Env, AppVariables } from '../types';
import { requireRole } from '../middleware/auth';
import {
  r2KeyFor,
  ensureBucket,
  uploadToOss,
  translate,
  getViewerToken,
} from '../lib/aps';

/* ============================================================================
 * Autodesk Platform Services (APS) — 3D viewer routes (`/api/aps`).
 * ----------------------------------------------------------------------------
 * Replaces the old IFC->.xkt (xeokit) viewer. Staff upload a Revit `.rvt`, which
 * is pushed from R2 to APS OSS and translated to SVF2; the browser renders it
 * with the APS Viewer using a short-lived `viewables:read` token from /token.
 * Translation status is surfaced lazily through GET /api/projects/:id/models
 * (it polls the APS manifest), so there is no public callback here — the whole
 * router stays behind the global authMiddleware. Tools/QTO are untouched.
 * ========================================================================== */

const aps = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/** Object key for an uploaded model version (stable + filesystem-safe). */
function objectKeyFor(projectId: number, versionId: number, fileName?: string | null): string {
  const safe = (fileName || 'model.rvt').replace(/[^A-Za-z0-9._-]+/g, '_');
  return `${projectId}-${versionId}-${safe}`;
}

/** Push the R2 `.rvt` to OSS and kick a SVF2 translation. On any failure the
 *  version row flips to 'failed'. Runs inside the caller's `waitUntil`. */
async function pushAndTranslate(
  env: Env,
  projectId: number,
  versionId: number,
  modelUrl: string,
  fileName?: string | null,
): Promise<void> {
  try {
    const bucket = await ensureBucket(env);
    const obj = await env.MEDIA_BUCKET.get(r2KeyFor(modelUrl));
    if (!obj) throw new Error('Uploaded .rvt not found in storage');
    const key = objectKeyFor(projectId, versionId, fileName);
    const urn = await uploadToOss(env, bucket, key, obj.body, obj.size);
    await env.DB.prepare('UPDATE project_models SET aps_urn = ? WHERE id = ?')
      .bind(urn, versionId)
      .run();
    await translate(env, urn);
    // Leave status='converting'; GET /:id/models flips it from the manifest.
  } catch (e) {
    const msg = String(e).slice(0, 300);
    await env.DB.prepare(
      `UPDATE project_models SET conversion_status='failed', conversion_error=? WHERE id=?`,
    )
      .bind(msg, versionId)
      .run();
  }
}

// GET /api/aps/token?project_id=N — short-lived viewables:read token for the
// browser viewer. Authed (global authMiddleware); clients are member-gated
// exactly like GET /api/projects/:id/models.
aps.get('/token', async (c) => {
  const user = c.get('user');
  if (user.role === 'client') {
    const projectId = parseInt(c.req.query('project_id') ?? '', 10);
    if (!Number.isFinite(projectId)) return c.json({ error: 'project_id is required' }, 400);
    const member = await c.env.DB.prepare(
      'SELECT id FROM project_members WHERE project_id = ? AND user_id = ?',
    )
      .bind(projectId, user.sub)
      .first();
    if (!member) return c.json({ error: 'Access denied' }, 403);
  }
  try {
    const tok = await getViewerToken(c.env);
    return c.json({ access_token: tok.access_token, expires_in: tok.expires_in });
  } catch (e) {
    return c.json({ error: String(e).slice(0, 300) }, 502);
  }
});

// PUT /api/aps/projects/:id/model — admin+senior. Register a new .rvt version
// and kick its OSS upload + SVF2 translation. Body { model_url, file_name?, file_size? }.
aps.put('/projects/:id/model', requireRole('admin', 'senior'), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid project id' }, 400);

  const body = await c.req.json<{
    model_url?: string | null;
    file_name?: string | null;
    file_size?: number | null;
  }>();
  const modelUrl = typeof body.model_url === 'string' ? body.model_url.trim() : '';
  if (!modelUrl) return c.json({ error: 'model_url is required' }, 400);
  if (!/\.rvt$/i.test(modelUrl)) return c.json({ error: 'Only .rvt files are supported' }, 400);
  const user = c.get('user');
  const fileName = typeof body.file_name === 'string' ? body.file_name : null;

  const project = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ?')
    .bind(id)
    .first<{ id: number }>();
  if (!project) return c.json({ error: 'Project not found' }, 404);

  // History: each upload is a retained, dated version translated by APS.
  const res = await c.env.DB.prepare(
    `INSERT INTO project_models
       (project_id, model_url, conversion_status, model_format, file_name, file_size, uploaded_by)
     VALUES (?, ?, 'converting', 'rvt', ?, ?, ?)`,
  )
    .bind(id, modelUrl, fileName, typeof body.file_size === 'number' ? body.file_size : null, user.sub)
    .run();
  const versionId = res.meta.last_row_id as number;

  c.executionCtx.waitUntil(pushAndTranslate(c.env, id, versionId, modelUrl, fileName));

  return c.json({ message: 'Model upload started', version_id: versionId });
});

// POST /api/aps/projects/:id/reconvert?version=<id> — admin+senior retry of a
// version (default: latest). Re-translates the existing URN, or re-pushes from
// R2 if the upload never produced one.
aps.post('/projects/:id/reconvert', requireRole('admin', 'senior'), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid project id' }, 400);
  const versionParam = c.req.query('version');
  const versionId = versionParam ? parseInt(versionParam, 10) : NaN;
  const ver = Number.isFinite(versionId)
    ? await c.env.DB.prepare(
        'SELECT id, model_url, aps_urn FROM project_models WHERE id = ? AND project_id = ?',
      )
        .bind(versionId, id)
        .first<{ id: number; model_url: string; aps_urn: string | null }>()
    : await c.env.DB.prepare(
        `SELECT id, model_url, aps_urn FROM project_models
          WHERE project_id = ? AND model_format = 'rvt'
          ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
        .bind(id)
        .first<{ id: number; model_url: string; aps_urn: string | null }>();
  if (!ver?.model_url) return c.json({ error: 'No model version to convert' }, 400);

  await c.env.DB.prepare(
    `UPDATE project_models SET conversion_status='converting', conversion_error=NULL WHERE id = ?`,
  )
    .bind(ver.id)
    .run();

  if (ver.aps_urn) {
    const urn = ver.aps_urn;
    c.executionCtx.waitUntil(
      translate(c.env, urn).catch(async (e) => {
        await c.env.DB.prepare(
          `UPDATE project_models SET conversion_status='failed', conversion_error=? WHERE id=?`,
        )
          .bind(String(e).slice(0, 300), ver.id)
          .run();
      }),
    );
  } else {
    c.executionCtx.waitUntil(pushAndTranslate(c.env, id, ver.id, ver.model_url, null));
  }
  return c.json({ message: 'Reconversion started' });
});

export default aps;
