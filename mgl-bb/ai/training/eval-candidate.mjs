#!/usr/bin/env node
/**
 * `npm run ai:train:eval -- --run <нэр> [--skip-export] [--keep-runtime]`
 *
 * НЭР ДЭВШИГЧИЙГ ХӨЛДӨӨСӨН СУУРЬТАЙ НЭГ ТУШААЛААР ХАРЬЦУУЛНА (§19, §24):
 *
 *   1. PEFT → GGUF LoRA экспорт (export_adapter.py; байвал алгасна)
 *   2. ТУСДАА runtime (порт 39227/39228, `MglAi-candidate` дата хавтас — үйлдвэрлэлийн
 *      `MglAi` төлөвийг ХӨНДӨХГҮЙ) адаптертайгаар асаана
 *   3. ai:eval:heldout (38 кейс) + ai:eval:conv --gen (алтан A–O) — ЯГ ижил suite
 *   4. ai:compare — суурийн `*-sys6-base8b-reference.json`-той (E0 хөлдөөсөн суурь)
 *   5. runtime-ийг зогсооно (--keep-runtime биш бол)
 *
 * ⚠️ ШААРДЛАГА: backend dev (`cd backend && npm run dev`, :3000) ажиллаж байх — suite нь
 *    бодит гинжээр (plan → tool → context → generate) явдаг.  Үйлдвэрлэлийн runtime (39217)
 *    ажиллаж байвал GPU-д хоёр llama-server багтахгүй тул ЗОГСОНО — `npm run ai:stop` хийгээд дахин.
 *
 * ⚠️ ЮУ Ч DEPLOY ХИЙХГҮЙ, ИДЭВХЖҮҮЛЭХГҮЙ.  Дүгнэлт нь тайланд; шийдвэр эзнийх.
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const AI = resolve(HERE, '..');
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i === -1 ? d : (argv[i + 1] ?? d); };
const RUN = flag('run', null);
if (!RUN) { console.error('  --run <нэр> шаардлагатай'); process.exit(1); }
const PY = join(AI, 'training', '.venv', 'Scripts', 'python.exe');
const RT_PORT = Number(flag('port', 39227));
const ENGINE_PORT = RT_PORT + 1;
const CAND_DATA = process.env.MGLAI_CANDIDATE_DATA_DIR ?? join(process.env.LOCALAPPDATA ?? '', 'MglAi-candidate');
const PROD_DATA = join(process.env.LOCALAPPDATA ?? '', 'MglAi');
const BASE_HELDOUT = flag('base-heldout', 'heldout-gen-2026-09-10-sys6-base8b-reference.json');
const BASE_CONV = flag('base-conv', 'conv-e2e-gen-2026-09-10-sys6-base8b-reference.json');
const BENCH = join(AI, 'evaluation', 'benchmarks');

const log = (m) => console.log(`[eval-candidate] ${m}`);
async function health(port) {
  try { const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) }); return r.ok; } catch { return false; }
}
// ⚠️ 2026-09-28: `--api` — өөр сесс :3000-д өөр кодын backend ажиллуулж болно (CLAUDE.md «хоёр wrangler dev»);
//    scratch backend-ийн портыг ил дамжуулж, suite-ууд ЯГ тэр рүү явна.
const API = flag('api', 'http://127.0.0.1:3000/api');
async function backendUp() {
  try { const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(3000) }); return r.status > 0; } catch { return false; }
}

// 0. урьдчилсан нөхцөл
if (!(await backendUp())) { console.error(`  ✖ backend ${API} хариу өгөхгүй байна — \`cd backend && npm run dev\` эсвэл --api`); process.exit(2); }
// Үйлдвэрлэлийн llama-server (39218) VRAM барьж байвал хоёр дахь нь багтахгүй; runtime-ийн node процесс өөрөө саад биш.
const prodEngine = (() => { try { return execFileSync('tasklist', ['/FI', 'IMAGENAME eq llama-server.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' }).toLowerCase().includes('llama-server.exe'); } catch { return false; } })();
if (prodEngine) { console.error('  ✖ llama-server аль хэдийн ажиллаж байна (үйлдвэрлэлийн runtime?) — GPU-д хоёр багтахгүй.  `npm run ai:stop` хийгээд дахин.'); process.exit(2); }
if (await health(RT_PORT)) { console.error(`  ✖ ${RT_PORT} порт дээр аль хэдийн runtime байна — --keep-runtime-тэй өмнөх ажиллагаа?  Зогсоогоод дахин.`); process.exit(2); }

// 1. экспорт
const lora = join(AI, 'models', 'adapters', RUN, `${RUN}.lora.gguf`);
if (!existsSync(lora) || argv.includes('--force-export')) {
  log(`GGUF LoRA экспорт: ${RUN}`);
  execFileSync(PY, ['-X', 'utf8', join(AI, 'training', 'export_adapter.py'), '--run', RUN], { stdio: 'inherit' });
} else if (!argv.includes('--skip-export')) {
  log(`GGUF LoRA байна (${Math.round(statSync(lora).size / 1048576)} MB) — экспорт алгаслаа (--force-export бол дахин)`);
}

// 2. нэр дэвшигчийн runtime — үйлдвэрлэлийн загварыг УНШИНА (хуулахгүй), төлөв/мэдлэг нь ТУСДАА хавтас
const model = readdirSync(join(PROD_DATA, 'models')).filter((f) => /^Qwen3-8B.*\.gguf$/i.test(f)).sort((a, b) => statSync(join(PROD_DATA, 'models', b)).size - statSync(join(PROD_DATA, 'models', a)).size)[0];
if (!model) { console.error('  ✖ үйлдвэрлэлийн Qwen3-8B GGUF олдсонгүй'); process.exit(2); }
if (!existsSync(join(CAND_DATA, 'knowledge', 'knowledge.sqlite'))) { console.error(`  ✖ ${CAND_DATA}/knowledge/knowledge.sqlite алга — TRAINING.md §3-ын дагуу нэр дэвшигчийн дата хавтсыг бэлтгэ`); process.exit(2); }
const env = { ...process.env, MGLAI_PORT: String(RT_PORT), MGLAI_ENGINE_PORT: String(ENGINE_PORT), MGLAI_DATA_DIR: CAND_DATA, MGLAI_MODEL_PATH: join(PROD_DATA, 'models', model), MGLAI_LORA_PATH: lora };
log(`runtime асаана: порт ${RT_PORT} · ${model} · адаптер ${RUN}`);
const rt = spawn(process.execPath, [join(AI, 'runtime', 'src', 'server.ts')], { env, cwd: AI, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
rt.stdout.on('data', (d) => process.stdout.write(`  [rt] ${String(d).trimEnd().slice(0, 200)}\n`));
rt.stderr.on('data', (d) => process.stderr.write(`  [rt!] ${String(d).trimEnd().slice(0, 200)}\n`));
const stopRt = () => { try { rt.kill(); } catch {} try { execFileSync('powershell', ['-NoProfile', '-Command', `Get-Process llama-server -ErrorAction SilentlyContinue | Where-Object { (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine -match '${ENGINE_PORT}' } | Stop-Process -Force`], { stdio: 'ignore' }); } catch {} };
process.on('exit', () => { if (!argv.includes('--keep-runtime')) stopRt(); });
for (let i = 0; i < 60 && !(await health(RT_PORT)); i++) await new Promise((r) => setTimeout(r, 1000));
if (!(await health(RT_PORT))) { console.error('  ✖ нэр дэвшигчийн runtime 60 с-д асаагүй'); process.exit(3); }
const info = await (await fetch(`http://127.0.0.1:${RT_PORT}/health`)).json();
log(`runtime амьд: ${JSON.stringify(info)}`);

// 3. suite-ууд
const label = `candidate:${RUN}`;
const run = (script, args) => execFileSync(process.execPath, [join(AI, 'evaluation', script), ...args], { stdio: 'inherit', cwd: AI, env: process.env });
const newest = (prefix) => readdirSync(BENCH).filter((f) => f.startsWith(prefix) && f.endsWith('.json')).map((f) => ({ f, t: statSync(join(BENCH, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0]?.f;
log('held-out (38 кейс)…');
run('heldout-gen.mjs', ['--api', API, '--rt', `http://127.0.0.1:${RT_PORT}`, '--label', label]);
const candHeldout = newest(`heldout-gen-candidate_${RUN}`);
log('алтан A–O (--gen)…');
run('conversation-e2e.mjs', ['--gen', '--api', API, '--rt', `http://127.0.0.1:${RT_PORT}`, '--label', label]);
const candConv = newest('conv-e2e-gen-');

// 4. харьцуулалт
log(`харьцуулалт: суурь ${BASE_HELDOUT} vs ${candHeldout}`);
const extra = flag('extra-heldout', null);
run('compare-candidate.mjs', ['--candidate', RUN, '--base-heldout', BASE_HELDOUT, '--cand-heldout', candHeldout, '--base-conv', BASE_CONV, '--cand-conv', candConv, ...(extra ? ['--extra-heldout', extra, '--extra-label', flag('extra-label', 'previous')] : [])]);
const reports = join(AI, 'training', 'reports');
const cmp = readdirSync(reports).filter((f) => f.startsWith('candidate-vs-baseline-') && f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(reports, f), 'utf8'))).filter((r) => r.candidate === RUN).sort((a, b) => String(a.compared_at).localeCompare(String(b.compared_at))).at(-1);
log(`ДҮГНЭЛТ: ${cmp?.verdict}  (raw ${cmp?.raw?.baseline?.raw_pass_pct}% → ${cmp?.raw?.candidate?.raw_pass_pct}% · final ${cmp?.raw?.baseline?.final_pass_pct}% → ${cmp?.raw?.candidate?.final_pass_pct}%)`);
if (!argv.includes('--keep-runtime')) { stopRt(); log('нэр дэвшигчийн runtime зогсоов'); }
