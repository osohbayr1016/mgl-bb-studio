import { Hono } from 'hono';
import { requireManager } from '../middleware/auth';
import type { Env, AppVariables } from '../types';

/* =============================================================
 * Per-project team form template overrides.
 * -------------------------------------------------------------
 * Mounted under `/api/projects` so the URLs read
 * `/api/projects/:projectId/team-form-templates/:team_code`.
 * Each row in `project_team_template_overrides` keys by
 * (project_id, team_code).
 *
 * The opaque JSON patch is folded into the hardcoded SectionDef
 * arrays at render time by the frontend resolver — backend doesn't
 * validate field keys.
 * ============================================================= */

const router = new Hono<{ Bindings: Env; Variables: AppVariables }>();

interface OverrideRow {
  project_id: number;
  team_code: string;
  overrides_json: string;
  updated_by_id: number | null;
  updated_at: string;
}

/* Project visibility gate identical to other per-project routes.
 * Clients only see projects they're members of; staff see all. */
async function assertProjectVisible(
  db: D1Database,
  projectId: number,
  userId: number,
  role: string,
): Promise<{ ok: true } | { ok: false; status: 403 | 404; error: string }> {
  const project = await db
    .prepare('SELECT id FROM projects WHERE id = ?')
    .bind(projectId)
    .first<{ id: number }>();
  if (!project) return { ok: false, status: 404, error: 'Project not found' };
  if (role === 'client') {
    const member = await db
      .prepare('SELECT id FROM project_members WHERE project_id = ? AND user_id = ?')
      .bind(projectId, userId)
      .first();
    if (!member) return { ok: false, status: 403, error: 'Access denied' };
  }
  return { ok: true };
}

/* GET /:projectId/team-form-templates — list rows for this project.
 * `?full=1` үед override JSON-ийг нь хамт буцаана (Гүйцэтгэлийн тайлангийн
 * PDF хуудас бүх багийн override-ийг нэг дуудлагаар авахад). */
router.get('/:projectId/team-form-templates', async (c) => {
  const projectId = parseInt(c.req.param('projectId'), 10);
  const user = c.get('user');
  const gate = await assertProjectVisible(c.env.DB, projectId, user.sub, user.role);
  if (!gate.ok) return c.json({ error: gate.error }, gate.status);

  if (c.req.query('full') === '1') {
    const { results } = await c.env.DB.prepare(
      `SELECT team_code, overrides_json, updated_at
         FROM project_team_template_overrides
        WHERE project_id = ?
        ORDER BY team_code`,
    )
      .bind(projectId)
      .all<{ team_code: string; overrides_json: string; updated_at: string }>();
    return c.json({
      project_id: projectId,
      overrides: (results ?? []).map((r) => {
        let overrides: unknown = {};
        try {
          overrides = JSON.parse(r.overrides_json ?? '{}');
        } catch {
          /* ignore malformed rows */
        }
        return { team_code: r.team_code, overrides, updated_at: r.updated_at };
      }),
    });
  }

  const { results } = await c.env.DB.prepare(
    `SELECT team_code, updated_at
       FROM project_team_template_overrides
      WHERE project_id = ?
      ORDER BY team_code`,
  )
    .bind(projectId)
    .all<{ team_code: string; updated_at: string }>();

  return c.json({
    project_id: projectId,
    overrides: (results ?? []).map((r) => ({
      team_code: r.team_code,
      has_overrides: true,
      updated_at: r.updated_at,
    })),
  });
});

/* GET /:projectId/team-form-templates/:team_code */
router.get('/:projectId/team-form-templates/:team_code', async (c) => {
  const projectId = parseInt(c.req.param('projectId'), 10);
  const code = c.req.param('team_code');
  const user = c.get('user');
  const gate = await assertProjectVisible(c.env.DB, projectId, user.sub, user.role);
  if (!gate.ok) return c.json({ error: gate.error }, gate.status);

  const row = await c.env.DB.prepare(
    'SELECT * FROM project_team_template_overrides WHERE project_id = ? AND team_code = ?',
  )
    .bind(projectId, code)
    .first<OverrideRow>();
  let overrides: unknown = {};
  if (row) {
    try {
      overrides = JSON.parse(row.overrides_json ?? '{}');
    } catch {
      /* ignore */
    }
  }
  return c.json({
    project_id: projectId,
    team_code: code,
    overrides,
    updated_at: row?.updated_at ?? null,
  });
});

/* PUT /:projectId/team-form-templates/:team_code — upsert. */
router.put('/:projectId/team-form-templates/:team_code', requireManager(), async (c) => {
  const projectId = parseInt(c.req.param('projectId'), 10);
  const code = c.req.param('team_code');
  const user = c.get('user');
  const exists = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ?')
    .bind(projectId)
    .first();
  if (!exists) return c.json({ error: 'Project not found' }, 404);

  type Body = { overrides?: unknown };
  const body = await c.req.json<Body>().catch(() => ({}) as Body);
  const json = JSON.stringify(body.overrides ?? {});

  await c.env.DB.prepare(
    `INSERT INTO project_team_template_overrides
       (project_id, team_code, overrides_json, updated_by_id, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(project_id, team_code) DO UPDATE SET
       overrides_json = excluded.overrides_json,
       updated_by_id  = excluded.updated_by_id,
       updated_at     = datetime('now')`,
  )
    .bind(projectId, code, json, user.sub)
    .run();

  return c.json({
    project_id: projectId,
    team_code: code,
    overrides: body.overrides ?? {},
  });
});

/* DELETE /:projectId/team-form-templates/:team_code — full reset. */
router.delete('/:projectId/team-form-templates/:team_code', requireManager(), async (c) => {
  const projectId = parseInt(c.req.param('projectId'), 10);
  const code = c.req.param('team_code');
  await c.env.DB.prepare(
    'DELETE FROM project_team_template_overrides WHERE project_id = ? AND team_code = ?',
  )
    .bind(projectId, code)
    .run();
  return c.json({ ok: true });
});

export default router;
