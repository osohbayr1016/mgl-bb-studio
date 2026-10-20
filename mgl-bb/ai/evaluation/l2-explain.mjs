#!/usr/bin/env node
/**
 * `npm run ai:eval:l2 [-- --db <зам>] [--doc BNbD_31-17-10] [--json <гаралт>]`
 *
 * L2 НОРМ ОЙЛГОХ ДАВХАРГЫН ҮНЭЛГЭЭ — `documents/<Doc>/tests/l2_cases.jsonl` (≥100 кейс) бүрийг БОДИТ гинжээр:
 *   askNorm (retrieval + баримтын цоож) → explainForAnswer (L2 бичлэг) → Worker parse (цагаан жагсаалт) →
 *   тооцооны хаалга → рендер (хариултын хэлбэр) → гэрээ (templateOnly).
 *
 * ХЭМЖҮҮР ХОЁР ТУСДАА БҮЛЭГ (эзний шаардлага):
 *   retrieval  — зөв горим / зөв баримт / зөв заалт / цоож / гоожилт / буруу заалт татагдаагүй / хаалга
 *   explanation — шаардлагатай хэсгүүд, хүрээний мөр бүр эх бичвэрт, тоо ЭХИЙН хэлбэрээр, эх сурвалж (URL+хуудас),
 *                 зохиомол тоо (эх+хуудасны тооноос гадуур) 0, зохиомол үндэслэл 0
 * ХАТУУ ШААРДЛАГА (нэг ч зөрчил = FAIL): зохиомол заалт/тоо/онцгой нөхцөл 0 · хөндлөн гоожилт 0 · эх сурвалж 100 % ·
 *   нэрлэсэн заалтын баримтын цоож 100 %.
 *
 * ⚠️ Өгөгдмөл сан = :memory: багц (31-17-10 + l2).  `--db` өгвөл бодит ажилтны сангийн ХУУЛБАР (11 багц) — гоожилтын
 *    кейс тэнд л утгатай.  Загвар (Qwen) ЭНД ОРОЛЦОХГҮЙ — L2 хариулт бүхэлдээ детерминист.
 */
import { resolve, dirname, join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { openKnowledgeDb } from '../retrieval/src/db.ts';
import { ingestDataset } from '../retrieval/src/ingest.ts';
import { askNorm } from '../retrieval/src/pipeline.ts';
import { explainForAnswer } from '../retrieval/src/explain.ts';
import { verifyExplanation } from '../norm-dataset/tools/l2-semantic.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 ? (argv[i + 1] ?? d) : d; };
const docName = arg('--doc', 'BNbD_31-17-10');
const DOC_DIR = join(HERE, '..', 'norm-dataset', 'documents', docName);
const CASES = join(DOC_DIR, 'tests', 'l2_cases.jsonl');
const dbArg = arg('--db');
const jsonOut = arg('--json', join(HERE, 'reports', `l2-explain-${docName}-${new Date().toISOString().slice(0, 10)}.json`));

// Worker тал — бодит замаар (backend/src/lib/mglai/normExplain.ts; type-only import л тул Node шууд ачаална).
const NE = await import(`file:///${join(HERE, '..', '..', 'backend', 'src', 'lib', 'mglai', 'normExplain.ts').replace(/\\/g, '/')}`);

let db;
let dbLabel;
if (dbArg) {
  db = new DatabaseSync(resolve(dbArg), { readOnly: true });
  dbLabel = resolve(dbArg);
} else {
  db = openKnowledgeDb({ path: ':memory:' });
  ingestDataset(db, join(DOC_DIR, 'pack'));
  dbLabel = ':memory: (pack + l2)';
}
const docCount = db.prepare('SELECT COUNT(*) AS n FROM ai_documents').get().n;
const readJsonl = (p) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
const l2 = readJsonl(join(DOC_DIR, 'l2', 'clause_explanations.jsonl'));
const byUid = new Map(l2.map((r) => [r.clause_uid, r]));
// L2 (2026-09-23): хүснэгт / томьёо / албан тайлбарын эх — үнэлгээ рендерийг ЭДГЭЭРТЭЙ тулгана (зохиомол нүд/тоо/тайлбар).
const tablesByNo = new Map(readJsonl(join(DOC_DIR, 'l2', 'table_explanations.jsonl')).map((t) => [t.table_no, t]));
const formulasByLabel = new Map(readJsonl(join(DOC_DIR, 'l2', 'formula_explanations.jsonl')).map((f) => [f.label, f]));
const commentaryUnits = readJsonl(join(DOC_DIR, 'commentary', 'parsed', 'commentary.jsonl'));
const D = NE.decodeSymbolPua;
const cases = readJsonl(CASES);
// Бүртгэл (L0) — хуучин код → залгамж шалгалтад; :memory: санд бүртгэл байхгүй бол алгасна (кейс «registry» гэж тэмдэглэгдэнэ).
const REG = await import('../retrieval/src/registry.ts');
const TR = await import('../retrieval/src/topicRouter.ts');
const hasRegistry = (() => { try { return (REG.registryCount(db)?.norms ?? 0) > 0; } catch { return false; } })();

const numsOf = (t) => new Set([...t.replace(/https?:\S+/g, ' ').replace(/(?:БНбД|БНОД|БД|УББ|MNS|СНиП)\s*[\d\-–.*/]+/giu, ' ').replace(/(?<![\d.])\d+(?:\.\d+)+(?![\d.])/g, ' ').matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => m[0].replace(',', '.')));
const RATIONALE = /(?<![\p{L}])(учир нь|яагаад гэвэл|шалтгаан нь|үндэслэл нь|аюулгүй байдлын үүднээс|зорилго нь|because|the reason)(?![\p{L}])/iu;
const baseContract = () => ({ version: 'tfc-2', answerMode: 'grounded', risk: 'high', facts: [], allowedNumbers: null, allowedCategories: null, requiredSentence: null, trailerText: null, requiredCitations: [], noMatch: false, forbiddenPhrases: [], template: 'BASE', taskIndex: null, legacyKind: 'free', reason: 'eval', norm: null });

const V = { total: 0, correct: 0, reversal_missed: 0, false_fail: 0 };
// L2 (2026-09-23) нэмэлт хэмжүүр: хүснэгт/томьёо/ангилал/тайлбар/хуучин код/чиглүүлэгч.
const X = { table_total: 0, table_ok: 0, fabricated_table_cells: 0, fabricated_values: 0, fabricated_units: 0, formula_total: 0, formula_ok: 0, fabricated_variables: 0, formula_executed: 0, class_total: 0, class_ok: 0, category_mix: 0, commentary_blocks: 0, commentary_faithful: 0, commentary_as_norm: 0, legacy_total: 0, legacy_ok: 0, old_current_confusion: 0, router_total: 0, router_ok: 0 };
const R = { total: 0, mode_correct: 0, doc_correct: 0, clause_correct: 0, lock_ok: 0, lock_total: 0, leak: 0, wrong_clause: 0, gate_ok: 0, gate_total: 0, null_ok: 0, null_total: 0, currentness_ok: 0, currentness_total: 0, follow_up_ok: 0, follow_up_total: 0, paraphrase_soft_ok: 0, paraphrase_total: 0 };
const E = { rendered: 0, sections_ok: 0, frame_in_source: 0, frame_total: 0, numbers_preserved: 0, numbers_total: 0, fabricated_numbers: 0, fabricated_rationale: 0, source_url: 0, page_cited: 0, contains_ok: 0, contains_total: 0 };
const failures = [];
let skipped = 0;
const byCategory = {};
const examples = [];

for (const c of cases) {
  R.total += 1;
  const cat = (byCategory[c.category] ??= { total: 0, pass: 0 });
  cat.total += 1;
  const problems = [];
  const ex = c.expect;
  // ── L2.1 семантик шалгагчийн кейс (retrieval биш): нэр дэвшигч → PASS/FAIL, код ──
  if (ex.verifier) {
    V.total += 1;
    const rec = byUid.get(ex.clause_uid);
    if (!rec) problems.push(`бичлэг алга ${ex.clause_uid}`);
    else {
      const v = verifyExplanation({ sourceText: rec.source_text, candidate: ex.candidate, clauseUid: ex.clause_uid, subject: rec.semantic_frame.subject, normCode: rec.norm_code });
      const got = [...new Set(v.failures.map((f) => f.code))];
      if (v.verdict !== ex.verdict) {
        problems.push(`verdict ${v.verdict} ≠ ${ex.verdict} (${got.join(',') || 'кодгүй'})`);
        if (ex.verdict === 'FAIL') { V.reversal_missed += 1; problems.push('УТГЫН УРВУУЛАЛТ АЛДАГДАВ'); } else V.false_fail += 1;
      } else if (ex.code && !got.includes(ex.code)) problems.push(`код ${ex.code} хүлээсэн, ирсэн ${got.join(',')}`);
      else V.correct += 1;
    }
    const pass = problems.length === 0;
    if (pass) cat.pass += 1; else failures.push({ id: c.id, category: c.category, query: c.query, problems, hard: problems.some((p) => /УРВУУЛАЛТ/.test(p)) });
    continue;
  }
  // Олон баримттай сан шаардсан кейс (хуучин код, гоожилт, 31-17-10 ↔ 20-04-17) — нэг багцтай :memory: санд АЛГАСНА (ил тоологдоно).
  if (ex.needs_corpus && docCount < 2) { cat.skipped = (cat.skipped ?? 0) + 1; cat.pass += 1; skipped += 1; continue; }
  // ── L2 (2026-09-23): L0/L1 шалгалт (тайлбар биш) — хуучин код → залгамж, сэдвийн чиглүүлэгч ──
  if (ex.registry_superseded) {
    X.legacy_total += 1;
    if (!hasRegistry) problems.push('бүртгэлгүй сан — алгасав');
    else {
      const m = REG.lookupRegistryCode(db, ex.registry_superseded.code);
      if (m && m.status === 'SUPERSEDED' && m.superseded_by === ex.registry_superseded.superseded_by) X.legacy_ok += 1;
      else { X.old_current_confusion += 1; problems.push(`ХУУЧИН/ОДООГИЙН ЗӨРҮҮ: ${ex.registry_superseded.code} → ${m?.status ?? 'алга'} ${m?.superseded_by ?? ''}`); }
    }
    if (!ex.query_too) { const pass = problems.length === 0; if (pass) cat.pass += 1; else failures.push({ id: c.id, category: c.category, query: c.query, problems, hard: problems.some((p) => /ХУУЧИН/.test(p)) }); continue; }
  }
  if (ex.router_includes) {
    X.router_total += 1;
    const r = hasRegistry ? TR.routeTopics(db, c.query) : null;
    const codes = new Set((r?.results ?? []).map((x) => x.code));
    const reg = hasRegistry ? REG.searchRegistry(db, c.query, { limit: 8 }).matches.map((m) => m.code) : [];
    for (const x of reg) codes.add(x);
    const miss = ex.router_includes.filter((k) => !codes.has(k));
    if (!hasRegistry) problems.push('бүртгэлгүй сан — алгасав');
    else if (miss.length === 0) X.router_ok += 1;
    else problems.push(`чиглүүлэгч: дутуу ${miss.join(', ')}`);
    const pass = problems.length === 0;
    if (pass) cat.pass += 1; else failures.push({ id: c.id, category: c.category, query: c.query, problems, hard: false });
    continue;
  }
  // follow-up: turnEngine.followUpNormQuery-тэй ИЖИЛ угтвар (backend/src/lib/mglai/norm/turnEngine.ts).
  const namesClause = /(?<![\d.])\d+(?:\.\d+)+(?![\d.])/u.test(c.query);
  const query = c.prior ? `${c.prior.documentCode}${!namesClause && c.prior.lastClause ? `-ын ${c.prior.lastClause} заалт` : ''}: ${c.query}` : c.query;
  let answer;
  let block = null;
  let view = null;
  let rendered = null;
  let contract = null;
  try {
    answer = askNorm(db, query, { evidenceLimit: 5 });
    block = explainForAnswer(db, answer, query);
    view = block ? NE.parseLocalNormExplanation(block) : null;
    if (view) {
      contract = NE.withExplanation(baseContract(), view, 'mn-Cyrl', c.query);
      rendered = contract.templateOnly ? contract.template : null;
    }
  } catch (err) {
    problems.push(`алдаа: ${err.message}`);
  }
  const gate = view ? NE.isComputationAsk(c.query) : NE.isComputationAsk(c.query);

  /* ── retrieval ── */
  if (ex.gate === 'no_compute') {
    R.gate_total += 1;
    if (gate && (contract === null || contract.templateOnly !== true) && (contract === null || String(contract.trailerText).includes(NE.L2_NO_COMPUTE_MN))) R.gate_ok += 1;
    else if (gate && contract === null) R.gate_ok += 1;
    else problems.push(`тооцооны хаалга: gate=${gate} templateOnly=${contract?.templateOnly}`);
  }
  if (ex.explanation_null) {
    R.null_total += 1;
    if (block === null) R.null_ok += 1;
    else problems.push(`тайлбар байх ёсгүй, ирсэн: ${block.mode} ${block.clause?.clause_uid ?? ''}`);
    if (ex.no_match && answer?.no_match_reason !== ex.no_match) problems.push(`no_match_reason ${answer?.no_match_reason} ≠ ${ex.no_match}`);
  }
  if (ex.not_doc) {
    const leaked = block !== null && (block.document.code === ex.not_doc || JSON.stringify(block).includes(ex.not_doc)) || (answer?.evidence ?? []).some((e) => e.code === ex.not_doc);
    if (leaked) { R.leak += 1; problems.push(`ГООЖИЛТ: ${ex.not_doc} өөр баримтын асуултад`); }
  }
  if (ex.lock) {
    R.lock_total += 1;
    const evid = answer?.evidence ?? [];
    const ok = evid.every((e) => e.code === ex.lock) && (block === null || block.document.code === ex.lock);
    if (ok) R.lock_ok += 1; else { R.leak += 1; problems.push(`цоож зөрчигдөв: ${[...new Set(evid.map((e) => e.code))].join(',')}`); }
  }
  if (ex.mode || ex.mode_any) {
    const want = ex.mode_any ?? [ex.mode];
    const got = block?.mode ?? null;
    const defOk = got === 'definition' && c.category === 'paraphrase' && block?.definition?.clause && ex.clause_uid === `${block.document.code}#${block.definition.clause}`;
    if (want.includes(got) || defOk) R.mode_correct += 1; else problems.push(`горим ${got} ∉ ${want.join('|')}`);
  }
  if (ex.doc) {
    if (block?.document.code === ex.doc) R.doc_correct += 1; else problems.push(`баримт ${block?.document.code} ≠ ${ex.doc}`);
    if (block && block.document.code !== ex.doc) R.leak += 1;
  }
  if (ex.clause_uid) {
    // Нэр томьёоны заалт (20-04-17-ийн 3.1.N) — definition горим нь тэр заалтын ижил эх бичвэр; заалт гэж тооцно.
    const defClause = block?.mode === 'definition' && block.definition?.clause ? `${block.document.code}#${block.definition.clause}` : null;
    const got = block?.clause?.clause_uid ?? defClause ?? null;
    if (c.category === 'paraphrase') {
      R.paraphrase_total += 1;
      const inCands = got === ex.clause_uid || (block?.candidates ?? []).some((k) => k.clause_uid === ex.clause_uid);
      if (got === ex.clause_uid) R.paraphrase_soft_ok += 1; else if (inCands) { R.paraphrase_soft_ok += 1; problems.push(`paraphrase: толгой ${got}, зорилт нэр дэвшигчид`); } else problems.push(`paraphrase: ${got} ≠ ${ex.clause_uid}`);
    } else if (got === ex.clause_uid) R.clause_correct += 1;
    else problems.push(`заалт ${got} ≠ ${ex.clause_uid}`);
    if (ex.not_clause && got && ex.not_clause.some((n) => got.endsWith(`#${n}`))) { R.wrong_clause += 1; problems.push(`буруу заалт татагдав ${got}`); }
    if (ex.ambiguity && !block?.ambiguity) problems.push('давхардлын тэмдэглэл алга');
  }
  if (ex.section) {
    if (block?.section?.section === ex.section) R.clause_correct += 1; else problems.push(`хэсэг ${block?.section?.section} ≠ ${ex.section}`);
  }
  if (ex.definition_term) {
    if (block?.mode === 'definition' && block.definition?.term === ex.definition_term) R.clause_correct += 1; else problems.push(`нэр томьёо ${block?.definition?.term ?? block?.mode} ≠ ${ex.definition_term}`);
  }
  if (ex.unresolved_target && block?.clause) {
    const x = block.clause.semantic_frame.cross_references.find((r) => r.target === ex.unresolved_target);
    if (!x || x.resolution !== 'unresolved' || x.target_uid) { R.leak += 1; problems.push(`шийдэгдээгүй ишлэл ${ex.unresolved_target} холбогдчихов: ${JSON.stringify(x)}`); }
  }
  if (ex.currentness_routed) {
    R.currentness_total += 1;
    if (block === null || block.currentness_routed) R.currentness_ok += 1; else problems.push('currentness_routed туг алга');
    if (rendered && ex.not_contains_render?.some((s) => rendered.includes(s))) problems.push('рендер төлөвийн үг агуулна (L2 төлөв хэлэхгүй)');
  }
  if (c.category === 'follow_up') { R.follow_up_total += 1; if (block?.clause?.clause_uid === ex.clause_uid) R.follow_up_ok += 1; }

  /* ── L2 (2026-09-23): хүснэгт / томьёо / ангилал / тайлбар — горим тус бүрийн үнэнч байдал ── */
  if (ex.mode_is && block?.mode !== ex.mode_is) problems.push(`горим ${block?.mode ?? null} ≠ ${ex.mode_is}`);
  if (ex.not_mode && block?.mode === ex.not_mode) problems.push(`ЗОХИОМОЛ ${ex.not_mode}: эх бичвэрт байхгүй зүйлд ${ex.not_mode} горим гарав`);
  if (ex.not_contains_render && !ex.currentness_routed && rendered) { const bad = ex.not_contains_render.filter((x) => rendered.includes(x)); if (bad.length > 0) problems.push(`рендерт байх ёсгүй: ${bad.join(', ')}`); }
  if (rendered && block?.mode === 'table' && block.table) {
    X.table_total += 1;
    const t = tablesByNo.get(block.table.table_no) ?? block.table;
    const cellBag = D([...t.rows.flatMap((r) => r.cells), ...t.header_rows.flat(), ...t.columns.map((c) => c.header_text ?? ''), ...t.notes].join(' ⁞ ')).replace(/\s+/g, ' ');
    const allowedNums = numsOf(`${cellBag} ${t.table_no} ${t.referring_clauses.map((r) => D(r.text)).join(' ')} ${t.clause_context ?? ''}`);
    const blocks = rendered.split('\n\n');
    // «Мөр» bullet бүрийн « — » дараах утга нь хүснэгтийн нүдэнд ЯГ байх ёстой.
    const rowBlock = blocks.find((b) => b.startsWith('**Асуулттай таарсан мөр**') || b.startsWith('**Мөрүүд**') || b.startsWith('**Rows'));
    let tableOk = true;
    for (const l of (rowBlock ?? '').split('\n').filter((x) => x.startsWith('• '))) {
      const vals = l.replace(/\s_\(.*?\)_$/u, '').split(' — ').slice(1).join(' — ').split(' | ').map((v) => v.trim()).filter(Boolean);
      for (const v of vals) if (!cellBag.includes(v)) { X.fabricated_table_cells += 1; tableOk = false; problems.push(`ЗОХИОМОЛ НҮД: «${v}»`); }
    }
    const content = blocks.filter((b) => !b.startsWith('**Эх сурвалж') && !b.startsWith('**Энэ хүснэгтийг иш татсан') && !b.startsWith('_')).join('\n').replace(/^\*\*[^\n]*\*\*/u, '');
    const fab = [...numsOf(content)].filter((n) => !allowedNums.has(n));
    if (fab.length > 0) { X.fabricated_values += 1; tableOk = false; problems.push(`ЗОХИОМОЛ ТОО (хүснэгт): ${fab.join(', ')}`); }
    for (const m of rendered.matchAll(/нэгж \(толгойд бичсэнээр\): ([^\n]+)/gu)) if (!cellBag.includes(m[1].trim())) { X.fabricated_units += 1; tableOk = false; problems.push(`ЗОХИОМОЛ НЭГЖ: ${m[1]}`); }
    if (ex.table_no && block.table.table_no !== ex.table_no) { tableOk = false; problems.push(`хүснэгт ${block.table.table_no} ≠ ${ex.table_no}`); }
    for (const rv of ex.row_values ?? []) {
      const line = (rowBlock ?? '').split('\n').find((l) => l.includes(rv.label) && l.includes(rv.value));
      if (!line) { tableOk = false; problems.push(`мөр/утга алга: «${rv.label}» → «${rv.value}»`); }
    }
    for (const bad of ex.not_row_values ?? []) if ((rowBlock ?? '').split('\n').some((l) => l.includes(bad.label) && l.includes(bad.value))) { tableOk = false; X.fabricated_values += 1; problems.push(`БУРУУ МӨР: «${bad.label}» → «${bad.value}»`); }
    if (ex.unit && !rendered.includes(`нэгж (толгойд бичсэнээр): ${ex.unit}`)) { tableOk = false; problems.push(`нэгж ${ex.unit} алга`); }
    if (!/\[MCIS\]\(https:\/\//.test(rendered) || !/хэвлэмэл х\. \d+/.test(rendered)) { tableOk = false; problems.push('эх сурвалж (URL/хуудас) алга'); }
    if (tableOk) X.table_ok += 1;
  }
  if (rendered && block?.mode === 'formula') {
    X.formula_total += 1;
    let fok = true;
    for (const f of block.formulas) {
      const recF = formulasByLabel.get(f.label) ?? f;
      const clauseText = D(l2.find((r) => r.clause_id === recF.clause_id && r.scope === 'body')?.source_text ?? '');
      for (const v of recF.variable_definitions) if (!clauseText.includes(D(v.definition))) { X.fabricated_variables += 1; fok = false; problems.push(`ЗОХИОМОЛ ХУВЬСАГЧ: ${v.symbol}`); }
      if (ex.variables) for (const sym of ex.variables) if (!recF.variable_definitions.some((v) => D(v.symbol) === sym || v.symbol === sym)) { fok = false; problems.push(`хувьсагч ${sym} алга`); }
    }
    if (ex.formula_label && !block.formulas.some((f) => f.label === ex.formula_label)) { fok = false; problems.push(`томьёо ${ex.formula_label} алга`); }
    // L2 томьёог гүйцэтгэхгүй — «= <тоо>» гэсэн үр дүн эхэд байхгүй бол хатуу алдаа.
    if (/(?:үр дүн|result)\s*[:=]\s*\d/iu.test(rendered)) { X.formula_executed += 1; fok = false; problems.push('ТОМЬЁО ГҮЙЦЭТГЭСЭН'); }
    if (fok) X.formula_ok += 1;
  }
  if (rendered && block?.mode === 'classification' && block.classification) {
    X.class_total += 1;
    let cok = true;
    const got = block.classification.groups.map((g) => g.clause_id);
    for (const g of block.classification.groups) {
      const src = D(l2.find((r) => r.clause_uid === g.clause_uid)?.source_text ?? '');
      for (const it of g.items) if (!src.includes(D(it.text).slice(0, 60))) { cok = false; problems.push(`ЗОХИОМОЛ ЗҮЙЛ: ${g.clause_id} ${it.marker})`); }
    }
    if (ex.class_clauses) {
      const want = [...ex.class_clauses].sort().join(',');
      if ([...new Set(got)].sort().join(',') !== want) { cok = false; problems.push(`ангилал ${[...new Set(got)].join(',')} ≠ ${want}`); }
    }
    for (const bad of ex.not_class_clauses ?? []) if (got.includes(bad)) { X.category_mix += 1; cok = false; problems.push(`АНГИЛАЛ ХОЛИВ: ${bad}`); }
    for (const it of ex.class_items ?? []) if (!block.classification.groups.some((g) => g.clause_id === it.clause && g.items.some((x) => x.marker === it.marker))) { cok = false; problems.push(`зүйл ${it.clause} ${it.marker}) алга`); }
    if (ex.multiple !== undefined && block.classification.multiple_categories !== ex.multiple) { cok = false; problems.push(`олон ангилал ${block.classification.multiple_categories} ≠ ${ex.multiple}`); }
    if (cok) X.class_ok += 1;
  }
  // Албан тайлбарын блок: «(норм биш)» шошготой, ишлэл нь тайлбарын ЭХЭЭС үг үсгээрээ.
  if (rendered) {
    for (const bk of rendered.split('\n\n').filter((b) => b.startsWith('**Албан тайлбар') || b.startsWith('**Official commentary'))) {
      X.commentary_blocks += 1;
      if (!/норм биш|not a norm/u.test(bk.split('\n')[0])) { X.commentary_as_norm += 1; problems.push('ТАЙЛБАР НОРМ МЭТ (шошгогүй)'); }
      const quotes = [...bk.matchAll(/«([^»]{20,})»/gu)].map((m) => m[1].replace(/…$/u, ''));
      const ok = quotes.every((q) => commentaryUnits.some((u) => D(u.text).includes(D(q).slice(0, Math.min(q.length, 200)))));
      if (ok) X.commentary_faithful += 1; else problems.push('ЗОХИОМОЛ ТАЙЛБАР: ишлэл тайлбарын эхэд алга');
    }
    if (ex.commentary === true && !/\*\*Албан тайлбар — /u.test(rendered)) problems.push('албан тайлбарын блок алга');
    if (ex.commentary === false && /\*\*Албан тайлбар — /u.test(rendered)) problems.push('албан тайлбарын блок байх ёсгүй');
    // Тайлбарын бичвэр нормын блок («Энгийнээр», «Эх бичвэр», гол шаардлага) дотор орвол — тайлбарыг норм мэт харуулсан.
    const normBlocks = rendered.split('\n\n').filter((b) => /^\*\*(Энгийнээр|Эх бичвэр|Энэ заалт)/u.test(b)).join('\n');
    // ⚠️ Нормын ӨӨРИЙН бичвэрт ижил өгүүлбэр байвал (1.3 «Тайлбар: Цаашид эх бичгийн дагуу …» нь нормын тэмдэглэл, албан
    //    тайлбар түүнийг давтсан) тайлбар норм мэт БИШ — тэр нь эх бичвэр.
    const ownSrc = D(block?.clause ? (byUid.get(block.clause.clause_uid)?.source_text ?? block.clause.source_text) : '');
    for (const u of commentaryUnits.filter((x) => !x.no_commentary && x.text.length > 80).slice(0, 400)) {
      const probe = D(u.text).slice(0, 80);
      if (normBlocks.includes(probe) && !ownSrc.includes(probe)) { X.commentary_as_norm += 1; problems.push(`ТАЙЛБАР НОРМ МЭТ: ${u.marker}`); break; }
    }
  }
  if (ex.legacy_label && !(rendered ?? '').includes(ex.legacy_label)) { problems.push(`хуучин кодын залгамж алга: «${ex.legacy_label}»`); X.legacy_total += 1; }
  else if (ex.legacy_label) { X.legacy_total += 1; X.legacy_ok += 1; }

  /* ── explanation quality (зөвхөн рендер гарсан кейст) ── */
  if (rendered && block?.clause && (block.mode === 'exact_clause' || block.mode === 'nearest_clause')) {
    E.rendered += 1;
    const rec = byUid.get(block.clause.clause_uid);
    const src = D(rec ? rec.source_text : block.clause.source_text);
    // Шаардлагатай хэсгүүд
    // Тухайлсан асуулт (нөхцөл/онцгой/хэнд/ишлэл) → ЗӨВХӨН тэр хэсэг + эх сурвалж (фокус); бусад = бүтэн хэлбэр.
    const focused = NE.focusOf(c.query).size > 0;
    const needed = ['**Эх сурвалж**', ...(ex.has_sections ?? []).map((s) => `**${s}**`), ...(focused ? [] : ['**Эх бичвэр**', '**Энгийнээр**'])];
    const missing = needed.filter((s) => !rendered.includes(s));
    if (missing.length === 0) E.sections_ok += 1; else problems.push(`хэсэг дутуу: ${missing.join(', ')}`);
    // Блок бүрээр: хаягийн блок (толгой, гарчгийн зам, «Мөн үзэх», «Эх сурвалж», давхардлын тэмдэглэл) нь
    //    заалтын АГУУЛГА биш — дугаар/хуудас агуулна; агуулгын блокийн мөр бүр эх бичвэрт, тоо нь эх+ишлэлээс.
    const blocks = rendered.split('\n\n');
    const isAddress = (bk) => bk.startsWith(`**${block.clause.norm_code} —`) || bk.startsWith('_') || bk.startsWith('**Мөн үзэх**') || bk.startsWith('**Эх сурвалж**') || bk.startsWith('**Холбогдох**') || bk.startsWith('**Яагаад**') || bk.startsWith('**Хамаарах уу') || bk.startsWith('**Албан тайлбар') || bk.startsWith('**Official commentary');
    const plainBlock = blocks.find((x) => x.startsWith('**Энгийнээр**'));
    if (plainBlock) {
      const body = plainBlock.replace(/^\*\*Энгийнээр\*\*\n/u, '');
      const recFull = byUid.get(block.clause.clause_uid);
      const expected = recFull?.status?.semantic_validation === 'PASS' && recFull?.status?.human_review === 'APPROVED' && recFull.plain_mn_candidate ? recFull.plain_mn_candidate : recFull?.plain_mn_fallback;
      if (expected && body !== D(expected)) problems.push('«Энгийнээр» нь PASS нэр дэвшигч/fallback-тай таарахгүй');
      if (recFull?.status?.semantic_validation !== 'PASS' && recFull?.plain_mn_candidate) problems.push('FAIL нэр дэвшигч бичлэгт үлдсэн');
      // Нэр дэвшигч харуулагдсан бол шалгагчаар ДАХИН PASS байх ёстой (үйлчилгээний хаалт).
      if (recFull && expected === recFull.plain_mn_candidate) {
        const v = verifyExplanation({ sourceText: recFull.source_text, candidate: body, clauseUid: recFull.clause_uid, subject: recFull.semantic_frame.subject, normCode: recFull.norm_code });
        if (v.verdict !== 'PASS') problems.push(`ЗОХИОМОЛ МӨР: нэр дэвшигч шалгагчаар унав ${v.failures.map((f) => f.code).join(',')}`);
      }
    }
    for (const bk of blocks.filter((x) => !isAddress(x) && !x.startsWith('**Энгийнээр**'))) {
      for (const l of bk.split('\n').filter((x) => x.startsWith('• '))) {
        const probe = l.slice(2).replace(/^(?:Зөвшөөрсөн|Хориглосон): /u, '').replace(/…$/, '');
        E.frame_total += 1;
        if (src.includes(probe.slice(0, Math.min(probe.length, 80)))) E.frame_in_source += 1; else problems.push(`ЗОХИОМОЛ МӨР: «${probe.slice(0, 50)}»`);
      }
    }
    // Тоо: агуулгын блокуудын тоо ⊆ эх бичвэр (+ ишлэлийн хаяг); хаягийн блок тооцохгүй.
    const allowed = numsOf(src);
    for (const x of block.clause.semantic_frame?.cross_references ?? []) for (const n of numsOf(String(x.target))) allowed.add(n);
    const content = blocks.filter((x) => !isAddress(x) && !x.startsWith('**Энгийнээр**')).join('\n');
    const fabricated = [...numsOf(content)].filter((n) => !allowed.has(n));
    if (fabricated.length > 0) { E.fabricated_numbers += 1; problems.push(`ЗОХИОМОЛ ТОО: ${fabricated.join(', ')}`); }
    if (ex.numbers) {
      E.numbers_total += 1;
      const miss = ex.numbers.filter((x) => !rendered.includes(x));
      if (miss.length === 0) E.numbers_preserved += 1; else problems.push(`тоо алдагдав: ${miss.join(', ')}`);
    }
    if (RATIONALE.test(rendered)) { E.fabricated_rationale += 1; problems.push('зохиомол үндэслэл'); }
    if (/\[MCIS\]\(https:\/\//.test(rendered)) E.source_url += 1; else problems.push('эх сурвалжийн URL алга');
    if (/хэвлэмэл х\. \d+/.test(rendered)) E.page_cited += 1; else problems.push('хуудас алга');
    if (!rendered.includes(block.clause.norm_code)) problems.push('код алга');
  }
  if (rendered && (block?.mode === 'table' || block?.mode === 'formula' || block?.mode === 'classification')) {
    E.rendered += 1; E.sections_ok += 1;
    if (/\[MCIS\]\(https:\/\//.test(rendered)) E.source_url += 1; else problems.push('эх сурвалжийн URL алга');
    if (/хэвлэмэл х\. \d+/.test(rendered)) E.page_cited += 1; else problems.push('хуудас алга');
    if (!rendered.includes(block.document.code)) problems.push('код алга');
    if (RATIONALE.test(rendered.split('\n\n').filter((b) => !b.startsWith('**Албан тайлбар')).join('\n'))) { E.fabricated_rationale += 1; problems.push('зохиомол үндэслэл'); }
  }
  if (rendered && block?.mode === 'definition') {
    E.rendered += 1; E.sections_ok += 1;
    if (/\[MCIS\]\(https:\/\//.test(rendered)) E.source_url += 1; else problems.push('эх сурвалжийн URL алга');
    if (/хэвлэмэл х\. \d+/.test(rendered)) E.page_cited += 1; else problems.push('хуудас алга');
    const def = byUid.size ? null : null; void def;
  }
  if (rendered && (ex.contains || ex.not_contains)) {
    E.contains_total += 1;
    const miss = (ex.contains ?? []).filter((s) => !rendered.includes(s));
    const bad = (ex.not_contains ?? []).filter((s) => rendered.includes(s));
    if (miss.length === 0 && bad.length === 0) E.contains_ok += 1; else problems.push(`агуулга: дутуу ${JSON.stringify(miss)} илүү ${JSON.stringify(bad)}`);
  } else if (ex.contains && !rendered && !ex.explanation_null && ex.gate !== 'no_compute') problems.push('рендер алга (contains шалгах боломжгүй)');
  if (ex.has_url && block?.clause && !/^https:\/\//.test(block.clause.source.url ?? '')) problems.push('L2 бичлэгт https URL алга');

  const hard = problems.filter((p) => /ГООЖИЛТ|ЗОХИОМОЛ|цоож зөрчигдөв|буруу заалт|ХУУЧИН|АНГИЛАЛ ХОЛИВ|ТАЙЛБАР НОРМ|БУРУУ МӨР|ТОМЬЁО ГҮЙЦЭТГЭСЭН/.test(p));
  const soft = ex.soft === true && problems.every((p) => p.startsWith('paraphrase: толгой'));
  const pass = problems.length === 0 || soft;
  if (pass) cat.pass += 1;
  else failures.push({ id: c.id, category: c.category, query: c.query, problems, hard: hard.length > 0 });
  if (examples.length < 6 && rendered && pass && ['exact_clause', 'plain_language', 'follow_up', 'section', 'cross_references', 'exceptions'].includes(c.category) && !examples.some((e) => e.category === c.category)) examples.push({ id: c.id, category: c.category, query: c.query, answer: `${rendered}\n\n${contract.trailerText ?? ''}`.trim() });
}

const pct = (a, b) => (b === 0 ? null : Math.round((a / b) * 1000) / 10);
const hardFailures = failures.filter((f) => f.hard);
const report = {
  schema: 'l2-eval/1',
  generated_at: new Date().toISOString(),
  document: docName,
  db: dbLabel,
  db_documents: docCount,
  cases: cases.length,
  pass: cases.length - failures.length,
  skipped_needs_corpus: skipped,
  fail: failures.length,
  hard_failures: hardFailures.length,
  hard_requirements: {
    fabricated_clauses_numbers_exceptions: E.fabricated_numbers + failures.filter((f) => f.problems.some((p) => p.startsWith('ЗОХИОМОЛ МӨР'))).length,
    semantic_meaning_reversal: V.reversal_missed,
    cross_document_leakage: R.leak,
    source_attribution_pct: pct(Math.min(E.source_url, E.page_cited), E.rendered),
    // Корпусгүй (:memory:) үед алгассан кейс хуваарьт ОРОХГҮЙ — эс тэгвэл «түгжээ 94.8 %» гэсэн хуурамч бууралт гарна.
    named_clause_document_lock_pct: pct(R.doc_correct, cases.filter((c) => c.expect.doc && !(c.expect.needs_corpus && docCount < 2)).length),
    fabricated_table_cells: X.fabricated_table_cells,
    fabricated_values: X.fabricated_values,
    fabricated_units: X.fabricated_units,
    fabricated_formula_variables: X.fabricated_variables,
    formula_executed: X.formula_executed,
    category_mix: X.category_mix,
    commentary_as_norm: X.commentary_as_norm,
    old_current_confusion: X.old_current_confusion,
  },
  l2_objects: { ...X, table_ok_pct: pct(X.table_ok, X.table_total), formula_ok_pct: pct(X.formula_ok, X.formula_total), class_ok_pct: pct(X.class_ok, X.class_total), commentary_faithful_pct: pct(X.commentary_faithful, X.commentary_blocks), legacy_ok_pct: pct(X.legacy_ok, X.legacy_total), router_ok_pct: pct(X.router_ok, X.router_total) },
  semantic_verifier: { ...V, correct_pct: pct(V.correct, V.total) },
  retrieval: { ...R, mode_pct: pct(R.mode_correct, cases.filter((c) => c.expect.mode || c.expect.mode_any).length), clause_pct: pct(R.clause_correct, cases.filter((c) => (c.expect.clause_uid && c.category !== 'paraphrase') || c.expect.section).length), paraphrase_top1_pct: pct(cases.filter((c) => c.category === 'paraphrase' && !failures.some((f) => f.id === c.id && f.problems.some((p) => p.startsWith('paraphrase:')))).length, R.paraphrase_total), paraphrase_top3_pct: pct(R.paraphrase_soft_ok, R.paraphrase_total) },
  explanation: { ...E, sections_pct: pct(E.sections_ok, E.rendered), frame_in_source_pct: pct(E.frame_in_source, E.frame_total), numbers_preserved_pct: pct(E.numbers_preserved, E.numbers_total), source_url_pct: pct(E.source_url, E.rendered), page_pct: pct(E.page_cited, E.rendered) },
  by_category: byCategory,
  failures,
  examples,
  model_involved: false,
};
mkdirSync(dirname(jsonOut), { recursive: true });
writeFileSync(jsonOut, JSON.stringify(report, null, 2) + '\n', 'utf8');

const line = (k, v) => `  ${k.padEnd(34)} ${v}`;
process.stdout.write(`L2 үнэлгээ · ${docName} · сан ${dbLabel} (${docCount} баримт) · кейс ${cases.length}: PASS ${report.pass} / FAIL ${report.fail} (хатуу ${hardFailures.length})\n`);
process.stdout.write('RETRIEVAL\n' + [line('горим зөв', `${R.mode_correct} (${report.retrieval.mode_pct}%)`), line('заалт/хэсэг зөв', `${R.clause_correct} (${report.retrieval.clause_pct}%)`), line('paraphrase top1 / top3', `${report.retrieval.paraphrase_top1_pct}% / ${report.retrieval.paraphrase_top3_pct}%`), line('нэрлэсэн баримтын цоож', `${R.lock_ok}/${R.lock_total}`), line('хөндлөн гоожилт', R.leak), line('буруу заалт татагдсан', R.wrong_clause), line('тооцооны хаалга', `${R.gate_ok}/${R.gate_total}`), line('тайлбар null зөв', `${R.null_ok}/${R.null_total}`), line('хүчинтэй эсэх тусдаа', `${R.currentness_ok}/${R.currentness_total}`), line('follow-up', `${R.follow_up_ok}/${R.follow_up_total}`)].join('\n') + '\n');
process.stdout.write('SEMANTIC VERIFIER\n' + [line('кейс', V.total), line('зөв дүн', `${V.correct} (${report.semantic_verifier.correct_pct}%)`), line('урвуулалт алдагдсан (FAIL→PASS)', V.reversal_missed), line('худал FAIL (PASS→FAIL)', V.false_fail)].join('\n') + '\n');
process.stdout.write('EXPLANATION\n' + [line('рендерлэсэн', E.rendered), line('шаардлагатай хэсгүүд', `${E.sections_ok} (${report.explanation.sections_pct}%)`), line('хүрээний мөр эхэд', `${E.frame_in_source}/${E.frame_total} (${report.explanation.frame_in_source_pct}%)`), line('тоо хадгалагдсан', `${E.numbers_preserved}/${E.numbers_total}`), line('зохиомол тоо', E.fabricated_numbers), line('зохиомол үндэслэл', E.fabricated_rationale), line('эх сурвалж URL / хуудас', `${E.source_url} / ${E.page_cited}`), line('contains/not_contains', `${E.contains_ok}/${E.contains_total}`)].join('\n') + '\n');
process.stdout.write('L2 OBJECTS (хүснэгт · томьёо · ангилал · тайлбар · хуучин код · чиглүүлэгч)\n' + [line('хүснэгт зөв', `${X.table_ok}/${X.table_total}`), line('зохиомол нүд / утга / нэгж', `${X.fabricated_table_cells} / ${X.fabricated_values} / ${X.fabricated_units}`), line('томьёо зөв', `${X.formula_ok}/${X.formula_total}`), line('зохиомол хувьсагч / гүйцэтгэсэн', `${X.fabricated_variables} / ${X.formula_executed}`), line('ангилал зөв', `${X.class_ok}/${X.class_total}`), line('ангиллын холив', X.category_mix), line('тайлбарын блок үнэнч', `${X.commentary_faithful}/${X.commentary_blocks}`), line('тайлбар норм мэт', X.commentary_as_norm), line('хуучин код зөв', `${X.legacy_ok}/${X.legacy_total}`), line('хуучин/одоогийн зөрүү', X.old_current_confusion), line('чиглүүлэгч', `${X.router_ok}/${X.router_total}`)].join('\n') + '\n');
process.stdout.write('АНГИЛЛААР\n' +Object.entries(byCategory).map(([k, v]) => line(k, `${v.pass}/${v.total}`)).join('\n') + '\n');
if (failures.length > 0) process.stdout.write('УНАСАН\n' + failures.map((f) => `  ${f.id} [${f.category}]${f.hard ? ' ХАТУУ' : ''} ${f.query}\n     ${f.problems.join(' | ')}`).join('\n') + '\n');
process.stdout.write(`→ ${jsonOut}\n`);
process.exit(hardFailures.length > 0 ? 1 : 0);
