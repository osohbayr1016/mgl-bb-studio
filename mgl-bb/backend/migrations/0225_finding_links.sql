-- =============================================================
-- 0225_finding_links.sql — олдвор <-> элемент / баг / олдвор холбоосууд
-- =============================================================
-- ЗОРИЛГО: §57 «affected element(s)» ОЛОН тоо, §60-R3 «affected teams» ОЛОН
-- тоо, §77 root-cause ГРАФ.  Гурвуулаа ОЛОН-ОЛОН харьцаа тул багана биш
-- ХОЛБОХ ХҮСНЭГТ.
--
-- ⚠️ ГАДААД ТҮЛХҮҮРИЙН ЗАРЛАЛ БАЙХГҮЙ (0224-ийн шалтгаан).  Хүүхдийг ГАРААР устгана —
--    репогийн заншил (email.ts, calendar.ts, pgp.ts, repair.ts).
--
-- ⚠️ ГУРВУУЛАНГИЙН ҮЙЛДВЭРЛЭГЧ НЬ POST /api/compliance/findings.  Хүснэгт
--    үүсгээд бичигчийг нь нэрлэхгүй орхивол 2-7-ийн INNER JOIN finding_teams
--    нь ЭЗЭМШИГЧ БАГТ Ч ХООСОН буцаана, §77-ийн граф МӨНХ ХООСОН үлдэнэ.
--    Аль мөрийг ХЭЗЭЭ бичихийг routes/compliance.ts-ийн 2-3 блокийн
--    «ЗААВАЛ бичих холбоос» хэсэг тодорхойлов.
--
-- ⚠️ ТЭЭВЭР: 3 хүснэгт + 4 индекс = 7 statement, блок тайлбаргүй, мөрөн
--    дотор цэг таслалгүй.
-- =============================================================

CREATE TABLE IF NOT EXISTS finding_elements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  finding_id    INTEGER NOT NULL,
  -- ⚠️ ТОГТВОРТОЙ түлхүүр (0204:105).  element_id нь ТОГТВОРГҮЙ — тойрог
  --    хийсний дараа өөр элемент рүү заана.
  element_uid   TEXT    NOT NULL,
  -- Зөвхөн ЭНЭ сессийн доторх хурдан doc.GetElement хайлтад.
  element_id    INTEGER,
  category      TEXT    NOT NULL DEFAULT '',
  level_name    TEXT    NOT NULL DEFAULT '',
  -- subject = дүрэм үүн дээр ажилласан, context = хэмжилтэд оролцсон
  -- (ж: хонгилын өргөнийг тодорхойлсон хоёр ханын хос).
  role          TEXT    NOT NULL DEFAULT 'subject' CHECK (role IN ('subject','context')),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS finding_teams (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  finding_id    INTEGER NOT NULL,
  -- ⚠️ КОД, id БИШ (0069-ийн заншил: баг дахин үрлэгдэхэд мөр амьд үлдэнэ).
  team_code     TEXT    NOT NULL,
  relation      TEXT    NOT NULL CHECK (relation IN ('owner','affected','responsible')),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS finding_edges (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  -- ⚠️ ЧИГЛЭЛ: from = ҮНДЭС, to = ҮР ДАГАВАР.  2-7 нь
  --    COUNT(*) WHERE to_finding_id = f.id-ыг caused_by_count гэж уншина,
  --    2-5 нь causes-ийн дээгүүр ДЭЭШ явж үндсийг олно.  Урвуулбал §77-ийн
  --    «1 үндэс + N үр дагавар» толин тусгал болж, хоёр уншигч хоёулаа мөр
  --    буцаах тул ХЭН Ч анзаарахгүй.
  from_finding_id  INTEGER NOT NULL,
  to_finding_id    INTEGER NOT NULL,
  -- §77 root-cause, §76-R3 бүлэглэл, §64 зөрчил.
  kind             TEXT    NOT NULL CHECK (kind IN ('causes','duplicates','conflicts_with')),
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fe_uniq
  ON finding_elements (finding_id, element_uid);

CREATE INDEX IF NOT EXISTS idx_fe_elem
  ON finding_elements (element_uid);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ft_uniq
  ON finding_teams (finding_id, team_code, relation);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fedge_uniq
  ON finding_edges (from_finding_id, to_finding_id, kind);
