-- =============================================================
-- 0275_mgl_ai_settings.sql — MGL AI · АЖИЛЛАХ ҮЕИЙН ТОХИРГОО
-- =============================================================
-- ⚠️ УТГА БҮР НЬ КОД ДАХЬ БОДИТ ӨГӨГДМӨЛТЭЙ ЯГ ТААРНА.  0195-ийн
--    `assistant.min_confidence` дээр сурсан сургамж: тааруулаагүй мөр нь
--    дараа уншсан хүнийг ТӨӨРӨГДҮҮЛНЭ.  Эх сурвалж нь
--    `backend/src/lib/mglai/settings.ts` — тэнд өөрчилвөл ЭНД ч биш,
--    ШИНЭ миграцаар засна (append-only).
--
-- ⚠️ `mglai.enabled` нь ГАНЦ том унтраалга.  0 үед `/api/mgl-ai` доорх бүх зам
--    503 буцаана — модулийн эрхээс (`entitlementGuard`) ТУСДАА, учир нь
--    энэ нь «худалдаж аваагүй» биш «түр зогсоосон» гэсэн утга.
--
-- ⚠️ `mglai.client_mode` — захиалагчийн горим.  Анхдагчаар УНТРААЛТТАЙ:
--    нийтийн мэдлэгийн хамрах хүрээ (§49) бодитоор дүүртэл захиалагчид
--    хариулт өгөх нь эрсдэлтэй.  Асаах нь эзний шийдвэр.
--
-- ⚠️ ТЭЭВРИЙН ДҮРЭМ: 8 statement, блок тайлбаргүй, тайлбар дотор цэг-таслалгүй.

INSERT OR IGNORE INTO app_settings (key, value) VALUES ('mglai.enabled', '1');

INSERT OR IGNORE INTO app_settings (key, value) VALUES ('mglai.client_mode', '0');

INSERT OR IGNORE INTO app_settings (key, value) VALUES ('mglai.model_family', 'mgl-ai');

INSERT OR IGNORE INTO app_settings (key, value) VALUES ('mglai.product_version', '1.0.0');

INSERT OR IGNORE INTO app_settings (key, value) VALUES ('mglai.max_tool_iterations', '8');

INSERT OR IGNORE INTO app_settings (key, value) VALUES ('mglai.context_tokens', '4096');

INSERT OR IGNORE INTO app_settings (key, value) VALUES ('mglai.retention_days', '90');

INSERT OR IGNORE INTO app_settings (key, value) VALUES ('mglai.evidence_top_k', '6');
