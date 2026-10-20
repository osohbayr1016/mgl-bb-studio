-- =====================================================================
-- 0241_addin_releases.sql — НИЙТЛЭГДСЭН ADD-IN БАГЦ БҮРИЙН БҮРТГЭЛ
-- =====================================================================
-- ЗОРИЛГО: Тараагдсан add-in багц БҮРИЙН таних тэмдэг — хувилбар, Revit он,
-- zip нэр, sha256, хэмжээ, git sha, build-ийн цаг.  v2 §74-ийн MANIFEST ба
-- HASH шатны СЕРВЕР ТАЛЫН тогтоол.
--
-- ⚠️ ЯАГААД ХЭРЭГТЭЙ ВЭ: өнөөдөр манифест нь `revit-mcp/dist/`-д бичигдээд
-- тэр фолдер git-д ороогүй (revit-mcp/.gitignore:13).  Тараасны дараа «энэ
-- машин дээрх zip яг тэр нийтэлсэн zip мөн үү» гэсэн асуултад хариулах ЮМ
-- БАЙХГҮЙ.  Энэ хүснэгт нь тэр цорын ганц баримт.
--
-- ⚠️ БҮРЭН БҮТЭН БАЙДАЛ (integrity), ГАРАЛ ҮҮСЭЛ (authenticity) БИШ.
-- Код гарын үсэг (code signing) энэ репод БАЙХГҮЙ — гэрчилгээ худалдаж
-- аваагүй.  sha256 нь «энэ байтууд өөрчлөгдөөгүй» гэдгийг л батална,
-- «эдгээрийг MGL гаргасан» гэдгийг БИШ.  §74-ийн SIGN/VERIFY шат нээлттэй
-- цоорхой хэвээр (2-8 §3.11).
--
-- ⚠️ REFERENCES ЗӨВШӨӨРӨГДӨНӨ: энэ хүснэгтийг 0206-ийн append-only trigger
-- ХАМГААЛДАГГҮЙ (тэр нь bim_artifacts / revit_transactions /
-- revit_element_touches / learning_events дөрвийг л нэрлэдэг).  Тиймээс
-- `users(id) ON DELETE SET NULL` нь энд аюулгүй.
--
-- ⚠️ users / projects-ыг ХӨНДӨХГҮЙ.  Зөвхөн ШИНЭ хүснэгт — cascade эцэг
-- дахин барих ЯМАР Ч алхам энд БАЙХГҮЙ.
--
-- ⚠️ ТЭЭВЭР: 4 statement (<= 9), блок тайлбаргүй, мөрөн дотор цэг таслал АЛГА.
-- =====================================================================

CREATE TABLE IF NOT EXISTS addin_releases (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,

  -- csproj-ийн <Version> (package-addin.ps1 уншина).  ж: '1.2.0'
  version        TEXT    NOT NULL,
  revit_year     TEXT    NOT NULL,
  channel        TEXT    NOT NULL DEFAULT 'prod',

  zip_name       TEXT    NOT NULL,
  sha256         TEXT    NOT NULL CHECK (length(sha256) = 64),

  -- ⚠️ ХОЁР ХЭШ, ХОЁР ӨӨР АСУУЛТ.  `sha256` нь ZIP файлын хэш — архивын
  -- таних тэмдэг, буцаалтын бай (оператор гартаа ZIP барьж байдаг).
  -- `payload_sha256` нь ZIP ДОТОРХ `payload.sha256.txt`-ийн өөрийнх нь хэш —
  -- СУУЛГАСАН машин зөвхөн ҮҮНИЙГ тооцоолж чадна (ZIP нь суулгацын дараа
  -- байхгүй болно).  Тиймээс `POST /api/revit/health`-ийн `recognised` туг
  -- нь ЗААВАЛ `payload_sha256`-аар тулгагдана.  ZIP нь өөрийнхөө хэшийг
  -- агуулж чадахгүй тул нэг баганаар хоёуланг гүйцээх БОЛОМЖГҮЙ.
  payload_sha256 TEXT,
  bytes          INTEGER NOT NULL CHECK (bytes > 0),
  git_sha        TEXT,
  built_at       TEXT    NOT NULL,

  -- Хамгийн бага дэмжигдэх КЛИЕНТ хувилбар.  Сервер энэ утгаас доош
  -- клиентэд POST /api/revit/health-ийн хариунд upgrade_required=1 өгнө.
  -- ⚠️ ЗӨВЛӨМЖ, АЛБАДЛАГА БИШ — сервер ХЭЗЭЭ Ч 4xx буцаахгүй.
  min_client     TEXT,

  status         TEXT    NOT NULL DEFAULT 'published',
  notes          TEXT,

  published_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  published_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Нэг хувилбар x нэг Revit он x нэг суваг = НЭГ мөр.  Дахин нийтлэхэд
-- upsert хийгдэнэ.  sha256 өөрчлөгдвөл тэр нь ЖИНХЭНЭ асуудал —
-- «нэг хувилбарын дугаараар хоёр өөр байт тараагдсан» гэсэн үг.
CREATE UNIQUE INDEX IF NOT EXISTS idx_addin_rel_uniq
  ON addin_releases (version, revit_year, channel);

-- «Revit 2027-ийн хамгийн сүүлийн prod багц юу вэ»
CREATE INDEX IF NOT EXISTS idx_addin_rel_year
  ON addin_releases (revit_year, channel, published_at DESC);

-- «Энэ клиентийн мэдээлсэн payload хэш нийтлэгдсэн багцынх мөн үү»
-- (POST /api/revit/health -> recognised).
CREATE INDEX IF NOT EXISTS idx_addin_rel_sha
  ON addin_releases (payload_sha256);
