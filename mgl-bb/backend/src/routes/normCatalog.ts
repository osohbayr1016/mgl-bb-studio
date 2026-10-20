import { Hono } from 'hono';
import { requireAdmin, requireManager } from '../middleware/auth';
import type { Env, AppVariables } from '../types';

/* =============================================================
 * /api/norm-catalog — Норм дүрмийн нийтлэг каталог (CRUD).
 * -------------------------------------------------------------
 * Өмнө нь frontend catalog.ts-д статик массив байсныг DB рүү шилжүүлэв.
 * Бүх төсөлд нэг каталог: admin нэмэх/устгах, senior (+admin) засах.
 * Төслийн "аль нормыг сонгосон" гэдэг нь project_team_reports
 * (team_code='NORM')-д хэвээр — энэ route түүнийг ХӨНДӨХГҮЙ.
 *
 * norm_items.key нь checkbox-ийн ТОГТВОРТОЙ түлхүүр (хадгалсан сонголтын
 * холбоос) тул засахад өөрчлөгддөггүй; шинэ норм үүсгэхэд сервер тогтвортой
 * key гаргана.
 * ============================================================= */

const normCatalog = new Hono<{ Bindings: Env; Variables: AppVariables }>();

interface CategoryRow {
  id: number;
  key: string;
  title: string;
  position: number;
}
interface ItemRow {
  id: number;
  key: string;
  code: string;
  title: string;
  category_id: number;
  position: number;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

// GET /api/norm-catalog — бүх ажилтан: ангилал + норм угсарсан каталог.
normCatalog.get('/', async (c) => {
  const [{ results: cats }, { results: items }] = await Promise.all([
    c.env.DB.prepare(
      'SELECT id, key, title, position FROM norm_categories ORDER BY position, id',
    ).all<CategoryRow>(),
    c.env.DB.prepare(
      'SELECT id, key, code, title, category_id, position FROM norm_items ORDER BY position, id',
    ).all<ItemRow>(),
  ]);

  const byCat = new Map<number, ItemRow[]>();
  for (const it of items ?? []) {
    const arr = byCat.get(it.category_id);
    if (arr) arr.push(it);
    else byCat.set(it.category_id, [it]);
  }

  const catalog = (cats ?? []).map((cat) => ({
    id: cat.id,
    key: cat.key,
    title: cat.title,
    items: (byCat.get(cat.id) ?? []).map((it) => ({
      id: it.id,
      key: it.key,
      code: it.code,
      title: it.title,
    })),
  }));

  return c.json({ catalog });
});

// ── Items ─────────────────────────────────────────────────────
// POST /api/norm-catalog/items — норм нэмэх (admin).
normCatalog.post('/items', requireAdmin(), async (c) => {
  const body = await c.req.json<{ category_id?: number; code?: string; title?: string }>().catch(
    () => ({}) as { category_id?: number; code?: string; title?: string },
  );
  const categoryId = Number(body.category_id);
  const code = str(body.code);
  const title = str(body.title);
  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    return c.json({ error: 'category_id is required' }, 400);
  }
  if (!code) return c.json({ error: 'code is required' }, 400);
  if (!title) return c.json({ error: 'title is required' }, 400);

  const cat = await c.env.DB.prepare('SELECT id FROM norm_categories WHERE id = ?')
    .bind(categoryId)
    .first<{ id: number }>();
  if (!cat) return c.json({ error: 'Category not found' }, 404);

  const maxRow = await c.env.DB.prepare(
    'SELECT MAX(position) AS max_pos FROM norm_items WHERE category_id = ?',
  )
    .bind(categoryId)
    .first<{ max_pos: number | null }>();
  const position = (maxRow?.max_pos ?? 0) + 10;
  const key = `norm_c_${crypto.randomUUID().slice(0, 8)}`;

  const row = await c.env.DB.prepare(
    `INSERT INTO norm_items (key, code, title, category_id, position)
     VALUES (?, ?, ?, ?, ?) RETURNING id, key, code, title, category_id, position`,
  )
    .bind(key, code, title, categoryId, position)
    .first<ItemRow>();
  if (!row) return c.json({ error: 'Insert failed' }, 500);
  return c.json({ item: row }, 201);
});

// PATCH /api/norm-catalog/items/:id — норм засах (admin+senior; key immutable).
normCatalog.patch('/items/:id', requireManager(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<{ code?: string; title?: string; category_id?: number }>().catch(
    () => ({}) as { code?: string; title?: string; category_id?: number },
  );

  const existing = await c.env.DB.prepare(
    'SELECT id, key, code, title, category_id, position FROM norm_items WHERE id = ?',
  )
    .bind(id)
    .first<ItemRow>();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const code = body.code !== undefined ? str(body.code) : existing.code;
  const title = body.title !== undefined ? str(body.title) : existing.title;
  let categoryId = existing.category_id;
  if (body.category_id !== undefined) {
    categoryId = Number(body.category_id);
    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      return c.json({ error: 'Invalid category_id' }, 400);
    }
    const cat = await c.env.DB.prepare('SELECT id FROM norm_categories WHERE id = ?')
      .bind(categoryId)
      .first<{ id: number }>();
    if (!cat) return c.json({ error: 'Category not found' }, 404);
  }
  if (!code) return c.json({ error: 'code is required' }, 400);
  if (!title) return c.json({ error: 'title is required' }, 400);

  const row = await c.env.DB.prepare(
    `UPDATE norm_items SET code = ?, title = ?, category_id = ?
     WHERE id = ? RETURNING id, key, code, title, category_id, position`,
  )
    .bind(code, title, categoryId, id)
    .first<ItemRow>();
  return c.json({ item: row });
});

// DELETE /api/norm-catalog/items/:id — норм устгах (admin).
normCatalog.delete('/items/:id', requireAdmin(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
  await c.env.DB.prepare('DELETE FROM norm_items WHERE id = ?').bind(id).run();
  return c.json({ message: 'Deleted' });
});

// ── Categories ────────────────────────────────────────────────
// POST /api/norm-catalog/categories — ангилал нэмэх (admin).
normCatalog.post('/categories', requireAdmin(), async (c) => {
  const body = await c.req.json<{ title?: string }>().catch(() => ({}) as { title?: string });
  const title = str(body.title);
  if (!title) return c.json({ error: 'title is required' }, 400);

  const maxRow = await c.env.DB.prepare(
    'SELECT MAX(position) AS max_pos FROM norm_categories',
  ).first<{ max_pos: number | null }>();
  const position = (maxRow?.max_pos ?? 0) + 10;
  const key = `cat_${crypto.randomUUID().slice(0, 8)}`;

  const row = await c.env.DB.prepare(
    `INSERT INTO norm_categories (key, title, position)
     VALUES (?, ?, ?) RETURNING id, key, title, position`,
  )
    .bind(key, title, position)
    .first<CategoryRow>();
  if (!row) return c.json({ error: 'Insert failed' }, 500);
  return c.json({ category: { ...row, items: [] } }, 201);
});

// PATCH /api/norm-catalog/categories/:id — ангилал нэр засах (admin+senior).
normCatalog.patch('/categories/:id', requireManager(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<{ title?: string }>().catch(() => ({}) as { title?: string });
  const title = str(body.title);
  if (!title) return c.json({ error: 'title is required' }, 400);

  const row = await c.env.DB.prepare(
    `UPDATE norm_categories SET title = ? WHERE id = ?
     RETURNING id, key, title, position`,
  )
    .bind(title, id)
    .first<CategoryRow>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json({ category: row });
});

// DELETE /api/norm-catalog/categories/:id — ангилал устгах (admin, зөвхөн хоосон бол).
normCatalog.delete('/categories/:id', requireAdmin(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
  const count = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM norm_items WHERE category_id = ?',
  )
    .bind(id)
    .first<{ n: number }>();
  if ((count?.n ?? 0) > 0) {
    return c.json({ error: 'Ангилалд норм байгаа тул устгах боломжгүй' }, 409);
  }
  await c.env.DB.prepare('DELETE FROM norm_categories WHERE id = ?').bind(id).run();
  return c.json({ message: 'Deleted' });
});

export default normCatalog;
