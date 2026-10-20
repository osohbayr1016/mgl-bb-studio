/**
 * «Таскийн сүүлийн батлагдсан явц» — SQL хэлтэрхий, ГАНЦ газарт.
 *
 * ⚠️ ЯАГААД ЭНЭ ФАЙЛ БАЙДАГ ВЭ (2026-09-11, D1 rows_read аудит):
 *
 * Аппын ~24 газарт «сүүлийн батлагдсан progress_entries мөр» -ийг доорх
 * хэлбэрээр авдаг байв:
 *
 *   latest_task AS (
 *     SELECT pe.task_id, pe.percentage FROM progress_entries pe
 *     WHERE pe.status = 'approved'
 *       AND pe.id = (SELECT id FROM progress_entries x
 *                    WHERE x.task_id = pe.task_id AND x.status = 'approved'
 *                    ORDER BY … LIMIT 1))
 *
 * SQLite нь үүнийг «батлагдсан МӨР БҮРД нэг корреляцтай дэд асуулга» болгож
 * гүйцэтгэдэг: 8 000 мөр × (индекс хайлт + түр B-tree эрэмбэ), дараа нь
 * `LEFT JOIN latest_task lt` -ийг заримдаа индексгүй SCAN хийдэг.  Хэмжсэн
 * (prod-ын хуулбар, `Server-Timing: d1` тоолуур):
 *
 *   /api/teams/allocation   2 974 739 мөр уншилт / нэг хүсэлт   (өдрийн үнэгүй
 *                                                     лимит 5 000 000-ын 60%)
 *   /api/company/overview     285 735   (ТВ самбар минут тутам татдаг)
 *   /api/teams                203 389   (бүх dropdown энэ endpoint-ыг татдаг)
 *   /api/projects              76 849   (хэрэглэгч бүрийн Layout)
 *
 * ЗАСВАР — CTE-г ТАСК тус бүрийн скаляр дэд асуулга болгож, түүнийг бүрхэх
 * partial индексээр (миграц 0290) НЭГ индексийн мөр уншилт болгоно:
 *
 *   COALESCE((SELECT x.percentage FROM progress_entries x
 *              WHERE x.task_id = t.id AND x.status = 'approved'
 *              ORDER BY … LIMIT 1), 0)
 *
 * Хэмжсэн: allocation 2 974 739 → ~12 000; /teams 203 389 → ~9 000.
 *
 * ⚠️ `latest_task AS MATERIALIZED (… ROW_NUMBER() OVER …)` хувилбарыг
 *    ТУРШСАН — SQLite `SCAN lt` хийсээр 286 мс болж ДОРДСОН.  Бүү буцаа.
 *
 * ⚠️ ГУРВАН ӨӨР TIEBREAK БАЙДАГ (CLAUDE.md «Latest approved entry has three
 *    different tiebreaks»).  Энэ файл тэднийг НЭГТГЭДЭГГҮЙ — дуудагч бүр
 *    өмнөх семантикаа ЯГ хэвээр хадгална: `byCreatedAt` (created_at DESC) ба
 *    `byDate` (date DESC, created_at DESC, id DESC).  Тиймээс `dashboard.ts`-ийн
 *    `MAX(date)` хувилбар энд ОРООГҮЙ (тэр нь тусдаа семантиктай).
 *
 * Индексүүд (progress_entries, хоёулаа `WHERE status = 'approved'`):
 *   idx_progress_task_approved_latest (task_id, created_at DESC, percentage)  → byCreatedAt
 *   idx_progress_task_approved_seq    (task_id, date DESC, created_at DESC, id DESC, percentage) → byDate
 */

/**
 * `ORDER BY created_at DESC, id DESC` семантик (PROJECT_LIST_SQL, company.ts, progress.ts …).
 *
 * 2026-10-02: `id DESC` tie-break нэмэгдсэн.  `created_at` нь `datetime('now')` — СЕКУНДЫН нарийвчлалтай тул ижил
 * секундэд хоёр бичлэг бол хуучин `ORDER BY created_at DESC LIMIT 1` нь бүрхэх индексийн дарааллаар хамгийн БАГА
 * хувийг буцаадаг байв (хуваарилагдсан таскийн хоёр хүн нэг секундэд хадгалахад яг тэр гэмтэл).  Бүрхэх индекс
 * `idx_progress_task_approved_latest_id` (миграц 0378).  `byDate` семантик ХЭВЭЭР тусдаа.
 */
export function latestApprovedPctByCreatedAt(taskIdRef: string): string {
  return `(SELECT x.percentage FROM progress_entries x
            WHERE x.task_id = ${taskIdRef} AND x.status = 'approved'
            ORDER BY x.created_at DESC, x.id DESC LIMIT 1)`;
}

/** `ORDER BY date DESC, created_at DESC, id DESC` семантик (teams.ts, projectCharts.ts, profiles.ts, MCP). */
export function latestApprovedPctByDate(taskIdRef: string): string {
  return `(SELECT x.percentage FROM progress_entries x
            WHERE x.task_id = ${taskIdRef} AND x.status = 'approved'
            ORDER BY x.date DESC, x.created_at DESC, x.id DESC LIMIT 1)`;
}

/**
 * Төсөл бүрийн СҮҮЛИЙН явцын бүртгэлийн `created_at` (stale тооцоолол — ticker,
 * timeline, company overview).
 *
 * Өмнөх хэлбэр `FROM progress_entries pe JOIN tasks … JOIN blocks GROUP BY project_id`
 * нь 8 000 мөр бүрийг дөрвөн эцэг рүү нь дагаж уншдаг байв (хэмжсэн 48 223).
 * Блокоос доош алхаж, таск бүрд индексийн MAX авбал 9 890.  `approvedOnly` нь
 * дуудагчийн ӨМНӨХ семантикийг хадгална: ticker/timeline нь батлагдсан мөр л,
 * company overview нь БҮХ статус.
 *
 * Буцаах багана: `project_id`, `last_activity_at` (явцгүй төсөл ОРОХГҮЙ — өмнөх
 * INNER JOIN хэлбэртэй ижил).
 */
export function projectLastActivitySql(approvedOnly: boolean): string {
  const statusFilter = approvedOnly ? " AND x.status = 'approved'" : '';
  return `SELECT project_id, MAX(last_at) AS last_activity_at FROM (
    SELECT b.project_id,
           (SELECT MAX(x.created_at) FROM progress_entries x
             WHERE x.task_id = t.id${statusFilter}) AS last_at
    FROM blocks b
    CROSS JOIN drawings   d ON d.block_id = b.id
    CROSS JOIN components c ON c.drawing_id = d.id
    CROSS JOIN tasks      t ON t.component_id = c.id
  ) WHERE last_at IS NOT NULL GROUP BY project_id`;
}
