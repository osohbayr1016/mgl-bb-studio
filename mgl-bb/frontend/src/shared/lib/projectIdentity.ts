/**
 * Төслийн БАРИМТЖУУЛСАН ХУВИЙН МЭДЭЭЛЭЛ — нэг цорын ганц resolver.
 *
 * ⚠️ ЭНЭ ФАЙЛ БОЛ `backend/src/lib/projectIdentity.ts`-ИЙН БАЙНГЫН
 * ХОСЛОЛ (twin).  ХОЁУЛАНГ НЬ ЗЭРЭГ ӨӨРЧИЛНӨ.  Зөрвөл сервер талын PDF
 * (`lib/clientReport.ts`, MCP `generate_report`) болон вэб дээрх «1. Төслийн
 * танилцуулга» ӨӨР ӨӨР гарчиг, ӨӨР ӨӨР шифр хэвлэнэ — эзэн нь яг үүнийг
 * 2026-09-02-нд гомдоллосон.  (`lib/textFold.ts` ↔ `shared/lib/search/
 * normalize.ts` хосын хэв маягтай ижил.)
 *
 * ЯАГААД ХЭРЭГТЭЙ ВЭ:
 *   Төслийн «албан ёсны» өгөгдөл нь ГУРВАН эх сурвалжид тархсан —
 *   `project_passport` (0246/0247), `projects` багана, `project_clients`.
 *   Хаана нь юу ялахыг өнөөдөр 4 газар тус тусдаа бичсэн байгаа тул
 *   тэд бие биетэйгээ зөрдөг.  Энэ файл нь ТЭР ШАТЛАЛЫГ нэгтгэнэ.
 *
 * ⚠️ ШАТЛАЛЫГ ЭНД ЗОХИОГООГҮЙ.  Эзний 2026-09-02-ны шийдвэрийг агуулсан
 * ажиллаж буй хувилбар нь `frontend/src/features/performance-reports/lib/
 * introAuto.ts:57-150` — үүнийг ҮГЧЛЭН хуулсан.  Ганцхан ЗӨРҮҮ:
 * `title`-д `display_title` НЭМЭГДСЭН (доорх тайлбарыг үз).
 */

/* ============================================================
 *  Мөрийн төрлүүд
 * ============================================================
 *  Frontend талд эдгээр нь `@/shared/types`-д аль хэдийн зарлагдсан
 *  (тэндээс паспортын API хариу мөн уншигддаг) тул ДАХИН зарлахгүй,
 *  зөвхөн дамжуулан гаргана.  Backend хос нь `lib/` → `routes/` импорт
 *  хийж чадахгүй учир өөр дээрээ зарладаг — талбарууд нь ЯГ ИЖИЛ. */
import type {
  ProjectScopeRow,
  ProjectTimelineRow,
  ProjectMeetingRow,
} from '@/shared/types';

export type { ProjectScopeRow, ProjectTimelineRow, ProjectMeetingRow };

/* ============================================================
 *  Дисциплины лавлах
 * ============================================================
 *  ⚠️ `frontend/src/features/performance-reports/types/introOverride.ts`-ийн
 *  `INTRO_DISCIPLINES`-ийн ХУУЛБАР.  Тэр нь `features/` дотор амьдардаг
 *  тул `lib/`-ээс ч, `shared/`-оос ч импортлож болохгүй (давхаргын
 *  дараалал).  Шинэ дисциплин нэмэхэд ГУРВУУЛАНГ нь шинэчил. */
const IDENTITY_DISCIPLINES: ReadonlyArray<{ code: string; mn: string; label: string }> = [
  { code: 'EZ', mn: 'Эскиз зураг', label: 'ЭЗ' },
  { code: 'ET', mn: 'Орчны ЕТ, өндөржилт', label: 'ЕТ' },
  { code: 'BA', mn: 'Барилга архитектур', label: 'БА' },
  { code: 'BB', mn: 'Барилга бүтээц', label: 'ББ' },
  { code: 'HAS', mn: 'Халаалт агаар сэлгэлт', label: 'ХАС' },
  { code: 'TSBU', mn: 'Дотор цэвэр бохир ус', label: 'ЦБУ' },
  { code: 'TSAH', mn: 'Дотор цахилгаан', label: 'ЦАХ' },
  { code: 'HD', mn: 'Дотор холбоо дохиолол', label: 'ХД' },
  { code: 'AU', mn: 'Автоматжуулалт', label: 'АУ' },
  { code: 'IZ', mn: 'Интерьер зураг', label: 'ИЗ' },
  { code: 'GT', mn: 'Гадна тохижилт', label: 'ГТ' },
];

const DISCIPLINE_LABEL = new Map(IDENTITY_DISCIPLINES.map((d) => [d.code, d.label]));
const DISCIPLINE_MN = new Map(IDENTITY_DISCIPLINES.map((d) => [d.code, d.mn]));
const DISCIPLINE_ORDER = new Map(IDENTITY_DISCIPLINES.map((d, i) => [d.code, i]));
const orderOf = (code: string): number => DISCIPLINE_ORDER.get(code) ?? 999;

/** Паспортын 1.3 хүснэгт огт байхгүй үеийн гурван мөр.
 *  ⚠️ `introOverride.ts`-ийн `DEFAULT_TIMELINE`-ийн хуулбар. */
const IDENTITY_DEFAULT_TIMELINE: ReadonlyArray<Omit<ProjectTimelineRow, 'date'>> = [
  { id: 'tl-start', labelEn: 'Start', labelMn: 'Эхлэх' },
  { id: 'tl-finish', labelEn: 'Finish', labelMn: 'Дуусах' },
  { id: 'tl-ext', labelEn: 'Extension', labelMn: 'Сунгалт' },
];

/* ============================================================
 *  Оролт
 * ============================================================ */

/** Паспортын мөр — БҮХ талбар нь заавал биш.  24 төслийн 15-д нь л
 *  паспорт байдаг тул `null` бол хэвийн зүйл (алдаа БИШ). */
export interface PassportLike {
  full_title?: string | null;
  drawing_no?: string | null;
  doc_no?: string | null;
  scope?: string | null;
  director?: string | null;
  start_date?: string | null;
  finish_date?: string | null;
  extension_date?: string | null;
  disciplines?: string[] | null;
  scope_rows?: ProjectScopeRow[] | null;
  timeline?: ProjectTimelineRow[] | null;
  meetings?: ProjectMeetingRow[] | null;
  /** @deprecated 0247-оос өмнөх уулзалтын хуваарь — нөхөлтийн зам. */
  meeting_30?: string | null;
  /** @deprecated */
  meeting_50?: string | null;
  /** @deprecated */
  meeting_100?: string | null;
}

export interface ProjectLike {
  id: number;
  name: string;
  /** Толгойн урт гарчиг (миграц 0089). */
  display_title?: string | null;
  location?: string | null;
}

/** Багийн хуваарийн нэг мөр — 1.2-ын НӨХӨЛТИЙН зам.
 *  ⚠️ `leaderName` нь АЛЬ ХЭДИЙН харагдах хэлбэрт (Нэр Овог) шилжсэн байна.
 *  `formatDisplayName` нь frontend-ийн туслах тул resolver дотор
 *  давтахгүй — дуудагч бэлдэж өгнө. */
export interface TeamShareLike {
  team_code: string;
  team_name_mn?: string | null;
  leaderName?: string | null;
}

export interface ProjectIdentityInput {
  project: ProjectLike;
  /** ⚠️ `null` байж БОЛНО — талбар бүр эвдрэлгүй буурна. */
  passport?: PassportLike | null;
  /** `project_clients` мөрүүд.  ⚠️ Паспортад захиалагчийн БАГАНА БАЙХГҮЙ —
   *  энэ нь санаатай (introAuto.ts:62).  Битгий «зас». */
  clients?: ReadonlyArray<{ name: string }> | null;
  /** `project_team_shares` × `teams` — паспортын 1.2 хоосон үеийн нөхөлт. */
  teamShares?: ReadonlyArray<TeamShareLike> | null;
  /** Файлын нэрийн YYMMDD-ийн нөхөх утга (ISO).  Тест давтагдахуйц байх
   *  үүднээс дуудагч өгч болно; өгөхгүй бол өнөөдөр. */
  today?: string;
}

/* ============================================================
 *  Гаралт
 * ============================================================ */

export interface ProjectIdentity {
  projectId: number;
  /** Албан ёсны УРТ гарчиг. */
  title: string;
  /** `projects.name` — богино, кодтой нэр. */
  shortName: string;
  /** Зургийн шифр. */
  drawingNo: string;
  /** Doc. No. */
  docNo: string;
  scope: string;
  director: string;
  clientName: string;
  location: string;
  disciplines: string[];
  scopeRows: ProjectScopeRow[];
  timeline: ProjectTimelineRow[];
  meetings: ProjectMeetingRow[];
  startDate: string | null;
  finishDate: string | null;
  extensionDate: string | null;
  /** Паспортын мөр ЖИНХЭНЭЭР байсан эсэх — «дутуу бөглөсөн» сэрэмжлүүлэгт. */
  hasPassport: boolean;
}

/* ============================================================
 *  Огнооны цэвэрлэгээ — ЦОРЫН ГАНЦ хувилбар
 * ============================================================
 *  Паспортын огооны багана нь БАТАЛГААЖААГҮЙ чөлөөт текст: production-д
 *  `'-'` ба `'2026.07.09'` бодитоор байдаг (хуучин UI-д эдгээр нь
 *  `<input type="text">` байсан).
 *
 *  ⚠️ ЭНЭ ЦЭВЭРЛЭГЭЭ ӨНӨӨДӨР ГУРВАН ГАЗАР ДАВХАРДСАН байгаа:
 *    - `backend/src/routes/timeline.ts:143-146`  (`isoOrNull`)
 *    - `backend/src/routes/ticker.ts:225-227`    (JS талд шүүх)
 *    - `frontend/src/features/projects/components/passport/
 *       passportSections.ts:185-197`             (`toIsoDate`)
 *  Тэднийг ЭНД НЭГТГЭЭГҮЙ — тэр гурав нь энэ ажлын хамрах хүрээнээс
 *  ГАДУУР (өөр агентын файлууд).  Шинэ дуудагч бүр ЭНЭ функцийг
 *  хэрэглэнэ; тэр гурвыг дараагийн цэвэрлэгээгээр энэ рүү шилжүүлнэ.
 *
 *  Дүрэм: `YYYY.MM.DD` / `YYYY/M/D` → ISO болгоно; ISO бол хэвээр;
 *  бусад бүхэн (`'-'`, `''`, хог) → `null`.  `passportSections.toIsoDate`
 *  нь танихгүй утгыг ХЭВЭЭР буцаадаг (өгөгдөл алдахгүйн тулд) — энд
 *  `null` буцаана, учир нь гаралт нь ЖИНХЭНЭ огноо гэж амласан талбар. */
export function normalisePassportDate(v: string | null | undefined): string | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{4})[./](\d{1,2})[./](\d{1,2})$/.exec(s);
  if (!m) return null;
  const [, y, mo, d] = m;
  return `${y}-${(mo ?? '').padStart(2, '0')}-${(d ?? '').padStart(2, '0')}`;
}

/** `240918_MAX_URGUU_BA_A` хэлбэрийн файлын нэр.
 *  YYMMDD нь төслийн эхлэх огноо (байхгүй бол `today`).
 *  ⚠️ `introAuto.ts:157-167`-ийн `teamFileName`-ийн үгчилсэн хуулбар. */
function teamFileName(
  startDate: string | null,
  projectName: string,
  teamCode: string,
  today: string,
): string {
  const src = startDate ?? today;
  const fileBase = src.replace(/-/g, '').slice(2, 8);
  const projSlug =
    (projectName || 'PROJECT')
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toUpperCase()
      .slice(0, 24) || 'PROJECT';
  return `${fileBase}_${projSlug}_${teamCode}_A`;
}

const str = (v: string | null | undefined): string => (typeof v === 'string' ? v : '');

/**
 * Төсөл + паспорт + захиалагч + баг → нэг бүрэн «хувийн мэдээлэл».
 *
 * Паспорт байхгүй ч ХЭЗЭЭ Ч алдаа шидэхгүй — талбар бүр хоосон мөр /
 * хоосон массив / `null` руу буурна.
 */
export function resolveProjectIdentity(input: ProjectIdentityInput): ProjectIdentity {
  const { project } = input;
  const passport = input.passport ?? null;
  const today = input.today ?? new Date().toISOString().slice(0, 10);

  /* ---------- 1.1 гарчиг ----------
   * ⚠️ ГУРВАН ШАТ: паспортын албан ёсны нэр → `projects.display_title` →
   * `projects.name`.
   *
   * ⚠️ `introAuto.ts:61` нь ӨНӨӨДӨР дунд шатыг АЛГАСДАГ атал
   * `lib/clientReportHtml.ts:167` нь оруулдаг — тиймээс вэб дээрх §1 ба
   * захиалагчийн PDF хоёр ӨНӨӨДӨР зөрдөг.  Жишээ нь 57-р төсөл:
   * `display_title = "MGL-260804 Хүй долоон худаг-Стадион_AZ"`, паспорт
   * нь БАЙХГҮЙ — PDF нь урт нэрийг, вэб нь богино `name`-ийг хэвлэдэг.
   * `display_title`-ийг оруулах нь ЗӨВ канон (эзэн тэр нэрийг гараар
   * бичсэн байдаг), тиймээс энд оруулав. */
  const title = str(passport?.full_title) || str(project.display_title) || project.name;

  /* ---------- Захиалагч ----------
   * ⚠️ Паспортад захиалагчийн БАГАНА БАЙХГҮЙ — санаатай.  Эх сурвалж нь
   * зөвхөн `project_clients` (introAuto.ts:62).  Битгий «нөх». */
  const clientName = (input.clients ?? []).map((c) => `"${c.name}"`).join(', ');

  /* ---------- Огноо (гурван багана) ---------- */
  const startDate = normalisePassportDate(passport?.start_date);
  const finishDate = normalisePassportDate(passport?.finish_date);
  const extensionDate = normalisePassportDate(passport?.extension_date);

  /* ---------- 1.2 Хамрах хүрээ ----------
   * ⚠️ ЭХ СУРВАЛЖИЙН ДАРААЛАЛ (эзний шийдвэр 2026-09-02):
   *   1) паспортад ХАДГАЛСАН 1.2 («Мэдээлэл» хуудас) — ЯЛНА
   *   2) байхгүй бол багийн хуваарь + багийн ахлахаас гаргаж авна
   * Хоёр дахь нь 0247-оос ӨМНӨХ төслүүдийн нөхөлт зам. */
  const derivedScopeRows: ProjectScopeRow[] = (input.teamShares ?? [])
    .map((t) => ({
      id: `sc-${t.team_code}`,
      code: t.team_code,
      codeLabel: DISCIPLINE_LABEL.get(t.team_code) || t.team_code,
      identification: DISCIPLINE_MN.get(t.team_code) || str(t.team_name_mn),
      leader: str(t.leaderName),
      // Багаас гаргаж авах замд «Хариуцсан мэргэжилтэн» мэдээлэл БАЙХГҮЙ —
      // тэр нь зөвхөн паспортын 1.2-т гараар бичигддэг.
      specialist: '',
      fileName: teamFileName(startDate, project.name, t.team_code, today),
    }))
    .sort((x, y) => orderOf(x.code) - orderOf(y.code));
  const scopeRows: ProjectScopeRow[] = passport?.scope_rows?.length
    ? passport.scope_rows
    : derivedScopeRows;

  /* ---------- 1.3 Хугацаа ----------
   * Паспортын 1.3 хүснэгт ЯЛНА; байхгүй бол гурван БАГАНА-аас барина.
   * ⚠️ Хүснэгтийн мөрүүдийн `date`-ыг цэвэрлэхгүй ҮЛДЭЭНЭ — тэр нь
   * хэрэглэгчийн гараар бичсэн хүснэгт, харагдацаа өөрөө хариуцна.
   * Зөвхөн БАГАНА-аас гаргасан нөхөлтийн мөрүүд цэвэрлэгдэнэ. */
  const columnDates: ReadonlyArray<string | null> = [startDate, finishDate, extensionDate];
  const timeline: ProjectTimelineRow[] = passport?.timeline?.length
    ? passport.timeline
    : IDENTITY_DEFAULT_TIMELINE.map((row, i) => ({ ...row, date: columnDates[i] ?? '' }));

  /* ---------- 1.3 Хэлэлцүүлгийн хуваарь ----------
   * Паспортын 1.3 баруун хүснэгт → хуучин `meeting_30/50/100` багана.
   * ⚠️ `introAuto.ts:124` дээр эдгээрийн ӨМНӨ тайлангийн ӨӨРИЙН
   * `status_meetings` шат байдаг — тэр нь ТАЙЛАНГИЙН өгөгдөл, төслийн
   * хувийн мэдээлэл БИШ, тиймээс энд ОРООГҮЙ.  Тайлан нь энэ гаралтын
   * ДЭЭР өөрийнхөө шатыг давхарлана. */
  const meetings: ProjectMeetingRow[] = passport?.meetings?.length
    ? passport.meetings
    : (
        [
          ['30%', passport?.meeting_30],
          ['50%', passport?.meeting_50],
          ['100%', passport?.meeting_100],
        ] as const
      ).map(([label, date], i) => ({ id: `mt-${i}`, label, date: str(date) }));

  return {
    projectId: project.id,
    title,
    shortName: project.name,
    drawingNo: str(passport?.drawing_no),
    docNo: str(passport?.doc_no),
    scope: str(passport?.scope),
    director: str(passport?.director),
    clientName,
    /* ⚠️ Байршил нь ПАСПОРТААС ИРДЭГГҮЙ — `projects.location` (introAuto.ts:144).
     * Паспортад тийм багана байхгүй; битгий «зас». */
    location: str(project.location),
    disciplines: passport?.disciplines ?? [],
    scopeRows,
    timeline,
    meetings,
    startDate,
    finishDate,
    extensionDate,
    hasPassport: passport !== null,
  };
}
