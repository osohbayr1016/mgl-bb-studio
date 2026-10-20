/**
 * L2 — НОРМ ОЙЛГОХ / ТАЙЛБАРЛАХ ДАВХАРГА, Worker тал (2026-09-18, эхлээд ЗӨВХӨН БНбД 31-17-10).
 *
 * Runtime `/norm` → `explanation` (ai/retrieval/src/explain.ts) блокийг ЦАГААН ЖАГСААЛТААР уншиж, хариултын
 * ДЕТЕРМИНИСТ загварыг угсарна (гэрээ `templateOnly` — загвар үүсгэлт ХИЙХГҮЙ: заалтын агуулга, тоо, эх
 * сурвалж бүгд L2 бичлэгээс, тэр нь эх бичвэрээс).
 *
 * ⚠️ ТООЦООНЫ ХААЛГА.  «... хангах уу?», «ямар ангилалд орох вэ?», «хэдэн ... хэрэгтэй вэ?» гэх мэт тооцоо /
 *    ангилал / pass-fail / хэмжээ асуусан ээлжид L2 загвар ХЭРЭГЛЭГДЭХГҮЙ — одоо байгаа детерминист зам
 *    (trustedNorm / localNormTemplate) хэвээр, трейлерээр «L2 тооцоо хийхгүй, L3 ирээдүйд» гэж ил хэлнэ.
 * ⚠️ ХҮЧИНТЭЙ ЭСЭХ нь L2-ийн ажил биш — гэрээний одоогийн currentness трейлер хэвээр залгагдана.
 * ⚠️ Эх бичвэрт ТОГТООГООГҮЙ зүйлийг хэлэхгүй: хоосон хэсэг ОРХИГДОНО; асуулт тухайлан асуусан бол
 *    («ямар нөхцөлд?») «эх бичвэрт тусгайлан заагаагүй» гэж ил.
 */
import type { TrustedContract } from './trustedFacts';

export type Lang = 'mn-Cyrl' | 'en';

export interface ExplanationCrossRef {
  kind: 'document' | 'clause' | 'table' | 'appendix';
  target: string;
  resolved: boolean | null;
  /** L2.1: resolved (энэ баримтад олдсон) · unresolved (олдсонгүй — ТААМАГЛАХГҮЙ) · external (өөр баримт). */
  resolution: 'resolved' | 'unresolved' | 'external';
  /** L2 (2026-09-23): өөр баримтын хүснэгт/заалт («БНбД 23-01-09-ийн 1-р хүснэгт») — тэр баримтын код. */
  document?: string | null;
  /** Хуучин код албан тушаалаар хүчингүй болсон бол ОДООГИЙН залгамж — эх ишлэл (`target`) ХЭВЭЭР. */
  resolvedCurrentCode?: string | null;
  registryStatus?: string | null;
}

/** L2 (2026-09-23): албан ТАЙЛБАР — НОРМ БИШ (COMMENTARY_SOURCE), тусдаа эшлэлтэй блок. */
export interface CommentaryView {
  code: string;
  marker: string;
  item: string | null;
  noCommentary: boolean;
  excerpt: string | null;
  page: number | null;
  url: string | null;
  seeAlso: string[];
}

export interface TableView {
  tableNo: string;
  caption: string | null;
  clauseContext: string | null;
  referring: Array<{ clauseId: string; text: string; page: number | null }>;
  columns: Array<{ header: string | null; unit: string | null; role: string }>;
  rows: Array<{ index: number; rowNo: string | null; groupPath: string[]; label: string; values: string[]; alignment: string; continued: boolean }>;
  matchedRows: number[];
  notes: string[];
  ambiguousRows: number;
  page: number | null;
  sourceUrl: string | null;
  pdfUrl: string | null;
}
export interface FormulaView {
  label: string;
  expression: string;
  quality: string;
  clauseId: string | null;
  variables: Array<{ symbol: string; definition: string }>;
  page: number | null;
  sourceUrl: string | null;
  pdfUrl: string | null;
}
export interface ClassificationView {
  kind: 'member' | 'concept';
  groups: Array<{ clauseId: string; lead: string; items: Array<{ marker: string; text: string }>; trailing: string | null; page: number | null; sourceUrl: string | null }>;
  scheme: Array<{ clauseId: string; text: string; page: number | null }>;
  definition: { term: string; definition: string; clause: string | null; page: number | null } | null;
  multipleCategories: boolean;
}

export interface ExplanationTerm {
  term: string;
  appendix?: string | null;
  clause?: string | null;
  definition: string | null;
  matchedSurface: string | null;
  method: string | null;
}

export interface ClauseExplanationView {
  code: string;
  clauseId: string;
  clauseUid: string;
  scope: 'body' | 'appendix';
  appendix: string | null;
  headingPath: string[];
  sourceText: string;
  plainMn: string;
  requirementType: string;
  subject: string[];
  requirement: string[];
  conditions: string[];
  exceptions: string[];
  prohibitions: string[];
  permissions: string[];
  crossReferences: ExplanationCrossRef[];
  definitions: ExplanationTerm[];
  numericLiterals: string[];
  /**
   * L2.1 хоёр шатлалт хоолой: `plainCandidate` = загварын ноорог, ЗӨВХӨН семантик шалгагч PASS өгсөн бол (эс тэгвэл null);
   * `plainFallback` = детерминист, эхийн өгүүлбэрүүд (үргэлж бий).  Рендер: PASS candidate → «Энгийнээр», бусад → fallback.
   */
  plainCandidate: string | null;
  plainFallback: string;
  semanticValidation: 'PASS' | 'FAIL' | 'NOT_RUN';
  explanationGeneration: string;
  humanReview: string;
  page: number | null;
  sourceUrl: string | null;
  pdfUrl: string | null;
  verification: 'AUTO_DRAFT' | 'HUMAN_VERIFIED';
  commentary: CommentaryView[];
}

export interface LocalNormExplanation {
  mode: 'exact_clause' | 'nearest_clause' | 'section' | 'document' | 'definition' | 'table' | 'formula' | 'classification';
  code: string;
  clause: ClauseExplanationView | null;
  candidates: Array<{ clauseUid: string; clauseId: string; heading: string | null; plainMn: string; page: number | null }>;
  ambiguity: { chosen: string; alternatives: string[] } | null;
  section: { section: string; title: string; page: number | null; clauseIds: string[]; clauseCount: number; requirementTypes: Record<string, number>; firstClause: { clauseId: string; text: string } | null; crossDocuments: string[]; sourceUrl: string | null; commentary: CommentaryView[] } | null;
  document: { titleMn: string | null; scopeText: string | null; notApplicableText: string | null; sections: Array<{ section: string; title: string; page: number | null; clauseCount: number }>; appendixCount: number; sourceUrl: string | null; pdfUrl: string | null; legalUrl: string | null; counts: Record<string, number>; supersedes: string[]; commentarySource: { code: string; title: string | null; url: string | null } | null } | null;
  /** L2.1: нэр томьёо — 1-р хавсралтын тодорхойлолт ЭХЭЭС (зохиогдохгүй). */
  definition: { term: string; definition: string; page: number | null; appendix: string | null; clause: string | null; linkedClauses: string[]; sourceUrl: string | null } | null;
  /** L2 (2026-09-23): хүснэгт (нүд ЭХЭЭС) · томьёо (гүйцэтгэхгүй) · эх бичвэрийн жагсаалтаар ангилал. */
  table: TableView | null;
  formulas: FormulaView[];
  classification: ClassificationView | null;
  currentnessRouted: boolean;
}

const MAX_TEXT = 1600;
const MAX_LIST = 6;

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  return s.length === 0 ? null : s.slice(0, max);
}
function strList(v: unknown, max = MAX_LIST, len = 600): string[] {
  return Array.isArray(v) ? v.map((x) => str(x, len)).filter((x): x is string => x !== null).slice(0, max) : [];
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function https(v: unknown): string | null {
  const s = str(v, 300);
  return s !== null && /^https:\/\//.test(s) ? s : null;
}

const REQ_TYPES = new Set(['scope', 'definition', 'obligation', 'prohibition', 'permission', 'reference', 'procedure', 'informational']);
const XREF_KINDS = new Set(['document', 'clause', 'table', 'appendix']);

function commentaryList(v: unknown): CommentaryView[] {
  if (!Array.isArray(v)) return [];
  const out: CommentaryView[] = [];
  for (const x of v.slice(0, 8)) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    // ⚠️ Зөвхөн COMMENTARY_SOURCE + normative:false — өөр үүрэгтэй бичлэг «тайлбар» болж харагдахгүй.
    if (o.role !== 'COMMENTARY_SOURCE' || o.normative !== false) continue;
    const code = str(o.code, 40);
    const marker = str(o.marker, 24);
    if (!code || !marker) continue;
    out.push({ code, marker, item: str(o.item, 4), noCommentary: o.no_commentary === true, excerpt: str(o.excerpt, 700), page: num(o.page), url: https(o.url), seeAlso: strList(o.see_also, 6, 16) });
  }
  return out;
}

function tableView(raw: unknown, matched: unknown): TableView | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  const tableNo = str(t.table_no, 16);
  if (!tableNo || (t.execution as { computable?: unknown } | undefined)?.computable !== false) return null;
  const src = (t.source ?? {}) as Record<string, unknown>;
  const rows: TableView['rows'] = [];
  if (Array.isArray(t.rows)) {
    for (const r of t.rows.slice(0, 80)) {
      if (!r || typeof r !== 'object') continue;
      const o = r as Record<string, unknown>;
      const values = Array.isArray(o.values) ? o.values.map((v) => (typeof v === 'string' ? v.trim().slice(0, 200) : '')).slice(0, 12) : [];
      rows.push({ index: num(o.index) ?? rows.length, rowNo: str(o.row_no, 12), groupPath: strList(o.group_path, 4, 300), label: str(o.label, 700) ?? '', values, alignment: str(o.alignment, 24) ?? 'parsed_text', continued: o.continued_from_previous_page === true });
    }
  }
  const columns: TableView['columns'] = Array.isArray(t.columns)
    ? t.columns.slice(0, 16).map((c) => {
        const o = (c ?? {}) as Record<string, unknown>;
        return { header: str(o.header_text, 300), unit: str(o.unit, 16), role: str(o.role, 12) ?? 'value' };
      })
    : [];
  const referring: TableView['referring'] = Array.isArray(t.referring_clauses)
    ? t.referring_clauses
        .slice(0, 6)
        .map((c) => {
          const o = (c ?? {}) as Record<string, unknown>;
          return { clauseId: str(o.clause_id, 32) ?? '', text: str(o.text, 600) ?? '', page: num(o.page) };
        })
        .filter((c) => c.clauseId)
    : [];
  const matchedRows = Array.isArray(matched) ? matched.filter((i): i is number => typeof i === 'number').slice(0, 6) : [];
  const ra = (t.row_alignment ?? {}) as Record<string, unknown>;
  return { tableNo, caption: str(t.caption, 120), clauseContext: str(t.clause_context, 32), referring, columns, rows, matchedRows, notes: strList(t.notes, 4, 900), ambiguousRows: num(ra.ambiguous_packed) ?? 0, page: num(src.page), sourceUrl: https(src.url), pdfUrl: https(src.pdf_url) };
}

function formulaView(raw: unknown): FormulaView | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Record<string, unknown>;
  const label = str(f.label, 24);
  const expression = str(f.expression, 600);
  if (!label || !expression || (f.execution as { computable?: unknown } | undefined)?.computable !== false) return null;
  const src = (f.source ?? {}) as Record<string, unknown>;
  const variables = Array.isArray(f.variable_definitions)
    ? f.variable_definitions
        .slice(0, 12)
        .map((v) => {
          const o = (v ?? {}) as Record<string, unknown>;
          return { symbol: str(o.symbol, 20) ?? '', definition: str(o.definition, 300) ?? '' };
        })
        .filter((v) => v.symbol && v.definition)
    : [];
  return { label, expression, quality: str(f.expression_quality, 32) ?? 'unknown', clauseId: str(f.clause_id, 32), variables, page: num(src.page), sourceUrl: https(src.url), pdfUrl: https(src.pdf_url) };
}

function classificationView(raw: unknown): ClassificationView | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const kind = c.kind === 'member' || c.kind === 'concept' ? c.kind : null;
  if (!kind || !Array.isArray(c.groups)) return null;
  const groups: ClassificationView['groups'] = [];
  for (const g of c.groups.slice(0, 6)) {
    if (!g || typeof g !== 'object') continue;
    const o = g as Record<string, unknown>;
    const clauseId = str(o.clause_id, 32);
    const lead = str(o.lead, 400);
    if (!clauseId || !lead || !Array.isArray(o.items)) continue;
    const items = o.items
      .slice(0, 16)
      .map((it) => {
        const x = (it ?? {}) as Record<string, unknown>;
        return { marker: str(x.marker, 2) ?? '', text: str(x.text, 500) ?? '' };
      })
      .filter((it) => it.marker && it.text);
    if (items.length > 0) groups.push({ clauseId, lead, items, trailing: str(o.trailing, 400), page: num(o.page), sourceUrl: https(o.source_url) });
  }
  if (groups.length === 0) return null;
  const scheme = Array.isArray(c.scheme)
    ? c.scheme
        .slice(0, 2)
        .map((x) => {
          const o = (x ?? {}) as Record<string, unknown>;
          return { clauseId: str(o.clause_id, 32) ?? '', text: str(o.text, 500) ?? '', page: num(o.page) };
        })
        .filter((x) => x.clauseId && x.text)
    : [];
  const d = c.definition && typeof c.definition === 'object' ? (c.definition as Record<string, unknown>) : null;
  const dTerm = d ? str(d.term, 120) : null;
  const dText = d ? str(d.definition, 900) : null;
  const definition = d && dTerm && dText ? { term: dTerm, definition: dText, clause: str(d.clause, 16), page: num(d.page) } : null;
  return { kind, groups, scheme, definition, multipleCategories: c.multiple_categories === true };
}

function clauseView(raw: unknown): ClauseExplanationView | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const code = str(r.norm_code, 64);
  const clauseId = str(r.clause_id, 32);
  const clauseUid = str(r.clause_uid, 96);
  const sourceText = str(r.source_text, MAX_TEXT);
  if (!code || !clauseId || !clauseUid || !sourceText) return null;
  const exec = r.execution as { computable?: unknown } | undefined;
  if (exec?.computable !== false) return null; // L2 бичлэг ЗААВАЛ тооцоогүй
  const frame = (r.semantic_frame ?? {}) as Record<string, unknown>;
  const ctx = (r.context ?? {}) as Record<string, unknown>;
  const src = (r.source ?? {}) as Record<string, unknown>;
  const ver = (r.verification as { explanation?: unknown } | undefined)?.explanation;
  const crossReferences: ExplanationCrossRef[] = [];
  if (Array.isArray(frame.cross_references)) {
    for (const x of frame.cross_references.slice(0, 12)) {
      if (!x || typeof x !== 'object') continue;
      const o = x as Record<string, unknown>;
      const kind = str(o.kind, 16);
      const target = str(o.target, 40);
      if (!kind || !target || !XREF_KINDS.has(kind)) continue;
      const resolution = o.resolution === 'resolved' || o.resolution === 'unresolved' || o.resolution === 'external' ? o.resolution : kind === 'document' ? 'external' : o.resolved === true ? 'resolved' : 'unresolved';
      crossReferences.push({ kind: kind as ExplanationCrossRef['kind'], target, resolved: typeof o.resolved === 'boolean' ? o.resolved : null, resolution, document: str(o.document, 60), resolvedCurrentCode: str(o.resolved_current_code, 40), registryStatus: str(o.registry_status, 40) });
    }
  }
  const definitions: ExplanationTerm[] = [];
  if (Array.isArray(ctx.definitions)) {
    for (const d of ctx.definitions.slice(0, 6)) {
      if (!d || typeof d !== 'object') continue;
      const o = d as Record<string, unknown>;
      const term = str(o.term, 80);
      if (!term) continue;
      definitions.push({ term, appendix: str(o.appendix, 8), clause: str(o.clause, 16), definition: str(o.definition, 400), matchedSurface: str(o.matched_surface, 120), method: str(o.match_method, 20) });
    }
  }
  const st = (r.status ?? {}) as Record<string, unknown>;
  const semanticValidation = st.semantic_validation === 'PASS' ? 'PASS' : st.semantic_validation === 'FAIL' ? 'FAIL' : 'NOT_RUN';
  const candidateRaw = str(r.plain_mn_candidate, MAX_TEXT);
  const numericLiterals = Array.isArray(r.numeric_literals) ? r.numeric_literals.map((n) => (n && typeof n === 'object' ? str((n as Record<string, unknown>).literal, 40) : null)).filter((x): x is string => x !== null).slice(0, 12) : [];
  const reqType = str(r.requirement_type, 20);
  return {
    code,
    clauseId,
    clauseUid,
    scope: r.scope === 'appendix' ? 'appendix' : 'body',
    appendix: str(r.appendix, 8),
    headingPath: strList(r.heading_path, 4, 200),
    sourceText,
    plainMn: str(r.plain_mn, MAX_TEXT) ?? '',
    requirementType: reqType !== null && REQ_TYPES.has(reqType) ? reqType : 'informational',
    subject: strList(frame.subject, 3, 200),
    requirement: strList(frame.requirement),
    conditions: strList(frame.conditions),
    exceptions: strList(frame.exceptions),
    prohibitions: strList(frame.prohibitions),
    permissions: strList(frame.permissions),
    crossReferences,
    definitions,
    numericLiterals,
    // Нэр дэвшигч ЗӨВХӨН семантик PASS + ХҮНИЙ хяналт APPROVED үед (2026-09-18: PASS-ын ~1/4 нь утгын дутагдалтай — «зөв атлаа
    //    хатуу» fallback дээр; хүний хяналтын багц l2/review/HUMAN_REVIEW_100.jsonl).  Сервер талын хаалт — runtime-д итгэхгүй.
    plainCandidate: semanticValidation === 'PASS' && st.human_review === 'APPROVED' && candidateRaw && !/\?\s*$/.test(candidateRaw) ? candidateRaw : null,
    plainFallback: str(r.plain_mn_fallback, MAX_TEXT) ?? str(r.plain_mn, MAX_TEXT) ?? '',
    semanticValidation,
    explanationGeneration: str(st.explanation_generation, 40) ?? 'DETERMINISTIC_DIGEST',
    humanReview: str(st.human_review, 40) ?? 'NOT_REVIEWED',
    page: num(src.page),
    sourceUrl: https(src.url),
    pdfUrl: https(src.pdf_url),
    verification: ver === 'HUMAN_VERIFIED' ? 'HUMAN_VERIFIED' : 'AUTO_DRAFT',
    commentary: commentaryList(r.commentary),
  };
}

/** Runtime `/norm.explanation` → цагаан жагсаалт.  Танигдахгүй/тооцоотой бичлэг = null (ХЭЗЭЭ Ч зохиохгүй). */
export function parseLocalNormExplanation(raw: unknown): LocalNormExplanation | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.schema !== 'l2-clause/1' || r.computable !== false) return null;
  const mode = str(r.mode, 20);
  if (mode !== 'exact_clause' && mode !== 'nearest_clause' && mode !== 'section' && mode !== 'document' && mode !== 'definition' && mode !== 'table' && mode !== 'formula' && mode !== 'classification') return null;
  const doc = (r.document ?? {}) as Record<string, unknown>;
  const code = str(doc.code, 64);
  if (!code) return null;
  const clause = clauseView(r.clause);
  const candidates: LocalNormExplanation['candidates'] = [];
  if (Array.isArray(r.candidates)) {
    for (const c of r.candidates.slice(0, 3)) {
      if (!c || typeof c !== 'object') continue;
      const o = c as Record<string, unknown>;
      const clauseUid = str(o.clause_uid, 96);
      const clauseId = str(o.clause_id, 32);
      if (!clauseUid || !clauseId) continue;
      candidates.push({ clauseUid, clauseId, heading: str(o.heading, 200), plainMn: str(o.plain_mn, 500) ?? '', page: num(o.page) });
    }
  }
  const amb = r.ambiguity && typeof r.ambiguity === 'object' ? (r.ambiguity as Record<string, unknown>) : null;
  const ambiguity = amb && str(amb.chosen, 96) ? { chosen: str(amb.chosen, 96)!, alternatives: strList(amb.alternatives, 4, 96) } : null;
  let section: LocalNormExplanation['section'] = null;
  if (r.section && typeof r.section === 'object') {
    const s = r.section as Record<string, unknown>;
    const sec = str(s.section, 8);
    const title = str(s.title, 200);
    const fc = s.first_clause && typeof s.first_clause === 'object' ? (s.first_clause as Record<string, unknown>) : null;
    if (sec && title) {
      const types: Record<string, number> = {};
      if (s.requirement_types && typeof s.requirement_types === 'object') {
        for (const [k, v] of Object.entries(s.requirement_types as Record<string, unknown>)) if (REQ_TYPES.has(k) && typeof v === 'number') types[k] = v;
      }
      const ssrc = (s.source ?? {}) as Record<string, unknown>;
      section = { section: sec, title, page: num(s.page), clauseIds: strList(s.clause_ids, 200, 16), clauseCount: num(s.clause_count) ?? 0, requirementTypes: types, firstClause: fc && str(fc.clause_id, 32) ? { clauseId: str(fc.clause_id, 32)!, text: str(fc.text, 300) ?? '' } : null, crossDocuments: strList(s.cross_documents, 12, 40), sourceUrl: https(ssrc.url), commentary: commentaryList(s.commentary) };
    }
  }
  let document: LocalNormExplanation['document'] = null;
  if (r.documentExplanation && typeof r.documentExplanation === 'object') {
    const d = r.documentExplanation as Record<string, unknown>;
    const src = (d.source ?? {}) as Record<string, unknown>;
    const sections: NonNullable<LocalNormExplanation['document']>['sections'] = [];
    if (Array.isArray(d.sections)) {
      for (const s of d.sections.slice(0, 30)) {
        if (!s || typeof s !== 'object') continue;
        const o = s as Record<string, unknown>;
        const sec = str(o.section, 8);
        const title = str(o.title, 200);
        if (sec && title) sections.push({ section: sec, title, page: num(o.page), clauseCount: num(o.clause_count) ?? 0 });
      }
    }
    const counts: Record<string, number> = {};
    if (d.counts && typeof d.counts === 'object') for (const [k, v] of Object.entries(d.counts as Record<string, unknown>)) if (typeof v === 'number' && /^[a-z_]{1,24}$/.test(k)) counts[k] = v;
    document = { titleMn: str(d.title_mn, 200), scopeText: str(d.scope_text, MAX_TEXT), notApplicableText: str(d.not_applicable_text, MAX_TEXT), sections, appendixCount: Array.isArray(d.appendices) ? d.appendices.length : 0, sourceUrl: https(src.url), pdfUrl: https(src.pdf_url), legalUrl: https(src.legal_url), counts, supersedes: Array.isArray(d.supersedes) ? d.supersedes.map((x) => (x && typeof x === 'object' ? str((x as Record<string, unknown>).code, 40) : null)).filter((x): x is string => x !== null).slice(0, 4) : [], commentarySource: (() => { const c = d.commentary_source && typeof d.commentary_source === 'object' ? (d.commentary_source as Record<string, unknown>) : null; const cc = c && c.role === 'COMMENTARY_SOURCE' && c.normative === false ? str(c.code, 40) : null; return cc ? { code: cc, title: str(c!.title_mn, 200), url: https(c!.url) } : null; })() };
  }
  let definition: LocalNormExplanation['definition'] = null;
  if (r.definition && typeof r.definition === 'object') {
    const d = r.definition as Record<string, unknown>;
    const term = str(d.term, 120);
    const text = str(d.definition, MAX_TEXT);
    if (term && text) definition = { term, definition: text, page: num(d.page), appendix: str(d.appendix, 8), clause: str(d.clause, 16), linkedClauses: strList(d.linked_clauses, 12, 96), sourceUrl: https(d.source_url) };
  }
  const table = mode === 'table' ? tableView(r.table, r.table_matched_rows) : null;
  const formulas = mode === 'formula' && Array.isArray(r.formulas) ? r.formulas.slice(0, 4).map(formulaView).filter((f): f is FormulaView => f !== null) : [];
  const classification = mode === 'classification' ? classificationView(r.classification) : null;
  if (mode === 'table' && table === null) return null;
  if (mode === 'formula' && formulas.length === 0) return null;
  if (mode === 'classification' && classification === null) return null;
  if (clause === null && section === null && document === null && definition === null && table === null && formulas.length === 0 && classification === null) return null;
  return { mode, code, clause, candidates, ambiguity, section, document, definition, table, formulas, classification, currentnessRouted: r.currentness_routed === true };
}

/* ── Тооцооны хаалга ─────────────────────────────────────────────── */

// ⚠️ ASCII `\b` кириллд үүсдэггүй — `(?<![\p{L}])` хил.
const CALC_ASK = /(?<![\p{L}])(тооц\p{L}*|бод(?:ож|оод|но|ох|оорой)?|хангах\s+уу|хангаж\s+байна\s+уу|хангасан\s+уу|хангалттай\s+юу|нийц\p{L}*\s+(?:уу|үү|байна\s+уу)|тэнц\p{L}*\s+(?:үү|уу)|зөвшөөрөгд\p{L}*\s+(?:үү|уу)|ямар\s+ангилал\p{L}*|ангилалд\s+ор\p{L}*|аль\s+ангилал|хэдэн\s+(?:\p{L}+\s+){1,3}(?:хэрэгтэй|шаардлагатай|шаард\p{L}*)|хэд\s+байх\s+ёстой|хэмжээ\p{L}*\s+(?:нь\s+)?хэд|calculate|compute|does\s+(?:it|a|the)?\s*[\p{L}\d\s.,]{0,40}?(?:comply|pass|meet|satisfy)|which\s+class)(?![\p{L}])/iu;
const NUMBER_WITH_UNIT = /\d+(?:[.,]\d+)?\s*(?:м²|м2|м³|м3|мм|см|м(?![\p{L}])|кН|кПа|кпа|МПа|кгс|кг|давхар|хүн|%|°C|°С|секунд|сек|минут|мин|цаг)/iu;
const CONDITIONAL_VALUE = /\d+(?:[.,]\d+)?[^.?!]{0,40}(?:бол|байвал|үед|тохиолдолд)(?![\p{L}])/iu;

/**
 * Тооцоо / ангилал / pass-fail / хэмжээ асуусан эсэх — L2 ЗАГВАР ХЭРЭГЛЭХГҮЙ.  Тоо + нэгж + нөхцөлт
 * хэллэг, эсвэл шууд тооцооны үг.  «5.2 заалт юу гэж заасан бэ?» (заалтын дугаар) энд ОРОХГҮЙ.
 */
export function isComputationAsk(question: string): boolean {
  const q = question.replace(/(?:БНбД|БНОД|БД|УББ|MNS|СНиП)\s*[\d\-–.*/]+/giu, ' ').replace(/\d+(?:\.\d+)+\s*(?:-?р|-?ийн|-?ын|-?д|-?т)?\s*(?:заалт|зүйл|хавсралт|хүснэгт|бүлэг)/giu, ' ');
  if (CALC_ASK.test(q)) return true;
  return NUMBER_WITH_UNIT.test(q) && CONDITIONAL_VALUE.test(q);
}

/* ── Хэрэглэгчийн тухайлсан асуулт (хоосон хэсгийг ил хэлэх) ──────── */
const ASK_CONDITIONS = /ямар\s+нөхцөл|нөхцөл\p{L}*\s+(?:юу|вэ|бэ|нь)|хэзээ\s+хамаар|under what condition/iu;
const ASK_EXCEPTIONS = /онцгой\s+нөхцөл|үл\s+хамаарах|хамаарахгүй\s+(?:тохиолдол|үе|нь)|exception/iu;
const ASK_PROHIBITIONS = /хориг\p{L}*|болохгүй\s+(?:зүйл|юу)|prohibit|forbidden/iu;
const ASK_SUBJECT = /хэнд\s+хамаар|юунд\s+хамаар|хэн(?:д|ий)\s+(?:тухай|хамаар)|who does|apply to whom/iu;
const ASK_XREF = /холбогдох\s+заалт|ямар\s+(?:заалт|норм|хүснэгт)\p{L}*\s+(?:иш|ишлэ|заа|холбо)|иш\s+татсан|cross.?refer|related clause/iu;
/** «Яагаад?» — үндэслэл асуусан: эхэд байхгүй бол ЗОХИОХГҮЙ (§15). */
const ASK_WHY = /(?<![\p{L}])(?:яагаад|яагад|учир\s+нь\s+юу|шалтгаан\s+нь\s+юу|ямар\s+үндэслэл|why)(?![\p{L}])/iu;
/** «Энэ нь дээвэрт хамаарах уу?» — хамаарах эсэхийг ЭХ БИЧВЭРТ тэр үг байгаа эсэхээр л (тооцоо/дүгнэлт биш). */
const ASK_APPLIES = /(?<![\p{L}])(\p{L}{3,})(?:-?[дт]|-?нд)?\s+(?:хамаар(?:ах|на)\s+уу|мөн\s+үү|орох\s+уу|хамаатай\s+юу)/iu;

/* ── Рендер ──────────────────────────────────────────────────────── */

const REQ_LABEL_MN: Record<string, string> = {
  scope: 'хэрэглэх хүрээний заалт',
  definition: 'нэр томьёоны тодорхойлолт',
  obligation: 'заавал биелүүлэх шаардлага',
  prohibition: 'хориглосон зүйл',
  permission: 'зөвшөөрсөн зүйл',
  reference: 'өөр норм руу заасан заалт',
  procedure: 'дараалал / журмын заалт',
  informational: 'мэдээллийн заалт',
};
const REQ_LABEL_EN: Record<string, string> = {
  scope: 'scope clause',
  definition: 'definition',
  obligation: 'mandatory requirement',
  prohibition: 'prohibition',
  permission: 'permission',
  reference: 'reference to another norm',
  procedure: 'procedure',
  informational: 'informational clause',
};

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${cut.slice(0, at > max * 0.6 ? at : max).trimEnd()}…`;
}

/**
 * SYMBOL-фонтын PUA (U+F020–U+F0FF) → Unicode, СТАНДАРТ Adobe Symbol кодчилолоор (таамаг биш: Windows symbol фонт нь
 * тэмдэгтийг F000+код дээр байршуулдаг).  Эх PDF-ийн текст давхаргад γf, ≤, ≥, μ, ψ … ингэж ХАДГАЛАГДСАН (хэмжсэн: БНбД 20-04-17-д
 * 925 тэмдэгт) — задалсан эх бичвэр ХӨНДӨГДӨХГҮЙ, зөвхөн харуулахдаа.  Мэдэгдээгүй код хэвээр үлдэнэ.
 */
const SYMBOL_PUA: Record<number, string> = (() => {
  const m: Record<number, string> = {};
  const ascii = ' !∀#∃%&∋()∗+,−./0123456789:;<=>?≅ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ[∴]⊥_‾αβχδεφγηιϕκλμνοπθρστυϖωξψζ{|}∼';
  for (let i = 0; i < ascii.length; i += 1) m[0x20 + i] = ascii[i]!;
  const hi: Record<number, string> = { 0xa1: 'ϒ', 0xa2: '′', 0xa3: '≤', 0xa4: '⁄', 0xa5: '∞', 0xa6: 'ƒ', 0xb0: '°', 0xb1: '±', 0xb2: '″', 0xb3: '≥', 0xb4: '×', 0xb5: '∝', 0xb6: '∂', 0xb7: '•', 0xb8: '÷', 0xb9: '≠', 0xba: '≡', 0xbb: '≈', 0xbc: '…', 0xd6: '√', 0xd7: '⋅', 0xd8: '¬', 0xd9: '∧', 0xda: '∨', 0xe5: '∑', 0xe6: '⎛', 0xe7: '⎜', 0xe8: '⎝', 0xe9: '⎡', 0xea: '⎢', 0xeb: '⎣', 0xf1: '⟩', 0xf2: '∫', 0xf6: '⎞', 0xf7: '⎟', 0xf8: '⎠', 0xf9: '⎤', 0xfa: '⎥', 0xfb: '⎦' };
  Object.assign(m, hi);
  return m;
})();
export function decodeSymbolPua(text: string): string {
  return text.replace(/[-]/g, (ch) => SYMBOL_PUA[ch.charCodeAt(0) - 0xf000] ?? ch);
}

function xrefLabel(x: ExplanationCrossRef, lang: Lang): string {
  const en = lang === 'en';
  if (x.kind === 'document') {
    // Хуучин код: эх ишлэл ХЭВЭЭР + одоогийн залгамж (албан тушаалаар хүчингүй болсон) — эх бичвэрийг засахгүй.
    if (x.resolvedCurrentCode) return en ? `${x.target} (superseded — current successor: ${x.resolvedCurrentCode}, by official order)` : `${x.target} (хүчингүй болсон — одоогийн залгамж: ${x.resolvedCurrentCode}, албан тушаалаар)`;
    return x.target;
  }
  if (x.resolution === 'external' && x.document) {
    const lbl = x.kind === 'table' ? (en ? `Table ${x.target}` : `${x.target}-р хүснэгт`) : x.kind === 'appendix' ? (en ? `Appendix ${x.target}` : `${x.target}-р хавсралт`) : en ? `clause ${x.target}` : `${x.target} заалт`;
    return en ? `${lbl} (of ${x.document} — another document)` : `${lbl} (${x.document} — өөр баримтынх)`;
  }
  if (x.kind === 'table') return en ? `Table ${x.target}` : `${x.target}-р хүснэгт`;
  if (x.kind === 'appendix') return en ? `Appendix ${x.target}` : `${x.target}-р хавсралт`;
  return en ? `clause ${x.target}` : `${x.target} заалт`;
}

/** Нэр томьёоны байршил: 31-17-10 → «1-р хавсралт», 20-04-17 → «3.1.1 заалт» (эх бичвэр хаана тодорхойлсноор). */
function definitionPlace(appendix: string | null, clause: string | null, lang: Lang): string {
  const en = lang === 'en';
  if (clause) return en ? `clause ${clause} (terms)` : `${clause} заалт, нэр томьёо`;
  return en ? `Appendix ${appendix ?? '1'} (terms)` : `${appendix ?? '1'}-р хавсралт, нэр томьёо`;
}

/**
 * АЛБАН ТАЙЛБАРЫН блок — НОРМ БИШ.  Нормын заалтын ДАРАА, тусдаа гарчиг + тусдаа эшлэлтэй; «Албан тайлбарт … гэж
 * тайлбарласан» хэлбэрээр.  «Тайлбаргүй» нь зөвхөн тайлбар тухайлан асуусан үед ил хэлэгдэнэ.
 */
function commentaryBlock(list: CommentaryView[], lang: Lang, askedExplicitly: boolean): string | null {
  const en = lang === 'en';
  const withText = list.filter((c) => !c.noCommentary && c.excerpt);
  if (withText.length === 0) {
    if (!askedExplicitly) return null;
    const c = list[0];
    if (!c) return null;
    return `**${en ? `Official commentary — ${c.code} (not a norm)` : `Албан тайлбар — ${c.code} (норм биш)`}**\n${c.seeAlso.length > 0 ? (en ? `The commentary refers to its notes on ${c.seeAlso.join(', ')}.` : `Албан тайлбарт энэ заалтын тайлбарыг ${c.seeAlso.join(', ')}-ийн тайлбараас үзэхийг заасан.`) : en ? 'The official commentary gives no commentary on this clause («Тайлбаргүй»).' : 'Албан тайлбарт энэ заалтад тайлбар өгөөгүй («Тайлбаргүй»).'}`;
  }
  const lines = withText.slice(0, 2).map((c) => {
    const where = `${c.code} · ${c.marker}.Т${c.page !== null ? (en ? ` · p. ${c.page}` : ` · х. ${c.page}`) : ''}${c.url ? ` · [MCIS](${c.url})` : ''}`;
    return `${en ? 'The official commentary explains' : 'Албан тайлбарт'}${c.item ? (en ? ` (item ${c.item})` : ` (${c.item} зүйл)`) : ''}: «${clip(c.excerpt!, 600)}»${en ? '' : ' гэж тайлбарласан.'}\n_${where}_`;
  });
  return `**${en ? `Official commentary — ${withText[0]!.code} (not a norm)` : `Албан тайлбар — ${withText[0]!.code} (норм биш)`}**\n${lines.join('\n')}`;
}
const ASK_COMMENTARY = /албан\s+тайлбар|тайлбар\s+(?:ном|бичиг)|БД\s*20-102-21|commentary/iu;

function sourceLine(code: string, where: string | null, page: number | null, url: string | null, pdfUrl: string | null, lang: Lang): string {
  const en = lang === 'en';
  const bits = [code];
  if (where) bits.push(where);
  if (page !== null) bits.push(en ? `printed p. ${page}` : `хэвлэмэл х. ${page}`);
  const links = [url ? `[MCIS](${url})` : null, pdfUrl ? `[PDF](${pdfUrl})` : null].filter((x): x is string => x !== null);
  return `**${en ? 'Source' : 'Эх сурвалж'}**: ${bits.join(' · ')}${links.length > 0 ? ` · ${links.join(' · ')}` : ''}`;
}

/** Тухайлсан асуулт («ямар нөхцөлд?», «онцгой нөхцөл?», «хэнд?», «холбогдох заалт?») → зөвхөн тэр хэсэг(үүд) + эх сурвалж. */
type Focus = 'subject' | 'conditions' | 'exceptions' | 'prohibitions' | 'xref' | 'why' | 'applies';
export function focusOf(question: string): Set<Focus> {
  const f = new Set<Focus>();
  if (ASK_WHY.test(question)) f.add('why');
  if (ASK_APPLIES.test(question)) f.add('applies');
  if (ASK_SUBJECT.test(question)) f.add('subject');
  if (ASK_CONDITIONS.test(question)) f.add('conditions');
  if (ASK_EXCEPTIONS.test(question)) f.add('exceptions');
  if (ASK_PROHIBITIONS.test(question)) f.add('prohibitions');
  if (ASK_XREF.test(question)) f.add('xref');
  return f;
}

/** Асуултын «дээвэрт» → «дээвэр» (залгавар хасах, 4 тэмдэгтийн угтвар) — эх бичвэрт байгаа эсэх. */
function termInSource(term: string, source: string): string | null {
  const stem = term.toLowerCase().replace(/(?:ууд|үүд|нууд|нүүд)?(?:ын|ийн|ыг|ийг|аас|ээс|оос|өөс|аар|ээр|оор|өөр|тай|тэй|той|анд|энд|онд|өнд|нд|д|т)$/u, '');
  const key = stem.slice(0, Math.max(4, Math.min(stem.length, 5)));
  if (key.length < 4) return null;
  for (const sentence of source.split(/(?<=[.;!?])\s+/u)) {
    if (sentence.toLowerCase().split(/[^\p{L}]+/u).some((w) => w.startsWith(key))) return sentence.trim();
  }
  return null;
}

const CORE_HEADING_MN: Record<string, string> = {
  scope: 'Хэрэглэх хүрээ',
  definition: 'Тодорхойлолт',
  obligation: 'Энэ заалт юу шаардаж байна',
  prohibition: 'Энэ заалт юуг хориглож байна',
  permission: 'Энэ заалт юуг зөвшөөрч байна',
  reference: 'Энэ заалт хаана заана',
  procedure: 'Энэ заалт ямар дараалал тогтооно',
  informational: 'Энэ заалт юу хэлж байна',
};
const CORE_HEADING_EN: Record<string, string> = {
  scope: 'Scope', definition: 'Definition', obligation: 'What this clause requires', prohibition: 'What this clause prohibits', permission: 'What this clause permits', reference: 'Where this clause points', procedure: 'What procedure this clause sets', informational: 'What this clause states',
};

function renderClause(x: LocalNormExplanation, c: ClauseExplanationView, lang: Lang, question: string): string {
  const en = lang === 'en';
  const out: string[] = [];
  const focus = focusOf(question);
  const full = focus.size === 0;
  const where = c.scope === 'appendix' && c.appendix ? (en ? `Appendix ${c.appendix}, clause ${c.clauseId}` : `${c.appendix}-р хавсралт, ${c.clauseId} заалт`) : en ? `clause ${c.clauseId}` : `${c.clauseId} заалт`;
  out.push(`**${c.code} — ${where}**${c.headingPath.length > 0 ? `\n_${c.headingPath.join(' › ')}_` : ''}`);
  if (x.mode === 'nearest_clause') out.push(en ? '_No clause number was named — this is the closest clause found by search._' : '_Заалтын дугаар нэрлээгүй тул хайлтаар олдсон ХАМГИЙН ОЙР заалт._');

  const core = c.requirementType === 'prohibition' ? c.prohibitions : c.requirementType === 'permission' ? c.permissions : c.requirement;
  const bullets = (xs: string[], max = 400) => xs.map((s) => `• ${clip(s, max)}`).join('\n');

  // «Яагаад?» — эхэд үндэслэл байхгүй бол ЗОХИОХГҮЙ, ил хэлнэ (§15).
  if (focus.has('why')) {
    out.push(`**${en ? 'Why' : 'Яагаад'}**\n${en ? 'This clause sets the requirement, but the clause itself does not explain the engineering rationale behind it.' : 'Энэ заалт шаардлагыг тогтоосон боловч тухайн шаардлагын инженерийн үндэслэлийг энэ заалт өөрөө тайлбарлаагүй.'}`);
    if (core.length > 0) out.push(`**${en ? CORE_HEADING_EN[c.requirementType] : CORE_HEADING_MN[c.requirementType]}**\n${bullets(core.slice(0, 2))}`);
  }
  // «… дээвэрт хамаарах уу?» — эх бичвэрт тэр үг байгаа/байхгүйг л хэлнэ.
  if (focus.has('applies')) {
    const m = ASK_APPLIES.exec(question);
    const term = m?.[1] ?? '';
    const hit = term ? termInSource(term, c.sourceText) : null;
    out.push(`**${en ? `Does it apply — «${term}»` : `Хамаарах уу — «${term}»`}**\n${hit ? (en ? `The source text mentions it: «${clip(hit, 300)}»` : `Эх бичвэрт дурдсан: «${clip(hit, 300)}»`) : en ? `The source text of this clause does not mention «${term}» — the clause itself does not settle whether it applies.` : `Энэ заалтын эх бичвэрт «${term}» тусгайлан дурдаагүй — хамаарах эсэхийг энэ заалт өөрөө тогтоогоогүй.`}`);
    if (c.subject.length > 0) out.push(`**${en ? 'Applies to' : 'Хэнд / юунд хамаарах'}**\n${c.subject.join('; ')}`);
    const cond0 = c.conditions.filter((s) => !core.slice(0, 2).includes(s));
    if (cond0.length > 0) out.push(`**${en ? 'When it applies' : 'Хэзээ хамаарах'}**\n${bullets(cond0)}`);
  }

  if (full) {
    // Энгийнээр: семантик шалгагч PASS өгсөн нэр дэвшигч, эс тэгвэл детерминист fallback.  Хоёулаа эхийн утга.
    out.push(`**${en ? 'In plain terms' : 'Энгийнээр'}**\n${c.plainCandidate ?? c.plainFallback}`);
    if (core.length > 0) out.push(`**${en ? CORE_HEADING_EN[c.requirementType] : CORE_HEADING_MN[c.requirementType]}**\n${bullets(core.slice(0, 3))}`);
  }

  const subj = c.subject.length > 0 ? c.subject.join('; ') : null;
  if (subj && focus.has('subject')) out.push(`**${en ? 'Applies to' : 'Хэнд / юунд хамаарах'}**\n${subj}`);
  else if (focus.has('subject')) out.push(`**${en ? 'Applies to' : 'Хэнд / юунд хамаарах'}**\n${en ? 'The source text does not name a specific subject.' : 'Эх бичвэрт тусгайлан заагаагүй.'}`);

  const cond = c.conditions.filter((s) => !core.slice(0, 3).includes(s));
  if (cond.length > 0 && (full || focus.has('conditions'))) out.push(`**${en ? 'When it applies' : 'Хэзээ хамаарах'}**\n${bullets(cond)}`);
  else if (focus.has('conditions')) out.push(`**${en ? 'When it applies' : 'Хэзээ хамаарах'}**\n${en ? 'The source text sets no explicit condition.' : 'Эх бичвэрт тусгайлан нөхцөл заагаагүй.'}`);

  if (c.exceptions.length > 0 && (full || focus.has('exceptions'))) out.push(`**${en ? 'Exceptions' : 'Онцгой нөхцөл'}**\n${bullets(c.exceptions)}`);
  else if (focus.has('exceptions')) out.push(`**${en ? 'Exceptions' : 'Онцгой нөхцөл'}**\n${en ? 'The source text states no exception.' : 'Эх бичвэрт онцгой нөхцөл заагаагүй.'}`);

  // Анхаарах нөхцөл — үндсэн төрлөөс гадуурх хориглол/зөвшөөрөл (эхийн өгүүлбэр).
  const extraProh = c.requirementType === 'prohibition' ? [] : c.prohibitions;
  const extraPerm = c.requirementType === 'permission' ? [] : c.permissions;
  if (focus.has('prohibitions')) {
    if (c.prohibitions.length > 0) out.push(`**${en ? 'Prohibited' : 'Хориглосон'}**\n${bullets(c.prohibitions)}`);
    else out.push(`**${en ? 'Prohibited' : 'Хориглосон'}**\n${en ? 'The source text contains no prohibition.' : 'Эх бичвэрт хориглосон зүйл заагаагүй.'}`);
  } else if (full && (extraProh.length > 0 || extraPerm.length > 0)) {
    out.push(`**${en ? 'Also note' : 'Анхаарах нөхцөл'}**\n${bullets([...extraProh.map((s) => (en ? `Prohibited: ${s}` : `Хориглосон: ${s}`)), ...extraPerm.map((s) => (en ? `Permitted: ${s}` : `Зөвшөөрсөн: ${s}`))])}`);
  }

  const refs = c.crossReferences.map((r) => `${xrefLabel(r, lang)}${r.resolution === 'unresolved' ? (en ? ' (not found in this document — unresolved)' : ' (энэ баримтад олдсонгүй — шийдэгдээгүй ишлэл)') : ''}`);
  // Нэр томьёо: хамгийн тодорхой (урт) 2 л — «Ачаалал» мэт ерөнхий нэр томьёо 20-04-17-ийн 130+ заалтад таардаг.  Байршил нь
  //    эх бичвэр ХААНА тодорхойлсноор (1-р хавсралт / 3.1.N заалт) — «1-р хавсралт» гэж хатуу бичихгүй.
  const defs = [...c.definitions]
    .sort((a, b) => b.term.length - a.term.length)
    .slice(0, 2)
    .map((d) => (d.definition ? `${en ? `term «${d.term}»` : `«${d.term}»`} — ${clip(d.definition, 220)} (${definitionPlace(d.appendix ?? null, d.clause ?? null, lang)})` : `«${d.term}» (${definitionPlace(d.appendix ?? null, d.clause ?? null, lang)})`));
  if ((refs.length > 0 || defs.length > 0) && (full || focus.has('xref'))) out.push(`**${en ? 'Related' : 'Холбогдох'}**\n${[...refs, ...defs].map((s) => `• ${s}`).join('\n')}`);
  else if (focus.has('xref')) out.push(`**${en ? 'Related' : 'Холбогдох'}**\n${en ? 'The source text cites no other clause or document.' : 'Эх бичвэрт өөр заалт, баримт иш татаагүй.'}`);

  if (full && c.numericLiterals.length > 0) out.push(`**${en ? 'Numbers as written' : 'Тоо (эхийн хэлбэрээр)'}**\n${c.numericLiterals.join(' · ')}`);
  if (full) out.push(`**${en ? 'Source text' : 'Эх бичвэр'}**\n«${clip(c.sourceText, 900)}»`);
  // Албан тайлбар (норм БИШ) — нормын эх бичвэрийн ДАРАА, тусдаа эшлэлтэй.  «Яагаад?» асуултад ч: үндэслэлийг норм өөрөө
  //    хэлээгүй ч албан тайлбар хэлсэн байж болно — «Албан тайлбарт … гэж тайлбарласан» хэлбэрээр л.
  if (full || focus.has('why') || ASK_COMMENTARY.test(question)) {
    const cb = commentaryBlock(c.commentary, lang, ASK_COMMENTARY.test(question));
    if (cb !== null) out.push(cb);
  }

  if (x.ambiguity && x.ambiguity.alternatives.length > 0) {
    const alt = x.ambiguity.alternatives.map((a) => a.replace(/^.*#/, '')).map((a) => (a.startsWith('A') ? (en ? `Appendix ${a.slice(1).split(':')[0]} clause ${a.split(':')[1]}` : `${a.slice(1).split(':')[0]}-р хавсралтын ${a.split(':')[1]} заалт`) : en ? `body clause ${a}` : `үндсэн хэсгийн ${a} заалт`));
    out.push(en ? `_Note: the same number also exists as ${alt.join(', ')} — name the appendix to get that one._` : `_Анхаар: ижил дугаартай ${alt.join(', ')} мөн бий — түүнийг асуувал хавсралтаа нэрлэнэ үү._`);
  }
  if (x.candidates.length > 0 && full) out.push(`**${en ? 'Also see' : 'Мөн үзэх'}**\n${x.candidates.map((k) => `• ${k.clauseId}${k.page !== null ? (en ? ` (p. ${k.page})` : ` (х. ${k.page})`) : ''}${k.heading ? ` — ${clip(k.heading, 80)}` : ''}`).join('\n')}`);
  out.push(sourceLine(c.code, where, c.page, c.sourceUrl, c.pdfUrl, lang));
  return out.join('\n\n');
}

function renderSection(x: LocalNormExplanation, lang: Lang): string {
  const en = lang === 'en';
  const s = x.section!;
  const out: string[] = [];
  out.push(`**${x.code} — ${en ? `Section ${s.section}` : `${s.section}-р бүлэг`}: ${s.title}**`);
  const range = s.clauseIds.length > 0 ? `${s.clauseIds[0]}–${s.clauseIds[s.clauseIds.length - 1]}` : null;
  out.push(`${en ? 'Clauses' : 'Заалт'}: ${s.clauseCount}${range ? ` (${range})` : ''}`);
  const types = Object.entries(s.requirementTypes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${en ? REQ_LABEL_EN[k] : REQ_LABEL_MN[k]} ${v}`);
  if (types.length > 0) out.push(`${en ? 'By type' : 'Төрлөөр'}: ${types.join(' · ')}`);
  if (s.firstClause) out.push(`**${en ? 'Opens with' : 'Эхний заалт'}** (${s.firstClause.clauseId}): «${clip(s.firstClause.text, 260)}»`);
  if (s.crossDocuments.length > 0) out.push(`**${en ? 'Cites' : 'Иш татсан норм'}**: ${s.crossDocuments.join(', ')}`);
  const cb = commentaryBlock(s.commentary, lang, false);
  if (cb !== null) out.push(cb);
  out.push(en ? '_Ask a clause number (e.g. «clause 5.2») for the plain explanation of a specific clause._' : '_Тодорхой заалтын тайлбар авахын тулд дугаарыг нь асууна уу (ж. «5.2 заалт»)._');
  out.push(sourceLine(x.code, en ? `Section ${s.section}` : `${s.section}-р бүлэг`, s.page, s.sourceUrl, null, lang));
  return out.join('\n\n');
}

function renderDocument(x: LocalNormExplanation, lang: Lang): string {
  const en = lang === 'en';
  const d = x.document!;
  const out: string[] = [];
  out.push(`**${x.code}${d.titleMn ? ` — ${d.titleMn}` : ''}**`);
  if (d.scopeText) out.push(`**${en ? 'Scope (clause 1.1)' : 'Хэрэглэх хүрээ (1.1 заалт)'}**\n«${clip(d.scopeText, 700)}»`);
  if (d.notApplicableText) out.push(`**${en ? 'Not applicable to (1.2)' : 'Хамаарахгүй (1.2 заалт)'}**\n«${clip(d.notApplicableText, 500)}»`);
  if (d.sections.length > 0) out.push(`**${en ? 'Sections' : 'Бүлгүүд'}**\n${d.sections.map((s) => `${s.section}. ${s.title} (${s.clauseCount})`).join('\n')}`);
  const counts = [d.counts.clauses !== undefined ? `${en ? 'clauses' : 'заалт'} ${d.counts.clauses}` : null, d.appendixCount > 0 ? `${en ? 'appendices' : 'хавсралт'} ${d.appendixCount}` : null, d.counts.tables !== undefined ? `${en ? 'tables' : 'хүснэгт'} ${d.counts.tables}` : null, d.counts.definitions !== undefined ? `${en ? 'definitions' : 'нэр томьёо'} ${d.counts.definitions}` : null].filter((s): s is string => s !== null);
  if (counts.length > 0) out.push(`${en ? 'Structure' : 'Бүтэц'}: ${counts.join(' · ')}`);
  // Батлах тушаалын бичвэрт заасан залгамж (энэ норм өөрөө хүчингүй болгосон) ба албан тайлбар (норм БИШ) — баримтын өөрийн мэдээлэл.
  if (d.supersedes.length > 0) out.push(en ? `**Replaced**: ${d.supersedes.join(', ')} (declared void when this norm was approved)` : `**Хүчингүй болгосон**: ${d.supersedes.join(', ')} (энэ нормыг батлахдаа хүчингүй болсонд тооцсон)`);
  if (d.commentarySource) out.push(en ? `**Official commentary**: ${d.commentarySource.code}${d.commentarySource.url ? ` · [MCIS](${d.commentarySource.url})` : ''} — explanatory, not a norm` : `**Албан тайлбар**: ${d.commentarySource.code}${d.commentarySource.url ? ` · [MCIS](${d.commentarySource.url})` : ''} — тайлбар, норм биш`);
  const links = [d.sourceUrl ? `[MCIS](${d.sourceUrl})` : null, d.pdfUrl ? `[PDF](${d.pdfUrl})` : null, d.legalUrl ? `[legalinfo.mn](${d.legalUrl})` : null].filter((s): s is string => s !== null);
  out.push(`**${en ? 'Source' : 'Эх сурвалж'}**: ${x.code}${links.length > 0 ? ` · ${links.join(' · ')}` : ''}`);
  return out.join('\n\n');
}

function renderDefinition(x: LocalNormExplanation, lang: Lang): string {
  const en = lang === 'en';
  const d = x.definition!;
  const out: string[] = [];
  out.push(`**${x.code} — ${en ? 'term' : 'нэр томьёо'} «${d.term}»**`);
  out.push(`**${en ? 'Definition (verbatim)' : 'Тодорхойлолт (эхээс үг үсгээрээ)'}**\n«${clip(d.definition, 900)}»`);
  if (d.linkedClauses.length > 0) out.push(`**${en ? 'Used in clauses' : 'Хэрэглэгдсэн заалт'}**\n${d.linkedClauses.slice(0, 12).map((u) => u.replace(/^.*#/, '')).join(', ')}${d.linkedClauses.length >= 12 ? ' …' : ''}`);
  out.push(sourceLine(x.code, definitionPlace(d.appendix, d.clause, lang), d.page, d.sourceUrl ?? x.document?.sourceUrl ?? null, null, lang));
  return out.join('\n\n');
}

/**
 * ХҮСНЭГТ — нүд бүр ЭХЭЭС; нэгж ЗӨВХӨН баганын толгойд хэвлэгдсэнээр; тооцоо, интерполяц, «таны тохиолдолд» ХИЙХГҮЙ.
 * Асуулттай таарсан мөр байвал тэдгээрийг, эс бөгөөс хүснэгтийн мөрүүдийг (≤ 16).  Геометрээр баталгаажаагүй мөр ил.
 */
function renderTable(x: LocalNormExplanation, lang: Lang): string {
  const en = lang === 'en';
  const t = x.table!;
  const out: string[] = [];
  out.push(`**${x.code} — ${en ? `Table ${t.tableNo}` : `${t.tableNo}-р хүснэгт`}**`);
  if (t.referring.length > 0) {
    out.push(`**${en ? 'What the table is for (the clauses that cite it)' : 'Энэ хүснэгтийг иш татсан заалт'}**\n${t.referring.slice(0, 3).map((r) => `• ${r.clauseId}: «${clip(r.text, 320)}»`).join('\n')}`);
  } else if (t.clauseContext) {
    out.push(en ? `_The table is printed under clause ${t.clauseContext}; no clause text cites it by number in the extracted text._` : `_Хүснэгт ${t.clauseContext} заалтын хэсэгт хэвлэгдсэн; задалсан бичвэрт түүнийг дугаараар нь иш татсан заалт олдсонгүй._`);
  }
  const valueCols = t.columns.filter((c) => c.role !== 'label' && c.header);
  if (valueCols.length > 0) {
    out.push(`**${en ? 'Columns (as printed)' : 'Баганын толгой (эхээс)'}**\n${valueCols.map((c) => `• ${clip(c.header!, 160)}${c.unit ? (en ? ` — unit in the header: ${c.unit}` : ` — нэгж (толгойд бичсэнээр): ${c.unit}`) : ''}`).join('\n')}`);
  }
  const matched = t.matchedRows.map((i) => t.rows.find((r) => r.index === i)).filter((r): r is TableView['rows'][number] => r !== undefined);
  const shown = matched.length > 0 ? matched : t.rows.slice(0, 16);
  const rowLine = (r: TableView['rows'][number]) => {
    const head = [r.rowNo, ...r.groupPath].filter((s): s is string => !!s && s.trim().length > 0).join(' › ');
    const vals = r.values.filter((v) => v.trim().length > 0);
    return `• ${head ? `${clip(head, 200)} › ` : ''}${clip(r.label, 260)}${vals.length > 0 ? ` — ${vals.join(' | ')}` : ''}${r.alignment === 'ambiguous_packed' ? (en ? ' _(row/value alignment not verified — check the PDF page)_' : ' _(мөр↔утгын хамаарал баталгаажаагүй — PDF хуудсаас шалгана уу)_') : ''}${r.continued ? (en ? ' _(continued from the previous page)_' : ' _(өмнөх хуудаснаас үргэлжилсэн)_') : ''}`;
  };
  out.push(`**${matched.length > 0 ? (en ? 'Rows matching the question' : 'Асуулттай таарсан мөр') : en ? 'Rows' : 'Мөрүүд'}**\n${shown.map(rowLine).join('\n')}${matched.length === 0 && t.rows.length > shown.length ? `\n${en ? `… ${t.rows.length - shown.length} more rows` : `… өөр ${t.rows.length - shown.length} мөр`}` : ''}`);
  if (t.notes.length > 0) out.push(`**${en ? 'Table notes (verbatim)' : 'Хүснэгтийн тайлбар (эхээс)'}**\n${t.notes.slice(0, 2).map((n) => `«${clip(n, 700)}»`).join('\n')}`);
  out.push(en ? '_Values are quoted exactly as printed; this layer does not interpolate, combine or apply them to a project (L3)._' : '_Утгыг эх хүснэгтэд хэвлэсэн хэлбэрээр нь л өгөв; завсрын утга, хослол, төслийн тооцоо (L3) хийхгүй._');
  out.push(sourceLine(x.code, en ? `Table ${t.tableNo}` : `${t.tableNo}-р хүснэгт`, t.page, t.sourceUrl, t.pdfUrl, lang));
  return out.join('\n\n');
}

/** ТОМЬЁО — илэрхийлэл ЭХЭЭС, хувьсагч ЗӨВХӨН заалтад тодорхойлсноор; ГҮЙЦЭТГЭХГҮЙ. */
function renderFormula(x: LocalNormExplanation, lang: Lang): string {
  const en = lang === 'en';
  const out: string[] = [];
  for (const f of x.formulas) {
    out.push(`**${x.code} — ${en ? `formula (${f.label})` : `(${f.label}) томьёо`}${f.clauseId ? (en ? `, clause ${f.clauseId}` : `, ${f.clauseId} заалт`) : ''}**`);
    out.push(`**${en ? 'Expression (as extracted)' : 'Илэрхийлэл (эхээс)'}**\n\`${clip(f.expression, 300).replace(/`/g, "'")}\`${f.quality !== 'text_layer_clean' ? (en ? '\n_The PDF text layer garbles this equation object — read the formula on the PDF page._' : '\n_PDF-ийн текст давхаргад энэ томьёо гажсан байж болзошгүй — томьёог PDF хуудаснаас уншина уу._') : ''}`);
    if (f.variables.length > 0) out.push(`**${en ? 'Variables (as defined in the clause)' : 'Хувьсагч (заалтад тодорхойлсноор)'}**\n${f.variables.map((v) => `• ${v.symbol} — ${clip(v.definition, 240)}`).join('\n')}`);
    else out.push(en ? '_The clause text does not define the variables in a «symbol – meaning» form; they are not guessed here._' : '_Хувьсагчийн утгыг заалтын бичвэрт «тэмдэг – утга» хэлбэрээр тодорхойлоогүй — энд таамаглахгүй._');
    out.push(sourceLine(x.code, f.clauseId ? (en ? `clause ${f.clauseId}` : `${f.clauseId} заалт`) : null, f.page, f.sourceUrl, f.pdfUrl, lang));
  }
  out.push(en ? '_L2 explains the formula only — it is not evaluated (no L3 calculation layer for this norm yet)._' : '_L2 томьёог зөвхөн тайлбарлана — ажиллуулж, тоо бодохгүй (энэ нормын L3 тооцооны давхарга хараахан байхгүй)._');
  return out.join('\n\n');
}

/**
 * АНГИЛАЛ — эх бичвэрийн жагсаалтаар («… -д дараах ачааллуудыг хамааруулна. Үүнд: а) …»).  Толгой = ангилал, зүйл = гишүүн,
 * хоёулаа ЭХЭЭС.  Олон жагсаалтад орсон бол бүгдийг нь нөхцөлтэй нь — нэгийг СОНГОХГҮЙ, «иймээс …» гэж дүгнэхгүй.
 */
function renderClassification(x: LocalNormExplanation, lang: Lang): string {
  const en = lang === 'en';
  const c = x.classification!;
  const out: string[] = [];
  out.push(`**${x.code} — ${en ? 'classification as written in the norm' : 'эх бичвэрт тогтоосон ангилал'}**`);
  if (c.kind === 'concept') {
    if (c.definition) out.push(`**${en ? `Definition — «${c.definition.term}»` : `Тодорхойлолт — «${c.definition.term}»`}** (${definitionPlace(null, c.definition.clause, lang)})\n«${clip(c.definition.definition, 600)}»`);
    else out.push(en ? '_The norm gives no separate definition of this term in its terms section; it is established by the classification clauses below._' : '_Энэ нэр томьёонд нормын нэр томьёоны хэсэгт тусдаа тодорхойлолт алга — доорх ангиллын заалтаар тогтоогдоно._');
  } else if (c.multipleCategories) {
    out.push(en ? '⚠ The source lists this in MORE THAN ONE category — each with its own wording; read the conditions of each.' : '⚠ Эх бичвэрт энэ нь НЭГЭЭС ОЛОН ангиллын жагсаалтад орсон — тус бүрийн нөхцөл өөр; аль нэгийг нь сонгохгүйгээр эх бичвэрээр нь өгөв.');
  }
  for (const s of c.scheme) out.push(`**${en ? `Classification scheme — clause ${s.clauseId}` : `Ангиллын схем — ${s.clauseId} заалт`}**\n«${clip(s.text, 400)}»`);
  for (const g of c.groups) {
    out.push(`**${en ? `Clause ${g.clauseId}` : `${g.clauseId} заалт`}** — «${clip(g.lead, 240)}»\n${g.items.map((it) => `${it.marker}) ${clip(it.text, 360)}`).join('\n')}${c.kind === 'concept' && g.trailing ? `\n«${clip(g.trailing, 300)}»` : ''}`);
  }
  out.push(en ? '_This quotes the list items as printed; whether a particular load in your project falls into a category is not decided here._' : '_Жагсаалтын зүйлсийг эхэд хэвлэсэн хэлбэрээр нь өгөв; таны төслийн тодорхой ачаалал аль ангилалд орохыг энд шийдэхгүй._');
  const first = c.groups[0]!;
  out.push(sourceLine(x.code, c.groups.map((g) => (en ? `clause ${g.clauseId}` : `${g.clauseId} заалт`)).join(', '), first.page, first.sourceUrl, null, lang));
  return out.join('\n\n');
}

export function renderExplanation(x: LocalNormExplanation, lang: Lang, question = ''): string | null {
  const out = ((): string | null => {
    if (x.mode === 'definition' && x.definition) return renderDefinition(x, lang);
    if (x.mode === 'section' && x.section) return renderSection(x, lang);
    if (x.mode === 'document' && x.document) return renderDocument(x, lang);
    if (x.mode === 'table' && x.table) return renderTable(x, lang);
    if (x.mode === 'formula' && x.formulas.length > 0) return renderFormula(x, lang);
    if (x.mode === 'classification' && x.classification) return renderClassification(x, lang);
    if (x.clause) return renderClause(x, x.clause, lang, question);
    return null;
  })();
  // Symbol-фонтын PUA тэмдэгт (γf, ≤, μ …) — харуулахдаа л стандарт кодчилолоор (эх бичвэр хөндөгдөхгүй).
  return out === null ? null : decodeSymbolPua(out);
}

/** L2 трейлер — ноорог/тооцоогүй гэдгийг ил (currentness трейлер гэрээнээс хэвээр). */
export function explanationTrailer(x: LocalNormExplanation, lang: Lang): string {
  const en = lang === 'en';
  const draft = x.clause?.verification === 'HUMAN_VERIFIED' ? (en ? 'human-verified explanation' : 'хүн шалгасан тайлбар')
    : x.clause?.plainCandidate ? (en ? 'the plain-terms paragraph is a model draft that passed the semantic check, not human-verified' : 'энгийн тайлбар нь семантик шалгалт давсан загварын ноорог, хүн шалгаагүй')
    : en ? 'explanation is an AUTO_DRAFT (not human-verified)' : 'тайлбар нь автомат ноорог (AUTO_DRAFT, хүн шалгаагүй)';
  const base = en ? `Note: ${draft}; source text is verbatim from the official PDF text layer; this layer performs no calculation, classification or compliance check.` : `Анхаар: ${draft}; эх бичвэр нь албан PDF-ийн текст давхаргаас үг үсгээрээ; энэ давхарга тооцоо, ангилал, нийцлийн дүгнэлт хийхгүй.`;
  const extra: string[] = [];
  // Ангилал/хүснэгт/томьёо — «эх бичвэрт хэвлэсэнг л» гэдгийг ил.
  if (x.mode === 'classification') extra.push(en ? 'The categories above are the norm’s own lists, quoted — not a classification of your project.' : 'Дээрх ангилал нь нормын өөрийн жагсаалт (эхээс) — таны төслийн ачааллыг ангилсан дүгнэлт биш.');
  // Албан тайлбар харуулсан бол — норм биш гэдгийг трейлерт ч давтана.
  const comm = [...(x.clause?.commentary ?? []), ...(x.section?.commentary ?? [])].find((c) => !c.noCommentary && c.excerpt);
  if (comm) extra.push(en ? `${comm.code} is the official COMMENTARY, not the norm — it sets no requirement.` : `${comm.code} нь албан ТАЙЛБАР, норм биш — шаардлага тогтоохгүй.`);
  return extra.length > 0 ? `${base}\n${extra.join('\n')}` : base;
}

// Хүснэгтийн хэвлэсэн утга / ангиллын жагсаалт / тодорхойлолт / томьёоны тайлбар нь ТООЦОО БИШ — эдгээр горимд хаалга зөвхөн
//    ил тооцооны үйл үг эсвэл хэрэглэгчийн өөрийн тоон оролт («350 м² бол …») дээр.  «Ачааллын тооцооны утга гэж юу вэ?» (нэр
//    томьёо) хаагдахгүй — `CALC_ASK`-ын «тооц…» нь энд хэтэрхий өргөн.
const LOOKUP_MODES = new Set(['table', 'formula', 'classification', 'definition']);
const EXPLICIT_CALC = /(?<![\p{L}])(тооцоол(?:ж|оод|но|ох|оорой|ood)?|тооцоод|тооцож\s+(?:өг|үз)\p{L}*|бод(?:ож|оод|оорой|но|ох)|хангах\s+уу|хангаж\s+байна\s+уу|хангасан\s+уу|хангалттай\s+юу|нийц\p{L}*\s+(?:уу|үү|байна\s+уу)|calculate|compute|does\s+(?:it|a|the)?\s*[\p{L}\d\s.,]{0,40}?(?:comply|pass|meet|satisfy))(?![\p{L}])/iu;
// «Ачааллын тооцооны утга гэж юу вэ?» — нэр томьёоны асуулт; «тооц…» үгтэй ч тоо, тооцооны үйл үггүй бол тооцоо биш.
const DEFINITION_ASK = /гэж\s+юу|юу\s+гэсэн\s+үг|гэдэг\s+нь\s+юу|what\s+is|what\s+does\s+.{0,40}\s+mean/iu;
export function isL2ComputationAsk(question: string, mode: LocalNormExplanation['mode']): boolean {
  if (DEFINITION_ASK.test(question) && !/\d/.test(question.replace(/(?:БНбД|БНОД|БД|УББ|MNS|СНиП)\s*[\d\-–.*/]+/giu, ' ')) && !EXPLICIT_CALC.test(question)) return false;
  if (!LOOKUP_MODES.has(mode)) return isComputationAsk(question);
  const q = question.replace(/(?:БНбД|БНОД|БД|УББ|MNS|СНиП)\s*[\d\-–.*/]+/giu, ' ').replace(/\d+(?:\.\d+)+\s*(?:-?р|-?ийн|-?ын|-?д|-?т)?\s*(?:заалт|зүйл|хавсралт|хүснэгт|бүлэг)/giu, ' ');
  return EXPLICIT_CALC.test(q) || (NUMBER_WITH_UNIT.test(q) && CONDITIONAL_VALUE.test(q));
}

export const L2_NO_COMPUTE_MN = 'Тооцоо, ангилал, нийцлийн шалгалт нь ойлгох давхаргаас (L2) хийгдэхгүй — детерминист тооцооны давхарга (L3) энэ нормд хараахан байхгүй; заалтын эх бичвэрийг л өгье.';
export const L2_NO_COMPUTE_EN = 'Calculation, classification and compliance checks are not performed by the understanding layer (L2) — a deterministic calculation layer (L3) does not exist for this norm yet; only the clause text is given.';

/**
 * Гэрээнд L2 загварыг залгана.  Тооцооны асуулт бол ЗАГВАР СОЛИХГҮЙ — одоо байгаа зам + трейлер.
 * `templateOnly`: загвар үүсгэлт хийхгүй (агуулга бүхэлдээ детерминист).
 */
export function withExplanation(contract: TrustedContract, x: LocalNormExplanation, lang: Lang, question: string): TrustedContract {
  const joinTrailer = (a: string | null, b: string): string => (a ? `${a}\n${b}` : b);
  if (isL2ComputationAsk(question, x.mode)) {
    const note = lang === 'en' ? L2_NO_COMPUTE_EN : L2_NO_COMPUTE_MN;
    return { ...contract, trailerText: joinTrailer(contract.trailerText, note), reason: `${contract.reason} · l2_no_compute_gate` };
  }
  const template = renderExplanation(x, lang, question);
  if (template === null) return contract;
  return {
    ...contract,
    template,
    templateOnly: true,
    requiredCitations: contract.requiredCitations.includes(x.code) ? contract.requiredCitations : [...contract.requiredCitations, x.code],
    trailerText: joinTrailer(contract.trailerText, explanationTrailer(x, lang)),
    reason: `${contract.reason} · l2_explanation:${x.mode}`,
  };
}
