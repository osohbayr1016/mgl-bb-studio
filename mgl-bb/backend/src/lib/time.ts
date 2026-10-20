// Ulaanbaatar timezone helpers.
// The Mongolian team reports in local time, but Cloudflare Workers run in UTC.
// We centralize conversion here so the default "today" is always consistent.

import { orgConfig } from './orgConfig';

/**
 * Байгууллагын цагийн бүс.  Өгөгдмөл нь `Asia/Ulaanbaatar` (UTC+08:00, DST-гүй)
 * бөгөөд `ORG_TIMEZONE` env эсвэл `app_settings['org.timezone']`-ээр солино.
 * Функцийн нэрс `…InUB` хэвээр — олон зуун дуудлагын гарын үсэг өөрчлөхгүйн
 * тулд зориуд.  Утга нь тохиргоотой болсон, нэр нь түүхэн.
 */
function tz(): string {
  return orgConfig().timezone;
}

/**
 * Returns today's date in Ulaanbaatar as YYYY-MM-DD.
 * Used as the default `date` for progress entries when the client
 * doesn't supply one.
 */
export function todayInUB(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Returns now in Ulaanbaatar as ISO string (with +08:00 offset).
 * Useful for audit timestamps that should be readable locally.
 */
export function nowInUBIso(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}${tzOffset()}`;
}

/**
 * Идэвхтэй цагийн бүсийн ISO офсет (`+08:00`).  Урьд нь мөрөнд шууд бичигдсэн
 * байсан — цагийн бүс тохируулагдах болсон тул түүнээсээ гаргаж авна.
 * `longOffset` нь `GMT+08:00` хэлбэрээр ирдэг; `GMT` угтварыг хасна.  UTC дээр
 * зөвхөн `GMT` гэж ирдэг тул тэр тохиолдолд `+00:00`.
 */
function tzOffset(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz(),
    timeZoneName: 'longOffset',
  }).formatToParts(new Date());
  const raw = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  const off = raw.replace(/^(GMT|UTC)/, '');
  return off.length > 0 ? off : '+00:00';
}

/**
 * Зуны ажлын хуваарийн үе үү?  6-р сарын 1-нээс 8-р сарын 31 хүртэл
 * (жил бүр давтагдана) бүх ажилтан өглөөний 08:00–17:00 ээлжээр
 * ажиллана — ажилтны өөрийн `work_schedule` тохиргооноос үл хамаарна.
 * 6/7/8 сар нь яг бүтэн саруудаа эзэлдэг тул сараар шалгахад хангалттай.
 *
 * @param date  UB-ийн YYYY-MM-DD огноо.
 */
export function isSummerSchedule(date: string): boolean {
  const months = orgConfig().summerMonths;
  if (months.length === 0) return false;
  const mm = parseInt(date.slice(5, 7), 10);
  return Number.isInteger(mm) && months.includes(mm);
}
