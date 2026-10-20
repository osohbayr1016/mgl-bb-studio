-- 0349 — FURNITURE LAND-ийн (ZA #49) явцыг ХЭВЭЭР үлдээх (эзний шийдвэр 2026-09-25).
--
-- 0348 бүх ZA төслийг цагаар бодогддог болгож, хуучин хувийн бөглөлтийг цаг
-- болгон нөхөж явцыг ТЭР цагаас дахин боддог.  Эзэн FURNITURE LAND-ийг (≈94%,
-- бараг дууссан) үүнээс хасав: «Furniture land-ийн хувийг хэвэнд нь үлдээ,
-- бусад засварын төслийнхийг шинэчил».
--
-- projects.hours_progress_base = цагаар шилжих агшны ЖИНЛЭСЭН явц
-- (routes/progress.ts calcProjectProgress-тэй ЯГ ижил SQL, таскийн хүрээг 49-өөр
-- л шүүсэн) − тэр төслийн засварын бүртгэлийн Σ progress_pct.  Тиймээс шилжсэний
-- дараах харагдах явц = өмнөх хувь ЯГ; цаашдын цаг түүн дээр НЭМЭГДЭНЭ
-- (lib/repairProgress.ts hoursProgressSql).  NULL = суурьгүй (явц бүхэлдээ
-- цагаас).  Суурьтай төслийн хуучин хувийн бөглөлтийг нөхөлт ХӨРВҮҮЛЭХГҮЙ
-- (lib/repairDayStore.ts PENDING_FILLS) — хувь нь аль хэдийн суурьт орсон.
ALTER TABLE projects ADD COLUMN hours_progress_base REAL;
UPDATE projects
   SET hours_progress_base = MAX(0, (
     WITH latest_task AS (
       SELECT t.id AS task_id,
              (SELECT x.percentage FROM progress_entries x
                WHERE x.task_id = t.id AND x.status = 'approved'
                ORDER BY x.created_at DESC LIMIT 1) AS percentage
         FROM tasks t
        WHERE t.component_id IN (
                SELECT co.id FROM components co
                  JOIN drawings d ON d.id = co.drawing_id
                  JOIN blocks b ON b.id = d.block_id
                 WHERE b.project_id = 49)
     ),
     draw_prog AS (
       SELECT d.id, d.block_id, d.weight_percent,
              CASE
                WHEN d.weight_percent > 0
                THEN COALESCE(SUM(t.weight_percent * COALESCE(lt.percentage, 0) / 100.0), 0) * 100.0 / d.weight_percent
                ELSE 0
              END AS progress
         FROM drawings d
         LEFT JOIN components c ON c.drawing_id = d.id
         LEFT JOIN tasks t ON t.component_id = c.id
         LEFT JOIN latest_task lt ON lt.task_id = t.id
        WHERE d.block_id IN (SELECT id FROM blocks WHERE project_id = 49)
        GROUP BY d.id, d.block_id, d.weight_percent
     ),
     block_prog AS (
       SELECT b.id, b.team_id, b.weight_percent,
              COALESCE(SUM(dp.weight_percent * dp.progress / 100.0), 0) AS progress
         FROM blocks b
         LEFT JOIN draw_prog dp ON dp.block_id = b.id
        WHERE b.project_id = 49
        GROUP BY b.id, b.team_id, b.weight_percent
     )
     SELECT COALESCE(SUM(bp.weight_percent * bp.progress / 100.0 * COALESCE(pts.share_percent, 0) / 100.0), 0)
       FROM block_prog bp
       LEFT JOIN project_team_shares pts ON pts.project_id = 49 AND pts.team_id = bp.team_id
   ) - COALESCE((SELECT SUM(re.progress_pct) FROM repair_entries re WHERE re.project_id = 49), 0))
 WHERE id = 49 AND category = 'ZA';
