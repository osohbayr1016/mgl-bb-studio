/**
 * ТАСКИЙГ ҮНДСЭН ТАСКУУД БОЛГОН ХУВААХ / БУЦААХ — D1 давхарга (эзэн 2026-10-09, migration 0395).  Дүрэм: `taskRootSplit.ts`.
 *
 *   splitTaskIntoRoots — `POST /api/tasks/:id/root-split`.  Нэг batch, эхний statement журналын мөр (`task_root_splits`)-ийг
 *     эх таскийн жин + сүүлийн хувь уншсанаас хойш ӨӨРЧЛӨГДӨӨГҮЙ үед л бичнэ (CAS); бусад нь тэр мөр байвал л ажиллана.
 *     Хүнгүй хэсэгтэй (0394) хуваарилалтгүй таск эхлээд `unsplitTask`-аар анхны байдалд буцаад дараа нь хуваагдана —
 *     хэсгүүд нь цонхонд урьдчилан бөглөгдсөн мөрүүд болдог.  Хүнд хуваарилагдсан таск → 409 HAS_ALLOCATIONS.
 *   undoRootSplit — `POST /api/tasks/root-splits/:id/undo`.  Шинэ таскууд дээр хувь/оноо/хуваарилалт/хугацаа гараагүй,
 *     жин нь хөдлөөгүй үед: цаг, «ажилласан» бүртгэл, «Миний ажлууд», checklist-ийг эх таск руу шилжүүлээд шинэ таскуудыг
 *     устгаж, эх таскийг анхны нэр/жин/явцад нь буцаана.  Шалгалт нь CAS-ын SQL дотор ч давтагдана (зэрэг ирсэн хувь).
 *   loadRootSplitInfo — `GET /api/tasks/:id/root-split` (цонхны өгөгдөл + сүүлийн хуваалт + буцааж болох эсэх).
 */
import { ceoUserId } from './ceo';
import { createNotification } from './notify';
import { latestApprovedPctByCreatedAt } from './progressLatest';
import { todayInUB } from './time';
import {
  ROOT_SPLIT_TOTAL_UNITS,
  doneTaskName,
  planRootSplit,
  undoBlockedMessage,
  type UndoBlocker,
  type UndoBlockerCode,
} from './taskRootSplit';
import { splitOrder } from './taskSplit';
import { closeSetSql, startOfficialTimer } from './taskTimerStore';
import { unsplitTask } from './taskUnsplit';

export const ROOT_SPLIT_ROLES = new Set(['admin', 'senior', 'engineer', 'architect']);
const MANAGER_ROLES = new Set(['admin', 'senior']);
const REQUEST_ID_RE = /^[A-Za-z0-9_.:-]{8,100}$/;
const EPS = 1e-6;

export interface Actor {
  sub: number;
  role: string;
}

export type Failure = { ok: false; status: 400 | 403 | 404 | 409; error: string; message: string; [k: string]: unknown };

const fail = (status: Failure['status'], error: string, message: string, extra: Record<string, unknown> = {}): Failure => ({
  ok: false,
  status,
  error,
  message,
  ...extra,
});

const isManager = (a: Actor) => MANAGER_ROLES.has(a.role) || a.sub === ceoUserId();

async function tableExists(db: D1Database, name: string): Promise<boolean> {
  const r = await db
    .prepare(`SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?1`)
    .bind(name)
    .first<{ x: number }>()
    .catch(() => null);
  return r !== null;
}

interface TaskFacts {
  id: number;
  component_id: number;
  name: string;
  weight_percent: number;
  due_date: string | null;
  start_date: string | null;
  project_id: number;
  project_status: string | null;
  progress_mode: string | null;
  latest_pct: number;
  last_date: string | null;
}

async function loadFacts(db: D1Database, taskId: number): Promise<TaskFacts | null> {
  return db
    .prepare(
      `SELECT t.id, t.component_id, t.name, t.weight_percent, t.due_date, t.start_date,
              b.project_id, p.status AS project_status, p.progress_mode,
              COALESCE(${latestApprovedPctByCreatedAt('t.id')}, 0) AS latest_pct,
              (SELECT MAX(x.date) FROM progress_entries x WHERE x.task_id = t.id AND x.status = 'approved') AS last_date
         FROM tasks t
         JOIN components c ON c.id = t.component_id
         JOIN drawings d ON d.id = c.drawing_id
         JOIN blocks b ON b.id = d.block_id
         JOIN projects p ON p.id = b.project_id
        WHERE t.id = ?1`,
    )
    .bind(taskId)
    .first<TaskFacts>();
}

interface ManagedFacts {
  allocations: number;
  work: boolean;
  root_done_units: number;
  unallocated_units: number;
  parts: Array<{ label: string; units: number }>;
}

async function loadManaged(db: D1Database, taskId: number): Promise<ManagedFacts | null> {
  const root = await db
    .prepare('SELECT unattributed_units, unallocated_units FROM task_roots WHERE task_id = ?1')
    .bind(taskId)
    .first<{ unattributed_units: number; unallocated_units: number }>()
    .catch(() => null);
  if (!root) return null;
  const [allocs, work, parts] = await Promise.all([
    db
      .prepare('SELECT COUNT(*) AS n, COALESCE(SUM(done_units), 0) AS d FROM task_allocations WHERE task_id = ?1')
      .bind(taskId)
      .first<{ n: number; d: number }>(),
    db
      .prepare(`SELECT 1 AS x FROM task_contributions WHERE task_id = ?1 AND kind = 'work' LIMIT 1`)
      .bind(taskId)
      .first<{ x: number }>()
      .catch(() => null),
    (await tableExists(db, 'task_parts'))
      ? db
          .prepare('SELECT label, units FROM task_parts WHERE task_id = ?1 ORDER BY ordinal')
          .bind(taskId)
          .all<{ label: string; units: number }>()
          .then((r) => r.results ?? [])
      : Promise.resolve([] as Array<{ label: string; units: number }>),
  ]);
  return {
    allocations: Number(allocs?.n) || 0,
    work: work !== null,
    root_done_units: Number(root.unattributed_units) + (Number(allocs?.d) || 0),
    unallocated_units: Number(root.unallocated_units) || 0,
    parts,
  };
}

async function isConvertedPart(db: D1Database, taskId: number): Promise<boolean> {
  if (!(await tableExists(db, 'task_conversion_members'))) return false;
  const r = await db
    .prepare('SELECT 1 AS x FROM task_conversion_members WHERE task_id = ?1 LIMIT 1')
    .bind(taskId)
    .first<{ x: number }>()
    .catch(() => null);
  return r !== null;
}

async function runningOn(db: D1Database, taskId: number): Promise<Array<{ user_id: number; full_name: string | null }>> {
  const r = await db
    .prepare(
      `SELECT s.user_id, u.full_name FROM task_timer_sessions s LEFT JOIN users u ON u.id = s.user_id
        WHERE s.task_id = ?1 AND s.ended_at IS NULL`,
    )
    .bind(taskId)
    .all<{ user_id: number; full_name: string | null }>()
    .catch(() => ({ results: [] as Array<{ user_id: number; full_name: string | null }> }));
  return r.results ?? [];
}

/** Хуваах боломжгүй шалтгаан (байхгүй бол null) — GET ба POST хоёулаа. */
function blockOf(f: TaskFacts, managed: ManagedFacts | null, converted: boolean): { error: string; message: string } | null {
  if (f.progress_mode === 'hours') return { error: 'HOURS_MODE', message: 'Цагаар бодогддог төслийн таскийг хуваахгүй.' };
  if (!(Number(f.weight_percent) > 0)) return { error: 'NOT_SPLITTABLE', message: 'Жингүй таскийг хуваах боломжгүй.' };
  if (converted) return { error: 'CONVERTED_PART', message: 'Энэ таск өөр таскт нэгтгэгдсэн тул хуваахгүй.' };
  if (f.project_status !== 'active') return { error: 'PROJECT_INACTIVE', message: 'Төсөл идэвхгүй тул хуваах боломжгүй.' };
  if (managed && (managed.allocations > 0 || managed.work)) {
    return {
      error: 'HAS_ALLOCATIONS',
      message: 'Энэ таск хүмүүст хуваарилагдсан — эхлээд «⋯ → Хуваалтыг цуцлах»-аар буцааж байж үндсэн таскууд болгон хуваана.',
    };
  }
  const pct = managed ? managed.root_done_units / 10_000 : Number(f.latest_pct) || 0;
  if (pct >= 100) return { error: 'TASK_COMPLETED', message: 'Дууссан таскийг хуваах боломжгүй.' };
  return null;
}

/* ------------------------------------------------------------------ */
/*  Хуваах                                                              */
/* ------------------------------------------------------------------ */

export interface SplitPartOut {
  task_id: number;
  name: string;
  weight_percent: number;
}

export interface RootSplitResult {
  ok: true;
  replayed: boolean;
  split_id: number;
  task_id: number;
  mode: 'whole' | 'remainder';
  parts: SplitPartOut[];
  /** Явцтай хуваалтад «хийгдсэн хэсэг» болсон эх таск. */
  done: SplitPartOut | null;
}

async function resultOf(db: D1Database, splitId: number, replayed: boolean): Promise<RootSplitResult | null> {
  const s = await db
    .prepare('SELECT id, task_id, mode FROM task_root_splits WHERE id = ?1')
    .bind(splitId)
    .first<{ id: number; task_id: number; mode: 'whole' | 'remainder' }>();
  if (!s) return null;
  const m = await db
    .prepare('SELECT task_id, role, name, weight FROM task_root_split_members WHERE split_id = ?1 ORDER BY position')
    .bind(splitId)
    .all<{ task_id: number; role: string; name: string; weight: number }>();
  const rows = m.results ?? [];
  const done = rows.find((r) => r.role === 'done');
  return {
    ok: true,
    replayed,
    split_id: s.id,
    task_id: s.task_id,
    mode: s.mode,
    parts: rows.filter((r) => r.role === 'part').map((r) => ({ task_id: r.task_id, name: r.name, weight_percent: r.weight })),
    done: done ? { task_id: done.task_id, name: done.name, weight_percent: done.weight } : null,
  };
}

export async function splitTaskIntoRoots(
  db: D1Database,
  actor: Actor,
  taskId: number,
  body: { requestId: unknown; parts: unknown },
): Promise<RootSplitResult | Failure> {
  if (!ROOT_SPLIT_ROLES.has(actor.role)) return fail(403, 'ROLE_NOT_ALLOWED', 'Таскийг хуваах эрхгүй.');
  if (typeof body.requestId !== 'string' || !REQUEST_ID_RE.test(body.requestId)) {
    return fail(400, 'BAD_REQUEST_ID', 'request_id буруу');
  }
  const rid = body.requestId;

  // Давтан хүсэлт — анхны үр дүн.
  const prior = await db
    .prepare('SELECT id, task_id, actor_id FROM task_root_splits WHERE request_id = ?1')
    .bind(rid)
    .first<{ id: number; task_id: number; actor_id: number }>();
  if (prior) {
    if (prior.task_id !== taskId || prior.actor_id !== actor.sub) {
      return fail(409, 'REQUEST_REUSED', 'request_id өөр үйлдэлд ашиглагдсан');
    }
    const r = await resultOf(db, prior.id, true);
    if (r) return r;
  }

  let facts = await loadFacts(db, taskId);
  if (!facts) return fail(404, 'TASK_NOT_FOUND', 'Таск олдсонгүй');
  const managed = await loadManaged(db, taskId);
  const block = blockOf(facts, managed, await isConvertedPart(db, taskId));
  if (block) return fail(409, block.error, block.message);

  const others = (await runningOn(db, taskId)).filter((w) => w.user_id !== actor.sub);
  if (others.length > 0 && !isManager(actor)) {
    const who = others[0]?.full_name ?? 'Өөр хүн';
    return fail(409, 'TASK_OCCUPIED', `${who} энэ таск дээр одоо ажиллаж байна — түүнтэй ярилцаад, эсвэл ахлах/админаар хуваалгана уу.`);
  }

  // Хуваалтын төлөвлөгөөг ЭХЛЭЭД шалгана — буруу оролтоор хүнгүй хэсгүүдийг (доор) дэмий устгахгүй.
  const predicted = managed ? managed.root_done_units / 10_000 : Number(facts.latest_pct) || 0;
  const pre = planRootSplit(Number(facts.weight_percent), predicted, body.parts);
  if (!pre.ok) return fail(400, pre.code, pre.message);

  // Хүнгүй хэсэгтэй (0394), хүнд хуваарилагдаагүй таск — эхлээд анхны байдалд (хэсгүүдийг цонх мөр болгож илгээсэн).
  if (managed) {
    const un = await unsplitTask(db, { actorId: actor.sub, actorRole: 'admin', taskId, requestId: `rs:${rid}` });
    if (!un.ok) return fail(un.status, un.error, un.message);
    facts = await loadFacts(db, taskId);
    if (!facts) return fail(404, 'TASK_NOT_FOUND', 'Таск олдсонгүй');
  }

  const W = Number(facts.weight_percent);
  const progress = Number(facts.latest_pct) || 0;
  if (progress >= 100) return fail(409, 'TASK_COMPLETED', 'Дууссан таскийг хуваах боломжгүй.');
  const plan = planRootSplit(W, progress, body.parts);
  if (!plan.ok) return fail(400, plan.code, plan.message);
  const remainder = plan.mode === 'remainder';

  // Явцтай үед бүх хэсэг шинэ таск; явцгүй үед эхний хэсэг = эх таск.
  const copyCount = remainder ? plan.names.length : plan.names.length - 1;
  const copyName = (k: number) => plan.names[remainder ? k : k + 1]!;
  const copyWeight = (k: number) => plan.weights[remainder ? k : k + 1]!;
  const originalName = remainder ? doneTaskName(facts.name, progress) : plan.names[0]!;
  const originalWeight = remainder ? plan.doneWeight : plan.weights[0]!;

  const siblings = await db
    .prepare('SELECT id FROM tasks WHERE component_id = ?1 ORDER BY sort_order, id')
    .bind(facts.component_id)
    .all<{ id: number }>();
  const order = splitOrder((siblings.results ?? []).map((r) => r.id), taskId, copyCount);

  const runners = remainder ? await runningOn(db, taskId) : [];
  const nowIso = new Date().toISOString();
  const today = todayInUB();
  // Журналын мөр = CAS: эх таскийн жин ба сүүлийн хувь уншсанаас хойш өөрчлөгдөөгүй.
  const MARK = `EXISTS (SELECT 1 FROM task_root_splits WHERE request_id = ?1 AND undone_at IS NULL)`;
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO task_root_splits
           (request_id, task_id, project_id, mode, orig_name, orig_weight, orig_progress, entry_mark, actor_id)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, (SELECT COALESCE(MAX(id), 0) FROM progress_entries), ?8
          WHERE EXISTS (SELECT 1 FROM tasks g WHERE g.id = ?2 AND ABS(g.weight_percent - ?6) < 1e-9)
            AND ABS(COALESCE(${latestApprovedPctByCreatedAt('?2')}, 0) - ?7) < 1e-9
            AND NOT EXISTS (SELECT 1 FROM task_roots r WHERE r.task_id = ?2)`,
      )
      .bind(rid, taskId, facts.project_id, plan.mode, facts.name, W, progress, actor.sub),
  ];
  const copyStmtIdx: number[] = [];
  order.forEach((item, pos) => {
    const sortOrder = (pos + 1) * 10;
    if (typeof item === 'number') {
      stmts.push(db.prepare(`UPDATE tasks SET sort_order = ?2 WHERE id = ?3 AND ${MARK}`).bind(rid, sortOrder, item));
    } else {
      copyStmtIdx.push(stmts.length);
      stmts.push(
        db
          .prepare(
            `INSERT INTO tasks (component_id, name, weight_percent, due_date, start_date, sort_order)
             SELECT ?2, ?3, ?4, ?5, ?6, ?7 WHERE ${MARK}
             RETURNING id`,
          )
          .bind(rid, facts.component_id, copyName(item.copy), copyWeight(item.copy), facts.due_date, facts.start_date, sortOrder),
      );
    }
  });
  stmts.push(
    db.prepare(`UPDATE tasks SET name = ?2, weight_percent = ?3 WHERE id = ?4 AND ${MARK}`).bind(rid, originalName, originalWeight, taskId),
  );
  if (remainder) {
    // Хийгдсэн хэсэг ДУУССАН тул түүн дээрх таймер хаагдана (шинэ эхний хэсэг дээр доор дахин эхэлнэ).
    stmts.push(
      db
        .prepare(
          `UPDATE task_timer_sessions SET ${closeSetSql('?2')},
                  end_reason = 'auto_stop_completed', end_note = 'split', ended_by = ?3, end_request_id = ?4
            WHERE ended_at IS NULL AND task_id = ?5 AND ${MARK}`,
        )
        .bind(rid, nowIso, actor.sub, `rs-stop:${rid}`, taskId),
      db
        .prepare(
          `INSERT INTO task_timer_events (user_id, actor_id, action, session_id, task_id, at, request_id, note)
           SELECT user_id, ?2, 'auto_stop_completed', id, task_id, ended_at, ?1, 'split'
             FROM task_timer_sessions WHERE task_id = ?3 AND end_request_id = ?1`,
        )
        .bind(`rs-stop:${rid}`, actor.sub, taskId),
    );
    // Огноо нь хамгийн сүүлийн бичлэгээс эрт байж болохгүй (`byDate` дараалалд ч хамгийн сүүлд).
    const entryDate = facts.last_date && facts.last_date > today ? facts.last_date : today;
    stmts.push(
      db
        .prepare(
          `INSERT INTO progress_entries
             (task_id, user_id, percentage, date, notes, status, reviewed_by, reviewed_at, is_rest_day, defer_next_day, source)
           SELECT ?2, ?3, 100, ?4, ?5, 'approved', ?3, ?6, 0, 0, 'split' WHERE ${MARK}`,
        )
        .bind(
          rid,
          taskId,
          actor.sub,
          entryDate,
          `[Хуваалт] Хийгдсэн ${Math.round(progress * 100) / 100}% хэсэг дууссан гэж хаагдав — үлдсэнийг ${copyCount} шинэ таск болгов`,
          nowIso,
        ),
      db
        .prepare(
          `UPDATE task_root_splits
              SET done_entry_id = (SELECT MAX(id) FROM progress_entries WHERE task_id = ?2 AND source = 'split')
            WHERE request_id = ?1`,
        )
        .bind(rid, taskId),
    );
  }

  const results = await db.batch(stmts);
  if ((results[0]?.meta.changes ?? 0) === 0) {
    return fail(409, 'STALE', 'Таск яг одоо өөрчлөгдсөн (жин эсвэл явц) — хуудсаа шинэчлээд дахин оролдоно уу.');
  }
  const split = await db
    .prepare('SELECT id FROM task_root_splits WHERE request_id = ?1')
    .bind(rid)
    .first<{ id: number }>();
  const splitId = split?.id ?? 0;
  const copyIds = copyStmtIdx.map((i) => (results[i]?.results as Array<{ id: number }> | undefined)?.[0]?.id ?? 0);
  const partIds = remainder ? copyIds : [taskId, ...copyIds];

  // Гишүүд — буцаахад юуг хаана устгах, ямар жин хүлээхийг хадгална.
  const members: D1PreparedStatement[] = [];
  const member = db.prepare(
    `INSERT OR IGNORE INTO task_root_split_members (split_id, task_id, position, role, is_original, name, weight)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  );
  if (remainder) members.push(member.bind(splitId, taskId, 0, 'done', 1, originalName, originalWeight));
  partIds.forEach((id, i) => {
    members.push(member.bind(splitId, id, i + 1, 'part', id === taskId ? 1 : 0, plan.names[i]!, plan.weights[i]!));
  });
  await db.batch(members).catch((err: unknown) => console.error('[root-split] members insert failed', err));

  if (remainder) {
    const part0 = partIds[0]!;
    // «Миний ажлууд»-д нэмсэн хүмүүс үргэлжлэлийг (эхний хэсэг) ч жагсаалтдаа харна.
    await db
      .prepare(
        `INSERT OR IGNORE INTO task_personal_list (user_id, task_id, added_at, hidden_at)
         SELECT user_id, ?2, added_at, hidden_at FROM task_personal_list WHERE task_id = ?1`,
      )
      .bind(taskId, part0)
      .run()
      .catch((err: unknown) => console.error('[root-split] my-task-list copy failed', err));
    // Хаагдсан таск дээр ажиллаж байсан хүмүүсийн цаг эхний хэсэг дээр үргэлжилнэ.
    for (const w of runners) {
      await startOfficialTimer(db, {
        userId: w.user_id,
        actorId: actor.sub,
        nowIso: new Date().toISOString(),
        requestId: `rs-move:${w.user_id}:${rid}`.slice(0, 120),
        taskId: part0,
        projectId: facts.project_id,
      }).catch((err: unknown) => console.error('[root-split] timer move failed', err));
    }
  }

  for (const w of others) {
    await createNotification(
      db,
      w.user_id,
      'task_assigned',
      'Таны ажиллаж буй таск хуваагдлаа',
      `«${facts.name}» ${partIds.length} таск болж хуваагдлаа.`,
      `/app/projects/${facts.project_id}?task=${remainder ? partIds[0] : taskId}`,
    );
  }

  return (
    (await resultOf(db, splitId, false)) ?? {
      ok: true,
      replayed: false,
      split_id: splitId,
      task_id: taskId,
      mode: plan.mode,
      parts: partIds.map((id, i) => ({ task_id: id, name: plan.names[i]!, weight_percent: plan.weights[i]! })),
      done: remainder ? { task_id: taskId, name: originalName, weight_percent: originalWeight } : null,
    }
  );
}

/* ------------------------------------------------------------------ */
/*  Буцаах                                                              */
/* ------------------------------------------------------------------ */

interface SplitRow {
  id: number;
  task_id: number;
  project_id: number | null;
  mode: 'whole' | 'remainder';
  orig_name: string;
  orig_weight: number;
  orig_progress: number;
  done_entry_id: number | null;
  entry_mark: number;
  actor_id: number;
  created_at: string;
  undone_at: string | null;
  undo_request_id: string | null;
}

interface MemberRow {
  task_id: number;
  role: 'part' | 'done';
  is_original: number;
  name: string;
  weight: number;
  position: number;
}

/** Шинэ таскуудыг устгахад хувь/оноо/ажил алдагдах хүснэгтүүд — нэг ч мөр байвал буцаахгүй. */
const NEW_TASK_BLOCKERS: Array<{ table: string; code: UndoBlockerCode; where?: string }> = [
  { table: 'progress_entries', code: 'HAS_PROGRESS' },
  { table: 'user_points', code: 'HAS_POINTS' },
  { table: 'task_roots', code: 'HAS_ALLOCATION' },
  { table: 'task_allocations', code: 'HAS_ALLOCATION' },
  { table: 'task_parts', code: 'HAS_ALLOCATION' },
  { table: 'task_deadlines', code: 'HAS_DEADLINE' },
  { table: 'project_milestones', code: 'HAS_MILESTONE' },
  { table: 'repair_entries', code: 'HAS_REPAIR' },
  { table: 'repair_marks', code: 'HAS_REPAIR' },
  { table: 'task_shares', code: 'HAS_SHARES' },
  { table: 'task_self_done', code: 'HAS_PROGRESS' },
];

async function loadSplit(db: D1Database, splitId: number): Promise<{ split: SplitRow; members: MemberRow[] } | null> {
  const split = await db.prepare('SELECT * FROM task_root_splits WHERE id = ?1').bind(splitId).first<SplitRow>();
  if (!split) return null;
  const m = await db
    .prepare('SELECT task_id, role, is_original, name, weight, position FROM task_root_split_members WHERE split_id = ?1 ORDER BY position')
    .bind(splitId)
    .all<MemberRow>();
  return { split, members: m.results ?? [] };
}

export async function undoBlockers(db: D1Database, split: SplitRow, members: MemberRow[]): Promise<UndoBlocker[]> {
  const out: UndoBlocker[] = [];
  const nameOf = (id: number) => members.find((m) => m.task_id === id)?.name ?? `#${id}`;
  if (members.length === 0) return [{ task_id: split.task_id, name: split.orig_name, code: 'MISSING' }];
  const ids = members.map((m) => m.task_id);
  const placeholders = ids.map((_, i) => `?${i + 1}`).join(', ');
  const cur = await db
    .prepare(`SELECT id, weight_percent FROM tasks WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all<{ id: number; weight_percent: number }>();
  const weights = new Map((cur.results ?? []).map((r) => [r.id, Number(r.weight_percent)]));
  for (const m of members) {
    const w = weights.get(m.task_id);
    if (w === undefined) out.push({ task_id: m.task_id, name: m.name, code: 'MISSING' });
    else if (Math.abs(w - Number(m.weight)) > EPS) out.push({ task_id: m.task_id, name: m.name, code: 'WEIGHT_CHANGED' });
  }

  const newIds = members.filter((m) => m.is_original === 0).map((m) => m.task_id);
  if (newIds.length > 0) {
    const ph = newIds.map((_, i) => `?${i + 1}`).join(', ');
    for (const b of NEW_TASK_BLOCKERS) {
      if (!(await tableExists(db, b.table))) continue;
      const r = await db
        .prepare(`SELECT DISTINCT task_id FROM ${b.table} WHERE task_id IN (${ph})`)
        .bind(...newIds)
        .all<{ task_id: number }>()
        .catch(() => ({ results: [] as Array<{ task_id: number }> }));
      for (const row of r.results ?? []) {
        if (!out.some((o) => o.task_id === row.task_id && o.code === b.code)) {
          out.push({ task_id: row.task_id, name: nameOf(row.task_id), code: b.code });
        }
      }
    }
    // Шинэ таскийг дахин хуваасан (идэвхтэй хуваалт).
    const nested = await db
      .prepare(`SELECT DISTINCT task_id FROM task_root_splits WHERE undone_at IS NULL AND id <> ?1 AND task_id IN (${newIds.map((_, i) => `?${i + 2}`).join(', ')})`)
      .bind(split.id, ...newIds)
      .all<{ task_id: number }>();
    for (const row of nested.results ?? []) out.push({ task_id: row.task_id, name: nameOf(row.task_id), code: 'SPLIT_AGAIN' });
  }

  // Эх таск: хуваасны дараа хувь (хуваалтын өөрийн 100% бичлэгээс бусад), хуваарилалт, дахин хуваалт.
  const orig = await db
    .prepare(
      `SELECT
         EXISTS (SELECT 1 FROM progress_entries WHERE task_id = ?1 AND id > ?2 AND id IS NOT COALESCE(?3, -1)) AS e,
         EXISTS (SELECT 1 FROM task_roots WHERE task_id = ?1) AS r,
         EXISTS (SELECT 1 FROM task_root_splits WHERE task_id = ?1 AND undone_at IS NULL AND id > ?4) AS s`,
    )
    .bind(split.task_id, split.entry_mark, split.done_entry_id, split.id)
    .first<{ e: number; r: number; s: number }>();
  const oname = nameOf(split.task_id);
  if (orig?.e) out.push({ task_id: split.task_id, name: oname, code: 'ORIGINAL_PROGRESS' });
  if (orig?.r) out.push({ task_id: split.task_id, name: oname, code: 'HAS_ALLOCATION' });
  if (orig?.s) out.push({ task_id: split.task_id, name: oname, code: 'SPLIT_AGAIN' });
  return out;
}

export interface UndoResult {
  ok: true;
  replayed: boolean;
  split_id: number;
  task_id: number;
  removed_tasks: number;
}

/** Шинэ таскуудаас эх таск руу шилжих мөрүүд (цаг, ажилласан бүртгэл, хувийн жагсаалт, checklist, Revit холбоос). */
async function moveStatements(db: D1Database, MARK: string, splitId: number, rid: string, origId: number): Promise<D1PreparedStatement[]> {
  const NEW = `(SELECT task_id FROM task_root_split_members WHERE split_id = ?2 AND is_original = 0)`;
  const out: D1PreparedStatement[] = [];
  // Хамгийн их `?N` хүртэл л bind хийнэ — SQL-д ашиглагдаагүй илүү параметр SQLite-д алдаа өгдөг.
  const add = (sql: string) => {
    const max = Math.max(...[...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1])));
    out.push(db.prepare(sql).bind(...[rid, splitId, origId].slice(0, max)));
  };
  const has = async (t: string) => tableExists(db, t);
  if (await has('task_timer_sessions')) add(`UPDATE task_timer_sessions SET task_id = ?3 WHERE task_id IN ${NEW} AND ${MARK}`);
  if (await has('task_timer_events')) {
    add(`UPDATE task_timer_events SET task_id = ?3 WHERE task_id IN ${NEW} AND ${MARK}`);
    add(`UPDATE task_timer_events SET from_task_id = ?3 WHERE from_task_id IN ${NEW} AND ${MARK}`);
  }
  if (await has('task_timer_voids')) add(`UPDATE task_timer_voids SET task_id = ?3 WHERE task_id IN ${NEW} AND ${MARK}`);
  add(
    `INSERT OR IGNORE INTO task_assignees (task_id, user_id, created_at)
     SELECT ?3, user_id, created_at FROM task_assignees WHERE task_id IN ${NEW} AND ${MARK}`,
  );
  add(`DELETE FROM task_assignees WHERE task_id IN ${NEW} AND ${MARK}`);
  if (await has('task_personal_list')) {
    add(
      `INSERT OR IGNORE INTO task_personal_list (user_id, task_id, added_at, hidden_at)
       SELECT user_id, ?3, added_at, hidden_at FROM task_personal_list WHERE task_id IN ${NEW} AND ${MARK}`,
    );
    add(`DELETE FROM task_personal_list WHERE task_id IN ${NEW} AND ${MARK}`);
  }
  for (const t of ['task_checklist_items', 'task_hold_periods', 'revit_sheet_bindings', 'revit_submissions']) {
    if (await has(t)) add(`UPDATE ${t} SET task_id = ?3 WHERE task_id IN ${NEW} AND ${MARK}`);
  }
  for (const t of ['revit_work_segments', 'revit_work_presence']) {
    if (await has(t)) add(`UPDATE OR IGNORE ${t} SET task_id = ?3 WHERE task_id IN ${NEW} AND ${MARK}`);
  }
  return out;
}

export async function undoRootSplit(
  db: D1Database,
  actor: Actor,
  splitId: number,
  requestId: unknown,
): Promise<UndoResult | Failure> {
  if (!ROOT_SPLIT_ROLES.has(actor.role)) return fail(403, 'ROLE_NOT_ALLOWED', 'Хуваалтыг буцаах эрхгүй.');
  if (typeof requestId !== 'string' || !REQUEST_ID_RE.test(requestId)) return fail(400, 'BAD_REQUEST_ID', 'request_id буруу');
  const loaded = await loadSplit(db, splitId);
  if (!loaded) return fail(404, 'SPLIT_NOT_FOUND', 'Хуваалт олдсонгүй');
  const { split, members } = loaded;
  if (split.undone_at) {
    if (split.undo_request_id === requestId) {
      return { ok: true, replayed: true, split_id: split.id, task_id: split.task_id, removed_tasks: 0 };
    }
    return fail(409, 'ALREADY_UNDONE', 'Энэ хуваалт аль хэдийн буцаагдсан.');
  }
  const status = await db
    .prepare(
      `SELECT p.status FROM tasks t JOIN components c ON c.id = t.component_id JOIN drawings d ON d.id = c.drawing_id
         JOIN blocks b ON b.id = d.block_id JOIN projects p ON p.id = b.project_id WHERE t.id = ?1`,
    )
    .bind(split.task_id)
    .first<{ status: string }>();
  if (status && status.status !== 'active' && !isManager(actor)) {
    return fail(409, 'PROJECT_INACTIVE', 'Төсөл идэвхгүй тул хуваалтыг буцаах боломжгүй.');
  }
  const blockers = await undoBlockers(db, split, members);
  if (blockers.length > 0) return fail(409, 'UNDO_BLOCKED', undoBlockedMessage(blockers), { blockers });

  // CAS: буцаагдаагүй, жин хөдлөөгүй, шинэ таск дээр хувь/оноо гараагүй, эх таск дээр шинэ хувь гараагүй — бүгд SQL-д ДАХИН.
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE task_root_splits SET undone_at = datetime('now'), undone_by = ?2, undo_request_id = ?1
          WHERE id = ?3 AND undone_at IS NULL
            AND (SELECT COUNT(*) FROM task_root_split_members m JOIN tasks t ON t.id = m.task_id
                  WHERE m.split_id = ?3 AND ABS(t.weight_percent - m.weight) < 1e-9)
                = (SELECT COUNT(*) FROM task_root_split_members WHERE split_id = ?3)
            AND NOT EXISTS (SELECT 1 FROM progress_entries x WHERE x.task_id IN
                              (SELECT task_id FROM task_root_split_members WHERE split_id = ?3 AND is_original = 0))
            AND NOT EXISTS (SELECT 1 FROM user_points x WHERE x.task_id IN
                              (SELECT task_id FROM task_root_split_members WHERE split_id = ?3 AND is_original = 0))
            AND NOT EXISTS (SELECT 1 FROM task_roots x WHERE x.task_id IN
                              (SELECT task_id FROM task_root_split_members WHERE split_id = ?3))
            AND NOT EXISTS (SELECT 1 FROM progress_entries x WHERE x.task_id = ?4 AND x.id > ?5 AND x.id IS NOT COALESCE(?6, -1))`,
      )
      .bind(requestId, actor.sub, split.id, split.task_id, split.entry_mark, split.done_entry_id),
  ];
  const MARK = `EXISTS (SELECT 1 FROM task_root_splits WHERE id = ?2 AND undo_request_id = ?1)`;
  stmts.push(...(await moveStatements(db, MARK, split.id, requestId, split.task_id)));
  const NEW = `(SELECT task_id FROM task_root_split_members WHERE split_id = ?2 AND is_original = 0)`;
  stmts.push(
    db.prepare(`DELETE FROM tasks WHERE id IN ${NEW} AND ${MARK}`).bind(requestId, split.id),
    db
      .prepare(`UPDATE tasks SET name = ?3, weight_percent = ?4 WHERE id = ?5 AND ${MARK}`)
      .bind(requestId, split.id, split.orig_name, split.orig_weight, split.task_id),
  );
  if (split.done_entry_id) {
    stmts.push(
      db
        .prepare(`DELETE FROM progress_entries WHERE id = ?3 AND task_id = ?4 AND source = 'split' AND ${MARK}`)
        .bind(requestId, split.id, split.done_entry_id, split.task_id),
    );
  }
  const results = await db.batch(stmts);
  if ((results[0]?.meta.changes ?? 0) === 0) {
    return fail(409, 'STALE', 'Таск яг одоо өөрчлөгдсөн — хуудсаа шинэчлээд дахин оролдоно уу.');
  }
  return {
    ok: true,
    replayed: false,
    split_id: split.id,
    task_id: split.task_id,
    removed_tasks: members.filter((m) => m.is_original === 0).length,
  };
}

/* ------------------------------------------------------------------ */
/*  Цонхны өгөгдөл                                                      */
/* ------------------------------------------------------------------ */

export interface RootSplitInfo {
  task: {
    id: number;
    name: string;
    project_id: number;
    weight_percent: number;
    /** Хуваах үед «хийгдсэн» гэж тооцогдох хувь. */
    progress: number;
  };
  can_split: boolean;
  block: { error: string; message: string } | null;
  /** Одоо энэ таск дээр ажиллаж буй БУСАД хүмүүс (ахлах/админаас бусад нь хуваахгүй). */
  occupied_by: Array<{ user_id: number; full_name: string | null }>;
  /** Хүнгүй хэсгүүд (0394) — цонхонд урьдчилан бөглөх мөрүүд (хуваагдах ажлын хувиар). */
  prefill: Array<{ name: string; share_units: number }>;
  last_split: null | {
    id: number;
    created_at: string;
    actor_name: string | null;
    mode: 'whole' | 'remainder';
    orig_name: string;
    members: Array<{ task_id: number; name: string; weight: number; role: 'part' | 'done' }>;
    undoable: boolean;
    blocked_message: string | null;
  };
}

export async function loadRootSplitInfo(db: D1Database, actor: Actor, taskId: number): Promise<RootSplitInfo | Failure> {
  const facts = await loadFacts(db, taskId);
  if (!facts) return fail(404, 'TASK_NOT_FOUND', 'Таск олдсонгүй');
  const managed = await loadManaged(db, taskId);
  let block = blockOf(facts, managed, await isConvertedPart(db, taskId));
  if (!block && !ROOT_SPLIT_ROLES.has(actor.role)) block = { error: 'ROLE_NOT_ALLOWED', message: 'Таскийг хуваах эрхгүй.' };
  const others = (await runningOn(db, taskId)).filter((w) => w.user_id !== actor.sub);
  if (!block && others.length > 0 && !isManager(actor)) {
    block = { error: 'TASK_OCCUPIED', message: `${others[0]?.full_name ?? 'Өөр хүн'} энэ таск дээр одоо ажиллаж байна.` };
  }
  const progress = managed ? managed.root_done_units / 10_000 : Number(facts.latest_pct) || 0;

  // Хүнгүй хэсгүүд → хуваагдах ажлын (U) хувь.  Үлдэгдэл (нэргүй) нь таскийн нэртэй мөр болно.
  const prefill: RootSplitInfo['prefill'] = [];
  if (managed && managed.parts.length > 0 && managed.allocations === 0) {
    const pool = Math.max(1, ROOT_SPLIT_TOTAL_UNITS - managed.root_done_units);
    const rows = managed.parts.map((p) => ({ name: p.label, units: p.units }));
    const used = rows.reduce((s, r) => s + r.units, 0);
    if (pool - used > 0) rows.push({ name: facts.name, units: pool - used });
    let acc = 0;
    rows.forEach((r, i) => {
      const share = i === rows.length - 1 ? ROOT_SPLIT_TOTAL_UNITS - acc : Math.round((r.units * ROOT_SPLIT_TOTAL_UNITS) / pool);
      acc += share;
      if (share > 0) prefill.push({ name: r.name, share_units: share });
    });
  }

  let lastSplit: RootSplitInfo['last_split'] = null;
  const ls = await db
    .prepare(
      `SELECT s.id FROM task_root_splits s JOIN task_root_split_members m ON m.split_id = s.id
        WHERE m.task_id = ?1 AND s.undone_at IS NULL ORDER BY s.id DESC LIMIT 1`,
    )
    .bind(taskId)
    .first<{ id: number }>()
    .catch(() => null);
  if (ls) {
    const loaded = await loadSplit(db, ls.id);
    if (loaded) {
      const blockers = await undoBlockers(db, loaded.split, loaded.members);
      const actorRow = await db
        .prepare('SELECT full_name FROM users WHERE id = ?1')
        .bind(loaded.split.actor_id)
        .first<{ full_name: string | null }>();
      lastSplit = {
        id: loaded.split.id,
        created_at: loaded.split.created_at,
        actor_name: actorRow?.full_name ?? null,
        mode: loaded.split.mode,
        orig_name: loaded.split.orig_name,
        members: loaded.members.map((m) => ({ task_id: m.task_id, name: m.name, weight: m.weight, role: m.role })),
        undoable: blockers.length === 0 && ROOT_SPLIT_ROLES.has(actor.role),
        blocked_message: blockers.length > 0 ? undoBlockedMessage(blockers) : null,
      };
    }
  }

  return {
    task: {
      id: facts.id,
      name: facts.name,
      project_id: facts.project_id,
      weight_percent: Number(facts.weight_percent),
      progress,
    },
    can_split: block === null,
    block,
    occupied_by: others,
    prefill,
    last_split: lastSplit,
  };
}

/* ------------------------------------------------------------------ */
/*  Хуваагдсан хэсгийг УСТГАХАД жин эх таск руу буцна (эзэн 2026-10-12) */
/* ------------------------------------------------------------------ */

/**
 * ✂-ээр хуваагдсан хэсгийг (жишээ: 2.77 → 1.39 + 1.38) админ устгахад түүний жин төслөөс АЛГА болдог байсан — үлдсэн
 * таск 1.39 хэвээр, бүлгийн нийлбэр 48.62 болж төслийн явц дутуу харагдана.  Одоо устгасан хэсгийн ОДООГИЙН жин тэр
 * хуваалтын үлдсэн хэсэг рүү (эх таск түрүүнд, эс бөгөөс эхний байрлал) буцаж нэмэгдэнэ — нийт жин хэвээр.
 *   • Зөвхөн `role = 'part'` хэсэг өв залгуулна/авна; явцтай хуваалтын «хийгдсэн хэсэг» (`done`, 100%-аар хаагдсан) нь
 *     жин авахгүй — авбал төслийн явц хуурамчаар өснө.
 *   • Буцаагдсан (`undone_at`) хуваалт тооцогдохгүй; өв залгагч ижил бүрэлдэхүүнд байх ёстой.
 *   • Таск хэд хэдэн хуваалтад оролцсон бол хамгийн СҮҮЛИЙН хуваалт.
 * Хуваалтын журналд хүрэхгүй — устсан гишүүн `undoBlockers`-т `MISSING` болж буцаалтыг аль хэдийн хаана.
 */
export interface WeightHeir {
  split_id: number;
  heir_id: number;
  heir_name: string;
  /** Устгах таскийн одоогийн жин (өв залгагч дээр нэмэгдэнэ). */
  weight: number;
}

export async function findWeightHeir(db: D1Database, taskId: number): Promise<WeightHeir | null> {
  if (!(await tableExists(db, 'task_root_split_members'))) return null;
  const row = await db
    .prepare(
      `SELECT m.split_id, h.id AS heir_id, h.name AS heir_name, t.weight_percent AS weight
         FROM task_root_split_members m
         JOIN task_root_splits s ON s.id = m.split_id AND s.undone_at IS NULL
         JOIN tasks t ON t.id = m.task_id
         JOIN task_root_split_members o ON o.split_id = m.split_id AND o.task_id <> m.task_id AND o.role = 'part'
         JOIN tasks h ON h.id = o.task_id AND h.component_id = t.component_id
        WHERE m.task_id = ?1 AND m.role = 'part'
        ORDER BY m.split_id DESC, o.is_original DESC, o.position ASC
        LIMIT 1`,
    )
    .bind(taskId)
    .first<{ split_id: number; heir_id: number; heir_name: string; weight: number }>();
  if (!row || !(Number(row.weight) > 0)) return null;
  return { split_id: row.split_id, heir_id: row.heir_id, heir_name: row.heir_name, weight: Number(row.weight) };
}

/** Өв залгагч дээр устгах таскийн жинг нэмэх мөр — `DELETE`-тэй НЭГ batch-д, устгах таск байгаа үед л (давхар устгалт
 *  жинг хоёр удаа нэмэхгүй). */
export function inheritWeightStatement(db: D1Database, deletedId: number, heirId: number): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE tasks
          SET weight_percent = ROUND(weight_percent + (SELECT weight_percent FROM tasks WHERE id = ?1), 4)
        WHERE id = ?2 AND EXISTS (SELECT 1 FROM tasks WHERE id = ?1)`,
    )
    .bind(deletedId, heirId);
}
