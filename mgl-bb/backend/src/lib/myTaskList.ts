/**
 * «МИНИЙ АЖЛУУД»-ЫН ХУВИЙН ЖАГСААЛТ (эзэн 2026-10-01, migration 0370) — дүрэм ба SQL нэг газар.
 *
 * 0368-аас хойш таск дээрх НЭР = албан таймер нь ОДОО явж буй хүн, таскийг зөвхөн төслийн
 * хуудаснаас «Өөртөө авах»-аар эхлүүлдэг болсон тул ажилтан өдөр бүр төсөл рүүгээ орж олон
 * таскаас өөрийнхөө ажлыг хайдаг болсон.  Одоо:
 *
 *   • Төслийн хуудасны таскийн мөр дээрх «Миний ажилд нэмэх» → энэ хүснэгтэд мөр.  ЗӨВХӨН
 *     тухайн хүнд харагдана — таск дээрх нэр, нийтийн хуудас, rollup, оноо, тайлан, MCP
 *     үүнийг уншихгүй; `task_assignees` (ажилласан хүмүүсийн бүртгэл) рүү ОРОХГҮЙ.
 *   • «Миний ажлууд» = ажилласан таскууд (`task_assignees` + хуучин `tasks.assigned_to`)
 *     ∪ нэмсэн таскууд − хассан таскууд.  Цаг зогсоосон ч таск жагсаалтад ҮЛДЭНЭ.
 *   • «Миний ажлууд» дээрээс шууд цаг эхлүүлнэ — `takeTask` (ижил «авах» дүрэм: ирц,
 *     эзлэгдсэн бол хувааж авах).  Цаг эхэлмэгц таск дээр нэр «одоо» гарна.
 *   • «Миний ажлаас хасах» = `hidden_at` (ажиллаж байсан таскийг ч нууна).  Дахин нэмэх
 *     эсвэл тэр таск дээр цаг эхлүүлэхэд буцаж гарна.
 *
 * Энэ файл юу ч импортлохгүй (`node --test` hook-гүйгээр ачаална).  Хэрэглэгчийн id-г
 * SQL-д bind биш ТОО болгож шигтгэнэ (`asrVisibility.ts`-ийн жишгээр) — нэг асуулгад
 * олон удаа давтагддаг тул байрлалын bind эвдрэхгүй.
 */

function safeId(n: number, what: string): number {
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`invalid ${what}: ${String(n)}`);
  return n;
}

/**
 * Миний жагсаалтын таск id-ийн олонлог — `t.id IN (${myTaskIdsSql(uid)})` хэлбэрээр.
 * `/progress/my-tasks`, `/progress/my-tasks/ids`, `/task-timer/working?mine=1` гурвуулаа
 * ЭНИЙГ хэрэглэнэ — тусад нь давтаж бичвэл нэг нь зөрнө.
 */
export function myTaskIdsSql(userId: number): string {
  const u = safeId(userId, 'user id');
  // ⚠️ D1 нэг compound SELECT-д ХАМГИЙН ИХДЭЭ 5 нэр томьёо зөвшөөрнө («too many terms in compound
  // SELECT», SQLITE_ERROR 7500) — локал node:sqlite энэ хязгаарыг мөрддөггүй тул тест ногоон байхад
  // прод дээр хуудас 500 өгч байв (UNION×3 + EXCEPT×2 = 6 болсон).  Нэмэх нь 4 нэр томьёонд, хасах нь
  // гаднах NOT EXISTS-д (PK/индексээр) — compound-д ШИНЭ нэр томьёо БҮҮ нэм.
  return `SELECT id FROM (
            SELECT id FROM tasks WHERE assigned_to = ${u}
            UNION SELECT task_id FROM task_assignees WHERE user_id = ${u}
            UNION SELECT task_id FROM task_allocations WHERE user_id = ${u} AND (target_units > 0 OR done_units > 0)
            UNION SELECT task_id FROM task_personal_list WHERE user_id = ${u} AND hidden_at IS NULL
          ) mine
          WHERE NOT EXISTS (SELECT 1 FROM task_personal_list h
                             WHERE h.user_id = ${u} AND h.task_id = mine.id AND h.hidden_at IS NOT NULL)
            AND NOT EXISTS (SELECT 1 FROM task_conversion_members m
                             WHERE m.task_id = mine.id AND m.role = 'retired')`;
}

/** «Миний ажилд нэмэх» — шинэ мөр, эсвэл өмнө нь хассан бол буцааж нэмнэ (огноо шинэчлэгдэнэ). */
export async function addToMyList(db: D1Database, userId: number, taskId: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO task_personal_list (user_id, task_id) VALUES (?1, ?2)
       ON CONFLICT(user_id, task_id) DO UPDATE SET
         added_at   = CASE WHEN task_personal_list.hidden_at IS NULL
                           THEN task_personal_list.added_at ELSE datetime('now') END,
         hidden_at  = NULL,
         updated_at = datetime('now')`,
    )
    .bind(safeId(userId, 'user id'), safeId(taskId, 'task id'))
    .run();
}

/** «Миний ажлаас хасах» — ажиллаж байсан (бүртгэлтэй) таскийг ч нууна. */
export async function hideFromMyList(db: D1Database, userId: number, taskId: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO task_personal_list (user_id, task_id, hidden_at) VALUES (?1, ?2, datetime('now'))
       ON CONFLICT(user_id, task_id) DO UPDATE SET
         hidden_at  = datetime('now'),
         updated_at = datetime('now')`,
    )
    .bind(safeId(userId, 'user id'), safeId(taskId, 'task id'))
    .run();
}

/** Таск дээр цаг эхлүүлэх (= авах) нь «миний ажил» гэсэн үг — өмнө нь хассан бол буцаана. */
export async function unhideOnTake(db: D1Database, userId: number, taskId: number): Promise<void> {
  await db
    .prepare(
      `UPDATE task_personal_list SET hidden_at = NULL, updated_at = datetime('now')
        WHERE user_id = ?1 AND task_id = ?2 AND hidden_at IS NOT NULL`,
    )
    .bind(safeId(userId, 'user id'), safeId(taskId, 'task id'))
    .run();
}

/** Хэрэглэгчийн НЭМСЭН мөр байгаа эсэх (хассан биш). */
export async function hasPicked(db: D1Database, userId: number, taskId: number): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS x FROM task_personal_list
        WHERE user_id = ?1 AND task_id = ?2 AND hidden_at IS NULL`,
    )
    .bind(safeId(userId, 'user id'), safeId(taskId, 'task id'))
    .first<{ x: number }>();
  return !!row;
}

/** Нэмсэн мөрийг устгана (хассан мөр хэвээр) — «хувааж авах»-ын дараа эзлэгчийн хэсгээс. */
export async function dropPicked(db: D1Database, userId: number, taskId: number): Promise<void> {
  await db
    .prepare(`DELETE FROM task_personal_list WHERE user_id = ?1 AND task_id = ?2 AND hidden_at IS NULL`)
    .bind(safeId(userId, 'user id'), safeId(taskId, 'task id'))
    .run();
}

/** Төслийн хуудас: энэ төсөл дэх миний жагсаалтын таскууд (товчны төлөв, «Зөвхөн миний»). */
export async function loadMyTaskIdsForProject(
  db: D1Database,
  userId: number,
  projectId: number,
): Promise<number[]> {
  const { results } = await db
    .prepare(
      `SELECT t.id
         FROM tasks t
         JOIN components comp ON comp.id = t.component_id
         JOIN drawings d ON d.id = comp.drawing_id
         JOIN blocks b ON b.id = d.block_id
        WHERE b.project_id = ?1
          AND t.id IN (${myTaskIdsSql(userId)})`,
    )
    .bind(safeId(projectId, 'project id'))
    .all<{ id: number }>();
  return (results ?? []).map((r) => r.id);
}

/**
 * «Миний ажлууд» хуудасны «Одоо хэн хийж байна» — миний жагсаалтын таскууд дээр ОДОО албан
 * таймер нь явж буй хүмүүс (би ч орно).  Нэр л — цаг БИШ (`/task-timer/working`-тэй ижил).
 */
export async function loadMyListWorkers(
  db: D1Database,
  userId: number,
): Promise<Array<{ task_id: number; user_id: number; full_name: string | null; profile_image: string | null }>> {
  const { results } = await db
    .prepare(
      `SELECT s.task_id, s.user_id, u.full_name, u.profile_image
         FROM task_timer_sessions s
         LEFT JOIN users u ON u.id = s.user_id
        WHERE s.ended_at IS NULL
          AND s.task_id IN (${myTaskIdsSql(userId)})`,
    )
    .all<{ task_id: number; user_id: number; full_name: string | null; profile_image: string | null }>();
  return results ?? [];
}
