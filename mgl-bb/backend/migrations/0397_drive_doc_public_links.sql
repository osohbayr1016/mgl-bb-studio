-- 0397_drive_doc_public_links.sql
-- «Баримт бичиг» (Google Drive) дээрх Word баримтын НЭГ гарын үсгийн мөрөнд гаднын хүн
-- (захиалагч, зөвлөх) ERP-д нэвтрэхгүйгээр утсаараа гарын үсэг зурах хугацаатай link.
-- Зурсан даруйд сервер тэр гарын үсгийг Word ФАЙЛ ДЭЭР суулгаж ИЖИЛ Drive файлын шинэ
-- хувилбар болгоно (0371-ийн ажилтны урсгалтай НЭГ цөм — lib/docxSignFile.ts stampDocx).
--
-- 0381 (public_document_sign_requests) хүснэгтийг ЗОРИУД өргөтгөөгүй: тэнд kind/slot
-- нь CHECK-тэй, entity_id нь INTEGER — Drive-ын текст id ба мөрийн түлхүүрийг (t2r5c3)
-- оруулах нь хүснэгтийг дахин барих (rebuild) ажил болно.  Токены нэрийн орон зай нэг:
-- /public/signing/:token эхлээд ЭНЭ хүснэгтээс, олдохгүй бол 0381-ээс хайна.
--
-- АЮУЛГҮЙ БАЙДАЛ (0381-тэй ижил):
--   token_hash         -- SHA-256(token) л; түүхий токен DB-д ХЭЗЭЭ Ч үгүй.
--   status             -- pending | signing | signed | revoked | expired.  CHECK ЗОРИУД
--                         байхгүй (0371-ийн жишиг) — кодын тогтмол lib/drivePublicSigning.ts.
--                         signing = гарын үсгийг Drive руу бичиж буй түр төлөв (3 мин-ээс
--                         хуучин бол дахин pending гэж үзнэ) — цуцлах/давхар зурахаас хамгаална.
--   slot_*             -- link үүсгэх үеийн мөрийн хуулбар: баримт хооронд нь засагдвал
--                         зурахдаа мөрийг дахин тулгана (түлхүүр + үүргийн бичвэр).
--   document_snapshot_key/_sha256 -- зурсны дараах .docx-ийн яг хуулбар (ХУВИЙН
--                         MEETING_BUCKET) — «юун дээр зурсан» нотолгоо + зурсан хүнд 24 цаг
--                         харуулах.  IP хадгалахгүй.
-- users / projects руу REFERENCES ЗОРИУД БАЙХГҮЙ (0371-тэй ижил: аудит үлдэнэ).
CREATE TABLE IF NOT EXISTS drive_doc_public_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  file_id TEXT NOT NULL,
  root_folder_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  scope_id INTEGER NOT NULL,
  parent_id TEXT,
  file_name TEXT NOT NULL,
  slot_key TEXT NOT NULL,
  slot_group INTEGER NOT NULL DEFAULT 0,
  slot_role TEXT NOT NULL DEFAULT '',
  slot_position TEXT NOT NULL DEFAULT '',
  slot_name TEXT NOT NULL DEFAULT '',
  slot_client INTEGER NOT NULL DEFAULT 0,
  role_label TEXT NOT NULL,
  signer_name_hint TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  first_viewed_at TEXT,
  last_viewed_at TEXT,
  signing_started_at TEXT,
  signed_name TEXT,
  signed_position TEXT,
  signature_key TEXT,
  signature_sha256 TEXT,
  sign_event_id INTEGER,
  result_modified_time TEXT,
  document_snapshot_key TEXT,
  document_sha256 TEXT,
  signed_at TEXT,
  signed_user_agent TEXT,
  revoked_at TEXT,
  revoked_by INTEGER,
  revoke_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Нэг файлын нэг мөрөнд НЭГ л амьд link (шинийг үүсгэхэд хуучныг ижил batch-д цуцална).
CREATE UNIQUE INDEX IF NOT EXISTS ux_ddpl_live_slot
  ON drive_doc_public_links (file_id, slot_key)
  WHERE status IN ('pending', 'signing');

CREATE INDEX IF NOT EXISTS idx_ddpl_file ON drive_doc_public_links (file_id, id);

-- 0371-ийн үйл явдлын хүснэгтэд гаднын гарын үсэг: action = 'external', user_id = link
-- үүсгэсэн ажилтан, зурсан хүний нэр + link энд.
ALTER TABLE drive_doc_sign_events ADD COLUMN external_signer_name TEXT;

ALTER TABLE drive_doc_sign_events ADD COLUMN public_link_id INTEGER;
