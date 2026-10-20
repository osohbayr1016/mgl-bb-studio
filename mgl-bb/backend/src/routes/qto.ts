import { Hono } from 'hono';
import type { Env, AppVariables, UserRole } from '../types';
import { requireRole, requireAdmin } from '../middleware/auth';
import { isAdminRole } from '../types';
import {
  normalizeFactKey,
  normalizeMaterialKey,
  buildResourceAliasIndex,
  resolveResourceCode,
  type ResourceAliasRow,
} from '../lib/resourceMap';
import { withEdgeCache, bustEdgeCache } from '../lib/edgeCache';

// Тоо хэмжээ (QTO) — Revit 2027 add-in-ий түүвэрлэлт (v2).
//
// Түүвэрлэлт Revit add-in дотор явагдана: «Тоо хэмжээ илгээх» товч бүх загварын
// элементийг (category, family, type, level, material) түлхүүрээр нэгтгэж
// POST /revit-runs руу илгээнэ. Fact мөрүүд qto_facts-д (summary_json-д БИШ),
// run бүр qto_runs-д source='revit'-ээр бүртгэгдэнэ. Хуучин browser web-ifc зам
// 2026-07-03-нд устсан — source='ifc' run-ууд түүх болж уншигдахаар үлдсэн.
// Spec: docs/superpowers/specs/2026-07-03-revit-qto-integration-design.md.
//
// Шифр ангилал (resources / resource_alias, migration 0117) Phase 2: одоохондоо
// intake нь confirmed alias байвал auto-map хийгээд үлдсэнийг NULL (ангилаагүй)
// орхино; ангиллын queue/confirm UI + Claude MCP tools дараа нэмэгдэнэ.
//
// Access: үзэх нь admin + senior; илгээх (POST /revit-runs) болон run устгах нь
// admin-only. Clients /client дотор sandbox-логдсон тул энд хүрэхгүй.
const QTO_ROLES: UserRole[] = ['admin', 'senior'];

/** Нэг push-д зөвшөөрөх дээд fact мөр — үүнээс их бол add-in бүлэглэлтээ
 *  алдсан (per-element илгээсэн) гэсэн үг тул хүлээж авахгүй. */
const MAX_ROWS = 20_000;
/** Identity талбаруудын дээд урт. */
const MAX_STR = 256;
/**
 * ⚠️ `combo_key` нь ТАСАРСАН утгуудаас гардаг (normalizeFactKey(category,
 * type_name, material)) тул MAX_STR-ээс урт нэр нь run-diff-ийн join түлхүүрийг
 * чимээгүй хуваах/нийлүүлэх эрсдэлтэй.  Одоохондоо ТООЛООД буцаана
 * (201-ийн `truncated`); `STRICT_IDENTITY = true` болгоход 422-оор татгалзана —
 * тэрийг зөвхөн продакшны qto_facts асуулга 0 таслалт харуулсны ДАРАА,
 * ТУСДАА deploy-д асаана.  MAX_STR-ийн УТГЫГ хөдөлгөж БОЛОХГҮЙ: түүхэн бүх
 * мөр 256-аар таслагдсан тул хязгаарыг өсгөвөл шинэ run-ууд хуучинтайгаа
 * join хийхээ болино.
 */
const STRICT_IDENTITY: boolean = false;

const qto = new Hono<{ Bindings: Env; Variables: AppVariables }>();

qto.use('*', requireRole(...QTO_ROLES));

export interface QtoRunRow {
  id: number;
  project_id: number;
  created_by: number;
  model_url: string;
  file_name: string | null;
  file_size: number | null;
  schema_version: string | null;
  element_count: number;
  flag_count: number;
  total_volume_m3: number | null;
  total_area_m2: number | null;
  summary_json: string;
  source: string;
  created_at: string;
}

// GET /api/qto/projects-overview — нэг дуудлагаар бүх төслийн QTO статус.
// Тоо хэмжээ хуудасны зүүн рэйлийг дүүргэнэ: төсөл бүрийн сүүлийн run-ийн товч
// үзүүлэлт + нийт run тоо + ангилаагүй fact тоо. admin+senior хоёул бүх төслийг
// хардаг тул visibility scoping шаардлагагүй. LEFT JOIN тул run байхгүй төсөл ч
// жагсаалтад орно — «Тоо хэмжээ илгээгдээгүй» гэдгийг харуулна.
qto.get('/projects-overview', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT
        p.id              AS project_id,
        p.name            AS project_name,
        p.display_title   AS display_title,
        p.status          AS status,
        r.id              AS latest_run_id,
        r.created_at      AS latest_run_at,
        r.file_name       AS latest_file_name,
        r.source          AS latest_run_source,
        r.element_count   AS element_count,
        r.total_volume_m3 AS total_volume_m3,
        r.total_area_m2   AS total_area_m2,
        (SELECT COUNT(*) FROM qto_runs cnt WHERE cnt.project_id = p.id) AS run_count,
        (SELECT COUNT(*) FROM qto_facts f
          WHERE f.qto_run_id = r.id AND f.resource_code IS NULL) AS unmapped_facts
       FROM projects p
       LEFT JOIN qto_runs r
         ON r.id = (
           SELECT r2.id FROM qto_runs r2
            WHERE r2.project_id = p.id
            ORDER BY r2.created_at DESC, r2.id DESC
            LIMIT 1
         )
      ORDER BY (r.id IS NULL), r.created_at DESC,
               p.is_asap DESC, p.sort_order ASC, p.created_at DESC`,
  ).all();

  return c.json({ projects: results });
});

// GET /api/qto/projects/:id/dashboard — Самбар: төслийн ФАЙЛ бүрийн сүүлийн
// run-уудыг нэгтгэсэн aggregate. Add-in файл тус бүрд тусдаа run илгээдэг
// (Decision #2) тул «сүүлийн төлөв» = distinct file_name бүрийн хамгийн шинэ
// run. Түүхий fact-уудыг буцаахгүй (12 файл × 20k мөр = MB-ууд) — run_id-аар
// түлхүүрлэсэн хоёр aggregate буцаана, файл on/off toggle нь client талд
// refetch-гүй явагдана. Type-level drill нь одоогийн GET /runs/:id/facts-ыг
// дахин ашиглана. Legacy source='ifc' run-ууд qto_facts-гүй тул орохгүй.
qto.get('/projects/:id/dashboard', async (c) => {
  const projectId = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(projectId)) return c.json({ error: 'Bad project id' }, 400);

  const project = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ?')
    .bind(projectId)
    .first<{ id: number }>();
  if (!project) return c.json({ error: 'Project not found' }, 404);

  // admin+senior хоёул ижил өгөгдөл хардаг тул зөвхөн төслөөр vary хийнэ.
  return withEdgeCache(c, { key: 'qto:dashboard', varyTags: [projectId], ttlSeconds: 60 }, async () => {
    interface FileRow {
      run_id: number;
      file_name: string | null;
      source: string;
      created_at: string;
      created_by_name: string | null;
      element_count: number;
      total_volume_m3: number | null;
      total_area_m2: number | null;
      summary_json: string;
      fact_count: number;
      unmapped_facts: number;
    }
    const { results: fileRows } = await c.env.DB.prepare(
      `SELECT r.id AS run_id, r.file_name, r.source, r.created_at,
              u.full_name AS created_by_name,
              r.element_count, r.total_volume_m3, r.total_area_m2, r.summary_json,
              (SELECT COUNT(*) FROM qto_facts f WHERE f.qto_run_id = r.id) AS fact_count,
              (SELECT COUNT(*) FROM qto_facts f
                WHERE f.qto_run_id = r.id AND f.resource_code IS NULL) AS unmapped_facts
         FROM qto_runs r
         LEFT JOIN users u ON u.id = r.created_by
        WHERE r.project_id = ?1 AND r.source = 'revit'
          AND r.id = (
            SELECT r2.id FROM qto_runs r2
             WHERE r2.project_id = ?1 AND r2.source = 'revit'
               AND r2.file_name = r.file_name
             ORDER BY r2.created_at DESC, r2.id DESC LIMIT 1)
        ORDER BY r.element_count DESC, r.file_name ASC
        LIMIT 40`,
    )
      .bind(projectId)
      .all<FileRow>();

    const files = (fileRows ?? []).map((row) => {
      // Компакт summary-гээс бүрэн totals (length/mass run баганад байдаггүй);
      // эвдэрсэн JSON бол run багануудаар fallback — 500 хэзээ ч буцаахгүй.
      let totals: {
        count: number;
        length_m: number | null;
        area_m2: number | null;
        volume_m3: number | null;
        mass_kg: number | null;
      } = {
        count: row.element_count,
        length_m: null,
        area_m2: row.total_area_m2,
        volume_m3: row.total_volume_m3,
        mass_kg: null,
      };
      try {
        const parsed = JSON.parse(row.summary_json) as { totals?: typeof totals };
        if (parsed?.totals && typeof parsed.totals.count === 'number') {
          totals = parsed.totals;
        }
      } catch {
        // fallback хэвээр
      }
      return {
        run_id: row.run_id,
        file_name: row.file_name,
        source: row.source,
        created_at: row.created_at,
        created_by_name: row.created_by_name,
        element_count: row.element_count,
        fact_count: row.fact_count,
        unmapped_facts: row.unmapped_facts,
        totals,
      };
    });

    if (files.length === 0) {
      return {
        files: [],
        by_category: [],
        by_level: [],
        by_type: [],
        truncated: false,
        by_type_truncated: false,
        generated_at: new Date().toISOString(),
      };
    }

    const runIds = files.map((f) => f.run_id);
    const placeholders = runIds.map(() => '?').join(', ');
    const METRICS = `SUM(f.count)                  AS count,
              SUM(COALESCE(f.length_m, 0))  AS length_m,
              SUM(COALESCE(f.area_m2, 0))   AS area_m2,
              SUM(COALESCE(f.volume_m3, 0)) AS volume_m3,
              SUM(COALESCE(f.mass_kg, 0))   AS mass_kg`;

    // type_count = категори доторх ЖИНХЭНЭ төрлийн тоо — by_type-ийн cap-аас
    // хамааралгүй тул картын «+N төрөл» хөл ба caption үргэлж зөв.
    const { results: byCategory } = await c.env.DB.prepare(
      `SELECT f.qto_run_id AS run_id, f.category, ${METRICS},
              COUNT(DISTINCT f.family || '|' || f.type_name) AS type_count
         FROM qto_facts f
        WHERE f.qto_run_id IN (${placeholders})
        GROUP BY f.qto_run_id, f.category`,
    )
      .bind(...runIds)
      .all();

    // level×category грайн файл олонтой үед томорч болно — хатуу cap + флаг.
    const { results: byLevelRaw } = await c.env.DB.prepare(
      `SELECT f.qto_run_id AS run_id, f.level, f.category, ${METRICS}
         FROM qto_facts f
        WHERE f.qto_run_id IN (${placeholders})
        GROUP BY f.qto_run_id, f.level, f.category
        LIMIT 10001`,
    )
      .bind(...runIds)
      .all();

    const byLevel = byLevelRaw ?? [];
    const truncated = byLevel.length === 10001;
    if (truncated) byLevel.pop();

    // Самбарын type-түвшний харагдац (карт/хайлт/Table горим). Глобал cap:
    // хамгийн олон тоотой 4000 мөр — жижиг type-ууд л унадаг тул зөөлөн
    // доройтно; тусдаа флагтай (level-ийн `truncated`-тай бүү холь).
    const { results: byTypeRaw } = await c.env.DB.prepare(
      `SELECT f.qto_run_id AS run_id, f.category, f.family, f.type_name, ${METRICS},
              MAX(f.type_mark)     AS type_mark,
              MAX(f.assembly_code) AS assembly_code
         FROM qto_facts f
        WHERE f.qto_run_id IN (${placeholders})
        GROUP BY f.qto_run_id, f.category, f.family, f.type_name
        ORDER BY SUM(f.count) DESC
        LIMIT 4001`,
    )
      .bind(...runIds)
      .all();

    const byType = byTypeRaw ?? [];
    const byTypeTruncated = byType.length === 4001;
    if (byTypeTruncated) byType.pop();

    // Өрөөний ведомость (0120) — run-уудын нийт өрөө; давхар+дугаараар
    // эрэмбэлээд 2000-д cap-лана (нэг барилгад хангалттай их).
    const { results: byRoomRaw } = await c.env.DB.prepare(
      `SELECT r.qto_run_id AS run_id, r.number, r.name, r.level, r.area_m2
         FROM qto_rooms r
        WHERE r.qto_run_id IN (${placeholders})
        ORDER BY r.level, r.number
        LIMIT 2001`,
    )
      .bind(...runIds)
      .all();

    const byRoom = byRoomRaw ?? [];
    const roomsTruncated = byRoom.length === 2001;
    if (roomsTruncated) byRoom.pop();

    return {
      files,
      by_category: byCategory ?? [],
      by_level: byLevel,
      by_type: byType,
      by_room: byRoom,
      truncated,
      by_type_truncated: byTypeTruncated,
      rooms_truncated: roomsTruncated,
      generated_at: new Date().toISOString(),
    };
  });
});

// GET /api/qto/projects/:id/views — тухайн төслийн бүртгэлтэй план PDF-үүд
// (add-in-ий «PDF илгээх» товчоор орж ирдэг, R2 /media/*-д хадгалагдсан).
qto.get('/projects/:id/views', async (c) => {
  const projectId = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(projectId)) return c.json({ error: 'Bad project id' }, 400);

  const { results } = await c.env.DB.prepare(
    `SELECT v.id, v.qto_run_id, v.view_name, v.file_name, v.media_url, v.created_at,
            u.full_name AS created_by_name
       FROM qto_view_exports v
       LEFT JOIN users u ON u.id = v.created_by
      WHERE v.project_id = ?
      ORDER BY v.created_at DESC
      LIMIT 100`,
  )
    .bind(projectId)
    .all();

  return c.json({ views: results });
});

// POST /api/qto/view-exports — add-in план PDF-ээ /api/upload?bucket=media-аар
// R2-д оруулсны дараа энд бүртгүүлнэ. media_url зөвхөн /media/<key> хэлбэр —
// гадны URL оруулахаас сэргийлнэ.
qto.post('/view-exports', requireAdmin(), async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{
    project_id?: number;
    qto_run_id?: number;
    view_name?: string;
    file_name?: string;
    media_url?: string;
  }>();

  const projectId = Number(body.project_id);
  if (!Number.isFinite(projectId)) return c.json({ error: 'project_id is required' }, 400);
  const viewName = String(body.view_name ?? '').trim().slice(0, MAX_STR);
  if (!viewName) return c.json({ error: 'view_name is required' }, 400);
  const mediaUrl = String(body.media_url ?? '').trim();
  if (!/^\/media\/[A-Za-z0-9._-]+$/.test(mediaUrl)) {
    return c.json({ error: 'media_url must be a /media/<key> path' }, 400);
  }

  const project = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ?')
    .bind(projectId)
    .first<{ id: number }>();
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const runId = Number.isFinite(Number(body.qto_run_id)) ? Number(body.qto_run_id) : null;
  const fileName = String(body.file_name ?? '').trim().slice(0, MAX_STR) || null;

  const res = await c.env.DB.prepare(
    `INSERT INTO qto_view_exports
       (project_id, qto_run_id, view_name, file_name, media_url, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(projectId, runId, viewName, fileName, mediaUrl, user.sub)
    .run();

  return c.json({ id: Number(res.meta.last_row_id) }, 201);
});

// DELETE /api/qto/view-exports/:id — админ. R2 объектыг санаатайгаар үлдээнэ
// (бусад feature-үүдийн адил: /media түүх append-only, бүртгэл л устна).
qto.delete('/view-exports/:id', requireAdmin(), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const row = await c.env.DB.prepare('SELECT id FROM qto_view_exports WHERE id = ?')
    .bind(id)
    .first<{ id: number }>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  await c.env.DB.prepare('DELETE FROM qto_view_exports WHERE id = ?').bind(id).run();
  return c.json({ message: 'Deleted' });
});

/* ---- Ведомость (Revit Schedule/Quantities, 0121) ------------------------- */

/** Нэг push-д зөвшөөрөх ведомостын дээд тоо ба хэмжээсүүд. */
const MAX_SCHEDULES = 60;
const MAX_SCHEDULE_ROWS = 5_000;
const MAX_SCHEDULE_COLS = 40;
const MAX_CELL = 500;

// GET /api/qto/projects/:id/schedules — мета жагсаалт (rows_json-гүй, хөнгөн).
qto.get('/projects/:id/schedules', async (c) => {
  const projectId = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(projectId)) return c.json({ error: 'Bad project id' }, 400);

  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.file_name, s.name, s.category, s.row_count, s.created_at,
            u.full_name AS created_by_name
       FROM qto_schedules s
       LEFT JOIN users u ON u.id = s.created_by
      WHERE s.project_id = ?
      ORDER BY s.category, s.name
      LIMIT 300`,
  )
    .bind(projectId)
    .all();

  return c.json({ schedules: results });
});

// GET /api/qto/schedules/:id — нэг ведомостын бүрэн агуулга.
qto.get('/schedules/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const row = await c.env.DB.prepare(
    `SELECT id, project_id, file_name, name, category, columns_json, rows_json,
            row_count, created_at
       FROM qto_schedules WHERE id = ?`,
  )
    .bind(id)
    .first<{
      id: number;
      project_id: number;
      file_name: string;
      name: string;
      category: string;
      columns_json: string;
      rows_json: string;
      row_count: number;
      created_at: string;
    }>();
  if (!row) return c.json({ error: 'Not found' }, 404);

  let columns: string[] = [];
  let rows: string[][] = [];
  try {
    columns = JSON.parse(row.columns_json) as string[];
    rows = JSON.parse(row.rows_json) as string[][];
  } catch {
    // эвдэрсэн JSON — хоосон буцаана (500 хэзээ ч биш)
  }
  return c.json({
    schedule: {
      id: row.id,
      project_id: row.project_id,
      file_name: row.file_name,
      name: row.name,
      category: row.category,
      row_count: row.row_count,
      created_at: row.created_at,
      columns,
      rows,
    },
  });
});

// POST /api/qto/schedules — add-in-ий «Хүснэгт илгээх» (admin-only).
// REPLACE семантик: илгээгдсэн (file_name, name) хослолуудын хуучин мөрийг
// устгаад шинээр бичнэ — Revit доторх сүүлийн төлөв л вэбэд харагдана.
qto.post('/schedules', requireAdmin(), async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{
    project_id?: number;
    file_name?: string;
    schedules?: {
      name?: string;
      category?: string;
      columns?: unknown[];
      rows?: unknown[][];
    }[];
  }>();

  const projectId = Number(body.project_id);
  const fileName = str(body.file_name);
  if (!Number.isFinite(projectId) || !Array.isArray(body.schedules) || body.schedules.length === 0) {
    return c.json({ error: 'project_id and schedules are required' }, 400);
  }
  if (body.schedules.length > MAX_SCHEDULES) {
    return c.json({ error: `Too many schedules (max ${MAX_SCHEDULES})` }, 413);
  }

  const project = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ?')
    .bind(projectId)
    .first<{ id: number }>();
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const cell = (v: unknown): string =>
    typeof v === 'string' ? v.slice(0, MAX_CELL) : v == null ? '' : String(v).slice(0, MAX_CELL);

  interface PreparedSchedule {
    name: string;
    category: string;
    columns: string[];
    rows: string[][];
  }
  const prepared: PreparedSchedule[] = [];
  for (const s of body.schedules) {
    if (!s || typeof s !== 'object') continue;
    const name = str(s.name);
    if (!name) continue;
    const columns = (Array.isArray(s.columns) ? s.columns : [])
      .slice(0, MAX_SCHEDULE_COLS)
      .map(cell);
    const rows = (Array.isArray(s.rows) ? s.rows : [])
      .slice(0, MAX_SCHEDULE_ROWS)
      .map((r) => (Array.isArray(r) ? r.slice(0, MAX_SCHEDULE_COLS).map(cell) : []));
    prepared.push({ name, category: str(s.category), columns, rows });
  }
  if (prepared.length === 0) return c.json({ error: 'No valid schedules' }, 400);

  const stmts = [
    c.env.DB.prepare(
      `DELETE FROM qto_schedules
        WHERE project_id = ? AND file_name = ?
          AND name IN (${prepared.map(() => '?').join(', ')})`,
    ).bind(projectId, fileName, ...prepared.map((s) => s.name)),
    ...prepared.map((s) =>
      c.env.DB.prepare(
        `INSERT INTO qto_schedules
           (project_id, file_name, name, category, columns_json, rows_json, row_count, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        projectId,
        fileName,
        s.name,
        s.category,
        JSON.stringify(s.columns),
        JSON.stringify(s.rows),
        s.rows.length,
        user.sub,
      ),
    ),
  ];
  await c.env.DB.batch(stmts);

  return c.json(
    {
      saved: prepared.length,
      rows: prepared.reduce((sum, s) => sum + s.rows.length, 0),
    },
    201,
  );
});

// DELETE /api/qto/schedules/:id — админ ведомость устгана.
qto.delete('/schedules/:id', requireAdmin(), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const row = await c.env.DB.prepare('SELECT id FROM qto_schedules WHERE id = ?')
    .bind(id)
    .first<{ id: number }>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  await c.env.DB.prepare('DELETE FROM qto_schedules WHERE id = ?').bind(id).run();
  return c.json({ message: 'Deleted' });
});

// GET /api/qto/runs?project_id=N — run history for a project, newest first.
// summary_json is intentionally excluded: lists stay cheap, details come
// from GET /runs/:id.
qto.get('/runs', async (c) => {
  const projectId = parseInt(c.req.query('project_id') ?? '', 10);
  if (!Number.isFinite(projectId)) {
    return c.json({ error: 'project_id is required' }, 400);
  }
  const limit = Math.min(parseInt(c.req.query('limit') ?? '30', 10) || 30, 100);

  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.project_id, r.created_by, u.full_name AS created_by_name,
            r.model_url, r.file_name, r.file_size, r.schema_version,
            r.element_count, r.flag_count, r.total_volume_m3, r.total_area_m2,
            r.source, r.created_at,
            (SELECT COUNT(*) FROM qto_facts f WHERE f.qto_run_id = r.id) AS fact_count,
            (SELECT COUNT(*) FROM qto_facts f
              WHERE f.qto_run_id = r.id AND f.resource_code IS NULL) AS unmapped_facts
       FROM qto_runs r
       LEFT JOIN users u ON u.id = r.created_by
      WHERE r.project_id = ?
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ?`,
  )
    .bind(projectId, limit)
    .all();

  return c.json({ runs: results });
});

// GET /api/qto/runs/:id — one run including the parsed summary.
qto.get('/runs/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const row = await c.env.DB.prepare('SELECT * FROM qto_runs WHERE id = ?')
    .bind(id)
    .first<QtoRunRow>();
  if (!row) return c.json({ error: 'Run not found' }, 404);

  let summary: unknown = null;
  try {
    summary = JSON.parse(row.summary_json);
  } catch {
    // Corrupt JSON shouldn't 500 the whole detail view — surface the
    // metadata and let the client treat the summary as missing.
  }
  const { summary_json: _omit, ...meta } = row;
  return c.json({ run: { ...meta, summary } });
});

// GET /api/qto/runs/:id/facts — run-ийн бүх fact мөр, resources-тэй JOIN-той.
// Pivot (Category/Материал/Давхар/Шифр) болон diff-ийг client тал хийдэг тул
// нэг дуудлагаар бүх мөрийг өгнө (MAX_ROWS cap intake дээр байгаа тул энд
// хязгаар давахгүй).
qto.get('/runs/:id/facts', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid run id' }, 400);

  const run = await c.env.DB.prepare('SELECT id FROM qto_runs WHERE id = ?')
    .bind(id)
    .first<{ id: number }>();
  if (!run) return c.json({ error: 'Run not found' }, 404);

  const { results } = await c.env.DB.prepare(
    `SELECT f.id, f.category, f.family, f.type_name, f.level, f.material,
            f.count, f.length_m, f.area_m2, f.volume_m3, f.mass_kg,
            f.type_mark, f.marks, f.thickness_mm, f.assembly_code, f.keynote,
            f.combo_key, f.resource_code, f.mapped_via,
            r.name AS resource_name, r.group_code AS resource_group, r.unit AS resource_unit
       FROM qto_facts f
       LEFT JOIN resources r ON r.code = f.resource_code
      WHERE f.qto_run_id = ?
      ORDER BY f.category, f.family, f.type_name, f.level, f.material`,
  )
    .bind(id)
    .all();

  return c.json({ facts: results });
});

interface RevitRunRow {
  category?: string;
  family?: string;
  type_name?: string;
  level?: string;
  material?: string;
  count?: number;
  length_m?: number | null;
  area_m2?: number | null;
  volume_m3?: number | null;
  mass_kg?: number | null;
  // 0120: төсөвчний талбарууд — combo_key-д ОРДОГГҮЙ, зөвхөн мэдээллийн.
  type_mark?: string | null;
  marks?: string | null;
  thickness_mm?: number | null;
  assembly_code?: string | null;
  keynote?: string | null;
}

/** Өрөөний ведомостын нэг мөр (0120) — BA host файлаас л ирдэг. */
interface RevitRoomRow {
  number?: string;
  name?: string;
  level?: string;
  area_m2?: number | null;
}

/** Нэг push-д зөвшөөрөх өрөөний дээд тоо. */
const MAX_ROOMS = 5_000;

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const str = (v: unknown): string =>
  typeof v === 'string' ? v.trim().slice(0, MAX_STR) : '';

/** Нэг push-ийн туршид identity талбарын таслалтыг тоолох хураагуур. */
interface TruncCounter {
  n: number;
  longest: number;
  sample: string | null;
}

/** `str`-ийн тоолууртай хувилбар — ЗӨВХӨН `combo_key`-д ордог талбаруудад
 *  хэрэглэнэ (file_name, category, type_name, material).  `str`-ийг СОЛИХГҮЙ:
 *  бусад 20 гаруй дуудлага түүнийг хэвээр ашиглана. */
const strCounted = (v: unknown, ctr: TruncCounter): string => {
  if (typeof v !== 'string') return '';
  const t = v.trim();
  if (t.length <= MAX_STR) return t;
  ctr.n++;
  if (t.length > ctr.longest) {
    ctr.longest = t.length;
    ctr.sample = t.slice(0, 80);
  }
  return t.slice(0, MAX_STR);
};

// POST /api/qto/revit-runs — Revit add-in-ий push (admin-only).
// Нэг db.batch() дотор run + fact мөрүүд бичигдэнэ (batch нь transactional).
// push_id давхардвал 409 — add-in retry хийхэд давхар run үүсэхгүй.
qto.post('/revit-runs', requireAdmin(), async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{
    project_id?: number;
    file_name?: string;
    revit_version?: string;
    push_id?: string;
    rows?: RevitRunRow[];
    rooms?: RevitRoomRow[];
    totals?: {
      count?: number;
      length_m?: number;
      area_m2?: number;
      volume_m3?: number;
      mass_kg?: number;
    };
  }>();

  // combo_key-ийн оролт таслагдсан эсэхийг тоолно (§3.3).  Мөрийн давталтын
  // ДАРАА, runInsert-ийн ӨМНӨ шалгагдана — retry-ийн семантик хэвээр.
  const trunc: TruncCounter = { n: 0, longest: 0, sample: null };
  const projectId = Number(body.project_id);
  const fileName = strCounted(body.file_name, trunc);
  if (!Number.isFinite(projectId) || !fileName || !Array.isArray(body.rows) || body.rows.length === 0) {
    return c.json({ error: 'project_id, file_name and rows are required' }, 400);
  }
  if (body.rows.length > MAX_ROWS) {
    // max_rows / got нь add-in-д УРЬДЧИЛСАН шалгалт хийх тоог өгнө
    // (ScheduleReader.cs:15-16-ийн загвар — клиент сервертэй ижил тоог мэднэ).
    return c.json(
      {
        error: `Too many rows (max ${MAX_ROWS}) — add-in must aggregate`,
        max_rows: MAX_ROWS,
        got: body.rows.length,
      },
      413,
    );
  }

  const project = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ?')
    .bind(projectId)
    .first<{ id: number }>();
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const pushId = str(body.push_id) || null;
  if (pushId) {
    const dup = await c.env.DB.prepare(
      'SELECT id FROM qto_runs WHERE project_id = ? AND push_id = ?',
    )
      .bind(projectId, pushId)
      .first<{ id: number }>();
    if (dup) return c.json({ error: 'Duplicate push', run_id: dup.id }, 409);
  }

  // Confirmed alias-уудыг ачаалж auto-map хийнэ (Phase 2-т admin queue-ээс
  // баталгаажсан mapping-ууд энд өөрөө үйлчилж эхэлнэ). Глобал мөрүүд ЭХЭНД
  // (DESC) — төслийн override сүүлд бичигдэж ялна.
  const { results: aliasRows } = await c.env.DB.prepare(
    `SELECT raw_norm, key_kind, resource_code
       FROM resource_alias
      WHERE status = 'confirmed' AND (project_id IS NULL OR project_id = ?)
      ORDER BY (project_id IS NULL) DESC`,
  )
    .bind(projectId)
    .all<ResourceAliasRow>();
  const aliasIdx = buildResourceAliasIndex(aliasRows);

  // Мөрүүдийг норчилж, түлхүүр + шифр кодыг тооцоолно.
  interface PreparedFact {
    category: string;
    family: string;
    type_name: string;
    level: string;
    material: string;
    count: number;
    length_m: number | null;
    area_m2: number | null;
    volume_m3: number | null;
    mass_kg: number | null;
    combo_key: string;
    material_key: string | null;
    resource_code: string | null;
    type_mark: string | null;
    marks: string | null;
    thickness_mm: number | null;
    assembly_code: string | null;
    keynote: string | null;
  }
  const facts: PreparedFact[] = [];
  const byCategory = new Map<string, { count: number; volume_m3: number; mass_kg: number }>();
  const totals = { count: 0, length_m: 0, area_m2: 0, volume_m3: 0, mass_kg: 0 };
  let mapped = 0;
  const unmappedKeys = new Map<
    string,
    { combo_key: string; category: string; type_name: string; material: string; fact_count: number }
  >();

  for (const row of body.rows) {
    if (!row || typeof row !== 'object') continue;
    const category = strCounted(row.category, trunc);
    const typeName = strCounted(row.type_name, trunc);
    const material = strCounted(row.material, trunc);
    const comboKey = normalizeFactKey(category, typeName, material);
    const materialKey = normalizeMaterialKey(material);
    const resourceCode = resolveResourceCode(aliasIdx, comboKey, materialKey);

    const fact: PreparedFact = {
      category,
      family: str(row.family),
      type_name: typeName,
      level: str(row.level),
      material,
      count: Math.round(num(row.count) ?? 0),
      length_m: num(row.length_m),
      area_m2: num(row.area_m2),
      volume_m3: num(row.volume_m3),
      mass_kg: num(row.mass_kg),
      combo_key: comboKey,
      material_key: materialKey,
      resource_code: resourceCode,
      type_mark: str(row.type_mark) || null,
      marks: str(row.marks) || null,
      thickness_mm: num(row.thickness_mm),
      assembly_code: str(row.assembly_code) || null,
      keynote: str(row.keynote) || null,
    };
    facts.push(fact);

    totals.count += fact.count;
    totals.length_m += fact.length_m ?? 0;
    totals.area_m2 += fact.area_m2 ?? 0;
    totals.volume_m3 += fact.volume_m3 ?? 0;
    totals.mass_kg += fact.mass_kg ?? 0;

    const cat = byCategory.get(category) ?? { count: 0, volume_m3: 0, mass_kg: 0 };
    cat.count += fact.count;
    cat.volume_m3 += fact.volume_m3 ?? 0;
    cat.mass_kg += fact.mass_kg ?? 0;
    byCategory.set(category, cat);

    if (resourceCode) {
      mapped++;
    } else {
      const u = unmappedKeys.get(comboKey);
      if (u) u.fact_count++;
      else
        unmappedKeys.set(comboKey, {
          combo_key: comboKey,
          category,
          type_name: typeName,
          material,
          fact_count: 1,
        });
    }
  }
  if (facts.length === 0) return c.json({ error: 'No valid rows' }, 400);

  // Identity таслалт — `combo_key` тогтвортой байдлын хамгаалалт.  Энэ шалгалт
  // мөрийн давталтын ДАРАА, runInsert-ийн ӨМНӨ байх ёстой: 422 буувал DB-д юу ч
  // үлдэхгүй, push_id дедупликацын семантик ч өөрчлөгдөхгүй.
  if (trunc.n > 0) {
    if (STRICT_IDENTITY) {
      return c.json(
        {
          error: `Identity field longer than ${MAX_STR} chars — combo_key would split`,
          truncated: trunc.n,
          longest: trunc.longest,
          sample: trunc.sample,
        },
        422,
      );
    }
    console.warn(
      `[qto] identity truncation: project=${projectId} file=${fileName} ` +
        `count=${trunc.n} longest=${trunc.longest} sample=${JSON.stringify(trunc.sample)}`,
    );
  }

  // Компакт v2 summary — жагсаалт/МCP-д хангалттай; fact-ууд qto_facts-д.
  const summary = {
    schema_version: 'revit-1',
    source: 'revit',
    revit_version: str(body.revit_version) || null,
    totals,
    by_category: [...byCategory.entries()]
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.mass_kg - a.mass_kg || b.volume_m3 - a.volume_m3)
      .slice(0, 50),
    mapped: {
      facts: facts.length,
      mapped,
      unmapped: facts.length - mapped,
      distinct_unmapped_keys: unmappedKeys.size,
    },
  };

  const runInsert = c.env.DB.prepare(
    `INSERT INTO qto_runs
       (project_id, created_by, model_url, file_name, file_size, schema_version,
        element_count, flag_count, total_volume_m3, total_area_m2, summary_json,
        source, push_id)
     VALUES (?, ?, ?, ?, NULL, ?, ?, 0, ?, ?, ?, 'revit', ?)`,
  ).bind(
    projectId,
    user.sub,
    `revit://${fileName}`,
    fileName,
    'revit-2027',
    totals.count,
    totals.volume_m3,
    totals.area_m2,
    JSON.stringify(summary),
    pushId,
  );

  const runRes = await c.env.DB.batch([runInsert]);
  const first = runRes[0];
  if (!first?.success) return c.json({ error: 'Failed to insert run' }, 500);
  const runId = Number(first.meta.last_row_id);

  // Fact insert — 4 мөр/statement (21 bind × 4 = 84 ≤ D1-ийн 100 bind хязгаар).
  // Run мөр аль хэдийн commit болсон тул fact batch унавал run-ыг устгаж
  // цэвэрлэнэ (fact-ууд дахин push-аар сэргээгдэх өгөгдөл).
  const FACT_SQL_ONE = '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
  const factBind = (f: PreparedFact) => [
    projectId,
    runId,
    f.category,
    f.family,
    f.type_name,
    f.level,
    f.material,
    f.count,
    f.length_m,
    f.area_m2,
    f.volume_m3,
    f.mass_kg,
    f.combo_key,
    f.material_key,
    f.resource_code,
    f.resource_code ? 'alias' : null,
    f.type_mark,
    f.marks,
    f.thickness_mm,
    f.assembly_code,
    f.keynote,
  ];
  const stmts = [];
  for (let i = 0; i < facts.length; i += 4) {
    const chunk = facts.slice(i, i + 4);
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO qto_facts
           (project_id, qto_run_id, category, family, type_name, level, material,
            count, length_m, area_m2, volume_m3, mass_kg,
            combo_key, material_key, resource_code, mapped_via,
            type_mark, marks, thickness_mm, assembly_code, keynote)
         VALUES ${chunk.map(() => FACT_SQL_ONE).join(', ')}`,
      ).bind(...chunk.flatMap(factBind)),
    );
  }
  // Өрөөний ведомость (BA host файлаас; талбайгүйг add-in талд шүүсэн).
  // 6 bind/мөр × 16 = 96 ≤ 100.
  const roomRows = (Array.isArray(body.rooms) ? body.rooms : [])
    .filter((r) => r && typeof r === 'object')
    .slice(0, MAX_ROOMS);
  const ROOM_SQL_ONE = '(?, ?, ?, ?, ?, ?)';
  for (let i = 0; i < roomRows.length; i += 16) {
    const chunk = roomRows.slice(i, i + 16);
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO qto_rooms (project_id, qto_run_id, number, name, level, area_m2)
         VALUES ${chunk.map(() => ROOM_SQL_ONE).join(', ')}`,
      ).bind(
        ...chunk.flatMap((r) => [
          projectId,
          runId,
          str(r.number),
          str(r.name),
          str(r.level),
          num(r.area_m2),
        ]),
      ),
    );
  }
  try {
    await c.env.DB.batch(stmts);
  } catch (err) {
    await c.env.DB.prepare('DELETE FROM qto_runs WHERE id = ?').bind(runId).run();
    return c.json(
      { error: `Failed to insert facts: ${err instanceof Error ? err.message : String(err)}` },
      500,
    );
  }

  // Самбарын кэш энэ төслийн хувьд хуучирлаа — шинэ run орсон.
  await bustEdgeCache(c, { key: 'qto:dashboard', varyTags: [projectId] });

  return c.json(
    {
      run_id: runId,
      facts: facts.length,
      mapped,
      unmapped: facts.length - mapped,
      truncated: trunc.n, // 0 бол бүх identity талбар бүрэн (combo_key найдвартай)
      unmapped_keys: [...unmappedKeys.values()].slice(0, 50),
    },
    201,
  );
});

// DELETE /api/qto/runs/:id — admin tier, or the senior who created the run.
// qto_facts нь ON DELETE CASCADE тул хамт устна.
qto.delete('/runs/:id', async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'), 10);
  const row = await c.env.DB.prepare('SELECT created_by, project_id FROM qto_runs WHERE id = ?')
    .bind(id)
    .first<{ created_by: number; project_id: number }>();
  if (!row) return c.json({ error: 'Run not found' }, 404);

  if (!isAdminRole(user.role) && row.created_by !== user.sub) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  await c.env.DB.prepare('DELETE FROM qto_runs WHERE id = ?').bind(id).run();
  // Самбарын кэш энэ төслийн хувьд хуучирлаа — run устлаа.
  await bustEdgeCache(c, { key: 'qto:dashboard', varyTags: [row.project_id] });
  return c.json({ message: 'Run deleted' });
});

export default qto;
