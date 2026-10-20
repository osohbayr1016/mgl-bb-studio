using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ChangeImpact.Core
{
    /// <summary>
    /// Өөрчлөлтийн ДУГААР (seq) — цаг дээр суурилсан МОНОТОН дугаар: `unixMs × 1024 + тоолуур`.
    ///
    /// ЯАГААД ЦАГ: тоолуурыг файлд хадгалж үргэлжлүүлэх бол `DocumentChanged` handler (халуун зам) диск уншина.
    /// Цаг дээр суурилсан дугаар нь session хооронд ч ӨСӨХ дарааллаар (гаргалтын ЭХЭНД авсан дугаараас хойших
    /// өөрчлөлт БҮР түүнээс ИХ), диск хэрэггүй, хэдэн машин/session-д тоолуур мөргөлдөхгүй.
    ///
    /// `Mark()` — «одоо»-гийн хаалт: ЭНЭ мөчөөс өмнө бүртгэгдсэн бүх өөрчлөлт ≤ mark, дараахь бүр &gt; mark.
    /// </summary>
    public static class ImpactSeq
    {
        private static readonly object Gate = new object();
        private static long _last;

        private static long Clock()
        {
            return (long)(SmartClock.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds * 1024;
        }

        /// <summary>Шинэ өөрчлөлтөд дугаар өгнө (хатуу өсөх).</summary>
        public static long Next()
        {
            lock (Gate)
            {
                long c = Clock();
                _last = c > _last ? c : _last + 1;
                return _last;
            }
        }

        /// <summary>Одоогийн хаалт.  Үүний дараа `Next()` үргэлж ИХ утга буцаана.</summary>
        public static long Mark()
        {
            lock (Gate)
            {
                long c = Clock();
                _last = c > _last ? c : _last;
                return _last;
            }
        }

        /// <summary>Хадгалагдсан дугаарыг ирээдүйд (одооноос) хэдэн мс-ээр илүү гэж үзэхийг зөвшөөрөх (30 хоног).  Үүнээс цаашхи нь буруу өгөгдөл.</summary>
        internal const long MaxFutureMs = 30L * 24 * 3600 * 1000;

        /// <summary>
        /// Диск дээрээс (бүртгэл, шалгах цэг, тайлан, гаргалтын checkpoint) уншсан хамгийн ИХ дугаарыг ТЭМДЭГЛЭНЭ: хэрэв системийн цаг ухарсан
        /// (NTP, гараар засвар, виртуал машины сэргээлт) бол шинэ дугаар хуучин хадгалагдсан дугаараас БАГА гарч дараалал (watermark харьцуулалт)
        /// эвдэрнэ — тиймээс `Next()` хэзээ ч ажиглагдсан дээд дугаараас бага гарахгүй.  Бүтээгдээгүй/утгагүй (ирээдүйд `MaxFutureMs`-ээс хол) дугаарыг
        /// ТООЦОХГҮЙ — эвдэрсэн утга дугаарлалтыг үүрд урагшлуулж болохгүй.  Буцаах: тэмдэглэсэн эсэх.
        /// </summary>
        public static bool Observe(long maxSeen)
        {
            if (maxSeen <= 0) return false;
            lock (Gate)
            {
                if (maxSeen > Clock() + MaxFutureMs * 1024) return false;
                if (maxSeen > _last) _last = maxSeen;
                return true;
            }
        }

        /// <summary>Тестэд л.</summary>
        internal static void ResetForTests()
        {
            lock (Gate) { _last = 0; }
        }

        /// <summary>Дугаарын ОЙЛГОМЖТОЙ цаг (UI-д).</summary>
        public static DateTime ToUtc(long seq)
        {
            double ms = seq / 1024.0;
            try { return new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddMilliseconds(ms); }
            catch (ArgumentOutOfRangeException) { return DateTime.MinValue; }
        }
    }

    /// <summary>Нэг өөрчлөгдсөн элементийн ХУУЛСАН тайлбар (устсан ч харагдахын тулд).</summary>
    public sealed class ChangeEntry
    {
        public long Id { get; set; }
        public ChangeKind Kind { get; set; }
        public string Uid { get; set; }
        public string Category { get; set; }
        public long CategoryId { get; set; }
        public string Name { get; set; }
        public ImpactNodeKind NodeKind { get; set; }
        public long OwnerViewId { get; set; }
        public long HostId { get; set; }
        public long TypeId { get; set; }
        public long LevelId { get; set; }
        /// <summary>Идентити (UniqueId, ангилал) уншигдсан.  false = устсан/уншигдаагүй — «мэдээлэл алга».</summary>
        public bool Known { get; set; }
    }

    /// <summary>Нэг `DocumentChanged` (нэг транзакцийн) өөрчлөлтийн багц.</summary>
    public sealed class ChangeBatch
    {
        public long Seq { get; set; }
        public DateTime Utc { get; set; }
        public List<string> Transactions { get; set; } = new List<string>();
        /// <summary>`TransactionCommitted` / `TransactionUndone` / `TransactionRedone` ...</summary>
        public string Operation { get; set; }
        public int Added { get; set; }
        public int Modified { get; set; }
        public int Deleted { get; set; }
        /// <summary>Хэт олон өөрчлөлт — зөвхөн эхний хэсгийг бүртгэсэн (тоо нь бүтнийх).</summary>
        public bool Truncated { get; set; }
        /// <summary>Идентити (элементийн тайлбар) уншигдсан.</summary>
        public bool Resolved { get; set; }
        public List<ChangeEntry> Entries { get; set; } = new List<ChangeEntry>();

        public int Total { get { return Added + Modified + Deleted; } }
    }

    public sealed class ChangeLogFile
    {
        public List<ChangeBatch> Batches { get; set; } = new List<ChangeBatch>();
        /// <summary>Бүртгэгдээгүй (хэт олон/дараалал дүүрсэн) багцын тоо — мэдээлэл (нийлбэр, хэзээ ч буурахгүй).</summary>
        public int DroppedBatches { get; set; }
        /// <summary>
        /// ЦООРХОЙН хаалт: энэ дугаараас ӨМНӨХ (≤) өөрчлөлтүүдийн ЗАРИМ нь бүртгэлд ОРООГҮЙ байж болно — хасагдсан (trim),
        /// цэвэрлэсэн, дараалал дүүрч хаясан, handler алдсан.  Шинжилгээ `FromSeq`-ээс ХОЙШХИ мужид энэ хаалт орвол (`&gt; FromSeq`)
        /// «бүрэн БИШ» гэж тэмдэглэгдэнэ.  0 = цоорхойгүй.
        /// </summary>
        public long LostThroughSeq { get; set; }

        /// <summary>
        /// Энэ файлыг сүүлд бичсэн Revit процессийн id (`ChangeLogStore.ProcessSessionId`).  `CleanClose = false` үед л утга бүхий.
        /// </summary>
        public string SessionId { get; set; }

        /// <summary>
        /// Баримтыг тэр session ЦЭВЭРХЭН хаасан (хаалтын үеийн сүүлчийн хадгалалт амжилттай).  Session нээлттэй байхад `false` — Revit гэнэт
        /// унавал (хадгалагдаагүй сүүлийн ≤ 20 сек-ийн өөрчлөлт алдагдана) файл `false` хэвээр үлдэж, дараагийн session үүнийг цоорхой гэж ИЛ
        /// тэмдэглэнэ.  Хуучин файл (талбаргүй) = `true` (нотолгоо байхгүй).
        /// </summary>
        public bool CleanClose { get; set; } = true;
    }

    /// <summary>
    /// Өөрчлөлтийн бүртгэлийн ХЯЗГААРЛАЛТ + хадгалалт.  Файл бүрт нэг JSON (`DocStore` гэрээ).
    /// Хязгаар хэтрэхэд ХАМГИЙН ХУУЧИН багцыг хасна (түүх үргэлж хязгаартай).
    /// </summary>
    public static class ChangeLogStore
    {
        public const int Schema = 1;
        public const int MaxBatches = 400;
        public const int MaxEntries = 80000;
        public const int MaxEntriesPerBatch = 5000;
        public const string FileName = "impact-changes.json";

        private static readonly DocStore<ChangeLogFile> Store =
            new DocStore<ChangeLogFile>(FileName, Schema, () => new ChangeLogFile(), indented: false);

        public static ChangeLogFile Load(DocumentKey key)
        {
            LoadStatus status;
            return Load(key, out status);
        }

        /// <summary>
        /// `Unreadable` статус = файл БАЙГАА ч түгжигдсэн — буцаасан хоосон утгыг дуудагч «түүх алга» гэж ҮЗЭЖ, дараа нь диск рүү
        /// БИЧИЖ БОЛОХГҮЙ (SmartStore ч татгалзана).
        /// </summary>
        public static ChangeLogFile Load(DocumentKey key, out LoadStatus status)
        {
            LoadResult<ChangeLogFile> r = Store.Load(key);
            status = r.Status;
            ChangeLogFile f = r.Value ?? new ChangeLogFile();
            if (f.Batches == null) f.Batches = new List<ChangeBatch>();
            foreach (ChangeBatch b in f.Batches) Normalize(b);
            // Диск дээрх хамгийн ИХ дугаарыг тэмдэглэнэ — системийн цаг ухарсан ч шинэ дугаар хуучнаас бага гарахгүй (`ImpactSeq.Observe`).
            if (status == LoadStatus.Ok || status == LoadStatus.Migrated)
                ImpactSeq.Observe(Math.Max(f.LostThroughSeq, f.Batches.Count == 0 ? 0 : f.Batches.Max(b => b.Seq)));
            return f;
        }

        public static bool Save(DocumentKey key, ChangeLogFile f, out string error)
        {
            Trim(f);
            return Store.Save(key, f, out error);
        }

        /// <summary>Энэ Revit процессийн нэг удаагийн id — файлыг аль session сүүлд бичсэнийг тэмдэглэхэд.</summary>
        public static readonly string ProcessSessionId = Guid.NewGuid().ToString("N").Substring(0, 12);

        /// <summary>
        /// Файлыг ӨӨР session нээлттэй байхад (`CleanClose = false`) үлдээсэн үү — өөрөөр хэлбэл тэр session цэвэрхэн хаагдалгүй унасан эсвэл ОДОО
        /// өөр Revit-д нээлттэй.  Хоёр тохиолдолд ч хадгалагдаагүй/давхцсан өөрчлөлт байж болно → дараагийн session цоорхой гэж ИЛ тэмдэглэнэ.
        /// Өөрийн session-ийн (`SessionId` ижил) нээлттэй тэмдэг нь цоорхой БИШ.
        /// </summary>
        public static bool PriorSessionEndedUncleanly(ChangeLogFile f, string mySessionId)
        {
            if (f == null || f.CleanClose) return false;
            return !string.IsNullOrEmpty(f.SessionId) && !string.Equals(f.SessionId, mySessionId, StringComparison.Ordinal);
        }

        /// <summary>
        /// Диск дээрх бүртгэлийн файлын «хурууны хээ» (`урт:сүүлд өөрчилсөн`).  Файл БИДНИЙ сүүлд бичсэн/уншсанаас хойш өөрчлөгдсөн (өөр Revit
        /// session ижил баримтыг нээсэн) эсэхийг шалгана.  Файл байхгүй/хадгалагдах боломжгүй түлхүүр = null.
        /// </summary>
        public static string DiskStamp(DocumentKey key)
        {
            try
            {
                if (key == null || !key.Persistable) return null;
                var fi = new System.IO.FileInfo(SmartStore.Default.FullPath(SmartPaths.DocFile(key, FileName)));
                if (!fi.Exists) return null;
                return fi.Length + ":" + fi.LastWriteTimeUtc.Ticks;
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// Энэ баримтын бүртгэлийн файл «уншигдахгүй» гэж тэмдэглэгдсэн үү (`SmartStore`: түгжигдсэн, эсвэл эвдэрсэн файлыг `.corrupt-*` руу нүүлгэж ЧАДААГҮЙ).
        /// Тийм бол `Save` БҮГД татгалзана — дуудагч үүнийг «ачаалагдсан» гэж үзэлгүй back-off-оор дахин оролдох ёстой.  Алдаа = false (тэмдэглэгээ байхгүй).
        /// </summary>
        public static bool IsMarkedUnreadable(DocumentKey key)
        {
            try
            {
                if (key == null || !key.Persistable) return false;
                return SmartStore.Default.IsMarkedUnreadable(SmartPaths.DocFile(key, FileName));
            }
            catch (Exception)
            {
                return false;
            }
        }

        /// <summary>
        /// Багц/мөрийн нийт тоог хязгаарлана — хамгийн хуучныг эхэлж хасна; хасагдсан хамгийн ШИНЭ дугаарыг `lostThroughSeq`-д
        /// тэмдэглэнэ (ЦООРХОЙ чимээгүй үлдэхгүй).  Хэдэн багц хасснаа буцаана.  Санах ойн болон диск дэх бүртгэл ЯГ ИЖИЛ функцээр.
        /// </summary>
        public static int TrimBatches(List<ChangeBatch> batches, ref long lostThroughSeq)
        {
            batches.Sort((a, b) => a.Seq.CompareTo(b.Seq));
            int removed = 0;
            while (batches.Count > MaxBatches)
            {
                lostThroughSeq = Math.Max(lostThroughSeq, batches[0].Seq);
                batches.RemoveAt(0);
                removed++;
            }
            int total = 0;
            foreach (ChangeBatch b in batches) total += b.Entries != null ? b.Entries.Count : 0;
            while (total > MaxEntries && batches.Count > 1)
            {
                total -= batches[0].Entries != null ? batches[0].Entries.Count : 0;
                lostThroughSeq = Math.Max(lostThroughSeq, batches[0].Seq);
                batches.RemoveAt(0);
                removed++;
            }
            return removed;
        }

        public static void Normalize(ChangeBatch b)
        {
            if (b.Transactions == null) b.Transactions = new List<string>();
            if (b.Entries == null) b.Entries = new List<ChangeEntry>();
        }

        /// <summary>Багц/мөрийн нийт тоог хязгаарлана — хамгийн хуучныг эхэлж хасна.  Дугаараар эрэмбэлнэ.</summary>
        public static void Trim(ChangeLogFile f)
        {
            f.Batches = f.Batches.OrderBy(b => b.Seq).ToList();
            long lost = f.LostThroughSeq;
            TrimBatches(f.Batches, ref lost);
            f.LostThroughSeq = lost;
        }
    }

    /// <summary>
    /// Загварын «шалгах цэг» — хэрэглэгч (эсвэл гаргалт) «одоогийн байдлыг баталсан» гэж тэмдэглэнэ; дараа нь
    /// «ЭНЭ ЦЭГЭЭС ХОЙШ юу өөрчлөгдсөн бэ» гэж асууна.
    ///
    /// ⚠️ `VersionGuid` (Revit-ийн DocumentVersion) нь НЭМЭЛТ нотолгоо л: Revit өөрөө «GUID нь өөрчлөлт бүрд заавал
    /// шинэчлэгдэхгүй» гэж баримтжуулсан тул `GetChangedElements` нь зөвхөн-засвар (modification) өөрчлөлтийг
    /// алгасаж болзошгүй.  Үндсэн хаалт нь `ChangeSeq` (манай бүртгэл).
    /// </summary>
    public sealed class ModelCheckpoint
    {
        public string Id { get; set; } = SmartHash.NewId();
        public DateTime Utc { get; set; }
        public string Label { get; set; }
        /// <summary>`user` | `publish`.</summary>
        public string Kind { get; set; }
        public long ChangeSeq { get; set; }
        public string VersionGuid { get; set; }
        public int NumberOfSaves { get; set; }
    }

    public sealed class CheckpointsFile
    {
        public List<ModelCheckpoint> Items { get; set; } = new List<ModelCheckpoint>();
    }

    public static class CheckpointStore
    {
        public const int Schema = 1;
        public const int MaxItems = 120;

        private static readonly DocStore<CheckpointsFile> Store =
            new DocStore<CheckpointsFile>("impact-checkpoints.json", Schema, () => new CheckpointsFile());

        public static CheckpointsFile Load(DocumentKey key)
        {
            LoadStatus status;
            return Load(key, out status);
        }

        /// <summary>
        /// `Unreadable`/`NewerSchema` статус = файл БАЙГАА ч уншигдсангүй/шинэ хувилбарынх — буцаасан хоосон жагсаалтыг «шалгах цэг алга» гэж ҮЗЭЖ
        /// БОЛОХГҮЙ (дуудагч статусыг шалгана).
        /// </summary>
        public static CheckpointsFile Load(DocumentKey key, out LoadStatus status)
        {
            LoadResult<CheckpointsFile> r = Store.Load(key);
            status = r.Status;
            CheckpointsFile f = r.Value ?? new CheckpointsFile();
            if (f.Items == null) f.Items = new List<ModelCheckpoint>();
            if (status == LoadStatus.Ok || status == LoadStatus.Migrated)
                ImpactSeq.Observe(f.Items.Count == 0 ? 0 : f.Items.Max(i => i.ChangeSeq));
            return f;
        }

        public static bool Save(DocumentKey key, CheckpointsFile f, out string error)
        {
            f.Items = f.Items.OrderByDescending(i => i.Utc).Take(MaxItems).ToList();
            return Store.Save(key, f, out error);
        }

        /// <summary>Шинэ шалгах цэг нэмнэ (нэгэн зэрэг уншиж-бичих түгжээтэй).</summary>
        private static readonly object Gate = new object();

        private static string Unreadable(LoadStatus s)
        {
            return s == LoadStatus.NewerSchema
                ? "шалгах цэгийн файл шинэ хувилбарын add-in-ийнх тул өөрчилж болохгүй"
                : "шалгах цэгийн файл уншигдсангүй (түгжигдсэн?) — одоо байгаа цэгүүдийг дарж бичихгүйн тулд хадгалахаас татгалзав";
        }

        public static bool Add(DocumentKey key, ModelCheckpoint cp, out string error)
        {
            lock (Gate)
            {
                LoadStatus status;
                CheckpointsFile f = Load(key, out status);
                if (status == LoadStatus.Unreadable || status == LoadStatus.NewerSchema) { error = Unreadable(status); return false; }
                f.Items.Add(cp);
                return Save(key, f, out error);
            }
        }

        /// <summary>
        /// Шалгах цэгийг устгана — `Add`-тай ИЖИЛ түгжээнд (шинэ цэг нэмэх үед устгал нь түүнийг дарж бичихээс сэргийлнэ).
        /// `removed` = ийм id-тай цэг байсан эсэх; буцаах утга = хадгалалт амжилттай эсэх (цэг байгаагүй бол юу ч бичихгүй).
        /// ⚠️ Файл уншигдаагүй үед «цэг байгаагүй, амжилттай» гэж ХУДАЛ хэлэхгүй — алдаа буцаана (хэрэглэгч устгасан гэж үзэхгүй).
        /// </summary>
        public static bool Remove(DocumentKey key, string id, out bool removed, out string error)
        {
            lock (Gate)
            {
                LoadStatus status;
                CheckpointsFile f = Load(key, out status);
                removed = false;
                if (status == LoadStatus.Unreadable || status == LoadStatus.NewerSchema) { error = Unreadable(status); return false; }
                removed = f.Items.RemoveAll(i => i.Id == id) > 0;
                if (!removed) { error = null; return true; }
                return Save(key, f, out error);
            }
        }
    }

    /// <summary>Сүүлийн тайлан + өмнөх шинжилгээний товч жагсаалт (түүх).</summary>
    public sealed class ImpactReportHeader
    {
        public string Id { get; set; }
        public DateTime Utc { get; set; }
        public long FromSeq { get; set; }
        public long ToSeq { get; set; }
        public int SourceCount { get; set; }
        public int Sheets { get; set; }
        public int DirectCount { get; set; }
        public int TotalItems { get; set; }
        public RunStatus Status { get; set; }
        public bool Incomplete { get; set; }
    }

    public sealed class ImpactReportFile
    {
        public ImpactReport Last { get; set; }
        public List<ImpactReportHeader> History { get; set; } = new List<ImpactReportHeader>();
    }

    public static class ImpactReportStore
    {
        public const int Schema = 1;
        public const int MaxHistory = 40;
        public const int MaxItems = 6000;

        private static readonly DocStore<ImpactReportFile> Store =
            new DocStore<ImpactReportFile>("impact-report.json", Schema, () => new ImpactReportFile(), indented: false);

        public static ImpactReportFile Load(DocumentKey key)
        {
            LoadResult<ImpactReportFile> r = Store.Load(key);
            ImpactReportFile f = r.Value ?? new ImpactReportFile();
            if (f.History == null) f.History = new List<ImpactReportHeader>();
            if (f.Last != null && f.Last.Items == null) f.Last.Items = new List<ImpactItem>();
            if ((r.Status == LoadStatus.Ok || r.Status == LoadStatus.Migrated) && f.Last != null)
                ImpactSeq.Observe(Math.Max(f.Last.ToSeq, f.History.Count == 0 ? 0 : f.History.Max(h => h.ToSeq)));
            return f;
        }

        public static ImpactReportHeader HeaderOf(ImpactReport r)
        {
            return new ImpactReportHeader
            {
                Id = r.Id, Utc = r.Utc, FromSeq = r.FromSeq, ToSeq = r.ToSeq, SourceCount = r.SourceCount,
                Sheets = r.Items.Count(i => i.Kind == ImpactNodeKind.Sheet),
                DirectCount = r.Items.Count(i => i.Confidence == ImpactConfidence.A),
                TotalItems = r.Items.Count, Status = r.Status, Incomplete = r.Incomplete,
            };
        }

        public static bool Save(DocumentKey key, ImpactReport report, out string error)
        {
            ImpactReportFile f = Load(key);
            ImpactReport stored = report;
            if (report.Items.Count > MaxItems)
            {
                // Хэт том тайланг хүчтэй (A, B) ба хуудсуудыг эхэлж үлдээн таслана; ИЛ тэмдэглэнэ.
                stored = new ImpactReport
                {
                    Id = report.Id, Utc = report.Utc, FromSeq = report.FromSeq, ToSeq = report.ToSeq, Status = report.Status,
                    SourceCount = report.SourceCount, Added = report.Added, Modified = report.Modified, Deleted = report.Deleted,
                    Notes = new List<string>(report.Notes), StageMs = report.StageMs, ModelStamp = report.ModelStamp,
                    HasGlobalChange = report.HasGlobalChange, Incomplete = true,
                    IncompleteReasons = new List<string>(report.IncompleteReasons ?? new List<string>()),
                    LogGap = report.LogGap, TruncatedBatches = report.TruncatedBatches, DeletedUnderivable = report.DeletedUnderivable,
                    BaselineUsed = report.BaselineUsed, BaselineFailed = report.BaselineFailed,
                    UnresolvedDeleted = report.UnresolvedDeleted, DroppedBatches = report.DroppedBatches,
                    Items = report.Items.OrderBy(i => i.Kind == ImpactNodeKind.Sheet ? 0 : 1).ThenBy(i => ImpactConf.Rank(i.Confidence)).Take(MaxItems).ToList(),
                };
                stored.Notes.Add("Хадгалахдаа хэт том тайланг " + MaxItems + " мөрөөр таслав.");
                stored.IncompleteReasons.Add("Хадгалсан тайлан хэт том тул " + MaxItems + " мөрөөр таслагдсан.");
            }
            f.Last = stored;
            f.History.Insert(0, HeaderOf(report));
            if (f.History.Count > MaxHistory) f.History = f.History.Take(MaxHistory).ToList();
            return Store.Save(key, f, out error);
        }
    }
}
