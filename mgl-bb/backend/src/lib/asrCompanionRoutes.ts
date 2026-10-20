/**
 * Хамт явсан хүний улаан дэвтэр + нэр дэвшигч.
 * `/:id`-ээс өмнө бүртгэнэ (`/companion-candidates`).
 */
import type { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import { isAdminRole, type AppVariables, type Env } from '../types';
import { isSingleSegmentMediaUrl } from './mediaUrl';
import { listCompanionCandidates, type CompanionScope } from './asrCompanionStore';

type Viewer = { sub: number; role: string };
type Access =
  | { ok: true }
  | { ok: false; status: 400 | 403 | 404; error: string };
type App = Hono<{ Bindings: Env; Variables: AppVariables }>;

interface Head {
  project_id: number;
  author_id: number;
  status: string;
}

export function registerAsrCompanionRoutes(
  router: App,
  deps: {
    ensureAccess: (db: D1Database, projectId: number, user: Viewer) => Promise<Access>;
    canReview: (db: D1Database, reportId: number, user: Viewer) => Promise<boolean>;
    loadDetail: (db: D1Database, reportId: number) => Promise<unknown>;
  },
) {
  // `?scope=all` — оффис уулзалтын «Оролцсон» (0367): бүх идэвхтэй ажилтан.
  const scopeOf = (v: string | undefined): CompanionScope => (v === 'all' ? 'all' : 'team');

  router.get('/companion-candidates', async (c) => {
    const user = c.get('user');
    return c.json({
      users: await listCompanionCandidates(c.env.DB, user.sub, scopeOf(c.req.query('scope'))),
    });
  });

  router.get('/:id/companion-candidates', async (c) => {
    const user = c.get('user');
    const head = await reportHead(c.env.DB, c.req.param('id'));
    if (!head) return c.json({ error: 'Not found' }, 404);
    const access = await deps.ensureAccess(c.env.DB, head.project_id, user);
    if (!access.ok) return c.json({ error: access.error }, access.status);
    return c.json({
      users: await listCompanionCandidates(c.env.DB, head.author_id, scopeOf(c.req.query('scope'))),
    });
  });

  router.patch('/:id/companions/:userId/red-book', async (c) => {
    const user = c.get('user');
    const id = Number(c.req.param('id'));
    const userId = Number(c.req.param('userId'));
    const row = await companionHead(c.env.DB, id, userId);
    if (!row) return c.json({ error: 'Not found' }, 404);
    const access = await deps.ensureAccess(c.env.DB, row.project_id, user);
    if (!access.ok) return c.json({ error: access.error }, access.status);
    const allowed =
      isAdminRole(user.role) || user.sub === row.author_id || user.sub === userId;
    if (!allowed) return c.json({ error: 'Forbidden' }, 403);
    if (row.red_book_verified_at) {
      return c.json({ error: 'Улаан дэвтэр баталгаажсан байна. Эхлээд баталгааг цуцална уу.' }, 409);
    }
    const body = await c.req.json<{ photo_url?: unknown }>().catch(() => ({}) as { photo_url?: unknown });
    const url = photoUrl(body.photo_url);
    if (url === false) return c.json({ error: 'Invalid photo url' }, 400);
    await c.env.DB.prepare(
      `UPDATE asr_report_companions SET red_book_photo_url = ? WHERE report_id = ? AND user_id = ?`,
    )
      .bind(url, id, userId)
      .run();
    return c.json({ entry: await deps.loadDetail(c.env.DB, id) });
  });

  router.post('/:id/companions/:userId/red-book/verify', async (c) => {
    return review(c, deps, 'verify');
  });
  router.delete('/:id/companions/:userId/red-book/verify', async (c) => {
    return review(c, deps, 'revoke');
  });
}

function photoUrl(v: unknown): string | null | false {
  if (v == null || v === '') return null;
  return isSingleSegmentMediaUrl(v) ? v : false;
}

async function reportHead(db: D1Database, raw: string): Promise<Head | null> {
  const id = Number(raw);
  if (!Number.isFinite(id)) return null;
  return db
    .prepare('SELECT project_id, author_id, status FROM author_supervision_reports WHERE id = ?')
    .bind(id)
    .first<Head>();
}

async function companionHead(db: D1Database, reportId: number, userId: number) {
  if (!Number.isFinite(reportId) || !Number.isFinite(userId)) return null;
  return db
    .prepare(
      `SELECT r.project_id, r.author_id, r.status, c.red_book_photo_url, c.red_book_verified_at
         FROM asr_report_companions c
         JOIN author_supervision_reports r ON r.id = c.report_id
        WHERE c.report_id = ? AND c.user_id = ?`,
    )
    .bind(reportId, userId)
    .first<Head & { red_book_photo_url: string | null; red_book_verified_at: string | null }>();
}

type ReviewCtx = {
  get: (k: 'user') => Viewer;
  req: { param: (n: string) => string };
  env: { DB: D1Database };
  json: (b: unknown, s?: number) => Response;
};

async function review(
  c: ReviewCtx,
  deps: {
    ensureAccess: (db: D1Database, projectId: number, user: Viewer) => Promise<Access>;
    canReview: (db: D1Database, reportId: number, user: Viewer) => Promise<boolean>;
    loadDetail: (db: D1Database, reportId: number) => Promise<unknown>;
  },
  mode: 'verify' | 'revoke',
) {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const userId = Number(c.req.param('userId'));
  const row = await companionHead(c.env.DB, id, userId);
  if (!row) return c.json({ error: 'Not found' }, 404);
  const access = await deps.ensureAccess(c.env.DB, row.project_id, user);
  if (!access.ok) return c.json({ error: access.error }, access.status);
  if (!(await deps.canReview(c.env.DB, id, user))) return c.json({ error: 'Forbidden' }, 403);
  if (mode === 'verify') {
    if (row.status === 'draft') {
      return c.json({ error: 'Ноорог тайлангийн улаан дэвтрийг баталгаажуулахгүй.' }, 409);
    }
    if (!row.red_book_photo_url) return c.json({ error: 'Улаан дэвтрийн зураг хавсаргаагүй байна.' }, 400);
    const res = await c.env.DB.prepare(
      `UPDATE asr_report_companions
          SET red_book_verified_by = ?, red_book_verified_at = ?
        WHERE report_id = ? AND user_id = ? AND red_book_verified_at IS NULL
          AND red_book_photo_url IS NOT NULL`,
    )
      .bind(user.sub, new Date().toISOString(), id, userId)
      .run();
    if ((res.meta.changes ?? 0) === 0) {
      return c.json({ error: 'Улаан дэвтэр аль хэдийн баталгаажсан байна.' }, 409);
    }
  } else {
    const res = await c.env.DB.prepare(
      `UPDATE asr_report_companions
          SET red_book_verified_by = NULL, red_book_verified_at = NULL
        WHERE report_id = ? AND user_id = ? AND red_book_verified_at IS NOT NULL`,
    )
      .bind(id, userId)
      .run();
    if ((res.meta.changes ?? 0) === 0) {
      return c.json({ error: 'Улаан дэвтэр баталгаажаагүй байна.' }, 409);
    }
  }
  return c.json({ entry: await deps.loadDetail(c.env.DB, id) });
}
