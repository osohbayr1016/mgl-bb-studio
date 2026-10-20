-- =============================================
-- Ирц/чөлөөний админ үйлдлийн audit лог + админ-үүсгэсэн бичлэгийн marker.
--
-- 1) attendance_admin_logs — админ (эсвэл ахлах) ирц/чөлөөн дээр хийсэн
--    бүх гар үйлдлийг нэг урсгалд бичнэ: ирц нөхөж бүртгэх, гарах цаг
--    нөхөх, нөхсөн ирц устгах, чөлөө шууд бүртгэх/зөвшөөрөх/татгалзах/
--    цуцлах/устгах.  UI-н "Лог" tab эндээс уншина.  Append-only.
-- 2) attendance_sessions.created_by — админ ГАРААР нөхөж үүсгэсэн
--    session-ы үүсгэгч (NULL = ажилтан өөрөө clock-in хийсэн organic
--    бичлэг).  Зөвхөн created_by NOT NULL бичлэгийг админ устгаж болно.
-- 3) leave_requests.created_by — админ ажилтны өмнөөс шууд бүртгэсэн
--    чөлөөний үүсгэгч (NULL = ажилтан өөрөө хүсэлт гаргасан).
-- =============================================

CREATE TABLE attendance_admin_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER NOT NULL REFERENCES users(id),
  target_user_id INTEGER REFERENCES users(id),
  -- 'session_create' | 'session_clock_out' | 'session_delete'
  -- | 'leave_create' | 'leave_approve' | 'leave_reject'
  -- | 'leave_cancel' | 'leave_delete'
  action TEXT NOT NULL,
  -- Хамаарах огноо (ирцийн өдөр / чөлөөний эхлэх огноо).
  date TEXT,
  -- Хүний унших тайлбар (цаг, тэмдэглэл г.м.) — UI шууд харуулна.
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_attendance_admin_logs_created
  ON attendance_admin_logs(created_at DESC);
CREATE INDEX idx_attendance_admin_logs_target
  ON attendance_admin_logs(target_user_id);

ALTER TABLE attendance_sessions ADD COLUMN created_by INTEGER REFERENCES users(id);
ALTER TABLE leave_requests ADD COLUMN created_by INTEGER REFERENCES users(id);
