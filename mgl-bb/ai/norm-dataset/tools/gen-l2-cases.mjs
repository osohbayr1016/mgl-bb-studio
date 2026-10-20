#!/usr/bin/env node
/**
 * L2 ҮНЭЛГЭЭНИЙ КЕЙС ҮҮСГЭГЧ — `documents/<Doc>/tests/l2_cases.jsonl` (2026-09-18, БНбД 31-17-10).
 *
 *   node ai/norm-dataset/tools/gen-l2-cases.mjs norm-dataset/documents/BNbD_31-17-10
 *
 * Гараар бичсэн кейс (доорх MANUAL) + L2 бичлэгээс ДЕТЕРМИНИСТ түүвэрлэсэн кейс (seed-тэй PRNG): яг заалт, өгүүлбэрээр
 * (paraphrase) хайлт, хэсэг, тоо хадгалалт, хүрээний хэсгүүд (нөхцөл/онцгой/хориглол/субъект/ишлэл), буруу заалт руу
 * татагдах, follow-up.  Кейс бүр `category` + `expect` (retrieval ба тайлбарын чанар ТУСДАА хэмжигдэнэ — runner).
 * ⚠️ Хүлээгдэх утга бүр L2 бичлэгээс (эх бичвэрээс) — зохиосон хүлээлт байхгүй.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? '');
const recs = readFileSync(join(dir, 'l2', 'clause_explanations.jsonl'), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const sections = readFileSync(join(dir, 'l2', 'section_explanations.jsonl'), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const code = recs[0].norm_code;
const body = recs.filter((r) => r.scope === 'body');
const byUid = new Map(recs.map((r) => [r.clause_uid, r]));

let seed = 20260918;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (arr, n) => { const a = [...arr]; const out = []; while (out.length < n && a.length) out.push(a.splice(Math.floor(rnd() * a.length), 1)[0]); return out; };

const cases = [];
let n = 0;
const add = (category, query, expect, extra = {}) => cases.push({ id: `L2-${String(++n).padStart(3, '0')}`, category, query, expect, ...extra });
const ref = (r) => (r.scope === 'appendix' ? `${code}-ын ${r.appendix}-р хавсралтын ${r.clause_id} заалт` : `${code}-ын ${r.clause_id} заалт`);
const exact = (r, extra = {}) => ({ mode: 'exact_clause', clause_uid: r.clause_uid, doc: code, page: r.source.page, has_url: true, ...extra });

/* ── Баримтын гар кейс — `documents/<Doc>/tests/l2_manual_cases.mjs` (байвал) ─────────────────────── */
const docExpl = JSON.parse(readFileSync(join(dir, 'l2', 'document_explanation.json'), 'utf8'));
const sem = (name, uid, candidate, verdict, codeWanted = null) => add(`semantic_${name}`, `[verifier] ${uid}`, { verifier: true, clause_uid: uid, candidate, verdict, ...(codeWanted ? { code: codeWanted } : {}) });
const fu = (clause, q, uid) => add('follow_up', q, exact(byUid.get(uid)), { prior: { documentCode: code, lastClause: clause } });
const manualPath = join(dir, 'tests', 'l2_manual_cases.mjs');
if (existsSync(manualPath)) {
  const mod = await import(pathToFileURL(manualPath).href);
  mod.default({ code, recs, sections, byUid, add, exact, ref, sem, fu, cases, docExpl, dir, pick, rnd, body, readJsonl: (p) => readFileSync(p, 'utf8').split(String.fromCharCode(10)).filter((l) => l.trim()).map((l) => JSON.parse(l)) });
}

// Детерминист fallback БҮГД PASS байх ёстой — түүвэр 10
for (const r of pick(recs, 10)) sem('fallback_pass', r.clause_uid, r.plain_mn_fallback, 'PASS');
// Программчилсан мутаци: бодит заалтын үгүйсгэл/модалийг урвуулна → FAIL (шалгагч ерөнхий байдлаар барина)
const flipNeg = (t) => t.replace(/ёсгүй\.\s*$/u, 'ёстой.').replace(/болохгүй\.\s*$/u, 'болно.').replace(/(\p{L}+)хгүй\.\s*$/u, '$1нэ.');
const negSrc = recs.filter((r) => r.scope === 'body' && /(?:хгүй|гүй)\.\s*$/u.test(r.source_text.trim()) && r.source_text.length < 260);
for (const r of pick(negSrc, 6)) { const m = flipNeg(r.source_text.trim()); if (m !== r.source_text.trim()) sem('negation_reversal', r.clause_uid, m, 'FAIL'); }
// Тоон мутаци: ганц тоотой заалт, ШИНЭ тоо нь эхэд огт байхгүй (эс тэгвэл шалгагч эхийн өөр тоотой андуурч болно — тэр нь мутацийн алдаа).

const oblSrc = recs.filter((r) => r.scope === 'body' && /ёстой\.\s*$/u.test(r.source_text.trim()) && r.source_text.length < 260 && !/болно/u.test(r.source_text));
for (const r of pick(oblSrc, 6)) sem('obligation_to_permission', r.clause_uid, r.source_text.trim().replace(/байх ёстой\.\s*$/u, 'байж болно.').replace(/ёстой\.\s*$/u, 'болно.'), 'FAIL');
const numSrc = recs.filter((r) => r.numeric_literals.length === 1 && /^\d+$/.test(r.numeric_literals[0].value ?? '') && r.source_text.length < 300 && !new RegExp(`(?<![\\d.])${Number(r.numeric_literals[0].value) + 1}(?![\\d.])`).test(r.source_text));
for (const r of pick(numSrc, 6)) { const n = r.numeric_literals[0]; sem('numeric_value', r.clause_uid, r.source_text.trim().replace(n.literal, n.literal.replace(n.value, String(Number(n.value) + 1))), 'FAIL', 'WRONG_NUMBER'); }
const condSrc = recs.filter((r) => r.scope === 'body' && /^[^.]{10,120}?(?:нөхцөлд|тохиолдолд|үед|бол)\s+[^.]{10,}\.\s*$/u.test(r.source_text.trim()) && r.source_text.length < 240);
for (const r of pick(condSrc, 6)) sem('lost_condition', r.clause_uid, r.source_text.trim().replace(/^[^.]{10,120}?(?:нөхцөлд|тохиолдолд|үед|бол)\s+/u, '').replace(/^\p{Ll}/u, (ch) => ch.toUpperCase()), 'FAIL');

/* ── Түүвэрлэсэн кейс ─────────────────────────────────────────────── */
const manualUids = new Set(cases.map((c) => c.expect.clause_uid).filter(Boolean));
const pool = body.filter((r) => !manualUids.has(r.clause_uid) && r.source_text.length > 60);
for (const r of pick(pool, 18)) add('exact_clause', `${ref(r)} юу гэж заасан бэ?`, exact(r));
for (const r of pick(recs.filter((x) => x.scope === 'appendix' && !manualUids.has(x.clause_uid)), 6)) add('exact_clause', `${ref(r)}`, exact(r));
for (const r of pick(pool.filter((x) => x.numeric_literals.length >= 2), 8)) add('number_preservation', `${ref(r)}-д ямар тоо байна?`, exact(r, { numbers: r.numeric_literals.map((x) => x.literal) }));
for (const r of pick(pool.filter((x) => x.semantic_frame.conditions.length > 0 && x.requirement_type !== 'scope'), 5)) add('conditions', `${ref(r)} ямар нөхцөлд хамаарах вэ?`, exact(r, { has_sections: ['Хэзээ хамаарах'], frame_lines_in_source: true }));
for (const r of pick(pool.filter((x) => x.semantic_frame.exceptions.length > 0), 4)) add('exceptions', `${ref(r)} онцгой нөхцөл байгаа юу?`, exact(r, { has_sections: ['Онцгой нөхцөл'], frame_lines_in_source: true }));
for (const r of pick(pool.filter((x) => x.requirement_type === 'prohibition'), 5)) add('prohibitions', `${ref(r)} юуг хориглодог вэ?`, exact(r, { has_sections: ['Хориглосон'], frame_lines_in_source: true }));
for (const r of pick(pool.filter((x) => x.semantic_frame.subject.length > 0 && x.semantic_frame.subject[0].length > 12), 4)) add('subject', `${ref(r)} хэнд / юунд хамаарах вэ?`, exact(r, { has_sections: ['Хэнд / юунд хамаарах'], contains: [r.semantic_frame.subject[0].slice(0, 30)] }));
for (const r of pick(pool.filter((x) => x.semantic_frame.cross_references.some((c) => c.kind === 'document')), 4)) add('cross_references', `${ref(r)} ямар норм иш татсан бэ?`, exact(r, { contains: [r.semantic_frame.cross_references.find((c) => c.kind === 'document').target] }));
// Paraphrase — субъектийн хэллэг + асуултын үг (баримт нэрлэсэн: цоож + nearest)
const para = pick(pool.filter((x) => x.semantic_frame.subject.length > 0 && x.semantic_frame.subject[0].split(' ').length >= 3 && x.semantic_frame.subject[0].split(' ').length <= 8), 14);
for (const r of para) {
  const subj = r.semantic_frame.subject[0].replace(/[,;:.]+$/u, '');
  add('paraphrase', `${code}-д ${subj} тухай юу заасан бэ?`, { mode_any: ['nearest_clause', 'exact_clause'], clause_uid: r.clause_uid, doc: code, page: r.source.page, has_url: true, soft: true });
}
// Тайлбар-урт кейс: 3 түвшний заалт
for (const r of pick(body.filter((x) => x.clause_id.split('.').length === 3 && !manualUids.has(x.clause_uid)), 3)) add('exact_clause', `${ref(r)}`, exact(r));

mkdirSync(join(dir, 'tests'), { recursive: true });
const out = join(dir, 'tests', 'l2_cases.jsonl');
writeFileSync(out, cases.map((c) => JSON.stringify(c)).join('\n') + '\n', 'utf8');
const byCat = {};
for (const c of cases) byCat[c.category] = (byCat[c.category] ?? 0) + 1;
process.stdout.write(`L2 кейс ${cases.length} → ${out}\n  ${JSON.stringify(byCat)}\n`);
