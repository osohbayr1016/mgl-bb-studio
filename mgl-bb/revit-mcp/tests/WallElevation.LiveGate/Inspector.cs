using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using Autodesk.Revit.UI;

namespace MglWeGate
{
    /// <summary>
    /// Production-ийн үр дүнг Revit API-аар шалгана (black-box: зөвхөн загварт ҮҮССЭН зүйлийг уншина).  Шалгалт бүр нь хэрэглэгчийн
    /// шаардлагын нэг мөр: зөв өрөө, зөв чиглэл, link-ийн хана/нүх ба host тавилга харагдах, дээд давхар орохгүй, загвар/масштаб/нэр,
    /// хуудас, давхардалгүй, дизайнерын засвар хадгалагдах.
    /// </summary>
    internal static class Inspector
    {
        private static readonly double Tol = U.Mm(1);

        public static List<View> NewElevations(Document doc, LiveContext L)
        {
            return L.Added.Select(id => doc.GetElement(new ElementId(id)) as View)
                .Where(v => v != null && v.IsValidObject && !v.IsTemplate && (v.ViewType == ViewType.Elevation || v.ViewType == ViewType.Section))
                .OrderBy(v => v.Name, StringComparer.Ordinal).ToList();
        }

        private static List<ViewSheet> NewSheets(Document doc, LiveContext L)
        {
            return L.Added.Select(id => doc.GetElement(new ElementId(id)) as ViewSheet).Where(s => s != null && s.IsValidObject).ToList();
        }

        // ── Үүсгэх ─────────────────────────────────────────────────

        public static void Generation(UIApplication app, LiveContext L, ScenarioResult res, ScnState st, Geo.LinkedRoom lr, Scenarios.ExpectedViews exp)
        {
            Document doc = app.ActiveUIDocument.Document;
            List<View> views = NewElevations(doc, L);
            List<ViewSheet> sheets = NewSheets(doc, L);
            L.Generated[lr.Number] = views.Select(v => v.Id.Value).ToList();
            L.GeneratedSheets[lr.Number] = sheets.Select(s => s.Id.Value).ToList();
            res.Expect(views.Count >= exp.Min && views.Count <= exp.Max, "views.count",
                       views.Count + " дэлгээс (хүлээгдэж буй " + exp.Min + (exp.Max != exp.Min ? "–" + exp.Max : "") + "): " + string.Join(", ", views.Select(v => v.Name)));
            if (views.Count == 0) return;

            double z1m = lr.LevelZ + U.Mm(1000);
            bool lowerStorey = Math.Abs(lr.LevelZ - U.Mm(Synth.L1)) < U.Mm(5) || lr.Link == null && Math.Abs(lr.LevelZ) < U.Mm(5);
            double upperZ = lr.LevelZ + U.Mm(Synth.L2);
            var upperHost = new HashSet<long>(IdsFact(L, "upper_storey_host_ids"));
            var lowerHost = new HashSet<long>(IdsFact(L, "lower_storey_host_ids"));
            var unionLinkedInserts = new HashSet<string>(StringComparer.Ordinal);
            var unionHost = new HashSet<long>();
            var badDir = new List<string>();
            var badCrop = new List<string>();
            var badFar = new List<string>();
            var leakCrop = new List<string>();
            var leakVisible = new List<string>();
            var noLinkedWalls = new List<string>();
            var noDims = new List<string>();
            var badScale = new List<string>();
            var badName = new List<string>();
            List<RevitLinkInstance> links = new FilteredElementCollector(doc).OfClass(typeof(RevitLinkInstance)).Cast<RevitLinkInstance>().Where(l => l.GetLinkDocument() != null).ToList();

            foreach (View v in views)
            {
                if (!v.Name.Contains(lr.Number)) badName.Add(v.Name);
                if (v.Scale != 50) badScale.Add(v.Name + " 1:" + v.Scale);
                List<XYZ> c = Geo.CropCorners(v);
                XYZ vd = v.ViewDirection;
                double maxD = c.Max(p => p.DotProduct(vd)), minD = c.Min(p => p.DotProduct(vd));
                XYZ nearC = Avg(c.Where(p => p.DotProduct(vd) > maxD - Tol)), farC = Avg(c.Where(p => p.DotProduct(vd) < minD + Tol));
                bool inside = lr.Contains(new XYZ(nearC.X, nearC.Y, z1m));
                // Харагчаас (cut) алс хавтгай хүртэлх шулуун НЭГ Ч удаа өрөөнөөс гарвал гүнд хана/хил бий.  «Алс хавтгай өрөөн гадна» гэж
                // шаардахгүй: пилястрын хажуу нүүрний цаана дахин өрөө байдаг (103E/103I, 2026-10-13 хэмжсэн — дүрмээрээ тусдаа дэлгээс).
                bool crossesBoundary = false;
                for (int k = 1; k <= 60 && !crossesBoundary; k++)
                {
                    XYZ q = nearC + (farC - nearC) * (k / 60.0);
                    if (!lr.Contains(new XYZ(q.X, q.Y, z1m))) crossesBoundary = true;
                }
                if (!inside || !crossesBoundary) badDir.Add(v.Name + (inside ? "" : " (харагч өрөөн дотор БИШ)") + (crossesBoundary ? "" : " (гүнд хана/хил алга)"));

                double depth = maxD - minD;
                Parameter far = v.get_Parameter(BuiltInParameter.VIEWER_BOUND_OFFSET_FAR);
                double farVal = far != null ? far.AsDouble() : double.NaN;
                if (!(farVal < U.Mm(30000)) || farVal < depth - U.Mm(5)) badFar.Add(v.Name + " far=" + Geo.S(U.ToMm(farVal)) + " мм, гүн " + Geo.S(U.ToMm(depth)));
                if (depth > U.Mm(30000) || depth < U.Mm(300)) badCrop.Add(v.Name + " гүн " + Geo.S(U.ToMm(depth)) + " мм");

                double top = c.Max(p => p.Z), bottom = c.Min(p => p.Z);
                if (lowerStorey && exp.CheckUpper && top - upperZ > Tol)
                    leakCrop.Add(v.Name + ": crop дээд хил дээд давхрын түвшнээс " + Geo.S(U.ToMm(top - upperZ)) + " мм дээш");

                // Host-д харагдах элементүүд
                List<Element> hostVis = new FilteredElementCollector(doc, v.Id).WhereElementIsNotElementType().ToElements().ToList();
                foreach (Element e in hostVis)
                {
                    if (lowerHost.Contains(e.Id.Value)) unionHost.Add(e.Id.Value);
                    if (!lowerStorey || !exp.CheckUpper || !IsModel(e)) continue;
                    BoundingBoxXYZ bb = e.get_BoundingBox(null);
                    if (bb == null) continue;
                    bool upperByMark = upperHost.Contains(e.Id.Value);
                    bool upperByGeo = bb.Min.Z >= upperZ - Tol;
                    // Гоожилт = дээд түвшнээс ДЭЭШХ хэсэг л харагдах.  Дээд давхрын элементийн түвшнээс ДООШ цухуйсан хэсэг (дам нуруу г.м.)
                    // бодитоор доод давхарт байгаа тул харагдах нь зөв (2026-10-13: cap-тай хүрээнд 30 мм-ийн цухуйлт гоожилт гэж тоологдож байв).
                    double overlap = Math.Min(top, bb.Max.Z) - Math.Max(Math.Max(bottom, bb.Min.Z), upperZ);
                    if ((upperByMark || upperByGeo) && overlap > Tol)
                        leakVisible.Add(v.Name + ": host " + e.Category.Name + " #" + e.Id.Value + " (" + Geo.S(U.ToMm(overlap)) + " мм)");
                }
                // Link-д харагдах элементүүд
                int linkedWalls = 0;
                foreach (RevitLinkInstance li in links)
                {
                    List<Element> lv;
                    try { lv = new FilteredElementCollector(doc, v.Id, li.Id).WhereElementIsNotElementType().ToElements().ToList(); }
                    catch (Exception ex) { res.Info("linked.collector", "FilteredElementCollector(doc, view, link) алдаа: " + ex.Message); break; }
                    Transform tf = li.GetTotalTransform();
                    foreach (Element e in lv)
                    {
                        if (e.Category == null) continue;
                        long cat = e.Category.Id.Value;
                        if (cat == (long)BuiltInCategory.OST_Walls) linkedWalls++;
                        if (cat == (long)BuiltInCategory.OST_Doors || cat == (long)BuiltInCategory.OST_Windows) unionLinkedInserts.Add(li.Id.Value + ":" + e.Id.Value);
                        if (!lowerStorey || !exp.CheckUpper || !IsModel(e)) continue;
                        BoundingBoxXYZ bb = e.get_BoundingBox(null);
                        if (bb == null) continue;
                        double minZ = Math.Min(tf.OfPoint(bb.Min).Z, tf.OfPoint(bb.Max).Z), maxZ = Math.Max(tf.OfPoint(bb.Min).Z, tf.OfPoint(bb.Max).Z);
                        double overlap = Math.Min(top, maxZ) - Math.Max(Math.Max(bottom, minZ), upperZ);
                        if (minZ >= upperZ - Tol && overlap > Tol)
                            leakVisible.Add(v.Name + ": link " + e.Category.Name + " #" + e.Id.Value + " (" + Geo.S(U.ToMm(overlap)) + " мм)");
                    }
                }
                if (lr.Link != null && linkedWalls == 0) noLinkedWalls.Add(v.Name);
                int dims = new FilteredElementCollector(doc, v.Id).OfClass(typeof(Dimension)).GetElementCount();
                if (dims == 0) noDims.Add(v.Name);
                res.Info("view." + v.Name, "1:" + v.Scale + " · гүн " + Geo.S(U.ToMm(depth)) + " · Z " + Geo.S(U.ToMm(bottom)) + "…" + Geo.S(U.ToMm(top))
                                           + " · far " + Geo.S(U.ToMm(farVal)) + " · хэмжээс " + dims + " · link хана " + linkedWalls
                                           + " · загвар " + (v.ViewTemplateId == ElementId.InvalidElementId ? "—" : doc.GetElement(v.ViewTemplateId).Name));
            }

            res.Expect(badName.Count == 0, "naming.room_number", badName.Count == 0 ? "бүх нэр өрөөний дугаартай" : string.Join("; ", badName));
            res.Expect(badScale.Count == 0, "scale", badScale.Count == 0 ? "бүгд 1:50 (тохиргоо)" : string.Join("; ", badScale));
            res.Expect(badDir.Count == 0, "orientation.room_to_wall", badDir.Count == 0 ? "харагч өрөөн дотор, гүнд хана — бүх " + views.Count : string.Join("; ", badDir));
            res.Expect(badFar.Count == 0, "far_clip", badFar.Count == 0 ? "far clip ≥ гүн, < 30 м" : string.Join("; ", badFar));
            res.Expect(badCrop.Count == 0, "crop.depth", badCrop.Count == 0 ? "гүн 0.3–30 м" : string.Join("; ", badCrop));
            if (lr.Link != null) res.Expect(noLinkedWalls.Count == 0, "linked.walls_visible", noLinkedWalls.Count == 0 ? "дэлгээс бүрт link-ийн хана харагдана" : "link хана харагдахгүй: " + string.Join("; ", noLinkedWalls));
            res.Expect(noDims.Count == 0, "annotations.dimensions", noDims.Count == 0 ? "дэлгээс бүрт хэмжээс бий" : "хэмжээсгүй: " + string.Join("; ", noDims));

            // Өрөөний нүх (link-ийн хаалга/цонх) — өрөөний хилийн ойролцоох бүгд дор хаяж нэг дэлгээст.
            if (lr.Link != null && exp.CoverRoom)
            {
                List<string> expected = LinkedInsertsOfRoom(lr);
                List<string> missing = expected.Where(k => !unionLinkedInserts.Contains(k)).ToList();
                res.Expect(missing.Count == 0, "linked.openings_visible", expected.Count + " хаалга/цонхны " + (expected.Count - missing.Count) + " харагдана" + (missing.Count > 0 ? " — дутуу: " + string.Join(", ", missing) : ""));
            }
            // Host тавилга/casework/өнгөлгөөний хана (зөвхөн тэр өрөөнд)
            List<long> hostInRoom = lowerHost.Where(id => InRoom(doc, id, lr) && IsFurnishing(doc, id)).ToList();
            if (hostInRoom.Count > 0 && exp.CoverRoom)
            {
                List<long> miss = hostInRoom.Where(id => !unionHost.Contains(id)).ToList();
                res.Expect(miss.Count == 0, "host.furnishings_visible", hostInRoom.Count + " host тавилга/casework/өнгөлгөөний хананы " + (hostInRoom.Count - miss.Count) + " харагдана"
                                                                        + (miss.Count > 0 ? " — дутуу #" + string.Join(", #", miss) : ""));
            }
            if (lowerStorey && exp.CheckUpper)
            {
                res.Expect(leakCrop.Count == 0, "leak.crop_top", leakCrop.Count == 0 ? "crop дээд давхрын түвшнээс дээш гараагүй" : string.Join("; ", leakCrop.Take(4)), "WE-BUG-001");
                res.Expect(leakVisible.Count == 0, "leak.visible_upper_elements", leakVisible.Count == 0 ? "дээд давхрын элемент харагдахгүй" : leakVisible.Count + ": " + string.Join("; ", leakVisible.Take(6)), "WE-BUG-001");
            }
            Sheets(doc, sheets, res);
            // Интерьерийн багийн 3-р тойрог (2026-10-14): толин spot, бүдэг хэсэг, улаан хүрээ, рендерийн байр.  Synth-д 101, 102 нь таазтай.
            // Тааз нь ИНТЕРЬЕРИЙН (host) загварт л (Synth) — link-ийн 101/102; архитектурын хуулбарын host өрөөнд тааз алга.
            Round3Checks.Run(doc, L, views, sheets, lr, res, lr.Link != null && (lr.Number == "101" || lr.Number == "102"));
            // Түлхүүр план ч зурагт (улаан хүрээ).
            List<ElementId> keyPlans = L.Added.Select(id => doc.GetElement(new ElementId(id)) as View)
                .Where(x => x != null && x.IsValidObject && x.ViewType == ViewType.FloorPlan && x.Name.StartsWith("Түлхүүр байгуулалт", StringComparison.Ordinal))
                .Select(x => x.Id).ToList();
            Export(doc, views.Select(v => v.Id).Concat(keyPlans).Concat(sheets.Select(s => s.Id)).ToList(), L, res, st, lr.Number);
        }

        private static void Sheets(Document doc, List<ViewSheet> sheets, ScenarioResult res)
        {
            if (sheets.Count == 0) { res.Info("sheets", "хуудас үүсээгүй (тохиргоо ViewsOnly эсвэл байгаа хуудас ашигласан)"); return; }
            var problems = new List<string>();
            foreach (ViewSheet s in sheets)
            {
                Element tb = new FilteredElementCollector(doc, s.Id).OfCategory(BuiltInCategory.OST_TitleBlocks).FirstElement();
                if (tb == null) problems.Add(s.SheetNumber + ": title block алга");
                BoundingBoxXYZ tbb = tb != null ? tb.get_BoundingBox(s) : null;
                List<Viewport> vps = s.GetAllViewports().Select(i => doc.GetElement(i) as Viewport).Where(v => v != null).ToList();
                var boxes = vps.Select(v => new { v, o = v.GetBoxOutline() }).ToList();
                for (int i = 0; i < boxes.Count; i++)
                {
                    Outline a = boxes[i].o;
                    if (tbb != null && (a.MinimumPoint.X < tbb.Min.X - Tol || a.MinimumPoint.Y < tbb.Min.Y - Tol || a.MaximumPoint.X > tbb.Max.X + Tol || a.MaximumPoint.Y > tbb.Max.Y + Tol))
                        problems.Add(s.SheetNumber + ": viewport «" + (doc.GetElement(boxes[i].v.ViewId) as View)?.Name + "» title block-оос гарсан");
                    for (int j = i + 1; j < boxes.Count; j++)
                    {
                        Outline b = boxes[j].o;
                        bool ov = a.MinimumPoint.X < b.MaximumPoint.X - Tol && b.MinimumPoint.X < a.MaximumPoint.X - Tol && a.MinimumPoint.Y < b.MaximumPoint.Y - Tol && b.MinimumPoint.Y < a.MaximumPoint.Y - Tol;
                        if (ov) problems.Add(s.SheetNumber + ": viewport давхцсан");
                    }
                }
                res.Info("sheet." + s.SheetNumber, s.Name + " · viewport " + vps.Count);
            }
            res.Expect(problems.Count == 0, "sheets.layout", problems.Count == 0 ? sheets.Count + " хуудас — title block-той, viewport давхцалгүй" : string.Join("; ", problems.Take(5)));
        }

        public static void Export(Document doc, List<ElementId> ids, LiveContext L, ScenarioResult res, ScnState st, string tag)
        {
            if (ids.Count == 0) return;
            string dir = Path.Combine(L.R.Job.RunDir, "png", res.Id);
            Directory.CreateDirectory(dir);
            try
            {
                var o = new ImageExportOptions
                {
                    ExportRange = ExportRange.SetOfViews, FilePath = Path.Combine(dir, tag), ZoomType = ZoomFitType.FitToPage,
                    PixelSize = 1400, ImageResolution = ImageResolution.DPI_150, HLRandWFViewsFileType = ImageFileType.PNG,
                    ShadowViewsFileType = ImageFileType.PNG, FitDirection = FitDirectionType.Horizontal,
                };
                o.SetViewsAndSheets(ids);
                doc.ExportImage(o);
                foreach (string f in Directory.GetFiles(dir, "*.png")) res.Evidence.Add(f);
                res.Info("export.png", Directory.GetFiles(dir, "*.png").Length + " PNG → " + dir);
            }
            catch (Exception ex) { res.Info("export.png", "PNG export алдаа: " + ex.Message); }
        }

        // ── Дахин ажиллуулах, дизайнерын засвар ───────────────────

        public static void NoDuplicates(UIApplication app, LiveContext L, ScenarioResult res, ScnState st)
        {
            Document doc = app.ActiveUIDocument.Document;
            List<View> views = NewElevations(doc, L);
            List<ViewSheet> sheets = NewSheets(doc, L);
            int vps = L.Added.Count(id => doc.GetElement(new ElementId(id)) is Viewport);
            res.Expect(views.Count == 0 && sheets.Count == 0 && vps == 0, "rerun.no_duplicates",
                       "шинэ дэлгээс " + views.Count + ", хуудас " + sheets.Count + ", viewport " + vps);
            var snap = st.Data as Snapshot;
            if (snap == null) { res.Add("rerun.nothing_deleted", "BLOCKED", "өмнөх snapshot алга"); return; }
            // ХЭМЖСЭН (2026-10-13): дахин ажиллуулахад хэрэгсэл түлхүүр план / 3D-ийн ӨӨРИЙН зурсныг (WeAnnoStore) устгаж дахин зурдаг
            // (WALL_ELEVATIONS.md «дахин ажиллуулахад crop шинэчилж, ӨӨРИЙН зурсныг устгаж дахин зурна») — 16 устгал нь тэр.  Тиймээс:
            //   · хэрэгслийн харагдац/хуудаснаас ГАДУУРХ элемент устсан = FAIL;
            //   · харагдац бүрийн ангилал тус бүрийн тоо өмнөхтэй ижил (солигдсон, алдагдаагүй, хуримтлагдаагүй) = PASS.
            List<long> foreign = L.Deleted.Where(id => !L.Added.Contains(id) && !snap.Owned.ContainsKey(id)).ToList();
            res.Expect(foreign.Count == 0, "rerun.nothing_foreign_deleted",
                       foreign.Count == 0 ? "хэрэгслийн харагдацаас гадуур устсан элемент 0" : "гадуур устсан " + foreign.Count + ": " + string.Join(",", foreign.Take(20)));
            int replaced = L.Deleted.Count(id => snap.Owned.ContainsKey(id));
            Dictionary<string, int> after = CountOwned(doc, snap.Owners);
            List<string> diff = snap.Counts.Keys.Union(after.Keys)
                .Select(k => new { k, b = snap.Counts.TryGetValue(k, out int x) ? x : 0, a = after.TryGetValue(k, out int y) ? y : 0 })
                .Where(t => t.a != t.b).Select(t => t.k + " " + t.b + "→" + t.a).ToList();
            res.Expect(diff.Count == 0, "rerun.own_annotations_stable",
                       (diff.Count == 0 ? "харагдац бүрийн тэмдэглэгээний тоо хэвээр" : "тоо өөрчлөгдсөн: " + string.Join("; ", diff.Take(12)))
                       + " · хэрэгсэл өөрийн " + replaced + " элементийг сольсон");
            res.Info("rerun.preview", Scenarios.Trim(DumpTexts(ReadDump(L, "preview-" + res.Id)), 400));
        }

        /// <summary>Хэрэгслийн нэг өрөөнд үүсгэсэн харагдац, хуудас (түлхүүр план, 3D-г хуудасны viewport-оор) — тэдгээрт харьяалагдах элементүүд.</summary>
        internal sealed class Snapshot
        {
            public HashSet<long> Owners = new HashSet<long>();
            public Dictionary<long, string> Owned = new Dictionary<long, string>();
            public Dictionary<string, int> Counts = new Dictionary<string, int>();
        }

        public static Snapshot SnapshotToolViews(Document doc, LiveContext L, string room)
        {
            var snap = new Snapshot();
            List<long> v;
            if (L.Generated.TryGetValue(room, out v)) snap.Owners.UnionWith(v);
            List<long> sh;
            if (L.GeneratedSheets.TryGetValue(room, out sh))
                foreach (long s in sh)
                {
                    snap.Owners.Add(s);
                    var sheet = doc.GetElement(new ElementId(s)) as ViewSheet;
                    if (sheet == null) continue;
                    foreach (ElementId vpId in sheet.GetAllViewports())
                    {
                        var vp = doc.GetElement(vpId) as Viewport;
                        if (vp != null) snap.Owners.Add(vp.ViewId.Value);
                    }
                }
            foreach (Element e in OwnedBy(doc, snap.Owners))
                snap.Owned[e.Id.Value] = KeyOf(e);
            snap.Counts = CountOwned(doc, snap.Owners);
            return snap;
        }

        private static IEnumerable<Element> OwnedBy(Document doc, HashSet<long> owners)
        {
            foreach (Element e in new FilteredElementCollector(doc).WhereElementIsNotElementType())
            {
                ElementId ov;
                try { ov = e.OwnerViewId; } catch { continue; }
                if (ov != null && ov != ElementId.InvalidElementId && owners.Contains(ov.Value)) yield return e;
            }
        }

        private static string KeyOf(Element e)
        {
            return e.OwnerViewId.Value + "/" + (e.Category != null ? e.Category.Name : e.GetType().Name);
        }

        private static Dictionary<string, int> CountOwned(Document doc, HashSet<long> owners)
        {
            var d = new Dictionary<string, int>();
            foreach (Element e in OwnedBy(doc, owners))
            {
                string k = KeyOf(e);
                int c;
                d[k] = d.TryGetValue(k, out c) ? c + 1 : 1;
            }
            return d;
        }

        internal sealed class Edits
        {
            public long ViewId, LineId, NoteId, ViewportId, SheetId;
            public string NewName;
            public XYZ VpCenter;
        }

        public static Edits MakeDesignerEdits(Document doc, LiveContext L, string room, ScenarioResult res)
        {
            var e = new Edits();
            var v = doc.GetElement(new ElementId(L.Generated[room][0])) as View;
            List<long> sh;
            ViewSheet sheet = L.GeneratedSheets.TryGetValue(room, out sh) && sh.Count > 0 ? doc.GetElement(new ElementId(sh[0])) as ViewSheet : null;
            using (var t = new Transaction(doc, "gate: designer edits"))
            {
                t.Start();
                e.ViewId = v.Id.Value;
                e.NewName = v.Name + " ЗАСВАРЛАСАН";
                v.Name = e.NewName;
                XYZ o = v.Origin;
                DetailCurve dc = doc.Create.NewDetailCurve(v, Line.CreateBound(o + v.RightDirection * U.Mm(200) + v.UpDirection * U.Mm(500),
                                                                              o + v.RightDirection * U.Mm(900) + v.UpDirection * U.Mm(500)));
                e.LineId = dc.Id.Value;
                if (sheet != null)
                {
                    e.SheetId = sheet.Id.Value;
                    ElementId tt = doc.GetDefaultElementTypeId(ElementTypeGroup.TextNoteType);
                    e.NoteId = TextNote.Create(doc, sheet.Id, new XYZ(U.Mm(50), U.Mm(50), 0), "ДИЗАЙНЕРЫН ТЭМДЭГЛЭЛ", tt).Id.Value;
                    Viewport vp = sheet.GetAllViewports().Select(i => doc.GetElement(i) as Viewport).FirstOrDefault(x => x != null && x.ViewId == v.Id);
                    if (vp != null)
                    {
                        // Сул зай руу (бусад viewport-той ДАВХЦАХГҮЙ чиглэлд) 10 мм — давхцал үүсгэвэл хэрэгсэл хуудсыг дүрмээрээ дахин зохиомжилно
                        // (CheckSheet, 2026-10-13 хэмжсэн: «101A ↔ 101B давхцсан — дахин зохиомжилно»), тэр нь засварыг устгасан хэрэг биш.
                        XYZ move = FreeNudge(doc, sheet, vp, U.Mm(10));
                        if (move == null) res.Info("edits.viewport", "10 мм сул зай олдсонгүй — viewport-ийг зөөсөнгүй");
                        else
                        {
                            vp.SetBoxCenter(vp.GetBoxCenter() + move);
                            e.ViewportId = vp.Id.Value;
                            e.VpCenter = vp.GetBoxCenter();
                        }
                    }
                }
                t.Commit();
            }
            res.Info("edits", "нэр «" + e.NewName + "», шугам #" + e.LineId + ", бичвэр #" + e.NoteId + ", viewport #" + e.ViewportId + " 10 мм зөөв");
            return e;
        }

        /// <summary>
        /// Хэрэгслийн «давхцал» дүрэмтэй ИЖИЛ ул мөр: viewport-ийн хүрээ ∪ гарчиг (WeSheetService.FullOutline).  ХЭМЖСЭН (2026-10-13): зөвхөн
        /// хүрээгээр шалгаж 10 мм зөөхөд гарчиг нь 101D-тэй давхцаж хэрэгсэл хуудсыг (зөв) дахин зохиомжилсон — тэр нь тестийн алдаа байв.
        /// </summary>
        private static Outline FullOf(Viewport vp)
        {
            Outline o = vp.GetBoxOutline();
            try
            {
                Outline l = vp.GetLabelOutline();
                if (l != null && !l.IsEmpty)
                    o = new Outline(new XYZ(Math.Min(o.MinimumPoint.X, l.MinimumPoint.X), Math.Min(o.MinimumPoint.Y, l.MinimumPoint.Y), 0),
                                    new XYZ(Math.Max(o.MaximumPoint.X, l.MaximumPoint.X), Math.Max(o.MaximumPoint.Y, l.MaximumPoint.Y), 0));
            }
            catch { }
            return o;
        }

        /// <summary>
        /// Дизайнерын «бага зэрэг зөөсөн» засварыг дуурайна: бусад viewport-ын (хүрээ + гарчиг) ул мөртэй 3 мм-ээс ойртохгүй, одоогийн
        /// зохиомжийн хүрээнээс гарахгүй (тэгвэл зурах талбайд үлдэнэ) чиглэлд.  Хэрэгсэл ийм засварыг ХӨДӨЛГӨХ ёсгүй.
        /// </summary>
        private static XYZ FreeNudge(Document doc, ViewSheet sheet, Viewport vp, double d)
        {
            Outline me = FullOf(vp);
            List<Outline> others = sheet.GetAllViewports().Where(i => i != vp.Id).Select(i => doc.GetElement(i) as Viewport).Where(x => x != null).Select(FullOf).ToList();
            double ex0 = others.Select(o => o.MinimumPoint.X).Concat(new[] { me.MinimumPoint.X }).Min(), ey0 = others.Select(o => o.MinimumPoint.Y).Concat(new[] { me.MinimumPoint.Y }).Min();
            double ex1 = others.Select(o => o.MaximumPoint.X).Concat(new[] { me.MaximumPoint.X }).Max(), ey1 = others.Select(o => o.MaximumPoint.Y).Concat(new[] { me.MaximumPoint.Y }).Max();
            double gap = U.Mm(3);
            foreach (double dist in new[] { d, d / 2 })
                foreach (XYZ dir in new[] { new XYZ(0, -1, 0), new XYZ(0, 1, 0), new XYZ(-1, 0, 0), new XYZ(1, 0, 0) })
                {
                    XYZ m = dir * dist;
                    XYZ lo = me.MinimumPoint + m, hi = me.MaximumPoint + m;
                    if (lo.X < ex0 || lo.Y < ey0 || hi.X > ex1 || hi.Y > ey1) continue;
                    bool hit = others.Any(o => lo.X - gap < o.MaximumPoint.X && o.MinimumPoint.X < hi.X + gap && lo.Y - gap < o.MaximumPoint.Y && o.MinimumPoint.Y < hi.Y + gap);
                    if (!hit) return m;
                }
            return null;
        }

        public static void EditsKept(UIApplication app, LiveContext L, ScenarioResult res, ScnState st)
        {
            Document doc = app.ActiveUIDocument.Document;
            var e = (Edits)st.Data;
            var v = doc.GetElement(new ElementId(e.ViewId)) as View;
            res.Expect(v != null && v.Name == e.NewName, "edit.view_name_kept", v == null ? "дэлгээс УСТСАН" : "нэр «" + v.Name + "»");
            res.Expect(doc.GetElement(new ElementId(e.LineId)) != null, "edit.detail_line_kept", "#" + e.LineId);
            if (e.NoteId != 0) res.Expect(doc.GetElement(new ElementId(e.NoteId)) != null, "edit.sheet_note_kept", "#" + e.NoteId);
            if (e.ViewportId != 0)
            {
                var vp = doc.GetElement(new ElementId(e.ViewportId)) as Viewport;
                double d = vp == null ? double.MaxValue : vp.GetBoxCenter().DistanceTo(e.VpCenter);
                // Хэрэгсэл яагаад хөдөлгөснийг (давхцал / зурах талбай) production log-оос — дүгнэлтэд шалтгаан хамт.
                string why = string.Join(" ; ", (st.Log ?? "").Split('\n').Where(x => x.Contains("дахин зохиомжилно")).Select(x => x.Trim()).Take(3));
                res.Expect(vp != null && d < U.Mm(1), "edit.viewport_position_kept",
                           (vp == null ? "viewport УСТСАН" : "зөрүү " + Geo.S(U.ToMm(d)) + " мм") + (why.Length > 0 ? " · хэрэгсэл: " + why : ""));
            }
            res.Expect(NewElevations(doc, L).Count == 0, "edit.no_new_views", "шинэ дэлгээс " + NewElevations(doc, L).Count);
            long[] edited = { e.ViewId, e.LineId, e.NoteId, e.ViewportId };
            res.Expect(!edited.Any(id => id != 0 && L.Deleted.Contains(id)), "edit.nothing_deleted", "устсан: " + string.Join(",", edited.Where(id => L.Deleted.Contains(id))));
        }

        // ── Сонголт ────────────────────────────────────────────────

        public static XYZ ClickPoint(Geo.LinkedRoom lr, string where)
        {
            BoundingBoxXYZ bb = lr.Room.get_BoundingBox(null);
            if (bb == null) return null;
            var pts = new List<XYZ>();
            foreach (double x in new[] { bb.Min.X, bb.Max.X }) foreach (double y in new[] { bb.Min.Y, bb.Max.Y }) pts.Add(lr.Tf.OfPoint(new XYZ(x, y, bb.Min.Z)));
            double x0 = pts.Min(p => p.X), x1 = pts.Max(p => p.X), y0 = pts.Min(p => p.Y), y1 = pts.Max(p => p.Y);
            switch (where)
            {
                case "tag": return lr.HostLocation;
                case "empty": return new XYZ(x0 + 0.8 * (x1 - x0), y0 + 0.25 * (y1 - y0), lr.LevelZ);
                case "x": return new XYZ(x0 + 0.25 * (x1 - x0), y0 + 0.25 * (y1 - y0), lr.LevelZ);
                default: return null;
            }
        }

        public static void ZoomTo(UIDocument uidoc, View view, Geo.LinkedRoom lr)
        {
            UIView uv = uidoc.GetOpenUIViews().FirstOrDefault(x => x.ViewId == view.Id);
            BoundingBoxXYZ bb = lr.Room.get_BoundingBox(null);
            if (uv == null || bb == null) return;
            XYZ a = lr.Tf.OfPoint(bb.Min), b = lr.Tf.OfPoint(bb.Max);
            double m = U.Mm(2500);
            uv.ZoomAndCenterRectangle(new XYZ(Math.Min(a.X, b.X) - m, Math.Min(a.Y, b.Y) - m, 0), new XYZ(Math.Max(a.X, b.X) + m, Math.Max(a.Y, b.Y) + m, 0));
            uidoc.RefreshActiveView();
        }

        public static void Selection(UIApplication app, LiveContext L, ScenarioResult res, ScnState st)
        {
            var data = (object[])st.Data;
            string room = (string)data[0], known = (string)data[1];
            string dump = ReadDump(L, st.DumpName);
            string texts = DumpTexts(dump);
            bool preview = Regex.IsMatch(dump, "дэлгээс (үүсгэх|шинэчлэх)|Болих", RegexOptions.IgnoreCase) && dump.Contains("WINDOW");
            bool empty = Regex.IsMatch(texts, "Сонголтод өрөө эсвэл хана алга", RegexOptions.IgnoreCase);
            // Preview-ийн ӨРӨӨНИЙ толгой мөр л («Өрөө 102 — ХУРЛЫН ӨРӨӨ (L1) …»).  Dump-д ажлын самбар («Ханын дэлгээс · Өрөө 105 — …»), хуудасны
            // табууд (WE-L1-101 …) ч орж ирдэг (2026-10-13 хэмжсэн) — тэдгээрээс тоо уншвал хуурамч олон өрөө гарна.
            List<string> seen = Regex.Matches(dump ?? "", "«Өрөө (\\S+) — ").Cast<Match>().Select(m => m.Groups[1].Value).Distinct().ToList();
            res.Info("result", (dump.Length == 0 ? "(dump алга — цонх гарсангүй)" : preview ? "preview: " : empty ? "мессеж: " : "цонх: ") + Scenarios.Trim(texts, 400));
            bool ok = preview && seen.Contains(room) && seen.Count(n => n != room && !n.StartsWith(room)) == 0;
            res.Expect(ok, "selection.room", ok ? "зөв өрөө " + room + " сонгогдсон" : "хүлээгдэж буй " + room + "; preview " + (preview ? "гарсан, өрөө: " + string.Join(",", seen) : "гараагүй") + (empty ? " (хоосон сонголт)" : ""), known);
            res.Expect(L.Added.Count == 0 && L.Deleted.Count == 0, "cancel.no_model_change", "Болих → нэмэгдсэн " + L.Added.Count + ", устсан " + L.Deleted.Count);
            foreach (string f in Directory.GetFiles(L.DriverDir, "*" + Clean(res.Id) + "*.png")) res.Evidence.Add(f);
        }

        // ── Туслах ─────────────────────────────────────────────────

        /// <summary>Driver-ийн Clean()-тэй ИЖИЛ (файлын нэр).</summary>
        public static string Clean(string s)
        {
            var sb = new StringBuilder();
            foreach (char c in s ?? "") sb.Append(char.IsLetterOrDigit(c) ? c : '_');
            string r = sb.ToString();
            return r.Length > 40 ? r.Substring(0, 40) : r;
        }

        public static string ReadDump(LiveContext L, string name)
        {
            if (name == null) return string.Empty;
            string p = Path.Combine(L.DriverDir, "dump-" + Clean(name) + ".txt");
            return File.Exists(p) ? File.ReadAllText(p, Encoding.UTF8) : string.Empty;
        }

        /// <summary>Dump-ийн «…» доторх бичвэрүүд (давхардалгүй).</summary>
        public static string DumpTexts(string dump)
        {
            var seen = new List<string>();
            foreach (Match m in Regex.Matches(dump ?? "", "«([^»]+)»"))
                if (!seen.Contains(m.Groups[1].Value)) seen.Add(m.Groups[1].Value);
            return string.Join(" | ", seen);
        }

        private static IEnumerable<long> IdsFact(LiveContext L, string key)
        {
            object v;
            string s = L.R.Facts.TryGetValue(key, out v) ? v as string : null;
            if (string.IsNullOrEmpty(s)) yield break;
            foreach (string p in s.Split(',')) { long id; if (long.TryParse(p, out id)) yield return id; }
        }

        internal static IEnumerable<long> IdsFactPublic(LiveContext L, string key) { return IdsFact(L, key); }
        internal static bool IsModelPublic(Element e) { return IsModel(e); }

        private static bool IsModel(Element e)
        {
            return e.Category != null && e.Category.CategoryType == CategoryType.Model && !(e is RevitLinkInstance)
                   && e.Category.Id.Value != (long)BuiltInCategory.OST_Rooms && e.Category.Id.Value != (long)BuiltInCategory.OST_Levels;
        }

        private static bool IsFurnishing(Document doc, long id)
        {
            Element e = doc.GetElement(new ElementId(id));
            if (e == null || e.Category == null) return false;
            long c = e.Category.Id.Value;
            return c == (long)BuiltInCategory.OST_Furniture || c == (long)BuiltInCategory.OST_Casework || c == (long)BuiltInCategory.OST_Walls;
        }

        private static bool InRoom(Document doc, long id, Geo.LinkedRoom lr)
        {
            Element e = doc.GetElement(new ElementId(id));
            BoundingBoxXYZ bb = e != null ? e.get_BoundingBox(null) : null;
            if (bb == null) return false;
            XYZ c = (bb.Min + bb.Max) * 0.5;
            // 2026-10-16 (SURF-LINK-201A): өрөө нь ДАВХАРТ — доод давхрын (101) тавилга дээд давхрын 201A-ийн XY дотор байсан ч тэр өрөөнд биш.
            // Төв нь өрөөний түвшнээс (−50 мм) өрөөний өндөр хүртэлх мужид байх ёстой.
            double height = Math.Max(U.Mm(2000), lr.Room.UnboundedHeight);
            if (c.Z < lr.LevelZ - U.Mm(50) || c.Z > lr.LevelZ + height) return false;
            return lr.Contains(new XYZ(c.X, c.Y, lr.LevelZ + U.Mm(1000)));
        }

        private static List<string> LinkedInsertsOfRoom(Geo.LinkedRoom lr)
        {
            var list = new List<string>();
            Document ld = lr.Room.Document;
            BoundingBoxXYZ rb = lr.Room.get_BoundingBox(null);
            if (rb == null) return list;
            double m = U.Mm(400);
            foreach (FamilyInstance fi in new FilteredElementCollector(ld).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>())
            {
                if (fi.Category == null) continue;
                long c = fi.Category.Id.Value;
                if (c != (long)BuiltInCategory.OST_Doors && c != (long)BuiltInCategory.OST_Windows) continue;
                var lp = fi.Location as LocationPoint;
                if (lp == null) continue;
                XYZ p = lp.Point;
                if (p.X < rb.Min.X - m || p.X > rb.Max.X + m || p.Y < rb.Min.Y - m || p.Y > rb.Max.Y + m) continue;
                if (fi.LevelId != lr.Room.LevelId) continue;
                list.Add(lr.Link.Id.Value + ":" + fi.Id.Value);
            }
            return list;
        }

        private static XYZ Avg(IEnumerable<XYZ> pts)
        {
            List<XYZ> l = pts.ToList();
            return new XYZ(l.Average(p => p.X), l.Average(p => p.Y), l.Average(p => p.Z));
        }
    }
}
