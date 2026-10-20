-- 0390 — Revit «Өөрчлөхөөс өмнө» (Change Impact Radar)-ын ӨӨРЧЛӨЛТИЙН МЭДЭГДЭЛ.
--
-- Архитектор элементийг зөөж БАТАЛСНЫ дараа add-in мөргөлдсөн элементүүдийг
-- үүсгэсэн / сүүлд өөрчилсөн хүмүүст ERP-ээр мэдэгдэнэ.  Зохиогчийн мэдээлэл
-- нь Revit worksharing-ийн хэрэглэгчийн НЭР тул ERP хэрэглэгчтэй холбох
-- `revit_user_aliases` хүснэгт хэрэгтэй (add-in автоматаар, админ гараар).
--
-- BIM-ийн элемент түвшний үйл ажиллагааны хүснэгтүүд (0201–0209) ЗОРИУД
-- хэрэглэгдээгүй — тэд «зөвхөн өөртөө» нууцлалтай.
--
-- D1 FK-г ажиллах үед шалгадаггүй тул FK зарлаагүй — `DELETE /api/users/:id`
-- alias болон хүлээн авагчийн мөрийг гараар устгана.
-- Дүрэм: `backend/src/lib/revitChangeNotices.ts`, замууд
-- `backend/src/routes/revitChangeNotices.ts`.

CREATE TABLE IF NOT EXISTS revit_user_aliases (
  revit_username_norm TEXT NOT NULL,
  revit_username      TEXT NOT NULL,
  user_id             INTEGER NOT NULL,
  source              TEXT NOT NULL DEFAULT 'addin',
  first_seen_at       TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at        TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (revit_username_norm, user_id)
);

CREATE INDEX IF NOT EXISTS idx_rua_user ON revit_user_aliases(user_id);

CREATE TABLE IF NOT EXISTS revit_change_notices (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  client_uid            TEXT NOT NULL UNIQUE,
  sender_id             INTEGER NOT NULL,
  sender_revit_username TEXT,
  project_id            INTEGER,
  doc_uid               TEXT,
  doc_title             TEXT NOT NULL,
  moved_label           TEXT NOT NULL,
  moved_category        TEXT,
  moved_json            TEXT NOT NULL,
  offset_mm_json        TEXT NOT NULL,
  distance_mm           REAL NOT NULL,
  verdict               TEXT NOT NULL,
  headline              TEXT NOT NULL,
  conflicts_json        TEXT NOT NULL,
  issues_json           TEXT NOT NULL,
  unresolved_json       TEXT NOT NULL DEFAULT '[]',
  note                  TEXT,
  moved_at              TEXT NOT NULL,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rcn_sender  ON revit_change_notices(sender_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_rcn_project ON revit_change_notices(project_id, id DESC);

CREATE TABLE IF NOT EXISTS revit_change_notice_recipients (
  notice_id         INTEGER NOT NULL,
  user_id           INTEGER NOT NULL,
  reasons_json      TEXT NOT NULL,
  element_keys_json TEXT NOT NULL DEFAULT '[]',
  notified_at       TEXT NOT NULL DEFAULT (datetime('now')),
  read_at           TEXT,
  acknowledged_at   TEXT,
  PRIMARY KEY (notice_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_rcnr_user ON revit_change_notice_recipients(user_id, notice_id DESC);
