import { Hono } from 'hono';
import type { Env, AppVariables } from '../types';
import { requireRole } from '../middleware/auth';
import { findWeightHeir, loadRootSplitInfo, splitTaskIntoRoots, undoRootSplit } from '../lib/taskRootSplitStore';

/**
 * ТАСКИЙГ ҮНДСЭН ТАСКУУД БОЛГОН ХУВААХ (✂) — `/api/tasks`-ийн нэг mount (эзэн 2026-10-09, migration 0395).
 *
 *   GET  /:id/root-split             — цонхны өгөгдөл: таск, хуваах боломж, урьдчилан бөглөх мөрүүд, сүүлийн хуваалт + буцааж болох эсэх.
 *   POST /:id/root-split             — {request_id, parts:[{name, share_units}]} — нэр + хувиар ЖИНХЭНЭ шинэ таскууд.
 *   POST /root-splits/:splitId/undo  — {request_id} — хуваалтыг буцаана (шинэ таскууд дээр ажил эхлээгүй үед).
 *   GET  /:id/delete-preview         — устгахаас өмнө: таскийн жин + ✂ хэсэг бол жин буцах таск (admin/senior, 2026-10-12).
 *
 * Дүрэм: `lib/taskRootSplit.ts` (цэвэр), `lib/taskRootSplitStore.ts` (D1).  Бүх ажилтан (admin/senior/engineer/architect).
 * Хуваарилалтын хаалга (`taskAllocContract`) энд ХАМААРАХГҮЙ — энэ нь хуваарилалт биш, таскийн бүтэц.
 */
const taskRootSplit = new Hono<{ Bindings: Env; Variables: AppVariables }>();

const STAFF = requireRole('admin', 'senior', 'engineer', 'architect');

const taskIdOf = (raw: string): number | null => {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
};

taskRootSplit.get('/:id/root-split', STAFF, async (c) => {
  const id = taskIdOf(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid task id' }, 400);
  const r = await loadRootSplitInfo(c.env.DB, c.get('user'), id);
  if ('ok' in r && r.ok === false) return c.json(r, r.status);
  return c.json(r, 200, { 'Cache-Control': 'private, no-store' });
});

taskRootSplit.post('/:id/root-split', STAFF, async (c) => {
  const id = taskIdOf(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid task id' }, 400);
  const body = (await c.req.json().catch(() => ({}))) as { request_id?: unknown; parts?: unknown };
  const r = await splitTaskIntoRoots(c.env.DB, c.get('user'), id, { requestId: body.request_id, parts: body.parts });
  if (!r.ok) return c.json(r, r.status);
  return c.json(r, r.replayed ? 200 : 201);
});

// Устгах цонхонд «жин нь X руу буцна» гэж урьдчилж хэлэхэд.  Устгах эрхтэй ижил (`DELETE /tasks/:id` = requireManager).
taskRootSplit.get('/:id/delete-preview', requireRole('admin', 'senior'), async (c) => {
  const id = taskIdOf(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid task id' }, 400);
  const t = await c.env.DB.prepare('SELECT id, name, weight_percent FROM tasks WHERE id = ?')
    .bind(id)
    .first<{ id: number; name: string; weight_percent: number }>();
  if (!t) return c.json({ error: 'Task not found', code: 'NOT_FOUND' }, 404);
  const heir = await findWeightHeir(c.env.DB, id);
  return c.json(
    { task_id: t.id, weight: Number(t.weight_percent), weight_merged_into: heir ? { id: heir.heir_id, name: heir.heir_name } : null },
    200,
    { 'Cache-Control': 'private, no-store' },
  );
});

taskRootSplit.post('/root-splits/:splitId/undo', STAFF, async (c) => {
  const id = taskIdOf(c.req.param('splitId'));
  if (id === null) return c.json({ error: 'Invalid split id' }, 400);
  const body = (await c.req.json().catch(() => ({}))) as { request_id?: unknown };
  const r = await undoRootSplit(c.env.DB, c.get('user'), id, body.request_id);
  if (!r.ok) return c.json(r, r.status);
  return c.json(r);
});

export default taskRootSplit;
