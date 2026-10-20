/**
 * ХУВААРИЛАЛТЫН ЗАСВАРЛАГЧИЙН ЦЭВЭР ЗАГВАР (2026-10-02) — React-гүй, `node`-оор шалгагдана (`check:task-units`).
 *
 * Дүрэм (эзний жишээнүүд, `allocation.ts` `planAllocation`-ийн ДЭЭР):
 *   • Нээхэд одоогийн хуваарилалт ХЭВЭЭР харагдана (`pristine`) — хэн нэгнийг засах хүртэл юу ч дахин тэнцүүлэхгүй.
 *   • Нэг мөрийг засахад ГАР аар засаагүй бусад мөр «зөөлөн» болж үлдэгдлийг тэнцүү хуваана:
 *       50 / 50 → А=40 → Б=60;   гурван хүн, А=60 → Б=В=20.
 *   • Бүх мөр гараар засагдвал хамгийн ЭРТ засагдсан нь чөлөөлөгдөнө (нийлбэр үргэлж 100).
 *   • Хийсэн хэсэг (D) ХЭЗЭЭ Ч буурахгүй: тэнцүү хувь нь D-ээс бага бол мөр D дээр тулж, үлдсэнийг бусад хуваана.
 *   • Хоёр горим — ӨӨР тоо: 'total' = хүний НИЙТ зорилт T;  'remainder' = ҮЛДСЭН ажлын хувь (A=50%, B=25%, C=25% →
 *     үлдсэн 20-ын 10/5/5 → нийт зорилт 90/5/5).  Горим солиход гараар бичсэн утга цэвэрлэгдэнэ (утга өөр болсон).
 *
 * ЭЦСИЙН шийдвэрийг СЕРВЕР гаргана (`applyFinalTargets`) — энд зөвхөн урьдчилсан харагдац.
 */
import {
  planAllocation,
  rootRemainingUnits,
  type AllocationMode,
  type PlanResult,
  type PlannedRow,
  type RootAllocState,
  SHARE_TOTAL_UNITS,
} from './allocation';
import { ROOT_TOTAL_UNITS } from './units';

export interface EditorModel {
  mode: AllocationMode;
  /** Серверийн (эсвэл seed-ийн урьдчилсан) төлөв. */
  base: RootAllocState;
  /** Ирээдүйн ажил эзлэх хүмүүс (харуулах дараалал). */
  workers: number[];
  /** Хэрэглэгчийн гараар бичсэн утга — `mode`-ийн нэгжээр ('total': T, 'remainder': хувь, 1e6 = 100%). */
  fixed: Record<number, number>;
  /** Гараар засах дараалал (хамгийн эртний нь эхэнд). */
  touched: number[];
  /** Хараахан засаагүй — одоогийн хуваарилалтыг ХЭВЭЭР харуулна. */
  pristine: boolean;
}

/** Үлдсэн ажил R = 100 − B − Σ D (хуваарилагдсан ч, үгүй ч). */
export const remainingOf = (base: RootAllocState): number => rootRemainingUnits(base);

/** Одоо ирээдүйн ажилтай (T > D) хүмүүс. */
export const activeUsersOf = (base: RootAllocState): number[] =>
  base.rows.filter((r) => r.targetUnits > r.doneUnits).map((r) => r.userId);

/** `mode`-ийн нэгжээр одоогийн утга: 'total' → T, 'remainder' → (T − D) / R × 100%. */
function currentValue(base: RootAllocState, userId: number, mode: AllocationMode): number {
  const row = base.rows.find((r) => r.userId === userId);
  if (!row) return 0;
  if (mode === 'total') return row.targetUnits;
  const R = remainingOf(base);
  return R > 0 ? Math.round(((row.targetUnits - row.doneUnits) * SHARE_TOTAL_UNITS) / R) : 0;
}

export function initEditor(opts: {
  base: RootAllocState;
  mode: AllocationMode;
  /** Анхны эзлэгчид.  Одоогийн идэвхтэй оролцогчидтой ЯГ ижил бол `pristine`. */
  workers: number[];
}): EditorModel {
  const { base, mode } = opts;
  const current = activeUsersOf(base);
  const same = opts.workers.length === current.length && opts.workers.every((u) => current.includes(u));
  const pristine = same && current.length > 0;
  const fixed: Record<number, number> = {};
  if (pristine) for (const u of current) fixed[u] = currentValue(base, u, mode);
  return { mode, base, workers: [...opts.workers], fixed, touched: [], pristine };
}

/** Одоогийн хуваарилалтыг (засвар хийхгүй) `PlanResult` хэлбэрээр. */
function currentPlan(base: RootAllocState, workers: number[]): PlanResult {
  const R = remainingOf(base);
  const rows: PlannedRow[] = [];
  const seen = new Set<number>();
  for (const userId of workers) {
    const r = base.rows.find((x) => x.userId === userId);
    if (!r) continue;
    seen.add(userId);
    rows.push({
      userId,
      doneUnits: r.doneUnits,
      floorUnits: r.floorUnits,
      targetUnits: r.targetUnits,
      futureUnits: r.targetUnits - r.doneUnits,
      remainderShareUnits: R > 0 ? Math.round(((r.targetUnits - r.doneUnits) * SHARE_TOTAL_UNITS) / R) : 0,
      continues: r.targetUnits - r.doneUnits > 0,
      isNew: false,
    });
  }
  for (const r of base.rows) {
    if (seen.has(r.userId) || r.doneUnits <= 0) continue;
    rows.push({
      userId: r.userId,
      doneUnits: r.doneUnits,
      floorUnits: r.floorUnits,
      targetUnits: r.doneUnits,
      futureUnits: 0,
      remainderShareUnits: 0,
      continues: false,
      isNew: false,
    });
  }
  return { ok: true, rows, remainingUnits: R };
}

export function planOf(m: EditorModel): PlanResult {
  if (m.pristine) return currentPlan(m.base, m.workers);
  return planAllocation({
    mode: m.mode,
    state: m.base,
    workers: m.workers.map((userId) => ({ userId, ...(m.fixed[userId] !== undefined ? { fixed: m.fixed[userId]! } : {}) })),
  });
}

/** Нэг мөрийн утгыг гараар бичих.  Бусад (засаагүй) мөр «зөөлөн» болж тэнцүү хуваагдана. */
export function setRowValue(m: EditorModel, userId: number, units: number): EditorModel {
  if (!m.workers.includes(userId)) return m;
  // Нэг л хүн эзэлбэл утгыг гараар заах утгагүй — үлдсэн бүгдийг авна.
  if (m.workers.length === 1) {
    return { ...m, fixed: {}, touched: [], pristine: false };
  }
  const prevFixed = m.pristine ? {} : m.fixed;
  const prevTouched = m.pristine ? [] : m.touched;
  const fixed: Record<number, number> = { ...prevFixed, [userId]: units };
  let touched = [...prevTouched.filter((u) => u !== userId), userId];
  // Бүх мөр гараар засагдсан бол хамгийн эртнийх (өөрөөс бусад) чөлөөлөгдөнө — нийлбэр хэзээ ч гацахгүй.
  while (touched.length >= m.workers.length && touched.length > 1) {
    const oldest = touched[0]!;
    touched = touched.slice(1);
    delete fixed[oldest];
  }
  return { ...m, fixed, touched, pristine: false };
}

export function addWorker(m: EditorModel, userId: number): EditorModel {
  if (m.workers.includes(userId)) return m;
  // Шинэ хүн орж ирэхэд өмнө нь гараар бичигдсэн утгууд хэвээр; pristine байсан бол бүгд зөөлөн болж дахин тэнцүүлнэ.
  return {
    ...m,
    workers: [...m.workers, userId],
    fixed: m.pristine ? {} : m.fixed,
    touched: m.pristine ? [] : m.touched,
    pristine: false,
  };
}

export function removeWorker(m: EditorModel, userId: number): EditorModel {
  if (!m.workers.includes(userId)) return m;
  const fixed = { ...(m.pristine ? {} : m.fixed) };
  delete fixed[userId];
  return {
    ...m,
    workers: m.workers.filter((u) => u !== userId),
    fixed,
    touched: (m.pristine ? [] : m.touched).filter((u) => u !== userId),
    pristine: false,
  };
}

/** Горим солиход гараар бичсэн утгууд өөр нэгжтэй болсон тул цэвэрлэгдэнэ. */
export function setMode(m: EditorModel, mode: AllocationMode): EditorModel {
  if (mode === m.mode) return m;
  return { ...m, mode, fixed: {}, touched: [], pristine: false };
}

export function resetEqual(m: EditorModel): EditorModel {
  return { ...m, fixed: {}, touched: [], pristine: false };
}

/** Хуваарилалт ӨӨРЧЛӨГДСӨН үү (хадгалах товчийг идэвхжүүлэх). */
export function isChanged(m: EditorModel): boolean {
  if (m.pristine) return false;
  const plan = planOf(m);
  if (!plan.ok) return true; // алдаа харагдана — тайлбартай хамт
  const active = new Map(plan.rows.filter((r) => r.continues).map((r) => [r.userId, r.targetUnits]));
  const cur = new Map(
    m.base.rows.filter((r) => r.targetUnits > r.doneUnits).map((r) => [r.userId, r.targetUnits] as const),
  );
  if (active.size !== cur.size) return true;
  for (const [u, t] of active) if (cur.get(u) !== t) return true;
  return false;
}

/** Серверт илгээх ЭЦСИЙН зорилтууд (ирээдүйн ажилтай хүмүүс). */
export function toTargets(plan: Extract<PlanResult, { ok: true }>): Array<{ user_id: number; target_units: number }> {
  return plan.rows.filter((r) => r.continues).map((r) => ({ user_id: r.userId, target_units: r.targetUnits }));
}

/** Нийлбэрийн мөр: 'total' → Σ T + B (= 100 байх ёстой), 'remainder' → Σ хувь (= 100%). */
export function sumLine(plan: Extract<PlanResult, { ok: true }>, base: RootAllocState, mode: AllocationMode): {
  sum: number;
  total: number;
} {
  if (mode === 'total') {
    const sum = plan.rows.reduce((s, r) => s + r.targetUnits, 0) + base.unattributedUnits;
    return { sum, total: ROOT_TOTAL_UNITS };
  }
  return { sum: plan.rows.reduce((s, r) => s + r.remainderShareUnits, 0), total: SHARE_TOTAL_UNITS };
}
