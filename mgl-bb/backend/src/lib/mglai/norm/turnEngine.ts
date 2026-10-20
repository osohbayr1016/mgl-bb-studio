/**
 * ЭЭЛЖИЙН ХӨДӨЛГҮҮР — `/plan` ба `/context` ЯГ ЭНЭ функцийг дуудна (хосын зөрүү ҮГҮЙ).
 *
 *   даалгаврын текст → инженерийн entity (+ өмнөх нормын төлөв)
 *   → runNormEngine → TrustedNormResult | null
 *   → локал /norm-д өгөх асуулт (хөдөлгүүр баримт сонгосон бол кодоор ЦООЖИЛНО)
 *   → дараагийн ээлжийн нормын төлөв
 *
 * ⚠️ Санаа CALCULATION / GENERAL_HELP байсан ч инженерийн оролт байвал хөдөлгүүр
 *    ажиллана — GOLD-B05 (750 м³, «бодож») CALCULATION гэж ангилагдаад бүх
 *    хамгаалалт унтарч байсан; бодит хариу нь 4.4-ийн нөөц дүрэм.
 */
import type { AiIntent } from '../intent';
import type { ConvState, NormTurnState } from '../convState';
import { refersBack, type TurnKind } from '../turn';
import { extractEngineeringEntities, type EngineeringEntities } from './entities';
import { runNormEngine } from './engine';
import type { NormRegistry } from './registry';
import type { TrustedNormResult } from './types';

const NON_NORM_INTENTS = new Set<AiIntent>(['CASUAL', 'META', 'REVIT_READ', 'REVIT_ACTION', 'COMPANY_FACT', 'ERP_ANALYSIS', 'DOCUMENT_ANALYSIS']);

export interface TurnEngineInput {
  question: string;
  /** Олон санаатай мессежийн НОРМЫН даалгаврын текст (байхгүй бол асуулт бүхэлдээ). */
  normTaskText: string | null;
  intent: AiIntent;
  /**
   * Ээлжийн төрөл — ӨМНӨХ ОРОЛТЫГ зөвхөн ҮРГЭЛЖЛЭЛД (FOLLOW_UP / CONTINUATION /
   * CLARIFICATION / REFERENCE / CORRECTION) нэгтгэнэ.  ШИНЭ СЭДЭВ («g = 100 бол?» — өөр
   * өрөө) өмнөх Q, H-г өвлөхгүй: хэмжсэн (GOLD multi-turn M5) — өвлүүлбэл 4.20-ын шалгалт
   * өмнөх өрөөний Q-гээр хийгдэж В4 → В3 болж байв.
   */
  turnKind?: TurnKind;
  state: ConvState;
  lang: 'mn-Cyrl' | 'en';
  registry: NormRegistry;
}

export interface TurnEngineOutput {
  result: TrustedNormResult | null;
  entities: EngineeringEntities;
  /** Локал `/norm`-д өгөх асуулт — хөдөлгүүр баримт сонгосон бол кодоор угтварласан. */
  normQuery: string;
  /** Хөдөлгүүр огт оролцоогүй (нормын бус санаа / инженерийн дохиогүй). */
  applicable: boolean;
  usedPrior: boolean;
  /**
   * Хэрэглэгч ИЛ нэрлэсэн баримт бүртгэлд байхгүй — хөдөлгүүр өөр баримтаас хариулахгүй
   * (P0-3).  Локал хайлт тэр баримтад цоожлогдоно; санд ч байхгүй бол `/context`
   * `named_document_absent` болгоно.
   */
  namedOutsideRegistry: string | null;
}

function priorFromState(norm: NormTurnState | null): Partial<EngineeringEntities> | null {
  if (norm === null) return null;
  return {
    ...(norm.inputs as Partial<EngineeringEntities>),
    medium: norm.medium as EngineeringEntities['medium'],
    equipmentVolumeUnknown: norm.equipmentVolumeUnknown,
    documentCodes: norm.documentCode ? [norm.documentCode] : [],
  };
}

function hasEngineeringSignal(e: EngineeringEntities, question: string): boolean {
  const numeric = [e.gMjM2, e.qMj, e.sM2, e.hM, e.deltaPKpa, e.flashPointC, e.apparatusPressureKpa, e.apparatusVolumeM3, e.geometricVolumeM3, e.volumeM3, e.failureProbabilityPerYear];
  if (numeric.some((v) => typeof v === 'number')) return true;
  if (e.documentCodes.length > 0 || e.mentionedCategories.length > 0 || e.medium.length > 0) return true;
  // «автомат» гэсэн үг л (`manualShutoff=false`) дохио БИШ — «гал унтраах АВТОМАТ төхөөрөмж» асуултыг хаалтын тооцоо болгож байв.
  if (e.asks.shutoffTime || e.manualShutoff === true) return true;
  if (e.ambiguous.length > 0) return true;
  return /needs_human_review/i.test(question);
}

/** Нүцгэн нормын үргэлжлэл: холбогч/заагч үгтэй, богино, ӨӨР сэдвийн нэр үггүй. */
const FOLLOW_UP_CUE = /(?<!\p{L})(тэгвэл|тэгэхээр|тэгээд|энэ|тэр|дараа нь|одоо|ямар ангилал|аль ангилал|ангилал вэ|ангилал нь|эцсийн|тооц|tegvel|tegeheer|ene|ter|yamar angilal|ali angilal|angilal ve)(?!\p{L})/iu;
const OTHER_TOPIC = /(?<!\p{L})(архив|өрөө|гуат|гмдх|төхөөрөмж|дохиол|гарц|шат|гишгүүр|заалт|хүснэгт|баримт|нэгж|барилг|цэцэрлэг|сургууль|гэрэлтүүл|захиалагч|даамал|геодез|arhiv|uruu|guat|gmdh|garts|zaalt|husnegt|barimt|negj|barilg)/iu;
export function isBareNormFollowUp(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return words <= 8 && FOLLOW_UP_CUE.test(text) && !OTHER_TOPIC.test(text);
}

export function normEngineForTurn(input: TurnEngineInput): TurnEngineOutput {
  const text = input.normTaskText ?? input.question;
  const entities = extractEngineeringEntities(text);
  const base: TurnEngineOutput = { result: null, entities, normQuery: text, applicable: false, usedPrior: false, namedOutsideRegistry: null };
  if (NON_NORM_INTENTS.has(input.intent)) return base;
  const continuation = input.turnKind === undefined || (input.turnKind !== 'NEW_TOPIC' && input.turnKind !== 'MULTI_INTENT');
  const prior = continuation ? priorFromState(input.state.norm) : null;
  // ⚠️ ӨМНӨХ БАРИМТАД ЦООЖЛОХ нь зөвхөн дагалдах асуултад (FOLLOW_UP/CLARIFICATION/…) эсвэл өмнөх ээлж рүү заасан
  //    асуултад.  `turn.ts`-ийн CONTINUATION = «ижил салбарын ШИНЭ дэд асуулт» — тэнд хайлт ЦЭВЭР явах ёстой (тэр
  //    файлын 7-р алхмын тайлбар).  Өмнө нь CONTINUATION ч цоожлогддог байсан тул «SNiP II-97-76 одоо хүчинтэй юу?»
  //    асуултын дараах «авто угаалгын газрын норм юу вэ?» нь SNiP-ийн ХАА-н үйлдвэрийн заалтаар хариулагдав (эзний HL08).
  const lockPrior = continuation && (input.turnKind !== 'CONTINUATION' || refersBack(text) || isBareNormFollowUp(text));
  // ⚠️ ӨМНӨХ ТӨЛӨВӨӨР Л асахыг ЗӨВХӨН нүцгэн үргэлжлэлд («тэгвэл ямар ангилал вэ?») зөвшөөрнө.  Хэмжсэн
  //    (эзний тест 2026-09-18, прод): g=900 төлөвтэй байхад «Хатаалгын өрөөнд ГУАТ хэрэгтэй юу?», «Архивт
  //    600 мянган нэгж бол ГУАТ уу?» гэсэн ӨӨР сэдвийн нормын асуултууд бүгд «g=900 → В3» гэж хариулж байв —
  //    хөдөлгүүр тэдгээрт огт хамааралгүй атлаа prior-оор асаж, эрх бүхий үр дүн локал заалтыг дарсан.
  const bareFollowUp = prior !== null && isBareNormFollowUp(text);
  const signal = hasEngineeringSignal(entities, text) || (bareFollowUp && Object.keys(input.state.norm?.inputs ?? {}).length > 0);
  if (!signal) return { ...base, normQuery: followUpNormQuery(text, entities, lockPrior ? input.state.norm : null) };
  const result = runNormEngine({ question: text, entities, registry: input.registry, lang: input.lang, prior });
  // ⚠️ Зөвхөн ЭНЭ ЭЭЛЖИД нэрлэсэн код (өмнөх төлөвийнх биш) — бүртгэлд байхгүй бол хөдөлгүүр хариулахгүй.
  const named = entities.documentCodes.find((c) => input.registry.byCode(c) === null) ?? null;
  const namedOutsideRegistry = entities.documentCodes.length > 0 && entities.documentCodes.every((c) => input.registry.byCode(c) === null) ? named : null;
  if (result === null) return { ...base, normQuery: followUpNormQuery(text, entities, lockPrior ? input.state.norm : null), applicable: true, usedPrior: prior !== null, namedOutsideRegistry };
  const normQuery = result.documentCode !== null && entities.documentCodes.length === 0 ? `${result.documentCode}: ${text}` : text;
  return { result, entities, normQuery, applicable: true, usedPrior: prior !== null, namedOutsideRegistry: null };
}

/**
 * L2 follow-up (2026-09-18): «энэ юу гэсэн үг вэ?», «ямар нөхцөлд хамаарах вэ?» — өмнөх ээлж БАРИМТ (+ заалт)
 * тайлбарласан бол локал `/norm`-ын асуултыг тэр хаягаар угтварлана: хайлт тэр баримтад цоожлогдож, заалттай
 * бол яг тэр заалт олдоно.  Энэ ээлж өөрөө код нэрлэсэн бол хөндөхгүй; заалтын дугаар нэрлэсэн бол заалтаа солино.
 */
export function followUpNormQuery(text: string, entities: EngineeringEntities, norm: NormTurnState | null): string {
  if (norm === null || norm.documentCode === null || entities.documentCodes.length > 0) return text;
  const namesClause = /(?<![\d.])\d+(?:\.\d+)+(?![\d.])/u.test(text);
  const clause = !namesClause && norm.lastClause ? `-ын ${norm.lastClause} заалт` : '';
  return `${norm.documentCode}${clause}: ${text}`;
}

/** Дараагийн ээлжийн нормын төлөв — ТОО, орчин, баримт, үр дүнгийн хураангуй (өмнөх хариултын текст ХЭЗЭЭ Ч биш). */
export function normTurnStateFrom(entities: EngineeringEntities, result: TrustedNormResult | null, prior: NormTurnState | null, seq: number): NormTurnState | null {
  const inputs: Record<string, number> = { ...(prior?.inputs ?? {}) };
  const keys = ['gMjM2', 'qMj', 'sM2', 'hM', 'deltaPKpa', 'flashPointC', 'apparatusPressureKpa', 'apparatusVolumeM3', 'geometricVolumeM3'] as const;
  for (const k of keys) {
    const v = entities[k];
    if (typeof v === 'number') inputs[k] = v;
  }
  // ⚠️ ШИНЭ Q/S нь ХУУЧИН g-г ХҮЧИНГҮЙ болгоно, тооцоолсон g нь төлөвийн g болно.  Хэмжсэн
  //    (2026-09-18): «g=2500» → «Q=18000, S=20» гэхэд g=900 гарсан ч төлөвт 2500 үлдэж, дараагийн
  //    «ямар ангилал вэ?» В1 гэж хуучин g-ээр хариулах байв.
  if (typeof entities.qMj === 'number' || typeof entities.sM2 === 'number') {
    if (typeof entities.gMjM2 !== 'number') delete inputs.gMjM2;
  }
  if (result?.answerKind === 'calculation' && result.calculation?.calculatorId === 'specificFireLoad' && typeof result.value === 'number') {
    inputs.gMjM2 = result.value;
  }
  const medium = entities.medium.length > 0 ? [...entities.medium] : [...(prior?.medium ?? [])];
  const documentCode = result?.documentCode ?? entities.documentCodes[0] ?? prior?.documentCode ?? null;
  if (Object.keys(inputs).length === 0 && medium.length === 0 && documentCode === null) return null;
  return {
    inputs,
    medium,
    equipmentVolumeUnknown: entities.equipmentVolumeUnknown || (prior?.equipmentVolumeUnknown ?? false),
    documentCode,
    lastKind: result?.answerKind ?? prior?.lastKind ?? null,
    lastInitialCategory: result?.initialCategory ?? null,
    lastFinalCategory: result?.finalCategory ?? null,
    lastMissingInputs: result?.missingInputs ?? [],
    setAtSeq: seq,
    lastClause: prior?.lastClause ?? null,
  };
}

/** Prompt-ын ШИЙДВЭРИЙН БЛОК — загвар ЗӨВХӨН тайлбарлана (renderNormDecision-ийн залгамжлагч). */
export function renderTrustedNorm(r: TrustedNormResult): string {
  const lines: string[] = ['<<<MGLAI-NORM-DECISION>>>'];
  lines.push(`төлөв: ${r.verification}${r.authoritative ? ' (эрх бүхий)' : ''}`);
  lines.push(`төрөл: ${r.answerKind}`);
  if (r.initialCategory) lines.push(`ЭХНИЙ АНГИЛАЛ: ${r.initialCategory}`);
  if (r.finalCategory && r.finalCategory !== r.initialCategory) lines.push(`ЭЦСИЙН АНГИЛАЛ: ${r.finalCategory}`);
  if (r.answerKind === 'calculation' && r.value !== null) lines.push(`ҮР ДҮН: ${typeof r.value === 'boolean' ? (r.value ? 'нөхцөл БИЕЛНЭ' : 'нөхцөл БИЕЛЭХГҮЙ') : `${r.value}${r.unit ? ` ${r.unit}` : ''}`}`);
  for (const [k, v] of Object.entries(r.inputs)) lines.push(`оролт ${k}: ${v}`);
  if (r.calculation) for (const s of r.calculation.steps) lines.push(`тооцоо: ${s}`);
  for (const f of r.followups) {
    lines.push(`нэмэлт шалгалт: ${f.required ? 'ШААРДЛАГАТАЙ' : 'шаардлагагүй'} (${f.id})${f.missingInputs.length ? ` — дутуу оролт: ${f.missingInputs.join(', ')}` : ''}`);
    lines.push(`  ${f.textMn}`);
  }
  if (r.missingInputs.length > 0 && r.followups.length === 0) lines.push(`дутуу оролт: ${r.missingInputs.join(', ')}`);
  for (const rg of r.ranges) {
    const lo = rg.min === null ? '—' : `${rg.exclusiveMin ? '>' : '≥'}${rg.min}`;
    const hi = rg.max === null ? '' : ` … ${rg.exclusiveMax ? '<' : '≤'}${rg.max}`;
    lines.push(`муж ${rg.category}: ${lo}${hi} МДж/м²`);
  }
  for (const a of r.assumptions) lines.push(`таамаг: ${a}`);
  for (const w of r.warnings) lines.push(`анхаар: ${w}`);
  for (const p of r.provenance) lines.push(`эх сурвалж: ${p.labelMn}`);
  lines.push(`ДЕТЕРМИНИСТ ХАРИУЛТ: ${r.textMn}`);
  lines.push('<<<END-MGLAI-NORM-DECISION>>>');
  return lines.join('\n');
}
