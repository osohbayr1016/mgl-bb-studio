import type { AsrReport, AsrStatus } from '@/features/projects/asr/types';

/**
 * ЗХ-ийн төслийн самбарын НЭГТГЭЛ — «хэн хэзээ явсан», хэдэн очилт, аль баг.
 *
 * Цэвэр функцууд (`scripts/check-asr-board.mjs`).  Серверийн
 * `GET /projects/:id/visits`-ийн ЯГ ижил дүрэм, гэхдээ сонгосон ХУГАЦААНЫ
 * тайлангууд дээр (тэр endpoint хугацааны параметргүй):
 *
 *   • «Очилт» = илгээсэн / батлагдсан (`submitted|approved`) ТАЛБАЙН хяналт
 *     (0362, эзний шийдвэр 2026-09-29) — ноорог, буцаагдсан тоологдохгүй;
 *   • хүн = зохиогч + хамт явсан багийнхан (0347), нэг тайланд нэг удаа;
 *   • олон багийг хамарсан тайлан баг БҮРТ тоологдоно (нийлбэр > нийт).
 *
 * Дуудагч тайлангуудыг ХУГАЦААГААР аль хэдийн шүүсэн байна (`asrRange.ts`).
 * Энэ файл runtime импортгүй — node шууд ачаална.
 */

export type AsrBoardReport = Pick<
  AsrReport,
  | 'id'
  | 'report_date'
  | 'status'
  | 'report_type'
  | 'author_id'
  | 'author_name'
  | 'companion_ids'
  | 'companion_names'
  | 'team_codes'
>;

export type AsrOtherType = 'office' | 'drawing_change' | 'online';

const OTHER_TYPES: ReadonlySet<string> = new Set<AsrOtherType>(['office', 'drawing_change', 'online']);

/** `reportTypeOf(r) === 'site'`-ийн ихэр: танигдахгүй / хоосон төрөл = талбайн хяналт. */
export function isSiteReport(r: Pick<AsrReport, 'report_type'>): boolean {
  return !OTHER_TYPES.has(r.report_type ?? '');
}

/** Серверийн «очилт»-д тоологдох төлөв. */
export function isCountedReport(r: Pick<AsrReport, 'status'>): boolean {
  return r.status === 'submitted' || r.status === 'approved';
}

function splitIds(raw: string | null | undefined): number[] {
  return (raw ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

/** Зохиогч + хамт явсан, давхардалгүй (хамт явсан жагсаалтад зохиогч өөрөө байж болно). */
export function attendeesOf(r: Pick<AsrReport, 'author_id' | 'companion_ids'>): number[] {
  return [...new Set([r.author_id, ...splitIds(r.companion_ids)])];
}

export function teamCodesOf(r: Pick<AsrReport, 'team_codes'>): string[] {
  return [
    ...new Set(
      (r.team_codes ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

/**
 * `user_id → нэр`.  Зохиогчийн нэр мөр бүрт найдвартай ирнэ.  Хамт явсны
 * `companion_ids` / `companion_names` нь ТУСДАА хоёр `group_concat` тул
 * дараалал нь баталгаагүй — тоо нь тэнцүү үед л байрлалаар холбоно, дараа нь
 * `known` (серверийн `by_person` — id-тай нэр) бүгдийг дарна.
 */
export function buildNameMap(
  entries: readonly AsrBoardReport[],
  known: readonly { user_id: number; full_name: string }[] = [],
): Map<number, string> {
  const map = new Map<number, string>();
  for (const r of entries) {
    if (r.author_name) map.set(r.author_id, r.author_name);
  }
  for (const r of entries) {
    const ids = splitIds(r.companion_ids);
    const names = (r.companion_names ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 0 || ids.length !== names.length) continue;
    ids.forEach((id, i) => {
      if (!map.has(id)) map.set(id, names[i]!);
    });
  }
  for (const p of known) {
    if (p.full_name) map.set(p.user_id, p.full_name);
  }
  return map;
}

/* ------------------------------------------------------------------ */
/*  Товч тоо                                                          */
/* ------------------------------------------------------------------ */

export interface AsrBoardSummary {
  /** Талбайн очилт (илгээсэн + батлагдсан). */
  site: number;
  /** Бусад төрлийн (илгээсэн + батлагдсан) тайлан. */
  other: Record<AsrOtherType, number>;
  otherTotal: number;
  /** Талбайн очилтод явсан хүн (давхардалгүй). */
  people: number;
  /** Талбайн очилтын баг (давхардалгүй код). */
  teams: number;
  /** Хамгийн сүүлийн талбайн очилтын огноо. */
  lastSite: string | null;
  /** Төлөв бүрийн тайлан (бүх төрөл). */
  byStatus: Record<AsrStatus, number>;
  /** Хугацааны бүх тайлан (ноорог орно). */
  total: number;
}

export function summarize(entries: readonly AsrBoardReport[]): AsrBoardSummary {
  const other: Record<AsrOtherType, number> = { office: 0, drawing_change: 0, online: 0 };
  const byStatus: Record<AsrStatus, number> = { draft: 0, submitted: 0, approved: 0, rejected: 0 };
  const people = new Set<number>();
  const teams = new Set<string>();
  let site = 0;
  let lastSite: string | null = null;
  for (const r of entries) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    if (!isCountedReport(r)) continue;
    if (!isSiteReport(r)) {
      const tp = r.report_type as AsrOtherType;
      other[tp] += 1;
      continue;
    }
    site += 1;
    if (lastSite == null || r.report_date > lastSite) lastSite = r.report_date;
    for (const id of attendeesOf(r)) people.add(id);
    for (const c of teamCodesOf(r)) teams.add(c);
  }
  return {
    site,
    other,
    otherTotal: other.office + other.drawing_change + other.online,
    people: people.size,
    teams: teams.size,
    lastSite,
    byStatus,
    total: entries.length,
  };
}

/** Талбайн очилтын тоо (өмнөх хугацаатай харьцуулахад). */
export function countSiteVisits(entries: readonly AsrBoardReport[]): number {
  let n = 0;
  for (const r of entries) if (isCountedReport(r) && isSiteReport(r)) n += 1;
  return n;
}

/* ------------------------------------------------------------------ */
/*  «Хэн хэзээ явсан»                                                 */
/* ------------------------------------------------------------------ */

/** Нэг өдрийн тэмдэг — тэр өдөр тэр хүн (эсвэл «бүгд») хэдэн тайланд орсон. */
export interface AsrBoardMark<R extends AsrBoardReport = AsrBoardReport> {
  date: string;
  /** Тэр өдрийн ядаж нэг тайлан талбайн хяналт бол `true` (дүүрэн цэг). */
  site: boolean;
  reports: R[];
}

export interface AsrBoardPerson<R extends AsrBoardReport = AsrBoardReport> {
  userId: number;
  name: string;
  /** Талбайн очилт. */
  site: number;
  /** Бусад төрлийн тайлан. */
  other: number;
  last: string | null;
  /** Оролцсон тайлангуудын баг (давхардалгүй, анх гарсан дарааллаар). */
  teams: string[];
  marks: AsrBoardMark<R>[];
}

function marksOf<R extends AsrBoardReport>(reports: readonly R[]): AsrBoardMark<R>[] {
  const byDate = new Map<string, AsrBoardMark<R>>();
  for (const r of reports) {
    const d = r.report_date.slice(0, 10);
    const m = byDate.get(d) ?? { date: d, site: false, reports: [] };
    m.reports.push(r);
    if (isSiteReport(r)) m.site = true;
    byDate.set(d, m);
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** «Бүх очилт» мөр — тоологдох бүх тайлан огноогоор. */
export function allMarks<R extends AsrBoardReport>(entries: readonly R[]): AsrBoardMark<R>[] {
  return marksOf(entries.filter(isCountedReport));
}

/**
 * Хүн бүрийн мөр — тоологдох (илгээсэн/батлагдсан) бүх төрлийн тайлан.
 * Эрэмбэ: талбайн очилт ↓, дараа нь бүх оролцоо ↓, сүүлд явсан ↓, нэр.
 */
export function peopleOf<R extends AsrBoardReport>(
  entries: readonly R[],
  names: ReadonlyMap<number, string>,
): AsrBoardPerson<R>[] {
  const acc = new Map<number, { reports: R[]; teams: string[] }>();
  for (const r of entries) {
    if (!isCountedReport(r)) continue;
    for (const id of attendeesOf(r)) {
      const a = acc.get(id) ?? { reports: [], teams: [] };
      a.reports.push(r);
      for (const c of teamCodesOf(r)) if (!a.teams.includes(c)) a.teams.push(c);
      acc.set(id, a);
    }
  }
  const people: AsrBoardPerson<R>[] = [];
  for (const [userId, a] of acc) {
    let site = 0;
    let last: string | null = null;
    for (const r of a.reports) {
      if (isSiteReport(r)) site += 1;
      if (last == null || r.report_date > last) last = r.report_date;
    }
    people.push({
      userId,
      name: names.get(userId) ?? `#${userId}`,
      site,
      other: a.reports.length - site,
      last,
      teams: a.teams,
      marks: marksOf(a.reports),
    });
  }
  return people.sort(
    (a, b) =>
      b.site - a.site ||
      b.site + b.other - (a.site + a.other) ||
      (b.last ?? '').localeCompare(a.last ?? '') ||
      a.name.localeCompare(b.name),
  );
}

/* ------------------------------------------------------------------ */
/*  Багаар                                                            */
/* ------------------------------------------------------------------ */

export interface AsrBoardTeam {
  code: string;
  /** Талбайн очилт (олон багтай тайлан баг бүрт). */
  site: number;
  /** Тэр багийн очилтод явсан хүн. */
  people: number;
  last: string | null;
}

/**
 * Талбайн очилт багаар.  Эрэмбэ: очилт ↓, дараа нь `order` (төслийн багийн
 * дараалал), эцэст нь код.
 */
export function teamsOf(entries: readonly AsrBoardReport[], order: readonly string[] = []): AsrBoardTeam[] {
  const acc = new Map<string, { site: number; people: Set<number>; last: string | null }>();
  for (const r of entries) {
    if (!isCountedReport(r) || !isSiteReport(r)) continue;
    for (const code of teamCodesOf(r)) {
      const a = acc.get(code) ?? { site: 0, people: new Set<number>(), last: null };
      a.site += 1;
      for (const id of attendeesOf(r)) a.people.add(id);
      if (a.last == null || r.report_date > a.last) a.last = r.report_date;
      acc.set(code, a);
    }
  }
  const rank = (c: string) => {
    const i = order.indexOf(c);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...acc.entries()]
    .map(([code, a]) => ({ code, site: a.site, people: a.people.size, last: a.last }))
    .sort((a, b) => b.site - a.site || rank(a.code) - rank(b.code) || a.code.localeCompare(b.code));
}

/* ------------------------------------------------------------------ */
/*  Он цагийн жагсаалт — сараар                                       */
/* ------------------------------------------------------------------ */

export interface AsrMonthGroup<R> {
  /** `YYYY-MM`. */
  key: string;
  year: number;
  month: number;
  reports: R[];
}

/** Сараар бүлэглэнэ — шинэ нь эхэнд, сар дотор огноо ↓, дараа нь id ↓. */
export function groupByMonth<R extends Pick<AsrReport, 'id' | 'report_date'>>(
  entries: readonly R[],
): AsrMonthGroup<R>[] {
  const sorted = [...entries].sort(
    (a, b) => b.report_date.localeCompare(a.report_date) || b.id - a.id,
  );
  const groups: AsrMonthGroup<R>[] = [];
  for (const r of sorted) {
    const key = r.report_date.slice(0, 7);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = { key, year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)), reports: [] };
      groups.push(g);
    }
    g.reports.push(r);
  }
  return groups;
}
