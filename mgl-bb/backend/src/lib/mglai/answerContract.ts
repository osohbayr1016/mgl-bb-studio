/**
 * MGL AI · ХАРИУЛТЫН ГЭРЭЭ (§25, §33 — «trusted result wins»).
 *
 * ⚠️ ЯАГААД ЭНЭ ФАЙЛ ОРШИН БАЙНА.  Хэмжигдсэн (2026-09-10, Qwen3-8B):
 *      · «эх сурвалж олдсонгүй» гэж ЭХЛЭХ тушаалыг загвар үл хайхарч,
 *        нормын асуултад «бүс нутгийн хөгжил» гэж зохиосон;
 *      · нотолгоо, шийдвэр байхад ч «В2 = 10–20 м²» гэсэн ЗОХИОМОЛ тоо
 *        бичсэн.
 *    Prompt-ын тушаал нь МАГАДЛАЛТ хамгаалалт.  Энэ файл нь
 *    ДЕТЕРМИНИСТ хамгаалалт: сервер хариултад ЮУ ЗААВАЛ байх, ЮУ
 *    БАЙЖ БОЛОХГҮЙг ГЭРЭЭ болгон өгнө; хөтөч үүсгэлтийн ДАРАА,
 *    харуулахаас ӨМНӨ гэрээг тулгана (`frontend/.../lib/contract.ts`).
 *
 * ⚠️ СЕРВЕР ШИЙДНЭ, ХӨТӨЧ ТУЛГАНА.  Татгалзлын өгүүлбэр, зөвшөөрөгдсөн
 *    тоо, заавал дурдах ангилал бүгд ЭНДЭЭС гарна — хөтөч дээр хос
 *    тогтмол бичвэл зөрнө (энэ репогийн хамгийн түгээмэл алдаа).
 *
 * ⚠️ ЦЭВЭР ФУНКЦ — тестлэгдэнэ.
 */
import type { NormDecision } from './normDecide';
import { currentnessOf, currentnessTrailer, type Currentness } from './currentness';
import type { TrustedNormResult } from './norm/types';
import { buildNormContract } from './norm/contract';
import { canon } from './norm/state';

/** Нормын татгалзлын КАНОН өгүүлбэр — `promptFrame.ts`-ийн тушаалтай ижил. */
export const NORM_REFUSAL_MN = 'Энэ шаардлагыг баталгаатай хэлэх эх сурвалж одоогоор олдсонгүй.';
export const NORM_REFUSAL_EN = 'No verified source was found for this requirement.';

export interface AnswerContract {
  /**
   * norm_refusal  — норм асуусан, нотолгоо ч шийдвэр ч алга → канон
   *                 өгүүлбэр ЗААВАЛ; тоо, ангилал байж БОЛОХГҮЙ
   * norm_decision — эрх бүхий шийдвэр гарсан → ангилал ЗААВАЛ дурдагдана,
   *                 блокт байхгүй тоо байж БОЛОХГҮЙ
   * none          — гэрээгүй
   */
  kind:
    | 'norm_refusal'
    | 'norm_decision'
    | 'norm_legal_review'
    | 'analysis_metric'
    | 'none'
    /** 2026-09-11: TrustedNormResult-оос — эрх бүхий / хүний хяналт / хайлт унасан. */
    | 'norm_trusted'
    | 'norm_review'
    | 'norm_unavailable'
    /** 2026-09-18: L1 сэдвийн чиглүүлэгч — баримт ОЛОХ асуулт; жагсаалт детерминист, заалт/тоо байхгүй. */
    | 'norm_documents';
  /** Хариултад ЗААВАЛ байх өгүүлбэр (татгалзал). */
  requiredSentence: string | null;
  /** Хариултад ЗААВАЛ дурдагдах мөрүүд («В2»). */
  mustMention: string[];
  /**
   * Хариултад байж болох ТООНУУД.  `null` = хязгаарлахгүй.
   * Шийдвэрийн блокоос гарна: оролт, муж, хуудас, хүснэгт.
   */
  allowedNumbers: number[] | null;
  /**
   * Хэрэглэгчид ЗААВАЛ харуулах детерминист хураангуй — загварын
   * тайлбараас ҮЛ ХАМААРАН.  Загвар зөрсөн ч ЭНЭ мөр үнэнийг хэлнэ.
   */
  trustedText: string | null;
  /**
   * ХАРИУЛТЫН ТӨГСГӨЛД заавал байх мөр — хуучин баримтын анхааруулга.
   *
   * ⚠️ `requiredSentence`-ээс ялгаатай нь ЭХЭНД биш ТӨГСГӨЛД: хариулт нь
   *    заалтын агуулгыг хэлж болно, гэвч «одоогийн эрх бүхий байгууллага
   *    БАТАЛГААЖААГҮЙ» гэдгийг хэрэглэгч заавал үзнэ.
   */
  trailerText: string | null;
  /** Олон даалгаварт — гэрээ хамаарах даалгаврын дугаар (1-ээс). */
  taskIndex: number | null;
  /** Оношилгоо. */
  reason: string;
}

export const NO_CONTRACT: AnswerContract = {
  kind: 'none',
  requiredSentence: null,
  mustMention: [],
  allowedNumbers: null,
  trustedText: null,
  trailerText: null,
  taskIndex: null,
  reason: 'гэрээ хэрэггүй',
};

function rangeText(r: { min: number | null; max: number | null; exclusiveMin: boolean }): string {
  const lo = r.min === null ? null : `${r.exclusiveMin ? '>' : ''}${r.min}`;
  const hi = r.max === null ? null : `${r.max}`;
  if (lo !== null && hi !== null) return `${lo}–${hi}`;
  if (lo !== null) return `${r.exclusiveMin ? '>' : '≥'}${r.min}`;
  if (hi !== null) return `≤${hi}`;
  return '—';
}

function sourceText(d: NormDecision): string {
  if (!d.source) return '';
  const bits = [d.source.document];
  if (d.source.table !== null) bits.push(`Хүснэгт ${d.source.table}`);
  bits.push(`х.${d.source.page}`);
  return bits.join(', ');
}

/**
 * Шийдвэрийг ХҮНД зориулсан нэг хураангуй мөр болгоно (монголоор).
 *
 * ⚠️ ЭНЭ МӨР ЗАГВАРААС ҮЛ ХАМААРНА.  Загвар зөрүүтэй тайлбар бичсэн
 *    ч хэрэглэгч эхлээд ҮНЭНИЙГ харна.
 */
export function trustedNormText(d: NormDecision): string | null {
  if (d.status !== 'verified' || !d.decision) return null;
  const cat = d.decision.initial_category;
  const range = d.ranges.find((r) => r.category === cat);
  const rt = range ? `${rangeText(range)} МДж/м²` : null;
  const src = sourceText(d);
  if (d.mode === 'lookup') {
    return `${cat} ангилал: хувийн галын ачаалал g = ${rt ?? '—'}${src ? ` (${src})` : ''}.`;
  }
  const g = d.inputs_used.g_mj_m2;
  const extra =
    d.additional_checks.required && d.additional_checks.missing_inputs.length > 0
      ? ` Нэмэлт шалгалтад ${d.additional_checks.missing_inputs.join(', ')} хэрэгтэй.`
      : '';
  return `g = ${g} МДж/м² → ${cat} ангилал (муж ${rt ?? '—'})${src ? ` (${src})` : ''}.${extra}`;
}

/** Шийдвэрийн блокт байгаа БҮХ тоо — зөвшөөрөгдсөн тоонуудын олонлог. */
export function decisionNumbers(d: NormDecision): number[] {
  const out = new Set<number>();
  for (const v of Object.values(d.inputs_used)) out.add(v);
  for (const r of d.ranges) {
    if (r.min !== null) out.add(r.min);
    if (r.max !== null) out.add(r.max);
  }
  if (d.source) {
    out.add(d.source.page);
    if (d.source.table !== null) out.add(d.source.table);
  }
  // Ангиллын дугаар («В2» → 2, категорийн 1–4) ба 4.20 гэх мэт заалтын
  // дугаарын хэсгүүд — тэдгээрийг ТОО гэж барихгүйн тулд зөвшөөрнө.
  for (const r of d.ranges) {
    const m = /(\d+)$/.exec(r.category);
    if (m) out.add(Number(m[1]));
  }
  if (d.additional_checks.method) {
    for (const m of d.additional_checks.method.matchAll(/\d+/g)) out.add(Number(m[0]));
  }
  return [...out];
}

export interface ContractInput {
  regulatory: boolean;
  evidenceCount: number;
  normDecision: NormDecision | null;
  responseLanguage: 'mn-Cyrl' | 'en';
  /** Олон даалгаварт нормын даалгаврын дугаар. */
  normTaskIndex: number | null;
  taskCount: number;
  /** Локал нормын хариу (нотолгоо болж орсон бол) — хуучин баримтын туг. */
  localNorm?: { legalReviewRequired: boolean; effectiveStatus: string | null; documentCode: string | null; currentness?: Currentness } | null;
  /**
   * ШИНЖИЛГЭЭНИЙ ХЭМЖҮҮРИЙН тодорхойлолт (§17) — хэрэгслийн `metric_definition`.
   *
   * ⚠️ Загвар «албан ёсны KPI биш» гэж хэлэхийг зааврын дагуу ХИЙДЭГГҮЙ
   *    (хэмжигдсэн 2026-09-10: «хамгийн идэвхтэй нь X, оноо 406» — тайлбаргүй).
   *    Тиймээс тодорхойлолтыг гэрээгээр ТӨГСГӨЛД нь ЗААВАЛ залгана.
   */
  metricNote?: string | null;
  /** Хөдөлгүүрийн ИТГЭМЖЛЭГДСЭН үр дүн (P0-7) — байвал `normDecision`-оос ДЭЭГҮҮР. */
  trustedNorm?: TrustedNormResult | null;
  /** Локал нормын хайлт АМЖСАН эсэх — амжаагүй бол «олдсонгүй» гэж ХЭЛЭХГҮЙ (P0-14). */
  normRetrievalFailed?: boolean;
  /**
   * L1 БАРИМТ ОЛОХ (2026-09-18, `lib/mglai/normDocuments.ts`): сэдэвт хамаарах нормын жагсаалт
   * (код · нэр · албан холбоос · төлөв).  Байвал детерминист шийдвэргүй нормын ээлжид
   * `norm_refusal`-ын ОРОНД — «эх сурвалж олдсонгүй» гэж хэлэхгүй, жагсаалтыг өгнө.
   * `template` = серверийн детерминист жагсаалт, `trailer` = төлөвийн болгоомжлол (заавал).
   */
  normDocuments?: { count: number; template: string; trailer: string } | null;
}

export { LEGAL_REVIEW_TRAILER_MN, LEGAL_REVIEW_TRAILER_EN } from './currentness';

/** ⚠️ ГОЛ ФУНКЦ.  Ээлжийн хариултын гэрээг үүсгэнэ. */
export function buildAnswerContract(input: ContractInput): AnswerContract {
  const d = input.normDecision;
  const taskIndex = input.taskCount >= 2 ? input.normTaskIndex : null;

  // ── TrustedNormResult (P0-7/P0-11) — бүх зүйл нэг объектоос ────────
  if (input.trustedNorm) {
    const p = buildNormContract(input.trustedNorm, input.responseLanguage);
    const cat = input.trustedNorm.finalCategory ?? input.trustedNorm.initialCategory;
    return {
      kind: p.legacyKind,
      requiredSentence: p.requiredSentence,
      mustMention: p.answerMode === 'authoritative' && cat ? [cat] : [],
      allowedNumbers: p.allowedNumbers,
      trustedText: p.template,
      trailerText: p.trailerText,
      taskIndex,
      reason: p.reason,
    };
  }

  // ── Хайлт УНАСАН (offline/timeout) — «олдсонгүй»-тэй ХОЛИХГҮЙ ─────
  if (input.regulatory && input.normRetrievalFailed && input.evidenceCount === 0 && (d === null || d.status === 'no_rule')) {
    return {
      kind: 'norm_unavailable',
      requiredSentence: canon('retrieval_failed', input.responseLanguage),
      mustMention: [],
      allowedNumbers: [],
      trustedText: null,
      trailerText: null,
      taskIndex,
      reason: 'нормын хайлт амжаагүй — эх сурвалж байгаа эсэх тодорхойгүй',
    };
  }

  if (d !== null && d.status === 'verified' && d.decision) {
    const cat = d.decision.initial_category.split(',')[0]!.trim();
    return {
      kind: 'norm_decision',
      requiredSentence: null,
      mustMention: [cat],
      allowedNumbers: decisionNumbers(d),
      trustedText: trustedNormText(d),
      trailerText: null,
      taskIndex,
      reason: `эрх бүхий шийдвэр (${d.mode}) — ${cat}`,
    };
  }

  // Дүрэм БАЙГАА ч эрх бүхий хариу гарахгүй — босго ЗОХИОХЫГ хориглоно.
  if (d !== null && (d.status === 'needs_human_review' || d.status === 'missing_input')) {
    const src = sourceText(d);
    return {
      kind: 'norm_decision',
      requiredSentence: null,
      mustMention: [],
      allowedNumbers: decisionNumbers(d),
      trustedText:
        d.status === 'needs_human_review'
          ? `Тохирох дүрэм байгаа боловч хүний баталгаажуулалт хийгдээгүй тул эрх бүхий хариу өгөх боломжгүй${src ? ` (${src})` : ''}.`
          : `Ангилал тодорхойлоход ${d.additional_checks.missing_inputs.join(', ') || 'g'}-ийн утга хэрэгтэй.`,
      trailerText: null,
      taskIndex,
      reason: `шийдвэр ${d.status} — тоо зохиохыг хориглов`,
    };
  }

  // ── L1 БАРИМТ ОЛОХ — жагсаалт нь ҮНЭН, загвар зөвхөн танилцуулна ─────
  // ⚠️ Детерминист шийдвэр (дээрх салаанууд) байвал энд хүрэхгүй — заалтын хариулт жагсаалтаар
  //    солигдохгүй.  Тоо ЗӨВХӨН хайрцгаас (`trustedFacts` toolNums); канон татгалзал БАЙХГҮЙ —
  //    «эх сурвалж олдсонгүй» гэж хэлэх нь жагсаалттай зөрчилдөнө.
  if (d === null && input.normDocuments && input.normDocuments.count > 0) {
    return {
      kind: 'norm_documents',
      requiredSentence: null,
      mustMention: [],
      allowedNumbers: null,
      trustedText: input.normDocuments.template,
      trailerText: input.normDocuments.trailer,
      taskIndex,
      reason: `L1 сэдвийн чиглүүлэгч — ${input.normDocuments.count} баримт (код/нэр/холбоос/төлөв), заалт зохиохгүй`,
    };
  }

  // ⚠️ ХУУЧИН БАРИМТ — нотолгоо БАЙНА, гэвч одоогийн эрх мэт хэлж болохгүй (§23).
  if (d === null && input.localNorm?.legalReviewRequired && input.evidenceCount > 0) {
    return {
      kind: 'norm_legal_review',
      requiredSentence: null,
      mustMention: [],
      allowedNumbers: null,
      trustedText: null,
      // ⚠️ Төлөв бүрд ӨӨР трейлер (§16–17): солигдсон ≠ түүхэн ≠ шалгаагүй.
      trailerText: currentnessTrailer(input.localNorm.currentness ?? currentnessOf(input.localNorm.effectiveStatus), input.responseLanguage),
      taskIndex,
      reason: `локал баримт ${input.localNorm.documentCode ?? '?'} — ${input.localNorm.currentness ?? currentnessOf(input.localNorm.effectiveStatus)} (${input.localNorm.effectiveStatus ?? 'status unknown'})`,
    };
  }

  if (input.metricNote && d === null && !input.regulatory) {
    return {
      kind: 'analysis_metric',
      requiredSentence: null,
      mustMention: [],
      allowedNumbers: null,
      trustedText: null,
      trailerText: input.metricNote,
      taskIndex,
      reason: 'шинжилгээний хэмжүүр — албан ёсны KPI биш гэдгийг заавал хэлнэ',
    };
  }

  if (input.regulatory && input.evidenceCount === 0 && (d === null || d.status === 'no_rule')) {
    return {
      kind: 'norm_refusal',
      requiredSentence: input.responseLanguage === 'en' ? NORM_REFUSAL_EN : NORM_REFUSAL_MN,
      mustMention: [],
      // ⚠️ Татгалзалд ТОО байж болохгүй — «магадгүй 1800» нь §15-ын зөрчил.
      allowedNumbers: [],
      trustedText: null,
      trailerText: null,
      taskIndex,
      reason: 'норм асуусан, нотолгоо ч шийдвэр ч алга',
    };
  }

  return NO_CONTRACT;
}
