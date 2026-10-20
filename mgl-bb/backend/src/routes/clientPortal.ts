import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Env, AppVariables } from '../types';
import { verifyToken } from '../lib/jwt';
import { clientAccessLevel, clientOrgIds, clientProjectAccess } from '../lib/clientAccess';
import { buildFileName, dedupeNames, projectCode } from '../lib/clientFileName';
import { isAllowedDocFile } from '../lib/documentFileTypes';
import { createNotificationForReviewers } from '../lib/notify';
import { todayInUB } from '../lib/time';

/**
 * `/api/client/*` — ЗАХИАЛАГЧИЙН ПОРТАЛ.
 *
 * Хоёр зорилго:
 *   1. Захиалагч бидэн рүү ЗАЛГАХГҮЙГЭЭР материалаа өөрөө татаж авах.
 *   2. Захиалагч материалаа МАЯГТААР илгээж, файлын нэр нь бидний дүрмээр
 *      автоматаар зөв болох.
 *
 * Харагдацын ЦОРЫН ГАНЦ дүрэм: `client_publications`-д амьд мөр байгаа зүйл
 * л харагдана.  Ноорог тайлан, гараагүй зургийн багц энд ХЭЗЭЭ Ч гарахгүй.
 *
 * ⚠️ Эрхийг `lib/clientAccess.ts` шийднэ, JWT БИШ.  Шалтгааныг тэр файлын
 *    толгойд бичсэн: role нь токеноос уншигддаг тул эрхийг ч токенд хийвэл
 *    гэрээ цуцлагдсан компани 24 цаг зураг татсаар байх болно.
 */
const clientPortal = new Hono<{ Bindings: Env; Variables: AppVariables }>();

const MAX_FILES_PER_SUBMISSION = 20;

/** Захиалагч эсэх.  Ажилтан (admin) энэ гадаргууг шалгах зорилгоор
 *  дуудаж болно — тэдэнд төслийн хязгаарлалт үйлчлэхгүй. */
function isClient(role: string): boolean {
  return role === 'client';
}

interface TemplateRow {
  id: number;
  code: string;
  name_mn: string;
  description_mn: string | null;
  fields_json: string;
  filename_pattern: string;
  allowed_ext: string | null;
  sort_order: number;
}

function safeJsonArray(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  Миний төслүүд                                                      */
/* ------------------------------------------------------------------ */

clientPortal.get('/projects', async (c) => {
  const user = c.get('user');
  const access = await clientProjectAccess(c.env.DB, user.sub);
  if (access.length === 0) return c.json({ projects: [] });

  const ids = access.map((a) => a.project_id);
  const placeholders = ids.map(() => '?').join(',');
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.name, p.display_title, p.location, p.status, p.key_image_url,
            (SELECT COUNT(*) FROM client_publications cp
              WHERE cp.project_id = p.id AND cp.unpublished_at IS NULL) AS material_count,
            (SELECT MAX(created_at) FROM client_events ce WHERE ce.project_id = p.id) AS last_event_at
       FROM projects p
      WHERE p.id IN (${placeholders})
      ORDER BY p.is_asap DESC, p.sort_order ASC, p.created_at DESC`,
  )
    .bind(...ids)
    .all<Record<string, unknown>>();

  const levelOf = new Map(access.map((a) => [a.project_id, a.access_level]));
  return c.json({
    projects: results.map((r) => ({
      id: Number(r.id),
      name: String(r.name ?? ''),
      display_title: (r.display_title as string | null) ?? null,
      location: (r.location as string | null) ?? null,
      status: (r.status as string | null) ?? null,
      key_image_url: (r.key_image_url as string | null) ?? null,
      material_count: Number(r.material_count ?? 0),
      last_event_at: (r.last_event_at as string | null) ?? null,
      access_level: levelOf.get(Number(r.id)) ?? 'viewer',
    })),
  });
});

/* ------------------------------------------------------------------ */
/*  Нийтэлсэн материал (татах төв)                                     */
/* ------------------------------------------------------------------ */

clientPortal.get('/projects/:id/materials', async (c) => {
  const user = c.get('user');
  const projectId = Number(c.req.param('id'));
  if (!Number.isFinite(projectId)) return c.json({ error: 'Invalid id' }, 400);
  if (isClient(user.role) && !(await clientAccessLevel(c.env.DB, user.sub, projectId))) {
    return c.json({ error: 'Access denied' }, 403);
  }

  const { results: pubs } = await c.env.DB.prepare(
    `SELECT id, kind, ref_id, title_mn, note, published_at
       FROM client_publications
      WHERE project_id = ? AND unpublished_at IS NULL
      ORDER BY published_at DESC, id DESC`,
  )
    .bind(projectId)
    .all<{
      id: number;
      kind: string;
      ref_id: number;
      title_mn: string;
      note: string | null;
      published_at: string;
    }>();

  const deliverableIds = pubs.filter((p) => p.kind === 'deliverable').map((p) => p.ref_id);
  const filesByDeliverable = new Map<
    number,
    { id: number; name: string; size: number | null; url: string }[]
  >();

  if (deliverableIds.length > 0) {
    const ph = deliverableIds.map(() => '?').join(',');
    const { results: files } = await c.env.DB.prepare(
      `SELECT f.id, f.deliverable_id, f.file_name, f.file_size
         FROM deliverable_files f
         JOIN project_deliverables d ON d.id = f.deliverable_id
        WHERE f.deliverable_id IN (${ph}) AND d.status <> 'draft'
        ORDER BY f.sort_order, f.id`,
    )
      .bind(...deliverableIds)
      .all<{ id: number; deliverable_id: number; file_name: string; file_size: number | null }>();
    for (const f of files) {
      const list = filesByDeliverable.get(f.deliverable_id) ?? [];
      list.push({
        id: f.id,
        name: f.file_name,
        size: f.file_size,
        url: `/api/client-files/deliverable/${f.id}`,
      });
      filesByDeliverable.set(f.deliverable_id, list);
    }
  }

  // Гүйцэтгэлийн тайлан нь ГАРСАН (issued) байх ёстой — ноорог тайлангийн
  // PDF захиалагч руу явж болохгүй.  Нийтэлсэн ч ноорог болж буцсан
  // тайланг энэ шүүлт шүүнэ.
  const reportIds = pubs.filter((p) => p.kind === 'perf_report').map((p) => p.ref_id);
  const issuedReports = new Set<number>();
  if (reportIds.length > 0) {
    const ph = reportIds.map(() => '?').join(',');
    const { results } = await c.env.DB.prepare(
      `SELECT id FROM project_performance_reports
        WHERE id IN (${ph}) AND status = 'issued'`,
    )
      .bind(...reportIds)
      .all<{ id: number }>();
    for (const r of results) issuedReports.add(r.id);
  }

  const materials = pubs
    .map((p) => {
      if (p.kind === 'deliverable') {
        const files = filesByDeliverable.get(p.ref_id) ?? [];
        if (files.length === 0) return null;
        return { ...p, files, download_url: null as string | null };
      }
      if (p.kind === 'perf_report') {
        if (!issuedReports.has(p.ref_id)) return null;
        return {
          ...p,
          files: [] as { id: number; name: string; size: number | null; url: string }[],
          download_url: `/api/projects/${projectId}/performance-reports/${p.ref_id}/client-pdf`,
        };
      }
      return {
        ...p,
        files: [] as { id: number; name: string; size: number | null; url: string }[],
        download_url: null as string | null,
      };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);

  return c.json({ materials });
});

/* ------------------------------------------------------------------ */
/*  Өөрчлөлтийн урсгал                                                 */
/* ------------------------------------------------------------------ */

clientPortal.get('/projects/:id/events', async (c) => {
  const user = c.get('user');
  const projectId = Number(c.req.param('id'));
  if (!Number.isFinite(projectId)) return c.json({ error: 'Invalid id' }, 400);
  if (isClient(user.role) && !(await clientAccessLevel(c.env.DB, user.sub, projectId))) {
    return c.json({ error: 'Access denied' }, 403);
  }

  const sinceId = Number(c.req.query('since_id') ?? '0') || 0;
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? '50') || 50));

  const { results } = await c.env.DB.prepare(
    `SELECT id, project_id, kind, ref_id, title_mn, created_at
       FROM client_events
      WHERE project_id = ? AND id > ?
      ORDER BY id DESC
      LIMIT ?`,
  )
    .bind(projectId, sinceId, limit)
    .all<Record<string, unknown>>();

  const events = results.reverse();
  const lastRow = events.length > 0 ? events[events.length - 1] : null;
  return c.json({ events, last_id: lastRow ? Number(lastRow.id) : sinceId });
});

/* ------------------------------------------------------------------ */
/*  WebSocket                                                          */
/* ------------------------------------------------------------------ */

/**
 * `GET /api/client/ws?project_id=&t=<jwt>`
 *
 * ⚠️ Энэ зам `middleware/auth.ts`-ийн нээлттэй жагсаалтад БАЙГАА бөгөөд
 *    токеноо ӨӨРӨӨ шалгана.  Шалтгаан: хөтчийн WebSocket API нь
 *    `Authorization` толгой явуулж чаддаггүй.  Cookie ирвэл түүнийг,
 *    үгүй бол `?t=` query-г авна (`/meeting-audio`-тай ижил буулт).
 */
clientPortal.get('/ws', async (c) => {
  if (c.req.header('Upgrade') !== 'websocket') {
    return c.json({ error: 'Expected websocket' }, 426);
  }
  const token = c.req.query('t') || getCookie(c, 'token');
  if (!token) return c.json({ error: 'Unauthorized' }, 401);

  const payload = await verifyToken(token, c.env.JWT_SECRET);
  if (!payload) return c.json({ error: 'Invalid or expired token' }, 401);

  const projectId = Number(c.req.query('project_id'));
  if (!Number.isFinite(projectId)) return c.json({ error: 'project_id required' }, 400);

  if (payload.role === 'client') {
    const level = await clientAccessLevel(c.env.DB, payload.sub, projectId);
    if (!level) return c.json({ error: 'Access denied' }, 403);
  }

  if (!c.env.CLIENT_ROOM) return c.json({ error: 'Realtime unavailable' }, 503);
  const stub = c.env.CLIENT_ROOM.get(c.env.CLIENT_ROOM.idFromName(`project:${projectId}`));

  // DO нь толгойгоор ирсэн хэрэглэгчийг ИТГЭНЭ — гаднаас түүн рүү шууд
  // хандах зам байхгүй, эрхийг дээрх мөрүүд аль хэдийн шалгасан.
  const headers = new Headers(c.req.raw.headers);
  headers.set('X-User-Id', String(payload.sub));
  headers.set('X-User-Role', payload.role);
  headers.set('X-Project-Id', String(projectId));

  return stub.fetch(new Request('https://client-room/ws', { headers }));
});

/* ------------------------------------------------------------------ */
/*  Материал илгээх — маягтууд                                         */
/* ------------------------------------------------------------------ */

clientPortal.get('/templates', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, code, name_mn, description_mn, fields_json, filename_pattern,
            allowed_ext, sort_order
       FROM client_submission_templates
      WHERE active = 1
      ORDER BY sort_order, id`,
  ).all<TemplateRow>();

  return c.json({
    templates: results.map((t) => ({ ...t, fields: safeJsonArray(t.fields_json) })),
  });
});

/** Тухайн төсөл + маягтын дараагийн дугаар. */
async function nextSeq(db: D1Database, projectId: number, templateId: number): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM client_submissions
        WHERE project_id = ? AND template_id = ?`,
    )
    .bind(projectId, templateId)
    .first<{ n: number }>();
  return (row?.n ?? 0) + 1;
}

/** `CS-202609-001` — `lib/refNo.ts`-ийн загвар (сар бүр шинээр эхэлнэ). */
async function nextRefNo(db: D1Database, projectId: number, date: string): Promise<string> {
  const ym = date.slice(0, 7);
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM client_submissions
        WHERE project_id = ? AND substr(submitted_at, 1, 7) = ?`,
    )
    .bind(projectId, ym)
    .first<{ n: number }>();
  const seq = (row?.n ?? 0) + 1;
  return `CS-${ym.replace('-', '')}-${String(seq).padStart(3, '0')}`;
}

async function loadNameContext(
  db: D1Database,
  projectId: number,
  templateId: number,
): Promise<{ template: TemplateRow; code: string; seq: number } | null> {
  const template = await db
    .prepare(
      `SELECT id, code, name_mn, description_mn, fields_json, filename_pattern,
              allowed_ext, sort_order
         FROM client_submission_templates WHERE id = ? AND active = 1`,
    )
    .bind(templateId)
    .first<TemplateRow>();
  if (!template) return null;

  const project = await db
    .prepare('SELECT name FROM projects WHERE id = ?')
    .bind(projectId)
    .first<{ name: string }>();
  if (!project) return null;

  return {
    template,
    code: projectCode(project.name),
    seq: await nextSeq(db, projectId, templateId),
  };
}

/**
 * Илгээхээс ӨМНӨ файлын нэр ямар болохыг харуулна.
 *
 * Энэ бол «нэрлэх заавар»-ын оронд гарч ирсэн зүйл: захиалагчид дүрэм
 * тайлбарлахын оронд ҮР ДҮНГ нь шууд үзүүлнэ.
 */
clientPortal.post('/preview-name', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{
    project_id?: number;
    template_id?: number;
    discipline?: string | null;
    rev?: string | null;
    file_names?: string[];
  }>();

  const projectId = Number(body.project_id);
  const templateId = Number(body.template_id);
  if (!Number.isFinite(projectId) || !Number.isFinite(templateId)) {
    return c.json({ error: 'project_id + template_id required' }, 400);
  }
  if (isClient(user.role) && !(await clientAccessLevel(c.env.DB, user.sub, projectId))) {
    return c.json({ error: 'Access denied' }, 403);
  }

  const ctx = await loadNameContext(c.env.DB, projectId, templateId);
  if (!ctx) return c.json({ error: 'Template or project not found' }, 404);

  const today = todayInUB();
  const names = (body.file_names ?? [])
    .slice(0, MAX_FILES_PER_SUBMISSION)
    .map((original, i) =>
      buildFileName(
        ctx.template.filename_pattern,
        {
          project_code: ctx.code,
          doc_type: ctx.template.code,
          discipline: body.discipline ?? null,
          date: today,
          seq: ctx.seq + i,
          rev: body.rev ?? null,
          original,
        },
        original,
      ),
    );

  return c.json({ names: dedupeNames(names) });
});

/* ------------------------------------------------------------------ */
/*  Материал илгээх                                                    */
/* ------------------------------------------------------------------ */

clientPortal.post('/submissions', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{
    project_id?: number;
    template_id?: number;
    title?: string;
    discipline?: string | null;
    rev?: string | null;
    fields?: Record<string, unknown>;
    files?: { key?: string; name?: string; size?: number | null; type?: string | null }[];
  }>();

  const projectId = Number(body.project_id);
  const templateId = Number(body.template_id);
  if (!Number.isFinite(projectId) || !Number.isFinite(templateId)) {
    return c.json({ error: 'project_id + template_id required' }, 400);
  }

  // Илгээх эрх нь ҮЗЭХ эрхээс ӨӨР: `contributor` буюу түүнээс дээш.
  const level = await clientAccessLevel(c.env.DB, user.sub, projectId);
  if (isClient(user.role) && level !== 'contributor' && level !== 'approver') {
    return c.json({ error: 'Материал илгээх эрхгүй байна' }, 403);
  }

  const files = (body.files ?? []).filter((f) => typeof f?.key === 'string' && f.key.length > 0);
  if (files.length === 0) return c.json({ error: 'Файл заавал шаардлагатай' }, 400);
  if (files.length > MAX_FILES_PER_SUBMISSION) return c.json({ error: 'Too many files' }, 413);

  const ctx = await loadNameContext(c.env.DB, projectId, templateId);
  if (!ctx) return c.json({ error: 'Template or project not found' }, 404);

  const allowed = ctx.template.allowed_ext
    ? new Set(
        ctx.template.allowed_ext
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
      )
    : null;

  for (const f of files) {
    const name = String(f.name ?? '');
    // Хар жагсаалт нь архивынхтай ИЖИЛ эх сурвалж — `.exe/.ps1/.html/.svg`.
    if (!isAllowedDocFile(name)) {
      return c.json({ error: `Энэ төрлийн файл зөвшөөрөгдөхгүй: ${name}` }, 400);
    }
    if (allowed) {
      const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
      if (!allowed.has(ext)) {
        return c.json({ error: `Зөвшөөрөгдсөн өргөтгөл: ${ctx.template.allowed_ext}` }, 400);
      }
    }
    // Түлхүүр нь өөрийнх нь байршуулалт мөн эсэх — `client/<sub>-…`.
    // Үүнгүйгээр өөр хүний файлын түлхүүрийг бичиж, хувийн bucket доторх
    // танихгүй объектыг өөрийн илгээмжид холбож болно.
    if (!String(f.key).startsWith(`client/${user.sub}-`)) {
      return c.json({ error: 'Invalid file key' }, 400);
    }
  }

  const today = todayInUB();
  const orgIds = await clientOrgIds(c.env.DB, user.sub);
  const refNo = await nextRefNo(c.env.DB, projectId, today);
  const title = (body.title ?? '').trim() || `${ctx.template.name_mn} — ${today}`;

  const submission = await c.env.DB.prepare(
    `INSERT INTO client_submissions
       (project_id, org_id, template_id, ref_no, title, fields_json, submitted_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     RETURNING id, ref_no, submitted_at`,
  )
    .bind(
      projectId,
      orgIds[0] ?? null,
      templateId,
      refNo,
      title,
      JSON.stringify(body.fields ?? {}),
      user.sub,
    )
    .first<{ id: number; ref_no: string; submitted_at: string }>();
  if (!submission) return c.json({ error: 'Хадгалж чадсангүй' }, 500);

  const canonicalNames = dedupeNames(
    files.map((f, i) =>
      buildFileName(
        ctx.template.filename_pattern,
        {
          project_code: ctx.code,
          doc_type: ctx.template.code,
          discipline: body.discipline ?? null,
          date: today,
          seq: ctx.seq + i,
          rev: body.rev ?? null,
          original: String(f.name ?? ''),
        },
        String(f.name ?? ''),
      ),
    ),
  );

  await c.env.DB.batch(
    files.map((f, i) =>
      c.env.DB.prepare(
        `INSERT INTO client_submission_files
           (submission_id, r2_key, original_name, canonical_name, file_type, file_size, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        submission.id,
        String(f.key),
        String(f.name ?? ''),
        canonicalNames[i] ?? String(f.name ?? ''),
        f.type ?? null,
        f.size ?? null,
        i,
      ),
    ),
  );

  // Ажилтан руу мэдэгдэл — «ирсэн эсэхийг» хэн ч гараар шалгах ёсгүй.
  // Баг тодорхойгүй тул `teamId = null` → `createNotificationForReviewers`
  // нь админ давхарга руу шатална (тэр функцийн 3-р алхам).
  const project = await c.env.DB.prepare('SELECT name FROM projects WHERE id = ?')
    .bind(projectId)
    .first<{ name: string }>();
  await createNotificationForReviewers(
    c.env.DB,
    null,
    'client_submission_received',
    'Захиалагчаас материал ирлээ',
    `${project?.name ?? ''} — ${title} (${refNo})`,
    `/app/projects/${projectId}?tab=client`,
  );

  return c.json(
    {
      submission: { id: submission.id, ref_no: submission.ref_no, status: 'submitted' },
      files: canonicalNames,
    },
    201,
  );
});

/* ------------------------------------------------------------------ */
/*  Миний илгээсэн материал                                            */
/* ------------------------------------------------------------------ */

clientPortal.get('/submissions', async (c) => {
  const user = c.get('user');
  const projectId = Number(c.req.query('project_id'));
  if (!Number.isFinite(projectId)) return c.json({ error: 'project_id required' }, 400);
  if (isClient(user.role) && !(await clientAccessLevel(c.env.DB, user.sub, projectId))) {
    return c.json({ error: 'Access denied' }, 403);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.ref_no, s.title, s.status, s.submitted_at, s.reviewed_at, s.review_note,
            t.name_mn AS template_name,
            (SELECT COUNT(*) FROM client_submission_files f WHERE f.submission_id = s.id) AS file_count
       FROM client_submissions s
       JOIN client_submission_templates t ON t.id = s.template_id
      WHERE s.project_id = ?
      ORDER BY s.id DESC
      LIMIT 100`,
  )
    .bind(projectId)
    .all();

  return c.json({ submissions: results });
});

clientPortal.get('/submissions/:id/files', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  const head = await c.env.DB.prepare('SELECT project_id FROM client_submissions WHERE id = ?')
    .bind(id)
    .first<{ project_id: number }>();
  if (!head) return c.json({ error: 'Not found' }, 404);
  if (isClient(user.role) && !(await clientAccessLevel(c.env.DB, user.sub, head.project_id))) {
    return c.json({ error: 'Access denied' }, 403);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT id, original_name, canonical_name, file_size, file_type
       FROM client_submission_files WHERE submission_id = ? ORDER BY sort_order, id`,
  )
    .bind(id)
    .all<Record<string, unknown>>();

  return c.json({
    files: results.map((f) => ({ ...f, url: `/api/client-files/submission/${Number(f.id)}` })),
  });
});

export default clientPortal;
