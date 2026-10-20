-- =============================================================
-- 0337_project_deadline_changes.sql — Төслийн дуусах хугацааны СУНГАЛТ + ТҮҮХ — 2026-09-21
-- =============================================================
--
-- Төслийн эцсийн хугацаа (`project_passport.finish_date`) урьд нь ГАНЦ багана
-- байсан: «Хуваарь» цонх ба паспортын 1.3 хүснэгт хоёулаа түүнийг ДАРЖ бичдэг
-- тул «анх хэзээ дуусах ёстой байсан, хэдэн удаа, хэдэн хоногоор, хэний
-- зөвшөөрлөөр сунгасан» гэсэн мэдээлэл хаана ч үлддэггүй байв.
--
-- ЗАГВАР (эзний шаардлага 2026-09-21):
--   • `finish_date` нь ХЭВЭЭР «одоо хүчинтэй дуусах хугацаа».  Хугацаа хэтэрсэн,
--     Timeline, график, компанийн тойм, MCP, захиалагчийн PDF — тэр баганыг
--     уншдаг 30 гаруй газар ЮУ Ч ӨӨРЧЛӨГДӨХГҮЙ: сунгасан даруйд шинэ хугацааг
--     бүгд автоматаар хэрэглэнэ.
--   • Өөрчлөлт бүр ЭНЭ хүснэгтэд мөр болж үлдэнэ (append-only):
--       kind='extension'  — «Хугацаа сунгах» үйлдэл: батлагч (захиалагч /
--                           захирал / бусад), шалтгаан, лавлах дугаар заавал.
--                           `seq` = тухайн төслийн хэд дэх сунгалт (1, 2, …).
--       kind='correction' — «Хуваарь» цонх / паспортын 1.3 хүснэгтээр огноо
--                           ЗАССАН (буруу бичсэнийг залруулах, хоослох, анх
--                           тогтоох).  Батлагчгүй, `seq` NULL.  Сунгалтын
--                           тоонд ОРОХГҮЙ.
--     Анхны хугацаа = хамгийн эхний сунгалтын `from_date` (сунгалтгүй бол
--     `finish_date` өөрөө) — тусдаа багана НЭМЭЭГҮЙ, түүхээс гарна.
--   • Хойшлуулах өөрчлөлт ЗӨВХӨН `extension`-ээр (routes/timeline.ts,
--     routes/projects.ts нь хойшлуулсан огноог 409 EXTENSION_REQUIRED-ээр
--     буцаана); урагшлуулах / хоослох нь `correction`.
--
-- ⚠️ ЗӨВХӨН НЭМЭЛТ (additive).  DROP байхгүй, parent rebuild БИШ — энгийн
--    `migrations apply`-аар аюулгүй.  D1 нь runtime дээр FK-г хэрэгжүүлдэггүй
--    тул `DELETE /api/projects/:id` энэ хүснэгтийг ГАРААР цэвэрлэнэ.
-- Транспорт: 2 statement.
CREATE TABLE IF NOT EXISTS project_deadline_changes (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id       INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind             TEXT    NOT NULL CHECK (kind IN ('extension','correction')),
  -- Хэд дэх сунгалт (1-ээс).  correction мөрөнд NULL.
  seq              INTEGER,
  -- Өмнөх дуусах огноо (анх тогтоох үед NULL) ба шинэ огноо (хоослоход NULL).
  from_date        TEXT,
  to_date          TEXT,
  -- to_date − from_date, хуанлийн хоногоор.  Аль нэг нь ISO биш бол NULL.
  days             INTEGER,
  reason           TEXT,
  -- Хэн зөвшөөрсөн: 'client' (захиалагч) | 'director' (захирал) | 'other'.
  approved_by_kind TEXT    CHECK (approved_by_kind IN ('client','director','other')),
  approved_by_name TEXT,
  -- Зөвшөөрлийн огноо 'YYYY-MM-DD' ба лавлах баримт (албан бичгийн №, протокол…).
  approved_on      TEXT,
  reference_no     TEXT,
  note             TEXT,
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_project_deadline_changes_project
  ON project_deadline_changes(project_id, id);
