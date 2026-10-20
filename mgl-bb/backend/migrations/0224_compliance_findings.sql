-- =============================================================
-- 0224_compliance_findings.sql — v2 §56/§57/§58-ын ОЛДВОРЫН ХҮСНЭГТ
-- =============================================================
-- ЗОРИЛГО: нэг дүрэм x нэг элемент дээрх ХАМГИЙН СҮҮЛИЙН дүгнэлтийг АМЬД
-- ТӨЛӨВ болгож барих.  §56 нь долоон асуултад УНШИХ үед хариулахыг шаарддаг
-- тул энэ нь үйл явдлын урсгалаас гаргаж авдаг дүн БИШ, БОДИТ мөр байх
-- ёстой: D1 дээр гаргаж авбал бэлэн байдлын хаалт нь бүтэн хүснэгтийн скан
-- болно.
--
-- ⚠️ ЭНЭ ХҮСНЭГТ ХУВИРАМТГАЙ.  0206-ийн НАЙМАН trigger нь ЯГ дөрвөн
--    хүснэгтийг нэрлэдэг (bim_artifacts, revit_transactions,
--    revit_element_touches, learning_events).  §57-ын
--    OPEN -> ACKNOWLEDGED -> FIXED -> REOPENED нь UPDATE тул тэдний аль
--    нэгэнд байрлуулбал RAISE(ABORT) авна.  Аудитын мөрийг ХОЁР аргаар
--    нөхнө: (1) finding_overrides (2-5, өөрийн append-only trigger-тэй),
--    (2) ТӨЛӨВ ӨӨРЧЛӨГДӨХ БҮРТ нэг learning_events RULE_VALIDATION мөр
--    (routes/compliance.ts, lib/bimEvents.ts-ийн бичих ГАНЦ гарцаар).
--
-- ⚠️ ГАДААД ТҮЛХҮҮРИЙН ЗАРЛАЛ БАЙХГҮЙ.  1B-1 §2.6-д хэмжсэн:
--    ON DELETE SET NULL нь
--    хүүхдийн UPDATE болж, хөрш append-only trigger-ийг галлаж, ЭЦГИЙН
--    DELETE-ийг БҮХЭЛД НЬ ABORT хийнэ.  Хүүхдийг ГАРААР устгана.
--
-- ⚠️ ЗӨВХӨН ӨӨРИЙГӨӨ ХАРАХ.  detected_by нь 0201/0203/0205-ын толгойд
--    дөрвөн удаа давтагдсан үл хөдлөх дүрмийн зангуу: элементийн түвшний
--    уншилтын маршрут бүр (а) detected_by = viewer.sub, эсвэл (б) ЗӨВХӨН
--    НЭГТГЭСЭН тоо.
--
-- ⚠️ ДҮРМИЙН БАГЦ ХООСОН НЬ ХЭВИЙН (эзний шийдвэр Ш4).  rules хүснэгт хоосон
--    бол энэ хүснэгтэд мөр ОГТ үүсэхгүй — тэр нь «нийцсэн» гэсэн үг БИШ.
--    «Шалгагдаагүй» ба «шалгагдаад цэвэр» хоёрын ялгаа нь 0229-ийн
--    rule_run_ledger-т байна, ЭНД БИШ.
--
-- ⚠️ ТЭЭВРИЙН ДҮРЭМ (0209:6-12-т хэмжсэн): файл бүр <= 7 өөрийн statement,
--    блок тайлбаргүй, мөрөн дотор цэг таслалгүй, trigger-гүй.
--    Энэ файл: 1 хүснэгт + 6 индекс = 7.
-- =============================================================

CREATE TABLE IF NOT EXISTS compliance_findings (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Клиентийн GUID.  Idempotency: сүлжээ тасарч дахин илгээвэл давхардахгүй.
  finding_uid         TEXT    NOT NULL,

  -- ХААНА.  doc_uid нь ProjectInformation.UniqueId (0187-ийн орон зай).
  project_id          INTEGER,
  doc_uid             TEXT    NOT NULL,
  session_id          INTEGER,

  -- ХЭН.  §57 team + өөрийгөө харах зангуу.
  detected_by         INTEGER NOT NULL,
  owner_team_code     TEXT,

  -- ЮУ.  §57 rule_id + дүрмийн хувилбар + ямар багцаар шалгав.
  rule_uid            TEXT    NOT NULL,
  rule_version        INTEGER NOT NULL DEFAULT 1,
  ruleset_version     TEXT    NOT NULL DEFAULT '',
  pack_sha256         TEXT,
  semantic_hash       TEXT,

  -- ГУРВАН ЗЭРЭГЦЭЭ ТЭНХЛЭГ.  ХЭЗЭЭ Ч нэгтгэхгүй (lib/complianceModel.ts).
  -- дүгнэлт = «шалгалт юу гэж хэлэв», ангилал = «ямар төрлийн асуудал вэ»,
  -- нотолгооны түвшин = «бид үүнийг хэр сайн мэдэж байна вэ».
  verdict             TEXT    NOT NULL CHECK (verdict IN ('PASS','WARNING','VIOLATION','UNCERTAIN')),
  issue_class         TEXT    NOT NULL CHECK (issue_class IN ('REGULATORY_VIOLATION','MODEL_QUALITY','PROJECT_INCOMPLETENESS','TEAM_STANDARD','UNKNOWN_NEEDS_REVIEW')),
  evidence_level      TEXT    NOT NULL CHECK (evidence_level IN ('RULE_BACKED','MODEL_DERIVED','HUMAN_VERIFIED','AI_INFERRED','UNKNOWN')),
  severity            TEXT    NOT NULL CHECK (severity IN ('CRITICAL','HIGH','MEDIUM','LOW','INFO')),

  -- §57 амьдралын мөчлөг — ЯГ ДОЛОО.  STALE нь ЭНД БАЙХГҮЙ: тэр нь найм
  -- дахь төлөв БИШ, доорх stale_at түр тэмдэг.
  lifecycle_state     TEXT    NOT NULL DEFAULT 'OPEN' CHECK (lifecycle_state IN ('OPEN','ACKNOWLEDGED','FIXED','REOPENED','DISMISSED','INVALIDATED','UNCERTAIN')),

  -- sha256(rule_uid || 0x00 || element_uid)-ийн эхний 16 тэмдэгт.
  -- ⚠️ ruleset_version ЭНД ОРОХГҮЙ.  Оруулбал багц дахин нийтлэх бүрт
  --    компани даяар бүх acknowledgement өнчирч, §76-ийн ядаргаа нь яг л
  --    засвар үйлчилгээний үйлдлээс үүснэ.
  -- ⚠️ detected_by ч бас ЭНД ОРОХГҮЙ — тэр нь ТУСДАА багана ба доорх
  --    idx_cf_dedup-ийн гишүүн.  Түлхүүр дотор нь оруулбал 2-4-ийн
  --    compliance_notice_state.dedup_key хоёр талдаа өөр утга болно.
  dedup_key           TEXT    NOT NULL,

  -- §63 / §64.  Яагаад мэдэхгүй байна, ямар дүрмүүд зөрчилдөв.
  coverage            TEXT    NOT NULL DEFAULT 'full' CHECK (coverage IN ('full','partial')),
  uncertain_reason    TEXT,
  conflict_rule_uids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(conflict_rule_uids_json)),

  -- §57 calculation — оролт бүр НЭГЖ ба ГАРАЛ ҮҮСЛИЙН хамт (§62).
  calc_json           TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(calc_json)),
  -- §57 evidence + source — document_uid, clause, edition, effective_from,
  -- boundary_location, түвшний нэрс.  ⚠️ UNVERIFIED дүрэм код ХЭВЛЭХГҮЙ.
  evidence_json       TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(evidence_json)),
  -- §57 recommended correction.
  recommendation_mn   TEXT,

  -- §57 model state + §56-ийн 2-4 асуулт.  scan_generation нь «шинээр
  -- гарсан» ба «бид дөнгөж хармагцаа анх харагдсан» хоёрыг ялгах ЦОРЫН
  -- ГАНЦ механизм — цагийн тэмдэг үүнийг ЯЛГАЖ ЧАДАХГҮЙ.
  model_state_hash    TEXT,
  scan_generation     INTEGER NOT NULL DEFAULT 0,

  first_detected_at   TEXT    NOT NULL,
  last_evaluated_at   TEXT    NOT NULL,
  resolved_at         TEXT,

  -- §58.  Найман дахь төлөв БИШ — түр тэмдэг.  Гурван гох: sync ба edit нь
  -- клиентээс POST /findings/stale-ээр, ruleset ба central нь СЕРВЕР дээр
  -- УНШИХ ҮЕД (cron БАЙХГҮЙ — wrangler.toml-д ЯГ ХОЁР crons илэрхийлэл).
  stale_at            TEXT,
  stale_reason        TEXT,
  ack_rule_version    INTEGER,

  updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cf_uid
  ON compliance_findings (finding_uid);

-- ⚠️ АМЬД ТӨЛӨВИЙН ТҮЛХҮҮР.  Нэг баримт дээр нэг ИЛРҮҮЛЭГЧ x нэг дүрэм x
-- нэг элемент = НЭГ мөр.  Дахин үнэлгээ нь INSERT биш UPSERT.
--
-- ⚠️ detected_by нь ТҮЛХҮҮРИЙН ГИШҮҮН, ба энэ нь ЗААВАЛ.  RevitTools.DocUid
--    (RevitTools.cs:134-138) нь doc.ProjectInformation.UniqueId-ыг буцаадаг
--    ба тэр нь ТӨВ загварын ЛОКАЛ ХУУЛБАР БҮРТ ИЖИЛ.  Тиймээс нэг төв файл
--    дээр ажиллаж буй ХОЁР BA инженер ижил дүрмийг ижил элемент дээр
--    үнэлэхэд (doc_uid, dedup_key) нь ЯГ ИЖИЛ болно: UPSERT нь НЭГ мөрийг
--    булаацалдаж, нөгөө инженерийн олдвор нь detected_by = viewer.sub
--    жагсаалтаас ЧИМЭЭГҮЙ АЛГА БОЛНО.
--
-- ⚠️ ҮР ДАГАВАР: нэг элемент дээр хоёр хүний ижил олдвор нь ХОЁР мөр
--    болно.  (а) GET /findings ба ribbon-ы тоолуур нь өөрийгөө харах тул
--    зөв, (б) 2-7-ийн БАГИЙН асуулга нь dedup_key-ээр НЭГТГЭХ ёстой,
--    (в) сервер нь тэднийг finding_edges(kind=duplicates)-ээр холбоно.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cf_dedup
  ON compliance_findings (doc_uid, detected_by, dedup_key);

CREATE INDEX IF NOT EXISTS idx_cf_open
  ON compliance_findings (project_id, lifecycle_state, severity)
  WHERE lifecycle_state IN ('OPEN','REOPENED','UNCERTAIN');

CREATE INDEX IF NOT EXISTS idx_cf_self
  ON compliance_findings (detected_by, last_evaluated_at);

CREATE INDEX IF NOT EXISTS idx_cf_stale
  ON compliance_findings (doc_uid, stale_at) WHERE stale_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cf_rule
  ON compliance_findings (rule_uid, ruleset_version);
