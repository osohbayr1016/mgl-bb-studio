import { Hono } from 'hono';
import { requireAdmin } from '../middleware/auth';
import type { Env, AppVariables } from '../types';

/* =============================================================
 * Тайлангийн загвар — reusable report templates.
 * -------------------------------------------------------------
 * Mirrors the per-report block CRUD in performanceReports.ts but
 * the parent is a freestanding `report_templates` row (not bound
 * to a project). When the user picks a template at report
 * creation time, the report's POST handler copies the template's
 * blocks into project_performance_report_blocks verbatim.
 * ============================================================= */

const reportTemplates = new Hono<{ Bindings: Env; Variables: AppVariables }>();

interface TemplateRow {
  id: number;
  name: string;
  description: string | null;
  is_default: number;
  team_code: string | null;
  created_by_id: number | null;
  created_at: string;
  updated_at: string;
}

interface TemplateBlockRow {
  id: number;
  template_id: number;
  type: string;
  position: number;
  content_json: string;
  hidden: number;
  created_at: string;
  updated_at: string;
}

function hydrateTemplate(row: TemplateRow): Omit<TemplateRow, 'is_default'> & {
  is_default: boolean;
} {
  const { is_default, ...rest } = row;
  return { ...rest, is_default: is_default === 1 };
}

function hydrateBlock(row: TemplateBlockRow): Omit<TemplateBlockRow, 'content_json' | 'hidden'> & {
  content: unknown;
  hidden: boolean;
} {
  const { content_json, hidden, ...rest } = row;
  let content: unknown = {};
  try {
    content = JSON.parse(content_json ?? '{}');
  } catch {
    /* ignore */
  }
  return { ...rest, content, hidden: hidden === 1 };
}

/* GET / — list templates, optionally filtered by team.
 * `?team_code=BA` → returns BA's templates + every firm-wide template
 * (team_code IS NULL) so the team sees their own scope + the shared
 * pool. No param → returns all rows. */
reportTemplates.get('/', async (c) => {
  const teamCode = c.req.query('team_code');
  let sql = `
    SELECT t.*,
           (SELECT COUNT(*) FROM report_template_blocks b WHERE b.template_id = t.id) AS block_count
      FROM report_templates t`;
  const binds: unknown[] = [];
  if (teamCode) {
    sql += ` WHERE t.team_code = ? OR t.team_code IS NULL`;
    binds.push(teamCode);
  }
  sql += ` ORDER BY t.is_default DESC, t.team_code IS NOT NULL DESC, t.created_at DESC`;
  const stmt = c.env.DB.prepare(sql);
  const { results } = await (binds.length > 0 ? stmt.bind(...binds) : stmt).all<
    TemplateRow & { block_count: number }
  >();
  return c.json({
    templates: (results ?? []).map((r) => ({
      ...hydrateTemplate(r),
      block_count: r.block_count,
    })),
  });
});

/* POST / — create a new (empty) template, optionally scoped to a team. */
reportTemplates.post('/', requireAdmin(), async (c) => {
  const user = c.get('user');
  type Body = { name?: string; description?: string; team_code?: string | null };
  const body = await c.req.json<Body>().catch(() => ({}) as Body);
  const name = (body.name ?? '').trim();
  if (!name) return c.json({ error: 'name required' }, 400);
  const description = typeof body.description === 'string' ? body.description : null;
  const teamCode = typeof body.team_code === 'string' && body.team_code ? body.team_code : null;
  const row = await c.env.DB.prepare(
    `
    INSERT INTO report_templates (name, description, team_code, created_by_id)
    VALUES (?, ?, ?, ?)
    RETURNING *
  `,
  )
    .bind(name, description, teamCode, user.sub)
    .first<TemplateRow>();
  if (!row) return c.json({ error: 'Insert failed' }, 500);
  return c.json({ template: { ...hydrateTemplate(row), blocks: [] } }, 201);
});

/* GET /:id — single template plus its ordered blocks. */
reportTemplates.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const row = await c.env.DB.prepare('SELECT * FROM report_templates WHERE id = ?')
    .bind(id)
    .first<TemplateRow>();
  if (!row) return c.json({ error: 'Template not found' }, 404);
  const blocks = await c.env.DB.prepare(
    `SELECT * FROM report_template_blocks
      WHERE template_id = ? ORDER BY position, id`,
  )
    .bind(id)
    .all<TemplateBlockRow>();
  return c.json({
    template: {
      ...hydrateTemplate(row),
      blocks: (blocks.results ?? []).map(hydrateBlock),
    },
  });
});

/* PUT /:id — update name / description / is_default.
 * Toggling is_default unsets every other row in the same UPDATE
 * sequence so at most one template carries the default flag. */
reportTemplates.put('/:id', requireAdmin(), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  type Body = {
    name?: string;
    description?: string | null;
    is_default?: boolean;
    team_code?: string | null;
  };
  const body = await c.req.json<Body>().catch(() => ({}) as Body);
  const existing = await c.env.DB.prepare('SELECT * FROM report_templates WHERE id = ?')
    .bind(id)
    .first<TemplateRow>();
  if (!existing) return c.json({ error: 'Template not found' }, 404);

  const newName = body.name !== undefined ? body.name.trim() : existing.name;
  if (!newName) return c.json({ error: 'name required' }, 400);
  const newDesc = body.description !== undefined ? body.description : existing.description;
  // Treat empty string ("") as the firm-wide marker (null).
  const newTeamCode =
    body.team_code !== undefined
      ? body.team_code && body.team_code.length > 0
        ? body.team_code
        : null
      : existing.team_code;

  if (body.is_default === true) {
    // Atomic-ish: clear all defaults, then set this one.
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE report_templates SET is_default = 0 WHERE is_default = 1'),
      c.env.DB.prepare(
        `UPDATE report_templates
            SET name = ?, description = ?, team_code = ?, is_default = 1, updated_at = datetime('now')
          WHERE id = ?`,
      ).bind(newName, newDesc, newTeamCode, id),
    ]);
  } else {
    const newDefault = body.is_default === false ? 0 : existing.is_default;
    await c.env.DB.prepare(
      `UPDATE report_templates
          SET name = ?, description = ?, team_code = ?, is_default = ?, updated_at = datetime('now')
        WHERE id = ?`,
    )
      .bind(newName, newDesc, newTeamCode, newDefault, id)
      .run();
  }

  const updated = await c.env.DB.prepare('SELECT * FROM report_templates WHERE id = ?')
    .bind(id)
    .first<TemplateRow>();
  return c.json({ template: updated ? hydrateTemplate(updated) : null });
});

/* DELETE /:id — cascades the blocks. */
reportTemplates.delete('/:id', requireAdmin(), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  await c.env.DB.prepare('DELETE FROM report_templates WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

/* POST /seed-default — materialize the hardcoded default block list
 * (cover / TOC / intro / summary / per-team narrative + stats / all-team-stats)
 * into an editable template row. Idempotent-ish: each call creates a
 * new "Стандарт" template named with a timestamp suffix so repeated
 * calls don't collide. The admin can mark whichever is desired
 * `is_default` afterwards. */
reportTemplates.post('/seed-default', requireAdmin(), async (c) => {
  const user = c.get('user');
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  // Pull every team in the firm registry so the per-team blocks
  // mirror the same default seed the project-side reports get.
  const { results: teamRows } = await c.env.DB.prepare(
    `SELECT code FROM teams ORDER BY sort_order, code`,
  ).all<{ code: string }>();
  const teamCodes = (teamRows ?? []).map((r) => r.code);

  const newRow = await c.env.DB.prepare(
    `INSERT INTO report_templates (name, description, created_by_id)
     VALUES (?, ?, ?)
     RETURNING *`,
  )
    .bind(
      `Стандарт (${stamp})`,
      'Үндсэн загвар: cover · TOC · танилцуулга · хураангуй · багуудын narrative+stats · нэгтгэсэн тойм.',
      user.sub,
    )
    .first<TemplateRow>();
  if (!newRow) return c.json({ error: 'Insert failed' }, 500);

  const blocks: Array<{ type: string; content: object }> = [
    { type: 'cover', content: {} },
    { type: 'toc', content: {} },
    { type: 'project-intro', content: {} },
    { type: 'summary-notes', content: {} },
  ];
  for (const code of teamCodes) {
    blocks.push({ type: 'team-narrative', content: { team_code: code } });
    blocks.push({ type: 'team-stats', content: { team_code: code } });
  }
  blocks.push({ type: 'all-team-stats', content: {} });

  const stmt = c.env.DB.prepare(
    `INSERT INTO report_template_blocks
       (template_id, type, position, content_json)
     VALUES (?, ?, ?, ?)`,
  );
  await c.env.DB.batch(
    blocks.map((b, i) => stmt.bind(newRow.id, b.type, (i + 1) * 10, JSON.stringify(b.content))),
  );
  return c.json({ template: hydrateTemplate(newRow) }, 201);
});

/* POST /seed-client — materialize the LEAN, CLIENT-FACING status report
 * template.  Reuses only client-safe blocks (no per-team narratives, no
 * internal blocks): cover · executive summary (rich-text) · progress+schedule
 * (execution-summary) · per-discipline (all-team-stats) · scope/documents/
 * contacts (project-intro).  Carries NO complexity_pct / points / engineer
 * names — those never appear in these blocks.  Like seed-default, the admin can
 * mark it `is_default` afterwards. See the plan at
 * .claude/plans/for-report-to-client-*.md. */
reportTemplates.post('/seed-client', requireAdmin(), async (c) => {
  const user = c.get('user');
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');

  const newRow = await c.env.DB.prepare(
    `INSERT INTO report_templates (name, description, created_by_id)
     VALUES (?, ?, ?)
     RETURNING *`,
  )
    .bind(
      `Үйлчлүүлэгчийн тайлан (${stamp})`,
      'Үйлчлүүлэгчид зориулсан хураангуй тайлан: нүүр · гүйцэтгэх хураангуй · явц/хуваарь · мэргэжлээр явц · цар хүрээ/баримт/холбоо барих. Дотоод мэдээлэл (оноо, инженерийн нэр, complexity) ОРОХГҮЙ.',
      user.sub,
    )
    .first<TemplateRow>();
  if (!newRow) return c.json({ error: 'Insert failed' }, 500);

  // Lean client-safe block order.  The rich-text seeds the executive summary
  // the admin (or a Claude draft) fills in before issuing the report.
  const blocks: Array<{ type: string; content: object }> = [
    { type: 'cover', content: {} },
    {
      type: 'rich-text',
      content: {
        heading: 'Гүйцэтгэх хураангуй',
        body: 'Төслийн нийт явц (%), хуваарьт нийцэж байгаа эсэх, энэ үед хийгдсэн гол ажил болон дараагийн алхмуудыг 2–5 өгүүлбэрээр энд бичнэ үү.',
      },
    },
    { type: 'execution-summary', content: {} },
    { type: 'all-team-stats', content: {} },
    { type: 'project-intro', content: {} },
  ];

  const stmt = c.env.DB.prepare(
    `INSERT INTO report_template_blocks
       (template_id, type, position, content_json)
     VALUES (?, ?, ?, ?)`,
  );
  await c.env.DB.batch(
    blocks.map((b, i) => stmt.bind(newRow.id, b.type, (i + 1) * 10, JSON.stringify(b.content))),
  );
  return c.json({ template: hydrateTemplate(newRow) }, 201);
});

/* POST /:id/clone — duplicate template + every block under a new name. */
reportTemplates.post('/:id/clone', requireAdmin(), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const user = c.get('user');
  const src = await c.env.DB.prepare('SELECT * FROM report_templates WHERE id = ?')
    .bind(id)
    .first<TemplateRow>();
  if (!src) return c.json({ error: 'Template not found' }, 404);
  const cloneName = `${src.name} (хуулсан)`;
  const newRow = await c.env.DB.prepare(
    `INSERT INTO report_templates (name, description, team_code, created_by_id)
     VALUES (?, ?, ?, ?)
     RETURNING *`,
  )
    .bind(cloneName, src.description, src.team_code, user.sub)
    .first<TemplateRow>();
  if (!newRow) return c.json({ error: 'Clone failed' }, 500);
  const srcBlocks = await c.env.DB.prepare(
    `SELECT * FROM report_template_blocks
      WHERE template_id = ? ORDER BY position, id`,
  )
    .bind(id)
    .all<TemplateBlockRow>();
  if ((srcBlocks.results ?? []).length > 0) {
    const stmt = c.env.DB.prepare(
      `INSERT INTO report_template_blocks
         (template_id, type, position, content_json, hidden)
       VALUES (?, ?, ?, ?, ?)`,
    );
    await c.env.DB.batch(
      (srcBlocks.results ?? []).map((b) =>
        stmt.bind(newRow.id, b.type, b.position, b.content_json, b.hidden),
      ),
    );
  }
  return c.json({ template: hydrateTemplate(newRow) }, 201);
});

/* POST /:id/blocks — add a block. */
reportTemplates.post('/:id/blocks', requireAdmin(), async (c) => {
  const templateId = parseInt(c.req.param('id'), 10);
  type Body = { type?: string; content?: unknown; position?: number };
  const body = await c.req.json<Body>().catch(() => ({}) as Body);
  const type = (body.type ?? '').trim();
  if (!type) return c.json({ error: 'type required' }, 400);
  const maxRow = await c.env.DB.prepare(
    'SELECT MAX(position) AS max_pos FROM report_template_blocks WHERE template_id = ?',
  )
    .bind(templateId)
    .first<{ max_pos: number | null }>();
  const position = body.position ?? (maxRow?.max_pos ?? 0) + 10;
  const content = body.content !== undefined ? body.content : {};
  const row = await c.env.DB.prepare(
    `INSERT INTO report_template_blocks
       (template_id, type, position, content_json)
     VALUES (?, ?, ?, ?)
     RETURNING *`,
  )
    .bind(templateId, type, position, JSON.stringify(content))
    .first<TemplateBlockRow>();
  if (!row) return c.json({ error: 'Insert failed' }, 500);
  return c.json({ block: hydrateBlock(row) }, 201);
});

/* PATCH /:id/blocks/:blockId — update type / content / hidden. */
reportTemplates.patch('/:id/blocks/:blockId', requireAdmin(), async (c) => {
  const templateId = parseInt(c.req.param('id'), 10);
  const blockId = parseInt(c.req.param('blockId'), 10);
  const existing = await c.env.DB.prepare(
    'SELECT * FROM report_template_blocks WHERE id = ? AND template_id = ?',
  )
    .bind(blockId, templateId)
    .first<TemplateBlockRow>();
  if (!existing) return c.json({ error: 'Block not found' }, 404);
  type Body = { type?: string; content?: unknown; hidden?: boolean };
  const body = await c.req.json<Body>().catch(() => ({}) as Body);
  const newType = body.type !== undefined ? body.type : existing.type;
  const newContent =
    body.content !== undefined ? JSON.stringify(body.content) : existing.content_json;
  const newHidden = body.hidden !== undefined ? (body.hidden ? 1 : 0) : existing.hidden;
  const updated = await c.env.DB.prepare(
    `UPDATE report_template_blocks
        SET type = ?, content_json = ?, hidden = ?, updated_at = datetime('now')
      WHERE id = ? AND template_id = ?
      RETURNING *`,
  )
    .bind(newType, newContent, newHidden, blockId, templateId)
    .first<TemplateBlockRow>();
  if (!updated) return c.json({ error: 'Update failed' }, 500);
  return c.json({ block: hydrateBlock(updated) });
});

/* DELETE /:id/blocks/:blockId */
reportTemplates.delete('/:id/blocks/:blockId', requireAdmin(), async (c) => {
  const templateId = parseInt(c.req.param('id'), 10);
  const blockId = parseInt(c.req.param('blockId'), 10);
  await c.env.DB.prepare('DELETE FROM report_template_blocks WHERE id = ? AND template_id = ?')
    .bind(blockId, templateId)
    .run();
  return c.json({ ok: true });
});

/* PUT /:id/blocks/reorder — rewrite positions to (i+1)*10. */
reportTemplates.put('/:id/blocks/reorder', requireAdmin(), async (c) => {
  const templateId = parseInt(c.req.param('id'), 10);
  type Body = { block_ids?: number[] };
  const body = await c.req.json<Body>().catch(() => ({}) as Body);
  const ids = Array.isArray(body.block_ids) ? body.block_ids : [];
  if (ids.length === 0) return c.json({ error: 'block_ids required' }, 400);
  const stmt = c.env.DB.prepare(
    `UPDATE report_template_blocks
        SET position = ?, updated_at = datetime('now')
      WHERE id = ? AND template_id = ?`,
  );
  await c.env.DB.batch(ids.map((id, i) => stmt.bind((i + 1) * 10, id, templateId)));
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM report_template_blocks
      WHERE template_id = ? ORDER BY position, id`,
  )
    .bind(templateId)
    .all<TemplateBlockRow>();
  return c.json({ blocks: (results ?? []).map(hydrateBlock) });
});

export default reportTemplates;
