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
    internal sealed class BbAnnoReport
    {
        public int Views, SecDims, SecMemberDims, SecTags, BarChains, BarChainRefs, ElevTags, ElevMras, ElevLaps, ElevSpans, ElevStirrupDupes, ElevSideTags, Replaced;
        public int Breaks, RoleTags;
        public readonly List<string> Notes = new List<string>();
        public readonly List<BbIssue> Issues = new List<BbIssue>();
    }

    /// <summary>
    /// Сурсан стандартын утгаар ҮНДСЭН plugin-ий арматурын хөдөлгүүрийг (RfSectionService / RfElevationService — линкээр, өөрчлөлтгүй)
    /// ажиллуулна, дараа нь огтлолд «нүүр | хомут | ажлын арматурын төв … | хомут | нүүр» гинжийг (<see cref="BbBarChain"/>) нэмнэ.
    /// ⚠️ Нээлттэй Transaction-гүй үед дуудна (огтлолын үйлчилгээ өөрийн TransactionGroup эзэмшинэ).
    /// </summary>
    internal static class BbAnnotate
    {
        public static void Section(Document doc, ViewSection view, Element host, BbMemberStandard ms, BbAnnoReport rep, string mark)
        {
            RfSectionUi ui = SectionUi(doc, ms, rep, mark);
            RfSectionContext ctx = RfSectionService.Analyze(doc, view, host);
            // Гинжийн арматур ихэнхдээ НЭГ гишүүнд хостлогддог (ЖИШЭЭ-1 ДН-9: ажлын арматур 1-р элементэд, хомут 2-рт) — зүсэгдсэн гишүүний нүүр
            // хэвээр, бусад гишүүний ЭНЭ огтлолд харагдах арматурыг нэгтгэнэ.  Үгүй бол огтлол хэмжээсгүй/шошгогүй гардаг байв.
            IList<Element> hosts = BbGeom.ChainHostsInView(doc, view, host);
            bool isColumn = host.Category != null && host.Category.Id.Value == (long)BuiltInCategory.OST_StructuralColumns;
            foreach (Element other in hosts)
            {
                if (other.Id == host.Id) continue;
                RfSectionContext c2 = RfSectionService.Analyze(doc, view, other);
                double tol = BbGeom.Ft(5);
                // Хоёр гишүүнд ижил байрлалд арматур (залгаас/давхцлын бүс) — нэг цэгт НЭГ л ширхэг (шошго давхардахгүй).  Баганад доод давхрын
                // давхцлын ширхэг эзнийхийн ХАЖУУД (≈ 1 голч) байрладаг (Б-5 S4/S7) — тэр хүрээнд ч давхардал гэж үзнэ.
                double barTol = isColumn ? BbGeom.Ft(45) : tol;
                foreach (RfLongBar b in c2.Input.Longitudinal)
                    if (!ctx.Input.Longitudinal.Any(x => Math.Abs(x.Pos.X - b.Pos.X) < barTol && Math.Abs(x.Pos.Y - b.Pos.Y) < barTol)) ctx.Input.Longitudinal.Add(b);
                // Хомутыг НЭГ гишүүнээс л (өөр гүнд байгаа хоёр гишүүний хомутыг холивол хөдөлгүүр зүүн талд гадна, баруун талд дотор хомутыг
                // сонгож «… | 23 | 128» гэх мэт буруу гинж гаргадаг — ЖИШЭЭ-1 ДН-9 S5).  Зүсэгдсэн гишүүнд хомут байхгүй үед л нөгөөгийнхийг авна.
                if (ctx.Input.Stirrups.Count == 0)
                    foreach (RfBarSample s in c2.Input.Stirrups)
                        if (!ctx.Input.Stirrups.Any(x => SameOutline(x, s, tol))) ctx.Input.Stirrups.Add(s);
                foreach (KeyValuePair<long, Rebar> kv in c2.Rebars) ctx.Rebars[kv.Key] = kv.Value;
            }
            if (hosts.Count > 1)
            {
                // Нэгтгэсний дараа ГАДНА (том) хомут эхэнд — хөдөлгүүрийн «нүүр | хомут» гинж гадна хомутаас (4 салаат хомутын дотор хомутаас биш).
                var sorted = ctx.Input.Stirrups.OrderByDescending(OutlineArea).ToList();
                ctx.Input.Stirrups.Clear();
                ctx.Input.Stirrups.AddRange(sorted);
            }
            RfSectionPlan plan = RfSectionService.Plan(ctx, ui);
            if (plan.Dims.Count + plan.Chains.Count + plan.MemberChains.Count + plan.Tags.Count == 0)
            {
                rep.Issues.Add(Issue(mark, view, BbSeverity.Warning, "Огтлолд тавих хэмжээс/шошго олдсонгүй (" + string.Join(", ", plan.Warnings.Take(2).Select(w => w.ToString())) + ").",
                    "Огтлолд арматур харагдаж байгаа эсэх (VG), хомут бүрэн загварчлагдсан эсэхийг шалгах.", "sec-empty"));
                return;
            }
            if (ms.SecTagsLeft) TagsLeft(plan, ui.ToCore(view));
            RfSectionReport r = RfSectionService.Render(doc, view, ctx, plan, ui);
            rep.Views++;
            rep.SecDims += r.DimsMade;
            rep.SecMemberDims += r.MemberMade;
            rep.SecTags += r.Tags;
            foreach (string f in r.Failures.Take(3)) rep.Issues.Add(Issue(mark, view, BbSeverity.Warning, f, "Хэмжээс/шошгыг гараар нөхөх.", "sec-fail|" + f.GetHashCode()));
            foreach (string n in r.Notes.Take(2)) rep.Notes.Add(mark + " «" + view.Name + "»: " + n);
            if (ms.SecBarChain && r.DimsMade > 0)
            {
                using (var t = new Transaction(doc, "MGL ББ: арматурын гинж"))
                {
                    t.Start();
                    FailureHandlingOptions fho = t.GetFailureHandlingOptions();
                    fho.SetFailuresPreprocessor(new BbSwallowWarnings());
                    t.SetFailureHandlingOptions(fho);
                    int made = BbBarChain.Extend(doc, view, host, hosts, ctx, rep, mark);
                    if (made > 0) t.Commit(); else t.RollBack();
                }
            }
        }

        /// <summary>Дэлгээсийн хостууд: дамнуруу — гинжийн бүх гишүүн; багана — энэ харагдацад арматур нь харагдах давхрууд.</summary>
        public static IList<Element> ElevationHosts(Document doc, View view, BbViewSample smp)
        {
            if (smp.Kind == BbMemberKind.Column) return BbGeom.ChainHostsInView(doc, view, smp.Host);
            BbBeamChain chain = smp.Host is FamilyInstance fi ? BbGeom.BeamChain(doc, fi) : null;
            return chain != null ? chain.Members.Cast<Element>().ToList() : new List<Element> { smp.Host };
        }

        private static double OutlineArea(RfBarSample s)
        {
            if (s.Points.Count == 0) return 0;
            double dx = s.Points.Max(p => p.X) - s.Points.Min(p => p.X), dy = s.Points.Max(p => p.Y) - s.Points.Min(p => p.Y), dz = s.Points.Max(p => p.Z) - s.Points.Min(p => p.Z);
            var d = new[] { dx, dy, dz }.OrderByDescending(x => x).ToArray();
            return d[0] * d[1];
        }

        private static bool SameOutline(RfBarSample a, RfBarSample b, double tol)
        {
            if (a.Points.Count == 0 || b.Points.Count == 0) return false;
            double ax0 = a.Points.Min(p => p.X), ax1 = a.Points.Max(p => p.X), ay0 = a.Points.Min(p => p.Y), ay1 = a.Points.Max(p => p.Y), az0 = a.Points.Min(p => p.Z), az1 = a.Points.Max(p => p.Z);
            double bx0 = b.Points.Min(p => p.X), bx1 = b.Points.Max(p => p.X), by0 = b.Points.Min(p => p.Y), by1 = b.Points.Max(p => p.Y), bz0 = b.Points.Min(p => p.Z), bz1 = b.Points.Max(p => p.Z);
            // Огтлолын хавтгай дахь хүрээ ижил (гүн нь өөр байж болно — хоёр гишүүний хомут огтлолоос өөр зайд).
            int same = 0;
            if (Math.Abs(ax0 - bx0) < tol && Math.Abs(ax1 - bx1) < tol) same++;
            if (Math.Abs(ay0 - by0) < tol && Math.Abs(ay1 - by1) < tol) same++;
            if (Math.Abs(az0 - bz0) < tol && Math.Abs(az1 - bz1) < tol) same++;
            return same >= 2 && Math.Abs(a.Diameter - b.Diameter) < 1e-6;
        }

        public static void Elevation(Document doc, ViewSection view, IList<Element> hosts, BbMemberStandard ms, BbAnnoReport rep, string mark)
        {
            RfElevUi ui = ElevationUi(doc, ms, rep, mark);
            bool committed = false;
            using (var t = new Transaction(doc, "MGL ББ: арматурын дэлгээс"))
            {
                t.Start();
                FailureHandlingOptions fho = t.GetFailureHandlingOptions();
                fho.SetFailuresPreprocessor(new BbSwallowWarnings());
                t.SetFailureHandlingOptions(fho);
                // Өмнөх ажиллагааны тэмдэглэгээ (энэ plugin-ийн бүртгэлээр) — давхардахгүй.
                int removed = BbAnnoStore.DeletePrevious(doc, view);
                if (removed > 0) { doc.Regenerate(); rep.Replaced += removed; }
                HashSet<long> before = BbAnnoStore.Owned(doc, view);
                bool any = false;
                var done = new List<RfElevContext>();
                foreach (RfElevContext ctx in Contexts(doc, view, hosts, ui))
                {
                    // Компанийн загвар: давхар хомутыг нэг болгож, өөр байрлалын ижил дугаартай арматурыг тусад нь шошголно (хөдөлгүүрийн ОРОЛТ).
                    if (!ctx.IsColumn) BbElevMra.FitToView(ctx);
                    rep.ElevStirrupDupes += BbElevMra.DedupeStirrups(ctx);
                    if (ms.ElevTagEachBar) BbElevMra.SplitBarGroups(ctx);
                    RfElevReport r = RfElevationService.Render(ctx, ui);
                    int mras = r.Mras;
                    if (!ctx.IsColumn)
                    {
                        // Инженерийн дүрэм (сурсан): илүүдэл давхцал / нийт уртыг MRA байрлуулахаас ӨМНӨ хасна.
                        BbElevRules.Prune(ctx, r, ms);
                        rep.ElevSideTags += BbElevMra.MidTags(ctx, r, ui, ms, rep);
                        if (ms.ElevMraLayout && r.Mras > 0) mras = BbElevMra.RelayoutMras(ctx, r, ui, ms, rep, mark);
                        // Шошгоны хэвтээ landing + хугарал (сурсан тал/зай).
                        BbElevLeaders.Apply(ctx, r, ms);
                    }
                    done.Add(ctx);
                    rep.ElevTags += r.Tags;
                    rep.ElevMras += mras;
                    rep.ElevLaps += r.Laps;
                    rep.ElevSpans += r.Spans;
                    foreach (string f in r.Failures.Take(3)) rep.Issues.Add(Issue(mark, view, BbSeverity.Warning, f, "Шошго/MRA-г гараар нөхөх.", "elev-fail|" + f.GetHashCode()));
                    foreach (string n in r.Notes.Take(2)) rep.Notes.Add(mark + " «" + view.Name + "»: " + n);
                    if (r.Created.Count > 0) any = true;
                }
                // Хомутын эгнээнд бүс хоорондын / баганын нүүрээс хомут хүртэлх хэмжээс — гинжийн БҮХ гишүүнээр нэг удаа (гишүүн хоорондын баганад ч).
                if (any) rep.ElevSpans += BbElevStirrupDims.Place(doc, view, done, ms, ui.DimTypeId, rep, mark);
                // Дээд үеийн гинж (дамнурууны төгсгөл | тэнхлэг | дээд ажлын арматурын таслах цэг) — давхцлын эгнээнээс нэг алхам дээш.
                Element mainHost = done.Where(c => !c.IsColumn).OrderByDescending(c => c.Input.Stirrups.Count).Select(c => c.Host).FirstOrDefault();
                if (any && mainHost != null) rep.ElevSpans += BbElevTopChain.Place(doc, view, done, mainHost, ms, ui.DimTypeId, rep, mark);
                if (any)
                {
                    BbAnnoStore.Record(doc, view, before);
                    t.Commit();
                    rep.Views++;
                    committed = true;
                }
                // Шинэ тэмдэглэгээ үүсээгүй бол өмнөхийг ч устгахгүй (буруу ангилал/хоосон үр дүн хэрэглэгчийн зургийг арилгахгүй).
                else t.RollBack();
            }
            // Арматурын төгсгөлийн тэмдэг (сурсан) — «Төгсгөлийн тэмдэг» хэрэгсэл өөрөө TransactionGroup нээдэг тул transaction-ий ДАРАА.
            if (committed) BbElevEndSymbols.Apply(doc, view, hosts, ms, rep, mark);
            // Break line: crop-ын ирмэгийг дайрсан дамнуруу (зүүн/баруун) ба багана (дээд/доод) — огтлолын хучилтынхтай ижил family/зай.
            if (committed && hosts.Count > 0 && !(hosts[0].Category?.Id.Value == (long)BuiltInCategory.OST_StructuralColumns)) BbBreaks.Elevation(doc, view, ms, rep, mark);
        }

        /// <summary>
        /// Хөдөлгүүр гишүүн бүрийг тусад нь уншдаг.  Баганын дэлгээсийн нэг хэсэгт ОЛОН давхрын багана харагддаг (ЖИШЭЭ-1: давхар бүр тусдаа
        /// элемент) — тусад нь уншвал түвшний гинж «дайрсан түвшин 1» болж, давхцал/алхмын хэмжээс зөвхөн нэг давхарт гардаг байв (Б-5: 7 хэсгийн 1-д л).
        /// Тиймээс баганын давхруудыг НЭГ контекст болгоно: хүрээ = нэгдэл, арматур/хомут/лавлагаа нэмэгдэнэ (Host-ыг Analyze л хэрэглэдэг).
        /// </summary>
        private static IEnumerable<RfElevContext> Contexts(Document doc, ViewSection view, IList<Element> hosts, RfElevUi ui)
        {
            RfElevContext merged = null;
            foreach (Element h in hosts)
            {
                if (!RfElevationService.IsElevationHost(view, h)) continue;
                RfElevContext ctx = RfElevationService.Analyze(doc, view, h, ui);
                if (!ctx.IsColumn) { yield return ctx; continue; }
                if (merged == null) { merged = ctx; continue; }
                RfElevInput a = merged.Input, b = ctx.Input;
                if (b.BeamU0 < b.BeamU1)
                {
                    if (a.BeamU0 >= a.BeamU1) { a.BeamU0 = b.BeamU0; a.BeamU1 = b.BeamU1; a.BeamV0 = b.BeamV0; a.BeamV1 = b.BeamV1; }
                    else
                    {
                        a.BeamU0 = Math.Min(a.BeamU0, b.BeamU0); a.BeamU1 = Math.Max(a.BeamU1, b.BeamU1);
                        a.BeamV0 = Math.Min(a.BeamV0, b.BeamV0); a.BeamV1 = Math.Max(a.BeamV1, b.BeamV1);
                    }
                }
                var have = new HashSet<long>(a.Bars.Select(x => x.Id));
                foreach (RfElevBar bar in b.Bars) if (have.Add(bar.Id)) a.Bars.Add(bar);
                var haveS = new HashSet<long>(a.Stirrups.Select(x => x.Id));
                foreach (RfElevStirrup st in b.Stirrups) if (haveS.Add(st.Id)) a.Stirrups.Add(st);
                foreach (var kv in ctx.Rebars) merged.Rebars[kv.Key] = kv.Value;
                foreach (var kv in ctx.EndRefs) merged.EndRefs[kv.Key] = kv.Value;
                merged.HostRebars += ctx.HostRebars;
                merged.VisibleRebars += ctx.VisibleRebars;
            }
            if (merged != null) yield return merged;
        }

        /// <summary>
        /// Ажлын арматур ба хомутын шошгыг ЗҮҮН талд (ББ инженерийн шаардлага 2026-10-21; хөдөлгүүр хамгийн ойр талд — доод арматурынхыг доор,
        /// хомутынхыг баруун хөлөөс баруун талд тавьдаг).  Хомутын leader-ийг ЗҮҮН хөлийн дунд руу (огтлолыг гатлахгүй).  Хөдөлгүүрийн өөрийн
        /// аргаар: зүүн талын хэмжээсийн шугамаас цааш, заах цэгийн өндрөөр эгнүүлж (<see cref="RfSectionLayout.Spread"/>), давхцлыг арилгана.
        /// <c>src/Engine</c>-ийг засахгүй — Render-ийн өмнө төлөвлөгөөг л.
        /// </summary>
        internal static void TagsLeft(RfSectionPlan plan, RfSectionOptions o)
        {
            RfSectionRect rect = plan.Rect;
            List<RfTagPlan> left = plan.Tags.ToList();
            if (left.Count == 0 || left.All(t => t.Side == RfSide.Left)) return;
            foreach (RfTagPlan t in left.Where(t => t.IsStirrup && t.Side != RfSide.Left))
            {
                RfStirrupLoop l = plan.Loops.Where(x => x.Id == t.Id).OrderByDescending(x => (x.MaxU - x.MinU) * (x.MaxV - x.MinV)).FirstOrDefault();
                if (l != null) t.Target = new RfV2(l.MinU, (l.MinV + l.MaxV) / 2);
            }
            // Зүүн талын хэмжээсийн (хомутын гинж, гишүүний гадна гинж) хамгийн гадна шугамаас цааш — хөдөлгүүрийн «extra»-тай ижил.
            double extra = 0;
            Action<bool, double> take = (alongU, line) =>
            {
                if (RfSectionOptions.SideOfLine(rect, alongU, line) != RfSide.Left) return;
                extra = Math.Max(extra, Math.Abs(line - rect.FacePos(RfSide.Left)) + o.TagGapFt);
            };
            foreach (RfDimPlan d in plan.Dims) take(d.AlongU, d.LinePos);
            foreach (RfDimChain dc in plan.Chains) take(dc.AlongU, dc.LinePos);
            foreach (RfMemberChain m in plan.MemberChains) take(m.AlongU, m.LinePos);

            left = left.OrderBy(t => t.Target.Y).ToList();
            double pitch = RfSectionLayout.StackPitch(o.TagWidthFt, o.TagHeightFt, plan.Frame.V);
            double[] pos = RfSectionLayout.Spread(left.Select(t => t.Target.Y).ToArray(), left.Select(t => pitch).ToArray(), o.TagGapFt);
            for (int i = 0; i < left.Count; i++)
            {
                RfTagPlan t = left[i];
                t.Side = RfSide.Left;
                t.Head = new RfV2(rect.MinU - o.TagOutFt - extra - t.LocalWidth / 2, pos[i]);
            }
            RfSectionLayout.ResolveCollisions(rect, plan.Frame, plan.Tags, o);
        }

        private static RfSectionUi SectionUi(Document doc, BbMemberStandard ms, BbAnnoReport rep, string mark)
        {
            return new RfSectionUi
            {
                Ref = ms.StirrupRef == "inner" ? RfStirrupRef.Inner : ms.StirrupRef == "center" ? RfStirrupRef.Center : RfStirrupRef.Outer,
                Left = true, Right = true, Top = true, Bottom = true,
                DoDims = ms.SecDims, TagLong = ms.SecTagLong, TagStirrups = ms.SecTagStirrups,
                MemberDims = ms.SecMemberDims, MemberPitchMm = Math.Max(2, ms.SecStepPaperMm),
                GroupTags = ms.SecGroupTags,
                SingleTagPerSet = ms.SingleTagPerSet,
                MultiLeaderPerSet = ms.SingleTagPerSet && ms.MultiLeaderPerSet,
                MergeLeaders = ms.SingleTagPerSet && ms.MultiLeaderPerSet && ms.SecMergeLeaders,
                LeaderLandingMm = Math.Max(0, ms.SecLeaderLandingPaperMm),
                LeaderRunMm = Math.Max(0, ms.SecLeaderRunPaperMm),
                ReplacePrevious = true,
                DimTypeId = DimTypeId(doc, ms.DimType, rep, mark),
                MainTagTypeId = TagTypeId(doc, ms.BarTagType, rep, mark),
                StirrupTagTypeId = TagTypeId(doc, string.IsNullOrEmpty(ms.StirrupTagType) ? ms.BarTagType : ms.StirrupTagType, rep, mark),
                DimOffsetMm = Math.Max(1, ms.SecDimOffsetPaperMm),
                HDimSide = RfSide.Bottom,
                VDimSide = ms.SecRightSide ? RfSide.Right : RfSide.Left,
                AllSides = ms.SecAllSides,
                TagGapMm = Math.Max(1, ms.TagGapPaperMm),
                TagOutMm = Math.Max(1, ms.SecTagOutPaperMm),
            };
        }

        private static RfElevUi ElevationUi(Document doc, BbMemberStandard ms, BbAnnoReport rep, string mark)
        {
            return new RfElevUi
            {
                TagBars = ms.ElevTagBars, StirrupMra = ms.ElevMra, LapDims = ms.ElevLaps, SpanDims = ms.ElevSpans, LapChain = false,
                DimTypeId = DimTypeId(doc, ms.DimType, rep, mark),
                BarTagTypeId = TagTypeId(doc, ms.BarTagType, rep, mark),
                MraTypeId = MraTypeId(doc, ms.MraType, rep, mark),
                TagOffsetMm = Math.Max(0, ms.TagOffsetPaperMm),
                TagGapMm = Math.Max(0, ms.TagGapPaperMm),
                DimPitchMm = Math.Max(2, ms.DimPitchPaperMm),
                // Компанийн MRA загвар өөрөө эгнээг тооцоолно — хөдөлгүүр MRA-г бусад эгнээний ард (тогтоосон зайгүй) тавьж зай нөөцөлнө.
                StirrupDimOffsetMm = ms.ElevMraLayout ? 0 : Math.Max(0, ms.StirrupDimOffsetPaperMm),
                DimFirstMm = Math.Max(0, ms.ElevDimFirstPaperMm),
                ColumnDimsLeft = ms.ElevColumnLeft,
            };
        }

        public static ElementId DimTypeId(Document doc, string name, BbAnnoReport rep, string mark)
        {
            var all = new FilteredElementCollector(doc).OfClass(typeof(DimensionType)).Cast<DimensionType>().Where(d => { try { return d.StyleType == DimensionStyleType.Linear; } catch { return false; } }).ToList();
            DimensionType t = all.FirstOrDefault(d => d.Name == name);
            if (t != null) return t.Id;
            if (!string.IsNullOrEmpty(name)) rep?.Issues.Add(new BbIssue { Tool = "Тэмдэглэх", Member = mark, Severity = BbSeverity.Warning, Problem = "Хэмжээсийн төрөл «" + name + "» алга — өгөгдмөлөөр.", Proposal = "Төрлийг компанийн template-ээс оруулах.", Key = "anno|dimtype|" + name });
            return ElementId.InvalidElementId;
        }

        public static ElementId TagTypeId(Document doc, string familyAndType, BbAnnoReport rep, string mark)
        {
            foreach (FamilySymbol fs in new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_RebarTags).WhereElementIsElementType().OfType<FamilySymbol>())
                if (fs.FamilyName + " : " + fs.Name == familyAndType) return fs.Id;
            if (!string.IsNullOrEmpty(familyAndType)) rep?.Issues.Add(new BbIssue { Tool = "Тэмдэглэх", Member = mark, Severity = BbSeverity.Warning, Problem = "Арматурын шошго «" + familyAndType + "» алга — өгөгдмөлөөр.", Proposal = "Шошгоны family-г ачаалах.", Key = "anno|tag|" + familyAndType });
            try
            {
                ElementId def = doc.GetDefaultFamilyTypeId(new ElementId(BuiltInCategory.OST_RebarTags));
                if (def != null && def != ElementId.InvalidElementId) return def;
            }
            catch { }
            return ElementId.InvalidElementId;
        }

        public static ElementId MraTypeId(Document doc, string name, BbAnnoReport rep, string mark)
        {
            var all = new FilteredElementCollector(doc).OfClass(typeof(MultiReferenceAnnotationType)).Cast<MultiReferenceAnnotationType>().ToList();
            MultiReferenceAnnotationType t = all.FirstOrDefault(m => m.Name == name);
            if (t != null) return t.Id;
            if (!string.IsNullOrEmpty(name)) rep?.Issues.Add(new BbIssue { Tool = "Тэмдэглэх", Member = mark, Severity = BbSeverity.Warning, Problem = "MRA төрөл «" + name + "» алга — өгөгдмөлөөр.", Proposal = "MRA төрлийг компанийн template-ээс оруулах.", Key = "anno|mra|" + name });
            return all.FirstOrDefault()?.Id ?? ElementId.InvalidElementId;
        }

        private static BbIssue Issue(string mark, View view, BbSeverity sev, string problem, string proposal, string code)
        {
            return new BbIssue { Tool = "Тэмдэглэх", Severity = sev, Member = mark, View = view?.Name ?? "", ViewId = view?.Id.Value ?? -1, Problem = problem, Proposal = proposal, Key = "anno|" + mark + "|" + (view?.Name ?? "") + "|" + code };
        }
    }

    /// <summary>Анхааруулгыг чимээгүй устгана (тэмдэглэгээ үүсгэхэд Revit-ийн «давхцсан» г.м.).  Алдааг хөндөхгүй.</summary>
    internal sealed class BbSwallowWarnings : IFailuresPreprocessor
    {
        public FailureProcessingResult PreprocessFailures(FailuresAccessor fa)
        {
            foreach (FailureMessageAccessor m in fa.GetFailureMessages())
                if (m.GetSeverity() == FailureSeverity.Warning) fa.DeleteWarning(m);
            return FailureProcessingResult.Continue;
        }
    }
}
