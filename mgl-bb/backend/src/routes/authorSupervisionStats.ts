/**
 * Зохиогчийн хяналт — `/app/asr` хуудасны САМБАРЫН статистик.
 *
 * `/api/author-supervision` дээр mount хийгдсэн ХОЁР ДАХЬ router
 * (`routes/authorSupervision.ts`-ийн хажууд; `clientDrive.ts` ↔ `clientPortal.ts`
 * загвар).  ⚠️ `index.ts`-д ҮНДСЭН router-ээс ӨМНӨ mount хийгдэх ЁСТОЙ —
 * тэр нь `GET /:id`-тэй бөгөөд `/stats`-ыг `id = "stats"` гэж уншаад 400
 * буцаана (`projects.ts`-ийн `/top`·`/reorder` конвенцын ижил урхи).
 *
 * Тоо бүр ОДОО БАЙГАА өгөгдлөөс:
 *   • тайлан         = `submitted|approved` (`ASR_COUNTED_SQL`) — БҮХ төрөл;
 *   • очилт          = тайлан + `report_type = 'site'` (Талбайн хяналт, 0362;
 *                      visits-тэй ижил).  Цахим/оффис уулзалт, зургийн
 *                      өөрчлөлт нь очилт БИШ — `by_type`-д тусдаа (эзний
 *                      шийдвэр 2026-09-29).  Батлах хүлээлт, улаан дэвтэр,
 *                      гарын үсэг, зураг нь БҮХ төрлийн тайлан дээр;
 *   • батлах хүлээлт = `submitted_at → reviewed_at` дундаж хоног (батлагдсан + хоёулаа
 *                      бөглөгдсөн мөр л; ноорог, хуучин NULL мөр орохгүй);
 *   • улаан дэвтэр   = `redBookStatusOf`-ийн ижил дөрвөн төлөв (0366-аас «байгаагүй»), очилт дээр;
 *   • гарын үсэг     = 2 слотын URL байгаа эсэх;
 *   • зураг          = `photos_json`-ы массивын урт (json1).
 * Аюулгүй байдлын (ХАБЭА, осол, PPE) хүснэгт системд БАЙХГҮЙ тул тийм
 * статистик ЭНД ЗОРИУД алга — frontend-ийн сануулга нь статик текст.
 *
 * Эрх: `ASR_ROLES`-ийн ижил цагаан жагсаалт (client/worker 403).  Төслийн
 * хүрээ = `/project-summaries`-ийн ижил `is_pending` дүрэм — тиймээс
 * инженерийн харж буй самбар ба төслийн жагсаалт нэг тоо хэлнэ.
 * Ноорогийн тоо нь ҮЗЭГЧИЙНХ: админ бүх ноорог, бусад нь өөрийнхөө.
 *
 * Эзний шийдвэр 2026-09-29:
 *   • тоо бүр үзэгчийн ХАРАХ тайлангаас (`lib/asrVisibility.ts` — ББ-гийнхэн
 *     ББ-гийнхээ л, админ нэгдсэн);
 *   • «Багаар» (`by_team`), «Бүрдэл» (`review` + `signatures`), «Хамгийн
 *     идэвхтэй зохиогчид» (`by_person`) нь ЗӨВХӨН админд — бусдад хоосон
 *     массив / null (асуулга огт явахгүй).  Frontend-ийн нуух нь зөвхөн UX.
 */
import { Hono } from 'hono';
import { todayInUB } from '../lib/time';
import { isAdminRole } from '../types';
import { asrLabelSql } from '../lib/asrProjectName';
import { asrVisibleSql } from '../lib/asrVisibility';
import { redBookStatusOf } from '../lib/asrRedBook';
import { ASR_REPORT_TYPES, ASR_SITE_SQL, type AsrReportType } from '../lib/asrReportType';
import {
  ASR_COUNTED_SQL,
  fillMonthSeries,
  shiftMonth,
  statsWindows,
  type MonthBucket,
} from '../lib/asrStats';
import type { Env, AppVariables } from '../types';

const router = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/** `routes/authorSupervision.ts`-ийн `ASR_ROLES`-ийн ИХЭР (тэр файл export хийдэггүй). */
const ASR_ROLES = new Set(['admin', 'engineer', 'architect', 'senior']);

/** Сарын графикийн урт — 12 сар (өгөгдөл 2026-05-аас эхэлдэг). */
const MONTHS = 12;
/** «Хамгийн идэвхтэй зохиогчид» жагсаалтын урт. */
const TOP_PEOPLE = 8;
/** «Сүүлийн тайлангууд» жагсаалтын урт. */
const RECENT = 6;

/** Зургийн тоо — `photos_json` нь `[{url,name}]`; гэмтсэн JSON 0. */
const PHOTO_COUNT_SQL = `CASE WHEN json_valid(r.photos_json) THEN json_array_length(r.photos_json) ELSE 0 END`;

router.get('/stats', async (c) => {
  const user = c.get('user');
  if (!ASR_ROLES.has(user.role)) return c.json({ error: 'Forbidden' }, 403);
  const isAdmin = isAdminRole(user.role);
  const seesPending = isAdmin || user.role === 'senior';

  const today = todayInUB();
  const w = statsWindows(today);

  // Төслийн хүрээ — `/project-summaries`-тэй ижил: гэрээ хэлэлцээрийн шатны
  // (`is_pending`) төслийг admin/senior л хардаг.
  const projectScope = seesPending
    ? ''
    : `AND EXISTS (SELECT 1 FROM projects p WHERE p.id = r.project_id AND COALESCE(p.is_pending, 0) = 0)`;
  const visible = asrVisibleSql({ sub: user.sub, isAdmin });
  const COUNTED = `${ASR_COUNTED_SQL} ${projectScope} AND ${visible}`;
  /** «Очилт» = талбайн хяналт (0362). */
  const VISIT = `${COUNTED} AND ${ASR_SITE_SQL}`;
  const SITE = ASR_SITE_SQL;
  const none = Promise.resolve(null);

  const [totals, drafts, review, byTeam, byMonth, byPerson, recent, byType] = await Promise.all([
    // Нэг скан: очилтын баганууд `${SITE}` нөхцөлтэй, бусад нь бүх төрөл.
    c.env.DB.prepare(
      `SELECT COUNT(*) AS reports,
              SUM(${SITE}) AS visits,
              SUM(r.status = 'approved') AS approved,
              SUM(r.status = 'submitted') AS awaiting_review,
              COUNT(DISTINCT CASE WHEN ${SITE} THEN r.project_id END) AS projects_visited,
              COUNT(DISTINCT CASE WHEN ${SITE} THEN r.author_id END) AS authors,
              MIN(CASE WHEN ${SITE} THEN r.report_date END) AS first_visit,
              MAX(CASE WHEN ${SITE} THEN r.report_date END) AS last_visit,
              SUM(${SITE} AND r.report_date >= ? AND r.report_date < ?) AS this_month,
              SUM(${SITE} AND r.report_date >= ? AND r.report_date < ?) AS prev_month,
              SUM(${SITE} AND r.report_date >= ?) AS last_30_days,
              SUM(${SITE} AND r.report_date >= ? AND r.report_date <= ?) AS prev_30_days,
              SUM(${PHOTO_COUNT_SQL}) AS photos_total,
              SUM(r.red_book_verified_at IS NOT NULL) AS red_book_verified,
              SUM(r.red_book_verified_at IS NULL AND r.red_book_photo_url IS NOT NULL) AS red_book_signed,
              SUM(r.red_book_verified_at IS NULL AND r.red_book_photo_url IS NULL
                  AND r.red_book_absent = 1) AS red_book_absent,
              SUM(r.red_book_verified_at IS NULL AND r.red_book_photo_url IS NULL
                  AND r.red_book_absent = 0) AS red_book_missing,
              SUM(r.sig_arch_url IS NOT NULL) AS sig_arch,
              SUM(r.sig_site_url IS NOT NULL) AS sig_site,
              SUM(r.sig_arch_url IS NOT NULL AND r.sig_site_url IS NOT NULL) AS sig_both
         FROM author_supervision_reports r
        WHERE ${COUNTED}`,
    )
      .bind(
        w.thisMonthFrom,
        w.thisMonthTo,
        w.prevMonthFrom,
        w.thisMonthFrom,
        w.last30From,
        w.prev30From,
        w.prev30To,
      )
      .first<Record<string, number | string | null>>(),
    // Ноорог — үзэгчийн харах эрхтэй нь (`DRAFT_VISIBILITY`-ийн ижил дүрэм).
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n
         FROM author_supervision_reports r
        WHERE r.status = 'draft' AND (r.author_id = ? OR ? = 1)`,
    )
      .bind(user.sub, isAdmin ? 1 : 0)
      .first<{ n: number }>(),
    // Батлах хүлээлт — зөвхөн хоёр огноо нь хоёулаа бөглөгдсөн батлагдсан мөр.
    // «Бүрдэл» самбарынх — зөвхөн админд.
    !isAdmin ? none : c.env.DB.prepare(
      `SELECT COUNT(*) AS sample,
              ROUND(AVG(julianday(r.reviewed_at) - julianday(r.submitted_at)), 1) AS avg_days,
              ROUND(MAX(julianday(r.reviewed_at) - julianday(r.submitted_at)), 1) AS max_days
         FROM author_supervision_reports r
        WHERE r.status = 'approved'
          AND r.submitted_at IS NOT NULL AND r.reviewed_at IS NOT NULL
          AND julianday(r.reviewed_at) >= julianday(r.submitted_at) ${projectScope}`,
    ).first<{ sample: number; avg_days: number | null; max_days: number | null }>(),
    // «Багаар» — зөвхөн админд.
    !isAdmin ? none : c.env.DB.prepare(
      `SELECT t.id AS team_id, t.code, t.name_mn, t.name_en,
              COUNT(*) AS visits,
              MAX(r.report_date) AS last_visit
         FROM author_supervision_report_teams rt
         JOIN author_supervision_reports r ON r.id = rt.report_id
         JOIN teams t ON t.id = rt.team_id
        WHERE ${VISIT}
        GROUP BY t.id
        ORDER BY visits DESC, t.sort_order, t.code`,
    ).all<{
      team_id: number;
      code: string;
      name_mn: string;
      name_en: string | null;
      visits: number;
      last_visit: string | null;
    }>(),
    c.env.DB.prepare(
      `SELECT substr(r.report_date, 1, 7) AS month,
              COUNT(*) AS visits,
              SUM(r.status = 'approved') AS approved
         FROM author_supervision_reports r
        WHERE ${VISIT} AND r.report_date >= ?
        GROUP BY month
        ORDER BY month`,
    )
      .bind(`${shiftMonth(w.thisMonth, -(MONTHS - 1))}-01`)
      .all<MonthBucket>(),
    // Хүнээр — тайланг БҮРТГЭСЭН хүн (`author_id`); visits endpoint-ийн ижил дүрэм.
    // «Хамгийн идэвхтэй зохиогчид» — зөвхөн админд.
    !isAdmin ? none : c.env.DB.prepare(
      `SELECT u.id AS user_id, u.full_name, u.profile_image AS avatar_url,
              COUNT(*) AS visits,
              COUNT(DISTINCT r.project_id) AS projects,
              MAX(r.report_date) AS last_visit
         FROM author_supervision_reports r
         JOIN users u ON u.id = r.author_id
        WHERE ${VISIT}
        GROUP BY u.id
        ORDER BY visits DESC, last_visit DESC, u.full_name
        LIMIT ${TOP_PEOPLE}`,
    ).all<{
      user_id: number;
      full_name: string;
      avatar_url: string | null;
      visits: number;
      projects: number;
      last_visit: string | null;
    }>(),
    c.env.DB.prepare(
      `SELECT r.id, r.doc_no, r.report_date, r.status, r.project_id,
              r.report_type, r.meeting_platform,
              ${asrLabelSql('p')} AS project_name,
              u.full_name AS author_name,
              r.red_book_photo_url, r.red_book_verified_at, r.red_book_absent,
              ${PHOTO_COUNT_SQL} AS photo_count,
              (SELECT group_concat(t.code)
                 FROM author_supervision_report_teams rt
                 JOIN teams t ON t.id = rt.team_id
                WHERE rt.report_id = r.id) AS team_codes
         FROM author_supervision_reports r
         JOIN projects p ON p.id = r.project_id
         LEFT JOIN users u ON u.id = r.author_id
        WHERE ${COUNTED}
        ORDER BY r.report_date DESC, r.id DESC
        LIMIT ${RECENT}`,
    ).all<{
      id: number;
      doc_no: string | null;
      report_date: string;
      status: string;
      project_id: number;
      report_type: string;
      meeting_platform: string | null;
      project_name: string;
      author_name: string | null;
      red_book_photo_url: string | null;
      red_book_verified_at: string | null;
      red_book_absent: number | null;
      photo_count: number;
      team_codes: string | null;
    }>(),
    // «Төрлөөр» (0362) — очилтоос ТУСДАА тоо: бүх төрөл, энэ сар ба нийт.
    c.env.DB.prepare(
      `SELECT r.report_type AS type,
              COUNT(*) AS total,
              SUM(r.report_date >= ? AND r.report_date < ?) AS this_month,
              MAX(r.report_date) AS last_date
         FROM author_supervision_reports r
        WHERE ${COUNTED}
        GROUP BY r.report_type`,
    )
      .bind(w.thisMonthFrom, w.thisMonthTo)
      .all<{ type: string; total: number; this_month: number; last_date: string | null }>(),
  ]);

  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const s = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
  const t = totals ?? {};

  // Төрөл бүр ҮРГЭЛЖ гарна (0-тэй ч) — самбар 4 мөрөө тогтмол дараалалтай зурна.
  const typeRows = new Map((byType.results ?? []).map((r) => [r.type, r]));
  const by_type = ASR_REPORT_TYPES.map((type: AsrReportType) => {
    const hit = typeRows.get(type);
    return {
      type,
      total: n(hit?.total),
      this_month: n(hit?.this_month),
      last_date: s(hit?.last_date),
    };
  });

  return c.json({
    today,
    totals: {
      /** Бүх төрлийн илгээсэн/батлагдсан тайлан (0362). */
      reports: n(t.reports),
      visits: n(t.visits),
      approved: n(t.approved),
      awaiting_review: n(t.awaiting_review),
      my_drafts: drafts?.n ?? 0,
      projects_visited: n(t.projects_visited),
      authors: n(t.authors),
      first_visit: s(t.first_visit),
      last_visit: s(t.last_visit),
      this_month: n(t.this_month),
      prev_month: n(t.prev_month),
      last_30_days: n(t.last_30_days),
      prev_30_days: n(t.prev_30_days),
      photos_total: n(t.photos_total),
    },
    review: isAdmin
      ? {
          sample: review?.sample ?? 0,
          avg_days: review?.avg_days ?? null,
          max_days: review?.max_days ?? null,
        }
      : null,
    red_book: {
      verified: n(t.red_book_verified),
      signed: n(t.red_book_signed),
      absent: n(t.red_book_absent),
      missing: n(t.red_book_missing),
    },
    signatures: isAdmin
      ? {
          arch: n(t.sig_arch),
          site: n(t.sig_site),
          both: n(t.sig_both),
        }
      : null,
    by_team: byTeam?.results ?? [],
    by_month: fillMonthSeries(byMonth.results ?? [], today, MONTHS),
    by_person: byPerson?.results ?? [],
    by_type,
    recent: (recent.results ?? []).map((r) => {
      const { red_book_photo_url, red_book_verified_at, red_book_absent, ...rest } = r;
      return {
        ...rest,
        red_book_status: redBookStatusOf({ red_book_photo_url, red_book_verified_at, red_book_absent }),
      };
    }),
  });
});

export default router;
