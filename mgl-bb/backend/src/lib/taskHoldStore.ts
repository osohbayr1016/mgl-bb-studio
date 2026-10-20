/**
 * Таск дээр зарцуулсан өдөр — D1 бичилт/уншилт (migration 0350).
 * Тоолох дүрэм `lib/taskHold.ts`-д (цэвэр).
 *
 * Загвар:
 *   • ОДООГИЙН эзэмшил = `task_assignees.created_at` → өнөөдөр.  Тусад нь
 *     «нээлттэй мөр» хадгалахгүй — тиймээс `task_assignees`-д бичдэг ямар ч
 *     зам (claim, админ оноох, хурлын даалгавар, блок хуулах) автоматаар
 *     тоологдоно.
 *   • ӨНГӨРСӨН эзэмшил = `task_hold_periods`.  `task_assignees` мөр УСТАХЫН
 *     ӨМНӨ `closeHolds()` дуудагдаж тэр мөрийн эхлэлийг хадгална.  Дараа нь
 *     дахин авахад шинэ `task_assignees` мөр шинэ created_at-тай үүснэ →
 *     өмнөх өдрүүд + шинэ өдрүүд = тасралтгүй үргэлжлэл.
 *   ⚠️ `task_assignees`-ийн мөрийг устгаж ДАХИН оруулбал created_at шинэчлэгдэж
 *     өдрийн тоо тэглэгдэнэ — `routes/tasks.ts` `syncTaskAssignees` зөвхөн
 *     өөрчлөгдсөн хүмүүсийг устгадаг.
 *   • ДУУССАН өдрүүд = таскийн батлагдсан `progress_entries` (2026-09-29): 100%
 *     болсон өдрөөс хойш тоологдохгүй (`doneSpans`).  Хариуцагч таскаас гардаггүй
 *     тул эс бөгөөс дууссан таскийн өдөр үүрд өсөж байв.
 */
import { countHoldDays, doneSpans, earliestFrom, holdSpan, type DoneState, type HoldSpan } from './taskHold';
import { orgUtcOffsetMinutes } from './reportWindows';
import { todayInUB } from './time';

/**
 * Таскаас ГАРЧ буй хүмүүсийн эзэмшлийг түүхэнд бичнэ.  `task_assignees` мөрийг
 * устгахаас ӨМНӨ дуудна.  `userIds` өгөөгүй бол таскийн бүх хариуцагч.
 */
export async function closeHolds(
  db: D1Database,
  taskId: number,
  userIds?: readonly number[],
): Promise<void> {
  if (userIds && userIds.length === 0) return;
  const filter = userIds ? ` AND user_id IN (${userIds.map(() => '?').join(',')})` : '';
  try {
    await db
      .prepare(
        `INSERT INTO task_hold_periods (task_id, user_id, started_at, ended_at)
         SELECT task_id, user_id, created_at, datetime('now')
           FROM task_assignees WHERE task_id = ?${filter}`,
      )
      .bind(taskId, ...(userIds ?? []))
      .run();
  } catch (err) {
    // 0350 хэрэгжээгүй орчинд хариуцагч солих үйлдэл УНАХГҮЙ — зөвхөн түүх алдагдана.
    console.error(`[task-hold] closeHolds failed for task ${taskId}:`, err);
  }
}

export interface HoldDaysRow {
  task_id: number;
  user_id: number;
  /** Зарцуулсан ажлын өдөр (өнөөдрийг оролцуулна). */
  days: number;
  /** Одоо ч энэ таскийг эзэмшиж байгаа эсэх. */
  holding: boolean;
  /** Таск одоо 100% бол түүнд хүрсэн өдөр (УБ YYYY-MM-DD) — `days` энэ
   *  өдрөөр зогссон.  Дуусаагүй бол null. */
  done_on: string | null;
}

export type HoldScope = { projectId: number } | { userId: number } | { taskId: number };

/**
 * `where` — эзэмшлийн хүснэгтүүдийн (task_assignees / task_hold_periods) шүүлт;
 * `taskWhere` — ижил хүрээний таскуудын шүүлт, `task_id` баганатай ямар ч
 * хүснэгтэд (progress_entries) — `user_id = ?` бичлэг илгээгчийг шүүх байсан.
 * Хоёулаа ганц `?`-тэй.
 */
function scopeSql(scope: HoldScope): { where: string; taskWhere: string; bind: number } {
  if ('projectId' in scope) {
    const where = `task_id IN (SELECT t.id FROM tasks t
                 JOIN components co ON co.id = t.component_id
                 JOIN drawings d ON d.id = co.drawing_id
                 JOIN blocks b ON b.id = d.block_id
                WHERE b.project_id = ?)`;
    return { where, taskWhere: where, bind: scope.projectId };
  }
  if ('userId' in scope) {
    return {
      where: 'user_id = ?',
      taskWhere: `task_id IN (SELECT task_id FROM task_assignees WHERE user_id = ?1
                     UNION SELECT task_id FROM task_hold_periods WHERE user_id = ?1)`,
      bind: scope.userId,
    };
  }
  return { where: 'task_id = ?', taskWhere: 'task_id = ?', bind: scope.taskId };
}

/** Хүрээний таск бүрийн дууссан өдрүүд (`lib/taskHold.ts` `doneSpans`). */
async function loadDoneStates(db: D1Database, taskWhere: string, bind: number): Promise<Map<number, DoneState>> {
  const res = await db
    .prepare(
      `SELECT task_id, date, percentage FROM progress_entries
        WHERE status = 'approved' AND ${taskWhere}
        ORDER BY task_id, created_at, id`,
    )
    .bind(bind)
    .all<{ task_id: number; date: string; percentage: number }>()
    .catch((err: unknown) => {
      // Уншиж чадахгүй бол хуучин зан төлөв (өнөөдөр хүртэл тоолно) — хуудас унахгүй.
      console.error('[task-hold] progress entries read failed:', err);
      return { results: [] as { task_id: number; date: string; percentage: number }[] };
    });
  const byTask = new Map<number, { date: string; percentage: number }[]>();
  for (const r of res.results ?? []) {
    let list = byTask.get(r.task_id);
    if (!list) byTask.set(r.task_id, (list = []));
    list.push(r);
  }
  const out = new Map<number, DoneState>();
  for (const [taskId, points] of byTask) {
    const state = doneSpans(points);
    if (state.spans.length > 0) out.set(taskId, state);
  }
  return out;
}

/** Хүрээний (таск, хүн) хос бүрийн зарцуулсан ажлын өдөр. */
export async function loadHoldDays(db: D1Database, scope: HoldScope): Promise<HoldDaysRow[]> {
  const { where, taskWhere, bind } = scopeSql(scope);
  const [current, past, done] = await Promise.all([
    db
      .prepare(`SELECT task_id, user_id, created_at FROM task_assignees WHERE ${where}`)
      .bind(bind)
      .all<{ task_id: number; user_id: number; created_at: string }>(),
    db
      .prepare(`SELECT task_id, user_id, started_at, ended_at FROM task_hold_periods WHERE ${where}`)
      .bind(bind)
      .all<{ task_id: number; user_id: number; started_at: string; ended_at: string }>()
      .catch(() => ({ results: [] as { task_id: number; user_id: number; started_at: string; ended_at: string }[] })),
    loadDoneStates(db, taskWhere, bind),
  ]);

  const today = todayInUB();
  const offset = orgUtcOffsetMinutes();
  const groups = new Map<string, { task_id: number; user_id: number; spans: HoldSpan[]; holding: boolean }>();
  const groupOf = (taskId: number, userId: number) => {
    const key = `${taskId}:${userId}`;
    let g = groups.get(key);
    if (!g) {
      g = { task_id: taskId, user_id: userId, spans: [], holding: false };
      groups.set(key, g);
    }
    return g;
  };
  for (const r of current.results) {
    const g = groupOf(r.task_id, r.user_id);
    g.holding = true;
    const span = holdSpan(r.created_at, null, today, offset);
    if (span) g.spans.push(span);
  }
  for (const r of past.results) {
    const span = holdSpan(r.started_at, r.ended_at, today, offset);
    if (span) groupOf(r.task_id, r.user_id).spans.push(span);
  }
  if (groups.size === 0) return [];

  const allSpans = [...groups.values()].flatMap((g) => g.spans);
  const from = earliestFrom(allSpans) ?? today;
  const holidayRows = await db
    .prepare('SELECT date FROM holidays WHERE date >= ? AND date <= ?')
    .bind(from, today)
    .all<{ date: string }>()
    .catch(() => ({ results: [] as { date: string }[] }));
  const holidays = new Set(holidayRows.results.map((h) => h.date));

  return [...groups.values()].map((g) => {
    const state = done.get(g.task_id);
    return {
      task_id: g.task_id,
      user_id: g.user_id,
      days: countHoldDays(g.spans, holidays, state?.spans),
      holding: g.holding,
      done_on: state?.doneOn ?? null,
    };
  });
}
