using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using MglBb.Core;
using RevitMcpAddin.Reinforcement;

namespace MglBb.RevitSide
{
    /// <summary>Нэг тэмдэгтэй, босоо дээр дээрээ залгагдсан баганууд (давхар бүрийн элемент) — нэг дэлгээс.</summary>
    internal sealed class BbColumnStack
    {
        public string Mark = "";
        public readonly List<FamilyInstance> Members = new List<FamilyInstance>();   // доороос дээш
        public XYZ Center;                  // хэвтээ төв (Z = 0)
        public XYZ R;                       // баганын «өргөн» тэнхлэг (хэвтээ, нэгж)
        public double Bottom, Top;          // Z, фут
        public int RebarCount;
    }

    /// <summary>
    /// БАГАНЫ ажлын зураг (ЖИШЭЭ-1-ийн стандарт): «БАГАНА {mark} АРМАТУРЧЛАЛ» дэлгээс 1:50 (R = баганын өргөн тэнхлэг, дээш = Z, харагч V = R × Z;
    /// хавтгай нүүрнээс ГАДНА — хүрээлэгч дам нуруу харагдана), «{mark} S{n}» огтлол 1:25 ДЭЭРЭЭС харсан (давхар бүрийн дунд өндөрт, арматурын
    /// тохиргоо давтагдвал алгасна).  Нээлттэй Transaction дотор.
    /// </summary>
    internal static class BbColumns
    {
        public static BbColumnStack Stack(Document doc, FamilyInstance seed)
        {
            var st = new BbColumnStack { Mark = BbGeom.Mark(seed) };
            BoundingBoxXYZ sb = seed.get_BoundingBox(null);
            if (sb == null) throw new InvalidOperationException("Баганын хүрээ уншигдсангүй.");
            XYZ c0 = (sb.Min + sb.Max) / 2;
            double tolXY = BbGeom.Ft(80), tolZ = BbGeom.Ft(80);
            var cands = new List<FamilyInstance> { seed };
            if (st.Mark.Length > 0)
            {
                cands = new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_StructuralColumns).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>()
                    .Where(f => BbGeom.Mark(f) == st.Mark)
                    .Where(f =>
                    {
                        BoundingBoxXYZ b = f.get_BoundingBox(null);
                        if (b == null) return false;
                        XYZ c = (b.Min + b.Max) / 2;
                        return Math.Abs(c.X - c0.X) < tolXY && Math.Abs(c.Y - c0.Y) < tolXY;
                    }).ToList();
            }
            // Үргэлжилсэн босоо мөрийг seed-ээс дээш/доош өсгөнө.
            var byZ = cands.Select(f => new { F = f, B = f.get_BoundingBox(null) }).Where(x => x.B != null).OrderBy(x => x.B.Min.Z).ToList();
            int at = byZ.FindIndex(x => x.F.Id == seed.Id);
            if (at < 0) { byZ.Insert(0, new { F = seed, B = sb }); at = 0; }
            int lo = at, hi = at;
            while (lo > 0 && Math.Abs(byZ[lo - 1].B.Max.Z - byZ[lo].B.Min.Z) < tolZ) lo--;
            while (hi < byZ.Count - 1 && Math.Abs(byZ[hi + 1].B.Min.Z - byZ[hi].B.Max.Z) < tolZ) hi++;
            for (int i = lo; i <= hi; i++) st.Members.Add(byZ[i].F);
            st.Bottom = byZ[lo].B.Min.Z;
            st.Top = byZ[hi].B.Max.Z;
            st.Center = new XYZ(c0.X, c0.Y, 0);
            XYZ r = XYZ.BasisX;
            try
            {
                Transform t = seed.GetTransform();
                XYZ bx = new XYZ(t.BasisX.X, t.BasisX.Y, 0);
                if (bx.GetLength() > 1e-6) r = bx.Normalize();
            }
            catch { }
            // ЖИШЭЭ-1: дэлгээс R = +X — тэнхлэгийн чиглэлийг эерэг хагас руу (X, эсвэл X ≈ 0 бол Y) тогтооно.
            if (r.X < -1e-6 || (Math.Abs(r.X) < 1e-6 && r.Y < 0)) r = r.Negate();
            st.R = r;
            st.RebarCount = st.Members.Sum(m => BbGeom.RebarCount(m));
            return st;
        }

        public static BbGenResult Create(Document doc, BbColumnStack st, BbStandard std, BbGenOptions opt)
        {
            BbMemberStandard ms = std.For(BbMemberKind.Column);
            var res = new BbGenResult { Mark = st.Mark, Kind = BbMemberKind.Column };
            string mark = string.IsNullOrEmpty(st.Mark) ? "#" + st.Members[0].Id.Value : st.Mark;
            XYZ R = st.R, U = XYZ.BasisZ, V = R.CrossProduct(U).Normalize();

            // Хэмжээ (R, V тэнхлэгээр) — давхар бүрийн хамгийн их.
            double r0 = double.MaxValue, r1 = double.MinValue, v0 = double.MaxValue, v1 = double.MinValue;
            foreach (FamilyInstance m in st.Members)
            {
                BoundingBoxXYZ b = m.get_BoundingBox(null);
                if (b == null) continue;
                foreach (double x in new[] { b.Min.X, b.Max.X })
                    foreach (double y in new[] { b.Min.Y, b.Max.Y })
                    {
                        XYZ d = new XYZ(x, y, 0) - st.Center;
                        r0 = Math.Min(r0, d.DotProduct(R)); r1 = Math.Max(r1, d.DotProduct(R));
                        v0 = Math.Min(v0, d.DotProduct(V)); v1 = Math.Max(v1, d.DotProduct(V));
                    }
            }

            if (opt.Elevation)
            {
                List<string> want = BbCompanyRules.ElevViewTypes(BbMemberKind.Column, ms);
                ViewFamilyType vft = BbGeom.FindVft(doc, want, ViewFamily.Detail, out bool matched);
                if (vft == null) throw new InvalidOperationException("«Detail View» төрөл энэ төсөлд алга.");
                if (!matched && want.Count > 0)
                    res.Issues.Add(Issue(mark, BbSeverity.Warning, "Баганын дэлгээсийн төрөл «" + want[0] + "» алга — «" + vft.Name + "»-ээр үүсгэв.", "Компанийн template-ээс оруулах.", "elev-vft"));
                View template = BbGeom.FindTemplate(doc, ms.ElevTemplate);
                double left = BbGeom.Ft(ms.ElevCropBelowMm), right = BbGeom.Ft(ms.ElevCropAboveMm), vert = BbGeom.Ft(ms.ElevCropAlongMm);
                double planeV = v1 - BbGeom.Ft(ms.ElevPlaneInsideMm);
                double depth = Math.Max(BbGeom.Ft(50), planeV - v0 + BbGeom.Ft(ms.ElevFarBeyondMm));
                var extent = new BbSpan(BbGeom.ToMm(st.Bottom - vert), BbGeom.ToMm(st.Top + vert));
                // Хэсэглэх цэг = давхар хоорондын залгаас (дам нурууны «тулгуур»-тай адил).
                var joints = new List<BbSpan>();
                for (int i = 1; i < st.Members.Count; i++)
                {
                    double z = st.Members[i].get_BoundingBox(null).Min.Z;
                    joints.Add(new BbSpan(BbGeom.ToMm(z) - 100, BbGeom.ToMm(z) + 100));
                }
                // A2-ын өндөрт багтах (400 мм − гарчиг, давхрын тэмдэглэгээ, crop-ын нэмэлт) — сурсан утга (p90 ≈ 412) хуудаснаас урт гарч байв (Б-5, хэмжсэн).
                List<BbSpan> parts = BbLayoutMath.SplitParts(extent, joints, Math.Min(ms.ElevMaxPartPaperMm, 330) * Math.Max(1, ms.ElevScale), ms.ElevOverlapMm);
                if (parts.Count > 1) res.Notes.Add(mark + ": дэлгээс " + parts.Count + " хэсэгт (өндөр " + (extent.Length / 1000).ToString("0.0", CultureInfo.InvariantCulture) + " м)");
                for (int i = 0; i < parts.Count; i++)
                {
                    double z0 = BbGeom.Ft(parts[i].A), z1 = BbGeom.Ft(parts[i].B);
                    // ЖИШЭЭ-1: олон хэсэгтэй баганын дэлгээсийн нэр түвшний мужтай — «БАГАНА  Б-5 АРМАТУРЧЛАЛ   /+4.93-+21.43/».
                    string name = (parts.Count > 1 ? ms.ElevName(mark, 1) + "   /" + LevelRange(doc, st, z0, z1) + "/" : ms.ElevName(mark, 1)) + opt.NameSuffix;
                    if (Exists(doc, name) && opt.Existing == "skip") { res.Notes.Add("«" + name + "» аль хэдийн байгаа — алгасав."); continue; }
                    XYZ o = new XYZ(st.Center.X, st.Center.Y, (z0 + z1) / 2) + R * ((r0 + r1) / 2) + V * planeV;
                    double hw = (r1 - r0) / 2, hh = (z1 - z0) / 2;
                    ViewSection v = BbViews.CreateDetail(doc, vft, o, R, U, V, -hw - left, hw + right, -hh, hh, depth, res, mark);
                    if (v == null) continue;
                    BbViews.Configure(doc, v, template, ms.ElevScale, depth, BbGeom.UniqueViewName(doc, name), res, mark);
                    res.Elevations.Add(v);
                }
            }

            if (opt.Sections)
            {
                List<string> want = BbCompanyRules.SecViewTypes(BbMemberKind.Column, ms);
                ViewFamilyType vft = BbGeom.FindVft(doc, want, ViewFamily.Detail, out bool matched);
                if (vft != null && !matched)
                    res.Issues.Add(Issue(mark, BbSeverity.Warning, "Баганын огтлолын төрөл «" + want[0] + "» алга — «" + vft.Name + "»-ээр үүсгэв.", "Компанийн template-ээс оруулах.", "sec-vft"));
                View template = BbGeom.FindTemplate(doc, ms.SecTemplate);
                // ДЭЭРЭЭС харна: харагч +Z (V = Z), баруун = R, дээш = Z × R.
                XYZ sV = XYZ.BasisZ, sR = R, sU = sV.CrossProduct(sR).Normalize();
                var seen = new HashSet<string>(StringComparer.Ordinal);
                int n = 0;
                foreach (FamilyInstance m in st.Members)
                {
                    BoundingBoxXYZ b = m.get_BoundingBox(null);
                    if (b == null) continue;
                    double zc = (b.Min.Z + b.Max.Z) / 2;
                    string sig = Signature(doc, st, zc);
                    if (ms.SecSkipDuplicates && opt.SectionMode == "auto" && sig.Length > 0 && !seen.Add(sig)) { res.SkippedDuplicates++; continue; }
                    n++;
                    string name = ms.SecName(mark, n) + opt.NameSuffix;
                    if (Exists(doc, name) && opt.Existing == "skip") { res.Notes.Add("«" + name + "» аль хэдийн байгаа — алгасав."); continue; }
                    XYZ o = new XYZ(st.Center.X, st.Center.Y, zc) + R * ((r0 + r1) / 2) + V * ((v0 + v1) / 2);
                    double hw = (r1 - r0) / 2, hd = (v1 - v0) / 2;
                    // Баганын дэлгээс дээр огтлолын тэмдэг хэвтээ — хажуугийн crop нь тэмдгийн толгойг баганаас холдуулна.
                    double side = BbViews.MarkCrop(ms.SecCropSideMm, ms), below = BbGeom.Ft(ms.SecCropBelowMm), above = BbGeom.Ft(ms.SecCropAboveMm);
                    // Огтлолын «дээш» (sU) = −V (R × Z × … ) — хэмжээг харгалзах тэнхлэгээр.
                    double ua = Math.Min(-hd * sU.DotProduct(V), hd * sU.DotProduct(V)), ub = Math.Max(-hd * sU.DotProduct(V), hd * sU.DotProduct(V));
                    ViewSection v = BbViews.CreateDetail(doc, vft, o, sR, sU, sV, -hw - side, hw + side, ua - below, ub + above, BbGeom.Ft(ms.SecFarMm), res, mark);
                    if (v == null) continue;
                    BbViews.Configure(doc, v, template, ms.SecScale, BbGeom.Ft(ms.SecFarMm), BbGeom.UniqueViewName(doc, name), res, mark);
                    doc.Regenerate();
                    if (v.RightDirection.DotProduct(sR) < -0.99)
                    {
                        // Revit 2024-д хэмжсэн: дээрээс харсан (V = +Z) detail харагдац Configure/Regenerate-ийн дараа 180° эргэдэг (баруун = −R).
                        // ЖИШЭЭ-1-ийн «Б-5 S1»: баруун = +X, дээш = +Y — эсрэг чиглэлээр дахин үүсгэнэ.
                        doc.Delete(v.Id);
                        v = BbViews.CreateDetail(doc, vft, o, sR.Negate(), sU.Negate(), sV, -hw - side, hw + side, -ub - above, -ua + below, BbGeom.Ft(ms.SecFarMm), res, mark);
                        if (v == null) continue;
                        BbViews.Configure(doc, v, template, ms.SecScale, BbGeom.Ft(ms.SecFarMm), BbGeom.UniqueViewName(doc, name), res, mark);
                        doc.Regenerate();
                        if (v.RightDirection.DotProduct(sR) < 0.99)
                            res.Notes.Add(mark + ": «" + v.Name + "» чиглэл стандартаас өөр (баруун " + v.RightDirection + ").");
                    }
                    res.Sections.Add(v);
                    res.Stations.Add(BbGeom.ToMm(zc));
                }
            }
            return res;
        }

        /// <summary>
        /// Тухайн өндөр дэх арматурын тохиргоо: ажлын арматур «голч×тоо», хомут «S|голч|алхам» — ижил бол огтлол давтагдана.  Баганад дугаар ОРОХГҮЙ
        /// (давхар бүрийн арматур өөр дугаартай ч зохион байгуулалт ижил — инженер огтлолыг тохиргоо өөрчлөгдсөн давхарт л хийдэг).
        /// </summary>
        public static string Signature(Document doc, BbColumnStack st, double z)
        {
            var parts = new List<string>();
            foreach (FamilyInstance m in st.Members)
            {
                RebarHostData hd;
                try { hd = RebarHostData.GetRebarHostData(m); } catch { continue; }
                if (hd == null) continue;
                foreach (Rebar r in hd.GetRebarsInHost().OfType<Rebar>())
                {
                    RebarShape sh = doc.GetElement(r.GetShapeId()) as RebarShape;
                    if (sh == null) continue;
                    BoundingBoxXYZ bb = r.get_BoundingBox(null);
                    if (bb == null || z < bb.Min.Z || z > bb.Max.Z) continue;
                    double dia = 0;
                    try { dia = BbGeom.ToMm((doc.GetElement(r.GetTypeId()) as RebarBarType)?.BarModelDiameter ?? 0); } catch { }
                    if (sh.RebarStyle == RebarStyle.StirrupTie)
                    {
                        double sp = 0;
                        try { sp = BbGeom.ToMm(r.MaxSpacing); } catch { }
                        parts.Add("S|" + dia.ToString("0") + "|" + sp.ToString("0"));
                    }
                    else parts.Add(dia.ToString("0") + "×" + r.NumberOfBarPositions);
                }
            }
            parts.Sort(StringComparer.Ordinal);
            return string.Join(";", parts);
        }

        /// <summary>Хэсэгт хамгийн их орсон давхруудын суурь/дээд түвшний өндөр (м, тэмдэгтэй): «+4.93-+21.43».</summary>
        private static string LevelRange(Document doc, BbColumnStack st, double z0, double z1)
        {
            double lo = double.MaxValue, hi = double.MinValue;
            foreach (FamilyInstance m in st.Members)
            {
                BoundingBoxXYZ b = m.get_BoundingBox(null);
                if (b == null) continue;
                double ov = Math.Min(b.Max.Z, z1) - Math.Max(b.Min.Z, z0);
                if (ov < (b.Max.Z - b.Min.Z) * 0.5) continue;
                double e0 = LevelElev(doc, m, BuiltInParameter.FAMILY_BASE_LEVEL_PARAM, b.Min.Z), e1 = LevelElev(doc, m, BuiltInParameter.FAMILY_TOP_LEVEL_PARAM, b.Max.Z);
                lo = Math.Min(lo, e0); hi = Math.Max(hi, e1);
            }
            if (lo > hi) { lo = z0; hi = z1; }
            Func<double, string> fmt = ft => { double m = BbGeom.ToMm(ft) / 1000; return (m >= 0 ? "+" : "") + m.ToString("0.00", CultureInfo.InvariantCulture); };
            return fmt(lo) + "-" + fmt(hi);
        }

        private static double LevelElev(Document doc, FamilyInstance m, BuiltInParameter bip, double fallback)
        {
            try
            {
                if (doc.GetElement(m.get_Parameter(bip)?.AsElementId() ?? ElementId.InvalidElementId) is Level l) return l.ProjectElevation;
            }
            catch { }
            return fallback;
        }

        private static bool Exists(Document doc, string name)
        {
            return new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>().Any(v => !v.IsTemplate && v.Name == name);
        }

        private static BbIssue Issue(string mark, BbSeverity sev, string problem, string proposal, string code)
        {
            return new BbIssue { Tool = "Ажлын зураг үүсгэх", Severity = sev, Member = mark, Problem = problem, Proposal = proposal, Key = "gen|" + mark + "|" + code };
        }
    }
}
