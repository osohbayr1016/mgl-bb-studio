/**
 * MGL AI · НУУЦЫН РЕДАКЦ — КАНОН ХЭРЭГЖҮҮЛЭЛТ (GAP-027, эзний шийдвэр 2026-09-11).
 *
 * ⚠️ ЭНЭ ФАЙЛ БОЛ ЦОРЫН ГАНЦ АЛГОРИТМ.  Гурван хэрэглэгч:
 *      backend   `backend/src/lib/mglai/redaction.ts`   → `export * from '@mgl/mglai-common/redaction'`
 *                (telemetry/heartbeat хүлээн авалт, feedback snapshot, failure export)
 *      ai/deploy `ai/deployment/src/telemetry.ts redactText` → энэ файлын `redactText`
 *                (диагностикийн багц, лог экспорт, heartbeat payload — Session B холбоно)
 *      хөтөч    (хэрэгтэй бол) — DOM хамааралгүй тул шууд.
 *    Backend-д ч, ai/deployment-д ч ХУУЛБАР БАЙХГҮЙ.  Ямар ТҮЛХҮҮР явах/явахгүй (telemetry
 *    түвшин, `FORBIDDEN_KEY_PARTS`) нь БОДЛОГО — сервер/админ ба B-ийн эзэмшил, энд ОРОХГҮЙ;
 *    энд зөвхөн УТГЫН маск.
 *
 * Гарал: Session C-ийн `backend/src/lib/mglai/redaction.ts` (2026-09-11) — дүрэм, тест ХЭВЭЭР;
 *    Session B-ийн `ai/deployment/src/telemetry.ts SECRET_VALUE_RES`-ийн хоёр хэв маягийг
 *    НЭГТГЭВ (`secret_kv` доод урт 8 → 6, B-ийн `{6,}`-ийг багтаахын тулд; `x-mglai-secret`
 *    аль хэдийн багтсан).  Хоёр эзний тест энэ файлын эсрэг ажиллана.
 *
 * ⚠️ ЦЭВЭР ФУНКЦ, ДЕТЕРМИНИСТ, ХАМААРАЛГҮЙ.  `lib: ES2023`, `types: []` — Node/Worker/DOM
 *    API импортлоход tsc унана.
 *
 * ⚠️ ХЭТ ХАМГААЛАЛТГҮЙ.  Нормын код (БД 21-101-12), огноо, хувь, төслийн код (MGL-251006),
 *    sha256 (64 hex — манифестад хэрэгтэй) маскалагдахгүй — оношилгоонд хэрэгтэй, нууц биш.
 */

export const REDACTION_VERSION = 'mglai-redaction/1' as const;
/** Багцын дотоод засварын тоолуур — алгоритмын ГАРАЛТ өөрчлөгдсөн бүрд өснө (хэрэглэгчид тэнцүү байдлын тестээр барина). */
export const REDACTION_REVISION = 2;

export interface RedactionResult {
  text: string;
  /** Ямар төрлийн маск хэдэн удаа тавьсан — оношилгооны тоолуур. */
  counts: Record<string, number>;
}

/** Дараалал ЧУХАЛ: урт/тодорхой хэв маяг эхэнд, ерөнхий нь сүүлд. */
const RULES: readonly [name: string, re: RegExp, mask: string][] = [
  // Bearer / Authorization толгой
  ['bearer', /\b(bearer|authorization:?)\s+[A-Za-z0-9._~+/=-]{16,}/giu, '$1 [REDACTED]'],
  // JWT (гурван хэсэг) — B-ийн `{10,}`-ийг багтаасан `{8,}`
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_JWT]'],
  // OpenAI/Anthropic/AWS/GitHub/Slack хэлбэрийн түлхүүр
  ['api_key', /\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g, '[REDACTED_KEY]'],
  // Тестийн sentinel нууцууд (§40)
  ['sentinel', /\b(?:SECRET_TEST_TOKEN|FAKE_PASSWORD|MGLAI_TEST_SECRET)[A-Za-z0-9_-]*\b/g, '[REDACTED_SENTINEL]'],
  // password=… / нууц үг: …
  // ⚠️ ASCII `\b` кирилл үсгийн хажууд ҮҮСДЭГГҮЙ (CLAUDE.md-ийн урхи) — `(?<!\p{L})`.
  ['password', /(?<!\p{L})(password|passwd|pwd|нууц үг|нууц)\s*[:=]\s*\S{3,}/giu, '$1: [REDACTED]'],
  // secret / token / api_key = … (JSON эсвэл env хэлбэр) — B-ийн `{6,}`-той нийцүүлэн 6
  ['secret_kv', /\b((?:x-)?(?:mglai[_-]?)?(?:secret|token|api[_-]?key|private[_-]?key)["']?\s*[:=]\s*["']?)[A-Za-z0-9._~+/=-]{6,}/giu, '$1[REDACTED]'],
  // Урт hex (SHA/ID биш нууц — ≥40) — ⚠️ sha256 (64) нь манифестад хэрэгтэй тул 40–63-ыг л
  ['hex_token', /\b[a-f0-9]{40,63}\b/g, '[REDACTED_HEX]'],
  // Имэйл
  ['email', /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, '[REDACTED_EMAIL]'],
  // Монгол утасны дугаар (8 орон, 7/8/9-өөр эхэлсэн, +976 угтвартай ч)
  // ⚠️ B-ийн олсон алдаа (2026-09-14): `(?<!\d)` нь ҮСГИЙН дараах 8 оронтой цувааг ч барьдаг тул
  //    SHA-256 (64 hex) доторх «…f84894884e…» → [REDACTED_PHONE] болж артефактын хэш/хувилбарын
  //    хурууны хээ ЭВДЭРДЭГ байв.  Хил нь одоо ASCII үсэг-тоо (hex/base64/JWT-ийн бие) БИШ —
  //    кирилл үсэг, цэг таслал, хашилт, зай нь хил хэвээр («Утас:99112233», `"phone":"99112233"`).
  ['phone', /(?<![0-9A-Za-z])(?:\+976[\s-]?)?[789]\d{3}[\s-]?\d{4}(?![0-9A-Za-z])/g, '[REDACTED_PHONE]'],
  // -----BEGIN PRIVATE KEY----- блок
  ['pem', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PEM]'],
];

export function redactSecrets(input: string | null | undefined): RedactionResult {
  const counts: Record<string, number> = {};
  let text = input ?? '';
  for (const [name, re, mask] of RULES) {
    let n = 0;
    text = text.replace(re, (...m: unknown[]) => {
      n += 1;
      // $1 орлуулалт
      return mask.replace('$1', typeof m[1] === 'string' ? m[1] : '');
    });
    if (n > 0) counts[name] = n;
  }
  return { text, counts };
}

/** Богино: зөвхөн текст. */
export function redact(input: string | null | undefined): string {
  return redactSecrets(input).text;
}

/**
 * Session B-ийн `ai/deployment/src/telemetry.ts`-ийн нэр — ДРОП-ИН орлуулалт.
 * `redactText(s) === redact(s)`; B-ийн `SECRET_VALUE_RES` жагсаалт устаж энэ рүү заана.
 */
export function redactText(s: string): string {
  return redact(s);
}

/**
 * Обьектыг (лог/telemetry payload) гүн маскална — мөрийн утга бүр, түлхүүр нь
 * нууц мэт (`password`, `token`, `secret`, `authorization`) бол утгыг бүхэлд нь.
 *
 * ⚠️ Энэ нь УТГЫН маск.  Ямар түлхүүрийг ОГТ явуулахгүй вэ (B `FORBIDDEN_KEY_PARTS`,
 *    telemetry түвшин) гэдэг БОДЛОГЫГ дуудагч ӨМНӨ нь хэрэглэнэ.
 */
const SECRET_KEY = /^(?:.*(?:password|passwd|secret|token|api[_-]?key|private[_-]?key|authorization|cookie|set-cookie).*)$/i;

export function redactObject<T>(value: T, depth = 0): T {
  if (depth > 12) return value;
  if (typeof value === 'string') return redact(value) as T;
  if (Array.isArray(value)) return value.map((v) => redactObject(v, depth + 1)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) && typeof v === 'string' && v.length > 0 ? '[REDACTED]' : redactObject(v, depth + 1);
    }
    return out as T;
  }
  return value;
}

/** Sentinel гоожилтын шалгалт — тестийн туслах: маскалсан текстэд sentinel ҮЛДСЭН эсэх. */
export function containsSentinel(text: string): boolean {
  return /SECRET_TEST_TOKEN|FAKE_PASSWORD|MGLAI_TEST_SECRET/.test(text);
}

/**
 * ХӨНДЛӨН ХЭРЭГЛЭГЧИЙН ТЭНЦҮҮ БАЙДЛЫН SENTINEL БАГЦ — backend ба ai/deployment хоёулаа
 * ЭДГЭЭР оролтод ЯГ ИЖИЛ гаралт өгөх ёстой (`ai/integration/test/redaction.crossConsumer.test.ts`).
 * Бодит нууц ЭНД ХЭЗЭЭ Ч ОРОХГҮЙ.
 */
export const CROSS_CONSUMER_SENTINELS: readonly string[] = [
  'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjEyMzQ1Njc4OTB9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
  'x-mglai-secret=SENTINEL-INSTALL-SECRET-0123456789abcdef0123456789',
  'token=abc123DEF456 secret: q1w2e3r4 api_key="zxcvbnm123" password=hunter22 нууц үг: Mongol2026!',
  'SECRET_TEST_TOKEN_ABC FAKE_PASSWORD_1 MGLAI_TEST_SECRET_9',
  'bat@mglenc.com 99112233 +976 8811-2233 sk-ant-abcdefghijklmnopqrstuvwxyz1234 AKIAIOSFODNN7EXAMPLE',
  '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----',
  // ХЭВЭЭР үлдэх ёстой (хэт хамгаалалтгүй)
  'БД 21-101-12 хүснэгт 4, БНбД 11-03-21, 2026-09-11, 62.4%, MGL-251006 EVERGREEN, заалт 4.2.1, sha256 ' + 'a'.repeat(64) + ', 1 800 МДж/м²',
];
