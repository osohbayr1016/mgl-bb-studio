using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement
{
    /// <summary>Хэрэглэгчийн сонголт (Revit талын) — Core-ийн <see cref="RfSectionOptions"/>-д хөрвүүлэгдэнэ.</summary>
    internal sealed class RfSectionUi
    {
        public RfHostKind Host = RfHostKind.Auto;
        public RfStirrupRef Ref = RfStirrupRef.Outer;
        public bool Left = true, Right = true, Top = true, Bottom = true;
        public bool DoDims = true, TagLong = true, TagStirrups = true;

        /// <summary>Гишүүний хэмжээсийг тэнхлэг, хучилт, ханатай уялдуулсан гадна гинж (<see cref="RfSectionOptions.MemberDims"/>).</summary>
        public bool MemberDims = false;

        /// <summary>Хомутын гинжээс гадна гинж хүртэл (цаасан мм).</summary>
        public double MemberPitchMm = 8;

        /// <summary>Ижил төрөл/голч/shape-тэй, гишүүний ижил талын ажлын арматурыг НЭГ tag-аар.</summary>
        public bool GroupTags = true;

        /// <summary>Арматурын олонлог (Rebar set) бүрд ЯГ НЭГ tag — <see cref="RfSectionOptions.SingleTagPerSet"/>.</summary>
        public bool SingleTagPerSet = false;

        /// <summary>Олонлогийн бүх ширхгийг нэг шошгонд (multi-leader) холбох.</summary>
        public bool MultiLeaderPerSet = false;

        /// <summary>Multi-leader-ийн leader-үүдийг нэгтгэх (Merge Leaders).</summary>
        public bool MergeLeaders = false;

        /// <summary>Энэ хэрэгслийн ӨМНӨ тавьсан (энэ эзэн дээрх) тэмдэглэгээг солих.  Гараар тавьсан юм ХЭЗЭЭ Ч хөндөгдөхгүй.</summary>
        public bool ReplacePrevious = true;
        public ElementId DimTypeId = ElementId.InvalidElementId;
        public ElementId MainTagTypeId = ElementId.InvalidElementId;
        public ElementId StirrupTagTypeId = ElementId.InvalidElementId;

        /// <summary>Цаасан дээрх зай, мм.  Масштабаар загварын футад хөрвүүлнэ (зураг ямар масштабтай ч адилхан харагдана).</summary>
        public double DimOffsetMm = 10;

        /// <summary>Хэвтээ хэмжээсийн тал (Top/Bottom), босоо хэмжээсийн тал (Right/Left) — <see cref="RfSectionOptions.HorizontalDimSide"/>.</summary>
        public RfSide HDimSide = RfSide.Top, VDimSide = RfSide.Right;

        /// <summary>«Байрлал — 4 талд» (<see cref="RfSectionOptions.DimAllSides"/>).</summary>
        public bool AllSides = false;
        public double TagGapMm = 6;
        public double TagOutMm = 6;

        /// <summary>Leader-ийн 3→2 (шошгоноос elbow хүртэл хэвтээ) ба 2→1 (elbow-оос арматур хүртэлх налуу хэсгийн хэвтээ зай), цаасан мм.  0 = автомат.</summary>
        public double LeaderLandingMm = 0, LeaderRunMm = 0;
        public double TagWidthMm = 16;
        public double TagHeightMm = 5;

        public RfSectionOptions ToCore(View view)
        {
            int scale = view != null && view.Scale > 0 ? view.Scale : 100;
            Func<double, double> ft = mm => RfTol.PaperMmToModelFt(mm, scale);
            return new RfSectionOptions
            {
                Left = Left, Right = Right, Top = Top, Bottom = Bottom,
                Ref = Ref,
                DoDimensions = DoDims,
                MemberDims = MemberDims,
                MemberPitchFt = ft(MemberPitchMm),
                TagLongitudinal = TagLong,
                TagStirrups = TagStirrups,
                GroupTags = GroupTags,
                SingleTagPerSet = SingleTagPerSet,
                MultiLeaderPerSet = MultiLeaderPerSet,
                MergeLeaders = MergeLeaders,
                DimOffsetFt = ft(DimOffsetMm),
                HorizontalDimSide = HDimSide,
                VerticalDimSide = VDimSide,
                DimAllSides = AllSides,
                TagOutFt = ft(TagOutMm),
                TagGapFt = ft(TagGapMm),
                TagWidthFt = ft(TagWidthMm),
                TagHeightFt = ft(TagHeightMm),
            };
        }

        public RfSectionSaved ToSaved(Document doc, string hostUid, IEnumerable<string> ids)
        {
            return new RfSectionSaved
            {
                Host = hostUid,
                Ref = Ref == RfStirrupRef.Inner ? "inner" : Ref == RfStirrupRef.Center ? "center" : "outer",
                Left = Left, Right = Right, Top = Top, Bottom = Bottom,
                Dims = DoDims, TagLong = TagLong, TagStirrups = TagStirrups,
                MemberDims = MemberDims, MemberPitchMm = MemberPitchMm,
                GroupTags = GroupTags, SingleTagPerSet = SingleTagPerSet, MultiLeaderPerSet = MultiLeaderPerSet, MergeLeaders = MergeLeaders, ReplacePrevious = ReplacePrevious,
                DimOffsetMm = DimOffsetMm, TagGapMm = TagGapMm,
                HDimSide = HDimSide == RfSide.Bottom ? "bottom" : "top", VDimSide = VDimSide == RfSide.Left ? "left" : "right", DimAllSides = AllSides,
                LeaderLandingMm = LeaderLandingMm, LeaderRunMm = LeaderRunMm,
                DimTypeUid = UidOf(doc, DimTypeId),
                MainTagUid = UidOf(doc, MainTagTypeId),
                StirrupTagUid = UidOf(doc, StirrupTagTypeId),
                Ids = ids.ToList(),
            };
        }

        public static RfSectionUi FromSaved(Document doc, RfSectionSaved s)
        {
            return new RfSectionUi
            {
                Ref = s.Ref == "inner" ? RfStirrupRef.Inner : s.Ref == "center" ? RfStirrupRef.Center : RfStirrupRef.Outer,
                Left = s.Left, Right = s.Right, Top = s.Top, Bottom = s.Bottom,
                DoDims = s.Dims, TagLong = s.TagLong, TagStirrups = s.TagStirrups,
                MemberDims = s.MemberDims, MemberPitchMm = s.MemberPitchMm,
                GroupTags = s.GroupTags,
                SingleTagPerSet = s.SingleTagPerSet,
                MultiLeaderPerSet = s.MultiLeaderPerSet,
                MergeLeaders = s.MergeLeaders,
                // «Шинэчлэх» нь ҮРГЭЛЖ өмнөхөө солино (юуг шинэчилж буйгаа дахин тооцох нь утга учир) — хадгалсан сонголт хамаагүй.
                ReplacePrevious = true,
                DimOffsetMm = s.DimOffsetMm, TagGapMm = s.TagGapMm,
                HDimSide = s.HDimSide == "bottom" ? RfSide.Bottom : RfSide.Top, VDimSide = s.VDimSide == "left" ? RfSide.Left : RfSide.Right, AllSides = s.DimAllSides,
                LeaderLandingMm = s.LeaderLandingMm, LeaderRunMm = s.LeaderRunMm,
                DimTypeId = IdOf(doc, s.DimTypeUid),
                MainTagTypeId = IdOf(doc, s.MainTagUid),
                StirrupTagTypeId = IdOf(doc, s.StirrupTagUid),
            };
        }

        private static string UidOf(Document doc, ElementId id)
        {
            if (id == null || id == ElementId.InvalidElementId) return string.Empty;
            Element e = doc.GetElement(id);
            return e == null ? string.Empty : e.UniqueId;
        }

        private static ElementId IdOf(Document doc, string uid)
        {
            if (string.IsNullOrEmpty(uid)) return ElementId.InvalidElementId;
            Element e = doc.GetElement(uid);
            return e == null ? ElementId.InvalidElementId : e.Id;
        }
    }

    internal sealed class RfSectionReport
    {
        /// <summary>Төлөвлөсөн / үүссэн ГИНЖИН хэмжээсийн тоо (тэнхлэг бүрт нэг); үүсээгүй; бүрэн биш (зарим тал лавлагаагүй тул хасагдсан); нийт сегмент.</summary>
        public int DimsPlanned, DimsMade, DimsFailed, DimsIncomplete, DimSegments;

        /// <summary>Гишүүний гадна гинж (тэнхлэг, хучилт, хана): үүссэн / үүсээгүй.</summary>
        public int MemberMade, MemberFailed;
        public int TagsPlanned, Tags;
        public int ReplacedPrevious;

        /// <summary>«Өмнөхийг солих» унтраалттай үед үлдээсэн өмнөх MGL тэмдэглэгээний элементийн тоо.</summary>
        public int KeptPrevious;

        /// <summary>Шинэ хэмжээс/tag үүсээгүй (бүтэн унасан) тул устгаагүй өмнөх элементийн тоо (бүртгэлтэй хэвээр).</summary>
        public int KeptOnFailure;

        /// <summary>Хэрэглэгчийн гараар холбосон аннотаци (ж: proxy шугамд хэмжээс) хамааралтай тул УСТГААГҮЙ өмнөх элементийн тоо.</summary>
        public int ProtectedPrevious;

        /// <summary>RebarStyle ба геометр зөрсөн (алгассан) арматурын тоо.</summary>
        public int StyleMismatch;

        /// <summary>Tag нэгтгэлтээр хасагдсан tag-ийн тоо (бүлэглээгүй бол үүсэх tag − бодит tag).</summary>
        public int GroupedTags;
        public long ElapsedMs;
        public RfSectionPlan Plan;
        public readonly List<string> Failures = new List<string>();
        public readonly List<string> Notes = new List<string>();
    }

    /// <summary>Tag үүсгэхээс ӨМНӨ (загварт юу ч бичихээс өмнө) илрэх асуудал.</summary>
    internal enum RfTagProblem
    {
        None = 0,
        /// <summary>Төсөлд арматурын tag family ачаалагдаагүй.</summary>
        NoTagTypes,
        /// <summary>Tag-ийн төрөл сонгогдоогүй.</summary>
        NotSelected,
        /// <summary>Сонгосон төрөл Structural Rebar Tag биш.</summary>
        NotRebarTag,
        /// <summary>Tag-ийн ангилал энэ харагдацад нуугдсан (үүссэн ч харагдахгүй).</summary>
        CategoryHidden,
    }

    /// <summary>
    /// «Огтлолын арматурын тэмдэглэгээ»-ний үйлчилгээ: <b>Analyze</b> (уншина) → <b>Plan</b> (Core, цэвэр) →
    /// <b>Render</b> (Revit-д бичнэ).  Plan нь preview, тест, backend солихыг боломжтой болгодог.
    /// </summary>
    internal static class RfSectionService
    {
        public static List<DimensionType> DimensionTypes(Document doc)
        {
            var list = new List<DimensionType>();
            foreach (DimensionType dt in new FilteredElementCollector(doc).OfClass(typeof(DimensionType)).Cast<DimensionType>())
            {
                try
                {
                    if (dt.StyleType != DimensionStyleType.Linear) continue;
                    if (string.IsNullOrWhiteSpace(dt.Name)) continue;
                    list.Add(dt);
                }
                catch
                {
                    // Системийн (нэргүй) төрөл — алгасна.
                }
            }
            list.Sort((a, b) => string.Compare(a.Name, b.Name, StringComparison.CurrentCultureIgnoreCase));
            return list;
        }

        /// <summary>Арматурын tag family-ийн төрлүүд (OST_RebarTags).</summary>
        public static List<FamilySymbol> RebarTagTypes(Document doc)
        {
            var list = new List<FamilySymbol>();
            foreach (Element e in new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_RebarTags).WhereElementIsElementType())
            {
                FamilySymbol fs = e as FamilySymbol;
                if (fs != null) list.Add(fs);
            }
            list.Sort((a, b) => string.Compare(a.FamilyName + a.Name, b.FamilyName + b.Name, StringComparison.CurrentCultureIgnoreCase));
            return list;
        }

        /// <summary>
        /// Tag үүсгэхээс ӨМНӨ шалгана (загварт юу ч бичихгүй): төрөл байгаа эсэх, сонгогдсон эсэх, Structural Rebar Tag мөн эсэх, ангилал нь энэ
        /// харагдацад нуугдсан эсэх.  «Tag сонгосон ч үүсэхгүй» гэсэн чимээгүй алдаанаас сэргийлнэ — дуудагч Монгол мессежээр хэрэглэгчид хэлнэ.
        /// </summary>
        public static RfTagProblem CheckTag(Document doc, View view, ElementId typeId, int availableTypes)
        {
            if (availableTypes <= 0) return RfTagProblem.NoTagTypes;
            if (typeId == null || typeId == ElementId.InvalidElementId) return RfTagProblem.NotSelected;
            FamilySymbol fs = doc.GetElement(typeId) as FamilySymbol;
            if (fs == null || !RfSectionRenderer.IsRebarTagType(fs)) return RfTagProblem.NotRebarTag;
            try
            {
                if (view != null && view.GetCategoryHidden(new ElementId(BuiltInCategory.OST_RebarTags))) return RfTagProblem.CategoryHidden;
            }
            catch
            {
                // Нуугдсан эсэх уншигдахгүй — асуудал гэж үзэхгүй.
            }
            return RfTagProblem.None;
        }

        public static ElementId DefaultRebarTagType(Document doc, IList<FamilySymbol> types)
        {
            try
            {
                ElementId def = doc.GetDefaultFamilyTypeId(new ElementId(BuiltInCategory.OST_RebarTags));
                if (def != null && def != ElementId.InvalidElementId && doc.GetElement(def) is FamilySymbol) return def;
            }
            catch
            {
                // Энэ ангилалд өгөгдмөл төрөл тохируулаагүй.
            }
            return types.Count > 0 ? types[0].Id : ElementId.InvalidElementId;
        }

        /// <summary>
        /// ANALYZE: бүх нүүр, ажлын арматур, хомутыг уншина.  Тохиргооноос (хэмжээс/tag) ХАМААРАХГҮЙ — нэг удаа
        /// уншаад preview-д сонголт солигдох бүрд зөвхөн planner-ыг дахин ажиллуулна.
        /// </summary>
        public static RfSectionContext Analyze(Document doc, View view, Element host)
        {
            var all = new RfSectionOptions { DoDimensions = true, TagLongitudinal = true, TagStirrups = true };
            return RfSectionAnalyzer.Analyze(doc, view, host, all);
        }

        /// <summary>PLAN: цэвэр — Revit-ийг ХЭЗЭЭ Ч хөндөхгүй.</summary>
        public static RfSectionPlan Plan(RfSectionContext ctx, RfSectionUi ui)
        {
            ctx.Input.Options = ui.ToCore(ctx.View);
            return RfSectionPlanner.Build(ctx.Input);
        }

        /// <summary>
        /// ⚠️ Нээлттэй Transaction-гүй үед л дуудна.  Бүгд НЭГ TransactionGroup → нэг Ctrl+Z.
        ///
        /// ДАРААЛАЛ (өгөгдөл алдуулахгүйн тулд): (1) харагдацын бүртгэл бичигдэх эсэхийг ЭХЛЭЭД шалгана, (2) ШИНЭ
        /// тэмдэглэгээг үүсгэнэ, (3) ХЭДИЙ ХЭЗЭЭ нэг элемент амжилттай үүссэн бол л ӨМНӨХ багцыг устгана.  Юу ч үүсээгүй бол
        /// (tag family ачаалаагүй, лавлагаа алдагдсан г.м.) бүх зүйл буцаж, өмнөх тэмдэглэгээ ХЭВЭЭР үлдэнэ.
        /// </summary>
        public static RfSectionReport Render(Document doc, View view, RfSectionContext ctx, RfSectionPlan plan, RfSectionUi ui)
        {
            var rep = new RfSectionReport { Plan = plan, DimsPlanned = plan.Chains.Count, TagsPlanned = plan.Tags.Count };
            rep.StyleMismatch = ctx.StyleMismatch;
            // Бүлэглэлтээр хэдэн tag хасагдсан: бүлэг бүрд (GroupCount − 1).
            foreach (RfTagPlan tp in plan.Tags) rep.GroupedTags += Math.Max(0, tp.GroupCount - 1);
            var sw = Stopwatch.StartNew();
            string hostUid = ctx.Host.UniqueId;

            // Өөр хэрэглэгч эзэмшсэн харагдац (workshared) — бүртгэл бичигдэхгүй тул тэмдэглэгээ «өнчин» болно (дахин ажиллуулахад
            // давхардана).  Тиймээс юу ч үүсгэхгүй.
            if (!RfSectionStore.CanWrite(doc, view))
            {
                rep.Failures.Add(RfText.ViewNotWritable);
                return rep;
            }

            using (var tg = new TransactionGroup(doc, RfText.SecTitle))
            {
                tg.Start();
                bool changed = false;
                try
                {
                    using (var t = new Transaction(doc, RfText.SecTitle))
                    {
                        t.Start();
                        FailureHandlingOptions fho = t.GetFailureHandlingOptions();
                        fho.SetFailuresPreprocessor(new RfWarningSwallower());
                        t.SetFailureHandlingOptions(fho);

                        RfSectionStoreData data = RfSectionStore.Read(view);
                        // «Duplicate View with Detailing»-ийн хуулбар: бүртгэл Extensible Storage-тэй хамт хуулагдсан ч хуулбар дахь
                        // тэмдэглэгээнүүд ШИНЭ UniqueId-тай тул бүртгэлд ороогүй — шинэ багц тэдгээрийн ДЭЭР давхарлан тавигдана (устгахгүй).
                        if (data.Foreign) rep.Notes.Add(RfText.ForeignRegistry);
                        RfSectionSaved prev = data.Sets.FirstOrDefault(s => s.Host == hostUid);

                        // 1. ШИНЭ хэмжээс, tag (хуучин нь хэвээр байхад)
                        var rc = new RfRenderContext
                        {
                            Doc = doc,
                            View = view,
                            Ctx = ctx,
                            Frame = plan.Frame,
                            Scale = view.Scale > 0 ? view.Scale : 100,
                            DimType = ui.DimTypeId != ElementId.InvalidElementId ? doc.GetElement(ui.DimTypeId) as DimensionType : null,
                            MergeLeaders = ui.MergeLeaders,
                            LeaderLandingMm = ui.LeaderLandingMm,
                            LeaderRunMm = ui.LeaderRunMm,
                        };

                        // ГИНЖИН хэмжээс: тэнхлэг бүрт НЭГ Dimension (бетон нүүр → хомутын ирмэг → хомутын ирмэг → бетон нүүр), бодит Reference-аар.
                        // Лавлагаа олдохгүй тал алгасагдаж ИЛ тайлагнана — хуурамч (нэмэлт) геометр ХЭЗЭЭ Ч үүсэхгүй.
                        List<RfChainOutcome> outcomes = RfSectionRenderer.RenderChains(rc, plan);
                        foreach (RfChainOutcome o in outcomes)
                        {
                            string axis = RfText.AxisName(o.Chain.AlongU);
                            if (!o.Created)
                            {
                                rep.DimsFailed++;
                                rep.Failures.Add(RfText.ChainFailed(axis, string.Join(" | ", o.Reasons)));
                                continue;
                            }
                            rep.DimsMade++;
                            rep.DimSegments += o.Segments;
                            if (!o.Complete)
                            {
                                rep.DimsIncomplete++;
                                rep.Notes.Add(RfText.ChainIncomplete(axis, o.MissingSides, string.Join(" | ", o.Reasons)));
                            }
                            else if (o.Chain.Coincident.Count > 0)
                            {
                                rep.Notes.Add(RfText.ChainCoincident(axis, o.Chain.Coincident));
                            }
                        }

                        // Гишүүний гадна гинж (тэнхлэг, хучилт, хана) — хомутын гинжээс ГАДНА эгнээнд.
                        foreach (RfMemberOutcome mo in RfSectionRenderer.RenderMemberChains(rc, plan))
                        {
                            string axis = RfText.AxisName(mo.Chain.AlongU);
                            if (!mo.Created)
                            {
                                rep.MemberFailed++;
                                rep.Failures.Add(RfText.MemberChainFailed(axis, string.Join(" | ", mo.Reasons.Distinct())));
                                continue;
                            }
                            rep.MemberMade++;
                            rep.DimSegments += mo.Segments;
                            if (mo.DroppedNeighbors) rep.Notes.Add(RfText.MemberDroppedNeighbors(axis, string.Join(" | ", mo.Reasons.Distinct())));
                        }

                        if (plan.Tags.Count > 0)
                            rep.Tags = RfSectionRenderer.RenderTags(rc, plan, ui.MainTagTypeId, ui.StirrupTagTypeId, rep.Failures, rep.Notes);

                        // 2. Юу ч үүсээгүй бол БҮГД буцна — өмнөх тэмдэглэгээ хөндөгдөхгүй.
                        if (rc.Created.Count == 0)
                        {
                            t.RollBack();
                            changed = false;
                        }
                        else
                        {
                            // 3. Одоо л өмнөх багцыг (ЗӨВХӨН энэ харагдацын, энэ эзний, ЭНЭ хэрэгслийн тавьсан) шийднэ:
                            //    «Өмнөхийг солих» асаалттай бол устгана; унтраалттай бол ХЭВЭЭР үлдээж, бүртгэлээс гаргана (энгийн тэмдэглэгээ болно).
                            // Устгаагүй (хэвээр үлдсэн, ХЭДИЙГЭЭР бүртгэлтэй байх) өмнөх элементүүдийн UniqueId — шинэ багцад хамт бүртгэнэ.
                            var keepUids = new List<string>();
                            if (prev != null)
                            {
                                var fresh = new HashSet<long>(rc.Created.Select(i => i.Value));
                                List<ElementId> old = RfSectionStore.Alive(doc, view, prev).Where(i => !fresh.Contains(i.Value)).ToList();
                                if (old.Count > 0)
                                {
                                    if (ui.ReplacePrevious)
                                    {
                                        // Өмнөхийг ХАТАГТ БИШ, ТӨРЛӨӨР солино, ГЭХДЭЭ тэр төрлийн шинэ тэмдэглэгээ БҮРЭН (төлөвлөсөн бүгд, алдаагүй) үүссэн
                                        // үед л.  Дутуу үүссэн (4 хэмжээснээс 1 нь), эсвэл тэр төрлийг энэ удаа огт төлөвлөөгүй (хомут олдоогүй, хэмжээсийг
                                        // унтраасан) бол өмнөх сайн тэмдэглэгээг УСТГАХГҮЙ — давхардал нь өгөгдөл алдахаас дээр (гараар цэвэрлэнэ).
                                        // Хэмжээсийг ЗӨВХӨН БҮХ гинж БҮРЭН (бүх лавлагаатай) үүссэн үед солино; бүрэн биш (тал алгассан) гинж нь өмнөхийг устгах үндэслэл БИШ.
                                        bool dimsOk = RfReplacePolicy.DimsReplaceable(plan.Chains.Count + plan.MemberChains.Count, rep.DimsMade + rep.MemberMade,
                                            rep.DimsFailed + rep.DimsIncomplete + rep.MemberFailed);
                                        bool tagsOk = RfReplacePolicy.TagsReplaceable(plan.Tags.Count, rep.Tags);
                                        var del = new List<ElementId>();
                                        // ХАМГААЛАЛТ: Document.Delete нь устгасан элементээс ХАМААРАЛТАЙ бүх элементийг ч хамт устгадаг (Revit-ийн баримт).
                                        // Хэрэглэгч proxy шугамд өөрийн хэмжээс/тэмдэглэгээг гараар холбосон бол тэр шугамыг устгавал таны хэмжээс ч алга болно.
                                        // Иймд устгах элементээс БИДНИЙ БИШ (бүртгэлд/шинэ багцад байхгүй) аннотаци хамааралтай бол тэр элементийг УСТГАХГҮЙ.
                                        var ours = new HashSet<long>(old.Select(i => i.Value));
                                        foreach (ElementId cid in rc.Created) ours.Add(cid.Value);
                                        int protectedCount = 0;
                                        foreach (ElementId oid in old)
                                        {
                                            Element oe = doc.GetElement(oid);
                                            if (oe == null) continue;
                                            bool isTag = oe is IndependentTag;
                                            // ⚠️ UniqueId-г ШАЛГАЛТЫН устгал (SubTransaction RollBack)-аас ӨМНӨ авна: буцаасны дараа өмнө авсан Element объект хүчингүй болж болно.
                                            string oeUid = oe.UniqueId;
                                            if ((isTag && tagsOk) || (!isTag && dimsOk))
                                            {
                                                if (DeleteWouldTakeForeign(doc, oid, ours))
                                                {
                                                    keepUids.Add(oeUid);
                                                    protectedCount++;
                                                }
                                                else
                                                {
                                                    del.Add(oid);
                                                }
                                            }
                                            else
                                            {
                                                keepUids.Add(oeUid);
                                            }
                                        }
                                        rep.ProtectedPrevious = protectedCount;
                                        rep.KeptOnFailure = keepUids.Count - protectedCount;
                                        if (del.Count > 0)
                                        {
                                            try
                                            {
                                                doc.Delete(del);
                                                rep.ReplacedPrevious = del.Count;
                                            }
                                            catch (Exception ex)
                                            {
                                                rep.Failures.Add(RfText.PreviousNotRemoved(ex.Message));
                                                // Устгаж чадаагүй элементүүд бүртгэлгүй «өнчин давхардал» болохгүйн тулд шинэ багцад бүртгэлтэй үлдээнэ.
                                                foreach (ElementId did in del)
                                                {
                                                    Element de = doc.GetElement(did);
                                                    if (de != null) keepUids.Add(de.UniqueId);
                                                }
                                            }
                                        }
                                    }
                                    else
                                    {
                                        // «Солих» унтраалттай: өмнөх нь ЭНГИЙН тэмдэглэгээ болж үлдэнэ (бүртгэлээс гарна).
                                        rep.KeptPrevious = old.Count;
                                    }
                                }
                                data.Sets.Remove(prev);
                            }

                            // 4. Бүртгэл (дараагийн удаа солих боломжтой болгоно).  Бичигдэхгүй бол БҮГД буцна (өнчин тэмдэглэгээ үлдээхгүй).
                            var uids = rc.Created
                                .Select(id => doc.GetElement(id))
                                .Where(e => e != null)
                                .Select(e => e.UniqueId)
                                .Concat(keepUids)
                                .Distinct()
                                .ToList();
                            data.Sets.Add(ui.ToSaved(doc, hostUid, uids));
                            if (!RfSectionStore.Write(doc, view, data))
                                throw new InvalidOperationException(RfText.StoreNotWritten);

                            TransactionStatus st = t.Commit();
                            if (st == TransactionStatus.Committed) changed = true;
                            else rep.Failures.Add("Revit өөрчлөлтийг буцаасан (" + st + ").");
                        }
                    }
                }
                catch (Exception ex)
                {
                    rep.Failures.Add(ex.Message);
                    changed = false;
                }

                if (changed) tg.Assimilate();
                else
                {
                    // Буцсан тул тоолуурыг цэвэрлэнэ (тайлан «тавигдсан» гэж худал хэлэхгүй).
                    rep.DimsMade = rep.DimsIncomplete = rep.DimSegments = rep.Tags = rep.ReplacedPrevious = rep.KeptPrevious = rep.KeptOnFailure = rep.ProtectedPrevious = 0;
                    rep.MemberMade = 0;
                    tg.RollBack();
                }
            }
            rep.ElapsedMs = sw.ElapsedMilliseconds;
            return rep;
        }

        /// <summary>
        /// ШАЛГАЛТЫН устгал: <paramref name="id"/>-г устгавал БИДНИЙ БИШ (<paramref name="ours"/>-д байхгүй) ямар нэг элемент хамт устах уу.
        /// Revit-ийн <c>Document.Delete</c> нь устгасан элементээс ХАМААРАЛТАЙ бүх элементийг (ж: proxy лавлагаа шугамд хэрэглэгчийн гараар холбосон
        /// хэмжээс) хамт, асуулгагүй устгадаг; хамаарлыг <c>GetDependentElements</c>-ээр таамаглахын оронд ЯГ Delete-ийн буцаасан жагсаалтыг
        /// SubTransaction дотор авч буцаана (RollBack) — бодит үр дүн.  Тодорхойлж чадахгүй бол «тийм» (устгахгүй — аюулгүй тал).
        /// ⚠️ Нээлттэй Transaction дотор дуудна.
        /// </summary>
        private static bool DeleteWouldTakeForeign(Document doc, ElementId id, HashSet<long> ours)
        {
            try
            {
                using (var st = new SubTransaction(doc))
                {
                    st.Start();
                    ICollection<ElementId> gone;
                    try
                    {
                        gone = doc.Delete(id);
                    }
                    finally
                    {
                        if (st.HasStarted() && !st.HasEnded()) st.RollBack();
                    }
                    if (gone == null) return false;
                    foreach (ElementId g in gone)
                    {
                        if (g == null || g == id) continue;
                        if (!ours.Contains(g.Value)) return true;
                    }
                    return false;
                }
            }
            catch
            {
                return true;
            }
        }

        /// <summary>
        /// «Тэмдэглэгээ шинэчлэх»: харагдацад бүртгэлтэй эзэн тус бүрийг ХАДГАЛСАН сонголтоор дахин шинжилж солино.
        /// Эзэн олдохгүй бол алгасна (ҮЛДСЭН тэмдэглэгээ ХӨНДӨГДӨХГҮЙ).  Бүгд нэг Ctrl+Z.
        /// </summary>
        public static List<RfSectionReport> Refresh(Document doc, View view, out int orphans)
        {
            orphans = 0;
            var reports = new List<RfSectionReport>();
            RfSectionStoreData data = RfSectionStore.Read(view);
            if (data.Sets.Count == 0) return reports;

            using (var tg = new TransactionGroup(doc, RfText.RefreshTitle))
            {
                tg.Start();
                bool any = false;
                foreach (RfSectionSaved set in data.Sets.ToList())
                {
                    Element host = string.IsNullOrEmpty(set.Host) ? null : doc.GetElement(set.Host);
                    if (host == null)
                    {
                        orphans++;
                        continue;
                    }
                    RfSectionUi ui = RfSectionUi.FromSaved(doc, set);
                    RfSectionContext ctx = Analyze(doc, view, host);
                    RfSectionPlan plan = Plan(ctx, ui);
                    if (!plan.HasContent)
                    {
                        // ⚠️ Дахин тооцоход юу ч үүсэхгүй бол (хомут/арматур зөөгдсөн, нүүр олдохгүй г.м.) өмнөх тэмдэглэгээг
                        // УСТГАХГҮЙ — хэрэглэгчийн ажлыг хоосон болгохгүй.  «Хөндөөгүй» гэж тайлагнана.
                        orphans++;
                        continue;
                    }
                    RfSectionReport rep = Render(doc, view, ctx, plan, ui);
                    reports.Add(rep);
                    if (rep.DimsMade + rep.MemberMade + rep.Tags > 0) any = true;
                }
                if (any) tg.Assimilate();
                else tg.RollBack();
            }
            return reports;
        }
    }
}
