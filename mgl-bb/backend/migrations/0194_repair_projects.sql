-- =============================================================
-- 0194_repair_projects.sql — Засварын төсөл: ЖИНХЭНЭ төсөл БИШ
-- =============================================================
--
-- ЮУНД ЗОРИУЛАГДСАН БЭ:
--   Бүх жинхэнэ төсөл эзэнтэй болчихсон үед ажилтанд хийх ажил үлдэхгүй байх
--   тохиолдол гардаг.  Тэр үед тэр хүн компанийн дотоод ажил (жишээ нь
--   «Оффисын зураг засвар», «Компанийн танилцуулга») хийж, зарцуулсан цаг +
--   тайлбараа бүртгээд өдрийн хувь/оноогоо авах ёстой.  Гэхдээ хамаагүй нэг
--   төсөл дээр бүртгэж болохгүй тул админ ТУСДАА «засварын төсөл» гараар
--   үүсгэж өгнө.
--
--   Эдгээр нь `projects` хүснэгтэд ОРОХГҮЙ: Төслүүд хуудас, хянах самбар,
--   Timeline, компанийн тойм, MCP, клиент портал, глобал хайлт — хаана ч
--   харагдахгүй.  Зөвхөн my-tasks дэх «Засвар бүртгэх» цонхны сонголтод л
--   гарна.
--
-- ҮНЭЛГЭЭНИЙ ЗАГВАР (2026-08-25-ны эзний шийдвэр):
--   оноо = СУУРЬ_ХАНШ × rate_multiplier × (цаг / 40)
--   • СУУРЬ_ХАНШ нь АВТОМАТ, шаталсан: өөрийн 7 хоног → өөрийн 90 хоногийн
--     дундаж долоо хоног → багийн 30 хоногийн дундаж/хүн → компанийн 30
--     хоногийн дундаж/хүн.  Эхний тэг биш утга ялна.  Ингэснээр ажиллаж
--     байгаа хүнд өмнөхөөс ЮУ Ч өөрчлөгдөхгүй (1-р шат ялна), харин хийх
--     ажилгүй болсон хүн 0 авахаа болино.
--   • `rate_multiplier` нь дотоод ажил тус бүрийн админы дугуй (0.5 = хагас
--     үнэтэй, 2 = хоёр дахин).
--   Хоёулаа бичлэг үүсэх үед SNAPSHOT-логдоно (`weekly_avg_pct`,
--   `rate_multiplier`, `rate_source`) — `user_points` бол дэвтэр, хойшид
--   дахин тооцоологддоггүй.
--
-- ЯАГААД ТУСДАА ХҮСНЭГТ, ЯАГААД `projects` дээрх «далдлах туг» БИШ:
--   * `projects.status`-д CHECK(status IN ('active','completed','archived'))
--     байгаа бөгөөд PROJECT_LIST_SQL нь status-аар ОГТ шүүдэггүй.
--   * Далдлах туг сонговол `FROM projects` / `JOIN projects` гэсэн 126
--     газраас 34 нь шүүлт нэмэх шаардлагатай болно (компанийн тойм x12,
--     dashboard x4, MCP x4 ...), нэгийг нь мартвал чимээгүй алдагдана.
--     `is_pending` (0143) яг ийм туг бөгөөд 4 дуудагчийн 2 нь аргументаа
--     дамжуулж мартсанаас production-д ӨНӨӨДӨР Ч алдагдсаар байна
--     (mcp/tools/projects.ts, lib/clientReport.ts).
--   * Тусдаа хүснэгт нь `projects.id` огт үүсгэдэггүй тул шүүлт 0 газар
--     хэрэгтэй.  `landing_projects` (routes/landing.ts) яг ийм жишиг.
--
-- ЯАГААД REBUILD ХЭРЭГТЭЙ ВЭ:
--   `user_points.project_id` ба `repair_entries.project_id` хоёул NOT NULL
--   бөгөөд SQLite-д ALTER TABLE-ээр NOT NULL-ыг ХАСАХ боломжгүй.  Тиймээс
--   CREATE new -> INSERT...SELECT -> DROP old -> RENAME гэсэн бүтэн rebuild.
--
-- ЭНЭ НЬ 0136/0142-ИЙН PATH B ШААРДДАГГҮЙ — ЭНГИЙН `migrations apply` ЗӨВ:
--   Path B нь ЭЦЭГ хүснэгтийг (users, projects) DROP хийхэд каскадаар
--   хүүхдүүд нь устдагаас хамгаалдаг.  Харин `user_points` ба
--   `repair_entries` хоёр нь ЗӨВХӨН ХҮҮХЭД — 2026-08-25-нд шалгасан:
--     grep -rniE "REFERENCES\s+(user_points|repair_entries)"  -> 0 үр дүн
--     sqlite_master дээр ч тэдгээрийг заасан хүснэгт алга.
--   Тиймээс DROP нь юуг ч каскадаар устгахгүй.  Мөн `migrations apply` нь
--   файлыг ТРАНЗАКЦААР боодог тул ямар нэг алдаа гарвал БҮГД буцаж, өгөгдөл
--   бүрэн бүтэн үлдэнэ — path B-ийн «дунд нь тасалдвал дэвтэр устана» гэсэн
--   эрсдэл энд БАЙХГҮЙ.
--
-- PRODUCTION-Д АЖИЛЛУУЛАХЫН ӨМНӨ (backend/-ээс):
--   1) Нөөцлөх:
--      npx wrangler d1 export mgl-progress-db-v3 --remote --config wrangler.toml --output ../backup-before-0194.sql
--   2) Схем нь доорхтой ЯГ таарч байгааг нүдээр шалгах (миграцийн фолдер бол
--      схем БИШ — CLAUDE.md):
--      npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml --command "SELECT sql FROM sqlite_master WHERE name IN ('user_points','repair_entries')"
--   3) Эцэг эсэхийг production дээр ч давхар шалгах (0 мөр буцаах ЁСТОЙ):
--      npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml --command "SELECT name FROM sqlite_master WHERE type='table' AND (sql LIKE '%REFERENCES user_points%' OR sql LIKE '%REFERENCES repair_entries%')"
--   4) Мөрийн тоог тэмдэглэж авах, дараа нь тулгах:
--      npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml --command "SELECT (SELECT COUNT(*) FROM user_points) up, (SELECT COUNT(*) FROM repair_entries) re"
--   5) npx wrangler d1 migrations apply mgl-progress-db-v3 --remote --config wrangler.toml
--
-- sqlite_sequence: хоёулаа AUTOINCREMENT тул DROP нь seq-ийг устгаж, шинэ
--   хүснэгт дээр seq = MAX(id) болж БУУРНА (user_points-ийн seq нь local
--   дээр 264127 боловч MAX(id) нь түүнээс хамаагүй бага —
--   `recalculateProjectPoints` нь source='progress' зүсмийг бүтнээр устгаад
--   дахин бичдэг).  Санаатайгаар сэргээхгүй: эдгээр id-г ГАДНААС заасан FK
--   хаана ч алга, харин `user_points.repair_entry_id` нь засвар устахад
--   мөртэйгээ хамт устдаг (routes/repair.ts DELETE) тул id дахин
--   ашиглагдсан ч хуучин мөртэй мөргөлдөхгүй.  sqlite_sequence-д гараар
--   бичих нь D1 дээр баталгаагүй тул огт оролдохгүй.
-- =============================================================

-- -------------------------------------------------------------
-- 1) Засварын төсөл.  `projects`-той ямар ч холбоогүй.
--    Устгахын оронд `status='archived'` болгож нуудаг — түүхэн бичлэгүүд
--    нэрээ алдахгүй байх ёстой (repair_entries нь зөвхөн FK хадгалдаг,
--    нэрийн хуулбар авдаггүй).
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS repair_projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  -- Тухайн дотоод ажлын ҮНЭ ЦЭНИЙН үржвэр.  Суурь ханш нь автомат (доорх
  -- `baseWeeklyRate`-ийн шаталсан fallback), энэ нь «энэ ажил дунджаас хэр
  -- үнэтэй вэ» гэдгийг админд тохируулах ганц дугуй: 0.5 = хагас, 2 = хоёр
  -- дахин.  1.0 = дундаж цагтай тэнцүү.
  rate_multiplier REAL NOT NULL DEFAULT 1 CHECK(rate_multiplier > 0 AND rate_multiplier <= 10),
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_repair_projects_name   ON repair_projects(name);
CREATE INDEX        IF NOT EXISTS idx_repair_projects_status ON repair_projects(status, sort_order, id);

-- -------------------------------------------------------------
-- 2) CREATE — юу ч устгахаас ӨМНӨ хоёр шинэ хүснэгтийг үүсгэнэ.  Ингэснээр
--    багана зөрвөл INSERT дээр унаж, DROP хүртэл хүрэхгүй.
--
--    ⚠️ Багануудыг 0039 + 0045 (project_value DROP) + 0114 (source,
--       repair_entry_id)-ийн НИЙЛБЭР болох БОДИТ схемээс хуулсан.
--       `source`-ийн DEFAULT 'progress' ба `awarded_at`-ын
--       DEFAULT (datetime('now')) нь АЧААЛАЛ ҮҮРЧ БАЙНА: progress.ts-ийн
--       хоёр INSERT эдгээр баганыг нэрлэдэггүй.  DEFAULT-ыг алдвал бүх
--       progress оноо runtime-д унана — tsc нь ногоон хэвээр үлдэнэ.
--    ⚠️ `awarded_by INTEGER REFERENCES users(id)` дээр ON DELETE үйлдэл
--       БАЙХГҮЙ (=RESTRICT).  Яг хэвээр нь хуулна.
-- -------------------------------------------------------------
CREATE TABLE user_points_new (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(id)             ON DELETE CASCADE,
  project_id        INTEGER          REFERENCES projects(id)          ON DELETE CASCADE,
  task_id           INTEGER          REFERENCES tasks(id)             ON DELETE SET NULL,
  progress_entry_id INTEGER          REFERENCES progress_entries(id)  ON DELETE SET NULL,
  amount            REAL    NOT NULL,
  delta_pct         REAL    NOT NULL,
  assignee_count    INTEGER NOT NULL,
  awarded_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  awarded_by        INTEGER          REFERENCES users(id),
  source            TEXT    NOT NULL DEFAULT 'progress',
  repair_entry_id   INTEGER,
  repair_project_id INTEGER          REFERENCES repair_projects(id),
  -- Яг НЭГ эзэн: жинхэнэ төсөл ЭСВЭЛ засварын төсөл.  Хоёул дүүрсэн мөр нь
  -- хоёр тайланд давхар тоологдоно, хоёул хоосон мөр нь хаана ч харагдахгүй.
  CHECK ((project_id IS NULL) <> (repair_project_id IS NULL))
);

CREATE TABLE repair_entries_new (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
  project_id        INTEGER          REFERENCES projects(id)    ON DELETE CASCADE,
  repair_project_id INTEGER          REFERENCES repair_projects(id),
  description       TEXT    NOT NULL,
  hours             REAL    NOT NULL CHECK(hours > 0),
  day_hours         REAL    NOT NULL DEFAULT 8,    -- хуваагчийн snapshot (routes/repair.ts нь 40-ийг бичдэг)
  weekly_avg_pct    REAL    NOT NULL DEFAULT 0,    -- үүсгэх үеийн СУУРЬ ханшийн snapshot
  -- Үүсгэх үеийн үржвэрийн snapshot.  Админ дараа нь үржвэрийг өөрчилсөн ч
  -- түүхэн бичлэгийн оноо ХӨДЛӨХГҮЙ — user_points бол дэвтэр, дахин
  -- тооцоологддоггүй.
  rate_multiplier   REAL    NOT NULL DEFAULT 1,
  -- Суурь ханш аль шатнаас гарсныг тэмдэглэнэ ('self7' | 'self90' | 'team30'
  -- | 'company30' | 'none').  Ажилтан «яагаад ийм оноо гарав?» гэхэд хариулах
  -- цорын ганц ул мөр — тооцоолол нь дараа нь давтагдахгүй (цонх гүйдэг).
  rate_source       TEXT,
  computed_pct      REAL    NOT NULL DEFAULT 0,    -- weekly_avg_pct * rate_multiplier * (hours / day_hours)
  date              TEXT    NOT NULL,              -- UB ажлын огноо YYYY-MM-DD
  created_at        TEXT             DEFAULT (datetime('now')),   -- 0114-д NOT NULL БИШ — хэвээр
  CHECK ((project_id IS NULL) <> (repair_project_id IS NULL))
);

-- -------------------------------------------------------------
-- 3) INSERT — багана бүрийг НЭРЛЭЖ хуулна (0136-ийн загвар).
--    Байгаа бүх мөр `project_id` дүүрэн тул CHECK-ийг хангана.
-- -------------------------------------------------------------
INSERT INTO user_points_new
  (id, user_id, project_id, task_id, progress_entry_id, amount, delta_pct,
   assignee_count, awarded_at, awarded_by, source, repair_entry_id, repair_project_id)
SELECT
   id, user_id, project_id, task_id, progress_entry_id, amount, delta_pct,
   assignee_count, awarded_at, awarded_by, source, repair_entry_id, NULL
FROM user_points;

INSERT INTO repair_entries_new
  (id, user_id, project_id, repair_project_id, description, hours, day_hours,
   weekly_avg_pct, rate_multiplier, rate_source, computed_pct, date, created_at)
SELECT
   id, user_id, project_id, NULL, description, hours, day_hours,
   weekly_avg_pct, 1, 'self7', computed_pct, date, created_at
FROM repair_entries;

-- -------------------------------------------------------------
-- 4) DROP -> RENAME.  Хуучин индексүүд хүснэгттэйгээ хамт устана.
-- -------------------------------------------------------------
DROP TABLE user_points;
DROP TABLE repair_entries;

ALTER TABLE user_points_new    RENAME TO user_points;
ALTER TABLE repair_entries_new RENAME TO repair_entries;

-- -------------------------------------------------------------
-- 5) Индексүүдийг дахин үүсгэнэ (0039 ба 0114-ийнхийг яг хэвээр, дээр нь
--    засварын төслийн хайлтынхыг нэмнэ).
-- -------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_user_points_user_date      ON user_points(user_id, awarded_at);
CREATE INDEX IF NOT EXISTS idx_user_points_project        ON user_points(project_id, awarded_at);
CREATE INDEX IF NOT EXISTS idx_user_points_awarded        ON user_points(awarded_at);
CREATE INDEX IF NOT EXISTS idx_user_points_repair_project ON user_points(repair_project_id, awarded_at);

CREATE INDEX IF NOT EXISTS idx_repair_user           ON repair_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_repair_project        ON repair_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_repair_repair_project ON repair_entries(repair_project_id);
