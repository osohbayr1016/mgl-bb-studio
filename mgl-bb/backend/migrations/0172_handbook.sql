-- =============================================================
-- Гарын авлага (Handbook) — албан тушаал × түвшин тус бүрийн заавар
-- =============================================================
-- HR/админ ажилтан бүрд «чиний албан тушаалд, чиний одоогийн түвшинд
-- юу шаардагдах вэ» гэдгийг бичиж өгдөг нэг төвлөрсөн гарын авлага.
--
-- Хэрэглээ: ажилтан өөрийн профайл дээрээ ӨӨРИЙН role-д хамаарах
-- нийтлэгдсэн (`status='published'`) бичлэгүүдийг хардаг бөгөөд
-- үнэлгээгээр тодорхойлогдсон ОДООГИЙН түвшинтэй нь тохирох бичлэг
-- онцлон харагдана.  Ингэснээр «дараагийн түвшин (жишээ нь SENIOR)
-- ямар байх ёстой вэ» гэсэн карт бодит агуулгатай болно.
--
-- `role`       = users.role-ийн мөр ('architect','engineer','senior',
--                'admin','worker') ЭСВЭЛ '*' = бүгдэд зориулсан.
-- `level_code` = үнэлгээний band код ('INTERN','JUNIOR','MIDDLE',
--                'SENIOR','EXPERT') ЭСВЭЛ '*' = бүх түвшинд.
--
-- ЗОРИУДААР role/level_code дээр FOREIGN KEY ТАВИАГҮЙ: энэ хоёр нь
-- хүснэгтэд биш, КОД дотор (types.ts-ийн UserRole) болон үнэлгээний
-- JSON схемийн `levels` массивт (assessment_templates.schema_json)
-- амьдардаг чөлөөт үгсийн сан.  Тэдгээрийг хүснэгт болгож FK-ддэг бол
-- схемийн band нэмэх бүрд migration бичих шаардлага үүснэ — иймд
-- шалгалт нь route талд (routes/handbook.ts) хийгдэнэ.
--
-- users хүснэгтэд огт хүрэхгүй (энэ нь ~40 хүүхэд хүснэгт рүү
-- cascade хийдэг тул дахин бүтээхийг хориглосон).

CREATE TABLE IF NOT EXISTS handbook_entries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  role          TEXT    NOT NULL DEFAULT '*',       -- users.role эсвэл '*'
  level_code    TEXT    NOT NULL DEFAULT '*',       -- band код эсвэл '*'
  title_mn      TEXT    NOT NULL,
  title_en      TEXT,
  body_md       TEXT    NOT NULL DEFAULT '',        -- Markdown агуулга
  sort_order    INTEGER NOT NULL DEFAULT 0,
  status        TEXT    NOT NULL DEFAULT 'published'
                        CHECK (status IN ('draft','published')),
  created_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Ажилтны уншилт бүр (role, level_code)-оор шүүдэг тул хосолсон индекс.
CREATE INDEX IF NOT EXISTS idx_handbook_role_level ON handbook_entries(role, level_code);
-- Админы жагсаалт болон staff-ийн уншилт хоёулаа sort_order-оор эрэмбэлдэг.
CREATE INDEX IF NOT EXISTS idx_handbook_sort ON handbook_entries(sort_order);
