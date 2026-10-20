import { Hono } from 'hono';
import { ROOT_PROTECTED_MESSAGE, protectedRootsIn, purgeEmptyRoots } from '../lib/taskRootGuard';
import { requireRole, requireManager } from '../middleware/auth';
import { reconcileCreditOrEnqueue } from '../lib/taskCreditReconcileQueue';
import type { Env, AppVariables, DrawingRow, CreateDrawingRequest } from '../types';

const drawings = new Hono<{ Bindings: Env; Variables: AppVariables }>();

async function projectsOfDrawing(db: D1Database, drawingId: number): Promise<number[]> {
  const row = await db
    .prepare('SELECT b.project_id FROM drawings d JOIN blocks b ON b.id = d.block_id WHERE d.id = ?')
    .bind(drawingId)
    .first<{ project_id: number }>();
  return row ? [row.project_id] : [];
}

drawings.get('/', async (c) => {
  const blockId = c.req.query('block_id');
  if (!blockId) return c.json({ error: 'block_id required' }, 400);

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM drawings WHERE block_id = ? ORDER BY sort_order',
  )
    .bind(parseInt(blockId, 10))
    .all<DrawingRow>();

  return c.json({ drawings: results });
});

drawings.post('/', requireManager(), async (c) => {
  const body = await c.req.json<CreateDrawingRequest>();
  if (!body.name || body.block_id === undefined || body.weight_percent === undefined) {
    return c.json({ error: 'name, block_id, weight_percent required' }, 400);
  }

  const maxOrder = await c.env.DB.prepare(
    'SELECT MAX(sort_order) as max_order FROM drawings WHERE block_id = ?',
  )
    .bind(body.block_id)
    .first<{ max_order: number | null }>();

  const result = await c.env.DB.prepare(
    'INSERT INTO drawings (block_id, name, weight_percent, sort_order) VALUES (?, ?, ?, ?) RETURNING id',
  )
    .bind(body.block_id, body.name, body.weight_percent, (maxOrder?.max_order ?? -1) + 1)
    .first<{ id: number }>();

  return c.json({ message: 'Drawing created', id: result?.id }, 201);
});

/* Reorder drawings within a single block. Mirrors `tasks.put('/reorder')`:
 * ordered id array → sort_order = (i+1)*10, scoped by block_id so a stray
 * id from a sibling block can never be touched. MUST stay registered
 * ABOVE `drawings.put('/:id')` — otherwise '/reorder' would be swallowed
 * by the `:id` param route (id = "reorder" → NaN). */
drawings.put('/reorder', requireManager(), async (c) => {
  type Body = { block_id?: number; drawing_ids?: number[] };
  const body = await c.req.json<Body>().catch(() => ({}) as Body);
  const blockId = body.block_id;
  const ids = Array.isArray(body.drawing_ids) ? body.drawing_ids : [];
  if (blockId === undefined || ids.length === 0) {
    return c.json({ error: 'block_id and drawing_ids required' }, 400);
  }
  const stmt = c.env.DB.prepare(
    'UPDATE drawings SET sort_order = ? WHERE id = ? AND block_id = ?',
  );
  await c.env.DB.batch(ids.map((id, i) => stmt.bind((i + 1) * 10, id, blockId)));
  return c.json({ message: 'reordered' });
});

drawings.put('/:id', requireManager(), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const body = await c.req.json<Partial<CreateDrawingRequest>>();
  const updates: string[] = [];
  const values: (string | number)[] = [];

  if (body.name) {
    updates.push('name = ?');
    values.push(body.name);
  }
  if (body.weight_percent !== undefined) {
    updates.push('weight_percent = ?');
    values.push(body.weight_percent);
  }
  // block_id can be reassigned (used by the "consolidate legacy blocks"
  // flow that moves every drawing from secondary blocks into the
  // team's single container block before deleting the empties).
  if (body.block_id !== undefined && Number.isFinite(body.block_id)) {
    updates.push('block_id = ?');
    values.push(body.block_id);
  }
  if (updates.length === 0) return c.json({ error: 'No fields to update' }, 400);
  values.push(id);

  // Өөрчлөхөөс ӨМНӨ төслүүд (блок солигдвол хоёр төсөл хөндөгдөнө) — managed оноог шинэ коэффициентээр тулгахад.
  const beforeProjects = await projectsOfDrawing(c.env.DB, id);
  await c.env.DB.prepare(`UPDATE drawings SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
  if (body.weight_percent !== undefined || body.block_id !== undefined) {
    // Унавал төсөл бүр `task_credit_reconcile_queue`-д үлдэж cron дахин оролдоно (lib/taskCreditReconcileQueue.ts).
    const after = await projectsOfDrawing(c.env.DB, id).catch(() => [] as number[]);
    const projects = new Set<number>([...beforeProjects, ...after]);
    for (const pid of projects) await reconcileCreditOrEnqueue(c.env.DB, 'project', pid, c.get('user').sub);
  }
  return c.json({ message: 'Drawing updated' });
});

drawings.delete('/:id', requireManager(), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const protectedRoots = await protectedRootsIn(c.env.DB, { kind: 'drawing', id });
  if (protectedRoots.length > 0) {
    return c.json({ error: 'ROOT_PROTECTED', message: ROOT_PROTECTED_MESSAGE, task_ids: protectedRoots }, 409);
  }
  await purgeEmptyRoots(c.env.DB, { kind: 'drawing', id });
  await c.env.DB.prepare('DELETE FROM drawings WHERE id = ?').bind(id).run();
  return c.json({ message: 'Drawing deleted' });
});

export default drawings;
