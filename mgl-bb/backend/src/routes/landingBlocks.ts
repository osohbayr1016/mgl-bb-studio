/**
 * Landing CMS v2 — block-based page builder.
 *
 * A "page" is `landing_pages` (slug='home' or 'work/<id>'); each page owns an
 * ordered list of `landing_blocks` rows. Block content is a JSON blob whose
 * shape varies by `type` — see frontend/src/types/landingBlocks.ts for the
 * discriminated union and runtime validator. The backend treats `content`
 * as opaque JSON and lets the frontend validate.
 *
 * Routes:
 *   GET    /api/landing/v2/public         — unauth; ?slug=home (or work/<id>)
 *   GET    /api/landing/v2/public/index   — unauth; project-page list for prev/next
 *   GET    /api/landing/v2/admin/pages    — admin; list all pages
 *   GET    /api/landing/v2/admin/pages/:id — admin; page + blocks
 *   POST   /api/landing/v2/admin/pages    — admin; create page
 *   PATCH  /api/landing/v2/admin/pages/:id — admin; update page
 *   DELETE /api/landing/v2/admin/pages/:id — admin; delete (refuses 'home')
 *   POST   /api/landing/v2/admin/pages/:id/blocks    — admin; create block
 *   PATCH  /api/landing/v2/admin/blocks/:id          — admin; update block
 *   DELETE /api/landing/v2/admin/blocks/:id          — admin; delete block
 *   PUT    /api/landing/v2/admin/pages/:id/reorder   — admin; rewrite positions
 *
 * Cache: public reads are served with `max-age=60, stale-while-revalidate=300`
 * unless `?preview=1` is set (admins editing). Every admin write busts the
 * edge cache entry for the affected slug.
 */

import { Hono } from 'hono';
import { requireAdmin } from '../middleware/auth';
import { bustEdgeCache } from '../lib/edgeCache';
import type { Env, AppVariables } from '../types';

const router = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/* ------------------------------------------------------------------ */
/*  Types (DB row shapes)                                              */
/* ------------------------------------------------------------------ */

interface PageRow {
  id: number;
  slug: string;
  kind: 'home' | 'project';
  title_mn: string;
  title_en: string;
  meta_json: string;
  published: number;
  created_at: string;
  updated_at: string;
  updated_by: number | null;
}

interface BlockRow {
  id: number;
  page_id: number;
  type: string;
  position: number;
  content: string; // JSON-encoded
  hidden: number;
  created_at: string;
  updated_at: string;
}

interface BlockApi {
  id: number;
  page_id: number;
  type: string;
  position: number;
  content: unknown; // parsed
  hidden: number;
  created_at: string;
  updated_at: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function blockRowToApi(row: BlockRow): BlockApi {
  return {
    id: row.id,
    page_id: row.page_id,
    type: row.type,
    position: row.position,
    content: safeParseJson(row.content),
    hidden: row.hidden,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function getPageBySlug(db: D1Database, slug: string): Promise<PageRow | null> {
  return await db.prepare('SELECT * FROM landing_pages WHERE slug = ?').bind(slug).first<PageRow>();
}

async function getPageById(db: D1Database, id: number): Promise<PageRow | null> {
  return await db.prepare('SELECT * FROM landing_pages WHERE id = ?').bind(id).first<PageRow>();
}

async function listBlocksForPage(db: D1Database, pageId: number): Promise<BlockApi[]> {
  const res = await db
    .prepare('SELECT * FROM landing_blocks WHERE page_id = ? ORDER BY position, id')
    .bind(pageId)
    .all<BlockRow>();
  return (res.results ?? []).map(blockRowToApi);
}

function isPreviewRequest(c: { req: { query: (k: string) => string | undefined } }): boolean {
  return c.req.query('preview') === '1';
}

/* ------------------------------------------------------------------ */
/*  Public read                                                        */
/* ------------------------------------------------------------------ */

router.get('/public', async (c) => {
  const slug = (c.req.query('slug') ?? 'home').trim() || 'home';
  const page = await getPageBySlug(c.env.DB, slug);
  if (!page || page.published !== 1) {
    return c.json({ error: 'not found' }, 404);
  }

  const blocks = await listBlocksForPage(c.env.DB, page.id);

  // Edge cache for public visitors, but admins editing inside a preview
  // iframe ask for `?preview=1` — they want to see their last save
  // reflected immediately, so we skip the TTL there.
  if (!isPreviewRequest(c)) {
    c.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  }

  // Hidden blocks are filtered out for public visitors. Admin preview
  // still shows them (the editor needs them visible) — toggled by a
  // separate `?include_hidden=1` flag the admin attaches.
  const includeHidden = c.req.query('include_hidden') === '1';
  const visible = includeHidden ? blocks : blocks.filter((b) => b.hidden !== 1);

  return c.json({ page, blocks: visible });
});

/** Project-page index for the /work/:id prev/next pager.
 *  Returns the same ordered list the home page's project-grid block
 *  uses, so navigation matches the visible grid order. */
router.get('/public/index', async (c) => {
  const home = await getPageBySlug(c.env.DB, 'home');
  let orderedIds: number[] = [];
  if (home) {
    const grid = await c.env.DB.prepare(
      "SELECT content FROM landing_blocks WHERE page_id = ? AND type = 'project-grid' ORDER BY position, id LIMIT 1",
    )
      .bind(home.id)
      .first<{ content: string }>();
    if (grid) {
      const parsed = safeParseJson(grid.content) as { project_page_ids?: unknown };
      if (Array.isArray(parsed.project_page_ids)) {
        orderedIds = parsed.project_page_ids
          .map((x) => (typeof x === 'number' && Number.isFinite(x) ? x : null))
          .filter((x): x is number => x !== null);
      }
    }
  }

  // Pick up the rows for those ids, then fall back to "any project page
  // not in the grid" so the pager still works even if the admin hasn't
  // wired a new project into the grid yet.
  const allProjects = await c.env.DB.prepare(
    "SELECT id, slug, title_mn, title_en, published FROM landing_pages WHERE kind = 'project' AND published = 1",
  ).all<{ id: number; slug: string; title_mn: string; title_en: string; published: number }>();
  const byId = new Map((allProjects.results ?? []).map((p) => [p.id, p] as const));

  const project_pages: Array<{ id: number; slug: string; title_mn: string; title_en: string }> = [];
  const seen = new Set<number>();
  for (const id of orderedIds) {
    const p = byId.get(id);
    if (p) {
      project_pages.push({ id: p.id, slug: p.slug, title_mn: p.title_mn, title_en: p.title_en });
      seen.add(id);
    }
  }
  for (const p of allProjects.results ?? []) {
    if (!seen.has(p.id)) {
      project_pages.push({ id: p.id, slug: p.slug, title_mn: p.title_mn, title_en: p.title_en });
    }
  }

  if (!isPreviewRequest(c)) {
    c.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  }
  return c.json({ project_pages });
});

/** Hydrated project card data — what the project-grid block on the home
 *  page needs to render each tile. Pulls the project's hero block (title,
 *  subtitle, image) and credits block (year, location, category). One round
 *  trip for the whole landing page. */
router.get('/public/project-cards', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT p.id, p.slug, p.title_mn, p.title_en,
              b.type AS block_type, b.content AS block_content
         FROM landing_pages p
         LEFT JOIN landing_blocks b
           ON b.page_id = p.id AND b.type IN ('hero', 'project-credits')
        WHERE p.kind = 'project' AND p.published = 1
        ORDER BY p.id`,
  ).all<{
    id: number;
    slug: string;
    title_mn: string;
    title_en: string;
    block_type: string | null;
    block_content: string | null;
  }>();

  type Card = {
    id: number;
    slug: string;
    title_mn: string;
    title_en: string;
    hero: unknown;
    credits: unknown;
  };
  const cards: Record<number, Card> = {};
  for (const row of rows.results ?? []) {
    let card = cards[row.id];
    if (!card) {
      card = {
        id: row.id,
        slug: row.slug,
        title_mn: row.title_mn,
        title_en: row.title_en,
        hero: null,
        credits: null,
      };
      cards[row.id] = card;
    }
    if (row.block_type === 'hero' && row.block_content) {
      card.hero = safeParseJson(row.block_content);
    } else if (row.block_type === 'project-credits' && row.block_content) {
      card.credits = safeParseJson(row.block_content);
    }
  }

  if (!isPreviewRequest(c)) {
    c.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  }
  return c.json({ cards });
});

/* ------------------------------------------------------------------ */
/*  Admin reads                                                        */
/* ------------------------------------------------------------------ */

router.get('/admin/pages', requireAdmin(), async (c) => {
  const res = await c.env.DB.prepare(
    'SELECT * FROM landing_pages ORDER BY kind DESC, id',
  ).all<PageRow>();
  return c.json({ pages: res.results ?? [] });
});

router.get('/admin/pages/:id', requireAdmin(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
  const page = await getPageById(c.env.DB, id);
  if (!page) return c.json({ error: 'not found' }, 404);
  const blocks = await listBlocksForPage(c.env.DB, page.id);
  return c.json({ page, blocks });
});

/* ------------------------------------------------------------------ */
/*  Page CRUD                                                          */
/* ------------------------------------------------------------------ */

interface PageCreateBody {
  title_mn?: string;
  title_en?: string;
  kind?: 'project'; // only 'project' is creatable; 'home' is seeded
}

router.post('/admin/pages', requireAdmin(), async (c) => {
  const user = c.get('user');
  const body = await c.req.json<PageCreateBody>().catch((): PageCreateBody => ({}));
  const title_mn = (body.title_mn ?? '').trim();
  const title_en = (body.title_en ?? '').trim();
  const kind = body.kind === 'project' ? 'project' : 'project';

  // Two-step: insert with placeholder slug, then set slug='work/<id>' so the
  // /work/:id URL pattern keeps working. Wrapped in a batch for atomicity.
  const placeholder = `__pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const created = await c.env.DB.prepare(
    `INSERT INTO landing_pages (slug, kind, title_mn, title_en, updated_by)
       VALUES (?, ?, ?, ?, ?)
       RETURNING id`,
  )
    .bind(placeholder, kind, title_mn || 'Шинэ төсөл', title_en, user.sub)
    .first<{ id: number }>();
  if (!created) return c.json({ error: 'insert failed' }, 500);

  const slug = `work/${created.id}`;
  await c.env.DB.prepare(
    "UPDATE landing_pages SET slug = ?, updated_at = datetime('now') WHERE id = ?",
  )
    .bind(slug, created.id)
    .run();

  await bustEdgeCache(c, { key: 'landing:public', varyTags: ['home'] });

  const page = await getPageById(c.env.DB, created.id);
  return c.json({ page }, 201);
});

interface PageUpdateBody {
  title_mn?: string;
  title_en?: string;
  meta_json?: string;
  published?: number;
}

router.patch('/admin/pages/:id', requireAdmin(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
  const user = c.get('user');
  const body = await c.req.json<PageUpdateBody>().catch((): PageUpdateBody => ({}));

  const existing = await getPageById(c.env.DB, id);
  if (!existing) return c.json({ error: 'not found' }, 404);

  const fields: string[] = [];
  const values: Array<string | number | null> = [];
  if (typeof body.title_mn === 'string') {
    fields.push('title_mn = ?');
    values.push(body.title_mn);
  }
  if (typeof body.title_en === 'string') {
    fields.push('title_en = ?');
    values.push(body.title_en);
  }
  if (typeof body.meta_json === 'string') {
    fields.push('meta_json = ?');
    values.push(body.meta_json);
  }
  if (typeof body.published === 'number') {
    fields.push('published = ?');
    values.push(body.published === 1 ? 1 : 0);
  }
  fields.push("updated_at = datetime('now')");
  fields.push('updated_by = ?');
  values.push(user.sub);

  await c.env.DB.prepare(`UPDATE landing_pages SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values, id)
    .run();

  await bustEdgeCache(c, { key: 'landing:public', varyTags: [existing.slug] });
  await bustEdgeCache(c, { key: 'landing:public', varyTags: ['home'] });

  const page = await getPageById(c.env.DB, id);
  return c.json({ page });
});

router.delete('/admin/pages/:id', requireAdmin(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
  const existing = await getPageById(c.env.DB, id);
  if (!existing) return c.json({ error: 'not found' }, 404);
  if (existing.slug === 'home') {
    return c.json({ error: 'Нүүр хуудсыг устгах боломжгүй' }, 400);
  }

  // Blocks cascade-delete via FK ON DELETE CASCADE.
  await c.env.DB.prepare('DELETE FROM landing_pages WHERE id = ?').bind(id).run();

  await bustEdgeCache(c, { key: 'landing:public', varyTags: [existing.slug] });
  await bustEdgeCache(c, { key: 'landing:public', varyTags: ['home'] });

  return c.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/*  Block CRUD                                                         */
/* ------------------------------------------------------------------ */

interface BlockCreateBody {
  type?: string;
  content?: unknown;
  position?: number;
  hidden?: number;
}

router.post('/admin/pages/:id/blocks', requireAdmin(), async (c) => {
  const pageId = Number(c.req.param('id'));
  if (!Number.isFinite(pageId)) return c.json({ error: 'invalid page id' }, 400);
  const page = await getPageById(c.env.DB, pageId);
  if (!page) return c.json({ error: 'page not found' }, 404);

  const body = await c.req.json<BlockCreateBody>().catch((): BlockCreateBody => ({}));
  if (typeof body.type !== 'string' || body.type.length === 0) {
    return c.json({ error: 'type required' }, 400);
  }
  const content = body.content === undefined ? {} : body.content;
  const hidden = body.hidden === 1 ? 1 : 0;

  // Default position: append after current max. If a position is given,
  // use it as-is — reorder is a separate endpoint and the client typically
  // calls that after inserting at the right slot anyway.
  let position: number;
  if (typeof body.position === 'number' && Number.isFinite(body.position)) {
    position = body.position;
  } else {
    const max = await c.env.DB.prepare(
      'SELECT COALESCE(MAX(position), 0) AS max_pos FROM landing_blocks WHERE page_id = ?',
    )
      .bind(pageId)
      .first<{ max_pos: number }>();
    position = (max?.max_pos ?? 0) + 10;
  }

  const created = await c.env.DB.prepare(
    `INSERT INTO landing_blocks (page_id, type, position, content, hidden)
       VALUES (?, ?, ?, ?, ?)
       RETURNING *`,
  )
    .bind(pageId, body.type, position, JSON.stringify(content), hidden)
    .first<BlockRow>();
  if (!created) return c.json({ error: 'insert failed' }, 500);

  await bustEdgeCache(c, { key: 'landing:public', varyTags: [page.slug] });

  return c.json({ block: blockRowToApi(created) }, 201);
});

interface BlockUpdateBody {
  type?: string;
  content?: unknown;
  hidden?: number;
}

router.patch('/admin/blocks/:id', requireAdmin(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);

  const existing = await c.env.DB.prepare('SELECT * FROM landing_blocks WHERE id = ?')
    .bind(id)
    .first<BlockRow>();
  if (!existing) return c.json({ error: 'not found' }, 404);

  const body = await c.req.json<BlockUpdateBody>().catch((): BlockUpdateBody => ({}));
  const fields: string[] = [];
  const values: Array<string | number> = [];
  if (typeof body.type === 'string' && body.type.length > 0) {
    fields.push('type = ?');
    values.push(body.type);
  }
  if (body.content !== undefined) {
    fields.push('content = ?');
    values.push(JSON.stringify(body.content));
  }
  if (typeof body.hidden === 'number') {
    fields.push('hidden = ?');
    values.push(body.hidden === 1 ? 1 : 0);
  }
  if (fields.length === 0) {
    return c.json({ block: blockRowToApi(existing) });
  }
  fields.push("updated_at = datetime('now')");

  const updated = await c.env.DB.prepare(
    `UPDATE landing_blocks SET ${fields.join(', ')} WHERE id = ? RETURNING *`,
  )
    .bind(...values, id)
    .first<BlockRow>();
  if (!updated) return c.json({ error: 'update failed' }, 500);

  const page = await getPageById(c.env.DB, updated.page_id);
  if (page) {
    await bustEdgeCache(c, { key: 'landing:public', varyTags: [page.slug] });
  }

  return c.json({ block: blockRowToApi(updated) });
});

router.delete('/admin/blocks/:id', requireAdmin(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);

  const existing = await c.env.DB.prepare('SELECT page_id FROM landing_blocks WHERE id = ?')
    .bind(id)
    .first<{ page_id: number }>();
  if (!existing) return c.json({ error: 'not found' }, 404);

  await c.env.DB.prepare('DELETE FROM landing_blocks WHERE id = ?').bind(id).run();

  const page = await getPageById(c.env.DB, existing.page_id);
  if (page) {
    await bustEdgeCache(c, { key: 'landing:public', varyTags: [page.slug] });
  }

  return c.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/*  Reorder                                                            */
/*                                                                     */
/*  Body: { block_ids: number[] } — must contain exactly the ids of    */
/*  the page's existing blocks, in the desired order. Server rewrites  */
/*  positions to (index + 1) * 10 in a single D1 batch.                */
/* ------------------------------------------------------------------ */

interface ReorderBody {
  block_ids?: unknown;
}

router.put('/admin/pages/:id/reorder', requireAdmin(), async (c) => {
  const pageId = Number(c.req.param('id'));
  if (!Number.isFinite(pageId)) return c.json({ error: 'invalid page id' }, 400);
  const page = await getPageById(c.env.DB, pageId);
  if (!page) return c.json({ error: 'page not found' }, 404);

  const body = await c.req.json<ReorderBody>().catch((): ReorderBody => ({}));
  if (!Array.isArray(body.block_ids)) {
    return c.json({ error: 'block_ids required' }, 400);
  }
  const ids = body.block_ids
    .map((x) => (typeof x === 'number' && Number.isFinite(x) ? x : null))
    .filter((x): x is number => x !== null);
  if (ids.length === 0) {
    return c.json({ error: 'block_ids must be a non-empty number array' }, 400);
  }

  // Verify all the requested ids actually belong to this page. Reject the
  // entire request if any don't — preventing accidental cross-page moves.
  const existing = await c.env.DB.prepare(`SELECT id FROM landing_blocks WHERE page_id = ?`)
    .bind(pageId)
    .all<{ id: number }>();
  const ownedIds = new Set((existing.results ?? []).map((r) => r.id));
  for (const id of ids) {
    if (!ownedIds.has(id)) {
      return c.json({ error: `block ${id} does not belong to page ${pageId}` }, 400);
    }
  }
  if (ids.length !== ownedIds.size) {
    return c.json({ error: 'block_ids must contain every block on the page exactly once' }, 400);
  }

  const stmts = ids.map((id, i) =>
    c.env.DB.prepare(
      "UPDATE landing_blocks SET position = ?, updated_at = datetime('now') WHERE id = ?",
    ).bind((i + 1) * 10, id),
  );
  await c.env.DB.batch(stmts);

  await bustEdgeCache(c, { key: 'landing:public', varyTags: [page.slug] });

  const blocks = await listBlocksForPage(c.env.DB, pageId);
  return c.json({ blocks });
});

export default router;
