using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using RevitMcpAddin.Reinforcement;

namespace MglBb.RevitSide
{
    /// <summary>
    /// ЖИШЭЭ-1-ийн огтлолын гинж: «нүүр | хомут | ажлын арматур бүрийн ТӨВ | хомут | нүүр» (жишээ нь 40 | 112 | 98.6 | 98.6 | 98.6 | 112 | 40).
    /// Үндсэн хөдөлгүүр «нүүр | хомут | хомут | нүүр» гинжийг тавьсны ДАРАА тэр гинжийн тал дахь ажлын арматурын төвүүдийг (булангийнхыг эс тооцвол —
    /// булангийн арматур хомутын ирмэгтэй 10-20 мм-ийн зайтай тул инженер оруулдаггүй) гинжинд нэмж ДАХИН үүсгэнэ.  Хуучин гинж устгагдаж, огтлолын
    /// бүртгэл (RfSectionStore) шинэ хэмжээсээр шинэчлэгдэнэ — дахин ажиллуулахад давхардахгүй.  Лавлагаа олдохгүй/утга таарахгүй бол хуучин гинж ХЭВЭЭР.
    /// </summary>
    internal static class BbBarChain
    {
        private sealed class BarPt
        {
            public Rebar Rebar;
            public int Index;
            public double R, U;       // харагдацын хүрээнд (фут)
            public double Dia;        // фут
        }

        public static int Extend(Document doc, ViewSection view, Element host, IList<Element> hosts, RfSectionContext ctx, BbAnnoReport rep, string mark)
        {
            RfSectionStoreData data = RfSectionStore.Read(view);
            RfSectionSaved set = data.Sets.FirstOrDefault(s => s.Host == host.UniqueId);
            if (set == null) return 0;
            BbFrame f = BbFrame.Of(view);
            List<BarPt> bars = MergedBars(doc, view, host, hosts, f);
            if (bars.Count == 0) return 0;
            int made = 0;
            foreach (string uid in set.Ids.ToList())
            {
                if (!(doc.GetElement(uid) is Dimension d) || d.OwnerViewId != view.Id) continue;
                bool hasRebar = false;
                foreach (Reference r in d.References) if (doc.GetElement(r.ElementId) is Rebar) { hasRebar = true; break; }
                if (!hasRebar) continue;      // гишүүний (тэнхлэг/хучилт) гинж — хөндөхгүй
                // Эхлээд загалмайн бүх шугамаар (бага зэрэг эргэсэн ч Revit ихэвчлэн зөв утга өгдөг — утгыг шалгана); таарахгүй бол зөвхөн
                // ЯГ тэгш лавлагаагаар (дутуу бол хомутын гинж хэвээр).
                int notes0 = rep.Notes.Count;
                Dimension nd = Rebuild(doc, view, f, d, bars, rep, mark, strict: false);
                if (nd == null)
                {
                    rep.Notes.RemoveRange(notes0, rep.Notes.Count - notes0);
                    nd = Rebuild(doc, view, f, d, bars, rep, mark, strict: true);
                }
                if (nd == null) continue;
                set.Ids.Remove(uid);
                set.Ids.Add(nd.UniqueId);
                made++;
            }
            if (made > 0) RfSectionStore.Write(doc, view, data);
            return made;
        }

        /// <summary>Gate-ийн оношилгоо: огтлол дахь ширхгүүд ба тэдгээрийн «загалмай» лавлагааны байрлал.</summary>
        internal static string Diagnose(Document doc, ViewSection view, IList<Element> hosts)
        {
            var sb = new System.Text.StringBuilder();
            BbFrame f = BbFrame.Of(view);
            var bars = new List<BarPt>();
            foreach (Element h in hosts) bars.AddRange(Bars(doc, view, h, f));
            sb.AppendLine("bars " + bars.Count);
            var cache = new Dictionary<long, List<CrossLine>>();
            foreach (BarPt b in bars.OrderBy(x => x.U).ThenBy(x => x.R))
            {
                Reference rh = BarReference(doc, view, b, f, true, cache), rv = BarReference(doc, view, b, f, false, cache);
                List<CrossLine> lines = cache.TryGetValue(b.Rebar.Id.Value, out var l) ? l : new List<CrossLine>();
                string near = lines.Count == 0 ? "no-lines" : string.Join(" ", lines.OrderBy(x => Math.Abs(x.Mid.X - b.R) + Math.Abs(x.Mid.Y - b.U)).Take(2).Select(x => "(" + BbGeom.ToMm(x.Mid.X).ToString("0") + "," + BbGeom.ToMm(x.Mid.Y).ToString("0") + " d " + x.Dir.X.ToString("0.0") + "," + x.Dir.Y.ToString("0.0") + ")"));
                sb.AppendLine("  " + b.Rebar.Id.Value + "[" + b.Index + "] host " + b.Rebar.GetHostId().Value + " R " + BbGeom.ToMm(b.R).ToString("0") + " U " + BbGeom.ToMm(b.U).ToString("0") + " h=" + (rh != null) + " v=" + (rv != null) + " lines " + lines.Count + " near " + near);
                if (lines.Count == 0)
                {
                    var hist = new Dictionary<string, int>();
                    try
                    {
                        GeometryElement ge = b.Rebar.get_Geometry(new Options { ComputeReferences = true, View = view, IncludeNonVisibleObjects = true });
                        foreach (GeometryObject go in ge)
                        {
                            string k = go.GetType().Name;
                            if (go is Line ln && ln.Reference != null)
                            {
                                string st = ln.Reference.ConvertToStableRepresentation(doc);
                                string[] parts = st.Split(':');
                                k += ":" + (parts.Length >= 3 ? parts[parts.Length - 2] : "?") + (ln.IsBound ? " z" + BbGeom.ToMm(f.Local((ln.GetEndPoint(0) + ln.GetEndPoint(1)) / 2).Z).ToString("0") : "");
                            }
                            hist[k] = hist.TryGetValue(k, out int n) ? n + 1 : 1;
                        }
                    }
                    catch (Exception ex) { hist["ERR " + ex.Message] = 1; }
                    sb.AppendLine("     geom " + string.Join(", ", hist.OrderByDescending(x => x.Value).Take(12).Select(x => x.Key + "×" + x.Value)));
                }
            }
            return sb.ToString();
        }

        /// <summary>
        /// Огтлолын эзэн гишүүний ширхгүүд + бусад гишүүний ЗӨВХӨН давхардаагүй ширхгүүд.  Баганын огтлолд (Б-5 S4, S7) доод давхрын давхцлын
        /// арматур хавтгайг дайрдаг — эзний ширхэгтэй зэрэгцэн (1 голчийн зайд) байрлаж, нэг «загалмай» лавлагааг хоёр удаа авснаар Revit гинжийн бүх
        /// хэсгийг −304.8 гэж буцаадаг байв (хэмжсэн).  Дамнурууны гинжинд (ДН-9) бусад гишүүний ширхэг эзнийхтэй давхцдаггүй тул хэвээр нэмэгдэнэ.
        /// </summary>
        private static List<BarPt> MergedBars(Document doc, View view, Element host, IList<Element> hosts, BbFrame f)
        {
            List<BarPt> res = Bars(doc, view, host, f);
            foreach (Element h in hosts)
            {
                if (h.Id == host.Id) continue;
                foreach (BarPt b in Bars(doc, view, h, f))
                {
                    double tol = Math.Max(BbGeom.Ft(30), 1.5 * Math.Max(b.Dia, res.Count > 0 ? res.Max(x => x.Dia) : 0));
                    if (res.Any(x => Math.Abs(x.R - b.R) < tol && Math.Abs(x.U - b.U) < tol)) continue;
                    res.Add(b);
                }
            }
            return res;
        }

        /// <summary>Огтлолын хавтгайг дайрсан ажлын арматурын ширхгүүд (харагдацад нуугдаагүй).</summary>
        private static List<BarPt> Bars(Document doc, View view, Element host, BbFrame f)
        {
            var res = new List<BarPt>();
            RebarHostData hd;
            try { hd = RebarHostData.GetRebarHostData(host); } catch { return res; }
            if (hd == null) return res;
            foreach (Rebar r in hd.GetRebarsInHost().OfType<Rebar>())
            {
                RebarShape sh = doc.GetElement(r.GetShapeId()) as RebarShape;
                if (sh == null || sh.RebarStyle != RebarStyle.Standard) continue;
                double dia = 0;
                try { dia = (doc.GetElement(r.GetTypeId()) as RebarBarType)?.BarModelDiameter ?? 0; } catch { }
                // Ширхэг бүрийн БАЙРЛАЛ дахь голын шугам (shape-driven ба free-form хоёуланд — GetBarPositionTransform нь free-form-д ажилладаггүй,
                // ЖИШЭЭ-1 ДН-9-ийн ⌀25 бүгд нэг цэгт буудаг байв).
                foreach (int i in RfSectionAnalyzer.ExistingBars(r))
                {
                    try { if (r.IsBarHidden(view, i)) continue; } catch { }
                    IList<Curve> cs;
                    try { cs = r.GetTransformedCenterlineCurves(false, true, true, MultiplanarOption.IncludeOnlyPlanarCurves, i); } catch { continue; }
                    if (cs == null) continue;
                    foreach (Curve c in cs)
                    {
                        XYZ a = f.Local(c.GetEndPoint(0)), b = f.Local(c.GetEndPoint(1));
                        // Хавтгайг (z = 0) огтолсон, хавтгайд перпендикуляр сегмент.
                        if ((a.Z > 0) == (b.Z > 0)) continue;
                        double dz = b.Z - a.Z;
                        if (Math.Abs(dz) < 1e-9) continue;
                        double k = -a.Z / dz;
                        XYZ p = a + (b - a) * k;
                        XYZ dir = (b - a).Normalize();
                        if (Math.Abs(dir.Z) < 0.95) continue;
                        res.Add(new BarPt { Rebar = r, Index = i, R = p.X, U = p.Y, Dia = dia });
                        break;
                    }
                }
            }
            return res;
        }

        private static Dimension Rebuild(Document doc, ViewSection view, BbFrame f, Dimension d, List<BarPt> bars, BbAnnoReport rep, string mark, bool strict)
        {
            Line line = d.Curve as Line;
            if (line == null) return null;
            XYZ dir = line.Direction.Normalize();
            bool horiz = Math.Abs(dir.DotProduct(f.R)) > 0.99, vert = Math.Abs(dir.DotProduct(f.U)) > 0.99;
            if (!horiz && !vert) return null;
            // Одоо байгаа лавлагааны байрлал (шугамын дагуу t) — сегментийн утгаар.
            var refs = new List<Reference>();
            foreach (Reference r in d.References) refs.Add(r);
            var ts = new List<double>();
            if (d.Segments != null && d.Segments.Size > 0)
            {
                DimensionSegment s0 = d.Segments.get_Item(0);
                double t0 = s0.Origin.DotProduct(dir) - (s0.Value ?? 0) / 2;
                ts.Add(t0);
                double acc = t0;
                foreach (DimensionSegment s in d.Segments) { acc += s.Value ?? 0; ts.Add(acc); }
            }
            else
            {
                double v = d.Value ?? 0, o = d.Origin.DotProduct(dir);
                ts.Add(o - v / 2); ts.Add(o + v / 2);
            }
            if (ts.Count != refs.Count) return null;
            double lineCross = horiz ? f.Local(line.Origin).Y : f.Local(line.Origin).X;

            // Гинжийн талын эгнээ: хэвтээ гинж доор бол ДООД эгнээ, дээр бол дээд; босоо гинж баруун бол БАРУУН багана, зүүн бол зүүн.
            double maxDia = bars.Max(b => b.Dia);
            List<BarPt> row;
            if (horiz)
            {
                double mid = bars.Average(b => b.U);
                bool low = lineCross < mid;
                double edge = low ? bars.Min(b => b.U) : bars.Max(b => b.U);
                row = bars.Where(b => Math.Abs(b.U - edge) < Math.Max(maxDia, 0.03)).OrderBy(b => b.R).ToList();
            }
            else
            {
                double mid = bars.Average(b => b.R);
                bool left = lineCross < mid;
                double edge = left ? bars.Min(b => b.R) : bars.Max(b => b.R);
                row = bars.Where(b => Math.Abs(b.R - edge) < Math.Max(maxDia, 0.03)).OrderBy(b => b.U).ToList();
            }
            // Булангийн (захын) хоёрыг хасна — хомутын ирмэгтэй хэт ойр (инженерийн зураг: дотор ширхгүүд л).
            if (row.Count <= 2) return null;
            row = row.Skip(1).Take(row.Count - 2).ToList();

            var items = new List<KeyValuePair<double, Reference>>();
            for (int i = 0; i < refs.Count; i++) items.Add(new KeyValuePair<double, Reference>(ts[i], refs[i]));
            double tMin = ts.Min(), tMax = ts.Max();
            int added = 0, missing = 0;
            var refCache = new Dictionary<long, List<CrossLine>>();
            foreach (BarPt b in row)
            {
                XYZ world = f.World(b.R, b.U, 0);
                double t = world.DotProduct(dir);
                if (t <= tMin + 1e-3 || t >= tMax - 1e-3) continue;
                Reference br = BarReference(doc, view, b, f, horiz, refCache, strict);
                if (br == null) { missing++; continue; }
                items.Add(new KeyValuePair<double, Reference>(t, br));
                added++;
            }
            if (missing > 0 && strict)
            {
                // Дутуу гинж («260» нь «130 | 130»-ийн оронд) инженерийг төөрөгдүүлнэ — хомутын гинж хэвээр.
                rep.Notes.Add(mark + " «" + view.Name + "»: " + missing + " ширхгийн (налуу/хазайлгасан) төвийн лавлагаа олдсонгүй — хомутын гинж хэвээр.");
                return null;
            }
            if (added == 0)
            {
                rep.Notes.Add(mark + " «" + view.Name + "»: ажлын арматурын лавлагаа олдсонгүй — хомутын гинж хэвээр.");
                return null;
            }
            items = items.OrderBy(x => x.Key).ToList();
            var ra = new ReferenceArray();
            foreach (var it in items) ra.Append(it.Value);
            using (var st = new SubTransaction(doc))
            {
                st.Start();
                try
                {
                    Dimension nd = doc.Create.NewDimension(view, line, ra, d.DimensionType);
                    if (nd == null) { st.RollBack(); return null; }
                    doc.Regenerate();
                    // Шалгалт: сегментийн тоо, нийт урт хуучинтай ижил, сегмент бүр хүлээсэн утгатай (0.5 мм).
                    if (nd.Segments == null || nd.Segments.Size != items.Count - 1) { st.RollBack(); return null; }
                    double sum = 0;
                    int k = 0;
                    foreach (DimensionSegment s in nd.Segments)
                    {
                        double want = items[k + 1].Key - items[k].Key;
                        double got = s.Value ?? 0;
                        if (Math.Abs(got - want) > BbGeom.Ft(0.6))
                        {
                            string gotAll = string.Join("|", nd.Segments.Cast<DimensionSegment>().Select(x => BbGeom.ToMm(x.Value ?? 0).ToString("0.#")));
                            string wantAll = string.Join("|", Enumerable.Range(0, items.Count - 1).Select(i => BbGeom.ToMm(items[i + 1].Key - items[i].Key).ToString("0.#")));
                            st.RollBack();
                            rep.Notes.Add(mark + " «" + view.Name + "»: арматурын гинжийн утга таарсангүй (хүлээсэн " + wantAll + ", гарсан " + gotAll + ") — хомутын гинж хэвээр.");
                            return null;
                        }
                        sum += got;
                        k++;
                    }
                    if (Math.Abs(sum - (tMax - tMin)) > BbGeom.Ft(1)) { st.RollBack(); return null; }
                    doc.Delete(d.Id);
                    st.Commit();
                    rep.BarChains++;
                    rep.BarChainRefs += added;
                    return nd;
                }
                catch (Exception ex)
                {
                    if (st.HasStarted() && !st.HasEnded()) st.RollBack();
                    rep.Notes.Add(mark + " «" + view.Name + "»: арматурын гинж — " + ex.Message.Split('\n')[0]);
                    return null;
                }
            }
        }

        /// <summary>
        /// Огтлолд зүсэгдсэн ширхгийн ТӨВИЙН лавлагаа.  ЖИШЭЭ-1-ийн инженерийн гинжинд хэмжсэн: харагдацын геометрт (View + IncludeNonVisibleObjects)
        /// ширхэг бүр «загалмай» далд шугамтай — «…:1106000» = төвийг дайрсан БОСОО шугам (хэвтээ гинжид), «…:1103000» = ХЭВТЭЭ шугам (босоо гинжид).
        /// ⚠️ Дэд элементийн дугаар (2000001 г.м.) нь ширхгийн индекстэй ТЭНЦҮҮ БИШ (хэмжсэн: 2000001 = индекс 5) — тиймээс байрлалаар нь тулгана.
        /// </summary>
        private sealed class CrossLine
        {
            public Reference Ref;
            public XYZ Mid, Dir;     // харагдацын хүрээнд
        }

        /// <param name="horiz">Хэмжээсийн шугам хэвтээ (R-ийн дагуу) — лавлагаа нь харагдацад БОСОО шугам; эс бөгөөс ХЭВТЭЭ шугам.</param>
        private static Reference BarReference(Document doc, View view, BarPt b, BbFrame f, bool horiz, Dictionary<long, List<CrossLine>> cache, bool strict = false)
        {
            long key = b.Rebar.Id.Value;
            if (!cache.TryGetValue(key, out List<CrossLine> lines))
            {
                lines = new List<CrossLine>();
                try
                {
                    GeometryElement ge = b.Rebar.get_Geometry(new Options { ComputeReferences = true, View = view, IncludeNonVisibleObjects = true });
                    Collect(doc, ge, f, lines);
                }
                catch { }
                cache[key] = lines;
            }
            double tol = BbGeom.Ft(3);
            // Кодоор биш ЧИГЛЭЛЭЭР сонгоно: дамнурууны огтлолд «1106» босоо, баганын (дээрээс харсан) огтлолд эсрэгээрээ байж болно.
            foreach (CrossLine l in lines)
            {
                if (Math.Abs(l.Mid.X - b.R) > tol || Math.Abs(l.Mid.Y - b.U) > tol) continue;
                // ЯГ тэнхлэгийн дагуу (≤ 2.5°).  Баганын огтлолд доод давхрын налуу (хазайлгасан) ширхгийн загалмай 18–45° эргэсэн байдаг —
                // түүгээр хэмжээс тавибал Revit бүх хэсгийг −304.8 гэж буцаадаг (Б-5 S4/S7, хэмжсэн).
                double need = strict ? 0.999 : 0.9;
                if (horiz ? Math.Abs(l.Dir.Y) > need : Math.Abs(l.Dir.X) > need) return l.Ref;
            }
            return null;
        }

        private static void Collect(Document doc, GeometryElement ge, BbFrame f, List<CrossLine> into)
        {
            if (ge == null) return;
            foreach (GeometryObject go in ge)
            {
                if (go is GeometryInstance gi) { Collect(doc, gi.GetInstanceGeometry(), f, into); continue; }
                if (!(go is Line l) || !l.IsBound || l.Reference == null) continue;
                string st;
                try { st = l.Reference.ConvertToStableRepresentation(doc); } catch { continue; }
                if (!IsCrossCode(st, "1106") && !IsCrossCode(st, "1103")) continue;
                XYZ a = f.Local(l.GetEndPoint(0)), b = f.Local(l.GetEndPoint(1));
                XYZ d = b - a;
                if (d.GetLength() < 1e-9) continue;
                into.Add(new CrossLine { Ref = l.Reference, Mid = (a + b) / 2, Dir = d.Normalize() });
            }
        }

        /// <summary>Тогтвортой лавлагааны код хэсэг «1106ddd» (геометрт «…:1106001:LINEAR», хэмжээсэд «…:1106000»).</summary>
        private static bool IsCrossCode(string st, string prefix)
        {
            foreach (string part in st.Split(':'))
            {
                if (part.Length != 7 || !part.StartsWith(prefix, StringComparison.Ordinal)) continue;
                bool digits = true;
                foreach (char ch in part) if (ch < '0' || ch > '9') { digits = false; break; }
                if (digits) return true;
            }
            return false;
        }
    }
}
