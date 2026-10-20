-- 0412 — Програмын хүсэлт: хавсралтын мета өгөгдөл (2026-10-16).
--
-- БАЙТ нь ХУВИЙН R2-д (binding FEEDBACK_BUCKET, нийтийн домэйнгүй, r2.dev хаалттай) — энд зөвхөн мета.
-- /media/<key> зам ХЭЗЭЭ Ч буцаагдахгүй; татах нь зөвхөн reviewer-ийн баталгаажсан stream-ээр.
--
-- Шатлал (D1 ба R2 НЭГ transaction-д БАЙХГҮЙ тул төлөв бүр давтах боломжтой):
--   reserved  — сервер object_key (opaque, сервер үүсгэсэн) олгосон, байт хараахан ирээгүй;
--   uploading — multipart: R2 upload эхэлсэн, хэсгүүд parts_json-д;
--   ready     — сервер R2-д объект байгаа, бодит хэмжээ = мэдүүлсэн, (single бол) SHA-256 тулгасан;
--   aborted / failed / deleted — ашиглагдахгүй; цэвэрлэгч R2 объектыг устгана.
-- integrity:  server_sha256 = сервер stream-ээр бодсон бүтэн файлын SHA-256 (зөвхөн single upload);
--             multipart-д хэсэг бүрийн серверийн SHA-256 engineering_request_attachment_parts-д, бүтэн файлын хэш =
--             client_sha256 (клиентийн МЭДҮҮЛСЭН, сервер баталгаажуулаагүй).  R2-ийн multipart ETag бол SHA-256 БИШ.
-- r2_upload_id, object_key клиент рүү ХЭЗЭЭ Ч явахгүй.

CREATE TABLE IF NOT EXISTS engineering_request_attachments (
  id                    TEXT    PRIMARY KEY,
  request_id            TEXT    NOT NULL,
  owner_user_id         INTEGER NOT NULL,
  client_attachment_id  TEXT    NOT NULL,
  object_key            TEXT    NOT NULL,
  original_name         TEXT    NOT NULL,
  extension             TEXT    NOT NULL,
  media_type            TEXT    NOT NULL,
  kind                  TEXT    NOT NULL DEFAULT 'file',
  declared_size         INTEGER NOT NULL,
  actual_size           INTEGER,
  client_sha256         TEXT,
  server_sha256         TEXT,
  upload_mode           TEXT    NOT NULL,
  r2_upload_id          TEXT,
  part_size             INTEGER,
  state                 TEXT    NOT NULL DEFAULT 'reserved',
  expires_at            TEXT    NOT NULL,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  completed_at          TEXT,
  version               INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_engineering_request_attachments_client
  ON engineering_request_attachments (request_id, client_attachment_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_engineering_request_attachments_key
  ON engineering_request_attachments (object_key);

CREATE INDEX IF NOT EXISTS ix_engineering_request_attachments_state
  ON engineering_request_attachments (state, expires_at);

-- Multipart-ийн хэсэг бүр нэг мөр (зэрэг илгээсэн хэсгүүд нэг JSON-ийг дарж бичихгүй).  sha256 = СЕРВЕР stream-ээр
-- бодсон тухайн хэсгийн хэш; etag = R2-ийнх (SHA-256 биш, complete()-д л хэрэгтэй).
CREATE TABLE IF NOT EXISTS engineering_request_attachment_parts (
  attachment_id  TEXT    NOT NULL,
  part_number    INTEGER NOT NULL,
  etag           TEXT    NOT NULL,
  size           INTEGER NOT NULL,
  sha256         TEXT    NOT NULL,
  uploaded_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (attachment_id, part_number)
);
