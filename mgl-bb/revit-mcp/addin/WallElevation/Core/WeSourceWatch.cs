using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>Ажил явж байх үед НЭМЭГДСЭН загварын элемент (Revit-ээс хямд уншсан) — <see cref="WeSourceWatch.Why"/>-д.</summary>
    public sealed class WeAddedElement
    {
        public long Id;
        /// <summary>Revit-ийн ангиллын нэр (тайлбарт).</summary>
        public string Category;
        public bool HasBox;
        public WeV3 Min;
        public WeV3 Max;
    }

    /// <summary>
    /// W01 (2026-10-16): арын горимын ажил загвараас ЮУ уншсан бэ — сонгосон өрөө, хил/сонгосон хана, шал/тааз, хаалга/цонх, түвшин,
    /// тэмдэглэгээний элемент, холбосон загвар (link).  Ажил явж байх хооронд хэрэглэгч ЭДГЭЭРИЙН аль нэгийг өөрчилбөл (эсвэл өрөөнд шинэ
    /// элемент нэмбэл) төлөвлөгөө ХУУЧИРСАН — <see cref="Why"/> шалтгааныг хэлнэ, ажил дараагийн алхмын ӨМНӨ дахин уншиж төлөвлөнө
    /// (хуучирсан геометрээр дуусгахгүй).  Бусад газрын загварчлал (өөр өрөө, өөр давхар) ажлыг ХӨНДӨХГҮЙ.
    ///
    /// Revit-гүй (цөм) — Revit тал нь DocumentChanged-ийн id-г дамжуулна.  Link доторх элемент host-д өөрийн id-гүй тул link-ийн
    /// instance/type-ийг (<see cref="LinkIds"/>) хянана: зөөх, дахин ачаалах, буулгах нь бүгд тэр элементийн өөрчлөлт.
    /// </summary>
    public sealed class WeSourceWatch
    {
        /// <summary>Шинэ элементийг өрөөний хайрцагтай харьцуулах нөөц (мм) — хилийн хана, өнгөлгөө хайрцагнаас бага зэрэг гадна.</summary>
        public const double MarginMm = 300;
        /// <summary>Нэг өөрчлөлтөд ийм олон ШИНЭ загварын элемент бол (их хэмжээний хуулбар) нэг бүрчлэн шалгахгүй — хуучирсан гэж үзнэ.</summary>
        public const int MaxAddedChecked = 500;

        /// <summary>Host элементийн id → хүнд ойлгогдох нэр («өрөө «310 Хүлээлгийн танхим»», «хана «W12»»).</summary>
        public readonly Dictionary<long, string> Ids = new Dictionary<long, string>();
        /// <summary>Холбосон загварын instance ба type (host-ийн id) — link-ийн өрөө/хана ашигласан ажилд.</summary>
        public readonly HashSet<long> LinkIds = new HashSet<long>();
        /// <summary>Ажлын өрөө/хананы хайрцаг (host координат, фут).</summary>
        public readonly List<KeyValuePair<WeV3, WeV3>> Boxes = new List<KeyValuePair<WeV3, WeV3>>();
        /// <summary>Сонголтод холбосон загварын өрөө/хана бий (<see cref="LinkIds"/>-ийг Revit тал бөглөнө).</summary>
        public bool UsesLinks;
        /// <summary>Хайрцагны нөөц (фут).</summary>
        public double Margin;

        public bool IsEmpty { get { return Ids.Count == 0 && LinkIds.Count == 0 && Boxes.Count == 0; } }

        /// <summary>Төлөвлөгчийн оролтоос (Revit-гүй).  <paramref name="u"/> — мм → дотоод нэгж.</summary>
        public static WeSourceWatch From(WeRequest req, IWeUnits u)
        {
            var w = new WeSourceWatch { Margin = u != null ? u.MmToInternal(MarginMm) : MarginMm / 304.8 };
            if (req == null) return w;
            foreach (WeRoomInfo r in req.Rooms)
            {
                if (r == null) continue;
                if (IsLinkUid(r.UniqueId)) w.UsesLinks = true;
                if (r.Id > 0) w.Add(r.Id, "өрөө «" + Join(r.Number, r.Name) + "»");
                AddRoomBox(w, r);
            }
            foreach (WeWallInfo wall in req.Walls)
            {
                if (wall == null) continue;
                if (wall.IsLinked || IsLinkUid(wall.UniqueId)) w.UsesLinks = true;
                else if (wall.Id > 0) w.Add(wall.Id, WallLabel(wall));
                AddWallBox(w, wall, u);
            }
            foreach (WeWallInfo wall in req.WallLookup.Values)
            {
                if (wall == null) continue;
                if (wall.IsLinked || IsLinkUid(wall.UniqueId)) w.UsesLinks = true;
                else if (wall.Id > 0) w.Add(wall.Id, WallLabel(wall));
            }
            WeAnnoSources s = req.Sources ?? new WeAnnoSources();
            foreach (WeSlabInfo sl in s.Slabs) if (sl != null && sl.Id > 0) w.Add(sl.Id, (sl.Kind == WeSlabKind.Ceiling ? "тааз" : "шал") + " (id " + Id(sl.Id) + ")");
            foreach (WeInsertInfo ins in s.Inserts) if (ins != null && ins.Id > 0) w.Add(ins.Id, (ins.Kind == WeInsertKind.Door ? "хаалга" : "цонх") + " (id " + Id(ins.Id) + ")");
            foreach (WeLevelInfo l in s.Levels) if (l != null && l.Id > 0) w.Add(l.Id, "түвшин «" + (l.Name ?? Id(l.Id)) + "»");
            foreach (WeTaggable t in s.Taggables) if (t != null && t.Id > 0) w.Add(t.Id, TaggableLabel(t));
            // Overheads ЗОРИУД орохгүй: link-ийн шат/шал link-ийн өөрийн id-тай (host-ийн id-тай давхцаж худал «өөрчлөгдсөн» болно).
            return w;
        }

        /// <summary>
        /// Энэ өөрчлөлт төлөвлөгөөг хуучруулах уу — тийм бол шалтгаан («өрөө «310» өөрчлөгдсөн»), үгүй бол null.  Устгасан → өөрчилсөн →
        /// нэмсэн дарааллаар эхний шалтгаан.
        /// </summary>
        public string Why(ICollection<long> modified, ICollection<long> deleted, IList<WeAddedElement> added)
        {
            string label;
            if (deleted != null)
                foreach (long id in deleted)
                {
                    if (Ids.TryGetValue(id, out label)) return label + " устгагдсан";
                    if (LinkIds.Contains(id)) return "холбосон загвар (link) буулгагдсан";
                }
            if (modified != null)
                foreach (long id in modified)
                {
                    if (Ids.TryGetValue(id, out label)) return label + " өөрчлөгдсөн";
                    if (LinkIds.Contains(id)) return "холбосон загвар (link) өөрчлөгдсөн (зөөсөн эсвэл дахин ачаалсан)";
                }
            if (added != null && added.Count > 0 && Boxes.Count > 0)
            {
                if (added.Count > MaxAddedChecked) return added.Count.ToString(CultureInfo.InvariantCulture) + " шинэ элемент нэг дор нэмэгдсэн";
                foreach (WeAddedElement a in added)
                    if (a != null && a.HasBox && Touches(a.Min, a.Max))
                        return "шинэ " + (string.IsNullOrWhiteSpace(a.Category) ? "элемент" : a.Category) + " (id " + Id(a.Id) + ") ажлын өрөөнд нэмэгдсэн";
            }
            return null;
        }

        /// <summary>Хайрцаг ажлын өрөө/хананы хайрцагтай (нөөцтэй) огтлолцох уу.</summary>
        public bool Touches(WeV3 min, WeV3 max)
        {
            foreach (KeyValuePair<WeV3, WeV3> b in Boxes)
            {
                if (max.X < b.Key.X - Margin || min.X > b.Value.X + Margin) continue;
                if (max.Y < b.Key.Y - Margin || min.Y > b.Value.Y + Margin) continue;
                if (max.Z < b.Key.Z - Margin || min.Z > b.Value.Z + Margin) continue;
                return true;
            }
            return false;
        }

        private void Add(long id, string label)
        {
            // Эхний (илүү тодорхой) нэр үлдэнэ — хана өрөөний хил ба шошголох элемент хоёуланд байж болно.
            if (!Ids.ContainsKey(id)) Ids[id] = label;
        }

        private static void AddRoomBox(WeSourceWatch w, WeRoomInfo r)
        {
            bool any = false;
            double x0 = double.MaxValue, y0 = double.MaxValue, x1 = double.MinValue, y1 = double.MinValue;
            foreach (WeRoomLoop loop in r.Loops)
            {
                if (loop == null) continue;
                foreach (WeBoundarySegment seg in loop.Segments)
                {
                    if (seg == null) continue;
                    foreach (WeV3 p in new[] { seg.A, seg.B })
                    {
                        any = true;
                        x0 = Math.Min(x0, p.X); y0 = Math.Min(y0, p.Y);
                        x1 = Math.Max(x1, p.X); y1 = Math.Max(y1, p.Y);
                    }
                }
            }
            if (!any) return;
            double z0 = Math.Min(r.BottomZ, r.TopZ), z1 = Math.Max(r.BottomZ, r.TopZ);
            w.Boxes.Add(new KeyValuePair<WeV3, WeV3>(new WeV3(x0, y0, z0), new WeV3(x1, y1, z1)));
        }

        /// <summary>Хана горим: ханын шугам ± (зузаан + 1.5 м) — дэлгээсийн өмнөх орон зай (тэмдэглэгээний элемент).</summary>
        private static void AddWallBox(WeSourceWatch w, WeWallInfo wall, IWeUnits u)
        {
            double reach = Math.Max(0, wall.Width) + (u != null ? u.MmToInternal(1500) : 1500 / 304.8);
            double z0 = Math.Min(wall.BottomZ, wall.TopZ), z1 = Math.Max(wall.BottomZ, wall.TopZ);
            w.Boxes.Add(new KeyValuePair<WeV3, WeV3>(
                new WeV3(Math.Min(wall.Start.X, wall.End.X) - reach, Math.Min(wall.Start.Y, wall.End.Y) - reach, z0),
                new WeV3(Math.Max(wall.Start.X, wall.End.X) + reach, Math.Max(wall.Start.Y, wall.End.Y) + reach, z1)));
        }

        private static string WallLabel(WeWallInfo wall)
        {
            return string.IsNullOrWhiteSpace(wall.Mark) ? "хана (id " + Id(wall.Id) + ")" : "хана «" + wall.Mark.Trim() + "»";
        }

        private static string TaggableLabel(WeTaggable t)
        {
            WeAnno.Row row = WeAnno.Rows.FirstOrDefault(r => r.Key == t.CategoryKey);
            string what = row != null ? row.Label : "элемент";
            return what + " (id " + Id(t.Id) + ")";
        }

        /// <summary>Link-ийн өрөө/ханын түлхүүр («link|&lt;instance&gt;|&lt;элемент&gt;» — Revit талын <c>WeLinkRef.Prefix</c>-тэй ижил).</summary>
        private static bool IsLinkUid(string uid) { return uid != null && uid.StartsWith("link|", StringComparison.Ordinal); }

        private static string Join(string number, string name)
        {
            string a = (number ?? string.Empty).Trim(), b = (name ?? string.Empty).Trim();
            return a.Length == 0 ? b : b.Length == 0 ? a : a + " " + b;
        }

        private static string Id(long id) { return id.ToString(CultureInfo.InvariantCulture); }
    }

    /// <summary>
    /// W01: эх өгөгдөл өөрчлөгдөхөд арын ажлыг ДАХИН ТӨЛӨВЛӨХ дүрэм (цэвэр).  Дахин төлөвлөлт ≈ 0.5 с (загварт хүрэхгүй) тул автоматаар —
    /// харин хэрэглэгч тэр өрөөг тасралтгүй засаж байвал (<see cref="MaxAuto"/> удаа <see cref="WindowSeconds"/> секундэд) ажлыг ТҮР
    /// ЗОГСООНО: дуусаад «Үргэлжлүүлэх» дарахад нэг удаа дахин төлөвлөнө (Idling-ийг дэмий эргүүлэхгүй).
    /// </summary>
    public static class WeReplan
    {
        public const int MaxAuto = 5;
        public const double WindowSeconds = 60;

        /// <summary>Сүүлийн цонхонд хийсэн автомат дахин төлөвлөлтийн тоо ≥ <see cref="MaxAuto"/> → түр зогсоох.</summary>
        public static bool ShouldPause(IList<DateTime> recent, DateTime now)
        {
            if (recent == null) return false;
            int n = recent.Count(t => (now - t).TotalSeconds < WindowSeconds && t <= now);
            return n >= MaxAuto;
        }

        /// <summary>Цонхноос гадуурх хуучин тэмдэглэлийг хасна.</summary>
        public static void Prune(List<DateTime> recent, DateTime now)
        {
            if (recent == null) return;
            recent.RemoveAll(t => (now - t).TotalSeconds >= WindowSeconds || t > now);
        }

        /// <summary>
        /// Дахин төлөвлөсний дараах дэлгээсийн үр дүн: өмнөх хэсэгт ҮҮСГЭСЭН харагдац шинэ төлөвлөгөөнд «хэвээр»/«шинэчлэв» болдог —
        /// тайланд «үүсгэв» хэвээр (энэ ажил үүсгэсэн); өмнө нь «шинэчлэв» байсан нь «хэвээр» болохгүй.
        /// </summary>
        public static string MergeOutcome(string earlier, string now)
        {
            if (earlier == "Үүсгэв" && (now == "Хэвээр" || now == "Шинэчлэв")) return "Үүсгэв";
            if (earlier == "Шинэчлэв" && now == "Хэвээр") return "Шинэчлэв";
            return now;
        }

        /// <summary>
        /// Түлхүүр план / 3D-ийн «шинэчилсэн» тоо: өмнөх хэсэгт үүсгэсэн харагдацыг шинэ хэсэг дахин «шинэчилсэн» гэж тоолохгүй (ойролцоо —
        /// түлхүүрээр биш тоогоор).
        /// </summary>
        public static int MergeUpdated(int earlierCreated, int earlierUpdated, int nowUpdated)
        {
            return Math.Max(0, earlierUpdated) + Math.Max(0, nowUpdated - Math.Max(0, earlierCreated));
        }
    }

    /// <summary>W01: арын ажлын хамгийн урт алхмууд (хэмжилт — урт алхмыг бодит өгөгдлөөр олж засах).</summary>
    public sealed class WeSlowSteps
    {
        public const int Keep = 5;
        /// <summary>Ийм урт алхмыг даруй логт бичнэ (мс).</summary>
        public const long ReportMs = 1500;

        private readonly List<KeyValuePair<string, long>> _top = new List<KeyValuePair<string, long>>();

        public int Steps { get; private set; }
        public long TotalMs { get; private set; }
        public long MaxMs { get; private set; }

        public IList<KeyValuePair<string, long>> Top { get { return _top; } }

        /// <returns>true = даруй логт бичих урт алхам.</returns>
        public bool Add(string label, long ms)
        {
            Steps++;
            TotalMs += Math.Max(0, ms);
            MaxMs = Math.Max(MaxMs, ms);
            _top.Add(new KeyValuePair<string, long>(string.IsNullOrEmpty(label) ? "алхам" : label, ms));
            _top.Sort((a, b) => b.Value.CompareTo(a.Value));
            if (_top.Count > Keep) _top.RemoveRange(Keep, _top.Count - Keep);
            return ms >= ReportMs;
        }

        public override string ToString()
        {
            if (Steps == 0) return "алхам алга";
            return Steps.ToString(CultureInfo.InvariantCulture) + " алхам, дундаж " + (TotalMs / Steps).ToString(CultureInfo.InvariantCulture)
                   + " мс; хамгийн урт: " + string.Join("; ", _top.Select(kv => kv.Key + " " + kv.Value.ToString(CultureInfo.InvariantCulture) + " мс"));
        }
    }
}
