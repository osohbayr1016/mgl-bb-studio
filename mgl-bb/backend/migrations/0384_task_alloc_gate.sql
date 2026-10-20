-- 0384 — ТАСКИЙН ХУВААРИЛТЫН ИДЭВХЖҮҮЛЭЛТИЙН ХААЛГА (2026-10-05).
--
-- Managed хуваарилалтыг сервер дээр асаах, унтраах, ОСЛЫН ҮЕД түр хаах нэг газар:
--   app_settings['task_alloc.state'] = 'disabled' | 'enabled' | 'paused'
--     disabled — шинэ managed мутаци хаалттай, унших ба хуучин (managed биш) таскийн зан төлөв хэвээр
--     enabled  — ажиллана
--     paused   — унших хэвээр, бүх managed мутаци 423 (түүх, оноо, цаг УСТАХГҮЙ)
--   Мөр байхгүй эсвэл буруу утга = paused (код талын fail-safe, backend/src/lib/taskAllocGate.ts).
--
-- Анхны утга: managed root аль хэдийн байвал paused (хэрэглэгчид идэвхтэй ашигласан тул устгахгүй,
-- гэхдээ админ шалгаж дахин идэвхжүүлэх хүртэл мутаци хаалттай).  Байхгүй бол disabled.
-- Release-ийн дараалал: миграц → worker → Pages → paused/disabled дээр шалгалт → хөрвүүлэлт → идэвхжүүлэлт.
--
-- task_alloc_state_log — төлөв солилт бүр нэг мөр (append-only): хэн, хэзээ, яагаад.
-- Анхны мөрийг миграц өөрөө бичнэ (actor_id NULL).  users руу FK-гүй (сүүлийн миграцуудын жишгээр).
-- Нэмэлт миграц — хуучин worker энэ хүснэгт, мөрийг үл тоож ажилласаар байна.

CREATE TABLE IF NOT EXISTS task_alloc_state_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  from_state TEXT,
  to_state   TEXT    NOT NULL CHECK (to_state IN ('disabled', 'enabled', 'paused')),
  actor_id   INTEGER,
  reason     TEXT,
  contract   INTEGER NOT NULL,
  at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO app_settings (key, value, updated_at)
SELECT 'task_alloc.state',
       CASE WHEN EXISTS (SELECT 1 FROM task_roots) THEN 'paused' ELSE 'disabled' END,
       datetime('now');

INSERT INTO task_alloc_state_log (from_state, to_state, actor_id, reason, contract)
SELECT NULL, s.value, NULL, 'migration 0384 seed', 1
  FROM app_settings s
 WHERE s.key = 'task_alloc.state'
   AND NOT EXISTS (SELECT 1 FROM task_alloc_state_log);
