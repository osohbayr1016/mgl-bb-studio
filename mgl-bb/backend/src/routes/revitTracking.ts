import { Hono } from 'hono';
import type { Env, AppVariables, UserRole } from '../types';
import { requireRole, requireAdmin } from '../middleware/auth';
import { todayInUB } from '../lib/time';
import {
  MAX_SEGMENTS_PER_SYNC,
  STALE_AFTER_MS,
  addDays,
  cleanId,
  cleanState,
  isWorkDate,
  liveStatusOf,
  pickSession,
  statusRank,
  validateSegment,
  type LiveStatus,
  type ValidSegment,
} from '../lib/revitTracking';

/**
 * REVIT-ИЙН АВТОМАТ ЦАГ БҮРТГЭЛ (migration 0360) — `/api/revit`-ийн ХОЁР ДАХЬ mount.
 *
 *   POST /tracking/sync  — add-in 10 с тутам: heartbeat + ХУРИМТЛАЛЫН сегментүүд.
 *   GET  /tracking/day   — ЗӨВХӨН admin: нэг ажилтны нэг өдрийн таск тутмын Revit
 *                          цаг + явцын бичлэг (оношилгоо).
 *   GET  /tracking/live  — ЗӨВХӨН admin: хэн одоо юун дээр ажиллаж байна (оношилгоо).
 *
 * ⚠️ ДАЛД СИСТЕМ (эзний шийдвэр 2026-09-29): албан ёсны цаг нь гараар удирдах
 *    Play/Pause таймер (тусдаа систем).  Энэ бүртгэл ажилласаар боловч ERP-ийн
 *    ямар ч хуудас, цэс, ажилтны самбар ХАРУУЛАХГҮЙ, албан таймертай ХОЛИХГҮЙ.
 *    Хоёр унших зам нь admin-only оношилгоо — UI-д холбохоос өмнө эзнээс асуу.
 *
 * Хэмжиж буй зүйл: «ОДООГИЙН ERP таск дээр Revit-д ИДЭВХТЭЙ ажилласан хугацаа».
 * Хүний бүх бүтээмж БИШ.  Add-in оролтын АГУУЛГА, дэлгэц, clipboard, бусад
 * програм цуглуулдаггүй — зөвхөн «Revit урд уу» ба «сүүлийн оролтоос хойш хэдэн мс».
 *
 * ⚠️ `/api/revit` угтвар нь `workerScope`/`clientScope`-ийн цагаан жагсаалтад
 *    БАЙХГҮЙ тул worker ба client автоматаар 403.  Дээрээс нь энд
 *    `revit.ts`-ийн ижил дөрвөн үүрэг.
 * ⚠️ `user_id` ХЭЗЭЭ Ч биеэс авагдахгүй — токены `sub`.
 * ⚠️ Элемент түвшний BIM үйл ажиллагааны «зөвхөн өөртөө» дүрэм (0201–0205)
 *    ХЭВЭЭР: энэ модуль элемент/харагдац/өөрчлөлт ХАДГАЛАХГҮЙ.
 */
const TRACKING_ROLES: UserRole[] = ['engineer', 'architect', 'senior', 'admin'];

/** `IN (...)`-д нэг statement-д — D1-ийн 100 bind-ийн хязгаараас доош. */
const IDS_PER_STATEMENT = 90;

/** Админы жагсаалтад ийм хуучин heartbeat-тэй ажилтныг харуулахгүй (Revit ашигладаггүй болсон). */
const LIVE_LOOKBACK_DAYS = 7;

const revitTracking = new Hono<{ Bindings: Env; Variables: AppVariables }>();

revitTracking.use('/tracking/*', requireRole(...TRACKING_ROLES));

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

async function taskProjects(db: D1Database, ids: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  for (const part of chunks([...new Set(ids)], IDS_PER_STATEMENT)) {
    if (part.length === 0) continue;
    const rows = await db
      .prepare(
        `SELECT t.id AS task_id, b.project_id
           FROM tasks t
           INNER JOIN components c ON c.id = t.component_id
           INNER JOIN drawings d   ON d.id = c.drawing_id
           INNER JOIN blocks b     ON b.id = d.block_id
          WHERE t.id IN (${part.map(() => '?').join(',')})`,
      )
      .bind(...part)
      .all<{ task_id: number; project_id: number }>();
    for (const r of rows.results ?? []) map.set(r.task_id, r.project_id);
  }
  return map;
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

/* ------------------------------------------------------------------ */
/*  POST /tracking/sync                                                */
/* ------------------------------------------------------------------ */

revitTracking.post('/tracking/sync', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body !== 'object') return c.json({ error: 'Invalid JSON' }, 400);

  const sessionId = cleanId(body.session_id);
  if (!sessionId) return c.json({ error: 'session_id is required' }, 400);

  const now = new Date();
  const nowIso = now.toISOString();
  const today = todayInUB();

  const rawSegs = Array.isArray(body.segments) ? body.segments : [];
  if (rawSegs.length > MAX_SEGMENTS_PER_SYNC) {
    return c.json({ error: `too many segments (max ${MAX_SEGMENTS_PER_SYNC})` }, 413);
  }

  const acks: { segment_id: string; rev: number; status: 'accepted' | 'rejected'; reason?: string }[] = [];
  const valid: ValidSegment[] = [];
  for (const raw of rawSegs) {
    const v = validateSegment(raw, user.sub, today);
    if (v.ok) valid.push(v.seg);
    else if (v.segment_id) acks.push({ segment_id: v.segment_id, rev: v.rev, status: 'rejected', reason: v.reason });
  }

  const presenceRaw = (body.presence && typeof body.presence === 'object'
    ? body.presence
    : null) as Record<string, unknown> | null;
  const presenceTask = presenceRaw && Number.isInteger(Number(presenceRaw.task_id)) && Number(presenceRaw.task_id) > 0
    ? Number(presenceRaw.task_id)
    : null;

  const projects = await taskProjects(db, [...valid.map((s) => s.task_id), ...(presenceTask ? [presenceTask] : [])]);

  // ⚠️ Устгагдсан таск → «rejected»: клиент дараалалаас хасна (үүрд дахин оролдохгүй).
  const writable: ValidSegment[] = [];
  for (const s of valid) {
    if (!projects.has(s.task_id)) {
      acks.push({ segment_id: s.segment_id, rev: s.rev, status: 'rejected', reason: 'task_not_found' });
    } else {
      writable.push(s);
    }
  }

  // ХУРИМТЛАЛ → MAX.  Давтан/хожимдсон хүргэлт тоог хэзээ ч өсгөхгүй.
  // `WHERE … user_id = excluded.user_id` — өөр хүний сегмент id-г дарж чадахгүй
  // (changes = 0 → rejected).
  const stmts: D1PreparedStatement[] = writable.map((s) =>
    db
      .prepare(
        `INSERT INTO revit_work_segments
           (segment_id, session_id, user_id, task_id, project_id, work_date, doc_key,
            revit_document_id, active_ms, idle_ms, rev, first_at, last_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(segment_id) DO UPDATE SET
           active_ms = MAX(revit_work_segments.active_ms, excluded.active_ms),
           idle_ms   = MAX(revit_work_segments.idle_ms, excluded.idle_ms),
           last_at   = CASE WHEN excluded.rev > revit_work_segments.rev
                            THEN excluded.last_at ELSE revit_work_segments.last_at END,
           revit_document_id = COALESCE(excluded.revit_document_id, revit_work_segments.revit_document_id),
           rev       = MAX(revit_work_segments.rev, excluded.rev),
           updated_at = excluded.updated_at
         WHERE revit_work_segments.user_id = excluded.user_id`,
      )
      .bind(
        s.segment_id,
        s.session_id,
        user.sub,
        s.task_id,
        projects.get(s.task_id) ?? null,
        s.work_date,
        s.doc_key,
        s.revit_document_id,
        s.active_ms,
        s.idle_ms,
        s.rev,
        s.first_at,
        s.last_at,
        nowIso,
        nowIso,
      ),
  );

  let presenceIndex = -1;
  if (presenceRaw) {
    const state = cleanState(presenceRaw.state);
    const taskId = presenceTask && projects.has(presenceTask) ? presenceTask : null;
    presenceIndex = stmts.length;
    stmts.push(
      db
        .prepare(
          `INSERT INTO revit_work_presence
             (session_id, user_id, state, task_id, project_id, revit_document_id, doc_name,
              addin_version, started_at, last_seen_at, client_at, ended_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET
             state = excluded.state,
             task_id = excluded.task_id,
             project_id = excluded.project_id,
             revit_document_id = excluded.revit_document_id,
             doc_name = excluded.doc_name,
             addin_version = excluded.addin_version,
             last_seen_at = excluded.last_seen_at,
             client_at = excluded.client_at,
             ended_at = excluded.ended_at
           WHERE revit_work_presence.user_id = excluded.user_id`,
        )
        .bind(
          sessionId,
          user.sub,
          state,
          taskId,
          taskId ? projects.get(taskId) ?? null : null,
          Number.isInteger(Number(presenceRaw.revit_document_id)) && Number(presenceRaw.revit_document_id) > 0
            ? Number(presenceRaw.revit_document_id)
            : null,
          str(presenceRaw.doc_name, 200),
          str(body.addin_version, 32),
          nowIso,
          nowIso,
          str(presenceRaw.client_at, 40),
          body.ended === true ? nowIso : null,
        ),
    );
  }

  if (stmts.length > 0) {
    const results = await db.batch(stmts);
    writable.forEach((s, i) => {
      const changed = (results[i]?.meta?.changes ?? 0) > 0;
      acks.push(
        changed
          ? { segment_id: s.segment_id, rev: s.rev, status: 'accepted' }
          : { segment_id: s.segment_id, rev: s.rev, status: 'rejected', reason: 'owner_mismatch' },
      );
    });
    void presenceIndex;
  }

  // Дэлгэцийн нийлбэрт: ЭНЭ сессээс БУСАД сессийн өнөөдрийн цаг (өглөөний
  // Revit нээлт, өөр PC).  Энэ сессийнхийг клиент өөрөө (шинэ) мэднэ.
  const workDate = isWorkDate(body.work_date) ? body.work_date : today;
  const other = await db
    .prepare(
      `SELECT task_id, SUM(active_ms) AS ms
         FROM revit_work_segments
        WHERE user_id = ? AND work_date = ? AND session_id <> ?
        GROUP BY task_id`,
    )
    .bind(user.sub, workDate, sessionId)
    .all<{ task_id: number; ms: number }>();

  return c.json({
    server_now: nowIso,
    acks,
    work_date: workDate,
    other_sessions: (other.results ?? []).map((r) => ({ task_id: r.task_id, other_ms: Number(r.ms) || 0 })),
  });
});

/* ------------------------------------------------------------------ */
/*  GET /tracking/day                                                   */
/* ------------------------------------------------------------------ */

/**
 * Нэг ажилтны нэг өдрийн ТАСК ТУТМЫН оролцоо: Revit цаг + тэр өдрийн явцын
 * бичлэгүүд (вэб ба Revit хоёулаа — `progress_entries`).  Олон таск нэг
 * өдөр бие биеэ ДАРАХГҮЙ: таск бүр өөрийн мөр.
 *
 * Эрх: ЗӨВХӨН admin (далд систем — ажилтанд харагдац байхгүй).
 */
revitTracking.get('/tracking/day', requireAdmin(), async (c) => {
  const viewer = c.get('user');
  const db = c.env.DB;
  const qUser = c.req.query('user_id');
  const userId = qUser ? Number(qUser) : viewer.sub;
  if (!Number.isInteger(userId) || userId <= 0) return c.json({ error: 'Invalid user_id' }, 400);
  const qDate = c.req.query('date');
  const date = qDate && isWorkDate(qDate) ? qDate : todayInUB();

  const [segRes, entRes] = await Promise.all([
    db
      .prepare(
        `SELECT s.task_id, t.name AS task_name, s.project_id, p.name AS project_name,
                SUM(s.active_ms) AS active_ms, SUM(s.idle_ms) AS idle_ms,
                MIN(s.first_at) AS first_at, MAX(s.last_at) AS last_at
           FROM revit_work_segments s
           LEFT JOIN tasks t    ON t.id = s.task_id
           LEFT JOIN projects p ON p.id = s.project_id
          WHERE s.user_id = ? AND s.work_date = ?
          GROUP BY s.task_id`,
      )
      .bind(userId, date)
      .all<{
        task_id: number;
        task_name: string | null;
        project_id: number | null;
        project_name: string | null;
        active_ms: number;
        idle_ms: number;
        first_at: string | null;
        last_at: string | null;
      }>(),
    db
      .prepare(
        `SELECT pe.id, pe.task_id, pe.percentage, pe.notes, pe.source, pe.status, pe.created_at,
                t.name AS task_name, b.project_id, p.name AS project_name
           FROM progress_entries pe
           LEFT JOIN tasks t      ON t.id = pe.task_id
           LEFT JOIN components c ON c.id = t.component_id
           LEFT JOIN drawings d   ON d.id = c.drawing_id
           LEFT JOIN blocks b     ON b.id = d.block_id
           LEFT JOIN projects p   ON p.id = b.project_id
          WHERE pe.user_id = ? AND pe.date = ?
            AND COALESCE(pe.is_rest_day, 0) = 0 AND COALESCE(pe.defer_next_day, 0) = 0
          ORDER BY pe.created_at, pe.id`,
      )
      .bind(userId, date)
      .all<{
        id: number;
        task_id: number;
        percentage: number;
        notes: string | null;
        source: string | null;
        status: string | null;
        created_at: string;
        task_name: string | null;
        project_id: number | null;
        project_name: string | null;
      }>(),
  ]);

  type Row = {
    task_id: number;
    task_name: string | null;
    project_id: number | null;
    project_name: string | null;
    active_ms: number;
    idle_ms: number;
    first_at: string | null;
    last_at: string | null;
    entries: { id: number; percentage: number; notes: string | null; source: string; status: string | null; created_at: string }[];
  };
  const byTask = new Map<number, Row>();
  for (const s of segRes.results ?? []) {
    byTask.set(s.task_id, {
      task_id: s.task_id,
      task_name: s.task_name,
      project_id: s.project_id,
      project_name: s.project_name,
      active_ms: Number(s.active_ms) || 0,
      idle_ms: Number(s.idle_ms) || 0,
      first_at: s.first_at,
      last_at: s.last_at,
      entries: [],
    });
  }
  for (const e of entRes.results ?? []) {
    let row = byTask.get(e.task_id);
    if (!row) {
      row = {
        task_id: e.task_id,
        task_name: e.task_name,
        project_id: e.project_id,
        project_name: e.project_name,
        active_ms: 0,
        idle_ms: 0,
        first_at: null,
        last_at: null,
        entries: [],
      };
      byTask.set(e.task_id, row);
    }
    row.entries.push({
      id: e.id,
      percentage: e.percentage,
      notes: e.notes,
      source: e.source ?? 'web',
      status: e.status,
      created_at: e.created_at,
    });
  }

  const tasks = [...byTask.values()].sort(
    (a, b) => b.active_ms - a.active_ms || (a.task_name ?? '').localeCompare(b.task_name ?? ''),
  );
  return c.json({
    date,
    user_id: userId,
    total_active_ms: tasks.reduce((s, t) => s + t.active_ms, 0),
    tasks,
  });
});

/* ------------------------------------------------------------------ */
/*  GET /tracking/live — ЗӨВХӨН admin                                  */
/* ------------------------------------------------------------------ */

revitTracking.get('/tracking/live', requireAdmin(), async (c) => {
  const db = c.env.DB;
  const nowMs = Date.now();
  const today = todayInUB();
  const since = new Date(nowMs - LIVE_LOOKBACK_DAYS * 86_400_000).toISOString();

  const [presRes, totRes] = await Promise.all([
    db
      .prepare(
        `SELECT p.session_id, p.user_id, p.state, p.task_id, p.project_id, p.doc_name,
                p.addin_version, p.started_at, p.last_seen_at, p.ended_at,
                u.full_name, u.username, u.role,
                t.name AS task_name, pr.name AS project_name
           FROM revit_work_presence p
           INNER JOIN users u   ON u.id = p.user_id
           LEFT JOIN tasks t    ON t.id = p.task_id
           LEFT JOIN projects pr ON pr.id = p.project_id
          WHERE p.last_seen_at >= ? AND u.status = 'active'`,
      )
      .bind(since)
      .all<{
        session_id: string;
        user_id: number;
        state: string;
        task_id: number | null;
        project_id: number | null;
        doc_name: string | null;
        addin_version: string | null;
        started_at: string;
        last_seen_at: string;
        ended_at: string | null;
        full_name: string | null;
        username: string;
        role: string;
        task_name: string | null;
        project_name: string | null;
      }>(),
    db
      .prepare(
        `SELECT user_id, task_id, SUM(active_ms) AS ms
           FROM revit_work_segments
          WHERE work_date = ?
          GROUP BY user_id, task_id`,
      )
      .bind(today)
      .all<{ user_id: number; task_id: number; ms: number }>(),
  ]);

  const totals = new Map<number, Map<number, number>>();
  for (const r of totRes.results ?? []) {
    let m = totals.get(r.user_id);
    if (!m) totals.set(r.user_id, (m = new Map()));
    m.set(r.task_id, Number(r.ms) || 0);
  }

  const byUser = new Map<number, NonNullable<typeof presRes.results>>();
  for (const r of presRes.results ?? []) {
    const list = byUser.get(r.user_id) ?? [];
    list.push(r);
    byUser.set(r.user_id, list);
  }

  const employees = [...byUser.entries()].map(([userId, rows]) => {
    const best = pickSession(rows, nowMs)!;
    const status: LiveStatus = liveStatusOf(best, nowMs);
    const perTask = totals.get(userId) ?? new Map<number, number>();
    let todayMs = 0;
    for (const v of perTask.values()) todayMs += v;
    const lastSeen = rows.reduce((m, r) => (r.last_seen_at > m ? r.last_seen_at : m), best.last_seen_at);
    // OFFLINE үед ч «сүүлд юун дээр байсан»-ыг харуулна — гэхдээ төлөв нь offline.
    return {
      user_id: userId,
      name: best.full_name || best.username,
      role: best.role,
      status,
      client_state: best.state,
      stale: status === 'offline' && !best.ended_at,
      task_id: best.task_id,
      task_name: best.task_name,
      project_id: best.project_id,
      project_name: best.project_name,
      doc_name: best.doc_name,
      current_task_today_ms: best.task_id ? perTask.get(best.task_id) ?? 0 : 0,
      revit_today_ms: todayMs,
      last_seen_at: lastSeen,
      addin_version: best.addin_version,
      sessions_open: rows.filter((r) => liveStatusOf(r, nowMs) !== 'offline').length,
    };
  });

  employees.sort(
    (a, b) => statusRank(a.status) - statusRank(b.status) || (a.name ?? '').localeCompare(b.name ?? ''),
  );

  return c.json(
    {
      now: new Date(nowMs).toISOString(),
      date: today,
      stale_after_sec: Math.round(STALE_AFTER_MS / 1000),
      employees,
      window_start: addDays(today, -LIVE_LOOKBACK_DAYS),
    },
    200,
    { 'Cache-Control': 'private, no-store' },
  );
});

export default revitTracking;
