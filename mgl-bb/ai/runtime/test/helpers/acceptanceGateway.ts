/**
 * TEST_ONLY · NON_PRODUCTION · NO_MODEL_LOAD
 *
 * ТУСГААРЛАСАН БОДИТ-ЗАГВАРЫН ХҮЛЭЭН АВАЛТЫН GATEWAY (Session R, Checkpoint 3C §3).
 *
 *   Revit add-in ─→ ЭНЭ gateway :39307 ─→ ХУВААЛЦСАН хөдөлгүүр (`@mgl/mglai-common/turn`, runtime-ийн
 *                                          `handleTurn` — ижил код, ӨӨР тээвэр л)
 *                                             ├→ ЛОКАЛ dev backend (wrangler dev, локал D1 хуулбар) — прод биш
 *                                             └→ АЖИЛТНЫ runtime :39217 — /norm + /generate Л (загвар ТЭНД)
 *
 * ⚠️ Загвар ЭНД АЧААЛАГДАХГҮЙ.  Энэ процесс нь оркестрацийн хост; Qwen нь :39217-ийн л.
 * ⚠️ :39217-д амьдралын мөчлөгийн үйлдэл ХЭЗЭЭ Ч хийхгүй — зөвхөн /health, /info, /norm, /generate уншина.
 * ⚠️ Нууц: канон `MGLAI_DATA_DIR ?? %LOCALAPPDATA%/MglAi/secret.txt`-ийг САНАХ ОЙД л уншина
 *    (Session B-ийн layout); логд, хариуд, тайланд ХЭЗЭЭ Ч гарахгүй.  Revit-ээс ирсэн `X-MglAi-Secret`
 *    нь тэр файлтай тогтмол-хугацаат харьцуулалтаар таарах ёстой (loopback + нууц = хоёр давхарга).
 * ⚠️ ERP токен: Revit-ийн илгээсэн `erp_token` (ПРОД токен) ХАЯГДАНА — локал backend түүнийг таньдаггүй,
 *    мөн прод итгэмжлэл энэ туршилтын замд огт орох ёсгүй.  Оронд нь gateway локал backend-д
 *    `MGLAI_TEST_USER`/`MGLAI_TEST_PASS`-аар нэвтэрч тэр токеныг `pairedToken` болгоно.
 * ⚠️ Хэмжилт: ээлж бүрийн `ai` үйл явдлыг ажиглаж plan/context/first-token/total мс, токены тоо,
 *    stopReason, гэрээний төрөл, эх сурвалжийн шошгыг `--metrics <файл>`-д JSONL-ээр бичнэ
 *    (нууц, токен ОРОХГҮЙ; хариултын текст орно — синтетик fixture тул ERP-ийн нууц өгөгдөл байхгүй).
 *
 *   node runtime/test/helpers/acceptanceGateway.ts --port 39307 --backend http://127.0.0.1:3010 \
 *        --runtime http://127.0.0.1:39217 --metrics <file>
 *
 * Амьдралын мөчлөг: ЗӨВХӨН `isolatedRuntime.ts start --entry runtime/test/helpers/acceptanceGateway.ts`
 * (PID + үүссэн цаг + порт нотолгоо) — нэрээр/загвараар зогсоохгүй.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import { handleTurn, type TurnHostDeps } from '../../src/turn.ts';
import { safeEqual } from '../../src/auth.ts';

const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(k);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : d;
};

const PORT = Number(arg('--port', '39307'));
const BACKEND = (arg('--backend', 'http://127.0.0.1:3010') as string).replace(/\/+$/, '');
const RUNTIME = (arg('--runtime', 'http://127.0.0.1:39217') as string).replace(/\/+$/, '');
const METRICS = arg('--metrics');
const FORBIDDEN_PORTS = new Set([39217, 39227]);

if (FORBIDDEN_PORTS.has(PORT)) {
  console.error(`acceptanceGateway: порт ${PORT} хориотой (ажилтны runtime / өөр сесс).`);
  process.exit(2);
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BACKEND)) {
  console.error('acceptanceGateway: backend нь ЗӨВХӨН loopback (прод Worker ХОРИОТОЙ).');
  process.exit(2);
}
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(RUNTIME)) {
  console.error('acceptanceGateway: runtime нь ЗӨВХӨН 127.0.0.1.');
  process.exit(2);
}

/** Канон нууцын байршил (ai/deployment/src/layout.ts · runtime config.ts secretFile). */
function readSecret(): string {
  const base = platform() === 'win32' ? (process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')) : (process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'));
  // --secret-dir нь isolatedRuntime-ийн MGLAI_DATA_DIR (тусгаарласан хавтас)-аас ДЭЭГҮҮР: gateway нь
  // АЖИЛТНЫ runtime-ийн канон нууцыг л уншина (тэр runtime-тай ярих тул).
  const dataDir = arg('--secret-dir') ?? process.env.MGLAI_DATA_DIR ?? join(base, 'MglAi');
  const p = join(dataDir, 'secret.txt');
  if (!existsSync(p)) throw new Error('secret.txt алга — runtime суулгаагүй');
  const s = readFileSync(p, 'utf8').trim();
  if (s.length < 16) throw new Error('secret.txt хэт богино');
  return s;
}
const SECRET = readSecret(); // санах ойд л

/* ---- локал backend-д нэвтрэх (прод токен ХЭЗЭЭ Ч хэрэглэхгүй) ---- */
let erpToken: string | null = null;
async function loginLocal(): Promise<string | null> {
  if (erpToken) return erpToken;
  const user = process.env.MGLAI_TEST_USER ?? 'A.Anand';
  const pass = process.env.MGLAI_TEST_PASS ?? 'admin123';
  try {
    const r = await fetch(`${BACKEND}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) {
      console.error(`acceptanceGateway: локал backend login ${r.status}`);
      return null;
    }
    const j = (await r.json()) as { token?: string };
    erpToken = typeof j.token === 'string' ? j.token : null;
    return erpToken;
  } catch (err) {
    console.error(`acceptanceGateway: локал backend хүрэхгүй (${(err as Error).message})`);
    return null;
  }
}

async function runtimeInfo(): Promise<unknown> {
  const r = await fetch(`${RUNTIME}/info`, { headers: { 'X-MglAi-Secret': SECRET }, signal: AbortSignal.timeout(5_000) });
  if (!r.ok) throw new Error(`runtime /info ${r.status}`);
  return r.json();
}

const deps: TurnHostDeps = {
  controlPlaneUrl: BACKEND,
  selfUrl: RUNTIME,
  secret: SECRET,
  pairedToken: loginLocal,
  runtimeInfo,
};

/* ---- хэмжилт: SSE-г ажиглах бүрхүүл ---- */
interface TurnMetric {
  at: string;
  question: string;
  surface: string | null;
  revit_context: boolean;
  plan_ms: number | null;
  context_ms: number | null;
  first_token_ms: number | null;
  total_ms: number | null;
  tokens: number;
  stopReason: string | null;
  engine: string | null;
  error: string | null;
  contract: unknown;
  citations: unknown;
  source_labels: string[];
  stages: string[];
  answer: string | null;
  /** Загварын ТҮҮХИЙ токенууд (засварын өмнөх) — TEST_ONLY оношилгоо. */
  raw_text: string;
  /** Add-in-ийн илгээсэн тайлангийн нотолгоо (revit_context.report) — тоог тулгахад (TEST_ONLY). */
  report_wire: unknown;
  convStateNext: unknown;
}

function observeResponse(res: ServerResponse, m: TurnMetric): void {
  const t0 = performance.now();
  const origWrite = res.write.bind(res);
  let lastStage: Record<string, number> = {};
  (res as unknown as { write: (chunk: unknown) => boolean }).write = (chunk: unknown) => {
    try {
      const s = String(chunk);
      const ev = /^event: (\S+)\n/.exec(s)?.[1];
      const data = /\ndata: (.*)\n\n$/s.exec(s)?.[1];
      if (ev && data) {
        const j = JSON.parse(data) as Record<string, unknown>;
        if (ev === 'ai') {
          const type = String(j.type);
          const stage = j.stage ? String(j.stage) : '';
          if (type === 'stage.started') lastStage[stage] = performance.now();
          if (type === 'stage.completed') {
            const d = Math.round(performance.now() - (lastStage[stage] ?? t0));
            m.stages.push(`${stage}:${d}ms`);
            if (stage === 'plan') m.plan_ms = d;
            if (stage === 'context') m.context_ms = d;
          }
          if (type === 'token') {
            m.tokens += 1;
            m.raw_text += String(j.text ?? '');
            if (m.first_token_ms === null) m.first_token_ms = Math.round(performance.now() - t0);
          }
          if (type === 'source.found' && j.source && typeof j.source === 'object') {
            const src = j.source as { label?: string; kind?: string };
            m.source_labels.push(`${src.kind ?? '?'}:${src.label ?? ''}`);
          }
          if (type === 'failed') m.error = String(j.code);
        } else if (ev === 'result') {
          m.total_ms = Math.round(performance.now() - t0);
          m.stopReason = (j.stopReason as string | null) ?? null;
          m.engine = (j.engine as string | null) ?? null;
          m.error = j.error && typeof j.error === 'object' ? String((j.error as { code?: string }).code) : m.error;
          m.contract = j.contractDiag ?? null;
          m.citations = j.citations ?? null;
          m.answer = typeof j.answer === 'string' ? j.answer : null;
          m.convStateNext = j.convStateNext ?? null;
        } else if (ev === 'error') {
          m.error = String(j.name ?? 'error');
        }
      }
    } catch {
      /* хэмжилт хэзээ ч урсгалыг эвдэхгүй */
    }
    return origWrite(chunk as never);
  };
  res.on('finish', () => {
    if (m.total_ms === null) m.total_ms = Math.round(performance.now() - t0);
    if (METRICS) appendFileSync(METRICS, JSON.stringify(m) + '\n');
    console.log(`[turn] ${m.total_ms} ms · plan ${m.plan_ms} · context ${m.context_ms} · first token ${m.first_token_ms} · tokens ${m.tokens} · stop ${m.stopReason} · error ${m.error ?? '-'}`);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 2_000_000) reject(new Error('body too large')); });
    req.on('end', () => resolve(s));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/health') return json(res, 200, { service: 'mgl-ai-acceptance-gateway', ok: true, TEST_ONLY: true, NON_PRODUCTION: true, NO_MODEL_LOAD: true, backend: BACKEND, runtime: RUNTIME });
  // Нууцын давхарга — Revit-ийн LocalAppDataAuthProvider ижил файлыг уншдаг.
  const given = req.headers['x-mglai-secret'];
  if (typeof given !== 'string' || !safeEqual(given, SECRET)) return json(res, 401, { error: 'Нэвтрэх эрхгүй.', code: 'no_credential' });
  if (url.pathname === '/info' && req.method === 'GET') {
    try { return json(res, 200, { gateway: 'TEST_ONLY', upstream: await runtimeInfo() }); } catch (e) { return json(res, 503, { error: (e as Error).message }); }
  }
  if (url.pathname === '/turn' && req.method === 'POST') {
    let raw: unknown;
    try { raw = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'JSON', code: 'bad_request' }); }
    const body = raw as Record<string, unknown>;
    // ⚠️ Revit-ийн ПРОД erp_token-ийг ХАЯНА — локал backend-ийн токен л (pairedToken).
    delete body.erp_token;
    const m: TurnMetric = {
      at: new Date().toISOString(), question: String(body.question ?? ''), surface: (body.surface as string) ?? null,
      revit_context: body.revit_context != null, plan_ms: null, context_ms: null, first_token_ms: null, total_ms: null,
      tokens: 0, stopReason: null, engine: null, error: null, contract: null, citations: null, source_labels: [], stages: [], answer: null, raw_text: '', report_wire: (body.revit_context as { report?: unknown } | null)?.report ?? null, convStateNext: null,
    };
    observeResponse(res, m);
    return handleTurn(req, res, body, deps);
  }
  return json(res, 404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`acceptanceGateway TEST_ONLY NON_PRODUCTION NO_MODEL_LOAD · 127.0.0.1:${PORT} → backend ${BACKEND} · runtime ${RUNTIME}`);
});
