/**
 * Нүдний утгыг ХАРУУЛАХ хэлбэрт хөрвүүлэх ба гараас орсон түүхий текстийг
 * нүдний өгөгдөл болгон унших.
 *
 * Тооцоо энд ХИЙГДЭХГҮЙ — тэр нь `lib/formula`-д. Энэ файл нь зөвхөн
 * харагдац ба оролт хоёрын хооронд хөрвүүлнэ.
 */
import type { NumFmt, SheetCell } from '../types/quotes';

/** Томьёоны алдааны код — `lib/formula`-аас ирнэ. */
function isErrorLike(v: unknown): v is { code: string } {
  return typeof v === 'object' && v !== null && 'code' in v;
}

/**
 * Валютын угтвар. Салгагч нь ТАСРАШГҮЙ зай (U+00A0) — нүд нарийсахад «₮» ба
 * тоо хоёр өөр мөрт унахгүй.
 */
const CURRENCY_PREFIX = '\u20AE\u00A0';

/**
 * Тооцоологдсон утгыг хэрэглэгчид харуулах мөр болгоно.
 *
 * `fmt` заагаагүй тоо нь мянгатын таслалтай гарна — үнийн саналын бүх тоо ийм
 * тул default нь `#,##0` шиг ажилладаг. Мөр (текст) утгыг хөндөхгүй.
 *
 * `currency` — тухайн нүд МӨНГӨН дүн эсэх (`lib/currency.ts`-ийн
 * `currencyCols`). Зөвхөн МӨНГӨН формат (`#,##0`, `#,##0.00`) дээр «₮ »
 * угтвар нэмнэ: хувь (`0%`), текст, форматгүй тоо (жишээ нь хөнгөлөлтийн
 * «-10») хэзээ ч валют болохгүй.
 *
 * ⚠️ `parseInput` нь `₮`-г цэвэрлэдэг тул засварлагчид энэ угтвар буцаж
 * уншигдахад саад болохгүй (нүд focus авахад `editText`-ийн ТҮҮХИЙ утга
 * харагдана — угтваргүй).
 */
export function formatValue(value: unknown, fmt?: NumFmt, currency = false): string {
  if (isErrorLike(value)) return value.code;
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value);

  switch (fmt) {
    case 'text':
      return String(value);
    case '#,##0.00': {
      const s = value.toLocaleString('mn-MN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      return currency ? CURRENCY_PREFIX + s : s;
    }
    case '0%':
      return `${Math.round(value * 100)}%`;
    case '0.0%':
      return `${(value * 100).toFixed(1)}%`;
    case '#,##0': {
      const s = Math.round(value).toLocaleString('mn-MN');
      return currency ? CURRENCY_PREFIX + s : s;
    }
    default:
      // Формат ЗААГААГҮЙ нүд — валют БОЛОХГҮЙ (`lib/currency.ts`-ийн
      // `isMoneyFmt`-тэй нэг дүрэм). Жишээ: хөнгөлөлтийн хувийн нүдэнд
      // бичигдсэн `-10` нь мөнгө биш.
      return Math.round(value).toLocaleString('mn-MN');
  }
}

/**
 * Гараас орсон түүхий текстийг нүдний өгөгдөл болгоно.
 *
 * - `=`-ээр эхэлбэл томьёо (`f`).
 * - Тоо мэт бол тоо (`v: number`). Мянгатын таслал, зай, `₮` тэмдгийг цэвэрлэнэ
 *   — PM Excel-ээс `1,200` гэж буулгахад тоо болж унших ёстой.
 * - `15%` гэж бичвэл 0.15 болж хадгалагдана (Excel-ийн зан төлөв).
 * - Бусад бүх зүйл текст.
 * - Хоосон бол `null` буцаана → дуудагч нүдийг устгана.
 */
export function parseInput(raw: string): SheetCell | null {
  const s = raw.trim();
  if (s === '') return null;
  if (s.startsWith('=')) return { f: s };

  const pct = /^-?[\d\s,]*\.?\d+\s*%$/.test(s);
  const cleaned = s.replace(/[₮\s,]/g, '').replace(/%$/, '');
  if (cleaned !== '' && /^-?\d*\.?\d+$/.test(cleaned)) {
    const n = Number(cleaned);
    if (Number.isFinite(n)) {
      return pct ? { v: n / 100, fmt: '0%' } : { v: n };
    }
  }
  return { v: s };
}

/**
 * Нүдийг ЗАСВАРЛАХ горимд оруулахад input-д харуулах текст.
 * Томьёотой нүдэнд томьёог өөрийг нь харуулна (тооцоолсон утгыг биш) — Excel-тэй адил.
 */
export function editText(cell: SheetCell | undefined): string {
  if (!cell) return '';
  if (cell.f) return cell.f;
  if (cell.v === null || cell.v === undefined) return '';
  if (typeof cell.v === 'number' && cell.fmt === '0%') return `${cell.v * 100}%`;
  return String(cell.v);
}
