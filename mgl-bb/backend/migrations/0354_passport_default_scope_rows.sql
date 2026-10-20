-- «1.2 Scope of work / Хамрах хүрээ» хүснэгтийг бөглөөгүй БҮХ төсөлд
-- өгөгдмөл 11 мөр (эзний хүсэлт 2026-09-28).
--
-- Шинэ төсөл 2026-09-25-аас хойш үүсгэх шидтэнгээр 11 мөртэй төрдөг
-- (`passportSections.ts` `defaultScopeRows`).  Түүнээс өмнөх төслүүд бүгд
-- хоосон байсан — 2026-09-28-нд прод дээр хэмжсэн: 31 төслөөс 15 нь паспорттой
-- ч `scope_rows_json` хоосон, 16 нь паспортын мөр огт байхгүй, бөглөсөн нь 0.
--
-- Мөр бүр ЗӨВХӨН DIC (`codeLabel`) ба Тодорхойлолт (`identification`)-той.
-- Файлын нэр, ахлах, мэргэжилтэн ЗОРИУД хоосон (эзэн: «File name оруулахгүйгээр»).
-- Id, код, шошго, нэр, дараалал нь `defaultScopeRows`-тэй ЯГ ижил (`sc-<код>`,
-- EZ ET BA BB HAS TSBU TSAH HD AU IZ GT).
--
-- ⚠️ Хэн нэгэн аль хэдийн бөглөсөн хүснэгтийг ХӨНДӨХГҮЙ — зөвхөн хоосон мөр.
-- `updated_at` / `updated_by_id`-ийг хөндөхгүй (хэрэглэгчийн засвар биш).
--
-- Буцаах:
--   UPDATE project_passport SET scope_rows_json = NULL WHERE scope_rows_json = '<доорх JSON>' -- (зөвхөн 15 мөр)
--   ба энэ миграцаар үүссэн 16 мөр (project_id 33 34 43 44 45 46 50 60 61 62 63 67 68 71 72 73)
--   бусад багана нь NULL хэвээр бол DELETE.

UPDATE project_passport
SET scope_rows_json = '[{"id":"sc-EZ","code":"EZ","codeLabel":"ЭЗ","identification":"Эскиз зураг","leader":"","specialist":"","fileName":""},{"id":"sc-ET","code":"ET","codeLabel":"ЕТ","identification":"Орчны ЕТ, өндөржилт","leader":"","specialist":"","fileName":""},{"id":"sc-BA","code":"BA","codeLabel":"БА","identification":"Барилга архитектур","leader":"","specialist":"","fileName":""},{"id":"sc-BB","code":"BB","codeLabel":"ББ","identification":"Барилга бүтээц","leader":"","specialist":"","fileName":""},{"id":"sc-HAS","code":"HAS","codeLabel":"ХАС","identification":"Халаалт агаар сэлгэлт","leader":"","specialist":"","fileName":""},{"id":"sc-TSBU","code":"TSBU","codeLabel":"ЦБУ","identification":"Дотор цэвэр бохир ус","leader":"","specialist":"","fileName":""},{"id":"sc-TSAH","code":"TSAH","codeLabel":"ЦАХ","identification":"Дотор цахилгаан","leader":"","specialist":"","fileName":""},{"id":"sc-HD","code":"HD","codeLabel":"ХД","identification":"Дотор холбоо дохиолол","leader":"","specialist":"","fileName":""},{"id":"sc-AU","code":"AU","codeLabel":"АУ","identification":"Автоматжуулалт","leader":"","specialist":"","fileName":""},{"id":"sc-IZ","code":"IZ","codeLabel":"ИЗ","identification":"Интерьер зураг","leader":"","specialist":"","fileName":""},{"id":"sc-GT","code":"GT","codeLabel":"ГТ","identification":"Гадна тохижилт","leader":"","specialist":"","fileName":""}]'
WHERE scope_rows_json IS NULL OR TRIM(scope_rows_json) IN ('', '[]');

INSERT INTO project_passport (project_id, scope_rows_json)
SELECT p.id, '[{"id":"sc-EZ","code":"EZ","codeLabel":"ЭЗ","identification":"Эскиз зураг","leader":"","specialist":"","fileName":""},{"id":"sc-ET","code":"ET","codeLabel":"ЕТ","identification":"Орчны ЕТ, өндөржилт","leader":"","specialist":"","fileName":""},{"id":"sc-BA","code":"BA","codeLabel":"БА","identification":"Барилга архитектур","leader":"","specialist":"","fileName":""},{"id":"sc-BB","code":"BB","codeLabel":"ББ","identification":"Барилга бүтээц","leader":"","specialist":"","fileName":""},{"id":"sc-HAS","code":"HAS","codeLabel":"ХАС","identification":"Халаалт агаар сэлгэлт","leader":"","specialist":"","fileName":""},{"id":"sc-TSBU","code":"TSBU","codeLabel":"ЦБУ","identification":"Дотор цэвэр бохир ус","leader":"","specialist":"","fileName":""},{"id":"sc-TSAH","code":"TSAH","codeLabel":"ЦАХ","identification":"Дотор цахилгаан","leader":"","specialist":"","fileName":""},{"id":"sc-HD","code":"HD","codeLabel":"ХД","identification":"Дотор холбоо дохиолол","leader":"","specialist":"","fileName":""},{"id":"sc-AU","code":"AU","codeLabel":"АУ","identification":"Автоматжуулалт","leader":"","specialist":"","fileName":""},{"id":"sc-IZ","code":"IZ","codeLabel":"ИЗ","identification":"Интерьер зураг","leader":"","specialist":"","fileName":""},{"id":"sc-GT","code":"GT","codeLabel":"ГТ","identification":"Гадна тохижилт","leader":"","specialist":"","fileName":""}]'
FROM projects p
WHERE NOT EXISTS (SELECT 1 FROM project_passport pp WHERE pp.project_id = p.id);
