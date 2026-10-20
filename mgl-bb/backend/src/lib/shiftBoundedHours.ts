/**
 * Ирцийн «ажилласан цаг» = ЭЭЛЖИЙН АЛБАН ЦОНХ доторх хугацаа − цай
 * (эзний шийдвэр 2026-10-01).
 *
 * 08:00–17:00 ээлжтэй хүн 07:40-д ирээд 16:40-д гарвал 08:00–16:40 = 8ц40м,
 * цайны 1ц хасаад 7ц40м.  07:20-д ирээд 16:57-д гарвал 7ц57м.  Ээлж эхлэхээс
 * өмнө ирсэн, ээлж дууссаны дараа үлдсэн хугацаа тоологдохгүй; эрт гарвал тэр
 * хэмжээгээр цаг багасна.  Өмнө нь [ирсэн, гарсан] бүхэлдээ тоологдож (07:40–
 * 16:40 = 8ц), цагийн хүснэгт нь гарсан цагаас үл хамааран «8ц − хоцролт»
 * өгдөг байв (2026-08-03-ны бодлого).
 *
 * Ээлж = тухайн хүний ТУХАЙН ӨДРИЙН бодит ээлж (`shiftForUser`: 08:00–17:00 /
 * 08:30–17:30 / 09:00–18:00 сонголт, 6–8 сард 08:00).
 *
 * ⚠️ `worker` (цэвэрлэгч) роль ЦОНХГҮЙ (`countingWindow`): түүний цаг уян хатан
 *    гэж кодонд тодорхойлогдсон (хоцролт ч тооцдоггүй, `routes/attendance.ts`
 *    `isWorkerUser`) — бодит цаг − цай, дээд тал нь 8ц хэвээр, эрт гарвал
 *    багасна.  Прод 2026-09: ганц worker (user 69, тогтмол 09:30–18:30) бодитоор
 *    ~10:30–20:00 ажилладаг; цонхоор хязгаарлавал сард ~40ц хасагдах байв.
 *
 * Нарийвчлал = бүтэн минут: ирсэн/гарсан цагийн секундыг ТАСАЛНА
 * (`ubMinutesOf`, хоцролттой ижил) — 16:57:40-д гарсан хүн 7ц57м, ажилтны
 * харсан цагтай таарна.
 *
 * ⚠️ ЗӨВХӨН `SHIFT_BOUNDED_FROM`-оос хойших өдөрт.  Өмнөх өдрүүд хуучин
 *    дүрмээрээ — эзний сонголт: 9-р сарын ирцийг ажилтнууд баталж эхэлсэн тул
 *    дахин бодохгүй.  Огноог ухраавал тэр мужийн ХАДГАЛСАН `hours_worked`
 *    хуучин дүрмээр бичигдсэн хэвээр үлдэнэ: цагийн хүснэгт интервалаас дахин
 *    боддог тул зөв гарна, харин `SUM(hours_worked)` уншдаг тайлангууд үгүй.
 *
 * Хэрэглэгчид (дүрэм ЗӨВХӨН ЭНД):
 *   - `routes/attendance.ts` `computeHours` — session бүрийн `hours_worked`
 *   - `routes/attendance.ts` `buildDailyAttendanceRows` — өдрийн цагийн хүснэгт
 *   - `lib/nonProjectWorkStore.ts` `syncNonProjectCredit` — гадуурх төслийн бус ажил
 */
import { isWorkerRole } from '../types';
import { lunchWindowOf, type LunchWindow } from './nonProjectWork';
import { ubMinutesOf, type Shift } from './workSchedule';

export const SHIFT_BOUNDED_FROM = '2026-10-01';

export function isShiftBounded(date: string): boolean {
  return date >= SHIFT_BOUNDED_FROM;
}

type Window = Pick<Shift, 'startMinutes' | 'endMinutes'>;

/** Бүтэн өдөр — цонхоор хязгаарлахгүй (зөвхөн цай хасагдана). */
export const FULL_DAY_WINDOW: Window = { startMinutes: 0, endMinutes: 1440 };

/**
 * Ажилласан цагийг тоолох цонх: ажилтны ээлж, `worker` бол бүтэн өдөр (дээрх
 * ⚠️-г үз).  Ирцийн цаг тоолдог газар бүр ээлжийг ШУУД биш үүгээр дамжуулна.
 */
export function countingWindow(shift: Window, role: string | null | undefined): Window {
  return isWorkerRole(role ?? '') ? FULL_DAY_WINDOW : shift;
}

/** Өдрийн минутын [start, end) интервал (0..1440). */
export type DaySpan = { start: number; end: number };

const DAY_MINUTES = 1440;
const clampDay = (n: number) => Math.max(0, Math.min(DAY_MINUTES, n));

/**
 * ISO (UB +08:00) ирсэн/гарсан цагийг `date` өдрийн минут болгоно.  Өмнөх
 * өдөр эхэлсэн → 0, дараагийн өдөр дууссан → 1440 (шөнө дамнасан session) —
 * `syncNonProjectCredit`-ийн session интервалтай ижил дүрэм.
 */
export function daySpanOf(clockIn: string, clockOut: string, date: string): DaySpan {
  return {
    start: clockIn.slice(0, 10) < date ? 0 : ubMinutesOf(clockIn),
    end: clockOut.slice(0, 10) > date ? DAY_MINUTES : ubMinutesOf(clockOut),
  };
}

/**
 * Интервалуудын НЭГДЭЛ ∩ [ээлжийн эхлэл, ээлжийн төгсгөл) − цай, минутаар.
 * Давхцсан session (давхар бүртгэлийн ихэр, дахин орсон) нэг л удаа
 * тоологдоно.  Нэг өдөр = 1440 нүд тул энгийн битмап.
 */
export function shiftBoundedMinutes(
  spans: readonly DaySpan[],
  shift: Pick<Shift, 'startMinutes' | 'endMinutes'>,
  lunch: LunchWindow,
): number {
  const cells = new Uint8Array(DAY_MINUTES);
  const lo = clampDay(shift.startMinutes);
  const hi = clampDay(shift.endMinutes);
  for (const s of spans) {
    const end = Math.min(hi, clampDay(s.end));
    for (let m = Math.max(lo, clampDay(s.start)); m < end; m += 1) cells[m] = 1;
  }
  if (lunch) {
    for (let m = clampDay(lunch.start); m < clampDay(lunch.end); m += 1) cells[m] = 0;
  }
  let total = 0;
  for (let m = 0; m < DAY_MINUTES; m += 1) total += cells[m]!;
  return total;
}

/** Нэг session-ийн ээлжийн цонх доторх ажилласан цаг (2 оронтой). */
export function shiftBoundedSessionHours(
  clockIn: string,
  clockOut: string,
  date: string,
  shift: Pick<Shift, 'startMinutes' | 'endMinutes'>,
  settings: { lunchEnabled: boolean; lunchStart: string; lunchEnd: string },
): number {
  const minutes = shiftBoundedMinutes(
    [daySpanOf(clockIn, clockOut, date)],
    shift,
    lunchWindowOf(settings),
  );
  return Math.round((minutes / 60) * 100) / 100;
}
