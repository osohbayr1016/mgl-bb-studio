/**
 * Revit туслахын СУРГАЛТЫН КУРАЦИ — хуваалцсан төрлүүд.
 *
 * ⚠️ Энэ файл нь `backend/src/routes/revit.ts`-ийн `ASSISTANT_INTENTS`-ийн
 * ХОС (twin) юм.  Гуравдугаар хос нь `revit-mcp/addin/IntentRouter.cs`.
 * Санаа нэмэх / хасахад ГУРВУУЛАНГ нь нэг зэрэг өөрчилнө, эс бөгөөс сервер
 * 400 буцаах эсвэл add-in танихгүй шошготой модель татна.
 */

import type { BulkRowOutcome, CurationAction, SourceType } from './curation';

/** Загварын хүлээн зөвшөөрөгдөх санаанууд (`revit.ts:1635-1645`-тай ижил дараалал). */
export const ASSISTANT_INTENTS = [
  'submit_progress',
  'list_sheets',
  'isolate_sheet',
  'reset_view',
  'whats_changed',
  'set_baseline',
  'progress_status',
  'help',
  'unknown',
] as const;

export type AssistantIntent = (typeof ASSISTANT_INTENTS)[number];

export function isAssistantIntent(v: unknown): v is AssistantIntent {
  return typeof v === 'string' && (ASSISTANT_INTENTS as readonly string[]).includes(v);
}

/**
 * `isolate_sheet` нь ГАНЦ санаа бөгөөд slot (хуудасны дугаар) шаарддаг —
 * бусад санаанд slot талбар утгагүй тул UI-д ч харуулахгүй.
 */
export const SLOT_INTENTS: readonly AssistantIntent[] = ['isolate_sheet'];

/**
 * Ангилагчийн итгэлцлийн доод босго — ЗӨВХӨН ХАРУУЛАХ зорилготой.
 *
 * ⚠️ Бодит эх сурвалж нь `app_settings['assistant.min_confidence']` (0195),
 * гэвч түүнийг одоогоор ХЭН Ч УНШДАГГҮЙ: add-in нь `IntentRouter.
 * MinConfidence`-ийг ЭМХЭТГЭЛИЙН ҮЕД авдаг.  Тиймээс энэ тоог өөрчлөх нь
 * зан төлөвт нөлөөлөхгүй — зөвхөн энэ хуудсан дээрх «бага итгэлцэл» өнгө
 * ямар босгоор асахыг тодорхойлно.
 */
export const ASSISTANT_MIN_CONFIDENCE = 0.45;

/** Хянагчийн шийдвэрийн төлөв.  NULL = хараахан хянаагүй (migration 0214). */
export type ReviewStatus = 'promoted' | 'rejected';

/** `GET /api/revit/assistant/pending`-ийн нэг мөр. */
export interface AssistantLogRow {
  id: number;
  user_id: number | null;
  project_id: number | null;
  text: string;
  /** Ангилагчийн ТААСАН санаа.  NULL байж болно (бүртгэл бүрэн бус). */
  predicted: string | null;
  confidence: number | null;
  /** keyword | model | fallback (`addin/IntentRouter.cs:221-227`). */
  decided_by: string | null;
  /** Хэрэглэгчийн ЗАСВАРЛАСАН жинхэнэ санаа.  NULL = засаагүй. */
  corrected: string | null;
  /** 1 = 👍, -1 = 👎, NULL = юу ч дараагүй. */
  feedback: number | null;
  /** 👎-ийн ЧӨЛӨӨТ шалтгаан (migration 0200) — дарааллын ХАМГИЙН ДЭЭД эрэмбэ. */
  feedback_note: string | null;
  acted: number;
  created_at: string;
  user_name: string | null;
  /**
   * Мөрийг ҮҮСГЭСЭН хүний САЛБАРЫН баг (`assistant_logs.team_code`).
   *
   * ⚠️ ГУРВАН ӨӨР УТГА — хоёрыг нь хольж болохгүй:
   *   · багийн код (`teams.code`) — сервер багийг МЭДНЭ.
   *   · `null`          — сервер багийг мэддэг ба «баг ТОДОРХОЙЛОГДООГҮЙ»
   *                       гэж ХЭЛЖ БАЙНА (компани даяарх мөр).  Карт үүнийг
   *                       ИЛ харуулна — эс бөгөөс хянагч тэр мөрийг
   *                       санамсаргүй өөр багийн корпуст оруулна.
   *   · `undefined`     — сервер энэ баганыг БУЦААДАГГҮЙ (хуучин worker).
   *                       Энэ бол «баг байхгүй» ГЭСЭН ҮГ БИШ — БҮР
   *                       МЭДЭХГҮЙ.  Карт ЮУ Ч харуулахгүй: хоосон газар
   *                       нь худал мэдэгдлээс дээр.
   *
   * ⚠️ СОНГОЛТТОЙ, ЗОРИУД.  2026-08-31-нд хэмжсэнээр `revit.ts`-ийн
   * `GET /assistant/pending`-ийн SELECT-д `l.team_code` БАЙХГҮЙ (§2-6 §3.6-ын
   * 6-р мөр хараахан нийлүүлэгдээгүй).  `optional` байдал нь тэр өдөр
   * ирэхэд frontend-д ЯМАР Ч засвар шаардахгүйг баталгаажуулна — яг
   * `ExportRow.id`-тэй ижил зорилготой.
   *
   * ⚠️ Багийг СЕРВЕР шийднэ (гэрээ G1): `user.sub` → `user_teams`
   * (`is_primary = 1`) → `teams.code`.  Хуучирсан `users.team_id` БИШ —
   * тэр нь олон багт харьяалагдах хүн бүрийг БУРУУ шошголно.  Клиент энэ
   * утгыг ЗӨВХӨН ХАРУУЛНА, ХЭЗЭЭ Ч зарлахгүй.
   */
  team_code?: string | null;
  review_status: ReviewStatus | null;
  reviewed_at: string | null;
  review_note: string | null;
  reviewer_name: string | null;
}

export interface PendingResponse {
  pending: AssistantLogRow[];
}

/** `POST /api/revit/assistant/examples`-ийн нэг элемент. */
export interface ExamplePayload {
  text: string;
  intent: AssistantIntent;
  slot?: string | null;
  style?: string | null;
  /**
   * ⚠️ ЗААВАЛ.  Урьд нь сервер тал анхдагчаар `'usage'` тавьдаг байсан тул
   * ГАРААР шивсэн мөр «бодит хэрэглээнээс ажиглагдсан» гэж ХУДАЛ
   * бүртгэгддэг байв.  Одоо `'usage'` бол `log_id` мөн заавал.
   */
  source: 'seed' | 'usage' | 'manual';
  log_id?: number;
  /**
   * ⚠️ ЗААВАЛ (1B аудит P0-C).  Илгээхгүй бол сервер `'UNKNOWN'` тавьдаг
   * бөгөөд 0215-ийн бодлогоор `UNKNOWN` мөр сургалтын цөмд ХЭЗЭЭ Ч
   * ОРОХГҮЙ — өөрөөр хэлбэл хүний бүх курацийн хөдөлмөр ХОГ болно.
   * `optional` болговол дараагийн бичигч түүнийг чимээгүй мартана, тиймээс
   * ЗАРИМДАА БИШ, ҮРГЭЛЖ.  Утгыг `curation.ts`-ийн `curationSourceType`
   * ургуулна — гараар бичихгүй.
   */
  source_type: SourceType;
  /**
   * Курацийн ИЛ үйлдэл (гэрээ G1).  Сервер `source_type`-ыг ҮҮНЭЭС ургуулах
   * эрхтэй; өнөөдрийн роут үл ойшоодог ч илгээх нь эрсдэлгүй ба
   * сервер-дэривэц нэмэгдэхэд frontend-ийг ЗАСАХГҮЙГЭЭР зөв болно.
   */
  curation_action: CurationAction;
}

/** `POST /api/revit/assistant/examples`-ийн хариу. */
export interface ExamplesResponse {
  /** БОДИТООР `assistant_examples`-д орсон мөрийн тоо (сервер шүүсний дараа). */
  added: number;
  /** `curated = 1` болгосон түүхий бүртгэлийн тоо. */
  curated: number;
}

/** `POST /api/revit/assistant/review`-ийн хариу. */
export interface ReviewResponse {
  /**
   * СЕРВЕРИЙН `meta.changes`.  Илгээсэн тооноос БАГА байж болно —
   * `AND review_status IS NULL` нь аль хэдийн хянагдсан мөрийг алгасдаг
   * (давхар хяналт эхний шийдвэрийг дарж бичихгүй).
   */
  rejected: number;
}

/** `POST /api/revit/assistant/reject`-ийн хариу. */
export interface RejectResponse {
  /** `review_state='rejected'` + `is_active=0` болсон ЖИШЭЭНИЙ тоо. */
  rejected_examples: number;
  /** «харлаа, дэвшүүлэхгүй» гэж хаагдсан ТҮҮХИЙ БҮРТГЭЛИЙН тоо. */
  closed_logs: number;
}

/** `GET /api/revit/assistant/export`-ийн мөр (зөвхөн admin). */
export interface ExportRow {
  /**
   * ⚠️ СОНГОЛТТОЙ, ЗОРИУД.  `GET /assistant/export`-ийн SELECT нь өнөөдөр
   * `id`-г БУЦААДАГГҮЙ (`revit.ts` — `SELECT text, intent, slot, style,
   * source, source_type, …`).  `POST /assistant/reject`-ийн `example_ids`
   * салаа нь ЯГ ҮҮНИЙГ шаарддаг тул сервер `id` нэмэх хүртэл жишээ талын
   * «Хасах» товч ХАРАГДАХГҮЙ.  `optional` байдал нь тэр өдөр ирэхэд
   * frontend-д ЯМАР Ч засвар шаардахгүйг баталгаажуулна.
   */
  id?: number;
  text: string;
  intent: string;
  slot: string | null;
  style: string | null;
  source: string;
  /** 0215-ийн итгэлийн таксономи.  Хуучин worker дээр `undefined`. */
  source_type?: string;
  /** 'pending' | 'reviewed' | 'verified' | 'rejected' (0215). */
  review_state?: string;
}

export interface ExportResponse {
  count: number;
  per_intent: Record<string, number>;
  /** ⚠️ ЗӨВХӨН НЭМЭЛТ талбар — хуучин worker дээр `undefined`. */
  per_source_type?: Record<string, number>;
  rows: ExportRow[];
}

/* ------------------------------------------------------------------ */
/*  Багц үйлдлийн тайлан                                               */
/* ------------------------------------------------------------------ */

/** Багц үйлдлийн төрөл — тайлангийн гарчиг ба өнгө ҮҮНЭЭС гарна. */
export type BulkActionKind = 'promote' | 'reject';

/**
 * Тайлангийн НЭГ мөр.
 *
 * ⚠️ `text`-ийг ЗААВАЛ ХУУЛБАРЛАЖ хадгална.  Амжилттай мөрүүд дуудлагын
 * дараа дарааллаас АЛГА БОЛНО (`curated = 1`), тиймээс тайланг `rows`-оос
 * дахин уншиж чадахгүй — «аль мөр амжилтгүй болов» гэдгийг харуулах ганц
 * арга бол үйлдлийн МӨЧИД авсан агшин зураг.
 */
export interface BulkResultRow extends BulkRowOutcome {
  text: string;
}

export interface BulkResult {
  kind: BulkActionKind;
  /** `Date.now()` — дараалал ДАХИН уншигдсан эсэхийг үүгээр шалгана. */
  at: number;
  rows: BulkResultRow[];
  /** Серверийн НИЙТ тоо (`added` / `rejected`).  Талбар танигдаагүй бол null. */
  serverCount: number | null;
  /** Сервер мөр тус бүрийн үр дүн БУЦААСАН уу. */
  perRowFromServer: boolean;
  /** Дуудлага бүхэлдээ унасан уу (сүлжээ / 4xx / 5xx). */
  requestFailed: boolean;
}
