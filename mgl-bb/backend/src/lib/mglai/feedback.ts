/**
 * MGL AI · САНАЛ ХҮСЭЛТИЙН ТӨЛӨВИЙН МАШИН (§31, §32).
 *
 * ⚠️ ГОЛ ЗАРЧИМ: САНАЛ ХҮСЭЛТ НЬ СУРГАЛТЫН ӨГӨГДӨЛ БИШ.  Хорон санаат
 *    ажилтан 👎 дарж загварыг хордуулах ЁСГҮЙ.  Тиймээс `pending` →
 *    `approved` руу шилжих ГАНЦ зам нь АДМИН бөгөөд `approved` →
 *    `included_in_dataset` нь ГАРААР ажиллуулсан экспорт.
 *
 * ⚠️ АМЬД ЖИН ХЭЗЭЭ Ч ЭНДЭЭС ӨӨРЧЛӨГДӨХГҮЙ.  §32-ийн бүтэн мөчлөг:
 *    production хариу → санал → хяналт → залруулга → баталгаа → цэвэр
 *    багц → багцын хувилбар → сургалтын гүйлт → нэр дэвшигч загвар →
 *    үнэлгээ → ГАРААР релиз → шинэ хувилбар.
 *
 * ⚠️ БУЦААХ БОЛОМЖГҮЙ ТӨЛӨВ.  `included_in_training_run` нь ЭЦСИЙН —
 *    сургалтад орсон мөрийг «ороогүй» болгож чадахгүй, зөвхөн ДАРААГИЙН
 *    багцаас хасна.  Түүхийг дахин бичих нь багцын хувилбарлалтын бүх
 *    утгыг устгана.
 */

export const FEEDBACK_STATES = [
  'pending',
  'reviewed',
  'approved',
  'rejected',
  'needs_correction',
  'included_in_dataset',
  'included_in_training_run',
] as const;
export type FeedbackState = (typeof FEEDBACK_STATES)[number];

export function isFeedbackState(v: unknown): v is FeedbackState {
  return typeof v === 'string' && (FEEDBACK_STATES as readonly string[]).includes(v);
}

/**
 * §29-ийн шалтгааны ангилал.  ⚠️ ХААЛТТАЙ олонлог — чөлөөт текст нь
 * тусдаа талбар (`reason_text`).  Ангилал нь хэмжигдэхүйц байх ёстой.
 */
export const FEEDBACK_REASONS = [
  'incorrect',
  'misunderstood',
  'wrong_company_context',
  'wrong_revit_context',
  'wrong_regulation',
  'outdated',
  'hallucinated',
  'too_long',
  'too_short',
  'slow',
  'unsafe_action',
  'other',
] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

export function isFeedbackReason(v: unknown): v is FeedbackReason {
  return typeof v === 'string' && (FEEDBACK_REASONS as readonly string[]).includes(v);
}

/**
 * Зөвшөөрөгдсөн шилжилтүүд.
 *
 * ⚠️ `pending` -> `included_in_dataset` гэсэн ШУУД зам ЗОРИУД БАЙХГҮЙ.
 *    Баталгаагүй мөр багцад орох ЦОРЫН ГАНЦ арга нь энэ хүснэгтийг
 *    засах — тэр нь код хянан үзэхэд харагдана.
 */
const TRANSITIONS: Record<FeedbackState, readonly FeedbackState[]> = {
  pending: ['reviewed', 'rejected', 'needs_correction'],
  reviewed: ['approved', 'rejected', 'needs_correction'],
  needs_correction: ['reviewed', 'rejected'],
  approved: ['included_in_dataset', 'rejected'],
  included_in_dataset: ['included_in_training_run', 'rejected'],
  included_in_training_run: [],
  rejected: ['pending'],
};

export type TransitionError =
  | 'unknown_state'
  | 'not_allowed'
  | 'terminal'
  | 'requires_admin'
  | 'requires_correction'
  | 'requires_dataset_version';

export interface TransitionInput {
  from: FeedbackState;
  to: FeedbackState;
  /** Шилжүүлж буй хүн админ эсэх. */
  isAdmin: boolean;
  /** `approved` руу шилжихэд залруулсан хариу байх шаардлагатай эсэх. */
  hasCorrection: boolean;
  /** Санал нь 👎 эсэх — 👍 нь залруулга шаардахгүй. */
  isNegative: boolean;
  /** `included_in_dataset` руу шилжихэд багцын хувилбар. */
  datasetVersion?: string | null;
}

export type TransitionResult = { ok: true } | { ok: false; error: TransitionError };

/**
 * ⚠️ ЦЭВЭР ФУНКЦ.  Маршрут нь ЗӨВХӨН үүнийг дуудна — SQL дотор
 *    `WHERE review_state = ...` гэсэн хоёр дахь дүрэм бичих нь хоёр
 *    бодлого болж, нэг өдөр зөрнө.
 */
export function canTransition(input: TransitionInput): TransitionResult {
  if (!isFeedbackState(input.from) || !isFeedbackState(input.to)) {
    return { ok: false, error: 'unknown_state' };
  }

  const allowed = TRANSITIONS[input.from];
  if (allowed.length === 0) return { ok: false, error: 'terminal' };
  if (!allowed.includes(input.to)) return { ok: false, error: 'not_allowed' };

  // ⚠️ БҮХ шилжилт админы эрх шаардана.  Санал өгөх нь бүх хэрэглэгчид
  //    нээлттэй, харин түүнийг ХӨДӨЛГӨХ нь зөвхөн админд.
  if (!input.isAdmin) return { ok: false, error: 'requires_admin' };

  // 👎 санал нь ЗАЛРУУЛГАГҮЙГЭЭР сургалтын жишээ болж ЧАДАХГҮЙ —
  // «энэ хариу муу» гэдэг нь загварт юу заах ёстойг ХЭЛЭХГҮЙ.
  if (input.to === 'approved' && input.isNegative && !input.hasCorrection) {
    return { ok: false, error: 'requires_correction' };
  }

  if (input.to === 'included_in_dataset' && !input.datasetVersion) {
    return { ok: false, error: 'requires_dataset_version' };
  }

  return { ok: true };
}

/** Сургалтад тэнцэх эсэх — 0215-ийн `eligible(row)` заншлыг дагав. */
export function trainingEligible(state: FeedbackState): boolean {
  return state === 'approved' || state === 'included_in_dataset';
}

/**
 * Шалтгааны жагсаалтыг цэвэрлэнэ.  ⚠️ Танихгүй утга ЧИМЭЭГҮЙ хаягдана,
 * 400 буцаахгүй: хэрэглэгч UI-ийн товч дарсан бол буруу нь бидний
 * талд ба саналыг нь алдах нь дээрхээс дор.
 */
export function normalizeReasons(raw: unknown): FeedbackReason[] {
  if (!Array.isArray(raw)) return [];
  const out: FeedbackReason[] = [];
  for (const r of raw) {
    if (isFeedbackReason(r) && !out.includes(r)) out.push(r);
    if (out.length >= FEEDBACK_REASONS.length) break;
  }
  return out;
}
