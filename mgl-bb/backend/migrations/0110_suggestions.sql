-- =============================================================
-- Санал хүсэлт (Employee suggestions / requests)
-- =============================================================
-- Урсгал (хэрэглэгчийн өгсөн timeline):
--   received    → Хүлээж авсан      (ажилтан илгээмэгц)
--   discussing  → Хэлэлцэж байна     (admin хэлэлцэж эхлэв)
--   resolved    → Шийдвэрлэгдсэн     (resolution: approved=тийм / rejected=үгүй)
--
-- Зөвхөн admin хүлээн авч явцыг ахиулна.  Ажилтан хүсвэл нэрээ нууцлан
-- (is_anonymous=1) илгээж болох тул admin талд нэрийг нь нуудаг (route талд).
CREATE TABLE IF NOT EXISTS suggestions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_anonymous  INTEGER NOT NULL DEFAULT 0,            -- 1 = нэрээ нууцалсан
  title         TEXT    NOT NULL,
  description   TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'received'
                CHECK(status IN ('received','discussing','resolved')),
  -- Зөвхөн status='resolved' үед утгатай: approved=тийм, rejected=үгүй.
  resolution    TEXT    CHECK(resolution IN ('approved','rejected')),
  reviewer_id   INTEGER REFERENCES users(id),         -- явцыг ахиулсан admin
  reviewer_note TEXT,
  decided_at    TEXT,                                 -- resolved болсон огноо
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_suggestions_user   ON suggestions(user_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_status ON suggestions(status);
CREATE INDEX IF NOT EXISTS idx_suggestions_created ON suggestions(created_at DESC);
