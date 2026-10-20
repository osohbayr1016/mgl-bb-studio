-- 0329_asr_safety_acknowledgements.sql
-- Зохиогчийн хяналт: ХАБ-ын (хөдөлмөрийн аюулгүй байдал, эрүүл ахуй)
-- мэдээлэлтэй ТАНИЛЦСАН БАТАЛГАА — тайлан үүсгэхийн ӨМНӨХ заавал алхам
-- (эзний хүсэлт 2026-09-21).
--
-- Урсгал: «Шинэ тайлан» → ХАБ-ын мэдээллийг уншина → «ойлгосон» нүдийг
-- чагтална → гарын үсгээ зурна → баталгаажуулна → ЗӨВХӨН ТЭГЖ БАЙЖ
-- тайлангийн засварлагч нээгдэнэ.  Сервер тал: `POST /author-supervision/
-- projects/:id` нь энэ хүснэгтийн ХЭРЭГЛЭЭГҮЙ, ХҮЧИНТЭЙ мөрийн id-г
-- шаардана (routes/asrSafety.ts) — UI-д итгэдэггүй.
--
-- НЭГ МӨР = НЭГ ГАРЫН ҮСЭГ = НЭГ ТАЙЛАН.  Баталгаа нь профайлын хадгалсан
-- гарын үсэг БИШ, тухайн удаад ШИНЭЭР зурсан зураг: «энэ хүн энэ өдөр энэ
-- бичвэрийг уншиж гарын үсэг зурсан» гэдгийг хожим нотлох баримт.
--
-- user_id          -- users.id.  REFERENCES ЗОРИУД БАЙХГҮЙ (0279-ийн
--                     red_book_verified_by-тай ижил шалтгаан): users-т шинэ
--                     FK ирмэг нэмэх нь path-B rebuild + DELETE /api/users/:id
--                     гар устгалд мөр нэмнэ.  Нэрийг LEFT JOIN-оор уншина.
-- project_id       -- Гарын үсэг зурах мөчид төсөл мэдэгдэж байвал (төслийн
--                     таб / төслийн харагдац).  /app/asr-ын жагсаалтаас
--                     эхэлбэл төсөл ДАРАА нь сонгогддог тул NULL байж болно;
--                     эцсийн холбоос нь report_id.
-- content_version  -- Харуулсан бичвэрийн хувилбар (lib/asrSafety.ts).
-- content_hash     -- Тэр бичвэрийн SHA-256 — хувилбарын шошгыг мартсан ч
--                     ЯГ ямар бичвэрт гарын үсэг зурсныг нотолно.
-- signature_url    -- /media/<key>, зурсан/байршуулсан PNG (SignatureCapture).
-- acknowledged_at  -- ISO UTC, серверийн цаг.
-- report_id        -- Үүссэн тайлан.  Нэг баталгаа нэг л тайланд (UNIQUE,
--                     partial).  REFERENCES байхгүй — тайлан устахад мөр
--                     үлдэж баталгаа нь түүх болно.
-- used_at          -- Тайлантай холбогдсон агшин.
CREATE TABLE IF NOT EXISTS asr_safety_acknowledgements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  project_id INTEGER,
  content_version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  signature_url TEXT NOT NULL,
  acknowledged_at TEXT NOT NULL,
  report_id INTEGER,
  used_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_asr_safety_ack_report
  ON asr_safety_acknowledgements(report_id) WHERE report_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_asr_safety_ack_user
  ON asr_safety_acknowledgements(user_id, acknowledged_at DESC);
