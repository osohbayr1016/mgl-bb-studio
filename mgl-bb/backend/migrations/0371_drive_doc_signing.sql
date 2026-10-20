-- 0371_drive_doc_signing.sql
-- «Баримт бичиг» (Google Drive) дээрх Word баримтад — эхлээд RFI — ажилтан
-- профайлын гарын үсгээрээ НЭГ товчоор зурж, дараа нь захирал НЭГ товчоор
-- батална (эзний хүсэлт 2026-10-01).  Гарын үсэг нь Word ФАЙЛ ДЭЭР суугаад
-- ИЖИЛ Drive файлын шинэ хувилбар болно (lib/docxSign.ts, routes/driveSigning.ts).
-- Эдгээр хүснэгт нь зөвхөн «хэн, хэзээ, аль мөрөнд» гэсэн аудит ба
-- захирлын батлах дараалал — баримтын агуулга Drive дээр.
--
-- drive_doc_sign_events   -- append-only үйл явдал.
--   action               -- sign (ажилтан зурав) | approve (захирал батлав) |
--                           ask (хамт олноос гарын үсэг хүсэв).
--   slot_*               -- зурах мөчийн мөрийн бичвэрийн хуулбар (баримт
--                           дараа засагдсан ч аудит үлдэнэ).
--   docx_mark            -- Word дотор суусан зургийн тэмдэг (wp:docPr name
--                           «mgl-sign-…») — баримтыг уншихад ЭНЭ мөртэй холбогдоно.
--   signature_key/_sha256 -- ХУВИЙН MEETING_BUCKET дахь профайлын гарын
--                           үсгийн хуулбар (doc-signatures/…) — профайлын
--                           объект солигдоход lib/mediaReplace.ts хуучныг устгадаг.
--   result_modified_time -- манай байршуулсан хувилбарын Drive modifiedTime —
--                           «сүүлд зурснаас хойш файл өөрчлөгдсөн үү» шалгалт.
-- drive_doc_sign_requests -- захирлын батлах хүсэлт: pending → approved |
--                           returned | cancelled.  Файл бүрд НЭГ л pending
--                           (partial UNIQUE).  Төлөвийн CHECK ЗОРИУД байхгүй —
--                           жагсаалт өргөсөхөд rebuild хэрэггүй, кодын тогтмол.
-- drive_doc_sign_locks    -- нэг файлд зэрэг хоёр хүн зурахад нэг нь нөгөөгийнхөө
--                           хувилбарыг дарахаас сэргийлнэ (90 сек-ээс хуучин бол дахин авна).
--
-- users / projects руу REFERENCES ЗОРИУД БАЙХГҮЙ (0329/0330/0338-тай ижил):
-- users-т FK нэмэх нь path-B rebuild, аудит нь хэрэглэгч устсан ч үлдэнэ.
CREATE TABLE IF NOT EXISTS drive_doc_sign_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id TEXT NOT NULL,
  root_folder_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  scope_id INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  action TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  target_user_id INTEGER,
  slot_key TEXT,
  slot_role TEXT,
  slot_position TEXT,
  slot_name TEXT,
  approver_slot INTEGER NOT NULL DEFAULT 0,
  name_override INTEGER NOT NULL DEFAULT 0,
  docx_mark TEXT,
  filled_json TEXT,
  signature_key TEXT,
  signature_sha256 TEXT,
  base_modified_time TEXT,
  result_modified_time TEXT,
  result_md5 TEXT,
  request_id INTEGER,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ddse_file ON drive_doc_sign_events (file_id, id);

CREATE INDEX IF NOT EXISTS idx_ddse_target ON drive_doc_sign_events (target_user_id, action, id);

CREATE TABLE IF NOT EXISTS drive_doc_sign_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id TEXT NOT NULL,
  root_folder_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  scope_id INTEGER NOT NULL,
  parent_id TEXT,
  file_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by INTEGER NOT NULL,
  approver_id INTEGER NOT NULL,
  note TEXT,
  decided_by INTEGER,
  decided_at TEXT,
  decision_note TEXT,
  approve_event_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_ddsr_pending ON drive_doc_sign_requests (file_id) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_ddsr_approver ON drive_doc_sign_requests (approver_id, status, id);

CREATE INDEX IF NOT EXISTS idx_ddsr_file ON drive_doc_sign_requests (file_id, id);

CREATE TABLE IF NOT EXISTS drive_doc_sign_locks (
  file_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  token TEXT NOT NULL,
  locked_at TEXT NOT NULL
);
