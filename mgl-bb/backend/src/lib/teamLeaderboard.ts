/**
 * Багуудын эрэмбэ — Багууд хуудасны «Эрэмбэ» таб (2026-09-25).  ЦЭВЭР функцүүд
 * (D1-гүй, тесттэй); D1 уншилт нь `teamLeaderboardStore.ts`.
 *
 * Эзний хүсэлт: хэдэн баг, бүх багийн нийт хувь, багийн дундаж, багуудыг
 * хувиар нь эрэмбэлсэн самбар; баг дээр дарвал багийн профайл.
 *
 * ── ТОДОРХОЙЛОЛТУУД (багийн профайлын «Бүтээмж» табтай ЯГ ижил) ─────────
 *  • Багийн нийт хувь = гишүүдийн хугацааны `user_points.amount`-ийн нийлбэр.
 *  • Багийн дундаж = Σ оноо ÷ Σ ажиллах ёстой хүн-өдөр (`memberAverage` —
 *    чөлөөг хасна) = `loadTeamProductivity`-ийн `summary.team_avg`.  Эрэмбэ
 *    ҮҮГЭЭР — нийлбэрээр бол том баг үргэлж түрүүлнэ.
 *  • Зөрүү = багийн дээд ↔ доод хүн (`computeGap`) — эрэмбийн тэмдэглэгээ л.
 */
import {
  computeGap,
  memberAverage,
  round1,
  round4,
  type DateRange,
  type MemberDaily,
} from './teamProductivity';

export interface TeamSummaryInput {
  members: ReadonlyArray<{ user_id: number; daily: MemberDaily }>;
  /** Түүхийн хугацаанууд хуучнаас шинэ рүү; сүүлийнх нь одоогийн хугацаа. */
  ranges: readonly DateRange[];
  /** «Өмнөх» гэж харьцуулах хугацааны индекс (`ranges` дотор), байхгүй бол null. */
  prevIndex: number | null;
  holidays: ReadonlySet<string>;
  thresholdPct: number;
}

export interface TeamSummary {
  members: number;
  /** Одоогийн хугацааны Σ оноо («багийн нийт хувь»). */
  team_points: number;
  /** Σ ажиллах ёстой хүн-өдөр — компанийн дундажийг жинлэхэд. */
  person_days: number;
  /** Дундажид орсон оноо (ажлын өдөргүй гишүүний оноо хасагдсан). */
  avg_points: number;
  team_avg: number | null;
  prev_team_avg: number | null;
  /** Өмнөх хугацаанаас хэдэн хувиар өөрчлөгдсөн (харьцангуй); тодорхойгүй бол null. */
  change_pct: number | null;
  top_user_id: number | null;
  top_avg: number | null;
  gap_pct: number | null;
  gap_exceeded: boolean;
  /** Хугацаа бүрийн багийн дундаж (`ranges`-ийн дарааллаар). */
  series: (number | null)[];
}

/**
 * `loadTeamProductivity`-ийн `summary`-тэй ЯГ ижил: нийлбэрт бүх оноо, дундажид
 * зөвхөн ажиллах ёстой өдөртэй (`avg != null`) гишүүдийн оноо ÷ хүн-өдөр.
 */
function rangeAverage(input: TeamSummaryInput, r: DateRange) {
  let pts = 0;
  let avgPts = 0;
  let days = 0;
  const rows: { user_id: number; avg: number | null }[] = [];
  for (const m of input.members) {
    const a = memberAverage(m.daily, r, input.holidays);
    rows.push({ user_id: m.user_id, avg: a.avg });
    pts += a.points;
    if (a.avg != null) {
      avgPts += a.points;
      days += a.work_days;
    }
  }
  return { pts, avgPts, days, avg: days > 0 ? avgPts / days : null, rows };
}

/** ЦЭВЭР: нэг багийн эрэмбийн мөр. */
export function summarizeTeam(input: TeamSummaryInput): TeamSummary {
  const series = input.ranges.map((r) => {
    const a = rangeAverage(input, r).avg;
    return a == null ? null : round4(a);
  });
  const cur = input.ranges[input.ranges.length - 1];
  const now = cur ? rangeAverage(input, cur) : { pts: 0, avgPts: 0, days: 0, avg: null, rows: [] };
  const prev = input.prevIndex == null ? null : (series[input.prevIndex] ?? null);
  const gap = computeGap(now.rows, input.thresholdPct);
  return {
    members: input.members.length,
    team_points: round4(now.pts),
    person_days: now.days,
    avg_points: round4(now.avgPts),
    team_avg: now.avg == null ? null : round4(now.avg),
    prev_team_avg: prev,
    change_pct: changePct(now.avg, prev),
    top_user_id: gap.top_user_id,
    top_avg: gap.top_avg == null ? null : round4(gap.top_avg),
    gap_pct: gap.gap_pct,
    gap_exceeded: gap.exceeded,
    series,
  };
}

/** Харьцангуй өөрчлөлт %; өмнөх 0/тодорхойгүй бол null. */
export function changePct(now: number | null, prev: number | null): number | null {
  if (now == null || prev == null || !(prev > 0)) return null;
  return round1(((now - prev) / prev) * 100);
}

export interface RankableTeam {
  id: number;
  code: string;
  team_avg: number | null;
  team_points: number;
}

/**
 * ЦЭВЭР: дундажаар буурах эрэмбэ.  Дундаж тодорхойгүй (гишүүнгүй / ажлын өдөргүй)
 * баг сүүлд, эрэмбэгүй (`rank: null`).  Тэнцсэн дундажид нийт хувь, дараа нь код.
 * Ижил дундаж ижил байр авна (1, 1, 3).
 */
export function rankTeams<T extends RankableTeam>(rows: readonly T[]): Array<T & { rank: number | null }> {
  const sorted = [...rows].sort((a, b) => {
    if (a.team_avg == null || b.team_avg == null) {
      if (a.team_avg == null && b.team_avg == null) return a.code.localeCompare(b.code);
      return a.team_avg == null ? 1 : -1;
    }
    return b.team_avg - a.team_avg || b.team_points - a.team_points || a.code.localeCompare(b.code);
  });
  let lastAvg: number | null = null;
  let lastRank = 0;
  return sorted.map((r, i) => {
    if (r.team_avg == null) return { ...r, rank: null };
    const rank = lastAvg != null && r.team_avg === lastAvg ? lastRank : i + 1;
    lastAvg = r.team_avg;
    lastRank = rank;
    return { ...r, rank };
  });
}
