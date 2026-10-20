/**
 * Public landing page CMS.
 *
 * GET  /api/landing/public           — unauthenticated, returns everything the
 *                                       marketing site needs in one round-trip.
 * GET  /api/landing/admin            — admin-only, includes unpublished rows.
 * PUT  /api/landing/settings         — hero / about / contact.
 * POST /api/landing/projects         — create portfolio card.
 * PUT  /api/landing/projects/:id     — update portfolio card.
 * DELETE /api/landing/projects/:id   — delete portfolio card.
 * POST /api/landing/services         — create service.
 * PUT  /api/landing/services/:id     — update service.
 * DELETE /api/landing/services/:id   — delete service.
 * POST /api/landing/news             — create news entry.
 * PUT  /api/landing/news/:id         — update news entry.
 * DELETE /api/landing/news/:id       — delete news entry.
 *
 * Auth: read endpoints are open (settings + published rows); writes go through
 * requireAdmin().  Public read is exempted in middleware/auth.ts.
 */
import { Hono } from 'hono';
import { requireAdmin } from '../middleware/auth';
import type { Env, AppVariables } from '../types';

const router = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type LandingSettings = {
  id: number;
  hero_title_mn: string;
  hero_title_en: string;
  hero_subtitle_mn: string;
  hero_subtitle_en: string;
  hero_image_url: string | null;
  hero_video_url: string | null;
  about_title_mn: string;
  about_title_en: string;
  about_body_mn: string;
  about_body_en: string;
  about_image_url: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  contact_address_mn: string | null;
  contact_address_en: string | null;
  facebook_url: string | null;
  linkedin_url: string | null;
  instagram_url: string | null;
  // Global default for the opening philosophy paragraph shown on each
  // /work/:id detail page. Per-project philosophy_* fields override this.
  project_intro_mn: string;
  project_intro_en: string;
  updated_at: string;
};

type LandingProject = {
  id: number;
  title_mn: string;
  title_en: string;
  subtitle_mn: string;
  subtitle_en: string;
  description_mn: string;
  description_en: string;
  image_url: string | null;
  location_mn: string | null;
  location_en: string | null;
  year: string | null;
  category_mn: string | null;
  category_en: string | null;
  // Architectural credit block — all optional, all bilingual.
  typology_mn: string | null;
  typology_en: string | null;
  status_mn: string | null;
  status_en: string | null;
  size_mn: string | null;
  size_en: string | null;
  client_mn: string | null;
  client_en: string | null;
  design_team_mn: string | null;
  design_team_en: string | null;
  // Per-project override for the global project_intro_*. Empty/null
  // falls back to the studio-wide statement on landing_settings.
  philosophy_mn: string | null;
  philosophy_en: string | null;
  // JSON-encoded string[] of extra image URLs (R2 /media or absolute).
  gallery_urls: string | null;
  sort_order: number;
  published: number;
};

type LandingService = {
  id: number;
  title_mn: string;
  title_en: string;
  body_mn: string;
  body_en: string;
  icon: string | null;
  sort_order: number;
  published: number;
};

type LandingNews = {
  id: number;
  title_mn: string;
  title_en: string;
  excerpt_mn: string;
  excerpt_en: string;
  body_mn: string;
  body_en: string;
  image_url: string | null;
  published_at: string;
  published: number;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function ensureSettingsRow(db: D1Database): Promise<LandingSettings> {
  // The migration seeds id=1, but if a fresh DB ever skips the seed (or a
  // future migration truncates), make sure we have a baseline row to return.
  await db.prepare(`INSERT OR IGNORE INTO landing_settings (id) VALUES (1)`).run();
  const row = await db
    .prepare(`SELECT * FROM landing_settings WHERE id = 1`)
    .first<LandingSettings>();
  return row!;
}

function pick<T extends Record<string, unknown>>(obj: T, keys: readonly (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Public read                                                        */
/* ------------------------------------------------------------------ */

router.get('/public', async (c) => {
  const settings = await ensureSettingsRow(c.env.DB);

  const [projectsRes, servicesRes, newsRes] = await Promise.all([
    c.env.DB.prepare(
      `SELECT * FROM landing_projects WHERE published = 1 ORDER BY sort_order, id`,
    ).all<LandingProject>(),
    c.env.DB.prepare(
      `SELECT * FROM landing_services WHERE published = 1 ORDER BY sort_order, id`,
    ).all<LandingService>(),
    c.env.DB.prepare(
      `SELECT * FROM landing_news WHERE published = 1 ORDER BY published_at DESC LIMIT 12`,
    ).all<LandingNews>(),
  ]);

  // Hint Cloudflare / browsers to cache the public payload for a minute —
  // the CMS doesn't change often, and a stale-while-revalidate window keeps
  // the homepage TTFB low even under burst traffic.
  c.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');

  return c.json({
    settings,
    projects: projectsRes.results ?? [],
    services: servicesRes.results ?? [],
    news: newsRes.results ?? [],
  });
});

/* ------------------------------------------------------------------ */
/*  Admin read (includes drafts)                                       */
/* ------------------------------------------------------------------ */

router.get('/admin', requireAdmin(), async (c) => {
  const settings = await ensureSettingsRow(c.env.DB);
  const [projectsRes, servicesRes, newsRes] = await Promise.all([
    c.env.DB.prepare(
      `SELECT * FROM landing_projects ORDER BY sort_order, id`,
    ).all<LandingProject>(),
    c.env.DB.prepare(
      `SELECT * FROM landing_services ORDER BY sort_order, id`,
    ).all<LandingService>(),
    c.env.DB.prepare(
      `SELECT * FROM landing_news ORDER BY published_at DESC, id DESC`,
    ).all<LandingNews>(),
  ]);
  return c.json({
    settings,
    projects: projectsRes.results ?? [],
    services: servicesRes.results ?? [],
    news: newsRes.results ?? [],
  });
});

/* ------------------------------------------------------------------ */
/*  Settings (singleton)                                               */
/* ------------------------------------------------------------------ */

const SETTINGS_FIELDS = [
  'hero_title_mn',
  'hero_title_en',
  'hero_subtitle_mn',
  'hero_subtitle_en',
  'hero_image_url',
  'hero_video_url',
  'about_title_mn',
  'about_title_en',
  'about_body_mn',
  'about_body_en',
  'about_image_url',
  'contact_phone',
  'contact_email',
  'contact_address_mn',
  'contact_address_en',
  'facebook_url',
  'linkedin_url',
  'instagram_url',
  'project_intro_mn',
  'project_intro_en',
] as const;

router.put('/settings', requireAdmin(), async (c) => {
  const user = c.get('user');
  const body = await c.req
    .json<Partial<LandingSettings>>()
    .catch((): Partial<LandingSettings> => ({}));
  const data = pick(body, SETTINGS_FIELDS);

  // Make sure the row exists before we UPDATE it.
  await ensureSettingsRow(c.env.DB);

  const keys = Object.keys(data);
  if (keys.length === 0) {
    return c.json(await ensureSettingsRow(c.env.DB));
  }

  const setClause = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => (data as Record<string, unknown>)[k] ?? null);

  await c.env.DB.prepare(
    `UPDATE landing_settings SET ${setClause}, updated_at = datetime('now'), updated_by = ? WHERE id = 1`,
  )
    .bind(...values, user.sub)
    .run();

  const updated = await ensureSettingsRow(c.env.DB);
  return c.json(updated);
});

/* ------------------------------------------------------------------ */
/*  Projects CRUD                                                      */
/* ------------------------------------------------------------------ */

const PROJECT_FIELDS = [
  'title_mn',
  'title_en',
  'subtitle_mn',
  'subtitle_en',
  'description_mn',
  'description_en',
  'image_url',
  'location_mn',
  'location_en',
  'year',
  'category_mn',
  'category_en',
  'typology_mn',
  'typology_en',
  'status_mn',
  'status_en',
  'size_mn',
  'size_en',
  'client_mn',
  'client_en',
  'design_team_mn',
  'design_team_en',
  'philosophy_mn',
  'philosophy_en',
  'gallery_urls',
  'sort_order',
  'published',
] as const;

router.post('/projects', requireAdmin(), async (c) => {
  const body = await c.req
    .json<Partial<LandingProject>>()
    .catch((): Partial<LandingProject> => ({}));
  if (!body.title_mn || !body.title_mn.trim()) {
    return c.json({ error: 'title_mn шаардлагатай' }, 400);
  }
  const data = pick(body, PROJECT_FIELDS);
  const keys = Object.keys(data);
  const placeholders = keys.map(() => '?').join(', ');
  const values = keys.map((k) => (data as Record<string, unknown>)[k] ?? null);

  const result = await c.env.DB.prepare(
    `INSERT INTO landing_projects (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`,
  )
    .bind(...values)
    .first<LandingProject>();
  return c.json(result, 201);
});

router.put('/projects/:id', requireAdmin(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);

  const body = await c.req
    .json<Partial<LandingProject>>()
    .catch((): Partial<LandingProject> => ({}));
  const data = pick(body, PROJECT_FIELDS);
  const keys = Object.keys(data);
  if (keys.length === 0) {
    const row = await c.env.DB.prepare(`SELECT * FROM landing_projects WHERE id = ?`)
      .bind(id)
      .first<LandingProject>();
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json(row);
  }
  const setClause = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => (data as Record<string, unknown>)[k] ?? null);

  const updated = await c.env.DB.prepare(
    `UPDATE landing_projects SET ${setClause}, updated_at = datetime('now') WHERE id = ? RETURNING *`,
  )
    .bind(...values, id)
    .first<LandingProject>();
  if (!updated) return c.json({ error: 'not found' }, 404);
  return c.json(updated);
});

router.delete('/projects/:id', requireAdmin(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
  await c.env.DB.prepare(`DELETE FROM landing_projects WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/*  Services CRUD                                                      */
/* ------------------------------------------------------------------ */

const SERVICE_FIELDS = [
  'title_mn',
  'title_en',
  'body_mn',
  'body_en',
  'icon',
  'sort_order',
  'published',
] as const;

router.post('/services', requireAdmin(), async (c) => {
  const body = await c.req
    .json<Partial<LandingService>>()
    .catch((): Partial<LandingService> => ({}));
  if (!body.title_mn || !body.title_mn.trim()) {
    return c.json({ error: 'title_mn шаардлагатай' }, 400);
  }
  const data = pick(body, SERVICE_FIELDS);
  const keys = Object.keys(data);
  const placeholders = keys.map(() => '?').join(', ');
  const values = keys.map((k) => (data as Record<string, unknown>)[k] ?? null);

  const result = await c.env.DB.prepare(
    `INSERT INTO landing_services (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`,
  )
    .bind(...values)
    .first<LandingService>();
  return c.json(result, 201);
});

router.put('/services/:id', requireAdmin(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
  const body = await c.req
    .json<Partial<LandingService>>()
    .catch((): Partial<LandingService> => ({}));
  const data = pick(body, SERVICE_FIELDS);
  const keys = Object.keys(data);
  if (keys.length === 0) {
    const row = await c.env.DB.prepare(`SELECT * FROM landing_services WHERE id = ?`)
      .bind(id)
      .first<LandingService>();
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json(row);
  }
  const setClause = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => (data as Record<string, unknown>)[k] ?? null);
  const updated = await c.env.DB.prepare(
    `UPDATE landing_services SET ${setClause}, updated_at = datetime('now') WHERE id = ? RETURNING *`,
  )
    .bind(...values, id)
    .first<LandingService>();
  if (!updated) return c.json({ error: 'not found' }, 404);
  return c.json(updated);
});

router.delete('/services/:id', requireAdmin(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
  await c.env.DB.prepare(`DELETE FROM landing_services WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/*  News CRUD                                                          */
/* ------------------------------------------------------------------ */

const NEWS_FIELDS = [
  'title_mn',
  'title_en',
  'excerpt_mn',
  'excerpt_en',
  'body_mn',
  'body_en',
  'image_url',
  'published_at',
  'published',
] as const;

router.post('/news', requireAdmin(), async (c) => {
  const body = await c.req.json<Partial<LandingNews>>().catch((): Partial<LandingNews> => ({}));
  if (!body.title_mn || !body.title_mn.trim()) {
    return c.json({ error: 'title_mn шаардлагатай' }, 400);
  }
  const data = pick(body, NEWS_FIELDS);
  const keys = Object.keys(data);
  const placeholders = keys.map(() => '?').join(', ');
  const values = keys.map((k) => (data as Record<string, unknown>)[k] ?? null);
  const result = await c.env.DB.prepare(
    `INSERT INTO landing_news (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`,
  )
    .bind(...values)
    .first<LandingNews>();
  return c.json(result, 201);
});

router.put('/news/:id', requireAdmin(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
  const body = await c.req.json<Partial<LandingNews>>().catch((): Partial<LandingNews> => ({}));
  const data = pick(body, NEWS_FIELDS);
  const keys = Object.keys(data);
  if (keys.length === 0) {
    const row = await c.env.DB.prepare(`SELECT * FROM landing_news WHERE id = ?`)
      .bind(id)
      .first<LandingNews>();
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json(row);
  }
  const setClause = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => (data as Record<string, unknown>)[k] ?? null);
  const updated = await c.env.DB.prepare(
    `UPDATE landing_news SET ${setClause}, updated_at = datetime('now') WHERE id = ? RETURNING *`,
  )
    .bind(...values, id)
    .first<LandingNews>();
  if (!updated) return c.json({ error: 'not found' }, 404);
  return c.json(updated);
});

router.delete('/news/:id', requireAdmin(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
  await c.env.DB.prepare(`DELETE FROM landing_news WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
});

export default router;
