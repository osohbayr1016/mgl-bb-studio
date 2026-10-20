using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Threading;
using Autodesk.Revit.ApplicationServices;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Events;

namespace RevitMcpAddin
{
    /// <summary>
    /// ӨӨРЧЛӨЛТИЙГ REVIT ӨӨРӨӨ ХЭЛНЭ — сканнердахгүй.
    ///
    /// ⚠️ ЯАГААД ЭНЭ ГАРСАН БЭ (2026-08-25, хэрэглэгчийн гомдол):
    /// «2–3 өөрчлөлт хийгээд асуухад 120 секунд хүлээгээд хугацаа дуусдаг».
    ///
    /// Хуучин `BuildSnapshot` нь ХУУДАС БҮРИЙН ХАРАГДАЦ БҮРД
    ///     new FilteredElementCollector(doc, viewId)
    /// хийдэг байв.  Энэ бол Revit API-ийн ХАМГИЙН ҮНЭТЭЙ хэлбэр: харагдацын
    /// хамрах хүрээтэй collector нь тухайн харагдацыг REGENERATE хийлгэж,
    /// харагдах байдал / шүүлтүүр / crop / линкийг бүхэлд нь тооцуулдаг.
    /// 100 хуудас × 2 харагдац = 200 удаагийн regenerate — бүтэн загварын
    /// харагдах байдлыг 200 удаа бодох гэсэн үг.
    ///
    /// Бүр дор нь: тэр сканнер `capture_baseline` БОЛОН `diff_since_baseline`
    /// ХОЁУЛАНД, мөн явц илгээсний ДАРАА дахин ажилладаг байв — өөрөөр
    /// хэлбэл НЭГ ИЛГЭЭЛТ = ХОЁР бүтэн сканнер.
    ///
    /// ЭНЭ АНГИ ТҮҮНИЙГ ОРЛУУЛНА.  Revit нь гүйлгээ бүрийн дараа
    /// `DocumentChanged` дуудаж, ЮУ нэмэгдсэн / устсан / өөрчлөгдсөнийг
    /// ӨӨРӨӨ хэлдэг.  Тэр мэдээллийг Revit аль хэдийн тооцоолсон (undo стек
    /// нь түүн дээр тогтдог) тул бидэнд ҮНЭГҮЙ.
    ///
    ///     хуучин:  O(хуудас × харагдац × харагдах элемент)   ≈ 120 сек+
    ///     шинэ:    O(өөрчлөгдсөн элемент)                     ≈ 0 мс
    ///
    /// ДАВУУ ТАЛ: хуучин арга нь элементийн ЗАСВАРЫГ огт хардаггүй байв
    /// (id өөрчлөгддөггүй тул хэш ижил гарна).  `GetModifiedElementIds()` нь
    /// түүнийг өгдөг — энэ засвар нь зөвхөн хурдан биш, УТГААРАА Ч ИЛҮҮ ЗӨВ.
    ///
    /// ⚠️ ҮЙЛ ЯВДЛЫН ДОТОР ЮУ ХИЙЖ БОЛОХГҮЙ ВЭ:
    /// Revit нь `DocumentChanged`-ийн үед баримтыг УНШИХ горимд барина.
    /// Гүйлгээ нээх, элемент өөрчлөх, `Regenerate()` дуудах нь онцгой байдал
    /// үүсгэнэ.  Мөн ФАЙЛ БИЧИЖ БОЛОХГҮЙ — хэрэглэгчийн зурж байгаа үйлдэл
    /// бүрийг диск хүлээлгэнэ.  Тиймээс энд ЗӨВХӨН `long` id-г олонлогт
    /// хийж, «бохирдсон» гэж тэмдэглэнэ; бичилтийг таймер арын thread дээр
    /// ЖИГДРҮҮЛЖ (debounce) хийнэ.
    /// </summary>
    internal static class ChangeTracker
    {
        /// <summary>Диск рүү бичих хамгийн бага завсар.</summary>
        private const int FlushIntervalMs = 3000;

        /// <summary>
        /// Санах ойд барих id-ийн дээд хязгаар.  Нэг хүний нэг өдрийн ажил
        /// үүнд хэзээ ч хүрэхгүй; хязгаар нь зөвхөн эмгэг тохиолдлыг
        /// (скрипт, олон мянган элемент импортлох) барина.  Хэтэрвэл
        /// ТООЛОХОО ҮРГЭЛЖЛҮҮЛНЭ, зөвхөн id хадгалахаа болино.
        /// </summary>
        private const int MaxTrackedIds = 500000;

        /// <summary>
        /// META (үйлдлийн нэр + цаг) хадгалах элементийн дээд тоо.
        ///
        /// ⚠️ `MaxTrackedIds`-ээс ХАМААГҮЙ бага байх нь САНААТАЙ.  id нь 8 байт,
        /// META нь мөр бүрт JSON-д ~30 байт болж диск рүү 3 секунд тутам бичигдэнэ.
        /// Нэг хүний нэг өдрийн ажил 20 мянган элементэд хэзээ ч хүрэхгүй; хязгаар
        /// нь зөвхөн скрипт/импортын эмгэг тохиолдлыг барина.  Хэтэрвэл ТООЛОХОО
        /// үргэлжлүүлж, зөвхөн META бичихээ болино.
        /// </summary>
        private const int MaxMetaEntries = 20000;

        /// <summary>Өвөрмөц үйлдлийн нэрийн дээд тоо — эвдэрсэн оролтоос хамгаална.</summary>
        private const int MaxOpNames = 200;

        private static readonly DateTime Epoch =
            new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);

        /// <summary>Нэг элементэд хамаарах META — ЮУГ, ХЭЗЭЭ.</summary>
        internal struct Touch
        {
            /// <summary>`Change.Ops` жагсаалтын индекс; -1 бол тодорхойгүй.</summary>
            public int Op;
            /// <summary>Unix секунд (UTC).  Ticks-ээс 10 дахин богино JSON.</summary>
            public long Sec;

            /// <summary>
            /// Энэ элементийг ХЭДЭН УДАА хөндсөн бэ.
            ///
            /// ⚠️ ЭНЭ БОЛ ЗӨВХӨН ӨӨРИЙГӨӨ ШАЛГАХ ТОО (2026-08-26-ны шийдвэр).
            /// Ахлагчийн тайланд ХЭЗЭЭ Ч ОРОХГҮЙ: нэг ханыг 20 удаа хөндсөн нь
            /// «муу ажилтан» гэсэн үг биш, суралцаж яваа хүний хэвийн байдал.
            /// Тайланд оруулбал энэ нь шинэ ажилтныг шийтгэх хэрэгсэл болно.
            /// Инженер өөрөө «би энд хэт удаан эргэлдсэн байна» гэдгээ хармаар
            /// бол самбартаа харна.
            /// </summary>
            public int Hits;

            /// <summary>
            /// БУЦААГДААГҮЙ өөрчлөлтийн ЦЭВЭР тоо.
            ///
            /// ⚠️ `Hits`-ЭЭС ЯЛГААТАЙ.  `Hits` нь хичээсэн хүчин чармайлтыг
            /// хэмждэг тул undo-г ч тооцно; `Depth` нь «энэ элемент суурийн
            /// байдлаасаа ХӨДӨЛСӨН хэвээр байна уу» гэдгийг хэлнэ.
            ///
            /// Ctrl+Z дарахад 1-ээр буурч, 0 болбол элемент суурьдаа эргэж
            /// ирсэн гэсэн үг — жагсаалтаас БҮРЭН хасагдана.  Хоёр удаа зөөгөөд
            /// нэг л удаа буцаавал 2-1 = 1 тул ХЭВЭЭР тоологдоно (тэр нь зөв:
            /// элемент анхны байрандаа ороогүй байгаа).
            /// </summary>
            public int Depth;
        }

        /// <summary>Нэг баримтын хуримтлагдсан өөрчлөлт.</summary>
        internal sealed class Change
        {
            public DateTime BaselineAtUtc { get; set; }
            /// <summary>Суурь тавих үеийн элементийн тоо — зөвхөн харуулах контекст.</summary>
            public int BaselineElementCount { get; set; }
            public HashSet<long> Added { get; set; } = new HashSet<long>();
            public HashSet<long> Deleted { get; set; } = new HashSet<long>();
            public HashSet<long> Modified { get; set; } = new HashSet<long>();
            /// <summary>Хязгаарт хүрч id-нууд дутуу үлдсэн эсэх.</summary>
            public bool Truncated { get; set; }

            /// <summary>
            /// Өвөрмөц үйлдлийн нэрс — Revit-ийн ӨӨРИЙНХ нь гүйлгээний нэр
            /// («Move», «Delete», «Change Wall Type»).  Мөр бүрт бүтэн мөр
            /// хадгалахын оронд индекслэнэ: 500 өөрчлөлт ихэвчлэн 5-10 өөр
            /// үйлдэлд л хамаарна.
            /// </summary>
            public List<string> Ops { get; set; } = new List<string>();

            /// <summary>id → (үйлдэл, хэзээ).  ЗӨВХӨН дэлгэцэнд зориулсан.</summary>
            public Dictionary<long, Touch> Meta { get; set; } = new Dictionary<long, Touch>();

            /// <summary>META хязгаарт хүрсэн эсэх — тоолол хэвээр зөв, тайлбар л дутуу.</summary>
            public bool MetaTruncated { get; set; }

            /// <summary>Нэр → индекс.  Диск рүү бичигдэхгүй, `Ops`-оос сэргээгдэнэ.</summary>
            private Dictionary<string, int> _opIndex;

            public int Total => Added.Count + Deleted.Count + Modified.Count;

            /// <summary>Үйлдлийн нэрийг индекс болгоно; шинэ бол жагсаалтад нэмнэ.</summary>
            public int OpIndexOf(string name)
            {
                if (string.IsNullOrWhiteSpace(name)) name = "?";
                if (_opIndex == null)
                {
                    _opIndex = new Dictionary<string, int>(StringComparer.Ordinal);
                    for (int i = 0; i < Ops.Count; i++) _opIndex[Ops[i]] = i;
                }
                int idx;
                if (_opIndex.TryGetValue(name, out idx)) return idx;
                if (Ops.Count >= MaxOpNames) return -1;
                Ops.Add(name);
                idx = Ops.Count - 1;
                _opIndex[name] = idx;
                return idx;
            }

            /// <summary>META тэмдэглэнэ.  Хязгаарт хүрсэн бол ЧИМЭЭГҮЙ өнгөрөөнө.</summary>
            public void Note(long id, int opIdx, long sec)
            {
                Touch prev;
                bool known = Meta.TryGetValue(id, out prev);
                int hits = known ? prev.Hits : 0;
                int depth = known ? prev.Depth : 0;

                if (Meta.Count >= MaxMetaEntries && !known)
                {
                    MetaTruncated = true;
                    return;
                }
                // ⚠️ Хэт өсөхөөс сэргийлнэ — 65535 удаа хөндсөн нь скрипт л байна.
                if (hits < 65535) hits++;
                if (depth < 65535) depth++;
                Meta[id] = new Touch { Op = opIdx, Sec = sec, Hits = hits, Depth = depth };
            }

            /// <summary>
            /// Ctrl+Z — нэг өөрчлөлтийг БУЦААНА.
            ///
            /// `true` буцаавал элемент суурийн байдалдаа эргэж ирсэн тул
            /// дуудагч түүнийг олонлогоос ХАСНА.
            ///
            /// ⚠️ META байхгүй элемент дээр ҮРГЭЛЖ `true`.  Тэр нь энэ
            /// шинэчлэлтээс өмнө бүртгэгдсэн (гүнгүй) мөр — undo дарсан
            /// хэрэглэгчийн санаа тодорхой тул хасах нь зөв.
            /// </summary>
            public bool UndoTouch(long id, long sec)
            {
                Touch t;
                if (!Meta.TryGetValue(id, out t)) return true;

                // Буцаалт ч гэсэн ХИЧЭЭСЭН ХҮЧИН ЧАРМАЙЛТ — «эргэлт»-д тоологдоно.
                if (t.Hits < 65535) t.Hits++;
                t.Depth--;
                t.Sec = sec;

                if (t.Depth <= 0) return true;
                Meta[id] = t;
                return false;
            }

            /// <summary>Тухайн элементийг хэдэн удаа хөндсөн бэ.  Мэдэгдэхгүй бол 0.</summary>
            public int HitsOf(long id)
            {
                Touch t;
                return Meta.TryGetValue(id, out t) ? t.Hits : 0;
            }

            /// <summary>Тухайн элементэд ямар үйлдэл хийгдсэн бэ.  Мэдэгдэхгүй бол null.</summary>
            public string OpOf(long id)
            {
                Touch t;
                if (!Meta.TryGetValue(id, out t)) return null;
                if (t.Op < 0 || t.Op >= Ops.Count) return null;
                return Ops[t.Op];
            }

            /// <summary>Хэзээ хөндөгдсөн бэ (UTC).  Мэдэгдэхгүй бол null.</summary>
            public DateTime? AtOf(long id)
            {
                Touch t;
                if (!Meta.TryGetValue(id, out t) || t.Sec <= 0) return null;
                return Epoch.AddSeconds(t.Sec);
            }
        }

        /// <summary>Одоогийн Unix секунд (UTC).</summary>
        private static long NowSec()
        {
            return (long)(DateTime.UtcNow - Epoch).TotalSeconds;
        }

        /// <summary>Дискний хэлбэр — олонлогийг массив болгож хадгална.</summary>
        private sealed class Persisted
        {
            public string baseline_at { get; set; }
            public int baseline_count { get; set; }
            public long[] added { get; set; }
            public long[] deleted { get; set; }
            public long[] modified { get; set; }
            public bool truncated { get; set; }

            /// <summary>Өвөрмөц үйлдлийн нэрс.  Хуучин файлд байхгүй — null.</summary>
            public string[] ops { get; set; }

            /// <summary>[id, opIndex, unixSec] гурвалууд — задгай талбараас 3 дахин богино.</summary>
            public long[][] meta { get; set; }

            public bool meta_truncated { get; set; }
        }

        private static readonly Dictionary<string, Change> States =
            new Dictionary<string, Change>(StringComparer.Ordinal);

        /// <summary>Диск рүү бичих шаардлагатай баримтууд.</summary>
        private static readonly HashSet<string> Dirty = new HashSet<string>(StringComparer.Ordinal);

        /// <summary>
        /// Sync / reload-latest явж байгаа баримтууд.
        /// ⚠️ Тэр үед ирэх өөрчлөлт нь БУСДЫН ажил — тоолохгүй.
        /// Гүйлгээний НЭРЭЭР шүүхгүй: тэр нь Revit-ийн хэлээс хамаардаг тул
        /// монгол/англи суулгацад өөр өөр ажиллана.  Оронд нь Revit-ийн
        /// ТУСГАЙ үйл явдлуудын хооронд туг тавина — хэлнээс хамаарахгүй.
        /// </summary>
        private static readonly HashSet<string> Suppressed = new HashSet<string>(StringComparer.Ordinal);

        private static readonly object Gate = new object();
        private static readonly JsonSerializerOptions Json =
            new JsonSerializerOptions { WriteIndented = false };

        private static bool _started;
        private static Timer _flushTimer;

        private static string Dir => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "RevitMcpAddin", "changes");

        /// <summary>
        /// `App.OnStartup`-аас НЭГ УДАА дуудна.
        /// ⚠️ Алдаа шидэхгүй — бүртгэл амжилтгүй болбол `RevitTools` нөөц зам
        /// руу шилжинэ, add-in бүхэлдээ унах ЁСГҮЙ.
        /// </summary>
        public static void Init(ControlledApplication app)
        {
            if (app == null || _started) return;
            try
            {
                app.DocumentChanged += OnDocumentChanged;
                app.DocumentClosing += OnDocumentClosing;
                ImpactObservationSinks.Register("change-tracker", c => HandleChange(c));

                // ⚠️ ФАЙЛ НЭЭХЭД СУУРИЙГ АВТОМАТААР ТАВИНА (2026-08-26).
                // Урьд нь суурь зөвхөн «Зураг холбох», «эхлэл тэмдэглэ» эсвэл
                // илгээлтийн дараа л тавигддаг байсан тул шинэ файл нээсэн
                // хэрэглэгч ажлаа хийчихээд «суурь алга» гэсэн хариу авдаг байв.
                app.DocumentOpened += OnDocumentOpened;
                app.DocumentCreated += OnDocumentCreated;

                // ⚠️ ХЭН ХИЙСЭН БЭ гэдгийг ялгах хос үйл явдлууд.  Эдгээрийн
                // хооронд ирэх `DocumentChanged` нь БУСДЫН ажил.
                app.DocumentSynchronizingWithCentral += OnSuppressStart;
                app.DocumentSynchronizedWithCentral += OnSuppressEnd;
                app.DocumentReloadingLatest += OnSuppressStart;
                app.DocumentReloadedLatest += OnSuppressEnd;

                // ⚠️ НЭГ УДААГИЙН, ӨӨРИЙГӨӨ ДАХИН ЗЭВСЭГЛЭДЭГ таймер.
                // Урьд нь ҮЕ ҮЕИЙН байсан: гурав дахь аргумент нь
                // `FlushIntervalMs` тул өмнөх callback дуусаагүй байхад ч
                // 3 секунд тутам ШИНЭ threadpool thread дээр ДАХИН асдаг.
                // Хоёр `FlushDirty` зэрэг ажиллавал ИЖИЛ `path + ".tmp"`-д
                // бичиж, хоёр дахь `File.Move` нь гадна талын `catch { }`-д
                // чимээгүй залгигдана — гэтэл `Dirty.Clear()` аль хэдийн
                // ТҮГЖЭЭ ДОТОР ажилласан тул тэр өөрчлөлтүүд ДАХИН
                // ДАРААЛАЛД ОРОХГҮЙ, диск рүү ХЭЗЭЭ Ч ХҮРЭХГҮЙ.
                // Өнөөдөр callback нь миллисекунд тул давхцал тохиолддоггүй;
                // ачаалал нэмэгдэхэд (Track 2) ЖИГД болно.
                _flushTimer = new Timer(_ => OnFlushTick(), null, FlushIntervalMs, Timeout.Infinite);
                _started = true;
            }
            catch
            {
                // Бүртгэгдсэнгүй — нөөц зам ажиллана.
            }
        }

        public static bool Started => _started;

        /// <summary>
        /// Захиалгуудыг САЛГАЖ, таймерыг сулласнаар алдагдлыг зогсооно.
        ///
        /// ⚠️ Салгахаас ӨМНӨ сүүлийн удаа бичнэ — эс бөгөөс сүүлийн 3
        /// секундын өөрчлөлт диск хүрэхгүй.
        ///
        /// ⚠️ ХЭЗЭЭ Ч алдаа шидэхгүй.  Унтраалт дээр шидэгдсэн алдаа нь
        /// Revit-ийн хаагдалтыг гацаана.
        ///
        /// ⚠️ `app` нь null ирж БОЛНО (`UIControlledApplication
        /// .ControlledApplication` нь OnShutdown-д хүчинтэй эсэх нь Revit-ийн
        /// хувилбар бүр дээр батлагдаагүй).  Тэр үед ч таймер нь БОЛЗОЛГҮЙ
        /// Dispose хийгдэнэ.
        /// </summary>
        public static void Shutdown(ControlledApplication app)
        {
            if (!_started) return;
            _started = false;
            try { FlushDirty(); } catch { }
            try { _flushTimer?.Dispose(); } catch { }
            _flushTimer = null;
            if (app == null) return;
            try { app.DocumentChanged -= OnDocumentChanged; } catch { }
            try { app.DocumentClosing -= OnDocumentClosing; } catch { }
            try { app.DocumentOpened  -= OnDocumentOpened;  } catch { }
            try { app.DocumentCreated -= OnDocumentCreated; } catch { }
            try { app.DocumentSynchronizingWithCentral -= OnSuppressStart; } catch { }
            try { app.DocumentSynchronizedWithCentral  -= OnSuppressEnd;   } catch { }
            try { app.DocumentReloadingLatest -= OnSuppressStart; } catch { }
            try { app.DocumentReloadedLatest  -= OnSuppressEnd;   } catch { }
        }

        /* ============================================================== */
        /*  ХЭМЖИЛТ (1C) — зурах явцын саад                                */
        /* ============================================================== */

        /// <summary>
        /// `OnDocumentChanged`-ийн ТҮҮВЭРЛЭЛТИЙН тоолуур.
        ///
        /// ⚠️ ТҮҮВЭРЛЭЛТ ЗААВАЛ.  Энэ handler нь ГҮЙЛГЭЭ БҮРТ ажилладаг тул
        /// тэнд `Stopwatch.StartNew()` хийх нь ӨӨРӨӨ нэмэлт ачаа — хэмжиж
        /// байгаа зүйлээ өөрчилнө.  64 гүйлгээ тутамд нэг удаа хэмжихэд
        /// хуваарилалт нь хангалттай нарийвчлалтай, өртөг нь үл мэдэгдэхүйц.
        /// </summary>
        private static int _dcCounter;
        private const int DcSampleEvery = 64;

        /* ============================================================== */
        /*  ТҮҮХИЙН ЦАГИРАГ (RawRing) — §55-R3                             */
        /* ============================================================== */

        /// <summary>
        /// ТҮҮХИЙН ЦАГИРГИЙН НЭГ БИЧЛЭГ — §55-R3-ын «preserve the ORIGINAL
        /// event history for learning while coalescing for real-time analysis».
        ///
        /// ⚠️ ЯАГААД ХЭРЭГТЭЙ ВЭ: дээрх `Change`-ийн олонлогийн алгебр нь
        /// ЗОРИУД АЛДАГДАЛТАЙ.  Үүсгээд устгасан нь ТЭГ болно, `Depth` 0
        /// болбол мөр БҮРЭН хасагдана (`UndoTouch`), `Note()` нь үйлдэл ба
        /// цагийг ДАРЖ бичнэ.  Тэр нь «суурьтай юу ялгаатай вэ» гэдэгт ЗӨВ,
        /// «хүн юу хийсэн бэ» гэдэгт БУРУУ.  Сургалт нь хоёрдахийг шаардана.
        ///
        /// ⚠️ ХУВААРИЛАЛТГҮЙ.  Урьдчилан хуваарилсан struct массив + нэг
        /// `long` буфер.  Халуун зам дээр `new` БАЙХГҮЙ — GC-ийн богино
        /// зогсолт ч гүйлгээ бүрд давтагдвал мэдрэгдэнэ.
        ///
        /// ⚠️ ТООЛУУР НЬ ҮНЭН ЗӨВ, ID НЬ ТҮҮВЭР.  `SamplePerTxn = 24` нь
        /// `bim.capture.elements_per_txn`-ийн анхдагчтай (0208, `learning.ts`)
        /// ЯГ ТААРНА — сервер түүнээс илүүг хүлээж авахгүй тул илүү
        /// цуглуулах нь дэмий ажил.
        /// </summary>
        internal struct RawEntry
        {
            /// <summary>Монотон, сесс дотор ХЭЗЭЭ Ч дахин эхлэхгүй.</summary>
            public long Seq;
            /// <summary>Unix секунд (UTC).</summary>
            public long Sec;
            /// <summary>`Change.Ops`-ийн индекс.</summary>
            public int OpIdx;
            /// <summary>⚠️ ҮНЭН ЗӨВ тоо — түүврийн урт БИШ.</summary>
            public int Added, Deleted, Modified;
            /// <summary>Түүврийн байрлал ба урт.  ⚠️ `TryDrain` нь `SampleOff`-ыг
            /// ДУУДАГЧИЙН буферийн индекс болгон ДАХИН БИЧНЭ.</summary>
            public int SampleOff, SampleLen;
            /// <summary>`UndoOperation.TransactionUndone`.</summary>
            public bool Undo;

            /// <summary>Баримтын түлхүүр = `RevitTools.DocUid(doc)`.
            /// ⚠️ ЗААВАЛ — үүнгүйгээр `ChangeSetCoalescer.Feed(…, docKey, …)`
            /// эмхэтгэгдэхгүй, «хоёр DocKey → хоёр ТУСДАА олонлог» дүрэм
            /// хангагдахгүй, ба envelope нь БАРИМТАА нэрлэж чадахгүй.
            /// ⚠️ ХУВААРИЛАЛТ БИШ: `key` нь handler-т аль хэдийн байгаа мөр,
            /// энд ЗӨВХӨН ишийн хуулбар хийгдэнэ.</summary>
            public string DocKey;

            /// <summary>Revit-ийн ӨӨРИЙНХ нь гүйлгээний нэр (`OpNameOf(e)`).
            /// ⚠️ ЯАГААД `OpIdx`-ЭЭР ЗОГСОХГҮЙ ВЭ: `OpIdx` нь `Change.Ops`-ийн
            /// индекс бөгөөд тэр жагсаалт `Gate`-ийн ДОР амьдардаг — шавхагч
            /// түүнийг тайлахын тулд түгжээг ДАХИН авах болно.  Мөрийн ишийг
            /// энд хуулснаар шавхагч `op_name`-ыг ТҮГЖЭЭГҮЙ бөглөнө.
            /// ⚠️ Мөн ХУВААРИЛАЛТ БИШ — ишийн хуулбар.</summary>
            public string OpName;
        }

        /// <summary>Цагирган багтаамж.  0228: `bim.compliance.raw_ring_max`.</summary>
        private const int RawRingMax = 4000;

        /// <summary>Гүйлгээ тутмын түүврийн дээд тоо.  0208-той НЭГ мөр.</summary>
        internal const int SamplePerTxn = 24;

        private static readonly RawEntry[] _ring = new RawEntry[RawRingMax];
        private static readonly long[] _sampleBuf = new long[RawRingMax * SamplePerTxn];

        /// <summary>Нийт бичсэн (цагирганаас ИХ байж болно).</summary>
        private static long _ringSeq;

        /// <summary>Хэтэрсэн тул алдагдсан — сервер талын `dropped_count`.</summary>
        private static long _ringDropped;

        /// <summary>Уншигч (`BimEmitter._pump`) хаана хүртэл шавхсан.
        /// ⚠️ ЗӨВХӨН `TryDrain` ба `AppendRaw` бичнэ, ЗӨВХӨН `Gate` дотор.</summary>
        private static long _ringDrainedSeq;

        /// <summary>Гүйлгээний түүврийн буфер дэх ОДООГИЙН бичилтийн урт.
        /// Гурван давталт дүүргэж, `AppendRaw` уншаад ТЭГЛЭНЭ.</summary>
        private static int _sampleN;

        private static readonly ManualResetEventSlim _wake = new ManualResetEventSlim(false);

        /// <summary>Шавхагчийн сэрүүлэг.  ⚠️ `Set()` нь `OnDocumentChanged`-ийн
        /// `lock (Gate)` дотроос дуудагдана — хуваарилалтгүй, блоклохгүй.</summary>
        internal static ManualResetEventSlim Wake { get { return _wake; } }

        internal static long RingSeq { get { return Interlocked.Read(ref _ringSeq); } }
        internal static long RingDropped { get { return Interlocked.Read(ref _ringDropped); } }

        /// <summary>
        /// ⛔ ХОРИГЛОЛТ №7-ЫН ДИБАГ ХАМГААЛАЛТ.  `RevitToolBus` нь энэ
        /// түгжээг барьсан thread-ээс дуудагдвал `OnDocumentChanged` нь
        /// Revit-ийн үндсэн thread дээр хэрэгслийн БҮТЭН хугацаагаар гацна.
        /// ⚠️ `DEBUG` нь энэ төслийн АЛЬ Ч Configuration дээр
        /// тодорхойлогддоггүй (`Percentiles.cs`-ийн хэмжилт) тул энэ нь
        /// одоогоор ГҮЙЦЭТГЭГДЭХГҮЙ — гэрээг КОДООР бичих зорилготой.
        /// </summary>
        internal static bool GateHeldByCurrentThread
        {
            get { return Monitor.IsEntered(Gate); }
        }

        /// <summary>
        /// ⚠️ ЗӨВХӨН `Gate` барьсан үед дуудна.  ХУВААРИЛАЛТГҮЙ.
        /// `seq` / `slot` нь ГУРВАН ДАВТАЛТААС ӨМНӨ тооцогдсон утгууд —
        /// дараа нь тооцвол давталтууд ӨМНӨХ гүйлгээний нүдэнд бичих ба
        /// бичлэг бүр өөр гүйлгээний id-г заана (чимээгүй өгөгдөл эвдрэл).
        /// </summary>
        private static void AppendRaw(long seq, int slot, string docKey, string opName,
                                      int opIdx, long sec, bool undo,
                                      int addedN, int deletedN, int modifiedN)
        {
            if (seq - _ringDrainedSeq >= RawRingMax)
            {
                // Цагираг дүүрч, уншигч хоцорсон — ХАМГИЙН ХУУЧНЫГ дарж бичнэ.
                // ⚠️ ЧИМЭЭГҮЙ БИШ: `dropped_count`-д хүрч, «юу ч болоогүй» ба
                //    «алдсан» хоёр ЯЛГАГДАНА.
                _ringDropped++;
                // Шавхагдаагүй ХАМГИЙН ХУУЧИН бичлэг үнэндээ алга болсон тул
                // курсорыг урагшлуулна — эс бөгөөс `TryDrain` дарагдсан нүдийг
                // ШИНЭ гэж уншиж, нэг гүйлгээ ХОЁР УДАА тоологдоно.
                _ringDrainedSeq = seq - RawRingMax + 1;
            }

            _ring[slot].Seq = seq;
            _ring[slot].Sec = sec;
            _ring[slot].DocKey = docKey;    // ишийн хуулбар, хуваарилалт БИШ
            _ring[slot].OpName = opName;    // ишийн хуулбар, хуваарилалт БИШ
            _ring[slot].OpIdx = opIdx;
            _ring[slot].Added = addedN;
            _ring[slot].Deleted = deletedN;
            _ring[slot].Modified = modifiedN;
            _ring[slot].Undo = undo;
            _ring[slot].SampleOff = slot * SamplePerTxn;
            _ring[slot].SampleLen = _sampleN;   // гурван давталт дүүргэсэн
            _ringSeq = seq + 1;
            _wake.Set();
        }

        /// <summary>
        /// Цагирагаас ШИНЭ бичлэгүүдийг хуулж авна.  Буцах утга: хуулсан тоо.
        ///
        /// ⚠️ ЦОРЫН ГАНЦ ДУУДАГЧ: `BimEmitter._pump`.  Хоёр дахь дуудагч
        /// гарвал хоёул бичлэгүүдийг бие биенээсээ ХУЛГАЙЛЖ, гүйлгээний тал
        /// нь сургалтын дэвтэрт, нөгөө тал нь дүрмийн үнэлгээнд ЧИМЭЭГҮЙ алга
        /// болно — `_ringDrainedSeq`-ийг ЭНЭ метод урагшлуулдаг.
        ///
        /// ⚠️ `TryEnter` — ӨРСӨЛДӨӨН БОЛ 0 БУЦААНА, ХҮЛЭЭХГҮЙ.  Энэ түгжээг
        /// `OnDocumentChanged` нь ГҮЙЛГЭЭ БҮРТ Revit-ийн үндсэн thread дээр
        /// авдаг; хүлээх нь хэрэглэгчийн зурлагыг гацаана.
        ///
        /// ⚠️ ТҮГЖЭЭГ АВААД ШУУД ТАВИНА — bus дуудлага, диск бичилт, `await`
        /// ХЭЗЭЭ Ч дотор нь ОРОХГҮЙ (Хориглолт №7).
        ///
        /// ⚠️ ХУУЛБАР нь ХЯЗГААРТАЙ: `dst.Length` бичлэг ба
        /// `dst.Length * SamplePerTxn` long.  Суурийн хуулбарын 500 000 id-тай
        /// гүнзгий замтай (`TryGet`) ЯМАР Ч ХАМААРАЛГҮЙ.
        /// </summary>
        internal static int TryDrain(RawEntry[] dst, long[] sampleDst,
                                     out long fromSeq, out long droppedSinceLast)
        {
            fromSeq = 0;
            droppedSinceLast = 0;
            if (dst == null || dst.Length == 0) return 0;
            if (!Monitor.TryEnter(Gate)) return 0;
            try
            {
                fromSeq = _ringDrainedSeq;
                long avail = _ringSeq - _ringDrainedSeq;
                if (avail < 0) avail = 0;
                int n = (int)Math.Min(avail, dst.Length);
                for (int i = 0; i < n; i++)
                {
                    int slot = (int)((_ringDrainedSeq + i) % RawRingMax);
                    dst[i] = _ring[slot];
                    int len = _ring[slot].SampleLen;
                    if (sampleDst != null && len > 0 &&
                        (i + 1) * SamplePerTxn <= sampleDst.Length)
                    {
                        Array.Copy(_sampleBuf, _ring[slot].SampleOff,
                                   sampleDst, i * SamplePerTxn, len);
                    }
                    // Хуулсан бичлэгийн түүвэр нь ОДОО `sampleDst`-д — уншигч
                    // индексийг ДАХИН тооцно, `SampleOff` нь дуудагчийнх.
                    dst[i].SampleOff = i * SamplePerTxn;
                }
                _ringDrainedSeq += n;
                droppedSinceLast = Interlocked.Exchange(ref _ringDropped, 0);
                if (_ringDrainedSeq >= _ringSeq) _wake.Reset();
                return n;
            }
            finally { Monitor.Exit(Gate); }
        }

        /* ============================================================== */
        /*  БАРИМТЫН ТОГТМОЛ БАРИМТУУД — `DocumentOpened` дээр НЭГ УДАА     */
        /* ============================================================== */

        /// <summary>
        /// Баримтын ТОГТМОЛ баримтууд — ЗӨВХӨН мөр ба bool, Revit-ийн төрөл
        /// БАЙХГҮЙ.  `AutoBaseline` (`DocumentOpened` / `DocumentCreated`)
        /// бөглөнө; `BimEmitter._pump` УНШИНА.
        ///
        /// ⚠️ `DocumentOpened` нь Revit API уншихад ХУУЛЬ ЁСНЫ газар —
        /// `AutoBaseline` тэнд аль хэдийн бүтэн баримтын элемент тоологч
        /// ажиллуулдаг.  `DocumentChanged` дээр ЭНЭ КОД ХЭЗЭЭ Ч ажиллахгүй
        /// (Хориглолт №6: тэнд баримт ЗӨВХӨН УНШИХ, шинэ API дуудлагагүй).
        ///
        /// ⚠️ ЗАМ ХАДГАЛАХГҮЙ.  `CentralPathHash` нь ЗӨВХӨН sha256
        /// (0202: «ЗАМ, МАШИНЫ НЭР ХАДГАЛАХГҮЙ»).
        /// </summary>
        internal sealed class DocFacts
        {
            public string DocUid, Title, CentralPathHash, Worksharing;
            public bool IsLink;
        }

        private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, DocFacts>
            _docFacts =
                new System.Collections.Concurrent.ConcurrentDictionary<string, DocFacts>(
                    StringComparer.Ordinal);

        /// <summary>Мэдэгдэхгүй бол null — дуудагч түүнийг НӨХӨЖ ТААМАГЛАХГҮЙ.</summary>
        internal static DocFacts FactsOf(string key)
        {
            DocFacts f;
            if (string.IsNullOrEmpty(key)) return null;
            return _docFacts.TryGetValue(key, out f) ? f : null;
        }

        /// <summary>⚠️ Revit-ийн ҮНДСЭН thread дээр, `DocumentOpened`-ийн
        /// stack дотор л дуудна.  ХЭЗЭЭ Ч алдаа шидэхгүй.</summary>
        private static void RecordDocFacts(Document doc, string key)
        {
            try
            {
                if (doc == null || string.IsNullOrEmpty(key)) return;
                if (_docFacts.ContainsKey(key)) return;

                string central = null;
                string worksharing = "none";
                try
                {
                    if (doc.IsWorkshared)
                    {
                        // ⚠️ ЗАМЫГ ЗӨВХӨН ХЭШЛЭХ ЗОРИУЛАЛТААР УНШИНА — хадгалахгүй.
                        ModelPath mp = doc.GetWorksharingCentralModelPath();
                        string p = mp == null
                            ? null
                            : ModelPathUtils.ConvertModelPathToUserVisiblePath(mp);
                        central = Sha256Hex(p);
                        worksharing =
                            !string.IsNullOrEmpty(p) &&
                            string.Equals(p, doc.PathName, StringComparison.OrdinalIgnoreCase)
                                ? "central"
                                : "local";
                    }
                }
                catch { /* worksharing уншигдсангүй — «none» хэвээр */ }

                _docFacts[key] = new DocFacts
                {
                    DocUid = key,
                    Title = SafeTitle(doc),
                    IsLink = doc.IsLinked,
                    CentralPathHash = central,
                    Worksharing = worksharing,
                };

                // Хязгаар: нэг сесст 64 баримтаас олон нээх нь эмгэг тохиолдол.
                if (_docFacts.Count > 64) _docFacts.Clear();
            }
            catch { }
        }

        private static string SafeTitle(Document doc)
        {
            try
            {
                string t = doc.Title;
                if (string.IsNullOrEmpty(t)) return "";
                return t.Length > 200 ? t.Substring(0, 200) : t;
            }
            catch { return ""; }
        }

        /// <summary>⚠️ ЗАМ БИШ, ЗӨВХӨН ХЭШ.  64 hex — сервер `isSha256`-аар
        /// шалгана, өөр урттай мөрийг NULL болгож хаяна.</summary>
        internal static string Sha256Hex(string s)
        {
            if (string.IsNullOrEmpty(s)) return null;
            try
            {
                using (var sha = System.Security.Cryptography.SHA256.Create())
                {
                    byte[] h = sha.ComputeHash(Encoding.UTF8.GetBytes(s));
                    var sb = new StringBuilder(64);
                    for (int i = 0; i < h.Length; i++) sb.Append(h[i].ToString("x2"));
                    return sb.ToString();
                }
            }
            catch { return null; }
        }

        /// <summary>Суурь тавина: хуримтлалыг цэвэрлээд цагийг тэмдэглэнэ.  O(1).</summary>
        public static void Reset(Document doc, int elementCount)
        {
            string key = KeyOf(doc);
            if (key == null) return;
            lock (Gate)
            {
                States[key] = new Change
                {
                    BaselineAtUtc = DateTime.UtcNow,
                    BaselineElementCount = elementCount,
                };
                Dirty.Add(key);
            }
            // Суурь тавих нь ХОВОР бөгөөд хэрэглэгчийн хүлээж буй үйлдэл тул
            // шууд бичнэ — жигдрүүлэх шаардлагагүй.
            FlushDirty();
        }

        /// <summary>
        /// Суурь авснаас хойшхи өөрчлөлт.  Суурь тавиагүй бол false.
        /// Санах ойд байхгүй бол ДИСКНЭЭС уншина (Revit дахин эхэлсэн байж болно).
        /// </summary>
        public static bool TryGet(Document doc, out Change copy)
        {
            return TryGetByKey(KeyOf(doc), out copy);
        }

        /// <summary>
        /// Түлхүүрээр шууд уншина — `Document` ШААРДАХГҮЙ.
        ///
        /// ⚠️ ЯАГААД ХЭРЭГТЭЙ ВЭ: сануулгын хөдөлгүүр (`Nudges`) нь WPF-ийн
        /// таймераас, өөрөөр хэлбэл Revit-ийн ҮНДСЭН THREAD-ЭЭС ГАДНА
        /// ажиллана.  Тэндээс `Document`-д хүрэх нь хориотой.  Гэвч самбар
        /// нь `RevitTools.DocUid(doc)`-ийг аль хэдийн `AssistantLog.DocUid`-д
        /// хадгалсан байдаг тул түлхүүр гартаа бий — толь бичгийн уншилт л
        /// хийхэд хангалттай.
        ///
        /// Ингэснээр сануулгын хөдөлгүүр Revit-ийн API-д НЭГ Ч удаа хүрэхгүй:
        /// гацах эрсдэл тэг, ExternalEvent хэрэггүй.
        /// </summary>
        public static bool TryGetByKey(string key, out Change copy)
        {
            copy = null;
            if (string.IsNullOrEmpty(key)) return false;

            lock (Gate)
            {
                if (!States.TryGetValue(key, out Change c))
                {
                    c = LoadFromDisk(key);
                    if (c == null) return false;
                    States[key] = c;
                }

                copy = new Change
                {
                    BaselineAtUtc = c.BaselineAtUtc,
                    BaselineElementCount = c.BaselineElementCount,
                    Added = new HashSet<long>(c.Added),
                    Deleted = new HashSet<long>(c.Deleted),
                    Modified = new HashSet<long>(c.Modified),
                    Truncated = c.Truncated,
                    // ⚠️ META-г ч ГҮНЗГИЙ хуулна.  Гүехэн хуулбар нь уншигч
                    // `Dictionary`-г тоолж байх зуур `DocumentChanged` түүн рүү
                    // бичих боломжийг үлдээж, `InvalidOperationException` шиднэ.
                    Ops = new List<string>(c.Ops),
                    Meta = new Dictionary<long, Touch>(c.Meta),
                    MetaTruncated = c.MetaTruncated,
                };
                return true;
            }
        }

        /* ============================================================== */
        /*  Диск                                                          */
        /* ============================================================== */

        private static string PathFor(string key)
        {
            var sb = new StringBuilder(key.Length);
            foreach (char ch in key)
                sb.Append(char.IsLetterOrDigit(ch) || ch == '-' || ch == '_' ? ch : '_');
            string safe = sb.ToString();
            if (safe.Length > 120) safe = safe.Substring(0, 120);
            return Path.Combine(Dir, safe + ".json");
        }

        private static Change LoadFromDisk(string key)
        {
            try
            {
                string path = PathFor(key);
                if (!File.Exists(path)) return null;

                Persisted p = JsonSerializer.Deserialize<Persisted>(
                    File.ReadAllText(path, Encoding.UTF8));
                if (p == null) return null;

                DateTime at;
                if (!DateTime.TryParse(p.baseline_at, CultureInfo.InvariantCulture,
                        DateTimeStyles.RoundtripKind, out at)) return null;

                return new Change
                {
                    BaselineAtUtc = at,
                    BaselineElementCount = p.baseline_count,
                    Added = new HashSet<long>(p.added ?? new long[0]),
                    Deleted = new HashSet<long>(p.deleted ?? new long[0]),
                    Modified = new HashSet<long>(p.modified ?? new long[0]),
                    Truncated = p.truncated,
                    // ⚠️ Хуучин файлд эдгээр талбар БАЙХГҮЙ.  null нь алдаа биш —
                    // тэр өдрийн ажил тоогоороо хэвээр, зөвхөн тайлбаргүй гарна.
                    Ops = new List<string>(p.ops ?? new string[0]),
                    MetaTruncated = p.meta_truncated,
                    Meta = MetaFromArray(p.meta),
                };
            }
            catch
            {
                return null;   // эвдэрсэн файл — суурьгүй гэж үзнэ
            }
        }

        private static Dictionary<long, Touch> MetaFromArray(long[][] rows)
        {
            var d = new Dictionary<long, Touch>();
            if (rows == null) return d;
            foreach (long[] r in rows)
            {
                if (r == null || r.Length < 3) continue;
                // ⚠️ Хуучин файлууд богино байна: 3 талбар (hits ч, depth ч
                // байхгүй) эсвэл 4 (depth байхгүй).  Аль ч тохиолдолд «нэг
                // удаа өөрчлөгдсөн» гэж үзнэ — undo дарвал 0 болж хасагдана.
                d[r[0]] = new Touch
                {
                    Op = (int)r[1],
                    Sec = r[2],
                    Hits = r.Length >= 4 ? (int)r[3] : 1,
                    Depth = r.Length >= 5 ? (int)r[4] : 1,
                };
            }
            return d;
        }

        /// <summary>
        /// ⚠️ Арын thread дээр, ЖИГДРҮҮЛЖ дуудагдана.  Revit-ийн API-д
        /// ОГТ ХҮРЭХГҮЙ — зөвхөн `long` тоонуудыг цувуулна.
        /// </summary>
        /// <summary>
        /// ⚠️ БИЧИЛТИЙН ТҮГЖЭЭ — `Gate`-ЭЭС ТУСДАА.  Хоёр `FlushDirtyCore`
        /// зэрэг ажиллавал ИЖИЛ `path + "." + pid + ".tmp"`-д бичиж, хоёр
        /// дахь `File.Move` нь гадна талын `catch { }`-д чимээгүй залгигдана
        /// — гэтэл `Dirty.Clear()` аль хэдийн ажилласан тул тэр
        /// өөрчлөлтүүд диск рүү ХЭЗЭЭ Ч ХҮРЭХГҮЙ.
        ///
        /// ⚠️ ТҮГЖЭЭНИЙ ДАРААЛАЛ: ҮРГЭЛЖ `FlushGate` → `Gate`.  Урвуу
        /// дараалал ХЭЗЭЭ Ч ҮГҮЙ: `FlushDirty`-г дууддаг гурван газар
        /// (`Reset`, `OnDocumentClosing`, `Shutdown`) бүгд `Gate`-ийг БАРИАГҮЙ
        /// байхдаа дууддаг.  Тиймээс мухардал үүсэхгүй.
        /// </summary>
        private static readonly object FlushGate = new object();

        /// <summary>⚠️ ХОЁР REVIT НЭГ `%APPDATA%`-Г ХУВААЛЦАНА (2024 + 2027
        /// зэрэг нээлттэй нь хувилбар шилжилтийн үед ЭНГИЙН).  `PathFor` нь
        /// детерминист тул түр файлын нэр давхцана — pid-ээр ялгана.</summary>
        private static readonly string _pid =
            System.Diagnostics.Process.GetCurrentProcess().Id
                  .ToString(CultureInfo.InvariantCulture);

        /// <summary>
        /// ⚠️ ШУУД ДУУДАГЧИД (`Reset`, `OnDocumentClosing`, `Shutdown`) —
        /// БЛОКЛОНО, АЛГАСАХГҮЙ.
        ///
        /// Урьд нь энд `Interlocked.CompareExchange(ref _flushBusy, 1, 0)`
        /// байсан бөгөөд завгүй үед ЧИМЭЭГҮЙ буцдаг байв.  Гэтэл
        /// `OnDocumentClosing` нь `FlushDirty()`-ийн ДАРААХ мөрөнд
        /// `States.Remove(key)` хийдэг тул таймерын callback яг тэр
        /// агшинд ажиллаж байвал хаалтын бичилт ОГТ хийгдэлгүй,
        /// санах ойн төлөв нь устаж, ӨДРИЙН СУУРЬ АЛГА БОЛНО.
        /// `Shutdown` нь дараагийн мөрөнд таймерыг `Dispose` хийдэг тул
        /// хойш нөхөх боломж ч үлдэхгүй.
        ///
        /// Одоо ЗӨВХӨН таймер алгасана (`OnFlushTick`); шууд дуудагч нь
        /// түгжээг ХҮЛЭЭГЭЭД өөрөө бичнэ.  Зөвхөн «дуустал хүлээх» нь
        /// ХАНГАЛТГҮЙ: таймер `Dirty`-г аль хэдийн хуулж аваад диск рүү
        /// бичиж байх зуур ирсэн өөрчлөлт тэр хуулбарт ОРООГҮЙ тул
        /// хүлээгээд буцвал бас алдагдана — иймд түгжээ авсны ДАРАА
        /// БОДИТ бичилт хийнэ.
        ///
        /// ⚠️ ДИСК БИЧИЛТ `Gate`-ЭЭС ГАДНА хэвээр: `FlushGate` нь
        /// өөр түгжээ бөгөөд `OnDocumentChanged` түүнд хэзээ ч хүрэхгүй.
        /// </summary>
        private static void FlushDirty()
        {
            lock (FlushGate) { FlushDirtyCore(); }
        }

        /// <summary>
        /// Таймерын зам.  ⚠️ ЭНЭ Л ЦОРЫН ГАНЦ алгасаж БОЛОХ зам:
        /// өөр нэгэн аль хэдийн бичиж байгаа тул өгөгдөл алдагдахгүй,
        /// үлдсэн нь 3 секундын дараах цохилтоор диск хүрнэ.
        /// Таймер ХЭЗЭЭ Ч блоклохгүй — threadpool thread барихгүй.
        ///
        /// ⚠️ ДАХИН ЗЭВСЭГЛЭЛТ нь `finally`-д, БОЛЗОЛГҮЙ.  Урьд нь эрт
        /// `return` хийхэд НЭГ УДААГИЙН таймер дахин зэвсэглэгдэхгүй
        /// байсан тул НЭГ л удаа давхцвал жигдрүүлэлт БҮРМӨСӨН
        /// зогсох байв.
        /// </summary>
        private static void OnFlushTick()
        {
            try
            {
                if (Monitor.TryEnter(FlushGate))
                {
                    try { FlushDirtyCore(); }
                    finally { Monitor.Exit(FlushGate); }
                }
            }
            catch { }
            finally
            {
                // ⚠️ `Dispose` хийгдсэн бол `ObjectDisposedException`
                //    шидэгдэнэ — унтраалт явж байна.
                try { _flushTimer?.Change(FlushIntervalMs, Timeout.Infinite); }
                catch { }
            }
        }

        private static void FlushDirtyCore()
        {
            List<KeyValuePair<string, Persisted>> work = null;
            // ⚠️ ХЭМЖИЛТ (1C): ЗӨВХӨН ТҮГЖЭЭ БАРИХ хэсэг.  Энэ бол add-in-ы
            // ЦОРЫН ГАНЦ бодит блоклолт — тэр хугацаанд `OnDocumentChanged`
            // нь Revit-ийн ҮНДСЭН thread дээр `lock (Gate)`-д хүлээнэ.
            // Олонлогийг массив болгож хуулах явц нь 500,000 id хүртэл өсч
            // болно (`MaxTrackedIds`).
            //
            // ⚠️ ТҮҮВЭРЛЭХГҮЙ — 3 секунд тутамд л ажилладаг тул бүгдийг хэмжинэ.
            var lockSw = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                lock (Gate)
                {
                    if (Dirty.Count == 0)
                    {
                        lockSw.Stop();
                        return;
                    }
                    work = new List<KeyValuePair<string, Persisted>>(Dirty.Count);
                    foreach (string key in Dirty)
                    {
                        if (!States.TryGetValue(key, out Change c)) continue;
                        var p = new Persisted
                        {
                            baseline_at = c.BaselineAtUtc.ToString("o", CultureInfo.InvariantCulture),
                            baseline_count = c.BaselineElementCount,
                            added = ToArray(c.Added),
                            deleted = ToArray(c.Deleted),
                            modified = ToArray(c.Modified),
                            truncated = c.Truncated,
                            ops = c.Ops.ToArray(),
                            meta = MetaToArray(c.Meta),
                            meta_truncated = c.MetaTruncated,
                        };
                        work.Add(new KeyValuePair<string, Persisted>(key, p));
                    }
                    Dirty.Clear();
                }
                lockSw.Stop();
                try
                {
                    Metrics.FlushLock.Add(lockSw.Elapsed.TotalMilliseconds);
                }
                catch { }

                // ⚠️ ДИСК БИЧИЛТ ТҮГЖЭЭНЭЭС ГАДНА.  Дотогш оруулбал
                // `OnDocumentChanged` нь Revit-ийн үндсэн thread дээр
                // дискний I/O хүлээнэ.
                Directory.CreateDirectory(Dir);
                foreach (KeyValuePair<string, Persisted> kv in work)
                {
                    // ⚠️ Түр файлаар дамжуулж СОЛИНО.  Шууд бичих үед Revit
                    // унавал хагас бичигдсэн JSON үлдэж, өдрийн бүх ажил
                    // уншигдахгүй болно.
                    string path = PathFor(kv.Key);
                    // ⚠️ pid — `_pid` талбарын тайлбарыг үз (хоёр Revit,
                    //    нэг `%APPDATA%`).
                    string tmp = path + "." + _pid + ".tmp";
                    File.WriteAllText(tmp, JsonSerializer.Serialize(kv.Value, Json),
                                      new UTF8Encoding(false));
                    if (File.Exists(path)) File.Delete(path);
                    File.Move(tmp, path);
                }
            }
            catch
            {
                // Диск дүүрсэн / эрх байхгүй — мөрдөлт санах ойд үргэлжилнэ.
            }
        }

        private static long[] ToArray(HashSet<long> set)
        {
            var a = new long[set.Count];
            set.CopyTo(a);
            return a;
        }

        private static long[][] MetaToArray(Dictionary<long, Touch> meta)
        {
            var a = new long[meta.Count][];
            int i = 0;
            foreach (KeyValuePair<long, Touch> kv in meta)
                a[i++] = new[] { kv.Key, kv.Value.Op, kv.Value.Sec, kv.Value.Hits, kv.Value.Depth };
            return a;
        }

        /* ============================================================== */
        /*  Үйл явдлууд                                                    */
        /* ============================================================== */

        private static string KeyOf(Document doc)
        {
            try { return doc == null ? null : RevitTools.DocUid(doc); }
            catch { return null; }
        }

        private static void OnSuppressStart(object sender, EventArgs e)
        {
            try
            {
                string key = KeyOf(DocOf(e));
                if (key == null) return;
                lock (Gate) { Suppressed.Add(key); }
            }
            catch { }
        }

        private static void OnSuppressEnd(object sender, EventArgs e)
        {
            try
            {
                string key = KeyOf(DocOf(e));
                if (key == null) return;
                lock (Gate) { Suppressed.Remove(key); }
            }
            catch { }
        }

        /// <summary>Дөрвөн өөр EventArgs төрлөөс баримтыг гаргана.</summary>
        private static Document DocOf(EventArgs e)
        {
            if (e is DocumentSynchronizingWithCentralEventArgs a) return a.Document;
            if (e is DocumentSynchronizedWithCentralEventArgs b) return b.Document;
            if (e is DocumentReloadingLatestEventArgs c) return c.Document;
            if (e is DocumentReloadedLatestEventArgs d) return d.Document;
            return null;
        }

        private static void OnDocumentOpened(object sender, DocumentOpenedEventArgs e)
        {
            AutoBaseline(e == null ? null : e.Document);
        }

        private static void OnDocumentCreated(object sender, DocumentCreatedEventArgs e)
        {
            AutoBaseline(e == null ? null : e.Document);
        }

        /// <summary>
        /// Файл нээгдэхэд суурь БАЙХГҮЙ бол тавина.
        ///
        /// ⚠️ БАЙГАА СУУРИЙГ ДАРЖ БИЧИХГҮЙ.  Хэрэглэгч өчигдөр ажиллаад
        /// илгээгээгүй байж болно — нээх бүрд тэглэвэл тэр ажил нь чимээгүй
        /// алга болно.  Илгээх бүрд суурь өөрөө шинэчлэгддэг тул «сүүлийн
        /// тайлангаас хойш» гэсэн утга хадгалагдана.
        ///
        /// ⚠️ Линк ба Family баримтыг алгасна: линкийн өөрчлөлт нь БУСДЫН
        /// ажил, Family нь тусдаа баримт.
        /// </summary>
        private static void AutoBaseline(Document doc)
        {
            try
            {
                if (doc == null) return;
                if (doc.IsFamilyDocument || doc.IsLinked) return;

                string key = KeyOf(doc);
                if (key == null) return;

                // ⚠️ БАРИМТЫН ТОГТМОЛУУДЫГ ЭНД, ҮНДСЭН THREAD ДЭЭР УНШИНА.
                //    Шавхагч thread нь Revit-д ХЭЗЭЭ Ч хүрэхгүй тул
                //    `doc_title` / `is_link` / `central_path_hash` /
                //    `worksharing` -ыг өөр газраас авах арга БАЙХГҮЙ.
                //    ⚠️ Суурь аль хэдийн байгаа ч (доорх эрт буцалт) ЭНЭ мөр
                //    ЗААВАЛ ажиллана — эс бөгөөс дахин нээсэн баримтын
                //    сессийн толгой хоосон гарна.
                RecordDocFacts(doc, key);

                lock (Gate)
                {
                    if (States.ContainsKey(key)) return;

                    // Дискэн дээр байвал сэргээгээд зогсоно — тэр нь өмнөх
                    // сессийн үргэлжлэл.
                    Change onDisk = LoadFromDisk(key);
                    if (onDisk != null)
                    {
                        States[key] = onDisk;
                        return;
                    }
                }

                // ⚠️ Түгжээнээс ГАДНА — `Reset` өөрөө түгжээ авдаг.
                Reset(doc, RevitTools.ElementCount(doc));
            }
            catch
            {
                // Суурь тавьж чадсангүй — «суурь алга» гэсэн хэвийн зам ажиллана.
            }
        }

        private static void OnDocumentClosing(object sender, DocumentClosingEventArgs e)
        {
            try
            {
                string key = KeyOf(e?.Document);
                if (key == null) return;
                // ⚠️ Санах ойгоос гаргана, ГЭХДЭЭ ДИСКНЭЭС УСТГАХГҮЙ —
                // хэрэглэгч файлаа хаагаад дахин нээхэд өдрийн ажил нь
                // хэвээр байх ёстой.
                FlushDirty();
                lock (Gate)
                {
                    States.Remove(key);
                    Suppressed.Remove(key);
                }
            }
            catch { }
        }

        /// <summary>
        /// Revit-ийн ӨӨРИЙНХ нь үйлдлийн нэр.
        ///
        /// ⚠️ ЭНЭ НЬ ҮНЭГҮЙ.  `GetTransactionNames()` нь үйл явдлын өгөгдөлд
        /// аль хэдийн байгаа мөрүүд — Revit тэднийг undo стекэд зориулж хадгалсан
        /// байдаг тул бид ямар ч тооцоолол хийхгүй.  Энэ нь «яг юу хийсэн бэ»
        /// гэсэн асуултад хариулах ЦОРЫН ГАНЦ хямд зам: элементийн параметрийн
        /// өмнөх утгыг мэдэхийн тулд суурь авахдаа БҮГДИЙГ нь сканнердах ёстой
        /// болно (яг тэр нь энэ ангийг бичих шалтгаан болсон 120 секундын гацаа).
        ///
        /// Нэр нь Revit-ийн ХЭЛНЭЭС хамаарна («Move» / «Переместить»).  Тиймээс
        /// орчуулгыг `ChangeReport.OpLabel` дээр хийж, танихгүй нэрийг ЯГ ТЭР
        /// хэвээр нь харуулна — буруу таамаглахаас дээр.
        ///
        /// Undo/redo-г тусад нь тэмдэглэнэ: тэдгээрийн гүйлгээний нэр нь ҮНДСЭН
        /// үйлдлийнх байдаг тул ялгахгүй бол «Зөөсөн» гэж худал харагдана.
        /// </summary>
        private static string OpNameOf<T>(T e) where T : IDocChange
        {
            try
            {
                string name = null;
                IList<string> names = e.GetTransactionNames();
                if (names != null && names.Count > 0)
                {
                    // Сүүлийнх нь хэрэглэгчийн ХАМГИЙН ойрын үйлдэл.
                    name = names[names.Count - 1];
                }
                if (string.IsNullOrWhiteSpace(name)) name = "?";

                switch (e.Operation)
                {
                    case UndoOperation.TransactionUndone: return "undo:" + name;
                    case UndoOperation.TransactionRedone: return "redo:" + name;
                    default: return name;
                }
            }
            catch
            {
                return "?";
            }
        }

        /// <summary>
        /// ⚠️ ЭНЭ НЬ REVIT-ИЙН ҮНДСЭН THREAD дээр, ГҮЙЛГЭЭ БҮРИЙН ДАРАА
        /// дуудагдана.  Энд хийсэн ажил бүр хэрэглэгчийн ЗУРЖ БАЙГАА үйлдэл
        /// бүрийг удаашруулна — зөвхөн олонлогийн үйлдэл, диск ХӨНДӨХГҮЙ.
        ///
        /// ⛔ ИНФЕРЕНС ЭНД ХЭЗЭЭ Ч БАЙХГҮЙ.  Энэ handler нь ГҮЙЛГЭЭ БҮРИЙН
        /// дараа дуудагдана — хэрэглэгч хана зурах бүрт.  Одоо энд диск ч
        /// хөндөхгүй; сүлжээ хөндөх нь тэрнээс ХЭДЭН ЗУУ дахин дор.  LLM-ийн
        /// дуудлагыг `AgentChat.RunAsync`-ийн давталт дотор (арын thread) хий.
        /// Зөвшөөрөгдсөн цорын ганц суулгац нь `AssistantPane`-ийн
        /// `DecidedBy.Fallback` салаа.
        /// </summary>
        private static void OnDocumentChanged(object sender, DocumentChangedEventArgs e)
        {
            // «Өөрчлөхөөс өмнө шалгах»-ын sandbox (түр транзакц + буцаалт) — хэрэглэгчийн бодит өөрчлөлт БИШ; Apply-ийн дотоод commit хойшлогдсон
            // (баталгаажсаны дараа `ImpactObservationSinks`-ээр нэг удаа дахин тоглогдоно) — SimulationScope.cs, DocChange.cs.
            if (ImpactSimulationScope.Suppressed) return;
            HandleChange(new LiveDocChange(e));
        }

        /// <summary>
        /// Амьд үйл явдал БА хойшлуулсан-дахин тоглуулсан хуулбар хоёрт ИЖИЛ логик.  `T` нь struct (`LiveDocChange`) үед JIT тусгайлан эмхэтгэнэ —
        /// халуун замд хуваарилалт ГАРАХГҮЙ.
        /// </summary>
        private static void HandleChange<T>(T e) where T : IDocChange
        {
            // ⚠️ ХЭМЖИЛТ (1C) — ТҮҮВЭРЛЭСЭН.  `Stopwatch` өөрөө үнэтэй тул
            // 64 гүйлгээ тутамд НЭГ УДАА л эхлүүлнэ.  `Interlocked` — энэ
            // handler нь дан ганц Revit-ийн үндсэн thread дээр ажилладаг
            // боловч тоолуурын эргэлтийг тодорхой болгоно.
            System.Diagnostics.Stopwatch dcSw = null;
            if (System.Threading.Interlocked.Increment(ref _dcCounter) % DcSampleEvery == 0)
                dcSw = System.Diagnostics.Stopwatch.StartNew();

            try
            {
                string key = KeyOf(e.GetDocument());
                if (key == null) return;

                // ⚠️ Revit-ийн API-д хандах ЦОРЫН ГАНЦ дуудлага, түгжээнээс ГАДНА.
                // `GetTransactionNames()` нь үйл явдлын өгөгдөлд аль хэдийн байгаа
                // мөр — тооцоолол хийхгүй тул хэрэглэгчийн зурж буй үйлдлийг
                // удаашруулахгүй.
                string opName = OpNameOf(e);
                long sec = NowSec();

                lock (Gate)
                {
                    // Sync / reload-latest явж байна — БУСДЫН ажил, тоолохгүй.
                    if (Suppressed.Contains(key)) return;

                    // Суурь тавиагүй баримтыг мөрдөхгүй: санах ой дэмий
                    // эзлэхгүй, мөн «хэзээнээс хойш» нь тодорхойгүй байна.
                    if (!States.TryGetValue(key, out Change c)) return;

                    bool cap = c.Total >= MaxTrackedIds;
                    if (cap) c.Truncated = true;

                    int opIdx = c.OpIndexOf(opName);

                    // ⚠️ Ctrl+Z-ийг БУЦААЛТ гэж үзнэ (2026-08-26-ны гомдол:
                    // «хоёр багана зөөгөөд буцаахад still 4 өөрчлөлт гэж
                    // гардаг»).  Revit нь undo-г ч `DocumentChanged` болгож
                    // мэдэгддэг ба ЯГ ИЖИЛ id-нуудыг дахин дурддаг тул урьд нь
                    // олонлог өөрчлөгдөхгүй, тоо буурдаггүй байв.
                    bool undo = e.Operation == UndoOperation.TransactionUndone;

                    // ⚠️ ТҮҮХИЙН БИЧЛЭГИЙГ УРЬДЧИЛАН БЭЛТГЭНЭ.  `slot`-ыг
                    //    ДАВТАЛТААС ӨМНӨ тооцно: түүврийн буферийн байрлал нь
                    //    ЯГ ЭНЭ бичлэгийнх байх ёстой.  Дараа нь тооцвол
                    //    давталтууд ӨМНӨХ гүйлгээний нүдэнд бичих ба бичлэг
                    //    бүр өөр гүйлгээний id-г заана (чимээгүй өгөгдөл эвдрэл).
                    //
                    // ⚠️ ХУВААРИЛАЛТ БАЙХГҮЙ — таван локал `int`/`long`.
                    long rawSeq = _ringSeq;
                    int rawSlot = (int)(rawSeq % RawRingMax);
                    int sampleOff = rawSlot * SamplePerTxn;
                    _sampleN = 0;
                    int addedN = 0, deletedN = 0, modifiedN = 0;

                    // ⚠️ ОЛОНЛОГИЙН АЛГЕБР — undo/redo ба дараалсан засварыг
                    // зөв барина.  Энэ сессэд ҮҮСГЭЭД дараа нь УСТГАСАН
                    // элемент нь «устсан» гэж тоологдох ЁСГҮЙ: хэрэглэгчийн
                    // хувьд тэр юу ч болоогүй.
                    foreach (ElementId id in e.GetAddedElementIds())
                    {
                        long v = id.Value;

                        // ⚠️ ТООЛУУР НЬ ҮНЭН ЗӨВ, ID НЬ ТҮҮВЭР.  Тоолуур нь
                        //    ОЛОНЛОГИЙН АЛГЕБРААС ӨМНӨ өснө: «хүн юу хийсэн»
                        //    гэдэг нь «суурьтай юу ялгаатай»-аас ӨӨР асуулт.
                        // ⚠️ ТҮҮВРИЙН ДАРААЛАЛ НЬ ГЭРЭЭ: add → delete → modify.
                        //    `touches[].change` нь ЗӨВХӨН энэ дарааллаас ба
                        //    гурван тоолуураас ТООЦОГДДОГ — дарааллыг сольвол
                        //    «устгасан» нь «нэмсэн» болж ЧИМЭЭГҮЙ буруу
                        //    сургалтын мөр гарна.
                        addedN++;
                        if (_sampleN < SamplePerTxn) _sampleBuf[sampleOff + _sampleN++] = v;

                        if (undo)
                        {
                            // УСТГАЛЫГ буцаасан — элемент эргэж ирлээ, цэвэр үр
                            // дүн ТЭГ.  Урьд нь энэ нь «Modified» болж хувирдаг
                            // байсан тул устгаад буцаахад мөр үлддэг байв.
                            if (c.Deleted.Remove(v)) c.Meta.Remove(v);
                            // Мэдэхгүй элемент undo-гоор ирвэл тэр нь СУУРИЙН
                            // ӨМНӨХ үйлдлийг буцаасан хэрэг — тоолохгүй.
                            continue;
                        }

                        if (c.Deleted.Remove(v)) { c.Modified.Add(v); c.Note(v, opIdx, sec); continue; }
                        if (!cap) { c.Added.Add(v); c.Note(v, opIdx, sec); }
                    }

                    foreach (ElementId id in e.GetDeletedElementIds())
                    {
                        long v = id.Value;

                        // ⚠️ ТҮҮХ — гэрээт дарааллын ХОЁРДУГААР блок.
                        deletedN++;
                        if (_sampleN < SamplePerTxn) _sampleBuf[sampleOff + _sampleN++] = v;

                        // Үүсгээд устгасан = тэг (undo эсэхээс үл хамааран).
                        // META-г нь ч цэвэрлэнэ, эс тэгвээс байхгүй элементийн
                        // тухай мөр үлдэнэ.
                        if (c.Added.Remove(v)) { c.Meta.Remove(v); continue; }

                        if (undo)
                        {
                            // Суурийн өмнөх ҮҮСГЭЛТИЙГ буцаасан — бидний
                            // тоолоогүй элемент.  Устгал гэж бүртгэх нь ХУДАЛ.
                            continue;
                        }

                        c.Modified.Remove(v);
                        if (!cap) { c.Deleted.Add(v); c.Note(v, opIdx, sec); }
                    }

                    foreach (ElementId id in e.GetModifiedElementIds())
                    {
                        long v = id.Value;

                        // ⚠️ ТҮҮХ — гэрээт дарааллын ГУРАВДУГААР блок.
                        //    `continue`-үүдээс ӨМНӨ: түүх нь Revit ЮУ хэлснийг
                        //    бүртгэнэ, олонлогийн алгебр юуг УСТГАСНЫГ БИШ.
                        modifiedN++;
                        if (_sampleN < SamplePerTxn) _sampleBuf[sampleOff + _sampleN++] = v;

                        if (c.Deleted.Contains(v)) continue;

                        if (undo)
                        {
                            // Засварыг буцаалаа.  Гүн 0 болбол суурийн байдалдаа
                            // эргэж ирсэн тул ЖАГСААЛТААС ХАСНА.  Хоёр удаа
                            // зөөгөөд нэг л удаа буцаавал 1 үлдэж, мөр хэвээр
                            // байна — тэр нь зөв.
                            if (c.Added.Contains(v)) { c.UndoTouch(v, sec); continue; }
                            if (!c.Modified.Contains(v)) continue;
                            if (c.UndoTouch(v, sec))
                            {
                                c.Modified.Remove(v);
                                c.Meta.Remove(v);
                            }
                            continue;
                        }

                        // Энэ сессэд ҮҮССЭН элементийн засвар нь тусдаа мэдээлэл
                        // биш — аль хэдийн тоологдсон.  ГЭХДЭЭ ЦАГИЙГ нь
                        // шинэчилнэ: жагсаалт «хамгийн сүүлд хэзээ хөндсөн»-ийг
                        // харуулах ёстой.
                        if (c.Added.Contains(v)) { c.Note(v, opIdx, sec); continue; }
                        if (!cap) { c.Modified.Add(v); c.Note(v, opIdx, sec); }
                    }

                    // ⚠️ ТҮҮХ.  Дээрх гурван давталт `addedN/deletedN/modifiedN`-ыг
                    //    тоолж, `_sampleBuf`-ийн `sampleOff` байрлалд хамгийн ихдээ
                    //    `SamplePerTxn` id хуулсан.  ЭНД Revit-ийн API-д ХҮРЭХГҮЙ,
                    //    диск хөндөхгүй, сүлжээ хөндөхгүй, ХУВААРИЛАЛТ ХИЙХГҮЙ.
                    AppendRaw(rawSeq, rawSlot, key, opName, opIdx, sec, undo,
                              addedN, deletedN, modifiedN);
                    Dirty.Add(key);
                }
            }
            catch
            {
                // ⚠️ ЭНД ХЭЗЭЭ Ч АЛДАА ГАРГАЖ БОЛОХГҮЙ.  Үйл явдлын
                // боловсруулагчаас шидэгдсэн алдаа нь хэрэглэгчийн ЗУРЖ
                // БАЙГАА гүйлгээг тасалж болно.
            }
            finally
            {
                // ⚠️ `finally` — дээрх `return`-ууд (түлхүүр null, suppressed,
                // суурьгүй баримт) нь хамгийн ХЯМД замууд бөгөөд тэднийг
                // хэмжилтээс хасвал хуваарилалт нь бодит байдлаас УДААН
                // харагдана.
                if (dcSw != null)
                {
                    try
                    {
                        dcSw.Stop();
                        Metrics.DocChanged.Add(dcSw.Elapsed.TotalMilliseconds);
                    }
                    catch { }
                }
            }
        }
    }
}
