import { formatDisplayName } from '@/shared/lib/formatting';

// ---------------------------------------------------------------------------
// Форматлагч туслахууд — AttendanceAdminPage-ийн бүх таб хуваалцан хэрэглэнэ.
// ---------------------------------------------------------------------------

export function formatMnt(amount: number): string {
  return new Intl.NumberFormat('mn-MN').format(Math.round(amount)) + '₮';
}

/** Parse a backend timestamp.  SQLite `datetime('now')` (used for
 *  created_at / decided_at) yields a *naive* "YYYY-MM-DD HH:MM:SS" string
 *  in UTC — mark it as UTC so the browser doesn't misread it as local time
 *  and show it 8h behind Ulaanbaatar.  Offset/Z ISO strings (e.g. clock_in's
 *  `nowInUBIso()` "+08:00") already carry their zone and parse as-is. */
export function parseServerDate(iso: string): Date {
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(iso)) {
    return new Date(iso.replace(' ', 'T') + 'Z');
  }
  return new Date(iso);
}

export function formatTime(iso: string): string {
  return parseServerDate(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Ulaanbaatar',
  });
}

const UB_DATETIME_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ulaanbaatar',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function formatDateTime(iso: string): string {
  const d = parseServerDate(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = UB_DATETIME_FMT.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

export function formatHours(h: number | null | undefined): string {
  if (h === null || h === undefined) return '—';
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  return `${hrs}h ${mins}m`;
}

/** Convert a raw minute count into the "HH:mm" the XLSX `Ажлын цаг` column
 *  uses (e.g. 540 → "09:00"). Returns "—" for null/0-or-less inputs. */
export function formatMinutesAsHm(min: number | null | undefined): string {
  if (min === null || min === undefined || min <= 0) return '—';
  const hrs = Math.floor(min / 60);
  const mm = String(min % 60).padStart(2, '0');
  return `${String(hrs).padStart(2, '0')}:${mm}`;
}

/** Минутыг Excel-д зориулж БУТАРХАЙ цагаар (488 → 8.13) — текст "HH:mm" биш
 *  тоон нүд тул Excel дээр шууд нийлбэрлэж/тооцоолж болно. */
export function minutesToHoursDec(min: number | null | undefined): number {
  if (min == null || min <= 0) return 0;
  return Math.round((min / 60) * 100) / 100;
}

/**
 * Ирцийн цагийн нүднүүдийн ЦОРЫН ГАНЦ харагдах формат — АРАВТЫН бутархай
 * цагаар, XLSX экспорттой ЯГ ижил утга (6400 мин → "106.67").
 *
 * ⚠️ Яагаад `formatMinutesAsHm` БИШ вэ: тэр нь `106:40` гэж буцаадаг байсан ба
 *    уншигч аравтын цэг гэж андуурч `106.40` (=106ц 24м) гэж уншдаг байв —
 *    40 минут нь 0.40 биш 0.67 цаг.  Дэлгэц ба Excel хоёр өөр бичиглэлтэй
 *    байсан нь цалин/торгуулийн тооцоонд бодит эргэлзээ үүсгэсэн тул хоёуланг
 *    нь аравтын хэлбэрт нэгтгэв.  `formatMinutesAsHm` нь зөвхөн лавлагааны
 *    tooltip-д үлдэнэ.
 */
export function formatHoursDec(min: number | null | undefined): string {
  if (min == null || min <= 0) return '—';
  return minutesToHoursDec(min).toFixed(2);
}

/** `yyyy-mm-dd` → `MM-DD` (жилгүй, эвхэгдсэн жагсаалтад зориулсан). */
export function formatShortDate(iso: string): string {
  const parts = iso.split('-');
  return parts.length === 3 ? `${parts[1]}-${parts[2]}` : iso;
}

/** Compact "M/D/YYYY" matching the XLSX sample (e.g. `4/1/2026`). */
export function formatGridDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${parseInt(m!, 10)}/${parseInt(d!, 10)}/${y}`;
}

// Монгол кирилл → латин хөрвүүлэх энгийн зураглал.  Нэрийг латинаар хайх
// боломжтой болгоход ашиглана (жишээ нь "Ананд" → "anand").
const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'j',
  з: 'z',
  и: 'i',
  й: 'i',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  ө: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ү: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sh',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

/** Текстийг латин руу хөрвүүлж сул хэлбэрт оруулна.  `kh`-г `h` болгож,
 *  х-ийг "kh"/"h" аль алинаар нь бичсэн хайлттай тааруулна. */
export function latinizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[а-яёөү]/g, (ch) => CYRILLIC_TO_LATIN[ch] ?? ch)
    .replace(/kh/g, 'h');
}

/** Ажилтны нэр хайлтын үгтэй тохирч буй эсэх — кирилл шууд эсвэл латин
 *  хөрвүүлгээр.  Хайлтын үг латин ч, кирилл ч байж болно. */
export function nameMatchesQuery(fullName: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  const name = formatDisplayName(fullName).toLowerCase();
  return name.includes(q) || latinizeName(name).includes(latinizeName(q));
}
