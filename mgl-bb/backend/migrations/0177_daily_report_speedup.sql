-- =============================================================
-- 0177 — Өдөр тутмын тайлагналыг хурдасгах
--
-- Хоёр зүйл нэмнэ:
--
--  1. `progress_entries.attachments` — нэг тайланд ОЛОН хавсралт
--     (зураг / PDF / DWG / скриншот).  JSON массив:
--        [{ "url": "/media/<key>", "name": "…", "type": "…", "size": 123 }]
--     Хуучин `image_url` баганыг УСТГААГҮЙ: өмнөх бүх мөр түүн дээр
--     амьдарсаар байгаа бөгөөд шинэ бичилт эхний зургаа тэнд давхар
--     хадгална (back-compat — `image_url`-ыг уншдаг код өөрчлөгдөхгүй).
--     Тайлбар: D1 дээр JSON-ыг TEXT болгон хадгална; сервер талд
--     `parseAttachments()` нь гэмтсэн JSON-ыг хоосон массив болгож
--     залгидаг тул унших тал хэзээ ч шидэхгүй.
--
--  2. `task_checklist_items` — ажилтан ӨӨРИЙН ажлаа задлах хувийн
--     checklist.
--
--     ⚠️ ЭНЭ НЬ subtask ДАВХАРГА БИШ.  0017/0020 миграцууд subtask-ийг
--     жинтэй давхарга байснаар нь устгасан бөгөөд түүнийг сэргээхгүй:
--     энд `weight_percent` БАЙХГҮЙ, ямар ч rollup энэ хүснэгтийг
--     УНШИХГҮЙ (`PROJECT_LIST_SQL` болон 11 хуулбарын аль нь ч).
--     Зөвхөн тухайн хэрэглэгчийн санах ойн жагсаалт бөгөөд «5-аас 3
--     дууссан → 60%» гэсэн САНАЛ болгох тоог л UI-д өгнө; ажилтан
--     түүнийг өөрөө хүлээн авч байж progress_entries үүсдэг.
--
--     `user_id` нь мөрийн эзэн — нэг таск дээр хоёр хүн ажиллаж
--     байвал тус тусдаа хувийн жагсаалттай (нөгөөгийнхийг харахгүй).
-- =============================================================

ALTER TABLE progress_entries ADD COLUMN attachments TEXT;

CREATE TABLE IF NOT EXISTS task_checklist_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text       TEXT    NOT NULL,
  is_done    INTEGER NOT NULL DEFAULT 0 CHECK(is_done IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    DEFAULT (datetime('now')),
  done_at    TEXT
);

-- Гол унших хэлбэр: «энэ хэрэглэгчийн энэ таск дээрх жагсаалт».
CREATE INDEX IF NOT EXISTS idx_task_checklist_task_user
  ON task_checklist_items(task_id, user_id, sort_order);

-- `/progress/my-tasks` нэг л удаа GROUP BY хийж тоог авдаг (N+1 биш).
CREATE INDEX IF NOT EXISTS idx_task_checklist_user
  ON task_checklist_items(user_id);
