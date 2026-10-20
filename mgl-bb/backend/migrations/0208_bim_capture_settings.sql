-- =============================================================
-- 0208_bim_capture_settings.sql — BIM бүртгэлийн ТОХИРУУЛГЫН ДУГУЙНУУД
-- =============================================================
-- 0203 ба 0205-аас ТУСГААРЛАВ.  INSERT OR IGNORE тул дахин ажиллуулж болно.
-- ⚠️ ТЭЭВРИЙН ДҮРЭМ (2026-08-27-нд хаягдах алсын D1 дээр хэмжив).
-- `wrangler d1 migrations apply` нь файлыг d1_migrations-ийн INSERT-тэй
-- залгаад НЭГ --command болгож D1-ийн /query руу илгээдэг.  Тэр задлагч нь
--   (1) блок тайлбарыг (slash-star хэлбэр) ОЙЛГОДОГГҮЙ,
--   (2) мөрөн доторх ; -ээр ХУВААДАГ,
--   (3) нэг дуудлагад олон statement байвал унадаг.
-- Иймд ФАЙЛ БҮР <= 9 statement, блок тайлбаргүй, мөрөн дотор ; -гүй байна.

INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('bim.capture.mode', 'full');            -- full | salient | meta | off

INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('bim.capture.elements_per_txn', '24');

INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('bim.capture.elements_per_session', '4000');

INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('bim.capture.element_sample_n', '8');

-- `routes/revit.ts:1628`-ийн `MAX_LOG_BATCH = 200`-той нэг мөр.
INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('bim.capture.txn_batch_max', '200');

INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('bim.capture.artifact_max_bytes', '2097152');

-- ⚠️ АЖИЛТАНД ҮЗҮҮЛСЭН МЭДЭГДЛИЙН ХУВИЛБАР.  Эзэн «мэдэгдэнэ, татгалзах
--    товч байхгүй» гэж шийдсэн тул МЭДЭГДЭЛ нь цорын ганц хууль зүйн
--    суурь болно.  Текст өөрчлөгдвөл ЭНЭ УТГЫГ ӨӨРЧИЛ —
--    `bim_sessions.notice_version` түүнийг сесс бүрд тамгална.
INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('bim.capture.notice_version', '2026-09-01');

INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('bim.events.logging', 'on');
