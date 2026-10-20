/**
 * ТАСКИЙН ХУВААРИЛАЛТЫН ЦЭВЭР ДҮРЭМ — хуваах/засах, өөрийн явц, буцаах/шилжүүлэх (2026-10-02).
 *
 * Нэг таск = НЭГ «үндсэн ажил» (root, `tasks.id`).  Хуваахад дотоод жин `W` багасахгүй,
 * шинэ таск ҮҮСЭХГҮЙ — харин оролцогч бүрт хуваарилалт (allocation) мөр үүснэ.  Бүгд үндсэн
 * ажлын хувиар (1 000 000 нэгж = 100%, `taskUnits.ts`).
 *
 *   T_i  — хүний НИЙТ зорилт (хийсэн + хийх)         D_i — одоо хүчинтэй хийсэн нь
 *   L_i  — сүүлийн бүтцийн засвараар түгжигдсэн хийсэн (энгийн «−»-ийн доод хязгаар)
 *   U    — хуваарилагдаагүй ирээдүйн ажил            B   — эзэн нь баталгаагүй хуучин хийсэн
 *
 *   0 ≤ L_i ≤ D_i ≤ T_i ≤ 100          0 ≤ B ≤ 100
 *   Σ T_i + B + U = 100                 root_done = Σ D_i + B
 *
 * Энэ файл ЦЭВЭР — D1 уншихгүй.  Зөвхөн `taskUnits.ts`-ийг импортлоно.  Frontend twin:
 * `frontend/src/features/task-allocation/allocation.ts` (`npm run check:task-units`).
 */
import {
  ROOT_TOTAL_UNITS,
  equalUnits,
  isRootUnits,
  isUnits,
  largestRemainder,
} from './taskUnits';

/** Нэг үндсэн ажилд ИДЭВХТЭЙ (ирээдүйн ажил эзэлсэн) хамгийн ихдээ оролцогч — хуучин «20 хэсэг»-ийн хязгаар. */
export const MAX_ACTIVE_ALLOCATIONS = 20;
/** Түүхтэй хүмүүсийг оруулсан нийт мөрийн аюулгүйн дээд хязгаар (payload-ийн хэмжээ). */
export const MAX_ALLOCATION_ROWS = 60;
/** «Үлдсэн ажлын ХУВЬ» горимд 100% = 1 000 000 (нэгжийн хуваарьтай ижил). */
export const SHARE_TOTAL_UNITS = ROOT_TOTAL_UNITS;

/** Хуваарилалтын мөр (D1 `task_allocations`-ийн цэвэр дүрс). */
export interface AllocRow {
  userId: number;
  /** D — одоо хүчинтэй хийсэн. */
  doneUnits: number;
  /** L — түгжигдсэн доод хязгаар (≤ D). */
  floorUnits: number;
  /** T — нийт зорилт (≥ D). */
  targetUnits: number;
}

export interface RootAllocState {
  /** B — эзэн нь баталгаагүй хуучин хийсэн (түгжигдсэн, ХЭНД Ч ноогдохгүй). */
  unattributedUnits: number;
  /** U — хуваарилагдаагүй ирээдүйн ажил (буцаасны дараа > 0 байж болно). */
  unallocatedUnits: number;
  rows: AllocRow[];
}

export const futureUnitsOf = (r: AllocRow): number => r.targetUnits - r.doneUnits;

export function rootDoneUnits(s: RootAllocState): number {
  return s.unattributedUnits + s.rows.reduce((acc, r) => acc + r.doneUnits, 0);
}

/** Одоо эзэлсэн ирээдүйн ажил (Σ (T − D)). */
export function allocatedFutureUnits(s: RootAllocState): number {
  return s.rows.reduce((acc, r) => acc + futureUnitsOf(r), 0);
}

/** Үндсэн ажлын үлдсэн хэмжээ = 100 − хийгдсэн (хуваарилагдсан ч, үгүй ч). */
export function rootRemainingUnits(s: RootAllocState): number {
  return ROOT_TOTAL_UNITS - rootDoneUnits(s);
}

/**
 * Инвариантууд: зөрчсөн бүрийг мөрөөр буцаана (хоосон = эрүүл).  Seed, засвар бүрийн
 * ДАРАА хамгаалалтаар дуудаж, тестэд нэг тодорхойлолтоор шалгана.
 */
export function checkRootInvariants(s: RootAllocState): string[] {
  const out: string[] = [];
  if (!isRootUnits(s.unattributedUnits)) out.push('B_RANGE');
  if (!isRootUnits(s.unallocatedUnits)) out.push('U_RANGE');
  const seen = new Set<number>();
  let sumT = 0;
  for (const r of s.rows) {
    if (seen.has(r.userId)) out.push(`DUPLICATE_USER:${r.userId}`);
    seen.add(r.userId);
    if (![r.doneUnits, r.floorUnits, r.targetUnits].every(isUnits)) out.push(`NOT_INTEGER:${r.userId}`);
    if (r.floorUnits < 0 || r.floorUnits > r.doneUnits) out.push(`FLOOR:${r.userId}`);
    if (r.doneUnits > r.targetUnits) out.push(`DONE_OVER_TARGET:${r.userId}`);
    if (r.targetUnits > ROOT_TOTAL_UNITS) out.push(`TARGET_RANGE:${r.userId}`);
    sumT += r.targetUnits;
  }
  if (sumT + s.unattributedUnits + s.unallocatedUnits !== ROOT_TOTAL_UNITS) out.push('SUM_NOT_100');
  if (rootDoneUnits(s) > ROOT_TOTAL_UNITS) out.push('ROOT_DONE_OVER_100');
  return out;
}

/* ------------------------------------------------------------------ */
/*  Хуваалт / засвар — төлөвлөгч                                        */
/* ------------------------------------------------------------------ */

/**
 *  'total'     — хүн бүрийн НИЙТ зорилт `T` (жишээ 50 / 45 / 5);
 *  'remainder' — ҮЛДСЭН ажлын хувь (Σ = 100%): A=50%, B=25%, C=25% нь үлдсэн 20-ийн
 *                10 / 5 / 5 болж, нийт зорилт 90 / 5 / 5.
 * Эдгээр нь ӨӨР тоо — UI заавал аль горим гэдгийг ил бичнэ.
 */
export type AllocationMode = 'total' | 'remainder';

export interface PlanWorker {
  userId: number;
  /** Хэрэглэгч ГАР аар бичсэн утга (нэгжээр) — 'total': T; 'remainder': үлдсэний хувь (1e6 = 100%). Байхгүй бол «зөөлөн» (тэнцүү хуваагдана). */
  fixed?: number;
}

export interface PlanInput {
  mode: AllocationMode;
  /** Одоогийн төлөв — түгжигдсэн (хийсэн) хэсгийг эндээс авна. */
  state: RootAllocState;
  /** Ирээдүйн ажил ЭЗЭЛНЭ гэсэн хүмүүс (шинэ эсвэл үргэлжлүүлэх).  Түүхтэй өөр хүн автоматаар «зөвхөн түүх». */
  workers: PlanWorker[];
}

export interface PlannedRow {
  userId: number;
  doneUnits: number;
  floorUnits: number;
  targetUnits: number;
  /** T − D — ирээдүйд хийх. */
  futureUnits: number;
  /** Үлдсэн ажлын хэдэн %-ийг эзэлж байгаа (1e6 = 100%); R = 0 бол 0. */
  remainderShareUnits: number;
  /** Ирээдүйн ажилтай (futureUnits > 0). */
  continues: boolean;
  /** Өмнө нь оролцогч биш байсан. */
  isNew: boolean;
}

export type PlanErrorCode =
  | 'NO_WORKERS'
  | 'DUPLICATE_USER'
  | 'TOO_MANY'
  | 'BAD_VALUE'
  | 'BELOW_DONE'
  | 'SUM_MISMATCH'
  | 'OVER_REMAINDER'
  | 'NO_FREE_WORK'
  | 'PRECISION';

export type PlanFailure = { ok: false; code: PlanErrorCode; message: string; userId?: number };

export type PlanResult =
  | {
      ok: true;
      rows: PlannedRow[];
      /** R — үлдсэн ажил (нэгжээр). */
      remainingUnits: number;
    }
  | PlanFailure;

const fail = (code: PlanErrorCode, message: string, userId?: number): PlanFailure => ({
  ok: false,
  code,
  message,
  ...(userId !== undefined ? { userId } : {}),
});

/**
 * Хуваарилалтыг төлөвлөнө — бүх «зөөлөн» мөрийг тэнцүү, гараар бичсэнийг хэвээр, түгжигдсэн
 * (хийсэн) хэсгийг ХӨНДӨХГҮЙГЭЭР.  Жишээ: гурван зөөлөн мөрөнд A=60 бичвэл B=C=20; хоёр
 * хүнд A=40 бол B=60.  Түгжигдсэн доод хязгаар (D_i) нь тэнцүү хуваалтаас их бол тэр мөр
 * доод хязгаартаа тулж, үлдсэнийг бусад нь хуваана (water-filling).
 *
 * Хийсэн хэсгийг чимээгүй сулруулахгүй: хуваарилах боломжгүй бол алдаа буцаана.
 */
export function planAllocation(input: PlanInput): PlanResult {
  const { mode, state, workers } = input;
  const stateErr = checkRootInvariants(state);
  if (stateErr.length > 0) return fail('BAD_VALUE', `Төлөв эрүүл биш: ${stateErr[0]}`);
  if (workers.length === 0) return fail('NO_WORKERS', 'Дор хаяж нэг хүн ирээдүйн ажлыг эзлэх ёстой');
  if (workers.length > MAX_ACTIVE_ALLOCATIONS) {
    return fail('TOO_MANY', `Хамгийн ихдээ ${MAX_ACTIVE_ALLOCATIONS} хүн`);
  }
  const ids = new Set<number>();
  for (const w of workers) {
    if (!Number.isInteger(w.userId) || w.userId <= 0) return fail('BAD_VALUE', 'Хэрэглэгч буруу', w.userId);
    if (ids.has(w.userId)) return fail('DUPLICATE_USER', 'Нэг хүн хоёр удаа орсон', w.userId);
    ids.add(w.userId);
    if (w.fixed !== undefined && !isRootUnits(w.fixed)) return fail('BAD_VALUE', 'Утга буруу', w.userId);
  }

  const known = new Map(state.rows.map((r) => [r.userId, r]));
  // Түүхтэй (хийсэн нь > 0) боловч ирээдүйн ажил эзлээгүй хүн — «зөвхөн түүх» (T = D).
  const history = state.rows.filter((r) => !ids.has(r.userId) && r.doneUnits > 0);
  if (history.length + workers.length > MAX_ALLOCATION_ROWS) {
    return fail('TOO_MANY', 'Оролцогч хэт олон байна');
  }
  const B = state.unattributedUnits;
  const histDone = history.reduce((s, r) => s + r.doneUnits, 0);
  const workerDone = workers.reduce((s, w) => s + (known.get(w.userId)?.doneUnits ?? 0), 0);
  const R = ROOT_TOTAL_UNITS - B - histDone - workerDone; // үлдсэн ирээдүйн ажил (хуваарилагдсан ч, үгүй ч)

  let targets: number[];
  if (mode === 'total') {
    const planned = planTotals(state, workers, known, ROOT_TOTAL_UNITS - B - histDone);
    if (!planned.ok) return planned;
    targets = planned.targets;
  } else {
    if (R <= 0) return fail('NO_FREE_WORK', 'Үлдсэн ажил байхгүй — хуваарилах зүйл алга');
    const planned = planShares(workers, R);
    if (!planned.ok) return planned;
    targets = workers.map((w, i) => (known.get(w.userId)?.doneUnits ?? 0) + planned.futures[i]!);
  }

  const rows: PlannedRow[] = [];
  workers.forEach((w, i) => {
    const prev = known.get(w.userId);
    const done = prev?.doneUnits ?? 0;
    const target = targets[i]!;
    rows.push({
      userId: w.userId,
      doneUnits: done,
      floorUnits: prev?.floorUnits ?? 0,
      targetUnits: target,
      futureUnits: target - done,
      remainderShareUnits: R > 0 ? Math.round(((target - done) * SHARE_TOTAL_UNITS) / R) : 0,
      continues: target - done > 0,
      isNew: prev === undefined,
    });
  });
  for (const h of history) {
    rows.push({
      userId: h.userId,
      doneUnits: h.doneUnits,
      floorUnits: h.floorUnits,
      targetUnits: h.doneUnits,
      futureUnits: 0,
      remainderShareUnits: 0,
      continues: false,
      isNew: false,
    });
  }

  // Шинэ хүнд ирээдүйн ажил ЗААВАЛ эерэг (тэг/сөрөг зорилт үүсгэхгүй).
  for (const r of rows) {
    if (r.isNew && r.futureUnits <= 0) {
      return fail('PRECISION', 'Хуваарилах ажил хүн бүрт хүрэлцэхгүй — хүний тоог цөөлнө үү', r.userId);
    }
  }
  const check = checkRootInvariants({ unattributedUnits: B, unallocatedUnits: 0, rows });
  if (check.length > 0) return fail('SUM_MISMATCH', `Нийлбэр таарсангүй (${check[0]})`);
  return { ok: true, rows, remainingUnits: R };
}

/** 'total' горим: гараар бичигдсэнийг хэвээр, зөөлөнд тэнцүү (доод хязгаартай water-filling). */
function planTotals(
  _state: RootAllocState,
  workers: PlanWorker[],
  known: Map<number, AllocRow>,
  pool: number,
): { ok: true; targets: number[] } | PlanFailure {
  const floors = workers.map((w) => known.get(w.userId)?.doneUnits ?? 0);
  const targets: number[] = new Array(workers.length).fill(0);
  let fixedSum = 0;
  const soft: number[] = [];
  workers.forEach((w, i) => {
    if (w.fixed === undefined) {
      soft.push(i);
    } else {
      targets[i] = w.fixed;
      fixedSum += w.fixed;
    }
  });
  for (let i = 0; i < workers.length; i++) {
    const w = workers[i]!;
    if (w.fixed !== undefined && w.fixed < floors[i]!) {
      return fail('BELOW_DONE', 'Зорилт нь аль хэдийн хийсэн хэмжээнээс бага байж болохгүй', w.userId);
    }
  }
  let left = pool - fixedSum;
  if (left < 0) return fail('SUM_MISMATCH', 'Гараар бичсэн зорилтуудын нийлбэр 100-аас хэтэрлээ');
  if (soft.length === 0) {
    if (left !== 0) return fail('SUM_MISMATCH', 'Нийлбэр 100 биш — үлдсэнийг тэнцүү хуваах мөр алга');
    return { ok: true, targets };
  }
  // Water-filling: тэнцүү хувь нь доод хязгаараас бага болсон мөрийг доод хязгаарт нь тогтооно.
  let active = soft.slice();
  for (;;) {
    const e = left / active.length;
    const pinned = active.filter((i) => floors[i]! > e);
    if (pinned.length === 0) break;
    for (const i of pinned) {
      targets[i] = floors[i]!;
      left -= floors[i]!;
    }
    active = active.filter((i) => !pinned.includes(i));
    if (active.length === 0) {
      if (left !== 0) return fail('SUM_MISMATCH', 'Хийсэн хэсгүүд хуваарилах ажлаас хэтэрч байна');
      return { ok: true, targets };
    }
  }
  if (left < 0) return fail('SUM_MISMATCH', 'Хийсэн хэсгүүд хуваарилах ажлаас хэтэрч байна');
  const eq = equalUnits(left, active.length);
  active.forEach((i, k) => {
    targets[i] = eq[k]!;
  });
  return { ok: true, targets };
}

/** 'remainder' горим: хувь → үлдсэн ажлыг ЯГ хуваана (нийлбэр = R). */
function planShares(
  workers: PlanWorker[],
  R: number,
): { ok: true; futures: number[] } | PlanFailure {
  let fixedSum = 0;
  const soft: number[] = [];
  const shares: number[] = new Array(workers.length).fill(0);
  workers.forEach((w, i) => {
    if (w.fixed === undefined) soft.push(i);
    else {
      shares[i] = w.fixed;
      fixedSum += w.fixed;
    }
  });
  if (fixedSum > SHARE_TOTAL_UNITS) {
    return fail('OVER_REMAINDER', 'Хувиудын нийлбэр 100%-аас хэтэрлээ');
  }
  const leftover = SHARE_TOTAL_UNITS - fixedSum;
  if (soft.length === 0) {
    if (leftover !== 0) return fail('SUM_MISMATCH', 'Хувиудын нийлбэр 100% биш');
  } else {
    const eq = equalUnits(leftover, soft.length);
    soft.forEach((i, k) => {
      shares[i] = eq[k]!;
    });
  }
  const futures = largestRemainder(R, shares);
  if (futures.length !== workers.length) return fail('BAD_VALUE', 'Хуваарилалт хийгдсэнгүй');
  return { ok: true, futures };
}

/** Бүгд «зөөлөн» тэнцүү хуваалт — нээсэн даруй харагдах өгөгдмөл (40/60 засвар эндээс эхэлнэ). */
export function defaultPlan(state: RootAllocState, userIds: number[], mode: AllocationMode = 'remainder'): PlanResult {
  return planAllocation({ mode, state, workers: userIds.map((userId) => ({ userId })) });
}

/* ------------------------------------------------------------------ */
/*  Сервер талын эцсийн зорилтын шалгалт                                */
/* ------------------------------------------------------------------ */

export interface FinalTarget {
  userId: number;
  targetUnits: number;
}

export type ApplyResult =
  | { ok: true; state: RootAllocState; dropped: number[]; released: number[]; created: number[] }
  | { ok: false; code: PlanErrorCode; message: string; userId?: number };

/**
 * Клиентийн харуулсан ЭЦСИЙН зорилтуудыг сервер шалгаж шинэ төлөв гаргана.  Сервер
 * тэнцвэржүүлэлтийг дахин зохиохгүй — зөвхөн инвариант: давхардалгүй, T ≥ D, шинэ хүнд T > 0,
 * түүхтэй хүн (D > 0) орхигдохгүй (оролцоогүй бол зөвхөн-түүх болж T = D), Σ T + B = 100.
 *
 * `dropped` — хийсэн нь 0 байсан, зорилтгүй болсон (цуцлагдсан) мөр.
 * `released` — хийсэн нь > 0, ирээдүйн ажлаа алдсан (түүх-only болсон) хүмүүс.
 * Түгжигдсэн доод хязгаар (`floorUnits`) = ХУВААРИЛАЛТ ӨӨРЧЛӨГДӨХ мөчийн хийсэн (D): энгийн
 * «−» энэ доод хязгаараас доош орохгүй.
 */
export function applyFinalTargets(state: RootAllocState, targets: FinalTarget[]): ApplyResult {
  const stateErr = checkRootInvariants(state);
  if (stateErr.length > 0) return { ok: false, code: 'BAD_VALUE', message: `Төлөв эрүүл биш: ${stateErr[0]}` };
  if (targets.length > MAX_ACTIVE_ALLOCATIONS) {
    return { ok: false, code: 'TOO_MANY', message: `Хамгийн ихдээ ${MAX_ACTIVE_ALLOCATIONS} хүн` };
  }
  const known = new Map(state.rows.map((r) => [r.userId, r]));
  const seen = new Set<number>();
  for (const t of targets) {
    if (!Number.isInteger(t.userId) || t.userId <= 0 || !isRootUnits(t.targetUnits)) {
      return { ok: false, code: 'BAD_VALUE', message: 'Зорилт буруу', userId: t.userId };
    }
    if (seen.has(t.userId)) {
      return { ok: false, code: 'DUPLICATE_USER', message: 'Нэг хүн хоёр удаа орсон', userId: t.userId };
    }
    seen.add(t.userId);
    const prev = known.get(t.userId);
    if (t.targetUnits < (prev?.doneUnits ?? 0)) {
      return {
        ok: false,
        code: 'BELOW_DONE',
        message: 'Зорилт нь аль хэдийн хийсэн хэмжээнээс бага байж болохгүй',
        userId: t.userId,
      };
    }
    if (!prev && t.targetUnits <= 0) {
      return {
        ok: false,
        code: 'PRECISION',
        message: 'Шинэ хүнд хуваарилах ажил эерэг байх ёстой',
        userId: t.userId,
      };
    }
  }
  const rows: AllocRow[] = [];
  const dropped: number[] = [];
  const released: number[] = [];
  const created: number[] = [];
  for (const t of targets) {
    const prev = known.get(t.userId);
    if (!prev) created.push(t.userId);
    const done = prev?.doneUnits ?? 0;
    // Хуваарилалт өөрчлөгдөх мөчид хийсэн нь түгжигдэнэ (L := D).
    rows.push({ userId: t.userId, doneUnits: done, floorUnits: done, targetUnits: t.targetUnits });
  }
  for (const r of state.rows) {
    if (seen.has(r.userId)) continue;
    if (r.doneUnits > 0) {
      released.push(r.userId);
      rows.push({ userId: r.userId, doneUnits: r.doneUnits, floorUnits: r.doneUnits, targetUnits: r.doneUnits });
    } else {
      dropped.push(r.userId);
    }
  }
  const next: RootAllocState = { unattributedUnits: state.unattributedUnits, unallocatedUnits: 0, rows };
  const sumT = rows.reduce((s, r) => s + r.targetUnits, 0);
  if (sumT + next.unattributedUnits !== ROOT_TOTAL_UNITS) {
    return {
      ok: false,
      code: 'SUM_MISMATCH',
      message: `Нийлбэр ${sumT + next.unattributedUnits} ≠ ${ROOT_TOTAL_UNITS} — хуваарилалт 100% байх ёстой`,
    };
  }
  const check = checkRootInvariants(next);
  if (check.length > 0) return { ok: false, code: 'SUM_MISMATCH', message: `Нийлбэр таарсангүй (${check[0]})` };
  return { ok: true, state: next, dropped, released, created };
}

/* ------------------------------------------------------------------ */
/*  Өөрийн явц                                                          */
/* ------------------------------------------------------------------ */

export type OwnProgressError = 'NO_ALLOCATION' | 'OVER_TARGET' | 'BELOW_FLOOR' | 'BAD_VALUE';

export type OwnProgressPlan =
  | {
      ok: true;
      /** D-ийн өөрчлөлт (нэгжээр, + эсвэл −). */
      deltaUnits: number;
      kind: 'increase' | 'decrease' | 'none';
      /** Өөрийн хэсэг зорилтод ХҮРЭХ (D_i < T_i → D_i = T_i). */
      reachesOwnCap: boolean;
      /** Үндсэн ажил 100% БОЛНО. */
      completesRoot: boolean;
      /** Үндсэн ажил 100%-аас ӨМНӨ нь доош буух (дууссан байсан → дахин нээгдэнэ). */
      reopensRoot: boolean;
      newDoneUnits: number;
      newRootDoneUnits: number;
    }
  | { ok: false; code: OwnProgressError; message: string };

/**
 * Хүн ӨӨРИЙН хийсэн хэмжээг `nextDone` болгох хүсэлтийг шалгана.  Ердийн хадгалалт
 * доод хязгаар `L_i`-ээс доош ОРОХГҮЙ — тэр нь тусдаа «өөрийн түүхэн бүртгэлийг засах» урсгал.
 * `nextDone == D` бол `kind:'none'` (ямар ч бичлэг, оноо, QA, мэдэгдэл үүсэхгүй).
 */
export function planOwnProgress(state: RootAllocState, userId: number, nextDone: number): OwnProgressPlan {
  const row = state.rows.find((r) => r.userId === userId);
  if (!row || row.targetUnits <= 0) return { ok: false, code: 'NO_ALLOCATION', message: 'Танд энэ ажилд хуваарилалт алга' };
  if (!isUnits(nextDone) || nextDone < 0) return { ok: false, code: 'BAD_VALUE', message: 'Утга буруу' };
  if (nextDone > row.targetUnits) {
    return { ok: false, code: 'OVER_TARGET', message: 'Хийсэн хэмжээ таны зорилтоос хэтэрч болохгүй' };
  }
  if (nextDone < row.floorUnits) {
    return {
      ok: false,
      code: 'BELOW_FLOOR',
      message: 'Хуваалтын өмнөх бүртгэлээс доош бууруулахыг «өөрийн бүртгэлийг засах» үйлдлээр хийнэ',
    };
  }
  const delta = nextDone - row.doneUnits;
  const before = rootDoneUnits(state);
  const after = before + delta;
  return {
    ok: true,
    deltaUnits: delta,
    kind: delta > 0 ? 'increase' : delta < 0 ? 'decrease' : 'none',
    reachesOwnCap: delta > 0 && nextDone === row.targetUnits,
    completesRoot: delta > 0 && before < ROOT_TOTAL_UNITS && after >= ROOT_TOTAL_UNITS,
    reopensRoot: delta < 0 && before >= ROOT_TOTAL_UNITS,
    newDoneUnits: nextDone,
    newRootDoneUnits: after,
  };
}

/* ------------------------------------------------------------------ */
/*  Үлдсэн ажлыг буцаах / шилжүүлэх                                    */
/* ------------------------------------------------------------------ */

export type ReleaseResult =
  | { ok: true; state: RootAllocState; releasedUnits: number }
  | { ok: false; code: 'NO_ALLOCATION' | 'NOTHING_TO_RELEASE' | 'TARGET_NOT_PARTICIPANT' | 'BAD_VALUE'; message: string };

/**
 * «Үлдсэн ажлаа буцаах/шилжүүлэх»: `T_i − D_i` ирээдүйн ажлыг ЧӨЛӨӨЛНӨ.  Хийсэн `D_i` ХЭЗЭЭ Ч
 * бусдад шилжихгүй — тэр хүн түүхтэй оролцогч хэвээр (T_i = D_i).  `toUserId` өгвөл ирээдүйн
 * ажил ТЭР хүнд шилжинэ (түүний T += үлдэгдэл), үгүй бол `U`-д орно.
 * `D_i = 0` бол мөр цуцлагдана (дуудагч шийднэ).
 */
export function planRelease(state: RootAllocState, userId: number, toUserId?: number | null): ReleaseResult {
  const row = state.rows.find((r) => r.userId === userId);
  if (!row) return { ok: false, code: 'NO_ALLOCATION', message: 'Танд энэ ажилд хуваарилалт алга' };
  const future = futureUnitsOf(row);
  if (future <= 0) return { ok: false, code: 'NOTHING_TO_RELEASE', message: 'Буцаах үлдсэн ажил алга' };
  if (toUserId !== undefined && toUserId !== null) {
    if (toUserId === userId) return { ok: false, code: 'BAD_VALUE', message: 'Өөрт шилжүүлэх боломжгүй' };
    const dest = state.rows.find((r) => r.userId === toUserId);
    if (!dest) return { ok: false, code: 'TARGET_NOT_PARTICIPANT', message: 'Хүлээн авагч энэ ажлын оролцогч биш' };
  }
  const rows = state.rows.map((r) => {
    if (r.userId === userId) return { ...r, targetUnits: r.doneUnits, floorUnits: r.doneUnits };
    if (toUserId !== undefined && toUserId !== null && r.userId === toUserId) {
      return { ...r, targetUnits: r.targetUnits + future };
    }
    return { ...r };
  });
  const toPool = toUserId === undefined || toUserId === null;
  const next: RootAllocState = {
    unattributedUnits: state.unattributedUnits,
    unallocatedUnits: state.unallocatedUnits + (toPool ? future : 0),
    rows,
  };
  return { ok: true, state: next, releasedUnits: future };
}

export type RetakeResult =
  | { ok: true; state: RootAllocState; takenUnits: number; reactivated: boolean }
  | { ok: false; code: 'NOTHING_FREE' | 'BAD_VALUE' | 'TOO_MANY'; message: string; availableUnits: number };

/**
 * Хуваарилагдаагүй ирээдүйн ажлаас (`U`) хүн авна — дахин авах эсвэл шинэ оролцогч.  `wantUnits`
 * (өгөгдмөл = өмнө нь буцаасан хэмжээ эсвэл бүх `U`) ЧӨЛӨӨТ байгаа хэмжээнээс ИХ байж болохгүй:
 * бусдын хуулийн ёсоор авсан хуваарилалтыг ХУДАЛДАХГҮЙ.  Өмнөх `D_i` (хүчинтэй хийсэн) хэвээр —
 * тэндээс үргэлжилнэ, тэгээс эхлэхгүй.
 */
export function planRetake(state: RootAllocState, userId: number, wantUnits?: number | null): RetakeResult {
  const free = state.unallocatedUnits;
  if (free <= 0) return { ok: false, code: 'NOTHING_FREE', message: 'Чөлөөт ажил алга', availableUnits: 0 };
  const want = wantUnits === undefined || wantUnits === null ? free : wantUnits;
  if (!isUnits(want) || want <= 0 || want > free) {
    return { ok: false, code: 'BAD_VALUE', message: 'Хүссэн хэмжээ чөлөөт ажлаас их байна', availableUnits: free };
  }
  const prev = state.rows.find((r) => r.userId === userId);
  const activeCount = state.rows.filter((r) => futureUnitsOf(r) > 0).length;
  if (!prev && activeCount >= MAX_ACTIVE_ALLOCATIONS) {
    return { ok: false, code: 'TOO_MANY', message: `Хамгийн ихдээ ${MAX_ACTIVE_ALLOCATIONS} хүн`, availableUnits: free };
  }
  const rows = prev
    ? state.rows.map((r) => (r.userId === userId ? { ...r, targetUnits: r.targetUnits + want, floorUnits: r.doneUnits } : { ...r }))
    : [...state.rows.map((r) => ({ ...r })), { userId, doneUnits: 0, floorUnits: 0, targetUnits: want }];
  return {
    ok: true,
    state: { unattributedUnits: state.unattributedUnits, unallocatedUnits: free - want, rows },
    takenUnits: want,
    reactivated: !!prev,
  };
}

/* ------------------------------------------------------------------ */
/*  Харагдац: дугаар, мөрийн төлөв                                      */
/* ------------------------------------------------------------------ */

/** `17` + хэсгийн дугаар 3 → `17.3`.  Хэсгийн дугаар НЭГ удаа олгогдож хэзээ ч дахин ашиглагдахгүй. */
export function childLabel(rootNumber: string | number, ordinal: number): string {
  return `${rootNumber}.${ordinal}`;
}

/**
 * Байгалийн эрэмбэ: `17`, `17.1`, `17.2`, `17.10` (17.10 нь 17.2-оос ХОЙШ).  Тэмдэгт мөрөөр
 * харьцуулбал `17.10 < 17.2` болдог — тиймээс дугаар бүрээр.
 */
export function compareLabels(a: string, b: string): number {
  const pa = a.split('.').map((x) => Number(x));
  const pb = b.split('.').map((x) => Number(x));
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return a < b ? -1 : a > b ? 1 : 0;
    if (x !== y) return x - y;
  }
  return 0;
}
