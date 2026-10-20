/**
 * ТАСКИЙН ХУВААРИЛАЛТ — ТОГТМОЛ ЦЭГИЙН НЭГЖ, ТОО УНШИХ/ХАРУУЛАХ, АЛХАМ (2026-10-02).
 *
 * Гурван ӨӨР ойлголтыг ХЭЗЭЭ Ч хольж болохгүй:
 *   1. Дотоод жин `W` (`tasks.weight_percent`) — төслийн жинлэсэн rollup-д л.  Ажилтан
 *      үүнийг ХАРАХГҮЙ, хуваахад ӨӨРЧЛӨГДӨХГҮЙ.
 *   2. ҮНДСЭН АЖЛЫН хувь — нэг ажил ҮРГЭЛЖ 100%.  Хүн бүрийн зорилт `T`, хийсэн нь `D`
 *      ЭНД хэмжигдэнэ.
 *   3. Хувийн хэвийн гүйцэтгэл — 100 × D / T (зөвхөн тайлбар, анхдагч харагдац БИШ).
 *
 * Бүх хуваарилалт, явц БҮТЭН ТООГООР: 1 пункт (үндсэн ажлын 1%) = 10 000 нэгж, бүтэн
 * ажил = 1 000 000 нэгж.  Нэгж 10 000 болох шалтгаан — зорилт 5 үед 1%-ийн алхам 0.05
 * (= 500 нэгж) алдагдалгүй, хөвөгч цэгийн хуримтлагдсан алдаа гарахгүй.  Сервер ба
 * клиент ЯГ ижил нэгж хэрэглэнэ.  ЭНЭ ФАЙЛ = `backend/src/lib/taskUnits.ts`-ийн ИХЭР: код нь ТЭЭРЭЭР ИЖИЛ
 * байх ёстой (`npm run check:task-units` комментгүй JS-ийг тулгаж, зөрвөл `verify` унагана).  Өөрчлөхдөө хоёуланг нь
 * хамт өөрчилнө.
 *
 * Энэ файл юу ч импортлохгүй (`node --test` hook-гүйгээр ачаална).
 */

/** 1 пункт (үндсэн ажлын 1%) = 10 000 нэгж. */
export const UNITS_PER_POINT = 10_000;
/** Бүтэн үндсэн ажил = 100 пункт. */
export const ROOT_TOTAL_UNITS = 100 * UNITS_PER_POINT;
/** Хэрэглэгчийн оруулж болох аравтын орон — `UNITS_PER_POINT`-ийн тэг тоотой тэнцүү. */
export const MAX_DECIMALS = 4;

export function isUnits(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n);
}

/** Бүтэн нэгж, 0..ROOT_TOTAL_UNITS (хуваарилалт, хийсэн хэмжээний хүрээ). */
export function isRootUnits(n: unknown): n is number {
  return isUnits(n) && n >= 0 && n <= ROOT_TOTAL_UNITS;
}

/* ------------------------------------------------------------------ */
/*  Унших / харуулах                                                    */
/* ------------------------------------------------------------------ */

export type ParseUnitsError = 'EMPTY' | 'FORMAT' | 'PRECISION' | 'NEGATIVE' | 'RANGE';

export type ParseUnitsResult = { ok: true; units: number } | { ok: false; code: ParseUnitsError };

/**
 * Хэрэглэгчийн бичсэн аравтын бичвэрийг НЭГЖ рүү ХАТУУ хөрвүүлнэ.  `parseFloat('5junk')`
 * шиг хайхрамжгүй уншилт БАЙХГҮЙ: зөвхөн `цифр[.цифр]` (таслал `,`-ыг цэг гэж хүлээн авна),
 * хамгийн ихдээ 4 орон, тэмдэггүй, 'e' бичиглэлгүй.  `max` өгвөл түүнээс их утга RANGE.
 */
export function parseUnits(input: string, max: number = ROOT_TOTAL_UNITS): ParseUnitsResult {
  if (typeof input !== 'string') return { ok: false, code: 'FORMAT' };
  const s = input.trim().replace(',', '.');
  if (s === '') return { ok: false, code: 'EMPTY' };
  if (s.startsWith('-')) return { ok: false, code: 'NEGATIVE' };
  const m = /^(\d{0,4})(?:\.(\d*))?$/.exec(s);
  if (!m) return { ok: false, code: 'FORMAT' };
  const frac = m[2] ?? '';
  // «.5» ба «5.» хүчинтэй, харин цифргүй «.» биш.
  if (m[1] === '' && frac === '') return { ok: false, code: 'FORMAT' };
  if (frac.length > MAX_DECIMALS) return { ok: false, code: 'PRECISION' };
  const whole = m[1] === '' ? 0 : Number(m[1]);
  const fracUnits = frac === '' ? 0 : Number(frac.padEnd(MAX_DECIMALS, '0'));
  const units = whole * UNITS_PER_POINT + fracUnits;
  if (!Number.isSafeInteger(units) || units > max) return { ok: false, code: 'RANGE' };
  return { ok: true, units };
}

/** `4.5`, `0.05`, `90`, `0.0001` — ардаа тэг, хэрэггүй цэггүй.  Нууц үлдэгдэл БАЙХГҮЙ (4 орон бүгд). */
export function formatUnits(units: number): string {
  if (!isUnits(units)) return '0';
  const neg = units < 0;
  const abs = Math.abs(units);
  const whole = Math.floor(abs / UNITS_PER_POINT);
  const frac = abs % UNITS_PER_POINT;
  let s = String(whole);
  if (frac > 0) s += '.' + String(frac).padStart(MAX_DECIMALS, '0').replace(/0+$/, '');
  return neg ? `-${s}` : s;
}

/** Нэгж → пункт (хөвөгч, ЗӨВХӨН харуулах/ойролцоо тооцоолол — хадгалахад БҮҮ ашигла). */
export function unitsToPoints(units: number): number {
  return units / UNITS_PER_POINT;
}

/* ------------------------------------------------------------------ */
/*  Алхам (− / +)                                                       */
/* ------------------------------------------------------------------ */

/** Энгийн − / + алхам: хүний НИЙТ зорилтын 10% эсвэл 1%. */
export type StepMode = 10 | 1;

/**
 * Алхамын хэмжээ (нэгжээр) = зорилтын `mode`%.  Зорилт 5 → 10%: 0.5, 1%: 0.05;
 * зорилт 45 → 4.5 / 0.45; зорилт 90 → 9.  Дугуйлалт — .5 дээш (бүхэл тоон арифметик).
 * Зорилт > 0 бол алхам ХАМГИЙН БАГАДАА 1 нэгж (тэг алхам гацаадаг).
 */
export function stepUnits(targetUnits: number, mode: StepMode): number {
  if (!isUnits(targetUnits) || targetUnits <= 0) return 0;
  const raw = Math.floor((targetUnits * mode * 2 + 100) / 200);
  return Math.max(1, raw);
}

export interface StepResult {
  /** Шинэ ноорог утга. */
  next: number;
  /** ЖИНХЭНЭ өөрчлөлт (нэгжээр) — хязгаарт тулсан бол алхамаас бага. */
  delta: number;
}

/** `+` : ноорог + алхам, зорилтоос ЛУУ хэтрэхгүй (сүүлийн алхам богиноодог). */
export function stepUp(draft: number, targetUnits: number, mode: StepMode): StepResult {
  const step = stepUnits(targetUnits, mode);
  const next = Math.min(targetUnits, draft + step);
  return { next: Math.max(draft, next), delta: Math.max(0, next - draft) };
}

/** `−` : ноорог − алхам, түгжигдсэн доод хязгаар (`floorUnits`)-аас ДООШ орохгүй. */
export function stepDown(draft: number, floorUnits: number, targetUnits: number, mode: StepMode): StepResult {
  const step = stepUnits(targetUnits, mode);
  const next = Math.max(floorUnits, draft - step);
  return { next: Math.min(draft, next), delta: Math.min(0, next - draft) };
}

/** «Үлдсэн ажлаа дуусгах» — ноорог зорилтод хүрнэ.  Үлдэгдэл = зорилт − ноорог. */
export function finishRemaining(draft: number, targetUnits: number): StepResult {
  const next = Math.max(draft, targetUnits);
  return { next, delta: next - draft };
}

/** Үлдсэн ажил (нэгжээр) — энгийн алхамтай ХЭЗЭЭ Ч андуурахгүй, тусдаа товчны шошго. */
export function remainingUnits(draft: number, targetUnits: number): number {
  return Math.max(0, targetUnits - draft);
}

/* ------------------------------------------------------------------ */
/*  Тэнцүү / хамгийн их үлдэгдлийн хуваалт                              */
/* ------------------------------------------------------------------ */

/**
 * `total` нэгжийг `n` тэнцүү хэсэг болгоно — үлдэгдэл нэгж эхний хэсгүүдэд (тогтвортой
 * дараалал).  Нийлбэр ЯГ `total`.  `n <= 0` бол хоосон.
 */
export function equalUnits(total: number, n: number): number[] {
  if (!isUnits(total) || total < 0 || !Number.isInteger(n) || n <= 0) return [];
  const base = Math.floor(total / n);
  const rem = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
}

/**
 * Хамгийн их үлдэгдлийн арга: `weights`-ийн харьцаагаар `total`-ыг ЯГ хуваана.
 * Бутархай хэсэг тэнцүү бол ЭХНИЙ индекс түрүүлнэ (тогтвортой, санамсаргүй биш).
 * Нийлбэр ҮРГЭЛЖ `total`.  Бүх жин 0 эсвэл сөрөг бол хоосон.
 */
export function largestRemainder(total: number, weights: readonly number[]): number[] {
  if (!isUnits(total) || total < 0) return [];
  const sum = weights.reduce((s, w) => s + (w > 0 ? w : 0), 0);
  if (weights.length === 0 || !(sum > 0)) return [];
  const floors: number[] = [];
  const fracs: Array<{ i: number; r: number }> = [];
  let used = 0;
  weights.forEach((w, i) => {
    const wi = w > 0 ? w : 0;
    // `total × wi / sum` — бүхэл тоон гүйцэтгэл: BigInt-гүйгээр аюулгүй (≤ 1e6 × 1e6 = 1e12 < 2^53).
    const exact = total * wi;
    const f = Math.floor(exact / sum);
    floors.push(f);
    used += f;
    fracs.push({ i, r: exact - f * sum });
  });
  let left = total - used;
  fracs.sort((a, b) => (b.r !== a.r ? b.r - a.r : a.i - b.i));
  for (let k = 0; left > 0 && k < fracs.length; k++, left--) floors[fracs[k]!.i]! += 1;
  return floors;
}
