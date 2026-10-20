/**
 * MGL AI · АЖИЛЛАХ ҮЕИЙН ТОХИРГОО.
 *
 * ⚠️ ӨГӨГДМӨЛ УТГА НЬ ЭНД, миграц 0275 нь ТЭДГЭЭРИЙН ТУСГАЛ.  Хоёулаа
 *    таарах ёстой — 0195-ийн `assistant.min_confidence` дээр сурсан
 *    сургамж: зөрсөн утга нь дараа уншсан хүнийг төөрөгдүүлнэ.
 *
 * ⚠️ `lib/settings.ts`-ийн `getAttendanceSettings` заншлыг ЯГ дагав:
 *    НЭГ query, буруу/байхгүй утга дээр өгөгдмөл рүү унана, хүсэлт бүрд
 *    дуудахад хангалттай хямд.
 */

export interface MglAiSettings {
  /** Ганц том унтраалга.  0 үед бүх MGL AI маршрут 503. */
  enabled: boolean;
  /** Захиалагчийн горим.  Өгөгдмөл УНТРААЛТТАЙ (§49 бэлэн болтол). */
  clientMode: boolean;
  modelFamily: string;
  productVersion: string;
  maxToolIterations: number;
  contextTokens: number;
  /** Ярианы түүхийг хэдэн хоног барих (§19). */
  retentionDays: number;
  /** Загварт өгөх нотолгооны дээд тоо (§17). */
  evidenceTopK: number;
}

export const MGLAI_SETTING_KEYS = [
  'mglai.enabled',
  'mglai.client_mode',
  'mglai.model_family',
  'mglai.product_version',
  'mglai.max_tool_iterations',
  'mglai.context_tokens',
  'mglai.retention_days',
  'mglai.evidence_top_k',
] as const;

/** ⚠️ 0275-ийн INSERT-үүдтэй БАЙТ БАЙТААР таарна. */
export const MGLAI_DEFAULTS: MglAiSettings = Object.freeze({
  enabled: true,
  clientMode: false,
  modelFamily: 'mgl-ai',
  productVersion: '1.0.0',
  maxToolIterations: 8,
  contextTokens: 4096,
  retentionDays: 90,
  evidenceTopK: 6,
});

function intIn(raw: unknown, lo: number, hi: number, fallback: number): number {
  if (typeof raw !== 'string') return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : fallback;
}

function str(raw: unknown, fallback: string): string {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : fallback;
}

/**
 * ⚠️ ЦЭВЭР ХЭСЭГ — тестлэгдэнэ.  SQL-ээс тусгаарласан нь зориуд:
 *    буруу утга дээрх зан төлөв нь D1-гүйгээр батлагдана.
 */
export function settingsFromMap(map: Map<string, string>): MglAiSettings {
  return {
    // ⚠️ Зөвхөн тодорхой '0' үед унтарна — байхгүй түлхүүр нь АСААЛТТАЙ
    //    (`requireOfficeIp`-ийн заншил).
    enabled: map.get('mglai.enabled') !== '0',
    // ⚠️ Эсрэгээр: зөвхөн тодорхой '1' үед асна.  Захиалагчид хариулт
    //    өгөх нь ЗӨВШӨӨРӨЛ шаардана, өгөгдмөл биш.
    clientMode: map.get('mglai.client_mode') === '1',
    modelFamily: str(map.get('mglai.model_family'), MGLAI_DEFAULTS.modelFamily),
    productVersion: str(map.get('mglai.product_version'), MGLAI_DEFAULTS.productVersion),
    maxToolIterations: intIn(map.get('mglai.max_tool_iterations'), 1, 32, MGLAI_DEFAULTS.maxToolIterations),
    contextTokens: intIn(map.get('mglai.context_tokens'), 1024, 32768, MGLAI_DEFAULTS.contextTokens),
    retentionDays: intIn(map.get('mglai.retention_days'), 1, 3650, MGLAI_DEFAULTS.retentionDays),
    evidenceTopK: intIn(map.get('mglai.evidence_top_k'), 1, 32, MGLAI_DEFAULTS.evidenceTopK),
  };
}

export async function getMglAiSettings(db: D1Database): Promise<MglAiSettings> {
  const placeholders = MGLAI_SETTING_KEYS.map(() => '?').join(',');
  const { results } = await db
    .prepare(`SELECT key, value FROM app_settings WHERE key IN (${placeholders})`)
    .bind(...MGLAI_SETTING_KEYS)
    .all<{ key: string; value: string }>();

  const map = new Map<string, string>();
  for (const r of results ?? []) map.set(r.key, r.value);
  return settingsFromMap(map);
}
