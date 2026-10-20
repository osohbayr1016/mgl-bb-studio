-- 0402 — Managed онооны тулгалтын ДАХИН ОРОЛДОХ дараалал.
--
-- Таск/зургийн жин, төслийн төвөгшил өөрчлөгдөхөд managed (хуваарилагдсан) таскийн оноог журналаас шинэ
-- коэффициенттэй тулгадаг (lib/taskCreditReweight.ts).  Тэр алхам унавал өмнө нь `console.error` болж алга
-- болдог байв — жин засвар амжилттай, оноо хуучин коэффициентээр үлдэж, хэн ч мэддэггүй.
-- Одоо унасан тулгалт энд мөр болж үлдэнэ; 2 минутын cron (fail-safe салаа, ШИНЭ cron илэрхийлэлгүй) дахин
-- оролдоно; 8 оролдлогод `failed` болж аудитор (`CREDIT_RECONCILE_FAILED`) ба «Таскийн хуваарилалт» админ
-- хуудас харуулна.  Тулгалт өөрөө идемпотент тул давхар ажиллуулалт аюулгүй.
--
-- kind: 'task' (target_id = tasks.id) | 'project' (target_id = projects.id).  Нэг зорилтод нэг мөр — дахин
-- унавал оролдлогын тоолуур тэглэгдэж шинэ алдаа бичигдэнэ.  FK ЗОРИУД байхгүй: зорилт устсан бол sweep мөрийг хаяна.
CREATE TABLE IF NOT EXISTS task_credit_reconcile_queue (
  kind        TEXT    NOT NULL,
  target_id   INTEGER NOT NULL,
  actor_id    INTEGER NOT NULL DEFAULT 0,
  status      TEXT    NOT NULL DEFAULT 'pending',
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  enqueued_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (kind, target_id)
);

CREATE INDEX IF NOT EXISTS idx_tcrq_status ON task_credit_reconcile_queue (status, updated_at);
