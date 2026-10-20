#!/usr/bin/env node
/**
 * Read-only quality benchmark batch planning. Does not train, deploy or
 * manufacture reference answers. Fresh questions need a reviewed case catalog.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBenchmark } from '../reasoning-v1/lib/loadCases.mjs';
import { emptyHistory, validateHistory, selectBatch, updatedHistory, fingerprint } from './lib.mjs';

const base = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i < 0 ? fallback : (args[i + 1] ?? fallback);
};
const dry = args.includes('--dry-run');
const size = Number(arg('size', '40'));
const historyFile = path.resolve(arg('history', path.join(base, '.local', 'history.json')));
const outputFile = path.resolve(arg('out', path.join(base, '.local', 'batch-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json')));
const seed = arg('seed', new Date().toISOString().slice(0, 10));

if (historyFile === outputFile) throw Error('Output and history must be different files');
const benchmark = loadBenchmark(path.join(base, '..', 'reasoning-v1'));
if (!benchmark.validation.ok) {
  throw Error('Reasoning benchmark invalid: ' + benchmark.validation.errors.join('; '));
}
// Prevent concurrent runs from selecting the same questions.
fs.mkdirSync(path.dirname(historyFile), { recursive: true });
const lockFile = historyFile + '.lock';
const lockFd = dry ? null : fs.openSync(lockFile, 'wx');
try {
const history = fs.existsSync(historyFile) ? validateHistory(JSON.parse(fs.readFileSync(historyFile, 'utf8'))) : emptyHistory();
// Only cases supported by the isolated model evaluator count towards the 30–50 batch.
const selected = selectBatch(benchmark.core.filter((c) => c.modes.includes('MODEL_ONLY_EVIDENCE')), history, { size, seed });
const ids = selected.map((c) => c.id);
const payload = {
  schema: 'mgl-ai-quality-cycle-batch/1',
  generated_at: new Date().toISOString(),
  seed,
  batch_size: selected.length,
  benchmark_version: benchmark.benchmark_version,
  benchmark_case_set_sha256: benchmark.validation.case_set_sha256,
  status: 'SELECTED_NOT_EVALUATED',
  scope: 'MODEL_ONLY_EVIDENCE; FULL_RAG limited to applicable cases',
  warning: 'This is a curated case selection, NOT newly AI-generated questions or proof of correctness. Human references may still be pending. Scoring requires runtime; do not train on benchmark cases.',
  cases: selected.map((c) => ({
    id: c.id, category: c.category, difficulty: c.difficulty, modes: c.modes,
    languages: c.languages, question: c.question ?? c.turns,
    fingerprint: fingerprint(c),
    reference_review_status: c.provenance.review_status,
  })),
  commands: {
    structural: 'npm run ai:eval:reasoning:structural',
    model_only: 'npm run ai:eval:reasoning:model -- --only ' + ids.join(','),
    full_rag: 'npm run ai:eval:reasoning:full -- --only ' + ids.join(','),
    compare: 'npm run ai:eval:reasoning:compare -- old.json new.json',
  },
};
if (!dry) {
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.mkdirSync(path.dirname(historyFile), { recursive: true });
  // Refuse overwrite, including race with other quality-cycle processes.
  fs.writeFileSync(outputFile, JSON.stringify(payload, null, 2) + '\n', { flag: 'wx' });
  const tmp = historyFile + '.tmp-' + process.pid;
  try {
    fs.writeFileSync(tmp, JSON.stringify(updatedHistory(history, selected), null, 2) + '\n', { flag: 'wx' });
    fs.renameSync(tmp, historyFile);
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}
console.log(JSON.stringify({
  status: dry ? 'DRY_RUN_NO_HISTORY_MUTATION' : 'SELECTED_NOT_EVALUATED',
  batch_size: payload.batch_size,
  categories: Object.fromEntries([...new Set(selected.map((c) => c.category))].map((k) => [k, selected.filter((x) => x.category === k).length])),
  model_only_supported: selected.filter((c) => c.modes.includes('MODEL_ONLY_EVIDENCE')).length,
  full_rag_supported: selected.filter((c) => c.modes.includes('FULL_RAG')).length,
  reference_review_pending: selected.filter((c) => !['REFERENCE_VERIFIED','SYNTHETIC_DETERMINISTIC','HUMAN_REVIEWED'].includes(c.provenance.review_status)).length,
  output: dry ? null : outputFile,
  command: payload.commands.full_rag,
}, null, 2));

} finally {
  if (lockFd !== null) {
    fs.closeSync(lockFd);
    fs.unlinkSync(lockFile);
  }
}
