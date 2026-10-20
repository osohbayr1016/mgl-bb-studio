/* =============================================================
 * «1. Төслийн танилцуулга» блокийн АВТО загвар.
 * -------------------------------------------------------------
 * Танилцуулгын хуудсанд харагдах бүх утга ЭНД нэг л газар
 * тооцоологдоно (паспорт + төсөл + баг + хэрэглэгч + бичиг
 * баримт).  Урьдчилан харах, хэвлэх хуудас, PDF — гурвуулаа
 * үүнийг дуудна, тиймээс гурав хоорондоо хэзээ ч зөрөхгүй.
 *
 * Дараа нь `resolveIntroModel(override, auto)` хэрэглэгчийн
 * засварыг үүн ДЭЭР давхарлана (`undefined` талбар = авто ялна).
 *
 * ЧУХАЛ: файлын нэрийн (`fileName`) логик урьд нь
 * PerformanceReportPreview.tsx болон PerformanceReportPrintPage.tsx
 * ХОЁУЛАНД нь ХУУЛБАРЛАГДСАН байсан (`buildTeamScopes`).  Хоёр
 * хуулбар нь зөрөх эрсдэлтэй тул энд НЭГТГЭВ — дахин бүү салга.
 * ============================================================= */

import type {
  ProjectDetailResponse,
  ProjectPassport,
  ProjectClientDocument,
  Team,
  User,
} from '@/shared/types';
import type {
  TeamSnapshotItem,
  StatusMeeting,
} from '@/features/performance-reports/types/performanceReport';
import {
  DEFAULT_TIMELINE,
  DISCIPLINE_LABEL,
  DISCIPLINE_MN,
  INTRO_DISCIPLINES,
  type IntroAuto,
  type IntroDocRow,
  type IntroMeetingRow,
  type IntroScopeRow,
  type IntroTimelineRow,
} from '@/features/performance-reports/types/introOverride';
import { formatDisplayName } from '@/shared/lib/formatting';
import { resolveProjectIdentity } from '@/shared/lib/projectIdentity';

export interface BuildIntroAutoArgs {
  project: ProjectDetailResponse;
  passport: ProjectPassport;
  documents: ProjectClientDocument[];
  teams: Team[];
  users: User[];
  effectiveTeams: TeamSnapshotItem[];
  statusMeetings: StatusMeeting[];
}

/** Дисциплины жишиг дараалал (INTRO_DISCIPLINES).  Жагсаалтад
 *  байхгүй код хойно нь үлдэнэ — өгөгдөл алдагдуулахгүй. */
const DISCIPLINE_ORDER = new Map(INTRO_DISCIPLINES.map((d, i) => [d.code, i]));
const orderOf = (code: string): number => DISCIPLINE_ORDER.get(code) ?? 999;

export function buildIntroAuto(a: BuildIntroAutoArgs): IntroAuto {
  const { project, passport, documents, teams, users, effectiveTeams, statusMeetings } = a;

  /* ---------- 1.1 паспортын талбарууд ----------
   * ⚠️ ЭНД ШАТЛАЛ БИТГИЙ БИЧ.  Гарчиг / захиалагч / шифр / Doc. No. /
   * цар хүрээ / байршил / захирал — долоон талбарын эх сурвалжийн
   * дараалал `shared/lib/projectIdentity.ts`-д НЭГТГЭГДСЭН, түүний
   * сервер талын хос (`backend/src/lib/projectIdentity.ts`) нь
   * захиалагчийн PDF-ийг тэжээдэг.  Энд `??` гинж дахин ургавал вэб ба
   * PDF хоёр ДАХИН зөрнө — 2026-09-02-нд эзэн яг үүнд гомдоллосон.
   *
   * ⚠️ ЗАН ТӨЛӨВИЙН ЦОРЫН ГАНЦ ӨӨРЧЛӨЛТ (2026-09-03): гарчгийн шатлалд
   * `projects.display_title` НЭМЭГДЭВ (паспортын `full_title`-ийн ДАРАА,
   * `projects.name`-ийн ӨМНӨ).  `lib/clientReportHtml.ts:167` үүнийг
   * үргэлж уншиж ирсэн атал вэб дээрх §1 алгасдаг байсан тул паспортгүй
   * ч урт гарчигтай төслүүд (жишээ нь 57-р төсөл) хоёр өөр нэрээр
   * хэвлэгддэг байв.
   *
   * ⚠️ Resolver-ийн `scopeRows` / `timeline` / `meetings` гаралтыг ЭНД
   * ХЭРЭГЛЭХГҮЙ — доорх гурван шатлал нь ТАЙЛАНГИЙН өөрийн эх
   * сурвалжуудыг (статус-уулзалт, хуучин `meeting_30/50/100`) агуулдаг
   * бөгөөд огноог ЦЭВЭРЛЭДЭГГҮЙ.  Эквивалентын шалгалтыг тэдгээрийн
   * дээрх тайлбарт бичив. */
  const identity = resolveProjectIdentity({
    project: project.project,
    passport,
    clients: project.clients,
  });

  const projectTitle = identity.title;
  const clientName = identity.clientName;
  const contact = passport.client_contacts?.[0];
  const ceo = contact
    ? [formatDisplayName(contact.full_name), contact.position ? `(${contact.position})` : '']
        .filter(Boolean)
        .join(' ')
    : '';

  /* ---------- Бичиг баримт ---------- */
  const docs: IntroDocRow[] = documents.map((d) => ({
    id: `doc-${d.id}`,
    name: d.doc_name,
    no: d.doc_no ?? '',
    date: d.doc_date ?? '',
    description: d.description ?? d.source ?? '',
  }));

  /* ---------- 1.2 Хамрах хүрээ ----------
   * ⚠️ ЭНЭ ШАТЛАЛЫГ БИТГИЙ ӨӨРЧИЛ.  `resolveProjectIdentity` нь үүнийг
   * ҮГЧЛЭН давтдаг (`derivedScopeRows`) — ялгаа нь зөвхөн ОРОЛТЫН хэлбэр:
   * тэнд ахлахын нэр (`leaderName`) бэлдэгдсэн ирдэг, энд `teams` ×
   * `users`-аас олдог.  Гаралт нь мөр мөрөөрөө ижил тул энд resolver
   * рүү шилжүүлэх шаардлагагүй (2026-09-03-нд 24 төсөл дээр тулгав).
   *
   * ⚠️ ЭХ СУРВАЛЖИЙН ДАРААЛАЛ (эзний шийдвэр 2026-09-02):
   *   1) төслийн паспортад ХАДГАЛСАН 1.2 («Мэдээлэл» хуудас) — ЯЛНА
   *   2) байхгүй бол багийн хуваарь + багийн ахлахаас гаргаж авна
   * Хоёр дахь нь 0247-оос ӨМНӨХ төслүүдийн нөхөлт зам.  Тайлангийн
   * дотоод override нь дараа нь эдгээрийн ДЭЭР давхарлагдана. */
  const derivedScopeRows: IntroScopeRow[] = effectiveTeams
    .map((t) => {
      const team = teams.find((tt) => tt.id === t.team_id);
      const leader =
        team?.lead_user_id != null ? (users.find((u) => u.id === team.lead_user_id) ?? null) : null;
      return {
        id: `sc-${t.team_code}`,
        code: t.team_code,
        codeLabel: DISCIPLINE_LABEL[t.team_code] || t.team_code,
        identification: DISCIPLINE_MN[t.team_code] || t.team_name_mn,
        leader: leader ? formatDisplayName(leader.full_name) : '',
        // Багаас гаргаж авах замд «Хариуцсан мэргэжилтэн» мэдээлэл БАЙХГҮЙ —
        // тэр нь зөвхөн паспортын 1.2-т гараар бичигддэг.
        specialist: '',
        fileName: teamFileName(passport, project.project.name, t.team_code),
      };
    })
    .sort((x, y) => orderOf(x.code) - orderOf(y.code));
  const scopeRows: IntroScopeRow[] = passport.scope_rows?.length
    ? passport.scope_rows
    : derivedScopeRows;

  /* ---------- 1.3 Хугацаа ---------- */
  // Паспортын 1.3 хүснэгт ЯЛНА; байхгүй бол хуучин гурван баганаас.
  /* ⚠️ RESOLVER РУУ ЗОРИУД ШИЛЖҮҮЛЭЭГҮЙ.  `resolveProjectIdentity` нь
   * баганын огноог `normalisePassportDate`-ээр цэвэрлэдэг тул
   * production-д бодитоор байдаг `'-'` (37, 41-р төсөл) → `''` болно.
   * Тайлан нь паспортын бичсэн зүйлийг ЯГ ТЭР ХЭВЭЭР нь хэвлэх ёстой —
   * аль хэдийн ОЛГОГДСОН тайланг чимээгүй өөрчлөх эрсдэлтэй. */
  const dates = [passport.start_date, passport.finish_date, passport.extension_date];
  const timeline: IntroTimelineRow[] = passport.timeline?.length
    ? passport.timeline
    : DEFAULT_TIMELINE.map((row, i) => ({
        ...row,
        date: dates[i] ?? '',
      }));

  /* ---------- 1.3 Хэлэлцүүлгийн хуваарь ---------- */
  // Тайлангийн `status_meetings` нь эх сурвалж; хоосон бол хуучин
  // паспортын meeting_30/50/100-аас гурван мөр сэргээнэ (deprecated
  // талбарууд ч гэсэн хуучин төслүүд дээр өгөгдөлтэй хэвээр).
  /* Дараалал: тайлангийн ӨӨРИЙН `status_meetings` (тухайн тайланд
   * тохируулсан) → паспортын 1.3 уулзалтын хуваарь → хуучин
   * `meeting_30/50/100` багана.  Дунд шат нь 2026-09-02-нд нэмэгдсэн. */
  /* ⚠️ RESOLVER-ТЭЙ ЯЛГАА: энд ЭХНИЙ шат нь тайлангийн ӨӨРИЙН
   * `status_meetings` — тэр нь ТАЙЛАНГИЙН өгөгдөл тул төслийн хувийн
   * мэдээллийн resolver-т ОРООГҮЙ (projectIdentity.ts:278-283).  Үлдсэн
   * хоёр шат нь resolver-тэй үгчлэн ижил. */
  const meetings: IntroMeetingRow[] = statusMeetings.length
    ? statusMeetings.map((m, i) => ({
        id: `mt-${i}`,
        label: m.label || `${m.percent}%`,
        date: m.scheduled_at || '',
      }))
    : passport.meetings?.length
      ? passport.meetings
      : ([
        ['30%', passport.meeting_30],
        ['50%', passport.meeting_50],
        ['100%', passport.meeting_100],
      ] as const).map(([label, date], i) => ({ id: `mt-${i}`, label, date: date ?? '' }));

  return {
    projectTitle,
    clientName,
    drawingNo: identity.drawingNo,
    docNo: identity.docNo,
    scope: identity.scope,
    /* ⚠️ Байршил нь ПАСПОРТААС биш, `projects.location`-оос ирдэг —
     * resolver дотор тэр дүрэм бичигдсэн. */
    location: identity.location,
    director: identity.director,
    ceo,
    disciplines: passport.disciplines ?? [],
    documents: docs,
    scopeRows,
    timeline,
    meetings,
  };
}

/** `240918_MAX_URGUU_BA_A` хэлбэрийн файлын нэр.
 *  YYMMDD нь төслийн эхлэх огноо (байхгүй бол өнөөдөр). */
function teamFileName(passport: ProjectPassport, projectName: string, teamCode: string): string {
  const src = passport.start_date ?? new Date().toISOString().slice(0, 10);
  const fileBase = src.replace(/-/g, '').slice(2, 8);
  const projSlug =
    (projectName || 'PROJECT')
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toUpperCase()
      .slice(0, 24) || 'PROJECT';
  return `${fileBase}_${projSlug}_${teamCode}_A`;
}

/** Паспорт татагдаагүй / 404 үед хэрэглэх хоосон паспорт.
 *  (Preview ба Editor хоёулаа `retry:false`-той тул алдаа хэвийн зүйл.) */
export function emptyPassport(projectId: number): ProjectPassport {
  return {
    project_id: projectId,
    full_title: null,
    drawing_no: null,
    doc_no: null,
    scope: null,
    director: null,
    client_pm: null,
    start_date: null,
    finish_date: null,
    extension_date: null,
    meeting_30: null,
    meeting_50: null,
    meeting_100: null,
    disciplines: [],
    client_contacts: [],
    scope_rows: [],
    timeline: [],
    meetings: [],
    notes: null,
    updated_at: '',
    updated_by_id: null,
  };
}
