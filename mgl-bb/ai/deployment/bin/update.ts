/**
 * MGL AI · БҮРЭЛДЭХҮҮНИЙ ШИНЭЧЛЭГЧ CLI (Session B §12–§14, §32).
 *
 *   node deployment/bin/update.ts               манифест → төлөвлөгөө → татах → шалгах → идэвхжүүлэх → health → (буцаах)
 *   node deployment/bin/update.ts --plan        зөвхөн төлөвлөгөө (JSON), юу ч татахгүй
 *   node deployment/bin/update.ts --repair      бүх бүрэлдэхүүнийг дахин суулгана (force)
 *   node deployment/bin/update.ts --manifest <файл|URL>   тест/staging манифест (allowlist-тай)
 *
 * ⚠️ МАНИФЕСТЫН ЭХ СУРВАЛЖ ALLOWLIST (§34): Worker (`/api/mgl-ai/fleet/release-manifest`),
 *    `file://` (локал тест), эсвэл `MGLAI_MANIFEST_HOSTS`-д зарласан хост.  Дурын URL ҮГҮЙ.
 *    Артефактын URL нь Worker-ийн хост, эсвэл нийтийн R2 (`pub-mgl-media.r2.dev`) л.
 *    Bearer токен ЗӨВХӨН Worker-ийн хост руу явна — нийтийн R2 руу ХЭЗЭЭ Ч.
 *
 * ⚠️ `model` бүрэлдэхүүнийг ЭНД ТАТАХГҮЙ — runtime-ийн `modelManager` (SHA, .part,
 *    active/previous, smoke) татна.  `ModelActivator` нь runtime-ийн `/update/check`
 *    → `/update/status` → `/info.active_model` гинжийг дуудаж, spec.id-тай тулгана.
 *
 * ⚠️ RUNTIME/МЭДЛЭГ ШИНЭЧЛЭГДВЭЛ ДАХИН АСААЛТЫН ГИНЖ (P0-1): заагч солигдсоны ДАРАА
 *    `ProcessCoordinator` нь `/shutdown` дуудна, супервайзер (`bin/supervise.ts`,
 *    Task Scheduler) заагчаас ШИНЭ хувилбарыг асаана (`state/update.json`-оор зориудын
 *    гарц гэж мэднэ), `/info.deployment.running` ≟ хүлээсэн → `/deploy/health?full=1` →
 *    `/generate` smoke → PASS: lastKnownGood · FAIL: заагч буцааж дахин асаана.
 *    Супервайзер алга бол (dev PC) заагчийн `supervise.ts --once`-ийг өөрөө асаана.
 */
import { readFile, mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { platform } from 'node:os';

import { runUpdate, cleanStaleStaging, readPointer, type UpdateDeps, type ModelActivator, type Unpacker, type ProcessCoordinator } from '../src/activation.ts';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname as pdirname } from 'node:path';
import { classifyHardware } from '../src/hardwareClass.ts';
import { InstalledStateStore } from '../src/installedState.ts';
import { ensureLayout, resolveLayout } from '../src/layout.ts';
import { createLogger } from '../src/logger.ts';
import { validateManifest, type ReleaseManifest } from '../src/manifest.ts';
import { planUpdate } from '../src/updatePlan.ts';
import { readJson } from '../src/integrity.ts';
import { applyInstallEnv } from '../src/installEnv.ts';

const exec = promisify(execFile);
applyInstallEnv();
const layout = resolveLayout();
await ensureLayout(layout);
const log = createLogger({ dir: layout.logs, category: 'updater' });
const port = Number(process.env.MGLAI_PORT ?? 39217);
const runtimeUrl = `http://127.0.0.1:${port}`;
const controlPlane = (process.env.MGLAI_CONTROL_PLANE ?? 'https://mgl-progress-api.mglenc-design.workers.dev').replace(/\/+$/, '');
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : undefined);

const ALLOWED_ARTIFACT_HOSTS = new Set([new URL(controlPlane).host, 'pub-mgl-media.r2.dev', ...(process.env.MGLAI_MANIFEST_HOSTS ?? '').split(',').map((s) => s.trim()).filter(Boolean)]);

const secret = await readFile(join(layout.root, 'secret.txt'), 'utf8').then((s) => s.trim()).catch(() => '');
const cred = await readJson<{ token?: string; expiresAtMs?: number | null }>(join(layout.root, 'credential.json'));
const token = cred?.token && (cred.expiresAtMs === null || cred.expiresAtMs === undefined || cred.expiresAtMs > Date.now()) ? cred.token : null;
const store = new InstalledStateStore(layout.installedFile);
const installed = await store.read();

/* ── 1. манифест ─────────────────────────────────────────────────── */
async function loadManifest(): Promise<ReleaseManifest> {
  const src = opt('--manifest');
  let raw: unknown;
  if (src?.startsWith('file://') || (src && !/^https?:/.test(src))) {
    raw = JSON.parse(await readFile(src.replace(/^file:\/\//, ''), 'utf8'));
  } else {
    const url = src ?? `${controlPlane}/api/mgl-ai/fleet/release-manifest?installation_id=${encodeURIComponent(installed.installationId)}`;
    const host = new URL(url).host;
    if (!ALLOWED_ARTIFACT_HOSTS.has(host)) throw new Error(`Манифестын хост зөвшөөрөгдөөгүй: ${host}`);
    if (!token) throw new Error('ERP-тэй хосолоогүй (credential.json алга/хуучирсан) — ERP-ийн MGL AI хуудсыг нэг удаа нээнэ үү.');
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`Манифест: HTTP ${res.status}`);
    const body = (await res.json()) as { available?: boolean; manifest?: unknown };
    if (body.available === false) throw new Error('Энэ сувагт манифест нийтлэгдээгүй байна.');
    raw = body.manifest;
  }
  const v = validateManifest(raw);
  if (!v.ok) throw new Error(`Манифест буруу: ${v.errors.join(', ')}`);
  return v.manifest;
}

/* ── 2. deps ─────────────────────────────────────────────────────── */
const download: UpdateDeps['download'] = async (url, dest, onProgress) => {
  const u = new URL(url);
  if (u.protocol === 'file:') {
    await pipeline(Readable.from(await readFile(u)), createWriteStream(dest));
    return;
  }
  if (!ALLOWED_ARTIFACT_HOSTS.has(u.host)) throw new Error(`Артефактын хост зөвшөөрөгдөөгүй: ${u.host}`);
  // ⚠️ Bearer нь ЗӨВХӨН Worker руу — нийтийн R2 руу токен ЯВАХГҮЙ.
  const headers: Record<string, string> = u.host === new URL(controlPlane).host && token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(url, { headers });
  if (!res.ok || !res.body) throw new Error(`Татаж чадсангүй: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  let got = 0;
  const src = Readable.fromWeb(res.body as never);
  src.on('data', (c: Buffer) => {
    got += c.length;
    if (total > 0) onProgress?.(Math.round((got / total) * 100));
  });
  await pipeline(src, createWriteStream(dest));
};

const unpack: Unpacker = async (component, staged, versionDir, spec) => {
  const isZip = spec.meta?.format === 'zip' || (spec.url ?? '').toLowerCase().endsWith('.zip');
  if (!isZip) {
    await mkdir(versionDir, { recursive: true });
    const name = typeof spec.meta?.fileName === 'string' ? spec.meta.fileName : `${component}.bin`;
    const dest = join(versionDir, name);
    await pipeline(Readable.from(await readFile(staged)), createWriteStream(dest));
    return dest;
  }
  if (platform() !== 'win32') throw new Error('zip задлах нь Windows (Expand-Archive) дээр л дэмжигдэнэ.');
  await mkdir(versionDir, { recursive: true });
  await exec('powershell', ['-NoProfile', '-Command', `$ErrorActionPreference='Stop'; Expand-Archive -Path '${staged}' -DestinationPath '${versionDir}' -Force`]);
  return versionDir;
};

async function rt(path: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<{ status: number; body: Record<string, unknown> | null }> {
  try {
    const res = await fetch(`${runtimeUrl}${path}`, { ...init, headers: { 'x-mglai-secret': secret, 'content-type': 'application/json', ...(init.headers ?? {}) }, signal: AbortSignal.timeout(timeoutMs) });
    return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
  } catch {
    return { status: 0, body: null };
  }
}

const model: ModelActivator = {
  async activate(spec) {
    // Runtime-ийн өөрийн updater татна (SHA + smoke + rollback тэнд).
    const kick = await rt('/update/check', { method: 'POST', body: JSON.stringify({ force: false }) });
    if (kick.status === 0) throw new Error('runtime ажиллахгүй байна — загвар татах боломжгүй.');
    const deadline = Date.now() + 6 * 60 * 60_000; // 6 цаг — 5 GB удаан сүлжээнд
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5000));
      const st = await rt('/update/status');
      const phase = st.body?.phase;
      if (phase === 'failed') throw new Error(String(st.body?.error ?? 'загварын шинэчлэлт унав'));
      if (phase === 'ready' || phase === 'idle') break;
    }
    const info = await rt('/info');
    const active = info.body?.active_model as { releaseUid?: string; sha256?: string; path?: string } | null | undefined;
    if (!active || (spec.id && active.releaseUid !== spec.id)) {
      throw new Error(`Идэвхтэй загвар ${active?.releaseUid ?? 'алга'} ≠ манифестын ${spec.id ?? '?'}`);
    }
    if (active.sha256 && active.sha256.toLowerCase() !== spec.sha256) throw new Error('Загварын SHA манифесттэй таарахгүй.');
    return { path: active.path ?? '', sha256: active.sha256 ?? spec.sha256 };
  },
  async rollback() {
    // runtime-ийн updater нь өөрөө буцаадаг; энд зөвхөн `previous` байвал идэвхжүүлнэ.
    const info = await rt('/info');
    const installedList = (info.body?.installed as { release_uid: string }[] | undefined) ?? [];
    const prev = installedList.find((m) => m.release_uid === installed.previous.model?.id);
    if (prev) await rt('/model/activate', { method: 'POST', body: JSON.stringify({ release_uid: prev.release_uid }) }, 300_000);
  },
};

/* ── ProcessCoordinator (P0-1): /shutdown → down → супервайзер асаана → up ── */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitHealth(want: boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const r = await rt('/health', {}, 2000);
    const up = r.status === 200 && r.body?.service === 'mgl-ai-runtime';
    if (up === want) return true;
    await sleep(500);
  }
  return false;
}
async function supervisorAlive(): Promise<boolean> {
  const l = await readJson<{ pid?: number }>(layout.supervisorLock);
  if (!l || typeof l.pid !== 'number') return false;
  try {
    process.kill(l.pid, 0);
    return true;
  } catch {
    return false;
  }
}
const coordinator: ProcessCoordinator = {
  async restart() {
    const wasUp = (await rt('/health', {}, 2000)).status === 200;
    if (wasUp) {
      await rt('/shutdown', { method: 'POST' }, 5000);
      if (!(await waitHealth(false, 20_000))) return { ok: false, code: 'SHUTDOWN_TIMEOUT' };
    }
    // Супервайзер (Task Scheduler) заагчаас асаана.  Супервайзер алга бол (dev PC,
    // эсвэл даалгавар унтарсан) — ШИНЭ заагчийн супервайзерыг --once горимоор өөрсдөө асаана.
    let up = await waitHealth(true, 45_000);
    if (!up && !(await supervisorAlive())) {
      const p = await readPointer(layout, 'runtime');
      const sup = p ? join(p.path, 'deployment', 'bin', 'supervise.ts') : join(pdirname(fileURLToPath(import.meta.url)), 'supervise.ts');
      log.warn('супервайзер алга — заагчийн супервайзерыг --once горимоор асааж байна', { entry: sup });
      const child = spawn(process.execPath, [sup, '--once'], { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env } });
      child.unref();
      up = await waitHealth(true, 45_000);
    }
    return up ? { ok: true, code: 'RESTARTED' } : { ok: false, code: 'START_TIMEOUT' };
  },
  async actualVersions() {
    const r = await rt('/info');
    const running = (r.body?.deployment as { running?: Record<string, string> } | undefined)?.running ?? {};
    return { runtime: running.runtime, knowledge: running.knowledge, model: running.model };
  },
};

const deps: UpdateDeps = {
  layout,
  store,
  download,
  unpack,
  model,
  coordinator,
  healthCheck: async () => {
    const r = await rt('/deploy/health?full=1', {}, 240_000);
    const status = (r.body?.status as string | undefined) ?? 'UNKNOWN';
    return { ok: r.status === 200 && (status === 'READY' || status === 'DEGRADED'), code: status };
  },
  smokeTest: async () => {
    const r = await rt('/generate', { method: 'POST', body: JSON.stringify({ turns: [{ role: 'user', content: 'Сайн уу' }], max_tokens: 8, stream: false }) }, 120_000);
    return r.status === 200 ? { ok: true, code: 'GENERATION_OK' } : { ok: false, code: `GENERATION_HTTP_${r.status}` };
  },
  log: (m) => log.info(m),
  onProgress: (p) => log.debug(`${p.component} ${p.phase}${p.pct !== null ? ` ${p.pct}%` : ''}`),
};

/* ── 3. ажиллуул ─────────────────────────────────────────────────── */
try {
  const stale = await cleanStaleStaging(layout);
  if (stale.length > 0) log.info('хуучирсан staging цэвэрлэв', { removed: stale.join(',') });
  const manifest = await loadManifest();
  const hw = await rt('/info');
  const hwProfile = hw.body?.hardware as { arch: string; ramMb: number; vramMb: number | null; gpu: string | null } | undefined;
  const hardwareClass = hwProfile ? classifyHardware(hwProfile).hardwareClass : undefined;
  const plan = planUpdate({ manifest, installed, hardwareClass, force: flag('--repair') });
  if (flag('--plan')) {
    process.stdout.write(`${JSON.stringify({ releaseId: plan.releaseId, ok: plan.ok, actions: plan.actions.map((a) => ({ component: a.component, from: a.from, to: a.to, reason: a.reason })), blocked: plan.blocked, issues: plan.issues, totalBytes: plan.totalBytes }, null, 2)}\n`);
    process.exit(0);
  }
  const result = await runUpdate(plan, deps, { force: false });
  log[result.ok ? 'info' : 'error'](`шинэчлэлт ${result.code}`, { release: result.releaseId, activated: result.activated.join(','), rolledBack: result.rolledBack.join(','), detail: result.detail ?? null });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(result.ok ? 0 : 1);
} catch (err) {
  log.error('шинэчлэлт унав', { detail: (err as Error).message });
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
}
