import { Hono } from 'hono';
import { ROOT_PROTECTED_MESSAGE, protectedRootsIn, purgeEmptyRoots } from '../lib/taskRootGuard';
import { requireRole, requireManager } from '../middleware/auth';
import type { Env, AppVariables, ComponentRow, CreateComponentRequest } from '../types';

const components = new Hono<{ Bindings: Env; Variables: AppVariables }>();

components.get('/', async (c) => {
  const drawingId = c.req.query('drawing_id');
  if (!drawingId) return c.json({ error: 'drawing_id required' }, 400);

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM components WHERE drawing_id = ? ORDER BY sort_order',
  )
    .bind(parseInt(drawingId, 10))
    .all<ComponentRow>();

  return c.json({ components: results });
});

components.post('/', requireManager(), async (c) => {
  const body = await c.req.json<CreateComponentRequest>();
  if (!body.name || body.drawing_id === undefined || body.weight_percent === undefined) {
    return c.json({ error: 'name, drawing_id, weight_percent required' }, 400);
  }

  const maxOrder = await c.env.DB.prepare(
    'SELECT MAX(sort_order) as max_order FROM components WHERE drawing_id = ?',
  )
    .bind(body.drawing_id)
    .first<{ max_order: number | null }>();

  const result = await c.env.DB.prepare(
    'INSERT INTO components (drawing_id, name, weight_percent, sort_order) VALUES (?, ?, ?, ?) RETURNING id',
  )
    .bind(body.drawing_id, body.name, body.weight_percent, (maxOrder?.max_order ?? -1) + 1)
    .first<{ id: number }>();

  return c.json({ message: 'Component created', id: result?.id }, 201);
});

/* Reorder components within a single drawing. Mirrors `tasks.put('/reorder')`:
 * ordered id array → sort_order = (i+1)*10, scoped by drawing_id so a
 * stray id from a sibling drawing can never be touched. MUST stay
 * registered ABOVE `components.put('/:id')` — otherwise '/reorder' would
 * be swallowed by the `:id` param route (id = "reorder" → NaN). */
components.put('/reorder', requireManager(), async (c) => {
  type Body = { drawing_id?: number; component_ids?: number[] };
  const body = await c.req.json<Body>().catch(() => ({}) as Body);
  const drawingId = body.drawing_id;
  const ids = Array.isArray(body.component_ids) ? body.component_ids : [];
  if (drawingId === undefined || ids.length === 0) {
    return c.json({ error: 'drawing_id and component_ids required' }, 400);
  }
  const stmt = c.env.DB.prepare(
    'UPDATE components SET sort_order = ? WHERE id = ? AND drawing_id = ?',
  );
  await c.env.DB.batch(ids.map((id, i) => stmt.bind((i + 1) * 10, id, drawingId)));
  return c.json({ message: 'reordered' });
});

components.put('/:id', requireManager(), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const body = await c.req.json<Partial<CreateComponentRequest>>();
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
  if (updates.length === 0) return c.json({ error: 'No fields to update' }, 400);
  values.push(id);

  await c.env.DB.prepare(`UPDATE components SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
  return c.json({ message: 'Component updated' });
});

components.delete('/:id', requireManager(), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  // Хуваарилагдсан таскийн түүхийг (хийсэн хэсэг, оноо, цаг) cascade-аар чимээгүй устгахгүй — ямар ч цэвэрлэгээнээс ӨМНӨ.
  const protectedRoots = await protectedRootsIn(c.env.DB, { kind: 'component', id });
  if (protectedRoots.length > 0) {
    return c.json({ error: 'ROOT_PROTECTED', message: ROOT_PROTECTED_MESSAGE, task_ids: protectedRoots }, 409);
  }
  await purgeEmptyRoots(c.env.DB, { kind: 'component', id });
  await c.env.DB.prepare('DELETE FROM components WHERE id = ?').bind(id).run();
  return c.json({ message: 'Component deleted' });
});

export default components;
