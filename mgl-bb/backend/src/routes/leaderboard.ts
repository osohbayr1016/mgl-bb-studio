import { Hono } from 'hono';
import { requireAdmin } from '../middleware/auth';
import { todayInUB } from '../lib/time';
import { LATE_NOT_WAIVED_SQL } from '../lib/leaveWaiver';
import { isAdminRole } from '../types';
import {
  leaderboardMemberSql,
  isLeaderboardEligibleUser,
  getCeoOnLeaderboard,
} from '../lib/ceo';
import { upsertSetting } from '../lib/settings';
import { recalculateProjectPoints } from './progress';
import { NOT_ASR_ONLY_SQL } from '../lib/asrEligible';
import { loadLeaveNeutral, type LeaveNeutral } from '../lib/leaveAvailability';
import { loadDailyAverages } from '../lib/dailyAverage';
import type { Env, AppVariables, LeaderboardEntry, MyLeaderboardStats } from '../types';

/* ============================================================
 * /api/leaderboard — rolling 30-day employee performance leaderboard.
 *
 *  Score model (after the pricing/quote feature was removed):
 *    Each project carries a free per-project complexity weight
 *    (`complexity_pct`, 0-100, set by an admin).  When a user moves
 *    project progress forward, they accrue
 *
 *        share = complexityPct × Δpct / 100,   per-user = share / N
 *
 *    "percentage points" stored on user_points.amount.  Sums of
 *    user_points.amount surface as `total_points` in API responses.
 *
 *  Privacy:
 *    • admin — full ranked list
 *      with names + percent points.
 *    • worker tier (engineer / architect / senior) — only their own data,
 *      rank shown as "5 / 12" so they know the pool size without
 *      revealing who's in it.
 *    • client — 403, sidebar entry hidden.
 * ============================================================ */

const leaderboard = new Hono<{ Bindings: Env; Variables: AppVariables }>();

const ROLLING_WINDOW = "datetime('now','-30 days')";

/** Reject `client` outright — they never see leaderboard data. */
function denyClient(role: string): Response | null {
  if (role === 'client') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}

/** Бүтээмжийн хувь — 3 орон. 1 орон 0.312-ыг 0.3 болгож самбар дээр алддаг байсан. */
function round3(n: number | null | undefined): number {
  return Math.round((n ?? 0) * 1000) / 1000;
}

/** Хувь нэмрийн хувь (`delta_pct`) нь 0.03% гэх мэт жижиг утгатай байдаг тул
 *  хоёр орон — нэг орноор бөөрөнхийлбөл олон хүн «0» болж алга болно. */
function round2(n: number | null | undefined): number {
  return Math.round((n ?? 0) * 100) / 100;
}

/** Add `n` days to a YYYY-MM-DD string.  UTC-anchored on a date-only value
 *  so it never shifts across the UB↔UTC boundary (cf. the calendar fix). */
function isoAddDays(dateStr: string, n: number): string {
  return new Date(new Date(`${dateStr}T00:00:00Z`).getTime() + n * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Батлагдсан чөлөө (2026-09-24, lib/leaveAvailability.ts): гулсах цонхны
 * «бүтээмж %» нь хүний сүүлийн K АЖИЛЛАСАН өдрийнх — чөлөөт өдрийг алгасаж
 * өмнөх ажлын өдрүүдээр нөхнө, тиймээс чөлөө хувийг өсгөхгүй, бууруулахгүй
 * (хөлдөж, ирсний дараа тэндээсээ үргэлжилнэ).  Чөлөөгүй хүнд залруулга 0.
 * `datetime('now','-N days')` цонхны УБ огнооны хувилбар: [өнөөдөр−(N−1), өнөөдөр].
 */
async function rollingLeaveNeutral(db: D1Database, days: number, userIds?: number[]): Promise<LeaveNeutral> {
  const today = todayInUB();
  return loadLeaveNeutral(db, {
    ranges: [{ from: isoAddDays(today, -(days - 1)), to: today }],
    // Нэрлэсэн нийлбэр нь `awarded_at >= datetime('now','-N days')` — хил ЯГ ижил.
    sqlWindows: [{ sinceSql: `datetime('now', '-${Math.trunc(days)} days')` }],
    userIds,
  });
}

// ─────────────────────────────────────────────────────────────────────
//  Сарын задаргаа — «хэн, ямар сард, хэдэн таск, хэдэн хувь» туслахууд
// ─────────────────────────────────────────────────────────────────────

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Хүсэлтийн `month=YYYY-MM`-ийг батлана; буруу/байхгүй бол UB-ийн энэ сар. */
function resolveMonth(raw: string | undefined): string {
  return raw && MONTH_RE.test(raw) ? raw : todayInUB().slice(0, 7);
}

/** `YYYY-MM` дээр сар нэмэх/хасах. */
function monthAdd(month: string, delta: number): string {
  const year = Number(month.slice(0, 4));
  const mon = Number(month.slice(5, 7));
  const zeroBased = year * 12 + (mon - 1) + delta;
  const y = Math.floor(zeroBased / 12);
  const m = zeroBased - y * 12 + 1;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

/** `YYYY-MM` → [эхний өдөр, дараа сарын эхний өдөр).
 *
 *  Хоёулаа `YYYY-MM-DD` тул `progress_entries.date` (огноо) БОЛОН
 *  `user_points.awarded_at` (`YYYY-MM-DD HH:MM:SS`) хоёуланд нь
 *  лексикографоор зөв ажиллана: `'2026-08-05 10:00:00' < '2026-09-01'`. */
function monthRange(month: string): { start: string; next: string } {
  return { start: `${month}-01`, next: `${monthAdd(month, 1)}-01` };
}

/** Нэг таскийн батлагдсан бүх бүртгэлийг он дарааллаар өрж, өмнөх хувийг
 *  (`prev_pct`) хажууд нь тавина.  «Бөглөсөн хувь» = percentage − prev_pct.
 *
 *  ⚠️ Энэ гинжинд baseline (`is_baseline=1`) болон амралт / хойшлуулсан мөр
 *  ЗААВАЛ багтана — эс тэгвэл 90%-иас өвлөгдсөн таск дээр 95% бичихэд
 *  «95 хувь бөглөсөн» гэж хэт өндөр гарна.  Тоолохдоо нь доор `month_rows`-д
 *  дахин шүүж хасна.
 *
 *  Эрэмбэ (`date, created_at, id`) нь progress.ts-ийн «сүүлийн батлагдсан
 *  бүртгэл» дүрэмтэй нэг ижил (CLAUDE.md-д дурдсан гурван tiebreak-ийн
 *  бүрэн хувилбар). */
const DELTA_CHAIN_SELECT = `
    SELECT
      pe.id, pe.task_id, pe.user_id, pe.percentage, pe.date,
      pe.is_baseline, pe.is_rest_day, pe.defer_next_day,
      LAG(pe.percentage) OVER (
        PARTITION BY pe.task_id ORDER BY pe.date, pe.created_at, pe.id
      ) AS prev_pct
    FROM progress_entries pe
    WHERE pe.status = 'approved'`;

/** Ажлын бодит мөр гэж тооцох шүүлт (baseline / амралт / хойшлуулсан биш). */
// 2026-10-02: `alloc_adj` = хуваарилагдсан таскийн залруулга/сэргээлтийн aggregate projection — ажлын мөр БИШ.
const REAL_WORK_ROW = `c.is_baseline = 0 AND c.is_rest_day = 0 AND c.defer_next_day = 0 AND COALESCE(c.source, '') <> 'alloc_adj'`;

// ─────────────────────────────────────────────────────────────────────
//  GET /api/leaderboard  (admin tier only)
// ─────────────────────────────────────────────────────────────────────
leaderboard.get('/', requireAdmin(), async (c) => {
  const includeCeo = await getCeoOnLeaderboard(c.env.DB);
  const { results } = await c.env.DB.prepare(
    `
    SELECT
      u.id              AS user_id,
      u.full_name,
      u.username,
      u.role,
      u.profile_image,
      COALESCE(SUM(p.amount), 0)        AS total_points,
      COUNT(DISTINCT p.project_id)      AS projects,
      COUNT(p.id)                       AS award_count,
      MAX(p.awarded_at)                 AS last_awarded_at
    FROM users u
    LEFT JOIN user_points p
      ON p.user_id = u.id
     AND p.awarded_at >= ${ROLLING_WINDOW}
    WHERE ${leaderboardMemberSql('u', includeCeo)}
      AND u.status = 'active'
      AND u.is_support = 0
    GROUP BY u.id
  `,
  ).all<{
    user_id: number;
    full_name: string;
    username: string;
    role: string;
    profile_image: string | null;
    total_points: number;
    projects: number;
    award_count: number;
    last_awarded_at: string | null;
  }>();

  // Чөлөөтэй хүн ажилласан өдрийн цонхоор (дээрх `rollingLeaveNeutral`) —
  // бүх цонх чөлөө байсан ч өмнөх ажлын өдрүүдийн оноогоор жагсаалтад үлдэнэ.
  const neutral = await rollingLeaveNeutral(c.env.DB, 30);
  const entries: LeaderboardEntry[] = (results ?? [])
    .map((r) => ({ r, total: (r.total_points ?? 0) + neutral.delta(r.user_id, 0) }))
    .filter((x) => x.r.award_count > 0 || x.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 100)
    .map(({ r, total }) => ({
      user_id: r.user_id,
      full_name: r.full_name,
      username: r.username,
      role: r.role as LeaderboardEntry['role'],
      profile_image: r.profile_image,
      total_points: round3(total),
      projects: r.projects ?? 0,
      award_count: r.award_count ?? 0,
      last_awarded_at: r.last_awarded_at,
    }));

  return c.json({ entries, window_days: 30 });
});

// ─────────────────────────────────────────────────────────────────────
//  GET /api/leaderboard/averages?days=30  (admin tier only)
//
//  Returns one row per leaderboard-eligible active user with their total
//  бүтээмж (%) inside the window plus average-per-day, per-week, and
//  per-month figures.  Weekly / monthly are total_pct / (period_days/7) and
//  total_pct / (period_days/30); the daily one is per WORKED day (below).
//
//  Батлагдсан чөлөө (2026-09-24): `total_points` нь ажилласан өдрийн цонхны
//  нийлбэр (`rollingLeaveNeutral`) — чөлөө хувийг өсгөхгүй, бууруулахгүй.
//  `total_points_actual` = хуанлийн цонхонд бодитоор олгогдсон (чөлөөгүй бол
//  ижил), `leave_days` = алгассан ажлын өдөр.  `avg_weekly` / `avg_monthly`
//  нь `total_points`-оос (хуанлийн 7 / 30 хоног).
//
//  `avg_daily` (2026-09-28, lib/dailyAverage.ts): АЖИЛЛАСАН өдрийн дундаж —
//  сүүлийн round(days × 5/7) ажлын өдөр (30 → 21); шинэ ажилтан ажилд
//  орсноос хойш ажилласан өдрөөрөө хуваагдана, ээлжийн амралт алгасагдаж
//  өмнөх ажлын өдрүүдээр нөхөгдөнө.  `avg_days` = хуваарь, `avg_target` = K;
//  `avg_days < avg_target` = шинэ ажилтан (UI тэмдэглэнэ).
// ─────────────────────────────────────────────────────────────────────
leaderboard.get('/averages', requireAdmin(), async (c) => {
  const daysRaw = parseInt(c.req.query('days') ?? '30', 10);
  const days = Math.max(7, Math.min(Number.isFinite(daysRaw) ? daysRaw : 30, 365));
  const includeCeo = await getCeoOnLeaderboard(c.env.DB);

  const { results } = await c.env.DB.prepare(
    `
    SELECT
      u.id              AS user_id,
      u.full_name,
      u.username,
      u.role,
      u.profile_image,
      u.position,
      u.employee_id,
      t.code            AS team_code,
      t.name_mn         AS team_name,
      COALESCE(SUM(p.amount), 0)        AS total_points,
      COUNT(DISTINCT p.project_id)      AS projects,
      COUNT(p.id)                       AS award_count,
      MAX(p.awarded_at)                 AS last_awarded_at
    FROM users u
    LEFT JOIN user_points p
      ON p.user_id = u.id
     AND p.awarded_at >= datetime('now', ?)
    LEFT JOIN teams t ON t.id = u.team_id
    WHERE ${leaderboardMemberSql('u', includeCeo)}
      AND u.status = 'active'
      AND u.is_support = 0
    GROUP BY u.id
    ORDER BY total_points DESC, u.full_name ASC
  `,
  )
    .bind(`-${days} days`)
    .all<{
      user_id: number;
      full_name: string;
      username: string;
      role: string;
      profile_image: string | null;
      position: string | null;
      employee_id: string | null;
      team_code: string | null;
      team_name: string | null;
      total_points: number;
      projects: number;
      award_count: number;
      last_awarded_at: string | null;
    }>();

  const weeks = Math.max(days / 7, 1);
  const months = Math.max(days / 30, 1);

  const [neutral, daily] = await Promise.all([
    rollingLeaveNeutral(c.env.DB, days),
    loadDailyAverages(c.env.DB, { windows: [{ days, userIds: (results ?? []).map((r) => r.user_id) }] }),
  ]);

  const entries = (results ?? []).map((r) => {
    const actual = r.total_points ?? 0;
    const total = actual + neutral.delta(r.user_id, 0);
    const avg = daily.get(r.user_id);
    return {
      user_id: r.user_id,
      full_name: r.full_name,
      username: r.username,
      role: r.role,
      profile_image: r.profile_image,
      position: r.position,
      employee_id: r.employee_id,
      team_code: r.team_code,
      team_name: r.team_name,
      total_points: round3(total),
      total_points_actual: round3(actual),
      avg_daily: round3(avg?.avg ?? 0),
      avg_days: avg?.days ?? 0,
      avg_target: avg?.target ?? 0,
      avg_weekly: round3(total / weeks),
      avg_monthly: round3(total / months),
      leave_days: neutral.leaveDays(r.user_id, 0),
      projects: r.projects ?? 0,
      award_count: r.award_count ?? 0,
      last_awarded_at: r.last_awarded_at,
    };
  });

  entries.sort((a, b) => b.total_points - a.total_points || a.full_name.localeCompare(b.full_name));
  return c.json({ entries, window_days: days });
});

// ─────────────────────────────────────────────────────────────────────
//  GET /api/leaderboard/monthly?month=YYYY-MM   (admin tier only)
//
//  «Сарын тайлан» таб — нэг хуанлийн сард гишүүн бүрийн хийсэн ажил:
//    reports      — ахиц бүртгэсэн тоо
//    tasks        — хөндсөн таскийн тоо
//    completed    — 100% болгож дуусгасан таскийн тоо
//    pct_added    — таскийн явцыг ахиулсан нийт хувь («бөглөсөн хувь»)
//    projects     — хөндсөн төслийн тоо
//    active_days  — ажлаа бүртгэсэн өдрийн тоо
//    points       — бүтээмж (user_points, тухайн сард олгогдсон)
//
//  Гишүүнчлэл нь /averages-тэй нэг ижил (leaderboardMemberSql + CEO toggle)
//  тул хоёр таб ижил жагсаалт харуулна.
//
//  ⚠️ `reports/tasks/pct_added` нь АЖИЛЛАСАН огноогоор (`progress_entries.date`,
//  UB), `points` нь ОЛГОГДСОН огноогоор (`user_points.awarded_at`, UTC)
//  тооцогдоно — сарын зааг дээр өдрийн зөрүү гарч болно (LeaderboardChartsTab-
//  ийн footnote-той ижил зарчим).
// ─────────────────────────────────────────────────────────────────────
leaderboard.get('/monthly', requireAdmin(), async (c) => {
  const month = resolveMonth(c.req.query('month'));
  const { start, next } = monthRange(month);
  const includeCeo = await getCeoOnLeaderboard(c.env.DB);

  const { results } = await c.env.DB.prepare(
    `
    WITH chain AS (${DELTA_CHAIN_SELECT}
        AND pe.date < ?
    ),
    month_rows AS (
      SELECT
        c.id, c.task_id, c.user_id, c.percentage, c.date,
        MAX(c.percentage - COALESCE(c.prev_pct, 0), 0) AS delta_pct,
        b.project_id
      FROM chain c
      JOIN tasks tk      ON tk.id = c.task_id
      JOIN components co ON co.id = tk.component_id
      JOIN drawings dr   ON dr.id = co.drawing_id
      JOIN blocks b      ON b.id  = dr.block_id
      WHERE c.date >= ? AND ${REAL_WORK_ROW}
    ),
    pts AS (
      SELECT p.user_id,
             SUM(p.amount) AS points,
             COUNT(p.id)   AS award_count
      FROM user_points p
      WHERE p.awarded_at >= ? AND p.awarded_at < ?
      GROUP BY p.user_id
    )
    SELECT
      u.id AS user_id,
      u.full_name,
      u.username,
      u.role,
      u.profile_image,
      u.position,
      t.code    AS team_code,
      t.name_mn AS team_name,
      COUNT(m.id)                                                     AS reports,
      COUNT(DISTINCT m.task_id)                                       AS tasks,
      COUNT(DISTINCT CASE WHEN m.percentage >= 100 THEN m.task_id END) AS completed,
      COALESCE(SUM(m.delta_pct), 0)                                   AS pct_added,
      COUNT(DISTINCT m.project_id)                                    AS projects,
      COUNT(DISTINCT m.date)                                          AS active_days,
      COALESCE(MAX(pt.points), 0)                                     AS points,
      COALESCE(MAX(pt.award_count), 0)                                AS award_count
    FROM users u
    LEFT JOIN month_rows m ON m.user_id = u.id
    LEFT JOIN teams t      ON t.id = u.team_id
    LEFT JOIN pts pt       ON pt.user_id = u.id
    WHERE ${leaderboardMemberSql('u', includeCeo)}
      AND u.status = 'active'
      AND u.is_support = 0
    GROUP BY u.id
    ORDER BY pct_added DESC, points DESC, u.full_name ASC
  `,
  )
    .bind(next, start, start, next)
    .all<{
      user_id: number;
      full_name: string;
      username: string;
      role: string;
      profile_image: string | null;
      position: string | null;
      team_code: string | null;
      team_name: string | null;
      reports: number;
      tasks: number;
      completed: number;
      pct_added: number;
      projects: number;
      active_days: number;
      points: number;
      award_count: number;
    }>();

  const entries = (results ?? []).map((r) => ({
    user_id: r.user_id,
    full_name: r.full_name,
    username: r.username,
    role: r.role,
    profile_image: r.profile_image,
    position: r.position,
    team_code: r.team_code,
    team_name: r.team_name,
    reports: r.reports ?? 0,
    tasks: r.tasks ?? 0,
    completed: r.completed ?? 0,
    pct_added: round3(r.pct_added),
    projects: r.projects ?? 0,
    active_days: r.active_days ?? 0,
    points: round3(r.points),
    award_count: r.award_count ?? 0,
  }));

  return c.json({ month, entries });
});

// ─────────────────────────────────────────────────────────────────────
//  GET /api/leaderboard/monthly/:id?month=YYYY-MM&months=12
//
//  Нэг хүний задаргаа: сүүлийн `months` сарын цуваа + сонгосон сард нь
//  хөндсөн таск бүрийн мөр.  Админ хэн ч, бусад нь зөвхөн өөрийгөө.
// ─────────────────────────────────────────────────────────────────────
leaderboard.get('/monthly/:id', async (c) => {
  const me = c.get('user');
  const denied = denyClient(me.role);
  if (denied) return denied;

  const targetId = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(targetId)) {
    return c.json({ error: 'Invalid user id' }, 400);
  }
  if (!isAdminRole(me.role) && targetId !== me.sub) {
    return c.json({ error: 'Forbidden: you can only view your own breakdown' }, 403);
  }

  const month = resolveMonth(c.req.query('month'));
  const monthsRaw = parseInt(c.req.query('months') ?? '12', 10);
  const months = Math.max(3, Math.min(Number.isFinite(monthsRaw) ? monthsRaw : 12, 24));

  const { start: monthStart, next: monthNext } = monthRange(month);
  const windowStart = `${monthAdd(month, -(months - 1))}-01`;

  // Гинжийг зөвхөн тухайн хүний хөндсөн таскуудаар хязгаарлана — бүх
  // хүснэгтийг LAG-даж скан хийхээс сэргийлнэ.  Гинж өөрөө таскийн БҮХ
  // түүхийг (baseline-ыг оруулаад) хамарсан хэвээр байх ёстой тул доод
  // хязгаар тавихгүй.
  const targetsCte = `
    targets AS (
      SELECT DISTINCT task_id
      FROM progress_entries
      WHERE user_id = ?
        AND status = 'approved'
        AND is_baseline = 0 AND is_rest_day = 0 AND defer_next_day = 0
        AND date >= ? AND date < ?
    )`;
  const chainCte = `
    chain AS (${DELTA_CHAIN_SELECT}
        AND pe.date < ?
        AND pe.task_id IN (SELECT task_id FROM targets)
    )`;
  const mineCte = `
    mine AS (
      SELECT c.id, c.task_id, c.percentage, c.date,
             MAX(c.percentage - COALESCE(c.prev_pct, 0), 0) AS delta_pct
      FROM chain c
      WHERE c.user_id = ?
        AND c.date >= ? AND c.date < ?
        AND ${REAL_WORK_ROW}
    )`;

  const [meta, seriesRes, taskRes, ptsRes, monthPtsRes] = await Promise.all([
    c.env.DB.prepare(
      `SELECT u.full_name, u.username, u.role, u.profile_image, u.position,
              t.code AS team_code, t.name_mn AS team_name
       FROM users u
       LEFT JOIN teams t ON t.id = u.team_id
       WHERE u.id = ?`,
    )
      .bind(targetId)
      .first<{
        full_name: string;
        username: string;
        role: string;
        profile_image: string | null;
        position: string | null;
        team_code: string | null;
        team_name: string | null;
      }>(),

    // Сарын цуваа — цонхны бүх сар.
    c.env.DB.prepare(
      `
      WITH ${targetsCte},${chainCte},${mineCte}
      SELECT
        strftime('%Y-%m', date)                                     AS month,
        COUNT(id)                                                   AS reports,
        COUNT(DISTINCT task_id)                                     AS tasks,
        COUNT(DISTINCT CASE WHEN percentage >= 100 THEN task_id END) AS completed,
        COALESCE(SUM(delta_pct), 0)                                 AS pct_added
      FROM mine
      GROUP BY month
      ORDER BY month ASC
    `,
    )
      .bind(targetId, windowStart, monthNext, monthNext, targetId, windowStart, monthNext)
      .all<{
        month: string;
        reports: number;
        tasks: number;
        completed: number;
        pct_added: number;
      }>(),

    // Сонгосон сарын таск бүрийн мөр.
    c.env.DB.prepare(
      `
      WITH ${targetsCte},${chainCte},${mineCte}
      SELECT
        m.task_id,
        tk.name AS task_name,
        dr.name AS drawing_name,
        b.name  AS block_name,
        pr.id   AS project_id,
        pr.name AS project_name,
        COUNT(m.id)                   AS reports,
        COALESCE(SUM(m.delta_pct), 0) AS pct_added,
        MAX(m.percentage)             AS end_pct,
        MAX(m.date)                   AS last_date
      FROM mine m
      JOIN tasks tk      ON tk.id = m.task_id
      JOIN components co ON co.id = tk.component_id
      JOIN drawings dr   ON dr.id = co.drawing_id
      JOIN blocks b      ON b.id  = dr.block_id
      JOIN projects pr   ON pr.id = b.project_id
      GROUP BY m.task_id
      ORDER BY pct_added DESC, last_date DESC
    `,
    )
      .bind(targetId, monthStart, monthNext, monthNext, targetId, monthStart, monthNext)
      .all<{
        task_id: number;
        task_name: string;
        drawing_name: string | null;
        block_name: string | null;
        project_id: number;
        project_name: string;
        reports: number;
        pct_added: number;
        end_pct: number;
        last_date: string;
      }>(),

    // Цонхны сар бүрийн бүтээмж (оноо).
    c.env.DB.prepare(
      `SELECT strftime('%Y-%m', awarded_at) AS month, SUM(amount) AS points
       FROM user_points
       WHERE user_id = ? AND awarded_at >= ? AND awarded_at < ?
       GROUP BY month`,
    )
      .bind(targetId, windowStart, monthNext)
      .all<{ month: string; points: number }>(),

    // Сонгосон сарын оноо + олголтын тоо.
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(amount), 0) AS points, COUNT(*) AS award_count
       FROM user_points
       WHERE user_id = ? AND awarded_at >= ? AND awarded_at < ?`,
    )
      .bind(targetId, monthStart, monthNext)
      .first<{ points: number; award_count: number }>(),
  ]);

  if (!meta) {
    return c.json({ error: 'User not found' }, 404);
  }

  const pointsByMonth = new Map<string, number>();
  for (const r of ptsRes.results ?? []) pointsByMonth.set(r.month, r.points ?? 0);
  const statsByMonth = new Map<
    string,
    { reports: number; tasks: number; completed: number; pct_added: number }
  >();
  for (const r of seriesRes.results ?? []) statsByMonth.set(r.month, r);

  // Цонхны сар бүрийг (өгөгдөлгүйг нь ч) гаргана — график нүх үлдээхгүй.
  const series = Array.from({ length: months }, (_, i) => {
    const m = monthAdd(month, -(months - 1 - i));
    const hit = statsByMonth.get(m);
    return {
      month: m,
      reports: hit?.reports ?? 0,
      tasks: hit?.tasks ?? 0,
      completed: hit?.completed ?? 0,
      pct_added: round3(hit?.pct_added),
      points: round3(pointsByMonth.get(m)),
    };
  });

  const tasks = (taskRes.results ?? []).map((r) => ({
    task_id: r.task_id,
    task_name: r.task_name,
    drawing_name: r.drawing_name,
    block_name: r.block_name,
    project_id: r.project_id,
    project_name: r.project_name,
    reports: r.reports ?? 0,
    pct_added: round3(r.pct_added),
    end_pct: round3(r.end_pct),
    last_date: r.last_date,
  }));

  return c.json({
    user_id: targetId,
    full_name: meta.full_name,
    username: meta.username,
    role: meta.role,
    profile_image: meta.profile_image,
    position: meta.position,
    team_code: meta.team_code,
    team_name: meta.team_name,
    month,
    months,
    series,
    tasks,
    month_points: round3(monthPtsRes?.points),
    month_award_count: monthPtsRes?.award_count ?? 0,
  });
});

// ─────────────────────────────────────────────────────────────────────
//  GET /api/leaderboard/me
// ─────────────────────────────────────────────────────────────────────
leaderboard.get('/me', async (c) => {
  const me = c.get('user');
  const denied = denyClient(me.role);
  if (denied) return denied;
  const includeCeo = await getCeoOnLeaderboard(c.env.DB);

  const { results: ranked } = await c.env.DB.prepare(
    `
    SELECT
      u.id          AS user_id,
      SUM(p.amount) AS total_points
    FROM users u
    LEFT JOIN user_points p
      ON p.user_id = u.id
     AND p.awarded_at >= ${ROLLING_WINDOW}
    WHERE ${leaderboardMemberSql('u', includeCeo)}
      AND u.status = 'active'
      AND u.is_support = 0
    GROUP BY u.id
    ORDER BY COALESCE(SUM(p.amount), 0) DESC
  `,
  ).all<{ user_id: number; total_points: number | null }>();

  // Чөлөөтэй хүн ажилласан өдрийн цонхоор — байр ч, хувь ч чөлөөнөөс хамаарахгүй.
  const neutral = await rollingLeaveNeutral(c.env.DB, 30);
  const actualMine = (ranked ?? []).find((r) => r.user_id === me.sub)?.total_points ?? 0;
  const list = (ranked ?? [])
    .map((r) => {
      const adjusted = (r.total_points ?? 0) + neutral.delta(r.user_id, 0);
      return { user_id: r.user_id, total_points: r.total_points === null && adjusted === 0 ? null : adjusted };
    })
    .sort((a, b) => (b.total_points ?? 0) - (a.total_points ?? 0));
  const eligibleList = list.filter((r) => r.total_points !== null && (r.total_points ?? 0) > 0);
  const myIndex = list.findIndex((r) => r.user_id === me.sub);
  const myEntry = myIndex >= 0 ? list[myIndex] : null;
  const myPoints = myEntry?.total_points ?? 0;
  const rank =
    isLeaderboardEligibleUser(me.role, me.sub, includeCeo) && myPoints > 0
      ? eligibleList.findIndex((r) => r.user_id === me.sub) + 1
      : null;

  const { results: recentRows } = await c.env.DB.prepare(
    `
    SELECT
      p.id, p.project_id, p.task_id,
      p.amount, p.delta_pct, p.awarded_at,
      pr.name AS project_name,
      pr.complexity_pct AS complexity_pct,
      t.name  AS task_name
    FROM user_points p
    LEFT JOIN projects pr ON pr.id = p.project_id
    LEFT JOIN tasks    t  ON t.id  = p.task_id
    WHERE p.user_id = ?
    ORDER BY p.awarded_at DESC
    LIMIT 10
  `,
  )
    .bind(me.sub)
    .all<{
      id: number;
      project_id: number;
      task_id: number | null;
      amount: number;
      delta_pct: number;
      awarded_at: string;
      project_name: string | null;
      complexity_pct: number | null;
      task_name: string | null;
    }>();

  const recent: MyLeaderboardStats['recent'] = (recentRows ?? []).map((r) => ({
    id: r.id,
    project_id: r.project_id,
    project_name: r.project_name,
    project_complexity_pct: r.complexity_pct,
    task_id: r.task_id,
    task_name: r.task_name,
    points: round3(r.amount),
    delta_pct: r.delta_pct,
    awarded_at: r.awarded_at,
  }));

  const countRow = await c.env.DB.prepare(
    `
    SELECT COUNT(*) AS n
    FROM user_points
    WHERE user_id = ? AND awarded_at >= ${ROLLING_WINDOW}
  `,
  )
    .bind(me.sub)
    .first<{ n: number }>();

  const stats: MyLeaderboardStats = {
    rank,
    total_workers: eligibleList.length,
    total_points: round3(myPoints),
    total_points_actual: round3(actualMine),
    leave_days: neutral.leaveDays(me.sub, 0),
    award_count: countRow?.n ?? 0,
    recent,
  };

  return c.json(stats);
});

// ─────────────────────────────────────────────────────────────────────
//  GET /api/leaderboard/me/series?days=30
// ─────────────────────────────────────────────────────────────────────
leaderboard.get('/me/series', async (c) => {
  const me = c.get('user');
  const denied = denyClient(me.role);
  if (denied) return denied;

  const daysRaw = parseInt(c.req.query('days') ?? '30', 10);
  const days = Math.max(7, Math.min(Number.isFinite(daysRaw) ? daysRaw : 30, 90));

  const { results } = await c.env.DB.prepare(
    `
    SELECT
      DATE(awarded_at) AS day,
      SUM(amount)      AS points,
      COUNT(*)         AS n
    FROM user_points
    WHERE user_id = ?
      AND awarded_at >= datetime('now', ?)
    GROUP BY DATE(awarded_at)
    ORDER BY day ASC
  `,
  )
    .bind(me.sub, `-${days} days`)
    .all<{ day: string; points: number; n: number }>();

  const byDay = new Map<string, { points: number; n: number }>();
  for (const r of results ?? []) {
    byDay.set(r.day, { points: r.points ?? 0, n: r.n ?? 0 });
  }

  const series: Array<{
    date: string;
    points: number;
    cum_points: number;
    n: number;
  }> = [];
  let cum = 0;
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const hit = byDay.get(iso) ?? { points: 0, n: 0 };
    cum += hit.points;
    series.push({
      date: iso,
      points: round3(hit.points),
      cum_points: round3(cum),
      n: hit.n,
    });
  }

  return c.json({
    days,
    series,
    total_points: round3(cum),
  });
});

// ─────────────────────────────────────────────────────────────────────
//  GET /api/leaderboard/project/:id
// ─────────────────────────────────────────────────────────────────────
leaderboard.get('/project/:id', async (c) => {
  const me = c.get('user');
  const denied = denyClient(me.role);
  if (denied) return denied;

  const projectId = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(projectId)) {
    return c.json({ error: 'Invalid project id' }, 400);
  }

  const isAdmin = isAdminRole(me.role);

  if (isAdmin) {
    const { results } = await c.env.DB.prepare(
      `
      SELECT
        u.id              AS user_id,
        u.full_name,
        u.username,
        u.role,
        u.profile_image,
        SUM(p.amount)                AS total_points,
        -- «Энэ хүн төслийн хэдэн хувийг хийсэн бэ».  delta_pct нь батлах
        -- бүрд төслийн НИЙТ явц хэдэн хувиар өссөнийг хадгалдаг бөгөөд мөр
        -- бүр ганц хүнд бичигддэг (assignee_count үргэлж 1) тул хүнээр
        -- нийлбэрлэхэд төслийн бодит хувь гарна; бүгдийн нийлбэр нь
        -- төслийн нийт явцтай тэнцэнэ (жишээ: төсөл 32 → 7.81% ≈ 7.8%).
        -- source='progress' шүүлт ЗААВАЛ: засварын оноо (source='repair')
        -- мөн delta_pct бичдэг ч тэр нь төслийн явцтай хамааралгүй.
        SUM(CASE WHEN p.source = 'progress' THEN p.delta_pct ELSE 0 END) AS project_pct,
        COUNT(*)                     AS award_count,
        MAX(p.awarded_at)            AS last_awarded_at
      FROM user_points p
      JOIN users u ON u.id = p.user_id
      WHERE p.project_id = ?
      GROUP BY u.id
      ORDER BY project_pct DESC, total_points DESC
    `,
    )
      .bind(projectId)
      .all<{
        user_id: number;
        full_name: string;
        username: string;
        role: string;
        profile_image: string | null;
        total_points: number;
        project_pct: number;
        award_count: number;
        last_awarded_at: string | null;
      }>();

    const projectRow = await c.env.DB.prepare(`SELECT complexity_pct FROM projects WHERE id = ?`)
      .bind(projectId)
      .first<{ complexity_pct: number | null }>();

    return c.json({
      contributors: (results ?? []).map((r) => ({
        user_id: r.user_id,
        full_name: r.full_name,
        username: r.username,
        role: r.role,
        profile_image: r.profile_image,
        total_points: round3(r.total_points),
        project_pct: round2(r.project_pct ?? 0),
        award_count: r.award_count ?? 0,
        last_awarded_at: r.last_awarded_at,
      })),
      project_complexity_pct: projectRow?.complexity_pct ?? null,
      // Бүх хувь нэмрийн нийлбэр — клиент «эзлэх хувь»-ийг дахин
      // тооцохгүйгээр туузаа зурна.
      project_total_pct: round2(
        (results ?? []).reduce((sum, r) => sum + (r.project_pct ?? 0), 0),
      ),
    });
  }

  // Worker view — single row, just the caller's contribution + rank.
  const { results: ranked } = await c.env.DB.prepare(
    `
    SELECT user_id,
           SUM(amount) AS total_points,
           SUM(CASE WHEN source = 'progress' THEN delta_pct ELSE 0 END) AS project_pct
    FROM user_points
    WHERE project_id = ?
    GROUP BY user_id
    ORDER BY project_pct DESC, total_points DESC
  `,
  )
    .bind(projectId)
    .all<{ user_id: number; total_points: number; project_pct: number }>();

  const list = ranked ?? [];
  const idx = list.findIndex((r) => r.user_id === me.sub);
  const myPoints = idx >= 0 ? (list[idx]?.total_points ?? 0) : 0;
  const myPct = idx >= 0 ? (list[idx]?.project_pct ?? 0) : 0;
  const totalPct = list.reduce((sum, r) => sum + (r.project_pct ?? 0), 0);

  const countRow = await c.env.DB.prepare(
    `
    SELECT COUNT(*) AS n FROM user_points
    WHERE project_id = ? AND user_id = ?
  `,
  )
    .bind(projectId, me.sub)
    .first<{ n: number }>();

  return c.json({
    me: {
      user_id: me.sub,
      total_points: round3(myPoints),
      project_pct: round2(myPct),
      award_count: countRow?.n ?? 0,
      rank: idx >= 0 ? idx + 1 : null,
      total_contributors: list.length,
    },
    project_total_pct: round2(totalPct),
  });
});

// ─────────────────────────────────────────────────────────────────────
//  GET /api/leaderboard/user/:id
// ─────────────────────────────────────────────────────────────────────
leaderboard.get('/user/:id', async (c) => {
  const me = c.get('user');
  const denied = denyClient(me.role);
  if (denied) return denied;

  const targetId = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(targetId)) {
    return c.json({ error: 'Invalid user id' }, 400);
  }

  const isAdmin = isAdminRole(me.role);
  if (!isAdmin && targetId !== me.sub) {
    return c.json({ error: 'Forbidden: you can only view your own breakdown' }, 403);
  }

  const { results } = await c.env.DB.prepare(
    `
    SELECT
      p.project_id,
      p.repair_project_id,
      COALESCE(pr.name, rp.name) AS project_name,
      CASE WHEN p.repair_project_id IS NOT NULL THEN 1 ELSE 0 END AS is_repair_project,
      pr.complexity_pct AS project_complexity_pct,
      SUM(p.amount)            AS total_points,
      -- «Энэ хүн тухайн төслийн хэдэн хувийг хийсэн бэ» — /project/:id-тэй
      -- ижил томьёо.  source='progress' шүүлт ЗААВАЛ: засварын мөр
      -- (source='repair') мөн delta_pct бичдэг ч төслийн явцтай хамааралгүй.
      SUM(CASE WHEN p.source = 'progress' THEN p.delta_pct ELSE 0 END) AS project_pct,
      COUNT(*)                 AS award_count,
      MAX(p.awarded_at)        AS last_awarded_at
    FROM user_points p
    LEFT JOIN projects        pr ON pr.id = p.project_id
    LEFT JOIN repair_projects rp ON rp.id = p.repair_project_id
    WHERE p.user_id = ?
    -- ⚠️ ХОЁР баганаар бүлэглэнэ (0194).  project_id NULL байж болох болсон
    -- тул зөвхөн түүгээр бүлэглэвэл SQLite бүх NULL-ыг НЭГ бүлэг гэж үзэж,
    -- бүх засварын төслийн оноог нэг нэргүй мөр болгон нийлүүлнэ.
    GROUP BY p.project_id, p.repair_project_id
    ORDER BY total_points DESC
  `,
  )
    .bind(targetId)
    .all<{
      project_id: number | null;
      repair_project_id: number | null;
      project_name: string | null;
      is_repair_project: number;
      project_complexity_pct: number | null;
      total_points: number;
      project_pct: number | null;
      award_count: number;
      last_awarded_at: string | null;
    }>();

  const breakdown = (results ?? []).map((r) => ({
    project_id: r.project_id,
    repair_project_id: r.repair_project_id,
    is_repair_project: r.is_repair_project === 1,
    project_name: r.project_name,
    project_complexity_pct: r.project_complexity_pct,
    total_points: round3(r.total_points),
    project_pct: round2(r.project_pct ?? 0),
    award_count: r.award_count,
    last_awarded_at: r.last_awarded_at,
  }));

  const totalRow = await c.env.DB.prepare(
    `SELECT SUM(amount) AS total_points, COUNT(*) AS n FROM user_points WHERE user_id = ?`,
  )
    .bind(targetId)
    .first<{ total_points: number | null; n: number }>();

  return c.json({
    user_id: targetId,
    total_points: round3(totalRow?.total_points ?? 0),
    award_count: totalRow?.n ?? 0,
    by_project: breakdown,
  });
});

// ─────────────────────────────────────────────────────────────────────
//  GET /api/leaderboard/user/:id/series?days=30   (admin)
//  Нэг хүний өдрийн цуваа — бүтээмж (points), хоцролт (late_minutes),
//  ажилласан цаг (hours) + ирсэн өдрийн тоо.  «Хандлага» табд зориулсан.
// ─────────────────────────────────────────────────────────────────────
leaderboard.get('/user/:id/series', requireAdmin(), async (c) => {
  const targetId = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(targetId)) {
    return c.json({ error: 'Invalid user id' }, 400);
  }

  const daysRaw = parseInt(c.req.query('days') ?? '30', 10);
  const days = Math.max(7, Math.min(Number.isFinite(daysRaw) ? daysRaw : 30, 90));

  // Огнооны тэнхлэгийг UB-аар үүсгэнэ (UTC toISOString-ийн off-by-one-аас
  // сэргийлнэ).  Attendance-ийн `date` шүүлт мөн UB өдрөөс эхэлнэ.
  const today = todayInUB();
  const windowStart = isoAddDays(today, -(days - 1));

  const [meta, pointRes, attRes] = await Promise.all([
    c.env.DB.prepare(
      `SELECT u.full_name, u.role, u.profile_image,
              t.code AS team_code, t.name_mn AS team_name
       FROM users u
       LEFT JOIN teams t ON t.id = u.team_id
       WHERE u.id = ?`,
    )
      .bind(targetId)
      .first<{
        full_name: string;
        role: string;
        profile_image: string | null;
        team_code: string | null;
        team_name: string | null;
      }>(),
    c.env.DB.prepare(
      `SELECT DATE(awarded_at) AS day, SUM(amount) AS points
       FROM user_points
       WHERE user_id = ? AND awarded_at >= datetime('now', ?)
       GROUP BY DATE(awarded_at)`,
    )
      .bind(targetId, `-${days} days`)
      .all<{ day: string; points: number }>(),
    c.env.DB.prepare(
      `SELECT a.date AS day,
              COALESCE(SUM(a.hours_worked), 0) AS hours,
              COALESCE(MAX(CASE WHEN ${LATE_NOT_WAIVED_SQL} THEN a.late_minutes ELSE 0 END), 0) AS late_minutes,
              COUNT(*) AS sessions
       FROM attendance_sessions a
       WHERE a.user_id = ? AND a.date >= ? AND a.clock_out IS NOT NULL
       GROUP BY a.date`,
    )
      .bind(targetId, windowStart)
      .all<{ day: string; hours: number; late_minutes: number; sessions: number }>(),
  ]);

  if (!meta) {
    return c.json({ error: 'User not found' }, 404);
  }

  const pointsByDay = new Map<string, number>();
  for (const r of pointRes.results ?? []) pointsByDay.set(r.day, r.points ?? 0);
  const attByDay = new Map<string, { hours: number; late: number; sessions: number }>();
  for (const r of attRes.results ?? [])
    attByDay.set(r.day, {
      hours: r.hours ?? 0,
      late: r.late_minutes ?? 0,
      sessions: r.sessions ?? 0,
    });

  const dates: string[] = [];
  const points: number[] = [];
  const late_minutes: number[] = [];
  const hours: number[] = [];
  let present_days = 0;
  for (let i = days - 1; i >= 0; i--) {
    const iso = isoAddDays(today, -i);
    dates.push(iso);
    points.push(round3(pointsByDay.get(iso) ?? 0));
    const att = attByDay.get(iso);
    late_minutes.push(att?.late ?? 0);
    hours.push(Math.round((att?.hours ?? 0) * 10) / 10);
    if (att && att.sessions > 0) present_days += 1;
  }

  return c.json({
    user_id: targetId,
    full_name: meta.full_name,
    role: meta.role,
    profile_image: meta.profile_image,
    team_code: meta.team_code,
    team_name: meta.team_name,
    days,
    dates,
    points,
    late_minutes,
    hours,
    present_days,
  });
});

// ─────────────────────────────────────────────────────────────────────
//  POST /api/leaderboard/recalc-all   (admin tier)
//
//  Rebuilds the entire `user_points` ledger for EVERY project under the
//  current weights + complexity + crediting rules.  Use after a global
//  rule change (e.g. baseline entries now credit the task's assignee) to
//  backfill history.  Idempotent — each project's ledger is deleted and
//  replayed from its approved progress entries, so it is safe to re-run.
// ─────────────────────────────────────────────────────────────────────
leaderboard.post('/recalc-all', requireAdmin(), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT p.id FROM projects p WHERE ${NOT_ASR_ONLY_SQL} ORDER BY p.id`,
  ).all<{ id: number }>();
  const ids = (results ?? []).map((r) => r.id);

  const recalculated: number[] = [];
  const failed: Array<{ project_id: number; error: string }> = [];
  for (const id of ids) {
    try {
      await recalculateProjectPoints(c.env.DB, id);
      recalculated.push(id);
    } catch (err) {
      failed.push({ project_id: id, error: String(err) });
    }
  }

  return c.json({
    projects: ids.length,
    recalculated: recalculated.length,
    failed,
  });
});

// ─────────────────────────────────────────────────────────────────────
//  GET / PUT /api/leaderboard/settings  (admin only)
//  CEO-г бүтээмжийн самбарт харуулах эсэх toggle (`app_settings`).
// ─────────────────────────────────────────────────────────────────────
leaderboard.get('/settings', requireAdmin(), async (c) => {
  const ceoOnLeaderboard = await getCeoOnLeaderboard(c.env.DB);
  return c.json({ ceo_on_leaderboard: ceoOnLeaderboard });
});

leaderboard.put('/settings', requireAdmin(), async (c) => {
  const user = c.get('user');
  const body = (await c.req.json().catch(() => ({}))) as { ceo_on_leaderboard?: boolean };
  if (typeof body.ceo_on_leaderboard === 'boolean') {
    await upsertSetting(
      c.env.DB,
      'ceo_on_leaderboard',
      body.ceo_on_leaderboard ? '1' : '0',
      user.sub,
    );
  }
  const ceoOnLeaderboard = await getCeoOnLeaderboard(c.env.DB);
  return c.json({ ceo_on_leaderboard: ceoOnLeaderboard });
});

export default leaderboard;
