// Ирцийн өдрийн хүснэгтийн (buildDailyAttendanceRows) хоцролтын ХӨНГӨЛӨЛТ —
// цайны цонх ба батлагдсан гадуур ажлын цонхнуудаар хоцролтын минутыг хасна.
// Импортгүй цэвэр модуль (тест нь `registerHooks`-гүйгээр ачаална).
//
// Дүрэм:
//   • Хоцролтын завсар = [effStart, ирсэн цаг]; effStart = ээлжийн эхлэл
//     (чөлөөтэй өдөр чөлөөний минутаар хойшилсон).
//   • Цайны цонх ба гадуур ажлын цонх тэр завсартай ДАВХЦСАН хэсгээрээ л
//     хасагдана, НЭГДЛЭЭР (union) — давхцсан минут хоёр удаа цуцлагдахгүй.
//   • Үдээс хойшхи (ирсний ДАРАА эхэлсэн) гадуур ажил өглөөний хоцролтыг
//     цуцлахгүй (2026-08-03-ны хүсэлт).
//   • ⚠️ Өдрийн АНХНЫ гадуур ажил ирэхээс ӨМНӨ эхэлсэн бол (гэрээсээ шууд
//     явсан) ээлжийн эхлэлээс тэр гадуур ажлын эхлэл хүртэлх зай хоцролт БИШ
//     (2026-09-29, эзэн: 08:00 ээлжтэй хүн 09:00–14:00 гадуур ажилтай, 12:53-д
//     ирэхэд «хоцорсон 60» гарч байв — 08:00–09:00 нь гадуур ажил руу явсан
//     зам).  `lib/leaveWaiver.ts`-ийн `LATE_NOT_WAIVED_SQL` (тайлан, онооны
//     самбар, my-status) аль хэдийн ийм гадуур ажлыг бүтэн цуцалдаг байсан тул
//     хүснэгт тэдэнтэй зөрж байв.  Гадуур ажил дууссанаас ирэх хүртэлх зай
//     хэвээр хоцролт.
//   • Цаг заагаагүй (start/end хоосон) гадуур ажил эсвэл ирсэн цаг уншигдаагүй
//     бол хуучин журмаар БҮТЭН цуцална (`blanket`).

export interface OooSpan {
  start_time: string | null;
  end_time: string | null;
}

/** 'HH:mm' → өдрийн минут (12:47 → 767). */
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Хагас нээлттэй [start, end) интервалуудын НЭГДЛИЙН (union) урт, минутаар.
 * Давхцсан хэсгийг ЗӨВХӨН НЭГ УДАА тоолно.
 */
export function unionLengthMinutes(spans: Array<[number, number]>): number {
  if (spans.length === 0) return 0;
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [curStart, curEnd] = sorted[0]!;
  for (let i = 1; i < sorted.length; i += 1) {
    const [s, e] = sorted[i]!;
    if (s > curEnd) {
      total += curEnd - curStart;
      curStart = s;
      curEnd = e;
    } else if (e > curEnd) {
      curEnd = e;
    }
  }
  return total + (curEnd - curStart);
}

export interface LateWaiverInput {
  /** Түүхий хоцролт (минут). 0 бол хөнгөлөлт тооцохгүй. */
  rawLate: number;
  /** Ирсэн цаг 'HH:mm', уншигдаагүй бол null. */
  actualIn: string | null;
  /** Хоцролтын завсрын эхлэл (өдрийн минут). */
  effStartMin: number;
  /** Цайны цонх ('HH:mm' хос), идэвхгүй бол null. */
  lunch: { start: string; end: string } | null;
  /** Тухайн өдрийн батлагдсан гадуур ажлууд. */
  ooo: OooSpan[];
}

export function lateWaiver(input: LateWaiverInput): { waiverMinutes: number; blanket: boolean } {
  const { rawLate, actualIn, effStartMin, lunch, ooo } = input;
  if (rawLate <= 0) return { waiverMinutes: 0, blanket: false };
  // Ирсэн цаг уншигдаагүй бол давхцал бодох боломжгүй — хуучин журмаар.
  if (!actualIn) return { waiverMinutes: 0, blanket: ooo.length > 0 };

  const arriveMin = hhmmToMinutes(actualIn);
  const spans: Array<[number, number]> = [];
  const clipToLateWindow = (startMin: number, endMin: number) => {
    const from = Math.max(effStartMin, startMin);
    const to = Math.min(arriveMin, endMin);
    if (to > from) spans.push([from, to]);
  };
  if (lunch) clipToLateWindow(hhmmToMinutes(lunch.start), hhmmToMinutes(lunch.end));

  let blanket = false;
  const timed: Array<[number, number]> = [];
  for (const e of ooo) {
    if (!e.start_time || !e.end_time) {
      blanket = true;
      continue;
    }
    timed.push([hhmmToMinutes(e.start_time), hhmmToMinutes(e.end_time)]);
  }
  // Ирэхээс өмнө эхэлсэн хамгийн эртний гадуур ажил — өдөр түүгээр эхэлсэн
  // тул ээлжийн эхлэлээс тэр хүртэлх зам хоцролт биш.
  const morningIdx = timed.reduce<number>(
    (best, [s], i) => (s < arriveMin && (best < 0 || s < timed[best]![0]) ? i : best),
    -1,
  );
  timed.forEach(([s, e], i) => clipToLateWindow(i === morningIdx ? effStartMin : s, e));

  return { waiverMinutes: unionLengthMinutes(spans), blanket };
}
