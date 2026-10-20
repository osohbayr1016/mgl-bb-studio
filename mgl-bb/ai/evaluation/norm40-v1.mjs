#!/usr/bin/env node
/**
 * NORM-40 v1 + ADVERSARIAL — бие даасан хэмжүүрүүдээр үнэлгээ (NORM-INTEL v3, 2026-10-04).
 *
 *   node ai/evaluation/norm40-v1.mjs                       # STATIC: серверийн детерминист ҮНЭ ХАРИУЛТ (final), загваргүй
 *   node ai/evaluation/norm40-v1.mjs --replay out.json     # RAW vs FINAL: engine-replay-ээс гарсан хариултыг ХООСОН-ГҮЙ харьцуулна
 *   node ai/evaluation/norm40-v1.mjs --json out.json       # тайланг файлд бичнэ
 *
 * ⚠️ RAW ба FINAL ТУСДАА.  «Эцсийн хариулт 100%» нь загвар сайн гэсэн үг БИШ — гэрээ/шалгагч муу хариултыг далдалсан байж
 *    болно.  `--replay` файл: [{ id, raw: "<гэрээгүй загварын хариулт>", final: "<хэрэглэгчид очсон хариулт>",
 *    latency_ms?, retrieval?: "ok|no_match|unavailable" }].  STATIC горимд `final` = серверийн template, `raw` = хэмжигдээгүй
 *    (ЗАГВАР ОРОЛЦООГҮЙ — энэ нь ЗОРИУД: STATIC нь үйлдвэрлэлийн «нотолгоо байхгүй» замын аюулгүй байдлыг хэмждэг, загварын
 *    чанарыг БИШ).
 *
 * ⚠️ ХЭМЖИХГҮЙ зүйл (илэрхий):  retrieval success (локал мэдлэгийн сан энэ машинд байхгүй бол `not_measured`), latency
 *    (replay-д `latency_ms` өгвөл), загварын байгалийн хэлний чанар (зөвхөн хэв маягийн lint + давталт).
 *
 * Хэмжүүр бүр ТУСДАА тоологдоно: routing · ERP isolation · Revit isolation · currentness · applicability · citation
 * (зохиомол код/заалт) · unsupported numeric · unsupported mandatory · repetition · style · refusal usefulness.
 * Node ≥ 22.15 (registerHooks) — `loadBackend` шиг.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadBackend, REPO } from './production-readiness/lib/load.mjs';
import { styleLint } from './lib/style.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : (argv[i + 1] ?? d);
};

const norm40 = JSON.parse(readFileSync(join(HERE, 'norm40-v1-cases.json'), 'utf8')).cases;
const adversarial = JSON.parse(readFileSync(join(HERE, 'norm40-adversarial-cases.json'), 'utf8')).cases;
const cases = [
  ...norm40.map((c) => ({ ...c, set: 'NORM40' })),
  ...adversarial.map((c) => ({ ...c, set: 'ADVERSARIAL', acceptable_subtypes: null })),
];

const { classifyIntent } = await loadBackend('intent.ts');
const { planTurn } = await loadBackend('turnPlan.ts');
const { planResearch } = await loadBackend('researchPlan.ts');
const { toolsForMode } = await loadBackend('tools/registry.ts');
const { classifyNormQuestion } = await loadBackend('norm/questionKind.ts');
const { buildNormIntel, applyNormIntel } = await loadBackend('norm/intelligence.ts');
const common = await import(pathToFileURL(join(REPO, 'packages', 'mglai-common', 'src', 'normIntel.ts')).href);
const validator = await import(pathToFileURL(join(REPO, 'packages', 'mglai-common', 'src', 'turn', 'validator.ts')).href);

const VISIBLE = toolsForMode('employee').map((t) => t.name);
const ERP_TOOLS = new Set(['get_active_employees', 'get_employee_activity', 'list_projects', 'get_upcoming_deadlines', 'get_overdue_tasks', 'get_my_assignments', 'get_project_progress', 'analyze_project', 'describe_system', 'query_entities']);
const ERP_WORDS = /(?:идэвхтэй төсөл|төслийн явц|хугацаа хэтэрсэн|ажилтны ачаалал|MGL-\d{4,}|deadline|даалгаврын жин)/iu;
const REVIT_WORDS = /(?:Revit|family|view\b|параметр\b|сонгосон элемент)/iu;

function emptyBlock(q) {
  return {
    version: common.NORM_INTEL_VERSION, subtype: 'X', topics: [], evidenceState: 'NO_VERIFIED_MATCH', generalOnly: true, evidenceBacked: false,
    applicability: { status: 'MISSING_CONTEXT', considered: [], missing: [] }, claims: [], sources: [], sourceBlock: null,
    userQuoted: [...q.matchAll(/\d[\d.\-]*/g)].map((m) => m[0]), userNumbers: [...q.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(',', '.'))),
    terminology: [], forbidCompliance: true, stateSentence: null, mustDiscloseCurrentness: false,
  };
}

/** Нэг хариултыг бие даасан хэмжүүрээр оноож, АЛДААГ нэрлэнэ. */
function scoreAnswer(q, text) {
  const out = { fails: [] };
  const block = emptyBlock(q);
  const v = common.validateNormIntel(text, block, { allowedNumbers: [] });
  const has = (code) => v.some((x) => x.code === code);
  out.unsupportedNumeric = has('GENERAL_NUMBER') ? 1 : 0;
  out.unsupportedMandatory = has('UNSUPPORTED_MODAL') ? 1 : 0;
  out.fakeCitation = has('INVENTED_DOCUMENT') || has('INVENTED_CLAUSE') ? 1 : 0;
  out.currentnessPromoted = has('CURRENTNESS_PROMOTED') ? 1 : 0;
  out.complianceCert = has('COMPLIANCE_CERTIFICATION') ? 1 : 0;
  out.terminologyInvented = has('TERMINOLOGY_INVENTED') ? 1 : 0;
  out.severeRepetition = common.detectSevereRepetition(text).severe ? 1 : 0;
  out.styleHits = styleLint(text, 'mn-Cyrl').total;
  out.erpLeak = ERP_WORDS.test(text) ? 1 : 0;
  out.revitLeak = REVIT_WORDS.test(text) ? 1 : 0;
  // Татгалзлын ХЭРЭГТЭЙ байдал: тоо/заалт зохиохгүй ба (ерөнхий ойлголт ЭСВЭЛ дутуу оролтын жагсаалт ЭСВЭЛ дараагийн алхам)
  const useful = /(?:Ерөнхий ойлголт|дараах мэдээлэл|дутуу байна|албан ёсны бүртгэл|шалгах хэрэгтэй|шалгана)/u.test(text);
  const uselessRefusal = /(?:Уучлаарай, энэ асуултад зөв хариулт гаргаж чадсангүй|төслийн нэр эсвэл нормын кодтой)/iu.test(text);
  out.refusalUseful = useful && !uselessRefusal ? 1 : 0;
  out.uselessRefusal = uselessRefusal ? 1 : 0;
  for (const k of ['unsupportedNumeric', 'unsupportedMandatory', 'fakeCitation', 'currentnessPromoted', 'complianceCert', 'terminologyInvented', 'severeRepetition', 'erpLeak', 'revitLeak', 'uselessRefusal']) if (out[k]) out.fails.push(k);
  return out;
}

const rows = [];
const replay = flag('replay') ? Object.fromEntries(JSON.parse(readFileSync(flag('replay'), 'utf8')).map((r) => [r.id, r])) : null;

for (const c of cases) {
  const q = c.turns[0].q;
  const t0 = performance.now();
  const intent = classifyIntent(q);
  const plan = planTurn({ question: q, rawState: null, seq: 0, visibleTools: VISIBLE });
  const research = planResearch({ question: q, plan, mode: 'employee', visibleTools: VISIBLE, round: 0, prior: [], maxTools: 8 });
  const tools = [...plan.tools, ...research.tools].map((t) => t.name);
  const cls = classifyNormQuestion(q);
  const routingOk = intent.intent === 'NORMATIVE' && plan.regulatory === true && plan.askLocalNorm === true;
  const subtypeOk = c.acceptable_subtypes ? c.acceptable_subtypes.includes(cls.subtype) : true;
  const erpIsolation = tools.filter((n) => ERP_TOOLS.has(n)).length === 0;
  const revitIsolation = true; // Revit хэрэгсэл нь сонгогдсон контекстээс; norm-only ээлжид `isNormOnlyTurn` хаадаг (backend тест)

  let finalText = null;
  let rawText = null;
  let intelState = null;
  let applicability = null;
  if (replay?.[c.id]) {
    finalText = replay[c.id].final ?? null;
    rawText = replay[c.id].raw ?? null;
  } else {
    const b = buildNormIntel({ question: q, lang: 'mn-Cyrl', intent: intent.intent, taskCount: 1, catalogAsked: false, discoveryActive: false, smallTalk: false, trustedNorm: null, localNorm: null, useLocalNorm: false, clauseAbsent: false, subjectMissing: false, driftMismatch: false, retrievalFailed: false });
    if (b?.override) {
      finalText = b.override.template;
      intelState = b.diag.evidenceState;
      applicability = b.diag.applicability;
      const contract = applyNormIntel({ version: 'tfc-2', answerMode: 'refusal', risk: 'high', facts: [], allowedNumbers: [], allowedCategories: [], requiredSentence: null, trailerText: null, requiredCitations: [], noMatch: true, forbiddenPhrases: [], template: '', taskIndex: null, legacyKind: 'norm_refusal', reason: 'eval', norm: null }, b);
      const viol = validator.validateAnswer(contract.template, contract).violations;
      if (viol.length) finalText = `[SELF-VALIDATION FAILED: ${viol.map((x) => x.code).join(',')}] ${finalText}`;
    }
  }
  const row = {
    id: c.id, set: c.set, family: c.family ?? c.category, question: q,
    routing: { ok: routingOk, intent: intent.intent, regulatory: plan.regulatory, askLocalNorm: plan.askLocalNorm, subtype: cls.subtype, subtypeOk },
    erpIsolation, revitIsolation, tools,
    state: { evidenceState: intelState, applicability },
    retrieval: replay?.[c.id]?.retrieval ?? 'not_measured',
    latencyMs: replay?.[c.id]?.latency_ms ?? Math.round(performance.now() - t0),
    final: finalText === null ? null : scoreAnswer(q, finalText),
    raw: rawText === null ? null : scoreAnswer(q, rawText),
    finalText: finalText?.slice(0, 600) ?? null,
  };
  rows.push(row);
}

function agg(list, pick) {
  const have = list.filter((r) => pick(r) !== null && pick(r) !== undefined);
  return { n: have.length, fail: have.filter((r) => pick(r) === false || (typeof pick(r) === 'number' && pick(r) > 0)).length };
}
const DIMS = ['unsupportedNumeric', 'unsupportedMandatory', 'fakeCitation', 'currentnessPromoted', 'complianceCert', 'terminologyInvented', 'severeRepetition', 'erpLeak', 'revitLeak', 'uselessRefusal'];
const summary = {
  cases: rows.length,
  routing: { ok: rows.filter((r) => r.routing.ok).length, subtypeOk: rows.filter((r) => r.routing.subtypeOk).length },
  erpIsolation: { ok: rows.filter((r) => r.erpIsolation).length },
  retrieval: replay ? 'from replay' : 'not_measured (static)',
  final: Object.fromEntries(DIMS.map((d) => [d, rows.filter((r) => r.final && r.final[d]).length])),
  finalStyleHits: rows.reduce((a, r) => a + (r.final?.styleHits ?? 0), 0),
  // «Хэрэгтэй татгалзал» — ЗӨВХӨН нотолгоогүй/унасан төлөвт (засаглалын зарчмын хариулт өөрөө хариулт тул тоологдохгүй)
  finalRefusalUseful: `${rows.filter((r) => r.final?.refusalUseful && r.state.evidenceState !== 'GENERAL_ONLY').length}/${rows.filter((r) => r.final && r.state.evidenceState !== 'GENERAL_ONLY').length}`,
  raw: replay ? Object.fromEntries(DIMS.map((d) => [d, rows.filter((r) => r.raw && r.raw[d]).length])) : 'not_measured (no model in static mode)',
  rawStyleHits: replay ? rows.reduce((a, r) => a + (r.raw?.styleHits ?? 0), 0) : null,
};

console.log(`NORM-40 v1 + ADVERSARIAL · ${rows.length} кейс · ${replay ? 'REPLAY (raw vs final)' : 'STATIC (серверийн детерминист хариулт, загваргүй)'}`);
console.log(`  routing NORMATIVE+retrieval: ${summary.routing.ok}/${rows.length} · дэд төрөл: ${summary.routing.subtypeOk}/${rows.length} · ERP isolation: ${summary.erpIsolation.ok}/${rows.length}`);
console.log(`  FINAL нийт зөрчил: ${JSON.stringify(summary.final)} · хэв маягийн гажиг ${summary.finalStyleHits} · татгалзал хэрэгтэй ${summary.finalRefusalUseful}`);
console.log(`  RAW: ${typeof summary.raw === 'string' ? summary.raw : JSON.stringify(summary.raw)}`);
const bad = rows.filter((r) => !r.routing.ok || !r.routing.subtypeOk || !r.erpIsolation || (r.final && r.final.fails.length > 0));
if (bad.length) {
  console.log('\n  ✖ алдаатай:');
  for (const r of bad) console.log(`    ${r.id}: routing=${r.routing.ok} subtype=${r.routing.subtype}${r.routing.subtypeOk ? '' : ' ✖'} erp=${r.erpIsolation} final=${r.final?.fails.join(',') ?? '-'}`);
}
const out = flag('json');
if (out) writeFileSync(out, JSON.stringify({ schema: 'mglai-norm40-eval/1', mode: replay ? 'replay' : 'static', summary, rows }, null, 2));
const ok = bad.length === 0;
console.log(ok ? '\nOK' : '\nFAIL');
process.exit(ok ? 0 : 1);
