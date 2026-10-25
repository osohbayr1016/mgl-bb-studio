using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;

namespace MglBb.RevitSide
{
    /// <summary>
    /// Тэнхлэг/түвшний хэмжээсийн гинж — ЖИШЭЭ-1 «ЦУТГАМАЛ ХАНА ЦХ-1 ХЭВ/АРМАТУРЧЛАЛ»: тэнхлэгийн 2 гинж + түвшний 1 гинж («Арматур хэмжээ -
    /// 2.5 / Алхам»); «4.93 ТҮВШНИЙ ХУЧИЛТЫН … АРМАТУРЧЛАЛ»: тэнхлэгийн 4 гинж («… Opaque»: хоёр чиглэлд тэнхлэг бүр + нийт).
    /// Лавлагаа = тэнхлэг/түвшний элемент өөрөө — гишүүний геометрээс хамааралгүй.  Нээлттэй Transaction дотор.  Үүсгэсэн тоо.
    /// </summary>
    internal static class BbGridDims
    {
        private const double Paper = 1 / 304.8;

        /// <summary>Хананы дэлгээс: доор тэнхлэгийн гинж (+ нийт), зүүн талд түвшний гинж.</summary>
        public static int WallElevation(Document doc, View view, IList<Element> hosts, DimensionType type, List<string> notes)
        {
            BbFrame f = BbFrame.Of(view);
            if (!Extent(f, hosts, out double r0, out double r1, out double u0, out double u1)) return 0;
            double sc = Math.Max(1, view.Scale);
            double off1 = 12 * Paper * sc, off2 = 20 * Paper * sc;
            int made = 0;

            // Тэнхлэг: харагдацад БОСОО (ханад перпендикуляр) — r байрлал.
            var grids = new List<KeyValuePair<double, Reference>>();
            foreach (Grid g in new FilteredElementCollector(doc, view.Id).OfClass(typeof(Grid)).Cast<Grid>())
            {
                if (!(g.Curve is Line gl)) continue;
                XYZ d = gl.Direction;
                if (Math.Abs(d.DotProduct(f.R)) > 0.02) continue;
                double r = f.Local(gl.GetEndPoint(0)).X;
                if (r < r0 - 6 || r > r1 + 6) continue;      // ханын захын тэнхлэг (ЦХ-1: Y7, Y1) ханаас ~0.3 м гадна
                grids.Add(new KeyValuePair<double, Reference>(r, new Reference(g)));
            }
            grids = Distinct(grids);
            if (grids.Count >= 2)
            {
                made += Chain(doc, view, f, grids, horizontal: true, at: u0 - off1, type, notes);
                if (grids.Count >= 3) made += Chain(doc, view, f, new List<KeyValuePair<double, Reference>> { grids[0], grids[grids.Count - 1] }, true, u0 - off2, type, notes);
            }

            // Түвшин: харагдацад ХЭВТЭЭ — u байрлал (харагдацын U нь босоо үед л).
            if (Math.Abs(f.U.Z) > 0.99)
            {
                var levels = new List<KeyValuePair<double, Reference>>();
                foreach (Level lv in new FilteredElementCollector(doc, view.Id).OfClass(typeof(Level)).Cast<Level>())
                {
                    double u = f.Local(new XYZ(f.O.X, f.O.Y, lv.ProjectElevation)).Y;
                    if (u < u0 - 0.5 || u > u1 + 0.5) continue;
                    Reference rf;
                    try { rf = lv.GetPlaneReference(); } catch { rf = null; }
                    if (rf != null) levels.Add(new KeyValuePair<double, Reference>(u, rf));
                }
                levels = Distinct(levels);
                if (levels.Count >= 2) made += Chain(doc, view, f, levels, horizontal: false, at: r0 - off1, type, notes);
            }
            return made;
        }

        /// <summary>Хучилтын төлөвлөгөө: доор босоо тэнхлэгүүдийн гинж + нийт, зүүн талд хэвтээ тэнхлэгүүдийн гинж + нийт.</summary>
        public static int SlabPlan(Document doc, View view, IList<Element> hosts, DimensionType type, List<string> notes)
        {
            return Plan(doc, view, hosts, type, notes, false, 12, 20);
        }

        /// <summary>Рамын байгуулалт (ЖИШЭЭ-2 3-1): доор босоо тэнхлэгүүдийн гинж + нийт, БАРУУН талд хэвтээ тэнхлэгүүдийн гинж + нийт.</summary>
        public static int FramePlan(Document doc, View view, IList<Element> hosts, DimensionType type, List<string> notes, double chainPaperMm, double totalPaperMm)
        {
            return Plan(doc, view, hosts, type, notes, true, chainPaperMm, totalPaperMm);
        }

        private static int Plan(Document doc, View view, IList<Element> hosts, DimensionType type, List<string> notes, bool right, double chainPaperMm, double totalPaperMm)
        {
            BbFrame f = BbFrame.Of(view);
            if (!Extent(f, hosts, out double r0, out double r1, out double u0, out double u1)) return 0;
            double sc = Math.Max(1, view.Scale);
            double off1 = chainPaperMm * Paper * sc, off2 = totalPaperMm * Paper * sc;
            var alongR = new List<KeyValuePair<double, Reference>>();   // харагдацад босоо тэнхлэг → r
            var alongU = new List<KeyValuePair<double, Reference>>();   // хэвтээ тэнхлэг → u
            foreach (Grid g in new FilteredElementCollector(doc, view.Id).OfClass(typeof(Grid)).Cast<Grid>())
            {
                if (!(g.Curve is Line gl)) continue;
                XYZ d = gl.Direction;
                XYZ p = f.Local(gl.GetEndPoint(0));
                if (Math.Abs(d.DotProduct(f.R)) < 0.02) { if (p.X >= r0 - 1 && p.X <= r1 + 1) alongR.Add(new KeyValuePair<double, Reference>(p.X, new Reference(g))); }
                else if (Math.Abs(d.DotProduct(f.U)) < 0.02) { if (p.Y >= u0 - 1 && p.Y <= u1 + 1) alongU.Add(new KeyValuePair<double, Reference>(p.Y, new Reference(g))); }
            }
            alongR = Distinct(alongR);
            alongU = Distinct(alongU);
            // Төлөвлөгөөнд хэмжээсийн шугам түвшний өндөрт (харагдацын V = Z).
            double vz = 0;
            if (view is ViewPlan vp && vp.GenLevel != null && Math.Abs(f.V.Z) > 0.99) vz = (vp.GenLevel.ProjectElevation - f.O.Z) * Math.Sign(f.V.Z);
            int made = 0;
            if (alongR.Count >= 2)
            {
                made += Chain(doc, view, f, alongR, true, u0 - off1, type, notes, vz);
                if (alongR.Count >= 3) made += Chain(doc, view, f, new List<KeyValuePair<double, Reference>> { alongR[0], alongR[alongR.Count - 1] }, true, u0 - off2, type, notes, vz);
            }
            if (alongU.Count >= 2)
            {
                made += Chain(doc, view, f, alongU, false, right ? r1 + off1 : r0 - off1, type, notes, vz);
                if (alongU.Count >= 3) made += Chain(doc, view, f, new List<KeyValuePair<double, Reference>> { alongU[0], alongU[alongU.Count - 1] }, false, right ? r1 + off2 : r0 - off2, type, notes, vz);
            }
            return made;
        }

        private static bool Extent(BbFrame f, IList<Element> hosts, out double r0, out double r1, out double u0, out double u1)
        {
            r0 = u0 = double.MaxValue; r1 = u1 = double.MinValue;
            foreach (Element h in hosts)
            {
                BoundingBoxXYZ bb = h.get_BoundingBox(null);
                if (bb == null) continue;
                f.Extent(bb, out XYZ a, out XYZ b);
                r0 = Math.Min(r0, a.X); r1 = Math.Max(r1, b.X); u0 = Math.Min(u0, a.Y); u1 = Math.Max(u1, b.Y);
            }
            return r0 < r1 && u0 < u1;
        }

        private static List<KeyValuePair<double, Reference>> Distinct(List<KeyValuePair<double, Reference>> xs)
        {
            var res = new List<KeyValuePair<double, Reference>>();
            foreach (var x in xs.OrderBy(x => x.Key))
                if (res.Count == 0 || x.Key - res[res.Count - 1].Key > 0.03) res.Add(x);
            return res;
        }

        internal static int Chain(Document doc, View view, BbFrame f, List<KeyValuePair<double, Reference>> refs, bool horizontal, double at, DimensionType type, List<string> notes, double v = 0)
        {
            var ra = new ReferenceArray();
            foreach (var r in refs) ra.Append(r.Value);
            double a = refs[0].Key - 1, b = refs[refs.Count - 1].Key + 1;
            XYZ p0 = horizontal ? f.World(a, at, v) : f.World(at, a, v);
            XYZ p1 = horizontal ? f.World(b, at, v) : f.World(at, b, v);
            using (var st = new SubTransaction(doc))
            {
                st.Start();
                try
                {
                    Dimension d = type != null ? doc.Create.NewDimension(view, Line.CreateBound(p0, p1), ra, type) : doc.Create.NewDimension(view, Line.CreateBound(p0, p1), ra);
                    if (d == null) { st.RollBack(); return 0; }
                    st.Commit();
                    return 1;
                }
                catch (Exception ex)
                {
                    if (st.HasStarted() && !st.HasEnded()) st.RollBack();
                    notes.Add("«" + view.Name + "»: " + (horizontal ? "тэнхлэгийн" : "түвшний/тэнхлэгийн") + " гинж — " + ex.Message.Split('\n')[0]);
                    return 0;
                }
            }
        }
    }
}
