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
    /// Дамнурууны дэлгээсийн ДЭЭД ҮЕИЙН гинжин хэмжээс — хөдөлгүүрт байхгүй (ЖИШЭЭ-2 ДДН-10-аас тайлангаар, 2026-10-21):
    /// «дамнурууны эхлэл | тэнхлэгүүд | дээд үеийн АЖЛЫН арматурын (хамгийн том голч) таслах цэгүүд | дамнурууны төгсгөл» — нэг гинж, давхцлын
    /// эгнээнээс нэг алхам дээш.  Холбогч (жижиг голч) арматурын үзүүр, дамнурууны төгсгөлд тулсан үзүүр орохгүй.  Гинжийн БҮХ гишүүнээр нэг удаа,
    /// харагдацын хүрээнд.  Нээлттэй Transaction дотор.  <c>src/Engine</c>-ийг засахгүй.
    /// </summary>
    internal static class BbElevTopChain
    {
        private sealed class Pt
        {
            public double R;
            public Reference Ref;
            public int Rank;   // давхцвал: 0 дамнурууны төгсгөл, 1 тэнхлэг, 2 арматур
        }

        public static int Place(Document doc, View view, IList<RfElevContext> ctxs, Element mainHost, BbMemberStandard ms, ElementId dimTypeId, BbAnnoReport rep, string mark)
        {
            if (!ms.ElevTopChain) return 0;
            List<RfElevContext> beams = ctxs.Where(c => !c.IsColumn).ToList();
            if (beams.Count == 0) return 0;
            BbFrame f = BbFrame.Of(view);
            BoundingBoxXYZ mb = (mainHost ?? beams[0].Host).get_BoundingBox(null);
            if (mb == null) return 0;
            f.Extent(mb, out XYZ ma, out XYZ mz);
            double hu0 = ma.Y, hu1 = mz.Y, v = (ma.Z + mz.Z) / 2;
            var pts = new List<Pt>();

            // Дамнурууны хоёр төгсгөл: гинжийн хамгийн зүүн / баруун гишүүний тэнхлэгт перпендикуляр нүүр.
            var ends = new List<Pt>();
            foreach (RfElevContext c in beams) ends.AddRange(EndFaces(c.Host, view, f));
            if (ends.Count < 2) return 0;
            Pt e0 = ends.OrderBy(x => x.R).First(), e1 = ends.OrderBy(x => x.R).Last();
            pts.Add(e0); pts.Add(e1);
            double tolEnd = RfTol.MmToFt(150);

            // Тэнхлэгүүд (хөдөлгүүрийн олсон, id-аар давхардалгүй).
            var seen = new HashSet<long>();
            foreach (RfElevContext c in beams)
                foreach (KeyValuePair<double, Element> g in c.Spans)
                {
                    if (!(g.Value is Grid) || !seen.Add(g.Value.Id.Value)) continue;
                    double r = f.Local(c.Model(g.Key, 0)).X;
                    if (r <= e0.R + tolEnd || r >= e1.R - tolEnd) continue;
                    pts.Add(new Pt { R = r, Ref = new Reference(g.Value), Rank = 1 });
                }

            // Дээд үеийн ажлын арматур: дээд үеийн хамгийн том голчтой арматурын хоёр үзүүр.
            var top = new List<KeyValuePair<RfElevContext, RfElevBar>>();
            foreach (RfElevContext c in beams)
                foreach (RfElevBar b in c.Input.Bars)
                    if (c.Rebars.TryGetValue(b.Id, out Rebar rb) && c.EndRefs.ContainsKey(b.Id) && BbElevRules.Layer(rb, f, hu0, hu1) == BbBarRole.Top)
                        top.Add(new KeyValuePair<RfElevContext, RfElevBar>(c, b));
            // EndRefs-гүй (нугалсан) арматур ч дээд үед байж болно — Input.Bars-аас.
            foreach (RfElevContext c in beams)
                foreach (RfElevBar b in c.Input.Bars)
                    if (!c.EndRefs.ContainsKey(b.Id) && c.Rebars.TryGetValue(b.Id, out Rebar rb) && BbElevRules.Layer(rb, f, hu0, hu1) == BbBarRole.Top)
                        top.Add(new KeyValuePair<RfElevContext, RfElevBar>(c, b));
            if (top.Count > 0)
            {
                double dmax = top.Max(x => x.Value.Diameter);
                var bars = new HashSet<long>();
                foreach (var kv in top.Where(x => x.Value.Diameter > dmax - RfTol.MmToFt(1)))
                {
                    if (!bars.Add(kv.Value.Id)) continue;
                    if (kv.Key.EndRefs.TryGetValue(kv.Value.Id, out RfElevEndRefs er))
                        foreach (var end in new[] { new { U = kv.Value.U0, Ref = er.Left }, new { U = kv.Value.U1, Ref = er.Right } })
                        {
                            double r = f.Local(kv.Key.Model(end.U, 0)).X;
                            if (end.Ref == null || r <= e0.R + tolEnd || r >= e1.R - tolEnd) continue;
                            pts.Add(new Pt { R = r, Ref = end.Ref, Rank = 2 });
                        }
                    else
                        // Нугалсан арматур (ДДН-10 #11, #6): хөдөлгүүр үзүүрийн лавлагааг зөвхөн шулуунд олдог — хамгийн урт шулуун хэсгийн үзүүрээс.
                        foreach (Pt p in BentEnds(kv.Key.Rebars[kv.Value.Id], view, f, kv.Value.Diameter))
                            if (p.R > e0.R + tolEnd && p.R < e1.R - tolEnd) pts.Add(p);
                }
            }
            // Ижил цэгт нэгийг (төгсгөл > тэнхлэг > арматур).
            var chain = new List<Pt>();
            foreach (Pt p in pts.OrderBy(x => x.R).ThenBy(x => x.Rank))
                if (chain.Count == 0 || p.R - chain[chain.Count - 1].R > RfTol.MmToFt(5)) chain.Add(p);
            if (chain.Count < 3) return 0;

            int scale = view.Scale > 0 ? view.Scale : 50;
            double lineU = hu1 + RfTol.PaperMmToModelFt(Math.Max(1, ms.ElevDimFirstPaperMm) + Math.Max(1, ms.DimPitchPaperMm), scale);
            var dimType = dimTypeId != null && dimTypeId != ElementId.InvalidElementId ? doc.GetElement(dimTypeId) as DimensionType : null;
            using (var st = new SubTransaction(doc))
            {
                st.Start();
                try
                {
                    var ra = new ReferenceArray();
                    foreach (Pt p in chain) ra.Append(p.Ref);
                    Line line = Line.CreateBound(f.World(chain[0].R, lineU, v), f.World(chain[chain.Count - 1].R, lineU, v));
                    Dimension d = dimType != null ? doc.Create.NewDimension(view, line, ra, dimType) : doc.Create.NewDimension(view, line, ra);
                    if (d == null) throw new InvalidOperationException("NewDimension → null");
                    st.Commit();
                    return 1;
                }
                catch (Exception ex)
                {
                    if (st.HasStarted() && !st.HasEnded()) st.RollBack();
                    rep?.Notes.Add(mark + " «" + view.Name + "»: дээд үеийн гинжин хэмжээс — " + (ex.Message ?? "").Split('\n')[0]);
                    return 0;
                }
            }
        }

        /// <summary>
        /// Нугалсан арматурын үзүүрийн лавлагаа: хамгийн урт ШУЛУУН хэсгийн хоёр үзүүр дээрх (≤ 2 мм) босоо, урт нь ≈ голч шугам — хөдөлгүүрийн
        /// <c>FindEndCaps</c>-тай ижил шалгуур (View + IncludeNonVisibleObjects геометр).  Нугалаас (шулуун хэсэг үргэлжилдэг) тал олдохгүй — зөвхөн чөлөөт үзүүр.
        /// </summary>
        private static List<Pt> BentEnds(Rebar rb, View view, BbFrame f, double dia)
        {
            var res = new List<Pt>();
            Line main = null;
            try
            {
                foreach (Curve c in rb.GetTransformedCenterlineCurves(false, true, true, MultiplanarOption.IncludeOnlyPlanarCurves, 0))
                    if (c is Line l && (main == null || l.Length > main.Length)) main = l;
            }
            catch { }
            if (main == null) return res;
            var ends = new[] { f.Local(main.GetEndPoint(0)).X, f.Local(main.GetEndPoint(1)).X };
            GeometryElement ge;
            try { ge = rb.get_Geometry(new Options { ComputeReferences = true, View = view, IncludeNonVisibleObjects = true }); }
            catch { return res; }
            if (ge == null) return res;
            double tol = RfTol.MmToFt(2);
            var found = new Pt[2];
            WalkLines(ge, l =>
            {
                Reference rf;
                try { rf = l.Reference; } catch { return; }
                if (rf == null) return;
                XYZ pa = f.Local(l.GetEndPoint(0)), pb = f.Local(l.GetEndPoint(1));
                double dr = pb.X - pa.X, du = pb.Y - pa.Y, len = Math.Sqrt(dr * dr + du * du);
                if (len < dia * 0.5 || len > dia * 1.6 || Math.Abs(dr) / len > 0.05) return;
                double r = (pa.X + pb.X) / 2;
                for (int i = 0; i < 2; i++)
                    if (found[i] == null && Math.Abs(r - ends[i]) <= tol) found[i] = new Pt { R = r, Ref = rf, Rank = 2 };
            });
            foreach (Pt p in found) if (p != null) res.Add(p);
            return res;
        }

        private static void WalkLines(GeometryElement ge, Action<Line> onLine)
        {
            foreach (GeometryObject go in ge)
            {
                if (go is Line l) { onLine(l); continue; }
                if (go is GeometryInstance gi)
                {
                    GeometryElement sub = null;
                    try { sub = gi.GetSymbolGeometry(); } catch { }
                    if (sub != null) WalkLines(sub, onLine);
                }
            }
        }

        /// <summary>Гишүүний тэнхлэгт перпендикуляр (харагдацын R-ийн дагуух нормальтай) хоёр захын нүүр.</summary>
        private static List<Pt> EndFaces(Element host, View view, BbFrame f)
        {
            var res = new List<Pt>();
            GeometryElement ge;
            try { ge = host.get_Geometry(new Options { ComputeReferences = true, View = view }); }
            catch { return res; }
            if (ge == null) return res;
            var faces = new List<Pt>();
            Walk(ge, s =>
            {
                foreach (Face fc in s.Faces)
                {
                    if (!(fc is PlanarFace pf) || pf.Reference == null) continue;
                    if (Math.Abs(pf.FaceNormal.DotProduct(f.R)) < 0.99) continue;
                    faces.Add(new Pt { R = f.Local(pf.Origin).X, Ref = pf.Reference, Rank = 0 });
                }
            });
            if (faces.Count == 0) return res;
            res.Add(faces.OrderBy(x => x.R).First());
            res.Add(faces.OrderBy(x => x.R).Last());
            return res;
        }

        private static void Walk(GeometryElement ge, Action<Solid> onSolid)
        {
            foreach (GeometryObject go in ge)
            {
                if (go is Solid s && s.Faces.Size > 0) { onSolid(s); continue; }
                if (go is GeometryInstance gi)
                {
                    GeometryElement sub = null;
                    try { sub = gi.GetInstanceGeometry(); } catch { }
                    if (sub != null) Walk(sub, onSolid);
                }
            }
        }
    }
}
