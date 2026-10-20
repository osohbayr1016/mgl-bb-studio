/**
 * Чөлөөний хүсэлтийн «ажлын цагийн цонх» (2026-08-13).
 *
 * Журам:
 *   1. Хүсэлтийг ЗӨВХӨН ажлын цагаар илгээнэ.  Ажлын цаг нь ажилтны
 *      бодит ээлжээс хамаарна — өвөл 09:00–18:00 (`standard`), зун
 *      (6–8 сар) бүх ажилтан 08:00–17:00 (`early`).  Ээлжийн эх сурвалж
 *      нь `lib/workSchedule.ts` — ирцийн хоцролт тооцдогтой ЯГ ижил.
 *   2. Бямба/Ням болон нийтийн амралтын өдөр хаалттай (ажлын өдөр биш).
 *      Тиймээс «өмнөх өдөр нь мэдэгдэнэ» гэдэг нь практикт «доод тал нь
 *      1 хоногийн өмнө» болно — Даваагийн чөлөөг Баасан гаригт илгээнэ.
 *   3. Бүтэн өдрийн чөлөө хамгийн эрт МАРГААШ эхэлнэ (өнөөдрийнхийг
 *      вэбээр авахгүй — нягтлан зохицуулах хугацаа өгөх зорилготой).
 *      Харин цагаар авах чөлөө (2ц/4ц/цагийн хүрээ) өнөөдөр ОДООГООС
 *      ХОЙШ эхэлж байвал зөвшөөрнө.
 *   4. Ажлын бус цагт / яаралтай тохиолдолд ажилтан утсаар мэдэгдэнэ —
 *      вэбээр авах боломжгүй хэвээр.  Админ `POST /api/leaves`-д
 *      `user_id` дамжуулан ажилтны өмнөөс бүртгэх зам (adminGrant) нь
 *      энэ шалгалтаас БҮРЭН чөлөөтэй; тэр нь утсаар ирсэн хүсэлтийг
 *      системд буулгах цорын ганц гарц.
 */
import { todayInUB, nowInUBIso } from './time';
import { isHoliday } from './holidays';
import {
  addDays,
  effectiveSchedule,
  hhmmOfMinutes,
  isWeekend,
  minutesOfHHMM,
  ubMinutesOf,
  type ScheduleKey,
  type Shift,
} from './workSchedule';
import { getScheduleAssignments } from './scheduleStore';
import { shiftForUser } from './specialShift';

export type LeaveWindowReason = 'open' | 'weekend' | 'holiday' | 'before_shift' | 'after_shift';

export interface LeaveWindow {
  /** Яг одоо хүсэлт илгээх боломжтой юу? */
  open: boolean;
  reason: LeaveWindowReason;
  /** UB-ийн өнөөдөр (YYYY-MM-DD). */
  today: string;
  schedule: ScheduleKey;
  /** '09:00–18:00' гэх мэт харуулах шошго. */
  shift_label: string;
  shift_start: string;
  shift_end: string;
  /** UB-ийн одоогийн цаг 'HH:MM'. */
  now: string;
  /** Бүтэн өдрийн чөлөөний хамгийн эрт эхлэх огноо — маргааш. */
  min_full_day_date: string;
  /** Цагаар авах чөлөөний хамгийн эрт эхлэх огноо — өнөөдөр. */
  min_timed_date: string;
  /** Өнөөдөр цагаар чөлөө авах бол хамгийн эрт эхлэх цаг 'HH:MM'. */
  min_time_today: string;
}

/**
 * Ажилтны ТУХАЙН ӨДРИЙН бодит ээлж.  `getLeaveWindow` үүнийг `todayInUB()`-ээр
 * дууддаг бол `day_part` дериваци нь ЧӨЛӨӨНИЙ ЭХЛЭХ ОГНООГООР дуудна —
 * 8-р сар нь зун (бүгд 08:00), 9-р сарын 1-нээс зуны албадлага тайлагдаж
 * миграци 0199-ийн огноотой сонголт хүчинтэй болдог тул хоёр өдрийн ээлж
 * ӨӨР байж болно.  Энэ функц нь ирц дэх хоцролтын тооцоотой ЯГ ижил
 * `shiftForUser`-ийг уншина — ирцийн хоцролттой ЯГ ижил ээлж
 * (user 69-ийн тогтмол 09:30–18:30 оролцуулаад). Хоёр нь хэзээ ч зөрөхгүй.
 */
export async function resolveShiftOn(
  db: D1Database,
  userId: number,
  date: string,
): Promise<{ schedule: ScheduleKey; shift: Shift }> {
  const row = await db
    .prepare(`SELECT work_schedule FROM users WHERE id = ?`)
    .bind(userId)
    .first<{ work_schedule: ScheduleKey | null }>();
  const assignments = await getScheduleAssignments(db, userId);
  const schedule = effectiveSchedule(row?.work_schedule, date, assignments);
  return { schedule, shift: shiftForUser(userId, row?.work_schedule, date, assignments) };
}

/** Ажилтны тухайн агшны чөлөөний цонхыг тооцно. */
export async function getLeaveWindow(db: D1Database, userId: number): Promise<LeaveWindow> {
  const today = todayInUB();
  // Ээлжийн сонголт нь 2026-09-01-ээс `user_work_schedules`-д огноотойгоор
  // хадгалагдана (миграци 0199) — чөлөөний цонх ирцийн хоцролттой ИЖИЛ
  // ээлжээс уншсаар байхын тулд `resolveShiftOn`-оор дамжина.
  const { schedule, shift } = await resolveShiftOn(db, userId, today);
  const nowMinutes = ubMinutesOf(nowInUBIso());

  let reason: LeaveWindowReason = 'open';
  if (isWeekend(today)) reason = 'weekend';
  else if (await isHoliday(db, today)) reason = 'holiday';
  else if (nowMinutes < shift.startMinutes) reason = 'before_shift';
  else if (nowMinutes >= shift.endMinutes) reason = 'after_shift';

  return {
    open: reason === 'open',
    reason,
    today,
    schedule,
    shift_label: shift.label,
    shift_start: hhmmOfMinutes(shift.startMinutes),
    shift_end: hhmmOfMinutes(shift.endMinutes),
    now: hhmmOfMinutes(nowMinutes),
    min_full_day_date: addDays(today, 1),
    min_timed_date: today,
    min_time_today: hhmmOfMinutes(nowMinutes),
  };
}

/** Цонх хаалттай үед ажилтанд харуулах мессеж (утасны дугаар оруулахгүй). */
export function closedWindowMessage(win: LeaveWindow): string {
  const suffix = `Чөлөөний хүсэлтийг зөвхөн ажлын цагаар (${win.shift_label}) илгээнэ.`;
  switch (win.reason) {
    case 'weekend':
      return `Өнөөдөр амралтын өдөр байна. ${suffix}`;
    case 'holiday':
      return `Өнөөдөр нийтийн амралтын өдөр байна. ${suffix}`;
    case 'before_shift':
      return `Ажлын цаг ${win.shift_start}-д эхэлнэ. ${suffix}`;
    case 'after_shift':
      return `Ажлын цаг ${win.shift_end}-д дууссан. ${suffix}`;
    default:
      return suffix;
  }
}

export interface LeaveTimingInput {
  /** Хүсэлтийн эхлэх огноо (YYYY-MM-DD). */
  start: string;
  /** Цагаар авах чөлөөний эхлэх цаг 'HH:MM'; бүтэн өдөр бол `null`. */
  startTime: string | null;
}

/**
 * Огнооны дүрмийг шалгана.  Алдаа байвал ажилтанд харуулах мессежийг,
 * зөв бол `null` буцаана.  Цонх хаалттай эсэхийг ЭНД шалгахгүй —
 * дуудагч эхлээд `win.open`-ыг шалгана.
 *
 * Цагийг ДАХИН уншихгүй — `win`-ий snapshot-ыг л ашиглана.  Ингэснээр
 * шалгалт цэвэр функц болж, цонх тооцох ба шалгах хоёрын хооронд минут
 * үсрэх (жишээ нь 17:59:59 → 18:00:00) тохиолдол алга болно.
 */
export function validateLeaveTiming(win: LeaveWindow, input: LeaveTimingInput): string | null {
  if (input.startTime === null) {
    // Бүтэн өдрийн чөлөө — хамгийн эрт маргааш.
    if (input.start < win.min_full_day_date) {
      return (
        `Бүтэн өдрийн чөлөөг доод тал нь нэг хоногийн өмнө мэдэгдэнэ — ` +
        `хамгийн эрт ${win.min_full_day_date}-нээс эхлэнэ. Өнөөдрийн болон ` +
        `өнгөрсөн огнооны чөлөөг утсаар мэдэгдэнэ.`
      );
    }
    return null;
  }

  // Цагаар авах чөлөө — өнөөдөр байж болох ч зөвхөн одооноос хойш.
  if (input.start < win.today) {
    return `Өнгөрсөн огнооны чөлөөг вэбээр бүртгэхгүй — утсаар мэдэгдэнэ.`;
  }
  if (input.start === win.today) {
    const startMinutes = minutesOfHHMM(input.startTime);
    if (startMinutes === null) return 'Эхлэх цаг буруу байна (HH:MM).';
    const nowMinutes = minutesOfHHMM(win.min_time_today) ?? 0;
    if (startMinutes < nowMinutes) {
      return `Өнөөдрийн чөлөө одоогийн цагаас (${win.now}) хойш эхлэх ёстой.`;
    }
  }
  return null;
}
