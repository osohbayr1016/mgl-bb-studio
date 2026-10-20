/**
 * MGL AI · СУПЕРВАЙЗЕРИЙН ОРОЛТ (Session B §9).
 *
 *   node deployment/bin/supervise.ts            мөчлөг (Task Scheduler-ийн action)
 *   node deployment/bin/supervise.ts --once     нэг удаа асаагаад гарна
 *   node deployment/bin/supervise.ts --status   lock/порт төлөв, JSON
 *   node deployment/bin/supervise.ts --stop     lock дахь PID-ийг зөөлөн зогсооно
 *
 * `installer/bootstrap.ps1` нь Task Scheduler-ийн action-ыг `node server.ts`-ээс
 * ЭНЭ файл руу шилжүүлнэ (P1) — ингэснээр bootstrap-ийн task ба `start.ps1
 * -Supervise` хоёр ӨӨР супервайзер байхаа болино: хоёулаа `supervisor.ts`-ийн
 * НЭГ мөчлөг (lock + порт шалгалт → давхар процесс ХЭЗЭЭ Ч үүсэхгүй).
 *
 * ⚠️ ЗАГВАР АЧААЛАХГҮЙ.  Зөвхөн хөнгөн node процессыг амьд байлгана
 *    (runtime-ийн өөрийн шийдвэр — `/warmup` дээр ачаална).
 *
 * Орчны хувьсагч: MGLAI_DATA_DIR, MGLAI_PORT (runtime-тэй ижил),
 *   MGLAI_RUNTIME_ENTRY (өгөгдмөл: энэ файлын хажуугийн ../../runtime/src/server.ts).
 */
import { spawn } from 'node:child_process';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { openSync, closeSync, statSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { createLogger } from '../src/logger.ts';
import { resolveLayout, ensureLayout } from '../src/layout.ts';
import { Supervisor, type ChildHandle, type SupervisorDeps } from '../src/supervisor.ts';
import { readPointer, readUpdateState } from '../src/activation.ts';
import { applyInstallEnv } from '../src/installEnv.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileP = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));
// Суулгацын орчин (--data-dir / MGLAI_DATA_DIR / state/runtime-env.json) — хүүхэд runtime-д ч өвлөгдөнө.
applyInstallEnv();
const layout = resolveLayout();
await ensureLayout(layout);
const port = Number(process.env.MGLAI_PORT ?? 39217);
/**
 * Runtime-ийн entry-г ЗААГЧААС уншина (§13): app/current.runtime.json → <path>/runtime/src/server.ts.
 * Заагч байхгүй (bootstrap-ийн хуучин шууд `app/`, эсвэл dev repo) бол хажуугийн runtime.
 * ⚠️ Спавн БҮРД дахин уншина — runtime-код шинэчлэгдэж заагч солигдвол дараагийн асаалт
 *    ШИНЭ хувилбараас явна, супервайзер өөрөө дахин асах шаардлагагүй.
 */
async function resolveEntry(): Promise<string> {
  if (process.env.MGLAI_RUNTIME_ENTRY) return process.env.MGLAI_RUNTIME_ENTRY;
  const p = await readPointer(layout, 'runtime');
  if (p) return resolve(p.path, 'runtime', 'src', 'server.ts');
  return resolve(here, '..', '..', 'runtime', 'src', 'server.ts');
}
let entry = await resolveEntry();
const log = createLogger({ dir: layout.logs, category: 'supervisor' });

async function readLock(): Promise<{ pid: number; startedAt: string } | null> {
  try {
    const v = JSON.parse(await readFile(layout.supervisorLock, 'utf8')) as { pid?: unknown; startedAt?: unknown };
    return typeof v.pid === 'number' && typeof v.startedAt === 'string' ? { pid: v.pid, startedAt: v.startedAt } : null;
  } catch {
    return null;
  }
}

async function probe(): Promise<boolean | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return false;
    const body = (await res.json().catch(() => null)) as { service?: string } | null;
    return body?.service === 'mgl-ai-runtime' ? true : false;
  } catch {
    return null;
  }
}

const deps: SupervisorDeps = {
  async spawn(): Promise<ChildHandle> {
    entry = await resolveEntry();
    // ⚠️ Windows дээр libuv нь хүүхэд процессыг эцгийн job object-д хийдэг —
    //    `--once` (асаагаад гарах) горимд detached БИШ бол супервайзер гармагц
    //    runtime ч хамт үхнэ (хэмжсэн 2026-09-11).  Мөчлөгийн горимд эсрэгээр:
    //    супервайзер алагдвал runtime ч алагдах нь зөв (өнчин процесс үлдэхгүй).
    const detached = arg === '--once';
    // Runtime-ийн stdout/stderr → logs/runtime-stdout.log (start.ps1-ийн runtime.log-ийн орлуулагч).
    // 5 MB давбал спавн бүрд .1 болгож эргүүлнэ — хязгааргүй өсөхгүй.
    const stdoutLog = join(layout.logs, 'runtime-stdout.log');
    try {
      if (statSync(stdoutLog).size > 5 * 1024 * 1024) renameSync(stdoutLog, `${stdoutLog}.1`);
    } catch {
      /* байхгүй — эхний удаа */
    }
    const out = openSync(stdoutLog, 'a');
    const child = spawn(process.execPath, [entry], {
      cwd: dirname(entry),
      env: { ...process.env },
      stdio: ['ignore', out, out],
      windowsHide: true,
      detached,
    });
    closeSync(out);
    if (detached) child.unref();
    const exited = new Promise<{ code: number | null; signal: string | null }>((res) => {
      child.on('exit', (code, signal) => res({ code, signal }));
      child.on('error', () => res({ code: -1, signal: null }));
    });
    return { pid: child.pid ?? -1, exited, kill: (sig) => child.kill(sig ?? 'SIGTERM') };
  },
  probe,
  async pidAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
  readLock,
  readUpdateState: async () => {
    const s = await readUpdateState(layout);
    return s ? { phase: s.phase, startedAt: s.startedAt } : null;
  },
  /**
   * P0-2: lock дахь PID ҮНЭХЭЭР runtime мөн үү — Windows PID-ийг дахин ашигладаг тул
   * гэнэтийн унтралтын дараах lock нь хөтчийн процесс руу заасан байж болно.
   */
  async pidIsRuntime(pid) {
    if (process.platform !== 'win32') return null;
    try {
      const { stdout } = await execFileP('powershell', [
        '-NoProfile',
        '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object -ExpandProperty CommandLine)`,
      ]);
      return /server\.ts/.test(stdout);
    } catch {
      return null;
    }
  },
  async writeLock(v) {
    if (v === null) await rm(layout.supervisorLock, { force: true });
    else await writeFile(layout.supervisorLock, JSON.stringify(v), 'utf8');
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
  log: (level, msg, data) => log[level](msg, data),
};

const arg = process.argv.slice(2).find((a) => a.startsWith('--') && a !== '--data-dir') ?? '';
const sup = new Supervisor(deps);

if (arg === '--status') {
  const lock = await readLock();
  const alive = lock ? await deps.pidAlive(lock.pid) : false;
  process.stdout.write(`${JSON.stringify({ lock, pidAlive: alive, port, health: await probe() })}\n`);
} else if (arg === '--stop') {
  const lock = await readLock();
  if (lock && (await deps.pidAlive(lock.pid))) {
    try {
      process.kill(lock.pid, 'SIGTERM');
    } catch {
      /* аль хэдийн үхсэн */
    }
  }
  await deps.writeLock(null);
  process.stdout.write('stopped\n');
} else if (arg === '--once') {
  const r = await sup.startOnce();
  process.stdout.write(`${JSON.stringify(r)}\n`);
  process.exit(r.ok || r.code === 'ALREADY_RUNNING' ? 0 : 1);
} else {
  const stop = () => void sup.stop().finally(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  await sup.supervise();
}
