using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using MglBb.Core;

namespace MglBb.RevitSide
{
    /// <summary>Нэг давхрын баганы элемент — арматур үүсгэх оролт (локал хүрээ: R = B тал, U = H тал, V = Z).</summary>
    internal sealed class BbColumnGenItem
    {
        public FamilyInstance Column;
        public BbColumnInput Input;
        public BbFrame Frame;
        /// <summary>Локал хүрээн дэх огтлолын min (фут) — Core-ийн (0, 0, 0).</summary>
        public double X0, Y0, Z0;
        public int Foreign, Own;
        public string Skip, Mark = "", Level = "";
        /// <summary>Элементийн «Rebar Cover - Other» (мм, 0 = тодорхойгүй).</summary>
        public double Cover;
        public string Size { get { return Math.Round(Input.B) + "×" + Math.Round(Input.H); } }
    }

    /// <summary>
    /// Баганын арматур: <see cref="BbColumns.Stack"/> (ижил тэмдэгтэй босоо мөр) → давхар бүрийн элемент (доод / дээд баганатай харьцуулж:
    /// ижил, тахир, огцом өөр, суурь) → <see cref="BbColumnRebarPlan"/> → ажлын арматур (ширхэг бүр, 3D зам), хомут (битүү + C,
    /// NumberWithSpacing).  Comments = <see cref="BbBeamRebarGen.Tag"/>.
    /// </summary>
    internal static class BbColumnRebarGen
    {
        static double Ft(double mm) { return BbGeom.Ft(mm); }
        static double Mm(double ft) { return BbGeom.ToMm(ft); }

        public static IEnumerable<FamilyInstance> AllColumns(Document doc)
        {
            return new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_StructuralColumns).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>();
        }

        /// <summary>Зангилааны хайлт: framing / хучилтын bbox — нэг удаа.</summary>
        private sealed class JointIndex
        {
            readonly List<BoundingBoxXYZ> boxes = new List<BoundingBoxXYZ>();
            public JointIndex(Document doc)
            {
                foreach (BuiltInCategory cat in new[] { BuiltInCategory.OST_StructuralFraming, BuiltInCategory.OST_Floors })
                    foreach (Element e in new FilteredElementCollector(doc).OfCategory(cat).WhereElementIsNotElementType())
                    {
                        BoundingBoxXYZ b = e.get_BoundingBox(null);
                        if (b != null) boxes.Add(b);
                    }
            }

            /// <summary>Баганын дээд нүүрт (±150 мм) тулсан хамгийн гүн дамнуруу / хучилт (≥ 200).</summary>
            public double Joint(BoundingBoxXYZ bb)
            {
                double best = 0;
                foreach (BoundingBoxXYZ e in boxes)
                {
                    if (Math.Abs(e.Max.Z - bb.Max.Z) > Ft(150)) continue;
                    if (e.Max.X < bb.Min.X - Ft(10) || e.Min.X > bb.Max.X + Ft(10) || e.Max.Y < bb.Min.Y - Ft(10) || e.Min.Y > bb.Max.Y + Ft(10)) continue;
                    best = Math.Max(best, Mm(bb.Max.Z - e.Min.Z));
                }
                return Math.Max(best, 200);
            }
        }

        public static List<BbColumnGenItem> Collect(Document doc, IEnumerable<FamilyInstance> columns)
        {
            var res = new List<BbColumnGenItem>();
            var seen = new HashSet<long>();
            var byMark = new Dictionary<string, List<FamilyInstance>>(StringComparer.Ordinal);
            foreach (FamilyInstance f in AllColumns(doc))
            {
                string m = BbGeom.Mark(f);
                if (!byMark.TryGetValue(m, out List<FamilyInstance> l)) byMark[m] = l = new List<FamilyInstance>();
                l.Add(f);
            }
            var joints = new JointIndex(doc);
            foreach (FamilyInstance fi in columns)
            {
                if (seen.Contains(fi.Id.Value)) continue;
                if (fi.StructuralMaterialType != StructuralMaterialType.Concrete && fi.StructuralMaterialType != StructuralMaterialType.PrecastConcrete) continue;
                BbColumnStack st;
                try { st = BbColumns.Stack(doc, fi, byMark.TryGetValue(BbGeom.Mark(fi), out List<FamilyInstance> same) ? same : null); }
                catch { continue; }
                for (int i = 0; i < st.Members.Count; i++)
                {
                    FamilyInstance m = st.Members[i];
                    if (!seen.Add(m.Id.Value)) continue;
                    res.Add(Analyze(doc, m, i > 0 ? st.Members[i - 1] : null, i + 1 < st.Members.Count ? st.Members[i + 1] : null, st.R, joints));
                }
            }
            return res.OrderBy(x => x.Mark, StringComparer.CurrentCulture).ThenBy(x => x.Z0).ToList();
        }

        static BbFrame FrameOf(XYZ r)
        {
            XYZ u = XYZ.BasisZ.CrossProduct(r).Normalize();
            return new BbFrame { O = XYZ.Zero, R = r, U = u, V = XYZ.BasisZ };
        }

        static BbColumnGenItem Analyze(Document doc, FamilyInstance c, FamilyInstance below, FamilyInstance above, XYZ r, JointIndex joints)
        {
            var it = new BbColumnGenItem { Column = c, Mark = BbGeom.Mark(c) };
            if (string.IsNullOrEmpty(it.Mark)) it.Mark = "#" + c.Id.Value;
            try { it.Level = doc.GetElement(c.LevelId)?.Name ?? ""; } catch { }
            it.Frame = FrameOf(r);
            BoundingBoxXYZ bb = c.get_BoundingBox(null);
            it.Input = new BbColumnInput();
            if (bb == null) { it.Skip = "хүрээ уншигдсангүй"; return it; }
            if (c.IsSlantedColumn) it.Skip = "налуу багана";
            // Хүрээ O = 0, V = Z тул локал Z = дэлхийн Z; bbox томорсон бол solid-ынх (BbBeamRebarGen.TrueExtent).
            BbBeamRebarGen.TrueExtent(c, bb, it.Frame, out XYZ mn, out XYZ mx);
            it.X0 = mn.X; it.Y0 = mn.Y; it.Z0 = mn.Z;
            it.Input.B = Mm(mx.X - mn.X);
            it.Input.H = Mm(mx.Y - mn.Y);
            it.Input.Height = Mm(mx.Z - mn.Z);
            if (above != null && above.get_BoundingBox(null) is BoundingBoxXYZ ab)
            {
                BbBeamRebarGen.TrueExtent(above, ab, it.Frame, out XYZ an, out XYZ ax);
                it.Input.ContinuesAbove = true;
                it.Input.AboveB = Mm(ax.X - an.X);
                it.Input.AboveH = Mm(ax.Y - an.Y);
                it.Input.AboveX0 = Mm(an.X - mn.X);
                it.Input.AboveY0 = Mm(an.Y - mn.Y);
                it.Input.AboveHeight = Mm(ax.Z - an.Z);
            }
            it.Input.Below = BbBelow.Foundation;
            if (below != null && below.get_BoundingBox(null) is BoundingBoxXYZ bl)
            {
                BbBeamRebarGen.TrueExtent(below, bl, it.Frame, out XYZ bn, out XYZ bx);
                double dl = Mm(mn.X - bn.X), dr = Mm(bx.X - mx.X), db = Mm(mn.Y - bn.Y), dt = Mm(bx.Y - mx.Y);
                double maxOff = new[] { dl, dr, db, dt }.Max(), minOff = new[] { dl, dr, db, dt }.Min();
                it.Input.Below = maxOff < 1 && minOff > -1 ? BbBelow.Same : minOff > -1 && maxOff <= 50 + 1 ? BbBelow.Cranked : BbBelow.Different;
            }
            it.Input.Joint = joints.Joint(bb);
            it.Cover = BbBeamRebarGen.HostCover(doc, c, BuiltInParameter.CLEAR_COVER_OTHER);
            foreach (Rebar rb in BbBeamRebarGen.RebarsOf(doc, c))
            {
                if (BbBeamRebarGen.IsOwn(rb)) it.Own++;
                else it.Foreign++;
            }
            return it;
        }

        public static string Partition(BbColumnGenItem it) { return "БАГАНА " + it.Mark + " АРМАТУРЧЛАЛ"; }

        /// <summary>Дэвтрийн мөрийн preset + элементийн cover (сонголтоор; норм зөрчих бол Plan өсгөнө).</summary>
        public static BbColumnPreset PresetFor(BbRebarBook book, BbColumnGenItem it, List<string> errors)
        {
            BbColumnPreset p = book.ColumnPreset(book.Col(it.Mark), it.Input.B, it.Input.H, errors);
            if (book.UseHostCover && it.Cover > 0) p.Cover = it.Cover;
            return p;
        }

        /// <summary>Битүү хомутын тойрог: <see cref="LoopCcw"/> = цагийн зүүний эсрэг (дээрээс), 51 хэлбэрт таарахын тулд.</summary>
        internal static bool LoopCcw = true;

        static XYZ[] TieLoop(Func<double, double, double, XYZ> P, double x0, double x1, double y0, double y1, double z)
        {
            return LoopCcw
                ? new[] { P(x0, y1, z), P(x0, y0, z), P(x1, y0, z), P(x1, y1, z) }
                : new[] { P(x0, y1, z), P(x1, y1, z), P(x1, y0, z), P(x0, y0, z) };
        }

        public static BbBeamRebarGen.Outcome Generate(Document doc, BbColumnGenItem it, BbColumnPreset p, bool replaceForeign)
        {
            var o = new BbBeamRebarGen.Outcome();
            BbColumnRebar plan = BbColumnRebarPlan.Plan(it.Input, p);
            o.Notes.AddRange(plan.Warnings);
            var del = BbBeamRebarGen.RebarsOf(doc, it.Column).Where(r => replaceForeign || BbBeamRebarGen.IsOwn(r)).Select(r => r.Id).ToList();
            if (del.Count > 0) { doc.Delete(del); o.Deleted = del.Count; }

            var bld = new BbRebarBuilder(doc, o, Partition(it));
            BbFrame fr = it.Frame;
            Func<double, double, double, XYZ> P = (x, y, z) => fr.World(it.X0 + Ft(x), it.Y0 + Ft(y), it.Z0 + Ft(z));
            RebarBarType bt = bld.BarType(plan.D, "main");
            if (bt != null)
                foreach (BbColumnBar b in plan.Bars)
                {
                    List<XYZ> pts = b.Path.Select(q => P(q[0], q[1], q[2])).ToList();
                    // Хавтгай: босоо + хэвтээ шилжилтийн чиг (тахир / хөл); бүрэн босоо бол R-ийн хавтгай (normal = U).
                    XYZ norm = fr.U;
                    for (int i = 1; i < pts.Count; i++)
                    {
                        XYZ d = pts[i] - pts[i - 1];
                        XYZ h = new XYZ(d.X, d.Y, 0);
                        if (h.GetLength() > Ft(1)) { norm = h.Normalize().CrossProduct(XYZ.BasisZ).Normalize(); break; }
                    }
                    bld.Create(RebarStyle.Standard, bt, null, null, it.Column, norm, BbRebarBuilder.Poly(pts), "ажлын Ø" + plan.D);
                }

            RebarBarType tt = bld.BarType(plan.TieD, "stirrup");
            if (tt != null)
            {
                RebarHookType h135 = bld.HookType(RebarStyle.StirrupTie, 135, "Seismic");
                double ds = plan.TieD;
                foreach (BbTieSet set in plan.Ties)
                    foreach (BbTieShape sh in plan.Shapes)
                    {
                        double z = set.Z0;
                        Rebar r;
                        if (sh.Closed)
                        {
                            double x0 = sh.X0 + ds / 2, x1 = sh.X1 - ds / 2, y0 = sh.Y0 + ds / 2, y1 = sh.Y1 - ds / 2;
                            r = bld.CreateLoop(tt, h135, it.Column, XYZ.BasisZ, TieLoop(P, x0, x1, y0, y1, z), ds, "хомут z=" + Math.Round(z));
                        }
                        else
                            r = bld.CreateTie(tt, it.Column, XYZ.BasisZ,
                                BbRebarBuilder.Poly(new[] { P(sh.X0, sh.Y0, z), P(sh.X1, sh.Y1, z) }), "C-хомут z=" + Math.Round(z));
                        bld.Layout(r, set.Count, set.Spacing);
                    }
            }
            return o;
        }
    }
}
