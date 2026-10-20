-- =============================================================
-- 0229_rule_run_ledger.sql — §61-ийн ГҮЙЛТИЙН БҮРТГЭЛ
-- =============================================================
-- ЗОРИЛГО: «энэ дүрэм ҮНЭХЭЭР ажиллав уу» гэдгийг ХАДГАЛАХ.
--
-- ⚠️ ЯАГААД ЭНЭ ХҮСНЭГТ ЗААВАЛ ВЭ: NOT_APPLICABLE нь ОЛДВОРЫН МӨР БОЛЖ
--    ХЭЗЭЭ Ч ХУВИРАХГҮЙ (complianceModel.ts-ийн NOT_APPLICABLE_IS_NOT_A_ROW).
--    Тиймээс «хэзээ ч ажиллаагүй дүрэм» ба «бүрэн нийцсэн загвар» хоёр ЯГ
--    ИЖИЛ харагдана: тэг олдвор, ногоон хаалт.  BA-гийн хонгилын дүрэм өрөө
--    хиллээгүйгээс clear_width_mm-ыг уншиж чадалгүй чимээгүй унтарвал
--    инженер «хянахад бэлэн» гэж тэмдэглэнэ.  Энэ хүснэгт бол §69-ийн
--    ногоон-ыг ТАТГАЛЗАХ цорын ганц нотолгоо.
--
-- ⚠️ ДҮРМИЙН БАГЦ ХООСОН ҮЕД (эзний шийдвэр Ш4 — rules хүснэгт хоосон
--    шипнэ) энэ хүснэгтэд МӨР ОГТ БАЙХГҮЙ.  Тэр нь «шалгалт хийгдээгүй»
--    гэсэн ил дохио: мөргүй баг = pack бичигдээгүй баг.  Мөр байгаа атлаа
--    considered > 0 БӨГӨӨД evaluated = 0 бол «дүрэм харагдсан, гэвч
--    хамаарсангүй» — skipped_reason нь ЯАГААДЫГ хэлнэ.  Гурван тохиолдол
--    ЯЛГААТАЙ бөгөөд гурвуулаа «нийцсэн» БИШ.
--
-- ⚠️ ЗӨВХӨН НЭГТГЭСЭН.  Элементийн id, өрөөний нэр, ХЭРЭГЛЭГЧИЙН id ЭНД
--    БАЙХГҮЙ — 0201:23-32 / 0203:27 / 0205:44-ийн «зөвхөн өөрийгөө харах»
--    дүрэм.  Тоолуурууд нь дүрэм x сессийн НЭГТГЭЛ.
--
-- ⚠️ ГАДААД ТҮЛХҮҮРИЙН ЗАРЛАЛ БАЙХГҮЙ (0224-ийн шалтгаан).
-- ⚠️ ТЭЭВЭР: 1 хүснэгт + 3 индекс = 4 statement.
-- =============================================================

CREATE TABLE IF NOT EXISTS rule_run_ledger (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,

  -- ХААНА.  ⚠️ project_id нь ЗААВАЛ: 2-7-ийн гурван SQL бүгд
  -- WHERE project_id = ?1 гэж шүүнэ.  session_id-аар bim_sessions руу JOIN
  -- хийвэл унших маршрут бүр нэмэлт холболт төлнө.
  project_id       INTEGER,
  doc_uid          TEXT    NOT NULL DEFAULT '',
  session_id       INTEGER,
  scan_generation  INTEGER NOT NULL DEFAULT 0,

  -- ЮУ.  rule_uid нь rules.rule_uid (2-2)-тай нэрээр холбогдоно.
  rule_uid         TEXT    NOT NULL,
  ruleset_version  TEXT    NOT NULL DEFAULT '',
  pack_sha256      TEXT,
  team_code        TEXT,

  -- ГУРВАН ТООЛУУР.  considered >= applicable >= evaluated ҮРГЭЛЖ.
  -- considered нь ГОХНЫ ИНДЕКСЭЭР нэр дэвшсэн тоо — бүтэн сканы тоо БИШ.
  -- Тиймээс considered < (нийт нийтлэгдсэн дүрэм) байх нь §52-ийн индекс
  -- ажиллаж байгаагийн НОТОЛГОО, алдаа БИШ.
  considered       INTEGER NOT NULL DEFAULT 0,
  applicable       INTEGER NOT NULL DEFAULT 0,
  evaluated        INTEGER NOT NULL DEFAULT 0,

  -- ⚠️ applicable = 0 бол ЯАГААД гэдгийг ЭНД бичнэ, эс тэгвээс §69 «хэзээ ч
  -- ажиллаагүй»-г ялгаж чадахгүй.  Толь нь ХАМААРЛЫН зургаан шалтгаан
  -- (high_rise_gate, boundary_location, category, name, context, exception)
  -- дээр нэмэх no_category / missing_params / budget_abort.
  skipped_reason   TEXT,

  -- Үнэлгээ ХАТУУ таслагдсан удаа (EvalAbortMs).  > 0 бол §69 НОГООН БИШ.
  aborted          INTEGER NOT NULL DEFAULT 0,

  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rrl_project
  ON rule_run_ledger (project_id, rule_uid, id DESC);

CREATE INDEX IF NOT EXISTS idx_rrl_rule
  ON rule_run_ledger (rule_uid, ruleset_version, id DESC);

CREATE INDEX IF NOT EXISTS idx_rrl_skipped
  ON rule_run_ledger (project_id, skipped_reason) WHERE skipped_reason IS NOT NULL;
