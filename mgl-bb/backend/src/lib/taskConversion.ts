/**
 * ХУУЧИН ТАСКИЙН БҮЛГИЙГ ХУВААРИЛАЛТ (managed root) РУУ ХӨРВҮҮЛЭХ — D1 давхарга (2026-10-05, migration 0385).
 * Цэвэр дүрэм/төлөвлөгөө: `taskConversionPlan.ts`.
 *
 *   discoverGroups     — нэр дэвшигч бүлгүүдийг олж НОТОЛГООНЫ ТҮВШИНгээр ангилна (юу ч бичихгүй).
 *   previewConversion  — тодорхой бүлгийн БҮТЭН төлөвлөгөө + `plan_hash` (юу ч бичихгүй).
 *   applyConversion    — ЯГ тэр төлөвлөгөөг НЭГ атом batch-ээр хэрэгжүүлнэ: marker (идемпотент, CAS), журнал, root,
 *                        хуваарилалт, seed слайс, түүхийн backfill, нэгтгэгдсэн хэсгүүдийг идэвхгүйжүүлэлт.  Дахин оролдох
 *                        аюулгүй: бүгд эсвэл юу ч (restartable), ижил request_id → анхны үр дүн.
 *   revertConversion   — хөрвүүлэлтийн ДАРАА root дээр юу ч хийгдээгүй бол ЯГ эхний төлөвт буцаана (journal-аас).
 *
 * Хориглосон зүйл: шинэ оноо үүсгэхгүй, хэнд ч хийсэн хэсгийг нотолгоогүй оноохгүй, төслийн явцыг өөрчлөхгүй
 * (`ROLLUP_DRIFT` хамгаалалт), root-ийн бусад гишүүний түүх (progress_entries, user_points, таймер) УСТГАХГҮЙ.
 */
import { logTaskAlloc } from './taskAllocLog';
import { payloadHash } from './taskPostCommit';
import {
  loadOp,
  loadRoot,
  loadSeedEvidence,
  markerExists,
  runGuardedBatch,
} from './taskRootStore';
import {
  canHoldAllocation,
  fail,
  loadUsers,
  markerStmt,
  mk,
  stateJson,
  validRequestId,
  type Actor,
  type OpCtx,
  type OpResult,
} from './taskRootOps';
import {
  MAX_GROUP_MEMBERS,
  classifyGroup,
  groupByNamePattern,
  needsExplicitConfirmation,
  parseSplitName,
  planConversion,
  type Classification,
  type ConversionEvidence,
  type ConversionPlan,
  type GroupFacts,
  type MemberInput,
  type PlanFailure,
  type TimelinePoint,
} from './taskConversionPlan';
import { UNITS_PER_POINT } from './taskUnits';
import { todayInUB } from './time';

/* ------------------------------------------------------------------ */
/*  Төрлүүд                                                             */
/* ------------------------------------------------------------------ */

export interface GroupMemberView {
  task_id: number;
  name: string;
  weight: number;
  latest_pct: number;
  drawing_id: number;
  managed: boolean;
  retired: boolean;
}

export interface ConversionPreview {
  evidence: ConversionEvidence;
  classification: Classification;
  root_task_id: number;
  members: GroupMemberView[];
  /** Хөрвүүлэх боломжгүй бол null (шалтгаан `classification.blockers`). */
  plan: ConversionPlan | null;
  plan_failure: Omit<PlanFailure, 'ok'> | null;
  plan_hash: string | null;
  needs_confirmation: boolean;
}

export interface PreviewParams {
  taskIds: number[];
  rootTaskId?: number | null;
  rootName?: string | null;
  futureOwners?: Record<number, number>;
  nowMs?: number;
  today?: string;
}

export interface ConversionData {
  conversion_id: string;
  root_task_id: number;
  plan_hash: string;
  evidence: ConversionEvidence;
  classification: string;
  weight: number;
  root_done_units: number;
  root_done_pct: number;
  unattributed_units: number;
  unallocated_units: number;
  slack_units: number;
  participants: number;
  retired: number[];
  seed_attribution: string;
  rollup: ConversionPlan['rollup'];
  warnings: string[];
}

export interface ApplyParams extends PreviewParams {
  requestId: string;
  planHash: string;
  reason: string;
  /** Нотолгоо сул (`ambiguous`) бүлгийг ИЛ баталгаажуулах. */
  confirmAmbiguous?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Унших                                                               */
/* ------------------------------------------------------------------ */

async function tableExists(db: D1Database, name: string): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?").bind(name).first();
  return !!row;
}

export async function conversionReady(db: D1Database): Promise<boolean> {
  return (await tableExists(db, 'task_conversions')) && (await tableExists(db, 'task_conversion_members'));
}

async function hasGroupColumn(db: D1Database): Promise<boolean> {
  try {
    const { results } = await db.prepare('PRAGMA table_info(tasks)').all<{ name: string }>();
    return (results ?? []).some((r) => r.name === 'group_id');
  } catch {
    return false;
  }
}

interface ChainRow {
  id: number;
  name: string;
  weight_percent: number;
  sort_order: number | null;
  component_id: number;
  due_date: string | null;
  start_date: string | null;
  drawing_id: number;
  drawing_w: number | null;
  block_w: number | null;
  project_id: number;
  project_status: string | null;
  progress_mode: string | null;
  team_share: number | null;
  managed: number;
  retired: number;
  last_entry_id: number | null;
  last_points_id: number | null;
  last_created_at: string | null;
  last_date: string | null;
}

interface LoadedGroup {
  members: MemberInput[];
  facts: Omit<GroupFacts, 'evidence'> | null;
  missing: number[];
  lastCreatedAtById: Map<number, string | null>;
  lastDateById: Map<number, string | null>;
}

const inList = (n: number): string => Array.from({ length: n }, () => '?').join(',');

async function loadGroup(db: D1Database, taskIds: readonly number[], light: boolean): Promise<LoadedGroup> {
  const ids = [...new Set(taskIds)];
  const { results } = await db
    .prepare(
      `SELECT t.id, t.name, t.weight_percent, t.sort_order, t.component_id, t.due_date, t.start_date,
              c.drawing_id, d.weight_percent AS drawing_w, b.weight_percent AS block_w, b.project_id,
              p.status AS project_status, p.progress_mode,
              (SELECT s.share_percent FROM project_team_shares s
                WHERE s.project_id = b.project_id AND s.team_id = b.team_id) AS team_share,
              EXISTS (SELECT 1 FROM task_roots r WHERE r.task_id = t.id) AS managed,
              EXISTS (SELECT 1 FROM task_conversion_members m WHERE m.task_id = t.id) AS retired,
              (SELECT MAX(x.id) FROM progress_entries x WHERE x.task_id = t.id AND x.status = 'approved') AS last_entry_id,
              (SELECT MAX(u.id) FROM user_points u WHERE u.task_id = t.id AND u.source = 'progress') AS last_points_id,
              (SELECT MAX(x.created_at) FROM progress_entries x WHERE x.task_id = t.id) AS last_created_at,
              (SELECT MAX(x.date) FROM progress_entries x WHERE x.task_id = t.id AND x.status = 'approved') AS last_date
         FROM tasks t
         JOIN components c ON c.id = t.component_id
         JOIN drawings d   ON d.id = c.drawing_id
         JOIN blocks b     ON b.id = d.block_id
         JOIN projects p   ON p.id = b.project_id
        WHERE t.id IN (${inList(ids.length)})`,
    )
    .bind(...ids)
    .all<ChainRow>();
  const rows = results ?? [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const missing = ids.filter((id) => !byId.has(id));

  const members: MemberInput[] = await Promise.all(
    rows.map(async (r) => {
      const [timeline, timers, evidence] = await Promise.all([
        db
          .prepare(
            `SELECT id, date, created_at, percentage FROM progress_entries
              WHERE task_id = ? AND status = 'approved' ORDER BY date ASC, created_at ASC, id ASC`,
          )
          .bind(r.id)
          .all<{ id: number; date: string; created_at: string; percentage: number }>(),
        db
          .prepare('SELECT user_id FROM task_timer_sessions WHERE task_id = ? AND ended_at IS NULL')
          .bind(r.id)
          .all<{ user_id: number }>(),
        light ? Promise.resolve(null) : loadSeedEvidence(db, r.id),
      ]);
      const points: TimelinePoint[] = (timeline.results ?? []).map((e) => ({
        id: e.id,
        date: e.date,
        createdAt: e.created_at,
        units: Math.round((Number(e.percentage) || 0) * UNITS_PER_POINT),
      }));
      // Light горимд (нэр дэвшигч жагсаалт) seed-ийн бүрэн нотолгоо хэрэггүй — сүүлийн хувь л.
      const entries =
        evidence?.entries ??
        (points.length > 0
          ? [{ id: points[points.length - 1]!.id, userId: 0, creditUserId: null, isBaseline: false, source: null, units: points[points.length - 1]!.units }]
          : []);
      return {
        taskId: r.id,
        name: r.name,
        weight: Number(r.weight_percent) || 0,
        sortOrder: Number(r.sort_order) || 0,
        componentId: r.component_id,
        drawingId: r.drawing_id,
        dueDate: r.due_date,
        startDate: r.start_date,
        lastEntryId: Number(r.last_entry_id) || 0,
        lastPointsId: Number(r.last_points_id) || 0,
        entries,
        credits: evidence?.credits ?? [],
        timeline: points,
        runningTimerUsers: (timers.results ?? []).map((t) => t.user_id),
        managed: r.managed === 1,
        retired: r.retired === 1,
      } satisfies MemberInput;
    }),
  );
  const first = rows[0];
  return {
    members,
    facts: first
      ? {
          projectId: first.project_id,
          projectStatus: first.project_status,
          progressMode: first.progress_mode,
          drawingWeight: Number(first.drawing_w) || 0,
          blockWeight: Number(first.block_w) || 0,
          teamShare: Number(first.team_share) || 0,
        }
      : null,
    missing,
    lastCreatedAtById: new Map(rows.map((r) => [r.id, r.last_created_at])),
    lastDateById: new Map(rows.map((r) => [r.id, r.last_date])),
  };
}

/** Нотолгооны төрлийг СЕРВЕР тодорхойлно (клиент өөрөө «declared» гэж зарлаж чадахгүй). */
async function evidenceOf(db: D1Database, members: readonly MemberInput[]): Promise<ConversionEvidence> {
  if (await hasGroupColumn(db)) {
    const ids = members.map((m) => m.taskId);
    const { results } = await db
      .prepare(`SELECT id, group_id FROM tasks WHERE id IN (${inList(ids.length)})`)
      .bind(...ids)
      .all<{ id: number; group_id: number | null }>();
    const groups = new Set((results ?? []).map((r) => r.group_id));
    const gid = groups.size === 1 ? [...groups][0] : null;
    if (gid !== null && gid !== undefined) {
      const all = await db.prepare('SELECT id FROM tasks WHERE group_id = ?').bind(gid).all<{ id: number }>();
      const set = new Set((all.results ?? []).map((r) => r.id));
      if (set.size === ids.length && ids.every((i) => set.has(i))) return 'declared_group';
    }
  }
  const named = groupByNamePattern(
    members.map((m) => ({ id: m.taskId, drawingId: m.drawingId, componentId: m.componentId, name: m.name, sortOrder: m.sortOrder })),
  );
  if (named.length === 1 && named[0]!.taskIds.length === members.length) return 'name_pattern';
  return 'manual';
}

function defaultRoot(members: readonly MemberInput[], evidence: ConversionEvidence): number {
  const sorted = [...members].sort((a, b) => a.sortOrder - b.sortOrder || a.taskId - b.taskId);
  if (evidence === 'name_pattern') {
    const first = [...members].sort((a, b) => (parseSplitName(a.name)?.index ?? 99) - (parseSplitName(b.name)?.index ?? 99))[0];
    if (first) return first.taskId;
  }
  return sorted[0]!.taskId;
}

const viewOf = (m: MemberInput): GroupMemberView => ({
  task_id: m.taskId,
  name: m.name,
  weight: m.weight,
  latest_pct: m.entries.length > 0 ? m.entries[m.entries.length - 1]!.units / UNITS_PER_POINT : 0,
  drawing_id: m.drawingId,
  managed: m.managed,
  retired: m.retired,
});

/* ------------------------------------------------------------------ */
/*  Төлөвлөгөөний хурууны хээ                                            */
/* ------------------------------------------------------------------ */

async function hashPlan(plan: ConversionPlan, members: readonly MemberInput[]): Promise<string> {
  const byId = new Map(members.map((m) => [m.taskId, m]));
  return payloadHash('convert', {
    root: plan.rootTaskId,
    rootName: plan.rootNameAfter,
    weight: plan.weight,
    members: plan.members.map((m) => [m.taskId, m.weightBefore, m.targetUnits, m.doneUnits, m.futureOwner, byId.get(m.taskId)?.lastEntryId ?? 0, byId.get(m.taskId)?.lastPointsId ?? 0]),
    allocations: plan.allocations.map((a) => [a.userId, a.ordinal, a.doneUnits, a.floorUnits, a.targetUnits]),
    b: plan.unattributedUnits,
    u: plan.unallocatedUnits,
    slack: plan.slackUnits,
    slices: plan.slices.map((s) => [s.memberTaskId, s.userId, s.units, s.pointsId]),
    backfill: plan.backfill.map((r) => [r.date, r.units]),
    projection: plan.projection?.units ?? null,
  });
}

/* ------------------------------------------------------------------ */
/*  Preview                                                             */
/* ------------------------------------------------------------------ */

export async function previewConversion(db: D1Database, p: PreviewParams): Promise<OpResult<ConversionPreview>> {
  return (await previewCore(db, p)).result;
}

/**
 * Preview-ийн цөм — `loaded` нь төлөвлөгөө ЗАДАРСАН ЯГ ТЭР унших.  Apply-ийн guard (хамгийн сүүлийн явц/оноо/таймер) энэ
 * `loaded`-оос л авагдана: төлөвлөгөө болон hash-ийн дараа ДАХИН уншвал завсарт орсон бичилт guard-аас гулсаж, тооцоонд ороогүй
 * явц чимээгүй алдагддаг байв (TOCTOU).
 */
async function previewCore(db: D1Database, p: PreviewParams): Promise<{ result: OpResult<ConversionPreview>; loaded: LoadedGroup | null }> {
  const R = (result: OpResult<ConversionPreview>, loaded: LoadedGroup | null = null) => ({ result, loaded });
  const ids = [...new Set(p.taskIds)];
  if (ids.length < 2 || ids.some((i) => !Number.isInteger(i) || i <= 0)) return R(fail(400, 'BAD_GROUP', 'Дор хаяж 2 таск (task_ids) шаардлагатай'));
  if (ids.length > MAX_GROUP_MEMBERS) return R(fail(400, 'BAD_GROUP', `Бүлэг хамгийн ихдээ ${MAX_GROUP_MEMBERS} таск`));
  if (!(await conversionReady(db))) return R(fail(409, 'MIGRATION_PENDING', 'Хөрвүүлэлтийн хүснэгт (0385) хараахан хэрэгжээгүй'));
  if (p.rootName != null && (typeof p.rootName !== 'string' || p.rootName.trim().length > 200)) return R(fail(400, 'BAD_ROOT_NAME', 'Root-ийн нэр 200 тэмдэгтээс хэтрэхгүй'));

  const loaded = await loadGroup(db, ids, false);
  if (loaded.missing.length > 0) return R(fail(404, 'TASK_NOT_FOUND', 'Зарим таск олдсонгүй', { missing: loaded.missing }));
  if (!loaded.facts) return R(fail(404, 'TASK_NOT_FOUND', 'Таск олдсонгүй'));
  const evidence = await evidenceOf(db, loaded.members);
  const facts: GroupFacts = { ...loaded.facts, evidence };
  const classification = classifyGroup(loaded.members, facts);
  const rootTaskId = p.rootTaskId ?? defaultRoot(loaded.members, evidence);
  if (!loaded.members.some((m) => m.taskId === rootTaskId)) return R(fail(400, 'ROOT_NOT_IN_GROUP', 'Root таск бүлгийн гишүүн биш'));

  const futureOwners = p.futureOwners ?? {};
  for (const [taskId, userId] of Object.entries(futureOwners)) {
    if (!ids.includes(Number(taskId))) return R(fail(400, 'BAD_OWNER', 'Ирээдүйн ажлын эзэн бүлгийн таскт хамаарахгүй', { task_id: Number(taskId) }));
    if (!Number.isInteger(userId) || userId <= 0) return R(fail(400, 'BAD_OWNER', 'Хэрэглэгч буруу'));
  }
  const users = await loadUsers(db, [...new Set(Object.values(futureOwners))]);
  for (const userId of Object.values(futureOwners)) {
    if (!canHoldAllocation(users.get(userId), userId)) {
      return R(fail(400, 'USER_NOT_ELIGIBLE', 'Энэ хүн таск дээр ажиллах эрхгүй эсвэл идэвхгүй байна', { user_id: userId }));
    }
  }

  const base = {
    evidence,
    classification,
    root_task_id: rootTaskId,
    members: loaded.members.map(viewOf),
    needs_confirmation: needsExplicitConfirmation(classification),
  };
  const planned = planConversion({
    members: loaded.members,
    facts,
    rootTaskId,
    rootName: p.rootName ?? null,
    futureOwners,
    nowMs: p.nowMs ?? Date.now(),
    today: p.today ?? todayInUB(),
    lastRootCreatedAt: loaded.lastCreatedAtById.get(rootTaskId) ?? null,
  });
  if (!planned.ok) {
    return R(
      {
        ok: true,
        data: { ...base, plan: null, plan_failure: { code: planned.code, message: planned.message, details: planned.details }, plan_hash: null },
      },
      loaded,
    );
  }
  return R({ ok: true, data: { ...base, plan: planned, plan_failure: null, plan_hash: await hashPlan(planned, loaded.members) } }, loaded);
}

/* ------------------------------------------------------------------ */
/*  Apply                                                               */
/* ------------------------------------------------------------------ */

const REASON_MIN = 3;
const REASON_MAX = 200;

function summarize(conversionId: string, planHash: string, plan: ConversionPlan, ev: ConversionEvidence, cls: Classification): ConversionData {
  return {
    conversion_id: conversionId,
    root_task_id: plan.rootTaskId,
    plan_hash: planHash,
    evidence: ev,
    classification: cls.classification,
    weight: plan.weight,
    root_done_units: plan.rootDoneUnits,
    root_done_pct: plan.rootDoneUnits / UNITS_PER_POINT,
    unattributed_units: plan.unattributedUnits,
    unallocated_units: plan.unallocatedUnits,
    slack_units: plan.slackUnits,
    participants: plan.allocations.length,
    retired: plan.members.filter((m) => m.role === 'retired').map((m) => m.taskId),
    seed_attribution: plan.seedAttribution,
    rollup: plan.rollup,
    warnings: plan.warnings,
  };
}

export async function applyConversion(ctx: OpCtx, actor: Actor, p: ApplyParams): Promise<OpResult<ConversionData>> {
  const { db } = ctx;
  if (actor.role !== 'admin') return fail(403, 'ADMIN_ONLY', 'Хөрвүүлэлтийг зөвхөн админ хийнэ');
  if (!validRequestId(p.requestId)) return fail(400, 'BAD_REQUEST_ID', 'request_id буруу');
  if (typeof p.planHash !== 'string' || p.planHash.length < 16) return fail(400, 'BAD_PLAN_HASH', 'plan_hash шаардлагатай — эхлээд preview хийнэ үү');
  const reason = typeof p.reason === 'string' ? p.reason.trim() : '';
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) {
    return fail(400, 'REASON_REQUIRED', `Шалтгаан ${REASON_MIN}–${REASON_MAX} тэмдэгт байх ёстой`);
  }

  // Replay: өмнө биелсэн request_id (нэгтгэсний дараа бүлэг аль хэдийн managed тул preview-ээс ӨМНӨ).
  const prior = await loadOp(db, p.requestId);
  if (prior) {
    if (prior.kind !== 'convert' || prior.requestHash !== p.planHash) {
      return fail(409, 'REQUEST_REUSED', 'Энэ request_id өөр хөрвүүлэлтэд ашиглагдсан');
    }
    const row = await db.prepare('SELECT status FROM task_conversions WHERE id = ?').bind(p.requestId).first<{ status: string }>();
    if (row?.status === 'reverted') return fail(409, 'CONVERSION_REVERTED', 'Энэ хөрвүүлэлт буцаагдсан — шинэ request_id-аар дахин preview хийнэ үү');
    return { ok: true, data: JSON.parse(prior.resultJson) as ConversionData, replayed: true };
  }

  const core = await previewCore(db, { ...p, nowMs: ctx.nowMs, today: ctx.today });
  const preview = core.result;
  if (!preview.ok) return preview;
  const pv = preview.data;
  if (!pv.classification.convertible || !pv.plan || !pv.plan_hash) {
    return fail(409, pv.plan_failure?.code ?? pv.classification.blockers[0] ?? 'NOT_CONVERTIBLE', 'Бүлгийг одоо хөрвүүлэх боломжгүй', {
      classification: pv.classification,
      plan_failure: pv.plan_failure,
    });
  }
  if (pv.plan_hash !== p.planHash) {
    return fail(409, 'PLAN_STALE', 'Бүлгийн төлөв preview-ээс хойш өөрчлөгдсөн — дахин preview хийж шалгана уу', {
      plan_hash: pv.plan_hash,
    });
  }
  if (needsExplicitConfirmation(pv.classification) && p.confirmAmbiguous !== true) {
    return fail(409, 'CONFIRMATION_REQUIRED', 'Нотолгоо сул (нэрийн хэв маяг/гараар сонгосон) — confirm_ambiguous: true-аар ИЛ баталгаажуулна уу', {
      evidence: pv.evidence,
    });
  }
  const plan = pv.plan;
  const rid = p.requestId;
  const nowMs = ctx.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  // ⚠️ Guard-ын утга (хамгийн сүүлийн явц/оноо id) ТӨЛӨВЛӨГӨӨ ЗАДАРСАН ЯГ ТЭР унших — дахин уншихгүй (TOCTOU).
  const loaded = core.loaded!;
  const lastById = new Map(loaded.members.map((m) => [m.taskId, m]));
  const rootPre = await db
    .prepare("SELECT COALESCE(MAX(id), 0) AS m FROM progress_entries WHERE task_id = ?")
    .bind(plan.rootTaskId)
    .first<{ m: number }>();

  const data = summarize(rid, p.planHash, plan, pv.evidence, pv.classification);
  const stored = {
    plan,
    pre: {
      rootMaxEntryId: Number(rootPre?.m) || 0,
      members: plan.members.map((m) => ({
        task_id: m.taskId,
        last_entry_id: lastById.get(m.taskId)?.lastEntryId ?? 0,
        last_points_id: lastById.get(m.taskId)?.lastPointsId ?? 0,
      })),
    },
  };
  const noteTag = `[Хөрвүүлэлт ${rid}]`;

  const stmts: D1PreparedStatement[] = [
    markerStmt(db, {
      requestId: rid,
      taskId: plan.rootTaskId,
      userId: actor.sub,
      kind: 'convert',
      requestHash: p.planHash,
      revBefore: 0,
      revAfter: 1,
      beforeJson: JSON.stringify({ members: plan.members.map((m) => ({ task_id: m.taskId, name: m.name, weight: m.weightBefore, latest_pct: m.latestPct })) }),
      afterJson: stateJson(plan.state),
      resultJson: JSON.stringify(data),
      guard: (b) => {
        const parts: string[] = [
          `EXISTS (SELECT 1 FROM projects p WHERE p.id = ${b.add(loaded.facts?.projectId ?? 0)} AND p.status = 'active')`,
        ];
        for (const m of plan.members) {
          const a = b.add(m.taskId);
          const last = lastById.get(m.taskId);
          parts.push(
            `EXISTS (SELECT 1 FROM tasks t WHERE t.id = ${a} AND t.weight_percent = ${b.add(m.weightBefore)})`,
            `NOT EXISTS (SELECT 1 FROM task_roots r WHERE r.task_id = ${a})`,
            `NOT EXISTS (SELECT 1 FROM task_conversion_members cm WHERE cm.task_id = ${a})`,
            `COALESCE((SELECT MAX(x.id) FROM progress_entries x WHERE x.task_id = ${a} AND x.status = 'approved'), 0) = ${b.add(last?.lastEntryId ?? 0)}`,
            `COALESCE((SELECT MAX(u.id) FROM user_points u WHERE u.task_id = ${a} AND u.source = 'progress'), 0) = ${b.add(last?.lastPointsId ?? 0)}`,
            `NOT EXISTS (SELECT 1 FROM task_timer_sessions s WHERE s.task_id = ${a} AND s.ended_at IS NULL)`,
          );
        }
        return parts.join('\n AND ');
      },
    }),
    // Root: жин = бүлгийн нийлбэр, нэр = суурь нэр.
    mk(
      db,
      (b) => `UPDATE tasks SET weight_percent = ${b.add(plan.weight)}, name = ${b.add(plan.rootNameAfter)}
               WHERE id = ${b.add(plan.rootTaskId)} AND ${markerExists(b, rid)}`,
    ),
  ];
  for (const m of plan.members) {
    if (m.role !== 'retired') continue;
    stmts.push(
      mk(
        db,
        (b) => `UPDATE tasks SET weight_percent = 0, due_date = NULL, start_date = NULL
                 WHERE id = ${b.add(m.taskId)} AND ${markerExists(b, rid)}`,
      ),
    );
  }
  stmts.push(
    mk(
      db,
      (b) => `INSERT INTO task_roots
                (task_id, revision, unattributed_units, unallocated_units, slack_units, next_ordinal,
                 seed_attribution, seed_json, created_by)
              SELECT ${b.add(plan.rootTaskId)}, 1, ${b.add(plan.unattributedUnits)}, ${b.add(plan.unallocatedUnits)},
                     ${b.add(plan.slackUnits)}, ${b.add(plan.allocations.length + 1)}, ${b.add(plan.seedAttribution)},
                     ${b.add(JSON.stringify({ conversion_id: rid, evidence: pv.evidence, members: plan.members.map((m) => m.taskId), slices: plan.slices.length }))},
                     ${b.add(actor.sub)}
               WHERE ${markerExists(b, rid)}`,
    ),
  );
  for (const a of plan.allocations) {
    stmts.push(
      mk(
        db,
        (b) => `INSERT INTO task_allocations (task_id, user_id, ordinal, target_units, done_units, floor_units, released_units)
                SELECT ${b.add(plan.rootTaskId)}, ${b.add(a.userId)}, ${b.add(a.ordinal)}, ${b.add(a.targetUnits)},
                       ${b.add(a.doneUnits)}, ${b.add(a.floorUnits)}, 0
                 WHERE ${markerExists(b, rid)}`,
      ),
    );
  }
  plan.slices.forEach((s, i) => {
    stmts.push(
      mk(
        db,
        (b) => `INSERT INTO task_contributions
                  (task_id, allocation_id, user_id, actor_id, kind, units, units_open, free_open,
                   credit_amount, credit_delta_pct, credit_open_amount, credit_open_delta_pct,
                   points_id, progress_entry_id, work_date, awarded_at, recorded_at, request_id, seq, root_revision, note)
                SELECT ${b.add(plan.rootTaskId)},
                       (SELECT a.id FROM task_allocations a WHERE a.task_id = ${b.add(plan.rootTaskId)} AND a.user_id = ${b.add(s.userId)}),
                       ${b.add(s.userId)}, ${b.add(actor.sub)}, 'seed', ${b.add(s.units)}, ${b.add(s.units)}, 0,
                       ${b.add(s.amount)}, ${b.add(s.deltaPct)}, ${b.add(s.amount)}, ${b.add(s.deltaPct)},
                       ${b.add(s.pointsId)}, ${b.add(s.progressEntryId)}, ${b.add(s.awardedAt.slice(0, 10))},
                       ${b.add(s.awardedAt)}, ${b.add(nowIso)}, ${b.add(rid)}, ${b.add(i)}, 1,
                       ${b.add(`conversion seed (task ${s.memberTaskId})`)}
                 WHERE ${markerExists(b, rid)}`,
      ),
    );
  });
  // Түүхийн backfill (огноо бүрд бүлгийн жигнэсэн явц) + одоогийн projection — `alloc_adj` (ажлын үйл явдал БИШ).
  const projectionRow = (units: number, date: string, createdAt: string, note: string): D1PreparedStatement =>
    mk(
      db,
      (b) => `INSERT INTO progress_entries
                (task_id, user_id, percentage, date, notes, status, reviewed_by, reviewed_at,
                 is_rest_day, defer_next_day, source, created_at)
              SELECT ${b.add(plan.rootTaskId)}, ${b.add(actor.sub)}, ${b.add(units / UNITS_PER_POINT)}, ${b.add(date)},
                     ${b.add(`${noteTag} ${note}`)}, 'approved', ${b.add(actor.sub)}, ${b.add(nowIso)},
                     0, 0, 'alloc_adj', ${b.add(createdAt)}
               WHERE ${markerExists(b, rid)}`,
    );
  for (const r of plan.backfill) stmts.push(projectionRow(r.units, r.date, r.createdAt, 'түүхийн проекц'));
  if (plan.projection) stmts.push(projectionRow(plan.projection.units, plan.projection.date, plan.projection.createdAt, 'одоогийн явц'));

  stmts.push(
    mk(
      db,
      (b) => `INSERT INTO task_conversions
                (id, root_task_id, project_id, drawing_id, status, evidence, classification, plan_hash, reason, actor_id,
                 plan_json, rollup_before, rollup_after)
              SELECT ${b.add(rid)}, ${b.add(plan.rootTaskId)}, ${b.add(loaded.facts?.projectId ?? 0)},
                     ${b.add(loaded.members[0]?.drawingId ?? 0)}, 'applied', ${b.add(pv.evidence)},
                     ${b.add(pv.classification.classification)}, ${b.add(p.planHash)}, ${b.add(reason)}, ${b.add(actor.sub)},
                     ${b.add(JSON.stringify(stored))}, ${b.add(plan.rollup.before)}, ${b.add(plan.rollup.after)}
               WHERE ${markerExists(b, rid)}`,
    ),
  );
  for (const m of plan.members) {
    stmts.push(
      mk(
        db,
        (b) => `INSERT INTO task_conversion_members
                  (task_id, conversion_id, role, name_before, weight_before, weight_after, due_date_before,
                   start_date_before, latest_pct)
                SELECT ${b.add(m.taskId)}, ${b.add(rid)}, ${b.add(m.role)}, ${b.add(m.name)}, ${b.add(m.weightBefore)},
                       ${b.add(m.weightAfter)}, ${b.add(m.dueDateBefore)}, ${b.add(m.startDateBefore)}, ${b.add(m.latestPct)}
                 WHERE ${markerExists(b, rid)}`,
      ),
    );
  }

  const outcome = await runGuardedBatch(db, rid, stmts);
  if (outcome.kind === 'replayed') return { ok: true, data: JSON.parse(outcome.resultJson) as ConversionData, replayed: true };
  if (outcome.kind === 'stale') {
    return fail(409, 'PLAN_STALE', 'Бүлгийн төлөв хөрвүүлэлтийн явцад өөрчлөгдсөн (таймер, шинэ явц, оноо) — юу ч бичигдсэнгүй, дахин preview хийнэ үү');
  }
  logTaskAlloc({
    evt: 'conversion',
    op: 'convert',
    task_id: plan.rootTaskId,
    project_id: loaded.facts?.projectId ?? null,
    actor_id: actor.sub,
    request_id: rid,
    conversion_id: rid,
    result: 'ok',
    count: plan.members.length,
  });
  return { ok: true, data };
}

/* ------------------------------------------------------------------ */
/*  Revert                                                              */
/* ------------------------------------------------------------------ */

export interface RevertParams {
  conversionId: string;
  requestId: string;
  reason: string;
}

export interface RevertData {
  conversion_id: string;
  root_task_id: number;
  restored: number[];
}

interface StoredConversion {
  plan: ConversionPlan;
  pre: { rootMaxEntryId: number; members: Array<{ task_id: number; last_entry_id: number; last_points_id: number }> };
}

/** Хадгалсан төлөвлөгөөнөөс root-ийн хөрвүүлэлтийн дараах нэр. */
const plan_rootNameAfter = (stored: StoredConversion): string => stored.plan.rootNameAfter;

export async function revertConversion(ctx: OpCtx, actor: Actor, p: RevertParams): Promise<OpResult<RevertData>> {
  const { db } = ctx;
  if (actor.role !== 'admin') return fail(403, 'ADMIN_ONLY', 'Хөрвүүлэлтийг зөвхөн админ буцаана');
  if (!validRequestId(p.requestId)) return fail(400, 'BAD_REQUEST_ID', 'request_id буруу');
  const reason = typeof p.reason === 'string' ? p.reason.trim() : '';
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) return fail(400, 'REASON_REQUIRED', `Шалтгаан ${REASON_MIN}–${REASON_MAX} тэмдэгт байх ёстой`);
  if (!(await conversionReady(db))) return fail(409, 'MIGRATION_PENDING', 'Хөрвүүлэлтийн хүснэгт (0385) хараахан хэрэгжээгүй');

  const prior = await loadOp(db, p.requestId);
  if (prior) {
    // request_hash = буцаасан хөрвүүлэлтийн id — ижил request_id ӨӨР хөрвүүлэлтэд дахин ашиглагдвал анхны үр дүнг буцаахгүй.
    if (prior.kind !== 'convert_revert' || prior.requestHash !== p.conversionId) return fail(409, 'REQUEST_REUSED', 'Энэ request_id өөр үйлдэлд ашиглагдсан');
    return { ok: true, data: JSON.parse(prior.resultJson) as RevertData, replayed: true };
  }

  const conv = await db
    .prepare('SELECT id, root_task_id, status, plan_json, created_at FROM task_conversions WHERE id = ?')
    .bind(p.conversionId)
    .first<{ id: string; root_task_id: number; status: string; plan_json: string; created_at: string }>();
  if (!conv) return fail(404, 'CONVERSION_NOT_FOUND', 'Хөрвүүлэлт олдсонгүй');
  if (conv.status !== 'applied') return fail(409, 'ALREADY_REVERTED', 'Энэ хөрвүүлэлт аль хэдийн буцаагдсан');
  const stored = JSON.parse(conv.plan_json) as StoredConversion;
  const root = conv.root_task_id;

  // Аюулгүй эсэх: root дээр хөрвүүлэлтийн дараа ЮУ Ч хийгдээгүй.
  const reasons: string[] = [];
  const snap = await loadRoot(db, root);
  if (!snap) reasons.push('ROOT_MISSING');
  else if (snap.root.revision !== 1) reasons.push('ROOT_CHANGED');
  const [ops, work, entries, sessions, rootEntryMax] = await Promise.all([
    // Өмнөх хөрвүүлэлт/буцаалтын marker (convert, convert_revert) нь root-ийн ӨМНӨХ мөчлөгийн түүх — хөрвүүлэлтийн ДАРААХ үйлдэл БИШ.
    // Эс бөгөөс convert → revert → convert → revert хоёр дахь буцаалт үргэлж OPS_AFTER_CONVERSION болно.
    db
      .prepare("SELECT COUNT(*) AS n FROM task_ops WHERE task_id = ? AND request_id <> ? AND kind NOT IN ('convert', 'convert_revert')")
      .bind(root, conv.id)
      .first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM task_contributions WHERE task_id = ? AND kind <> 'seed'").bind(root).first<{ n: number }>(),
    db
      .prepare("SELECT COUNT(*) AS n FROM progress_entries WHERE task_id = ? AND id > ? AND substr(COALESCE(notes, ''), 1, ?) <> ?")
      .bind(root, stored.pre.rootMaxEntryId, `[Хөрвүүлэлт ${conv.id}]`.length, `[Хөрвүүлэлт ${conv.id}]`)
      .first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM task_timer_sessions WHERE task_id = ? AND started_at >= ?').bind(root, conv.created_at.replace(' ', 'T')).first<{ n: number }>(),
    db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM progress_entries WHERE task_id = ?').bind(root).first<{ m: number }>(),
  ]);
  if ((ops?.n ?? 0) > 0) reasons.push('OPS_AFTER_CONVERSION');
  if ((work?.n ?? 0) > 0) reasons.push('WORK_AFTER_CONVERSION');
  if ((entries?.n ?? 0) > 0) reasons.push('ENTRIES_AFTER_CONVERSION');
  if ((sessions?.n ?? 0) > 0) reasons.push('TIMER_AFTER_CONVERSION');
  for (const m of stored.plan.members) {
    const row = await db
      .prepare(
        `SELECT t.weight_percent AS w, t.name AS name, t.due_date AS due, t.start_date AS start,
                cm.due_date_before AS due_before, cm.start_date_before AS start_before, cm.name_before AS name_before,
                COALESCE((SELECT MAX(x.id) FROM progress_entries x WHERE x.task_id = t.id AND x.status = 'approved'), 0) AS e,
                COALESCE((SELECT MAX(u.id) FROM user_points u WHERE u.task_id = t.id AND u.source = 'progress'), 0) AS pt
           FROM tasks t LEFT JOIN task_conversion_members cm ON cm.task_id = t.id AND cm.conversion_id = ?
          WHERE t.id = ?`,
      )
      .bind(conv.id, m.taskId)
      .first<{
        w: number;
        name: string;
        due: string | null;
        start: string | null;
        due_before: string | null;
        start_before: string | null;
        name_before: string | null;
        e: number;
        pt: number;
      }>();
    if (!row) {
      reasons.push(`MEMBER_MISSING:${m.taskId}`);
      continue;
    }
    if (Math.abs(row.w - m.weightAfter) > 1e-9) reasons.push(`WEIGHT_EDITED:${m.taskId}`);
    // Нэр/хугацаа: хөрвүүлэлтийн ДАРАА засагдсан бол буцаалт тэр засварыг ДАРЖ бичнэ — зөвхөн хөрвүүлэлтийн үлдээсэн төлөвтэй тэнцүү үед буцаана.
    const expectedName = m.role === 'root' ? plan_rootNameAfter(stored) : row.name_before;
    if (expectedName !== null && row.name !== expectedName) reasons.push(`NAME_EDITED:${m.taskId}`);
    const expectedDue = m.role === 'root' ? row.due_before : null;
    const expectedStart = m.role === 'root' ? row.start_before : null;
    if (row.due !== expectedDue || row.start !== expectedStart) reasons.push(`DATES_EDITED:${m.taskId}`);
    const pre = stored.pre.members.find((x) => x.task_id === m.taskId);
    // Root-ийн өөрийнх нь бичлэг хөрвүүлэлтээр нэмэгдсэн (backfill) — зөвхөн нэгтгэгдсэн хэсгийг шалгана.
    if (m.role === 'retired' && pre && (row.e !== pre.last_entry_id || row.pt !== pre.last_points_id)) reasons.push(`MEMBER_CHANGED:${m.taskId}`);
  }
  if (reasons.length > 0) {
    return fail(409, 'REVERT_UNSAFE', 'Хөрвүүлэлтийн дараа root дээр өөрчлөлт орсон — буцаах боломжгүй (paused горимоор хамгаалж, гараар шийднэ)', { reasons });
  }

  const rid = p.requestId;
  const nowIso = new Date(ctx.nowMs ?? Date.now()).toISOString();
  const data: RevertData = { conversion_id: conv.id, root_task_id: root, restored: stored.plan.members.map((m) => m.taskId) };
  const noteTag = `[Хөрвүүлэлт ${conv.id}]`;
  const stmts: D1PreparedStatement[] = [
    markerStmt(db, {
      requestId: rid,
      taskId: root,
      userId: actor.sub,
      kind: 'convert_revert',
      requestHash: conv.id,
      revBefore: 1,
      revAfter: 0,
      beforeJson: JSON.stringify({ conversion_id: conv.id }),
      afterJson: '{}',
      resultJson: JSON.stringify(data),
      guard: (b) =>
        `EXISTS (SELECT 1 FROM task_conversions c WHERE c.id = ${b.add(conv.id)} AND c.status = 'applied')
         AND EXISTS (SELECT 1 FROM task_roots r WHERE r.task_id = ${b.add(root)} AND r.revision = 1)
         AND NOT EXISTS (SELECT 1 FROM task_ops o WHERE o.task_id = ${b.add(root)} AND o.request_id <> ${b.add(conv.id)} AND o.request_id <> ${b.add(rid)} AND o.kind NOT IN ('convert', 'convert_revert'))
         AND NOT EXISTS (SELECT 1 FROM task_contributions k WHERE k.task_id = ${b.add(root)} AND k.kind <> 'seed')
         AND COALESCE((SELECT MAX(x.id) FROM progress_entries x WHERE x.task_id = ${b.add(root)}), 0) = ${b.add(Number(rootEntryMax?.m) || 0)}`,
    }),
    mk(
      db,
      (b) => `UPDATE tasks
                 SET weight_percent = (SELECT m.weight_before FROM task_conversion_members m WHERE m.task_id = tasks.id),
                     name = (SELECT m.name_before FROM task_conversion_members m WHERE m.task_id = tasks.id),
                     due_date = (SELECT m.due_date_before FROM task_conversion_members m WHERE m.task_id = tasks.id),
                     start_date = (SELECT m.start_date_before FROM task_conversion_members m WHERE m.task_id = tasks.id)
               WHERE id IN (SELECT m.task_id FROM task_conversion_members m WHERE m.conversion_id = ${b.add(conv.id)})
                 AND ${markerExists(b, rid)}`,
    ),
    mk(db, (b) => `DELETE FROM task_contributions WHERE task_id = ${b.add(root)} AND ${markerExists(b, rid)}`),
    mk(db, (b) => `DELETE FROM task_allocations WHERE task_id = ${b.add(root)} AND ${markerExists(b, rid)}`),
    mk(db, (b) => `DELETE FROM task_parts WHERE task_id = ${b.add(root)} AND ${markerExists(b, rid)}`),
    mk(db, (b) => `DELETE FROM task_credit_adjustments WHERE task_id = ${b.add(root)} AND ${markerExists(b, rid)}`),
    mk(db, (b) => `DELETE FROM task_roots WHERE task_id = ${b.add(root)} AND ${markerExists(b, rid)}`),
    mk(
      db,
      (b) => `DELETE FROM progress_entries
               WHERE task_id = ${b.add(root)} AND substr(COALESCE(notes, ''), 1, ${b.add(noteTag.length)}) = ${b.add(noteTag)}
                 AND ${markerExists(b, rid)}`,
    ),
    mk(db, (b) => `DELETE FROM task_conversion_members WHERE conversion_id = ${b.add(conv.id)} AND ${markerExists(b, rid)}`),
    mk(
      db,
      (b) => `UPDATE task_conversions SET status = 'reverted', reverted_at = ${b.add(nowIso)}, reverted_by = ${b.add(actor.sub)}
               WHERE id = ${b.add(conv.id)} AND ${markerExists(b, rid)}`,
    ),
  ];
  const outcome = await runGuardedBatch(db, rid, stmts);
  if (outcome.kind === 'replayed') return { ok: true, data: JSON.parse(outcome.resultJson) as RevertData, replayed: true };
  if (outcome.kind === 'stale') return fail(409, 'REVERT_UNSAFE', 'Хөрвүүлэлтийн дараа root дээр өөрчлөлт орсон — буцаах боломжгүй', { reasons: ['CHANGED_DURING_REVERT'] });
  logTaskAlloc({
    evt: 'conversion',
    op: 'revert',
    task_id: root,
    actor_id: actor.sub,
    request_id: rid,
    conversion_id: conv.id,
    result: 'ok',
    count: data.restored.length,
  });
  return { ok: true, data };
}

/* ------------------------------------------------------------------ */
/*  Нэр дэвшигч бүлгүүд + журнал                                          */
/* ------------------------------------------------------------------ */

export interface CandidateGroup {
  key: string;
  evidence: ConversionEvidence;
  task_ids: number[];
  project_id: number | null;
  classification: Classification;
  members: GroupMemberView[];
  suggested_root_task_id: number;
}

export interface DiscoverResult {
  groups: CandidateGroup[];
  counts: Record<string, number>;
  truncated: boolean;
  declared_groups_supported: boolean;
}

export async function discoverGroups(
  db: D1Database,
  opts: { projectId?: number | null; limit?: number; includeManaged?: boolean } = {},
): Promise<DiscoverResult> {
  const limit = Math.max(1, Math.min(200, opts.limit ?? 50));
  const projectFilter = opts.projectId ? 'AND b.project_id = ?' : '';
  const binds = opts.projectId ? [opts.projectId] : [];
  const candidates: Array<{ key: string; evidence: ConversionEvidence; ids: number[] }> = [];

  const declaredSupported = await hasGroupColumn(db);
  const declaredIds = new Set<number>();
  if (declaredSupported) {
    const { results } = await db
      .prepare(
        `SELECT t.group_id AS gid, GROUP_CONCAT(t.id) AS ids
           FROM tasks t JOIN components c ON c.id = t.component_id JOIN drawings d ON d.id = c.drawing_id JOIN blocks b ON b.id = d.block_id
          WHERE t.group_id IS NOT NULL ${projectFilter}
          GROUP BY t.group_id HAVING COUNT(*) >= 2 ORDER BY t.group_id`,
      )
      .bind(...binds)
      .all<{ gid: number; ids: string }>();
    for (const r of results ?? []) {
      const ids = r.ids.split(',').map(Number).filter((n) => Number.isInteger(n));
      ids.forEach((i) => declaredIds.add(i));
      candidates.push({ key: `declared:${r.gid}`, evidence: 'declared_group', ids });
    }
  }
  const { results: named } = await db
    .prepare(
      `SELECT t.id, t.name, t.sort_order, t.component_id, c.drawing_id
         FROM tasks t JOIN components c ON c.id = t.component_id JOIN drawings d ON d.id = c.drawing_id JOIN blocks b ON b.id = d.block_id
        WHERE t.name LIKE '%(%/%)%' ${projectFilter} ORDER BY t.id`,
    )
    .bind(...binds)
    .all<{ id: number; name: string; sort_order: number | null; component_id: number; drawing_id: number }>();
  for (const g of groupByNamePattern((named ?? []).map((r) => ({ id: r.id, drawingId: r.drawing_id, componentId: r.component_id, name: r.name, sortOrder: Number(r.sort_order) || 0 })))) {
    if (g.taskIds.every((i) => declaredIds.has(i))) continue; // зарлагдсан бүлэгт аль хэдийн орсон
    candidates.push({ key: g.key, evidence: 'name_pattern', ids: g.taskIds });
  }

  const counts: Record<string, number> = { proven_split: 0, ambiguous: 0, organizational: 0, already_managed: 0 };
  const groups: CandidateGroup[] = [];
  let truncated = false;
  if (!(await conversionReady(db))) return { groups: [], counts, truncated: false, declared_groups_supported: declaredSupported };
  for (const cand of candidates) {
    if (cand.ids.length > MAX_GROUP_MEMBERS) {
      counts.organizational = (counts.organizational ?? 0) + 1;
      continue;
    }
    const loaded = await loadGroup(db, cand.ids, true);
    if (!loaded.facts || loaded.members.length === 0) continue;
    const classification = classifyGroup(loaded.members, { ...loaded.facts, evidence: cand.evidence });
    counts[classification.classification] = (counts[classification.classification] ?? 0) + 1;
    if (classification.classification === 'already_managed' && !opts.includeManaged) continue;
    if (groups.length >= limit) {
      truncated = true;
      continue;
    }
    groups.push({
      key: cand.key,
      evidence: cand.evidence,
      task_ids: cand.ids,
      project_id: loaded.facts.projectId,
      classification,
      members: loaded.members.map(viewOf),
      suggested_root_task_id: defaultRoot(loaded.members, cand.evidence),
    });
  }
  return { groups, counts, truncated, declared_groups_supported: declaredSupported };
}

export interface ConversionRow {
  id: string;
  root_task_id: number;
  project_id: number;
  status: string;
  evidence: string;
  classification: string;
  reason: string | null;
  actor_id: number | null;
  rollup_before: number;
  rollup_after: number;
  created_at: string;
  reverted_at: string | null;
}

export async function listConversions(db: D1Database, limit = 50): Promise<ConversionRow[]> {
  if (!(await conversionReady(db))) return [];
  const { results } = await db
    .prepare(
      `SELECT id, root_task_id, project_id, status, evidence, classification, reason, actor_id, rollup_before, rollup_after,
              created_at, reverted_at
         FROM task_conversions ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(Math.max(1, Math.min(200, limit)))
    .all<ConversionRow>();
  return results ?? [];
}
