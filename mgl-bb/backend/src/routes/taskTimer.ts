import { Hono } from 'hono';
import type { Env, AppVariables } from '../types';
import { requireAdmin } from '../middleware/auth';
import { createNotification } from '../lib/notify';
import { todayInUB } from '../lib/time';
import {
  daysBetween,
  isIsoDate,
  isReportWindow,
  orgUtcOffsetMinutes,
  resolveWindow,
} from '../lib/reportWindows';
import { loadOfficialLunch, lunchWire } from '../lib/taskTimerLunch';
import { OFFICIAL_TIMER_ROLES, splitByUbDay, ubDayWindow, ubRangeWindow } from '../lib/taskTimer';
import {
  loadOfficialTimerLive,
  loadOfficialTimerReport,
  loadOfficialTimerState,
  loadProjectWorkers,
  loadSessionsOverlapping,
  pauseOfficialTimer,
  restoreOwnSession,
  stopRunningTimerAt,
  voidOwnSession,
} from '../lib/taskTimerStore';
import { takeTask } from '../lib/taskTakeService';
import { TAKE_DENIAL_MESSAGE } from '../lib/taskTake';
import { loadMyListWorkers } from '../lib/myTaskList';
import { enforceManagedTaskWrite } from '../middleware/taskAllocGuard';

/**
 * АЛБАН ЁСНЫ ТАСКИЙН ЦАГ ХЭМЖИГЧ (OFFICIAL_TASK_TIMER, migration 0361) — `/api/task-timer`.
 *
 *   GET  /state            — миний төлөв: явж буй таск, таск тус бүрийн албан цаг, өнөөдөр.
 *   POST /start {task_id}  — «Өөртөө авах» (2026-10-01) = `POST /tasks/:id/claim`: ирцтэй
 *                            байх, хуваагдах таск дээр өөр хүн ажиллаж байвал 409
 *                            TASK_OCCUPIED (+ 50/50 хуваах өгөгдмөл); өөр таск явж
 *                            байвал АТОМ сэлгэнэ; тэр таск аль хэдийн явж байвал юу ч
 *                            хийхгүй (идемпотент).  Дүрэм `lib/taskTakeService.ts`.
 *   POST /pause {task_id?} — зогсоох (task_id өгвөл зөвхөн тэр таск явж байвал).
 *   GET  /working?project_id= — төслийн таскууд дээр ОДОО ажиллаж буй хүмүүс (нэр л —
 *                            цаг БИШ; цаг нь зөвхөн тухайн хүн + админд).
 *   GET  /working?mine=1   — «Миний ажлууд»-ын таскууд (0370 `lib/myTaskList.ts`) дээр
 *                            ОДОО ажиллаж буй хүмүүс — өөр хүн эхлүүлбэл шууд харагдана.
 *   POST /users/:id/stop   — ЗӨВХӨН admin: хүний явж буй таймерыг зогсооно (мартсан цаг).
 *   GET  /live             — ЗӨВХӨН admin: хэн одоо аль таск дээр, өнөөдөр хэдэн цаг.
 *   GET  /report           — ЗӨВХӨН admin: Тайлан хуудасны «Таскийн цаг» таб —
 *                            `?window=&anchor=` мужийн ажилтан/төслөөр нийлбэр.
 *   GET  /users/:id/days   — өдрийн тайлан (өөрөө эсвэл admin): өдөр × таск × сэшн.
 *
 * ⚠️ Хариу бүр `server_now`-тай — клиент харагдах секундийг ЗӨВХӨН түүнээс
 *    тоолно (хөтчийн цаг canonical биш).  Хуудас сэргээх, хөтөч хаах таймерыг
 *    ЗОГСООХГҮЙ — таймер сервер дээр амьдарна.
 * ⚠️ Цайны цаг (эзэн 2026-10-01): ирцийн цайны цонхонд (прод 13:00–14:00) албан цаг
 *    тоологдохгүй — сэшн явсаар, тоолуур хөлдөж цонх дуусахад үргэлжилнэ.  Бүх
 *    тооцоо `lib/taskTimer.ts`-ийн ГАНЦ дүрмээр; `/state` ба `/live` нь клиентийн
 *    тоолуурт `lunch`-ийг (тэр дүрмийн ихэр) буцаана.
 * ⚠️ Revit-ийн автомат цаг (0360, `/api/revit/tracking/*`) энд ОГТ орохгүй.
 * ⚠️ `user_id` ХЭЗЭЭ Ч биеэс авагдахгүй — токены `sub` (өөр хүний таймер
 *    эхлүүлэх зам байхгүй).
 * ⚠️ `/api/task-timer` нь `workerScope`/`clientScope`-ийн цагаан жагсаалтад
 *    БАЙХГҮЙ — worker, client автоматаар 403.
 */
const taskTimer = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/** Өдрийн тайлангийн хамгийн урт муж (өдөр). */
const MAX_REPORT_DAYS = 62;

function todayWindow() {
  const offset = orgUtcOffsetMinutes();
  const date = todayInUB();
  return { date, offset, win: ubDayWindow(date, offset) };
}

/** Цайны цонх — ирцийн ЯГ тэр тохиргооноос (`lib/taskTimerLunch.ts`; нэг жижиг уншилт). */
const officialLunch = loadOfficialLunch;

async function stateBody(db: D1Database, userId: number) {
  const nowMs = Date.now();
  const { date, win } = todayWindow();
  const lunch = await officialLunch(db);
  const state = await loadOfficialTimerState(db, userId, nowMs, win, lunch);
  return {
    server_now: new Date(nowMs).toISOString(),
    date,
    day_start: new Date(win.startMs).toISOString(),
    day_end: new Date(win.endMs).toISOString(),
    lunch: lunchWire(lunch),
    ...state,
  };
}

function taskIdOf(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : null;
}

taskTimer.get('/state', async (c) => {
  const user = c.get('user');
  return c.json(await stateBody(c.env.DB, user.sub));
});

taskTimer.post('/start', async (c) => {
  const user = c.get('user');
  const body = (await c.req.json().catch(() => ({}))) as { task_id?: unknown };
  const taskId = taskIdOf(body.task_id);
  if (taskId === null) return c.json({ error: 'task_id is required' }, 400);

  // Managed таск дээр цаг эхлүүлэх = managed төлөв өөрчлөх: клиентийн гэрээ (426) + идэвхжүүлэлт (423).
  // Managed биш таскт ХЭВЭЭР (хуучин зан төлөв).  Зогсоох (`/pause`) ХЭЗЭЭ Ч хаагдахгүй — осолд цаг зогсоох боломж үлдэнэ.
  const blocked = await enforceManagedTaskWrite(c, taskId);
  if (blocked) return blocked;
  const r = await takeTask(c.env.DB, user, taskId);
  if (!r.ok) {
    return c.json(
      { error: r.code, message: r.message, occupied: r.occupied ?? null, allocation: r.allocation ?? null },
      r.status,
    );
  }
  return c.json({ outcome: r.outcome, progress: r.progress, ...(await stateBody(c.env.DB, user.sub)) });
});

taskTimer.post('/pause', async (c) => {
  const user = c.get('user');
  if (!(OFFICIAL_TIMER_ROLES as readonly string[]).includes(user.role)) {
    return c.json({ error: 'ROLE_NOT_ALLOWED', message: TAKE_DENIAL_MESSAGE.ROLE_NOT_ALLOWED }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as { task_id?: unknown };
  const taskId = body.task_id === undefined || body.task_id === null ? null : taskIdOf(body.task_id);
  if (body.task_id !== undefined && body.task_id !== null && taskId === null) {
    return c.json({ error: 'task_id must be a positive integer' }, 400);
  }
  const stopped = await pauseOfficialTimer(c.env.DB, {
    userId: user.sub,
    actorId: user.sub,
    taskId,
    nowIso: new Date().toISOString(),
    requestId: crypto.randomUUID(),
  });
  return c.json({
    outcome: stopped > 0 ? 'paused' : 'not_running',
    ...(await stateBody(c.env.DB, user.sub)),
  });
});

// ТАНЫ ӨӨРИЙН сэшнийг хүчингүй болгох / сэргээх (0379, 2026-10-02).  Сэшн УСТАХГҮЙ — албан цагийн уншигчид
// тоолохгүй.  Явж буй бол эхлээд зогсооно.  Явц, засварын цаг, оноо АВТОМАТААР устахгүй (тусдаа үйлдэл).
// ⚠️ `user_id` токеноос — өөр хүний сэшнийг хүчингүй болгох зам БАЙХГҮЙ (олдохгүй = 404).
function requestIdOf(raw: unknown): string {
  return typeof raw === 'string' && /^[A-Za-z0-9._:-]{8,80}$/.test(raw) ? raw : crypto.randomUUID();
}

/** Өөрийн сэшний таск managed бол хаалга (426/423); managed биш / олдохгүй бол `null` (handler 404-ийг өөрөө өгнө). */
async function gateOwnSession(
  c: Parameters<typeof enforceManagedTaskWrite>[0],
  sessionId: number,
  userId: number,
): Promise<Response | null> {
  const row = await c.env.DB.prepare('SELECT task_id FROM task_timer_sessions WHERE id = ? AND user_id = ?')
    .bind(sessionId, userId)
    .first<{ task_id: number }>();
  return row ? enforceManagedTaskWrite(c, row.task_id) : null;
}

taskTimer.post('/sessions/:id/void', async (c) => {
  const user = c.get('user');
  if (!(OFFICIAL_TIMER_ROLES as readonly string[]).includes(user.role)) {
    return c.json({ error: 'ROLE_NOT_ALLOWED', message: TAKE_DENIAL_MESSAGE.ROLE_NOT_ALLOWED }, 403);
  }
  const sessionId = taskIdOf(c.req.param('id'));
  if (sessionId === null) return c.json({ error: 'invalid session id' }, 400);
  const blocked = await gateOwnSession(c, sessionId, user.sub);
  if (blocked) return blocked;
  const body = (await c.req.json().catch(() => ({}))) as { request_id?: unknown };
  const r = await voidOwnSession(c.env.DB, {
    userId: user.sub,
    sessionId,
    requestId: requestIdOf(body.request_id),
    nowIso: new Date().toISOString(),
  });
  if (r.outcome === 'not_found') return c.json({ error: 'SESSION_NOT_FOUND', message: 'Сэшн олдсонгүй' }, 404);
  return c.json({ outcome: r.outcome, was_running: r.was_running, task_id: r.task_id, ...(await stateBody(c.env.DB, user.sub)) });
});

taskTimer.post('/sessions/:id/restore', async (c) => {
  const user = c.get('user');
  if (!(OFFICIAL_TIMER_ROLES as readonly string[]).includes(user.role)) {
    return c.json({ error: 'ROLE_NOT_ALLOWED', message: TAKE_DENIAL_MESSAGE.ROLE_NOT_ALLOWED }, 403);
  }
  const sessionId = taskIdOf(c.req.param('id'));
  if (sessionId === null) return c.json({ error: 'invalid session id' }, 400);
  const blocked = await gateOwnSession(c, sessionId, user.sub);
  if (blocked) return blocked;
  const body = (await c.req.json().catch(() => ({}))) as { request_id?: unknown };
  const r = await restoreOwnSession(c.env.DB, {
    userId: user.sub,
    sessionId,
    requestId: requestIdOf(body.request_id),
    nowIso: new Date().toISOString(),
  });
  if (r.outcome === 'not_found') return c.json({ error: 'SESSION_NOT_FOUND', message: 'Сэшн олдсонгүй' }, 404);
  if (r.outcome === 'overlap') {
    return c.json(
      { error: 'SESSION_OVERLAP', message: 'Энэ хугацаанд өөр хүчинтэй цагийн бүртгэл байгаа тул сэргээх боломжгүй.' },
      409,
    );
  }
  return c.json({ outcome: r.outcome, task_id: r.task_id, ...(await stateBody(c.env.DB, user.sub)) });
});

// Төслийн хуудасны «Одоо хийж буй» нүд ба «Миний ажлууд»-ын «Одоо: …» тэмдэг — ~10 секунд
// тутам.  Нэр л (цаг БИШ).
taskTimer.get('/working', async (c) => {
  if (c.req.query('mine') === '1') {
    const rows = await loadMyListWorkers(c.env.DB, c.get('user').sub);
    return c.json({ server_now: new Date().toISOString(), workers: rows }, 200, {
      'Cache-Control': 'private, no-store',
    });
  }
  const projectId = taskIdOf(c.req.query('project_id'));
  if (projectId === null) return c.json({ error: 'project_id is required' }, 400);
  const rows = await loadProjectWorkers(c.env.DB, projectId);
  return c.json({ server_now: new Date().toISOString(), workers: rows }, 200, {
    'Cache-Control': 'private, no-store',
  });
});

// Админ хүний мартсан / буруу таймерыг зогсооно — тэр хүний нэр таскаас арилж
// таск бусдад чөлөөтэй болно.  Тухайн хүнд мэдэгдэл очно.
taskTimer.post('/users/:id/stop', requireAdmin(), async (c) => {
  const admin = c.get('user');
  const targetId = taskIdOf(c.req.param('id'));
  if (targetId === null) return c.json({ error: 'invalid user id' }, 400);
  const nowIso = new Date().toISOString();
  const r = await stopRunningTimerAt(c.env.DB, {
    userId: targetId,
    actorId: admin.sub,
    atIso: nowIso,
    nowIso,
    requestId: crypto.randomUUID(),
    note: 'admin_stop',
  });
  if (r.stopped > 0 && targetId !== admin.sub) {
    await createNotification(
      c.env.DB,
      targetId,
      'task_assigned',
      'Таны таскийн цагийг админ зогсоолоо',
      r.task_name ? `«${r.task_name}» — үргэлжлүүлэх бол «Миний ажлууд»-аас дахин эхлүүлнэ үү.` : null,
      '/app/my-tasks',
    );
  }
  return c.json({ stopped: r.stopped, task_id: r.task_id });
});

taskTimer.get('/live', requireAdmin(), async (c) => {
  const nowMs = Date.now();
  const { date, win } = todayWindow();
  const lunch = await officialLunch(c.env.DB);
  const rows = await loadOfficialTimerLive(c.env.DB, nowMs, win, lunch);
  return c.json({
    server_now: new Date(nowMs).toISOString(),
    date,
    day_start: new Date(win.startMs).toISOString(),
    day_end: new Date(win.endMs).toISOString(),
    lunch: lunchWire(lunch),
    rows,
  });
});

taskTimer.get('/report', requireAdmin(), async (c) => {
  const { date: today, offset } = todayWindow();
  const window = c.req.query('window') ?? '7d';
  const anchor = c.req.query('anchor') ?? today;
  if (!isReportWindow(window) || !isIsoDate(anchor) || anchor > today) {
    return c.json({ error: 'Invalid window or anchor' }, 400);
  }
  const resolved = resolveWindow(window, anchor);
  const nowMs = Date.now();
  const lunch = await officialLunch(c.env.DB);
  const report = await loadOfficialTimerReport(
    c.env.DB,
    nowMs,
    offset,
    { from: resolved.current.from, to: resolved.current.to, all: window === 'all' },
    lunch,
  );
  return c.json({
    server_now: new Date(nowMs).toISOString(),
    date: today,
    window,
    anchor,
    to: resolved.current.to,
    ...report, // from (all цонхонд анхны сэшний өдөр), rows, projects, totals
  });
});

taskTimer.get('/users/:id/days', async (c) => {
  const user = c.get('user');
  const targetId = taskIdOf(c.req.param('id'));
  if (targetId === null) return c.json({ error: 'invalid user id' }, 400);
  if (targetId !== user.sub && user.role !== 'admin') {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const { date: today, offset } = todayWindow();
  const from = c.req.query('from') ?? today;
  const to = c.req.query('to') ?? today;
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) {
    return c.json({ error: 'from/to must be YYYY-MM-DD, from <= to' }, 400);
  }
  if (daysBetween(from, to) > MAX_REPORT_DAYS) {
    return c.json({ error: `range too long (max ${MAX_REPORT_DAYS} days)` }, 400);
  }

  const nowMs = Date.now();
  const win = ubRangeWindow(from, to, offset);
  const [sessions, lunch] = await Promise.all([
    loadSessionsOverlapping(c.env.DB, targetId, win),
    officialLunch(c.env.DB),
  ]);
  // Хүчингүй болгосон сэшн тоолуурт ОРОХГҮЙ (жагсаалтад `voided: true`-аар үлдэнэ).
  const byDay = splitByUbDay(
    sessions.filter((s) => !s.voided),
    nowMs,
    offset,
    from,
    to,
    lunch,
  );

  const taskIds = [...new Set(sessions.map((s) => s.task_id))];
  const names = new Map<number, { task_name: string | null; project_name: string | null }>();
  for (let i = 0; i < taskIds.length; i += 90) {
    const part = taskIds.slice(i, i + 90);
    const res = await c.env.DB.prepare(
      `SELECT t.id AS task_id, t.name AS task_name, p.name AS project_name
         FROM tasks t
         LEFT JOIN components c ON c.id = t.component_id
         LEFT JOIN drawings d   ON d.id = c.drawing_id
         LEFT JOIN blocks b     ON b.id = d.block_id
         LEFT JOIN projects p   ON p.id = b.project_id
        WHERE t.id IN (${part.map(() => '?').join(',')})`,
    )
      .bind(...part)
      .all<{ task_id: number; task_name: string | null; project_name: string | null }>();
    for (const r of res.results ?? []) names.set(r.task_id, r);
  }

  const days = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([date, byTask]) => {
      const dayWin = ubDayWindow(date, offset);
      return {
        date,
        official_ms: [...byTask.values()].reduce((a, b) => a + b, 0),
        tasks: [...byTask.entries()]
          .map(([task_id, official_ms]) => ({
            task_id,
            task_name: names.get(task_id)?.task_name ?? null,
            project_name: names.get(task_id)?.project_name ?? null,
            official_ms,
          }))
          .sort((a, b) => b.official_ms - a.official_ms),
        sessions: sessions
          .filter((s) => {
            const a = Date.parse(s.started_at);
            const b = s.ended_at === null ? nowMs : Date.parse(s.ended_at);
            return b > dayWin.startMs && a < dayWin.endMs;
          })
          .map((s) => ({
            id: s.id,
            task_id: s.task_id,
            started_at: s.started_at,
            ended_at: s.ended_at,
            end_reason: s.end_reason,
            // 0368: ЯАГААД зогссон (ирцийн «Гарах», 23:59, админ, хуваалт) — эсвэл null.
            end_note: s.end_note,
            // 0379: эзэн хүчингүй болгосон — тоологдохгүй, «Сэргээх» боломжтой.
            voided: s.voided,
          })),
      };
    });

  return c.json({ server_now: new Date(nowMs).toISOString(), from, to, days });
});

export default taskTimer;
