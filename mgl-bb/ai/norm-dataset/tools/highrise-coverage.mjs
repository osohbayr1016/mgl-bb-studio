#!/usr/bin/env node
/**
 * MGL AI · БНбД 31-17-10 HIGH-RISE COVERAGE AUDIT
 *
 * This is a knowledge/currentness audit, NOT an LLM evaluation.
 * It answers:
 *   - Which documents printed inside the high-rise norm are known to our registry?
 *   - Which printed references are superseded and what is their current successor?
 *   - How much of the resulting current document graph is actually L2/PARSED?
 *   - Are draft/superseded records accidentally retrieval-default?
 *
 * Usage:
 *   node norm-dataset/tools/highrise-coverage.mjs
 *   node norm-dataset/tools/highrise-coverage.mjs --json <path> --strict
 *
 * --strict only fails on unsafe registry policy (draft/superseded retrieval-default,
 * missing active root, broken successor link). L0 coverage gaps remain warnings because
 * they are a corpus backlog, not a reason to hide the entire high-rise norm.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const AI = resolve(HERE, '..', '..');
const ROOT_CODE = 'БНбД 31-17-10';
const REGISTRY = join(AI, 'norm-dataset', 'registry', 'norms.jsonl');
const CROSS = join(AI, 'norm-dataset', 'documents', 'BNbD_31-17-10', 'pack', 'cross_references.json');
const STATS = join(AI, 'norm-dataset', 'documents', 'BNbD_31-17-10', 'l2', 'stats.json');
const GATE = join(AI, 'norm-dataset', 'documents', 'BNbD_31-17-10', 'GATE.json');

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : (args[i + 1] ?? fallback);
};
const strict = args.includes('--strict');
const jsonOut = flag('json', null);

function readJsonl(path) {
  return readFileSync(path, 'utf8').split(/\r?\n/).filter((x) => x.trim()).map((x) => JSON.parse(x));
}
function codeKey(v) {
  return String(v ?? '')
    .toLowerCase()
    .replace(/[–—.]/g, '-')
    .replace(/\s+/g, '')
    .replace(/бнбд/g, 'bnbd')
    .replace(/бнод/g, 'bnbd')
    .replace(/бд/g, 'bd')
    .replace(/убб/g, 'ubb')
    .replace(/снип/g, 'snip')
    .replace(/\*\/\d{2}$/u, '*')
    .replace(/[^a-z0-9а-яөүё*\/-]/giu, '');
}
function uniq(a) { return [...new Set(a.filter(Boolean))]; }

const rows = readJsonl(REGISTRY);
const byCanonical = new Map(rows.map((r) => [r.canonical_code, r]));
const byAlias = new Map();
for (const r of rows) {
  for (const a of uniq([r.canonical_code, r.code_key, ...(r.aliases ?? [])])) {
    const k = codeKey(a);
    if (k && !byAlias.has(k)) byAlias.set(k, r);
  }
}

function resolveRow(code) {
  const direct = byAlias.get(codeKey(code));
  if (direct) return direct;
  // Common printed suffix «*/2006» / «*/22» → canonical star record.
  const k = codeKey(code).replace(/\/\d{2,4}$/u, '');
  return byAlias.get(k) ?? null;
}
function resolveCurrent(row) {
  const chain = [];
  const seen = new Set();
  let cur = row;
  while (cur && cur.status === 'SUPERSEDED' && cur.superseded_by) {
    if (seen.has(cur.canonical_code)) return { current: cur, chain, cycle: true, broken: false };
    seen.add(cur.canonical_code);
    chain.push(cur.canonical_code);
    const next = byCanonical.get(cur.superseded_by) ?? resolveRow(cur.superseded_by);
    if (!next) return { current: cur, chain, cycle: false, broken: true };
    cur = next;
  }
  return { current: cur, chain, cycle: false, broken: false };
}

const root = resolveRow(ROOT_CODE);
if (!root) throw new Error(`${ROOT_CODE} registry-д алга`);

const cross = JSON.parse(readFileSync(CROSS, 'utf8'));
const l2 = JSON.parse(readFileSync(STATS, 'utf8'));
const gate = JSON.parse(readFileSync(GATE, 'utf8'));
const printedCodes = uniq((cross.references ?? []).flatMap((r) => r.to_documents ?? [r.to_document]));
const referenceCount = new Map();
for (const edge of cross.references ?? []) {
  for (const code of edge.to_documents ?? [edge.to_document]) {
    if (!code) continue;
    referenceCount.set(code, (referenceCount.get(code) ?? 0) + 1);
  }
}

const documents = printedCodes.map((printed) => {
  const registry = resolveRow(printed);
  if (!registry) return {
    printed,
    reference_count: referenceCount.get(printed) ?? 0,
    registry: null,
    status: 'MISSING_REGISTRY',
    current_code: null,
    current_status: null,
    capability: null,
    deep_ingestion: null,
    retrieval_default: null,
    replacement_chain: [],
    gap: 'missing_registry',
  };
  const rr = resolveCurrent(registry);
  const current = rr.current;
  let gap = null;
  if (rr.broken || rr.cycle) gap = rr.broken ? 'broken_successor_link' : 'successor_cycle';
  else if (!current) gap = 'no_current_record';
  else if (!['ACTIVE', 'HISTORICAL'].includes(current.status) && current.status !== 'DRAFT') gap = 'status_requires_verification';
  else if (current.status === 'ACTIVE' && (current.capability_level !== 'L2' || current.deep_ingestion_status !== 'PARSED')) gap = 'current_not_deep_ingested';

  return {
    printed,
    reference_count: referenceCount.get(printed) ?? 0,
    registry: registry.canonical_code,
    status: registry.status,
    current_code: current?.canonical_code ?? null,
    current_status: current?.status ?? null,
    capability: current?.capability_level ?? null,
    deep_ingestion: current?.deep_ingestion_status ?? null,
    retrieval_default: current?.retrieval_default ?? null,
    replacement_chain: rr.chain,
    gap,
  };
});

const topicHighrise = rows
  .filter((r) => (r.topics ?? []).includes('high-rise') || (r.building_types ?? []).includes('high-rise'))
  .map((r) => ({
    code: r.canonical_code,
    status: r.status,
    capability: r.capability_level,
    deep_ingestion: r.deep_ingestion_status,
    retrieval_default: r.retrieval_default,
    successor_draft: r.successor_draft ?? null,
  }));

const unsafe = [];
for (const r of rows) {
  if ((r.status === 'DRAFT' || r.status === 'SUPERSEDED') && r.retrieval_default === true) {
    unsafe.push({ code: r.canonical_code, issue: `${r.status.toLowerCase()}_retrieval_default_true` });
  }
  if (r.status === 'SUPERSEDED' && r.superseded_by && !resolveRow(r.superseded_by)) {
    unsafe.push({ code: r.canonical_code, issue: 'broken_successor_link', successor: r.superseded_by });
  }
}
if (root.status !== 'ACTIVE' || root.retrieval_default !== true) {
  unsafe.push({ code: ROOT_CODE, issue: 'highrise_root_not_active_default' });
}
const draft = root.successor_draft ? resolveRow(root.successor_draft) : null;
if (root.successor_draft && (!draft || draft.status !== 'DRAFT' || draft.retrieval_default !== false)) {
  unsafe.push({ code: root.successor_draft, issue: 'successor_draft_policy_invalid' });
}

const counts = {
  printed_reference_edges: (cross.references ?? []).length,
  printed_unique_documents: printedCodes.length,
  registry_resolved: documents.filter((d) => d.registry).length,
  missing_registry: documents.filter((d) => d.gap === 'missing_registry').length,
  current_l2_parsed: documents.filter((d) => d.current_status === 'ACTIVE' && d.capability === 'L2' && d.deep_ingestion === 'PARSED').length,
  current_not_deep_ingested: documents.filter((d) => d.gap === 'current_not_deep_ingested').length,
  current_status_unresolved: documents.filter((d) => d.gap === 'status_requires_verification').length,
  superseded_printed_refs: documents.filter((d) => d.status === 'SUPERSEDED').length,
  highrise_topic_docs: topicHighrise.length,
  highrise_topic_l2_parsed: topicHighrise.filter((d) => d.status === 'ACTIVE' && d.capability === 'L2' && d.deep_ingestion === 'PARSED').length,
};

const report = {
  schema: 'mglai-highrise-coverage/1',
  generated_at: new Date().toISOString(),
  root: {
    code: root.canonical_code,
    status: root.status,
    effective_status: root.effective_status,
    capability: root.capability_level,
    deep_ingestion: root.deep_ingestion_status,
    successor_draft: root.successor_draft,
    retrieval_default: root.retrieval_default,
  },
  source_quality: {
    gate_verdict: gate.verdict,
    clauses: l2.total_clauses,
    l2_human_verified: l2.human_verified,
    l2_candidate_pass: l2.candidates_pass,
    l2_candidate_fail: l2.candidates_fail,
    cross_references_total_l2: l2.cross_references_total,
  },
  counts,
  unsafe,
  gaps: documents.filter((d) => d.gap).sort((a, b) => b.reference_count - a.reference_count || a.printed.localeCompare(b.printed)),
  documents: [...documents].sort((a, b) => b.reference_count - a.reference_count || a.printed.localeCompare(b.printed)),
  topic_highrise_documents: topicHighrise,
};

if (jsonOut) {
  const out = resolve(jsonOut);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n', 'utf8');
}

console.log('MGL AI · ӨНДӨР БАРИЛГЫН НОРМЫН ХАМРАХ ХҮРЭЭ');
console.log(`  anchor: ${root.canonical_code} · ${root.status} · ${root.capability_level}/${root.deep_ingestion_status}`);
console.log(`  successor draft: ${root.successor_draft ?? '—'} · ${draft?.status ?? 'UNKNOWN'} · retrieval_default=${draft?.retrieval_default ?? '—'}`);
console.log(`  printed cross-reference: ${counts.printed_reference_edges} edge · ${counts.printed_unique_documents} unique document`);
console.log(`  registry: ${counts.registry_resolved}/${counts.printed_unique_documents} resolved · missing ${counts.missing_registry}`);
console.log(`  current deep corpus: ${counts.current_l2_parsed}/${counts.printed_unique_documents} L2/PARSED · backlog ${counts.current_not_deep_ingested}`);
console.log(`  status unresolved: ${counts.current_status_unresolved} · printed superseded refs: ${counts.superseded_printed_refs}`);
console.log(`  high-rise topic registry: ${counts.highrise_topic_l2_parsed}/${counts.highrise_topic_docs} active L2/PARSED`);
console.log(`  L2 explanation: human verified ${l2.human_verified}/${l2.total_clauses} · model candidate PASS ${l2.candidates_pass}, FAIL ${l2.candidates_fail}`);

if (report.gaps.length) {
  console.log('\n  ХАМРАХ ХҮРЭЭНИЙ GAP (эхний 30):');
  for (const d of report.gaps.slice(0, 30)) {
    console.log(`   · ${d.printed} ×${d.reference_count} → ${d.current_code ?? '—'} · ${d.current_status ?? '—'} · ${d.capability ?? '—'}/${d.deep_ingestion ?? '—'} · ${d.gap}`);
  }
}
if (unsafe.length) {
  console.log('\n  UNSAFE REGISTRY POLICY:');
  for (const x of unsafe) console.log(`   ✖ ${x.code}: ${x.issue}`);
}
if (jsonOut) console.log(`\n  → ${resolve(jsonOut)}`);

if (strict && unsafe.length) process.exit(1);
