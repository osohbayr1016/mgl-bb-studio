/**
 * Төслийн бус ажлын ШАЛГАЛТ — `/api/reports/non-project-work` (админ).
 *
 * «Тайлан → Төслийн бус ажлын тайлан» табын backend.  Ажилтны тал
 * (`routes/nonProjectWork.ts`, `/api/non-project-work`) нь зөвхөн
 * engineer/architect/senior-д нээлттэй тул админы замууд ТУСДАА файлд,
 * Тайлан хуудасны `/api/reports` угтвар дор — тэр угтвар бүхэлдээ
 * `requireAdmin()` бөгөөд `workerScope` / `clientScope`-ийн цагаан
 * жагсаалтад байхгүй (worker, client-д аль хэдийн хаалттай).  Энд дахин
 * `requireAdmin()` нь хоёр дахь давхарга.
 *
 * Урсгал: ажилтан бүртгэнэ → хийнэ → «юу хийсэн» тайлбараа бичиж илгээнэ
 * (`report`) → админ ЭНД батална / татгалзана.  Шинэ төлөв зохиогоогүй —
 * 0342-ийн `pending → approved | rejected` (чөлөө, OOO-ийн `decide()`-ийн
 * хэлбэр: шийдэгдсэн мөр 409).  Шийдвэр зөвхөн ИЛГЭЭСЭН мөрөнд
 * (`lib/nonProjectReview.ts` `reviewBlock`).
 *
 * БҮТЭЭМЖ (эзний шийдвэр, 2026-09-24): БАТЛАХ мөчид л оноо бичигдэнэ —
 * засвартай ИЖИЛ томьёо, ИЖИЛ функц:
 *     оноо = baseDailyRate('amount', …) × (цаг / 8)      (lib/repairProgress.ts)
 * `user_points`-д source = 'non_project', төсөл/засварын төсөлгүй (0343-ийн
 * CHECK).  Онооны самбар, Тайлангийн «Бүтээмж», өдрийн snapshot нь
 * `SUM(amount)` уншдаг тул өөрчлөлтгүйгээр тооцно.  Ханш нь бүртгэл
 * ҮҮССЭН мөчийнх (`until = created_at`) — засвар бүртгэх мөчдөө ханшаа
 * хөлдөөдөгтэй ижил, тиймээс админ хэдэн хоногийн дараа баталсан ч тоо
 * өөрчлөгдөхгүй.  Ханш, шат, хувь нь мөрөнд snapshot (0344).
 *
 * ОНОО АЖЛЫН ӨДӨРТ (эзний шийдвэр, 2026-09-24): `user_points.awarded_at` =
 * ажлын өдрийн дуусах цаг (`workDateAwardedAt`), батласан өдөр БИШ — 22-нд
 * хийсэн ажлыг 24-нд баталбал Тайлангийн өдөр/7 хоног/сар, онооны самбар 22-нд
 * тооцно.  Тэр өдрөөс хойш аль хэдийн бичигдсэн өдрийн snapshot-ууд
 * (`employee_daily_snapshots`) энэ оноог агуулаагүй тул дахин бодогдоно
 * (`refreshSnapshotsAfter`).
 */
import { Hono } from 'hono';
import { requireAdmin } from '../middleware/auth';
import type { Env, AppVariables } from '../types';
import { nowInUBIso, todayInUB } from '../lib/time';
import { leaderboardMemberSql } from '../lib/ceo';
import { baseDailyRate, pctForHours } from '../lib/repairProgress';
import { isoAddDays, orgUtcOffsetMinutes } from '../lib/reportWindows';
import { refreshSnapshotsAfter } from '../lib/employeeSnapshot';
import {
  loadEntry,
  shapeEntry,
  syncNonProjectCreditSafe,
  withPicks,
  NO_PICKS,
  type EntryPicks,
  type NonProjectRow,
} from '../lib/nonProjectWorkStore';
import {
  NON_PROJECT_POINTS_SOURCE,
  STAGE_WHERE,
  filterWhere,
  minutesToHours,
  normalizeReviewNote,
  parseReviewFilter,
  reviewBlock,
  workDateAwardedAt,
} from '../lib/nonProjectReview';

const review = new Hono<{ Bindings: Env; Variables: AppVariables }>();

review.use('*', requireAdmin());

/** Нэг хүсэлтэд буцаах дээд мөр — илүү бол `truncated`. */
const LIST_LIMIT = 200;

type ReviewRow = NonProjectRow & {
  daily_rate: number | null;
  rate_source: string | null;
  full_name: string | null;
  username: string;
  profile_image: string | null;
  user_status: string | null;
  team_code: string | null;
  team_name: string | null;
  reviewer_name: string | null;
};

const SELECT_SQL = `
  SELECT e.id, e.user_id, e.date, e.category, e.note, e.start_time, e.end_time, e.minutes,
         e.report, e.reported_at, e.status, e.reviewed_by, e.reviewed_at, e.review_note,
         e.created_at, e.updated_at, e.daily_rate, e.rate_source, e.computed_pct,
         u.full_name, u.username, u.profile_image, u.status AS user_status,
         t.code AS team_code, t.name_mn AS team_name,
         rv.full_name AS reviewer_name
    FROM non_project_work_entries e
    JOIN users u       ON u.id  = e.user_id
    LEFT JOIN teams t  ON t.id  = u.team_id
    LEFT JOIN users rv ON rv.id = e.reviewed_by`;

function shapeReview(r: ReviewRow, picks: EntryPicks = NO_PICKS) {
  return {
    ...shapeEntry(r, picks),
    user: {
      id: r.user_id,
      full_name: r.full_name,
      username: r.username,
      profile_image: r.profile_image,
      team_code: r.team_code,
      team_name: r.team_name,
      active: r.user_status === 'active',
    },
    reviewer: r.reviewed_by ? { id: r.reviewed_by, full_name: r.reviewer_name } : null,
    // `computed_pct` нь `shapeEntry`-д (ажилтны «Миний ажлууд» ч харуулна).
    daily_rate: r.daily_rate,
    rate_source: r.rate_source,
  };
}

async function loadReviewRow(db: D1Database, id: number): Promise<ReviewRow | null> {
  return (await db.prepare(`${SELECT_SQL} WHERE e.id = ?`).bind(id).first<ReviewRow>()) ?? null;
}

/** Нэг мөрийн хариу — ирцийн хагастай нь (цаггүй бүртгэл, 0357). */
async function reviewItem(db: D1Database, id: number) {
  const out = await loadReviewRow(db, id);
  if (!out) return null;
  const [item] = await withPicks(db, [out], shapeReview);
  return item ?? null;
}

function parseId(raw: string | undefined): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// GET /api/reports/non-project-work?stage=&user_id=
//   stage: awaiting_review (өгөгдмөл) | needs_report | approved | rejected | all
review.get('/', async (c) => {
  const filter = parseReviewFilter(c.req.query('stage'));
  const userId = parseId(c.req.query('user_id'));
  const userWhere = userId ? ' AND e.user_id = ?' : '';
  const binds = userId ? [userId] : [];
  // Шалгах дараалал: хамгийн удаан хүлээсэн нь дээрээ.  Бусад: сүүлийнх нь дээрээ.
  const order =
    filter === 'awaiting_review'
      ? 'e.date ASC, e.start_time ASC, e.id ASC'
      : 'e.date DESC, e.start_time DESC, e.id DESC';

  const count = (stage: keyof typeof STAGE_WHERE) =>
    `COALESCE(SUM(CASE WHEN ${STAGE_WHERE[stage]} THEN 1 ELSE 0 END), 0) AS ${stage}`;

  const [list, counts] = await Promise.all([
    c.env.DB.prepare(`${SELECT_SQL} WHERE ${filterWhere(filter)}${userWhere} ORDER BY ${order} LIMIT ?`)
      .bind(...binds, LIST_LIMIT + 1)
      .all<ReviewRow>(),
    c.env.DB.prepare(
      `SELECT ${count('awaiting_review')}, ${count('needs_report')}, ${count('approved')}, ${count('rejected')}
         FROM non_project_work_entries e
        WHERE 1 = 1${userWhere}`,
    )
      .bind(...binds)
      .first<Record<keyof typeof STAGE_WHERE, number>>(),
  ]);

  const rows = list.results ?? [];
  return c.json({
    stage: filter,
    items: await withPicks(c.env.DB, rows.slice(0, LIST_LIMIT), shapeReview),
    truncated: rows.length > LIST_LIMIT,
    counts: {
      awaiting_review: counts?.awaiting_review ?? 0,
      needs_report: counts?.needs_report ?? 0,
      approved: counts?.approved ?? 0,
      rejected: counts?.rejected ?? 0,
    },
  });
});

type Decidable =
  | { ok: true; row: NonProjectRow }
  | { ok: false; error: { error: string; code?: string }; status: 400 | 404 | 409 };

/** Шийдвэр гаргах боломжгүй бол 400 / 404 / 409 хариу, эс бөгөөс мөр. */
async function decidable(db: D1Database, id: number | null): Promise<Decidable> {
  if (id == null) return { ok: false, error: { error: 'Invalid id' }, status: 400 };
  const row = await loadEntry(db, id);
  if (!row) return { ok: false, error: { error: 'Not found' }, status: 404 };
  const block = reviewBlock(row);
  if (block) return { ok: false, error: { error: block.error, code: block.code }, status: block.status };
  return { ok: true, row };
}

/**
 * 0 мөр өөрчлөгдсөн үед — одоогийн төлвөөр 409: өөр админ түрүүлж шийдсэн
 * (`ALREADY_DECIDED`), эсвэл ажилтан яг тэр агшинд бүртгэлээ засчихсан
 * (`CHANGED` — оноо хуучин минутаар бичигдэхээс сэргийлнэ).
 */
async function lostRace(db: D1Database, id: number) {
  const now = await loadEntry(db, id);
  if (!now) return { error: 'Not found', code: 'NOT_FOUND' };
  const block = reviewBlock(now);
  if (block) return { error: block.error, code: block.code };
  return { error: 'Ажилтан бүртгэлээ сая өөрчилсөн байна — жагсаалтыг шинэчлээд дахин шалгана уу', code: 'CHANGED' };
}

// POST /api/reports/non-project-work/:id/approve  { note? }
review.post('/:id/approve', async (c) => {
  const admin = c.get('user');
  const id = parseId(c.req.param('id'));
  const d = await decidable(c.env.DB, id);
  if (!d.ok) return c.json(d.error, d.status);
  const row = d.row;
  const body = await c.req.json<{ note?: unknown }>().catch(() => ({ note: undefined }));
  const note = normalizeReviewNote(body.note);

  // Засвартай ИЖИЛ ханш, ИЖИЛ хүн ам (`routes/repair.ts` `baseDailyRate`).
  const rate = await baseDailyRate(c.env.DB, row.user_id, 'amount', leaderboardMemberSql('u', false), row.created_at);
  const pct = pctForHours(rate.rate, minutesToHours(row.minutes));
  // Оноо АЖЛЫН ӨДӨРТ — файлын толгойг үз.  Хөрвүүлэлт нь ажлын өдрийн цагийн бүсээр.
  // Шалгуулахаар илгээсэн мөр үргэлж цагтай (`reviewBlock`); `?? '23:59'` нь зөвхөн
  // төрлийн хамгаалалт.  `workDateAwardedAt` одоогийн мөчөөс хойш хэзээ ч бичихгүй.
  const awardedAt = workDateAwardedAt(
    { date: row.date, end_time: row.end_time ?? '23:59' },
    orgUtcOffsetMinutes(new Date(`${row.date}T12:00:00Z`)),
    Date.now(),
  );

  // НЭГ транзакц: оноо + төлөв.  Хоёр мөр ижил нөхцөлтэй (шийдэгдээгүй,
  // илгээсэн, уншсанаас хойш засагдаагүй — `updated_at`) тул хоёулаа болно
  // эсвэл хоёулаа 0 — зэрэг хоёр админ дарвал хоёр дахь нь юу ч бичихгүй.
  // `NOT EXISTS` нь давхар онооны сүүлийн хаалт.
  // 0 оноо (ханш 0 г.м.) — 0 оноотой мөр дэвтэрт бичихгүй; төлөв нь л батлагдана.
  const statements = [
    c.env.DB.prepare(
      `INSERT INTO user_points
         (user_id, project_id, repair_project_id, task_id, progress_entry_id,
          amount, delta_pct, assignee_count, awarded_by, source, repair_entry_id, non_project_work_id,
          awarded_at)
       SELECT e.user_id, NULL, NULL, NULL, NULL, ?, ?, 1, e.user_id, ?, NULL, e.id,
              COALESCE(?, datetime('now'))
         FROM non_project_work_entries e
        WHERE e.id = ? AND e.updated_at = ? AND e.status = 'pending' AND e.report IS NOT NULL AND TRIM(e.report) <> ''
          AND e.start_time IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM user_points up WHERE up.non_project_work_id = e.id)`,
    ).bind(pct, pct, NON_PROJECT_POINTS_SOURCE, awardedAt, row.id, row.updated_at),
  ].filter(() => pct > 0);
  const results = await c.env.DB.batch([
    ...statements,
    c.env.DB.prepare(
      `UPDATE non_project_work_entries
          SET status = 'approved', reviewed_by = ?, reviewed_at = ?, review_note = ?,
              daily_rate = ?, rate_source = ?, computed_pct = ?, updated_at = datetime('now')
        WHERE id = ? AND updated_at = ? AND status = 'pending' AND report IS NOT NULL AND TRIM(report) <> ''
          AND start_time IS NOT NULL`,
    ).bind(admin.sub, nowInUBIso(), note, rate.rate, rate.source, pct, row.id, row.updated_at),
  ]);
  const updated = results[results.length - 1];
  if (!updated?.meta.changes) return c.json(await lostRace(c.env.DB, row.id), 409);

  // Ажлын өдөр өнгөрсөн бол тэр өдрөөс хойших snapshot-ууд хуучирсан.
  if (row.date < todayInUB()) {
    c.executionCtx.waitUntil(
      refreshSnapshotsAfter(c.env.DB, row.date).catch((err) =>
        console.error('[non-project-review] snapshot refresh failed', err),
      ),
    );
  }

  return c.json({ item: await reviewItem(c.env.DB, row.id) });
});

// POST /api/reports/non-project-work/:id/reject  { note? }
// Татгалзсан ажил оноонд орохгүй, ирцийн өдрийн тоололд ч тооцогдохгүй
// (`nonProjectDayCounts` rejected-ийг алгасдаг), ажилласан цагт ч нэмэгдэхгүй.
review.post('/:id/reject', async (c) => {
  const admin = c.get('user');
  const id = parseId(c.req.param('id'));
  const d = await decidable(c.env.DB, id);
  if (!d.ok) return c.json(d.error, d.status);
  const body = await c.req.json<{ note?: unknown }>().catch(() => ({ note: undefined }));
  const note = normalizeReviewNote(body.note);

  const res = await c.env.DB.prepare(
    `UPDATE non_project_work_entries
        SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, review_note = ?,
            updated_at = datetime('now')
      WHERE id = ? AND status = 'pending' AND report IS NOT NULL AND TRIM(report) <> ''
        AND start_time IS NOT NULL`,
  )
    .bind(admin.sub, nowInUBIso(), note, d.row.id)
    .run();
  if (!res.meta.changes) return c.json(await lostRace(c.env.DB, d.row.id), 409);
  // Татгалзсан ажлын хугацаа ирцийн ажилласан цагаас ч гарна (0352).
  await syncNonProjectCreditSafe(c.env.DB, d.row.user_id, d.row.date);

  return c.json({ item: await reviewItem(c.env.DB, d.row.id) });
});

export default review;
