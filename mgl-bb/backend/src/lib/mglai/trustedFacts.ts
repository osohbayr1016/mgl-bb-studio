/**
 * MGL AI · ИТГЭМЖЛЭГДСЭН БАРИМТЫН ГЭРЭЭ (Trusted Fact Contract, tfc-1).
 *
 * ⚠️ ЯАГААД ЭНЭ ФАЙЛ ОРШИН БАЙНА.  `answerContract.ts` нь ЗӨВХӨН нормын
 *    хоёр тохиолдлыг (татгалзал, босгын шийдвэр) барьдаг байв.  Бодит
 *    Qwen3-8B E2E (2026-09-10) дээр ижил гажиг ERP-д ч гарсан: 24 мөрийн
 *    жагсаалтаас загвар «идэвхтэй»-г 14/16/18 гэж зөрж тоолсон; «эх
 *    сурвалж алга» гэсэн тушаалыг үл хайхарч БНбД-г эшилсэн мэт бичсэн.
 *    Prompt-ын тушаал нь МАГАДЛАЛТ хамгаалалт.  Энэ файл нь ерөнхий,
 *    ДЕТЕРМИНИСТ хамгаалалт: сервер хариултад ЯМАР баримт ЗААВАЛ байх, ЯМАР
 *    тоо/ангилал байж БОЛОХ, юу ХОРИОТОЙг типтэй гэрээ болгон өгнө; хөтөч
 *    (`lib/validator.ts`) үүсгэлтийн ДАРАА, харуулахаас ӨМНӨ тулгана.
 *
 * ⚠️ ЗАГВАР БОЛ ХЭЛНИЙ РЕНДЕРЛЭГЧ.  Эрх бүхий хариултад загварын үүрэг:
 *    тайлбарлах, хэлбэржүүлэх, монголоор бичих.  Дахин тооцох, босго
 *    тайлах, мөр тоолох, өөр тоо/ангилал ЗОХИОХ нь ХОРИОТОЙ — тэр бүхнийг
 *    ЭНД тодорхойлсон баримт л хэлнэ.
 *
 * ⚠️ ЕРӨНХИЙ АТЛАА ЖИЖИГ.  Норм · ERP хэрэгсэл · тооцоо · Revit/эрхийн
 *    үр дүн — дөрвүүлэнг ижил `TrustedFact` хэлбэрээр.  «Бүх байгалийн
 *    хэлний утгыг шалгах» оролдлого ЭНД БАЙХГҮЙ (§6): зөвхөн тоо, нэгж,
 *    ангилал, төлөв, эшлэл, заавал өгүүлбэр.
 *
 * ⚠️ `answerContract.ts`-ийг УСТГААГҮЙ — нормын татгалзал/трейлер/хэмжүүрийн
 *    логик тэндээ, энэ файл түүнийг УГСАРНА (`legacy` талбар).  Хос бичвэл
 *    зөрнө; нэг эх сурвалж.
 *
 * ⚠️ ЦЭВЭР ФУНКЦ — тестлэгдэнэ (`trustedFacts.test.ts`).
 */
import type { NormIntelBlock } from '@mgl/mglai-common/normIntel';
import type { NormDecision } from './normDecide';
import { buildAnswerContract, type AnswerContract, type ContractInput } from './answerContract';
import type { ToolOutcome } from './promptFrame';
import { currentnessLabel, currentnessOf } from './currentness';
import { buildNormContract, type NormContractBlock } from './norm/contract';
import { NORM_DOCUMENTS_TOOL, NORM_DOCUMENTS_MUST_MENTION_LIMIT, type NormDocumentsData } from './normDocuments';

/** tfc-2 (2026-09-11): `norm` блок — TrustedNormResult-ийн хатуу инвариант. */
export const TRUSTED_CONTRACT_VERSION = 'tfc-2' as const;
export type { NormContractBlock };

export type FactKind = 'number' | 'category' | 'status' | 'id' | 'date' | 'text';
export type FactAuthority = 'deterministic_rule' | 'erp_tool' | 'calculator' | 'retrieval' | 'permission' | 'revit_model';

export interface TrustedFact {
  /** Тогтвортой түлхүүр — `active_projects`, `fire_category`, `range_min`. */
  id: string;
  kind: FactKind;
  value: string | number;
  /** ХЭВИЙЖСЭН нэгж (`normalizeUnit`) — `MJ/m2`, `m2`, `kPa`, `%`, `d`. */
  unit?: string;
  /** Хүнд харагдах монгол шошго — детерминист загварт. */
  labelMn: string;
  labelEn: string;
  authority: FactAuthority;
  /** Хариултад ЗААВАЛ дурдагдах ёстой юу. */
  mustMention: boolean;
}

/**
 * Хариултын горим:
 *   authoritative — детерминист үр дүн БҮРЭН; загвар зөвхөн тайлбарлана
 *   grounded      — хэрэгслийн амьд өгөгдөл; тоо зөвхөн хайрцгаас
 *   refusal       — нотолгоо алга; канон өгүүлбэр заавал, тоо хориотой
 *   free          — гэрээгүй (мэндчилгээ, ерөнхий зөвлөгөө)
 */
export type AnswerMode = 'authoritative' | 'grounded' | 'refusal' | 'free';
export type AnswerRisk = 'low' | 'medium' | 'high';

export interface TrustedContract {
  version: typeof TRUSTED_CONTRACT_VERSION;
  answerMode: AnswerMode;
  /** Урсгалын бодлого: high → батлагдтал ХӨТӨЧ ХАРУУЛАХГҮЙ (§36). */
  risk: AnswerRisk;
  facts: TrustedFact[];
  /**
   * Хариултад байж болох тоонууд.  `null` = хязгаарлахгүй (free).
   * Баримт + хэрэгслийн хайрцгийн БҮХ тоо (grounded) + шийдвэрийн блок.
   */
  allowedNumbers: number[] | null;
  /** Хариултад байж болох ангиллын тэмдэг («В2»); `null` = шалгахгүй. */
  allowedCategories: string[] | null;
  /** ЗААВАЛ байх өгүүлбэр (татгалзал) — байхгүй бол нэмнэ. */
  requiredSentence: string | null;
  /** ТӨГСГӨЛД заавал байх мөр (хуучин баримт, хэмжүүрийн анхааруулга). */
  trailerText: string | null;
  /** ЗААВАЛ дурдагдах эх сурвалжийн код («БД 21-101-12»). */
  requiredCitations: string[];
  /**
   * Хайлт «ОЛДСОНГҮЙ» гэсэн — загвар «БНбД X-д заасан» гэж эх сурвалж
   * ЗОХИОЖ БОЛОХГҮЙ (§5-H).
   */
  noMatch: boolean;
  /** Хориотой хэллэг (эрх татгалзсан үед «өөрчиллөө» гэх мэт). */
  forbiddenPhrases: string[];
  /**
   * ДЕТЕРМИНИСТ ХАРИУЛТ — сервер монголоор (эсвэл англиар) бэлдсэн.
   * Загвар ХОЁР удаа гэрээ зөрчвөл хөтөч ЭНИЙГ харуулна (§7, §39):
   * «зөв атлаа арай хатуу монгол» нь «уран атлаа зохиомол»-оос дээр.
   */
  template: string | null;
  /** Хариулт = template ШУУД, загвар үүсгэлтгүй (L1 баримт олох; хөтөч/runtime engine хүндэтгэнэ). */
  templateOnly?: boolean;
  /** Олон даалгаварт гэрээ хамаарах хэсгийн дугаар. */
  taskIndex: number | null;
  /** Хуучин гэрээ — `answerContract.ts`-ийн kind (оношилгоо, хос UI). */
  legacyKind: AnswerContract['kind'];
  reason: string;
  /**
   * НОРМЫН БЛОК (tfc-2) — TrustedNormResult-оос: баримт/үр дүн/ангиллын хатуу
   * инвариант, follow-up өгүүлбэр, хаягийн маск.  Нормын бус ээлжид `null`.
   */
  norm: NormContractBlock | null;
  /**
   * NORM-INTEL v3 (2026-10-04): нотолгооны төлөв, хэрэглэгдэх байдал, мэдэгдлийн бүртгэл, эх сурвалжийн блок,
   * нэр томьёоны хамгаалалт (`norm/intelligence.ts`).  Хөтөч/runtime үүсгэлтийн ДАРАА хатуу тулгана.
   */
  normIntel?: NormIntelBlock | null;
}

/* ================================================================== */
/*  Нэгжийн хэвийжүүлэлт (§11)                                         */
/* ================================================================== */

/**
 * Нэгжийн бүх бичлэгийг НЭГ хэлбэрт.  `MJ/m²`, `MJ/m2`, `МДж/м²`, `мдж/м2`
 * → `MJ/m2`; `м²`/`m2`/`кв.м` → `m2`; `кПа`/`kPa` → `kPa`; `°C`/`град` → `C`;
 * `мм` → `mm`; `м` → `m`; `%` → `%`; `хоног`/`days` → `d`.
 *
 * ⚠️ ХАРЬЦУУЛАЛТАД Л — хэрэглэгчид харагдах текст өөрчлөгдөхгүй.
 */
export function normalizeUnit(raw: string | null | undefined): string | null {
  if (!raw) return null;
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
    'mj/m2': 'MJ/m2',
    'mj/m3': 'MJ/m3',
    mj: 'MJ',
    m2: 'm2',
    m3: 'm3',
    m: 'm',
    м: 'm',
    mm: 'mm',
    cm: 'cm',
    kpa: 'kPa',
    pa: 'Pa',
    kg: 'kg',
    c: 'C',
    '%': '%',
    d: 'd',
  };
  return table[u] ?? u;
}

/* ================================================================== */
/*  Тоог хайрцгаас цуглуулах                                          */
/* ================================================================== */

/** JSON өгөгдлөөс БҮХ тоог (мөрөн доторх тоог ч) рекурсээр цуглуулна. */
export function numbersInData(data: unknown, out = new Set<number>(), depth = 0): Set<number> {
  if (depth > 8 || data === null || data === undefined) return out;
  if (typeof data === 'number') {
    if (Number.isFinite(data)) {
      out.add(data);
      // Загвар 8.53 → «8.5%» гэж дугуйлж болно — нэг орон дугуйлсныг зөвшөөрнө.
      out.add(Math.round(data * 10) / 10);
      out.add(Math.round(data));
    }
    return out;
  }
  if (typeof data === 'string') {
    for (const m of data.matchAll(/(?<![\p{L}\d])(\d+(?:[.,]\d+)?)(?![\d])/gu)) {
      const v = Number(m[1]!.replace(',', '.'));
      if (Number.isFinite(v)) out.add(v);
    }
    return out;
  }
  if (Array.isArray(data)) {
    for (const x of data) numbersInData(x, out, depth + 1);
    return out;
  }
  if (typeof data === 'object') {
    for (const v of Object.values(data as Record<string, unknown>)) numbersInData(v, out, depth + 1);
  }
  return out;
}

/* ================================================================== */
/*  Баримт гаргагчид                                                   */
/* ================================================================== */

function fact(
  id: string,
  kind: FactKind,
  value: string | number,
  labelMn: string,
  labelEn: string,
  authority: FactAuthority,
  extra: { unit?: string; mustMention?: boolean } = {},
): TrustedFact {
  const f: TrustedFact = { id, kind, value, labelMn, labelEn, authority, mustMention: extra.mustMention ?? false };
  if (extra.unit) f.unit = extra.unit;
  return f;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function strv(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

/** Нормын шийдвэр → баримтууд. */
export function factsFromNormDecision(d: NormDecision): TrustedFact[] {
  const out: TrustedFact[] = [];
  if (d.status !== 'verified' || !d.decision) return out;
  const cat = d.decision.initial_category.split(',')[0]!.trim();
  out.push(fact('fire_category', 'category', cat, 'Ангилал', 'Category', 'deterministic_rule', { mustMention: true }));
  const range = d.ranges.find((r) => r.category === cat);
  if (range) {
    if (range.min !== null) out.push(fact('range_min', 'number', range.min, 'Доод хязгаар', 'Lower bound', 'deterministic_rule', { unit: 'MJ/m2', mustMention: true }));
    if (range.max !== null) out.push(fact('range_max', 'number', range.max, 'Дээд хязгаар', 'Upper bound', 'deterministic_rule', { unit: 'MJ/m2', mustMention: range.max !== null }));
  }
  const g = d.inputs_used.g_mj_m2;
  if (typeof g === 'number') out.push(fact('g_input', 'number', g, 'g', 'g', 'deterministic_rule', { unit: 'MJ/m2' }));
  if (d.source) out.push(fact('source', 'text', d.source.document, 'Эх сурвалж', 'Source', 'deterministic_rule'));
  return out;
}

/**
 * ERP хэрэгслийн үр дүн → ТООЛУУРЫН баримтууд.
 *
 * ⚠️ ЗӨВХӨН СЕРВЕР ТООЛСОН талбарууд (`count`, `total_active`, `active_count` …).
 *    Мөр тоолж баримт үүсгэхгүй — тэр нь загварын алдааг серверт давтах.
 */
export function factsFromTools(results: readonly ToolOutcome[]): TrustedFact[] {
  const out: TrustedFact[] = [];
  for (const r of results) {
    if (!r.ok || !r.data || typeof r.data !== 'object') continue;
    const d = r.data as Record<string, unknown>;
    switch (r.tool) {
      case 'revit_selection': {
        // Сонгосон элементийн ХЭМЖСЭН утга (add-in Measure, BUILTIN_GEOMETRY/TYPED_PARAM л) —
        // authority revit_model; тоо бүр allowedNumbers-т (numbersInData), загвар өөрчилбөл NUMBER_CHANGED.
        const els = Array.isArray(d.elements) ? (d.elements as Record<string, unknown>[]) : [];
        // Монгол шошго + ЗААВАЛ дурдах хэмжээ (өргөн/урт/өндөр, ангилал): загвар орхивол validator-ын
        // FACT_MISSING засвар детерминист «Өргөн: **200 mm** · …» мөрийг ЭХЭНД нэмнэ (бодит Qwen smoke:
        // 8B загвар талбай/эзлэхүүнийг л бичээд өргөн, урт, өндрийг орхиж байв).
        const LABEL: Record<string, [string, string, boolean]> = {
          width_mm: ['Өргөн', 'Width', true], length_mm: ['Урт', 'Length', true], height_mm: ['Өндөр', 'Height', true],
          thickness_mm: ['Зузаан', 'Thickness', true], area_m2: ['Талбай', 'Area', false], volume_m3: ['Эзлэхүүн', 'Volume', false],
        };
        els.slice(0, 3).forEach((el, i) => {
          const units = (el.units && typeof el.units === 'object' ? el.units : {}) as Record<string, string>;
          for (const [k, v] of Object.entries(el)) {
            const n = num(v);
            if (n === null || k === 'id' || k === 'issue_count') continue;
            const lab = LABEL[k];
            // Нэгж validator-ын хэвийжүүлсэн хэлбэрээр (MM → mm, M2 → m2) — эс тэгвэл зөв «200 мм» UNIT_MISMATCH болно (R3.5-д хэмжсэн).
            const unit = units[k] ? normalizeUnit(units[k]!) : undefined;
            out.push(fact(`revit_${i}_${k}`, 'number', n, lab ? lab[0] : `Revit ${k}`, lab ? lab[1] : `Revit ${k}`, 'revit_model', { ...(unit && /^(mm|m|m2|m3)$/.test(unit) ? { unit } : {}), mustMention: lab ? lab[2] : false }));
          }
          const cat = strv(el.category);
          if (cat) out.push(fact(`revit_${i}_category`, 'text', cat, 'Ангилал', 'Category', 'revit_model', { mustMention: true }));
          if (i === 0 && d.document_is_test_fixture === true) out.push(fact('revit_fixture', 'text', 'синтетик тест загвар', 'Загвар', 'Model', 'revit_model', { mustMention: true }));
          // Детерминист асуудлын ТОО — заавал (0 ч гэсэн): «асуудал олдсонгүй» гэдэг нь тоон баримт.
          const issues = Array.isArray(el.issues) ? (el.issues as Record<string, unknown>[]) : [];
          if (Array.isArray(el.issues)) out.push(fact(`revit_${i}_issue_count`, 'number', issues.length, 'Детерминист шалгалтын асуудал', 'Deterministic issues', 'revit_model', { mustMention: true }));
          issues.slice(0, 3).forEach((iss, j) => {
            const cls = strv(iss.class);
            if (cls) out.push(fact(`revit_${i}_issue_${j}_class`, 'text', cls + (iss.synthetic === true ? ' (СИНТЕТИК, норм биш)' : ''), 'Асуудлын ангилал', 'Issue class', 'revit_model', { mustMention: true }));
          });
        });
        break;
      }
      case 'revit_report': {
        // Детерминист тайлан: тоон баримт бүр allowedNumbers-т (authority revit_model); хувь/ажилтны
        // үйл ажиллагаа энд БАЙХГҮЙ тул зохиовол хасагдана.  Синтетик баримт бол заавал тэмдэглэнэ.
        const facts = Array.isArray(d.facts) ? (d.facts as Record<string, unknown>[]) : [];
        const RLABEL: Record<string, [string, string]> = {
          ELEMENTS_ADDED: ['Нэмсэн элемент', 'Elements added'], ELEMENTS_MODIFIED: ['Зассан элемент', 'Elements modified'], ELEMENTS_DELETED: ['Устгасан элемент', 'Elements deleted'],
          ISSUES_REMAINING: ['Нээлттэй асуудал', 'Open issues'], SESSION_DURATION_MIN: ['Сессийн үргэлжлэл (мин)', 'Session duration (min)'], CATEGORY_TOUCHED: ['Хөндсөн', 'Touched'],
        };
        facts.slice(0, 60).forEach((f, i) => {
          const n = num(f.number);
          const kind = strv(f.kind) ?? `fact_${i}`;
          const subj = strv(f.subject);
          const lab = RLABEL[kind];
          const mn = lab ? (kind === 'CATEGORY_TOUCHED' && subj ? `${lab[0]} ${subj}` : lab[0]) : `Тайлан: ${kind}`;
          const en = lab ? (kind === 'CATEGORY_TOUCHED' && subj ? `${lab[1]} ${subj}` : lab[1]) : `Report: ${kind}`;
          if (n !== null) out.push(fact(`report_${i}_${kind}`, 'number', n, mn, en, 'revit_model', strv(f.unit) ? { unit: normalizeUnit(strv(f.unit)!) ?? undefined } : {}));
        });
        out.push(fact('report_progress', 'text', 'PROGRESS_ESTIMATE_UNAVAILABLE', 'Явцын тооцоо', 'Progress estimate', 'revit_model'));
        if (d.document_is_test_fixture === true) out.push(fact('report_fixture', 'text', 'синтетик тест загвар', 'Загвар', 'Model', 'revit_model', { mustMention: true }));
        break;
      }
      case NORM_DOCUMENTS_TOOL: {
        // L1 баримт олох (2026-09-18): баримт БҮР текстийн баримт (код, кодгүй бол нэр) — эхний
        //    NORM_DOCUMENTS_MUST_MENTION_LIMIT нь ЗААВАЛ (орхивол FACT_MISSING → validator детерминист
        //    мөрөөр нэмнэ); `count` нь серверийн тоо.  Заалт/тоо энд ХЭЗЭЭ Ч байхгүй.
        const nd = d as unknown as NormDocumentsData;
        const docs = Array.isArray(nd.documents) ? nd.documents : [];
        docs.forEach((doc, i) => {
          const v = strv(doc.code) ?? strv(doc.title);
          if (!v) return;
          out.push(fact(`norm_doc_${i}`, 'text', v, 'Норм', 'Norm', 'retrieval', { mustMention: i < NORM_DOCUMENTS_MUST_MENTION_LIMIT }));
        });
        const c = num(nd.count);
        if (c !== null) out.push(fact('norm_doc_count', 'number', c, 'Олдсон баримт', 'Documents found', 'retrieval'));
        break;
      }
      case 'get_active_employees': {
        const n = num(d.total_active);
        if (n !== null) out.push(fact('active_employees', 'number', n, 'Идэвхтэй ажилтан', 'Active employees', 'erp_tool', { mustMention: true }));
        break;
      }
      case 'list_projects': {
        const a = num(d.active_count);
        if (a !== null) out.push(fact('active_projects', 'number', a, 'Идэвхтэй төсөл', 'Active projects', 'erp_tool', { mustMention: true }));
        const t = num(d.total_visible);
        if (t !== null) out.push(fact('total_projects', 'number', t, 'Нийт төсөл', 'Total projects', 'erp_tool'));
        const o = num(d.overdue_count);
        if (o !== null) out.push(fact('overdue_projects', 'number', o, 'Хугацаа хэтэрсэн төсөл', 'Overdue projects', 'erp_tool'));
        break;
      }
      case 'get_upcoming_deadlines': {
        const n = num(d.count);
        if (n !== null) out.push(fact('upcoming_count', 'number', n, 'Ойрын хугацаатай төсөл', 'Upcoming deadlines', 'erp_tool'));
        const first = Array.isArray(d.projects) ? (d.projects[0] as Record<string, unknown> | undefined) : undefined;
        if (first) {
          const name = strv(first.name);
          if (name) out.push(fact('nearest_project', 'text', name, 'Хамгийн ойрхон төсөл', 'Nearest project', 'erp_tool', { mustMention: true }));
          const days = num(first.days_remaining);
          if (days !== null) out.push(fact('nearest_days', 'number', days, 'Үлдсэн хоног', 'Days remaining', 'erp_tool', { unit: 'd' }));
          const fin = strv(first.finish_date);
          if (fin) out.push(fact('nearest_finish', 'date', fin, 'Дуусах огноо', 'Finish date', 'erp_tool'));
        }
        break;
      }
      case 'get_overdue_tasks':
      case 'get_my_assignments': {
        const n = num(d.count);
        if (n !== null) {
          out.push(
            r.tool === 'get_overdue_tasks'
              ? fact('overdue_tasks', 'number', n, 'Хугацаа хэтэрсэн даалгавар', 'Overdue tasks', 'erp_tool', { mustMention: true })
              : fact('my_tasks', 'number', n, 'Миний даалгавар', 'My tasks', 'erp_tool', { mustMention: true }),
          );
        }
        break;
      }
      case 'get_project_progress': {
        const p = num(d.progress_percent);
        if (p !== null) out.push(fact('project_progress', 'number', p, 'Явц', 'Progress', 'erp_tool', { unit: '%', mustMention: true }));
        const name = strv(d.name);
        if (name) out.push(fact('project_name', 'text', name, 'Төсөл', 'Project', 'erp_tool'));
        break;
      }
      case 'analyze_project': {
        const proj = d.project && typeof d.project === 'object' ? (d.project as Record<string, unknown>) : null;
        const facts = d.facts && typeof d.facts === 'object' ? (d.facts as Record<string, unknown>) : null;
        if (proj) {
          const name = strv(proj.name);
          if (name) out.push(fact('project_name', 'text', name, 'Төсөл', 'Project', 'erp_tool'));
          const p = num(proj.progress_percent);
          if (p !== null) out.push(fact('project_progress', 'number', p, 'Явц', 'Progress', 'erp_tool', { unit: '%' }));
        }
        if (facts) {
          const map: [string, string, string][] = [
            ['tasks_overdue', 'Хугацаа хэтэрсэн даалгавар', 'Overdue tasks'],
            ['tasks_stale_14d', '14+ хоног явцгүй даалгавар', 'Stale tasks (14d+)'],
            ['tasks_unassigned_open', 'Хариуцагчгүй даалгавар', 'Unassigned open tasks'],
            ['pending_approvals', 'Батлагдахаа хүлээж буй явц', 'Pending approvals'],
          ];
          for (const [k, mn, en] of map) {
            const n = num(facts[k]);
            if (n !== null) out.push(fact(k, 'number', n, mn, en, 'erp_tool'));
          }
        }
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** Эрх татгалзсан / хэрэгсэл унасан → төлөвийн баримт + хориотой хэллэг. */
export function factsFromFailures(results: readonly ToolOutcome[]): { facts: TrustedFact[]; forbidden: string[] } {
  const facts: TrustedFact[] = [];
  const forbidden: string[] = [];
  for (const r of results) {
    if (r.ok) continue;
    const err = (r.error ?? '').toLowerCase();
    const denied = /эрхгүй|permission|denied|forbidden|403/u.test(err);
    facts.push(
      fact(
        `tool_failed:${r.tool}`,
        'status',
        denied ? 'permission_denied' : 'unavailable',
        denied ? 'Эрхгүй' : 'Хэрэгсэл ажилласангүй',
        denied ? 'Permission denied' : 'Tool unavailable',
        'permission',
        { mustMention: false },
      ),
    );
    if (denied) {
      forbidden.push('өөрчиллөө', 'өөрчилсөн', 'устгалаа', 'устгасан', 'үүсгэлээ', 'үүсгэсэн', 'амжилттай', 'хийлээ', 'changed', 'deleted', 'created', 'successfully');
    }
  }
  return { facts, forbidden };
}

/* ================================================================== */
/*  Детерминист загвар (§8, §39)                                       */
/* ================================================================== */

function fmtNum(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

function unitLabel(u: string | undefined, lang: 'mn-Cyrl' | 'en'): string {
  if (!u) return '';
  const mn: Record<string, string> = { 'MJ/m2': ' МДж/м²', m2: ' м²', m3: ' м³', '%': '%', d: ' хоног', kPa: ' кПа', mm: ' мм', m: ' м', C: ' °C' };
  const en: Record<string, string> = { 'MJ/m2': ' MJ/m²', m2: ' m²', m3: ' m³', '%': '%', d: ' days', kPa: ' kPa', mm: ' mm', m: ' m', C: ' °C' };
  return (lang === 'en' ? en : mn)[u] ?? ` ${u}`;
}

/**
 * Баримтуудаас ХҮНД ЗОРИУЛСАН хариулт угсарна — загваргүйгээр.
 *
 * ⚠️ Уран биш, ЗӨВ.  Загвар хоёр удаа зөрчвөл яг энэ харагдана.
 */
export function composeTemplate(
  facts: readonly TrustedFact[],
  d: NormDecision | null,
  lang: 'mn-Cyrl' | 'en',
  legacy: AnswerContract,
): string | null {
  if (legacy.kind === 'norm_refusal' && legacy.requiredSentence) return legacy.requiredSentence;
  if (legacy.trustedText && (legacy.kind === 'norm_decision' || legacy.kind === 'norm_documents')) return legacy.trustedText;
  const visible = facts.filter((f) => f.authority !== 'permission');
  if (visible.length === 0) return null;
  const lines: string[] = [];
  const byId = new Map(visible.map((f) => [f.id, f]));
  // ERP-ийн түгээмэл тохиолдлуудыг нэг өгүүлбэрээр
  const ae = byId.get('active_employees');
  if (ae) lines.push(lang === 'en' ? `Active employees: **${fmtNum(Number(ae.value))}**.` : `Идэвхтэй ажилтан: **${fmtNum(Number(ae.value))}**.`);
  const ap = byId.get('active_projects');
  if (ap) {
    const tot = byId.get('total_projects');
    lines.push(
      lang === 'en'
        ? `Active projects: **${fmtNum(Number(ap.value))}**${tot ? ` (of ${fmtNum(Number(tot.value))} visible)` : ''}.`
        : `Идэвхтэй төсөл: **${fmtNum(Number(ap.value))}**${tot ? ` (нийт ${fmtNum(Number(tot.value))} төслөөс)` : ''}.`,
    );
  }
  const np = byId.get('nearest_project');
  if (np) {
    const days = byId.get('nearest_days');
    const fin = byId.get('nearest_finish');
    lines.push(
      lang === 'en'
        ? `Nearest deadline: **${np.value}**${fin ? ` — ${fin.value}` : ''}${days ? ` (${fmtNum(Number(days.value))} days left)` : ''}.`
        : `Хамгийн ойрхон дуусах төсөл: **${np.value}**${fin ? ` — ${fin.value}` : ''}${days ? ` (${fmtNum(Number(days.value))} хоног үлдсэн)` : ''}.`,
    );
  }
  const ot = byId.get('overdue_tasks');
  if (ot) lines.push(lang === 'en' ? `Overdue tasks: **${fmtNum(Number(ot.value))}**.` : `Хугацаа хэтэрсэн даалгавар: **${fmtNum(Number(ot.value))}**.`);
  const mt = byId.get('my_tasks');
  if (mt) lines.push(lang === 'en' ? `Your open tasks: **${fmtNum(Number(mt.value))}**.` : `Таны даалгавар: **${fmtNum(Number(mt.value))}**.`);
  const pn = byId.get('project_name');
  const pp = byId.get('project_progress');
  if (pn || pp) {
    const bits: string[] = [];
    if (pp) bits.push(lang === 'en' ? `progress **${fmtNum(Number(pp.value))}%**` : `явц **${fmtNum(Number(pp.value))}%**`);
    for (const k of ['tasks_overdue', 'tasks_stale_14d', 'tasks_unassigned_open', 'pending_approvals']) {
      const f = byId.get(k);
      if (f && Number(f.value) > 0) bits.push(`${lang === 'en' ? f.labelEn : f.labelMn}: **${fmtNum(Number(f.value))}**`);
    }
    lines.push(`${pn ? `**${pn.value}**` : lang === 'en' ? 'Project' : 'Төсөл'}${bits.length ? ' — ' + bits.join(', ') : ''}.`);
  }
  // Үлдсэн баримтуудыг ерөнхий хэлбэрээр
  const handled = new Set(['active_employees', 'active_projects', 'total_projects', 'nearest_project', 'nearest_days', 'nearest_finish', 'overdue_tasks', 'my_tasks', 'project_name', 'project_progress', 'tasks_overdue', 'tasks_stale_14d', 'tasks_unassigned_open', 'pending_approvals', 'source', 'fire_category', 'range_min', 'range_max', 'g_input']);
  for (const f of visible) {
    if (handled.has(f.id)) continue;
    const v = typeof f.value === 'number' ? `${fmtNum(f.value)}${unitLabel(f.unit, lang)}` : String(f.value);
    lines.push(`${lang === 'en' ? f.labelEn : f.labelMn}: **${v}**.`);
  }
  if (d?.source && !lines.some((l) => l.includes(d.source!.document))) {
    lines.push(`${lang === 'en' ? 'Source' : 'Эх сурвалж'}: ${d.source.document}${d.source.table !== null ? `, ${lang === 'en' ? 'Table' : 'Хүснэгт'} ${d.source.table}`: ''}, ${lang === 'en' ? 'p.' : 'х.'}${d.source.page}.`);
  }
  return lines.length > 0 ? lines.join('\n') : null;
}

/* ================================================================== */
/*  ГОЛ ФУНКЦ                                                          */
/* ================================================================== */

export interface TrustedContractInput extends ContractInput {
  toolResults: readonly ToolOutcome[];
  /** Асуултын санаа — эрсдэлийн ангилалд. */
  intent: string;
  /** Хайлт «олдсонгүй» гэж ИЛ хэлсэн эсэх (`no_match_reason`). */
  retrievalNoMatch: boolean;
  /** Бүртгэлийн баримтын кодын alias-ууд — FOREIGN_CITATION-д «BD 21-101-12» хүлээн зөвшөөрөгдөнө. */
  normCodeAliases?: readonly string[];
  /**
   * НОТОЛГООНЫ ТЕКСТИЙН тоонууд — детерминист шийдвэргүй нормын ээлжид (grounded) хариултын
   * тоо ЗӨВХӨН эндээс.  Хэмжсэн (GOLD-B09, 2026-09-11): «1:5000» гэсэн масштаб нотолгоонд
   * байхгүй атлаа загвар санахуйгаас бичих эрсдэл — grounded горимд тоо хязгааргүй байв.
   */
  evidenceNumbers?: readonly number[];
}

export function buildTrustedContract(input: TrustedContractInput): TrustedContract {
  const legacy = buildAnswerContract(input);
  const d = input.normDecision;
  const lang = input.responseLanguage;

  const facts: TrustedFact[] = [];
  let answerMode: AnswerMode = 'free';
  let risk: AnswerRisk = 'low';
  const requiredCitations: string[] = [];
  let allowedNumbers: number[] | null = null;
  let allowedCategories: string[] | null = null;

  const hasRevitReport = input.toolResults.some((t) => t.tool === 'revit_report' && t.ok);
  // Тайлангийн ээлжид сонгосон элементийн баримт (revit_*) ГЭРЭЭНЭЭС хасагдана: тайлан нь баримтын түвшний,
  // элементийн `issue_count: 0` нь баримтын «Нээлттэй асуудал: 2»-тэй CONTRADICTS_ZERO_COUNT болж, mustMention
  // хэмжээ нь тайлангийн асуултад ХАМААРАЛГҮЙ (бодит Qwen smoke Q3-д хэмжсэн: зөв тайлан template болж унасан).
  const toolFacts = factsFromTools(input.toolResults).filter((f) => !(hasRevitReport && f.id.startsWith('revit_') && f.id !== 'revit_fixture'));
  const failures = factsFromFailures(input.toolResults);
  // ⚠️ ОЛОН САНАА («хэдэн төсөл? бас В2-ийн муж?»): нормын шийдвэр ЭРСДЭЛИЙГ
  //    тогтооно, гэвч ERP хэрэгслийн баримт, тоо нь ГЭРЭЭНД ҮЛДЭНЭ — эс тэгвэл
  //    «Идэвхтэй төсөл 24» гэсэн зөв тоо UNSUPPORTED_NUMBER болж хасагдана
  //    (SFT угсрагч барьсан 2026-09-10).
  const toolNums = new Set<number>();
  for (const r of input.toolResults) if (r.ok) numbersInData(r.data, toolNums);
  const withTools = (nums: number[] | null): number[] | null => (nums === null || toolFacts.length === 0 ? nums : [...new Set([...nums, ...toolNums])]);

  /* ── TrustedNormResult (P0-11): бүх зүйл нэг объектоос ─────────────── */
  if (input.trustedNorm) {
    const tn = input.trustedNorm;
    const p = buildNormContract(tn, lang, input.normCodeAliases ?? []);
    if (p.answerMode === 'authoritative') {
      const cat = tn.finalCategory ?? tn.initialCategory;
      if (cat && tn.answerKind !== 'insufficient_context') facts.push(fact('fire_category', 'category', cat, 'Ангилал', 'Category', 'deterministic_rule', { mustMention: true }));
      if (tn.answerKind === 'calculation' && typeof tn.value === 'number') {
        facts.push(fact('norm_result', 'number', tn.value, 'Үр дүн', 'Result', 'calculator', { unit: tn.unit ?? undefined, mustMention: true }));
      } else if (tn.answerKind === 'calculation' && typeof tn.value === 'boolean') {
        facts.push(fact('norm_condition', 'status', tn.value ? 'holds' : 'fails', 'Нөхцөл', 'Condition', 'calculator', { mustMention: false }));
      }
      if (tn.documentCode) facts.push(fact('source', 'text', tn.documentCode, 'Эх сурвалж', 'Source', 'deterministic_rule'));
    } else {
      facts.push(fact('norm_status', 'status', tn.verification, 'Нормын төлөв', 'Norm state', 'deterministic_rule', { mustMention: false }));
    }
    facts.push(...toolFacts, ...failures.facts);
    return {
      version: TRUSTED_CONTRACT_VERSION,
      answerMode: p.answerMode,
      risk: 'high',
      facts,
      allowedNumbers: withTools([...p.allowedNumbers]),
      allowedCategories: p.allowedCategories,
      requiredSentence: p.requiredSentence,
      trailerText: p.trailerText,
      requiredCitations: p.requiredCitations,
      noMatch: p.noMatch,
      forbiddenPhrases: [...failures.forbidden, ...p.forbiddenPhrases],
      template: p.template,
      taskIndex: legacy.taskIndex,
      legacyKind: legacy.kind,
      reason: `${p.answerMode}/high · ${p.reason}`,
      norm: p.norm,
    };
  }

  if (d !== null && d.status === 'verified' && d.decision) {
    answerMode = 'authoritative';
    risk = 'high';
    facts.push(...factsFromNormDecision(d), ...toolFacts);
    allowedNumbers = withTools(legacy.allowedNumbers ?? []);
    allowedCategories = [d.decision.initial_category.split(',')[0]!.trim()];
    if (d.source) requiredCitations.push(d.source.document);
  } else if (d !== null && (d.status === 'needs_human_review' || d.status === 'missing_input')) {
    answerMode = 'authoritative';
    risk = 'high';
    facts.push(fact('norm_status', 'status', d.status, d.status === 'missing_input' ? 'Оролт дутуу' : 'Хүний хяналт хүлээж буй', d.status === 'missing_input' ? 'Missing input' : 'Needs human review', 'deterministic_rule', { mustMention: false }), ...toolFacts);
    allowedNumbers = withTools(legacy.allowedNumbers ?? []);
    allowedCategories = [];
  } else if (legacy.kind === 'norm_refusal') {
    answerMode = 'refusal';
    risk = 'high';
    facts.push(...toolFacts);
    allowedNumbers = withTools([]);
    allowedCategories = [];
  } else if (legacy.kind === 'norm_documents') {
    // L1 баримт олох: жагсаалт = хайрцгийн баримт; тоо ЗӨВХӨН хайрцгаас (хуудас, хувилбарын
    //    дагавар); зохиомол заалт/тоо UNSUPPORTED_NUMBER болж хасагдана; template = детерминист жагсаалт.
    answerMode = 'grounded';
    risk = 'medium';
    facts.push(...toolFacts);
    allowedNumbers = [...toolNums];
  } else if (toolFacts.length > 0) {
    answerMode = 'grounded';
    risk = input.intent === 'REVIT_ACTION' ? 'high' : 'medium';
    facts.push(...toolFacts);
    allowedNumbers = [...toolNums];
  } else if (input.regulatory && legacy.kind === 'norm_legal_review') {
    answerMode = 'grounded';
    risk = 'high';
    // Эх сурвалжийн хүчин төгөлдөр байдал — ТӨЛӨВИЙН баримт (оношилгоо, UI); трейлер нь legacy-ээс.
    const cur = input.localNorm?.currentness ?? currentnessOf(input.localNorm?.effectiveStatus ?? null);
    facts.push(fact('source_currentness', 'status', cur, currentnessLabel(cur, 'mn-Cyrl'), currentnessLabel(cur, 'en'), 'deterministic_rule', { mustMention: false }));
    // Тоо ЗӨВХӨН нотолгооны текстээс (P0-11) — байхгүй бол хязгаарлахгүй (хуучин сервер).
    if (input.evidenceNumbers !== undefined) allowedNumbers = withTools([...new Set(input.evidenceNumbers)]);
  } else if (input.regulatory && input.evidenceCount > 0) {
    // Нотолгоотой норм, детерминист шийдвэргүй — тоо нь ЗӨВХӨН заалтаас (эрсдэл өндөр,
    // батлагдтал харуулахгүй).  «1:5000» гэх мэт санахуйн тоо UNSUPPORTED_NUMBER болно.
    answerMode = 'grounded';
    risk = 'high';
    if (input.evidenceNumbers !== undefined) allowedNumbers = withTools([...new Set(input.evidenceNumbers)]);
  }

  facts.push(...failures.facts);
  if (failures.forbidden.length > 0 && risk === 'low') risk = 'medium';

  // Revit-ийн хэмжсэн баримт байвал эх сурвалжийн шошго ЗААВАЛ (validator trailer-ээр хүчээр,
  // детерминист) — «зураг/дэлгэц харсан» гэсэн төөрөгдөл, зохиомол норм хоёуланг хаана.
  const revitTrailer = toolFacts.some((f) => f.authority === 'revit_model') && !legacy.trailerText ? 'Эх сурвалж: REVIT_MODEL' : null;
  // REVIEW_CANDIDATE/MODEL_QUALITY → «норм зөрчил» гэж ДЭЭШЛҮҮЛЭХГҮЙ: VERIFIED_NORM асуудалгүй бол зөрчлийн
  // өгүүлбэр хасагдана (FORBIDDEN_PHRASE, removable).  Продакшны BIM дүрэм = NO_EXECUTABLE_BIM_RULES (R-13).
  const revitForbidden: string[] = [];
  if (toolFacts.some((f) => f.authority === 'revit_model') && !toolFacts.some((f) => f.kind === 'text' && String(f.value).startsWith('VERIFIED_NORM'))) {
    revitForbidden.push('норм зөрчсөн', 'нормын зөрчил', 'норм зөрчиж', 'стандарт зөрчсөн', 'дүрэм зөрчсөн', 'зөрчил илэрсэн', 'БНбД');
  }
  // R4.2: Revit бичих санаанд загвар «өөрчиллөө/солилоо/зөөлөө» гэж ХЭЛЭХГҮЙ — гүйцэтгэл зөвхөн хэрэглэгчийн Apply-аас.
  if (input.intent === 'REVIT_ACTION') revitForbidden.push('өөрчиллөө', 'өөрчилсөн', 'солилоо', 'сольсон', 'зөөлөө', 'зөөсөн', 'хэрэглэлээ', 'амжилттай', 'бичлээ');
  // Тайлан: явцын хувь, «дууссан/гүйцэтгэсэн хувь» ЗОХИОХГҮЙ (R-8 PROGRESS_ESTIMATE_UNAVAILABLE).
  if (toolFacts.some((f) => f.id === 'report_progress')) revitForbidden.push('% дууссан', 'хувь дууссан', 'явц нь', 'гүйцэтгэл ', 'хувийн явц');
  // Асуудал БАЙХАД «асуудал олдсонгүй» гэж хэлэхгүй (Q2b-д хэмжсэн: загвар нэг өгүүлбэрт өөртэйгөө зөрчилдөв).
  if (toolFacts.some((f) => /^revit_\d+_issue_count$/.test(f.id) && Number(f.value) > 0)) revitForbidden.push('асуудал олдсонгүй', 'асуудалгүй');

  // ⚠️ Хайлт ОЛДСОНГҮЙ гэсэн атлаа загвар «БНбД X-д заасан» гэвэл ХУДАЛ эшлэл.
  const noMatch = answerMode === 'refusal' || (input.retrievalNoMatch && input.evidenceCount === 0 && d === null && legacy.kind !== 'norm_documents');

  const template = composeTemplate(facts, d, lang, legacy);

  return {
    version: TRUSTED_CONTRACT_VERSION,
    answerMode,
    risk,
    facts,
    allowedNumbers,
    allowedCategories,
    requiredSentence: legacy.requiredSentence,
    trailerText: legacy.trailerText ?? revitTrailer,
    requiredCitations,
    noMatch,
    forbiddenPhrases: [...failures.forbidden, ...revitForbidden],
    template,
    // L1 баримт олох: жагсаалт детерминист — загвар оролцохгүй (`templateOnly`).
    ...(legacy.kind === 'norm_documents' && template !== null ? { templateOnly: true } : {}),
    // Нормын ТАТГАЛЗАЛ (ганц даалгавар): канон өгүүлбэр Л.  Хэмжсэн (2026-09-18, адаптер 0.4): «Даамлын гол
    //    үүргүүд юу вэ?» → канон өгүүлбэр + «…даамал нь захиалагчид гурван хувилбарыг гаргах…» гэсэн зохиомол
    //    догол; тоогүй тул validator барьдаггүй.  Олон даалгаварт (taskIndex) ERP хэсэг байгаа тул хөндөхгүй.
    ...(answerMode === 'refusal' && legacy.kind === 'norm_refusal' && template !== null && legacy.taskIndex === null ? { templateOnly: true } : {}),
    taskIndex: legacy.taskIndex,
    legacyKind: legacy.kind,
    reason: `${answerMode}/${risk} · ${legacy.reason}`,
    norm: null,
  };
}
