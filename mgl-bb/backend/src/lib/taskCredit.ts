/**
 * ТАСКИЙН ХУВААРИЛАЛТ — ОНООНЫ ЦЭВЭР ТООЦОО (2026-10-02).
 *
 * Хуваарилагдсан («managed») үндсэн ажилд оноо ЖУРНАЛААС (`task_contributions`) гарна, хуучин
 * `hwmFraction` / task-wide дахин тооцоолол БИШ.  Хоёр зүйл хамгаалагдана:
 *
 *   1. Нэг хийсэн хэсэг ХОЁР удаа төлөгдөхгүй.  Хуучин систем (HWM) хувь буурсан ч оноог
 *      буцаадаггүй байсан тул seed хийх үед «төлөгдсөн боловч одоо хүчинтэй биш» нэгж
 *      (`slack`) үлдэж болно.  Шинэ хийсэн хэсэг ЭХЛЭЭД тэр slack-ийг дүүргэж (төлбөргүй),
 *      үлдсэнд л оноо авна.  Ингэж 77 → 8 → 77 давхар төлөхгүй.
 *   2. Бодит залруулга оноог БУЦААНА.  Хүн өөрийн хийсэн хэсгийг бууруулбал хамгийн сүүлийн
 *      хэсгээс (LIFO) эхлэн бодит олгосон оноог эсрэг мөрөөр хасна — анхны олгосон өдрийн
 *      хоногт (`awardedAt`), өнөөдрийн жин/зорилтоор ДАХИН ТООЦОХГҮЙ.
 *
 * Хэсэг (slice) = нэг удаагийн хийсэн хэмжээ + түүнд олгосон оноо.  Хувь нэмэр бүрийн
 * `units_open` (хүчинтэй үлдсэн), `free_open` (тэднээс оноогүй, slack-аар хаагдсан), мөн үлдсэн
 * оноо (`credit_open_*`) хадгалагдана — хэсэгчилсэн буцаалт пропорциональ, бүтнээр нь буцаахад
 * ҮЛДСЭН оноог ЯГ буцаана (нийлбэр 0).
 *
 * Энэ файл ЦЭВЭР: зөвхөн `taskUnits.ts`-ийг импортлоно.
 */
import { UNITS_PER_POINT, isUnits } from './taskUnits';

/** Төслийн хувийн нэгж (0..100) → таск бүрийн үндсэн ажлын 1 пунктэд ногдох нь. */
export interface CreditContext {
  /** coef = (task.w/100)(block.w/100)(teamShare/100); зураг/блок/багийн жин 0 бол 0. */
  coef: number;
  /** `projects.complexity_pct`. */
  complexityPct: number;
}

/**
 * Таскийн төслийн явцад үзүүлэх коэффициент — `calcProjectProgress` SQL-тэй ЯГ ижил:
 * зургийн жин нь таскийн жинтэй цуцлагдана, ГЭХДЭЭ `drawing.w ≤ 0` бол таск 0 хувь нэмэр
 * оруулна (SQL `CASE WHEN d.weight_percent > 0`; JS twin-д `if (drawing.w <= 0) continue`).
 */
export function taskProjectCoef(f: {
  taskWeight: number;
  drawingWeight: number;
  blockWeight: number;
  teamShare: number | null | undefined;
}): number {
  const t = Number(f.taskWeight);
  const d = Number(f.drawingWeight);
  const b = Number(f.blockWeight);
  const s = Number(f.teamShare ?? 0);
  if (!(t > 0) || !(d > 0) || !(b > 0) || !(s > 0)) return 0;
  return (t / 100) * (b / 100) * (s / 100);
}

/** `units` үндсэн ажлын хийсэн хэмжээний төслийн Δ% ба тэргүүлэгчийн хүснэгтийн оноо. */
export function creditOf(units: number, ctx: CreditContext): { deltaPct: number; amount: number } {
  const deltaPct = ctx.coef * (units / UNITS_PER_POINT);
  const amount = Math.max(0, ctx.complexityPct) * (deltaPct / 100);
  return { deltaPct, amount };
}

/* ------------------------------------------------------------------ */
/*  Шинэ хийсэн хэсгийн оноо                                            */
/* ------------------------------------------------------------------ */

export interface WorkCreditPlan {
  /** Slack-аар хаагдсан (оноогүй) нэгж. */
  freeUnits: number;
  /** Оноо авах нэгж = Δ − free. */
  paidUnits: number;
  deltaPct: number;
  amount: number;
  /** Үндсэн ажлын шинэ slack. */
  newSlackUnits: number;
}

/**
 * Хүн `deltaUnits` (> 0) нэмж хийлээ.  Эхлээд slack дүүргэгдэнэ (төлөгдсөн атлаа одоо
 * хүчинтэй биш хэсэг — хуучин HWM-ийн үлдэгдэл), үлдсэн нь `ctx`-ээр оноо авна.
 */
export function planWorkCredit(slackUnits: number, deltaUnits: number, ctx: CreditContext): WorkCreditPlan {
  const slack = Math.max(0, isUnits(slackUnits) ? slackUnits : 0);
  const delta = Math.max(0, isUnits(deltaUnits) ? deltaUnits : 0);
  const free = Math.min(delta, slack);
  const paid = delta - free;
  const { deltaPct, amount } = creditOf(paid, ctx);
  return { freeUnits: free, paidUnits: paid, deltaPct, amount, newSlackUnits: slack - free };
}

/* ------------------------------------------------------------------ */
/*  Буцаалт (LIFO)                                                      */
/* ------------------------------------------------------------------ */

export interface OpenSlice {
  id: number;
  userId: number;
  /** Хүчинтэй үлдсэн нэгж. */
  unitsOpen: number;
  /** Тэднээс slack-аар хаагдсан (оноогүй). */
  freeOpen: number;
  creditOpenAmount: number;
  creditOpenDeltaPct: number;
  /** Анхны олгосон өдөр (буцаалт ЭНД тэмдэглэгдэнэ). */
  awardedAt: string;
  /** Оноог тээсэн `user_points` мөр (`reverses_points_id`-д). */
  pointsId: number | null;
}

export interface ReversalPart {
  sliceId: number;
  userId: number;
  /** Энэ хэсгээс буцаах нэгж (эерэг). */
  units: number;
  freeUnits: number;
  paidUnits: number;
  /** Буцаах оноо / төслийн Δ% — ЭЕРЭГ хэмжээ (мөрөнд сөрөг бичигдэнэ). */
  amount: number;
  deltaPct: number;
  awardedAt: string;
  pointsId: number | null;
  /** Хэсэг бүрэн хаагдаж байна. */
  closes: boolean;
}

export type ReversalPlan =
  | {
      ok: true;
      parts: ReversalPart[];
      /** Slack-ийн өсөлт = Σ freeUnits (хүчинтэй нэгж буурсан атлаа оноо хэвээр). */
      slackDelta: number;
    }
  | { ok: false; code: 'NOT_ENOUGH_OPEN' | 'BAD_VALUE'; message: string };

/**
 * `unitsToReverse` нэгжийг хамгийн ШИНЭ хэсгээс эхлэн буцаана (`slicesNewestFirst` нь дуудагчийн
 * эрэмбэ).  Хэсэгчилсэн буцаалт оноог пропорциональ, бүрэн хаахад үлдсэн оноог ЯГ буцаана.
 */
export function planReversal(slicesNewestFirst: readonly OpenSlice[], unitsToReverse: number): ReversalPlan {
  if (!isUnits(unitsToReverse) || unitsToReverse <= 0) {
    return { ok: false, code: 'BAD_VALUE', message: 'Буцаах хэмжээ буруу' };
  }
  const parts: ReversalPart[] = [];
  let left = unitsToReverse;
  let slackDelta = 0;
  for (const s of slicesNewestFirst) {
    if (left <= 0) break;
    if (s.unitsOpen <= 0) continue;
    const take = Math.min(left, s.unitsOpen);
    const closes = take === s.unitsOpen;
    const paidOpen = s.unitsOpen - s.freeOpen;
    let freeRev: number;
    let paidRev: number;
    if (closes) {
      freeRev = s.freeOpen;
      paidRev = paidOpen;
    } else {
      freeRev = Math.min(s.freeOpen, Math.round((s.freeOpen * take) / s.unitsOpen));
      paidRev = take - freeRev;
      if (paidRev > paidOpen) {
        freeRev += paidRev - paidOpen;
        paidRev = paidOpen;
      }
    }
    const fraction = closes ? 1 : paidOpen > 0 ? paidRev / paidOpen : 0;
    parts.push({
      sliceId: s.id,
      userId: s.userId,
      units: take,
      freeUnits: freeRev,
      paidUnits: paidRev,
      amount: closes ? s.creditOpenAmount : s.creditOpenAmount * fraction,
      deltaPct: closes ? s.creditOpenDeltaPct : s.creditOpenDeltaPct * fraction,
      awardedAt: s.awardedAt,
      pointsId: s.pointsId,
      closes,
    });
    slackDelta += freeRev;
    left -= take;
  }
  if (left > 0) {
    return { ok: false, code: 'NOT_ENOUGH_OPEN', message: 'Буцаах хүчинтэй хийсэн хэмжээ хүрэлцэхгүй' };
  }
  return { ok: true, parts, slackDelta };
}

/** Буцаалтын мөрүүдийн нийлбэр (тест, аудит): [units, amount, deltaPct]. */
export function sumReversal(parts: readonly ReversalPart[]): { units: number; amount: number; deltaPct: number } {
  return parts.reduce(
    (a, p) => ({ units: a.units + p.units, amount: a.amount + p.amount, deltaPct: a.deltaPct + p.deltaPct }),
    { units: 0, amount: 0, deltaPct: 0 },
  );
}

/* ------------------------------------------------------------------ */
/*  Сэргээлт (буцаалтыг буцаах)                                         */
/* ------------------------------------------------------------------ */

export type RestoreCheck =
  | { ok: true; slackNeeded: number }
  | { ok: false; code: 'SLACK_CONSUMED'; message: string };

/**
 * Буцаалтыг сэргээхэд (хэсгийн `freeUnits` дахин хүчинтэй болно) тэр нэгжүүдэд аль хэдийн оноо
 * бий — тиймээс root-ийн slack ТЭР хэмжээгээр хүрэлцэх ёстой.  Хэрэв хооронд бусад хүн slack-ийг
 * дүүргэсэн бол сэргээх нь хоёр дахь удаа төлөх болно — татгалзана (оноо давхар олгохгүй).
 */
export function checkRestore(slackUnits: number, parts: readonly Pick<ReversalPart, 'freeUnits'>[]): RestoreCheck {
  const need = parts.reduce((s, p) => s + p.freeUnits, 0);
  if (need > slackUnits) {
    return {
      ok: false,
      code: 'SLACK_CONSUMED',
      message: 'Эдгээр нэгжид оноо аль хэдийн олгогдсон тул сэргээвэл давхар төлөгдөнө — гараар шийдэх шаардлагатай',
    };
  }
  return { ok: true, slackNeeded: need };
}
