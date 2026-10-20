/**
 * Localized number / currency formatting.
 *
 * `formatPrice(20000, 'MNT', 'mn')` → "20,000₮"
 * `formatPrice(20000, 'USD', 'en')` → "$20,000"
 *
 * Kept tiny on purpose — most code paths just need integer-rounded
 * money. If a future caller needs decimals, add a `digits` option.
 */

import { brand } from '@/shared/config/brand';
export function formatPrice(
  amount: number,
  currency: string = 'MNT',
  locale: 'mn' | 'en' = 'mn',
): string {
  if (!Number.isFinite(amount)) amount = 0;
  const cur = (currency || 'MNT').toUpperCase();
  const nf = new Intl.NumberFormat(locale === 'mn' ? 'mn-MN' : 'en-US', {
    maximumFractionDigits: 0,
  });
  const body = nf.format(Math.round(amount));
  if (cur === 'MNT') return `${body}₮`;
  if (cur === 'USD') return `$${body}`;
  if (cur === 'EUR') return `€${body}`;
  return `${body} ${cur}`;
}

/** Locale-aware plain number with thousands grouping (no currency).
 *  `formatNumber(120000, 'mn')` → "120,000". Keeps up to 2 decimals
 *  so fractional values (e.g. an area of 1234.5) read correctly. */
export function formatNumber(value: number, locale: 'mn' | 'en' = 'mn'): string {
  if (!Number.isFinite(value)) value = 0;
  return new Intl.NumberFormat(locale === 'mn' ? 'mn-MN' : 'en-US', {
    maximumFractionDigits: 2,
  }).format(value);
}

/** Human-friendly "saved X seconds ago" string. Pass the ISO timestamp
 *  from the server's `last_saved_at` field. */
export function formatTimeAgo(
  isoOrSqlTimestamp: string | null | undefined,
  locale: 'mn' | 'en' = 'mn',
): string {
  if (!isoOrSqlTimestamp) return '';
  // D1 stores "YYYY-MM-DD HH:MM:SS" (UTC). Browser Date.parse handles
  // ISO strings; for the SQL-style form we coerce to ISO first.
  const iso = isoOrSqlTimestamp.includes('T')
    ? isoOrSqlTimestamp
    : isoOrSqlTimestamp.replace(' ', 'T') + 'Z';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = Math.max(0, (Date.now() - t) / 1000);
  if (locale === 'mn') {
    if (diff < 5) return 'дөнгөж сая';
    if (diff < 60) return `${Math.floor(diff)} секундын өмнө`;
    if (diff < 3600) return `${Math.floor(diff / 60)} минутын өмнө`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} цагийн өмнө`;
    return `${Math.floor(diff / 86400)} өдрийн өмнө`;
  }
  if (diff < 5) return 'just now';
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/**
 * Display a person's name as "Нэр Овог" (given name first, surname last).
 *
 * The database stores `full_name` in the Mongolian convention "Овог Нэр"
 * (e.g., "Бат-Өлзий Билгүүн"). The UI prefers "Нэр Овог" — this helper
 * splits on the first whitespace and swaps the halves. Single-word values
 * and falsy inputs are returned unchanged.
 */
/** `formatDisplayName`-ийн УРВУУ: харагдац дахь «Нэр Овог» → DB-ийн «Овог Нэр».
 *
 *  ⚠️ Хэрэгтэй болсон шалтгаан: паспортын баримтын маягт нь ХАРАГДАЦЫГ
 *  үзүүлдэг тул хэрэглэгч тэнд «Ганбат Батбаяр» гэж бичнэ.  Түүнийг шууд
 *  `client_contacts[0].full_name`-д хадгалбал дараагийн уншилтад
 *  `formatDisplayName` дахин эргүүлж «Батбаяр Ганбат» болгоно.  Хоёр
 *  функц ижил дүрэмтэй байх ЁСТОЙ — аль нэгийг өөрчилвөл нөгөөг нь ч. */
export function toStoredName(display: string | null | undefined): string {
  const s = (display ?? '').trim();
  const i = s.indexOf(' ');
  if (i <= 0) return s;
  const first = s.slice(0, i);
  const rest = s.slice(i + 1).trim();
  return rest ? `${rest} ${first}` : s;
}

export function formatDisplayName(fullName: string | null | undefined): string {
  if (!fullName) return '';
  const trimmed = fullName.trim();
  const idx = trimmed.indexOf(' ');
  if (idx <= 0) return trimmed;
  const ovog = trimmed.slice(0, idx);
  const ner = trimmed.slice(idx + 1).trim();
  if (!ner) return trimmed;
  return `${ner} ${ovog}`;
}

/**
 * Төслийн нэрнээс `MGL-YYMMDD_` угтварыг хасаж, утга бүхий хэсгийг үлдээнэ.
 *
 * Төслийн нэр «MGL-251222-МАКС ӨРГӨӨ-ДАХИН ТӨЛӨВЛӨЛТ_ZA» хэлбэртэй байдаг.
 * Нарийн газар (sidebar-ийн дэд цэс ~16rem) бүтнээр нь тавихад эхний 20
 * тэмдэгт нь бараг зөвхөн код болж, мөр бүр «MGL-251222-МАКС…» болж
 * ялгагдахаа больдог.  Кодыг хасахад «МАКС ӨРГӨӨ-ДАХИН ТӨЛӨВЛӨЛТ_ZA»
 * үлдэж, богино зайд ч ялгагдана.
 *
 * ⚠ Зөвхөн ХАРАГДАЦАД.  Бүтэн нэрийг `title`/tooltip-д үлдээ — код нь
 * ажлын харилцаанд хэрэглэгддэг (захидал, гэрээ) тул алдагдаж болохгүй.
 * Угтвар байхгүй нэрийг хэвээр буцаана.
 */
export function formatProjectShortName(name: string | null | undefined): string {
  if (!name) return '';
  const trimmed = name.trim();
  // Гурван бичиглэл бүгд production-д тааралдана — тусгаарлагч нь `_`, `-`
  // эсвэл ЗАЙ байж болно:
  //   MGL-240506_FURNITURE LAND_ZA
  //   MGL-251222-МАКС ӨРГӨӨ-ДАХИН ТӨЛӨВЛӨЛТ_ZA
  //   MGL-260804 Хүй долоон худаг-Стадион
  // Код огт байхгүй нэр ч бий (ж: «MITIC_AZ») — тэр нь хэвээрээ буцна.
  // Угтвар нь тохиргоотой (`org.project_code_prefix`) — MGL дээр `MGL`, өөр
  // компанид өөрийнх нь код.  Хоосон бол тайралт огт хийхгүй.
  const prefix = brand().projectCodePrefix;
  if (!prefix) return trimmed;
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const stripped = trimmed.replace(new RegExp(`^${escaped}-\\d{6}[-_\\s]+`, 'i'), '');
  return stripped || trimmed;
}
