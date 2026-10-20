#!/usr/bin/env node
/**
 * MGL AI · norm-dataset · parsed/ → pack/   (the INGESTABLE form)
 *
 *   node ai/norm-dataset/tools/build-pack.mjs ai/norm-dataset/documents/BNbD_31-17-10
 *
 * The canonical document package is `documents/<Doc>/{metadata.json, source/, parsed/, tests/}`.
 * The local knowledge DB ingester (`ai/retrieval/src/ingest.ts`) reads PACKS — the same
 * file family the 13 existing MCIS/MGL packs use (document.json, knowledge_chunks.jsonl,
 * aliases.json, …).  This tool emits that family into `<Doc>/pack/` so ONE ingester and ONE
 * profile (`clause_document`, detected by `norm-dataset.pack.json`) serve every norm produced
 * by this pipeline.  Nothing here is hand-edited; re-run after re-parsing.
 *
 * ⚠️ NOTHING HERE IS KEYED ON ONE DOCUMENT (2026-09-21).  The first version carried
 *    31-17-10's constants (edition year «2010», metadata page 3/5, «өндөр барилга» in the
 *    search text, «1-р хавсралт» for every definition).  They now come from metadata.json /
 *    parsed/, so a lettered-appendix norm (20-04-17: «Б.1.1», definitions inside §3) packs
 *    with the same tool.  Sections carry their intro prose (`intro`) when the parser found any.
 *
 * Chunk id scheme (stable — tests and citations depend on it):
 *   <doc_id>:clause:<n>                       body clause
 *   <doc_id>:appendix:<A>:clause:<n>          appendix clause
 *   <doc_id>:appendix:<A>                     appendix header (title + kind)
 *   <doc_id>:table:<id>                       table (flattened rows in text)
 *   <doc_id>:formula:<label>                  numbered formula
 *   <doc_id>:definition:<slug>                appendix-1 definition
 *   <doc_id>:section:<n>                      section heading
 *   <doc_id>:status  /  <doc_id>:metadata     legal status / scope
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const dir = resolve(process.argv[2] ?? '');
if (!dir || !existsSync(join(dir, 'metadata.json'))) {
  process.stderr.write('usage: build-pack.mjs <documents/Doc_dir>\n');
  process.exit(1);
}
const readJsonl = (p) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
const meta = JSON.parse(readFileSync(join(dir, 'metadata.json'), 'utf8'));
const P = (f) => join(dir, 'parsed', f);
const T = (f) => join(dir, 'tests', f);
const docId = meta.doc_id;
const code = meta.canonical_code;
const VERIF = meta.verification?.text_verification_status ?? 'official_pdf_text_layer_auto_extracted';
const url = meta.source_url;

const sections = readJsonl(P('sections.jsonl'));
const appendices = readJsonl(P('appendices.jsonl'));
const clauses = readJsonl(P('clauses.jsonl'));
const editionYear = String(meta.approval?.order_date ?? '').slice(0, 4) || null;
const effectiveFromText = meta.approval?.effective_from
  ? `${meta.approval.effective_from}-ээс мөрдөнө`
  : 'мөрдөж эхлэх огноо эх бичвэрт заагаагүй';
const tables = readJsonl(P('tables.jsonl'));
const formulas = readJsonl(P('formulas.jsonl'));
const definitions = readJsonl(P('definitions.jsonl'));
const references = readJsonl(P('references.jsonl'));
const numeric = readJsonl(P('numeric_requirements.jsonl'));

const slug = (s) => s.toLowerCase().replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_]/gu, '').slice(0, 60);
const clauseChunkId = (c) => (c.appendix ? `${docId}:appendix:${c.appendix}:clause:${c.clause}` : `${docId}:clause:${c.clause}`);
const tableChunkId = (t) => `${docId}:table:${t.table_id.split('#T')[1]}`;
const sectionTitle = (n) => sections.find((s) => s.section === n)?.title ?? '';
const appendixOf = (a) => appendices.find((x) => x.appendix_id === a);

// Popular Latin typing scheme (ө/ү → u, х → kh) — the MCIS packs' `text_latin` uses it and
// `fold.ts` bridges it to the Cyrillic index (kh→h, ts→c, y→i); without it mn-Latn queries miss.
const LAT = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'ye', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', ө: 'u', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ү: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'ii', ь: 'i', э: 'e', ю: 'yu', я: 'ya' };
const latin = (t) => [...t.toLowerCase()].map((ch) => LAT[ch] ?? ch).join('');

const chunks = [];
const push = (row) => chunks.push({ authority_level: 'normative', visibility: 'public_norm', verification_status: VERIF, text_latin: latin(row.text_mn), ...row });

// status + metadata chunks (like every existing pack)
push({
  chunk_id: `${docId}:status`, kind: 'legal_status', page: null, source_pdf_page: null, section: null,
  text_mn: `${code} «${meta.title_mn}» — ${meta.approval.issuer}ын ${meta.approval.order_date}-ны ${meta.approval.order_number} дугаар тушаалаар батлагдсан, ${effectiveFromText}. MCIS-ийн хүчин төгөлдөр нормын бүртгэлд «Хүчин төгөлдөр» (${meta.last_verified}). ${meta.effective_status_note}`,
  search_text: `${code} хүчин төгөлдөр батлагдсан тушаал ${meta.approval.order_number} ${meta.approval.order_date} мөрдөх огноо статус хүчинтэй эсэх`,
  retrieval_weight: 1.0,
  source_locator: { url, legal_url: meta.legal_source_url },
  metadata: { order_number: meta.approval.order_number, order_date: meta.approval.order_date, effective_from: meta.approval.effective_from, successor_draft: meta.successor_draft, amendments: meta.amendments },
});
const firstSection = sections[0] ?? null;
push({
  chunk_id: `${docId}:metadata`, kind: 'metadata', page: firstSection?.source_page ?? null, source_pdf_page: firstSection?.source_pdf_page ?? null, section: null,
  // ⚠️ Хамрах хүрээний өгүүлбэрийг ЭНД давтахгүй — 1.1-р заалттай өрсөлдөж түүнийг эхний 5-аас шахдаг (хэмжсэн).
  text_mn: `${code} «${meta.title_mn}» (${meta.title_en}). Бүлэг: ${sections.map((s) => `${s.section}. ${s.title}`).join('; ')}. Хавсралт: ${appendices.map((a) => a.appendix_id).join(', ')}.`,
  search_text: `${code} ${meta.title_mn} ${meta.title_en} ${meta.aliases.join(' ')} гарчиг бүлэг агуулга`,
  retrieval_weight: 0.6,
  source_locator: { url, printed_page: firstSection?.source_page ?? null },
  metadata: { sections: sections.length, appendices: appendices.length },
});
for (const s of sections) {
  // intro prose between the heading and the first clause (20-04-17 §11/§14/§15) rides on the
  // section chunk — otherwise a section with no numbered clauses (§14) would be unsearchable.
  const intro = typeof s.intro === 'string' && s.intro.trim().length > 0 ? s.intro.trim() : null;
  push({ chunk_id: `${docId}:section:${s.section}`, kind: 'section', page: s.source_page, source_pdf_page: s.source_pdf_page, section: `${s.section}-р бүлэг`,
    text_mn: `${s.section}. ${s.title}${intro ? `. ${intro}` : ''}`, search_text: `${code} бүлэг ${s.section} ${s.title}${intro ? ` ${intro}` : ''}`,
    retrieval_weight: intro ? 0.9 : 0.5, source_locator: { url, printed_page: s.source_page, locator: `${s.section}-р бүлэг` } });
}
for (const a of appendices) {
  push({ chunk_id: `${docId}:appendix:${a.appendix_id}`, kind: 'appendix', page: a.source_page, source_pdf_page: a.source_pdf_page, section: `${a.appendix_id}-р хавсралт`,
    text_mn: `${a.appendix_id}-р хавсралт (${a.kind ?? 'төрөл заагаагүй'}): ${a.title ?? ''}`, search_text: `${code} хавсралт ${a.appendix_id} ${a.kind ?? ''} ${a.title ?? ''}`, retrieval_weight: 0.7,
    source_locator: { url, printed_page: a.source_page }, metadata: { kind: a.kind } });
}
for (const c of clauses) {
  const head = c.appendix ? `${c.appendix}-р хавсралт, ${c.clause}` : `заалт ${c.clause}`;
  push({
    chunk_id: clauseChunkId(c), kind: 'clause', page: c.source_page, source_pdf_page: c.source_pdf_page,
    // `section` becomes the citation's second label segment (citation.ts) — a locator, not a number
    section: c.appendix ? `${c.appendix}-р хавсралт` : null,
    text_mn: c.text + (c.notes.length ? ' ' + c.notes.join(' ') : ''),
    search_text: `${code} ${head} ${c.clause} ${c.appendix ? (appendixOf(c.appendix)?.title ?? '') : sectionTitle(c.section)} ${c.text}`,
    retrieval_weight: 1.2,
    source_locator: { url, printed_page: c.source_page, end_page: c.end_page, pdf_page: c.source_pdf_page, locator: head },
    metadata: { scope: c.scope, appendix: c.appendix, clause: c.clause },
  });
}
for (const t of tables) {
  const tid = t.table_id.split('#T')[1];
  const rowsText = t.rows.map((r) => r.filter(Boolean).join(' | ')).join('\n');
  push({
    chunk_id: tableChunkId(t), kind: 'table', page: t.source_page, source_pdf_page: t.source_pdf_page, section: `хүснэгт ${tid}`,
    text_mn: `Хүснэгт ${tid}${t.title ? ` — ${t.title}` : ''}${t.columns.length ? `\nБагана: ${t.columns.filter(Boolean).join(' | ')}` : ''}\n${rowsText}${t.notes.length ? '\n' + t.notes.join(' ') : ''}`,
    // Хоёр хэлбэр: «Хүснэгт 5.1» ба «5.1-р хүснэгт» — заалтууд сүүлчийнхээр иш татдаг.
    search_text: `${code} хүснэгт ${tid} ${tid}-р хүснэгт ${t.title ?? ''} ${t.columns.join(' ')} ${rowsText}`,
    retrieval_weight: 1.1,
    source_locator: { url, printed_page: t.source_page, locator: `хүснэгт ${tid}`, extraction: t.extraction, title_source: t.title_source },
    table_no: /^\d+$/.test(tid) ? Number(tid) : null,
    metadata: { table_id: tid, columns: t.columns, rows: t.rows.length, extraction: t.extraction, clause_context: t.clause_context },
  });
}
for (const f of formulas) {
  const label = f.formula_id.split('#F')[1];
  push({
    chunk_id: `${docId}:formula:${label}`, kind: 'formula', page: f.source_page, source_pdf_page: f.source_pdf_page, section: `томьёо (${f.label})`,
    text_mn: `Томьёо (${f.label})${f.clause ? `, заалт ${f.clause}` : ''}: ${f.expression}${f.expression_quality === 'text_layer_garbled' ? ' [текст давхаргаас алдагдсан — эх хуудсыг үзнэ үү]' : ''}`,
    search_text: `${code} томьёо ${f.label} ${f.clause ?? ''} ${f.expression} ${f.variables.map((v) => v.symbol).join(' ')}`,
    retrieval_weight: 0.9,
    source_locator: { url, printed_page: f.source_page, locator: `томьёо (${f.label})`, quality: f.expression_quality },
    metadata: { label: f.label, clause: f.clause, quality: f.expression_quality, executable: false },
  });
}
for (const d of definitions) {
  // where the term is defined: an appendix («1-р хавсралт», 31-17-10) or a clause («заалт 3.1.1», 20-04-17)
  const where = d.appendix ? `${d.appendix}-р хавсралт` : d.clause ? `заалт ${d.clause}` : 'нэр томъёо';
  push({
    chunk_id: `${docId}:definition:${slug(d.term)}`, kind: 'definition', page: d.source_page, source_pdf_page: d.source_pdf_page, section: `${where} (нэр томъёо)`,
    text_mn: `${d.term} — ${d.definition}`, search_text: `${code} нэр томъёо тодорхойлолт ${d.term} гэж юу вэ ${d.definition}`, retrieval_weight: 1.0,
    source_locator: { url, printed_page: d.source_page, locator: where }, metadata: { term: d.term, clause: d.clause ?? null, appendix: d.appendix ?? null },
  });
}
const ids = new Set();
for (const c of chunks) {
  if (ids.has(c.chunk_id)) throw new Error(`duplicate chunk id ${c.chunk_id}`);
  ids.add(c.chunk_id);
}

// numeric requirements → legalinfo NumericRow shape (rule_id = the clause chunk → grouped conditions per clause)
const numericRows = numeric.map((n, i) => {
  const c = clauses.find((x) => x.clause === n.clause && (x.appendix ?? null) === (n.appendix ?? null));
  const chunkId = c ? clauseChunkId(c) : null;
  return {
    rule_id: chunkId ?? `${docId}:clause:${n.clause}`,
    locator: n.clause,
    name: `${slug(n.subject.split(/\s+/).slice(-4).join('_')) || 'value'}_${i + 1}`,
    subject_mn: n.subject,
    operator: n.operator,
    value: n.value,
    unit: n.unit,
    condition: null,
    quote: n.quote,
    verification_status: n.verification_status,
    extraction: n.extraction,
    source: { locator: c ? (c.appendix ? `${c.appendix}-р хавсралт, ${c.clause}` : `заалт ${c.clause}`) : null, printed_page: n.source_page, url },
  };
});

// tests → qa_retrieval_tests
const qa = readJsonl(T('retrieval.jsonl')).map((t) => ({ test_id: t.test_id, query: t.query, language: t.language, expected_id: t.expected_id, expected_page: t.expected_page ?? null, must_show_source: true }));
const cases = readJsonl(T('calculations.jsonl')).filter((c) => c.input !== undefined);

// aliases: document-level (object map form) + keyword index (definitions → definition chunks, table titles → tables)
// ⚠️ Баримтын түвшний alias = ЗӨВХӨН код хэлбэртэй («BNbD 31-17-10», «CCM 31-17-10»).  Нэр/сэдвийн
//    alias («өндөр барилгын норм») энд орвол `expandAliases` тэдгээрийг FTS-ийн нэмэлт үг болгож,
//    код нэрлэсэн БҮХ асуултад :metadata/:status хэсгийг эхэнд тавьж байв (хэмжсэн).  Тэд L0
//    бүртгэлийн (registry) ажил.
const aliasesMap = { [code]: meta.aliases.filter((a) => a !== code && /\d{2}-\d{2,3}-\d{2}/.test(a)).map((a) => ({ alias: a, language: /[Ѐ-ӿ]/u.test(a) ? 'mn' : 'latin' })) };
const kw = [];
for (const d of definitions) kw.push({ canonical: `${docId}:definition:${slug(d.term)}`, alias: d.term, language: 'mn' });
for (const t of tables) if (t.title && t.title.split(/\s+/).length <= 6) kw.push({ canonical: tableChunkId(t), alias: t.title, language: 'mn' });

// write
const out = join(dir, 'pack');
mkdirSync(out, { recursive: true });
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
const files = {
  'document.json': JSON.stringify({
    doc_id: docId, code, title_mn: meta.title_mn, title_en: meta.title_en, jurisdiction: meta.jurisdiction,
    authority: meta.approval.issuer, order_date: meta.approval.order_date, order_number: meta.approval.order_number, version: editionYear,
    effective_status: meta.effective_status, effective_from: meta.approval.effective_from,
    dataset_standard: 'norm-dataset/1', source_url: url, source_pdf_url: meta.source_pdf_url, legal_source_url: meta.legal_source_url,
    successor_draft: meta.successor_draft, amendments: meta.amendments, supersedes: meta.supersedes, superseded_by: meta.superseded_by,
    applicability: meta.applicability, training_policy: meta.training_policy, text_verification_status: VERIF,
  }, null, 2),
  'knowledge_chunks.jsonl': jsonl(chunks),
  'numeric_requirements.jsonl': jsonl(numericRows),
  'formulas.jsonl': jsonl(formulas.map((f) => ({ ...f, chunk_id: `${docId}:formula:${f.formula_id.split('#F')[1]}`, executable: false }))),
  'cross_references.json': JSON.stringify({ policy: 'Printed cross-references are version-sensitive; resolve the current successor in registry/norms.jsonl before any cross-norm compliance conclusion.', references }, null, 1),
  'qa_retrieval_tests.jsonl': jsonl(qa),
  'calculation_cases.jsonl': jsonl(cases),
  'aliases.json': JSON.stringify(aliasesMap, null, 1),
  'keyword_alias_index.jsonl': jsonl(kw),
};
for (const [name, content] of Object.entries(files)) writeFileSync(join(out, name), content, 'utf8');
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const counts = { chunks: chunks.length, clauses: clauses.length, tables: tables.length, formulas: formulas.length, definitions: definitions.length, numeric_requirements: numericRows.length, references: references.length, qa_tests: qa.length, calculation_cases: cases.length };
const packMeta = {
  schema: 'norm-dataset.pack/1', dataset_id: `norm-dataset-${basename(dir).toLowerCase()}`, version: meta.dataset_version ?? '0.1.0',
  document_code: code, doc_id: docId, source_sha256: meta.source.sha256, text_verification_status: VERIF, counts, built_at: new Date().toISOString().slice(0, 10),
};
writeFileSync(join(out, 'norm-dataset.pack.json'), JSON.stringify(packMeta, null, 2), 'utf8');
const manifest = { dataset_id: packMeta.dataset_id, version: packMeta.version, counts: { chunks: chunks.length, qa_tests: qa.length }, files: {} };
for (const f of readdirSync(out)) if (f !== 'manifest.json') manifest.files[f] = { sha256: sha(join(out, f)), bytes: statSync(join(out, f)).size };
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
process.stdout.write(`pack: ${out}\n${JSON.stringify(counts)}\n`);
