/**
 * Багийн профайлын «Бүтээмж» табын D1 уншилт (2026-09-24).  Дүрэм бүгд
 * `teamProductivity.ts`-д (цэвэр, тесттэй) — энэ файл зөвхөн өгөгдөл цуглуулж
 * тэр функцүүдэд дамжуулна.
 *
 * Гишүүн = тухайн баг ҮНДСЭН баг нь (`user_teams.is_primary = 1`), идэвхтэй,
 * `is_support = 0`, Онооны самбарт ордог роль (`isLeaderboardEligibleUser` —
 * engineer/architect/senior, CEO нь самбарын тохиргоогоор).  `/teams/:id/overview`,
 * Тайлан хуудасны багийн мөр ч үндсэн багаар тоолдог — нэг хүн хоёр багт давхар
 * орохгүй.  ⚠️ Гишүүнчлэлийн ТҮҮХ байхгүй: өөр багаас шилжиж ирсэн хүний
 * өнгөрсөн оноо одоогийн багт нь тоологдоно.
 *
 * Эрх (эзний шийдвэр 2026-09-24): захирал (admin) бүх багийг харж анхааруулга
 * илгээнэ; багийн ахлах (`teams.lead_user_id`, идэвхтэй senior) — зөвхөн өөрийн
 * багийг; ахлах тохируулаагүй багт тухайн баг ҮНДСЭН баг нь болох senior-ууд.
 * Энэ нь анхааруулга хүлээж авах хүмүүстэй ЯГ ижил олонлог (`warningCandidates`).
 *
 * Хэмжээ: гишүүн ~20, түүх 12 сар хүртэл — `user_points(user_id, awarded_at)`,
 * `attendance_sessions(user_id, date)`, `progress_entries(user_id, date)`,
 * `daily_active_projects(user_id, date)`, `non_project_work_entries(user_id, date)`
 * индексүүдээр.  Хариу хэрэглэгчээс хамаардаг тул edge cache-гүй.
 */
import { isAdminRole } from '../types';
import { getHolidaySet } from './holidays';
import { orgUtcOffsetMinutes, sqliteOffsetModifier, ubDayBoundsUtc } from './reportWindows';
import { getCeoOnLeaderboard, isLeaderboardEligibleUser } from './ceo';
import { ASR_COUNTED_SQL } from './asrStats';
import { APPROVED_LEAVE_OVERLAP_SQL, leaveDatesByUser, type ApprovedLeaveRow } from './leaveAvailability';
import {
  DEFAULT_GAP_THRESHOLD_PCT,
  GAP_THRESHOLD_SETTING_KEY,
  HISTORY_COUNT,
  computeGap,
  hasWorkingDay,
  historyRanges,
  memberAverage,
  memberWorkDates,
  neededPerDay,
  parseThresholdPct,
  pctOfTop,
  ratePct,
  round1,
  round4,
  type DateRange,
  type GapResult,
  type MemberDaily,
  type PeriodKind,
  type ResolvedPeriod,
} from './teamProductivity';

/* ------------------------------------------------------------------ */
/*  Эрх                                                                */
/* ------------------------------------------------------------------ */

export interface TeamInfo {
  id: number;
  code: string;
  name_mn: string;
  name_en: string | null;
  lead_user_id: number | null;
  /** Идэвхтэй senior ахлах л — өөр role-той болсон хуучирсан заалт тоогдохгүй. */
  lead_active: boolean;
  lead_name: string | null;
}

export interface TeamAccess {
  team: TeamInfo;
  can_view: boolean;
  /** Анхааруулга илгээх, босго өөрчлөх — зөвхөн захирал (admin). */
  can_warn: boolean;
  is_lead: boolean;
}

/** Багийн мэдээлэл + үзэгчийн эрх.  Баг байхгүй бол null. */
export async function loadTeamAccess(
  db: D1Database,
  viewer: { sub: number; role: string },
  teamId: number,
): Promise<TeamAccess | null> {
  const row = await db
    .prepare(
      `SELECT t.id, t.code, t.name_mn, t.name_en, t.lead_user_id,
              lu.full_name AS lead_name,
              CASE WHEN lu.id IS NOT NULL AND lu.status = 'active' AND lu.role = 'senior' THEN 1 ELSE 0 END AS lead_active,
              EXISTS (SELECT 1 FROM user_teams vt WHERE vt.user_id = ? AND vt.team_id = t.id AND vt.is_primary = 1) AS viewer_primary
         FROM teams t
         LEFT JOIN users lu ON lu.id = t.lead_user_id
        WHERE t.id = ?`,
    )
    .bind(viewer.sub, teamId)
    .first<{
      id: number;
      code: string;
      name_mn: string;
      name_en: string | null;
      lead_user_id: number | null;
      lead_name: string | null;
      lead_active: number;
      viewer_primary: number;
    }>();
  if (!row) return null;
  const leadActive = row.lead_active === 1 && row.lead_user_id != null;
  const team: TeamInfo = {
    id: row.id,
    code: row.code,
    name_mn: row.name_mn,
    name_en: row.name_en,
    lead_user_id: leadActive ? row.lead_user_id : null,
    lead_active: leadActive,
    lead_name: leadActive ? row.lead_name : null,
  };
  const isAdmin = isAdminRole(viewer.role);
  const isLead = leadActive && row.lead_user_id === viewer.sub;
  const isSeniorFallback = !leadActive && viewer.role === 'senior' && row.viewer_primary === 1;
  return { team, can_view: isAdmin || isLead || isSeniorFallback, can_warn: isAdmin, is_lead: isLead };
}

/** Анхааруулга хүлээн авах боломжтой хүмүүс — ахлах, эсвэл багийн senior-ууд. */
export interface WarningCandidate {
  id: number;
  full_name: string;
  profile_image: string | null;
  is_lead: boolean;
  /** Анхааруулгын цонхонд урьдчилан чагтлах эсэх — ахлах байвал зөвхөн ахлах. */
  default_selected: boolean;
}

export async function warningCandidates(db: D1Database, team: TeamInfo): Promise<WarningCandidate[]> {
  const { results } = await db
    .prepare(
      `SELECT u.id, u.full_name, u.profile_image
         FROM users u
        WHERE u.status = 'active' AND u.role = 'senior'
          AND (u.id = ? OR u.id IN (SELECT user_id FROM user_teams WHERE team_id = ? AND is_primary = 1))
        ORDER BY u.full_name`,
    )
    .bind(team.lead_user_id ?? 0, team.id)
    .all<{ id: number; full_name: string; profile_image: string | null }>();
  return (results ?? []).map((u) => {
    const isLead = team.lead_user_id === u.id;
    return { ...u, is_lead: isLead, default_selected: team.lead_user_id == null || isLead };
  });
}

export async function readGapThreshold(db: D1Database): Promise<number> {
  const row = await db
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .bind(GAP_THRESHOLD_SETTING_KEY)
    .first<{ value: string }>();
  return row ? parseThresholdPct(row.value) : DEFAULT_GAP_THRESHOLD_PCT;
}

/* ------------------------------------------------------------------ */
/*  Payload                                                            */
/* ------------------------------------------------------------------ */

export interface ProductivityMember {
  user_id: number;
  full_name: string;
  username: string;
  role: string;
  position: string | null;
  employee_id: string | null;
  profile_image: string | null;
  is_lead: boolean;
  /** Хугацааны бүтээмж (бүх эх сурвалж). */
  points: number;
  repair_points: number;
  non_project_points: number;
  /** Ажиллах ёстой өдөр (ажлын өдөр − чөлөө, орсон өдрөөс). */
  work_days: number;
  leave_days: number;
  /** Ажиллах ёстой өдрүүдээс: ирсэн / ажил бүртгэсэн / бүтээмж нэмсэн. */
  present_days: number;
  logged_days: number;
  earned_days: number;
  /** Өдрийн дундаж; ажиллах ёстой өдөргүй бол null. */
  avg: number | null;
  prev_avg: number | null;
  rank: number | null;
  pct_of_top: number | null;
  below_line: boolean;
  need_per_day: number | null;
  /** Хөндсөн ЖИНХЭНЭ төсөл (ирцийн сонголт, таскийн тайлан, төсөл дээрх засварын цаг). */
  project_count: number;
  /** Хөндсөн засварын (дотоод ажлын) төсөл — `repair_projects`, төсөл БИШ. */
  repair_count: number;
  asr_count: number;
  /** Сүүлийн хугацаануудын өдрийн дундаж (хуучнаас шинэ), `history`-тэй ижил урттай. */
  series: (number | null)[];
}

export interface ProductivityProject {
  /** Жинхэнэ төсөлд `projects.id`; засварын төсөлд `-repair_projects.id`
   *  (Багууд хуудасны `/teams/allocation`-тэй ижил — хоёр id-ийн орон зай давхцдаг). */
  project_id: number;
  kind: 'project' | 'repair';
  name: string;
  status: string | null;
  category: string | null;
  people: number;
  person_days: number;
  member_ids: number[];
}

export interface ProductivityAsr {
  id: number;
  doc_no: string | null;
  report_date: string;
  project_id: number;
  project_name: string;
  author_id: number;
  author_name: string;
  status: string;
  /** «Хяналтаар явсан» багуудад энэ баг сонгогдсон. */
  team_included: boolean;
  /** Зохиогч нь энэ багийн гишүүн. */
  by_member: boolean;
}

export interface ProductivityHistoryPoint {
  from: string;
  to: string;
  /** Мужид ажлын өдөр байгаа эсэх (амралтын өдөр/баяр — цэггүй). */
  working: boolean;
  team_avg: number | null;
  top_avg: number | null;
  bottom_avg: number | null;
  gap_pct: number | null;
  exceeded: boolean;
  compared: number;
}

export interface ProductivityWarning {
  id: number;
  created_at: string;
  period_kind: PeriodKind;
  period_from: string;
  period_to: string;
  gap_pct: number | null;
  threshold_pct: number;
  note: string | null;
  sent_by: number;
  sent_by_name: string | null;
  recipients: Array<{ id: number; full_name: string }>;
  below: Array<{ user_id: number; full_name: string; avg: number | null }>;
}

export interface ProductivitySummary {
  members: number;
  /** Үндсэн баг нь энэ боловч бүтээмжийн жагсаалтад ордоггүй (admin, туслах). */
  other_members: number;
  expected_person_days: number;
  leave_person_days: number;
  present_person_days: number;
  logged_person_days: number;
  earned_person_days: number;
  present_rate: number | null;
  logged_rate: number | null;
  earned_rate: number | null;
  /** Тухайн хугацаанд ажиллах ёстой өдөртэй хүн (өдөр харахад «X/Y»-ийн Y). */
  people_expected: number;
  people_present: number;
  people_logged: number;
  people_earned: number;
  people_on_projects: number;
  project_count: number;
  /** Засварын (дотоод ажлын) төсөл дээр ажилласан хүн / төслийн тоо. */
  people_on_repair: number;
  repair_project_count: number;
  people_asr: number;
  asr_team_visits: number;
  team_points: number;
  /** Σ бүтээмж ÷ Σ ажиллах ёстой өдөр — нэг хүний өдрийн дундаж. */
  team_avg: number | null;
  prev_team_avg: number | null;
}

export interface TeamProductivityPayload {
  team: TeamInfo;
  viewer: { can_warn: boolean; is_lead: boolean };
  period: ResolvedPeriod;
  threshold_pct: number;
  summary: ProductivitySummary;
  gap: GapResult;
  members: ProductivityMember[];
  projects: ProductivityProject[];
  asr: ProductivityAsr[];
  history: ProductivityHistoryPoint[];
  warnings: ProductivityWarning[];
  warning_candidates: WarningCandidate[];
}

/* ------------------------------------------------------------------ */
/*  Ачаалагч                                                           */
/* ------------------------------------------------------------------ */

interface MemberRow {
  id: number;
  full_name: string;
  username: string;
  role: string;
  position: string | null;
  employee_id: string | null;
  profile_image: string | null;
  joined: string | null;
  is_support: number;
}

type DateSet = Map<number, Set<string>>;

function addTo(map: DateSet, userId: number, date: string) {
  let s = map.get(userId);
  if (!s) map.set(userId, (s = new Set()));
  s.add(date);
}

function countIn(set: Set<string> | undefined, dates: readonly string[]): number {
  if (!set) return 0;
  let n = 0;
  for (const d of dates) if (set.has(d)) n += 1;
  return n;
}

/** Гишүүдийн мөр — дараагийн уншилтууд тэдний id-аар хязгаарлагдана. */
async function loadMembers(db: D1Database, teamId: number, offsetMod: string): Promise<MemberRow[]> {
  const { results } = await db
    .prepare(
      `SELECT u.id, u.full_name, u.username, u.role, u.position, u.employee_id, u.profile_image,
              date(u.created_at, ?) AS joined, u.is_support
         FROM user_teams ut
         JOIN users u ON u.id = ut.user_id
        WHERE ut.team_id = ? AND ut.is_primary = 1 AND u.status = 'active'
        ORDER BY u.full_name`,
    )
    .bind(offsetMod, teamId)
    .all<MemberRow>();
  return results ?? [];
}

/** Анхааруулгын түүх.  Миграц хараахан тавигдаагүй бол (worker түрүүлж deploy) хоосон. */
export async function loadWarnings(db: D1Database, teamId: number, limit = 20): Promise<ProductivityWarning[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT w.id, w.created_at, w.period_kind, w.period_from, w.period_to, w.gap_pct, w.threshold_pct,
                w.note, w.sent_by, u.full_name AS sent_by_name, w.recipients_json, w.below_json
           FROM team_productivity_warnings w
           LEFT JOIN users u ON u.id = w.sent_by
          WHERE w.team_id = ?
          ORDER BY w.created_at DESC, w.id DESC
          LIMIT ?`,
      )
      .bind(teamId, limit)
      .all<{
        id: number;
        created_at: string;
        period_kind: PeriodKind;
        period_from: string;
        period_to: string;
        gap_pct: number | null;
        threshold_pct: number;
        note: string | null;
        sent_by: number;
        sent_by_name: string | null;
        recipients_json: string | null;
        below_json: string | null;
      }>();
    return (results ?? []).map((r) => ({
      id: r.id,
      created_at: r.created_at,
      period_kind: r.period_kind,
      period_from: r.period_from,
      period_to: r.period_to,
      gap_pct: r.gap_pct,
      threshold_pct: r.threshold_pct,
      note: r.note,
      sent_by: r.sent_by,
      sent_by_name: r.sent_by_name,
      recipients: parseJsonArray(r.recipients_json),
      below: parseJsonArray(r.below_json),
    }));
  } catch (err) {
    console.error('[team-productivity] warnings read failed', err);
    return [];
  }
}

function parseJsonArray<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

const EMPTY_SUMMARY: ProductivitySummary = {
  members: 0,
  other_members: 0,
  expected_person_days: 0,
  leave_person_days: 0,
  present_person_days: 0,
  logged_person_days: 0,
  earned_person_days: 0,
  present_rate: null,
  logged_rate: null,
  earned_rate: null,
  people_expected: 0,
  people_present: 0,
  people_logged: 0,
  people_earned: 0,
  people_on_projects: 0,
  project_count: 0,
  people_on_repair: 0,
  repair_project_count: 0,
  people_asr: 0,
  asr_team_visits: 0,
  team_points: 0,
  team_avg: null,
  prev_team_avg: null,
};

/**
 * Нэг багийн нэг хугацааны бүх тоо.  `access` — `loadTeamAccess`-ийн үр дүн
 * (дуудагч эрхийг аль хэдийн шалгасан).
 */
export async function loadTeamProductivity(
  db: D1Database,
  access: TeamAccess,
  period: ResolvedPeriod,
): Promise<TeamProductivityPayload> {
  const team = access.team;
  const offset = orgUtcOffsetMinutes(new Date(`${period.until}T12:00:00Z`));
  const offsetMod = sqliteOffsetModifier(offset);

  const [allMembers, includeCeo, threshold, warnings, candidates] = await Promise.all([
    loadMembers(db, team.id, offsetMod),
    getCeoOnLeaderboard(db),
    readGapThreshold(db),
    loadWarnings(db, team.id),
    access.can_warn ? warningCandidates(db, team) : Promise.resolve<WarningCandidate[]>([]),
  ]);
  const members = allMembers.filter(
    (m) => m.is_support === 0 && isLeaderboardEligibleUser(m.role, m.id, includeCeo),
  );
  const history = historyRanges(period, HISTORY_COUNT[period.kind]);
  const cur: DateRange = { from: period.from, to: period.until };
  const base = {
    team,
    viewer: { can_warn: access.can_warn, is_lead: access.is_lead },
    period,
    threshold_pct: threshold,
    warnings,
    warning_candidates: candidates,
  };
  if (members.length === 0) {
    return {
      ...base,
      summary: { ...EMPTY_SUMMARY, other_members: allMembers.length },
      gap: computeGap([], threshold),
      members: [],
      projects: [],
      asr: [],
      history: history.map((r) => ({
        from: r.from,
        to: r.to,
        working: false,
        team_avg: null,
        top_avg: null,
        bottom_avg: null,
        gap_pct: null,
        exceeded: false,
        compared: 0,
      })),
    };
  }

  // Бүх id нь D1-ээс ирсэн бүхэл тоо — IN жагсаалтад шууд (100 bind-ийн таазаас зайлсхийнэ).
  const ids = members.map((m) => Math.trunc(m.id)).join(',');
  const spanFrom = history[0]!.from;
  const bounds = ubDayBoundsUtc(spanFrom, period.until, offset);

  const [pointsRes, leaveRes, holidays, attRes, progRes, repairRes, npRes, pickRes, repairPickRes, asrRes] = await Promise.all([
    db
      .prepare(
        `SELECT user_id, date(awarded_at, ?) AS day, SUM(amount) AS pts,
                SUM(CASE WHEN source = 'repair' THEN amount ELSE 0 END) AS repair_pts,
                SUM(CASE WHEN source = 'non_project' THEN amount ELSE 0 END) AS np_pts
           FROM user_points
          WHERE user_id IN (${ids}) AND awarded_at >= ? AND awarded_at < ?
          GROUP BY user_id, day`,
      )
      .bind(offsetMod, bounds.startUtc, bounds.endUtcExclusive)
      .all<{ user_id: number; day: string; pts: number; repair_pts: number; np_pts: number }>(),
    db.prepare(APPROVED_LEAVE_OVERLAP_SQL).bind(period.until, spanFrom).all<ApprovedLeaveRow>(),
    getHolidaySet(db, spanFrom, period.until),
    db
      .prepare(
        `SELECT DISTINCT user_id, date FROM attendance_sessions
          WHERE user_id IN (${ids}) AND date >= ? AND date <= ?`,
      )
      .bind(cur.from, cur.to)
      .all<{ user_id: number; date: string }>(),
    // Бодит ажлын мөр л (baseline / амралт / «маргааш» биш — leaderboard.ts REAL_WORK_ROW).
    db
      .prepare(
        `SELECT DISTINCT pe.user_id, pe.date, b.project_id
           FROM progress_entries pe
           LEFT JOIN tasks t ON t.id = pe.task_id
           LEFT JOIN components cmp ON cmp.id = t.component_id
           LEFT JOIN drawings d ON d.id = cmp.drawing_id
           LEFT JOIN blocks b ON b.id = d.block_id
          WHERE pe.user_id IN (${ids}) AND pe.date >= ? AND pe.date <= ?
            AND pe.status = 'approved' AND pe.is_baseline = 0 AND pe.is_rest_day = 0 AND pe.defer_next_day = 0
            AND COALESCE(pe.source, '') <> 'alloc_adj'`,
      )
      .bind(cur.from, cur.to)
      .all<{ user_id: number; date: string; project_id: number | null }>(),
    db
      .prepare(
        `SELECT user_id, date, project_id, repair_project_id FROM repair_entries
          WHERE user_id IN (${ids}) AND date >= ? AND date <= ?`,
      )
      .bind(cur.from, cur.to)
      .all<{ user_id: number; date: string; project_id: number | null; repair_project_id: number | null }>(),
    db
      .prepare(
        `SELECT DISTINCT user_id, date FROM non_project_work_entries
          WHERE user_id IN (${ids}) AND date >= ? AND date <= ? AND status <> 'rejected'`,
      )
      .bind(cur.from, cur.to)
      .all<{ user_id: number; date: string }>(),
    db
      .prepare(
        `SELECT DISTINCT user_id, date, project_id FROM daily_active_projects
          WHERE user_id IN (${ids}) AND date >= ? AND date <= ?`,
      )
      .bind(cur.from, cur.to)
      .all<{ user_id: number; date: string; project_id: number }>(),
    // Ирцэд сонгосон засварын төсөл (0324) — Багууд хуудасны «Өнөөдөр»-тэй ижил.
    db
      .prepare(
        `SELECT DISTINCT user_id, date, repair_project_id FROM daily_active_repairs
          WHERE user_id IN (${ids}) AND date >= ? AND date <= ?`,
      )
      .bind(cur.from, cur.to)
      .all<{ user_id: number; date: string; repair_project_id: number }>(),
    db
      .prepare(
        `SELECT r.id, r.doc_no, r.report_date, r.project_id, p.name AS project_name,
                r.author_id, au.full_name AS author_name, r.status,
                EXISTS (SELECT 1 FROM author_supervision_report_teams rt
                         WHERE rt.report_id = r.id AND rt.team_id = ?) AS team_included
           FROM author_supervision_reports r
           JOIN projects p ON p.id = r.project_id
           LEFT JOIN users au ON au.id = r.author_id
          WHERE ${ASR_COUNTED_SQL} AND r.report_date >= ? AND r.report_date <= ?
            AND (r.author_id IN (${ids})
                 OR EXISTS (SELECT 1 FROM asr_report_companions c
                             WHERE c.report_id = r.id AND c.user_id IN (${ids}))
                 OR EXISTS (SELECT 1 FROM author_supervision_report_teams rt2
                             WHERE rt2.report_id = r.id AND rt2.team_id = ?))
          ORDER BY r.report_date DESC, r.id DESC`,
      )
      .bind(team.id, cur.from, cur.to, team.id)
      .all<{
        id: number;
        doc_no: string | null;
        report_date: string;
        project_id: number;
        project_name: string;
        author_id: number;
        author_name: string | null;
        status: string;
        team_included: number;
      }>(),
  ]);

  // ── Өдрийн оноо ───────────────────────────────────────────────────
  const dailyPts = new Map<number, Map<string, number>>();
  const repairPts = new Map<number, number>();
  const npPts = new Map<number, number>();
  for (const r of pointsRes.results ?? []) {
    let m = dailyPts.get(r.user_id);
    if (!m) dailyPts.set(r.user_id, (m = new Map()));
    m.set(r.day, (m.get(r.day) ?? 0) + (r.pts ?? 0));
    if (r.day >= cur.from && r.day <= cur.to) {
      repairPts.set(r.user_id, (repairPts.get(r.user_id) ?? 0) + (r.repair_pts ?? 0));
      npPts.set(r.user_id, (npPts.get(r.user_id) ?? 0) + (r.np_pts ?? 0));
    }
  }
  const memberIds = new Set(members.map((m) => m.id));
  const leave = leaveDatesByUser(
    (leaveRes.results ?? []).filter((l) => memberIds.has(l.user_id)),
    { from: spanFrom, to: period.until },
    holidays,
  );
  const daily = (m: MemberRow): MemberDaily => ({ joined: m.joined, points: dailyPts.get(m.id), leave: leave.get(m.id) });

  // ── Түүх: хугацаа бүрийн гишүүдийн дундаж → зөрүү ─────────────────
  const seriesByUser = new Map<number, (number | null)[]>();
  const historyOut: ProductivityHistoryPoint[] = history.map((r) => {
    let sumPts = 0;
    let sumDays = 0;
    const rows = members.map((m) => {
      const a = memberAverage(daily(m), r, holidays);
      let s = seriesByUser.get(m.id);
      if (!s) seriesByUser.set(m.id, (s = []));
      s.push(a.avg == null ? null : round4(a.avg));
      if (a.avg != null) {
        sumPts += a.points;
        sumDays += a.work_days;
      }
      return { user_id: m.id, avg: a.avg };
    });
    const g = computeGap(rows, threshold);
    return {
      from: r.from,
      to: r.to,
      working: hasWorkingDay(r, holidays),
      team_avg: sumDays > 0 ? round4(sumPts / sumDays) : null,
      top_avg: g.top_avg == null ? null : round4(g.top_avg),
      bottom_avg: g.bottom_avg == null ? null : round4(g.bottom_avg),
      gap_pct: g.gap_pct,
      exceeded: g.exceeded,
      compared: g.compared,
    };
  });

  // ── Одоогийн хугацааны үйл явдлын огноонууд ───────────────────────
  const present: DateSet = new Map();
  for (const a of attRes.results ?? []) addTo(present, a.user_id, a.date);
  const logged: DateSet = new Map();
  const projectDays = new Map<number, Map<number, Set<string>>>(); // project → user → dates
  const touch = (projectId: number | null, userId: number, date: string) => {
    if (projectId == null) return;
    let byUser = projectDays.get(projectId);
    if (!byUser) projectDays.set(projectId, (byUser = new Map()));
    let s = byUser.get(userId);
    if (!s) byUser.set(userId, (s = new Set()));
    s.add(date);
  };
  for (const p of progRes.results ?? []) {
    addTo(logged, p.user_id, p.date);
    touch(p.project_id, p.user_id, p.date);
  }
  for (const r of repairRes.results ?? []) {
    addTo(logged, r.user_id, r.date);
    // Засварын бүртгэл яг НЭГ эзэнтэй (0194-ийн CHECK): жинхэнэ төсөл эсвэл засварын төсөл.
    touch(r.project_id ?? (r.repair_project_id != null ? -r.repair_project_id : null), r.user_id, r.date);
  }
  for (const n of npRes.results ?? []) addTo(logged, n.user_id, n.date);
  for (const k of pickRes.results ?? []) touch(k.project_id, k.user_id, k.date);
  for (const k of repairPickRes.results ?? []) touch(-k.repair_project_id, k.user_id, k.date);

  // ── Гишүүд ────────────────────────────────────────────────────────
  const gapRows: { user_id: number; avg: number | null }[] = [];
  const perMember = members.map((m) => {
    const d = daily(m);
    const a = memberAverage(d, cur, holidays);
    const { dates } = memberWorkDates(d, cur, holidays);
    const earned = new Set([...(d.points ?? new Map()).entries()].filter(([, v]) => v > 0).map(([day]) => day));
    gapRows.push({ user_id: m.id, avg: a.avg });
    let projectCount = 0;
    let repairCount = 0;
    for (const [pid, byUser] of projectDays) {
      if (!byUser.has(m.id)) continue;
      if (pid > 0) projectCount += 1;
      else repairCount += 1;
    }
    return { m, a, dates, earned, projectCount, repairCount };
  });
  const gap = computeGap(gapRows, threshold);
  const ranked = [...gapRows].filter((r) => r.avg != null).sort((x, y) => (y.avg ?? 0) - (x.avg ?? 0) || x.user_id - y.user_id);
  const rankOf = new Map<number, number>();
  ranked.forEach((r, i) => rankOf.set(r.user_id, i + 1));

  const asrRows = (asrRes.results ?? []).map<ProductivityAsr>((r) => ({
    id: r.id,
    doc_no: r.doc_no,
    report_date: r.report_date,
    project_id: r.project_id,
    project_name: r.project_name,
    author_id: r.author_id,
    author_name: r.author_name ?? '',
    status: r.status,
    team_included: r.team_included === 1,
    by_member: memberIds.has(r.author_id),
  }));
  const asrByAuthor = new Map<number, number>();
  for (const r of asrRows) if (r.by_member) asrByAuthor.set(r.author_id, (asrByAuthor.get(r.author_id) ?? 0) + 1);
  const asrIdList = (asrRes.results ?? []).map((r) => Math.trunc(r.id)).join(',');
  if (asrIdList) {
    const comp = await db
      .prepare(
        `SELECT report_id, user_id FROM asr_report_companions
          WHERE report_id IN (${asrIdList}) AND user_id IN (${ids})`,
      )
      .all<{ report_id: number; user_id: number }>();
    const authorOf = new Map((asrRes.results ?? []).map((r) => [r.id, r.author_id]));
    for (const c of comp.results ?? []) {
      if (c.user_id === authorOf.get(c.report_id) || !memberIds.has(c.user_id)) continue;
      asrByAuthor.set(c.user_id, (asrByAuthor.get(c.user_id) ?? 0) + 1);
    }
  }

  // Харьцуулах «өмнөх» хугацаа — өдрөөр харахад өмнөх АЖЛЫН өдөр (Даваа гарагт
  // Ням биш Баасан), бусад үед шууд өмнөх 7 хоног / сар.
  let prevIdx = historyOut.length - 2;
  if (period.kind === 'day') while (prevIdx >= 0 && !historyOut[prevIdx]?.working) prevIdx -= 1;
  const membersOut: ProductivityMember[] = perMember.map(({ m, a, dates, earned, projectCount, repairCount }) => {
    const series = seriesByUser.get(m.id) ?? [];
    return {
      user_id: m.id,
      full_name: m.full_name,
      username: m.username,
      role: m.role,
      position: m.position,
      employee_id: m.employee_id,
      profile_image: m.profile_image,
      is_lead: team.lead_user_id === m.id,
      points: round4(a.points),
      repair_points: round4(repairPts.get(m.id) ?? 0),
      non_project_points: round4(npPts.get(m.id) ?? 0),
      work_days: a.work_days,
      leave_days: a.leave_days,
      present_days: countIn(present.get(m.id), dates),
      logged_days: countIn(logged.get(m.id), dates),
      earned_days: countIn(earned, dates),
      avg: a.avg == null ? null : round4(a.avg),
      prev_avg: prevIdx >= 0 ? (series[prevIdx] ?? null) : null,
      rank: rankOf.get(m.id) ?? null,
      pct_of_top: (() => {
        const v = pctOfTop(a.avg, gap.top_avg);
        return v == null ? null : round1(v);
      })(),
      below_line: a.avg != null && gap.line != null && gap.compared >= 2 && a.avg < gap.line,
      need_per_day: (() => {
        if (gap.compared < 2) return null;
        const v = neededPerDay(a.avg, gap.line);
        return v == null ? null : round4(v);
      })(),
      project_count: projectCount,
      repair_count: repairCount,
      asr_count: asrByAuthor.get(m.id) ?? 0,
      series,
    };
  });
  // Дэлгэцийн дараалал = байр (тэнцсэн үед ч `rank`-тай ижил); дундажгүй нь сүүлд.
  membersOut.sort(
    (x, y) => (x.rank ?? Number.MAX_SAFE_INTEGER) - (y.rank ?? Number.MAX_SAFE_INTEGER) || x.full_name.localeCompare(y.full_name),
  );

  // ── Төслүүд (жинхэнэ + засварын) ─────────────────────────────────
  const realIds = [...projectDays.keys()].filter((id) => id > 0).map((n) => Math.trunc(n));
  const repairIds = [...projectDays.keys()].filter((id) => id < 0).map((n) => Math.trunc(-n));
  const names = new Map<number, { name: string; status: string | null; category: string | null }>();
  const [realRes, repairNameRes] = await Promise.all([
    realIds.length > 0
      ? db
          .prepare(`SELECT id, name, status, category FROM projects WHERE id IN (${realIds.join(',')})`)
          .all<{ id: number; name: string; status: string | null; category: string | null }>()
      : Promise.resolve({ results: [] as { id: number; name: string; status: string | null; category: string | null }[] }),
    repairIds.length > 0
      ? db
          .prepare(`SELECT id, name, status FROM repair_projects WHERE id IN (${repairIds.join(',')})`)
          .all<{ id: number; name: string; status: string | null }>()
      : Promise.resolve({ results: [] as { id: number; name: string; status: string | null }[] }),
  ]);
  for (const p of realRes.results ?? []) names.set(p.id, p);
  for (const p of repairNameRes.results ?? []) names.set(-p.id, { name: p.name, status: p.status, category: null });
  const projects: ProductivityProject[] = [...projectDays.keys()]
    .filter((id) => names.has(id))
    .map((id) => {
      const byUser = projectDays.get(id)!;
      let personDays = 0;
      for (const s of byUser.values()) personDays += s.size;
      const p = names.get(id)!;
      return {
        project_id: id,
        kind: id > 0 ? ('project' as const) : ('repair' as const),
        name: p.name,
        status: p.status,
        category: p.category,
        people: byUser.size,
        person_days: personDays,
        member_ids: [...byUser.keys()],
      };
    })
    .sort(
      (a, b) =>
        (a.kind === 'repair' ? 1 : 0) - (b.kind === 'repair' ? 1 : 0) ||
        b.people - a.people ||
        b.person_days - a.person_days ||
        a.name.localeCompare(b.name),
    );

  // ── Нэгтгэл ───────────────────────────────────────────────────────
  let expected = 0;
  let leaveDays = 0;
  let presentDays = 0;
  let loggedDays = 0;
  let earnedDays = 0;
  let teamPts = 0;
  let avgDays = 0;
  let avgPts = 0;
  for (const x of membersOut) {
    expected += x.work_days;
    leaveDays += x.leave_days;
    presentDays += x.present_days;
    loggedDays += x.logged_days;
    earnedDays += x.earned_days;
    teamPts += x.points;
    if (x.avg != null) {
      avgPts += x.points;
      avgDays += x.work_days;
    }
  }
  const onProjects = new Set<number>();
  const onRepair = new Set<number>();
  for (const [pid, byUser] of projectDays) for (const u of byUser.keys()) (pid > 0 ? onProjects : onRepair).add(u);
  const summary: ProductivitySummary = {
    members: members.length,
    other_members: allMembers.length - members.length,
    expected_person_days: expected,
    leave_person_days: leaveDays,
    present_person_days: presentDays,
    logged_person_days: loggedDays,
    earned_person_days: earnedDays,
    present_rate: ratePct(presentDays, expected),
    logged_rate: ratePct(loggedDays, expected),
    earned_rate: ratePct(earnedDays, expected),
    people_expected: membersOut.filter((x) => x.work_days > 0).length,
    people_present: membersOut.filter((x) => x.present_days > 0).length,
    people_logged: membersOut.filter((x) => x.logged_days > 0).length,
    people_earned: membersOut.filter((x) => x.earned_days > 0).length,
    people_on_projects: onProjects.size,
    project_count: projects.filter((p) => p.kind === 'project').length,
    people_on_repair: onRepair.size,
    repair_project_count: projects.filter((p) => p.kind === 'repair').length,
    people_asr: asrByAuthor.size,
    asr_team_visits: asrRows.filter((r) => r.team_included).length,
    team_points: round4(teamPts),
    team_avg: avgDays > 0 ? round4(avgPts / avgDays) : null,
    prev_team_avg: prevIdx >= 0 ? (historyOut[prevIdx]?.team_avg ?? null) : null,
  };

  return {
    ...base,
    summary,
    gap: {
      ...gap,
      top_avg: gap.top_avg == null ? null : round4(gap.top_avg),
      bottom_avg: gap.bottom_avg == null ? null : round4(gap.bottom_avg),
      line: gap.line == null ? null : round4(gap.line),
    },
    members: membersOut,
    projects,
    asr: asrRows,
    history: historyOut,
  };
}
