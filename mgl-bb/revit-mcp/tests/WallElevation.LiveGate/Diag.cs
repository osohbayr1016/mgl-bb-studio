using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace MglWeGate
{
    /// <summary>
    /// Шийдвэр гаргахад зориулсан ХЭМЖИЛТ (дүгнэлт БИШ) — production код хөндөхгүй, загварын өөрчлөлтийг БҮГДИЙГ буцаана (TransactionGroup.RollBack).
    /// <para>WE-BUG-001: хэрэгсэл «давхар хоорондын» (түвшин → түвшин) хэмжээсийн тулд crop-ыг дээд давхрын түвшнээс 100 мм дээш сунгадаг —
    /// тэр зурваст дээд айлын шал, тавилга харагдана.  Эзний асуулт: хэмжээсийг хадгалж crop-ыг түвшин дээр яг зогсоож болох уу?  Энд үүсгэсэн
    /// дэлгээсийн crop-ын дээд хилийг (а) дээд түвшин дээр, (б) түвшнээс 1 мм доор, (в) 60 мм доор тавиад хэмжинэ: дээд түвшин харагдацад
    /// харагдсаар уу, тэр түвшинг заасан хэмжээс хэвээр үү, дээд давхрын элемент харагдах уу — тус бүрд PNG.</para>
    /// </summary>
    internal static class Diagnostics
    {
        private static readonly double Tol = U.Mm(1);

        public static Scenario CropAtLevel(string id, string link, string room)
        {
            return new Scenario
            {
                Id = id, Title = "ХЭМЖИЛТ (WE-BUG-001): crop-ын дээд хилийг дээд түвшин дээр / доор тавихад түвшин, хэмжээс, дээд давхар", Category = "diagnostic",
                NoCommand = true,
                Setup = (app, L, res, st) => true,
                Inspect = (app, L, res, st) => Measure(app, L, res, st, link, room),
            };
        }

        private static void Measure(UIApplication app, LiveContext L, ScenarioResult res, ScnState st, string link, string room)
        {
            Document doc = app.ActiveUIDocument.Document;
            List<long> made;
            if (!L.Generated.TryGetValue(room, out made) || made.Count == 0) { res.Add("diag", "BLOCKED", room + "-ийн үүсгэсэн дэлгээс алга"); return; }
            Geo.LinkedRoom lr = Geo.FindRoom(doc, link, room);
            if (lr == null) { res.Add("diag", "BLOCKED", room + " олдсонгүй"); return; }
            double upperZ = lr.LevelZ + U.Mm(Synth.L2);
            List<View> views = made.Select(i => doc.GetElement(new ElementId(i)) as View).Where(v => v != null).ToList();
            Level upper = new FilteredElementCollector(doc).OfClass(typeof(Level)).Cast<Level>()
                .OrderBy(l => Math.Abs(l.ProjectElevation - upperZ)).FirstOrDefault(l => Math.Abs(l.ProjectElevation - upperZ) < U.Mm(5));
            res.Info("diag.upper_level", upper == null ? "host-д дээд түвшин (≈ " + Geo.S(U.ToMm(upperZ)) + " мм) алга" : "«" + upper.Name + "» #" + upper.Id.Value + " " + Geo.S(U.ToMm(upper.ProjectElevation)) + " мм");
            var upperHost = new HashSet<long>(Inspector.IdsFactPublic(L, "upper_storey_host_ids"));
            List<RevitLinkInstance> links = new FilteredElementCollector(doc).OfClass(typeof(RevitLinkInstance)).Cast<RevitLinkInstance>().Where(l => l.GetLinkDocument() != null).ToList();

            // Одоогийн (хэрэгслийн) байдал + гурван хувилбар.  null = хөндөхгүй.
            var variants = new List<KeyValuePair<string, double?>>
            {
                new KeyValuePair<string, double?>("current", null),
                new KeyValuePair<string, double?>("at_level", 0),
                new KeyValuePair<string, double?>("level_minus_1mm", -1),
                new KeyValuePair<string, double?>("level_minus_60mm", -60),
            };
            using (var tg = new TransactionGroup(doc, "gate: diag crop at level"))
            {
                tg.Start();
                try
                {
                    foreach (KeyValuePair<string, double?> vt in variants)
                    {
                        if (vt.Value.HasValue)
                        {
                            var sw = new WarningSwallower();
                            using (Transaction t = WarningSwallower.Start(doc, "gate: crop " + vt.Key, sw))
                            {
                                foreach (View v in views) SetCropTop(v, upperZ + U.Mm(vt.Value.Value));
                                t.Commit();   // Commit өөрөө regenerate хийнэ (гүйлгээний гадна Regenerate() = InvalidOperationException, 2027-д хэмжсэн)
                            }
                        }
                        int levelVisible = 0, dimsToUpper = 0, dimsTotal = 0, leaks = 0;
                        var leakSample = new List<string>();
                        foreach (View v in views)
                        {
                            List<XYZ> c = Geo.CropCorners(v);
                            double top = c.Max(p => p.Z), bottom = c.Min(p => p.Z);
                            if (upper != null && new FilteredElementCollector(doc, v.Id).OfClass(typeof(Level)).ToElementIds().Contains(upper.Id)) levelVisible++;
                            foreach (Dimension d in new FilteredElementCollector(doc, v.Id).OfClass(typeof(Dimension)).Cast<Dimension>())
                            {
                                dimsTotal++;
                                bool toUpper = false;
                                try { foreach (Reference r in d.References) if (upper != null && r.ElementId == upper.Id) toUpper = true; } catch { }
                                if (toUpper) dimsToUpper++;
                            }
                            foreach (Element e in new FilteredElementCollector(doc, v.Id).WhereElementIsNotElementType())
                            {
                                if (!Inspector.IsModelPublic(e)) continue;
                                BoundingBoxXYZ bb = e.get_BoundingBox(null);
                                if (bb == null) continue;
                                bool up = upperHost.Contains(e.Id.Value) || bb.Min.Z >= upperZ - Tol;
                                double ov = Math.Min(top, bb.Max.Z) - Math.Max(bottom, bb.Min.Z);
                                if (up && ov > Tol) { leaks++; if (leakSample.Count < 4) leakSample.Add(v.Name + " host " + e.Category.Name + " #" + e.Id.Value); }
                            }
                            foreach (RevitLinkInstance li in links)
                            {
                                Transform tf = li.GetTotalTransform();
                                foreach (Element e in new FilteredElementCollector(doc, v.Id, li.Id).WhereElementIsNotElementType())
                                {
                                    if (!Inspector.IsModelPublic(e)) continue;
                                    BoundingBoxXYZ bb = e.get_BoundingBox(null);
                                    if (bb == null) continue;
                                    double minZ = Math.Min(tf.OfPoint(bb.Min).Z, tf.OfPoint(bb.Max).Z), maxZ = Math.Max(tf.OfPoint(bb.Min).Z, tf.OfPoint(bb.Max).Z);
                                    double ov = Math.Min(top, maxZ) - Math.Max(bottom, minZ);
                                    if (minZ >= upperZ - Tol && ov > Tol) { leaks++; if (leakSample.Count < 4) leakSample.Add(v.Name + " link " + e.Category.Name + " #" + e.Id.Value); }
                                }
                            }
                        }
                        List<XYZ> c0 = Geo.CropCorners(views[0]);
                        res.Info("diag." + vt.Key,
                                 "crop дээд = дээд түвшин " + (c0.Max(p => p.Z) - upperZ >= 0 ? "+" : "") + Geo.S(U.ToMm(c0.Max(p => p.Z) - upperZ)) + " мм · "
                                 + "дээд түвшин харагдсан дэлгээс " + levelVisible + "/" + views.Count + " · дээд түвшинг заасан хэмжээс " + dimsToUpper + " (нийт " + dimsTotal + ") · "
                                 + "дээд давхрын элемент " + leaks + (leakSample.Count > 0 ? " (" + string.Join("; ", leakSample) + ")" : ""));
                        Inspector.Export(doc, views.Take(1).Select(v => v.Id).ToList(), L, res, st, vt.Key);
                    }
                }
                finally { tg.RollBack(); }
            }
            res.Add("diag.rolled_back", "PASS", "бүх өөрчлөлт буцаагдсан (TransactionGroup.RollBack)");
        }

        /// <summary>Дэлгээсийн crop-ын дээд хилийг дэлхийн Z = <paramref name="z"/> болгоно (харагдацын «дээш» = +Z).</summary>
        private static void SetCropTop(View v, double z)
        {
            BoundingBoxXYZ cb = v.CropBox;
            Transform tf = cb.Transform;
            if (Math.Abs(tf.BasisY.Z) < 0.99) return;   // босоо бус харагдац
            double curTop = tf.OfPoint(new XYZ(0, cb.Max.Y, 0)).Z;
            double dy = (z - curTop) / tf.BasisY.Z;
            cb.Max = new XYZ(cb.Max.X, cb.Max.Y + dy, cb.Max.Z);
            v.CropBox = cb;
        }
    }
}
