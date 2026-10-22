using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using MglBb.Core;

namespace MglBb.RevitSide
{
    /// <summary>
    /// Дамнурууны огтлолын арматурын шошгыг ҮҮРГЭЭР (дээд / доод үеийн ажлын арматур, бөөрний арматур, хомут) — инженерийн огтлолоос «Стандарт сурах»
    /// сурна (<see cref="Learn"/>), тэмдэглэхэд хөдөлгүүрийн тавьсан шошгыг сурсан байрлал руу зөөнө (<see cref="Apply"/>).  Шошго бүрийн өндөр = ӨӨРИЙН
    /// арматурын өндөр (огтлолын хавтгай дээрх тэнхлэгийн огтлолцол) + сурсан зай.  Тухайн үүргийн тал сураагүй бол (хоосон) хөдөлгүүрийн байрлал
    /// хэвээр.  Гараар тавьсан шошгыг хөндөхгүй (зөвхөн энэ удаа үүссэн).
    /// </summary>
    internal static class BbSecTagLayout
    {
        private sealed class Head
        {
            public IndependentTag Tag;
            public bool Stirrup;
            public double BarU;
            public BbBarRole Role;
            public XYZ Local;
        }

        private const double Mm = 1 / 304.8;

        /// <summary>
        /// Арматурын өндөр (харагдацын u): ЭХЛЭЭД тэнхлэгийн шугамууд огтлолын хавтгайг огтлох цэгүүдийн дундаж (нугалсан / дэгээтэй ажлын арматурын
        /// bbox доош сунадаг — ЖИШЭЭ-2 «9 ⌀28» bbox-ийн төв дунд өндөрт буудаг байв), олдохгүй бол leader-ийн төгсгөл, эцэст нь bbox-ийн төв.
        /// </summary>
        private static bool BarOf(Document doc, IndependentTag t, BbFrame f, double planeZ, out bool stirrup, out double u)
        {
            stirrup = false; u = 0;
            Rebar rb = null;
            try { rb = t.GetTaggedLocalElementIds().Select(id => doc.GetElement(id)).OfType<Rebar>().FirstOrDefault(); } catch { }
            if (rb == null) return false;
            try { stirrup = (doc.GetElement(rb.GetShapeId()) as RebarShape)?.RebarStyle == RebarStyle.StirrupTie; } catch { }

            var us = new List<double>();
            if (!stirrup)
            {
                try
                {
                    int n = Math.Min(rb.NumberOfBarPositions, 60);
                    for (int i = 0; i < n; i++)
                    {
                        IList<Curve> cs;
                        try { cs = rb.GetTransformedCenterlineCurves(false, true, true, MultiplanarOption.IncludeOnlyPlanarCurves, i); }
                        catch { continue; }
                        foreach (Curve c in cs)
                        {
                            if (!(c is Line)) continue;
                            XYZ a = f.Local(c.GetEndPoint(0)), b = f.Local(c.GetEndPoint(1));
                            double da = a.Z - planeZ, db = b.Z - planeZ;
                            if (da * db > 0 || Math.Abs(da - db) < 1e-9) continue;
                            double s = da / (da - db);
                            us.Add(a.Y + (b.Y - a.Y) * s);
                        }
                    }
                }
                catch { }
            }
            if (us.Count == 0)
            {
                try
                {
                    if (t.HasLeader && t.LeaderEndCondition == LeaderEndCondition.Free)
                        foreach (Reference r in t.GetTaggedReferences()) us.Add(f.Local(t.GetLeaderEnd(r)).Y);
                }
                catch { }
            }
            if (us.Count == 0)
            {
                BoundingBoxXYZ bb = rb.get_BoundingBox(null);
                if (bb == null) return false;
                f.Extent(bb, out XYZ a, out XYZ b);
                us.Add((a.Y + b.Y) / 2);
            }
            u = us.Average();
            return true;
        }

        /// <summary>Харагдацын арматурын шошгууд эгнээгээр ангилсан (хамгийн дээд / доод ажлын арматурын эгнээ ± 40 мм).</summary>
        private static List<Head> Heads(Document doc, View view, BbFrame f, double u0, double u1, Func<IndependentTag, bool> keep)
        {
            var res = new List<Head>();
            double planeZ = view.CropBox.Max.Z;
            foreach (IndependentTag t in new FilteredElementCollector(doc).OfClass(typeof(IndependentTag))
                         .WherePasses(new ElementOwnerViewFilter(view.Id)).Cast<IndependentTag>())
            {
                if (!keep(t)) continue;
                if (!BarOf(doc, t, f, planeZ, out bool stirrup, out double u)) continue;
                XYZ head;
                try { head = f.Local(t.TagHeadPosition); } catch { continue; }
                res.Add(new Head { Tag = t, Stirrup = stirrup, BarU = u, Local = head });
            }
            List<double> bars = res.Where(h => !h.Stirrup).Select(h => h.BarU).ToList();
            double top = bars.Count > 0 ? bars.Max() : u1, bottom = bars.Count > 0 ? bars.Min() : u0;
            foreach (Head h in res) h.Role = BbTagRoles.Classify(h.Stirrup, h.BarU, top, bottom, u0, u1, 40 * Mm);
            return res;
        }

        /// <summary>«Стандарт сурах»: инженерийн огтлолын шошгоны байрлал үүргээр (<paramref name="k"/> = «beam.» г.м.).  MRA-ийн шошгыг алгасна.</summary>
        public static void Learn(Document doc, View view, BoundingBoxXYZ hostBox, string k, BbSamples s, ISet<long> mraTags)
        {
            if (hostBox == null) return;
            BbFrame f = BbFrame.Of(view);
            f.Extent(hostBox, out XYZ ha, out XYZ hb);
            double r0 = ha.X, r1 = hb.X;
            double sc = Math.Max(1, view.Scale);
            List<Head> heads = Heads(doc, view, f, ha.Y, hb.Y, t => !mraTags.Contains(t.Id.Value));
            foreach (Head h in heads)
            {
                BbTagRoles.Measure(h.Local.X, h.Local.Y, h.BarU, r0, r1, out string side, out double dx, out double dy);
                string key = k + "Sec" + BbTagRoles.Key(h.Role) + "Tag";
                s.Str(key + "Side", side);
                s.Num(key + "DxPaperMm", BbGeom.ToMm(dx) / sc);
                s.Num(key + "DyFromBarPaperMm", BbGeom.ToMm(dy) / sc);
                // Хугарал: ажлын арматур — тэнхлэгээс, хомут — leader-ийн төгсгөлөөс (хөл) шошгоны тал руу.
                string eref = BbTagRoles.ElbowRef(h.Role);
                try
                {
                    if (!h.Tag.HasLeader || h.Tag.LeaderEndCondition != LeaderEndCondition.Free) continue;
                    foreach (Reference rf in h.Tag.GetTaggedReferences())
                    {
                        if (!h.Tag.HasLeaderElbow(rf)) continue;
                        double er = f.Local(h.Tag.GetLeaderElbow(rf)).X;
                        double refR = eref == BbTagRoles.ElbowAxis ? (r0 + r1) / 2 : f.Local(h.Tag.GetLeaderEnd(rf)).X;
                        double d = BbGeom.ToMm(BbTagRoles.MeasureElbow(side, er, refR)) / sc;
                        if (d < -30 || d > 60) continue;
                        s.Str(key + "ElbowRef", eref);
                        s.Num(key + "ElbowPaperMm", d);
                    }
                }
                catch { }
            }
            foreach (var g in heads.GroupBy(h => h.Local.X > (r0 + r1) / 2))
            {
                double? gap = BbTagRoles.MinGap(g.Select(h => BbGeom.ToMm(h.Local.Y) / sc));
                if (gap != null && gap > 2 && gap < 30) s.Num(k + "SecRoleTagPitchPaperMm", gap.Value);
            }
        }

        /// <summary>
        /// Нээлттэй Transaction-гүй үед: <paramref name="before"/>-оос хойш энэ огтлолд үүссэн арматурын шошгыг сурсан байрлал руу зөөнө.  Зөөсөн тоо.
        /// </summary>
        public static int Apply(Document doc, ViewSection view, Element host, BbMemberStandard ms, ISet<long> before, BbAnnoReport rep, string mark)
        {
            if (view == null || host == null || ms == null) return 0;
            bool any = false;
            foreach (BbBarRole r in new[] { BbBarRole.Top, BbBarRole.Bottom, BbBarRole.Side, BbBarRole.Stirrup })
            {
                ms.RoleTag(r, out string sd, out double _, out double __);
                if (!string.IsNullOrEmpty(sd)) any = true;
            }
            if (!any) return 0;
            BoundingBoxXYZ hbx = host.get_BoundingBox(null);
            if (hbx == null) return 0;
            BbFrame f = BbFrame.Of(view);
            f.Extent(hbx, out XYZ ha, out XYZ hb);
            double r0 = ha.X, r1 = hb.X;
            double ft = Math.Max(1, view.Scale) * Mm;          // цаасан мм → загварын фут
            List<Head> heads = Heads(doc, view, f, ha.Y, hb.Y, t => !before.Contains(t.Id.Value));
            if (heads.Count == 0) return 0;

            // Зорилтот байрлал → тал бүрд давхцалгүй болгох.
            var plan = new List<KeyValuePair<Head, double[]>>();
            foreach (Head h in heads)
            {
                ms.RoleTag(h.Role, out string side, out double dx, out double dy);
                if (string.IsNullOrEmpty(side)) continue;
                BbTagRoles.Target(side, dx * ft, dy * ft, h.BarU, r0, r1, out double hr, out double hu);
                plan.Add(new KeyValuePair<Head, double[]>(h, new[] { hr, hu, side == BbTagRoles.Right ? 1 : 0 }));
            }
            foreach (var g in plan.GroupBy(p => p.Value[2]).Select(g => g.ToList()))
            {
                double[] sep = BbTagRoles.Separate(g.Select(p => p.Value[1]).ToList(), ms.SecRoleTagPitchPaperMm * ft);
                for (int i = 0; i < g.Count; i++) g[i].Value[1] = sep[i];
            }

            int moved = 0;
            double landing = ms.SecLeaderLandingPaperMm * ft;
            using (var tr = new Transaction(doc, "MGL ББ: огтлолын шошго " + (mark ?? "")))
            {
                tr.Start();
                FailureHandlingOptions fho = tr.GetFailureHandlingOptions();
                fho.SetFailuresPreprocessor(new BbSwallowWarnings());
                tr.SetFailureHandlingOptions(fho);
                foreach (var p in plan)
                {
                    Head h = p.Key;
                    double hr = p.Value[0], hu = p.Value[1];
                    string side = p.Value[2] > 0.5 ? BbTagRoles.Right : BbTagRoles.Left;
                    try
                    {
                        h.Tag.TagHeadPosition = f.World(hr, hu, h.Local.Z);
                        ms.RoleElbow(h.Role, out string eref, out double ed);
                        bool learned = !string.IsNullOrEmpty(eref);
                        if ((learned || landing > 0) && h.Tag.HasLeader && h.Tag.LeaderEndCondition == LeaderEndCondition.Free)
                            foreach (Reference rf in h.Tag.GetTaggedReferences())
                            {
                                double er;
                                if (!learned) { if (!h.Tag.HasLeaderElbow(rf)) continue; er = BbTagRoles.ElbowR(side, hr, landing); }
                                else
                                {
                                    // ЖИШЭЭ-2 засвар: ажлын арматур — шошгоноос ХЭВТЭЭ шугам тэнхлэг хүртэл, тэндээс ширхэг бүр рүү; хомут — хөлийн дэргэд.
                                    double refR = eref == BbTagRoles.ElbowAxis ? (r0 + r1) / 2 : f.Local(h.Tag.GetLeaderEnd(rf)).X;
                                    er = BbTagRoles.ElbowFrom(side, refR, ed * ft);
                                }
                                h.Tag.SetLeaderElbow(rf, f.World(er, hu, h.Local.Z));
                            }
                        moved++;
                    }
                    catch (Exception ex)
                    {
                        rep?.Notes.Add(view.Name + ": " + BbTagRoles.Name(h.Role) + "-ын шошгыг зөөж чадсангүй — " + (ex.Message ?? "").Split('\n')[0]);
                    }
                }
                tr.Commit();
            }
            if (rep != null) rep.RoleTags += moved;
            return moved;
        }
    }
}
