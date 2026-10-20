using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>Үр дүнгийн мөрийн төрөл.</summary>
    public enum WeResultKind
    {
        Elevation = 0,
        KeyPlan = 1,
        Axon = 2,
    }

    /// <summary>Мөрийн гол төлөв (W06) — эрэмбэ = ач холбогдол: алдаа › хуудасгүй › цэгцлэх › хэвийн.</summary>
    public enum WeResultState
    {
        Ok = 0,
        /// <summary>Хуудсан дээр боловч хүрээнээс гадуур эсвэл өөр зурагтай давхацсан — «байрлуулж цэгцлэх».</summary>
        Arrange = 1,
        /// <summary>Харагдац байгаа ч ямар ч хуудсанд байршаагүй.</summary>
        Unplaced = 2,
        /// <summary>Энэ ажиллагаанд үүссэнгүй / шалгалтад унасан (харагдацгүй).</summary>
        Failed = 3,
    }

    /// <summary>Энэ ажиллагааны өөрчлөлт (санах ойноос — Revit дахин асаасны дараа мэдэгдэхгүй тул None).</summary>
    public enum WeResultChange
    {
        None = 0,
        New = 1,
        Updated = 2,
    }

    /// <summary>
    /// Одоогийн баримтаас УНШСАН нэг үүсгэсэн харагдац: ES бичлэг (түлхүүр, өрөө) + БОДИТ байршил (viewport, хуудас — хэрэглэгч гараар зөөсөн
    /// хуудас ч).  Revit давхарга (<c>WeResultReader</c>) бөглөнө.
    /// </summary>
    public sealed class WeResultViewInfo
    {
        public WeResultKind Kind;
        public string Key;
        public string RoomUid;
        public long ViewId;
        public string ViewName;
        /// <summary>Viewport-ийн «Detail Number» (= дэлгээсийн тэмдэг «205A») — байршаагүй бол хоосон.</summary>
        public string DetailNumber;
        public long ViewportId;
        public long SheetId;
        public string SheetNumber;
        public string SheetName;
        /// <summary>Viewport хүрээний (title block) гадна.</summary>
        public bool OutOfFrame;
        /// <summary>Энэ хуудсан дээрх манай өөр viewport-той давхацсан.</summary>
        public bool Overlaps;
    }

    /// <summary>Сүүлийн ажиллагааны мөр (санах ойд) — шинэ / шинэчилсэн / алдаа.</summary>
    public sealed class WeResultRunInfo
    {
        public string Key;
        public string RoomUid;
        public string GroupLabel;
        public string Label;
        public WeResultChange Change;
        public bool Failed;
        public string Message;
    }

    public sealed class WeResultRow
    {
        public WeResultKind Kind;
        public string Key;
        public string Label;
        public string ViewName;
        public long ViewId;
        public long ViewportId;
        public long SheetId;
        public string SheetNumber;
        public string SheetName;
        public WeResultState State;
        public WeResultChange Change;
        public string Note;

        /// <summary>Мөрийн бичвэр: «205A  ·  WE-L02-205-A  →  A-301» (+ төлөв).</summary>
        public string Title
        {
            get
            {
                string what = Kind == WeResultKind.KeyPlan ? "Түлхүүр план" : Kind == WeResultKind.Axon ? "3D" : Label;
                var parts = new List<string>();
                if (!string.IsNullOrEmpty(what)) parts.Add(what);
                if (!string.IsNullOrEmpty(ViewName)) parts.Add(ViewName);
                if (State == WeResultState.Failed) parts.Add(Note != null && Note.StartsWith("Үүсгээгүй", StringComparison.Ordinal) ? "үүсгээгүй" : "алдаа");
                string head = parts.Count == 0 ? "–" : string.Join("  ·  ", parts);
                string where = State == WeResultState.Failed ? string.Empty
                    : SheetId != 0 ? "  →  " + (SheetNumber ?? "?") : "  →  хуудасгүй";
                string change = Change == WeResultChange.New ? "  · шинэ" : Change == WeResultChange.Updated ? "  · шинэчилсэн" : string.Empty;
                return head + where + change;
            }
        }
    }

    public sealed class WeResultRoom
    {
        public string RoomUid;
        public string Label;
        public List<WeResultRow> Rows = new List<WeResultRow>();
        /// <summary>Өрөөний зургууд байрласан хуудсууд (давхардалгүй, дугаараар).</summary>
        public List<KeyValuePair<long, string>> Sheets = new List<KeyValuePair<long, string>>();
        public bool Checked;

        public WeResultState Worst { get { return Rows.Count == 0 ? WeResultState.Ok : Rows.Max(r => r.State); } }

        public string Title
        {
            get
            {
                string sheets = Sheets.Count == 0 ? "хуудасгүй" : string.Join(", ", Sheets.Select(s => s.Value));
                return (Label ?? RoomUid ?? "?") + "   (" + sheets + ")" + (Checked ? "   · шалгасан" : string.Empty);
            }
        }
    }

    /// <summary>
    /// ҮР ДҮНГИЙН ИНДЕКС (W06, 2026-10-16): Өрөө → Дэлгээс → одоогийн Хуудас.  Үүсгэсэн харагдацын ТАНИЛТ (ES) + БОДИТ viewport-оос үргэлж дахин
    /// бүтээгдэнэ — хэрэглэгч зөөсөн, нэрийг сольсон, устгасан, хуудаснаас авсан, Revit дахин асаасан ч баримт өөрөө үнэн.  Сүүлийн ажиллагааны
    /// «шинэ/шинэчилсэн/алдаа» нь нэмэлт мэдээлэл (санах ойд), байхгүй бол харагдацын бодит төлөв л.
    /// </summary>
    public static class WeResultIndex
    {
        /// <summary>Хүрээний гадуур / давхцалын хүлцэл (цаасны фут ≈ 1 мм).</summary>
        public const double FitTol = 1.0 / 304.8;

        /// <param name="views">Баримтын бүх үүсгэсэн харагдац (бодит байршилтай).</param>
        /// <param name="run">Сүүлийн ажиллагааны мөрүүд (null = мэдэгдэхгүй).</param>
        /// <param name="roomLabel">Өрөөний UniqueId → нэр («Өрөө 205 — Гал тогоо (L02)»); null бол сүүлийн ажиллагааны бүлгийн нэр эсвэл UniqueId.</param>
        /// <param name="onlyRooms">Зөвхөн эдгээр өрөө (null = бүгд) — нэг ажлын өрөөнүүд.</param>
        public static List<WeResultRoom> Build(IEnumerable<WeResultViewInfo> views, IEnumerable<WeResultRunInfo> run,
                                              Func<string, string> roomLabel = null, ICollection<string> onlyRooms = null)
        {
            List<WeResultViewInfo> vs = (views ?? Enumerable.Empty<WeResultViewInfo>()).Where(v => v != null && !string.IsNullOrEmpty(v.Key)).ToList();
            List<WeResultRunInfo> rs = (run ?? Enumerable.Empty<WeResultRunInfo>()).Where(r => r != null && !string.IsNullOrEmpty(r.Key)).ToList();
            var runByKey = new Dictionary<string, WeResultRunInfo>(StringComparer.Ordinal);
            foreach (WeResultRunInfo r in rs) if (!runByKey.ContainsKey(r.Key)) runByKey[r.Key] = r;
            var groupLabel = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (WeResultRunInfo r in rs)
                if (!string.IsNullOrEmpty(r.RoomUid) && !string.IsNullOrEmpty(r.GroupLabel) && !groupLabel.ContainsKey(r.RoomUid)) groupLabel[r.RoomUid] = r.GroupLabel;

            var rooms = new Dictionary<string, WeResultRoom>(StringComparer.Ordinal);
            Func<string, WeResultRoom> room = uid =>
            {
                string k = uid ?? string.Empty;
                WeResultRoom node;
                if (rooms.TryGetValue(k, out node)) return node;
                string label = null;
                if (roomLabel != null && k.Length > 0) label = roomLabel(k);
                if (string.IsNullOrEmpty(label) && groupLabel.ContainsKey(k)) label = groupLabel[k];
                if (string.IsNullOrEmpty(label)) label = k.Length == 0 ? "Хана (өрөөгүй дэлгээс)" : "Өрөө (" + k + ")";
                node = new WeResultRoom { RoomUid = k, Label = label };
                rooms[k] = node;
                return node;
            };
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (WeResultViewInfo v in vs)
            {
                if (onlyRooms != null && !onlyRooms.Contains(v.RoomUid ?? string.Empty)) continue;
                // Нэг түлхүүрт хоёр харагдац (Duplicate) — хоёуланг харуулна (төлөвлөгч «давхардал» гэж тэмдэглэдэг).
                seen.Add(v.Key);
                WeResultRunInfo r;
                runByKey.TryGetValue(v.Key, out r);
                var row = new WeResultRow
                {
                    Kind = v.Kind, Key = v.Key, ViewName = v.ViewName, ViewId = v.ViewId, ViewportId = v.ViewportId,
                    SheetId = v.SheetId, SheetNumber = v.SheetNumber, SheetName = v.SheetName,
                    // Viewport-ийн «Detail Number» = хуудсан дээрх БОДИТ тэмдэг (W05 дугаарлалт, гараар сольсон ч); байршаагүй бол ажиллагааны тэмдэг.
                    Label = !string.IsNullOrEmpty(v.DetailNumber) ? v.DetailNumber : r != null ? r.Label : null,
                    Change = r != null ? r.Change : WeResultChange.None,
                };
                if (v.ViewportId == 0 || v.SheetId == 0) { row.State = WeResultState.Unplaced; row.Note = "Хуудсанд байршаагүй — хуудас руу чирж оруулна уу (эсвэл хэрэгслийг дахин ажиллуулна)"; }
                else if (v.OutOfFrame || v.Overlaps)
                {
                    row.State = WeResultState.Arrange;
                    row.Note = v.OutOfFrame && v.Overlaps ? "Хүрээнээс гадуур, өөр зурагтай давхацсан — байрлуулж цэгцлэх"
                             : v.OutOfFrame ? "Хуудасны хүрээнээс гадуур — байрлуулж цэгцлэх" : "Өөр зурагтай давхацсан — байрлуулж цэгцлэх";
                }
                room(v.RoomUid).Rows.Add(row);
            }
            foreach (WeResultRunInfo r in rs.Where(x => x.Failed && !seen.Contains(x.Key)))
            {
                if (onlyRooms != null && !onlyRooms.Contains(r.RoomUid ?? string.Empty)) continue;
                room(r.RoomUid).Rows.Add(new WeResultRow
                {
                    Kind = WeResultKind.Elevation, Key = r.Key, Label = r.Label, State = WeResultState.Failed, Change = r.Change,
                    Note = string.IsNullOrEmpty(r.Message) ? "Үүссэнгүй" : r.Message,
                });
            }
            foreach (WeResultRoom n in rooms.Values)
            {
                // Тэмдэг (байршаагүй бол харагдацын нэр) — «205A, 205B … 205AA»; түлхүүр план, 3D сүүлд.
                Func<WeResultRow, string> sortKey = x => x.Label ?? x.ViewName ?? string.Empty;
                n.Rows = n.Rows.OrderBy(x => (int)x.Kind)
                               .ThenBy(x => sortKey(x).Length)
                               .ThenBy(x => sortKey(x), StringComparer.Ordinal)
                               .ThenBy(x => x.ViewId).ToList();
                n.Sheets = n.Rows.Where(x => x.SheetId != 0).GroupBy(x => x.SheetId)
                                 .Select(g => new KeyValuePair<long, string>(g.Key, g.First().SheetNumber ?? "?"))
                                 .OrderBy(s => s.Value, StringComparer.Ordinal).ToList();
            }
            return rooms.Values.OrderBy(n => n.RoomUid.Length == 0 ? 1 : 0)
                               .ThenBy(n => n.Label ?? string.Empty, StringComparer.Ordinal).ToList();
        }

        /// <summary>«12 дэлгээс · 3 хуудас · 2 цэгцлэх · 1 хуудасгүй · 1 алдаа».</summary>
        public static string Summary(IList<WeResultRoom> rooms)
        {
            List<WeResultRow> rows = (rooms ?? new List<WeResultRoom>()).SelectMany(r => r.Rows).ToList();
            int elev = rows.Count(r => r.Kind == WeResultKind.Elevation && r.State != WeResultState.Failed);
            int sheets = rows.Where(r => r.SheetId != 0).Select(r => r.SheetId).Distinct().Count();
            var parts = new List<string>
            {
                (rooms ?? new List<WeResultRoom>()).Count.ToString(CultureInfo.InvariantCulture) + " өрөө",
                elev.ToString(CultureInfo.InvariantCulture) + " дэлгээс",
                sheets.ToString(CultureInfo.InvariantCulture) + " хуудас",
            };
            int arrange = rows.Count(r => r.State == WeResultState.Arrange), unplaced = rows.Count(r => r.State == WeResultState.Unplaced),
                failed = rows.Count(r => r.State == WeResultState.Failed);
            if (arrange > 0) parts.Add(arrange.ToString(CultureInfo.InvariantCulture) + " цэгцлэх");
            if (unplaced > 0) parts.Add(unplaced.ToString(CultureInfo.InvariantCulture) + " хуудасгүй");
            if (failed > 0) parts.Add(failed.ToString(CultureInfo.InvariantCulture) + " алдаа");
            return string.Join(" · ", parts);
        }

        /// <summary>
        /// Нэг хуудасны манай viewport-уудын байрлалын шалгалт (W06): хүрээний (title block) гадна / өөр viewport-той давхцал.  Тэгш өнцөгт =
        /// {minX, minY, maxX, maxY} хуудасны координатаар; хүрээгүй (title block-гүй) хуудсанд гадна гэж тооцохгүй.
        /// </summary>
        public static void Assess(IList<double[]> rects, double[] frame, out bool[] outOfFrame, out bool[] overlaps, double tol = FitTol)
        {
            int n = rects == null ? 0 : rects.Count;
            outOfFrame = new bool[n];
            overlaps = new bool[n];
            for (int i = 0; i < n; i++)
            {
                double[] a = rects[i];
                if (a == null || a.Length < 4) continue;
                if (frame != null && frame.Length >= 4)
                    outOfFrame[i] = a[0] < frame[0] - tol || a[1] < frame[1] - tol || a[2] > frame[2] + tol || a[3] > frame[3] + tol;
                for (int j = 0; j < n; j++)
                {
                    if (i == j || rects[j] == null || rects[j].Length < 4) continue;
                    double[] b = rects[j];
                    double w = Math.Min(a[2], b[2]) - Math.Max(a[0], b[0]), h = Math.Min(a[3], b[3]) - Math.Max(a[1], b[1]);
                    if (w > tol && h > tol) { overlaps[i] = true; break; }
                }
            }
        }

        /// <summary>
        /// Ажиллагааны нэг мөр → үр дүнгийн «шинэ / шинэчилсэн / үүсгээгүй / алдаа» (<paramref name="outcome"/> = coordinator-ын гарц: «Үүсгэв»,
        /// «Шинэчлэв», «Хэвээр», «Алгасав», «Устгав (шалгалт унав)», «Шинэчилсэн — гараар шалгана уу», «Алдаа»).  Хэрэглэгчийн өөрөө хассан мөр — null.
        /// </summary>
        public static WeResultRunInfo RunRow(WePlannedElevation p, string outcome, string runMessage)
        {
            if (p == null || string.IsNullOrEmpty(p.Key)) return null;
            if (p.Action == WeAction.Skip && p.ActionNote == "Та хассан") return null;
            var r = new WeResultRunInfo { Key = p.Key, RoomUid = p.RoomUid ?? string.Empty, GroupLabel = p.GroupLabel, Label = p.Label };
            switch (outcome)
            {
                case "Үүсгэв": r.Change = WeResultChange.New; break;
                case "Шинэчлэв":
                case "Шинэчилсэн — гараар шалгана уу": r.Change = WeResultChange.Updated; break;
                case "Устгав (шалгалт унав)":
                case "Алдаа":
                    r.Failed = true;
                    r.Message = "Алдаа: " + (string.IsNullOrEmpty(runMessage) ? outcome : runMessage);
                    break;
                case "Алгасав":
                    if (p.Status > WeStatus.Warning || p.Frame == null)
                    {
                        r.Failed = true;
                        r.Message = "Үүсгээгүй: " + (!string.IsNullOrEmpty(p.Message) ? p.Message : !string.IsNullOrEmpty(p.ActionNote) ? p.ActionNote : "дэмжигдэхгүй");
                    }
                    break;
            }
            return r;
        }
    }
}
