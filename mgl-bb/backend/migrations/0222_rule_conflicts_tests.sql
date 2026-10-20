-- =============================================================
-- 0222_rule_conflicts_tests.sql — ЗӨРЧИЛДӨХ ДҮРЭМ ба ДҮРМИЙН ТЕСТ КЕЙС
-- =============================================================
-- ЗОРИЛГО: v2 §64 нь зөрчилдөөнийг ИЛЭРХИЙЛЭГДЭХ ТӨЛӨВ болгохыг шаарддаг —
-- хөдөлгүүр нэгийг нь ЧИМЭЭГҮЙ СОНГОХГҮЙ.  v2 §70 нь дүрэм бүр бодит
-- төслөөс баталгаажсан тест кейс хуримтлуулахыг шаарддаг.
--
-- ⚠️ `rule_conflicts` нь БҮРТГЭЛ, шийдвэр БИШ.  Хоёр дүрэм зөрчилдөж байгааг
-- энд бүртгэвэл хөдөлгүүр UNCERTAIN буцаана — нэгийг нь сонгохгүй.
-- `precedence` нь NULL байж БОЛНО: v2 §64 нь «hierarchy/priority IF KNOWN»
-- гэсэн — мэдэгдэхгүй нь хууль ёсны төлөв.
--
-- ⚠️ `detected_by`-ийн ГУРВАН утгаас ХОЁР нь Л бичигчтэй: `human`
-- (POST /api/compliance/conflicts) ба `authoring_check` (publish маршрут).
-- `verdict_stream` нь 2-3-ынх — РЕЛИЗ N-д тэр утгатай НЭГ Ч МӨР БАЙХГҮЙ.
-- Утгыг одоо тавих шалтгаан: CHECK өргөтгөх нь хожим хүснэгт rebuild шаардана.
--
-- ⚠️ `rule_test_cases` нь ХОЁР ҮҮРЭГТЭЙ: регрессийн тест БАС golden корпус.
-- v2 §63-ын ЗААВАЛ ЁСТОЙ кейсүүд: threshold-1 / threshold / threshold+1 /
-- zero / missing_input / invalid_input / min_max / mixed_units / exception /
-- multi_rule / conflict / no_context.  Дээр нь ЭНЭ ТӨСЛИЙН нэмэлт:
-- mixed_provenance (нэгжийн эх үүсвэр зөрөх).
--
-- ⚠️ ТЭЭВРИЙН ДҮРЭМ: <= 7 statement, блок тайлбаргүй, мөрөн дотор ; -гүй.

CREATE TABLE IF NOT EXISTS rule_conflicts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_uid_a    TEXT    NOT NULL,
  rule_uid_b    TEXT    NOT NULL,
  conflict_kind TEXT    NOT NULL DEFAULT 'threshold'
                  CHECK (conflict_kind IN ('threshold','applicability','unit','definition','cross_discipline')),
  scope         TEXT    NOT NULL DEFAULT 'intra_pack'
                  CHECK (scope IN ('intra_pack','cross_discipline')),
  precedence    TEXT    CHECK (precedence IN ('a_wins','b_wins','unknown')),
  note_mn       TEXT,
  detected_by   TEXT    NOT NULL DEFAULT 'human'
                  CHECK (detected_by IN ('human','authoring_check','verdict_stream')),
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rule_conflicts_pair ON rule_conflicts (rule_uid_a, rule_uid_b, conflict_kind);

CREATE INDEX IF NOT EXISTS idx_rule_conflicts_scope ON rule_conflicts (scope, precedence);

CREATE TABLE IF NOT EXISTS rule_test_cases (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  case_uid      TEXT    NOT NULL UNIQUE,
  rule_uid      TEXT    NOT NULL,
  rule_version  INTEGER NOT NULL DEFAULT 1,
  case_class    TEXT    NOT NULL
                  CHECK (case_class IN ('threshold_minus','threshold','threshold_plus','zero','missing_input','invalid_input','min_max','mixed_units','mixed_provenance','exception','multi_rule','conflict','no_context','ordinary')),
  inputs_json   TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(inputs_json)),
  expect_verdict TEXT   NOT NULL
                  CHECK (expect_verdict IN ('PASS','WARNING','VIOLATION','UNCERTAIN','NOT_APPLICABLE')),
  expect_value  REAL,
  source_kind   TEXT    NOT NULL DEFAULT 'authored'
                  CHECK (source_kind IN ('authored','real_project','regression')),
  source_note   TEXT,
  verified      INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0,1)),
  verified_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  verified_at   TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rule_tests_rule ON rule_test_cases (rule_uid, rule_version, case_class);

CREATE INDEX IF NOT EXISTS idx_rule_tests_verified ON rule_test_cases (verified, rule_uid) WHERE verified = 1;
