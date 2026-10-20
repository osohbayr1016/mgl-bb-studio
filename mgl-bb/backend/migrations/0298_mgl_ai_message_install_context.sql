-- =============================================================
-- 0298_mgl_ai_message_install_context.sql — MGL AI · МЕССЕЖ ↔ СУУЛГАЦЫН ХУВИЛБАРЫН ТАМГА
-- =============================================================
-- Session B (§20).  «Ижил асуулт өөр релиз дээр өөр ажилладаг» — тиймээс
-- санал хүсэлт бүр ямар app/runtime/model/knowledge/normRegistry хувилбар
-- дээр гарсныг мэдэх ёстой.
--
-- ⚠️ ЯАГААД `ai_feedback`-Д БАГАНА НЭМЭХГҮЙ ВЭ.  `POST /feedback` нь
--    `routes/mglAi.ts`-д — тэр файлыг Session A зэрэг засаж байгаа.  Тусдаа
--    хүснэгт + тусдаа route (`/fleet/message-context`) нь тэр файлд ГАНЦ Ч
--    мөр хөндөхгүй, харин алдааны inbox нь `msg_uid`-аар JOIN хийж тамгыг авна.
--
-- ⚠️ `installation_id` нь ХӨТЧӨӨС ирнэ (локал runtime-ийн /info-оос уншсан),
--    хардверийн хээ биш — санамсаргүй UUID.
--
-- ⚠️ ТЭЭВРИЙН ДҮРЭМ: 2 statement, блок тайлбаргүй, тайлбар дотор цэг-таслалгүй.

CREATE TABLE IF NOT EXISTS ai_message_install_context (
  msg_uid          TEXT    PRIMARY KEY,
  conv_uid         TEXT,
  installation_id  TEXT,
  versions_json    TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(versions_json)),
  channel          TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_msg_ctx_install ON ai_message_install_context (installation_id, created_at DESC);
