using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace RevitMcpAddin
{
    /// <summary>Ангилагчийн нэг таамаглал.</summary>
    public sealed class IntentPrediction
    {
        public string Intent { get; set; }
        public double Confidence { get; set; }
        /// <summary>Итгэлцлээр эрэмбэлсэн бүх санаа — сонголт харуулахад.</summary>
        public List<KeyValuePair<string, double>> Ranked { get; set; }
            = new List<KeyValuePair<string, double>>();
    }

    /// <summary>Диск/эх сурвалжаас уншсан загварын жин.</summary>
    public sealed class IntentModelData
    {
        [JsonPropertyName("version")] public string Version { get; set; }
        [JsonPropertyName("intents")] public string[] Intents { get; set; }
        // ⚠️ Урьдчилан боловсруулалтын ГЭРЭЭ.  Python тал `train_intent.py`-ийн
        // PREPROCESS_CONTRACT-ыг бичдэг; энд таарахгүй бол загварыг ТАТГАЛЗАНА.
        // Үүнгүйгээр хуучин add-in шинэ загвар татаад, эвхэлтгүй n-gram гаргаж
        // ЧИМЭЭГҮЙ буруу таамаглах байсан — эмхэтгэл ногоон, алдаа үл үзэгдэх.
        [JsonPropertyName("preprocess")] public string PreprocessContract { get; set; }

        [JsonPropertyName("ngram_min")] public int NgramMin { get; set; } = 3;
        [JsonPropertyName("ngram_max")] public int NgramMax { get; set; } = 5;
        /// <summary>n-gram → индекс.</summary>
        [JsonPropertyName("vocab")] public Dictionary<string, int> Vocab { get; set; }
        [JsonPropertyName("idf")] public double[] Idf { get; set; }
        /// <summary>[санаа][онцлог] — logistic regression-ий коэффициент.</summary>
        [JsonPropertyName("coef")] public double[][] Coef { get; set; }
        [JsonPropertyName("intercept")] public double[] Intercept { get; set; }
    }

    /// <summary>
    /// САНАА ТАНИХ АНГИЛАГЧ — цэвэр C#, хамааралгүй, офлайн, ~1 мс.
    ///
    /// ⚠️ ЯАГААД LLM БИШ ВЭ:
    /// «Ямар текст → ямар үйлдэл» гэдэг нь ХААЛТТАЙ, ЖИЖИГ ангиллын бодлого
    /// (9 ангилал).  Ийм бодлогод сонгодог ML нь LLM-ээс хямд, хурдан,
    /// найдвартай.  Мөн:
    ///   • Интернэт, API түлхүүр, захиалга ШААРДАХГҮЙ
    ///   • Ажилтан бүрд ЯГ ИЖИЛ ажиллана (загвар өөрчлөгдөхгүй)
    ///   • Бусад компанид зарахад суудал тутмын өртөг ТЭГ
    ///
    /// ⚠️ ЯАГААД ТЭМДЭГТИЙН n-gram ВЭ:
    /// Монгол хэл ЗАЛГАМАЛ — «илгээ / илгээх / илгээнэ / илгээчих /
    /// илгээгээрэй» бүгд нэг үндэстэй.  Үгээр ажилладаг арга эдгээрийг ӨӨР
    /// ӨӨР үг гэж үзнэ.  Тэмдэгтийн 3-5 n-gram нь «илгэ», «лгээ» гэсэн
    /// хэсгүүдээр бүх хэлбэрийг барьдаг тул морфологийн задлагч, толь бичиг
    /// ХЭРЭГГҮЙ.  Кирилл, латин, үсгийн алдаа бүгдэд ажиллана.
    ///
    /// ⚠️ УРЬДЧИЛАН БОЛОВСРУУЛАЛТ нь Python-ы сургалттай ЯГ ТААРАХ ЁСТОЙ.
    /// `revit-mcp/training/train_intent.py` доторх `preprocess()` нь энэ
    /// файлын `Preprocess()`-ийн ХОСЛОЛ (twin).  Аль нэгийг өөрчилвөл
    /// нөгөөг нь ЗААВАЛ зэрэг өөрчил — эс бөгөөс нарийвчлал чимээгүй унана.
    /// </summary>
    public static class IntentModel
    {
        /// <summary>Ойлгосонгүй гэж үзэх ангиллын нэр.</summary>
        public const string UnknownIntent = "unknown";

        /// <summary>
        /// Урьдчилан боловсруулалтын ГЭРЭЭ — `train_intent.py`-ийн
        /// PREPROCESS_CONTRACT-тай ЗААВАЛ таарна.
        ///
        /// ⚠️ `Preprocess()` эсвэл `TextFold.Fold()`-ийг өөрчилвөл ХОЁР
        /// ТАЛЫН мөрийг ЗЭРЭГ шинэчил.  Ингэснээр хуучин add-in шинэ
        /// загварыг (эсвэл эсрэгээр) чимээгүй буруу уншихаас сэргийлнэ:
        /// үгсийн сан нь өөр хэлбэрийн n-gram-аас бүтсэн байх тул нэг ч
        /// таарц олдохгүй, бүх зүйл `unknown` руу унана.
        /// </summary>
        public const string PreprocessContract = "fold-v1";

        /// <summary>Шинэчилсэн загварыг серверээс татаад энд хадгална.</summary>
        private static string LocalModelPath =>
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "RevitMcpAddin",
                "intent-model.json");

        // ⚠️ `volatile` — ЗААВАЛ.  Хурдан зам (`EnsureLoaded`-ийн эхний мөр)
        // энэ талбарыг ТҮГЖЭЭНЭЭС ГАДНА уншина; түүнийг оноож буй бичилт
        // нь өөр thread дээр болно.  `volatile`-гүй бол уншигч thread
        // хуучирсан null-ыг мөнхөд харж болзошгүй (publication hazard).
        private static volatile IntentModelData _model;
        private static bool _loadAttempted;
        private static readonly object Gate = new object();

        /// <summary>Ачаалагдсан загварын хувилбар, эсвэл null.  ⚠️ Ачаалахыг ХҮЧЛЭХГҮЙ.</summary>
        public static string LoadedVersion => _model?.Version;

        /// <summary>
        /// Ачаалалтыг ХҮЧЛЭЭД хувилбарыг буцаана.
        ///
        /// ⚠️ `LoadedVersion` нь `EnsureLoaded()` дууддаггүй.  Самбар нээгдэх
        /// үед нэг ч `Predict` ажиллаагүй байдаг тул `_model` нь null,
        /// `?have=` параметр ОГТ илгээгддэггүй, улмаас 918 KB жин СЕСС БҮРТ
        /// дахин татагддаг байв (2026-08-27-нд батлагдсан).
        /// ⚠️ ЗААВАЛ АРЫН THREAD-ЭЭС дууд — UI дээр 918 KB parse унана.
        /// </summary>
        public static string VersionForSync()
        {
            try { EnsureLoaded(); } catch { }
            return _model?.Version;
        }

        /// <summary>
        /// Загварыг АРЫН thread дээр урьдчилан ачаална.  ХЭЗЭЭ Ч алдаа шидэхгүй.
        ///
        /// ⚠️ ЯАГААД АЮУЛГҮЙ ВЭ: ачаалах зам нь File / Assembly / StreamReader /
        /// JsonSerializer + статик талбар л хөнддөг — `Autodesk.Revit`-ийн ямар ч
        /// төрөл, `Document`, UI-д холбогдсон төлөв ОРОХГҮЙ.  Мөн ЯГ ИЖИЛ parse
        /// нь `SaveDownloaded` дотор аль хэдийн `Task.Run` дээр ажилладаг.
        ///
        /// ⚠️ ЭНЭ НЬ ДЭЭРХ publication засварын ДАРАА л утгатай.  Түүнээс өмнө
        /// нэмбэл `_model` оноогдохоос өмнө тугийг уншсан зэрэгцээ `Predict` нь
        /// null загвар хараад чимээгүй fallback руу унана — тэр мөр сургалтын
        /// логд «ойлгосонгүй» гэж бичигдэнэ.
        /// </summary>
        public static void PrewarmAsync()
        {
            System.Threading.Tasks.Task.Run(() => { try { EnsureLoaded(); } catch { } });
        }

        /* ============================================================== */
        /*  ХЭМЖИЛТ (1C) — загварын ХҮЙТЭН ачаалалт                        */
        /* ============================================================== */

        /// <summary>
        /// Загварыг ачаалахад зарцуулсан мс.  Ачаалалт хараахан болоогүй бол null.
        ///
        /// ⚠️ Энэ нь СЕСС ТУТАМ НЭГ УДААГИЙН тоо — 918 KB JSON parse.  Тэр нь
        /// урьдчилан халаалт (`PrewarmAsync`) хийгдээгүй бол хэрэглэгчийн
        /// ЭХНИЙ мессежийн UI thread дээр унана.  Халаалт ажиллаж байгаа
        /// эсэхийг батлах ЦОРЫН ГАНЦ бодит нотолгоо: халаалттай үед энэ тоо
        /// эхний мессежийн `t_total_ms`-д БАГТАХГҮЙ.
        /// </summary>
        public static double? LastLoadMs => _lastLoadMs;

        /// <summary>`local` (татсан файл) / `embedded` (DLL дотор) / `none` (олдоогүй).</summary>
        public static string LastLoadSource => _lastLoadSource;

        private static double? _lastLoadMs;
        private static string _lastLoadSource;

        /// <summary>1 = ачаалалт болсон бөгөөд хараахан ТАЙЛАГНААГҮЙ.</summary>
        private static int _loadFresh;

        /// <summary>
        /// ХҮЙТЭН АЧААЛАЛТЫГ НЭГ Л УДАА тайлагнана (consume-once).
        ///
        /// ⚠️ ЯАГААД `LastLoadMs`-ыг ШУУД уншиж БОЛОХГҮЙ ВЭ: тэр нь
        /// СЕССИЙН туршид тогтмол утга (дээрх `Reload()`-ийн тайлбарыг үз)
        /// тул `AssistantPane` түүнийг мессеж бүрт уншиж `assistant_logs`-д
        /// бичихэд НЭГ УДААГИЙН 918 KB parse нь МӨР БҮРТ давтагдана.
        /// Сервер тал дээр «хүйтэн ачаалалт өдөрт 200 удаа болсон» гэсэн
        /// ХУДАЛ дүр зураг гарна.  Энэ арга нь тэр тоог зөвхөн ЯГ ТЭР
        /// мессежийн мөрөнд оруулна.
        ///
        /// ⚠️ `Reload()`-ийн дараах ДАХИН ачаалалт нь дахин «шинэ» болно —
        /// тэр нь ҮНЭХЭЭР шинэ хүйтэн ачаалалт учраас зөв.
        /// </summary>
        public static bool TakeFreshLoad(out double? ms, out string source)
        {
            if (System.Threading.Interlocked.Exchange(ref _loadFresh, 0) == 0)
            {
                ms = null;
                source = null;
                return false;
            }
            ms = _lastLoadMs;
            source = _lastLoadSource;
            return true;
        }

        public static bool IsReady
        {
            get { EnsureLoaded(); return _model != null; }
        }

        /// <summary>Дараагийн дуудлагад дискнээс ДАХИН уншина.</summary>
        public static void Reload()
        {
            // ⚠️ Хэмжилтийн талбаруудыг ЦЭВЭРЛЭХГҮЙ: `LastLoadMs` нь «энэ
            // сесст загвар ачаалахад ХИЧНЭЭН удсан бэ» гэсэн асуултын хариу
            // бөгөөд `Reload()` нь дараагийн ачаалалт дээр түүнийг дарж бичнэ.
            lock (Gate) { _model = null; _loadAttempted = false; }
        }

        private static void EnsureLoaded()
        {
            // ⚠️ ХУРДАН ЗАМД ТАЛБАРЫГ шалгана, ТУГИЙГ БИШ.  `_loadAttempted`
            // нь `_model`-ыг оноохоос ӨМНӨ true болдог тул түүн дээр эрт
            // гарвал зэрэгцээ дуудагч null загвар хараад ЧИМЭЭГҮЙ fallback
            // руу унана — тэр мөр сургалтын логд «ойлгосонгүй» гэж бичигдэж,
            // сургалтын багцыг хордуулна.
            //
            // ⚠️ Загвар үнэхээр БАЙХГҮЙ үед (файл ч, embedded ч алга) `_model`
            // мөнхөд null тул хурдан зам түгжээнд орно — гэхдээ доторх
            // `_loadAttempted` шалгалт шууд буцаана.  Хямд.
            if (_model != null) return;
            if (!LoadUnderLock()) return;

            // ⚠️⚠️ ХЭМЖИЛТИЙН БИЧИЛТ НЬ ТҮГЖЭЭНЭЭС ГАДУУР (2026-08-28).
            //
            // Урьд нь `Metrics.Emit` нь `lock (Gate)`-ийн ДОТОР, 918 KB
            // parse-ийн критик хэсэгт байсан бөгөөд тэр үед `Emit` нь
            // СИНХРОН дискний бичилт хийдэг байв.  Хэрэглэгчийн ЭХНИЙ
            // мессеж (халаалт амжаагүй бол) UI thread дээр parse-ийг
            // хүлээгээд, ДАРАА нь дискний бичилтийг ч хүлээдэг байсан —
            // өөрөөр хэлбэл хэмжигч нь өөрийн хэмжиж буй `t_total_ms`-ыг
            // өсгөж байлаа.  Одоо `Emit` нь буфферлэдэг БӨГӨӨД энэ мөр
            // түгжээнээс гадна байрлана: хоёулаа хэрэгтэй, учир нь
            // түгжээний дотор ямар нэг зүйл хийх нь зэрэгцээ дуудагчийг
            // хүлээлгэсээр байх болно.
            Metrics.Emit(
                "[MGL/timing] model.load " +
                (_lastLoadMs ?? 0).ToString("F0",
                    System.Globalization.CultureInfo.InvariantCulture) +
                "ms source=" + (_lastLoadSource ?? "none"));
        }

        /// <summary>
        /// Ачаалалтын түгжээтэй хэсэг.  Буцах утга: ЭНЭ дуудлага үнэхээр
        /// ачаалалт ХИЙСЭН эсэх (хийгээгүй бол тайлагнах юм алга).
        /// ⚠️ ХЭМЖИНЭ — ГЭХДЭЭ БИЧИХГҮЙ.  Дискний бичилт `EnsureLoaded`-д.
        /// </summary>
        private static bool LoadUnderLock()
        {
            lock (Gate)
            {
                if (_loadAttempted) return false;
                _loadAttempted = true;
                // ⚠️ ХЭМЖИЛТ (1C): түгжээ ДОТОР ХЭМЖИНЭ.  Энэ бол add-in-ы
                // цорын ганц «хүйтэн эхлэл» — 918 KB JSON parse.  ЗӨВХӨН
                // ХЭМЖИНЭ, ямар ч төсөв хязгаарлахгүй.
                var loadSw = System.Diagnostics.Stopwatch.StartNew();
                try
                {
                    // 1) Татаж авсан шинэ загвар (байвал)
                    if (File.Exists(LocalModelPath))
                    {
                        _model = Parse(File.ReadAllText(LocalModelPath, Encoding.UTF8));
                        if (_model != null) { _lastLoadSource = "local"; return true; }
                    }
                    // 2) Add-in дотор шигтгэсэн суурь загвар
                    _model = LoadEmbedded();
                    _lastLoadSource = _model != null ? "embedded" : "none";
                    return true;
                }
                catch (Exception ex)
                {
                    // Загваргүй ч add-in АЖИЛЛАХ ёстой — түлхүүр үгийн
                    // давхарга байгаа, ойлгохгүй бол сонголт харуулна.
                    System.Diagnostics.Debug.WriteLine("[IntentModel] load failed: " + ex.Message);
                    _model = null;
                    _lastLoadSource = "none";
                    return true;
                }
                finally
                {
                    // ⚠️ `finally` — дээрх бүх `return` нь энэ мөрийг тойрч
                    // гарах ёсгүй, эс бөгөөс амжилттай ачаалалт хэзээ ч
                    // хэмжигдэхгүй.
                    loadSw.Stop();
                    _lastLoadMs = loadSw.Elapsed.TotalMilliseconds;
                    // ТАЙЛАГНААГҮЙ гэж тэмдэглэнэ — `TakeFreshLoad` нэг л
                    // удаа авна.  Түүнгүйгээр энэ тоо МӨР БҮРТ давтагдана.
                    System.Threading.Interlocked.Exchange(ref _loadFresh, 1);
                    Metrics.ModelLoad.Add(_lastLoadMs.Value, ok: _model != null);
                }
            }
        }

        private static IntentModelData LoadEmbedded()
        {
            var asm = System.Reflection.Assembly.GetExecutingAssembly();
            foreach (string name in asm.GetManifestResourceNames())
            {
                if (!name.EndsWith("intent-model.json", StringComparison.OrdinalIgnoreCase))
                    continue;
                using Stream s = asm.GetManifestResourceStream(name);
                if (s == null) continue;
                using var r = new StreamReader(s, Encoding.UTF8);
                return Parse(r.ReadToEnd());
            }
            return null;
        }

        private static IntentModelData Parse(string json)
        {
            if (string.IsNullOrWhiteSpace(json)) return null;
            var m = JsonSerializer.Deserialize<IntentModelData>(json);
            if (m?.Intents == null || m.Vocab == null || m.Coef == null ||
                m.Idf == null || m.Intercept == null)
                return null;
            if (m.Coef.Length != m.Intents.Length || m.Intercept.Length != m.Intents.Length)
                return null;

            // ⚠️ Гэрээ таарахгүй бол ТАТГАЛЗАНА.  Хуучин загвар (гэрээгүй) ч
            // мөн адил — тэр нь эвхэлтгүй үгсийн сантай тул одоогийн
            // Preprocess()-ийн гаргасан n-gram-тай огт таарахгүй.
            if (!string.Equals(m.PreprocessContract, PreprocessContract, StringComparison.Ordinal))
                return null;

            return m;
        }

        /// <summary>Серверээс татсан загварыг хадгална.  Амжилттай бол true.</summary>
        public static bool SaveDownloaded(string json)
        {
            try
            {
                if (Parse(json) == null) return false;
                Directory.CreateDirectory(Path.GetDirectoryName(LocalModelPath));
                // ⚠️ BOM-гүй — бусад хэрэгсэл (Python) уншиж болзошгүй.
                File.WriteAllText(LocalModelPath, json, new UTF8Encoding(false));
                Reload();
                return true;
            }
            catch
            {
                return false;
            }
        }

        /* ============================================================== */
        /*  Урьдчилан боловсруулалт — Python-тай ХОСЛОЛ                    */
        /* ============================================================== */

        /// <summary>
        /// ⚠️ `training/train_intent.py`-ийн `preprocess()`-тэй ЯГ ИЖИЛ байх ёстой.
        ///
        ///   1. жижиг үсэг (invariant)
        ///   2. зай бүрийг НЭГ зай болгож хураах
        ///   3. хоёр талд зай нэмэх — үгийн ЭХЛЭЛ/ТӨГСГӨЛИЙН n-gram үүсгэхийн тулд
        ///
        /// Кирилл/латин хөрвүүлэлт ЭНД ХИЙХГҮЙ.  Сургалтын багцад хоёр бичлэг
        /// хоёулаа байгаа тул загвар өөрөө хоёуланг нь сурна — хөрвүүлэлт
        /// хийвэл харин мэдээлэл алдагдана («х» ба «h» ялгаатай байж болно).
        /// </summary>
        /// <summary>
        /// Урьдчилан боловсруулалт.
        /// ⚠️ `train_intent.py`-ийн `preprocess()`-тэй ЯГ ИЖИЛ БАЙХ ЁСТОЙ.
        /// `training/check_parity.py` нь үүнийг 703 мөр дээр барина.
        ///
        /// Кирилл ба латинаар бичсэн монголыг НЭГ хэлбэрт буулгана:
        ///     «Хийснээ илгээе»  → " hisne ilge "
        ///     «hiisnee ilgeeye» → " hisne ilgeie "
        ///     «ХИЙСНЭЭ ИЛГЭЭЕ»  → " hisne ilge "
        ///
        /// ⚠️ Эвхэлт нь ЦЭГ ТАСЛАЛЫГ УСТГАНА.  Монголд асуултыг бөөм
        /// («уу/вэ/бэ») зөөдөг тул алдагдахгүй, харин англид «is it 70%?»
        /// ба «it is 70%» хоёрын цорын ганц ялгаа нь тэмдэг байж болно —
        /// тиймээс `qmark` гэсэн тусдаа үг залгана.
        /// </summary>
        public static string Preprocess(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return " ";
            string s = TextFold.Fold(raw);
            if (raw.IndexOf('?') >= 0) s = s.Length > 0 ? s + " qmark" : "qmark";
            return " " + s + " ";
        }

        /* ============================================================== */
        /*  Таамаглал                                                      */
        /* ============================================================== */

        /// <summary>
        /// Текстийн санааг таана.  ХЭЗЭЭ Ч алдаа шидэхгүй.
        /// Загвар байхгүй бол `Intent = null` буцаана — дуудагч түлхүүр
        /// үгийн давхарга эсвэл сонголтын жагсаалт руу шилжинэ.
        /// </summary>
        public static IntentPrediction Predict(string raw)
        {
            var none = new IntentPrediction { Intent = null, Confidence = 0 };
            EnsureLoaded();
            IntentModelData m = _model;
            if (m == null) return none;

            try
            {
                // --- TF: n-gram тоолол -------------------------------------
                string text = Preprocess(raw);
                var counts = new Dictionary<int, double>();
                int len = text.Length;
                for (int n = m.NgramMin; n <= m.NgramMax; n++)
                {
                    if (len < n) break;
                    for (int i = 0; i + n <= len; i++)
                    {
                        string g = text.Substring(i, n);
                        if (!m.Vocab.TryGetValue(g, out int idx)) continue;
                        counts.TryGetValue(idx, out double c);
                        counts[idx] = c + 1;
                    }
                }
                // ⚠️ ЭНД ЭРТ ГАРЧ БОЛОХГҮЙ.  Нэг ч n-gram таарахгүй үед
                // («ok», «hmm», «asdf») sklearn нь ТЭГ вектор үүсгээд
                // intercept-ээс таамаглал гаргадаг — ихэвчлэн `unknown`.
                // Урьд нь энд `return none` байсан тул C# нь Python-оос
                // 215 мөрийн 7 дээр ЗӨРДӨГ байв (parity тестээр илэрсэн).
                // Одоо ижил зам: тэг вектороор үргэлжилнэ.

                // --- TF-IDF + L2 нормчлол ----------------------------------
                // ⚠️ scikit-learn-ий TfidfVectorizer(sublinear_tf=False,
                // norm='l2') -тай ижил дараалал: tf × idf, ДАРАА нь нормчлол.
                double sumSq = 0;
                var keys = new List<int>(counts.Keys);
                foreach (int idx in keys)
                {
                    double v = counts[idx] * (idx < m.Idf.Length ? m.Idf[idx] : 0);
                    counts[idx] = v;
                    sumSq += v * v;
                }
                // Хоосон вектор дээр 0 — доор хуваахгүй.
                double norm = sumSq > 0 ? Math.Sqrt(sumSq) : 0;

                // --- Шугаман оноо ------------------------------------------
                int k = m.Intents.Length;
                var scores = new double[k];
                for (int c = 0; c < k; c++)
                {
                    double dot = 0;
                    double[] w = m.Coef[c];
                    if (norm > 0)
                    {
                        foreach (KeyValuePair<int, double> kv in counts)
                        {
                            if (kv.Key < w.Length) dot += (kv.Value / norm) * w[kv.Key];
                        }
                    }
                    scores[c] = dot + m.Intercept[c];
                }

                // --- Softmax (тогтвортой) -----------------------------------
                double max = double.NegativeInfinity;
                for (int c = 0; c < k; c++) if (scores[c] > max) max = scores[c];
                double sum = 0;
                for (int c = 0; c < k; c++) { scores[c] = Math.Exp(scores[c] - max); sum += scores[c]; }
                if (sum <= 0) return none;

                var ranked = new List<KeyValuePair<string, double>>(k);
                for (int c = 0; c < k; c++)
                    ranked.Add(new KeyValuePair<string, double>(m.Intents[c], scores[c] / sum));
                ranked.Sort((a, b) => b.Value.CompareTo(a.Value));

                return new IntentPrediction
                {
                    Intent = ranked[0].Key,
                    Confidence = ranked[0].Value,
                    Ranked = ranked,
                };
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine("[IntentModel] predict failed: " + ex.Message);
                return none;
            }
        }

        /// <summary>Хүнд харагдах монгол нэр.</summary>
        public static string LabelOf(string intent)
        {
            switch (intent)
            {
                case "submit_progress": return "Хийснээ илгээх";
                case "list_sheets": return "Хуудсуудыг харуулах";
                case "isolate_sheet": return "Хуудсыг тусгаарлах";
                case "reset_view": return "Тусгаарлалтыг цуцлах";
                case "whats_changed": return "Юу өөрчлөгдсөнийг харах";
                case "set_baseline": return "Эхлэл тэмдэглэх";
                case "progress_status": return "Явц хэд болсныг харах";
                case "help": return "Тусламж";
                default: return intent ?? "—";
            }
        }

        /// <summary>Дибагт зориулсан товч тайлбар.</summary>
        public static string Explain(IntentPrediction p)
        {
            if (p?.Ranked == null || p.Ranked.Count == 0) return "загваргүй";
            var sb = new StringBuilder();
            for (int i = 0; i < Math.Min(3, p.Ranked.Count); i++)
            {
                if (i > 0) sb.Append(" · ");
                sb.Append(p.Ranked[i].Key).Append(' ')
                  .Append(p.Ranked[i].Value.ToString("0.00", CultureInfo.InvariantCulture));
            }
            return sb.ToString();
        }
    }
}
