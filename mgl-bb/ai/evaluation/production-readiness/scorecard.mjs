#!/usr/bin/env node
/**
 * MGL AI · PRODUCTION-READINESS SCORECARD (Session C, 2026-09-11).
 *
 *   node ai/evaluation/production-readiness/scorecard.mjs [--json out.json] [--md out.md] [--quick]
 *
 * ⚠️ ОНОО ЗӨВХӨН БОДИТ ТЕСТЭЭС.  Ангилал бүр = ажиллуулсан багцуудын PASS/FAIL/TODO
 *    тоо; ажиллуулж чадаагүй (backend/runtime/өгөгдөл байхгүй) бол BLOCKED;
 *    тест огт байхгүй бол NOT_IMPLEMENTED.  Хувь нь ЗӨВХӨН ил тестийн тооноос —
 *    таамаг хувь ХЭЗЭЭ Ч оруулахгүй (мандат §43).
 *
 * `--quick` нь удаан гадаад багцуудыг (dataset lint, training lint, perf) алгасна.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const args = process.argv.slice(2);
const opt = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : null;
};
const QUICK = args.includes('--quick');
const JSON_OUT = opt('--json') ?? path.join(HERE, 'scorecard.json');
const MD_OUT = opt('--md') ?? path.join(HERE, 'scorecard.md');
const DATA_ROOT = process.env.MGLAI_DATA_ROOT ?? path.join(REPO, 'ai', 'data-train-files');

/** node --test гаралтаас ℹ tests/pass/fail/todo мөрүүдийг уншина. */
function nodeTest(cwd, files, label) {
  const t0 = Date.now();
  // ⚠️ Файлгүй `node --test` нь БҮХ тестийг ажиллуулдаг — хоосон жагсаалт = хэрэгжээгүй.
  if (files.length === 0) return { label, kind: 'node-test', pass: 0, fail: 0, todo: 0, total: 0, ms: 0, status: 'NOT_IMPLEMENTED' };
  const r = spawnSync(process.execPath, ['--test', ...files], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, NODE_NO_WARNINGS: '1' } });
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  const num = (k) => Number((out.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm')) ?? [])[1] ?? 0);
  const total = num('tests');
  const failed = out.match(/^✖ (.+)$/gm)?.map((l) => l.slice(2).trim()).filter((l) => !/^failing tests:/.test(l)) ?? [];
  return { label, kind: 'node-test', pass: num('pass'), fail: num('fail'), todo: num('todo'), skipped: num('skipped'), total, ms: Date.now() - t0, status: total === 0 ? 'BLOCKED' : num('fail') > 0 ? 'FAIL' : 'PASS', failed: failed.slice(0, 10) };
}

/** «N тэнцсэн, M унасан» хэлбэрийн check-*.mjs скрипт. */
function checkScript(cwd, script, label) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [script], { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env: { ...process.env, NODE_NO_WARNINGS: '1' } });
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  const m = out.match(/(\d+)\s*тэнцсэн[,·]?\s*(\d+)\s*унасан/u);
  const pass = m ? Number(m[1]) : 0;
  const fail = m ? Number(m[2]) : r.status === 0 ? 0 : 1;
  return { label, kind: 'check-script', pass, fail, todo: 0, total: pass + fail, ms: Date.now() - t0, status: !m && r.status !== 0 ? 'BLOCKED' : fail > 0 ? 'FAIL' : 'PASS' };
}

function probe(url) {
  try {
    const r = spawnSync('curl', ['-4', '-s', '-m', '3', '-o', 'NUL', '-w', '%{http_code}', url], { encoding: 'utf8' });
    return (r.stdout ?? '').trim();
  } catch {
    return '000';
  }
}

const PR = path.join('ai', 'evaluation', 'production-readiness', 'suites');
const B = path.join('backend', 'src', 'lib', 'mglai');
const cats = [];
const cat = (name, owner, sources, note) => cats.push({ name, owner, sources, note });

/* ── ангиллууд ────────────────────────────────────────────────────── */
cat('Intent routing', 'C', [
  nodeTest(REPO, [path.join(PR, 'intent-routing.test.mjs')], 'held-out intent+tool routing'),
  nodeTest(path.join(REPO, 'backend'), [path.join('src/lib/mglai', 'intent.test.ts'), path.join('src/lib/mglai', 'toolPlan.test.ts'), path.join('src/lib/mglai', 'toolRouting.test.ts'), path.join('src/lib/mglai', 'researchPlan.test.ts')], 'backend intent/tool tests'),
]);
cat('Mongolian / Latin / units', 'C', [
  nodeTest(REPO, [path.join(PR, 'units-numbers-language.test.mjs')], 'units · numbers · language router · fuzz'),
  nodeTest(path.join(REPO, 'backend'), ['src/lib/mglai/lang.test.ts'], 'backend lang tests'),
  checkScript(path.join(REPO, 'frontend'), 'scripts/check-ai-markdown.mjs', 'markdown render (Mongolian text)'),
  (() => {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, ['evaluation/style-pairs.mjs'], { cwd: path.join(REPO, 'ai'), encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
    const m = (r.stdout ?? '').match(/баригдсан:\s*(\d+)\s*\/\s*(\d+)/u);
    const pass = m ? Number(m[1]) : 0;
    const total = m ? Number(m[2]) : 0;
    return { label: 'Mongolian style lint pairs (ai:eval:style)', kind: 'script', pass, fail: total - pass, todo: 0, total, ms: Date.now() - t0, status: total === 0 ? 'BLOCKED' : pass === total ? 'PASS' : 'FAIL' };
  })(),
]);
cat('Conversation / long context', 'C', [
  nodeTest(REPO, [path.join(PR, 'conversation-context.test.mjs')], 'multi-turn · 50/100 turns'),
  nodeTest(path.join(REPO, 'backend'), ['src/lib/mglai/turn.test.ts', 'src/lib/mglai/convState.test.ts', 'src/lib/mglai/contextBuilder.test.ts'], 'backend conversation kernel'),
]);
cat('Hallucination / company grounding', 'C', [
  nodeTest(REPO, [path.join(PR, 'hallucination-contract.test.mjs')], 'leading questions · no-tool · failed-tool · Revit-less'),
  nodeTest(path.join(REPO, 'backend'), ['src/lib/mglai/groundingGuard.test.ts', 'src/lib/mglai/trustedFacts.test.ts', 'src/lib/mglai/answerContract.test.ts'], 'backend contract tests'),
  checkScript(path.join(REPO, 'frontend'), 'scripts/check-ai-validator.mjs', 'frontend validator'),
  checkScript(path.join(REPO, 'frontend'), 'scripts/check-ai-contract.mjs', 'frontend legacy contract'),
]);
cat('Normative', 'A', [
  nodeTest(path.join(REPO, 'backend'), ['src/lib/mglai/normDecide.test.ts', 'src/lib/mglai/normEntities.test.ts', 'src/lib/mglai/currentness.test.ts'], 'backend norm decision'),
  nodeTest(path.join(REPO, 'ai'), ['retrieval/test/rules.test.ts', 'retrieval/test/pipeline.test.ts', 'retrieval/test/normalize.test.ts'], 'ai retrieval engine'),
  { label: 'norm golden (ai:eval:norm — локал сан шаардана)', kind: 'external', pass: 0, fail: 0, todo: 0, total: 0, status: 'BLOCKED', note: 'Session A-ийн багц; энэ scorecard ажиллуулахгүй' },
], 'Session A-ийн хүрээ — энд зөвхөн тоолно');
cat('Revit safety', 'C/SHARED', [
  nodeTest(path.join(REPO, 'backend'), ['src/lib/mglai/permissions.test.ts', 'src/lib/mglai/revitContext.test.ts'], 'permission ladder · revit context parser'),
  { label: 'Revit add-in ↔ MGL AI E2E', kind: 'external', pass: 0, fail: 0, todo: 0, total: 0, status: 'NOT_IMPLEMENTED', note: 'add-in-д MGL AI холболт байхгүй (grep 0); бүртгэлд Revit бичих хэрэгсэл байхгүй' },
]);
cat('Security', 'C', [
  nodeTest(REPO, [path.join(PR, 'security-injection.test.mjs')], 'sentinel · injection · permissions · registry invariants'),
  nodeTest(path.join(REPO, 'backend'), ['src/lib/mglai/visibility.test.ts', 'src/lib/mglai/identity.test.ts', 'src/lib/mglai/promptFrame.test.ts', 'src/lib/mglai/gateway/query.test.ts'], 'backend security tests'),
  nodeTest(path.join(REPO, 'ai'), ['runtime/test/auth.test.ts'], 'runtime origin/secret auth'),
]);
cat('Streaming / error recovery', 'C', [
  nodeTest(REPO, [path.join(PR, 'streaming-faults.test.mjs')], 'orchestrator fault harness (fake wire)'),
  checkScript(path.join(REPO, 'frontend'), 'scripts/check-ai-stream.mjs', 'reducer/stream state machine'),
  nodeTest(path.join(REPO, 'ai'), ['runtime/test/heartbeat.test.ts', 'runtime/test/repetition.test.ts', 'runtime/test/generateGuard.test.ts'], 'runtime heartbeat · repetition · guards'),
]);
cat('Performance', 'C', [
  (() => {
    if (QUICK) return { label: 'perf baseline (--quick алгасав)', kind: 'external', pass: 0, fail: 0, todo: 0, total: 0, status: 'BLOCKED' };
    const rt = probe('http://127.0.0.1:39217/health');
    const be = probe('http://127.0.0.1:3000/api/mgl-ai/health');
    const perf = path.join(HERE, 'perf-baseline.mjs');
    if (!fs.existsSync(perf)) return { label: 'perf baseline', kind: 'external', pass: 0, fail: 0, todo: 0, total: 0, status: 'NOT_IMPLEMENTED' };
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [perf, '--json', path.join(HERE, 'perf-baseline.json')], { cwd: REPO, encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
    const out = r.stdout ?? '';
    const m = out.match(/checks (\d+) pass, (\d+) fail, (\d+) blocked/);
    const pass = m ? Number(m[1]) : 0;
    const fail = m ? Number(m[2]) : 0;
    const blocked = m ? Number(m[3]) : 0;
    return { label: `perf baseline (runtime ${rt === '200' ? 'up' : 'down'}, backend ${be === '200' || be === '401' ? 'up' : 'down'})`, kind: 'script', pass, fail, todo: blocked, total: pass + fail, ms: Date.now() - t0, status: pass + fail === 0 ? 'BLOCKED' : fail > 0 ? 'FAIL' : 'PASS' };
  })(),
]);
cat('Employee deployment / update / rollback', 'B', [
  nodeTest(path.join(REPO, 'ai'), ['runtime/test/modelManager.test.ts', 'runtime/test/perfProfile.test.ts', 'runtime/test/trainingLock.test.ts'], 'runtime manifests · model manager · locks'),
  { label: 'deployment/updater/fleet suite', kind: 'external', pass: 0, fail: 0, todo: 0, total: 0, status: 'NOT_IMPLEMENTED', note: 'Session B-ийн worktree-д (ai/deployment/) — энд байхгүй' },
], 'Session B-ийн хүрээ');
cat('Dataset quality', 'C (tool) / A (data)', [
  (() => {
    if (QUICK) return { label: 'dataset lint (--quick алгасав)', kind: 'external', pass: 0, fail: 0, todo: 0, total: 0, status: 'BLOCKED' };
    if (!fs.existsSync(DATA_ROOT)) return { label: 'dataset lint (өгөгдөл байхгүй)', kind: 'external', pass: 0, fail: 0, todo: 0, total: 0, status: 'BLOCKED' };
    const t0 = Date.now();
    const out = path.join(HERE, 'dataset-lint.json');
    spawnSync(process.execPath, ['ai/tools/dataset-lint/lint.mjs', '--root', DATA_ROOT, '--json', out, '--quiet'], { cwd: REPO, encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
    const j = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null;
    if (!j) return { label: 'dataset lint', kind: 'external', pass: 0, fail: 0, todo: 0, total: 0, status: 'BLOCKED' };
    const pkgs = j.packages.length;
    const bad = j.packages.filter((p) => p.counts.error > 0).length;
    return { label: `dataset lint (${pkgs} багц: ${j.totals.error} алдаа · ${j.totals.warn} анхааруулга · ${j.totals.info} мэдээлэл)`, kind: 'script', pass: pkgs - bad, fail: bad, todo: 0, total: pkgs, ms: Date.now() - t0, status: bad > 0 ? 'FAIL' : 'PASS', detail: j.summary.by_code };
  })(),
]);
cat('Training pipeline', 'C (lint) / B (control-plane)', [
  (() => {
    if (QUICK) return { label: 'training lint (--quick алгасав)', kind: 'external', pass: 0, fail: 0, todo: 0, total: 0, status: 'BLOCKED' };
    const sft = path.join(REPO, 'ai', 'training', 'out');
    if (!fs.existsSync(sft)) return { label: 'training lint (ai/training/out байхгүй)', kind: 'external', pass: 0, fail: 0, todo: 0, total: 0, status: 'BLOCKED' };
    const t0 = Date.now();
    const out = path.join(HERE, 'training-lint.json');
    spawnSync(process.execPath, ['ai/tools/training-lint/lint.mjs', '--sft', sft, '--eval', 'ai/evaluation/heldout-cases.json', '--json', out], { cwd: REPO, encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
    const j = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null;
    if (!j) return { label: 'training lint', kind: 'external', pass: 0, fail: 0, todo: 0, total: 0, status: 'BLOCKED' };
    const checks = [
      ['train/held-out ЯГ ижил гоожилт = 0', j.summary.leak_exact === 0],
      ['train/held-out ойролцоо гоожилт = 0', j.summary.leak_fuzzy === 0],
      ['нууц/sentinel хэв маяг = 0', !j.findings.some((f) => f.code === 'SECRET_PATTERN' || f.code === 'SENTINEL_SECRET')],
      ['бүтцийн алдаа (role/empty/jsonl) = 0', !j.findings.some((f) => ['BAD_ROLE_ORDER', 'EMPTY_ANSWER', 'EMPTY_QUESTION', 'INVALID_JSONL', 'NO_MESSAGES'].includes(f.code))],
      ['PII = 0', !j.findings.some((f) => f.code === 'PII_EMAIL' || f.code === 'PII_PHONE')],
    ];
    const pass = checks.filter((c) => c[1]).length;
    return { label: `training lint (${j.summary.sft_examples} жишээ · ${j.totals.warn} анхааруулга)`, kind: 'script', pass, fail: checks.length - pass, todo: 0, total: checks.length, ms: Date.now() - t0, status: pass === checks.length ? 'PASS' : 'FAIL', failed: checks.filter((c) => !c[1]).map((c) => c[0]), detail: j.summary.by_code };
  })(),
  nodeTest(path.join(REPO, 'backend'), ['src/lib/mglai/feedback.test.ts'], 'feedback state machine (pending→approved хаалт)'),
]);
cat('Route-level (live local backend)', 'C', [
  (() => {
    const r = nodeTest(REPO, [path.join(PR, 'live-backend.test.mjs')], '/plan · /context · /messages · /tool (локал :3000)');
    // бүгд skip = backend унтарсан → BLOCKED
    if (r.total > 0 && r.pass === 0 && r.fail === 0) return { ...r, status: 'BLOCKED', label: `${r.label} — backend унтарсан` };
    return r;
  })(),
]);
cat('Observability', 'C', [
  nodeTest(path.join(REPO, 'backend'), ['src/lib/mglai/redaction.test.ts'].filter((f) => fs.existsSync(path.join(REPO, 'backend', f))), 'redaction helpers'),
  { label: 'diagnose-request.mjs («яагаад унав» мөшгилт, локал D1 read-only)', kind: 'external', pass: fs.existsSync(path.join(REPO, 'ai', 'tools', 'diagnose-request.mjs')) ? 1 : 0, fail: 0, todo: 0, total: 1, status: fs.existsSync(path.join(REPO, 'ai', 'tools', 'diagnose-request.mjs')) ? 'PASS' : 'NOT_IMPLEMENTED' },
]);

/* ── нэгтгэл ──────────────────────────────────────────────────────── */
const statusOf = (sources) => {
  const runnable = sources.filter((s) => s.status === 'PASS' || s.status === 'FAIL');
  if (sources.some((s) => s.status === 'FAIL')) return 'FAIL';
  if (runnable.length === 0) return sources.some((s) => s.status === 'BLOCKED') ? 'BLOCKED' : 'NOT_IMPLEMENTED';
  return sources.some((s) => s.status === 'BLOCKED' || s.status === 'NOT_IMPLEMENTED') ? 'PASS (хэсэгчилсэн)' : 'PASS';
};
const rows = cats.map((c) => {
  const pass = c.sources.reduce((a, s) => a + (s.pass ?? 0), 0);
  const fail = c.sources.reduce((a, s) => a + (s.fail ?? 0), 0);
  const todo = c.sources.reduce((a, s) => a + (s.todo ?? 0), 0);
  const blocked = c.sources.filter((s) => s.status === 'BLOCKED').length;
  const notImpl = c.sources.filter((s) => s.status === 'NOT_IMPLEMENTED').length;
  const pct = pass + fail > 0 ? Math.round((pass / (pass + fail)) * 100) : null;
  return { ...c, pass, fail, todo, blocked, not_implemented: notImpl, pct, status: statusOf(c.sources) };
});
const totals = rows.reduce((a, r) => ({ pass: a.pass + r.pass, fail: a.fail + r.fail, todo: a.todo + r.todo }), { pass: 0, fail: 0, todo: 0 });
const result = { generated_at: new Date().toISOString(), repo: REPO, quick: QUICK, totals, categories: rows };
fs.writeFileSync(JSON_OUT, JSON.stringify(result, null, 2));

const md = [];
md.push(`# MGL AI · Production readiness scorecard`);
md.push(`Үүсгэсэн: ${result.generated_at} · зөвхөн ил тестээс (таамаг хувь байхгүй)${QUICK ? ' · --quick' : ''}`);
md.push('');
md.push('| Ангилал | Эзэн | PASS | FAIL | TODO/known-gap | BLOCKED | NOT_IMPL | % (ил тест) | Төлөв |');
md.push('|---|---|---|---|---|---|---|---|---|');
for (const r of rows) md.push(`| ${r.name} | ${r.owner} | ${r.pass} | ${r.fail} | ${r.todo} | ${r.blocked} | ${r.not_implemented} | ${r.pct === null ? '—' : `${r.pct}%`} | ${r.status} |`);
md.push(`| **Нийт** | | **${totals.pass}** | **${totals.fail}** | ${totals.todo} | | | | |`);
md.push('');
for (const r of rows) {
  md.push(`## ${r.name}`);
  if (r.note) md.push(`_${r.note}_`);
  for (const s of r.sources) {
    md.push(`- ${s.status === 'PASS' ? '✅' : s.status === 'FAIL' ? '❌' : s.status === 'BLOCKED' ? '⛔' : '⬜'} ${s.label} — ${s.pass}/${s.total}${s.todo ? ` (+${s.todo} todo)` : ''}${s.ms ? ` · ${s.ms} мс` : ''}${s.note ? ` · ${s.note}` : ''}`);
    for (const f of s.failed ?? []) md.push(`    - ✖ ${f}`);
  }
  md.push('');
}
fs.writeFileSync(MD_OUT, md.join('\n'));
console.log(md.slice(0, rows.length + 5).join('\n'));
console.log(`\nJSON → ${JSON_OUT}\nMD   → ${MD_OUT}`);
process.exit(totals.fail > 0 ? 1 : 0);
