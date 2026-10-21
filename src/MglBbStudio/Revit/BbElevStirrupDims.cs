using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using MglBb.Core;
using RevitMcpAddin.Reinforcement;
using RevitMcpAddin.Reinforcement.Core;

namespace MglBb.RevitSide
{
    /// <summary>
    /// Дамнурууны дэлгээсийн хомутын эгнээнд (MRA-ийн шугам дээр) бүс хоорондын хэмжээс — хөдөлгүүрт байхгүй (ЖИШЭЭ-2 ДДН-10-аас тайлангаар, 2026-10-21):
    /// дараалсан хоёр ГОЛ бүсийн хооронд багана байвал «сүүлийн хомут | баганын нүүр | баганын нүүр | эхний хомут» (50 | 700 | 50), байхгүй бол
    /// «хомут | хомут» (100, 150).  Богино нэмэлт бүс (≤ <see cref="BbMemberStandard.MraShortMaxBars"/> ширхэг — туслах дамнурууны огтлолцол) гинжинд
    /// орохгүй, түүнийг дайрсан шилжилтэд хэмжээс тавихгүй.  Гинжийн БҮХ гишүүний бүсийг нэгтгэж (гишүүн хоорондын баганад ч), харагдацын хүрээнд.
    /// Лавлагаа: дэлгээсийн геометрийн босоо шугам (хөдөлгүүрийн төгсгөлийн лавлагаатай ижил арга).  Нээлттэй Transaction дотор.  <c>src/Engine</c>-ийг засахгүй.
    /// </summary>
    internal static class BbElevStirrupDims
    {
        private sealed class Leg
        {
            public Reference Ref;
            public double R, V;
        }

        private sealed class Zone
        {
            public long Id;
            public int Count;
            public Leg First, Last;
        }

        internal sealed class Support
        {
            public double R0, R1;
            public Reference Near, Far;
        }

        public static int Place(Document doc, View view, IList<RfElevContext> ctxs, BbMemberStandard ms, ElementId dimTypeId, BbAnnoReport rep, string mark)
        {
            if (!ms.ElevStirrupGaps) return 0;
            List<RfElevContext> beams = ctxs.Where(c => !c.IsColumn && c.Input.Stirrups.Count > 0).ToList();
            if (beams.Count == 0) return 0;
            BbFrame f = BbFrame.Of(view);

            // Бүх гишүүний бүс (id-аар давхардалгүй); хомутын хөлийн өндрийн босго = ХОМУТЫН ӨӨРИЙН өндрийн 50 % (гүн гишүүний — ДДН-10-ийн
            // 2067 мм — гүнээр бол 616 мм-ийн хөл шүүгдэж X5 баганын хэмжээс алга болдог байв).
            var zones = new List<Zone>();
            var seen = new HashSet<long>();
            RfElevContext main = beams.OrderByDescending(c => c.Input.Stirrups.Count).First();
            foreach (RfElevContext c in beams)
            {
                foreach (RfElevStirrup s in c.Input.Stirrups)
                {
                    if (!seen.Add(s.Id) || !c.Rebars.TryGetValue(s.Id, out Rebar rb)) continue;
                    if (!Extent(rb, f, out double u0, out double u1)) continue;
                    var z = new Zone { Id = s.Id, Count = s.Count };
                    Legs(rb, view, f, 0.5 * (u1 - u0), out z.First, out z.Last);   // богино бүс ч — дарааллыг тасалдуулахад
                    if (z.First != null) zones.Add(z);
                }
            }
            zones = zones.OrderBy(z => z.First.R).ToList();
            if (zones.Count < 2 || !Extent(main.Host, f, out double mb, out double _)) return 0;
            int scale = view.Scale > 0 ? view.Scale : 50;
            double lineU = mb - RfTol.PaperMmToModelFt(Math.Max(1, ms.StirrupDimOffsetPaperMm), scale);
            var dimType = dimTypeId != null && dimTypeId != ElementId.InvalidElementId ? doc.GetElement(dimTypeId) as DimensionType : null;
            List<Support> supports = Supports(doc, view, f);

            int made = 0;
            for (int i = 0; i + 1 < zones.Count; i++)
            {
                Zone a = zones[i], b = zones[i + 1];
                if (a.Count <= ms.MraShortMaxBars || b.Count <= ms.MraShortMaxBars) continue;   // богино бүсийг дайрсан шилжилт
                if (b.First.R <= a.Last.R) continue;
                var ra = new ReferenceArray();
                ra.Append(a.Last.Ref);
                double tol = RfTol.MmToFt(5);
                Support sp = supports.FirstOrDefault(x => x.R0 > a.Last.R - tol && x.R1 < b.First.R + tol);
                if (sp != null) { ra.Append(sp.Near); ra.Append(sp.Far); }
                ra.Append(b.First.Ref);
                using (var st = new SubTransaction(doc))
                {
                    st.Start();
                    try
                    {
                        Line line = Line.CreateBound(f.World(a.Last.R, lineU, a.Last.V), f.World(b.First.R, lineU, a.Last.V));
                        Dimension d = dimType != null ? doc.Create.NewDimension(view, line, ra, dimType) : doc.Create.NewDimension(view, line, ra);
                        if (d == null) throw new InvalidOperationException("NewDimension → null");
                        st.Commit();
                        made++;
                    }
                    catch (Exception ex)
                    {
                        if (st.HasStarted() && !st.HasEnded()) st.RollBack();
                        rep?.Notes.Add(mark + " «" + view.Name + "»: хомутын бүс хоорондын хэмжээс (" + a.Id + " → " + b.Id + ") — " + (ex.Message ?? "").Split('\n')[0]);
                    }
                }
            }
            return made;
        }

        /// <summary>Элементийн босоо муж (харагдацын u).</summary>
        private static bool Extent(Element e, BbFrame f, out double u0, out double u1)
        {
            u0 = u1 = 0;
            BoundingBoxXYZ bb = e?.get_BoundingBox(null);
            if (bb == null) return false;
            f.Extent(bb, out XYZ a, out XYZ b);
            u0 = a.Y; u1 = b.Y;
            return true;
        }

        /// <summary>Хомутын олонлогийн эхний / сүүлийн ширхгийн босоо шугамын лавлагаа (өндөр ≥ <paramref name="minLen"/>); хэд хэдэн шугамтай бол дунджид ойр.</summary>
        private static void Legs(Rebar rb, View view, BbFrame f, double minLen, out Leg first, out Leg last)
        {
            first = last = null;
            GeometryElement ge;
            try { ge = rb.get_Geometry(new Options { ComputeReferences = true, View = view, IncludeNonVisibleObjects = true }); }
            catch { return; }
            if (ge == null) return;
            var legs = new List<Leg>();
            Walk(ge, l =>
            {
                Reference rf;
                try { rf = l.Reference; } catch { return; }
                if (rf == null) return;
                XYZ pa = f.Local(l.GetEndPoint(0)), pb = f.Local(l.GetEndPoint(1));
                double dr = pb.X - pa.X, du = pb.Y - pa.Y, len = Math.Sqrt(dr * dr + du * du);
                if (len < minLen || Math.Abs(dr) / len > 0.05) return;
                legs.Add(new Leg { Ref = rf, R = (pa.X + pb.X) / 2, V = (pa.Z + pb.Z) / 2 });
            });
            if (legs.Count == 0) return;
            double tol = RfTol.MmToFt(20);
            double lo = legs.Min(x => x.R), hi = legs.Max(x => x.R);
            first = Pick(legs.Where(x => x.R <= lo + tol).ToList());
            last = Pick(legs.Where(x => x.R >= hi - tol).ToList());
        }

        private static Leg Pick(List<Leg> g)
        {
            double mid = g.Average(x => x.R);
            return g.OrderBy(x => Math.Abs(x.R - mid)).First();
        }

        /// <summary>Харагдацын баганууд: дамнурууны дагуух хоёр нүүрний (тэнхлэгт перпендикуляр) лавлагаа.</summary>
        internal static List<Support> Supports(Document doc, View view, BbFrame f)
        {
            var res = new List<Support>();
            foreach (Element col in new FilteredElementCollector(doc, view.Id).OfCategory(BuiltInCategory.OST_StructuralColumns).WhereElementIsNotElementType())
            {
                GeometryElement ge;
                try { ge = col.get_Geometry(new Options { ComputeReferences = true, View = view }); }
                catch { continue; }
                if (ge == null) continue;
                var faces = new List<Leg>();
                WalkSolids(ge, s =>
                {
                    foreach (Face fc in s.Faces)
                    {
                        if (!(fc is PlanarFace pf) || pf.Reference == null) continue;
                        if (Math.Abs(pf.FaceNormal.DotProduct(f.R)) < 0.99) continue;
                        faces.Add(new Leg { Ref = pf.Reference, R = f.Local(pf.Origin).X });
                    }
                });
                if (faces.Count < 2) continue;
                Leg near = faces.OrderBy(x => x.R).First(), far = faces.OrderBy(x => x.R).Last();
                if (far.R - near.R < RfTol.MmToFt(50)) continue;
                res.Add(new Support { R0 = near.R, R1 = far.R, Near = near.Ref, Far = far.Ref });
            }
            return res.OrderBy(x => x.R0).ToList();
        }

        private static void Walk(GeometryElement ge, Action<Line> onLine)
        {
            foreach (GeometryObject go in ge)
            {
                if (go is Line l) { onLine(l); continue; }
                if (go is GeometryInstance gi)
                {
                    GeometryElement sub = null;
                    try { sub = gi.GetSymbolGeometry(); } catch { }
                    if (sub != null) Walk(sub, onLine);
                }
            }
        }

        private static void WalkSolids(GeometryElement ge, Action<Solid> onSolid)
        {
            foreach (GeometryObject go in ge)
            {
                if (go is Solid s && s.Faces.Size > 0) { onSolid(s); continue; }
                if (go is GeometryInstance gi)
                {
                    GeometryElement sub = null;
                    try { sub = gi.GetInstanceGeometry(); } catch { }
                    if (sub != null) WalkSolids(sub, onSolid);
                }
            }
        }
    }
}
