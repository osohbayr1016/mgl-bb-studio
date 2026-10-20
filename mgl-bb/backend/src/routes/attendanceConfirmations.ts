/**
 * Ирцийн САРЫН өөрийн батлалт (migration 0115-ийн `attendance_confirmations`
 * хүснэгтийг дахин ашиглана — шинэ migration үгүй).
 *
 * Ажилтан өөрийн сарын ирцийг ӨӨРӨӨ батална: "Батлах" (confirmed) эсвэл
 * "Зөрчилтэй" (disputed, шалтгаантай → админ/ахлахд мэдэгдэнэ).  Зөвхөн ДУУССАН
 * сар (2026-06-аас эхлэн, дараагийн сар эхэлмэгц) батлагдана — гараар нээсэн
 * онцгой саруудаас бусад нь (`OPEN_UNFINISHED_MONTHS`).
 *
 * Нэг мөр = (ажилтан, сар): `date='YYYY-MM-01'`, `requested_by=өөрөө`,
 * `status IN ('confirmed','disputed')`.  UNIQUE(user_id,date) тул сар тутам нэг
 * мөр (upsert).  Хуучин админ→ажилтан «өдрийн хүсэлт» загвар халагдсан.
 *
 * Хариултын ДАРААХ өөрчлөлт (migration 0403, 2026-10-15): хариулах агшинд тэр сарын ирцийн өгөгдлийн хээ
 * (`data_fingerprint`, lib/attendanceMonthFingerprint.ts) хадгалагдана.  Дараа нь админ ирц/чөлөө засвал хээ зөрж
 * `changed_since_answer = true` — ажилтанд `/due` дахин сануулга гаргана (`reason: 'changed'`), админы самбар
 * «Хариулсны дараа өөрчлөгдсөн» гэж харуулна.  Түгжээ БИШ: засвар бол зөрчлийг шийдэх зам; цалингийн модуль
 * системд байхгүй тул «цалингийн хаалт» гэсэн ойлголт ч алга (CLAUDE.md).
 */
import { Hono } from 'hono';
import { requireRole } from '../middleware/auth';
import { attendanceRosterSql } from '../lib/attendanceRoster';
import { type Env, type AppVariables } from '../types';
import { createNotificationForReviewers } from '../lib/notify';
import { nowInUBIso, todayInUB } from '../lib/time';
import { changedSinceAnswer, monthFingerprints } from '../lib/attendanceMonthFingerprint';

const router = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/** Хамгийн эрт батлагдах сар — үүнээс өмнөх сарыг батлах боломжгүй. */
const EARLIEST_MONTH = '2026-06';

/**
 * Дуусаагүй ч батлахыг ГАРААР нээсэн сарууд.
 *
 * 2026-08 — 8-р сарын цалин сар дуусахаас өмнө бодогдож эхэлсэн тул ажилтнууд
 * ирцээ урьдчилж батлах шаардлагатай болсон (эзний шийдвэр, 2026-08-26).  Энэ
 * бол ОНЦГОЙ тохиолдол: дараагийн сар автоматаар нээгдэхгүй, хэрэгтэй бол энд
 * гараар нэмнэ.  Frontend-ийн `MyDailyAttendanceCard.tsx` дахь ижил нэртэй
 * тогтмол үүнтэй хамт хөдлөх ёстой (twin file — хаана ч enforce хийдэггүй).
 */
const OPEN_UNFINISHED_MONTHS = new Set(['2026-08']);

interface ConfirmationRow {
  id: number;
  user_id: number;
  date: string;
  status: 'requested' | 'confirmed' | 'disputed';
  requested_by: number;
  requested_at: string;
  responded_at: string | null;
  request_note: string | null;
  response_note: string | null;
  created_at: string;
  updated_at: string;
  /** 0403 — хариулт өгөх агшны сарын өгөгдлийн хээ (NULL = 0403-аас өмнөх). */
  data_fingerprint?: string | null;
  // Joined
  full_name?: string;
  employee_id?: string | null;
  profile_image?: string | null;
  requester_name?: string | null;
}

const LIST_SQL = `
  SELECT ac.*, u.full_name, u.employee_id, u.profile_image,
         rq.full_name AS requester_name
  FROM attendance_confirmations ac
  JOIN users u ON u.id = ac.user_id
  LEFT JOIN users rq ON rq.id = ac.requested_by
`;

/** `/mine` дахин тооцох хээтэй хамгийн сүүлийн сарын тоо. */
const MINE_RECHECK_MONTHS = 6;

/** Хариунд хээ (дотоод) гаргахгүй; оронд нь тооцоолсон туг. */
function publicRow(r: ConfirmationRow, changed: boolean) {
  const { data_fingerprint: _fp, ...rest } = r;
  return { ...rest, changed_since_answer: changed };
}

/** 'YYYY-MM' хүчинтэй эсэх (сар 01–12) — эс бөгөөс null. */
function parseMonth(s: unknown): string | null {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}$/.test(s)) return null;
  const mm = Number(s.slice(5, 7));
  return mm >= 1 && mm <= 12 ? s : null;
}

/** Одоогийн UB сар 'YYYY-MM' (Worker runtime = UTC тул todayInUB заавал). */
function currentMonthUB(): string {
  return todayInUB().slice(0, 7);
}

/** 'YYYY-MM'-ийн өмнөх сар 'YYYY-MM'. */
function monthBefore(month: string): string {
  let y = Number(month.slice(0, 4));
  let m = Number(month.slice(5, 7)) - 1;
  if (m < 1) {
    m = 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}

/** Өмнөх UB сар 'YYYY-MM' (overview-ийн default — сүүлийн дууссан сар). */
function previousMonthUB(): string {
  const prev = monthBefore(currentMonthUB());
  return prev < EARLIEST_MONTH ? EARLIEST_MONTH : prev;
}

/**
 * Ажилтны БАТЛАХ ЁСТОЙ сар — сүүлийн ДУУССАН сар (UB огнооны өмнөх сар).
 * Шинэ сарын 1-нд өмнөх сар «батлах ёстой» болж, ажилтан «Батлах» эсвэл
 * «Зөрчилтэй» дартал сануулга (frontend `MonthConfirmPrompt`) гарсаар байна.
 * EARLIEST_MONTH-ээс өмнөх сар хэзээ ч шаардагдахгүй → null.
 */
export function dueMonthOf(todayUb: string): string | null {
  const prev = monthBefore(todayUb.slice(0, 7));
  return prev >= EARLIEST_MONTH ? prev : null;
}

// ---------------------------------------------------------------------------
// POST /api/attendance-confirmations/approve-month — ажилтан ӨӨРИЙН сарыг батлана.
// Body: { month:'YYYY-MM', status:'confirmed'|'disputed', note? }
//   • 'disputed' бол note заавал (шалтгаан).
//   • Зөвхөн 2026-06 ≤ month < одоогийн сар (ДУУССАН) байна.
// ---------------------------------------------------------------------------
router.post('/approve-month', async (c) => {
  const user = c.get('user');
  const body = await c.req
    .json<{ month?: string; status?: string; note?: string }>()
    .catch(() => ({}) as { month?: string; status?: string; note?: string });

  const month = parseMonth(body.month);
  if (!month) return c.json({ error: 'month (yyyy-mm) шаардлагатай' }, 400);

  const status =
    body.status === 'confirmed' || body.status === 'disputed' ? body.status : null;
  if (!status) {
    return c.json({ error: "status нь 'confirmed' эсвэл 'disputed' байх ёстой" }, 400);
  }
  if (month < EARLIEST_MONTH) {
    return c.json({ error: `${EARLIEST_MONTH}-аас өмнөх сарыг батлах боломжгүй` }, 400);
  }
  // Ирээдүйн сар хэзээ ч батлагдахгүй; явагдаж буй сар зөвхөн гараар нээсэн бол.
  const cur = currentMonthUB();
  if (month >= cur && !(month === cur && OPEN_UNFINISHED_MONTHS.has(month))) {
    return c.json({ error: 'Дуусаагүй сарыг батлах боломжгүй' }, 400);
  }
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
  if (status === 'disputed' && !note) {
    return c.json({ error: 'Зөрчилтэй гэж тэмдэглэхэд шалтгаан (тэмдэглэл) заавал' }, 400);
  }

  const date = `${month}-01`;

  // Мэдэгдэл давхардлаас сэргийлж одоогийн төлөвийг эхэлж уншина —
  // зөвхөн disputed руу ШИНЭЭР шилжихэд л админ/ахлахд мэдэгдэнэ.
  const existing = await c.env.DB.prepare(
    `SELECT status FROM attendance_confirmations WHERE user_id = ? AND date = ?`,
  )
    .bind(user.sub, date)
    .first<{ status: string }>();
  const wasDisputed = existing?.status === 'disputed';

  const now = nowInUBIso();
  // Хариулж буй өгөгдлийн хээ — дараа нь зөрвөл «хариулсны дараа өөрчлөгдсөн» (0403).
  const fingerprint = (await monthFingerprints(c.env.DB, month, [user.sub])).get(user.sub) ?? null;
  await c.env.DB.prepare(
    `INSERT INTO attendance_confirmations
       (user_id, date, status, requested_by, requested_at, responded_at, request_note, response_note, updated_at,
        data_fingerprint)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
     ON CONFLICT(user_id, date) DO UPDATE SET
       status = excluded.status,
       requested_by = excluded.requested_by,
       responded_at = excluded.responded_at,
       request_note = NULL,
       response_note = excluded.response_note,
       updated_at = excluded.updated_at,
       data_fingerprint = excluded.data_fingerprint`,
  )
    .bind(user.sub, date, status, user.sub, now, now, status === 'disputed' ? note : null, now, fingerprint)
    .run();

  if (status === 'disputed' && !wasDisputed) {
    const info = await c.env.DB.prepare(
      `SELECT u.full_name,
              (SELECT team_id FROM user_teams WHERE user_id = u.id AND is_primary = 1) AS team_id
         FROM users u WHERE u.id = ?`,
    )
      .bind(user.sub)
      .first<{ full_name: string; team_id: number | null }>();
    await createNotificationForReviewers(
      c.env.DB,
      info?.team_id ?? null,
      'attendance_confirm_responded',
      'Ирцэд зөрчил мэдээллээ',
      `${info?.full_name ?? ''} · ${month} — ${note}`,
      '/app/attendance',
      user.sub,
    );
  }

  const updated = await c.env.DB.prepare(`${LIST_SQL} WHERE ac.user_id = ? AND ac.date = ?`)
    .bind(user.sub, date)
    .first<ConfirmationRow>();
  return c.json({ confirmation: updated ? publicRow(updated, false) : null }, 201);
});

// ---------------------------------------------------------------------------
// GET /api/attendance-confirmations/mine — өөрийн сарын батлалтууд.
// Ажилтны хуудсанд тухайн сарын төлөвийг олоход ашиглана.
// ---------------------------------------------------------------------------
router.get('/mine', async (c) => {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare(
    `${LIST_SQL} WHERE ac.user_id = ? ORDER BY ac.date DESC LIMIT 200`,
  )
    .bind(user.sub)
    .all<ConfirmationRow>();
  const rows = results ?? [];
  // Хээтэй хариултуудын ЗӨВХӨН сүүлийн хэдэн сарыг дахин тооцно (сар тутамд 5 жижиг асуулга).
  const recent = rows.filter((r) => r.data_fingerprint).slice(0, MINE_RECHECK_MONTHS);
  const current = new Map<string, string | undefined>();
  for (const r of recent) {
    const month = r.date.slice(0, 7);
    current.set(r.date, (await monthFingerprints(c.env.DB, month, [user.sub])).get(user.sub));
  }
  return c.json({
    confirmations: rows.map((r) => publicRow(r, changedSinceAnswer(r, current.get(r.date)))),
  });
});

// ---------------------------------------------------------------------------
// GET /api/attendance-confirmations/due — сарын эхэнд гарах «ирцээ батал»
// сануулгын эх сурвалж.  `{ due: { month } }` = өмнөх сарын ирцээ хараахан
// «Батлах»/«Зөрчилтэй» гэж хариулаагүй; бусад үед `{ due: null }`.
//
// Хамрах хүрээ = ирцийн roster (идэвхтэй, клиент/TV/CEO биш) − цэвэрлэгч
// (`worker`-ийн ирцийн хуудсанд «Миний сарын ирц» хэсэг байхгүй тул очих газар
// алга) − тэр сард ажилд ороогүй хүн (`created_at` ≥ одоогийн сарын 1).
// Хуучин загварын `requested` мөр хариулт биш тул сануулга гарсаар байна.
// ---------------------------------------------------------------------------
router.get('/due', async (c) => {
  const user = c.get('user');
  const today = todayInUB();
  const month = dueMonthOf(today);
  if (!month) return c.json({ due: null });

  const row = await c.env.DB.prepare(
    `SELECT ac.status, ac.data_fingerprint
       FROM users u
       LEFT JOIN attendance_confirmations ac ON ac.user_id = u.id AND ac.date = ?
      WHERE u.id = ?
        AND ${attendanceRosterSql()}
        AND u.role != 'worker'
        AND (u.created_at IS NULL OR u.created_at < ?)`,
  )
    .bind(`${month}-01`, user.sub, `${today.slice(0, 7)}-01`)
    .first<{ status: string | null; data_fingerprint: string | null }>();

  if (!row) return c.json({ due: null });
  if (row.status === 'confirmed' || row.status === 'disputed') {
    // Хариулсны дараа админ ирцийг засвал (зөрчлийг шийдсэн ч мөн) — дахин шалгаж батлуулна.
    if (!row.data_fingerprint) return c.json({ due: null });
    const current = (await monthFingerprints(c.env.DB, month, [user.sub])).get(user.sub);
    return changedSinceAnswer(row, current)
      ? c.json({ due: { month, reason: 'changed' as const } })
      : c.json({ due: null });
  }
  return c.json({ due: { month, reason: 'unanswered' as const } });
});

// ---------------------------------------------------------------------------
// GET /api/attendance-confirmations/overview?month=YYYY-MM — админ/ахлах
// read-only самбар: идэвхтэй ажилтан БҮРИЙН тухайн сарын батлалтын төлөв.
// Roster-ыг LEFT JOIN хийж БАТЛААГҮЙ (status=null) ажилтныг ч харуулна.
// ---------------------------------------------------------------------------
router.get('/overview', requireRole('admin', 'senior'), async (c) => {
  const month = parseMonth(c.req.query('month')) ?? previousMonthUB();
  const date = `${month}-01`;

  const { results } = await c.env.DB.prepare(
    `SELECT u.id AS user_id, u.full_name, u.employee_id, u.profile_image,
            ac.status, ac.response_note, ac.responded_at, ac.data_fingerprint
       FROM users u
       LEFT JOIN attendance_confirmations ac ON ac.user_id = u.id AND ac.date = ?
      WHERE ${attendanceRosterSql()}
      ORDER BY u.full_name`,
  )
    .bind(date)
    .all<{
      user_id: number;
      full_name: string;
      employee_id: string | null;
      profile_image: string | null;
      status: 'confirmed' | 'disputed' | 'requested' | null;
      response_note: string | null;
      responded_at: string | null;
      data_fingerprint: string | null;
    }>();

  const rows = results ?? [];
  // Хээтэй хариулттай хүмүүсийн одоогийн хээ — хүснэгт тутамд НЭГ асуулга (бүх roster нэг дор).
  const current = await monthFingerprints(
    c.env.DB,
    month,
    rows.filter((r) => r.data_fingerprint).map((r) => r.user_id),
  );
  return c.json({
    month,
    rows: rows.map(({ data_fingerprint, ...r }) => ({
      ...r,
      changed_since_answer: changedSinceAnswer({ status: r.status, data_fingerprint }, current.get(r.user_id)),
    })),
  });
});

export default router;
