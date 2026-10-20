import { Hono } from 'hono';
import { requireAdmin, requireManager } from '../middleware/auth';
import type { Env, AppVariables } from '../types';

/* ============================================================
 * /api/team-drawing-items — Зургийн жагсаалтын нийтлэг нэмэлт мөрүүд.
 *
 * Баг бүрийн тайлбар бичгийн "Зургийн жагсаалт" хэсгийн үндсэн мөрүүд
 * frontend template.ts-д кодоор; энд зөвхөн НЭМЭЛТ мөрүүд (migration 0121,
 * бүх төсөлд үйлчилнэ). Нэмэх/засах = admin+senior, устгах = admin.
 * `key` нь checkbox хариултын тогтвортой түлхүүр — засварлахад хэвээр.
 * ============================================================ */

const teamDrawingItems = new Hono<{ Bindings: Env; Variables: AppVariables }>();

interface ItemRow {
  id: number;
  team_code: string;
  key: string;
  label: string;
  position: number;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

// GET /api/team-drawing-items — бүх багийн нэмэлт мөрүүд (бүх ажилтан).
teamDrawingItems.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, team_code, key, label, position FROM team_drawing_items ORDER BY team_code, position, id',
  ).all<ItemRow>();
  return c.json({ items: results ?? [] });
});

// POST /api/team-drawing-items — мөр нэмэх (admin+senior).
teamDrawingItems.post('/', requireManager(), async (c) => {
  const body = await c.req.json<{ team_code?: string; label?: string }>().catch(
    () => ({}) as { team_code?: string; label?: string },
  );
  const teamCode = str(body.team_code).toUpperCase();
  const label = str(body.label);
  if (!/^[A-Z]{2,8}$/.test(teamCode)) return c.json({ error: 'Invalid team_code' }, 400);
  if (!label) return c.json({ error: 'label is required' }, 400);

  const maxRow = await c.env.DB.prepare(
    'SELECT MAX(position) AS max_pos FROM team_drawing_items WHERE team_code = ?',
  )
    .bind(teamCode)
    .first<{ max_pos: number | null }>();
  const position = (maxRow?.max_pos ?? 0) + 10;
  const key = `dl_custom_${crypto.randomUUID().slice(0, 8)}`;

  const row = await c.env.DB.prepare(
    `INSERT INTO team_drawing_items (team_code, key, label, position)
     VALUES (?, ?, ?, ?) RETURNING id, team_code, key, label, position`,
  )
    .bind(teamCode, key, label, position)
    .first<ItemRow>();
  if (!row) return c.json({ error: 'Insert failed' }, 500);
  return c.json({ item: row }, 201);
});

// PATCH /api/team-drawing-items/:id — нэр засах (admin+senior; key immutable).
teamDrawingItems.patch('/:id', requireManager(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<{ label?: string }>().catch(() => ({}) as { label?: string });
  const label = str(body.label);
  if (!label) return c.json({ error: 'label is required' }, 400);

  const row = await c.env.DB.prepare(
    `UPDATE team_drawing_items SET label = ? WHERE id = ?
     RETURNING id, team_code, key, label, position`,
  )
    .bind(label, id)
    .first<ItemRow>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json({ item: row });
});

// DELETE /api/team-drawing-items/:id — мөр устгах (admin).
teamDrawingItems.delete('/:id', requireAdmin(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
  await c.env.DB.prepare('DELETE FROM team_drawing_items WHERE id = ?').bind(id).run();
  return c.json({ message: 'Deleted' });
});

export default teamDrawingItems;
