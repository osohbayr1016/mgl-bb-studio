using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using MglBb.Core;

namespace MglBb.RevitSide
{
    /// <summary>Хэрэглэгчийн сонголт (цонх / gate).</summary>
    internal sealed class BbGenOptions
    {
        public bool Elevation = true;
        public bool Sections = true;
        /// <summary>auto = стандарт (тулгуур + дунд, давтагдсаныг хасах) · all = алгасал бүрд 3 · mid = зөвхөн дунд · supports = зөвхөн тулгуур.</summary>
        public string SectionMode = "auto";
        public bool Annotate = true;
        public bool PlaceOnSheet = false;
        /// <summary>Нэрийн ард нэмэх (туршилтад — инженерийн зурагтай давхцахгүй).  Хоосон = стандартын нэр.</summary>
        public string NameSuffix = "";
        /// <summary>Аль хэдийн ижил нэртэй харагдац байвал: skip | new (нэрийн ард (2)).</summary>
        public string Existing = "skip";
    }

    internal sealed class BbGenResult
    {
        public string Mark = "";
        public BbMemberKind Kind;
        public readonly List<ViewSection> Elevations = new List<ViewSection>();
        public readonly List<ViewSection> Sections = new List<ViewSection>();
        /// <summary>Хучилтын төлөвлөгөө (хуудас бүрд нэг).</summary>
        public readonly List<View> Plans = new List<View>();
        public readonly List<double> Stations = new List<double>();
        public readonly List<string> Notes = new List<string>();
        public readonly List<BbIssue> Issues = new List<BbIssue>();
        public int SkippedDuplicates;
    }

    /// <summary>
    /// Дамнурууны (гинжийн) дэлгээс + огтлолыг СТАНДАРТААР үүсгэнэ: компанийн харагдацын төрөл (ViewFamilyType) + загвар (view template),
    /// масштаб, crop-ын нэмэлт, харагдацын хавтгай/гүн, урт бол хэсэглэх (тулгуурын голоор, давхцалтай), огтлолыг тулгуур/дунд хэсэгт
    /// давтагдашгүй арматурын тохиргоогоор.  Нээлттэй Transaction дотор дуудна.
    /// </summary>
    internal static class BbViews
    {
        public static BbGenResult CreateBeam(Document doc, BbBeamChain chain, BbStandard std, BbGenOptions opt)
        {
            BbMemberKind kind = chain.Aux ? BbMemberKind.BeamAux : BbMemberKind.Beam;
            BbMemberStandard ms = std.For(kind);
            var res = new BbGenResult { Mark = chain.Mark, Kind = kind };
            string mark = string.IsNullOrEmpty(chain.Mark) ? "#" + chain.Members[0].Id.Value : chain.Mark;

            // ── Дэлгээс
            if (opt.Elevation)
            {
                // Энэ гишүүнд байх ёстой ч өөр элементэд хостлогдсон арматур дэлгээсэд нуугдана (ЖИШЭЭ-5 ТДН-4) — анхааруулна.
                try
                {
                    var mine = new HashSet<long>(chain.Members.Select(m => m.Id.Value));
                    int wrong = BbRebarHost.Find(doc, chain.Members.Cast<Element>().ToList(), out int _, out int _).Count(f => mine.Contains(f.To.Id.Value));
                    if (wrong > 0)
                        res.Issues.Add(Issue(mark, BbSeverity.Warning, wrong + " арматур энэ гишүүнд байрлаж байгаа ч өөр элементэд хостлогдсон тул дэлгээсэд харагдахгүй.",
                            "«Арматур» самбарын «Хост засах»-аар засаад дэлгээсийг дахин үүсгэх.", "host"));
                }
                catch { }

                List<string> want = BbCompanyRules.ElevViewTypes(kind, ms);
                ViewFamilyType vft = BbGeom.FindVft(doc, want, ViewFamily.Detail, out bool matched);
                if (vft == null) throw new InvalidOperationException("«Detail View» төрөл энэ төсөлд алга.");
                if (!matched && want.Count > 0)
                    res.Issues.Add(Issue(mark, BbSeverity.Warning, "Стандартын дэлгээсийн төрөл «" + want[0] + "» энэ төсөлд алга — «" + vft.Name + "»-ээр үүсгэв.  Төсөлд: " + BbGeom.DetailTypeNames(doc) + ".",
                        "Компанийн template-ээс тэр төрлийг (Transfer Project Standards) оруулах.", "elev-vft"));
                View template = BbGeom.FindTemplate(doc, ms.ElevTemplate);
                if (template == null && !string.IsNullOrEmpty(ms.ElevTemplate))
                    res.Issues.Add(Issue(mark, BbSeverity.Warning, "Харагдацын загвар «" + ms.ElevTemplate + "» алга — загваргүй үүсгэв (VG-г шалгана уу).",
                        "Компанийн template-ээс тэр view template-ийг оруулах.", "elev-tpl"));

                XYZ R = chain.Axis, U = XYZ.BasisZ, V = R.CrossProduct(U).Normalize();
                double along = BbGeom.Ft(ms.ElevCropAlongMm), below = BbGeom.Ft(ms.ElevCropBelowMm), above = BbGeom.Ft(ms.ElevCropAboveMm);
                double planeV = chain.Near - BbGeom.Ft(ms.ElevPlaneInsideMm);
                double depth = Math.Max(BbGeom.Ft(50), planeV - chain.Far + BbGeom.Ft(ms.ElevFarBeyondMm));
                var extent = new BbSpan(BbGeom.ToMm(chain.S0 - along), BbGeom.ToMm(chain.S1 + along));
                double maxLenMm = Math.Min(ms.ElevMaxPartPaperMm, 480) * Math.Max(1, ms.ElevScale);   // A2-ын өргөнд (566 мм − тэмдэглэгээ)
                List<BbSpan> parts = BbLayoutMath.SplitParts(extent, chain.Supports, maxLenMm, ms.ElevOverlapMm);
                if (parts.Count > 1) res.Notes.Add(mark + ": дэлгээс " + parts.Count + " хэсэгт (урт " + (extent.Length / 1000).ToString("0.0", CultureInfo.InvariantCulture) + " м, 1:" + ms.ElevScale + ")");
                for (int i = 0; i < parts.Count; i++)
                {
                    BbSpan p = parts[i];
                    string name = ms.ElevName(mark, i + 1) + opt.NameSuffix;
                    if (Exists(doc, name) && opt.Existing == "skip")
                    {
                        res.Notes.Add("«" + name + "» аль хэдийн байгаа — алгасав.");
                        continue;
                    }
                    double r0 = BbGeom.Ft(p.A), r1 = BbGeom.Ft(p.B);
                    // Хүрээний эх: тэнхлэгийн дагуу хэсгийн дунд, өндрөөр гишүүний дунд, гүнээр харагдацын хавтгай дээр
                    // (chain.Near/Far нь chain.Origin-оос V тэнхлэгийн дагуу).
                    XYZ basePt = chain.Origin + R * ((r0 + r1) / 2) + V * planeV;
                    XYZ o = new XYZ(basePt.X, basePt.Y, (chain.Bottom + chain.Top) / 2);
                    double hw = (r1 - r0) / 2, hd = (chain.Top - chain.Bottom) / 2;
                    ViewSection v = CreateDetail(doc, vft, o, R, U, V, -hw, hw, -hd - below, hd + above, depth, res, mark);
                    if (v == null) continue;
                    Configure(doc, v, template, ms.ElevScale, depth, BbGeom.UniqueViewName(doc, name), res, mark);
                    int hidden = HideForeignRebar(doc, v, chain.Members.Select(m => m.Id.Value));
                    if (hidden > 0) res.Notes.Add("«" + v.Name + "»: энэ дамнуруунд хамааралгүй " + hidden + " арматурыг нуув.");
                    res.Elevations.Add(v);
                }
            }

            // ── Огтлол
            if (opt.Sections)
            {
                List<string> want = BbCompanyRules.SecViewTypes(kind, ms);
                ViewFamilyType vft = BbGeom.FindVft(doc, want, ViewFamily.Detail, out bool matched);
                if (vft != null && !matched)
                    res.Issues.Add(Issue(mark, BbSeverity.Warning, "Стандартын огтлолын төрөл «" + want[0] + "» энэ төсөлд алга — «" + vft.Name + "»-ээр үүсгэв.  Төсөлд: " + BbGeom.DetailTypeNames(doc) + ".",
                        "Компанийн template-ээс тэр төрлийг (Transfer Project Standards) оруулах.", "sec-vft"));
                View template = BbGeom.FindTemplate(doc, ms.SecTemplate);
                var member =new BbSpan(BbGeom.ToMm(chain.S0), BbGeom.ToMm(chain.S1));
                List<BbSpan> spans = BbLayoutMath.ClearSpans(member, chain.Supports);
                bool atSup = opt.SectionMode != "mid", atMid = opt.SectionMode != "supports";
                List<double> stations = BbLayoutMath.SectionStations(member, spans, chain.Supports, ms.SecSupportOffsetMm, ms.SecSupportRatio, atSup, atMid, ms.SecMinGapMm,
                    rightOnlyLast: opt.SectionMode == "auto");
                if (opt.SectionMode == "auto" && ms.SecSkipDuplicates)
                {
                    BbRebarSig sig = BbRebarSig.Of(doc, chain);
                    var seen = new HashSet<string>(StringComparer.Ordinal);
                    var keep = new List<double>();
                    foreach (double st in stations)
                    {
                        string g = sig.At(st);
                        if (g.Length == 0) continue;
                        if (seen.Add(g)) keep.Add(st);
                        else res.SkippedDuplicates++;
                    }
                    if (keep.Count == 0 && stations.Count > 0) keep.Add(stations[0]);
                    stations = keep;
                }
                res.Stations.AddRange(stations);
                int n = 0;
                foreach (double st in stations)
                {
                    n++;
                    string name = ms.SecName(mark, n) + opt.NameSuffix;
                    if (Exists(doc, name) && opt.Existing == "skip")
                    {
                        res.Notes.Add("«" + name + "» аль хэдийн байгаа — алгасав.");
                        continue;
                    }
                    XYZ V = chain.Axis.Negate();            // харагч гинжийн ЭХЭНД зогсож төгсгөл рүү харна (ЖИШЭЭ-1: 479/688)
                    XYZ U = XYZ.BasisZ, R = U.CrossProduct(V).Normalize();
                    XYZ onAxis = chain.Origin + chain.Axis * BbGeom.Ft(st);
                    FamilyInstance host = HostAt(chain, BbGeom.Ft(st)) ?? chain.Members[0];
                    BoundingBoxXYZ hb = host.get_BoundingBox(null);
                    var f = new BbFrame { O = new XYZ(onAxis.X, onAxis.Y, (chain.Bottom + chain.Top) / 2), R = R, U = U, V = V };
                    f.Extent(hb, out XYZ a, out XYZ b);
                    // Crop: ЭНЭ гишүүний нүүрнээс бүх талдаа ижил зай (дээд/доод = хажуугийнх — BbCompanyRules) — ББ инженерийн шаардлага 2026-10-21.
                    // Огтлолын тэмдгийн төлөө crop-ыг ТОМРУУЛАХГҮЙ: Revit тэмдгийн шугамыг crop-оор, толгойг crop-ын ирмэгээс family-ийн тогтмол
                    // зайд зурдаг (Revit 2027-д хэмжсэн: crop-ыг өөрчлөхөд тэмдэг дагадаг, толгой ирмэгээс ≈ 1057 мм / 1:50) — тэр зай бол «crop-оос».
                    double side = BbGeom.Ft(ms.SecCropSideMm);
                    double u0 = a.Y - BbGeom.Ft(ms.SecCropBelowMm), u1 = b.Y + BbGeom.Ft(ms.SecCropAboveMm);
                    ViewSection v = CreateDetail(doc, vft, f.O, R, U, V, a.X - side, b.X + side, u0, u1, BbGeom.Ft(ms.SecFarMm), res, mark);
                    if (v == null) continue;
                    Configure(doc, v, template, ms.SecScale, BbGeom.Ft(ms.SecFarMm), BbGeom.UniqueViewName(doc, name), res, mark);
                    res.Sections.Add(v);
                }
                if (stations.Count == 0)
                    res.Issues.Add(Issue(mark, BbSeverity.Warning, "Огтлолын байрлал олдсонгүй (тулгуур/арматур танигдсангүй).", "Огтлолыг гараар тавих эсвэл «алгасал бүрд» горимоор дахин.", "sec-none"));
            }
            return res;
        }

        private static FamilyInstance HostAt(BbBeamChain chain, double stFt)
        {
            foreach (FamilyInstance m in chain.Members)
            {
                if (!BbGeom.LineOf(m, out XYZ p0, out XYZ p1)) continue;
                double a = chain.Station(p0), b = chain.Station(p1);
                if (stFt >= Math.Min(a, b) - 0.01 && stFt <= Math.Max(a, b) + 0.01) return m;
            }
            return null;
        }

        private static bool Exists(Document doc, string name)
        {
            return new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>().Any(v => !v.IsTemplate && v.Name == name);
        }

        /// <summary>
        /// Дэлгээсэд харагдах, хост нь <paramref name="hostIds"/>-д БАЙХГҮЙ арматурыг (хөндлөн дамнуруу, багана, хучилт, бүлгийн арматур) ЭНЭ
        /// харагдацад нууна (ББ инженерийн шаардлага 2026-10-21).  Буцаах: нуусан тоо.
        /// </summary>
        internal static int HideForeignRebar(Document doc, View view, IEnumerable<long> hostIds)
        {
            var mine = new HashSet<long>(hostIds);
            var hide = new List<ElementId>();
            doc.Regenerate();
            foreach (Element e in new FilteredElementCollector(doc, view.Id).WherePasses(new ElementMulticlassFilter(new List<Type> { typeof(Rebar), typeof(RebarInSystem) })))
            {
                try
                {
                    ElementId host = e is Rebar r ? r.GetHostId() : ((RebarInSystem)e).GetHostId();
                    if (!mine.Contains(host.Value) && e.CanBeHidden(view)) hide.Add(e.Id);
                }
                catch { }
            }
            if (hide.Count == 0) return 0;
            try { view.HideElements(hide); return hide.Count; } catch { return 0; }
        }

        /// <summary>
        /// Detail харагдац: хүрээ (R, U, V — V харагч руу), хавтгай = <paramref name="o"/>-г дайрсан V-д перпендикуляр хавтгай, crop нь
        /// хавтгай дээрх (r, u) муж, гүн = <paramref name="depth"/>.  Revit-ийн box-ын конвенцийг ТААМАГЛАХГҮЙ: эхлээд (R, U, V)-ээр үүсгээд
        /// бодит RightDirection/ViewDirection-ыг шалгаж, таарахгүй бол (−R, U, −V)-ээр (CloneDrawings-д Revit 2027 дээр хэмжсэн) дахин.
        /// Дараа нь crop-ыг ӨӨРИЙН хүрээнд яг тохируулна.
        /// </summary>
        public static ViewSection CreateDetail(Document doc, ViewFamilyType vft, XYZ o, XYZ R, XYZ U, XYZ V, double r0, double r1, double u0, double u1, double depth,
            BbGenResult res, string mark)
        {
            foreach (int conv in new[] { 0, 1 })
            {
                Transform t = Transform.Identity;
                t.Origin = o;
                t.BasisX = conv == 0 ? R : R.Negate();
                t.BasisY = U;
                t.BasisZ = conv == 0 ? V : V.Negate();
                var box = new BoundingBoxXYZ
                {
                    Transform = t,
                    Min = new XYZ(conv == 0 ? r0 : -r1, u0, conv == 0 ? -depth : 0),
                    Max = new XYZ(conv == 0 ? r1 : -r0, u1, conv == 0 ? 0 : depth),
                };
                ViewSection v = null;
                try { v = ViewSection.CreateDetail(doc, vft.Id, box); }
                catch (Exception ex)
                {
                    res.Notes.Add(mark + ": харагдац үүсгэж чадсангүй (" + ex.Message + ")");
                    return null;
                }
                if (v == null) continue;
                if (v.RightDirection.DotProduct(R) > 0.99 && v.ViewDirection.DotProduct(V) > 0.99)
                {
                    FitCrop(v, o, R, U, V, r0, r1, u0, u1, depth);
                    return v;
                }
                try { doc.Delete(v.Id); } catch { }
            }
            res.Issues.Add(Issue(mark, BbSeverity.Error, "Харагдацын чиглэлийг тохируулж чадсангүй (Revit-ийн section box конвенц).", "Хөгжүүлэгчид мэдэгдэх.", "orient"));
            return null;
        }

        /// <summary>Crop-ыг харагдацын ӨӨРИЙН хүрээнд: хавтгай = o, муж = (r0..r1, u0..u1), гүн = depth.</summary>
        public static void FitCrop(View v, XYZ o, XYZ R, XYZ U, XYZ V, double r0, double r1, double u0, double u1, double depth)
        {
            BoundingBoxXYZ cb = v.CropBox;
            Transform t = cb.Transform;
            // Хүссэн 4 өнцгийг харагдацын хүрээнд буулгана.
            double[] lo = { double.MaxValue, double.MaxValue }, hi = { double.MinValue, double.MinValue };
            foreach (double rr in new[] { r0, r1 })
            {
                foreach (double uu in new[] { u0, u1 })
                {
                    XYZ w = o + R * rr + U * uu;
                    XYZ d = w - t.Origin;
                    double x = d.DotProduct(t.BasisX), y = d.DotProduct(t.BasisY);
                    lo[0] = Math.Min(lo[0], x); lo[1] = Math.Min(lo[1], y); hi[0] = Math.Max(hi[0], x); hi[1] = Math.Max(hi[1], y);
                }
            }
            double zPlane = (o - t.Origin).DotProduct(t.BasisZ);
            cb.Min = new XYZ(lo[0], lo[1], zPlane - depth);
            cb.Max = new XYZ(hi[0], hi[1], zPlane);
            v.CropBoxActive = true;
            v.CropBox = cb;
        }

        internal static void Configure(Document doc, ViewSection v, View template, int scale, double depth, string name, BbGenResult res, string mark)
        {
            BbAnnoStore.MarkGenerated(v);
            try { v.Name = name; }
            catch (Exception ex) { res.Notes.Add(mark + ": нэр «" + name + "» тавигдсангүй (" + ex.Message + ")"); }
            if (template != null)
            {
                try { v.ViewTemplateId = template.Id; }
                catch (Exception ex) { res.Notes.Add(mark + ": загвар тавигдсангүй (" + ex.Message + ")"); }
            }
            try { if (v.Scale != scale) v.Scale = scale; } catch { /* загвар масштабыг удирддаг */ }
            try
            {
                Parameter p = v.get_Parameter(BuiltInParameter.VIEWER_BOUND_OFFSET_FAR);
                if (p != null && !p.IsReadOnly) p.Set(depth);
            }
            catch { }
            try { v.CropBoxActive = true; } catch { }
            BbCrop.AnnotationCropOff(v);
        }

        private static BbIssue Issue(string mark, BbSeverity sev, string problem, string proposal, string code)
        {
            return new BbIssue { Tool = "Ажлын зураг үүсгэх", Severity = sev, Member = mark, Problem = problem, Proposal = proposal, Key = "gen|" + mark + "|" + code };
        }
    }
}
