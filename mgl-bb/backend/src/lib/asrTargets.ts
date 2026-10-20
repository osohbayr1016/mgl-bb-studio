import type { Hono } from 'hono';
import { requireAdmin } from '../middleware/auth';
import { getCategoryTeamShares } from '../lib/projectCategories';
import { ASR_CONTRACT_NO_MAX } from '../lib/asrProjectName';
import type { Env, AppVariables } from '../types';

type App = Hono<{ Bindings: Env; Variables: AppVariables }>;

/** ZA ангиллын өгөгдмөл багийн roster — `routes/asrBackfill.ts` ч хэрэглэнэ. */
export async function seedZaShares(db: D1Database, projectId: number) {
  const wanted = getCategoryTeamShares('ZA');
  const lookup = await db
    .prepare(`SELECT id, code FROM teams WHERE code IN (${wanted.map(() => '?').join(',')})`)
    .bind(...wanted.map((w) => w.team_code))
    .all<{ id: number; code: string }>();
  const codeToId = new Map((lookup.results ?? []).map((r) => [r.code, r.id]));
  const rows = wanted.flatMap((w, i) => {
    const team_id = codeToId.get(w.team_code);
    return team_id ? [{ team_id, share_percent: w.share_percent, sort_order: i }] : [];
  });
  if (rows.length === 0) return;
  const stmt = db.prepare(
    `INSERT INTO project_team_shares (project_id, team_id, share_percent, sort_order)
     VALUES (?, ?, ?, ?)`,
  );
  await db.batch(rows.map((r) => stmt.bind(projectId, r.team_id, r.share_percent, r.sort_order)));
}

async function loadTarget(db: D1Database, id: number) {
  return db
    .prepare(
      `SELECT p.id, p.name, p.status, pp.drawing_no AS shifr,
              NULLIF(TRIM(p.asr_contract_no), '') AS contract_no
         FROM projects p
         LEFT JOIN project_passport pp ON pp.project_id = p.id
        WHERE p.id = ? AND COALESCE(p.asr_only, 0) = 1`,
    )
    .bind(id)
    .first<{
      id: number;
      name: string;
      status: string;
      shifr: string | null;
      contract_no: string | null;
    }>();
}

/** Админы ЗХ төсөл — `GET /:id`-ээс ДЭЭР бүртгэнэ. */
export function registerAsrTargetRoutes(router: App) {
  router.get('/targets', requireAdmin(), async (c) => {
    const includeArchived = c.req.query('include_archived') === '1';
    const { results } = await c.env.DB.prepare(
      `SELECT p.id, p.name, p.status, pp.drawing_no AS shifr,
              NULLIF(TRIM(p.asr_contract_no), '') AS contract_no
         FROM projects p
         LEFT JOIN project_passport pp ON pp.project_id = p.id
        WHERE COALESCE(p.asr_only, 0) = 1
          ${includeArchived ? '' : "AND p.status != 'archived'"}
        ORDER BY p.name`,
    ).all();
    return c.json({ items: results ?? [] });
  });

  router.post('/targets', requireAdmin(), async (c) => {
    const user = c.get('user');
    const body = await c.req
      .json<{ name?: string; shifr?: string; contract_no?: string }>()
      .catch(() => ({}) as { name?: string; shifr?: string; contract_no?: string });
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return c.json({ error: 'Нэр оруулна уу.' }, 400);
    const shifr = typeof body.shifr === 'string' ? body.shifr.trim() : '';
    // Төслийн «Гэрээний дугаар» (0365) — энэ төсөл дээрх БҮХ тайлан дагана.
    const contractNo = typeof body.contract_no === 'string' ? body.contract_no.trim() : '';
    if (contractNo.length > ASR_CONTRACT_NO_MAX) {
      return c.json(
        { error: `Гэрээний дугаар ${ASR_CONTRACT_NO_MAX} тэмдэгтээс урт байж болохгүй.` },
        400,
      );
    }

    const ins = await c.env.DB.prepare(
      `INSERT INTO projects (name, category, asr_only, created_by, status, asr_contract_no)
       VALUES (?, 'ZA', 1, ?, 'active', ?)`,
    )
      .bind(name, user.sub, contractNo || null)
      .run();
    const id = Number(ins.meta.last_row_id);
    await seedZaShares(c.env.DB, id);
    if (shifr) {
      await c.env.DB.prepare(
        `INSERT INTO project_passport (project_id, drawing_no, updated_by_id) VALUES (?, ?, ?)`,
      )
        .bind(id, shifr, user.sub)
        .run();
    }
    return c.json({ item: await loadTarget(c.env.DB, id) }, 201);
  });

  router.patch('/targets/:id', requireAdmin(), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
    const existing = await loadTarget(c.env.DB, id);
    if (!existing) return c.json({ error: 'Not found' }, 404);

    const body = await c.req
      .json<{ name?: string; status?: string; shifr?: string | null }>()
      .catch(() => ({}) as { name?: string; status?: string; shifr?: string | null });
    if (typeof body.name === 'string') {
      const name = body.name.trim();
      if (!name) return c.json({ error: 'Нэр оруулна уу.' }, 400);
      await c.env.DB.prepare(`UPDATE projects SET name = ?, updated_at = datetime('now') WHERE id = ?`)
        .bind(name, id)
        .run();
    }
    if (body.status === 'active' || body.status === 'archived') {
      await c.env.DB.prepare(`UPDATE projects SET status = ?, updated_at = datetime('now') WHERE id = ?`)
        .bind(body.status, id)
        .run();
    }
    if (body.shifr !== undefined) {
      const shifr = typeof body.shifr === 'string' ? body.shifr.trim() || null : null;
      await c.env.DB.prepare(
        `INSERT INTO project_passport (project_id, drawing_no, updated_by_id)
         VALUES (?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET drawing_no = excluded.drawing_no, updated_by_id = excluded.updated_by_id, updated_at = datetime('now')`,
      )
        .bind(id, shifr, c.get('user').sub)
        .run();
    }
    return c.json({ item: await loadTarget(c.env.DB, id) });
  });

  router.delete('/targets/:id', requireAdmin(), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
    const existing = await loadTarget(c.env.DB, id);
    if (!existing) return c.json({ error: 'Not found' }, 404);
    const used = await c.env.DB.prepare(
      'SELECT 1 AS x FROM author_supervision_reports WHERE project_id = ? LIMIT 1',
    )
      .bind(id)
      .first();
    if (used) {
      return c.json({ error: 'Тайлантай төслийг устгахгүй. Архивлана уу.' }, 409);
    }
    await c.env.DB.prepare('DELETE FROM project_team_shares WHERE project_id = ?').bind(id).run();
    await c.env.DB.prepare('DELETE FROM project_passport WHERE project_id = ?').bind(id).run();
    await c.env.DB.prepare('DELETE FROM projects WHERE id = ? AND asr_only = 1').bind(id).run();
    return c.json({ ok: true });
  });
}
