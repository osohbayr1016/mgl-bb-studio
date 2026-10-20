/**
 * Зохиогчийн хяналтын НЭГТГЭЛ ТАЙЛАН — дүрэм ГАНЦ газар (эзний хүсэлт 2026-10-01).
 *
 * Эзний 4 шийдвэр:
 *   • хоёр газраас: ЗХ самбараас БҮХ төслийн, төслийн ЗХ самбараас тухайн төслийн;
 *   • агуулга = хүснэгт (огноо, дугаар, төсөл, төрөл, баг, хэн явсан, төлөв)
 *     + тайлан бүрийн ГОЛ агуулга (тайлбар, үүрэг даалгавар, алдаа дутагдал,
 *     өмнөх тайлангийн асуудлын шийдэл; оффис уулзалтын зорилго) — ЗУРАГГҮЙ;
 *   • PDF (хэвлэх), Excel, Word — гурвуулаа ЭНЭ өгөгдлөөс (`GET /summary`);
 *   • ЗӨВХӨН админ.
 *
 * Тоолох дүрэм нь самбартай ИЖИЛ (`authorSupervisionStats.ts`, `asrBoard.ts`):
 *   • тайлан  = `submitted|approved` (ноорог ХЭЗЭЭ Ч орохгүй; буцаагдсан ч
 *               орохгүй — албан ёсны тайлан биш);
 *   • очилт   = тайлан + `report_type = 'site'`;
 *   • хүн     = зохиогч + хамт явсан (`asr_report_companions`);
 *   • баг     = олон багийг хамарсан тайлан баг БҮРТ тоологдоно (нийлбэр > нийт).
 *
 * Импортгүй (зөвхөн type) — `node --test`-ээр шууд шалгагдана.
 */
import type { AsrRedBookStatus } from './asrRedBook';
import type { AsrReportType } from './asrReportType';

export const SUMMARY_REPORT_TYPES: readonly AsrReportType[] = ['site', 'office', 'drawing_change', 'online'];

/** `counted` = илгээсэн + батлагдсан (өгөгдмөл); `approved` = зөвхөн батлагдсан. */
export type AsrSummaryStatusFilter = 'counted' | 'approved';

export interface AsrSummaryFilters {
  from: string | null;
  to: string | null;
  projectId: number | null;
  reportType: AsrReportType | null;
  status: AsrSummaryStatusFilter;
}

/** Нэг хүсэлтэд буцаах тайлангийн дээд тоо — үүнээс олон бол `truncated`. */
export const SUMMARY_MAX_REPORTS = 2000;

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Бодит `YYYY-MM-DD` огноо эсэх (`2026-02-30` → false). */
export function isYmd(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m = YMD_RE.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === v;
}

/**
 * Query string → шүүлт.  Буруу огноо / төрөл / төлөв нь 400 (чимээгүй
 * үл тоовол «9-р сарын нэгтгэл» гэж хүссэн хүн бүх хугацааныхыг авна).
 * `from > to` бол солино (самбарын `normalizeRange`-тэй ижил).
 */
export function parseSummaryQuery(
  q: Record<string, string | undefined>,
  isType: (v: unknown) => v is AsrReportType,
): { ok: true; filters: AsrSummaryFilters } | { ok: false; error: string } {
  const empty = (v: string | undefined) => v == null || v.trim() === '';

  let from: string | null = null;
  let to: string | null = null;
  if (!empty(q.from)) {
    if (!isYmd(q.from)) return { ok: false, error: 'from must be YYYY-MM-DD' };
    from = q.from;
  }
  if (!empty(q.to)) {
    if (!isYmd(q.to)) return { ok: false, error: 'to must be YYYY-MM-DD' };
    to = q.to;
  }
  if (from && to && from > to) [from, to] = [to, from];

  let projectId: number | null = null;
  if (!empty(q.project_id)) {
    const n = Number(q.project_id);
    if (!Number.isSafeInteger(n) || n <= 0) return { ok: false, error: 'Invalid project_id' };
    projectId = n;
  }

  let reportType: AsrReportType | null = null;
  if (!empty(q.report_type)) {
    if (!isType(q.report_type)) return { ok: false, error: 'Invalid report_type' };
    reportType = q.report_type;
  }

  let status: AsrSummaryStatusFilter = 'counted';
  if (!empty(q.status)) {
    if (q.status !== 'counted' && q.status !== 'approved') {
      return { ok: false, error: 'Invalid status' };
    }
    status = q.status;
  }

  return { ok: true, filters: { from, to, projectId, reportType, status } };
}

/**
 * Тайлангийн мөрийг шүүх WHERE (alias `r`) + bind.  Гол асуулга ба хүүхэд
 * мөрийн (баг, хамт явсан, шийдэл) асуулгууд ИЖИЛ нөхцөл хэрэглэнэ —
 * эс бөгөөс хүүхэд мөр шүүлтээс гадуурх тайланд хамаарч болно.
 */
export function summaryWhere(f: AsrSummaryFilters): { sql: string; args: (string | number)[] } {
  const parts: string[] = [
    f.status === 'approved' ? `r.status = 'approved'` : `r.status IN ('submitted','approved')`,
  ];
  const args: (string | number)[] = [];
  if (f.from) {
    parts.push('r.report_date >= ?');
    args.push(f.from);
  }
  if (f.to) {
    parts.push('r.report_date <= ?');
    args.push(f.to);
  }
  if (f.projectId != null) {
    parts.push('r.project_id = ?');
    args.push(f.projectId);
  }
  if (f.reportType) {
    parts.push('r.report_type = ?');
    args.push(f.reportType);
  }
  return { sql: parts.join(' AND '), args };
}

/* ------------------------------------------------------------------ */
/*  Оролтын мөрүүд (D1-ээс)                                            */
/* ------------------------------------------------------------------ */

export interface SummaryReportRow {
  id: number;
  project_id: number;
  project_name: string | null;
  base_name: string | null;
  shifr: string | null;
  contract_no: string | null;
  doc_no: string | null;
  report_date: string;
  report_type: string | null;
  meeting_platform: string | null;
  meeting_place: string | null;
  meeting_start: string | null;
  meeting_end: string | null;
  meeting_parties: string | null;
  meeting_purpose: string | null;
  status: string;
  description: string | null;
  work_report: string | null;
  site_tasks: string | null;
  defects: string | null;
  red_book_status: AsrRedBookStatus;
  author_id: number | null;
  author_name: string | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  photo_count: number | null;
}

export interface SummaryTeamRow {
  report_id: number;
  code: string;
  name_mn: string | null;
  work_note: string | null;
}

export interface SummaryCompanionRow {
  report_id: number;
  user_id: number;
  full_name: string | null;
}

export interface SummaryResolutionRow {
  report_id: number;
  prev_doc_no: string | null;
  prev_report_date: string | null;
  issue_text: string | null;
  resolution_text: string | null;
}

/* ------------------------------------------------------------------ */
/*  Гаралт                                                             */
/* ------------------------------------------------------------------ */

export type TypeCounts = Record<AsrReportType, number>;

export interface AsrSummaryEntry {
  id: number;
  project_id: number;
  project_name: string;
  shifr: string | null;
  contract_no: string | null;
  doc_no: string | null;
  report_date: string;
  report_type: AsrReportType;
  meeting_platform: string | null;
  meeting_place: string | null;
  meeting_start: string | null;
  meeting_end: string | null;
  meeting_parties: string | null;
  meeting_purpose: string | null;
  status: 'submitted' | 'approved';
  description: string | null;
  work_report: string | null;
  site_tasks: string | null;
  defects: string | null;
  red_book_status: AsrRedBookStatus;
  author_id: number | null;
  author_name: string | null;
  companions: string[];
  teams: { code: string; name: string | null; work_note: string | null }[];
  resolutions: {
    prev_doc_no: string | null;
    prev_report_date: string | null;
    issue_text: string | null;
    resolution_text: string | null;
  }[];
  reviewer_name: string | null;
  reviewed_at: string | null;
  photo_count: number;
}

export interface AsrSummaryProjectRow {
  project_id: number;
  name: string;
  shifr: string | null;
  contract_no: string | null;
  reports: number;
  site_visits: number;
  by_type: TypeCounts;
  approved: number;
  with_defects: number;
  people: number;
  first_date: string;
  last_date: string;
}

export interface AsrSummaryTeamStat {
  code: string;
  name: string | null;
  reports: number;
  site_visits: number;
}

export interface AsrSummaryPersonStat {
  user_id: number;
  name: string;
  /** Тайлангийн тоо (зохиогч эсвэл хамт явсан). */
  reports: number;
  /** Талбайн очилт. */
  site_visits: number;
  /** Өөрөө зохиогч болсон тайлан. */
  authored: number;
}

export interface AsrSummary {
  /** Хүсэлтийн шүүлт (хүн уншихаар UI угсарна). */
  filters: AsrSummaryFilters;
  /** Бодит хамрах хугацаа — нээлттэй талыг өгөгдлөөр нөхсөн (файлын нэр, гарчиг). */
  period: { from: string | null; to: string | null };
  totals: {
    reports: number;
    site_visits: number;
    projects: number;
    people: number;
    by_type: TypeCounts;
    by_status: { submitted: number; approved: number };
    /** Талбайн хяналтын улаан дэвтрийн төлөв (бусад төрөлд шаардлагагүй). */
    red_book: Record<AsrRedBookStatus, number>;
    with_defects: number;
    with_tasks: number;
    photos: number;
  };
  by_project: AsrSummaryProjectRow[];
  by_team: AsrSummaryTeamStat[];
  by_person: AsrSummaryPersonStat[];
  entries: AsrSummaryEntry[];
  truncated: boolean;
}

const emptyTypeCounts = (): TypeCounts => ({ site: 0, office: 0, drawing_change: 0, online: 0 });

/** Хоосон / зөвхөн зайтай бичвэр → null. */
function clean(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function typeOf(v: string | null, isType: (v: unknown) => v is AsrReportType): AsrReportType {
  return isType(v) ? v : 'site';
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'mn');

/**
 * D1-ийн мөрүүдээс нэгтгэл угсарна.  Тайлангууд огноо өсөхөөр (хамгийн
 * эртнийх эхэнд) — нэгтгэл тайланг он цагийн дарааллаар уншина.
 */
export function buildAsrSummary(input: {
  filters: AsrSummaryFilters;
  reports: readonly SummaryReportRow[];
  teams: readonly SummaryTeamRow[];
  companions: readonly SummaryCompanionRow[];
  resolutions: readonly SummaryResolutionRow[];
  truncated: boolean;
  isType: (v: unknown) => v is AsrReportType;
}): AsrSummary {
  const { filters, isType } = input;

  const reports = [...input.reports].sort(
    (a, b) => a.report_date.localeCompare(b.report_date) || a.id - b.id,
  );
  const ids = new Set(reports.map((r) => r.id));

  const teamsOf = new Map<number, AsrSummaryEntry['teams']>();
  for (const t of input.teams) {
    if (!ids.has(t.report_id)) continue;
    const list = teamsOf.get(t.report_id) ?? [];
    if (!list.some((x) => x.code === t.code)) {
      list.push({ code: t.code, name: clean(t.name_mn), work_note: clean(t.work_note) });
    }
    teamsOf.set(t.report_id, list);
  }

  const companionsOf = new Map<number, SummaryCompanionRow[]>();
  for (const c of input.companions) {
    if (!ids.has(c.report_id)) continue;
    const list = companionsOf.get(c.report_id) ?? [];
    list.push(c);
    companionsOf.set(c.report_id, list);
  }

  const resolutionsOf = new Map<number, AsrSummaryEntry['resolutions']>();
  for (const r of input.resolutions) {
    if (!ids.has(r.report_id)) continue;
    const issue = clean(r.issue_text);
    const resolution = clean(r.resolution_text);
    if (!issue && !resolution) continue;
    const list = resolutionsOf.get(r.report_id) ?? [];
    list.push({
      prev_doc_no: clean(r.prev_doc_no),
      prev_report_date: clean(r.prev_report_date),
      issue_text: issue,
      resolution_text: resolution,
    });
    resolutionsOf.set(r.report_id, list);
  }

  const totals: AsrSummary['totals'] = {
    reports: 0,
    site_visits: 0,
    projects: 0,
    people: 0,
    by_type: emptyTypeCounts(),
    by_status: { submitted: 0, approved: 0 },
    red_book: { missing: 0, absent: 0, signed: 0, verified: 0 },
    with_defects: 0,
    with_tasks: 0,
    photos: 0,
  };

  const projects = new Map<
    number,
    AsrSummaryProjectRow & { peopleIds: Set<number> }
  >();
  const teams = new Map<string, AsrSummaryTeamStat>();
  const people = new Map<number, AsrSummaryPersonStat>();

  const touchPerson = (id: number, name: string | null, site: boolean, authored: boolean) => {
    const p = people.get(id) ?? {
      user_id: id,
      name: clean(name) ?? `#${id}`,
      reports: 0,
      site_visits: 0,
      authored: 0,
    };
    p.reports += 1;
    if (site) p.site_visits += 1;
    if (authored) p.authored += 1;
    people.set(id, p);
  };

  const entries: AsrSummaryEntry[] = [];
  for (const r of reports) {
    const type = typeOf(r.report_type, isType);
    const site = type === 'site';
    const status: 'submitted' | 'approved' = r.status === 'approved' ? 'approved' : 'submitted';
    const companionRows = companionsOf.get(r.id) ?? [];
    const entryTeams = teamsOf.get(r.id) ?? [];
    const defects = clean(r.defects);
    const tasks = clean(r.site_tasks);
    const photos = Math.max(0, Number(r.photo_count) || 0);
    const name = clean(r.project_name) ?? clean(r.base_name) ?? `#${r.project_id}`;

    totals.reports += 1;
    if (site) {
      totals.site_visits += 1;
      totals.red_book[r.red_book_status] += 1;
    }
    totals.by_type[type] += 1;
    totals.by_status[status] += 1;
    if (defects) totals.with_defects += 1;
    if (tasks) totals.with_tasks += 1;
    totals.photos += photos;

    // Хүн: зохиогч + хамт явсан.  Зохиогч хамт явсан жагсаалтад давхардвал нэг л удаа.
    const attendees = new Set<number>();
    if (r.author_id != null) {
      attendees.add(r.author_id);
      touchPerson(r.author_id, r.author_name, site, true);
    }
    for (const c of companionRows) {
      if (attendees.has(c.user_id)) continue;
      attendees.add(c.user_id);
      touchPerson(c.user_id, c.full_name, site, false);
    }

    const proj = projects.get(r.project_id) ?? {
      project_id: r.project_id,
      name,
      shifr: clean(r.shifr),
      contract_no: clean(r.contract_no),
      reports: 0,
      site_visits: 0,
      by_type: emptyTypeCounts(),
      approved: 0,
      with_defects: 0,
      people: 0,
      first_date: r.report_date,
      last_date: r.report_date,
      peopleIds: new Set<number>(),
    };
    proj.reports += 1;
    if (site) proj.site_visits += 1;
    proj.by_type[type] += 1;
    if (status === 'approved') proj.approved += 1;
    if (defects) proj.with_defects += 1;
    if (r.report_date < proj.first_date) proj.first_date = r.report_date;
    if (r.report_date > proj.last_date) proj.last_date = r.report_date;
    // Сүүлийн тайлангийн шифр/дугаар нь төслийн одоогийнх — хоосон бол өмнөхийг хадгална.
    proj.shifr = clean(r.shifr) ?? proj.shifr;
    proj.contract_no = clean(r.contract_no) ?? proj.contract_no;
    for (const id of attendees) proj.peopleIds.add(id);
    projects.set(r.project_id, proj);

    for (const t of entryTeams) {
      const s = teams.get(t.code) ?? { code: t.code, name: t.name, reports: 0, site_visits: 0 };
      s.reports += 1;
      if (site) s.site_visits += 1;
      teams.set(t.code, s);
    }

    entries.push({
      id: r.id,
      project_id: r.project_id,
      project_name: name,
      shifr: clean(r.shifr),
      contract_no: clean(r.contract_no),
      doc_no: clean(r.doc_no),
      report_date: r.report_date,
      report_type: type,
      meeting_platform: type === 'online' ? clean(r.meeting_platform) : null,
      meeting_place: clean(r.meeting_place),
      meeting_start: clean(r.meeting_start),
      meeting_end: clean(r.meeting_end),
      meeting_parties: clean(r.meeting_parties),
      meeting_purpose: clean(r.meeting_purpose),
      status,
      description: clean(r.description),
      work_report: clean(r.work_report),
      site_tasks: tasks,
      defects,
      red_book_status: r.red_book_status,
      author_id: r.author_id,
      author_name: clean(r.author_name),
      companions: companionRows
        .filter((c) => c.user_id !== r.author_id)
        .map((c) => clean(c.full_name) ?? `#${c.user_id}`),
      teams: entryTeams,
      resolutions: resolutionsOf.get(r.id) ?? [],
      reviewer_name: status === 'approved' ? clean(r.reviewer_name) : null,
      reviewed_at: status === 'approved' ? clean(r.reviewed_at) : null,
      photo_count: photos,
    });
  }

  totals.projects = projects.size;
  totals.people = people.size;

  const byProject = [...projects.values()]
    .map(({ peopleIds, ...p }) => ({ ...p, people: peopleIds.size }))
    .sort(byName);

  const byTeam = [...teams.values()].sort(
    (a, b) => b.reports - a.reports || a.code.localeCompare(b.code),
  );

  const byPerson = [...people.values()].sort(
    (a, b) => b.reports - a.reports || b.site_visits - a.site_visits || a.name.localeCompare(b.name, 'mn'),
  );

  const first = entries[0]?.report_date ?? null;
  const last = entries[entries.length - 1]?.report_date ?? null;

  return {
    filters,
    period: { from: filters.from ?? first, to: filters.to ?? last },
    totals,
    by_project: byProject,
    by_team: byTeam,
    by_person: byPerson,
    entries,
    truncated: input.truncated,
  };
}

/**
 * Татах файлын нэр (PDF / Excel / Word гурвуулаа) — ГАНЦ газар; сервер
 * хариундаа `file_stem` болгож өгдөг тул frontend давтан бичихгүй.
 *   `MGL-251006_DASR_Negtgel_2026-09-01_2026-09-30` (нэг төсөл)
 *   `DASR_Negtgel_2026-09-01_2026-09-30` (бүх төсөл)
 * Төслийн хэсэг нь `asrProjectId` (`MGL-yymmdd`) — хоосон бол орхино.
 */
export function asrSummaryFileStem(opts: {
  projectCode: string | null;
  period: { from: string | null; to: string | null };
}): string {
  const from = opts.period.from ?? 'all';
  const to = opts.period.to ?? from;
  const range = from === to ? from : `${from}_${to}`;
  const code = (opts.projectCode ?? '').replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^_+|_+$/g, '');
  return `${code ? `${code}_` : ''}DASR_Negtgel_${range}`;
}
