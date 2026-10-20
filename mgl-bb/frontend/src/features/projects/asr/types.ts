/** Зохиогчийн хяналт (Author's Supervision Report) — frontend төрлүүд. */
import { brand } from '@/shared/config/brand';
import { emptyRequestItem, toRequestItem, type MeetingDocExtra, type MeetingRequests } from './meetingDoc';

export type AsrStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

/**
 * Улаан дэвтрийн гарын үсгийн төлөв (миграц 0279).
 *
 * ⚠️ ИХЭР: `backend/src/lib/asrRedBook.ts` (`AsrRedBookStatus`,
 *    `redBookStatusOf`, `redBookProblem`).  Төлөв нь ХАДГАЛАГДДАГГҮЙ —
 *    баганаас гарган авна, тиймээс энд ч дахин гаргана (хадгалаагүй тайлан
 *    дээр сервер талбар байхгүй).
 *
 *   missing  — зураг ч, баталгаа ч алга («Гарын үсэг дутуу»);
 *   absent   — «Талбай дээр улаан дэвтэр байгаагүй» гэж тэмдэглэсэн (0366);
 *   signed   — зураг хавсаргасан, баталгаажуулалт хүлээж байна;
 *   verified — эрх бүхий хүн баталгаажуулсан.
 */
export type AsrRedBookStatus = 'missing' | 'absent' | 'signed' | 'verified';

type RedBookFields = Pick<AsrReport, 'red_book_photo_url' | 'red_book_verified_at' | 'red_book_absent'>;

export function isRedBookAbsent(v: unknown): boolean {
  return v === 1 || v === true || v === '1';
}

export function redBookStatusOf(entry: RedBookFields): AsrRedBookStatus {
  if (entry.red_book_verified_at) return 'verified';
  if (entry.red_book_photo_url) return 'signed';
  if (isRedBookAbsent(entry.red_book_absent)) return 'absent';
  return 'missing';
}

/**
 * Талбайн хяналтыг илгээх / батлахад улаан дэвтрийн зураг ЭСВЭЛ «байгаагүй»
 * тэмдэглэгээ заавал (0366, эзэн 2026-09-30); бусад төрөлд шаардахгүй.
 * `true` = дутуу.  Серверийн `redBookProblem`-ийн ихэр.
 */
export function redBookGap(entry: RedBookFields, reportType: AsrReportType): boolean {
  if (reportType !== 'site') return false;
  return !entry.red_book_photo_url && !isRedBookAbsent(entry.red_book_absent);
}

/** «Бичиг баримтын төрөл» checkbox-ууд (Word загвараас). */
export const ASR_DOC_KINDS = [
  'planning',
  'progress',
  'report',
  'drawing',
  'schedule',
  'other',
] as const;

export type AsrDocKind = (typeof ASR_DOC_KINDS)[number];

/** i18n түлхүүр — `asr.docKindPlanning` гэх мэт. */
export const DOC_KIND_KEY: Record<AsrDocKind, string> = {
  planning: 'asr.docKindPlanning',
  progress: 'asr.docKindProgress',
  report: 'asr.docKindReport',
  drawing: 'asr.docKindDrawing',
  schedule: 'asr.docKindSchedule',
  other: 'asr.docKindOther',
};

/**
 * Тайлангийн ТӨРӨЛ (миграц 0362, эзний шийдвэр 2026-09-29) — нэг тайлан ЯГ
 * НЭГ төрөлтэй.  `site` = одоогийн (2026-09-29 хүртэлх бүх) тайлан.
 *
 * Массивын ДАРААЛАЛ = UI дахь дараалал (эзэн 2026-09-30): Талбайн хяналт →
 * Оффис уулзалт → Зургийн өөрчлөлт → Цахим уулзалт.  Шүүлтүүр, «Шинэ тайлан»-ы
 * төрөл сонгох цонх, засварлагч, хэвлэх/Word-ийн «Хяналтын төрөл» мөр, самбарын
 * «Төрлөөр» бүгд энэ массиваар давтана.
 *
 * ⚠️ ИХЭР: `backend/src/lib/asrReportType.ts` `ASR_REPORT_TYPES` (цагаан
 *    жагсаалт).  Утга нэмэх, дараалал солихдоо хоёуланг нь өөрчил.
 */
export const ASR_REPORT_TYPES = ['site', 'office', 'drawing_change', 'online'] as const;

export type AsrReportType = (typeof ASR_REPORT_TYPES)[number];

/** i18n түлхүүр — `asr.type.site` гэх мэт. */
export const REPORT_TYPE_KEY: Record<AsrReportType, string> = {
  site: 'asr.type.site',
  online: 'asr.type.online',
  drawing_change: 'asr.type.drawingChange',
  office: 'asr.type.office',
};

/** Хэвлэх баримт, Word дээрх ХАТУУ монгол шошго (баримт хэлээр хувирдаггүй). */
export const REPORT_TYPE_LABEL_MN: Record<AsrReportType, string> = {
  site: 'Талбайн хяналт',
  online: 'Цахим уулзалт',
  drawing_change: 'Зургийн өөрчлөлт',
  office: 'Оффис уулзалт',
};

/** Серверээс ирсэн (эсвэл хуучин, талбаргүй) утгыг төрөл болгоно; үл мэдэгдэх → `site`. */
export function reportTypeOf(v: { report_type?: string | null } | null | undefined): AsrReportType {
  const t = v?.report_type;
  return (ASR_REPORT_TYPES as readonly string[]).includes(t ?? '') ? (t as AsrReportType) : 'site';
}

/**
 * Цахим уулзалтын түгээмэл платформ — нэг товшилтоор бөглөх санал.  Бусдыг
 * гараар бичнэ (сервер чөлөөт бичвэр хадгална, ≤100 тэмдэгт).
 */
export const ASR_MEETING_PLATFORMS = ['Zoom', 'Google Meet', 'Microsoft Teams', 'Viber'] as const;

/**
 * «Оффис уулзалт»-ын маягт (миграц 0367, эзний хүсэлт 2026-09-30): «Тайлбар» ба
 * «Бичиг баримтын төрөл»-ийн оронд уулзалтын мэдээлэл (Уулзах газар, Цаг,
 * Оролцогч тал, Уулзалтын зорилго), «Хяналтаар явсан» → «Оролцсон» (бүх
 * ажилтнаас), «Ажлын тайлан» → «Уулзалтын агуулга» (ганц бичвэр), гарын
 * үсгийн «Талбайн инженер» → «Захиалагч тал», улаан дэвтэргүй, ЯГ НЭГ том
 * зураг.  Засварлагч, хэвлэх/PDF, Word гурвуулаа ЭНЭ функцээр салаална.
 *
 * ⚠️ ИХЭР: `backend/src/lib/asrMeeting.ts` `usesMeetingForm`.
 */
export function usesMeetingForm(type: AsrReportType): boolean {
  return type === 'office';
}

/** Оффис уулзалтын хавсралт зураг — ЯГ НЭГ (эзэн). */
export const ASR_MEETING_MAX_PHOTOS = 1;

/** Оролцогчийн дээд тоо — серверийн `MAX_MEETING_PARTICIPANTS`. */
export const ASR_MEETING_MAX_PARTICIPANTS = 40;

/** Баримт дээрх «13:00-15:30» — аль нэг нь хоосон бол байгаа нь л. */
export function meetingTimeRange(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  return [start, end]
    .map((v) => (v ?? '').trim())
    .filter(Boolean)
    .join('-');
}

export const ASR_MAX_PHOTOS = 20;

/** Нэг тайланд хавсаргах дуу бичлэгийн дээд тоо (backend-ийн MAX_RECORDINGS). */
export const ASR_MAX_RECORDINGS = 20;

export interface AsrPhoto {
  url: string;
  name: string;
  /**
   * Зургийг АВСАН огноо `YYYY-MM-DDTHH:mm:ss` (камерын ханын цаг, бүсгүй;
   * 2026-09-25-аас өмнөх утга секундгүй) —
   * байршуулахаас өмнө ЭХ файлын EXIF-ээс, байхгүй бол `lastModified`-оос
   * (`shared/lib/exifDate.ts`).  ⚠️ СОНГОЛТТОЙ: 2026-09-21-ээс өмнөх зураг
   * болон хуучин localStorage ноорогт байхгүй — тэр үед тайлангийн огноо
   * нөхнө (`photoStamp.ts`).  Сервер `sanitizePhotos` хэлбэрийг шалгаад
   * хэвээр хадгална; зургийн байт хөндөгдөхгүй.
   */
  taken_at?: string | null;
  /**
   * Зургийн доорх тайлбар (0336).  Хуучин мөрөнд байхгүй байж болно
   * (localStorage-ийн ноорог, 0336-аас өмнөх серверийн хариу) → `?? ''`.
   */
  caption?: string;
}

/** Зургийн тайлбарын дээд урт — серверийн `MAX_CAPTION_CHARS`-тай ижил. */
export const ASR_MAX_CAPTION = 500;

/** Баримтын нэг хуудсанд орох зургийн тоо (эзний шаардлага 2026-09-21: 2×2). */
export const ASR_PHOTOS_PER_PAGE = 4;

/** Зургийг хуудас тус бүрээр (4-өөр) бүлэглэнэ — хэвлэх баримт + Word хоёулаа. */
export function chunkPhotos<T>(photos: T[], size = ASR_PHOTOS_PER_PAGE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < photos.length; i += size) out.push(photos.slice(i, i + size));
  return out;
}

/* ------------------------------------------------------------------ */
/*  Өмнөх тайлангийн асуудлын шийдэл (migration 0336)                  */
/* ------------------------------------------------------------------ */

/**
 * «Өмнөх тайлангийн асуудлыг бид ингэж шийдсэн» — ОДООГИЙН тайлан дээрх мөр.
 * Өмнөх тайлан ХӨНДӨГДӨХГҮЙ; `prev_doc_no`/`prev_report_date` нь сервер тал
 * амьд JOIN + цооногийн нэгтгэл тул өмнөх тайлан устсан ч утга үлдэнэ.
 */
export interface AsrResolution {
  id?: number;
  prev_report_id: number | null;
  prev_doc_no?: string | null;
  prev_report_date?: string | null;
  prev_status?: AsrStatus | null;
  /** Өмнөх тайлангийн одоогийн «Алдаа дутагдал» (зөвхөн уншина). */
  prev_defects?: string | null;
  /** Асуудлын цооног — өмнөх тайлангийн defects-ээс урьдчилан бөглөгдөнө, засаж болно. */
  issue_text: string;
  resolution_text: string;
}

/** ЭНЭ тайлангийн асуудлыг шийдсэн дараагийн тайлан (сервер гарган авна). */
export interface AsrResolvedIn {
  report_id: number;
  doc_no: string | null;
  report_date: string;
  status: AsrStatus;
  issue_text: string | null;
  resolution_text: string | null;
}

/** `GET /projects/:id/issues` — өмнөх тайлангийн сонголтын мөр. */
export interface AsrIssueSource {
  id: number;
  seq: number | null;
  doc_no: string | null;
  report_date: string;
  status: AsrStatus;
  defects: string | null;
  description: string | null;
  author_name: string | null;
  resolved_count: number;
}

/* ------------------------------------------------------------------ */
/*  Дуу бичлэг → текст (migration 0159)                                */
/* ------------------------------------------------------------------ */

export type AsrSttStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'error'
  | 'fetch_error'
  | 'trim_error';

/**
 * ⚠️ `audio_key` нь ЗОРИУДААР ХАРИУНД ОРДОГГҮЙ — тэр бол private
 *    `MEETING_BUCKET`-ийн түлхүүр.  Клиент нь зөвхөн транскриптийг уншина.
 */
export interface AsrRecording {
  id: number;
  content_type: string | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  stt_status: AsrSttStatus | null;
  transcript_text: string | null;
  language: string | null;
  error: string | null;
  sort_order: number;
  created_by_id: number;
  submitted_at: string | null;
  completed_at: string | null;
  created_at: string;
}

/** Хараахан дуусаагүй — UI зөвхөн ийм мөр байвал poll хийнэ. */
export function isAsrRecordingPending(r: AsrRecording): boolean {
  return r.stt_status === 'pending' || r.stt_status === 'running';
}

export interface AsrTeamRow {
  team_id: number;
  team_code: string;
  team_name_mn: string;
  team_name_en: string | null;
  work_note: string | null;
  sort_order: number;
}

/** `GET /author-supervision/safety` — сервер дээрх `lib/asrSafety.ts`-ийн толь. */
export interface AsrSafetyContentResponse {
  content: {
    version: string;
    title: string;
    intro: string | null;
    sections: { heading: string; items: string[] }[];
    confirmText: string;
    /** `true` бол компанийн албан ёсны бичвэр хараахан ороогүй — UI анхааруулна. */
    placeholder: boolean;
  };
  hash: string;
}

export interface AsrCompanion {
  user_id: number;
  full_name: string | null;
  /** Албан тушаал (`users.position`) — оффис уулзалтын «Оролцсон» мөрөнд. */
  position?: string | null;
  red_book_photo_url?: string | null;
  red_book_verified_at?: string | null;
  red_book_verifier_name?: string | null;
}

/** Жагсаалтын шүүлт: зохиогч + хамт явсан. */
export function asrAttendeeIds(r: Pick<AsrReport, 'author_id' | 'companion_ids'>): number[] {
  const extra = (r.companion_ids ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  return [r.author_id, ...extra];
}

export interface AsrTeamOption {
  id: number;
  code: string;
  name_mn: string;
  name_en: string | null;
}

export interface AsrReport {
  id: number;
  project_id: number;
  client_uuid: string;
  seq: number | null;
  doc_no: string | null;
  report_date: string;
  /**
   * ХҮЧИН ТӨГӨЛДӨР шифр — `shifr_override ?? passport_shifr` (сервер тал
   * `shapeRow`-д нэгтгэдэг).  Жагсаалт, хэвлэх хуудас, файлын нэр энэ утгыг
   * харуулна.  ⚠️ ЗАСВАРЛАГЧИЙН талбарт ХЭРЭГЛЭХГҮЙ — доорх
   * `shifr_override`-ыг үз.
   */
  shifr: string | null;
  /**
   * Хэрэглэгчийн ГАРААР бичсэн (эсвэл илгээх үед ХӨЛДСӨН) шифр.  NULL бол
   * тайлан төслийн паспортыг ШУУД дагаж байна гэсэн үг.
   *
   * ⚠️ Маягтад ЗААВАЛ энэ утга орно.  Хүчин төгөлдөр утгыг оруулбал
   *    паспортоос ирсэн шифр дараагийн автомат хадгалалт дээр override
   *    болж бичигдэн, паспорт засагдсан ч дагахаа болино.
   */
  shifr_override?: string | null;
  /** `'override'` | `'passport'` | `null` — «Авто (паспортоос)» тэмдэглэгээ. */
  shifr_source?: 'override' | 'passport' | null;
  /** Төслийн паспортын зургийн шифр — маягтын placeholder. */
  passport_shifr?: string | null;
  /** Төслийн паспортын албан ёсны бүтэн нэр — хэвлэх хуудасны толгойд. */
  passport_title?: string | null;
  /**
   * ХҮЧИН ТӨГӨЛДӨР «Гэрээний дугаар» — `contract_no_override ??
   * project_contract_no` (сервер тал `shapeRow`-д нэгтгэдэг, миграц 0363 + 0365).
   * Хэвлэх баримт, Word, жагсаалт энэ утгыг харуулна.  ⚠️ ЗАСВАРЛАГЧИЙН
   * талбарт ХЭРЭГЛЭХГҮЙ — доорх `contract_no_override`-ыг үз.  Хуучин
   * кэш/сервер дээр байхгүй байж болно.
   */
  contract_no?: string | null;
  /**
   * Засварлагч дээр ГАРААР бичсэн гэрээний дугаар.  NULL бол тайлан төслийн
   * `asr_contract_no`-г ШУУД дагаж байна (шифрийн `shifr_override`-ийн ихэр).
   * ⚠️ Маягтад ЗААВАЛ энэ утга орно — эс бөгөөс төслөөс ирсэн дугаар дараагийн
   * автомат хадгалалт дээр override болж хувирна.
   */
  contract_no_override?: string | null;
  /** `'override'` | `'project'` | `null` — «Авто (төслөөс)» тэмдэглэгээ. */
  contract_no_source?: 'override' | 'project' | null;
  /** Төслийн ЗХ-ийн гэрээний дугаар (`projects.asr_contract_no`, 0365). */
  project_contract_no?: string | null;
  doc_types: AsrDocKind[];
  doc_type_other: string | null;
  /** 0362 — хуучин кэш/клиентэд байхгүй байж болно → `reportTypeOf`. */
  report_type?: AsrReportType;
  /** Цахим уулзалтын платформ; бусад төрөлд NULL. */
  meeting_platform?: string | null;
  /* 0367 — оффис уулзалтын мэдээлэл (`usesMeetingForm`).  Хуучин сервер/кэшид байхгүй. */
  meeting_place?: string | null;
  /** «HH:MM» */
  meeting_start?: string | null;
  meeting_end?: string | null;
  /** Оролцогч тал — захиалагч, гүйцэтгэгч гэх мэт гадны оролцогчид. */
  meeting_parties?: string | null;
  meeting_purpose?: string | null;
  /** 0396 — «0.1 Захиалагч / 0.2 Гүйцэтгэгч» хүснэгтүүд.  Хуучин сервер/кэшид байхгүй. */
  meeting_requests?: MeetingRequests | null;
  /** 0398 — засварласан «Оролцогч тал» мөр, захиалагчийн байгууллага/албан тушаал. */
  meeting_doc?: MeetingDocExtra | null;
  /**
   * Зөвхөн дэлгэрэнгүй хариунд — ХАБ-ын баталгаа тайлантай холбогдсон эсэх.
   * Зохиогч «Талбайн хяналт» төрөл РҮҮ шилжүүлэх эрх үүнээс (серверийн ихэр).
   */
  has_safety_ack?: boolean;
  description: string | null;
  photos: AsrPhoto[];
  sig_arch_name: string | null;
  sig_arch_url: string | null;
  sig_arch_date: string | null;
  sig_site_name: string | null;
  sig_site_url: string | null;
  sig_site_date: string | null;
  checked_by_name: string | null;
  checked_by_title: string | null;
  /* 0336 — «Ажлын тайлан» хэсгийн дэд хэсгүүд.  Хуучин мөрөнд байхгүй → `?? ''`. */
  work_report?: string | null;
  site_tasks?: string | null;
  defects?: string | null;
  /** Зөвхөн дэлгэрэнгүй хариунд — өмнөх тайлангийн асуудлын шийдлүүд (0336). */
  resolutions?: AsrResolution[];
  /** Зөвхөн дэлгэрэнгүй хариунд — ЭНЭ тайланг шийдсэн дараагийн тайлангууд. */
  resolved_in?: AsrResolvedIn[];
  /** Захирлын профайл дахь хадгалсан гарын үсэг — хэвлэхэд автоматаар. */
  checked_by_signature_url?: string | null;
  author_id: number;
  author_name: string | null;
  /** Зөвхөн дэлгэрэнгүй хариунд — зохиогчийн албан тушаал (0367, «Оролцсон» мөр). */
  author_position?: string | null;
  status: AsrStatus;
  submitted_at: string | null;
  reviewed_by: number | null;
  reviewer_name: string | null;
  /** Захирлын ТАМГА (`/media/<key>`, 0173) — backend буцаасаар байгаа ч
   *  2026-09-23-аас тайлангийн «Баталсан» нүдэнд ГАРАХГҮЙ (эзний шийдвэр). */
  stamp_url?: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  /* Улаан дэвтэр (0279).  Тайлангийн хөлдөлтөөс ГАДУУР — `PATCH /:id/red-book`. */
  red_book_photo_url?: string | null;
  red_book_verified_by?: number | null;
  red_book_verified_at?: string | null;
  red_book_verifier_name?: string | null;
  /** «Талбай дээр улаан дэвтэр байгаагүй» (0366) — 0/1; `PATCH /:id/red-book/absent`. */
  red_book_absent?: number | boolean | null;
  /** Серверийн гарган авсан төлөв; клиент `redBookStatusOf`-оор дахин тооцно. */
  red_book_status?: AsrRedBookStatus;
  /**
   * Нөхөж бүртгэсэн ХУУЧИН тайлан (миграц 0332): `'legacy'` бол систем
   * нэвтрэхээс өмнөх Word/PDF-ээс орсон, `seq` NULL, `doc_no` = файлын дугаар
   * (`ASR-BB-005`).  `'app'` = аппаар бүртгэсэн.  Сервер `r.*`-ээр өгнө.
   */
  origin?: 'app' | 'legacy';
  legacy_doc_no?: string | null;
  legacy_author_name?: string | null;
  created_at: string;
  updated_at: string;
  /** Зөвхөн жагсаалтын хариунд (group_concat). */
  team_codes?: string | null;
  /** Зөвхөн дэлгэрэнгүй хариунд. */
  teams?: AsrTeamRow[];
  /** Хамт явсан багийнхан (0347). Дэлгэрэнгүйд объект, жагсаалтад id/нэр. */
  companions?: AsrCompanion[];
  companion_ids?: string | null;
  companion_names?: string | null;
  /** Зөвхөн дэлгэрэнгүй хариунд — дуу бичлэгүүд. */
  recordings?: AsrRecording[];
  /**
   * ЗӨВХӨН ХАДГАЛААГҮЙ ноорогт (клиент тал).  «Шинэ тайлан» дарахад
   * хэрэглэгчийн зурсан ХАБ-ын танилцсан баталгааны id
   * (`POST /author-supervision/safety/acknowledgements`); `AsrEditorShell`
   * үүнийг create хүсэлтэд `safety_ack_id` болгож явуулна — сервер энэ
   * мөргүйгээр тайлан ҮҮСГЭХГҮЙ (403 `SAFETY_ACK_REQUIRED`).  Серверээс
   * ирсэн мөрөнд хэзээ ч байхгүй.
   */
  safety_ack_id?: number | null;
  /**
   * Зөвхөн дэлгэрэнгүй хариунд — төслийн товч танилцуулга.  Сервер тал
   * ХӨЛДСӨН утга (илгээгдсэн тайлан) эсвэл ПАСПОРТООС АМЬД тооцсоныг
   * буцаана.  ⚠️ ХАДГАЛААГҮЙ ноорог дээр байхгүй — тэнд засварлагч
   * `GET /projects/:id`-аас өөрөө гаргана (`asr/projectInfo.ts`).
   */
  project_info?: AsrProjectInfo | null;
  /** `true` бол танилцуулга илгээх үед хөлдсөн. */
  project_info_frozen?: boolean;
}

/**
 * ЗХ баримт дээр хэвлэгдэх ТӨСЛИЙН ТОВЧ ТАНИЛЦУУЛГА.
 *
 * ⚠️ ИХЭР: `backend/src/lib/asrProjectInfo.ts`-ийн `AsrProjectInfo`.  Талбар
 *    нэмэх / нэрлэж солихдоо ХОЁУЛАНГ НЬ өөрчил — энэ нь хөлдөөсөн JSON-ы
 *    хэлбэр (`author_supervision_reports.project_info_json`, миграц 0256)
 *    бөгөөд ТҮҮХ, тиймээс нэрийг хэзээ ч бүү сольж бич.
 */
export interface AsrProjectInfo {
  title: string;
  shortName: string;
  drawingNo: string;
  docNo: string;
  clientName: string;
  location: string;
  startDate: string | null;
  finishDate: string | null;
  disciplines: string[];
}

/* ------------------------------------------------------------------ */
/*  Хяналтын хуваарь (миграц 0331)                                     */
/* ------------------------------------------------------------------ */

export type AsrVisitPlanStatus = 'planned' | 'cancelled';

/** `lib/asrVisitPlanRoutes.ts` `AsrVisitPlanMember`-ийн ихэр. */
export interface AsrVisitPlanMember {
  user_id: number;
  full_name: string | null;
  profile_image: string | null;
  team_code: string | null;
  /** Мэдэгдэл очсон агшин (ISO); томилсон хүн өөрөө бол null. */
  notified_at: string | null;
}

/** `lib/asrVisitPlanRoutes.ts` `AsrVisitPlanView`-ийн ихэр. */
export interface AsrVisitPlan {
  id: number;
  project_id: number;
  project_name: string;
  project_location: string | null;
  project_shifr: string | null;
  /** YYYY-MM-DD (УБ). */
  visit_date: string;
  /** HH:MM эсвэл null. */
  visit_time: string | null;
  note: string | null;
  status: AsrVisitPlanStatus;
  created_by: number;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
  members: AsrVisitPlanMember[];
}

export interface AsrVisitPlansResponse {
  plans: AsrVisitPlan[];
  /** Серверийн УБ өнөөдөр — «өнөөдөр»/«маргааш» шошгонд. */
  today: string;
  can_manage: boolean;
}

export interface AsrVisitPlanInput {
  project_id: number;
  visit_date: string;
  visit_time: string | null;
  note: string | null;
  user_ids: number[];
}

export interface AsrListResponse {
  entries: AsrReport[];
  can_write: boolean;
  can_review: boolean;
  teams: AsrTeamOption[];
  /**
   * Энэ төслийн зохиогчийн хяналт ӨӨР ТӨСӨЛ рүү нэгтгэгдсэн эсэх
   * (`projects.asr_merged_into`, миграц 0340).  Тайлангууд нь зорилт дээр
   * байгаа тул `entries` хоосон — харин хуучин холбоос ажилласаар байхын
   * тулд UI нь хоосон жагсаалт биш, зорилт руу чиглүүлэгч харуулна.
   */
  merged_into: { id: number; name: string } | null;
  /** ЗХ-д харагдах нэр + засах цонхны түүхий утгууд (миграц 0358). */
  project?: AsrProjectNames | null;
}

/**
 * ЗХ-ийн төслийн нэрс (0358): `name` = ЗХ-д харагдах нэр (`asr_name` ??
 * `projects.name`), `base_name` = `projects.name`, `asr_name` = админы засвар.
 */
export interface AsrProjectNames {
  id: number;
  name: string;
  base_name: string;
  asr_name: string | null;
  /** Төслийн ЗХ-ийн гэрээний дугаар (0365) — төсөл дээрх бүх тайлан дагана. */
  asr_contract_no?: string | null;
}

export interface AsrDetailResponse {
  entry: AsrReport;
  can_review: boolean;
}

/* ------------------------------------------------------------------ */
/*  Очилтын тойм                                                       */
/* ------------------------------------------------------------------ */

export interface AsrTeamVisits {
  team_id: number;
  team_code: string;
  name_mn: string;
  name_en: string | null;
  visits: number;
  last_visit: string | null;
}

export interface AsrPersonVisits {
  user_id: number;
  full_name: string;
  avatar_url: string | null;
  visits: number;
  last_visit: string | null;
}

export interface AsrVisitsResponse {
  by_team: AsrTeamVisits[];
  by_person: AsrPersonVisits[];
  /** Баг × хүн — баг бүрт хэн хэдэн удаа, ямар огноонууд. */
  team_people: AsrTeamPersonRow[];
  total_visits: number;
  first_visit: string | null;
  last_visit: string | null;
}

export interface AsrTeamPersonRow {
  team_id: number;
  team_code: string;
  name_mn: string;
  name_en: string | null;
  sort_order: number;
  user_id: number;
  full_name: string;
  avatar_url: string | null;
  visits: number;
  last_visit: string | null;
  /** `report_date` утгууд таслалаар (`,`). */
  visit_dates: string | null;
}

export interface AsrProjectSummary {
  id: number;
  /* `total_visits` / `last_visit` = ЗӨВХӨН талбайн хяналт (0362);
     `report_count` = бүх төрлийн тайлан. */
  /** ЗХ-д харагдах нэр (0358: `asr_name` ?? `projects.name`). */
  name: string;
  /** `projects.name` — нэр засах цонхны «анхны нэр». */
  base_name?: string;
  asr_name?: string | null;
  /** Төслийн ЗХ-ийн гэрээний дугаар (0365) — нэр засах цонхны анхны утга. */
  asr_contract_no?: string | null;
  status: string | null;
  shifr: string | null;
  total_visits: number;
  last_visit: string | null;
  report_count: number;
}

/**
 * Маягтын засварлагдах хэсэг.  Ноорогийг localStorage-д хадгалахад ч
 * яг энэ бүтэц явна (зөвхөн R2 URL — blob/data URL хэзээ ч биш).
 */
export interface AsrFormState {
  report_date: string;
  /** 0362.  ⚠️ Хуучин localStorage ноорогт байхгүй байж болно. */
  report_type?: AsrReportType;
  meeting_platform?: string;
  /* 0367 — оффис уулзалт.  ⚠️ Хуучин localStorage ноорогт байхгүй байж болно. */
  meeting_place?: string;
  meeting_start?: string;
  meeting_end?: string;
  meeting_parties?: string;
  meeting_purpose?: string;
  /** 0396.  ⚠️ Хуучин localStorage ноорогт байхгүй байж болно. */
  meeting_requests?: MeetingRequests;
  /** 0398.  ⚠️ Хуучин localStorage ноорогт байхгүй байж болно. */
  meeting_doc?: MeetingDocExtra;
  shifr: string;
  /** 0363.  ⚠️ Хуучин localStorage ноорогт байхгүй байж болно. */
  contract_no?: string;
  doc_types: AsrDocKind[];
  doc_type_other: string;
  description: string;
  /** team_id → «Ажлын тайлан».  Чип салгасан ч текст энд үлдэнэ. */
  work_notes: Record<number, string>;
  selected_team_ids: number[];
  photos: AsrPhoto[];
  sig_arch_name: string;
  sig_arch_url: string | null;
  sig_arch_date: string;
  sig_site_name: string;
  sig_site_url: string | null;
  sig_site_date: string;
  checked_by_name: string;
  checked_by_title: string;
  /* 0336 — «Ажлын тайлан» дэд хэсгүүд. */
  work_report: string;
  site_tasks: string;
  defects: string;
  resolutions: AsrResolution[];
  /** Хамт явсан багийнхны id — зохиогчоос бусад. */
  companion_user_ids: number[];
}

/** «Шалгасан» талбарын анхдагч (Word загвараас). */
/**
 * ЗХ баримтын «Хянасан» мөрийн нэр — `org.director_name_mn` тохиргооноос.
 * `defaultCheckedByTitle`-тэй ижил шалтгаанаар ФУНКЦ (const нь брэнд
 * серверээс ирэхээс өмнө хөлдөнө).
 */
export function defaultCheckedByName(): string {
  return brand().directorNameMn;
}
/**
 * ЗХ баримтын «Хянасан» мөрийн албан тушаал — `org.director_title_mn`
 * тохиргооноос уншина.
 *
 * ⚠️ ФУНКЦ байх ЁСТОЙ, `const` БИШ.  Модулийн түвшний `const` нь файл
 *    ачаалагдах агшинд нэг л удаа тогтох ба тэр агшин нь брэнд серверээс
 *    ирэхээс ӨМНӨ байдаг — өөрөөр хэлбэл админ албан тушаалаа сольсон ч
 *    хуучин утга хэвээр хөлдөнө.
 */
export function defaultCheckedByTitle(): string {
  return brand().directorTitleMn;
}

/**
 * `client_uuid` үүсгэгч — давхар илгээлтээс хамгаалах түлхүүр.
 *
 * ⚠️ `crypto.randomUUID` нь ЗӨВХӨН secure context-д (https, эсвэл
 *    localhost) байдаг.  Талбай дээрх утас LAN-ийн `http://192.168.x.x`
 *    гэх мэт хаягаар нэвтэрвэл тэр функц `undefined` болж
 *    «crypto.randomUUID is not a function» гэсэн ойлгомжгүй TypeError
 *    шидэгдэн, «Шинэ тайлан» огт ажиллахгүй — сервер рүү хүсэлт ч
 *    явахгүй тул log-д ч юу ч үлдэхгүй.  Тиймээс fallback ЗААВАЛ.
 */
export function newClientUuid(): string {
  const c: Crypto | undefined = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (typeof c?.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  // RFC 4122 v4 битүүд — сервер нь зөвхөн давтагдашгүй мөр гэж үздэг ч
  // хэлбэрийг нь хадгалснаар DB-д холимог формат үүсэхгүй.
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * ХАДГАЛААГҮЙ шинэ тайлангийн id.
 *
 * ⚠️ Энэ бол «сервер дээр хараахан БАЙХГҮЙ» гэсэн ЦОРЫН ГАНЦ тэмдэг.
 *    `AsrEditorShell` үүгээр автомат хадгалалтыг унтрааж, дуу бичлэг /
 *    PDF / хэвлэх / устгах товчийг нуух ба «Хадгалах» дарсан агшинд л
 *    POST хийнэ.
 *
 * Эзний шийдвэр (2026-09-04): «Шинэ тайлан» дарахад жагсаалтад хоосон
 * ноорог үүсэх ЁСГҮЙ — хэрэглэгч бодлоо өөрчилвөл ямар ч мөр үлдэхгүй.
 */
export const UNSAVED_ASR_ID = 0;

/** Тайлан серверт хадгалагдсан уу? */
export function isAsrPersisted(entry: AsrReport): boolean {
  return entry.id !== UNSAVED_ASR_ID;
}

/**
 * Санах ойд амьдрах шинэ тайлан — сервер рүү ЮУ Ч илгээхгүй.
 *
 * ⚠️ `client_uuid` нь ЭНД үүснэ, POST дээр биш: localStorage-ийн ноорогийн
 *    түлхүүр (`mgl:asr-draft:new:<uuid>`) үүнээс гардаг тул засварлагч
 *    дахин mount болоход тэр ноорог олдох ёстой.  Мөн энэ нь сүлжээ
 *    тасарч давхар илгээгдсэн POST-оос хамгаалах idempotency түлхүүр.
 *
 * ⚠️ Багууд ХООСОН эхэлнэ.  Сервер нь үүсгэх агшинд зохиогчийн өөрийн
 *    багийг урьдчилан тэмдэглэдэг (`routes/authorSupervision.ts`); тэр
 *    урьдчилгааг `AsrEditorShell`-ийн эхний хадгалалт авч үлдээнэ.
 */
export function newLocalAsrEntry(opts: {
  projectId: number;
  authorId: number | null;
  authorName?: string | null;
  /**
   * Зохиогчийн профайлд хадгалсан гарын үсэг (`users.signature_url`).
   * Өгвөл «Архитектор, Инженер» мөрийг зохиогчийн нэр + гарын үсгээр
   * АВТОМАТААР бөглөнө (эзний хүсэлт 2026-09-23) — хэрэглэгч хүсвэл
   * засварлагчаас солино.
   */
  authorSignatureUrl?: string | null;
  reportDate: string;
  passportShifr?: string | null;
  passportTitle?: string | null;
  /** ХАБ-ын танилцсан баталгааны id — `AsrReport.safety_ack_id`-г үз. */
  safetyAckId?: number | null;
  /** «Шинэ тайлан» дээр сонгосон төрөл (0362); өгөөгүй бол талбайн хяналт. */
  reportType?: AsrReportType;
}): AsrReport {
  const now = new Date().toISOString();
  return {
    id: UNSAVED_ASR_ID,
    project_id: opts.projectId,
    client_uuid: newClientUuid(),
    seq: null,
    doc_no: null,
    report_date: opts.reportDate,
    shifr: opts.passportShifr ?? null,
    shifr_override: null,
    shifr_source: opts.passportShifr ? 'passport' : null,
    passport_shifr: opts.passportShifr ?? null,
    passport_title: opts.passportTitle ?? null,
    contract_no: null,
    contract_no_override: null,
    contract_no_source: null,
    doc_types: [],
    doc_type_other: null,
    report_type: opts.reportType ?? 'site',
    meeting_platform: null,
    meeting_place: null,
    meeting_start: null,
    meeting_end: null,
    meeting_parties: null,
    meeting_purpose: null,
    meeting_requests: null,
    meeting_doc: null,
    description: null,
    photos: [],
    sig_arch_name: opts.authorName ?? null,
    sig_arch_url: opts.authorSignatureUrl ?? null,
    sig_arch_date: opts.authorSignatureUrl || opts.authorName ? opts.reportDate : null,
    sig_site_name: null,
    sig_site_url: null,
    sig_site_date: null,
    checked_by_name: null,
    checked_by_title: null,
    work_report: null,
    site_tasks: null,
    defects: null,
    resolutions: [],
    resolved_in: [],
    author_id: opts.authorId ?? 0,
    author_name: opts.authorName ?? null,
    status: 'draft',
    safety_ack_id: opts.safetyAckId ?? null,
    submitted_at: null,
    reviewed_by: null,
    reviewer_name: null,
    reviewed_at: null,
    review_note: null,
    red_book_photo_url: null,
    red_book_verified_by: null,
    red_book_verified_at: null,
    red_book_verifier_name: null,
    red_book_absent: 0,
    red_book_status: 'missing',
    created_at: now,
    updated_at: now,
    teams: [],
    recordings: [],
    companions: [],
  };
}

export function formStateFrom(entry: AsrReport): AsrFormState {
  const workNotes: Record<number, string> = {};
  for (const t of entry.teams ?? []) workNotes[t.team_id] = t.work_note ?? '';
  return {
    report_date: entry.report_date,
    // ⚠️ `shifr` БИШ, `shifr_override`.  `entry.shifr` нь паспортоор нөхөгдсөн
    //    ХҮЧИН ТӨГӨЛДӨР утга тул түүнийг маягтад оруулбал `patchBodyFrom` нь
    //    дараагийн хадгалалт дээр буцааж бичиж, «паспортыг дага» гэсэн NULL
    //    төлөв чимээгүй алдагдана.  Хуучин (0-аас өмнөх семантик) сервер /
    //    localStorage ноорог дээр талбар байхгүй байж болох тул `?? ''`.
    shifr: entry.shifr_override ?? '',
    // ⚠️ Гэрээний дугаар ч ижил: `contract_no` (хүчин төгөлдөр) БИШ,
    //    `contract_no_override`.  Төслөөс дагаж буй дугаарыг маягтад оруулбал
    //    autosave override болгож бичээд, төслийн дугаар солигдсон ч дагахаа
    //    болино.  Override талбар огт байхгүй (0365-аас өмнөх сервер) бол
    //    хуучин утга (`contract_no`) нь тайлангийн өөрийн утга байсан.
    contract_no:
      'contract_no_override' in entry
        ? (entry.contract_no_override ?? '')
        : (entry.contract_no ?? ''),
    report_type: reportTypeOf(entry),
    meeting_platform: entry.meeting_platform ?? '',
    meeting_place: entry.meeting_place ?? '',
    meeting_start: entry.meeting_start ?? '',
    meeting_end: entry.meeting_end ?? '',
    meeting_parties: entry.meeting_parties ?? '',
    meeting_purpose: entry.meeting_purpose ?? '',
    // Хэзээ ч хадгалаагүй (NULL) бол хүснэгт бүр анхнаасаа 1 хоосон мөртэй (эзэн
    // 2026-10-12) — «Мөр нэмэх» дарах шаардлагагүй; устгасан мөр (хадгалсан `[]`) буцахгүй.
    meeting_requests: {
      client: {
        intro: entry.meeting_requests?.client?.intro ?? '',
        items: entry.meeting_requests
          ? (entry.meeting_requests.client?.items ?? []).map(toRequestItem)
          : [emptyRequestItem()],
      },
      contractor: {
        intro: entry.meeting_requests?.contractor?.intro ?? '',
        items: entry.meeting_requests
          ? (entry.meeting_requests.contractor?.items ?? []).map(toRequestItem)
          : [emptyRequestItem()],
      },
    },
    meeting_doc: {
      party_lines: { ...(entry.meeting_doc?.party_lines ?? {}) },
      client_org: entry.meeting_doc?.client_org ?? '',
      client_position: entry.meeting_doc?.client_position ?? '',
      note_images: [...(entry.meeting_doc?.note_images ?? [])],
    },
    doc_types: entry.doc_types ?? [],
    doc_type_other: entry.doc_type_other ?? '',
    description: entry.description ?? '',
    work_notes: workNotes,
    selected_team_ids: (entry.teams ?? []).map((t) => t.team_id),
    companion_user_ids: (entry.companions ?? []).map((c) => c.user_id),
    photos: entry.photos ?? [],
    sig_arch_name: entry.sig_arch_name ?? '',
    sig_arch_url: entry.sig_arch_url,
    sig_arch_date: entry.sig_arch_date ?? '',
    sig_site_name: entry.sig_site_name ?? '',
    sig_site_url: entry.sig_site_url,
    sig_site_date: entry.sig_site_date ?? '',
    checked_by_name: entry.checked_by_name ?? defaultCheckedByName(),
    checked_by_title: entry.checked_by_title ?? defaultCheckedByTitle(),
    work_report: entry.work_report ?? '',
    site_tasks: entry.site_tasks ?? '',
    defects: entry.defects ?? '',
    resolutions: (entry.resolutions ?? []).map((r) => ({
      ...r,
      issue_text: r.issue_text ?? '',
      resolution_text: r.resolution_text ?? '',
    })),
  };
}

/** Сервер рүү илгээх PATCH биет. */
export function patchBodyFrom(f: AsrFormState) {
  return {
    report_date: f.report_date,
    shifr: f.shifr || null,
    // Хуучин локал ноорогт талбар байхгүй бол ИЛГЭЭХГҮЙ — серверийн утга хэвээр.
    ...(f.contract_no !== undefined ? { contract_no: f.contract_no.trim() || null } : {}),
    // Хуучин локал ноорогт төрөл байхгүй бол ИЛГЭЭХГҮЙ — сервер хэвээр үлдээнэ.
    ...(f.report_type
      ? {
          report_type: f.report_type,
          meeting_platform: f.report_type === 'online' ? f.meeting_platform?.trim() || null : null,
        }
      : {}),
    // 0367 — оффис уулзалтын мэдээлэл.  Хуучин локал ноорогт талбар байхгүй бол
    // ИЛГЭЭХГҮЙ (серверийн утга хэвээр); төрөл өөр ч хадгална — төрөл буцаахад
    // бичсэн зүйл алдагдахгүй.
    ...Object.fromEntries(
      (
        ['meeting_place', 'meeting_start', 'meeting_end', 'meeting_parties', 'meeting_purpose'] as const
      )
        .filter((k) => f[k] !== undefined)
        .map((k) => [k, f[k]!.trim() || null]),
    ),
    // 0396 — хоосон мөрийг ч илгээнэ («Мөр нэмэх»-ийн дараа хадгалагдана).
    ...(f.meeting_requests !== undefined ? { meeting_requests: f.meeting_requests } : {}),
    ...(f.meeting_doc !== undefined ? { meeting_doc: f.meeting_doc } : {}),
    doc_types: f.doc_types,
    doc_type_other: f.doc_types.includes('other') ? f.doc_type_other || null : null,
    description: f.description || null,
    photos: f.photos,
    sig_arch_name: f.sig_arch_name || null,
    sig_arch_url: f.sig_arch_url,
    sig_arch_date: f.sig_arch_date || null,
    sig_site_name: f.sig_site_name || null,
    sig_site_url: f.sig_site_url,
    sig_site_date: f.sig_site_date || null,
    checked_by_name: f.checked_by_name || null,
    checked_by_title: f.checked_by_title || null,
    teams: f.selected_team_ids.map((id) => ({
      team_id: id,
      work_note: f.work_notes[id] ?? null,
    })),
    work_report: f.work_report || null,
    site_tasks: f.site_tasks || null,
    defects: f.defects || null,
    companion_user_ids: f.companion_user_ids ?? [],
    // Зөвхөн сервер уншдаг талбарууд — амьд `prev_*` утгыг илгээхгүй.
    resolutions: (f.resolutions ?? []).map((r) => ({
      prev_report_id: r.prev_report_id,
      issue_text: r.issue_text || null,
      resolution_text: r.resolution_text || null,
    })),
  };
}
