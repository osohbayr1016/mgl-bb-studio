using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using Autodesk.Revit.DB.ExtensibleStorage;
using Autodesk.Revit.UI;

namespace MglWeGate
{
    /// <summary>
    /// «+ Хана нэмэх» (2026-10-14, интерьерийн баг: «хуудас руу шилжих биш, цонхон дотроо шинэ үсэг гарч ирээд хэмжээгээ тохируулна») —
    /// GEN-EXTRA-101: 101-ийн (A–D аль хэдийн үүссэн) цонхонд «+ Хана нэмэх»-ийг UIA-аар дарна → цонх ХЭВЭЭР, шинэ E мөр → «⇅ Эсрэг» → «Үүсгэх».
    /// Хулгана ашиглахгүй (зөвхөн UIA invoke).  Шалгалт: ЗӨВХӨН E шинээр (A–D хөдлөөгүй), түлхүүр «…|side:extra-1», шугам харагдац дээр
    /// хадгалагдсан, нэр «101E», эсрэг харсан, маркертай, хуудсанд.
    /// </summary>
    internal static class ExtraSideChecks
    {
        private const string SchemaName = "MglWallElevation";
        private const string OverrideSchemaName = "MglWallElevationOverride";

        private sealed class Rec { public View View; public string Key, WallUid, RoomUid, Kind; }

        private static List<Rec> Records(Document doc)
        {
            Schema s = Schema.ListSchemas().FirstOrDefault(x => x.SchemaName == SchemaName);
            var list = new List<Rec>();
            if (s == null) return list;
            foreach (View v in new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>())
            {
                if (v.IsTemplate) continue;
                Entity e;
                try { e = v.GetEntity(s); } catch { continue; }
                if (e == null || !e.IsValid()) continue;
                list.Add(new Rec { View = v, Key = e.Get<string>("Key"), WallUid = e.Get<string>("WallUid"), RoomUid = e.Get<string>("RoomUid"), Kind = e.Get<string>("Kind") });
            }
            return list;
        }

        /// <summary>Харагдац дээр хадгалсан шугам (<c>WeOverrideStore</c>, «v1;…») — байхгүй бол null.</summary>
        private static string StoredLine(View v)
        {
            Schema s = Schema.ListSchemas().FirstOrDefault(x => x.SchemaName == OverrideSchemaName);
            if (s == null) return null;
            try
            {
                Entity e = v.GetEntity(s);
                return e != null && e.IsValid() ? e.Get<string>("Data") : null;
            }
            catch { return null; }
        }

        private static bool IsExtra(Rec r) { return (r.Key ?? string.Empty).IndexOf("|side:extra-", StringComparison.Ordinal) >= 0; }

        /// <summary>Өрөөний (link өрөөний UniqueId-аар) хэрэгслийн дэлгээс (view) — id.</summary>
        public static List<long> RoomViewIds(Document doc, Room room)
        {
            return Records(doc).Where(r => r.Kind == "view" && (r.RoomUid ?? string.Empty).EndsWith(room.UniqueId, StringComparison.Ordinal))
                               .Select(r => r.View.Id.Value).OrderBy(x => x).ToList();
        }

        public static void Inspect(UIApplication app, LiveContext L, ScenarioResult res, ScnState st, string id)
        {
            Document doc = app.ActiveUIDocument.Document;
            var data = (object[])st.Data;
            var lr = (Geo.LinkedRoom)data[0];
            var before = (List<long>)data[1];

            List<Rec> mine = Records(doc).Where(r => r.Kind == "view" && (r.RoomUid ?? string.Empty).EndsWith(lr.Room.UniqueId, StringComparison.Ordinal)).ToList();
            List<Rec> extra = mine.Where(IsExtra).ToList();
            res.Info("extra.views", string.Join(" · ", extra.Select(r => "«" + r.View.Name + "» " + r.Key)));
            Rec e1 = extra.FirstOrDefault(r => r.Key.EndsWith("|side:extra-1", StringComparison.Ordinal));
            res.Expect(extra.Count == 1 && e1 != null, "extra.created", extra.Count + " нэмэлт дэлгээс (хүлээгдэж буй 1, түлхүүр «…|side:extra-1»)");
            if (e1 != null)
            {
                res.Expect(e1.View.Name.Contains(lr.Number + "E"), "extra.letter_E", "«" + e1.View.Name + "» (E — өрөөний A–D-ийн дараа)");
                string line = StoredLine(e1.View);
                res.Expect(line != null && line.StartsWith("v1;", StringComparison.Ordinal), "extra.line_stored",
                           line != null ? "шугам харагдац дээр: " + Scenarios.Trim(line, 80) : "харагдац дээр шугам алга — дахин ажиллуулахад санагдахгүй");
                res.Expect(!string.IsNullOrEmpty(e1.WallUid), "extra.source", "эх элемент (ард нь хана / өрөө): " + Scenarios.Trim(e1.WallUid ?? "-", 90));
            }

            // A–D хөдлөөгүй: өмнөх дэлгээс бүгд байгаа, нэмэлтээс өөр ШИНЭ дэлгээс алга.
            List<View> fresh = Inspector.NewElevations(doc, L);
            List<Rec> sides = mine.Where(r => !IsExtra(r)).ToList();
            List<long> sideIds = sides.Select(r => r.View.Id.Value).OrderBy(x => x).ToList();
            res.Expect(before.Count >= 4 && sideIds.SequenceEqual(before), "extra.sides_unchanged",
                       "өрөөний тал " + sideIds.Count + " (өмнө " + before.Count + ") — ижил харагдац");
            res.Expect(fresh.Count == 1 && e1 != null && fresh[0].Id == e1.View.Id, "extra.only_new",
                       "шинээр үүссэн дэлгээс " + fresh.Count + ": " + string.Join(", ", fresh.Select(v => v.Name)));

            // «⇅ Эсрэг» — нэмэлт тал аль нэг талын урд гарч эсрэг тийш харсан: ViewDirection нь тэр талынхын эсрэг, хүрээ нь нарийн (уртын хагас).
            if (e1 != null && sides.Count > 0)
            {
                Rec anti = sides.OrderBy(r => r.View.ViewDirection.DotProduct(e1.View.ViewDirection)).First();
                double dot = anti.View.ViewDirection.DotProduct(e1.View.ViewDirection);
                double we = CropWidth(e1.View), wa = CropWidth(anti.View);
                res.Expect(dot < -0.999, "extra.flipped", "«⇅ Эсрэг»: «" + e1.View.Name + "» ↔ «" + anti.View.Name + "» чиглэлийн dot " + Math.Round(dot, 4));
                res.Expect(we > U.Mm(500) && we < wa, "extra.half_length", "хүрээний өргөн " + Math.Round(we * 304.8) + " мм < тэр талынх " + Math.Round(wa * 304.8) + " мм");
            }

            // Маркер, хуудас.
            if (e1 != null)
            {
                bool marked = new FilteredElementCollector(doc).OfClass(typeof(ElevationMarker)).Cast<ElevationMarker>().Any(m => Hosts(m, e1.View.Id));
                res.Expect(marked, "extra.marker", marked ? "Elevation маркерын сум" : "E-д маркер алга");
                Viewport vp = new FilteredElementCollector(doc).OfClass(typeof(Viewport)).Cast<Viewport>().FirstOrDefault(v => v.ViewId == e1.View.Id);
                ViewSheet sh = vp != null ? doc.GetElement(vp.SheetId) as ViewSheet : null;
                res.Expect(sh != null, "extra.on_sheet", sh != null ? "хуудас «" + sh.SheetNumber + " " + sh.Name + "»" : "хуудсанд байрлаагүй");
                // Үсгийн муж: өмнөх хуудас, түлхүүр план, 3D-ийн хэрэгслийн нэр «A-D» → «A-E».
                string range = lr.Number + "A-E";
                if (sh != null) res.Expect(sh.Name.Contains("/" + range + "/"), "extra.sheet_range", "хуудасны нэр «" + sh.Name + "»");
                View kp = new FilteredElementCollector(doc).OfClass(typeof(ViewPlan)).Cast<View>()
                    .FirstOrDefault(v => !v.IsTemplate && v.Name.StartsWith("Түлхүүр байгуулалт — " + lr.Number, StringComparison.Ordinal));
                string kpTitle = kp != null ? kp.get_Parameter(BuiltInParameter.VIEW_DESCRIPTION)?.AsString() : null;
                res.Expect(kp != null && kp.Name.EndsWith(range, StringComparison.Ordinal) && (kpTitle ?? string.Empty).EndsWith(range, StringComparison.Ordinal),
                           "extra.keyplan_range", kp != null ? "түлхүүр план «" + kp.Name + "» · гарчиг «" + kpTitle + "»" : "түлхүүр план олдсонгүй");
                View ax = new FilteredElementCollector(doc).OfClass(typeof(View3D)).Cast<View>()
                    .FirstOrDefault(v => !v.IsTemplate && v.Name.StartsWith("3D — " + lr.Number, StringComparison.Ordinal));
                if (ax != null) res.Expect(ax.Name.EndsWith(range, StringComparison.Ordinal), "extra.axon_range", "3D «" + ax.Name + "»");
            }

            string first = Inspector.ReadDump(L, "first-" + id) ?? string.Empty, added = Inspector.ReadDump(L, "added-" + id) ?? string.Empty;
            res.Expect(first.Contains("Хана нэмэх"), "extra.button", first.Contains("Хана нэмэх") ? "«+ Хана нэмэх» товч цонхонд" : "товч алга");
            // «нэмэлт» (жижиг үсгээр) — мөрийн тэмдэг; толгойн «Нэмэлт тал:» тоологдохгүй.  Дарсны ДАРАА цонх хэвээр (dump бий) ба мөр нэмэгдсэн.
            int n0 = Count(first, "нэмэлт"), n1 = Count(added, "нэмэлт");
            res.Expect(added.Length > 0 && n1 > n0, "extra.row_in_dialog",
                       added.Length == 0 ? "дарсны дараа цонхны dump алга (цонх хаагдсан?)" : "дарсны дараа цонх хэвээр, «нэмэлт» " + n0 + " → " + n1);
        }

        private static int Count(string s, string what)
        {
            int n = 0;
            for (int i = s.IndexOf(what, StringComparison.Ordinal); i >= 0; i = s.IndexOf(what, i + what.Length, StringComparison.Ordinal)) n++;
            return n;
        }

        private static bool Hosts(ElevationMarker m, ElementId view)
        {
            try
            {
                for (int i = 0; i < m.MaximumViewCount; i++) if (m.GetViewId(i) == view) return true;
            }
            catch { }
            return false;
        }

        private static double CropWidth(View v)
        {
            try
            {
                List<XYZ> c = Geo.CropCorners(v);
                double a = c.Min(p => p.DotProduct(v.RightDirection)), b = c.Max(p => p.DotProduct(v.RightDirection));
                return b - a;
            }
            catch { return 0; }
        }
    }
}
