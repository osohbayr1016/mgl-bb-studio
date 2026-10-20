-- 0381_public_document_signing.sql
-- Нэвтрэх эрхгүй (token-based) RFI/CR + Зохиогчийн хяналтын гарын үсэг.
--
-- АЮУЛГҮЙ БАЙДАЛ:
--   • raw token DB-д ХЭЗЭЭ Ч хадгалахгүй — зөвхөн SHA-256 hash.
--   • нэг entity/slot-д нэг л pending хүсэлт.
--   • хугацаатай, revoke хийж болно, signed бол дахин ашиглагдахгүй.
--   • гарын үсгийн байт хүснэгтэд биш R2-д; энд зөвхөн түлхүүр + SHA-256.
--   • IP хадгалахгүй. User-Agent нь аудитын туслах мэдээлэл.
CREATE TABLE IF NOT EXISTS public_document_sign_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('correspondence', 'asr')),
  entity_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('client', 'arch', 'site')),
  role_label TEXT NOT NULL,
  signer_name_hint TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'signed', 'revoked', 'expired')),
  requested_by INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  first_viewed_at TEXT,
  signed_name TEXT,
  signature_key TEXT,
  signature_sha256 TEXT,
  -- Гарын үсэг зурагдсаны ДАРААХ баримтын өөрчлөгдөхгүй PDF хуулбар + hash.
  -- Current record хожим засагдсан ч «яг юун дээр зурсан» нотолгоо үлдэнэ.
  document_snapshot_key TEXT,
  document_sha256 TEXT,
  signed_at TEXT,
  signed_user_agent TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_public_sign_pending_slot
  ON public_document_sign_requests (kind, entity_id, slot)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_public_sign_token_hash
  ON public_document_sign_requests (token_hash);

CREATE INDEX IF NOT EXISTS idx_public_sign_entity
  ON public_document_sign_requests (kind, entity_id, id DESC);

CREATE INDEX IF NOT EXISTS idx_public_sign_project_status
  ON public_document_sign_requests (project_id, status, id DESC);
