using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using MglBb.Core;

namespace MglBb.RevitSide
{
    /// <summary>Нэг дамнурууны гинж (олон алгаслын = 1…N framing элемент) — арматур үүсгэхэд бэлэн оролт.</summary>
    internal sealed class BbBeamGenItem
    {
        public BbBeamChain Chain;
        public BbBeamInput Input;
        /// <summary>Core-ийн тэнхлэгийн 0 = гинжийн геометрийн эхлэл (фут, гинжийн станц).</summary>
        public double S0;
        /// <summary>Plugin-ий үүсгээгүй (гараар тавьсан) арматурын тоо.</summary>
        public int Foreign, Own;
        /// <summary>null = үүсгэж болно; эс бол алгассан шалтгаан.</summary>
        public string Skip;
        public string Mark { get { return string.IsNullOrEmpty(Chain.Mark) ? "#" + Chain.Members[0].Id.Value : Chain.Mark; } }
        public string Size { get { return Math.Round(Input.B) + "×" + Math.Round(Input.H); } }
        public bool Aux { get { return Chain.Aux; } }
        /// <summary>Энэ хэсгийн гишүүд (хувьсах огтлолтой гинжид — нэг огтлолтой дараалсан хэсэг).</summary>
        public List<FamilyInstance> Members = new List<FamilyInstance>();
        /// <summary>Хэсгийн доод нүүр (Z, фут) ба Far нүүр (V, фут — гинжийн хүрээнд).</summary>
        public double Bottom, Far;
        /// <summary>Гинжийн хэсгийн дугаар / тоо (1 / 1 = бүхэл гинж).</summary>
        public int Part = 1, Parts = 1;
        /// <summary>Дэвтрийн мөрийн түлхүүр: марк, хэсэгтэй бол «ДН-37 (600×500)».</summary>
        public string Key { get { return Parts > 1 ? Mark + " (" + Size + ")" : Mark; } }
        /// <summary>Элементийн «Rebar Cover» параметрүүд (мм, 0 = тодорхойгүй).</summary>
        public double CoverTop, CoverBottom, CoverSide;
    }

    /// <summary>
    /// Дамнурууны арматур үүсгэх: <see cref="BbGeom.BeamChain"/> (тулгуур = багана / хана, туслахынх гол дамнуруу) + хөндлөн туслах дамнуруу
    /// (ачааллын цэг) → <see cref="BbBeamRebarPlan"/> → <c>Rebar.CreateFromCurves</c>.  Үүсгэсэн арматур бүрд Comments = <see cref="Tag"/>
    /// (дахин үүсгэхэд зөвхөн тэднийг солино), Partition = «ДАМНУРУУ ДН-n АРМАТУРЧЛАЛ» (ЖИШЭЭ-1-ийн нэршил).
    /// </summary>
    internal static class BbBeamRebarGen
    {
        public const string Tag = "MGL-BB-GEN";
        static double Ft(double mm) { return BbGeom.Ft(mm); }
        static double Mm(double ft) { return BbGeom.ToMm(ft); }

        /// <summary>Загварын (эсвэл сонгосон) төмөр бетон дамнурууны гинжүүд — давхардалгүй.</summary>
        /// <summary>Загварын бүх framing-ийн bbox / тэмдэг — нэг удаа уншина (элемент бүрд бүх загварыг дахин шүүхгүй).</summary>
        internal sealed class FramingIndex
        {
            public readonly List<KeyValuePair<FamilyInstance, BoundingBoxXYZ>> All = new List<KeyValuePair<FamilyInstance, BoundingBoxXYZ>>();
            public readonly Dictionary<string, List<FamilyInstance>> ByMark = new Dictionary<string, List<FamilyInstance>>(StringComparer.Ordinal);

            /// <summary>Багана ба хана (тулгуур).</summary>
            public readonly List<KeyValuePair<Element, BoundingBoxXYZ>> Posts = new List<KeyValuePair<Element, BoundingBoxXYZ>>();

            public FramingIndex(Document doc)
            {
                foreach (BuiltInCategory cat in new[] { BuiltInCategory.OST_StructuralColumns, BuiltInCategory.OST_Walls })
                    foreach (Element e in new FilteredElementCollector(doc).OfCategory(cat).WhereElementIsNotElementType())
                    {
                        // Хаалт (бүтээцийн бус) хана тулгуур биш — ЖИШЭЭ 3 ДН-1-8: туслах дамнурууны доорх 250 хана алгасал хуваасан байв.
                        if (e is Wall && e.get_Parameter(BuiltInParameter.WALL_STRUCTURAL_SIGNIFICANT)?.AsInteger() != 1) continue;
                        BoundingBoxXYZ b = e.get_BoundingBox(null);
                        if (b != null) Posts.Add(new KeyValuePair<Element, BoundingBoxXYZ>(e, b));
                    }
                foreach (FamilyInstance fi in AllBeams(doc))
                {
                    BoundingBoxXYZ bb = fi.get_BoundingBox(null);
                    if (bb == null) continue;
                    All.Add(new KeyValuePair<FamilyInstance, BoundingBoxXYZ>(fi, bb));
                    string m = BbGeom.Mark(fi);
                    if (!ByMark.TryGetValue(m, out List<FamilyInstance> l)) ByMark[m] = l = new List<FamilyInstance>();
                    l.Add(fi);
                }
            }

            static bool Hit(BoundingBoxXYZ b, XYZ min, XYZ max)
            {
                return !(b.Max.X < min.X || b.Min.X > max.X || b.Max.Y < min.Y || b.Min.Y > max.Y || b.Max.Z < min.Z || b.Min.Z > max.Z);
            }

            /// <summary>
            /// <see cref="BbGeom.BeamChain"/>-ийн тулгуурын хайлттай ижил (багана, богино хана; туслахад хөндлөн дамнуруу) — кэшээс, collector-гүй.
            /// </summary>
            public void Supports(BbBeamChain chain)
            {
                var fr = Frame(chain);
                double pad = Ft(200);
                XYZ lo = fr.World(chain.S0 - pad, 0, chain.Far - pad), hi = fr.World(chain.S1 + pad, 0, chain.Near + pad);
                var min = new XYZ(Math.Min(lo.X, hi.X), Math.Min(lo.Y, hi.Y), chain.Bottom - Ft(1500));
                var max = new XYZ(Math.Max(lo.X, hi.X), Math.Max(lo.Y, hi.Y), chain.Top - Ft(10));
                foreach (var kv in Posts)
                {
                    if (!Hit(kv.Value, min, max)) continue;
                    fr.Extent(kv.Value, out XYZ mn, out XYZ mx);
                    if (mx.Z < chain.Far - Ft(60) || mn.Z > chain.Near + Ft(60)) continue;
                    bool wall = kv.Key.Category != null && kv.Key.Category.Id.Value == (long)BuiltInCategory.OST_Walls;
                    if (wall && mx.X - mn.X > Ft(3000)) continue;
                    // Нимгэн (< 300) хөндлөн хана тулгуур биш — ЖИШЭЭ 3 ДН-1-8: туслах дамнурууны доорх 200 / 250 ханыг инженер ачааллын цэг гэж тооцсон.
                    if (wall && mx.X - mn.X < Ft(300)) continue;
                    chain.Supports.Add(new BbSpan(Mm(mn.X), Mm(mx.X)));
                }
                if (!chain.Aux) return;
                var mine = new HashSet<long>(chain.Members.Select(m => m.Id.Value));
                foreach (var kv in All)
                {
                    FamilyInstance fi = kv.Key;
                    if (!Hit(kv.Value, min, max) || mine.Contains(fi.Id.Value) || !BbGeom.LineOf(fi, out XYZ p0, out XYZ p1)) continue;
                    // Өөр туслах дамнуруу (ТДН-) тулгуур биш — хэрэглэгч: зөвхөн гол дамнуруу / багана / хана тулгуур болно.
                    if (BbGeom.IsAuxMark(BbGeom.Mark(fi))) continue;
                    XYZ d = new XYZ(p1.X - p0.X, p1.Y - p0.Y, 0);
                    if (d.GetLength() < 1e-6 || Math.Abs(d.Normalize().DotProduct(chain.Axis)) > 0.2) continue;
                    BoundingBoxXYZ bb = kv.Value;
                    if (bb.Max.Z < chain.Top - Ft(100) || bb.Min.Z > chain.Bottom + Ft(100)) continue;
                    TrueExtent(fi, bb, fr, out XYZ mn, out XYZ mx);
                    if (mx.Z < chain.Far - Ft(60) || mn.Z > chain.Near + Ft(60)) continue;
                    chain.Supports.Add(new BbSpan(Mm(mn.X), Mm(mx.X)));
                }
            }

            public IEnumerable<KeyValuePair<FamilyInstance, BoundingBoxXYZ>> In(XYZ min, XYZ max)
            {
                foreach (var kv in All)
                {
                    BoundingBoxXYZ b = kv.Value;
                    if (b.Max.X < min.X || b.Min.X > max.X || b.Max.Y < min.Y || b.Min.Y > max.Y || b.Max.Z < min.Z || b.Min.Z > max.Z) continue;
                    yield return kv;
                }
            }
        }

        /// <summary>Gate «solid=0» — өндрийн засваргүй (bbox) харьцуулалтад.</summary>
        internal static bool SolidOverride = true;

        /// <summary>
        /// Элементийн хүрээн дэх хэмжээ: X / Y тэнхлэгт зэрэгцээ бол bbox, эс бол solid-ын ирмэгийн цэгээр — world bbox нь хазайсан дамнуруунд хэт өргөн
        /// (ЖИШЭЭ 3 ДН-1-5: 600 өргөн 3285 гэж гарч байв).  Зэрэгцээ ч bbox-ийн өндөр (локал Y) гэр бүлийн нэмэлт геометрээр томорсон бол
        /// (ЖИШЭЭ-4 ДН-7 «400 x 500»: bbox 1550, solid ба төрлийн h = 500) өндрийг solid-оос.  Хэвтээ чиглэлд bbox хэвээр: solid нь баганын нүүрээр
        /// огтлогдсон тул алгаслын хуваалт өөрчлөгдөж ЖИШЭЭ 3-ын таарц 276 → 229 болж байв.
        /// </summary>
        internal static void TrueExtent(Element e, BoundingBoxXYZ bb, BbFrame fr, out XYZ mn, out XYZ mx)
        {
            fr.Extent(bb, out mn, out mx);
            Func<XYZ, bool> axisAligned = d => Math.Abs(d.X) > 0.9999 || Math.Abs(d.Y) > 0.9999;
            bool aligned = axisAligned(fr.R);
            if (aligned && e is FamilyInstance fi && BbGeom.LineOf(fi, out XYZ p0, out XYZ p1))
            {
                XYZ d = new XYZ(p1.X - p0.X, p1.Y - p0.Y, 0);
                aligned = d.GetLength() < 1e-9 || axisAligned(d.Normalize());
            }
            if (!aligned)
            {
                if (SolidExtent(e, fr, out XYZ an, out XYZ ax)) { mn = an; mx = ax; }
                return;
            }
            if (!SolidOverride || !(e is FamilyInstance inst) || mx.Y - mn.Y < Ft(10)) return;
            double h = TypeH(inst);
            if (h <= 0 || Math.Abs(Mm(mx.Y - mn.Y) - h) <= 5) return;
            if (SolidExtent(e, fr, out XYZ sn, out XYZ sx) && Math.Abs(Mm(sx.Y - sn.Y) - h) <= 5)
            {
                mn = new XYZ(mn.X, sn.Y, mn.Z);
                mx = new XYZ(mx.X, sx.Y, mx.Z);
            }
        }

        /// <summary>Төрлийн «h» параметр (мм; байхгүй бол 0).</summary>
        static double TypeH(FamilyInstance fi)
        {
            try
            {
                Parameter p = fi.Symbol?.LookupParameter("h") ?? fi.LookupParameter("h");
                return p != null && p.StorageType == StorageType.Double ? Mm(p.AsDouble()) : 0;
            }
            catch { return 0; }
        }

        /// <summary>Элементийн solid-ын ирмэгийн цэгүүдийн хүрээн дэх min / max (фут); solid-гүй бол false.</summary>
        internal static bool SolidExtent(Element e, BbFrame fr, out XYZ mn, out XYZ mx)
        {
            mn = mx = null;
            double[] lo = { double.MaxValue, double.MaxValue, double.MaxValue }, hi = { double.MinValue, double.MinValue, double.MinValue };
            bool any = false;
            try
            {
                GeometryElement ge = e.get_Geometry(new Options { ComputeReferences = false, DetailLevel = ViewDetailLevel.Coarse });
                var solids = new List<Solid>();
                if (ge != null)
                    foreach (GeometryObject o in ge)
                    {
                        if (o is Solid so && so.Volume > 1e-9) solids.Add(so);
                        else if (o is GeometryInstance gi)
                            foreach (GeometryObject io in gi.GetInstanceGeometry()) if (io is Solid s2 && s2.Volume > 1e-9) solids.Add(s2);
                    }
                foreach (Solid so in solids)
                    foreach (Edge ed in so.Edges)
                        foreach (XYZ q0 in ed.Tessellate())
                        {
                            XYZ q = fr.Local(q0);
                            lo[0] = Math.Min(lo[0], q.X); lo[1] = Math.Min(lo[1], q.Y); lo[2] = Math.Min(lo[2], q.Z);
                            hi[0] = Math.Max(hi[0], q.X); hi[1] = Math.Max(hi[1], q.Y); hi[2] = Math.Max(hi[2], q.Z);
                            any = true;
                        }
            }
            catch { }
            if (!any) return false;
            mn = new XYZ(lo[0], lo[1], lo[2]);
            mx = new XYZ(hi[0], hi[1], hi[2]);
            return true;
        }

        /// <summary>
        /// Гинжийн S / Near / Far / Bottom / Top-ыг гишүүдийн <see cref="TrueExtent"/>-ээр — хазайсан эсвэл bbox нь томорсон (ЖИШЭЭ-4 ДН-7) гишүүнд
        /// bbox-ийн оронд solid; тулгуур / ачааллын цэгийн шүүлтүүрт.
        /// </summary>
        static void TrueChainExtent(BbBeamChain ch)
        {
            BbFrame fr = Frame(ch);
            double s0 = double.MaxValue, s1 = double.MinValue, v0 = double.MaxValue, v1 = double.MinValue, z0 = double.MaxValue, z1 = double.MinValue;
            foreach (FamilyInstance m in ch.Members)
            {
                BoundingBoxXYZ bb = m.get_BoundingBox(null);
                if (bb == null) continue;
                TrueExtent(m, bb, fr, out XYZ mn, out XYZ mx);
                s0 = Math.Min(s0, mn.X); s1 = Math.Max(s1, mx.X); v0 = Math.Min(v0, mn.Z); v1 = Math.Max(v1, mx.Z);
                z0 = Math.Min(z0, mn.Y + fr.O.Z); z1 = Math.Max(z1, mx.Y + fr.O.Z);
            }
            if (s0 > s1 || v0 > v1) return;
            ch.S0 = s0; ch.S1 = s1; ch.Far = v0; ch.Near = v1;
            if (z0 < z1) { ch.Bottom = z0; ch.Top = z1; }
        }

        public static List<BbBeamGenItem> Collect(Document doc, IEnumerable<FamilyInstance> beams)
        {
            var res = new List<BbBeamGenItem>();
            var seen = new HashSet<long>();
            var index = new FramingIndex(doc);
            foreach (FamilyInstance fi in beams)
            {
                if (seen.Contains(fi.Id.Value)) continue;
                if (fi.StructuralMaterialType != StructuralMaterialType.Concrete && fi.StructuralMaterialType != StructuralMaterialType.PrecastConcrete) continue;
                BbBeamChain ch;
                string mark = BbGeom.Mark(fi);
                try { ch = BbGeom.BeamChain(doc, fi, index.ByMark.TryGetValue(mark, out List<FamilyInstance> same) ? same : null, findSupports: false); if (ch != null) { TrueChainExtent(ch); index.Supports(ch); } }
                catch { ch = null; }
                if (ch == null) continue;
                foreach (FamilyInstance m in ch.Members) seen.Add(m.Id.Value);
                res.AddRange(Analyze(doc, ch, index));
            }
            return res.OrderBy(x => x.Mark, StringComparer.CurrentCulture).ThenBy(x => x.Part).ToList();
        }

        public static IEnumerable<FamilyInstance> AllBeams(Document doc)
        {
            return new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_StructuralFraming).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>();
        }

        static BbFrame Frame(BbBeamChain ch)
        {
            return new BbFrame { O = ch.Origin, R = ch.Axis, U = XYZ.BasisZ, V = ch.Axis.CrossProduct(XYZ.BasisZ).Normalize() };
        }

        /// <summary>Нэг гишүүний гинжийн хүрээн дэх хэмжээ (фут): станц, V, Z.</summary>
        private sealed class MemberBox
        {
            public FamilyInstance M;
            public double S0, S1, V0, V1, Z0, Z1;
            public string Skip;
        }

        /// <summary>
        /// Гинжийг огтлолоор хэсэглэнэ (Alpha BIM маягаар): ижил b×h ба байрлалтай дараалсан гишүүд = нэг хэсэг.  Хэсэг бүр тулгуураа (огтлосон),
        /// туслах дамнуруугаа авна; хөрш хэсэгтэй тулгуургүй залгагдвал <see cref="BbBeamInput.JoinStart"/> / <see cref="BbBeamInput.JoinEnd"/>.
        /// </summary>
        static List<BbBeamGenItem> Analyze(Document doc, BbBeamChain ch, FramingIndex index)
        {
            BbFrame fr = Frame(ch);
            var boxes = new List<MemberBox>();
            string skip = null;
            foreach (FamilyInstance m in ch.Members)
            {
                var mb = new MemberBox { M = m };
                if (!BbGeom.LineOf(m, out XYZ p0, out XYZ p1)) skip = "муруй тэнхлэг";
                else if (Math.Abs(p0.Z - p1.Z) > Ft(5)) skip = "налуу дамнуруу";
                BoundingBoxXYZ bb = m.get_BoundingBox(null);
                if (bb == null) continue;
                TrueExtent(m, bb, fr, out XYZ mn, out XYZ mx);
                mb.S0 = mn.X; mb.S1 = mx.X; mb.V0 = mn.Z; mb.V1 = mx.Z; mb.Z0 = mn.Y + fr.O.Z; mb.Z1 = mx.Y + fr.O.Z;
                boxes.Add(mb);
            }
            boxes = boxes.OrderBy(x => x.S0).ToList();
            // Дараалсан ижил огтлол (±10 мм, байрлал ч ижил) → хэсэг.
            var parts = new List<List<MemberBox>>();
            foreach (MemberBox mb in boxes)
            {
                List<MemberBox> cur = parts.LastOrDefault();
                MemberBox f = cur?[0];
                bool same = f != null && Math.Abs(Mm(mb.V0 - f.V0)) <= 10 && Math.Abs(Mm(mb.V1 - f.V1)) <= 10 && Math.Abs(Mm(mb.Z0 - f.Z0)) <= 10 && Math.Abs(Mm(mb.Z1 - f.Z1)) <= 10;
                if (same) cur.Add(mb);
                else parts.Add(new List<MemberBox> { mb });
            }
            if (parts.Count == 0) parts.Add(new List<MemberBox>());

            double s0c = Mm(ch.S0);
            List<BbSupport> supChain = ch.Supports.Select(s => new BbSupport(s.A - s0c, s.B - s0c)).ToList();
            List<BbLoadPoint> lpChain = ch.Aux ? new List<BbLoadPoint>() : LoadPoints(index, ch, fr, s0c, supChain);
            var res = new List<BbBeamGenItem>();
            for (int k = 0; k < parts.Count; k++)
            {
                List<MemberBox> pt = parts[k];
                var it = new BbBeamGenItem { Chain = ch, Part = k + 1, Parts = parts.Count, Skip = skip };
                double ps0 = pt.Count > 0 ? pt.Min(x => x.S0) : ch.S0, ps1 = pt.Count > 0 ? pt.Max(x => x.S1) : ch.S1;
                it.S0 = ps0;
                it.Far = pt.Count > 0 ? pt.Min(x => x.V0) : ch.Far;
                it.Bottom = pt.Count > 0 ? pt.Min(x => x.Z0) : ch.Bottom;
                double top = pt.Count > 0 ? pt.Max(x => x.Z1) : ch.Top, near = pt.Count > 0 ? pt.Max(x => x.V1) : ch.Near;
                it.Members = pt.Select(x => x.M).ToList();
                double shift = Mm(ps0 - ch.S0), len = Mm(ps1 - ps0);
                it.Input = new BbBeamInput { Length = len, B = Mm(near - it.Far), H = Mm(top - it.Bottom) };
                it.Input.Supports = supChain.Select(s => new BbSupport(s.Lo - shift, s.Hi - shift)).Where(s => s.Hi > -1 && s.Lo < len + 1).ToList();
                it.Input.LoadPoints = lpChain.Select(l => new BbLoadPoint(l.Lo - shift, l.Hi - shift, l.SoffitDepth - Mm(ch.Top - top)))
                    .Where(l => l.Lo > 0 && l.Hi < len).ToList();
                bool coveredStart = it.Input.Supports.Any(s => s.Lo <= 1 && s.Hi >= -1), coveredEnd = it.Input.Supports.Any(s => s.Lo <= len + 1 && s.Hi >= len - 1);
                it.Input.JoinStart = k > 0 && !coveredStart;
                it.Input.JoinEnd = k < parts.Count - 1 && !coveredEnd;
                // Консолын үзүүрийг дайрсан хөндлөн (хаалтын) дамнуруу — арматур түүний алс нүүр хүртэл (ЖИШЭЭ-4 ДН-4 / ТДН-3).
                if (k == 0 && !coveredStart) it.Input.TipExtStart = TipCrossing(index, ch, fr, ps0, it.Bottom, top, it.Far, near, true);
                if (k == parts.Count - 1 && !coveredEnd) it.Input.TipExtEnd = TipCrossing(index, ch, fr, ps1, it.Bottom, top, it.Far, near, false);
                if (it.Input.Supports.Count == 0 && !(it.Input.JoinStart && it.Input.JoinEnd) && it.Skip == null) it.Skip = "тулгуур олдсонгүй";
                foreach (FamilyInstance m in it.Members)
                    foreach (Rebar r in RebarsOf(doc, m))
                    {
                        if (IsOwn(r)) it.Own++;
                        else it.Foreign++;
                    }
                if (it.Members.Count > 0)
                {
                    it.CoverTop = HostCover(doc, it.Members[0], BuiltInParameter.CLEAR_COVER_TOP);
                    it.CoverBottom = HostCover(doc, it.Members[0], BuiltInParameter.CLEAR_COVER_BOTTOM);
                    it.CoverSide = HostCover(doc, it.Members[0], BuiltInParameter.CLEAR_COVER_OTHER);
                }
                res.Add(it);
            }
            ContinueTops(res);
            return res;
        }

        /// <summary>
        /// Гинжийн үзүүрийг (станц <paramref name="end"/>, фут) дайрсан хөндлөн framing — үзүүрээс цаашх хэсгийн урт (мм; байхгүй бол 0).  Хөндлөн
        /// (|cos| &lt; 0.2), огтлолыг бүрэн хамарсан, өндрийн ≥ 100 мм давхцалтай.
        /// </summary>
        static double TipCrossing(FramingIndex index, BbBeamChain ch, BbFrame fr, double end, double z0, double z1, double v0, double v1, bool start)
        {
            double best = 0;
            var mine = new HashSet<long>(ch.Members.Select(m => m.Id.Value));
            foreach (var kv in index.All)
            {
                FamilyInstance fi = kv.Key;
                if (mine.Contains(fi.Id.Value) || !BbGeom.LineOf(fi, out XYZ p0, out XYZ p1)) continue;
                XYZ d = new XYZ(p1.X - p0.X, p1.Y - p0.Y, 0);
                if (d.GetLength() < 1e-6 || Math.Abs(d.Normalize().DotProduct(ch.Axis)) > 0.2) continue;
                BoundingBoxXYZ bb = kv.Value;
                if (Math.Min(bb.Max.Z, z1) - Math.Max(bb.Min.Z, z0) < Ft(100)) continue;
                TrueExtent(fi, bb, fr, out XYZ mn, out XYZ mx);
                if (mn.X > end + Ft(10) || mx.X < end - Ft(10) || mn.Z > v0 + Ft(50) || mx.Z < v1 - Ft(50)) continue;
                double ext = Mm(start ? end - mn.X : mx.X - end);
                if (ext > best && ext < 1000) best = ext;
            }
            return best;
        }

        /// <summary>
        /// Хөрш хэсгүүд багана дээр залгагдаж, өргөн / хажуу нүүр / дээд нүүр нь ижил (±10 мм), зөвхөн өндөр өөр бол — дээд арматур тасралтгүй
        /// (ЖИШЭЭ-4 ДН-4, хэрэглэгчийн хүсэлт): зүүн хэсэг нь баганын дээд арматурыг баруун хэсгийн алгаслын ⅓ (консол бол үзүүр) хүртэл тавина.
        /// </summary>
        static void ContinueTops(List<BbBeamGenItem> parts)
        {
            for (int k = 0; k + 1 < parts.Count; k++)
            {
                BbBeamGenItem a = parts[k], b = parts[k + 1];
                if (a.Input.JoinEnd || b.Input.JoinStart || a.Members.Count == 0 || b.Members.Count == 0) continue;
                double topA = Mm(a.Bottom) + a.Input.H, topB = Mm(b.Bottom) + b.Input.H;
                if (Math.Abs(Mm(a.Far - b.Far)) > 10 || Math.Abs(a.Input.B - b.Input.B) > 10 || Math.Abs(topA - topB) > 10) continue;
                // Хоёулаа тэр баганыг тулгуураа гэж үзсэн (a-ийн эцэс, b-ийн эхэнд).
                bool endA = a.Input.Supports.Any(s => s.Lo <= a.Input.Length + 1 && s.Hi >= a.Input.Length - 1), startB = b.Input.Supports.Any(s => s.Lo <= 1 && s.Hi >= -1);
                if (!endA || !startB) continue;
                // Гүн хөрш рүү доод арматур шулуун зоогдоно (ЖИШЭЭ-4 FX2–FX3: 400×500 хоёр талдаа 400×600).
                if (b.Input.H > a.Input.H + 10) a.Input.StraightBottomEnd = true;
                if (a.Input.H > b.Input.H + 10) b.Input.StraightBottomStart = true;
                List<BbSupport> spans = BbBeamRebarPlan.InteriorSpans(b.Input);
                if (spans.Count > 0) a.Input.ContinueTopEnd = spans[0].Hi - spans[0].Lo;
                else
                {
                    double far = b.Input.Supports.Where(s => s.Lo <= 1).Select(s => s.Hi).DefaultIfEmpty(0).Max();
                    if (b.Input.Length - far < 100) continue;
                    a.Input.ContinueTopEnd = b.Input.Length - far + b.Input.TipExtEnd;   // хаалтын дамнурууны алс нүүр хүртэл
                    a.Input.ContinueTopEndTip = true;
                    a.Input.ContinueTopEndH = b.Input.H;
                }
                b.Input.ContinueTopStart = true;
            }
        }

        /// <summary>Элементийн «Rebar Cover» (RebarCoverType) — мм, байхгүй / 0 бол 0.</summary>
        public static double HostCover(Document doc, Element e, BuiltInParameter bip)
        {
            try
            {
                Parameter p = e.get_Parameter(bip);
                return p != null && doc.GetElement(p.AsElementId()) is RebarCoverType ct ? Math.Round(Mm(ct.CoverDistance), 1) : 0;
            }
            catch { return 0; }
        }

        /// <summary>
        /// Элементийн cover-ийг preset-д: хажуу / доод / дээд тус бүр (0 бол preset-ийнх).  Норм зөрчих бол Plan өөрөө өсгөнө.
        /// </summary>
        public static void ApplyHostCover(BbBeamGenItem it, BbBeamPreset p)
        {
            if (it.CoverSide > 0) p.Cover = it.CoverSide;
            if (it.CoverBottom > 0) p.CoverBottom = it.CoverBottom;
            if (it.CoverTop > 0) p.CoverTop = it.CoverTop;
        }

        /// <summary>
        /// Хөндлөн framing (гинжид ороогүй): туслах (Т-тэмдэгтэй) эсвэл нимгэн, дээд нүүр нь ойролцоо — ачааллын цэг; тулгуур (багана) дээр
        /// давхцсаныг алгасна.
        /// </summary>
        static List<BbLoadPoint> LoadPoints(FramingIndex index, BbBeamChain ch, BbFrame fr, double s0, List<BbSupport> supports)
        {
            var res = new List<BbLoadPoint>();
            var mine = new HashSet<long>(ch.Members.Select(m => m.Id.Value));
            XYZ lo = fr.World(ch.S0, 0, ch.Far), hi = fr.World(ch.S1, 0, ch.Near);
            var outline = new Outline(new XYZ(Math.Min(lo.X, hi.X) - Ft(50), Math.Min(lo.Y, hi.Y) - Ft(50), ch.Bottom),
                new XYZ(Math.Max(lo.X, hi.X) + Ft(50), Math.Max(lo.Y, hi.Y) + Ft(50), ch.Top + Ft(10)));
            double depth = ch.Top - ch.Bottom;
            foreach (var kv in index.In(outline.MinimumPoint, outline.MaximumPoint))
            {
                FamilyInstance fi = kv.Key;
                if (mine.Contains(fi.Id.Value) || !BbGeom.LineOf(fi, out XYZ p0, out XYZ p1)) continue;
                XYZ d = new XYZ(p1.X - p0.X, p1.Y - p0.Y, 0);
                if (d.GetLength() < 1e-6 || Math.Abs(d.Normalize().DotProduct(ch.Axis)) > 0.2) continue;
                BoundingBoxXYZ bb = kv.Value;
                TrueExtent(fi, bb, fr, out XYZ mn, out XYZ mx);
                double zb = mn.Y + fr.O.Z, zt = mx.Y + fr.O.Z;   // solid-оор (bbox томорсон байж болно)
                if (Math.Abs(zt - ch.Top) > Ft(150)) continue;
                bool aux = BbGeom.IsAuxMark(BbGeom.Mark(fi));
                if (!aux && zt - zb > depth - Ft(50)) continue;   // ижил / гүн хөндлөн = гол дамнуруу (багана дээр)
                if (mx.Z < ch.Far - Ft(10) || mn.Z > ch.Near + Ft(10)) continue;
                double a = Mm(mn.X) - s0, b = Mm(mx.X) - s0;
                if (supports.Any(s => a < s.Hi && b > s.Lo)) continue;
                res.Add(new BbLoadPoint(a, b, Mm(ch.Top - zb)));
            }
            return res.OrderBy(x => x.Lo).ToList();
        }

        static IEnumerable<FamilyInstance> AllBeamsIn(Document doc, Outline o)
        {
            return new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_StructuralFraming).OfClass(typeof(FamilyInstance))
                .WherePasses(new BoundingBoxIntersectsFilter(o)).Cast<FamilyInstance>();
        }

        public static IEnumerable<Rebar> RebarsOf(Document doc, Element host)
        {
            RebarHostData hd = null;
            try { if (RebarHostData.IsValidHost(host)) hd = RebarHostData.GetRebarHostData(host); }
            catch { }
            if (hd == null) yield break;
            foreach (Rebar r in hd.GetRebarsInHost()) yield return r;
        }

        public static bool IsOwn(Element r)
        {
            Parameter p = r.get_Parameter(BuiltInParameter.ALL_MODEL_INSTANCE_COMMENTS);
            string s = p?.AsString();
            return s != null && (s == Tag || s.StartsWith(Tag + " ", StringComparison.Ordinal));
        }

        public static string Partition(BbBeamGenItem it)
        {
            return (it.Aux ? "ТУСЛАХ ДАМНУРУУ " : "ДАМНУРУУ ") + it.Mark + " АРМАТУРЧЛАЛ";
        }

        /// <summary>Үр дүн: үүсгэсэн арматурын элементийн тоо, анхааруулга.</summary>
        internal sealed class Outcome
        {
            public int Created, Deleted, Failed;
            public BbBeamRebar Plan;
            public readonly List<string> Notes = new List<string>();
        }

        /// <summary>
        /// Нэг гинжийн арматур (дуудагчийн transaction дотор).  Өмнө нь үүсгэсэн (<see cref="Tag"/>) арматурыг устгана; <paramref name="replaceForeign"/>
        /// бол гараар тавьсныг ч.
        /// </summary>
        public static Outcome Generate(Document doc, BbBeamGenItem it, BbBeamPreset p, bool replaceForeign)
        {
            var o = new Outcome();
            o.Plan = BbBeamRebarPlan.Plan(it.Input, p);
            o.Notes.AddRange(o.Plan.Warnings);
            var del = new List<ElementId>();
            foreach (FamilyInstance m in it.Members)
                foreach (Rebar r in RebarsOf(doc, m))
                    if (replaceForeign || IsOwn(r)) del.Add(r.Id);
            if (del.Count > 0) { doc.Delete(del); o.Deleted = del.Count; }

            new Builder(doc, it, p, o).Run(o.Plan);
            return o;
        }

        /// <summary>Гинжийн чиглэл (°, X тэнхлэгээс) — сурсан дээд хамгаалах үе чиглэлээр.</summary>
        public static double Direction(BbBeamGenItem it) { return Math.Atan2(it.Chain.Axis.Y, it.Chain.Axis.X) * 180 / Math.PI; }

        /// <summary>Дэвтрийн мөрийн preset (элементийн cover-тэй, сонголтоор) — алгасал <paramref name="first"/>-ээс <paramref name="count"/>.</summary>
        public static BbBeamPreset PresetFor(BbRebarBook book, BbBeamGenItem it, List<string> errors, int first = 0, int count = 0)
        {
            BbBeamPreset p = book.Preset(book.Row(it.Key), it.Input.B, errors, first, count, it.Input.H, Direction(it));
            if (book.UseHostCover) ApplyHostCover(it, p);
            return p;
        }

        /// <summary>Дэвтрээс үүсгэх: мөрийн утга, алгасал бүрийн засвар, унтраасан алгасал, элементийн cover.</summary>
        public static Outcome Generate(Document doc, BbBeamGenItem it, BbRebarBook book, List<string> errors)
        {
            BbRebarRow row = book.Row(it.Key);
            int n = BbBeamRebarPlan.SpanCount(it.Input);
            bool[] en = Enumerable.Range(0, n).Select(i => !(row.Spans.FirstOrDefault(s => s.Index == i)?.Off ?? false)).ToArray();
            return Generate(doc, it, (a, c) => PresetFor(book, it, errors, a, c), en, book.ReplaceForeign);
        }

        /// <summary>Тэмдэглэгээнээс алгаслын муж («MGL-BB-GEN s1-3» → 1…3); мужгүй (бүхэл) бол false.</summary>
        static bool SpanRange(Element r, out int a, out int b)
        {
            a = b = -1;
            string s = r.get_Parameter(BuiltInParameter.ALL_MODEL_INSTANCE_COMMENTS)?.AsString() ?? "";
            int i = s.IndexOf(" s", StringComparison.Ordinal);
            if (i < 0) return false;
            string[] ab = s.Substring(i + 2).Split('-');
            return ab.Length == 2 && int.TryParse(ab[0], out a) && int.TryParse(ab[1], out b);
        }

        /// <summary>
        /// Алгаслын сонголттой үүсгэх: <paramref name="enabled"/> (null = бүгд) — дараалсан асаалттай алгаслууд тусдаа (<see cref="BbBeamRebarPlan.SplitBySpans"/>).
        /// Өмнө үүсгэснээс зөвхөн асаалттай алгасалтай давхцсаныг (мужгүй = бүхэл) солино; <paramref name="presetFor"/>(эхний алгасал, тоо).
        /// </summary>
        public static Outcome Generate(Document doc, BbBeamGenItem it, Func<int, int, BbBeamPreset> presetFor, bool[] enabled, bool replaceForeign)
        {
            var parts = BbBeamRebarPlan.SplitBySpans(it.Input, enabled);
            int n = BbBeamRebarPlan.SpanCount(it.Input);
            bool whole = parts.Count == 1 && parts[0].Item3 == 0 && parts[0].Item4 == n;
            var o = new Outcome();
            var del = new List<ElementId>();
            foreach (FamilyInstance m in it.Members)
                foreach (Rebar r in RebarsOf(doc, m))
                {
                    if (!IsOwn(r)) { if (replaceForeign) del.Add(r.Id); continue; }
                    if (whole || !SpanRange(r, out int ra, out int rb)) { del.Add(r.Id); continue; }
                    if (parts.Any(pt => ra <= pt.Item3 + pt.Item4 - 1 && rb >= pt.Item3)) del.Add(r.Id);
                }
            if (del.Count > 0) { doc.Delete(del); o.Deleted = del.Count; }
            foreach (var pt in parts)
            {
                BbBeamPreset p = presetFor(pt.Item3, pt.Item4);
                BbBeamRebar plan = BbBeamRebarPlan.Plan(pt.Item2, p);
                if (o.Plan == null) o.Plan = plan;
                string where = whole ? "" : "алгасал " + (pt.Item3 + 1) + (pt.Item4 > 1 ? "…" + (pt.Item3 + pt.Item4) : "") + ": ";
                o.Notes.AddRange(plan.Warnings.Select(w => where + w));
                var g = new Builder(doc, it, p, new Outcome(), pt.Item1, whole ? null : Tag + " s" + pt.Item3 + "-" + (pt.Item3 + pt.Item4 - 1));
                Outcome sub = g.Run(plan);
                o.Created += sub.Created; o.Failed += sub.Failed;
                o.Notes.AddRange(sub.Notes.Select(w => where + w));
            }
            return o;
        }

        /// <summary>Core-ийн (x, y, z) мм → загварын цэг; хост сонголт; bar / hook type.</summary>
        private sealed class Builder
        {
            readonly Document doc;
            readonly BbBeamGenItem it;
            readonly BbBeamPreset p;
            readonly Outcome o;
            readonly BbFrame fr;
            readonly List<KeyValuePair<FamilyInstance, double[]>> ranges = new List<KeyValuePair<FamilyInstance, double[]>>();
            readonly BbRebarBuilder b;
            /// <summary>Алгаслын сонголтын хэсэг: Core-ийн x-д нэмэх шилжилт (мм).</summary>
            readonly double dx;

            public Builder(Document doc, BbBeamGenItem it, BbBeamPreset p, Outcome o, double dx = 0, string tag = null)
            {
                this.doc = doc; this.it = it; this.p = p; this.o = o;
                this.dx = dx;
                b = new BbRebarBuilder(doc, o, Partition(it), tag);
                fr = Frame(it.Chain);
                foreach (FamilyInstance m in it.Members)
                {
                    BoundingBoxXYZ bb = m.get_BoundingBox(null);
                    if (bb == null) continue;
                    TrueExtent(m, bb, fr, out XYZ mn, out XYZ mx);
                    ranges.Add(new KeyValuePair<FamilyInstance, double[]>(m, new[] { Mm(mn.X - it.S0), Mm(mx.X - it.S0) }));
                }
            }

            /// <summary>Төлөвлөгөөний бүх арматурыг үүсгэнэ (ажлын, муруй, хомут, хажуугийн C).</summary>
            public Outcome Run(BbBeamRebar plan)
            {
                if (o.Plan == null) o.Plan = plan;
                foreach (BbBarRun run in plan.Bars) Longitudinal(run);
                foreach (BbBentBar bb in plan.Bent) Bent(bb);
                foreach (BbStirrupSet st in plan.Stirrups)
                    foreach (BbTieShape sh in plan.StirrupShapes) Stirrup(st, sh);
                foreach (BbStirrupSet st in plan.Ties)
                    foreach (double z in plan.TieZ) Tie(st, z);
                return o;
            }

            XYZ P(double x, double y, double z)
            {
                return fr.World(it.S0 + Ft(x + dx), it.Bottom + Ft(z) - it.Chain.Origin.Z, it.Far + Ft(y));
            }

            Element Host(double x)
            {
                x += dx;
                foreach (var kv in ranges) if (x >= kv.Value[0] - 1 && x <= kv.Value[1] + 1) return kv.Key;
                return ranges.OrderBy(kv => Math.Min(Math.Abs(x - kv.Value[0]), Math.Abs(x - kv.Value[1]))).First().Key;
            }

            RebarBarType BarType(int d, string role) { return b.BarType(d, role, p.TypeNames); }
            RebarHookType HookType(RebarStyle style, double deg, string prefer) { return b.HookType(style, deg, prefer); }
            Rebar Create(RebarStyle style, RebarBarType bt, RebarHookType h0, RebarHookType h1, Element host, XYZ norm, IList<Curve> curves, string what)
            {
                return b.Create(style, bt, h0, h1, host, norm, curves, what);
            }

            static IList<Curve> Poly(IList<XYZ> pts, bool close = false) { return BbRebarBuilder.Poly(pts, close); }

            static bool Uniform(double[] ys, out double pitch)
            {
                pitch = ys.Length > 1 ? (ys[ys.Length - 1] - ys[0]) / (ys.Length - 1) : 0;
                for (int i = 1; i < ys.Length; i++) if (Math.Abs(ys[i] - ys[i - 1] - pitch) > 0.5) return false;
                return true;
            }

            /// <summary>Огтлолын Y байрлалуудад: жигд бол нэг set (FixedNumber), эс бол ширхэг бүр тусдаа.</summary>
            void Spread(double[] ys, Func<double, IList<XYZ>> curvesAt, Func<IList<XYZ>, Rebar> make)
            {
                if (ys.Length == 0) return;
                double[] sorted = ys.OrderBy(y => y).ToArray();
                if (Uniform(sorted, out double pitch))
                {
                    Rebar r = make(curvesAt(sorted[0]));
                    if (r != null && sorted.Length > 1)
                    {
                        try { r.GetShapeDrivenAccessor().SetLayoutAsFixedNumber(sorted.Length, Ft(sorted[sorted.Length - 1] - sorted[0]), true, true, true); }
                        catch (Exception ex) { o.Notes.Add("Layout: " + ex.Message); }
                    }
                    return;
                }
                foreach (double y in sorted) make(curvesAt(y));
            }

            public void Longitudinal(BbBarRun run)
            {
                string role = run.Role == BbRunRole.SpanTop || run.Role == BbRunRole.Side ? "minor" : "main";
                RebarBarType bt = BarType(run.D, role);
                if (bt == null) return;
                bool top = run.Role == BbRunRole.Top || run.Role == BbRunRole.AddTop || run.Role == BbRunRole.SpanTop;
                double sgn = top ? -1 : 1;
                Element host = Host((run.X0 + run.X1) / 2);
                Spread(run.Y, y =>
                {
                    var pts = new List<XYZ>();
                    if (run.HookStart > 0) pts.Add(P(run.X0, y, run.Z + sgn * run.HookStart));
                    pts.Add(P(run.X0, y, run.Z));
                    pts.Add(P(run.X1, y, run.Z));
                    if (run.HookEnd > 0) pts.Add(P(run.X1, y, run.Z + sgn * run.HookEnd));
                    return pts;
                }, ps => b.CreatePath(bt, host, fr.V, ps, run.D, run.Role + " " + run.N + "Ø" + run.D));
            }

            public void Bent(BbBentBar b)
            {
                RebarBarType bt = BarType(b.D, "bent");
                if (bt == null) return;
                Element host = Host(b.X);
                BbBentBar g = b;
                for (int attempt = 0; attempt < 2; attempt++)
                {
                    var made = new List<Rebar>();
                    BbBentBar q = g;
                    Spread(q.Y, y => new[]
                    {
                        P(q.X0, y, q.ZHigh), P(q.X - q.Flat / 2 - q.Run, y, q.ZHigh), P(q.X - q.Flat / 2, y, q.ZLow),
                        P(q.X + q.Flat / 2, y, q.ZLow), P(q.X + q.Flat / 2 + q.Run, y, q.ZHigh), P(q.X1, y, q.ZHigh),
                    }, ps => { Rebar rr = this.b.CreatePath(bt, host, fr.V, ps, q.D, "муруй " + q.Y.Length + "Ø" + q.D); if (rr != null) made.Add(rr); return rr; });
                    if (!p.NiceLengths || attempt == 1 || made.Count == 0) return;
                    // Хэрэглэгч: Revit-ийн харуулдаг хэрчмийн урт (A / B / C …) бүхэл — налуу хэрчимд нугалаа нэмэгддэг тул тэнхлэгээр урьдчилан
                    // тооцох боломжгүй; уншиж засаад нэг удаа дахин үүсгэнэ.
                    try { doc.Regenerate(); } catch { }
                    var vals = "ABCDEFGHJK".Select(ch => made[0].LookupParameter(ch.ToString())).Where(pp => pp != null && pp.StorageType == StorageType.Double && pp.AsDouble() > 1e-6)
                        .Select(pp => Mm(pp.AsDouble())).ToList();
                    double slope = (q.ZHigh - q.ZLow) / Math.Sin(q.Angle * Math.PI / 180);
                    Func<double, double> near = target => vals.Count == 0 ? target : vals.OrderBy(v => Math.Abs(v - target)).First();
                    double vt = near(q.TopLen + q.D / 2.0), vf = near(q.Flat + q.D / 2.0), vs = near(slope + q.D / 2.0);
                    double dt = BbBeamRebarPlan.NiceRound(vt) - vt, df = BbBeamRebarPlan.NiceRound(vf) - vf, ds = BbBeamRebarPlan.NiceRound(vs) - vs;
                    if (Math.Abs(dt) < 0.5 && Math.Abs(df) < 0.5 && Math.Abs(ds) < 0.5) return;
                    double dy = q.ZHigh - q.ZLow, ls = slope + ds;
                    if (ls <= dy + 1) ls = slope;
                    foreach (Rebar rr in made) { try { doc.Delete(rr.Id); o.Created--; } catch { } }
                    g = new BbBentBar { D = q.D, X = q.X, Flat = q.Flat + df, TopLen = q.TopLen + dt, ZLow = q.ZLow, ZHigh = q.ZHigh, Y = q.Y, Angle = Math.Asin(dy / ls) * 180 / Math.PI };
                }
            }

            /// <summary>Огтлолын хэлбэр (<see cref="BbBeamRebar.StirrupShapes"/>): битүү = гадна ирмэг (Plan-ын хамгаалах үеэр), C = босоо, 180°.</summary>
            public void Stirrup(BbStirrupSet st, BbTieShape sh)
            {
                RebarBarType bt = BarType(st.D, "stirrup");
                if (bt == null) return;
                double ds = st.D, x = st.X0;
                Rebar r;
                if (sh.Closed)
                {
                    RebarHookType hk = HookType(RebarStyle.StirrupTie, 135, "Seismic");
                    double y0 = sh.X0 + ds / 2, y1 = sh.X1 - ds / 2, z0 = sh.Y0 + ds / 2, z1 = sh.Y1 - ds / 2;
                    r = b.CreateLoop(bt, hk, Host(x), fr.R, new[] { P(x, y0, z1), P(x, y1, z1), P(x, y1, z0), P(x, y0, z0) }, ds, "хомут x=" + Math.Round(x));
                }
                else
                {
                    IList<Curve> cs = Poly(new[] { P(x, sh.X0, sh.Y1), P(x, sh.X1, sh.Y0) });
                    r = b.CreateTie(bt, Host(x), fr.R, cs, "босоо C x=" + Math.Round(x));
                }
                Layout(r, st);
            }

            public void Tie(BbStirrupSet st, double z)
            {
                RebarBarType bt = BarType(st.D, "tie");
                if (bt == null) return;
                double ds = st.D, dst = o.Plan.StirrupD > 0 ? o.Plan.StirrupD : ds;
                // Гадна хүрээ = бүх битүү хомутын нийт (хос хомутад эхнийх нь зөвхөн нэг хагас — C-хомут 230 болж байв, хэрэглэгчийн зураг 1).
                var closedShapes = o.Plan.StirrupShapes.Where(s => s.Closed).ToList();
                double ox0 = closedShapes.Count > 0 ? closedShapes.Min(s => s.X0) : p.Cover, ox1 = closedShapes.Count > 0 ? closedShapes.Max(s => s.X1) : it.Input.B - p.Cover;
                double y0 = ox0 + dst + ds / 2, y1 = ox1 - dst - ds / 2;
                if (p.TieAtCover) { y0 = ox0; y1 = ox1; }
                if (p.TieInset > 0) { y0 = p.TieInset; y1 = it.Input.B - p.TieInset; }
                IList<Curve> cs = Poly(new[] { P(st.X0, y0, z), P(st.X0, y1, z) });
                Rebar r = b.CreateTie(bt, Host(st.X0), fr.R, cs, "C-хомут x=" + Math.Round(st.X0));
                Layout(r, st);
            }

            void Layout(Rebar r, BbStirrupSet st)
            {
                if (r == null || st.Count < 2) return;
                try { r.GetShapeDrivenAccessor().SetLayoutAsNumberWithSpacing(st.Count, Ft(st.Spacing), true, true, true); }
                catch (Exception ex) { o.Notes.Add("Хомутын layout: " + ex.Message); }
            }
        }
    }

    /// <summary>Дамнуруу / баганын нийтлэг: bar / hook type сонгох, <c>CreateFromCurves</c> (R24–R27), тэмдэглэх (Comments, Partition), layout.</summary>
    internal sealed class BbRebarBuilder
    {
        readonly Document doc;
        readonly BbBeamRebarGen.Outcome o;
        readonly string partition;
        readonly List<RebarBarType> types;

        readonly string tag;

        /// <summary>Хурдны хэмжилт (gate «time=1»): үүсгэх / layout / тэмдэглэх, мс; оролдлогын тоо.</summary>
        public static readonly System.Diagnostics.Stopwatch RegenSw = new System.Diagnostics.Stopwatch(), CreateSw = new System.Diagnostics.Stopwatch(), LayoutSw = new System.Diagnostics.Stopwatch(), MarkSw = new System.Diagnostics.Stopwatch();
        public static int Tries;

        public BbRebarBuilder(Document doc, BbBeamRebarGen.Outcome o, string partition, string tag = null)
        {
            this.doc = doc; this.o = o; this.partition = partition; this.tag = tag;
            types = new FilteredElementCollector(doc).OfClass(typeof(RebarBarType)).Cast<RebarBarType>().ToList();
        }

        static double Mm(double ft) { return BbGeom.ToMm(ft); }

        /// <summary>Үүрэг → ган (ЖИШЭЭ-1: ажлын A500C, Ø12 / хажуугийн A500, муруй A400, хомут A240).</summary>
        static string[] Grades(string role)
        {
            switch (role)
            {
                case "stirrup":
                case "tie": return new[] { "A240", "А240", "A-I" };
                case "bent": return new[] { "A400", "А400", "A500", "А500" };
                case "minor": return new[] { "A500", "А500", "A500C", "А500С" };
                default: return new[] { "A500C", "А500С", "A500", "А500", "A400" };
            }
        }

        /// <param name="names">Загвараас сурсан нэр («stirrup:10» → «⌀10_A240»; <see cref="BbRebarStyle.TypeNames"/>) — байвал түүнийг.</param>
        public RebarBarType BarType(int d, string role, IDictionary<string, string> names = null)
        {
            var byD = types.Where(t => Math.Abs(Mm(Diameter(t)) - d) < 0.6).ToList();
            if (byD.Count == 0) { o.Notes.Add("Ø" + d + " арматурын төрөл загварт алга — алгаслаа."); return null; }
            string learned;
            if (names != null && names.TryGetValue(role + ":" + d, out learned))
            {
                RebarBarType lt = byD.FirstOrDefault(x => x.Name == learned);
                if (lt != null) return lt;
            }
            foreach (string g in Grades(role))
            {
                var rx = new Regex(Regex.Escape(g) + "(?![A-Za-zА-Яа-я])", RegexOptions.IgnoreCase);
                RebarBarType t = byD.FirstOrDefault(x => rx.IsMatch(x.Name));
                if (t != null) return t;
            }
            return byD[0];
        }

        static double Diameter(RebarBarType t)
        {
            try { double v = t.BarModelDiameter; if (v > 0) return v; } catch { }
            try { return t.BarNominalDiameter; } catch { return 0; }
        }

        public RebarHookType HookType(RebarStyle style, double deg, string prefer)
        {
            var all = new FilteredElementCollector(doc).OfClass(typeof(RebarHookType)).Cast<RebarHookType>()
                .Where(h => h.Style == style && Math.Abs(h.HookAngle * 180 / Math.PI - deg) < 1).ToList();
            return all.FirstOrDefault(h => prefer != null && h.Name.IndexOf(prefer, StringComparison.OrdinalIgnoreCase) >= 0) ?? all.FirstOrDefault();
        }

        void Mark(Rebar r)
        {
            try { r.get_Parameter(BuiltInParameter.ALL_MODEL_INSTANCE_COMMENTS)?.Set(tag ?? BbBeamRebarGen.Tag); } catch { }
            try { r.get_Parameter(BuiltInParameter.NUMBER_PARTITION_PARAM)?.Set(partition); } catch { }
        }

        public Rebar Create(RebarStyle style, RebarBarType bt, RebarHookType h0, RebarHookType h1, Element host, XYZ norm, IList<Curve> curves, string what)
        {
            // Дэгээний чиг: зүүн/зүүн эхэлж, бүтэхгүй бол бусад хослол.
            var orients = new[] { new[] { true, true }, new[] { false, false }, new[] { true, false }, new[] { false, true } };
            string err = null;
            foreach (bool[] or in (h0 == null && h1 == null ? orients.Take(1) : orients))
            {
                Tries++;
                CreateSw.Start();
                try
                {
                    Rebar r = CreateRaw(style, bt, h0, h1, host, norm, curves, or[0], or[1]);
                    CreateSw.Stop();
                    if (r != null) { MarkSw.Start(); Mark(r); MarkSw.Stop(); o.Created++; return r; }
                }
                catch (Exception ex) { err = ex.Message; }
                finally { CreateSw.Stop(); }
            }
            o.Failed++;
            o.Notes.Add(what + " үүсгэж чадсангүй" + (err != null ? ": " + err : "") + ".");
            return null;
        }

        /// <summary>
        /// C-хомут (180° дэгээтэй шулуун): жишээ шиг Stirrup/Tie хэв маягаар («C хомут» хэлбэр, ЖИШЭЭ-1 / 3) — бүтэхгүй бол Standard (Rebar Shape 93).
        /// </summary>
        public Rebar CreateTie(RebarBarType bt, Element host, XYZ norm, IList<Curve> curves, string what)
        {
            RebarHookType ht = HookType(RebarStyle.StirrupTie, 180, null) ?? HookType(RebarStyle.Standard, 180, null);
            if (ht != null)
                foreach (bool left in new[] { true, false })
                {
                    try
                    {
                        Tries++;
                        CreateSw.Start();
                        Rebar r = CreateRaw(RebarStyle.StirrupTie, bt, ht, ht, host, norm, curves, left, left);
                        if (r != null) { Mark(r); o.Created++; return r; }
                    }
                    catch { }
                    finally { CreateSw.Stop(); }
                }
            RebarHookType hs = HookType(RebarStyle.Standard, 180, null);
            return Create(RebarStyle.Standard, bt, hs, hs, host, norm, curves, what);
        }

        /// <summary>Revit 2027-оос дэгээ <c>BarTerminationsData</c>-аар (RebarHookOrientation устсан).</summary>
        Rebar CreateRaw(RebarStyle style, RebarBarType bt, RebarHookType h0, RebarHookType h1, Element host, XYZ norm, IList<Curve> curves, bool left0, bool left1)
        {
#if REVIT2027
            var td = new BarTerminationsData(doc)
            {
                HookTypeIdAtStart = h0 != null ? h0.Id : ElementId.InvalidElementId,
                HookTypeIdAtEnd = h1 != null ? h1.Id : ElementId.InvalidElementId,
                TerminationOrientationAtStart = left0 ? RebarTerminationOrientation.Left : RebarTerminationOrientation.Right,
                TerminationOrientationAtEnd = left1 ? RebarTerminationOrientation.Left : RebarTerminationOrientation.Right,
            };
            return Rebar.CreateFromCurves(doc, style, bt, host, norm, curves, td, true, true);
#else
            return Rebar.CreateFromCurves(doc, style, bt, h0, h1, host, norm, curves,
                left0 ? RebarHookOrientation.Left : RebarHookOrientation.Right, left1 ? RebarHookOrientation.Left : RebarHookOrientation.Right, true, true);
#endif
        }

        public static IList<Curve> Poly(IList<XYZ> pts, bool close = false)
        {
            var res = new List<Curve>();
            for (int i = 0; i + 1 < pts.Count; i++) res.Add(Line.CreateBound(pts[i], pts[i + 1]));
            if (close) res.Add(Line.CreateBound(pts[pts.Count - 1], pts[0]));
            return res;
        }

        /// <summary>Хөлтэй / муруй арматурын оройн засвар (фут, дэлхийн) — Ø + хэрчмийн чиглэлээр, энэ үүсгэлтийн турш.</summary>
        readonly Dictionary<string, XYZ[]> pathFix = new Dictionary<string, XYZ[]>();
        internal static bool DebugPaths;

        /// <summary>
        /// Дэгээгүй ажлын / муруй арматур (Standard) тэнхлэгийн оройгоор (<paramref name="pts"/>).  Хөлтэй (≥ 2 хэрчим) арматурт Revit нугалах
        /// радиусаа тааруулахдаа зарим хэрчмийг шилжүүлдэг (ЖИШЭЭ-4 ДН-4 консол: 11 хэлбэрийн хөл 12 мм гадагш — хамгаалах үе алдагдана) —
        /// үүсгэсний дараа оройг хэмжиж, зөрвөл засвартай дахин үүсгэнэ; засвар дараагийнхэд шууд.
        /// </summary>
        public Rebar CreatePath(RebarBarType bt, Element host, XYZ norm, IList<XYZ> pts, double dMm, string what)
        {
            if (pts.Count < 3) return Create(RebarStyle.Standard, bt, null, null, host, norm, Poly(pts), what);
            Func<XYZ, string> dir = v => { XYZ u = v.Normalize(); return Math.Round(u.X, 2) + "," + Math.Round(u.Y, 2) + "," + Math.Round(u.Z, 2); };
            string key = Math.Round(dMm, 1) + "|" + string.Join(";", Enumerable.Range(0, pts.Count - 1).Select(i => dir(pts[i + 1] - pts[i])));
            XYZ[] fix = pathFix.TryGetValue(key, out XYZ[] f) ? f : pts.Select(p => XYZ.Zero).ToArray();
            for (int attempt = 0; ; attempt++)
            {
                Rebar r = Create(RebarStyle.Standard, bt, null, null, host, norm, Poly(pts.Select((p, i) => p - fix[i]).ToList()), what);
                if (r == null) return null;
                // Хэлбэрийн тааруулалт (нугалаа / хамгаалах үе) regenerate-ийн дараа л тэнхлэгт гарна.
                RegenSw.Start();
                try { doc.Regenerate(); } catch { }
                RegenSw.Stop();
                XYZ[] dev = PathDeviation(r, pts);
                if (dev == null) return r;
                if (dev.All(v => v.GetLength() < BbGeom.Ft(0.5))) { pathFix[key] = fix; return r; }
                if (attempt >= 1)
                {
                    // Консолын шулуун үзүүрийг Revit d/2 хүртэл дотогш тайрдаг (ДН-3-1) — хамгаалах үе өсөх тал руу, анхааруулахгүй.
                    double worst = dev.Max(v => Mm(v.GetLength()));
                    if (worst > dMm / 2 + 0.5) o.Notes.Add(what + ": байрлал " + Math.Round(worst, 1) + " мм зөрсөн." + (DebugPaths ? " " + string.Join(" ", dev.Select((v, i) => i + ":" + Math.Round(Mm(v.X)) + "," + Math.Round(Mm(v.Y)) + "," + Math.Round(Mm(v.Z)))) + " | fix " + string.Join(" ", fix.Select(v => Math.Round(Mm(v.X)) + "," + Math.Round(Mm(v.Y)) + "," + Math.Round(Mm(v.Z)))) + " | pts " + string.Join(" ", pts.Select(v => Math.Round(Mm(v.X)) + "," + Math.Round(Mm(v.Y)) + "," + Math.Round(Mm(v.Z)))) : ""));
                    return r;
                }
                fix = fix.Select((v, i) => v + dev[i]).ToArray();
                doc.Delete(r.Id);
                o.Created--;
            }
        }

        /// <summary>Бодит тэнхлэгийн орой − зорьсон (нугалаагүй, дэгээгүй; эхний байрлал); тоо таарахгүй бол null.  Урвуу дараалалд ч тулгана.</summary>
        static XYZ[] PathDeviation(Rebar r, IList<XYZ> pts)
        {
            IList<Curve> cs;
            try { cs = r.GetTransformedCenterlineCurves(false, true, true, MultiplanarOption.IncludeOnlyPlanarCurves, 0); }
            catch { return null; }
            if (cs.Count != pts.Count - 1 || cs.Any(c => !(c is Line))) return null;
            var act = new List<XYZ> { cs[0].GetEndPoint(0) };
            act.AddRange(cs.Select(c => c.GetEndPoint(1)));
            XYZ[] fwd = act.Select((a, i) => a - pts[i]).ToArray(), rev = act.Select((a, i) => a - pts[pts.Count - 1 - i]).Reverse().ToArray();
            return fwd.Max(v => v.GetLength()) <= rev.Max(v => v.GetLength()) ? fwd : rev;
        }

        /// <summary>Битүү хомутын засвар (фут, тал бүр гадагш: b=0, a=La, b=Lb, a=0) — чиглэл / Ø-ээр, энэ үүсгэлтийн турш.</summary>
        readonly Dictionary<string, double[]> loopFix = new Dictionary<string, double[]>();

        /// <summary>
        /// Тэгш өнцөгт битүү хомут (<paramref name="c"/> = тэнхлэгийн 4 булан, тойргийн дарааллаар).  Revit 51 хэлбэрт тааруулахдаа зарим талыг d/2-оор
        /// дотогш татдаг (чиглэлээс хамаарна: дамнуруунд сүүлийн 2, баганад 4 тал) — үүсгэсний дараа бодит тэнхлэгийг хэмжиж, зөрвөл засвартай дахин
        /// үүсгэнэ; засвар нь дараагийнхэд шууд хэрэглэгдэнэ.
        /// </summary>
        public Rebar CreateLoop(RebarBarType bt, RebarHookType hk, Element host, XYZ norm, IList<XYZ> c, double dMm, string what)
        {
            XYZ a = (c[1] - c[0]).Normalize(), b = (c[3] - c[0]).Normalize();
            double La = (c[1] - c[0]).GetLength(), Lb = (c[3] - c[0]).GetLength();
            string key = Math.Round(dMm, 1) + "|" + Math.Round(a.X, 3) + "," + Math.Round(a.Y, 3) + "," + Math.Round(a.Z, 3) + "|" + Math.Round(b.X, 3) + "," + Math.Round(b.Y, 3) + "," + Math.Round(b.Z, 3);
            double[] fix = loopFix.TryGetValue(key, out double[] f) ? (double[])f.Clone() : new double[4];
            for (int attempt = 0; ; attempt++)
            {
                Func<double, double, XYZ> at = (u, v) => c[0] + a * u + b * v;
                var cc = new[] { at(-fix[3], -fix[0]), at(La + fix[1], -fix[0]), at(La + fix[1], Lb + fix[2]), at(-fix[3], Lb + fix[2]) };
                Rebar r = Create(RebarStyle.StirrupTie, bt, hk, hk, host, norm, Loop(cc, dMm), what);
                if (r == null) return null;
                RegenSw.Start();
                try { doc.Regenerate(); } catch { }
                RegenSw.Stop();
                double[] dev = LoopDeviation(r, c[0], a, b, La, Lb);
                if (dev == null || dev.All(x => Math.Abs(x) < BbGeom.Ft(0.5))) { loopFix[key] = fix; return r; }
                if (attempt >= 1)
                {
                    o.Notes.Add(what + ": хомутын тал хамгаалах үеэс " + Math.Round(dev.Max(x => Math.Abs(Mm(x))), 1) + " мм зөрсөн.");
                    return r;
                }
                for (int k = 0; k < 4; k++) fix[k] -= dev[k];
                doc.Delete(r.Id);
                o.Created--;
            }
        }

        /// <summary>Бодит тэнхлэг − зорьсон, тал бүрд (фут, гадагш +): b=0, a=La, b=Lb, a=0.  Тухайн талын хамгийн урт хэрчмээр.</summary>
        static double[] LoopDeviation(Rebar r, XYZ o0, XYZ a, XYZ b, double La, double Lb)
        {
            IList<Curve> cs;
            try { cs = r.GetTransformedCenterlineCurves(false, true, true, MultiplanarOption.IncludeOnlyPlanarCurves, 0); }
            catch { return null; }
            var dev = new double[4];
            var best = new double[4];
            foreach (Curve cv in cs)
            {
                if (!(cv is Line ln)) continue;
                XYZ p0 = ln.GetEndPoint(0), p1 = ln.GetEndPoint(1), d = (p1 - p0), mid = (p0 + p1) / 2;
                double len = d.GetLength();
                if (len < 1e-6) continue;
                d = d / len;
                int k;
                double v;
                if (Math.Abs(d.DotProduct(a)) > 0.99) { double t = (mid - o0).DotProduct(b); k = t < Lb / 2 ? 0 : 2; v = k == 0 ? -t : t - Lb; }
                else if (Math.Abs(d.DotProduct(b)) > 0.99) { double t = (mid - o0).DotProduct(a); k = t < La / 2 ? 3 : 1; v = k == 3 ? -t : t - La; }
                else continue;
                if (len > best[k]) { best[k] = len; dev[k] = v; }
            }
            return best.All(x => x > 0) ? dev : null;
        }

        /// <summary>Битүү хомутыг Revit-ийн өөрийн 51 хэлбэр шиг нээлттэй хүрээгээр (true) эсвэл битүү 4 хэрчмээр (false; gate «loop=closed»).</summary>
        internal static bool OpenLoop = true;

        /// <summary>
        /// Битүү хомутын тэнхлэгийн шугам (булангууд <paramref name="c"/> тойргийн дарааллаар).  Битүү 4 хэрчим өгвөл Revit сүүлийн хоёр хэрчмийг
        /// d/2-оор дотогш татдаг (доод / нэг хажуугийн хамгаалах үе +d/2 — хэрэглэгчийн зураг 1, 2); Revit-ийн гараар тавьсантай адил давхцах хоёр
        /// үзүүрийг эхний булангаас гадагш d/2 сунгаж нээлттэй өгвөл 4 тал бүгд хамгаалах үеийн шугамд (ЖИШЭЭ-4 ДН-2: 22 / 22 / 22 / 22).
        /// </summary>
        public static IList<Curve> Loop(IList<XYZ> c, double dMm)
        {
            if (!OpenLoop) return Poly(c, true);
            double h = BbGeom.Ft(dMm / 2);
            XYZ start = c[0] + (c[0] - c[1]).Normalize() * h, end = c[0] + (c[0] - c[c.Count - 1]).Normalize() * h;
            // start → c1 нь c0-оор, c[n-1] → end нь c0-оор дайрна.
            var pts = new List<XYZ> { start };
            for (int i = 1; i < c.Count; i++) pts.Add(c[i]);
            pts.Add(end);
            return Poly(pts);
        }

        /// <summary>Хомутын бүлэг: <paramref name="count"/> ширхэг, <paramref name="spacing"/> мм алхамтай (normal-ын тал руу).</summary>
        public void Layout(Rebar r, int count, double spacing)
        {
            if (r == null || count < 2) return;
            LayoutSw.Start();
            try { r.GetShapeDrivenAccessor().SetLayoutAsNumberWithSpacing(count, BbGeom.Ft(spacing), true, true, true); }
            catch (Exception ex) { o.Notes.Add("Хомутын layout: " + ex.Message); }
            finally { LayoutSw.Stop(); }
        }
    }
}
