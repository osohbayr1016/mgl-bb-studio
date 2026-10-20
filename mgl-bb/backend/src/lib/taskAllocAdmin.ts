/**
 * ТАСКИЙН ХУВААРИЛТ — МЕНЕЖЕРИЙН (admin/senior) ЗАХИАЛГЫН ӨГӨГДӨЛ: идэвхжүүлэлтийн төлөв солих, root-уудын тойм
 * (2026-10-05).  Хаалганы дүрэм: `taskAllocGate.ts`.  Эдгээр нь ХААЛГААС ЧӨЛӨӨТЭЙ (paused үед ч ажиллана) — release-ийн
 * дараалал «paused дээр хөрвүүлж, шалгаж, дараа нь идэвхжүүлнэ» гэж шаарддаг.
 */
import {
  TASK_ALLOC_CONTRACT,
  TASK_ALLOC_MIN_CONTRACT,
  TASK_ALLOC_STATE_KEY,
  loadGate,
  parseTaskAllocState,
  type GateSnapshot,
  type TaskAllocState,
} from './taskAllocGate';
import { creditReconcileCounts } from './taskCreditReconcileQueue';

export interface StateLogRow {
  id: number;
  from_state: string | null;
  to_state: string;
  actor_id: number | null;
  reason: string | null;
  contract: number;
  at: string;
}

export interface StateOverview {
  state: TaskAllocState;
  configured: boolean;
  updated_at: string | null;
  updated_by: number | null;
  contract: number;
  min_contract: number;
  counts: {
    roots: number;
    active_roots: number;
    complete_roots: number;
    participants: number;
    pending_post_commit: number;
    /** 0402 — жин засварын дараа унасан онооны тулгалт (cron дахин оролдоно / 8 оролдлогод бүтэлгүйтсэн). */
    pending_reconcile: number;
    failed_reconcile: number;
  };
  history: StateLogRow[];
}

export async function loadStateOverview(db: D1Database, historyLimit = 20): Promise<StateOverview> {
  const gate = await loadGate(db);
  const [counts, history, pending, reconcile] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS roots,
                COALESCE(SUM(CASE WHEN r.completed_at IS NULL THEN 1 ELSE 0 END), 0) AS active_roots,
                COALESCE(SUM(CASE WHEN r.completed_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS complete_roots,
                (SELECT COUNT(*) FROM task_allocations) AS participants
           FROM task_roots r`,
      )
      .first<{ roots: number; active_roots: number; complete_roots: number; participants: number }>(),
    db
      .prepare(
        `SELECT id, from_state, to_state, actor_id, reason, contract, at
           FROM task_alloc_state_log ORDER BY id DESC LIMIT ?`,
      )
      .bind(Math.max(1, Math.min(100, historyLimit)))
      .all<StateLogRow>()
      .catch(() => ({ results: [] as StateLogRow[] })),
    db
      .prepare("SELECT COUNT(*) AS n FROM task_ops WHERE post_status <> 'done'")
      .first<{ n: number }>()
      .catch(() => ({ n: 0 })),
    creditReconcileCounts(db),
  ]);
  return {
    state: gate.state,
    configured: gate.configured,
    updated_at: gate.updatedAt,
    updated_by: gate.updatedBy,
    contract: TASK_ALLOC_CONTRACT,
    min_contract: TASK_ALLOC_MIN_CONTRACT,
    counts: {
      roots: Number(counts?.roots) || 0,
      active_roots: Number(counts?.active_roots) || 0,
      complete_roots: Number(counts?.complete_roots) || 0,
      participants: Number(counts?.participants) || 0,
      pending_post_commit: Number(pending?.n) || 0,
      pending_reconcile: reconcile.pending,
      failed_reconcile: reconcile.failed,
    },
    history: history.results ?? [],
  };
}

export type SetStateResult =
  | { ok: true; from: TaskAllocState | null; to: TaskAllocState; changed: boolean }
  | { ok: false; status: 400 | 409; code: 'BAD_STATE' | 'REASON_REQUIRED' | 'STATE_CHANGED'; message: string; current?: GateSnapshot };

export const MIN_REASON = 3;
export const MAX_REASON = 200;

/**
 * Төлөв солих.  `expected` өгөгдвөл одоогийн төлөвтэй таарах ёстой (хоёр админ зэрэг дарахаас сэргийлнэ), мөн SQL-д
 * CAS (`WHERE value = текущий`).  Үндэслэл ЗААВАЛ — аудитын түүхэнд хадгалагдана.  Төлөв ЯГ ИЖИЛ бол юу ч бичихгүй.
 */
export async function setGateState(
  db: D1Database,
  actorId: number,
  input: { to: unknown; expected?: unknown; reason: unknown },
): Promise<SetStateResult> {
  const to = parseTaskAllocState(input.to);
  if (to === null) return { ok: false, status: 400, code: 'BAD_STATE', message: "state нь 'disabled' | 'enabled' | 'paused' байна" };
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason.length < MIN_REASON || reason.length > MAX_REASON) {
    return { ok: false, status: 400, code: 'REASON_REQUIRED', message: `Үндэслэл ${MIN_REASON}–${MAX_REASON} тэмдэгт байх ёстой` };
  }
  const cur = await loadGate(db);
  const expected = input.expected === undefined || input.expected === null ? null : parseTaskAllocState(input.expected);
  if (input.expected !== undefined && input.expected !== null && expected === null) {
    return { ok: false, status: 400, code: 'BAD_STATE', message: 'expected_state буруу' };
  }
  if (expected !== null && expected !== cur.state) {
    return { ok: false, status: 409, code: 'STATE_CHANGED', message: 'Төлөв хооронд өөрчлөгдсөн байна — шинэчлээд дахин оролдоно уу', current: cur };
  }
  if (cur.configured && cur.state === to) return { ok: true, from: cur.state, to, changed: false };

  const from = cur.configured ? cur.state : null;
  const stmts = [
    cur.configured
      ? db
          .prepare(
            `UPDATE app_settings SET value = ?1, updated_at = datetime('now'), updated_by = ?2
              WHERE key = ?3 AND value = ?4`,
          )
          .bind(to, actorId, TASK_ALLOC_STATE_KEY, cur.state)
      : db
          .prepare(
            // Мөр байхгүй ЭСВЭЛ буруу (enum биш) утгатай байвал л бичнэ — зөв утгыг зэрэг тохируулсан бол (changes() = 0) STATE_CHANGED.
            // `INSERT OR IGNORE` нь буруу утгатай мөрийг ЗАСДАГГҮЙ тул админ хэзээ ч төлөв тохируулж чаддаггүй байв.
            `INSERT INTO app_settings (key, value, updated_at, updated_by)
             VALUES (?1, ?2, datetime('now'), ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by
              WHERE app_settings.value NOT IN ('disabled', 'enabled', 'paused')`,
          )
          .bind(TASK_ALLOC_STATE_KEY, to, actorId),
    db
      .prepare(
        `INSERT INTO task_alloc_state_log (from_state, to_state, actor_id, reason, contract)
         SELECT ?1, ?2, ?3, ?4, ?5 WHERE changes() > 0`,
      )
      .bind(from, to, actorId, reason, TASK_ALLOC_CONTRACT),
  ];
  const res = await db.batch(stmts);
  if ((res[0]?.meta.changes ?? 0) === 0) {
    return { ok: false, status: 409, code: 'STATE_CHANGED', message: 'Төлөв хооронд өөрчлөгдсөн байна — шинэчлээд дахин оролдоно уу', current: await loadGate(db) };
  }
  return { ok: true, from: cur.state, to, changed: true };
}

export interface RootOverviewRow {
  task_id: number;
  task_name: string;
  project_id: number;
  project_name: string;
  project_status: string | null;
  revision: number;
  unattributed_units: number;
  unallocated_units: number;
  completed_at: string | null;
  seed_attribution: string | null;
  participants: number;
  active_participants: number;
  sum_done_units: number;
  sum_target_units: number;
  updated_at: string;
}

export async function loadRootsOverview(
  db: D1Database,
  opts: { projectId?: number | null; limit?: number; offset?: number; onlyOpen?: boolean },
): Promise<{ total: number; rows: RootOverviewRow[] }> {
  const limit = Math.max(1, Math.min(200, opts.limit ?? 50));
  const offset = Math.max(0, opts.offset ?? 0);
  const where: string[] = [];
  const params: Array<number | null> = [];
  if (opts.projectId) {
    where.push('b.project_id = ?');
    params.push(opts.projectId);
  }
  if (opts.onlyOpen) where.push('r.completed_at IS NULL');
  const w = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const base = `FROM task_roots r
                JOIN tasks t ON t.id = r.task_id
                JOIN components c ON c.id = t.component_id
                JOIN drawings d ON d.id = c.drawing_id
                JOIN blocks b ON b.id = d.block_id
                JOIN projects p ON p.id = b.project_id
                ${w}`;
  const [total, list] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS n ${base}`).bind(...params).first<{ n: number }>(),
    db
      .prepare(
        `SELECT r.task_id, t.name AS task_name, b.project_id, p.name AS project_name, p.status AS project_status,
                r.revision, r.unattributed_units, r.unallocated_units, r.completed_at, r.seed_attribution, r.updated_at,
                (SELECT COUNT(*) FROM task_allocations a WHERE a.task_id = r.task_id) AS participants,
                (SELECT COUNT(*) FROM task_allocations a WHERE a.task_id = r.task_id AND a.target_units > a.done_units) AS active_participants,
                (SELECT COALESCE(SUM(a.done_units), 0) FROM task_allocations a WHERE a.task_id = r.task_id) AS sum_done_units,
                (SELECT COALESCE(SUM(a.target_units), 0) FROM task_allocations a WHERE a.task_id = r.task_id) AS sum_target_units
           ${base}
          ORDER BY r.updated_at DESC, r.task_id DESC
          LIMIT ? OFFSET ?`,
      )
      .bind(...params, limit, offset)
      .all<RootOverviewRow>(),
  ]);
  return { total: Number(total?.n) || 0, rows: list.results ?? [] };
}
