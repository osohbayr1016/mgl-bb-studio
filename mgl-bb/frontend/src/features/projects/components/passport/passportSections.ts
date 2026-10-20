/* =============================================================
 * «PROJECT DESCRIPTION» Word загварын хуваалцах тодорхойлолтууд
 * -------------------------------------------------------------
 * 1.1 Ерөнхий мэдээлэл · Бичиг баримт · 1.2 Хамрах хүрээ ·
 * 1.3 Төслийн хугацаа — эдгээр нь ТӨСЛИЙН «Мэдээлэл» хуудсанд
 * амьдарч, тайлан зэрэг бусад бүх газар ТЭНДЭЭС татна
 * (эзний шийдвэр 2026-09-02).
 *
 * Энэ файл нь ХОЁР хэрэглэгчтэй бөгөөд хоёулаа ЯГ ижил мөр
 * үүсгэх ёстой тул тогтмолууд энд НЭГ л газар байна:
 *   • `ProjectInfoTab`            — байгаа төслийн засварлагч
 *   • `ProjectsPage` үүсгэх шидтэн — 2 дахь алхам
 * ============================================================= */

import type {
  ProjectMeetingRow,
  ProjectPassport,
  ProjectScopeRow,
  ProjectTeamShare,
  ProjectTimelineRow,
} from '@/shared/types';

/** Богино id — React key ба мөр нэмэх/хасахад л хэрэгтэй. */
export function rowId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

/* ---------------- Дисциплин (Ажлын хэсэг) ---------------- */

/** Эзний шийдвэр 2026-09-02: цаасан маягт дээр 8 нүд байдаг ч апп дээрх
 *  10 кодын жагсаалт ХЭВЭЭР үлдэнэ (ЭЗ, ГТ хоёрыг хасахгүй).
 *
 *  ⚠️ `features/performance-reports/types/introOverride.ts`-ийн
 *  `INTRO_DISCIPLINES`-тай ИЖРҮҮД.  Тэнд нэмэлтээр `ET` (Орчны ЕТ) байдаг
 *  бөгөөд тайлангийн ДАРААЛЛЫГ тэр тодорхойлдог — код нэмбэл ХОЁУЛАНД нь. */
export const PASSPORT_DISCIPLINES: ReadonlyArray<{
  code: string;
  label: string;
  mn: string;
}> = [
  /* ⚠️ ЕТ нь `INTRO_DISCIPLINES`-д байдаг бөгөөд баримтын ■ мөр 11 кодыг
     бүгдийг үзүүлдэг.  Энд байхгүй бол хэрэглэгч ЕТ-г баримт дээр тэмдэглэж
     чадах ч «Мэдээлэл» табын `DisciplinePicker` түүнийг мэдэхгүй тул
     ХАСАХ контрол хаана ч байхгүй болно. */
  { code: 'ET', label: 'ЕТ', mn: 'Орчны ЕТ, өндөржилт' },
  { code: 'BA', label: 'БА', mn: 'Барилга архитектур' },
  { code: 'BB', label: 'ББ', mn: 'Барилга бүтээц' },
  { code: 'HAS', label: 'ХАС', mn: 'Халаалт агаар сэлгэлт' },
  // ⚠️ Монгол нэрс нь `INTRO_DISCIPLINES`-тэй ҮГЧЛЭН таарах ЁСТОЙ: тайлангийн
  // 1.2-ын «Тодорхойлолт» багана багаас гаргах замд `DISCIPLINE_MN`-ээс,
  // «Багуудаас бөглөх» замд эндээс уншдаг — зөрвөл нэг төслийн баримт
  // тайлбаргүйгээр өөр үг бичнэ.
  { code: 'TSBU', label: 'ЦБУ', mn: 'Дотор цэвэр бохир ус' },
  { code: 'TSAH', label: 'ЦАХ', mn: 'Дотор цахилгаан' },
  { code: 'HD', label: 'ХД', mn: 'Дотор холбоо дохиолол' },
  { code: 'AU', label: 'АУ', mn: 'Автоматжуулалт' },
  { code: 'EZ', label: 'ЭЗ', mn: 'Эскиз зураг' },
  { code: 'IZ', label: 'ИЗ', mn: 'Интерьер зураг' },
  { code: 'GT', label: 'ГТ', mn: 'Гадна тохижилт' },
];

export const DISCIPLINE_LABEL_MN: Record<string, string> = Object.fromEntries(
  PASSPORT_DISCIPLINES.map((d) => [d.code, d.label]),
);
export const DISCIPLINE_NAME_MN: Record<string, string> = Object.fromEntries(
  PASSPORT_DISCIPLINES.map((d) => [d.code, d.mn]),
);

/** Жишиг баримтын ДАРААЛАЛ (INTRO_DISCIPLINES-ийн эрэмбэ).  Жагсаалтад
 *  байхгүй кодыг хойно нь үлдээнэ — гараар бичсэн мөр алдагдахгүй. */
const ORDER = ['EZ', 'ET', 'BA', 'BB', 'HAS', 'TSBU', 'TSAH', 'HD', 'AU', 'IZ', 'GT'];
export const disciplineOrder = (code: string): number => {
  const i = ORDER.indexOf(code);
  return i === -1 ? 999 : i;
};

/* ---------------- 1.2 Хамрах хүрээ ---------------- */

export function blankScopeRow(): ProjectScopeRow {
  return {
    id: rowId('sc'),
    code: '',
    codeLabel: '',
    identification: '',
    leader: '',
    specialist: '',
    fileName: '',
  };
}

/** `251218_MAX_URGUU_DT_EZ_A` хэлбэрийн файлын нэр.
 *
 *  ⚠️ ИЖРҮҮД: `features/performance-reports/lib/introAuto.ts`-ийн
 *  `teamFileName`.  Тэр нь паспортад 1.2 хадгалагдаагүй ХУУЧИН төслүүдийн
 *  нөхөлт зам — хоёулаа ижил мөр гаргах ёстой.  YYMMDD нь төслийн эхлэх
 *  огноо (байхгүй бол өнөөдөр). */
export function buildScopeFileName(
  startDate: string | null,
  projectName: string,
  code: string,
): string {
  // ⚠️ Баримтын огноо `2026.09.25` (цэгтэй) хэлбэрээр ирж болно — ISO болгохгүй
  // бол доорх `-` хасалт цэгийг үлдээж "26.09." гэсэн эвдэрсэн угтвар гаргана.
  const src = toIsoDate(startDate) || new Date().toISOString().slice(0, 10);
  const fileBase = src.replace(/-/g, '').slice(2, 8);
  const projSlug =
    (projectName || 'PROJECT')
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toUpperCase()
      .slice(0, 24) || 'PROJECT';
  return `${fileBase}_${projSlug}_${code}_A`;
}

/** «Багуудаас бөглөх» — тэмдэглэсэн дисциплин + төслийн багийн хуваарийг
 *  1.2-ын мөр болгоно.
 *
 *  ⚠️ Энэ нь ЗӨВХӨН эхлэлийн утга бөгөөд ЗӨВХӨН товч дарсан үед ажиллана.
 *  Checkbox дарахад автоматаар ажиллуулбал хэрэглэгчийн гараар бичсэн
 *  мөрийг дарж бичих эрсдэлтэй.  Аль хэдийн байгаа кодыг ДАВХАРДУУЛАХГҮЙ. */
export function seedScopeRows(opts: {
  existing: ProjectScopeRow[];
  disciplines: string[];
  teamShares: ProjectTeamShare[];
  projectName: string;
  startDate: string | null;
}): ProjectScopeRow[] {
  const { existing, disciplines, teamShares, projectName, startDate } = opts;
  // Дисциплин тэмдэглээгүй бол багийн хуваарь дээрээс сэргээнэ.
  const codes = disciplines.length
    ? disciplines
    : [...new Set(teamShares.map((s) => s.team_code))];
  const have = new Set(existing.map((r) => r.code).filter(Boolean));
  const added = codes
    .filter((c) => !have.has(c))
    .map((code): ProjectScopeRow => {
      const share = teamShares.find((s) => s.team_code === code);
      return {
        id: rowId('sc'),
        code,
        codeLabel: DISCIPLINE_LABEL_MN[code] ?? code,
        identification: DISCIPLINE_NAME_MN[code] ?? share?.team_name_mn ?? '',
        leader: '',
        specialist: '',
        fileName: buildScopeFileName(startDate, projectName, code),
      };
    });
  return [...existing, ...added].sort((a, b) => disciplineOrder(a.code) - disciplineOrder(b.code));
}

/** Шинэ төслийн 1.2 — БҮХ дисциплин (ЕТ-г оролцуулан), баримтын дарааллаар
 *  (эзний хүсэлт 2026-09-25: «төсөл үүсгэхэд бүх багийн мэдээлэл автоматаар»).
 *  Id нь кодоос тогтмол (`sc-BA`) — хэрэглэгч засаагүй үед мөрүүд нэр/огноо
 *  өөрчлөгдөх бүрт дахин үүсдэг тул санамсаргүй id нь баримтын нүдийг
 *  дахин mount хийлгэнэ. */
export function defaultScopeRows(projectName: string, startDate: string | null): ProjectScopeRow[] {
  return [...PASSPORT_DISCIPLINES]
    .sort((a, b) => disciplineOrder(a.code) - disciplineOrder(b.code))
    .map((d) => ({
      id: `sc-${d.code}`,
      code: d.code,
      codeLabel: d.label,
      identification: d.mn,
      leader: '',
      specialist: '',
      fileName: buildScopeFileName(startDate, projectName, d.code),
    }));
}

/* ---------------- 1.3 Төслийн хугацаа ---------------- */

/** ⚠️ `tl-start` / `tl-finish` / `tl-ext` id-ууд АЧААЛАЛ ҮҮРСЭН: сервер
 *  тэднээр `start_date` / `finish_date` / `extension_date` БАГАНА-г бөглөнө
 *  (`routes/projects.ts`-ийн passport upsert), тэдгээрийг `deadlines.ts` ба
 *  `company.ts` SQL-ээр уншдаг.  Id-г бүү сольж бич — шошгыг өөрчлөх нь
 *  аюулгүй.  Жишиг баримт дээр Extension мөр ХОЁР байдаг тул хоёр дахийг
 *  нь хэрэглэгч өөрөө нэмнэ; сервер `extension_date` баганад ОГНООТОЙ
 *  СҮҮЛИЙН `tl-ext*` мөрийг бичнэ. */
export function defaultTimelineRows(): ProjectTimelineRow[] {
  return [
    { id: 'tl-start', labelEn: 'Start', labelMn: 'Эхлэх', date: '' },
    { id: 'tl-finish', labelEn: 'Finish', labelMn: 'Дуусах', date: '' },
    { id: 'tl-ext', labelEn: 'Extension', labelMn: 'Сунгалт', date: '' },
  ];
}

export function blankTimelineRow(): ProjectTimelineRow {
  // Шинэ мөр нь `tl-ext…` угтвартай — сервер ЭХНИЙ сунгалтыг л баганад
  // бичдэг тул нэмэлт сунгалтууд зөвхөн хүснэгтэд амьдарна.
  return { id: rowId('tl-ext'), labelEn: 'Extension', labelMn: 'Сунгалт', date: '' };
}

/** Шинэ төслийн 1.3 — гурван мөр бүгд ӨНӨӨДРӨӨР бөглөгдсөн (эзний хүсэлт
 *  2026-09-25), хэрэглэгч зөвхөн цифрээ солино.
 *
 *  ⚠️ Зөвхөн ХАРАГДАХ утга.  Дуусах/Сунгалтыг засаагүй бол хадгалахад ХООСОН
 *  илгээнэ (`dropUntouchedPrefill`) — «Дуусах = өнөөдөр» хадгалагдвал төсөл
 *  маргаашнаас хугацаа хэтэрсэн болж, жинхэнэ огноо руу хойшлуулахад 409
 *  `EXTENSION_REQUIRED` гарна (эзний шийдвэр 2026-09-25). */
export function prefilledTimelineRows(today: string): ProjectTimelineRow[] {
  return defaultTimelineRows().map((r) => ({ ...r, date: today }));
}

/** `prefilledTimelineRows`-ийн утгыг хэрэглэгч ХӨНДӨӨГҮЙ хэвээр байгаа
 *  Дуусах/Сунгалтын огноог хоосолно.  Эхлэх нь өнөөдрөөрөө хадгалагдана. */
export function dropUntouchedPrefill(
  rows: ProjectTimelineRow[],
  untouched: ReadonlySet<string>,
): ProjectTimelineRow[] {
  return rows.map((r) =>
    r.id !== 'tl-start' && untouched.has(r.id) ? { ...r, date: '' } : r,
  );
}

/** Уулзалтын хуваарь: 10 / 40 / 80 / 100 % (эзний хүсэлт 2026-09-25;
 *  өмнө нь жишиг баримтын 30 / 60 / 90 / 100 байсан). */
export function defaultMeetingRows(): ProjectMeetingRow[] {
  return [
    { id: 'mt-10', label: '10%', date: '' },
    { id: 'mt-40', label: '40%', date: '' },
    { id: 'mt-80', label: '80%', date: '' },
    { id: 'mt-100', label: '100%', date: '' },
  ];
}

export function blankMeetingRow(): ProjectMeetingRow {
  return { id: rowId('mt'), label: '', date: '' };
}

/** `<input type="date">` нь ЗӨВХӨН `YYYY-MM-DD` уншдаг.  Продакшнд
 *  `extension_date` нь `2026.07.09` хэлбэрээр бичигдсэн мөр байгаа (хуучин
 *  UI-д энэ талбар чөлөөт ТЕКСТ байсан) — хөрвүүлэхгүй бол нүд ХООСОН
 *  харагдаж, «сунгалт байхгүй» гэж худал мэдээлнэ.  Танихгүй хэлбэрийг
 *  ХЭВЭЭР буцаана: өгөгдөл алдагдахаас хоосон нүд дээр.  */
export function toIsoDate(v: string | null | undefined): string {
  const s = (v ?? '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{4})[./](\d{1,2})[./](\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`;
  return s;
}

type LegacyDates = {
  start_date: string | null;
  finish_date: string | null;
  extension_date: string | null;
};

/** Хуучин паспортын 1.3 (гурван багана) → хүснэгтийн мөр.  Зөвхөн
 *  `timeline` хоосон үед хэрэглэнэ — 0247-оос ӨМНӨХ төслүүдийн нөхөлт. */
export function timelineFromLegacyDates(p: LegacyDates): ProjectTimelineRow[] {
  const dates = [p.start_date, p.finish_date, p.extension_date];
  return defaultTimelineRows().map((r, i) => ({ ...r, date: toIsoDate(dates[i]) }));
}

/** ⚠️ ЗААВАЛ: хадгалагдсан 1.3 хүснэгтийн ХООСОН огноог баганаас нөхнө.
 *
 *  `start_date` / `finish_date` баганыг ХОЁР route бичдэг бөгөөд тэд
 *  хоорондоо синк хийдэггүй:
 *    • `routes/timeline.ts`-ийн «Хуваарь» цонх — ЗӨВХӨН баганыг бичнэ,
 *      `timeline_json`-д хүрдэггүй;
 *    • `routes/projects.ts`-ийн паспорт — `timeline_json`-оос гаргаж аваад
 *      баганыг дарж бичнэ.
 *  Нэгтгэхгүй бол: шидтэнгээр үүсгэсэн төсөл огноогүй 3 мөртэй JSON-той
 *  болно → Timeline хуудаснаас хуваарь тавина → «Мэдээлэл» таб 1.3-ыг
 *  ХООСОН харуулна → өөр талбар засаад хадгалахад сервер баганыг NULL
 *  болгож, төсөл `deadlines.ts` / `company.ts`-ийн хугацааны хяналтаас
 *  чимээгүй унана.  Нэгтгэсний дараа тэр огноо буцаад бичигдэнэ.
 *
 *  Хэрэглэгч нүдийг ЗОРИУД цэвэрлэвэл: хадгалахад багана NULL болж,
 *  дараагийн ачаалалт дээр нөхөх зүйл байхгүй тул хоосон хэвээр үлдэнэ. */
export function mergeTimelineWithLegacy(
  rows: ProjectTimelineRow[],
  p: LegacyDates,
): ProjectTimelineRow[] {
  const legacy: Record<string, string> = {
    'tl-start': toIsoDate(p.start_date),
    'tl-finish': toIsoDate(p.finish_date),
  };
  let extUsed = false;
  return rows.map((r) => {
    const iso = toIsoDate(r.date);
    if (iso) return iso === r.date ? r : { ...r, date: iso };
    // Эхний ЗАСВАРЛААГҮЙ сунгалтын мөрөнд л хуучин баганыг тавина.
    if (!extUsed && r.id.startsWith('tl-ext')) {
      extUsed = true;
      const ext = toIsoDate(p.extension_date);
      return ext ? { ...r, date: ext } : r;
    }
    const fill = legacy[r.id];
    return fill ? { ...r, date: fill } : r;
  });
}

/** Хадгалагдсан 1.2 мөрийн шошгыг кодоос нөхнө — `ScopeRowsEditor`-ийн
 *  оролт нь хяналттай (controlled) тул `value`-д нөхөлтийн гинж тавьж
 *  болохгүй (нүд цэвэрлэгдэхгүй болно). */
export function fillScopeCodeLabels(rows: ProjectScopeRow[]): ProjectScopeRow[] {
  return rows.map((r) =>
    r.codeLabel || !r.code ? r : { ...r, codeLabel: DISCIPLINE_LABEL_MN[r.code] ?? r.code },
  );
}

/** Серверээс ирсэн паспорт → баримт дээр харуулах хэлбэр.  «Мэдээлэл» таб
 *  (`ProjectInfoTab`) ба хэвлэх хуудас (`PassportPrintPage`) ХОЁУЛАА үүгээр
 *  дамжина — эс бөгөөс хэвлэсэн 1.3 нь дэлгэцийнхээс өөр огноо харуулна
 *  (`mergeTimelineWithLegacy`-ийн тайлбарыг үз). */
export function passportForDisplay(p: ProjectPassport): ProjectPassport {
  return {
    ...p,
    client_contacts: p.client_contacts ?? [],
    scope_rows: fillScopeCodeLabels(p.scope_rows ?? []),
    timeline: p.timeline?.length ? mergeTimelineWithLegacy(p.timeline, p) : timelineFromLegacyDates(p),
    meetings: p.meetings ?? [],
  };
}
