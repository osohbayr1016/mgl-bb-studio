-- 0212 — `assistant_logs`-ийн ГАРАЛ ҮҮСЭЛ (provenance).
--
-- ⚠️ ЯАГААД: мөр бүр АЛЬ загвар, АЛЬ add-in build-аас, ХЭЗЭЭ гарсныг
-- өнөөдөр хадгалдаггүй.  Тиймээс A/B, drift илрүүлэлт, «шинэ загвар
-- бодит урсгал дээр муудсан уу?» гэсэн асуултад хариулах БОЛОМЖГҮЙ.
-- Загварын чанарын цорын ганц тоо нь `assistant_models.accuracy` — офлайн
-- cross-validation, өөрөө хазайлттай.  Бодит урсгал дээрх хэмжүүр ТЭГ.
--
-- Add-in нь `model_version`-ыг АЛЬ ХЭДИЙН илгээж байна
-- (`revit-mcp/addin/AssistantLog.cs:41` DTO, `:185` дүүргэлт) — сервер
-- уншдаггүй, багана ч байхгүй тул тэр өгөгдөл ӨДӨР БҮР ЧИМЭЭГҮЙ ХАЯГДАЖ
-- байсан.  Энэ бол хөтөлбөрийн хамгийн бага өртөгтэй схемийн засвар.
--
-- ⚠️ `client_ts` ЯАГААД ХЭРЭГТЭЙ: `created_at` нь СЕРВЕРИЙН INSERT цаг.
-- Бүртгэл локал JSONL-д бичигдээд (`%APPDATA%\RevitMcpAddin\assistant-log.jsonl`)
-- БАГЦААР илгээгддэг тул дахин холбогдсоны дараа 100 мөр бараг ижил
-- `created_at` авна — үйл явдлын жинхэнэ дараалал ба тэдгээрийн хоорондох
-- ЗАЙ (latency-ийн суурь) устана.  Хугацааны хэмжилт (1C) үүнгүйгээр утгагүй.
-- `client_ts` нь `created_at`-ыг СОЛИХГҮЙ: `created_at` бол серверийн
-- итгэмжлэгдсэн цаг, `client_ts` бол ажилтны PC-ийн цаг (буруу байж болно).
-- Хоёулаа хэрэгтэй — 0195-ийн `idx_assistant_logs_curate` ба `_user`
-- индексүүд `created_at`-д тулгуурладаг.
--
-- ⚠️ `addin_version` нь ОДООГООР ХООСОН ирнэ: `RevitMcpAddin.csproj` нь
-- `<Version>`/`<AssemblyVersion>` зарладаггүй тул 8 Configuration бүгд
-- ижил `1.0.0.0` DLL гаргадаг.  C# тал нь 1C-ийн add-in гаралтад ирнэ.
-- багана нь утга буух ГАЗРЫГ урьдчилж бэлдэж байна.  Багана нь түүнийг
-- УНШИХ/БИЧИХ кодоос ХАТУУ ӨМНӨХ deploy-д гарах ёстой — энэ бол тэр deploy.
--
-- ⚠️ БҮХ БАГАНА NULLable, ЗОРИУДААР.  0212-оос өмнөх мөрүүд болон
-- шинэчлэгдээгүй ~20 PC-ийн хуучин add-in-аас ирэх мөрүүд хоосон утгатай
-- байх нь ХЭВИЙН.  `NOT NULL` тавих нь тэр мөрүүдийг татгалзаж, бүртгэлийн
-- урсгалыг бүхэлд нь тасална — «бүртгэл нь чат ажиллахад саад болох ёсгүй»
-- гэсэн `AssistantLog.cs:58-60`-ийн зарчмыг зөрчинө.
--
-- ⚠️ БАЙГАА хүснэгт дээрх ALTER тул блокийн ЭХЭНД.  Шинэ хүснэгт үүсгэхгүй,
-- `assistant_logs`-ыг ДАХИН БҮТЭЭХГҮЙ (тэр нь `users`-ийн ON DELETE CASCADE
-- хүүхэд — 0195:72).  `ADD COLUMN` нь дахин бүтээлт биш, аюулгүй.
--
-- ⚠️ SQLite-ийн `ALTER TABLE ... ADD COLUMN` нь `IF NOT EXISTS`-ыг
-- ДЭМЖДЭГГҮЙ.  Энэ файлыг ХОЁР УДАА ажиллуулж БОЛОХГҮЙ — `duplicate column
-- name` алдаа өгнө.  Migration bookkeeping үүнээс хамгаална — гараар
-- `d1 execute --file` БҮҮ ажиллуул.

ALTER TABLE assistant_logs ADD COLUMN model_version TEXT;
ALTER TABLE assistant_logs ADD COLUMN addin_version TEXT;
ALTER TABLE assistant_logs ADD COLUMN client_ts TEXT;

-- Гол шинжилгээний хэлбэр: «хувилбар X дээр fallback-ийн хувь хэд байв»,
-- «шинэ загвар идэвхжсэнээс хойш `unknown` руу унах нь өссөн үү».
CREATE INDEX IF NOT EXISTS idx_assistant_logs_model
  ON assistant_logs (model_version, created_at DESC);
