/**
 * MGL AI · ПРОЦЕССЫН СУПЕРВАЙЗЕР (Session B §9).
 *
 * Өнөөдөр ХОЁР супервайзер зэрэгцэн оршдог: `installer/bootstrap.ps1`-ийн
 * Task Scheduler даалгавар (action = `node server.ts` шууд) ба
 * `ai/scripts/start.ps1 -Supervise` (dev repo-ийн мөчлөг).  Нэг машинд
 * хоёулаа бүртгэгдвэл давхар runtime, давхар llama-server, давхар VRAM.
 *
 * Энэ модуль нь ТЭР МӨЧЛӨГИЙН ЦЭВЭР ХЭРЭГЖҮҮЛЭЛТ — тарилгатай
 * (`spawn`, `probe`, `sleep`) тул тестэд секундгүй, процессгүй ажиллана.
 * Бодит оролт нь `ai/deployment/bin/supervise.ts` (Task Scheduler-ийн
 * action болно; bootstrap.ps1 үүнийг P1-д бүртгэнэ).
 *
 * ⚠️ ДАВХАР ПРОЦЕСС ХОРИОТОЙ.  Эхлэхээс өмнө (1) lock файл дахь PID амьд
 *    эсэх, (2) `/health` порт дээр аль хэдийн хариулж байгаа эсэх — хоёрыг
 *    шалгана.  Аль нэг нь «амьд» бол ЭХЛҮҮЛЭХГҮЙ, `ALREADY_RUNNING`.
 *    Портыг өөр програм эзэлсэн бол (`/health` буруу хариу) `PORT_CONFLICT`.
 *
 * ⚠️ УХРАЛТ 5 с → 60 с, ТЭГЭЭД ХЭВЭЭР.  Хязгааргүй хурдан дахин асаалт нь
 *    эвдэрсэн GGUF дээр GPU-г секунд тутам зовооно.  Хэвийн 10 минут
 *    амьдарсан бол ухралт ТЭГ болно (нэг удаагийн уналт нь мөнхийн 60 с
 *    хүлээлт болох ёсгүй).
 *
 * ⚠️ ХУВИЛБАРЫГ МЭДНЭ (§9).  Супервайзер `expected` (runtime хувилбар,
 *    загварын зам/SHA, мэдлэгийн хувилбар)-ийг `/info`-той тулгаж
 *    `VERSION_DRIFT` гэж тэмдэглэнэ — асаагаад «ажиллаж байна» гэж
 *    ХУДЛАА хэлэхгүй.
 */

export interface ChildHandle {
  pid: number;
  /** Процесс дуусахад шийдэгдэнэ (exit код эсвэл дохио). */
  exited: Promise<{ code: number | null; signal: string | null }>;
  kill(signal?: 'SIGTERM' | 'SIGKILL'): void;
}

export interface SupervisorDeps {
  spawn(): ChildHandle | Promise<ChildHandle>;
  /** `/health` — `ok: true` бол манай runtime, `false` бол порт дээр ӨӨР зүйл, `null` бол хэн ч байхгүй. */
  probe(): Promise<boolean | null>;
  pidAlive(pid: number): Promise<boolean>;
  readLock(): Promise<{ pid: number; startedAt: string } | null>;
  writeLock(v: { pid: number; startedAt: string } | null): Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): number;
  log(level: 'info' | 'warn' | 'error', msg: string, data?: Record<string, unknown>): void;
  /** Асаасны дараа `/health` хүлээх дээд хугацаа.  Өгөгдмөл 30 с. */
  startTimeoutMs?: number;
  /** Ухралтын хамгийн бага/их — тестэд жижиг. */
  backoffMinMs?: number;
  backoffMaxMs?: number;
  /** Энэ хугацаанаас удаан амьдарсан бол ухралт тэглэнэ.  Өгөгдмөл 10 мин. */
  stableAfterMs?: number;
  /**
   * PID нь ҮНЭХЭЭР манай runtime мөн үү (командын мөрөөр).  `null` = мэдэхгүй.
   * ⚠️ Windows PID-ийг ДАХИН ашигладаг: гэнэтийн унтралтын дараах lock дахь PID
   *    нь өнөөдөр хөтчийн процесс байж болно — `pidAlive` true ч runtime биш.
   */
  pidIsRuntime?(pid: number): Promise<boolean | null>;
  /** Lock-ийн насны хязгаар — PID амьд ч /health хариулахгүй бол хуучирсан гэж үзнэ.  Өгөгдмөл 2 мин. */
  staleLockMs?: number;
  /**
   * `state/update.json` — идэвхжүүлэлтийн хөдөлгүүрийн бичсэн төлөв.  `switching` /
   * `rolling_back` / `verifying` үед гарсан процесс нь ЗОРИУДЫН зогсоолт: ухралтгүй
   * ШУУД дахин асаана, уналт гэж тоолохгүй (P0-1).
   */
  readUpdateState?(): Promise<{ phase: string; startedAt: string } | null>;
}

export type StartOutcome =
  | { ok: true; code: 'STARTED'; pid: number }
  | { ok: false; code: 'ALREADY_RUNNING' | 'PORT_CONFLICT' | 'START_TIMEOUT' | 'EXITED_EARLY'; detail?: string };

export class Supervisor {
  readonly #d: SupervisorDeps;
  #child: ChildHandle | null = null;
  #stopping = false;
  #restarts = 0;
  #backoffMs: number;

  constructor(deps: SupervisorDeps) {
    this.#d = deps;
    this.#backoffMs = deps.backoffMinMs ?? 5000;
  }

  get restarts(): number {
    return this.#restarts;
  }

  /**
   * Аль хэдийн ажиллаж байгаа эсэх — lock PID + порт.
   *
   * ⚠️ ГЭНЭТИЙН УНТРАЛТЫН ДАРААХ LOCK (P0-2): PID амьд байж болох ч (1) өөр
   *    процесс болж дахин ашиглагдсан (`pidIsRuntime` false) эсвэл (2) runtime
   *    гацсан — lock `staleLockMs`-ээс хуучин атлаа /health хариулахгүй.  Хоёуланд
   *    нь lock-ийг хуучирсан гэж цэвэрлэнэ; порт хариулж байвал 'ours' хэвээр.
   */
  async alreadyRunning(): Promise<'none' | 'ours' | 'conflict'> {
    const lock = await this.#d.readLock();
    const p = await this.#d.probe();
    if (p === true) return 'ours';
    if (p === false) return 'conflict';
    if (lock && (await this.#d.pidAlive(lock.pid))) {
      const isRuntime = this.#d.pidIsRuntime ? await this.#d.pidIsRuntime(lock.pid) : null;
      const ageMs = this.#d.now() - Date.parse(lock.startedAt);
      const stale = isRuntime === false || (Number.isFinite(ageMs) && ageMs > (this.#d.staleLockMs ?? 120_000));
      if (!stale) return 'ours'; // дөнгөж асаж байна — /health удахгүй хариулна
      this.#d.log('warn', 'хуучирсан lock — PID амьд ч runtime биш/хариулахгүй, цэвэрлэв', { pid: lock.pid, age_ms: ageMs, is_runtime: isRuntime });
    }
    if (lock) await this.#d.writeLock(null);
    return 'none';
  }

  /** Нэг удаа асаана, `/health` хүлээнэ. */
  async startOnce(): Promise<StartOutcome> {
    const running = await this.alreadyRunning();
    if (running === 'ours') return { ok: false, code: 'ALREADY_RUNNING' };
    if (running === 'conflict') return { ok: false, code: 'PORT_CONFLICT', detail: 'порт дээр өөр үйлчилгээ хариулж байна' };

    const child = await this.#d.spawn();
    this.#child = child;
    await this.#d.writeLock({ pid: child.pid, startedAt: new Date(this.#d.now()).toISOString() });
    this.#d.log('info', 'runtime асаав', { pid: child.pid });

    const deadline = this.#d.now() + (this.#d.startTimeoutMs ?? 30_000);
    let exited = false;
    void child.exited.then(() => {
      exited = true;
    });
    while (this.#d.now() < deadline) {
      // Эхлээд ПОРТ: хариулж амжаад гарсан (шинэчлэлтийн зогсоолт) процессыг «эрт үхсэн» гэхгүй.
      if ((await this.#d.probe()) === true) return { ok: true, code: 'STARTED', pid: child.pid };
      if (exited) return { ok: false, code: 'EXITED_EARLY' };
      await this.#d.sleep(500);
    }
    return { ok: false, code: 'START_TIMEOUT' };
  }

  /**
   * Мөчлөг: асаана → гарахыг хүлээнэ → ухралттай дахин асаана.
   * `stop()` дуудагдтал буцахгүй.  `maxIterations` нь ЗӨВХӨН тестэд.
   */
  async supervise(maxIterations = Number.POSITIVE_INFINITY): Promise<void> {
    const min = this.#d.backoffMinMs ?? 5000;
    const max = this.#d.backoffMaxMs ?? 60_000;
    const stableAfter = this.#d.stableAfterMs ?? 10 * 60_000;
    let iter = 0;
    while (!this.#stopping && iter < maxIterations) {
      iter++;
      const startedAt = this.#d.now();
      const r = await this.startOnce();
      if (!r.ok) {
        if (r.code === 'ALREADY_RUNNING' || r.code === 'PORT_CONFLICT') {
          this.#d.log('warn', `эхлүүлээгүй: ${r.code}`, r.detail ? { detail: r.detail } : undefined);
          return; // өөр супервайзер/процесс эзэмшиж байна — БИД гарна
        }
        if (r.code === 'EXITED_EARLY' && (await this.#intendedExit())) {
          this.#d.log('info', 'шинэчлэлтийн зогсоолт — заагчаас шууд дахин асаана', { lived_ms: this.#d.now() - startedAt });
          await this.#d.writeLock(null);
          this.#restarts++;
          continue;
        }
        this.#d.log('error', `эхлэлт унав: ${r.code}`);
      } else {
        const ex = await this.#child!.exited;
        if (this.#stopping) break;
        const lived = this.#d.now() - startedAt;
        if (await this.#intendedExit()) {
          // Зориудын зогсоолт (шинэчлэлт/буцаалт): ШУУД, заагчаас — уналт биш.
          this.#d.log('info', 'шинэчлэлтийн зогсоолт — заагчаас шууд дахин асаана', { lived_ms: lived });
          await this.#d.writeLock(null);
          this.#restarts++;
          continue;
        }
        this.#d.log('error', 'runtime гарав', { code: ex.code, signal: ex.signal, lived_ms: lived });
        if (lived >= stableAfter) this.#backoffMs = min;
      }
      await this.#d.writeLock(null);
      this.#restarts++;
      this.#d.log('info', `${Math.round(this.#backoffMs / 1000)} с дараа дахин асаана`, { backoff_ms: this.#backoffMs });
      await this.#d.sleep(this.#backoffMs);
      this.#backoffMs = Math.min(max, this.#backoffMs * 2);
    }
  }

  /** `state/update.json` шинэчлэлт/буцаалтын явцад байна уу — процессын гарц ЗОРИУДЫНХ. */
  async #intendedExit(): Promise<boolean> {
    const upd = this.#d.readUpdateState ? await this.#d.readUpdateState() : null;
    return (
      upd !== null &&
      (upd.phase === 'switching' || upd.phase === 'rolling_back' || upd.phase === 'verifying') &&
      this.#d.now() - Date.parse(upd.startedAt) < 10 * 60_000
    );
  }

  /** Зөөлөн зогсоолт: SIGTERM → 5 с → SIGKILL.  Lock цэвэрлэнэ. */
  async stop(graceMs = 5000): Promise<void> {
    this.#stopping = true;
    const c = this.#child;
    if (!c) {
      await this.#d.writeLock(null);
      return;
    }
    c.kill('SIGTERM');
    let done = false;
    void c.exited.then(() => {
      done = true;
    });
    const deadline = this.#d.now() + graceMs;
    while (!done && this.#d.now() < deadline) await this.#d.sleep(200);
    if (!done) c.kill('SIGKILL');
    await this.#d.writeLock(null);
    this.#child = null;
  }
}

/** `/info`-ийн хувилбарууд хүлээснээс зөрж байгаа эсэх — асаасны дараах шалгалт. */
export function detectVersionDrift(
  expected: { runtimeVersion: string | null; modelSha256: string | null; knowledgeVersion: string | null },
  actual: { runtimeVersion: string | null; modelSha256: string | null; knowledgeVersion: string | null },
): string[] {
  const drift: string[] = [];
  if (expected.runtimeVersion && actual.runtimeVersion && expected.runtimeVersion !== actual.runtimeVersion) {
    drift.push(`RUNTIME_VERSION_DRIFT:${expected.runtimeVersion}!=${actual.runtimeVersion}`);
  }
  if (expected.modelSha256 && actual.modelSha256 && expected.modelSha256.toLowerCase() !== actual.modelSha256.toLowerCase()) {
    drift.push('MODEL_SHA_DRIFT');
  }
  if (expected.knowledgeVersion && actual.knowledgeVersion && expected.knowledgeVersion !== actual.knowledgeVersion) {
    drift.push(`KNOWLEDGE_VERSION_DRIFT:${expected.knowledgeVersion}!=${actual.knowledgeVersion}`);
  }
  return drift;
}
