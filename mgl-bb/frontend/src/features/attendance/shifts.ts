/**
 * Ажлын ээлжийн ГАНЦ эх сурвалж (frontend тал).
 *
 * ⚠️ 2026-08-26 хүртэл ээлжийн хүснэгт frontend дээр ДӨРВӨН хувь байсан —
 *    `AttendancePage.tsx`, `AttendanceWidget.tsx`, `AttendanceProjectDialog.tsx`
 *    ба `useWorkStartReminder.ts` (сүүлийнх нь ternary).  Гурван өөр бичиглэл
 *    ('09:00 – 18:00', '09:00–18:00', '09-18') зэрэг оршиж байв.  Гурав дахь
 *    ээлж нэмэгдсэнээр тэр давхардал алдааны эх үүсвэр болох тул энд нэгтгэв.
 *
 * ⚠️ ЦАГ нь эцсийн эцэст СЕРВЕРИЙНХ: backend `lib/orgConfig.ts` нь
 *    `ORG_SHIFT_*` env / `app_settings['org.shift_*']`-ээр ээлжийн цагийг
 *    солиж чадна.  Тиймээс `/attendance/my-status` нь `schedule_options`
 *    буцаадаг ба UI ТҮҮНИЙГ эрхэмлэнэ.  Доорх `FALLBACK_LABEL` нь зөвхөн
 *    хариу ирээгүй/хуучин кэштэй үеийн нөөц.
 */
import type { ComponentType } from 'react';
import { Sunrise, Coffee, Backpack } from 'lucide-react';
import type { ScheduleKey } from '@/shared/types';

export type { ScheduleKey };

/** Дэлгэцийн дараалал — өглөө эртээс хойш.  Backend `SCHEDULE_KEYS`-тэй ижил. */
export const SHIFT_KEYS: readonly ScheduleKey[] = ['early', 'mid', 'standard'];

export interface ShiftOption {
  key: ScheduleKey;
  /** '08:30 – 17:30' — сервер өгсөн бол түүнийх. */
  label: string;
  /** '8–17' маягийн богино хэлбэр (виджетийн нарийн товчинд). */
  short: string;
  /** i18n түлхүүр — товчны доод тайлбар. */
  subKey: string;
  icon: ComponentType<{ className?: string }>;
}

/** Сервер хариу өгөөгүй үеийн нөөц шошго (MGL-ийн дефолт цаг). */
const FALLBACK: Record<ScheduleKey, { label: string; short: string }> = {
  early: { label: '08:00 – 17:00', short: '8–17' },
  mid: { label: '08:30 – 17:30', short: '8:30–17:30' },
  standard: { label: '09:00 – 18:00', short: '9–18' },
};

const META: Record<ScheduleKey, { subKey: string; icon: ShiftOption['icon'] }> = {
  early: { subKey: 'attendanceShift.earlySub', icon: Sunrise },
  // Хүүхдээ цэцэрлэг/сургуульд хүргэдэг ажилтны сонголт.
  mid: { subKey: 'attendanceShift.midSub', icon: Backpack },
  standard: { subKey: 'attendanceShift.standardSub', icon: Coffee },
};

/** 'HH:MM' хосоос богино шошго гаргана: 08:00–17:00 → '8–17',
 *  08:30–17:30 → '8:30–17:30' (минут алдагдвал ээлжүүд ялгагдахгүй болно). */
function shortOf(start: string, end: string): string {
  const trim = (t: string) => (t.endsWith(':00') ? String(parseInt(t.slice(0, 2), 10)) : t);
  return `${trim(start)}–${trim(end)}`;
}

/**
 * Picker-т үзүүлэх ээлжүүд.  `serverOptions` нь
 * `AttendanceStatus.schedule_options` — байвал шошгыг ТҮҮНЭЭС авна.
 */
export function shiftOptions(
  serverOptions?: Array<{ key: ScheduleKey; label: string; start: string; end: string }> | null,
): ShiftOption[] {
  const byKey = new Map((serverOptions ?? []).map((o) => [o.key, o]));
  // Сервер жагсаалт өгсөн бол ТҮҮНИЙ дарааллыг мөрдөнө (шинэ ээлж нэмэгдвэл
  // frontend засахгүйгээр гарч ирнэ); эс бөгөөс дефолт гурав.
  const keys: ScheduleKey[] =
    serverOptions && serverOptions.length > 0
      ? serverOptions.map((o) => o.key).filter((k): k is ScheduleKey => k in META)
      : [...SHIFT_KEYS];

  return keys.map((key) => {
    const srv = byKey.get(key);
    return {
      key,
      label: srv?.label ?? FALLBACK[key].label,
      short: srv ? shortOf(srv.start, srv.end) : FALLBACK[key].short,
      subKey: META[key].subKey,
      icon: META[key].icon,
    };
  });
}

/** Нэг ээлжийн шошго (сервер өгснийг эрхэмлэнэ). */
export function shiftLabel(
  key: ScheduleKey | undefined,
  serverOptions?: Array<{ key: ScheduleKey; label: string }> | null,
): string {
  const k = key ?? 'standard';
  return (serverOptions ?? []).find((o) => o.key === k)?.label ?? FALLBACK[k]?.label ?? '';
}

/** Ээлж эхлэх минут — `useWorkStartReminder`-ийн нөөц утга. */
export const SHIFT_START_MINUTES: Record<ScheduleKey, number> = {
  early: 8 * 60,
  mid: 8 * 60 + 30,
  standard: 9 * 60,
};

/** Ээлж дуусах минут — сервер `schedule_options` өгөөгүй үеийн нөөц. */
const SHIFT_END_MINUTES: Record<ScheduleKey, number> = {
  early: 17 * 60,
  mid: 17 * 60 + 30,
  standard: 18 * 60,
};

function minutesOfHHMM(t: string | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(t ?? '');
  if (!m) return null;
  return parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10);
}

/** Ажилтны ӨНӨӨДРИЙН ээлж дуусах минут (УБ, шөнө дундаас).  Сервер өгсөн
 *  `end` ('17:30')-ийг эрхэмлэнэ, байхгүй бол MGL-ийн дефолт. */
export function shiftEndMinutes(
  key: ScheduleKey | undefined,
  serverOptions?: Array<{ key: ScheduleKey; end: string }> | null,
): number {
  const k = key ?? 'standard';
  const srv = (serverOptions ?? []).find((o) => o.key === k);
  return minutesOfHHMM(srv?.end) ?? SHIFT_END_MINUTES[k] ?? 18 * 60;
}

/** УБ-ийн одоогийн цаг, шөнө дундаас хойших минутаар (UTC+8, DST-гүй). */
export function ubMinutesNow(now: Date = new Date()): number {
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const ub = new Date(utcMs + 8 * 60 * 60_000);
  return ub.getHours() * 60 + ub.getMinutes();
}

/**
 * «Үдээс хойш» popup-ыг АВТОМАТААР нээх цонх дуусах минут.
 *
 * ⚠️ Яагаад ээлж дуусахаас 60 минутын өмнө зогсдог вэ (2026-09-16).
 *    Урьд нь 14:00-аас хойш ХЭЗЭЭ Ч ирц хуудсыг нээхэд «Үдээс хойш
 *    ажиллах төслөө сонгоно уу» popup автоматаар гарч ирдэг байв — 17:00-д
 *    ГАРАХ гэж орж ирсэн ажилтан тэр popup-ыг бөглөж «амжилттай» гэдгийг
 *    хараад гарлаа гэж ойлгож явдаг, харин session нээлттэй үлдэж маргааш
 *    нь «гарсан бүртгэлээ хийгээгүй» гэж түгжигддэг байсан.  Прод: 09-02,
 *    09-03, 09-09, 09-11-нд `afternoon` checkpoint 16:18–17:27-д бүртгэгдээд
 *    гарсан бүртгэл алга (`attendance.ts`-ийн тайлбар).  Ажил тарах цагт
 *    ойртсон бол popup-ыг тулгахгүй — ажилтан «Гарах» товчоо л дарна.
 */
export function afternoonAutoPromptEndsAt(
  key: ScheduleKey | undefined,
  serverOptions?: Array<{ key: ScheduleKey; end: string }> | null,
): number {
  return shiftEndMinutes(key, serverOptions) - 60;
}

/**
 * Огноог хүн уншихаар: mn → «2026 оны 9-р сарын 1», en → «1 Sep 2026».
 * ⚠️ `Intl`-ийн `mn` локал нь орчноос хамаарч «2026/9/1» гэж гардаг тул
 *    гараар угсарна — мэдэгдэл нь бүх төхөөрөмж дээр ижил уншигдах ёстой.
 */
export function formatShiftDate(date: string, lang: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const [, y, mm, dd] = m;
  const month = parseInt(mm!, 10);
  const day = parseInt(dd!, 10);
  if (lang === 'en') {
    const names = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return `${day} ${names[month - 1] ?? mm} ${y}`;
  }
  return `${y} оны ${month}-р сарын ${day}`;
}
