/**
 * Нэг (ажилтан, өдөр)-т ногдох БҮХ батлагдсан чөлөөг нэгтгэнэ — ирцийн өдрийн
 * хүснэгтийн (`buildDailyAttendanceRows`) чөлөөний ганц эх сурвалж.  Импортгүй
 * цэвэр модуль (тест нь `registerHooks`-гүйгээр ачаална).
 *
 * ⚠️ 2026-10-01 хүртэл хүснэгт өдөрт ЗӨВХӨН ЭХНИЙ чөлөөг (`Array.find`) авдаг
 *    байв.  Нэг өдөр хоёр чөлөөтэй хүний (08:30–12:00 хичээлийн нээлт +
 *    12:00–17:30 цалингүй) хоёр дахь нь «Миний сарын ирц»-д огт харагдаагүй
 *    гомдол ирсэн; прод дээр 2026-06-аас хойш 6 тохиолдол (4 нь 9-р сард).
 *    Алдагдсан чөлөө цалингүй байвал ажилтан ажиллаагүй цагийнхаа кредит авч,
 *    цалинтай байвал авах ёстой цагаа алддаг байв.
 *
 * Дүрэм:
 *   • Нэг чөлөөний тухайн өдрийн минут — хуучин томьёо ХЭВЭЭР: ирсэн цагаар
 *     богиносгосон бол `leave_arrival_cuts.used_minutes` (0 бол тэр өдөр чөлөө
 *     БИШ), үгүй бол `hours / хуанлийн өдөр × 60` (богиносгосон мөрд анхны
 *     `arrival_orig_hours`), `hours` NULL бол бүтэн өдөр.
 *   • Цонх: нэг өдрийн цагтай чөлөө → [start_time, start_time + минут];
 *     цаггүй / олон хоногийн → [ээлжийн эхлэл, ээлжийн эхлэл + минут].
 *   • Цонхнуудын НЭГДЭЛ (union) — давхацсан минут нэг л удаа.  Прод дээр
 *     ээлжийн амралт (ирсэн цагаар 08:00–11:04) ба 08:00–11:00 цалингүй
 *     чөлөө нэг өдөр давхацсан бодит тохиолдол бий; нэмбэл 364 мин болж
 *     ажилтны кредитийг буруугаар хасна.  Давхацсан минут эрт эхэлсэн
 *     (тэнцвэл id бага) чөлөөнд ногдоно.
 *   • Өдрийн нийт чөлөө нэг ажлын өдрөөс (`dayCapMinutes`) хэтрэхгүй.  Хэтэрсэн
 *     хэсэг ихэвчлэн цонхон доторх цайны цаг (08:30–12:00 + 12:00–17:30 = 9 ц)
 *     тул эхлээд ЦАЛИНГҮЙ, дараа нь ээлжийн амралт, эцэст нь цалинтай чөлөөнөөс
 *     (тус бүр орой эхэлснээс нь) хасна — цалинтай цаг хамгийн сүүлд хөндөгдөнө.
 *   • Ганц чөлөөтэй өдөр хуучин утгаа ЯГ буцаана (тест үүнийг барина; прод дээр
 *     2026-06-аас хойш нэг өдөрт 8 цагаас их ногддог ганц чөлөө 0 мөр).
 */

export type DayLeaveType = 'annual' | 'sick' | 'unpaid' | 'remote' | 'other';

export interface DayLeaveRow {
  id: number;
  leave_type: DayLeaveType;
  start_date: string;
  end_date: string;
  start_time: string | null;
  reason: string | null;
  hours: number | null;
  arrival_orig_hours: number | null;
  arrival_orig_days: number | null;
  /** `leave_requests.is_paid` — 1 цалинтай, 0 цалингүй, NULL хуучин бичлэг. */
  is_paid?: number | null;
}

export interface DayLeavePart {
  leave_id: number;
  leave_type: DayLeaveType;
  /** Цалинтай эсэх (0/1/NULL) — «Бусад» төрлийн chip-ийн өнгийг л шийднэ, цагийн бодолтод нөлөөгүй. */
  is_paid: number | null;
  reason: string | null;
  /** Тухайн өдрийн цонх 'HH:MM'. */
  start_time: string;
  end_time: string;
  /** Энэ чөлөөний өөрийн минут (давхцал, таазаас өмнө). */
  minutes: number;
  /** Нийлбэрт орсон минут (давхцал + тааз хассаны дараа). */
  counted_minutes: number;
}

export interface DayLeaves {
  /** Цонхны эхлэлээр эрэмбэлсэн. */
  parts: DayLeavePart[];
  /** Өдрийн нийт чөлөө (нэгдэл, таазтай). */
  minutes: number;
  annualMinutes: number;
  /** Цалинтай чөлөө — цалингүй ба ээлжийн амралтаас бусад (remote орно). */
  paidMinutes: number;
  /** Хамгийн их минут ногдсон хэсэг (тэнцвэл эрт) — хуучин `leave_type`/`leave_reason` талбарт. */
  primary: DayLeavePart | null;
}

export interface CombineDayLeavesInput {
  /** Тухайн өдрийг хамарсан батлагдсан чөлөөнүүд (амралт/баярын өдөр бол хоосон). */
  leaves: readonly DayLeaveRow[];
  date: string;
  shiftStartMinutes: number;
  /** Ирсэн цагаар богиносгосон минут, `undefined` = богиносголтгүй. */
  cutMinutes: (leaveId: number, date: string) => number | undefined;
  dayCapMinutes: number;
}

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)/;

function hhmmToMin(hhmm: string | null): number | null {
  if (!hhmm) return null;
  const m = HHMM_RE.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function minToHhmm(minutes: number): string {
  const c = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  return `${String(Math.floor(c / 60)).padStart(2, '0')}:${String(c % 60).padStart(2, '0')}`;
}

/** `routes/attendance.ts`-ийн `calDaysInclusive`-тэй ИЖИЛ. */
function calDaysInclusive(start: string, end: string): number {
  const s = new Date(start + 'T00:00:00Z').getTime();
  const e = new Date(end + 'T00:00:00Z').getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return 1;
  return Math.round((e - s) / 86_400_000) + 1;
}

/** Нэг чөлөөний тухайн өдрийн минут — хүснэгтийн хуучин томьёо. */
export function leaveMinutesOnDay(
  leave: DayLeaveRow,
  date: string,
  cutMinutes: CombineDayLeavesInput['cutMinutes'],
  dayCapMinutes: number,
): number {
  const cut = cutMinutes(leave.id, date);
  if (cut !== undefined) return cut;
  const base = leave.arrival_orig_days != null ? leave.arrival_orig_hours : leave.hours;
  if (base == null) return dayCapMinutes;
  return Math.round((base / Math.max(1, calDaysInclusive(leave.start_date, leave.end_date))) * 60);
}

/** Цалингүй эсэх: `leave_type = 'unpaid'` ЭСВЭЛ мөрийн `is_paid = 0`
 *  (2026-10-13-аас «Өвчтэй» чөлөө `leave_type = 'sick'` атлаа цалингүй).
 *  `is_paid` NULL (хуучин мөр) бол зөвхөн төрлөөр. */
function isUnpaid(type: DayLeaveType, isPaid: number | null | undefined): boolean {
  return type === 'unpaid' || isPaid === 0;
}

/** Хэтэрсэн минутыг хасах дараалал: цалингүй → ээлжийн амралт → цалинтай. */
function trimRank(type: DayLeaveType, isPaid: number | null | undefined): number {
  if (isUnpaid(type, isPaid)) return 0;
  if (type === 'annual') return 1;
  return 2;
}

export function combineDayLeaves(input: CombineDayLeavesInput): DayLeaves {
  const { leaves, date, shiftStartMinutes, cutMinutes, dayCapMinutes } = input;

  const raw = leaves
    .map((lv) => {
      const minutes = leaveMinutesOnDay(lv, date, cutMinutes, dayCapMinutes);
      const timedStart =
        lv.start_date === lv.end_date ? hhmmToMin(lv.start_time) : null;
      const start = timedStart ?? shiftStartMinutes;
      return { lv, minutes, start, end: start + Math.max(0, minutes) };
    })
    // Ирсэн цагаар 0 болтол богиносгосон чөлөө тэр өдөр чөлөө БИШ (0364).
    .filter((x) => cutMinutes(x.lv.id, date) !== 0)
    .sort((a, b) => a.start - b.start || a.lv.id - b.lv.id);

  // Нэгдэл: эрэмбэлсэн цонх бүр өмнөх нэгдэлтэй давхцаагүй хэсгээрээ л тоологдоно.
  const covered: Array<[number, number]> = [];
  const parts: DayLeavePart[] = raw.map(({ lv, minutes, start, end }) => {
    let overlap = 0;
    for (const [cs, ce] of covered) overlap += Math.max(0, Math.min(end, ce) - Math.max(start, cs));
    covered.push([start, end]);
    covered.sort((a, b) => a[0] - b[0]);
    // Хамрагдсан интервалуудыг нэгтгэж давхардсан давхцлыг дахин тоолохгүй.
    for (let i = covered.length - 1; i > 0; i -= 1) {
      const prev = covered[i - 1]!;
      const cur = covered[i]!;
      if (cur[0] <= prev[1]) {
        prev[1] = Math.max(prev[1], cur[1]);
        covered.splice(i, 1);
      }
    }
    return {
      leave_id: lv.id,
      leave_type: lv.leave_type,
      is_paid: lv.is_paid ?? null,
      reason: lv.reason,
      start_time: minToHhmm(start),
      end_time: minToHhmm(end),
      minutes,
      counted_minutes: Math.max(0, minutes - overlap),
    };
  });

  let total = parts.reduce((s, p) => s + p.counted_minutes, 0);
  if (total > dayCapMinutes) {
    let surplus = total - dayCapMinutes;
    const order = parts
      .map((p, i) => ({ p, i }))
      .sort(
        (a, b) =>
          trimRank(a.p.leave_type, a.p.is_paid) - trimRank(b.p.leave_type, b.p.is_paid) ||
          b.i - a.i,
      );
    for (const { p } of order) {
      if (surplus <= 0) break;
      const take = Math.min(surplus, p.counted_minutes);
      p.counted_minutes -= take;
      surplus -= take;
    }
    total = dayCapMinutes;
  }

  let annualMinutes = 0;
  let paidMinutes = 0;
  let primary: DayLeavePart | null = null;
  for (const p of parts) {
    if (isUnpaid(p.leave_type, p.is_paid)) {
      // цалингүй — ажилласан цагт нэмэгдэхгүй
    } else if (p.leave_type === 'annual') annualMinutes += p.counted_minutes;
    else paidMinutes += p.counted_minutes;
    if (!primary || p.counted_minutes > primary.counted_minutes) primary = p;
  }

  return { parts, minutes: total, annualMinutes, paidMinutes, primary };
}
