-- Ирцийн өдрийн баталгаажуулалт.
-- Админ/ахлах ажилтнаас тухайн (user_id, date)-ийн ирцийг баталгаажуулахыг
-- хүснэ → ажилтан "Зөв" (confirmed) эсвэл "Буруу" (disputed, тэмдэглэлтэй)
-- гэж хариулна.  Нэг ажилтан-нэг өдөрт нэг л мөр (UNIQUE), дахин хүсвэл
-- upsert хийж шинэчилнэ.  Precedent: attendance_project_checkpoints (0047),
-- leave_requests (0028).
CREATE TABLE IF NOT EXISTS attendance_confirmations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date          TEXT    NOT NULL,                       -- yyyy-mm-dd (UB)
  status        TEXT    NOT NULL DEFAULT 'requested'
                CHECK(status IN ('requested','confirmed','disputed')),
  requested_by  INTEGER NOT NULL REFERENCES users(id),
  requested_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  responded_at  TEXT,
  request_note  TEXT,                                   -- админы захиа (заавал биш)
  response_note TEXT,                                   -- 'disputed' үед заавал
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, date)
);
CREATE INDEX IF NOT EXISTS idx_att_confirm_user_status ON attendance_confirmations(user_id, status);
CREATE INDEX IF NOT EXISTS idx_att_confirm_date ON attendance_confirmations(date);
