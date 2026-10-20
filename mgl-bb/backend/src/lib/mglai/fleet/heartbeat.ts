/**
 * MGL AI · ФЛОТЫН HEARTBEAT — СЕРВЕР ТАЛ (Session B §16, §17).
 *
 * `POST /api/mgl-ai/fleet/heartbeat`-ийн ачааллыг ЦАГААН ЖАГСААЛТААР уншина.
 *
 * ⚠️ КЛИЕНТИЙН ШҮҮЛТЭД ИТГЭХГҮЙ.  `ai/deployment/src/telemetry.ts` нь
 *    ажилтны PC дээр ижил цагаан жагсаалт хэрэглэдэг, гэвч тэр код нь
 *    ажилтны машин дээр — хуучин хувилбар, гараар засагдсан, эсвэл өөр
 *    клиент байж болно.  Сервер ДАХИН шүүнэ: мэдэгдэхгүй түлхүүр ХАСАГДАНА,
 *    хориотой түлхүүр (`FORBIDDEN_KEY_PARTS`) байвал бүх ачаалал 400.
 *
 * ⚠️ ХОС ТОГТМОЛ: `FORBIDDEN_KEY_PARTS` нь `ai/deployment/src/telemetry.ts`-ийн
 *    ХУУЛБАР.  Backend нь `ai/`-г импортолж чадахгүй (тусдаа tsconfig, тусдаа
 *    түгээлт).  Хоёрыг ХАМТ өөрчил — `heartbeat.test.ts` нь энэ жагсаалтад
 *    доод тал нь 20 үг байгааг барина, гэхдээ хос зөрүүг барьж чадахгүй.
 *
 * ⚠️ ХОСТЫН НЭР, ХЭРЭГЛЭГЧИЙН НЭР, IP — ХҮЛЭЭН АВАХГҮЙ (§16).  Хэрэглэгч нь
 *    JWT-ээс; хардвер нь зөвхөн нийцтэй байдлын талбарууд.
 */

export const FORBIDDEN_KEY_PARTS = [
  'password',
  'passwd',
  'secret',
  'token',
  'authorization',
  'cookie',
  'credential',
  'apikey',
  'api_key',
  'private_key',
  'privatekey',
  'jwt',
  'prompt',
  'answer',
  'question',
  'content',
  'message',
  'memory',
  'clipboard',
  'keystroke',
  'screenshot',
  'history',
  'email',
  'hostname',
  'username',
  'user_name',
  'ip_address',
  'mac',
] as const;

export const FLEET_CHANNELS = ['admin', 'canary', 'stable'] as const;
export type FleetChannel = (typeof FLEET_CHANNELS)[number];
export function isFleetChannel(v: unknown): v is FleetChannel {
  return typeof v === 'string' && (FLEET_CHANNELS as readonly string[]).includes(v);
}

export const TELEMETRY_LEVELS = ['OFF', 'MINIMAL', 'QUALITY', 'DEBUG'] as const;
export type TelemetryLevel = (typeof TELEMETRY_LEVELS)[number];
export function isTelemetryLevel(v: unknown): v is TelemetryLevel {
  return typeof v === 'string' && (TELEMETRY_LEVELS as readonly string[]).includes(v);
}

export const HEALTH_STATUSES = ['READY', 'DEGRADED', 'REPAIR_REQUIRED', 'UPDATING', 'UNKNOWN'] as const;
export type FleetHealthStatus = (typeof HEALTH_STATUSES)[number];

export const HARDWARE_CLASSES = ['HIGH_GPU', 'STANDARD_8GB_GPU', 'LOW_GPU', 'CPU_FALLBACK', 'UNSUPPORTED'] as const;

const COMPONENT_KEYS = ['app', 'runtime', 'model', 'knowledge', 'normRegistry', 'revit', 'release', 'last_known_good'] as const;
const HARDWARE_KEYS = ['os', 'arch', 'cpu', 'cpuPhysicalCores', 'ramMb', 'gpu', 'vramMb', 'cuda', 'isLaptop', 'hardwareClass'] as const;
const FACET_KEYS = ['LOCAL_AI', 'KNOWLEDGE', 'NORM', 'COMPANY_BACKEND', 'REVIT'] as const;

const INSTALL_ID_RE = /^ins_[0-9a-f-]{8,64}$/i;

export interface FleetHeartbeat {
  installation_id: string;
  channel: FleetChannel;
  telemetry_level: TelemetryLevel;
  versions: Partial<Record<(typeof COMPONENT_KEYS)[number], string | null>>;
  /** P0-6: процессын бодит хувилбар (runtime/knowledge/model) — заагчаас зөрвөл харагдана. */
  running_versions: Partial<Record<(typeof COMPONENT_KEYS)[number], string>>;
  hardware: Record<string, string | number | boolean | null>;
  hardware_class: string | null;
  health: { status: FleetHealthStatus; facets: Record<string, string>; reasonCodes: string[] } | null;
  update: { phase: string; what: string | null; percent: number | null; failed: boolean; last: { code: string; ok: boolean; release: string | null } | null } | null;
  latency: Record<string, number> | null;
  crash: { at: string; code: string } | null;
  runtime_uptime_s: number | null;
}

export type ParseResult = { ok: true; heartbeat: FleetHeartbeat } | { ok: false; code: string; detail?: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Аль ч гүнд хориотой түлхүүр байгаа эсэх. */
export function findForbiddenKeys(value: unknown, path = ''): string[] {
  const hits: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => hits.push(...findForbiddenKeys(v, `${path}[${i}]`)));
  } else if (isRecord(value)) {
    for (const [k, v] of Object.entries(value)) {
      const p = path ? `${path}.${k}` : k;
      const lk = k.toLowerCase();
      if (FORBIDDEN_KEY_PARTS.some((f) => lk.includes(f))) hits.push(p);
      hits.push(...findForbiddenKeys(v, p));
    }
  }
  return hits;
}

const s = (v: unknown, max = 64): string | null => (typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, max) : null);
const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);

export function parseHeartbeat(raw: unknown): ParseResult {
  if (!isRecord(raw)) return { ok: false, code: 'NOT_OBJECT' };

  const forbidden = findForbiddenKeys(raw);
  if (forbidden.length > 0) return { ok: false, code: 'FORBIDDEN_FIELD', detail: forbidden.slice(0, 5).join(', ') };

  const installationId = s(raw.installation_id, 64);
  if (!installationId || !INSTALL_ID_RE.test(installationId)) return { ok: false, code: 'INSTALLATION_ID_INVALID' };

  const channel = isFleetChannel(raw.channel) ? raw.channel : 'stable';
  const level = isTelemetryLevel(raw.telemetry_level) ? raw.telemetry_level : 'MINIMAL';
  if (level === 'OFF') return { ok: false, code: 'TELEMETRY_OFF' };

  const versions: FleetHeartbeat['versions'] = {};
  if (isRecord(raw.versions)) {
    for (const k of COMPONENT_KEYS) {
      const v = raw.versions[k];
      if (v === null) versions[k] = null;
      else if (typeof v === 'string') versions[k] = v.slice(0, 64);
    }
  }

  const runningVersions: FleetHeartbeat['running_versions'] = {};
  if (isRecord(raw.running_versions)) {
    for (const k of COMPONENT_KEYS) {
      const v = raw.running_versions[k];
      if (typeof v === 'string') runningVersions[k] = v.slice(0, 64);
    }
  }

  const hardware: FleetHeartbeat['hardware'] = {};
  let hardwareClass: string | null = null;
  if (isRecord(raw.hardware)) {
    for (const k of HARDWARE_KEYS) {
      const v = raw.hardware[k];
      if (typeof v === 'string') hardware[k] = v.slice(0, 128);
      else if (typeof v === 'number' && Number.isFinite(v)) hardware[k] = v;
      else if (typeof v === 'boolean' || v === null) hardware[k] = v;
    }
    const hc = raw.hardware.hardwareClass;
    hardwareClass = typeof hc === 'string' && (HARDWARE_CLASSES as readonly string[]).includes(hc) ? hc : null;
  }

  let health: FleetHeartbeat['health'] = null;
  if (isRecord(raw.health)) {
    const st = raw.health.status;
    const status = typeof st === 'string' && (HEALTH_STATUSES as readonly string[]).includes(st) ? (st as FleetHealthStatus) : 'UNKNOWN';
    const facets: Record<string, string> = {};
    if (isRecord(raw.health.facets)) {
      for (const f of FACET_KEYS) {
        const v = raw.health.facets[f];
        if (typeof v === 'string') facets[f] = v.slice(0, 24);
      }
    }
    const reasonCodes = Array.isArray(raw.health.reasonCodes)
      ? raw.health.reasonCodes.filter((x): x is string => typeof x === 'string').slice(0, 32).map((x) => x.slice(0, 64))
      : [];
    health = { status, facets, reasonCodes };
  }

  let update: FleetHeartbeat['update'] = null;
  if (isRecord(raw.update)) {
    update = {
      phase: s(raw.update.phase, 24) ?? 'idle',
      what: s(raw.update.what, 24),
      percent: n(raw.update.percent),
      failed: raw.update.failed === true,
      // Сүүлийн шинэчлэлтийн үр дүн (last-update.json) — админ «буцаалт болсон» гэдгийг харна.
      last: isRecord(raw.update.last) && typeof raw.update.last.code === 'string'
        ? { code: raw.update.last.code.slice(0, 48), ok: raw.update.last.ok === true, release: s(raw.update.last.release, 128) }
        : null,
    };
  }

  let latency: FleetHeartbeat['latency'] = null;
  if (isRecord(raw.latency)) {
    latency = {};
    for (const [k, v] of Object.entries(raw.latency).slice(0, 12)) {
      const num = n(v);
      if (num !== null && /^[a-z0-9_]{1,40}$/i.test(k)) latency[k] = num;
    }
  }

  let crash: FleetHeartbeat['crash'] = null;
  if (isRecord(raw.crash)) {
    const at = s(raw.crash.at, 40);
    const code = s(raw.crash.code, 64);
    if (at && code) crash = { at, code };
  }

  return {
    ok: true,
    heartbeat: {
      installation_id: installationId,
      channel,
      telemetry_level: level,
      versions,
      running_versions: runningVersions,
      hardware,
      hardware_class: hardwareClass,
      health,
      update,
      latency,
      crash,
      runtime_uptime_s: n(raw.runtime_uptime_s),
    },
  };
}

/**
 * Төхөөрөмжийн ҮЙЛЧЛЭХ суваг/түвшин: админы override > төхөөрөмжийн өөрийн.
 * Heartbeat-ийн хариугаар клиент рүү буцна; клиент дагана (`agent.ts`).
 */
export function effectiveChannel(row: { channel: string; channel_override: string | null }): FleetChannel {
  if (isFleetChannel(row.channel_override)) return row.channel_override;
  return isFleetChannel(row.channel) ? row.channel : 'stable';
}

export function effectiveTelemetryLevel(row: { telemetry_level: string; telemetry_level_override: string | null }): TelemetryLevel {
  if (isTelemetryLevel(row.telemetry_level_override)) return row.telemetry_level_override;
  return isTelemetryLevel(row.telemetry_level) ? row.telemetry_level : 'MINIMAL';
}

/** Флотын хураангуй — админ хуудасны дээд мөр. */
export function summarizeFleet(rows: { health_status: string | null; last_seen_at: string; versions_json: string }[], nowIso: string): {
  total: number;
  online: number;
  byHealth: Record<string, number>;
  byRuntimeVersion: Record<string, number>;
} {
  const now = Date.parse(nowIso);
  const byHealth: Record<string, number> = {};
  const byRuntimeVersion: Record<string, number> = {};
  let online = 0;
  for (const r of rows) {
    const h = r.health_status ?? 'UNKNOWN';
    byHealth[h] = (byHealth[h] ?? 0) + 1;
    // 45 мин = heartbeat (30 мин) + зай
    if (now - Date.parse(r.last_seen_at.replace(' ', 'T') + (r.last_seen_at.endsWith('Z') ? '' : 'Z')) < 45 * 60_000) online++;
    try {
      const v = (JSON.parse(r.versions_json) as { runtime?: string }).runtime ?? 'unknown';
      byRuntimeVersion[v] = (byRuntimeVersion[v] ?? 0) + 1;
    } catch {
      byRuntimeVersion.unknown = (byRuntimeVersion.unknown ?? 0) + 1;
    }
  }
  return { total: rows.length, online, byHealth, byRuntimeVersion };
}
