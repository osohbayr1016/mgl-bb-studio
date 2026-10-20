/**
 * Тоог АНГЛИ ҮСГЭЭР бичих — англи хэлт үнийн саналын «дүн үсгээр» мөрөнд
 * зориулав. `numberToMongolian.ts`-ийн ГЭРЭЭГ яг дагана: `Math.round`-оор
 * бүхэл болгоно, 0 → "zero", сөрөг → "minus …", 10^15-аас дээш бол тоогоороо.
 *
 * Жишээ (албан бичгийн хэлбэр — "and" ХЭРЭГЛЭХГҮЙ):
 *   468558535  → "four hundred sixty-eight million five hundred fifty-eight
 *                 thousand five hundred thirty-five"
 *   1234318617 → "one billion two hundred thirty-four million three hundred
 *                 eighteen thousand six hundred seventeen"
 *   21         → "twenty-one"   (21–99 нь зурааст: "forty-five")
 *
 * Монгол хувилбараас ялгаатай нь англи тоонд ТУСГААР/ХОЛБОО хэлбэрийн
 * хувирал байхгүй тул нэг л үгийн сан хангалттай.
 */

/** 0..19 — teens нь тусдаа үгтэй. */
const UNITS = [
  '',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
] as const;

/** Аравтууд (индекс 2 = twenty). */
const TENS = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
] as const;

/** Гурван оронгийн бүлэг тус бүрийн хэмжээний үг (0-оос эхэлсэн индекс). */
const SCALES = ['', 'thousand', 'million', 'billion', 'trillion'] as const;

const ZERO = 'zero';
const MINUS = 'minus';

/** Дэмжих дээд хязгаар: 5 бүлэг × 3 орон = 10^15-аас бага. */
const MAX_GROUPS = SCALES.length;

/** 1..999 хүрээний нэг бүлгийг үгээр бичнэ. */
function groupToWords(n: number): string[] {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;

  if (hundreds > 0) parts.push(UNITS[hundreds] ?? '', 'hundred');

  if (rest >= 20) {
    const tens = Math.floor(rest / 10);
    const units = rest % 10;
    // 21–99 нь зурааст: "forty-five".
    parts.push(units > 0 ? `${TENS[tens] ?? ''}-${UNITS[units] ?? ''}` : (TENS[tens] ?? ''));
  } else if (rest > 0) {
    parts.push(UNITS[rest] ?? '');
  }

  return parts.filter(Boolean);
}

/**
 * Тоог англи үсгээр бичнэ.
 *
 * Бутархайг `Math.round`-оор тайрч БҮХЭЛ тоогоор ажиллана (үнийн санал дээр
 * төгрөгийн бүхэл дүнг л үсгээр бичдэг). 0 → "zero", сөрөг → "minus …".
 */
export function numberToEnglish(n: number): string {
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

    words.push(...groupToWords(value));
    const scale = SCALES[i] ?? '';
    if (scale) words.push(scale);
  }

  return (negative ? [MINUS, ...words] : words).join(' ');
}

export default numberToEnglish;
