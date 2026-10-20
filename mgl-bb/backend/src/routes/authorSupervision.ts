/**
 * Зохиогчийн хяналт (Author's Supervision Report — ASR).
 *
 * Төсөл тус бүрийн талбайн хяналтын тайлангийн бүртгэл.  Талбай дээрх
 * инженер утаснаасаа бөглөж (камераар зураг, дэлгэц дээр гарын үсэг),
 * илгээнэ; админ эсвэл тухайн багийн ахлагч апп дотор батална.
 * `YYMMDD_PROJECT ID_ASR_BA_001.docx` Word загварыг орлоно.
 *
 * Мөчлөг нь `routes/progress.ts`-ийн толин тусгал:
 *     draft → submitted → approved | rejected
 * Төлөв солих бүр UPDATE нь `AND status = <хүлээгдэж буй>` нөхцөлтэй —
 * `meta.changes === 0` бол хоёр хүн зэрэг товшсон гэсэн үг → 409.
 *
 * Эрх:
 *   • client  — БҮХ endpoint дээр 403.  Энэ бол дотоод чанарын баримт;
 *     ноорог, `review_note`, талбайн түүхий тэмдэглэл захиалагчид
 *     харагдах ёсгүй.  (`correspondence.ts`-ийн canRead-ыг хуулбал
 *     захиалагч автоматаар хардаг болно — тэр нь алдаа болно.)
 *   • engineer / architect / senior — төслийн гишүүн бол бүртгэнэ.
 *     `engineer`-ийг ЗААВАЛ оруулна: талбай дээрх инженер бол энэ
 *     feature-ийн үндсэн хэрэглэгч (багийн тайлангийн
 *     requireRole('admin','architect','senior') gate-ыг хуулж БОЛОХГҮЙ).
 *   • Батлах — админ, эсвэл тайланд орсон багийн аль нэгний идэвхтэй
 *     `senior` гишүүн.
 *   • ЗАСАХ — зохиогч ӨӨРИЙН тайланг, АДМИН дурын тайланг ДУРЫН
 *     төлөвт (`submitted`, `approved` ч мөн адил; зохиогчийнх 2026-09-30-аас).  Админ илгээгдсэн
 *     материалыг хараад засаад ТЭГЭЭД батлах нь энэ модулийн үндсэн
 *     хяналтын урсгал (эзний шийдвэр, 2026-08-28) — дэлгэрэнгүйг
 *     `PATCH /:id`-ийн тайлбараас үз.
 */
import { Hono } from 'hono';
import { launchBrowser, type BrowserSession } from '../lib/browser';
import { allocateAndSubmit, asrFileStem, renumberAsrProject } from '../lib/asrNo';
import {
  ASR_CONTRACT_NO_MAX,
  ASR_NAME_MAX,
  asrLabelSql,
  asrProjectName,
} from '../lib/asrProjectName';
import {
  CLEAR_REPORT_CONTRACT_OVERRIDES_SQL,
  PROJECT_CONTRACT_SQL,
  planContractNoUpdate,
  resolveAsrContractNo,
} from '../lib/asrContractNo';
import { asrVisibleSql, canSeeAsrReport, type AsrViewer } from '../lib/asrVisibility';
import { personVisitsSql, teamPeopleSql } from '../lib/asrCompanions';
import { registerAsrCompanionRoutes } from '../lib/asrCompanionRoutes';
import { fillMeetingTeams, loadCompanions, replaceCompanions } from '../lib/asrCompanionStore';
import {
  MAX_MEETING_PARTICIPANTS,
  hasMeetingRequests,
  meetingPatch,
  parseMeetingDoc,
  parseMeetingRequests,
  sanitizeMeetingDoc,
  sanitizeMeetingRequests,
  usesMeetingForm,
} from '../lib/asrMeeting';
import {
  buildAsrProjectInfo,
  parseAsrProjectInfo,
  serialiseAsrProjectInfo,
  type AsrProjectInfo,
} from '../lib/asrProjectInfo';
import { CEO_USER_ID } from '../lib/ceo';
import { signToken } from '../lib/jwt';
import { isSingleSegmentMediaUrl } from '../lib/mediaUrl';
import { createNotification, createNotificationForReviewers } from '../lib/notify';
import { submitJob } from '../lib/speechmatics';
import { todayInUB } from '../lib/time';
import { isAdminRole } from '../types';
import { ASR_SUMMARY_VISIBLE_SQL, isAsrCreateEligible } from '../lib/asrEligible';
import {
  ASR_REPORT_TYPE_LABEL_MN,
  ASR_SITE_SQL,
  DEFAULT_ASR_REPORT_TYPE,
  isAsrReportType,
  meetingPlatformFor,
  parseAsrReportType,
  reportTypeProblem,
  requiresRedBook,
  type AsrReportType,
} from '../lib/asrReportType';
import {
  RED_BOOK_OK_SQL,
  redBookClearProblem,
  redBookProblem,
  redBookStatusOf,
} from '../lib/asrRedBook';
import { registerAsrTargetRoutes } from '../lib/asrTargets';
import { registerAsrVisitPlanRoutes } from '../lib/asrVisitPlanRoutes';
import type { Env, AppVariables } from '../types';

const router = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/* ------------------------------------------------------------------ */
/*  Төрөл                                                              */
/* ------------------------------------------------------------------ */

type AsrStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

/** «Бичиг баримтын төрөл» checkbox-ууд (Word загвараас). */
const DOC_KINDS = new Set([
  'planning', // Төлөвлөлт
  'progress', // Явц
  'report', // Тайлан
  'drawing', // Ажлын зураг
  'schedule', // Хуваарь
  'other', // Бусад
]);

/** Нэг тайланд хавсаргах зургийн дээд тоо. */
const MAX_PHOTOS = 20;

/**
 * Нэг тайланд хавсаргах дуу бичлэгийн дээд тоо.  Push-to-talk-ийн fallback
 * зам (нэг бүтэн контейнер үүсгэж чадахгүй хөтөч) сегмент бүрийг тусад нь
 * илгээдэг тул зурагтай ижил өгөөмөр хязгаар.  Хязгаар нь Speechmatics-ийн
 * тоолуурыг нэг тайлангаас хамгаалж байгаа хэрэг.
 */
const MAX_RECORDINGS = 20;

/**
 * Гараар засварласан транскриптийн тэмдэгтийн дээд хязгаар.  Талбайн
 * бичлэг нь секунд-минутын урттай тул бодит транскрипт хэдэн зуун
 * тэмдэгт байдаг; энэ хязгаар нь бичвэрийг таслах бус, эвдэрсэн
 * клиент D1 мөрийг хавдуулахаас хамгаалах хамгаалалт.
 */
const MAX_TRANSCRIPT_CHARS = 20_000;

interface AsrPhoto {
  url: string;
  name: string;
  /** Зургийн доорх тайлбар (0336-аас; хуучин мөрөнд байхгүй → ''). */
  caption: string;
  /**
   * Зургийг АВСАН огноо `YYYY-MM-DDTHH:mm:ss` (камерын ханын цаг, бүсгүй;
   * 2026-09-25-аас өмнөх утга секундгүй `…THH:mm`) —
   * клиент байршуулахаас өмнө эх файлын EXIF-ээс уншдаг
   * (`shared/lib/exifDate.ts`).  Сервер ЗӨВХӨН хэлбэрийг шалгаж хэвээр
   * хадгална; хуучин мөрөнд байхгүй → `null`, тэр үед UI тайлангийн
   * огноогоор нөхнө (`asr/photoStamp.ts`).  Миграц хэрэггүй — `photos_json`.
   */
  taken_at: string | null;
}

/** `AsrPhoto.taken_at` хэлбэр: `2026-09-21T14:35:09` (секунд сонголттой —
 *  зургийн тэмдэг секундтэй болсон 2026-09-25-аас өмнөх мөр `…T14:35`). */
const TAKEN_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;
const takenAtOf = (v: unknown): string | null =>
  typeof v === 'string' && TAKEN_AT_RE.test(v) ? v : null;

/** Зургийн тайлбарын тэмдэгтийн дээд хязгаар — баримт дээр 2-3 мөр. */
const MAX_CAPTION_CHARS = 500;

interface AsrTeamInput {
  team_id: number;
  work_note?: string | null;
}

/**
 * «Өмнөх тайлангийн асуудлыг бид ингэж шийдсэн» мөрийн оролт (0336).
 * `prev_report_id` нь ижил төслийн илгээгдсэн/батлагдсан тайлан байх ёстой;
 * `issue_text` нь тэр тайлангийн `defects`-ээс урьдчилан бөглөгдсөн ЦООНОГ
 * (хэрэглэгч тодорхой асуудал руу нарийсгаж засаж болно).
 */
interface AsrResolutionInput {
  prev_report_id?: number | null;
  issue_text?: string | null;
  resolution_text?: string | null;
}

/** Тайлангийн чөлөөт текстийн дээд хязгаар — D1 мөрийг хавдуулахаас хамгаална. */
const MAX_TEXT_CHARS = 20_000;

interface AsrRow {
  id: number;
  project_id: number;
  status: AsrStatus;
  author_id: number;
  photos_json: string | null;
  doc_types_json: string | null;
  /** 0396 — оффис уулзалтын хүсэлтийн хүснэгтүүд (`lib/asrMeeting.ts`). */
  meeting_requests_json?: string | null;
  /** 0398 — засварласан «Оролцогч тал» мөр, захиалагчийн байгууллага/албан тушаал. */
  meeting_doc_json?: string | null;
  red_book_photo_url?: string | null;
  red_book_verified_at?: string | null;
  red_book_absent?: number | null;
  [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/*  Цэвэрлэгч / баталгаажуулагч                                        */
/* ------------------------------------------------------------------ */

const norm = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
};

function isValidDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/**
 * `/media/<НЭГ СЕГМЕНТ>` хэлбэрийг ЗААВАЛ шаардана.
 *
 * Хоёр шалтгаан: (1) хавтастай түлхүүр (`email/…`, `revit-addin/…`) нь
 * `/media`-аар баталгаажуулалтгүй уншигдахаас сэргийлнэ; (2) гаднын
 * URL-ыг тайлан руу шургуулж, дараа нь хэвлэх хуудсаар дамжуулан
 * ачаалуулахаас сэргийлнэ.
 *
 * ⚠️ УРЬД ЭНД `/^\/media\/[^/]+$/` regex байсан бөгөөд «`routes/media.ts`
 * бол `GET /:key` — ЯГ нэг сегмент, тул хавтастай түлхүүр хэзээ ч
 * уншигдахгүй» гэсэн ХУДАЛ үндэслэлээр зөвтгөгдсөн байв.  Hono нь
 * `%2F`-ыг ЗАДАЛДАГ тул тэр нь үнэн биш; түүнчлэн regex өөрөө
 * `/media/a%2Fb.png`-ыг НЭВТРҮҮЛДЭГ байсан (түүхий мөрөнд `/` алга).
 * Шалгалт нь одоо `lib/mediaUrl.ts`-д, ЗАДАЛСАН утган дээр хийгддэг.
 */
function isMediaUrl(v: unknown): v is string {
  return isSingleSegmentMediaUrl(v);
}

/** `projects.ts`-ийн parseAttachments-тай ижил хэлбэр; хэзээ ч шидэхгүй. */
function parsePhotos(json: string | null): AsrPhoto[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((a) => a && typeof a === 'object' && typeof a.url === 'string')
      .map((a) => ({
        url: String(a.url),
        name: typeof a.name === 'string' ? a.name : '',
        caption: typeof a.caption === 'string' ? a.caption : '',
        taken_at: takenAtOf(a.taken_at),
      }));
  } catch {
    return [];
  }
}

function parseDocTypes(json: string | null): string[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.filter((k): k is string => typeof k === 'string' && DOC_KINDS.has(k));
  } catch {
    return [];
  }
}

/** Бичих үеийн зургийн цэвэрлэгээ.  Буруу байвал алдааны мөр буцаана. */
function sanitizePhotos(
  input: unknown,
): { ok: true; photos: AsrPhoto[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: 'photos must be an array' };
  if (input.length > MAX_PHOTOS) {
    return { ok: false, error: `Нэг тайланд дээд тал нь ${MAX_PHOTOS} зураг хавсаргана.` };
  }
  const photos: AsrPhoto[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const url = (raw as { url?: unknown }).url;
    if (!isMediaUrl(url)) return { ok: false, error: 'Invalid photo url' };
    const name = (raw as { name?: unknown }).name;
    const caption = (raw as { caption?: unknown }).caption;
    photos.push({
      url,
      name: typeof name === 'string' ? name.slice(0, 200) : '',
      caption: typeof caption === 'string' ? caption.trim().slice(0, MAX_CAPTION_CHARS) : '',
      taken_at: takenAtOf((raw as { taken_at?: unknown }).taken_at),
    });
  }
  return { ok: true, photos };
}

/** Чөлөөт текст: NULL эсвэл тайрсан мөр. */
function normText(v: unknown): string | null {
  const s = norm(v);
  return s ? s.slice(0, MAX_TEXT_CHARS) : null;
}

/** Гарын үсгийн URL: null эсвэл `/media/<key>`. */
function sanitizeSignatureUrl(v: unknown): { ok: true; url: string | null } | { ok: false } {
  if (v == null || v === '') return { ok: true, url: null };
  if (isMediaUrl(v)) return { ok: true, url: v };
  return { ok: false };
}

/* ------------------------------------------------------------------ */
/*  Эрхийн шалгалт                                                     */
/* ------------------------------------------------------------------ */

type Viewer = { sub: number; role: string };

/**
 * ЗХ тайлан бүртгэх/унших эрхтэй дүрүүд.  ЦАГААН ЖАГСААЛТ (хар биш):
 * ирээдүйд шинэ дүр нэмэгдвэл өгөгдмөлөөрөө ХААЛТТАЙ байна.
 *   • `client`  — энэ бол дотоод чанарын баримт (файлын толгойн тайлбар).
 *   • `worker`  — `lib/workerScope.ts`-ийн цагаан жагсаалтад
 *                 `author-supervision` байхгүй тул `/api` дээр хэзээ ч
 *                 энд хүрэхгүй; энэ Set нь тэр хамгаалалтын давхарлал.
 */
const ASR_ROLES = new Set(['admin', 'engineer', 'architect', 'senior']);

/**
 * Төсөл байгаа эсэх + үзэгч түүнд хандах эрхтэй эсэх.
 *
 * ⚠️ 2026-08-26: `project_members` ГИШҮҮНЧЛЭЛИЙН ШААРДЛАГЫГ ХАССАН.
 *    БҮҮ СЭРГЭЭ.  Шалтгаан нь загварын биш, ӨГӨГДЛИЙН:
 *
 *      • Прод дээр `project_members`-д НИЙТ 5 мөр байсан бөгөөд тав нь
 *        БҮГД `client` дүртэй (24 төслөөс зөвхөн 2-т нь).  Өөрөөр хэлбэл
 *        идэвхтэй 49 инженер/архитектор/ахлах инженерийн ЯГ 0 нь тэр
 *        хүснэгтэд байсан.
 *      • Тиймээс энэ шалгалт нь «ажилтан бүр 403» гэсэн утгатай байв:
 *        ГЭТЭЛ гишүүнчлэлтэй цорын ганц 5 хүн бол дээрх мөрөнд
 *        болзолгүй 403 иддэг `client`-үүд.  Дүрэм нь хэнийг ч
 *        нэвтрүүлэхгүй, зөвхөн хаадаг байсан.
 *      • Симптом нь ойлгомжгүй: ажилтан «Төслүүд» хуудсанд бүх төслийг
 *        хардаг (`routes/projects.ts`-ийн staff зам нь гишүүнчлэлээр
 *         огт шүүдэггүй), төсөл нээж «Зохиогчийн хяналт» таб дарахад
 *        403 → «Тайлангуудыг ачаалж чадсангүй».  Бүртгэх товч ч
 *        гарахгүй.  Хэрэглэгчид «ажиллахгүй байна» гэж мэдээлдэг.
 *
 *    `project_members` нь ЭНЭ АПП-Д БОДИТООР ХӨТЛӨГДДӨГГҮЙ хүснэгт —
 *    `routes/projects.ts:177-186` өөрөө «даалгавар оноох нь хүнийг
 *    `project_members`-т нэмдэггүй» гэж бичээд member_count-даа UNION
 *    хийдэг.  Түүн дээр эрх тулгуурлах нь ямар ч feature-ийг үхүүлнэ.
 *
 *    Одоогийн дүрэм = `GET /api/projects`-ийн staff замын толин тусгал:
 *    ажилтан бүх төслийг хардаг тул бүх төсөл дээр ЗХ бүртгэнэ.
 *    Хилийн шугам нь ХЭВЭЭР `client` (+ `worker`) — тэр бол энэ
 *    файлын толгойд бичигдсэн жинхэнэ хамгаалалт.  (Эзний шийдвэр,
 *    2026-08-26.)
 */
async function ensureAsrProjectAccess(
  db: D1Database,
  projectId: number,
  user: Viewer,
  opts?: { forCreate?: boolean },
): Promise<
  | { ok: true; merged: { id: number; name: string } | null }
  | { ok: false; status: 403 | 404; error: string }
> {
  if (!ASR_ROLES.has(user.role)) return { ok: false, status: 403, error: 'Forbidden' };
  const row = await db
    .prepare(
      `SELECT p.asr_only, p.category, p.asr_merged_into, ${asrLabelSql('m')} AS merged_name
         FROM projects p
         LEFT JOIN projects m ON m.id = p.asr_merged_into
        WHERE p.id = ?`,
    )
    .bind(projectId)
    .first<{
      asr_only: number | null;
      category: string | null;
      asr_merged_into: number | null;
      merged_name: string | null;
    }>();
  if (!row) return { ok: false, status: 404, error: 'Project not found' };
  // Нэгтгэгдсэн төсөл (миграц 0340) — УНШИХ нь нээлттэй (хуучин холбоос,
  // мэдэгдэл ажилласаар байна), гэвч ШИНЭ тайлан үүсгэхгүй — эс бөгөөс
  // хуваагдал дахин үүснэ.  Хэрэглэгчид ЗОРИЛТЫГ НЭРИЙН хэлнэ.
  if (opts?.forCreate && !isAsrCreateEligible(row)) {
    const target = row.merged_name ? `«${row.merged_name}»` : 'өөр төсөл';
    return {
      ok: false,
      status: 403,
      error: `Энэ төслийн зохиогчийн хяналт ${target} рүү нэгтгэгдсэн. Шинэ тайланг тэнд бүртгэнэ үү.`,
    };
  }
  return {
    ok: true,
    merged:
      row.asr_merged_into != null
        ? { id: row.asr_merged_into, name: row.merged_name ?? '' }
        : null,
  };
}

/**
 * Батлах эрх: админ, эсвэл тайланд орсон багийн аль нэгний идэвхтэй
 * `senior` гишүүн.  `routes/progress.ts`-ийн батлагчийн дүрмийн толин тусгал.
 */
async function canReview(db: D1Database, reportId: number, user: Viewer): Promise<boolean> {
  if (isAdminRole(user.role)) return true;
  if (user.role !== 'senior') return false;
  const row = await db
    .prepare(
      `SELECT 1 AS x
         FROM author_supervision_report_teams rt
         JOIN user_teams ut ON ut.team_id = rt.team_id
        WHERE rt.report_id = ? AND ut.user_id = ?
        LIMIT 1`,
    )
    .bind(reportId, user.sub)
    .first<{ x: number }>();
  return !!row;
}

/* ------------------------------------------------------------------ */
/*  Уншилт / хэлбэржүүлэлт                                             */
/* ------------------------------------------------------------------ */

/**
 * Ноорог зөвхөн зохиогч + админд харагдана.  Энэ predicate-ыг ГАНЦ
 * газар байлгана — өөр query дээр давтвал мартагдана.
 */
const DRAFT_VISIBILITY = `(r.status <> 'draft' OR r.author_id = ? OR ? = 1)`;

/** Багийн харагдацын үзэгч (`lib/asrVisibility.ts`, эзний шийдвэр 2026-09-29). */
function viewerOf(user: Viewer): AsrViewer {
  return { sub: user.sub, isAdmin: isAdminRole(user.role) };
}

/**
 * Төслийн паспортын ШУУД холбоос.
 *
 * ⚠️ Багануудыг `passport_shifr` / `passport_title` гэсэн ӨӨР нэрээр гаргана,
 *    `shifr` гэж alias хийж БОЛОХГҮЙ.  Хоёр query ч `r.*` сонгодог тул
 *    нэр давхардвал D1-ийн мөрийн объект дээр аль нь үлдэхийг баримтжуулаагүй
 *    «сүүлийнх хожино» зан төлөв шийднэ — хүчинтэй шифр чимээгүй алдагдана.
 *    Нэгтгэлийг доорх `shapeRow` JS дотор ИЛ хийнэ.
 */
const PASSPORT_JOIN = `LEFT JOIN project_passport pp ON pp.project_id = r.project_id`;


/**
 * `r.*` — тодорхой баганын жагсаалт БИЧИХГҮЙ (correspondence.ts:136-ийн сургамж).
 * `visible` = `asrVisibleSql(...)` — багийн харагдац (bind-гүй).
 */
const listSql = (visible: string) => `
  SELECT r.*,
         u.full_name  AS author_name,
         rv.full_name AS reviewer_name,
         rbv.full_name AS red_book_verifier_name,
         ceo.signature_url AS checked_by_signature_url,
         -- Захирлын ТАМГА — гарын үсэгтэй нэг эх сурвалжаас (0173).
         ceo.stamp_url AS stamp_url,
         pp.drawing_no AS passport_shifr,
         pp.full_title AS passport_title,
         -- ЗХ-ийн төслийн «Гэрээний дугаар» (0365) — тайлангийн contract_no хоосон бол дагана.
         -- ⚠️ Энэ бол template literal — тайлбарт BACKTICK бүү бич.
         ${PROJECT_CONTRACT_SQL} AS project_contract_no,
         (SELECT group_concat(t.code)
            FROM author_supervision_report_teams rt
            JOIN teams t ON t.id = rt.team_id
           WHERE rt.report_id = r.id) AS team_codes,
         (SELECT group_concat(c.user_id)
            FROM asr_report_companions c
           WHERE c.report_id = r.id) AS companion_ids,
         (SELECT group_concat(cu.full_name, ', ')
            FROM asr_report_companions c
            JOIN users cu ON cu.id = c.user_id
           WHERE c.report_id = r.id) AS companion_names
    FROM author_supervision_reports r
    LEFT JOIN users u  ON u.id = r.author_id
    LEFT JOIN users rv ON rv.id = r.reviewed_by
    LEFT JOIN users rbv ON rbv.id = r.red_book_verified_by
    LEFT JOIN users ceo ON ceo.id = ${CEO_USER_ID}
    ${PASSPORT_JOIN}
   WHERE r.project_id = ? AND ${DRAFT_VISIBILITY} AND ${visible}
   ORDER BY r.report_date DESC, r.id DESC`;

const ONE_SQL = `
  SELECT r.*,
         u.full_name  AS author_name,
         -- Зохиогчийн албан тушаал — оффис уулзалтын «Оролцсон» мөрөнд (0367).
         u.position   AS author_position,
         rv.full_name AS reviewer_name,
         rbv.full_name AS red_book_verifier_name,
         ceo.signature_url AS checked_by_signature_url,
         ceo.stamp_url AS stamp_url,
         pp.drawing_no AS passport_shifr,
         pp.full_title AS passport_title,
         ${PROJECT_CONTRACT_SQL} AS project_contract_no,
         -- ХАБ-ын баталгаа холбогдсон эсэх (0329) — засварлагч «Талбайн
         -- хяналт» төрлийг сонгох эрхийг үүгээр шийднэ (0362, PATCH-ийн ихэр).
         EXISTS (SELECT 1 FROM asr_safety_acknowledgements a
                  WHERE a.report_id = r.id) AS has_safety_ack
    FROM author_supervision_reports r
    LEFT JOIN users u  ON u.id = r.author_id
    LEFT JOIN users rv ON rv.id = r.reviewed_by
    LEFT JOIN users rbv ON rbv.id = r.red_book_verified_by
    LEFT JOIN users ceo ON ceo.id = ${CEO_USER_ID}
    ${PASSPORT_JOIN}
   WHERE r.id = ?`;

/**
 * Мөрийг клиентийн хэлбэрт оруулна.
 *
 * ⚠️ ШИФРИЙН СЕМАНТИК (2026-09-03).  `author_supervision_reports.shifr` нь
 *    ХҮЧИНГҮЙЛЭГЧ (override), ЦООНОГ (snapshot) БИШ:
 *      • NULL  ⇒ тайлан төслийн паспортыг ШУУД дагана;
 *      • утга  ⇒ хэрэглэгч гараар бичсэн, эсвэл илгээх үед хөлдсөн
 *                (`lib/asrNo.ts` → `allocateAndSubmit`).
 *
 *    Иймд ХАРИУН дахь `shifr` нь ХҮЧИН ТӨГӨЛДӨР утга: жагсаалт, хэвлэх
 *    хуудас, PDF-ийн файлын нэр бүгд түүнийг уншдаг тул нэг л газар
 *    нэгтгэвэл тэд бүгд автоматаар зөв болно.  Түүхий утгыг тусад нь
 *    `shifr_override` нэрээр гаргана — засварлагчийн талбар ЗӨВХӨН түүнийг
 *    харуулах ёстой (эс бөгөөс паспортоос ирсэн утга дараагийн PATCH дээр
 *    override болж хувирч, шууд хөлдөнө).
 */
function shapeRow(row: AsrRow) {
  const {
    photos_json: _p,
    doc_types_json: _d,
    meeting_requests_json: _mr,
    meeting_doc_json: _md,
    ...rest
  } = row;
  const override = norm(row.shifr);
  const passportShifr = norm(row.passport_shifr);
  const passportTitle = norm(row.passport_title);
  return {
    ...rest,
    // ⚠️ Дараалал чухал: `...rest` дотор түүхий `shifr`/`contract_no` байгаа тул
    //    доорхыг ЗААВАЛ түүний ДАРАА бичнэ.
    shifr: override ?? passportShifr,
    shifr_override: override,
    // «Гэрээний дугаар» — шифртэй ижил хүчингүйлэгч, гэхдээ илгээхэд ХӨЛДӨХГҮЙ
    // (0365, `lib/asrContractNo.ts`): төсөл дээрх бүх тайлан төслийн дугаарыг дагана.
    ...resolveAsrContractNo(row.contract_no, row.project_contract_no),
    /** `'override'` | `'passport'` | `null` — UI «Авто (паспортоос)» гэж хэлнэ. */
    shifr_source: override ? 'override' : passportShifr ? 'passport' : null,
    passport_shifr: passportShifr,
    /** Паспортын албан ёсны бүтэн нэр — хэвлэх хуудасны толгойд. */
    passport_title: passportTitle,
    photos: parsePhotos(row.photos_json),
    doc_types: parseDocTypes(row.doc_types_json),
    /** 0396 — «0.1 Захиалагч / 0.2 Гүйцэтгэгч» хүснэгтүүд (оффис уулзалт). */
    // NULL = хэзээ ч хадгалаагүй → засварлагч анхнаасаа 1 хоосон мөр харуулна; хадгалсан
    // хоосон хүснэгт (мөрөө устгасан) нь `{items: []}` хэвээр ирнэ.
    meeting_requests: row.meeting_requests_json
      ? parseMeetingRequests(row.meeting_requests_json)
      : null,
    /** 0398 — оффис уулзалтын баримтын нэмэлт. */
    meeting_doc: parseMeetingDoc(row.meeting_doc_json),
    /** Улаан дэвтэр — гарган авсан төлөв (0279); түүхий баганууд `...rest`-д. */
    red_book_status: redBookStatusOf(row),
  };
}

async function loadTeams(db: D1Database, reportId: number) {
  const { results } = await db
    .prepare(
      `SELECT rt.team_id, rt.work_note, rt.sort_order, t.code AS team_code,
              t.name_mn AS team_name_mn, t.name_en AS team_name_en
         FROM author_supervision_report_teams rt
         JOIN teams t ON t.id = rt.team_id
        WHERE rt.report_id = ?
        ORDER BY rt.sort_order, t.sort_order`,
    )
    .bind(reportId)
    .all();
  return results ?? [];
}

/**
 * Тайлангийн дуу бичлэгүүд.  `audio_key` нь ХАРИУНД ОРОХГҮЙ — тэр бол
 * private `MEETING_BUCKET`-ийн түлхүүр бөгөөд клиентэд хэрэггүй (тоглуулах
 * бол `GET /:id/recordings/:recId/url` гарын үсэгтэй холбоос өгнө).
 */
async function loadRecordings(db: D1Database, reportId: number) {
  const { results } = await db
    .prepare(
      `SELECT id, content_type, size_bytes, duration_seconds, stt_status,
              transcript_text, language, error, sort_order, created_by_id,
              submitted_at, completed_at, created_at
         FROM asr_recordings
        WHERE report_id = ?
        ORDER BY sort_order, id`,
    )
    .bind(reportId)
    .all();
  return results ?? [];
}

/**
 * Төслийн товч танилцуулгыг ПАСПОРТООС АМЬДААР гаргана.
 *
 * ⚠️ ХОЁР дуудагчтай бөгөөд ЯГ ижил утга буцаах ЁСТОЙ: `loadDetail` (ноорог
 *    дээр харагдах амьд утга) ба илгээх зам (хөлдөөх утга).  Тиймээс НЭГ
 *    функц — эс бөгөөс хэрэглэгчийн харсан танилцуулга ба баримтад хөлдсөн
 *    танилцуулга хоёр өөр байж болно.
 *
 * ⚠️ `disciplines_json`-ыг ЭНД задална: `resolveProjectIdentity` нь задарсан
 *    массив хүлээдэг (`PassportLike.disciplines`), түүхий JSON мөр БИШ.
 */
async function loadLiveProjectInfo(
  db: D1Database,
  projectId: number,
): Promise<AsrProjectInfo | null> {
  const [project, passport, clients] = await Promise.all([
    db
      .prepare('SELECT id, name, display_title, location FROM projects WHERE id = ?')
      .bind(projectId)
      .first<{ id: number; name: string; display_title: string | null; location: string | null }>(),
    db
      .prepare(
        `SELECT full_title, drawing_no, doc_no, start_date, finish_date, disciplines_json
           FROM project_passport WHERE project_id = ?`,
      )
      .bind(projectId)
      .first<{
        full_title: string | null;
        drawing_no: string | null;
        doc_no: string | null;
        start_date: string | null;
        finish_date: string | null;
        disciplines_json: string | null;
      }>(),
    db
      .prepare('SELECT name FROM project_clients WHERE project_id = ? ORDER BY sort_order, id')
      .bind(projectId)
      .all<{ name: string }>(),
  ]);
  if (!project) return null;

  let disciplines: string[] = [];
  if (passport?.disciplines_json) {
    try {
      const parsed: unknown = JSON.parse(passport.disciplines_json);
      if (Array.isArray(parsed))
        disciplines = parsed.filter((d): d is string => typeof d === 'string');
    } catch {
      // Гэмтсэн JSON — танилцуулга ажлын хэсэггүйгээр гарна, 500 БУЦААХГҮЙ.
    }
  }

  return buildAsrProjectInfo({
    project,
    passport: passport ? { ...passport, disciplines } : null,
    clients: clients.results ?? [],
  });
}

/**
 * «Өмнөх тайлангийн асуудлыг бид ингэж шийдсэн» мөрүүд (0336).
 *
 * Өмнөх тайлангийн дугаар/огноог АМЬДААР (JOIN) уншиж, тайлан устсан бол
 * цооногоор нөхнө — ингэснээр шийдлийн мөр хэзээ ч нэргүй болохгүй.
 * `prev_defects` нь өмнөх тайлангийн одоогийн «Алдаа дутагдал» — UI дээр
 * цооногтой зэрэгцүүлэн харуулахад (тайлан хөлдсөн тул бараг үргэлж ижил).
 */
async function loadResolutions(db: D1Database, reportId: number) {
  const { results } = await db
    .prepare(
      `SELECT res.id, res.prev_report_id,
              COALESCE(p.doc_no, res.prev_doc_no) AS prev_doc_no,
              COALESCE(p.report_date, res.prev_report_date) AS prev_report_date,
              p.status AS prev_status,
              p.defects AS prev_defects,
              res.issue_text, res.resolution_text, res.sort_order
         FROM asr_issue_resolutions res
         LEFT JOIN author_supervision_reports p ON p.id = res.prev_report_id
        WHERE res.report_id = ?
        ORDER BY res.sort_order, res.id`,
    )
    .bind(reportId)
    .all();
  return results ?? [];
}

/**
 * ЭНЭ тайлангийн асуудлыг аль ДАРААГИЙН тайлан шийдсэн бэ — ГАРГАН АВСАН
 * холбоос (0336).  Өмнөх тайлангийн мөр ХӨНДӨГДӨӨГҮЙ: илгээгдсэн/батлагдсан
 * баримт хөлдсөн байдаг тул түүх алга болохгүй, харин баримт дээр «Шийдсэн:
 * ASR-007 · 2026.09.20» гэж гарна.  Ноорог шийдэл тоологдохгүй — ноорог нь
 * зөвхөн зохиогч + админд харагддаг (`DRAFT_VISIBILITY`), энд хүн бүр ижил
 * жагсаалт харах ёстой.
 */
async function loadResolvedIn(db: D1Database, reportId: number) {
  const { results } = await db
    .prepare(
      `SELECT r.id AS report_id, r.doc_no, r.report_date, r.status,
              res.issue_text, res.resolution_text
         FROM asr_issue_resolutions res
         JOIN author_supervision_reports r ON r.id = res.report_id
        WHERE res.prev_report_id = ? AND r.status IN ('submitted', 'approved')
        ORDER BY r.report_date, r.id, res.sort_order, res.id`,
    )
    .bind(reportId)
    .all();
  return results ?? [];
}

/**
 * Шийдлийн мөрүүдийг бүхэлд нь солино (`replaceTeams`-ийн хэв маяг).
 * `prev_report_id` нь ИЖИЛ ТӨСЛИЙН, ноорог биш, өөрөөс нь өөр тайлан байх
 * ёстой — эс бөгөөс мөр хаягдана (400 биш: маягт бүхлээрээ автоматаар
 * хадгалагддаг тул нэг буруу мөр бүх хадгалалтыг унагах ёсгүй).  Цооног
 * (`prev_doc_no`, `prev_report_date`) нь бичих агшинд DB-ээс авагдана.
 */
async function replaceResolutions(
  db: D1Database,
  reportId: number,
  projectId: number,
  input: AsrResolutionInput[],
) {
  const stmts: D1PreparedStatement[] = [
    db.prepare('DELETE FROM asr_issue_resolutions WHERE report_id = ?').bind(reportId),
  ];
  const wanted = input
    .map((r) => ({
      // ⚠️ `Number(null)` нь 0 тул null-ыг ЭХЛЭЭД шүүнэ — эс бөгөөс холбоосгүй
      //    хоосон мөр «prev = 0» болж хадгалагдана.
      prev:
        r?.prev_report_id != null && Number.isFinite(Number(r.prev_report_id))
          ? Number(r.prev_report_id)
          : null,
      issue: normText(r?.issue_text),
      resolution: normText(r?.resolution_text),
    }))
    // Хоосон мөр (өмнөх тайлан ч, текст ч алга) — хадгалах юмгүй.
    .filter((r) => r.prev != null || r.issue || r.resolution);

  const prevIds = [...new Set(wanted.map((r) => r.prev).filter((v): v is number => v != null))];
  const prevRows = new Map<number, { doc_no: string | null; report_date: string }>();
  if (prevIds.length > 0) {
    const { results } = await db
      .prepare(
        `SELECT id, doc_no, report_date
           FROM author_supervision_reports
          WHERE project_id = ? AND id <> ? AND status IN ('submitted', 'approved')
            AND id IN (${prevIds.map(() => '?').join(',')})`,
      )
      .bind(projectId, reportId, ...prevIds)
      .all<{ id: number; doc_no: string | null; report_date: string }>();
    for (const r of results ?? []) prevRows.set(r.id, r);
  }

  let i = 0;
  for (const r of wanted) {
    const prev = r.prev != null ? prevRows.get(r.prev) : undefined;
    // Холбогдсон тайлан хүчингүй (өөр төсөл / ноорог / устсан) бол холбоосгүй
    // ч текст нь үлдэнэ — хэрэглэгчийн бичсэн шийдэл хаягдахгүй.
    stmts.push(
      db
        .prepare(
          `INSERT INTO asr_issue_resolutions
             (report_id, prev_report_id, prev_doc_no, prev_report_date, issue_text, resolution_text, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          reportId,
          prev ? r.prev : null,
          prev?.doc_no ?? null,
          prev?.report_date ?? null,
          r.issue,
          r.resolution,
          i++,
        ),
    );
  }
  await db.batch(stmts);
}

async function loadDetail(db: D1Database, reportId: number) {
  const row = await db.prepare(ONE_SQL).bind(reportId).first<AsrRow>();
  if (!row) return null;
  const [teams, recordings, resolutions, resolvedIn, companions] = await Promise.all([
    loadTeams(db, reportId),
    loadRecordings(db, reportId),
    loadResolutions(db, reportId),
    loadResolvedIn(db, reportId),
    loadCompanions(db, reportId),
  ]);
  /*
   * ⚠️ ХӨЛДСӨН нь ҮРГЭЛЖ ХОЖИНО.  Илгээгдсэн тайлан бол гарын үсэгтэй
   *    талбайн баримт — паспорт хожим засагдсанаас болж хэвлэгдсэн
   *    танилцуулга өөрчлөгдөж БОЛОХГҮЙ (эзний шийдвэр 2026-09-04).
   *    NULL (ноорог, эсвэл 0256-аас өмнөх мөр) бол амьдаар тооцно.
   */
  const frozen = parseAsrProjectInfo(row.project_info_json as string | null | undefined);
  const projectInfo = frozen ?? (await loadLiveProjectInfo(db, row.project_id));
  return {
    ...shapeRow(row),
    has_safety_ack: !!row.has_safety_ack,
    teams,
    recordings,
    /** «Өмнөх тайлангийн асуудлыг ингэж шийдсэн» (0336). */
    resolutions,
    /** Энэ тайлангийн асуудлыг шийдсэн ДАРААГИЙН тайлангууд — гарган авсан. */
    resolved_in: resolvedIn,
    /** Хамт явсан багийнхан (0347) — зохиогчоос гадна. */
    companions,
    project_info: projectInfo,
    /** `true` бол танилцуулга хөлдсөн — UI «илгээх үед тогтсон» гэж хэлнэ. */
    project_info_frozen: frozen != null,
  };
}

/**
 * «Хяналтаар явсан» checkbox-т харуулах багууд — ҮРГЭЛЖ БҮХ БАГ.
 *
 * ⚠️ 2026-09-11 хүртэл төслийн `project_team_shares`-ээс л авдаг байсан
 *    (байхгүй үед л бүх баг).  Интерьер (IZ) төслийн roster-т BB байдаггүй
 *    тул барилгын бүтээцийн инженер талбайд очсон ч тайландаа багаа
 *    сонгож чаддаггүй байв.  Эзний шийдвэр: аль ч төсөл дээр аль ч багийг
 *    сонгож болно.  Roster-ийн багууд эхэнд, бусад нь ард — талбайн
 *    инженерт хамгийн их хэрэглэдэг нь дээр нь харагдана.
 *
 * `GET /api/teams` (5-CTE aggregate) хэрэглэхгүй — энд зөвхөн код + нэр л
 * хэрэгтэй.  Бичих тал (`replaceTeams`) roster шалгадаггүй байсан тул
 * серверийн зөвшөөрөл өөрчлөгдөөгүй, зөвхөн сонголтын жагсаалт өргөссөн.
 */
async function teamOptions(db: D1Database, projectId: number) {
  const { results } = await db
    .prepare(
      `SELECT t.id, t.code, t.name_mn, t.name_en
         FROM teams t
         LEFT JOIN project_team_shares pts
                ON pts.team_id = t.id AND pts.project_id = ?
        ORDER BY (pts.team_id IS NULL), pts.sort_order, t.sort_order, t.name_mn`,
    )
    .bind(projectId)
    .all();
  return results ?? [];
}

/** Child мөрүүдийг бүхэлд нь солино (нэг batch). */
async function replaceTeams(db: D1Database, reportId: number, teams: AsrTeamInput[]) {
  const stmts: D1PreparedStatement[] = [
    db.prepare('DELETE FROM author_supervision_report_teams WHERE report_id = ?').bind(reportId),
  ];
  teams.forEach((t, i) => {
    stmts.push(
      db
        .prepare(
          `INSERT INTO author_supervision_report_teams (report_id, team_id, work_note, sort_order)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(reportId, t.team_id, norm(t.work_note), i),
    );
  });
  await db.batch(stmts);
}

/* ------------------------------------------------------------------ */
/*  GET / — бүх төслийн хөндлөн жагсаалт (бие даасан хуудас)           */
/* ------------------------------------------------------------------ */
/**
 * `/app/asr` хуудасны эх сурвалж.  `GET /projects/:projectId` нь ганц
 * төслийн таб-д зориулагдсан; энэ нь хэрэглэгчийн ХАРАХ ЭРХТЭЙ БҮХ
 * төслийн тайланг нэг дор гаргана.  Хоёулаа хэвээр байна — таб нь
 * төслийн контекст, энэ нь хөндлөн харагдац.
 *
 * ⚠️ `GET /:id`-ЭЭС ДЭЭР бүртгэгдсэн (`projects.ts`-ийн `/top`·`/reorder`
 *    конвенц).
 *
 * Эрх: client бүрэн хаалттай (бусад бүх endpoint-той ижил).  Админ бүх
 * төслийг, бусад нь зөвхөн гишүүн болсон төслөө.  Ноорогийн харагдац нь
 * `DRAFT_VISIBILITY` — тэр predicate ГАНЦ газар байна.
 */
const LIST_LIMIT_DEFAULT = 50;
const LIST_LIMIT_MAX = 200;

router.get('/', async (c) => {
  const user = c.get('user');
  if (!ASR_ROLES.has(user.role)) return c.json({ error: 'Forbidden' }, 403);
  const isAdmin = isAdminRole(user.role) ? 1 : 0;

  const rawLimit = Number(c.req.query('limit'));
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), LIST_LIMIT_MAX)
    : LIST_LIMIT_DEFAULT;
  const rawOffset = Number(c.req.query('offset'));
  const offset = Number.isFinite(rawOffset) ? Math.max(Math.trunc(rawOffset), 0) : 0;

  /*
   * Хоёр нөхцөлийн багц:
   *   `scope`  — үзэгчийн харах эрх (ноорог + гишүүнчлэл).  Шүүлтүүрийн
   *              төслийн жагсаалт ЭНЭ багцаар гарна — эс бөгөөс сонгосон
   *              төсөл нь өөрийгөө л санал болгодог мухардал үүснэ.
   *   `filter` — хэрэглэгчийн сонгосон шүүлт (төсөл / төлөв).
   * Гишүүнчлэлийг SQL дотор шүүнэ — JS талд шүүвэл эрхгүй мөрүүд
   * limit-ийг идэж paging худал болно.
   */
  // Багийн харагдац (2026-09-29) — bind-гүй, тиймээс `scopeArgs`-ийн дараалалд нөлөөгүй.
  const scope: string[] = [DRAFT_VISIBILITY, asrVisibleSql(viewerOf(user))];
  const scopeArgs: (string | number)[] = [user.sub, isAdmin];
  // ⚠️ Энд өмнө нь `r.project_id IN (SELECT project_id FROM project_members …)`
  // гэсэн нэмэлт шүүлт байсан.  `ensureAsrProjectAccess`-ийн тайлбарт
  // бичсэнчлэн тэр хүснэгт прод дээр ажилтны ганц ч мөр агуулдаггүй тул
  // энэ хуудас ажилтан бүрд ҮҮРД ХООСОН байв — «Одоогоор зохиогчийн
  // хяналтын тайлан бүртгэгдээгүй байна» гэж худал харуулж байсан.
  // Ажилтан бүх төсөлд ЗХ бүртгэдэг тул бүх төслийн тайланг ч хардаг;
  // ноорогийн хилийг `DRAFT_VISIBILITY` ГАНЦААРАА шийднэ.

  const filter: string[] = [];
  const filterArgs: (string | number)[] = [];

  const projectId = Number(c.req.query('project_id'));
  if (Number.isFinite(projectId)) {
    filter.push('r.project_id = ?');
    filterArgs.push(projectId);
  }

  const status = c.req.query('status');
  if (status && ['draft', 'submitted', 'approved', 'rejected'].includes(status)) {
    filter.push('r.status = ?');
    filterArgs.push(status);
  }

  // Тайлангийн төрөл (0362) — `/app/asr`-ийн «Талбайн хяналт / Цахим уулзалт /
  // Зургийн өөрчлөлт / Оффис уулзалт» шүүлт.  Танигдахгүй утга шүүлтгүй (хуучин
  // клиент/буруу URL жагсаалтыг хоосон болгохгүй).
  const reportType = c.req.query('report_type');
  if (isAsrReportType(reportType)) {
    filter.push('r.report_type = ?');
    filterArgs.push(reportType);
  }

  const where = [...scope, ...filter].join(' AND ');

  // `limit + 1` — нийт тоог тоолохын оронд «дараагийн хуудас байна уу»
  // гэдгийг мэдэх хамгийн хямд арга.
  const [listRes, projectRes] = await Promise.all([
    c.env.DB.prepare(
      `SELECT r.*,
              u.full_name  AS author_name,
              rv.full_name AS reviewer_name,
              rbv.full_name AS red_book_verifier_name,
              ${asrLabelSql('p')} AS project_name,
              (SELECT group_concat(t.code)
                 FROM author_supervision_report_teams rt
                 JOIN teams t ON t.id = rt.team_id
                WHERE rt.report_id = r.id) AS team_codes,
              (SELECT group_concat(c.user_id)
                 FROM asr_report_companions c
                WHERE c.report_id = r.id) AS companion_ids,
              (SELECT group_concat(cu.full_name, ', ')
                 FROM asr_report_companions c
                 JOIN users cu ON cu.id = c.user_id
                WHERE c.report_id = r.id) AS companion_names
         FROM author_supervision_reports r
         JOIN projects p ON p.id = r.project_id
         LEFT JOIN users u  ON u.id = r.author_id
         LEFT JOIN users rv ON rv.id = r.reviewed_by
         LEFT JOIN users rbv ON rbv.id = r.red_book_verified_by
        WHERE ${where}
        ORDER BY r.report_date DESC, r.id DESC
        LIMIT ? OFFSET ?`,
    )
      .bind(...scopeArgs, ...filterArgs, limit + 1, offset)
      .all<AsrRow>(),
    // Шүүлтүүрийн сонголт: ХАРАГДАХ тайлантай төслүүд.  `GET /api/projects`
    // (PROJECT_LIST_SQL — олон давхар CTE) хэрэглэхгүй: энд зөвхөн id + нэр
    // хэрэгтэй, мөн ASR-гүй төслийг санал болгох нь утгагүй.
    c.env.DB.prepare(
      `SELECT DISTINCT p.id, ${asrLabelSql('p')} AS name
         FROM author_supervision_reports r
         JOIN projects p ON p.id = r.project_id
        WHERE ${scope.join(' AND ')}
        ORDER BY name`,
    )
      .bind(...scopeArgs)
      .all(),
  ]);

  const rows = listRes.results ?? [];

  return c.json({
    entries: rows.slice(0, limit).map(shapeRow),
    has_more: rows.length > limit,
    projects: projectRes.results ?? [],
  });
});

/* ------------------------------------------------------------------ */
/*  GET /projects — «шинэ тайлан» товчны төслийн сонголт                */
/* ------------------------------------------------------------------ */
/**
 * ЗХ-ийн гэрээтэй төслүүд — `/app/asr` самбарын ЯГ ижил жагсаалт
 * (`ASR_SUMMARY_VISIBLE_SQL`: `asr_only`, ZA, эсвэл ядаж нэг тайлантай;
 * 2026-09-25 хүртэл БҮХ төсөл байсан); цонхон дээр нэр/шифрээр хайна.
 * Энэ нь зөвхөн СОНГОЛТЫН шүүлт — `POST /projects/:projectId`-ийн хаалга
 * (`isAsrCreateEligible`) ХЭВЭЭР, төслийн хуудасны ЗХ табаас үүсгэж болно.
 *
 * ⚠️ `GET /`-ийн хариун дахь `projects` талбартай ХОЛЬЖ БОЛОХГҮЙ.  Тэр нь
 *    ШҮҮЛТҮҮРИЙН жагсаалт — «аль хэдийн тайлантай» төслүүд.  Шинэ тайлан
 *    үүсгэх сонголтод түүнийг хэрэглэвэл тахиа-өндөгний мухардал үүснэ:
 *    төсөл дээр анхны тайлан үүсэх хүртэл тэр төсөл сонголтод гарахгүй,
 *    гарахгүй болохоор анхны тайлан хэзээ ч үүсэхгүй.
 *
 * `GET /api/projects`-ыг дуудахгүй: тэр нь олон давхар CTE-тэй жинлэсэн
 * нэгтгэлийн query бөгөөд энд зөвхөн id + нэр + шифр хэрэгтэй.
 *
 * `is_pending` (гэрээ хэлэлцээрийн шат) нь `routes/projects.ts:354`-ийн
 * `seesPending`-ийн яг тэр дүрмээр — admin + senior л хардаг.
 *
 * ⚠️ `GET /:id`-ЭЭС ДЭЭР бүртгэгдсэн байх ЁСТОЙ, эс бөгөөс Hono нь
 *    `/projects`-ыг `id = "projects"` гэж уншина (`projects.ts`-ийн
 *    `/top`·`/reorder` конвенц).
 */
router.get('/projects', async (c) => {
  const user = c.get('user');
  if (!ASR_ROLES.has(user.role)) return c.json({ error: 'Forbidden' }, 403);
  const seesPending = isAdminRole(user.role) || user.role === 'senior';

  const { results } = await c.env.DB.prepare(
    `SELECT p.id, ${asrLabelSql('p')} AS name, p.status, p.category, p.asr_only, pp.drawing_no AS shifr
       FROM projects p
       LEFT JOIN project_passport pp ON pp.project_id = p.id
      WHERE (${ASR_SUMMARY_VISIBLE_SQL})
      ${seesPending ? '' : 'AND COALESCE(p.is_pending, 0) = 0'}
      -- Идэвхтэй төслүүд эхэлнэ: талбайн хяналт бол явж буй барилга дээр
      -- хийгддэг.  Архивлагдсаныг ХАСАХГҮЙ — хаагдсан төсөл дээр сүүлчийн
      -- очилтоо бүртгэх хэрэг гардаг.
      ORDER BY (p.status = 'active') DESC, p.sort_order, p.name`,
  ).all();

  return c.json({ projects: results ?? [] });
});

/* ------------------------------------------------------------------ */
/*  GET /project-summaries — төслийн жагсаалт + очилтын тоо           */
/* ------------------------------------------------------------------ */
/**
 * `/app/asr` хуудсын эхний давхарга: төслүүдийг оруулахгүйгээр жагсаана.
 * ЗХ-ийн (`asr_only`), засварын (ZA), эсвэл ядаж нэг тайлантай төсөл орно
 * (`ASR_SUMMARY_VISIBLE_SQL`) — бусад төсөл анхны тайлан хадгалагдмагц гарна.
 *
 * `name` = ЗХ-д харагдах нэр (0358: `asr_name` ?? `projects.name`); засах
 * цонхонд `asr_name` (түүхий хүчингүйлэгч) ба `base_name` (`projects.name`).
 * Очилтын тоо нь үзэгчийн ХАРАХ тайлангаас (багийн харагдац, 2026-09-29).
 */
router.get('/project-summaries', async (c) => {
  const user = c.get('user');
  if (!ASR_ROLES.has(user.role)) return c.json({ error: 'Forbidden' }, 403);
  const seesPending = isAdminRole(user.role) || user.role === 'senior';

  const { results } = await c.env.DB.prepare(
    `SELECT p.id, ${asrLabelSql('p')} AS name, p.name AS base_name, p.asr_name,
            NULLIF(TRIM(p.asr_contract_no), '') AS asr_contract_no,
            p.status, pp.drawing_no AS shifr,
            COALESCE(v.total_visits, 0) AS total_visits,
            v.last_visit,
            COALESCE(v.report_count, 0) AS report_count
       FROM projects p
       LEFT JOIN project_passport pp ON pp.project_id = p.id
       LEFT JOIN (
         -- «Очилт» = ЗӨВХӨН талбайн хяналт (0362); цахим/оффис уулзалт,
         -- зургийн өөрчлөлт нь report_count-д л орно (UI «N тайлан» гэж
         -- очилтын доор харуулдаг).
         SELECT r.project_id,
                SUM(${ASR_SITE_SQL}) AS total_visits,
                MAX(CASE WHEN ${ASR_SITE_SQL} THEN r.report_date END) AS last_visit,
                COUNT(DISTINCT r.id) AS report_count
           FROM author_supervision_reports r
          WHERE r.status IN ('submitted','approved')
            AND ${asrVisibleSql(viewerOf(user))}
          GROUP BY r.project_id
       ) v ON v.project_id = p.id
      WHERE (${ASR_SUMMARY_VISIBLE_SQL})
      ${seesPending ? '' : 'AND COALESCE(p.is_pending, 0) = 0'}
      ORDER BY (p.status = 'active') DESC, COALESCE(v.last_visit, '') DESC, p.sort_order, p.name`,
  ).all();

  return c.json({ projects: results ?? [] });
});

/* ------------------------------------------------------------------ */
/*  PATCH /projects/:projectId/name — ЗХ-д харагдах нэр (0358)          */
/* ------------------------------------------------------------------ */
/**
 * Эзний шийдвэр 2026-09-29: админ ЗХ-ийн хуудаснаас төслийн нэрийг засна,
 * нэр нь ЗӨВХӨН зохиогчийн хяналтад өөрчлөгдөнө (`projects.asr_name`) —
 * Төслүүд хуудас, явц, Drive, тайланд `projects.name` хэвээр.  Хоосон/null
 * ⇒ анхны нэр рүү буцна.  PROJECT-ID (Doc. No.) нь `projects.name`-ээс
 * хэвээр тул энд юу бичсэн ч баримтын дугаар өөрчлөгдөхгүй.
 *
 * Эзний хүсэлт 2026-09-30: ижил цонхноос ТӨСЛИЙН «Гэрээний дугаар»
 * (`projects.asr_contract_no`, 0365) ч тохируулна.  Илгээсэн талбар л
 * хөндөгдөнө (`asr_name` ба `asr_contract_no` тус тусдаа сонголттой, ядаж
 * нэг нь заавал).  Дугаар ӨӨРЧЛӨГДӨХӨД тэр төслийн тайлангуудын гараар бичсэн
 * `contract_no`-г цэвэрлэж (NULL) бүх тайланг төслийг дагуулна — эс бөгөөс
 * хуучин гараар бичсэн утга шинэ дугаарыг чимээгүй дарна.  Дугаарыг ХАСАХАД
 * (хоосон) тайлангуудын утгыг хөндөхгүй.
 *
 * ⚠️ Хоёр сегменттэй зам тул `PATCH /:id`-тэй мөргөлдөхгүй.
 */
router.patch('/projects/:projectId/name', async (c) => {
  const user = c.get('user');
  if (!isAdminRole(user.role)) return c.json({ error: 'Forbidden' }, 403);
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ error: 'Invalid project id' }, 400);

  const body = await c.req
    .json<{ asr_name?: unknown; asr_contract_no?: unknown }>()
    .catch(() => ({}) as { asr_name?: unknown; asr_contract_no?: unknown });
  const hasName = body.asr_name !== undefined;
  const hasContract = body.asr_contract_no !== undefined;
  if (!hasName && !hasContract) return c.json({ error: 'asr_name is required' }, 400);
  if (hasName && body.asr_name !== null && typeof body.asr_name !== 'string') {
    return c.json({ error: 'asr_name is required' }, 400);
  }
  if (hasContract && body.asr_contract_no !== null && typeof body.asr_contract_no !== 'string') {
    return c.json({ error: 'asr_contract_no must be a string' }, 400);
  }
  const trimmed = typeof body.asr_name === 'string' ? body.asr_name.trim() : '';
  if (trimmed.length > ASR_NAME_MAX) {
    return c.json({ error: `Нэр ${ASR_NAME_MAX} тэмдэгтээс урт байж болохгүй.` }, 400);
  }
  const contractNo =
    typeof body.asr_contract_no === 'string' ? body.asr_contract_no.trim() : '';
  if (contractNo.length > ASR_CONTRACT_NO_MAX) {
    return c.json(
      { error: `Гэрээний дугаар ${ASR_CONTRACT_NO_MAX} тэмдэгтээс урт байж болохгүй.` },
      400,
    );
  }

  const current = await c.env.DB.prepare(
    `SELECT asr_contract_no FROM projects WHERE id = ?`,
  )
    .bind(projectId)
    .first<{ asr_contract_no: string | null }>();
  if (!current) return c.json({ error: 'Project not found' }, 404);

  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  if (hasName) {
    sets.push('asr_name = ?');
    args.push(trimmed || null);
  }
  if (hasContract) {
    sets.push('asr_contract_no = ?');
    args.push(contractNo || null);
  }
  sets.push(`updated_at = datetime('now')`);
  args.push(projectId);

  const stmts = [
    c.env.DB.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).bind(...args),
  ];
  // Шинэ дугаар тогтсон бол тайлан бүр төслийг дагана (`shapeRow`).
  if (hasContract && planContractNoUpdate(current.asr_contract_no, contractNo).clearReportOverrides) {
    stmts.push(c.env.DB.prepare(CLEAR_REPORT_CONTRACT_OVERRIDES_SQL).bind(projectId));
  }
  await c.env.DB.batch(stmts);

  const project = await c.env.DB.prepare(
    `SELECT p.id, ${asrLabelSql('p')} AS name, p.name AS base_name, p.asr_name,
            NULLIF(TRIM(p.asr_contract_no), '') AS asr_contract_no
       FROM projects p WHERE p.id = ?`,
  )
    .bind(projectId)
    .first();
  return c.json({ project });
});

/* ------------------------------------------------------------------ */
/*  GET /projects/:projectId — жагсаалт                                */
/* ------------------------------------------------------------------ */

router.get('/projects/:projectId', async (c) => {
  const user = c.get('user');
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ error: 'Invalid project id' }, 400);

  const access = await ensureAsrProjectAccess(c.env.DB, projectId, user);
  if (!access.ok) return c.json({ error: access.error }, access.status);

  const isAdmin = isAdminRole(user.role) ? 1 : 0;
  const [{ results }, project] = await Promise.all([
    c.env.DB.prepare(listSql(asrVisibleSql(viewerOf(user))))
      .bind(projectId, user.sub, isAdmin)
      .all<AsrRow>(),
    c.env.DB.prepare(
      `SELECT p.id, ${asrLabelSql('p')} AS name, p.name AS base_name, p.asr_name,
              NULLIF(TRIM(p.asr_contract_no), '') AS asr_contract_no
         FROM projects p WHERE p.id = ?`,
    )
      .bind(projectId)
      .first(),
  ]);

  return c.json({
    entries: (results ?? []).map(shapeRow),
    /** ЗХ-д харагдах нэр + засах цонхны түүхий утгууд (0358). */
    project,
    // Нэгтгэгдсэн төсөл (0340) дээр ШИНЭ тайлан үүсгэхгүй — харагдацаас арилсан
    // ч хуучин холбоосоор нээгдвэл «Шинэ тайлан» товч гарах ёсгүй.
    can_write: access.merged == null, // client энд хүрэхгүй (дээрх access шалгалт)
    can_review: isAdmin === 1 || user.role === 'senior',
    teams: await teamOptions(c.env.DB, projectId),
    merged_into: access.merged,
  });
});

/* ------------------------------------------------------------------ */
/*  GET /projects/:projectId/issues — өмнөх тайлангийн асуудлууд (0336)  */
/* ------------------------------------------------------------------ */
/**
 * «Өмнөх тайлангийн асуудлыг бид ингэж шийдсэн» хэсгийн сонголт: тухайн
 * төслийн ИЛГЭЭГДСЭН/БАТЛАГДСАН тайлангууд, «Алдаа дутагдал» бичвэрийнх нь
 * хамт.  Ноорог ОРОХГҮЙ — ноорогийн асуудал хараахан албан ёсны биш, мөн
 * `DRAFT_VISIBILITY`-ээс болж хүн бүр өөр жагсаалт харна.
 *
 * `defects` хоосон тайлан ч орно: асуудал нь «Тайлбар» эсвэл багийн
 * тэмдэглэлд бичигдсэн байж болно; хэрэглэгч цооногийг өөрөө бичнэ.
 * `resolved_count` — энэ тайланг аль хэдийн хэдэн шийдэл иш татсан бэ
 * (жагсаалтад «шийдэгдсэн» тэмдэглэгээ).
 */
router.get('/projects/:projectId/issues', async (c) => {
  const user = c.get('user');
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ error: 'Invalid project id' }, 400);

  const access = await ensureAsrProjectAccess(c.env.DB, projectId, user);
  if (!access.ok) return c.json({ error: access.error }, access.status);

  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.seq, r.doc_no, r.report_date, r.status, r.defects, r.description,
            u.full_name AS author_name,
            (SELECT COUNT(*) FROM asr_issue_resolutions res
              JOIN author_supervision_reports rr ON rr.id = res.report_id
             WHERE res.prev_report_id = r.id AND rr.status IN ('submitted','approved')) AS resolved_count
       FROM author_supervision_reports r
       LEFT JOIN users u ON u.id = r.author_id
      WHERE r.project_id = ? AND r.status IN ('submitted', 'approved')
        AND ${asrVisibleSql(viewerOf(user))}
      ORDER BY r.report_date DESC, r.id DESC
      LIMIT 200`,
  )
    .bind(projectId)
    .all();

  return c.json({ reports: results ?? [] });
});

/* ------------------------------------------------------------------ */
/*  GET /projects/:projectId/visits — «хэн хэдэн удаа очив»            */
/* ------------------------------------------------------------------ */
/**
 * Migration 0133 нь `author_supervision_report_teams`-ыг JSON map биш
 * ХҮҮХЭД ХҮСНЭГТ болгосон шалтгаанаа «"БА баг энэ төсөл дээр хэдэн удаа
 * талбайд гарсан бэ" гэдэг асуулт гарцаагүй ирнэ» гэж бичсэн бөгөөд
 * `idx_asrt_team`-ыг яг үүнд зориулж тавьсан.  Энэ бол тэр асуулт.
 *
 * Ноорог ТООЛОГДОХГҮЙ: хаягдсан ноорог нь хийгээгүй очилтыг тоолуулах
 * бөгөөд `DRAFT_VISIBILITY`-ийн улмаас хүн бүр өөр өөр тоо харах болно.
 * Тиймээс `submitted|approved` л ордог — бүх үзэгчид ижил тоо харна.
 */
router.get('/projects/:projectId/visits', async (c) => {
  const user = c.get('user');
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ error: 'Invalid project id' }, 400);

  const access = await ensureAsrProjectAccess(c.env.DB, projectId, user);
  if (!access.ok) return c.json({ error: access.error }, access.status);

  // Багийн харагдац (2026-09-29): ББ-гийнхэн зөвхөн ББ-гийн очилтыг тоолно.
  // `asrVisibleSql` bind-гүй тул `personVisitsSql`-ийн давтагдах нөхцөлд ч аюулгүй.
  // «Очилт» = ЗӨВХӨН талбайн хяналт (0362, эзний шийдвэр 2026-09-29).
  const COUNTED = `r.project_id = ? AND r.status IN ('submitted','approved') AND ${ASR_SITE_SQL} AND ${asrVisibleSql(viewerOf(user))}`;

  const [byTeam, byPerson, teamPeople, totals] = await Promise.all([
    c.env.DB.prepare(
      `SELECT t.id AS team_id, t.code AS team_code, t.name_mn, t.name_en,
              COUNT(*) AS visits,
              MAX(r.report_date) AS last_visit
         FROM author_supervision_report_teams rt
         JOIN author_supervision_reports r ON r.id = rt.report_id
         JOIN teams t ON t.id = rt.team_id
        WHERE ${COUNTED}
        GROUP BY t.id
        ORDER BY t.sort_order, t.code`,
    )
      .bind(projectId)
      .all(),
    // Хүнээр — тайлан бичсэн хүн + хамт явсан багийнхан (0347).
    c.env.DB.prepare(personVisitsSql(COUNTED)).bind(projectId, projectId).all(),
    c.env.DB.prepare(teamPeopleSql(COUNTED)).bind(projectId, projectId).all(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS visits,
              MIN(r.report_date) AS first_visit,
              MAX(r.report_date) AS last_visit
         FROM author_supervision_reports r
        WHERE ${COUNTED}`,
    )
      .bind(projectId)
      .first<{ visits: number; first_visit: string | null; last_visit: string | null }>(),
  ]);

  return c.json({
    by_team: byTeam.results ?? [],
    by_person: byPerson.results ?? [],
    team_people: teamPeople.results ?? [],
    total_visits: totals?.visits ?? 0,
    first_visit: totals?.first_visit ?? null,
    last_visit: totals?.last_visit ?? null,
  });
});

/* ------------------------------------------------------------------ */
/*  GET /:id — нэг тайлан (child мөрүүдтэй)                            */
/* ------------------------------------------------------------------ */

registerAsrTargetRoutes(router);
// Хяналтын хуваарь (`/plans*`) — мөн `/:id`-ээс ДЭЭР (lib/asrVisitPlanRoutes.ts).
registerAsrVisitPlanRoutes(router, { readRoles: ASR_ROLES });
registerAsrCompanionRoutes(router, {
  ensureAccess: ensureAsrProjectAccess,
  canReview,
  loadDetail,
});

router.get('/:id', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  const head = await c.env.DB.prepare(
    'SELECT project_id, author_id, status FROM author_supervision_reports WHERE id = ?',
  )
    .bind(id)
    .first<{ project_id: number; author_id: number; status: AsrStatus }>();
  if (!head) return c.json({ error: 'Not found' }, 404);

  const access = await ensureAsrProjectAccess(c.env.DB, head.project_id, user);
  if (!access.ok) return c.json({ error: access.error }, access.status);

  // Ноорог зөвхөн зохиогч + админд.
  if (head.status === 'draft' && head.author_id !== user.sub && !isAdminRole(user.role)) {
    return c.json({ error: 'Not found' }, 404);
  }
  // Өөр багийн тайлан — 404 (403 биш: байгаа эсэхийг ч мэдэгдэхгүй).
  if (!(await canSeeAsrReport(c.env.DB, id, viewerOf(user)))) {
    return c.json({ error: 'Not found' }, 404);
  }

  const entry = await loadDetail(c.env.DB, id);
  if (!entry) return c.json({ error: 'Not found' }, 404);
  return c.json({ entry, can_review: await canReview(c.env.DB, id, user) });
});

/* ------------------------------------------------------------------ */
/*  POST /projects/:projectId — шинэ ноорог                            */
/* ------------------------------------------------------------------ */

interface AsrCreateBody {
  client_uuid?: string;
  report_date?: string;
  shifr?: string;
  /** 0362 — `site` (өгөгдмөл) | `online` | `drawing_change` | `office`. */
  report_type?: unknown;
  meeting_platform?: unknown;
}

router.post('/projects/:projectId', async (c) => {
  const user = c.get('user');
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ error: 'Invalid project id' }, 400);

  const access = await ensureAsrProjectAccess(c.env.DB, projectId, user, { forCreate: true });
  if (!access.ok) return c.json({ error: access.error }, access.status);

  const body = await c.req
    .json<AsrCreateBody>()
    .catch(() => ({}) as AsrCreateBody);

  const clientUuid = norm(body.client_uuid);
  if (!clientUuid) return c.json({ error: 'client_uuid is required' }, 400);

  /*
   * Тайлангийн төрөл (0362).  Ирээгүй бол `site` — хуучин клиент ХАБ-ын
   * баталгаатайгаа ирдэг тул зан төлөв нь хэвээр.  ХАБ-ын хаалгыг
   * (`routes/asrSafety.ts`) энэ handler-аас ӨМНӨ ижил дүрмээр шийдсэн.
   */
  const parsedType = parseAsrReportType(body.report_type);
  if (!parsedType.ok) return c.json({ error: 'Тайлангийн төрөл буруу байна.' }, 400);
  const reportType: AsrReportType = parsedType.type ?? DEFAULT_ASR_REPORT_TYPE;

  // Idempotency: сүлжээ тасарч дахин илгээсэн бол байгаа мөрөө буцаана.
  const existing = await c.env.DB.prepare(
    'SELECT id FROM author_supervision_reports WHERE client_uuid = ?',
  )
    .bind(clientUuid)
    .first<{ id: number }>();
  if (existing) {
    const entry = await loadDetail(c.env.DB, existing.id);
    return c.json({ entry }, 200);
  }

  const reportDate = isValidDate(body.report_date) ? body.report_date : todayInUB();

  /*
   * «Шифр» — дуудагч ИЛ өгөөгүй бол NULL үлдэнэ.
   *
   * ⚠️ УРЬД энд төслийн паспортын `drawing_no`-г ХУУЛЖ авдаг байсан.  Тэр нь
   *    буруу: баримт хараахан дуусаагүй, ноорог төлөвт байхад л шифр
   *    хөлдчихдөг тул паспорт дээрх үсгийн алдааны засвар НЭЭЛТТЭЙ ноорогт
   *    ХЭЗЭЭ Ч хүрдэггүй байв (эзний хүсэлтийн яг эсрэг).  NULL нь одоо
   *    «паспортыг дага» гэсэн утгатай: `shapeRow` уншихдаа нэгтгэж, шифр нь
   *    ИЛГЭЭХ мөчид `allocateAndSubmit`-аар хөлдөнө.
   */
  const shifr = norm(body.shifr);

  const res = await c.env.DB.prepare(
    `INSERT INTO author_supervision_reports
       (project_id, client_uuid, report_date, shifr, author_id, status,
        report_type, meeting_platform)
     VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`,
  )
    .bind(
      projectId,
      clientUuid,
      reportDate,
      shifr,
      user.sub,
      reportType,
      meetingPlatformFor(reportType, body.meeting_platform),
    )
    .run();

  const newId = Number(res.meta.last_row_id);

  /*
   * «Хяналтаар явсан баг»-ийг УРЬДЧИЛАН тэмдэглэнэ — бүртгэж буй хүний
   * ӨӨРИЙН баг(ууд)-аар.
   *
   * Яагаад сервер талд: хоёр орох цэг байдаг (төслийн таб ба `/app/asr`)
   * бөгөөд `loadDetail` → `entry.teams` → `formStateFrom` гэсэн ганц
   * замаар маягт руу ордог тул давхардал үүсэхгүй.  Клиент талд хийвэл
   * хоёр газар бичих ба нэг нь мартагдана.
   *
   * Яагаад ач холбогдолтой: `POST /:id/submit` нь «дор хаяж нэг баг»
   * шаарддаг.  Талбай дээр бээлийтэй, утсаараа бөглөж буй инженер энэ
   * нүдийг мартвал бүх зураг, гарын үсгээ хийчихээд илгээх агшинд л
   * 400 иддэг.  Урьдчилгаа нь хамгийн түгээмэл тохиолдлыг (өөрийн баг)
   * шууд зөв болгоно; хүсвэл нүдээ өөрчилнө.
   *
   * `teamOptions()`-ийн семантиктай ЯГ адил: төсөл дээр
   * `project_team_shares` мөр байвал зөвхөн тэдгээрээс, огт байхгүй бол
   * бүх багаас — эс бөгөөс сонголтод байхгүй баг тэмдэглэгдэж, хэрэглэгч
   * түүнийг салгаж ч чадахгүй болно.
   */
  await c.env.DB.prepare(
    `INSERT INTO author_supervision_report_teams (report_id, team_id, work_note, sort_order)
     SELECT ?, t.id, NULL, t.sort_order
       FROM teams t
       JOIN user_teams ut ON ut.team_id = t.id AND ut.user_id = ?
      WHERE NOT EXISTS (SELECT 1 FROM project_team_shares s WHERE s.project_id = ?)
         OR EXISTS (SELECT 1 FROM project_team_shares s
                     WHERE s.project_id = ? AND s.team_id = t.id)`,
  )
    .bind(newId, user.sub, projectId, projectId)
    .run();

  const entry = await loadDetail(c.env.DB, newId);
  return c.json({ entry }, 201);
});

/* ------------------------------------------------------------------ */
/*  PATCH /:id — ноорог засах                                          */
/* ------------------------------------------------------------------ */

interface AsrPatchBody {
  report_date?: string;
  shifr?: string | null;
  /** 0363 — маягтын «Гэрээний дугаар» (тайлан бүрт бөглөнө). */
  contract_no?: string | null;
  doc_types?: string[];
  doc_type_other?: string | null;
  description?: string | null;
  photos?: unknown;
  sig_arch_name?: string | null;
  sig_arch_url?: string | null;
  sig_arch_date?: string | null;
  sig_site_name?: string | null;
  sig_site_url?: string | null;
  sig_site_date?: string | null;
  checked_by_name?: string | null;
  checked_by_title?: string | null;
  teams?: AsrTeamInput[];
  /* 0336 — «Ажлын тайлан» хэсгийн дэд хэсгүүд. */
  work_report?: string | null;
  site_tasks?: string | null;
  defects?: string | null;
  resolutions?: AsrResolutionInput[];
  /** Хамт явсан багийнхны user id (зохиогчоос бусад). */
  companion_user_ids?: number[];
  /** 0362 — тайлангийн төрөл ба цахим уулзалтын платформ. */
  report_type?: unknown;
  meeting_platform?: unknown;
  /** 0367 — оффис уулзалтын мэдээлэл (`lib/asrMeeting.ts`). */
  meeting_place?: unknown;
  meeting_start?: unknown;
  meeting_end?: unknown;
  meeting_parties?: unknown;
  meeting_purpose?: unknown;
  /** 0396 — `{client:{intro,items[]}, contractor:{…}}`. */
  meeting_requests?: unknown;
  /** 0398 — `{party_lines, client_org, client_position}`. */
  meeting_doc?: unknown;
}

router.patch('/:id', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  const head = await c.env.DB.prepare(
    `SELECT project_id, author_id, status, report_type, meeting_platform
       FROM author_supervision_reports WHERE id = ?`,
  )
    .bind(id)
    .first<{
      project_id: number;
      author_id: number;
      status: AsrStatus;
      report_type: string | null;
      meeting_platform: string | null;
    }>();
  if (!head) return c.json({ error: 'Not found' }, 404);

  const access = await ensureAsrProjectAccess(c.env.DB, head.project_id, user);
  if (!access.ok) return c.json({ error: access.error }, access.status);

  const isAdmin = isAdminRole(user.role);
  if (head.author_id !== user.sub && !isAdmin) return c.json({ error: 'Forbidden' }, 403);

  /*
   * Илгээсэн / батлагдсан тайлан ЗОХИОГЧИД хөлддөг — гарын үсэг агуулгыг
   * гэрчилдэг тул дараа нь өөрчлөгдвөл гэрчлэл утгагүй болно.
   *
   * ⚠️ АДМИН энэ хөлдөлтөд ОРОХГҮЙ (эзний шийдвэр, 2026-08-28).  Бодит
   *    ажлын урсгал нь: талбайн инженер илгээнэ → админ ирсэн материалыг
   *    ХАРААД огноо / тайлбар / багийн ажлын тайлан / зургийг нь ЗАСНА →
   *    хадгална → дараа нь БАТАЛНА.  Өмнө нь энэ 409 тэр урсгалыг бүхэлд
   *    нь хаадаг байсан тул админ ганц үсгийн алдааг ч зөвхөн ТАЙЛАНГ
   *    БУЦААЖ (зохиогчийг дахин бөглүүлэх) эсвэл УСТГАЖ (дугаар нь
   *    дараалалдаа завсар үлдээнэ) л засах боломжтой байв.
   *
   *    ТӨЛӨВ ЭНД ХӨДӨЛӨХГҮЙ, зориудаар:
   *      • `submitted` нь `submitted` хэвээр → `PATCH /:id/approve`-ийн
   *        `AND status = 'submitted'` уралдааны хамгаалалт хэвээр ажиллана
   *        (админ засаад шууд батлах зам нээлттэй).
   *      • `approved`-ийг засахад `reviewed_by` / `reviewed_at` /
   *        `review_note` хэвээр үлдэнэ — батлалтын түүхийг ХЭЗЭЭ Ч
   *        чимээгүй арилгахгүй.
   *      • `doc_no` / `seq` / `submitted_at` нь `lib/asrNo.ts`-ийн
   *        `allocateAndSubmit`-аас өөр газар бичигддэггүй тул энэ зам
   *        дугаарлалтад хүрэхгүй.
   *
   *    UI тал (`AsrEditorShell.tsx`) нь энэ дүрмийн ТОЛИН ТУСГАЛ: батлагдсан
   *    тайлан «Засварлах» товчоор ил цоожоо тайлдаг, илгээсэн нь шууд
   *    засагдана.  Хоёр талыг ХАМТ өөрчил.
   *
   * ⚠️ 2026-09-30 (эзний шийдвэр): ЗОХИОГЧ ч ӨӨРИЙН тайлангаа ДУРЫН төлөвт
   *    (хүлээгдэж буй, батлагдсан) засна — зураг нэмэх / солих орно.  Дээрх
   *    «зохиогчид хөлддөг» хөлдөлт ХАСАГДСАН; өөр хүний тайланг зөвхөн админ.
   *    Төлөв, батлалтын түүх (`reviewed_by/at`) хөдлөхгүй — админы засвартай
   *    ИЖИЛ.  `ensureRecordingWrite` ижил дүрэмтэй.
   */

  const body = await c.req.json<AsrPatchBody>().catch(() => ({}) as AsrPatchBody);

  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  const put = (col: string, val: string | number | null) => {
    sets.push(`${col} = ?`);
    args.push(val);
  };

  if (body.report_date !== undefined) {
    if (!isValidDate(body.report_date)) return c.json({ error: 'Огноо буруу байна.' }, 400);
    put('report_date', body.report_date);
  }
  /*
   * `shifr` = ХҮЧИНГҮЙЛЭГЧ.  Хоосон мөр нь `norm` дээр NULL болно — өөрөөр
   * хэлбэл хэрэглэгч талбарыг ЦЭВЭРЛЭВЭЛ тайлан төслийн паспортыг ДАХИН
   * дагаж эхэлнэ (`shapeRow`-ийн тайлбарыг үз).  Энэ бол алдаа биш,
   * «авто» руу буцах ГАНЦ зам.
   */
  if (body.shifr !== undefined) put('shifr', norm(body.shifr));
  // 0363 — «Гэрээний дугаар».  Паспортоос нөхдөггүй тул хоосон = NULL л.
  if (body.contract_no !== undefined) {
    const v = norm(body.contract_no);
    put('contract_no', v ? v.slice(0, 200) : null);
  }
  if (body.doc_types !== undefined) {
    const kinds = Array.isArray(body.doc_types)
      ? body.doc_types.filter((k) => typeof k === 'string' && DOC_KINDS.has(k))
      : [];
    put('doc_types_json', JSON.stringify(kinds));
  }
  if (body.doc_type_other !== undefined) put('doc_type_other', norm(body.doc_type_other));
  if (body.description !== undefined) put('description', norm(body.description));
  if (body.photos !== undefined) {
    const p = sanitizePhotos(body.photos);
    if (!p.ok) return c.json({ error: p.error }, 400);
    put('photos_json', JSON.stringify(p.photos));
  }
  for (const col of ['sig_arch_url', 'sig_site_url'] as const) {
    if (body[col] !== undefined) {
      const s = sanitizeSignatureUrl(body[col]);
      if (!s.ok) return c.json({ error: 'Invalid signature url' }, 400);
      put(col, s.url);
    }
  }
  for (const col of [
    'sig_arch_name',
    'sig_arch_date',
    'sig_site_name',
    'sig_site_date',
    'checked_by_name',
    'checked_by_title',
  ] as const) {
    if (body[col] !== undefined) put(col, norm(body[col]));
  }
  // 0336 — «Ажлын тайлан» дэд хэсгүүд.  Хоосон мөр → NULL (`norm`), урт нь тайрагдана.
  for (const col of ['work_report', 'site_tasks', 'defects'] as const) {
    if (body[col] !== undefined) put(col, normText(body[col]));
  }
  // 0367 — оффис уулзалтын мэдээлэл.  Төрлөөс үл хамааран хадгална (төрөл
  // солиход утга алдагдахгүй); баримт зөвхөн оффис уулзалтад харуулна.
  {
    const mp = meetingPatch(body);
    if (!mp.ok) return c.json({ error: mp.error }, 400);
    for (const [col, v] of mp.cols) put(col, v);
  }
  // 0396 — «0.1 Захиалагч / 0.2 Гүйцэтгэгч» хүснэгтүүд.  Мөн төрлөөс үл хамааран.
  if (body.meeting_requests !== undefined) {
    const mr = sanitizeMeetingRequests(body.meeting_requests);
    if (!mr.ok) return c.json({ error: mr.error }, 400);
    put('meeting_requests_json', mr.json);
  }
  if (body.meeting_doc !== undefined) {
    const md = sanitizeMeetingDoc(body.meeting_doc);
    if (!md.ok) return c.json({ error: md.error }, 400);
    put('meeting_doc_json', md.json);
  }

  /*
   * Тайлангийн төрөл + платформ (0362).
   *
   * ⚠️ «Талбайн хяналт» РУУ шилжүүлэх нь ХАБ-ын хаалгын тойрох зам болж
   *    болохгүй: оффис уулзалт гэж (баталгаагүй) үүсгээд дараа нь «талбай»
   *    болговол талбайн тайлан ХАБ-гүй үлдэнэ.  Тиймээс зохиогч энэ
   *    шилжилтийг зөвхөн тайланд баталгаа аль хэдийн холбогдсон үед (талбай
   *    гэж эхлээд төрлөө сольсон) хийнэ.  Админ чөлөөтэй — тэр бол хянагч,
   *    талбайд очоогүй (эзний «засаад батлах» урсгал, 2026-08-28).
   *    UI-ийн ихэр: `AsrEditorShell`-ийн `canPickSite`.
   */
  const currentType: AsrReportType = isAsrReportType(head.report_type)
    ? head.report_type
    : DEFAULT_ASR_REPORT_TYPE;
  let nextType = currentType;
  if (body.report_type !== undefined) {
    const parsed = parseAsrReportType(body.report_type);
    if (!parsed.ok) return c.json({ error: 'Тайлангийн төрөл буруу байна.' }, 400);
    if (parsed.type && parsed.type !== currentType) {
      if (parsed.type === 'site' && !isAdmin) {
        const ack = await c.env.DB.prepare(
          'SELECT 1 AS x FROM asr_safety_acknowledgements WHERE report_id = ? LIMIT 1',
        )
          .bind(id)
          .first<{ x: number }>();
        if (!ack) {
          return c.json(
            {
              error: `«${ASR_REPORT_TYPE_LABEL_MN.site}» болгохын тулд ХАБ-ын мэдээлэлтэй танилцаж шинэ тайлан үүсгэнэ үү.`,
              code: 'SAFETY_ACK_REQUIRED',
            },
            409,
          );
        }
      }
      nextType = parsed.type;
      put('report_type', nextType);
    }
  }
  // Төрөл солигдоход (эсвэл платформ ирсэн үед) платформыг ДАХИН бодно —
  // цахим уулзалтаас өөр төрөлд хуучин «Zoom» үлдэхгүй.
  if (body.meeting_platform !== undefined || nextType !== currentType) {
    const raw = body.meeting_platform !== undefined ? body.meeting_platform : head.meeting_platform;
    put('meeting_platform', meetingPlatformFor(nextType, raw));
  }

  const teamsGiven = Array.isArray(body.teams);
  const resolutionsGiven = Array.isArray(body.resolutions);
  const companionsGiven = Array.isArray(body.companion_user_ids);
  if (sets.length === 0 && !teamsGiven && !resolutionsGiven && !companionsGiven) {
    return c.json({ error: 'No fields to update' }, 400);
  }

  if (companionsGiven) {
    // Оффис уулзалтын «Оролцсон» (0367) — БҮХ ажилтнаас; талбайн «хамт явсан»
    // нь өөрийн багаас.  ШИНЭ төрлөөр (энэ PATCH-аар солигдсон бол) шийднэ.
    const meeting = usesMeetingForm(nextType);
    const replaced = await replaceCompanions(
      c.env.DB,
      id,
      head.author_id,
      body.companion_user_ids,
      meeting ? { scope: 'all', max: MAX_MEETING_PARTICIPANTS } : {},
    );
    if (!replaced.ok) return c.json({ error: replaced.error }, replaced.status);
  }

  /*
   * ⚠️ `teamsGiven` нь нөхцөлд ЗААВАЛ орно.  Зөвхөн `teams` агуулсан биет
   *    нь `replaceTeams`-ээр багийн бүрэлдэхүүнийг бүтнээр нь солиод
   *    `updated_at`-ыг ХӨДӨЛГӨХГҮЙ үлдээж байсан — өөрөөр хэлбэл
   *    БАТЛАГДСАН тайлангийн хамрах багийг ямар ч ул мөргүй өөрчилж
   *    болно.  `updated_at` бол админы засварын ЦОРЫН ГАНЦ ул мөр
   *    (`edited_by` багана байхгүй) тул түүнийг алдах нь хамгийн муу.
   *    UI нь `patchBodyFrom`-оор үргэлж бүтэн биет илгээдэг учир энэ зам
   *    зөвхөн API-аар хүрнэ — гэхдээ тэр нь шалтгаан биш.
   */
  if (sets.length > 0 || teamsGiven || resolutionsGiven || companionsGiven) {
    sets.push(`updated_at = datetime('now')`);
    args.push(id);
    await c.env.DB.prepare(`UPDATE author_supervision_reports SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...args)
      .run();
  }

  if (teamsGiven) {
    const clean = (body.teams ?? [])
      .filter((t) => t && Number.isFinite(Number(t.team_id)))
      .map((t) => ({ team_id: Number(t.team_id), work_note: t.work_note ?? null }));
    await replaceTeams(c.env.DB, id, clean);
  }

  if (resolutionsGiven) {
    await replaceResolutions(c.env.DB, id, head.project_id, body.resolutions ?? []);
  }

  // Оффис уулзалт (эзэн 2026-10-08): маягтад багийн чагт байхгүй — баг хоосон
  // үлдсэн бол зохиогч + оролцогчдын багаар бөглөнө (`fillMeetingTeams`).
  const filledTeams =
    usesMeetingForm(nextType) && (teamsGiven || companionsGiven || nextType !== currentType)
      ? await fillMeetingTeams(c.env.DB, id, head.author_id)
      : 0;

  // Огноо эсвэл баг (эхний баг = дугаарлах дараалал) өөрчлөгдвөл дугаар
  // шилжинэ (эзний шийдвэр 2026-09-29).  Ноорог дугааргүй тул алгасна.
  if (
    head.status !== 'draft' &&
    (body.report_date !== undefined || teamsGiven || filledTeams > 0)
  ) {
    await renumberAsrProject(c.env.DB, head.project_id);
  }

  const entry = await loadDetail(c.env.DB, id);
  return c.json({ entry });
});

/* ------------------------------------------------------------------ */
/*  POST /:id/submit                                                   */
/* ------------------------------------------------------------------ */

router.post('/:id/submit', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  const head = await c.env.DB.prepare(
    `SELECT r.id, r.project_id, r.author_id, r.status, r.report_date, r.description,
            r.work_report, r.site_tasks, r.defects, r.report_type, r.meeting_platform,
            r.meeting_purpose, r.meeting_requests_json,
            r.red_book_photo_url, r.red_book_absent,
            ${asrLabelSql('p')} AS project_name
       FROM author_supervision_reports r
       JOIN projects p ON p.id = r.project_id
      WHERE r.id = ?`,
  )
    .bind(id)
    .first<{
      id: number;
      project_id: number;
      author_id: number;
      status: AsrStatus;
      report_date: string;
      description: string | null;
      work_report: string | null;
      site_tasks: string | null;
      defects: string | null;
      report_type: string | null;
      meeting_platform: string | null;
      meeting_purpose: string | null;
      meeting_requests_json: string | null;
      red_book_photo_url: string | null;
      red_book_absent: number | null;
      project_name: string;
    }>();
  if (!head) return c.json({ error: 'Not found' }, 404);

  const access = await ensureAsrProjectAccess(c.env.DB, head.project_id, user);
  if (!access.ok) return c.json({ error: access.error }, access.status);
  if (head.author_id !== user.sub && !isAdminRole(user.role)) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  // Илгээхийн өмнөх агуулгын шалгалт.
  if (!isValidDate(head.report_date)) return c.json({ error: 'Огноо оруулна уу.' }, 400);
  const reportType = isAsrReportType(head.report_type) ? head.report_type : DEFAULT_ASR_REPORT_TYPE;
  const meetingForm = usesMeetingForm(reportType);
  // Оффис уулзалтад баг сонгох чагт байхгүй (эзэн 2026-10-08) — хоосон бол
  // зохиогч + оролцогчдын багаар бөглөнө; хэн нь ч багт байхгүй бол баггүй
  // (`DASR-NNN`) илгээгдэнэ.  Бусад төрөлд «дор хаяж нэг баг» хэвээр.
  if (meetingForm) await fillMeetingTeams(c.env.DB, id, head.author_id);
  const teams = await loadTeams(c.env.DB, id);
  if (teams.length === 0 && !meetingForm) {
    return c.json({ error: 'Дор хаяж нэг багийг сонгоно уу.' }, 400);
  }
  // ⚠️ `AsrEditorShell.missingOf`-ийн ТОЛИН ТУСГАЛ — хамт өөрчил.
  // Оффис уулзалт (0367/0396) — маягтад харагдах бичвэр (агуулга, зорилго, хүсэлтийн
  // хүснэгт) аль нэг (Тайлбар,
  // дэд асуултууд тэнд гардаггүй тул тоологдохгүй).
  const hasBody = meetingForm
    ? !!norm(head.work_report) ||
      !!norm(head.meeting_purpose) ||
      hasMeetingRequests(head.meeting_requests_json)
    : !!norm(head.description) ||
      !!norm(head.work_report) ||
      !!norm(head.site_tasks) ||
      !!norm(head.defects) ||
      teams.some((t) => !!norm((t as { work_note?: string | null }).work_note));
  if (!hasBody) {
    return c.json(
      {
        error: meetingForm
          ? 'Уулзалтын агуулгыг бөглөнө үү.'
          : 'Тайлбар эсвэл ажлын тайланг бөглөнө үү.',
      },
      400,
    );
  }
  // 0362 — цахим уулзалтад платформ заавал (`missingOf`-ийн ихэр).
  const typeProblem = reportTypeProblem(reportType, head.meeting_platform);
  if (typeProblem) return c.json({ error: typeProblem }, 400);
  // 0366 — талбайн хяналтад улаан дэвтрийн зураг эсвэл «байгаагүй» заавал
  // (`AsrEditorShell` `redBookGap`-ийн ихэр).
  const rbProblem = redBookProblem(head, requiresRedBook(reportType));
  if (rbProblem) return c.json({ error: rbProblem, code: 'RED_BOOK_REQUIRED' }, 400);

  /*
   * Танилцуулгыг ЭНД цуглуулж, дугаар олгодог УГ UPDATE дотор хөлдөөнө.
   * ⚠️ Уншилт ба бичилтийн хооронд паспорт солигдох онолын цонх үлдэнэ —
   *    хүлээн зөвшөөрсөн: `json_object()`-оор SQL дотор барих нь
   *    `disciplines_json`-ы задралыг SQL руу зөөж, `resolveProjectIdentity`-
   *    ийн шатлалыг ХОЁР ДАХЬ УДАА (энэ удаа SQL-ээр) хуулах шаардлагатай
   *    болно.  Тэр давхардал нь миллисекундын цонхноос хамаагүй үнэтэй.
   */
  const info = await loadLiveProjectInfo(c.env.DB, head.project_id);
  const ok = await allocateAndSubmit(
    c.env.DB,
    id,
    head.project_id,
    new Date().toISOString(),
    info ? serialiseAsrProjectInfo(info) : null,
  );
  if (!ok) return c.json({ error: 'Тайлан илгээгдсэн байна.' }, 409);

  const entry = await loadDetail(c.env.DB, id);
  const docNo = (entry as { doc_no?: string | null } | null)?.doc_no ?? '';
  const link = `/app/asr/${id}`;

  // Тайланд орсон баг бүрийн батлагч руу.  Хэд хэдэн багийг ахалдаг хүн
  // 2-3 мэдэгдэл авч магадгүй — хүлээн зөвшөөрсөн (createNotificationForReviewers-ыг
  // өөрчилбөл progress.ts-ийн зан төлөв эвдэрнэ).
  for (const t of teams) {
    await createNotificationForReviewers(
      c.env.DB,
      Number((t as { team_id: number }).team_id),
      'asr_submitted',
      'Зохиогчийн хяналт — баталгаажуулалт хүлээж байна',
      `${docNo} · ${asrProjectName(head.project_name)}`,
      link,
      user.sub,
    );
  }

  return c.json({ entry });
});

/* ------------------------------------------------------------------ */
/*  PATCH /:id/approve · /:id/reject                                   */
/* ------------------------------------------------------------------ */

async function reviewHead(db: D1Database, id: number) {
  return db
    .prepare(
      `SELECT r.id, r.project_id, r.author_id, r.status, r.doc_no, r.report_type,
              r.red_book_photo_url, r.red_book_absent, ${asrLabelSql('p')} AS project_name
         FROM author_supervision_reports r
         JOIN projects p ON p.id = r.project_id
        WHERE r.id = ?`,
    )
    .bind(id)
    .first<{
      id: number;
      project_id: number;
      author_id: number;
      status: AsrStatus;
      doc_no: string | null;
      report_type: string | null;
      red_book_photo_url: string | null;
      red_book_absent: number | null;
      project_name: string;
    }>();
}

/** Батлах үеийн улаан дэвтрийн шалгалт (0366) — илгээхийн ихэр. */
function approveRedBookProblem(head: {
  report_type: string | null;
  red_book_photo_url: string | null;
  red_book_absent: number | null;
}): string | null {
  const type = isAsrReportType(head.report_type) ? head.report_type : DEFAULT_ASR_REPORT_TYPE;
  return redBookProblem(head, requiresRedBook(type));
}

router.patch('/:id/approve', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  const head = await reviewHead(c.env.DB, id);
  if (!head) return c.json({ error: 'Not found' }, 404);
  const access = await ensureAsrProjectAccess(c.env.DB, head.project_id, user);
  if (!access.ok) return c.json({ error: access.error }, access.status);
  if (!(await canReview(c.env.DB, id, user))) return c.json({ error: 'Forbidden' }, 403);

  const body = await c.req
    .json<{ review_note?: string }>()
    .catch(() => ({}) as { review_note?: string });

  // 0366 — талбайн хяналтыг улаан дэвтрийн зураг / «байгаагүй»-гүйгээр батлахгүй.
  const rbProblem = approveRedBookProblem(head);
  if (rbProblem) return c.json({ error: rbProblem, code: 'RED_BOOK_REQUIRED' }, 400);

  // `AND status = 'submitted'` — хоёр батлагч зэрэг товшихоос хамгаална;
  // `RED_BOOK_OK_SQL` — шалгалтын дараа зураг устгагдах уралдаанаас.
  const res = await c.env.DB.prepare(
    `UPDATE author_supervision_reports
        SET status = 'approved', reviewed_by = ?, reviewed_at = ?, review_note = ?,
            updated_at = datetime('now')
      WHERE id = ? AND status = 'submitted' AND ${RED_BOOK_OK_SQL}`,
  )
    .bind(user.sub, new Date().toISOString(), norm(body.review_note), id)
    .run();
  if ((res.meta.changes ?? 0) === 0) {
    const now = await reviewHead(c.env.DB, id);
    const lateProblem = now && now.status === 'submitted' ? approveRedBookProblem(now) : null;
    if (lateProblem) return c.json({ error: lateProblem, code: 'RED_BOOK_REQUIRED' }, 400);
    return c.json({ error: 'Тайлан илгээгдсэн төлөвт байхгүй байна.' }, 409);
  }

  if (head.author_id !== user.sub) {
    await createNotification(
      c.env.DB,
      head.author_id,
      'asr_approved',
      'Зохиогчийн хяналтын тайлан батлагдлаа',
      `${head.doc_no ?? ''} · ${asrProjectName(head.project_name)}`,
      `/app/asr/${id}`,
    );
  }

  return c.json({ entry: await loadDetail(c.env.DB, id) });
});

router.patch('/:id/reject', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  const head = await reviewHead(c.env.DB, id);
  if (!head) return c.json({ error: 'Not found' }, 404);
  const access = await ensureAsrProjectAccess(c.env.DB, head.project_id, user);
  if (!access.ok) return c.json({ error: access.error }, access.status);
  if (!(await canReview(c.env.DB, id, user))) return c.json({ error: 'Forbidden' }, 403);

  const body = await c.req
    .json<{ review_note?: string }>()
    .catch(() => ({}) as { review_note?: string });
  const note = norm(body.review_note);
  if (!note) return c.json({ error: 'Буцаах шалтгааныг бичнэ үү.' }, 400);

  const res = await c.env.DB.prepare(
    `UPDATE author_supervision_reports
        SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, review_note = ?,
            updated_at = datetime('now')
      WHERE id = ? AND status = 'submitted'`,
  )
    .bind(user.sub, new Date().toISOString(), note, id)
    .run();
  if ((res.meta.changes ?? 0) === 0) {
    return c.json({ error: 'Тайлан илгээгдсэн төлөвт байхгүй байна.' }, 409);
  }

  if (head.author_id !== user.sub) {
    await createNotification(
      c.env.DB,
      head.author_id,
      'asr_rejected',
      'Зохиогчийн хяналтын тайлан буцаагдлаа',
      note,
      `/app/asr/${id}`,
    );
  }

  return c.json({ entry: await loadDetail(c.env.DB, id) });
});

/* ------------------------------------------------------------------ */
/*  /:id/red-book — улаан дэвтрийн гарын үсгийн баталгаа (0279)        */
/* ------------------------------------------------------------------ */
/**
 * Талбайд очих бүрд захиалагчийн «улаан дэвтэр» (ажлын журнал) дээр
 * гарын үсэг зуруулах ёстой.  Апп дахь нотолгоо нь тэр хуудасны ЗУРАГ;
 * эрх бүхий хүн зургийг хараад БАТАЛГААЖУУЛНА.
 *
 * Эзний урсгал (2026-09-10, 2026-09-30-нд өөрчлөгдсөн):
 *   • тайлан үүсгэхэд сануулна;
 *   • ТАЛБАЙН ХЯНАЛТЫГ зураггүйгээр илгээх / батлахгүй (0366) — зохиогч
 *     «Талбай дээр улаан дэвтэр байгаагүй» (`red_book_absent`) гэж
 *     тэмдэглэсэн үед л чөлөөлөгдөнө; бусад төрөл, PDF хэзээ ч хаагдахгүй.
 *     Дүрэм нь `lib/asrRedBook.ts`;
 *   • эрх бүхий хүн баталгаажуулмагц «Улаан дэвтэр баталгаажсан»
 *     (сонголттой — зураг хавсаргасан байхад шаардлага хангана).
 *
 * ⚠️ ЗУРАГ НЬ ТАЙЛАНГИЙН ХӨЛДӨЛТӨӨС ГАДУУР.  `PATCH /:id` нь зохиогчид
 *    `draft|rejected`-ээс гадуур 409 өгдөг — гэтэл улаан дэвтрийн гарын
 *    үсэг ихэвчлэн тайлан илгээгдсэний ДАРАА (дараагийн очилтоор) нөхөж
 *    авдаг.  Тиймээс тусдаа endpoint: зохиогч/админ ДУРЫН төлөвт хавсаргана.
 *    Цорын ганц цоож нь БАТАЛГААЖСАН эсэх — баталгаажуулагчийн харсан
 *    зураг чимээгүй солигдох ёсгүй; солих бол эхлээд баталгааг цуцална.
 *
 * ⚠️ Төлөв ХАДГАЛАГДДАГГҮЙ (`redBookStatusOf`) — status багана нэмвэл
 *    зурагтай зөрөх хоёр дахь эх сурвалж болно.
 */

async function redBookHead(db: D1Database, id: number) {
  return db
    .prepare(
      `SELECT project_id, author_id, status, report_type, red_book_photo_url,
              red_book_verified_at, red_book_absent
         FROM author_supervision_reports WHERE id = ?`,
    )
    .bind(id)
    .first<{
      project_id: number;
      author_id: number;
      status: AsrStatus;
      report_type: string | null;
      red_book_photo_url: string | null;
      red_book_verified_at: string | null;
      red_book_absent: number | null;
    }>();
}

function redBookRequiredFor(head: { report_type: string | null }): boolean {
  return requiresRedBook(isAsrReportType(head.report_type) ? head.report_type : DEFAULT_ASR_REPORT_TYPE);
}

router.patch('/:id/red-book', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  const head = await redBookHead(c.env.DB, id);
  if (!head) return c.json({ error: 'Not found' }, 404);
  const access = await ensureAsrProjectAccess(c.env.DB, head.project_id, user);
  if (!access.ok) return c.json({ error: access.error }, access.status);
  // Зохиогч эсвэл админ — `PATCH /:id`-ийн эзэмшлийн gate, ХӨЛДӨЛТГҮЙ.
  if (head.author_id !== user.sub && !isAdminRole(user.role)) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  if (head.red_book_verified_at) {
    return c.json(
      { error: 'Улаан дэвтэр баталгаажсан байна. Солихын тулд эхлээд баталгааг цуцална уу.' },
      409,
    );
  }

  const body = await c.req
    .json<{ photo_url?: unknown }>()
    .catch(() => ({}) as { photo_url?: unknown });
  const s = sanitizeSignatureUrl(body.photo_url);
  if (!s.ok) return c.json({ error: 'Invalid photo url' }, 400);

  // 0366 — илгээгдсэн талбайн тайлангаас зургийг устгаж хоосон үлдээхгүй (солих чөлөөтэй).
  const clearProblem = redBookClearProblem(head.status, redBookRequiredFor(head), {
    red_book_photo_url: s.url,
    red_book_absent: head.red_book_absent,
  });
  if (clearProblem) return c.json({ error: clearProblem, code: 'RED_BOOK_REQUIRED' }, 409);

  // Зураг ирвэл «байгаагүй» тэмдэглэгээ утгагүй болно — цэвэрлэнэ.
  await c.env.DB.prepare(
    `UPDATE author_supervision_reports
        SET red_book_photo_url = ?,
            red_book_absent = CASE WHEN ? IS NOT NULL THEN 0 ELSE red_book_absent END,
            updated_at = datetime('now')
      WHERE id = ?`,
  )
    .bind(s.url, s.url, id)
    .run();

  return c.json({ entry: await loadDetail(c.env.DB, id) });
});

/**
 * «Талбай дээр улаан дэвтэр байгаагүй» (0366) — зурагтай ижил эрх, ижил
 * хөлдөлтгүй зам (зохиогч / админ, дурын төлөвт), ижил цоож (баталгаажсан бол
 * 409).  Зураг хавсаргасан тайланд тэмдэглэх утгагүй — 409.  Илгээгдсэн /
 * батлагдсан талбайн тайлан дээр зураггүй үед болиулж болохгүй
 * (`redBookClearProblem`).
 */
router.patch('/:id/red-book/absent', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  const head = await redBookHead(c.env.DB, id);
  if (!head) return c.json({ error: 'Not found' }, 404);
  const access = await ensureAsrProjectAccess(c.env.DB, head.project_id, user);
  if (!access.ok) return c.json({ error: access.error }, access.status);
  if (head.author_id !== user.sub && !isAdminRole(user.role)) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  if (head.red_book_verified_at) {
    return c.json({ error: 'Улаан дэвтэр баталгаажсан байна.' }, 409);
  }

  const body = await c.req
    .json<{ absent?: unknown }>()
    .catch(() => ({}) as { absent?: unknown });
  if (typeof body.absent !== 'boolean') return c.json({ error: 'absent must be boolean' }, 400);
  const absent = body.absent;

  if (absent && head.red_book_photo_url) {
    return c.json(
      { error: 'Улаан дэвтрийн зураг хавсаргасан байна. Эхлээд зургийг устгана уу.' },
      409,
    );
  }
  const clearProblem = redBookClearProblem(head.status, redBookRequiredFor(head), {
    red_book_photo_url: head.red_book_photo_url,
    red_book_absent: absent ? 1 : 0,
  });
  if (clearProblem) return c.json({ error: clearProblem, code: 'RED_BOOK_REQUIRED' }, 409);

  await c.env.DB.prepare(
    `UPDATE author_supervision_reports
        SET red_book_absent = ?, updated_at = datetime('now')
      WHERE id = ?`,
  )
    .bind(absent ? 1 : 0, id)
    .run();

  return c.json({ entry: await loadDetail(c.env.DB, id) });
});

/**
 * Баталгаажуулах эрх = `canReview` (админ, эсвэл тайланд орсон багийн
 * senior) — тайлан батлах эрхтэй яг тэр хүмүүс.  Ноорог дээр УТГАГҮЙ
 * (ноорог нь хараахан очилт биш — очилтын тоолуур ч түүнийг тоолдоггүй),
 * зураггүй бол баталгаажуулах ЮМ БАЙХГҮЙ.
 */
router.post('/:id/red-book/verify', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  const head = await redBookHead(c.env.DB, id);
  if (!head) return c.json({ error: 'Not found' }, 404);
  const access = await ensureAsrProjectAccess(c.env.DB, head.project_id, user);
  if (!access.ok) return c.json({ error: access.error }, access.status);
  if (!(await canReview(c.env.DB, id, user))) return c.json({ error: 'Forbidden' }, 403);
  if (head.status === 'draft') {
    return c.json({ error: 'Ноорог тайлангийн улаан дэвтрийг баталгаажуулахгүй.' }, 409);
  }
  if (!head.red_book_photo_url) {
    return c.json({ error: 'Улаан дэвтрийн зураг хавсаргаагүй байна.' }, 400);
  }

  // Уралдааны хамгаалалт — approve-ийн `AND status = 'submitted'`-ийн ижил хэлбэр.
  const res = await c.env.DB.prepare(
    `UPDATE author_supervision_reports
        SET red_book_verified_by = ?, red_book_verified_at = ?, updated_at = datetime('now')
      WHERE id = ? AND red_book_verified_at IS NULL AND red_book_photo_url IS NOT NULL`,
  )
    .bind(user.sub, new Date().toISOString(), id)
    .run();
  if ((res.meta.changes ?? 0) === 0) {
    return c.json({ error: 'Улаан дэвтэр аль хэдийн баталгаажсан байна.' }, 409);
  }

  return c.json({ entry: await loadDetail(c.env.DB, id) });
});

/** Баталгааг цуцлах — буруу зураг баталгаажуулсан бол засах цорын ганц зам. */
router.delete('/:id/red-book/verify', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  const head = await redBookHead(c.env.DB, id);
  if (!head) return c.json({ error: 'Not found' }, 404);
  const access = await ensureAsrProjectAccess(c.env.DB, head.project_id, user);
  if (!access.ok) return c.json({ error: access.error }, access.status);
  if (!(await canReview(c.env.DB, id, user))) return c.json({ error: 'Forbidden' }, 403);

  const res = await c.env.DB.prepare(
    `UPDATE author_supervision_reports
        SET red_book_verified_by = NULL, red_book_verified_at = NULL,
            updated_at = datetime('now')
      WHERE id = ? AND red_book_verified_at IS NOT NULL`,
  )
    .bind(id)
    .run();
  if ((res.meta.changes ?? 0) === 0) {
    return c.json({ error: 'Улаан дэвтэр баталгаажаагүй байна.' }, 409);
  }

  return c.json({ entry: await loadDetail(c.env.DB, id) });
});

/* ------------------------------------------------------------------ */
/*  /:id/recordings — талбайн дуу бичлэг → текст (Speechmatics)        */
/* ------------------------------------------------------------------ */
/**
 * Талбай дээр бээлийтэй, шаттай, шуургатай инженер бичиж чаддаггүй.
 * Тиймээс ярьж бичүүлээд, Speechmatics текст болгож, тэр текстийг
 * «Тайлбар» эсвэл багийн «Ажлын тайлан» руу өөрөө оруулна.
 *
 * ⚠️ АУДИО НЬ `MEETING_BUCKET`-Д (PRIVATE R2) ОЧНО, `MEDIA_BUCKET`-Д БИШ.
 *    Binding-ийн нэр «MEETING» гэдэг нь хуучирсан — тэр bucket бол «STT-д
 *    зориулсан хувийн bucket», зөвхөн хурлынх биш.  `/media/:key` бол
 *    баталгаажуулалтгүй, түлхүүрээ мэдсэн хэн ч уншдаг (CLAUDE.md →
 *    Security #2) тул талбайн дуу бичлэг тэнд ОРОХГҮЙ.  Клиент нь
 *    `POST /api/upload?bucket=meeting`-ээр байршуулаад ЗӨВХӨН түлхүүрээ
 *    энд өгнө; уншилт нь гарын үсэгтэй `/meeting-audio/:key?t=`.
 *
 * Push-to-talk (олон сегмент → нэг бүтэн audio) нь ЭНЭ endpoint-ыг
 * өөрчлөхгүй: хөтөч нэг `MediaRecorder`-ийг `pause()`/`resume()` хийж нэг
 * бүтэн контейнер үүсгэвэл нэг мөр, чадахгүй бол сегмент бүрийг тусад нь
 * илгээж `sort_order`-оор эрэмбэлнэ.
 */

/** Бичлэг нэмэх/устгах эрх — PATCH-ийн яг тэр gate. */
async function ensureRecordingWrite(
  db: D1Database,
  reportId: number,
  user: Viewer,
): Promise<
  | { ok: true; head: { project_id: number; author_id: number; status: AsrStatus } }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string }
> {
  const head = await db
    .prepare('SELECT project_id, author_id, status FROM author_supervision_reports WHERE id = ?')
    .bind(reportId)
    .first<{ project_id: number; author_id: number; status: AsrStatus }>();
  if (!head) return { ok: false, status: 404, error: 'Not found' };

  const access = await ensureAsrProjectAccess(db, head.project_id, user);
  if (!access.ok) return { ok: false, status: access.status, error: access.error };

  const isAdmin = isAdminRole(user.role);
  if (head.author_id !== user.sub && !isAdmin) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  // PATCH-тай ИЖИЛ дүрэм: зохиогч өөрийн тайланг, админ дурын тайланг
  // ДУРЫН төлөвт (2026-09-30-аас зохиогчийн хөлдөлт хасагдсан).  Энэ ХОЁР
  // gate ХАМТ хөдөлнө — эс бөгөөс «Тайлбар»-ыг засаж чадах атлаа түүнийг
  // үүсгэсэн дуу бичлэгийн транскриптийг засаж чадахгүй хагас эрх үүснэ.
  return { ok: true, head };
}

/** Ноорогийн явцыг богино query-гээр асуух (транскрипц хүлээх poll). */
router.get('/:id/recordings', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  const head = await c.env.DB.prepare(
    'SELECT project_id, author_id, status FROM author_supervision_reports WHERE id = ?',
  )
    .bind(id)
    .first<{ project_id: number; author_id: number; status: AsrStatus }>();
  if (!head) return c.json({ error: 'Not found' }, 404);

  const access = await ensureAsrProjectAccess(c.env.DB, head.project_id, user);
  if (!access.ok) return c.json({ error: access.error }, access.status);
  if (head.status === 'draft' && head.author_id !== user.sub && !isAdminRole(user.role)) {
    return c.json({ error: 'Not found' }, 404);
  }
  if (!(await canSeeAsrReport(c.env.DB, id, viewerOf(user)))) {
    return c.json({ error: 'Not found' }, 404);
  }

  return c.json({ recordings: await loadRecordings(c.env.DB, id) });
});

interface AsrRecordingBody {
  audio_key?: unknown;
  content_type?: unknown;
  size_bytes?: unknown;
  duration_seconds?: unknown;
  sort_order?: unknown;
  language?: unknown;
}

router.post('/:id/recordings', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  const gate = await ensureRecordingWrite(c.env.DB, id, user);
  if (!gate.ok) return c.json({ error: gate.error }, gate.status);

  const body = await c.req.json<AsrRecordingBody>().catch(() => ({}) as AsrRecordingBody);
  const audioKey = typeof body.audio_key === 'string' ? body.audio_key : '';
  if (!audioKey) return c.json({ error: 'audio_key шаардлагатай' }, 400);
  // Түлхүүр нь сервер талд `<userSub>-<ts>-<name>` болж үүсдэг
  // (`routes/upload.ts`), тул өөрийн дөнгөж байршуулсан объектыг л
  // хавсаргаж чадна — `meetings.ts:183`-ийн `ownsKey` шалгалт.
  if (!audioKey.startsWith(`${user.sub}-`)) {
    return c.json({ error: 'Forbidden audio key' }, 403);
  }

  const count = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM asr_recordings WHERE report_id = ?',
  )
    .bind(id)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_RECORDINGS) {
    return c.json({ error: `Нэг тайланд дээд тал нь ${MAX_RECORDINGS} бичлэг хавсаргана.` }, 400);
  }

  // Объект үнэхээр хувийн bucket-д буусан эсэх + бодит хэмжээ/төрөл.
  const objHead = await c.env.MEETING_BUCKET.head(audioKey);
  if (!objHead) return c.json({ error: 'Дуу бичлэг олдсонгүй (upload амжилтгүй?)' }, 400);

  const contentType =
    typeof body.content_type === 'string' && body.content_type
      ? body.content_type.slice(0, 100)
      : (objHead.httpMetadata?.contentType ?? null);
  const sizeBytes =
    typeof body.size_bytes === 'number' && Number.isFinite(body.size_bytes)
      ? body.size_bytes
      : objHead.size;
  const durationSeconds =
    typeof body.duration_seconds === 'number' &&
    Number.isFinite(body.duration_seconds) &&
    body.duration_seconds > 0
      ? body.duration_seconds
      : null;
  const sortOrder =
    typeof body.sort_order === 'number' && Number.isFinite(body.sort_order)
      ? Math.trunc(body.sort_order)
      : (count?.n ?? 0);
  const language =
    typeof body.language === 'string' && body.language.trim() ? body.language.trim() : 'mn';

  const ins = await c.env.DB.prepare(
    `INSERT INTO asr_recordings
       (report_id, audio_key, content_type, size_bytes, duration_seconds,
        stt_status, language, sort_order, created_by_id)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
  )
    .bind(id, audioKey, contentType, sizeBytes, durationSeconds, language, sortOrder, user.sub)
    .run();
  const recordingId = Number(ins.meta.last_row_id);

  if (!c.env.SPEECHMATICS_API_KEY) {
    await c.env.DB.prepare(
      `UPDATE asr_recordings
          SET stt_status='error', error='SPEECHMATICS_API_KEY тохируулагдаагүй',
              completed_at=datetime('now')
        WHERE id=?`,
    )
      .bind(recordingId)
      .run();
    return c.json({ recordings: await loadRecordings(c.env.DB, id) }, 201);
  }

  try {
    const jobId = await submitJob({
      env: c.env,
      origin: new URL(c.req.url).origin,
      // Хурлын `mid=` замыг огт хөндөхгүй — өөрийн query-гээ өгнө.
      callbackQuery: `kind=asr&rid=${recordingId}`,
      audioKey,
      language,
      user: { sub: user.sub, role: user.role },
    });
    await c.env.DB.prepare(
      `UPDATE asr_recordings
          SET stt_job_id=?, stt_status='running', submitted_at=datetime('now')
        WHERE id=?`,
    )
      .bind(jobId, recordingId)
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'STT submit failed';
    await c.env.DB.prepare(
      `UPDATE asr_recordings SET stt_status='error', error=?, completed_at=datetime('now') WHERE id=?`,
    )
      .bind(msg.slice(0, 300), recordingId)
      .run();
  }

  return c.json({ recordings: await loadRecordings(c.env.DB, id) }, 201);
});

/**
 * Транскриптийг ГАРААР засах.
 *
 * Speechmatics нь талбайн чимээ, барилгын нэр томьёо, овог нэрийг тогтмол
 * буруу сонсдог тул инженер текстээ «Тайлбар» эсвэл багийн хэсэг рүү
 * оруулахын ӨМНӨ энд шууд засварлана.  Транскрипц бүтэлгүйтсэн мөр дээр ч
 * ажиллана — тэр тохиолдолд энэ нь «дууг сонсоод гараар бичих» зам болно.
 *
 * ⚠️ Засвар нь `transcript_text`-ийг ДАРЖ бичнэ.  Анхны түүхий хувилбарыг
 *    хадгалах багана ЗОРИУДААР нэмээгүй (шийдвэр 2026-08-21): талбайн
 *    бичлэг бол албан баримт биш, ноорог түүхий эд — албан баримт нь
 *    тайлангийн «Тайлбар» талбар өөрөө бөгөөд тэр нь `updated_at`-аараа
 *    аудитлагддаг.  Клиент нь хадгалагдаагүй засварыг localStorage-д
 *    тусад нь барьдаг тул сүлжээ унасан ч текст алдагдахгүй.
 *
 * ⚠️ Хараахан дуусаагүй (pending|running) бичлэгийг ЗАСУУЛАХГҮЙ — webhook
 *    дуусахдаа `transcript_text`-ийг дарж бичих тул хүний засвар чимээгүй
 *    алга болно.
 */
router.patch('/:id/recordings/:recordingId', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const recordingId = Number(c.req.param('recordingId'));
  if (!Number.isFinite(id) || !Number.isFinite(recordingId)) {
    return c.json({ error: 'Invalid id' }, 400);
  }

  // Бичлэг нэмэх/устгахтай ЯГ ижил gate: төслийн хандалт + зохиогч/админ
  // (дурын төлөвт — `ensureRecordingWrite`).
  const gate = await ensureRecordingWrite(c.env.DB, id, user);
  if (!gate.ok) return c.json({ error: gate.error }, gate.status);

  const body = await c.req
    .json<{ transcript_text?: unknown }>()
    .catch(() => ({}) as { transcript_text?: unknown });
  if (typeof body.transcript_text !== 'string') {
    return c.json({ error: 'transcript_text шаардлагатай' }, 400);
  }
  const text = body.transcript_text.trim().slice(0, MAX_TRANSCRIPT_CHARS);

  const row = await c.env.DB.prepare(
    'SELECT stt_status FROM asr_recordings WHERE id = ? AND report_id = ?',
  )
    .bind(recordingId, id)
    .first<{ stt_status: string | null }>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.stt_status === 'pending' || row.stt_status === 'running') {
    return c.json({ error: 'Текст болгож дуусаагүй байна — түр хүлээнэ үү.' }, 409);
  }

  // Хоосон болгосон бол NULL — UI нь `transcript_text`-ийн хоосон эсэхээр
  // «Оруулах» чипүүдийг харуулдаг тул '' ба NULL хоёр ялгаагүй байх ёстой.
  await c.env.DB.prepare('UPDATE asr_recordings SET transcript_text = ? WHERE id = ?')
    .bind(text || null, recordingId)
    .run();

  return c.json({ recordings: await loadRecordings(c.env.DB, id) });
});

router.delete('/:id/recordings/:recordingId', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const recordingId = Number(c.req.param('recordingId'));
  if (!Number.isFinite(id) || !Number.isFinite(recordingId)) {
    return c.json({ error: 'Invalid id' }, 400);
  }

  const gate = await ensureRecordingWrite(c.env.DB, id, user);
  if (!gate.ok) return c.json({ error: gate.error }, gate.status);

  const row = await c.env.DB.prepare(
    'SELECT audio_key FROM asr_recordings WHERE id = ? AND report_id = ?',
  )
    .bind(recordingId, id)
    .first<{ audio_key: string }>();
  if (!row) return c.json({ error: 'Not found' }, 404);

  // R2-г эхлээд.  Амжилтгүй бол мөрөө үлдээхгүй — өнчин объект нь өнчин
  // мөрөөс дээр (мөр байвал UI нь хэзээ ч дуусахгүй бичлэг харуулна).
  try {
    await c.env.MEETING_BUCKET.delete(row.audio_key);
  } catch (err) {
    console.warn('[asr] R2 delete failed', row.audio_key, err);
  }
  await c.env.DB.prepare('DELETE FROM asr_recordings WHERE id = ?').bind(recordingId).run();

  return c.json({ recordings: await loadRecordings(c.env.DB, id) });
});

/* ------------------------------------------------------------------ */
/*  GET /:id/pdf — сервер талын PDF (Browser Rendering)                */
/* ------------------------------------------------------------------ */
/**
 * `routes/projects.ts`-ийн багийн тайлангийн PDF-ийн яг тэр жор:
 * 1 минутын насны токен → `/app/projects/:id/asr/:reportId/print?t=…` →
 * `body[data-print-ready="true"]`-г хүлээгээд `page.pdf()`.
 *
 * ⚠️ `preferCSSPageSize: true` ба margin ӨГӨХГҮЙ.  Хэвлэх хуудас нь өөрөө
 *    `@page { size: A4 portrait; margin: 10mm 19.1mm 25.4mm }` зарладаг
 *    (Word загварын зай) — ямар нэг `@page` зарлагдмагц Chromium CSS-ийн
 *    хуудасны загварт шилжиж, puppeteer-ийн margin үйлчлэхээ болино.
 *    Хоёуланг нь өгвөл зай давхарлаж агуулга багасна.
 *
 * ⚠️ Кирилл: headless Chromium-д Arial БАЙХГҮЙ тул хэвлэх хуудас нь Arimo
 *    вэб фонтыг `@import`-оор татдаг (`asrPrintStyles.ts`).  Тиймээс
 *    `networkidle0` хүлээх нь чухал — фонт ирэхээс өмнө зурвал ү/ө эвдэрнэ.
 */
router.get('/:id/pdf', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  const head = await c.env.DB.prepare(
    // ⚠️ `shifr` нь override тул хөлдөөгүй (ноорог) тайлан дээр NULL байж
    //    болно — файлын нэр `PROJECT_ASR_draft` болж шифргүй үлдэхгүйн тулд
    //    паспортоор нөхнө.  Энд ТОДОРХОЙ баганын жагсаалт тул `shifr` гэж
    //    alias хийхэд давхардал үүсэхгүй.
    `SELECT r.id, r.project_id, r.author_id, r.status, r.seq, r.doc_no, r.report_date,
            COALESCE(NULLIF(TRIM(r.shifr), ''), NULLIF(TRIM(pp.drawing_no), '')) AS shifr,
            p.name AS project_name,
            (SELECT t.code FROM author_supervision_report_teams rt
               JOIN teams t ON t.id = rt.team_id
              WHERE rt.report_id = r.id
              ORDER BY rt.sort_order, rt.team_id LIMIT 1) AS team_code
       FROM author_supervision_reports r
       LEFT JOIN project_passport pp ON pp.project_id = r.project_id
       LEFT JOIN projects p ON p.id = r.project_id
      WHERE r.id = ?`,
  )
    .bind(id)
    .first<{
      id: number;
      project_id: number;
      author_id: number;
      status: AsrStatus;
      seq: number | null;
      doc_no: string | null;
      report_date: string;
      shifr: string | null;
      project_name: string | null;
      team_code: string | null;
    }>();
  if (!head) return c.json({ error: 'Not found' }, 404);

  const access = await ensureAsrProjectAccess(c.env.DB, head.project_id, user);
  if (!access.ok) return c.json({ error: access.error }, access.status);
  // Ноорог зөвхөн зохиогч + админд (жагсаалтын дүрэмтэй ижил).
  if (head.status === 'draft' && head.author_id !== user.sub && !isAdminRole(user.role)) {
    return c.json({ error: 'Not found' }, 404);
  }
  // Багийн харагдац — `GET /:id`-тэй ижил (хэвлэх хуудас ч тэр замаар уншина).
  if (!(await canSeeAsrReport(c.env.DB, id, viewerOf(user)))) {
    return c.json({ error: 'Not found' }, 404);
  }

  const printToken = await signToken(
    { sub: user.sub, role: user.role, purpose: 'print' },
    c.env.JWT_SECRET,
    1 / 60, // цаг → 1 минут
  );
  const printUrl =
    `${c.env.FRONTEND_URL.replace(/\/+$/, '')}/app/projects/${head.project_id}/asr/${id}/print` +
    `?t=${encodeURIComponent(printToken)}`;

  let browser: BrowserSession | null = null;
  try {
    browser = await launchBrowser(c.env.BROWSER);
    const page = await browser.newPage();
    await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 1 });
    await page.goto(printUrl, { waitUntil: 'networkidle0', timeout: 30000 });
    try {
      await page.waitForSelector('body[data-print-ready="true"]', { timeout: 25000 });
    } catch {
      /* юу зурагдсаныг нь авна */
    }

    /*
     * Хуудасны ТОЛГОЙ/ХӨЛ БАЙХГҮЙ (эзэн 2026-09-28): лого нь баримтын толгойд
     * (Word загварын header1.xml), хуудасны дугаар ч хэрэггүй.  Цаасны зай нь
     * хуудсан дотроо — `@page` margin 0, дээд/доод нь давтагдах thead/tfoot,
     * хажуу нь padding (`frontend/.../asrPrintStyles.ts`).  Тиймээс энд ч
     * margin 0 — зөрвөл агуулга хоёр дахин зайтай болно.
     */
    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });

    // `260925_MGL-251006_DASR_BB_015.pdf` — `lib/asrNo.ts` `asrFileStem`
    // (frontend-ийн Word нэртэй ихэр; эзэн 2026-09-28: шифр БИШ, төслийн ID).
    const safe = asrFileStem({
      reportDate: head.report_date,
      projectName: head.project_name,
      teamCode: head.team_code,
      seq: head.seq,
      docNo: head.doc_no,
    });

    return new Response(pdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        // ⚠️ `safe` нь `\p{L}`-ыг үлдээдэг тул шифр КИРИЛЛ байвал файлын нэр
        //    кирилл болно.  HTTP толгой нь latin-1 тул түүхий UTF-8 нь
        //    хөтөч дээр «Ð¼Ð¾Ð¶Ð¸Ð±ÐµÐ¹Ðº» болж унадаг.  RFC 5987 `filename*`
        //    нэмж өгнө — дэмждэггүй хуучин хөтөч энгийн `filename`-ыг авна.
        'Content-Disposition':
          `attachment; filename="${safe.replace(/[^ -~]/g, '_')}.pdf"; ` +
          `filename*=UTF-8''${encodeURIComponent(safe + '.pdf')}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[asr-pdf] render failed', err);
    return c.json(
      {
        error: 'PDF үүсгэхэд алдаа гарлаа',
        detail: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* swallow */
      }
    }
  }
});

/* ------------------------------------------------------------------ */
/*  DELETE /:id                                                        */
/* ------------------------------------------------------------------ */

router.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  const head = await c.env.DB.prepare(
    'SELECT project_id, author_id, status FROM author_supervision_reports WHERE id = ?',
  )
    .bind(id)
    .first<{ project_id: number; author_id: number; status: AsrStatus }>();
  if (!head) return c.json({ error: 'Not found' }, 404);

  const access = await ensureAsrProjectAccess(c.env.DB, head.project_id, user);
  if (!access.ok) return c.json({ error: access.error }, access.status);

  const isAdmin = isAdminRole(user.role);
  const ownDraft = head.author_id === user.sub && head.status === 'draft';
  if (!isAdmin && !ownDraft) return c.json({ error: 'Forbidden' }, 403);

  // Дуу бичлэгийн R2 объектуудыг ГАРААР устгана.  `asr_recordings` мөрүүд
  // нь CASCADE-аар явна ч R2 нь FK мэдэхгүй — үлдвэл хэн ч мэдэхгүй,
  // ямар ч замаар хүрэхгүй байтууд private bucket-д мөнхөд хуримтлагдана.
  // (`meetings.ts:543`-ийн яг тэр хэв маяг.)  Зураг нь `MEDIA_BUCKET`-д
  // үлдэнэ — тэр нь бусад хавсралттай нэгэн адил, өөрчлөөгүй.
  const { results: recs } = await c.env.DB.prepare(
    'SELECT audio_key FROM asr_recordings WHERE report_id = ?',
  )
    .bind(id)
    .all<{ audio_key: string }>();
  for (const r of recs ?? []) {
    try {
      await c.env.MEETING_BUCKET.delete(r.audio_key);
    } catch (err) {
      console.warn('[asr] R2 delete failed', r.audio_key, err);
    }
  }

  // 0336 — шийдлийн мөрүүдийг ГАРААР: D1 нь FK-г ажиллагааны үед хэрэгждэггүй.
  // Энэ тайланг иш татсан ДАРААГИЙН тайлангуудын мөр УСТАХГҮЙ — зөвхөн холбоос
  // нь NULL болж, цооног (prev_doc_no / prev_report_date) үлдэнэ.
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM asr_issue_resolutions WHERE report_id = ?').bind(id),
    c.env.DB.prepare(
      'UPDATE asr_issue_resolutions SET prev_report_id = NULL WHERE prev_report_id = ?',
    ).bind(id),
    c.env.DB.prepare('DELETE FROM asr_report_companions WHERE report_id = ?').bind(id),
    // 0381: устгагдсан тайланд хүлээгдэж буй public гарын үсгийн link үлдэж болохгүй.
    c.env.DB.prepare(
      `UPDATE public_document_sign_requests
          SET status = 'revoked', revoked_at = datetime('now'), updated_at = datetime('now')
        WHERE kind = 'asr' AND entity_id = ? AND status = 'pending'`,
    ).bind(id),
  ]);

  // Бусад child мөрүүд ON DELETE CASCADE-аар устана.
  await c.env.DB.prepare('DELETE FROM author_supervision_reports WHERE id = ?').bind(id).run();
  // Дугаартай тайлан уствал тэр багийн дараагийн тайлангууд нэгээр ухарна —
  // дугаар үргэлж огнооны дарааллаар завсаргүй 1..N (эзний шийдвэр 2026-09-29).
  if (head.status !== 'draft') await renumberAsrProject(c.env.DB, head.project_id);
  return c.json({ ok: true });
});

export default router;
