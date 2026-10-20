-- =============================================================
-- 0219_learning_events_team.sql — үйл явдал бүрийн БАГ, bind зардалгүй
-- =============================================================
-- ЗОРИЛГО: §72 нь цуглуулсан мөр бүр багаар шошголсон байхыг шаарддаг.
--
-- ⚠️ ЯАГААД GENERATED VIRTUAL, БОДИТ БАГАНА БИШ ВЭ — ХОЁР ШАЛТГААН:
--   (1) 0206-ын `learning_events_append_only` триггер нь UPDATE-ийг ABORT
--       болгодог тул бодит багана нь ХУУЧИН МӨРӨНД ХЭЗЭЭ Ч дүүргэгдэхгүй,
--       БҮРМӨСӨН NULL үлдэнэ.
--   (2) EVENT_BINDS 23 -> 25 нь `floor(100/24)=4`-ийг `floor(100/26)=3`
--       болгоно — хамгийн их урсгалтай хүснэгт дээр 25% алдагдал.  Эзний
--       Ш3 шийдвэр нь `bim_sessions`-ийн урсгалыг ЗОРИУД золиослосон;
--       `learning_events` нь тэр золиослолоос ГАДНА үлдэх ёстой.
--   VIRTUAL нь bind = 0, хуучин мөрүүд payload-аасаа шууд шийдэгдэнэ.
--
-- ⚠️ ХАМГИЙН ЧУХАЛ ДҮРЭМ — ҮЙЛ ЯВДЛЫН БАГЫГ JOIN-ААР ШИЙДЭХГҮЙ.
-- `BimEmitter` нь `team_code` / `team_source`-ыг БИЧИХ МӨЧИД `payload_json`
-- руу ХӨЛДӨӨНӨ (`bimEvents.ts`-ийн `stampTeam`).  Хэрэв багийг
-- `bim_sessions` руу JOIN хийж шийдвэл §73-ын залруулга (нэг хувьсдаг
-- мөрийн UPDATE) нь хэдэн зуун ХӨДӨЛШГҮЙ мөрийн утгыг ЧИМЭЭГҮЙ дахин
-- шошголно: IZ-ийн дүрмээр гаргасан 400 шийдвэр нь маргааш «BA, гараар
-- баталгаажсан» болж, BA-гийн сургалтын корпусыг хордуулна.
--
-- ⚠️ Индекслэгдсэн GENERATED баганыг DROP хийхэд ЭХЛЭЭД индексийг устгана
-- (1B-1 §2.5-ын хэмжилт).  JSON түлхүүрийн нэрийг НЭГ УДАА зөв тогтоо.
--
-- ⚠️ `idx_le_session` нь §2.11-д хэмжсэн дутагдлыг засаж байна —
-- `0205:108`-ын `session_id` дээр өнөөдөр индекс БАЙХГҮЙ, тиймээс багаар
-- шүүх бүр бүтэн хүснэгтийн скан болно.
--
-- ⚠️ ТЭЭВЭР: 5 statement (тааз 9), блок тайлбаргүй.
-- =============================================================

ALTER TABLE learning_events ADD COLUMN team_code TEXT
  GENERATED ALWAYS AS (json_extract(payload_json, '$.team_code')) VIRTUAL;

ALTER TABLE learning_events ADD COLUMN team_source TEXT
  GENERATED ALWAYS AS (json_extract(payload_json, '$.team_source')) VIRTUAL;

CREATE INDEX IF NOT EXISTS idx_le_session
  ON learning_events (session_id, id) WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_le_team
  ON learning_events (team_code, occurred_at) WHERE team_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_le_team_source
  ON learning_events (team_source, occurred_at) WHERE team_source IS NOT NULL;
