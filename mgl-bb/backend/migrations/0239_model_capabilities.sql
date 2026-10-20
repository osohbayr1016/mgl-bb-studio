-- ==================================================================
-- 0239_model_capabilities.sql — ЗАГВАРЫН ЧАДВАРЫН БҮРТГЭЛ (2-6, v2 §79)
--
-- ЗОРИЛГО: «Do not assume one model can safely perform every task.»
--   §79-ийн НАЙМАН талбар БҮГД, нэрийг нь өөрчлөхгүйгээр, + §80-ийн
--   `authority_level`.
--
-- ⚠️ ЯАГААД ШИНЭ ХҮСНЭГТ, `assistant_models`-ыг ӨРГӨТГӨХГҮЙ ВЭ:
--    КАРДИНАЛ ӨӨР.  Нэг загвар нь ОЛОН чадвартай (task) байж болно, ба
--    чадвар тус бүр нь ӨӨР багийн хамрах хүрээ, ӨӨР эрхийн түвшинтэй.
--    `assistant_models`-д багана нэмэх нь «нэг загвар = нэг даалгавар»
--    гэж хатууруулна, тэр нь §79-ийн эсрэг.  Мөн `assistant_models`-ын
--    `eval_passed` (0213:44) нь ГАНЦ boolean — §80-R3-ын «түвшин бүр
--    БИЕ ДААСАН үнэлгээний хаалгатай» шаардлагыг барихгүй.
--
-- ⚠️ authority_level 0..5 = v2 §80: 0 OBSERVE · 1 EXPLAIN · 2 RECOMMEND
--    3 PREVIEW · 4 HUMAN-APPROVED EXECUTE · 5 LIMITED AUTONOMOUS EXECUTE.
--    Нэрс нь `lib/complianceAuthority.ts`-ийн `AUTHORITY_LEVELS`-ийн
--    ИНДЕКСТЭЙ ЯГ ТААРНА — тэр файл нь буулгалтын ЦОРЫН ГАНЦ газар.
--    v2 §40-R4 нь MVP-г 2-оор таслана.  CHECK нь 5 хүртэл зөвшөөрдөг ч
--    3+ рүү дэвших нь ЭНЭ СЕССИЙН ХАМРАХ ХҮРЭЭНЭЭС ГАДУУР — маршрут
--    `POST/PATCH /api/compliance/capabilities` дээр 400 өгнө.
--
-- ⚠️ team_scope NULL = БҮХ БАГТ хамаарна (компанийн хэмжээнд).  9 ангийн
--    санаа таних роутер нь ЯГ ТЭР тохиолдол: багийн зан төлөв нь
--    retrieval scope + rule scope-оор гардаг, ЗАГВАРЫН ЖИН-ээр БИШ
--    (`idx_assistant_model_active` ХЭВЭЭР үлдэнэ).
--
-- ⚠️ team_scope-ын БОДИТ УТГЫН ОРОН ЗАЙ (ЭЗЭН БАТАЛСАН 2026-08-30):
--    NULL (компани даяар) + НАЙМАН салбарын хамрах хүрээ — BA · BB · HAS ·
--    TSBU · TSAH · HD · AU · IZ.
--    ⚠️ БАГЦГҮЙ КЭЙС ИЛЭЭР: MGMT · EZ · GT нь `teams`-д БАЙГАА ч дүрмийн
--    багцгүй, тиймээс тэдэнд `model_capabilities` мөр ХЭЗЭЭ Ч ҮҮСГЭХГҮЙ.
--    `assertCapability` (`lib/modelCapability.ts`) нь мөргүй үед `no_row`
--    -> ТАТГАЛЗАНА, тэр нь ЗӨВ зан төлөв: багцгүй баг эрх мэдлийн түвшин
--    авахгүй.  ⚠️ Энэ нь `TEAM = UNCERTAIN` БИШ: сесс нь ЖИНХЭНЭ
--    `team_code`-оороо тамгалагдсан хэвээр, зөвхөн нийцлийн үнэлгээ
--    алгасагдана, ба ӨӨР БАГИЙН дүрэм рүү унах зам БАЙХГҮЙ.
--    Валидац нь `teams`-ын АМЬД мөрөөс — наймыг маршрутад ХАТУУ БИЧИХГҮЙ.
--
-- ⚠️ REFERENCES users(id) нь ЭНД ХУУЛЬ ЁСНЫ.  `model_capabilities` дээр
--    append-only триггер БАЙХГҮЙ (0206 нь зөвхөн дөрвөн BIM хүснэгтийг
--    нэрлэдэг), тиймээс «ON DELETE SET NULL -> хүүхдийн UPDATE -> триггер
--    -> эцгийн DELETE бүхэлдээ ABORT» гинж энд ФИРЭХГҮЙ.
--
-- ⚠️ ХООСОН ХҮСНЭГТЭЭР НИЙЛҮҮЛЭГДЭНЭ.  Мөр нь ЗӨВХӨН
--    `POST /api/compliance/capabilities`-аар (requireAdmin) үүснэ.  Хоосон
--    бүртгэл = БҮХ чадвар ТАТГАЛЗСАН = хаалттай-өгөгдмөл.  Энэ нь
--    «шалгаад цэвэр» БИШ, «эрх олгоогүй» гэсэн утгатай — уншигч тэр
--    хоёрыг `reason: 'no_row'` -ээр ЯЛГАНА.
--
-- Нийт 4 statement (<= 7), блок тайлбаргүй.
-- ==================================================================

CREATE TABLE IF NOT EXISTS model_capabilities (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,

  -- --- v2 §79-ийн НАЙМАН талбар ---
  -- «floor_plan_detection», «intent_routing», «rule_eval», «note_prose»
  task              TEXT    NOT NULL,
  -- `assistant_models.version` эсвэл дүрмийн багцын `ruleset_version`.
  -- ЗОРИУД FK БИШ: багц нь загвар БИШ, хоёулаа энэ баганад суудаг.
  model_version     TEXT    NOT NULL,
  -- NULL = бүх багт.  Эс бөгөөс `teams.code` (валидац роутын талд) —
  -- практикт ЭЗЭН БАТАЛСАН найман салбарын аль нэг.  MGMT/EZ/GT дээр мөр
  -- ҮҮСГЭХГҮЙ: багцгүй баг = `no_row` = ТАТГАЛЗАНА.
  team_scope        TEXT,
  -- JSON массив: ["text"] | ["revit_elements","project_context"] | ["image"]
  input_types       TEXT    NOT NULL DEFAULT '[]',
  -- JSON массив: ["intent"] | ["verdict","evidence"] | ["prose_mn"]
  output_types      TEXT    NOT NULL DEFAULT '[]',
  -- Хэмжсэн итгэл (0..1).  Хөлдөөсөн багц дээрх нарийвчлал, CV БИШ —
  -- CV нь корпус хөдлөхөд харьцуулах боломжгүй.
  confidence        REAL,
  evaluation_status TEXT    NOT NULL DEFAULT 'untested'
                            CHECK (evaluation_status IN
                              ('untested','experimental','approved','revoked')),
  -- JSON массив: ["read-only"] | ["no-production-write"] | ["recommend"]
  allowed_actions   TEXT    NOT NULL DEFAULT '["read-only"]',

  -- --- v2 §80: түвшин тус бүрд БИЕ ДААСАН хаалга ---
  authority_level   INTEGER NOT NULL DEFAULT 0
                            CHECK (authority_level BETWEEN 0 AND 5),
  -- Аль golden гүйлт энэ түвшинг нээв (`eval/last_run.json`-ийн хуулбар).
  eval_run_json     TEXT,
  eval_dataset_version TEXT,

  -- --- Мөрийн хөтлөгч ---
  is_active         INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0,1)),
  note              TEXT,
  granted_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Гол унших хэлбэр: «энэ даалгаварт, энэ багт, юу зөвшөөрөгдсөн бэ».
CREATE INDEX IF NOT EXISTS idx_model_cap_lookup
  ON model_capabilities(task, team_scope, is_active);

-- «Аль загварын хувилбар ямар эрхтэй вэ» — хувилбар татах шалгалт.
CREATE INDEX IF NOT EXISTS idx_model_cap_version
  ON model_capabilities(model_version, authority_level);

-- Туршилтын загвар чимээгүй эрх авахаас сэргийлэх аудит.
CREATE INDEX IF NOT EXISTS idx_model_cap_status
  ON model_capabilities(evaluation_status, authority_level, is_active);
