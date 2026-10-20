#!/usr/bin/env node
/**
 * MGL AI · PERFORMANCE BASELINE + REGRESSION GATE (Session C, 2026-09-11).
 *
 *   node ai/evaluation/production-readiness/perf-baseline.mjs [--json out.json] [--baseline prev.json] [--runs 5] [--gen]
 *
 * Хэмжинэ (p50/p90/p95, мс):
 *   · runtime /health · /info round-trip
 *   · /generate: first-token, tok/s, total (богино тогтмол prompt, N гүйлт)
 *   · зэрэгцээ 2 ба 4 хүсэлт (§31): дараалал/OOM/хольцол — урсгал бүр өөрийн done-той
 *   · backend /api/mgl-ai/plan · /context (локал :3000 амьд + нэвтрэлт бол; эс бөгөөс BLOCKED)
 *   · GPU VRAM (nvidia-smi байвал)
 *
 * ⚠️ ТООГ ЗОХИОДОГГҮЙ: хэмжигдээгүй мөр бүр BLOCKED.  Тайланд `machine` хурууны хээ орно —
 *    өөр машины тоотой харьцуулахгүй.  `--baseline` өгвөл first-token/tok-s-ийг +50% / −33%
 *    хүлцэлтэй харьцуулж WARN гаргана (унагахгүй — мандат §29).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const RUNS = Number(opt('--runs', 5));
const JSON_OUT = opt('--json', path.join(HERE, 'perf-baseline.json'));
const BASELINE = opt('--baseline');
const RT = process.env.MGLAI_RUNTIME ?? 'http://127.0.0.1:39217';
const API = process.env.MGLAI_API ?? 'http://127.0.0.1:3000/api';
const SECRET = (() => {
  try {
    return fs.readFileSync(path.join(process.env.LOCALAPPDATA ?? '', 'MglAi', 'secret.txt'), 'utf8').trim();
  } catch {
    return '';
  }
})();

const pct = (arr, p) => {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
};
const stats = (arr) => ({ n: arr.length, p50: pct(arr, 50), p90: pct(arr, 90), p95: pct(arr, 95), min: arr.length ? Math.min(...arr) : null, max: arr.length ? Math.max(...arr) : null });

const report = { generated_at: new Date().toISOString(), machine: { host: os.hostname(), cpu: os.cpus()[0]?.model ?? '?', cores: os.cpus().length, ram_gb: Math.round(os.totalmem() / 2 ** 30), gpu: null }, runtime: null, generate: null, concurrency: {}, backend: null, checks: [] };
const check = (name, ok, detail = '') => report.checks.push({ name, status: ok === null ? 'BLOCKED' : ok ? 'PASS' : 'FAIL', detail });

try {
  const r = spawnSync('nvidia-smi', ['--query-gpu=name,memory.used,memory.total', '--format=csv,noheader'], { encoding: 'utf8' });
  if (r.status === 0) report.machine.gpu = r.stdout.trim();
} catch {
  /* GPU байхгүй */
}

async function timed(fn) {
  const t0 = performance.now();
  const v = await fn();
  return { ms: performance.now() - t0, v };
}

/* ── runtime ─────────────────────────────────────────────────────── */
let runtimeUp = false;
try {
  const health = [];
  for (let i = 0; i < RUNS; i++) health.push((await timed(() => fetch(`${RT}/health`, { signal: AbortSignal.timeout(3000) }))).ms);
  const info = await fetch(`${RT}/info`, { headers: SECRET ? { 'X-MglAi-Secret': SECRET } : {}, signal: AbortSignal.timeout(5000) });
  const infoJson = info.ok ? await info.json() : null;
  runtimeUp = true;
  report.runtime = { health_ms: stats(health), info_status: info.status, engine: infoJson?.engine ?? infoJson?.model ?? null, info: infoJson ? { engine: infoJson.engine, model: infoJson.model?.name ?? infoJson.model ?? null, context_tokens: infoJson.contextTokens ?? infoJson.context_tokens ?? null } : null };
  check('runtime /health p95 < 200 мс', (report.runtime.health_ms.p95 ?? 1e9) < 200, `p95=${report.runtime.health_ms.p95?.toFixed(1)}`);
} catch (err) {
  report.runtime = { error: String(err.message ?? err) };
  check('runtime reachable', null, 'runtime унтарсан — /generate хэмжилт BLOCKED');
}

const TURNS = [
  { role: 'system', content: 'MGL AI · perf. Хариултаа монголоор, 2 өгүүлбэрээр бич.' },
  { role: 'user', content: 'Асуулт: Барилгын зураг төслийн үе шатуудыг товч тайлбарла.' },
];

async function generateOnce(turns, maxTokens = 96, signal) {
  const t0 = performance.now();
  const res = await fetch(`${RT}/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(SECRET ? { 'X-MglAi-Secret': SECRET } : {}) }, body: JSON.stringify({ turns, max_tokens: maxTokens }), signal });
  if (!res.ok || !res.body) return { ok: false, status: res.status, body: await res.text().catch(() => '') };
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let first = null;
  let tokens = 0;
  let text = '';
  let done = null;
  let errors = 0;
  for (;;) {
    const { done: d, value } = await reader.read();
    if (d) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = /event: (\w+)/.exec(frame)?.[1];
      const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
      if (!data) continue;
      let j;
      try {
        j = JSON.parse(data);
      } catch {
        continue;
      }
      if (ev === 'token') {
        if (first === null) first = performance.now() - t0;
        tokens += 1;
        text += j.text ?? '';
      } else if (ev === 'done') done = j;
      else if (ev === 'error') errors += 1;
    }
  }
  const total = performance.now() - t0;
  const genMs = first === null ? null : total - first;
  return { ok: done !== null, first_ms: first, total_ms: total, tokens, tok_s: genMs && tokens > 1 ? (tokens - 1) / (genMs / 1000) : null, stop: done?.stop_reason ?? null, text, errors, usage: done?.usage ?? null };
}

if (runtimeUp && !args.includes('--no-gen')) {
  try {
    // дулаацуулах
    await generateOnce(TURNS, 16, AbortSignal.timeout(120000));
    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push(await generateOnce(TURNS, 96, AbortSignal.timeout(180000)));
    const ok = runs.filter((r) => r.ok);
    report.generate = {
      runs: runs.length,
      ok: ok.length,
      first_token_ms: stats(ok.map((r) => r.first_ms).filter((x) => x !== null)),
      tok_s: stats(ok.map((r) => r.tok_s).filter((x) => x !== null)),
      total_ms: stats(ok.map((r) => r.total_ms)),
      stop_reasons: ok.map((r) => r.stop),
      sample: ok[0]?.text?.slice(0, 160) ?? null,
    };
    check('generate: бүх гүйлт done-тэй', ok.length === runs.length, `${ok.length}/${runs.length}`);
    check('generate: давталт/timeout зогсолт байхгүй', !ok.some((r) => r.stop === 'repetition' || r.stop === 'timeout'), report.generate.stop_reasons.join(','));
    check('generate: first-token p90 < 3000 мс (дулаан)', (report.generate.first_token_ms.p90 ?? 1e9) < 3000, `p90=${report.generate.first_token_ms.p90?.toFixed(0)} мс`);
    check('generate: tok/s p50 > 5', (report.generate.tok_s.p50 ?? 0) > 5, `p50=${report.generate.tok_s.p50?.toFixed(1)}`);

    // §31 зэрэгцээ
    for (const n of [2, 4]) {
      const t0 = performance.now();
      const results = await Promise.all(Array.from({ length: n }, (_, k) => generateOnce([{ role: 'system', content: 'MGL AI · perf.' }, { role: 'user', content: `Асуулт ${k + 1}: ${k % 2 === 0 ? 'Бетоны марк гэж юу вэ?' : 'Ган арматур гэж юу вэ?'} Нэг өгүүлбэрээр.` }], 64, AbortSignal.timeout(240000))));
      const wall = performance.now() - t0;
      const okN = results.filter((r) => r.ok);
      report.concurrency[n] = { wall_ms: wall, ok: okN.length, first_token_ms: stats(okN.map((r) => r.first_ms).filter((x) => x !== null)), total_ms: stats(okN.map((r) => r.total_ms)), errors: results.reduce((a, r) => a + (r.errors ?? 0), 0), statuses: results.map((r) => r.ok ? 'ok' : `http_${r.status}`) };
      check(`concurrency ${n}: бүгд амжилттай, алдаагүй`, okN.length === n && report.concurrency[n].errors === 0, report.concurrency[n].statuses.join(','));
      // урсгал хольцол: хариулт бүр өөрийн done + текст хоосон биш
      check(`concurrency ${n}: урсгал бүр өөрийн done, текст тус тусдаа`, okN.every((r) => r.text.length > 0) && new Set(okN.map((r) => r.text)).size >= Math.min(2, okN.length), '');
    }
  } catch (err) {
    report.generate = { error: String(err.message ?? err) };
    check('generate', null, `алдаа: ${err.message}`);
  }
}

/* ── backend (локал) ─────────────────────────────────────────────── */
try {
  const h = await fetch(`${API}/mgl-ai/health`, { signal: AbortSignal.timeout(3000) });
  const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: process.env.MGLAI_TEST_USER ?? 'A.Anand', password: process.env.MGLAI_TEST_PASS ?? 'admin123' }), signal: AbortSignal.timeout(10000) });
  const tok = login.ok ? (await login.json()).token : null;
  if (!tok) {
    report.backend = { health_status: h.status, login: login.status };
    check('backend /plan · /context', null, `нэвтрэлт амжилтгүй (${login.status})`);
  } else {
    const hdr = { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` };
    const plan = [];
    const ctx = [];
    for (let i = 0; i < RUNS; i++) {
      plan.push((await timed(() => fetch(`${API}/mgl-ai/plan`, { method: 'POST', headers: hdr, body: JSON.stringify({ question: 'Хэдэн идэвхтэй төсөл байна?', seq: 0 }) }))).ms);
      ctx.push((await timed(() => fetch(`${API}/mgl-ai/context`, { method: 'POST', headers: hdr, body: JSON.stringify({ question: 'Хэдэн идэвхтэй төсөл байна?', seq: 0, history: [], tool_results: [] }) }))).ms);
    }
    report.backend = { plan_ms: stats(plan), context_ms: stats(ctx) };
    check('backend /plan p90 < 500 мс (дулаан локал)', (report.backend.plan_ms.p90 ?? 1e9) < 500, `p90=${report.backend.plan_ms.p90?.toFixed(0)}`);
    check('backend /context p90 < 2000 мс (дулаан локал)', (report.backend.context_ms.p90 ?? 1e9) < 2000, `p90=${report.backend.context_ms.p90?.toFixed(0)}`);
  }
} catch {
  report.backend = { error: 'backend unreachable' };
  check('backend /plan · /context', null, 'локал backend унтарсан (:3000) — BLOCKED');
}

/* ── регрессийн харьцуулалт (§29) ────────────────────────────────── */
if (BASELINE && fs.existsSync(BASELINE)) {
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const cmp = (label, cur, prev, worseIfHigher, tol) => {
    if (cur == null || prev == null) return;
    const ratio = cur / prev;
    const worse = worseIfHigher ? ratio > 1 + tol : ratio < 1 - tol;
    report.checks.push({ name: `regression: ${label}`, status: worse ? 'WARN' : 'PASS', detail: `${prev.toFixed(1)} → ${cur.toFixed(1)} (${((ratio - 1) * 100).toFixed(0)}%)` });
  };
  cmp('first-token p90', report.generate?.first_token_ms?.p90, base.generate?.first_token_ms?.p90, true, 0.5);
  cmp('tok/s p50', report.generate?.tok_s?.p50, base.generate?.tok_s?.p50, false, 0.33);
  cmp('/plan p90', report.backend?.plan_ms?.p90, base.backend?.plan_ms?.p90, true, 0.5);
  cmp('/context p90', report.backend?.context_ms?.p90, base.backend?.context_ms?.p90, true, 0.5);
}

fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
const pass = report.checks.filter((c) => c.status === 'PASS').length;
const fail = report.checks.filter((c) => c.status === 'FAIL').length;
const blocked = report.checks.filter((c) => c.status === 'BLOCKED').length;
console.log(`MGL AI · perf baseline · ${report.machine.cpu} · ${report.machine.gpu ?? 'GPU?'}`);
if (report.generate?.first_token_ms) console.log(`generate: first-token p50 ${report.generate.first_token_ms.p50?.toFixed(0)} / p90 ${report.generate.first_token_ms.p90?.toFixed(0)} мс · tok/s p50 ${report.generate.tok_s.p50?.toFixed(1)} · total p50 ${report.generate.total_ms.p50?.toFixed(0)} мс`);
for (const n of Object.keys(report.concurrency)) console.log(`concurrency ${n}: wall ${report.concurrency[n].wall_ms.toFixed(0)} мс · first-token p90 ${report.concurrency[n].first_token_ms.p90?.toFixed(0)} · ${report.concurrency[n].statuses.join(',')}`);
if (report.backend?.plan_ms) console.log(`backend: /plan p50 ${report.backend.plan_ms.p50?.toFixed(0)} мс · /context p50 ${report.backend.context_ms.p50?.toFixed(0)} мс`);
for (const c of report.checks) console.log(`  ${c.status === 'PASS' ? '✔' : c.status === 'FAIL' ? '✖' : c.status === 'WARN' ? '⚠' : '⛔'} ${c.name} ${c.detail}`);
console.log(`checks ${pass} pass, ${fail} fail, ${blocked} blocked → ${JSON_OUT}`);
