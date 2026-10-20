/**
 * Төслийн эрсдэлийн төлөв — ЦОР ГАНЦ эх сурвалж.
 *
 * `/api/timeline` (routes/timeline.ts) болон өдөр тутмын сануулгын cron нь
 * ЯГ ЭНЭ модулиар дамжиж төлөв тооцно.  Ингэснээр хуудсан дээрх өнгөт
 * тэмдэглэгээ («3 хоног үлдсэн») болон хэрэглэгчид очих мэдэгдэл хоёр
 * ХЭЗЭЭ Ч зөрөхгүй — хоёулаа ижил дүрмээр бодогдоно.  Шинэ дүрэм нэмэх
 * шаардлага гарвал зөвхөн энд нэм, дуудагч тал дээр давхардуулж бүү бич.
 *
 * ⚠️ Шинэ статус/амьдралын мөчлөгийн багана НЭМЭЭГҮЙ.  «Хүлээгдэж буй»
 *    гэдэг нь өгөгдлөөс УРГУУЛЖ гарна: дуусах огноогүй бол `unscheduled`,
 *    эхлэх огноо нь ирээдүйд бол `not_started`.
 *
 * Цагийн бүсийн дүрэм (CLAUDE.md): энд `new Date()`-ээр «өнөөдөр»-ийг
 * ХЭЗЭЭ Ч тодорхойлохгүй.  Дуудагч нь `todayInUB()` (lib/time.ts)-ийн
 * үр дүнг `todayIso` болгон дамжуулна.  Дотроо `new Date()`-ийг зөвхөн
 * 'YYYY-MM-DD' мөрийг UTC шөнө дунд болгон ЗАДЛАН УНШИХАД ашиглана
 * (frontend/src/features/projects/lib/forecast.ts-тэй ижил конвенц).
 *
 * Энэ модуль ЦЭВЭР — DB хандалт байхгүй, routes-оос юу ч импортлохгүй.
 */

export type RiskState =
  | 'done'
  | 'overdue'
  | 'due_1'
  | 'due_3'
  | 'due_7'
  | 'stale'
  | 'not_started'
  | 'unscheduled'
  | 'on_track';

/** Хамгийн сүүлд батлагдсан явцаас хойш хэдэн хоног өнгөрвөл «хөдөлгөөнгүй». */
export const STALE_DAYS = 14;

/** Эрэмбэ: хамгийн яаралтайгаас хамгийн тайван руу.  Жагсаалт эрэмбэлэхэд
 *  `riskRank()`-аар дамжуулж ашиглана. */
export const RISK_ORDER: readonly RiskState[] = [
  'overdue',
  'due_1',
  'due_3',
  'due_7',
  'stale',
  'unscheduled',
  'not_started',
  'on_track',
  'done',
] as const;

export interface RiskInput {
  start_date: string | null;
  finish_date: string | null;
  /** Нэгтгэсэн явц 0..100 (гар утга аль хэдийн давамгайлсан байх ёстой). */
  progress: number;
  /** 'active' | 'completed' | 'archived' */
  status: string;
  /** Сүүлийн батлагдсан явцын бичлэг: SQLite-ийн naive UTC
   *  'YYYY-MM-DD HH:MM:SS' эсвэл null. */
  last_activity_at: string | null;
}

export interface RiskResult {
  state: RiskState;
  /** finish_date − өнөөдөр, хуанлийн хоногоор.  Хуваарьгүй бол null. */
  days_left: number | null;
  /** Сүүлийн батлагдсан явцаас хойшх хоног.  Мэдэгдэхгүй бол null. */
  stale_days: number | null;
  /** start_date − өнөөдөр.  Эхлэх огноогүй бол null, эхэлсэн бол <= 0.
   *  `not_started` төлөв дээр UI нь «дуусах хүртэл N хоног» биш
   *  «N хоногийн дараа эхэлнэ» гэж хэлэхэд хэрэгтэй. */
  days_to_start: number | null;
}

const DAY_MS = 86_400_000;

/** 'YYYY-MM-DD' мөр мөн эсэх — хэлбэр НЭГ, бодит хуанлийн огноо ХОЁР.
 *  Passport-ийн огооны багана нь шалгагдаагүй чөлөөт текст тул '-', ''
 *  гэх мэт хог утга ирдэг; тэдгээрийг энд шүүнэ. */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const ms = Date.parse(`${v}T00:00:00Z`);
  if (Number.isNaN(ms)) return false;
  // 2026-02-30 мэт «хэлбэрээрээ зөв ч байхгүй» огноог Date нь 03-02 болгон
  // өнхрүүлдэг тул буцааж харьцуулж илрүүлнэ.
  return new Date(ms).toISOString().slice(0, 10) === v;
}
// EXPECT: isIsoDate('2026-08-06') === true
// EXPECT: isIsoDate('2026-02-30') === false   (хуанлид байхгүй өдөр)
// EXPECT: isIsoDate('-') === false && isIsoDate('') === false && isIsoDate(null) === false
// EXPECT: isIsoDate('2026-8-6') === false     (тэглэлгүй хэлбэр)

function toUtcMs(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getTime();
}

/** `toIso` − `fromIso`, хуанлийн хоногоор (эерэг = toIso нь хойно).
 *  Аль нэг нь буруу форматтай бол NaN — дуудагч `isIsoDate`-ээр урьдчилан
 *  шалгасан байх ёстой. */
export function diffDays(fromIso: string, toIso: string): number {
  if (!isIsoDate(fromIso) || !isIsoDate(toIso)) return Number.NaN;
  return Math.round((toUtcMs(toIso) - toUtcMs(fromIso)) / DAY_MS);
}
// EXPECT: diffDays('2026-08-06', '2026-08-09') === 3
// EXPECT: diffDays('2026-08-09', '2026-08-06') === -3
// EXPECT: diffDays('2026-08-06', '2026-08-06') === 0
// EXPECT: diffDays('2026-02-28', '2026-03-01') === 1   (2026 нь хөрөнгөт жил биш)

/** `iso` дээр `n` хоног нэмнэ (сөрөг бол хасна).  Буруу мөр ирвэл
 *  өөрчлөлтгүй буцаана. */
export function addDaysIso(iso: string, n: number): string {
  if (!isIsoDate(iso)) return iso;
  return new Date(toUtcMs(iso) + Math.round(n) * DAY_MS).toISOString().slice(0, 10);
}
// EXPECT: addDaysIso('2026-08-06', 7) === '2026-08-13'
// EXPECT: addDaysIso('2026-01-01', -1) === '2025-12-31'
// EXPECT: addDaysIso('-', 3) === '-'

/** `last_activity_at` ('YYYY-MM-DD HH:MM:SS' naive UTC) → зөвхөн огнооны хэсэг. */
function activityDate(raw: string | null): string | null {
  if (typeof raw !== 'string') return null;
  const head = raw.slice(0, 10);
  return isIsoDate(head) ? head : null;
}

/**
 * Эрсдэлийн төлвийг тооцно.  Дүрмүүд ЯГ ЭНЭ дарааллаар шалгагдана —
 * дээрх нь доорхыг дардаг:
 *
 *   1. явц >= 100 ЭСВЭЛ статус archived/completed        → done
 *   2. finish_date байхгүй / уншигдахгүй                 → unscheduled
 *   3. days_left < 0                                     → overdue
 *   4. start_date ирээдүйд                               → not_started
 *   5. days_left <= 1 / <= 3 / <= 7                      → due_1 / due_3 / due_7
 *   6. STALE_DAYS-аас удаан хөдөлгөөнгүй                 → stale
 *   7. бусад                                             → on_track
 *
 * `days_left`, `stale_days`, `days_to_start` нь БОДОГДОХ бүрдээ дүүрнэ — аль
 * төлөв ялсанаас үл хамааран (жишээ нь `done` төсөл ч үлдсэн хоногоо мэднэ).
 */
export function computeRisk(input: RiskInput, todayIso: string): RiskResult {
  const today = isIsoDate(todayIso) ? todayIso : null;

  const finish = isIsoDate(input.finish_date) ? input.finish_date : null;
  const start = isIsoDate(input.start_date) ? input.start_date : null;
  const activity = activityDate(input.last_activity_at);

  const days_left = today && finish ? diffDays(today, finish) : null;

  // stale_days-ийн утга нь ЗӨВХӨН бодит батлагдсан явцаас тоологдоно.
  // Хэзээ ч хөдөлгөөн гараагүй төсөл дээр энэ нь «мэдэгдэхгүй» (null)
  // хэвээр үлдэж, доорх (6)-р дүрмийн start_date-ийн нөөц салаа нь
  // зөвхөн ТӨЛӨВ тодорхойлоход ашиглагдана — өөр утгыг (эхэлснээс хойшх
  // хоног) чимээгүйхэн энэ талбарт хийвэл утга санаа зөрөх болно.
  const stale_days = today && activity ? diffDays(activity, today) : null;

  // Эхлэх хүртэл үлдсэн хоног.  Аль хэдийн эхэлсэн төсөл дээр 0 буюу сөрөг
  // болно — UI зөвхөн `not_started` үед эерэг утгыг харуулна.
  const days_to_start = today && start ? diffDays(today, start) : null;

  const progress = Number.isFinite(input.progress) ? input.progress : 0;
  const status = typeof input.status === 'string' ? input.status.trim().toLowerCase() : '';

  // (1) Дууссан
  if (progress >= 100 || status === 'archived' || status === 'completed') {
    return { state: 'done', days_left, stale_days, days_to_start };
  }

  // (2) Хуваарьгүй
  if (days_left === null) {
    return { state: 'unscheduled', days_left: null, stale_days, days_to_start };
  }

  // (3) Хугацаа хэтэрсэн
  if (days_left < 0) {
    return { state: 'overdue', days_left, stale_days, days_to_start };
  }

  // (4) Хараахан эхлээгүй
  if (today && start && diffDays(today, start) > 0) {
    return { state: 'not_started', days_left, stale_days, days_to_start };
  }

  // (5) Дөхөж буй эцсийн хугацаа — 1 / 3 / 7 хоног
  if (days_left <= 1) return { state: 'due_1', days_left, stale_days, days_to_start };
  if (days_left <= 3) return { state: 'due_3', days_left, stale_days, days_to_start };
  if (days_left <= 7) return { state: 'due_7', days_left, stale_days, days_to_start };

  // (6) Удаан хөдөлгөөнгүй
  if (stale_days !== null && stale_days >= STALE_DAYS) {
    return { state: 'stale', days_left, stale_days, days_to_start };
  }
  // Хэзээ ч явц бүртгэгдээгүй ч эхэлснээсээ хойш удсан төсөл мөн адил
  // хөдөлгөөнгүйд тооцогдоно (эхлээгүй байхыг (4) аль хэдийн салгасан).
  if (activity === null && today && start) {
    const sinceStart = diffDays(start, today);
    if (sinceStart >= 0 && sinceStart > STALE_DAYS) {
      return { state: 'stale', days_left, stale_days, days_to_start };
    }
  }

  // (7) Хэвийн
  return { state: 'on_track', days_left, stale_days, days_to_start };
}
// Доорх бүх EXPECT-д today = '2026-08-06'.
// EXPECT: computeRisk({start_date:'2026-01-01',finish_date:'2026-12-31',progress:100,status:'active',last_activity_at:null},'2026-08-06').state === 'done'
// EXPECT: computeRisk({start_date:null,finish_date:'2026-01-01',progress:10,status:'archived',last_activity_at:null},'2026-08-06').state === 'done'
// EXPECT: computeRisk({start_date:null,finish_date:null,progress:10,status:'active',last_activity_at:null},'2026-08-06')
//           → { state:'unscheduled', days_left:null, stale_days:null }
// EXPECT: computeRisk({start_date:null,finish_date:'-',progress:10,status:'active',last_activity_at:null},'2026-08-06').state === 'unscheduled'
// EXPECT: computeRisk({start_date:'2026-07-01',finish_date:'2026-08-01',progress:40,status:'active',last_activity_at:'2026-08-05 09:00:00'},'2026-08-06')
//           → { state:'overdue', days_left:-5, stale_days:1 }
// EXPECT: computeRisk({start_date:'2026-09-01',finish_date:'2026-10-01',progress:0,status:'active',last_activity_at:null},'2026-08-06')
//           → { state:'not_started', days_left:56 }
// EXPECT: computeRisk({start_date:'2026-07-01',finish_date:'2026-08-06',progress:80,status:'active',last_activity_at:'2026-08-06 08:00:00'},'2026-08-06').state === 'due_1'   (days_left 0)
// EXPECT: computeRisk({start_date:'2026-07-01',finish_date:'2026-08-07',progress:80,status:'active',last_activity_at:null},'2026-08-06').state === 'due_1'                     (days_left 1)
// EXPECT: computeRisk({start_date:'2026-07-01',finish_date:'2026-08-09',progress:80,status:'active',last_activity_at:'2026-08-05 10:00:00'},'2026-08-06').state === 'due_3'    (days_left 3)
// EXPECT: computeRisk({start_date:'2026-07-01',finish_date:'2026-08-13',progress:80,status:'active',last_activity_at:'2026-08-05 10:00:00'},'2026-08-06').state === 'due_7'    (days_left 7)
// EXPECT: computeRisk({start_date:'2026-07-01',finish_date:'2026-12-01',progress:20,status:'active',last_activity_at:'2026-07-01 10:00:00'},'2026-08-06')
//           → { state:'stale', days_left:117, stale_days:36 }
// EXPECT: computeRisk({start_date:'2026-07-01',finish_date:'2026-12-01',progress:0,status:'active',last_activity_at:null},'2026-08-06')
//           → { state:'stale', stale_days:null }   (хэзээ ч хөдлөөгүй, эхэлснээс 36 > 14 хоног)
// EXPECT: computeRisk({start_date:'2026-08-01',finish_date:'2026-12-01',progress:0,status:'active',last_activity_at:null},'2026-08-06').state === 'on_track'  (эхэлснээс 5 хоног)
// EXPECT: computeRisk({start_date:'2026-07-01',finish_date:'2026-12-01',progress:20,status:'active',last_activity_at:'2026-08-04 10:00:00'},'2026-08-06').state === 'on_track'
// EXPECT: computeRisk({start_date:'2026-07-01',finish_date:'2026-08-20',progress:100,status:'active',last_activity_at:'2026-07-01 10:00:00'},'2026-08-06')
//           → { state:'done', days_left:14, stale_days:36 }   (ялаагүй салбаруудын тоо ч дүүрсэн хэвээр)

/**
 * ГАНЦ ОГНООНЫ эрсдэл — таск, дэд хугацаа, эсвэл төслийн эцсийн хугацаа
 * гэх мэт «нэг мөр = нэг deadline» гэсэн зүйлд зориулав.
 *
 * ШИНЭ ДҮРЭМ БИЧИХГҮЙ: доор `computeRisk`-ийг л дуудна, тул шатлал
 * (done → unscheduled → overdue → not_started → due_1/3/7 → on_track)
 * төслийн мөртэй ЯГ ИЖИЛ гарна.  Хуудсан дээрх өнгө, cron-ийн мэдэгдэл,
 * дэд хугацааны chip гурав хэзээ ч зөрөхгүй.
 *
 * Хоёр ялгаа:
 *   · `done` нь явцаас биш, `done` тугнаас гарна (дэд хугацаанд хувь
 *     байхгүй — биелсэн эсвэл биелээгүй хоёрхон төлөв).
 *   · `stale` ХЭЗЭЭ Ч гарахгүй — `last_activity_at` нь null дамжуулагдана.
 *     Ганц огноонд «хөдөлгөөнгүй» гэсэн ойлголт байхгүй: хөдөлгөөн нь
 *     төслийн явцын бичилтээр хэмжигддэг, нэг шалгах цэгээр биш.
 *     (`stale`-ийн start_date нөөц салаа нь `last_activity_at === null`
 *     үед эхэлснээс хойш STALE_DAYS хоног өнгөрсөн бол асдаг тул
 *     `start_date`-ийг мөн дамжуулахгүй — доорх (4)-р дүрмийн
 *     `not_started`-ыг `startDate` параметрээр тусад нь хангана.)
 */
export function computeDeadlineRisk(
  input: { due_date: string | null; start_date?: string | null; done?: boolean },
  todayIso: string,
): RiskResult {
  const done = input.done === true;
  const start = isIsoDate(input.start_date) ? input.start_date : null;
  // `last_activity_at: null` + `start_date: null` → stale салаа хоёулаа хаагдана.
  // Гэвч `not_started` (дүрэм 4) нь start_date шаарддаг тул түүнийг
  // үлдээж, stale-ийн нөөц салааг `done`/огнооны нөхцлөөр биш, доорх
  // давхар шалгалтаар дардаг: үр дүн `stale` гарвал `on_track` руу буулгана.
  const result = computeRisk(
    {
      start_date: start,
      finish_date: input.due_date,
      progress: done ? 100 : 0,
      status: 'active',
      last_activity_at: null,
    },
    todayIso,
  );
  if (result.state === 'stale') {
    return { ...result, state: 'on_track', stale_days: null };
  }
  return result;
}
// Доорх бүх EXPECT-д today = '2026-08-06'.
// EXPECT: computeDeadlineRisk({due_date:'2026-08-01'},'2026-08-06').state === 'overdue'
// EXPECT: computeDeadlineRisk({due_date:'2026-08-01',done:true},'2026-08-06').state === 'done'
// EXPECT: computeDeadlineRisk({due_date:null},'2026-08-06').state === 'unscheduled'
// EXPECT: computeDeadlineRisk({due_date:'-'},'2026-08-06').state === 'unscheduled'
// EXPECT: computeDeadlineRisk({due_date:'2026-08-07'},'2026-08-06').state === 'due_1'
// EXPECT: computeDeadlineRisk({due_date:'2026-08-09'},'2026-08-06').state === 'due_3'
// EXPECT: computeDeadlineRisk({due_date:'2026-08-13'},'2026-08-06').state === 'due_7'
// EXPECT: computeDeadlineRisk({due_date:'2026-10-01',start_date:'2026-09-01'},'2026-08-06').state === 'not_started'
// EXPECT: computeDeadlineRisk({due_date:'2026-12-01',start_date:'2026-01-01'},'2026-08-06').state === 'on_track'  (stale БИШ)

/** RISK_ORDER доторх байрлал — жижиг тоо = илүү яаралтай.  Танигдахгүй
 *  утга ирвэл жагсаалтын араас нь тавина. */
export function riskRank(state: RiskState): number {
  const i = RISK_ORDER.indexOf(state);
  return i === -1 ? RISK_ORDER.length : i;
}
// EXPECT: riskRank('overdue') === 0 && riskRank('done') === 8
// EXPECT: riskRank('due_1') < riskRank('due_7') && riskRank('stale') < riskRank('on_track')
