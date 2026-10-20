/**
 * MGL AI · НОРМЫН УХААН — нотолгооны төлөв, хэрэглэгдэх байдал, мэдэгдлийн бүртгэл, ТУСТАЙ БОЛОВ ҮРГЭЛЖ ЗӨВ
 * хариулт (NORM-INTEL v3, 2026-10-04).
 *
 * Дараалал (`/context` → `buildNormIntel`):
 *   асуулт → дэд төрөл → (засаглалын зарчим | нотолгооны төлөв) → хэрэглэгдэх байдал → мэдэгдлийн бүртгэл + эх сурвалж
 *   → [шаардлагатай бол] ДЕТЕРМИНИСТ хариулт → гэрээний `normIntel` блок.
 *
 * ⚠️ ЗАГВАР ЭХ СУРВАЛЖ БИШ.  Нотолгоо БАЙХГҮЙ, хайлт УНАСАН, хүчин төгөлдөр байдал тодорхойгүй, оролт дутуу үед
 *    хариултыг СЕРВЕР бичнэ (`templateOnly`): ямар ч тоо, заалт зохиогдох боломжгүй, хурдан (загварыг оролдохгүй),
 *    ГЭХДЭЭ ҮРГЭЛЖ ТУСТАЙ — «Нотолгоо хүрэлцэхгүй» гэж зөвхөн татгалзахгүй: ерөнхий ойлголт (норм биш гэж ил),
 *    ямар оролт дутуу, дараагийн алхам.
 *
 * ⚠️ ХЭЗЭЭ АСАХГҮЙ (одоо байгаа зам хэвээр): олон даалгавар, каталог, L1 баримт олох, нэрлэсэн заалт/баримт санд алга,
 *    хувилбарын зөрүү, детерминист хөдөлгүүрийн (TrustedNormResult) хариулт — тэдэнд зөвхөн `normIntel` блок НЭМЭГДЭНЭ.
 *
 * ЦЭВЭР ФУНКЦ — `norm/intelligence.test.ts`.
 */
import {
  NORM_INTEL_VERSION,
  USABLE_CURRENTNESS,
  normalizeClaimUnit,
  renderSourceBlock,
  type ApplicabilityStatus,
  type ClaimOperator,
  type NormClaim,
  type NormCurrentnessState,
  type NormEvidenceState,
  type NormIntelBlock,
  type NormSource,
} from '@mgl/mglai-common/normIntel';
import type { LocalNormAnswer } from '../localNorm';
import { currentnessLabel, currentnessOf, type Currentness } from '../currentness';
import type { TrustedContract } from '../trustedFacts';
import { canon } from './state';
import type { TrustedNormResult } from './types';
import { classifyNormQuestion, type NormQuestionClass } from './questionKind';
import { approvedTerminology, terminologyFor } from './terminology';
import { evaluateApplicability, extractProvidedInputs, inputsFromRuleMissing, type ApplicabilityResult } from './applicability';
import { GENERAL_LABEL, GOVERNANCE, INPUT_LABEL, MISSING_INTRO, NEEDS_INTRO, NEXT_STEP, guidanceFor, type InputKey, type TopicGuidance } from './generalGuidance';

type Lang = 'mn-Cyrl' | 'en';

export interface NormIntelInput {
  question: string;
  lang: Lang;
  intent: string;
  taskCount: number;
  catalogAsked: boolean;
  discoveryActive: boolean;
  smallTalk: boolean;
  trustedNorm: TrustedNormResult | null;
  localNorm: LocalNormAnswer | null;
  useLocalNorm: boolean;
  clauseAbsent: boolean;
  subjectMissing: boolean;
  driftMismatch: boolean;
  retrievalFailed: boolean;
  /** Ярианы нормын төлөвийн оролтууд (өмнөх ээлжээс). */
  convInputs?: Record<string, unknown> | null;
}

/** Сервер бичсэн ДЕТЕРМИНИСТ хариулт — гэрээний template-ийг солино. */
export interface NormIntelOverride {
  template: string;
  requiredSentence: string | null;
  answerMode: 'refusal' | 'grounded';
  noMatch: boolean;
  trailerText: string | null;
}

export interface NormIntelBuild {
  block: NormIntelBlock;
  override: NormIntelOverride | null;
  /** Оношилгоо — UI/тест. */
  diag: { subtype: string; evidenceState: NormEvidenceState; applicability: ApplicabilityStatus; reason: string };
}

/* ================================================================== */
/*  Туслахууд                                                          */
/* ================================================================== */

function numbersInText(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(?<![\p{L}\d])(\d{1,3}(?:[  ]\d{3})+|\d+(?:[.,]\d+)?)(?![\d])/gu)) {
    const v = Number(m[1]!.replace(/[  ]/g, '').replace(',', '.'));
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

function userQuotedTokens(question: string): string[] {
  const out: string[] = [];
  for (const m of question.matchAll(/(?:БНбД|БД|MNS|МНС|УББ|BNbD|BD|UBB|СНиП|SNiP)\s*[-\s]?\s*\d{2}[-\s]\d{2,3}[-\s]\d{2}(?:[-\s]\d{2})?/giu)) out.push(m[0]);
  for (const m of question.matchAll(/(?:заалт|clause|§)\s*№?\s*(\d+(?:\.\d+)+)/giu)) out.push(m[1]!);
  for (const m of question.matchAll(/(?<![\d.])(\d+\.\d+\.\d+(?:\.\d+)?)(?![\d.])/g)) out.push(m[1]!);
  for (const m of question.matchAll(/(?:хүснэгт|table)\s*№?\s*(\d+(?:\.\d+)?)/giu)) out.push(m[1]!);
  for (const m of question.matchAll(/(?:хуудас|х\.|page|p\.)\s*(\d+)/giu)) out.push(m[1]!);
  return out;
}

function toState(c: Currentness | null | undefined): NormCurrentnessState {
  return (c ?? 'UNKNOWN') as NormCurrentnessState;
}

const STRICT_UNUSABLE = new Set<NormCurrentnessState>(['DRAFT', 'SUPERSEDED', 'HISTORICAL']);

/** Эх бичвэрээс тоон мэдэгдлийг (тоо + нэгж + харьцуулалт) ШИНЖЛЭНЭ — ЭРХ БҮХИЙ БИШ, comparator-д л ашиглана. */
const CMP_RULES: readonly { op: ClaimOperator; type: NormClaim['type']; re: RegExp }[] = [
  { op: 'gte', type: 'minimum', re: /(?:-?(?:аас|ээс)\s+(?:багагүй|доошгүй)|доод\s+тал\s+нь|дор\s+хаяж|хамгийн\s+багадаа|минимум)/iu },
  { op: 'lte', type: 'maximum', re: /(?:-?(?:аас|ээс)\s+(?:ихгүй|хэтрэхгүй)|дээд\s+тал\s+нь|хамгийн\s+ихдээ|максимум)/iu },
  { op: 'gt', type: 'numeric', re: /-?(?:аас|ээс)\s+(?:их|давсан|хэтэрсэн)(?![\p{L}])/iu },
  { op: 'lt', type: 'numeric', re: /-?(?:аас|ээс)\s+(?:бага|богино)(?![\p{L}])/iu },
];
const NUM_UNIT = /(?<![\p{L}\d.])(\d+(?:[.,]\d+)?)\s*(кг\s*\/\s*м[²2]|кПа|Па|мм|см|м[²2]|м[³3]|°\s*[CС]|%|хувь|минут|секунд|давхар|хоног|м(?![\p{L}]))?/giu;

export function claimsFromClauseText(text: string, sourceIndex: number, authority: 'verified' | 'candidate', applicability: ApplicabilityStatus, idPrefix: string): NormClaim[] {
  const out: NormClaim[] = [];
  const sentences = text.split(/(?<=[^\d][.;!?])\s+|\n+/u).map((s) => s.trim()).filter((s) => s.length > 0);
  let n = 0;
  for (const s of sentences) {
    const masked = s.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ').replace(/\b\d{2}-\d{2,3}-\d{2}\b/g, ' ').replace(/(?:заалт|хүснэгт|хуудас|х\.)\s*\d+(?:\.\d+)*/giu, ' ').replace(/\b\d+(?:\.\d+){2,}\b/g, ' ');
    for (const m of masked.matchAll(NUM_UNIT)) {
      const v = Number(m[1]!.replace(',', '.'));
      if (!Number.isFinite(v)) continue;
      const at = m.index ?? 0;
      // Жагсаалтын шошго («1.», «2)») — claim БИШ.
      if (at === 0 && /^[.)]/.test(masked.slice(m[1]!.length, m[1]!.length + 1))) continue;
      const unit = normalizeClaimUnit(m[2] ?? null);
      // Харьцуулалтын хэллэг энэ тоотой ХАМТ (өмнө/дараа ойрхон) байх ёстой.
      const window = masked.slice(Math.max(0, at - 22), at + m[0].length + 26);
      const near = CMP_RULES.filter((c) => c.re.test(window));
      // Нэгжгүй, харьцуулалтгүй тоо (ойр хавийн тоо) — claim БИШ.
      if (unit === null && near.length === 0) continue;
      const rule = near.length === 1 ? near[0]! : null;
      out.push({
        id: `${idPrefix}${(n += 1)}`,
        type: rule ? rule.type : 'numeric',
        subject: null,
        operator: rule ? rule.op : 'eq',
        value: v,
        valueMax: null,
        unit,
        authority,
        sourceIndex,
        applicability,
      });
      if (out.length >= 24) return out;
    }
  }
  return out;
}

/* ================================================================== */
/*  Хариултын загварууд                                                */
/* ================================================================== */

function bullets(items: readonly string[]): string {
  return items.map((x) => `• ${x}`).join('\n');
}

function conceptSection(g: readonly TopicGuidance[], q: string, lang: Lang): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const t of g.slice(0, 2)) {
    const text = lang === 'en' ? t.conceptEn : t.conceptMn;
    if (!seen.has(text)) {
      seen.add(text);
      lines.push(text);
    }
  }
  for (const d of approvedTerminology(q, lang)) lines.push(`«${d.abbr}» — ${d.definition}.`);
  return lines.length > 0 ? `${lang === 'en' ? GENERAL_LABEL.en : GENERAL_LABEL.mn}\n${lines.join('\n')}` : '';
}

function needsKeys(g: readonly TopicGuidance[]): InputKey[] {
  const out: InputKey[] = [];
  for (const t of g.slice(0, 2)) for (const k of t.needs) if (!out.includes(k)) out.push(k);
  return out.length > 0 ? out : ['building_use', 'height_levels'];
}

function needsSection(keys: readonly InputKey[], provided: ReadonlySet<InputKey>, lang: Lang, intro: { mn: string; en: string }): string {
  const missing = keys.filter((k) => !provided.has(k)).slice(0, 4);
  if (missing.length === 0) return '';
  return `${lang === 'en' ? intro.en : intro.mn}\n${bullets(missing.map((k) => (lang === 'en' ? INPUT_LABEL[k].en : INPUT_LABEL[k].mn)))}`;
}

function joinParts(parts: readonly string[]): string {
  return parts.filter((p) => p.trim().length > 0).join('\n\n');
}

/** Нотолгоо ОГТ БАЙХГҮЙ / хайлт УНАСАН / оролт дутуу / хүн шалгах — ТУСТАЙ, ЗОХИОМОЛГҮЙ хариулт. */
/**
 * Хэрэглэгч ӨӨРӨӨ тоо/код/заалт дурдсан бол (шахалт, зохиомол код, буруу нэгж) — тэднийг БАТАЛГААЖУУЛАХГҮЙ, ЗАСАХГҮЙ, давтахгүй
 * гэдгийг ИЛ хэлнэ.  Тоо, код өөрөө хариултад ДАВТАГДАХГҮЙ (validator-ийн userQuoted зөвхөн татгалзлын өгүүлбэрт зөвшөөрдөг).
 */
export function userClaimNote(question: string, lang: Lang): string {
  const code = /(?:БНбД|БД|MNS|МНС|УББ|BNbD|BD|UBB|СНиП|SNiP|ГОСТ)\s*[-\s]?\s*\d{2}[-\s.]\d{2,3}[-\s.]\d{2}(?:[-\s]\d{2})?/iu.test(question) || /(?:СНиП|SNiP|ГОСТ)\s*\d/iu.test(question);
  const clause = /(?:заалт|clause|§|хүснэгт|table|хуудас|page)\s*№?\s*\d/iu.test(question) || /(?<![\d.])\d+\.\d+\.\d+/.test(question);
  const number = /\d+(?:[.,]\d+)?\s*(?:мм|см|м(?![\p{L}])|м2|м²|кПа|Па|%|хувь|градус|минут|давхар|кг|mm|cm|m\b)/iu.test(question);
  if (!code && !clause && !number) return '';
  const bits: string[] = [];
  if (code || clause) bits.push(lang === 'en' ? 'the code, clause or page you mention' : 'таны дурдсан норм, заалт, хуудас');
  if (number) bits.push(lang === 'en' ? 'the value you mention' : 'таны дурдсан хэмжээ, тоо');
  const what = bits.join(lang === 'en' ? ' and ' : ' болон ');
  return lang === 'en'
    ? `I cannot verify ${what}, so I do not confirm it, correct it or repeat it as a requirement.`
    : `${what[0]!.toUpperCase()}${what.slice(1)} зэргийг баталгаажуулах эх сурвалж олдоогүй тул тэдгээрийг зөв, буруу гэж хэлэхгүй, шаардлага болгон давтахгүй.`;
}

export function renderStateAnswer(
  state: Exclude<NormEvidenceState, 'AUTHORITATIVE' | 'GENERAL_ONLY' | 'CURRENTNESS_UNVERIFIED'>,
  ctx: { question: string; lang: Lang; cls: NormQuestionClass; provided: ReadonlySet<InputKey>; missingKeys?: readonly InputKey[]; reviewNote?: string | null },
): { text: string; stateSentence: string } {
  const { lang, cls } = ctx;
  const claimNote = state === 'NO_VERIFIED_MATCH' ? userClaimNote(ctx.question, lang) : '';
  const g = guidanceFor(cls.topics);
  const stateSentence =
    state === 'RETRIEVAL_UNAVAILABLE' ? canon('retrieval_failed', lang) : state === 'HUMAN_REVIEW_REQUIRED' ? canon('needs_human_review', lang) : canon('no_verified_source', lang);
  const concept = conceptSection(g, ctx.question, lang);
  const next = lang === 'en' ? NEXT_STEP[state === 'MISSING_APPLICABILITY_INPUT' ? 'MISSING_APPLICABILITY_INPUT' : state].en : NEXT_STEP[state === 'MISSING_APPLICABILITY_INPUT' ? 'MISSING_APPLICABILITY_INPUT' : state].mn;

  if (state === 'MISSING_APPLICABILITY_INPUT') {
    const keys = ctx.missingKeys && ctx.missingKeys.length > 0 ? ctx.missingKeys : needsKeys(g);
    const lead = lang === 'en' ? MISSING_INTRO.en : MISSING_INTRO.mn;
    const list = bullets(keys.slice(0, 4).map((k) => (lang === 'en' ? INPUT_LABEL[k].en : INPUT_LABEL[k].mn)));
    return { stateSentence: '', text: joinParts([`${lead}\n${list}`, next, concept]) };
  }
  // «Ерөнхий ойлголт» асуулт (smoke-free stairwell гэж юу вэ?) — ойлголт ЭХЭНД, дараа нь нормыг баталгаажаагүйг ил хэлнэ.
  if (cls.subtype === 'GENERAL_NORM_CONCEPT' && concept.length > 0) {
    const needs = needsSection(needsKeys(g), ctx.provided, lang, NEEDS_INTRO);
    return { stateSentence, text: joinParts([concept, `${stateSentence} ${next}`, claimNote, needs]) };
  }
  const needs = state === 'RETRIEVAL_UNAVAILABLE' || state === 'HUMAN_REVIEW_REQUIRED' ? '' : needsSection(needsKeys(g), ctx.provided, lang, NEEDS_INTRO);
  return { stateSentence, text: joinParts([stateSentence, claimNote, concept, next, needs]) };
}

/** Хүчин төгөлдөр байдал ХАТУУ (ноорог/солигдсон/түүхэн) — тоо ГАРГАХГҮЙ, шалтгаан + дараагийн алхам. */
export function renderCurrentnessAnswer(
  ctx: { question: string; lang: Lang; cls: NormQuestionClass; code: string | null; title: string | null; currentness: Currentness; successor: string | null },
): { text: string; stateSentence: string } {
  const { lang } = ctx;
  const label = currentnessLabel(ctx.currentness, lang);
  const doc = ctx.code ? `«${ctx.code}»${ctx.title ? ` (${ctx.title})` : ''}` : lang === 'en' ? 'The matching document' : 'Холбогдох баримт';
  const stateSentence =
    lang === 'en'
      ? `${doc} relates to this question, but its status is "${label}", so it cannot be used as a current requirement.`
      : `${doc} энэ асуулттай холбогдох боловч төлөв нь «${label}» тул одоогийн шаардлага болгон ашиглах боломжгүй.`;
  const succ = ctx.successor ? (lang === 'en' ? `Replacing document: ${ctx.successor}.` : `Орлосон баримт: ${ctx.successor}.`) : '';
  const concept = conceptSection(guidanceFor(ctx.cls.topics), ctx.question, lang);
  const next = lang === 'en' ? NEXT_STEP.CURRENTNESS_UNVERIFIED.en : NEXT_STEP.CURRENTNESS_UNVERIFIED.mn;
  return { stateSentence, text: joinParts([stateSentence, succ, next, concept]) };
}

/* ================================================================== */
/*  Эх сурвалж                                                         */
/* ================================================================== */

function registryUrl(a: LocalNormAnswer | null, code: string | null): string | null {
  if (!a?.registry || !code) return null;
  const digits = /(\d{2}-\d{2,3}-\d{2})/.exec(code)?.[1] ?? code;
  const named = a.registry.named;
  if (named && named.code.includes(digits)) return named.sourceUrl ?? named.legalSourceUrl;
  const m = a.registry.topicRouter?.results.find((r) => r.code !== null && r.code.includes(digits));
  return m ? m.url : null;
}

function sourcesFromLocal(a: LocalNormAnswer): NormSource[] {
  const cur = toState(a.currentness);
  const seen = new Set<string>();
  const out: NormSource[] = [];
  a.evidence.forEach((e, idx) => {
    const code = e.code ?? a.documentCode;
    const key = `${code}|${e.clauseNo}|${e.page}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      code: code ?? null,
      titleMn: idx === 0 ? a.titleMn : null,
      clause: e.clauseNo,
      table: idx === 0 ? a.table : null,
      appendix: null,
      page: e.page ?? (idx === 0 ? a.page : null),
      currentness: cur,
      statusLabelMn: currentnessLabel(a.currentness, 'mn-Cyrl'),
      url: registryUrl(a, code ?? null),
      verification: e.verificationStatus,
    });
  });
  return out;
}

function sourcesFromTrusted(t: TrustedNormResult): NormSource[] {
  const cur = toState(t.currentness);
  return t.provenance.map((p) => ({
    code: p.documentCode,
    titleMn: null,
    clause: p.clause,
    table: p.table,
    appendix: null,
    page: p.page,
    currentness: cur,
    statusLabelMn: t.currentness ? currentnessLabel(t.currentness, 'mn-Cyrl') : null,
    url: null,
    verification: p.verificationState,
  }));
}

function claimsFromTrusted(t: TrustedNormResult, applicability: ApplicabilityStatus): NormClaim[] {
  const out: NormClaim[] = [];
  if (t.answerKind === 'calculation' && typeof t.value === 'number') {
    out.push({ id: 'tn-result', type: 'formula_result', subject: t.rule?.family ?? null, operator: 'eq', value: t.value, valueMax: null, unit: normalizeClaimUnit(t.unit), authority: 'verified', sourceIndex: 0, applicability });
  }
  const cat = t.finalCategory ?? t.initialCategory;
  if (cat) out.push({ id: 'tn-category', type: 'classification', subject: null, operator: 'eq', value: cat, valueMax: null, unit: null, authority: 'verified', sourceIndex: 0, applicability });
  for (const r of t.ranges) {
    if (r.min !== null) out.push({ id: `tn-${r.category}-min`, type: 'minimum', subject: r.category, operator: r.exclusiveMin ? 'gt' : 'gte', value: r.min, valueMax: null, unit: normalizeClaimUnit(t.unit ?? 'MJ/m2'), authority: 'verified', sourceIndex: 0, applicability });
    if (r.max !== null) out.push({ id: `tn-${r.category}-max`, type: 'maximum', subject: r.category, operator: r.exclusiveMax ? 'lt' : 'lte', value: r.max, valueMax: null, unit: normalizeClaimUnit(t.unit ?? 'MJ/m2'), authority: 'verified', sourceIndex: 0, applicability });
  }
  return out;
}

/* ================================================================== */
/*  ГОЛ ФУНКЦ                                                          */
/* ================================================================== */

export function buildNormIntel(input: NormIntelInput): NormIntelBuild | null {
  // ── Хаалга: зөвхөн ГАНЦ даалгаврын нормын асуулт; бусад зам хэвээр ──
  if (input.intent !== 'NORMATIVE' || input.taskCount > 1 || input.catalogAsked || input.discoveryActive || input.smallTalk) return null;
  const q = input.question;
  const lang = input.lang;
  const cls = classifyNormQuestion(q);
  const terminology = terminologyFor(q);
  const userNumbers = numbersInText(q);
  const userQuoted = userQuotedTokens(q);
  const provided = extractProvidedInputs([q], input.convInputs ?? null);
  const guidance = guidanceFor(cls.topics);
  const needs = needsKeys(guidance);

  const mk = (
    evidenceState: NormEvidenceState,
    over: Partial<NormIntelBlock> & { applicability?: ApplicabilityResult },
    override: NormIntelOverride | null,
    reason: string,
  ): NormIntelBuild => {
    const app = over.applicability ?? { status: 'APPLIES' as ApplicabilityStatus, considered: [], missing: [], missingKeys: [] };
    const sources = over.sources ?? [];
    const block: NormIntelBlock = {
      version: NORM_INTEL_VERSION,
      subtype: cls.subtype,
      topics: cls.topics,
      evidenceState,
      generalOnly: over.generalOnly ?? false,
      evidenceBacked: over.evidenceBacked ?? false,
      applicability: { status: app.status, considered: app.considered, missing: app.missing },
      claims: over.claims ?? [],
      sources,
      sourceBlock: evidenceState === 'AUTHORITATIVE' && sources.length > 0 ? renderSourceBlock(sources.slice(0, 1), lang) : null,
      userQuoted,
      userNumbers,
      terminology,
      forbidCompliance: over.forbidCompliance ?? true,
      stateSentence: over.stateSentence ?? null,
      mustDiscloseCurrentness: over.mustDiscloseCurrentness ?? false,
    };
    return { block, override, diag: { subtype: cls.subtype, evidenceState, applicability: app.status, reason } };
  };

  const trusted = input.trustedNorm;
  const local = input.localNorm;

  /* ── 1. ЗАСАГЛАЛЫН ЗАРЧИМ (ноорог ≠ хүчинтэй, зөрчил, ойролцоо тоо, код байгаа заалт алга) ── */
  if ((cls.governance !== null || cls.aiPolicy) && trusted === null && !local?.registry?.named) {
    const g = GOVERNANCE[cls.governance ?? 'approximate_number'];
    const text = lang === 'en' ? g.en : g.mn;
    return mk(
      'GENERAL_ONLY',
      { generalOnly: true, evidenceBacked: false, forbidCompliance: true },
      { template: text, requiredSentence: null, answerMode: 'grounded', noMatch: true, trailerText: null },
      `governance:${cls.governance ?? 'ai_policy'}`,
    );
  }

  /* ── 2. ДЕТЕРМИНИСТ ХӨДӨЛГҮҮРИЙН ҮР ДҮН (TrustedNormResult) — зөвхөн блок нэмнэ ── */
  if (trusted !== null) {
    const sources = sourcesFromTrusted(trusted);
    if (trusted.authoritative && trusted.verification === 'verified') {
      const missing = trusted.answerKind === 'insufficient_context' ? trusted.missingInputs : [];
      const app: ApplicabilityResult = missing.length > 0 ? { status: 'MISSING_CONTEXT', considered: [], missing, missingKeys: [] } : { status: 'APPLIES', considered: [], missing: [], missingKeys: [] };
      const state: NormEvidenceState = missing.length > 0 ? 'MISSING_APPLICABILITY_INPUT' : 'AUTHORITATIVE';
      return mk(
        state,
        { applicability: app, sources, claims: claimsFromTrusted(trusted, app.status), evidenceBacked: true, forbidCompliance: false, mustDiscloseCurrentness: trusted.currentness !== null && !USABLE_CURRENTNESS.has(trusted.currentness) },
        null,
        'trusted_norm:verified',
      );
    }
    const state: NormEvidenceState =
      trusted.verification === 'retrieval_failed' ? 'RETRIEVAL_UNAVAILABLE' : trusted.verification === 'superseded' || trusted.verification === 'historical' ? 'CURRENTNESS_UNVERIFIED' : trusted.verification === 'no_verified_source' || trusted.verification === 'named_document_absent' ? 'NO_VERIFIED_MATCH' : 'HUMAN_REVIEW_REQUIRED';
    return mk(state, { sources, evidenceBacked: false }, null, `trusted_norm:${trusted.verification}`);
  }

  // Одоо байгаа тусгай хариулт (заалт алга, сэдэв санд алга, хувилбар зөрсөн, нэрлэсэн баримт алга) — хөндөхгүй.
  if (input.clauseAbsent || input.subjectMissing || input.driftMismatch || local?.namedDocument?.absent === true) return null;

  /* ── 3. ЛОКАЛ НОТОЛГОО ─────────────────────────────────────────────── */
  if (local !== null && input.useLocalNorm && local.evidence.length > 0 && local.status !== 'insufficient_evidence') {
    const cur = local.currentness;
    const state0 = toState(cur);
    const sources = sourcesFromLocal(local);
    const ruleMissing = inputsFromRuleMissing(local.missingContext);
    const app = evaluateApplicability({
      needs,
      provided,
      ruleMissing,
      distinctDocuments: new Set(sources.map((s) => s.code)).size,
      documentNamed: local.namedDocument !== null,
      sourceCurrentness: sources.map((s) => s.currentness),
      requireTopicInputs: cls.subtype === 'APPLICABILITY' && local.status !== 'verified',
    });

    // 3a. ХАТУУ — ноорог / солигдсон / түүхэн: одоогийн шаардлага болгон ашиглахгүй, тоо гаргахгүй.
    if (STRICT_UNUSABLE.has(state0)) {
      const succ = local.registry?.named?.supersededBy ?? local.registry?.named?.successorDraft ?? null;
      const r = renderCurrentnessAnswer({ question: q, lang, cls, code: local.documentCode ?? local.evidence[0]?.code ?? null, title: local.titleMn, currentness: cur, successor: succ });
      return mk(
        'CURRENTNESS_UNVERIFIED',
        { sources, applicability: { ...app, status: 'CONFLICTING_SOURCES' }, evidenceBacked: false, stateSentence: r.stateSentence, mustDiscloseCurrentness: true },
        { template: r.text, requiredSentence: r.stateSentence, answerMode: 'refusal', noMatch: false, trailerText: null },
        `local:currentness:${state0}`,
      );
    }
    // 3b. Хүчин төгөлдөр байдал шалгагдаагүй (хүний хяналт/тодорхойгүй) — одоо байгаа ил тэмдэглэлтэй хариулт хэвээр, баттай шийдвэргүй.
    if (state0 === 'NEEDS_HUMAN_REVIEW' || state0 === 'UNKNOWN') {
      return mk('CURRENTNESS_UNVERIFIED', { sources, applicability: app, claims: claimsFromEvidence(local, sources, 'candidate', app.status), evidenceBacked: true, mustDiscloseCurrentness: true }, null, `local:currentness:${state0}`);
    }
    // 3c. Хайлт олсон ч баталгаатай хариулт биш (uncertain) — «хамгийн ойр заалт» хариулт хэвээр.
    if (local.status === 'uncertain') {
      const state: NormEvidenceState = local.missingContext.length > 0 || app.status === 'MISSING_CONTEXT' ? 'MISSING_APPLICABILITY_INPUT' : 'NO_VERIFIED_MATCH';
      return mk(state, { sources, applicability: app, claims: claimsFromEvidence(local, sources, 'candidate', app.status), evidenceBacked: true }, null, 'local:uncertain');
    }
    // 3d. verified | supported + хүчинтэй төлөв — эрх бүхий (хэрэглэгдэх байдлын шалгалттай)
    const state: NormEvidenceState = app.status === 'MISSING_CONTEXT' ? 'MISSING_APPLICABILITY_INPUT' : 'AUTHORITATIVE';
    let override: NormIntelOverride | null = null;
    if (state === 'MISSING_APPLICABILITY_INPUT' && cls.subtype === 'APPLICABILITY') {
      const r = renderStateAnswer('MISSING_APPLICABILITY_INPUT', { question: q, lang, cls, provided, missingKeys: app.missingKeys });
      override = { template: r.text, requiredSentence: null, answerMode: 'grounded', noMatch: false, trailerText: null };
    }
    return mk(state, { sources, applicability: app, claims: claimsFromEvidence(local, sources, state === 'AUTHORITATIVE' ? 'verified' : 'candidate', app.status), evidenceBacked: true, forbidCompliance: true, mustDiscloseCurrentness: !USABLE_CURRENTNESS.has(state0) }, override, `local:${local.status}`);
  }

  /* ── 4. НОТОЛГОО БАЙХГҮЙ / ХАЙЛТ УНАСАН ─────────────────────────────── */
  const failed = input.retrievalFailed;
  const state: Exclude<NormEvidenceState, 'AUTHORITATIVE' | 'GENERAL_ONLY' | 'CURRENTNESS_UNVERIFIED'> = failed ? 'RETRIEVAL_UNAVAILABLE' : 'NO_VERIFIED_MATCH';
  const r = renderStateAnswer(state, { question: q, lang, cls, provided });
  const app: ApplicabilityResult = { status: 'MISSING_CONTEXT', considered: [], missing: needs.filter((k) => !provided.has(k)).map((k) => INPUT_LABEL[k].mn), missingKeys: needs.filter((k) => !provided.has(k)) };
  return mk(
    state,
    { generalOnly: true, evidenceBacked: false, applicability: app, stateSentence: r.stateSentence || null },
    { template: r.text, requiredSentence: r.stateSentence || null, answerMode: 'refusal', noMatch: !failed, trailerText: null },
    failed ? 'retrieval_failed' : 'no_verified_match',
  );
}

function claimsFromEvidence(a: LocalNormAnswer, sources: readonly NormSource[], authority: 'verified' | 'candidate', applicability: ApplicabilityStatus): NormClaim[] {
  const out: NormClaim[] = [];
  a.evidence.forEach((e, i) => {
    // Нотолгоо-мөр бүр өөрийн `sources` индекстэй (давхардсан хаяг хассан тул хайна).
    const idx = Math.max(0, sources.findIndex((s) => s.code === (e.code ?? a.documentCode) && s.clause === e.clauseNo));
    out.push(...claimsFromClauseText(e.textMn, idx, authority, applicability, `e${i}-`));
  });
  return out.slice(0, 32);
}

/* ================================================================== */
/*  Гэрээнд хэрэглэх                                                   */
/* ================================================================== */

/**
 * ⚠️ Гэрээний ХАМГИЙН ГАДНАХ давхарга.  Блок нэмнэ; шаардлагатай бол детерминист хариултыг template болгож
 *    `templateOnly` тавина (загвар оролдохгүй, тоо/заалт зохиогдох боломжгүй).
 */
export function applyNormIntel(contract: TrustedContract, build: NormIntelBuild | null): TrustedContract {
  if (build === null) return contract;
  const base: TrustedContract = { ...contract, normIntel: build.block };
  const o = build.override;
  if (o === null) return { ...base, reason: `${contract.reason} · norm_intel:${build.diag.evidenceState}` };
  return {
    ...base,
    answerMode: o.answerMode,
    risk: 'high',
    allowedNumbers: [],
    allowedCategories: [],
    requiredSentence: o.requiredSentence,
    trailerText: o.trailerText,
    noMatch: o.noMatch,
    forbiddenPhrases: contract.forbiddenPhrases,
    template: o.template,
    templateOnly: true,
    reason: `${contract.reason} · norm_intel:${build.diag.evidenceState}:${build.diag.reason}`,
  };
}

/** currentnessOf-ийн дахин экспорт — тестэд. */
export { currentnessOf };
