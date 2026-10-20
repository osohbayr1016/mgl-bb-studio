/**
 * MGL AI deployment · RUNTIME ШИНЭЧЛЭЛТ → ДАХИН АСААЛТ → HEALTH → БУЦААЛТ — ИНТЕГРАЦ (P0-1, P0-2).
 *
 * Run with:  node --test deployment/test/restartChain.test.ts
 *
 * БОДИТ процессууд: `src/supervisor.ts` (fixture runtime-ийг заагчаас спавнана) +
 * `src/activation.ts` (`runUpdate` + `ProcessCoordinator`).  «Runtime» нь
 * `fixtures/fakeRuntime.ts` — загваргүй, 40 мс-д асна.  Qwen GGUF ОГТ хөндөгдөхгүй.
 *
 *   1. амжилттай шинэчлэлт v1 → v2:   ACTIVATED, процесс 1.2.0, lastKnownGood=rel-2
 *   2. шинэ runtime асахгүй:          RESTART_FAILED → буцаалт → v1 ажиллаж байна
 *   3. асаад ч БУРУУ хувилбар:        VERSION_MISMATCH → буцаалт
 *   4. health унана:                  HEALTH_FAILED_ROLLED_BACK → буцаалт
 *   5. smoke дундуур унана:           HEALTH_FAILED_ROLLED_BACK (супервайзер зориудын гарц гэж үзэж ШУУД асаана)
 *   6. буцаалт ч унана:               ROLLBACK_FAILED, rollbackOk=false, шалтгаан last-update.json-д
 *   7. «reboot»: шинэ супервайзер заагчаас ЗӨВ хувилбарыг асаана; хуучирсан lock (үхсэн PID) цэвэрлэгдэнэ
 *
 * ⚠️ Супервайзер шинэчлэлтийн явцад ХУУЧИН хувилбарыг санамсаргүй асаах боломжгүй:
 *    заагч зогсоолтоос ӨМНӨ солигдоно, спавн бүр заагчаас уншина.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import { resolveLayout, ensureLayout } from '../src/layout.ts';
import { InstalledStateStore } from '../src/installedState.ts';
import { validateManifest } from '../src/manifest.ts';
import { planUpdate } from '../src/updatePlan.ts';
import { runUpdate, readPointer, readUpdateState, lastUpdateFile, type UpdateDeps, type ProcessCoordinator, type LastUpdateRecord } from '../src/activation.ts';
import { readJson } from '../src/integrity.ts';
import { Supervisor, type ChildHandle, type SupervisorDeps } from '../src/supervisor.ts';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, 'fixtures', 'fakeRuntime.ts');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const children = new Set<ChildProcess>();
after(() => {
  for (const c of children) {
    try {
      c.kill('SIGKILL');
    } catch {
      /* аль хэдийн үхсэн */
    }
  }
});

interface FixtureSpec {
  mode: 'ok' | 'no_start' | 'wrong_version' | 'health_fail' | 'crash_on_generate';
  reportVersion?: string | null;
}

async function world(port: number) {
  const root = await mkdtemp(join(tmpdir(), 'mglai-chain-'));
  const layout = resolveLayout(root);
  await ensureLayout(layout);
  const store = new InstalledStateStore(layout.installedFile);
  const artifacts = new Map<string, string>();
  const base = `http://127.0.0.1:${port}`;
  const logs: string[] = [];

  async function http(path: string, init: RequestInit = {}, timeoutMs = 1500): Promise<{ status: number; body: Record<string, unknown> | null }> {
    try {
      const res = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
    } catch {
      return { status: 0, body: null };
    }
  }
  const probe = async (): Promise<boolean | null> => {
    const r = await http('/health');
    if (r.status === 0) return null;
    return r.body?.service === 'mgl-ai-runtime';
  };
  const waitFor = async (want: boolean | null, ms: number): Promise<boolean> => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const p = await probe();
      if ((want === true && p === true) || (want === null && p === null)) return true;
      await sleep(100);
    }
    return false;
  };

  /* ── бодит супервайзер: fixture runtime-ийг ЗААГЧААС спавнана ─────── */
  let lock: { pid: number; startedAt: string } | null = null;
  const alive = new Map<number, ChildProcess>();
  const supDeps: SupervisorDeps = {
    backoffMinMs: 200,
    backoffMaxMs: 800,
    stableAfterMs: 60_000,
    startTimeoutMs: 4000,
    staleLockMs: 2000,
    async spawn(): Promise<ChildHandle> {
      const p = await readPointer(layout, 'runtime');
      if (!p) throw new Error('заагч алга');
      const entry = join(p.path, 'runtime', 'src', 'server.ts');
      const child = spawn(process.execPath, [entry], { cwd: dirname(entry), env: { ...process.env, FAKE_PORT: String(port) }, stdio: 'ignore', windowsHide: true });
      children.add(child);
      alive.set(child.pid!, child);
      logs.push(`spawn:${p.version}`);
      const exited = new Promise<{ code: number | null; signal: string | null }>((res) => {
        child.on('exit', (code, signal) => {
          alive.delete(child.pid!);
          res({ code, signal });
        });
      });
      return { pid: child.pid!, exited, kill: (sig) => child.kill(sig ?? 'SIGTERM') };
    },
    probe,
    pidAlive: async (pid) => alive.has(pid),
    readLock: async () => lock,
    writeLock: async (v) => {
      lock = v;
    },
    sleep,
    now: () => Date.now(),
    log: (level, msg, data) => logs.push(`${level}:${msg}${data ? ' ' + JSON.stringify(data) : ''}`),
    readUpdateState: async () => {
      const s = await readUpdateState(layout);
      return s ? { phase: s.phase, startedAt: s.startedAt } : null;
    },
  };

  /* ── ProcessCoordinator: /shutdown → down → up (супервайзер асаана) ─ */
  const coordinator: ProcessCoordinator = {
    async restart() {
      if ((await probe()) === true) {
        await http('/shutdown', { method: 'POST' });
        if (!(await waitFor(null, 3000))) return { ok: false, code: 'SHUTDOWN_TIMEOUT' };
      }
      if (!(await waitFor(true, 6000))) return { ok: false, code: 'START_TIMEOUT' };
      return { ok: true, code: 'RESTARTED' };
    },
    async actualVersions() {
      const r = await http('/info');
      const running = (r.body?.deployment as { running?: Record<string, string> } | undefined)?.running ?? {};
      return { runtime: running.runtime };
    },
  };

  const deps: UpdateDeps = {
    layout,
    store,
    coordinator,
    download: async (url, dest) => {
      const body = artifacts.get(url);
      if (body === undefined) throw new Error(`fixture алга: ${url}`);
      await writeFile(dest, body);
    },
    unpack: async (_c, staged, versionDir) => {
      const spec = JSON.parse(await readFile(staged, 'utf8')) as FixtureSpec & { version: string };
      await mkdir(join(versionDir, 'runtime', 'src'), { recursive: true });
      await copyFile(FIXTURE, join(versionDir, 'runtime', 'src', 'server.ts'));
      await writeFile(join(versionDir, 'package.json'), JSON.stringify({ name: 'fixture', version: spec.version }));
      await writeFile(join(versionDir, 'fixture.json'), JSON.stringify({ mode: spec.mode, reportVersion: spec.reportVersion ?? null }));
      await rm(staged, { force: true });
      return versionDir;
    },
    healthCheck: async () => {
      const r = await http('/deploy/health', {}, 3000);
      const status = (r.body?.status as string | undefined) ?? 'UNREACHABLE';
      return { ok: status === 'READY' || status === 'DEGRADED', code: status };
    },
    smokeTest: async () => {
      const r = await http('/generate', { method: 'POST' }, 3000);
      return r.status === 200 ? { ok: true, code: 'GENERATION_OK' } : { ok: false, code: `GENERATION_HTTP_${r.status}` };
    },
    log: (m) => logs.push(`update:${m}`),
  };

  const manifestFor = (releaseId: string, version: string, fx: FixtureSpec) => {
    const body = JSON.stringify({ version, ...fx });
    const url = `fx://${version}`;
    artifacts.set(url, body);
    const r = validateManifest({ schema: 'mgl-ai-release/1', releaseId, channel: 'stable', createdAt: '2026-09-11T00:00:00Z', components: { runtime: { version, url, sha256: sha(body), sizeBytes: body.length } }, compatibility: {} });
    if (!r.ok) throw new Error(r.errors.join(','));
    return r.manifest;
  };

  /** Анхны суулгац — супервайзер хараахан асаагүй тул дахин асаалтгүй. */
  const install = async (releaseId: string, version: string, fx: FixtureSpec) =>
    runUpdate(planUpdate({ manifest: manifestFor(releaseId, version, fx), installed: await store.read() }), { ...deps, coordinator: undefined, smokeTest: undefined, healthCheck: async () => ({ ok: true, code: 'INSTALL' }) });
  /** Шинэчлэлт — бүтэн гинж (дахин асаалт + хувилбар + health + smoke). */
  const update = async (releaseId: string, version: string, fx: FixtureSpec) =>
    runUpdate(planUpdate({ manifest: manifestFor(releaseId, version, fx), installed: await store.read() }), deps);

  let sup = new Supervisor(supDeps);
  let loop: Promise<void> | null = null;
  const startSupervisor = async () => {
    sup = new Supervisor(supDeps);
    loop = sup.supervise();
    assert.ok(await waitFor(true, 6000), 'runtime асаагүй');
  };
  const stopSupervisor = async () => {
    await sup.stop(1000);
    await loop;
    for (const c of alive.values()) c.kill('SIGKILL');
    await waitFor(null, 2000);
  };
  const runningVersion = async () => (await coordinator.actualVersions()).runtime;
  const setFixtureMode = async (version: string, fx: FixtureSpec) => {
    const dir = join(layout.app, 'versions', version);
    await writeFile(join(dir, 'fixture.json'), JSON.stringify({ mode: fx.mode, reportVersion: fx.reportVersion ?? null }));
  };
  const lastUpdate = () => readJson<LastUpdateRecord>(lastUpdateFile(layout));

  return { layout, store, logs, supDeps, install, update, startSupervisor, stopSupervisor, runningVersion, waitFor, probe, setFixtureMode, lastUpdate, alive, getLock: () => lock, setLock: (v: typeof lock) => void (lock = v) };
}

test('1. амжилттай шинэчлэлт: v1 → v2, процесс 1.2.0, lastKnownGood=rel-2, update.json цэвэрлэгдсэн', async () => {
  const w = await world(39251);
  assert.equal((await w.install('rel-1', '1.0.0', { mode: 'ok' })).code, 'ACTIVATED');
  await w.startSupervisor();
  assert.equal(await w.runningVersion(), '1.0.0');

  const r = await w.update('rel-2', '1.2.0', { mode: 'ok' });
  assert.equal(r.code, 'ACTIVATED');
  assert.equal(await w.runningVersion(), '1.2.0');
  assert.equal((await readPointer(w.layout, 'runtime'))?.version, '1.2.0');
  const s = await w.store.read();
  assert.equal(s.lastKnownGoodRelease, 'rel-2');
  assert.equal(await readUpdateState(w.layout), null);
  assert.equal((await w.lastUpdate())?.code, 'ACTIVATED');
  // Зориудын зогсоолт — супервайзер уналт гэж тоолоогүй, ухралтгүй асаасан
  if (!w.logs.some((l) => l.includes('шинэчлэлтийн зогсоолт'))) console.log(w.logs.join(String.fromCharCode(10)));
  assert.ok(w.logs.some((l) => l.includes('шинэчлэлтийн зогсоолт')));
  assert.equal(w.logs.filter((l) => l.includes('runtime гарав')).length, 0);
  await w.stopSupervisor();
});

test('2. шинэ runtime АСАХГҮЙ → RESTART_FAILED → буцаалт → v1 дахин ажиллаж байна', async () => {
  const w = await world(39252);
  assert.equal((await w.install('rel-1', '1.0.0', { mode: 'ok' })).code, 'ACTIVATED');
  await w.startSupervisor();

  const r = await w.update('rel-2', '1.2.0', { mode: 'no_start' });
  assert.equal(r.code, 'RESTART_FAILED');
  assert.deepEqual(r.rolledBack, ['runtime']);
  assert.equal(r.rollbackOk, true);
  assert.ok(r.rollbackReason?.startsWith('RESTART_FAILED'));
  assert.equal(await w.runningVersion(), '1.0.0');
  assert.equal((await readPointer(w.layout, 'runtime'))?.version, '1.0.0');
  assert.equal((await w.store.read()).lastKnownGoodRelease, 'rel-1');
  assert.equal((await w.lastUpdate())?.rollbackOk, true);
  await w.stopSupervisor();
});

test('3. асаад ч БУРУУ хувилбар (заагч 1.2, процесс 1.1) → VERSION_MISMATCH → буцаалт', async () => {
  const w = await world(39253);
  assert.equal((await w.install('rel-1', '1.0.0', { mode: 'ok' })).code, 'ACTIVATED');
  await w.startSupervisor();

  const r = await w.update('rel-2', '1.2.0', { mode: 'wrong_version', reportVersion: '1.1.0' });
  assert.equal(r.code, 'VERSION_MISMATCH');
  assert.ok(r.rollbackReason?.includes('runtime:1.2.0!=1.1.0'));
  assert.equal(r.rollbackOk, true);
  assert.equal(await w.runningVersion(), '1.0.0');
  await w.stopSupervisor();
});

test('4. шинэ runtime асав, health унав → HEALTH_FAILED_ROLLED_BACK → v1', async () => {
  const w = await world(39254);
  assert.equal((await w.install('rel-1', '1.0.0', { mode: 'ok' })).code, 'ACTIVATED');
  await w.startSupervisor();

  const r = await w.update('rel-2', '1.2.0', { mode: 'health_fail' });
  assert.equal(r.code, 'HEALTH_FAILED_ROLLED_BACK');
  assert.equal(r.rollbackReason, 'HEALTH_FAILED: REPAIR_REQUIRED');
  assert.equal(r.rollbackOk, true);
  assert.equal(await w.runningVersion(), '1.0.0');
  assert.equal((await w.store.read()).lastKnownGoodRelease, 'rel-1');
  await w.stopSupervisor();
});

test('5. smoke дундуур runtime УНАВ → супервайзер зориудын гарц гэж шууд асаана → буцаалт → v1', async () => {
  const w = await world(39255);
  assert.equal((await w.install('rel-1', '1.0.0', { mode: 'ok' })).code, 'ACTIVATED');
  await w.startSupervisor();

  const r = await w.update('rel-2', '1.2.0', { mode: 'crash_on_generate' });
  assert.equal(r.code, 'HEALTH_FAILED_ROLLED_BACK');
  assert.ok(r.rollbackReason?.startsWith('SMOKE_FAILED'));
  assert.equal(r.rollbackOk, true);
  assert.equal(await w.runningVersion(), '1.0.0');
  await w.stopSupervisor();
});

test('6. буцаалт Ч унана (хуучин хувилбар эвдэрсэн) → ROLLBACK_FAILED, rollbackOk=false, шалтгаан бичигдсэн', async () => {
  const w = await world(39256);
  assert.equal((await w.install('rel-1', '1.0.0', { mode: 'ok' })).code, 'ACTIVATED');
  await w.startSupervisor();
  // v1 ажиллаж байхад дискэн дээрх v1 эвдэрнэ (дараагийн асаалтад асахгүй)
  await w.setFixtureMode('1.0.0', { mode: 'no_start' });

  const r = await w.update('rel-2', '1.2.0', { mode: 'health_fail' });
  assert.equal(r.code, 'ROLLBACK_FAILED');
  assert.equal(r.rollbackOk, false);
  assert.ok(r.detail?.includes('буцаалтын дахин асаалт унав'));
  const rec = await w.lastUpdate();
  assert.equal(rec?.code, 'ROLLBACK_FAILED');
  assert.equal(rec?.rollbackReason, 'HEALTH_FAILED: REPAIR_REQUIRED');
  assert.equal((await readPointer(w.layout, 'runtime'))?.version, '1.0.0'); // заагч хуучин руу буцсан
  assert.equal((await w.store.read()).lastKnownGoodRelease, 'rel-1');
  await w.stopSupervisor();
});

test('7. «reboot»: шинэ супервайзер заагчаас v2-ыг асаана; хуучирсан lock (үхсэн PID) цэвэрлэгдэнэ; давхар супервайзер асаахгүй', async () => {
  const w = await world(39257);
  assert.equal((await w.install('rel-1', '1.0.0', { mode: 'ok' })).code, 'ACTIVATED');
  await w.startSupervisor();
  assert.equal((await w.update('rel-2', '1.2.0', { mode: 'ok' })).code, 'ACTIVATED');
  await w.stopSupervisor(); // «унтраалт» — бүх процесс алга
  assert.equal(await w.probe(), null);

  // Гэнэтийн унтралтын үлдэгдэл: lock дахь PID үхсэн
  w.setLock({ pid: 4242, startedAt: new Date(Date.now() - 3600_000).toISOString() });
  await w.startSupervisor(); // «нэвтрэлт» — заагчаас
  assert.equal(await w.runningVersion(), '1.2.0');
  assert.ok(w.logs.filter((l) => l.startsWith('spawn:')).at(-1)?.endsWith('1.2.0'));

  // Давхар супервайзер (bootstrap task + start.ps1 task зэрэг бүртгэгдсэн мэт) → ALREADY_RUNNING, спавн нэмэгдэхгүй
  const spawnsBefore = w.logs.filter((l) => l.startsWith('spawn:')).length;
  const dup = await new Supervisor(w.supDeps).startOnce();
  assert.equal(dup.ok, false);
  assert.equal((dup as { code: string }).code, 'ALREADY_RUNNING');
  assert.equal(w.logs.filter((l) => l.startsWith('spawn:')).length, spawnsBefore);
  assert.ok(w.logs.some((l) => l.includes('хуучирсан lock')) || w.getLock()?.pid !== 4242);
  await w.stopSupervisor();
});
