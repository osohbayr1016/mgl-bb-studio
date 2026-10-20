import { canonicalize } from './canonical.mjs';

function merge(base, patch) {
  if (Array.isArray(patch)) return patch;
  if (!patch || typeof patch !== 'object') return patch;
  const out = { ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}) };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(out[k], v) : v;
  }
  return out;
}

export function expandVariants(coreCases) {
  const out = [];
  for (const c of coreCases) {
    for (const v of c.variants ?? []) {
      const x = structuredClone(c);
      delete x.variants;
      x.id = v.id;
      x.core_id = c.id;
      x.is_variant = true;
      x.variant_kind = v.kind ?? 'paraphrase';
      x.same_semantics = v.same_semantics !== false;
      if (typeof v.question === 'string') {
        x.question = v.question;
        delete x.turns;
      }
      if (Array.isArray(v.turns)) {
        x.turns = v.turns;
        delete x.question;
      }
      if (v.patch) Object.assign(x, merge(x, v.patch));
      if (v.expected_patch) x.expected = merge(x.expected, v.expected_patch);
      if (v.languages) x.languages = [...v.languages];
      if (v.modes) x.modes = [...v.modes];
      out.push(canonicalize(x));
    }
  }
  return out;
}

export function semanticConsistencyRate(results) {
  const byCore = new Map();
  for (const r of results) {
    const core = r.core_id ?? r.case_id;
    if (!r.is_variant || r.same_semantics === false || r.status === 'BLOCKED' || r.status === 'ERROR') continue;
    const a = byCore.get(core) ?? [];
    a.push(r);
    byCore.set(core, a);
  }
  let comparable = 0;
  let consistent = 0;
  const groups = [];
  for (const [core, variants] of byCore) {
    const coreResult = results.find((r) => r.case_id === core && r.status !== 'BLOCKED' && r.status !== 'ERROR');
    if (!coreResult) continue;
    const base = coreResult.semantic?.decision ?? null;
    for (const v of variants) {
      const actual = v.semantic?.decision ?? null;
      comparable += 1;
      const ok = base !== null && actual === base;
      if (ok) consistent += 1;
      groups.push({ core_id: core, variant_id: v.case_id, expected_same: true, core_decision: base, variant_decision: actual, consistent: ok });
    }
  }
  return { comparable, consistent, rate: comparable ? Math.round((consistent / comparable) * 10000) / 100 : null, groups };
}
