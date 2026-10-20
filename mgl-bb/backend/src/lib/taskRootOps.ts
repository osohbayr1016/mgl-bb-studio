/**
 * ТАСКИЙН ХУВААРИЛАЛТ — МУТАЦИУД (2026-10-02): хуваах/засах, өөрийн явц, буцаах/шилжүүлэх, дахин авах.
 *
 * Бүгд НЭГ `db.batch` (D1 транзакц) + marker (`taskRootStore.ts`): хуучирсан revision юу ч бичихгүй, ижил
 * `request_id` дахин ирвэл анхны үр дүн буцна.  Цэвэр дүрэм: `taskAllocation.ts`, `taskCredit.ts`, `taskSeed.ts`.
 *
 * Хориотой зүйлс (эзний шийдвэр):
 *   • дотоод жин `W` ХЭЗЭЭ Ч өөрчлөгдөхгүй, шинэ таск үүсэхгүй;
 *   • хийсэн хэсэг (`D`) бусдад шилжихгүй — зөвхөн ирээдүйн ажил (T − D) чөлөөлөгдөнө;
 *   • хуваалт/засвар/буцаалт НЭГ Ч шинэ оноо олгохгүй, хуучин оноог хөдөлгөхгүй (seed ч гэсэн лавлана л);
 *   • шинэ хүний таймерыг эхлүүлэхгүй (тэр өөрөө ▶ дарна).
 */
import type { Env } from '../types';
import { createNotification } from './notify';
import { isCeo } from './ceo';
import { todayInUB } from './time';
import {
  MAX_ACTIVE_ALLOCATIONS,
  applyFinalTargets,
  checkRootInvariants,
  futureUnitsOf,
  planOwnProgress,
  planRelease,
  planRetake,
  rootDoneUnits,
  rootRemainingUnits,
  type AllocationMode,
  type FinalTarget,
  type RootAllocState,
} from './taskAllocation';
import { planReversal, planWorkCredit, type OpenSlice, type ReversalPart } from './taskCredit';
import {
  ParamBag,
  loadOp,
  participantStatus,
  rootView,
  type ParticipantView,
  type RootView,
  loadRoot,
  loadSeedEvidence,
  loadTaskFacts,
  markerExists,
  nextEntryTs,
  projectionDate,
  runGuardedBatch,
  stateFromSeed,
  structureGuardSql,
  toRootState,
  type AllocationRecord,
  type RootSnapshot,
  type TaskFacts,
} from './taskRootStore';
import { planSeed } from './taskSeed';
import { mergedLabel, planParts, reservedUnitsOf, squashLabel, type PartInput, type PartRecord } from './taskParts';
import { closeSetSql } from './taskTimerStore';
import { parseCompletionQuestions } from './taskCompletionAi';
import {
  hasPostEffects,
  payloadHash,
  retryPostCommit,
  settlePostCommit,
  type PostEffects,
} from './taskPostCommit';
import { logTaskAlloc } from './taskAllocLog';
import { orgDateOfUtc } from './dailyAverage';
import { canTakeRole, isSplittableTask } from './taskTake';
import { ROOT_TOTAL_UNITS, UNITS_PER_POINT, isUnits } from './taskUnits';

/* ------------------------------------------------------------------ */
/*  Нийтлэг төрлүүд                                                     */
/* ------------------------------------------------------------------ */

export interface OpCtx {
  db: D1Database;
  ai?: Env['AI'];
  waitUntil?: (p: Promise<unknown>) => void;
  /** Тестэд тогтмол цаг. */
  nowMs?: number;
  today?: string;
}

export interface Actor {
  sub: number;
  role: string;
}

export type OpFailStatus = 400 | 403 | 404 | 409;

export interface OpFail {
  ok: false;
  status: OpFailStatus;
  code: string;
  message: string;
  /** Клиентэд буцах нэмэлт өгөгдөл (одоогийн төлөв, дутуу асуулт …). */
  extra?: Record<string, unknown>;
}

export interface OpOk<T> {
  ok: true;
  data: T;
  /** Ижил request_id дахин ирсэн — анхны үр дүнг буцаав. */
  replayed?: boolean;
}

export type OpResult<T> = OpOk<T> | OpFail;

export const fail = (status: OpFailStatus, code: string, message: string, extra?: Record<string, unknown>): OpFail => ({
  ok: false,
  status,
  code,
  message,
  ...(extra ? { extra } : {}),
});

export { participantStatus, rootView };
export type { ParticipantView, RootView };

export const isManagerRole = (role: string): boolean => role === 'admin' || role === 'senior';

/* ------------------------------------------------------------------ */
/*  Туслахууд                                                           */
/* ------------------------------------------------------------------ */

export function mk(db: D1Database, build: (b: ParamBag) => string): D1PreparedStatement {
  const bag = new ParamBag();
  const sql = build(bag);
  return db.prepare(sql).bind(...bag.values);
}

export interface MarkerSpec {
  requestId: string;
  taskId: number;
  userId: number;
  kind: string;
  revBefore: number;
  revAfter: number;
  beforeJson: string;
  afterJson: string;
  resultJson: string;
  guard: (b: ParamBag) => string;
  /** Хүсэлтийн агуулгын SHA-256 (0383) — ижил request_id өөр агуулгатай дахин ирвэл татгалзана. */
  requestHash?: string | null;
  /** commit-ийн ДАРААХ үр дагавар (архив, snapshot, засварын цаг) — байвал `post_status = 'pending'`. */
  post?: PostEffects | null;
}

export function markerStmt(db: D1Database, m: MarkerSpec): D1PreparedStatement {
  const post = m.post && hasPostEffects(m.post) ? m.post : null;
  return mk(
    db,
    (b) => `INSERT INTO task_ops
              (request_id, task_id, user_id, kind, root_revision_before, root_revision_after,
               before_json, after_json, result_json, request_hash, post_status, post_json)
            SELECT ${b.add(m.requestId)}, ${b.add(m.taskId)}, ${b.add(m.userId)}, ${b.add(m.kind)},
                   ${b.add(m.revBefore)}, ${b.add(m.revAfter)},
                   ${b.add(m.beforeJson)}, ${b.add(m.afterJson)}, ${b.add(m.resultJson)},
                   ${b.add(m.requestHash ?? null)}, ${b.add(post ? 'pending' : 'done')}, ${b.add(post ? JSON.stringify(post) : null)}
             WHERE ${m.guard(b)}`,
  );
}

/** Managed болоогүй таскийг seed-ээр managed болгох CAS: root байхгүй, хуучин түүх seed-ээс хойш өөрчлөгдөөгүй
 *  (зэрэг ирсэн хуучин хувь/оноо бичилт seed-ийг хуучруулна). */
const seedGuard = (taskId: number, facts: TaskFacts) => (b: ParamBag) =>
  `NOT EXISTS (SELECT 1 FROM task_roots r WHERE r.task_id = ${b.add(taskId)})
   AND NOT EXISTS (SELECT 1 FROM task_conversion_members cm WHERE cm.task_id = ${b.add(taskId)})
   AND COALESCE((SELECT MAX(x.id) FROM progress_entries x WHERE x.task_id = ${b.add(taskId)} AND x.status = 'approved'), 0) = ${b.add(facts.lastEntryId)}
   AND COALESCE((SELECT MAX(u.id) FROM user_points u WHERE u.task_id = ${b.add(taskId)} AND u.source = 'progress'), 0) = ${b.add(facts.lastPointsId)}`;

/** managed root-ийн CAS: revision таарсан. */
const managedGuard = (taskId: number, rev: number) => (b: ParamBag) =>
  `EXISTS (SELECT 1 FROM task_roots r WHERE r.task_id = ${b.add(taskId)} AND r.revision = ${b.add(rev)})`;

export const stateJson = (s: RootAllocState): string => JSON.stringify(s);

/** `request_id` хэлбэр: хоосон биш, ≤ 80 тэмдэгт, хяналтын тэмдэггүй. */
export function validRequestId(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 8 && v.length <= 80 && /^[A-Za-z0-9._:-]+$/.test(v);
}

export async function loadUsers(
  db: D1Database,
  ids: readonly number[],
): Promise<Map<number, { role: string; status: string | null; full_name: string | null }>> {
  const out = new Map<number, { role: string; status: string | null; full_name: string | null }>();
  if (ids.length === 0) return out;
  const marks = ids.map(() => '?').join(',');
  const { results } = await db
    .prepare(`SELECT id, role, status, full_name FROM users WHERE id IN (${marks})`)
    .bind(...ids)
    .all<{ id: number; role: string; status: string | null; full_name: string | null }>();
  for (const u of results ?? []) out.set(u.id, { role: u.role, status: u.status, full_name: u.full_name });
  return out;
}

/** Ирээдүйн ажил эзлэх боломжтой (идэвхтэй, таск авах эрхтэй) хүн. */
export function canHoldAllocation(u: { role: string; status: string | null } | undefined, userId: number): boolean {
  if (!u) return false;
  if ((u.status ?? 'active') !== 'active') return false;
  return canTakeRole(u.role, isCeo(userId));
}

/** Хуваарилалт хийх боломжтой таск эсэх (төсөл идэвхтэй, цагаар бодогддоггүй, жинтэй). */
function checkTaskGate(
  facts: TaskFacts,
  opts: { requireSplittable: boolean; allowAutoArchived?: boolean },
): OpFail | null {
  if (!facts.exists) return fail(404, 'TASK_NOT_FOUND', 'Таск олдсонгүй');
  if (facts.progressMode === 'hours') {
    return fail(409, 'HOURS_MODE', 'Цагаар бодогддог төслийн таскийг хуваахгүй');
  }
  // Хувь 100 хүрч АВТОМАТААР архивлагдсан төсөл дээр залруулга хийж болно (дахин нээгдэнэ); гараар архивласан бол үгүй.
  const autoArchived = facts.projectStatus === 'archived' && facts.autoArchivedAt !== null;
  if (facts.projectStatus !== 'active' && !(opts.allowAutoArchived && autoArchived)) {
    return fail(409, 'PROJECT_INACTIVE', 'Төсөл идэвхгүй тул таск дээр ажиллах боломжгүй');
  }
  if (opts.requireSplittable && !isSplittableTask({ progress_mode: facts.progressMode, weight_percent: facts.weight })) {
    return fail(409, 'NOT_SPLITTABLE', 'Жингүй таскийг хуваах боломжгүй');
  }
  return null;
}

async function staleFail(db: D1Database, taskId: number): Promise<OpFail> {
  const snap = await loadRoot(db, taskId);
  return fail(409, 'STALE_REVISION', 'Таск зэрэг өөрчлөгдсөн — шинэчлэгдсэн төлөвийг харуулав', {
    current: snap ? rootView(snap) : null,
  });
}

/**
 * Ижил request_id дахин ирсэн үед хадгалсан үр дүн.  Өөр таск/хэрэглэгч/үйлдэл ЭСВЭЛ өөр АГУУЛГАТАЙ (request_hash)
 * ашиглагдсан бол татгалзана — өмнө нь чимээгүй анхны үр дүнг буцааж, хэрэглэгчийн ШИНЭ утга алдагдах боломжтой байв.
 * Хэш нь 0383-аас өмнөх мөрүүдэд NULL — тэдгээрийг харьцуулахгүй (хуучин зан төлөв).
 * Commit-ийн дараах үр дагавар `pending` байвал (хариу алдагдаж клиент дахин оролдсон) ЭНД дахин ажиллуулна.
 */
async function replayOf<T>(
  ctx: OpCtx,
  requestId: string,
  taskId: number,
  userId: number,
  kind: string,
  hash: string | null,
): Promise<OpResult<T> | null> {
  const prior = await loadOp(ctx.db, requestId);
  if (!prior) return null;
  if (prior.taskId !== taskId || prior.userId !== userId || prior.kind !== kind) {
    return fail(409, 'REQUEST_REUSED', 'Энэ request_id өөр үйлдэлд ашиглагдсан');
  }
  if (prior.requestHash !== null && hash !== null && prior.requestHash !== hash) {
    return fail(409, 'REQUEST_REUSED', 'Энэ request_id өөр агуулгатай хүсэлтэд ашиглагдсан — шинэ хүсэлтэд шинэ request_id хэрэглэнэ');
  }
  if (prior.postStatus !== 'done') retryPostCommit(ctx, requestId);
  return { ok: true, data: JSON.parse(prior.resultJson) as T, replayed: true };
}

/**
 * `progress` үйлдлийн marker-т хадгалсан `result_json` нь progress_entries-ийн id тодорхой болохоос ӨМНӨ бичигддэг тул
 * `entry_id = null`.  Replay хариу анхных шигээ ИЖИЛ байхын тулд id-г журнал (`task_contributions.progress_entry_id`)-аас нөхнө.
 */
async function withEntryId(db: D1Database, requestId: string, data: ProgressData): Promise<ProgressData> {
  if (data.entry_id !== null) return data;
  const row = await db
    .prepare('SELECT progress_entry_id FROM task_contributions WHERE request_id = ? AND progress_entry_id IS NOT NULL ORDER BY seq LIMIT 1')
    .bind(requestId)
    .first<{ progress_entry_id: number }>();
  return row ? { ...data, entry_id: row.progress_entry_id } : data;
}

/* ------------------------------------------------------------------ */
/*  1. ХУВААХ / ЗАСАХ  (managed болгох анхны үйлдэл ч энэ)              */
/* ------------------------------------------------------------------ */

export interface SplitInput {
  taskId: number;
  requestId: string;
  /** Одоогийн root revision; managed болоогүй таскт 0 / null. */
  expectedRevision: number | null;
  /** Аудитад: хэрэглэгч аль горимоор бичсэн ('total' = нийт зорилт, 'remainder' = үлдсэний хувь). */
  mode: AllocationMode;
  /** ЭЦСИЙН зорилтууд (нэгжээр) — сервер тэнцвэржүүлэлтийг дахин зохиохгүй, инвариант л шалгана. */
  targets: FinalTarget[];
}

export interface SplitData {
  root: RootView;
  converted: boolean;
  created: number[];
  released: number[];
  dropped: number[];
}

export async function applyAllocation(ctx: OpCtx, actor: Actor, p: SplitInput): Promise<OpResult<SplitData>> {
  const { db } = ctx;
  if (!validRequestId(p.requestId)) return fail(400, 'BAD_REQUEST_ID', 'request_id буруу');
  if (!Number.isInteger(p.taskId) || p.taskId <= 0) return fail(400, 'BAD_TASK', 'Таск буруу');
  const hash = await payloadHash('split', {
    mode: p.mode,
    targets: [...p.targets].sort((a, b) => a.userId - b.userId).map((t) => [t.userId, t.targetUnits]),
  });
  const replay = await replayOf<SplitData>(ctx, p.requestId, p.taskId, actor.sub, 'split', hash);
  if (replay) return replay;

  const facts = await loadTaskFacts(db, p.taskId);
  const gate = checkTaskGate(facts, { requireSplittable: true });
  if (gate) return gate;

  const snap = await loadRoot(db, p.taskId);
  const converting = snap === null;
  if (snap) {
    if (p.expectedRevision !== snap.root.revision) return staleFail(db, p.taskId);
  } else if (p.expectedRevision !== null && p.expectedRevision !== 0) {
    return staleFail(db, p.taskId);
  }

  // Эхний төлөв: managed бол D1-ийн, үгүй бол хуучин түүхээс seed.
  let state: RootAllocState;
  let seedOrder: number[] = [];
  let seedPlan: Extract<ReturnType<typeof planSeed>, { ok: true }> | null = null;
  if (snap) {
    state = snap.state;
  } else {
    if (facts.latestPct >= 100) return fail(409, 'TASK_COMPLETED', 'Дууссан таскийг хуваах боломжгүй');
    const ev = await loadSeedEvidence(db, p.taskId);
    const plan = planSeed({ entries: ev.entries, credits: ev.credits, coef: facts.coef });
    if (!plan.ok) return fail(409, plan.code, plan.message);
    seedPlan = plan;
    const seeded = stateFromSeed(plan);
    state = seeded.state;
    seedOrder = seeded.order;
  }

  // Эрх: managed бол оролцогч эсвэл ахлах/админ; managed болоогүй бол таск авах эрхтэй ажилтан (хуучин
  // «бүх ажилтан хуваана» дүрэм — тухайн таскт оролцогч гэсэн ойлголт байхгүй).
  if (snap) {
    const isParticipant = snap.allocations.some((a) => a.userId === actor.sub);
    if (!isParticipant && !isManagerRole(actor.role)) {
      return fail(403, 'NOT_PARTICIPANT', 'Зөвхөн энэ ажлын оролцогч эсвэл ахлах/админ хуваарилалтыг засна');
    }
  } else if (!isManagerRole(actor.role) && !canTakeRole(actor.role, isCeo(actor.sub))) {
    return fail(403, 'ROLE_NOT_ALLOWED', 'Таны эрхээр таск хуваах боломжгүй');
  }

  // Шинэ хүмүүсийн эрх.
  const knownIds = new Set(state.rows.map((r) => r.userId));
  const newIds = p.targets.filter((t) => !knownIds.has(t.userId)).map((t) => t.userId);
  const users = await loadUsers(db, newIds);
  for (const id of newIds) {
    if (!canHoldAllocation(users.get(id), id)) {
      return fail(400, 'USER_NOT_ELIGIBLE', 'Энэ хүн таск дээр ажиллах эрхгүй эсвэл идэвхгүй байна', { user_id: id });
    }
  }

  // Хүнгүй хэсгүүд (0394) нь U-ийн доторх НӨӨЦ: хүмүүсийн хуваарилалт тэднийг эзэлж БОЛОХГҮЙ.  Цэвэр төлөвлөгч (frontend-тэй
  // байт-ижил ихэр) хөндөхгүйн тулд нөөцийг түр «түгжигдсэн» (B) гэж тооцоод, үр дүнд нь U = нөөц болгож буцаана.
  const reserved = reservedUnitsOf(snap?.parts ?? []);
  if (reserved > state.unallocatedUnits) return fail(409, 'INVARIANT', 'Хүнгүй хэсгүүд хуваарилагдаагүй ажлаас их байна');
  const applied = applyFinalTargets(
    { ...state, unattributedUnits: state.unattributedUnits + reserved, unallocatedUnits: state.unallocatedUnits - reserved },
    p.targets,
  );
  if (!applied.ok) {
    return fail(applied.code === 'TOO_MANY' || applied.code === 'DUPLICATE_USER' || applied.code === 'BAD_VALUE' ? 400 : 409, applied.code, applied.message, {
      ...(applied.userId !== undefined ? { user_id: applied.userId } : {}),
    });
  }
  const next: RootAllocState = { ...applied.state, unattributedUnits: state.unattributedUnits, unallocatedUnits: reserved };

  // Ordinal: seed хийсэн хүмүүс эхэлж (1..k), дараа нь шинэ хүмүүс; одоо байгаа мөр өөрийн дугаараа хадгална.
  const existingAlloc = new Map<number, AllocationRecord>((snap?.allocations ?? []).map((a) => [a.userId, a]));
  let nextOrdinal = snap ? snap.root.nextOrdinal : 1;
  const ordinalOf = new Map<number, number>();
  for (const a of snap?.allocations ?? []) ordinalOf.set(a.userId, a.ordinal);
  for (const uid of seedOrder) ordinalOf.set(uid, nextOrdinal++);
  const prevByUser = new Map(state.rows.map((r) => [r.userId, r]));

  interface Planned {
    userId: number;
    ordinal: number;
    done: number;
    floor: number;
    target: number;
    released: number;
    insert: boolean;
  }
  const planned: Planned[] = [];
  for (const row of next.rows) {
    let ord = ordinalOf.get(row.userId);
    if (ord === undefined) {
      ord = nextOrdinal++;
      ordinalOf.set(row.userId, ord);
    }
    const prev = prevByUser.get(row.userId);
    const oldFuture = prev ? prev.targetUnits - prev.doneUnits : 0;
    const newFuture = row.targetUnits - row.doneUnits;
    const prevReleased = existingAlloc.get(row.userId)?.releasedUnits ?? 0;
    planned.push({
      userId: row.userId,
      ordinal: ord,
      done: row.doneUnits,
      floor: row.floorUnits,
      target: row.targetUnits,
      released: oldFuture > 0 && newFuture === 0 ? oldFuture : newFuture > 0 ? 0 : prevReleased,
      // Seed-ийн хүн ч (managed болоогүй үед) DB-д байхгүй тул INSERT.
      insert: !existingAlloc.has(row.userId),
    });
  }
  const droppedInDb = applied.dropped.filter((id) => existingAlloc.has(id));

  // Хариуг (нэг удаа тооцоолоод marker-т хадгална).
  const revBefore = snap ? snap.root.revision : 0;
  const revAfter = revBefore + 1;
  const afterAllocs: AllocationRecord[] = planned
    .map((r) => ({
      id: existingAlloc.get(r.userId)?.id ?? 0,
      userId: r.userId,
      ordinal: r.ordinal,
      doneUnits: r.done,
      floorUnits: r.floor,
      targetUnits: r.target,
      releasedUnits: r.released,
      revision: (existingAlloc.get(r.userId)?.revision ?? 0) + 1,
    }))
    .sort((a, b) => a.ordinal - b.ordinal);
  const afterRoot = {
    taskId: p.taskId,
    revision: revAfter,
    unattributedUnits: next.unattributedUnits,
    unallocatedUnits: reserved,
    slackUnits: snap ? snap.root.slackUnits : (seedPlan?.slackUnits ?? 0),
    nextOrdinal,
    seedAttribution: snap ? snap.root.seedAttribution : (seedPlan?.attribution ?? null),
    completedAt: snap ? snap.root.completedAt : null,
  };
  const afterState = toRootState(afterRoot, afterAllocs);
  const invariant = checkRootInvariants(afterState);
  if (invariant.length > 0) return fail(409, 'INVARIANT', `Хуваарилалт инвариант зөрчив: ${invariant[0]}`);
  const data: SplitData = {
    root: rootView({ root: afterRoot, allocations: afterAllocs, state: afterState, parts: snap?.parts ?? [] }),
    converted: converting,
    created: applied.created,
    released: applied.released,
    dropped: applied.dropped,
  };

  const nowMs = ctx.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const rid = p.requestId;
  const stmts: D1PreparedStatement[] = [];

  stmts.push(
    markerStmt(db, {
      requestId: rid,
      taskId: p.taskId,
      userId: actor.sub,
      kind: 'split',
      requestHash: hash,
      revBefore,
      revAfter,
      beforeJson: stateJson(state),
      afterJson: stateJson(afterState),
      resultJson: JSON.stringify(data),
      guard: snap
        ? managedGuard(p.taskId, revBefore)
        : seedGuard(p.taskId, facts),
    }),
  );

  if (converting) {
    stmts.push(
      mk(
        db,
        (b) => `INSERT INTO task_roots
                  (task_id, revision, unattributed_units, unallocated_units, slack_units, next_ordinal,
                   seed_attribution, seed_json, created_by)
                SELECT ${b.add(p.taskId)}, ${b.add(revAfter)}, ${b.add(afterRoot.unattributedUnits)}, 0,
                       ${b.add(afterRoot.slackUnits)}, ${b.add(nextOrdinal)},
                       ${b.add(afterRoot.seedAttribution)},
                       ${b.add(JSON.stringify({ reasons: seedPlan?.reasons ?? [], latest_units: seedPlan?.rootDoneUnits ?? 0, slices: seedPlan?.slices.length ?? 0 }))},
                       ${b.add(actor.sub)}
                 WHERE ${markerExists(b, rid)}`,
      ),
    );
  } else {
    stmts.push(
      mk(
        db,
        (b) => `UPDATE task_roots
                   SET revision = ${b.add(revAfter)}, unallocated_units = ${b.add(reserved)}, next_ordinal = ${b.add(nextOrdinal)},
                       updated_at = datetime('now')
                 WHERE task_id = ${b.add(p.taskId)} AND ${markerExists(b, rid)}`,
      ),
    );
  }

  for (const r of planned) {
    if (r.insert) {
      stmts.push(
        mk(
          db,
          (b) => `INSERT INTO task_allocations
                    (task_id, user_id, ordinal, target_units, done_units, floor_units, released_units)
                  SELECT ${b.add(p.taskId)}, ${b.add(r.userId)}, ${b.add(r.ordinal)}, ${b.add(r.target)},
                         ${b.add(r.done)}, ${b.add(r.floor)}, ${b.add(r.released)}
                   WHERE ${markerExists(b, rid)}`,
        ),
      );
    } else {
      stmts.push(
        mk(
          db,
          (b) => `UPDATE task_allocations
                     SET target_units = ${b.add(r.target)}, floor_units = ${b.add(r.floor)},
                         released_units = ${b.add(r.released)}, revision = revision + 1,
                         updated_at = datetime('now')
                   WHERE task_id = ${b.add(p.taskId)} AND user_id = ${b.add(r.userId)}
                     AND ${markerExists(b, rid)}`,
        ),
      );
    }
  }
  for (const uid of droppedInDb) {
    stmts.push(
      mk(
        db,
        (b) => `DELETE FROM task_allocations
                 WHERE task_id = ${b.add(p.taskId)} AND user_id = ${b.add(uid)} AND done_units = 0
                   AND ${markerExists(b, rid)}`,
      ),
    );
  }

  // Seed: хуучин оноо мөр бүрт нэг слайс (шинэ оноо ҮҮСЭХГҮЙ).
  if (converting && seedPlan) stmts.push(...seedSliceStatements(db, p.taskId, actor.sub, rid, nowIso, revAfter, seedPlan));

  // Ирээдүйн ажилгүй болсон хүмүүсийн (цуцлагдсан, буцаасан) явж буй таймерыг зогсооно — шинэ хүнд таймер ЭХЛҮҮЛЭХГҮЙ.
  const stopReq = `${rid}:stop`;
  stmts.push(...stopTimersWithoutFuture(db, p.taskId, actor.sub, nowIso, stopReq, rid, 'alloc_release'));

  const outcome = await runGuardedBatch(db, rid, stmts);
  if (outcome.kind === 'replayed') return { ok: true, data: JSON.parse(outcome.resultJson) as SplitData, replayed: true };
  if (outcome.kind === 'stale') return staleFail(db, p.taskId);

  // commit-ийн дараах (нэмэлт, алдаа нь үйлдлийг унагахгүй): мэдэгдэл.
  for (const uid of applied.created) {
    if (uid === actor.sub) continue;
    void createNotification(
      db,
      uid,
      'task_assigned',
      'Танд таскийн хэсэг хуваарилагдлаа',
      `«${facts.name}» таскийн хэсэг танд хуваарилагдлаа — «Миний ажлууд»-аас ▶ дарж эхлүүлнэ үү.`,
      `/app/projects/${facts.projectId}?task=${p.taskId}`,
    );
  }
  for (const uid of applied.released) {
    if (uid === actor.sub) continue;
    void createNotification(
      db,
      uid,
      'task_assigned',
      'Таны үлдсэн ажил өөрчлөгдлөө',
      `«${facts.name}» таскийн хуваарилалт засагдсан — таны хийсэн хэсэг хэвээр, үлдсэн ажил чөлөөлөгдөв.`,
      `/app/projects/${facts.projectId}?task=${p.taskId}`,
    );
  }
  return { ok: true, data };
}

/** Managed болгох (seed) үед хуучин оноо мөр бүрт нэг слайс — шинэ оноо ҮҮСЭХГҮЙ.  `applyAllocation` ба `applyParts` хуваалцана. */
function seedSliceStatements(
  db: D1Database,
  taskId: number,
  actorId: number,
  rid: string,
  nowIso: string,
  revAfter: number,
  seedPlan: Extract<ReturnType<typeof planSeed>, { ok: true }>,
): D1PreparedStatement[] {
  const stmts: D1PreparedStatement[] = [];
  seedPlan.slices.forEach((s, i) => {
    stmts.push(
      mk(
        db,
        (b) => `INSERT INTO task_contributions
                  (task_id, allocation_id, user_id, actor_id, kind, units, units_open, free_open,
                   credit_amount, credit_delta_pct, credit_open_amount, credit_open_delta_pct,
                   points_id, progress_entry_id, work_date, awarded_at, recorded_at,
                   request_id, seq, root_revision, note)
                SELECT ${b.add(taskId)},
                       (SELECT a.id FROM task_allocations a WHERE a.task_id = ${b.add(taskId)} AND a.user_id = ${b.add(s.userId)}),
                       ${b.add(s.userId)}, ${b.add(actorId)}, 'seed', ${b.add(s.units)}, ${b.add(s.units)}, 0,
                       ${b.add(s.amount)}, ${b.add(s.deltaPct)}, ${b.add(s.amount)}, ${b.add(s.deltaPct)},
                       ${b.add(s.pointsId)}, ${b.add(s.progressEntryId)}, ${b.add(s.awardedAt.slice(0, 10))},
                       ${b.add(s.awardedAt)}, ${b.add(nowIso)}, ${b.add(rid)}, ${b.add(i)}, ${b.add(revAfter)},
                       'legacy credit row'
                 WHERE ${markerExists(b, rid)}`,
      ),
    );
  });
  return stmts;
}

/**
 * Root дээр ирээдүйн ажилгүй (target ≤ done) хүмүүсийн явж буй сэшнийг зогсооно — marker-ээр хамгаалагдсан.
 * `taskId`-тай root-ийн БҮХ allocation шинэчлэгдсэний ДАРАА ажиллана (batch-ийн төгсгөлд).
 */
function stopTimersWithoutFuture(
  db: D1Database,
  taskId: number,
  actorId: number,
  nowIso: string,
  endRequestId: string,
  markerRid: string,
  note: 'alloc_release' | 'alloc_complete',
): D1PreparedStatement[] {
  const close = mk(db, (b) => {
    const now = b.add(nowIso);
    return `UPDATE task_timer_sessions SET ${closeSetSql(now)},
                   end_reason = 'pause', ended_by = ${b.add(actorId)}, end_request_id = ${b.add(endRequestId)},
                   end_note = ${b.add(note)}
             WHERE ended_at IS NULL AND task_id = ${b.add(taskId)}
               AND user_id NOT IN (SELECT a.user_id FROM task_allocations a
                                    WHERE a.task_id = ${b.add(taskId)} AND a.target_units > a.done_units)
               AND ${markerExists(b, markerRid)}`;
  });
  const event = mk(
    db,
    (b) => `INSERT INTO task_timer_events (user_id, actor_id, action, session_id, task_id, at, request_id, note)
            SELECT user_id, ${b.add(actorId)}, 'pause', id, task_id, ended_at, ${b.add(endRequestId)}, ${b.add(note)}
              FROM task_timer_sessions
             WHERE end_request_id = ${b.add(endRequestId)} AND task_id = ${b.add(taskId)}`,
  );
  return [close, event];
}

/* ------------------------------------------------------------------ */
/*  2. ӨӨРИЙН ЯВЦ                                                       */
/* ------------------------------------------------------------------ */

export interface ProgressInput {
  taskId: number;
  requestId: string;
  expectedRevision: number;
  /** Хүний ӨӨРИЙН хийсэн хэмжээ (нэгжээр, абсолют) — root-ийн нийт хувь БИШ. */
  doneUnits: number;
  /** Админ өөр хүний хэсгийг засахад (аудитад actor ≠ owner). */
  ownerUserId?: number;
  notes?: string | null;
  attachmentsJson?: string | null;
  imageUrl?: string | null;
  /** Зорилтод хүрэх / root 100% болох үед асуултын хариулт (нэг цонх — хоёр scope). */
  completionQa?: Record<string, string> | null;
}

export interface ProgressData {
  root: RootView;
  noop: boolean;
  kind: 'increase' | 'decrease' | 'none';
  delta_units: number;
  reached_own_cap: boolean;
  completed_root: boolean;
  reopened_root: boolean;
  points: { amount: number; delta_pct: number; free_units: number; paid_units: number } | null;
  reversed: { amount: number; delta_pct: number } | null;
  entry_id: number | null;
}

/**
 * Хийсэн хэсгийн БУЦААЛТЫН statement-ууд: хэсэг бүрт (1) `correction` үйл явдал, (2) хэсгийн үлдэгдэл хасах,
 * (3) бодит олгосон оноог АНХНЫ өдөрт сөрөг мөрөөр буцаах (`reverses_points_id`).  Ердийн «−» ба өөрийн бүртгэлийн
 * залруулга хоёуланд ижил — тусад нь давтаж бичвэл нэг нь зөрнө.
 */
function reversalStatements(
  db: D1Database,
  p: {
    taskId: number;
    owner: number;
    actorId: number;
    projectId: number;
    today: string;
    createdAt: string;
    rid: string;
    revAfter: number;
    parts: readonly ReversalPart[];
    entryIdExpr: (b: ParamBag) => string;
    note: string;
  },
): D1PreparedStatement[] {
  const out: D1PreparedStatement[] = [];
  p.parts.forEach((part, i) => {
    out.push(
      mk(
        db,
        (b) => `INSERT INTO task_contributions
                  (task_id, allocation_id, user_id, actor_id, kind, units, units_open, free_units,
                   credit_amount, credit_delta_pct, ref_id, progress_entry_id, work_date, awarded_at,
                   recorded_at, request_id, seq, root_revision, note)
                SELECT ${b.add(p.taskId)}, (SELECT a.id FROM task_allocations a WHERE a.task_id = ${b.add(p.taskId)} AND a.user_id = ${b.add(p.owner)}),
                       ${b.add(p.owner)}, ${b.add(p.actorId)}, 'correction', ${b.add(-part.units)}, 0, ${b.add(part.freeUnits)},
                       ${b.add(-part.amount)}, ${b.add(-part.deltaPct)}, ${b.add(part.sliceId)}, ${p.entryIdExpr(b)},
                       ${b.add(p.today)}, ${b.add(part.awardedAt)}, ${b.add(p.createdAt)}, ${b.add(p.rid)}, ${b.add(i)},
                       ${b.add(p.revAfter)}, ${b.add(p.note)}
                 WHERE ${markerExists(b, p.rid)}`,
      ),
      mk(
        db,
        (b) => `UPDATE task_contributions
                   SET units_open = units_open - ${b.add(part.units)},
                       free_open = free_open - ${b.add(part.freeUnits)},
                       credit_open_amount = ${part.closes ? '0' : `credit_open_amount - ${b.add(part.amount)}`},
                       credit_open_delta_pct = ${part.closes ? '0' : `credit_open_delta_pct - ${b.add(part.deltaPct)}`}
                 WHERE id = ${b.add(part.sliceId)} AND units_open >= ${b.add(part.units)} AND ${markerExists(b, p.rid)}`,
      ),
    );
    if (part.amount > 0) {
      out.push(
        mk(
          db,
          (b) => `INSERT INTO user_points
                    (user_id, project_id, task_id, progress_entry_id, amount, delta_pct, assignee_count,
                     awarded_by, source, awarded_at, contribution_id, reverses_points_id, recorded_at)
                  SELECT ${b.add(p.owner)}, ${b.add(p.projectId)}, ${b.add(p.taskId)}, ${p.entryIdExpr(b)},
                         ${b.add(-part.amount)}, ${b.add(-part.deltaPct)}, 1, ${b.add(p.actorId)}, 'progress',
                         ${b.add(part.awardedAt)},
                         (SELECT id FROM task_contributions WHERE request_id = ${b.add(p.rid)} AND seq = ${b.add(i)}),
                         ${b.add(part.pointsId)}, ${b.add(p.createdAt)}
                   WHERE ${markerExists(b, p.rid)}`,
        ),
        mk(
          db,
          (b) => `UPDATE task_contributions
                     SET points_id = (SELECT up.id FROM user_points up WHERE up.contribution_id = task_contributions.id ORDER BY up.id LIMIT 1)
                   WHERE request_id = ${b.add(p.rid)} AND seq = ${b.add(i)} AND ${markerExists(b, p.rid)}`,
        ),
      );
    }
  });
  return out;
}

/** Өөрийн хэсэг дуусах / root 100% болох үед таймер зогсоох (`all` = root-ийн БҮХ таймер, үгүй бол зөвхөн owner-ийнх). */
function completionStopStatements(
  db: D1Database,
  p: { taskId: number; owner: number; actorId: number; nowIso: string; rid: string; all: boolean },
): D1PreparedStatement[] {
  const stopReq = `${p.rid}:stop`;
  return [
    mk(db, (b) => {
      const now = b.add(p.nowIso);
      return `UPDATE task_timer_sessions SET ${closeSetSql(now)},
                     end_reason = 'auto_stop_completed', ended_by = ${b.add(p.actorId)},
                     end_request_id = ${b.add(stopReq)}, end_note = 'alloc_complete'
               WHERE ended_at IS NULL AND task_id = ${b.add(p.taskId)}
                 ${p.all ? '' : `AND user_id = ${b.add(p.owner)}`}
                 AND ${markerExists(b, p.rid)}`;
    }),
    mk(
      db,
      (b) => `INSERT INTO task_timer_events (user_id, actor_id, action, session_id, task_id, at, request_id, note)
              SELECT user_id, ${b.add(p.actorId)}, 'auto_stop_completed', id, task_id, ended_at, ${b.add(stopReq)}, 'alloc_complete'
                FROM task_timer_sessions
               WHERE end_request_id = ${b.add(stopReq)} AND task_id = ${b.add(p.taskId)}`,
    ),
  ];
}

interface QaOk {
  ok: true;
  json: string;
}
interface QaMissing {
  ok: false;
  questions: ReturnType<typeof parseCompletionQuestions>;
  missing: string[];
}

function validateQa(questionsJson: string | null, answers: Record<string, string> | null | undefined): QaOk | QaMissing {
  const questions = parseCompletionQuestions(questionsJson);
  const given = answers ?? {};
  const missing = questions.filter((q) => !(given[q.id] ?? '').trim()).map((q) => q.text);
  if (missing.length > 0) return { ok: false, questions, missing };
  const trimmed: Record<string, string> = {};
  for (const q of questions) trimmed[q.id] = (given[q.id] ?? '').trim();
  return { ok: true, json: JSON.stringify(trimmed) };
}

async function hasValidSession(db: D1Database, taskId: number, userId: number): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS x FROM task_timer_sessions s
        WHERE s.task_id = ? AND s.user_id = ?
          AND NOT EXISTS (SELECT 1 FROM task_timer_voids v WHERE v.session_id = s.id AND v.restored_at IS NULL)
        LIMIT 1`,
    )
    .bind(taskId, userId)
    .first();
  return !!row;
}

async function loadOpenSlices(db: D1Database, taskId: number, userId: number): Promise<OpenSlice[]> {
  const { results } = await db
    .prepare(
      `SELECT id, user_id, units_open, free_open, credit_open_amount, credit_open_delta_pct, awarded_at, points_id
         FROM task_contributions
        WHERE task_id = ? AND user_id = ? AND kind IN ('work', 'seed') AND units_open > 0
        ORDER BY id DESC`,
    )
    .bind(taskId, userId)
    .all<{
      id: number;
      user_id: number;
      units_open: number;
      free_open: number;
      credit_open_amount: number;
      credit_open_delta_pct: number;
      awarded_at: string;
      points_id: number | null;
    }>();
  return (results ?? []).map((r) => ({
    id: r.id,
    userId: r.user_id,
    unitsOpen: r.units_open,
    freeOpen: r.free_open,
    creditOpenAmount: Number(r.credit_open_amount) || 0,
    creditOpenDeltaPct: Number(r.credit_open_delta_pct) || 0,
    awardedAt: r.awarded_at,
    pointsId: r.points_id,
  }));
}

export async function setOwnProgress(ctx: OpCtx, actor: Actor, p: ProgressInput): Promise<OpResult<ProgressData>> {
  const { db } = ctx;
  if (!validRequestId(p.requestId)) return fail(400, 'BAD_REQUEST_ID', 'request_id буруу');
  if (!Number.isInteger(p.taskId) || p.taskId <= 0) return fail(400, 'BAD_TASK', 'Таск буруу');
  const owner = p.ownerUserId ?? actor.sub;
  if (owner !== actor.sub && actor.role !== 'admin') {
    return fail(403, 'NOT_OWNER', 'Зөвхөн админ өөр хүний хэсгийг засна');
  }
  if (!isUnits(p.doneUnits)) return fail(400, 'BAD_VALUE', 'Хийсэн хэмжээ буруу');
  const hash = await payloadHash('progress', {
    owner,
    done: p.doneUnits,
    notes: p.notes ?? null,
    attachments: p.attachmentsJson ?? null,
    image: p.imageUrl ?? null,
    qa: p.completionQa ? Object.entries(p.completionQa).sort(([a], [b]) => (a < b ? -1 : 1)) : null,
  });
  const replay = await replayOf<ProgressData>(ctx, p.requestId, p.taskId, actor.sub, 'progress', hash);
  if (replay) return replay.ok ? { ...replay, data: await withEntryId(db, p.requestId, replay.data) } : replay;

  const facts = await loadTaskFacts(db, p.taskId);
  const snap = await loadRoot(db, p.taskId);
  if (!snap) return fail(409, 'NOT_MANAGED', 'Энэ таск хуваарилагдаагүй — ердийн явцаар бөглөнө');
  if (p.expectedRevision !== snap.root.revision) return staleFail(db, p.taskId);

  const mine = snap.allocations.find((a) => a.userId === owner);
  if (!mine || mine.targetUnits <= 0) return fail(403, 'NO_ALLOCATION', 'Танд энэ ажилд хуваарилалт алга');

  const plan = planOwnProgress(snap.state, owner, p.doneUnits);
  if (!plan.ok) {
    const status: OpFailStatus = plan.code === 'NO_ALLOCATION' ? 403 : 400;
    return fail(status, plan.code, plan.message);
  }
  const gate = checkTaskGate(facts, { requireSplittable: false, allowAutoArchived: plan.kind === 'decrease' });
  if (gate) return gate;
  if (plan.kind === 'increase' && actor.role !== 'admin' && !(await hasValidSession(db, p.taskId, owner))) {
    return fail(403, 'TAKE_REQUIRED', 'Энэ таск дээр эхлээд цагаа эхлүүлнэ үү — хүчинтэй цагийн бүртгэлгүй бол хувь оруулах боломжгүй.');
  }
  if (plan.kind === 'none') {
    return {
      ok: true,
      data: {
        root: rootView(snap),
        noop: true,
        kind: 'none',
        delta_units: 0,
        reached_own_cap: false,
        completed_root: false,
        reopened_root: false,
        points: null,
        reversed: null,
        entry_id: null,
      },
    };
  }

  // Дуусгах асуулт: өөрийн хэсгийн зорилтод хүрэх ЭСВЭЛ root 100% болох үед (нэг цонх — хоёр scope).
  let qaJson: string | null = null;
  if (plan.reachesOwnCap || plan.completesRoot) {
    const qa = validateQa(facts.completionQuestions, p.completionQa);
    if (!qa.ok) {
      return fail(400, 'completion_qa required', 'Ажил дуусгахын тулд бүх асуултад хариулна уу.', {
        questions: qa.questions,
        missing: qa.missing,
        scopes: { own: plan.reachesOwnCap, root: plan.completesRoot },
      });
    }
    qaJson = qa.json;
  }

  const nowMs = ctx.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const today = ctx.today ?? todayInUB();
  const createdAt = nextEntryTs(facts.lastCreatedAt, nowMs);
  const entryDate = projectionDate(today, facts.lastDate);
  const rid = p.requestId;
  const increase = plan.kind === 'increase';
  const source = increase ? 'alloc' : 'alloc_adj';
  const newRootDone = plan.newRootDoneUnits;
  const pctValue = newRootDone / UNITS_PER_POINT;
  const ctxCredit = { coef: facts.coef, complexityPct: facts.complexityPct };

  // Оноо: өсөлт → slack-ийг дүүргээд үлдсэнд; бууралт → LIFO буцаалт.
  let wc: ReturnType<typeof planWorkCredit> | null = null;
  let reversal: Extract<ReturnType<typeof planReversal>, { ok: true }> | null = null;
  let newSlack = snap.root.slackUnits;
  if (increase) {
    wc = planWorkCredit(snap.root.slackUnits, plan.deltaUnits, ctxCredit);
    newSlack = wc.newSlackUnits;
  } else {
    const slices = await loadOpenSlices(db, p.taskId, owner);
    const open = slices.reduce((s, x) => s + x.unitsOpen, 0);
    if (open !== mine.doneUnits) {
      return fail(409, 'LEDGER_MISMATCH', 'Хийсэн хэсгийн журнал таарахгүй байна — удирдлагад мэдэгдэнэ үү', {
        done_units: mine.doneUnits,
        open_units: open,
      });
    }
    const r = planReversal(slices, -plan.deltaUnits);
    if (!r.ok) return fail(409, r.code, r.message);
    reversal = r;
    newSlack = snap.root.slackUnits + r.slackDelta;
  }

  // Root 100%-аас буурвал АВТОМАТААР архивлагдсан төслийг дахин нээнэ (гараар архивлагдсаныг ХЭЗЭЭ Ч).
  const reopenProject = plan.reopensRoot && facts.projectStatus === 'archived' && facts.autoArchivedAt !== null;

  const newCompletedAt = plan.completesRoot ? nowIso : plan.reopensRoot ? null : snap.root.completedAt;
  const revAfter = snap.root.revision + 1;
  const afterAlloc = { ...mine, doneUnits: plan.newDoneUnits, revision: mine.revision + 1 };
  const afterAllocs = snap.allocations.map((a) => (a.userId === owner ? afterAlloc : a));
  const afterRoot = { ...snap.root, revision: revAfter, slackUnits: newSlack, completedAt: newCompletedAt };
  const afterState = toRootState(afterRoot, afterAllocs);
  const invariant = checkRootInvariants(afterState);
  if (invariant.length > 0) return fail(409, 'INVARIANT', `Хуваарилалт инвариант зөрчив: ${invariant[0]}`);

  const reversedTotals = reversal
    ? reversal.parts.reduce((a, x) => ({ amount: a.amount + x.amount, delta_pct: a.delta_pct + x.deltaPct }), { amount: 0, delta_pct: 0 })
    : null;
  const data: ProgressData = {
    root: rootView({ root: afterRoot, allocations: afterAllocs, state: afterState, parts: snap?.parts ?? [] }),
    noop: false,
    kind: plan.kind,
    delta_units: plan.deltaUnits,
    reached_own_cap: plan.reachesOwnCap,
    completed_root: plan.completesRoot,
    reopened_root: plan.reopensRoot,
    points: wc ? { amount: wc.amount, delta_pct: wc.deltaPct, free_units: wc.freeUnits, paid_units: wc.paidUnits } : null,
    reversed: reversedTotals,
    entry_id: null,
  };

  const effects: PostEffects = {
    taskId: p.taskId,
    projectId: facts.projectId,
    owner,
    today,
    completedRoot: plan.completesRoot,
    increase,
    snapshotFrom: reversal ? earliestAwardedDay(reversal.parts.map((x) => x.awardedAt)) : null,
  };
  const stmts: D1PreparedStatement[] = [];
  stmts.push(
    markerStmt(db, {
      requestId: rid,
      taskId: p.taskId,
      userId: actor.sub,
      kind: 'progress',
      requestHash: hash,
      post: effects,
      revBefore: snap.root.revision,
      revAfter,
      beforeJson: stateJson(snap.state),
      afterJson: stateJson(afterState),
      resultJson: JSON.stringify(data),
      guard: (b) =>
        `${managedGuard(p.taskId, snap.root.revision)(b)}
         AND EXISTS (SELECT 1 FROM task_allocations a
                      WHERE a.task_id = ${b.add(p.taskId)} AND a.user_id = ${b.add(owner)}
                        AND a.done_units = ${b.add(mine.doneUnits)} AND a.target_units = ${b.add(mine.targetUnits)})
         ${increase ? `AND ${structureGuardSql(b, facts)}` : ''}`,
    }),
  );

  // Projection = actor-ын тайлан (өсөлт, 'alloc') эсвэл залруулгын aggregate (бууралт, 'alloc_adj').
  stmts.push(
    mk(
      db,
      (b) => `INSERT INTO progress_entries
                (task_id, user_id, percentage, date, notes, status, reviewed_by, reviewed_at, image_url,
                 is_rest_day, defer_next_day, completion_qa, attachments, source, created_at)
              SELECT ${b.add(p.taskId)}, ${b.add(owner)}, ${b.add(pctValue)}, ${b.add(entryDate)}, ${b.add(p.notes ?? null)},
                     'approved', ${b.add(actor.sub)}, ${b.add(nowIso)}, ${b.add(p.imageUrl ?? null)},
                     0, 0, ${b.add(plan.completesRoot ? qaJson : null)}, ${b.add(p.attachmentsJson ?? null)},
                     ${b.add(source)}, ${b.add(createdAt)}
               WHERE ${markerExists(b, rid)}`,
    ),
  );

  stmts.push(
    mk(
      db,
      (b) => `UPDATE task_allocations
                 SET done_units = ${b.add(plan.newDoneUnits)}, revision = revision + 1, updated_at = datetime('now')
               WHERE task_id = ${b.add(p.taskId)} AND user_id = ${b.add(owner)} AND ${markerExists(b, rid)}`,
    ),
  );
  stmts.push(
    mk(
      db,
      (b) => `UPDATE task_roots
                 SET revision = ${b.add(revAfter)}, slack_units = ${b.add(newSlack)},
                     completed_at = ${b.add(newCompletedAt)}, updated_at = datetime('now')
               WHERE task_id = ${b.add(p.taskId)} AND ${markerExists(b, rid)}`,
    ),
  );

  const entryIdExpr = (b: ParamBag) =>
    `(SELECT id FROM progress_entries WHERE task_id = ${b.add(p.taskId)} AND created_at = ${b.add(createdAt)}
        AND source = ${b.add(source)} ORDER BY id DESC LIMIT 1)`;

  if (increase && wc) {
    // Ажлын слайс + (төлөгдөх нэгж байвал) оноо.
    stmts.push(
      mk(
        db,
        (b) => `INSERT INTO task_contributions
                  (task_id, allocation_id, user_id, actor_id, kind, units, units_open, free_open, free_units,
                   credit_amount, credit_delta_pct, credit_open_amount, credit_open_delta_pct,
                   progress_entry_id, work_date, awarded_at, recorded_at, request_id, seq, root_revision, qa_json)
                SELECT ${b.add(p.taskId)}, (SELECT a.id FROM task_allocations a WHERE a.task_id = ${b.add(p.taskId)} AND a.user_id = ${b.add(owner)}),
                       ${b.add(owner)}, ${b.add(actor.sub)}, 'work', ${b.add(plan.deltaUnits)}, ${b.add(plan.deltaUnits)},
                       ${b.add(wc.freeUnits)}, ${b.add(wc.freeUnits)},
                       ${b.add(wc.amount)}, ${b.add(wc.deltaPct)}, ${b.add(wc.amount)}, ${b.add(wc.deltaPct)},
                       ${entryIdExpr(b)}, ${b.add(today)}, ${b.add(createdAt)}, ${b.add(createdAt)},
                       ${b.add(rid)}, 0, ${b.add(revAfter)},
                       ${b.add(qaJson ? JSON.stringify({ own: plan.reachesOwnCap ? JSON.parse(qaJson) : null, root: plan.completesRoot ? JSON.parse(qaJson) : null }) : null)}
                 WHERE ${markerExists(b, rid)}`,
      ),
    );
    if (wc.paidUnits > 0 && wc.amount > 0 && wc.deltaPct > 0.0001) {
      stmts.push(
        mk(
          db,
          (b) => `INSERT INTO user_points
                    (user_id, project_id, task_id, progress_entry_id, amount, delta_pct, assignee_count,
                     awarded_by, source, awarded_at, contribution_id, recorded_at)
                  SELECT ${b.add(owner)}, ${b.add(facts.projectId)}, ${b.add(p.taskId)}, ${entryIdExpr(b)},
                         ${b.add(wc.amount)}, ${b.add(wc.deltaPct)}, 1, ${b.add(owner)}, 'progress', ${b.add(createdAt)},
                         (SELECT id FROM task_contributions WHERE request_id = ${b.add(rid)} AND seq = 0), ${b.add(createdAt)}
                   WHERE ${markerExists(b, rid)}`,
        ),
      );
      stmts.push(
        mk(
          db,
          (b) => `UPDATE task_contributions
                     SET points_id = (SELECT up.id FROM user_points up WHERE up.contribution_id = task_contributions.id ORDER BY up.id LIMIT 1)
                   WHERE request_id = ${b.add(rid)} AND seq = 0 AND ${markerExists(b, rid)}`,
        ),
      );
    }
  } else if (reversal) {
    stmts.push(
      ...reversalStatements(db, {
        taskId: p.taskId,
        owner,
        actorId: actor.sub,
        projectId: facts.projectId,
        today,
        createdAt,
        rid,
        revAfter,
        parts: reversal.parts,
        entryIdExpr,
        note: 'own decrease',
      }),
    );
  }

  if (reopenProject) {
    stmts.push(
      mk(
        db,
        (b) => `UPDATE projects SET status = 'active', auto_archived_at = NULL, updated_at = datetime('now')
                 WHERE id = ${b.add(facts.projectId)} AND status = 'archived' AND auto_archived_at IS NOT NULL
                   AND ${markerExists(b, rid)}`,
      ),
    );
  }

  // Таймер: root 100% бол бүх таймер; өөрийн хэсэг дуусвал зөвхөн тэр хүнийх.
  if (plan.completesRoot || plan.reachesOwnCap) {
    stmts.push(
      ...completionStopStatements(db, {
        taskId: p.taskId,
        owner,
        actorId: actor.sub,
        nowIso,
        rid,
        all: plan.completesRoot,
      }),
    );
  }

  const outcome = await runGuardedBatch(db, rid, stmts);
  if (outcome.kind === 'replayed') {
    return { ok: true, data: await withEntryId(db, rid, JSON.parse(outcome.resultJson) as ProgressData), replayed: true };
  }
  if (outcome.kind === 'stale') return staleFail(db, p.taskId);

  const entry = await db
    .prepare(
      `SELECT id FROM progress_entries WHERE task_id = ? AND created_at = ? AND source = ? ORDER BY id DESC LIMIT 1`,
    )
    .bind(p.taskId, createdAt, source)
    .first<{ id: number }>();
  data.entry_id = entry?.id ?? null;

  await settlePostCommit(ctx, rid, effects, true);
  return { ok: true, data };
}

/** Буцаалт/сэргээлтийн анхны олгосон өдрүүдээс хамгийн эртний УБ өдөр (хуучирсан snapshot дахин бодох эхлэл). */
function earliestAwardedDay(awardedAts: readonly string[]): string | null {
  let min: string | null = null;
  for (const at of awardedAts) {
    const d = orgDateOfUtc(at);
    if (min === null || d < min) min = d;
  }
  return min;
}

/* ------------------------------------------------------------------ */
/*  3. ҮЛДСЭН АЖЛАА БУЦААХ / ШИЛЖҮҮЛЭХ                                 */
/* ------------------------------------------------------------------ */

export interface ReleaseInput {
  taskId: number;
  requestId: string;
  expectedRevision: number;
  /** Хүлээн авагч (одоогийн оролцогч) — үгүй бол чөлөөт ажил (U) руу. */
  toUserId?: number | null;
}

export interface ReleaseData {
  root: RootView;
  released_units: number;
  to_user_id: number | null;
}

export async function releaseOwn(ctx: OpCtx, actor: Actor, p: ReleaseInput): Promise<OpResult<ReleaseData>> {
  const { db } = ctx;
  if (!validRequestId(p.requestId)) return fail(400, 'BAD_REQUEST_ID', 'request_id буруу');
  const hash = await payloadHash('release', { to: p.toUserId ?? null });
  const replay = await replayOf<ReleaseData>(ctx, p.requestId, p.taskId, actor.sub, 'release', hash);
  if (replay) return replay;
  const snap = await loadRoot(db, p.taskId);
  if (!snap) return fail(409, 'NOT_MANAGED', 'Энэ таск хуваарилагдаагүй');
  if (p.expectedRevision !== snap.root.revision) return staleFail(db, p.taskId);
  const facts = await loadTaskFacts(db, p.taskId);
  if (!facts.exists) return fail(404, 'TASK_NOT_FOUND', 'Таск олдсонгүй');

  const r = planRelease(snap.state, actor.sub, p.toUserId ?? null);
  if (!r.ok) return fail(r.code === 'NO_ALLOCATION' ? 403 : 409, r.code, r.message);

  const nowMs = ctx.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const rid = p.requestId;
  const revAfter = snap.root.revision + 1;
  const toPool = p.toUserId === undefined || p.toUserId === null;
  const afterAllocs = snap.allocations.map((a) => {
    if (a.userId === actor.sub) {
      return { ...a, targetUnits: a.doneUnits, floorUnits: a.doneUnits, releasedUnits: r.releasedUnits, revision: a.revision + 1 };
    }
    if (!toPool && a.userId === p.toUserId) {
      return { ...a, targetUnits: a.targetUnits + r.releasedUnits, revision: a.revision + 1 };
    }
    return a;
  });
  const afterRoot = {
    ...snap.root,
    revision: revAfter,
    unallocatedUnits: snap.root.unallocatedUnits + (toPool ? r.releasedUnits : 0),
  };
  const afterState = toRootState(afterRoot, afterAllocs);
  const invariant = checkRootInvariants(afterState);
  if (invariant.length > 0) return fail(409, 'INVARIANT', `Хуваарилалт инвариант зөрчив: ${invariant[0]}`);
  const data: ReleaseData = {
    root: rootView({ root: afterRoot, allocations: afterAllocs, state: afterState, parts: snap?.parts ?? [] }),
    released_units: r.releasedUnits,
    to_user_id: toPool ? null : (p.toUserId ?? null),
  };

  const stmts: D1PreparedStatement[] = [
    markerStmt(db, {
      requestId: rid,
      taskId: p.taskId,
      userId: actor.sub,
      kind: 'release',
      requestHash: hash,
      revBefore: snap.root.revision,
      revAfter,
      beforeJson: stateJson(snap.state),
      afterJson: stateJson(afterState),
      resultJson: JSON.stringify(data),
      guard: managedGuard(p.taskId, snap.root.revision),
    }),
    mk(
      db,
      (b) => `UPDATE task_allocations
                 SET target_units = done_units, floor_units = done_units, released_units = ${b.add(r.releasedUnits)},
                     revision = revision + 1, updated_at = datetime('now')
               WHERE task_id = ${b.add(p.taskId)} AND user_id = ${b.add(actor.sub)} AND ${markerExists(b, rid)}`,
    ),
  ];
  if (!toPool) {
    stmts.push(
      mk(
        db,
        (b) => `UPDATE task_allocations
                   SET target_units = target_units + ${b.add(r.releasedUnits)}, revision = revision + 1, updated_at = datetime('now')
                 WHERE task_id = ${b.add(p.taskId)} AND user_id = ${b.add(p.toUserId ?? 0)} AND ${markerExists(b, rid)}`,
      ),
    );
  }
  stmts.push(
    mk(
      db,
      (b) => `UPDATE task_roots
                 SET revision = ${b.add(revAfter)}, unallocated_units = unallocated_units + ${b.add(toPool ? r.releasedUnits : 0)},
                     updated_at = datetime('now')
               WHERE task_id = ${b.add(p.taskId)} AND ${markerExists(b, rid)}`,
    ),
  );
  stmts.push(...stopTimersWithoutFuture(db, p.taskId, actor.sub, nowIso, `${rid}:stop`, rid, 'alloc_release'));

  const outcome = await runGuardedBatch(db, rid, stmts);
  if (outcome.kind === 'replayed') return { ok: true, data: JSON.parse(outcome.resultJson) as ReleaseData, replayed: true };
  if (outcome.kind === 'stale') return staleFail(db, p.taskId);
  if (!toPool && p.toUserId) {
    void createNotification(
      db,
      p.toUserId,
      'task_assigned',
      'Танд үлдсэн ажил шилжлээ',
      `«${facts.name}» таскийн үлдсэн ажил танд шилжүүлэгдлээ.`,
      `/app/projects/${facts.projectId}?task=${p.taskId}`,
    );
  }
  return { ok: true, data };
}

/* ------------------------------------------------------------------ */
/*  4. ДАХИН АВАХ (чөлөөт ажлаас)                                       */
/* ------------------------------------------------------------------ */

export interface RetakeInput {
  taskId: number;
  requestId: string;
  expectedRevision: number;
  /** Хүссэн хэмжээ (нэгжээр); өгөхгүй бол чөлөөт ажил бүхлээр. */
  units?: number | null;
}

export interface RetakeData {
  root: RootView;
  taken_units: number;
  reactivated: boolean;
}

export async function retakeAllocation(ctx: OpCtx, actor: Actor, p: RetakeInput): Promise<OpResult<RetakeData>> {
  const { db } = ctx;
  if (!validRequestId(p.requestId)) return fail(400, 'BAD_REQUEST_ID', 'request_id буруу');
  const hash = await payloadHash('retake', { units: p.units ?? null });
  const replay = await replayOf<RetakeData>(ctx, p.requestId, p.taskId, actor.sub, 'retake', hash);
  if (replay) return replay;
  const facts = await loadTaskFacts(db, p.taskId);
  const gate = checkTaskGate(facts, { requireSplittable: true });
  if (gate) return gate;
  const snap = await loadRoot(db, p.taskId);
  if (!snap) return fail(409, 'NOT_MANAGED', 'Энэ таск хуваарилагдаагүй');
  if (p.expectedRevision !== snap.root.revision) return staleFail(db, p.taskId);
  const me = (await loadUsers(db, [actor.sub])).get(actor.sub);
  if (!canHoldAllocation(me ?? { role: actor.role, status: 'active' }, actor.sub)) {
    return fail(403, 'ROLE_NOT_ALLOWED', 'Таны эрхээр таск авч ажиллах боломжгүй.');
  }

  // Хүнгүй хэсгүүд (0394) нь U-ийн доторх нөөц — чөлөөт ажлаас авахад тэднийг БУЛААХГҮЙ (хэсгийг `claimPart`-аар авна).
  const reserved = reservedUnitsOf(snap.parts ?? []);
  const r = planRetake(
    { ...snap.state, unattributedUnits: snap.state.unattributedUnits + reserved, unallocatedUnits: Math.max(0, snap.state.unallocatedUnits - reserved) },
    actor.sub,
    p.units ?? null,
  );
  if (!r.ok) return fail(409, r.code, r.message, { available_units: r.availableUnits });

  const rid = p.requestId;
  const revAfter = snap.root.revision + 1;
  const existing = snap.allocations.find((a) => a.userId === actor.sub);
  const ordinal = existing ? existing.ordinal : snap.root.nextOrdinal;
  const afterAllocs: AllocationRecord[] = existing
    ? snap.allocations.map((a) =>
        a.userId === actor.sub
          ? {
              ...a,
              targetUnits: a.targetUnits + r.takenUnits,
              floorUnits: a.doneUnits,
              releasedUnits: Math.max(0, a.releasedUnits - r.takenUnits),
              revision: a.revision + 1,
            }
          : a,
      )
    : [
        ...snap.allocations,
        { id: 0, userId: actor.sub, ordinal, targetUnits: r.takenUnits, doneUnits: 0, floorUnits: 0, releasedUnits: 0, revision: 1 },
      ];
  const afterRoot = {
    ...snap.root,
    revision: revAfter,
    unallocatedUnits: snap.root.unallocatedUnits - r.takenUnits,
    nextOrdinal: existing ? snap.root.nextOrdinal : snap.root.nextOrdinal + 1,
  };
  const afterState = toRootState(afterRoot, afterAllocs);
  const invariant = checkRootInvariants(afterState);
  if (invariant.length > 0) return fail(409, 'INVARIANT', `Хуваарилалт инвариант зөрчив: ${invariant[0]}`);
  const data: RetakeData = {
    root: rootView({ root: afterRoot, allocations: afterAllocs, state: afterState, parts: snap?.parts ?? [] }),
    taken_units: r.takenUnits,
    reactivated: r.reactivated,
  };

  const stmts: D1PreparedStatement[] = [
    markerStmt(db, {
      requestId: rid,
      taskId: p.taskId,
      userId: actor.sub,
      kind: 'retake',
      requestHash: hash,
      revBefore: snap.root.revision,
      revAfter,
      beforeJson: stateJson(snap.state),
      afterJson: stateJson(afterState),
      resultJson: JSON.stringify(data),
      guard: managedGuard(p.taskId, snap.root.revision),
    }),
  ];
  if (existing) {
    stmts.push(
      mk(
        db,
        (b) => `UPDATE task_allocations
                   SET target_units = target_units + ${b.add(r.takenUnits)}, floor_units = done_units,
                       released_units = MAX(0, released_units - ${b.add(r.takenUnits)}),
                       revision = revision + 1, updated_at = datetime('now')
                 WHERE task_id = ${b.add(p.taskId)} AND user_id = ${b.add(actor.sub)} AND ${markerExists(b, rid)}`,
      ),
    );
  } else {
    stmts.push(
      mk(
        db,
        (b) => `INSERT INTO task_allocations (task_id, user_id, ordinal, target_units, done_units, floor_units, released_units)
                SELECT ${b.add(p.taskId)}, ${b.add(actor.sub)}, ${b.add(ordinal)}, ${b.add(r.takenUnits)}, 0, 0, 0
                 WHERE ${markerExists(b, rid)}`,
      ),
    );
  }
  stmts.push(
    mk(
      db,
      (b) => `UPDATE task_roots
                 SET revision = ${b.add(revAfter)}, unallocated_units = unallocated_units - ${b.add(r.takenUnits)},
                     next_ordinal = ${b.add(afterRoot.nextOrdinal)}, updated_at = datetime('now')
               WHERE task_id = ${b.add(p.taskId)} AND ${markerExists(b, rid)}`,
    ),
  );
  const outcome = await runGuardedBatch(db, rid, stmts);
  if (outcome.kind === 'replayed') return { ok: true, data: JSON.parse(outcome.resultJson) as RetakeData, replayed: true };
  if (outcome.kind === 'stale') return staleFail(db, p.taskId);
  return { ok: true, data };
}

/* ------------------------------------------------------------------ */
/*  4b. ХҮНГҮЙ ХЭСЭГ — нэрлэж хуваах / засах ба авах (0394, 2026-10-09)  */
/* ------------------------------------------------------------------ */

export interface PartsInput {
  taskId: number;
  requestId: string;
  /** Одоогийн root revision; managed болоогүй таскт 0 / null. */
  expectedRevision: number | null;
  /** Хэсгүүдийн шинэ БҮРЭН жагсаалт (байхгүй болсон нь устна). */
  parts: PartInput[];
}

export interface PartsData {
  root: RootView;
  converted: boolean;
  created: number;
  removed: number;
}

/**
 * Таскийг хүн оноолгүйгээр нэрлэсэн хэсгүүд болгоно (эсвэл хэсгүүдийг засна): нэр, хувь, хуулах, устгах.
 * Хэсгүүд нь хуваарилагдаагүй ирээдүйн ажлын (U) доторх нөөц — хүний хуваарилалт, хийсэн ажил, оноо ХӨНДӨГДӨХГҮЙ.
 * Managed болоогүй таск энд seed-ээр managed болно (хуучин түүх хүн бүрийн хийсэн болж түгжигдэнэ, `applyAllocation`-тай ижил).
 * Эрх: таск авах эрхтэй БҮХ ажилтан + ахлах/админ (эзэн 2026-10-09) — оролцогч байх шаардлагагүй.
 */
export async function applyParts(ctx: OpCtx, actor: Actor, p: PartsInput): Promise<OpResult<PartsData>> {
  const r = await applyPartsOnce(ctx, actor, p);
  if (!r.ok) return r;
  // Шинэ хэсгийн id commit-ийн ДАРАА л тодорхой (marker-ийн хадгалсан хариунд 0) — клиент нэр засах/авахдаа id хэрэглэдэг
  // тул одоогийн төлөвийг дахин уншиж буцаана (replay-д ч).
  const fresh = await loadRoot(ctx.db, p.taskId);
  return fresh ? { ...r, data: { ...r.data, root: rootView(fresh) } } : r;
}

async function applyPartsOnce(ctx: OpCtx, actor: Actor, p: PartsInput): Promise<OpResult<PartsData>> {
  const { db } = ctx;
  if (!validRequestId(p.requestId)) return fail(400, 'BAD_REQUEST_ID', 'request_id буруу');
  if (!Number.isInteger(p.taskId) || p.taskId <= 0) return fail(400, 'BAD_TASK', 'Таск буруу');
  const hash = await payloadHash('parts', {
    parts: p.parts.map((x) => [x.id ?? null, typeof x.label === 'string' ? squashLabel(x.label) : '', x.units]),
  });
  const replay = await replayOf<PartsData>(ctx, p.requestId, p.taskId, actor.sub, 'parts', hash);
  if (replay) return replay;

  const facts = await loadTaskFacts(db, p.taskId);
  const gate = checkTaskGate(facts, { requireSplittable: true });
  if (gate) return gate;
  if (!isManagerRole(actor.role) && !canTakeRole(actor.role, isCeo(actor.sub))) {
    return fail(403, 'ROLE_NOT_ALLOWED', 'Таны эрхээр таск хуваах боломжгүй');
  }

  const snap = await loadRoot(db, p.taskId);
  const converting = snap === null;
  if (snap) {
    if (p.expectedRevision !== snap.root.revision) return staleFail(db, p.taskId);
  } else if (p.expectedRevision !== null && p.expectedRevision !== 0) {
    return staleFail(db, p.taskId);
  }

  let state: RootAllocState;
  let seedOrder: number[] = [];
  let seedPlan: Extract<ReturnType<typeof planSeed>, { ok: true }> | null = null;
  if (snap) {
    state = snap.state;
  } else {
    if (facts.latestPct >= 100) return fail(409, 'TASK_COMPLETED', 'Дууссан таскийг хуваах боломжгүй');
    if (p.parts.length === 0) return fail(400, 'NO_PARTS', 'Ядаж нэг хэсэг оруулна уу');
    const ev = await loadSeedEvidence(db, p.taskId);
    const plan = planSeed({ entries: ev.entries, credits: ev.credits, coef: facts.coef });
    if (!plan.ok) return fail(409, plan.code, plan.message);
    seedPlan = plan;
    const seeded = stateFromSeed(plan);
    state = seeded.state;
    seedOrder = seeded.order;
  }

  const existing = snap?.parts ?? [];
  const startOrdinal = snap ? snap.root.nextOrdinal : seedOrder.length + 1;
  const plan = planParts(existing, p.parts, state.unallocatedUnits, startOrdinal);
  if (!plan.ok) {
    const status = plan.code === 'UNKNOWN_PART' || plan.code === 'OVER_FREE' ? 409 : 400;
    return fail(status, plan.code, plan.message, {
      ...(plan.index !== undefined ? { index: plan.index } : {}),
      available_units: state.unallocatedUnits,
    });
  }

  const revBefore = snap ? snap.root.revision : 0;
  const revAfter = revBefore + 1;
  const afterAllocs: AllocationRecord[] = snap
    ? snap.allocations
    : seedOrder.map((userId, i) => {
        const d = state.rows.find((r) => r.userId === userId)?.doneUnits ?? 0;
        return { id: 0, userId, ordinal: i + 1, targetUnits: d, doneUnits: d, floorUnits: d, releasedUnits: 0, revision: 1 };
      });
  const afterRoot = snap
    ? { ...snap.root, revision: revAfter, nextOrdinal: plan.nextOrdinal }
    : {
        taskId: p.taskId,
        revision: revAfter,
        unattributedUnits: state.unattributedUnits,
        unallocatedUnits: state.unallocatedUnits,
        slackUnits: seedPlan?.slackUnits ?? 0,
        nextOrdinal: plan.nextOrdinal,
        seedAttribution: seedPlan?.attribution ?? null,
        completedAt: null,
      };
  const afterParts: PartRecord[] = plan.parts.map((x) => ({ id: x.id ?? 0, ordinal: x.ordinal, label: x.label, units: x.units }));
  const afterState = toRootState(afterRoot, afterAllocs);
  const invariant = checkRootInvariants(afterState);
  if (invariant.length > 0) return fail(409, 'INVARIANT', `Хуваарилалт инвариант зөрчив: ${invariant[0]}`);
  const data: PartsData = {
    root: rootView({ root: afterRoot, allocations: afterAllocs, state: afterState, parts: afterParts }),
    converted: converting,
    created: plan.parts.filter((x) => x.id === null).length,
    removed: plan.removed.length,
  };

  const nowIso = new Date(ctx.nowMs ?? Date.now()).toISOString();
  const rid = p.requestId;
  const stmts: D1PreparedStatement[] = [
    markerStmt(db, {
      requestId: rid,
      taskId: p.taskId,
      userId: actor.sub,
      kind: 'parts',
      requestHash: hash,
      revBefore,
      revAfter,
      beforeJson: JSON.stringify({ state, parts: existing }),
      afterJson: JSON.stringify({ state: afterState, parts: afterParts }),
      resultJson: JSON.stringify(data),
      guard: snap ? managedGuard(p.taskId, revBefore) : seedGuard(p.taskId, facts),
    }),
  ];
  if (converting) {
    stmts.push(
      mk(
        db,
        (b) => `INSERT INTO task_roots
                  (task_id, revision, unattributed_units, unallocated_units, slack_units, next_ordinal,
                   seed_attribution, seed_json, created_by)
                SELECT ${b.add(p.taskId)}, ${b.add(revAfter)}, ${b.add(afterRoot.unattributedUnits)},
                       ${b.add(afterRoot.unallocatedUnits)}, ${b.add(afterRoot.slackUnits)}, ${b.add(afterRoot.nextOrdinal)},
                       ${b.add(afterRoot.seedAttribution)},
                       ${b.add(JSON.stringify({ reasons: seedPlan?.reasons ?? [], latest_units: seedPlan?.rootDoneUnits ?? 0, slices: seedPlan?.slices.length ?? 0 }))},
                       ${b.add(actor.sub)}
                 WHERE ${markerExists(b, rid)}`,
      ),
    );
    for (const a of afterAllocs) {
      stmts.push(
        mk(
          db,
          (b) => `INSERT INTO task_allocations
                    (task_id, user_id, ordinal, target_units, done_units, floor_units, released_units)
                  SELECT ${b.add(p.taskId)}, ${b.add(a.userId)}, ${b.add(a.ordinal)}, ${b.add(a.targetUnits)},
                         ${b.add(a.doneUnits)}, ${b.add(a.floorUnits)}, 0
                   WHERE ${markerExists(b, rid)}`,
        ),
      );
    }
    if (seedPlan) stmts.push(...seedSliceStatements(db, p.taskId, actor.sub, rid, nowIso, revAfter, seedPlan));
  } else {
    stmts.push(
      mk(
        db,
        (b) => `UPDATE task_roots
                   SET revision = ${b.add(revAfter)}, next_ordinal = ${b.add(plan.nextOrdinal)}, updated_at = datetime('now')
                 WHERE task_id = ${b.add(p.taskId)} AND ${markerExists(b, rid)}`,
      ),
    );
  }
  for (const id of plan.removed) {
    stmts.push(
      mk(db, (b) => `DELETE FROM task_parts WHERE id = ${b.add(id)} AND task_id = ${b.add(p.taskId)} AND ${markerExists(b, rid)}`),
    );
  }
  for (const x of plan.parts) {
    const id = x.id;
    if (id !== null) {
      stmts.push(
        mk(
          db,
          (b) => `UPDATE task_parts SET label = ${b.add(x.label)}, units = ${b.add(x.units)}, updated_at = datetime('now')
                   WHERE id = ${b.add(id)} AND task_id = ${b.add(p.taskId)} AND ${markerExists(b, rid)}`,
        ),
      );
    } else {
      stmts.push(
        mk(
          db,
          (b) => `INSERT INTO task_parts (task_id, ordinal, label, units, created_by)
                  SELECT ${b.add(p.taskId)}, ${b.add(x.ordinal)}, ${b.add(x.label)}, ${b.add(x.units)}, ${b.add(actor.sub)}
                   WHERE ${markerExists(b, rid)}`,
        ),
      );
    }
  }

  const outcome = await runGuardedBatch(db, rid, stmts);
  if (outcome.kind === 'replayed') return { ok: true, data: JSON.parse(outcome.resultJson) as PartsData, replayed: true };
  if (outcome.kind === 'stale') return staleFail(db, p.taskId);
  return { ok: true, data };
}

export interface ClaimPartInput {
  taskId: number;
  requestId: string;
  expectedRevision: number;
  partId: number;
}

export interface ClaimPartData {
  root: RootView;
  claimed_units: number;
  ordinal: number;
  /** Өмнө нь энэ таск дээр хуваарилалттай байсан (хэсэг түүн дээр нэмэгдэв). */
  merged: boolean;
}

/**
 * Хүнгүй хэсгийг авна: хэсэг нь миний хуваарилалт болно (ижил дугаар + нэр), U −= units, хэсэг устна.  Өмнө нь энэ
 * таск дээр хуваарилалттай бол хэсэг түүн дээр нэмэгдэнэ (нэг хүн = нэг хуваарилалтын мөр, 0376 UNIQUE).  Цаг эхлүүлэхгүй —
 * дуудагч (▶) дараа нь `task-timer/start` дуудна.
 */
export async function claimPart(ctx: OpCtx, actor: Actor, p: ClaimPartInput): Promise<OpResult<ClaimPartData>> {
  const { db } = ctx;
  if (!validRequestId(p.requestId)) return fail(400, 'BAD_REQUEST_ID', 'request_id буруу');
  if (!Number.isInteger(p.partId) || p.partId <= 0) return fail(400, 'BAD_PART', 'Хэсэг буруу');
  const hash = await payloadHash('claim_part', { part: p.partId });
  const replay = await replayOf<ClaimPartData>(ctx, p.requestId, p.taskId, actor.sub, 'claim_part', hash);
  if (replay) return replay;
  const facts = await loadTaskFacts(db, p.taskId);
  const gate = checkTaskGate(facts, { requireSplittable: true });
  if (gate) return gate;
  const snap = await loadRoot(db, p.taskId);
  if (!snap) return fail(409, 'NOT_MANAGED', 'Энэ таск хуваагдаагүй');
  if (p.expectedRevision !== snap.root.revision) return staleFail(db, p.taskId);
  const me = (await loadUsers(db, [actor.sub])).get(actor.sub);
  if (!canHoldAllocation(me ?? { role: actor.role, status: 'active' }, actor.sub)) {
    return fail(403, 'ROLE_NOT_ALLOWED', 'Таны эрхээр таск авч ажиллах боломжгүй.');
  }
  const parts = snap.parts ?? [];
  const part = parts.find((x) => x.id === p.partId);
  if (!part) {
    return fail(409, 'PART_NOT_FOUND', 'Энэ хэсгийг өөр хүн авсан эсвэл устгасан — шинэчлэгдсэн төлөвийг харуулав', {
      current: rootView(snap),
    });
  }
  if (part.units > snap.root.unallocatedUnits) return fail(409, 'INVARIANT', 'Хэсэг хуваарилагдаагүй ажлаас их байна');

  const existing = snap.allocations.find((a) => a.userId === actor.sub) ?? null;
  const wasActive = existing !== null && existing.targetUnits > existing.doneUnits;
  const activeCount = snap.allocations.filter((a) => a.targetUnits > a.doneUnits).length;
  if (!wasActive && activeCount >= MAX_ACTIVE_ALLOCATIONS) {
    return fail(409, 'TOO_MANY', `Хамгийн ихдээ ${MAX_ACTIVE_ALLOCATIONS} хүн зэрэг ажиллана`);
  }
  let prevLabel: string | null = null;
  if (existing) {
    const row = await db
      .prepare('SELECT label FROM task_allocations WHERE task_id = ? AND user_id = ?')
      .bind(p.taskId, actor.sub)
      .first<{ label: string | null }>();
    prevLabel = row?.label ?? null;
  }
  const label = existing
    ? mergedLabel({ label: prevLabel, doneUnits: existing.doneUnits, targetUnits: existing.targetUnits }, facts.name, part.label)
    : part.label;

  const rid = p.requestId;
  const revAfter = snap.root.revision + 1;
  const afterAllocs: AllocationRecord[] = existing
    ? snap.allocations.map((a) =>
        a.userId === actor.sub
          ? {
              ...a,
              targetUnits: a.targetUnits + part.units,
              floorUnits: a.doneUnits,
              releasedUnits: Math.max(0, a.releasedUnits - part.units),
              revision: a.revision + 1,
            }
          : a,
      )
    : [
        ...snap.allocations,
        { id: 0, userId: actor.sub, ordinal: part.ordinal, targetUnits: part.units, doneUnits: 0, floorUnits: 0, releasedUnits: 0, revision: 1 },
      ].sort((a, b) => a.ordinal - b.ordinal);
  const afterRoot = { ...snap.root, revision: revAfter, unallocatedUnits: snap.root.unallocatedUnits - part.units };
  const afterParts = parts.filter((x) => x.id !== part.id);
  const afterState = toRootState(afterRoot, afterAllocs);
  const invariant = checkRootInvariants(afterState);
  if (invariant.length > 0) return fail(409, 'INVARIANT', `Хуваарилалт инвариант зөрчив: ${invariant[0]}`);
  const data: ClaimPartData = {
    root: rootView({ root: afterRoot, allocations: afterAllocs, state: afterState, parts: afterParts }),
    claimed_units: part.units,
    ordinal: existing ? existing.ordinal : part.ordinal,
    merged: existing !== null,
  };

  const stmts: D1PreparedStatement[] = [
    markerStmt(db, {
      requestId: rid,
      taskId: p.taskId,
      userId: actor.sub,
      kind: 'claim_part',
      requestHash: hash,
      revBefore: snap.root.revision,
      revAfter,
      beforeJson: JSON.stringify({ state: snap.state, parts }),
      afterJson: JSON.stringify({ state: afterState, parts: afterParts }),
      resultJson: JSON.stringify(data),
      guard: managedGuard(p.taskId, snap.root.revision),
    }),
  ];
  if (existing) {
    stmts.push(
      mk(
        db,
        (b) => `UPDATE task_allocations
                   SET target_units = target_units + ${b.add(part.units)}, floor_units = done_units,
                       released_units = MAX(0, released_units - ${b.add(part.units)}), label = ${b.add(label)},
                       revision = revision + 1, updated_at = datetime('now')
                 WHERE task_id = ${b.add(p.taskId)} AND user_id = ${b.add(actor.sub)} AND ${markerExists(b, rid)}`,
      ),
    );
  } else {
    stmts.push(
      mk(
        db,
        (b) => `INSERT INTO task_allocations (task_id, user_id, ordinal, target_units, done_units, floor_units, released_units, label)
                SELECT ${b.add(p.taskId)}, ${b.add(actor.sub)}, ${b.add(part.ordinal)}, ${b.add(part.units)}, 0, 0, 0, ${b.add(label)}
                 WHERE ${markerExists(b, rid)}`,
      ),
    );
  }
  stmts.push(
    mk(db, (b) => `DELETE FROM task_parts WHERE id = ${b.add(part.id)} AND task_id = ${b.add(p.taskId)} AND ${markerExists(b, rid)}`),
    mk(
      db,
      (b) => `UPDATE task_roots
                 SET revision = ${b.add(revAfter)}, unallocated_units = unallocated_units - ${b.add(part.units)},
                     updated_at = datetime('now')
               WHERE task_id = ${b.add(p.taskId)} AND ${markerExists(b, rid)}`,
    ),
  );
  const outcome = await runGuardedBatch(db, rid, stmts);
  if (outcome.kind === 'replayed') return { ok: true, data: JSON.parse(outcome.resultJson) as ClaimPartData, replayed: true };
  if (outcome.kind === 'stale') return staleFail(db, p.taskId);
  return { ok: true, data };
}

/* ------------------------------------------------------------------ */
/*  5. ӨӨРИЙН БҮРТГЭЛИЙГ ЗАСАХ (доод хязгаараас доош) / СЭРГЭЭХ          */
/* ------------------------------------------------------------------ */

export interface CorrectInput {
  taskId: number;
  requestId: string;
  expectedRevision: number;
  /** Хүчингүй болгох өөрийн хийсэн хэсгүүд (слайс) — `units` өгөхгүй бол бүтнээр нь. */
  items: Array<{ sliceId: number; units?: number }>;
  /** Админ өөр хүний хэсгийг засахад (аудитад actor ≠ owner). */
  ownerUserId?: number;
}

export interface CorrectData {
  root: RootView;
  reversed_units: number;
  reversed: { amount: number; delta_pct: number };
  reopened_root: boolean;
}

/**
 * ӨӨРИЙН явцын түүхэн бүртгэлийг (хуваалтаар түгжигдсэн доод хязгаараас доош ч) ТУСДАА үйлдлээр хүчингүй болгоно:
 * хэсэг бүрийн БОДИТ олгосон оноог анхны өдөрт нь сөрөг мөрөөр буцаана (өнөөдрийн жин/зорилтоор дахин бодохгүй),
 * `D` буурч доод хязгаар `L` түүнтэй хамт буурна, root progress буурч дууссан байсан бол дахин нээгдэнэ.  Бусдын
 * `D`, оноо, цаг, хуваарилалтыг ХӨНДӨХГҮЙ.  Анхны бичлэг устахгүй — `restore`-оор буцаана.
 */
export async function correctOwnProgress(ctx: OpCtx, actor: Actor, p: CorrectInput): Promise<OpResult<CorrectData>> {
  const { db } = ctx;
  if (!validRequestId(p.requestId)) return fail(400, 'BAD_REQUEST_ID', 'request_id буруу');
  if (!Number.isInteger(p.taskId) || p.taskId <= 0) return fail(400, 'BAD_TASK', 'Таск буруу');
  const owner = p.ownerUserId ?? actor.sub;
  if (owner !== actor.sub && actor.role !== 'admin') return fail(403, 'NOT_OWNER', 'Зөвхөн админ өөр хүний бүртгэлийг засна');
  if (!Array.isArray(p.items) || p.items.length === 0) return fail(400, 'NO_ITEMS', 'Засах бүртгэлээ сонгоно уу');
  const hash = await payloadHash('correct', {
    owner,
    items: [...p.items].sort((a, b) => a.sliceId - b.sliceId).map((i) => [i.sliceId, i.units ?? null]),
  });
  const replay = await replayOf<CorrectData>(ctx, p.requestId, p.taskId, actor.sub, 'correct', hash);
  if (replay) return replay;

  const facts = await loadTaskFacts(db, p.taskId);
  const snap = await loadRoot(db, p.taskId);
  if (!snap) return fail(409, 'NOT_MANAGED', 'Энэ таск хуваарилагдаагүй');
  const gate = checkTaskGate(facts, { requireSplittable: false, allowAutoArchived: true });
  if (gate) return gate;
  if (p.expectedRevision !== snap.root.revision) return staleFail(db, p.taskId);
  const mine = snap.allocations.find((a) => a.userId === owner);
  if (!mine) return fail(403, 'NO_ALLOCATION', 'Танд энэ ажилд хуваарилалт алга');

  const slices = await loadOpenSlices(db, p.taskId, owner);
  const byId = new Map(slices.map((s) => [s.id, s]));
  const open = slices.reduce((s, x) => s + x.unitsOpen, 0);
  if (open !== mine.doneUnits) {
    return fail(409, 'LEDGER_MISMATCH', 'Хийсэн хэсгийн журнал таарахгүй байна — удирдлагад мэдэгдэнэ үү', {
      done_units: mine.doneUnits,
      open_units: open,
    });
  }
  const seen = new Set<number>();
  const parts: ReversalPart[] = [];
  for (const it of p.items) {
    if (!Number.isInteger(it.sliceId) || seen.has(it.sliceId)) return fail(400, 'BAD_ITEM', 'Бүртгэл буруу эсвэл давхардсан');
    seen.add(it.sliceId);
    const sl = byId.get(it.sliceId);
    if (!sl) return fail(404, 'SLICE_NOT_FOUND', 'Энэ бүртгэл таных биш эсвэл аль хэдийн хүчингүй болсон', { slice_id: it.sliceId });
    const units = it.units === undefined ? sl.unitsOpen : it.units;
    if (!isUnits(units) || units <= 0 || units > sl.unitsOpen) {
      return fail(400, 'BAD_UNITS', 'Хүчингүй болгох хэмжээ буруу', { slice_id: it.sliceId, open_units: sl.unitsOpen });
    }
    const r = planReversal([sl], units);
    if (!r.ok) return fail(409, r.code, r.message);
    parts.push(...r.parts);
  }
  const reversedUnits = parts.reduce((s, x) => s + x.units, 0);
  const slackDelta = parts.reduce((s, x) => s + x.freeUnits, 0);
  const newDone = mine.doneUnits - reversedUnits;
  const newFloor = Math.min(mine.floorUnits, newDone);
  const rootBefore = rootDoneUnits(snap.state);
  const rootAfter = rootBefore - reversedUnits;
  const reopensRoot = rootBefore >= ROOT_TOTAL_UNITS && rootAfter < ROOT_TOTAL_UNITS;
  const reopenProject = reopensRoot && facts.projectStatus === 'archived' && facts.autoArchivedAt !== null;
  if (facts.projectStatus !== 'active' && !reopenProject) {
    return fail(409, 'PROJECT_INACTIVE', 'Төсөл идэвхгүй тул таск дээр ажиллах боломжгүй');
  }

  const nowMs = ctx.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const today = ctx.today ?? todayInUB();
  const createdAt = nextEntryTs(facts.lastCreatedAt, nowMs);
  const entryDate = projectionDate(today, facts.lastDate);
  const rid = p.requestId;
  const revAfter = snap.root.revision + 1;
  const afterAlloc = { ...mine, doneUnits: newDone, floorUnits: newFloor, revision: mine.revision + 1 };
  const afterAllocs = snap.allocations.map((a) => (a.userId === owner ? afterAlloc : a));
  const afterRoot = {
    ...snap.root,
    revision: revAfter,
    slackUnits: snap.root.slackUnits + slackDelta,
    completedAt: reopensRoot ? null : snap.root.completedAt,
  };
  const afterState = toRootState(afterRoot, afterAllocs);
  const invariant = checkRootInvariants(afterState);
  if (invariant.length > 0) return fail(409, 'INVARIANT', `Хуваарилалт инвариант зөрчив: ${invariant[0]}`);
  const totals = parts.reduce((a, x) => ({ amount: a.amount + x.amount, delta_pct: a.delta_pct + x.deltaPct }), { amount: 0, delta_pct: 0 });
  const data: CorrectData = {
    root: rootView({ root: afterRoot, allocations: afterAllocs, state: afterState, parts: snap?.parts ?? [] }),
    reversed_units: reversedUnits,
    reversed: totals,
    reopened_root: reopensRoot,
  };

  const source = 'alloc_adj';
  const entryIdExpr = (b: ParamBag) =>
    `(SELECT id FROM progress_entries WHERE task_id = ${b.add(p.taskId)} AND created_at = ${b.add(createdAt)}
        AND source = ${b.add(source)} ORDER BY id DESC LIMIT 1)`;
  const effects: PostEffects = {
    taskId: p.taskId,
    projectId: facts.projectId,
    owner,
    today,
    completedRoot: false,
    increase: false,
    snapshotFrom: earliestAwardedDay(parts.map((x) => x.awardedAt)),
  };
  const stmts: D1PreparedStatement[] = [
    markerStmt(db, {
      requestId: rid,
      taskId: p.taskId,
      userId: actor.sub,
      kind: 'correct',
      requestHash: hash,
      post: effects,
      revBefore: snap.root.revision,
      revAfter,
      beforeJson: stateJson(snap.state),
      afterJson: stateJson(afterState),
      resultJson: JSON.stringify(data),
      guard: (b) =>
        `${managedGuard(p.taskId, snap.root.revision)(b)}
         AND EXISTS (SELECT 1 FROM task_allocations a
                      WHERE a.task_id = ${b.add(p.taskId)} AND a.user_id = ${b.add(owner)}
                        AND a.done_units = ${b.add(mine.doneUnits)})`,
    }),
    mk(
      db,
      (b) => `INSERT INTO progress_entries
                (task_id, user_id, percentage, date, notes, status, reviewed_by, reviewed_at,
                 is_rest_day, defer_next_day, source, created_at)
              SELECT ${b.add(p.taskId)}, ${b.add(owner)}, ${b.add(rootAfter / UNITS_PER_POINT)}, ${b.add(entryDate)},
                     ${b.add('[Засвар] өөрийн бүртгэлийг хүчингүй болгов')}, 'approved', ${b.add(actor.sub)}, ${b.add(nowIso)},
                     0, 0, ${b.add(source)}, ${b.add(createdAt)}
               WHERE ${markerExists(b, rid)}`,
    ),
    mk(
      db,
      (b) => `UPDATE task_allocations
                 SET done_units = ${b.add(newDone)}, floor_units = ${b.add(newFloor)},
                     revision = revision + 1, updated_at = datetime('now')
               WHERE task_id = ${b.add(p.taskId)} AND user_id = ${b.add(owner)} AND ${markerExists(b, rid)}`,
    ),
    mk(
      db,
      (b) => `UPDATE task_roots
                 SET revision = ${b.add(revAfter)}, slack_units = ${b.add(afterRoot.slackUnits)},
                     completed_at = ${b.add(afterRoot.completedAt)}, updated_at = datetime('now')
               WHERE task_id = ${b.add(p.taskId)} AND ${markerExists(b, rid)}`,
    ),
    ...reversalStatements(db, {
      taskId: p.taskId,
      owner,
      actorId: actor.sub,
      projectId: facts.projectId,
      today,
      createdAt,
      rid,
      revAfter,
      parts,
      entryIdExpr,
      note: 'own correction',
    }),
  ];
  if (reopenProject) {
    stmts.push(
      mk(
        db,
        (b) => `UPDATE projects SET status = 'active', auto_archived_at = NULL, updated_at = datetime('now')
                 WHERE id = ${b.add(facts.projectId)} AND status = 'archived' AND auto_archived_at IS NOT NULL
                   AND ${markerExists(b, rid)}`,
      ),
    );
  }
  const outcome = await runGuardedBatch(db, rid, stmts);
  if (outcome.kind === 'replayed') return { ok: true, data: JSON.parse(outcome.resultJson) as CorrectData, replayed: true };
  if (outcome.kind === 'stale') return staleFail(db, p.taskId);
  await settlePostCommit(ctx, rid, effects, true);
  return { ok: true, data };
}

export interface RestoreInput {
  taskId: number;
  requestId: string;
  expectedRevision: number;
  /** Сэргээх залруулгын `request_id` (`GET …/records`-ийн `corrections[].request_id`). */
  correctionRequestId: string;
  completionQa?: Record<string, string> | null;
  ownerUserId?: number;
}

export interface RestoreData {
  root: RootView;
  restored_units: number;
  reached_own_cap: boolean;
  completed_root: boolean;
}

/**
 * Хүчингүй болгосон өөрийн бүртгэлийг СЭРГЭЭНЭ = залруулгын эсрэг үйлдэл: хэсгийн үлдэгдөл, анхны оноо (анхны
 * өдөр, анхны эзэн) буцаж ирнэ, ШИНЭ хуулбар оноо олгогдохгүй.  Нэг залруулгыг ДАХИН сэргээх боломжгүй.  Өөр хүн
 * хооронд тэр ажлыг хийсэн (root 100-аас хэтрэх), миний зорилт хүрэлцэхгүй (буцаасан) эсвэл slack-ийг бусад хүн
 * дүүргэсэн (давхар төлөгдөх) бол ТАТГАЛЗАНА — бусдынхыг хулгайлахгүй, ил тайлбарлана.  Зорилтод/100%-д хүргэх
 * сэргээлт нь дуусгах асуултын хариулт шаардана (хуучин хариултыг дахин ашиглахгүй).
 */
export async function restoreOwnProgress(ctx: OpCtx, actor: Actor, p: RestoreInput): Promise<OpResult<RestoreData>> {
  const { db } = ctx;
  if (!validRequestId(p.requestId)) return fail(400, 'BAD_REQUEST_ID', 'request_id буруу');
  if (!Number.isInteger(p.taskId) || p.taskId <= 0) return fail(400, 'BAD_TASK', 'Таск буруу');
  const owner = p.ownerUserId ?? actor.sub;
  if (owner !== actor.sub && actor.role !== 'admin') return fail(403, 'NOT_OWNER', 'Зөвхөн админ өөр хүний бүртгэлийг сэргээнэ');
  if (typeof p.correctionRequestId !== 'string' || p.correctionRequestId === '') {
    return fail(400, 'BAD_CORRECTION', 'Сэргээх залруулгаа сонгоно уу');
  }
  const hash = await payloadHash('restore', {
    owner,
    correction: p.correctionRequestId,
    qa: p.completionQa ? Object.entries(p.completionQa).sort(([a], [b]) => (a < b ? -1 : 1)) : null,
  });
  const replay = await replayOf<RestoreData>(ctx, p.requestId, p.taskId, actor.sub, 'restore', hash);
  if (replay) return replay;

  const facts = await loadTaskFacts(db, p.taskId);
  const gate = checkTaskGate(facts, { requireSplittable: false });
  if (gate) return gate;
  const snap = await loadRoot(db, p.taskId);
  if (!snap) return fail(409, 'NOT_MANAGED', 'Энэ таск хуваарилагдаагүй');
  if (p.expectedRevision !== snap.root.revision) return staleFail(db, p.taskId);
  const mine = snap.allocations.find((a) => a.userId === owner);
  if (!mine) return fail(403, 'NO_ALLOCATION', 'Танд энэ ажилд хуваарилалт алга');

  const { results } = await db
    .prepare(
      `SELECT id, ref_id, units, free_units, credit_amount, credit_delta_pct, points_id, awarded_at
         FROM task_contributions
        WHERE task_id = ? AND user_id = ? AND kind = 'correction' AND request_id = ? AND restored_at IS NULL
        ORDER BY seq`,
    )
    .bind(p.taskId, owner, p.correctionRequestId)
    .all<{
      id: number;
      ref_id: number;
      units: number;
      free_units: number;
      credit_amount: number;
      credit_delta_pct: number;
      points_id: number | null;
      awarded_at: string;
    }>();
  const events = results ?? [];
  if (events.length === 0) return fail(409, 'NOTHING_TO_RESTORE', 'Сэргээх бүртгэл олдсонгүй эсвэл аль хэдийн сэргээгдсэн');

  const restoreUnits = events.reduce((s, e) => s - e.units, 0);
  const free = events.reduce((s, e) => s + e.free_units, 0);
  const rootBefore = rootDoneUnits(snap.state);
  if (mine.doneUnits + restoreUnits > mine.targetUnits) {
    return fail(409, 'RESTORE_OVER_TARGET', 'Таны одоогийн зорилт сэргээх хэмжээнд хүрэлцэхгүй — эхлээд үлдсэн ажлаа дахин аваарай', {
      available_units: mine.targetUnits - mine.doneUnits,
      restore_units: restoreUnits,
    });
  }
  if (rootBefore + restoreUnits > ROOT_TOTAL_UNITS) {
    return fail(409, 'RESTORE_OVER_ROOT', 'Энэ хугацаанд өөр хүн тэр ажлыг хийсэн тул сэргээх боломжгүй', {
      available_units: ROOT_TOTAL_UNITS - rootBefore,
      restore_units: restoreUnits,
    });
  }
  if (free > snap.root.slackUnits) {
    return fail(409, 'SLACK_CONSUMED', 'Эдгээр нэгжид оноо аль хэдийн олгогдсон тул сэргээвэл давхар төлөгдөнө — удирдлагад хандана уу');
  }

  const newDone = mine.doneUnits + restoreUnits;
  const rootAfter = rootBefore + restoreUnits;
  const reachesOwnCap = newDone === mine.targetUnits;
  const completesRoot = rootBefore < ROOT_TOTAL_UNITS && rootAfter >= ROOT_TOTAL_UNITS;
  let qaJson: string | null = null;
  if (reachesOwnCap || completesRoot) {
    const qa = validateQa(facts.completionQuestions, p.completionQa);
    if (!qa.ok) {
      return fail(400, 'completion_qa required', 'Ажил дуусгахын тулд бүх асуултад хариулна уу.', {
        questions: qa.questions,
        missing: qa.missing,
        scopes: { own: reachesOwnCap, root: completesRoot },
      });
    }
    qaJson = qa.json;
  }

  const nowMs = ctx.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const today = ctx.today ?? todayInUB();
  const createdAt = nextEntryTs(facts.lastCreatedAt, nowMs);
  const entryDate = projectionDate(today, facts.lastDate);
  const rid = p.requestId;
  const revAfter = snap.root.revision + 1;
  const afterAlloc = { ...mine, doneUnits: newDone, revision: mine.revision + 1 };
  const afterAllocs = snap.allocations.map((a) => (a.userId === owner ? afterAlloc : a));
  const afterRoot = {
    ...snap.root,
    revision: revAfter,
    slackUnits: snap.root.slackUnits - free,
    completedAt: completesRoot ? nowIso : snap.root.completedAt,
  };
  const afterState = toRootState(afterRoot, afterAllocs);
  const invariant = checkRootInvariants(afterState);
  if (invariant.length > 0) return fail(409, 'INVARIANT', `Хуваарилалт инвариант зөрчив: ${invariant[0]}`);
  const data: RestoreData = {
    root: rootView({ root: afterRoot, allocations: afterAllocs, state: afterState, parts: snap?.parts ?? [] }),
    restored_units: restoreUnits,
    reached_own_cap: reachesOwnCap,
    completed_root: completesRoot,
  };

  const source = 'alloc_adj';
  const entryIdExpr = (b: ParamBag) =>
    `(SELECT id FROM progress_entries WHERE task_id = ${b.add(p.taskId)} AND created_at = ${b.add(createdAt)}
        AND source = ${b.add(source)} ORDER BY id DESC LIMIT 1)`;
  const effects: PostEffects = {
    taskId: p.taskId,
    projectId: facts.projectId,
    owner,
    today,
    completedRoot: completesRoot,
    increase: false,
    snapshotFrom: earliestAwardedDay(events.map((e) => e.awarded_at)),
    reweight: true,
  };
  const stmts: D1PreparedStatement[] = [
    markerStmt(db, {
      requestId: rid,
      taskId: p.taskId,
      userId: actor.sub,
      kind: 'restore',
      requestHash: hash,
      post: effects,
      revBefore: snap.root.revision,
      revAfter,
      beforeJson: stateJson(snap.state),
      afterJson: stateJson(afterState),
      resultJson: JSON.stringify(data),
      guard: (b) =>
        `${managedGuard(p.taskId, snap.root.revision)(b)}
         AND EXISTS (SELECT 1 FROM task_allocations a
                      WHERE a.task_id = ${b.add(p.taskId)} AND a.user_id = ${b.add(owner)}
                        AND a.done_units = ${b.add(mine.doneUnits)} AND a.target_units = ${b.add(mine.targetUnits)})`,
    }),
    mk(
      db,
      (b) => `INSERT INTO progress_entries
                (task_id, user_id, percentage, date, notes, status, reviewed_by, reviewed_at,
                 is_rest_day, defer_next_day, completion_qa, source, created_at)
              SELECT ${b.add(p.taskId)}, ${b.add(owner)}, ${b.add(rootAfter / UNITS_PER_POINT)}, ${b.add(entryDate)},
                     ${b.add('[Сэргээлт] өмнө хүчингүй болгосон бүртгэлийг буцаав')}, 'approved', ${b.add(actor.sub)}, ${b.add(nowIso)},
                     0, 0, ${b.add(completesRoot ? qaJson : null)}, ${b.add(source)}, ${b.add(createdAt)}
               WHERE ${markerExists(b, rid)}`,
    ),
    mk(
      db,
      (b) => `UPDATE task_allocations
                 SET done_units = ${b.add(newDone)}, revision = revision + 1, updated_at = datetime('now')
               WHERE task_id = ${b.add(p.taskId)} AND user_id = ${b.add(owner)} AND ${markerExists(b, rid)}`,
    ),
    mk(
      db,
      (b) => `UPDATE task_roots
                 SET revision = ${b.add(revAfter)}, slack_units = ${b.add(afterRoot.slackUnits)},
                     completed_at = ${b.add(afterRoot.completedAt)}, updated_at = datetime('now')
               WHERE task_id = ${b.add(p.taskId)} AND ${markerExists(b, rid)}`,
    ),
  ];
  events.forEach((e, i) => {
    const units = -e.units;
    const amount = -(Number(e.credit_amount) || 0);
    const deltaPct = -(Number(e.credit_delta_pct) || 0);
    stmts.push(
      mk(
        db,
        (b) => `INSERT INTO task_contributions
                  (task_id, allocation_id, user_id, actor_id, kind, units, units_open, free_units,
                   credit_amount, credit_delta_pct, ref_id, progress_entry_id, work_date, awarded_at,
                   recorded_at, request_id, seq, root_revision, note)
                SELECT ${b.add(p.taskId)}, (SELECT a.id FROM task_allocations a WHERE a.task_id = ${b.add(p.taskId)} AND a.user_id = ${b.add(owner)}),
                       ${b.add(owner)}, ${b.add(actor.sub)}, 'restore', ${b.add(units)}, 0, ${b.add(e.free_units)},
                       ${b.add(amount)}, ${b.add(deltaPct)}, ${b.add(e.id)}, ${entryIdExpr(b)},
                       ${b.add(today)}, ${b.add(e.awarded_at)}, ${b.add(createdAt)}, ${b.add(rid)}, ${b.add(i)},
                       ${b.add(revAfter)}, 'restore of correction'
                 WHERE ${markerExists(b, rid)}`,
      ),
      mk(
        db,
        (b) => `UPDATE task_contributions
                   SET units_open = units_open + ${b.add(units)}, free_open = free_open + ${b.add(e.free_units)},
                       credit_open_amount = credit_open_amount + ${b.add(amount)},
                       credit_open_delta_pct = credit_open_delta_pct + ${b.add(deltaPct)}
                 WHERE id = ${b.add(e.ref_id)} AND ${markerExists(b, rid)}`,
      ),
      mk(
        db,
        (b) => `UPDATE task_contributions
                   SET restored_at = ${b.add(nowIso)}, restore_request_id = ${b.add(rid)}
                 WHERE id = ${b.add(e.id)} AND restored_at IS NULL AND ${markerExists(b, rid)}`,
      ),
    );
    if (amount > 0) {
      stmts.push(
        mk(
          db,
          (b) => `INSERT INTO user_points
                    (user_id, project_id, task_id, progress_entry_id, amount, delta_pct, assignee_count,
                     awarded_by, source, awarded_at, contribution_id, reverses_points_id, recorded_at)
                  SELECT ${b.add(owner)}, ${b.add(facts.projectId)}, ${b.add(p.taskId)}, ${entryIdExpr(b)},
                         ${b.add(amount)}, ${b.add(deltaPct)}, 1, ${b.add(actor.sub)}, 'progress', ${b.add(e.awarded_at)},
                         (SELECT id FROM task_contributions WHERE request_id = ${b.add(rid)} AND seq = ${b.add(i)}),
                         ${b.add(e.points_id)}, ${b.add(createdAt)}
                   WHERE ${markerExists(b, rid)}`,
        ),
        mk(
          db,
          (b) => `UPDATE task_contributions
                     SET points_id = (SELECT up.id FROM user_points up WHERE up.contribution_id = task_contributions.id ORDER BY up.id LIMIT 1)
                   WHERE request_id = ${b.add(rid)} AND seq = ${b.add(i)} AND ${markerExists(b, rid)}`,
        ),
      );
    }
  });
  if (reachesOwnCap || completesRoot) {
    stmts.push(...completionStopStatements(db, { taskId: p.taskId, owner, actorId: actor.sub, nowIso, rid, all: completesRoot }));
  }
  const outcome = await runGuardedBatch(db, rid, stmts);
  if (outcome.kind === 'replayed') return { ok: true, data: JSON.parse(outcome.resultJson) as RestoreData, replayed: true };
  if (outcome.kind === 'stale') return staleFail(db, p.taskId);
  await settlePostCommit(ctx, rid, effects, true);
  return { ok: true, data };
}

export interface OwnRecords {
  /** Одоо хүчинтэй (хүчингүй болгож болох) хийсэн хэсгүүд — шинэ → хуучин. */
  slices: Array<{
    id: number;
    kind: 'work' | 'seed';
    units_open: number;
    work_date: string;
    awarded_at: string;
    credit_open_amount: number;
    /** Хуучин системээс шилжсэн оноотой мөр. */
    legacy: boolean;
  }>;
  /** Хүчингүй болгосон ч СЭРГЭЭЖ болох залруулгууд (залруулга бүр нэг `request_id`). */
  corrections: Array<{
    request_id: string;
    recorded_at: string;
    units: number;
    credit_amount: number;
    note: string | null;
  }>;
}

export async function loadOwnRecords(db: D1Database, taskId: number, userId: number): Promise<OwnRecords> {
  const [slices, corrections] = await Promise.all([
    db
      .prepare(
        `SELECT id, kind, units_open, work_date, awarded_at, credit_open_amount
           FROM task_contributions
          WHERE task_id = ? AND user_id = ? AND kind IN ('work', 'seed') AND units_open > 0
          ORDER BY id DESC`,
      )
      .bind(taskId, userId)
      .all<{ id: number; kind: 'work' | 'seed'; units_open: number; work_date: string; awarded_at: string; credit_open_amount: number }>(),
    db
      .prepare(
        `SELECT request_id, MIN(recorded_at) AS recorded_at, SUM(-units) AS units, SUM(-credit_amount) AS credit,
                MIN(note) AS note
           FROM task_contributions
          WHERE task_id = ? AND user_id = ? AND kind = 'correction' AND restored_at IS NULL
          GROUP BY request_id
          ORDER BY MIN(id) DESC`,
      )
      .bind(taskId, userId)
      .all<{ request_id: string; recorded_at: string; units: number; credit: number; note: string | null }>(),
  ]);
  return {
    slices: (slices.results ?? []).map((s) => ({
      id: s.id,
      kind: s.kind,
      units_open: s.units_open,
      work_date: s.work_date,
      awarded_at: s.awarded_at,
      credit_open_amount: Number(s.credit_open_amount) || 0,
      legacy: s.kind === 'seed',
    })),
    corrections: (corrections.results ?? []).map((c) => ({
      request_id: c.request_id,
      recorded_at: c.recorded_at,
      units: Number(c.units) || 0,
      credit_amount: Number(c.credit) || 0,
      note: c.note,
    })),
  };
}

/* ------------------------------------------------------------------ */
/*  Харагдац: нэг таскийн тойм                                          */
/* ------------------------------------------------------------------ */

export interface AllocationOverview {
  task: {
    id: number;
    name: string;
    project_id: number;
    project_status: string | null;
    splittable: boolean;
    latest_pct: number;
  };
  managed: boolean;
  root: RootView | null;
  /** Managed болоогүй таскийн seed-ийн ТӨЛӨВЛӨГӨӨ (юу ч бичигдээгүй). */
  preview: {
    attribution: string;
    root_done_units: number;
    unattributed_units: number;
    slack_units: number;
    participants: Array<{ user_id: number; done_units: number }>;
    reasons: string[];
  } | null;
  me: ParticipantView | null;
  allowed: {
    edit: boolean;
    progress: boolean;
    release: boolean;
    retake: boolean;
    /** Хүнгүй хэсэг болгон хуваах / хэсгүүдийг засах (0394) — таск авах эрхтэй бүх ажилтан. */
    parts: boolean;
  };
}

export async function loadAllocationOverview(
  db: D1Database,
  actor: Actor,
  taskId: number,
): Promise<OpResult<AllocationOverview>> {
  const facts = await loadTaskFacts(db, taskId);
  if (!facts.exists) return fail(404, 'TASK_NOT_FOUND', 'Таск олдсонгүй');
  const snap = await loadRoot(db, taskId);
  const splittable = isSplittableTask({ progress_mode: facts.progressMode, weight_percent: facts.weight });
  const base = {
    id: facts.taskId,
    name: facts.name,
    project_id: facts.projectId,
    project_status: facts.projectStatus,
    splittable,
    latest_pct: facts.latestPct,
  };
  const eligible = canTakeRole(actor.role, isCeo(actor.sub));
  const active = facts.projectStatus === 'active' && facts.progressMode !== 'hours';
  if (snap) {
    const view = rootView(snap);
    const me = view.participants.find((x) => x.user_id === actor.sub) ?? null;
    const isParticipant = me !== null;
    return {
      ok: true,
      data: {
        task: base,
        managed: true,
        root: view,
        preview: null,
        me,
        allowed: {
          edit: active && splittable && (isParticipant || isManagerRole(actor.role)),
          progress: active && me !== null && me.future_units > 0,
          release: active && me !== null && me.future_units > 0,
          retake: active && eligible && view.free_units > 0,
          parts: active && splittable && (eligible || isManagerRole(actor.role)),
        },
      },
    };
  }
  let preview: AllocationOverview['preview'] = null;
  if (facts.latestPct < 100) {
    const plan = await (async () => {
      const ev = await loadSeedEvidence(db, taskId);
      return planSeed({ entries: ev.entries, credits: ev.credits, coef: facts.coef });
    })();
    if (plan.ok) {
      const byUser = new Map<number, number>();
      for (const s of plan.slices) byUser.set(s.userId, (byUser.get(s.userId) ?? 0) + s.units);
      preview = {
        attribution: plan.attribution,
        root_done_units: plan.rootDoneUnits,
        unattributed_units: plan.unattributedUnits,
        slack_units: plan.slackUnits,
        participants: [...byUser].map(([user_id, done_units]) => ({ user_id, done_units })),
        reasons: plan.reasons,
      };
    }
  }
  return {
    ok: true,
    data: {
      task: base,
      managed: false,
      root: null,
      preview,
      me: null,
      allowed: {
        edit: active && splittable && facts.latestPct < 100 && (isManagerRole(actor.role) || eligible),
        progress: false,
        release: false,
        retake: false,
        parts: active && splittable && facts.latestPct < 100 && (isManagerRole(actor.role) || eligible),
      },
    },
  };
}

/** Тус хэсгийн ирээдүйн ажил (T − D). */
export { futureUnitsOf };
