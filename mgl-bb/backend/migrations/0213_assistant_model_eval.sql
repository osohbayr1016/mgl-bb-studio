-- 0213 — GOLDEN БАГЦЫН ОНООГ ЗАГВАРТАЙ ХАМТ ХАДГАЛНА  (1B-5)
--
-- Өнөөдөр загварын хувилбар бүрд хадгалагддаг цорын ганц тоо нь
-- `assistant_models.accuracy` — тэр нь СУРГАЛТЫН ӨГӨГДӨЛ ДЭЭРХ хөндлөн
-- шалгалт, өөрөөр хэлбэл загвар өөрийгөө өөрөө дүгнэсэн тоо.  Өгөгдөл
-- өөрчлөгдөхөд суурь нь ч хамт хөдөлдөг тул «сайжирлаа» гэсэн мэдэгдлийг
-- хэн ч няцааж чадахгүй.  Эдгээр багана нь ХӨЛДӨӨСӨН багц дээрх онооны
-- түүхийг сервер дээр үлдээнэ.
--
-- ⚠️ ЯАГААД `note` РУУ ХИЙЖ БОЛОХГҮЙ ВЭ: `routes/revit.ts`-ийн `str()` нь
-- 500 тэмдэгтээр ЧИМЭЭГҮЙ таслана — оноо дуусаагүй JSON болж хадгалагдах ба
-- ямар ч алдаа гарахгүй.
--
-- ⚠️ CHECK-гүй: SQLite-д АЛЬ ХЭДИЙН байгаа хүснэгтэд CHECK нэмэх нь
-- хүснэгтийг ДАХИН БАРИХЫГ шаардана.  `assistant_models` нь
-- `idx_assistant_model_active` хэсэгчилсэн ӨВӨРМӨЦ индекстэй ба
-- `trained_by` нь `users(id)`-г заадаг тул дахин барих нь энэ ажлын
-- хамрах хүрээнээс ГАДУУР.  0/1 хязгаарлалтыг `routes/revit.ts` тал
-- хийнэ (`evalPassed === 1 ? 1 : 0`).
--
-- ⚠️ Багана нь түүнийг УНШДАГ кодоос ХАТУУ ЭРТ deploy хийгдэнэ:
--     1) npx wrangler d1 migrations apply mgl-progress-db-v3 --remote --config wrangler.toml
--     2) npx wrangler deploy --config wrangler.toml
--
-- ⚠️ БУЦААХ: `ALTER TABLE ... DROP COLUMN` БҮҮ ХИЙ.  NULL-тэй үлдсэн багана
-- ямар ч уншигчийг эвдэхгүй (`accent_color`, `tv_kiosk`, `model_xkt_url`,
-- `repair_projects.rate_multiplier` бүгд ийм).  Заавал хасах бол ШИНЭ дугаар.

-- `run_golden.py`-ийн бүтэн payload.  Хэлбэр:
--   { "dataset_version", "manifest_sha256", "preprocess_contract", "kind",
--     "model_version", "partitions": { "intents": {"rows":61,"pass":61,...}, ... },
--     "required": [...], "blocked": [], "passed": true, "run_at" }
-- ⚠️ SQL дотор задлахыг БҮҮ оролд — репо даяар `json_extract` ТЭГ.  TS талд
-- `JSON.parse`.
ALTER TABLE assistant_models ADD COLUMN eval_json TEXT;

-- «Энэ загварыг ЯМАР хөлдөөсөн багцаар дүгнэсэн бэ» — `eval/manifest.json`-ы
-- `dataset_version`.  Багц өөрчлөгдсөн бол хоёр загварын оноо ХАРЬЦУУЛАХ
-- БОЛОМЖГҮЙ гэдгийг энэ талбар л хэлж чадна.
ALTER TABLE assistant_models ADD COLUMN eval_dataset_version TEXT;

-- Дүгнэлт БҮРЭН давсан эсэх (0/1).  Идэвхжүүлэх хаалга үүн дээр тогтоно:
-- `POST /assistant/models` нь `activate: true` + `eval_passed <> 1` үед 409.
ALTER TABLE assistant_models ADD COLUMN eval_passed INTEGER NOT NULL DEFAULT 0;

-- «Хамгийн сүүлд golden давсан загвар аль вэ» гэсэн ганц асуулт.
CREATE INDEX IF NOT EXISTS idx_assistant_models_evalpass
  ON assistant_models (eval_passed, created_at DESC);
