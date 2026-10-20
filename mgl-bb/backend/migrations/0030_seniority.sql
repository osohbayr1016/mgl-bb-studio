-- Ажилтны түвшин (seniority) — engineer / architect track-уудын
-- ажил мэргэшлийн зэргийг хадгална.  Track өөрөө `users.team_id`-ээс
-- (BA = architecture, бусад техникийн баг = engineer, MGMT = management)
-- автоматаар гарна, тиймээс зөвхөн "level"-ийг л хадгална.
--
--   senior        — Ахлах
--   intermediate  — Дунд (mid-level)
--   junior        — Бага
--   intern        — Дадлагажигч
--
-- NULL = тогтоогоогүй / хамаарахгүй (жишээ нь client, MGMT эхэн үе).
ALTER TABLE users
  ADD COLUMN seniority TEXT
  CHECK (seniority IN ('senior','intermediate','junior','intern'));

CREATE INDEX IF NOT EXISTS idx_users_seniority ON users(seniority);
