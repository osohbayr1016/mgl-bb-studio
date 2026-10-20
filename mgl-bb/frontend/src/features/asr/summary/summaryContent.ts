/**
 * Нэгтгэл тайлангийн БИЧВЭР — хэвлэх хуудас, Excel, Word гурвуулаа ЭНЭ
 * функцуудаар шошго, мөр, агуулгын хэсгээ угсарна.  Нэг газар — эс бөгөөс
 * PDF дээр «Үүрэг даалгавар», Word дээр өөр нэр гарч инженер андуурна.
 *
 * Хэсгийн нэр нь засварлагчийн талбарын нэртэй ИЖИЛ (AsrWorkReportSection,
 * оффис уулзалтын маягт) — цаасан дээрх нэр талбарын нэрээс зөрвөл андуурна.
 */
import { formatDisplayName } from '@/shared/lib/formatting';
import { asrProjectName } from '@/features/projects/asr/asrProjectName';
import { REPORT_TYPE_KEY, type AsrRedBookStatus } from '@/features/projects/asr/types';
import { rangeTitle } from '../board/rangeText';
import type { AsrSummaryEntry, AsrSummaryResponse } from './summaryTypes';

export type T = (key: string, params?: Record<string, string | number>) => string;

const RED_BOOK_KEY: Record<AsrRedBookStatus, string> = {
  missing: 'asr.summary.redBookMissing',
  absent: 'asr.redBookAbsent',
  signed: 'asr.redBookSigned',
  verified: 'asr.redBookVerified',
};

export const typeLabel = (e: Pick<AsrSummaryEntry, 'report_type'>, t: T) => t(REPORT_TYPE_KEY[e.report_type]);

export const statusLabel = (s: AsrSummaryEntry['status'], t: T) =>
  t(s === 'approved' ? 'asr.statusApproved' : 'asr.statusSubmitted');

/** Улаан дэвтэр — зөвхөн талбайн хяналтад утгатай; бусад төрөлд «—». */
export const redBookLabel = (e: Pick<AsrSummaryEntry, 'report_type' | 'red_book_status'>, t: T) =>
  e.report_type === 'site' ? t(RED_BOOK_KEY[e.red_book_status]) : '—';

/** «2026-09-03» → «2026.09.03» (ЗХ-ийн баримтын огнооны хэлбэр). */
export const dotDate = (d: string | null | undefined) => (d ? d.slice(0, 10).replace(/-/g, '.') : '');

export const projectLabel = (name: string) => asrProjectName(name) ?? name;

/** Явсан / оролцсон хүмүүс — зохиогч эхэнд. */
export function peopleOf(e: Pick<AsrSummaryEntry, 'author_name' | 'companions'>): string[] {
  const out: string[] = [];
  if (e.author_name) out.push(formatDisplayName(e.author_name));
  for (const c of e.companions) out.push(formatDisplayName(c));
  return out;
}

export const teamsOf = (e: Pick<AsrSummaryEntry, 'teams'>) => e.teams.map((x) => x.code).join(', ');

/** «Хугацаа» мөр — «2026 оны 9-р сар» + «(2026-09-01 – 2026-09-30)». */
export function periodText(s: Pick<AsrSummaryResponse, 'filters' | 'period'>, t: T): string {
  const f = s.filters;
  if (!f.from && !f.to) {
    const p = s.period;
    return p.from && p.to
      ? `${t('asr.board.preset.all')} (${dotDate(p.from)} – ${dotDate(p.to)})`
      : t('asr.board.preset.all');
  }
  const title = rangeTitle({ from: f.from, to: f.to }, t);
  return f.from && f.to ? `${title} (${dotDate(f.from)} – ${dotDate(f.to)})` : title;
}

/** Баримтын толгойн мета мөрүүд — [шошго, утга]. */
export function metaRows(s: AsrSummaryResponse, t: T): [string, string][] {
  return [
    [t('asr.summary.period'), periodText(s, t)],
    [t('asr.summary.project'), s.project ? projectLabel(s.project.name) : t('asr.summary.allProjects')],
    [
      t('asr.summary.type'),
      s.filters.reportType ? t(REPORT_TYPE_KEY[s.filters.reportType]) : t('asr.summary.allTypes'),
    ],
    [
      t('asr.summary.status'),
      t(s.filters.status === 'approved' ? 'asr.summary.statusApproved' : 'asr.summary.statusCounted'),
    ],
  ];
}

/** Хураангуйн тоонууд — [шошго, утга]. */
export function kpiRows(s: AsrSummaryResponse, t: T): [string, number][] {
  const x = s.totals;
  return [
    [t('asr.summary.kpi.reports'), x.reports],
    [t('asr.summary.kpi.siteVisits'), x.site_visits],
    [t('asr.summary.kpi.projects'), x.projects],
    [t('asr.summary.kpi.people'), x.people],
    [t('asr.summary.kpi.approved'), x.by_status.approved],
    [t('asr.summary.kpi.awaiting'), x.by_status.submitted],
    [t('asr.summary.kpi.withTasks'), x.with_tasks],
    [t('asr.summary.kpi.withDefects'), x.with_defects],
  ];
}

/** Төрлөөр задаргаа — 0-тэйг ч харуулна (бүх төрөл үргэлж). */
export function typeRows(s: AsrSummaryResponse, t: T): [string, number][] {
  return (Object.keys(REPORT_TYPE_KEY) as (keyof typeof REPORT_TYPE_KEY)[])
    .filter((k) => k in s.totals.by_type)
    .map((k) => [t(REPORT_TYPE_KEY[k]), s.totals.by_type[k]]);
}

/** «Мета» мөр — цаг, газар, платформ (тайлангийн толгойн доор). */
export function entryMeta(e: AsrSummaryEntry, t: T): string[] {
  const out: string[] = [];
  if (e.report_type === 'online' && e.meeting_platform) {
    out.push(`${t('asr.summary.field.platform')}: ${e.meeting_platform}`);
  }
  if (e.report_type === 'office') {
    if (e.meeting_place) out.push(`${t('asr.summary.field.meetingPlace')}: ${e.meeting_place}`);
    const time = [e.meeting_start, e.meeting_end].filter(Boolean).join('–');
    if (time) out.push(`${t('asr.summary.field.meetingTime')}: ${time}`);
  }
  if (e.contract_no) out.push(`${t('asr.summary.col.contractNo')}: ${e.contract_no}`);
  if (e.status === 'approved' && e.reviewer_name) {
    out.push(
      `${t('asr.summary.col.reviewer')}: ${formatDisplayName(e.reviewer_name)}${
        e.reviewed_at ? ` (${dotDate(e.reviewed_at)})` : ''
      }`,
    );
  }
  return out;
}

export interface ContentBlock {
  label: string;
  text: string;
}

/**
 * Тайлангийн ГОЛ агуулга — хоосон хэсэг орохгүй.  Оффис уулзалт өөрийн
 * маягттай (0367): зорилго + оролцогч тал + агуулга; бусад төрөлд тайлбар,
 * ажлын тайлан, үүрэг даалгавар, алдаа дутагдал, багийн тэмдэглэл, өмнөх
 * тайлангийн асуудлын шийдэл.
 */
export function entryBlocks(e: AsrSummaryEntry, t: T): ContentBlock[] {
  const out: ContentBlock[] = [];
  const add = (key: string, text: string | null | undefined) => {
    const s = text?.trim();
    if (s) out.push({ label: t(key), text: s });
  };

  if (e.report_type === 'office') {
    add('asr.summary.field.meetingPurpose', e.meeting_purpose);
    add('asr.summary.field.meetingParties', e.meeting_parties);
    add('asr.summary.field.meetingContent', e.work_report);
    add('asr.summary.field.description', e.description);
  } else {
    add('asr.summary.field.description', e.description);
    add('asr.summary.field.workReport', e.work_report);
  }
  add('asr.summary.field.siteTasks', e.site_tasks);
  add('asr.summary.field.defects', e.defects);

  const notes = e.teams
    .filter((x) => x.work_note)
    .map((x) => `${x.code}: ${x.work_note}`)
    .join('\n');
  add('asr.summary.field.teamNotes', notes);

  const res = e.resolutions
    .map((r) => {
      const prev = [r.prev_doc_no, r.prev_report_date ? dotDate(r.prev_report_date) : null]
        .filter(Boolean)
        .join(' · ');
      const body = [r.issue_text, r.resolution_text ? `→ ${r.resolution_text}` : null]
        .filter(Boolean)
        .join(' ');
      return prev ? `${prev}: ${body}` : body;
    })
    .filter(Boolean)
    .join('\n');
  add('asr.summary.field.resolutions', res);

  return out;
}

/** Бүх төслийн нэгтгэл эсэх — тийм бол бүртгэлд «Төсөл» багана, «Төслөөр» хэсэг. */
export const isMultiProject = (s: AsrSummaryResponse) => s.filters.projectId == null;
