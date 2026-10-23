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

        public static int Place(Document doc, View view, IList<RfElevContext> ctxs, Element mainHost, BbMemberStandard ms, ElementId dimTypeId, BbAnnoReport rep, string mark, IDictionary<RfElevContext, RfElevPlan> plans = null)
        {
            var log = new System.Text.StringBuilder();
            try { return PlaceCore(doc, view, ctxs, mainHost, ms, dimTypeId, rep, mark, log, plans); }
            finally
            {
                // Оношлогоо: гинж яагаад тавигдаагүйг (цэгүүд, лавлагаа, алдаа) харуулна.
                try { System.IO.File.WriteAllText(System.IO.Path.Combine(Paths.Root, "topchain-log.txt"), DateTime.Now.ToString("s") + " «" + view.Name + "»" + Environment.NewLine + log, new System.Text.UTF8Encoding(true)); }
                catch { }
            }
        }

        private static int PlaceCore(Document doc, View view, IList<RfElevContext> ctxs, Element mainHost, BbMemberStandard ms, ElementId dimTypeId, BbAnnoReport rep, string mark, System.Text.StringBuilder log, IDictionary<RfElevContext, RfElevPlan> plans)
        {
            Func<double, string> mm = ft => BbGeom.ToMm(ft).ToString("0");
            log.AppendLine("enabled " + ms.ElevTopChain + " contexts " + ctxs.Count + " main " + mainHost?.Id.Value);
            // Нугалсан арматурын давхцал гинжгүй ч зурагдана (ЖИШЭЭ 3 ТДН-1-5: туслах дамнууруу гинж сураагүй байхад «550» алга байв).
            if (!ms.ElevTopChain && !ms.ElevLaps) return 0;
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
            foreach (RfElevContext c in beams)
            {
                List<Pt> ef = EndFaces(c.Host, view, f);
                log.AppendLine("host " + c.Host.Id.Value + " end faces " + string.Join(" ", ef.Select(x => mm(x.R))) + " grids " + c.Spans.Count + " bars " + c.Input.Bars.Count + " endRefs " + c.EndRefs.Count);
                ends.AddRange(ef);
            }
            // Нүүр олдохгүй бол (ДН-11: Coarse / баганатай нийлсэн) гинжийг зогсоохгүй — дамнурууны хүрээгээр хязгаарлаж тэнхлэг + арматураар.
            Pt e0, e1;
            // Нэг л нүүр олдвол (ЖИШЭЭ 3 ТДН-1-5: зүүн үзүүр тулгуур дамнуруутай нийлсэн — нүүр лавлагаагүй) хоёр үзүүр ижил болдог — хүрээгээр.
            if (ends.Count >= 2 && ends.Max(x => x.R) - ends.Min(x => x.R) > RfTol.MmToFt(300))
            {
                e0 = ends.OrderBy(x => x.R).First(); e1 = ends.OrderBy(x => x.R).Last();
                pts.Add(e0); pts.Add(e1);
            }
            else
            {
                double lo = double.MaxValue, hi = double.MinValue;
                foreach (RfElevContext c in beams)
                {
                    BoundingBoxXYZ bb = c.Host.get_BoundingBox(null);
                    if (bb == null) continue;
                    f.Extent(bb, out XYZ a, out XYZ b);
                    lo = Math.Min(lo, a.X); hi = Math.Max(hi, b.X);
                }
                e0 = new Pt { R = lo }; e1 = new Pt { R = hi };
                log.AppendLine("дамнурууны төгсгөлийн нүүр олдсонгүй — гинж тэнхлэг/арматураар, хүрээ r " + mm(lo) + ".." + mm(hi));
            }
            double tolEnd = RfTol.MmToFt(150);
            // Дамнурууны үзүүр баганын ДОТОР бол (ДН-11: Y1 = баганын гол) гинж тэр баганын ГАДНА нүүрээр эхэлж/төгсөнө — «550 | 3550 | …»;
            // консол үзүүр (ДДН-10) баганагүй — дамнурууны нүүр хэвээр.
            // Хэсэгчилсэн дэлгээс (ДН-11 Copy 3 — crop Y3 орчим, дамнуруу 50 м): crop-оос гадуурх баганыг гинжинд оруулахгүй.
            double cr0 = double.MinValue, cr1 = double.MaxValue;
            if (view.CropBoxActive) { cr0 = view.CropBox.Min.X; cr1 = view.CropBox.Max.X; }
            List<BbElevStirrupDims.Support> cols = BbElevStirrupDims.Supports(doc, view, f, true);
            BbElevStirrupDims.Support c0 = cols.FirstOrDefault(c => e0.R >= c.R0 - tolEnd && e0.R <= c.R1 + tolEnd && c.R0 >= cr0 - tolEnd);
            BbElevStirrupDims.Support c1 = cols.LastOrDefault(c => e1.R >= c.R0 - tolEnd && e1.R <= c.R1 + tolEnd && c.R1 <= cr1 + tolEnd);
            if (c0 != null || c1 != null)
            {
                pts.Remove(e0); pts.Remove(e1);
                if (c0 != null) e0 = new Pt { R = c0.R0, Ref = c0.Near, Rank = 0 };
                if (c1 != null) e1 = new Pt { R = c1.R1, Ref = c1.Far, Rank = 0 };
                if (e0.Ref != null) pts.Add(e0);
                if (e1.Ref != null) pts.Add(e1);
                log.AppendLine("үзүүр баганад: " + (c0 != null ? "эхлэл баганын нүүр r " + mm(c0.R0) : "эхлэл хэвээр") + ", " + (c1 != null ? "төгсгөл баганын нүүр r " + mm(c1.R1) : "төгсгөл хэвээр"));
            }

            // Тэнхлэгүүд (хөдөлгүүрийн олсон, id-аар давхардалгүй).  Дамнурууны нүүргүй үед (ДН-11 — дамнуруу Y1 тэнхлэг/баганын голд эхэлдэг)
            // захын тэнхлэг гинжийн эхлэл/төгсгөл болно — хүрээний захад ч хасахгүй.
            bool hasEnds = e0.Ref != null;
            var seen = new HashSet<long>();
            // Сурсан бол тэнхлэггүй (ЖИШЭЭ 3 ТДН-1-5/1-6) — тулгуурын нүүргүй (hasEnds = false) үед тэнхлэг л гинжийн үзүүр тул хэвээр.
            if (!ms.ElevTopChainGrids && hasEnds) log.AppendLine("тэнхлэггүй гинж (сурсан)");
            else
            foreach (RfElevContext c in beams)
                foreach (KeyValuePair<double, Element> g in c.Spans)
                {
                    if (!(g.Value is Grid) || !seen.Add(g.Value.Id.Value)) continue;
                    double r = f.Local(c.Model(g.Key, 0)).X;
                    if (hasEnds ? (r <= e0.R + tolEnd || r >= e1.R - tolEnd) : (r < e0.R - tolEnd || r > e1.R + tolEnd)) continue;
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
            log.AppendLine("top-layer bars " + string.Join(" ", top.Select(x => x.Value.Id + "(d" + mm(x.Value.Diameter) + (x.Key.EndRefs.ContainsKey(x.Value.Id) ? "" : " bent") + ")")));
            if (top.Count > 0)
            {
                // Ажлын арматур = хамгийн том голчийн ≥ 70 % (ДН-11: ⌀28 ба ⌀25 хоёулаа; ⌀12 холбогч орохгүй).
                double dmax = top.Max(x => x.Value.Diameter);
                var bars = new HashSet<long>();
                foreach (var kv in top.Where(x => x.Value.Diameter >= 0.7 * dmax))
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
            int scale = view.Scale > 0 ? view.Scale : 50;
            var dimType = dimTypeId != null && dimTypeId != ElementId.InvalidElementId ? doc.GetElement(dimTypeId) as DimensionType : null;
            // Дээд нүүр — хөдөлгүүрийн гишүүний хүрээгээр (host-ын bbox ДН-5-д 100 мм илүү өндөр — гинж 2 мм цаасаар дээш гардаг байв).
            RfElevContext mc = beams.FirstOrDefault(c => c.Host.Id == (mainHost ?? beams[0].Host).Id) ?? beams[0];
            double topFace = mc.Input.BeamV1 > mc.Input.BeamV0 ? f.Local(mc.Model(0, mc.Input.BeamV1)).Y : hu1;
            double lapU = topFace + RfTol.PaperMmToModelFt(Math.Max(1, ms.ElevDimFirstPaperMm), scale);

            // Давхцлын муж (BbFrame R): хөдөлгүүрийнх + нугалсан арматурынх (энд зурна).
            var laps = new List<double[]>();
            foreach (RfElevContext c in beams)
                foreach (RfElevLapPlan l in plans != null && plans.TryGetValue(c, out RfElevPlan pl) ? pl.Laps : new List<RfElevLapPlan>())
                    if (l.Side == RfElevSide.Top) laps.Add(new[] { f.Local(c.Model(l.U0, 0)).X, f.Local(c.Model(l.U1, 0)).X });
            if (ms.ElevLaps)
                foreach (double[] l in BentLaps(doc, view, f, beams, hu0, hu1, lapU, v, dimType, log)) laps.Add(l);

            if (!ms.ElevTopChain) { log.AppendLine("гинж унтраалттай — зөвхөн давхцал"); return 0; }

            // Ижил цэгт нэгийг (төгсгөл > тэнхлэг > арматур).
            var chain = new List<Pt>();
            foreach (Pt p in pts.OrderBy(x => x.R).ThenBy(x => x.Rank))
                if (chain.Count == 0 || p.R - chain[chain.Count - 1].R > RfTol.MmToFt(5)) chain.Add(p);
            // Давхцлын хоёр үзүүр хоёулаа гинжид үлдэнэ (ББ инженер 2026-10-23: «хоёрыг хоёуланг нь»).
            double tolPt = RfTol.MmToFt(5);
            log.AppendLine("laps " + string.Join(" ", laps.Select(l => mm(l[0]) + ".." + mm(l[1]))));
            log.AppendLine("chain " + string.Join(" | ", chain.Select(p => (p.Rank == 0 ? "END" : p.Rank == 1 ? "GRID" : "BAR") + "@" + mm(p.R))));
            if (chain.Count < 3) { log.AppendLine("STOP: гинжийн цэг < 3"); return 0; }

            double lineU = lapU + RfTol.PaperMmToModelFt(Math.Max(1, ms.DimPitchPaperMm), scale);
            // Баганын нүүрний лавлагааг Revit заримдаа хасдаг (ДН-5: ижил кодоор 8 / 7 / 6 сегмент) — дутуу бол буцааж, лавлагааг шинээр авч дахин.
            for (int attempt = 0; attempt < 3; attempt++)
            {
                if (attempt > 0)
                {
                    doc.Regenerate();
                    List<BbElevStirrupDims.Support> fresh = BbElevStirrupDims.Supports(doc, view, f, true);
                    foreach (Pt p in chain.Where(x => x.Rank == 0))
                    {
                        BbElevStirrupDims.Support sp = fresh.FirstOrDefault(x => Math.Abs(x.R0 - p.R) < tolPt || Math.Abs(x.R1 - p.R) < tolPt);
                        if (sp != null) p.Ref = Math.Abs(sp.R0 - p.R) < tolPt ? sp.Near : sp.Far;
                    }
                }
                bool last = attempt == 2;
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
                        int segs = d.Segments?.Size ?? 0;
                        log.AppendLine("attempt " + attempt + " dimension " + d.Id.Value + " segments " + segs + " / " + (chain.Count - 1));
                        if (segs < chain.Count - 1 && !last)
                        {
                            foreach (Reference rf in d.References) { string sr = "?"; try { sr = rf.ConvertToStableRepresentation(doc); } catch { } log.AppendLine("  out " + sr); }
                            // RollBack БИШ — subtransaction буцаахад огтлолын ирмэгээр (CUT_EDGE) хэмжсэн бусад хэмжээсийг Revit 4.75 м доош шилжүүлдэг
                            // (ЖИШЭЭ 3 ТДН-1-5, хэмжсэн).  Дутуу хэмжээсийг устгаад commit.
                            doc.Delete(d.Id);
                            st.Commit();
                            continue;
                        }
                        st.Commit();
                        BbElevStirrupDims.Track(d, lineU);   // CUT_EDGE-тэй бол Regenerate шилжүүлдэг (ТДН-1-9: 975 → -3775)
                        return 1;
                    }
                    catch (Exception ex)
                    {
                        log.AppendLine("FAIL " + ex.GetType().Name + ": " + ex.Message);
                        if (st.HasStarted() && !st.HasEnded()) st.RollBack();
                        if (!last) continue;
                        rep?.Notes.Add(mark + " «" + view.Name + "»: дээд үеийн гинжин хэмжээс — " + (ex.Message ?? "").Split('\n')[0]);
                        return 0;
                    }
                }
            }
            return 0;
        }

        /// <summary>
        /// Нугалсан дээд арматурын (хөдөлгүүр үзүүрийн лавлагаагүй тул давхцалд оруулдаггүй) чөлөөт үзүүр өөр дээд арматурын дотор орсон бол давхцлын
        /// хэмжээс — ДН-5: #6 (Г хэлбэр) ба ⌀12 #5, «500» хоёр талд.  Давхцлын эгнээнд (<paramref name="lapU"/>).  Зурсан мужууд (R).
        /// </summary>
        private static List<double[]> BentLaps(Document doc, View view, BbFrame f, List<RfElevContext> beams, double hu0, double hu1, double lapU, double depth, DimensionType dimType, System.Text.StringBuilder log)
        {
            var res = new List<double[]>();
            var straight = new List<Pt[]>();   // [зүүн, баруун]
            var bent = new List<KeyValuePair<Rebar, RfElevBar>>();
            foreach (RfElevContext c in beams)
                foreach (RfElevBar b in c.Input.Bars)
                {
                    if (!c.Rebars.TryGetValue(b.Id, out Rebar rb) || BbElevRules.Layer(rb, f, hu0, hu1) != BbBarRole.Top) continue;
                    if (c.EndRefs.TryGetValue(b.Id, out RfElevEndRefs er))
                    {
                        if (er.Left != null && er.Right != null)
                            straight.Add(new[] { new Pt { R = f.Local(c.Model(b.U0, 0)).X, Ref = er.Left }, new Pt { R = f.Local(c.Model(b.U1, 0)).X, Ref = er.Right } });
                    }
                    else bent.Add(new KeyValuePair<Rebar, RfElevBar>(rb, b));
                }
            double tol = RfTol.MmToFt(5), maxLap = RfTol.MmToFt(3000);
            foreach (var kv in bent)
            {
                if (!MainSpan(kv.Key, f, out double a0, out double a1)) continue;
                foreach (Pt p in BentEnds(kv.Key, view, f, kv.Value.Diameter))
                {
                    bool right = Math.Abs(p.R - a1) < Math.Abs(p.R - a0);
                    foreach (Pt[] s in straight)
                    {
                        // Баруун чөлөөт үзүүр: B-ийн зүүн үзүүр A дотор, A-ийн үзүүр B дотор → [B.зүүн, A.үзүүр]; зүүн нь эсрэгээр.
                        Pt lo = right ? s[0] : p, hi = right ? p : s[1];
                        if (right ? !(s[0].R > a0 + tol && s[0].R < p.R - tol && p.R < s[1].R - tol)
                                  : !(s[1].R < a1 - tol && s[1].R > p.R + tol && p.R > s[0].R + tol)) continue;
                        if (hi.R - lo.R > maxLap) continue;
                        using (var st = new SubTransaction(doc))
                        {
                            st.Start();
                            try
                            {
                                var ra = new ReferenceArray();
                                ra.Append(lo.Ref); ra.Append(hi.Ref);
                                Line line = Line.CreateBound(f.World(lo.R, lapU, depth), f.World(hi.R, lapU, depth));
                                Dimension d = dimType != null ? doc.Create.NewDimension(view, line, ra, dimType) : doc.Create.NewDimension(view, line, ra);
                                if (d == null) throw new InvalidOperationException("NewDimension → null");
                                st.Commit();
                                res.Add(new[] { lo.R, hi.R });
                                log.AppendLine("bent lap " + kv.Value.Id + " " + BbGeom.ToMm(lo.R).ToString("0") + ".." + BbGeom.ToMm(hi.R).ToString("0") + " OK " + d.Id.Value);
                            }
                            catch (Exception ex)
                            {
                                if (st.HasStarted() && !st.HasEnded()) st.RollBack();
                                log.AppendLine("bent lap " + kv.Value.Id + " FAIL " + ex.Message);
                            }
                        }
                    }
                }
            }
            return res;
        }

        /// <summary>Хамгийн урт шулуун хэсгийн R-муж.</summary>
        private static bool MainSpan(Rebar rb, BbFrame f, out double r0, out double r1)
        {
            r0 = r1 = 0;
            Line main = null;
            try
            {
                foreach (Curve c in rb.GetTransformedCenterlineCurves(false, true, true, MultiplanarOption.IncludeOnlyPlanarCurves, 0))
                    if (c is Line l && (main == null || l.Length > main.Length)) main = l;
            }
            catch { }
            if (main == null) return false;
            double x0 = f.Local(main.GetEndPoint(0)).X, x1 = f.Local(main.GetEndPoint(1)).X;
            r0 = Math.Min(x0, x1); r1 = Math.Max(x0, x1);
            return true;
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
        /// <summary>Гишүүний захын хоёр төгсгөлийн нүүр (R, лавлагаа) — <see cref="BbElevStirrupDims"/>-д.</summary>
        internal static List<KeyValuePair<double, Reference>> EndFaceRefs(Element host, View view, BbFrame f)
        {
            return EndFaces(host, view, f).Where(p => p.Ref != null).Select(p => new KeyValuePair<double, Reference>(p.R, p.Ref)).ToList();
        }

        private static List<Pt> EndFaces(Element host, View view, BbFrame f)
        {
            var res = new List<Pt>();
            var faces = new List<Pt>();
            // Эхлээд харагдацын геометр; Coarse харагдацад дамнуруу шугам болж нүүргүй (ДН-11) — тэгвэл Fine геометрээс.
            foreach (Options opt in new[] { new Options { ComputeReferences = true, View = view }, new Options { ComputeReferences = true, DetailLevel = ViewDetailLevel.Fine } })
            {
                GeometryElement ge;
                try { ge = host.get_Geometry(opt); }
                catch { continue; }
                if (ge == null) continue;
                Walk(ge, Transform.Identity, (s, tr) =>
                {
                    foreach (Face fc in s.Faces)
                    {
                        if (!(fc is PlanarFace pf) || pf.Reference == null) continue;
                        if (Math.Abs(tr.OfVector(pf.FaceNormal).DotProduct(f.R)) < 0.99) continue;
                        faces.Add(new Pt { R = f.Local(tr.OfPoint(pf.Origin)).X, Ref = pf.Reference, Rank = 0 });
                    }
                });
                // Нэг л төгсгөлийн нүүр — Fine геометрээс нөгөөг нь нэмэх.
                if (faces.Count > 0 && faces.Max(x => x.R) - faces.Min(x => x.R) > RfTol.MmToFt(300)) break;
            }
            // Төгсгөл нь хавтгай нүүр биш (ДДН-3: «800h-600hx600» haunch family-ийн зүүн үзүүр) — харагдацын БОСОО ирмэг (инженер «…:5951:LINEAR»).
            if (faces.Count == 0 || faces.Max(x => x.R) - faces.Min(x => x.R) <= RfTol.MmToFt(300))
            {
                GeometryElement ge = null;
                try { ge = host.get_Geometry(new Options { ComputeReferences = true, View = view }); } catch { }
                if (ge != null)
                    Walk(ge, Transform.Identity, (s, tr) =>
                    {
                        foreach (Edge ed in s.Edges)
                        {
                            if (ed.Reference == null || !(ed.AsCurve() is Line l)) continue;
                            XYZ a = f.Local(tr.OfPoint(l.GetEndPoint(0))), b = f.Local(tr.OfPoint(l.GetEndPoint(1)));
                            if (Math.Abs(a.X - b.X) > RfTol.MmToFt(1) || Math.Abs(a.Y - b.Y) < RfTol.MmToFt(50)) continue;
                            faces.Add(new Pt { R = (a.X + b.X) / 2, Ref = ed.Reference, Rank = 0 });
                        }
                    });
            }
            if (faces.Count == 0) return res;
            res.Add(faces.OrderBy(x => x.R).First());
            res.Add(faces.OrderBy(x => x.R).Last());
            return res;
        }

        /// <summary>
        /// Solid бүрийг загварын хувиргалттай нь.  Таслагдаагүй family (ДН-11-ийн дамнуруу) GeometryInstance-аар ирдэг — instance геометрийн нүүрэнд
        /// хэмжээсийн лавлагаа байдаггүй тул SYMBOL геометр (лавлагаатай) + instance-ийн хувиргалт.
        /// </summary>
        internal static void Walk(GeometryElement ge, Transform tr, Action<Solid, Transform> onSolid)
        {
            foreach (GeometryObject go in ge)
            {
                if (go is Solid s && s.Faces.Size > 0) { onSolid(s, tr); continue; }
                if (go is GeometryInstance gi)
                {
                    GeometryElement sub = null;
                    try { sub = gi.GetSymbolGeometry(); } catch { }
                    if (sub != null) Walk(sub, tr.Multiply(gi.Transform), onSolid);
                }
            }
        }
    }
}
