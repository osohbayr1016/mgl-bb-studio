/**
 * MGL AI · НОРМЫН ХӨРВҮҮЛЭГЧ — БД 21-101-12 адаптер («тэсрэх, шатах галын
 * аюулын ангилал»).  Багцын хэлбэр: room/v/building_category_rules.jsonl +
 * formulas.jsonl + knowledge_chunks.jsonl + calculation_cases.jsonl.
 *
 * ⚠️ АДАПТЕР НЬ ЭХ СУРВАЛЖИЙГ ЗАСДАГГҮЙ.  Багцын бичлэг бүр ЯГ хэвээр
 *    (id, хуудас, баталгаажилт); адаптер зөвхөн ХЭЛБЭРИЙГ канон болгоно.
 *    Эх бичвэр ба гүйцэтгэх бичлэг санал нийлэхгүй утга дээр (28 °C) —
 *    аль нэгийг СОНГОХГҮЙ, `boundaryConflicts`-д ил бичнэ (Amendment C).
 *
 * ⚠️ ТООН УТГА БҮР ФАЙЛААС.  4.4-ийн 80%, 4.2-ын 120 с / 300 с / 0.000001,
 *    4.20.b4-ийн 12 м — бүгд заалтын бичвэрээс regex-ээр гарна; бичвэр
 *    өөрчлөгдвөл хөрвүүлэлт ЗОГСОНО, чимээгүй хуучин тоо үлдэхгүй.
 */
import { join } from 'node:path';
import { datasetIdentity } from '../../../retrieval/src/datasetIdentity.ts';
import { isExecutableVerification } from '../../../retrieval/src/rules.ts';
import { currentnessOfRaw } from '../currentness.ts';
import { has, num, readJson, readJsonl, str, strList, type Row } from '../io.ts';
import type {
  CompiledBoundaryConflict,
  CompiledCase,
  CompiledClause,
  CompiledDocument,
  CompiledFormula,
  CompiledPredicate,
  CompiledProvenance,
  CompiledRule,
} from '../model.ts';

export const BD_ADAPTER_ID = 'bd-21-101-12';
export const BD_ADAPTER_VERSION = 'bd-21-101-12/1';

/** Багцын таних тэмдэгт ОРОХ файлууд — локал шингээлт ИЖИЛ жагсаалт хэрэглэнэ. */
export const BD_IDENTITY_FILES: readonly string[] = [
  'document.json',
  'manifest.json',
  'knowledge_chunks.jsonl',
  'room_category_rules.jsonl',
  'v_subcategory_rules.jsonl',
  'building_category_rules.jsonl',
  'formulas.jsonl',
  'reference_tables.json',
  'calculation_cases.jsonl',
  'classification_decision_tree.json',
  'aliases.json',
  'keyword_alias_index.jsonl',
  'qa_retrieval_tests.jsonl',
];

/** Энэ хэлбэрийг таних тэмдэг: хоёр файл ХОЁУЛАА ≥1 байт (УББ 12-01-01-ийн 0-байт урхи). */
export function detectBd(folder: string, size: (file: string) => number): boolean {
  return (
    has(folder, 'room_category_rules.jsonl') &&
    has(folder, 'v_subcategory_rules.jsonl') &&
    size('room_category_rules.jsonl') > 0 &&
    size('v_subcategory_rules.jsonl') > 0
  );
}

/* ── Нөхцөл → предикат (ерөнхий хөрвүүлэлт) ────────────────────────── */

const CMP: Record<string, '>' | '>=' | '<' | '<=' | '='> = { gt: '>', gte: '>=', lt: '<', lte: '<=', eq: '=' };

export function toPredicate(raw: unknown): CompiledPredicate | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Row;
  if (Array.isArray(o.any)) return { kind: 'any', of: o.any.map(toPredicate).filter((p): p is CompiledPredicate => p !== null) };
  if (Array.isArray(o.all)) return { kind: 'all', of: o.all.map(toPredicate).filter((p): p is CompiledPredicate => p !== null) };
  const keys = Object.keys(o);
  if (keys.length !== 1) throw new Error(`нөхцөлийн объект нэг түлхүүртэй байх ёстой: ${JSON.stringify(o)}`);
  const field = keys[0]!;
  const v = o[field];
  if (field === 'not_category' || field === 'not_building_category') {
    return { kind: 'not_category', categories: Array.isArray(v) ? strList(v) : v === undefined ? [] : [String(v)] };
  }
  if (Array.isArray(v)) return { kind: 'enum', field, in: strList(v) };
  if (typeof v === 'boolean') return { kind: 'flag', field, value: v };
  if (typeof v === 'object' && v !== null) {
    const c = v as Row;
    const min = num(c.min);
    const max = num(c.max);
    if (min !== null && max !== null) return { kind: 'number', field, op: 'between', value: [min, max], unit: null };
    if (min !== null) return { kind: 'number', field, op: '>=', value: min, unit: null };
    if (max !== null) return { kind: 'number', field, op: '<=', value: max, unit: null };
    for (const k of Object.keys(CMP)) {
      const n = num(c[k]);
      if (n !== null) return { kind: 'number', field, op: CMP[k]!, value: n, unit: null };
    }
    // Ангилалтай хэмжигдэхүүн ({category:'А', gt:5}) — барилгын дүрэм, гүйцэтгэхгүй.
    return null;
  }
  throw new Error(`танигдахгүй нөхцөл: ${JSON.stringify(o)}`);
}

/* ── Хилийн зөрчил: гүйцэтгэх харьцуулагч vs эх бичвэрийн хэллэг ─────── */

const UNIT = String.raw`(?:°\s*C|°\s*С|кПа|МДж\s*\/\s*м²|м²|м³|м|%|с)?`;

/** Эх бичвэрт тухайн тоо ямар ХАТУУ/БАГТААСАН харьцуулагчаар орсон бэ. */
export function proseComparator(text: string, value: number): '<' | '>' | '>=' | '<=' | null {
  const v = String(value).replace('.', '[.,]');
  const re = new RegExp(`(?<![\\d.,])${v}\\s*${UNIT}\\s*-?\\s*(?:аас|ээс|оос|өөс)\\s+(багагүй|ихгүй|бага|их|илүү|дээш|доош)`, 'iu');
  const m = re.exec(text);
  if (!m) return null;
  switch (m[1]!.toLowerCase()) {
    case 'багагүй':
    case 'дээш':
      return '>=';
    case 'ихгүй':
    case 'доош':
      return '<=';
    case 'бага':
      return '<';
    case 'их':
    case 'илүү':
      return '>';
    default:
      return null;
  }
}

function numberLeaves(p: CompiledPredicate | null): Extract<CompiledPredicate, { kind: 'number' }>[] {
  if (p === null) return [];
  if (p.kind === 'number') return [p];
  if (p.kind === 'any' || p.kind === 'all') return p.of.flatMap(numberLeaves);
  return [];
}

export function boundaryConflicts(predicate: CompiledPredicate | null, prose: string): CompiledBoundaryConflict[] {
  const out: CompiledBoundaryConflict[] = [];
  for (const leaf of numberLeaves(predicate)) {
    if (leaf.op === 'between' || leaf.op === '=') continue;
    const pv = proseComparator(prose, leaf.value as number);
    if (pv === null || pv === leaf.op) continue;
    out.push({
      field: leaf.field,
      value: leaf.value as number,
      executableOp: leaf.op,
      proseOp: pv,
      reason: 'source_boundary_conflict',
      detailMn: `Гүйцэтгэх бичлэг «${leaf.op} ${leaf.value}», эх бичвэр «${pv} ${leaf.value}» — яг ${leaf.value} дээр санал нийлэхгүй.`,
    });
  }
  return out;
}

/* ── Туслах ─────────────────────────────────────────────────────────── */

function prov(docId: string, code: string, recordId: string, p: Partial<CompiledProvenance>, verification: string): CompiledProvenance {
  return {
    documentId: docId,
    documentCode: code,
    recordId,
    section: p.section ?? null,
    clause: p.clause ?? null,
    table: p.table ?? null,
    formula: p.formula ?? null,
    page: p.page ?? null,
    verificationStatus: verification,
  };
}

function mustNumber(text: string, re: RegExp, what: string): number {
  const m = re.exec(text);
  if (!m?.[1]) throw new Error(`${what}: заалтын бичвэрээс тоо олдсонгүй — «${text.slice(0, 80)}…»`);
  return Number(m[1].replace(',', '.'));
}

/** Хүснэгт 4-ийн мөрийн проз — python-dict repr-ийн оронд (хэсгийн бичвэр ч үүгээр солигдоно). */
function vRuleDescription(category: string, table4: Row[], method: string | null): string {
  const row = table4.find((r) => r.category === category);
  const range = str(row?.g_mj_m2) ?? '';
  const methodText = str(row?.method) ?? method ?? '';
  return `${category} ангилал: хувийн галын ачаалал g ${/^[><]/.test(range) ? range : `= ${range.replace('-', '–')}`} МДж/м² (Хүснэгт 4)${methodText ? `; арга: ${methodText}` : ''}.`;
}

/* ── Гол хөрвүүлэлт ─────────────────────────────────────────────────── */

export function compileBd(folder: string): CompiledDocument {
  const doc = readJson(join(folder, 'document.json')) as Row;
  const manifest = has(folder, 'manifest.json') ? (readJson(join(folder, 'manifest.json')) as Row) : {};
  const docId = String(doc.doc_id);
  const code = String(doc.code);
  const chunks = readJsonl(join(folder, 'knowledge_chunks.jsonl'));
  const roomRows = readJsonl(join(folder, 'room_category_rules.jsonl'));
  const vRows = readJsonl(join(folder, 'v_subcategory_rules.jsonl'));
  const buildingRows = readJsonl(join(folder, 'building_category_rules.jsonl'));
  const formulaRows = readJsonl(join(folder, 'formulas.jsonl'));
  const caseRows = readJsonl(join(folder, 'calculation_cases.jsonl'));
  const tables = has(folder, 'reference_tables.json') ? (readJson(join(folder, 'reference_tables.json')) as Record<string, unknown>) : {};
  const tree = has(folder, 'classification_decision_tree.json') ? (readJson(join(folder, 'classification_decision_tree.json')) as Row) : {};
  const aliasFile = has(folder, 'aliases.json') ? (readJson(join(folder, 'aliases.json')) as unknown) : [];

  const chunkById = new Map(chunks.map((c) => [String(c.chunk_id), c] as const));
  const clauseText = (id: string): string => {
    const c = chunkById.get(`${docId}:clause:${id}`);
    if (!c) throw new Error(`хэсэг олдсонгүй: ${docId}:clause:${id}`);
    return String(c.text_mn ?? '');
  };
  const clausePage = (id: string): number | null => num(chunkById.get(`${docId}:clause:${id}`)?.page);

  const table4 = Array.isArray(tables.table_4_specific_fire_load_categories) ? (tables.table_4_specific_fire_load_categories as Row[]) : [];
  const treeChecks = (category: string): string => {
    const logic = Array.isArray(tree.room_category_logic) ? (tree.room_category_logic as Row[]) : [];
    const entry = logic.find((l) => l.category === category);
    return strList(entry?.checks).join(' ');
  };

  const rules: CompiledRule[] = [];
  const cleanChunkText = new Map<string, string>();

  // Өрөөний ангилал — Хүснэгт 1, х.4
  for (const r of roomRows) {
    const id = String(r.rule_id);
    const verification = String(r.verification_status ?? 'unknown');
    const predicate = toPredicate(r.conditions);
    const conflicts = [...boundaryConflicts(predicate, String(r.description_mn ?? '')), ...englishConflicts(predicate, treeChecks(String(r.category)))];
    rules.push({
      ruleId: id,
      family: 'room_category',
      category: str(r.category),
      priority: num(r.priority) ?? rules.length + 1,
      predicate,
      method: null,
      descriptionMn: String(r.description_mn ?? ''),
      reviewNote: str(r.review_note),
      value: null,
      provenance: prov(docId, code, id, { table: num(r.table), page: num(r.page), section: '3.1' }, verification),
      executable: isExecutableVerification(verification),
      boundaryConflicts: dedupeConflicts(conflicts),
    });
  }

  // В дэд ангилал — Хүснэгт 4, х.13
  for (const r of vRows) {
    const id = String(r.rule_id);
    const verification = String(r.verification_status ?? 'unknown');
    const predicate = toPredicate({ g_mj_m2: r.g_mj_m2 });
    const category = String(r.category);
    const description = vRuleDescription(category, table4, str(r.method));
    cleanChunkText.set(id, description);
    rules.push({
      ruleId: id,
      family: 'v_subcategory',
      category,
      priority: rules.length + 1,
      predicate,
      method: str(r.method),
      descriptionMn: description,
      reviewNote: null,
      value: null,
      provenance: prov(docId, code, id, { table: num(r.table), page: num(r.page), section: '4.19' }, verification),
      executable: isExecutableVerification(verification),
      boundaryConflicts: [],
    });
  }

  // Барилгын ангилал — 5.1–5.5 (А–Г хүний хяналттай, гүйцэтгэхгүй)
  for (const r of buildingRows) {
    const id = String(r.rule_id);
    const verification = String(r.verification_status ?? 'unknown');
    let predicate: CompiledPredicate | null = null;
    try {
      predicate = toPredicate(r.conditions);
    } catch {
      predicate = null;
    }
    rules.push({
      ruleId: id,
      family: 'building_category',
      category: str(r.category),
      priority: rules.length + 1,
      predicate: isExecutableVerification(verification) ? predicate : null,
      method: null,
      descriptionMn: str(r.conditions_source_text_mn) ?? str(r.description_mn) ?? `Барилгын ${String(r.category)} ангилал (${String(r.section ?? '')}).`,
      reviewNote: str(r.review_note),
      value: null,
      provenance: prov(docId, code, id, { section: str(r.section), page: num(r.page) }, verification),
      executable: isExecutableVerification(verification),
      boundaryConflicts: [],
    });
  }

  // 4.4 — чөлөөт багтаамжийн 80%-ийн нөөц дүрэм
  {
    const text = clauseText('4.4');
    const pct = mustNumber(text, /(\d+)\s*%-?ийг\s+авна/u, '4.4 free-volume ratio');
    const verification = String(chunkById.get(`${docId}:clause:4.4`)?.verification_status ?? 'unknown');
    rules.push({
      ruleId: `${docId}:clause:4.4`,
      family: 'fallback_ratio',
      category: null,
      priority: rules.length + 1,
      predicate: { kind: 'flag', field: 'equipment_volume_known', value: false },
      method: null,
      descriptionMn: text,
      reviewNote: null,
      value: pct / 100,
      provenance: prov(docId, code, `${docId}:clause:4.4`, { clause: '4.4', section: '4.4', page: clausePage('4.4') }, verification),
      executable: isExecutableVerification(verification),
      boundaryConflicts: [],
    });
  }

  // 4.2 — шугам хоолой хаах тооцоот хугацаа (гурван нөхцөл)
  {
    const text = clauseText('4.2.valve');
    const verification = String(chunkById.get(`${docId}:clause:4.2.valve`)?.verification_status ?? 'unknown');
    const prob = mustNumber(text, /магадлал(?:\s+жилд)?\s+([\d.,]+)-(?:аас|ээс|оос|өөс)\s+бага/u, '4.2 failure probability');
    const auto = mustNumber(text, /(\d+)\s*секунд/u, '4.2 automatic shutoff seconds');
    const manual = mustNumber(text, /гараар хаах бол\s+(\d+)\s*с/u, '4.2 manual shutoff seconds');
    const base = { section: '4.2', clause: '4.2', page: clausePage('4.2.valve') };
    const mk = (suffix: string, predicate: CompiledPredicate, value: number | null, description: string): CompiledRule => ({
      ruleId: `${docId}:clause:4.2.valve:${suffix}`,
      family: 'shutoff_time',
      category: null,
      priority: rules.length + 1,
      predicate,
      method: null,
      descriptionMn: description,
      reviewNote: null,
      value,
      provenance: prov(docId, code, `${docId}:clause:4.2.valve`, base, verification),
      executable: isExecutableVerification(verification),
      boundaryConflicts: [],
    });
    rules.push(
      mk('manual', { kind: 'flag', field: 'manual', value: true }, manual, `Гараар хаах бол тооцоот хаах хугацаа ${manual} с.`),
      mk(
        'auto_no_redundancy',
        {
          kind: 'all',
          of: [
            { kind: 'flag', field: 'manual', value: false },
            { kind: 'flag', field: 'redundant', value: false },
            { kind: 'number', field: 'failure_probability_per_year', op: '>', value: prob, unit: '1/year' },
          ],
        },
        auto,
        `Автомат хаалтын ажиллагаагүй болох магадлал жилд ${prob}-ээс их ба нөөцгүй бол ${auto} секунд.`,
      ),
      mk(
        'auto_redundant_passport',
        {
          kind: 'all',
          of: [
            { kind: 'flag', field: 'manual', value: false },
            { kind: 'flag', field: 'redundant', value: true },
            { kind: 'number', field: 'failure_probability_per_year', op: '<', value: prob, unit: '1/year' },
          ],
        },
        null,
        `Магадлал жилд ${prob}-ээс бага ба нөөц хангалттай бол техникийн паспортын хугацаа.`,
      ),
    );
  }

  // 4.20.b4 + Хүснэгт 5 — В4 өрөөний галын ачааллын хэсгүүдийн хязгаарын зай
  {
    const text = clauseText('4.20.b4');
    const dflt = mustNumber(text, /l\s*хя\s*[≥>]=?\s*(\d+)\s*м/u, '4.20.b4 default spacing');
    const verification = String(chunkById.get(`${docId}:clause:4.20.b4`)?.verification_status ?? 'unknown');
    rules.push({
      ruleId: `${docId}:clause:4.20.b4:default`,
      family: 'spacing',
      category: 'В4',
      priority: rules.length + 1,
      predicate: { kind: 'flag', field: 'q_critical_known', value: false },
      method: null,
      descriptionMn: text,
      reviewNote: null,
      value: dflt,
      provenance: prov(docId, code, `${docId}:clause:4.20.b4`, { clause: '4.20', section: '4.20', page: clausePage('4.20.b4') }, verification),
      executable: isExecutableVerification(verification),
      boundaryConflicts: [],
    });
    const t5 = Array.isArray(tables.table_5_spacing_limit) ? (tables.table_5_spacing_limit as Row[]) : [];
    const t5chunk = chunkById.get(`${docId}:table:table_5_spacing_limit`);
    for (const row of t5) {
      const q = num(row.q_critical_kw_m2);
      const l = num(row.l_limit_m);
      if (q === null || l === null) continue;
      rules.push({
        ruleId: `${docId}:table:table_5_spacing_limit:q${q}`,
        family: 'spacing',
        category: 'В4',
        priority: rules.length + 1,
        predicate: { kind: 'number', field: 'q_critical_kw_m2', op: '=', value: q, unit: 'kW/m2' },
        method: null,
        descriptionMn: `Хүснэгт 5: q_кр = ${q} кВт/м² бол хязгаарын зай l = ${l} м.`,
        reviewNote: null,
        value: l,
        provenance: prov(docId, code, `${docId}:table:table_5_spacing_limit`, { table: 5, section: '4.20', page: num(t5chunk?.page) }, String(t5chunk?.verification_status ?? 'unknown')),
        executable: isExecutableVerification(String(t5chunk?.verification_status ?? 'unknown')),
        boundaryConflicts: [],
      });
    }
  }

  const formulas: CompiledFormula[] = formulaRows.map((f) => {
    const id = String(f.formula_id);
    const verification = String(f.verification_status ?? 'unknown');
    const output = (f.output ?? {}) as Row;
    const constraints: Record<string, number> = {};
    if (typeof f.constraints === 'object' && f.constraints !== null) {
      for (const [k, v] of Object.entries(f.constraints as Row)) {
        const n = num(v);
        if (n !== null) constraints[k] = n;
      }
    }
    return {
      formulaId: id,
      section: str(f.section) ?? '',
      number: String(f.number ?? ''),
      nameMn: String(f.name_mn ?? ''),
      equationLatex: String(f.equation_latex ?? ''),
      expressionPython: str(f.expression_python),
      inputs: strList(f.inputs),
      output: { name: String(output.name ?? ''), unit: String(output.unit ?? '') },
      constraints,
      provenance: prov(docId, code, id, { section: str(f.section), formula: str(f.number) ?? String(f.number ?? ''), page: num(f.page) }, verification),
      executable: isExecutableVerification(verification),
    };
  });

  const clauses: CompiledClause[] = chunks.map((c) => ({
    chunkId: String(c.chunk_id),
    section: str(c.section),
    page: num(c.page),
    kind: String(c.kind ?? 'clause'),
    textMn: cleanChunkText.get(String(c.chunk_id)) ?? String(c.text_mn ?? ''),
    verificationStatus: String(c.verification_status ?? 'unknown'),
  }));

  const cases: CompiledCase[] = caseRows.map((c) => ({
    caseId: String(c.case_id),
    queryMn: String(c.query_mn ?? ''),
    queryLatin: str(c.query_latin),
    queryEn: str(c.query_en),
    inputs: scalarRecord(c.inputs),
    expected: scalarRecord(c.expected),
    recordId: str(c.rule_id) ?? str(c.formula_id) ?? str(c.clause_id),
    page: num(c.page),
  }));

  const codeAliases = aliasGroupFor(aliasFile, code);
  const identity = datasetIdentity(folder, BD_IDENTITY_FILES);
  const legalRaw = String(doc.effective_status ?? doc.legal_status ?? doc.status ?? 'unknown_requires_legal_verification');

  return {
    documentId: docId,
    documentCode: code,
    codeAliases,
    titleMn: String(doc.title_mn ?? ''),
    titleEn: str(doc.title_en),
    legalStatusRaw: legalRaw,
    currentness: currentnessOfRaw(legalRaw),
    effectiveFrom: str(doc.effective_from),
    datasetId: String(manifest.dataset_id ?? BD_ADAPTER_ID),
    datasetVersion: String(manifest.version ?? '0'),
    datasetSha256: identity.sha256,
    sourceSha256: String(doc.source_sha256 ?? ''),
    datasetFiles: identity.files,
    generatorVersion: BD_ADAPTER_VERSION,
    rules,
    formulas,
    clauses,
    cases,
  };
}

/* ── Жижиг туслахууд ────────────────────────────────────────────────── */

function scalarRecord(v: unknown): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  if (typeof v !== 'object' || v === null) return out;
  for (const [k, x] of Object.entries(v as Row)) {
    if (typeof x === 'number' || typeof x === 'string' || typeof x === 'boolean') out[k] = x;
  }
  return out;
}

function aliasGroupFor(aliasFile: unknown, code: string): string[] {
  const out = new Set<string>([code]);
  if (Array.isArray(aliasFile)) {
    for (const g of aliasFile as Row[]) {
      if (g.canonical !== code) continue;
      for (const a of [...strList(g.mn), ...strList(g.latin), ...strList(g.en)]) if (/\d/.test(a)) out.add(a);
    }
  }
  return [...out];
}

/** Шийдвэрийн модны АНГЛИ шалгалт («flash point < 28°C») vs гүйцэтгэх харьцуулагч. */
function englishConflicts(predicate: CompiledPredicate | null, checks: string): CompiledBoundaryConflict[] {
  const out: CompiledBoundaryConflict[] = [];
  for (const leaf of numberLeaves(predicate)) {
    if (leaf.op === 'between' || leaf.op === '=') continue;
    const re = new RegExp(`(<=|>=|≤|≥|<|>)\\s*${String(leaf.value)}(?![\\d.])`, 'u');
    const m = re.exec(checks);
    if (!m) continue;
    const sym = m[1] === '≤' ? '<=' : m[1] === '≥' ? '>=' : m[1]!;
    if (sym === leaf.op) continue;
    out.push({
      field: leaf.field,
      value: leaf.value as number,
      executableOp: leaf.op,
      proseOp: sym,
      reason: 'source_boundary_conflict',
      detailMn: `Гүйцэтгэх бичлэг «${leaf.op} ${leaf.value}», шийдвэрийн мод «${sym} ${leaf.value}» — яг ${leaf.value} дээр санал нийлэхгүй.`,
    });
  }
  return out;
}

function dedupeConflicts(list: CompiledBoundaryConflict[]): CompiledBoundaryConflict[] {
  const seen = new Set<string>();
  const out: CompiledBoundaryConflict[] = [];
  for (const c of list) {
    const k = `${c.field}:${c.value}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}
