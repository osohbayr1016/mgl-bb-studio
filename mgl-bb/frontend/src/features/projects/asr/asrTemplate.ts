/**
 * `YYMMDD_PROJECT ID_ASR_BA_001.docx` Word загварын ЯГ ТЭР геометр.
 *
 * Бүх тоо нь `word/document.xml`-ээс шууд уншсан twip (1 twip = 1/1440 инч
 * = 0.0176389 мм).  Загварыг хөндөхгүйгээр баримтыг дахин бүтээх боломжтой
 * байлгах зорилгоор энд тусад нь байрлуулав — өөрчлөх бол эх .docx-ийг
 * дахин уншиж, эдгээр тоог шинэчилнэ.
 *
 * Хүснэгт: 12 багана, нийт 9802 twip = 172.9 мм.
 * Хуудас: A4, дээш 32.5 / хажуу 19.1 / доош 25.4 мм, толгой 10 мм-т.
 */

import { asrProjectId } from './asrProjectName';

export const TWIP_MM = 0.0176389;
export const twMm = (tw: number) => +(tw * TWIP_MM).toFixed(2);

/** 12 grid баганын twip өргөн (document.xml → tblGrid). */
export const GRID_COLS = [1322, 686, 521, 1331, 1029, 249, 88, 1227, 1133, 16, 1194, 1006] as const;

export const GRID_TOTAL = GRID_COLS.reduce((a, b) => a + b, 0); // 9802

/** Мөрийн өндөр twip-ээр (trHeight, hRule=atLeast — өсөж болно). */
export const ROW_H = {
  projectName: 246,
  shifr: 180,
  description: 196,
  visitedTeams: 218,
  checkedBy: 261,
  spacer1: 129,
  photos: 872,
  attachment: 301,
  spacer2: 60,
  workReportLabel: 187,
  workReportTeams: 140,
  workReportBody: 6862,
  signHead: 549,
  signArch: 539,
  signSite: 653,
} as const;

/**
 * «Хяналтаар явсан» мөрийн 7 нүд — загвар дээрх ЯГ тэр шошго ба gridSpan.
 * Тэмдэглэл: `ХТ` ба `ДГ` нь `teams` хүснэгтэд БАЙХГҮЙ (загвар нь цахилгааны
 * хуваалтын хуучин нэрлэлт), харин `ЦАХ` нь загварт байхгүй.  Иймд доорх
 * `code: null` нүднүүд хэзээ ч тэмдэглэгдэхгүй, DB-д байгаа бусад баг
 * (TSAH, IZ, EZ, GT …) сонгогдвол мөрийн ХОЙНО нэмэлт болж гарна —
 * тэгснээр цаасан хэлбэр ижил хэвээр, өгөгдөл ч алдагдахгүй.
 */
export const VISITED_TEAM_CELLS: { label: string; code: string | null; span: number }[] = [
  { label: 'БА', code: 'BA', span: 2 },
  { label: 'ББ', code: 'BB', span: 1 },
  { label: 'ХАС', code: 'HAS', span: 2 },
  { label: 'ЦБУ', code: 'TSBU', span: 2 },
  { label: 'ХТ', code: null, span: 2 },
  { label: 'ДГ', code: null, span: 1 },
  { label: 'ХД', code: 'HD', span: 1 },
];

/** «Ажлын тайлан»-гийн доорх багийн мөр — нэг нүдэнд, АУ нэмэгдсэн. */
export const WORK_REPORT_TEAMS: { label: string; code: string | null }[] = [
  { label: 'БА', code: 'BA' },
  { label: 'ББ', code: 'BB' },
  { label: 'ХАС', code: 'HAS' },
  { label: 'ЦБУ', code: 'TSBU' },
  { label: 'ХТ', code: null },
  { label: 'ДГ', code: null },
  { label: 'ХД', code: 'HD' },
  { label: 'АУ', code: 'AU' },
];

/** Загварт байгаа бүх багийн код — үүнд ороогүй сонголт нэмэлт болж гарна. */
export const TEMPLATE_TEAM_CODES = new Set(
  [...VISITED_TEAM_CELLS, ...WORK_REPORT_TEAMS].map((t) => t.code).filter(Boolean) as string[],
);

/**
 * DB код → загварын монгол шошго (`TSBU` → `ЦБУ`).  Ажлын тайлангийн мөрөнд
 * англи код биш, цаасан хэлбэр дээрх нэрийг харуулахын тулд.
 */
const CODE_TO_LABEL = new Map(
  WORK_REPORT_TEAMS.filter((t) => t.code).map((t) => [t.code as string, t.label]),
);

export function templateTeamLabel(code: string): string {
  return CODE_TO_LABEL.get(code) ?? code;
}

/** «Бичиг баримтын төрөл» — 2 мөрт 3+3, загварын дарааллаар. */
export const DOC_KIND_ROWS = [
  [
    { key: 'planning', label: 'Төлөвлөлт' },
    { key: 'progress', label: 'Явц' },
    { key: 'report', label: 'Тайлан' },
  ],
  [
    { key: 'drawing', label: 'Ажлын зураг' },
    { key: 'schedule', label: 'Хуваарь' },
    { key: 'other', label: 'Бусад' },
  ],
] as const;

/**
 * Баримтын НЭР ба ТОВЧЛОЛ (эзний шийдвэр 2026-09-28): «Design Author’s
 * Supervision Report», товчлол **DASR** (өмнө нь «Author’s Supervision
 * Report» / ASR).  Хэвлэх толгой, Word-ийн толгой, файлын нэр, дугаар бүгд
 * эндээс.  ⚠️ ИХЭР: `backend/src/lib/asrNo.ts` (`DASR-NNN`) ба
 * `routes/authorSupervision.ts`-ийн PDF файлын нэр.
 */
export const ASR_DOC_TITLE_EN = 'Design Author’s Supervision Report';
export const ASR_ABBR = 'DASR';

/** `2026.07.28` — хүснэгтийн «Он сар өдөр» нүд загвар дээр цэгтэй. */
export function tableDate(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '20__.__.__';
  return iso.replace(/-/g, '.');
}

/** `2026/07/28` — толгойн «Report Date» загвар дээр налуутай. */
export function headerDate(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '____/__/__';
  return iso.replace(/-/g, '/');
}

/**
 * Толгойн `Doc. No.` — загварын хэлбэр `PROJECT-ID_DASR_BA_001`.  PROJECT-ID =
 * төслийн код (`asrProjectId`, 2026-09-28-наас; өмнө нь шифр байсан).  `seq`
 * олгогдоогүй ноорог үед дугаарын оронд `___`.
 */
export function headerDocNo(opts: {
  projectId: string;
  teamCode?: string | null;
  seq?: number | null;
}): string {
  const id = opts.projectId.trim().replace(/\s+/g, '-');
  const team = opts.teamCode || 'XX';
  const num = opts.seq != null ? String(opts.seq).padStart(3, '0') : '___';
  return `${id}_${ASR_ABBR}_${team}_${num}`;
}

/**
 * Тайлангийн толгойн `Doc. No.` — хэвлэх хуудас ба Word ХОЁУЛАА үүгээр.
 * Баг = эхний сонгосон баг (нэг тайлан = ихэвчлэн нэг баг).  2026-09-29-нөөс
 * `seq` нь ЭНЭ багийн дараалал (огноогоор, миграц 0359) — баг ба дугаар нэг
 * эх сурвалжаас тул зөрөхгүй.
 *
 * `seq` NULL + `doc_no` (0359-өөс өмнө нөхөж бүртгэсэн хуучин тайлан, файлын
 * өөрийн дугаар) — хамгаалалтын нөөц зам; 0359 бүх ноорог биш тайланд
 * дугаар олгосон тул ийм мөр одоо үүсэхгүй.
 */
export function asrHeaderDocNo(
  entry: {
    seq?: number | null;
    doc_no?: string | null;
    teams?: { team_code: string }[] | null;
  },
  projectName: string | null | undefined,
): string {
  if (entry.seq == null && entry.doc_no) return entry.doc_no;
  return headerDocNo({
    projectId: asrProjectId(projectName),
    teamCode: entry.teams?.[0]?.team_code ?? null,
    seq: entry.seq,
  });
}

/**
 * Татах файлын нэрийн үндэс — Word загварын өөрийн нэрийн хэлбэр
 * `YYMMDD_PROJECT ID_ASR_BA_001` → `260925_MGL-251006_DASR_BB_015` (эзэн
 * 2026-09-28: шифр БИШ, төслийн ID; баг ч орно).  Дугаар олгогдоогүй бол
 * `draft`; нөхөж бүртгэсэн хуучин тайлан (`seq` NULL) файлын өөрийн дугаартай.
 *
 * ⚠️ ИХЭР: `backend/src/lib/asrNo.ts` `asrFileStem` (`GET /:id/pdf`-ийн нэр).
 *    Нэг тайлангийн PDF ба DOCX хавтсанд зэрэгцэж эрэмбэлэгдэх ёстой.
 */
export function asrFileStem(
  entry: {
    report_date?: string | null;
    seq?: number | null;
    doc_no?: string | null;
    teams?: { team_code: string }[] | null;
  },
  projectName: string | null | undefined,
): string {
  const ymd = (entry.report_date || '').replace(/-/g, '').slice(2);
  const pid = asrProjectId(projectName).replace(/[\s/\\]+/g, '-');
  const team = entry.teams?.[0]?.team_code || 'XX';
  const num = entry.seq != null ? String(entry.seq).padStart(3, '0') : 'draft';
  const body =
    entry.seq == null && entry.doc_no ? `${pid}_${entry.doc_no}` : `${pid}_${ASR_ABBR}_${team}_${num}`;
  return (
    `${ymd}_${body}`
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}._-]/gu, '')
      .slice(0, 90) || ASR_ABBR
  );
}
