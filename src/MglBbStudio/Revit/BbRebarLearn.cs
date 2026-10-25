using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using MglBb.Core;

namespace MglBb.RevitSide
{
    /// <summary>
    /// Загварт гараар тавьсан (MGL-BB-GEN биш) дамнурууны арматураас төслийн хэв маяг (<see cref="BbRebarStyle"/>) сурна: битүү хомут (Ø, гадна
    /// ирмэгийн хамгаалах үе, алхам), C-хомут (хөндлөн, ≤ 5 хэрчим), хажуугийн (дунд өндөрт), ажлын, муруй (налуу хэрчимтэй).  ЖИШЭЭ-1 / ЖИШЭЭ 3.
    /// </summary>
    internal static class BbRebarLearn
    {
        static double Mm(double ft) { return BbGeom.ToMm(ft); }

        public static BbRebarStyle FromModel(Document doc, IEnumerable<BbBeamGenItem> items, int maxChains = 400)
        {
            var smp = new BbRebarStyleSamples();
            int n = 0;
            foreach (BbBeamGenItem it in items)
            {
                if (it.Foreign == 0 || it.Skip != null || it.Members.Count == 0) continue;
                // Хазайсан / зэрэгцээ гишүүдтэй «өргөн» гинж (b > 1500 эсвэл b > 3h) — хэмжилт буруу, сурахгүй.
                if (it.Input.B > 1500 || it.Input.B > 3 * it.Input.H) continue;
                if (++n > maxChains) break;
                try { Chain(doc, it, smp); }
                catch { /* нэг гинжийн алдаа сурахыг зогсоохгүй */ }
            }
            BbRebarStyle st = smp.Build();
            // @150 шилжилт: туслахгүй, гар хомуттай гинжүүдэд хоёр хувилбарыг төлөвлөж жишээтэй таарсныг тоолно (ЖИШЭЭ-1 — шилжилттэй, ЖИШЭЭ 3 — үгүй).
            // Дараа нь туслахтай гинжүүдэд зурвас (шилжилт тогтсоны дараа).
            for (int pass = 0; pass < 2 && !st.Empty; pass++)
            {
                int k = 0;
                foreach (BbBeamGenItem it in items)
                {
                    if (it.Foreign == 0 || it.Skip != null || it.Members.Count == 0 || it.Aux) continue;
                    if (it.Input.B > 1500 || it.Input.B > 3 * it.Input.H) continue;
                    if ((it.Input.LoadPoints.Count > 0) != (pass == 1)) continue;
                    if (++k > 150) break;
                    try
                    {
                        List<double> ex = ExampleStirrups(doc, it);
                        if (ex.Count < 6) continue;
                        double dir = Math.Atan2(it.Chain.Axis.Y, it.Chain.Axis.X) * 180 / Math.PI;
                        bool lp = it.Input.LoadPoints.Count > 0;
                        var score = new double[2];
                        for (int v = 0; v < 2; v++)
                        {
                            BbBeamPreset p = BbBeamPreset.Company(it.Input.B);
                            st.Apply(p, it.Input.B, it.Input.H, dir);
                            if (lp) p.LoadPointBand = v == 1 ? 700 : 0;   // туслахтай: зурвас
                            else p.AverageTransition = v == 1;            // туслахгүй: @150 шилжилт
                            BbBeamRebar plan = BbBeamRebarPlan.Plan(it.Input, p);
                            var ours = plan.Stirrups.SelectMany(q => Enumerable.Range(0, q.Count).Select(j => q.X0 + j * q.Spacing)).ToList();
                            score[v] = ex.Count(x => ours.Any(y => Math.Abs(y - x) <= 30));
                        }
                        if (lp) smp.Band(score[0], score[1]);
                        else smp.Transition(score[0], score[1]);
                    }
                    catch { }
                }
                BbRebarStyle sc = smp.Build();
                st.Transition = sc.Transition;
                st.LoadPointBand = sc.LoadPointBand;
            }
            return st;
        }

        /// <summary>Гинжийн гар хомутын станцууд (мм, хэсгийн эхнээс; хос хомутыг 30 мм дотор нэг).</summary>
        static List<double> ExampleStirrups(Document doc, BbBeamGenItem it)
        {
            BbBeamChain ch = it.Chain;
            var fr = new BbFrame { O = ch.Origin, R = ch.Axis, U = XYZ.BasisZ, V = ch.Axis.CrossProduct(XYZ.BasisZ).Normalize() };
            var st = new List<double>();
            foreach (FamilyInstance m in it.Members)
                foreach (Rebar r in BbBeamRebarGen.RebarsOf(doc, m).Where(x => !BbBeamRebarGen.IsOwn(x)))
                {
                    var shape = doc.GetElement(r.GetShapeId()) as RebarShape;
                    if (shape == null || shape.RebarStyle != RebarStyle.StirrupTie) continue;
                    int n = 1;
                    try { n = r.NumberOfBarPositions; } catch { }
                    for (int i = 0; i < n; i++)
                    {
                        IList<Curve> cs;
                        try { cs = r.GetTransformedCenterlineCurves(false, true, true, MultiplanarOption.IncludeOnlyPlanarCurves, i); } catch { continue; }
                        if (cs.Count < 3) continue;
                        st.Add(Mm(fr.Local(cs[0].GetEndPoint(0)).X - it.S0));
                    }
                }
            return st.OrderBy(x => x).Aggregate(new List<double>(), (acc, x) => { if (acc.Count == 0 || x - acc[acc.Count - 1] > 30) acc.Add(x); return acc; });
        }

        /// <summary>Дэгээтэй эсэх: дэгээг дарахгүйгээр ≥ 3 хэрчим (дэгээгүй шулуун хөндлөн саваа = 1).</summary>
        static bool Hooked(Rebar r)
        {
            try { return r.GetTransformedCenterlineCurves(false, false, true, MultiplanarOption.IncludeOnlyPlanarCurves, 0).Count >= 3; }
            catch { return false; }
        }

        static void Chain(Document doc, BbBeamGenItem it, BbRebarStyleSamples smp)
        {
            BbBeamChain ch = it.Chain;
            var fr = new BbFrame { O = ch.Origin, R = ch.Axis, U = XYZ.BasisZ, V = ch.Axis.CrossProduct(XYZ.BasisZ).Normalize() };
            double B = it.Input.B, H = it.Input.H;
            double dir = Math.Atan2(ch.Axis.Y, ch.Axis.X) * 180 / Math.PI;
            string key = it.Key + "#" + it.Members[0].Id.Value;
            // Локал (мм): x = станц, y = өндөр (доод нүүрээс), v = хөндлөн (алс нүүрээс).
            Func<XYZ, double[]> loc = q =>
            {
                XYZ l = fr.Local(q);
                return new[] { Mm(l.X - it.S0), Mm(q.Z - it.Bottom), Mm(l.Z - it.Far) };
            };
            foreach (FamilyInstance m in it.Members)
                foreach (Rebar r in BbBeamRebarGen.RebarsOf(doc, m).Where(x => !BbBeamRebarGen.IsOwn(x)))
                {
                    var bt = doc.GetElement(r.GetTypeId()) as RebarBarType;
                    if (bt == null) continue;
                    int d = (int)Math.Round(Mm(bt.BarModelDiameter));
                    IList<Curve> cs;
                    try { cs = r.GetTransformedCenterlineCurves(false, true, true, MultiplanarOption.IncludeOnlyPlanarCurves, 0); }
                    catch { continue; }
                    if (cs.Count == 0) continue;
                    var segs = cs.Where(c => c is Line).Select(c => new[] { loc(c.GetEndPoint(0)), loc(c.GetEndPoint(1)) }).ToList();
                    if (segs.Count == 0) continue;
                    double xSpan = segs.Max(s => Math.Max(s[0][0], s[1][0])) - segs.Min(s => Math.Min(s[0][0], s[1][0]));
                    var shape = doc.GetElement(r.GetShapeId()) as RebarShape;
                    bool tieStyle = shape != null && shape.RebarStyle == RebarStyle.StirrupTie;
                    if (xSpan < 30)
                    {
                        // Хөндлөн хавтгайд: битүү хомут (≥ 2 босоо хөл) эсвэл C-хомут (хэвтээ шулуун, хоёр үзүүрт дэгээ).
                        var vert = segs.Where(s => Math.Abs(s[0][2] - s[1][2]) < 1 && Math.Abs(s[0][1] - s[1][1]) > 50).ToList();
                        var horz = segs.Where(s => Math.Abs(s[0][1] - s[1][1]) < 1 && Math.Abs(s[0][2] - s[1][2]) > 50).ToList();
                        if (vert.Count >= 2 && horz.Count >= 1)
                        {
                            double vMin = vert.Min(s => s[0][2]), vMax = vert.Max(s => s[0][2]);
                            double yMin = horz.Min(s => s[0][1]), yMax = horz.Max(s => s[0][1]);
                            double side = Math.Min(vMin, B - vMax) - d / 2.0, bot = yMin - d / 2.0, top = H - yMax - d / 2.0;
                            // Давхардсан хоёр битүүгийн дотор нь гадна нүүрт хүрэхгүй — тал / доод / дээд нь бүхэлдээ ирмэгт ойрхон бол л.
                            if (side > 100) side = 0;
                            double sp = 0;
                            try { if (r.LayoutRule != RebarLayoutRule.Single) sp = Mm(r.MaxSpacing); } catch { }
                            smp.Stirrup(key, B, H, dir, d, bt.Name, side, bot, top, sp);
                        }
                        else if (horz.Count >= 1 && vert.Count == 0 && segs.Count <= 5 && Hooked(r))   // дэгээтэй (180°) хөндлөн = C-хомут
                        {
                            var hz = horz.OrderByDescending(h => Math.Abs(h[1][2] - h[0][2])).First();
                            smp.Tie(key, d, bt.Name, Math.Min(Math.Min(hz[0][2], hz[1][2]), B - Math.Max(hz[0][2], hz[1][2])));
                        }
                        continue;
                    }
                    if (tieStyle) continue;
                    // Тэнхлэгийн дагуу: налуу хэрчимтэй (≥ 30° налуу, x ба y хоёуланд өөрчлөгдөнө) = муруй.
                    bool sloped = segs.Any(s => Math.Abs(s[1][0] - s[0][0]) > 50 && Math.Abs(s[1][1] - s[0][1]) > 100);
                    int nPos = 1;
                    try { nPos = r.NumberOfBarPositions; } catch { }
                    if (sloped) { smp.Bent(key, B, nPos, d, bt.Name); continue; }
                    var along = segs.Where(s => Math.Abs(s[1][0] - s[0][0]) > 300 && Math.Abs(s[1][1] - s[0][1]) < 1).ToList();
                    if (along.Count == 0) continue;
                    double y = along.OrderByDescending(s => Math.Abs(s[1][0] - s[0][0])).First()[0][1];
                    if (y > 0.2 * H && y < 0.8 * H) smp.Side(key, d, bt.Name);
                    else smp.Main(key, d, bt.Name, d <= 12 && y > 0.5 * H);
                }
        }

        /// <summary>
        /// Баганын гар арматураас (<see cref="BbColumnStyle"/>): гадна битүү хомут (хамгаалах үе, Ø, алхам, эхний / сүүлийн), дотоод хосын тоо,
        /// саваа нүүрээс, залгаасын бүлгийн өндөр (шалнаас дээш эхэлсэн савааны хамгийн доод нь).
        /// </summary>
        public static BbColumnStyle FromColumns(Document doc, IEnumerable<BbColumnGenItem> items, int maxColumns = 400)
        {
            var smp = new BbColumnStyleSamples();
            int n = 0;
            foreach (BbColumnGenItem it in items)
            {
                if (it.Foreign == 0 || it.Skip != null) continue;
                if (++n > maxColumns) break;
                try { Column(doc, it, smp); }
                catch { }
            }
            return smp.Build();
        }

        static void Column(Document doc, BbColumnGenItem it, BbColumnStyleSamples smp)
        {
            double B = it.Input.B, H = it.Input.H, Hz = it.Input.Height;
            string key = it.Mark + "#" + it.Column.Id.Value;
            Func<XYZ, double[]> loc = q =>
            {
                XYZ l = it.Frame.Local(q);
                return new[] { Mm(l.X - it.X0), Mm(l.Y - it.Y0), Mm(q.Z - it.Z0) };
            };
            var boxes = new List<double[]>();   // x0, x1, y0, y1, d
            double outerArea = 0;
            double[] outer = null;
            Rebar outerBar = null;
            var bars = new List<double[]>();   // x, y, zStart
            foreach (Rebar r in BbBeamRebarGen.RebarsOf(doc, it.Column).Where(x => !BbBeamRebarGen.IsOwn(x)))
            {
                var bt = doc.GetElement(r.GetTypeId()) as RebarBarType;
                if (bt == null) continue;
                int d = (int)Math.Round(Mm(bt.BarModelDiameter));
                IList<Curve> cs;
                try { cs = r.GetTransformedCenterlineCurves(false, true, true, MultiplanarOption.IncludeOnlyPlanarCurves, 0); }
                catch { continue; }
                var pts = cs.Where(c => c is Line).SelectMany(c => new[] { loc(c.GetEndPoint(0)), loc(c.GetEndPoint(1)) }).ToList();
                if (pts.Count == 0) continue;
                double zr = pts.Max(q => q[2]) - pts.Min(q => q[2]);
                if (zr < 30 && cs.Count >= 4)
                {
                    // Хэрчмийн тогтмол координатаар (дэгээний давхцлын сунгалт булангаас d/2 гарна — min/max-аар бол хамгаалах үе 22 → 18).
                    var segs = cs.Where(c => c is Line).Select(c => new[] { loc(c.GetEndPoint(0)), loc(c.GetEndPoint(1)) }).ToList();
                    var xs = segs.Where(s => Math.Abs(s[0][0] - s[1][0]) < 1 && Math.Abs(s[0][1] - s[1][1]) > 50).Select(s => s[0][0]).ToList();
                    var ys = segs.Where(s => Math.Abs(s[0][1] - s[1][1]) < 1 && Math.Abs(s[0][0] - s[1][0]) > 50).Select(s => s[0][1]).ToList();
                    if (xs.Count < 2 || ys.Count < 2) continue;
                    double[] bx = { xs.Min(), xs.Max(), ys.Min(), ys.Max(), d };
                    boxes.Add(bx);
                    double area = (bx[1] - bx[0]) * (bx[3] - bx[2]);
                    if (area > outerArea) { outerArea = area; outer = bx; outerBar = r; }
                    continue;
                }
                if (zr > 500)
                {
                    double[] lo = pts.OrderBy(q => q[2]).First();
                    bars.Add(new[] { lo[0], lo[1], lo[2] });
                }
            }
            if (outer != null)
            {
                int d = (int)outer[4];
                double cov = new[] { outer[0], outer[2], B - outer[1], H - outer[3] }.Min() - d / 2.0;
                double sp = 0, z0 = 0, z1 = 0;
                try
                {
                    if (outerBar.LayoutRule != RebarLayoutRule.Single) sp = Mm(outerBar.MaxSpacing);
                    int np = outerBar.NumberOfBarPositions;
                    z0 = outerBar.GetTransformedCenterlineCurves(false, true, true, MultiplanarOption.IncludeOnlyPlanarCurves, 0).Select(c => loc(c.GetEndPoint(0))[2]).Min();
                    z1 = outerBar.GetTransformedCenterlineCurves(false, true, true, MultiplanarOption.IncludeOnlyPlanarCurves, np - 1).Select(c => loc(c.GetEndPoint(0))[2]).Max();
                }
                catch { }
                if (z1 < z0) { double t = z0; z0 = z1; z1 = t; }
                smp.Ties(key, cov, d, sp, z0, Hz - z1);
            }
            if (bars.Count >= 4)
            {
                double inset = bars.Min(q => Math.Min(Math.Min(q[0], q[1]), Math.Min(B - q[0], H - q[1])));
                // Нэг нүүрийн ширхэг: доод (y ≈ inset) мөрийн ялгаатай x; X-ийн дагуух нарийн хос = x-д нарийн, y-д бүтэн.
                int perSide = bars.Where(q => q[1] < inset + 25).Select(q => Math.Round(q[0] / 10)).Distinct().Count();
                // Ялгаатай хэлбэрээр (өндрийн дагуух олон бүлэг нэг хос — ЖИШЭЭ-4-ийн 47 м багана «15 хос» гэж гарч байв).
                int pairsX = boxes.Where(bx => bx[1] - bx[0] < 0.5 * B && bx[3] - bx[2] > 0.7 * H).Select(bx => Math.Round(bx[0] / 10) + ":" + Math.Round(bx[1] / 10)).Distinct().Count();
                smp.Bars(key, inset, perSide, boxes.Count > 0 ? pairsX : -1);
                var starts = bars.Select(q => q[2]).Where(z => z > 100 && z < Hz).ToList();
                if (starts.Count >= 2) smp.Stagger(key, Hz, starts.Min());
            }
        }
    }
}
