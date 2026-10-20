import { Hono } from 'hono';
import { requireAdmin, requireManager } from '../middleware/auth';
import { todayInUB } from '../lib/time';
import { isIsoDate } from '../lib/reportWindows';
import { upsertSetting } from '../lib/settings';
import { createNotification } from '../lib/notify';
import {
  GAP_THRESHOLD_SETTING_KEY,
  buildWarningText,
  isPeriodKind,
  parseThresholdPct,
  resolvePeriod,
} from '../lib/teamProductivity';
import { loadTeamAccess, loadTeamProductivity } from '../lib/teamProductivityStore';
import { loadTeamsLeaderboard } from '../lib/teamLeaderboardStore';
import type { Env, AppVariables } from '../types';

/* ============================================================
 * /api/teams — багийн профайлын «Бүтээмж» таб (2026-09-24).  `routes/teams.ts`-ийн
 * ХОЁР ДАХЬ mount (`index.ts`).  Замууд нь үндсэн router-тэй давхцахгүй:
 * тэнд `/:id`, `/:id/overview`, `/:id/member-tasks`, `/:id/members` л бий.
 *
 *   GET  /:id/productivity?period=day|week|month&date=YYYY-MM-DD
 *        — захирал (admin) бүх баг; ахлах өөрийн баг; ахлахгүй багт тухайн
 *          баг үндсэн баг нь болох senior-ууд (`loadTeamAccess`).  Бусад 403.
 *   POST /:id/productivity/warnings   (admin) — ахлахад анхааруулга
 *   PUT  /productivity/settings       (admin) — зөрүүний босго (%)
 *   GET  /productivity/leaderboard?period=&date=  (admin + senior) — БҮХ багийн
 *        эрэмбэ (Багууд хуудасны «Эрэмбэ» таб, `lib/teamLeaderboard*.ts`).
 *        Хоёр сегменттэй тул үндсэн router-ийн `/:id`-д баригдахгүй.
 *
 * Тоо бүр СЕРВЕР дээр бодогдоно (`lib/teamProductivity*.ts`); анхааруулгын
 * бичвэр ч клиентийн илгээсэн тоонд ИТГЭХГҮЙ — тухайн хугацааг дахин бодно.
 * `worker` / `client` нь `/api/teams`-д аль хэдийн хаалттай (scope allowlist).
 * ============================================================ */

const teamProductivity = new Hono<{ Bindings: Env; Variables: AppVariables }>();

const NOTE_MAX = 1000;

function parseId(raw: string | undefined): number | null {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** «Овог Нэр» → «Нэр Овог» — frontend `formatDisplayName`-тэй ижил (мэдэгдлийн бичвэрт). */
function displayName(full: string | null | undefined): string {
  const s = (full ?? '').trim();
  const i = s.indexOf(' ');
  if (i <= 0) return s;
  const ner = s.slice(i + 1).trim();
  return ner ? `${ner} ${s.slice(0, i)}` : s;
}

// ─────────────────────────────────────────────────────────────────────
//  PUT /api/teams/productivity/settings  { threshold_pct }
// ─────────────────────────────────────────────────────────────────────
teamProductivity.put('/productivity/settings', requireAdmin(), async (c) => {
  const body = await c.req.json<{ threshold_pct?: unknown }>().catch(() => null);
  const raw = body?.threshold_pct;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 1 || n > 100) {
    return c.json({ error: 'threshold_pct нь 1–100 хооронд байна', code: 'INVALID_THRESHOLD' }, 400);
  }
  const value = parseThresholdPct(n);
  await upsertSetting(c.env.DB, GAP_THRESHOLD_SETTING_KEY, String(value), c.get('user').sub);
  return c.json({ threshold_pct: value });
});

// ─────────────────────────────────────────────────────────────────────
//  GET /api/teams/productivity/leaderboard?period=day|week|month&date=
//  Зөвхөн багийн нийлбэр/дундаж — хувь хүний тоо буцаахгүй (дээд хүний нэр л).
// ─────────────────────────────────────────────────────────────────────
teamProductivity.get('/productivity/leaderboard', requireManager(), async (c) => {
  const kind = c.req.query('period') ?? 'week';
  if (!isPeriodKind(kind)) return c.json({ error: 'period нь day | week | month', code: 'INVALID_PERIOD' }, 400);
  const today = todayInUB();
  const date = c.req.query('date') ?? today;
  if (!isIsoDate(date)) return c.json({ error: 'date нь YYYY-MM-DD', code: 'INVALID_DATE' }, 400);
  const payload = await loadTeamsLeaderboard(c.env.DB, resolvePeriod(kind, date, today));
  c.header('Cache-Control', 'private, no-store');
  return c.json(payload);
});

// ─────────────────────────────────────────────────────────────────────
//  GET /api/teams/:id/productivity
// ─────────────────────────────────────────────────────────────────────
teamProductivity.get('/:id/productivity', async (c) => {
  const teamId = parseId(c.req.param('id'));
  if (teamId === null) return c.json({ error: 'Invalid team id' }, 400);
  const kind = c.req.query('period') ?? 'week';
  if (!isPeriodKind(kind)) return c.json({ error: 'period нь day | week | month', code: 'INVALID_PERIOD' }, 400);
  const today = todayInUB();
  const date = c.req.query('date') ?? today;
  if (!isIsoDate(date)) return c.json({ error: 'date нь YYYY-MM-DD', code: 'INVALID_DATE' }, 400);

  const access = await loadTeamAccess(c.env.DB, c.get('user'), teamId);
  if (!access) return c.json({ error: 'Team not found' }, 404);
  if (!access.can_view) return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);

  const payload = await loadTeamProductivity(c.env.DB, access, resolvePeriod(kind, date, today));
  c.header('Cache-Control', 'private, no-store');
  return c.json(payload);
});

// ─────────────────────────────────────────────────────────────────────
//  POST /api/teams/:id/productivity/warnings
//  { period, date, recipient_ids: number[], note?: string }
// ─────────────────────────────────────────────────────────────────────
teamProductivity.post('/:id/productivity/warnings', requireAdmin(), async (c) => {
  const teamId = parseId(c.req.param('id'));
  if (teamId === null) return c.json({ error: 'Invalid team id' }, 400);
  const body = await c.req
    .json<{ period?: unknown; date?: unknown; recipient_ids?: unknown; note?: unknown }>()
    .catch(() => null);
  if (!body) return c.json({ error: 'Invalid JSON' }, 400);
  const kind = body.period;
  if (!isPeriodKind(kind)) return c.json({ error: 'period нь day | week | month', code: 'INVALID_PERIOD' }, 400);
  const today = todayInUB();
  const date = body.date ?? today;
  if (!isIsoDate(date)) return c.json({ error: 'date нь YYYY-MM-DD', code: 'INVALID_DATE' }, 400);
  const requested = Array.isArray(body.recipient_ids)
    ? [...new Set(body.recipient_ids.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0))]
    : [];
  if (requested.length === 0) return c.json({ error: 'Хүлээн авагч сонгоно уу', code: 'NO_RECIPIENTS' }, 400);
  const noteRaw = typeof body.note === 'string' ? body.note.trim() : '';
  if (noteRaw.length > NOTE_MAX) return c.json({ error: `Тэмдэглэл ${NOTE_MAX} тэмдэгтээс ихгүй`, code: 'NOTE_TOO_LONG' }, 400);
  const note = noteRaw || null;

  const user = c.get('user');
  const access = await loadTeamAccess(c.env.DB, user, teamId);
  if (!access) return c.json({ error: 'Team not found' }, 404);

  // Тоог ДАХИН бодно — дэлгэц дээр харсан тоо хуучирсан байж болно.
  const period = resolvePeriod(kind, date, today);
  const data = await loadTeamProductivity(c.env.DB, access, period);
  const allowed = new Map(data.warning_candidates.map((w) => [w.id, w]));
  const bad = requested.filter((id) => !allowed.has(id));
  if (bad.length > 0) {
    return c.json(
      { error: 'Зөвхөн багийн ахлах эсвэл тухайн багийн senior ажилтанд илгээнэ', code: 'RECIPIENT_NOT_ALLOWED', user_ids: bad },
      400,
    );
  }
  const recipients = requested.map((id) => ({ id, full_name: allowed.get(id)!.full_name }));

  const byId = new Map(data.members.map((m) => [m.user_id, m]));
  const below = data.members
    .filter((m) => m.below_line)
    .sort((a, b) => (a.avg ?? 0) - (b.avg ?? 0));
  const sender = await c.env.DB.prepare('SELECT full_name FROM users WHERE id = ?')
    .bind(user.sub)
    .first<{ full_name: string }>();
  const topName = data.gap.top_user_id != null ? byId.get(data.gap.top_user_id)?.full_name : null;
  const bottomName = data.gap.bottom_user_id != null ? byId.get(data.gap.bottom_user_id)?.full_name : null;
  const { title, body: text } = buildWarningText({
    team_code: data.team.code,
    team_name: data.team.name_mn,
    kind,
    from: period.from,
    to: period.until,
    gap: data.gap,
    top_name: topName ? displayName(topName) : null,
    bottom_name: bottomName ? displayName(bottomName) : null,
    below: below.map((m) => ({ full_name: displayName(m.full_name), avg: m.avg, need: m.need_per_day })),
    note,
    sender_name: displayName(sender?.full_name) || 'Захирал',
  });

  const belowSnapshot = below.map((m) => ({ user_id: m.user_id, full_name: m.full_name, avg: m.avg }));
  let insertedId: number | null = null;
  try {
    const res = await c.env.DB.prepare(
      `INSERT INTO team_productivity_warnings
         (team_id, period_kind, period_from, period_to, gap_pct, threshold_pct,
          top_user_id, top_avg, bottom_user_id, bottom_avg, team_avg,
          below_json, note, recipients_json, sent_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        teamId,
        kind,
        period.from,
        period.until,
        data.gap.gap_pct,
        data.threshold_pct,
        data.gap.top_user_id,
        data.gap.top_avg,
        data.gap.bottom_user_id,
        data.gap.bottom_avg,
        data.summary.team_avg,
        JSON.stringify(belowSnapshot),
        note,
        JSON.stringify(recipients),
        user.sub,
      )
      .run();
    insertedId = Number(res.meta.last_row_id) || null;
  } catch (err) {
    // Миграц тавигдаагүй (worker түрүүлж deploy) — мэдэгдэл ч явуулахгүй:
    // түүхгүй анхааруулга «илгээгээгүй» мэт харагдаж давхар илгээгдэнэ.
    console.error('[team-productivity] warning insert failed', err);
    return c.json({ error: 'Анхааруулгыг хадгалж чадсангүй', code: 'STORE_FAILED' }, 500);
  }

  const link = `/app/teams/${teamId}?tab=productivity&period=${kind}&date=${period.from}`;
  await Promise.all(recipients.map((r) => createNotification(c.env.DB, r.id, 'team_gap_warning', title, text, link)));

  return c.json(
    {
      warning: {
        id: insertedId,
        period_kind: kind,
        period_from: period.from,
        period_to: period.until,
        gap_pct: data.gap.gap_pct,
        threshold_pct: data.threshold_pct,
        note,
        recipients,
        below: belowSnapshot,
      },
      notified: recipients,
      title,
      body: text,
    },
    201,
  );
});

export default teamProductivity;
