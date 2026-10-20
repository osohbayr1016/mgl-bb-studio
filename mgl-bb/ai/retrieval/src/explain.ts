/**
 * L2 — НОРМ ОЙЛГОХ / ТАЙЛБАРЛАХ ДАВХАРГА (2026-09-18, эхлээд ЗӨВХӨН БНбД 31-17-10).
 *
 * Хоёр ажил: (1) `documents/<Doc>/l2/*.jsonl` → `ai_norm_explanations` (шингээлт, идемпотент, баримт тус
 * бүрээр); (2) `askNorm`-ын ҮР ДҮНД тайлбар ЗАЛГАХ — заалт олсон хэсгийн `chunk_id`-аар (яг заалт /
 * хайлтаар ойролцоо заалт), нэрлэсэн баримтын хэсэг/баримтын түвшний асуултад хэсэг/баримтын бичлэг.
 *
 * ⚠️ ХАЙЛТЫН ХОЁР ДАХЬ СИСТЕМ БИШ.  Хэсгийг `askNorm` (structured/alias/FTS + RRF + баримтын цоож) олно;
 *    энд зөвхөн ОЛДСОН хэсгийн тайлбарыг уншина.  Баримтын ЦООЖ хэвээр: нэрлэсэн баримт ≠ бичлэгийн
 *    баримт бол тайлбар ХЭЗЭЭ Ч буцахгүй (өөр баримтын тайлбар гоожих = хатуу алдаа).
 * ⚠️ ТООЦОО БИШ.  Бичлэг бүр `computable:false`; энд тоо харьцуулах, ангилах, interpolate хийх код БАЙХГҮЙ.
 * ⚠️ ХҮЧИНТЭЙ ЭСЭХ нь тусдаа (`ai_norm_registry`, баримтын effective_status) — тайлбарын бичлэг төлөв
 *    хэлэхгүй, дээшлүүлэхгүй.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { NormativeAnswer } from './pipeline.ts';
import { foldText } from './fold.ts';

export const EXPLANATION_SCHEMA = 'l2-clause/1';

export interface SemanticFrame {
  subject: string[];
  requirement: string[];
  conditions: string[];
  exceptions: string[];
  prohibitions: string[];
  permissions: string[];
  cross_references: Array<{ kind: 'document' | 'clause' | 'table' | 'appendix'; target: string; resolved: boolean | null; resolution?: 'resolved' | 'unresolved' | 'external'; target_uid?: string | null; target_scope?: string | null; alternatives?: string[]; source: string; relationship?: string; context?: string | null }>;
}

export interface ClauseExplanation {
  type: 'clause_explanation';
  norm_code: string;
  document_id: string;
  clause_id: string;
  clause_uid: string;
  chunk_id: string;
  scope: 'body' | 'appendix';
  appendix: string | null;
  ambiguous_with: string | null;
  heading_path: string[];
  source_text: string;
  source_text_sha256: string;
  context: {
    document_title: string | null;
    section: { section: string; title: string; page: number | null } | null;
    parent_clause: { clause_id: string; text: string } | null;
    prev_clause: string | null;
    next_clause: string | null;
    definitions: Array<{ term: string; definition_id: string; appendix: string | null; page: number | null; definition?: string; matched_surface?: string; match_method?: string; confidence?: number }>;
    referenced_clauses: Array<{ clause_id: string; text: string }>;
    notes: string[];
  };
  semantic_frame: SemanticFrame;
  plain_mn: string;
  plain_mn_method: string;
  /** L2.1 — ЭХ → ХҮРЭЭ → НЭР ДЭВШИГЧ → СЕМАНТИК ШАЛГАЛТ. */
  plain_mn_fallback?: string;
  plain_mn_candidate?: string | null;
  candidate_verification?: { verdict: 'PASS' | 'FAIL'; failures: Array<{ code: string; detail: string; claim: string }>; claims?: unknown[]; model?: string | null } | null;
  status?: { source_verification: string; explanation_generation: string; semantic_validation: string; human_review: string };
  requirement_type: 'scope' | 'definition' | 'obligation' | 'prohibition' | 'permission' | 'reference' | 'procedure' | 'informational';
  numeric_literals: Array<{ literal: string; value: string | null; unit: string | null }>;
  source: { page: number | null; pdf_page: number | null; url: string | null; pdf_url: string | null; document_sha256: string | null; clause_verification: string | null };
  currentness: { effective_status: string | null; note: string };
  verification: { source_text: string | null; explanation: 'AUTO_DRAFT' | 'HUMAN_VERIFIED' };
  execution: { computable: false };
  generated_at: string;
}

export interface SectionExplanation {
  type: 'section_explanation';
  norm_code: string;
  section: string;
  title: string;
  page: number | null;
  clause_ids: string[];
  clause_count: number;
  requirement_types: Record<string, number>;
  first_clause: { clause_id: string; text: string } | null;
  cross_documents: string[];
  numeric_literal_count: number;
  verification: { explanation: 'AUTO_DRAFT' | 'HUMAN_VERIFIED' };
  execution: { computable: false };
}

export interface DocumentExplanation {
  type: 'document_explanation';
  norm_code: string;
  document_id: string;
  title_mn: string | null;
  title_en: string | null;
  scope_text: string | null;
  not_applicable_text: string | null;
  sections: Array<{ section: string; title: string; page: number | null; clause_count: number }>;
  appendices: Array<{ appendix: string; kind: string | null; title: string | null; page: number | null }>;
  counts: Record<string, number>;
  /** L2.1: 1-р хавсралтын нэр томьёо (эхээс), pack-ийн definition хэсгийн chunk_id-тай. */
  definitions?: Array<{ term: string; definition: string; definition_id: string; chunk_id: string; appendix: string | null; clause?: string | null; page: number | null; linked_clauses: string[] }>;
  source: { url: string | null; pdf_url: string | null; document_sha256: string | null; legal_url: string | null };
  currentness: { status: string | null; effective_status: string | null; note: string | null; successor_draft: string | null };
  verification: { explanation: 'AUTO_DRAFT' | 'HUMAN_VERIFIED' };
  execution: { computable: false };
}

/* ── Шингээлт ─────────────────────────────────────────────────────── */

export interface ExplanationIngestCounts {
  doc_id: string;
  clauses: number;
  sections: number;
  document: number;
  /** L2 (2026-09-23): хүснэгт / томьёо / баримт хоорондын холбоос — `ai_norm_explanation_objects`. */
  tables: number;
  formulas: number;
  links: number;
  /** `ai_chunks`-д БАЙХГҮЙ chunk_id-тай бичлэг (багц ба L2 зөрсөн) — оруулсан ч хайлтаар олдохгүй. */
  orphan_chunk_ids: number;
  human_verified: number;
}

function readJsonl(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/**
 * `<Doc>/l2/` хавтсыг санд оруулна — тухайн баримтын хуучин L2 мөрийг устгаад дахин бичнэ (идемпотент).
 * Хэсгүүд (`ai_chunks`) ХӨНДӨГДӨХГҮЙ; SCHEMA_VERSION өсөхгүй.  `HUMAN_VERIFIED` нь файлд байвал л
 * дамжина — энд хэзээ ч тавигдахгүй.
 */
export function ingestExplanations(db: DatabaseSync, l2Dir: string): ExplanationIngestCounts {
  const clauses = readJsonl(join(l2Dir, 'clause_explanations.jsonl'));
  const sections = readJsonl(join(l2Dir, 'section_explanations.jsonl'));
  const docPath = join(l2Dir, 'document_explanation.json');
  const document = existsSync(docPath) ? (JSON.parse(readFileSync(docPath, 'utf8')) as Record<string, unknown>) : null;
  const docId = String(clauses[0]?.document_id ?? document?.document_id ?? '');
  if (docId.length === 0) throw new Error(`L2: ${l2Dir} — document_id алга (clause_explanations.jsonl хоосон уу?).`);
  const chunkExists = db.prepare('SELECT 1 FROM ai_chunks WHERE chunk_id = ? LIMIT 1');
  const insert = db.prepare(
    `INSERT INTO ai_norm_explanations (explanation_id, doc_id, norm_code, kind, chunk_id, clause_id, clause_uid, scope, appendix, section, requirement_type,
       heading_path_json, source_text, source_text_sha256, plain_mn, plain_method, frame_json, numeric_json, page, source_url, document_sha256,
       verification_explanation, computable, record_json, generated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  );
  const counts: ExplanationIngestCounts = { doc_id: docId, clauses: 0, sections: 0, document: 0, tables: 0, formulas: 0, links: 0, orphan_chunk_ids: 0, human_verified: 0 };
  const tables = readJsonl(join(l2Dir, 'table_explanations.jsonl'));
  const formulas = readJsonl(join(l2Dir, 'formula_explanations.jsonl'));
  const linksPath = join(l2Dir, 'cross_document_links.json');
  const links = existsSync(linksPath) ? (JSON.parse(readFileSync(linksPath, 'utf8')) as Record<string, unknown>) : null;
  // Хуучин сан (энэ хүснэгтгүй) — объектыг алгасна, заалтын тайлбар хэвээр ажиллана.
  const hasObjects = (() => { try { db.prepare('SELECT 1 FROM ai_norm_explanation_objects LIMIT 1').get(); return true; } catch { return false; } })();
  const insObj = hasObjects
    ? db.prepare('INSERT INTO ai_norm_explanation_objects (object_id, doc_id, norm_code, kind, object_key, chunk_id, clause_id, page, computable, record_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)')
    : null;
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM ai_norm_explanations WHERE doc_id = ?').run(docId);
    if (hasObjects) db.prepare('DELETE FROM ai_norm_explanation_objects WHERE doc_id = ?').run(docId);
    if (insObj !== null) {
      for (const t of tables) {
        if (t.type !== 'table_explanation') continue;
        if ((t.execution as { computable?: unknown } | undefined)?.computable !== false) throw new Error(`L2: хүснэгт ${String(t.table_uid)} — execution.computable ЗААВАЛ false.`);
        const src = (t.source ?? {}) as Record<string, unknown>;
        insObj.run(`${docId}:l2:table:${String(t.table_no)}`, docId, String(t.norm_code ?? ''), 'table', String(t.table_no ?? ''), String(t.chunk_id ?? ''), t.clause_context === null || t.clause_context === undefined ? null : String(t.clause_context), typeof src.page === 'number' ? src.page : null, JSON.stringify(t));
        counts.tables += 1;
      }
      for (const f of formulas) {
        if (f.type !== 'formula_explanation') continue;
        if ((f.execution as { computable?: unknown } | undefined)?.computable !== false) throw new Error(`L2: томьёо ${String(f.formula_uid)} — execution.computable ЗААВАЛ false.`);
        const src = (f.source ?? {}) as Record<string, unknown>;
        insObj.run(`${docId}:l2:formula:${String(f.label)}`, docId, String(f.norm_code ?? ''), 'formula', String(f.label ?? ''), String(f.chunk_id ?? ''), f.clause_id === null || f.clause_id === undefined ? null : String(f.clause_id), typeof src.page === 'number' ? src.page : null, JSON.stringify(f));
        counts.formulas += 1;
      }
      if (links !== null && links.type === 'cross_document_links') {
        insObj.run(`${docId}:l2:links`, docId, String(links.norm_code ?? ''), 'links', null, null, null, null, JSON.stringify(links));
        counts.links = 1;
      }
    }
    for (const r of clauses) {
      if (r.type !== 'clause_explanation') continue;
      const exec = r.execution as { computable?: unknown } | undefined;
      if (exec?.computable !== false) throw new Error(`L2: ${String(r.clause_uid)} — execution.computable ЗААВАЛ false.`);
      const ver = (r.verification as { explanation?: unknown } | undefined)?.explanation;
      const verification = ver === 'HUMAN_VERIFIED' ? 'HUMAN_VERIFIED' : 'AUTO_DRAFT';
      if (verification === 'HUMAN_VERIFIED') counts.human_verified += 1;
      const chunkId = String(r.chunk_id ?? '');
      if (chunkExists.get(chunkId) === undefined) counts.orphan_chunk_ids += 1;
      const ctx = (r.context ?? {}) as { section?: { section?: unknown } | null };
      const src = (r.source ?? {}) as Record<string, unknown>;
      insert.run(
        `${docId}:l2:clause:${String(r.clause_uid)}`,
        docId,
        String(r.norm_code ?? ''),
        'clause',
        chunkId,
        String(r.clause_id ?? ''),
        String(r.clause_uid ?? ''),
        String(r.scope ?? 'body'),
        r.appendix === null || r.appendix === undefined ? null : String(r.appendix),
        ctx.section?.section === undefined || ctx.section?.section === null ? null : String(ctx.section.section),
        String(r.requirement_type ?? 'informational'),
        JSON.stringify(r.heading_path ?? []),
        String(r.source_text ?? ''),
        String(r.source_text_sha256 ?? ''),
        String(r.plain_mn ?? ''),
        String(r.plain_mn_method ?? 'deterministic_digest'),
        JSON.stringify(r.semantic_frame ?? {}),
        JSON.stringify(r.numeric_literals ?? []),
        typeof src.page === 'number' ? src.page : null,
        typeof src.url === 'string' ? src.url : null,
        typeof src.document_sha256 === 'string' ? src.document_sha256 : null,
        verification,
        JSON.stringify(r),
        typeof r.generated_at === 'string' ? r.generated_at : null,
      );
      counts.clauses += 1;
    }
    for (const r of sections) {
      if (r.type !== 'section_explanation') continue;
      insert.run(
        `${docId}:l2:section:${String(r.section)}`, docId, String(r.norm_code ?? ''), 'section', null, null, null, null, null, String(r.section ?? ''), null,
        JSON.stringify([`${String(r.section)}. ${String(r.title ?? '')}`]), null, null, null, null, '{}', '[]',
        typeof r.page === 'number' ? r.page : null, null, null, 'AUTO_DRAFT', JSON.stringify(r), null,
      );
      counts.sections += 1;
    }
    if (document !== null && document.type === 'document_explanation') {
      const src = (document.source ?? {}) as Record<string, unknown>;
      insert.run(
        `${docId}:l2:document`, docId, String(document.norm_code ?? ''), 'document', null, null, null, null, null, null, null,
        JSON.stringify([String(document.title_mn ?? '')]), null, null, null, null, '{}', '[]', null,
        typeof src.url === 'string' ? src.url : null, typeof src.document_sha256 === 'string' ? src.document_sha256 : null,
        'AUTO_DRAFT', JSON.stringify(document), typeof document.generated_at === 'string' ? document.generated_at : null,
      );
      counts.document = 1;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  resetExplainCache(db);
  return counts;
}

/** Багцын хавтас (`…/pack`) хажууд `../l2/clause_explanations.jsonl` байвал түүний зам. */
export function l2DirForPack(packDir: string): string | null {
  const dir = join(packDir, '..', 'l2');
  return existsSync(join(dir, 'clause_explanations.jsonl')) ? dir : null;
}

export function explanationCounts(db: DatabaseSync): { documents: number; clauses: number; auto_draft: number; human_verified: number } | null {
  try {
    const r = db
      .prepare(
        `SELECT COUNT(DISTINCT doc_id) AS documents,
                SUM(CASE WHEN kind = 'clause' THEN 1 ELSE 0 END) AS clauses,
                SUM(CASE WHEN kind = 'clause' AND verification_explanation = 'AUTO_DRAFT' THEN 1 ELSE 0 END) AS auto_draft,
                SUM(CASE WHEN kind = 'clause' AND verification_explanation = 'HUMAN_VERIFIED' THEN 1 ELSE 0 END) AS human_verified
         FROM ai_norm_explanations`,
      )
      .get() as { documents: number; clauses: number | null; auto_draft: number | null; human_verified: number | null };
    return { documents: r.documents, clauses: r.clauses ?? 0, auto_draft: r.auto_draft ?? 0, human_verified: r.human_verified ?? 0 };
  } catch {
    return null;
  }
}

/* ── Унших ────────────────────────────────────────────────────────── */

interface Row {
  explanation_id: string;
  doc_id: string;
  norm_code: string;
  kind: string;
  chunk_id: string | null;
  clause_id: string | null;
  scope: string | null;
  section: string | null;
  record_json: string;
}

function parse<T>(row: Row | undefined): T | null {
  if (!row) return null;
  try {
    return JSON.parse(row.record_json) as T;
  } catch {
    return null;
  }
}

function hasTable(db: DatabaseSync): boolean {
  try {
    db.prepare('SELECT 1 FROM ai_norm_explanations LIMIT 1').get();
    return true;
  } catch {
    return false;
  }
}

export function explanationByChunk(db: DatabaseSync, chunkId: string): ClauseExplanation | null {
  return parse<ClauseExplanation>(db.prepare(`SELECT * FROM ai_norm_explanations WHERE kind = 'clause' AND chunk_id = ?`).get(chunkId) as Row | undefined);
}

/**
 * Заалтын дугаараар — ⚠️ дугаар үндсэн хэсэг/хавсралт хооронд давхардана (8.3 ↔ 8-р хавсралтын 8.3):
 * хавсралт ил нэрлээгүй бол ҮНДСЭН хэсэг; давхардлыг `alternatives`-д ил буцаана.
 */
export function explanationByClause(
  db: DatabaseSync,
  docId: string,
  clause: string,
  appendix: string | null = null,
): { record: ClauseExplanation | null; alternatives: ClauseExplanation[] } {
  const rows = db
    .prepare(`SELECT * FROM ai_norm_explanations WHERE kind = 'clause' AND doc_id = ? AND clause_id = ? ORDER BY CASE scope WHEN 'body' THEN 0 ELSE 1 END, appendix`)
    .all(docId, clause) as unknown as Row[];
  const all = rows.map((r) => parse<ClauseExplanation>(r)).filter((r): r is ClauseExplanation => r !== null);
  if (all.length === 0) return { record: null, alternatives: [] };
  // Хавсралт: тоон («8-р хавсралт» → «8») эсвэл үсгэн («Д»); үсгийг хасахгүй (20-04-17-ийн хавсралтууд Б…Д).
  const wantApp = appendix === null ? null : /^[А-ЯӨҮЁ]$/u.test(appendix.trim()) ? appendix.trim() : appendix.replace(/[^\d.]/g, '');
  const pick = wantApp ? (all.find((r) => r.scope === 'appendix' && r.appendix === wantApp) ?? null) : (all.find((r) => r.scope === 'body') ?? all[0] ?? null);
  return { record: pick, alternatives: all.filter((r) => r !== pick) };
}

export function sectionExplanation(db: DatabaseSync, docId: string, section: string): SectionExplanation | null {
  return parse<SectionExplanation>(db.prepare(`SELECT * FROM ai_norm_explanations WHERE kind = 'section' AND doc_id = ? AND section = ?`).get(docId, section) as Row | undefined);
}

export function documentExplanation(db: DatabaseSync, docId: string): DocumentExplanation | null {
  return parse<DocumentExplanation>(db.prepare(`SELECT * FROM ai_norm_explanations WHERE kind = 'document' AND doc_id = ?`).get(docId) as Row | undefined);
}

/** Тайлбартай баримтуудын doc_id → код. */
export function explainedDocuments(db: DatabaseSync): Map<string, string> {
  if (!hasTable(db)) return new Map();
  const rows = db.prepare(`SELECT DISTINCT doc_id, norm_code FROM ai_norm_explanations WHERE kind = 'clause'`).all() as Array<{ doc_id: string; norm_code: string }>;
  return new Map(rows.map((r) => [r.doc_id, r.norm_code]));
}

/* ── L2 (2026-09-23): хүснэгт / томьёо / ангилал — УНШИХ ─────────────────────────────────────────────── */

export interface TableExplanationRecord {
  type: 'table_explanation';
  norm_code: string;
  document_id: string;
  table_uid: string;
  table_no: string;
  chunk_id: string;
  caption: string | null;
  clause_context: string | null;
  referring_clauses: Array<{ clause_uid: string; clause_id: string; scope: string; text: string; page: number | null }>;
  columns: Array<{ index: number; header_text: string | null; unit: string | null; units_in_header: string[]; role: string }>;
  header_rows: string[][];
  rows: Array<{ index: number; row_no: string | null; group_path: string[]; label: string; values: string[]; cells: string[]; alignment: string; page: number | null; continued_from_previous_page: boolean }>;
  notes: string[];
  structure: string;
  row_alignment: Record<string, number>;
  source: { page: number | null; pdf_page: number | null; url: string | null; pdf_url: string | null; document_sha256: string | null };
  execution: { computable: false };
}

export interface FormulaExplanationRecord {
  type: 'formula_explanation';
  norm_code: string;
  formula_uid: string;
  label: string;
  chunk_id: string;
  expression: string;
  expression_quality: string;
  clause_id: string | null;
  clause_uid: string | null;
  variables_in_expression: string[];
  variable_definitions: Array<{ symbol: string; definition: string; source: string }>;
  source: { page: number | null; pdf_page: number | null; url: string | null; pdf_url: string | null; document_sha256: string | null };
  execution: { computable: false };
}

function hasObjects(db: DatabaseSync): boolean {
  try {
    db.prepare('SELECT 1 FROM ai_norm_explanation_objects LIMIT 1').get();
    return true;
  } catch {
    return false;
  }
}
function objectRecord<T>(row: { record_json: string } | undefined): T | null {
  if (!row) return null;
  try {
    return JSON.parse(row.record_json) as T;
  } catch {
    return null;
  }
}
/** Хүснэгт дугаараар («8.3», «Д.1»).  Давхардсан дугаар («Д.1@p90» — хавсралтын тэмдэглэгээний хүснэгт) нь өөр түлхүүртэй. */
export function tableByNo(db: DatabaseSync, docId: string, no: string): TableExplanationRecord | null {
  if (!hasObjects(db)) return null;
  return objectRecord<TableExplanationRecord>(db.prepare(`SELECT record_json FROM ai_norm_explanation_objects WHERE doc_id = ? AND kind = 'table' AND object_key = ?`).get(docId, no) as { record_json: string } | undefined);
}
export function tableByChunk(db: DatabaseSync, chunkId: string): TableExplanationRecord | null {
  if (!hasObjects(db)) return null;
  return objectRecord<TableExplanationRecord>(db.prepare(`SELECT record_json FROM ai_norm_explanation_objects WHERE kind = 'table' AND chunk_id = ?`).get(chunkId) as { record_json: string } | undefined);
}
export function formulaByLabel(db: DatabaseSync, docId: string, label: string): FormulaExplanationRecord | null {
  if (!hasObjects(db)) return null;
  return objectRecord<FormulaExplanationRecord>(db.prepare(`SELECT record_json FROM ai_norm_explanation_objects WHERE doc_id = ? AND kind = 'formula' AND object_key = ?`).get(docId, label) as { record_json: string } | undefined);
}
export function formulasByClause(db: DatabaseSync, docId: string, clause: string): FormulaExplanationRecord[] {
  if (!hasObjects(db)) return [];
  return (db.prepare(`SELECT record_json FROM ai_norm_explanation_objects WHERE doc_id = ? AND kind = 'formula' AND clause_id = ? ORDER BY object_id`).all(docId, clause) as Array<{ record_json: string }>)
    .map((r) => objectRecord<FormulaExplanationRecord>(r))
    .filter((r): r is FormulaExplanationRecord => r !== null);
}
export function formulaByChunk(db: DatabaseSync, chunkId: string): FormulaExplanationRecord | null {
  if (!hasObjects(db)) return null;
  return objectRecord<FormulaExplanationRecord>(db.prepare(`SELECT record_json FROM ai_norm_explanation_objects WHERE kind = 'formula' AND chunk_id = ?`).get(chunkId) as { record_json: string } | undefined);
}
export function objectCounts(db: DatabaseSync): { tables: number; formulas: number } | null {
  if (!hasObjects(db)) return null;
  const r = db.prepare(`SELECT SUM(CASE WHEN kind = 'table' THEN 1 ELSE 0 END) AS tables, SUM(CASE WHEN kind = 'formula' THEN 1 ELSE 0 END) AS formulas FROM ai_norm_explanation_objects`).get() as { tables: number | null; formulas: number | null };
  return { tables: r.tables ?? 0, formulas: r.formulas ?? 0 };
}

/**
 * Монгол үгийн язгуур (≥ 3 үсэг): түгээмэл залгаврыг хасаад эхний 5 үсэг.  Ангиллын/мөрийн тулгалтад л — хайлт БИШ.
 * «Цасны» → «цас», «хүмүүсийн» → «хүмүү», «ачаалалд» → «ачаал».
 */
/** Олон тооны жигд бус хэлбэр — «хүмүүс» ≡ «хүн» (эх бичвэрт хоёулаа: 5.4з «хүн, амьтан», 5.5б «хүмүүсийн жин»). */
const IRREGULAR_STEM: Record<string, string> = { хүмүү: 'хүн' };
function stemOf(word: string): string | null {
  const low = word.toLowerCase();
  const cut = low.replace(/(?:ууд|үүд|нууд|нүүд)?(?:ийн|ын|ний|ны|ийг|ыг|ийг|аас|ээс|оос|өөс|аар|ээр|оор|өөр|тай|тэй|той|анд|энд|онд|өнд|нд|д|т|н|ы|ий)$/u, '');
  // Залгавар хассаны дараа < 3 үсэг үлдвэл хасалт буруу («хүн» → «хү») — эх үгээ хэвээр.
  // Нэг үсэгтэй залгавар («д», «т», «н», «ы») зөвхөн урт үгэнд — «жигд» → «жиг», «тагт» → «таг» болгохгүй.
  const w = cut.length >= 3 && !(low.length - cut.length === 1 && cut.length < 4) ? cut : low;
  if (w.length < 3 || /^\d/.test(w)) return null;
  const st = w.slice(0, 5);
  return IRREGULAR_STEM[st] ?? st;
}
// Ангиллын асуултын ерөнхий үгс — тулгалтад оролцохгүй (категорийн нэр нь толгой өгүүлбэрт, гишүүн нь зүйлд).
// «тооцоо» ерөнхий үг — «Ачааллын тооцооны утга» (нэр томьёо) 6.2-ын «Тооцоонд авч буй …» толгойтой таарч ангилал болж байв.
const CLASS_STOP = new Set(['ачаал', 'ангил', 'ямар', 'аль', 'ордо', 'ордог', 'орох', 'хамаа', 'тооцо', 'гэсэн', 'үг', 'хэлбэ', 'утга', 'утгы', 'тайлб', 'энгий', 'багта', 'төрөл', 'төрли', 'юу', 'юуг', 'вэ', 'бэ', 'уу', 'үү', 'гэж', 'гэдэг', 'байда', 'нормо', 'норм', 'заалт', 'энэ', 'ийм', 'which', 'what', 'categ', 'class', 'load', 'loads', 'belon', 'into', 'does', 'the']);
function contentStems(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.replace(QUERY_CODE, ' ').split(/[^\p{L}\p{N}]+/u)) {
    const s = stemOf(raw);
    if (s !== null && !CLASS_STOP.has(s) && !QUERY_STOP.has(raw.toLowerCase())) out.push(s);
  }
  return [...new Set(out)];
}
// Язгуур + үгийн эхний 5 үсэг хоёулаа — залгавар хасах дүрэм «тагт»-ыг «таг» болгодог (дагалдах «т»-г залгавар гэж) тул.
const wordStems = (text: string): Set<string> => {
  const out = new Set<string>();
  for (const w of text.split(/[^\p{L}\p{N}]+/u)) {
    const st = stemOf(w);
    if (st !== null) out.add(st);
    const low = w.toLowerCase();
    if (low.length >= 3 && !/^\d/.test(low)) out.add(IRREGULAR_STEM[low.slice(0, 5)] ?? low.slice(0, 5));
  }
  return out;
};

export interface ClassificationGroup {
  clause_uid: string;
  clause_id: string;
  lead: string;
  items: Array<{ marker: string; text: string }>;
  trailing: string | null;
  page: number | null;
  source_url: string | null;
  pdf_url: string | null;
}
export interface ClassificationBlock {
  kind: 'member' | 'concept';
  /** Асуултын гол үг (язгуураар) — хариултад «…» дотор эхийн хэлбэрээр л. */
  terms: string[];
  groups: ClassificationGroup[];
  /** Ангиллын схемийг тогтоосон заалт(ууд) («… гэж ангилна») — ЭХЭЭС. */
  scheme: Array<{ clause_uid: string; clause_id: string; text: string; page: number | null }>;
  /** Тухайн ойлголтын тодорхойлолт (байвал) — нэр томьёоны хэсгээс ЭХЭЭС. */
  definition: { term: string; definition: string; clause: string | null; page: number | null } | null;
  /** Олон ангилалд орсон бол — хариулт нэгийг нь СОНГОХГҮЙ, бүгдийг нь нөхцөлтэй нь. */
  multiple_categories: boolean;
}

// «… ямар ангилалд ордог вэ?», «… аль ачаалалд хамаарах вэ?», «which category …»
const CLASSIFY_MEMBER = /ямар\s+(?:ангилал|төрлийн\s+ачаалал|ачаалал)\p{L}*|аль\s+(?:ангилал|ачаалал)\p{L}*|ангилалд\s+(?:ор|хамаар|багт)\p{L}*|(?:which|what)\s+(?:category|class|type\s+of\s+load)/iu;
// «… гэж юу вэ?», «… -д юу ордог вэ?», «… -д юуг хамааруулдаг вэ?», «what is …», «what belongs to …»
const CLASSIFY_CONCEPT = /гэж\s+юу|юу\s+(?:ордог|орох|хамаар\p{L}*|багт\p{L}*)|юуг\s+(?:хамааруул|багтаа)\p{L}*|what\s+(?:is|are|belongs)/iu;

/**
 * Эх бичвэрийн ЖАГСААЛТААР ангиллын асуултад хариулна (L2: «эх бичвэр өөрөө ямар ангилалд хамааруулсан бэ?»).
 * membership жагсаалтын ТОЛГОЙ = ангилал, ЗҮЙЛ = гишүүн — хоёулаа ЭХЭЭС үг үсгээрээ.  Олон ангилалд таарвал бүгдийг.
 * Тооцоо, дүгнэлт, «иймээс …» ХИЙХГҮЙ.  Таарахгүй бол null (ойролцоо заалтын зам руу).
 */
export function classificationLookup(db: DatabaseSync, docId: string, rawQuery: string): ClassificationBlock | null {
  const member = CLASSIFY_MEMBER.test(rawQuery);
  const concept = !member && CLASSIFY_CONCEPT.test(rawQuery);
  if (!member && !concept) return null;
  const terms = contentStems(rawQuery);
  if (terms.length === 0) return null;
  const rows = db.prepare(`SELECT record_json FROM ai_norm_explanations WHERE kind = 'clause' AND doc_id = ?`).all(docId) as Array<{ record_json: string }>;
  const recs = rows.map((r) => objectRecord<ClauseExplanation & { semantic_frame: SemanticFrame & { enumeration?: { kind: string; lead: string; items: Array<{ marker: string; text: string }>; trailing: string | null } } }>(r)).filter((r) => r !== null);
  const groups: ClassificationGroup[] = [];
  // ГОЛ үг = жагсаалтын зүйлсийн < 30 %-д л гардаг үг («үйлчлэл» бараг бүх зүйлд — ялгах чадваргүй).  Зүйл нь БҮХ гол үгийг
  //    агуулах ёстой; гол үг байхгүй бол бүх үгийг.  «Температурын үйлчлэл» → 5.4д (төхөөрөмжийн) + 5.5е (уур амьсгалын).
  const allItems = recs.flatMap((r) => (r!.semantic_frame.enumeration?.kind === 'membership' ? r!.semantic_frame.enumeration.items : []));
  const hasTerm = (st: Set<string>, t: string): boolean => [...st].some((w) => w.startsWith(t) || (w.length >= 3 && t.startsWith(w)));
  const itemStems = allItems.map((it) => wordStems(it.text));
  const share = new Map(terms.map((t) => [t, itemStems.filter((st) => hasTerm(st, t)).length / Math.max(1, itemStems.length)] as const));
  const present = terms.filter((t) => (share.get(t) ?? 0) > 0);
  // Асуултын аль нэг гол үг ЖАГСААЛТЫН нэг ч зүйлд байхгүй бол ангилал ХЭСЭГЧЛЭН ТААМАГЛАХГҮЙ («Робот машины ачаалал» →
  //    «машин» л таарч 5.4б/5.5г гарч байв — хэмжсэн).  Ойлголтын асуултад (толгой өгүүлбэр) энэ дүрэм хамаарахгүй.
  if (member && present.length < terms.length) return null;
  const minShare = present.length > 0 ? Math.min(...present.map((t) => share.get(t)!)) : 0;
  const required = present.filter((t) => share.get(t)! <= Math.max(2 * minShare, 0.1));
  for (const r of recs) {
    const en = r!.semantic_frame.enumeration;
    if (!en || en.kind !== 'membership') continue;
    const leadStems = wordStems(en.lead);
    const base = { clause_uid: r!.clause_uid, clause_id: r!.clause_id, lead: en.lead, trailing: en.trailing ?? null, page: r!.source.page, source_url: r!.source.url, pdf_url: r!.source.pdf_url };
    if (member) {
      // гишүүн: зүйлийн бичвэрт асуултын үгсийн ≥ тал нь (толгой өгүүлбэр ангилал — тулгалтад оролцохгүй)
      const items = required.length === 0 ? [] : en.items.filter((it) => { const st = wordStems(it.text); return required.every((t) => hasTerm(st, t)); });
      if (items.length > 0) groups.push({ ...base, items });
    } else if (terms.every((t) => [...leadStems].some((w) => w === t || (t.length >= 4 && w.startsWith(t))))) {
      groups.push({ ...base, items: en.items });
    }
  }
  if (groups.length === 0) return null;
  // Ангиллын схем: «… гэж ангилна» гэсэн, асуултын аль нэг үгийг агуулсан заалт (жишээ 5.1) — жагсаалт биш
  const scheme = recs
    .filter((r) => /ангилна/u.test(r!.source_text) && !r!.semantic_frame.enumeration && terms.some((t) => wordStems(r!.source_text).has(t)))
    .slice(0, 2)
    .map((r) => ({ clause_uid: r!.clause_uid, clause_id: r!.clause_id, text: r!.source_text, page: r!.source.page }));
  let definition: ClassificationBlock['definition'] = null;
  if (concept) {
    const doc = documentExplanation(db, docId);
    // Нэр томьёо ЯГ таарах ёстой: түүний гол үгс = асуултын гол үгс (олонлогоор).
    const d = doc?.definitions?.find((x) => { const dt = contentStems(x.term); return dt.length === terms.length && terms.every((t) => dt.includes(t)); }) ?? null;
    if (d) definition = { term: d.term, definition: d.definition, clause: (d as { clause?: string | null }).clause ?? null, page: d.page };
  }
  return { kind: member ? 'member' : 'concept', terms, groups: groups.slice(0, 6), scheme, definition, multiple_categories: member && new Set(groups.map((g) => g.clause_uid)).size > 1 };
}

/** «8.3-р хүснэгт», «хүснэгт Д.1», «table 8.3», «7.1-р хүснэгтийн» → «8.3» / «Д.1». */
const TABLE_ASK = /(?<![\p{L}\d.])((?:[А-ЯӨҮЁ]\.\s?)?\d{1,2}(?:\.\d{1,2})?)\s*[-–]?\s*(?:р|р\s|)\s*(?:хүснэгт|khusnegt)|(?:хүснэгт|khusnegt|table)\s+((?:[А-ЯӨҮЁ]\.\s?)?\d{1,2}(?:\.\d{1,2})?)/iu;
/** «(10.1) томьёо», «10.1 томьёо», «formula 11.4», «томьёо (13.3)» */
const FORMULA_ASK = /\(?\s*(\d{1,2}(?:\.\d{1,2}){1,2})\s*\)?\s*[-–]?\s*(?:р|дугаар|дүгээр)?\s*(?:томь?ёо|formula)|(?:томь?ёо|formula)\s*\(?\s*(\d{1,2}(?:\.\d{1,2}){1,2})\s*\)?/iu;
const FORMULA_WORD = /томь?ёо|formula|хувьсагч|variable/iu;
/** «… утга хэд вэ?», «… хэд байх вэ», «ямар утгатай», «what value» — хүснэгтийн ХЭВЛЭСЭН утга (тооцоо биш). */
const VALUE_ASK = /(?<![\p{L}])(?:хэд\s+(?:вэ|бэ|байх|байна)|хэдэн\s+\p{L}+\s+(?:вэ|бэ)|ямар\s+утга\p{L}*|утга\s+нь|what\s+(?:is\s+the\s+)?value)(?![\p{L}])/iu;
/** «Салхины ачааллын тухай аль хэсэгт байдаг вэ?», «хаана заасан бэ», «which section» */
const SECTION_FIND = /аль\s+(?:хэсэг|бүлэг)\p{L}*|ямар\s+(?:хэсэг|бүлэг)\p{L}*\s+(?:байда|заас|бий)|хаана\s+(?:байда|заас|бий)|which\s+(?:section|chapter)/iu;
const TABLE_WORD_ANY = /хүснэгт|khusnegt|(?<![\p{L}])table(?![\p{L}])/iu;
/** «Энэ хүснэгт юу хэлээд байна?», «хүснэгтэд ямар утга …», «what does the table say» — заалтаас түүний хүснэгт рүү. */
const TABLE_CONTENT_ASK = /(?:энэ|тэр|уг)\s+хүснэгт|хүснэгт\p{L}*\s+(?:юу|ямар\s+утга|утга|хэд)|what\s+does\s+(?:the|this)\s+table/iu;

/**
 * Мөрийн тулгалт: асуултын гол үгс (язгуур) → мөрийн шошго + бүлгийн гарчиг (`rowHits`) ба хүснэгтийн толгой/гарчиг
 * (`total` = мөр ∪ толгойд олдсон үгс).  Мөрт ядаж нэг үг заавал.  Эрэмбэ: total ↓, rowHits ↓, дараалал.
 */
const ROW_STOP = new Set(['хүснэ', 'мөр', 'мөрий', 'утга', 'утги', 'нормы', 'нэгж', 'хэд', 'хэдэн', 'тархс', 'жигд', 'нормо']);
function tableTerms(rawQuery: string): string[] {
  return contentStems(rawQuery).filter((s) => !['хэд', 'хэдэн', 'мөр', 'мөрий', 'хүснэ'].includes(s));
}
function tableRowScores(t: TableExplanationRecord, terms: string[]): Array<{ i: number; rowHits: number; total: number }> {
  // «жигд тархсан», «нормын утга» — мөрийг ялгахгүй ч ХҮСНЭГТИЙГ (баганын толгойг) ялгана: зөвхөн `total`-д.
  const head = wordStems(`${t.caption ?? ''} ${t.columns.map((c) => c.header_text ?? '').join(' ')}`);
  const has = (st: Set<string>, x: string): boolean => [...st].some((w) => w.startsWith(x) || (w.length >= 4 && x.startsWith(w)));
  return t.rows
    .map((r) => {
      const st = wordStems(`${r.group_path.join(' ')} ${r.label}`);
      const inRow = terms.filter((x) => !ROW_STOP.has(x) && has(st, x));
      const total = terms.filter((x) => inRow.includes(x) || has(head, x)).length;
      return { i: r.index, rowHits: inRow.length, total };
    })
    .filter((x) => x.rowHits > 0)
    .sort((a, b) => b.total - a.total || b.rowHits - a.rowHits || a.i - b.i);
}
export function matchTableRows(t: TableExplanationRecord, rawQuery: string): number[] {
  const terms = tableTerms(rawQuery);
  if (terms.length === 0) return [];
  const scored = tableRowScores(t, terms);
  if (scored.length === 0) return [];
  const top = scored[0]!;
  return scored.filter((x) => x.total === top.total && x.rowHits === top.rowHits).slice(0, 4).map((x) => x.i);
}
/**
 * Баримтын БҮХ хүснэгтээс утгын асуултад таарах ЦОРЫН ГАНЦ хүснэгт: асуултын бүх гол үгийг (эсвэл ≥ 2) хамарсан, хоёр дахь
 * хүснэгтээс ил давуу.  Тэнцвэл null — хүснэгт СОНГОЖ ТААМАГЛАХГҮЙ.
 */
/**
 * Хүснэгтийн толгойн ОЙР БАЙДАЛ: асуултын үгс (ерөнхий «ачаалал», «утга»-г ч оруулаад, асуултын үгсийг хасаад) хүснэгтийн
 * гарчиг/баганын толгойд хэд байна.  «…архивын АЧААЛАЛ хэд вэ?» — 20-04-17-ийн 8.3 («ачааллын нормын утга») ба 31-17-10-ийн
 * 14-р (галд тэсвэрлэх) хүснэгт хоёулаа «архив» мөртэй; толгой л ялгана (хэмжсэн 2026-09-23).
 */
function headerAffinity(t: TableExplanationRecord, rawQuery: string): number {
  const head = wordStems(`${t.caption ?? ''} ${t.columns.map((c) => c.header_text ?? '').join(' ')} ${t.header_rows.flat().join(' ')}`);
  const words = rawQuery.replace(QUERY_CODE, ' ').split(/[^\p{L}\p{N}]+/u).map((w) => stemOf(w)).filter((x): x is string => x !== null && !['ямар', 'хэд', 'хэдэн', 'юу', 'вэ', 'бэ', 'байна', 'байх'].includes(x));
  return [...new Set(words)].filter((x) => [...head].some((w) => w.startsWith(x) || (w.length >= 4 && x.startsWith(w)))).length;
}
export function bestTableForValueAsk(db: DatabaseSync, docId: string, rawQuery: string): { table: TableExplanationRecord; rows: number[]; score: { total: number; rowHits: number; affinity: number } } | null {
  if (!hasObjects(db)) return null;
  const terms = tableTerms(rawQuery);
  if (terms.length === 0) return null;
  const all = (db.prepare(`SELECT record_json FROM ai_norm_explanation_objects WHERE doc_id = ? AND kind = 'table'`).all(docId) as Array<{ record_json: string }>)
    .map((r) => objectRecord<TableExplanationRecord>(r))
    .filter((t): t is TableExplanationRecord => t !== null);
  const ranked = all
    .map((t) => ({ t, s: tableRowScores(t, terms)[0] ?? null, a: headerAffinity(t, rawQuery) }))
    .filter((x): x is { t: TableExplanationRecord; s: { i: number; rowHits: number; total: number }; a: number } => x.s !== null)
    .sort((a, b) => b.s.total - a.s.total || b.s.rowHits - a.s.rowHits || b.a - a.a);
  const first = ranked[0];
  if (!first) return null;
  const enough = first.s.total === terms.length || first.s.total >= 2;
  // (мөрт гол үг заавал — tableRowScores rowHits > 0)
  const second = ranked[1];
  const clear = !second || second.s.total < first.s.total || (second.s.total === first.s.total && (second.s.rowHits < first.s.rowHits || second.a < first.a));
  if (!enough || !clear) return null;
  return { table: first.t, rows: matchTableRows(first.t, rawQuery), score: { total: first.s.total, rowHits: first.s.rowHits, affinity: first.a } };
}
/** Хоёр баримтын хамгийн сайн хүснэгтийг харьцуулна — ил давуу нь л; тэнцвэл null. */
export function pickValueTable<T extends { score: { total: number; rowHits: number; affinity: number } }>(hits: T[]): T | null {
  if (hits.length === 0) return null;
  const s = [...hits].sort((a, b) => b.score.total - a.score.total || b.score.rowHits - a.score.rowHits || b.score.affinity - a.score.affinity);
  const [a, b] = s;
  if (!b) return a!;
  const better = a!.score.total > b.score.total || (a!.score.total === b.score.total && (a!.score.rowHits > b.score.rowHits || a!.score.affinity > b.score.affinity));
  return better ? a! : null;
}

/* ── askNorm-ын үр дүнд залгах ────────────────────────────────────── */

export type ExplanationMode = 'exact_clause' | 'nearest_clause' | 'section' | 'document' | 'definition' | 'table' | 'formula' | 'classification';

export interface ExplanationBlock {
  schema: typeof EXPLANATION_SCHEMA;
  mode: ExplanationMode;
  /** Баримтын цоож — нэрлэсэн код (эсвэл олдсон хэсгийн баримт). */
  document: { doc_id: string; code: string };
  clause: ClauseExplanation | null;
  /** Хайлтаар ойролцоо олдсон бусад заалт (ижил баримт, ≤3) — «хамгийн ойр» гэж ил. */
  candidates: Array<{ clause_uid: string; clause_id: string; scope: string; heading: string | null; plain_mn: string; page: number | null }>;
  /** Дугаар давхардсан (8.3 ↔ A8:8.3) — сонгосныг ил хэлнэ. */
  ambiguity: { chosen: string; alternatives: string[] } | null;
  /** L2.1: баримт-локал түлхүүр үгээр askNorm-ын толгойг сольсон бол (оношилгоо). */
  rerank?: { from: string; to: string; reason: string } | null;
  section: SectionExplanation | null;
  documentExplanation: DocumentExplanation | null;
  /** L2.1: нэр томьёоны асуулт («Аюулын бүс гэж юу вэ?») — 1-р хавсралтын тодорхойлолт ЭХЭЭС. */
  definition: { term: string; definition: string; page: number | null; appendix: string | null; clause?: string | null; chunk_id: string; linked_clauses: string[]; source_url: string | null } | null;
  /** L2 (2026-09-23): хүснэгт (нүд ЭХЭЭС) + асуулттай таарсан мөрүүдийн индекс; томьёо(ууд); эх бичвэрийн жагсаалтаар ангилал. */
  table?: TableExplanationRecord | null;
  table_matched_rows?: number[];
  formulas?: FormulaExplanationRecord[];
  classification?: ClassificationBlock | null;
  computable: false;
  /** «Хүчинтэй эсэх» асуулт → бүртгэлийн замаар (энд шийдэгдэхгүй). */
  currentness_routed: boolean;
}

// ⚠️ ASCII `\b` кириллд үүсдэггүй — `(?<![\p{L}])` хил.
const SECTION_ASK = /(?<![\p{L}\d])(\d{1,2})\s*(?:-?р|-?Р|дугаар|дүгээр|дэх|дахь)?\s*(?:бүлэг|бүлгийн|бүлэгт|хэсэг|хэсгийн|хэсэгт|section|chapter)(?![\p{L}])/iu;
const SECTION_ASK_AFTER = /(?:бүлэг|хэсэг|section|chapter)\s*№?\s*(\d{1,2})(?![\d.])/iu;
const DOCUMENT_ASK = /юуны тухай|юу зохицуулд|хамрах хүрээ|хэрэглэх хүрээ|ямар агуулга|ямар бүлг|хэдэн бүлэг|бүтэц|товч(?:хон)? (?:танилц|тайлбар|хэл)|ерөнхийд нь|what is (?:it|this|the norm) about|scope of/iu;
/** «5.2-ыг», «5.2-ийн», «5.2 юу вэ» — нэрлэсэн баримтад нүцгэн дугаар = заалт (тоон хавсралтын «8-р» хэлбэрээс ялгаатай). */
const BARE_CLAUSE = /(?<![\d.\-–])(\d{1,2}(?:\.\d{1,3}){1,3})(?!\s*-?\s*(?:р|Р|дугаар|дүгээр)\s*хавсралт)(?![\d.])/u;
/** «Д.2.3.1 заалт», «Г.1.2» — үсэгтэй хавсралтын заалтын БҮТЭН дугаар (L2-ийн `clause_id`). */
const LETTER_CLAUSE = /(?<![\p{L}\d.])([А-ЯӨҮЁ]\.\s?\d{1,2}(?:\.\d{1,3}){0,3})(?![\d.])(?!\s*-?\s*р?\s*(?:хүснэгт|зураг|бүдүүвч))/u;
/** «8-р хавсралтын 8.3 заалт» — ТООН хавсралт (`extractDocRef.appendix` зөвхөн үсэгтэй хавсралт таньдаг). */
const NUMERIC_APPENDIX = /(?<![\p{L}\d.])(\d{1,2}(?:\.\d)?)\s*-?\s*(?:р|Р|дугаар|дүгээр|дэх|дахь)?\s*(?:хавсралт|havsralt|appendix)/iu;
const CURRENTNESS_ASK = /хүчин төгөлдөр|хүчинтэй (?:юу|эсэх|байгаа)|мөрдөгдөж (?:байгаа|буй)|хуучирсан|солигдсон|шинэчлэгдсэн|огноо|батлагдсан|is it (?:current|valid|in force)|still valid/iu;

function isPositiveInt(v: string | undefined): boolean {
  return v !== undefined && /^\d{1,2}$/.test(v);
}

/**
 * `askNorm`-ын ҮР ДҮН + асуултаас тайлбарын блок.  `null` = энэ ээлжид тайлбар байхгүй (баримт L2-гүй,
 * нэрлэсэн баримт санд алга, нэрлэсэн заалт баримтад алга, хэсэг олдоогүй).  ХЭЗЭЭ Ч өөр баримтын
 * бичлэг буцаахгүй.
 */
export function explainForAnswer(db: DatabaseSync, answer: NormativeAnswer, rawQuery: string): ExplanationBlock | null {
  if (!hasTable(db)) return null;
  const explained = explainedDocuments(db);
  if (explained.size === 0) return null;
  const named = answer.named_document;
  // Баримтын цоож: нэрлэсэн баримт → зөвхөн тэр; нэрлээгүй → толгой хэсгийн баримт.
  let docId: string | null = null;
  if (named !== null && named.code !== null) {
    if (named.absent || named.relation !== 'exact') return null;
    docId = named.docIds.find((id) => explained.has(id)) ?? null;
    if (docId === null) return null;
  }
  const currentnessRouted = CURRENTNESS_ASK.test(rawQuery);
  const q = answer.query;
  const base = (doc: string, mode: ExplanationMode): ExplanationBlock => ({
    schema: EXPLANATION_SCHEMA,
    mode,
    document: { doc_id: doc, code: explained.get(doc) ?? '' },
    clause: null,
    candidates: [],
    ambiguity: null,
    section: null,
    documentExplanation: null,
    definition: null,
    table: null,
    table_matched_rows: [],
    formulas: [],
    classification: null,
    computable: false,
    currentness_routed: currentnessRouted,
  });
  // L2 (2026-09-23) — хүснэгт / томьёо / ангилал.  Баримт: нэрлэсэн → түүнийг; эс бөгөөс толгой хэсгийн тайлбартай баримт.
  const scopeDoc = docId ?? answer.evidence.find((e) => explained.has(e.doc_id))?.doc_id ?? null;
  const tableAsk = TABLE_ASK.exec(rawQuery.replace(QUERY_CODE, ' '));
  const tableNo = tableAsk ? (tableAsk[1] ?? tableAsk[2] ?? '').replace(/\s+/g, '') : null;
  if (tableNo && scopeDoc !== null) {
    const t = tableByNo(db, scopeDoc, tableNo);
    if (t !== null) {
      const block = base(scopeDoc, 'table');
      block.table = t;
      block.table_matched_rows = matchTableRows(t, rawQuery);
      return block;
    }
    if (docId !== null) return null; // нэрлэсэн баримтад ийм хүснэгт алга — ЗОХИОХГҮЙ
  }
  const formulaAsk = FORMULA_ASK.exec(rawQuery.replace(QUERY_CODE, ' '));
  const formulaLabel = formulaAsk ? (formulaAsk[1] ?? formulaAsk[2] ?? null) : null;
  if (formulaLabel && scopeDoc !== null) {
    const f = formulaByLabel(db, scopeDoc, formulaLabel);
    if (f !== null) {
      const block = base(scopeDoc, 'formula');
      block.formulas = [f];
      return block;
    }
  }

  // C — ЯГ ЗААЛТ (нэрлэсэн баримт + заалтын дугаар).  «5.2-ыг тайлбарла» — «заалт» гэдэг үггүй, залгавартай нүцгэн
  //    дугаар ч нэрлэсэн баримтад заалтын хаяг (L2.1; askNorm-ын хайлт хөндөгдөхгүй, зөвхөн тайлбарын хаяг).
  const bareClause = docId !== null && q.docRef.clause === undefined ? (BARE_CLAUSE.exec(rawQuery.replace(QUERY_CODE, ' '))?.[1] ?? undefined) : undefined;
  const clauseAsked = q.docRef.clause ?? bareClause;
  if (docId !== null && clauseAsked !== undefined) {
    const numericAppendix = NUMERIC_APPENDIX.exec(rawQuery)?.[1] ?? null;
    // Үсэгтэй хавсралтын заалт: хайлтын ойлголт «Д.2.3.1»-ийг «хавсралт Д» + «2.3.1» гэж хуваадаг — L2-д заалтын дугаар
    //    үсгээ ХАДГАЛСАН («Д.2.3.1»); асуулт дахь бүтэн хэлбэр («Г.1.2») нүцгэн «1.2»-оос түрүүлнэ (үндсэн 1.2 руу гулсахгүй).
    const letterClause = LETTER_CLAUSE.exec(rawQuery.replace(QUERY_CODE, ' '))?.[1]?.replace(/\s+/g, '') ?? null;
    const letterApp = letterClause ? letterClause.split('.')[0]! : null;
    let { record, alternatives } = letterClause !== null ? explanationByClause(db, docId, letterClause, letterApp) : { record: null as ClauseExplanation | null, alternatives: [] as ClauseExplanation[] };
    if (record === null && letterClause === null) ({ record, alternatives } = explanationByClause(db, docId, clauseAsked, numericAppendix ?? q.docRef.appendix ?? null));
    if (record === null && letterClause === null && q.docRef.appendix && /^[А-ЯӨҮЁ]$/u.test(q.docRef.appendix)) ({ record, alternatives } = explanationByClause(db, docId, `${q.docRef.appendix}.${clauseAsked}`, q.docRef.appendix));
    if (record === null) return null; // заалт баримтад алга — `clause_not_in_named_document` замаар хариулна
    // «8.2.1 … энэ хүснэгт юу хэлээд байна?» — заалт ЯГ НЭГ шийдэгдсэн хүснэгт иш татсан бол тэр хүснэгт.
    // Зөвхөн хүснэгтийн АГУУЛГЫН асуулт («энэ хүснэгт юу хэлээд байна», «хүснэгтэд ямар утга») — «ямар хүснэгт иш татсан
    //    бэ?» бол ишлэлийн асуулт, заалтын горимд үлдэнэ (31-17-10 L2-027, хэмжсэн).
    if (TABLE_CONTENT_ASK.test(rawQuery) && !/иш\s+тат|cite/iu.test(rawQuery) && !FORMULA_WORD.test(rawQuery)) {
      const tabs = record.semantic_frame.cross_references.filter((x) => x.kind === 'table' && x.resolution === 'resolved');
      const only = tabs.length === 1 ? tableByNo(db, docId, tabs[0]!.target) : null;
      if (only !== null) {
        const block = base(docId, 'table');
        block.table = only;
        block.table_matched_rows = matchTableRows(only, rawQuery);
        return block;
      }
    }
    // «… заалтын томьёонд ямар хувьсагч байдаг вэ?» — заалтын томьёо(нууд).
    if (FORMULA_WORD.test(rawQuery)) {
      const fs = formulasByClause(db, docId, record.clause_id);
      if (fs.length > 0) {
        const block = base(docId, 'formula');
        block.formulas = fs.slice(0, 4);
        block.clause = record;
        return block;
      }
    }
    const block = base(docId, 'exact_clause');
    block.clause = record;
    if (alternatives.length > 0) block.ambiguity = { chosen: record.clause_uid, alternatives: alternatives.map((a) => a.clause_uid) };
    return block;
  }
  // B — ХЭСЭГ («5-р бүлэг юуны тухай вэ»), A — БАРИМТ («юуны тухай вэ») — зөвхөн нэрлэсэн баримтад.
  if (docId !== null) {
    const m = SECTION_ASK.exec(rawQuery) ?? SECTION_ASK_AFTER.exec(rawQuery);
    if (m && isPositiveInt(m[1])) {
      const sec = sectionExplanation(db, docId, String(Number(m[1])));
      if (sec !== null) {
        const block = base(docId, 'section');
        block.section = sec;
        return block;
      }
    }
    if (DOCUMENT_ASK.test(rawQuery) || (answer.evidence.length === 0 && answer.status === 'insufficient_evidence')) {
      const doc = documentExplanation(db, docId);
      if (doc !== null) {
        const block = base(docId, 'document');
        block.documentExplanation = doc;
        return block;
      }
    }
  }
  // L2 (2026-09-23) — «… тухай аль хэсэгт/бүлэгт байдаг вэ?» — бүлгийн ГАРЧГААР (эх бичвэрийн гарчиг), заалт биш.
  //    Баримт нэрлээгүй бол ангиллын блоктой ИЖИЛ дүрэм: хайлтын толгой баримт эхэлж, эс бөгөөс гарчиг нь таарсан ЦОРЫН
  //    ГАНЦ тайлбартай баримт — «Салхины ачааллын тухай аль хэсэгт…» асуултын толгой нотолгоо 31-17-10-ын салхины заалт
  //    байхад 20-04-17-ын «11 Салхины ачаалал» бүлгийг алдаж байв (2026-09-23, хэмжсэн).
  if (SECTION_FIND.test(rawQuery)) {
    const terms = contentStems(rawQuery).filter((t) => !['хэсэг', 'хэсэгт', 'бүлэг', 'бүлэгт', 'байда', 'тухай'].includes(t));
    const titleHits = (d: string) =>
      documentExplanation(db, d)?.sections.filter((s) => terms.length > 0 && terms.every((t) => [...wordStems(s.title)].some((w) => w.startsWith(t) || t.startsWith(w)))) ?? [];
    const candidates = docId !== null ? [docId] : [...new Set([scopeDoc, ...explained.keys()].filter((x): x is string => x !== null))];
    const found = candidates.map((d) => ({ d, hit: titleHits(d) })).filter((x) => x.hit.length === 1);
    const pick = docId !== null || found.length === 1 ? found[0] : found.find((x) => x.d === scopeDoc);
    const d = pick?.d ?? null;
    const hit = pick?.hit ?? [];
    if (d !== null && hit.length === 1) {
      const sec = sectionExplanation(db, d, hit[0]!.section);
      if (sec !== null) {
        const block = base(d, 'section');
        block.section = sec;
        return block;
      }
    }
  }
  // L2 (2026-09-23) — АНГИЛАЛ эх бичвэрийн жагсаалтаар («Цасны ачаалал ямар ангилалд ордог вэ?», «Тогтмол ачаалал гэж юу вэ?»).
  //    Баримт нэрлээгүй бол: толгой хэсгийн баримт эхэлж, эс бөгөөс жагсаалтад таарсан ЦОРЫН ГАНЦ тайлбартай баримт.
  {
    const candidates = docId !== null ? [docId] : [...new Set([scopeDoc, ...explained.keys()].filter((x): x is string => x !== null))];
    const hits = candidates.map((d) => ({ d, c: classificationLookup(db, d, rawQuery) })).filter((x) => x.c !== null);
    const pick = docId !== null || hits.length === 1 ? hits[0] : hits.find((x) => x.d === scopeDoc);
    if (pick && pick.c) {
      const block = base(pick.d, 'classification');
      block.classification = pick.c;
      return block;
    }
  }
  // L2.1 — НЭР ТОМЬЁО: толгой хэсэг definition (1-р хавсралт) бол тодорхойлолтыг ЭХЭЭС (document_explanation.definitions).
  const topDef = answer.evidence.find((e) => (docId === null || e.doc_id === docId) && explained.has(e.doc_id) && e.kind === 'definition');
  if (topDef !== undefined && answer.status !== 'insufficient_evidence' && (answer.evidence[0]?.chunk_id === topDef.chunk_id || docId !== null)) {
    const doc = documentExplanation(db, topDef.doc_id);
    const d = doc?.definitions?.find((x) => x.chunk_id === topDef.chunk_id) ?? null;
    const qStems = contentStems(rawQuery);
    const overlaps = d ? qStems.length === 0 || qStems.some((t) => [...wordStems(d.term)].some((w) => w.startsWith(t) || t.startsWith(w))) : false;
    if (d !== null && d !== undefined && overlaps) {
      const block = base(topDef.doc_id, 'definition');
      block.definition = { term: d.term, definition: d.definition, page: d.page, appendix: d.appendix, clause: (d as { clause?: string | null }).clause ?? null, chunk_id: d.chunk_id, linked_clauses: d.linked_clauses, source_url: doc?.source.url ?? null };
      return block;
    }
  }
  // D0' — УТГЫН асуулт («… нормын утга хэд вэ?»): эхний 3 нотолгооны дундаас мөр нь асуулттай ТААРСАН хүснэгт (мөрийн
  //    шошгоор) толгой заалтаас түрүүлнэ.  Мөр таарахгүй бол энэ алхам алгасна — хүснэгт ЗОХИОЖ сонгохгүй.
  if (VALUE_ASK.test(rawQuery)) {
    // Баримт нэрлээгүй, нотолгоо ч алга (корпусын хамаарлын хаалга) бол тайлбартай БҮХ баримтаас — ЦОРЫН ГАНЦ баримт тод
    //    таарсан үед л (хоёр баримт таарвал аль нэгийг СОНГОХГҮЙ).
    const docs = scopeDoc !== null ? [scopeDoc] : [...explained.keys()];
    const hits = docs
      .map((d) => ({ d, best: bestTableForValueAsk(db, d, rawQuery) }))
      .filter((x): x is { d: string; best: NonNullable<ReturnType<typeof bestTableForValueAsk>> } => x.best !== null && x.best.rows.length > 0)
      .map((x) => ({ ...x, score: x.best.score }));
    const chosen = pickValueTable(hits);
    if (chosen !== null) {
      const block = base(chosen.d, 'table');
      block.table = chosen.best.table;
      block.table_matched_rows = chosen.best.rows;
      return block;
    }
  }
  // D0 — толгой хэсэг ХҮСНЭГТ / ТОМЬЁО бол түүний L2 объект (заалт биш).
  const headObj = answer.evidence.find((e) => (docId === null || e.doc_id === docId) && explained.has(e.doc_id));
  // Хүснэгт/томьёо нь асуулт ТЭДНИЙГ асуусан үед л («хүснэгт», «томьёо», утгын асуулт) — эс бөгөөс тэдгээрийн заалт
  //    (сэдвийн paraphrase асуултад томьёоны объект гарч байв — хэмжсэн).
  const wantsObject = headObj !== undefined && (headObj.kind === 'table' ? TABLE_WORD_ANY.test(rawQuery) || VALUE_ASK.test(rawQuery) : FORMULA_WORD.test(rawQuery));
  if (headObj !== undefined && wantsObject && answer.status !== 'insufficient_evidence' && (headObj.kind === 'table' || headObj.kind === 'formula')) {
    if (headObj.kind === 'table') {
      const t = tableByChunk(db, headObj.chunk_id);
      // Утгын асуултад мөр нь таараагүй хүснэгтийг харуулахгүй (хамааралгүй хүснэгтийн утга хариулт мэт харагдана).
      if (t !== null && !(VALUE_ASK.test(rawQuery) && matchTableRows(t, rawQuery).length === 0)) {
        const block = base(headObj.doc_id, 'table');
        block.table = t;
        block.table_matched_rows = matchTableRows(t, rawQuery);
        return block;
      }
    } else {
      const f = formulaByChunk(db, headObj.chunk_id);
      if (f !== null) {
        const block = base(headObj.doc_id, 'formula');
        block.formulas = [f];
        return block;
      }
    }
  }
  // D — ХАЙЛТААР ОЛДСОН ЗААЛТ (paraphrase): толгой хэсэг тайлбартай баримтынх байвал.
  const top = answer.evidence.find((e) => (docId === null || e.doc_id === docId) && explained.has(e.doc_id) && e.kind === 'clause');
  if (top === undefined) return null;
  if (answer.status === 'insufficient_evidence') return null;
  const record = explanationByChunk(db, top.chunk_id);
  if (record === null) return null;
  const block = base(top.doc_id, 'nearest_clause');
  // L2.1 — БАРИМТ ДОТОРХ түлхүүр үгийн дахин эрэмбэ (askNorm-ын ГЛОБАЛ эрэмбэ ХӨНДӨГДӨХГҮЙ): нэрлэсэн баримтад
  //    «Өндөр барилга бүрд …» гэх мэт баримтын нийтлэг үгсээр дүүрэн асуултад BM25 3.1-ийг толгойлуулж, 14.93 эхний 5-д ч
  //    ордоггүй байв (хэмжсэн).  Баримт-локал IDF («бүрд» тэр баримтад ховор) + askNorm-ын эрэмбэ хамт.
  const askOrder = answer.evidence.filter((e) => e.doc_id === top.doc_id && e.kind === 'clause').map((e) => e.chunk_id);
  const ranked = rerankWithinDocument(db, top.doc_id, rawQuery, askOrder);
  const head = ranked[0] && ranked[0].chunk_id !== top.chunk_id ? explanationByChunk(db, ranked[0].chunk_id) : null;
  block.clause = head ?? record;
  if (head) block.rerank = { from: record.clause_uid, to: head.clause_uid, reason: 'document_local_keywords' };
  const order = [...ranked.map((r) => r.chunk_id), ...askOrder];
  const seen = new Set<string>();
  for (const chunkId of order) {
    if (chunkId === block.clause.chunk_id || seen.has(chunkId)) continue;
    seen.add(chunkId);
    const r = explanationByChunk(db, chunkId);
    if (r === null) continue;
    block.candidates.push({ clause_uid: r.clause_uid, clause_id: r.clause_id, scope: r.scope, heading: r.heading_path[0] ?? null, plain_mn: r.plain_mn, page: r.source.page });
    if (block.candidates.length >= 3) break;
  }
  return block;
}

/* ── L2.1: баримт доторх түлхүүр үгийн дахин эрэмбэ ────────────────── */
const QUERY_STOP = new Set(['тухай', 'талаар', 'юу', 'юуг', 'ямар', 'заасан', 'заана', 'гэж', 'байна', 'байдаг', 'бэ', 'вэ', 'уу', 'үү', 'бол', 'нь', 'болон', 'ба', 'хэд', 'хэдэн', 'яаж', 'хэрхэн', 'тайлбарла', 'энгийнээр', 'заалт', 'заалтад', 'норм', 'нормын', 'дүрэм', 'хамаарах', 'шаардлага', 'шаарддаг', 'хэлбэл', 'ийн', 'ын']);
const QUERY_CODE = /(?:БНбД|БНОД|БД|УББ|MNS|СНиП)\s*[-–]?\s*[\d\-–.*/]+(?:-?\p{L}{0,4})?/giu;
function queryKeys(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.replace(QUERY_CODE, ' ').split(/[^\p{L}\p{N}]+/u)) {
    const w = raw.toLowerCase();
    if (w.length < 3 || QUERY_STOP.has(w) || /^\d/.test(w)) continue;
    out.push(w.slice(0, 5));
  }
  return [...new Set(out)];
}
interface DocKeyIndex { df: Map<string, number>; rows: Array<{ chunk_id: string; keys: Set<string>; subjectKeys: Set<string> }>; n: number }
// Кэш нь САН тус бүрд (WeakMap) — тестийн :memory: сангууд ижил doc_id-тай тул хооронд хуваалцахгүй.
const docIndexCache = new WeakMap<DatabaseSync, Map<string, DocKeyIndex>>();
function docKeyIndex(db: DatabaseSync, docId: string): DocKeyIndex {
  let perDb = docIndexCache.get(db);
  if (!perDb) { perDb = new Map(); docIndexCache.set(db, perDb); }
  const cached = perDb.get(docId);
  if (cached) return cached;
  const rows = db.prepare(`SELECT chunk_id, source_text, heading_path_json, frame_json FROM ai_norm_explanations WHERE kind = 'clause' AND doc_id = ?`).all(docId) as unknown as Array<{ chunk_id: string; source_text: string; heading_path_json: string; frame_json: string }>;
  const df = new Map<string, number>();
  const out: DocKeyIndex['rows'] = [];
  for (const r of rows) {
    let subject: string[] = [];
    try { subject = (JSON.parse(r.frame_json) as { subject?: string[] }).subject ?? []; } catch { /* ignore */ }
    const keys = new Set(queryKeys(`${r.source_text} ${r.heading_path_json}`));
    const subjectKeys = new Set(queryKeys(subject.join(' ')));
    for (const k of keys) df.set(k, (df.get(k) ?? 0) + 1);
    out.push({ chunk_id: r.chunk_id, keys, subjectKeys });
  }
  const idx = { df, rows: out, n: rows.length };
  perDb.set(docId, idx);
  return idx;
}
/** Дахин шингээлтийн дараа тухайн сангийн баримт-локал индексийг цэвэрлэнэ. */
export function resetExplainCache(db: DatabaseSync): void {
  docIndexCache.delete(db);
}
/**
 * Баримт-локал IDF оноо: асуултын түлхүүр бүрд log(N/df); субъектэд байвал ×1.5.  askNorm-ын толгой нь дээд оноотой L2
 * заалтаас ≥1 ХОВОР түлхүүрээр (баримтад ≤5 заалтад л байдаг үг) + ≥15 % илүү оноогоор хоцорч байвал л солигдоно;
 * бусад тохиолдолд askNorm-ын толгой хэвээр (BM25-ыг үл итгэхгүй, зөвхөн нийтлэг үгсээр дүүрсэн асуултыг л засна).
 */
export function rerankWithinDocument(db: DatabaseSync, docId: string, rawQuery: string, askNormOrder: readonly string[]): Array<{ chunk_id: string; score: number; matched: string[] }> {
  const qk = queryKeys(rawQuery);
  if (qk.length === 0) return askNormOrder.map((chunk_id) => ({ chunk_id, score: 0, matched: [] }));
  const idx = docKeyIndex(db, docId);
  const idf = (k: string): number => Math.log((idx.n + 1) / ((idx.df.get(k) ?? 0) + 1));
  const rareThreshold = Math.log((idx.n + 1) / 6);
  const rank = new Map(askNormOrder.map((id, i) => [id, i] as const));
  const scored = idx.rows
    .map((r) => {
      const matched = qk.filter((k) => r.keys.has(k));
      const score = matched.reduce((a, k) => a + idf(k) * (r.subjectKeys.has(k) ? 1.5 : 1), 0);
      return { chunk_id: r.chunk_id, score, matched, rare: matched.filter((k) => idf(k) >= rareThreshold).length };
    })
    .filter((r) => r.matched.length >= 2 || (r.matched.length === 1 && r.rare > 0) || rank.has(r.chunk_id))
    .sort((a, b) => b.score - a.score || (rank.get(a.chunk_id) ?? 1e9) - (rank.get(b.chunk_id) ?? 1e9));
  if (scored.length === 0) return askNormOrder.map((chunk_id) => ({ chunk_id, score: 0, matched: [] }));
  const best = scored[0]!;
  const topAsk = askNormOrder[0];
  const topEntry = scored.find((r) => r.chunk_id === topAsk);
  const topAskScore = topEntry?.score ?? 0;
  // askNorm-ын толгойг зөвхөн: (а) толгойд БАЙХГҮЙ асуултын түлхүүр таарсан, (б) оноо ≥1.5 дахин — ил давуу үед л солино.
  const gainsKey = best.matched.some((k) => !(topEntry?.matched ?? []).includes(k));
  if (topAsk !== undefined && best.chunk_id !== topAsk && !(gainsKey && best.score > topAskScore * 1.5)) {
    return [{ chunk_id: topAsk, score: topAskScore, matched: [] }, ...scored.filter((r) => r.chunk_id !== topAsk).slice(0, 4).map(({ chunk_id, score, matched }) => ({ chunk_id, score, matched }))];
  }
  return scored.slice(0, 5).map(({ chunk_id, score, matched }) => ({ chunk_id, score, matched }));
}

/** Тест/оношилгоо: код → doc_id (fold-оор). */
export function explainedDocIdForCode(db: DatabaseSync, code: string): string | null {
  const want = foldText(code);
  for (const [id, c] of explainedDocuments(db)) if (foldText(c) === want) return id;
  return null;
}
