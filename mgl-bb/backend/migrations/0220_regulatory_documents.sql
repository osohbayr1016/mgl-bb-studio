-- =============================================================
-- 0220_regulatory_documents.sql — БНбД / БД / MNS баримтын БҮРТГЭЛ ба ЗААЛТ
-- =============================================================
-- ЗОРИЛГО: `norm_items` (0120) нь НОМ ЗҮЙ — код + гарчиг л агуулна.  Хувилбар,
-- хүчин төгөлдөр огноо, заалт, хуудас, босго БАЙХГҮЙ.  Тиймээс өнөөдөр ямар ч
-- олдвор «БНбД 31-03» гэхээс хэтэрч эшлэх боломжгүй бөгөөд v2 §11-ийн 8
-- мөшгих талбараас 3 нь (section, page, version) ирж ЧАДАХГҮЙ.  Энэ файл
-- тэдгээрийг зөвхөн НЭМНЭ — `norm_items`-д ХҮРЭХГҮЙ, тэр нь checkbox-ийн
-- тогтвортой түлхүүрээ хадгална.
--
-- ⚠️ ТЭЭВРИЙН ДҮРЭМ: ФАЙЛ БҮР <= 7 statement (хэмжигдсэн тааз нь 9), блок
-- тайлбаргүй, мөрөн дотор ; -гүй.  Statement бүр IF NOT EXISTS.
--
-- ⚠️ `norm_item_key` нь `norm_items.key` рүү заана — ГЭХДЭЭ FK БИШ.  0120-ийн
-- DELETE нь заалтын түүхийг устгах ёсгүй, мөн бүртгэлд каталогт огт байхгүй
-- баримт (жишээ нь лифтийн норм) орж ирнэ.  Холбоос сул байх нь ЗОРИУД.
--
-- ⚠️ `edition` ба `effective_from` нь NULL байж БОЛНО — «бид хараахан албан
-- ёсны хэвлэлийг олж аваагүй» гэдгийг илэрхийлэх ЦОРЫН ГАНЦ арга.  Тэр NULL
-- нь 0221-ийн CHECK-ээр дамжин дүрмийг UNVERIFIED-д хорино.
--
-- ⚠️ ЭЗНИЙ ШИЙДВЭР Ш4 (2026-08-31): албан ёсны БНбД/MNS баримтыг ЭЗЭН ӨӨРӨӨ
-- нийлүүлнэ.  Тиймээс энэ файл ХҮСНЭГТ л байгуулна, НЭГ Ч МӨР тарихгүй.
-- Баримт ирэхэд `rule_clauses` дүүргэх нь бүх дүрмийг КОД ӨӨРЧЛӨХГҮЙГЭЭР
-- `CLAUSE_CITED` руу ахиулна.

CREATE TABLE IF NOT EXISTS regulatory_documents (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_uid        TEXT    NOT NULL UNIQUE,
  code           TEXT    NOT NULL,
  title_mn       TEXT    NOT NULL,
  title_en       TEXT,
  doc_family     TEXT    NOT NULL DEFAULT 'BNBD'
                   CHECK (doc_family IN ('BNBD','BD','BNOD','MNS','SNIP','IEC','ISO','GOST','INTERNAL','OTHER')),
  jurisdiction   TEXT    NOT NULL DEFAULT 'MN',
  edition        TEXT,
  effective_from TEXT,
  superseded_by  TEXT,
  status         TEXT    NOT NULL DEFAULT 'unconfirmed'
                   CHECK (status IN ('unconfirmed','in_force','superseded','withdrawn')),
  norm_item_key  TEXT,
  source_url     TEXT,
  artifact_id    INTEGER,
  acquired_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  acquired_at    TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_regdoc_code ON regulatory_documents (code, edition);

CREATE INDEX IF NOT EXISTS idx_regdoc_status ON regulatory_documents (status, jurisdiction);

CREATE INDEX IF NOT EXISTS idx_regdoc_norm_item ON regulatory_documents (norm_item_key) WHERE norm_item_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS rule_clauses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  clause_uid   TEXT    NOT NULL UNIQUE,
  document_uid TEXT    NOT NULL,
  clause_no    TEXT    NOT NULL,
  page_no      INTEGER,
  table_no     TEXT,
  text_mn      TEXT,
  text_source  TEXT    NOT NULL DEFAULT 'manual'
                 CHECK (text_source IN ('manual','pdf_extract','ocr','unknown')),
  verified_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  verified_at  TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_clause_doc ON rule_clauses (document_uid, clause_no);

CREATE INDEX IF NOT EXISTS idx_clause_verified ON rule_clauses (verified_at) WHERE verified_at IS NOT NULL;
