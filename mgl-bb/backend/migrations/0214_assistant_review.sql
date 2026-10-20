-- 0214 — Туслахын курацийн ТӨЛӨВ: татгалзал нь БОДИТ, БҮРТГЭГДСЭН төлөв.
--
-- ⚠️ ЯАГААД: 0195-д `assistant_logs.curated` нь ГАНЦ 0/1 туг байсан.  Түүнийг
-- `POST /api/revit/assistant/examples` дэвшүүлэлтийн ДАГАВАР үйлдлээр тавьдаг.
-- Үр дүнд нь ТАТГАЛЗСАН мөр ба ДЭВШҮҮЛСЭН мөр ялгагдахгүй; хянагч хэн бэ,
-- хэзээ, яагаад гэдэг мэдээлэл алга.  Сөрөг шүүлт — «энэ мөр сургалтад ОРОХ
-- ЁСГҮЙ, учир нь …» — бол сургалтын хамгийн үнэ цэнтэй дохио.  Түүнийг
-- үүсмэгц нь устгаж болохгүй.
--
-- ⚠️ `curated`-ыг ХЭВЭЭР үлдээв: `/assistant/pending`-ийн `WHERE curated = 0`
-- ба `idx_assistant_logs_curate` индекс түүн дээр тогтдог.  Шинэ багана нь
-- түүний ДЭЛГЭРЭНГҮЙ нь болно, ОРЛУУЛАГЧ нь биш.
--
-- ⚠️ ADD COLUMN дээр CHECK тавих БОЛОМЖГҮЙ (SQLite) — 0168/0170/0181-тэй
-- ижил.  Enum-ыг `routes/revit.ts` шалгана: 'promoted' | 'rejected'.
--
-- ⚠️ Хүснэгтийг ДАХИН БАРИХГҮЙ.  `assistant_logs` нь `users`-ийн CASCADE
-- хүүхэд; `migrations apply` транзакц дотор cascade АЖИЛЛАДАГ тул rebuild нь
-- өгөгдөл устгана.  Зөвхөн ADD COLUMN.

-- --- 1. БАЙГАА хүснэгтүүд дээрх ALTER — ЭХЭНД ---
-- (Дундуур унавал хоосон индекс/шинэчлэл үүсэхээс өмнө таслана.)

-- NULL = хараахан хянаагүй.  'promoted' = жишээ болсон.  'rejected' = сургалтад
-- ОРОХГҮЙ гэж ХҮН шийдсэн (мөрийг устгахгүй — шалтгаан нь өөрөө өгөгдөл).
ALTER TABLE assistant_logs ADD COLUMN review_status TEXT;
ALTER TABLE assistant_logs ADD COLUMN reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE assistant_logs ADD COLUMN reviewed_at TEXT;
-- Яагаад татгалзсан / яагаад залруулсан.  Хүний бичсэн текст, 500 тэмдэгт
-- (сервер тал таслана).
ALTER TABLE assistant_logs ADD COLUMN review_note TEXT;

-- Дэвшүүлсэн бол ЯМАР бүртгэлээс гарсан бэ.  Гар оруулга (source='manual') ба
-- бодитоор ажиглагдсан мөрийг ялгах ЦОРЫН ГАНЦ нотолгоо.
ALTER TABLE assistant_examples ADD COLUMN source_log_id INTEGER REFERENCES assistant_logs(id) ON DELETE SET NULL;

-- ⚠️ `assistant_examples.reviewed_at`-ыг ЭНД НЭМЭХГҮЙ.  Зэрэгцээ сессийн
-- `0215_assistant_trust_taxonomy.sql` тэр НЭР ЯГ ТЭР БАГАНЫГ нэмдэг бөгөөд
-- 0214 нь түүнээс ӨМНӨ ажиллана — хоёулаа нэмбэл 0215 нь «duplicate column
-- name: reviewed_at» гэж унаж, migration гинж ДУНДУУР тасарна.  Энэ багана
-- нь 0214-ийн код замд ХЭРЭГЛЭГДЭХГҮЙ (route нь түүнд бичдэггүй) тул
-- хасах нь функциональ өртөггүй.  Хянан үзэх мөчлөгийн багануудыг
-- `assistant_examples` дээр 0215 ЭЗЭМШИНЭ.

-- --- 2. Индексүүд ---

-- Хянасан түүхийн таб: «хэн юуг хэзээ».
CREATE INDEX IF NOT EXISTS idx_assistant_logs_review
  ON assistant_logs (review_status, reviewed_at DESC)
  WHERE review_status IS NOT NULL;

-- «Энэ жишээ хаанаас ирсэн бэ» — гар оруулга vs ажиглалт.
CREATE INDEX IF NOT EXISTS idx_assistant_ex_src_log
  ON assistant_examples (source_log_id)
  WHERE source_log_id IS NOT NULL;

-- --- 3. Түүхэн мөрийг НӨХӨН БӨГЛӨХ ---

-- 0214-ээс ӨМНӨ `curated = 1` болсон мөр нь ЗӨВХӨН дэвшүүлэлтээр л ийм болж
-- чадна (татгалзлын зам БАЙГААГҮЙ), тиймээс 'promoted' гэж тэмдэглэх нь зөв.
-- `reviewed_by` / `reviewed_at` нь ҮЛ МЭДЭГДЭХ — хуурамч хүн, хуурамч огноо
-- БИЧИХГҮЙ, NULL үлдээнэ.
UPDATE assistant_logs
   SET review_status = 'promoted'
 WHERE curated = 1 AND review_status IS NULL;
