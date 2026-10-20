/**
 * Чөлөөний ЦАГ — цайны цагийг ТООЦОХГҮЙ (2026-10-12).  Сервер ихэр
 * `backend/src/lib/leaveHours.ts` — дүрмийг хамт өөрчил.  Эцсийн тооцоог СЕРВЕР
 * хийнэ (`routes/leaves.ts`), энэ нь зөвхөн формд ижил тоо харуулахад.
 *
 * 09:00–18:00 ээлжтэй хүний 09:16–18:00 чөлөө = 8.73 биш 7.73 цаг: цонх дотор
 * цай (13:00–14:00) байгаа бөгөөд ажлын өдөр нь ээлж − цай = 8 цаг.
 */

/** Цайны цонх, өдрийн минутаар.  `null` = цай хасахгүй / тохиргоо уншаагүй. */
export type LeaveLunch = { start: number; end: number } | null;

/** `GET /leaves/window`-ийн `lunch` талбар. */
export type LeaveLunchWire = { start: string; end: string } | null | undefined;

export function hhmmToMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function minutesToHhmm(minutes: number): string {
  const c = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)));
  return `${String(Math.floor(c / 60)).padStart(2, '0')}:${String(c % 60).padStart(2, '0')}`;
}

export function lunchFromWire(wire: LeaveLunchWire): LeaveLunch {
  if (!wire) return null;
  const start = hhmmToMinutes(wire.start);
  const end = hhmmToMinutes(wire.end);
  return start != null && end != null && end > start ? { start, end } : null;
}

export function lunchOverlapMinutes(start: number, end: number, lunch: LeaveLunch): number {
  if (!lunch) return 0;
  return Math.max(0, Math.min(end, lunch.end) - Math.max(start, lunch.start));
}

/** 'HH:MM'–'HH:MM' цонхны ажлын цаг (2 орон, цай хасна).  Буруу цонх → null. */
export function leaveRangeHours(
  startTime: string | null | undefined,
  endTime: string | null | undefined,
  lunch: LeaveLunch,
): number | null {
  const s = hhmmToMinutes(startTime);
  const e = hhmmToMinutes(endTime);
  if (s == null || e == null || e <= s) return null;
  const work = e - s - lunchOverlapMinutes(s, e, lunch);
  return Math.round((work / 60) * 100) / 100;
}

/** Цонх цайны цагтай давхцаж байгаа эсэх — «цай тооцогдохгүй» тайлбарт. */
export function rangeTouchesLunch(
  startTime: string | null | undefined,
  endTime: string | null | undefined,
  lunch: LeaveLunch,
): boolean {
  const s = hhmmToMinutes(startTime);
  const e = hhmmToMinutes(endTime);
  return s != null && e != null && e > s && lunchOverlapMinutes(s, e, lunch) > 0;
}

/**
 * `time`-аас `hours` АЖЛЫН цаг өнгөрөх ханын цаг 'HH:MM' — цайг алгасна
 * («4 цаг» 11:00-оос → 16:00).  Сервер энэ цонхноос цагийг дахин бодоход яг
 * `hours` гарна.
 */
export function addLeaveWorkHours(time: string, hours: number, lunch: LeaveLunch): string {
  const start = hhmmToMinutes(time);
  if (start == null) return '';
  const w = Math.max(0, Math.round(hours * 60));
  if (w === 0 || !lunch) return minutesToHhmm(start + w);
  let s = start;
  if (s >= lunch.start && s < lunch.end) s = lunch.end;
  let end = s + w;
  if (s < lunch.start && end > lunch.start) end += lunch.end - lunch.start;
  return minutesToHhmm(end);
}
