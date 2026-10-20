/**
 * ТАСКИЙН ХУВААРИЛТ — ӨГӨГДЛИЙН ИНВАРИАНТЫН АУДИТОР (2026-10-05, зөвхөн УНШИХ).
 *
 * Release-ийн хаалга: «paused» дээр хөрвүүлж, аудитыг ажиллуулж, `errors === 0` болсны ДАРАА л идэвхжүүлнэ.  Мөн
 * цаашид тогтмол (cron биш — менежер/админ дуудна) ажиллуулж, чимээгүй гэмтлийг барина.
 *
 * Шалгалт бүр SET-BASED (ажилтан/root тутамд дуудлагагүй) тул бүх root дээр хэдхэн асуулгаар явна.
 *
 *   ERROR (оноо/явцыг буруу харуулна — шийдэх хүртэл идэвхжүүлэхгүй):
 *     ROOT_SUM_NOT_100        Σ T + B + U ≠ 100%
 *     ROOT_DONE_OVER_100      Σ D + B > 100%
 *     ALLOC_BOUNDS            0 ≤ L ≤ D ≤ T зөрчигдсөн (CHECK-ийг тойруулсан/хуучин өгөгдөл)
 *     COMPLETED_FLAG          completed_at ↔ root 100% таарахгүй (completed_at бий, гэвч < 100%)
 *     PROJECTION_MISMATCH     таскийн сүүлийн батлагдсан явц ≠ root-ийн Σ D + B (үндсэн ажлын %)
 *     DONE_JOURNAL_MISMATCH   хүний D ≠ тэр хүний нээлттэй слайсуудын нийлбэр
 *     ORPHAN_SLICES_EXCEED_B  хуваарилалтгүй (устгагдсан/салсан) хүний нээлттэй слайс > эзэнгүй B
 *     CREDIT_LEDGER_MISMATCH  хүний журналд холбогдсон user_points (+ seed-ийн хуучин оноо) ≠ нээлттэй слайсуудын credit_open
 *     ORPHAN_ALLOCATION       task_roots-гүй хуваарилалт/журнал
 *     ROOT_TASK_MISSING       root-ийн таск (tasks) устсан
 *     POST_COMMIT_FAILED      commit-ийн дараах үр дагавар 8 оролдлогод биелээгүй (гараар шийднэ)
 *     CREDIT_RECONCILE_FAILED жин засварын дараах онооны тулгалт 8 оролдлогод биелээгүй (0402; админ reweight)
 *     CONVERSION_ROOT_MISSING root нь task_roots-д байхгүй хөрвүүлэлт
 *     CONVERSION_RETIRED_ACTIVE нэгтгэгдсэн хэсэг жинтэй болсон / root болсон / устсан (давхар тоолно)
 *     PARTS_OVER_FREE         хүнгүй хэсгүүдийн (0394) нийлбэр > хуваарилагдаагүй ажил U, эсвэл root-гүй хэсэг
 *   WARN (анхаарах, гэхдээ тоо буруу биш):
 *     COMPLETED_FLAG_MISSING  root 100% боловч completed_at хоосон
 *     POST_COMMIT_STUCK       10+ минут `pending` (cron дахин ажиллуулна)
 *     FUTURE_WORK_INACTIVE    ирээдүйн ажил (T > D) идэвхгүй/устсан хүн дээр гацсан
 *     CREDIT_DRIFT            (deep) одоогийн жин/төвөгшлөөр тулгахад оноо зөрөх — reweight хэрэгтэй
 *     CONVERSION_ROOT_WEIGHT_CHANGED хөрвүүлэлтийн дараа root-ийн жин засагдсан (оноо reweight хийгдсэн эсэхийг шалга)
 *
 * Хариу нь тоо + хязгаартай жагсаалт (`limit`, өгөгдмөл 500): код тус бүрийн ТОО бүхэлдээ, жагсаалт хэсэгчилсэн.
 */
import { ROOT_TOTAL_UNITS, UNITS_PER_POINT } from './taskUnits';
import { chunked } from './taskRootStore';

export type AuditSeverity = 'error' | 'warn';

export interface AuditFinding {
  severity: AuditSeverity;
  code: string;
  task_id: number | null;
  user_id?: number | null;
  message: string;
  detail?: Record<string, unknown>;
}

export interface AuditReport {
  ok: boolean;
  generated_at: string;
  scope: { task_id: number | null; project_id: number | null; deep: boolean; limit: number };
  roots_checked: number;
  errors: number;
  warnings: number;
  counts: Record<string, number>;
  findings: AuditFinding[];
  truncated: boolean;
}

export interface AuditOptions {
  taskId?: number | null;
  projectId?: number | null;
  /** Одоогийн жин/төвөгшлөөр оноо тулгах (удаан: root тутамд журнал уншина). */
  deep?: boolean;
  /** `deep` үед шалгах root-ийн дээд тоо. */
  deepLimit?: number;
  limit?: number;
  /** `pending`-ийг «гацсан» гэж үзэх минут. */
  stuckMinutes?: number;
}

const EPS = 1e-6;
const SEVERITY: Record<string, AuditSeverity> = {
  ROOT_SUM_NOT_100: 'error',
  ROOT_DONE_OVER_100: 'error',
  ALLOC_BOUNDS: 'error',
  COMPLETED_FLAG: 'error',
  PROJECTION_MISMATCH: 'error',
  DONE_JOURNAL_MISMATCH: 'error',
  ORPHAN_SLICES_EXCEED_B: 'error',
  CREDIT_LEDGER_MISMATCH: 'error',
  ORPHAN_ALLOCATION: 'error',
  ROOT_TASK_MISSING: 'error',
  POST_COMMIT_FAILED: 'error',
  CREDIT_RECONCILE_FAILED: 'error',
  CONVERSION_ROOT_MISSING: 'error',
  CONVERSION_RETIRED_ACTIVE: 'error',
  PARTS_OVER_FREE: 'error',
  CONVERSION_ROOT_WEIGHT_CHANGED: 'warn',
  COMPLETED_FLAG_MISSING: 'warn',
  POST_COMMIT_STUCK: 'warn',
  FUTURE_WORK_INACTIVE: 'warn',
  CREDIT_DRIFT: 'warn',
};

const pct = (units: number): number => units / UNITS_PER_POINT;

/** Хамрах хүрээний нөхцөл: `r` нь task_roots-ийн alias.  Bind: (taskId | projectId). */
function scopeSql(o: AuditOptions): { where: string; binds: number[] } {
  if (o.taskId) return { where: 'AND r.task_id = ?', binds: [o.taskId] };
  if (o.projectId) {
    return {
      where: `AND r.task_id IN (SELECT t.id FROM tasks t
                                  JOIN components c ON c.id = t.component_id
                                  JOIN drawings d ON d.id = c.drawing_id
                                  JOIN blocks b ON b.id = d.block_id
                                 WHERE b.project_id = ?)`,
      binds: [o.projectId],
    };
  }
  return { where: '', binds: [] };
}

export async function auditTaskAllocations(db: D1Database, opts: AuditOptions = {}): Promise<AuditReport> {
  const limit = Math.max(1, Math.min(2000, opts.limit ?? 500));
  const stuckMinutes = Math.max(1, opts.stuckMinutes ?? 10);
  const scope = scopeSql(opts);
  const findings: AuditFinding[] = [];
  const counts: Record<string, number> = {};
  const add = (code: string, taskId: number | null, message: string, extra: { userId?: number | null; detail?: Record<string, unknown> } = {}): void => {
    counts[code] = (counts[code] ?? 0) + 1;
    if (findings.length < limit) {
      findings.push({
        severity: SEVERITY[code] ?? 'error',
        code,
        task_id: taskId,
        ...(extra.userId !== undefined ? { user_id: extra.userId } : {}),
        message,
        ...(extra.detail ? { detail: extra.detail } : {}),
      });
    }
  };

  // ── 1. Root бүрийн нийлбэр, хязгаар, projection ──────────────────────────────────────────────
  const { results: roots } = await db
    .prepare(
      `SELECT r.task_id, r.unattributed_units AS b, r.unallocated_units AS u, r.completed_at,
              COALESCE(SUM(a.target_units), 0) AS sum_t,
              COALESCE(SUM(a.done_units), 0)   AS sum_d,
              COALESCE(SUM(CASE WHEN a.floor_units > a.done_units OR a.done_units > a.target_units
                                  OR a.floor_units < 0 THEN 1 ELSE 0 END), 0) AS bad_alloc,
              (SELECT COUNT(*) FROM tasks t WHERE t.id = r.task_id) AS task_exists,
              (SELECT pe.percentage FROM progress_entries pe
                WHERE pe.task_id = r.task_id AND pe.status = 'approved'
                ORDER BY pe.created_at DESC, pe.id DESC LIMIT 1) AS latest_pct
         FROM task_roots r
         LEFT JOIN task_allocations a ON a.task_id = r.task_id
        WHERE 1 = 1 ${scope.where}
        GROUP BY r.task_id
        ORDER BY r.task_id`,
    )
    .bind(...scope.binds)
    .all<{
      task_id: number;
      b: number;
      u: number;
      completed_at: string | null;
      sum_t: number;
      sum_d: number;
      bad_alloc: number;
      task_exists: number;
      latest_pct: number | null;
    }>();
  const rootRows = roots ?? [];
  const bByTask = new Map<number, number>();
  for (const r of rootRows) {
    bByTask.set(r.task_id, r.b);
    if (r.task_exists === 0) add('ROOT_TASK_MISSING', r.task_id, 'Root-ийн таск (tasks) байхгүй — өнчин root');
    if (r.sum_t + r.b + r.u !== ROOT_TOTAL_UNITS) {
      add('ROOT_SUM_NOT_100', r.task_id, `Σ T + B + U = ${pct(r.sum_t + r.b + r.u)}% (100% байх ёстой)`, {
        detail: { sum_t: r.sum_t, b: r.b, u: r.u },
      });
    }
    const rootDone = r.sum_d + r.b;
    if (rootDone > ROOT_TOTAL_UNITS) add('ROOT_DONE_OVER_100', r.task_id, `Σ D + B = ${pct(rootDone)}% (> 100%)`, { detail: { sum_d: r.sum_d, b: r.b } });
    if (r.bad_alloc > 0) add('ALLOC_BOUNDS', r.task_id, `${r.bad_alloc} хуваарилалт 0 ≤ L ≤ D ≤ T зөрчсөн`);
    if (r.completed_at !== null && rootDone < ROOT_TOTAL_UNITS) {
      add('COMPLETED_FLAG', r.task_id, `completed_at бий, гэвч root ${pct(rootDone)}%`, { detail: { completed_at: r.completed_at } });
    }
    if (r.completed_at === null && rootDone === ROOT_TOTAL_UNITS) {
      add('COMPLETED_FLAG_MISSING', r.task_id, 'Root 100% боловч completed_at хоосон');
    }
    // Projection: сүүлийн батлагдсан явц = үндсэн ажлын хийсэн % (нэгжийн нарийвчлалаар).
    if (r.latest_pct === null) {
      if (rootDone > 0) add('PROJECTION_MISMATCH', r.task_id, `Root ${pct(rootDone)}% боловч батлагдсан явцын бичлэг алга`, { detail: { expected: pct(rootDone), actual: null } });
    } else if (Math.abs(r.latest_pct * UNITS_PER_POINT - rootDone) > 0.5) {
      add('PROJECTION_MISMATCH', r.task_id, `Таскийн сүүлийн явц ${r.latest_pct}% ≠ root ${pct(rootDone)}%`, {
        detail: { expected: pct(rootDone), actual: r.latest_pct },
      });
    }
  }

  // ── 1b. Хүнгүй хэсгүүд (0394): Σ хэсэг ≤ U, root-гүй хэсэг байхгүй.  Хүснэгт хараахан байхгүй орчинд алгасна. ──
  try {
    const { results: partSums } = await db
      .prepare(
        `SELECT p.task_id, SUM(p.units) AS reserved, r.unallocated_units AS u
           FROM task_parts p
           LEFT JOIN task_roots r ON r.task_id = p.task_id
          WHERE 1 = 1 ${scope.where.replaceAll('r.task_id', 'p.task_id')}
          GROUP BY p.task_id
         HAVING r.task_id IS NULL OR SUM(p.units) > r.unallocated_units`,
      )
      .bind(...scope.binds)
      .all<{ task_id: number; reserved: number; u: number | null }>();
    for (const r of partSums ?? []) {
      add(
        'PARTS_OVER_FREE',
        r.task_id,
        r.u === null ? 'Root-гүй хүнгүй хэсэг (өнчин)' : `Хүнгүй хэсгүүд ${pct(r.reserved)}% > хуваарилагдаагүй ${pct(r.u)}%`,
        { detail: { reserved: r.reserved, u: r.u } },
      );
    }
  } catch (err) {
    if (!String(err).includes('no such table')) throw err;
  }

  // ── 2. Хүний D ба нээлттэй слайсуудын нийлбэр ─────────────────────────────────────────────────
  const { results: doneMismatch } = await db
    .prepare(
      `SELECT a.task_id, a.user_id, a.done_units, COALESCE(SUM(k.units_open), 0) AS open_units
         FROM task_allocations a
         JOIN task_roots r ON r.task_id = a.task_id
         LEFT JOIN task_contributions k
                ON k.task_id = a.task_id AND k.user_id = a.user_id AND k.kind IN ('work', 'seed')
        WHERE 1 = 1 ${scope.where}
        GROUP BY a.task_id, a.user_id, a.done_units
       HAVING a.done_units <> COALESCE(SUM(k.units_open), 0)
        ORDER BY a.task_id, a.user_id`,
    )
    .bind(...scope.binds)
    .all<{ task_id: number; user_id: number; done_units: number; open_units: number }>();
  for (const x of doneMismatch ?? []) {
    add('DONE_JOURNAL_MISMATCH', x.task_id, `Хүн ${x.user_id}: D=${pct(x.done_units)}% ≠ журналын нээлттэй ${pct(x.open_units)}%`, {
      userId: x.user_id,
      detail: { done_units: x.done_units, open_units: x.open_units },
    });
  }

  // ── 3. Хуваарилалтгүй хүний нээлттэй слайс ≤ B ───────────────────────────────────────────────
  const { results: orphanSlices } = await db
    .prepare(
      `SELECT k.task_id, SUM(k.units_open) AS open_units
         FROM task_contributions k
         JOIN task_roots r ON r.task_id = k.task_id
        WHERE k.kind IN ('work', 'seed') AND k.units_open > 0
          AND NOT EXISTS (SELECT 1 FROM task_allocations a WHERE a.task_id = k.task_id AND a.user_id = k.user_id)
          ${scope.where}
        GROUP BY k.task_id`,
    )
    .bind(...scope.binds)
    .all<{ task_id: number; open_units: number }>();
  for (const x of orphanSlices ?? []) {
    const b = bByTask.get(x.task_id) ?? 0;
    if (x.open_units > b) {
      add('ORPHAN_SLICES_EXCEED_B', x.task_id, `Хуваарилалтгүй хүний нээлттэй слайс ${pct(x.open_units)}% > эзэнгүй B ${pct(b)}%`, {
        detail: { open_units: x.open_units, b },
      });
    }
  }

  // ── 4. Журналд холбогдсон оноо ба нээлттэй слайсын credit ─────────────────────────────────────
  const { results: credit } = await db
    .prepare(
      `SELECT k.task_id, k.user_id,
              SUM(k.credit_open_amount)    AS open_amt,
              SUM(k.credit_open_delta_pct) AS open_dp,
              (SELECT COALESCE(SUM(up.amount), 0) FROM user_points up
                WHERE up.user_id = k.user_id AND up.source = 'progress'
                  AND ((up.task_id = k.task_id AND up.contribution_id IS NOT NULL)
                       OR up.id IN (SELECT k2.points_id FROM task_contributions k2
                                     WHERE k2.task_id = k.task_id AND k2.user_id = k.user_id AND k2.kind = 'seed'
                                       AND k2.points_id IS NOT NULL))) AS pts_amt,
              (SELECT COALESCE(SUM(up.delta_pct), 0) FROM user_points up
                WHERE up.user_id = k.user_id AND up.source = 'progress'
                  AND ((up.task_id = k.task_id AND up.contribution_id IS NOT NULL)
                       OR up.id IN (SELECT k2.points_id FROM task_contributions k2
                                     WHERE k2.task_id = k.task_id AND k2.user_id = k.user_id AND k2.kind = 'seed'
                                       AND k2.points_id IS NOT NULL))) AS pts_dp
         FROM task_contributions k
         JOIN task_roots r ON r.task_id = k.task_id
        WHERE k.kind IN ('work', 'seed') ${scope.where}
        GROUP BY k.task_id, k.user_id
        ORDER BY k.task_id, k.user_id`,
    )
    .bind(...scope.binds)
    .all<{ task_id: number; user_id: number; open_amt: number; open_dp: number; pts_amt: number; pts_dp: number }>();
  for (const x of credit ?? []) {
    if (Math.abs(x.open_amt - x.pts_amt) > EPS || Math.abs(x.open_dp - x.pts_dp) > EPS) {
      add('CREDIT_LEDGER_MISMATCH', x.task_id, `Хүн ${x.user_id}: журналын оноо ${x.open_amt} ≠ user_points ${x.pts_amt}`, {
        userId: x.user_id,
        detail: { open_amount: x.open_amt, points_amount: x.pts_amt, open_delta_pct: x.open_dp, points_delta_pct: x.pts_dp },
      });
    }
  }

  // ── 5. Өнчин хуваарилалт / журнал (root-гүй) ─────────────────────────────────────────────────
  if (!opts.taskId && !opts.projectId) {
    const { results: orphans } = await db
      .prepare(
        `SELECT task_id, SUM(n) AS n FROM (
           SELECT task_id, COUNT(*) AS n FROM task_allocations
            WHERE task_id NOT IN (SELECT task_id FROM task_roots) GROUP BY task_id
           UNION ALL
           SELECT task_id, COUNT(*) AS n FROM task_contributions
            WHERE task_id NOT IN (SELECT task_id FROM task_roots) GROUP BY task_id
         ) GROUP BY task_id ORDER BY task_id`,
      )
      .all<{ task_id: number; n: number }>();
    for (const x of orphans ?? []) add('ORPHAN_ALLOCATION', x.task_id, `Root-гүй ${x.n} хуваарилалт/журналын мөр`, { detail: { rows: x.n } });
  }

  // ── 6. Commit-ийн дараах үр дагавар ───────────────────────────────────────────────────────────
  const { results: stuck } = await db
    .prepare(
      `SELECT o.request_id, o.task_id, o.post_status, o.post_attempts, o.post_error, o.created_at,
              (julianday('now') - julianday(o.created_at)) * 1440.0 AS age_min
         FROM task_ops o
         JOIN task_roots r ON r.task_id = o.task_id
        WHERE o.post_status <> 'done' ${scope.where}
        ORDER BY o.created_at`,
    )
    .bind(...scope.binds)
    .all<{ request_id: string; task_id: number; post_status: string; post_attempts: number; post_error: string | null; created_at: string; age_min: number }>();
  for (const x of stuck ?? []) {
    if (x.post_status === 'failed') {
      add('POST_COMMIT_FAILED', x.task_id, `Commit-ийн дараах үр дагавар биелсэнгүй (${x.post_attempts} оролдлого): ${x.post_error ?? '?'}`, {
        detail: { request_id: x.request_id },
      });
    } else if (x.age_min >= stuckMinutes) {
      add('POST_COMMIT_STUCK', x.task_id, `Үр дагавар ${Math.round(x.age_min)} минут pending (оролдлого ${x.post_attempts})`, { detail: { request_id: x.request_id } });
    }
  }

  // ── 6b. Жин засварын дараах онооны тулгалт 8 оролдлогод биелээгүй (0402) ──────────────────────────────
  {
    const q = opts.taskId
      ? { where: "AND kind = 'task' AND target_id = ?", binds: [opts.taskId] }
      : opts.projectId
        ? { where: "AND kind = 'project' AND target_id = ?", binds: [opts.projectId] }
        : { where: '', binds: [] as number[] };
    const { results: rec } = await db
      .prepare(
        `SELECT kind, target_id, attempts, last_error, updated_at FROM task_credit_reconcile_queue
          WHERE status = 'failed' ${q.where} ORDER BY updated_at`,
      )
      .bind(...q.binds)
      .all<{ kind: string; target_id: number; attempts: number; last_error: string | null; updated_at: string }>()
      .catch(() => ({ results: [] as Array<{ kind: string; target_id: number; attempts: number; last_error: string | null; updated_at: string }> }));
    for (const x of rec ?? []) {
      add(
        'CREDIT_RECONCILE_FAILED',
        x.kind === 'task' ? x.target_id : null,
        `Онооны тулгалт биелсэнгүй (${x.kind === 'task' ? 'таск' : 'төсөл'} #${x.target_id}, ${x.attempts} оролдлого): ${x.last_error ?? '?'}`,
        { detail: { kind: x.kind, target_id: x.target_id } },
      );
    }
  }

  // ── 7. Идэвхгүй хүн дээр гацсан ирээдүйн ажил ─────────────────────────────────────────────────
  const { results: inactive } = await db
    .prepare(
      `SELECT a.task_id, a.user_id, a.target_units - a.done_units AS future_units, u.status
         FROM task_allocations a
         JOIN task_roots r ON r.task_id = a.task_id
         LEFT JOIN users u ON u.id = a.user_id
        WHERE a.target_units > a.done_units AND (u.id IS NULL OR u.status <> 'active') ${scope.where}
        ORDER BY a.task_id, a.user_id`,
    )
    .bind(...scope.binds)
    .all<{ task_id: number; user_id: number; future_units: number; status: string | null }>();
  for (const x of inactive ?? []) {
    add('FUTURE_WORK_INACTIVE', x.task_id, `Хүн ${x.user_id} (${x.status ?? 'устсан'}) дээр ${pct(x.future_units)}% ирээдүйн ажил гацсан`, {
      userId: x.user_id,
      detail: { future_units: x.future_units },
    });
  }

  // ── 8a. Хөрвүүлэлтийн журнал (0385): root, нэгтгэгдсэн хэсгүүд эрүүл ─────────────────────────────
  try {
    const convScope = opts.taskId
      ? { where: 'AND c.root_task_id = ?', binds: [opts.taskId] }
      : opts.projectId
        ? { where: 'AND c.project_id = ?', binds: [opts.projectId] }
        : { where: '', binds: [] as number[] };
    const { results: conv } = await db
      .prepare(
        `SELECT c.id, c.root_task_id,
                (SELECT COUNT(*) FROM task_roots r WHERE r.task_id = c.root_task_id) AS root_ok,
                (SELECT t.weight_percent FROM tasks t WHERE t.id = c.root_task_id) AS root_w,
                (SELECT m.weight_after FROM task_conversion_members m WHERE m.task_id = c.root_task_id) AS root_w_after,
                (SELECT COUNT(*) FROM task_conversion_members m
                   LEFT JOIN tasks t ON t.id = m.task_id
                  WHERE m.conversion_id = c.id AND m.role = 'retired'
                    AND (t.id IS NULL OR t.weight_percent <> 0
                         OR EXISTS (SELECT 1 FROM task_roots r2 WHERE r2.task_id = m.task_id))) AS bad_retired
           FROM task_conversions c
          WHERE c.status = 'applied' ${convScope.where}
          ORDER BY c.created_at, c.id`,
      )
      .bind(...convScope.binds)
      .all<{ id: string; root_task_id: number; root_ok: number; root_w: number | null; root_w_after: number | null; bad_retired: number }>();
    for (const x of conv ?? []) {
      if (x.root_ok === 0) add('CONVERSION_ROOT_MISSING', x.root_task_id, `Хөрвүүлэлт ${x.id}: root (task_roots) байхгүй`, { detail: { conversion_id: x.id } });
      if (x.bad_retired > 0) {
        add('CONVERSION_RETIRED_ACTIVE', x.root_task_id, `Хөрвүүлэлт ${x.id}: ${x.bad_retired} нэгтгэгдсэн хэсэг жинтэй/root болсон/устсан`, {
          detail: { conversion_id: x.id, count: x.bad_retired },
        });
      }
      if (x.root_w !== null && x.root_w_after !== null && Math.abs(x.root_w - x.root_w_after) > 1e-9) {
        add('CONVERSION_ROOT_WEIGHT_CHANGED', x.root_task_id, `Хөрвүүлэлт ${x.id}: root-ийн жин ${x.root_w_after} → ${x.root_w} болсон (оноог дахин тулгасан эсэхийг шалга)`, {
          detail: { conversion_id: x.id },
        });
      }
    }
  } catch (err) {
    // 0385 хараахан хэрэгжээгүй орчин — хөрвүүлэлт байхгүй.
    if (!/no such table:\s*task_conversion/i.test(String((err as Error)?.message ?? err))) throw err;
  }

  // ── 8. (deep) одоогийн жин/төвөгшлөөр оноо тулгах ─────────────────────────────────────────────
  if (opts.deep) {
    const { previewTaskReweight } = await import('./taskCreditReweight');
    const ids = rootRows.map((r) => r.task_id).slice(0, Math.max(1, opts.deepLimit ?? 200));
    for (const group of chunked(ids, 20)) {
      const previews = await Promise.all(group.map((id) => previewTaskReweight(db, id).catch(() => null)));
      previews.forEach((p, i) => {
        if (p && p.items.length > 0) {
          add('CREDIT_DRIFT', group[i]!, `Одоогийн жин/төвөгшлөөр ${p.items.length} слайсын оноо зөрнө`, {
            detail: { items: p.items.length },
          });
        }
      });
    }
  }

  const errors = Object.entries(counts).reduce((s, [code, n]) => s + (SEVERITY[code] === 'warn' ? 0 : n), 0);
  const warnings = Object.entries(counts).reduce((s, [code, n]) => s + (SEVERITY[code] === 'warn' ? n : 0), 0);
  return {
    ok: errors === 0,
    generated_at: new Date().toISOString(),
    scope: { task_id: opts.taskId ?? null, project_id: opts.projectId ?? null, deep: opts.deep === true, limit },
    roots_checked: rootRows.length,
    errors,
    warnings,
    counts,
    findings,
    truncated: Object.values(counts).reduce((s, n) => s + n, 0) > findings.length,
  };
}
