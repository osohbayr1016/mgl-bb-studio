/**
 * MGL AI · ФЛОТЫН HEARTBEAT — КЛИЕНТ ТАЛ (Session B §16, §17).
 *
 * `POST /api/mgl-ai/fleet/heartbeat` рүү явах ачааллыг угсарна.
 *
 * ⚠️ ХЭМЖСЭН: backend-ийн хуучин `POST /runtime/heartbeat` (2026-09-08)
 *    нь `ai/`, `frontend/` дотор НЭГ Ч ДУУДАГЧГҮЙ — `ai_runtime_installs`
 *    хэзээ ч бөглөгдөөгүй.  Энэ модуль нь тэр цоорхойг хааж, ШИНЭ
 *    `/fleet/heartbeat` рүү явна (хуучныг хөндөхгүй — хуучин хүснэгт
 *    `hostname` авдаг, шинэ нь авдаггүй).
 *
 * ⚠️ ТЕЛЕМЕТРИЙН ТҮВШИНГ ЭНД ХЭРЭГЛЭНЭ (`buildTelemetryEvent`).  OFF бол
 *    `null` — юу ч явахгүй.  Сервер тал (`fleet/heartbeat.ts`) ИЖИЛ
 *    цагаан жагсаалтаар ДАХИН шүүнэ — хоёр давхарга, нэг дүрэм.
 *
 * ⚠️ ХОСТЫН НЭР, ХЭРЭГЛЭГЧИЙН НЭР, IP ОРОХГҮЙ.  Хэрэглэгч нь ERP JWT-ээс
 *    сервер дээр тодорхойлогдоно; хардвер нь `fleetHardwareSummary`.
 */
import type { HardwareProfile } from '../../runtime/src/hardware.ts';

import { fleetHardwareSummary } from './hardwareClass.ts';
import { healthSummary, type HealthReport } from './health.ts';
import type { InstalledState } from './installedState.ts';
import { buildTelemetryEvent, type TelemetryLevel } from './telemetry.ts';

export interface HeartbeatInput {
  installed: InstalledState;
  hardware: HardwareProfile;
  health: HealthReport | null;
  level: TelemetryLevel;
  update?: { phase: string; what: string | null; percent: number | null; error: string | null; last?: { code: string; ok: boolean; release: string } | null } | null;
  /** P0-6: процессын БОДИТ хувилбарууд (/info.deployment.running) — заагчаас зөрвөл сервер харна. */
  running?: Record<string, string> | null;
  /** ⚠️ Түлхүүрт «token» үг ОРОХГҮЙ — `FORBIDDEN_KEY_PARTS` түүнийг хасна (ttft = time to first token). */
  latency?: { ttft_p50_ms?: number; ttft_p95_ms?: number; tok_per_s?: number; samples?: number } | null;
  runtimeUptimeS?: number;
  crash?: { at: string; code: string } | null;
  now?: () => string;
}

export function buildHeartbeat(input: HeartbeatInput): Record<string, unknown> | null {
  const versions: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.installed.components)) if (v) versions[k] = v.version;

  const raw: Record<string, unknown> = {
    installation_id: input.installed.installationId,
    channel: input.installed.channel,
    versions: {
      ...versions,
      release: input.installed.currentRelease,
      last_known_good: input.installed.lastKnownGoodRelease,
    },
    running_versions: input.running ?? null,
    hardware: fleetHardwareSummary(input.hardware),
    health: input.health ? healthSummary(input.health) : null,
    update: input.update
      ? { phase: input.update.phase, what: input.update.what, percent: input.update.percent, failed: input.update.error !== null, last: input.update.last ?? null }
      : null,
    latency: input.latency ?? null,
    runtime_uptime_s: input.runtimeUptimeS ?? null,
    crash: input.crash ?? null,
    measured_at: input.now?.() ?? new Date().toISOString(),
  };
  return buildTelemetryEvent(input.level, raw);
}

export interface SendHeartbeatDeps {
  controlPlane: string;
  token: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export type HeartbeatResponse = {
  ok: boolean;
  status: number;
  /** Сервер энэ суулгацад ямар суваг оноосон бэ — клиент дагана. */
  channel?: string;
  /** Админ түр DEBUG асаасан бол. */
  telemetry_level?: string;
};

export async function sendHeartbeat(deps: SendHeartbeatDeps, payload: Record<string, unknown>): Promise<HeartbeatResponse> {
  const f = deps.fetchImpl ?? fetch;
  try {
    const res = await f(`${deps.controlPlane}/api/mgl-ai/fleet/heartbeat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${deps.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000),
    });
    if (!res.ok) return { ok: false, status: res.status };
    const body = (await res.json().catch(() => ({}))) as { channel?: string; telemetry_level?: string };
    return { ok: true, status: res.status, ...(body.channel ? { channel: body.channel } : {}), ...(body.telemetry_level ? { telemetry_level: body.telemetry_level } : {}) };
  } catch {
    return { ok: false, status: 0 };
  }
}
