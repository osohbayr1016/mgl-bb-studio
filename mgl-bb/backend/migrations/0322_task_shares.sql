-- =============================================================
-- 0322_task_shares.sql — Хамтарсан ажлын оноо хуваах (2026-09-17)
-- =============================================================
-- Нэг таскийг 2-3 хүн хамт хийсэн бол таскийн ОНООГ (user_points) хувиар
-- хуваана: «5%-ийн таскийг хоёулаа хийсэн → 2.5 / 2.5», эсвэл «би 80%,
-- нөгөө нь миний ажлыг ашиглаад дуусгасан → 80 / 20».
--
--   • Мөр байхгүй таск = хуучин ёсоор: илгээгч 100% (awardPointsForEntry).
--   • Мөртэй таск: явц ХЭН илгээснээс үл хамааран share_percent-ээр хуваана —
--     amount ба delta_pct хоёул хувиар үржигдэнэ, тиймээс хүмүүсийн
--     delta_pct нийлбэр төслийн явцтай тэнцэх инвариант (leaderboard.ts) хэвээр.
--   • Хуваарилалт ТАСК БҮХЭЛДЭЭ (ретроактив): хувь өөрчлөгдөхөд тэр таскийн
--     одоо байгаа user_points мөрүүд entry тус бүрээр дахин хуваагдана
--     (lib/taskShares.ts redistributeTaskPoints), recalculateProjectPoints ч
--     ижил хүснэгтийг уншина.
--   • is_owner = 1: таскийн анхны эзэн (хувийг засах эрхтэй).  Хамтрагчаар
--     нэмэгдсэн хүн (is_owner = 0) хувиа өөрөө өөрчилж чадахгүй — эс тэгвэл
--     хамтрагч өөртөө хувь татаж авна.
--   • added_to_assignees = 1: task_assignees мөрийг ЭНЭ feature үүсгэсэн —
--     хамтрагчийг хасахад тэр мөрийг буцааж устгана; admin-ий оноосон
--     хуваарилалтад хүрэхгүй.
--   • Rollup-д ОГТ ОРОХГҮЙ: явцын % хэвээр, зөвхөн оноо хуваагдана.
-- D1 нь FK-г runtime дээр хэрэгжүүлдэггүй тул tasks.delete гараар цэвэрлэнэ.
CREATE TABLE IF NOT EXISTS task_shares (
  task_id            INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  share_percent      REAL    NOT NULL CHECK (share_percent >= 0 AND share_percent <= 100),
  is_owner           INTEGER NOT NULL DEFAULT 0,
  added_to_assignees INTEGER NOT NULL DEFAULT 0,
  created_by         INTEGER REFERENCES users(id),
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (task_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_task_shares_user ON task_shares(user_id);
