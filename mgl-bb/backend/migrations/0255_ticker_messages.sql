-- =============================================================
-- 0255 — Толгойн гүйдэг зурвасын АДМИН УДИРДЛАГА
--
-- Өмнө нь `/api/ticker` нь ес хатуу бичсэн мөрийг (ирц, хамгийн эрт
-- ирсэн, баяр, тэргүүлэгч, эрсдэл …) өгөгдлөөс өөрөө угсардаг байсан
-- бөгөөд админ түүнийг УНТРААХ ч, ТЕКСТИЙГ нь солих ч, өөрийн зарлал
-- НЭМЭХ ч аргагүй байв.  Энэ миграц хоёр хүснэгт нэмнэ:
--
--   • `ticker_messages`       — админаас бичсэн ЧӨЛӨӨТ мөрүүд;
--   • `ticker_builtin_prefs`  — суурин (автомат) мөр бүрийн тохиргоо
--                               (унтраах / текст-шошго-өнгийг дарж бичих).
--
-- ⚠️ Суурин мөрүүд DB-д БАЙХГҮЙ — тэдгээр нь код доторх асуулгууд.
--    Тиймээс `ticker_builtin_prefs.key` нь `routes/ticker.ts`-ийн
--    `BUILTIN_KEYS`-ийн мөр (attendance / earliest / event / holiday /
--    leader / oldest / overdue / stale / dueSoon).  FK байхгүй: түлхүүр
--    нь кодын өмч, DB-ийнх биш.  Кодоос мөр хассан бол энд үлдсэн
--    тохиргоо зүгээр л уншигдахгүй болно (хор хөнөөлгүй).
--
-- ЛОКАЛЧЛАЛ: сервер бэлэн ӨГҮҮЛБЭР буцаадаггүй (`textKey` + `params`)
-- тул админы бичсэн текстийг ХОЁР хэлээр хадгална.  `text_en` хоосон
-- бол frontend монголоор нь харуулна (`pickLocalized`-ийн дүрэм).
--
-- ЭРЭМБЭ: `sort_order` нь ХОЁР хүснэгтэд НЭГ орон зай — жижиг нь эхэлж
-- гүйнэ.  Суурин мөрүүдийн өгөгдмөл нь 10, 20, … 90 (кодод), админы
-- шинэ зарлал 0 авдаг тул автоматаар тэргүүнд орно.
-- =============================================================

CREATE TABLE IF NOT EXISTS ticker_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  text_mn    TEXT NOT NULL,
  text_en    TEXT,
  tag_mn     TEXT,
  tag_en     TEXT,
  tone       TEXT NOT NULL DEFAULT 'default'
             CHECK (tone IN ('danger', 'warning', 'success', 'info', 'default')),
  href       TEXT,
  is_active  INTEGER NOT NULL DEFAULT 1,
  starts_on  TEXT,
  ends_on    TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);

-- Гол унших хэлбэр: «идэвхтэй мөрүүд эрэмбээрээ» (толгой бүрт 60 сек тутам).
CREATE INDEX IF NOT EXISTS idx_ticker_messages_live
  ON ticker_messages(is_active, sort_order, id);

CREATE TABLE IF NOT EXISTS ticker_builtin_prefs (
  key        TEXT PRIMARY KEY,
  is_active  INTEGER NOT NULL DEFAULT 1,
  text_mn    TEXT,
  text_en    TEXT,
  tag_mn     TEXT,
  tag_en     TEXT,
  tone       TEXT,
  sort_order INTEGER,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT
);
