/**
 * MGL AI · ЭЦСИЙН ХАРИУЛТЫН ШАЛГАГЧ (Trusted Fact Contract tfc-1/tfc-2 · §5–§10).
 *
 * ⚠️ tfc-2 (2026-09-11): нормын ээлжид `norm` блок — TrustedNormResult-ийн ХАТУУ
 *    инвариант (баримт / үр дүн / ангилал).  Зөрчил → өгүүлбэр засахгүй, дахин
 *    үүсгэхгүй, СЕРВЕРИЙН детерминист хариулт.  Follow-up өгүүлбэр (4.20, зай)
 *    алга бол серверийн үгээр НЭМНЭ; `maskTokens` (заалт, хүснэгт, томьёо, хуудас)
 *    тооны шалгалтаас хасагдана.
 *
 * ⚠️ ЯАГААД ХӨТӨЧ ДЭЭР ВЭ.  Үүсгэлт ажилтны PC дээр явагдана; Worker
 *    хариултыг үүсгэлтийн ДАРАА (`/messages`) л хардаг.  Харуулахаас ӨМНӨ
 *    шалгах цорын ганц цэг нь энд.  Гэрээг СЕРВЕР бичнэ (`trustedFacts.ts`),
 *    энд ЗӨВХӨН тулгана — хос тогтмол БАЙХГҮЙ.
 *
 * ⚠️ ЮУГ ШАЛГАХ ВЭ (§5), ЮУГ ШАЛГАХГҮЙ ВЭ (§6).  Зөвхөн БҮТЭЦТЭЙ баримт:
 *      A. заавал баримт дурдагдаагүй      D. зөвшөөрөгдөөгүй тоо
 *      B/C. итгэмжлэгдсэн тоо/ангилал өөр  E. заавал татгалзал алга
 *      F. заавал эшлэл алга                G/H. олдоогүй атлаа эх сурвалж эшилсэн
 *      I. бүрэн шийдвэр байхад «мэдэхгүй»  U. нэгж зөрсөн (1401 м² ≠ 1401 МДж/м²)
 *      P. хориотой хэллэг (эрхгүй атлаа «өөрчиллөө»)
 *    Байгалийн хэлний утгыг шалгах оролдлого ЭНД БАЙХГҮЙ.
 *
 * ⚠️ ХУРДАН (§35): regex + олонлог; загвар дахин дуудахгүй; <1 мс.
 *
 * ⚠️ ЗАСВАРЫН ШАТЛАЛ (§7): тоотой/хориотой ӨГҮҮЛБЭРИЙГ хасах → дутуу
 *    баримт/татгалзал/трейлерийг нэмэх → дахин шалгах.  Хасалт нь
 *    ХЭЗЭЭ Ч чимээгүй биш — `notices`-ээр ил.  Засварын дараа ч зөрчил
 *    үлдвэл дуудагч (orchestrator) ДАХИН ҮҮСГЭНЭ (нэг удаа), дараа нь
 *    серверийн детерминист `template` руу унана.
 *
 * ⚠️ ЦЭВЭР ФУНКЦ — `scripts/check-ai-validator.mjs` (гэрээний халдлагын тест).
 */

export type FactKind = 'number' | 'category' | 'status' | 'id' | 'date' | 'text';

export interface TrustedFact {
  id: string;
  kind: FactKind;
  value: string | number;
  unit?: string;
  labelMn: string;
  labelEn: string;
  authority: string;
  mustMention: boolean;
}

/**
 * НОРМЫН БЛОК (tfc-2) — `backend/src/lib/mglai/norm/contract.ts`-ийн ХОС.  TrustedNormResult-
 * оос сервер бичнэ.  ХАТУУ ИНВАРИАНТ (§13 hard invariants):
 *   · эцсийн хариултын БАРИМТ = provenance-ийн баримт (FOREIGN_CITATION)
 *   · тооцооны үр дүн = харуулсан тоо (RESULT_MISSING)
 *   · эцсийн ангилал = харуулсан ангилал (CATEGORY_MISSING / CATEGORY_CHANGED)
 * Зөрчил → загварын хариултыг ХАЯЖ серверийн детерминист `template`.  Өгүүлбэр
 * таамаглан засахгүй.
 */
export interface NormContractBlock {
  verification: string;
  authoritative: boolean;
  answerKind: string;
  document: string | null;
  documentAliases: string[];
  resultValue: number | boolean | string | null;
  resultUnit: string | null;
  initialCategory: string | null;
  finalCategory: string | null;
  /** Хариултад ЗААВАЛ байх follow-up өгүүлбэр (алга бол ДЕТЕРМИНИСТ нэмнэ). */
  requiredFollowups: { key: string; sentence: string }[];
  /** Тооны шалгалтаас ХАСАХ хаяг («4.20», «Хүснэгт 4», «томьёо 7», «х.8»). */
  maskTokens: string[];
  citationLabels: string[];
  currentnessNote: string | null;
  template: string;
}

export interface TrustedContract {
  version: 'tfc-1' | 'tfc-2';
  answerMode: 'authoritative' | 'grounded' | 'refusal' | 'free';
  risk: 'low' | 'medium' | 'high';
  facts: TrustedFact[];
  allowedNumbers: number[] | null;
  allowedCategories: string[] | null;
  requiredSentence: string | null;
  trailerText: string | null;
  requiredCitations: string[];
  noMatch: boolean;
  forbiddenPhrases: string[];
  template: string | null;
  taskIndex: number | null;
  legacyKind: string;
  reason: string;
  /** tfc-2: нормын ээлжид TrustedNormResult-ийн блок; бусад ээлжид `null`/байхгүй. */
  norm?: NormContractBlock | null;
}

export type ViolationCode =
  | 'FACT_MISSING'
  | 'NUMBER_CHANGED'
  | 'CATEGORY_CHANGED'
  | 'UNSUPPORTED_NUMBER'
  | 'REFUSAL_MISSING'
  | 'CITATION_MISSING'
  | 'FAKE_CITATION'
  | 'FALSE_UNCERTAINTY'
  | 'EMPTY_AFTER_REPAIR'
  | 'UNIT_MISMATCH'
  | 'FORBIDDEN_PHRASE'
  | 'TRAILER_MISSING'
  /** Тоолуур 0 атлаа загвар жагсаалт бичсэн («хоцорсон 0» + 5 мөр жагсаалт). */
  | 'CONTRADICTS_ZERO_COUNT'
  /** tfc-2 ХАТУУ: хариултад provenance-ийн баримтаас ӨӨР баримтын код эшилсэн. */
  | 'FOREIGN_CITATION'
  /** tfc-2 ХАТУУ: тооцооны үр дүнгийн тоо хариултад алга. */
  | 'RESULT_MISSING'
  /** tfc-2 ХАТУУ: эцсийн ангилал хариултад алга. */
  | 'CATEGORY_MISSING'
  /** tfc-2: заавал байх follow-up өгүүлбэр алга (детерминист нэмэлт). */
  | 'FOLLOWUP_MISSING';

export interface Violation {
  code: ViolationCode;
  /** Хүнд харагдах товч (монгол). */
  detail: string;
  /** Зөрчилтэй өгүүлбэр — хасалтад. */
  sentence?: string;
  /** Хасаад засагдах уу (true) эсвэл нэмэлт/дахин үүсгэлт шаардах уу. */
  removable: boolean;
  /**
   * ХАТУУ ИНВАРИАНТ (tfc-2): засвар, дахин үүсгэлт ХИЙХГҮЙ — загварын хариултыг
   * бүхэлд нь хаяж серверийн детерминист хариулт (`fallbackAnswer`).
   */
  hard?: boolean;
}

export interface ValidationResult {
  ok: boolean;
  violations: Violation[];
}

export interface EnforceOutcome {
  answer: string;
  /** Засварын ДАРААХ шалгалт — `ok=false` бол дуудагч дахин үүсгэнэ. */
  validation: ValidationResult;
  /** Засварын ӨМНӨХ шалгалт — оношилгоо. */
  before: ValidationResult;
  notices: string[];
  removedSentences: number;
  /** `model` — хэвээр; `repaired` — хасалт/нэмэлт; */
  outcome: 'model' | 'repaired';
}

/* ================================================================== */
/*  Текстийн туслахууд                                                 */
/* ================================================================== */

/**
 * ТОО-БИШ тоонууд: огноо, цаг, баримтын код (БД 21-101-12), заалт (4.2.1),
 * «заалт 4.20».  Маскалахгүй бол ЗӨВ эшлэлтэй өгүүлбэр хасагдана.
 */
const NOT_A_NUMBER = [
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b\d{1,2}:\d{2}\b/g,
  /\b\d{2}-\d{2,3}-\d{2}(?:-\d{2})?\b/g,
  /\b\d+\.\d+\.\d+\b/g,
  /(?:заалт|п\.|§|clause|хэсэг|хүснэгт|table|хуудас|х\.|p\.)\s*№?\s*\d+(?:\.\d+)*/giu,
  /\b\d+\)\s/g, // «1) 2)» дугаарлалт
  /(?:^|\n)\s*\d+\.\s/g, // «1. 2.» жагсаалтын шошго
];

// ⚠️ «1 800» ба «1,401» = мянгат (зай, эсвэл ЯГ 3 оронтой таслал), «1,5» = аравтын
//    бутархай (монгол бичлэг).  Нэг regex, нэг задлагч — хоёр газар давхардуулахгүй.
const NUMBER_RE = /(?<![\p{L}\d])(\d{1,3}(?:[ \u00A0]\d{3})+|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?)(?![\d])/gu;
function parseNumber(raw: string): number {
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(raw)) return Number(raw.replace(/,/g, ''));
  return Number(raw.replace(/[ \u00A0]/g, '').replace(',', '.'));
}

export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(NUMBER_RE)) {
    const v = parseNumber(m[1]!);
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Тооны шалгалтаас хасах — огноо/код/заалт (ерөнхий) + гэрээний `maskTokens`
 * (tfc-2: «4.20», «Хүснэгт 4», «томьёо 7», «х.8» — provenance-ийн ХАЯГ, тоо биш).
 */
function maskNonNumbers(s: string, tokens: readonly string[] = []): string {
  let c = s;
  for (const t of tokens) {
    if (t.trim().length === 0) continue;
    c = c.replace(new RegExp(escapeRe(t).replace(/\s+/g, '\\s*'), 'giu'), ' ');
  }
  for (const re of NOT_A_NUMBER) c = c.replace(re, ' ');
  return c;
}

export function splitSentences(text: string): string[] {
  // ⚠️ «1. Төсөл А» — жагсаалтын «1.» нь өгүүлбэрийн төгсгөл БИШ.
  return text
    .split(/(?<=[^\d][.!?])\s+|\n+/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Тоог харьцуулах — 8.53 ≈ 8.5 ≈ 9 (нэг орон дугуйлалт зөвшөөрнө). */
function numberAllowed(n: number, allowed: ReadonlySet<number>): boolean {
  if (allowed.has(n)) return true;
  for (const a of allowed) {
    if (Math.abs(a - n) < 1e-9) return true;
    if (Math.abs(Math.round(a * 10) / 10 - n) < 1e-9) return true;
    if (Math.abs(Math.round(a) - n) < 1e-9) return true;
  }
  return false;
}

/** Нэгжийн хэвийжүүлэлт — серверийн `normalizeUnit`-ийн ХОС (харьцуулалтад Л). */
export function normalizeUnit(raw: string): string {
  const u = raw
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/²/g, '2')
    .replace(/³/g, '3')
    .replace(/мдж|мж|mdj/g, 'mj')
    .replace(/кпа/g, 'kpa')
    .replace(/па(?![\p{L}])/gu, 'pa')
    .replace(/кв\.?м/g, 'm2')
    .replace(/куб\.?м/g, 'm3')
    .replace(/мм/g, 'mm')
    .replace(/см/g, 'cm')
    .replace(/кг/g, 'kg')
    .replace(/°c|°с|градус|град/g, 'c')
    .replace(/хоног|өдөр|days?/g, 'd')
    .replace(/хувь|percent/g, '%')
    // ⚠️ Кирилл «м» → латин «m» ХАМГИЙН СҮҮЛД — «мм», «мдж», «см» дээр аль
    //    хэдийн хөрвөсөн; ганц «м» ба «/м2» энд л үлдэнэ.
    .replace(/м/g, 'm');
  const table: Record<string, string> = {
    'mj/m2': 'MJ/m2', 'mj/m3': 'MJ/m3', mj: 'MJ', m2: 'm2', m3: 'm3', m: 'm', м: 'm', mm: 'mm', cm: 'cm', kpa: 'kPa', pa: 'Pa', kg: 'kg', c: 'C', '%': '%', d: 'd',
  };
  return table[u] ?? u;
}

/** Тооны АРД бичсэн нэгжийг олно («1401 МДж/м²» → «МДж/м²»). */
const UNIT_AFTER = /^\s*(МДж\s*\/\s*м[²2]|MJ\s*\/\s*m[²2]|мдж\s*\/\s*м[²2]|м[²2]|m[²2]|м[³3]|m[³3]|кПа|kPa|мм|mm|см|cm|°C|°С|%|хувь|хоног|days?)/u;

function unitAfter(text: string, idx: number): string | null {
  const m = UNIT_AFTER.exec(text.slice(idx));
  return m ? normalizeUnit(m[1]!) : null;
}

/** Хариултад тоо бичигдсэн газар бүр (индекс + утга). */
function numberSites(text: string): { value: number; end: number }[] {
  const out: { value: number; end: number }[] = [];
  for (const m of text.matchAll(NUMBER_RE)) {
    const v = parseNumber(m[1]!);
    if (Number.isFinite(v)) out.push({ value: v, end: (m.index ?? 0) + m[1]!.length });
  }
  return out;
}

const CATEGORY_RE = /(?<![\p{L}\d])([ВвVv])\s?([1-4])(?![\p{L}\d])/gu;
/** Өрөөний ангилал А/Б/В/Г/Д — ГАНЦ том үсэг, үгийн хэсэг биш («**А**», «А ангилал», «Б-д»). */
const ROOM_CATEGORY_RE = /(?<![\p{L}\d])([АБВГД])(?![\p{L}\d])/gu;
function categoriesIn(text: string, includeRoom = false): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(CATEGORY_RE)) out.push(`В${m[2]}`);
  if (includeRoom) for (const m of text.matchAll(ROOM_CATEGORY_RE)) out.push(m[1]!);
  return out;
}

const DOC_CODE_RE = /(?:БНбД|БД|MNS|УББ|BNbD|BD|UBB|СНиП|SNiP)\s*[-\s]?\s*\d{2}[-\s]\d{2,3}[-\s]\d{2}(?:[-\s]\d{2})?/giu;

/** Баримтын кодыг харьцуулах хэлбэр — «BD 21-101-12» ≡ «БД 21-101-12» ≡ «21-101-12». */
function foldCode(code: string): string {
  return code
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/[\s_]+/g, '')
    .replace(/бнбд/g, 'bnbd')
    .replace(/убб/g, 'ubb')
    .replace(/бд/g, 'bd')
    .replace(/снип/g, 'snip');
}

function codeDigits(code: string): string | null {
  return /(\d{2}-\d{2,3}-\d{2}(?:-\d{2})?)/.exec(code.replace(/[–—]/g, '-').replace(/\s/g, '-'))?.[1] ?? null;
}

/** Хариултын баримтын код provenance-ийн баримт мөн үү (tfc-2 хатуу инвариант). */
export function citationBelongsTo(code: string, norm: NormContractBlock): boolean {
  const own = new Set<string>();
  for (const a of [...norm.documentAliases, ...(norm.document ? [norm.document] : [])]) {
    own.add(foldCode(a));
    const d = codeDigits(a);
    if (d) own.add(d);
  }
  const f = foldCode(code);
  const d = codeDigits(code);
  return own.has(f) || (d !== null && own.has(d));
}
const UNCERTAIN_RE = /олдсонгүй|мэдэхгүй|тодорхойгүй|баталгаагүй|эх сурвалж алга|not found|unknown|cannot confirm|no verified source/iu;
const FAKE_CITE_RE = /(?:заасан|заасны|заалтаар|-д |-т |ын дагуу|ийн дагуу|according to|as stated in|стандартын|дүрмийн)/iu;

function fold(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/* ================================================================== */
/*  Хэсэг тусгаарлах (олон даалгавар)                                  */
/* ================================================================== */

function sectionOf(answer: string, taskIndex: number | null): { before: string; marker: string; body: string; after: string } {
  if (taskIndex === null) return { before: '', marker: '', body: answer, after: '' };
  const re = new RegExp(`(^|\\n)(\\s*${taskIndex}\\)\\s*)`, 'u');
  const m = re.exec(answer);
  if (!m) return { before: answer.length > 0 ? `${answer}\n\n` : '', marker: `${taskIndex}) `, body: '', after: '' };
  const markerStart = m.index + m[1]!.length;
  const start = markerStart + m[2]!.length;
  const next = new RegExp(`\\n\\s*${taskIndex + 1}\\)`, 'u').exec(answer.slice(start));
  const end = next ? start + next.index : answer.length;
  return { before: answer.slice(0, markerStart), marker: m[2]!, body: answer.slice(start, end), after: answer.slice(end) };
}

/* ================================================================== */
/*  ШАЛГАЛТ                                                            */
/* ================================================================== */

/** ⚠️ ГОЛ ФУНКЦ (1/2).  Хариултыг гэрээнд тулгана — ӨӨРЧЛӨХГҮЙ. */
/** Үгүйсгэл/болзол — «болохгүй», «биш», «үгүй», «хориотой», «бүү», «хүлээ…», «баталгаажуул…», «шаардлагатай». */
const NEGATION_RE = /болохгүй|биш|үгүй|хориотой|бүү|хүлээ|баталгаажуул|шаардлагатай|cannot|not\b|never/iu;

export function validateAnswer(answer: string, c: TrustedContract | null | undefined): ValidationResult {
  if (!c || c.answerMode === 'free') return { ok: true, violations: [] };
  const { body } = sectionOf(answer, c.taskIndex);
  const text = body;
  const v: Violation[] = [];
  const sentences = splitSentences(text);
  const norm = c.norm ?? null;
  const mask = norm?.maskTokens ?? [];
  // СЕРВЕРИЙН ӨГҮҮЛБЭР (татгалзлын канон, follow-up) — тоо/ангиллын шалгалтаас гадуур:
  // тэдгээрийг сервер өөрөө бичсэн, загварын зохиомол биш.
  const serverText = [c.requiredSentence, ...(norm?.requiredFollowups.map((f) => f.sentence) ?? [])].filter((x): x is string => typeof x === 'string' && x.length > 0);
  const isServer = (s: string): boolean => serverText.some((t) => s.includes(t) || t.includes(s));

  /* ── tfc-2 ХАТУУ ИНВАРИАНТ — эх сурвалж / үр дүн / ангилал (§13) ───── */
  if (norm !== null) {
    if (norm.document !== null) {
      // Эцсийн хариултын баримт = provenance-ийн баримт.  Өөр код → хаяна.
      for (const s of sentences) {
        if (c.requiredSentence && s.includes(c.requiredSentence)) continue;
        for (const code of s.match(DOC_CODE_RE) ?? []) {
          if (!citationBelongsTo(code, norm)) {
            v.push({ code: 'FOREIGN_CITATION', detail: `Provenance-ийн бус баримт: ${code}`, sentence: s, removable: false, hard: true });
          }
        }
      }
    }
    if (c.answerMode === 'authoritative') {
      if (typeof norm.resultValue === 'number' && !numbersIn(text).some((n) => numberAllowed(n, new Set([norm.resultValue as number])))) {
        v.push({ code: 'RESULT_MISSING', detail: `Тооцооны үр дүн ${norm.resultValue} хариултад алга`, removable: false, hard: true });
      }
      if (norm.finalCategory !== null && /^(?:В[1-4]|[АБГД])$/u.test(norm.finalCategory) && !categoriesIn(text, true).includes(norm.finalCategory)) {
        v.push({ code: 'CATEGORY_MISSING', detail: `Эцсийн ангилал ${norm.finalCategory} хариултад алга`, removable: false, hard: true });
      }
    }
    for (const f of norm.requiredFollowups) {
      if (!fold(text).includes(fold(f.sentence))) {
        v.push({ code: 'FOLLOWUP_MISSING', detail: `Нэмэлт шалгалт (${f.key}) дурдаагүй`, removable: false });
      }
    }
  }

  // E. заавал татгалзал
  if (c.requiredSentence && !text.includes(c.requiredSentence)) {
    v.push({ code: 'REFUSAL_MISSING', detail: 'Татгалзлын канон өгүүлбэр байхгүй', removable: false });
  }
  // TRAILER — трейлер бүхэл хариултад (хэсэгт биш)
  if (c.trailerText && !answer.includes(c.trailerText)) {
    v.push({ code: 'TRAILER_MISSING', detail: 'Төгсгөлийн анхааруулга байхгүй', removable: false });
  }

  // D/B. тоо — зөвшөөрөгдсөн олонлогоос гадуурх тоотой өгүүлбэр
  if (c.allowedNumbers !== null) {
    const allowed = new Set(c.allowedNumbers);
    for (const s of sentences) {
      if (isServer(s)) continue;
      const bad = numbersIn(maskNonNumbers(s, mask)).filter((n) => !numberAllowed(n, allowed));
      if (bad.length > 0) {
        const trustedNums = c.facts.filter((f) => f.kind === 'number').map((f) => Number(f.value));
        const changed = trustedNums.length > 0 && bad.some((b) => trustedNums.some((t) => Math.abs(b - t) / Math.max(1, Math.abs(t)) < 0.5));
        v.push({
          code: changed ? 'NUMBER_CHANGED' : 'UNSUPPORTED_NUMBER',
          detail: `Баталгаагүй тоо: ${bad.slice(0, 3).join(', ')}`,
          sentence: s,
          removable: true,
        });
      }
    }
  }

  // C. ангилал — гэрээнд байхгүй В1–В4
  if (c.allowedCategories !== null) {
    const allowedCats = new Set(c.allowedCategories);
    for (const s of sentences) {
      if (isServer(s)) continue;
      const cats = categoriesIn(s).filter((x) => !allowedCats.has(x));
      if (cats.length > 0) {
        // Бусад ангиллын МУЖИЙГ тайлбарлах нь зөвшөөрөгдөнө («муж В3: …» мөр
        // шийдвэрийн блокт бий) — гэхдээ зөвхөн тэр тоо зөвшөөрөгдсөн бол.
        const nums = numbersIn(maskNonNumbers(s, mask));
        const allowed = c.allowedNumbers ? new Set(c.allowedNumbers) : null;
        const numsOk = allowed === null || nums.every((n) => numberAllowed(n, allowed));
        const declares = /ангилал(?:д)?\s*(?:нь|болно|багтана|орно|юм)|is\s+(?:category|class)|→/iu.test(s) || nums.length === 0;
        if (!numsOk || (declares && c.answerMode !== 'grounded')) {
          // tfc-2: эцсийн ангилал тогтсон байхад ӨӨР ангилал ЗАРЛАХ нь хатуу зөрчил.
          const hard = norm !== null && norm.finalCategory !== null && declares;
          v.push({ code: 'CATEGORY_CHANGED', detail: `Гэрээнд байхгүй ангилал: ${cats.join(', ')}`, sentence: s, removable: !hard, hard });
        }
      }
    }
  }

  // U. нэгж — итгэмжлэгдсэн тоо ӨӨР нэгжтэй бичигдсэн
  for (const f of c.facts) {
    if (f.kind !== 'number' || !f.unit) continue;
    for (const site of numberSites(text)) {
      if (Math.abs(site.value - Number(f.value)) > 1e-9) continue;
      const u = unitAfter(text, site.end);
      if (u !== null && u !== f.unit) {
        const sent = sentences.find((s) => s.includes(String(f.value))) ?? '';
        v.push({ code: 'UNIT_MISMATCH', detail: `${f.value}: ${u} ≠ ${f.unit}`, sentence: sent, removable: true });
        break;
      }
    }
  }

  // A. заавал баримт
  // ⚠️ ОЛОН САНАА: ERP-ийн баримт нь нормын хэсэгт БИШ, нөгөө хэсэгт байна —
  //    тэднийг БҮХЭЛ хариултаас хайна; нормын баримт нь өөрийн хэсгээс.
  for (const f of c.facts) {
    if (!f.mustMention) continue;
    const scope = f.authority === 'erp_tool' ? answer : text;
    const present =
      f.kind === 'number'
        ? numbersIn(scope).some((n) => numberAllowed(n, new Set([Number(f.value)])))
        : f.kind === 'category'
          ? categoriesIn(scope, true).includes(String(f.value))
          : fold(scope).includes(fold(String(f.value)));
    if (!present) v.push({ code: 'FACT_MISSING', detail: `${f.labelMn}: ${f.value}`, removable: false });
  }

  // F. заавал эшлэл — «BD 21-101-12» / «21-101-12» гэсэн alias ч хүлээн зөвшөөрнө.
  const codesInText = (text.match(DOC_CODE_RE) ?? []).map((x) => x);
  for (const cite of c.requiredCitations) {
    const key = fold(cite).replace(/\s+/g, '');
    const digits = codeDigits(cite);
    const present =
      fold(text).replace(/\s+/g, '').includes(key) ||
      codesInText.some((x) => foldCode(x) === foldCode(cite) || (digits !== null && codeDigits(x) === digits)) ||
      (digits !== null && text.replace(/[–—]/g, '-').includes(digits));
    if (!present) {
      v.push({ code: 'CITATION_MISSING', detail: `Эх сурвалж дурдаагүй: ${cite}`, removable: false });
    }
  }

  // H. олдоогүй атлаа эх сурвалж эшилсэн
  if (c.noMatch) {
    for (const s of sentences) {
      if (c.requiredSentence && s.includes(c.requiredSentence)) continue;
      const codes = s.match(DOC_CODE_RE);
      if (codes && FAKE_CITE_RE.test(s)) {
        v.push({ code: 'FAKE_CITATION', detail: `Олдоогүй атлаа эшилсэн: ${codes[0]}`, sentence: s, removable: true });
      }
    }
  }

  // I. бүрэн шийдвэр байхад «мэдэхгүй/олдсонгүй»
  if (c.answerMode === 'authoritative' && c.facts.some((f) => f.kind === 'category' || (f.kind === 'number' && f.mustMention))) {
    for (const s of sentences) {
      if (UNCERTAIN_RE.test(s) && !/нэмэлт|дутуу|Q|H\b/u.test(s)) {
        v.push({ code: 'FALSE_UNCERTAINTY', detail: 'Шийдвэр байхад эргэлзсэн', sentence: s, removable: true });
      }
    }
  }

  // Z. тоолуур 0 атлаа жагсаалт — «Хугацаа хэтэрсэн даалгавар: 0» гээд
  //    доор нь 5 төслийг «хоцорсон» гэж жагсаах нь хэмжигдсэн зөрчил.
  //    Хасаад засагдахгүй (жагсаалт бүхэлдээ) → дахин үүсгэлт/загвар.
  const zeroCount = c.facts.find((f) => f.kind === 'number' && f.mustMention && Number(f.value) === 0);
  if (zeroCount) {
    const listItems = (text.match(/^\s*(?:[-*•]|\d+[.)])\s+\S/gmu) ?? []).length;
    if (listItems >= 2) {
      v.push({ code: 'CONTRADICTS_ZERO_COUNT', detail: `${zeroCount.labelMn}: 0 атлаа ${listItems} мөрт жагсаалт`, removable: false });
    }
  }

  // P. хориотой хэллэг
  // ⚠️ Нормын татгалзал/хүний хяналтад «шаардлага хангаж байна» нь ҮГҮЙСГЭЛТЭЙ («…гэж хэлж болохгүй»)
  //    хэлбэрээр серверийн канон өгүүлбэрт ч, зөв хариултад ч байдаг — тэдгээр нь зөрчил БИШ;
  //    зөвхөн үгүйсгэлгүй БАТТАЙ мэдэгдэл хасагдана (GOLD B10).  ERP-ийн хориотой хэллэг хэвээр.
  const normRefusal = c.legacyKind === 'norm_review' || c.legacyKind === 'norm_refusal' || c.legacyKind === 'norm_unavailable';
  for (const s of sentences) {
    if (normRefusal && (isServer(s) || NEGATION_RE.test(s))) continue;
    const hit = c.forbiddenPhrases.find((p) => fold(s).includes(fold(p)));
    if (hit) v.push({ code: 'FORBIDDEN_PHRASE', detail: `Эрхгүй атлаа «${hit}»`, sentence: s, removable: true });
  }

  return { ok: v.length === 0, violations: v };
}

/* ================================================================== */
/*  ЗАСВАР                                                             */
/* ================================================================== */

const NOTICE_MN: Record<ViolationCode, string> = {
  FACT_MISSING: 'Баталгаажсан баримтыг эхэнд нэмлээ.',
  NUMBER_CHANGED: 'Баталгаажсан тооноос зөрсөн өгүүлбэрийг хаслаа.',
  CATEGORY_CHANGED: 'Гэрээнд байхгүй ангилал дурдсан өгүүлбэрийг хаслаа.',
  UNSUPPORTED_NUMBER: 'Эх сурвалжгүй тоо агуулсан өгүүлбэрийг хаслаа.',
  REFUSAL_MISSING: 'Эх сурвалж олдоогүйг эхэнд ил хэллээ.',
  CITATION_MISSING: 'Эх сурвалжийн эшлэлийг нэмлээ.',
  FAKE_CITATION: 'Олдоогүй эх сурвалжийг эшилсэн өгүүлбэрийг хаслаа.',
  FALSE_UNCERTAINTY: 'Шийдвэр гарсан атлаа эргэлзсэн өгүүлбэрийг хаслаа.',
  EMPTY_AFTER_REPAIR: 'Загварын хариулт бүхэлдээ баталгаагүй тоотой байсан тул баталгаажсан мэдээллийг л харуулав.',
  UNIT_MISMATCH: 'Нэгж зөрсөн өгүүлбэрийг хаслаа.',
  FORBIDDEN_PHRASE: 'Эрхгүй үйлдлийг хийсэн мэт өгүүлбэрийг хаслаа.',
  TRAILER_MISSING: 'Төгсгөлийн анхааруулгыг нэмлээ.',
  CONTRADICTS_ZERO_COUNT: 'Тоолуур 0 атлаа жагсаалт бичсэн тул хариултыг дахин бичүүллээ.',
  FOREIGN_CITATION: 'Загвар эх сурвалжийн бус баримт эшилсэн тул баталгаажсан хариултыг шууд харуулав.',
  RESULT_MISSING: 'Загвар тооцооны үр дүнг орхисон тул баталгаажсан хариултыг шууд харуулав.',
  CATEGORY_MISSING: 'Загвар эцсийн ангиллыг орхисон тул баталгаажсан хариултыг шууд харуулав.',
  FOLLOWUP_MISSING: 'Нэмэлт шалгалтын шаардлагыг нэмлээ.',
};

/** Хатуу инвариантын зөрчил байна уу — байвал засвар/дахилт ҮГҮЙ, шууд `fallbackAnswer`. */
export function hasHardViolation(v: ValidationResult): boolean {
  return v.violations.some((x) => x.hard === true);
}

/**
 * ЯГ ИЖИЛ өгүүлбэрийн давхардлыг хасна (§20 — давталтын программ талын
 * хамгаалалт).  Зөвхөн ≥4 үгтэй, эхнийхийг үлдээнэ; жагсаалтын шошго,
 * томьёо, богино мөр ХӨНДӨГДӨХГҮЙ.  Бүх горимд (free ч) ажиллана.
 */
export function dedupeSentences(text: string): { text: string; removed: number } {
  const lines = text.split('\n');
  const seen = new Set<string>();
  let removed = 0;
  const out: string[] = [];
  for (const line of lines) {
    const parts = line.split(/(?<=[.!?])\s+/u);
    const kept: string[] = [];
    for (const p of parts) {
      const key = fold(p).replace(/[*_`#>|-]+/g, '').trim();
      if (key.split(' ').length >= 4 && /\p{L}/u.test(key)) {
        if (seen.has(key)) {
          removed += 1;
          continue;
        }
        seen.add(key);
      }
      kept.push(p);
    }
    out.push(kept.join(' '));
  }
  return { text: out.join('\n').replace(/\n{3,}/g, '\n\n').trim(), removed };
}

/** Баримтуудаас нэг мөр хураангуй (mn/en) — дутуу баримт нэмэхэд. */
export function factsLine(c: TrustedContract, lang: 'mn-Cyrl' | 'en'): string {
  const parts: string[] = [];
  for (const f of c.facts) {
    if (!f.mustMention) continue;
    const label = lang === 'en' ? f.labelEn : f.labelMn;
    const unit = f.unit === 'MJ/m2' ? (lang === 'en' ? ' MJ/m²' : ' МДж/м²') : f.unit === '%' ? '%' : f.unit === 'd' ? (lang === 'en' ? ' days' : ' хоног') : f.unit ? ` ${f.unit}` : '';
    parts.push(`${label}: **${f.value}${typeof f.value === 'number' ? unit : ''}**`);
  }
  if (c.requiredCitations.length > 0) parts.push(`${lang === 'en' ? 'Source' : 'Эх сурвалж'}: ${c.requiredCitations.join(', ')}`);
  return parts.join(' · ');
}

/**
 * ⚠️ ГОЛ ФУНКЦ (2/2).  Хариултыг гэрээний дагуу ЗАСНА (хасах/нэмэх), дараа
 *    нь ДАХИН шалгана.  `validation.ok=false` бол дуудагч дахин үүсгэнэ.
 */
export function enforceContract(
  answer: string,
  c: TrustedContract | null | undefined,
  lang: 'mn-Cyrl' | 'en' = 'mn-Cyrl',
): EnforceOutcome {
  const before = validateAnswer(answer, c);
  const base: EnforceOutcome = { answer, validation: before, before, notices: [], removedSentences: 0, outcome: 'model' };
  if (!c || c.answerMode === 'free' || before.ok) return base;
  // ⚠️ tfc-2 ХАТУУ ИНВАРИАНТ: өгүүлбэр таамаглан засахгүй — загварын хариултыг хаяж
  //    серверийн детерминист хариултыг өгнө (дуудагч дахин үүсгэлт ч хийхгүй).
  if (hasHardViolation(before)) {
    const full = fallbackAnswer(c, lang);
    return {
      answer: full,
      validation: validateAnswer(full, c),
      before,
      notices: [...new Set(before.violations.filter((x) => x.hard).map((x) => NOTICE_MN[x.code]))],
      removedSentences: 0,
      outcome: 'repaired',
    };
  }

  const { before: pre, marker, body, after } = sectionOf(answer, c.taskIndex);
  let text = body;
  const notices = new Set<string>();

  // 1. Хасалт — зөрчилтэй өгүүлбэрүүд
  const removable = new Set(before.violations.filter((x) => x.removable && x.sentence).map((x) => x.sentence as string));
  if (removable.size > 0) {
    const kept = splitSentences(text).filter((s) => !removable.has(s));
    base.removedSentences = splitSentences(text).length - kept.length;
    text = kept.join('\n');
    for (const x of before.violations) if (x.removable) notices.add(NOTICE_MN[x.code]);
  }

  // 2. Заавал татгалзал
  if (c.requiredSentence && !text.includes(c.requiredSentence)) {
    text = text.length > 0 ? `${c.requiredSentence}\n\n${text}` : c.requiredSentence;
    notices.add(NOTICE_MN.REFUSAL_MISSING);
  }

  // 3. Дутуу баримт / эшлэл — хураангуй мөрийг ЭХЭНД
  const interim = validateAnswer(`${pre}${marker}${text}${after}`, c);
  if (interim.violations.some((x) => x.code === 'FACT_MISSING' || x.code === 'CITATION_MISSING')) {
    const line = factsLine(c, lang);
    if (line.length > 0) {
      text = text.length > 0 ? `${line}\n\n${text}` : line;
      notices.add(NOTICE_MN.FACT_MISSING);
    }
  }

  // 3b. tfc-2 — заавал байх follow-up өгүүлбэр (серверийн үг, ЯГ хэвээр)
  if (c.norm) {
    for (const f of c.norm.requiredFollowups) {
      if (!fold(text).includes(fold(f.sentence))) {
        text = text.length > 0 ? `${text}\n\n${f.sentence}` : f.sentence;
        notices.add(NOTICE_MN.FOLLOWUP_MISSING);
      }
    }
  }

  let full = `${pre}${marker}${text}${after}`.trim();

  // 4. Трейлер ТӨГСГӨЛД
  if (c.trailerText && !full.includes(c.trailerText)) {
    full = full.length > 0 ? `${full}\n\n${c.trailerText}` : c.trailerText;
    notices.add(NOTICE_MN.TRAILER_MISSING);
  }

  // ⚠️ ЗАСВАРААР ХООСОН БОЛСОН ХАРИУЛТ = ЗӨРЧИЛ, амжилт БИШ (Session C, 2026-09-11).
  //    Бүх өгүүлбэр нь эх сурвалжгүй тоотой байвал хасалт хоосон мөр үлдээж,
  //    `validateAnswer('')` нь «зөрчилгүй» гэж ok өгдөг байв — хэрэглэгч ХООСОН
  //    хариулт + «өгүүлбэрийг хаслаа» гэсэн мэдэгдэл хардаг.  Хоосон бол
  //    детерминист хариулт руу унана; тэр ч хоосон бол ok=false үлдээж
  //    дуудагчийн дахилт/template замыг асаана.
  if (full.length === 0) {
    const fb = fallbackAnswer(c, lang).trim();
    if (fb.length > 0) {
      full = fb;
      notices.add(NOTICE_MN.EMPTY_AFTER_REPAIR);
    } else {
      base.answer = '';
      base.notices = [...notices];
      base.outcome = 'repaired';
      base.validation = { ok: false, violations: [{ code: 'EMPTY_AFTER_REPAIR', detail: 'Засварын дараа хариулт хоосон', removable: false }] };
      return base;
    }
  }

  base.answer = full;
  base.notices = [...notices];
  base.outcome = 'repaired';
  base.validation = validateAnswer(full, c);
  return base;
}

/** Хоёр удаа зөрчсөний дараах ДЕТЕРМИНИСТ хариулт (§39). */
export function fallbackAnswer(c: TrustedContract, lang: 'mn-Cyrl' | 'en' = 'mn-Cyrl'): string {
  const parts: string[] = [];
  // ⚠️ Template нь канон өгүүлбэрийг АГУУЛСАН бол template-ийг БҮХЛЭЭР нь (өмнө нь зөвхөн
  //    канон өгүүлбэр үлдэж, «(БД 21-101-12, Хүснэгт 1, х.4: …)» гэсэн эх сурвалжийн
  //    дэлгэрэнгүй алдагдаж байв — хэмжсэн GOLD-E04).
  if (c.template && c.requiredSentence && c.template.includes(c.requiredSentence)) parts.push(c.template);
  else {
    if (c.requiredSentence) parts.push(c.requiredSentence);
    if (c.template) parts.push(c.template);
    else {
      const line = factsLine(c, lang);
      if (line) parts.push(line);
    }
  }
  // tfc-2: follow-up өгүүлбэр template-д байхгүй бол нэмнэ (эх сурвалжийн хаяг template-д бий).
  for (const f of c.norm?.requiredFollowups ?? []) {
    if (!parts.some((p) => fold(p).includes(fold(f.sentence)))) parts.push(f.sentence);
  }
  if (c.trailerText) parts.push(c.trailerText);
  return parts.join('\n\n');
}

/* ================================================================== */
/*  ДАХИН ҮҮСГЭЛТИЙН ЗАСВАРЫН ТУШААЛ (§7 — яг нэг удаа)                */
/* ================================================================== */

/**
 * Зөрчлийг НЭРЛЭЖ, баримтыг ЯГ хэвээр ашиглахыг тушаана.
 *
 * ⚠️ Зөрчилтэй текстийг ЭНД дахин бичихгүй — загвар түүнийг хуулна.
 *    Зөвхөн кодоор нэрлэнэ («баталгаагүй тоо», «ангилал зөрсөн»).
 */
export function correctionPrompt(c: TrustedContract, v: ValidationResult, lang: 'mn-Cyrl' | 'en' = 'mn-Cyrl'): string {
  const why = [...new Set(v.violations.map((x) => (lang === 'en' ? x.code : NOTICE_MN[x.code].replace(/лаа\.|лээ\./u, '')))).values()].join('; ');
  const facts = factsLine(c, lang);
  if (lang === 'en') {
    return (
      `Your previous answer violated the verified facts (${why}). Rewrite it from scratch. ` +
      `Use EXACTLY these facts, do not change numbers, categories or units, and do not add any other numbers: ${facts || '(none)'}. ` +
      (c.requiredSentence ? `Start with: "${c.requiredSentence}". ` : '') +
      (c.noMatch ? 'Do not cite any document — no verified source was found. ' : '') +
      'Keep it short.'
    );
  }
  return (
    `Өмнөх хариулт баталгаажсан баримттай зөрөв (${why}). Эхнээс нь ДАХИН бич. ` +
    `ЯГ дараах баримтыг ашигла — тоо, ангилал, нэгжийг ӨӨРЧЛӨХГҮЙ, өөр тоо НЭМЭХГҮЙ: ${facts || '(баримт алга)'}. ` +
    (c.requiredSentence ? `Хариултаа «${c.requiredSentence}» гэж эхэл. ` : '') +
    (c.noMatch ? 'Ямар ч баримт, норм ЭШЛЭХГҮЙ — баталгаажсан эх сурвалж олдоогүй. ' : '') +
    'Богино бич.'
  );
}
