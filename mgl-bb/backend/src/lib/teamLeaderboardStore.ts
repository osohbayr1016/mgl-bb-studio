/**
 * Багуудын эрэмбийн D1 уншилт (2026-09-25).  Дүрэм нь `teamLeaderboard.ts`
 * (цэвэр) ба `teamProductivity.ts` — багийн профайлын «Бүтээмж» табтай ИЖИЛ
 * тоо гарна (гишүүн = үндсэн баг, идэвхтэй, `is_support = 0`, самбарт ордог роль).
 *
 * Бүх баг НЭГ удаад: 5 асуулга (баг, гишүүд, оноо, чөлөө, баяр) — баг тутамд
 * дуудлага хийхгүй.  Түүх 6 хугацаа (sparkline) — сараар харахад ~6 сарын
 * `user_points` (user, day)-аар бүлэглэгдэж ирнэ.
 */
import { getHolidaySet } from './holidays';
import { orgUtcOffsetMinutes, sqliteOffsetModifier, ubDayBoundsUtc } from './reportWindows';
import { getCeoOnLeaderboard, isLeaderboardEligibleUser } from './ceo';
import { APPROVED_LEAVE_OVERLAP_SQL, leaveDatesByUser, type ApprovedLeaveRow } from './leaveAvailability';
import { hasWorkingDay, historyRanges, round4, type ResolvedPeriod } from './teamProductivity';
import { readGapThreshold } from './teamProductivityStore';
import { changePct, rankTeams, summarizeTeam, type TeamSummary } from './teamLeaderboard';

export const LEADERBOARD_HISTORY = 6;

export interface LeaderboardTeam extends TeamSummary {
  id: number;
  code: string;
  name_mn: string;
  name_en: string | null;
  lead_name: string | null;
  top_name: string | null;
  /** Бүх багийн нийт хувьд эзлэх хувь. */
  share_pct: number | null;
  rank: number | null;
}

export interface TeamsLeaderboardPayload {
  period: ResolvedPeriod;
  threshold_pct: number;
  ranges: Array<{ from: string; to: string }>;
  summary: {
    team_count: number;
    /** Гишүүнтэй (эрэмбэд орсон) баг. */
    ranked_count: number;
    members: number;
    total_points: number;
    /** Компанийн дундаж = Σ оноо ÷ Σ хүн-өдөр (багийн дундажтай ижил тодорхойлолт). */
    company_avg: number | null;
    prev_company_avg: number | null;
    change_pct: number | null;
    /** Багуудын дундажийн энгийн дундаж (баг бүр нэг жинтэй). */
    mean_team_avg: number | null;
    gap_exceeded_count: number;
  };
  teams: LeaderboardTeam[];
}

interface MemberRow {
  id: number;
  full_name: string;
  role: string;
  team_id: number;
  joined: string | null;
  is_support: number;
}

export async function loadTeamsLeaderboard(db: D1Database, period: ResolvedPeriod): Promise<TeamsLeaderboardPayload> {
  const offset = orgUtcOffsetMinutes(new Date(`${period.until}T12:00:00Z`));
  const offsetMod = sqliteOffsetModifier(offset);
  const history = historyRanges(period, LEADERBOARD_HISTORY);
  const spanFrom = history[0]!.from;

  const [teamsRes, membersRes, includeCeo, threshold, holidays, leaveRes] = await Promise.all([
    db
      .prepare(
        `SELECT t.id, t.code, t.name_mn, t.name_en,
                CASE WHEN lu.status = 'active' AND lu.role = 'senior' THEN lu.full_name END AS lead_name
           FROM teams t
           LEFT JOIN users lu ON lu.id = t.lead_user_id
          ORDER BY t.code`,
      )
      .all<{ id: number; code: string; name_mn: string; name_en: string | null; lead_name: string | null }>(),
    db
      .prepare(
        `SELECT u.id, u.full_name, u.role, ut.team_id, date(u.created_at, ?) AS joined, u.is_support
           FROM user_teams ut
           JOIN users u ON u.id = ut.user_id
          WHERE ut.is_primary = 1 AND u.status = 'active'`,
      )
      .bind(offsetMod)
      .all<MemberRow>(),
    getCeoOnLeaderboard(db),
    readGapThreshold(db),
    getHolidaySet(db, spanFrom, period.until),
    db.prepare(APPROVED_LEAVE_OVERLAP_SQL).bind(period.until, spanFrom).all<ApprovedLeaveRow>(),
  ]);

  const members = (membersRes.results ?? []).filter(
    (m) => m.is_support === 0 && isLeaderboardEligibleUser(m.role, m.id, includeCeo),
  );
  const nameOf = new Map(members.map((m) => [m.id, m.full_name]));
  const dailyPts = new Map<number, Map<string, number>>();
  if (members.length > 0) {
    // id-ууд D1-ээс ирсэн бүхэл тоо — IN жагсаалтад шууд (100 bind-ийн тааз).
    const ids = members.map((m) => Math.trunc(m.id)).join(',');
    const bounds = ubDayBoundsUtc(spanFrom, period.until, offset);
    const { results } = await db
      .prepare(
        `SELECT user_id, date(awarded_at, ?) AS day, SUM(amount) AS pts
           FROM user_points
          WHERE user_id IN (${ids}) AND awarded_at >= ? AND awarded_at < ?
          GROUP BY user_id, day`,
      )
      .bind(offsetMod, bounds.startUtc, bounds.endUtcExclusive)
      .all<{ user_id: number; day: string; pts: number }>();
    for (const r of results ?? []) {
      let m = dailyPts.get(r.user_id);
      if (!m) dailyPts.set(r.user_id, (m = new Map()));
      m.set(r.day, (m.get(r.day) ?? 0) + (r.pts ?? 0));
    }
  }
  const memberIds = new Set(members.map((m) => m.id));
  const leave = leaveDatesByUser(
    (leaveRes.results ?? []).filter((l) => memberIds.has(l.user_id)),
    { from: spanFrom, to: period.until },
    holidays,
  );

  // «Өмнөх» — өдрөөр харахад өмнөх АЖЛЫН өдөр (Бүтээмж табтай ижил).
  let prevIndex: number | null = history.length - 2;
  if (period.kind === 'day') while (prevIndex >= 0 && !hasWorkingDay(history[prevIndex]!, holidays)) prevIndex -= 1;
  if (prevIndex < 0) prevIndex = null;

  const byTeam = new Map<number, MemberRow[]>();
  for (const m of members) {
    const arr = byTeam.get(m.team_id) ?? [];
    arr.push(m);
    byTeam.set(m.team_id, arr);
  }

  let totalPts = 0;
  let totalAvgPts = 0;
  let totalDays = 0;
  const rows = (teamsRes.results ?? []).map((t) => {
    const s = summarizeTeam({
      members: (byTeam.get(t.id) ?? []).map((m) => ({
        user_id: m.id,
        daily: { joined: m.joined, points: dailyPts.get(m.id), leave: leave.get(m.id) },
      })),
      ranges: history,
      prevIndex,
      holidays,
      thresholdPct: threshold,
    });
    totalPts += s.team_points;
    totalAvgPts += s.avg_points;
    totalDays += s.person_days;
    return {
      ...s,
      id: t.id,
      code: t.code,
      name_mn: t.name_mn,
      name_en: t.name_en,
      lead_name: t.lead_name,
      top_name: s.top_user_id != null ? (nameOf.get(s.top_user_id) ?? null) : null,
      share_pct: null as number | null,
    };
  });
  for (const r of rows) r.share_pct = totalPts > 0 ? Math.round((r.team_points / totalPts) * 1000) / 10 : null;

  // Компанийн өмнөх дундаж — бүх гишүүнийг нэг «баг» болгож өмнөх хугацаагаар.
  const prevCompany =
    prevIndex == null
      ? null
      : summarizeTeam({
          members: members.map((m) => ({
            user_id: m.id,
            daily: { joined: m.joined, points: dailyPts.get(m.id), leave: leave.get(m.id) },
          })),
          ranges: [history[prevIndex]!],
          prevIndex: null,
          holidays,
          thresholdPct: threshold,
        }).team_avg;

  const ranked = rankTeams(rows);
  const withAvg = ranked.filter((r) => r.team_avg != null);
  const companyAvg = totalDays > 0 ? round4(totalAvgPts / totalDays) : null;
  return {
    period,
    threshold_pct: threshold,
    ranges: history.map((r) => ({ from: r.from, to: r.to })),
    summary: {
      team_count: rows.length,
      ranked_count: withAvg.length,
      members: members.length,
      total_points: round4(totalPts),
      company_avg: companyAvg,
      prev_company_avg: prevCompany,
      change_pct: changePct(companyAvg, prevCompany),
      mean_team_avg:
        withAvg.length > 0 ? round4(withAvg.reduce((s, r) => s + (r.team_avg ?? 0), 0) / withAvg.length) : null,
      gap_exceeded_count: rows.filter((r) => r.gap_exceeded).length,
    },
    teams: ranked,
  };
}
