-- 0311 — Ажилтны ХҮНИЙ НӨӨЦИЙН мэдээлэл («Тайлан» хуудасны HR карт, зөвхөн admin).
--
-- `users`-т багана НЭМЭХГҮЙ, тусдаа 1:1 хүснэгт: (1) users-ийг rebuild хийх
-- эрсдэлгүй; (2) GET /api/users энэ хүснэгтийг хэзээ ч JOIN хийхгүй тул
-- нууц үг тэр жагсаалтаар алдагдахгүй; (3) DELETE /api/users/:id гараар
-- устгана (D1 FK гүйцэтгэдэггүй — репогийн конвенц).
--
-- ⚠️ pc_password нь ИЛ ТЕКСТ — ЭЗНИЙ ШИЙДВЭР (2026-09-15): энэ нь системийн
--    нэвтрэх нууц үг БИШ, ажилтны компьютерийн Windows нууц үг бөгөөд админ
--    гараар оруулж, шаардлагатай үед уншдаг.  Цорын ганц уншигч нь
--    GET /api/reports/employees/:id/hr.  MCP, GET /api/users, лог-д хэзээ ч
--    орохгүй.
-- contract_type нь TS-д шалгагдана (permanent | fixed_term | probation |
-- contractor | other) — CHECK-гүй тул төрөл нэмэхэд rebuild хэрэггүй.
-- contract_file_key нь ХУВИЙН MEETING_BUCKET-ийн `hr/` угтвартай түлхүүр —
-- /media-д ХЭЗЭЭ Ч тавихгүй (CLAUDE.md аюулгүй байдал #2).
CREATE TABLE IF NOT EXISTS employee_hr (
  user_id               INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  hired_at              TEXT,
  probation_end         TEXT,
  contract_no           TEXT,
  contract_type         TEXT,
  contract_start        TEXT,
  contract_end          TEXT,
  contract_file_key     TEXT,
  contract_file_name    TEXT,
  contract_file_size    INTEGER,
  contract_uploaded_at  TEXT,
  pc_username           TEXT,
  pc_password           TEXT,
  phone                 TEXT,
  notes                 TEXT,
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_by            INTEGER REFERENCES users(id)
);
