/**
 * MGL AI · ТЕЛЕМЕТРИЙН НУУЦЛАЛЫН ЗАГВАР (Session B §16, §17, §18, §35).
 *
 *   OFF       юу ч явахгүй (флотын мөр ХҮРТЭЛ)
 *   MINIMAL   хувилбарууд · health · уналт · шинэчлэлтийн төлөв · хоцролтын хураангуй
 *   QUALITY   + intent · сонгосон хэрэгсэл · validator дүн · санал хүсэлтийн ангилал ·
 *               retrieval/calculation-ийн ТАНИХ ТЭМДЭГ (агуулга биш)
 *   DEBUG     + ариутгасан гүйцэтгэлийн мөр (админ түр асаана)
 *
 * ⚠️ ЯРИАНЫ АГУУЛГА ЯМАР Ч ТҮВШИНД АВТОМАТААР ЯВАХГҮЙ.  Асуулт, хариулт,
 *    prompt, санамж — `FORBIDDEN_KEYS`-д.  Тэдгээр нь зөвхөн ажилтан 👎
 *    дарж, санал хүсэлтийн зам (`feedback`) руу ӨӨРӨӨ илгээсэн үед,
 *    тэр ч гэсэн Cloudflare руу — энэ модулиар БИШ.
 *
 * ⚠️ ЦАГААН ЖАГСААЛТ, ХАР ЖАГСААЛТ БИШ.  Түвшин бүрд ЗӨВШӨӨРСӨН
 *    түлхүүрүүд л явна; мэдэгдэхгүй түлхүүр ХАСАГДАНА.  Дээр нь
 *    `FORBIDDEN_KEYS` нь ХОЁР ДАХЬ давхарга — цагаан жагсаалтад санамсаргүй
 *    нэмсэн ч нууц түлхүүр `assertNoSensitive`-д баригдана (тест).
 */
import { redactSecrets, redactText as canonRedact } from '@mgl/mglai-common/redaction';

export const TELEMETRY_LEVELS = ['OFF', 'MINIMAL', 'QUALITY', 'DEBUG'] as const;
export type TelemetryLevel = (typeof TELEMETRY_LEVELS)[number];

export function isTelemetryLevel(v: unknown): v is TelemetryLevel {
  return typeof v === 'string' && (TELEMETRY_LEVELS as readonly string[]).includes(v);
}

const LEVEL_RANK: Record<TelemetryLevel, number> = { OFF: 0, MINIMAL: 1, QUALITY: 2, DEBUG: 3 };

export function levelAtLeast(have: TelemetryLevel, need: TelemetryLevel): boolean {
  return LEVEL_RANK[have] >= LEVEL_RANK[need];
}

/**
 * ⚠️ ЭНЭ ЖАГСААЛТ НЬ ТЕСТЭЭР ХАМГААЛАГДСАН.  Түлхүүрийн нэрэнд эдгээр
 *    дэд мөр байвал ямар ч түвшинд ЯВАХГҮЙ (case-insensitive).
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

export function isForbiddenKey(key: string): boolean {
  const k = key.toLowerCase();
  return FORBIDDEN_KEY_PARTS.some((p) => k.includes(p));
}

/** Түвшин бүрд зөвшөөрсөн ДЭЭД ТҮВШНИЙ түлхүүрүүд. */
const ALLOWED: Record<Exclude<TelemetryLevel, 'OFF'>, readonly string[]> = {
  MINIMAL: [
    'installation_id',
    'channel',
    'versions',
    'running_versions',
    'hardware',
    'health',
    'update',
    'crash',
    'latency',
    'runtime_uptime_s',
    'measured_at',
  ],
  QUALITY: [
    'intent',
    'tool_route',
    'validator',
    'feedback_category',
    'retrieval_ids',
    'calculation_ids',
    'request_id',
    'stop_reason',
    'usage',
  ],
  DEBUG: ['trace'],
};

export function allowedKeysFor(level: TelemetryLevel): Set<string> {
  const out = new Set<string>();
  if (level === 'OFF') return out;
  for (const l of ['MINIMAL', 'QUALITY', 'DEBUG'] as const) {
    if (!levelAtLeast(level, l)) break;
    for (const k of ALLOWED[l]) out.add(k);
  }
  return out;
}

/**
 * ⚠️ РЕДАКЦЫН АЛГОРИТМ ЭНД БАЙХГҮЙ (GAP-027, Session D-ийн канон).  Утгын маск нь
 *    `packages/mglai-common/src/redaction.ts` — backend, ai/deployment, хөтөч гурвуулаа
 *    ЯГ ИЖИЛ функц.  Энэ файл зөвхөн БОДЛОГО барина: түвшин, цагаан жагсаалт,
 *    `FORBIDDEN_KEY_PARTS`.  `redactText` нь канон функцийн re-export — `===` тэнцүү
 *    (`ai/integration/test/redaction.crossConsumer.test.ts` барина).
 */
export { redactText } from '@mgl/mglai-common/redaction';

function scrub(value: unknown, depth: number): unknown {
  if (depth > 6) return undefined;
  if (typeof value === 'string') return canonRedact(value).slice(0, 512);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 64).map((v) => scrub(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isForbiddenKey(k)) continue;
      const s = scrub(v, depth + 1);
      if (s !== undefined) out[k] = s;
    }
    return out;
  }
  return undefined;
}

/**
 * Түүхий объектыг тухайн түвшинд зөвшөөрөгдсөн телеметрийн үйл явдал
 * болгоно.  `null` = юу ч явахгүй (OFF).
 */
export function buildTelemetryEvent(level: TelemetryLevel, raw: Record<string, unknown>): Record<string, unknown> | null {
  if (level === 'OFF') return null;
  const allowed = allowedKeysFor(level);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!allowed.has(k) || isForbiddenKey(k)) continue;
    const s = scrub(v, 0);
    if (s !== undefined) out[k] = s;
  }
  out.telemetry_level = level;
  return out;
}

/** Тест ба сервер талын хамгаалалт: нууц түлхүүр ХААНА Ч байхгүйг батална. */
export function findSensitiveKeys(value: unknown, path = ''): string[] {
  const hits: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => hits.push(...findSensitiveKeys(v, `${path}[${i}]`)));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const p = path ? `${path}.${k}` : k;
      if (isForbiddenKey(k)) hits.push(p);
      hits.push(...findSensitiveKeys(v, p));
    }
  } else if (typeof value === 'string') {
    // Аль хэдийн redact-лагдсан тэмдэг нь «нууц» биш — `token=[REDACTED]`-ийг дахин барихгүй.
    // Канон маск ямар нэг дүрэм тавьсан бол утга нууц/PII агуулж байна (email, утас ч орно).
    // ⚠️ Бүтэн sha256 (64 hex) нь манифест/диагностикийн ЗААВАЛ утга, нууц биш — канон
    //    `phone` дүрэм hex дотор 8 орон олоод (`f84894884e…`) худал эерэг өгдөг (D-д мэдэгдсэн,
    //    2026-09-14); канон засагдтал энэ B-ийн бодлогын үл хамаарах зүйл.
    const bare = value.replace(/\[REDACTED[A-Z_]*\]/g, '');
    if (/^[0-9a-f]{64}$/i.test(bare)) return hits;
    if (Object.keys(redactSecrets(bare).counts).length > 0) hits.push(`${path}=<secret-like value>`);
  }
  return hits;
}

export function assertNoSensitive(value: unknown): void {
  const hits = findSensitiveKeys(value);
  if (hits.length > 0) throw new Error(`Телеметрид нууц талбар: ${hits.join(', ')}`);
}
