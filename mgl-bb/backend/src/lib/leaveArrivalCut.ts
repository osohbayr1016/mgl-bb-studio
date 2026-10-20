/**
 * Батлагдсан чөлөөг ИРСЭН ЦАГААР богиносгох — ЦЭВЭР дүрэм (2026-09-29).
 *
 * Эзний хүсэлт: «12 цаг хүртэл чөлөө авсан хүн өглөө 9-д ажилдаа ирвэл
 * 8-аас 9 хүртэл 1 цагийн чөлөө болж, цалин нь ирсэн цагаас бодогдоно.
 * Зөвхөн батлагдсан чөлөөнд.»  Эзний хоёр нэмэлт шийдвэр (AskUserQuestion):
 *   1. Олон хоногийн чөлөөнд ЗӨВХӨН ирсэн өдөр богиносно — ирээгүй өдрүүд
 *      бүтэн чөлөөтэй хэвээр (Пүрэв ч ирвэл тэр өдөр мөн адил).
 *   2. Өглөөний / бүтэн өдрийн чөлөөтэй хүн ээлжийн эхэнд эсвэл эрт ирвэл
 *      тэр өдрийн чөлөө 0 цаг болно (ашиглагдаагүй).
 *
 * Өдрийн цонх:
 *   • нэг өдрийн, цагтай чөлөө → [start_time, end_time];
 *   • цаггүй (бүтэн өдрийн) эсвэл олон хоногийн чөлөө → ээлжийн [эхлэл, төгсгөл].
 *
 * Хоёр төрлийн цонх:
 *   • ӨДРИЙН ЭХЭНД эхэлдэг (цонхны эхлэл ≤ ээлжийн эхлэл) — «X хүртэл
 *     ирэхгүй» гэсэн чөлөө.  Ирсэн цаг < цонхны төгсгөл бол чөлөө
 *     [ээлжийн эхлэл, ирсэн цаг] болно; ээлжийн эхлэлээс өмнө/яг үед ирвэл
 *     0 (шийдвэр 2).  Хоцролтын grace-ийн дотор ирсэн бол мөн 0 — эс тэгвэл
 *     чөлөөтэй хүн 08:03-д ирэхэд чөлөөгүй хүнээс 3 минут бага цалин авна.
 *   • ӨДРИЙН ДУНД эхэлдэг (14:00–17:00 г.м.) — ирсэн цаг цонхон ДОТОР байвал
 *     л [цонхны эхлэл, ирсэн цаг]; цонхноос ӨМНӨ ирвэл ажилтан ажил дээрээ
 *     байгаа бөгөөд дараа нь гарна гэсэн үг тул ХӨНДӨХГҮЙ.
 * Ирсэн цаг ≥ цонхны төгсгөл → чөлөө бүтэн ашиглагдсан, өөрчлөлтгүй.
 *
 * ⚠️ Минут нь ЦАЙ ХАССАН ажлын минут (2026-10-12-оос, `lib/leaveHours.ts`) —
 *    гараар бичсэн цагтай чөлөөний `rangeHours` (`routes/leaves.ts`)-тай ЯГ
 *    ижил.  Иймээс богиносгосон чөлөө «ажилтан анхнаасаа ийм цагтай хүсэлт
 *    гаргасан» мэт тооцогдоно; ирцийн хүснэгтийн хоцролтын суурь
 *    (`addLeaveWorkMinutes(ээлжийн эхлэл, чөлөө, цай)`) цайг алгасаж ирсэн
 *    цагтай яг таардаг тул хуурамч хоцролт үүсэхгүй.  (Өмнө нь түүхий зөрүү —
 *    цайны дараа ирсэн бүтэн өдрийн чөлөөнд 60 мин илүү чөлөө тооцогддог байв.)
 * ⚠️ Нэг өдрийн минут нь ирцийн хүснэгтийн (`buildDailyAttendanceRows`)
 *    томьёотой ИЖИЛ: `hours / хуанлийн өдөр × 60`, hours NULL бол 480.
 * ⚠️ Олон хоногийн ЦАГТАЙ чөлөө (систем үүсгэдэггүй, прод дээр 0 мөр) ба
 *    `remote` (зайнаас ажил — чөлөө биш) хөндөгдөхгүй.
 */
import { STANDARD_WORK_DAY_HOURS } from '../types';
import { leaveWorkMinutes, type LeaveLunch } from './leaveHours';

export const FULL_DAY_LEAVE_MINUTES = STANDARD_WORK_DAY_HOURS * 60;

/** Богиносгохоос ӨМНӨХ (анх батлагдсан) чөлөөний утгууд. */
export interface LeaveOriginal {
  leave_type: string;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  hours: number | null;
  days: number;
}

/** Нэг өдрийн богиносголт — `leave_arrival_cuts`-ийн мөр. */
export interface DayCut {
  date: string;
  /** Ирсэн цаг 'HH:MM'. */
  arrival: string;
  /** Богиносгосон цонх (тэр өдрийн үлдсэн чөлөө). */
  start_time: string;
  end_time: string;
  /** Тэр өдрийн анхны чөлөөний минут. */
  full_minutes: number;
  /** Ирсэн цаг хүртэлх үлдсэн чөлөөний минут (0 байж болно). */
  used_minutes: number;
}

export interface PlanDayCutInput {
  leave: LeaveOriginal;
  date: string;
  /** Өдрийн АНХНЫ ирсэн цаг (өдрийн минут), ирцгүй бол null. */
  arrivalMinutes: number | null;
  shift: { startMinutes: number; endMinutes: number };
  /** Хоцролтын grace (минут) — өдрийн эхэнд эхэлдэг чөлөөнд л хэрэглэнэ. */
  graceMinutes: number;
  /** Бя/Ня эсвэл нийтийн амралт — чөлөө тооцогддоггүй өдөр. */
  isFreeDay: boolean;
  /** Цайны цонх — чөлөөний минутаас хасна.  Орхивол (хуучин тест) хасахгүй. */
  lunch?: LeaveLunch;
}

export function hhmmToMin(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)/.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function minToHhmm(minutes: number): string {
  const c = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)));
  return `${String(Math.floor(c / 60)).padStart(2, '0')}:${String(c % 60).padStart(2, '0')}`;
}

/** Хоёр огнооны хуанлийн өдрийн тоо (хоёулаа багтсан), доод тал 1. */
export function calendarDays(start: string, end: string): number {
  const s = Date.parse(`${start}T00:00:00Z`);
  const e = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return 1;
  return Math.round((e - s) / 86_400_000) + 1;
}

/** Чөлөөний нэг өдрийн минут — ирцийн хүснэгтийн томьёо. */
export function leaveMinutesPerDay(l: Pick<LeaveOriginal, 'start_date' | 'end_date' | 'hours'>): number {
  if (l.hours == null) return FULL_DAY_LEAVE_MINUTES;
  return Math.round((l.hours / calendarDays(l.start_date, l.end_date)) * 60);
}

export function isMultiDay(l: Pick<LeaveOriginal, 'start_date' | 'end_date'>): boolean {
  return l.end_date > l.start_date;
}

/**
 * Тухайн өдрийн богиносголт.  `null` = богиносгох зүйлгүй (ирцгүй, цонхноос
 * хойш ирсэн, өдрийн дундын чөлөөнөөс өмнө ирсэн, амралтын өдөр г.м.).
 */
export function planDayCut(input: PlanDayCutInput): DayCut | null {
  const { leave, date, arrivalMinutes: a, shift, graceMinutes, isFreeDay } = input;
  const lunch = input.lunch ?? null;
  if (a == null || isFreeDay) return null;
  if (leave.leave_type === 'remote') return null;
  if (date < leave.start_date || date > leave.end_date) return null;
  const multi = isMultiDay(leave);
  if (multi && leave.start_time) return null;

  const full = leaveMinutesPerDay(leave);
  if (full <= 0) return null;

  const timed = !multi && leave.start_time != null;
  const ws = timed ? hhmmToMin(leave.start_time) : shift.startMinutes;
  const we = timed ? hhmmToMin(leave.end_time) : shift.endMinutes;
  if (ws == null || we == null || we <= ws) return null;
  if (a >= we) return null;

  let start: number;
  let used: number;
  if (ws <= shift.startMinutes) {
    // Өдрийн эхэнд эхэлдэг чөлөө: ээлжийн эхлэлээс ирсэн цаг хүртэл.
    start = shift.startMinutes;
    const gap = a - shift.startMinutes;
    used = gap <= graceMinutes ? 0 : leaveWorkMinutes(start, a, lunch);
  } else {
    // Өдрийн дундын чөлөө: зөвхөн цонхон ДОТОР ирсэн бол.
    if (a <= ws) return null;
    start = ws;
    used = leaveWorkMinutes(ws, a, lunch);
  }
  if (used >= full) return null;
  used = Math.max(0, used);
  return {
    date,
    arrival: minToHhmm(a),
    start_time: minToHhmm(start),
    // Цонх нь ирсэн цаг хүртэл (цайг дотроо агуулж болно); 0 бол хоосон цонх.
    end_time: minToHhmm(used === 0 ? start : a),
    full_minutes: full,
    used_minutes: used,
  };
}

/** Мөрт бичих үр дүнгийн утгууд. */
export interface EffectiveLeave {
  start_time: string | null;
  end_time: string | null;
  hours: number | null;
  days: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Анхны утга + өдрүүдийн богиносголт → мөрт бичих утга.  Богиносголтгүй бол
 * анхны утгыг ЯГ буцаана (сэргээлт).
 *   • нэг өдрийн: цаг нь богиносгосон цонх, hours = үлдсэн минут / 60;
 *   • олон хоногийн: цаг хэвээр (NULL), hours/days-аас богиносгосон минутыг хасна.
 */
export function applyCuts(orig: LeaveOriginal, cuts: readonly DayCut[]): EffectiveLeave {
  if (cuts.length === 0) {
    return { start_time: orig.start_time, end_time: orig.end_time, hours: orig.hours, days: orig.days };
  }
  if (!isMultiDay(orig)) {
    const c = cuts[0]!;
    const hours = round2(c.used_minutes / 60);
    return {
      start_time: c.start_time,
      end_time: c.end_time,
      hours,
      days: round2(hours / STANDARD_WORK_DAY_HOURS),
    };
  }
  const saved = cuts.reduce((s, c) => s + Math.max(0, c.full_minutes - c.used_minutes), 0);
  const baseHours = orig.hours ?? orig.days * STANDARD_WORK_DAY_HOURS;
  return {
    start_time: orig.start_time,
    end_time: orig.end_time,
    hours: round2(Math.max(0, baseHours - saved / 60)),
    days: round2(Math.max(0, orig.days - saved / FULL_DAY_LEAVE_MINUTES)),
  };
}

/** «4 цаг», «1 цаг 30 мин», «0 цаг» — мэдэгдлийн бичвэрт. */
export function formatMinutesMn(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0 && r > 0) return `${r} мин`;
  return r === 0 ? `${h} цаг` : `${h} цаг ${r} мин`;
}

/** Ирсэн бүртгэлийн хариунд залгах өгүүлбэр. */
export function describeCut(cut: DayCut): string {
  if (cut.used_minutes === 0) {
    return `Та ажилдаа ирсэн тул өнөөдрийн чөлөө ашиглагдаагүй (0 цаг) гэж тооцогдлоо.`;
  }
  return (
    `Та ${cut.arrival}-д ирсэн тул өнөөдрийн чөлөө ${cut.start_time}–${cut.end_time} ` +
    `(${formatMinutesMn(cut.used_minutes)}) болж богиносголоо; цалин ирсэн цагаас бодогдоно.`
  );
}
