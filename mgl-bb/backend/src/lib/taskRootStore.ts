/**
 * ТАСКИЙН ХУВААРИЛАЛТ — D1 УНШИЛТ + АТОМ МУТАЦИЙН СУУРЬ (migration 0376–0379, 2026-10-02).
 *
 * Дүрэм (цэвэр, тесттэй): `taskUnits.ts`, `taskAllocation.ts`, `taskCredit.ts`, `taskSeed.ts`.
 * Мутацийн нарийвчилсан логик: `taskRootOps.ts`.  Энэ файл:
 *   • таск/төслийн баримт (`loadTaskFacts`), root + оролцогчдын төлөв (`loadRoot`),
 *   • хуучин түүхийн seed-ийн нотолгоо (`loadSeedEvidence`),
 *   • параметр цуглуулагч (`ParamBag`) — `?N`-тэй D1 statement-ийг ЦЭВЭРХЭН бичих,
 *   • marker-тэй batch ажиллуулагч (`runGuardedBatch`) — CAS, идемпотент, дахин оролдлого.
 *
 * ⚠️ АТОМ ЧАНАР.  D1 `batch()` нь нэг транзакц.  Мутаци бүр ЭХЛЭЭД `task_ops`-д marker мөр бичнэ —
 * `INSERT … SELECT … WHERE <CAS шалгалт>`; хуучирсан revision бол marker бичигдэхгүй (changes = 0),
 * дараагийн БҮХ statement `EXISTS (marker)`-ээр хамгаалагдсан тул юу ч бичигдэхгүй.  Ижил
 * `request_id` дахин ирвэл marker-ийн PRIMARY KEY мөргөлдөж batch бүхлээрээ ROLLBACK болно →
 * хадгалсан `result_json`-ийг буцаана (давхар оноо, давхар цаг, давхар дугаар үүсэхгүй).
 */
import { COMPLEXITY_PERCENT } from '../types';
import { latestApprovedPctByCreatedAt } from './progressLatest';
import { rootDoneUnits, rootRemainingUnits, type AllocRow, type RootAllocState } from './taskAllocation';
import { taskProjectCoef } from './taskCredit';
import { planSeed, type SeedCreditRow, type SeedEntry, type SeedPlan } from './taskSeed';
import { ROOT_TOTAL_UNITS, UNITS_PER_POINT } from './taskUnits';
import { reservedUnitsOf, type PartRecord } from './taskParts';

/* ------------------------------------------------------------------ */
/*  Параметр цуглуулагч                                                */
/* ------------------------------------------------------------------ */

/**
 * `?N` дугаартай bind-ийг ЦЭВЭРХЭН бичих туслах: `bag.add(v)` утгыг цуглуулж `?N` буцаана; нэг
 * утгыг олон удаа ашиглах бол буцаасан тэмдэгтийг дахин бичнэ.  Байрлалын bind-ийн алдаа
 * (statement засахад дараалал эвдрэх) энэ репод хамгийн түгээмэл алдаа тул.
 */
export class ParamBag {
  readonly values: Array<string | number | null> = [];
  add(v: string | number | null | undefined): string {
    this.values.push(v === undefined ? null : v);
    return `?${this.values.length}`;
  }
}

export function stmt(db: D1Database, bag: ParamBag, sql: string): D1PreparedStatement {
  return db.prepare(sql).bind(...bag.values);
}

/* ------------------------------------------------------------------ */
/*  Таск/төслийн баримт                                                 */
/* ------------------------------------------------------------------ */

export interface TaskFacts {
  exists: boolean;
  taskId: number;
  name: string;
  weight: number;
  componentId: number;
  projectId: number;
  projectStatus: string | null;
  progressMode: string | null;
  autoArchivedAt: string | null;
  complexityPct: number;
  completionQuestions: string | null;
  drawingWeight: number;
  blockWeight: number;
  teamShare: number;
  /** `taskProjectCoef` — төслийн 1 пунктэд ногдох хувь (calcProjectProgress-тэй ижил). */
  coef: number;
  /** Сүүлийн батлагдсан хувь (хувь, 0..100). */
  latestPct: number;
  /** Батлагдсан бичлэгийн хамгийн сүүлийн `date`, `created_at`, `id` (projection-ийн огноо/дараалал). */
  lastDate: string | null;
  lastCreatedAt: string | null;
  lastEntryId: number;
  lastPointsId: number;
}

interface TaskFactsRow {
  id: number;
  name: string;
  weight_percent: number;
  component_id: number;
  project_id: number;
  block_w: number | null;
  drawing_w: number | null;
  project_status: string | null;
  progress_mode: string | null;
  auto_archived_at: string | null;
  complexity_pct: number | null;
  completion_questions: string | null;
  team_share: number | null;
  latest_pct: number | null;
  last_date: string | null;
  last_created_at: string | null;
  last_entry_id: number | null;
  last_points_id: number | null;
}

export async function loadTaskFacts(db: D1Database, taskId: number): Promise<TaskFacts> {
  const row = await db
    .prepare(
      `SELECT t.id, t.name, t.weight_percent, t.component_id, b.project_id,
              b.weight_percent AS block_w, d.weight_percent AS drawing_w,
              p.status AS project_status, p.progress_mode, p.auto_archived_at,
              p.complexity_pct, p.completion_questions,
              (SELECT s.share_percent FROM project_team_shares s
                WHERE s.project_id = b.project_id AND s.team_id = b.team_id) AS team_share,
              COALESCE(${latestApprovedPctByCreatedAt('t.id')}, 0) AS latest_pct,
              (SELECT MAX(x.date) FROM progress_entries x WHERE x.task_id = t.id AND x.status = 'approved') AS last_date,
              (SELECT MAX(x.created_at) FROM progress_entries x WHERE x.task_id = t.id) AS last_created_at,
              (SELECT MAX(x.id) FROM progress_entries x WHERE x.task_id = t.id AND x.status = 'approved') AS last_entry_id,
              (SELECT MAX(u.id) FROM user_points u WHERE u.task_id = t.id AND u.source = 'progress') AS last_points_id
         FROM tasks t
         INNER JOIN components c ON c.id = t.component_id
         INNER JOIN drawings d   ON d.id = c.drawing_id
         INNER JOIN blocks b     ON b.id = d.block_id
         INNER JOIN projects p   ON p.id = b.project_id
        WHERE t.id = ?`,
    )
    .bind(taskId)
    .first<TaskFactsRow>();
  if (!row) {
    return {
      exists: false,
      taskId,
      name: '',
      weight: 0,
      componentId: 0,
      projectId: 0,
      projectStatus: null,
      progressMode: null,
      autoArchivedAt: null,
      complexityPct: 0,
      completionQuestions: null,
      drawingWeight: 0,
      blockWeight: 0,
      teamShare: 0,
      coef: 0,
      latestPct: 0,
      lastDate: null,
      lastCreatedAt: null,
      lastEntryId: 0,
      lastPointsId: 0,
    };
  }
  const weight = Number(row.weight_percent) || 0;
  const drawingWeight = Number(row.drawing_w) || 0;
  const blockWeight = Number(row.block_w) || 0;
  const teamShare = Number(row.team_share) || 0;
  return {
    exists: true,
    taskId: row.id,
    name: row.name,
    weight,
    componentId: row.component_id,
    projectId: row.project_id,
    projectStatus: row.project_status,
    progressMode: row.progress_mode,
    autoArchivedAt: row.auto_archived_at,
    complexityPct: Math.max(0, row.complexity_pct ?? COMPLEXITY_PERCENT.mid),
    completionQuestions: row.completion_questions,
    drawingWeight,
    blockWeight,
    teamShare,
    coef: taskProjectCoef({ taskWeight: weight, drawingWeight, blockWeight, teamShare }),
    latestPct: Number(row.latest_pct) || 0,
    lastDate: row.last_date,
    lastCreatedAt: row.last_created_at,
    lastEntryId: Number(row.last_entry_id) || 0,
    lastPointsId: Number(row.last_points_id) || 0,
  };
}

/**
 * Бүтцийн guard: оноо тооцох үеийн жин/төвөгшил batch-ийн мөчид ӨӨРЧЛӨГДӨӨГҮЙ гэдгийг SQL-д батлах.
 * (Pre-read → batch хоорондох цонхонд админ жин засвал оноо буруу коэффициентээр бичигдэхгүй.)
 */
export function structureGuardSql(bag: ParamBag, f: TaskFacts): string {
  return `EXISTS (
      SELECT 1 FROM tasks t
        JOIN components c ON c.id = t.component_id
        JOIN drawings d   ON d.id = c.drawing_id
        JOIN blocks b     ON b.id = d.block_id
        JOIN projects p   ON p.id = b.project_id
       WHERE t.id = ${bag.add(f.taskId)}
         AND t.weight_percent = ${bag.add(f.weight)}
         AND COALESCE(d.weight_percent, 0) = ${bag.add(f.drawingWeight)}
         AND COALESCE(b.weight_percent, 0) = ${bag.add(f.blockWeight)}
         AND COALESCE((SELECT s.share_percent FROM project_team_shares s
                        WHERE s.project_id = b.project_id AND s.team_id = b.team_id), 0) = ${bag.add(f.teamShare)}
         AND COALESCE(p.complexity_pct, ${COMPLEXITY_PERCENT.mid}) = ${bag.add(f.complexityPct)})`;
}

/* ------------------------------------------------------------------ */
/*  Root + оролцогчид                                                   */
/* ------------------------------------------------------------------ */

export interface RootRecord {
  taskId: number;
  revision: number;
  unattributedUnits: number;
  unallocatedUnits: number;
  slackUnits: number;
  nextOrdinal: number;
  seedAttribution: string | null;
  completedAt: string | null;
}

export interface AllocationRecord extends AllocRow {
  id: number;
  ordinal: number;
  releasedUnits: number;
  revision: number;
}

export interface RootSnapshot {
  root: RootRecord;
  allocations: AllocationRecord[];
  state: RootAllocState;
  /** Хүнгүй хэсгүүд (0394) — U-ийн доторх нэрлэсэн нөөц.  Хоосон/байхгүй = хэсэггүй. */
  parts?: PartRecord[];
}

interface RootRow {
  task_id: number;
  revision: number;
  unattributed_units: number;
  unallocated_units: number;
  slack_units: number;
  next_ordinal: number;
  seed_attribution: string | null;
  completed_at: string | null;
}

interface AllocRowDb {
  id: number;
  user_id: number;
  ordinal: number;
  target_units: number;
  done_units: number;
  floor_units: number;
  released_units: number;
  revision: number;
}

export function toRootState(root: RootRecord, allocations: readonly AllocationRecord[]): RootAllocState {
  return {
    unattributedUnits: root.unattributedUnits,
    unallocatedUnits: root.unallocatedUnits,
    rows: allocations.map((a) => ({
      userId: a.userId,
      doneUnits: a.doneUnits,
      floorUnits: a.floorUnits,
      targetUnits: a.targetUnits,
    })),
  };
}

/** managed root-ийн төлөв (revision + оролцогчид); managed биш бол null. */
export async function loadRoot(db: D1Database, taskId: number): Promise<RootSnapshot | null> {
  const [rootRow, allocRes, parts] = await Promise.all([
    db
      .prepare(
        `SELECT task_id, revision, unattributed_units, unallocated_units, slack_units, next_ordinal,
                seed_attribution, completed_at
           FROM task_roots WHERE task_id = ?`,
      )
      .bind(taskId)
      .first<RootRow>(),
    db
      .prepare(
        `SELECT id, user_id, ordinal, target_units, done_units, floor_units, released_units, revision
           FROM task_allocations WHERE task_id = ? ORDER BY ordinal`,
      )
      .bind(taskId)
      .all<AllocRowDb>(),
    loadParts(db, taskId),
  ]);
  if (!rootRow) return null;
  const root: RootRecord = {
    taskId: rootRow.task_id,
    revision: rootRow.revision,
    unattributedUnits: rootRow.unattributed_units,
    unallocatedUnits: rootRow.unallocated_units,
    slackUnits: rootRow.slack_units,
    nextOrdinal: rootRow.next_ordinal,
    seedAttribution: rootRow.seed_attribution,
    completedAt: rootRow.completed_at,
  };
  const allocations: AllocationRecord[] = (allocRes.results ?? []).map((r) => ({
    id: r.id,
    userId: r.user_id,
    ordinal: r.ordinal,
    targetUnits: r.target_units,
    doneUnits: r.done_units,
    floorUnits: r.floor_units,
    releasedUnits: r.released_units,
    revision: r.revision,
  }));
  return { root, allocations, state: toRootState(root, allocations), parts };
}

/**
 * Таскийн хүнгүй хэсгүүд (0394), дугаарын дарааллаар.  ⚠️ Хүснэгт хараахан үүсээгүй орчинд (миграцаас өмнө deploy) хоосон
 * — хуваарилалтын бусад үйлдэл унахгүй.
 */
export async function loadParts(db: D1Database, taskId: number): Promise<PartRecord[]> {
  try {
    const { results } = await db
      .prepare('SELECT id, ordinal, label, units FROM task_parts WHERE task_id = ? ORDER BY ordinal')
      .bind(taskId)
      .all<PartRecord>();
    return results ?? [];
  } catch (err) {
    if (String(err).includes('no such table')) return [];
    throw err;
  }
}

/** D1: нэг statement-д ХАМГИЙН ИХДЭЭ 100 bind параметр — IN (?,?,…) жагсаалтыг энэ хэмжээгээр хэсэглэнэ. */
export const D1_IN_CHUNK = 90;

export function chunked<T>(items: readonly T[], size = D1_IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Хэд хэдэн таскийн root-ийг хэсэг тутамд хоёр асуулгаар (project дэлгэцийн мөр бүрд дуудахгүй).
 *
 * ⚠️ D1-ийн 100-bind хязгаар: өмнө нь БҮХ id-г нэг `IN (?,…)`-д өгдөг байсан тул 100-аас олон нээлттэй тасктай хүний
 *    «Миний ажлууд» (`/progress/my-tasks`) унаж, `try/catch` залгисан тул managed таскууд ЧИМЭЭГҮЙ ердийн (хуваарилагдаагүй)
 *    мэт харагддаг байв — хуучин % маягт гарч 409 MANAGED_ROOT өгнө.
 */
export async function loadRootsForTasks(
  db: D1Database,
  taskIds: readonly number[],
): Promise<Map<number, RootSnapshot>> {
  const out = new Map<number, RootSnapshot>();
  for (const part of chunked([...new Set(taskIds)])) {
    const marks = part.map(() => '?').join(',');
    const [roots, allocs] = await Promise.all([
      db
        .prepare(
          `SELECT task_id, revision, unattributed_units, unallocated_units, slack_units, next_ordinal,
                  seed_attribution, completed_at FROM task_roots WHERE task_id IN (${marks})`,
        )
        .bind(...part)
        .all<RootRow>(),
      db
        .prepare(
          `SELECT id, task_id, user_id, ordinal, target_units, done_units, floor_units, released_units, revision
             FROM task_allocations WHERE task_id IN (${marks}) ORDER BY task_id, ordinal`,
        )
        .bind(...part)
        .all<AllocRowDb & { task_id: number }>(),
    ]);
    const byTask = new Map<number, AllocationRecord[]>();
    for (const r of allocs.results ?? []) {
      const list = byTask.get(r.task_id) ?? [];
      list.push({
        id: r.id,
        userId: r.user_id,
        ordinal: r.ordinal,
        targetUnits: r.target_units,
        doneUnits: r.done_units,
        floorUnits: r.floor_units,
        releasedUnits: r.released_units,
        revision: r.revision,
      });
      byTask.set(r.task_id, list);
    }
    for (const r of roots.results ?? []) {
      const root: RootRecord = {
        taskId: r.task_id,
        revision: r.revision,
        unattributedUnits: r.unattributed_units,
        unallocatedUnits: r.unallocated_units,
        slackUnits: r.slack_units,
        nextOrdinal: r.next_ordinal,
        seedAttribution: r.seed_attribution,
        completedAt: r.completed_at,
      };
      const allocations = byTask.get(r.task_id) ?? [];
      out.set(r.task_id, { root, allocations, state: toRootState(root, allocations) });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Хуучин түүхийн seed                                                 */
/* ------------------------------------------------------------------ */

export async function loadSeedEvidence(
  db: D1Database,
  taskId: number,
): Promise<{ entries: SeedEntry[]; credits: SeedCreditRow[] }> {
  const [entries, credits] = await Promise.all([
    db
      .prepare(
        `SELECT id, user_id, credit_user_id, is_baseline, source, percentage
           FROM progress_entries
          WHERE task_id = ? AND status = 'approved'
          ORDER BY created_at ASC, id ASC`,
      )
      .bind(taskId)
      .all<{
        id: number;
        user_id: number;
        credit_user_id: number | null;
        is_baseline: number;
        source: string | null;
        percentage: number;
      }>(),
    db
      .prepare(
        `SELECT id, user_id, delta_pct, amount, awarded_at, progress_entry_id
           FROM user_points
          WHERE task_id = ? AND source = 'progress'
          ORDER BY awarded_at ASC, id ASC`,
      )
      .bind(taskId)
      .all<{
        id: number;
        user_id: number;
        delta_pct: number;
        amount: number;
        awarded_at: string;
        progress_entry_id: number | null;
      }>(),
  ]);
  return {
    entries: (entries.results ?? []).map((e) => ({
      id: e.id,
      userId: e.user_id,
      creditUserId: e.credit_user_id,
      isBaseline: e.is_baseline === 1,
      source: e.source,
      units: Math.round((Number(e.percentage) || 0) * UNITS_PER_POINT),
    })),
    credits: (credits.results ?? []).map((c) => ({
      pointsId: c.id,
      userId: c.user_id,
      deltaPct: Number(c.delta_pct) || 0,
      amount: Number(c.amount) || 0,
      awardedAt: c.awarded_at,
      progressEntryId: c.progress_entry_id,
    })),
  };
}

/** Managed болоогүй таскийн seed-ийн ТӨЛӨВЛӨГӨӨ (юу ч бичихгүй) — харагдац, хуваах цонхны өгөгдөл. */
export async function previewSeed(db: D1Database, facts: TaskFacts): Promise<SeedPlan> {
  const ev = await loadSeedEvidence(db, facts.taskId);
  return planSeed({ entries: ev.entries, credits: ev.credits, coef: facts.coef });
}

/** Seed-ээс эхний төлөв: хүн бүрийн D = слайсуудын нийлбэр, T = D, L = D; U = үлдсэн ирээдүйн ажил. */
export function stateFromSeed(plan: Extract<SeedPlan, { ok: true }>): {
  state: RootAllocState;
  /** Хүн бүрийн анхны ордгийн дараалал (дугаар олгоход). */
  order: number[];
} {
  const order: number[] = [];
  const done = new Map<number, number>();
  for (const s of plan.slices) {
    if (!done.has(s.userId)) order.push(s.userId);
    done.set(s.userId, (done.get(s.userId) ?? 0) + s.units);
  }
  const rows: AllocRow[] = order.map((userId) => {
    const d = done.get(userId) ?? 0;
    return { userId, doneUnits: d, floorUnits: d, targetUnits: d };
  });
  const attributed = rows.reduce((s, r) => s + r.doneUnits, 0);
  const unallocated = 100 * UNITS_PER_POINT - plan.unattributedUnits - attributed;
  return {
    state: { unattributedUnits: plan.unattributedUnits, unallocatedUnits: Math.max(0, unallocated), rows },
    order,
  };
}

/* ------------------------------------------------------------------ */
/*  Харагдац (API payload)                                              */
/* ------------------------------------------------------------------ */

export type ParticipantStatus = 'active' | 'history' | 'cancelled';

export interface ParticipantView {
  allocation_id: number;
  user_id: number;
  ordinal: number;
  target_units: number;
  done_units: number;
  floor_units: number;
  future_units: number;
  released_units: number;
  status: ParticipantStatus;
}

export interface PartView {
  part_id: number;
  ordinal: number;
  label: string;
  units: number;
}

export interface RootView {
  task_id: number;
  revision: number;
  managed: true;
  root_done_units: number;
  remaining_units: number;
  unattributed_units: number;
  /** U — хуваарилагдаагүй ирээдүйн ажил (хүнгүй хэсгүүдийг ОРУУЛСАН). */
  unallocated_units: number;
  /** U − Σ хэсэг — нэргүй чөлөөт ажил (▶ дарж шууд авч болох). */
  free_units: number;
  complete: boolean;
  participants: ParticipantView[];
  /** Хүнгүй хэсгүүд (0394). */
  parts: PartView[];
}

export function participantStatus(done: number, target: number): ParticipantStatus {
  if (target > done) return 'active';
  if (done > 0) return 'history';
  return 'cancelled';
}

export function rootView(snap: RootSnapshot): RootView {
  return {
    task_id: snap.root.taskId,
    revision: snap.root.revision,
    managed: true,
    root_done_units: rootDoneUnits(snap.state),
    remaining_units: rootRemainingUnits(snap.state),
    unattributed_units: snap.root.unattributedUnits,
    unallocated_units: snap.root.unallocatedUnits,
    free_units: Math.max(0, snap.root.unallocatedUnits - reservedUnitsOf(snap.parts ?? [])),
    complete: rootDoneUnits(snap.state) >= ROOT_TOTAL_UNITS,
    parts: (snap.parts ?? []).map((p) => ({ part_id: p.id, ordinal: p.ordinal, label: p.label, units: p.units })),
    participants: snap.allocations.map((a) => ({
      allocation_id: a.id,
      user_id: a.userId,
      ordinal: a.ordinal,
      target_units: a.targetUnits,
      done_units: a.doneUnits,
      floor_units: a.floorUnits,
      future_units: a.targetUnits - a.doneUnits,
      released_units: a.releasedUnits,
      status: participantStatus(a.doneUnits, a.targetUnits),
    })),
  };
}

/* ------------------------------------------------------------------ */
/*  Marker-тэй batch ажиллуулагч                                         */
/* ------------------------------------------------------------------ */

/** `EXISTS (marker)` — marker бичигдсэн (CAS таарсан) үед л statement ажиллана. */
export function markerExists(bag: ParamBag, requestId: string): string {
  return `EXISTS (SELECT 1 FROM task_ops WHERE request_id = ${bag.add(requestId)})`;
}

export type GuardedOutcome =
  | { kind: 'applied' }
  | { kind: 'replayed'; resultJson: string }
  | { kind: 'stale' };

/**
 * `statements[0]` = marker (`INSERT INTO task_ops … SELECT … WHERE <CAS>`), бусад нь `EXISTS (marker)`-ээр
 * хамгаалагдсан.  Marker changes = 0 → хуучирсан (юу ч бичигдээгүй).  Marker PRIMARY KEY мөргөлдвөл
 * (ижил request_id) batch ROLLBACK → хадгалсан үр дүнг буцаана.
 */
export async function runGuardedBatch(
  db: D1Database,
  requestId: string,
  statements: D1PreparedStatement[],
): Promise<GuardedOutcome> {
  try {
    const res = await db.batch(statements);
    if ((res[0]?.meta.changes ?? 0) === 0) return { kind: 'stale' };
    return { kind: 'applied' };
  } catch (err) {
    const stored = await db
      .prepare('SELECT result_json FROM task_ops WHERE request_id = ?')
      .bind(requestId)
      .first<{ result_json: string }>();
    if (stored) return { kind: 'replayed', resultJson: stored.result_json };
    throw err;
  }
}

/** Өмнө нь биелсэн request_id-ийн үр дүн (pre-read хурдан зам). */
export async function loadOp(
  db: D1Database,
  requestId: string,
): Promise<{
  taskId: number;
  userId: number;
  kind: string;
  resultJson: string;
  postStatus: string;
  requestHash: string | null;
} | null> {
  const row = await db
    .prepare('SELECT task_id, user_id, kind, result_json, post_status, request_hash FROM task_ops WHERE request_id = ?')
    .bind(requestId)
    .first<{
      task_id: number;
      user_id: number;
      kind: string;
      result_json: string;
      post_status: string;
      request_hash: string | null;
    }>();
  if (!row) return null;
  return {
    taskId: row.task_id,
    userId: row.user_id,
    kind: row.kind,
    resultJson: row.result_json,
    postStatus: row.post_status,
    requestHash: row.request_hash ?? null,
  };
}

/* ------------------------------------------------------------------ */
/*  Цаг                                                                 */
/* ------------------------------------------------------------------ */

/** SQLite `YYYY-MM-DD HH:MM:SS` (UTC). */
export function sqliteTs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

function parseSqliteTs(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const iso = ts.includes('T') ? ts : `${ts.replace(' ', 'T')}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Projection бичлэгийн `created_at` — таск тутамд ХАТУУ ӨСӨХ (секундын нарийвчлалтай
 * `datetime('now')` нь ижил секундэд хоёр мөр үүсгэж `ORDER BY created_at DESC LIMIT 1` уншигчид
 * хамгийн БАГА хувийг буцаадаг байв — аудит 2026-10-02).  Root revision CAS нь нэг root дээр
 * зэрэг бичигч байхгүйг баталгаажуулдаг тул JS дээр тооцоход аюулгүй.
 */
export function nextEntryTs(lastCreatedAt: string | null, nowMs: number): string {
  const last = parseSqliteTs(lastCreatedAt);
  const nowSec = Math.floor(nowMs / 1000) * 1000;
  const next = last !== null && last >= nowSec ? last + 1000 : nowSec;
  return sqliteTs(next);
}

/** Projection-ийн `date` — өнөөдрөөс ӨМНӨ биш, мөн хамгийн сүүлийн бичлэгийн огнооноос ӨМНӨ биш. */
export function projectionDate(today: string, lastDate: string | null): string {
  return lastDate && lastDate > today ? lastDate : today;
}
