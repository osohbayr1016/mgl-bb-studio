/**
 * ХУВААРИЛАГДСАН («managed») ҮНДСЭН АЖЛЫГ УСТГАЛТААС ХАМГААЛАХ (эзний шийдвэр 2026-10-02):
 * «Үндсэн таск устгах — таскын үйлдлүүдээс устгахгүй; бүтцийн тохиргооны эрхтэй урсгал тусдаа».
 *
 *   • Хийсэн хэсэг, оноо, цагийн түүхтэй root-ийг (task / component / drawing / block-оор дамжуулан)
 *     устгахыг 409 `ROOT_PROTECTED`-оор хаана — ямар ч цэвэрлэгээ бичихээс ӨМНӨ.  Эс бөгөөс cascade нь
 *     бусдын хийсэн явц, оноог чимээгүй устгана.
 *   • Түүхгүй (хэн ч хийгээгүй, цаг бичээгүй) managed root-ийн хуваарилалтын мөрийг устгахын өмнө гараар
 *     цэвэрлэнэ (FK-гүй хүснэгтүүд — өнчин мөр үлдэхгүй).
 *   • Төсөл бүхлээр устгах (admin) нь зориуд бүх түүхийг устгадаг — `purgeRootsForProject`.
 */

export type RootScope =
  | { kind: 'task'; id: number }
  | { kind: 'component'; id: number }
  | { kind: 'drawing'; id: number }
  | { kind: 'block'; id: number }
  | { kind: 'project'; id: number };

/** Хамрах хүрээн дэх таскуудын id-г олох дэд асуулга (bind: `scope.id`). */
function scopeTaskIdsSql(scope: RootScope): string {
  switch (scope.kind) {
    case 'task':
      return 'SELECT ?1 AS id';
    case 'component':
      return 'SELECT t.id FROM tasks t WHERE t.component_id = ?1';
    case 'drawing':
      return `SELECT t.id FROM tasks t JOIN components c ON c.id = t.component_id WHERE c.drawing_id = ?1`;
    case 'block':
      return `SELECT t.id FROM tasks t
                JOIN components c ON c.id = t.component_id
                JOIN drawings d ON d.id = c.drawing_id
               WHERE d.block_id = ?1`;
    case 'project':
      return `SELECT t.id FROM tasks t
                JOIN components c ON c.id = t.component_id
                JOIN drawings d ON d.id = c.drawing_id
                JOIN blocks b ON b.id = d.block_id
               WHERE b.project_id = ?1`;
  }
}

/** Root-д бодит түүх бий: хийсэн хэсэг, эзэнгүй хийсэн, журнал, цагийн сэшн, явцын бичлэг. */
const HAS_HISTORY_SQL = `(
     r.unattributed_units > 0
  OR EXISTS (SELECT 1 FROM task_allocations a WHERE a.task_id = r.task_id AND a.done_units > 0)
  OR EXISTS (SELECT 1 FROM task_contributions k WHERE k.task_id = r.task_id)
  OR EXISTS (SELECT 1 FROM task_timer_sessions s WHERE s.task_id = r.task_id)
  OR EXISTS (SELECT 1 FROM progress_entries p WHERE p.task_id = r.task_id))`;

/** Тодорхой хүснэгт хараахан байхгүй (0376/0385 хэрэгжээгүй) орчны алдаа — ЗӨВХӨН энэ нь «тэр хүснэгтээс хамгаалах зүйл алга». */
function isMissingTable(err: unknown, table: 'task_roots' | 'task_conversion_members'): boolean {
  return new RegExp(`no such table:\\s*${table}\\b`, 'i').test(String((err as Error)?.message ?? err));
}

/**
 * Устгалыг ХААХ (түүхтэй) managed root-уудын task id.
 *
 * ⚠️ FAIL-CLOSED (2026-10-05): өмнө нь ЯМАР Ч алдаа (D1 түр тасрал, тайм-аут) `[]` буцааж «хамгаалах root алга» гэж
 * устгалыг ЗӨВШӨӨРДӨГ байв — тэгвэл cascade нь бусдын хийсэн явц, оноог чимээгүй устгана.  Одоо зөвхөн «хүснэгт байхгүй»
 * алдаа л тэр хүснэгтийн хувьд `[]`; бусад нь дуудагч руу шидэгдэж устгал 500-аар зогсоно (дахин оролдоход аюулгүй).
 *
 * ⚠️ ХОЁР ТУСДАА асуулга: 0385 (`task_conversion_members`) хараахан хэрэгжээгүй орчинд (worker миграцаас түрүүлж гарсан) ч
 * `task_roots`-ийн түүхтэй root ХАМГААЛАГДАХ ёстой.  Нэг UNION асуулга нь хоёр дахь хүснэгтийн алдаанд эхнийг ч далдалж,
 * хуваарилагдсан таскийг cascade-аар устгадаг байв.
 */
export async function protectedRootsIn(db: D1Database, scope: RootScope): Promise<number[]> {
  const out = new Set<number>();
  try {
    const { results } = await db
      .prepare(
        `SELECT r.task_id FROM task_roots r
          WHERE r.task_id IN (${scopeTaskIdsSql(scope)}) AND ${HAS_HISTORY_SQL}`,
      )
      .bind(scope.id)
      .all<{ task_id: number }>();
    for (const r of results ?? []) out.add(r.task_id);
  } catch (err) {
    if (!isMissingTable(err, 'task_roots')) throw err;
  }
  try {
    const { results } = await db
      .prepare(
        `SELECT m.task_id FROM task_conversion_members m
          WHERE m.task_id IN (${scopeTaskIdsSql(scope)})`,
      )
      .bind(scope.id)
      .all<{ task_id: number }>();
    for (const r of results ?? []) out.add(r.task_id);
  } catch (err) {
    if (!isMissingTable(err, 'task_conversion_members')) throw err;
  }
  return [...out].sort((a, b) => a - b);
}

export const ROOT_PROTECTED_MESSAGE =
  'Хуваарилагдсан таск дээр хийсэн ажил, оноо, цагийн түүх бий тул устгах боломжгүй — түүхийг хадгалж, бүтцийн засвараар (хуваарилалтыг эхлээд нэгтгэж) шийднэ үү.';

/** Түүхгүй managed root-ийн хуваарилалт, журнал, мутацийн мөрийг гараар устгана (өнчин мөр үлдээхгүй). */
export async function purgeEmptyRoots(db: D1Database, scope: RootScope): Promise<void> {
  try {
    const ids = `SELECT r.task_id FROM task_roots r
                  WHERE r.task_id IN (${scopeTaskIdsSql(scope)}) AND NOT ${HAS_HISTORY_SQL}`;
    await db.batch([
      db.prepare(`DELETE FROM task_allocations WHERE task_id IN (${ids})`).bind(scope.id),
      db.prepare(`DELETE FROM task_ops WHERE task_id IN (${ids})`).bind(scope.id),
      db.prepare(`DELETE FROM task_roots WHERE task_id IN (${ids})`).bind(scope.id),
    ]);
  } catch (err) {
    console.error('[task-root] purge of empty roots failed', err);
  }
  await purgeOrphanParts(db);
}

/** Root нь устсан хүнгүй хэсгүүд (0394) — тусдаа statement: хүснэгт хараахан байхгүй орчинд дээрх цэвэрлэгээг унагахгүй. */
async function purgeOrphanParts(db: D1Database): Promise<void> {
  try {
    await db.prepare('DELETE FROM task_parts WHERE task_id NOT IN (SELECT task_id FROM task_roots)').run();
  } catch (err) {
    if (!String(err).includes('no such table')) console.error('[task-root] purge of orphan parts failed', err);
  }
}

/** Төсөл бүхлээр устгахад (admin): тэр төслийн БҮХ root-ийн мөр (түүхтэй ч) — төслийн оноо, явц мөн cascade-аар устна. */
export async function purgeRootsForProject(db: D1Database, projectId: number): Promise<void> {
  try {
    const ids = `SELECT t.id FROM tasks t
                   JOIN components c ON c.id = t.component_id
                   JOIN drawings d ON d.id = c.drawing_id
                   JOIN blocks b ON b.id = d.block_id
                  WHERE b.project_id = ?1`;
    await db.batch([
      db.prepare(`DELETE FROM task_allocations WHERE task_id IN (${ids})`).bind(projectId),
      db.prepare(`DELETE FROM task_contributions WHERE task_id IN (${ids})`).bind(projectId),
      db.prepare(`DELETE FROM task_ops WHERE task_id IN (${ids})`).bind(projectId),
      db.prepare(`DELETE FROM task_roots WHERE task_id IN (${ids})`).bind(projectId),
    ]);
  } catch (err) {
    console.error('[task-root] purge for project failed', err);
  }
  await purgeOrphanParts(db);
  // 0385-ын хүснэгтүүд ТУСДАА batch — хараахан байхгүй орчинд дээрх allocation цэвэрлэгээг түүнд хамт унагахгүй.
  try {
    await db.batch([
      db
        .prepare(`DELETE FROM task_conversion_members WHERE task_id IN (SELECT t.id FROM tasks t JOIN components c ON c.id = t.component_id JOIN drawings d ON d.id = c.drawing_id JOIN blocks b ON b.id = d.block_id WHERE b.project_id = ?1)`)
        .bind(projectId),
      db.prepare('DELETE FROM task_conversions WHERE project_id = ?').bind(projectId),
    ]);
  } catch (err) {
    if (!isMissingTable(err, 'task_conversion_members')) console.error('[task-root] purge conversions for project failed', err);
  }
}

/**
 * Хэрэглэгчийг устгахад: тэр хүний хуваарилалтын мөр устаж, хийсэн нь «эзэнгүй» (B), үлдсэн ажил чөлөөт (U)
 * болно — бусдын хуваарилалт, root-ийн нийлбэр инвариант (Σ T + B + U = 100) хэвээр.  Журнал (түүх) үлдэнэ.
 */
export async function detachUserFromRoots(db: D1Database, userId: number): Promise<void> {
  try {
    await db.batch([
      db
        .prepare(
          `UPDATE task_roots
              SET unattributed_units = unattributed_units
                    + COALESCE((SELECT SUM(a.done_units) FROM task_allocations a
                                 WHERE a.task_id = task_roots.task_id AND a.user_id = ?1), 0),
                  unallocated_units = unallocated_units
                    + COALESCE((SELECT SUM(a.target_units - a.done_units) FROM task_allocations a
                                 WHERE a.task_id = task_roots.task_id AND a.user_id = ?1), 0),
                  revision = revision + 1,
                  updated_at = datetime('now')
            WHERE task_id IN (SELECT task_id FROM task_allocations WHERE user_id = ?1)`,
        )
        .bind(userId),
      db.prepare(`DELETE FROM task_allocations WHERE user_id = ?`).bind(userId),
      db.prepare(`DELETE FROM task_timer_voids WHERE user_id = ?`).bind(userId),
      db.prepare(`DELETE FROM task_timer_void_log WHERE user_id = ?`).bind(userId),
    ]);
  } catch (err) {
    console.error('[task-root] detach user failed', err);
  }
}
