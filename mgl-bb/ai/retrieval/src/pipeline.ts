/**
 * MGL AI · НОРМАТИВ ХАРИУЛТЫН ХООЛОЙ (§11-ийн бүтэн гинж).
 *
 *   асуулт → нормчлол → бүтэц гаргалт → alias өргөтгөл → бүтэцтэй хайлт
 *   → FTS/BM25 → вектор → RRF → эрхийн шүүлт → детерминист дүрэм → эшлэл
 *
 * ⚠️ ЭНЭ ФАЙЛ ЗАГВАР ДУУДАХГҮЙ, ЗОРИУД.  Гаралт нь ДОТООД ХАРИУЛТЫН
 *    ОБЪЕКТ — `status`, `decision`, `citation`, `evidence`.  Загварын
 *    үүрэг нь түүнийг МОНГОЛ ӨГҮҮЛБЭР болгох Л.  Тоо, шийдвэр, эшлэл нь
 *    аль хэдийн шийдэгдсэн байна.  Ингэснээр 4B загвар босго алдсан ч
 *    хариултын ТОО буруу болохгүй.
 *
 * ⚠️ ЭРХИЙН ШҮҮЛТ НЬ PROMPT УГСРАХААС ӨМНӨ (§6).  `visibility` нь
 *    SQL-ийн түвшинд шүүгдэнэ — «битгий хэл» гэж загварт хэлэх нь шүүлт
 *    БИШ.  Захиалагчийн горим нь `public_norm` мөрийг Л харна.
 *
 * ⚠️ ТӨЛӨВ НЬ ТОО БИШ.  «87% итгэлтэй» гэсэн тоо нь утгагүй бөгөөд
 *    хэрэглэгчийг төөрөгдүүлнэ.  Дөрвөн төлөв нь ҮЙЛДЭЛД хөрвөнө:
 *      verified            — детерминист үнэлэгдсэн, баталгаажсан мөр
 *      supported           — эх сурвалж олдсон, дүрэм гүйцэтгээгүй
 *      uncertain           — дүрэм баталгаажаагүй / нөхцөл дутуу / өөр норм
 *      insufficient_evidence — нотолгоо олдсонгүй, ЮУ Ч БҮҮ ЗОХИО
 */
import type { DatabaseSync } from 'node:sqlite';
import { normalizeQuery, isInstructionWord, isStopword, foreignOrgExpansion, type NormQuery } from './normalize.ts';
import { foldText } from './fold.ts';
import { stemVariants } from './stem.ts';
import { actionPrefix, cuedRuleKinds, type CuedRuleKind } from './questionKind.ts';
import { structuredCandidates, ftsCandidates, sectionCandidates, expandAliases, requestedDocument, excludedSearchTokens, type Candidate, type RequestedDocument } from './search.ts';
import { aliasRuleCandidates, contextCandidates } from './legs.ts';
import { rrfFuse, type FusedHit } from './fusion.ts';
import {
  evaluateRule,
  decisionFlags,
  candidateFields,
  type NormRule,
  type RuleDecision,
  type Context,
} from './rules.ts';
import { buildCitation, isCitable, officialUrl, type Citation } from './citation.ts';
import { NullVectorIndex, type VectorIndex, type EmbeddingEngine } from './vector.ts';

export type AnswerStatus = 'verified' | 'supported' | 'uncertain' | 'insufficient_evidence';

/**
 * Асуултын АГУУЛГЫН токенууд — зогсоох үг хасагдсан, ≥4 тэмдэгт эсвэл тоо.
 * Фолдолсон хэлбэрээр буцаана (кирилл/латин ялгаагүй харьцуулахад).
 */
export function contentTokens(q: NormQuery, exclude: ReadonlySet<string> = new Set()): string[] {
  const out: string[] = [];
  for (const t of q.tokens) {
    if (exclude.has(t)) continue;
    const isNumber = /^\d/.test(t);
    const isCategory = /^[вv][1-4]$/u.test(t);
    if (!isNumber && !isCategory && t.length < 4) continue;
    if (!isNumber && (isStopword(t) || isInstructionWord(t))) continue;
    const f = foldText(t);
    if (f.length === 0) continue;
    out.push(isNumber ? t : f);
  }
  return out;
}

/**
 * АСУУЛТЫН ФОКУС — асуух үгийн ХАЖУУДАХ нэр үг: «ямар МАСШТАБААР», «ГАЛЫН АЧААЛАЛ хэд вэ»,
 * «хэдэн ГАРЦ», «what SCALE», «how many EXITS».  Энэ бол хэрэглэгчийн ХАЙЖ БУЙ хэмжигдэхүүн.
 *
 * ⚠️ ХЭМЖСЭН (GOLD-B09, 2026-09-11): «Хот суурины ерөнхий төлөвлөгөөг ямар масштабаар
 *    боловсруулах вэ?» гэхэд УББ 11-202-00 санд байхгүй атлаа СНиП II-97-76-ийн 1.1
 *    («…ерөнхий төлөвлөгөө… боловсруулахад…») 3 токеноор давхцаж `supported` гарч байв —
 *    сэдэв ойролцоо, харин «масштаб» гэдэг үг нэг ч хэсэгт БАЙХГҮЙ.  Давхцлын ТОО үүнийг
 *    ялгаж чадахгүй; фокус үг нь ялгана.  Зөвхөн FTS-ээр ирсэн хэсэгт хамаарна (бүтэцтэй
 *    хөл хаалганаас чөлөөтэй хэвээр); фокус үг корпуст түгээмэл бол хаалга үйлчлэхгүй.
 */
const FOCUS_BEFORE = new Set(['ямар', 'iamar', 'yamar', 'хэдэн', 'heden', 'what', 'which', 'many', 'much']);
const FOCUS_AFTER = new Set(['хэд', 'hed', 'хэдээс', 'hedees', 'хэдэн', 'heden', 'хэдий', 'hedii', 'вэ', 've', 'бэ', 'be', 'юу', 'yu', 'уу', 'үү', 'uu']);

/**
 * ⚠️ ЗӨВХӨН ФИЗИК ХЭМЖИГДЭХҮҮН.  «ямар төрлийн», «ямар мэдээлэл», «хэдий хугацаанд», «ямар
 *    шаардлагатай» гэсэн ХИЙСВЭР фокус (төрөл, мэдээлэл, хугацаа, шаардлага, зарчим, тохиолдол,
 *    босго, үүрэг…) нь эх бичвэрт тэр үгээрээ байдаггүй («3 сарын дотор», «ГУАТ») — хэмжсэн
 *    (2026-09-11): хийсвэр фокусыг шаардахад 2955 тестийн 20 нь унасан, 2 засагдсан.
 *    Хэмжигдэхүүний нэр (масштаб, зай, өндөр, даралт…) харин эх бичвэрт ҮРГЭЛЖ байдаг.
 */
const QUANTITY_FOCUS = new Set([
  'mashtab', 'zai', 'ondor', 'orgon', 'urt', 'gun', 'talbai', 'ezlehun', 'daralt', 'temperatur', 'hurd', 'nalu', 'zuzan',
  'diametr', 'radius', 'ontsog', 'mass', 'jin', 'niagt', 'chadal', 'achalal', 'hem',
  // Хугацааны хэмжээ (2026-09-23): «нар хэдэн ЦАГ тусах ёстой» — фокусгүй байхад цаг огт дурдаагүй
  //    «бүлэг дэх хүүхдийн тоо» (5.1.31) 6.1.11-ээс («…нийлбэр ≥2.5 цаг») дээгүүр гарч байв (эзний HL10).
  'cag', 'honog', 'minut',
  'scale', 'distance', 'height', 'width', 'length', 'depth', 'area', 'volume', 'pressure', 'temperature', 'speed', 'slope',
  'thickness', 'diameter', 'angle', 'weight', 'density', 'capacity', 'load', 'spacing', 'clearance', 'hours', 'days', 'minutes',
]);

function isQuantityFocus(folded: string): boolean {
  for (const w of QUANTITY_FOCUS) if (folded === w || folded.startsWith(w)) return true;
  return false;
}

export function focusTerms(q: NormQuery): string[] {
  const toks = q.tokens;
  const out = new Set<string>();
  const accept = (t: string | undefined): void => {
    if (!t) return;
    if (/^\d/.test(t) || t.length < 3 || isStopword(t)) return;
    const f = foldText(t);
    if (f.length >= 3 && isQuantityFocus(f)) out.add(f);
  };
  for (let i = 0; i < toks.length; i += 1) {
    const t = toks[i]!.toLowerCase();
    // «ямар X», «хэдэн X», «what X», «how many X»
    if (FOCUS_BEFORE.has(t)) accept(toks[i + 1]);
    // «X хэд вэ», «X хэдээс», «X юу вэ» — X нь асуух үгийн өмнөх нэр үг
    if (FOCUS_AFTER.has(t) && i > 0) {
      const prev = toks[i - 1]!.toLowerCase();
      if (!FOCUS_AFTER.has(prev) && !FOCUS_BEFORE.has(prev)) accept(toks[i - 1]);
    }
  }
  return [...out];
}

/** Хэсэг фокус үгийг (угтвараар) агуулж байна уу. */
export function hasFocus(text: string, focus: readonly string[]): boolean {
  if (focus.length === 0) return true;
  const hay = ` ${foldText(text)} `;
  return focus.some((t) => hay.includes(` ${t.slice(0, Math.max(4, t.length - 2))}`));
}

/**
 * Хамаарлын ХААЛГА: хэсэг нь асуултын агуулгын токеноос ХЭДИЙГ таарах ёстой вэ.
 *
 * ⚠️ ХАРЬЦАА БИШ, ТОО.  Урт байгалийн асуулт (16 токен) нь зөв заалттай
 *    3–5 токеноор л таардаг тул «≥50%» шаардвал зөв хариу хаагдана.
 *    Харин «V2 galyn achaalal» (3 токен) нь «галын» гэсэн ганц ерөнхий
 *    үгээр хамааралгүй заалт олдог тул ГАНЦ таарц хангалтгүй.
 *    Тиймээс: ≥2 токен (асуулт 2-оос цөөн агуулгын токентой бол бүгд).
 */
export function overlapRequired(tokenCount: number): number {
  return Math.min(2, Math.max(1, tokenCount));
}

/**
 * Хэсэг нь асуултын хэдэн агуулгын токентой таарч байна вэ (угтвараар).
 *
 * ⚠️ УГТВАРААР — «ачаалал» нь «ачааллын» дотор таарна; фолд нь «кх→х»,
 *    «ы→и» гэх мэт хувилбарыг нэгтгэнэ.  Тоо нь яг таарна («300» ≠ «3000»).
 */
/**
 * Корпуст ХЭТ ТҮГЭЭМЭЛ токен — «улсын», «барилгын», «албан» — хамаарал
 * заадаггүй.  Зогсоох үгийн жагсаалт нь ХЭЛНИЙХ, энэ нь КОРПУСЫНХ:
 * хэсгүүдийн >15%-д байдаг үг нь ялгамж өгөхгүй (BM25-ийн IDF-тэй ижил
 * санаа, гэвч хаалганд ТОО хэрэгтэй, оноо биш).
 *
 * ⚠️ Хэмжигдсэн (2026-09-10): «Автомашины улсын дугаар солих журам» нь
 *    «улсын» + «журам»-аар УББ 12-01-01-ийн заалт олж байв.
 */
/** Нэр томьёо бүрийн корпусын ДАВТАМЖ (хэсгийн хувь) — угтвараар. */
export function termDocFreq(db: DatabaseSync, terms: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  const total = (db.prepare('SELECT COUNT(*) AS n FROM ai_chunks').get() as { n: number }).n;
  if (total === 0) return out;
  for (const t of terms) {
    if (/^\d/.test(t) || out.has(t)) continue;
    try {
      const n = (
        db
          .prepare('SELECT COUNT(*) AS n FROM ai_chunks_fts WHERE ai_chunks_fts MATCH ?')
          .get(`"${t.replace(/"/g, '""')}"*`) as { n: number }
      ).n;
      out.set(t, n / total);
    } catch {
      continue;
    }
  }
  return out;
}

export function corpusCommonTerms(db: DatabaseSync, terms: readonly string[]): Set<string> {
  const common = new Set<string>();
  for (const [t, ratio] of termDocFreq(db, terms)) if (ratio > 0.15) common.add(t);
  return common;
}

/**
 * ХОВОР СЭДВИЙН ҮГ — корпусын ≤3%-д байдаг, ≥5 үсэгтэй агуулгын токен («суурин», «шийдэл»,
 * «ачаалал»).  Фокус үгтэй асуултад (ямар X / X хэд вэ) хэсэг нь фокусаас ГАДНА сэдвийн
 * ховор үгийн аль нэгийг агуулах ёстой — «масштаб» гэсэн үгээр л геодезийн трассын
 * заалт хот суурины ерөнхий төлөвлөгөөний асуултад орж ирэхгүй (GOLD-B09, хэмжсэн).
 */
export function rareSubjectTerms(freq: ReadonlyMap<string, number>, terms: readonly string[], exclude: ReadonlySet<string>): string[] {
  const cand: { t: string; r: number }[] = [];
  for (const t of terms) {
    if (exclude.has(t) || /^\d/.test(t) || t.length < 5) continue;
    const r = freq.get(t);
    if (r !== undefined && r > 0 && r <= 0.03 && !cand.some((c) => c.t === t)) cand.push({ t, r });
  }
  // ⚠️ ХАМГИЙН ХОВОР ГУРАВ — «ерөнхий» (2.6%), «боловсруулах» (1.7%) гэх мэт хагас
  //    ерөнхий үг нь «суурин» (0.4%), «төлөвлөгөө» (0.2%)-ийг орлож болохгүй (хэмжсэн:
  //    геодезийн трассын заалт тэр хоёроор хот суурины асуултад орж байв).
  return cand.sort((a, b) => a.r - b.r).slice(0, 3).map((c) => c.t);
}

/**
 * ЗАНГУУ ҮГ (GAP-032) — асуултын агуулгын токеноос корпусын ≤0.5 %-д л байдаг, ≥5 үсэгтэй
 * үгс (хамгийн ховор 2).  Ийм үг нь асуултын СЭДВИЙГ тодорхойлдог («лифт», «инкубатор»);
 * түүнгүй хэсэг нь сэдэв ойролцоо ч ӨӨР зүйлийн тухай.  `rareSubjectTerms`-ээс ялгаа:
 * (1) фокусгүй асуултад ч үйлчилнэ, (2) АЛЬ НЭГ биш БҮГД байх ёстой — гэхдээ босго нь
 * 3 % биш 0.5 % тул «ерөнхий», «боловсруулах» гэх мэт хагас ерөнхий үг зангуу болохгүй.
 * Корпуст огт байхгүй үг (df = 0: галиг/хэлбэрийн зөрүү) зангуу БИШ — recall алдахгүй.
 */
export function anchorTerms(freq: ReadonlyMap<string, number>, terms: readonly string[], totalChunks = Infinity): string[] {
  const cand: { t: string; r: number }[] = [];
  for (const t of terms) {
    if (/^\d/.test(t) || t.length < 5) continue;
    const r = freq.get(t);
    // ≤0.5 % ЭСВЭЛ ≤5 хэсэг — жижиг санд (нэг багц, 163 хэсэг) хувь нь 1.2 % болж зангуу алдагдахгүй.
    if (r !== undefined && r > 0 && (r <= 0.005 || r * totalChunks <= 5) && !cand.some((c) => c.t === t)) cand.push({ t, r });
  }
  return cand.sort((a, b) => a.r - b.r).slice(0, 1).map((c) => c.t);
}

function chunkTotal(db: DatabaseSync): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM ai_chunks').get() as { n: number }).n;
}

/** Зангуу үгийг БОГИНО язгуураар тулгана (≤6 үсэг): «даалгаврыг» ↔ «даалгавар», «лифтний» ↔ «лифт». */
export function hasAnchor(text: string, term: string): boolean {
  const stem = term.slice(0, Math.max(4, Math.min(6, term.length - 2)));
  return ` ${foldText(text)} `.includes(` ${stem}`);
}

export function contentOverlap(
  q: NormQuery,
  text: string,
  extraTerms: readonly string[] = [],
  ignore: ReadonlySet<string> = new Set(),
  exclude: ReadonlySet<string> = new Set(),
): number {
  // ⚠️ ALIAS-ААР ӨРГӨТГӨСӨН нэр томьёо нь АГУУЛГЫН токен — англи асуулт
  //    («sprinkler») монгол хэсгийг («спринклер», «ГУАТ») ЯГ тэдгээрээр
  //    олдог.  Тэднийг тооцохгүй бол англи хайлт бүхэлдээ хаалганд унана
  //    (хэмжсэн: БНбД-ийн 40 англи тест).
  const toks = [
    ...contentTokens(q, exclude),
    ...extraTerms.map((t) => foldText(t)).filter((t) => t.length >= 4),
  ].filter((t) => !ignore.has(t));
  // ⚠️ Агуулгын токен ОГТ байхгүй (зөвхөн «сайн байна уу, чи юу хийж
  //    чадах вэ») бол ЮУ Ч таарахгүй — «хаалга үйлчлэхгүй» гэж бүгдийг
  //    нэвтрүүлбэл мэндчилгээнд заалт эшлэгдэнэ (хэмжсэн).
  if (toks.length === 0) return 0;
  const hay = ` ${foldText(text)} `;
  // Язгуурын хувилбар (`stem.ts`) — «даамал» асуулт «даамлын» гарчигтай, «даамлыг» асуулт «даамал»
  //    заалттай таарна.  ЭХ токеноос гаргаж фолдолно (фолд нь «ы»-г «i» болгож залгаврыг бүдгэрүүлдэг).
  const variants = new Map<string, string[]>();
  for (const raw of q.script === 'en' ? [] : q.tokens) {
    const f = foldText(raw);
    if (!variants.has(f)) variants.set(f, stemVariants(raw).map((v) => foldText(v)).filter((v) => v.length >= 4));
  }
  let n = 0;
  for (const t of toks) {
    if (/^\d/.test(t)) {
      if (new RegExp(`(?<![0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![0-9])`).test(hay)) n += 1;
    } else if (hay.includes(` ${t.slice(0, Math.max(4, t.length - 2))}`) || (variants.get(t) ?? []).some((v) => hay.includes(` ${v}`))) {
      // ⚠️ ҮГИЙН ЭХЭНД таарна.  Дурын дэд мөрөөр таарууулбал «хана» нь
      //    «чанаргүй» дотор олдож, лифтний асуултад захиалагчийн эрхийн
      //    заалт «хамааралтай» болж байв (хэмжсэн 2026-09-10).
      n += 1;
    }
  }
  return n;
}

/** Захиалагч vs ажилтан — §6.  Нэр нь `visibility` багананы утгууд. */
export type Audience = 'client' | 'employee';

export interface EvidenceChunk {
  chunk_id: string;
  /** ⚠️ ХЭСЭГ БҮРИЙН баримт — толгой эшлэлийн баримтыг бүх хэсэгт дарахгүй (F-B). */
  doc_id: string;
  code: string;
  kind: string;
  text_mn: string;
  page: number | null;
  table_no: number | null;
  row_no: string | null;
  clause_no: string | null;
  verification_status: string;
  score: number;
}

export interface NormativeAnswer {
  query: NormQuery;
  status: AnswerStatus;
  /**
   * НЭРЛЭСЭН детерминист үр дүн.  `true` = шаардана, `false` = шаардахгүй,
   * `null` = ШИЙДЭГДЭЭГҮЙ (нөхцөл дутуу, өөр норм, эсвэл баталгаажаагүй).
   *
   * ⚠️ Түлхүүр нь БАРИМТААС хамаарна: БНбД 21-04-05 нь `GUAT`/`GMDH`,
   *    УББ 12-01-01 нь `independent_client_office_mandatory` гэх мэт.
   *    Хатуу хоёр талбартай байсан нь хоёр дахь баримт ирэхэд таараагүй.
   */
  decisions: Record<string, boolean | null>;
  /** ⚠️ ХОЦРОГДСОН — `decisions`-ийг ашигла.  `/norm`-ийн гэрээний нийцэл. */
  decision: { GUAT: boolean | null; GMDH: boolean | null };
  rule_id: string | null;
  /** obligation | right | responsibility | threshold | deadline | table_row */
  rule_kind: string | null;
  rule_object_mn: string | null;
  /** ⚠️ Хэн үүрэг хүлээх вэ — УББ-д гол ялгуур, БНбД-д `null`. */
  rule_actor: string | null;
  inputs_used: Record<string, number | string | boolean>;
  missing_context: string[];
  citation: Citation | null;
  evidence: EvidenceChunk[];
  /** Оношилгоо — аль хөл юу оруулсан. */
  legs: FusedHit['legs'] | null;
  /** Хүнд уншуулах богино тайлбар (загварт ОРОЛТ, гаралт биш). */
  note_mn: string;
  /**
   * «ОЛДСОНГҮЙ»-н шалтгаан — ЗӨВХӨН `insufficient_evidence` үед.
   *   no_candidates       — хайлт юу ч буцаасангүй
   *   no_visible_chunk    — олдсон ч эрхээр нуугдсан
   *   no_content_overlap  — олдсон ч асуултын агуулгын үгтэй таараагүй
   * ⚠️ Хайлт УНАСАН (алдаа, timeout) нь энд ХЭЗЭЭ Ч орохгүй — тэр нь
   *    HTTP-ийн түвшинд, өөр төлөв (§24).
   */
  no_match_reason?: NoMatchReason;
  /**
   * Хэрэглэгчийн НЭРЛЭСЭН баримт (явцуу код) — `absent=true` бол тэр баримт энэ
   * санд байхгүй тул хайлт ОГТ ажиллаагүй (өөр баримтаас хариулахгүй).
   */
  named_document: RequestedDocument | null;
  /** Зөвхөн `opts.debug` үед. */
  diagnostics?: RetrievalDiagnostics;
}

/**
 *   no_candidates                — хайлт юу ч буцаасангүй
 *   no_visible_chunk             — олдсон ч эрхээр нуугдсан
 *   no_content_overlap           — олдсон ч асуултын агуулгын үгтэй таараагүй
 *   named_document_absent        — нэрлэсэн баримт САНД БАЙХГҮЙ (2026-09-11)
 *   clause_not_in_named_document — нэрлэсэн баримтад тэр заалт/хүснэгт алга
 */
export type NoMatchReason =
  | 'no_candidates'
  | 'no_visible_chunk'
  | 'no_content_overlap'
  | 'named_document_absent'
  | 'clause_not_in_named_document';

export interface AskOptions {
  audience?: Audience;
  /** Гаднаас өгсөн нөхцөл — маягтаас, Revit-ээс, өмнөх ээлжээс. */
  context?: Context;
  evidenceLimit?: number;
  vectorIndex?: VectorIndex;
  /**
   * УРЬДЧИЛАН ТООЦСОН вектор нэр дэвшигч (`askNormAsync` өгнө).  Энэ хоолой
   * синхрон тул embedding-ийг ГАДНА нь тооцож, бэлэн эрэмбийг л оруулна.
   */
  vectorCandidates?: readonly Candidate[];
  /**
   * Хайлтын ГОРИМ — үнэлгээний харьцуулалтад (§14):
   *   hybrid  (өгөгдмөл) — бүтэцтэй + alias + FTS + нөхцөл + вектор
   *   lexical — векторгүй
   *   vector  — ЗӨВХӨН вектор (бүтэцтэй/alias/FTS/нөхцөл хөл унтарна)
   * ⚠️ Бүтээгдэхүүнд `hybrid`; бусад нь ХЭМЖИЛТЭД л.
   */
  mode?: 'hybrid' | 'lexical' | 'vector';
  /**
   * Вектор хөлийн ҮҮРЭГ (hybrid-д):
   *   leg    — бие даасан нэр дэвшигч (FTS-ийн олоогүйг ч авчирна)
   *   rerank — ЗӨВХӨН текстэн хөлийн эхний 25-ыг дахин эрэмбэлнэ
   * ⚠️ Хэмжигдсэн (2026-09-10, bge-m3): `leg` нь буруу баримтыг 2.4→4%
   *    өсгөж, NO_MATCH recall-ыг 69→54% унагасан; `rerank` нь хаалгыг
   *    хөндөхгүй.  Өгөгдмөл `rerank`.
   */
  vectorRole?: 'leg' | 'rerank';
  /**
   * ХАЙЛТЫН ОНОШИЛГОО (§13) — `diagnostics` талбар бөглөгдөнө: хэвийжсэн
   * асуулт, токен, хөл бүрийн нэр дэвшигч, нэгдсэн эрэмбэ, хаалгын
   * шийдвэр, сонгосон хэсэг.  Загварын сэтгэлгээ БИШ — хайлтын алхмууд.
   * ⚠️ Зөвхөн хөгжүүлэлтэд (runtime `MGLAI_DEBUG=1`); энгийн хэрэглэгчид өгөхгүй.
   */
  debug?: boolean;
}

export interface RetrievalDiagnostics {
  normalized_query: string;
  folded_query: string;
  script: string;
  tokens: string[];
  content_tokens: string[];
  common_terms: string[];
  aliases: string[];
  overlap_required: number;
  mode: string;
  legs: Record<string, { chunk_id: string; rank: number; score: number | null }[]>;
  fused: { chunk_id: string; score: number; legs: string[]; overlap: number; kept: boolean }[];
  selected: string[];
  rule_id: string | null;
  status: string;
  no_match_reason: string | null;
}

interface ChunkRow {
  chunk_id: string;
  doc_id: string;
  kind: string;
  page: number | null;
  table_no: number | null;
  row_no: string | null;
  clause_no: string | null;
  section_path: string | null;
  text_mn: string;
  search_text: string;
  visibility: string;
  verification_status: string;
  code: string;
  title_mn: string;
  effective_status: string;
  metadata_json: string;
  doc_metadata_json: string;
}

/**
 * Хэсгийн албан ёсны URL: хэсгийн `answer_source.url` → `source_locator.url`
 * (хоёулаа `metadata_json`-д) → баримтын `authoritative_current_text_url`.
 * ⚠️ Олдохгүй бол `null` — эх сурвалжийн хаяг ЗОХИОГДОХГҮЙ.
 */
function sourceUrlOf(row: ChunkRow): string | null {
  const parse = (v: string): Record<string, unknown> => {
    try {
      const o: unknown = JSON.parse(v);
      return typeof o === 'object' && o !== null ? (o as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };
  const m = parse(row.metadata_json);
  const answer = typeof m.answer_source === 'object' && m.answer_source !== null ? (m.answer_source as Record<string, unknown>) : {};
  const d = parse(row.doc_metadata_json);
  return officialUrl(answer.url) ?? officialUrl(m.url) ?? officialUrl(d.authoritative_current_text_url);
}

function loadChunks(db: DatabaseSync, ids: readonly string[], audience: Audience): Map<string, ChunkRow> {
  const out = new Map<string, ChunkRow>();
  if (ids.length === 0) return out;
  const holes = ids.map(() => '?').join(',');

  // ⚠️ ЗАХИАЛАГЧИЙН ШҮҮЛТ НЬ SQL-Д.  JS дээр шүүх нь ажилладаг ч нэг
  //    `filter` мартахад нууц мөр prompt-д орно.  SQL-д тавих нь
  //    «мартах» боломжийг арилгана.
  const visibilityFilter = audience === 'client' ? " AND c.visibility = 'public_norm'" : '';

  const rows = db
    .prepare(
      `SELECT c.chunk_id, c.doc_id, c.kind, c.page, c.table_no, c.row_no, c.clause_no,
              c.section_path, c.text_mn, c.search_text, c.visibility, c.verification_status,
              c.metadata_json, d.metadata_json AS doc_metadata_json,
              d.code, d.title_mn, d.effective_status
         FROM ai_chunks c
         JOIN ai_documents d ON d.doc_id = c.doc_id
        WHERE c.chunk_id IN (${holes})${visibilityFilter}`,
    )
    .all(...ids) as unknown as ChunkRow[];

  for (const r of rows) out.set(r.chunk_id, r);
  return out;
}

/**
 * ⚠️ НЭГ ЗААЛТАД ОЛОН ДҮРЭМ НООГДОЖ БОЛНО.  УББ 12-01-01-ийн 1.3-р заалт
 *    нь НЭГЭН ЗЭРЭГ үүрэг («төлөөлүүлэн хэрэгжүүлж болно») ба босго
 *    («жилд 1.0 тэрбумаас дээш бол заавал бие даасан алба») хоёуланг
 *    агуулдаг.  БНбД багцад ийм зүйл байгаагүй тул анхны хувилбар
 *    `LIMIT 1` гэж бичсэн ба УББ ирэхэд тэр нь ЦАГААН ТОЛГОЙН эрэмбээр
 *    үүргийн дүрмийг сонгож, ТООЦООЛОХ дүрмийг үл тоомсорлож байв —
 *    алтан кейсийн 6 нь ингэж унасан (хэмжсэн 2026-09-09).
 *
 *    Сонголтын дараалал:
 *      1. Өгөгдсөн нөхцөлөөр ҮНЭЛЭГДЭЖ ЧАДАХ дүрэм (босго, хугацаа)
 *      2. Тоон нөхцөлтэй ч нөхцөл нь дутуу дүрэм
 *      3. Нөхцөлгүй дүрэм (үүрэг, эрх, хариуцлага)
 *    Өөрөөр хэлбэл: хэрэглэгч тоо өгсөн бол ТООЦООЛОХ дүрэм ялна;
 *    тоо өгөөгүй бол заалтын ЭХ БИЧВЭР ялна.  Хоёулаа зөв зан төлөв.
 */
const KIND_PRIORITY: Readonly<Record<string, number>> = {
  threshold: 0,
  deadline: 0,
  table_row: 1,
  obligation: 2,
  // ⚠️ `requirement` нь `obligation`-ийн ҮЕТЭН, тоон нөхцөлгүй.
  //    УББ-11-201-00-д нэг заалт дээр ХОЁР ийм дүрэм тохиолдоно (заалтын
  //    бичвэр + тухайн заалтын тоон утга, ж: 3.3 → «20 жил»).  Аль нь
  //    сонгогдох нь ГАДААД ТАЛДАА НӨЛӨӨГҮЙ: хоёулаа ЯГ ижил хэсэгт
  //    (`…:clause:3.3`) холбогдох тул эшлэл, хуудас, нотолгооны бичвэр
  //    адилхан гарна — ялгаа нь зөвхөн `rule_object_mn`.  Тиймээс
  //    тэнцүү үеийн ТОГТВОРТОЙ (rule_id-аар) эрэмбэ хангалттай бөгөөд
  //    үүний тулд долоо дахь ангилал нэмэх шаардлагагүй.
  requirement: 2,
  right: 3,
  responsibility: 4,
};

/**
 * Дүрмийн объект нь асуултад ХЭДЭН ХУВИАРАА орсон бэ (0..1).
 *
 * ⚠️ ХУВИАР, ТООГООР БИШ.  Тоогоор жинлэвэл УРТ бичвэр үргэлж ялна:
 *    заалтын бүтэн эх бичвэр нь түүнээс гаргаж авсан тоон мөрийн бүх
 *    үгийг агуулдаг тул хамралт нь ҮРГЭЛЖ илүү байна.  Хуваарь нь
 *    эсрэгээр «богино бөгөөд бүхэлдээ таарсан» мөрийг дэвшүүлнэ —
 *    яг тэр нь хэрэглэгчийн асуусан зүйл.
 *
 * ⚠️ ЧИГЛЭЛ НЬ ЧУХАЛ: объектын үгийг АСУУЛТААС хайна, эсрэгээр БИШ.
 *    Монгол хэл нөхцөлөөр уртасдаг — «хугацаа» гэсэн объектын үг нь
 *    «хугацааг», «хугацаанд» гэсэн асуултын үгэнд ДЭД МӨР болж багтана.
 *    Эсрэг чиглэлээр шалгавал нөхцөлтэй асуулт бүр таарахгүй.
 *
 * ⚠️ 4 ТЭМДЭГТЭЭС УРТ ҮГ Л — `aliasRuleCandidates`-тай ижил босго.
 *    Богино үг («нь», «юу») бүх мөртэй таарч харьцуулалтыг утгагүй болгоно.
 */
function queryOverlap(objectMn: string, queryFolded: string): number {
  const tokens = foldText(objectMn)
    // ⚠️ ЗӨВХӨН ҮСЭГ, ТООГООР тасална.  `foldText` нь зайгаар тусгаарладаг ч
    //    объектод «—» зураас, таслал байдаг тул тэмдэгтийн ангиар тасалбал
    //    «20» гэсэн тоо ба зураас нь үг болж наалдахгүй.
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4);
  if (tokens.length === 0) return 0;
  let hit = 0;
  for (const t of tokens) if (queryFolded.includes(t)) hit += 1;
  return hit / tokens.length;
}

function loadRuleForChunk(
  db: DatabaseSync,
  chunkId: string,
  ctx: Context,
  queryFolded: string,
): NormRule | null {
  const rows = db.prepare('SELECT * FROM ai_rules WHERE chunk_id = ?').all(chunkId) as Array<
    Record<string, unknown>
  >;
  if (rows.length === 0) return null;

  const parsed = rows.map((row) => parseRule(row));

  if (parsed.length === 1) return parsed[0] ?? null;

  // ⚠️ «Үнэлэгдэж чадах» = нөхцөл нь ЯГ энэ контекстээс утга уншиж чадна.
  //    Зөвхөн «нөхцөлтэй эсэх»-ээр шүүвэл тоо өгөөгүй хэрэглэгч мөнхөд
  //    «нөхцөл дутуу» гэсэн хариу авна — заалтын текст нь илүү тустай.
  // ⚠️ АНГИЛАЛ НЬ ЭХНИЙ ШАЛГУУР, ХЭВЭЭР.  «Тоо өгсөн бол ТООЦООЛОХ дүрэм
  //    ялна» гэсэн зан төлөв (`pipeline.test.ts`) энэ дарааллаас гардаг.
  const rank = (r: NormRule): number => {
    if (r.conditions.length === 0) return 100;
    const evaluable = r.conditions.some((c) =>
      candidateFields(c.cond).some((f) => typeof ctx[f] === 'number'),
    );
    return evaluable ? 0 : 50;
  };

  return [...parsed].sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d !== 0) return d;

    /**
     * ⚠️⚠️ ХОЁР ДАХЬ ШАЛГУУР НЬ АСУУЛТТАЙ ХАМРАЛТ, ЗАЙЛШГҮЙ.
     *
     *     УББ-11-201-00-ын 3.8-р ЗААЛТАД ХОЁР ТОО байдаг: график зургийн
     *     эх 2 хувь, тайлбар бичиг 4 хувь.  Хоёулаа НЭГ хэсэгт холбогдох
     *     тул ангилал нь тэнцүү бөгөөд цагаан толгойн эрэмбэ
     *     («explanatory» < «graphic») нь «график хувь хэд вэ?» гэсэн
     *     асуултад «Тайлбар бичгийн хувь — 4 хувь» гэж ТОДОТГОЖ байв
     *     (хэмжсэн 2026-09-09).  Эшлэл, нотолгоо нь зөв хэвээр байсан ч
     *     загварт өгөх ГОЛ дохио нь БУРУУ ТОО байсан — энэ систем яг
     *     үүнээс сэргийлэхийн тулд оршдог.
     *
     *     Мөн 3.3-т «20 жил» (нийт) ба «5–10 жил» (эхний ээлж) хоёр
     *     байдаг: ерөнхий асуултад эхнийх нь, «эхний ээлж» гэсэн
     *     асуултад хоёр дахь нь ялах ёстой.  Хамрал үүнийг ХОЁУЛАНГ
     *     зөв шийднэ.
     *
     * ⚠️ ЗӨВХӨН НЭГ ХЭСЭГТ ОЛОН ДҮРЭМ НООГДСОН ҮЕД Л АЖИЛЛАНА — дээр
     *    `parsed.length === 1` үед функц аль хэдийн буцсан.  Тиймээс энэ
     *    нь ерөнхий эрэмбийг ХӨНДӨХГҮЙ.
     */
    const o = queryOverlap(b.object_mn, queryFolded) - queryOverlap(a.object_mn, queryFolded);
    if (o !== 0) return o;

    const k = (KIND_PRIORITY[a.rule_kind] ?? 9) - (KIND_PRIORITY[b.rule_kind] ?? 9);
    if (k !== 0) return k;

    // ⚠️ Тэнцүү үед ТОГТВОРТОЙ эрэмбэ — ажиллуулалт бүрд ижил хариу.
    return a.rule_id < b.rule_id ? -1 : 1;
  })[0] ?? null;
}

function parseRule(r: Record<string, unknown>): NormRule {
  const parse = <T>(v: unknown, fallback: T): T => {
    if (typeof v !== 'string') return fallback;
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  };

  return {
    rule_id: String(r.rule_id),
    chunk_id: String(r.chunk_id),
    doc_id: String(r.doc_id),
    rule_kind: (String(r.rule_kind ?? 'table_row') as NormRule['rule_kind']),
    table_no: (r.table_no as number | null) ?? null,
    row_no: (r.row_no as string | null) ?? null,
    clause_no: (r.clause_no as string | null) ?? null,
    page: (r.page as number | null) ?? null,
    section: (r.section as string | null) ?? null,
    object_mn: String(r.object_mn ?? ''),
    object_latin: (r.object_latin as string | null) ?? null,
    actor: (r.actor as string | null) ?? null,
    required_context: parse(r.required_context_json, [] as string[]),
    conditions: parse(r.conditions_json, [] as NormRule['conditions']),
    aliases_mn: parse(r.aliases_mn_json, [] as string[]),
    aliases_latin: parse(r.aliases_latin_json, [] as string[]),
    aliases_en: parse(r.aliases_en_json, [] as string[]),
    decision_policy: String(r.decision_policy ?? ''),
    citation_required: Number(r.citation_required) === 1,
    verification_status: String(r.verification_status ?? 'unknown'),
    notes: parse(r.notes_json, [] as string[]),
  };
}

/**
 * Нэг норматив асуултыг ХАРИУЛНА.
 *
 * ⚠️ ЭНЭ ФУНКЦ ХЭЗЭЭ Ч НОРМ ЗОХИОХГҮЙ.  Нотолгоо олдоогүй бол
 *    `insufficient_evidence` буцаана — тэр нь UI-д «баталгаатай эх
 *    сурвалж олдсонгүй» болж харагдана.  Ойролцоо утгатай мөрийг
 *    «магадгүй энэ байх» гэж дүрсэлж БОЛОХГҮЙ.
 */
/**
 * Вектор нэр дэвшигч — embedding хөдөлгүүр + индексээс, RRF-д зориулж ЭРЭМБЭ
 * болгоно.  Хөдөлгүүр/индекс байхгүй бол ХООСОН (алдаагүй).
 *
 * ⚠️ `minScore` нь cosine босго: bge-m3 дээр хамааралгүй хос ~0.3–0.45,
 *    хамааралтай нь ≥0.5 (хэмжигдэх ёстой — `ai:eval:retrieval`).
 */
export async function vectorCandidates(
  embedder: EmbeddingEngine,
  index: VectorIndex,
  rawQuery: string,
  limit = 20,
  minScore = 0.45,
): Promise<Candidate[]> {
  if (!embedder.available || !index.available) return [];
  try {
    const [qv] = await embedder.embed([rawQuery]);
    if (!qv) return [];
    const hits = await index.search(qv, limit);
    return hits
      .filter((h) => h.score >= minScore)
      .map((h, i) => ({ chunkId: h.chunkId, rank: i + 1, leg: 'vector' as const, rawScore: h.score }));
  } catch {
    return [];
  }
}

/** Асинхрон боодол — вектор хөлийг тооцоод синхрон `askNorm`-д өгнө. */
export async function askNormAsync(
  db: DatabaseSync,
  rawQuery: string,
  opts: AskOptions & { embedder?: EmbeddingEngine; index?: VectorIndex } = {},
): Promise<NormativeAnswer> {
  const mode = opts.mode ?? 'hybrid';
  const vc =
    mode !== 'lexical' && opts.embedder && opts.index
      ? await vectorCandidates(opts.embedder, opts.index, rawQuery)
      : [];
  return askNorm(db, rawQuery, { ...opts, vectorCandidates: vc });
}

export function askNorm(db: DatabaseSync, rawQuery: string, opts: AskOptions = {}): NormativeAnswer {
  const audience = opts.audience ?? 'employee';
  const evidenceLimit = Math.max(1, Math.min(5, opts.evidenceLimit ?? 5));
  const vectors = opts.vectorIndex ?? new NullVectorIndex();

  const q = normalizeQuery(rawQuery);

  /**
   * ⚠️⚠️ НӨХЦӨЛ НЬ ХОЁР ЭХ СУРВАЛЖТАЙ БА ТЭД ТЭНЦҮҮ БИШ.
   *
   *   `opts.context`  — ДУУДАГЧИЙН БАТАЛСАН баримт.  Маягтаас, Revit-ээс,
   *                     өмнөх ээлжийн тодруулсан асуултаас ирнэ.  Хүн
   *                     «талбай нь 310 м²» гэж ХЭЛСЭН.
   *   `q.entities`    — ЧӨЛӨӨТ бичвэрээс regex-ээр ТААМАГЛАСАН утга.
   *
   * ХОЁУЛАА ҮНЭЛГЭЭНД ордог — үнэлгээнд орсон утга нь `inputs_used`-д ил
   * гарч, хэрэглэгч буруу уншсаныг ХАРНА.
   *
   * ГЭВЧ ЗӨВХӨН БАТАЛСАН НЬ ЭРЭМБЭД ОРНО.  Хэмжсэн (2026-09-08, 336
   * тест): таамагласан утгыг дүрэм СОНГОХОД оруулахад
   *     дүрмийн таарц  74.7% → 65.8%
   *     mn-Cyrl        97.3% → 78.6%
   * болж унасан.  Шалтгаан нь ойлгомжтой: «5.5 м-ээс өндөр тавиуртай»
   * гэсэн асуултаас гаргасан `height_m` нь тухайн дүрмийн шаарддаг
   * талбартай яг таарахгүй байж болох ба буруу ах дүү мөрийг дэвшүүлнэ.
   *
   * Ялгааны учир: буруу ТОО нь `inputs_used`-д харагдаж засагдана, харин
   * буруу ДҮРЭМ нь өөр нормын шаардлагыг зөв тоогоор хэлж, хэрэглэгч
   * ялгаж чадахгүй.  Тиймээс таамаг нь тооцоолж болно, СОНГОЖ болохгүй.
   */
  const assertedCtx: Context = (opts.context ?? {}) as Context;
  const ctx: Context = { ...(q.entities as Context), ...assertedCtx };

  // ⚠️ ХОЁР ШАТ.  Эхлээд БИЧВЭРИЙН хөлүүд нэр дэвшигч гаргана, дараа нь
  //    нөхцөл тэдгээрийг ДАХИН ЭРЭМБЭЛНЭ.  Нөхцөлийг бие даасан хөл
  //    болгосон хувилбар нь ах дүү мөрүүдийн дунд санамсаргүй ялагч
  //    сонгож байсан (хэмжсэн: C006/C007/C010 унасан).
  const mode = opts.mode ?? 'hybrid';
  const vectorRole = opts.vectorRole ?? 'rerank';

  // ── ЯВЦУУ БАРИМТ = ХАТУУ ШҮҮЛТ (2026-09-11, P0) ─────────────────────
  const requested = requestedDocument(db, q);
  const exclude = excludedSearchTokens(q);
  if (requested.absent) {
    return {
      ...emptyAnswer(q, requested),
      note_mn: `Нэрлэсэн баримт (${requested.code}) энэ нормын санд байхгүй тул өөр баримтаас хариулсангүй.`,
      no_match_reason: 'named_document_absent',
      diagnostics: opts.debug
        ? {
            normalized_query: q.normalized,
            folded_query: q.folded,
            script: q.script,
            tokens: q.tokens,
            content_tokens: contentTokens(q, exclude),
            common_terms: [],
            aliases: [],
            overlap_required: 0,
            mode,
            legs: {},
            fused: [],
            selected: [],
            rule_id: null,
            status: 'insufficient_evidence',
            no_match_reason: 'named_document_absent',
          }
        : undefined,
    };
  }
  const docLock = requested.docIds;

  const vectorAll: Candidate[] = mode === 'lexical' ? [] : [...(opts.vectorCandidates ?? [])];
  const ftsLeg: Candidate[] = mode === 'vector' ? [] : ftsCandidates(db, q, 40, docLock, exclude);
  // Асуултын ХЭЛБЭР → хүлээгдэж буй заалтын ТӨРӨЛ (`questionKind.ts`): «…чадах уу» → эрх гэх мэт.
  //    Ил хаяг (заалт/хүснэгт нэрлэсэн) асуултад хэрэглэхгүй.
  const cue = q.docRef.clause !== undefined || q.docRef.table !== undefined ? new Set<CuedRuleKind>() : cuedRuleKinds(q.raw);
  // Бүлгийн гарчгийн хөл — нэрлэсэн баримт, эсвэл FTS-ийн ЭХНИЙ хэсгийн баримт дотор, зөвхөн төрлийн асуултад.
  const sectionDocs = docLock.length > 0 ? docLock : ftsLeg.length > 0 ? docOfChunk(db, ftsLeg[0]!.chunkId) : [];
  const textLegs: Candidate[][] =
    mode === 'vector'
      ? []
      : [structuredCandidates(db, q), aliasRuleCandidates(db, q), ftsLeg, sectionCandidates(db, q, sectionDocs, exclude, cue)];
  const firstPass = rrfFuse(mode === 'vector' || vectorRole === 'leg' ? [...textLegs, vectorAll] : textLegs);
  // rerank горимд вектор нь текстэн хөлийн ЦОНХОН доторх мөрийг л эрэмбэлнэ.
  const windowIds = new Set(firstPass.slice(0, 25).map((f) => f.chunkId));
  const vectorLeg: Candidate[] =
    mode === 'vector' || vectorRole === 'leg'
      ? vectorAll
      : vectorAll.filter((c) => windowIds.has(c.chunkId)).map((c, i) => ({ ...c, rank: i + 1 }));

  // Эхний 25 нэр дэвшигч Л дахин эрэмбэлэгдэнэ — «rerank only the small
  // top set» (§11-ийн 10-р алхам).
  const rerankWindow = new Map<string, number>();
  firstPass.slice(0, 25).forEach((f, i) => rerankWindow.set(f.chunkId, i));

  const legs: Candidate[][] = mode === 'vector' ? [vectorLeg] : [...textLegs, contextCandidates(db, assertedCtx, 8, rerankWindow)];
  // ⚠️ Вектор хөл нь УРЬДЧИЛАН тооцогдсон нэр дэвшигчээр орно
  //    (`askNormAsync` → `vectorLocal.ts`).  Энэ хоолой синхрон хэвээр:
  //    embedding-ийн HTTP дуудлага ГАДНА нь явагдана.  Байхгүй бол хоосон
  //    хөл — RRF үлдсэнээр явна, хуурамч оноо ҮГҮЙ.
  if (mode === 'hybrid' && (vectorLeg.length > 0 || vectors.available)) {
    legs.push(vectorLeg);
  }

  const fusedAll = rrfFuse(legs);
  const loadedAll = loadChunks(
    db,
    fusedAll.slice(0, 40).map((f) => f.chunkId),
    audience,
  );
  // ⚠️ Нэрлэсэн баримт байвал БҮХ хөлийн үр дүнг тэр баримтад хязгаарлана —
  //    бүтэцтэй/alias хөл SQL-д шүүгддэггүй тул энд дахин шүүнэ.
  const fused =
    docLock.length === 0
      ? fusedAll
      : fusedAll.filter((f) => {
          const row = loadedAll.get(f.chunkId);
          return row === undefined ? false : docLock.includes(row.doc_id);
        });
  if (fused.length === 0) {
    return {
      ...emptyAnswer(q, requested),
      note_mn:
        docLock.length > 0
          ? `Нэрлэсэн баримтад (${requested.relatedCode ?? requested.code ?? docLock.join(', ')}) асуултад тохирох заалт олдсонгүй.`
          : 'Баталгаажсан эх сурвалжаас тохирох заалт олдсонгүй.',
      no_match_reason: docLock.length > 0 && q.docRef.clause !== undefined ? 'clause_not_in_named_document' : 'no_candidates',
    };
  }
  // ⚠️ Нэрлэсэн баримтад ЗААЛТ ч нэрлэсэн атлаа бүтэцтэй хөл олоогүй бол —
  //    тэр заалт энэ баримтад БАЙХГҮЙ.  Өөр заалтын FTS таарцаас «verified»
  //    гаргахгүй (хэмжсэн: «БНбД 21-04-05-ын 99.99 заалт» → T1:R2 verified).
  const clauseAsked = q.docRef.clause !== undefined || q.docRef.table !== undefined;
  const structuredHit = fused.some((f) => f.legs.some((l) => l.leg === 'structured'));
  if (docLock.length > 0 && clauseAsked && !structuredHit) {
    return {
      ...emptyAnswer(q, requested),
      evidence: fused.slice(0, evidenceLimit).map((f) => toEvidence(loadedAll.get(f.chunkId) as ChunkRow, f.score)),
      note_mn: `Нэрлэсэн баримтад (${requested.code ?? docLock.join(', ')}) заалт ${q.docRef.clause ?? `хүснэгт ${q.docRef.table}`} олдсонгүй.`,
      no_match_reason: 'clause_not_in_named_document',
    };
  }

  const loaded = loadedAll;
  // ── ХАМААРЛЫН ХААЛГА (§22–24: «NO VERIFIED MATCH» ≠ дурын мөр) ──
  // ⚠️ RRF-ийн оноо нь ЗЭРЭГЛЭЛ, хамаарал БИШ.  Хэмжигдсэн (2026-09-10):
  //    ERP асуултад ч дээд 5 заалт `supported` гэж буцдаг байв.  Тиймээс
  //    зөвхөн текстэн хөлөөс (fts) ирсэн мөр нь асуултын АГУУЛГЫН токентой
  //    (зогсоох үгээс бусад, ≥4 тэмдэгт эсвэл тоо) фолдоор ТААРАХ ёстой;
  //    бүтэцтэй/alias/нөхцөл хөл нь хэрэглэгчийн ИЛ заасан хаяг тул
  //    хаалгаас чөлөөтэй.  Юу ч үлдэхгүй бол «олдсонгүй» — энэ нь
  //    «хайлт унасан»-аас ЯЛГААТАЙ (`no_match_reason`).
  const aliasTerms = expandAliases(db, q);
  const gateTerms = [
    ...contentTokens(q, exclude),
    ...aliasTerms.map((t) => foldText(t)).filter((t) => t.length >= 4),
  ];
  const freq = termDocFreq(db, gateTerms);
  const common = new Set<string>([...freq].filter(([, r]) => r > 0.15).map(([t]) => t));
  const need = overlapRequired(gateTerms.filter((t) => !common.has(t)).length);
  // Фокус үг — корпуст түгээмэл биш.  Англи/галиг асуултын фокус («scale») нь хэсгийн
  //    `search_text` (орчуулга, галиг)-д таарна — alias-ын нэгдэл ХЭРЭГГҮЙ (бүх alias-ыг
  //    нэмбэл «Ерөнхий» гэсэн alias фокусыг орлож хаалга үйлчлэхгүй, хэмжсэн).
  // `MGLAI_FOCUS_GATE=0` — зөвхөн хэмжилтийн харьцуулалтад (хаалгыг унтраана).
  const focus = process.env.MGLAI_FOCUS_GATE === '0' ? [] : focusTerms(q).filter((t) => !common.has(t));
  const focusAll = focus;
  // Сэдвийн ховор үг — зөвхөн ФОКУСТАЙ асуултад, зөвхөн асуултын өөрийн токеноос (alias биш).
  const rare = focus.length > 0 ? rareSubjectTerms(freq, contentTokens(q, exclude), new Set(focus)) : [];
  // GAP-032: асуултын ЗАНГУУ үг — маш ховор (≤0.5 %) сэдвийн үг хэсэгт ЗААВАЛ байх ёстой.
  //    «Лифтний хонгилын хана» → «хонгил» + «хана» гэсэн хоёр үгээр 31-23-12 §6.3.6 (холбох
  //    хонгил, REI45) олдож байв — «лифт» (корпусын 0.16 %) тэр хэсэгт огт байхгүй.
  //    Зөвхөн КИРИЛЛ асуултад: монголд сэдвийн нэр үг эхэнд (SOV) — эхний хоёр агуулгын токеноос
  //    хамгийн ховрыг нь; англи асуултад ховор үг нь дүрмийн үг («required», «during») байдаг
  //    (хэмжсэн: бүх асуултад шаардвал −50, эхний хоёроос ч англи 3 тест унана).
  const anchor = process.env.MGLAI_FOCUS_GATE === '0' || q.script !== 'mn-Cyrl' ? [] : anchorTerms(freq, contentTokens(q, exclude).slice(0, 2), chunkTotal(db));
  // Улсын нэр + байгууллага («solongos kompani», «Хятадын компани») → асуултын СЭДЭВ нь ГАДААДЫН байгууллага
  //    (`normalize.foreignOrgExpansion`, эзний HL05, 2026-09-23).  Нормын бичвэр «гадаадын байгууллага» гэж бичдэг тул
  //    хэсэг ӨӨРӨӨ «гадаад»-тай байх ёстой (баримтын гарчиг биш) — БҮХ бичигт.  Кирилл асуултын ердийн зангуу нь
  //    «компани» болж БНбД 11-03-02-ийн бүх заалтыг хаадаг (insufficient_evidence), латинд 3.2 (ажлын зураг) толгойд
  //    гардаг байв.  Энэ асуултад ердийн зангууг орлоно.
  const foreignSubject = foreignOrgExpansion(q.raw).length > 0;
  const gateTrace: { chunkId: string; overlap: number; kept: boolean }[] = [];
  const relevant = fused.filter((f) => {
    if (!loaded.has(f.chunkId)) return false;
    // ⚠️ Бүлгийн гарчгийн хөл (`section`) нь гарчиг дээрээ асуултын ≥2 ТУСГАЙ (корпуст түгээмэл биш) үгтэй
    //    таарсан бүлгийн хэсэг — тэр таарц нь өөрөө хамаарлын нотолгоо (биед нь «захиалагч», «үүрэг» үг
    //    байдаггүй тул FTS-ийн давхцлын босгонд ХЭЗЭЭ Ч хүрэхгүй, HL03).  Бүтэцтэй/alias хөлтэй адил чөлөөтэй.
    if (f.legs.some((l) => l.leg !== 'fts' && l.leg !== 'vector')) {
      gateTrace.push({ chunkId: f.chunkId, overlap: -1, kept: true });
      return true;
    }
    // ⚠️ ВЕКТОР ХӨЛ ХААЛГАНААС ЧӨЛӨӨТЭЙ БИШ.  «Вектор + FTS хоёулаа олсон
    //    бол хагас босго» гэсэн сулруулалтыг хэмжсэн (2026-09-10): NO_MATCH
    //    recall 69% → 54% унасан.  Утгын ойролцоо тааралт ч үгийн давхцалыг
    //    орлохгүй — бүх хөлд ижил босго.
    const c = loaded.get(f.chunkId) as ChunkRow;
    /**
     * ⚠️ ХАЙЛТЫН МӨРИЙГ Ч ТУЛГАНА, зөвхөн `text_mn`-ийг биш (2026-09-10).
     *    УББ 12-204-01-ийн 35 англи тестийн 26 нь FTS-д ЭХНИЙ байранд олдоод
     *    хаалганд унаж байв (`no_content_overlap`): хаалга монгол бичвэртэй л
     *    тулгадаг, англи асуултын үг нь `search_text`-ийн `text_en`/галигт л
     *    байдаг.  УББ 12-01-01-ийн англи 89% нь alias-ын гүүрээр давсан
     *    (alias → монгол үг → text_mn) — alias цөөн багцад тэр гүүр байхгүй.
     *    `search_text` нь мөн л тэр хэсгийн агуулга (галиг, англи орчуулга,
     *    бүлгийн нэр) — хамаарлын нотолгоо хэвээр; корпусын түгээмэл үг
     *    (`common`) аль хэдийн хасагдсан тул хаалга суларсангүй (NO_MATCH
     *    хэмжигдэнэ).
     */
    const ov = Math.max(
      contentOverlap(q, c.text_mn, aliasTerms, common, exclude),
      contentOverlap(q, c.search_text, aliasTerms, common, exclude),
    );
    // ⚠️ Фокус үг (асуусан хэмжигдэхүүн) хэсэгт байх ёстой — сэдэв ойролцоо атлаа
    //    хариулт агуулаагүй хэсгийг хаана (GOLD-B09).  Alias-ын аль нэг нь ч болно.
    const focused = focus.length === 0 || hasFocus(c.text_mn, focusAll) || hasFocus(c.search_text, focusAll) || hasFocus(c.title_mn ?? '', focusAll);
    const subject = rare.length === 0 || hasFocus(c.text_mn, rare) || hasFocus(c.search_text, rare);
    // Зангуу зөвхөн ХАМГИЙН БАГА давхцалтай (яг босго дээрх) хэсэгт — давхцал илүү хэсэг сэдвээ
    //    аль хэдийн нотолсон; бүх хэсэгт шаардвал хэлбэрийн зөрүү (ачаалал/ачааллын) 50 тест унагана (хэмжсэн).
    const anchored = foreignSubject
      ? hasAnchor(c.text_mn, 'gadadin') || hasAnchor(c.search_text, 'gadadin')
      : ov > need || anchor.every((t) => hasAnchor(c.text_mn, t) || hasAnchor(c.search_text, t) || hasAnchor(c.title_mn ?? '', t));
    const kept = ov >= need && focused && subject && anchored;
    gateTrace.push({ chunkId: f.chunkId, overlap: focused ? ov : -3, kept });
    return kept;
  });
  const diag = (status: string, selected: string[], ruleId: string | null, reason: string | null): RetrievalDiagnostics | undefined =>
    !opts.debug
      ? undefined
      : {
          normalized_query: q.normalized,
          folded_query: q.folded,
          script: q.script,
          tokens: q.tokens,
          content_tokens: contentTokens(q, exclude),
          common_terms: [...common],
          aliases: aliasTerms,
          overlap_required: need,
          mode,
          legs: Object.fromEntries(
            legs.map((leg, i) => [
              leg[0]?.leg ?? `leg${i}`,
              leg.slice(0, 10).map((c) => ({ chunk_id: c.chunkId, rank: c.rank, score: c.rawScore })),
            ]),
          ),
          fused: fused.slice(0, 15).map((f) => {
            const g = gateTrace.find((x) => x.chunkId === f.chunkId);
            return { chunk_id: f.chunkId, score: Math.round(f.score * 1e4) / 1e4, legs: f.legs.map((l) => `${l.leg}#${l.rank}`), overlap: g?.overlap ?? -2, kept: g?.kept ?? false };
          }),
          selected,
          rule_id: ruleId,
          status,
          no_match_reason: reason,
        };
  // Төрлийн эрэмбэ (`cue` дээр тооцсон) — зөвхөн толгой баримт доторх эрэмбэ; хаалга, баримт, шийдвэр хөндөгдөхгүй.
  // Эрхийн асуултад асуусан ҮЙЛДЛИЙГ («зогсоож») олгодог заалт тэр бүлэг дотроо түрүүлнэ (`actionPrefix`).
  const action = cue.has('right') ? actionPrefix(q.raw) : null;
  const rareScore = rareHitScorer(q, freq, exclude);
  const kindScore = (c: ChunkRow): number => rareScore(c) + (action !== null && ` ${foldText(c.text_mn)} `.includes(` ${action}`) ? 10 : 0);
  const visible = cue.size === 0 ? relevant : preferRuleKinds(db, loaded, relevant, cue, kindScore);
  if (visible.length === 0) {
    return {
      ...emptyAnswer(q, requested),
      note_mn: fused.some((f) => loaded.has(f.chunkId))
        ? 'Асуултын гол үгс баталгаажсан эх сурвалжид олдсонгүй.'
        : 'Таны эрхэд нээлттэй баталгаажсан эх сурвалж олдсонгүй.',
      no_match_reason: fused.some((f) => loaded.has(f.chunkId)) ? 'no_content_overlap' : 'no_visible_chunk',
      diagnostics: diag('insufficient_evidence', [], null, fused.some((f) => loaded.has(f.chunkId)) ? 'no_content_overlap' : 'no_visible_chunk'),
    };
  }

  const evidence: EvidenceChunk[] = visible.slice(0, evidenceLimit).map((f) => toEvidence(loaded.get(f.chunkId) as ChunkRow, f.score));

  // ── Дүрэм сонголт ────────────────────────────────────────────────
  // ⚠️ ХАМГИЙН ДЭЭД БАТАЛГААЖСАН дүрмийг сонгоно.  Баталгаажаагүй мөр
  //    дээгүүр байвал түүнийг АЛГАСАХГҮЙ — эхлээд түүнийг барьж, «энэ
  //    мөр хүний хяналт хүлээж байна» гэж ил хэлэх нь чимээгүй өөр мөр
  //    рүү шилжихээс АЮУЛГҮЙ (хэрэглэгч өөр заалтын хариу авчихна).
  let rule: NormRule | null = null;
  let ruleHit: FusedHit | null = null;
  // ⚠️ ДҮРЭМ ЗӨВХӨН ТОЛГОЙ ХЭСГИЙН БАРИМТААС (2026-09-16).  БНбД 31-17-10 нь ДҮРЭМГҮЙ
  //    хэсгүүдтэй (текст давхаргаас автоматаар задалсан; тоон мөр нь гүйцэтгэгдэхгүй тул
  //    `ai_rules`-д ороогүй) орж ирэхэд энэ гогцоо эхний хит түүнийх атал ӨӨР баримтын
  //    (БНбД 21-04-05-ын хүснэгтийн мөр, 11-08-23-ын 11.5.7 …) дүрмийг олж эшлэлийн толгойг ТЭР
  //    баримт болгож байв — 4.6-ийн асуултад «БНбД 11-08-23, заалт 11.5.7» (хэмжсэн, 36 тестийн
  //    28-д).  Дүрэмгүй баримт бүр (L1/L2 шингээлт) ижил унана.  Одоо толгой хэсгийн баримт
  //    ДОТОРХ дүрмийг л хайна (гүнд нь өмнөх шигээ — нөхцөлийн хөл эхний 25-ыг дахин эрэмбэлдэг);
  //    өөр баримтын дүрэм толгойг ХЭЗЭЭ Ч сольдоггүй.  Бүтэн корпус дээр хэмжсэн: Recall@5 ба
  //    дүрмийн таарц ЯГ хэвээр (878/972, алтан 97/111), эшлэлийн таарц 92.0 → 92.6 %.
  const topDoc = (loaded.get(visible[0]!.chunkId) as ChunkRow).doc_id;
  // ⚠️ ТОМЬЁО ТОЛГОЙД БАЙВАЛ ТЭР ӨӨРӨӨ ХАРИУЛТ (2026-09-23).  Томьёоны хэсэгт дүрэм ХЭЗЭЭ Ч холбогддоггүй
  //    (корпус дээр 0), тиймээс доорх гогцоо жагсаалтын ГҮНЭЭС өөр заалтын дүрэм олж эшлэлийн толгойг
  //    солидог байв: «…Томьёо: V_{1T}=qT» → 4.8-ын томьёо биш 4.2-ын хавхлагын заалт, х.5 (хүлээгдэж буй х.9).
  //    Хайлтын нэр дэвшигч өөрчлөгдөхөд (үгийн язгуурын хувилбар) энэ нь БД 21-101-12-ын томьёоны 4 тестийг
  //    хоёр тийш нь хөдөлгөсөн — дүрэм нь томьёоны асуултад хамаагүй байсан тул тогтворгүй байсан юм.
  const formulaHead = (loaded.get(visible[0]!.chunkId) as ChunkRow).kind === 'formula';
  for (const f of visible) {
    if (formulaHead) break;
    if ((loaded.get(f.chunkId) as ChunkRow).doc_id !== topDoc) continue;
    const candidate = loadRuleForChunk(db, f.chunkId, ctx, q.folded);
    if (candidate !== null) {
      rule = candidate;
      ruleHit = f;
      break;
    }
  }

  let decision: RuleDecision | null = null;
  if (rule !== null) decision = evaluateRule(rule, ctx);

  // ── АХ ДҮҮ ДЭД МӨР: тоон оролт нь эхний мөрийн нөхцөлд биелээгүй бол ижил дугаартай дэд мөр ──
  // ⚠️ (хэмжсэн 2026-09-18) «Архивт 200 мянган нэгж бол?» → эхний хит нь «…500 мянган нэгж ба түүнээс их»
  //    (R27.1): GUAT not_required — ХУУДУУ, учир нь оролт мөрийн нөхцөлд огт биелээгүй; яг доорх дэд мөр
  //    R27.2 («500 мянгаас бага» → ГМДХ шаардлагатай) л хариулт.  Хатуу хязгаар (голден дээр хэмжсэн:
  //    сул хувилбар 21-04-05-ын дүрмийн таарцыг 73.5 → 68.8 % унагав):
  //      · зөвхөн ТООН оролт үнэлэгдсэн үед (`inputs_used` хоосон биш);
  //      · зөвхөн ИЖИЛ ДУГААРТАЙ дэд мөр («27.1» ↔ «27.2»), өөр объект БИШ;
  //      · оролт нь эхний мөрийн ӨӨРИЙН босго утгатай тэнцүү бол ШИЛЖИХГҮЙ («28 м-ээс дээш орон сууц»
  //        гэсэн асуулт нь мөрийг НЭРЛЭЖ байна, утга өгөөгүй — тэр мөр л хариулт);
  //      · дутуу оролттой (missing) бол хөндөхгүй — uncertain хэвээр.
  //    «Таамагласан утга дүрэм СОНГОХГҮЙ» зарчим хэвээр: шинэ нэр дэвшигч хайхгүй, олдсон дэд мөрүүдийн
  //    дундаас нөхцөл нь биелсэн нэгийг л дээгүүрт тавина.
  if (rule !== null && decision !== null && decision.status === 'evaluated' && rule.table_no !== null && rule.row_no !== null && rule.row_no.includes('.')) {
    const positive = (d: RuleDecision) => Object.values(d.outcomes).some((o) => o.state === 'required');
    const anyMissing = (d: RuleDecision) => Object.values(d.outcomes).some((o) => o.state === 'missing');
    const usedValues = Object.values(decision.inputs_used).filter((v): v is number => typeof v === 'number');
    const ownThresholds = rule.conditions.map((c) => c.cond.value).filter((v): v is number => typeof v === 'number');
    const namesTheRow = usedValues.some((v) => ownThresholds.includes(v));
    if (!positive(decision) && !anyMissing(decision) && usedValues.length > 0 && !namesTheRow) {
      const base = rule.row_no.split('.')[0];
      for (const f of visible) {
        if (f.chunkId === ruleHit?.chunkId) continue;
        const row = loaded.get(f.chunkId) as ChunkRow;
        if (row.doc_id !== topDoc || row.table_no !== rule.table_no || !row.row_no || row.row_no.split('.')[0] !== base) continue;
        const sib = loadRuleForChunk(db, f.chunkId, ctx, q.folded);
        if (sib === null || sib.table_no !== rule.table_no) continue;
        const d2 = evaluateRule(sib, ctx);
        if (d2.status === 'evaluated' && positive(d2) && !anyMissing(d2)) {
          rule = sib;
          ruleHit = f;
          decision = d2;
          break;
        }
      }
    }
  }

  const head = loaded.get((ruleHit ?? visible[0]!).chunkId) as ChunkRow;
  const headIdentity = datasetIdentityOf(head);
  const citation = buildCitation({
    dataset_sha256: headIdentity.sha256,
    dataset_version: headIdentity.version,
    dataset_id: headIdentity.id,
    doc_id: head.doc_id,
    code: head.code,
    title_mn: head.title_mn,
    effective_status: head.effective_status,
    table_no: head.table_no,
    row_no: head.row_no,
    clause_no: head.clause_no,
    page: head.page,
    section_path: head.section_path,
    source_url: sourceUrlOf(head),
  });

  // ── Төлөв ────────────────────────────────────────────────────────
  let status: AnswerStatus;
  let note: string;

  if (decision === null) {
    status = 'supported';
    note = 'Холбогдох заалт олдсон боловч тоон нөхцөл бүхий дүрэм үнэлэгдээгүй.';
  } else if (decision.status === 'no_conditions') {
    // ⚠️ ТООН НӨХЦӨЛГҮЙ ДҮРЭМ НЬ ДУТУУ ДҮРЭМ БИШ.  УББ 12-01-01-ийн 33
    //    үүрэг, 5 эрх, 1 хариуцлагын заалтад босго БАЙХГҮЙ — тэд «захиалагч
    //    юу хийх ёстой вэ» гэсэн асуултын БҮРЭН хариу.  Тэднийг
    //    `uncertain` гэж тэмдэглэх нь зөв хариуг эргэлзээтэй мэт харуулна.
    //    Эшлэлтэй, баталгаажсан эх сурвалж = `supported`.
    status = 'supported';
    note =
      rule?.rule_kind === 'obligation'
        ? 'Эх сурвалжид заасан үүрэг.  Тоон босго байхгүй тул тооцоолол хийгээгүй.'
        : // ⚠️ ШААРДЛАГА нь ҮҮРЭГ БИШ.  «Аргачилсан зааврын зорилго
          //    оршино» (1.1) гэсэн заалтыг «үүрэг» гэж нэрлэвэл хоолой
          //    хэн нэгэнд байхгүй үүрэг ногдуулна.
          rule?.rule_kind === 'requirement'
          ? 'Эх сурвалжид заасан шаардлага.  Тоон босго байхгүй тул тооцоолол хийгээгүй.'
          : rule?.rule_kind === 'right'
            ? 'Эх сурвалжид заасан эрх.'
            : rule?.rule_kind === 'responsibility'
              ? 'Эх сурвалжид заасан хариуцлага.'
              : 'Эх сурвалжийн заалт.  Тоон нөхцөл байхгүй.';
  } else if (decision.status === 'blocked_unverified') {
    // ⚠️⚠️ ЭНЭ БОЛ ЭНЭ ФАЙЛЫН ХАМГИЙН ЧУХАЛ САЛАА.  Баталгаажаагүй дүрэм
    //     нь ХЭЗЭЭ Ч `verified` болохгүй.  `norm-golden.mjs` үүнийг
    //     «leakage = 0» гэж хэмжинэ; тэр тоо 0-ээс өөр болвол
    //     хэрэгжүүлэлт бус, БОДЛОГО эвдэрсэн гэсэн үг.
    status = 'uncertain';
    note =
      'Энэ мөрийн эх бичвэр тодорхойгүй тул хүний хяналт хүлээж байна.  ' +
      'Эх сурвалжийг үзэж, мэргэжлийн шалгалтад шилжүүлнэ үү.';
  } else if (decision.status === 'missing_context') {
    status = 'uncertain';
    note = `Шийдвэр гаргахад дараах нөхцөл дутуу байна: ${decision.missing_context.join(', ')}.`;
  } else if (Object.values(decision.outcomes).some((o) => o.state === 'external_norm')) {
    status = 'uncertain';
    note = 'Энэ объектын шаардлагыг өөр нормативт баримт тогтоодог тул эндээс тоон хариу гарахгүй.';
  } else if (!isCitable(citation)) {
    // ⚠️ Эшлэлгүй норматив хариу нь МЭРГЭЖЛИЙН БАРИМТАД ХҮЛЭЭН
    //    ЗӨВШӨӨРӨГДӨХГҮЙ.  Дүрэм зөв ажилласан ч хаяггүй бол доошлуулна.
    status = 'supported';
    note = 'Дүрэм үнэлэгдсэн боловч эх сурвалжийн хаяг бүрэн бус байна.';
  } else {
    status = 'verified';
    note = 'Баталгаажсан эх сурвалжийн мөрөөр детерминистээр тооцов.';
  }

  const decisions = decision === null ? {} : decisionFlags(decision);

  // §9: нэрлэсэн баримт санд байхгүй ч санд байгаа баримт түүнийг ил лавласан
  // (солигдсон / хуучин код) — ЯАГААД өөр баримтаас хариулсныг хэлнэ.
  if (requested.relation === 'superseded_by' && requested.relatedCode !== null) {
    note = `Нэрлэсэн ${requested.code} нь ${requested.relatedCode}-аар солигдсон тул түүнээс хариулав. ${note}`;
  } else if (requested.relation === 'legacy_code_of' && requested.relatedCode !== null) {
    note = `${requested.code} нь ${requested.relatedCode}-ын хуучин код тул түүнээс хариулав. ${note}`;
  }

  return {
    query: q,
    status,
    decisions,
    // ⚠️ ХОЦРОГДСОН ТАЛБАР, ЗОРИУД ХАДГАЛСАН.  `/norm` гарц нь аль хэдийн
    //    `decision: {GUAT, GMDH}` буцааж эхэлсэн ба гадны дуудагч түүнд
    //    найдаж болно.  Гал түймрийн баримтад утга нь өмнөхтэй ЯГ ижил;
    //    УББ зэрэг өөр баримтад хоёулаа `null` — «энэ баримтад ГУАТ/ГМДХ
    //    гэсэн ойлголт байхгүй» гэсэн ҮНЭН утга.
    decision: {
      GUAT: decisions.GUAT ?? null,
      GMDH: decisions.GMDH ?? null,
    },
    rule_id: rule?.rule_id ?? null,
    rule_kind: rule?.rule_kind ?? null,
    rule_object_mn: rule?.object_mn ?? null,
    rule_actor: rule?.actor ?? null,
    inputs_used: decision?.inputs_used ?? {},
    missing_context: decision?.missing_context ?? [],
    citation,
    evidence,
    legs: (ruleHit ?? visible[0] ?? null)?.legs ?? null,
    note_mn: note,
    named_document: requested.code === null && requested.docIds.length === 0 ? null : requested,
    diagnostics: diag(status, evidence.map((e) => e.chunk_id), rule?.rule_id ?? null, null),
  };
}

/**
 * ХОВОР АГУУЛГЫН ҮГИЙН ОНОО (2026-09-23) — `preferRuleKinds`-ийн ТОХИРСОН бүлэг доторх эрэмбэ.
 *
 * ⚠️ ЯАГААД.  Хүний ярианы хэлбэртэй асуултад («даамал барилгын ажлыг зогсоож чадах уу?») BM25 нь
 *    нийтлэг үгийг олон удаа агуулсан урт заалтыг гол ховор үйл үгийг («зогсоож») агуулсан заалтаас
 *    дээгүүр тавьдаг.  Корпусын ≤2%-д байдаг агуулгын үгсийн хэдийг нь (язгуурын хувилбартай) хэсэг
 *    агуулж байгааг тоолно.
 * ⚠️ ЗӨВХӨН ТӨРЛИЙН БҮЛЭГ ДОТОР — бүх асуултад хэрэглэхэд дүрмийн таарц 88.3 → 83.4% унасан (хэмжсэн:
 *    хүснэгтийн код, англи асуултын толгой солигдсон).
 */
const RARE_DF = 0.02;
function rareHitScorer(q: NormQuery, freq: ReadonlyMap<string, number>, exclude: ReadonlySet<string>): (c: ChunkRow) => number {
  const rare = contentTokens(q, exclude).filter((t) => {
    if (/^\d/.test(t) || t.length < 4) return false;
    const r = freq.get(t);
    return r !== undefined && r > 0 && r <= RARE_DF;
  });
  // ⚠️ Язгуурын хувилбар ЭНД ОРОХГҮЙ: «ажилласан» → «ajila» нь «ажиллагааны»-д таарч бүлгийн бүх
  //    заалт ижил оноо авч байв (хэмжсэн, HL04).  Хувилбар нь зөвхөн хаалганд (босго) хэрэгтэй.
  // Бүлгийн ГАРЧГИЙГ ч тооцно — жагсаалтын заалт сэдвээ гарчгаас авдаг («Хоёр. Захиалагчийн үүрэг»-ийн
  //    заалтын биед «захиалагч» байхгүй; 1-р бүлгийн ерөнхий заалтууд түүнийг агуулдаг тул тэд түрүүлж байв, HL03).
  return (c: ChunkRow): number => {
    if (rare.length === 0) return 0;
    const hay = ` ${foldText(c.text_mn)} ${foldText(c.search_text)} ${foldText(c.section_path ?? '')} `;
    return rare.filter((t) => hay.includes(` ${t.slice(0, Math.max(4, t.length - 2))}`)).length;
  };
}

/**
 * АСУУЛТЫН ТӨРӨЛД ТОХИРОХ ЗААЛТЫГ УРАГШЛУУЛНА (2026-09-23).
 *
 * ⚠️ ХЯЗГААР: зөвхөн эхний `PREFER_WINDOW` хамааралтай хэсэг, зөвхөн ТОЛГОЙ БАРИМТЫН хэсгүүд.  Өөр
 *    баримтын заалтыг төрлөөр нь дээш гаргавал толгой баримт солигдож эшлэл өөр норм руу үсэрнэ.
 *    Тогтвортой хуваалт — тохирсон ба тохироогүй бүлэг бүр ӨӨРИЙН эрэмбээ хадгална.
 */
const PREFER_WINDOW = 25;
function preferRuleKinds(
  db: DatabaseSync,
  loaded: ReadonlyMap<string, ChunkRow>,
  hits: readonly FusedHit[],
  cue: ReadonlySet<CuedRuleKind>,
  rareHits: (c: ChunkRow) => number,
): FusedHit[] {
  if (hits.length < 2) return [...hits];
  // ⚠️ ИЛ ХАЯГ (заалт/хүснэгт нэрлэсэн, бүтэцтэй хөл) бол ХӨНДӨХГҮЙ — хэрэглэгчийн заасан мөр толгой хэвээр.
  if (hits.slice(0, PREFER_WINDOW).some((h) => h.legs.some((l) => l.leg === 'structured'))) return [...hits];
  const topDoc = loaded.get(hits[0]!.chunkId)?.doc_id;
  const window = hits.slice(0, PREFER_WINDOW);
  const ids = window.map((h) => h.chunkId);
  const rows = db
    .prepare(`SELECT chunk_id, rule_kind FROM ai_rules WHERE chunk_id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as Array<{ chunk_id: string; rule_kind: string }>;
  const match = new Set(rows.filter((r) => cue.has(r.rule_kind as CuedRuleKind)).map((r) => r.chunk_id));
  if (match.size === 0) return [...hits];
  const first: { h: FusedHit; i: number; s: number }[] = [];
  const rest: FusedHit[] = [];
  window.forEach((h, i) => {
    const row = loaded.get(h.chunkId);
    if (match.has(h.chunkId) && row !== undefined && row.doc_id === topDoc) first.push({ h, i, s: rareHits(row) });
    else rest.push(h);
  });
  // Тохирсон бүлэг дотор: асуултын ховор үгийг ОЛОН агуулсан нь эхэнд, тэнцвэл хуучин эрэмбээр.
  first.sort((a, b) => b.s - a.s || a.i - b.i);
  return [...first.map((x) => x.h), ...rest, ...hits.slice(PREFER_WINDOW)];
}

function docOfChunk(db: DatabaseSync, chunkId: string): string[] {
  const r = db.prepare('SELECT doc_id FROM ai_chunks WHERE chunk_id = ?').get(chunkId) as { doc_id: string } | undefined;
  return r === undefined ? [] : [r.doc_id];
}

/* ── Туслах: хоосон хариу, хэсэг → нотолгоо, багцын таних тэмдэг ────── */

function emptyAnswer(q: NormQuery, requested: RequestedDocument): NormativeAnswer {
  return {
    query: q,
    status: 'insufficient_evidence',
    decisions: {},
    decision: { GUAT: null, GMDH: null },
    rule_id: null,
    rule_kind: null,
    rule_object_mn: null,
    rule_actor: null,
    inputs_used: {},
    missing_context: [],
    citation: null,
    evidence: [],
    legs: null,
    note_mn: 'Баталгаажсан эх сурвалжаас тохирох заалт олдсонгүй.',
    no_match_reason: 'no_candidates',
    named_document: requested.code === null && requested.docIds.length === 0 ? null : requested,
  };
}

function toEvidence(c: ChunkRow, score: number): EvidenceChunk {
  return {
    chunk_id: c.chunk_id,
    doc_id: c.doc_id,
    code: c.code,
    kind: c.kind,
    text_mn: c.text_mn,
    page: c.page,
    table_no: c.table_no,
    row_no: c.row_no,
    clause_no: c.clause_no,
    verification_status: c.verification_status,
    score,
  };
}

/** `ai_documents.metadata_json.dataset_identity` — Amendment A-ийн тулгалтын түлхүүр. */
export function datasetIdentityOf(row: { doc_metadata_json: string }): { sha256: string | null; version: string | null; id: string | null } {
  try {
    const m = JSON.parse(row.doc_metadata_json) as Record<string, unknown>;
    const ident = typeof m.dataset_identity === 'object' && m.dataset_identity !== null ? (m.dataset_identity as Record<string, unknown>) : {};
    return {
      sha256: typeof ident.sha256 === 'string' ? ident.sha256 : null,
      version: typeof m.dataset_version === 'string' ? m.dataset_version : null,
      id: typeof m.dataset_id === 'string' ? m.dataset_id : null,
    };
  } catch {
    return { sha256: null, version: null, id: null };
  }
}
