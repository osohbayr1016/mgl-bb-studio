/**
 * MGL AI deployment · СУПЕРВАЙЗЕР — ТЕСТ (Session B §35).
 *
 * Run with:  node --test deployment/test/supervisor.test.ts
 *
 *   • runtime унав → дахин асна (ухралттай)
 *   • давхар runtime → хоёр дахь удаа АСААХГҮЙ (lock PID амьд / порт хариулж байна)
 *   • портыг өөр програм эзэлсэн → PORT_CONFLICT, спавн байхгүй
 *   • хувилбарын зөрүү илэрнэ
 *
 * Хуурамч цаг, хуурамч процесс — секунд ч хүлээхгүй.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Supervisor, detectVersionDrift, type ChildHandle, type SupervisorDeps } from '../src/supervisor.ts';

interface FakeWorld {
  deps: SupervisorDeps;
  spawned: number;
  children: { pid: number; exit: (code: number) => void }[];
  /** Хэн `/health`-д хариулж байна: 'ours' | 'other' | null */
  port: 'ours' | 'other' | null;
  logs: string[];
}

function world(opts: { crashAfterMs?: number; startsHealthy?: boolean } = {}): FakeWorld {
  let clock = 0;
  let lock: { pid: number; startedAt: string } | null = null;
  const alive = new Set<number>();
  const w: FakeWorld = {
    spawned: 0,
    children: [],
    port: null,
    logs: [],
    deps: {
      backoffMinMs: 100,
      backoffMaxMs: 400,
      stableAfterMs: 5000,
      startTimeoutMs: 2000,
      spawn: () => {
        w.spawned++;
        const pid = 1000 + w.spawned;
        alive.add(pid);
        let resolve!: (v: { code: number | null; signal: string | null }) => void;
        const exited = new Promise<{ code: number | null; signal: string | null }>((r) => (resolve = r));
        const exit = (code: number) => {
          alive.delete(pid);
          w.port = null;
          resolve({ code, signal: null });
        };
        w.children.push({ pid, exit });
        if (opts.startsHealthy !== false) w.port = 'ours';
        if (opts.crashAfterMs !== undefined) {
          // Бодит ертөнцөд цаг өөрөө урсдаг; энд макротаскаар «хугацаа өнгөрч»
          // унасныг дуурайна (супервайзер `exited`-ийг хүлээж байх үед).
          const after = opts.crashAfterMs;
          setTimeout(() => {
            clock += after;
            exit(1);
          }, 0);
        }
        const h: ChildHandle = { pid, exited, kill: () => exit(0) };
        return h;
      },
      probe: async () => (w.port === 'ours' ? true : w.port === 'other' ? false : null),
      pidAlive: async (pid) => alive.has(pid),
      readLock: async () => lock,
      writeLock: async (v) => {
        lock = v;
      },
      sleep: async (ms) => {
        clock += ms;
        await new Promise((r) => setTimeout(r, 0));
      },
      now: () => clock,
      log: (level, msg, data) => w.logs.push(`${level}:${msg}${data ? ' ' + JSON.stringify(data) : ''}`),
    },
  };
  return w;
}

test('runtime унав → дахин асна, ухралт 100→200→400 (тааз)', async () => {
  const w = world({ crashAfterMs: 1000 });
  const s = new Supervisor(w.deps);
  await s.supervise(4);
  assert.equal(w.spawned, 4);
  assert.equal(s.restarts, 4);
  const waits = w.logs.filter((l) => l.includes('дахин асаана')).map((l) => Number(/(\d+) с/.exec(l)![1]));
  // 0.1 → 0.2 → 0.4 → 0.4 (секундээр бөөрөнхийлсөн)
  assert.deepEqual(waits.map((x) => Math.round(x)), [0, 0, 0, 0]);
  assert.ok(w.logs.some((l) => l.startsWith('error:runtime гарав')));
});

test('давхар: lock PID амьд → ALREADY_RUNNING, спавн 0', async () => {
  const w = world();
  await w.deps.writeLock({ pid: 4242, startedAt: 'x' });
  (w.deps as { pidAlive: SupervisorDeps['pidAlive'] }).pidAlive = async (pid) => pid === 4242;
  const s = new Supervisor(w.deps);
  const r = await s.startOnce();
  assert.deepEqual(r, { ok: false, code: 'ALREADY_RUNNING' });
  assert.equal(w.spawned, 0);
});

test('давхар: lock байхгүй ч порт манайх хариулж байна → ALREADY_RUNNING', async () => {
  const w = world();
  w.port = 'ours';
  const s = new Supervisor(w.deps);
  const r = await s.startOnce();
  assert.equal(r.ok, false);
  assert.equal((r as { code: string }).code, 'ALREADY_RUNNING');
  assert.equal(w.spawned, 0);
});

test('портыг өөр програм эзэлсэн → PORT_CONFLICT, supervise шууд гарна', async () => {
  const w = world();
  w.port = 'other';
  const s = new Supervisor(w.deps);
  await s.supervise(5);
  assert.equal(w.spawned, 0);
  assert.ok(w.logs.some((l) => l.includes('PORT_CONFLICT')));
});

test('хуучирсан lock (PID үхсэн) → цэвэрлээд асаана', async () => {
  const w = world();
  await w.deps.writeLock({ pid: 9, startedAt: 'x' });
  const s = new Supervisor(w.deps);
  const r = await s.startOnce();
  assert.equal(r.ok, true);
  assert.equal(w.spawned, 1);
  assert.equal((await w.deps.readLock())?.pid, 1001);
});

test('/health хэзээ ч ирэхгүй → START_TIMEOUT', async () => {
  const w = world({ startsHealthy: false });
  const s = new Supervisor(w.deps);
  const r = await s.startOnce();
  assert.equal((r as { code: string }).code, 'START_TIMEOUT');
});

test('stop → lock цэвэрлэгдэнэ, мөчлөг зогсоно', async () => {
  const w = world();
  const s = new Supervisor(w.deps);
  const run = s.supervise();
  await w.deps.sleep(10);
  await s.stop(100);
  await run;
  assert.equal(await w.deps.readLock(), null);
  assert.equal(w.spawned, 1);
});

test('хувилбарын зөрүү', () => {
  const d = detectVersionDrift(
    { runtimeVersion: '1.1.0', modelSha256: 'AA', knowledgeVersion: 'k2' },
    { runtimeVersion: '1.0.0', modelSha256: 'aa', knowledgeVersion: 'k1' },
  );
  assert.deepEqual(d, ['RUNTIME_VERSION_DRIFT:1.1.0!=1.0.0', 'KNOWLEDGE_VERSION_DRIFT:k2!=k1']);
  assert.deepEqual(detectVersionDrift({ runtimeVersion: null, modelSha256: null, knowledgeVersion: null }, { runtimeVersion: '1', modelSha256: 'x', knowledgeVersion: 'y' }), []);
});

/* ── P0-2: гэнэтийн унтралтын дараах lock, шинэчлэлтийн зогсоолт ─────── */

test('хуучирсан lock: PID амьд ч ӨӨР процесс (дахин ашиглагдсан) → цэвэрлээд асаана', async () => {
  const w = world();
  await w.deps.writeLock({ pid: 777, startedAt: new Date(0).toISOString() });
  (w.deps as { pidAlive: SupervisorDeps['pidAlive'] }).pidAlive = async () => true;
  w.deps.pidIsRuntime = async () => false;
  const s = new Supervisor(w.deps);
  const r = await s.startOnce();
  assert.equal(r.ok, true);
  assert.equal(w.spawned, 1);
  assert.ok(w.logs.some((l) => l.includes('хуучирсан lock')));
});

test('lock ЗАЛУУ + PID амьд + /health хараахан хариулахгүй → ours (дөнгөж асаж байна), спавн 0', async () => {
  const w = world();
  await w.deps.writeLock({ pid: 778, startedAt: new Date(w.deps.now()).toISOString() });
  (w.deps as { pidAlive: SupervisorDeps['pidAlive'] }).pidAlive = async () => true;
  w.deps.pidIsRuntime = async () => null;
  const s = new Supervisor(w.deps);
  const r = await s.startOnce();
  assert.equal((r as { code: string }).code, 'ALREADY_RUNNING');
  assert.equal(w.spawned, 0);
});

test('lock ХУУЧИН (>2 мин) + PID амьд + /health хариулахгүй (гацсан) → хуучирсан гэж үзээд асаана', async () => {
  const w = world();
  await w.deps.writeLock({ pid: 779, startedAt: new Date(w.deps.now() - 10 * 60_000).toISOString() });
  (w.deps as { pidAlive: SupervisorDeps['pidAlive'] }).pidAlive = async () => true;
  const s = new Supervisor(w.deps);
  const r = await s.startOnce();
  assert.equal(r.ok, true);
  assert.equal(w.spawned, 1);
});

test('шинэчлэлтийн зогсоолт (update.json switching) → ухралтгүй ШУУД дахин асаана, уналт гэж тоолохгүй', async () => {
  const w = world({ crashAfterMs: 500 });
  w.deps.readUpdateState = async () => ({ phase: 'switching', startedAt: new Date(w.deps.now()).toISOString() });
  const s = new Supervisor(w.deps);
  await s.supervise(3);
  assert.equal(w.spawned, 3);
  assert.equal(w.logs.filter((l) => l.includes('шинэчлэлтийн зогсоолт')).length, 3);
  assert.equal(w.logs.filter((l) => l.includes('runtime гарав')).length, 0);
  assert.equal(w.logs.filter((l) => l.includes('дахин асаана') && l.includes('backoff_ms')).length, 0);
});

test('update.json ХУУЧИН (>10 мин) бол зориудын зогсоолт гэж үзэхгүй → ердийн ухралт', async () => {
  const w = world({ crashAfterMs: 500 });
  w.deps.readUpdateState = async () => ({ phase: 'switching', startedAt: new Date(w.deps.now() - 60 * 60_000).toISOString() });
  const s = new Supervisor(w.deps);
  await s.supervise(2);
  assert.equal(w.logs.filter((l) => l.includes('runtime гарав')).length, 2);
});
