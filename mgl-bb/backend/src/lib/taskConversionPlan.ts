/**
 * ХУУЧИН ТАСКИЙН БҮЛГИЙГ ХУВААРИЛАЛТ (managed root) РУУ ХӨРВҮҮЛЭХ — ЦЭВЭР ТӨЛӨВЛӨГӨӨ (2026-10-05).  D1 уншихгүй.
 *
 * Хуучин загварт нэг ажил хэд хэдэн таск болж хуваагдсан (хуулбар таск «(i/N)», ROOT бүлэг + дэд таск).  Шинэ загвар нэг
 * root таск (дотоод жин W) + хүн бүрийн хуваарилалт.  Бүлгийг нэгтгэхэд:
 *
 *   • Root = бүлгийн нэг таск; жин нь бүлгийн нийлбэр W = Σ wⱼ; бусад таск «нэгтгэгдсэн хэсэг» (жин 0, түүх хэвээр).
 *   • Нэгж хэвийн болголт: хэсэг j-ийн зорилт Tⱼ = 100% · wⱼ / W (хамгийн их үлдэгдлийн аргаар ЯГ 100%), хийсэн
 *     Dⱼ = Tⱼ · pⱼ/100 (pⱼ = хэсгийн сүүлийн батлагдсан хувь).  Тэгэхээр root-ийн явц = Σ wⱼ pⱼ / W — төслийн явц ЯГ хэвээр.
 *   • Хийсэн хэсэг ЗӨВХӨН нотолгоотой хүнд: хэсгийн оноо авсан хүн (`planSeed`, хуучин HWM-ийн ижил дүрэм) — эс бол эзэнгүй B.
 *     ХЭЗЭЭ Ч нэр зохиохгүй.  Ирээдүйн ажил (Tⱼ − Dⱼ) — менежерийн ил заасан хүнд, үгүй бол чөлөөт (U).
 *   • Шинэ оноо ҮҮСЭХГҮЙ: хуучин оноо мөр бүр seed слайс болж ЛАВЛАГДАНА (бусад хэсгийн task_id-тай хэвээр).
 *   • Түүх тогтвортой: төслийн явцын график нь одоогийн жингээр хуучин бичлэгээс сэргээгддэг тул root дээр огноо бүрд
 *     «бүлгийн жигнэсэн явц»-ыг нөхсөн (backfill) мөр бичиж, график өмнөхтэй ЯГ ижил хэвээр байлгана.
 *
 * Ангилал (нотолгооны ТҮВШИН, нэр/зэрэгцээ байрлал нотолгоо БИШ):
 *   already_managed — гишүүн аль хэдийн root эсвэл нэгтгэгдсэн хэсэг.
 *   organizational  — нэгтгэх боломжгүй бүтэц (өөр зураг, нэг гишүүн, жингүй гишүүн): төслийн явцын коэффициент өөр.
 *   proven_split    — системийн бичсэн бүлэг (`tasks.group_id`) + бүтэц зөв → менежер баталгаажуулж ХӨРВҮҮЛНЭ.
 *   ambiguous       — зөвхөн нэрийн хэв маяг/гараар сонгосон → админ ИЛ баталгаажуулалт, шалтгаантайгаар л хөрвүүлнэ.
 */
import { ROOT_TOTAL_UNITS, UNITS_PER_POINT, largestRemainder } from './taskUnits';
import { planSeed, type SeedCreditRow, type SeedEntry, type SeedSlice } from './taskSeed';
import { taskProjectCoef } from './taskCredit';
import { MAX_ALLOCATION_ROWS, checkRootInvariants, type AllocRow, type RootAllocState } from './taskAllocation';
import { nextEntryTs, projectionDate, sqliteTs } from './taskRootStore';

export const MAX_GROUP_MEMBERS = 12;
/** Дугуйлалтын хүлцэл: хэсэг тутамд ≤ 1 нэгж (root нэгжээр). */
const ROUNDING_UNITS_PER_MEMBER = 1;

export type ConversionEvidence = 'declared_group' | 'name_pattern' | 'manual';
export type GroupClass = 'proven_split' | 'ambiguous' | 'organizational' | 'already_managed';

export interface TimelinePoint {
  id: number;
  date: string;
  createdAt: string;
  /** Хэсгийн хувь × 10 000. */
  units: number;
}

export interface MemberInput {
  taskId: number;
  name: string;
  weight: number;
  sortOrder: number;
  componentId: number;
  drawingId: number;
  dueDate: string | null;
  startDate: string | null;
  lastEntryId: number;
  lastPointsId: number;
  /** Батлагдсан бичлэг (created_at, id өсөхөөр) — seed-ийн нотолгоо. */
  entries: SeedEntry[];
  credits: SeedCreditRow[];
  /** Батлагдсан бичлэг (date, created_at, id өсөхөөр) — түүхийн backfill. */
  timeline: TimelinePoint[];
  /** Явж буй албан таймертай хүмүүс. */
  runningTimerUsers: number[];
  managed: boolean;
  retired: boolean;
}

export interface GroupFacts {
  projectId: number;
  projectStatus: string | null;
  progressMode: string | null;
  drawingWeight: number;
  blockWeight: number;
  teamShare: number;
  evidence: ConversionEvidence;
}

export interface Classification {
  classification: GroupClass;
  /** Одоо хөрвүүлэх боломжтой (хориглох шалтгаан алга). */
  convertible: boolean;
  blockers: string[];
  warnings: string[];
}

/** Төлөвлөгөөг хөрвүүлэхэд ИЛ баталгаажуулалт хэрэгтэй юу (нотолгоо сул). */
export const needsExplicitConfirmation = (c: Classification): boolean => c.classification === 'ambiguous';

/* ------------------------------------------------------------------ */
/*  Нэрийн хэв маяг («Нэр (2/3)») — зөвхөн нэр дэвшигч олоход                */
/* ------------------------------------------------------------------ */

const SPLIT_NAME = /^(.*?)\s*\((\d{1,2})\/(\d{1,2})\)\s*$/;

export function parseSplitName(name: string): { base: string; index: number; count: number } | null {
  const m = SPLIT_NAME.exec(name.trim());
  if (!m) return null;
  const index = Number(m[2]);
  const count = Number(m[3]);
  if (!Number.isInteger(index) || !Number.isInteger(count) || count < 2 || index < 1 || index > count) return null;
  const base = (m[1] ?? '').trim();
  return base === '' ? null : { base, index, count };
}

export interface NameCandidateRow {
  id: number;
  drawingId: number;
  componentId: number;
  name: string;
  sortOrder: number;
}

/**
 * Нэрийн хэв маягаар НЭР ДЭВШИГЧ бүлэг: нэг зураг + ижил суурь нэр + 1..N бүгд бүрэн, давхардалгүй.
 * ⚠️ Энэ нь нотолгоо БИШ (хэн ч нэрийг ингэж өгч болно) — үр дүн нь үргэлж `ambiguous` (админы ил баталгаа).
 */
export function groupByNamePattern(rows: readonly NameCandidateRow[]): Array<{ key: string; drawingId: number; taskIds: number[] }> {
  const buckets = new Map<string, Array<{ id: number; index: number; count: number; drawingId: number }>>();
  for (const r of rows) {
    const p = parseSplitName(r.name);
    if (!p) continue;
    const key = `${r.drawingId}|${p.base.toLowerCase()}|${p.count}`;
    const list = buckets.get(key) ?? [];
    list.push({ id: r.id, index: p.index, count: p.count, drawingId: r.drawingId });
    buckets.set(key, list);
  }
  const out: Array<{ key: string; drawingId: number; taskIds: number[] }> = [];
  for (const [key, list] of buckets) {
    const count = list[0]!.count;
    const indexes = new Set(list.map((x) => x.index));
    if (list.length !== count || indexes.size !== count) continue; // бүрэн биш эсвэл давхардсан
    list.sort((a, b) => a.index - b.index);
    out.push({ key: `name:${key}`, drawingId: list[0]!.drawingId, taskIds: list.map((x) => x.id) });
  }
  return out.sort((a, b) => a.taskIds[0]! - b.taskIds[0]!);
}

/** Root-ийн шинэ нэр: бүх гишүүний суурь нэр ижил бол «(i/N)»-гүй суурь нэр, үгүй бол root-ийн нэр хэвээр. */
export function suggestedRootName(members: readonly MemberInput[], rootTaskId: number): string {
  const root = members.find((m) => m.taskId === rootTaskId);
  if (!root) return '';
  const bases = members.map((m) => parseSplitName(m.name)?.base ?? null);
  const first = bases[0];
  if (first && bases.every((b) => b !== null && b.toLowerCase() === first.toLowerCase())) return first;
  return root.name;
}

/* ------------------------------------------------------------------ */
/*  Ангилал                                                             */
/* ------------------------------------------------------------------ */

export function classifyGroup(members: readonly MemberInput[], facts: GroupFacts): Classification {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (members.some((m) => m.managed || m.retired)) {
    return { classification: 'already_managed', convertible: false, blockers: ['ALREADY_MANAGED'], warnings };
  }
  if (members.length < 2) {
    return { classification: 'organizational', convertible: false, blockers: ['SINGLE_MEMBER'], warnings };
  }
  if (members.length > MAX_GROUP_MEMBERS) {
    return { classification: 'organizational', convertible: false, blockers: [`TOO_MANY_MEMBERS:${members.length}`], warnings };
  }
  if (new Set(members.map((m) => m.drawingId)).size > 1) {
    // Өөр зургийн коэффициент өөр — нэгтгэвэл төслийн явц өөрчлөгдөнө.
    return { classification: 'organizational', convertible: false, blockers: ['DIFFERENT_DRAWINGS'], warnings };
  }
  if (members.some((m) => !(m.weight > 0))) {
    return { classification: 'organizational', convertible: false, blockers: ['ZERO_WEIGHT_MEMBER'], warnings };
  }
  if (new Set(members.map((m) => m.taskId)).size !== members.length) {
    return { classification: 'organizational', convertible: false, blockers: ['DUPLICATE_MEMBER'], warnings };
  }
  if (facts.projectStatus !== 'active') blockers.push('PROJECT_INACTIVE');
  if (facts.progressMode === 'hours') blockers.push('HOURS_MODE');
  if (!(facts.drawingWeight > 0) || !(facts.blockWeight > 0) || !(facts.teamShare > 0)) blockers.push('ZERO_STRUCTURE_WEIGHT');
  const running = members.flatMap((m) => m.runningTimerUsers.map((u) => `${m.taskId}:${u}`));
  if (running.length > 0) blockers.push('RUNNING_TIMER');
  const allDone = members.every((m) => lastUnits(m) >= ROOT_TOTAL_UNITS);
  if (allDone) blockers.push('ALL_DONE');
  const W = members.reduce((s, m) => s + m.weight, 0);
  if (W > 100 + 1e-9) warnings.push('WEIGHT_SUM_OVER_100');
  if (members.some((m) => m.entries.some((e) => e.source === 'split'))) warnings.push('LEGACY_SPLIT_DONE_PART');
  const classification: GroupClass = facts.evidence === 'declared_group' ? 'proven_split' : 'ambiguous';
  return { classification, convertible: blockers.length === 0, blockers, warnings };
}

const lastUnits = (m: MemberInput): number => (m.entries.length > 0 ? m.entries[m.entries.length - 1]!.units : 0);

/* ------------------------------------------------------------------ */
/*  Төлөвлөгөө                                                          */
/* ------------------------------------------------------------------ */

export interface PlannedMember {
  taskId: number;
  name: string;
  role: 'root' | 'retired';
  weightBefore: number;
  weightAfter: number;
  dueDateBefore: string | null;
  startDateBefore: string | null;
  latestPct: number;
  targetUnits: number;
  doneUnits: number;
  attribution: 'empty' | 'clean' | 'uncertain';
  reasons: string[];
  slackUnits: number;
  unattributedUnits: number;
  futureOwner: number | null;
}

export interface PlannedSlice extends SeedSlice {
  memberTaskId: number;
}

export interface PlannedAllocation {
  userId: number;
  ordinal: number;
  doneUnits: number;
  floorUnits: number;
  targetUnits: number;
}

export interface BackfillRow {
  date: string;
  createdAt: string;
  units: number;
}

export interface ConversionPlan {
  ok: true;
  rootTaskId: number;
  rootNameBefore: string;
  rootNameAfter: string;
  /** Бүлгийн жингийн нийлбэр = root-ийн шинэ жин. */
  weight: number;
  coef: number;
  members: PlannedMember[];
  allocations: PlannedAllocation[];
  unattributedUnits: number;
  unallocatedUnits: number;
  slackUnits: number;
  rootDoneUnits: number;
  seedAttribution: 'empty' | 'clean' | 'uncertain';
  slices: PlannedSlice[];
  backfill: BackfillRow[];
  projection: { units: number; date: string; createdAt: string } | null;
  /** Жигнэсэн таскийн оноогоор (нэг зургийн дотор): өмнө = Σ wⱼ pⱼ/100, хойно = W · root/100. */
  rollup: { before: number; after: number; delta: number; toleranceUnits: number };
  warnings: string[];
  state: RootAllocState;
}

export type PlanFailure = { ok: false; code: string; message: string; details?: Record<string, unknown> };

export interface PlanInput {
  members: readonly MemberInput[];
  facts: GroupFacts;
  rootTaskId: number;
  /** Root-ийн шинэ нэр (үгүй бол `suggestedRootName`). */
  rootName?: string | null;
  /** Гишүүн таск → түүний ИРЭЭДҮЙН ажлыг эзлэх хүн (менежерийн ил шийдвэр).  Байхгүй бол чөлөөт (U). */
  futureOwners?: Readonly<Record<number, number>>;
  nowMs: number;
  today: string;
  /** Root-ийн (`progress_entries.created_at`)-ийн хамгийн сүүлийнх — projection-ийн дараалал. */
  lastRootCreatedAt: string | null;
}

const fail = (code: string, message: string, details?: Record<string, unknown>): PlanFailure => ({ ok: false, code, message, details });

function tsMs(ts: string): number {
  const iso = ts.includes('T') ? ts : `${ts.replace(' ', 'T')}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

export function planConversion(input: PlanInput): ConversionPlan | PlanFailure {
  const { facts } = input;
  const members = [...input.members].sort((a, b) => a.sortOrder - b.sortOrder || a.taskId - b.taskId);
  const classification = classifyGroup(members, facts);
  if (!classification.convertible) {
    return fail(classification.blockers[0]!.split(':')[0]!, `Бүлгийг хөрвүүлэх боломжгүй: ${classification.blockers.join(', ')}`, {
      blockers: classification.blockers,
      classification: classification.classification,
    });
  }
  const root = members.find((m) => m.taskId === input.rootTaskId);
  if (!root) return fail('ROOT_NOT_IN_GROUP', 'Root таск бүлгийн гишүүн биш');

  const W = members.reduce((s, m) => s + m.weight, 0);
  const coef = taskProjectCoef({
    taskWeight: W,
    drawingWeight: facts.drawingWeight,
    blockWeight: facts.blockWeight,
    teamShare: facts.teamShare,
  });
  if (!(coef > 0)) return fail('ZERO_COEF', 'Төслийн коэффициент 0 — хөрвүүлэх боломжгүй');

  const targets = largestRemainder(
    ROOT_TOTAL_UNITS,
    members.map((m) => m.weight),
  );
  if (targets.length !== members.length) return fail('BAD_WEIGHTS', 'Жин буруу');

  const warnings = [...classification.warnings];
  const plannedMembers: PlannedMember[] = [];
  const slices: PlannedSlice[] = [];
  const rows = new Map<number, AllocRow>();
  const order: number[] = [];
  let B = 0;
  let U = 0;
  let slack = 0;
  let rootDone = 0;
  let before = 0;
  let allClean = true;
  let anyEntries = false;
  const touch = (userId: number): AllocRow => {
    let r = rows.get(userId);
    if (!r) {
      r = { userId, doneUnits: 0, floorUnits: 0, targetUnits: 0 };
      rows.set(userId, r);
      order.push(userId);
    }
    return r;
  };

  members.forEach((m, j) => {
    const T = targets[j]!;
    // Хэсгийн хувийг root нэгж рүү Tⱼ-ээр хөрвүүлнэ (жингээр биш): 100% → ЯГ Tⱼ, дугуйлалтын үлдэгдэл үлдэхгүй.
    const scale = T / ROOT_TOTAL_UNITS;
    const latestUnits = lastUnits(m);
    if (m.entries.length > 0) anyEntries = true;
    before += (m.weight * latestUnits) / ROOT_TOTAL_UNITS;

    const scaledEntries: SeedEntry[] = m.entries.map((e) => ({ ...e, units: Math.round(e.units * scale) }));
    const seed = planSeed({ entries: scaledEntries, credits: m.credits, coef });
    let attribution: PlannedMember['attribution'];
    let reasons: string[];
    let memberSlices: SeedSlice[];
    let memberB: number;
    let memberSlack: number;
    let done: number;
    if (!seed.ok) {
      if (seed.code === 'SPLIT_DONE_PART') {
        // Хуучин хуваалтын «хийгдсэн хэсэг» (100%) — оноо нь өмнөх хүмүүст хувь тэнцүүлэн хуваагдсан тул хэнийх нь тодорхойгүй.
        done = scaledEntries.length > 0 ? scaledEntries[scaledEntries.length - 1]!.units : 0;
        attribution = 'uncertain';
        reasons = ['SPLIT_DONE_PART', 'UNCERTAIN_ALL_UNATTRIBUTED'];
        memberSlices = [];
        memberB = done;
        memberSlack = 0;
      } else {
        return fail('BAD_SEED', `Гишүүн ${m.taskId}-ийн түүхийг шинжилж чадсангүй: ${seed.message}`, { taskId: m.taskId });
      }
    } else {
      attribution = seed.attribution;
      reasons = [...seed.reasons];
      memberSlices = seed.slices.map((s) => ({ ...s }));
      memberB = seed.unattributedUnits;
      memberSlack = seed.slackUnits;
      done = seed.rootDoneUnits;
    }

    // Дугуйлалтаас болж Dⱼ > Tⱼ бол Tⱼ-д тайрна, слайсыг ардаас нь хасна (B = Dⱼ − Σ слайс).
    if (done > T) {
      reasons.push(`CLAMPED_TO_TARGET:${done - T}`);
      done = T;
    }
    let sliceSum = memberSlices.reduce((s, x) => s + x.units, 0);
    for (let i = memberSlices.length - 1; i >= 0 && sliceSum > done; i--) {
      const cut = Math.min(sliceSum - done, memberSlices[i]!.units);
      memberSlices[i]!.units -= cut;
      sliceSum -= cut;
    }
    memberSlices = memberSlices.filter((s) => s.units > 0);
    sliceSum = memberSlices.reduce((s, x) => s + x.units, 0);
    memberB = done - sliceSum;
    if (attribution !== 'clean' && attribution !== 'empty') allClean = false;
    if (attribution === 'clean' && memberB > 0) allClean = false;

    for (const s of memberSlices) {
      const r = touch(s.userId);
      r.doneUnits += s.units;
      r.floorUnits += s.units;
      r.targetUnits += s.units;
      slices.push({ ...s, memberTaskId: m.taskId });
    }
    B += memberB;
    slack += memberSlack;
    rootDone += done;

    const future = T - done;
    const owner = input.futureOwners?.[m.taskId] ?? null;
    if (owner !== null) touch(owner).targetUnits += future;
    else U += future;

    plannedMembers.push({
      taskId: m.taskId,
      name: m.name,
      role: m.taskId === root.taskId ? 'root' : 'retired',
      weightBefore: m.weight,
      weightAfter: m.taskId === root.taskId ? W : 0,
      dueDateBefore: m.dueDate,
      startDateBefore: m.startDate,
      latestPct: latestUnits / UNITS_PER_POINT,
      targetUnits: T,
      doneUnits: done,
      attribution,
      reasons,
      slackUnits: memberSlack,
      unattributedUnits: memberB,
      futureOwner: owner,
    });
  });

  const ordered = order.map((u) => rows.get(u)!);
  const state: RootAllocState = { unattributedUnits: B, unallocatedUnits: U, rows: ordered };
  const invariant = checkRootInvariants(state);
  if (invariant.length > 0) return fail('INVARIANT', `Хөрвүүлсний дараах төлөв инвариант зөрчив: ${invariant[0]}`, { invariant });
  if (ordered.length > MAX_ALLOCATION_ROWS) return fail('TOO_MANY', 'Оролцогч хэт олон байна');

  // Төслийн явц хэвээр эсэх: нэг зургийн дотор root-ийн жигнэсэн хувь = Σ wⱼ pⱼ/100.
  const after = (W * rootDone) / ROOT_TOTAL_UNITS;
  const toleranceUnits = ROUNDING_UNITS_PER_MEMBER * members.length;
  const toleranceWeighted = (toleranceUnits * W) / ROOT_TOTAL_UNITS;
  const delta = after - before;
  if (Math.abs(delta) > toleranceWeighted + 1e-9) {
    return fail('ROLLUP_DRIFT', 'Хөрвүүлэлт төслийн явцыг өөрчлөх байна — зогсоов', { before, after, delta });
  }

  const allocations: PlannedAllocation[] = ordered.map((r, i) => ({
    userId: r.userId,
    ordinal: i + 1,
    doneUnits: r.doneUnits,
    floorUnits: r.floorUnits,
    targetUnits: r.targetUnits,
  }));

  // ── Түүхийн backfill: огноо бүрд «бүлгийн жигнэсэн явц» root дээр ──────────────────────────────
  const dates = [...new Set(members.flatMap((m) => m.timeline.map((p) => p.date)))].sort();
  const backfill: BackfillRow[] = [];
  let prevMs = 0;
  for (const d of dates) {
    let weighted = 0;
    let maxCreated = 0;
    members.forEach((m, j) => {
      let latest = 0;
      for (const p of m.timeline) {
        if (p.date <= d) latest = p.units;
        else break;
      }
      weighted += targets[j]! * latest;
      for (const p of m.timeline) if (p.date === d) maxCreated = Math.max(maxCreated, tsMs(p.createdAt));
    });
    const createdMs = Math.max(maxCreated + 1000, prevMs + 1000);
    prevMs = createdMs;
    backfill.push({ date: d, createdAt: sqliteTs(createdMs), units: Math.round(weighted / ROOT_TOTAL_UNITS) });
  }

  let projection: ConversionPlan['projection'] = null;
  if (anyEntries || rootDone > 0) {
    const lastBackfill = backfill.length > 0 ? backfill[backfill.length - 1]!.createdAt : null;
    const lastCreated = [input.lastRootCreatedAt, lastBackfill].filter((x): x is string => !!x).sort().pop() ?? null;
    const lastDate = dates.length > 0 ? dates[dates.length - 1]! : null;
    projection = {
      units: rootDone,
      date: projectionDate(input.today, lastDate),
      createdAt: nextEntryTs(lastCreated, input.nowMs),
    };
  }

  const attribution: ConversionPlan['seedAttribution'] = !anyEntries && rootDone === 0 ? 'empty' : allClean ? 'clean' : 'uncertain';
  if (B > 0) warnings.push(`UNATTRIBUTED_DONE:${B}`);
  if (U > 0 && !input.futureOwners) warnings.push('FUTURE_WORK_UNALLOCATED');

  return {
    ok: true,
    rootTaskId: root.taskId,
    rootNameBefore: root.name,
    rootNameAfter: (input.rootName ?? '').trim() || suggestedRootName(members, root.taskId),
    weight: W,
    coef,
    members: plannedMembers,
    allocations,
    unattributedUnits: B,
    unallocatedUnits: U,
    slackUnits: slack,
    rootDoneUnits: rootDone,
    seedAttribution: attribution,
    slices,
    backfill,
    projection,
    rollup: { before, after, delta, toleranceUnits },
    warnings,
    state,
  };
}
