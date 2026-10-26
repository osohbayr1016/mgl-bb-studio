using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using MglBb.Core;

namespace MglBb.RevitSide
{
    /// <summary>Харагдацын хүрээ: R (баруун), U (дээш), V (харагч руу).  Crop box-той ЯГ ижил (хэмжсэн: CropBox.Transform = (Right, Up, ViewDirection)).</summary>
    internal struct BbFrame
    {
        public XYZ O, R, U, V;

        public static BbFrame Of(View v)
        {
            BoundingBoxXYZ cb = v.CropBox;
            Transform t = cb.Transform;
            return new BbFrame { O = t.Origin, R = t.BasisX, U = t.BasisY, V = t.BasisZ };
        }

        public static BbFrame Make(XYZ origin, XYZ right, XYZ up)
        {
            XYZ r = right.Normalize(), u = up.Normalize();
            return new BbFrame { O = origin, R = r, U = u, V = r.CrossProduct(u).Normalize() };
        }

        /// <summary>Загварын цэг → (r, u, v) фут.</summary>
        public XYZ Local(XYZ p)
        {
            XYZ d = p - O;
            return new XYZ(d.DotProduct(R), d.DotProduct(U), d.DotProduct(V));
        }

        public XYZ World(double r, double u, double v) { return O + R * r + U * u + V * v; }

        /// <summary>Загварын bbox-ийн 8 оройг энэ хүрээнд — (min, max).</summary>
        public void Extent(BoundingBoxXYZ b, out XYZ min, out XYZ max)
        {
            Transform t = b.Transform ?? Transform.Identity;
            double[] lo = { double.MaxValue, double.MaxValue, double.MaxValue }, hi = { double.MinValue, double.MinValue, double.MinValue };
            for (int i = 0; i < 8; i++)
            {
                XYZ c = new XYZ((i & 1) == 0 ? b.Min.X : b.Max.X, (i & 2) == 0 ? b.Min.Y : b.Max.Y, (i & 4) == 0 ? b.Min.Z : b.Max.Z);
                XYZ q = Local(t.OfPoint(c));
                lo[0] = Math.Min(lo[0], q.X); lo[1] = Math.Min(lo[1], q.Y); lo[2] = Math.Min(lo[2], q.Z);
                hi[0] = Math.Max(hi[0], q.X); hi[1] = Math.Max(hi[1], q.Y); hi[2] = Math.Max(hi[2], q.Z);
            }
            min = new XYZ(lo[0], lo[1], lo[2]);
            max = new XYZ(hi[0], hi[1], hi[2]);
        }
    }

    /// <summary>Нэг тэмдэгтэй, нэг түвшинд, нэг шугам дээрх дамнуругуудын ГИНЖ (олон алгасалтай дамнуруу ДН-1 = 1..N framing элемент).</summary>
    internal sealed class BbBeamChain
    {
        public string Mark = "";
        public readonly List<FamilyInstance> Members = new List<FamilyInstance>();
        public XYZ Axis;          // хэвтээ, нэгж (эхний гишүүний p0→p1)
        public XYZ Origin;        // тэнхлэгийн 0 цэг (эхний гишүүний p0)
        public double S0, S1;     // тэнхлэгийн дагуух муж (фут) — геометрийн
        public double Bottom, Top;        // Z (фут) — геометрийн
        public double Near, Far;          // тэнхлэгт перпендикуляр (V тэнхлэг, харагч тал = Near) — геометрийн
        public readonly List<BbSpan> Supports = new List<BbSpan>();   // мм, тэнхлэгийн дагуу
        public bool Aux;
        public int RebarCount;

        public double Station(XYZ p) { return (p - Origin).DotProduct(Axis); }
    }

    internal static class BbGeom
    {
        public const double Mm = 304.8;
        public static double Ft(double mm) { return mm / Mm; }
        public static double ToMm(double ft) { return ft * Mm; }

        public static string Mark(Element e)
        {
            try
            {
                Parameter p = e.get_Parameter(BuiltInParameter.ALL_MODEL_MARK);
                return p == null ? "" : (p.AsString() ?? "").Trim();
            }
            catch { return ""; }
        }

        public static int RebarCount(Element e)
        {
            try
            {
                if (!RebarHostData.IsValidHost(e)) return 0;
                RebarHostData hd = RebarHostData.GetRebarHostData(e);
                return hd == null ? 0 : hd.GetRebarsInHost().Count;
            }
            catch { return 0; }
        }

        /// <summary>
        /// Огтлолд арматур нь харагдаж буй гинжийн гишүүд (эхнийх нь зүсэгдсэн гишүүн өөрөө).  Гинжийн арматур ихэнхдээ нэг гишүүнд хостлогддог
        /// (ЖИШЭЭ-1 ДН-9: 2 элемент, ажлын арматур 1-рт, хомут 2-рт) — зөвхөн зүсэгдсэн гишүүний арматурыг уншвал огтлол хоосон гардаг байв.
        /// </summary>
        public static IList<Element> ChainHostsInView(Document doc, View view, Element host)
        {
            var res = new List<Element> { host };
            if (!(host is FamilyInstance fi) || fi.Category == null) return res;
            bool framing = fi.Category.Id.Value == (long)BuiltInCategory.OST_StructuralFraming, column = fi.Category.Id.Value == (long)BuiltInCategory.OST_StructuralColumns;
            if (!framing && !column) return res;
            var hostsWithBars = new HashSet<long>();
            try
            {
                foreach (Rebar r in new FilteredElementCollector(doc, view.Id).OfClass(typeof(Rebar)).Cast<Rebar>())
                    hostsWithBars.Add(r.GetHostId().Value);
            }
            catch { return res; }
            // Багана: давхар бүрийн элемент; ажлын арматур ихэвчлэн доод давхарт хостлогдож дээш үргэлжилдэг.
            IEnumerable<FamilyInstance> members = framing ? BeamChain(doc, fi).Members : (IEnumerable<FamilyInstance>)BbColumns.Stack(doc, fi).Members;
            foreach (FamilyInstance m in members)
                if (m.Id != host.Id && hostsWithBars.Contains(m.Id.Value)) res.Add(m);
            return res;
        }

        public static bool LineOf(Element e, out XYZ p0, out XYZ p1)
        {
            p0 = p1 = null;
            try
            {
                if (e.Location is LocationCurve lc && lc.Curve is Line ln)
                {
                    p0 = ln.GetEndPoint(0);
                    p1 = ln.GetEndPoint(1);
                    return true;
                }
            }
            catch { }
            return false;
        }

        /// <summary>Тэмдэг «Т»-ээр эхэлсэн (ТДН, ТДДН) = туслах дамнуруу (ЖИШЭЭ-1: ТДН 109 дэлгээс бүгд «Туслах» төрлөөр).</summary>
        public static bool IsAuxMark(string mark)
        {
            return !string.IsNullOrEmpty(mark) && (mark.StartsWith("Т", StringComparison.Ordinal) || mark.StartsWith("T", StringComparison.Ordinal));
        }

        /// <summary>
        /// Сонгосон дамнурууны ГИНЖ: ижил тэмдэгтэй, ижил өндөрт (±50 мм), параллель (≤ 2°), нэг шугам дээр (≤ 100 мм) бүх framing элемент.
        /// Тэмдэггүй бол зөвхөн өөрөө.
        /// </summary>
        /// <param name="gridOrder">Ажлын зураг: тэнхлэгийг дайрсан тэнхлэгийн шугамууд (Grid) зүүнээс баруун тийш +1 = өсөх (FX1 → FX4),
        /// −1 = буурах (FX4 → FX1) эрэмбээр байхаар чиглүүлнэ (хэрэглэгч цонхонд сонгоно); огтлол түүнийг дагана (<see cref="BbGridOrder"/>).
        /// 0 = зурсан чиглэлээр (арматур, сургалт).</param>
        public static BbBeamChain BeamChain(Document doc, FamilyInstance seed, IEnumerable<FamilyInstance> sameMark = null, bool findSupports = true, int gridOrder = 0)
        {
            if (!LineOf(seed, out XYZ a0, out XYZ a1)) return null;
            XYZ ax = new XYZ(a1.X - a0.X, a1.Y - a0.Y, 0);
            if (ax.GetLength() < 1e-6) return null;
            ax = ax.Normalize();
            var chain = new BbBeamChain { Mark = Mark(seed), Axis = ax, Origin = new XYZ(a0.X, a0.Y, a0.Z) };
            chain.Aux = IsAuxMark(chain.Mark);
            XYZ perp = new XYZ(-ax.Y, ax.X, 0);
            var cands = new List<FamilyInstance> { seed };
            if (!string.IsNullOrEmpty(chain.Mark))
            {
                foreach (FamilyInstance fi in sameMark ?? new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_StructuralFraming).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>())
                {
                    if (fi.Id == seed.Id || !string.Equals(Mark(fi), chain.Mark, StringComparison.Ordinal)) continue;
                    if (!LineOf(fi, out XYZ b0, out XYZ b1)) continue;
                    if (Math.Abs(b0.Z - a0.Z) > Ft(50) && Math.Abs(b1.Z - a0.Z) > Ft(50)) continue;
                    XYZ bx = new XYZ(b1.X - b0.X, b1.Y - b0.Y, 0);
                    if (bx.GetLength() < 1e-6) continue;
                    if (Math.Abs(bx.Normalize().DotProduct(ax)) < Math.Cos(Math.PI / 90)) continue;
                    // Нэг шугам дээр: хөндлөн огтлолын (перпендикуляр) муж давхцана — өөр өргөнтэй, нүүрээрээ тэгшилсэн хэсэг ч (ДН-9: 600 → 400, тэнхлэг 200 мм зөрүүтэй).
                    if (!PerpOverlap(seed, fi, perp)) continue;
                    cands.Add(fi);
                }
            }
            // Шугам дээрх ДАРААЛСАН хэсэг (2 м-ээс их завсартай бол өөр дамнуруу — нэг тэмдэг өөр газар давтагдсан).
            var withS = cands.Select(f => { LineOf(f, out XYZ p, out XYZ q); double s0 = chain.Station(p), s1 = chain.Station(q); return new { f, lo = Math.Min(s0, s1), hi = Math.Max(s0, s1) }; })
                .OrderBy(x => x.lo).ToList();
            int seedIdx = withS.FindIndex(x => x.f.Id == seed.Id);
            int iA = seedIdx, iB = seedIdx;
            while (iA > 0 && withS[iA].lo - withS[iA - 1].hi < Ft(2000)) iA--;
            while (iB < withS.Count - 1 && withS[iB + 1].lo - withS[iB].hi < Ft(2000)) iB++;
            for (int i = iA; i <= iB; i++) chain.Members.Add(withS[i].f);
            if (gridOrder != 0 && GridsFlip(doc, chain, withS[iA].lo, withS[iB].hi, gridOrder))
            {
                ax = ax.Negate();
                chain.Axis = ax;
                chain.Members.Reverse();
            }

            // Геометрийн хэмжээ (тэнхлэгийн хүрээнд)
            var fr = new BbFrame { O = chain.Origin, R = ax, U = XYZ.BasisZ, V = ax.CrossProduct(XYZ.BasisZ).Normalize() };
            double s0m = double.MaxValue, s1m = double.MinValue, zb = double.MaxValue, zt = double.MinValue, vn = double.MinValue, vf = double.MaxValue;
            foreach (FamilyInstance f in chain.Members)
            {
                BoundingBoxXYZ bb = f.get_BoundingBox(null);
                if (bb == null) continue;
                fr.Extent(bb, out XYZ mn, out XYZ mx);
                s0m = Math.Min(s0m, mn.X); s1m = Math.Max(s1m, mx.X);
                zb = Math.Min(zb, bb.Min.Z); zt = Math.Max(zt, bb.Max.Z);
                vf = Math.Min(vf, mn.Z); vn = Math.Max(vn, mx.Z);
                chain.RebarCount += RebarCount(f);
            }
            chain.S0 = s0m; chain.S1 = s1m; chain.Bottom = zb; chain.Top = zt; chain.Near = vn; chain.Far = vf;
            if (findSupports) FindSupports(doc, chain, fr);
            return chain;
        }

        /// <summary>Гинжийн шугамыг [<paramref name="lo"/>, <paramref name="hi"/>] (± 1 м) мужид дайрсан тэнхлэгүүдийг <paramref name="want"/> эрэмбэд оруулахын тулд эргүүлэх эсэх.</summary>
        private static bool GridsFlip(Document doc, BbBeamChain chain, double lo, double hi, int want)
        {
            var hits = new List<KeyValuePair<double, string>>();
            double ox = chain.Origin.X, oy = chain.Origin.Y, ax = chain.Axis.X, ay = chain.Axis.Y, pad = Ft(1000);
            try
            {
                foreach (Grid g in new FilteredElementCollector(doc).OfClass(typeof(Grid)).Cast<Grid>())
                {
                    if (!(g.Curve is Line ln)) continue;
                    XYZ g0 = ln.GetEndPoint(0), g1 = ln.GetEndPoint(1);
                    double gx = g1.X - g0.X, gy = g1.Y - g0.Y, glen = Math.Sqrt(gx * gx + gy * gy);
                    if (glen < 1e-6) continue;
                    gx /= glen; gy /= glen;
                    double cross = ax * gy - ay * gx;
                    if (Math.Abs(cross) < 0.5) continue;                 // 30°-аас бага өнцөгтэй — дайрахгүй
                    // O + t·a = G0 + u·g  →  t, u
                    double dx = g0.X - ox, dy = g0.Y - oy;
                    double t = (dx * gy - dy * gx) / cross, u = (dx * ay - dy * ax) / cross;
                    if (t < lo - pad || t > hi + pad || u < -pad || u > glen + pad) continue;
                    hits.Add(new KeyValuePair<double, string>(t, g.Name));
                }
            }
            catch { return false; }
            return BbGridOrder.Flip(hits, want);
        }

        private static bool PerpOverlap(Element a, Element b, XYZ perp)
        {
            BoundingBoxXYZ ba = a.get_BoundingBox(null), bb = b.get_BoundingBox(null);
            if (ba == null || bb == null) return false;
            double a0 = double.MaxValue, a1 = double.MinValue, b0 = double.MaxValue, b1 = double.MinValue;
            for (int i = 0; i < 4; i++)
            {
                XYZ pa = new XYZ((i & 1) == 0 ? ba.Min.X : ba.Max.X, (i & 2) == 0 ? ba.Min.Y : ba.Max.Y, 0);
                XYZ pb = new XYZ((i & 1) == 0 ? bb.Min.X : bb.Max.X, (i & 2) == 0 ? bb.Min.Y : bb.Max.Y, 0);
                double da = pa.DotProduct(perp), db = pb.DotProduct(perp);
                a0 = Math.Min(a0, da); a1 = Math.Max(a1, da); b0 = Math.Min(b0, db); b1 = Math.Max(b1, db);
            }
            return Math.Min(a1, b1) - Math.Max(a0, b0) > Ft(50);
        }

        /// <summary>Гинжийг дайрсан багана (болон богино хана) — тэнхлэгийн дагуух муж (мм), гинжийн эхлэлээс.  Туслах дамнуруунд хөндлөн
        /// дамнуруу ч тулгуур (ЖИШЭЭ-1: ТДН-ийн тулгуур нь гол дамнуруу).</summary>
        private static void FindSupports(Document doc, BbBeamChain chain, BbFrame fr)
        {
            double pad = Ft(200);
            XYZ lo = fr.World(chain.S0 - pad, 0, chain.Far - pad), hi = fr.World(chain.S1 + pad, 0, chain.Near + pad);
            var outline = new Outline(new XYZ(Math.Min(lo.X, hi.X), Math.Min(lo.Y, hi.Y), chain.Bottom - Ft(1500)),
                new XYZ(Math.Max(lo.X, hi.X), Math.Max(lo.Y, hi.Y), chain.Top - Ft(10)));
            var filter = new BoundingBoxIntersectsFilter(outline);
            foreach (BuiltInCategory cat in new[] { BuiltInCategory.OST_StructuralColumns, BuiltInCategory.OST_Walls })
            {
                foreach (Element e in new FilteredElementCollector(doc).OfCategory(cat).WhereElementIsNotElementType().WherePasses(filter))
                {
                    BoundingBoxXYZ bb = e.get_BoundingBox(null);
                    if (bb == null) continue;
                    fr.Extent(bb, out XYZ mn, out XYZ mx);
                    if (mx.Z < chain.Far - Ft(60) || mn.Z > chain.Near + Ft(60)) continue; // тэнхлэгийг хөндлөн огтлоогүй
                    if (cat == BuiltInCategory.OST_Walls && mx.X - mn.X > Ft(3000)) continue;        // урт хана = тулгуур биш (дагуу)
                    chain.Supports.Add(new BbSpan(ToMm(mn.X), ToMm(mx.X)));
                }
            }
            if (!chain.Aux) return;
            var mine = new HashSet<long>(chain.Members.Select(m => m.Id.Value));
            foreach (FamilyInstance fi in new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_StructuralFraming).OfClass(typeof(FamilyInstance)).WherePasses(filter).Cast<FamilyInstance>())
            {
                if (mine.Contains(fi.Id.Value)) continue;
                if (!LineOf(fi, out XYZ p0, out XYZ p1)) continue;
                XYZ d = new XYZ(p1.X - p0.X, p1.Y - p0.Y, 0);
                if (d.GetLength() < 1e-6 || Math.Abs(d.Normalize().DotProduct(chain.Axis)) > 0.2) continue; // хөндлөн биш
                BoundingBoxXYZ bb = fi.get_BoundingBox(null);
                if (bb == null || bb.Max.Z < chain.Top - Ft(100) || bb.Min.Z > chain.Bottom + Ft(100)) continue;
                fr.Extent(bb, out XYZ mn, out XYZ mx);
                if (mx.Z < chain.Far - Ft(60) || mn.Z > chain.Near + Ft(60)) continue;
                chain.Supports.Add(new BbSpan(ToMm(mn.X), ToMm(mx.X)));
            }
        }

        public static IEnumerable<FamilyInstance> BeamsWithRebar(Document doc)
        {
            foreach (FamilyInstance fi in new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_StructuralFraming).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>())
                if (RebarCount(fi) > 0) yield return fi;
        }

        public static ViewFamilyType FindVft(Document doc, string name, ViewFamily family)
        {
            var all = new FilteredElementCollector(doc).OfClass(typeof(ViewFamilyType)).Cast<ViewFamilyType>().Where(t => t.ViewFamily == family).ToList();
            if (!string.IsNullOrEmpty(name))
            {
                ViewFamilyType byName = all.FirstOrDefault(t => string.Equals(t.Name, name, StringComparison.Ordinal))
                    ?? all.FirstOrDefault(t => string.Equals(t.Name.Trim(), name.Trim(), StringComparison.OrdinalIgnoreCase));
                if (byName != null) return byName;
            }
            return all.FirstOrDefault();
        }

        /// <summary>Төслийн Detail харагдацын төрлүүдийн нэр (анхааруулгад — аль нэр байгааг харуулах).</summary>
        public static string DetailTypeNames(Document doc)
        {
            return string.Join("; ", new FilteredElementCollector(doc).OfClass(typeof(ViewFamilyType)).Cast<ViewFamilyType>()
                .Where(t => t.ViewFamily == ViewFamily.Detail).Select(t => "«" + t.Name + "»").OrderBy(n => n, StringComparer.CurrentCulture));
        }

        /// <summary>
        /// <paramref name="names"/>-ийн эхний таарсан төрөл (<see cref="BbCompanyRules.Pick"/>).  Олдохгүй бол <paramref name="matched"/> = false ба
        /// тэр гэр бүлийн эхний төрөл (дуудагч Асуудалд бичнэ).
        /// </summary>
        public static ViewFamilyType FindVft(Document doc, IList<string> names, ViewFamily family, out bool matched)
        {
            var all = new FilteredElementCollector(doc).OfClass(typeof(ViewFamilyType)).Cast<ViewFamilyType>().Where(t => t.ViewFamily == family).ToList();
            string pick = BbCompanyRules.Pick(all.Select(t => t.Name), names);
            matched = pick != null;
            return pick != null ? all.First(t => t.Name == pick) : all.FirstOrDefault();
        }

        public static View FindTemplate(Document doc, string name)
        {
            if (string.IsNullOrEmpty(name)) return null;
            return new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>()
                .FirstOrDefault(v => v.IsTemplate && string.Equals(v.Name, name, StringComparison.Ordinal));
        }

        public static string UniqueViewName(Document doc, string name)
        {
            var names = new HashSet<string>(new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>().Select(v => v.Name), StringComparer.Ordinal);
            if (!names.Contains(name)) return name;
            for (int i = 2; i < 1000; i++)
            {
                string n = name + " (" + i + ")";
                if (!names.Contains(n)) return n;
            }
            return name + " " + Guid.NewGuid().ToString("N").Substring(0, 6);
        }
    }
}
