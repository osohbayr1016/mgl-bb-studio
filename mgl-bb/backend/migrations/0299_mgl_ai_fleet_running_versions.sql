-- =============================================================
-- 0299_mgl_ai_fleet_running_versions.sql — MGL AI · ФЛОТ: АЖИЛЛАЖ БУЙ ХУВИЛБАР (Session B P0-6)
-- =============================================================
-- `versions_json` нь ХҮССЭН (заагч / installed.json) хувилбар.  Энэ багана нь
-- ажилтны PC дээрх ПРОЦЕСС өөрөө /info-д юу гэж хэлж байгааг хадгална
-- (package.json version, нээсэн мэдлэгийн сангийн хувилбар, ачаалсан загвар).
-- Хоёр нь зөрвөл health нь VERSION_MISMATCH → DEGRADED, READY БИШ.
--
-- ЗӨВХӨН ADD COLUMN — хүснэгт дахин барихгүй.  ТЭЭВРИЙН ДҮРЭМ: 1 statement.

ALTER TABLE ai_fleet_devices ADD COLUMN running_versions_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(running_versions_json));
