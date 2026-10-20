/**
 * Үнийн саналын ТӨРӨЛ (variant) — каталог ба сериализаци.
 *
 * Нэг санал ОЛОН төрөл хамарч болно (MGL-д «эскиз + ажлын зураг» хамт явах нь
 * түгээмэл), тиймээс `variant_key` нь ганц түлхүүр биш, каталогийн дарааллаар
 * эрэмбэлэгдсэн ТАСЛАЛААР ТУСГААРЛАСАН жагсаалт: `'design,sketch'`.
 *
 * ⚠️ ИХЭР ФАЙЛ: `backend/src/lib/quoteVariants.ts`. Хоёуланг нь ЗЭРЭГ засна —
 * тип ч, тест ч хамгаалахгүй. (Сервер тал нь монгол нэрсийг өөртөө хатуу
 * бичдэг — MCP-д i18n байхгүй; энэ тал нь i18n-ээс `quotes.variant.<key>`
 * түлхүүрээр авна.)
 *
 * ⚠️ Энэ нь template-ийн `variants` (`TemplateVariant`)-ТОЙ ӨӨР ДАВХАРГА. Тэр
 * нь ХУУДСЫГ өөрчилдөг (`hiddenRows`, `titleTemplate`); энэ нь зөвхөн АНГИЛАЛ.
 */
import type { TranslationKey } from '@/shared/i18n';

/**
 * Каталог. Дараалал нь СЕРИАЛИЗАЦИЙН эрэмбэ ба checkbox-уудын дэлгэцийн
 * дараалал хоёулаа — тиймээс `'sketch,design'` ба `'design,sketch'` нэг л
 * утга болж хадгалагдана.
 */
export const QUOTE_VARIANT_KEYS = ['design', 'sketch', 'interior', 'supervision'] as const;

export type QuoteVariantKey = (typeof QUOTE_VARIANT_KEYS)[number];

const ORDER: ReadonlyMap<string, number> = new Map(QUOTE_VARIANT_KEYS.map((k, i) => [k, i]));

/** Анхдагч сонголт — маягт нээхэд юу тэмдэглэгдсэн байх. */
export const DEFAULT_VARIANT_KEY: QuoteVariantKey = 'design';

/**
 * i18n түлхүүр. `control` («Хяналтын төсөв») нь каталогт БАЙХГҮЙ ч хуучин
 * баримтууд түүгээр хадгалагдсан тул орчуулга нь хэвээр байх ЁСТОЙ.
 */
export const variantI18nKey = (key: string): TranslationKey =>
  `quotes.variant.${key}` as TranslationKey;

export function isQuoteVariantKey(v: string): v is QuoteVariantKey {
  return (QUOTE_VARIANT_KEYS as readonly string[]).includes(v);
}

/**
 * ХАДГАЛАГДСАН утгыг задлана. Танихгүй (хуучин) түлхүүрийг ХАДГАЛНА — уншихад
 * баримт өөрийн түүхэн ангилалаа алдах ёсгүй.
 */
export function parseVariantKeys(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const k = part.trim();
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/** Каталогийн дарааллаар эрэмбэлнэ; каталогт байхгүй түлхүүр эцэст нь үлдэнэ. */
export function sortVariantKeys<T extends string>(keys: readonly T[]): T[] {
  return [...keys].sort(
    (a, b) => (ORDER.get(a) ?? Number.MAX_SAFE_INTEGER) - (ORDER.get(b) ?? Number.MAX_SAFE_INTEGER),
  );
}

export function serializeVariantKeys(keys: readonly string[]): string {
  return sortVariantKeys(keys).join(',');
}

/**
 * Нэг түлхүүрийн харагдах нэр.
 *
 * `t()` нь олдоогүй түлхүүрийг ӨӨРИЙГ НЬ буцаадаг тул тэр тохиолдолд түүхий
 * i18n түлхүүрийг харуулахгүй: template-ээс ирсэн `fallback` (мөн өөрөө i18n
 * түлхүүр байж болно) → эцэст нь түүхий variant түлхүүр.
 */
export function variantLabel(
  t: (key: TranslationKey) => string,
  key: string,
  fallback?: string,
): string {
  const dictKey = variantI18nKey(key);
  const translated = t(dictKey);
  if (translated !== dictKey) return translated;
  if (fallback) {
    const viaLabel = t(fallback);
    return viaLabel === fallback ? fallback : viaLabel;
  }
  return key;
}
