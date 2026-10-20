/**
 * Ажилтны ӨДРИЙН ДУНДАЖ бүтээмж — ГАНЦ газар (эзний дүрэм, 2026-09-28).
 *
 * Эзний үг: «Шинэ хүн ажилд орлоо гэхэд тэр өдөр хийсэн ажил нь тэр өдрийн
 * хувь болж, маргааш нь 2 өдрийн дундаж — 30 хоногийн дундаж БИШ, ажилласан
 * өдрийн дундажаар явна.  Ээлжийн амралтаа 7 хоног аваад ирсэн хүн сүүлийн
 * 30 хоногийн дундаж БИШ — амралтаас өмнөх хувиасаа үргэлжилж, сүүлд
 * ажилласан өдрүүдийн дундаж болно.»
 *
 *     өдрийн дундаж = Σ оноо [from, to] ÷ тоологдсон ажлын өдөр
 *
 * Тоологдсон өдөр = хүний СҮҮЛИЙН K АЖИЛЛАСАН өдөр; K = хуанлийн цонхны
 * ажлын өдөр, ТОГТМОЛ: round(N × 5/7) — «30 хоног» = 21, «90» = 64 (хуучин
 * ханшийн хуваарь 21.43 / 64.29-тэй ижил хэмжээ).  Тогтмол тул K нь гараг,
 * баярын өдрөөс хамаарч 21/22 болж хэлбэлзэхгүй — амралтын үеэр дундаж ЯГ
 * хөлдөнө.  `to`-оос ухарч:
 *   • Бямба/Ням, `holidays` — хуваарьт тоологдохгүй (тэр өдөр авсан оноо
 *     нийлбэрт орно — `teamProductivity.ts`-тэй ижил);
 *   • батлагдсан БҮТЭН өдрийн чөлөө (ээлжийн амралт, өвчтэй …) — алгасна,
 *     оронд нь ӨМНӨХ ажлын өдөр орно, тиймээс амралтын үеэр дундаж хөлдөж,
 *     ирсний дараа тэндээсээ үргэлжилнэ.  Чөлөөний тодорхойлолт
 *     `leaveAvailability.ts`-ийнх (цагаар авсан, `remote` нь чөлөө биш; чөлөөт
 *     өдөр бодитоор оноо авсан бол энгийн ажлын өдөр);
 *   • ажилд орсон өдрөөс (`users.created_at`, УБ) өмнө — ЗОГСОНО: 3 хоногийн
 *     өмнө орсон хүн 3 өдөрт хуваагдана, 30 хоногийн дараа ердийн цонх;
 *   • дуусаагүй өдөр (өнөөдөр / `asOf`-ийн өдөр) — оноо авсан бол л
 *     тоологдоно; эс бөгөөс цонх өчигдрөөр төгсөнө.  Эс тэгвэл шинэ хүний
 *     2 дахь өглөө дундаж нь хагас болж унана.
 *   Чөлөөгүй тасалсан ажлын өдөр 0 оноотой тоологдсон өдөр хэвээр.
 *
 * Хуурамч оноо ҮҮСГЭХГҮЙ, ledger хөндөхгүй — зөвхөн аль өдрүүдийг тоолж,
 * юунд хуваахыг сонгоно.  Бүрэн түүхтэй, чөлөөгүй хүнд утга нь сүүлийн 21
 * ажлын өдрийн нийлбэр ÷ 21 (≈ 30 хоног).
 *
 * НИЙЛБЭР («30 хоногийн бүтээмж %», эрэмбэ) энэ файлд хамаарахгүй — тэд
 * `leaveAvailability.ts` `loadLeaveNeutral`-аар хэвээр.  Энэ файл зөвхөн
 * ӨДРИЙН ДУНДАЖ: онооны самбарын «Өдрийн дундаж», тайлангийн «Өдрийн
 * дундаж», засвар / төслийн бус ажлын ханш (`repairProgress.ts`
 * `baseDailyRate`).  Багийн профайлын «Бүтээмж» таб нь хуанлийн хугацааны
 * (өдөр/7 хоног/сар) дундаж — `teamProductivity.ts` `memberAverage`, ижил
 * зарчимтай (орсон өдрөөс, чөлөө хассан).
 */
import { addDays, isWeekend } from './workSchedule';
import { getHolidaySet } from './holidays';
import { todayInUB } from './time';
import { orgUtcOffsetMinutes, sqliteOffsetModifier, ubDayBoundsUtc } from './reportWindows';
import {
  APPROVED_LEAVE_OVERLAP_SQL,
  MAX_LOOKBACK_DAYS,
  leaveDatesByUser,
  type ApprovedLeaveRow,
  type DateRange,
} from './leaveAvailability';

export interface DailyAverage {
  /** Σ оноо — [from, to] (тоологдоогүй амралтын өдрийн оноо ч орно). */
  points: number;
  /** Хуваарь — тоологдсон ажлын өдрийн тоо. */
  days: number;
  /** K — нэрлэсэн цонхны ажлын өдөр.  `days < target` = шинэ хүн. */
  target: number;
  /** `days` = 0 бол null (ажилд орсон өдрөө ч хараахан ажиллаагүй). */
  avg: number | null;
  /** Алгассан батлагдсан чөлөөт ажлын өдөр. */
  leaveDays: number;
  /** Цонх ажилд орсон өдрөөр таслагдсан (K хүрээгүй). */
  sinceJoined: boolean;
  /** Хамгийн хуучин тоологдсон өдөр (null = тоологдсон өдөргүй). */
  from: string | null;
  to: string;
}

export interface DailyAverageInput {
  /** Цонхны сүүлийн өдөр (УБ). */
  to: string;
  /** Нэрлэсэн цонхны урт, хуанлийн өдрөөр (30, 90). */
  calendarDays: number;
  /** Ажилд орсон УБ огноо (null = мэдэгдэхгүй, таслахгүй). */
  joined: string | null;
  /** УБ огноо → оноо.  > 0 бол тэр өдөр «ажилласан». */
  daily: ReadonlyMap<string, number> | undefined;
  /** Батлагдсан бүтэн өдрийн чөлөөтэй АЖЛЫН огноонууд (`leaveDatesByUser`). */
  leave: ReadonlySet<string> | undefined;
  holidays: ReadonlySet<string>;
  /** `to` өдөр дуусаагүй — оноо авсан бол л тоологдоно. */
  openDay: boolean;
  maxLookbackDays?: number;
}

function isWorkingDay(d: string, holidays: ReadonlySet<string>): boolean {
  return !isWeekend(d) && !holidays.has(d);
}

/** Хуанлийн N хоногт ноогдох ажлын өдөр (K) — тогтмол, долоо хоногт 5. */
export function workDaysTarget(calendarDays: number): number {
  return Math.max(1, Math.round((calendarDays * 5) / 7));
}

/** ЦЭВЭР: нэг хүний нэг цонхны өдрийн дундаж (файлын толгойн дүрэм). */
export function computeDailyAverage(i: DailyAverageInput): DailyAverage {
  const target = workDaysTarget(i.calendarDays);
  const worked = (d: string) => (i.daily?.get(d) ?? 0) > 0;
  const limit = addDays(i.to, -(i.calendarDays - 1) - (i.maxLookbackDays ?? MAX_LOOKBACK_DAYS));

  let days = 0;
  let leaveDays = 0;
  let from: string | null = null;
  let sinceJoined = false;
  for (let d = i.to; days < target && d >= limit; d = addDays(d, -1)) {
    if (i.joined && d < i.joined) {
      sinceJoined = true;
      break;
    }
    if (!isWorkingDay(d, i.holidays)) continue;
    if (d === i.to && i.openDay && !worked(d)) continue;
    if (i.leave?.has(d) && !worked(d)) {
      leaveDays += 1;
      continue;
    }
    days += 1;
    from = d;
  }

  let points = 0;
  if (from && i.daily) for (const [d, v] of i.daily) if (d >= from && d <= i.to) points += v;
  return { points, days, target, avg: days > 0 ? points / days : null, leaveDays, sinceJoined, from, to: i.to };
}

/** UTC `YYYY-MM-DD HH:MM:SS` агшин → байгууллагын цагийн бүсийн огноо. */
export function orgDateOfUtc(at: string): string {
  const t = new Date(`${at.slice(0, 19).replace(' ', 'T')}Z`);
  if (Number.isNaN(t.getTime())) return at.slice(0, 10);
  return new Date(t.getTime() + orgUtcOffsetMinutes(t) * 60_000).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/*  Ачаалагч                                                           */
/* ------------------------------------------------------------------ */

export interface DailyAverageWindow {
  /** Хуанлийн өдөр (30, 90). */
  days: number;
  /** Энэ цонхыг бодох хүмүүс. */
  userIds: readonly number[];
}

export interface DailyAverageOptions {
  windows: readonly DailyAverageWindow[];
  /**
   * Хэзээгийн байдлаар.  Өгөөгүй = одоо (өнөөдөр дуусаагүй).  UTC агшин
   * (`YYYY-MM-DD HH:MM:SS`) = тэр мөч хүртэлх оноо, тэр өдөр дуусаагүй
   * (нөхөн тооцоолол: «тэр үед мэдэгдэж байсан» дундаж).
   */
  asOf?: string | null;
  /** Хаалттай УБ өдөр хүртэл (тайлангийн anchor).  Өнөөдөр бол дуусаагүй. */
  through?: string;
  /** `user_points` дээрх утга (alias-гүй).  Өгөгдмөл `amount`. */
  expr?: string;
  /** Нэмэлт WHERE (alias-гүй). */
  where?: string;
  /** Дуудагч аль хэдийн уншсан ажилд орсон огноо — дутуу id-г энд уншина. */
  joined?: ReadonlyMap<number, string | null>;
}

export interface DailyAverages {
  to: string;
  /** Тухайн цонхны хүн амд байхгүй бол null. */
  get(userId: number, windowIndex?: number): DailyAverage | null;
}

/** Урт чөлөөтэй цөөн хүний оноог тусад нь уншина — бусдын мөрийг жилээр уншихгүй. */
const LONG_SPAN_MARGIN_DAYS = 14;

export async function loadDailyAverages(db: D1Database, opts: DailyAverageOptions): Promise<DailyAverages> {
  const today = todayInUB();
  const to = opts.asOf ? orgDateOfUtc(opts.asOf) : (opts.through ?? today);
  const openDay = opts.asOf ? true : to >= today;
  const offset = orgUtcOffsetMinutes(new Date(`${to}T12:00:00Z`));
  const untilUtc = opts.asOf ?? ubDayBoundsUtc(to, to, offset).endUtcExclusive;

  const byWindow = opts.windows.map((w) => new Set(w.userIds.map((n) => Math.trunc(n))));
  const ids = [...new Set(byWindow.flatMap((s) => [...s]))];
  const empty: DailyAverages = { to, get: () => null };
  if (ids.length === 0 || opts.windows.length === 0) return empty;

  const maxDays = Math.max(...opts.windows.map((w) => w.days));
  const outer: DateRange = { from: addDays(to, -(maxDays - 1) - MAX_LOOKBACK_DAYS), to };
  const missing = ids.filter((id) => !opts.joined?.has(id));
  const [joinedRes, leaveRes, holidays] = await Promise.all([
    missing.length > 0
      ? db
          .prepare(`SELECT id, date(created_at, ?) AS joined FROM users WHERE id IN (${missing.join(',')})`)
          .bind(sqliteOffsetModifier(offset))
          .all<{ id: number; joined: string | null }>()
      : Promise.resolve({ results: [] as { id: number; joined: string | null }[] }),
    db.prepare(APPROVED_LEAVE_OVERLAP_SQL).bind(outer.to, outer.from).all<ApprovedLeaveRow>(),
    getHolidaySet(db, outer.from, outer.to),
  ]);
  const joined = new Map<number, string | null>(opts.joined ?? []);
  for (const r of joinedRes.results ?? []) joined.set(Number(r.id), r.joined ?? null);
  const idSet = new Set(ids);
  const leave = leaveDatesByUser(
    (leaveRes.results ?? []).filter((l) => idSet.has(l.user_id)),
    outer,
    holidays,
  );

  // Хүн бүрийн хэрэгтэй хамгийн эрт өдөр — оноогүй гэж үзвэл цонх хамгийн
  // хол ухарна (бүх чөлөөт өдөр алгасагдаж, өнөөдөр тоологдохгүй).  Өнөөдөр
  // орсон хүнд тоологдох өдөр гарахгүй ч өнөөдрийн оноог унших ёстой.
  const need = new Map<number, string>();
  opts.windows.forEach((w, i) => {
    for (const id of byWindow[i]!) {
      const j = joined.get(id) ?? null;
      if (j && j > to) continue;
      const dry = computeDailyAverage({
        to,
        calendarDays: w.days,
        joined: j,
        daily: undefined,
        leave: leave.get(id),
        holidays,
        openDay,
      });
      const from = dry.from ?? to;
      const prev = need.get(id);
      if (!prev || from < prev) need.set(id, from);
    }
  });

  // Ихэнх нь үндсэн цонхны мужид; урт чөлөө / 90 хоногийн цонхтой хүн тусдаа.
  const primary = opts.windows.reduce((a, b) => (b.userIds.length > a.userIds.length ? b : a));
  const cutoff = addDays(to, -(primary.days - 1) - LONG_SPAN_MARGIN_DAYS);
  const groups = [[...need].filter(([, f]) => f >= cutoff), [...need].filter(([, f]) => f < cutoff)].filter(
    (g) => g.length > 0,
  );
  const daily = new Map<number, Map<string, number>>();
  await Promise.all(
    groups.map(async (g) => {
      const from = g.reduce((m, [, f]) => (f < m ? f : m), g[0]![1]);
      const { startUtc } = ubDayBoundsUtc(from, from, offset);
      const { results } = await db
        .prepare(
          `SELECT user_id, date(awarded_at, ?) AS day, SUM(${opts.expr ?? 'amount'}) AS v
             FROM user_points
            WHERE user_id IN (${g.map(([id]) => id).join(',')})
              AND awarded_at >= ? AND awarded_at < ?${opts.where ? ` AND (${opts.where})` : ''}
            GROUP BY user_id, day`,
        )
        .bind(sqliteOffsetModifier(offset), startUtc, untilUtc)
        .all<{ user_id: number; day: string; v: number | null }>();
      for (const r of results ?? []) {
        const id = Number(r.user_id);
        let m = daily.get(id);
        if (!m) daily.set(id, (m = new Map()));
        m.set(String(r.day), Number(r.v ?? 0));
      }
    }),
  );

  const cache = new Map<string, DailyAverage>();
  return {
    to,
    get(userId, windowIndex = 0) {
      const w = opts.windows[windowIndex];
      if (!w || !byWindow[windowIndex]!.has(userId)) return null;
      const key = `${windowIndex}|${userId}`;
      let hit = cache.get(key);
      if (!hit) {
        // Бүртгэлээс өмнөх оноо (байх ёсгүй) уншигдахгүй — `need` орсон өдрөөр
        // таслагдсан тул нийлбэр, хуваарь хоёулаа тэр өдрөөс.
        hit = computeDailyAverage({
          to,
          calendarDays: w.days,
          joined: joined.get(userId) ?? null,
          daily: daily.get(userId),
          leave: leave.get(userId),
          holidays,
          openDay,
        });
        cache.set(key, hit);
      }
      return hit;
    },
  };
}
