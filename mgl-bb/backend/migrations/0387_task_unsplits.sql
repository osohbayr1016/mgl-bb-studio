-- 0387 — «ХУВААЛТЫГ ЦУЦЛАХ» архив (эзэн 2026-10-06).
--
-- Хуваарилагдсан (managed) таскийг «огт хуваагаагүй, юу ч хийгээгүй» мэт АНХНЫ байдалд буцаана
-- (`lib/taskUnsplit.ts`): хуваалтаас хойш үүссэн хуваарилалт, журнал, явцын projection (`source IN ('alloc','alloc_adj')`)
-- ба тэдгээрийн оноо (`user_points.contribution_id`) УСТАНА.  Хуваалтаас ӨМНӨХ түүх (хуучин явц, оноо) ХЭВЭЭР — seed нь
-- хуучин оноог зөвхөн лавласан тул.  Цагийн сэшн устахгүй.
--
-- Устгасан бүхэн энд JSON-оор (буцааж сэргээх, аудит).  request_id UNIQUE — ижил хүсэлт давтагдвал нэг л удаа.
-- tasks/users руу FK ЗОРИУД байхгүй (0376-тай ижил) — устгалыг гараар.

CREATE TABLE IF NOT EXISTS task_unsplits (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id         TEXT    NOT NULL UNIQUE,
  task_id            INTEGER NOT NULL,
  actor_id           INTEGER NOT NULL,
  unsplit_at         TEXT    NOT NULL,
  root_revision      INTEGER NOT NULL,
  root_json          TEXT    NOT NULL,
  allocations_json   TEXT    NOT NULL,
  contributions_json TEXT    NOT NULL,
  points_json        TEXT    NOT NULL,
  entries_json       TEXT    NOT NULL,
  progress_before    REAL,
  progress_after     REAL,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_task_unsplits_task ON task_unsplits (task_id, unsplit_at);
