using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using MglBb.Core;
using MglBb.RevitSide;

namespace MglBb.Gate
{
    /// <summary>
    /// Gate «rebargen»: <c>mark=ДН-8|ДН-9</c> эсвэл <c>mark=all;limit=40</c>, <c>replace=1</c> (гараар тавьсныг ч солих), <c>code=1</c> (нормын
    /// preset, эс бол компанийн), <c>dump=1</c> (үүсгэсэн арматурын тэнхлэгийн шугам — гинжийн координатаар: s, y = Far-аас, z = доод нүүрнээс).
    /// </summary>
    internal static class GateRebar
    {
        static string F(double v) { return Math.Round(v, 1).ToString(CultureInfo.InvariantCulture); }

        static BbBeamRebarGen.FramingIndex _posts;
        static BbColumnStyle _colStyle;
        static string _colStyleDoc;

        static BbColumnStyle ColStyle(Document doc, Dictionary<string, string> kv, StringBuilder sb)
        {
            kv.TryGetValue("learn", out string lr);
            if (lr == "0") return null;
            string key = doc.Title + "|" + doc.PathName;
            if (_colStyle == null || _colStyleDoc != key || lr == "1")
            {
                var t0 = DateTime.Now;
                BbColumnStyle s = BbRebarLearn.FromColumns(doc, BbColumnRebarGen.Collect(doc, BbColumnRebarGen.AllColumns(doc)));
                if (_colStyleDoc != key || _colStyle == null || s.Columns >= _colStyle.Columns) { _colStyle = s; _colStyleDoc = key; }
                sb.AppendLine("colstyle learned in " + (DateTime.Now - t0).TotalMilliseconds.ToString("0") + " ms");
            }
            sb.AppendLine("COLSTYLE " + _colStyle.Describe());
            return _colStyle;
        }
        static BbRebarStyle _style;
        static string _styleDoc;

        /// <summary>Бүх загварын гар арматураас хэв маяг (gate дуудлага хооронд кэштэй; «learn=1» дахин сурна, «learn=0» ашиглахгүй).</summary>
        static BbRebarStyle Style(Document doc, Dictionary<string, string> kv, StringBuilder sb)
        {
            kv.TryGetValue("learn", out string lr);
            if (lr == "0") return null;
            string key = doc.Title + "|" + doc.PathName;
            if (_style == null || _styleDoc != key || lr == "1")
            {
                var t0 = DateTime.Now;
                BbRebarStyle s = BbRebarLearn.FromModel(doc, BbBeamRebarGen.Collect(doc, BbBeamRebarGen.AllBeams(doc)));
                if (_styleDoc != key || _style == null || s.Chains >= _style.Chains) { _style = s; _styleDoc = key; }
                sb.AppendLine("style learned in " + (DateTime.Now - t0).TotalMilliseconds.ToString("0") + " ms");
            }
            sb.AppendLine("STYLE " + _style.Describe());
            return _style;
        }

        public static string Run(Document doc, Dictionary<string, string> kv)
        {
            var sb = new StringBuilder();
            string marks = kv.TryGetValue("mark", out string m) ? m : "all";
            int limit = kv.TryGetValue("limit", out string l) ? int.Parse(l) : 1000;
            bool replace = kv.TryGetValue("replace", out string rp) && rp == "1";
            bool code = kv.TryGetValue("code", out string cd) && cd == "1";
            bool dump = kv.TryGetValue("dump", out string dp) && dp == "1";
            BbRebarBuilder.OpenLoop = !(kv.TryGetValue("loop", out string lp) && lp == "closed");

            IEnumerable<FamilyInstance> beams = BbBeamRebarGen.AllBeams(doc);
            if (marks != "all")
            {
                var set = new HashSet<string>(marks.Split('|'), StringComparer.Ordinal);
                beams = beams.Where(b => set.Contains(BbGeom.Mark(b)));
            }
            var t0 = DateTime.Now;
            List<BbBeamGenItem> items = BbBeamRebarGen.Collect(doc, beams).Take(limit).ToList();
            sb.AppendLine("chains " + items.Count + " collect " + (DateTime.Now - t0).TotalMilliseconds.ToString("0") + " ms");
            int created = 0, failed = 0, skipped = 0;
            BbRebarStyle style = Style(doc, kv, sb);
            foreach (BbBeamGenItem it in items)
            {
                sb.AppendLine("CHAIN " + it.Key + " " + it.Size + " part=" + it.Part + "/" + it.Parts + " join=" + (it.Input.JoinStart ? "S" : "") + (it.Input.JoinEnd ? "E" : "") + " cover=" + it.CoverTop + "/" + it.CoverBottom + "/" + it.CoverSide + " L=" + F(it.Input.Length) + " members=" + it.Chain.Members.Count + " own=" + it.Own + " foreign=" + it.Foreign
                    + " sup=" + string.Join(" ", it.Input.Supports.Select(s => F(s.Lo) + ".." + F(s.Hi)))
                    + " lp=" + string.Join(" ", it.Input.LoadPoints.Select(s => F(s.Lo) + ".." + F(s.Hi) + "/" + F(s.SoffitDepth))));
                if (kv.ContainsKey("posts"))
                {
                    // Тулгуур болсон багана / хана (FramingIndex.Supports-ийн адил шүүлтүүр): ангилал, нэр, станц, z.
                    var fr = new BbFrame { O = it.Chain.Origin, R = it.Chain.Axis, U = XYZ.BasisZ, V = it.Chain.Axis.CrossProduct(XYZ.BasisZ).Normalize() };
                    _posts = _posts ?? new BbBeamRebarGen.FramingIndex(doc);
                    foreach (var pk in _posts.Posts)
                    {
                        BoundingBoxXYZ b = pk.Value;
                        fr.Extent(b, out XYZ mn, out XYZ mx);
                        if (mx.X < it.Chain.S0 - BbGeom.Ft(200) || mn.X > it.Chain.S1 + BbGeom.Ft(200) || mx.Z < it.Chain.Far - BbGeom.Ft(60) || mn.Z > it.Chain.Near + BbGeom.Ft(60)) continue;
                        if (b.Max.Z < it.Chain.Bottom - BbGeom.Ft(1500) || b.Min.Z > it.Chain.Top - BbGeom.Ft(10)) continue;
                        sb.AppendLine("  POST " + pk.Key.Id + " " + pk.Key.Category?.Name + " «" + pk.Key.Name + "» s=" + F(BbGeom.ToMm(mn.X - it.S0)) + ".." + F(BbGeom.ToMm(mx.X - it.S0))
                            + " ztop-beamBottom=" + F(BbGeom.ToMm(b.Max.Z - it.Chain.Bottom)) + " zbot-beamBottom=" + F(BbGeom.ToMm(b.Min.Z - it.Chain.Bottom))
                            + " struct=" + pk.Key.get_Parameter(BuiltInParameter.WALL_STRUCTURAL_SIGNIFICANT)?.AsInteger());
                    }
                }
                if (kv.ContainsKey("members"))
                {
                    var fr = new BbFrame { O = it.Chain.Origin, R = it.Chain.Axis, U = XYZ.BasisZ, V = it.Chain.Axis.CrossProduct(XYZ.BasisZ).Normalize() };
                    foreach (FamilyInstance mm in it.Chain.Members)
                    {
                        BoundingBoxXYZ bb = mm.get_BoundingBox(null);
                        if (bb == null) continue;
                        fr.Extent(bb, out XYZ mn, out XYZ mx);
                        sb.AppendLine("  member " + mm.Id.Value + " " + mm.Name + " s=" + F(BbGeom.ToMm(mn.X - it.S0)) + ".." + F(BbGeom.ToMm(mx.X - it.S0))
                            + " v=" + F(BbGeom.ToMm(mn.Z - it.Chain.Far)) + ".." + F(BbGeom.ToMm(mx.Z - it.Chain.Far))
                            + " z=" + F(BbGeom.ToMm(bb.Min.Z - it.Chain.Bottom)) + ".." + F(BbGeom.ToMm(bb.Max.Z - it.Chain.Bottom)));
                    }
                }
                if (it.Skip != null) { sb.AppendLine("  skip " + it.Skip); skipped++; continue; }
                if (it.Foreign > 0 && !replace) { sb.AppendLine("  skip: гараар тавьсан арматуртай"); skipped++; continue; }
                if (kv.ContainsKey("dry")) continue;
                // Цонхны дэвтэртэй адил: систем, элементийн cover, хомутын хэлбэр, хажуугийн, унтраасан алгасал («off=0,2»).
                var book = new BbRebarBook { Company = !code, ReplaceForeign = replace, UseHostCover = !(kv.TryGetValue("hostcover", out string hc) && hc == "0"), Style = style };
                BbRebarRow row = book.Row(it.Key);
                if (kv.TryGetValue("layout", out string lay)) row.Layout = lay;
                if (kv.TryGetValue("side", out string sd)) row.Side = sd;
                if (kv.TryGetValue("top", out string tp)) row.Top = tp;
                if (kv.TryGetValue("bottom", out string bt)) row.Bottom = bt;
                if (kv.TryGetValue("off", out string off))
                    foreach (string s in off.Split(',')) if (int.TryParse(s, out int si)) row.Span(si).Off = true;
                var errors = new List<string>();
                BbBeamRebarGen.Outcome o;
                using (var t = new Transaction(doc, "rebargen " + it.Key))
                {
                    FailureHandlingOptions fh = t.GetFailureHandlingOptions();
                    fh.SetFailuresPreprocessor(new BbSwallowWarnings());
                    t.SetFailureHandlingOptions(fh);
                    t.Start();
                    var sw = System.Diagnostics.Stopwatch.StartNew();
                    BbRebarBuilder.CreateSw.Reset(); BbRebarBuilder.RegenSw.Reset(); BbRebarBuilder.LayoutSw.Reset(); BbRebarBuilder.MarkSw.Reset(); BbRebarBuilder.Tries = 0;
                    o = BbBeamRebarGen.Generate(doc, it, book, errors);
                    long gen = sw.ElapsedMilliseconds;
                    foreach (string e in errors) o.Notes.Add("book: " + e);
                    TransactionStatus st = t.Commit();
                    if (st != TransactionStatus.Committed) sb.AppendLine("  commit " + st);
                    if (kv.ContainsKey("time"))
                        sb.AppendLine("  time gen " + gen + " ms (create " + BbRebarBuilder.CreateSw.ElapsedMilliseconds + " / tries " + BbRebarBuilder.Tries
                            + ", regen " + BbRebarBuilder.RegenSw.ElapsedMilliseconds + ", layout " + BbRebarBuilder.LayoutSw.ElapsedMilliseconds + ", mark " + BbRebarBuilder.MarkSw.ElapsedMilliseconds + ") commit " + (sw.ElapsedMilliseconds - gen) + " ms");
                }
                created += o.Created; failed += o.Failed;
                sb.AppendLine("  created " + o.Created + " deleted " + o.Deleted + " failed " + o.Failed + " spans " + o.Plan.Spans.Count);
                foreach (string n in o.Notes.Distinct().Take(12)) sb.AppendLine("  note " + n);
                if (dump) Dump(doc, it, sb);
            }
            sb.AppendLine("TOTAL created " + created + " failed " + failed + " skipped " + skipped + " in " + (DateTime.Now - t0).TotalSeconds.ToString("0.0") + " s");
            return sb.ToString();
        }

        /// <summary>
        /// Gate «rebarcompare»: гараар арматурласан (жишээ) гинж бүрд инженерийн арматурыг манай төлөвлөгөөтэй (үүсгэхгүйгээр) тулгана — алгасал бүрийн
        /// хомутын тоо / их алхам, тулгуур ба голын огтлолын дээд / доод ширхэг, ажлын арматурын нийт урт.  <c>mark=all;limit=N</c>.
        /// </summary>
        public static string Compare(Document doc, Dictionary<string, string> kv)
        {
            var sb = new StringBuilder();
            string marks = kv.TryGetValue("mark", out string m) ? m : "all";
            int limit = kv.TryGetValue("limit", out string l) ? int.Parse(l) : 1000;
            BbBeamRebarGen.SolidOverride = !(kv.TryGetValue("solid", out string so) && so == "0");
            IEnumerable<FamilyInstance> beams = BbBeamRebarGen.AllBeams(doc);
            if (marks != "all")
            {
                var set = new HashSet<string>(marks.Split('|'), StringComparer.Ordinal);
                beams = beams.Where(b => set.Contains(BbGeom.Mark(b)));
            }
            List<BbBeamGenItem> items = BbBeamRebarGen.Collect(doc, beams).Where(x => x.Foreign > 0 && x.Skip == null).Take(limit).ToList();
            var book = new BbRebarBook { Company = !(kv.TryGetValue("code", out string cd) && cd == "1") };
            book.Style = Style(doc, kv, sb);
            var stirCnt = new List<double>(); var stirMax = new List<double>(); var stirPos = new List<double>(); var lenRatio = new List<double>(); var secDiff = new List<double>();
            sb.AppendLine("chains with example rebar: " + items.Count);
            foreach (BbBeamGenItem it in items)
            {
                BbBeamChain ch = it.Chain;
                var fr = new BbFrame { O = ch.Origin, R = ch.Axis, U = XYZ.BasisZ, V = ch.Axis.CrossProduct(XYZ.BasisZ).Normalize() };
                Func<XYZ, double> st = q => BbGeom.ToMm(fr.Local(q).X - it.S0);
                Func<XYZ, double> zz = q => BbGeom.ToMm(q.Z - it.Bottom);
                // Жишээ: хомутын байрлал (станц), ажлын арматурын хэрчмүүд (s0, s1, z).
                var stir = new List<double>();
                var bars = new List<double[]>();
                foreach (FamilyInstance mm in it.Members)
                    foreach (Rebar r in BbBeamRebarGen.RebarsOf(doc, mm).Where(x => !BbBeamRebarGen.IsOwn(x)))
                    {
                        var shape = doc.GetElement(r.GetShapeId()) as RebarShape;
                        int n = 1;
                        try { n = r.NumberOfBarPositions; } catch { }
                        bool stirrup = shape != null && shape.RebarStyle == RebarStyle.StirrupTie;
                        for (int i = 0; i < n; i++)
                        {
                            IList<Curve> cs;
                            try { cs = r.GetTransformedCenterlineCurves(false, true, true, MultiplanarOption.IncludeOnlyPlanarCurves, i); } catch { continue; }
                            if (cs.Count == 0) continue;
                            if (stirrup)
                            {
                                // Хөндлөн хавтгайд: төв нь станц; огтлолын C-хомутыг (хэвтээ) хасахгүй — хавтгайгаар нь.
                                XYZ c0 = cs[0].GetEndPoint(0);
                                if (cs.Count >= 3) stir.Add(st(c0));
                                continue;
                            }
                            foreach (Curve c in cs)
                            {
                                XYZ a = c.GetEndPoint(0), b = c.GetEndPoint(1);
                                if (Math.Abs(a.Z - b.Z) > BbGeom.Ft(5)) continue;   // хэвтээ хэрчим л
                                double s0 = st(a), s1 = st(b);
                                if (Math.Abs(s1 - s0) < 300) continue;
                                bars.Add(new[] { Math.Min(s0, s1), Math.Max(s0, s1), zz(a) });
                            }
                        }
                    }
                // Хос хомут (давхардсан хоёр битүү / C) нэг байрлалд ≈ d зайтай — 30 мм дотрыг нэг гэж тооцно.
                stir = stir.OrderBy(x => x).Aggregate(new List<double>(), (acc, x) => { if (acc.Count == 0 || x - acc[acc.Count - 1] > 30) acc.Add(x); return acc; });
                BbBeamRebar plan;
                try { plan = BbBeamRebarPlan.Plan(it.Input, BbBeamRebarGen.PresetFor(book, it, null, 0, BbBeamRebarPlan.SpanCount(it.Input))); }
                catch (Exception ex) { sb.AppendLine("  " + it.Key + " plan error " + ex.Message); continue; }
                var ours = plan.Stirrups.SelectMany(s => Enumerable.Range(0, s.Count).Select(k => s.X0 + k * s.Spacing)).OrderBy(x => x).ToList();
                double H = it.Input.H;
                var line = new StringBuilder("CMP " + it.Key + " " + it.Size + " spans " + BbBeamRebarPlan.SpanCount(it.Input));
                foreach (BbSupport sp in BbBeamRebarPlan.InteriorSpans(it.Input))
                {
                    List<double> e = stir.Where(x => x > sp.Lo && x < sp.Hi).ToList(), o = ours.Where(x => x > sp.Lo && x < sp.Hi).ToList();
                    if (e.Count < 3) continue;
                    double eMax = e.Zip(e.Skip(1), (a, b) => b - a).DefaultIfEmpty(0).Max(), oMax = o.Zip(o.Skip(1), (a, b) => b - a).DefaultIfEmpty(0).Max();
                    stirCnt.Add((double)o.Count / e.Count);
                    // Байрлалын таарц: жишээний хомутын хэдэн хувьд манайх ±30 мм дотор.
                    double pm = (double)e.Count(x => o.Any(y => Math.Abs(y - x) <= 30)) / e.Count;
                    stirPos.Add(pm);
                    stirMax.Add(oMax - eMax);
                    // Тулгуурын нүүрээс 300 ба голын огтлолд дээд / доод ширхэг.
                    foreach (double x in new[] { sp.Lo + 300, (sp.Lo + sp.Hi) / 2 })
                    {
                        int eTop = bars.Count(b => b[0] <= x && b[1] >= x && b[2] > H / 2), eBot = bars.Count(b => b[0] <= x && b[1] >= x && b[2] <= H / 2);
                        // Жишээний хажуугийн арматур ч дээд / доод хагаст тоологдоно — манайхыг адил (хажуугийнх тал бүрд 1 ширхэг).
                        int oTop = plan.Bars.Where(b => b.X0 <= x && b.X1 >= x && b.Z > H / 2).Sum(b => b.N);
                        int oBot = plan.Bars.Where(b => b.X0 <= x && b.X1 >= x && b.Z <= H / 2).Sum(b => b.N);
                        secDiff.Add(Math.Abs(oTop - eTop) + Math.Abs(oBot - eBot));
                        line.Append(" | x" + Math.Round(x) + " top " + eTop + "/" + oTop + " bot " + eBot + "/" + oBot);
                    }
                    line.Append(" | stir " + e.Count + "/" + o.Count + " max " + Math.Round(eMax) + "/" + Math.Round(oMax) + " pos " + Math.Round(pm * 100) + "%");
                    if (kv.TryGetValue("detail", out string dk) && it.Key.StartsWith(dk, StringComparison.Ordinal))
                        line.Append("\n    span " + Math.Round(sp.Lo) + ".." + Math.Round(sp.Hi) + " LP " + string.Join(",", it.Input.LoadPoints.Select(q => Math.Round(q.Lo) + "-" + Math.Round(q.Hi)))
                            + "\n    EX " + string.Join(" ", e.Select(x => Math.Round(x - sp.Lo))) + "\n    US " + string.Join(" ", o.Select(x => Math.Round(x - sp.Lo))));
                }
                if (kv.TryGetValue("detail", out string dk2) && it.Key.StartsWith(dk2, StringComparison.Ordinal))
                {
                    line.Append("\n    PART s0(chain)=" + Math.Round(BbGeom.ToMm(it.S0 - ch.S0)) + " B×H " + it.Input.B + "×" + H + " sup " + string.Join(" ", it.Input.Supports.Select(s => Math.Round(s.Lo) + ".." + Math.Round(s.Hi))));
                    foreach (BbBarRun b in plan.Bars)
                        line.Append("\n    OURBAR " + b.Role + " " + b.N + "Ø" + b.D + " x " + Math.Round(b.X0) + ".." + Math.Round(b.X1) + " z " + Math.Round(b.Z) + " hook " + Math.Round(b.HookStart) + "/" + Math.Round(b.HookEnd));
                    foreach (BbBentBar b in plan.Bent) line.Append("\n    OURBENT " + b.Y.Length + "Ø" + b.D + " x " + Math.Round(b.X0) + ".." + Math.Round(b.X1));
                    foreach (BbStirrupSet s in plan.Stirrups.OrderBy(q => q.X0)) line.Append("\n    OURSTIR Ø" + s.D + " " + Math.Round(s.X0) + "x" + s.Count + "@" + s.Spacing);
                    foreach (BbStirrupSet s in plan.Ties.OrderBy(q => q.X0)) line.Append("\n    OURTIE Ø" + s.D + " " + Math.Round(s.X0) + "x" + s.Count + "@" + s.Spacing + " z " + string.Join(",", plan.TieZ.Select(z => Math.Round(z))));
                    foreach (double[] b in bars.OrderBy(q => -q[2]).ThenBy(q => q[0])) line.Append("\n    EXBAR x " + Math.Round(b[0]) + ".." + Math.Round(b[1]) + " z " + Math.Round(b[2]));
                }
                double eLen = bars.Sum(b => b[1] - b[0]), oLen = plan.Bars.Sum(b => (b.X1 - b.X0) * b.N);
                if (eLen > 0) { lenRatio.Add(oLen / eLen); line.Append(" | len " + Math.Round(oLen / eLen, 2)); }
                sb.AppendLine(line.ToString());
            }
            Func<List<double>, string> med = v => v.Count == 0 ? "-" : v.OrderBy(x => x).ElementAt(v.Count / 2).ToString("0.00", CultureInfo.InvariantCulture)
                + " (p10 " + v.OrderBy(x => x).ElementAt(v.Count / 10).ToString("0.00", CultureInfo.InvariantCulture) + ", p90 " + v.OrderBy(x => x).ElementAt(v.Count * 9 / 10).ToString("0.00", CultureInfo.InvariantCulture) + ")";
            sb.AppendLine("SUMMARY stirrup position match " + med(stirPos) + " mean " + (stirPos.Count > 0 ? stirPos.Average().ToString("0.00", CultureInfo.InvariantCulture) : "-")
                + " (exact spans " + stirPos.Count(x => x > 0.999) + "/" + stirPos.Count + ")");
            sb.AppendLine("SUMMARY stirrup count ours/example " + med(stirCnt) + "; max-gap diff mm " + med(stirMax) + "; section bar-count |diff| " + med(secDiff) + "; length ours/example " + med(lenRatio));
            return sb.ToString();
        }

        /// <summary>Gate «colrebargen»: <c>mark=Б-5|Б-6</c> эсвэл <c>mark=all;limit=N</c>, <c>replace=1</c>, <c>code=1</c>, <c>dump=1</c>.</summary>
        public static string Columns(Document doc, Dictionary<string, string> kv)
        {
            var sb = new StringBuilder();
            string marks = kv.TryGetValue("mark", out string m) ? m : "all";
            int limit = kv.TryGetValue("limit", out string l) ? int.Parse(l) : 1000;
            bool replace = kv.TryGetValue("replace", out string rp) && rp == "1";
            bool code = kv.TryGetValue("code", out string cd) && cd == "1";
            bool dump = kv.TryGetValue("dump", out string dp) && dp == "1";
            BbRebarBuilder.OpenLoop = !(kv.TryGetValue("loop", out string lp) && lp == "closed");
            BbRebarBuilder.DebugPaths = kv.ContainsKey("debugpath");
            IEnumerable<FamilyInstance> cols = BbColumnRebarGen.AllColumns(doc);
            if (marks != "all")
            {
                var set = new HashSet<string>(marks.Split('|'), StringComparer.Ordinal);
                cols = cols.Where(c => set.Contains(BbGeom.Mark(c)));
            }
            var t0 = DateTime.Now;
            List<BbColumnGenItem> items = BbColumnRebarGen.Collect(doc, cols).Take(limit).ToList();
            sb.AppendLine("columns " + items.Count + " collect " + (DateTime.Now - t0).TotalMilliseconds.ToString("0") + " ms");
            int created = 0, failed = 0, skipped = 0;
            BbColumnStyle cstyle = ColStyle(doc, kv, sb);
            foreach (BbColumnGenItem it in items)
            {
                sb.AppendLine("COL " + it.Mark + " " + it.Level + " " + it.Size + " H=" + F(it.Input.Height) + " joint=" + F(it.Input.Joint) + " above=" + it.Input.ContinuesAbove
                    + " found=" + it.Input.OnFoundation + " own=" + it.Own + " foreign=" + it.Foreign);
                if (it.Skip != null) { sb.AppendLine("  skip " + it.Skip); skipped++; continue; }
                if (it.Foreign > 0 && !replace) { sb.AppendLine("  skip: гараар"); skipped++; continue; }
                if (kv.ContainsKey("dry")) continue;
                var cbook = new BbRebarBook { Company = !code, UseHostCover = !(kv.TryGetValue("hostcover", out string chc) && chc == "0"), ColStyle = cstyle };
                if (kv.TryGetValue("layout", out string clay)) cbook.Col(it.Mark).TieLayout = clay;
                if (kv.TryGetValue("bars", out string cbars)) cbook.Col(it.Mark).Bars = cbars;
                BbColumnPreset p = BbColumnRebarGen.PresetFor(cbook, it, null);
                BbBeamRebarGen.Outcome o;
                using (var t = new Transaction(doc, "colrebargen " + it.Mark))
                {
                    FailureHandlingOptions fh = t.GetFailureHandlingOptions();
                    fh.SetFailuresPreprocessor(new BbSwallowWarnings());
                    t.SetFailureHandlingOptions(fh);
                    t.Start();
                    o = BbColumnRebarGen.Generate(doc, it, p, replace);
                    TransactionStatus st = t.Commit();
                    if (st != TransactionStatus.Committed) sb.AppendLine("  commit " + st);
                }
                created += o.Created; failed += o.Failed;
                sb.AppendLine("  created " + o.Created + " deleted " + o.Deleted + " failed " + o.Failed);
                foreach (string n in o.Notes.Distinct().Take(8)) sb.AppendLine("  note " + n);
                if (dump)
                    foreach (Rebar r in BbBeamRebarGen.RebarsOf(doc, it.Column).Where(BbBeamRebarGen.IsOwn).Take(40))
                    {
                        int n = 1;
                        try { n = r.NumberOfBarPositions; } catch { }
                        var shape = doc.GetElement(r.GetShapeId()) as RebarShape;
                        BoundingBoxXYZ bb = r.get_BoundingBox(null);
                        sb.AppendLine("  RB " + shape?.Name + " n=" + n + " bb z " + (bb == null ? "?" : F(BbGeom.ToMm(bb.Min.Z - it.Z0)) + ".." + F(BbGeom.ToMm(bb.Max.Z - it.Z0))));
                    }
            }
            sb.AppendLine("TOTAL created " + created + " failed " + failed + " skipped " + skipped + " in " + (DateTime.Now - t0).TotalSeconds.ToString("0.0") + " s");
            return sb.ToString();
        }

        /// <summary>Элементийн solid-ын ирмэгийн цэгүүдийн хүрээн дэх min / max (фут) — bbox-оос үл хамааран.</summary>
        static bool SolidBox(Element e, BbFrame fr, out XYZ mn, out XYZ mx)
        {
            double[] lo = { double.MaxValue, double.MaxValue, double.MaxValue }, hi = { double.MinValue, double.MinValue, double.MinValue };
            var solids = new List<Solid>();
            GeometryElement ge = e.get_Geometry(new Options { ComputeReferences = false, DetailLevel = ViewDetailLevel.Fine });
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
                    }
            mn = new XYZ(lo[0], lo[1], lo[2]); mx = new XYZ(hi[0], hi[1], hi[2]);
            return solids.Count > 0;
        }

        /// <summary>
        /// Gate «rebarprobe»: <c>mark=ДН-1;col=Б-1;limit=N</c> — элементийн bbox ба solid-ын хэмжээ, Rebar Cover, хөндлөн арматур бүрийн (гар / манай)
        /// 4 талын цэвэр зай (зүүн = алс V, баруун = ойр V, доод, дээд; баганад x0 / x1 / y0 / y1).
        /// </summary>
        public static string Probe(Document doc, Dictionary<string, string> kv)
        {
            var sb = new StringBuilder();
            int limit = kv.TryGetValue("limit", out string l) ? int.Parse(l) : 5;
            if (kv.TryGetValue("mark", out string marks))
            {
                var set = new HashSet<string>(marks.Split('|'), StringComparer.Ordinal);
                foreach (BbBeamGenItem it in BbBeamRebarGen.Collect(doc, BbBeamRebarGen.AllBeams(doc).Where(b => set.Contains(BbGeom.Mark(b)))).Take(limit))
                {
                    BbBeamChain ch = it.Chain;
                    var fr = new BbFrame { O = ch.Origin, R = ch.Axis, U = XYZ.BasisZ, V = ch.Axis.CrossProduct(XYZ.BasisZ).Normalize() };
                    sb.AppendLine("BEAM " + it.Key + " part " + it.Part + "/" + it.Parts + " B=" + F(it.Input.B) + " H=" + F(it.Input.H) + " cover t/b/s=" + it.CoverTop + "/" + it.CoverBottom + "/" + it.CoverSide
                        + " s0(chain)=" + F(BbGeom.ToMm(it.S0 - ch.S0)) + " bottom(chain top-)=" + F(BbGeom.ToMm(ch.Top - it.Bottom)) + " sup=" + string.Join(" ", it.Input.Supports.Select(s => F(s.Lo) + ".." + F(s.Hi))));
                    if (kv.ContainsKey("ends"))
                    {
                        // Гинжийн төгсгөлийн ойрх (1000 мм) бүх бүтээцийн элемент — станц, хөндлөн, z (гинжийн хүрээнд).
                        double s0 = ch.S0 - BbGeom.Ft(1000), s1 = ch.S1 + BbGeom.Ft(1000);
                        foreach (BuiltInCategory cat in new[] { BuiltInCategory.OST_StructuralFraming, BuiltInCategory.OST_StructuralColumns, BuiltInCategory.OST_Walls, BuiltInCategory.OST_Floors })
                            foreach (Element e in new FilteredElementCollector(doc).OfCategory(cat).WhereElementIsNotElementType())
                            {
                                if (ch.Members.Any(mm => mm.Id == e.Id)) continue;
                                BoundingBoxXYZ b = e.get_BoundingBox(null);
                                if (b == null || b.Max.Z < ch.Bottom - BbGeom.Ft(50) || b.Min.Z > ch.Top + BbGeom.Ft(50)) continue;
                                fr.Extent(b, out XYZ mn, out XYZ mx);
                                if (mx.X < s0 || mn.X > s1 || mx.Z < ch.Far - BbGeom.Ft(50) || mn.Z > ch.Near + BbGeom.Ft(50)) continue;
                                bool nearEnd = mn.X < ch.S0 + BbGeom.Ft(300) || mx.X > ch.S1 - BbGeom.Ft(300);
                                if (!nearEnd) continue;
                                sb.AppendLine("    END " + e.Category?.Name + " " + e.Id.Value + " «" + e.Name + "» mark=" + BbGeom.Mark(e) + " s=" + F(BbGeom.ToMm(mn.X - it.S0)) + ".." + F(BbGeom.ToMm(mx.X - it.S0))
                                    + " v=" + F(BbGeom.ToMm(mn.Z - it.Far)) + ".." + F(BbGeom.ToMm(mx.Z - it.Far)) + " z=" + F(BbGeom.ToMm(b.Min.Z - it.Bottom)) + ".." + F(BbGeom.ToMm(b.Max.Z - it.Bottom)));
                            }
                    }
                    if (kv.ContainsKey("bars"))
                        foreach (FamilyInstance m in it.Members)
                            foreach (Rebar r in BbBeamRebarGen.RebarsOf(doc, m))
                            {
                                var shape = doc.GetElement(r.GetShapeId()) as RebarShape;
                                if (shape != null && shape.RebarStyle == RebarStyle.StirrupTie) continue;
                                IList<Curve> cs;
                                try { cs = r.GetTransformedCenterlineCurves(false, true, true, MultiplanarOption.IncludeOnlyPlanarCurves, 0); } catch { continue; }
                                int n = 1;
                                try { n = r.NumberOfBarPositions; } catch { }
                                double d = BbGeom.ToMm((doc.GetElement(r.GetTypeId()) as RebarBarType).BarModelDiameter);
                                string segs = string.Join(" ", "ABCDEFGHJK".Select(ch2 => r.LookupParameter(ch2.ToString())).Where(pp => pp != null && pp.StorageType == StorageType.Double && pp.AsDouble() > 1e-6)
                                    .Select(pp => pp.Definition.Name + "=" + F(BbGeom.ToMm(pp.AsDouble()))));
                                sb.AppendLine("    BAR " + (BbBeamRebarGen.IsOwn(r) ? "OWN " : "EX  ") + r.Id.Value + " host " + m.Id.Value + " " + n + "Ø" + F(d) + " shape=" + shape?.Name + " {" + segs + "} :" + string.Join(" ", cs.Select(c =>
                                    "[" + F(BbGeom.ToMm(fr.Local(c.GetEndPoint(0)).X - it.S0)) + "," + F(BbGeom.ToMm(c.GetEndPoint(0).Z - it.Bottom)) + ">" + F(BbGeom.ToMm(fr.Local(c.GetEndPoint(1)).X - it.S0)) + "," + F(BbGeom.ToMm(c.GetEndPoint(1).Z - it.Bottom)) + "]")));
                            }
                    foreach (FamilyInstance m in it.Members)
                    {
                        BoundingBoxXYZ bb = m.get_BoundingBox(null);
                        fr.Extent(bb, out XYZ bn, out XYZ bx);
                        sb.Append("  member " + m.Id.Value + " «" + m.Name + "» bbox v=" + F(BbGeom.ToMm(bn.Z - it.Far)) + ".." + F(BbGeom.ToMm(bx.Z - it.Far)) + " z=" + F(BbGeom.ToMm(bb.Min.Z - it.Bottom)) + ".." + F(BbGeom.ToMm(bb.Max.Z - it.Bottom)));
                        if (SolidBox(m, fr, out XYZ sn, out XYZ sx))
                            sb.Append(" | solid v=" + F(BbGeom.ToMm(sn.Z - it.Far)) + ".." + F(BbGeom.ToMm(sx.Z - it.Far)) + " z=" + F(BbGeom.ToMm(sn.Y + ch.Origin.Z - it.Bottom)) + ".." + F(BbGeom.ToMm(sx.Y + ch.Origin.Z - it.Bottom)));
                        sb.AppendLine(" b=" + m.Symbol.LookupParameter("b")?.AsValueString() + " h=" + m.Symbol.LookupParameter("h")?.AsValueString());
                        int k = 0;
                        foreach (Rebar r in BbBeamRebarGen.RebarsOf(doc, m))
                        {
                            IList<Curve> cs;
                            try { cs = r.GetTransformedCenterlineCurves(false, true, true, MultiplanarOption.IncludeOnlyPlanarCurves, 0); } catch { continue; }
                            var pts = cs.SelectMany(c => new[] { c.GetEndPoint(0), c.GetEndPoint(1) }).Select(q => new[] { BbGeom.ToMm(fr.Local(q).X - it.S0), BbGeom.ToMm(fr.Local(q).Z - it.Far), BbGeom.ToMm(q.Z - it.Bottom) }).ToList();
                            if (pts.Max(q => q[0]) - pts.Min(q => q[0]) > 30) continue;
                            double d = BbGeom.ToMm((doc.GetElement(r.GetTypeId()) as RebarBarType).BarModelDiameter);
                            if (cs.Count < 4)
                            {
                                IList<Curve> ch2 = r.GetTransformedCenterlineCurves(false, false, false, MultiplanarOption.IncludeOnlyPlanarCurves, 0);
                                var ph = ch2.SelectMany(c => c.Tessellate()).Select(q => new[] { BbGeom.ToMm(fr.Local(q).Z - it.Far), BbGeom.ToMm(q.Z - it.Bottom) }).ToList();
                                sb.AppendLine("    TIE " + (BbBeamRebarGen.IsOwn(r) ? "OWN " : "EX  ") + r.Id.Value + " d" + F(d) + " shape=" + (doc.GetElement(r.GetShapeId()) as RebarShape)?.Name + " straight v=" + F(pts.Min(q => q[1])) + ".." + F(pts.Max(q => q[1])) + " y=" + F(pts.Min(q => q[2]))
                                    + " | with hooks v=" + F(ph.Min(q => q[0])) + ".." + F(ph.Max(q => q[0])) + " y=" + F(ph.Min(q => q[1])) + ".." + F(ph.Max(q => q[1])));
                                continue;
                            }
                            double v0 = pts.Min(q => q[1]), v1 = pts.Max(q => q[1]), y0 = pts.Min(q => q[2]), y1 = pts.Max(q => q[2]);
                            sb.AppendLine("    " + (BbBeamRebarGen.IsOwn(r) ? "OWN " : "EX  ") + r.Id.Value + " d" + F(d) + " clear left " + F(v0 - d / 2) + " right " + F(it.Input.B - v1 - d / 2) + " bottom " + F(y0 - d / 2) + " top " + F(it.Input.H - y1 - d / 2)
                                + " shape=" + (doc.GetElement(r.GetShapeId()) as RebarShape)?.Name + " comm=«" + r.get_Parameter(BuiltInParameter.ALL_MODEL_INSTANCE_COMMENTS)?.AsString() + "»");
                            if (kv.ContainsKey("raw"))
                            {
                                IList<Curve> cb = r.GetTransformedCenterlineCurves(false, true, false, MultiplanarOption.IncludeOnlyPlanarCurves, 0);
                                var pb = cb.SelectMany(c => c.Tessellate()).Select(q => new[] { BbGeom.ToMm(fr.Local(q).Z - it.Far), BbGeom.ToMm(q.Z - it.Bottom) }).ToList();
                                sb.AppendLine("      bent v=" + F(pb.Min(q => q[0])) + ".." + F(pb.Max(q => q[0])) + " y=" + F(pb.Min(q => q[1])) + ".." + F(pb.Max(q => q[1])) + " | sharp " + string.Join(" ", cs.Select(c => "[" + F(BbGeom.ToMm(fr.Local(c.GetEndPoint(0)).Z - it.Far)) + "," + F(BbGeom.ToMm(c.GetEndPoint(0).Z - it.Bottom)) + "]")));
                                try
                                {
                                    RebarShapeDrivenAccessor acc = r.GetShapeDrivenAccessor();
                                    sb.AppendLine("      bendD=" + F(BbGeom.ToMm((doc.GetElement(r.GetTypeId()) as RebarBarType).StirrupTieBendDiameter)) + " barD=" + F(BbGeom.ToMm((doc.GetElement(r.GetTypeId()) as RebarBarType).BarNominalDiameter)));
                                }
                                catch { }
                            }
                            if (++k >= 4) break;
                        }
                    }
                }
            }
            if (kv.TryGetValue("col", out string cmarks))
            {
                var set = new HashSet<string>(cmarks.Split('|'), StringComparer.Ordinal);
                foreach (BbColumnGenItem it in BbColumnRebarGen.Collect(doc, BbColumnRebarGen.AllColumns(doc).Where(c => set.Contains(BbGeom.Mark(c)))).Take(limit))
                {
                    sb.Append("COL " + it.Mark + " " + it.Level + " B=" + F(it.Input.B) + " H=" + F(it.Input.H) + " cover=" + it.Cover + " R=" + it.Frame.R);
                    if (SolidBox(it.Column, it.Frame, out XYZ sn, out XYZ sx))
                        sb.Append(" | solid x=" + F(BbGeom.ToMm(sn.X - it.X0)) + ".." + F(BbGeom.ToMm(sx.X - it.X0)) + " y=" + F(BbGeom.ToMm(sn.Y - it.Y0)) + ".." + F(BbGeom.ToMm(sx.Y - it.Y0)));
                    sb.AppendLine(" b=" + it.Column.Symbol.LookupParameter("b")?.AsValueString() + " h=" + it.Column.Symbol.LookupParameter("h")?.AsValueString());
                    int k = 0;
                    foreach (Rebar r in BbBeamRebarGen.RebarsOf(doc, it.Column))
                    {
                        IList<Curve> cs;
                        try { cs = r.GetTransformedCenterlineCurves(false, true, true, MultiplanarOption.IncludeOnlyPlanarCurves, 0); } catch { continue; }
                        var pts = cs.SelectMany(c => new[] { c.GetEndPoint(0), c.GetEndPoint(1) }).Select(q => { XYZ lc = it.Frame.Local(q); return new[] { BbGeom.ToMm(lc.X - it.X0), BbGeom.ToMm(lc.Y - it.Y0), BbGeom.ToMm(q.Z - it.Z0) }; }).ToList();
                        if (pts.Max(q => q[2]) - pts.Min(q => q[2]) > 30 || cs.Count < 4) continue;
                        double d = BbGeom.ToMm((doc.GetElement(r.GetTypeId()) as RebarBarType).BarModelDiameter);
                        double x0 = pts.Min(q => q[0]), x1 = pts.Max(q => q[0]), y0 = pts.Min(q => q[1]), y1 = pts.Max(q => q[1]);
                        sb.AppendLine("    " + (BbBeamRebarGen.IsOwn(r) ? "OWN " : "EX  ") + r.Id.Value + " d" + F(d) + " clear x0 " + F(x0 - d / 2) + " x1 " + F(it.Input.B - x1 - d / 2) + " y0 " + F(y0 - d / 2) + " y1 " + F(it.Input.H - y1 - d / 2)
                            + (kv.ContainsKey("raw") ? " sharp " + string.Join(" ", cs.Select(c => { XYZ a = it.Frame.Local(c.GetEndPoint(0)), e = it.Frame.Local(c.GetEndPoint(1)); return "[" + F(BbGeom.ToMm(a.X - it.X0)) + "," + F(BbGeom.ToMm(a.Y - it.Y0)) + ">" + F(BbGeom.ToMm(e.X - it.X0)) + "," + F(BbGeom.ToMm(e.Y - it.Y0)) + "]"; })) : ""));
                        if (++k >= 4) break;
                    }
                }
            }
            return sb.ToString();
        }

        static void Dump(Document doc, BbBeamGenItem it, StringBuilder sb)
        {
            BbBeamChain ch = it.Chain;
            var fr = new BbFrame { O = ch.Origin, R = ch.Axis, U = XYZ.BasisZ, V = ch.Axis.CrossProduct(XYZ.BasisZ).Normalize() };
            Func<XYZ, string> pt = q =>
            {
                XYZ lc = fr.Local(q);
                return F(BbGeom.ToMm(lc.X - it.S0)) + "," + F(BbGeom.ToMm(lc.Z - ch.Far)) + "," + F(BbGeom.ToMm(q.Z - ch.Bottom));
            };
            foreach (FamilyInstance m in ch.Members)
                foreach (Rebar r in BbBeamRebarGen.RebarsOf(doc, m).Where(BbBeamRebarGen.IsOwn))
                {
                    var bt = doc.GetElement(r.GetTypeId()) as RebarBarType;
                    var shape = doc.GetElement(r.GetShapeId()) as RebarShape;
                    int n = 1;
                    double s = 0;
                    try { n = r.NumberOfBarPositions; s = BbGeom.ToMm(r.MaxSpacing); } catch { }
                    sb.Append("  RB " + r.Id.Value + " " + shape?.RebarStyle + " " + bt?.Name + " shape=" + shape?.Name + " n=" + n + " s=" + F(s) + " :");
                    try
                    {
                        foreach (Curve c in r.GetTransformedCenterlineCurves(false, true, true, MultiplanarOption.IncludeOnlyPlanarCurves, 0))
                            sb.Append(" [" + pt(c.GetEndPoint(0)) + ">" + pt(c.GetEndPoint(1)) + "]");
                        if (n > 1)
                        {
                            IList<Curve> lastC = r.GetTransformedCenterlineCurves(false, true, true, MultiplanarOption.IncludeOnlyPlanarCurves, n - 1);
                            sb.Append(" | last " + pt(lastC[0].GetEndPoint(0)));
                        }
                    }
                    catch (Exception ex) { sb.Append(" ERR " + ex.Message); }
                    sb.AppendLine();
                }
        }
    }
}
