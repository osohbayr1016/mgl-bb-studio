import fs from 'node:fs';
import path from 'node:path';
import { canonicalize, readJson, sha256Value } from './canonical.mjs';
import { expandVariants } from './variants.mjs';

export const BENCHMARK_VERSION = 'reasoning-v1.0.0';
export const MODES = ['MODEL_ONLY_EVIDENCE', 'FULL_RAG', 'ADVERSARIAL_SYSTEM'];
export const REVIEW_STATES = [
  'REFERENCE_VERIFIED','SYNTHETIC_DETERMINISTIC','PORTED_FROM_EXISTING_GOLD',
  'PORTED_FROM_EXISTING_HELDOUT','NEEDS_HUMAN_REVIEW','HUMAN_REVIEWED',
];
export const CATEGORY_COUNTS = {
  'mongolian-understanding': 8,
  'norm-retrieval': 8,
  'applied-rule': 8,
  'engineering-reasoning': 7,
  clarification: 5,
  'hallucination-traps': 5,
  conversation: 4,
  'cross-source': 3,
};
export const CATEGORY_PREFIX = {
  'mongolian-understanding':'MN',
  'norm-retrieval':'NR',
  'applied-rule':'AR',
  'engineering-reasoning':'ER',
  clarification:'CL',
  'hallucination-traps':'HT',
  conversation:'CV',
  'cross-source':'XS',
};

export function benchmarkRoot(fromUrl = import.meta.url) {
  const here = path.dirname(new URL(fromUrl).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  return path.resolve(here, '..');
}

export function fixturePath(root, ref) {
  if (!ref) return null;
  const normalized = String(ref).replace(/\\/g, '/').replace(/^fixtures\//, '');
  if (normalized.includes('..')) throw new Error('fixture path traversal: ' + ref);
  return path.join(root, 'fixtures', normalized);
}

export function loadFixture(root, ref) {
  const p = fixturePath(root, ref);
  if (!p) return null;
  if (!fs.existsSync(p)) throw new Error('fixture not found: ' + ref);
  const v = readJson(p);
  if (v.fixture !== true) throw new Error('fixture must declare fixture=true: ' + ref);
  return v;
}

export function validateCase(c, root) {
  const errors = [];
  const required = ['id','version','category','difficulty','languages','modes','expected','provenance'];
  for (const k of required) if (c[k] === undefined || c[k] === null) errors.push('missing ' + k);
  const prefix = CATEGORY_PREFIX[c.category];
  if (!prefix) errors.push('unknown category ' + c.category);
  if (prefix && !new RegExp('^' + prefix + '-\\d{3}$').test(c.id ?? '')) errors.push('bad id/category prefix');
  if (!Number.isInteger(c.version) || c.version < 1) errors.push('version must be integer >=1');
  if (!['easy','medium','hard'].includes(c.difficulty)) errors.push('bad difficulty');
  if (!Array.isArray(c.languages) || c.languages.length === 0) errors.push('languages empty');
  if (!Array.isArray(c.modes) || c.modes.length === 0 || c.modes.some((m) => !MODES.includes(m))) errors.push('bad modes');
  if (typeof c.question !== 'string' && !Array.isArray(c.turns)) errors.push('question or turns required');
  if (Array.isArray(c.turns) && c.turns.length === 0) errors.push('turns empty');
  if (!c.expected || typeof c.expected !== 'object' || Array.isArray(c.expected) || Object.keys(c.expected).length === 0) errors.push('expected semantics missing');
  else if (!['decision','required_claims','missing_inputs','forbidden_claims','required_sources','calculation','trusted_facts','intent','language','require_all','require_any'].some((k) => c.expected[k] != null)) errors.push('expected semantics have no scored assertion');
  if (!c.provenance || typeof c.provenance.source !== 'string' || !REVIEW_STATES.includes(c.provenance.review_status)) errors.push('invalid provenance');
  if (c.provenance?.review_status === 'HUMAN_REVIEWED' && c.provenance?.human_reviewer !== true) errors.push('HUMAN_REVIEWED requires human_reviewer=true');
  for (const key of ['evidence_fixture','adversarial_fixture']) {
    if (c[key]) {
      try { loadFixture(root, c[key]); } catch (e) { errors.push(String(e.message)); }
    }
  }
  if (c.expected?.required_sources?.length) {
    if (!c.evidence_fixture) errors.push('required sources need an evidence fixture');
    else {
      try {
        const fixture = loadFixture(root, c.evidence_fixture);
        const sources = fixture.sources ?? [];
        for (const required of c.expected.required_sources) {
          if (!required || typeof required.document !== 'string' || !sources.some((source) =>
            source.document === required.document && (required.clause == null || source.clause === required.clause))) {
            errors.push('required source absent from evidence fixture: ' + JSON.stringify(required));
          }
        }
      } catch { /* The fixture error is reported above. */ }
    }
  }
  if (c.safety) {
    for (const [k,v] of Object.entries(c.safety)) {
      if (!['fabricated_number','fabricated_citation','trusted_fact_contradiction','unverified_promotion','secret_leak'].includes(k)) errors.push('unknown safety policy ' + k);
      if (!['FAIL','IGNORE'].includes(v)) errors.push('invalid safety policy value ' + k + '=' + v);
    }
  }
  for (const v of c.variants ?? []) {
    if (!v.id || typeof v.id !== 'string') errors.push('variant missing id');
    if (!v.question && !v.turns) errors.push('variant ' + (v.id ?? '?') + ' missing question/turns');
  }
  return errors;
}

function caseFiles(root) {
  const dir = path.join(root, 'cases');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(dir, f));
}

export function loadCoreCases(root = benchmarkRoot()) {
  const cases = [];
  for (const file of caseFiles(root)) {
    const doc = readJson(file);
    const rows = Array.isArray(doc) ? doc : doc.cases;
    if (!Array.isArray(rows)) throw new Error(path.basename(file) + ': expected cases[]');
    for (const c of rows) cases.push(canonicalize(c));
  }
  return cases;
}

export function caseSetSha256(cases) {
  return sha256Value(cases.map((c) => canonicalize(c)));
}

export function validateSchemas(root = benchmarkRoot()) {
  const names = ['case.schema.json','result.schema.json','identity.schema.json','human-review.schema.json'];
  const errors = [];
  for (const name of names) {
    const p = path.join(root, 'schemas', name);
    if (!fs.existsSync(p)) { errors.push('missing schema ' + name); continue; }
    try {
      const s = readJson(p);
      if (typeof s.$id !== 'string' || !s.$id.startsWith('mglai-reasoning')) errors.push(name + ': invalid $id');
      if (s.type !== 'object') errors.push(name + ': root type must be object');
    } catch (e) { errors.push(name + ': ' + e.message); }
  }
  return errors;
}

export function validateCoreSet(core, root = benchmarkRoot()) {
  const errors = [...validateSchemas(root)];
  const variants = expandVariants(core);
  const ids = new Set();
  const variantIds = new Set();
  const counts = {};
  for (const c of core) {
    for (const e of validateCase(c, root)) errors.push(c.id + ': ' + e);
    if (ids.has(c.id)) errors.push('duplicate core id ' + c.id);
    ids.add(c.id);
    counts[c.category] = (counts[c.category] ?? 0) + 1;
    for (const v of c.variants ?? []) {
      if (ids.has(v.id) || variantIds.has(v.id)) errors.push('duplicate variant id ' + v.id);
      variantIds.add(v.id);
    }
  }
  if (core.length < 48) errors.push('core case count < 48: ' + core.length);
  if (core.length + variants.length < 100) errors.push('total core + variant cases < 100: ' + (core.length + variants.length));
  for (const [cat,n] of Object.entries(CATEGORY_COUNTS)) {
    if ((counts[cat] ?? 0) !== n) errors.push('category ' + cat + ' expected ' + n + ', got ' + (counts[cat] ?? 0));
  }
  return { ok: errors.length === 0, errors, counts, core_total: core.length, variant_total: variants.length, case_set_sha256: caseSetSha256(core) };
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (/\.[cm]?[jt]sx?$/.test(ent.name)) out.push(p);
  }
  return out;
}

export function validateDependencyDirection(repoRoot) {
  const roots = [
    path.join(repoRoot,'backend','src'),
    path.join(repoRoot,'frontend','src'),
    path.join(repoRoot,'packages','mglai-common','src'),
    path.join(repoRoot,'ai','runtime','src'),
    path.join(repoRoot,'ai','retrieval','src'),
    path.join(repoRoot,'ai','norm-compiler','src'),
  ];
  const offenders = [];
  for (const root of roots) {
    for (const file of walk(root)) {
      const text = fs.readFileSync(file,'utf8');
      if (/from\s+['"][^'"]*reasoning-v1|import\s*\([^)]*reasoning-v1/u.test(text)) offenders.push(file);
      if (/benchmarkCaseId\s*===|question\s*===\s*['"][^'"]*(?:MN|NR|AR|ER|CL|HT|CV|XS)-\d{3}/u.test(text)) offenders.push(file + ' (benchmark-specific branch)');
    }
  }
  return [...new Set(offenders)];
}

export function loadBenchmark(root = benchmarkRoot()) {
  const core = loadCoreCases(root);
  const validation = validateCoreSet(core, root);
  const variants = expandVariants(core);
  return { root, core, variants, all: [...core, ...variants], validation, benchmark_version: BENCHMARK_VERSION };
}
