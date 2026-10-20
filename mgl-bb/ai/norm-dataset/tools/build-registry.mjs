#!/usr/bin/env node
/**
 * MGL AI · norm-dataset · L0 REGISTRY BUILDER
 *
 *   node ai/norm-dataset/tools/build-registry.mjs            → registry/norms.jsonl + registry/references.jsonl
 *   node ai/norm-dataset/tools/build-registry.mjs --check    → exit 1 if the generated files are stale
 *
 * Inputs (all in ai/norm-dataset/):
 *   registry/norms.seed.jsonl        — editorial rows: code, title, teams, topics, aliases, links (hand-written)
 *   registry/mcis_verification.json  — tools/mcis_verify.py output: what the MCIS register said, and when
 *   documents/＊/metadata.json        — deep-ingested documents (capability, effective_status, dirs)
 *   documents/＊/parsed/references.jsonl — cross-reference edges
 *
 * ⚠️ STATUS IS NEVER GUESSED.  `ACTIVE` only when the register returned «Хүчин төгөлдөр» for the
 *    EXACT code (or the seed carries an explicit `status_override` with evidence).  Everything the
 *    register does not know is `CANDIDATE_NEEDS_STATUS_CHECK` — it stays searchable but every
 *    answer flags it.  Drafts are `DRAFT` and `retrieval_default: false`.
 *
 * ⚠️ TAXONOMY KEYS ARE VALIDATED against taxonomy/team_topic_map.json — an unknown team/topic is an
 *    error, not a silent tag (the router matches on those keys).
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const check = process.argv.includes('--check');

import { codeKey } from './codeKey.mjs';

const readJsonl = (p) => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

export { codeKey };

const taxonomy = readJson(join(ROOT, 'taxonomy', 'team_topic_map.json'));
const seed = readJsonl(join(ROOT, 'registry', 'norms.seed.jsonl'));
const verif = existsSync(join(ROOT, 'registry', 'mcis_verification.json')) ? readJson(join(ROOT, 'registry', 'mcis_verification.json')) : {};

// documents/*/metadata.json
const docs = new Map();
const docsDir = join(ROOT, 'documents');
for (const d of readdirSync(docsDir, { withFileTypes: true })) {
  if (!d.isDirectory()) continue;
  const mp = join(docsDir, d.name, 'metadata.json');
  if (existsSync(mp)) docs.set(codeKey(readJson(mp).canonical_code), { dir: `documents/${d.name}`, meta: readJson(mp) });
}

// Бүртгэл кодыг хувилбарын тэмдэгтэй хэвлэж болно (MCIS «БНбД 22-01-21*» ↔ нормын нүүр, батлах тушаал «БНбД 22-01-21»):
// эхлээд ЯГ canonical, олдохгүй бол seed/metadata-ийн КОД ХЭЛБЭРИЙН alias-аар (нэр, дан тоо биш).  Alias-аар олдсоныг
// нотолгоонд ил бичнэ — «бүртгэл өөр хэлбэрээр хэвлэдэг» гэдэг нь нуугдах ёсгүй.
const CODE_LIKE = /\d{2}-\d{2,3}-\d{2}|\d-\d{2}-\d{2}-\d{2}|ii-\d{2}-\d{2}/;
function mcisRecordFor(code, aliases = []) {
  const key = codeKey(code);
  const keys = [key, ...new Set(aliases.map(codeKey).filter((k) => k !== key && CODE_LIKE.test(k)))];
  for (const k of keys) {
    for (const entry of Object.values(verif)) {
      for (const r of entry.records ?? []) {
        if (codeKey(r.act) === k) return { record: r, checked_at: entry.checked_at, via_alias: k === key ? null : r.act };
      }
    }
  }
  return null;
}

const errors = [];
// `supersedes_verified: true` (seed) — залгамжийн нотолгоо АЛБАН бичвэрт уншигдсан (эс тэгвэл ирмэг `supersedes_unverified` хэвээр).
const seedByKey = new Map(seed.map((s) => [codeKey(s.canonical_code), s]));
const rows = [];
for (const s of seed) {
  for (const t of s.teams ?? []) if (!taxonomy.teams[t]) errors.push(`${s.canonical_code}: unknown team «${t}»`);
  for (const t of s.topics ?? []) if (!taxonomy.topics[t]) errors.push(`${s.canonical_code}: unknown topic «${t}»`);

  const key = codeKey(s.canonical_code);
  const doc = docs.get(key) ?? null;
  const mcis = mcisRecordFor(s.canonical_code, [...(s.aliases ?? []), ...(doc?.meta.aliases ?? [])]);
  let status;
  let evidence = [...(s.status_evidence ?? [])];
  let sourceType = 'unresolved';
  let lastVerified = '1970-01-01';
  if (s.status_override) {
    status = s.status_override;
    if (evidence.length === 0) errors.push(`${s.canonical_code}: status_override without status_evidence`);
    sourceType = s.source_type ?? 'unresolved';
    lastVerified = mcis?.checked_at ?? doc?.meta.last_verified ?? new Date().toISOString().slice(0, 10);
  } else if (mcis && /хүчин төгөлдөр/iu.test(mcis.record.status ?? '')) {
    status = 'ACTIVE';
    evidence.push(`MCIS current-norm register record ${mcis.record.id}: «${mcis.record.status}» — ${mcis.record.decision || 'тушаал заагаагүй'} (checked ${mcis.checked_at})${mcis.via_alias ? ` — the register prints the code as «${mcis.via_alias}», an alias of «${s.canonical_code}»` : ''}`);
    sourceType = 'mcis_register';
    lastVerified = mcis.checked_at;
  } else {
    status = 'CANDIDATE_NEEDS_STATUS_CHECK';
    evidence.push(mcis ? `MCIS register status «${mcis.record.status}» (checked ${mcis.checked_at})` : 'Not found in the MCIS current-norm register query (tools/mcis_verify.py); status unresolved');
    lastVerified = Object.values(verif).find((e) => codeKey(e.query) === key.replace(/^[a-z]+/, '') || true)?.checked_at ?? lastVerified;
  }
  if (doc?.meta.status_evidence) evidence = [...new Set([...evidence, ...doc.meta.status_evidence])];

  const row = {
    canonical_code: s.canonical_code,
    code_key: key,
    title_mn: doc?.meta.title_mn ?? s.title_mn,
    title_en: doc?.meta.title_en ?? s.title_en ?? null,
    document_type: s.document_type,
    status,
    status_evidence: evidence,
    effective_status: doc?.meta.effective_status ?? (status === 'ACTIVE' ? 'current_status_not_checked_for_later_amendments' : status === 'DRAFT' ? 'draft_not_in_force' : 'unknown_requires_legal_verification'),
    capability_level: doc?.meta.capability_level ?? s.capability_level ?? 'L0',
    priority: s.priority ?? 'P2',
    teams: s.teams ?? [],
    topics: s.topics ?? [],
    building_types: s.building_types ?? [],
    aliases: [...new Set([s.canonical_code, ...(s.aliases ?? []), ...(doc?.meta.aliases ?? [])])],
    supersedes: s.supersedes ?? doc?.meta.supersedes ?? [],
    supersedes_evidence: s.supersedes_evidence ?? doc?.meta.supersedes_note ?? null,
    superseded_by: s.superseded_by ?? doc?.meta.superseded_by ?? null,
    successor_draft: s.successor_draft ?? doc?.meta.successor_draft?.code ?? null,
    draft_of: s.draft_of ?? null,
    amends: s.amends ?? null,
    // «Албан тайлбар» (БД 20-102-21 → БНбД 20-04-17): тайлбар нь НОРМ БИШ — ирмэг нь `commentary_of`, хэзээ ч supersedes/amends биш.
    ...(s.commentary_of ? { commentary_of: s.commentary_of } : {}),
    approval: mcis?.record.decision || doc?.meta.approval?.order_number ? mcis?.record.decision ?? `тушаал №${doc?.meta.approval?.order_number} (${doc?.meta.approval?.order_date})` : null,
    source_url: (mcis?.record.directurl ?? doc?.meta.source_url ?? s.source_url ?? null)?.replace(/^http:\/\//, 'https://') ?? null,
    source_pdf_url: mcis?.record.pdf ?? doc?.meta.source_pdf_url ?? (s.source_type === 'official_draft' ? s.source_url : null) ?? null,
    legal_source_url: s.legal_source_url ?? doc?.meta.legal_source_url ?? null,
    source_type: sourceType,
    retrieval_default: !['DRAFT', 'SUPERSEDED', 'HISTORICAL'].includes(status) && s.retrieval_default !== false,
    deep_ingestion_status: doc?.meta.deep_ingestion_status ?? (s.local_pack ? 'PARSED' : 'NOT_STARTED'),
    document_dir: doc?.dir ?? null,
    local_pack: s.local_pack ?? null,
    note: s.note ?? null,
    last_verified: lastVerified,
  };
  rows.push(row);
}

// duplicates + alias index (a reference printed as «БНбД 31-03-03» resolves to the register's «БНбД 31-03-03*/11»)
const seen = new Set();
const aliasIndex = new Map();
for (const r of rows) {
  if (seen.has(r.code_key)) errors.push(`duplicate code_key ${r.code_key}`);
  seen.add(r.code_key);
  for (const a of r.aliases) {
    const k = codeKey(a);
    if (/\d{2}-\d{2,3}-\d{2}|\d-\d{2}-\d{2}-\d{2}|ii-\d{2}-\d{2}/.test(k) && !aliasIndex.has(k)) aliasIndex.set(k, r.canonical_code);
  }
}
const resolveCode = (key) => (seen.has(key) ? rows.find((r) => r.code_key === key).canonical_code : aliasIndex.get(key) ?? null);

// cross-reference edges
const refs = [];
const refSeen = new Set();
for (const [key, d] of docs) {
  const rp = join(ROOT, d.dir, 'parsed', 'references.jsonl');
  if (!existsSync(rp)) continue;
  for (const r of readJsonl(rp)) {
    if (!r.to_document_key) continue;
    const toKey = codeKey(r.to_document_key);
    const edgeKey = `${key}|${r.from_clause ?? r.from_locator}|${toKey}`;
    if (refSeen.has(edgeKey)) continue;
    refSeen.add(edgeKey);
    refs.push({
      from: d.meta.canonical_code,
      from_key: key,
      from_clause: r.from_clause,
      from_locator: r.from_locator,
      to_document: r.to_document,
      to_key: toKey,
      to_registry_code: resolveCode(toKey),
      to_in_registry: resolveCode(toKey) !== null,
      relationship: r.relationship,
      context: r.context,
      source_page: r.source_page,
    });
  }
}
for (const r of rows) {
  for (const s of r.supersedes) {
    refs.push({ from: r.canonical_code, from_key: r.code_key, from_clause: null, from_locator: null, to_document: s, to_key: codeKey(s), to_registry_code: resolveCode(codeKey(s)), to_in_registry: resolveCode(codeKey(s)) !== null, relationship: seedByKey.get(r.code_key)?.supersedes_verified === true && r.supersedes_evidence ? 'supersedes' : 'supersedes_unverified', context: r.supersedes_evidence, source_page: null });
  }
  if (r.commentary_of) {
    refs.push({ from: r.canonical_code, from_key: r.code_key, from_clause: null, from_locator: null, to_document: r.commentary_of, to_key: codeKey(r.commentary_of), to_registry_code: resolveCode(codeKey(r.commentary_of)), to_in_registry: resolveCode(codeKey(r.commentary_of)) !== null, relationship: 'commentary_of', context: r.title_mn, source_page: null });
  }
  if (r.draft_of) refs.push({ from: r.canonical_code, from_key: r.code_key, from_clause: null, from_locator: null, to_document: r.draft_of, to_key: codeKey(r.draft_of), to_registry_code: r.draft_of, to_in_registry: true, relationship: 'draft_revision_of', context: null, source_page: null });
}

if (errors.length > 0) {
  for (const e of errors) process.stderr.write(`  ✖ ${e}\n`);
  process.exit(1);
}

const outNorms = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const outRefs = refs.map((r) => JSON.stringify(r)).join('\n') + '\n';
const pNorms = join(ROOT, 'registry', 'norms.jsonl');
const pRefs = join(ROOT, 'registry', 'references.jsonl');
if (check) {
  const stale = (existsSync(pNorms) ? readFileSync(pNorms, 'utf8') : '') !== outNorms || (existsSync(pRefs) ? readFileSync(pRefs, 'utf8') : '') !== outRefs;
  process.stdout.write(stale ? 'STALE — run build-registry.mjs\n' : 'registry up to date\n');
  process.exit(stale ? 1 : 0);
}
writeFileSync(pNorms, outNorms, 'utf8');
writeFileSync(pRefs, outRefs, 'utf8');
const byStatus = {};
for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
process.stdout.write(`registry: ${rows.length} norms ${JSON.stringify(byStatus)} · references: ${refs.length} edges (${refs.filter((r) => !r.to_in_registry).length} to codes outside the registry)\n`);
