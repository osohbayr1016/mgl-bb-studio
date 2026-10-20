-- MGL AI · АРТЕФАКТЫН ТӨРӨЛ, МЭДЛЭГИЙН БАГЦ, СУУЛГАГЧ
--
-- ⚠️ ЯАГААД ЭНЭ МИГРАЦ ХЭРЭГТЭЙ ВЭ.  «Шинэ норм нэмэгдэхэд 5 GB загвар
--    дахин татах», «MGL AI 1.2 гарахад бүхэлд нь дахин суулгах» гэсэн
--    хоёр зан төлөв нь бүтээгдэхүүнийг ашиглах боломжгүй болгоно —
--    40 ажилтны сүлжээ боомилогдож, шинэчлэлтийг унтраана.
--
--    Шийдэл нь артефактыг ГУРАВ ЯЛГАХ:
--      base      4-5 GB   НЭГ УДАА татагдана
--      adapter   ~200 MB  MGL AI 1.1 -> 1.2 нь ЗӨВХӨН ЭНЭ
--      knowledge ~5 MB    шинэ норм ирэх бүрд, ЖИНД ОРОХГҮЙ
--
-- ⚠️ ХУУЧИН МӨРҮҮД АВТОМАТААР `base` БОЛНО (DEFAULT).  Одоо байгаа
--    ямар ч релиз энэ миграцаас болж зан төлвөө ӨӨРЧЛӨХГҮЙ.
--
-- ⚠️ ЗӨВХӨН `ALTER TABLE ... ADD COLUMN` — ХҮСНЭГТ ДАХИН БАРИХГҮЙ.
--    `ai_model_releases` нь `released_by` -ээр `users`-д холбогддог;
--    хүснэгт дахин барих нь CLAUDE.md-ийн path-B журам шаардана.
--    Багана нэмэх нь тэр журамд ХАМААРАХГҮЙ (SQLite үүнийг байрандаа
--    хийдэг).

ALTER TABLE ai_model_releases ADD COLUMN kind TEXT NOT NULL DEFAULT 'base';

-- ⚠️ Адаптер аль СУУРЬ загварт наалдахыг заана.  `NULL` = ямар ч суурьт.
--    Үл тохирох LoRA нь эсвэл унана, эсвэл ХАМААГҮЙ ХОГ гаргана —
--    сүүлийнх нь илүү аюултай (ажиллаж байгаа мэт харагдана).
ALTER TABLE ai_model_releases ADD COLUMN base_release_uid TEXT;

-- ⚠️ Шинэ артефакт ХУУЧИН runtime дээр ажиллахгүй байж болно.  Локал
--    runtime нь энэ талбарыг харж, өөрөө хуучин бол ТАТАХГҮЙ ӨНГӨРНӨ —
--    татаад унахаас хамаагүй дээр.
ALTER TABLE ai_model_releases ADD COLUMN minimum_runtime_version TEXT;

-- ⚠️ МЭДЛЭГИЙН БАГЦ НЬ ЗАГВАРЫН РЕЛИЗ БИШ.  Тусдаа хүснэгт байх нь
--    зориуд: багц нь жинд ОРДОГГҮЙ, лицензийн хаалга ӨӨР, шинэчлэлтийн
--    давтамж 100 дахин их.  Нэг хүснэгтэд хийвэл «энэ мөр загвар мөн үү,
--    норм мөн үү» гэсэн шалгалт 20 газар давхардана.
CREATE TABLE IF NOT EXISTS ai_knowledge_packs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  pack_id      TEXT    NOT NULL,
  version      TEXT    NOT NULL,
  title_mn     TEXT,
  url          TEXT    NOT NULL,
  sha256       TEXT    NOT NULL,
  bytes        INTEGER,
  audience     TEXT    NOT NULL DEFAULT 'employee' CHECK (audience IN ('employee','client','all')),
  is_active    INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0,1)),
  note         TEXT,
  published_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (pack_id, version)
);

-- ⚠️ СУУЛГАГЧИЙН РЕЛИЗ.  Вэб хуудасны «MGL AI татах» товч нь ЭНЭ
--    хүснэгтээс уншина — хатуу бичсэн URL БАЙХГҮЙ.  Шинэ суулгагч
--    гаргах нь нэг мөр INSERT, deploy БИШ.
--
-- ⚠️ SHA-256 нь ЗААВАЛ.  Хэрэглэгч татсан файлаа шалгаж чадах ёстой,
--    мөн ирээдүйд автомат шинэчлэгч түүнийг ашиглана.
CREATE TABLE IF NOT EXISTS ai_runtime_installers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  -- ⚠️ СУУЛГАЦ НЬ ДӨРВӨН ХЭСЭГТЭЙ, ТУС БҮР ӨӨР ХЭМНЭЛТЭЙ ШИНЭЧЛЭГДЭНЭ:
  --      installer    — өөрөө (жижиг, ховор)
  --      node         — зөөврийн Node (~30 MB, маш ховор)
  --      llama-cuda   — llama.cpp CUDA бинар (~400 MB, улиралд нэг)
  --      llama-cpu    — GPU-гүй машинд (~50 MB)
  --      runtime-code — `ai/runtime` + `ai/retrieval` (~1 MB, ойр ойр)
  --
  -- ⚠️ `runtime-code` НЬ ЯАГААД ЭНД ВЭ.  CLAUDE.md: «локал runtime нь
  --    wrangler-ээр deploy хийгддэггүй … код түгээх суваг өнөөдөр
  --    БАЙХГҮЙ».  Энэ мөр нь ТЭР СУВАГ — ажилтан бүр `git pull` хийх
  --    шаардлагагүй болно.
  component    TEXT    NOT NULL DEFAULT 'installer'
                       CHECK (component IN ('installer','node','llama-cuda','llama-cpu','runtime-code')),
  version      TEXT    NOT NULL,
  platform     TEXT    NOT NULL DEFAULT 'win-x64',
  url          TEXT    NOT NULL,
  sha256       TEXT    NOT NULL,
  bytes        INTEGER,
  channel      TEXT    NOT NULL DEFAULT 'stable' CHECK (channel IN ('canary','beta','stable')),
  is_active    INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0,1)),
  release_note TEXT,
  published_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  -- ⚠️ `version` ГАНЦААРАА UNIQUE БАЙЖ БОЛОХГҮЙ: хэсэг бүр өөрийн
  --    хувилбартай (installer 1.0.0, node 24.18.0, llama b10850).
  UNIQUE (component, platform, version)
);

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_packs_active ON ai_knowledge_packs (is_active, audience);

CREATE INDEX IF NOT EXISTS idx_ai_installers_active ON ai_runtime_installers (is_active, component, platform, created_at DESC);
