-- 0369 — «ТАСК ДЭЭРХ НЭР = ОДОО ХИЙЖ БУЙ ХҮН» (эзний шийдвэр 2026-10-01), 2/2:
-- таскаас БҮХ хүний нэрийг арилгана.
--
-- Цаашид таск дээр харагдах нэр = тэр таск дээр албан таймер нь ОДОО явж буй хүн
-- (task_timer_sessions, ended_at IS NULL).  task_assignees нь «энэ таск дээр
-- ажиллаж байсан хүмүүс»-ийн БҮРТГЭЛ болно (Миний ажлууд-ын түүх, багийн хуудас,
-- график, «Миний төслүүд») — «Өөртөө авах» бүрт мөр нэмэгдэнэ, хасагдахгүй.
-- tasks.assigned_to («гол хариуцагч») цаашид хэрэглэгдэхгүй.
--
-- 1. Таск дээр ОГТ ажиллаагүй (хувь оруулаагүй, таймер эхлүүлээгүй, «Анхны явц»-ын
--    онооны эзэн биш) эзэмшигчдийн эзэмшлийг түүхэнд бичнэ (task_hold_periods).
-- 2. Тэдгээр мөрийг устгана — нэр арилна.
-- 3. Ажилласан хүмүүсийг бүртгэлд нэмнэ (хувь оруулсан, албан таймер эхлүүлсэн).
-- 4. tasks.assigned_to-г хоосолно.
-- Оноо, явц, бичлэг ХӨНДӨГДӨХГҮЙ.  0368-ийн credit_user_id эхэлж бичигдсэн байх
-- ёстой (дугаарын дараалал).  users/tasks руу FK-тэй мөр оруулахын өмнө эцэг мөр
-- байгааг шалгана (migrations apply нь foreign_keys = 1-тэй).
--
-- ХАСАЛТ — хурлын даалгавар (lib/meetingTasks.ts): «Хурлын даалгавар» блок доорх
-- жин 0-тэй таскууд нь хурлын шийдвэрээр ХҮНД ОНООГДСОН ажил (эзэмшил биш), явцын
-- нэгтгэлд нөлөөгүй.  Тэдний хүн, assigned_to ХӨНДӨГДӨХГҮЙ — эс бөгөөс хурлын
-- даалгавар хэний ч жагсаалтаас алга болно.

INSERT INTO task_hold_periods (task_id, user_id, started_at, ended_at)
SELECT ta.task_id, ta.user_id, ta.created_at, datetime('now')
  FROM task_assignees ta
 WHERE NOT EXISTS (SELECT 1 FROM progress_entries pe
                    WHERE pe.task_id = ta.task_id AND pe.user_id = ta.user_id
                      AND pe.status = 'approved' AND pe.is_baseline = 0
                      AND pe.is_rest_day = 0 AND pe.defer_next_day = 0)
   AND NOT EXISTS (SELECT 1 FROM task_timer_sessions s
                    WHERE s.task_id = ta.task_id AND s.user_id = ta.user_id)
   AND NOT EXISTS (SELECT 1 FROM progress_entries pb
                    WHERE pb.task_id = ta.task_id AND pb.is_baseline = 1
                      AND pb.credit_user_id = ta.user_id)
   AND NOT EXISTS (SELECT 1 FROM tasks mt
                     JOIN components mc ON mc.id = mt.component_id
                     JOIN drawings md ON md.id = mc.drawing_id
                     JOIN blocks mb ON mb.id = md.block_id
                    WHERE mt.id = ta.task_id AND mb.name = 'Хурлын даалгавар');

DELETE FROM task_assignees
 WHERE NOT EXISTS (SELECT 1 FROM progress_entries pe
                    WHERE pe.task_id = task_assignees.task_id AND pe.user_id = task_assignees.user_id
                      AND pe.status = 'approved' AND pe.is_baseline = 0
                      AND pe.is_rest_day = 0 AND pe.defer_next_day = 0)
   AND NOT EXISTS (SELECT 1 FROM task_timer_sessions s
                    WHERE s.task_id = task_assignees.task_id AND s.user_id = task_assignees.user_id)
   AND NOT EXISTS (SELECT 1 FROM progress_entries pb
                    WHERE pb.task_id = task_assignees.task_id AND pb.is_baseline = 1
                      AND pb.credit_user_id = task_assignees.user_id)
   AND NOT EXISTS (SELECT 1 FROM tasks mt
                     JOIN components mc ON mc.id = mt.component_id
                     JOIN drawings md ON md.id = mc.drawing_id
                     JOIN blocks mb ON mb.id = md.block_id
                    WHERE mt.id = task_assignees.task_id AND mb.name = 'Хурлын даалгавар');

INSERT OR IGNORE INTO task_assignees (task_id, user_id, created_at)
SELECT pe.task_id, pe.user_id, MIN(pe.created_at)
  FROM progress_entries pe
 WHERE pe.status = 'approved' AND pe.is_baseline = 0
   AND pe.is_rest_day = 0 AND pe.defer_next_day = 0
   AND EXISTS (SELECT 1 FROM tasks t WHERE t.id = pe.task_id)
   AND EXISTS (SELECT 1 FROM users u WHERE u.id = pe.user_id)
 GROUP BY pe.task_id, pe.user_id;

INSERT OR IGNORE INTO task_assignees (task_id, user_id, created_at)
SELECT s.task_id, s.user_id, strftime('%Y-%m-%d %H:%M:%S', MIN(s.started_at))
  FROM task_timer_sessions s
 WHERE EXISTS (SELECT 1 FROM tasks t WHERE t.id = s.task_id)
   AND EXISTS (SELECT 1 FROM users u WHERE u.id = s.user_id)
 GROUP BY s.task_id, s.user_id;

UPDATE tasks SET assigned_to = NULL
 WHERE assigned_to IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM components mc
                     JOIN drawings md ON md.id = mc.drawing_id
                     JOIN blocks mb ON mb.id = md.block_id
                    WHERE mc.id = tasks.component_id AND mb.name = 'Хурлын даалгавар');
