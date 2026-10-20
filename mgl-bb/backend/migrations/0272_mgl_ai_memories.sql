-- =============================================================
-- 0272_mgl_ai_memories.sql — MGL AI · ХЭРЭГЛЭГЧИЙН САНАМЖ
-- =============================================================
-- ЗОРИЛГО: ярианы түүхийг хязгааргүй хуулахын оронд БҮТЭЦТЭЙ санамж.
-- Дөрвөн төрөл: session (тухайн яриа), personal (тогтвортой сонголт),
-- project (төслийн түүх), summary (хуучин ярианы хураангуй).
--
-- ⚠️ NAMESPACE НЬ ХАТУУ ТУСГААРЛАГДСАН.  `namespace` нь 'employee' эсвэл
--    'client' — нэг хүн хоёулаа байж БОЛОХГҮЙ учир хэрэглэгчийн role
--    өөрчлөгдвөл хуучин namespace-ийн санамж ШИНЭ горимд ХЭЗЭЭ Ч
--    уншигдахгүй.  §19-ийн «client and employee memory namespaces
--    completely separated» шаардлагыг ӨГӨГДЛИЙН түвшинд барина.
--
-- ⚠️ ЭМЗЭГ ШИНЖ ЧАНАР ХАДГАЛАХГҮЙ.  §18: MGL AI нь ажилтны эмзэг шинжийг
--    ТААМАГЛАХГҮЙ.  `kind` нь ХААЛТТАЙ олонлог бөгөөд «зан чанар»,
--    «чадвар үнэлгээ» гэсэн төрөл ЗОРИУД БАЙХГҮЙ — ур чадвар нь ERP-ийн
--    `assessments` модульд, хүнээр үнэлэгдэж амьдардаг.
--
-- ⚠️ `expires_at` нь §19-ийн хадгалах хугацааны бодлогыг барина.  NULL нь
--    «дуусахгүй» — зөвхөн personal төрөлд хүлээн зөвшөөрөгдөнө.
--
-- ⚠️ ТЭЭВРИЙН ДҮРЭМ: 4 statement, блок тайлбаргүй, тайлбар дотор цэг-таслалгүй.

CREATE TABLE IF NOT EXISTS ai_user_memories (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_uid   TEXT    NOT NULL UNIQUE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  namespace    TEXT    NOT NULL DEFAULT 'employee'
                 CHECK (namespace IN ('employee','client')),
  kind         TEXT    NOT NULL DEFAULT 'personal'
                 CHECK (kind IN ('session','personal','project','summary')),
  scope_key    TEXT,
  project_id   INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  conv_uid     TEXT,
  title        TEXT,
  body         TEXT    NOT NULL,
  body_folded  TEXT    NOT NULL DEFAULT '',
  weight       REAL    NOT NULL DEFAULT 1.0,
  source       TEXT    NOT NULL DEFAULT 'inferred'
                 CHECK (source IN ('stated','inferred','imported')),
  confirmed_by_user INTEGER NOT NULL DEFAULT 0 CHECK (confirmed_by_user IN (0,1)),
  hits         INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  expires_at   TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_mem_lookup ON ai_user_memories (user_id, namespace, kind, weight DESC);

CREATE INDEX IF NOT EXISTS idx_ai_mem_project ON ai_user_memories (project_id, namespace) WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_mem_expiry ON ai_user_memories (expires_at) WHERE expires_at IS NOT NULL;
