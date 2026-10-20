/**
 * `CellStyle` → Tailwind класс. Нэг эх сурвалж: дэлгэц дээрх редактор ба
 * хэвлэх хуудас ХОЁУЛАА эндээс уншина, ингэснээр «дэлгэц дээр өөр, PDF дээр
 * өөр харагдана» гэдэг сонгодог алдаа гарахгүй.
 *
 * Өнгө нь `index.css`-ийн семантик токенуудыг (--danger, --muted-foreground)
 * ашиглана — түүхий палитрын класс бүү бич (репогийн зурших).
 */
import type { CellStyle, NumFmt } from '../types/quotes';

const ALIGN: Record<NonNullable<CellStyle['align']>, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

/**
 * ⚠️ `text-danger` / `text-success` — `text-[var(--danger)]` БИШ.
 * `index.css`-д `--danger` нь HSL-ийн БҮРЭЛДЭХҮҮН (`350 89% 62%`) бөгөөд
 * Tailwind theme нь `--color-danger: hsl(var(--danger))` гэж ороодог. Тиймээс
 * `text-[var(--danger)]` нь `color: 350 89% 62%` гэсэн ХҮЧИНГҮЙ CSS гаргаж,
 * өнгө огт үйлчилдэггүй байв (НИЙТ ДҮН хар харагдаж байсны шалтгаан).
 */
const COLOR: Record<NonNullable<CellStyle['color']>, string> = {
  default: '',
  danger: 'text-danger',
  success: 'text-success',
  muted: 'text-muted-foreground',
};

const BG: Record<NonNullable<CellStyle['bg']>, string> = {
  none: '',
  header: 'bg-muted/60',
  group: 'bg-muted/40',
  total: 'bg-muted',
};

/** Тоон формат нь баруун тийш эгнэх ёстой — хэрэглэгч заагаагүй бол. */
function defaultAlign(fmt?: NumFmt): string {
  return fmt && fmt !== 'text' ? ALIGN.center : ALIGN.left;
}

export function cellClass(s: CellStyle | undefined, fmt?: NumFmt): string {
  const out: string[] = ['px-1.5 py-1 align-middle'];
  if (s?.bg === 'header') { out.push('text-center'); } else { out.push(s?.align ? ALIGN[s.align] : defaultAlign(fmt)); }
  if (s?.bold) out.push('font-semibold');
  if (s?.italic) out.push('italic');
  if (s?.color && s.color !== 'default') out.push(COLOR[s.color]);
  if (s?.bg && s.bg !== 'none') out.push(BG[s.bg]);
  if (s?.border) out.push('border border-border');
  if (s?.wrap) out.push('whitespace-normal break-words');
  else out.push('whitespace-nowrap');
  // Тоо баганад цэгцтэй харагдахын тулд — үнийн санал бүхэлдээ тоон баримт.
  if (fmt && fmt !== 'text') out.push('tabular-nums');
  return out.join(' ');
}

/** Нүд доторх `<input>`-ийн класс — нүднийхээ эгнээ/өнгийг өвлөнө. */
export const INPUT_CLASS =
  'w-full bg-transparent outline-none border-0 p-0 m-0 text-inherit font-inherit ' +
  'text-[inherit] leading-tight focus:ring-0 placeholder:text-muted-foreground/50';

/**
 * Dropdown нүдний `<option>`-ийн класс — ЗААВАЛ илэрхий өнгөтэй байна.
 *
 * ⚠️ `INPUT_CLASS` нь `bg-transparent` + `text-inherit` тул `<select>` нь нүдний
 * (бараан сэдэвт ЦАГААН) текстийн өнгийг өвлөнө. Харин Chromium-ийн задарсан
 * жагсаалтын дэвсгэрийг `<select>`-ийн background-аас авдаг бөгөөд alpha-тай
 * (тунгалаг) байвал ЦАГААН дээр холино. Үр дүнд нь бараан/дундаж сэдэвт
 * «цагаан дэвсгэр дээр цагаан үсэг» болж, сонголтууд огт уншигдахгүй байв.
 *
 * `color-scheme: dark` дангаараа хангалтгүй (`.dim`-д аль хэдийн байсан ч
 * асуудал үлдсэн) — мөр бүр өөрийн гэсэн ил background-тай байх ёстой.
 */
export const OPTION_CLASS = 'bg-popover text-popover-foreground';

/** Focus/сонголтын тодруулга. */
export const FOCUS_RING = 'outline outline-2 outline-offset-[-2px] outline-primary z-10 relative';
export const SELECTED_BG = 'bg-primary/10';

/**
 * Томьёоны ЛАВЛАГААНЫ тодруулга — Excel шиг өнгөт хүрээ.
 *
 * Нүд дээр зогсоход түүний томьёоны заасан нүд/муж эдгээр өнгөөр хүрээлэгдэнэ;
 * томьёоны мөрөнд тэр хаяг ижил өнгөөр будагдана. Тиймээс хүрээний өнгө болон
 * текстийн өнгө нь НЭГ индексээс гарах ёстой (`REF_TONE_*` хоёр массивын
 * дараалал таарна).
 *
 * ⚠️ Түүхий hex — эдгээр нь семантик БИШ (статус/төлөв илэрхийлэхгүй), зөвхөн
 * ялгах зориулалттай тул `--danger`/`--success` токенуудыг ашиглах учиргүй.
 * Гэрэл/бараан хоёуланд уншигдахаар дунд өнгөлөгтэй сонгосон.
 */
const REF_HEX = ['#2563eb', '#c026d3', '#ea580c', '#0d9488', '#7c3aed'] as const;

/** Лавлагааны хүрээний өнгө (inline style — Tailwind динамик класс үүсгэдэггүй). */
export function refBorderColor(tone: number): string {
  return REF_HEX[tone % REF_HEX.length] as string;
}

/** Томьёоны мөрөнд хаягийг будах өнгө. */
export function refTextColor(tone: number): string {
  return refBorderColor(tone);
}

/** Anchor тавигдсан нүдний тэмдэг. */
export const ANCHOR_MARK =
  'after:content-[""] after:absolute after:top-0 after:right-0 after:border-t-[6px] ' +
  'after:border-l-[6px] after:border-t-[var(--info)] after:border-l-transparent';
