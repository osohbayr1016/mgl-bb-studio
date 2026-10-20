/**
 * ТУСГААРЛАСАН ТЕСТ RUNTIME-ИЙН АМЬДРАЛЫН МӨЧЛӨГ (Session R, 2026-09-14).
 *
 * ⚠️ ЯАГААД ОРШИНО: 2026-09-14-нд «runtime/src/server.ts» гэсэн ЗАГВАРААР процесс
 *    зогсоосон нь АЖИЛТНЫ ЖИНХЭНЭ runtime (:39217) ба ӨӨР сессийн үнэлгээний
 *    runtime (:39227)-ийг ХАМТ алсан.  Энэ туслах нь ЗӨВХӨН өөрийн асаасан
 *    процессыг, ЗӨВХӨН нотолгоотойгоор зогсооно.
 *
 *   spawn  → яг PID + үүссэн цаг (CIM CreationDate) + порт + эзэмшлийн тэмдэг → state файл
 *   stop   → PID амьд эсэх · CreationDate таарах эсэх · командын мөр runtime мөн эсэх ·
 *            портыг ЯГ тэр PID эзэмшиж байгаа эсэх — АЛЬ НЭГ нь батлагдахгүй бол ЗОГСООХГҮЙ.
 *
 * Хориотой: taskkill/Stop-Process нэрээр, командын мөрийн загвараар, портын бүдэг хайлтаар.
 * Session R-ийн тестийн порт: 39307 (39217 = ажилтны runtime, 39227 = өөр сесс — ХЭЗЭЭ Ч).
 *
 *   node runtime/test/helpers/isolatedRuntime.ts start  --port 39307 --data <dir> [--engine-port 39308]
 *   node runtime/test/helpers/isolatedRuntime.ts status --state <file>
 *   node runtime/test/helpers/isolatedRuntime.ts stop   --state <file>
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, openSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { platform } from 'node:os';

export const SESSION_R_TEST_PORT = 39307;
export const FORBIDDEN_PORTS = new Set([39217, 39227]);

export interface OwnedRuntime {
  pid: number;
  port: number;
  enginePort: number;
  dataDir: string;
  /** CIM `CreationDate` (ISO) — PID дахин ашиглагдсан эсэхийг ялгана. */
  createdAt: string | null;
  /** Санамсаргүй тэмдэг — env `MGLAI_TEST_OWNER`-т очно; командын мөрөнд ХАРАГДАХГҮЙ тул нэмэлт л. */
  owner: string;
  startedBy: 'session-r';
  serverEntry: string;
}

interface CimProcess {
  pid: number;
  createdAt: string | null;
  commandLine: string;
}

function cimProcess(pid: number): CimProcess | null {
  if (platform() !== 'win32') return null;
  try {
    const out = execFileSync('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if ($p) { [Console]::Out.Write((@{ pid = $p.ProcessId; created = $p.CreationDate.ToUniversalTime().ToString('o'); cmd = $p.CommandLine } | ConvertTo-Json -Compress)) }`,
    ], { encoding: 'utf8', timeout: 15_000 });
    if (!out.trim()) return null;
    const j = JSON.parse(out) as { pid: number; created: string; cmd: string | null };
    return { pid: j.pid, createdAt: j.created ?? null, commandLine: j.cmd ?? '' };
  } catch {
    return null;
  }
}

function portOwner(port: number): number | null {
  if (platform() !== 'win32') return null;
  try {
    const out = execFileSync('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { [Console]::Out.Write($c.OwningProcess) }`,
    ], { encoding: 'utf8', timeout: 15_000 });
    const n = Number(out.trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export interface StartOptions {
  port?: number;
  enginePort?: number;
  dataDir: string;
  aiDir: string;
  stateFile: string;
  logFile?: string;
  extraEnv?: Record<string, string>;
  /** Асаах Node файл (aiDir-ээс харьцангуй); өгөгдмөл runtime/src/server.ts.  TEST_ONLY gateway ч энд. */
  entry?: string;
  /** Нэмэлт командын мөрийн аргумент (entry-ийн дараа). */
  args?: string[];
}

export async function startIsolatedRuntime(o: StartOptions): Promise<OwnedRuntime> {
  const port = o.port ?? SESSION_R_TEST_PORT;
  if (FORBIDDEN_PORTS.has(port)) throw new Error(`Порт ${port} нь өөр эзэнтэй (ажилтны runtime / өөр сесс) — ЗӨВШӨӨРӨХГҮЙ.`);
  const owner = portOwner(port);
  if (owner !== null) throw new Error(`Порт ${port}-ыг PID ${owner} аль хэдийн эзэмшиж байна — ӨӨР процессыг ЗОГСООХГҮЙ, өөр порт сонго.`);
  mkdirSync(o.dataDir, { recursive: true });
  mkdirSync(dirname(o.stateFile), { recursive: true });
  const ownerTag = `session-r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const serverEntry = resolve(o.aiDir, o.entry ?? join('runtime', 'src', 'server.ts'));
  const log = o.logFile ?? join(o.dataDir, 'isolated-runtime.log');
  const logFd = openSync(log, 'a');
  const child = spawn(process.execPath, [serverEntry, ...(o.args ?? [])], {
    cwd: o.aiDir,
    env: {
      ...process.env,
      MGLAI_PORT: String(port),
      MGLAI_ENGINE_PORT: String(o.enginePort ?? port + 1),
      MGLAI_DATA_DIR: o.dataDir,
      MGLAI_TEST_OWNER: ownerTag,
      NODE_OPTIONS: '--dns-result-order=ipv4first',
      ...(o.extraEnv ?? {}),
    },
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  const pid = child.pid!;
  // /health хүлээх
  const deadline = Date.now() + 60_000;
  let up = false;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) { up = true; break; }
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  const cim = cimProcess(pid);
  const rec: OwnedRuntime = {
    pid, port, enginePort: o.enginePort ?? port + 1, dataDir: o.dataDir,
    createdAt: cim?.createdAt ?? null, owner: ownerTag, startedBy: 'session-r', serverEntry,
  };
  writeFileSync(o.stateFile, JSON.stringify(rec, null, 2));
  if (!up) throw new Error(`Runtime ${pid} /health-д 60 с дотор хариулсангүй (лог: ${log}).  State файл бичигдсэн — 'stop'-оор нотолгоотой зогсооно.`);
  return rec;
}


export type OwnershipVerdict =
  | { ok: true; reasons: string[] }
  | { ok: false; reasons: string[] };

/** Нотолгооны дөрвөн шалгалт — бүгд ЗААВАЛ. */
export function verifyOwnership(rec: OwnedRuntime): OwnershipVerdict {
  const reasons: string[] = [];
  const cim = cimProcess(rec.pid);
  if (!cim) return { ok: false, reasons: ['PID амьд биш эсвэл CIM уншигдсангүй'] };
  reasons.push(`pid ${rec.pid} амьд`);
  if (rec.createdAt && cim.createdAt) {
    const dt = Math.abs(new Date(cim.createdAt).getTime() - new Date(rec.createdAt).getTime());
    if (dt > 2000) return { ok: false, reasons: [...reasons, `үүссэн цаг зөрсөн (${cim.createdAt} ≠ ${rec.createdAt}) — PID дахин ашиглагдсан`] };
    reasons.push('үүссэн цаг таарав');
  }
  const normalized = cim.commandLine.replace(/\\/g, '/').toLowerCase();
  // Командын мөр ЯГ бүртгэсэн entry-г агуулах ёстой (runtime server, эсвэл TEST_ONLY gateway).
  if (!normalized.includes(rec.serverEntry.replace(/\\/g, '/').toLowerCase())) {
    return { ok: false, reasons: [...reasons, `командын мөр бүртгэсэн entry биш: ${cim.commandLine.slice(0, 80)}`] };
  }
  reasons.push('командын мөр = бүртгэсэн entry');
  const owner = portOwner(rec.port);
  if (owner !== rec.pid) return { ok: false, reasons: [...reasons, `порт ${rec.port}-ыг PID ${owner ?? 'хэн ч'} эзэмшиж байна, ${rec.pid} биш`] };
  reasons.push(`порт ${rec.port} = pid ${rec.pid}`);
  if (FORBIDDEN_PORTS.has(rec.port)) return { ok: false, reasons: [...reasons, 'хориотой порт'] };
  return { ok: true, reasons };
}

export function stopIsolatedRuntime(stateFile: string): { stopped: boolean; verdict: OwnershipVerdict } {
  if (!existsSync(stateFile)) return { stopped: false, verdict: { ok: false, reasons: ['state файл алга'] } };
  const rec = JSON.parse(readFileSync(stateFile, 'utf8')) as OwnedRuntime;
  const verdict = verifyOwnership(rec);
  if (!verdict.ok) return { stopped: false, verdict };
  try {
    process.kill(rec.pid, 'SIGTERM');
  } catch (err) {
    return { stopped: false, verdict: { ok: false, reasons: [...verdict.reasons, `kill унав: ${(err as Error).message}`] } };
  }
  return { stopped: true, verdict };
}

/* ---- CLI ---- */
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('helpers/isolatedRuntime.ts')) {
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = (k: string, d?: string) => { const i = rest.indexOf(k); return i >= 0 && rest[i + 1] ? rest[i + 1]! : d; };
  const stateFile = arg('--state', join(process.cwd(), '.isolated-runtime.json'))!;
  (async () => {
    if (cmd === 'start') {
      const rec = await startIsolatedRuntime({
        port: Number(arg('--port', String(SESSION_R_TEST_PORT))),
        enginePort: arg('--engine-port') ? Number(arg('--engine-port')) : undefined,
        dataDir: arg('--data')!, aiDir: arg('--ai', process.cwd())!, stateFile,
        entry: arg('--entry'),
        args: arg('--args') ? arg('--args')!.split(/\s+/).filter(Boolean) : undefined,
      });
      console.log(JSON.stringify(rec, null, 2));
    } else if (cmd === 'status') {
      const rec = JSON.parse(readFileSync(stateFile, 'utf8')) as OwnedRuntime;
      console.log(JSON.stringify(verifyOwnership(rec), null, 2));
    } else if (cmd === 'stop') {
      const r = stopIsolatedRuntime(stateFile);
      console.log(JSON.stringify(r, null, 2));
      if (!r.stopped) process.exitCode = 2;
    } else {
      console.error('usage: isolatedRuntime.ts start|status|stop');
      process.exitCode = 1;
    }
  })().catch((e) => { console.error(String(e)); process.exitCode = 1; });
}
