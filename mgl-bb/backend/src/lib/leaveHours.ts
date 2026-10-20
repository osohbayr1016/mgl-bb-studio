/**
 * Чөлөөний ЦАГ — цайны цагийг ТООЦОХГҮЙ (2026-10-12, эзний хүсэлт).  Импортгүй
 * цэвэр модуль; frontend ихэр `features/attendance/leaveHours.ts` — хамт өөрчил.
 *
 * Гомдол: 09:00–18:00 ээлжтэй ажилтан 09:16–18:00 чөлөө хүсэхэд «8 цагаас
 * хэтэрч болохгүй — 8.73 цаг» гэж татгалздаг байв.  Цонх дотор цай (13:00–14:00)
 * байгаа тул бодит ажлын цаг 7ц 44м.  Ажлын өдөр = ээлж − цай = 8 цаг, тиймээс
 * чөлөө ч ЯГ тэр хэмжүүрээр: цонх − цайны цонхтой давхцсан хэсэг.
 *
 * Хэрэглэгчид:
 *   • `routes/leaves.ts` — хүсэлтийн `hours` (+ 8 цагийн тааз);
 *   • `lib/leaveArrivalCut.ts` — ирсэн цагаар богиносгосон минут;
 *   • `routes/attendance.ts` — «чөлөө хэдэн цагт дуусах вэ» (хоцролтын суурь):
 *     чөлөөний минут цай хассан тул ээлжийн эхлэл дээр цайг АЛГАСАЖ нэмнэ,
 *     эс бөгөөс 09:00–14:30 чөлөөтэй, 14:30-д ирсэн хүн 30 мин хоцорсон болно.
 */

/** Цайны цонх, өдрийн минутаар.  `null` = цай хасахгүй (тохиргоогоор унтарсан). */
export type LeaveLunch = { start: number; end: number } | null;

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)/;

export function leaveHhmmToMin(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const m = HHMM_RE.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** [start, end) ба цайны цонхны давхцал (минут). */
export function lunchOverlapMinutes(start: number, end: number, lunch: LeaveLunch): number {
  if (!lunch) return 0;
  return Math.max(0, Math.min(end, lunch.end) - Math.max(start, lunch.start));
}

/** [start, end) доторх АЖЛЫН минут = нийт − цай. */
export function leaveWorkMinutes(start: number, end: number, lunch: LeaveLunch): number {
  const gross = Math.max(0, end - start);
  return gross - lunchOverlapMinutes(start, end, lunch);
}

/**
 * 'HH:MM'–'HH:MM' цонхны ажлын цаг (2 орон), цай хасна.  Буруу / дуусах ≤
 * эхлэх → `null`.  Цонх бүхэлдээ цайны цаг дотор бол 0.
 */
export function leaveRangeHours(
  startTime: string | null | undefined,
  endTime: string | null | undefined,
  lunch: LeaveLunch,
): number | null {
  const s = leaveHhmmToMin(startTime);
  const e = leaveHhmmToMin(endTime);
  if (s == null || e == null || e <= s) return null;
  return Math.round((leaveWorkMinutes(s, e, lunch) / 60) * 100) / 100;
}

/**
 * `startMin`-ээс `workMinutes` ажлын минут өнгөрөх ханын цаг — цайны цонхыг
 * алгасна.  Цайны үеэр эхэлбэл цай дууссанаас тоолно.  «4 цаг» сонголтын
 * дуусах цаг (11:00 + 4ц → 16:00) ба хоцролтын суурь хоёулаа үүгээр.
 */
export function addLeaveWorkMinutes(startMin: number, workMinutes: number, lunch: LeaveLunch): number {
  const w = Math.max(0, Math.round(workMinutes));
  if (w === 0 || !lunch || lunch.end <= lunch.start) return startMin + w;
  let s = startMin;
  if (s >= lunch.start && s < lunch.end) s = lunch.end;
  const end = s + w;
  if (s < lunch.start && end > lunch.start) return end + (lunch.end - lunch.start);
  return end;
}
