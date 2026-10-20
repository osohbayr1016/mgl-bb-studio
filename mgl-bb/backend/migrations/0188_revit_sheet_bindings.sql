-- 0188 — Revit хуудас ↔ WBS-ийн ХОЛБООС.  Энэ feature-ийн ганц мөнхийн артефакт.
--
-- Түлхүүр нь `ViewSheet.UniqueId`: хуудасны дугаар солих, нэр солих, файлын
-- нэр солих, worksharing sync, central шилжүүлэх — бүгдийг даван гарна.
-- `sheet_number` нь зурагчид байнга солидог тул ЗӨВХӨН таарцын сэжүүр,
-- хэзээ ч түлхүүр биш.
--
-- `user_id IS NULL` = багийн үндсэн холбоос.
-- `user_id` тавьсан = хувийн дарах (нэг хуудсан дээр хоёр хүн өөр өөр
-- таск руу тайлагнах тохиолдол).  Давхардлын индекс нь `IFNULL(user_id, 0)`
-- — 0117 `resource_alias`-ийн `IFNULL(project_id,-1)` заншлыг дагав.
--
-- drawing_id / task_id нь ON DELETE SET NULL: зураг устгахад холбоос түүхээ
-- хадгалж «холбогдоогүй» болж буурна, дараагийн handshake дахин санал болгоно.
--
-- ⚠️ D1 нь FK-г ажиллах үед хэрэгжүүлдэггүй тул `DELETE FROM drawings`
-- (drawings.ts — хүүхэд цэвэрлэгээгүй bare DELETE) энэ мөрүүдийг ЦЭВЭРЛЭХГҮЙ.
-- Тиймээс routes/drawings.ts + routes/tasks.ts-д ГАРААР устгах мөр нэмнэ
-- (email.ts / calendar.ts / pgp.ts / repair.ts-ийн заншил).
--
-- ⚠️ projects-ийн 35 дахь CASCADE хүүхэд.  Энэ файл өөрөө зөвхөн CREATE тул
-- аюулгүй; projects-ийг rebuild хийх нь улам аюултай боллоо — path B заавал.

CREATE TABLE IF NOT EXISTS revit_sheet_bindings (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  revit_document_id INTEGER NOT NULL REFERENCES revit_documents(id) ON DELETE CASCADE,
  project_id        INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sheet_uid         TEXT    NOT NULL,
  sheet_number      TEXT    NOT NULL DEFAULT '',
  sheet_name        TEXT    NOT NULL DEFAULT '',
  placed_view_count INTEGER NOT NULL DEFAULT 0,
  drawing_id        INTEGER REFERENCES drawings(id) ON DELETE SET NULL,
  task_id           INTEGER REFERENCES tasks(id)    ON DELETE SET NULL,
  user_id           INTEGER REFERENCES users(id)    ON DELETE CASCADE,
  status            TEXT    NOT NULL DEFAULT 'suggested'
                            CHECK (status IN ('suggested','confirmed','ignored')),
  match_source      TEXT    CHECK (match_source IN
                            ('number','name','discipline','inherited','manual')),
  confidence        REAL    NOT NULL DEFAULT 0,
  bound_by          INTEGER REFERENCES users(id),
  bound_at          TEXT,
  last_seen_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_revit_binding_uniq
  ON revit_sheet_bindings(revit_document_id, sheet_uid, IFNULL(user_id, 0));
CREATE INDEX IF NOT EXISTS idx_revit_binding_task
  ON revit_sheet_bindings(task_id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_revit_binding_doc
  ON revit_sheet_bindings(revit_document_id, status);
CREATE INDEX IF NOT EXISTS idx_revit_binding_project
  ON revit_sheet_bindings(project_id, status);
