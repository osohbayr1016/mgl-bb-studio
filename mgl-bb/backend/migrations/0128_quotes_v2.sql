-- =============================================================
-- Үнийн санал v2 (Quote v2) — хуудсан (sheet) загвар + БД 81-16-20 тариф
-- =============================================================
-- ЮУНЫ ТӨЛӨӨ:
-- Хуучин Үнийн санал (migration 0083 — quote_templates/quote_template_sections/
-- quote_template_items/quotes/quote_comments) нь БАРАА-МӨРИЙН загвартай байсан:
-- мөр бүр qty × unit_price × (1-discount) × (1+tax) гэсэн ХАТУУ томьёотой, чөлөөт
-- багана нь зөвхөн тайлбар (тооцоонд ордоггүй). Тиймээс БД 81-16-20/2020-ийн
-- коэффициентийн ГИНЖИЙГ (тариф × талбай × K1 × K2 × … ) илэрхийлж чаддаггүй
-- байв — PM-ууд Excel рүү буцаж, апп-ын санал нь бодит саналтай таардаггүй байлаа.
-- Уг feature-ийг 2026-07-24-нд 0127_drop_quotes.sql-ээр БҮРЭН устгасан
-- (хүснэгтүүд бүгд DROP хийгдсэн, бодит үйлчлүүлэгчийн өгөгдөл байгаагүй).
--
-- Энэ migration нь Үнийн саналыг ШИНЭ ҮЗЭЛ БАРИМТЛАЛААР сэргээнэ: баримт нь
-- ЧӨЛӨӨТ ХУУДАС (spreadsheet) — нүд бүр литерал утга (`v`) эсвэл томьёо (`f`)
-- агуулна, тооцоог frontend/backend-ийн нэг ижил формул хөдөлгүүр гүйцэтгэнэ.
-- Иймд бүтэц нь `sheet_json` (SheetDoc) гэсэн ганц JSON багана болж хялбарчилсан:
-- section/item хүснэгтүүд шаардлагагүй болсон. Гэрээ:
--   frontend/src/features/quotes/types/quotes.ts (SheetDoc/TariffRow/Quote/…).
--
-- 0083-ТАЙ ЯМАР ХАМААРАЛТАЙ ВЭ:
--   • 0083-ийн хүснэгтүүд 0127-д устсан тул НЭР ДАВХЦАХГҮЙ — өгөгдөл шилжүүлэх
--     (migrate) зүйл алга, шинээр эхэлж байна.
--   • `quote_templates` нэр давхардаж байгаа ч БҮТЭЦ ӨӨР (sheet_json/variants_json
--     vs. intro_md/terms_md/currency). Хуучин кодыг бүү сэргээ.
--   • `quote_comments` (санал бичих) v2-т БАЙХГҮЙ — шаардлага гараагүй.
--   • Statement бүр `IF NOT EXISTS` — репогийн зурших (0125 г.м.), давтан
--     ажиллуулахад аюулгүй. Багануудын тодорхойлолт нь гэрээний схемтэй яг ижил.
-- =============================================================

-- -------------------------------------------------------------
-- 1) Тарифын каталог — БД 81-16-20/2020, заалт 4.20, Хүснэгт 9
-- -------------------------------------------------------------
-- Томьёоны `=TARIF(талбай; "өндөр")` функц ЭНДЭЭС уншина.
--
-- ⚠️ `area_max` нь шатлалын ДЭЭД хязгаар (upper bound). Хайлт:
--       SELECT rate FROM quote_tariffs
--        WHERE complexity = ?1 AND area_max >= ?2
--        ORDER BY area_max ASC LIMIT 1;
--    Өөрөөр хэлбэл 1,200 м² → 1500-ын мөр → 25,161 ₮. MGL-ийн PM-ууд БД-ийн
--    хүснэгтийн мөрийн шошгыг ИНГЭЖ хэрэглэдэг (талбайг дараагийн шошго хүртэл
--    дээш бөөрөнхийлнө) — үүнийг бодит 5 үнийн саналын тоогоор баталсан.
--    Хуучин 0026_pricing_table9_v2.sql өөрийгөө «row-label-as-LOWER-bound» гэж
--    тайлбарласан нь БУРУУ; 0129 seed нь тэр файлын `min_area`-г area_max болгон
--    дахин тайлбарлаж хөрвүүлдэг (`max_area` баганыг үл тоомсорлоно).
--
-- `zovshoorolgui` (барилгын ажлын зөвшөөрөл шаардлагагүй) нь зөвхөн 50–400 м²-ийн
-- шатлалд утгатай — тэрнээс дээш мөргүй тул хайлт үр дүнгүй буцаана (зөв).
CREATE TABLE IF NOT EXISTS quote_tariffs (
  area_max REAL NOT NULL,
  complexity TEXT NOT NULL CHECK (complexity IN ('zovshoorolgui','baga','dund','ondor','ontsgoi')),
  rate INTEGER NOT NULL,
  source_ref TEXT NOT NULL DEFAULT 'БД 81-16-20/2020 4.20 Хүснэгт 9',
  PRIMARY KEY (area_max, complexity)
);

-- PK нь (area_max, complexity) тул complexity-гээр шүүх хайлтад тохирдоггүй.
-- Энэ индекс нь дээрх TARIF хайлтыг covering болгоно (complexity=, area_max>=).
CREATE INDEX IF NOT EXISTS idx_quote_tariffs_lookup ON quote_tariffs(complexity, area_max);

-- -------------------------------------------------------------
-- 2) Загвар (template) — хуудасны эх хувилбар
-- -------------------------------------------------------------
-- `sheet_json`     — SheetDoc (rows/cols/merges/cells/anchors).
-- `variants_json`  — TemplateVariant[] (key/label/titleTemplate/hiddenRows).
--                    Нэг загвар олон төрлийн саналыг үйлчилнэ (зураг төсөл,
--                    ТЭЗҮ г.м.) — сонгоход хамааралгүй мөрүүд нуугдана.
-- `is_default`     — шинэ санал үүсгэхэд өгөгдмөлөөр сонгогдох загвар.
-- `version`        — PUT бүрд +1, өмнөх хувилбар нь quote_template_history руу.
CREATE TABLE IF NOT EXISTS quote_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  sheet_json TEXT NOT NULL,
  variants_json TEXT NOT NULL DEFAULT '[]',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- -------------------------------------------------------------
-- 3) Загварын түүх — өмнөх хувилбар бүрийн хувилбар (snapshot)
-- -------------------------------------------------------------
-- Загварыг санамсаргүй эвдсэн тохиолдолд буцаах боломж. Нэг загварын нэг
-- хувилбар зөвхөн НЭГ удаа бичигдэнэ (UNIQUE), тул давхар бичих алдаа 409 болно.
CREATE TABLE IF NOT EXISTS quote_template_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES quote_templates(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  sheet_json TEXT NOT NULL,
  variants_json TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_quote_tpl_hist ON quote_template_history(template_id, version);

-- -------------------------------------------------------------
-- 4) Үнийн санал (instance)
-- -------------------------------------------------------------
-- Загвараас үүсэхдээ `sheet_json`-г SNAPSHOT хийнэ (`template_version`-той хамт)
-- — дараа нь загвар өөрчлөгдөхөд яваандаа байгаа санал ӨӨРЧЛӨГДӨХГҮЙ.
--
-- `total_amount` нь `anchors.total` нүдний тооцоолсон утгын КЭШ (жагсаалт/MCP-д
-- зориулсан). Сервер `sheet_json`-г ДАХИН ТООЦООЛДОГГҮЙ — баримтын жинхэнэ дүн нь
-- үргэлж хуудсаас формул хөдөлгүүрээр дахин тооцоологдоно (хэвлэх хуудас ч мөн
-- адил). Тиймээс NULL байж болно.
--
-- `project_id` — төсөлтэй холбох (заавал биш; төсөл устахад SET NULL).
CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT '',
  client_name TEXT,
  variant_key TEXT NOT NULL DEFAULT 'design',
  doc_date TEXT NOT NULL DEFAULT (date('now')),
  prepared_by TEXT,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  template_id INTEGER REFERENCES quote_templates(id) ON DELETE SET NULL,
  template_version INTEGER,
  sheet_json TEXT NOT NULL,
  total_amount REAL,
  created_by_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- GET /api/quotes — жагсаалт нь сүүлд зассанаар эрэмбэлэгдэнэ.
CREATE INDEX IF NOT EXISTS idx_quotes_updated ON quotes(updated_at DESC);

-- Төслийн дэлгэрэнгүй хуудаснаас «энэ төслийн саналууд» гэж шүүхэд.
CREATE INDEX IF NOT EXISTS idx_quotes_project ON quotes(project_id);
