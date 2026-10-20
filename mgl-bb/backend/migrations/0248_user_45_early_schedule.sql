-- Мянганзул Пүрэвбаатар (id=45, @P.Myanganzul) — 08:00–17:00 ээлж.
-- Одоогийн mid (08:30–17:30) сонголтыг 2026-09-03-нээс дарж бичнэ.
INSERT INTO user_work_schedules (user_id, schedule, effective_from, created_by)
VALUES (45, 'early', '2026-09-03', NULL)
ON CONFLICT (user_id, effective_from) DO UPDATE SET
  schedule   = excluded.schedule,
  created_by = excluded.created_by,
  created_at = datetime('now');
