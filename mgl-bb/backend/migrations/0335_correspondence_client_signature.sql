-- =============================================================
-- 0335_correspondence_client_signature.sql — RFI/CR захиалагчийн гарын үсэг — 2026-09-21
-- =============================================================
--
-- И-мэйл бүртгэлийн RFI/CR мөрийг захиалагчид ГАРЫН ҮСЭГ зуруулахаар илгээж,
-- захиалагч порталдаа (нэвтэрсэн) зурж баталгаажуулна.  Эзний шийдвэр
-- (2026-09-21): модуль = correspondence_log (шинэ хүснэгт БИШ), гарын үсэг =
-- портал дотор, баримт = шинээр үүсгэсэн RFI/CR PDF (print хуудас → Browser
-- Rendering, ASR-тай ижил зам).
--
--   • sign_status: none → pending (ажилтан хүсэлт) → signed (захиалагч зурсан).
--     signed нь ЭЦСИЙН — агуулгын талбарууд түгжигдэнэ (routes/correspondence.ts).
--   • client_signature_key: ХУВИЙН MEETING_BUCKET (`client/signatures/…`) —
--     /media нь нэвтрэлтгүй тул гарын үсгийн зураг тэнд байж БОЛОХГҮЙ.
--   • client_signer_name: зурсан мөчийн НЭРИЙН ХУУЛБАР — хэрэглэгч нэрээ
--     сольсон/идэвхгүй болсон ч баримт дээрх нэр хөдлөхгүй.
--   • pdf_key / pdf_generated_at: print хуудасны КЭШ.  Эх үнэн нь DB мөр —
--     кэш алга/хуучирсан бол GET /:id/pdf дахин рендерлэнэ.
-- Транспорт: 9 statement (хязгаар яг).
ALTER TABLE correspondence_log ADD COLUMN sign_status TEXT NOT NULL DEFAULT 'none' CHECK (sign_status IN ('none','pending','signed'));
ALTER TABLE correspondence_log ADD COLUMN sign_requested_at TEXT;
ALTER TABLE correspondence_log ADD COLUMN sign_requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE correspondence_log ADD COLUMN client_signature_key TEXT;
ALTER TABLE correspondence_log ADD COLUMN client_signed_at TEXT;
ALTER TABLE correspondence_log ADD COLUMN client_signed_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE correspondence_log ADD COLUMN client_signer_name TEXT;
ALTER TABLE correspondence_log ADD COLUMN pdf_key TEXT;
ALTER TABLE correspondence_log ADD COLUMN pdf_generated_at TEXT;
