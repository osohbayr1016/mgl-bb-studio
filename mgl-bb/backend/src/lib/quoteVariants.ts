/**
 * Үнийн саналын ТӨРӨЛ (variant) — каталог ба сериализаци.
 *
 * Нэг санал ОЛОН төрөл хамарч болно (MGL-д «эскиз + ажлын зураг» хамт явах нь
 * түгээмэл), тиймээс `quotes.variant_key` нь ганц түлхүүр биш, каталогийн
 * дарааллаар эрэмбэлэгдсэн ТАСЛАЛААР ТУСГААРЛАСАН жагсаалт хадгална:
 * `'design,sketch'`. Багана нь TEXT бөгөөд CHECK-гүй (migration 0128) тул
 * схем өөрчлөх ШААРДЛАГАГҮЙ, хуучин ганц түлхүүртэй мөрүүд хүчинтэй хэвээр.
 *
 * ⚠️ ИХЭР ФАЙЛ: `frontend/src/features/quotes/lib/quoteVariants.ts`. Хоёуланг
 * нь ЗЭРЭГ засна — тип ч, тест ч хамгаалахгүй.
 *
 * ⚠️ Энэ нь template-ийн `variants_json`-ТОЙ ӨӨР ДАВХАРГА. Тэр нь ХУУДСЫГ
 * өөрчилдөг (`hiddenRows`, `titleTemplate`); энэ нь зөвхөн АНГИЛАЛ — жагсаалт,
 * PDF, MCP дээр «энэ санал юуг хамарч байна» гэдгийг харуулна. Түлхүүр нь
 * template-ийн хувилбартай давхацвал `POST /api/quotes` тэр механизмыг хэвээр
 * хүндэтгэнэ (доор `hiddenRows`-ийн огтлолцлыг үз).
 */

/**
 * Каталог. Дараалал нь СЕРИАЛИЗАЦИЙН эрэмбэ — `'sketch,design'` ба
 * `'design,sketch'` нэг л утга болж хадгалагдана.
 */
export const QUOTE_VARIANT_KEYS = ['design', 'sketch', 'interior', 'supervision'] as const;

export type QuoteVariantKey = (typeof QUOTE_VARIANT_KEYS)[number];

const ORDER: ReadonlyMap<string, number> = new Map(QUOTE_VARIANT_KEYS.map((k, i) => [k, i]));

/**
 * Монгол нэрс — MCP/лог зэрэг СЕРВЕР талын текстэд. (Frontend нь i18n-ээс
 * `quotes.variant.<key>`-ээр авдаг тул энэ хүснэгтийг хуулбарлахгүй.)
 *
 * `control` нь каталогт БАЙХГҮЙ — 2026-08-17-оос сонголтоос хасагдсан («Хяналтын
 * төсөв» бол ЗАГВАРЫН нэр, ажлын төрөл биш). Гэхдээ түүгээр хадгалагдсан хуучин
 * баримтууд нэрээ алдах ёсгүй тул нэр нь энд үлдэнэ.
 */
export const QUOTE_VARIANT_LABEL_MN: Readonly<Record<string, string>> = {
  design: 'Ажлын зураг',
  sketch: 'Эскиз зураг',
  interior: 'Интерьер зураг',
  supervision: 'Зохиогчийн хяналт',
  control: 'Хяналтын төсөв',
};

export function isQuoteVariantKey(v: unknown): v is QuoteVariantKey {
  return typeof v === 'string' && (QUOTE_VARIANT_KEYS as readonly string[]).includes(v);
}

/**
 * ХАДГАЛАГДСАН утгыг задлана. Танихгүй (хуучин) түлхүүрийг ХАДГАЛНА — уншихад
 * баримт өөрийн түүхэн ангилалаа алдах ёсгүй.
 */
export function parseVariantKeys(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const k = part.trim();
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/**
 * КЛИЕНТЭЭС ирсэн утгыг каталогт цэвэрлэнэ (`string` эсвэл `string[]` хоёуланг
 * авна). Танихгүй түлхүүрийг ХАЯНА — шинэ баримт зөвхөн каталогийн төрөлтэй
 * байна. Юу ч үлдэхгүй бол хоосон массив буцаана; анхдагчийг дуудагч шийднэ.
 */
export function normalizeVariantKeys(input: unknown): QuoteVariantKey[] {
  const raw: unknown[] = Array.isArray(input) ? input : parseVariantKeys(input);
  const out: QuoteVariantKey[] = [];
  for (const v of raw) {
    const k = typeof v === 'string' ? v.trim() : '';
    if (isQuoteVariantKey(k) && !out.includes(k)) out.push(k);
  }
  return out.sort((a, b) => (ORDER.get(a) ?? 0) - (ORDER.get(b) ?? 0));
}

export function serializeVariantKeys(keys: readonly string[]): string {
  return keys.join(',');
}

/** MCP/лог-д зориулсан хүнд уншигдах нэр: `'design,sketch'` → «Ажлын зураг, Эскиз зураг». */
export function variantLabelsMn(raw: unknown): string {
  const keys = parseVariantKeys(raw);
  if (keys.length === 0) return '—';
  return keys.map((k) => QUOTE_VARIANT_LABEL_MN[k] ?? k).join(', ');
}
