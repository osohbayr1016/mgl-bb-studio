#!/usr/bin/env node
/**
 * MGL AI · norm-dataset · GOLD ACCEPTANCE GATE (one document, end to end)
 *
 *   node ai/norm-dataset/tools/gate.mjs ai/norm-dataset/documents/BNbD_31-17-10 [--runtime http://127.0.0.1:39217] [--secret <x>] [--db <full-corpus.sqlite>]
 *
 * Runs every gate item from the acceptance list against the REAL files and an in-memory
 * knowledge DB (the full corpus DB is optional, for the cross-document numbers), prints
 * PASS / FAIL / SKIPPED per item and writes <doc>/GATE.json.  Exit 1 if any required item FAILS.
 *
 * ⚠️ «GOLD» IS NOT PRINTED FOR AUTO-EXTRACTED TEXT.  The listed items can all pass while no
 *    human has compared a single clause with the page image.  The verdict therefore has three
 *    values: NOT_GOLD (a gate failed) · GOLD_CANDIDATE_PENDING_HUMAN_VERIFICATION (all automated
 *    gates pass, `metadata.verification.human_verified_clauses` = 0) · GOLD (all pass AND the
 *    verifier has set an executable verification status on the clauses).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const AI = join(HERE, '..', '..');
const DS = join(HERE, '..');
const argv = process.argv.slice(2);
const dir = resolve(argv.find((a) => !a.startsWith('--')) ?? '');
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : argv[i + 1] ?? null; };
if (!dir || !existsSync(join(dir, 'metadata.json'))) { process.stderr.write('usage: gate.mjs <documents/Doc_dir> [--runtime URL --secret S] [--db sqlite]\n'); process.exit(2); }

const { openKnowledgeDb } = await import(join(AI, 'retrieval', 'src', 'db.ts').replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:'));
const { ingestDataset } = await import(join(AI, 'retrieval', 'src', 'ingest.ts').replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:'));
const { askNorm } = await import(join(AI, 'retrieval', 'src', 'pipeline.ts').replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:'));
const { classifyVerification, isExecutableVerification } = await import(join(AI, 'retrieval', 'src', 'rules.ts').replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:'));
const { ingestRegistry, searchRegistry, lookupRegistryCode } = await import(join(AI, 'retrieval', 'src', 'registry.ts').replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:'));

const readJsonl = (p) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
const meta = JSON.parse(readFileSync(join(dir, 'metadata.json'), 'utf8'));
const P = (f) => join(dir, 'parsed', f);
const T = (f) => join(dir, 'tests', f);
const taxonomy = JSON.parse(readFileSync(join(DS, 'taxonomy', 'team_topic_map.json'), 'utf8'));
const registry = readJsonl(join(DS, 'registry', 'norms.jsonl'));

const items = [];
const add = (name, status, detail, required = true) => items.push({ name, status, detail, required });
const pct = (a, b) => (b === 0 ? '0%' : `${Math.round((a / b) * 1000) / 10}%`);

/* 1. SOURCE FOUND / HASHED */
const src = join(dir, 'source', meta.source.file);
const srcJson = existsSync(join(dir, 'source', 'SOURCE.json')) ? JSON.parse(readFileSync(join(dir, 'source', 'SOURCE.json'), 'utf8')) : null;
add('SOURCE FOUND', existsSync(src) && srcJson?.files?.[0]?.fetched_from ? 'PASS' : 'FAIL', existsSync(src) ? `${meta.source.file} ← ${srcJson?.files?.[0]?.fetched_from ?? '?'}` : 'source PDF missing');
if (existsSync(src)) {
  const sha = createHash('sha256').update(readFileSync(src)).digest('hex');
  add('SOURCE HASHED', sha === meta.source.sha256 ? 'PASS' : 'FAIL', `sha256 ${sha.slice(0, 16)}… ${sha === meta.source.sha256 ? '= metadata' : '≠ metadata'}`);
} else add('SOURCE HASHED', 'FAIL', 'no source');

/* 2. STATUS VERIFIED */
const regRow = registry.find((r) => r.canonical_code === meta.canonical_code);
const statusOk = Array.isArray(meta.status_evidence) && meta.status_evidence.length > 0 && regRow && regRow.status === meta.status && regRow.status_evidence.some((e) => /MCIS/i.test(e));
const draftRow = meta.successor_draft ? registry.find((r) => r.canonical_code === meta.successor_draft.code) : null;
add('STATUS VERIFIED', statusOk && (!meta.successor_draft || draftRow?.status === 'DRAFT') ? 'PASS' : 'FAIL',
  `${meta.status} (${(meta.status_evidence ?? []).length} evidence) · registry=${regRow?.status ?? 'missing'} · successor draft ${meta.successor_draft?.code ?? '—'}=${draftRow?.status ?? '—'} · effective_status=${meta.effective_status}`);

/* 3. METADATA VALID */
const required = ['canonical_code', 'doc_id', 'title_mn', 'document_type', 'status', 'teams', 'topics', 'priority', 'capability_level', 'deep_ingestion_status', 'retrieval_default', 'source_type', 'source_url', 'last_verified', 'source'];
const missing = required.filter((k) => meta[k] === undefined || meta[k] === null || meta[k] === '');
const badTeams = (meta.teams ?? []).filter((t) => !taxonomy.teams[t]);
const badTopics = (meta.topics ?? []).filter((t) => !taxonomy.topics[t]);
add('METADATA VALID', missing.length === 0 && badTeams.length === 0 && badTopics.length === 0 && /^https:\/\//.test(meta.source_url) ? 'PASS' : 'FAIL',
  missing.length ? `missing ${missing.join(',')}` : badTeams.length || badTopics.length ? `unknown taxonomy keys ${[...badTeams, ...badTopics].join(',')}` : `${meta.teams.length} teams · ${meta.topics.length} topics · https source_url`);

/* 4. CLAUSES PARSED */
const clauses = readJsonl(P('clauses.jsonl'));
const ids = new Set(clauses.map((c) => c.clause_id));
const noPage = clauses.filter((c) => c.source_page === null || !c.source_url);
const report = existsSync(P('parse_report.json')) ? JSON.parse(readFileSync(P('parse_report.json'), 'utf8')) : { anomalies: [] };
add('CLAUSES PARSED', clauses.length >= 100 && ids.size === clauses.length && noPage.length === 0 ? 'PASS' : 'FAIL',
  `${clauses.length} clauses (${clauses.filter((c) => c.scope === 'body').length} body / ${clauses.filter((c) => c.scope === 'appendix').length} appendix), unique ids, ${noPage.length} without page/url, ${report.anomalies.length} parser anomalies`);

/* 5. TABLES PARSED */
const tables = readJsonl(P('tables.jsonl'));
const grids = tables.filter((t) => t.extraction.startsWith('ruled_grid'));
add('TABLES PARSED', tables.length > 0 && grids.length > 0 ? 'PASS' : 'FAIL', `${tables.length} tables (${grids.length} ruled grids, ${tables.filter((t) => t.extraction === 'ruled_grid_uncaptioned').length} uncaptioned, ${tables.filter((t) => t.extraction === 'caption_only').length} caption-only)`);

/* 6. FORMULAS */
const formulas = readJsonl(P('formulas.jsonl'));
const clean = formulas.filter((f) => f.expression_quality === 'text_layer_clean').length;
const executable = formulas.filter((f) => f.executable === true).length;
add('FORMULAS PARSED/CLASSIFIED', formulas.length === 0 ? 'FORMULAS_NOT_APPLICABLE' : 'PASS',
  formulas.length === 0 ? 'no numbered formulas in the source' : `${formulas.length} catalogued (${clean} clean text, ${formulas.length - clean} garbled equation objects) · executable ${executable} → ${executable === 0 ? 'FORMULAS_CATALOGUED_NOT_EXECUTABLE' : 'compute available'}`);

/* 7. NUMERIC REQUIREMENTS */
const numeric = readJsonl(P('numeric_requirements.jsonl'));
const numNoSrc = numeric.filter((n) => n.source_page === null || !n.source_url || !n.quote);
const numExec = numeric.filter((n) => isExecutableVerification(n.verification_status)).length;
add('NUMERIC REQUIREMENTS EXTRACTED', numeric.length > 0 && numNoSrc.length === 0 ? 'PASS' : 'FAIL',
  `${numeric.length} candidates, every one with clause + page + quote · human-verified/executable ${numExec} → ${numExec === 0 ? 'searchable & citable, NOT executed as authoritative' : 'executable'}`);

/* 8. CROSS REFERENCES */
const refs = readJsonl(P('references.jsonl'));
const regRefs = readJsonl(join(DS, 'registry', 'references.jsonl')).filter((r) => r.from === meta.canonical_code);
const inReg = regRefs.filter((r) => r.to_in_registry).length;
add('CROSS REFERENCES EXTRACTED', refs.length > 0 && regRefs.length > 0 ? 'PASS' : 'FAIL', `${refs.length} edges (${refs.filter((r) => r.relationship === 'normative_reference_list').length} from appendix 2) · registry graph ${regRefs.length} edges, ${inReg} resolve to registry rows (${pct(inReg, regRefs.length)})`);

/* 9–11. RETRIEVAL / CITATION / NO-HALLUCINATION (in-memory ingest of pack/) */
const pack = join(dir, 'pack');
let db = null; let counts = null; let ingestErr = null;
try { db = openKnowledgeDb({ path: ':memory:' }); counts = ingestDataset(db, pack); } catch (e) { ingestErr = e instanceof Error ? e.message : String(e); }
add('DB INGESTION PASS', counts && counts.verification.unknown.length === 0 ? 'PASS' : 'FAIL', counts ? `profile ${counts.profile} · ${counts.chunks} chunks · ${counts.rules} rules · ${counts.tests} tests · unknown verification statuses: ${counts.verification.unknown.length}` : ingestErr);

const retrieval = readJsonl(T('retrieval.jsonl'));
let hit = 0; let cite = 0; let citeUrl = 0; const misses = [];
if (db) {
  for (const t of retrieval) {
    const a = askNorm(db, t.query, { evidenceLimit: 5 });
    const ok = a.evidence.some((e) => e.chunk_id === t.expected_id);
    if (ok) hit += 1; else misses.push(t.test_id);
    if (a.citation && a.citation.page === t.expected_page) cite += 1;
    if (a.citation && /^https:\/\//.test(a.citation.source_url ?? '')) citeUrl += 1;
  }
}
add('RETRIEVAL TESTS PASS', retrieval.length >= 20 && hit / retrieval.length >= 0.9 ? 'PASS' : 'FAIL', `Recall@5 ${hit}/${retrieval.length} (${pct(hit, retrieval.length)}) single-document DB${misses.length ? ` · misses ${misses.join(', ')}` : ''}`);
add('CITATION TESTS PASS', cite / retrieval.length >= 0.9 && citeUrl === retrieval.length ? 'PASS' : 'FAIL', `page match ${cite}/${retrieval.length} (${pct(cite, retrieval.length)}) · https source URL on ${citeUrl}/${retrieval.length} citations`);

const adversarial = readJsonl(T('adversarial.jsonl'));
const advFail = [];
if (db) {
  for (const c of adversarial) {
    const a = askNorm(db, c.query, { evidenceLimit: 5 });
    if (c.expected_behavior === 'clause_not_in_named_document' && !(a.status === 'insufficient_evidence' && a.no_match_reason === 'clause_not_in_named_document' && a.citation === null)) advFail.push(`${c.test_id}: ${a.status}/${a.no_match_reason}`);
    if (c.expected_behavior === 'draft_rejected_answer_from_active_only' && a.evidence.some((e) => e.code !== meta.canonical_code)) advFail.push(`${c.test_id}: evidence from ${a.evidence.map((e) => e.code).join(',')}`);
    if (c.expected_behavior === 'no_verified_source_or_evidence_only' && a.rule_id !== null) advFail.push(`${c.test_id}: rule ${a.rule_id}`);
    if (c.expected_behavior === 'cite_table_chunk' && !a.evidence.some((e) => e.chunk_id === c.expected_id)) advFail.push(`${c.test_id}: table chunk not in evidence`);
  }
}
// registry: draft never current, named-document lookups
const rdb = openKnowledgeDb({ path: ':memory:' });
ingestRegistry(rdb, { norms: join(DS, 'registry', 'norms.jsonl'), references: join(DS, 'registry', 'references.jsonl'), taxonomy: join(DS, 'taxonomy', 'team_topic_map.json') });
const superRules = readJsonl(T('supersession.jsonl'));
const supFail = [];
for (const v of superRules) {
  if (v.kind === 'status_is' && lookupRegistryCode(rdb, v.code)?.status !== v.expected_status) supFail.push(v.test_id);
  if (v.kind === 'draft_not_current') { const m = lookupRegistryCode(rdb, v.code); if (m?.status !== 'DRAFT' || searchRegistry(rdb, v.code).matches.some((x) => x.code === v.code)) supFail.push(v.test_id); }
  // `supersedes_is` = the same equality check with a non-empty expectation (41-01-11 repeals 41-01-02)
  if ((v.kind === 'supersedes_empty' || v.kind === 'supersedes_is') && JSON.stringify(regRow?.supersedes ?? null) !== JSON.stringify(v.expected_supersedes)) supFail.push(v.test_id);
  if (v.kind === 'currentness') { const { currentnessOf } = await import(join(AI, '..', 'backend', 'src', 'lib', 'mglai', 'currentness.ts').replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:')); if (currentnessOf(meta.effective_status) !== v.expected_currentness) supFail.push(v.test_id); }
}
const regCases = readJsonl(T('registry.jsonl'));
const regFail = [];
for (const c of regCases) {
  if (c.kind === 'draft_visible_only_with_flag') { if (searchRegistry(rdb, c.query).matches.some((m) => m.code === c.must_include_code_when_include_drafts)) regFail.push(c.test_id); continue; }
  const r = searchRegistry(rdb, c.query, { limit: 8 });
  if (c.must_include_code && !r.matches.some((m) => m.code === c.must_include_code)) regFail.push(c.test_id);
  if (c.expected_team && !r.interpretation.teams.includes(c.expected_team)) regFail.push(c.test_id);
}
add('NO-HALLUCINATION TESTS PASS', advFail.length === 0 && supFail.length === 0 && regFail.length === 0 ? 'PASS' : 'FAIL',
  `adversarial ${adversarial.length - advFail.length}/${adversarial.length} · supersession/version ${superRules.length - supFail.length}/${superRules.length} · registry ${regCases.length - regFail.length}/${regCases.length}${[...advFail, ...supFail, ...regFail].length ? ' · fail: ' + [...advFail, ...supFail, ...regFail].join('; ') : ''}`);

/* 12. RUNTIME RETRIEVAL (optional, isolated runtime you started yourself) */
const runtime = flag('runtime');
if (runtime) {
  const secret = flag('secret') ?? '';
  try {
    const h = { 'content-type': 'application/json', 'x-mglai-secret': secret, origin: 'http://localhost:5173' };
    // эхний ОЛДСОН тест — runtime-ийн шалгалт нь тээврийг шалгана, хайлтын алдсан кейсийг биш
    const q = retrieval.find((t) => !misses.includes(t.test_id)) ?? retrieval[0];
    const r1 = await fetch(`${runtime}/norm`, { method: 'POST', headers: h, body: JSON.stringify({ query: q.query }) }).then((r) => r.json());
    const r2 = await fetch(`${runtime}/norm/registry`, { method: 'POST', headers: h, body: JSON.stringify({ query: 'Өндөр барилгын цахилгаан, гэрэлтүүлгийн норм өг' }) }).then((r) => r.json());
    const ok = Array.isArray(r1.evidence) && r1.evidence.some((e) => e.chunk_id === q.expected_id) && r1.registry && Array.isArray(r2.matches) && r2.matches.some((m) => m.code === meta.canonical_code);
    add('RUNTIME RETRIEVAL PASS', ok ? 'PASS' : 'FAIL', `${runtime} /norm evidence[0]=${r1.evidence?.[0]?.chunk_id ?? r1.error ?? '?'} · /norm/registry matches ${r2.matches?.length ?? r2.error ?? '?'}`);
  } catch (e) { add('RUNTIME RETRIEVAL PASS', 'FAIL', e instanceof Error ? e.message : String(e)); }
} else add('RUNTIME RETRIEVAL PASS', 'SKIPPED', 'pass --runtime http://127.0.0.1:<port> --secret <x> (start an isolated runtime first)', false);

/* 13. HUMAN VERIFICATION (extra — the honest gate) */
const hv = meta.verification?.human_verified_clauses ?? 0;
add('TEXT HUMAN-VERIFIED', hv >= clauses.length && clauses.length > 0 ? 'PASS' : 'PENDING', `${hv}/${clauses.length} clauses compared with the page image · text status ${meta.verification?.text_verification_status} (${classifyVerification(meta.verification?.text_verification_status ?? '')})`, false);

/* verdict */
const failed = items.filter((i) => i.required && i.status === 'FAIL');
const verdict = failed.length > 0 ? 'NOT_GOLD' : hv >= clauses.length && clauses.length > 0 ? 'GOLD' : 'GOLD_CANDIDATE_PENDING_HUMAN_VERIFICATION';
const out = { document: meta.canonical_code, verdict, checked_at: new Date().toISOString().slice(0, 10), items };
writeFileSync(join(dir, 'GATE.json'), JSON.stringify(out, null, 2), 'utf8');
process.stdout.write(`\nGOLD GATE · ${meta.canonical_code}\n`);
for (const i of items) process.stdout.write(`  ${i.status.padEnd(9)} ${i.name.padEnd(34)} ${i.detail}\n`);
process.stdout.write(`\n  VERDICT: ${verdict}\n\n`);
process.exit(failed.length > 0 ? 1 : 0);
