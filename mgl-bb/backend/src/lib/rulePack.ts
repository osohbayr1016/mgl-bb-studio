/* =============================================================
 * rulePack.ts — `rulepack-v1` угсрагч ба БАГЦ УГСРАХ ШАЛГУУРУУД (V1–V12).
 * -------------------------------------------------------------
 * ⚠️ ДҮРЭМ нь ӨГӨГДӨЛ, compile хийсэн C# БИШ.  Add-in-д auto-update БАЙХГҮЙ:
 * буруу `1200` нь БАГЦ ДАХИН НИЙТЛЭХ, буруу `if` нь ~20 компьютер ДАХИН
 * СУУЛГАХ.  Тиймээс энэ файл нь дүрмийг DLL руу биш, JSON руу гаргана.
 *
 * ⚠️ ХОЁР ГАЗАР ШАЛГАНА, ДАВХАРДАЛ БИШ: энэ файл нь ӨГӨГДЛИЙН САНГИЙН БОДИТ
 * ТӨЛӨВИЙГ хаана (гараар `UPDATE rules SET status='published'` хийсэн мөр
 * багцад ОРОХГҮЙ), `routes/compliance.ts` нь ЗОХИОГЧИЙГ хаана.
 *
 * ⚠️ ШАЛГУУР УНАВАЛ ЧИМЭЭГҮЙ ХАСАХГҮЙ — багц угсралт БҮХЭЛДЭЭ АМЖИЛТГҮЙ
 * болж, өмнөх `ruleset_version` үйлчилсээр байна.  Чимээгүй хасалт нь
 * «инженер шалгагдсан гэж бодож байхад дүрэм ажиллаагүй» гэсэн уналт.
 * ============================================================= */

import {
  MAX_ARRAY_OPERANDS,
  MAX_NEEDLE_LEN,
  MAX_NODES_PER_RULE,
  canonicalize,
  checkNumberProfileRaw,
  countNodes,
  factNamesOf,
  isCoordinateSystem,
  isIssueClass,
  isSeverity,
  isUnit,
  isVerificationState,
  lookupFact,
  packSha256,
  parseCheck,
  parsePredicate,
  semanticHash,
  unitForFactName,
  EXCEPTION_CODE_RE,
  isTriggerChange,
  type CheckNode,
  type ConflictEntry,
  type BuildContext,
  type PredicateNode,
  type RuleDef,
  type RuleException,
  type RuleTrigger,
} from './complianceModel';
import { foldText } from './textFold';

/** Багцын гэрээ.  Клиент зөрвөл БҮХ БАГЦЫГ ТАТГАЛЗАНА (`IntentModel.cs:311-312`). */
export const PACK_CONTRACT = 'rulepack-v1';

/**
 * ⚠️ КООРДИНАТЫН ХААЛГА — v2 §62-ын прозыг ХААЛГА болгож хатууруулав.
 * `RevitLinkInstance.GetTotalTransform()` нь add-in-ийн 46 `.cs` файлын аль
 * нь ч БАЙХГҮЙ.  Тиймээс `coordinate_system <> 'none'` дүрэм нь ямар фрэйм
 * дээр хэмжигдсэнээ МЭДЭХГҮЙ утга дээр ажиллана — v2 §62-ын ЯГ хориглодог
 * «далд фрэйм таамаглал».  `RuleEngine` нь Revit-ийн ямар ч төрөлгүй тул
 * өөрөө ч барьж чадахгүй.
 *
 * ⚠️ ХЭЗЭЭ ӨРГӨЖ БОЛОХ ВЭ: `GetTotalTransform()` бодитоор гарч, `BasisZ !=
 * (0,0,1)` эсвэл `Origin.Z != 0` үед ИЛ ТАТГАЛЗАХ салаа бичигдсэний ДАРАА.
 * Тэр чадварын албан ёсны бүртгэл нь `2-6`-ийн `model_capabilities` (0239) —
 * ГЭХДЭЭ ЭНЭ ДОЛГИОНД тэр хүснэгт БАЙХГҮЙ, тиймээс ТОГТМОЛ хэвээр.
 * ⚠️ Ижил тогтмол `routes/compliance.ts`-д ДАВХАР бий — хоёулаа хөдлөнө.
 */
export const LINK_TRANSFORM_CAPABILITY_SHIPPED = false;

/* ================================================================== */
/*  1. DB мөр → `RuleDef`                                              */
/* ================================================================== */

/** `rules` (0221)-ийн БҮХ багана, D1-ийн буцаадаг түүхий хэлбэрээр. */
export interface RuleDbRow {
  id: number;
  rule_uid: string;
  version: number;
  semantic_hash: string;
  team_code: string | null;
  title_mn: string;
  title_en: string | null;
  document_uid: string | null;
  clause_uid: string | null;
  edition_ref: string | null;
  effective_from: string | null;
  verification_state: string;
  issue_class: string;
  severity: string;
  unit: string;
  coordinate_system: string;
  expect_applicable: number;
  requires_context_json: string;
  applicability_json: string;
  check_json: string;
  requires_params_json: string;
  requires_triggered_json: string;
  exceptions_json: string;
  recommendation_mn: string | null;
  status: string;
  authored_by: number | null;
  reviewed_by: number | null;
  reviewed_at: string | null;
  created_at: string;
}

/** `SELECT` -ийн багануудыг НЭГ газар — маршрут ба угсрагч хоёулаа энэ мөрийг хэрэглэнэ. */
export const RULE_COLUMNS = `id, rule_uid, version, semantic_hash, team_code, title_mn, title_en,
       document_uid, clause_uid, edition_ref, effective_from, verification_state,
       issue_class, severity, unit, coordinate_system, expect_applicable,
       requires_context_json, applicability_json, check_json, requires_params_json,
       requires_triggered_json, exceptions_json, recommendation_mn, status,
       authored_by, reviewed_by, reviewed_at, created_at`;

export interface ParsedRule {
  readonly def: RuleDef;
  /** Түүхий JSON бичвэрүүд — V5 (тооны профайл) тэднийг ЗАДЛАХЫН ӨМНӨ шалгана. */
  readonly rawApplicability: string;
  readonly rawCheck: string;
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function stringArray(raw: string): readonly string[] | null {
  const v = safeJson(raw);
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== 'string') return null;
    out.push(x);
  }
  return out;
}

function triggerArray(raw: string): readonly RuleTrigger[] | null {
  const v = safeJson(raw);
  if (!Array.isArray(v)) return null;
  const out: RuleTrigger[] = [];
  for (const x of v) {
    if (typeof x !== 'object' || x === null) return null;
    const o = x as Record<string, unknown>;
    const category = o['category'];
    const change = o['change'];
    if (typeof category !== 'string' || category.length === 0) return null;
    if (!isTriggerChange(change)) return null;
    out.push({ category, change });
  }
  return out;
}

function exceptionArray(raw: string): readonly RuleException[] | null {
  const v = safeJson(raw);
  if (!Array.isArray(v)) return null;
  const out: RuleException[] = [];
  for (const x of v) {
    if (typeof x !== 'object' || x === null) return null;
    const o = x as Record<string, unknown>;
    const code = o['code'];
    if (typeof code !== 'string' || !EXCEPTION_CODE_RE.test(code)) return null;
    const parsed = parsePredicate(o['when']);
    if (!parsed.ok) return null;
    const note = o['note_mn'];
    out.push({ code, when: parsed.node, noteMn: typeof note === 'string' ? note : null });
  }
  return out;
}

/** DB мөрийг `RuleDef` болгоно.  ЗАДЛАХ АЛДАА нь ШИДЭХГҮЙ — `null` буцаана. */
export function parseRuleRow(row: RuleDbRow): ParsedRule | null {
  if (!isVerificationState(row.verification_state)) return null;
  if (!isIssueClass(row.issue_class)) return null;
  if (!isSeverity(row.severity)) return null;
  if (!isUnit(row.unit)) return null;
  if (!isCoordinateSystem(row.coordinate_system)) return null;

  const requiresContext = stringArray(row.requires_context_json);
  const params = stringArray(row.requires_params_json);
  const triggeredBy = triggerArray(row.requires_triggered_json);
  const exceptions = exceptionArray(row.exceptions_json);
  if (!requiresContext || !params || !triggeredBy || !exceptions) return null;

  const rawApp = safeJson(row.applicability_json);
  const rawChk = safeJson(row.check_json);
  if (rawApp === undefined || rawChk === undefined) return null;

  let applicability: PredicateNode | null = null;
  if (!isEmptyObject(rawApp)) {
    const p = parsePredicate(rawApp);
    if (!p.ok) return null;
    applicability = p.node;
  }
  let check: CheckNode | null = null;
  if (!isEmptyObject(rawChk)) {
    const c = parseCheck(rawChk);
    if (!c.ok) return null;
    check = c.node;
  }

  const def: RuleDef = {
    ruleUid: row.rule_uid,
    version: row.version,
    semanticHash: row.semantic_hash,
    teamCode: row.team_code,
    titleMn: row.title_mn,
    titleEn: row.title_en,
    documentUid: row.document_uid,
    clauseUid: row.clause_uid,
    editionRef: row.edition_ref,
    effectiveFrom: row.effective_from,
    verificationState: row.verification_state,
    issueClass: row.issue_class,
    severity: row.severity,
    unit: row.unit,
    coordinateSystem: row.coordinate_system,
    expectApplicable: row.expect_applicable === 1,
    requiresContext,
    applicability,
    check,
    requires: { params, triggeredBy },
    exceptions,
    recommendationMn: row.recommendation_mn,
  };
  return { def, rawApplicability: row.applicability_json, rawCheck: row.check_json };
}

function isEmptyObject(v: unknown): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0;
}

/* ================================================================== */
/*  2. БАГЦ УГСРАХ ШАЛГУУРУУД V1–V11 — Хавсралт §10                    */
/* ================================================================== */

function collectNodes(parsed: ParsedRule): readonly CheckNode[] {
  const nodes: CheckNode[] = [];
  if (parsed.def.applicability) nodes.push(parsed.def.applicability);
  if (parsed.def.check) nodes.push(parsed.def.check);
  for (const ex of parsed.def.exceptions) nodes.push(ex.when);
  return nodes;
}

function leafList(node: CheckNode, out: CheckNode[]): void {
  switch (node.kind) {
    case 'all':
    case 'any':
      for (const c of node.children) leafList(c, out);
      return;
    case 'not':
      leafList(node.child, out);
      return;
    case 'cond':
      leafList(node.cond, out);
      leafList(node.then, out);
      leafList(node.otherwise, out);
      return;
    default:
      out.push(node);
  }
}

/**
 * V1–V11.  Буцах утга нь ХООСОН бол дүрэм багцад орох эрхтэй.
 * ⚠️ Хамгийн бага-давуу эрхийн журам: алдааны текст нь ЗОХИОГЧИД зориулсан,
 * инженерийн нүүр рүү харагдахгүй.
 */
export function validateRuleForPack(parsed: ParsedRule): readonly string[] {
  const errors: string[] = [];
  const def = parsed.def;

  // V5 — тоон литералын профайл (задлахын ӨМНӨХ бичвэр дээр).
  for (const raw of [parsed.rawApplicability, parsed.rawCheck]) {
    const bad = checkNumberProfileRaw(raw);
    if (bad) errors.push(`V5 ${bad}`);
  }

  // V1 — грамматик задлагдсан (parseRuleRow-д аль хэдийн), `cond` нь
  // `applicability`-д ХОРИОТОЙ (parsePredicate татгалзана).  Энд зөвхөн
  // exceptions[].when-ийг давхар шалгана.
  for (const ex of def.exceptions) {
    if (!EXCEPTION_CODE_RE.test(ex.code)) errors.push(`V1 exception code: ${ex.code}`);
  }

  const nodes = collectNodes(parsed);

  // V8 — зангилааны нийт тоо.
  let total = 0;
  for (const n of nodes) total += countNodes(n);
  if (total > MAX_NODES_PER_RULE) errors.push(`V8 зангилаа ${total} > ${MAX_NODES_PER_RULE}`);

  const leaves: CheckNode[] = [];
  for (const n of nodes) leafList(n, leaves);

  const usedFacts = new Set<string>();
  for (const leaf of leaves) {
    if (leaf.kind === 'all' || leaf.kind === 'any' || leaf.kind === 'not' || leaf.kind === 'cond') {
      continue;
    }
    usedFacts.add(leaf.fact);

    // V3 — баримтын нэр БҮРТГЭЛД байна.
    if (!lookupFact(leaf.fact)) errors.push(`V3 бүртгэлгүй баримт: ${leaf.fact}`);

    // V6 — `contains_any`-ийн needle бүр АЛЬ ХЭДИЙН хураагдсан.
    if (leaf.kind === 'containsAny') {
      if (leaf.needles.length > MAX_ARRAY_OPERANDS) errors.push('V8 needle хэт олон');
      for (const n of leaf.needles) {
        if (n.length > MAX_NEEDLE_LEN) errors.push(`V8 needle хэт урт: ${n}`);
        if (foldText(n) !== n) errors.push(`V6 хураагдаагүй needle: ${n}`);
      }
    }
    if ((leaf.kind === 'inNum' || leaf.kind === 'inText')) {
      const len = leaf.kind === 'inNum' ? leaf.nums.length : leaf.texts.length;
      if (len > MAX_ARRAY_OPERANDS) errors.push('V8 in хэт олон гишүүнтэй');
    }
  }

  // V4 — `project.*` / `doc.*` нэр бүр `requires_context`-д байна.
  const declaredContext = new Set(def.requiresContext);
  for (const f of usedFacts) {
    if (!f.startsWith('project.') && !f.startsWith('doc.')) continue;
    if (!declaredContext.has(f)) errors.push(`V4 requires_context дутуу: ${f}`);
  }

  // V9 — `element.*` нэр бүр (`element.category`-оос БУСАД) `requires.params`-д.
  //      ⚠️ `element.category` нь `collect_rule_inputs`-ээс ИРДЭГГҮЙ — түүнийг
  //      `params`-д бичих нь экстракторыг байхгүй параметр хайлгана.
  const declaredParams = new Set(def.requires.params);
  for (const f of usedFacts) {
    if (!f.startsWith('element.')) continue;
    if (f === 'element.category') continue;
    const local = f.slice('element.'.length);
    if (!declaredParams.has(local)) errors.push(`V9 requires.params дутуу: ${local}`);
  }

  // V7 — `unit <> 'NONE'` бол `check`-д тэр нэгжтэй ЯДАЖ НЭГ тоон навч.
  if (def.unit !== 'NONE' && def.check) {
    const checkLeaves: CheckNode[] = [];
    leafList(def.check, checkLeaves);
    const hit = checkLeaves.some(
      (l) =>
        (l.kind === 'cmp' || l.kind === 'between' || l.kind === 'inNum') &&
        unitForFactName(l.fact) === def.unit,
    );
    if (!hit) errors.push(`V7 unit=${def.unit} боловч тэр нэгжтэй тоон навч алга`);
  }

  // V11 — координатын хаалга.
  if (def.coordinateSystem !== 'none' && !LINK_TRANSFORM_CAPABILITY_SHIPPED) {
    errors.push('V11 coordinate_capability_missing');
  }

  return errors;
}

/** V10 — `semantic_hash` нь §6.4-өөр ДАХИН тооцоолоход мөрийнхтэй тэнцэнэ. */
export async function verifySemanticHash(row: RuleDbRow): Promise<boolean> {
  if (!isUnit(row.unit)) return false;
  try {
    const app = safeJson(row.applicability_json) ?? {};
    const chk = safeJson(row.check_json) ?? {};
    const h = await semanticHash(app, chk, row.unit);
    return h === row.semantic_hash;
  } catch {
    return false;
  }
}

/* ================================================================== */
/*  3. БАГЦЫН БИЕ                                                      */
/* ================================================================== */

/**
 * `PredicateNode` → УТСАН ДЭЭРХ JSON.  `parsePredicate`-ийн ЯГ УРВУУ.
 *
 * ⚠️ ЯАГААД ЗАДАЛСАН МОДООС ЦУВААРИЛНА, ТҮҮХИЙ БИЧВЭРЭЭС БИШ:
 * `applicability` / `check` нь `rawApplicability` / `rawCheck`-ээр дамждаг —
 * тэднийг V5 (`checkNumberProfileRaw`) ТҮҮХИЙ БИЧВЭР дээр шалгадаг.
 * `exceptions_json` нь V5-д ОРДОГГҮЙ, тиймээс түүхий дамжуулбал зохиогчийн
 * бичсэн дурын нэмэлт түлхүүр 20 компьютерийн `%APPDATA%` руу ЯВНА.  Задалсан
 * модоос цуваарилах нь ЗӨВХӨН баталгаажсан грамматикийг гаргана.
 *
 * ⚠️ ХОС ФАЙЛ: `complianceModel.ts`-ийн `parseNode` грамматик.  Тэнд оператор
 * нэмбэл ЭНД БАС нэмнэ — эс бөгөөс `when` нь клиент дээр задлагдахаа болино.
 */
export function predicateToWire(node: PredicateNode): Record<string, unknown> {
  switch (node.kind) {
    case 'all':
      return { all: node.children.map((c) => predicateToWire(c)) };
    case 'any':
      return { any: node.children.map((c) => predicateToWire(c)) };
    case 'not':
      return { not: predicateToWire(node.child) };
    case 'cmp':
      return { [node.fact]: { [node.op]: node.num } };
    case 'cmpText':
      return { [node.fact]: { [node.op]: node.text } };
    case 'between':
      return { [node.fact]: { between: [node.lo, node.hi] } };
    case 'inNum':
      return { [node.fact]: { in: [...node.nums] } };
    case 'inText':
      return { [node.fact]: { in: [...node.texts] } };
    case 'containsAny':
      return { [node.fact]: { contains_any: [...node.needles] } };
    case 'exists':
      return { [node.fact]: { exists: node.want } };
    default: {
      // ⚠️ Бүрэн байдлын хаалга — `PredicateNode`-д шинэ хэлбэр нэмэхэд
      //    ЭНЭ МӨР КОМПАЙЛ БОЛОХГҮЙ болно.  Чимээгүй `undefined` буцаахгүй.
      const never: never = node;
      throw new Error(`predicateToWire: танигдахгүй зангилаа ${JSON.stringify(never)}`);
    }
  }
}

/** ⚠️ `authored_by` / `reviewed_by` / `status` / `created_at` нь БАГЦАД
 *  ХЭЗЭЭ Ч ОРОХГҮЙ — хэрэглэгчийн id-г 20 компьютерийн `%APPDATA%`-д тавих нь
 *  ямар ч ашиггүй мэдээллийн задрал. */
export function ruleDefToWire(def: RuleDef, raw: ParsedRule): Record<string, unknown> {
  // ⚠️ UNVERIFIED нь ЭШЛЭЛИЙГ ДАРНА, зөвхөн ноцтой байдлыг БИШ (эзний шийдвэр).
  //    `clampByVerification`-ийн `suppressCitation` нь ГАРАЛТЫН талд ажилладаг
  //    ч эшлэл нь ДҮРМИЙН талбар — тиймээс түүнийг УТСАН ДЭЭР ГАРГАХГҮЙ.
  //    Байхгүй өгөгдлийг рендерлэх аргагүй: `2-5`-ийн рендерер бичигдэхээс
  //    ӨМНӨ хаалга барина.
  //    ⚠️ Хос хаалга: `RulePack.cs`-ийн `ParseRule` нь клиент дээр ДАХИН
  //    хоослоно (гараар засагдсан `%APPDATA%` багцын эсрэг).
  const cited = def.verificationState !== 'UNVERIFIED';
  return {
    rule_uid: def.ruleUid,
    version: def.version,
    team_code: def.teamCode,
    semantic_hash: def.semanticHash,
    title_mn: def.titleMn,
    title_en: def.titleEn,
    document_uid: cited ? def.documentUid : null,
    clause_uid: cited ? def.clauseUid : null,
    edition_ref: cited ? def.editionRef : null,
    effective_from: def.effectiveFrom,
    verification_state: def.verificationState,
    issue_class: def.issueClass,
    severity: def.severity,
    unit: def.unit,
    coordinate_system: def.coordinateSystem,
    expect_applicable: def.expectApplicable,
    requires_context: [...def.requiresContext],
    applicability: safeJson(raw.rawApplicability) ?? {},
    check: safeJson(raw.rawCheck) ?? {},
    requires: {
      params: [...def.requires.params],
      triggered_by: def.requires.triggeredBy.map((t) => ({ category: t.category, change: t.change })),
    },
    // ⚠️ `when` нь ЗААВАЛ — түүнгүйгээр `RuleEngine.cs` нь үл хамаарах зүйлийг
    //    АЛГАСААД (fail-open) дүрэм ил зөвшөөрсөн тохиолдлыг зөрчил гэж
    //    мэдээлнэ.  `RulePack.cs` одоо `when`-гүй үл хамаарах зүйлтэй БАГЦЫГ
    //    БҮХЭЛД НЬ ТАТГАЛЗАНА — тиймээс энэ мөрийг ХЭЗЭЭ Ч хасахгүй.
    exceptions: def.exceptions.map((e) => ({
      code: e.code,
      when: predicateToWire(e.when),
      note_mn: e.noteMn,
    })),
    recommendation_mn: def.recommendationMn,
  };
}

export function buildContextToWire(ctx: BuildContext | null): Record<string, unknown> {
  return {
    project_id: ctx?.projectId ?? 0,
    doc_uid: ctx?.docUid ?? '',
    height_m: ctx?.heightM ?? null,
    stories_above_grade: ctx?.storiesAboveGrade ?? null,
    stories_below_grade: ctx?.storiesBelowGrade ?? null,
    gross_area_m2: ctx?.grossAreaM2 ?? null,
    occupant_load: ctx?.occupantLoad ?? null,
    building_type: ctx?.buildingType ?? null,
    occupancy_class: ctx?.occupancyClass ?? null,
    grade_level_name: ctx?.gradeLevelName ?? null,
    top_level_name: ctx?.topLevelName ?? null,
    room_boundary_location: ctx?.roomBoundaryLocation ?? null,
    fire_safety_class: ctx?.fireSafetyClass ?? null,
    seismic_intensity: ctx?.seismicIntensity ?? null,
    project_phase: ctx?.projectPhase ?? null,
    jurisdiction: ctx?.jurisdiction ?? 'MN',
  };
}

/** ⚠️ V12 — хос бүр нормчлогдсон (`a < b` ordinal), `scope='intra_pack'` Л багцад. */
export function conflictsToWire(entries: readonly ConflictEntry[]): readonly Record<string, unknown>[] {
  return entries
    .filter((e) => e.scope === 'intra_pack')
    .map((e) => {
      const a = e.ruleUidA <= e.ruleUidB ? e.ruleUidA : e.ruleUidB;
      const b = e.ruleUidA <= e.ruleUidB ? e.ruleUidB : e.ruleUidA;
      return {
        rule_uid_a: a,
        rule_uid_b: b,
        conflict_kind: e.conflictKind,
        scope: e.scope,
        precedence: e.precedence,
        note_mn: e.noteMn,
      };
    });
}

export interface PackBuildInput {
  readonly teamCode: string;
  readonly rulesetVersion: string;
  readonly generatedAt: string;
  readonly context: BuildContext | null;
  readonly rules: readonly ParsedRule[];
  readonly conflicts: readonly ConflictEntry[];
}

export interface PackBuildResult {
  readonly body: Record<string, unknown>;
  /** НИЙТЛЭГДСЭН БАЙТ.  ⚠️ Сервер түүнийг ДАХИН ЦУВААРИЛАХГҮЙ — `body_json`-д
   *  ЯГ ЭНЭ мөрийг бичиж, `GET /pack` нь ЯГ ЭНЭ мөрийг буцаана. */
  readonly bodyJson: string;
  readonly packSha256: string;
  readonly ruleCount: number;
}

/**
 * Багцыг угсарч, §7.2-оор хэшлээд, НИЙТЛЭГДЭХ БАЙТЫГ буцаана.
 *
 * ⚠️ `generated_at` нь хэшид ОРОХГҮЙ (§7.3) — эс бөгөөс агуулгын хувьд ИЖИЛ
 * багцыг дахин үүсгэх бүрд шинэ hash гарч, төсөл бүрийн БҮХ олдвор
 * шалтгаангүйгээр хуучирна (`2-3`-ын `stale_reason='ruleset'`).
 */
export async function buildPack(input: PackBuildInput): Promise<PackBuildResult> {
  const rules = input.rules.map((r) => ruleDefToWire(r.def, r));
  const base: Record<string, unknown> = {
    pack_contract: PACK_CONTRACT,
    team_code: input.teamCode,
    ruleset_version: input.rulesetVersion,
    pack_sha256: '',
    generated_at: input.generatedAt,
    project_context: buildContextToWire(input.context),
    rules,
    conflicts: conflictsToWire(input.conflicts),
  };
  const sha = await packSha256(base);
  const body: Record<string, unknown> = { ...base, pack_sha256: sha };
  return {
    body,
    bodyJson: canonicalize(body),
    packSha256: sha,
    ruleCount: rules.length,
  };
}
