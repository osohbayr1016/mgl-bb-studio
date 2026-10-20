-- 0411 — Програмын хүсэлт: хүсэлтийн мөр (2026-10-16).
--
-- Нэг мөр = нэг хүсэлт (Revit-ийн хэрэгслээс эсвэл ERP-ээс).  Амьдралын мөчлөг:
--   draft (илгээгч өөрөө засна, хавсралт нэмнэ) → submit (атом: дугаар олгоно, status = received)
--   → triaged → in_progress → awaiting_info / ready_for_retest → resolved;  duplicate / rejected;  reopened.
-- Төлөв, төрөл, эх сурвалжийн утгын дүрэм кодонд (lib/engineeringFeedback.ts) — CHECK ЗОРИУД байхгүй
-- (шинэ утга нэмэхэд хүснэгт rebuild хийхгүйн тулд).
--
--   • id — тааварлах боломжгүй opaque (efr_…); number — хүнд харагдах дугаар (ПХ-0012), submit үед л.
--   • client_request_id — илгээгч тутамд idempotency (давхар дарах, timeout-ийн дараах давталт нэг мөр).
--   • payload_hash — submit үеийн агуулгын хэш: ижил client_request_id өөр агуулгаар ирвэл 409.
--   • submit_attempt — submit-ийн нэг оролдлогын nonce: D1 batch-ийн дагалдах мөрүүд (түүх, мэдэгдэл, хавсралтын
--     төлөв) ЗӨВХӨН энэ оролдлого ялсан үед бичигдэнэ (зэрэг ирсэн хоёр submit давхар мэдэгдэл үүсгэхгүй).
--   • mutation_nonce — триаж/retest-ийн batch бүрийн nonce (ижил зарчим).  Цаг (updated_at) нь ижил миллисекундэд
--     давхцаж болох тул хамгаалалт болохгүй (тестээр хэмжсэн).
--   • diagnostics_json — хувилбартай схем (diagnostics_schema); токен, нууц үг, signed URL ХЭЗЭЭ Ч орохгүй
--     (add-in ба сервер хоёулаа цэвэрлэнэ).
--   • reviewer_read_at < last_sender_activity_at ⇒ reviewer-т уншаагүй.
--   • version — optimistic concurrency (триаж зэрэг засахад дарж бичихгүй).
-- users руу FK байхгүй — хэрэглэгч устсан ч инженерийн түүх үлдэнэ.

CREATE TABLE IF NOT EXISTS engineering_requests (
  id                       TEXT    PRIMARY KEY,
  number                   INTEGER,
  client_request_id        TEXT    NOT NULL,
  submitter_user_id        INTEGER NOT NULL,
  recipient_user_id        INTEGER,
  channel                  TEXT    NOT NULL,
  source                   TEXT    NOT NULL,
  tool_id                  TEXT,
  source_context           TEXT,
  type                     TEXT    NOT NULL,
  title                    TEXT    NOT NULL DEFAULT '',
  description              TEXT    NOT NULL DEFAULT '',
  expected                 TEXT,
  actual                   TEXT,
  steps                    TEXT,
  suggestion               TEXT,
  impact                   TEXT,
  diagnostics_schema       TEXT,
  diagnostics_json         TEXT,
  revit_year               INTEGER,
  revit_build              TEXT,
  addin_version            TEXT,
  addin_sha256             TEXT,
  status                   TEXT    NOT NULL DEFAULT 'draft',
  priority                 TEXT    NOT NULL DEFAULT 'normal',
  duplicate_of             TEXT,
  payload_hash             TEXT,
  submit_attempt           TEXT,
  mutation_nonce           TEXT,
  reviewer_read_at         TEXT,
  last_sender_activity_at  TEXT,
  version                  INTEGER NOT NULL DEFAULT 1,
  created_at               TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT    NOT NULL DEFAULT (datetime('now')),
  submitted_at             TEXT,
  resolved_at              TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_engineering_requests_client
  ON engineering_requests (submitter_user_id, client_request_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_engineering_requests_number
  ON engineering_requests (number) WHERE number IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_engineering_requests_status
  ON engineering_requests (status, submitted_at);

CREATE INDEX IF NOT EXISTS ix_engineering_requests_submitter
  ON engineering_requests (submitter_user_id, created_at);
