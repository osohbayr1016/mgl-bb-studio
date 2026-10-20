-- 0347_internal_rules_rich_body.sql
-- Дотоод журам: засварлагч markdown textarea-аас «Мэдээ, зарлал»-тай ижил
-- rich-text (HTML) засварлагч болж, ФАЙЛ ХАВСРАЛТТАЙ болов (2026-09-25).
--
--   body_format      -- 'markdown' (0330-ийн хуучин мөр) | 'html' (шинэ засварлагч).
--                       body_md багана ХЭВЭЭР: html үед сервер цэвэрлэсэн HTML-ийг
--                       хадгална.  Баганын нэр түүхэн — rename хийвэл 0330-ийн
--                       бүх SELECT, тест, frontend төрлийг зэрэг хөдөлгөх шаардлагатай.
--   attachments_json -- хавсралтын жагсаалт (JSON массив) — объект бүр
--                       {id, key, name, size, content_type, sha256}.  Байт нь
--                       ХУВИЙН MEETING_BUCKET-ийн `rule-files/` угтварт (нийтийн
--                       /media биш), уншилт зөвхөн эрх шалгасан API замаар.
--                       NULL = хавсралтгүй.
--
-- internal_rule_versions нь ижил хоёр баганаар НИЙТЛЭХ агшны хуулбарыг авна —
-- ажилтны гарын үсэг тэр хувилбарын бие + ХАВСРАЛТАД холбогдоно (content_hash
-- хавсралтын sha256-ийг агуулна).  0330-ийн мөрүүд 'markdown' + NULL тул хэш нь
-- ӨӨРЧЛӨГДӨХГҮЙ (lib/internalRules.ts contentHashOf).
ALTER TABLE internal_rules ADD COLUMN body_format TEXT NOT NULL DEFAULT 'markdown' CHECK (body_format IN ('markdown','html'));
ALTER TABLE internal_rules ADD COLUMN attachments_json TEXT;
ALTER TABLE internal_rule_versions ADD COLUMN body_format TEXT NOT NULL DEFAULT 'markdown' CHECK (body_format IN ('markdown','html'));
ALTER TABLE internal_rule_versions ADD COLUMN attachments_json TEXT;
