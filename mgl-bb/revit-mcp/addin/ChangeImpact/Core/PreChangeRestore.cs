using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.ChangeImpact.Core
{
    /// <summary>
    /// Sandbox-ийн rollback-ийн ДАРАА загвар анхны төлөвтөө буцсаныг батлах ЗОРИУЛАЛТТАЙ (targeted) хурууны хээ — Revit-гүй ЦЭВЭР.
    ///
    /// ⚠️ Өмнө нь бүх загварын (non-type) элементийг ХОЁР УДАА тоолдог байв: том төсөл дээр үнэтэй, мөн бүх загвар ижил гэдгийг МАТЕМАТИКААР
    /// БАТЛАХГҮЙ (нэг устгаад нэг нэмсэн нь тоог тэнцүү үлдээнэ).  Одоо симуляцийн үеэр БОДИТООР хөндөгдсөн зүйлийг шалгана:
    ///   • эх хананы байрлал, төрөл;  хост (хаалга/цонх) ба холбогдсон хөрш ханын байрлал;
    ///   • симуляцийн `DocumentChanged`-ээр мэдэгдсэн ШИНЭЭР нэмэгдсэн id-ууд буцаалтын дараа ОЛДОХГҮЙ, УСТСАН id-ууд буцаалтын дараа БАЙХ ёстой;
    ///   • нээлттэй транзакц үлдээгүй;
    ///   • (STRICT горимд л) бүх элементийн тоо.
    /// Fail-closed: уншиж чадаагүй зүйл «буцсан» гэж тооцогдохгүй.
    /// </summary>
    public sealed class RestoreProbe
    {
        public bool WallExists { get; set; }
        public double[] WallLocation { get; set; }
        public long WallTypeId { get; set; }
        /// <summary>Хост ба холбогдсон хөршүүдийн байрлал (мм).  Утга null = байрлалгүй (хэвээр байхыг л шалгана).</summary>
        public Dictionary<long, double[]> Others { get; set; } = new Dictionary<long, double[]>();
        /// <summary>Хөндөгдөх элементүүд (<see cref="Others"/>) одоо ч байгаа эсэх.</summary>
        public HashSet<long> OthersPresent { get; set; } = new HashSet<long>();
        public string Stamp { get; set; }
        /// <summary>STRICT горимд л: загварын бүх (non-type) элементийн тоо.</summary>
        public long? ElementCount { get; set; }
        public bool DocumentModifiable { get; set; }
        /// <summary>Симуляцийн явцад ШИНЭЭР нэмэгдсэн id-уудаас буцаалтын дараа ХЭВЭЭР байгаа нь (0 байх ёстой).  AFTER probe-д л.</summary>
        public int AddedStillPresent { get; set; }
        /// <summary>Симуляцийн явцад УСТСАН id-уудаас буцаалтын дараа ХАРААХАН алга байгаа нь (0 байх ёстой).  AFTER probe-д л.</summary>
        public int DeletedStillMissing { get; set; }
        public bool Readable { get; set; } = true;
    }

    public sealed class RestoreResult
    {
        public bool Restored { get { return Problems.Count == 0; } }
        public List<string> Problems { get; set; } = new List<string>();
        public List<string> Notes { get; set; } = new List<string>();
    }

    public static class PreChangeRestoreCheck
    {
        public static RestoreResult Compare(RestoreProbe before, RestoreProbe after)
        {
            var r = new RestoreResult();
            if (before == null || after == null || !before.Readable || !after.Readable)
            {
                r.Problems.Add("Буцаалтыг шалгах хурууны хээ бүрэн уншигдсангүй.");
                return r;
            }

            if (!after.WallExists) { r.Problems.Add("Хана буцаалтын дараа олдсонгүй."); return r; }
            if (!SameLoc(before.WallLocation, after.WallLocation)) r.Problems.Add("Хананы байрлал анхныхаасаа өөр байна.");
            if (before.WallTypeId != after.WallTypeId) r.Problems.Add("Хананы төрөл анхныхаасаа өөр байна.");

            int moved = 0, missing = 0;
            foreach (long id in before.Others.Keys)
            {
                if (!after.OthersPresent.Contains(id)) { missing++; continue; }
                double[] b = before.Others[id], a;
                if (!after.Others.TryGetValue(id, out a)) { missing++; continue; }
                if (b != null && !SameLoc(b, a)) moved++;
            }
            if (missing > 0) r.Problems.Add(missing + " хаалга/цонх/холбогдсон хана буцаалтын дараа олдсонгүй.");
            if (moved > 0) r.Problems.Add(moved + " хаалга/цонх/холбогдсон ханын байрлал анхныхаасаа өөр байна.");

            if (after.AddedStillPresent > 0) r.Problems.Add("Симуляцийн үед нэмэгдсэн " + after.AddedStillPresent + " элемент буцаалтын дараа үлдсэн.");
            if (after.DeletedStillMissing > 0) r.Problems.Add("Симуляцийн үед устсан " + after.DeletedStillMissing + " элемент буцаалтын дараа сэргээгдсэнгүй.");
            if (after.DocumentModifiable) r.Problems.Add("Нээлттэй транзакц үлдсэн байна.");

            if (before.ElementCount.HasValue && after.ElementCount.HasValue && before.ElementCount.Value != after.ElementCount.Value)
                r.Problems.Add("Загварын элементийн тоо буцаалтын дараа өөрчлөгдсөн (" + before.ElementCount + " → " + after.ElementCount + ").");

            if (!string.Equals(before.Stamp, after.Stamp, StringComparison.Ordinal))
                r.Notes.Add("Preview-ийн явцад загварын өөрчлөлтийн тоолуур өөрчлөгдсөн — Apply хийхэд preview дахин шалгагдана.");
            return r;
        }

        /// <summary>
        /// ХОЁР дамжлагатай preview-ийн (Quick, Deep) commit-ийн дараах settled байрлалууд ижил эсэх.  Хоёр удаа ИЖИЛ хөдөлгөөнийг турших тул ижил байх ёстой —
        /// зөрвөл (загварт нөхцөл өөрчлөгдсөн/тогтворгүй) хоёр дамжлагын дүнг нэг тайланд нийлүүлэх нь худал: ШААРДЛАГАТАЙ дутагдал.
        /// Хоосон жагсаалт = ижил.
        /// </summary>
        public static List<string> SettledDifferences(RestoreProbe a, RestoreProbe b)
        {
            var d = new List<string>();
            if (a == null || b == null || !a.Readable || !b.Readable) { d.Add("Хоёр дамжлагын settled төлвийг тулгаж чадсангүй."); return d; }
            if (!SameLoc(a.WallLocation, b.WallLocation, PreChangeTolerance.VerifyLengthMm)) d.Add("Хананы settled байрлал хоёр дамжлагад зөрсөн.");
            int diff = 0;
            foreach (long id in a.Others.Keys)
            {
                double[] y;
                if (!b.Others.TryGetValue(id, out y)) { diff++; continue; }
                if (a.Others[id] != null && !SameLoc(a.Others[id], y, PreChangeTolerance.VerifyLengthMm)) diff++;
            }
            if (diff > 0) d.Add(diff + " хаалга/цонх/холбогдсон ханын settled байрлал хоёр дамжлагад зөрсөн.");
            return d;
        }

        private static bool SameLoc(double[] a, double[] b)
        {
            return SameLoc(a, b, PreChangeTolerance.LengthMm);
        }

        private static bool SameLoc(double[] a, double[] b, double tol)
        {
            if (a == null || b == null) return a == null && b == null;
            if (a.Length != b.Length) return false;
            for (int i = 0; i < a.Length; i++)
                if (Math.Abs(a[i] - b[i]) > tol) return false;
            return true;
        }
    }

    /// <summary>
    /// ХОЁР дамжлагатай preview-ийн (Quick = өрөө/хэмжээс/хаалга/хөрш хана; Deep = хүснэгт/MEP/гарц/орчны зай) хэсэгчилсэн snapshot-уудыг нэгтгэнэ.
    /// Apply нь БҮТЭН snapshot-той тулгадаг тул нэгтгэсэн нь нэг дамжлагатай уншилттай ИЖИЛ хэлбэртэй байх ёстой.
    /// </summary>
    public static class PreChangeSnapshots
    {
        /// <summary>
        /// ШИНЭ snapshot буцаана — `core`/`deep` аль нь ч МУТАЦИ хийгдэхгүй (түр дүнгийн тайлан `core`-ыг хэвээр барьж байдаг; memo-той хуваалцсан обьект өөрчлөгдөх ЁСГҮЙ).
        /// Хаалганы орчны зайг `HostedSnap`-ийн ХУУЛБАР дээр нэгтгэнэ.
        /// </summary>
        public static StateSnapshot Merge(StateSnapshot core, StateSnapshot deep)
        {
            if (core == null) return deep;
            if (deep == null) return core;
            var m = new StateSnapshot
            {
                Source = core.Source, SourceDeleted = core.SourceDeleted,
                Rooms = core.Rooms, Dimensions = core.Dimensions, Joined = core.Joined,
                Schedules = deep.Schedules, Clash = deep.Clash, Egress = deep.Egress,
                ModifiedCount = Math.Max(core.ModifiedCount, deep.ModifiedCount),
                Captured = core.Captured && deep.Captured,
            };
            foreach (KeyValuePair<long, HostedSnap> kv in core.Hosted)
            {
                HostedSnap h = BeforeMemo.CloneHosted(kv.Value);
                HostedSnap d;
                if (deep.Hosted.TryGetValue(kv.Key, out d))
                {
                    h.ClearanceMm = d.ClearanceMm;
                    h.ClearanceEvaluated = d.ClearanceEvaluated;
                    h.ClearanceNote = d.ClearanceNote;
                }
                m.Hosted[kv.Key] = h;
            }
            m.IncompleteReasons = core.IncompleteReasons.Concat(deep.IncompleteReasons).Distinct(StringComparer.Ordinal).ToList();
            m.AdvisoryReasons = core.AdvisoryReasons.Concat(deep.AdvisoryReasons).Distinct(StringComparer.Ordinal).ToList();
            m.CaptureNotes = core.CaptureNotes.Concat(deep.CaptureNotes).Distinct(StringComparer.Ordinal).ToList();
            m.DeletedIds = core.DeletedIds.Concat(deep.DeletedIds).Distinct().ToList();
            return m;
        }
    }

    public static class PreChangeDependenciesExtensions
    {
        /// <summary>
        /// Кэшлэгдсэн хамаарлыг ХУУЛАХ — `AddNewlyVisible` нь (зайнаас хамаарах) шинэ харагдац нэмж мутаци хийдэг тул кэшийн эх нь хэзээ ч өөрчлөгдөхгүй.
        /// `DepNode` нь бичигдсэний дараа өөрчлөгддөггүй гэж үзнэ (жагсаалтууд хуулагдана).
        /// </summary>
        public static PreChangeDependencies Clone(this PreChangeDependencies d)
        {
            if (d == null) return null;
            return new PreChangeDependencies
            {
                Views = d.Views.ToList(), Sheets = d.Sheets.ToList(), Schedules = d.Schedules.ToList(), Tags = d.Tags.ToList(),
                DimensionIds = d.DimensionIds.ToList(), IncompleteReasons = d.IncompleteReasons.ToList(), AdvisoryReasons = d.AdvisoryReasons.ToList(),
                Notes = d.Notes.ToList(), VisibilityChecked = d.VisibilityChecked, AfterVisibilityChecked = d.AfterVisibilityChecked,
            };
        }
    }
}
