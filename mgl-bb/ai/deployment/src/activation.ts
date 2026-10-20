/**
 * MGL AI · ИДЭВХЖҮҮЛЭЛТИЙН ХӨДӨЛГҮҮР — ГАНЦ СЕМАНТИК (Session B §12–§14, P0-1, P0-5).
 *
 *   staging/<component>-<version>.part   ← татагдаж байна
 *   staging/<component>-<version>        ← SHA давсан
 *   <home>/versions/<version>/…          ← задалсан / зөөсөн (ажиллаж буйг хөндөхгүй)
 *   <home>/current.<component>.json      ← ЗААГЧ, rename-ээр солигдоно
 *   state/update.json                    ← ШИНЭЧЛЭЛТИЙН ТӨЛӨВ — супервайзер уншина
 *   state/last-update.json               ← сүүлийн үр дүн + буцаалтын шалтгаан (диагностик)
 *
 * ⚠️ ЭНЭ ФАЙЛ БОЛ ЗААГЧ СОЛИХ / БУЦААХ ЦОРЫН ГАНЦ ГАЗАР (P0-5).  `updater.ts`
 *    (runtime) нь манифест шалгаж, татаж, ЭНД дуудна; `bin/update.ts` мөн.
 *    `deployment/test/consolidation.test.ts` нь `ai/runtime/src`-д заагч бичих
 *    код гарч ирвэл унана.
 *
 * ⚠️ RUNTIME ДАХИН АСААЛТЫН ГИНЖ (P0-1) — заагчийг ЭХЛЭЭД солино, дараа нь
 *    зогсоолт хүснэ.  Ингэснээр супервайзер ямар ч мөчид хуучин хувилбарыг
 *    «санамсаргүй» асаах боломжгүй: гарсны дараах спавн бүр заагчаас уншина.
 *    Зогсоолтын ӨМНӨ `state/update.json` = `switching` бичигдэнэ — супервайзер
 *    үүнийг «зориудын гарц» гэж уншиж ухралтгүй ШУУД асаана, уналт гэж тоолохгүй.
 *
 *      pointer switch → update.json(switching) → /shutdown → супервайзер шинэ
 *      entry-г асаана → /info-ийн БОДИТ хувилбар ≟ хүлээсэн → health → smoke
 *      → PASS: lastKnownGood · FAIL: заагч буцаах → update.json(rolling_back)
 *      → /shutdown → хуучин асна → хуучны health → шалтгаан бичигдэнэ.
 *
 * ⚠️ HEALTH УНАВАЛ БҮХ ИДЭВХЖҮҮЛСНИЙГ БУЦААНА, ЗӨВХӨН УНАСНЫГ БИШ.
 * ⚠️ `model` БҮРЭЛДЭХҮҮН НЬ `modelManager.ts`-ЭЭР (`ModelActivator`) — хоёр дахь
 *    загварын менежер бичихгүй.
 */
import { mkdir, rename, rm, copyFile, stat, readdir, statfs } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { readJson, verifyOrDelete, writeJsonAtomic } from './integrity.ts';
import { componentHome, type InstallLayout } from './layout.ts';
import { compareVersions, type ComponentId, type ComponentSpec } from './manifest.ts';
import type { InstalledComponent, InstalledStateStore } from './installedState.ts';
import type { UpdateAction, UpdatePlan } from './updatePlan.ts';

export interface CurrentPointer {
  version: string;
  sha256: string;
  path: string;
  activatedAt: string;
  releaseId: string | null;
}

/** Идэвхжихэд runtime ДАХИН АСАХ шаардлагатай бүрэлдэхүүнүүд (`model` нь runtime дотроо хөдөлгүүрээ дахин барьдаг). */
export const RESTART_COMPONENTS: readonly ComponentId[] = ['runtime', 'app', 'knowledge', 'normRegistry'];

export type Downloader = (url: string, dest: string, onProgress?: (pct: number) => void, signal?: AbortSignal) => Promise<void>;

export type Unpacker = (component: ComponentId, stagedFile: string, versionDir: string, spec: ComponentSpec) => Promise<string>;

export interface ModelActivator {
  activate(spec: ComponentSpec, onProgress?: (pct: number) => void): Promise<{ path: string; sha256: string }>;
  rollback(): Promise<void>;
}

/* ================================================================== */
/*  ЗАГВАРЫН СОЛИЛТ — идэвхжүүлэх → хөдөлгүүр дахин барих → smoke → буцаах  */
/* ================================================================== */

/**
 * ⚠️ ЗАГВАР/АДАПТЕРЫН «идэвхжүүл → smoke → унавал буцаа» СЕМАНТИК ЭНД Л (P0-5, Session D
 *    2026-09-14).  Өмнө нь ГУРВАН газар давхардаж байсан: `updater.ts installBase`,
 *    `updater.ts applyPendingAdapter`, `server.ts /model/activate` — тус бүр
 *    `manager.activate → reload → load → rollback` гэж өөрөө бичсэн.  Одоо тэд ЭНЭ
 *    функцийг дуудна; `consolidation.test.ts` нь `ai/runtime/src`-д
 *    `manager.activate(`/`rollback(`/`activateAdapter(`/`rollbackAdapter(`
 *    дуудлага гарч ирвэл унана.
 *
 * `ModelSwitchTarget` нь `modelManager.ts`-ийн state.json-той ажилладаг НАРИЙН интерфейс
 * (type-only, бүтцээр) — modelManager-ийг импортлохгүй, хоёр дахь загварын менежер бичихгүй.
 */
export interface ModelSwitchTarget {
  /** Заагчийг солино (state.json).  Буцаах хувилбар тэнд ҮЛДЭНЭ. */
  activate(): Promise<unknown>;
  /** Заагчийг өмнөх рүү буцаана.  Буцах хувилбар байхгүй бол шидэж болно — залгигдана. */
  rollback(): Promise<unknown>;
  /** Хөдөлгүүрийг шинэ заагчаар дахин барина (хуучныг буулгана). */
  reloadEngine(): Promise<void>;
  /** Smoke = загвар ҮНЭХЭЭР ачаалагдах.  Унавал шидэлт. */
  smokeTest(): Promise<void>;
  log?: (msg: string) => void;
}

export interface ModelSwitchResult {
  ok: boolean;
  code: 'ACTIVATED' | 'SMOKE_FAILED_ROLLED_BACK' | 'ROLLBACK_FAILED';
  detail?: string;
}

/**
 * activate → reloadEngine → smokeTest.  Smoke унавал: rollback → reloadEngine → (best effort)
 * smokeTest, хуучин нь ч ачаалагдахгүй бол `ROLLBACK_FAILED`.  Шидэлт ХИЙХГҮЙ — дуудагч
 * үр дүнг өөрийн гэрээгээр (updater status, HTTP 500) илэрхийлнэ.
 */
export async function switchModel(target: ModelSwitchTarget): Promise<ModelSwitchResult> {
  const log = target.log ?? (() => undefined);
  await target.activate();
  await target.reloadEngine();
  try {
    await target.smokeTest();
    return { ok: true, code: 'ACTIVATED' };
  } catch (err) {
    const reason = (err as Error).message;
    log(`загварын smoke унав, буцааж байна: ${reason}`);
    await target.rollback().catch(() => undefined);
    await target.reloadEngine().catch(() => undefined);
    try {
      await target.smokeTest();
    } catch (err2) {
      return { ok: false, code: 'ROLLBACK_FAILED', detail: `${reason}; буцаалт: ${(err2 as Error).message}` };
    }
    return { ok: false, code: 'SMOKE_FAILED_ROLLED_BACK', detail: reason };
  }
}

/* ================================================================== */
/*  ШИНЭЧЛЭЛТИЙН ТӨЛӨВ — супервайзертэй хуваалцана                     */
/* ================================================================== */

export type UpdatePhase = 'idle' | 'switching' | 'verifying' | 'rolling_back';

export interface UpdateState {
  phase: UpdatePhase;
  releaseId: string | null;
  components: ComponentId[];
  /** Хүлээгдэж буй БОДИТ хувилбар (заагчийнх) — супервайзер/health тулгана. */
  expected: Partial<Record<ComponentId, string>>;
  startedAt: string;
  updatedAt: string;
}

export interface LastUpdateRecord {
  releaseId: string;
  code: string;
  ok: boolean;
  activated: ComponentId[];
  rolledBack: ComponentId[];
  detail: string | null;
  rollbackReason: string | null;
  rollbackOk: boolean | null;
  finishedAt: string;
}

export function updateStateFile(layout: InstallLayout): string {
  return join(layout.state, 'update.json');
}
export function lastUpdateFile(layout: InstallLayout): string {
  return join(layout.state, 'last-update.json');
}

export async function readUpdateState(layout: InstallLayout): Promise<UpdateState | null> {
  const s = await readJson<UpdateState>(updateStateFile(layout));
  if (!s || typeof s.phase !== 'string') return null;
  return s;
}

async function writeUpdateState(layout: InstallLayout, s: UpdateState | null): Promise<void> {
  if (s === null) {
    await rm(updateStateFile(layout), { force: true });
    return;
  }
  await writeJsonAtomic(updateStateFile(layout), { ...s, updatedAt: new Date().toISOString() });
}

/**
 * Процессын зохицуулагч — runtime-ийг зөөлөн зогсоож, супервайзер шинэ
 * заагчаас асаахыг ХҮЛЭЭНЭ, дараа нь БОДИТ хувилбарыг уншина.
 * ⚠️ Тарилга: тестэд fixture runtime, бодит ертөнцөд `bin/update.ts` (HTTP).
 */
export interface ProcessCoordinator {
  /** `/shutdown` → down → up.  `ok=false` бол шинэ процесс асаагүй. */
  restart(): Promise<{ ok: boolean; code: string; detail?: string }>;
  /** `/info`-оос АЖИЛЛАЖ БУЙ хувилбарууд (заагч биш, процесс өөрөө юу гэж хэлж байна). */
  actualVersions(): Promise<Partial<Record<ComponentId, string>>>;
}

export interface UpdateDeps {
  layout: InstallLayout;
  store: InstalledStateStore;
  download: Downloader;
  unpack?: Unpacker;
  model?: ModelActivator;
  /** Идэвхжүүлэлт (+ дахин асаалт)-ын ДАРАА.  `ok=false` → бүгд буцна. */
  healthCheck: () => Promise<{ ok: boolean; code: string }>;
  /** Заавал биш: health-ийн дараа ҮҮСГЭЛТИЙН smoke (загвар ачаалж хэдэн токен). */
  smokeTest?: () => Promise<{ ok: boolean; code: string }>;
  /** Байвал RESTART_COMPONENTS идэвхжсэний дараа дахин асаалтын гинж ажиллана. */
  coordinator?: ProcessCoordinator;
  /** Чөлөөт байтын хэмжилт — өгөгдмөл `statfs`; тестэд тарина. */
  freeBytes?: (dir: string) => Promise<number | null>;
  beforeSwitch?: (components: ComponentId[]) => Promise<void>;
  afterSwitch?: (components: ComponentId[]) => Promise<void>;
  log?: (msg: string) => void;
  onProgress?: (p: { component: ComponentId; phase: 'download' | 'verify' | 'unpack' | 'activate' | 'restart'; pct: number | null }) => void;
}

export type UpdateCode =
  | 'UP_TO_DATE'
  | 'ACTIVATED'
  | 'PLAN_NOT_OK'
  | 'INSUFFICIENT_SPACE'
  | 'DOWNLOAD_FAILED'
  | 'SHA_MISMATCH'
  | 'UNPACK_FAILED'
  | 'MODEL_FAILED'
  | 'RESTART_FAILED'
  | 'VERSION_MISMATCH'
  | 'HEALTH_FAILED_ROLLED_BACK'
  | 'HEALTH_FAILED_ROLLBACK_INCOMPLETE'
  | 'ROLLBACK_FAILED';

export interface UpdateResult {
  ok: boolean;
  code: UpdateCode;
  releaseId: string;
  activated: ComponentId[];
  rolledBack: ComponentId[];
  detail?: string;
  /** Буцаалт хийгдсэн бол шалтгаан ба хуучин хувилбарын health. */
  rollbackReason?: string;
  rollbackOk?: boolean;
  messageMn: string;
}

const defaultUnpack: Unpacker = async (_c, staged, versionDir, spec) => {
  await mkdir(versionDir, { recursive: true });
  const name = spec.meta && typeof spec.meta.fileName === 'string' ? spec.meta.fileName : basename(staged);
  const dest = join(versionDir, name);
  await rm(dest, { force: true });
  try {
    await rename(staged, dest);
  } catch {
    await copyFile(staged, dest);
    await rm(staged, { force: true });
  }
  return dest;
};

async function defaultFreeBytes(dir: string): Promise<number | null> {
  try {
    const s = await statfs(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

export async function readPointer(layout: InstallLayout, component: Exclude<ComponentId, 'model'>): Promise<CurrentPointer | null> {
  const { pointerFile } = componentHome(layout, component);
  const p = await readJson<CurrentPointer>(pointerFile);
  if (!p || typeof p.version !== 'string' || typeof p.path !== 'string') return null;
  try {
    await stat(p.path);
  } catch {
    return null; // заагч байгаа ч файл алга — repair энэ null-ыг харна
  }
  return p;
}

async function writePointer(layout: InstallLayout, component: Exclude<ComponentId, 'model'>, p: CurrentPointer): Promise<void> {
  await writeJsonAtomic(componentHome(layout, component).pointerFile, p);
}

/* ================================================================== */
/*  1. STAGING — зай · татах · SHA                                     */
/* ================================================================== */

export type StageResult =
  | { ok: true; file: string | null }
  | { ok: false; code: 'INSUFFICIENT_SPACE' | 'DOWNLOAD_FAILED' | 'SHA_MISMATCH'; detail: string };

/**
 * ⚠️ ДИСКНИЙ ЗАЙ ТАТАХААС ӨМНӨ: staging + задлах хувилбар = ~2× хэмжээ + 512 MB
 *    аюулгүйн зай.  5 GB загварыг 3 GB чөлөөтэй дискэнд татаж эхлээд дундаа
 *    унах нь ажилтны дискийг дүүргэж Windows-ийг гацаана.
 * ⚠️ ТАСАРСАН ТАТАЛТ (сүлжээ, цуцлалт, ENOSPC) → `.part` устгагдана, заагч
 *    ХӨНДӨГДӨХГҮЙ — идэвхтэй хувилбар хэвээр.
 */
export async function stageAction(deps: UpdateDeps, action: UpdateAction, signal?: AbortSignal): Promise<StageResult> {
  const { spec, component } = action;
  if (spec.url === null) return { ok: true, file: null };
  await mkdir(deps.layout.staging, { recursive: true });
  const final = join(deps.layout.staging, `${component}-${spec.version}`);
  const part = `${final}.part`;

  const existing = await readJson<unknown>(`${final}.ok`);
  if (existing !== null) {
    const v = await verifyOrDelete(final, spec.sha256);
    if (v.ok) return { ok: true, file: final };
    await rm(`${final}.ok`, { force: true });
  }

  if (spec.sizeBytes !== null && spec.sizeBytes > 0) {
    const free = await (deps.freeBytes ?? defaultFreeBytes)(deps.layout.staging);
    const need = spec.sizeBytes * 2 + 512 * 1024 * 1024;
    if (free !== null && free < need) {
      return {
        ok: false,
        code: 'INSUFFICIENT_SPACE',
        detail: `${component}: ${Math.round(need / 1048576)} MB хэрэгтэй, ${Math.round(free / 1048576)} MB чөлөөтэй`,
      };
    }
  }

  await rm(part, { force: true });
  try {
    deps.onProgress?.({ component, phase: 'download', pct: 0 });
    await deps.download(spec.url, part, (pct) => deps.onProgress?.({ component, phase: 'download', pct }), signal);
    if (signal?.aborted) throw new Error('цуцлагдсан');
  } catch (err) {
    await rm(part, { force: true });
    const msg = (err as Error).message;
    if (/ENOSPC|no space/i.test(msg)) return { ok: false, code: 'INSUFFICIENT_SPACE', detail: `${component}: ${msg}` };
    return { ok: false, code: 'DOWNLOAD_FAILED', detail: `${component}: ${msg}` };
  }

  deps.onProgress?.({ component, phase: 'verify', pct: null });
  const v = await verifyOrDelete(part, spec.sha256);
  if (!v.ok) {
    return { ok: false, code: 'SHA_MISMATCH', detail: `${component}: хүлээсэн ${v.expected}, гарсан ${v.actual ?? 'файл алга'}` };
  }
  await rm(final, { force: true });
  await rename(part, final);
  await writeJsonAtomic(`${final}.ok`, { sha256: v.sha256, at: new Date().toISOString() });
  return { ok: true, file: final };
}

/**
 * Хуучирсан staging-ийг цэвэрлэнэ — `.part` (тасарсан) ба `maxAgeMs`-ээс хуучин
 * бүх файл.  ⚠️ Идэвхтэй хувилбарын хавтас (`versions/`) энд ХӨНДӨГДӨХГҮЙ.
 */
export async function cleanStaleStaging(layout: InstallLayout, maxAgeMs = 7 * 24 * 60 * 60_000, now = Date.now()): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(layout.staging);
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const n of names) {
    const p = join(layout.staging, n);
    try {
      const st = await stat(p);
      if (n.endsWith('.part') || now - st.mtimeMs > maxAgeMs) {
        await rm(p, { force: true, recursive: true });
        removed.push(n);
      }
    } catch {
      /* аль хэдийн алга */
    }
  }
  return removed;
}

/* ================================================================== */
/*  2. ИДЭВХЖҮҮЛЭХ / БУЦААХ — хувилбарын хавтас + заагч                */
/* ================================================================== */

async function activateFileComponent(
  deps: UpdateDeps,
  action: UpdateAction,
  stagedFile: string | null,
  releaseId: string,
): Promise<{ ok: true; installed: InstalledComponent } | { ok: false; code: 'UNPACK_FAILED'; detail: string }> {
  const component = action.component as Exclude<ComponentId, 'model'>;
  const { versionsDir } = componentHome(deps.layout, component);
  const versionDir = join(versionsDir, action.spec.version);
  let activePath = versionDir;
  if (stagedFile !== null) {
    deps.onProgress?.({ component, phase: 'unpack', pct: null });
    try {
      activePath = await (deps.unpack ?? defaultUnpack)(component, stagedFile, versionDir, action.spec);
      await rm(`${stagedFile}.ok`, { force: true });
    } catch (err) {
      return { ok: false, code: 'UNPACK_FAILED', detail: (err as Error).message };
    }
  } else {
    await mkdir(versionDir, { recursive: true });
  }
  const now = new Date().toISOString();
  deps.onProgress?.({ component, phase: 'activate', pct: null });
  await writePointer(deps.layout, component, { version: action.spec.version, sha256: action.spec.sha256, path: activePath, activatedAt: now, releaseId });
  const installed: InstalledComponent = {
    ...(action.spec.id ? { id: action.spec.id } : {}),
    version: action.spec.version,
    sha256: action.spec.sha256,
    path: activePath,
    installedAt: now,
    releaseId,
  };
  await deps.store.recordActivation(component, installed, releaseId);
  return { ok: true, installed };
}

async function rollbackFileComponent(deps: UpdateDeps, component: Exclude<ComponentId, 'model'>): Promise<boolean> {
  const prev = await deps.store.recordRollback(component);
  if (prev === null) return false;
  if (prev === 'removed') {
    await rm(componentHome(deps.layout, component).pointerFile, { force: true });
    return true;
  }
  await writePointer(deps.layout, component, { version: prev.version, sha256: prev.sha256, path: prev.path ?? '', activatedAt: new Date().toISOString(), releaseId: prev.releaseId });
  return true;
}

export async function rollbackComponent(deps: UpdateDeps, component: ComponentId): Promise<boolean> {
  if (component === 'model') {
    if (!deps.model) return false;
    await deps.model.rollback();
    await deps.store.recordRollback('model');
    return true;
  }
  return rollbackFileComponent(deps, component);
}

/**
 * НЭГ бүрэлдэхүүнийг манифестын оролтгүйгээр идэвхжүүлнэ (runtime-ийн
 * `updater.ts` мэдлэгийн багцад дуудна — P0-5: заагчийг ЭНД л бичнэ).
 */
export async function activateSingleComponent(
  deps: UpdateDeps,
  component: Exclude<ComponentId, 'model'>,
  spec: ComponentSpec,
  releaseId: string | null,
): Promise<UpdateResult> {
  const installed = await deps.store.read();
  const have = installed.components[component];
  const action: UpdateAction = {
    component,
    from: have?.version ?? null,
    to: spec.version,
    reason: have ? 'version' : 'missing',
    spec,
    downgrade: have ? compareVersions(spec.version, have.version) < 0 : false,
  };
  const plan: UpdatePlan = { releaseId: releaseId ?? `single-${component}-${spec.version}`, channel: 'stable', actions: [action], unchanged: [], blocked: [], issues: [], totalBytes: spec.sizeBytes ?? 0, ok: true };
  return runUpdate(plan, deps);
}

/* ================================================================== */
/*  3. ЗОХИОН БАЙГУУЛАГЧ                                               */
/* ================================================================== */

function expectedOf(actions: readonly UpdateAction[]): Partial<Record<ComponentId, string>> {
  const out: Partial<Record<ComponentId, string>> = {};
  for (const a of actions) out[a.component] = a.to;
  return out;
}

/** Хүлээсэн ↔ бодит хувилбарын зөрүү.  Процесс мэдээлдэггүй бүрэлдэхүүн алгасагдана. */
export function versionMismatches(expected: Partial<Record<ComponentId, string>>, actual: Partial<Record<ComponentId, string>>): string[] {
  const out: string[] = [];
  for (const [c, want] of Object.entries(expected) as [ComponentId, string][]) {
    const have = actual[c];
    if (have === undefined) continue;
    if (have !== want) out.push(`${c}:${want}!=${have}`);
  }
  return out;
}

export async function runUpdate(plan: UpdatePlan, deps: UpdateDeps, opts: { force?: boolean; signal?: AbortSignal } = {}): Promise<UpdateResult> {
  const log = deps.log ?? (() => undefined);
  const base = { releaseId: plan.releaseId, activated: [] as ComponentId[], rolledBack: [] as ComponentId[] };
  const finish = async (r: UpdateResult): Promise<UpdateResult> => {
    await writeUpdateState(deps.layout, null);
    const rec: LastUpdateRecord = {
      releaseId: r.releaseId,
      code: r.code,
      ok: r.ok,
      activated: r.activated,
      rolledBack: r.rolledBack,
      detail: r.detail ?? null,
      rollbackReason: r.rollbackReason ?? null,
      rollbackOk: r.rollbackOk ?? null,
      finishedAt: new Date().toISOString(),
    };
    if (r.code !== 'UP_TO_DATE') await writeJsonAtomic(lastUpdateFile(deps.layout), rec);
    return r;
  };

  if (!plan.ok && !opts.force) {
    return finish({
      ...base,
      ok: false,
      code: 'PLAN_NOT_OK',
      detail: [...plan.issues.map((i) => `${i.code}:${i.component}`), ...plan.blocked.map((b) => `${b.code}:${b.component}`)].join(', '),
      messageMn: 'MGL AI шинэчлэл энэ компьютерт тохирсонгүй.',
    });
  }
  if (plan.actions.length === 0) return { ...base, ok: true, code: 'UP_TO_DATE', messageMn: 'MGL AI шинэчлэгдсэн байна.' };

  /* ── staging: БҮГДИЙГ эхлээд татаж шалгана, дараа нь Л идэвхжүүлнэ ── */
  const staged = new Map<ComponentId, string | null>();
  for (const a of plan.actions) {
    if (a.component === 'model') continue;
    const r = await stageAction(deps, a, opts.signal);
    if (!r.ok) {
      log(`${a.component} ${a.to}: ${r.code} — ${r.detail}`);
      return finish({
        ...base,
        ok: false,
        code: r.code,
        detail: r.detail,
        messageMn: r.code === 'INSUFFICIENT_SPACE' ? 'Дискний зай хүрэлцэхгүй — MGL AI шинэчлэл хойшлов.' : 'MGL AI шинэчлэл татаж чадсангүй. Дараа дахин оролдоно.',
      });
    }
    staged.set(a.component, r.file);
  }

  /* ── идэвхжүүлэлт (заагч солих) ─────────────────────────────────── */
  const touched = plan.actions.map((a) => a.component);
  const needsRestart = deps.coordinator !== undefined && touched.some((c) => RESTART_COMPONENTS.includes(c));
  await deps.beforeSwitch?.(touched);
  const activated: ComponentId[] = [];

  const rollbackAll = async (): Promise<ComponentId[]> => {
    const done: ComponentId[] = [];
    for (const c of [...activated].reverse()) {
      try {
        if (await rollbackComponent(deps, c)) done.push(c);
      } catch (err) {
        log(`${c}: буцаалт унав — ${(err as Error).message}`);
      }
    }
    return done;
  };

  for (const a of plan.actions) {
    if (a.component === 'model') {
      if (!deps.model) return finish({ ...base, ok: false, code: 'MODEL_FAILED', detail: 'ModelActivator тарилгагүй', messageMn: 'AI загварын шинэчлэл боломжгүй.' });
      try {
        const m = await deps.model.activate(a.spec, (pct) => deps.onProgress?.({ component: 'model', phase: 'download', pct }));
        await deps.store.recordActivation(
          'model',
          { ...(a.spec.id ? { id: a.spec.id } : {}), version: a.spec.version, sha256: m.sha256, path: m.path, installedAt: new Date().toISOString(), releaseId: plan.releaseId },
          plan.releaseId,
        );
        activated.push('model');
      } catch (err) {
        const rolledBack = await rollbackAll();
        await deps.afterSwitch?.(touched);
        return finish({ ...base, ok: false, code: 'MODEL_FAILED', detail: (err as Error).message, rolledBack, rollbackReason: `MODEL_FAILED: ${(err as Error).message}`, messageMn: 'AI загварын шинэчлэл тохирсонгүй — өмнөх хувилбар үргэлжилж байна.' });
      }
      continue;
    }
    const r = await activateFileComponent(deps, a, staged.get(a.component) ?? null, plan.releaseId);
    if (!r.ok) {
      const rolledBack = await rollbackAll();
      await deps.afterSwitch?.(touched);
      return finish({ ...base, ok: false, code: r.code, detail: r.detail, rolledBack, rollbackReason: `${r.code}: ${r.detail}`, messageMn: 'MGL AI шинэчлэл суулгаж чадсангүй — өмнөх хувилбар үргэлжилж байна.' });
    }
    activated.push(a.component);
    log(`${a.component}: ${a.from ?? '—'} → ${a.to} идэвхжлээ (заагч)`);
  }
  await deps.afterSwitch?.(touched);

  /* ── буцаалтын гинж — заагч буцаах → (дахин асаах) → хуучны health ── */
  const rollbackChain = async (reason: string, code: UpdateCode): Promise<UpdateResult> => {
    log(`${reason} — ${activated.length} бүрэлдэхүүнийг буцааж байна`);
    await deps.beforeSwitch?.(touched);
    const rolledBack = await rollbackAll();
    await deps.afterSwitch?.(touched);
    let rollbackOk: boolean | null = null;
    let detail = reason;
    if (needsRestart && rolledBack.some((c) => RESTART_COMPONENTS.includes(c))) {
      const prev = await deps.store.read();
      const expectedPrev: Partial<Record<ComponentId, string>> = {};
      for (const c of rolledBack) if (prev.components[c]) expectedPrev[c] = prev.components[c]!.version;
      await writeUpdateState(deps.layout, { phase: 'rolling_back', releaseId: plan.releaseId, components: rolledBack, expected: expectedPrev, startedAt: new Date().toISOString(), updatedAt: '' });
      deps.onProgress?.({ component: 'runtime', phase: 'restart', pct: null });
      const rs = await deps.coordinator!.restart();
      if (!rs.ok) {
        rollbackOk = false;
        detail = `${reason}; буцаалтын дахин асаалт унав: ${rs.code}`;
      } else {
        const actual = await deps.coordinator!.actualVersions();
        const mm = versionMismatches(expectedPrev, actual);
        const h = await deps.healthCheck();
        rollbackOk = mm.length === 0 && h.ok;
        if (!rollbackOk) detail = `${reason}; хуучин хувилбар: ${mm.length ? mm.join(',') : h.code}`;
      }
    } else {
      const h = await deps.healthCheck().catch(() => ({ ok: false, code: 'HEALTH_THREW' }));
      rollbackOk = h.ok;
      if (!h.ok) detail = `${reason}; хуучин хувилбарын health: ${h.code}`;
    }
    const complete = rolledBack.length === activated.length;
    const finalCode: UpdateCode = rollbackOk === false ? 'ROLLBACK_FAILED' : complete ? code : 'HEALTH_FAILED_ROLLBACK_INCOMPLETE';
    return finish({
      ...base,
      ok: false,
      code: finalCode,
      detail,
      activated,
      rolledBack,
      rollbackReason: reason,
      rollbackOk,
      messageMn:
        finalCode === 'ROLLBACK_FAILED'
          ? 'MGL AI шинэчлэл тохирсонгүй, өмнөх хувилбар ч асахгүй байна. Засвар шаардлагатай.'
          : complete
            ? 'MGL AI шинэчлэл тохирсонгүй — өмнөх хувилбар үргэлжилж байна.'
            : 'MGL AI шинэчлэл тохирсонгүй. Засвар шаардлагатай.',
    });
  };

  /* ── дахин асаалт + БОДИТ хувилбарын шалгалт (P0-1, P0-6) ───────── */
  if (needsRestart) {
    const expected = expectedOf(plan.actions.filter((a) => RESTART_COMPONENTS.includes(a.component)));
    await writeUpdateState(deps.layout, { phase: 'switching', releaseId: plan.releaseId, components: activated, expected, startedAt: new Date().toISOString(), updatedAt: '' });
    deps.onProgress?.({ component: 'runtime', phase: 'restart', pct: null });
    const rs = await deps.coordinator!.restart();
    if (!rs.ok) return rollbackChain(`RESTART_FAILED: ${rs.code}${rs.detail ? ` (${rs.detail})` : ''}`, 'RESTART_FAILED');
    await writeUpdateState(deps.layout, { phase: 'verifying', releaseId: plan.releaseId, components: activated, expected, startedAt: new Date().toISOString(), updatedAt: '' });
    const actual = await deps.coordinator!.actualVersions();
    const mm = versionMismatches(expected, actual);
    if (mm.length > 0) return rollbackChain(`VERSION_MISMATCH: ${mm.join(', ')}`, 'VERSION_MISMATCH');
  }

  /* ── health → smoke — БҮГД эсвэл ЮУ Ч БИШ ──────────────────────── */
  const h = await deps.healthCheck();
  if (!h.ok) return rollbackChain(`HEALTH_FAILED: ${h.code}`, 'HEALTH_FAILED_ROLLED_BACK');
  if (deps.smokeTest) {
    const s = await deps.smokeTest().catch((err: unknown) => ({ ok: false, code: `SMOKE_THREW: ${(err as Error).message}` }));
    if (!s.ok) return rollbackChain(`SMOKE_FAILED: ${s.code}`, 'HEALTH_FAILED_ROLLED_BACK');
  }

  await deps.store.markHealthy(plan.releaseId);
  return finish({ ...base, ok: true, code: 'ACTIVATED', activated, messageMn: 'MGL AI шинэчлэгдлээ.' });
}
