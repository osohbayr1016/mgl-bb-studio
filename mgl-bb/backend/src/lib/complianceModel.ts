/* =============================================================
 * complianceModel.ts — нийцлийн салангид ГУРВАН ТЭНХЛЭГ + баталгааны ХАВЧААР,
 * дүрмийн ГРАММАТИК, НЭГЖИЙН аюулгүй байдал, MGL-CANON-1 канончлол.
 * -------------------------------------------------------------
 * ⚠️ ЭНЭ ФАЙЛЫГ ОЛОН СЕСС ХУВААЛЦАНА.  Одоогийн агуулга нь `2-2-rule-model`-
 * ийнх (дүрэм / нэгж / грамматик / хавчаар).  ДАРААХ СЕССҮҮД ӨӨРИЙН
 * `export` блокоо ФАЙЛЫН ТӨГСГӨЛД НЭМНЭ, дээрхийг ХӨНДӨХГҮЙ:
 *     2-3  → олдворын гурван тэнхлэгийн серверийн туслахууд
 *     2-5  → нотолгоо / override
 *     2-7  → бэлэн байдлын тоолуур
 * `docs/bim-ai/README.md`-ийн «ЦУВАА» хүснэгт: 2-2 → 2-3 → 2-5 → 2-7.
 * ⚠️ ИЖИЛ `export const`-ыг ХОЁР УДАА зарлавал файл компайл БОЛОХГҮЙ —
 * нэмэхийн ӨМНӨ энэ блокийг бүтнээр нь уншина уу.
 *
 * ⚠️ ЭНЭ ФАЙЛ ЦЭВЭР: D1 БАЙХГҮЙ, Hono БАЙХГҮЙ, сүлжээ БАЙХГҮЙ, диск БАЙХГҮЙ.
 * `revit-mcp/addin/RuleEngine.cs` нь түүний C# хос — хоёулаа ЯГ ижил JSON
 * задалж, ЯГ ижил гурван утгат арифметик ажиллуулна.
 *
 * ⚠️ ГУРВАН ТЭНХЛЭГИЙГ ХЭЗЭЭ Ч НЭГТГЭХГҮЙ.
 *   verdict        — юу гарсан бэ            (v2 §40-R2, 4 утга)
 *   issue_class    — ямар төрлийн асуудал вэ (v2 §59-R3, 5 утга)
 *   evidence_level — хэр найдвартай вэ       (v2 §65-R2, 5 утга)
 * `TEAM_STANDARD` нь эзний R3-ыг ГАРАЛТАД харагдуулдаг цорын ганц утга:
 * багийн дотоод стандарт зөрчил ≠ норм зөрчил.
 *
 * ⚠️ `evidence_level` бол ГУРАВ ДАХЬ ангилал.  `assistant_examples.source_type`
 * (0215) ба `learning_events.provenance` (bimEvents.ts) хоёрыг ДАХИН
 * АШИГЛАХГҮЙ — тэр хоёр өөрсдөө ч зөрчилддөг бөгөөд репод хооронд нь
 * хөрвүүлэх функц БАЙХГҮЙ.
 * ============================================================= */

/* ================================================================== */
/*  1. ХААЛТТАЙ ТОЛИУД — §3.5                                          */
/* ================================================================== */

export const VERDICTS = ['PASS', 'WARNING', 'VIOLATION', 'UNCERTAIN'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const ISSUE_CLASSES = [
  'REGULATORY_VIOLATION',
  'MODEL_QUALITY',
  'PROJECT_INCOMPLETENESS',
  'TEAM_STANDARD',
  'UNKNOWN_NEEDS_REVIEW',
] as const;
export type IssueClass = (typeof ISSUE_CLASSES)[number];

export const EVIDENCE_LEVELS = [
  'RULE_BACKED',
  'MODEL_DERIVED',
  'HUMAN_VERIFIED',
  'AI_INFERRED',
  'UNKNOWN',
] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

export const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const VERIFICATION_STATES = ['UNVERIFIED', 'CLAUSE_CITED', 'HUMAN_VERIFIED'] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

export const RULE_STATUSES = ['draft', 'review', 'published', 'retired'] as const;
export type RuleStatus = (typeof RULE_STATUSES)[number];

export const UNITS = [
  'MM', 'M', 'M2', 'M3', 'DEG', 'PCT', 'COUNT', 'KG_M3', 'H', 'NONE',
] as const;
export type Unit = (typeof UNITS)[number];

export const COORDINATE_SYSTEMS = ['none', 'project', 'shared', 'survey'] as const;
export type CoordinateSystem = (typeof COORDINATE_SYSTEMS)[number];

/** `revit_element_touches.change`-тэй ИЖИЛ олонлог — `bimEvents.ts` `TOUCH_CHANGES`. */
export const TRIGGER_CHANGES = ['add', 'modify', 'delete'] as const;
export type TriggerChange = (typeof TRIGGER_CHANGES)[number];

export const HEIGHT_BASES = ['unknown', 'levels_diff', 'manual', 'proposed'] as const;
export type HeightBasis = (typeof HEIGHT_BASES)[number];

export const PROJECT_PHASES = ['concept', 'sketch', 'permit', 'working', 'asbuilt'] as const;
export type ProjectPhase = (typeof PROJECT_PHASES)[number];

export const BOUNDARY_LOCATIONS = ['Center', 'Finish', 'CoreCenter', 'CoreBoundary'] as const;
export type BoundaryLocation = (typeof BOUNDARY_LOCATIONS)[number];

export const CASE_CLASSES = [
  'threshold_minus', 'threshold', 'threshold_plus', 'zero', 'missing_input',
  'invalid_input', 'min_max', 'mixed_units', 'mixed_provenance', 'exception',
  'multi_rule', 'conflict', 'no_context', 'ordinary',
] as const;
export type CaseClass = (typeof CASE_CLASSES)[number];

/** ⚠️ `NOT_APPLICABLE` нь ТЕСТ КЕЙСийн хүлээлт болж Л оршино — олдворын
 *  мөр болж ХЭЗЭЭ Ч үүсэхгүй (§3.6, §9.4-13). */
export const EXPECT_VERDICTS = [...VERDICTS, 'NOT_APPLICABLE'] as const;
export type ExpectVerdict = (typeof EXPECT_VERDICTS)[number];

export const TEST_SOURCE_KINDS = ['authored', 'real_project', 'regression'] as const;
export type TestSourceKind = (typeof TEST_SOURCE_KINDS)[number];

export const CONFLICT_KINDS = [
  'threshold', 'applicability', 'unit', 'definition', 'cross_discipline',
] as const;
export type ConflictKind = (typeof CONFLICT_KINDS)[number];

export const CONFLICT_SCOPES = ['intra_pack', 'cross_discipline'] as const;
export type ConflictScope = (typeof CONFLICT_SCOPES)[number];

export const CONFLICT_PRECEDENCES = ['a_wins', 'b_wins', 'unknown'] as const;
export type ConflictPrecedence = (typeof CONFLICT_PRECEDENCES)[number];

export const CONFLICT_DETECTORS = ['human', 'authoring_check', 'verdict_stream'] as const;
export type ConflictDetector = (typeof CONFLICT_DETECTORS)[number];

/** `2-3` §3.8-ын хүснэгтээс хөлдөөв (Хавсралт §9.3). */
export const UNCERTAIN_REASONS = [
  'missing_input',
  'zero_vs_missing',
  'mixed_provenance',
  'mixed_units',
  'missing_context',
  'conflict',
] as const;
export type UncertainReason = (typeof UNCERTAIN_REASONS)[number];

/** Нэг дүгнэлтийн ноцтой байдлын дараалал — §67 ба §69-д хэрэглэнэ. */
export const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, INFO: 1,
};

/**
 * Нотолгооны итгэлийн дараалал (Хавсралт §9.4).  ⚠️ `Record<EvidenceLevel, …>`
 * нь ЗОРИУД — 6 дахь түвшин нэмбэл файл компайл БОЛОХГҮЙ.
 */
export const EVIDENCE_RANK: Record<EvidenceLevel, number> = {
  HUMAN_VERIFIED: 5,
  RULE_BACKED: 4,
  MODEL_DERIVED: 3,
  AI_INFERRED: 2,
  UNKNOWN: 1,
};

function isMember<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (list as readonly string[]).includes(v);
}

export const isVerdict = (v: unknown): v is Verdict => isMember(VERDICTS, v);
export const isIssueClass = (v: unknown): v is IssueClass => isMember(ISSUE_CLASSES, v);
export const isEvidenceLevel = (v: unknown): v is EvidenceLevel => isMember(EVIDENCE_LEVELS, v);
export const isSeverity = (v: unknown): v is Severity => isMember(SEVERITIES, v);
export const isVerificationState = (v: unknown): v is VerificationState =>
  isMember(VERIFICATION_STATES, v);
export const isUnit = (v: unknown): v is Unit => isMember(UNITS, v);
export const isCoordinateSystem = (v: unknown): v is CoordinateSystem =>
  isMember(COORDINATE_SYSTEMS, v);
export const isTriggerChange = (v: unknown): v is TriggerChange => isMember(TRIGGER_CHANGES, v);
export const isCaseClass = (v: unknown): v is CaseClass => isMember(CASE_CLASSES, v);
export const isExpectVerdict = (v: unknown): v is ExpectVerdict => isMember(EXPECT_VERDICTS, v);
export const isTestSourceKind = (v: unknown): v is TestSourceKind =>
  isMember(TEST_SOURCE_KINDS, v);
export const isConflictKind = (v: unknown): v is ConflictKind => isMember(CONFLICT_KINDS, v);
export const isConflictScope = (v: unknown): v is ConflictScope => isMember(CONFLICT_SCOPES, v);
export const isConflictPrecedence = (v: unknown): v is ConflictPrecedence =>
  isMember(CONFLICT_PRECEDENCES, v);
export const isProjectPhase = (v: unknown): v is ProjectPhase => isMember(PROJECT_PHASES, v);
export const isBoundaryLocation = (v: unknown): v is BoundaryLocation =>
  isMember(BOUNDARY_LOCATIONS, v);
export const isHeightBasis = (v: unknown): v is HeightBasis => isMember(HEIGHT_BASES, v);
export const isRuleStatus = (v: unknown): v is RuleStatus => isMember(RULE_STATUSES, v);

/* ================================================================== */
/*  2. БАТАЛГААНЫ ХАВЧААР — §3.5                                       */
/* ================================================================== */

/**
 * БАТАЛГААНЫ ХАВЧААР — v2 §35/§36-ын хууль эрх зүйн байрлалын хэрэгжилт.
 *
 * ⚠️ ЯАГААД ГУРВАН ЗҮЙЛИЙГ ЗЭРЭГ ХАВЧИХ ВЭ:
 *   `revit-mcp/CLAUDE.md:7-11` нь өөрийн тоонуудыг «design-guidance … verify
 *   each number against the current official БНбД / MNS» гэж зарласан.
 *   `eval/golden/rules.json` нь тэднийг golden болгохыг ХОРИГЛОСОН.  Ноцтой
 *   байдлыг л бууруулаад «БНбД 31-03» гэж хэвлэвэл архитектор баталгаажаагүй
 *   тоон дээр хонгил өргөсгөх зардал гаргах, эсвэл захиалагчид эшлэх эрсдэлтэй.
 *   Ноцтой байдал буурсан нь эшлэлийг мэргэжлийн батламж биш болгодоггүй.
 *
 * ⚠️ РЕЛИЗ N-Д ДҮРЭМ БҮР `UNVERIFIED` (эзний шийдвэр Ш4) тул энэ салаа нь
 *   ҮРГЭЛЖ ажиллана.  Тэр нь ЗӨВ — албан ёсны баримт ирээгүй байхад
 *   «VIOLATION» гэж хэлэх эрх БАЙХГҮЙ.
 */
export interface ClampInput {
  readonly verificationState: VerificationState;
  readonly rawVerdict: Verdict;
  readonly rawEvidence: EvidenceLevel;
  readonly severity: Severity;
}

export interface ClampOutput {
  readonly verdict: Verdict;
  readonly evidenceLevel: EvidenceLevel;
  readonly severity: Severity;
  /** true бол UI нь код/заалт/гарчиг ХАРУУЛАХГҮЙ. */
  readonly suppressCitation: boolean;
  readonly citationLabelMn: string | null;
}

/** UNVERIFIED дүрмийн эшлэлийг орлох бичвэр.  UI нь код/заалтын ОРОНД үүнийг л харуулна. */
export const UNVERIFIED_CITATION_MN = 'дотоод шалгуур (эх сурвалж баталгаажаагүй)';

export function clampByVerification(input: ClampInput): ClampOutput {
  if (input.verificationState === 'UNVERIFIED') {
    return {
      // (1) VIOLATION → WARNING.  PASS ба UNCERTAIN хэвээр.
      verdict: input.rawVerdict === 'VIOLATION' ? 'WARNING' : input.rawVerdict,
      // (2) нотолгоо нь загвараас гаргасан гэж албадана.
      evidenceLevel: 'MODEL_DERIVED',
      // (3) CRITICAL нь UNVERIFIED дүрмээс гарч ЧАДАХГҮЙ.
      severity: input.severity === 'CRITICAL' ? 'HIGH' : input.severity,
      suppressCitation: true,
      citationLabelMn: UNVERIFIED_CITATION_MN,
    };
  }
  return {
    verdict: input.rawVerdict,
    evidenceLevel: input.rawEvidence,
    severity: input.severity,
    suppressCitation: false,
    citationLabelMn: null,
  };
}

/* ================================================================== */
/*  3. БАРИМТЫН НЭР ба НЭГЖ — Хавсралт §1                              */
/* ================================================================== */

/** `^(project|doc|element)\.[a-z][a-z0-9_]{0,47}$` — ХОЁР ТАЛД ижил. */
export const FACT_NAME_RE = /^(project|doc|element)\.[a-z][a-z0-9_]{0,47}$/;

export const FACT_SCOPES = ['project', 'doc', 'element'] as const;
export type FactScope = (typeof FACT_SCOPES)[number];

export function isFactName(v: unknown): v is string {
  return typeof v === 'string' && FACT_NAME_RE.test(v);
}

/** `element.clear_width_mm` → `clear_width_mm`.  Угтваргүй нэрийг хэвээр буцаана. */
export function localFactName(name: string): string {
  const dot = name.indexOf('.');
  return dot < 0 ? name : name.slice(dot + 1);
}

/**
 * Хавсралт §1.2 — нэгж нь нэрийн ТӨГСГӨЛӨӨС уншигдана.
 * ⚠️ `element.ceiling_h_mm` нь `_h` БИШ, `_mm` — терминал суффикс ялна.
 * ⚠️ Суффиксгүй тоо = `NONE` (`project.stories_above_grade`), `COUNT` БИШ.
 */
const UNIT_SUFFIXES: readonly (readonly [string, Unit])[] = [
  ['_mm', 'MM'],
  ['_m', 'M'],
  ['_m2', 'M2'],
  ['_m3', 'M3'],
  ['_deg', 'DEG'],
  ['_pct', 'PCT'],
  ['_count', 'COUNT'],
  ['_kgm3', 'KG_M3'],
  ['_h', 'H'],
];

export function unitForFactName(name: string): Unit {
  const local = localFactName(name);
  let best: Unit = 'NONE';
  let bestLen = 0;
  for (const pair of UNIT_SUFFIXES) {
    const suffix = pair[0];
    if (suffix.length > bestLen && local.endsWith(suffix)) {
      best = pair[1];
      bestLen = suffix.length;
    }
  }
  return best;
}

export const FACT_KINDS = ['number', 'text'] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export const FACT_ORIGINS = [
  'context', 'doc_settings', 'dirty', 'builtin', 'param', 'computed',
] as const;
export type FactOrigin = (typeof FACT_ORIGINS)[number];

export interface FactSpec {
  /** Бүтэн нэр — `<scope>.<local>`. */
  readonly name: string;
  readonly scope: FactScope;
  readonly kind: FactKind;
  /** §1.2-ын алгоритмаас ГАРГАСАН — гараар бичихгүй. */
  readonly unit: Unit;
  readonly origin: FactOrigin;
  /** `text` төрлийн баримт fold-v1-ээр хураагдсан эсэх. */
  readonly folded: boolean;
}

function spec(
  name: string,
  scope: FactScope,
  kind: FactKind,
  origin: FactOrigin,
  folded = false,
): FactSpec {
  return { name, scope, kind, unit: unitForFactName(name), origin, folded };
}

/**
 * БАРИМТЫН БҮРТГЭЛ (Хавсралт §1.3).  Бүртгэлд БАЙХГҮЙ нэр нь багц угсрахад
 * ТАТГАЛЗАГДАНА (V3) — экстрактор ХААЛТТАЙ жагсаалт хэрэгжүүлнэ.
 *
 * ⚠️ ЭНЭ ЖАГСААЛТ БҮРЭН БИШ, БАС бүрэн байх ёсгүй.  Дүрмийн корпус зогссон
 * (эзний шийдвэр Ш4) тул энэ нь ХОЁР бүтэцийн темплейт дүрмийг хангах
 * ХАМГИЙН БАГА олонлог.  Шинэ дүрэм бичих бүрд мөр НЭМНЭ.
 *
 * ⚠️ `element.category` нь ЦОРЫН ГАНЦ `origin = 'dirty'` баримт — Revit
 * уншихаас ӨМНӨ мэдэгдэнэ, тэр нь `mayApply`-ийн хямд урьдчилсан шүүлтийг
 * боломжтой болгодог.  `param`/`computed` болгож зөөвөл дүрэм бүр элемент
 * болгон дээр `collect_rule_inputs` дуудуулна (§51-R3-ын шууд зөрчил).
 */
export const FACT_REGISTRY: readonly FactSpec[] = [
  spec('project.height_m', 'project', 'number', 'context'),
  spec('project.stories_above_grade', 'project', 'number', 'context'),
  spec('project.stories_below_grade', 'project', 'number', 'context'),
  spec('project.gross_area_m2', 'project', 'number', 'context'),
  spec('project.occupant_load', 'project', 'number', 'context'),
  spec('project.building_type', 'project', 'text', 'context'),
  spec('project.occupancy_class', 'project', 'text', 'context'),
  spec('project.project_phase', 'project', 'text', 'context'),
  spec('project.jurisdiction', 'project', 'text', 'context'),
  spec('project.fire_safety_class', 'project', 'text', 'context'),
  spec('project.seismic_intensity', 'project', 'text', 'context'),
  spec('doc.room_boundary_location', 'doc', 'text', 'doc_settings'),
  spec('element.category', 'element', 'text', 'dirty'),
  spec('element.name_folded', 'element', 'text', 'param', true),
  spec('element.length_m', 'element', 'number', 'builtin'),
  spec('element.clear_width_mm', 'element', 'number', 'computed'),
  spec('element.ceiling_h_mm', 'element', 'number', 'computed'),
];

const FACT_BY_NAME = new Map<string, FactSpec>(FACT_REGISTRY.map((f) => [f.name, f]));

/** ⚠️ `noUncheckedIndexedAccess` — индексийг шууд задлахгүй, ил lookup. */
export function lookupFact(name: string): FactSpec | null {
  return FACT_BY_NAME.get(name) ?? null;
}

/* ================================================================== */
/*  4. `FactValue` / `FactBag` — Хавсралт §4                           */
/* ================================================================== */

export const QUANTITY_SOURCES = [
  'builtin_geometry', 'typed_param', 'untyped_param', 'computed',
] as const;
export type QuantitySource = (typeof QUANTITY_SOURCES)[number];

export const isQuantitySource = (v: unknown): v is QuantitySource =>
  isMember(QUANTITY_SOURCES, v);

export type FactValue =
  | {
      readonly kind: 'number';
      readonly value: number;
      readonly unit: Unit;
      readonly source: QuantitySource;
      readonly specId: string | null;
    }
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'missing' };

export const FACT_MISSING: FactValue = { kind: 'missing' };

export interface FactResolution {
  readonly value: FactValue;
  /** `null` = хэвийн.  Бусад тохиолдолд дүгнэлт UNCERTAIN болно. */
  readonly problem: 'mixed_units' | 'mixed_provenance' | null;
}

export interface FactBag {
  /**
   * `<scope>.<local>` → утга.  БАЙХГҮЙ нэр нь `{kind:'missing'}` буцаана —
   * `undefined` ХЭЗЭЭ Ч буцахгүй.
   */
  resolve(name: string): FactResolution;
}

/**
 * ⚠️ ХӨРВҮҮЛЭЛТ ЗӨВШӨӨРӨГДӨХ НӨХЦӨЛ (`Quantity.ConversionAllowed`-ийн TS хос).
 * `builtin_geometry` / `computed`, эсвэл LENGTH/ANGLE spec-тэй `typed_param`.
 * `untyped_param` (Integer / Number / Text) нь ҮРГЭЛЖ таамаг — таамаглах эрхгүй.
 */
export function conversionAllowed(source: QuantitySource, specId: string | null): boolean {
  if (source === 'untyped_param') return false;
  if (source === 'typed_param') return typeof specId === 'string' && specId.length > 0;
  return true;
}

export interface FactBagInput {
  /** `project.*` — `BuildContext`-ээс. */
  readonly context?: BuildContext | null;
  /** АМЬД баримтын `doc.*` (`collect_rule_inputs`-ийн `doc` блок). */
  readonly doc?: Readonly<Record<string, FactValue>>;
  /** Тухайн элементийн `element.*` баримтууд, УГТВАРГҮЙ локал нэрээр. */
  readonly element?: Readonly<Record<string, FactValue>>;
  /** `DirtyElement.Category` — Revit уншихаас ӨМНӨ мэдэгдэх ЦОРЫН ГАНЦ баримт. */
  readonly dirtyCategory?: string | null;
}

function numFact(value: number | null, name: string): FactValue {
  if (value == null || !Number.isFinite(value)) return FACT_MISSING;
  return {
    kind: 'number',
    value,
    unit: unitForFactName(name),
    source: 'computed',
    specId: null,
  };
}

function textFact(value: string | null): FactValue {
  return value == null || value === '' ? FACT_MISSING : { kind: 'text', value };
}

function contextFact(ctx: BuildContext, local: string): FactValue {
  switch (local) {
    case 'height_m': return numFact(ctx.heightM, 'project.height_m');
    case 'stories_above_grade':
      return numFact(ctx.storiesAboveGrade, 'project.stories_above_grade');
    case 'stories_below_grade':
      return numFact(ctx.storiesBelowGrade, 'project.stories_below_grade');
    case 'gross_area_m2': return numFact(ctx.grossAreaM2, 'project.gross_area_m2');
    case 'occupant_load': return numFact(ctx.occupantLoad, 'project.occupant_load');
    case 'building_type': return textFact(ctx.buildingType);
    case 'occupancy_class': return textFact(ctx.occupancyClass);
    case 'project_phase': return textFact(ctx.projectPhase);
    case 'jurisdiction': return textFact(ctx.jurisdiction);
    case 'fire_safety_class': return textFact(ctx.fireSafetyClass);
    case 'seismic_intensity': return textFact(ctx.seismicIntensity);
    default: return FACT_MISSING;
  }
}

/**
 * ШИЙДЭХ ДАРААЛАЛ (Хавсралт §4.4, ХОЁР ТАЛД ИЖИЛ, өөрчилж БОЛОХГҮЙ):
 *   1. `element.category` → `DirtyElement.Category`
 *   2. `element.*`        → хариултын `facts[<uid>][<local>]`
 *   3. `doc.*`            → хариултын `doc[<local>]`  (АМЬД баримтын утга)
 *   4. `doc.*`            → `BuildContext`-ийн толин тусгал (авторлосон)
 *   5. `project.*`        → `BuildContext`
 *   —  аль нь ч биш      → `FACT_MISSING`
 *
 * ⚠️ АМЬД `doc.*` нь АВТОРЛОСОН толин тусгалыг ДАРНА (3 > 4).
 *
 * НЭГЖИЙН ТУЛГАЛТ нь ЭНД болно: `kind='number'` баримтын `unit` нь нэрнээс
 * гарсан нэгжтэй ЯГ таарах ёстой.  Зөрвөл `problem='mixed_units'` —
 * ЧИМЭЭГҮЙ ХӨРВҮҮЛЭЛТ БАЙХГҮЙ.  Эх үүсвэр зөрвөл `problem='mixed_provenance'`.
 */
export function createFactBag(input: FactBagInput): FactBag {
  const ctx = input.context ?? null;
  const doc = input.doc ?? {};
  const element = input.element ?? {};
  const dirtyCategory = input.dirtyCategory ?? null;

  function raw(name: string): FactValue {
    if (name === 'element.category') {
      const fromDirty = textFact(dirtyCategory);
      if (fromDirty.kind !== 'missing') return fromDirty;
    }
    const local = localFactName(name);
    if (name.startsWith('element.')) {
      return element[local] ?? FACT_MISSING;
    }
    if (name.startsWith('doc.')) {
      const live = doc[local];
      if (live && live.kind !== 'missing') return live;
      if (local === 'room_boundary_location' && ctx) return textFact(ctx.roomBoundaryLocation);
      return FACT_MISSING;
    }
    if (name.startsWith('project.') && ctx) return contextFact(ctx, local);
    return FACT_MISSING;
  }

  return {
    resolve(name: string): FactResolution {
      const value = raw(name);
      if (value.kind !== 'number') return { value, problem: null };
      if (value.unit !== unitForFactName(name)) {
        return { value: FACT_MISSING, problem: 'mixed_units' };
      }
      if (!conversionAllowed(value.source, value.specId)) {
        return { value: FACT_MISSING, problem: 'mixed_provenance' };
      }
      return { value, problem: null };
    },
  };
}

/** Утасны `{v, unit, src, spec, missing}` дугтуйг `FactValue` болгоно. */
export function factValueFromWire(raw: unknown): FactValue {
  if (raw === null || typeof raw !== 'object') return FACT_MISSING;
  const o = raw as Record<string, unknown>;
  if (o['missing'] === true) return FACT_MISSING;
  const v = o['v'];
  if (typeof v === 'string') return { kind: 'text', value: v };
  if (typeof v !== 'number' || !Number.isFinite(v)) return FACT_MISSING;
  const unit = isUnit(o['unit']) ? o['unit'] : 'NONE';
  const source = isQuantitySource(o['src']) ? o['src'] : 'computed';
  const specId = typeof o['spec'] === 'string' ? o['spec'] : null;
  return { kind: 'number', value: v, unit, source, specId };
}

/* ================================================================== */
/*  5. `BuildContext` — Хавсралт §3                                    */
/* ================================================================== */

/**
 * §61-ийн 12 оролт.  ⚠️ NULL нь «мэдэхгүй», «үгүй» БИШ — тэр ялгаа нь
 * `opensHighRiseDocumentSet` нь `false` биш `null` буцаадгийн БҮХ шалтгаан.
 * NULL → UNCERTAIN → PROJECT_INCOMPLETENESS баннер, ЧИМЭЭГҮЙ PASS БИШ.
 *
 * ⚠️ `2-3` нь энэ төрлийг `ProjectBuildContext` гэж нэрлэдэг (C# тал).
 * Хоёр нэр, НЭГ хэлбэр — гурав дахь нэр ЗОХИОХГҮЙ.
 */
export interface BuildContext {
  readonly projectId: number;
  /** `''` = «энэ төслийн БҮХ баримтад хамаарах анхдагч» (0223-ийн DEFAULT ''). */
  readonly docUid: string;

  readonly buildingType: string | null;
  readonly occupancyClass: string | null;
  readonly occupantLoad: number | null;
  readonly grossAreaM2: number | null;

  /** ⚠️ ЯЛГАВАР (дээд давхрын түвшин − газрын түвшний давхар), ҮНЭМЛЭХҮЙ БИШ. */
  readonly heightM: number | null;
  readonly heightBasis: HeightBasis;
  readonly gradeLevelName: string | null;
  readonly topLevelName: string | null;

  readonly storiesAboveGrade: number | null;
  readonly storiesBelowGrade: number | null;

  readonly jurisdiction: string;
  readonly projectPhase: ProjectPhase | null;
  readonly fireSafetyClass: string | null;
  readonly seismicIntensity: string | null;

  /** АВТОРЛОСОН утга.  АМЬД баримтын утга нь `doc.room_boundary_location`-оос
   *  ирж ҮҮНИЙГ ДАРНА (§4.4-ийн 3 > 4). */
  readonly roomBoundaryLocation: BoundaryLocation | null;

  /** ⚠️ v1-д ИЛЭРХИЙЛЛЭЭС ХАНДАХ БОЛОМЖГҮЙ — жагсаалтын оператор байхгүй. */
  readonly specialRequirements: readonly string[];
}

/** Контекст мөргүй төсөл — БҮХ талбар «мэдэхгүй». */
export function emptyBuildContext(projectId: number, docUid = ''): BuildContext {
  return {
    projectId,
    docUid,
    buildingType: null,
    occupancyClass: null,
    occupantLoad: null,
    grossAreaM2: null,
    heightM: null,
    heightBasis: 'unknown',
    gradeLevelName: null,
    topLevelName: null,
    storiesAboveGrade: null,
    storiesBelowGrade: null,
    jurisdiction: 'MN',
    projectPhase: null,
    fireSafetyClass: null,
    seismicIntensity: null,
    roomBoundaryLocation: null,
    specialRequirements: [],
  };
}

/* ================================================================== */
/*  6. ГРАММАТИК — Хавсралт §5                                         */
/* ================================================================== */

export const LEAF_OPS = [
  'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'contains_any', 'exists',
] as const;
export type LeafOp = (typeof LEAF_OPS)[number];

/** Харьцуулалтын EPS — ЗӨВХӨН eq / ne / in / between-ийн гишүүнчлэлд.
 *  ⚠️ Эрэмбийн операторууд (gt/gte/lt/lte) НЯГТ: P2 fixture (`height_m = 51`
 *  ЯГ → NOT_APPLICABLE) нь `gt`-ийн нягт байдлаас хамаарна. */
export const NUMERIC_EPSILON = 1e-9;

export const MAX_NODE_DEPTH = 8;
export const MAX_NODES_PER_RULE = 64;
export const MAX_ARRAY_OPERANDS = 32;
export const MAX_NEEDLE_LEN = 64;

export type LeafNode =
  | { readonly kind: 'cmp'; readonly fact: string; readonly op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'; readonly num: number }
  | { readonly kind: 'cmpText'; readonly fact: string; readonly op: 'eq' | 'ne'; readonly text: string }
  | { readonly kind: 'between'; readonly fact: string; readonly lo: number; readonly hi: number }
  | { readonly kind: 'inNum'; readonly fact: string; readonly nums: readonly number[] }
  | { readonly kind: 'inText'; readonly fact: string; readonly texts: readonly string[] }
  | { readonly kind: 'containsAny'; readonly fact: string; readonly needles: readonly string[] }
  | { readonly kind: 'exists'; readonly fact: string; readonly want: boolean };

export type PredicateNode =
  | LeafNode
  | { readonly kind: 'all'; readonly children: readonly PredicateNode[] }
  | { readonly kind: 'any'; readonly children: readonly PredicateNode[] }
  | { readonly kind: 'not'; readonly child: PredicateNode };

/** ⚠️ TS талд `else` нь `otherwise` (`else` нь түлхүүр үг).  Утсан дээр `"else"`
 *  ХЭВЭЭР.  `otherwise` нь ЗААВАЛ, сонголт БИШ — «else бичээгүй ⇒ чимээгүй
 *  PASS» гэсэн ангиллыг нээхгүйн тулд. */
export type CheckNode =
  | LeafNode
  | { readonly kind: 'all'; readonly children: readonly CheckNode[] }
  | { readonly kind: 'any'; readonly children: readonly CheckNode[] }
  | { readonly kind: 'not'; readonly child: CheckNode }
  | { readonly kind: 'cond'; readonly cond: PredicateNode; readonly then: CheckNode; readonly otherwise: CheckNode };

export type ParseResult<T> =
  | { readonly ok: true; readonly node: T }
  | { readonly ok: false; readonly error: string; readonly path: string };

const COMBINATOR_KEYS = new Set(['all', 'any', 'not', 'if', 'then', 'else']);

function fail<T>(error: string, path: string): ParseResult<T> {
  return { ok: false, error, path };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function numericLiteralOk(n: unknown): n is number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return false;
  if (Math.abs(n) >= 1e9) return false;
  const s = numberToCanonical(n);
  if (s === null) return false;
  return true;
}

/**
 * ЗАДЛАГЧ — ХЭЗЭЭ Ч ШИДЭХГҮЙ.  `%APPDATA%`-д гараар засагдсан багц нь
 * Revit-ийг унагах ёсгүй, ТАТГАЛЗАХ ёстой (`IntentModel.cs:311-312`-ийн хэв маяг).
 */
function parseNode(raw: unknown, path: string, depth: number, allowCond: boolean): ParseResult<CheckNode> {
  if (depth > MAX_NODE_DEPTH) return fail(`гүн ${MAX_NODE_DEPTH}-аас хэтэрсэн`, path);
  if (!isPlainObject(raw)) return fail('объект байх ёстой', path);

  const keys = Object.keys(raw);
  if (keys.length === 0) return fail('хоосон зангилаа', path);

  const first = keys[0];
  if (first === undefined) return fail('хоосон зангилаа', path);

  // Хослуулагч: `all` / `any` / `not` / `cond`
  if (keys.length === 1 && (first === 'all' || first === 'any')) {
    const arr = raw[first];
    if (!Array.isArray(arr)) return fail(`${first} нь цуваа байх ёстой`, path);
    const children: CheckNode[] = [];
    for (let i = 0; i < arr.length; i += 1) {
      const r = parseNode(arr[i], `${path}.${first}[${i}]`, depth + 1, allowCond);
      if (!r.ok) return r;
      children.push(r.node);
    }
    return { ok: true, node: { kind: first, children } };
  }
  if (keys.length === 1 && first === 'not') {
    const r = parseNode(raw['not'], `${path}.not`, depth + 1, allowCond);
    if (!r.ok) return r;
    return { ok: true, node: { kind: 'not', child: r.node } };
  }
  if (keys.includes('if') || keys.includes('then') || keys.includes('else')) {
    if (!allowCond) {
      // ⚠️ `applicability`-д `cond` ХОРИОТОЙ (Хавсралт §5.3).
      return fail('cond нь applicability-д зөвшөөрөгдөхгүй', path);
    }
    if (keys.length !== 3 || !keys.includes('if') || !keys.includes('then') || !keys.includes('else')) {
      return fail('cond нь ЯГ if/then/else гурвыг агуулна', path);
    }
    const ifr = parsePredicateAt(raw['if'], `${path}.if`, depth + 1);
    if (!ifr.ok) return ifr as ParseResult<CheckNode>;
    const thenr = parseNode(raw['then'], `${path}.then`, depth + 1, true);
    if (!thenr.ok) return thenr;
    const elser = parseNode(raw['else'], `${path}.else`, depth + 1, true);
    if (!elser.ok) return elser;
    return { ok: true, node: { kind: 'cond', cond: ifr.node, then: thenr.node, otherwise: elser.node } };
  }

  // Навч: ЯГ нэг түлхүүр, түлхүүр нь баримтын нэр.
  if (keys.length !== 1) return fail('навч нь ЯГ нэг түлхүүртэй байна', path);
  if (COMBINATOR_KEYS.has(first)) return fail(`${first} нь хасагдсан үг`, path);
  if (!isFactName(first)) return fail(`баримтын нэр хүчингүй: ${first}`, path);

  const opObj = raw[first];
  if (!isPlainObject(opObj)) return fail('операторын объект байх ёстой', path);
  const opKeys = Object.keys(opObj);
  if (opKeys.length !== 1) return fail('ЯГ нэг оператор байна', path);
  const op = opKeys[0];
  if (op === undefined || !isMember(LEAF_OPS, op)) return fail(`оператор танигдахгүй: ${op}`, path);
  const operand = opObj[op];
  const leafPath = `${path}.${first}.${op}`;

  switch (op) {
    case 'eq':
    case 'ne': {
      if (typeof operand === 'string') {
        return { ok: true, node: { kind: 'cmpText', fact: first, op, text: operand } };
      }
      if (!numericLiteralOk(operand)) return fail('операнд нь тоо эсвэл мөр байна', leafPath);
      return { ok: true, node: { kind: 'cmp', fact: first, op, num: operand } };
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (!numericLiteralOk(operand)) return fail('операнд нь тоо байх ёстой', leafPath);
      return { ok: true, node: { kind: 'cmp', fact: first, op, num: operand } };
    }
    case 'between': {
      if (!Array.isArray(operand) || operand.length !== 2) {
        return fail('between нь [lo, hi] цуваа', leafPath);
      }
      const lo = operand[0];
      const hi = operand[1];
      if (!numericLiteralOk(lo) || !numericLiteralOk(hi)) return fail('between нь тоон хос', leafPath);
      if (lo > hi) return fail('between: lo > hi', leafPath);
      return { ok: true, node: { kind: 'between', fact: first, lo, hi } };
    }
    case 'in': {
      if (!Array.isArray(operand) || operand.length === 0) return fail('in нь хоосон биш цуваа', leafPath);
      if (operand.length > MAX_ARRAY_OPERANDS) return fail('in нь хэт олон гишүүнтэй', leafPath);
      if (operand.every((x) => typeof x === 'string')) {
        return { ok: true, node: { kind: 'inText', fact: first, texts: operand as string[] } };
      }
      if (operand.every((x) => numericLiteralOk(x))) {
        return { ok: true, node: { kind: 'inNum', fact: first, nums: operand as number[] } };
      }
      return fail('in нь НЭГ ТӨРЛИЙН цуваа байна', leafPath);
    }
    case 'contains_any': {
      if (!Array.isArray(operand) || operand.length === 0) {
        return fail('contains_any нь хоосон биш мөрийн цуваа', leafPath);
      }
      if (operand.length > MAX_ARRAY_OPERANDS) return fail('contains_any хэт олон гишүүнтэй', leafPath);
      const needles: string[] = [];
      for (const x of operand) {
        if (typeof x !== 'string' || x.length === 0) return fail('needle нь хоосон биш мөр', leafPath);
        if (x.length > MAX_NEEDLE_LEN) return fail('needle хэт урт', leafPath);
        needles.push(x);
      }
      return { ok: true, node: { kind: 'containsAny', fact: first, needles } };
    }
    case 'exists': {
      if (typeof operand !== 'boolean') return fail('exists нь true/false', leafPath);
      return { ok: true, node: { kind: 'exists', fact: first, want: operand } };
    }
    default:
      return fail('оператор танигдахгүй', leafPath);
  }
}

function parsePredicateAt(raw: unknown, path: string, depth: number): ParseResult<PredicateNode> {
  const r = parseNode(raw, path, depth, false);
  if (!r.ok) return r;
  // `allowCond = false` тул `cond` зангилаа гарах боломжгүй — төрлийн нарийвчлал.
  return { ok: true, node: r.node as PredicateNode };
}

export function parsePredicate(raw: unknown): ParseResult<PredicateNode> {
  return parsePredicateAt(raw, '$', 1);
}

export function parseCheck(raw: unknown): ParseResult<CheckNode> {
  return parseNode(raw, '$', 1, true);
}

/** `{}` = «үргэлж хамаарна» / «шалгах юмгүй» (Хавсралт §5.6). */
export function isEmptyExpression(raw: unknown): boolean {
  return isPlainObject(raw) && Object.keys(raw).length === 0;
}

export function countNodes(node: CheckNode): number {
  switch (node.kind) {
    case 'all':
    case 'any': {
      let n = 1;
      for (const c of node.children) n += countNodes(c);
      return n;
    }
    case 'not':
      return 1 + countNodes(node.child);
    case 'cond':
      return 1 + countNodes(node.cond) + countNodes(node.then) + countNodes(node.otherwise);
    default:
      return 1;
  }
}

/** Илэрхийлэлд гарч буй БҮХ баримтын нэр — ordinal эрэмбэлсэн, давхардалгүй. */
export function factNamesOf(node: CheckNode): readonly string[] {
  const out = new Set<string>();
  const walk = (n: CheckNode): void => {
    switch (n.kind) {
      case 'all':
      case 'any':
        for (const c of n.children) walk(c);
        return;
      case 'not':
        walk(n.child);
        return;
      case 'cond':
        walk(n.cond);
        walk(n.then);
        walk(n.otherwise);
        return;
      default:
        out.add(n.fact);
    }
  };
  walk(node);
  return [...out].sort();
}

/* ================================================================== */
/*  7. ГУРВАН УТГАТ ҮНЭЛГЭЭ — Хавсралт §5.5, §5.7                      */
/* ================================================================== */

export const TRI_FALSE = 0;
export const TRI_UNKNOWN = 1;
export const TRI_TRUE = 2;
export type Tri = 0 | 1 | 2;

/** ⚠️ min / max / 2−x нь Kleene-ийн логиктой ЯГ ТЭНЦҮҮ.  C# тал ижил арифметик. */
export const triAll = (children: readonly Tri[]): Tri =>
  (children.length === 0 ? TRI_TRUE : (Math.min(...children) as Tri));
export const triAny = (children: readonly Tri[]): Tri =>
  (children.length === 0 ? TRI_FALSE : (Math.max(...children) as Tri));
export const triNot = (x: Tri): Tri => ((2 - x) as Tri);

export interface NodeEval {
  readonly tri: Tri;
  /** §5.7 — `ObservedValue` / `ThresholdValue`-ыг бөглөх ЦОРЫН ГАНЦ эх сурвалж. */
  readonly decidingLeaf: LeafNode | null;
  /**
   * ҮР ДҮНГ ЗААВАЛ БЛОКЛОЖ БУЙ баримтын нэрс — ordinal эрэмбэлсэн, БҮТЭН.
   * ⚠️ Шийдэгдсэн салаан доторх `Unknown` навч ЭНД ОРОХГҮЙ (`any[TRUE,
   * UNKNOWN]` нь TRUE — тэнд дутуу оролт мэдээлэх нь ХУДАЛ дохио).
   */
  readonly unknownFacts: readonly string[];
  readonly problems: readonly UncertainReason[];
}

interface EvalAcc {
  readonly bag: FactBag;
  readonly unknown: Set<string>;
  readonly problems: Set<UncertainReason>;
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= NUMERIC_EPSILON;
}

function evalLeaf(node: LeafNode, acc: EvalAcc): Tri {
  const res = acc.bag.resolve(node.fact);
  if (res.problem) acc.problems.add(res.problem);
  const v = res.value;

  if (node.kind === 'exists') {
    // ⚠️ `exists` нь `Missing`-ийг ТОДОРХОЙ буль болгодог ЦОРЫН ГАНЦ оператор.
    const present = v.kind !== 'missing';
    return present === node.want ? TRI_TRUE : TRI_FALSE;
  }

  if (v.kind === 'missing') {
    acc.unknown.add(node.fact);
    return TRI_UNKNOWN;
  }

  switch (node.kind) {
    case 'cmp': {
      if (v.kind !== 'number') {
        acc.unknown.add(node.fact);
        return TRI_UNKNOWN;
      }
      switch (node.op) {
        case 'eq': return nearlyEqual(v.value, node.num) ? TRI_TRUE : TRI_FALSE;
        case 'ne': return nearlyEqual(v.value, node.num) ? TRI_FALSE : TRI_TRUE;
        case 'gt': return v.value > node.num ? TRI_TRUE : TRI_FALSE;
        case 'gte': return v.value >= node.num ? TRI_TRUE : TRI_FALSE;
        case 'lt': return v.value < node.num ? TRI_TRUE : TRI_FALSE;
        case 'lte': return v.value <= node.num ? TRI_TRUE : TRI_FALSE;
        default: return TRI_UNKNOWN;
      }
    }
    case 'cmpText': {
      if (v.kind !== 'text') {
        acc.unknown.add(node.fact);
        return TRI_UNKNOWN;
      }
      const same = v.value === node.text;
      return (node.op === 'eq' ? same : !same) ? TRI_TRUE : TRI_FALSE;
    }
    case 'between': {
      if (v.kind !== 'number') {
        acc.unknown.add(node.fact);
        return TRI_UNKNOWN;
      }
      const inside =
        (v.value > node.lo || nearlyEqual(v.value, node.lo)) &&
        (v.value < node.hi || nearlyEqual(v.value, node.hi));
      return inside ? TRI_TRUE : TRI_FALSE;
    }
    case 'inNum': {
      if (v.kind !== 'number') {
        acc.unknown.add(node.fact);
        return TRI_UNKNOWN;
      }
      const value = v.value;
      return node.nums.some((n) => nearlyEqual(value, n)) ? TRI_TRUE : TRI_FALSE;
    }
    case 'inText': {
      if (v.kind !== 'text') {
        acc.unknown.add(node.fact);
        return TRI_UNKNOWN;
      }
      const value = v.value;
      return node.texts.some((t) => t === value) ? TRI_TRUE : TRI_FALSE;
    }
    case 'containsAny': {
      if (v.kind !== 'text') {
        acc.unknown.add(node.fact);
        return TRI_UNKNOWN;
      }
      // ⚠️ Needle-ууд БАГЦАД АЛЬ ХЭДИЙН хураагдсан — хөдөлгүүр `TextFold`-д
      //    ХҮРЭХГҮЙ (тав дахь хуулбар үүсгэхгүй).
      const value = v.value;
      return node.needles.some((n) => value.includes(n)) ? TRI_TRUE : TRI_FALSE;
    }
    default:
      return TRI_UNKNOWN;
  }
}

interface InnerEval {
  tri: Tri;
  leaf: LeafNode | null;
  /**
   * ⚠️ ЗААВАЛ БЛОКЛОЖ БУЙ баримтууд, ҮНЭЛЭГДСЭН БҮХ баримт БИШ.
   * Шийдэгдсэн салаан доторх `Unknown` навч нь үр дүнг БЛОКЛОДОГГҮЙ тул
   * `missing[]`-д ОРОХГҮЙ: `any[TRUE, UNKNOWN]` нь TRUE, тэнд «дутуу оролт»
   * гэж мэдээлэх нь `2-5`-ийн PROJECT_INCOMPLETENESS баннерыг худал асаана.
   */
  blocking: readonly string[];
}

const NO_BLOCK: readonly string[] = [];

function mergeBlocking(parts: readonly (readonly string[])[]): readonly string[] {
  const out = new Set<string>();
  for (const p of parts) for (const f of p) out.add(f);
  return [...out];
}

function evalNode(node: CheckNode, acc: EvalAcc, depth: number): InnerEval {
  // ⚠️ Гүйцэтгэгч дотор гүний тоолуур ДАВХАР байна: хэтэрвэл `Unknown`
  //    буцаана, ШИДЭХГҮЙ — гараар засагдсан файл Revit-ийг унагахгүй.
  if (depth > MAX_NODE_DEPTH) return { tri: TRI_UNKNOWN, leaf: null, blocking: NO_BLOCK };

  switch (node.kind) {
    case 'all': {
      const tris: Tri[] = [];
      const blocks: (readonly string[])[] = [];
      let firstFalse: LeafNode | null = null;
      for (const c of node.children) {
        const r = evalNode(c, acc, depth + 1);
        tris.push(r.tri);
        if (r.tri === TRI_UNKNOWN) blocks.push(r.blocking);
        if (r.tri === TRI_FALSE && firstFalse === null) firstFalse = r.leaf;
      }
      const tri = triAll(tris);
      return {
        tri,
        leaf: tri === TRI_FALSE ? firstFalse : null,
        blocking: tri === TRI_UNKNOWN ? mergeBlocking(blocks) : NO_BLOCK,
      };
    }
    case 'any': {
      const tris: Tri[] = [];
      const blocks: (readonly string[])[] = [];
      let firstTrue: LeafNode | null = null;
      for (const c of node.children) {
        const r = evalNode(c, acc, depth + 1);
        tris.push(r.tri);
        if (r.tri === TRI_UNKNOWN) blocks.push(r.blocking);
        if (r.tri === TRI_TRUE && firstTrue === null) firstTrue = r.leaf;
      }
      const tri = triAny(tris);
      return {
        tri,
        leaf: tri === TRI_TRUE ? firstTrue : null,
        blocking: tri === TRI_UNKNOWN ? mergeBlocking(blocks) : NO_BLOCK,
      };
    }
    case 'not': {
      const r = evalNode(node.child, acc, depth + 1);
      // ⚠️ Үгүйсгэл нь босгын утгыг эсрэгээр уншуулна → `decidingLeaf = null`.
      return { tri: triNot(r.tri), leaf: null, blocking: r.blocking };
    }
    case 'cond': {
      const c = evalNode(node.cond, acc, depth + 1);
      // ⚠️ `Unknown` нөхцөл дээр ХОЁУЛАНГ НЬ ҮНЭЛЭХГҮЙ.  Хатуу салааг сонгох нь
      //    зохиомол шаардлага, зөөлнийг сонгох нь ХУДАЛ PASS — хоёул хориотой.
      if (c.tri === TRI_UNKNOWN) return { tri: TRI_UNKNOWN, leaf: null, blocking: c.blocking };
      const branch = c.tri === TRI_TRUE ? node.then : node.otherwise;
      return evalNode(branch, acc, depth + 1);
    }
    default: {
      const tri = evalLeaf(node, acc);
      return { tri, leaf: node, blocking: tri === TRI_UNKNOWN ? [node.fact] : NO_BLOCK };
    }
  }
}

export function evaluateNode(node: CheckNode, bag: FactBag): NodeEval {
  const acc: EvalAcc = { bag, unknown: new Set<string>(), problems: new Set<UncertainReason>() };
  const r = evalNode(node, acc, 1);
  return {
    tri: r.tri,
    decidingLeaf: r.leaf,
    unknownFacts: [...r.blocking].sort(),
    problems: [...acc.problems].sort(),
  };
}

/**
 * §5.7-ийн ТАЙЛАГНАХ ДҮРЭМ — ГУРВЫГ хангавал Л утга бөглөгдөнө:
 *   (1) навч нь тоон,
 *   (2) операторыг нь gt/gte/lt/lte/between/eq/ne,
 *   (3) баримтын нэгж нь `rule.unit`-тай ЯГ тэнцүү.
 * Эс бөгөөс ХОЁУЛАА `null`.  ТААМАГЛАХГҮЙ.
 */
export interface DecisionValues {
  readonly observed: number | null;
  readonly threshold: number | null;
}

export function decisionValues(
  leaf: LeafNode | null,
  bag: FactBag,
  ruleUnit: Unit,
): DecisionValues {
  const none: DecisionValues = { observed: null, threshold: null };
  if (!leaf) return none;
  if (leaf.kind !== 'cmp' && leaf.kind !== 'between') return none;
  if (unitForFactName(leaf.fact) !== ruleUnit) return none;
  const res = bag.resolve(leaf.fact);
  if (res.value.kind !== 'number') return none;
  const observed = res.value.value;
  if (leaf.kind === 'cmp') return { observed, threshold: leaf.num };
  // `between` — зөрчсөн тал нь босго.
  const threshold = observed < leaf.lo ? leaf.lo : leaf.hi;
  return { observed, threshold };
}

/* ================================================================== */
/*  8. ХАМААРЛЫН ҮР ДҮН — Хавсралт §9.1                                */
/* ================================================================== */

/**
 * ⚠️ `NOT_APPLICABLE` нь МӨР БОЛЖ ХЭЗЭЭ Ч ҮҮСЭХГҮЙ.  Тэр нь ХАМААРЛЫН ҮР
 * ДҮН, дүгнэлт БИШ (§61: «Only after applicability is established should the
 * rule be executed»).  ГэхДЭЭ `rule_run_ledger`-т (2-3) тоологдоно — эс тэгвэл
 * «дүрэм ажиллаагүй» ба «загвар цэвэр» хоёр ЯЛГАГДАХГҮЙ.
 */
export type Applicability =
  | { readonly kind: 'APPLICABLE' }
  | { readonly kind: 'NOT_APPLICABLE'; readonly reason: string }
  | { readonly kind: 'UNCERTAIN'; readonly missing: readonly string[] };

/** ХААЛТТАЙ толь — хос файлын тулгалт (`check_rules.py --parity`) үүн дээр зогсоно. */
export const APPLICABILITY_REASONS = [
  'high_rise_gate',
  'boundary_location',
  'category',
  'name',
  'context',
] as const;
export type ApplicabilityReason = (typeof APPLICABILITY_REASONS)[number];

/* ================================================================== */
/*  9. MGL-CANON-1 — Хавсралт §6                                       */
/* ================================================================== */

/**
 * ТООНЫ ПРОФАЙЛ (C6).  ЗӨВШӨӨРӨГДӨХ: төгсгөлөг, |x| < 1e9, аравтын
 * бутархайн ХАМГИЙН ИХ 6 орон, экспоненциал бичиглэлгүй.
 * Тэр туузан дотор binary64 нь ЯГ давхар хөрвөнө — ES `Number#toString`,
 * .NET-ийн хамгийн богино дугуйруулалт хоёул ижил мөр гаргана.
 * Хязгаараас гадуурх тоо нь ДУГУЙРУУЛАГДАХГҮЙ, ТАТГАЛЗАГДАНА (`null`).
 */
export function numberToCanonical(n: number): string | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  if (Math.abs(n) >= 1e9) return null;
  const s = Object.is(n, -0) ? '0' : String(n);
  if (s.includes('e') || s.includes('E')) return null;
  const dot = s.indexOf('.');
  if (dot >= 0 && s.length - dot - 1 > 6) return null;
  return s;
}

const CANON_ESCAPES: Readonly<Record<string, string>> = {
  '"': '\\"',
  '\\': '\\\\',
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
};

/** C4 — хамгийн богино JSON escape, ASCII-аас гадуур escape ХИЙХГҮЙ. */
function canonString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i += 1) {
    const ch = s.charAt(i);
    const esc = CANON_ESCAPES[ch];
    if (esc !== undefined) {
      out += esc;
      continue;
    }
    const code = s.charCodeAt(i);
    if (code < 0x20) {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
      continue;
    }
    out += ch;
  }
  return `${out}"`;
}

export class CanonError extends Error {}

/**
 * MGL-CANON-1 = RFC 8785 (JCS) + §6.3-ын тооны профайл.
 * C1 зайгүй · C2 түлхүүр ordinal эрэмбэ · C3 цувааны дараалал ХЭВЭЭР ·
 * C4 хамгийн богино escape · C5 гурван литерал · C6 тоо · C7 BOM-гүй UTF-8.
 *
 * ⚠️ Профайлаас гарсан тоо тааралдвал ШИДНЭ — дугуйруулж «засахгүй».
 * Дуудагч нь V5 шалгуурын алдаа болгож барина.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    const s = numberToCanonical(value);
    if (s === null) throw new CanonError(`тоо профайлаас гадуур: ${String(value)}`);
    return s;
  }
  if (typeof value === 'string') return canonString(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v)).join(',')}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    const parts: string[] = [];
    for (const k of keys) {
      parts.push(`${canonString(k)}:${canonicalize(value[k])}`);
    }
    return `{${parts.join(',')}}`;
  }
  throw new CanonError(`канончлох боломжгүй төрөл: ${typeof value}`);
}

/**
 * V5 — ТҮҮХИЙ JSON бичвэр дэх тоон литерал бүр §6.3-ын профайлд багтах эсэх.
 * ⚠️ `JSON.parse`-ын ДАРАА шалгах нь `1e3` (экспонент) -ыг барьж ЧАДАХГҮЙ:
 * тэр нь 1000 болж задардаг.  Тиймээс задлахын ӨМНӨ бичвэр дээр шалгана.
 */
export function checkNumberProfileRaw(rawJson: string): string | null {
  const re = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  let inString = false;
  let escaped = false;
  // Мөрийн литерал доторх тоог алгасахын тулд эхлээд мөрүүдийг хоослоно.
  let masked = '';
  for (let i = 0; i < rawJson.length; i += 1) {
    const ch = rawJson.charAt(i);
    if (inString) {
      masked += ' ';
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      masked += ' ';
      continue;
    }
    masked += ch;
  }
  for (const m of masked.matchAll(re)) {
    const text = m[0];
    if (text.includes('e') || text.includes('E')) return `экспонент хориотой: ${text}`;
    const dot = text.indexOf('.');
    if (dot >= 0 && text.length - dot - 1 > 6) return `6-аас олон аравтын орон: ${text}`;
    const n = Number(text);
    if (!Number.isFinite(n) || Math.abs(n) >= 1e9) return `хязгаараас гадуур: ${text}`;
  }
  return null;
}

const HEX = '0123456789abcdef';

function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i] ?? 0;
    out += HEX.charAt(b >> 4) + HEX.charAt(b & 0x0f);
  }
  return out;
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  // eslint-disable-next-line no-undef
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return toHex(digest);
}

/**
 * §6.4 — `semantic_hash`.
 *
 * ```
 * bytes = UTF8(MGL_CANON_1(applicability)) ‖ UTF8(MGL_CANON_1(check)) ‖ ASCII(unit)
 * ```
 *
 * Тусгаарлагч БАЙХГҮЙ.  ХООСОН нь `{}` гэж канончлогдоно (`""` БИШ).
 *
 * ⚠️ ХЭШИЙН ГАДНА үлдэх нь: `rule_uid`, `version`, `team_code`, гарчиг,
 * `severity`, `issue_class`, `clause_uid`, `recommendation_mn`, `requires`,
 * `exceptions`.  `semantic_hash` нь ЛОГИКИЙГ нэрлэнэ; `(rule_uid, version)`
 * нь МӨРИЙГ нэрлэнэ.
 */
export async function semanticHash(
  applicability: unknown,
  check: unknown,
  unit: Unit,
): Promise<string> {
  const a = canonicalize(applicability ?? {});
  const c = canonicalize(check ?? {});
  return sha256Hex(`${a}${c}${unit}`);
}

/**
 * §7.2 — `pack_sha256`.  ЯГ ХОЁР гишүүнийг ХООСОН МӨР болгож солино
 * (`pack_sha256`, `generated_at`), гишүүнийг УСТГАХГҮЙ — түлхүүрийн олонлог
 * ХЭВЭЭР.  `generated_at`-ыг хасах нь `2-3`-ын `stale_reason='ruleset'`
 * хуучруулалтыг ажиллах чадвартай байлгах ШААРДЛАГА.
 */
export async function packSha256(body: Record<string, unknown>): Promise<string> {
  const masked: Record<string, unknown> = { ...body, pack_sha256: '', generated_at: '' };
  return sha256Hex(canonicalize(masked));
}

/* ================================================================== */
/*  10. `RuleDef` / `RuleRow` — Хавсралт §2                            */
/* ================================================================== */

export interface RuleTrigger {
  /** Revit-ийн категорийн ЭХ нэр — ОРЧУУЛАХГҮЙ. */
  readonly category: string;
  readonly change: TriggerChange;
}

export interface RuleRequires {
  /** element scope-ын ЛОКАЛ нэрс (УГТВАРГҮЙ) — §1.1. */
  readonly params: readonly string[];
  /** ХООСОН бол дүрэм зөвхөн БҮТЭН СКАН дээр ажиллана. */
  readonly triggeredBy: readonly RuleTrigger[];
}

export interface RuleException {
  /** `^[a-z0-9_]{1,32}$` — `skipped_reason = 'exception:' + code`. */
  readonly code: string;
  /** ХАМААРЛЫН фазад үнэлэгдэнэ.  TRUE бол дүрэм NOT_APPLICABLE. */
  readonly when: PredicateNode;
  readonly noteMn: string | null;
}

export const EXCEPTION_CODE_RE = /^[a-z0-9_]{1,32}$/;

export interface RuleDef {
  readonly ruleUid: string;
  readonly version: number;
  readonly semanticHash: string;
  /** `null` = БҮХ КОМПАНИД (global scope). */
  readonly teamCode: string | null;

  readonly titleMn: string;
  readonly titleEn: string | null;

  readonly documentUid: string | null;
  readonly clauseUid: string | null;
  readonly editionRef: string | null;
  readonly effectiveFrom: string | null;

  readonly verificationState: VerificationState;
  readonly issueClass: IssueClass;
  readonly severity: Severity;

  readonly unit: Unit;
  /** Релиз N-д ҮРГЭЛЖ `'none'` — §3.11-ийн нийтлэх хаалга. */
  readonly coordinateSystem: CoordinateSystem;

  readonly expectApplicable: boolean;
  /** `project.*` / `doc.*` БҮТЭН нэрс. */
  readonly requiresContext: readonly string[];

  /** `null` = «үргэлж хамаарна» (§5.6). */
  readonly applicability: PredicateNode | null;
  /** `null` = «шалгах юмгүй» → олдвор ҮҮСГЭХГҮЙ (§5.6). */
  readonly check: CheckNode | null;

  readonly requires: RuleRequires;
  readonly exceptions: readonly RuleException[];
  readonly recommendationMn: string | null;
}

/** ЗӨВХӨН СЕРВЕР.  Багцад ХЭЗЭЭ Ч ЯВАХГҮЙ гишүүд. */
export interface RuleRow extends RuleDef {
  readonly id: number;
  readonly status: RuleStatus;
  readonly authoredBy: number | null;
  readonly reviewedBy: number | null;
  readonly reviewedAt: string | null;
  readonly createdAt: string;
}

/* ================================================================== */
/*  11. `ConflictTable` — Хавсралт §8                                  */
/* ================================================================== */

export interface ConflictEntry {
  /** ordinal-аар `ruleUidB`-ээс БАГА. */
  readonly ruleUidA: string;
  readonly ruleUidB: string;
  readonly conflictKind: ConflictKind;
  readonly scope: ConflictScope;
  /** `null` = «мэдэгдэхгүй» — v2 §64-ийн «hierarchy/priority IF KNOWN». */
  readonly precedence: ConflictPrecedence | null;
  readonly noteMn: string | null;
}

/** ⚠️ Хос нь ordinal-аар нормчлогдоно — `(a,b)` ба `(b,a)` НЭГ л түлхүүр. */
export function normalizeConflictPair(a: string, b: string): readonly [string, string] {
  return a <= b ? [a, b] : [b, a];
}

function pairKey(a: string, b: string): string {
  const p = normalizeConflictPair(a, b);
  return `${p[0]} ${p[1]}`;
}

export interface ConflictTable {
  has(ruleUidA: string, ruleUidB: string): boolean;
  get(ruleUidA: string, ruleUidB: string): ConflictEntry | null;
  partnersOf(ruleUid: string): readonly string[];
  readonly size: number;
}

export function buildConflictTable(entries: readonly ConflictEntry[]): ConflictTable {
  const byPair = new Map<string, ConflictEntry>();
  const partners = new Map<string, Set<string>>();
  for (const e of entries) {
    const p = normalizeConflictPair(e.ruleUidA, e.ruleUidB);
    const normalized: ConflictEntry = { ...e, ruleUidA: p[0], ruleUidB: p[1] };
    byPair.set(pairKey(p[0], p[1]), normalized);
    const addPartner = (from: string, to: string): void => {
      const set = partners.get(from) ?? new Set<string>();
      set.add(to);
      partners.set(from, set);
    };
    addPartner(p[0], p[1]);
    addPartner(p[1], p[0]);
  }
  return {
    has: (a, b) => byPair.has(pairKey(a, b)),
    get: (a, b) => byPair.get(pairKey(a, b)) ?? null,
    partnersOf: (uid) => [...(partners.get(uid) ?? new Set<string>())].sort(),
    get size() {
      return byPair.size;
    },
  };
}

/* ================================================================== */
/*  12. ЗӨРЧИЛДӨӨНИЙГ ЭВЛЭРҮҮЛЭХ — Хавсралт §8.4                       */
/* ================================================================== */

/**
 * `RuleEngine.Reconcile`-ийн TS хос (лавлагаа хэрэгжилт).
 * ⚠️ Нэрийг `RuleOutcome` гэж ЗОРИУД тавиагүй — тэр нэр нь `2-3` §3.9-ийн
 * C# төрөл (Хавсралт §11-ийн эзэмшлийн хүснэгт).
 */
export interface ReconcilableOutcome {
  readonly ruleUid: string;
  readonly ruleVersion: number;
  readonly verdict: Verdict;
  readonly severity: Severity;
  readonly issueClass: IssueClass;
  readonly evidenceLevel: EvidenceLevel;
  readonly observedValue: number | null;
  readonly thresholdValue: number | null;
  readonly unit: Unit;
  readonly missingInputs: readonly string[];
  readonly conflictRuleUids: readonly string[];
  readonly skippedReason: string | null;
  readonly uncertainReason: UncertainReason | null;
}

function disagrees(a: ReconcilableOutcome, b: ReconcilableOutcome): boolean {
  if (a.verdict === b.verdict) return false;
  const loud = (v: Verdict): boolean => v === 'VIOLATION' || v === 'WARNING';
  return loud(a.verdict) || loud(b.verdict);
}

/**
 * НЭГ ЭЛЕМЕНТИЙН дүгнэлтүүдийг эвлэрүүлнэ.
 *
 * ⚠️ ХОЁР PASS ХЭЗЭЭ Ч ЗӨРЧИЛДӨХГҮЙ.  Хоёулаа UNCERTAIN бол мөн үгүй.
 * ⚠️ `precedence` нь ДҮГНЭЛТИЙГ ХЭЗЭЭ Ч ӨӨРЧИЛӨХГҮЙ — хүн бүртгэсэн
 *    тэргүүлэх эрх нь ЗӨВЛӨМЖ, автомат шийдэл БИШ.
 * ⚠️ `thresholdValue = null` ЗААВАЛ — зөрчилдөж буй хоёр босгын аль нэгийг
 *    сонгож харуулах нь яг тэр «чимээгүй сонголт».
 * ⚠️ `ruleUid` нь ordinal-аар ХАМГИЙН БАГА оролцогч — `DedupKey`-ийн
 *    ТОГТВОРТОЙ БАЙДЛЫН шаардлага (массивын дараалал coalescer-ээс хамаарч хөвнө).
 */
export function reconcileOutcomes(
  outcomes: readonly ReconcilableOutcome[],
  table: ConflictTable,
): readonly ReconcilableOutcome[] {
  const involved = new Set<number>();
  for (let i = 0; i < outcomes.length; i += 1) {
    for (let j = i + 1; j < outcomes.length; j += 1) {
      const a = outcomes[i];
      const b = outcomes[j];
      if (!a || !b) continue;
      if (!table.has(a.ruleUid, b.ruleUid)) continue;
      if (!disagrees(a, b)) continue;
      involved.add(i);
      involved.add(j);
    }
  }
  if (involved.size === 0) return outcomes;

  const members = [...involved].sort((x, y) => x - y).map((i) => outcomes[i]!);
  const uids = [...new Set(members.map((m) => m.ruleUid))].sort();
  const winnerUid = uids[0] ?? members[0]!.ruleUid;
  const winner = members.find((m) => m.ruleUid === winnerUid) ?? members[0]!;

  let severity: Severity = 'INFO';
  for (const m of members) {
    if (SEVERITY_RANK[m.severity] > SEVERITY_RANK[severity]) severity = m.severity;
  }
  let evidence: EvidenceLevel = 'HUMAN_VERIFIED';
  for (const m of members) {
    if (EVIDENCE_RANK[m.evidenceLevel] < EVIDENCE_RANK[evidence]) evidence = m.evidenceLevel;
  }
  const units = new Set(members.map((m) => m.unit));
  const missing = [...new Set(members.flatMap((m) => [...m.missingInputs]))].sort();

  const merged: ReconcilableOutcome = {
    ruleUid: winnerUid,
    ruleVersion: winner.ruleVersion,
    verdict: 'UNCERTAIN',
    severity,
    issueClass: 'UNKNOWN_NEEDS_REVIEW',
    evidenceLevel: evidence,
    observedValue: null,
    thresholdValue: null,
    unit: units.size === 1 ? (units.values().next().value ?? 'NONE') : 'NONE',
    missingInputs: missing,
    conflictRuleUids: uids,
    skippedReason: null,
    uncertainReason: 'conflict',
  };

  const out: ReconcilableOutcome[] = [];
  for (let i = 0; i < outcomes.length; i += 1) {
    if (involved.has(i)) continue;
    const o = outcomes[i];
    if (o) out.push(o);
  }
  out.push(merged);
  return out;
}

/* ================================================================== */
/*  2-3 — ОЛДВОРЫН АМЬДРАЛЫН МӨЧЛӨГ, ХУУЧРУУЛАЛТ, ГҮЙЛТИЙН БҮРТГЭЛ     */
/*                                                                     */
/*  ⚠️ ЭНЭ БЛОК НЬ ФАЙЛЫН ТӨГСГӨЛД НЭМЭГДСЭН.  Дээрх БҮХ экспорт нь    */
/*  `2-2-rule-model`-ынх — тэдгээрийг ХӨНДӨӨГҮЙ.  Дараагийн сессүүд     */
/*  (2-5 → 2-7) мөн ЗӨВХӨН ЭНЭ БЛОКИЙН ДООР нэмнэ.                     */
/*                                                                     */
/*  ⚠️ ЭНЭ ФАЙЛ SQL БИЧИХГҮЙ.  Хаалттай үгсийн сан + цэвэр функцууд     */
/*  ЗӨВХӨН.  `routes/compliance.ts` нь эндээс УГТВАРУУДЫГ авна.         */
/*                                                                     */
/*  ⚠️ Verdict / IssueClass / EvidenceLevel / Severity / UncertainReason */
/*  нь файлын ДЭЭД хэсэгт (2-2 §3.6) аль хэдийн зарлагдсан — доор       */
/*  ЗӨВХӨН лавлана.  Ижил `export const`-ыг хоёр удаа зарлавал файл     */
/*  КОМПАЙЛ БОЛОХГҮЙ.                                                   */
/*                                                                     */
/*  ⚠️ `AUTHORITY_CAPS` / `authorityFromSetting` нь                     */
/*  `lib/complianceAuthority.ts` дээр амьдарна.  ЭНД ХУУЛБАРЛАХГҮЙ —    */
/*  хоёр caps хүснэгт орших нь `surface` нэг талдаа true, нөгөө талдаа  */
/*  false болох өдөр л илэрнэ.  Тэдгээрийн RE-EXPORT нь `2-5`-ын       */
/*  блокийнх (энэ файлын дараагийн эзэн), тиймээс ЭНД зарлагдаагүй.     */
/* ================================================================== */

/**
 * §57-R1 — ОЛДВОРЫН АМЬДРАЛЫН МӨЧЛӨГ, ЯГ ДОЛОО.
 *
 * ⚠️ `STALE` нь ЭНД БАЙХГҮЙ.  §57 нь түүнийг тоолоогүй ба §58 нь түүнийг
 * «түр тэмдэг → дахин тооцоолол» гэж тодорхойлдог: `compliance_findings`-ийн
 * `stale_at` / `stale_reason` багана нь ТЭР тэмдэг.  Найм дахь төлөв болгон
 * зарлавал «дахин үнэлэгдэх ёстой ЗӨРЧИЛ» ба «зөрчил байхаа больсон» хоёр
 * нэг нүдэнд орно.
 */
export const LIFECYCLE_STATES = [
  'OPEN',
  'ACKNOWLEDGED',
  'FIXED',
  'REOPENED',
  'DISMISSED',
  'INVALIDATED',
  'UNCERTAIN',
] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export const isLifecycleState = (v: unknown): v is LifecycleState =>
  isMember(LIFECYCLE_STATES, v);

/**
 * §58 — ХУУЧРУУЛАХ ГУРВАН ГОХ, дөрвөн шалтгааны токен.
 *
 * `sync`    — өөр хүний Synchronize / Reload Latest дуусав.  `Suppressed`
 *             цонхонд `OnDocumentChanged` ЭРТ БУЦДАГ тул тэр өөрчлөлт
 *             бохирдсон олонлогт ХЭЗЭЭ Ч ОРОХГҮЙ (`ChangeTracker.cs:801`).
 * `edit`    — олдворын элемент коалесцлагдсан олонлогт ДАХИН гарч ирэв.
 * `ruleset` — дүрэм / багц өөрөө өөрчлөгдөв (СЕРВЕР, УНШИХ ҮЕД).
 * `central` — төв загварын зам солигдов (СЕРВЕР, УНШИХ ҮЕД).
 *
 * ⚠️ Эхний хоёр нь КЛИЕНТЭЭС `POST /api/compliance/findings/stale`-ээр,
 * сүүлийн хоёр нь СЕРВЕР дээр `GET /projects/:id/state`-ийн ЭХЭНД.
 * ⚠️ CRON НЭМЭХГҮЙ — `wrangler.toml`-д ЯГ ХОЁР `crons` илэрхийлэл байна ба
 * гурав дахийг нэмбэл `index.ts`-ийн `scheduled` салаа нь дөрвөн ажлыг
 * ДАВХАР ажиллуулна.  Тиймээс хуучруулалт нь УНШИХ ҮЕД (stale-on-read).
 */
export const STALE_REASONS = ['sync', 'edit', 'ruleset', 'central'] as const;
export type StaleReason = (typeof STALE_REASONS)[number];

export const isStaleReason = (v: unknown): v is StaleReason => isMember(STALE_REASONS, v);

/** §63 — олдворын хамралт.  `partial` = мөчлөг таслагдсан, ҮНЭН нь бүрэн БИШ. */
export const COVERAGE_VALUES = ['full', 'partial'] as const;
export type Coverage = (typeof COVERAGE_VALUES)[number];
export const isCoverage = (v: unknown): v is Coverage => isMember(COVERAGE_VALUES, v);

/** §57 «affected element(s)» — `subject` = дүрэм үүн дээр ажилласан. */
export const FINDING_ELEMENT_ROLES = ['subject', 'context'] as const;
export type FindingElementRole = (typeof FINDING_ELEMENT_ROLES)[number];
export const isFindingElementRole = (v: unknown): v is FindingElementRole =>
  isMember(FINDING_ELEMENT_ROLES, v);

/** §60-R3 «affected teams».  `responsible` нь ЗӨВХӨН precedence мэдэгдэж байвал. */
export const FINDING_TEAM_RELATIONS = ['owner', 'affected', 'responsible'] as const;
export type FindingTeamRelation = (typeof FINDING_TEAM_RELATIONS)[number];

/** §77 root-cause · §76-R3 бүлэглэл · §64 зөрчил. */
export const FINDING_EDGE_KINDS = ['causes', 'duplicates', 'conflicts_with'] as const;
export type FindingEdgeKind = (typeof FINDING_EDGE_KINDS)[number];

/**
 * ХУУЛЬ ЁСНЫ ШИЛЖИЛТҮҮД.
 *
 * ⚠️ Бүрэн `Record<>` — шинэ төлөв нэмбэл КОМПАЙЛЫН АЛДАА гарна
 * (`REQUIRED_PARTS_OF`-ийн заншил).
 * ⚠️ `DISMISSED` нь `REOPENED` рүү Л буцна: §68-ын override нь НЭМЭЛТ,
 * УСТГАЛТ БИШ.
 * ⚠️ `INVALIDATED` нь ЭЦСИЙН — дүрэм татагдсан эсвэл хамрахаа больсон.
 */
export const ALLOWED_TRANSITIONS: Record<LifecycleState, readonly LifecycleState[]> = {
  OPEN: ['ACKNOWLEDGED', 'FIXED', 'DISMISSED', 'INVALIDATED', 'UNCERTAIN'],
  ACKNOWLEDGED: ['FIXED', 'DISMISSED', 'INVALIDATED', 'REOPENED', 'UNCERTAIN'],
  FIXED: ['REOPENED', 'INVALIDATED'],
  REOPENED: ['ACKNOWLEDGED', 'FIXED', 'DISMISSED', 'INVALIDATED', 'UNCERTAIN'],
  DISMISSED: ['REOPENED'],
  INVALIDATED: [],
  UNCERTAIN: ['OPEN', 'FIXED', 'INVALIDATED', 'ACKNOWLEDGED'],
};

/**
 * `from` → `to` шилжилт хууль ёсны эсэх.
 *
 * ⚠️ Ижил төлөв рүү шилжих нь NO-OP тул ХУУЛЬ ЁСНЫ — эс бөгөөс сүлжээ
 * тасарч дахин илгээсэн PATCH нь 409 авна.  ГЭХДЭЭ `INVALIDATED`-аас
 * `INVALIDATED` рүү ч ялгаагүй NO-OP: эцсийн төлөвөөс ГАРАХ зам БАЙХГҮЙ.
 */
export function canTransition(from: LifecycleState, to: LifecycleState): boolean {
  if (from === to) return true;
  return (ALLOWED_TRANSITIONS[from] as readonly string[]).includes(to);
}

/**
 * «НЭЭЛТТЭЙ» олдворын тодорхойлолт — badge ба тоолуурын ГАНЦ эх сурвалж.
 * `FIXED` / `DISMISSED` / `INVALIDATED` нь ХААЛТТАЙ.
 */
export const OPEN_LIFECYCLE_STATES = ['OPEN', 'REOPENED', 'UNCERTAIN'] as const;

/**
 * Хуучруулж БОЛОХ төлөвүүд.  ⚠️ `ACKNOWLEDGED` нь ЭНД БАЙНА: «ойлголоо»
 * гэсэн олдвор загвар өөрчлөгдөхөд дахин үнэлэгдэх ёстой.  `FIXED` /
 * `DISMISSED` / `INVALIDATED` нь ХААЛТТАЙ тул хуучруулах утгагүй — тэднийг
 * саарал болгох нь зассан ажлыг эргэлзээтэй мэт харуулна.
 */
export const STALEABLE_LIFECYCLE_STATES = [
  'OPEN',
  'REOPENED',
  'UNCERTAIN',
  'ACKNOWLEDGED',
] as const;

/**
 * §61-R3 — хамаарал нь дүрэм ГҮЙЦЭТГЭХЭЭС ӨМНӨ тогтоогддог.  Тиймээс
 * `NOT_APPLICABLE` нь ХАМААРЛЫН ҮР ДҮН бөгөөд МӨР БОЛЖ ХЭЗЭЭ Ч ХУВИРАХГҮЙ.
 * Энэ нь §11-ийн 5 утга ба §40-R2-ийн 4 утгын зөрүүг шийднэ.
 *
 * ⚠️ Мөр үлдээхгүй тул «хэзээ ч ажиллаагүй дүрэм» ба «бүрэн нийцсэн загвар»
 * хоёр ЯГ ИЖИЛ харагдана — гүйлтийн бүртгэл (`rule_run_ledger`, 0229) энэ
 * нүхийг хаана.  Тэр хүснэгтгүйгээр эзний Ш4 (дүрмийн багцгүй шип) нь ШУУД
 * «бүх төсөл нийцсэн» гэсэн ХУДАЛ мэдэгдэл болно.
 */
export const NOT_APPLICABLE_IS_NOT_A_ROW = true as const;

/**
 * `rule_run_ledger.skipped_reason`-ийн ХААЛТТАЙ ТОЛЬ.
 *
 * ⚠️ Хавсралт §9.1: энэ нь `APPLICABILITY_REASONS`-ийн НАДЛАГ ОЛОНЛОГ —
 * `2-3` нь `no_category`, `missing_params`, `budget_abort` ГУРВЫГ НЭМНЭ.
 * Тэр гурав нь ХАМААРЛААС ГАРАХГҮЙ (тэдгээр нь ХУВААРИЛАГЧИЙН шалтгаан):
 *   · `no_category`    — бохирдсон элементэд категори бичигдээгүй
 *   · `missing_params` — `requires.params` дүрмийн шаардлага биелээгүй
 *   · `budget_abort`   — `EvalAbortMs` таслав (`aborted` ч бас өснө)
 *   · `not_reported`   — клиент шалтгаан МЭДҮҮЛЭЭГҮЙ бөгөөд `applicable = 0`.
 *     ⚠️ СЕРВЕР ТАЛЫНХ, клиент үүнийг ИЛГЭЭХГҮЙ.  `skipped_reason`-ыг NULL
 *     үлдээвэл «хэзээ ч ажиллаагүй дүрэм» ЧИМЭЭГҮЙ болж, §69 түүнийг
 *     «цэвэр» гэж уншина.  ХУДАЛ шалтгаан зохиохгүйгээр «шалтгаан
 *     мэдэгдэхгүй»-г хадгалах ЦОРЫН ГАНЦ токен.
 * Хос файлын тулгалт (`check_rules.py --parity`) нь ЗӨВХӨН эхний тавыг
 * тулгана — сүүлийн гурав нь зөвхөн сервер талд утгатай.
 */
export const LEDGER_SKIP_REASONS = [
  ...APPLICABILITY_REASONS,
  'no_category',
  'missing_params',
  'budget_abort',
  'not_reported',
] as const;
export type LedgerSkipReason = (typeof LEDGER_SKIP_REASONS)[number];

export const isLedgerSkipReason = (v: unknown): v is LedgerSkipReason =>
  isMember(LEDGER_SKIP_REASONS, v);

/** `dedup_key`-ийн урт — 0227-ийн `compliance_notice_state.dedup_key`-тэй ЯГ ИЖИЛ. */
export const DEDUP_KEY_LENGTH = 16;

/**
 * `dedup_key = sha256(rule_uid || 0x00 || element_uid)`-ийн эхний 16 тэмдэгт.
 *
 * ⚠️ ХОЁР ТАЛД ХОЁР УДАА тооцогдоно: клиент (`ComplianceState.DedupKey`) ба
 * сервер (`POST /findings`-ийн баталгаажуулалт).  Зөрвөл сервер 400 өгнө —
 * тэр нь ЗӨВ: түлхүүрийг клиент чөлөөтэй зохиовол өөр хүний мөр рүү UPSERT
 * хийж чадна (`idx_cf_dedup` нь `(doc_uid, detected_by, dedup_key)`).
 *
 * ⚠️ `ruleset_version` ба `detected_by` нь ЭНД ОРОХГҮЙ (0224-ийн толгойг үз).
 * ⚠️ Тусгаарлагч нь ЯГ `0x00` (`DEDUP_KEY_SEPARATOR`) — `':'` эсвэл `'|'` бол дүрмийн код
 * дотор тэр тэмдэгт гарч ирэхэд хоёр өөр хос ижил түлхүүр өгнө.
 */
export const DEDUP_KEY_SEPARATOR = '\u0000';

export async function dedupKeyOf(ruleUid: string, elementUid: string): Promise<string> {
  const hex = await sha256Hex(`${ruleUid}${DEDUP_KEY_SEPARATOR}${elementUid}`);
  return hex.slice(0, DEDUP_KEY_LENGTH);
}

/**
 * §69-ийн ТҮҮХИЙ ОРОЛТ — «энэ төслийг ҮНЭХЭЭР шалгасан уу».
 *
 * ⚠️ ЭНЭ НЬ БЭЛЭН БАЙДЛЫН ШИЙДВЭР БИШ.  Ногоон/улаан нь `2-7`-ынх (§69-R3:
 * «баталгаажлаа» гэсэн үг ХЭЗЭЭ Ч БИЧИГДЭХГҮЙ).  Энэ функц нь ЗӨВХӨН
 * «дүрмийн багц байхгүй» ба «шалгаад цэвэр» хоёрыг ЯЛГАНА — эзний Ш4-ийн
 * дараа (`rules` хүснэгт ХООСОН шипнэ) тэр ялгаа нь системийн ХАМГИЙН ЧУХАЛ
 * үнэнч байдал: тэг олдворыг «нийцсэн» гэж уншуулах нь ХУДАЛ мэдэгдэл.
 */
export const EVALUATION_STATES = ['no_rule_pack', 'never_run', 'partial', 'checked'] as const;
export type EvaluationState = (typeof EVALUATION_STATES)[number];

export interface EvaluationStateInput {
  /** Нийтлэгдсэн дүрмийн НИЙТ тоо (`rules`, `status='published'`). */
  readonly rulesPublished: number;
  /** Нийтлэгдсэн багцын тоо (`rule_pack_versions`, `status='published'`). */
  readonly packsPublished: number;
  /** Энэ төсөл дээр үлдсэн `rule_run_ledger` мөрийн тоо. */
  readonly ledgerRows: number;
  /** Бүртгэлийн `aborted`-ын нийлбэр. */
  readonly aborted: number;
  /** `coverage = 'partial'` олдворын тоо. */
  readonly partialFindings: number;
  /** Хуучирсан (`stale_at IS NOT NULL`) олдворын тоо. */
  readonly staleFindings: number;
}

export function evaluationStateOf(input: EvaluationStateInput): EvaluationState {
  // Дүрэм ч, багц ч байхгүй бол ЮУ Ч шалгагдаагүй.  Энэ нь эзний Ш4-ийн
  // ХЭВИЙН эхлэлийн төлөв — алдаа БИШ, гэхдээ «цэвэр» ч БИШ.
  if (input.rulesPublished <= 0 && input.packsPublished <= 0) return 'no_rule_pack';
  // Дүрэм бий, гэвч энэ төсөл дээр мөчлөг НЭГ Ч удаа ажиллаагүй.
  if (input.ledgerRows <= 0) return 'never_run';
  if (input.aborted > 0 || input.partialFindings > 0 || input.staleFindings > 0) return 'partial';
  return 'checked';
}

/* ================================================================== */
/*  2-5 — НОТОЛГООНЫ ТЭНХЛЭГ, ХАРУУЛАХ ЭРЭМБЭ, ҮНДСЭН ШАЛТГААНЫ ГРАФ,   */
/*        ХҮЧИНГҮЙ БОЛГОЛТ, ЭРХИЙН ТҮВШИН                              */
/*                                                                     */
/*  ⚠️ ЭНЭ БЛОК НЬ ФАЙЛЫН ТӨГСГӨЛД НЭМЭГДСЭН.  Дээрх БҮХ экспорт нь    */
/*  `2-2` (үгсийн сан, хавчаар) ба `2-3` (амьдралын мөчлөг, бүртгэл)   */
/*  сессийнх — тэдгээрийг ХӨНДӨӨГҮЙ.  `2-7` нь ЗӨВХӨН ЭНЭ БЛОКИЙН      */
/*  ДООР нэмнэ.                                                        */
/*                                                                     */
/*  ⚠️ ЭНД ДАХИН ЗАРЛАГДАХГҮЙ НЭРС (дээр аль хэдийн байгаа):           */
/*  `EVIDENCE_LEVELS`, `SEVERITIES`, `SEVERITY_RANK`, `EVIDENCE_RANK`, */
/*  `VERDICTS`, `ISSUE_CLASSES`, `LIFECYCLE_STATES`.  Ижил             */
/*  `export const`-ыг хоёр удаа зарлавал файл КОМПАЙЛ БОЛОХГҮЙ.        */
/*                                                                     */
/*  ⚠️ ЭНЭ ФАЙЛ SQL БИЧИХГҮЙ, D1 МЭДЭХГҮЙ.  Хаалттай үгсийн сан +      */
/*  ЦЭВЭР функцууд ЗӨВХӨН — `node --test` доор шууд ачаалагдана.       */
/* ================================================================== */

/* ------------------------------------------------------------------ */
/*  §65 — НОТОЛГООНЫ ТҮВШНИЙ ХАРАГДАХ ГЭРЭЭ (ДӨРӨВ ДЭХ ТЭНХЛЭГ)        */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ ЯАГААД ЭНЭ НЬ ТУСДАА ТЭНХЛЭГ ВЭ:
 * Репод аль хэдийн ГУРВАН итгэлийн үгсийн сан байгаа бөгөөд тэд ЗӨРЧИЖ байна —
 *   · `assistant_examples.source_type`   (8 утга, DB CHECK, 0215:51-55)
 *   · `learning_events.provenance`       (6 утга, CHECK БАЙХГҮЙ, bimEvents.ts:245-252)
 *   · v1 §19-ийн KNOWN / INFERRED / ASSUMED / UNKNOWN (зөвхөн спекд)
 * Нэрээрээ давхцаж буй нь ЗӨВХӨН `HUMAN_VERIFIED` ба `UNKNOWN`, ба хооронд
 * нь хөрвүүлэх функц репод БАЙХГҮЙ.  `source_type`-ыг дахин ашиглавал
 * `RULE_BACKED` нь 0215-ийн CHECK-д БАЙХГҮЙ тул INSERT нь «CHECK constraint
 * failed» өгнө.  Тиймээс `compliance_findings.evidence_level` нь ӨӨРИЙН
 * баганатай (0224) ба ЭНЭ хүснэгт нь түүний ХАРАГДАХ гэрээ.
 *
 * ⚠️ ЭНЭ БОЛ UI-ИЙН ЗАГВАР БИШ, ХИЛ.  §65 (v2:2158): «A model-generated
 * explanation without evidence must never be presented as a verified
 * regulatory fact.»  Тиймээс `citation === false` үед нормын КОД, ЗААЛТ,
 * ХЭВЛЭЛ нь хариултаас БҮРЭН хасагдана — саарал болгож харуулахгүй.
 */
export interface EvidenceRender {
  /** Нормын код / заалт / хэвлэл хэвлэхийг зөвшөөрөх үү. */
  readonly citation: boolean;
  /** Хамгийн өндөр зөвшөөрөгдөх дүгнэлт — үүнээс ХҮЧТЭЙ мэдэгдэл гаргахгүй. */
  readonly maxVerdict: Verdict;
  /** Бэлэн байдлын хаалганд тоологдох уу (§69).  `2-7`-ийн шүүлт. */
  readonly countsForReadiness: boolean;
  /** Сургалтад тэнцэх БОЛОМЖТОЙ эсэх (эцсийн шийдвэр `2-6`-д). */
  readonly trainingCandidate: boolean;
  /** Монгол шошго — UI-д ЯГ ЭНЭ мөр гарна. */
  readonly labelMn: string;
  readonly labelEn: string;
}

/** ⚠️ TOTAL Record — шинэ нотолгооны түвшин нэмэх нь КОМПИЛЯЦИЙН АЛДАА. */
export const EVIDENCE_RENDER: Record<EvidenceLevel, EvidenceRender> = {
  RULE_BACKED: {
    citation: true,
    maxVerdict: 'VIOLATION',
    countsForReadiness: true,
    trainingCandidate: true,
    labelMn: 'Норм эх сурвалжтай',
    labelEn: 'Rule-backed',
  },
  MODEL_DERIVED: {
    citation: false,
    maxVerdict: 'WARNING',
    countsForReadiness: true,
    trainingCandidate: false,
    labelMn: 'Дотоод шалгуур (эх сурвалж баталгаажаагүй)',
    labelEn: 'Internal check (source unverified)',
  },
  HUMAN_VERIFIED: {
    citation: true,
    maxVerdict: 'VIOLATION',
    countsForReadiness: true,
    trainingCandidate: true,
    labelMn: 'Хүн баталсан',
    labelEn: 'Human-verified',
  },
  AI_INFERRED: {
    citation: false,
    maxVerdict: 'UNCERTAIN',
    countsForReadiness: false,
    trainingCandidate: false,
    labelMn: 'AI-ийн таамаг — норм БИШ',
    labelEn: 'AI inference — not a regulation',
  },
  UNKNOWN: {
    citation: false,
    maxVerdict: 'UNCERTAIN',
    countsForReadiness: false,
    trainingCandidate: false,
    labelMn: 'Эх сурвалж тодорхойгүй',
    labelEn: 'Unknown provenance',
  },
};

/**
 * МЭДЭГДЛИЙН ХҮЧ — хавчилтын ЦОРЫН ГАНЦ дараалал.
 *
 * ⚠️ `UNCERTAIN` нь ХАМГИЙН СУЛ (0) — тэр нь ЮУ Ч мэдэгдэхгүй.  `PASS` нь
 *    1: «энэ шалгуурыг давлаа» гэдэг нь БАС мэдэгдэл бөгөөд нотолгоогүй
 *    үед ХУДАЛ БАТАЛГАА болно.  Тиймээс `maxVerdict = 'UNCERTAIN'` үед
 *    `PASS` ч мөн `UNCERTAIN` болно — AI-ийн таамаг «тэнцлээ» гэж хэлэх
 *    эрхгүй (§69-R3: «This should never be a legal certification»).
 * ⚠️ Энэ нь `SEVERITY_RANK`-тай ХОЛБООГҮЙ — хүнд байдал ба мэдэгдлийн хүч
 *    хоёр ӨӨР тэнхлэг.
 */
export const VERDICT_CLAIM_STRENGTH: Record<Verdict, number> = {
  UNCERTAIN: 0,
  PASS: 1,
  WARNING: 2,
  VIOLATION: 3,
};

export interface EvidenceClampInput {
  readonly verdict: Verdict;
  readonly evidenceLevel: EvidenceLevel;
}

export interface EvidenceClampOutput {
  /** Харуулж БОЛОХ дүгнэлт.  Хадгалагдсан мөр ӨӨРЧЛӨГДӨХГҮЙ. */
  readonly verdict: Verdict;
  /** Хадгалагдсан жинхэнэ дүгнэлт — ил тод байлгахын тулд ҮРГЭЛЖ буцаана. */
  readonly rawVerdict: Verdict;
  /** Хавчилт БОДИТОЙ болсон эсэх (UI «хүн шалгана» гэж хэлэх шалтгаан). */
  readonly clamped: boolean;
  /** Нормын код / заалт / хэвлэл хэвлэхийг зөвшөөрөх үү. */
  readonly citation: boolean;
  readonly labelMn: string;
  readonly labelEn: string;
}

/**
 * ИЛЭРХИЙЛЭЛИЙН ХАВЧААР — УНШИХ үед.
 *
 * ⚠️ `clampByVerification` (§3.5, дээр) нь ДҮРМИЙН түвшинд, БИЧИХ үед
 *    хавчина; энэ нь НОТОЛГООНЫ түвшинд, УНШИХ үед хавчина.  ХОЁУЛАА
 *    хэрэгтэй ба ХОЁУЛАА ажиллана: эхнийх нь `UNVERIFIED` дүрмээс
 *    `VIOLATION` гарахаас сэргийлнэ, хоёр дахь нь хадгалагдсан мөрийг
 *    ЗАСАЛГҮЙГЭЭР харагдац дээр л сулруулна.
 * ⚠️ ХАДГАЛАГДСАН МӨРИЙГ ХЭЗЭЭ Ч UPDATE ХИЙХГҮЙ.  Машины ЖИНХЭНЭ дүгнэлт
 *    нь §68-ийн аудитын мөрийн үндэс — түүнийг харагдацын дүрмээр дарж
 *    бичих нь хожим «яагаад ингэж шийдсэн бэ» гэсэн асуултыг хариулах
 *    боломжгүй болгоно.
 */
export function clampByEvidence(input: EvidenceClampInput): EvidenceClampOutput {
  const render = EVIDENCE_RENDER[input.evidenceLevel];
  const cap = VERDICT_CLAIM_STRENGTH[render.maxVerdict];
  const raw = VERDICT_CLAIM_STRENGTH[input.verdict];
  const verdict = raw > cap ? render.maxVerdict : input.verdict;
  return {
    verdict,
    rawVerdict: input.verdict,
    clamped: verdict !== input.verdict,
    citation: render.citation,
    labelMn: render.labelMn,
    labelEn: render.labelEn,
  };
}

/** §69-ийн тоологчийн шүүлт — `2-7` нь ЭНЭ функцээр орно, өөрөө бодохгүй. */
export function countsForReadiness(level: EvidenceLevel): boolean {
  return EVIDENCE_RENDER[level].countsForReadiness;
}

/* ------------------------------------------------------------------ */
/*  §67 — ХАРУУЛАХ ЭРЭМБЭ (ЭРЭМБЭ → ДАРАА нь ТАСЛАХ)                   */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ ЖИЖИГ ТОО = ЭХЭНД.  Энэ нь `SEVERITY_RANK`-ийн (2-2, дээр: CRITICAL = 5)
 *    ЭСРЭГ ЧИГЛЭЛ бөгөөд тэр нь ЗОРИУД: `SEVERITY_RANK` нь «хэр хүнд вэ»
 *    гэсэн ОНОО (нэгтгэл, `>= floor` шүүлт, `reconcileOutcomes`-ийн
 *    хамгийн хүндийг сонгох), энэ нь «жагсаалтад хэддүгээрт бичих вэ»
 *    гэсэн ИНДЕКС.  Нэг тогтмолыг хоёр зорилгоор хэрэглэвэл аль нэг
 *    хэрэглэгч нь чимээгүй УРВУУ эрэмбэ авна.
 * ⚠️ Хоёрын хоорондын ЭСРЭГ ХАМААРЛЫГ `complianceSurface.test.ts` түгжсэн.
 */
export const SEVERITY_DISPLAY_RANK: Record<Severity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFO: 4,
};

/** Эрэмбэлэхэд ХАНГАЛТТАЙ хамгийн бага мөр — SQL-ийн бүтэн мөр ШААРДАХГҮЙ. */
export interface FindingDisplayRow {
  readonly id: number;
  readonly dedupKey: string;
  readonly severity: Severity;
  /** `null` бол ЭНЭ мөр өөрөө үндэс. */
  readonly rootId: number | null;
  readonly isStale: boolean;
  /** Эрэмбэлэлтэд ЗӨВХӨН харьцуулагдана — форматад хамаарахгүй. */
  readonly detectedAtMs: number;
}

/**
 * ⚠️ ЭРЭМБЭ → ДАРАА нь ТАСЛАХ.  Урвуулбал `ChangeReport.cs:56-60`-д
 *    тэмдэглэсэн регресс давтагдана: хэрэглэгч «санамсаргүй N»-г БҮРЭН
 *    жагсаалт гэж үзээд үлдсэнийг засахгүй.  Дүгнэлтийн хувьд энэ нь
 *    өмнөх алдаанаас ХАМААГҮЙ аюултай.
 *
 * Дараалал: (1) хүнд байдал, (2) үндэс нь дагавраасаа ДЭЭР (§77),
 * (3) хуучирсан нь ДООР (§58 — тэр нь одоогийн дүгнэлт БИШ),
 * (4) сүүлд илрүүлсэн нь ДЭЭР, (5) `id` — ТОГТВОРТОЙ таслагч.
 *
 * ⚠️ (5) нь ЗААВАЛ: тэнцүү мөрүүдийн дараалал хөвбөл ижил өгөгдөл дээр
 *    хоёр дуудлага өөр «эхний 40»-ыг таслана.
 */
export function compareFindingsForDisplay(a: FindingDisplayRow, b: FindingDisplayRow): number {
  const bySeverity = SEVERITY_DISPLAY_RANK[a.severity] - SEVERITY_DISPLAY_RANK[b.severity];
  if (bySeverity !== 0) return bySeverity;
  const aRoot = a.rootId === null;
  const bRoot = b.rootId === null;
  if (aRoot !== bRoot) return aRoot ? -1 : 1;
  if (a.isStale !== b.isStale) return a.isStale ? 1 : -1;
  if (a.detectedAtMs !== b.detectedAtMs) return b.detectedAtMs - a.detectedAtMs;
  return a.id - b.id;
}

/* ------------------------------------------------------------------ */
/*  §77 — ҮНДСЭН ШАЛТГААНЫ ГРАФ (УНШИХ ТАЛ)                            */
/* ------------------------------------------------------------------ */

/**
 * `finding_edges`-ийн нэг мөрийн ЦЭВЭР дүрслэл.
 *
 * ⚠️ ЧИГЛЭЛ (0225-ийн толгойд түгжигдсэн): `from` = ҮНДЭС, `to` = ҮР
 *    ДАГАВАР.  Урвуулбал §77-ийн «нэг үндэс + N дагавар» нь толин тусгал
 *    болж, хоёр уншигч хоёулаа мөр буцаах тул ХЭН Ч анзаарахгүй.
 */
export interface FindingEdge {
  readonly from: number;
  readonly to: number;
  readonly kind: FindingEdgeKind;
}

export interface RootCauseResolution {
  readonly rootId: number;
  /** `id`-аас үндэс хүртэлх зам (өөрийг нь ОРУУЛААГҮЙ), дээшлэх дараалалтай. */
  readonly chain: readonly number[];
  /** Мөчлөг илэрсэн эсэх — граф эвдэрсэн ч хариу ЗААВАЛ буцна. */
  readonly cyclic: boolean;
}

/**
 * `causes` ирмэгийн дээгүүр ДЭЭШ явж ҮНДСИЙГ олно.
 *
 * ⚠️ МӨЧЛӨГӨӨС ХАМГААЛАХ нь ЗААВАЛ.  `finding_edges` дээр мөчлөгийг
 *    хориглосон CHECK БАЙХГҮЙ (0225) ба хоёр өөр сесс А→Б, Б→А гэж бичих
 *    нь бүрэн боломжтой.  Хамгаалалтгүй бол энэ функц Worker дотор МӨНХ
 *    давталтад орж, хүсэлт нь CPU хязгаараар үхнэ — «нэг инженерийн нэг
 *    загвар» бүх машины хариу цагийг ХОЙШЛУУЛНА.
 * ⚠️ ОЛОН ЭЦЭГТЭЙ үед ХАМГИЙН БАГА `id`-г сонгоно — ТОГТВОРТОЙ байхын
 *    тулд.  «Хамгийн зөв эцэг»-ийг таах нь энэ давхаргын ажил БИШ.
 */
export function resolveRootCause(
  id: number,
  edges: readonly FindingEdge[],
): RootCauseResolution {
  const parents = new Map<number, number[]>();
  for (const e of edges) {
    if (e.kind !== 'causes') continue;
    const list = parents.get(e.to);
    if (list) list.push(e.from);
    else parents.set(e.to, [e.from]);
  }

  const chain: number[] = [];
  const seen = new Set<number>([id]);
  let current = id;
  let cyclic = false;

  for (;;) {
    const ups = parents.get(current);
    if (!ups || ups.length === 0) break;
    let next = ups[0]!;
    for (const p of ups) if (p < next) next = p;
    if (seen.has(next)) {
      cyclic = true;
      break;
    }
    seen.add(next);
    chain.push(next);
    current = next;
  }

  return { rootId: current, chain, cyclic };
}

export interface RootCauseGroup<T extends FindingDisplayRow> {
  /** ҮНДСЭН ШАЛТГААН — ЭХЭНД зурагдана. */
  readonly primary: T;
  readonly consequences: readonly T[];
  /** Нугалахаас ӨМНӨХ бүтэн тоо — таслагдсаныг ИЛ хэлэхэд. */
  readonly consequenceTotal: number;
  /** Үндэс нь ХАРАГДАХ олонлогт байхгүй тул дагаврыг өргөмжилсөн эсэх. */
  readonly promoted: boolean;
}

export interface GroupedFindings<T extends FindingDisplayRow> {
  readonly groups: readonly RootCauseGroup<T>[];
  /** ЭРЭМБЭЛСНИЙ ДАРАА таслагдсан БҮЛГИЙН тоо. */
  readonly truncated: number;
}

/**
 * §77 + §76-R3 — мөрүүдийг «нэг үндэс + N дагавар» болгож нугална.
 *
 * ⚠️ Add-in-ийн `FindingFeed.Build`-тай ЯГ ИЖИЛ дүрэм: эрэмбэ → бүлэглэл →
 *    ТӨСӨВ.  Хоёр талд хоёр өөр дүрэм байвал самбарын «эхний 40» ба
 *    вэбийн «эхний 40» өөр өөр мөр харуулна.
 * ⚠️ ҮНДЭС нь ХАРАГДАХ олонлогт БАЙХГҮЙ байж БОЛНО (шүүлтэд унасан,
 *    хаагдсан, эсвэл өөр хүн илрүүлсэн).  Тэр үед бүлгийг ЗАДЛАХГҮЙ —
 *    дагаврууд нь ижил (үл харагдах) үндэсний доор НЭГ бүлэг хэвээр үлдэж,
 *    хамгийн хүнд нь ТҮР толгой болно.  Задалбал §77-ийн «нэг үндэс + N
 *    дагавар» нь N ширхэг ХОЛБООГҮЙ мөр болж, инженер нэг асуудлыг N удаа
 *    засах гэж оролдоно.  `promoted` нь UI-д «энэ бол жинхэнэ үндэс биш»
 *    гэж хэлэх ЦОРЫН ГАНЦ дохио — түүнгүйгээр дагавар нь шалтгаан мэт
 *    харагдана.
 */
export function groupByRootCause<T extends FindingDisplayRow>(
  rows: readonly T[],
  edges: readonly FindingEdge[],
  opts: { readonly maxGroups: number; readonly maxConsequences: number },
): GroupedFindings<T> {
  const sorted = [...rows].sort(compareFindingsForDisplay);

  interface Bucket {
    primary: T | null;
    consequences: T[];
    total: number;
    promoted: boolean;
  }
  const byRoot = new Map<number, Bucket>();
  const order: number[] = [];

  for (const row of sorted) {
    const rootId = row.rootId === null ? row.id : resolveRootCause(row.id, edges).rootId;
    let bucket = byRoot.get(rootId);
    if (!bucket) {
      bucket = { primary: null, consequences: [], total: 0, promoted: false };
      byRoot.set(rootId, bucket);
      order.push(rootId);
    }
    if (row.id === rootId && bucket.primary === null) {
      bucket.primary = row;
      continue;
    }
    bucket.total += 1;
    if (bucket.consequences.length < opts.maxConsequences) bucket.consequences.push(row);
  }

  for (const rootId of order) {
    const bucket = byRoot.get(rootId);
    if (!bucket || bucket.primary !== null) continue;
    const first = bucket.consequences.shift();
    if (!first) continue;
    bucket.primary = first;
    bucket.total -= 1;
    bucket.promoted = true;
  }

  const groups: RootCauseGroup<T>[] = [];
  let truncated = 0;
  for (const rootId of order) {
    const bucket = byRoot.get(rootId);
    if (!bucket || bucket.primary === null) continue;
    if (groups.length >= opts.maxGroups) {
      truncated += 1;
      continue;
    }
    groups.push({
      primary: bucket.primary,
      consequences: bucket.consequences,
      consequenceTotal: bucket.total,
      promoted: bucket.promoted,
    });
  }
  return { groups, truncated };
}

/* ------------------------------------------------------------------ */
/*  §68 — ГАР ХҮЧИНГҮЙ БОЛГОЛТЫН ҮГСИЙН САН                            */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ `FALSE_POSITIVE` нь `2-7`-ийн ХУДАЛ ДОХИОНЫ хэмжүүрийн ЦОРЫН ГАНЦ
 *    оролт.  Түүнийг `NOT_APPLICABLE_HERE` эсвэл `ACCEPTED_RISK`-тай
 *    НЭГТГЭХГҮЙ: эхнийх нь ДҮРЭМ буруу ажиллав, хоёр дахь нь дүрэм зөв ч
 *    энэ тохиолдолд хамаарахгүй, гурав дахь нь ЗӨРЧИЛ МӨН бөгөөд инженер
 *    мэдсээр байж хүлээн авав.  Нэгтгэвэл §66 хэмжигдэхээ болино.
 * ⚠️ 0237-ийн CHECK-тэй ЯГ ИЖИЛ ЗУРГААН утга, ИЖИЛ ДАРААЛАЛ.
 */
export const OVERRIDE_KINDS = [
  'FALSE_POSITIVE', // дүрэм буруу ажиллав — загвар зөв
  'RULE_WRONG', // дүрмийн УТГА буруу (босго, нэгж, заалт)
  'NOT_APPLICABLE_HERE', // дүрэм зөв ч энэ тохиолдолд хамаарахгүй
  'ACCEPTED_RISK', // зөрчил мөн, мэдсээр байж хүлээн авав
  'DESIGN_EXCEPTION', // зөвшөөрөгдсөн онцгой шийдэл (баримттай)
  'DUPLICATE', // өөр дүгнэлттэй давхардсан
] as const;
export type OverrideKind = (typeof OVERRIDE_KINDS)[number];
export const isOverrideKind = (v: unknown): v is OverrideKind => isMember(OVERRIDE_KINDS, v);

/** Нэг хүчингүй болголт ЮУГ ХЭЛЖ БАЙГААГ уншигч бүрд НЭГ утгаар тайлбарлана. */
export interface OverrideMeaning {
  /** §66 — ДҮРЭМ буруу ажилласан гэсэн мэдэгдэл мөн үү. */
  readonly falseSignal: boolean;
  /** Дүрмийн ӨӨРИЙНХ нь УТГА буруу гэсэн мэдэгдэл мөн үү (§68 → `2-2`). */
  readonly rebutsRule: boolean;
  /** Зөрчил нь ҮНЭН хэвээр үлдэж байна уу (§69-ийн хаалгад тоологдоно). */
  readonly stillAViolation: boolean;
}

/**
 * ⚠️ TOTAL Record.  ⚠️ `ACCEPTED_RISK` ба `DESIGN_EXCEPTION` нь
 *    `stillAViolation: true` — эс бөгөөс §69-ийн хаалгыг «бүгдийг хүлээн
 *    зөвшөөрөх» товчоор НОГООН болгож болно (эзний асуулт §9.4-9).
 * ⚠️ `DUPLICATE` нь ХУДАЛ ДОХИО БИШ: дүрэм зөв ажилласан, зүгээр л ижил
 *    зүйлийг хоёр удаа хэлсэн (0224-ийн `idx_cf_dedup` нь ХОЁР инженерийг
 *    ХОЁР мөр болгодог тул энэ нь ХҮЛЭЭГДЭЖ БУЙ тохиолдол).
 */
export const OVERRIDE_MEANING: Record<OverrideKind, OverrideMeaning> = {
  FALSE_POSITIVE: { falseSignal: true, rebutsRule: false, stillAViolation: false },
  RULE_WRONG: { falseSignal: true, rebutsRule: true, stillAViolation: false },
  NOT_APPLICABLE_HERE: { falseSignal: false, rebutsRule: false, stillAViolation: false },
  ACCEPTED_RISK: { falseSignal: false, rebutsRule: false, stillAViolation: true },
  DESIGN_EXCEPTION: { falseSignal: false, rebutsRule: false, stillAViolation: true },
  DUPLICATE: { falseSignal: false, rebutsRule: false, stillAViolation: false },
};

/**
 * ШАЛТГААНЫ ХАМГИЙН БАГА УРТ.
 *
 * ⚠️ Хоосон эсвэл «ok» гэсэн шалтгаан нь §66-д хэмжигдэхгүй, §70-д тест
 *    болохгүй — өөрөөр хэлбэл ӨГӨГДӨЛ БИШ.  DB-ийн `NOT NULL` нь хоосон
 *    мөрийг барихгүй тул хаалга нь МАРШРУТ дээр байх ЁСТОЙ.
 */
export const MIN_OVERRIDE_REASON_LEN = 8;
export const MAX_OVERRIDE_REASON_LEN = 2000;

/**
 * 0215-ийн ДӨРВӨН утгыг БАЙТ БАЙТААР дахин ашиглана — ТАВ ДАХЬ үгсийн сан
 * ҮҮСГЭХГҮЙ.  0237-ийн CHECK нь ЯГ ЭНЭ жагсаалт.
 *
 * ⚠️ `assistantExampleInsert.ts`-ийн `CLIENT_REVIEW_STATES` нь ГУРВАН утгатай
 *    (`rejected`-гүй) бөгөөд тэр нь КЛИЕНТЭЭС хүлээн авах утгууд.  Энд
 *    ДӨРВҮҮЛЭЭ байна: `rejected` нь ХЯНАГЧИЙН шийдвэр, инженерийн зарлал БИШ.
 */
export const REVIEW_STATES = ['pending', 'reviewed', 'verified', 'rejected'] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];
export const isReviewState = (v: unknown): v is ReviewState => isMember(REVIEW_STATES, v);

/** Хянагч ГАРААР бичиж болох төлөвүүд — `pending` рүү БУЦААХ зам БАЙХГҮЙ. */
export const REVIEW_DECISIONS = ['reviewed', 'verified', 'rejected'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
export const isReviewDecision = (v: unknown): v is ReviewDecision =>
  isMember(REVIEW_DECISIONS, v);

/**
 * §68-R4 — сургалтад орох ХААЛГА.  `2-6` нь ЗӨВХӨН эдгээрийг уншина.
 *
 * ⚠️ 0215-ийн бодлогыг БАЙТ БАЙТААР давтав:
 *    `eligible(row) = policy_allows(source_type) AND review_state IN
 *    ('reviewed','verified')`.  `pending` хүчингүй болголт нь сургалтад
 *    ХЭЗЭЭ Ч орохгүй — эс бөгөөс инженер өөрийн санал нийлээгүй бүх
 *    дүгнэлтээ ХЯНАЛТГҮЙ сургалтын өгөгдөл болгож чадна.
 */
export const TRAINING_ELIGIBLE_REVIEW_STATES = ['reviewed', 'verified'] as const;

export interface OverrideTrainingInput {
  readonly overrideKind: OverrideKind;
  readonly reviewState: ReviewState;
  readonly evidenceLevelAtOverride: EvidenceLevel;
  readonly reason: string;
}

/**
 * Хүчингүй болголт сургалтын НЭР ДЭВШИГЧ мөн үү.  ЭЦСИЙН шийдвэр нь `2-6`-д —
 * энэ нь ЗААВАЛ БИЕЛЭХ ХАМГИЙН БАГА нөхцөл.
 *
 * ⚠️ `EVIDENCE_RENDER[x].trainingCandidate` нь ЭХНИЙ шүүлт: AI-ийн таамгийг
 *    хүн «худал дохио» гэж тэмдэглэсэн нь сургалтын өгөгдөл БИШ — тэр нь
 *    зөвхөн «таамаг таамаг хэвээрээ» гэсэн үг.
 */
export function isOverrideTrainingEligible(input: OverrideTrainingInput): boolean {
  if (!(TRAINING_ELIGIBLE_REVIEW_STATES as readonly string[]).includes(input.reviewState)) {
    return false;
  }
  if (!EVIDENCE_RENDER[input.evidenceLevelAtOverride].trainingCandidate) return false;
  return input.reason.trim().length >= MIN_OVERRIDE_REASON_LEN;
}

/* ------------------------------------------------------------------ */
/*  §80 — ЭРХИЙН ТҮВШИН (RE-EXPORT, ХУУЛБАР БИШ)                       */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ ЭДГЭЭР НЬ `lib/complianceAuthority.ts`-Д АМЬДАРНА.  Энд ЗӨВХӨН
 *    ДАМЖУУЛАН ЭКСПОРТЛОНО — 2-5-ийн спек тэднийг энэ файлд байрлуулна
 *    гэж заасан ба уншигчид (`2-6`-ийн `modelCapability.ts`, маршрут,
 *    frontend) хоёр өөр замаар хайж эхэлсэн.  ⛔ ХУУЛБАРЛАХГҮЙ: хоёр
 *    `AUTHORITY_CAPS` орших нь `surface` нэг талдаа `true`, нөгөө талдаа
 *    `false` болох өдөр л илэрнэ — тэр нь дүгнэлт ХАРАГДАХ ба ЧИМЭЭГҮЙ
 *    НУУГДАХ хоёрын ялгаа.
 */
export {
  AUTHORITY_LEVELS,
  AUTHORITY_CAPS,
  authorityCaps,
  authorityFromSetting,
  authorityIndexFromSetting,
} from './complianceAuthority';
export type { AuthorityLevel, AuthorityCaps, AuthorityIndex } from './complianceAuthority';

import {
  AUTHORITY_CAPS as AUTHORITY_CAPS_INTERNAL,
  AUTHORITY_LEVELS as AUTHORITY_LEVELS_INTERNAL,
  type AuthorityLevel as AuthorityLevelInternal,
} from './complianceAuthority';

/**
 * §80-R3 — ТҮВШИН БҮРД ТУСДАА ХААЛГА.
 *
 * ⚠️ `assistant_models.eval_passed` (0213:44) нь ГАНЦ boolean тул энэ
 *    шаардлагыг илэрхийлж ЧАДАХГҮЙ — «ямар нэг golden давсан уу» гэсэн
 *    НЭГ асуултыг л хариулна.  Түвшин бүрийн бодит хаалга нь `2-6`-ийн
 *    `model_capabilities.authority_level` (0239) мөр — ЭНЭ хүснэгт нь
 *    тухайн мөрийг олгохын ӨМНӨ биелэх ёстой ШААРДЛАГЫН жагсаалт.
 * ⚠️ ЭНЭ НЬ ХЭРЭГЖҮҮЛЭГЧ БИШ, ТУНХАГ.  Хаалгыг бодитоор барих нь
 *    `assertCapability` (modelCapability.ts) ба нийтлэлийн гурван нөхцөл
 *    (`revit.ts:1970-1973`).  Энд байгаа нь «юуг шалгасан байх ёстой вэ»
 *    гэсэн асуултын хариу — админ түвшин дэвшүүлэхийн өмнө УНШИНА.
 */
export interface AuthorityGate {
  readonly level: AuthorityLevelInternal;
  /** Тухайн түвшинд шаардагдах golden хуваарийн нэрс. */
  readonly requiredPartitions: readonly string[];
  /** `rules.verification_state`-ийн ХАМГИЙН БАГА шаардлага. */
  readonly minVerificationState: VerificationState;
  /** Тухайн түвшинг асаахад ЗААВАЛ бөглөгдсөн байх нотолгооны талбарууд. */
  readonly requiredEvidenceFields: readonly string[];
}

/**
 * ⚠️ TOTAL Record — шинэ түвшин нэмбэл файл КОМПАЙЛ БОЛОХГҮЙ.
 *
 * ⚠️ LEVEL 1 (EXPLAIN) нь `CLAUSE_CITED` шаарддаг: ЯАГААД гэдгийг хэлэх
 *    эрх нь ЗААЛТ иш татах эрх бөгөөд `UNVERIFIED` дүрэм код хэвлэх
 *    эрхгүй (§65 + `2-2`-ийн хавчаар).  Тиймээс релиз N-д (`rules` ХООСОН,
 *    бүх дүрэм `UNVERIFIED`) LEVEL 1 нь ХООСОН гадаргуу л өгнө — тэр нь
 *    ЗӨВ бөгөөд эзний Ш4-ийн шууд үр дагавар.
 * ⚠️ LEVEL 4/5 нь `HUMAN_VERIFIED` — засвар автоматаар хэрэгжих зам нь
 *    албан ёсны БНбД баримтгүйгээр ХЭЗЭЭ Ч нээгдэхгүй (§9.4-12).
 */
export const AUTHORITY_GATES: Record<AuthorityLevelInternal, AuthorityGate> = {
  OBSERVE: {
    level: 'OBSERVE',
    requiredPartitions: [],
    minVerificationState: 'UNVERIFIED',
    requiredEvidenceFields: [],
  },
  EXPLAIN: {
    level: 'EXPLAIN',
    requiredPartitions: ['rules'],
    minVerificationState: 'CLAUSE_CITED',
    requiredEvidenceFields: ['document_uid', 'clause'],
  },
  RECOMMEND: {
    level: 'RECOMMEND',
    requiredPartitions: ['rules', 'recommendations'],
    minVerificationState: 'CLAUSE_CITED',
    requiredEvidenceFields: ['document_uid', 'clause', 'edition'],
  },
  PREVIEW: {
    level: 'PREVIEW',
    requiredPartitions: ['rules', 'recommendations', 'edits'],
    minVerificationState: 'CLAUSE_CITED',
    requiredEvidenceFields: ['document_uid', 'clause', 'edition', 'effective_from'],
  },
  HUMAN_APPROVED_EXECUTE: {
    level: 'HUMAN_APPROVED_EXECUTE',
    requiredPartitions: ['rules', 'recommendations', 'edits', 'regression'],
    minVerificationState: 'HUMAN_VERIFIED',
    requiredEvidenceFields: ['document_uid', 'clause', 'edition', 'effective_from'],
  },
  LIMITED_AUTONOMOUS_EXECUTE: {
    level: 'LIMITED_AUTONOMOUS_EXECUTE',
    requiredPartitions: ['rules', 'recommendations', 'edits', 'regression', 'autonomy'],
    minVerificationState: 'HUMAN_VERIFIED',
    requiredEvidenceFields: ['document_uid', 'clause', 'edition', 'effective_from'],
  },
};

/* ------------------------------------------------------------------ */
/*  ГАДАРГУУГИЙН ТӨЛӨВ — «ХАРАГДАХГҮЙ» ба «ЮУ Ч АЛГА» хоёрын ЯЛГАА     */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ ЭНЭ БОЛ ЭНЭ БЛОКИЙН ХАМГИЙН ЧУХАЛ ЭКСПОРТ.
 *
 * Релиз N нь `authority_level = 0` (OBSERVE, `surface: false`) дээр гарна
 * БА `rules` хүснэгт ХООСОН шипнэ (эзний шийдвэр Ш4).  Тиймээс гадаргуу нь
 * ГУРВАН ТЭГ-ийг зэрэг харуулна:
 *   · дүрэм байхгүй тул дүгнэлт үүсээгүй,
 *   · эрхийн түвшин харуулахыг зөвшөөрөөгүй,
 *   · үнэхээр шалгаад юу ч олдоогүй.
 * ГУРВУУЛАА «0 зөрчил» гэж харагдана.  Тэднийг ЯЛГААГҮЙ гаргах нь энэ
 * системийн гаргаж болох ХАМГИЙН МУУ ХУДАЛ мэдэгдэл: инженер
 * «нийцэж байна» гэж уншаад хянуулахаар илгээнэ.
 *
 * ⚠️ `evaluationStateOf` (2-3) нь «шалгагдав уу» гэдгийг хариулна; энэ нь
 *    түүн ДЭЭР эрхийн түвшинг нэмж «ХАРАГДАХ уу» гэдгийг хариулна.
 *    Хоёуланг нь нэг утга болгож нурааж БОЛОХГҮЙ — «шалгагдсан ч
 *    харуулахгүй» нь бүрэн хууль ёсны төлөв (LEVEL 0).
 */
export const SURFACE_STATES = [
  'suppressed_by_authority',
  'no_rule_pack',
  'never_run',
  'partial',
  'clean',
  'findings',
] as const;
export type SurfaceState = (typeof SURFACE_STATES)[number];

export interface SurfaceStateInput {
  readonly authority: AuthorityLevelInternal;
  readonly evaluationState: EvaluationState;
  /** Хэрэглэгчид ХАРУУЛАХААР үлдсэн (шүүсний дараах) дүгнэлтийн тоо. */
  readonly visibleCount: number;
  /**
   * ⚠️ ШҮҮЛТЭД УНАСАН, ГЭВЧ ОРШИЖ БУЙ дүгнэлтийн тоо (`min_severity`-ийн
   *    доор).  ЗААВАЛ ДАМЖУУЛНА — эс бөгөөс `visibleCount === 0` нь
   *    «дүгнэлт АЛГА» ба «дүгнэлт БИЙ, зүгээр л таны шүүлтээс доор» ХОЁРЫГ
   *    НЭГ утга болгож нурааж, гадаргуу «шалгаад цэвэр» гэж бичнэ.
   *
   *    Хэмжсэн (2026-08-31, бодит SQL): бүтэн скан + НЭЭЛТТЭЙ ГУРВАН
   *    MEDIUM `VIOLATION` дээр `min_severity = 'HIGH'` (0228-ийн анхдагч)
   *    үед `/findings/surface` нь `clean` буцааж «Дүрмийн багцаар шалгав —
   *    анхаарах зүйл олдсонгүй.» гэж бичдэг байв, ЯГ ТЭР үед §69-ийн
   *    хаалга `NOT_READY` + `MEDIUM: 3` гэж хэлж байлаа.  Нэг төсөл, нэг
   *    баримт, хоёр гадаргуу ЭСРЭГ хариулт — `readiness.ts`-ийн толгой
   *    ЯГ ЭНЭ зөрчилдөөнөөс сэргийлэхийг шаарддаг.
   *
   *    ⚠️ ШҮҮЛТ нь НУУХ үйлдэл, УСТГАХ БИШ.  «Би хараагүй» гэдэг нь «тэнд
   *    байхгүй» ГЭСЭН ҮГ БИШ.
   */
  readonly hiddenCount?: number;
}

export interface SurfaceRender {
  /** UI-д ЯГ ЭНЭ мөр гарна.  ⚠️ «баталгаажлаа» / «нийцэж байна» гэсэн үг ХЭЗЭЭ Ч БАЙХГҮЙ. */
  readonly labelMn: string;
  readonly labelEn: string;
  /** Мөр жагсаах эрхтэй эсэх. */
  readonly listsFindings: boolean;
}

/**
 * ⚠️ TOTAL Record.  ⚠️ `clean`-ийн бичвэрт «нийцлээ» гэсэн УТГА ОРОХГҮЙ —
 *    §69-R3 (v2:2238) «This should never be a legal certification».
 *    Зөвшөөрөгдсөн ХАМГИЙН ХҮЧТЭЙ хэллэг нь «дүрмийн багцаар шалгав».
 */
export const SURFACE_RENDER: Record<SurfaceState, SurfaceRender> = {
  suppressed_by_authority: {
    labelMn: 'Ажиглалт горим — дүрмийн үр дүн хараахан харагдахгүй.',
    labelEn: 'Observe mode — results are not surfaced yet.',
    listsFindings: false,
  },
  no_rule_pack: {
    labelMn: 'Дүрмийн багц ачаалагдаагүй — шалгалт хийгдээгүй.',
    labelEn: 'No rule pack loaded — nothing has been checked.',
    listsFindings: false,
  },
  never_run: {
    labelMn: 'Энэ төсөл дээр шалгалт хараахан ажиллаагүй.',
    labelEn: 'No check has run on this project yet.',
    listsFindings: true,
  },
  partial: {
    labelMn: 'Шалгалт хэсэгчилсэн — зарим дүрэм ажиллаж дуусаагүй.',
    labelEn: 'Partial check — some rules did not complete.',
    listsFindings: true,
  },
  clean: {
    labelMn: 'Дүрмийн багцаар шалгав — анхаарах зүйл олдсонгүй.',
    labelEn: 'Checked against the rule set — nothing to review.',
    listsFindings: true,
  },
  findings: {
    labelMn: 'Дүрмийн багцаар шалгав.',
    labelEn: 'Checked against the rule set.',
    listsFindings: true,
  },
};

/**
 * ⚠️ ДАРААЛАЛ АЧААЛАЛТАЙ.  Эрхийн түвшин нь ХАМГИЙН ТҮРҮҮНД шалгагдана:
 *    LEVEL 0 дээр «дүрмийн багц алга» гэж хэлэх нь ч ИЛҮҮ мэдээлэл (тэр нь
 *    системийн дотоод төлөвийг задлана) бөгөөд эзэн «яагаад миний багц
 *    ачаалагдсангүй» гэж буруу асуултын араас явна.  Харуулахгүй үед
 *    ГАНЦ хариулт нь «ажиглалт горим».
 */
export function surfaceStateOf(input: SurfaceStateInput): SurfaceState {
  if (!AUTHORITY_CAPS_INTERNAL[input.authority].surface) return 'suppressed_by_authority';
  if (input.evaluationState === 'no_rule_pack') return 'no_rule_pack';
  if (input.evaluationState === 'never_run') return 'never_run';
  if (input.visibleCount > 0) return 'findings';
  if (input.evaluationState === 'partial') return 'partial';
  // ⚠️ ХАМГИЙН СҮҮЛИЙН ХААЛГА.  `clean` бол ЦОРЫН ГАНЦ «шалгаад цэвэр»
  //    гэж уншигдах төлөв (`SURFACE_RENDER.clean.labelMn`), тиймээс түүн
  //    рүү орох зам нь ХАМГИЙН ХАТУУ байх ёстой: харагдах мөр ТЭГ байгаа нь
  //    мөр БАЙХГҮЙ гэсэн үг байж Л болно.  Шүүлтэд мөр унасан бол загварт
  //    зөрчил БИЙ — гадаргуу түүнийг «олдсонгүй» гэж бичих ЭРХГҮЙ.
  //    `findings` нь жагсаалт ХООСОН байлаа ч ЗӨВ: түүний шошго
  //    («Дүрмийн багцаар шалгав.») ямар ч ЦЭВЭР гэсэн мэдэгдэл агуулдаггүй
  //    ба маршрут нь `hidden_below_min_severity`-г ИЛ буцаадаг тул UI
  //    «N мөр таны ноцтой байдлын шүүлтээс доор» гэж тайлбарлаж чадна.
  if ((input.hiddenCount ?? 0) > 0) return 'findings';
  return 'clean';
}

/** `AUTHORITY_LEVELS`-ийн индекс — маршрут нь энэ тоог хариултад буцаана. */
export function authorityIndexOf(level: AuthorityLevelInternal): number {
  return AUTHORITY_LEVELS_INTERNAL.indexOf(level);
}

/* ================================================================== */
/*  2-7 — §59 БҮРЭН БҮТЭН БАЙДАЛ / БЭЛЭН БАЙДЛЫН ТОЛЬ                  */
/*                                                                     */
/*  ⚠️ ЭНЭ БЛОК НЬ ФАЙЛЫН ТӨГСГӨЛД НЭМЭГДСЭН.  Дээрх БҮХ экспорт нь    */
/*  `2-2` (үгсийн сан), `2-3` (амьдралын мөчлөг, бүртгэл) ба `2-5`     */
/*  (нотолгоо, эрх, гадаргуу) сессийнх — тэдгээрийг ХӨНДӨӨГҮЙ.         */
/*  `2-7` бол Track 2-ийн СҮҮЛИЙН сесс: доор ӨӨР БЛОК ОРОХГҮЙ.         */
/*                                                                     */
/*  ⚠️ ХААЛГАНЫ ТООЦООЛОЛ ЭНД БАЙХГҮЙ — тэр нь `lib/readiness.ts`-д.   */
/*  Энд ЗӨВХӨН ҮГСИЙН САН: юуг хэмжихийг оролдох вэ, аль нь өнөөдөр    */
/*  хэмжигдэхгүй вэ, тэдгээр нь ямар анги / ноцтой байдалтай вэ.       */
/* ================================================================== */

/**
 * v2 §59-R2-ын АРВАН нөхцөл, ЯГ ТЭР дарааллаар.
 *
 * ⚠️ Энэ бол ХААЛТТАЙ багц.  `Record<CompletenessCheck, …>` болгосон учир
 *    шинэ шалгуур нэмбэл `COMPLETENESS_SPEC` дээр compile алдаа гарна —
 *    `bimEvents.ts`-ийн `REQUIRED_PARTS_OF` ба `webPush.ts`-ийн
 *    `CATEGORY_OF`-той яг ижил заль.
 */
export const COMPLETENESS_CHECKS = [
  'required_categories', // 1. шаардлагатай ангилал дутуу
  'required_params', // 2. параметр дутуу
  'rooms', // 3. өрөө дутуу
  'openings', // 4. хаалга/цонх дутуу
  'sheets', // 5. хуудас дутуу
  'model_warnings', // 6. шийдэгдээгүй Revit сануулга
  'documentation', // 7. баримтжуулалт дутуу
  'unapproved_types', // 8. батлагдаагүй family/type
  'project_information', // 9. төслийн мэдээлэл дутуу
  'required_evidence', // 10. шаардлагатай нотолгоо дутуу
] as const;
export type CompletenessCheck = (typeof COMPLETENESS_CHECKS)[number];

export const isCompletenessCheck = (v: unknown): v is CompletenessCheck =>
  isMember(COMPLETENESS_CHECKS, v);

/**
 * ГУРВАН ТӨЛӨВ — `AccordionForm.isFilled` (`AccordionForm.tsx:41-49`)-ийн
 * шийдвэрийг ЗОРИУД давтав.
 *
 * ⚠️ `asserted_absent` ба `unknown`-ыг НЭГТГЭВЭЛ шинэ загвар бүр дээр бүх
 *    шалгуур «дутуу» болж, §66-ийн худал дохионы хамгийн том эх сурвалж
 *    болно.  Чагтлаагүй нүд нь «үгүй» биш, «ХЭЛЭЭГҮЙ».
 */
export const COMPLETENESS_STATES = ['unknown', 'asserted_absent', 'asserted_present'] as const;
export type CompletenessState = (typeof COMPLETENESS_STATES)[number];

/**
 * Дохионы эх сурвалж — §71-ийн «гар оролтгүй» зорилтын хэмжүүр.
 *
 * ⚠️ `manual` ба `detected`-ыг ЯЛГАХ нь ЗААВАЛ: «инженер чагтлахаа
 *    мартсан» ба «зураг үнэхээр байхгүй» хоёрыг ялгаагүй бол §66-ийн
 *    худал дохио болно.  Add-in хуудас илрүүлж эхлэхэд `sheets` нь
 *    `manual` → `detected` болно — ӨӨР ЮУ Ч засагдахгүй.
 */
export const COMPLETENESS_SOURCES = ['manual', 'detected', 'derived', 'unavailable'] as const;
export type CompletenessSource = (typeof COMPLETENESS_SOURCES)[number];

export interface CompletenessSpec {
  /** Монгол шошго — самбар ба хэвлэлд ЭНЭ гарна. */
  readonly label_mn: string;
  readonly label_en: string;
  /** §59-R3-ын таван ангиллын аль нь болох. */
  readonly issue_class: IssueClass;
  /** §67-ийн хэмжээс.  Хаалганы тооцоонд ЭНЭ орно. */
  readonly severity: Severity;
  /** Дохиог хаанаас авах вэ (2026-08-30-ны бодит боломж). */
  readonly source: CompletenessSource;
  /** `unavailable` бол ЯАГААД — самбарт ил гарна, чимээгүй нуугдахгүй. */
  readonly blocked_reason?: string;
}

/**
 * ⚠️ TOTAL Record — шинэ шалгуур нэмэх нь КОМПИЛЯЦИЙН АЛДАА.
 *
 * ⚠️ `model_warnings` ба `unapproved_types` нь `unavailable` — ЗОРИУД.
 *    Тэднийг «бүрэн» гэж дүр эсгэхээс илүү, шалгуур нь ХАРАГДАЖ байгаад
 *    «одоогоор хэмжигдэхгүй» гэж бичих нь §69-ийн бүх зорилготой нийцнэ
 *    (`run_golden.py:352-353`-ын философи).  Тэд бүрэн бүтэн байдлын
 *    хувийг БУУРУУЛАХГҮЙ — `countableCompletenessCheck` тэднийг хуваариас
 *    хасна.
 */
export const COMPLETENESS_SPEC: Record<CompletenessCheck, CompletenessSpec> = {
  required_categories: {
    label_mn: 'Шаардлагатай ангилал',
    label_en: 'Required categories',
    issue_class: 'PROJECT_INCOMPLETENESS',
    severity: 'HIGH',
    source: 'derived',
  },
  required_params: {
    label_mn: 'Дүрэмд шаардагдах параметр',
    label_en: 'Parameters required by rules',
    issue_class: 'MODEL_QUALITY',
    severity: 'MEDIUM',
    source: 'derived',
  },
  rooms: {
    label_mn: 'Өрөөний бүртгэл',
    label_en: 'Room schedule',
    issue_class: 'PROJECT_INCOMPLETENESS',
    severity: 'HIGH',
    source: 'derived',
  },
  openings: {
    label_mn: 'Хаалга, цонх',
    label_en: 'Doors and windows',
    issue_class: 'MODEL_QUALITY',
    severity: 'MEDIUM',
    source: 'derived',
  },
  sheets: {
    label_mn: 'Зургийн жагсаалт',
    label_en: 'Drawing list',
    issue_class: 'PROJECT_INCOMPLETENESS',
    severity: 'MEDIUM',
    // ⚠️ ӨНӨӨДРИЙН байдал.  Add-in харгалзах Revit хуудсыг илрүүлж эхэлбэл
    //    `detected` болно (§2.6) — тэр өдөр ЭНЭ мөр л өөрчлөгдөнө.
    source: 'manual',
  },
  model_warnings: {
    label_mn: 'Шийдэгдээгүй Revit сануулга',
    label_en: 'Unresolved Revit warnings',
    issue_class: 'MODEL_QUALITY',
    severity: 'LOW',
    source: 'unavailable',
    blocked_reason:
      'Add-in нь Revit-ийн Warning жагсаалтыг ОГТ уншдаггүй — `FailuresProcessing` / `GetWarnings` кодод байхгүй.',
  },
  documentation: {
    label_mn: 'Тайлбар бичгийн бөглөлт',
    label_en: 'Explanatory note completion',
    issue_class: 'PROJECT_INCOMPLETENESS',
    severity: 'LOW',
    source: 'derived',
  },
  unapproved_types: {
    label_mn: 'Батлагдаагүй family / type',
    label_en: 'Unvetted families / types',
    issue_class: 'TEAM_STANDARD',
    severity: 'MEDIUM',
    source: 'unavailable',
    blocked_reason:
      'Багийн «шалгасан family» жагсаалт репод БАЙХГҮЙ — эзний шийдвэр шаардлагатай.',
  },
  project_information: {
    label_mn: 'Төслийн ангилал ба өндөр',
    label_en: 'Project classification and height',
    issue_class: 'PROJECT_INCOMPLETENESS',
    // ⚠️ CRITICAL нь хэтрүүлэг БИШ: `project_build_context` хоосон бол
    //    ӨНДӨР БАРИЛГЫН дүрмийн багц ОГТ АЖИЛЛАХГҮЙ.  Тэр нь ЧИМЭЭГҮЙ
    //    байх ёсгүй — багц ажиллаагүйг «зөрчилгүй» гэж уншина.
    severity: 'CRITICAL',
    source: 'derived',
  },
  required_evidence: {
    label_mn: 'Шаардлагатай нотолгоо',
    label_en: 'Required evidence',
    issue_class: 'UNKNOWN_NEEDS_REVIEW',
    severity: 'LOW',
    source: 'derived',
  },
};

/**
 * Хуваарьт орох эсэх — `readiness.ts`-ийн `countable` талбарын ЦОРЫН ГАНЦ
 * эх сурвалж.  ⚠️ Маршрут энэ дүрмийг ДАХИН бичихгүй: `source` шалгах хоёр
 * газар үүсвэл нэг өдөр `model_warnings` хуваарьт орж, хувь мөнхөд 80%
 * дээр зогсоно.
 */
export function countableCompletenessCheck(check: CompletenessCheck): boolean {
  return COMPLETENESS_SPEC[check].source !== 'unavailable';
}

/**
 * `AccordionForm.isFilled`-ийн ГУРВАН ТӨЛӨВТ хувилбар.
 *
 * ⚠️ `false` нь `asserted_absent` — «үгүй гэж ХЭЛСЭН».  `null` /
 *    `undefined` нь `unknown` — «ХЭЛЭЭГҮЙ».  Хоёрыг нэгтгэвэл бүх шинэ
 *    загвар дээр 20 худал олдвор гарна (`AccordionForm.tsx:41-44`).
 */
export function completenessStateOfFlag(value: unknown): CompletenessState {
  if (value === null || value === undefined || value === '') return 'unknown';
  if (typeof value === 'boolean') return value ? 'asserted_present' : 'asserted_absent';
  if (Array.isArray(value)) return value.length > 0 ? 'asserted_present' : 'asserted_absent';
  if (typeof value === 'number') return Number.isFinite(value) ? 'asserted_present' : 'unknown';
  return 'asserted_present';
}

/**
 * ТООЛУУРААС төлөв — `observed > 0` бол «байна», `total > 0 && observed = 0`
 * бол «байхгүй гэж ХЭМЖЭГДСЭН», хэмжилт огт байхгүй бол `unknown`.
 *
 * ⚠️ `measured = false` (жишээ нь `qto_run` огт байхгүй) нь `asserted_absent`
 *    БИШ.  «Тоо хэмжээ илгээгээгүй» ба «өрөө байхгүй» хоёр ӨӨР — эхнийх нь
 *    хэмжигдээгүй, хоёр дахь нь хэмжигдсэн сөрөг хариулт.
 */
export function completenessStateOfCount(observed: number, measured: boolean): CompletenessState {
  if (!measured) return 'unknown';
  return observed > 0 ? 'asserted_present' : 'asserted_absent';
}
