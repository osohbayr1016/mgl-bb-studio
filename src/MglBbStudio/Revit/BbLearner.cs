using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using MglBb.Core;

namespace MglBb.RevitSide
{
    /// <summary>Нэг харагдацын ангилал: аль гишүүний дэлгээс эсвэл огтлол вэ.</summary>
    internal sealed class BbViewSample
    {
        public View View;
        public string Sheet = "";
        public string ViewportType = "";
        public BbMemberKind Kind;
        public bool IsSection;
        public FamilyInstance Host;
        public string Mark = "";
        public BbFrame Frame;
        public XYZ CropMin, CropMax;
    }

    internal sealed class BbLearnReport
    {
        public int ViewsScanned, Classified;
        public readonly Dictionary<string, int> PerKind = new Dictionary<string, int>(StringComparer.Ordinal);
        public readonly List<string> Notes = new List<string>();
        public BbSamples Samples;
        public int FieldsLearned;
        public long ElapsedMs;
        /// <summary>Заасан горимд дамнурууны дэлгээсийн хэмжээс/MRA/шошгоны бүрэн хэмжилт (<see cref="BbElevDump"/>).</summary>
        public readonly System.Text.StringBuilder ElevDump = new System.Text.StringBuilder();
        public readonly List<BbIssue> Issues = new List<BbIssue>();
    }

    /// <summary>
    /// «Стандарт сурах»: энэ төслийн хуудсанд байрлуулсан дамнуруу/баганын дэлгээс, огтлолыг ГЕОМЕТРЭЭР таньж (нэрээр биш — өөр төсөлд өөр нэр
    /// байж болно; нэр нь зөвхөн гишүүний тэмдгийг сонгоход тусална), crop/огтлолын байрлал/хэмжээс/шошго/MRA-ийн статистикаас стандартыг бөглөнө.
    /// Загварт ЮУ Ч бичихгүй.  Хурд: харагдац бүрд хэдэн collector + байрлалын уншилт (bbox/regeneration шаардахгүй утгууд л).
    /// ЖИШЭЭ-1 (471 хуудас) дээр Python-оор баталсан аргууд (scratchpad/tools/*.py) — тоо нь тэдгээртэй ижил байх ёстой.
    /// </summary>
    internal static class BbLearner
    {
        /// <param name="only">Хэрэглэгчийн заасан харагдацууд (ViewId) — бол ЗӨВХӨН тэднээс сурна: энэ хэрэгслийн үүсгэж гараар зассан харагдацыг
        /// ч оруулна, нэг жишээ хангалттай.  null = төслийн хуудсанд байрласан бүх харагдац (хуучин горим, gate).</param>
        public static BbStandard Learn(Document doc, BbStandard baseStd, int maxPerKind, out BbLearnReport rep, ISet<long> only = null)
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            rep = new BbLearnReport();
            var s = new BbSamples();
            rep.Samples = s;
            List<BbViewSample> samples = Collect(doc, rep, only);
            long tCollect = sw.ElapsedMilliseconds;
            var used = new List<BbViewSample>();
            foreach (var g in samples.GroupBy(x => x.Kind.ToString() + (x.IsSection ? ".sec" : ".elev")))
            {
                // Хэт олон бол жигд түүвэр (хуудасны дугаараар эрэмбэлсэн) — хурд.
                List<BbViewSample> list = g.OrderBy(x => x.Sheet, StringComparer.Ordinal).ToList();
                int cap = g.Key.EndsWith(".sec", StringComparison.Ordinal) ? maxPerKind * 3 : maxPerKind;
                if (list.Count > cap)
                {
                    double step = list.Count / (double)cap;
                    list = Enumerable.Range(0, cap).Select(i => list[(int)(i * step)]).ToList();
                }
                used.AddRange(list);
                rep.PerKind[g.Key] = g.Count();
            }

            var chainCache = new Dictionary<string, BbBeamChain>(StringComparer.Ordinal);
            var mraDims = new HashSet<long>();
            var mraTags = new HashSet<long>();
            foreach (MultiReferenceAnnotation m in new FilteredElementCollector(doc).OfClass(typeof(MultiReferenceAnnotation)).Cast<MultiReferenceAnnotation>())
            {
                mraDims.Add(m.DimensionId.Value);
                mraTags.Add(m.TagId.Value);
            }
            // Харагдац бүрийн тэмдэглэгээ: НЭГ баримтын цуглуулгаар OwnerViewId-аар бүлэглэнэ.  FilteredElementCollector(doc, viewId) нь
            // харагдац бүрийн дүрслэлийг тооцоолдог тул 720 харагдацад 20 минут болж байв (ЖИШЭЭ-1, хэмжсэн).
            var usedViews = new HashSet<long>(used.Select(x => x.View.Id.Value));
            _owned = new Dictionary<long, List<Element>>();
            var annFilter = new LogicalOrFilter(new List<ElementFilter>
            {
                new ElementClassFilter(typeof(Dimension)),
                new ElementClassFilter(typeof(IndependentTag)),
                new ElementClassFilter(typeof(MultiReferenceAnnotation)),
            });
            foreach (Element e in new FilteredElementCollector(doc).WherePasses(annFilter))
            {
                long ov = e.OwnerViewId.Value;
                if (!usedViews.Contains(ov)) continue;
                if (!_owned.TryGetValue(ov, out List<Element> l)) _owned[ov] = l = new List<Element>();
                l.Add(e);
            }

            foreach (BbViewSample v in used)
            {
                string k = BbStandard.KindKey(v.Kind) + ".";
                try
                {
                    if (v.IsSection) LearnSectionView(doc, v, k, s, chainCache);
                    else LearnElevationView(doc, v, k, s, chainCache);
                    LearnAnnotations(doc, v, k, s, mraDims, mraTags);
                    if (only != null && !v.IsSection && (v.Kind == BbMemberKind.Beam || v.Kind == BbMemberKind.BeamAux))
                    {
                        try { BbElevDump.Beam(doc, v, rep.ElevDump); }
                        catch (Exception ex) { rep.ElevDump.AppendLine("«" + v.View.Name + "»: тайлан — " + ex.Message); }
                    }
                    if (v.IsSection && (v.Kind == BbMemberKind.Beam || v.Kind == BbMemberKind.BeamAux))
                    {
                        LearnBreaks(doc, v, k, s);
                        BbSecTagLayout.Learn(doc, v.View, v.Host.get_BoundingBox(null), k, s, mraTags);
                    }
                    rep.Classified++;
                }
                catch (Exception ex)
                {
                    rep.Notes.Add("«" + v.View.Name + "»: " + ex.Message);
                }
            }
            _owned = null;
            long tViews = sw.ElapsedMilliseconds;
            LearnSheets(doc, used, s);
            long tSheets = sw.ElapsedMilliseconds;
            try { LearnPlates(doc, s, rep, only); } catch (Exception ex) { rep.Notes.Add("хана/хучилт: " + ex.Message); }
            rep.Notes.Add("хугацаа: ангилах " + tCollect + " мс, харагдац " + (tViews - tCollect) + " мс, хуудас " + (tSheets - tViews) + " мс, хана/хучилт " + (sw.ElapsedMilliseconds - tSheets) + " мс");

            BbStandard std = baseStd ?? new BbStandard();
            rep.FieldsLearned = s.ApplyTo(std, minSamples: only != null ? 1 : 3, round: 0.5);
            // Масштаб, бүхэл тоо — 0.5-аар бөөрөнхийлөх нь буруу (ApplyTo int-ийг mode-оор авна).
            std.Source = doc.Title;
            std.LearnedAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture);
            rep.ElapsedMs = sw.ElapsedMilliseconds;
            foreach (BbMemberKind kind in new[] { BbMemberKind.Beam, BbMemberKind.BeamAux, BbMemberKind.Column })
            {
                int e = rep.PerKind.TryGetValue(kind + ".elev", out int a) ? a : 0, c = rep.PerKind.TryGetValue(kind + ".sec", out int b) ? b : 0;
                if (e + c == 0)
                    rep.Issues.Add(new BbIssue
                    {
                        Tool = "Стандарт сурах", Severity = BbSeverity.Warning, Member = BbStandard.KindName(kind),
                        Problem = BbStandard.KindName(kind) + "-ны хуудсанд байрласан дэлгээс/огтлол олдсонгүй — тэр төрлийн стандарт өгөгдмөлөөрөө үлдэв.",
                        Proposal = "Энэ төрлийн дор хаяж 3 зурсан жишээтэй төслөөс сурах эсвэл plugin-ий өгөгдмөл (ЖИШЭЭ-1) стандартыг хэрэглэх.",
                        Key = "learn|" + kind + "|none",
                    });
            }
            return std;
        }

        // ── Харагдац цуглуулах, ангилах ─────────────────────────────────

        /// <summary>Гишүүний хүрээ (санах ойд): харагдац бүрд Revit-ийн цуглуулга ажиллуулахгүй (2610 харагдацад 303 с → хэдэн секунд).</summary>
        private sealed class MemberBox
        {
            public FamilyInstance Fi;
            public BuiltInCategory Cat;
            // ⚠️ Энгийн double — XYZ.X нь native дуудлага; 2610 харагдац × 13 000 гишүүнд XYZ-ээр харьцуулахад сурагч 20+ мин болсон (хэмжсэн).
            public double X0, Y0, Z0, X1, Y1, Z1;
        }

        [ThreadStatic] private static List<MemberBox> _members;

        /// <summary>Gate: туршилтын харагдацын нэрийн хэсэг («(MGL») — сурахаас хасна.</summary>
        internal static string SkipNameContains;

        private static List<MemberBox> BuildMemberIndex(Document doc)
        {
            var res = new List<MemberBox>();
            foreach (BuiltInCategory cat in new[] { BuiltInCategory.OST_StructuralFraming, BuiltInCategory.OST_StructuralColumns })
                foreach (FamilyInstance fi in new FilteredElementCollector(doc).OfCategory(cat).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>())
                {
                    BoundingBoxXYZ bb = fi.get_BoundingBox(null);
                    if (bb == null) continue;
                    XYZ a = bb.Min, b = bb.Max;
                    res.Add(new MemberBox { Fi = fi, Cat = cat, X0 = a.X, Y0 = a.Y, Z0 = a.Z, X1 = b.X, Y1 = b.Y, Z1 = b.Z });
                }
            return res;
        }

        private static IEnumerable<FamilyInstance> Candidates(Document doc, BuiltInCategory cat, Outline world)
        {
            if (_members == null)
                return new FilteredElementCollector(doc).OfCategory(cat).OfClass(typeof(FamilyInstance)).WherePasses(new BoundingBoxIntersectsFilter(world)).Cast<FamilyInstance>();
            XYZ a = world.MinimumPoint, b = world.MaximumPoint;
            double ax = a.X, ay = a.Y, az = a.Z, bx = b.X, by = b.Y, bz = b.Z;
            return _members.Where(m => m.Cat == cat && m.X0 <= bx && m.X1 >= ax && m.Y0 <= by && m.Y1 >= ay && m.Z0 <= bz && m.Z1 >= az).Select(m => m.Fi);
        }

        public static List<BbViewSample> Collect(Document doc, BbLearnReport rep, ISet<long> only = null)
        {
            _members = BuildMemberIndex(doc);
            try { return CollectCore(doc, rep, only); }
            finally { _members = null; }
        }

        private static List<BbViewSample> CollectCore(Document doc, BbLearnReport rep, ISet<long> only)
        {
            var res = new List<BbViewSample>();
            var seen = new HashSet<long>();
            foreach (ViewSheet sh in new FilteredElementCollector(doc).OfClass(typeof(ViewSheet)).Cast<ViewSheet>())
            {
                foreach (ElementId vpId in sh.GetAllViewports())
                {
                    if (!(doc.GetElement(vpId) is Viewport vp)) continue;
                    if (!(doc.GetElement(vp.ViewId) is ViewSection v) || !IsDetailOrSection(v) || !Learnable(v, only)) continue;
                    seen.Add(v.Id.Value);
                    rep.ViewsScanned++;
                    BbViewSample x = Classify(doc, v, learning: true);
                    if (x == null) continue;
                    x.Sheet = sh.SheetNumber ?? "";
                    try { x.ViewportType = doc.GetElement(vp.GetTypeId())?.Name ?? ""; } catch { }
                    res.Add(x);
                }
            }
            // Заасан боловч хуудсанд байрлаагүй харагдац — хуудасгүйгээр (харагдацын тохиргоо, тэмдэглэгээг л сурна).
            if (only != null)
                foreach (long id in only)
                {
                    if (seen.Contains(id) || !(doc.GetElement(new ElementId(id)) is ViewSection v) || !IsDetailOrSection(v) || !Learnable(v, only)) continue;
                    rep.ViewsScanned++;
                    BbViewSample x = Classify(doc, v, learning: true);
                    if (x == null) continue;
                    x.Sheet = "";
                    res.Add(x);
                }
            return res;
        }

        private static bool IsDetailOrSection(View v) { return v.ViewType == ViewType.Detail || v.ViewType == ViewType.Section; }

        /// <summary>
        /// Сурах харагдац мөн эсэх.  Заасан горимд: зөвхөн <paramref name="only"/>, энэ хэрэгслийн үүсгэсэн ч (хэрэглэгч гараар зассан байж болно).
        /// Бүх горимд: энэ хэрэгслийн үүсгэсэн харагдац (эсвэл gate-ийн туршилтын нэр) — сурахгүй.
        /// </summary>
        private static bool Learnable(View v, ISet<long> only)
        {
            if (v.IsTemplate) return false;
            if (only != null) return only.Contains(v.Id.Value);
            return !BbAnnoStore.IsGenerated(v) && (SkipNameContains == null || !(v.Name ?? "").Contains(SkipNameContains));
        }

        public static BbViewSample Classify(Document doc, View v, bool learning = false)
        {
            if (!v.CropBoxActive) return null;
            BbFrame f = BbFrame.Of(v);
            BoundingBoxXYZ cb = v.CropBox;
            XYZ mn = cb.Min, mx = cb.Max;
            Outline world = WorldOutline(f, mn, mx);
            if (world == null) return null;
            string name = v.Name ?? "";
            bool upIsZ = Math.Abs(f.U.Z) > 0.99, dirIsZ = Math.Abs(f.V.Z) > 0.99;

            // Нэрэнд тэмдэг байгаа гишүүнийг ЭХЛЭЭД (жишээнд «ДН-1 S3», «БАГАНА Б-5 …»), эс бөгөөс геометрээр.
            BbViewSample best = null;
            double bestScore = double.MinValue;
            foreach (BuiltInCategory cat in new[] { BuiltInCategory.OST_StructuralFraming, BuiltInCategory.OST_StructuralColumns })
            {
                int n = 0;
                foreach (FamilyInstance fi in Candidates(doc, cat, world))
                {
                    if (++n > 300) break;
                    string mark = BbGeom.Mark(fi);
                    bool named = mark.Length > 0 && BbNames.IndexOfMark(name, mark) >= 0;
                    bool isSection;
                    BbMemberKind kind;
                    double score;
                    if (cat == BuiltInCategory.OST_StructuralFraming)
                    {
                        if (!BbGeom.LineOf(fi, out XYZ p0, out XYZ p1)) continue;
                        XYZ ax = (p1 - p0);
                        if (ax.GetLength() < 1e-6) continue;
                        ax = ax.Normalize();
                        double ar = Math.Abs(ax.DotProduct(f.R)), av = Math.Abs(ax.DotProduct(f.V));
                        if (ar > 0.99 && upIsZ) isSection = false;
                        else if (av > 0.99) isSection = true;
                        else continue;
                        kind = BbGeom.IsAuxMark(mark) ? BbMemberKind.BeamAux : BbMemberKind.Beam;
                        BoundingBoxXYZ bb = fi.get_BoundingBox(null);
                        if (bb == null) continue;
                        f.Extent(bb, out XYZ a, out XYZ b);
                        // огтлол: хавтгайг (z = 0) дайрах ёстой; дэлгээс: харагдах гүнд (cropMin.z..0) байх
                        if (isSection && (a.Z > 1e-3 || b.Z < -1e-3)) continue;
                        if (!isSection && (b.Z < mn.Z || a.Z > 0.2)) continue;
                        double overlap = Math.Max(0, Math.Min(b.X, mx.X) - Math.Max(a.X, mn.X)) * Math.Max(0, Math.Min(b.Y, mx.Y) - Math.Max(a.Y, mn.Y));
                        score = overlap;
                    }
                    else
                    {
                        if (dirIsZ) isSection = true;
                        else if (upIsZ) isSection = false;
                        else continue;
                        kind = BbMemberKind.Column;
                        BoundingBoxXYZ bb = fi.get_BoundingBox(null);
                        if (bb == null) continue;
                        f.Extent(bb, out XYZ a, out XYZ b);
                        if (isSection && (a.Z > 1e-3 || b.Z < -1e-3)) continue;
                        double overlap = Math.Max(0, Math.Min(b.X, mx.X) - Math.Max(a.X, mn.X)) * Math.Max(0, Math.Min(b.Y, mx.Y) - Math.Max(a.Y, mn.Y));
                        score = overlap;
                    }
                    if (score <= 0) continue;
                    if (named) score += 1e9;
                    if (score > bestScore)
                    {
                        bestScore = score;
                        best = new BbViewSample { View = v, Kind = kind, IsSection = isSection, Host = fi, Mark = mark, Frame = f, CropMin = mn, CropMax = mx };
                    }
                }
            }
            // Нэрэнд тэмдэггүй, геометрээр л таньсан дэлгээс — дамнуруу/баганын аль нь гэдгийг харагдацын хэлбэрээр (дамнуруу хэвтээ урт, багана босоо).
            if (best != null && bestScore < 1e9 && !best.IsSection)
            {
                double w = mx.X - mn.X, h = mx.Y - mn.Y;
                // Багана: нэрэнд тэмдэггүй босоо харагдац ЖИШЭЭ-1-д голдуу жижиг «Detail 18xx» (55–92 мм цаас) — хэсгийн уртыг 45 мм болгож байсан (хэмжсэн).
                if (best.Kind == BbMemberKind.Column && (learning || w > h * 1.5)) return null;
                if (best.Kind != BbMemberKind.Column && h > w * 1.5) return null;
            }
            return best;
        }

        private static Outline WorldOutline(BbFrame f, XYZ mn, XYZ mx)
        {
            double[] lo = { double.MaxValue, double.MaxValue, double.MaxValue }, hi = { double.MinValue, double.MinValue, double.MinValue };
            for (int i = 0; i < 8; i++)
            {
                XYZ p = f.World((i & 1) == 0 ? mn.X : mx.X, (i & 2) == 0 ? mn.Y : mx.Y, (i & 4) == 0 ? mn.Z : mx.Z);
                lo[0] = Math.Min(lo[0], p.X); lo[1] = Math.Min(lo[1], p.Y); lo[2] = Math.Min(lo[2], p.Z);
                hi[0] = Math.Max(hi[0], p.X); hi[1] = Math.Max(hi[1], p.Y); hi[2] = Math.Max(hi[2], p.Z);
            }
            if (hi[0] - lo[0] < 1e-6 || hi[1] - lo[1] < 1e-6 || hi[2] - lo[2] < 1e-6) return null;
            return new Outline(new XYZ(lo[0], lo[1], lo[2]), new XYZ(hi[0], hi[1], hi[2]));
        }

        // ── Харагдацын тохиргоо, crop ────────────────────────────────────

        private static void ViewSettings(Document doc, BbViewSample v, string k, string prefix, BbSamples s)
        {
            try { s.Str(k + prefix + "ViewType", doc.GetElement(v.View.GetTypeId())?.Name); } catch { }
            try
            {
                ElementId t = v.View.ViewTemplateId;
                s.Str(k + prefix + "Template", t != null && t != ElementId.InvalidElementId ? doc.GetElement(t)?.Name : "");
            }
            catch { }
            s.Num(k + prefix + "Scale", v.View.Scale);
        }

        private static void LearnElevationView(Document doc, BbViewSample v, string k, BbSamples s, Dictionary<string, BbBeamChain> cache)
        {
            ViewSettings(doc, v, k, "Elev", s);
            string pat = BbNames.Pattern(v.View.Name, v.Mark);
            if (pat != null)
            {
                // «… Copy 1» хэсгийн дагаврыг тусад нь
                var m = System.Text.RegularExpressions.Regex.Match(pat, @"^(.*?)(\s+\S*\s*\d+)$");
                if (pat.EndsWith("АРМАТУРЧЛАЛ", StringComparison.Ordinal) || !m.Success) s.Str(k + "ElevNamePattern", pat);
                else
                {
                    s.Str(k + "ElevPartSuffix", BbNames.PartSuffix(pat, m.Groups[1].Value) ?? "");
                }
            }
            BbFrame f = v.Frame;
            List<Element> members = MembersOfMarkInCrop(doc, v);
            if (members.Count == 0) return;
            double r0 = double.MaxValue, r1 = double.MinValue, u0 = double.MaxValue, u1 = double.MinValue, z0 = double.MaxValue, z1 = double.MinValue;
            foreach (Element e in members)
            {
                BoundingBoxXYZ bb = e.get_BoundingBox(null);
                if (bb == null) continue;
                f.Extent(bb, out XYZ a, out XYZ b);
                r0 = Math.Min(r0, a.X); r1 = Math.Max(r1, b.X); u0 = Math.Min(u0, a.Y); u1 = Math.Max(u1, b.Y); z0 = Math.Min(z0, a.Z); z1 = Math.Max(z1, b.Z);
            }
            double sc = Math.Max(1, v.View.Scale);
            if (v.Kind == BbMemberKind.Column)
            {
                // багана: зүүн/баруун = «Below/Above», дээш/доош = «Along»
                s.Num(k + "ElevCropBelowMm", BbGeom.ToMm(r0 - v.CropMin.X));
                s.Num(k + "ElevCropAboveMm", BbGeom.ToMm(v.CropMax.X - r1));
            }
            else
            {
                s.Num(k + "ElevCropBelowMm", BbGeom.ToMm(u0 - v.CropMin.Y));
                s.Num(k + "ElevCropAboveMm", BbGeom.ToMm(v.CropMax.Y - u1));
                // Захын хэсэг: гинжийн эхлэл/төгсгөл crop дотор бол тэр талын нэмэлт.
                if (r0 > v.CropMin.X && r0 < v.CropMax.X) s.Num(k + "ElevCropAlongMm", BbGeom.ToMm(r0 - v.CropMin.X));
                if (r1 > v.CropMin.X && r1 < v.CropMax.X) s.Num(k + "ElevCropAlongMm", BbGeom.ToMm(v.CropMax.X - r1));
            }
            s.Num(k + "ElevPlaneInsideMm", BbGeom.ToMm(z1));
            s.Num(k + "ElevFarBeyondMm", BbGeom.ToMm(z0 - v.CropMin.Z));
            // Хэсгийн урт гишүүний ДАГУУ: дамнуруу — хэвтээ (R), багана — босоо (U).
            s.Num(k + "ElevMaxPartPaperMm", BbGeom.ToMm(v.Kind == BbMemberKind.Column ? v.CropMax.Y - v.CropMin.Y : v.CropMax.X - v.CropMin.X) / sc);
        }

        private static void LearnSectionView(Document doc, BbViewSample v, string k, BbSamples s, Dictionary<string, BbBeamChain> cache)
        {
            ViewSettings(doc, v, k, "Sec", s);
            string pat = BbNames.SectionPattern(v.View.Name, v.Mark);
            if (pat != null) s.Str(k + "SecNamePattern", pat);
            BbFrame f = v.Frame;
            BoundingBoxXYZ bb = v.Host.get_BoundingBox(null);
            if (bb == null) return;
            f.Extent(bb, out XYZ a, out XYZ b);
            s.Num(k + "SecCropSideMm", BbGeom.ToMm(a.X - v.CropMin.X));
            s.Num(k + "SecCropSideMm", BbGeom.ToMm(v.CropMax.X - b.X));
            s.Num(k + "SecCropBelowMm", BbGeom.ToMm(a.Y - v.CropMin.Y));
            s.Num(k + "SecCropAboveMm", BbGeom.ToMm(v.CropMax.Y - b.Y));
            s.Num(k + "SecFarMm", BbGeom.ToMm(-v.CropMin.Z));

            // Огтлолын байрлал алгасалд (зөвхөн дамнуруу).
            if (v.Kind == BbMemberKind.Column) return;
            string key = v.Mark + "|" + v.Host.Id.Value;
            BbBeamChain chain;
            if (!cache.TryGetValue(key, out chain))
            {
                chain = BbGeom.BeamChain(doc, v.Host);
                foreach (FamilyInstance m in chain?.Members ?? new List<FamilyInstance>()) cache[v.Mark + "|" + m.Id.Value] = chain;
                cache[key] = chain;
            }
            if (chain == null) return;
            double st = BbGeom.ToMm(chain.Station(f.O));
            var member = new BbSpan(BbGeom.ToMm(chain.S0), BbGeom.ToMm(chain.S1));
            foreach (BbSpan sp in BbLayoutMath.ClearSpans(member, chain.Supports))
            {
                if (st < sp.A - 1 || st > sp.B + 1) continue;
                double t = (st - sp.A) / Math.Max(1, sp.Length);
                double d = Math.Min(st - sp.A, sp.B - st);
                if (t < 0.35 || t > 0.65)
                {
                    s.Num(k + "SecSupportOffsetMm", d);
                    s.Num(k + "SecSupportRatio", d / Math.Max(1, sp.Length));
                }
                break;
            }
        }

        private static List<Element> MembersOfMarkInCrop(Document doc, BbViewSample v)
        {
            Outline world = WorldOutline(v.Frame, v.CropMin, v.CropMax);
            var res = new List<Element>();
            if (world == null) return res;
            BuiltInCategory cat = v.Kind == BbMemberKind.Column ? BuiltInCategory.OST_StructuralColumns : BuiltInCategory.OST_StructuralFraming;
            foreach (Element e in new FilteredElementCollector(doc).OfCategory(cat).WhereElementIsNotElementType().WherePasses(new BoundingBoxIntersectsFilter(world)))
            {
                if (!string.Equals(BbGeom.Mark(e), v.Mark, StringComparison.Ordinal)) continue;
                BoundingBoxXYZ bb = e.get_BoundingBox(null);
                if (bb == null) continue;
                v.Frame.Extent(bb, out XYZ a, out XYZ b);
                if (b.Z < v.CropMin.Z - 1e-3 || a.Z > 0.1) continue;
                res.Add(e);
            }
            if (res.Count == 0 && v.Host != null) res.Add(v.Host);
            return res;
        }

        // ── Тэмдэглэгээ ─────────────────────────────────────────────────

        [ThreadStatic] private static Dictionary<long, List<Element>> _owned;

        /// <summary>Харагдацын өмчлөлийн тэмдэглэгээ (индекс байвал түүнээс, үгүй бол харагдацын цуглуулгаар).</summary>
        private static IEnumerable<T> Owned<T>(Document doc, View view) where T : Element
        {
            if (_owned != null)
                return _owned.TryGetValue(view.Id.Value, out List<Element> l) ? l.OfType<T>() : Enumerable.Empty<T>();
            return new FilteredElementCollector(doc, view.Id).OfClass(typeof(T)).Cast<T>().Where(e => e.OwnerViewId == view.Id);
        }

        /// <summary>
        /// Огтлолын break line (инженерийн гараар тавьсан): family, crop-ын ойрын зүүн/баруун ирмэгээс зай ба «masking depth extension» (цаасан мм).
        /// Гараар сунгасан masking (ДДН-2 S10: 701.5 мм) медианд нөлөөлөхгүйн тулд ирмэгээс 10 цаасан мм-ээс илүүг алгасна.
        /// </summary>
        private static void LearnBreaks(Document doc, BbViewSample v, string k, BbSamples s)
        {
            View view = v.View;
            double sc = Math.Max(1, view.Scale);
            BoundingBoxXYZ crop = view.CropBox;
            Transform inv = crop.Transform.Inverse;
            foreach (FamilyInstance fi in new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_DetailComponents)
                         .WherePasses(new ElementOwnerViewFilter(view.Id)).OfType<FamilyInstance>())
            {
                if (!BbBreaks.IsBreakFamily(fi) || !(fi.Location is LocationPoint lp)) continue;
                double x = inv.OfPoint(lp.Point).X;
                double inset = BbGeom.ToMm(Math.Min(Math.Abs(x - crop.Min.X), Math.Abs(crop.Max.X - x))) / sc;
                if (inset > 10) continue;
                s.Str(k + "BreakFamily", fi.Symbol.FamilyName);
                s.Num(k + "BreakInsetPaperMm", inset);
                Parameter m = fi.LookupParameter("masking depth extension");
                if (m != null && m.HasValue && m.StorageType == StorageType.Double)
                {
                    double mask = BbGeom.ToMm(m.AsDouble()) / sc;
                    if (mask > 0 && mask < 10) s.Num(k + "BreakMaskPaperMm", mask);
                }
            }
        }

        private static void LearnAnnotations(Document doc, BbViewSample v, string k, BbSamples s, HashSet<long> mraDims, HashSet<long> mraTags)
        {
            View view = v.View;
            BbFrame f = v.Frame;
            double sc = Math.Max(1, view.Scale);
            BoundingBoxXYZ hb = v.Host.get_BoundingBox(null);
            if (hb == null) return;
            f.Extent(hb, out XYZ ha, out XYZ hbx);
            // Гишүүний (бүх ижил тэмдэгтэй хэсгийн) хүрээ харагдацын хавтгайд.
            double r0 = ha.X, r1 = hbx.X, u0 = ha.Y, u1 = hbx.Y;
            // Арматурын ҮЕ-ийг үндсэн гишүүний өндрөөр (гинжийн гүн хэсэг — ЖИШЭЭ-2 ДДН-10-ийн 2067 мм — ангиллыг гажуудуулахгүй).
            double hu0 = ha.Y, hu1 = hbx.Y;
            bool anyLap = false, nonTopLap = false, gridChain = false, gridTwo = false, stirrupGap = false, gridAny = false, topChain = false;
            if (!v.IsSection)
            {
                foreach (Element e in MembersOfMarkInCrop(doc, v))
                {
                    BoundingBoxXYZ bb = e.get_BoundingBox(null);
                    if (bb == null) continue;
                    f.Extent(bb, out XYZ a, out XYZ b);
                    r0 = Math.Min(r0, a.X); r1 = Math.Max(r1, b.X); u0 = Math.Min(u0, a.Y); u1 = Math.Max(u1, b.Y);
                }
            }
            bool column = v.Kind == BbMemberKind.Column;
            // Дэлгээсэд «гишүүний дагуу» тэнхлэг: дамнуруу = R, багана = U.  «Гадна» зай = гишүүний хажуу нүүрнээс.
            var rowOffsets = new Dictionary<string, List<double>>(StringComparer.Ordinal);
            foreach (Dimension d in Owned<Dimension>(doc, view))
            {
                if (d.OwnerViewId != view.Id) continue;
                if (d is SpotDimension) continue;
                try { s.Str(k + "DimType", d.DimensionType?.Name); } catch { }
                Line line;
                try { line = d.Curve as Line; } catch { line = null; }
                if (line == null) continue;
                XYZ dir = line.Direction;
                double dr = Math.Abs(dir.DotProduct(f.R)), du = Math.Abs(dir.DotProduct(f.U));
                XYZ o = f.Local(line.Origin);
                bool hasRebar = false, hasStdBar = false;
                var refBars = new List<Rebar>();
                int grids = 0, others = 0, stirrupRefs = 0, colRefs = 0;
                try
                {
                    foreach (Reference rf in d.References)
                    {
                        Element re = doc.GetElement(rf.ElementId);
                        if (re is Rebar rb)
                        {
                            hasRebar = true;
                            if (!refBars.Any(x => x.Id == rb.Id)) refBars.Add(rb);
                            try
                            {
                                RebarStyle style = (doc.GetElement(rb.GetShapeId()) as RebarShape)?.RebarStyle ?? RebarStyle.Standard;
                                if (style == RebarStyle.Standard) hasStdBar = true;
                                else stirrupRefs++;
                            }
                            catch { }
                        }
                        else if (re is Grid) grids++;
                        else if (re?.Category != null && re.Category.Id.Value == (long)BuiltInCategory.OST_StructuralColumns) colRefs++;
                        else others++;
                    }
                }
                catch { }
                bool inMra = mraDims.Contains(d.Id.Value);
                if (!v.IsSection && !column && !inMra)
                {
                    // Хомутын эгнээний бүс хоорондын хэмжээс: зөвхөн хомут (+ баганын нүүр) — «хомут | хомут», «хомут | нүүр | нүүр | хомут».
                    if (stirrupRefs > 0 && !hasStdBar && grids == 0 && others == 0) stirrupGap = true;
                    // Дээд үеийн гинж: тэнхлэг + ажлын арматурын үзүүр (+ дамнурууны төгсгөл) нэг хэмжээсэнд.
                    if (grids > 0) gridAny = true;
                    if (grids > 0 && hasStdBar && stirrupRefs == 0) topChain = true;
                    others += colRefs;
                    // Давхцал = хоёр ажлын арматурын хэмжээс; тэнхлэгийн гинж = зөвхөн тэнхлэгүүд (2 = нийт урт, 3+ = гинж).
                    if (refBars.Count == 2 && grids == 0 && others == 0 && hasStdBar)
                    {
                        anyLap = true;
                        if (refBars.Any(b => BbElevRules.Layer(b, f, hu0, hu1) != BbBarRole.Top)) nonTopLap = true;
                    }
                    if (refBars.Count == 0 && others == 0 && grids >= 2)
                    {
                        if (grids == 2) gridTwo = true;
                        else gridChain = true;
                    }
                }
                if (!v.IsSection)
                {
                    bool along = column ? du > 0.99 : dr > 0.99;
                    if (!along) continue;
                    double pos = column ? o.X : o.Y;
                    double lo = column ? r0 : u0, hi = column ? r1 : u1;
                    string side = pos < lo ? "lo" : pos > hi ? "hi" : "in";
                    if (side == "in") continue;
                    double off = BbGeom.ToMm(side == "lo" ? lo - pos : pos - hi) / sc;
                    if (inMra) { s.Num(k + "StirrupDimOffsetPaperMm", off); continue; }
                    string key = side;
                    if (!rowOffsets.TryGetValue(key, out var l)) rowOffsets[key] = l = new List<double>();
                    l.Add(off);
                }
                else
                {
                    bool horiz = dr > 0.99, vert = du > 0.99;
                    if (!horiz && !vert) continue;
                    string side;
                    double off;
                    if (horiz)
                    {
                        if (o.Y < u0) { side = "bottom"; off = u0 - o.Y; }
                        else if (o.Y > u1) { side = "top"; off = o.Y - u1; }
                        else continue;
                    }
                    else
                    {
                        if (o.X < r0) { side = "left"; off = r0 - o.X; }
                        else if (o.X > r1) { side = "right"; off = o.X - r1; }
                        else continue;
                    }
                    off = BbGeom.ToMm(off) / sc;
                    if (hasRebar)
                    {
                        s.Num(k + "SecDimOffsetPaperMm", off);
                        if (vert) s.Bool(k + "SecRightSide", side == "right");
                        s.Bool(k + "SecBarChain", hasStdBar);
                        if (!rowOffsets.TryGetValue("chain:" + side, out var l)) rowOffsets["chain:" + side] = l = new List<double>();
                        l.Add(off);
                    }
                    else
                    {
                        if (!rowOffsets.TryGetValue("member:" + side, out var l)) rowOffsets["member:" + side] = l = new List<double>();
                        l.Add(off);
                    }
                }
            }
            if (!v.IsSection && !column)
            {
                if (anyLap) s.Bool(k + "ElevLapsTopOnly", !nonTopLap);
                if (gridChain) s.Bool(k + "ElevSpanTotal", gridTwo);
                if (gridAny) s.Bool(k + "ElevTopChain", topChain);
                if (Owned<MultiReferenceAnnotation>(doc, view).Any(m => m.OwnerViewId == view.Id)) s.Bool(k + "ElevStirrupGaps", stirrupGap);
            }
            if (!v.IsSection)
            {
                foreach (var kv in rowOffsets)
                {
                    List<double> rows = Distinct(kv.Value, 2.0);
                    if (rows.Count == 0) continue;
                    s.Num(k + "ElevDimFirstPaperMm", rows[0]);
                    for (int i = 1; i < rows.Count; i++) if (rows[i] - rows[i - 1] < 20) s.Num(k + "DimPitchPaperMm", rows[i] - rows[i - 1]);
                }
            }
            else
            {
                foreach (string side in new[] { "bottom", "top", "left", "right" })
                {
                    if (!rowOffsets.TryGetValue("chain:" + side, out var c) || !rowOffsets.TryGetValue("member:" + side, out var m)) continue;
                    double step = m.Min() - c.Min();
                    if (step > 1 && step < 30) s.Num(k + "SecStepPaperMm", step);
                }
                bool both = (rowOffsets.ContainsKey("chain:left") && rowOffsets.ContainsKey("chain:right")) || (rowOffsets.ContainsKey("chain:top") && rowOffsets.ContainsKey("chain:bottom"));
                s.Bool(k + "SecAllSides", both);
            }

            foreach (IndependentTag t in Owned<IndependentTag>(doc, view))
            {
                if (t.OwnerViewId != view.Id) continue;
                string typeName = null;
                try
                {
                    var et = doc.GetElement(t.GetTypeId()) as ElementType;
                    typeName = et == null ? null : et.FamilyName + " : " + et.Name;
                }
                catch { }
                bool stirrup = false, isRebar = false;
                Rebar taggedBar = null;
                try
                {
                    foreach (ElementId id in t.GetTaggedLocalElementIds())
                    {
                        if (doc.GetElement(id) is Rebar rb)
                        {
                            isRebar = true;
                            taggedBar = taggedBar ?? rb;
                            try { if ((doc.GetElement(rb.GetShapeId()) as RebarShape)?.RebarStyle == RebarStyle.StirrupTie) stirrup = true; } catch { }
                        }
                    }
                }
                catch { }
                if (!isRebar) continue;
                if (mraTags.Contains(t.Id.Value)) continue;
                s.Str(k + (stirrup ? "StirrupTagType" : "BarTagType"), typeName);
                XYZ head;
                try { head = f.Local(t.TagHeadPosition); } catch { continue; }
                double off;
                if (!v.IsSection)
                {
                    // Бөөрний арматурын шошго: дамнурууны ДОТОР (дунд өндөрт — ЖИШЭЭ-1) эсвэл гадна (доод шошготой нэг эгнээнд — ЖИШЭЭ-2).
                    if (!column && !stirrup && taggedBar != null && BbElevRules.Layer(taggedBar, f, hu0, hu1) == BbBarRole.Side)
                        s.Bool(k + "ElevSideTags", head.Y > hu0 && head.Y < hu1);
                    double pos = column ? head.X : head.Y, lo = column ? r0 : u0, hi = column ? r1 : u1;
                    if (pos >= lo && pos <= hi) continue;
                    off = BbGeom.ToMm(pos < lo ? lo - pos : pos - hi) / sc;
                    s.Num(k + "TagOffsetPaperMm", off);
                }
                else
                {
                    double dx = head.X < r0 ? r0 - head.X : head.X > r1 ? head.X - r1 : 0;
                    double dy = head.Y < u0 ? u0 - head.Y : head.Y > u1 ? head.Y - u1 : 0;
                    off = BbGeom.ToMm(Math.Max(dx, dy)) / sc;
                    if (off > 0) s.Num(k + "SecTagOutPaperMm", off);
                    if (!stirrup) LearnLeader(t, f, head, sc, k, s);
                }
            }
            foreach (MultiReferenceAnnotation m in Owned<MultiReferenceAnnotation>(doc, view))
            {
                if (m.OwnerViewId != view.Id) continue;
                try { s.Str(k + "MraType", doc.GetElement(m.GetTypeId())?.Name); } catch { }
            }
        }

        /// <summary>
        /// Огтлолын ажлын арматурын шошгоны leader: 3→2 = толгойноос хугарал (elbow) хүртэл, 2→1 = хугарлаас арматур хүртэл — ХЭВТЭЭ зай, цаасны мм
        /// (хөдөлгүүрийн <c>LeaderLandingMm / LeaderRunMm</c>).  Хугаралгүй / Attached төгсгөлтэй leader-ийг алгасна.
        /// </summary>
        private static void LearnLeader(IndependentTag t, BbFrame f, XYZ head, double sc, string k, BbSamples s)
        {
            try
            {
                if (!t.HasLeader || t.LeaderEndCondition != LeaderEndCondition.Free) return;
                foreach (Reference r in t.GetTaggedReferences())
                {
                    if (!t.HasLeaderElbow(r)) continue;
                    XYZ elbow = f.Local(t.GetLeaderElbow(r)), end = f.Local(t.GetLeaderEnd(r));
                    double landing = BbGeom.ToMm(Math.Abs(head.X - elbow.X)) / sc, run = BbGeom.ToMm(Math.Abs(elbow.X - end.X)) / sc;
                    if (landing > 0.5 && landing < 60) s.Num(k + "SecLeaderLandingPaperMm", landing);
                    if (run > 0.5 && run < 60) s.Num(k + "SecLeaderRunPaperMm", run);
                }
            }
            catch { }
        }

        private static List<double> Distinct(IEnumerable<double> xs, double tol)
        {
            var res = new List<double>();
            foreach (double x in xs.OrderBy(x => x))
            {
                if (res.Count == 0 || x - res[res.Count - 1] > tol) res.Add(x);
            }
            return res;
        }

        // ── Хана, хучилт ────────────────────────────────────────────────

        private static readonly System.Text.RegularExpressions.Regex WallView =
            new System.Text.RegularExpressions.Regex(@"^(?<pre>.*?ХАНА\s+)(?<mark>\S+)\s+(?<kind>ХЭВ|АРМАТУРЧЛАЛ)$", System.Text.RegularExpressions.RegexOptions.CultureInvariant);
        private static readonly System.Text.RegularExpressions.Regex SlabView =
            new System.Text.RegularExpressions.Regex(@"^(?<lvl>[-+]?\d+[.,]\d+)\s+(?<rest>ТҮВШНИЙ ХУЧИЛТЫН .*?(?<kind>ХЭВНИЙ БАЙГУУЛАЛТ|ДООД ҮЕИЙН АРМАТУРЧЛАЛ|ДЭЭД ҮЕИЙН АРМАТУРЧЛАЛ))$", System.Text.RegularExpressions.RegexOptions.CultureInvariant);

        /// <summary>
        /// Хуудсанд байрласан ХАНА («ЦУТГАМАЛ ХАНА ЦХ-1 ХЭВ / АРМАТУРЧЛАЛ») ба ХУЧИЛТЫН («4.93 ТҮВШНИЙ ХУЧИЛТЫН ХЭВНИЙ БАЙГУУЛАЛТ / ДООД / ДЭЭД ҮЕИЙН
        /// АРМАТУРЧЛАЛ») харагдацаас төрөл, загвар, масштаб, MRA-ийн төрлийг сурна.  Нэрийн тэмдэг нь загварт бодит хана байх ёстой.
        /// </summary>
        private static void LearnPlates(Document doc, BbSamples s, BbLearnReport rep, ISet<long> only)
        {
            var wallMarks = new HashSet<string>(new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Walls).WhereElementIsNotElementType()
                .Select(BbGeom.Mark).Where(m => m.Length > 0), StringComparer.Ordinal);
            var placed = new HashSet<long>();
            foreach (Viewport vp in new FilteredElementCollector(doc).OfClass(typeof(Viewport)).Cast<Viewport>()) placed.Add(vp.ViewId.Value);
            var mraByView = new Dictionary<long, List<MultiReferenceAnnotation>>();
            foreach (MultiReferenceAnnotation m in new FilteredElementCollector(doc).OfClass(typeof(MultiReferenceAnnotation)).Cast<MultiReferenceAnnotation>())
            {
                if (!mraByView.TryGetValue(m.OwnerViewId.Value, out var l)) mraByView[m.OwnerViewId.Value] = l = new List<MultiReferenceAnnotation>();
                l.Add(m);
            }
            int walls = 0, slabs = 0;
            foreach (View v in new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>())
            {
                if (only == null && !placed.Contains(v.Id.Value)) continue;
                if (!Learnable(v, only)) continue;
                string name = v.Name ?? "";
                string prefix, field;
                var wm = WallView.Match(name);
                var sm = wm.Success ? System.Text.RegularExpressions.Match.Empty : SlabView.Match(name);
                if (wm.Success && v is ViewSection && wallMarks.Contains(wm.Groups["mark"].Value))
                {
                    bool form = wm.Groups["kind"].Value == "ХЭВ";
                    prefix = form ? "Form" : "Rebar";
                    s.Str("plate.Wall" + prefix + "Name", wm.Groups["pre"].Value + "{mark} " + wm.Groups["kind"].Value);
                    field = "plate.Wall" + prefix;
                    walls++;
                }
                else if (sm.Success && v is ViewPlan)
                {
                    string kind = sm.Groups["kind"].Value;
                    prefix = kind.StartsWith("ХЭВ", StringComparison.Ordinal) ? "Form" : kind.StartsWith("ДООД", StringComparison.Ordinal) ? "Bottom" : "Top";
                    s.Str("plate.Slab" + prefix + "Name", "{level} " + sm.Groups["rest"].Value);
                    s.Num("plate.SlabScale", v.Scale);
                    field = "plate.Slab" + prefix;
                    slabs++;
                }
                else continue;
                try { s.Str(field + "ViewType", doc.GetElement(v.GetTypeId())?.Name); } catch { }
                try
                {
                    ElementId t = v.ViewTemplateId;
                    if (t != null && t != ElementId.InvalidElementId) s.Str(field + "Template", doc.GetElement(t)?.Name);
                }
                catch { }
                if (prefix == "Form" && field.StartsWith("plate.Wall", StringComparison.Ordinal)) continue;
                if (!mraByView.TryGetValue(v.Id.Value, out var mras)) continue;
                bool slab = field.StartsWith("plate.Slab", StringComparison.Ordinal);
                foreach (MultiReferenceAnnotation m in mras)
                {
                    try { s.Str(slab ? "plate.SlabMraType" : "plate.WallMraType", doc.GetElement(m.GetTypeId())?.Name); } catch { }
                    try { s.Str(slab ? "plate.SlabMraDimType" : "plate.WallMraDimType", (doc.GetElement(m.DimensionId) as Dimension)?.DimensionType?.Name); } catch { }
                }
            }
            rep.PerKind["Wall.elev"] = walls;
            rep.PerKind["Slab.plan"] = slabs;
        }

        // ── Хуудас ──────────────────────────────────────────────────────

        private static void LearnSheets(Document doc, List<BbViewSample> used, BbSamples s)
        {
            // Хуудсан доторх цуглуулга (FilteredElementCollector(doc, sheetId)) хуудасны бүх viewport-ыг дахин зурдаг — 60 хуудсанд 14 мин (хэмжсэн).
            var sheets = new Dictionary<string, ViewSheet>(StringComparer.Ordinal);
            foreach (ViewSheet x in new FilteredElementCollector(doc).OfClass(typeof(ViewSheet)).Cast<ViewSheet>())
                if (!sheets.ContainsKey(x.SheetNumber ?? "")) sheets[x.SheetNumber ?? ""] = x;
            var tbBySheet = new Dictionary<long, FamilyInstance>();
            foreach (FamilyInstance tb in new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_TitleBlocks).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>())
                if (!tbBySheet.ContainsKey(tb.OwnerViewId.Value)) tbBySheet[tb.OwnerViewId.Value] = tb;
            // Төрөл бүрээс ≤ 25 хуудас (эхний 60 нь бүгд дамнурууных болж баганын цуврал сурагддаггүй байв).
            foreach (var g in used.GroupBy(x => x.Sheet).GroupBy(gr => gr.First().Kind == BbMemberKind.Column).SelectMany(k => k.Take(25)))
            {
                if (!sheets.TryGetValue(g.Key ?? "", out ViewSheet sh)) continue;
                if (tbBySheet.TryGetValue(sh.Id.Value, out FamilyInstance tb0)) s.Str("sheet.TitleBlock", tb0.Symbol.FamilyName + " : " + tb0.Symbol.Name);
                // Дугаарын цуврал + Project Browser-ийн бүлэглэлтийн параметр (зөвхөн «* …» нэртэй — компанийн browser organization).
                BbMemberKind sk = g.First().Kind;
                string kindField = sk == BbMemberKind.Column ? "Column" : "Beam";
                string prefix = BbSheetSeries.Prefix(sh.SheetNumber);
                if (!string.IsNullOrEmpty(prefix)) s.Str("sheet." + kindField + "SheetPrefix", prefix);
                string prm = BbSheetSeries.BrowserParams(sh);
                if (!string.IsNullOrEmpty(prm)) s.Str("sheet." + kindField + "SheetParams", prm);
                foreach (BbViewSample v in g)
                {
                    if (v.IsSection) s.Str("sheet.SecViewportType", v.ViewportType);
                    else if (BbNames.Pattern(v.View.Name, v.Mark)?.EndsWith("АРМАТУРЧЛАЛ", StringComparison.Ordinal) == true) s.Str("sheet.ElevViewportType", v.ViewportType);
                    else s.Str("sheet.ElevPartViewportType", v.ViewportType);
                }
            }
        }
    }
}
