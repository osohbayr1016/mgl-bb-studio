#!/usr/bin/env node
/**
 * L2.1 · ХҮНИЙ ХЯНАЛТЫН ТУРШИЛТЫН БАГЦ — `l2/review/HUMAN_REVIEW_100.jsonl` (стратификацтай ~100 заалт, seed-тэй).
 *
 *   node ai/norm-dataset/tools/gen-l2-review.mjs norm-dataset/documents/BNbD_31-17-10
 *
 * Давхаргууд: obligation · prohibition · permission · нөхцөл ихтэй · онцгой нөхцөлтэй · scope · ишлэлтэй (7 шийдэгдээгүй бүгд) ·
 * тоон · урт олон өгүүлбэрт · богино · хавсралт · дугаар давхардсан · ер бусын бичлэг (томьёо/латин) · олон шаардлагатай.
 * Мөр бүр: эх бичвэр · семантик хүрээ · детерминист fallback · нэр дэвшигч (байвал) · шалгагчийн дүн · ХҮНИЙ хяналтын
 * талбарууд (бүгд NOT_REVIEWED).  Энэ хэрэгсэл HUMAN_VERIFIED ХЭЗЭЭ Ч бичихгүй; хянагч файлыг гараар засна.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? '');
const recs = readFileSync(join(dir, 'l2', 'clause_explanations.jsonl'), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
let cands = new Map();
try { cands = new Map(readFileSync(join(dir, 'l2', 'candidates.jsonl'), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)).map((c) => [c.clause_uid, c])); } catch { /* нэр дэвшигчгүй */ }

let seed = 31171021;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i -= 1) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const sentences = (t) => t.split(/(?<=[.;!?])\s+(?=[А-ЯӨҮA-Z])/u).length;
const f = (r) => r.semantic_frame;
const STRATA = [
  ['obligation', (r) => r.requirement_type === 'obligation', 10],
  ['prohibition', (r) => r.requirement_type === 'prohibition', 8],
  ['permission', (r) => r.requirement_type === 'permission', 8],
  ['condition_heavy', (r) => f(r).conditions.length >= 2, 10],
  ['exception_heavy', (r) => f(r).exceptions.length >= 1, 8],
  ['scope', (r) => r.requirement_type === 'scope', 2],
  ['cross_reference_unresolved', (r) => f(r).cross_references.some((x) => x.resolution === 'unresolved'), 7],
  ['cross_reference', (r) => f(r).cross_references.length >= 2, 6],
  ['numeric', (r) => r.numeric_literals.length >= 2, 10],
  ['long_multi_sentence', (r) => sentences(r.source_text) >= 4, 8],
  ['short', (r) => r.source_text.length < 120, 8],
  ['appendix', (r) => r.scope === 'appendix', 10],
  ['duplicate_number', (r) => r.ambiguous_with !== null, 8],
  ['unusual_wording', (r) => /[A-Za-z]{2,}|[=≤≥×∑√]|\d+\s*[×x]\s*\d+/u.test(r.source_text), 5],
  ['multiple_requirements', (r) => f(r).requirement.length + f(r).prohibitions.length + f(r).permissions.length >= 3, 7],
];
const chosen = new Map();
for (const [name, pred, n] of STRATA) {
  const pool = recs.filter((r) => pred(r) && !chosen.has(r.clause_uid));
  // Нэр дэвшигч PASS-тайг тал хувь нь хүртэл түрүүлж авна — хүний хяналт утга учиртай байхын тулд.
  const withPass = shuffle(pool.filter((r) => r.status?.semantic_validation === 'PASS'));
  const rest = shuffle(pool.filter((r) => r.status?.semantic_validation !== 'PASS'));
  const take = [...withPass.slice(0, Math.ceil(n / 2)), ...rest].slice(0, n);
  for (const r of take) chosen.set(r.clause_uid, [...(chosen.get(r.clause_uid) ?? []), name]);
}
const items = [...chosen.entries()].map(([uid, strata]) => {
  const r = recs.find((x) => x.clause_uid === uid);
  const c = cands.get(uid) ?? null;
  return {
    review_id: `HR-${uid.replace(/^.*#/, '')}`,
    clause_uid: uid,
    chunk_id: r.chunk_id,
    strata,
    requirement_type: r.requirement_type,
    scope: r.scope,
    appendix: r.appendix,
    page: r.source.page,
    source_url: r.source.url,
    source_text: r.source_text,
    source_text_sha256: r.source_text_sha256,
    semantic_frame: r.semantic_frame,
    numeric_literals: r.numeric_literals,
    deterministic_fallback: r.plain_mn_fallback,
    candidate_explanation: c ? c.candidate : null,
    candidate_model: c ? c.model : null,
    semantic_verifier: r.candidate_verification ? { verdict: r.candidate_verification.verdict, failures: r.candidate_verification.failures } : null,
    status: r.status,
    review: {
      reviewer: null,
      reviewed_at: null,
      semantic_fidelity: 'NOT_REVIEWED',
      clarity: 'NOT_REVIEWED',
      condition_preservation: 'NOT_REVIEWED',
      exception_preservation: 'NOT_REVIEWED',
      numeric_fidelity: 'NOT_REVIEWED',
      scope_fidelity: 'NOT_REVIEWED',
      meaning_reversal: 'NOT_REVIEWED',
      verifier_verdict_correct: 'NOT_REVIEWED',
      preferred_text: 'NOT_REVIEWED',
      notes: '',
    },
  };
});
mkdirSync(join(dir, 'l2', 'review'), { recursive: true });
const out = join(dir, 'l2', 'review', 'HUMAN_REVIEW_100.jsonl');
writeFileSync(out, items.map((i) => JSON.stringify(i)).join('\n') + '\n', 'utf8');
const byStrata = {};
for (const i of items) for (const s of i.strata) byStrata[s] = (byStrata[s] ?? 0) + 1;
const summary = { generated_at: new Date().toISOString().slice(0, 10), items: items.length, with_candidate: items.filter((i) => i.candidate_explanation).length, verifier_pass: items.filter((i) => i.semantic_verifier?.verdict === 'PASS').length, verifier_fail: items.filter((i) => i.semantic_verifier?.verdict === 'FAIL').length, by_strata: byStrata, human_reviewed: 0 };
writeFileSync(join(dir, 'l2', 'review', 'SUMMARY.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8');
process.stdout.write(`HUMAN_REVIEW_100: ${items.length} заалт (нэр дэвшигчтэй ${summary.with_candidate}, шалгагч PASS ${summary.verifier_pass} / FAIL ${summary.verifier_fail}) → ${out}\n  ${JSON.stringify(byStrata)}\n`);
