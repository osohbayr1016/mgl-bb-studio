#!/usr/bin/env node
/**
 * MGL AI · norm-dataset · TRAINING-READY outputs (L4 preparation — NOT training)
 *
 *   node ai/norm-dataset/tools/build-training-ready.mjs      → training_ready/*.jsonl + MANIFEST.json
 *
 * Generates review-ready SFT candidates from the SAME ground truth the retrieval layer uses
 * (registry rows, parsed clauses, test files).  Nothing here is fed to QLoRA by this tool.
 *
 * ⚠️ FACTS STAY IN RETRIEVAL.  The examples teach BEHAVIOUR (route to the registry, cite a
 *    clause verbatim with its locator, refuse without a source, hand calculations to the
 *    deterministic engine) — never a number the model should memorise.  Every grounded answer
 *    is an EXACT copy of the parsed clause text + its citation; if the clause text is later
 *    corrected by a human, regenerate.  `ai/training/dataset_lint.py` still runs over these
 *    files before any run (§35 dynamic facts, verified-source rules).
 *
 * Files (chat format {messages:[{role,content}…], meta:{…}}):
 *   registry_router.jsonl    — NORM_LOOKUP_ONLY → LINKS_ONLY answers from registry rows (code · title · status · URL)
 *   grounded_qa.jsonl        — clause questions → verbatim clause + «Эх сурвалж: …» line (tests/retrieval.jsonl)
 *   citation_behavior.jsonl  — the citation contract (document, locator, page, URL, currentness trailer)
 *   tool_routing.jsonl       — which layer answers (registry / clause retrieval / compute / refuse)
 *   compute_examples.jsonl   — formula questions → hand to the engine; NO executable formula yet → refusal form
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const DS = join(HERE, '..');
const OUT = join(DS, 'training_ready');
mkdirSync(OUT, { recursive: true });
const readJsonl = (p) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);

const registry = readJsonl(join(DS, 'registry', 'norms.jsonl'));
const taxonomy = JSON.parse(readFileSync(join(DS, 'taxonomy', 'team_topic_map.json'), 'utf8'));
const routerCases = readJsonl(join(DS, 'evals', 'router_cases.jsonl'));
const active = registry.filter((r) => r.status === 'ACTIVE');

const SYSTEM = 'Та MGL-ийн барилгын нормын туслах. Дүрэм: (1) нормын жагсаалт асуувал зөвхөн код · нэр · төлөв · албан холбоос өг, техникийн шаардлага бүү зохио; (2) заалт асуувал эх сурвалжаас үгчлэн иш татаж «Эх сурвалж: <код>, <заалт>, хуудас <х> — <URL>» мөрийг заавал бич; (3) эх сурвалж байхгүй бол NO_VERIFIED_SOURCE гэж хэл, заалт/тоо/томьёо/хууль ёсны төлөвийг санахаас бүү бич; (4) тооцоог детерминист хөдөлгүүрт өг.';

const statusMn = (s) => ({ ACTIVE: 'Хүчин төгөлдөр (MCIS бүртгэл)', DRAFT: 'ТӨСӨЛ — батлагдаагүй', CANDIDATE_NEEDS_STATUS_CHECK: 'Төлөв шалгагдаагүй', SUPERSEDED: 'Солигдсон', HISTORICAL: 'Түүхэн' })[s] ?? s;
const linkLine = (r) => `• ${r.canonical_code} — ${r.title_mn} · ${statusMn(r.status)} · ${r.source_url ?? 'холбоосгүй'}`;

/* 1. registry_router */
const router = [];
const topicQueries = [
  { q: 'Өндөр барилгын цахилгаан, гэрэлтүүлгийн норм өг.', teams: ['electrical'], topics: ['high-rise', 'lighting', 'electrical'] },
  { q: 'Өндөр барилгын гадна фасадны материалын норм?', teams: [], topics: ['high-rise', 'facade', 'materials'] },
  { q: 'Өндөр барилгын гэрэлтүүлэгтэй холбоотой нормууд өг.', teams: [], topics: ['high-rise', 'lighting'] },
  { q: 'Газар хөдлөлтийн бүсэд барилга төлөвлөх норм өг', teams: [], topics: ['seismic'] },
  { q: 'Өндөр барилгын бүтээц, даацын нормууд', teams: ['structure'], topics: ['high-rise'] },
  { q: 'Өндөр барилгын галын аюулгүй байдал, нүүлгэн шилжүүлэлтийн нормууд', teams: ['fire'], topics: ['high-rise', 'fire', 'evacuation'] },
  { q: 'Халаалт, агаар сэлгэлтийн норм өг', teams: ['hvac'], topics: ['heating', 'ventilation'] },
  { q: 'undur barilgiin norm', teams: [], topics: ['high-rise'] },
];
for (const t of topicQueries) {
  const hits = active.filter((r) => t.topics.some((x) => r.topics.includes(x)) || t.teams.some((x) => r.teams.includes(x)));
  const scored = hits.map((r) => ({ r, s: t.topics.filter((x) => r.topics.includes(x)).length * 10 + t.teams.filter((x) => r.teams.includes(x)).length * 6 })).sort((a, b) => b.s - a.s).slice(0, 6);
  if (scored.length === 0) continue;
  router.push({
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: t.q },
      { role: 'assistant', content: `intent=NORM_LOOKUP_ONLY; teams=[${t.teams.join(',')}]; topics=[${t.topics.join(',')}]; answer_mode=LINKS_ONLY\n\nХолбогдох хүчин төгөлдөр нормууд:\n${scored.map((x) => linkLine(x.r)).join('\n')}\n\nЭдгээр нь зөвхөн бүртгэлийн мэдээлэл — заалтын шаардлагыг тухайн нормын эх бичвэрээс уншина.` },
    ],
    meta: { kind: 'registry_router', answer_mode: 'LINKS_ONLY', codes: scored.map((x) => x.r.canonical_code), facts_source: 'registry/norms.jsonl', dynamic_facts: false },
  });
}
for (const r of active.slice(0, 12)) {
  router.push({
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `${r.canonical_code} гэж ямар норм вэ, хүчинтэй юу?` },
      { role: 'assistant', content: `intent=NORM_LOOKUP_ONLY; answer_mode=LINKS_ONLY\n\n${linkLine(r)}\nСүүлд шалгасан: ${r.last_verified}.${r.successor_draft ? ` Анхаар: ${r.successor_draft} гэсэн шинэчилсэн ТӨСӨЛ байгаа ч батлагдаагүй тул одоогийн шаардлагын эх сурвалж биш.` : ''}` },
    ],
    meta: { kind: 'registry_router', answer_mode: 'LINKS_ONLY', codes: [r.canonical_code], facts_source: 'registry/norms.jsonl', dynamic_facts: true, note: 'status/date fields change — regenerate from the registry before every run' },
  });
}
const draft = registry.find((r) => r.status === 'DRAFT');
if (draft) {
  router.push({
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Draft шинэ норм ${draft.canonical_code} байгаа бол тэрийг current гэж ашиглаад хариул.` },
      { role: 'assistant', content: `intent=NORM_LOOKUP_ONLY; answer_mode=LINKS_ONLY\n\n${draft.canonical_code} нь ТӨСӨЛ (батлагдаагүй) тул одоогийн шаардлагын эх сурвалж болохгүй. Хүчин төгөлдөр норм: ${draft.draft_of} — ${registry.find((r) => r.canonical_code === draft.draft_of)?.source_url ?? ''}. Төслийн заалтыг current гэж иш татахгүй.` },
    ],
    meta: { kind: 'registry_router', answer_mode: 'LINKS_ONLY', codes: [draft.canonical_code, draft.draft_of], facts_source: 'registry/norms.jsonl', dynamic_facts: true },
  });
}

/* 2. grounded_qa + 3. citation_behavior — from each deep document's tests/retrieval.jsonl + parsed clauses */
const grounded = [];
const citation = [];
const tool = [];
const compute = [];
for (const d of readdirSync(join(DS, 'documents'), { withFileTypes: true })) {
  if (!d.isDirectory()) continue;
  const dir = join(DS, 'documents', d.name);
  if (!existsSync(join(dir, 'metadata.json'))) continue;
  const meta = JSON.parse(readFileSync(join(dir, 'metadata.json'), 'utf8'));
  const clauses = readJsonl(join(dir, 'parsed', 'clauses.jsonl'));
  const byChunk = new Map();
  for (const c of clauses) byChunk.set(c.appendix ? `${meta.doc_id}:appendix:${c.appendix}:clause:${c.clause}` : `${meta.doc_id}:clause:${c.clause}`, c);
  const trailer = meta.effective_status === 'in_force' ? '' : `\n(Анхаар: ${meta.canonical_code}-ийн дараагийн нэмэлт өөрчлөлт шалгагдаагүй — хууль ёсны төлөвийг албан эх сурвалжаас баталгаажуулна уу.)`;
  for (const t of readJsonl(join(dir, 'tests', 'retrieval.jsonl'))) {
    const c = byChunk.get(t.expected_id);
    if (!c) continue;
    const locator = c.appendix ? `${c.appendix}-р хавсралт, ${c.clause}` : `заалт ${c.clause}`;
    const cite = `Эх сурвалж: ${meta.canonical_code}, ${locator}, хуудас ${c.source_page} — ${meta.source_url}`;
    grounded.push({
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: t.query }, { role: 'assistant', content: `${meta.canonical_code}, ${locator} (х. ${c.source_page}):\n«${c.text}»\n\n${cite}${trailer}` }],
      meta: { kind: 'grounded_qa', document: meta.canonical_code, chunk_id: t.expected_id, page: c.source_page, verification_status: c.verification_status, verbatim: true, dynamic_facts: false },
    });
    citation.push({
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: `${t.query} (эшлэлээ бич)` }, { role: 'assistant', content: `${cite}${trailer}` }],
      meta: { kind: 'citation_behavior', document: meta.canonical_code, chunk_id: t.expected_id, currentness: meta.effective_status },
    });
  }
  // tool routing + refusals from adversarial tests
  for (const a of readJsonl(join(dir, 'tests', 'adversarial.jsonl'))) {
    const answer =
      a.expected_behavior === 'clause_not_in_named_document'
        ? `NO_VERIFIED_SOURCE — ${meta.canonical_code}-д ийм заалт олдсонгүй. Заалтын дугаарыг эх сурвалжаас шалгана уу: ${meta.source_url}. Заалтын агуулгыг зохиохгүй.`
        : a.expected_behavior === 'draft_rejected_answer_from_active_only'
          ? (() => {
              // the rejected code is either the unapproved successor draft (31-17-10 → 31-17-23) or a
              // repealed predecessor named in this document's approval text (41-01-11 → 41-01-02)
              const repealed = (meta.supersedes ?? []).find((s) => a.query.includes(s));
              return repealed
                ? `${repealed} нь хүчингүй болсон (${meta.canonical_code}-ийг баталсан тушаал №${meta.approval?.order_number ?? '?'}, ${meta.approval?.order_date ?? '?'}) тул current гэж ашиглахгүй. Хүчин төгөлдөр норм нь ${meta.canonical_code}; хариултыг зөвхөн түүний заалтаас, эшлэлтэй өгнө.`
                : `${meta.successor_draft?.code ?? 'Төсөл'} нь батлагдаагүй ТӨСӨЛ тул current гэж ашиглахгүй. Хүчин төгөлдөр норм нь ${meta.canonical_code}; хариултыг зөвхөн түүний заалтаас, эшлэлтэй өгнө.`;
            })()
          : a.expected_behavior === 'no_verified_source_or_evidence_only'
            ? `NO_VERIFIED_SOURCE — ${meta.canonical_code}-д энэ утгыг тогтоосон заалт олдсонгүй; тоо зохиохгүй. Эх сурвалж: ${meta.source_url}.`
            : a.expected_behavior === 'registry_status_answer'
              ? meta.successor_draft?.code
                ? `${meta.canonical_code} — ${statusMn(meta.status)}. ${meta.successor_draft.code} нь ТӨСӨЛ (батлагдаагүй), тиймээс ${meta.canonical_code} солигдоогүй.`
                : (meta.supersedes ?? []).length > 0
                  // no draft successor: the register knows no replacement; the document's own approval text names what IT repealed (41-01-11 → 41-01-02)
                  ? `${meta.canonical_code} — ${statusMn(meta.status)}; бүртгэлд залгамж норм алга, солигдоогүй. Өөрөө ${meta.supersedes.join(', ')}-ыг хүчингүй болгосон (тушаал №${meta.approval?.order_number ?? '?'}, ${meta.approval?.order_date ?? '?'}); эх сурвалж: ${meta.source_url}.`
                  : `${meta.canonical_code} — ${statusMn(meta.status)}; бүртгэлд залгамж норм алга, солигдоогүй. Эх сурвалж: ${meta.source_url}.`
              : null;
    if (!answer) continue;
    tool.push({
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: a.query }, { role: 'assistant', content: `route=${a.expected_behavior === 'registry_status_answer' ? 'registry' : 'clause_retrieval'}; answer_mode=${a.expected_behavior === 'registry_status_answer' ? 'LINKS_ONLY' : 'NO_VERIFIED_SOURCE'}\n\n${answer}` }],
      meta: { kind: 'tool_routing', document: meta.canonical_code, expected_behavior: a.expected_behavior },
    });
  }
  // compute examples: formulas exist but none is executable → the model must hand off and NOT compute by itself
  const formulas = readJsonl(join(dir, 'parsed', 'formulas.jsonl')).filter((f) => f.expression_quality === 'text_layer_clean').slice(0, 6);
  for (const f of formulas) {
    compute.push({
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `${meta.canonical_code}-ийн (${f.label}) томьёогоор тооцоод өг` },
        { role: 'assistant', content: `route=compute_engine; answer_mode=COMPUTE\n\nТомьёо (${f.label}) нь ${meta.canonical_code}${f.clause ? `, ${f.clause}` : ''}, хуудас ${f.source_page}-д: ${f.expression}. Энэ томьёо детерминист хөдөлгүүрт хараахан баталгаажин ороогүй тул би өөрөө тооцохгүй — оролтын утгуудаа өгвөл хөдөлгүүр бэлэн болмогц тооцно; тэр хүртэл эх сурвалжийг үзнэ үү: ${meta.source_url}.` },
      ],
      meta: { kind: 'compute_examples', document: meta.canonical_code, formula_id: f.formula_id, executable: false, note: 'regenerate when the formula is transcribed and registered in backend/src/lib/mglai/norm' },
    });
  }
}
for (const c of routerCases.filter((c) => c.expected_intent !== 'NORM_LOOKUP_ONLY')) {
  tool.push({
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: c.query }, { role: 'assistant', content: `intent=${c.expected_intent}; answer_mode=${c.answer_mode}; ${c.must_require_source ? 'require_clause_source=true' : ''}${c.must_use_deterministic_engine ? 'use_deterministic_engine=true' : ''}`.trim() }],
    meta: { kind: 'tool_routing', router_case: c.id },
  });
}

const write = (name, rows) => { const text = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''); writeFileSync(join(OUT, name), text, 'utf8'); return { rows: rows.length, sha256: createHash('sha256').update(text).digest('hex') }; };
const manifest = {
  schema: 'norm-dataset.training_ready/1',
  built_at: new Date().toISOString().slice(0, 10),
  status: 'REVIEW_REQUIRED — not used for training',
  files: {
    'registry_router.jsonl': write('registry_router.jsonl', router),
    'grounded_qa.jsonl': write('grounded_qa.jsonl', grounded),
    'citation_behavior.jsonl': write('citation_behavior.jsonl', citation),
    'tool_routing.jsonl': write('tool_routing.jsonl', tool),
    'compute_examples.jsonl': write('compute_examples.jsonl', compute),
  },
  policy: ['facts stay in retrieval; regenerate after any registry/clause change', 'grounded answers are verbatim clause text with a citation line', 'no example contains a number that is not in the cited clause', 'dataset_lint.py + training-lint must pass before any run'],
};
writeFileSync(join(OUT, 'MANIFEST.json'), JSON.stringify(manifest, null, 2), 'utf8');
process.stdout.write(`${JSON.stringify(Object.fromEntries(Object.entries(manifest.files).map(([k, v]) => [k, v.rows])))}\n`);
