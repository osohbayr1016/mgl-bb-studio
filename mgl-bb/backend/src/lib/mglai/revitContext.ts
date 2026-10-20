/**
 * MGL AI · REVIT КОНТЕКСТ + ҮЙЛДЛИЙН ГЭРЭЭ (§22, §23).
 *
 * ⚠️ БҮХЭЛ ЗАГВАРЫГ PROMPT-Д ХИЙХГҮЙ (§22).  Нэг .rvt нь хэдэн зуун
 *    мянган элементтэй; түүнийг 4K контекстэд шахах нь боломжгүй бөгөөд
 *    оролдох нь утгагүй.  Тиймээс add-in нь ХУРААНГУЙ илгээж, загвар
 *    гүнзгий мэдээллийг ХЭРЭГСЛЭЭР асууна.
 *
 * ⚠️ ЭНЭ ФАЙЛ ЦЭВЭР.  D1 хамааралгүй — `node --test`-ээр бүрэн
 *    хэмжигдэнэ.  Revit-тэй ярих нь add-in-ийн ажил
 *    (`revit-mcp/addin/RevitToolBus.cs`), сервер нь ГЭРЭЭГ барина.
 *
 * ⚠️ ЭЛЕМЕНТИЙН ТООГ БҮТЭЭМЖИД ХЭРЭГЛЭХГҮЙ.  Эзний 2026-08-26-ны
 *    шийдвэр (`revit-ai-progress-push-plan`): тайланд элементийн тоо
 *    ХОРИОТОЙ.  Энэ файлын хураангуй нь ЗАГВАРТ контекст өгөх зорилготой
 *    бөгөөд ажилтныг ХЭМЖИХ зорилгогүй.
 */

/** Add-in-ээс ирэх түүхий контекст. */
export interface RawRevitContext {
  issuesTotal?: unknown;
  productionRules?: unknown;
  isTestFixture?: unknown;
  report?: unknown;
  docTitle?: unknown;
  docUid?: unknown;
  revitVersion?: unknown;
  activeViewName?: unknown;
  activeViewType?: unknown;
  levelName?: unknown;
  selection?: unknown;
  warnings?: unknown;
  projectId?: unknown;
  transactionOpen?: unknown;
}

/**
 * Сонгосон элементийн ХЭМЖСЭН утга — add-in-ийн `Measure` (Session R `UnitsBoundary`):
 * `source` нь BUILTIN_GEOMETRY | TYPED_PARAM Л (UntypedParam ХЭЗЭЭ Ч — mixed_provenance).
 * Энэ нь ИТГЭМЖЛЭГДСЭН БАРИМТ болно (`trustedFacts` authority `revit_model`): загвар
 * тоог ЗӨВХӨН эндээс, эх сурвалжийн шошго REVIT_MODEL.
 */
export interface RevitMeasure {
  name: string;
  value: number;
  unit: 'MM' | 'M' | 'M2' | 'M3' | 'DEG';
  source: 'BUILTIN_GEOMETRY' | 'TYPED_PARAM';
}

export interface SelectedElement {
  id: string;
  category: string;
  family: string | null;
  type: string | null;
  name: string | null;
  level: string | null;
  /** ⚠️ ТАСЛАГДСАН (`MAX_MEASURES`); хоосон = хэмжээ ирээгүй (хуучин add-in). */
  measures: RevitMeasure[];
  /** Энэ элементийн ДЕТЕРМИНИСТ асуудал (add-in IssueStore) — ≤ MAX_ISSUES; ангилал ХЭЗЭЭ Ч дээшлэхгүй. */
  issues: RevitIssue[];
}

export type RevitIssueClass = 'VERIFIED_NORM' | 'MODEL_QUALITY' | 'REVIEW_CANDIDATE';
export interface RevitIssue {
  class: RevitIssueClass;
  severity: string;
  status: string;
  rule_id: string | null;
  source: string | null;
  synthetic: boolean;
  authoritative: boolean;
  title: string | null;
}
export const MAX_ISSUES = 8;
const ISSUE_CLASSES = new Set<RevitIssueClass>(['VERIFIED_NORM', 'MODEL_QUALITY', 'REVIEW_CANDIDATE']);

function parseIssues(raw: unknown): RevitIssue[] {
  if (!Array.isArray(raw)) return [];
  const out: RevitIssue[] = [];
  for (const it of raw) {
    if (out.length >= MAX_ISSUES) break;
    if (!it || typeof it !== 'object') continue;
    const r = it as Record<string, unknown>;
    const cls = typeof r.class === 'string' ? r.class : '';
    if (!ISSUE_CLASSES.has(cls as RevitIssueClass)) continue;
    const synthetic = r.synthetic === true || r.source === 'SYNTHETIC';
    out.push({
      class: cls as RevitIssueClass,
      severity: s(r.severity, 16) ?? 'INFO',
      status: s(r.status, 32) ?? 'OPEN',
      rule_id: s(r.rule_id, 64),
      source: s(r.source, 32),
      synthetic,
      // ⚠️ Синтетик/REVIEW_CANDIDATE нь ХЭЗЭЭ Ч эрх бүхий биш — add-in юу гэж хэлснээс үл хамааран.
      authoritative: r.authoritative === true && cls === 'VERIFIED_NORM' && !synthetic,
      title: s(r.title, 120),
    });
  }
  return out;
}

/** Нэг элементэд авах хэмжээний тааз — prompt-ыг дүүргэхгүй. */
export const MAX_MEASURES = 12;
const MEASURE_NAME = /^[a-z][a-z0-9_]{1,31}$/;
const MEASURE_UNITS = new Set(['MM', 'M', 'M2', 'M3', 'DEG']);
const MEASURE_SOURCES = new Set(['BUILTIN_GEOMETRY', 'TYPED_PARAM']);

function parseMeasures(raw: unknown): RevitMeasure[] {
  if (!Array.isArray(raw)) return [];
  const out: RevitMeasure[] = [];
  const seen = new Set<string>();
  for (const m of raw) {
    if (out.length >= MAX_MEASURES) break;
    if (!m || typeof m !== 'object') continue;
    const r = m as Record<string, unknown>;
    const name = typeof r.name === 'string' ? r.name : '';
    const unit = typeof r.unit === 'string' ? r.unit.toUpperCase() : '';
    const source = typeof r.source === 'string' ? r.source : '';
    const value = typeof r.value === 'number' ? r.value : Number.NaN;
    if (!MEASURE_NAME.test(name) || seen.has(name)) continue;
    if (!MEASURE_UNITS.has(unit) || !MEASURE_SOURCES.has(source)) continue;
    if (!Number.isFinite(value) || r.missing === true) continue;
    seen.add(name);
    out.push({ name, value: Math.round(value * 1000) / 1000, unit: unit as RevitMeasure['unit'], source: source as RevitMeasure['source'] });
  }
  return out;
}

export interface RevitContext {
  docTitle: string | null;
  docUid: string | null;
  revitVersion: string | null;
  activeViewName: string | null;
  activeViewType: string | null;
  levelName: string | null;
  /** ⚠️ ТАСЛАГДСАН жагсаалт — доорх `MAX_ELEMENTS`-ээс хэтрэхгүй. */
  selection: SelectedElement[];
  selectionTotal: number;
  warningCount: number;
  projectId: number | null;
  transactionOpen: boolean;
  /** Баримт дахь нээлттэй детерминист асуудлын нийт тоо (add-in IssueStore); null = add-in илгээгээгүй. */
  issuesTotal: number | null;
  /** Продакшны BIM дүрмийн төлөв — add-in-ээс (`NO_EXECUTABLE_BIM_RULES`); null = мэдэгдээгүй. */
  productionRules: string | null;
  /** MGL-AI-TEST синтетик баримт — хариултад «синтетик тест загвар» заавал. */
  isTestFixture: boolean;
  /** Детерминист тайлангийн нотолгоо (add-in ReportEvidenceBuilder) — тайлангийн асуултад л ирнэ. */
  report: RevitReportWire | null;
}

export interface RevitReportFactWire {
  kind: string;
  value: string | null;
  number: number | null;
  unit: string | null;
  source: string | null;
  subject: string | null;
  observed_at: string | null;
}
export interface RevitReportWire {
  period: string;
  audience: string;
  period_start: string | null;
  period_end: string | null;
  title: string | null;
  lines: string[];
  facts: RevitReportFactWire[];
  progress_estimate: 'PROGRESS_ESTIMATE_UNAVAILABLE';
}
const MAX_REPORT_LINES = 40;
const MAX_REPORT_FACTS = 60;

function parseReport(raw: unknown): RevitReportWire | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const lines = Array.isArray(r.lines) ? (r.lines as unknown[]).filter((l): l is string => typeof l === 'string' && l.trim().length > 0).slice(0, MAX_REPORT_LINES).map((l) => l.trim().slice(0, 300)) : [];
  const facts: RevitReportFactWire[] = [];
  if (Array.isArray(r.facts)) {
    for (const f of (r.facts as unknown[]).slice(0, MAX_REPORT_FACTS)) {
      if (!f || typeof f !== 'object') continue;
      const x = f as Record<string, unknown>;
      const kind = s(x.kind, 48);
      if (!kind) continue;
      facts.push({
        kind,
        value: s(x.value, 200),
        number: typeof x.number === 'number' && Number.isFinite(x.number) ? x.number : null,
        unit: s(x.unit, 16),
        source: s(x.source, 32),
        subject: s(x.subject, 120),
        observed_at: s(x.observed_at, 40),
      });
    }
  }
  if (lines.length === 0 && facts.length === 0) return null;
  return {
    period: s(r.period, 24) ?? 'TODAY',
    audience: s(r.audience, 32) ?? 'TECHNICAL_SELF_REPORT',
    period_start: s(r.period_start, 40),
    period_end: s(r.period_end, 40),
    title: s(r.title, 160),
    lines,
    facts,
    // ⚠️ Явцын хувь ХЭЗЭЭ Ч тайланд байхгүй (R-8) — add-in юу ч илгээсэн энэ тогтмол.
    progress_estimate: 'PROGRESS_ESTIMATE_UNAVAILABLE',
  };
}

/**
 * ⚠️ КОНТЕКСТ ШАХАЛТЫН ТААЗ.  25 элемент нь ~700 тэмдэгт — 4K контекстын
 *    ~5%.  Илүү нь prompt-ыг дүүргэж, нормын нотолгоог шахна.  Загвар
 *    илүү элемент хэрэгтэй бол ХЭРЭГСЛЭЭР асууна (§22).
 */
export const MAX_ELEMENTS = 25;
const MAX_STR = 120;

function s(v: unknown, max = MAX_STR): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length === 0 ? null : t.slice(0, max);
}

export function parseRevitContext(raw: RawRevitContext | null | undefined): RevitContext {
  const empty: RevitContext = {
    docTitle: null,
    docUid: null,
    revitVersion: null,
    activeViewName: null,
    activeViewType: null,
    levelName: null,
    selection: [],
    selectionTotal: 0,
    warningCount: 0,
    projectId: null,
    transactionOpen: false,
    issuesTotal: null,
    productionRules: null,
    isTestFixture: false,
    report: null,
  };
  if (!raw || typeof raw !== 'object') return empty;

  const rawSel = Array.isArray(raw.selection) ? raw.selection : [];
  const selection: SelectedElement[] = [];
  for (const e of rawSel.slice(0, MAX_ELEMENTS)) {
    if (!e || typeof e !== 'object') continue;
    const r = e as Record<string, unknown>;
    const id = s(r.id, 32) ?? (typeof r.id === 'number' ? String(r.id) : null);
    if (id === null) continue;
    selection.push({
      id,
      category: s(r.category, 64) ?? 'тодорхойгүй',
      family: s(r.family, 64),
      type: s(r.type, 64),
      name: s(r.name, 64),
      level: s(r.level, 64),
      measures: parseMeasures(r.measures),
      issues: parseIssues(r.issues),
    });
  }

  const warnings = Number(raw.warnings);
  const projectId = Number(raw.projectId);

  return {
    docTitle: s(raw.docTitle),
    docUid: s(raw.docUid, 64),
    revitVersion: s(raw.revitVersion, 16),
    activeViewName: s(raw.activeViewName),
    activeViewType: s(raw.activeViewType, 48),
    levelName: s(raw.levelName, 64),
    selection,
    // ⚠️ НИЙТ тоог ҮНЭНЭЭР хэлнэ — таслагдсаныг нуух нь загварыг
    //    «17 хана л сонгосон» гэж бодуулна.
    selectionTotal: rawSel.length,
    warningCount: Number.isFinite(warnings) && warnings >= 0 ? Math.round(warnings) : 0,
    projectId: Number.isInteger(projectId) && projectId > 0 ? projectId : null,
    transactionOpen: raw.transactionOpen === true,
    issuesTotal: typeof raw.issuesTotal === 'number' && Number.isFinite(raw.issuesTotal) && raw.issuesTotal >= 0 ? Math.round(raw.issuesTotal) : null,
    productionRules: s(raw.productionRules, 40),
    isTestFixture: raw.isTestFixture === true,
    report: parseReport(raw.report),
  };
}

export const REVIT_REPORT_TOOL = 'revit_report';

/**
 * Детерминист тайлан → `revit_report` хэрэгслийн үр дүн (R3.5, Q3).  Тайлангийн мөр, баримт ЯГ хэвээр;
 * `progress_estimate` үргэлж PROGRESS_ESTIMATE_UNAVAILABLE; хувь/ажилтны үйл ажиллагаа энд БАЙХГҮЙ тул
 * загвар зохиовол UNSUPPORTED_NUMBER/FORBIDDEN_PHRASE-ээр хасагдана.
 */
export function revitReportTool(ctx: RevitContext): { tool: string; ok: true; data: Record<string, unknown> } | null {
  if (!ctx.report) return null;
  return {
    tool: REVIT_REPORT_TOOL,
    ok: true,
    data: {
      source: REVIT_SOURCE_LABEL,
      document: ctx.docTitle,
      document_is_test_fixture: ctx.isTestFixture,
      period: ctx.report.period,
      period_start: ctx.report.period_start,
      period_end: ctx.report.period_end,
      audience: ctx.report.audience,
      title: ctx.report.title,
      lines: ctx.report.lines,
      facts: ctx.report.facts,
      fact_count: ctx.report.facts.length,
      progress_estimate: ctx.report.progress_estimate,
    },
  };
}

/**
 * Prompt-д шигтгэх НЭГ ХУРААНГУЙ МӨР.
 *
 * ⚠️ Богино байх нь зорилго.  `promptFrame.ts` нь үүнийг систем зааварт
 *    шигтгэдэг тул урт нь бүх ярианы ээлж бүрд төлөгдөнө.
 */
export function summarizeRevit(ctx: RevitContext): string | null {
  if (ctx.docTitle === null && ctx.selection.length === 0) return null;

  const parts: string[] = [];
  if (ctx.docTitle) parts.push(`файл «${ctx.docTitle}»`);
  if (ctx.revitVersion) parts.push(`Revit ${ctx.revitVersion}`);
  if (ctx.activeViewName) {
    parts.push(`харагдац «${ctx.activeViewName}»${ctx.activeViewType ? ` (${ctx.activeViewType})` : ''}`);
  }
  if (ctx.levelName) parts.push(`давхар «${ctx.levelName}»`);

  if (ctx.selectionTotal > 0) {
    const byCat = new Map<string, number>();
    for (const e of ctx.selection) byCat.set(e.category, (byCat.get(e.category) ?? 0) + 1);
    const cats = [...byCat.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([c, n]) => `${c}×${n}`)
      .join(', ');
    const truncated = ctx.selectionTotal > ctx.selection.length;
    parts.push(
      `сонгосон ${ctx.selectionTotal} элемент (${cats}${truncated ? `, эхний ${ctx.selection.length}-г л жагсаав` : ''})`,
    );
  }

  if (ctx.warningCount > 0) parts.push(`${ctx.warningCount} анхааруулга`);
  if (ctx.transactionOpen) parts.push('⚠️ нээлттэй гүйлгээ');

  return parts.join(' · ');
}

/* ================================================================== */
/*  Сонгосон элементийн ХЭМЖЭЭ → синтетик хэрэгслийн үр дүн            */
/* ================================================================== */

/** Хэмжээтэй элементийн тааз — 3 элемент × ≤12 хэмжээ (~600 тэмдэгт). */
export const MAX_MEASURED_ELEMENTS = 3;
export const REVIT_SELECTION_TOOL = 'revit_selection';
export const REVIT_SOURCE_LABEL = 'REVIT_MODEL';

/**
 * Сонгосон элементийн хэмжээг `revit_selection` ХЭРЭГСЛИЙН ҮР ДҮН болгоно (R3.5, 2026-09-15).
 *
 * ⚠️ ЯАГААД хэрэгсэл: ERP хэрэгслийн үр дүнтэй ЯГ ИЖИЛ зам — prompt-ын хайрцаг,
 *    `factsFromTools` (authority `revit_model`), `allowedNumbers`, `grounded` гэрээ.  Бодит Qwen
 *    smoke (Q1 «Энэ юу вэ?») дээр хэмжсэн: хуучин утас зөвхөн id/category/family/type тээж байсан тул
 *    200/10 000/3 000 мм загварт ХҮРДЭГГҮЙ, хариулт хэмжээгүй байв.  Энэ нь СЕРВЕР үүсгэдэг —
 *    клиент `tool_results`-оор `revit_selection` илгээж чадахгүй (`isKnownTool`-д байхгүй).
 *
 * Гаралт: элемент бүр хавтгай `<name>: value` (numbersInData → allowedNumbers) + `units`.
 * Хэмжээгүй сонголт → null (хуучин add-in, эсвэл сонголтгүй).
 */
export function revitSelectionTool(ctx: RevitContext): { tool: string; ok: true; data: Record<string, unknown> } | null {
  const measured = ctx.selection.filter((e) => e.measures.length > 0 || e.issues.length > 0).slice(0, MAX_MEASURED_ELEMENTS);
  if (measured.length === 0) return null;
  const elements = measured.map((e) => {
    const row: Record<string, unknown> = { id: e.id, category: e.category, family: e.family, type: e.type, name: e.name, level: e.level };
    const units: Record<string, string> = {};
    for (const m of e.measures) {
      row[m.name] = m.value;
      units[m.name] = m.unit;
    }
    row.units = units;
    row.measure_source = e.measures.every((m) => m.source === 'BUILTIN_GEOMETRY') ? 'BUILTIN_GEOMETRY' : 'TYPED_PARAM';
    // Детерминист асуудал — ЯГ хэвээр (класс, статус, синтетик тэмдэг); хоосон массив = «олдсонгүй».
    row.issue_count = e.issues.length;
    row.issues = e.issues.map((i) => ({ class: i.class, severity: i.severity, status: i.status, rule_id: i.rule_id, source: i.source, synthetic: i.synthetic, authoritative: i.authoritative, title: i.title }));
    return row;
  });
  return {
    tool: REVIT_SELECTION_TOOL,
    ok: true,
    data: {
      source: REVIT_SOURCE_LABEL,
      selected_total: ctx.selectionTotal,
      measured_count: measured.length,
      document: ctx.docTitle,
      // Продакшны BIM дүрэм — add-in-ийн мэдэгдэл; байхгүй бол ч эрх бүхий дүрэм БАЙХГҮЙ гэж үзнэ (R-13).
      production_rules: ctx.productionRules ?? 'NO_EXECUTABLE_BIM_RULES',
      document_is_test_fixture: ctx.isTestFixture,
      issues_total_in_document: ctx.issuesTotal,
      elements,
    },
  };
}

/* ================================================================== */
/*  Урьдчилан харах — БИЧИХ ҮЙЛДЛИЙН ГЭРЭЭ (§24)                       */
/* ================================================================== */

export interface ChangePreview {
  /** Ямар хэрэгсэл. */
  tool: string;
  /** Монголоор, хүн уншихаар. */
  summaryMn: string;
  /** Хөндөгдөх элементийн ТОО — «17 хана өөрчлөгдөнө». */
  affectedCount: number;
  /** Хөндөгдөх элементийн ID (таслагдсан). */
  affectedIds: string[];
  /** Юу → юу болох. */
  changes: { field: string; from: string | null; to: string }[];
  /** Яагаад — загварын үндэслэл. */
  reasonMn: string;
  /** Буцаах боломжтой эсэх. */
  reversible: boolean;
}

/**
 * ⚠️ УРЬДЧИЛАН ХАРАХГҮЙГЭЭР БИЧИХГҮЙ.  §24: «Default writes should show a
 *    preview».  Энэ функц нь урьдчилсан харагдац БҮРЭН эсэхийг шалгана —
 *    дутуу preview нь хэрэглэгчийг сохроор зөвшөөрүүлнэ.
 */
export type PreviewProblem =
  | 'no_summary'
  | 'no_reason'
  | 'zero_affected'
  | 'count_mismatch'
  | 'no_changes';

export function validatePreview(p: ChangePreview): PreviewProblem[] {
  const out: PreviewProblem[] = [];
  if (p.summaryMn.trim().length === 0) out.push('no_summary');
  if (p.reasonMn.trim().length === 0) out.push('no_reason');
  if (p.affectedCount <= 0) out.push('zero_affected');
  // ⚠️ ID-ийн жагсаалт нь ТАСЛАГДАЖ болно, гэвч тоо нь жагсаалтаас БАГА
  //    байж БОЛОХГҮЙ — тэр нь хуурамч тайван байдал өгнө.
  if (p.affectedCount < p.affectedIds.length) out.push('count_mismatch');
  if (p.changes.length === 0) out.push('no_changes');
  return out;
}

/** Баталгаажуулах цонхонд харуулах текст. */
export function renderPreviewMn(p: ChangePreview): string {
  const lines: string[] = [
    `MGL AI дараах өөрчлөлтийг хийх гэж байна:`,
    ``,
    `  ${p.summaryMn}`,
    `  Хөндөгдөх элемент: ${p.affectedCount}`,
  ];
  if (p.affectedIds.length > 0) {
    const shown = p.affectedIds.slice(0, 10).join(', ');
    const more = p.affectedIds.length > 10 ? ` … (+${p.affectedIds.length - 10})` : '';
    lines.push(`  ID: ${shown}${more}`);
  }
  lines.push('');
  for (const c of p.changes) {
    lines.push(`  ${c.field}: ${c.from ?? '(хоосон)'} → ${c.to}`);
  }
  lines.push('');
  lines.push(`  Шалтгаан: ${p.reasonMn}`);
  lines.push(
    p.reversible
      ? `  Буцаах: боломжтой (Revit-ийн Undo)`
      : `  ⚠️ Буцаах: БОЛОМЖГҮЙ — сайтар шалгана уу`,
  );
  return lines.join('\n');
}
