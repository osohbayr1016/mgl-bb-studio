/**
 * Ажлын ээлжийн нэгдсэн тодорхойлолт.
 *
 * Урьд нь `routes/attendance.ts`-ийн дотор сууж байсан бөгөөд зөвхөн
 * хоцролт тооцоход хэрэглэгддэг байв.  2026-08-13-аас чөлөөний хүсэлтийн
 * "зөвхөн ажлын цагаар" цонх мөн үүнээс уншдаг болсон тул нийтийн
 * lib болгож гаргав — ЭЭЛЖИЙН ЦАГИЙГ ЗӨВХӨН ЭНД ЗАСНА.
 */
import { isSummerSchedule } from './time';
import { orgConfig } from './orgConfig';

/** UI-н «Ажлын хуваарь» сонголттой 1:1 таарна.
 *
 *  2026-09-01-нээс ГУРВАН ээлж:
 *    early    08:00–17:00
 *    mid      08:30–17:30  ← хүүхдээ цэцэрлэг/сургуульд хүргэдэг ажилтанд
 *    standard 09:00–18:00
 *
 *  ⚠️ `users.work_schedule` БАГАНА нь `CHECK(... IN ('standard','early'))`-тэй
 *     хэвээр бөгөөд `'mid'`-ийг ХҮЛЭЭЖ АВАХГҮЙ.  Тиймээс сонголт нь одоо
 *     `user_work_schedules` хүснэгтэд (миграци 0199) хадгалагдана; хуучин
 *     багана нь зөвхөн «энэ хүн 2026 оны 9-р сараас ӨМНӨ ямар ээлжтэй байсан
 *     бэ» гэсэн ТҮҮХЭН fallback болж үлдэнэ.  Дэлгэрэнгүйг миграцийн
 *     толгойгоос үз. */
export type ScheduleKey = 'standard' | 'early' | 'mid';

/** Ажилтан өөрөө ээлж солих UI/API хаагдсан үед буцаах мессеж. */
export const SCHEDULE_SELF_SERVICE_DISABLED =
  'Ажиллах цагаа өөрчлөхийг хүсвэл менежментийн багтай уулзаж засуулна уу.';

/** Дэлгэцэнд харуулах дараалал — өглөө эртээс хойш. */
export const SCHEDULE_KEYS: readonly ScheduleKey[] = ['early', 'mid', 'standard'];

/** Танихгүй мөр DB-д хүрэхээс сэргийлнэ (`PATCH /auth/profile` нь урьд нь
 *  ямар ч мөрийг шууд бичдэг байсан — CHECK л барьдаг байв). */
export function isScheduleKey(v: unknown): v is ScheduleKey {
  return v === 'standard' || v === 'early' || v === 'mid';
}

/**
 * Ээлжийн сонголт ХЭЗЭЭНЭЭС хүчин төгөлдөр болох вэ.
 * `user_work_schedules`-ийн нэг мөр.  `effective_from` нь UB YYYY-MM-DD.
 */
export interface ScheduleAssignment {
  schedule: ScheduleKey;
  /** YYYY-MM-DD (UB) — энэ өдрөөс эхлэн хүчинтэй. */
  effective_from: string;
  /**
   * Мөрийг хэн бичсэн бэ (`users.id`).  Миграци 0199-ийн толгойд бичсэнчлэн
   * энэ нь «админ ажилтны ӨМНӨӨС өөрчилсөн» тохиолдлыг ялгах зориулалттай:
   * `created_by === user_id` бол ажилтан ӨӨРӨӨ сонгосон, өөр бол админ
   * (`PUT /api/users/:id`) тохируулсан.
   *
   * ⚠️ Заавал биш: цэвэр функцууд (`effectiveSchedule`, `selectedSchedule`,
   *    `latestAssignment`) үүнийг ОГТ уншдаггүй, тестүүд ч өгдөггүй.
   */
  created_by?: number | null;
}

export interface Shift {
  /** Ээлж эхлэх UB цаг минутаар — хоцролт тооцох эхэн цэг. */
  startMinutes: number;
  /** Ээлж дуусах UB цаг минутаар (цайны 1 цаг багтсан 9 цагийн ээлж). */
  endMinutes: number;
  label: string;
}

/**
 * Ажлын ээлжүүд.  Утга нь `lib/orgConfig.ts`-ээс АМЬДААР уншигдана
 * (`ORG_SHIFT_STANDARD` / `ORG_SHIFT_EARLY` env, эсвэл `app_settings`-ийн
 * `org.shift_standard` / `org.shift_early`).  Тохируулаагүй үед 09:00–18:00 ба
 * 08:00–17:00 — MGL-ийн одоогийн утга.
 *
 * ⚠️ Getter-ээр хийсэн нь ЗОРИУДААР: `SHIFTS.standard.startMinutes` гэсэн 8
 *    дуудлагын бичиглэл огт өөрчлөгдөхгүй, гэтэл утга нь тохиргоог дагана.
 *    Энгийн объект болговол тохиргоо ачаалагдахаас өмнөх агшинд хөлдөнө.
 */
export const SHIFTS: Record<ScheduleKey, Shift> = {
  get standard(): Shift {
    return orgConfig().shiftStandard;
  },
  get early(): Shift {
    return orgConfig().shiftEarly;
  },
  get mid(): Shift {
    return orgConfig().shiftMid;
  },
};

/**
 * Тайлан/XLSX-ийн БОГИНО шошго.  Минут нь 0 бол `08-17` (хуучин хэлбэр
 * БАЙТ ЧУХАМ хэвээр — тайлангийн багана, экспортын толгой хоёулаа үүнийг
 * хүлээдэг), минуттай ээлж бол `08:30-17:30`.
 */
export function shortShiftLabel(shift: Shift): string {
  const exact = shift.startMinutes % 60 === 0 && shift.endMinutes % 60 === 0;
  if (exact) {
    const hh = (m: number) => Math.floor(m / 60).toString().padStart(2, '0');
    return `${hh(shift.startMinutes)}-${hh(shift.endMinutes)}`;
  }
  return `${hhmmOfMinutes(shift.startMinutes)}-${hhmmOfMinutes(shift.endMinutes)}`;
}

/**
 * Тухайн өдрийн бодит ээлж.  Зуны хуваарийн үед (6–8 сар) бүх ажилтан
 * `early` (08:00–17:00) ээлжээр ажиллах тул хадгалсан тохиргоог үл
 * тооцон `early` буцаана.  Бусад үед ажилтны өөрийн сонголтыг мөрдөнө.
 *
 * ⚠️ ЭРЭМБЭ (2026-08-26-нд нэмэгдсэн 3 дахь параметр):
 *    1. Зуны албадлага — бүхнээс ДЭЭГҮҮР.
 *    2. `assignments`-ийн дотроос `effective_from <= date` нөхцөлийг
 *       хангасан ХАМГИЙН СҮҮЛИЙНХ.
 *    3. Хуучин `users.work_schedule` багана (2026 оны 9-р сараас өмнөх түүх).
 *
 * `assignments`-ийг өгөхгүй бол зан төлөв нь ӨМНӨХТЭЙ ЯГ ИЖИЛ — тиймээс
 * дуудагчийг нэг нэгээр нь шилжүүлж болно.
 *
 * @param assignments  `effective_from`-оор ӨСӨХ дарааллаар эрэмбэлэгдсэн байх
 *                     шаардлагагүй — функц өөрөө хамгийн тохирохыг сонгоно.
 */
export function effectiveSchedule(
  stored: ScheduleKey | null | undefined,
  date: string,
  assignments?: readonly ScheduleAssignment[] | null,
): ScheduleKey {
  if (isSummerSchedule(date)) return 'early';
  const picked = assignmentOn(assignments, date);
  if (picked) return picked.schedule;
  return isScheduleKey(stored) ? stored : 'standard';
}

/** `date`-д хүчин төгөлдөр байгаа хамгийн сүүлийн хуваарилалт. */
function assignmentOn(
  assignments: readonly ScheduleAssignment[] | null | undefined,
  date: string,
): ScheduleAssignment | null {
  if (!assignments || assignments.length === 0) return null;
  let best: ScheduleAssignment | null = null;
  for (const a of assignments) {
    if (a.effective_from > date) continue;
    if (!best || a.effective_from > best.effective_from) best = a;
  }
  return best;
}

/**
 * Ажилтны СОНГОСОН ээлж — зуны албадлага, огноог үл харгалзан.
 * Picker-т аль товч идэвхтэй харагдахыг ЭНЭ шийднэ.
 *
 * ⚠️ Урьд нь UI нь `my-status`-ийн `work_schedule` (=БОДИТ ээлж) дээр
 *    тулгуурлаж байсан тул зуны үед хүн бүрд `early` идэвхтэй харагддаг
 *    байв — хадгалсан сонголт нь `standard` байсан ч.  Тиймээс сонголт ба
 *    бодит ээлжийг ХОЁР ТУСДАА талбараар буцаана.
 */
export function selectedSchedule(
  stored: ScheduleKey | null | undefined,
  assignments?: readonly ScheduleAssignment[] | null,
): ScheduleKey {
  const latest = latestAssignment(assignments);
  if (latest) return latest.schedule;
  return isScheduleKey(stored) ? stored : 'standard';
}

/**
 * Ажилтны ХАМГИЙН СҮҮЛД хийсэн сонголт (огноогоор), эсвэл `null` — тэр
 * хүн сонголтоо ХЭЗЭЭ Ч хийж байгаагүй бол.
 *
 * ⚠️ Огноо нь ИРЭЭДҮЙД байж болно: сонголт маргаашаас (зунаар бол 9-р сарын
 *    1-нээс) хүчинтэй тул `effective_from > today` нь хэвийн.  Тиймээс
 *    `effectiveSchedule`-ийн `assignmentOn`-той АДИЛГҮЙ — тэр нь өнөөдөрт
 *    хүчинтэйг, энэ нь СҮҮЛИЙН шийдвэрийг олно.
 *
 * `selectedSchedule` үүнийг ашигладаг; админы жагсаалт (`GET /api/users`) мөн
 * «сонгосон уу, эсвэл хуучин баганаас унасан уу» ба «хэзээнээс» хоёрыг
 * ялгахдаа шууд дуудна.
 */
export function latestAssignment(
  assignments?: readonly ScheduleAssignment[] | null,
): ScheduleAssignment | null {
  let latest: ScheduleAssignment | null = null;
  for (const a of assignments ?? []) {
    if (!latest || a.effective_from > latest.effective_from) latest = a;
  }
  return latest;
}

/**
 * ШИНЭ сонголт хэзээнээс хүчин төгөлдөр болох вэ.
 *
 * Дүрэм (эзний шийдвэр 2026-08-26): **МАРГААШААС** — өнөөдрийн хоцролтоо
 * ээлжээ солиод «арилгах» гарцыг хаана.  Гэхдээ зуны албадлагын үед
 * маргааш ч 08:00 хэвээр тул зун дуустал ХОЙШИЛНО (2026-08-26-нд сонговол
 * → 2026-09-01).
 *
 * Тохиргоогоор зуны сар байхгүй бол энгийн «маргааш» болно.
 */
export function scheduleEffectiveFrom(today: string): string {
  let d = addDays(today, 1);
  // 366-аас илүү давтахгүй — зуны сарууд бүтэн жилийг эзэлсэн ч тасарна.
  for (let i = 0; i < 366 && isSummerSchedule(d); i++) d = addDays(d, 1);
  return d;
}

/** «Ирээдүйд ажлын цаг ӨӨРЧЛӨГДӨХ» мэдээлэл — UI-н сануулга. */
export interface ScheduleOutlook {
  /** Өнөөдөр БОДИТООР үйлчилж буй ээлж. */
  effective: ScheduleKey;
  /** Ажилтны сонгосон ээлж (зунаар дарагдсан ч байж болно). */
  selected: ScheduleKey;
  /** Ажлын цаг дараагийн удаа өөрчлөгдөх өдөр ба шинэ ээлж.  Өөрчлөлт
   *  байхгүй бол `null`. */
  changesTo: { schedule: ScheduleKey; date: string } | null;
}

/**
 * «Маргааш ч ажил 08:00-д эхэлнэ, харин 09-01-нээс 08:30 болно» гэсэн
 * мэдэгдлийг бүрдүүлэх өгөгдөл.
 *
 * ⚠️ Хуанли/тохиргоог ДАГАЖ бодогдоно — «2026-09-01» гэж хаана ч бичээгүй.
 *    Маргаашаас эхлэн урагшаа алхаж, БОДИТ ээлж өнөөдрийнхөөс ӨӨР болох
 *    ЭХНИЙ өдрийг олно.  Тиймээс:
 *      · зуны албадлага дуусах (09-01),
 *      · хойшлуулсан сонголт хүчин төгөлдөр болох,
 *      · ирэх зун дахин 08:00 болох
 *    гурвуулаа ижил замаар илэрнэ.
 */
export function scheduleOutlook(
  stored: ScheduleKey | null | undefined,
  today: string,
  assignments?: readonly ScheduleAssignment[] | null,
  horizonDays = 370,
): ScheduleOutlook {
  const effective = effectiveSchedule(stored, today, assignments);
  const selected = selectedSchedule(stored, assignments);
  let d = today;
  for (let i = 0; i < horizonDays; i++) {
    d = addDays(d, 1);
    const k = effectiveSchedule(stored, d, assignments);
    if (k !== effective) return { effective, selected, changesTo: { schedule: k, date: d } };
  }
  return { effective, selected, changesTo: null };
}

/** ISO (эсвэл 'HH:MM' агуулсан) утгаас UB цагаар "минутаар"-ыг гарга. */
export function ubMinutesOf(iso: string): number {
  // ISO нь UB +08:00 timezone-той хадгалагдсан гэж үзнэ
  // (`nowInUBIso` тэгж буцаадаг).
  const m = iso.match(/T(\d{2}):(\d{2})/);
  if (!m) return 0;
  return parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10);
}

/** 'HH:MM' цагийг минут болгоно.  Буруу формат бол `null`. */
export function minutesOfHHMM(time: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!m) return null;
  return parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10);
}

/** Минутыг 'HH:MM' болгоно (23:59-ээр таслана). */
export function hhmmOfMinutes(minutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)));
  const hh = Math.floor(clamped / 60)
    .toString()
    .padStart(2, '0');
  const mm = (clamped % 60).toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

/** YYYY-MM-DD нь Бямба/Ням мөн үү?  (UB огноог UTC-гээр тайлбарлана.) */
export function isWeekend(date: string): boolean {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
}

/** YYYY-MM-DD дээр өдөр нэмнэ (UB огноо, цагийн бүсээс хамаарахгүй). */
export function addDays(date: string, days: number): string {
  const t = new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
