/**
 * «ТАСКИЙГ БУЦААХ» (эзэн 2026-10-05, migration 0386) — буруу таск авч буруу хувь оруулсан хүн тэр таскийг «би үүн дээр юу ч
 * хийгээгүй» болгоно.
 *
 *   • миний оруулсан явцын бичлэг (`progress_entries`) + тэдгээрээс олгогдсон оноо (`user_points`) УСТАНА — архив нь
 *     `task_retractions` (entries_json / points_json);
 *   • би таскийн нэр, «Миний ажлууд», хувь нэмэрчийн жагсаалтаас алга болно (`task_assignees`, `assigned_to`, хувийн жагсаалт
 *     (хассан тэмдэгтэй), «миний хэсэг дууссан», хувийн checklist);
 *   • явж буй албан таймер ЗОГСООНО, харин СЭШН (цаг) УСТАХГҮЙ — систем цагийг үргэлжлүүлэн хэмжинэ (албан таймерын админ
 *     тайлан хэвээр), дахин авбал хуучин цаг дээрээ нэмэгдэнэ.  Таск талын харагдацууд (`lib/taskContributors.ts`, `/task-timer/state`
 *     таскийн нийт) `retracted_at`-аас ӨМНӨ эхэлсэн сэшнийг харуулахгүй — `notRetractedSql`.
 *
 * Зөвхөн энгийн (хуваарилагдаагүй) `tasks`-горимын таск.  Хуваарилагдсан (managed) таскийн бүртгэлийг «⋯ → Миний бүртгэл»
 * (`correctOwnProgress`) засна — хоёр систем (журнал ↔ шууд бичлэг) хольж болохгүй.  Цагаар бодогддог (`hours`) төсөл ХАМААРАХГҮЙ.
 * Бусдын бичлэг, оноо, цаг ХЭЗЭЭ Ч хөндөгдөхгүй.
 */
import { latestApprovedPctByCreatedAt } from './progressLatest';
import { pauseOfficialTimer } from './taskTimerStore';

/** Тухайн таск дээрх МИНИЙ оруулсан явцын бичлэгүүд — системийн (хуваалт, хуваарилалт), менежерийн baseline бичлэг БИШ. */
const MINE_ENTRIES = `task_id = ?1 AND user_id = ?2 AND COALESCE(is_baseline, 0) = 0
                      AND COALESCE(source, 'web') NOT IN ('split', 'alloc', 'alloc_adj')`;

// Таск талын харагдацаас «буцаасан» сэшнийг хасах нөхцөл `notRetractedSql` нь `taskTimerStore.ts`-д (циклээс зайлсхийж) —
// `taskContributors.ts` өөрийн хуулбартай (`NOT_RETRACTED`).  Хоёр хуулбар ЯГ ИЖИЛ байх ёстой.

export type RetractFailure =
  | { ok: false; status: 404 | 409; error: string; message: string };

export interface RetractResult {
  ok: true;
  task_id: number;
  removed_entries: number;
  removed_points: number;
  progress_before: number;
  progress_after: number;
  timer_stopped: boolean;
}

export async function retractMyTask(
  db: D1Database,
  p: { userId: number; taskId: number; requestId: string; now?: Date },
): Promise<RetractResult | RetractFailure> {
  const facts = await db
    .prepare(
      `SELECT pr.status AS project_status, pr.progress_mode AS progress_mode
         FROM tasks t
         JOIN components c ON c.id = t.component_id
         JOIN drawings d ON d.id = c.drawing_id
         JOIN blocks b ON b.id = d.block_id
         JOIN projects pr ON pr.id = b.project_id
        WHERE t.id = ?1`,
    )
    .bind(p.taskId)
    .first<{ project_status: string; progress_mode: string | null }>();
  if (!facts) return { ok: false, status: 404, error: 'TASK_NOT_FOUND', message: 'Таск олдсонгүй' };
  // `task_roots` (0376) байхгүй орчин — managed биш гэж үзнэ.
  const managed = await db
    .prepare('SELECT 1 AS x FROM task_roots WHERE task_id = ?1')
    .bind(p.taskId)
    .first<{ x: number }>()
    .catch(() => null);
  if (managed) {
    return {
      ok: false,
      status: 409,
      error: 'MANAGED_ROOT',
      message: 'Хуваарилагдсан таскийн бүртгэлийг «⋯ → Миний бүртгэл» цэснээс засна.',
    };
  }
  if (facts.progress_mode === 'hours') {
    return {
      ok: false,
      status: 409,
      error: 'HOURS_PROGRESS',
      message: 'Цагаар бодогддог засварын таскт «Буцаах» хамаарахгүй — цаг нь системээс хуваарилагддаг.',
    };
  }
  if (facts.project_status !== 'active') {
    return { ok: false, status: 409, error: 'PROJECT_INACTIVE', message: 'Төсөл идэвхгүй тул таскийг буцаах боломжгүй.' };
  }

  const before = await db
    .prepare(`SELECT COALESCE(${latestApprovedPctByCreatedAt('t.id')}, 0) AS pct FROM tasks t WHERE t.id = ?1`)
    .bind(p.taskId)
    .first<{ pct: number }>();

  // 1) Явж буй таймерыг ЗОГСООНО (сэшн хэвээр) — `retracted_at` нь сэшний төгсгөлөөс бага байж болохгүй.
  const now = p.now ?? new Date();
  const nowIso = now.toISOString();
  const stopped = await pauseOfficialTimer(db, {
    userId: p.userId,
    actorId: p.userId,
    nowIso,
    requestId: `retract:${p.requestId}`,
    taskId: p.taskId,
  });

  // 2) Архивлах мөрүүдийг уншина (устахаас ӨМНӨ).
  const [entries, points] = await Promise.all([
    db
      .prepare(`SELECT * FROM progress_entries WHERE ${MINE_ENTRIES}`)
      .bind(p.taskId, p.userId)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT * FROM user_points
          WHERE progress_entry_id IN (SELECT id FROM progress_entries WHERE ${MINE_ENTRIES})`,
      )
      .bind(p.taskId, p.userId)
      .all<Record<string, unknown>>(),
  ]);
  const entryRows = entries.results ?? [];
  const pointRows = points.results ?? [];

  // 3) НЭГ атомар batch: архив → оноо → бичлэг → «би энэ таск дээр ажиллаагүй» (нэр, жагсаалт, тэмдэглэгээ).
  await db.batch([
    db
      .prepare(
        `INSERT INTO task_retractions
           (task_id, user_id, retracted_at, entries_json, points_json, progress_before)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      )
      .bind(p.taskId, p.userId, nowIso, JSON.stringify(entryRows), JSON.stringify(pointRows), before?.pct ?? 0),
    // user_points.progress_entry_id → ON DELETE SET NULL тул оноог бичлэгээс ӨМНӨ устгана (эс бөгөөс өнчин оноо үлдэнэ).
    db
      .prepare(`DELETE FROM user_points WHERE progress_entry_id IN (SELECT id FROM progress_entries WHERE ${MINE_ENTRIES})`)
      .bind(p.taskId, p.userId),
    db.prepare(`DELETE FROM progress_entries WHERE ${MINE_ENTRIES}`).bind(p.taskId, p.userId),
    db.prepare('DELETE FROM task_assignees WHERE task_id = ?1 AND user_id = ?2').bind(p.taskId, p.userId),
    db.prepare('UPDATE tasks SET assigned_to = NULL WHERE id = ?1 AND assigned_to = ?2').bind(p.taskId, p.userId),
    db.prepare('DELETE FROM task_self_done WHERE task_id = ?1 AND user_id = ?2').bind(p.taskId, p.userId),
    db.prepare('DELETE FROM task_checklist_items WHERE task_id = ?1 AND user_id = ?2').bind(p.taskId, p.userId),
    // «Миний ажлууд»-аас гаргана (хассан тэмдэгтэй) — дахин авбал (`unhideOnTake`) буцаж гарна.
    db
      .prepare(
        `INSERT INTO task_personal_list (user_id, task_id, hidden_at) VALUES (?1, ?2, datetime('now'))
         ON CONFLICT(user_id, task_id) DO UPDATE SET hidden_at = datetime('now'), updated_at = datetime('now')`,
      )
      .bind(p.userId, p.taskId),
  ]);

  const after = await db
    .prepare(`SELECT COALESCE(${latestApprovedPctByCreatedAt('t.id')}, 0) AS pct FROM tasks t WHERE t.id = ?1`)
    .bind(p.taskId)
    .first<{ pct: number }>();
  await db
    .prepare(
      `UPDATE task_retractions SET progress_after = ?3
        WHERE id = (SELECT MAX(id) FROM task_retractions WHERE task_id = ?1 AND user_id = ?2)`,
    )
    .bind(p.taskId, p.userId, after?.pct ?? 0)
    .run();

  return {
    ok: true,
    task_id: p.taskId,
    removed_entries: entryRows.length,
    removed_points: pointRows.length,
    progress_before: before?.pct ?? 0,
    progress_after: after?.pct ?? 0,
    timer_stopped: stopped > 0,
  };
}
