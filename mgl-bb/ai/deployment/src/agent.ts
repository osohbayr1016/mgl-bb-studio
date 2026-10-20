/**
 * MGL AI · DEPLOYMENT AGENT — runtime процесс дотор амьдарна (Session B §11, §16, §30).
 *
 * `server.ts`-ийн ЖИЖИГ hook-оор бүтээгдэнэ (`createDeploymentAgent`), дараа нь:
 *   · `heartbeat` мөчлөг — 2 мин дараа, дараа нь 30 мин тутам (`/fleet/heartbeat`)
 *   · `report()`         — §11-ийн health тайлан (light = хүнд шалгалтгүй)
 *   · `diagnostics()`    — §30 багц
 *   · `syncInstalled()`  — `models/state.json` → `installed.json` тусгал
 *
 * ⚠️ RUNTIME-ИЙН ДОТООД ТӨЛӨВ РҮҮ ХАЛЬТ ОРОХГҮЙ.  Health нь ӨӨРИЙН runtime-ийн
 *    НИЙТИЙН гарц руу (127.0.0.1) HTTP-ээр ханддаг — тиймээс `bin/health.ts`
 *    (гаднаас) ба энэ agent (дотроос) ЯГ ижил шалгалтыг ажиллуулна.  Хоёр
 *    үнэн үүсэхгүй.
 *
 * ⚠️ HEARTBEAT НЬ ТОКЕНГҮЙ ЯВАХГҮЙ, АЛДАА Ч БИШ.  Хосолсон ERP токен
 *    (`credentials.valid()`) байхгүй бол ажилтан ERP-ээ хараахан нээгээгүй
 *    — дараагийн удаа.  Runtime ХЭЗЭЭ Ч өөрийн урт наслалт токен минтлэхгүй.
 *
 * ⚠️ СЕРВЕРИЙН ХАРИУ ДАХЬ `channel` / `telemetry_level`-ийг ДАГАНА — админ
 *    ажилтныг canary руу шилжүүлэх, түр DEBUG асаах нь ЭНЭ замаар.  Гэхдээ
 *    DEBUG нь зөвхөн серверээс ирсэн үед л; локал файлд DEBUG бичигдэхгүй
 *    (дараагийн эхлэлтэд MINIMAL руу буцна).
 */
import { join } from 'node:path';

import type { HardwareProfile } from '../../runtime/src/hardware.ts';

import { buildDiagnosticBundle, type DiagnosticBundle } from './diagnostics.ts';
import { fleetHardwareSummary } from './hardwareClass.ts';
import { runHealthChecks, type HealthReport } from './health.ts';
import { buildHeartbeat, sendHeartbeat } from './heartbeat.ts';
import { InstalledStateStore } from './installedState.ts';
import { readJson, writeJsonAtomic } from './integrity.ts';
import { lastUpdateFile, type LastUpdateRecord } from './activation.ts';
import { ensureLayout, resolveLayout, type InstallLayout } from './layout.ts';
import { createLogger, type Logger } from './logger.ts';
import { isChannel } from './manifest.ts';
import { httpNormProviders, type NormProviders } from './normProviders.ts';
import { withRegistryVersion } from './normVersion.ts';
import { createProbes, resolveKnowledgeDb } from './probes.ts';
import { isTelemetryLevel, type TelemetryLevel } from './telemetry.ts';

export interface AgentDeps {
  dataDir: string;
  runtimeUrl: string;
  runtimeSecret: string;
  controlPlane: string;
  runtimeVersion: string;
  legacyKnowledgeDb: string;
  /** Ажиллаж буй серверийн entry (process.argv[1]) — заагчгүй суулгацын файлын шалгалтад. */
  runtimeEntry?: string | null;
  hardware: HardwareProfile;
  /** ERP токен — хосолсон бол. */
  token: () => Promise<string | null>;
  /** modelManager-ийн идэвхтэй загвар + адаптер — тусгалд. */
  activeModel: () => Promise<{ version: string; sha256: string; path: string; releaseUid: string } | null>;
  activeAdapter: () => Promise<{ version: string; sha256: string } | null>;
  updateStatus: () => { phase: string; what: string | null; percent: number | null; error: string | null };
  /** P0-6: процессын бодит хувилбарууд (server.ts deploymentSummary().running). */
  runningVersions?: () => Promise<Record<string, string>>;
  /** Санамсаргүй нэмэлт лог файлууд (start.ps1-ийн runtime.log г.м.). */
  extraLogFiles?: string[];
  /** Session A-ийн provider бэлэн болоход энд тарина; өгөгдмөл нь HTTP адаптер. */
  norm?: NormProviders;
  fetchImpl?: typeof fetch;
  now?: () => number;
  log?: (msg: string) => void;
}

export interface DeploymentAgent {
  layout: InstallLayout;
  store: InstalledStateStore;
  logger: Logger;
  telemetryLevel(): Promise<TelemetryLevel>;
  setTelemetryLevel(level: TelemetryLevel): Promise<void>;
  syncInstalled(): Promise<void>;
  report(opts?: { light?: boolean; updating?: boolean }): Promise<HealthReport>;
  lastReport(): HealthReport | null;
  heartbeat(): Promise<{ sent: boolean; reason: string }>;
  start(): void;
  stop(): void;
  diagnostics(): Promise<{ ok: true; bundle: DiagnosticBundle } | { ok: false; violations: string[] }>;
  /** Шинэчлэлтийн мөр — диагностикт орно. */
  trace(line: string): void;
}

const FIRST_HEARTBEAT_MS = 2 * 60_000;
const HEARTBEAT_EVERY_MS = 30 * 60_000;

export async function createDeploymentAgent(deps: AgentDeps): Promise<DeploymentAgent> {
  const layout = resolveLayout(deps.dataDir);
  await ensureLayout(layout);
  const store = new InstalledStateStore(layout.installedFile);
  const logger = createLogger({ dir: layout.logs, category: 'telemetry' });
  const healthLogger = createLogger({ dir: layout.logs, category: 'health' });
  const f = deps.fetchImpl ?? fetch;
  const headers = { 'x-mglai-secret': deps.runtimeSecret };
  const trace: string[] = [];
  let last: HealthReport | null = null;
  let timer: NodeJS.Timeout | null = null;
  let first: NodeJS.Timeout | null = null;
  /** Серверээс түр өгсөн DEBUG — диск дээр бичигдэхгүй. */
  let sessionLevel: TelemetryLevel | null = null;

  // Session D §8 (2026-09-14): B-ийн http provider-ийг Worker-ийн нормын бүртгэлтэй тулгах
  //    бүрхүүлээр ороов — `version()` нь kf1/rf1 хурууны хээ, `health()` нь sha зөрвөл
  //    NORM_DATA_VERSION_MISMATCH (fatal → NORM facet READY биш).  Эх сурвалж хоёулаа Session A-ийнх.
  const norm =
    deps.norm ??
    withRegistryVersion(httpNormProviders({ baseUrl: deps.runtimeUrl, headers, fetchImpl: f }), {
      runtimeUrl: deps.runtimeUrl,
      runtimeHeaders: headers,
      controlPlane: deps.controlPlane,
      token: deps.token,
      fetchImpl: f,
    });

  async function telemetryLevel(): Promise<TelemetryLevel> {
    if (sessionLevel) return sessionLevel;
    const raw = await readJson<{ level?: unknown }>(layout.telemetryFile);
    return isTelemetryLevel(raw?.level) ? raw.level : 'MINIMAL';
  }

  async function setTelemetryLevel(level: TelemetryLevel): Promise<void> {
    if (level === 'DEBUG') {
      sessionLevel = 'DEBUG';
      return;
    }
    sessionLevel = null;
    await writeJsonAtomic(layout.telemetryFile, { level, updatedAt: new Date().toISOString() });
  }

  async function syncInstalled(): Promise<void> {
    const [m, a] = await Promise.all([deps.activeModel(), deps.activeAdapter()]);
    await store.mirrorModel(m, a);
    // runtime хувилбар: заагч байхгүй (хуучин суулгац) бол ажиллаж буй кодын хувилбарыг тусгана.
    const s = await store.read();
    if (!s.components.runtime || s.components.runtime.version !== deps.runtimeVersion) {
      await store.update((st) => {
        st.components.runtime = {
          version: deps.runtimeVersion,
          sha256: st.components.runtime?.sha256 ?? '0'.repeat(64),
          path: st.components.runtime?.path ?? null,
          installedAt: st.components.runtime?.installedAt ?? new Date().toISOString(),
          releaseId: st.components.runtime?.releaseId ?? null,
        };
      });
    }
  }

  async function report(opts: { light?: boolean; updating?: boolean } = {}): Promise<HealthReport> {
    const s = await store.read();
    const knowledgeDbPath = await resolveKnowledgeDb(layout, deps.legacyKnowledgeDb);
    const probes = createProbes({
      layout,
      runtimeUrl: deps.runtimeUrl,
      runtimeHeaders: headers,
      controlPlane: deps.controlPlane,
      revitBridgeUrl: null,
      fetchImpl: f,
      shaCacheFile: join(layout.state, 'model-sha.json'),
      expectedModelSha256: s.components.model?.sha256 ?? null,
      knowledgeDbPath,
      runtimeEntryHint: deps.runtimeEntry ?? null,
      desiredVersions: Object.fromEntries(Object.entries(s.components).filter(([, v]) => v).map(([k, v]) => [k, v!.version])),
    });
    const r = await runHealthChecks({ probes, norm, light: opts.light ?? true, updating: opts.updating });
    last = r;
    await writeJsonAtomic(layout.healthFile, r);
    healthLogger.info(`health ${r.status}`, { reasons: r.reasonCodes.join(','), ms: r.totalMs, light: opts.light ?? true });
    if (r.status === 'READY' && s.currentRelease) await store.markHealthy(s.currentRelease);
    return r;
  }

  async function heartbeat(): Promise<{ sent: boolean; reason: string }> {
    const token = await deps.token();
    if (token === null) return { sent: false, reason: 'NOT_PAIRED' };
    const level = await telemetryLevel();
    if (level === 'OFF') return { sent: false, reason: 'TELEMETRY_OFF' };
    await syncInstalled();
    const installed = await store.read();
    const u = deps.updateStatus();
    const lastUpd = await readJson<LastUpdateRecord>(lastUpdateFile(layout));
    const running = deps.runningVersions ? await deps.runningVersions().catch(() => ({})) : {};
    const payload = buildHeartbeat({
      installed,
      hardware: deps.hardware,
      health: last,
      level,
      running,
      update: { phase: u.phase, what: u.what, percent: u.percent, error: u.error, last: lastUpd ? { code: lastUpd.code, ok: lastUpd.ok, release: lastUpd.releaseId } : null },
      runtimeUptimeS: Math.round(process.uptime()),
    });
    if (payload === null) return { sent: false, reason: 'TELEMETRY_OFF' };
    const res = await sendHeartbeat({ controlPlane: deps.controlPlane, token, fetchImpl: f }, payload);
    if (!res.ok) {
      logger.warn('heartbeat унав', { status: res.status });
      return { sent: false, reason: res.status === 0 ? 'BACKEND_UNREACHABLE' : `HTTP_${res.status}` };
    }
    if (res.channel && isChannel(res.channel) && res.channel !== installed.channel) {
      await store.setChannel(res.channel);
      logger.info(`суваг солигдов: ${installed.channel} → ${res.channel}`);
    }
    if (res.telemetry_level && isTelemetryLevel(res.telemetry_level) && res.telemetry_level !== level) {
      await setTelemetryLevel(res.telemetry_level);
      logger.info(`телеметрийн түвшин: ${level} → ${res.telemetry_level}`);
    }
    return { sent: true, reason: 'OK' };
  }

  function start(): void {
    if (timer) return;
    first = setTimeout(() => {
      void report({ light: true }).catch(() => undefined).then(() => heartbeat()).catch(() => undefined);
    }, FIRST_HEARTBEAT_MS);
    first.unref?.();
    timer = setInterval(() => {
      void report({ light: true }).catch(() => undefined).then(() => heartbeat()).catch(() => undefined);
    }, HEARTBEAT_EVERY_MS);
    timer.unref?.();
  }

  function stop(): void {
    if (first) clearTimeout(first);
    if (timer) clearInterval(timer);
    first = null;
    timer = null;
  }

  async function diagnostics() {
    const installed = await store.read();
    const hw = fleetHardwareSummary(deps.hardware);
    const lastUpd = await readJson<LastUpdateRecord>(lastUpdateFile(layout));
    const running = deps.runningVersions ? await deps.runningVersions().catch(() => ({})) : {};
    return buildDiagnosticBundle({
      runningVersions: running,
      lastUpdate: lastUpd,
      layout,
      installed,
      telemetryLevel: await telemetryLevel(),
      health: last,
      hardware: { hardwareClass: hw.hardwareClass, os: hw.os, arch: hw.arch, ramMb: hw.ramMb, gpu: hw.gpu, vramMb: hw.vramMb },
      updateTrace: trace,
      extraLogFiles: deps.extraLogFiles ?? [],
    });
  }

  return {
    layout,
    store,
    logger,
    telemetryLevel,
    setTelemetryLevel,
    syncInstalled,
    report,
    lastReport: () => last,
    heartbeat,
    start,
    stop,
    diagnostics,
    trace: (line) => {
      trace.push(`${new Date().toISOString()} ${line}`);
      if (trace.length > 200) trace.shift();
    },
  };
}
