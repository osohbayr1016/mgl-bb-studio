#!/usr/bin/env node
/**
 * Forty held-out Latin Mongolian AEC questions. Static mode audits routing;
 * live mode uses the existing plan → tools → norm → context → Qwen → repair
 * evaluation client. No answers are persisted to the ERP or committed to git.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createClient } from './lib/e2e.mjs';
import { redactObject } from '@mgl/mglai-common/redaction';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) return nextResolve(specifier + '.ts', context);
    return nextResolve(specifier, context);
  },
});

const { detectLanguage } = await import('../../backend/src/lib/mglai/lang.ts');
const { classifyIntent } = await import('../../backend/src/lib/mglai/intent.ts');
const { decideDepth } = await import('../../backend/src/lib/mglai/depth.ts');
const here = path.dirname(fileURLToPath(import.meta.url));
const suite = JSON.parse(fs.readFileSync(path.join(here, 'latin-aec-roast.json'), 'utf8'));
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i < 0 ? fallback : argv[i + 1] ?? fallback;
};
const mode = arg('mode', 'static');
if (!['static', 'live'].includes(mode)) {
  console.error('Use --mode static or --mode live');
  process.exit(2);
}

function audit(c) {
  const language = detectLanguage(c.question);
  const route = classifyIntent(c.question);
  const depth = decideDepth({ question: c.question, intent: route.intent });
  return {
    id: c.id, area: c.area, question: c.question,
    reference: c.reference, reference_status: suite.status,
    expected_intent: c.intent, actual_intent: route.intent, route_reason: route.reason,
    detected_language: language.language, response_language: language.responseLanguage,
    answer_depth: depth.depth,
    route_matches_reference: route.intent === c.intent,
  };
}

function writeReport(report) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(here, 'benchmarks', `latin-aec-roast-${mode}-${stamp}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(redactObject(report), null, 2) + '\n', { mode: 0o600 });
  return file;
}

function secret() {
  if (process.env.MGLAI_SECRET) return process.env.MGLAI_SECRET;
  const file = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'MglAi', 'secret.txt')
    : path.join(os.homedir(), '.local', 'share', 'MglAi', 'secret.txt');
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return null; }
}

async function liveClient() {
  const rt = arg('rt', process.env.MGLAI_RUNTIME_URL ?? 'http://127.0.0.1:39217');
  const api = arg('api', process.env.MGLAI_API_URL ?? 'http://127.0.0.1:3000/api');
  try {
    const health = await fetch(rt.replace(/\/+$/, '') + '/health', { signal: AbortSignal.timeout(3000) });
    if (!health.ok) return { blocked_by: 'LOCAL_RUNTIME_UNAVAILABLE' };
  } catch { return { blocked_by: 'LOCAL_RUNTIME_UNAVAILABLE' }; }
  const key = secret();
  if (!key) return { blocked_by: 'LOCAL_RUNTIME_SECRET_UNAVAILABLE' };
  let info;
  try {
    const response = await fetch(rt.replace(/\/+$/, '') + '/info', {
      headers: { 'X-MglAi-Secret': key }, signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return { blocked_by: 'LOCAL_RUNTIME_UNAVAILABLE' };
    info = await response.json();
  } catch { return { blocked_by: 'LOCAL_RUNTIME_UNAVAILABLE' }; }
  if (String(info?.engine?.engine ?? '').toLowerCase().includes('echo') || !info?.engine?.artifact) {
    return { blocked_by: 'QWEN_MODEL_NOT_LOADED', runtime: info?.runtime_version ?? null };
  }
  const user = arg('user', process.env.MGLAI_EVAL_USER);
  const pass = arg('pass', process.env.MGLAI_EVAL_PASS);
  if (!user || !pass) return { blocked_by: 'EVAL_CREDENTIALS_UNAVAILABLE', runtime: info.runtime_version };
  const client = createClient({ api, rt, gen: true, secret: key, maxTokens: 750 });
  try { await client.login(user, pass); }
  catch { return { blocked_by: 'EVAL_BACKEND_OR_LOGIN_UNAVAILABLE', runtime: info.runtime_version }; }
  const identity = await client.identity('latin-aec-roast').catch(() => null);
  return { client, runtime: info.runtime_version, engine: info.engine, active_model: info.active_model ?? null, identity };
}

const rows = suite.cases.map(audit);
const summary = {
  total: rows.length,
  response_language_mn: rows.filter((r) => r.response_language === 'mn-Cyrl').length,
  route_matches_reference: rows.filter((r) => r.route_matches_reference).length,
  route_disagreements: rows.filter((r) => !r.route_matches_reference).map((r) => r.id),
};
const report = {
  schema: 'mglai-latin-aec-roast-result/1', mode, generated_at: new Date().toISOString(),
  git_sha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(here, '..', '..'), encoding: 'utf8' }).trim(),
  suite_status: suite.status, model_status: 'UNMEASURED',
  summary, cases: rows,
};
if (mode === 'static') {
  console.log(`Latin Mongolian: ${summary.response_language_mn}/${summary.total} routed to Mongolian`);
  console.log(`Intent agreement: ${summary.route_matches_reference}/${summary.total} (draft references)`);
  console.log(`Disagreements: ${summary.route_disagreements.join(', ') || 'none'}`);
  console.log(`Report: ${writeReport(report)}`);
  process.exit(summary.response_language_mn === summary.total ? 0 : 1);
}

const ready = await liveClient();
if (ready.blocked_by) {
  report.blocked_by = ready.blocked_by;
  report.summary.blocked = rows.length;
  console.log(`MGL AI live run BLOCKED: ${ready.blocked_by}; Qwen score UNMEASURED`);
  console.log(`Report: ${writeReport(report)}`);
  process.exit(3);
}

report.runtime = { version: ready.runtime, engine: ready.engine, active_model: ready.active_model };
report.identity = ready.identity;
report.model_status = 'LIVE_ATTEMPTED';
for (const row of rows) {
  try {
    const result = await ready.client.turn(`latin_roast_${row.id}_${Date.now()}`, row.question, [], null, 0, { persist: false });
    row.mgl_ai = {
      raw: result.rec?.raw ?? null,
      final: result.rec?.final ?? result.answer ?? null,
      source: result.rec?.source ?? null,
      repair_attempts: result.rec?.attempts ?? null,
      plan_intent: result.plan?.intent ?? null,
      response_language: result.ctx?.response_language ?? null,
      tools: (result.tools ?? []).map((t) => ({ tool: t.tool, ok: t.ok })),
      norm_retrieval: result.normRetrieval ?? null,
      raw_style: result.rec?.style?.raw ?? null,
      final_style: result.rec?.style?.final ?? null,
    };
    row.human_comparison = {
      factual_accuracy: null, natural_mongolian: null, useful_next_step: null,
      better_than_reference: null, notes: null,
    };
    console.log(`${row.id}: ${row.mgl_ai.source ?? 'unknown'} · ${row.mgl_ai.final?.slice(0, 100) ?? '(empty)'}`);
  } catch (error) {
    row.mgl_ai = { error: String(error?.message ?? error).slice(0, 300) };
    console.log(`${row.id}: ERROR`);
  }
}
report.summary.executed = rows.filter((r) => r.mgl_ai?.final != null).length;
report.summary.errors = rows.length - report.summary.executed;
console.log(`Live answers: ${report.summary.executed}/${rows.length}; subjective scores await human review`);
console.log(`Report: ${writeReport(report)}`);
process.exit(report.summary.errors ? 1 : 0);
