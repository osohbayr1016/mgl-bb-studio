using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using MglBb.Core;

namespace MglBb.RevitSide
{
    /// <summary>Хост буруу арматур: одоогийн хост → геометрээр зөв хост.</summary>
    internal sealed class BbHostFix
    {
        public Rebar Bar;
        public Element From, To;
        public double Share, FromShare;
    }

    /// <summary>
    /// «Хост засах»: арматурын тэнхлэг (эхний / дунд / сүүлийн байрлал) аль бүтээцийн биет дотор хамгийн их багтсаныг хэмжиж (<see cref="BbHostPick"/>)
    /// хост нь өөр бол <see cref="Rebar.SetHostId"/>-аар шилжүүлнэ.  Хэрэглэгч ТДН-4-ийн арматурыг тулгуур ДН-д хостлосноос дэлгээс түүнийг
    /// «хамааралгүй» гэж нууж байсан (ЖИШЭЭ-5, 2026-10-25).  Багана, дамнуруу = нэгдэл/зүсэлтээс ӨМНӨХ биет (хучилт дамнуругийг зүссэн ч дээд арматур
    /// дамнуруундаа үлдэнэ); хана, хучилт = загварын биет.  Area / Path reinforcement (RebarInSystem) хөндөхгүй.
    /// </summary>
    internal static class BbRebarHost
    {
        private sealed class Host
        {
            public Element E;
            public string Group;
            public int Priority;
            public double[] Box;
            public List<Solid> Solids;
        }

        private static readonly BuiltInCategory[] Cats =
        {
            BuiltInCategory.OST_StructuralFraming, BuiltInCategory.OST_StructuralColumns, BuiltInCategory.OST_Walls,
            BuiltInCategory.OST_StructuralFoundation, BuiltInCategory.OST_Floors,
        };

        private static int Priority(Element e)
        {
            long c = e.Category?.Id.Value ?? 0;
            if (c == (long)BuiltInCategory.OST_StructuralFraming) return BbHostPick.PriorityFraming;
            if (c == (long)BuiltInCategory.OST_StructuralColumns) return BbHostPick.PriorityColumn;
            if (c == (long)BuiltInCategory.OST_Floors) return BbHostPick.PriorityFloor;
            return BbHostPick.PriorityWall;
        }

        /// <summary>
        /// Шалгах арматур: <paramref name="scope"/>-д арматур байвал тэд; бүтээцийн элемент байвал тэдний хүрээг дайрсан бүх арматур; хоосон бол загварын бүх арматур.
        /// </summary>
        public static List<BbHostFix> Find(Document doc, ICollection<Element> scope, out int checkedCount, out int unclear)
        {
            checkedCount = unclear = 0;
            var hosts = new List<Host>();
            foreach (BuiltInCategory bic in Cats)
                foreach (Element e in new FilteredElementCollector(doc).OfCategory(bic).WhereElementIsNotElementType())
                {
                    BoundingBoxXYZ bb = e.get_BoundingBox(null);
                    if (bb == null) continue;
                    bool ok;
                    try { ok = RebarHostData.IsValidHost(e); } catch { ok = false; }
                    if (!ok) continue;
                    string mark = BbGeom.Mark(e);
                    hosts.Add(new Host { E = e, Priority = Priority(e), Box = Box(bb.Min, bb.Max), Group = mark.Length > 0 ? e.Category.Id.Value + ":" + mark : null });
                }

            var bars = new List<Rebar>();
            var picked = (scope ?? new Element[0]).ToList();
            bars.AddRange(picked.OfType<Rebar>());
            var zones = picked.Where(e => !(e is Rebar)).Select(e => e.get_BoundingBox(null)).Where(b => b != null).Select(b => Box(b.Min, b.Max)).ToList();
            if (bars.Count == 0)
            {
                IEnumerable<Rebar> all = new FilteredElementCollector(doc).OfClass(typeof(Rebar)).Cast<Rebar>();
                if (zones.Count > 0)
                {
                    double tol = BbGeom.Ft(50);
                    all = all.Where(r =>
                    {
                        BoundingBoxXYZ rb = r.get_BoundingBox(null);
                        if (rb == null) return false;
                        double[] a = Box(rb.Min, rb.Max);
                        return zones.Any(z => Overlap(a, z, tol));
                    });
                }
                bars.AddRange(all);
            }

            var fixes = new List<BbHostFix>();
            var opt = new SolidCurveIntersectionOptions { ResultType = SolidCurveIntersectionMode.CurveSegmentsInside };
            foreach (Rebar r in bars)
            {
                List<Curve> curves = Centerlines(r);
                if (curves.Count == 0) continue;
                checkedCount++;
                double total = 0;
                double x0 = double.MaxValue, y0 = double.MaxValue, z0 = double.MaxValue, x1 = double.MinValue, y1 = double.MinValue, z1 = double.MinValue;
                foreach (Curve c in curves)
                {
                    total += c.Length;
                    foreach (XYZ p in c.Tessellate())
                    {
                        double x = p.X, y = p.Y, z = p.Z;   // XYZ.X нь native дуудлага — нэг удаа
                        x0 = Math.Min(x0, x); y0 = Math.Min(y0, y); z0 = Math.Min(z0, z);
                        x1 = Math.Max(x1, x); y1 = Math.Max(y1, y); z1 = Math.Max(z1, z);
                    }
                }
                var box = new[] { x0, y0, z0, x1, y1, z1 };
                var cands = new List<BbHostCand>();
                var byId = new Dictionary<long, Element>();
                foreach (Host h in hosts)
                {
                    if (!Overlap(box, h.Box, 0.01)) continue;
                    if (h.Solids == null) h.Solids = SolidsOf(h.E);
                    double inside = 0;
                    foreach (Solid s in h.Solids)
                        foreach (Curve c in curves)
                        {
                            try
                            {
                                SolidCurveIntersection sci = s.IntersectWithCurve(c, opt);
                                for (int i = 0; i < sci.SegmentCount; i++) inside += sci.GetCurveSegment(i).Length;
                            }
                            catch { }
                        }
                    if (inside < 1e-6) continue;
                    cands.Add(new BbHostCand { Id = h.E.Id.Value, Group = h.Group, Priority = h.Priority, Inside = inside });
                    byId[h.E.Id.Value] = h.E;
                }
                long cur = r.GetHostId().Value;
                long to = BbHostPick.Pick(cur, total, cands, out double share, out double curShare);
                if (to == 0)
                {
                    if (share <= 0 && !cands.Any(c => c.Id == cur)) unclear++;
                    continue;
                }
                fixes.Add(new BbHostFix { Bar = r, From = doc.GetElement(r.GetHostId()), To = byId[to], Share = share, FromShare = curShare });
            }
            return fixes;
        }

        /// <summary>
        /// Хостыг шилжүүлж, нэрээр танигдах дэлгээсүүдэд харагдацыг тааруулна: шинэ хостын дэлгээсэд нуусныг харуулж, хуучин хостын дэлгээсэд нууна
        /// (<see cref="BbViews.HideForeignRebar"/>-тай ижил дүрэм).  Нээлттэй Transaction дотор.  Буцаах: шилжүүлсэн тоо.
        /// </summary>
        public static int Apply(Document doc, IList<BbHostFix> fixes, BbStandard std, List<string> errors, out int shown, out int hidden)
        {
            shown = hidden = 0;
            var done = new List<BbHostFix>();
            foreach (BbHostFix f in fixes)
            {
                try
                {
                    f.Bar.SetHostId(doc, f.To.Id);
                    done.Add(f);
                }
                catch (Exception ex) { errors.Add(f.Bar.Id.Value + ": " + ex.Message); }
            }
            if (done.Count == 0) return 0;
            doc.Regenerate();

            List<string> patterns = BbMarkTidy.ElevPatterns(std);
            foreach (ViewSection v in new FilteredElementCollector(doc).OfClass(typeof(ViewSection)).Cast<ViewSection>())
            {
                if (v.IsTemplate) continue;
                string mark = BbMarkNames.MarkOf(v.Name, patterns);
                if (mark == null) continue;
                var show = new List<ElementId>();
                var hide = new List<ElementId>();
                foreach (BbHostFix f in done)
                {
                    try
                    {
                        if (BbGeom.Mark(f.To) == mark && f.Bar.IsHidden(v)) show.Add(f.Bar.Id);
                        else if (f.From != null && BbGeom.Mark(f.From) == mark && BbGeom.Mark(f.To) != mark && !f.Bar.IsHidden(v) && f.Bar.CanBeHidden(v)) hide.Add(f.Bar.Id);
                    }
                    catch { }
                }
                try { if (show.Count > 0) { v.UnhideElements(show); shown += show.Count; } } catch { }
                try { if (hide.Count > 0) { v.HideElements(hide); hidden += hide.Count; } } catch { }
            }
            return done.Count;
        }

        public static string Describe(Element e)
        {
            if (e == null) return "(хостгүй)";
            string mark = BbGeom.Mark(e);
            return (e.Category?.Name ?? "?") + " " + (mark.Length > 0 ? mark : e.Name) + " [" + e.Id.Value + "]";
        }

        private static List<Curve> Centerlines(Rebar r)
        {
            var res = new List<Curve>();
            int n;
            try { n = r.NumberOfBarPositions; } catch { return res; }
            foreach (int i in new[] { 0, n / 2, n - 1 }.Where(i => i >= 0).Distinct())
            {
                try
                {
                    if (!r.DoesBarExistAtPosition(i)) continue;
                    res.AddRange(r.GetTransformedCenterlineCurves(false, true, true, MultiplanarOption.IncludeOnlyPlanarCurves, i));
                }
                catch { }
            }
            return res;
        }

        private static List<Solid> SolidsOf(Element e)
        {
            var res = new List<Solid>();
            var o = new Options { ComputeReferences = false, DetailLevel = ViewDetailLevel.Fine };
            // Дамнуруу / багана: нэгдэл, зүсэлтээс өмнөх биет (хучилт, багана зүссэн хэсэгт ч арматур өөрийн гишүүнд үлдэнэ).
            if (e is FamilyInstance fi)
            {
                try
                {
                    GeometryElement og = fi.GetOriginalGeometry(o);
                    if (og != null) Collect(og.GetTransformed(fi.GetTotalTransform()), res);
                }
                catch { }
                if (res.Count > 0) return res;
            }
            try { Collect(e.get_Geometry(o), res); } catch { }
            return res;
        }

        private static void Collect(GeometryElement ge, List<Solid> res)
        {
            if (ge == null) return;
            foreach (GeometryObject g in ge)
            {
                if (g is Solid s && s.Volume > 1e-9) res.Add(s);
                else if (g is GeometryInstance gi) Collect(gi.GetInstanceGeometry(), res);
            }
        }

        // XYZ.X нь native дуудлага — халуун давталтад double массив.
        private static double[] Box(XYZ min, XYZ max) { return new[] { min.X, min.Y, min.Z, max.X, max.Y, max.Z }; }

        private static bool Overlap(double[] a, double[] b, double tol)
        {
            return a[0] <= b[3] + tol && b[0] <= a[3] + tol && a[1] <= b[4] + tol && b[1] <= a[4] + tol && a[2] <= b[5] + tol && b[2] <= a[5] + tol;
        }
    }
}
