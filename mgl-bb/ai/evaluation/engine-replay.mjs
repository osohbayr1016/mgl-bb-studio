#!/usr/bin/env node
/**
 * ХӨТӨЧТЭЙ ЯГ ИЖИЛ ЗАМААР АСУУЛТ ДАМЖУУЛАХ (2026-09-28).
 *
 *   node evaluation/engine-replay.mjs --questions q.json [--api http://127.0.0.1:3000/api]
 *        [--rt http://127.0.0.1:39217] [--secret-file <path>] [--user A.Anand --password admin123] [--events]
 *
 * `q.json` = асуултын массив; бүгд НЭГ ярианд дараалан (convState + түүх дамжина).
 *
 * ⚠️ ЯАГААД.  `lib/e2e.mjs`-ийн GEN горим `templateOnly`-г ҮЛ ТООДОГ (загварыг үргэлж дууддаг) тул эзний бодит чатыг
 *    давтахад хөтчөөс ӨӨР хариулт гардаг байв; өмнөх сессүүд scratchpad-т «hl-recheck.mjs» бичээд алдсан.  Энэ скрипт
 *    хуваалцсан engine-ийн `runTurn`-ийг (packages/mglai-common — хөтөч · runtime /turn · Revit ИЖИЛ) fetch-тээвэртэй
 *    шууд дууддаг: plan → tool → /norm → /context → (templateOnly бол template, эс бөгөөс /generate → гэрээ) → /messages.
 *
 * ⚠️ Бодит backend ба runtime рүү ХҮСЭЛТ илгээнэ — /messages яриаг ХАДГАЛНА.  Прод руу биш, локал/scratch backend руу
 *    ажиллуул (`wrangler dev --persist-to <хуулбар>`).  Загваргүй шалгалтад runtime-ийг `MGLAI_ENGINE=echo`-оор тусдаа
 *    порт, тусдаа `MGLAI_DATA_DIR`-тэй асаа (үйлдвэрлэлийн `MglAi` төлөвийг хөндөхгүй).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : (argv[i + 1] ?? d);
};
const API = flag('api', 'http://127.0.0.1:3000/api');
const RT = flag('rt', 'http://127.0.0.1:39217');
const SECRET_FILE = flag('secret-file', join(process.env.LOCALAPPDATA ?? '', 'MglAi', 'secret.txt'));
const QFILE = flag('questions', null);
const EVENTS = argv.includes('--events');
if (!QFILE) {
  console.error('  --questions <json массив> шаардлагатай');
  process.exit(1);
}

const TURN = new URL('../../packages/mglai-common/src/turn/', import.meta.url);
const { runTurn } = await import(new URL('engine.ts', TURN).href);
const { createBackendTransport, createLocalRuntimeTransport } = await import(new URL('fetchTransports.ts', TURN).href);

const secret = readFileSync(SECRET_FILE, 'utf8').trim();
const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: flag('user', 'A.Anand'), password: flag('password', 'admin123') }),
});
const lj = await login.json().catch(() => ({}));
const token = lj.token ?? lj.access_token;
if (!token) {
  console.error(`  ✖ нэвтрэлт амжилтгүй (${login.status})`);
  process.exit(2);
}
const backend = createBackendTransport({ apiBase: API, token: () => token, defaultTimeoutMs: 60_000 });
const runtime = createLocalRuntimeTransport({ baseUrl: RT, headers: () => ({ 'X-MglAi-Secret': secret }), normTimeoutMs: 20_000 });

const questions = JSON.parse(readFileSync(QFILE, 'utf8'));
const convUid = crypto.randomUUID();
let convState = null;
const history = [];
let seq = 1;
for (const q of questions) {
  const warnings = [];
  const r = await runTurn(
    {
      question: q,
      convUid,
      userMsgUid: crypto.randomUUID(),
      aiMsgUid: crypto.randomUUID(),
      seq,
      history: [...history],
      convState,
      runtime: { installed: true, authorized: true, info: {} },
      mode: 'admin',
      signal: new AbortController().signal,
      emit: (e) => {
        if (e.type === 'warning' && e.safeUserMessage) warnings.push(e.safeUserMessage);
        if (EVENTS && e.type !== 'token' && e.type !== 'heartbeat') console.log(`   · ${e.type} ${e.stage ?? ''} ${e.safeUserMessage ?? ''} ${JSON.stringify(e.metadata ?? {}).slice(0, 160)}`);
      },
    },
    { backend, runtime },
  );
  console.log(`════ Q: ${q}`);
  console.log(r.answer);
  console.log(`  ── stop: ${r.stopReason} · error: ${r.error?.code ?? '—'} · гэрээ: ${r.contractDiag?.final ?? '—'} · итгэл: ${JSON.stringify(r.confidence ?? null)}${warnings.length ? ` · анхааруулга: ${warnings.join(' / ')}` : ''}`);
  convState = r.convStateNext ?? convState;
  history.push({ role: 'user', content: q }, { role: 'assistant', content: r.answer });
  seq += 2;
}
