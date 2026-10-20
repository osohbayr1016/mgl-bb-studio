/**
 * Төслийн бус ажил (миграц 0342) — `/api/non-project-work`.
 *
 * Ажилтан өөрийн бүртгэлийг л үүсгэж, засаж, устгана.  Огноо нь ҮРГЭЛЖ
 * өнөөдөр (УБ) — сервер тавина.  Засах/устгах нь зөвхөн `pending` үед:
 * админы шийдвэр гарсан мөр хөдлөхгүй.  Админы шалгах урсгал (approve /
 * reject) нь дараагийн шат — энд ЗОРИУД байхгүй.
 *
 * ⚠️ Угтвар нь ШИНЭ тул `lib/workerScope.ts` ба `lib/clientScope.ts`-ийн
 *    цагаан жагсаалтаар worker/client-д аль хэдийн хаалттай; доорх role
 *    хаалт нь хоёр дахь давхарга.
 */
import { Hono } from 'hono';
import { requireRole } from '../middleware/auth';
import type { Env, AppVariables } from '../types';
import { todayInUB, nowInUBIso } from '../lib/time';
import { getAttendanceSettings } from '../lib/settings';
import {
  NON_PROJECT_WORK_ROLES,
  findOverlap,
  hhmm,
  lunchWindowOf,
  normalizeReport,
  validateEntryInput,
} from '../lib/nonProjectWork';
import {
  loadEntriesForDay,
  loadEntry,
  loadRecentEntries,
  loadShiftEnd,
  nonProjectMeta,
  shapeEntry,
  withPicks,
  type NonProjectRow,
} from '../lib/nonProjectWorkStore';
import { afterNonProjectChange } from '../lib/nonProjectSync';

const router = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/** Хариуны нэг мөр — ирцийн сонголттой нь. */
async function shapeOne(db: D1Database, row: NonProjectRow | null) {
  if (!row) return null;
  const [shaped] = await withPicks(db, [row], shapeEntry);
  return shaped ?? null;
}

router.use('*', requireRole(...NON_PROJECT_WORK_ROLES));

type Body = Record<string, unknown>;
const has = (body: Body, key: string) => Object.prototype.hasOwnProperty.call(body, key);

function overlapError(clash: { id: number; start_time: string | null; end_time: string | null }) {
  return {
    error: `Энэ цаг өнөөдрийн өөр бүртгэлтэй (${clash.start_time}–${clash.end_time}) давхцаж байна`,
    code: 'OVERLAP',
    conflict_id: clash.id,
  };
}

// GET /api/non-project-work/my — өөрийн сүүлийн бүртгэлүүд + маягтын мэдээлэл.
router.get('/my', async (c) => {
  const user = c.get('user');
  const today = todayInUB();
  const [settings, rows, shiftEnd] = await Promise.all([
    getAttendanceSettings(c.env.DB),
    loadRecentEntries(c.env.DB, user.sub),
    loadShiftEnd(c.env.DB, user.sub, today),
  ]);
  return c.json({
    today,
    items: await withPicks(c.env.DB, rows, shapeEntry),
    ...nonProjectMeta(settings, shiftEnd.hhmm, hhmm(shiftEnd.startMinutes)),
  });
});

// POST /api/non-project-work — өнөөдрийн шинэ бүртгэл.  Цаг СОНГОЛТТОЙ (0356):
// хоосон бол 0 минут (ирцийн сонголттой ижил — хувь бодогдохгүй).  «Миний
// ажлууд»-ын маягт ажлаа дуусгасны дараа цаг + «юу хийсэн»-ийг заавал илгээнэ.
router.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<Body>().catch((): Body => ({}));
  const today = todayInUB();
  const [settings, shiftEnd] = await Promise.all([
    getAttendanceSettings(c.env.DB),
    loadShiftEnd(c.env.DB, user.sub, today),
  ]);
  const v = validateEntryInput(body, lunchWindowOf(settings), shiftEnd.minutes);
  if (!v.ok) return c.json({ error: v.error, code: v.code }, 400);
  if (v.value.startMin != null && v.value.endMin != null) {
    const sameDay = await loadEntriesForDay(c.env.DB, user.sub, today);
    const clash = findOverlap(sameDay, { start: v.value.startMin, end: v.value.endMin });
    if (clash) return c.json(overlapError(clash), 409);
  }

  // Гарахын өмнөх цонхонд бүртгэл + «юу хийсэн» нэг алхамд ирж болно.
  const report = normalizeReport(body.report);
  const res = await c.env.DB.prepare(
    `INSERT INTO non_project_work_entries
       (user_id, date, category, note, start_time, end_time, minutes, report, reported_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      user.sub,
      today,
      v.value.category,
      v.value.note,
      v.value.startTime,
      v.value.endTime,
      v.value.minutes ?? 0,
      report,
      report ? nowInUBIso() : null,
    )
    .run();
  const id = Number(res.meta.last_row_id);
  await afterNonProjectChange(c.env.DB, user.sub, today, settings);
  return c.json({ item: await shapeOne(c.env.DB, await loadEntry(c.env.DB, id)) }, 201);
});

// PATCH /api/non-project-work/:id — өөрийн хүлээгдэж буй бүртгэлийг засах
// (ажлын төрөл, цаг, «юу хийсэн» тайлбар).  Илгээсэн талбарууд л өөрчлөгдөнө.
// Ирцэд сонгосон (цаггүй) мөрийг ажилтан ажлаа дуусгаад ЭНДЭЭС дуусгана:
// цаг + тайлбар → шалгуулахаар илгээгдэнэ (`entryStage`).
router.patch('/:id', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);

  const row = await loadEntry(c.env.DB, id);
  if (!row || row.user_id !== user.sub) return c.json({ error: 'Not found' }, 404);
  if (row.status !== 'pending') {
    return c.json({ error: 'Шалгагдсан бүртгэлийг засах боломжгүй', code: 'NOT_PENDING' }, 409);
  }

  const body = await c.req.json<Body>().catch((): Body => ({}));
  let fields: {
    category: string;
    note: string | null;
    startTime: string | null;
    endTime: string | null;
    minutes: number;
  } = {
    category: row.category,
    note: row.note,
    startTime: row.start_time,
    endTime: row.end_time,
    minutes: row.minutes,
  };
  // Цаг/төрөл хөндөөгүй бол минутыг ДАХИН тооцохгүй — цайны тохиргоо дараа
  // нь өөрчлөгдсөн ч зөвхөн тайлбар бичсэнээр хугацаа чимээгүй хөдлөхгүй.
  if (['category', 'note', 'start_time', 'end_time'].some((k) => has(body, k))) {
    const [settings, shiftEnd] = await Promise.all([
      getAttendanceSettings(c.env.DB),
      loadShiftEnd(c.env.DB, user.sub, row.date),
    ]);
    const v = validateEntryInput(
      {
        category: has(body, 'category') ? body.category : row.category,
        note: has(body, 'note') ? body.note : row.note,
        start_time: has(body, 'start_time') ? body.start_time : row.start_time,
        end_time: has(body, 'end_time') ? body.end_time : row.end_time,
      },
      lunchWindowOf(settings),
      shiftEnd.minutes,
    );
    if (!v.ok) return c.json({ error: v.error, code: v.code }, 400);
    if (v.value.startMin != null && v.value.endMin != null) {
      const sameDay = await loadEntriesForDay(c.env.DB, user.sub, row.date);
      const clash = findOverlap(sameDay, { start: v.value.startMin, end: v.value.endMin }, row.id);
      if (clash) return c.json(overlapError(clash), 409);
    }
    fields = {
      category: v.value.category,
      note: v.value.note,
      startTime: v.value.startTime,
      endTime: v.value.endTime,
      // Цаггүй мөр ҮРГЭЛЖ 0 минут — ирцийн сонголтоос цаг бодохгүй (зөвхөн хяналт).
      minutes: v.value.minutes ?? 0,
    };
  }

  let report = row.report;
  let reportedAt = row.reported_at;
  if (has(body, 'report')) {
    report = normalizeReport(body.report);
    reportedAt = report ? (report === row.report ? row.reported_at : nowInUBIso()) : null;
  }

  const res = await c.env.DB.prepare(
    `UPDATE non_project_work_entries
        SET category = ?, note = ?, start_time = ?, end_time = ?, minutes = ?,
            report = ?, reported_at = ?, updated_at = datetime('now')
      WHERE id = ? AND status = 'pending'`,
  )
    .bind(
      fields.category,
      fields.note,
      fields.startTime,
      fields.endTime,
      fields.minutes,
      report,
      reportedAt,
      id,
    )
    .run();
  if (!res.meta.changes) {
    return c.json({ error: 'Шалгагдсан бүртгэлийг засах боломжгүй', code: 'NOT_PENDING' }, 409);
  }
  await afterNonProjectChange(c.env.DB, user.sub, row.date);
  return c.json({ item: await shapeOne(c.env.DB, await loadEntry(c.env.DB, id)) });
});

// DELETE /api/non-project-work/:id — өөрийн хүлээгдэж буй бүртгэлийг устгах.
router.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);

  const row = await loadEntry(c.env.DB, id);
  if (!row || row.user_id !== user.sub) return c.json({ error: 'Not found' }, 404);
  const res = await c.env.DB.prepare(
    `DELETE FROM non_project_work_entries WHERE id = ? AND user_id = ? AND status = 'pending'`,
  )
    .bind(id, user.sub)
    .run();
  if (!res.meta.changes) {
    return c.json({ error: 'Шалгагдсан бүртгэлийг устгах боломжгүй', code: 'NOT_PENDING' }, 409);
  }
  // Ирцийн сонголтын мөр (0357) FK-гүй — гараар.  Хүснэгт хараахан байхгүй
  // (миграцаас түрүүлсэн worker) бол алгасна.
  try {
    await c.env.DB.prepare(`DELETE FROM attendance_checkpoint_non_project WHERE entry_id = ?`)
      .bind(id)
      .run();
  } catch (err) {
    console.error('[non-project] selection cleanup failed', err);
  }
  await afterNonProjectChange(c.env.DB, user.sub, row.date);
  return c.json({ ok: true });
});

export default router;
