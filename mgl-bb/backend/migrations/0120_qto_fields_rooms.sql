-- QTO талбарын өргөтгөл + өрөөний ведомость.
--
-- Revit-ийн бодит моделийн судалгаагаар (2026-07-03, TOYOTA):
--   - Type Mark (Хн3.6, ХБ-21х29...) төрлүүдийн 24%-д, Assembly Code 33%-д,
--     Keynote 24%-д бөглөгдсөн — төсөвчний гол түлхүүрүүд.
--   - Instance Mark нэг төрөлд дунджаар ~10 өөр утгатай тул бүлэглэлтийн
--     түлхүүрт ОРУУЛАХГҮЙ — түүвэр жагсаалт (marks) байдлаар хадгална.
--   - Давхаргын зузаан (thickness_mm) CompoundStructure-тэй 112/131 төрлөөс
--     гардаг — материалын мөрийн шинж чанар.
-- combo_key (category|type_name|material) ӨӨРЧЛӨГДӨХГҮЙ — шифр alias-ууд
-- хэвээр ажиллана; шинэ баганууд зөвхөн мэдээллийн зориулалттай, nullable
-- тул хуучин run-ууд хэвийн уншигдана.

ALTER TABLE qto_facts ADD COLUMN type_mark     TEXT;   -- төрлийн марк (Хн3.6)
ALTER TABLE qto_facts ADD COLUMN marks         TEXT;   -- instance марк түүвэр ("МХ-12, ХБ-21 +7")
ALTER TABLE qto_facts ADD COLUMN thickness_mm  REAL;   -- тухайн материалын давхаргын зузаан
ALTER TABLE qto_facts ADD COLUMN assembly_code TEXT;
ALTER TABLE qto_facts ADD COLUMN keynote       TEXT;

-- Өрөөний ведомость — run бүрд (BA host файлд л байдаг; талбайтай нь л ирнэ).
-- Интерьер заслын төсөв (шал/хана/таазны өнгөлгөө) өрөөгөөр м²-ээр бодогддог.
CREATE TABLE IF NOT EXISTS qto_rooms (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  qto_run_id  INTEGER NOT NULL REFERENCES qto_runs(id) ON DELETE CASCADE,
  number      TEXT NOT NULL DEFAULT '',
  name        TEXT NOT NULL DEFAULT '',
  level       TEXT NOT NULL DEFAULT '',
  area_m2     REAL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_qto_rooms_run     ON qto_rooms (qto_run_id);
CREATE INDEX IF NOT EXISTS idx_qto_rooms_project ON qto_rooms (project_id);
