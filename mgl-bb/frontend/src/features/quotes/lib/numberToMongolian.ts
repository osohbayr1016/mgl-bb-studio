/**
 * Тоог МОНГОЛ ҮСГЭЭР бичих — үнийн саналын «дүн үсгээр» мөрөнд зориулав.
 *
 * MGL-ийн бодит үнийн саналын тайлбар мөрөөс авсан жишээ:
 *   468558535  → «дөрвөн зуун жаран найман сая таван зуун тавин найман мянга
 *                 таван зуун гучин тав»
 *   1234318617 → «нэг тэрбум хоёр зуун гучин дөрвөн сая гурван зуун арван найман
 *                 мянга зургаан зуун арван долоо»
 *
 * ⚠️ Гол дүрэм — ТУСГААР ба ХОЛБОО хэлбэр:
 * Монгол тоо нь ард нь өөр үг (зуу/мянга/сая/тэрбум эсвэл дараагийн орон)
 * дагаж орох үед ХОЛБОО (attributive) хэлбэрт шилжинэ:
 *   тав → таван,  гучь → гучин,  зуу → зуун,  найм → найман …
 * Харин мөрийн ЭЦЭСТ буюу ард нь юу ч байхгүй бол ТУСГААР (absolute)
 * хэлбэрээрээ үлдэнэ: «…гучин тав», «хорь», «нэг зуу».
 *
 * Хэмжээний үг (мянга/сая/тэрбум) нь дундуур орсон ч хувиралгүй хэвээрээ
 * бичигдэнэ («…найман мянга таван зуун гучин тав») — энэ нь MGL-ийн бодит
 * баримтын бичлэг.
 */

/** Нэгжийн ТУСГААР хэлбэр (эцэст нь): 5 → «тав». */
const UNITS_ABS = [
  '',
  'нэг',
  'хоёр',
  'гурав',
  'дөрөв',
  'тав',
  'зургаа',
  'долоо',
  'найм',
  'ес',
] as const;

/** Нэгжийн ХОЛБОО хэлбэр (ард нь үг ордог): 5 → «таван». */
const UNITS_ATTR = [
  '',
  'нэг',
  'хоёр',
  'гурван',
  'дөрвөн',
  'таван',
  'зургаан',
  'долоон',
  'найман',
  'есөн',
] as const;

/** Аравтын ТУСГААР хэлбэр: 20 → «хорь». */
const TENS_ABS = [
  '',
  'арав',
  'хорь',
  'гуч',
  'дөч',
  'тавь',
  'жар',
  'дал',
  'ная',
  'ер',
] as const;

/** Аравтын ХОЛБОО хэлбэр: 20 → «хорин». */
const TENS_ATTR = [
  '',
  'арван',
  'хорин',
  'гучин',
  'дөчин',
  'тавин',
  'жаран',
  'далан',
  'наян',
  'ерэн',
] as const;

/** Гурван оронгийн бүлэг тус бүрийн хэмжээний үг (0-оос эхэлсэн индекс). */
const SCALES = ['', 'мянга', 'сая', 'тэрбум', 'их наяд'] as const;

const ZERO = 'тэг';
const MINUS = 'хасах';

/** Дэмжих дээд хязгаар: 5 бүлэг × 3 орон = 10^15-аас бага. */
const MAX_GROUPS = SCALES.length;

/**
 * 1..999 хүрээний нэг бүлгийг үгээр бичнэ.
 *
 * @param n     1..999
 * @param bound Ард нь өөр үг (хэмжээний үг эсвэл дараагийн бүлэг) байгаа эсэх.
 *              `true` бол сүүлчийн бүрэлдэхүүн ХОЛБОО хэлбэрт орно.
 */
function groupToWords(n: number, bound: boolean): string[] {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const tens = Math.floor((n % 100) / 10);
  const units = n % 10;

  if (hundreds > 0) {
    // «зуу» нь ард нь юу ч байхгүй үед л тусгаар үлдэнэ: 100 → «нэг зуу».
    const tailAfterHundreds = tens > 0 || units > 0 || bound;
    parts.push(UNITS_ATTR[hundreds] ?? '', tailAfterHundreds ? 'зуун' : 'зуу');
  }

  if (tens > 0) {
    const tailAfterTens = units > 0 || bound;
    parts.push((tailAfterTens ? TENS_ATTR[tens] : TENS_ABS[tens]) ?? '');
  }

  if (units > 0) {
    parts.push((bound ? UNITS_ATTR[units] : UNITS_ABS[units]) ?? '');
  }

  return parts.filter(Boolean);
}

/**
 * Тоог монгол үсгээр бичнэ.
 *
 * Бутархайг `Math.round`-оор тайрч БҮХЭЛ тоогоор ажиллана (үнийн санал дээр
 * төгрөгийн бүхэл дүнг л үсгээр бичдэг). 0 → «тэг», сөрөг → «хасах …».
 */
export function numberToMongolian(n: number): string {
  if (!Number.isFinite(n)) return '';

  const rounded = Math.round(n);
  const negative = rounded < 0;
  let rest = Math.abs(rounded);

  if (rest === 0) return ZERO;

  // Гурав гурван оронгоор нь бүлэглэнэ (бага → их).
  const groups: number[] = [];
  while (rest > 0) {
    groups.push(rest % 1000);
    rest = Math.floor(rest / 1000);
  }

  // Дэмжигдэх хязгаараас хэтэрвэл үсгээр бичихгүй — тоогоороо буцаана.
  if (groups.length > MAX_GROUPS) return String(rounded);

  const words: string[] = [];
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    const value = groups[i] ?? 0;
    if (value === 0) continue;

    const scale = SCALES[i] ?? '';
    // Ард нь хэмжээний үг эсвэл дараагийн утгатай бүлэг байвал ХОЛБОО хэлбэр.
    const hasTail = scale !== '' || groups.slice(0, i).some((g) => g > 0);
    words.push(...groupToWords(value, hasTail));
    if (scale) words.push(scale);
  }

  return (negative ? [MINUS, ...words] : words).join(' ');
}

export default numberToMongolian;
