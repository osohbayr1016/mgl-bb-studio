using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using Autodesk.Revit.ApplicationServices;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Events;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.Smart;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ChangeImpact
{
    /// <summary>
    /// Загварын өөрчлөлтийн БҮРТГЭЛ (`DocumentChanged`).
    ///
    /// ⚠️ HANDLER = ХАЛУУН ЗАМ (транзакц бүрд) → ЗӨВХӨН уншдаг, ХУРДАН:
    ///   • зөвхөн ElementId-уудыг `long[]` болгон хуулна (тэгээд хязгаартай); ЭЛЕМЕНТ УНШИХГҮЙ, диск, лог, транзакц
    ///     ХЭЗЭЭ Ч үгүй; баримтын түлхүүр (`DocumentKey`) зөвхөн баримт тутамд НЭГ удаа (`NewTracker`, Document-ийн хэдэн
    ///     шинж чанар унших) — арын flush thread «session нээлттэй» тэмдгийг тавихад түлхүүр бэлэн байх ёстой;
    ///   • багц бүрд цаг дээр суурилсан МОНОТОН дугаар (`ImpactSeq`);
    ///   • дараа нь (богино debounce) үндсэн thread дээр `SmartExecutor`-оор элементийн ИДЕНТИТИ-г (UniqueId,
    ///     ангилал, холбоо) уншина — устгагдахаас ӨМНӨ.  Устсан элементийн мэдээлэл ЗӨВХӨН энэ кэшээс.
    ///
    /// ХЯЗГААР: нэг багцад ≤ 5000 id/төрөл (нийт тоо хадгалагдана, `Truncated`), хүлээгдэж буй багц ≤ 2000.
    /// Идентити унших нь ХЭСЭГЛЭСЭН: нэг дуудлагад ≤ ~1200 id (нэг багц 15 000 id байсан ч нэг Step-д нэг дор уншихгүй — Revit-ийн UI гацахгүй).
    ///
    /// ⚠️ ЦООРХОЙ ЧИМЭЭГҮЙ ҮЛДЭХГҮЙ.  Өөрчлөлт бүртгэгдэхгүй (эсвэл хасагдах) БҮР тохиолдолд хамгийн ШИНЭ дугаарыг
    /// `LostThroughSeq`-д тэмдэглэнэ (багц хасагдсан, дараалал дүүрч хаясан, цэвэрлэсэн, handler алдсан, хаалтын үед идентитигүй үлдсэн,
    /// уншигдсан файл эвдэрсэн/шинэ хувилбарынх, өмнөх session цэвэрхэн хаагдаагүй) — унтраалттай үеийг `SmartSettings.TrackingGapThroughSeq`-д,
    /// баримтын хаалтын үеийн хадгалалт амжилтгүй бол `SmartSettings.DocGapThroughSeq`-д.  Тэмдэглэгээ бүр ДИСКЭД хадгалагдана (`Dirty`).
    /// Шинжилгээ `FromSeq`-ээс хойших мужид цоорхой орвол «бүрэн БИШ» гэж ИЛ хэлнэ (`ImpactCompleteness`) — «нөлөөлөл олдсонгүй» нь
    /// «өөрчлөгдөөгүй» гэсэн үг БИШ.
    ///
    /// ⚠️ Rolled-back (`TransactionRolledBack`, `TransactionGroupRolledBack`) үйлдлийг БҮРТГЭХГҮЙ: загварыг өмнөх
    /// төлөв рүү буцаасан тул цэвэр өөрчлөлт 0.  (Группийн хэсэг commit-ууд өмнө нь бүртгэгдсэн бол хэт тооцоо — аюулгүй тал.)
    /// Smart Publish-ийн IFC экспорт (нээлттэй транзакцийг буцаадаг) `Suppress()`-ээр бүртгэлийг түр хаана.
    /// ⚠️ Линк загварын доторх өөрчлөлт ЭНД бүртгэгдэхгүй (host баримтын `DocumentChanged` л).
    ///
    /// ⚠️ Баримтыг Revit-ийн `Equals`/`GetHashCode`-оор таньдаг (`DocumentTable`, баримтыг ХҮЧТЭЙ лавлана) — reference-ээр БИШ.
    /// Баримт хаагдахад (`DocumentClosed`) tracker-ийг СҮҮЛЧИЙН удаа хадгалж (`CleanClose`), санах ойноос цэвэрлэнэ.
    ///
    /// ⚠️ Хоёр Revit session ИЖИЛ файлыг нээвэл (ижил `DocumentKey`) тэдний бүртгэл нэг файлд нэгтгэгдэнэ (дугаараар union, диск дээрх файл
    /// өөрчлөгдсөн бол бичихийн ӨМНӨ нэгтгэнэ).  ElementId нь тэр хоёр хуулбарт ИЖИЛ гэсэн таамаглал — төв файлын өөр хувилбарууд салсан бол
    /// өөр session-ийн ElementId бидний загварт хамаарахгүй байж болно; цэвэрхэн хаагдаагүй өөр session-ийн тэмдэг цоорхой гэж тэмдэглэгдэнэ.
    /// </summary>
    internal static class ImpactCapture
    {
        internal const int MaxIdsPerKind = 5000;
        internal const int MaxPendingBatches = 2000;
        internal const int MaxCache = 60000;
        /// <summary>Нэг resolve дуудлагад уншиж болох id-ийн дээд хэмжээ (UI thread-д).</summary>
        internal const int ResolveSliceIds = 1200;
        /// <summary>Хаалтын үед хүлээгдэж буй өөрчлөлтийг уншихад зарцуулах хамгийн ихдээ хугацаа (мс).</summary>
        private const int CloseResolveMs = 1500;
        /// <summary>Файл уншигдахгүй байхад дахин оролдохоос өмнө хүлээх хугацаа — оролдлого бүр ~240 мс унтдаг тул үндсэн thread-д давтахгүй.</summary>
        private const long LoadRetryBackoffTicks = 30L * TimeSpan.TicksPerSecond;

        internal sealed class RawBatch
        {
            public long Seq;
            public DateTime Utc;
            public string[] Tx;
            public string Op;
            public long[] Added, Modified, Deleted;
            public int AddedCount, ModifiedCount, DeletedCount;
            public bool Truncated;
            /// <summary>Идентити унших явц: дуусгасан id-ийн тоо (Added ++ Modified ++ Deleted дарааллаар) ба байгуулагдаж буй дүн.</summary>
            public int Cursor;
            public ChangeBatch Partial;
            public int TotalIds { get { return Added.Length + Modified.Length + Deleted.Length; } }
        }

        internal sealed class DocTracker
        {
            public readonly object Gate = new object();
            /// <summary>Нэг tracker-ийн диск рүү бичилтийг дараалуулна (хоёр Persist хуучин snapshot-ыг сүүлд бичихээс сэргийлнэ).</summary>
            public readonly object PersistLock = new object();
            /// <summary>Баримт — ХҮЧТЭЙ лавлагаа (GC-д орсон wrapper tracker-ийг алдуулахгүй).  Арын thread энэд ХЭЗЭЭ Ч хүрэхгүй.</summary>
            public Document Doc;
            public DocumentKey Key;
            public readonly List<RawBatch> Raw = new List<RawBatch>();
            public readonly List<ChangeBatch> Batches = new List<ChangeBatch>();
            public readonly Dictionary<long, ImpactNode> Cache = new Dictionary<long, ImpactNode>();
            public readonly Queue<long> CacheOrder = new Queue<long>();
            public int Dropped;
            public int IgnoredRollbacks;
            /// <summary>Хадгалагдсан бүртгэлийг ачаалах оролдлого хийгдсэн.</summary>
            public bool Loaded;
            /// <summary>Ачаалах нь амжилтгүй (файл түгжигдсэн / шинэ хувилбарынх) — дахин оролдоно (back-off), тэр хүртэл диск рүү БИЧИХГҮЙ.</summary>
            public bool LoadFailed;
            /// <summary>Дараагийн ачаалах оролдлогын хамгийн эрт цаг (UTC ticks) — файл уншигдахгүй байхад үндсэн thread-д давтан унтахгүй.</summary>
            public long NextLoadAttemptTicks;
            public bool DroppedLoaded;
            public bool Dirty;
            /// <summary>Resolved бүртгэл өөрчлөгдөх бүрд өснө — UI-ийн кэш «өөрчлөгдсөн үү» гэж хурдан шалгахад.</summary>
            public int Rev;
            /// <summary>Энэ дугаараас ӨМНӨХ өөрчлөлтийн зарим нь бүртгэлд ороогүй байж болно (`ChangeLogFile.LostThroughSeq`).</summary>
            public long LostThroughSeq;
            /// <summary>Диск дэх файлын БИДНИЙ сүүлд бичсэн/уншсан үеийн хурууны хээ — өөр Revit session ижил файлд бичсэнийг мэдэхэд.</summary>
            public string DiskStamp;
            /// <summary>Цэвэрхэн хаагдаагүй гэж тэмдэглэсэн ӨӨР session-ууд (нэг session-ийн цоорхойг нэг л удаа бүртгэнэ).</summary>
            public readonly HashSet<string> ForeignSessions = new HashSet<string>(StringComparer.Ordinal);
            /// <summary>
            /// ХАМГИЙН СҮҮЛД амжилттай бичсэн snapshot-д «session нээлттэй» (`CleanClose = false`) тэмдэг байсан — баримт хаагдахад «цэвэр» гэж ДАХИН бичих ёстой.
            /// ЗӨВХӨН `Persist` (PersistLock дотор) тавина/арилгана: snapshot-ийн утгаас (`!snapshot.CleanClose`) — `Closed`-ийг дахин уншихгүй (бичилтийн явцад хаагдвал уралдана).
            /// </summary>
            public bool LastWrittenOpen;
            /// <summary>Баримт хаагдсан (сүүлчийн, `CleanClose = true` хадгалалт).</summary>
            public bool Closed;
            public int FinalizeAttempts;
        }

        private static readonly DocumentTable<DocTracker> Trackers = new DocumentTable<DocTracker>();
        private static ControlledApplication _app;
        private static Timer _resolveTimer, _flushTimer;
        /// <summary>
        /// БҮХ нээлттэй баримтын tracker (баримт бүрт нэг).  Арын thread (flush timer) ЗӨВХӨН энэ жагсаалтаар явна — `Document` обьект (Revit API)-д
        /// огт хүрэхгүй.  Хаагдсан баримтын tracker үндсэн thread дээр (`DocumentClosed`, шинэ tracker нэмэх үед) `ClosedTrackers` руу шилжинэ.
        /// </summary>
        private static readonly List<DocTracker> AllTrackers = new List<DocTracker>();
        /// <summary>Баримт нь хаагдсан, гэхдээ сүүлчийн хадгалалт хараахан амжилттай болоогүй tracker-ууд (арын thread дахин оролдоно).</summary>
        private static readonly List<DocTracker> ClosedTrackers = new List<DocTracker>();
        private static volatile bool _enabled = true;
        /// <summary>Handler алдсан (барьсан exception) хамгийн сүүлийн мөчийн дугаар — ямар баримтад гэдгийг мэдэхгүй тул БҮГДЭД хамаарна.</summary>
        private static long _faultThroughSeq;
        [ThreadStatic] private static int _suppress;
        /// <summary>Арын flush (20 с-ийн timer) дугтуйлж ажиллаж байгаа эсэх — IO гацвал timer бүр нэг pool thread-г хүлээлгэж давхардахгүй.</summary>
        private static int _flushRunning;
        /// <summary>Revit-ийг хааж байхад (`OnShutdown`) нийт хадгалахад зарцуулах хамгийн ихдээ хугацаа ба tracker бүрийн хүлээлт (App.cs: хаалтыг ГАЦААХГҮЙ).</summary>
        private const int ShutdownBudgetMs = 2500;
        private const int ShutdownPersistWaitMs = 800;

        internal static bool Enabled
        {
            get { return _enabled; }
            set
            {
                bool was = _enabled;
                _enabled = value;
                bool persisted = false;
                try
                {
                    SmartSettingsFile s = SmartSettings.Load();
                    bool changed = false;
                    if (s.ImpactTracking != value) { s.ImpactTracking = value; changed = true; }
                    // Унтраалттай байсан хугацаанд өөрчлөлт бүртгэгдээгүй — дахин асаах мөчийг цоорхойн төгсгөл болгож тэмдэглэнэ.
                    if (!was && value) { s.TrackingGapThroughSeq = Math.Max(s.TrackingGapThroughSeq, ImpactSeq.Mark()); changed = true; }
                    persisted = !changed || SmartSettings.Save(s);
                }
                catch (Exception) { }

                if (!persisted)
                {
                    SmartLog.Warn("impact", "tracking_toggle_not_persisted", new { enabled = value });
                    // Унтраалттай үеийн цоорхойг тохиргооны файлд хадгалж чадаагүй — энэ session-д БҮХ баримтад цоорхой гэж тэмдэглэнэ (аюулгүй тал).
                    if (!was && value) { try { Interlocked.Exchange(ref _faultThroughSeq, ImpactSeq.Mark()); MarkAllDirty(); } catch (Exception) { } }
                }
            }
        }

        /* ============================== LIFECYCLE ========================== */

        internal static void Init(ControlledApplication app)
        {
            if (_app != null || app == null) return;
            _app = app;
            try
            {
                SmartSettingsFile s = SmartSettings.Load();
                _enabled = s.ImpactTracking;
                ImpactSeq.Observe(s.TrackingGapThroughSeq);
                if (s.DocGapThroughSeq != null && s.DocGapThroughSeq.Count > 0) ImpactSeq.Observe(s.DocGapThroughSeq.Values.Max());
            }
            catch (Exception) { _enabled = true; }
            app.DocumentChanged += OnChanged;
            ImpactObservationSinks.Register("impact-capture", OnReplayed);
            app.DocumentClosing += OnClosing;
            app.DocumentClosed += OnClosed;
            app.DocumentSaved += OnSaved;
            app.DocumentSavedAs += OnSavedAs;
            _flushTimer = new Timer(_ => FlushAllBackground(), null, 20000, 20000);
        }

        internal static void Shutdown()
        {
            try
            {
                if (_app != null)
                {
                    _app.DocumentChanged -= OnChanged;
                    ImpactObservationSinks.Unregister("impact-capture");
                    _app.DocumentClosing -= OnClosing;
                    _app.DocumentClosed -= OnClosed;
                    _app.DocumentSaved -= OnSaved;
                    _app.DocumentSavedAs -= OnSavedAs;
                }
            }
            catch (Exception) { }
            _app = null;
            try { if (_flushTimer != null) _flushTimer.Dispose(); } catch (Exception) { }
            try { if (_resolveTimer != null) _resolveTimer.Dispose(); } catch (Exception) { }
            _flushTimer = null;
            _resolveTimer = null;

            // `OnShutdown` = Revit ЦЭВЭРХЭН хааж байна (унасан/хүчээр зогсоосон үед дуудагдахгүй — тэр үед `CleanClose=false` үлдэж дараагийн session цоорхой гэж ИЛ тэмдэглэнэ).
            // Хаагдаагүй баримтуудад `DocumentClosed` ирээгүй байж болох тул tracker бүрийг сүүлчийн удаа (`CleanClose=true`) хадгална — эс бөгөөс Revit-ийн ХЭВИЙН
            // гаралт бүрийн дараа «өмнөх session цэвэрхэн хаагдаагүй» гэсэн ХУДАЛ цоорхой гардаг.  Tracker-ийн өгөгдөл л — Revit обьектод хүрэхгүй.
            //
            // ⚠️ Revit-ийн хаагдалтыг ГАЦААХГҮЙ (App.cs `OnShutdown`-ийн дүрэм): tracker бүрт ≤`ShutdownPersistWaitMs`, нийт ≤`ShutdownBudgetMs`.  Хадгалж чадаагүй бол ДАХИН
            // ОРОЛДОХ БОЛОМЖГҮЙ (процесс дуусна) тул цоорхойг ТУСДАА файлд (тохиргоо) ШУУД тэмдэглэнэ — ≥3 оролдлого хүлээж, Revit өмнө нь хаагдаад «цоорхойгүй» болдог байв.
            var sw = Stopwatch.StartNew();
            try
            {
                var pending = new List<DocTracker>();
                lock (AllTrackers) pending.AddRange(AllTrackers);
                lock (ClosedTrackers) pending.AddRange(ClosedTrackers);
                foreach (DocTracker t in pending)
                {
                    try
                    {
                        if (sw.ElapsedMilliseconds >= ShutdownBudgetMs) RecordFinalGap(t);      // хугацаа дууссан — хүлээлгүй цоорхойг тэмдэглэнэ
                        else TryFinalize(t, true);
                    }
                    catch (Exception) { }
                }
            }
            catch (Exception) { }
        }

        /// <summary>Энэ thread дээр бүртгэлийг түр хаана (`using`).  Smart Publish-ийн IFC экспортын түр транзакцэд.</summary>
        internal static IDisposable Suppress()
        {
            _suppress++;
            return new SuppressToken();
        }

        private sealed class SuppressToken : IDisposable
        {
            private bool _done;
            public void Dispose()
            {
                if (_done) return;
                _done = true;
                if (_suppress > 0) _suppress--;
            }
        }

        /// <summary>
        /// Хойшлуулсан (Apply-ийн) өөрчлөлтийг дахин тоглуулж чадаагүй — handler алдсантай ИЖИЛ: цоорхой тэмдэглэнэ, бүртгэл «бүрэн БИШ» гэж ИЛ хэлнэ.
        /// </summary>
        internal static void ReportLostObservation()
        {
            Interlocked.Exchange(ref _faultThroughSeq, ImpactSeq.Next());
            MarkAllDirty();
        }

        /// <summary>Handler алдсан/тохиргоо хадгалагдаагүй — БҮХ tracker-ийг «хадгалах шаардлагатай» гэж тэмдэглэнэ (цоорхой дискэнд очно).</summary>
        private static void MarkAllDirty()
        {
            lock (AllTrackers)
            {
                foreach (DocTracker t in AllTrackers) t.Dirty = true;   // bool-ийн задгай бичилт — аюултай уралдаан биш (хамгийн муу нь нэмэлт хадгалалт)
            }
        }

        /* ============================== HANDLER ============================ */

        private static long[] Copy(ICollection<ElementId> ids, out int total, ref bool truncated)
        {
            total = ids != null ? ids.Count : 0;
            if (total == 0) return new long[0];
            int n = Math.Min(total, MaxIdsPerKind);
            if (total > MaxIdsPerKind) truncated = true;
            var arr = new long[n];
            int i = 0;
            foreach (ElementId id in ids)
            {
                if (i >= n) break;
                arr[i++] = id.Value;
            }
            return arr;
        }

        private static void OnChanged(object sender, DocumentChangedEventArgs e)
        {
            Handle(new LiveDocChange(e));
        }

        /// <summary>Хойшлуулсан (Apply-ийн баталгаажсан) commit-ийг нэг удаа бүртгэнэ — `_suppress` аль хэдийн суларсан үед.</summary>
        private static void OnReplayed(DetachedDocChange c)
        {
            Handle(c);
        }

        /// <summary>Амьд ба дахин тоглуулсан хуулбарт ИЖИЛ логик (struct generic — халуун замд хуваарилалтгүй).</summary>
        private static void Handle<T>(T e) where T : IDocChange
        {
            try
            {
                if (!_enabled || _suppress > 0) return;
                Document d = e.GetDocument();
                if (d == null || d.IsFamilyDocument) return;

                UndoOperation op = e.Operation;
                DocTracker t = Trackers.GetOrAdd(d, () => NewTracker(d));

                if (op == UndoOperation.TransactionRolledBack || op == UndoOperation.TransactionGroupRolledBack)
                {
                    Interlocked.Increment(ref t.IgnoredRollbacks);
                    return;
                }

                var b = new RawBatch { Utc = SmartClock.UtcNow, Op = op.ToString() };
                bool trunc = false;
                int a, m, del;
                b.Added = Copy(e.GetAddedElementIds(), out a, ref trunc);
                b.Modified = Copy(e.GetModifiedElementIds(), out m, ref trunc);
                b.Deleted = Copy(e.GetDeletedElementIds(), out del, ref trunc);
                b.AddedCount = a; b.ModifiedCount = m; b.DeletedCount = del;
                b.Truncated = trunc;
                if (a + m + del == 0) return;
                b.Seq = ImpactSeq.Next();
                try { b.Tx = e.GetTransactionNames().ToArray(); } catch (Exception) { b.Tx = new string[0]; }

                lock (t.Gate)
                {
                    t.Raw.Add(b);
                    // «Хадгалах шаардлагатай» гэж ШУУД тэмдэглэнэ (задгай bool л): үндсэн thread завгүй (командын дунд — ExternalEvent ажиллахгүй) үед ч арын flush
                    // (≤20 с) «session нээлттэй» тэмдгийг (`CleanClose=false`) тавьж, Revit унавал дараагийн session цоорхой гэж ИЛ тэмдэглэнэ.
                    t.Dirty = true;
                    if (t.Raw.Count > MaxPendingBatches)
                    {
                        // Дараалал дүүрсэн — хамгийн хуучныг хаяна.  ЦООРХОЙГ тэмдэглэнэ (чимээгүй алдахгүй) ба дискэнд хадгалуулна.
                        RawBatch lost = t.Raw[0];
                        t.Raw.RemoveAt(0);
                        t.Dropped++;
                        t.LostThroughSeq = Math.Max(t.LostThroughSeq, lost.Seq);
                        t.Dirty = true;
                        t.Rev++;
                    }
                }
                ScheduleResolve();
            }
            catch (Exception)
            {
                // Handler нь ХЭЗЭЭ Ч транзакцийг саатуулах/унагах ёсгүй — гэхдээ энэ өөрчлөлт бүртгэгдээгүй: цоорхой тэмдэглэнэ ба БҮХ tracker-ийг
                // «хадгалах» гэж тэмдэглэнэ (эс бөгөөс өөр өөрчлөлт ирэх хүртэл цоорхой дискэнд бичигдэхгүй, Revit унавал алдагдана).
                try
                {
                    Interlocked.Exchange(ref _faultThroughSeq, ImpactSeq.Next());
                    MarkAllDirty();
                }
                catch (Exception) { }
            }
        }

        private static DocTracker NewTracker(Document doc)
        {
            var t = new DocTracker { Doc = doc };
            // Түлхүүрийг ЭНД (баримт тутамд НЭГ удаа, Revit API унших) тооцно — арын flush thread «session нээлттэй» тэмдгийг үндсэн thread-ийг хүлээлгүй тавьж чадахын тулд.
            // Алдвал null — `EnsureLoaded` дараа нь тооцно.
            try { t.Key = RevitDocumentKeys.Of(doc); } catch (Exception) { }
            lock (AllTrackers)
            {
                // Хаагдсан баримтын tracker-ийг (ЗӨВХӨН үндсэн thread: `IsValidObject` нь Revit API) цэвэрлэх мөртлөө ЧИМЭЭГҮЙ ХАЯХГҮЙ — сүүлчийн
                // хадгалалтыг арын thread дуусгана.
                for (int i = AllTrackers.Count - 1; i >= 0; i--)
                {
                    DocTracker x = AllTrackers[i];
                    if (SmartDocs.IsAlive(x.Doc)) continue;
                    AllTrackers.RemoveAt(i);
                    lock (x.Gate) { x.Closed = true; x.Doc = null; }       // хаагдсан баримтын wrapper-ийг барихгүй (арын thread Doc-д хүрдэггүй)
                    lock (ClosedTrackers) ClosedTrackers.Add(x);
                }
                AllTrackers.Add(t);
            }
            return t;
        }

        /* ============================== RESOLVE ============================ */

        /// <summary>Debounce (300 мс): олон транзакц дараалан орвол нэг удаа үндсэн thread дээр идентити уншина.</summary>
        private static void ScheduleResolve()
        {
            try
            {
                if (!SmartExecutor.IsReady) return;
                if (_resolveTimer == null) _resolveTimer = new Timer(_ => RunResolve(), null, Timeout.Infinite, Timeout.Infinite);
                _resolveTimer.Change(300, Timeout.Infinite);
            }
            catch (Exception) { }
        }

        private static void RunResolve()
        {
            try
            {
                if (!SmartExecutor.IsReady) return;
                var _ = SmartExecutor.Run<int>(app =>
                {
                    int remaining = 0;
                    foreach (Document d in LiveDocuments())
                    {
                        // Нэг баримтын алдаа (хаагдаж байгаа, түлхүүр уншигдаагүй г.м.) бусад нээлттэй баримтын идентити уншилтыг ЗОГСООХГҮЙ.
                        try
                        {
                            DocTracker t;
                            if (!Trackers.TryGet(d, out t)) continue;
                            remaining += ResolveSome(t, d, ResolveSliceIds);
                        }
                        catch (Exception ex) { SmartLog.Error("impact", "resolve_failed", ex); }
                    }
                    if (remaining > 0) ScheduleResolve();
                    return remaining;
                }, CancellationToken.None, "impact.resolve");
            }
            catch (Exception) { }
        }

        internal static IEnumerable<Document> LiveDocuments()
        {
            var list = new List<Document>();
            lock (AllTrackers)
            {
                foreach (DocTracker t in AllTrackers)
                {
                    if (t.Doc != null && SmartDocs.IsAlive(t.Doc)) list.Add(t.Doc);
                }
            }
            return list;
        }

        internal static DocTracker TrackerFor(Document doc)
        {
            return Trackers.GetOrAdd(doc, () => NewTracker(doc));
        }

        /// <summary>
        /// Тухайн баримтын түлхүүр + хадгалагдсан бүртгэлийг ачаална.  Үндсэн thread.
        /// ⚠️ Файл УНШИГДААГҮЙ (түгжигдсэн) бол «хоосон» гэж ҮЗЭХГҮЙ: `LoadFailed` — дараа нь дахин оролдоно, тэр хүртэл диск рүү
        /// БИЧИХГҮЙ (бодит түүхийг дарахгүй).  Дахин оролдлого 30 секундийн back-off-той: оролдлого бүр файлыг 3 удаа (≈240 мс унтаж) уншдаг тул
        /// үндсэн thread-д 300 мс тутам давтвал засвар хийх бүрд гацна.
        /// </summary>
        private static void EnsureLoaded(DocTracker t, Document doc)
        {
            if (t.Loaded && !t.LoadFailed) return;
            if (t.Loaded && DateTime.UtcNow.Ticks < t.NextLoadAttemptTicks) return;
            t.Loaded = true;
            try
            {
                if (t.Key == null) t.Key = RevitDocumentKeys.Of(doc);
                TryLoadMerge(t);
            }
            catch (Exception ex)
            {
                t.LoadFailed = true;
                t.NextLoadAttemptTicks = DateTime.UtcNow.Ticks + LoadRetryBackoffTicks;
                SmartLog.Warn("impact", "load_failed", new { ex = ex.GetType().Name });
                return;
            }

            // Файл амжилттай ачаалагдлаа, ХАРИН «session нээлттэй» тэмдэг (`CleanClose=false`) хараахан бичигдээгүй бөгөөд бичигдэх өөрчлөлт байна — ОДОО тавина.  Үүнийг
            // хүлээж 20 с-ийн flush/Save хүртэл орхивол тэр завсарт Revit унавал дараагийн session юу ч тэмдэглэхгүй («цоорхойгүй»).  Түгжээ завгүй бол алгасна (арын flush тавина).
            bool plant;
            lock (t.Gate) plant = t.Dirty && !t.LastWrittenOpen && !t.LoadFailed;
            if (plant) Persist(t, 0);
        }

        /// <summary>Диск дэх бүртгэлийг санах ойтой нэгтгэнэ.  Revit API ХЭРЭГГҮЙ (түлхүүр бэлэн) — арын thread-ээс ч дуудагдана.</summary>
        private static void TryLoadMerge(DocTracker t)
        {
            if (t.Key == null) return;
            string stampBefore = ChangeLogStore.DiskStamp(t.Key);       // уншихаас ӨМНӨ: дараа нь өөрчлөгдвөл дараагийн Persist дахин нэгтгэнэ
            LoadStatus status;
            ChangeLogFile f = ChangeLogStore.Load(t.Key, out status);
            if (status == LoadStatus.Unreadable)
            {
                t.LoadFailed = true;
                t.NextLoadAttemptTicks = DateTime.UtcNow.Ticks + LoadRetryBackoffTicks;
                return;
            }
            lock (t.Gate)
            {
                // Бодит түүх УНШИГДСАНГҮЙ (эвдэрсэн → quarantine-д нүүж хоосон; эсвэл шинэ add-in-ийн бичсэн файл): өмнөх session-үүдийн өөрчлөлт
                // бүртгэлд ороогүй — «нөлөөлөл олдсонгүй» гэж худал итгэл төрүүлэхгүйн тулд ЦООРХОЙГ тэмдэглэнэ.
                if (status == LoadStatus.Corrupt || status == LoadStatus.NewerSchema)
                {
                    t.LostThroughSeq = Math.Max(t.LostThroughSeq, ImpactSeq.Mark());
                    t.Dirty = true;
                }
                // Эвдэрсэн файлыг `.corrupt-*` руу НҮҮЛГЭЖ ЧАДААГҮЙ (түгжигдсэн) бол SmartStore тэр замыг «уншигдахгүй» гэж тэмдэглэж, хойшхи `Save` БҮГД татгалзана.
                // Үүнийг «ачаалагдсан» гэж үзвэл хадгалалт session турш чимээгүй унаж UI ч анхааруулахгүй — `LoadFailed` болгож back-off-оор дахин оролдоно.
                bool wedged = status == LoadStatus.Corrupt && ChangeLogStore.IsMarkedUnreadable(t.Key);
                // Өөр session цэвэрхэн хаагдалгүй (унасан) эсвэл ОДОО нээлттэй байхад үлдээсэн файл: хадгалагдаагүй/давхцсан өөрчлөлт байж болно.
                if ((status == LoadStatus.Ok || status == LoadStatus.Migrated)
                    && ChangeLogStore.PriorSessionEndedUncleanly(f, ChangeLogStore.ProcessSessionId)
                    && t.ForeignSessions.Add(f.SessionId))
                {
                    t.LostThroughSeq = Math.Max(t.LostThroughSeq, ImpactSeq.Mark());
                    t.Dirty = true;
                    SmartLog.Warn("impact", "prior_session_unclean");
                }

                var have = new HashSet<long>(t.Batches.Select(b => b.Seq));
                foreach (ChangeBatch b in f.Batches) if (have.Add(b.Seq)) t.Batches.Add(b);
                t.Batches.Sort((x, y) => x.Seq.CompareTo(y.Seq));
                if (!t.DroppedLoaded) { t.Dropped += f.DroppedBatches; t.DroppedLoaded = true; }
                t.LostThroughSeq = Math.Max(t.LostThroughSeq, f.LostThroughSeq);
                t.DiskStamp = stampBefore;
                t.Rev++;

                if (status == LoadStatus.NewerSchema || wedged)
                {
                    // Файл шинэ хувилбарынх (манай add-in ХЭЗЭЭ Ч дарж бичихгүй) эсвэл эвдэрсэн файлыг нүүлгэж чадсангүй — «уншигдаагүй» мэт ил хэлнэ, back-off-оор дахин оролдоно.
                    t.LoadFailed = true;
                    t.NextLoadAttemptTicks = DateTime.UtcNow.Ticks + LoadRetryBackoffTicks;
                }
                else
                {
                    t.LoadFailed = false;
                }
            }
        }

        /// <summary>
        /// Хүлээгдэж буй багцуудын идентити-г (≤ `budgetIds` id) уншина.  Буцаах: үлдсэн id-ийн ойролцоо тоо.
        /// ⚠️ Үндсэн thread дээр л (`SmartExecutor` эсвэл тохирох event).
        /// ⚠️ ХЭСЭГЛЭСЭН: нэг багц 15 000 id байсан ч нэг дуудлагад `budgetIds`-ээс илүүг уншихгүй — курсор нь багцад хадгалагдаж дараагийн дуудлагад
        /// үргэлжилнэ (өмнө нь нэг багц бүхлээрээ нэг Step-д уншигдаж Revit-ийн UI секундээр гацдаг байв).
        /// </summary>
        internal static int ResolveSome(DocTracker t, Document doc, int budgetIds)
        {
            EnsureLoaded(t, doc);
            int used = 0;
            while (used < budgetIds)
            {
                RawBatch raw;
                lock (t.Gate)
                {
                    if (t.Raw.Count == 0) break;
                    raw = t.Raw[0];
                }

                if (!ResolveSlice(t, doc, raw, budgetIds, ref used)) break;     // төсөв дууссан — энэ багц дараагийн дуудлагад үргэлжилнэ

                lock (t.Gate)
                {
                    if (t.Raw.Count > 0 && ReferenceEquals(t.Raw[0], raw)) t.Raw.RemoveAt(0);
                    t.Batches.Add(raw.Partial);
                    TrimMemory(t);
                    t.Dirty = true;
                    t.Rev++;
                }
            }
            lock (t.Gate) return t.Raw.Sum(r => r.TotalIds - r.Cursor);
        }

        /// <summary>
        /// Нэг багцын идентитиг `limit`-д (нийт `used` хүртэл) хүртэл уншина.  true = багц БҮРЭН уншигдаж дууссан (`Partial` бэлэн).
        /// </summary>
        private static bool ResolveSlice(DocTracker t, Document doc, RawBatch raw, int limit, ref int used)
        {
            if (raw.Partial == null)
            {
                raw.Partial = new ChangeBatch
                {
                    Seq = raw.Seq, Utc = raw.Utc, Operation = raw.Op,
                    Added = raw.AddedCount, Modified = raw.ModifiedCount, Deleted = raw.DeletedCount,
                    Truncated = raw.Truncated, Resolved = true,
                };
                if (raw.Tx != null) raw.Partial.Transactions.AddRange(raw.Tx.Where(s => !string.IsNullOrWhiteSpace(s)).Take(6));
            }

            int added = raw.Added.Length, modified = raw.Modified.Length, total = raw.TotalIds;
            while (raw.Cursor < total && used < limit)
            {
                int i = raw.Cursor;
                ChangeEntry ce;
                if (i < added) ce = Entry(t, doc, raw.Added[i], ChangeKind.Added);
                else if (i < added + modified) ce = Entry(t, doc, raw.Modified[i - added], ChangeKind.Modified);
                else ce = DeletedEntry(t, raw.Deleted[i - added - modified]);
                raw.Partial.Entries.Add(ce);
                raw.Cursor++;
                used++;
            }
            return raw.Cursor >= total;
        }

        /// <summary>
        /// Санах ойн бүртгэл хязгааргүй өсөхгүй — хамгийн хуучин багцыг хасна (дискний хязгаартай ИЖИЛ функц).  Хасагдсан хамгийн
        /// шинэ дугаарыг `LostThroughSeq`-д тэмдэглэнэ: тэр мужид эхэлсэн шинжилгээ «бүрэн БИШ» гэж ИЛ хэлэгдэнэ.
        /// </summary>
        private static void TrimMemory(DocTracker t)
        {
            long lost = t.LostThroughSeq;
            // Хамгийн сүүлийн багцыг ХЭЗЭЭ Ч хасахгүй (нэг багц хэт том байсан ч).
            if (ChangeLogStore.TrimBatches(t.Batches, ref lost) > 0) t.LostThroughSeq = lost;
        }

        private static ChangeEntry Entry(DocTracker t, Document doc, long id, ChangeKind kind)
        {
            ImpactNode n = null;
            try
            {
                Element e = doc.GetElement(new ElementId(id));
                if (e != null)
                {
                    n = ImpactSnapshotter.Read(e);
                    Remember(t, n);
                }
            }
            catch (Exception) { }
            if (n == null)
            {
                // Элемент аль хэдийн алга (дараагийн транзакцаар устсан): кэш.
                lock (t.Gate) t.Cache.TryGetValue(id, out n);
            }
            if (n == null) n = new ImpactNode { Id = id, Unknown = true };
            return ImpactSnapshotter.ToEntry(n, kind);
        }

        private static ChangeEntry DeletedEntry(DocTracker t, long id)
        {
            ImpactNode n;
            lock (t.Gate) t.Cache.TryGetValue(id, out n);
            if (n == null) n = new ImpactNode { Id = id, Unknown = true };
            return ImpactSnapshotter.ToEntry(n, ChangeKind.Deleted);
        }

        internal static void Remember(DocTracker t, ImpactNode n)
        {
            lock (t.Gate)
            {
                if (!t.Cache.ContainsKey(n.Id)) t.CacheOrder.Enqueue(n.Id);
                t.Cache[n.Id] = n;
                while (t.Cache.Count > MaxCache && t.CacheOrder.Count > 0) t.Cache.Remove(t.CacheOrder.Dequeue());
            }
        }

        /// <summary>Кэшлэгдсэн идентити (устсан элементийн мэдээлэл).</summary>
        internal static bool TryGetNode(Document doc, long id, out ImpactNode node)
        {
            node = null;
            DocTracker t;
            if (!Trackers.TryGet(doc, out t)) return false;
            lock (t.Gate) return t.Cache.TryGetValue(id, out node);
        }

        /* ============================== SNAPSHOT / UI ===================== */

        /// <summary>Бүртгэлийн ХУУЛБАР (UI thread-ээс аюулгүй — Revit API-гүй).</summary>
        internal static List<ChangeBatch> Snapshot(Document doc, out int dropped)
        {
            int rev;
            return Snapshot(doc, out dropped, out rev);
        }

        internal static List<ChangeBatch> Snapshot(Document doc, out int dropped, out int rev)
        {
            DocTracker t = TrackerFor(doc);
            lock (t.Gate)
            {
                dropped = t.Dropped;
                rev = t.Rev;
                return t.Batches.OrderBy(b => b.Seq).Select(Clone).ToList();
            }
        }

        /// <summary>
        /// Бүртгэлийн ЦООРХОЙН мэдээлэл (хуулбаргүй).  `lostThroughSeq` = trim / цэвэрлэсэн / дараалал дүүрсэн / handler алдсан / хаалтын үеийн
        /// хадгалалт амжилтгүй (баримтын цоорхой тохиргооноос); `trackingGapThrough` = бүртгэл унтраалттай байсан хугацааны төгсгөл; `enabled` =
        /// бүртгэл ОДОО асаалттай эсэх; `logUnreadable` = диск дэх бүртгэл уншигдаагүй / шинэ хувилбарынх / ХАРААХАН ачаалагдаагүй (ачаалагдаагүй
        /// tracker «цоорхойгүй» гэж худал хэлэхгүй); `settingsUnreadable` = тохиргооны файл уншигдсангүй (бүртгэл унтарсан эсэх тодорхойгүй).
        /// ⚠️ Үндсэн thread (API context): баримтын түлхүүрийг шаардаж болно.
        /// </summary>
        internal static void GapInfo(Document doc, out long lostThroughSeq, out long trackingGapThrough, out bool enabled, out bool logUnreadable, out bool settingsUnreadable)
        {
            DocTracker t = TrackerFor(doc);
            DocumentKey key;
            lock (t.Gate)
            {
                lostThroughSeq = Math.Max(t.LostThroughSeq, Interlocked.Read(ref _faultThroughSeq));
                logUnreadable = t.LoadFailed || !t.Loaded;
                key = t.Key;
            }
            trackingGapThrough = 0;
            settingsUnreadable = false;
            try
            {
                SmartSettingsFile s = SmartSettings.Load();
                trackingGapThrough = s.TrackingGapThroughSeq;
                settingsUnreadable = s.Unreadable;
                if (key == null) key = RevitDocumentKeys.Of(doc);
                lostThroughSeq = Math.Max(lostThroughSeq, SmartSettings.DocGapFor(s, key != null ? key.Id : null));
            }
            catch (Exception)
            {
                // Тохиргоог уншиж чадаагүйг «цоорхойгүй» гэж ХЭЗЭЭ Ч тайлбарлахгүй.
                settingsUnreadable = true;
            }
            enabled = _enabled;
        }

        /// <summary>
        /// Бүртгэгдээгүй багцын тоо (хуулбаргүйгээр) — мэдээлэл; шийдвэр нь `GapInfo`-оор.
        /// ⚠️ `Document`-гүй: цонхны (API context-ийн гаднах) thread-ээс аюулгүй — session tracker-ийг үүсгэх үедээ (API context) барьж авна.
        /// </summary>
        internal static int DroppedCount(DocTracker t)
        {
            if (t == null) return 0;
            lock (t.Gate) return t.Dropped;
        }

        /// <summary>Resolved бүртгэлийн хувилбар (хуулбаргүйгээр).  UI «өөрчлөгдсөн үү» гэж хурдан шалгана.</summary>
        internal static int Revision(Document doc)
        {
            DocTracker t;
            if (!Trackers.TryGet(doc, out t)) return 0;
            lock (t.Gate) return t.Rev;
        }

        private static ChangeBatch Clone(ChangeBatch b)
        {
            return new ChangeBatch
            {
                Seq = b.Seq, Utc = b.Utc, Operation = b.Operation, Added = b.Added, Modified = b.Modified, Deleted = b.Deleted,
                Truncated = b.Truncated, Resolved = b.Resolved, Transactions = new List<string>(b.Transactions), Entries = new List<ChangeEntry>(b.Entries),
            };
        }

        internal static int PendingCount(Document doc)
        {
            DocTracker t;
            if (!Trackers.TryGet(doc, out t)) return 0;
            lock (t.Gate) return t.Raw.Count;
        }

        internal static void Clear(Document doc)
        {
            DocTracker t = TrackerFor(doc);
            lock (t.Gate)
            {
                // Цэвэрлэсэн мөчөөс ӨМНӨХ бүх өөрчлөлт алдагдана — тэр мужид эхэлсэн шинжилгээ «бүрэн БИШ» болно.
                t.LostThroughSeq = Math.Max(t.LostThroughSeq, ImpactSeq.Mark());
                t.Raw.Clear();
                t.Batches.Clear();
                t.Dropped = 0;
                t.Dirty = true;
                t.Rev++;
            }
            FlushNow(doc, 1000);       // хэрэглэгчийн ИЛ үйлдэл — арын хадгалалт дуусахыг богино хүлээнэ
        }

        /* ============================== PERSIST =========================== */

        private static void OnClosing(object sender, DocumentClosingEventArgs e)
        {
            try
            {
                Document d = e.Document;
                if (d == null || d.IsFamilyDocument) return;
                DocTracker t;
                if (!Trackers.TryGet(d, out t)) return;

                // Хаагдсаны дараа элемент унших боломжгүй — хүлээгдэж буй өөрчлөлтийн идентитиг ОДОО (хугацаатай) уншина.  Хаалт цуцлагдаж
                // болох тул tracker-ийг ЭНД устгахгүй (`DocumentClosed` үед л, баримт үнэхээр хаагдсан бол).
                var sw = Stopwatch.StartNew();
                int remaining;
                do { remaining = ResolveSome(t, d, ResolveSliceIds); }
                while (remaining > 0 && sw.ElapsedMilliseconds < CloseResolveMs);

                FlushNow(d, CloseResolveMs);
            }
            catch (Exception) { }
        }

        /// <summary>
        /// Баримт ХААГДСАН (хаалт цуцлагдсан ч энэ event ирдэг — `IsValidObject`-оор тусгаарлана).  Хаагдсан баримтын tracker-ийн СҮҮЛЧИЙН
        /// хадгалалт (`CleanClose = true`), хаагдсан баримтыг дахин уншиж чадахгүй тул үлдсэн идентитигүй өөрчлөлт нь ЦООРХОЙ.
        /// </summary>
        private static void OnClosed(object sender, DocumentClosedEventArgs e)
        {
            try
            {
                var dead = new List<DocTracker>();
                lock (AllTrackers)
                {
                    for (int i = AllTrackers.Count - 1; i >= 0; i--)
                    {
                        if (SmartDocs.IsAlive(AllTrackers[i].Doc)) continue;
                        dead.Add(AllTrackers[i]);
                        AllTrackers.RemoveAt(i);
                    }
                }
                Trackers.PurgeDead();                 // хаагдсан баримтын (том кэштэй) tracker санах ойд үлдэхгүй
                foreach (DocTracker t in dead)
                {
                    // Нэг tracker-ийн алдаа бусад хаагдсан баримтын сүүлчийн хадгалалтыг ХЭЗЭЭ Ч хориглохгүй.
                    bool done = false;
                    try
                    {
                        lock (t.Gate) { t.Closed = true; t.Doc = null; }       // хаагдсан баримтын wrapper-ийг барихгүй (арын thread Doc-д хүрдэггүй)
                        done = TryFinalize(t, false);
                    }
                    catch (Exception ex) { SmartLog.Error("impact", "finalize_failed", ex); }
                    if (!done)
                        lock (ClosedTrackers) ClosedTrackers.Add(t);       // арын thread дахин оролдоно
                }
            }
            catch (Exception) { }
        }

        /// <summary>
        /// Хаагдсан баримтын tracker-ийн сүүлчийн хадгалалт.  true = дууссан (хадгалагдсан, эсвэл бичих зүйл байхгүй, эсвэл бүрэн бүтэлгүйтэж цоорхойг
        /// тохиргоонд тэмдэглэсэн).  Revit API ХЭРЭГГҮЙ — арын thread-ээс ч дуудагдана.
        /// `final` = процесс дуусах гэж байна (`Shutdown`): ДАХИН ОРОЛДОХ БОЛОМЖГҮЙ тул нэг оролдлогоор (`ShutdownPersistWaitMs`) хадгалж чадаагүй бол цоорхойг ШУУД
        /// тэмдэглэнэ.  Үгүй бол 3 оролдлого (≈2 flush цикл) хүлээнэ.
        /// </summary>
        private static bool TryFinalize(DocTracker t, bool final)
        {
            lock (t.Gate)
            {
                t.Closed = true;
                if (t.Raw.Count > 0)
                {
                    // Хаагдсан баримтыг дахин уншиж чадахгүй: идентитигүй үлдсэн өөрчлөлтүүд алдагдана → цоорхой.
                    t.LostThroughSeq = Math.Max(t.LostThroughSeq, t.Raw.Max(r => r.Seq));
                    t.Raw.Clear();
                    t.Dirty = true;
                    t.Rev++;
                }
            }

            if (t.Key == null) return true;              // түлхүүр хэзээ ч тодорхойлогдоогүй — бичих файл байхгүй

            // `Persist` нь бичих зүйл байхгүй (`Dirty` биш, «session нээлттэй» тэмдэг файлд үлдээгүй) бол true; тэмдэг үлдсэн бол ЦЭВЭР хаалтыг (`CleanClose = true`) бичнэ.
            if (Persist(t, final ? ShutdownPersistWaitMs : 1500)) return true;

            if (!final)
            {
                int attempts;
                lock (t.Gate) attempts = ++t.FinalizeAttempts;
                if (attempts < 3) return false;
            }

            // Хадгалж чадсангүй — баримт хаагдсан, санах ой дахин ашиглагдахгүй.  Цоорхойг ӨӨР файлд (тохиргоо) тэмдэглэнэ.
            RecordFinalGap(t);
            return true;
        }

        /// <summary>
        /// Баримтын бүртгэлийг дискэнд ХАДГАЛЖ ЧАДААГҮЙ (түгжигдсэн, IO алдаа, хаалтын хугацаа дууссан) тул хадгалагдаагүй өөрчлөлтийн ЦООРХОЙГ ТУСДАА файлд (тохиргоо)
        /// тэмдэглэнэ — дараагийн session тэр баримтад «бүрэн БИШ» гэж ИЛ хэлнэ.  Бичих зүйл (`Dirty` / идентитигүй багц) байхгүй бол юу ч хийхгүй.
        /// ⚠️ Хадгалах боломжгүй түлхүүр (хадгалаагүй баримт) нь session-ийн түр id тул тохиргоонд тэмдэглэхгүй.  Revit API ХЭРЭГГҮЙ — арын thread-ээс ч дуудагдана.
        /// </summary>
        private static void RecordFinalGap(DocTracker t)
        {
            DocumentKey key = t.Key;
            if (key == null || !key.Persistable) return;

            long gap;
            lock (t.Gate)
            {
                if (!t.Dirty && t.Raw.Count == 0) return;
                gap = t.LostThroughSeq;
                if (t.Batches.Count > 0) gap = Math.Max(gap, t.Batches.Max(b => b.Seq));
                if (t.Raw.Count > 0) gap = Math.Max(gap, t.Raw.Max(r => r.Seq));
            }
            bool recorded = SmartSettings.RecordDocGap(key.Id, Math.Max(gap, ImpactSeq.Mark()));
            SmartLog.Warn("impact", "close_persist_failed", new { gapRecorded = recorded });
        }

        private static void OnSaved(object sender, DocumentSavedEventArgs e) { SafeFlush(e.Document); }
        private static void OnSavedAs(object sender, DocumentSavedAsEventArgs e) { SafeFlush(e.Document); }

        private static void SafeFlush(Document d)
        {
            try
            {
                if (d == null || d.IsFamilyDocument) return;
                DocTracker t;
                if (!Trackers.TryGet(d, out t)) return;
                // Хүлээгдэж буй (идентитигүй) өөрчлөлт диск рүү ОРОХГҮЙ — хадгалах үед Revit унавал алдагдана.  Хязгаартай хэмжээгээр уншаад (үлдсэн нь
                // дараагийн resolve-д) бичнэ.  API thread-ийг арын хадгалалтад хүлээлгэхгүй (Dirty хэвээр → дараагийн flush).
                ResolveSome(t, d, ResolveSliceIds);
                FlushNow(d, 0);
            }
            catch (Exception) { }
        }

        /// <summary>
        /// Тухайн баримтын бүртгэлийг дискэнд (түлхүүр бэлэн бол).  Үндсэн thread эсвэл хаах үед.
        /// `lockWaitMs`: арын thread бичиж байвал хэдэн мс хүлээх (0 = хүлээхгүй — API thread-ийг хүлээлгэхгүй, `Dirty` хэвээр үлдэнэ).
        /// </summary>
        internal static void FlushNow(Document doc, int lockWaitMs = 0)
        {
            DocTracker t;
            if (!Trackers.TryGet(doc, out t)) return;
            if (t.Key == null)
            {
                try { t.Key = RevitDocumentKeys.Of(doc); } catch (Exception) { return; }
            }
            Persist(t, lockWaitMs);
        }

        /// <summary>
        /// Бүртгэлийг дискэнд бичнэ.  Snapshot авах + бичих НЭГ түгжээнд (`PersistLock`) — таймер ба Save/Close зэрэг дуудагдахад
        /// хуучин snapshot сүүлд бичигдэж шинэ нь `Dirty=false`-ээр алдагдахаас сэргийлнэ.
        /// ⚠️ Ачаалагдаагүй (файл түгжигдсэн) бол БИЧИХГҮЙ — эхлээд дахин ачаална; бодит түүхийг хоосноор дарахгүй.
        /// ⚠️ Диск дэх файл БИДНИЙ сүүлд бичсэн/уншсанаас хойш өөрчлөгдсөн (өөр Revit session) бол бичихийн ӨМНӨ нэгтгэнэ — дарж бичихгүй.
        /// Буцаах: true = бичих зүйл байхгүй эсвэл амжилттай бичсэн; false = одоо бичиж чадсангүй (түгжээ завгүй, файл түгжигдсэн, бичилт алдаатай) —
        /// `Dirty` хэвээр, дараагийн flush дахин оролдоно.
        /// </summary>
        private static bool Persist(DocTracker t, int lockWaitMs)
        {
            if (t.Key == null) return true;
            bool entered = false;
            try
            {
                entered = Monitor.TryEnter(t.PersistLock, lockWaitMs);
                if (!entered) return false;

                lock (t.Gate)
                {
                    if (!NeedsWrite(t)) return true;
                }

                if (t.LoadFailed)
                {
                    if (DateTime.UtcNow.Ticks >= t.NextLoadAttemptTicks)
                    {
                        try { TryLoadMerge(t); } catch (Exception) { t.NextLoadAttemptTicks = DateTime.UtcNow.Ticks + LoadRetryBackoffTicks; }
                    }
                    if (t.LoadFailed) return false;         // файл одоо ч уншигдахгүй — түүх санах ойд, дараагийн удаа
                }
                else
                {
                    string stamp = ChangeLogStore.DiskStamp(t.Key);
                    if (stamp != null && !string.Equals(stamp, t.DiskStamp, StringComparison.Ordinal))
                    {
                        // Файлыг бидний бичсэнээс хойш ӨӨР session өөрчилсөн — union-ээр нэгтгээд бичнэ (түүний багцыг дарахгүй).
                        try { TryLoadMerge(t); } catch (Exception) { t.NextLoadAttemptTicks = DateTime.UtcNow.Ticks + LoadRetryBackoffTicks; t.LoadFailed = true; }
                        if (t.LoadFailed) return false;
                    }
                }

                ChangeLogFile snapshot;
                lock (t.Gate)
                {
                    if (!NeedsWrite(t)) return true;
                    // Handler алдсан (холбогдох баримт тодорхойгүй) цоорхойг энэ баримтад ч тэмдэглэнэ — аюулгүй тал.
                    t.LostThroughSeq = Math.Max(t.LostThroughSeq, Interlocked.Read(ref _faultThroughSeq));
                    snapshot = new ChangeLogFile
                    {
                        Batches = t.Batches.OrderBy(b => b.Seq).Select(Clone).ToList(),
                        DroppedBatches = t.Dropped,
                        LostThroughSeq = t.LostThroughSeq,
                        SessionId = ChangeLogStore.ProcessSessionId,
                        CleanClose = t.Closed,
                    };
                    t.Dirty = false;
                }

                string err = null;
                bool ok = false;
                try { ok = ChangeLogStore.Save(t.Key, snapshot, out err); }
                catch (Exception ex) { err = ex.GetType().Name; }   // Dirty-г ХЭЗЭЭ Ч алдахгүй (өмнө нь exception Dirty=false-ийг хэвээр үлдээдэг байв)

                if (!ok)
                {
                    lock (t.Gate) t.Dirty = true;
                    SmartLog.Warn("impact", "persist_failed", new { err = SmartLog.Scrub(err) });
                    // Эвдэрсэн файлыг нүүлгэж ЧАДААГҮЙ / түгжигдсэн бол `SmartStore` тэр замыг «уншигдахгүй» гэж тэмдэглэсэн — хойшхи бичилт БҮГД татгалзана.  Үүнийг
                    // «ачаалагдсан» гэж үлдээвэл түүх session турш санах ойд л үлдэж UI ч анхааруулахгүй — `LoadFailed` болгож back-off-оор дахин ачаална.
                    if (ChangeLogStore.IsMarkedUnreadable(t.Key))
                    {
                        t.LoadFailed = true;
                        t.NextLoadAttemptTicks = DateTime.UtcNow.Ticks + LoadRetryBackoffTicks;
                    }
                    return false;
                }

                t.DiskStamp = ChangeLogStore.DiskStamp(t.Key);
                t.LastWrittenOpen = !snapshot.CleanClose;      // snapshot-ийн утгаас (`t.Closed`-ийг дахин уншихгүй — бичилтийн явцад хаагдвал уралдана)
                return true;
            }
            finally
            {
                if (entered) Monitor.Exit(t.PersistLock);
            }
        }

        /// <summary>
        /// Диск рүү бичих зүйл байна уу: хадгалагдаагүй өөрчлөлт, ЭСВЭЛ «session нээлттэй» тэмдэг (`CleanClose = false`) файлд үлдсэн атлаа баримт хаагдсан
        /// (цэвэр хаалтыг бичих ёстой — эс бөгөөс дараагийн session «өмнөх session унасан» гэж ХУДАЛ цоорхой тэмдэглэнэ).  `t.Gate` дотор дуудна.
        /// </summary>
        private static bool NeedsWrite(DocTracker t)
        {
            return t.Dirty || (t.Closed && t.LastWrittenOpen);
        }

        /// <summary>Арын thread-ээс (Timer): ЗӨВХӨН detached өгөгдөл — Revit обьектод хүрэхгүй.</summary>
        private static void FlushAllBackground()
        {
            // IO гацвал (сүлжээний диск, антивирус) 20 с тутмын timer бүр нэг pool thread-г хүлээлгэж давхардахгүй — өмнөх flush дуусаагүй бол алгасна.
            if (Interlocked.CompareExchange(ref _flushRunning, 1, 0) != 0) return;
            try
            {
                // ⚠️ Арын thread: `Document`-д ХЭЗЭЭ Ч хүрэхгүй (`GetHashCode`/`Equals` ч Revit API) — tracker-ийн задгай өгөгдөл л.
                List<DocTracker> trackers;
                lock (AllTrackers) trackers = new List<DocTracker>(AllTrackers);
                foreach (DocTracker t in trackers)
                {
                    try { Persist(t, Timeout.Infinite); }
                    catch (Exception) { }          // нэг баримтын алдаа бусад баримтын хадгалалтыг зогсоохгүй
                }

                // Хаагдсан баримтын сүүлчийн хадгалалт (амжилтгүй болсныг дахин оролдоно).
                List<DocTracker> closed;
                lock (ClosedTrackers) closed = new List<DocTracker>(ClosedTrackers);
                foreach (DocTracker t in closed)
                {
                    bool done;
                    try { done = TryFinalize(t, false); } catch (Exception) { done = false; }
                    if (done) lock (ClosedTrackers) ClosedTrackers.Remove(t);
                }
            }
            catch (Exception) { }
            finally { Interlocked.Exchange(ref _flushRunning, 0); }
        }
    }
}
