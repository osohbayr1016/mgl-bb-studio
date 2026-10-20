-- 0370 — «МИНИЙ АЖЛУУД»-ЫН ХУВИЙН ЖАГСААЛТ (эзэн 2026-10-01, 0368/0369-ийн үргэлжлэл).
--
-- 0368-аас хойш таскийг зөвхөн төслийн хуудаснаас «Өөртөө авах»-аар эхлүүлдэг болсон тул
-- ажилтнууд өдөр бүр төсөл рүүгээ орж олон таскаас өөрийнхөө ажлыг хайх болсон.  Энэ
-- хүснэгт нь ажилтан ӨӨРТӨӨ зориулж «Миний ажилд нэмэх» товчоор нэмсэн таскуудыг
-- хадгална — «Миний ажлууд» дээрээс шууд цаг эхлүүлнэ (ижил «авах» дүрэм).
--
--   • ЗӨВХӨН ТУХАЙН ХҮНД харагдана.  Таск дээрх НЭР хэвээр «албан таймер нь ОДОО явж
--     буй хүн» (0368) — энэ хүснэгтийг ямар ч нийтийн хуудас, rollup, оноо, тайлан,
--     MCP уншихгүй.  task_assignees (ажилласан хүмүүсийн бүртгэл) рүү ОРОХГҮЙ.
--   • «Миний ажлууд» = (task_assignees + tasks.assigned_to) ∪ (hidden_at IS NULL мөр)
--     − (hidden_at IS NOT NULL мөр).  Цаг зогсоосон ч таск жагсаалтад үлдэнэ.
--   • hidden_at = ажилтан «Миний ажлаас хасах» дарсан (ажиллаж байсан таскийг ч нууна).
--     Дахин нэмэх эсвэл тэр таск дээр цаг эхлүүлэхэд NULL болно.
--   • users/tasks руу FK ЗОРИУД байхгүй (D1 runtime-д хэрэгжүүлдэггүй) — устгалыг
--     routes/tasks.ts (таск) ба routes/users.ts (хэрэглэгч) гараар хийнэ.
--   • Дүрэм, SQL нэг газар: backend/src/lib/myTaskList.ts.

CREATE TABLE IF NOT EXISTS task_personal_list (
  user_id    INTEGER NOT NULL,
  task_id    INTEGER NOT NULL,
  added_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  hidden_at  TEXT,
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_task_personal_list_task ON task_personal_list (task_id);
