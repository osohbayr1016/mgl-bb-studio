-- =============================================================
-- 0297_mgl_ai_release_registries.sql — MGL AI · ЗАГВАРЫН НЭР ДЭВШИГЧ ба МЭДЛЭГИЙН РЕЛИЗИЙН БҮРТГЭЛ
-- =============================================================
-- Session B (§25, §26).  ЗАГВАР ба МЭДЛЭГ нь ТУСДАА хүснэгт, тусдаа
-- амьдралын мөчлөгтэй — мэдлэгийн релиз QLoRA шаарддаггүй, загварын релиз
-- мэдлэгийг дахин барьдаггүй.
--
-- ⚠️ `ai_model_releases` (0270) ХЭВЭЭР — тэр нь «ажилтан руу ТҮГЭЭГДЭЖ
--    БУЙ» артефакт (license_cleared + eval_passed хаалгатай).  ЭНЭ хүснэгт
--    нь түүнээс ӨМНӨХ шат: сургалт → нэр дэвшигч → үнэлгээ → батлагдсан.
--    PRODUCTION болсон мөр л 0270-д артефакт болж орно (гараар, админ).
--    Энэ миграц ямар ч загварыг ПРОМОУШН ХИЙХГҮЙ.
--
-- ⚠️ `ai_knowledge_releases` нь БАГЦЛАЛТ/ТЭЭВРИЙН бүртгэл.  Норматив
--    компиляцийн үнэн (баримт, дүрэм, баталгаажилт) Session A-ийн эзэмшил —
--    `validation_json` нь тэр pipeline-ийн гаргасан хураангуйг ХАДГАЛНА, дахин
--    тооцохгүй.
--
-- ⚠️ ТЭЭВРИЙН ДҮРЭМ: 4 statement, блок тайлбаргүй, тайлбар дотор цэг-таслалгүй.

CREATE TABLE IF NOT EXISTS ai_model_candidates (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  release_id            TEXT    NOT NULL UNIQUE,
  base_model            TEXT    NOT NULL,
  base_sha256           TEXT,
  adapter_name          TEXT,
  adapter_sha256        TEXT,
  training_dataset_id   TEXT,
  dataset_sha256        TEXT,
  training_config_json  TEXT    CHECK (training_config_json IS NULL OR json_valid(training_config_json)),
  benchmark_json        TEXT    CHECK (benchmark_json IS NULL OR json_valid(benchmark_json)),
  status                TEXT    NOT NULL DEFAULT 'TRAINING'
                          CHECK (status IN ('TRAINING','CANDIDATE','FAILED','APPROVED','CANARY','PRODUCTION','ROLLED_BACK','ARCHIVED')),
  model_release_uid     TEXT,
  note                  TEXT,
  created_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_model_candidate_status ON ai_model_candidates (status, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_knowledge_releases (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  knowledge_release_id      TEXT    NOT NULL UNIQUE,
  manifest_json             TEXT    NOT NULL CHECK (json_valid(manifest_json)),
  document_count            INTEGER,
  dataset_shas_json         TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(dataset_shas_json)),
  compiled_registry_version TEXT,
  retrieval_index_version   TEXT,
  schema_version            TEXT,
  validation_json           TEXT    CHECK (validation_json IS NULL OR json_valid(validation_json)),
  artifact_url              TEXT,
  artifact_sha256           TEXT,
  artifact_bytes            INTEGER,
  status                    TEXT    NOT NULL DEFAULT 'CANDIDATE'
                              CHECK (status IN ('CANDIDATE','VALIDATED','APPROVED','CANARY','STABLE','ROLLED_BACK','ARCHIVED')),
  knowledge_pack_id         INTEGER REFERENCES ai_knowledge_packs(id) ON DELETE SET NULL,
  note                      TEXT,
  created_by                INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_by               INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at                TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at                TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_release_status ON ai_knowledge_releases (status, created_at DESC);
