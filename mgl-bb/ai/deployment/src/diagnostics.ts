/**
 * MGL AI · ДИАГНОСТИКИЙН БАГЦ (Session B §30).
 *
 * Ажилтан/админ «MGL AI ажиллахгүй байна» гэхэд НЭГ файл өгнө:
 *   хувилбарууд · манифестын ID · хардверийн ангилал · health шалгалтууд ·
 *   ариутгасан логийн сүүлч · эхлэлтийн алдаа · шинэчлэлтийн мөр · хоцролт
 *
 * ⚠️ ОРОХГҮЙ: `credential.json` (ERP JWT!), `secret.txt`, токен/толгой,
 *    компанийн нууц агуулга, локал хувийн санамж, ярианы текст.  Багц нь
 *    `findSensitiveKeys`-ээр өөрийгөө шалгана — нууц олдвол ЭКСПОРТЛОХГҮЙ,
 *    хаана олдсоныг л хэлнэ (тест).
 *
 * ⚠️ ЛОГИЙН МӨР `redactText`-ээр давхар цэвэрлэгдэнэ — логгер аль хэдийн
 *    хийсэн ч хуучин `runtime.log` (start.ps1) redact-гүй.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { healthSummary, type HealthReport } from './health.ts';
import type { InstalledState } from './installedState.ts';
import { tailLines, LOG_CATEGORIES } from './logger.ts';
import type { InstallLayout } from './layout.ts';
import { findSensitiveKeys, redactText, type TelemetryLevel } from './telemetry.ts';
import type { HardwareClass } from './hardwareClass.ts';

export interface DiagnosticBundle {
  schema: 'mgl-ai-diagnostics/1';
  generatedAt: string;
  installationId: string;
  channel: string;
  telemetryLevel: TelemetryLevel;
  releases: {
    current: string | null;
    previous: string | null;
    lastKnownGood: string | null;
  };
  versions: Record<string, { version: string; sha256: string; releaseId: string | null }>;
  /** P0-6: процессын бодит хувилбар — заагчаас зөрвөл энд харагдана. */
  runningVersions: Record<string, string>;
  /** Сүүлийн шинэчлэлт: код, буцаалтын шалтгаан, буцаалт амжилттай эсэх. */
  lastUpdate: { releaseId: string; code: string; ok: boolean; activated: string[]; rolledBack: string[]; rollbackReason: string | null; rollbackOk: boolean | null; finishedAt: string } | null;
  hardware: { hardwareClass: HardwareClass; os: string; arch: string; ramMb: number; gpu: string | null; vramMb: number | null } | null;
  health: ReturnType<typeof healthSummary> | null;
  healthChecks: { id: string; ok: boolean; code: string; ms: number; skipped: boolean }[];
  updateTrace: string[];
  startupFailures: string[];
  latency: Record<string, number> | null;
  logs: Record<string, string[]>;
}

export interface BuildDiagnosticsInput {
  layout: InstallLayout;
  installed: InstalledState;
  telemetryLevel: TelemetryLevel;
  health: HealthReport | null;
  hardware: DiagnosticBundle['hardware'];
  updateTrace?: string[];
  startupFailures?: string[];
  latency?: Record<string, number> | null;
  runningVersions?: Record<string, string>;
  lastUpdate?: DiagnosticBundle['lastUpdate'];
  /** Категори бүрээс хэдэн мөр — өгөгдмөл 200. */
  logTail?: number;
  /** Нэмэлт лог файлууд (хуучин `runtime.log`, `supervisor.log`, `install.log`). */
  extraLogFiles?: string[];
  readFileImpl?: (p: string) => string;
  now?: () => string;
}

export function buildDiagnosticBundle(input: BuildDiagnosticsInput): { ok: true; bundle: DiagnosticBundle } | { ok: false; violations: string[] } {
  const read = input.readFileImpl ?? ((p: string) => readFileSync(p, 'utf8'));
  const tail = input.logTail ?? 200;

  const logs: Record<string, string[]> = {};
  for (const cat of LOG_CATEGORIES) {
    const lines = tailLines(join(input.layout.logs, `${cat}.log`), tail, read);
    if (lines.length > 0) logs[cat] = lines;
  }
  for (const f of input.extraLogFiles ?? []) {
    const lines = tailLines(f, tail, read);
    if (lines.length > 0) logs[f.replace(/\\/g, '/').split('/').pop() ?? f] = lines;
  }

  const versions: DiagnosticBundle['versions'] = {};
  for (const [k, v] of Object.entries(input.installed.components)) {
    if (!v) continue;
    versions[k] = { version: v.version, sha256: v.sha256, releaseId: v.releaseId };
  }

  const bundle: DiagnosticBundle = {
    schema: 'mgl-ai-diagnostics/1',
    generatedAt: input.now?.() ?? new Date().toISOString(),
    installationId: input.installed.installationId,
    channel: input.installed.channel,
    telemetryLevel: input.telemetryLevel,
    releases: {
      current: input.installed.currentRelease,
      previous: input.installed.previousRelease,
      lastKnownGood: input.installed.lastKnownGoodRelease,
    },
    versions,
    runningVersions: input.runningVersions ?? {},
    lastUpdate: input.lastUpdate ?? null,
    hardware: input.hardware,
    health: input.health ? healthSummary(input.health) : null,
    healthChecks: (input.health?.checks ?? []).map((c) => ({ id: c.id, ok: c.ok, code: c.code, ms: c.ms, skipped: c.skipped === true })),
    updateTrace: (input.updateTrace ?? []).slice(-100).map(redactText),
    startupFailures: (input.startupFailures ?? []).slice(-50).map(redactText),
    latency: input.latency ?? null,
    logs,
  };

  // ⚠️ ӨӨРИЙГӨӨ ШАЛГАНА — нууц олдвол багц гарахгүй.
  const violations = findSensitiveKeys(bundle).filter((v) => !v.startsWith('logs.'));
  // Логийн мөр дотор JWT үлдсэн бол (redact алдсан) мөн зогсоно.
  for (const [cat, lines] of Object.entries(bundle.logs)) {
    lines.forEach((l, i) => {
      if (findSensitiveKeys(l).length > 0) violations.push(`logs.${cat}[${i}]`);
    });
  }
  if (violations.length > 0) return { ok: false, violations };
  return { ok: true, bundle };
}
