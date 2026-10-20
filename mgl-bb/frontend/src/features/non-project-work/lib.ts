/**
 * Төслийн бус ажлын UI туслах.  Хугацааны ЖИНХЭНЭ тооцоо сервер дээр
 * (`backend/src/lib/nonProjectWork.ts` `workMinutes`) — энд зөвхөн маягтын
 * урьдчилсан харалт, ижил томьёогоор (цайны цонхтой давхцсан хэсгийг хасна).
 */
import type { NonProjectEntry, NonProjectMeta, NonProjectStage } from './types';

export function parseHhmm(raw: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(raw.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Урьдчилсан хугацаа, минутаар.  Цаг дутуу/буруу бол null. */
export function previewMinutes(
  start: string,
  end: string,
  lunch: NonProjectMeta['lunch'],
): number | null {
  const s = parseHhmm(start);
  const e = parseHhmm(end);
  if (s === null || e === null || e <= s) return null;
  let minutes = e - s;
  const ls = lunch ? parseHhmm(lunch.start) : null;
  const le = lunch ? parseHhmm(lunch.end) : null;
  if (ls !== null && le !== null && le > ls) {
    minutes -= Math.max(0, Math.min(e, le) - Math.max(s, ls));
  }
  return minutes;
}

/** Дууссан цаг ээлжийн төгсгөлөөс хойш эсэх.  Яг тэнцүү нь зөвшөөрөгдөнө. */
export function exceedsShiftEnd(end: string, shiftEnd: string | null | undefined): boolean {
  if (!shiftEnd) return false;
  const e = parseHhmm(end);
  const cap = parseHhmm(shiftEnd);
  if (e === null || cap === null) return false;
  return e > cap;
}

/** Цайны цонхтой давхцаж байгаа эсэх — «цайны цаг хасагдсан» тэмдэглэлд. */
export function overlapsLunch(start: string, end: string, lunch: NonProjectMeta['lunch']): boolean {
  if (!lunch) return false;
  const s = parseHhmm(start);
  const e = parseHhmm(end);
  const ls = parseHhmm(lunch.start);
  const le = parseHhmm(lunch.end);
  if (s === null || e === null || ls === null || le === null) return false;
  return s < le && ls < e;
}

type T = (key: string, vars?: Record<string, string | number>) => string;

export function formatDuration(minutes: number, t: T): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return t('nonProjectWork.durationMinutes', { minutes: m });
  if (m === 0) return t('nonProjectWork.durationHours', { hours: h });
  return t('nonProjectWork.durationHoursMinutes', { hours: h, minutes: m });
}

/** Ангиллын шошго: i18n түлхүүр байвал түүгээр, эс бөгөөс серверийн шошго. */
export function categoryLabel(key: string, fallback: string, t: T): string {
  const i18nKey = `nonProjectWork.category.${key}`;
  const label = t(i18nKey);
  return label && label !== i18nKey ? label : fallback;
}

/** Шат бүрийн өнгө — `APPROVAL_STATUS_TONE`-ийн семантик токенууд. */
export const STAGE_TONE: Record<NonProjectStage, string> = {
  needs_report: 'bg-warning/10 text-warning border-warning/30',
  awaiting_review: 'bg-info/10 text-info border-info/30',
  approved: 'bg-success/10 text-success border-success/30',
  rejected: 'bg-danger/10 text-danger border-danger/30',
};

/**
 * Мөрийн цагийн бичвэр: цагтай бол «09:00–11:00 · 2 цаг», ирцэд сонгосон бол
 * «Ирцэд 15:00-д сонгосон · цаг оруулаагүй», аль нь ч биш бол «Цаг оруулаагүй».
 * Ирцийн сонголт зөвхөн хяналт тул цаггүй мөрөнд хугацаа ХАРУУЛАХГҮЙ.
 */
export function entryTimeLabel(
  entry: Pick<NonProjectEntry, 'start_time' | 'end_time' | 'minutes' | 'picked_at'>,
  t: T,
): string {
  if (entry.start_time && entry.end_time) {
    return `${entry.start_time}–${entry.end_time} · ${formatDuration(entry.minutes, t)}`;
  }
  const missing = t('nonProjectWork.timeMissing');
  return entry.picked_at ? `${t('nonProjectWork.pickedAt', { time: entry.picked_at })} · ${missing}` : missing;
}

/**
 * «Миний ажлууд»-аас дуусгахад эхэлсэн цагийн урьдчилсан утга: ирцэд анх
 * сонгосон цаг, ээлжийн эхлэл/төгсгөлөөр хязгаарласан (08:52-д ирээд сонгосон
 * бол 09:00).  Ажилтан засаж болно — зөвхөн «дууссан цагаа л оруулна» гэдэг
 * эзний хэрэглээнд (15:00-д гараад хяналтад явсан) нэг талбар үлдээнэ.
 */
export function suggestedStart(
  entry: Pick<NonProjectEntry, 'start_time' | 'picked_at'>,
  meta: Pick<NonProjectMeta, 'shift_start' | 'shift_end'>,
): string {
  if (entry.start_time) return entry.start_time;
  const picked = entry.picked_at ? parseHhmm(entry.picked_at) : null;
  if (picked === null) return '';
  const lo = meta.shift_start ? parseHhmm(meta.shift_start) : null;
  const hi = meta.shift_end ? parseHhmm(meta.shift_end) : null;
  if (hi !== null && picked >= hi) return '';
  const m = lo !== null ? Math.max(picked, lo) : picked;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * Ирцийн цонхны урьдчилсан сонголт — өнөөдрийн СҮҮЛИЙН цэгт сонгосон
 * (`active`) мөрүүд, төсөл ч мөн адил өмнөх цэгээс урьдчилан бөглөгддөг.
 * Хуучин (идэвхгүй) ангиллын мөр алгасна.  Утга = «Бусад»-ын тайлбар.
 */
export function initialPicks(
  entries: readonly NonProjectEntry[],
  categories: readonly { key: string }[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of entries) {
    if (!e.active || e.status === 'rejected') continue;
    if (!categories.some((c) => c.key === e.category) || out.has(e.category)) continue;
    out.set(e.category, e.note ?? '');
  }
  return out;
}

/** Сонголтыг серверийн `non_project` хэлбэрт (зөвхөн хяналт — цаг, тайлбаргүй). */
export function toWirePicks(
  state: ReadonlyMap<string, string>,
  categories: readonly { key: string; requires_note: boolean }[],
): Array<{ category: string; note: string | null }> {
  return categories
    .filter((c) => state.has(c.key))
    .map((c) => ({ category: c.key, note: c.requires_note ? (state.get(c.key) ?? '').trim() : null }));
}
