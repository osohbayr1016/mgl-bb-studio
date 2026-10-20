/**
 * Засварын ажлын ЦАГИЙГ өдрийн бөглөлтөөс АВТОМАТААР бодох дүрэм (миграц
 * 0348, эзний шийдвэр 2026-09-25).  ЦЭВЭР — D1-гүй, import-гүй, тесттэй
 * (`repairDay.test.ts`).  D1 уншилт/бичилт нь `repairDayStore.ts`-д.
 *
 * ── ЭЗНИЙ ДҮРЭМ ─────────────────────────────────────────────────────
 *   • Ажлын өдөр = ажилтны ээлж (08:00–17:00 г.м.) − цайны цаг = 8 цаг.
 *   • Засварын таск дээр хувь бичихгүй — ажилтан «өнөөдөр үүн дээр
 *     ажилласан» гэж л тэмдэглэнэ (mark), цагийг систем бодно.
 *   • Өглөө засвар сонгоод орой 1 таск бөглөсөн → 8 цаг; 2 таск → 4 + 4.
 *   • Өглөөний ажлаа 12:00-д бөглөөд дараа нь засвар хийж орой бөглөсөн →
 *     засвар 12:00-ээс өдрийн эцэс хүртэл (цай хасна).
 *   • «Хэдэн ч таск, хэцүү байсан хамаагүй — нэг бүтэн өдөр ажилласан бол
 *     бүгд нийлээд 8 цаг» — нэг суултаар бөглөсөн БҮХ таскт (засвар ба
 *     хувиар бөглөдөг энгийн таск) тэнцүү хуваана: 1 засвар + 3 энгийн →
 *     тус бүр 2 цаг.
 *
 * ── ЗАГВАР ──────────────────────────────────────────────────────────
 * Өдрийн бөглөлт бүр (`DayEvent`) — нэг ажил (`key`) ба цаг (`at`).
 * Хоорондоо `SITTING_GAP_MINUTES`-аас ойр бөглөлтүүд НЭГ СУУЛТ болно:
 * хүмүүс 97% өдөрт бүх таскаа гарахын өмнө нэг дор, хэдхэн минутын дотор
 * бөглөдөг (прод, 30 хоног, 901 ажилтан-өдөр) — эс тэгвэл эхний таск нь
 * бүтэн өдрийг, дараагийнх нь секундүүдийг авах байв.
 *
 * Суулт бүр ӨМНӨХ суултын цагаас (эхнийх нь ээлжийн эхлэлээс) ӨӨРИЙН
 * СҮҮЛИЙН бөглөлтийн цаг хүртэлх хугацааг хамарна; ӨДРИЙН СҮҮЛИЙН суулт
 * ээлж дуустал сунана (16:40-д бөглөөд гарсан ч бүтэн өдөр).  Цайны цаг,
 * төслийн бус ажил, батлагдсан цагийн чөлөө (`blocked`) хугацаанаас
 * хасагдана.  Суултын минут нь тэнд бөглөсөн ялгаатай ажлуудад ТЭНЦҮҮ
 * хуваагдана.
 *
 * Цаг нь ээлжийн хилд хавчуулагдана: ээлж дууссаны дараах бүх бөглөлт
 * (оройн тайлан хэдэн цагаар сунжирсан ч) НЭГ эцсийн суулт болно; ээлж
 * эхлэхээс өмнөх бөглөлт тэг урттай эхний суулт (хожуу бөглөлт байвал)
 * — «өглөө 07:45-д тэмдэглэсэн» нь өнөөдрийн ажлын цаг хамраагүй.
 *
 * ⚠️ Гараар бичсэн хуучин засварын цаг (0348-аас өмнөх `manual` мөр) тухайн
 *    өдрийн багтаамжаас эхэлж хасагдана — хүн өөрөө мэдэгдсэн цагийг
 *    хөндөхгүй, үлдсэнийг бөглөлтүүдэд хуваана (суулт бүр пропорциональ).
 */

/** [start, end) — УБ өдрийн эхнээс хойшх МИНУТ. */
export interface Interval {
  start: number;
  end: number;
}

export interface DayWindow {
  /** Ээлжийн эхлэл/төгсгөл, минут (08:00 → 480). */
  start: number;
  end: number;
  /** Цайны цонх, эсвэл `null` (тохиргоогоор унтраасан). */
  lunch: Interval | null;
  /** Засварт тооцохгүй хугацаа: төслийн бус ажил, цагийн чөлөө. */
  blocked: readonly Interval[];
}

export interface DayEvent {
  /** Ажлын түлхүүр — нэг суултад ижил түлхүүр НЭГ л удаа тоологдоно.
   *  `t:<taskId>` засварын таск, `p:<projectId>` / `r:<repairProjectId>`
   *  таскгүй засвар, `n:<taskId>` хувиар бөглөдөг энгийн таск. */
  key: string;
  /** УБ өдрийн эхнээс хойшх минут (өдрийн гадуур бол <0 эсвэл ≥1440). */
  at: number;
  /** Цаг олгох засварын тэмдэглэгээ (`repair_marks.id`).  Энгийн таскийн
   *  бөглөлтөд байхгүй — тэр нь зөвхөн цагаас хувь хүртэнэ. */
  markId?: number;
}

export interface Sitting {
  /** Хамарсан хугацаа (ээлжийн хилд хавчуулсан). */
  from: number;
  to: number;
  /** Цай/хаалттай хугацаа хасаад, гараар бичсэн цагийн хувь хэмжээгээр
   *  багасгасан минут — энэ суултын ажлуудад хуваагдах хэмжээ. */
  minutes: number;
  /** Ялгаатай ажлууд (анх гарсан дарааллаар). */
  keys: string[];
}

export interface DayAllocation {
  /** Хуваарилах минут = ээлжийн цэвэр минут − гараар бичсэн цаг. */
  capacityMinutes: number;
  sittings: Sitting[];
  /** `markId` → цаг (бутархай, дугуйлаагүй). */
  hoursByMark: Map<number, number>;
}

/** Нэг суултад багтах хоёр дараалсан бөглөлтийн дээд зай. */
export const SITTING_GAP_MINUTES = 30;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * [from, to] ∩ ээлж хугацааны ЦЭВЭР минут: цай ба `blocked`-ийн НЭГДЛИЙГ
 * (давхцлыг нэг л удаа) хасна.
 */
export function netMinutes(from: number, to: number, window: DayWindow): number {
  const a = clamp(from, window.start, window.end);
  const b = clamp(to, window.start, window.end);
  if (b <= a) return 0;
  const cuts: Interval[] = [];
  for (const iv of [window.lunch, ...window.blocked]) {
    if (!iv) continue;
    const s = Math.max(a, iv.start);
    const e = Math.min(b, iv.end);
    if (e > s) cuts.push({ start: s, end: e });
  }
  cuts.sort((x, y) => x.start - y.start);
  let cut = 0;
  let cs = -Infinity;
  let ce = -Infinity;
  for (const iv of cuts) {
    if (iv.start > ce) {
      if (ce > cs) cut += ce - cs;
      cs = iv.start;
      ce = iv.end;
    } else if (iv.end > ce) {
      ce = iv.end;
    }
  }
  if (ce > cs) cut += ce - cs;
  return b - a - cut;
}

/**
 * Өдрийн бөглөлтүүдээс засварын тэмдэглэгээ бүрийн цагийг бодно.
 *
 * @param manualHours тухайн өдөр гараар бичсэн засварын цаг (хуучин мөр).
 */
export function allocateDay(
  window: DayWindow,
  events: readonly DayEvent[],
  manualHours = 0,
  gapMinutes = SITTING_GAP_MINUTES,
): DayAllocation {
  const total = netMinutes(window.start, window.end, window);
  const manual = Number.isFinite(manualHours) && manualHours > 0 ? manualHours * 60 : 0;
  const capacityMinutes = Math.max(0, total - manual);
  const hoursByMark = new Map<number, number>();
  if (events.length === 0 || total <= 0) {
    return { capacityMinutes, sittings: [], hoursByMark };
  }
  const factor = capacityMinutes / total;

  // Ээлжийн хилд хавчуулсан цагаар эрэмбэлнэ (ижил цагт оролтын дараалал).
  const ordered = events
    .map((ev, i) => ({ ev, i, at: clamp(ev.at, window.start, window.end) }))
    .sort((x, y) => x.at - y.at || x.i - y.i);

  const groups: { lastAt: number; items: DayEvent[] }[] = [];
  for (const { ev, at } of ordered) {
    const last = groups[groups.length - 1];
    if (last && at - last.lastAt <= gapMinutes) {
      last.items.push(ev);
      last.lastAt = at;
    } else {
      groups.push({ lastAt: at, items: [ev] });
    }
  }

  const sittings: Sitting[] = [];
  let prev = window.start;
  groups.forEach((g, gi) => {
    const to = gi === groups.length - 1 ? window.end : g.lastAt;
    const minutes = netMinutes(prev, to, window) * factor;
    const keys: string[] = [];
    const marksByKey = new Map<string, number[]>();
    for (const ev of g.items) {
      if (!marksByKey.has(ev.key)) {
        keys.push(ev.key);
        marksByKey.set(ev.key, []);
      }
      if (ev.markId !== undefined) marksByKey.get(ev.key)!.push(ev.markId);
    }
    const perKey = keys.length > 0 ? minutes / keys.length : 0;
    for (const key of keys) {
      const marks = marksByKey.get(key)!;
      if (marks.length === 0) continue;
      // Нэг суултад ижил ажлыг хоёр удаа тэмдэглэсэн (хуучин хувийн хоёр
      // бөглөлт) → тэр ажлын хувийг тэдгээрт тэнцүү хуваана.
      const each = perKey / marks.length / 60;
      for (const id of marks) hoursByMark.set(id, (hoursByMark.get(id) ?? 0) + each);
    }
    sittings.push({ from: prev, to, minutes, keys });
    prev = to;
  });

  return { capacityMinutes, sittings, hoursByMark };
}

/** Цагийг хадгалах нарийвчлал — 0.01 цаг (36 секунд). */
export function roundHours(h: number): number {
  return Number.isFinite(h) && h > 0 ? Math.round(h * 100) / 100 : 0;
}

/**
 * Тэмдэглэгээ бүрийн цагийг 0.01-д дугуйлахдаа ӨДРИЙН НИЙЛБЭРИЙГ хадгална
 * (хамгийн их үлдэгдлийн арга): 8 цагийг 3 ажилд хуваахад 2.67 × 3 = 8.01
 * болохын оронд 2.67 + 2.67 + 2.66 = 8.00.  Бусад тохиолдолд `roundHours`-тэй ижил.
 */
export function roundHoursPreservingTotal(raw: ReadonlyMap<number, number>): Map<number, number> {
  const cents = [...raw].map(([id, h]) => {
    const c = Number.isFinite(h) && h > 0 ? h * 100 : 0;
    return { id, floor: Math.floor(c + 1e-9), frac: c - Math.floor(c + 1e-9) };
  });
  const target = Math.round(cents.reduce((s, x) => s + x.floor + x.frac, 0));
  let extra = target - cents.reduce((s, x) => s + x.floor, 0);
  const order = [...cents].sort((a, b) => b.frac - a.frac || a.id - b.id);
  const out = new Map<number, number>();
  for (const x of order) {
    const bump = extra > 0 && x.frac > 1e-9 ? 1 : 0;
    extra -= bump;
    out.set(x.id, (x.floor + bump) / 100);
  }
  return out;
}

/**
 * UTC `'YYYY-MM-DD HH:MM:SS'` (SQLite `datetime('now')`) агшныг `date`
 * (байгууллагын цагийн бүсийн огноо) өдрийн эхнээс хойшх МИНУТ болгоно.
 * Өмнөх өдөр → сөрөг, дараагийн өдөр → ≥1440.  Буруу мөр → `null`.
 */
export function minutesIntoDay(
  utc: string | null | undefined,
  date: string,
  offsetMinutes: number,
): number | null {
  if (!utc) return null;
  const at = Date.parse(`${utc.slice(0, 19).replace(' ', 'T')}Z`);
  const dayStart = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(at) || Number.isNaN(dayStart)) return null;
  return (at - dayStart) / 60_000 + offsetMinutes;
}

/** `'HH:MM'` → минут, буруу бол `null`. */
export function hhmmToMinutes(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(raw.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Засварын ажлын түлхүүр — таск > төсөл > дотоод ажил. */
export function repairItemKey(item: {
  task_id?: number | null;
  project_id?: number | null;
  repair_project_id?: number | null;
}): string {
  if (item.task_id) return `t:${item.task_id}`;
  if (item.project_id) return `p:${item.project_id}`;
  return `r:${item.repair_project_id ?? 0}`;
}
