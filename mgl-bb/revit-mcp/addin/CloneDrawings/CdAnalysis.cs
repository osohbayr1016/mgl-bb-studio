using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using RevitMcpAddin.CloneDrawings.Core;

namespace RevitMcpAddin.CloneDrawings
{
    /// <summary>
    /// Эзэн элемент → түүнд суусан элементүүд (арматур, хана дахь хаалга/цонх/нүх, дам нурууны
    /// нүх, family-ийн дэд бүрэлдэхүүн).  ⚠️ ХУРД: файлын бүх family instance, арматурыг гүйлгэхгүй —
    /// Revit-ийн хамаарлын граф (`GetDependentElements`)-аас элемент бүрт ХЭРЭГТЭЙ үед нь авна.
    /// Тэр нь унавал (хуучин Revit г.м.) л бүтэн индексийг нэг удаа барина.
    /// </summary>
    public sealed class CdHostIndex
    {
        private readonly Document _doc;
        private readonly Dictionary<ElementId, List<ElementId>> _hosted = new Dictionary<ElementId, List<ElementId>>();
        private Dictionary<ElementId, List<ElementId>> _full;

        private CdHostIndex(Document doc) { _doc = doc; }

        public static CdHostIndex Build(Document doc) => new CdHostIndex(doc);

        public IReadOnlyList<ElementId> HostedBy(ElementId host)
        {
            if (_hosted.TryGetValue(host, out List<ElementId> list))
                return list;
            list = null;
            Element h = _doc.GetElement(host);
            if (h != null)
            {
                try
                {
                    list = new List<ElementId>();
                    var filter = new ElementMulticlassFilter(new List<Type> { typeof(Rebar), typeof(FamilyInstance), typeof(Opening) });
                    foreach (ElementId id in h.GetDependentElements(filter))
                    {
                        if (id != host && IsHostedBy(_doc.GetElement(id), host))
                            list.Add(id);
                    }
                }
                catch
                {
                    list = null;
                }
            }
            if (list == null)
                list = Full().TryGetValue(host, out List<ElementId> f) ? f : new List<ElementId>();
            _hosted[host] = list;
            return list;
        }

        private static bool IsHostedBy(Element e, ElementId host)
        {
            switch (e)
            {
                case Rebar r:
                    return r.GetHostId() == host;
                case FamilyInstance fi:
                    return !fi.ViewSpecific && (fi.Host?.Id == host || fi.SuperComponent?.Id == host);
                case Opening o:
                    return o.Host?.Id == host;
            }
            return false;
        }

        /// <summary>Нөөц зам: бүх арматур/family/нүхийг нэг удаа гүйлгэнэ.</summary>
        private Dictionary<ElementId, List<ElementId>> Full()
        {
            if (_full != null)
                return _full;
            var d = new Dictionary<ElementId, List<ElementId>>();
            void Add(ElementId host, ElementId child)
            {
                if (!d.TryGetValue(host, out List<ElementId> l))
                    d[host] = l = new List<ElementId>();
                l.Add(child);
            }
            try
            {
                foreach (Rebar r in new FilteredElementCollector(_doc).OfClass(typeof(Rebar)).Cast<Rebar>())
                {
                    ElementId h = r.GetHostId();
                    if (h != null && h != ElementId.InvalidElementId)
                        Add(h, r.Id);
                }
                foreach (FamilyInstance fi in new FilteredElementCollector(_doc).OfClass(typeof(FamilyInstance))
                             .WhereElementIsNotElementType().Cast<FamilyInstance>())
                {
                    if (fi.ViewSpecific)
                        continue;
                    if (fi.Host != null && !(fi.Host is Level) && !(fi.Host is ReferencePlane))
                        Add(fi.Host.Id, fi.Id);
                    if (fi.SuperComponent != null)
                        Add(fi.SuperComponent.Id, fi.Id);
                }
                foreach (Opening o in new FilteredElementCollector(_doc).OfClass(typeof(Opening)).Cast<Opening>())
                {
                    if (o.Host != null)
                        Add(o.Host.Id, o.Id);
                }
            }
            catch { }
            return _full = d;
        }

        public IEnumerable<Rebar> RebarsOf(ElementId host) =>
            HostedBy(host).Select(_doc.GetElement).OfType<Rebar>();

        /// <summary>Загвар + түүнд суусан бүх элемент (давхар түвшинг хоёр шат хүртэл).</summary>
        public HashSet<ElementId> Related(ElementId root)
        {
            var set = new HashSet<ElementId> { root };
            var queue = new Queue<ElementId>();
            queue.Enqueue(root);
            int guard = 0;
            while (queue.Count > 0 && guard++ < 200)
            {
                foreach (ElementId c in HostedBy(queue.Dequeue()))
                {
                    if (set.Add(c))
                        queue.Enqueue(c);
                }
            }
            return set;
        }
    }

    public static class CdAnalysis
    {
        /// <summary>Загвар/зорилт болж болох элемент уу (ISelectionFilter ч үүнийг дуудна).</summary>
        public static bool IsCloneable(Element e)
        {
            if (e == null || e is ElementType || e.Category == null || e.ViewSpecific)
                return false;
            if (e is View || e is Level || e is Grid || e is ReferencePlane || e is RevitLinkInstance
                || e is Group || e is SpatialElement || e is Rebar)
                return false;
            if (e.Category.CategoryType != CategoryType.Model)
                return false;
            return e.get_BoundingBox(null) != null;
        }

        public static string Mark(Element e)
        {
            try
            {
                string m = e.get_Parameter(BuiltInParameter.ALL_MODEL_MARK)?.AsString();
                return string.IsNullOrWhiteSpace(m) ? null : m.Trim();
            }
            catch
            {
                return null;
            }
        }

        /// <summary>
        /// Элементийг НЭРЭЭР нь таних: «Дам нуруу», «Ферм», «Багана» … (<see cref="ElementKind"/>).
        /// Тэнхлэг, түвшин, туслах хавтгай → null (тэдгээр нь «элемент» биш, лавлах шугам).
        /// </summary>
        public static string KindOf(Document doc, Element e)
        {
            if (e == null || e.Category == null || e is Grid || e is Level || e is ReferencePlane)
                return null;
            string bic = null;
            try
            {
                long v = e.Category.Id.Value;
                if (v < 0)
                    bic = ((BuiltInCategory)(int)v).ToString();
            }
            catch { }
            string fam = null, usage = null;
            string type = doc.GetElement(e.GetTypeId())?.Name;
            if (e is FamilyInstance fi)
            {
                fam = fi.Symbol?.FamilyName;
                try { usage = fi.StructuralUsage.ToString(); } catch { }
                if (usage == "Brace" || usage == "HorizontalBracing" || usage == "KickerBracing")
                    usage = "Brace";
            }
            return ElementKind.Describe(bic, fam, type, usage, e.Category.Name);
        }

        public static string TypeName(Document doc, Element e)
        {
            Element t = doc.GetElement(e.GetTypeId());
            if (t is FamilySymbol fs)
                return fs.FamilyName + ": " + fs.Name;
            return t?.Name ?? e.Name ?? "?";
        }

        /// <summary>
        /// Элементийн түвшин.  ⚠️ Дам нуруу (structural framing) `LevelId`-гүй (-1) — түвшин нь
        /// «Reference Level» параметрт; тэгэхгүй бол бүх дам нуруу «ижил давхар» гэж гарна.
        /// </summary>
        public static ElementId LevelIdOf(Element e)
        {
            ElementId lid = e.LevelId;
            if (lid != null && lid != ElementId.InvalidElementId)
                return lid;
            foreach (BuiltInParameter bip in new[]
                     {
                         BuiltInParameter.INSTANCE_REFERENCE_LEVEL_PARAM, BuiltInParameter.FAMILY_BASE_LEVEL_PARAM,
                         BuiltInParameter.WALL_BASE_CONSTRAINT, BuiltInParameter.SCHEDULE_LEVEL_PARAM,
                     })
            {
                try
                {
                    ElementId p = e.get_Parameter(bip)?.AsElementId();
                    if (p != null && p != ElementId.InvalidElementId)
                        return p;
                }
                catch { }
            }
            return ElementId.InvalidElementId;
        }

        public static string LevelName(Document doc, Element e)
        {
            ElementId lid = LevelIdOf(e);
            return lid == ElementId.InvalidElementId ? null : doc.GetElement(lid)?.Name;
        }

        // ── Загварын шинжилгээ ─────────────────────────────────────────────

        /// <summary>
        /// Загварын ҮНДСЭН мэдээлэл (хүрээ, холбоотой арматур/суусан элемент, тэмдэг) — харагдац хайлтгүй.  Бүтэн
        /// <see cref="AnalyzeTemplate"/> нь үүнийг эхлээд дуудна; «Загвар харагдацаас хуулах» (<see cref="CdOntoView"/>) зөвхөн
        /// үүнийг хэрэглэнэ (харагдацыг хэрэглэгч өөрөө нэрээр нь сонгосон тул хайх шаардлагагүй).
        /// </summary>
        internal static CdTemplateInfo CoreInfo(Document doc, Element tpl, CdHostIndex hosts)
        {
            var info = new CdTemplateInfo
            {
                Id = tpl.Id,
                UniqueId = tpl.UniqueId,
                CategoryId = tpl.Category.Id,
                CategoryName = tpl.Category.Name,
                TypeName = TypeName(doc, tpl),
                TypeId = tpl.GetTypeId(),
                Mark = Mark(tpl),
                LevelId = LevelIdOf(tpl),
                Frame = CdFrame.Of(tpl),
                Kind = KindOf(doc, tpl) ?? tpl.Category.Name,
            };
            info.Label = CloneNaming.TargetLabel(info.Mark, tpl.Id.Value);
            info.Related = hosts.Related(tpl.Id);
            info.RebarCount = hosts.RebarsOf(tpl.Id).Count();
            return info;
        }

        /// <summary>
        /// Загварын шинжилгээ — ХУРДАН.  Файлын бүх tag, хэмжээс, харагдацыг гүйлгэхгүй:
        ///   1. Загвар (ба арматур/суусан элемент)-аас ХАМААРАЛТАЙ tag, хэмжээс, spot, MRA — Revit-ийн
        ///      хамаарлын граф (`GetDependentElements`).  Snowdon дээр хэмжсэн: 2 мс vs бүтэн гүйлгэлт 51 мс,
        ///      үр дүн ижил (5 tag, 4 хэмжээс, 5 харагдац).
        ///   2. ЭЛЕМЕНТИЙН НЭРЭЭР — харагдац/хуудасны нэрэнд тэмдэг («B1») бүтэн үгээр орсон бол.
        ///   3. Гараар холбосон харагдац (файлд хадгалсан).
        ///   4. Олдсон харагдацуудад л 3+ лавлагаатай хэмжээсийг нэмж тоолно (хамаарлын графт ордоггүй).
        /// Загварыг харуулдаг бусад бүх харагдацыг хайх (удаан — харагдац бүрд харагдах байдлын тооцоо)
        /// нь зөвхөн инженер хүсвэл: <see cref="FindCandidates"/>.
        /// </summary>
        public static CdTemplateInfo AnalyzeTemplate(Document doc, Element tpl, CdHostIndex hosts)
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            CdTemplateInfo info = CoreInfo(doc, tpl, hosts);

            var byView = new Dictionary<ElementId, CdLinkedView>();
            CdLinkedView Slot(ElementId viewId)
            {
                if (!byView.TryGetValue(viewId, out CdLinkedView lv))
                    byView[viewId] = lv = new CdLinkedView { ViewId = viewId };
                return lv;
            }

            // 1. Хамаарлын граф.
            var seenDims = new HashSet<ElementId>();
            if (!CountDependents(doc, info, Slot, seenDims))
                CountByFullScan(doc, info, Slot, seenDims);

            // 2. Нэрээр.
            BoundingBoxXYZ box = tpl.get_BoundingBox(null);
            foreach (View v in ViewsNamedFor(doc, info.Mark))
            {
                if (byView.TryGetValue(v.Id, out CdLinkedView have))
                {
                    have.ByName = true;
                    continue;
                }
                if (box != null && ShowsRegion(v, box))
                    Slot(v.Id).ByName = true;
            }

            // 3. Гараар холбосон харагдацууд (өмнөх ажиллуулалтаас).
            foreach (string uid in CdLinks.ManualViews(tpl))
            {
                if (doc.GetElement(uid) is View mv && !byView.ContainsKey(mv.Id))
                    Slot(mv.Id).Manual = true;
            }

            // 4. Олдсон харагдацын 3+ лавлагаатай хэмжээс (загвар устахад үлддэг тул графт ордоггүй).
            HashSet<ElementId> mraDims = null;
            foreach (CdLinkedView lv in byView.Values)
            {
                foreach (Dimension d in new FilteredElementCollector(doc).OwnedByView(lv.ViewId).OfClass(typeof(Dimension)).Cast<Dimension>())
                {
                    if (seenDims.Contains(d.Id) || !RefersTo(d, info.Related))
                        continue;
                    seenDims.Add(d.Id);
                    if (mraDims == null)
                        mraDims = MraDimensionIds(doc);
                    if (mraDims.Contains(d.Id)) lv.Mra++;
                    else if (d is SpotDimension) lv.Spots++;
                    else lv.Dims++;
                }
            }

            Dictionary<ElementId, ViewSheet> sheetOf = SheetsByView(doc);
            foreach (CdLinkedView lv in byView.Values)
            {
                if (!(doc.GetElement(lv.ViewId) is View v) || v.IsTemplate || v is ViewSheet || v is ViewSchedule
                    || v.ViewType == ViewType.DraftingView || v.ViewType == ViewType.Legend)
                    continue;
                Describe(doc, v, info, lv, sheetOf);
                info.Views.Add(lv);
            }
            info.Views = info.Views.OrderBy(v => v.SheetNumber ?? "~").ThenBy(v => v.Name).ToList();
            info.Candidates = new List<CdLinkedView>();
            Classify(doc, info, info.Views);
            info.AnnotationKinds = AggregateKinds(info, info.Views.Where(v =>
                ViewRelevanceRule.DefaultSelected(v.Relevance) && v.Dedicated && v.Mode == CdViewMode.NewView));
            info.AnalyzeMs = sw.ElapsedMilliseconds;
            return info;
        }

        // ── 1.9.1: харагдацын ангилал ──────────────────────────────────────

        /// <summary>
        /// Харагдац бүрийг «өөрийн зураг / ерөнхий / бусад элементийн» гэж ангилна (<see cref="ViewRelevanceRule"/>).
        /// ⚠️ ГОЛ ШАЛТГААН (2026-10-01): тусгай харагдацын БҮХ tag (хөршийнх ч) клонлогддог тул B1-ийг B2…B9 руу
        /// клонлосны дараа B1 нь B2-ийн зүсэлтэд хөрш болж tag-лагдана → дахин хувилахад B2…B9-ийн харагдац бүр
        /// «B1-ийн зураг» болж ирээд зорилт бүрд дахин хуулагддаг байв.  Клон харагдац нь Extensible Storage-д
        /// (`CdLinks`) аль элементэд зориулагдсанаа тээдэг — үүгээр ялгана.  Тусгай харагдацын tag/хэмжээсийг
        /// мөн энд элементийн төрлөөр тоолно (хуучин `AnnotationKinds`-ийн ажил, нэг гүйлгэлтэд).
        /// </summary>
        internal static void Classify(Document doc, CdTemplateInfo info, List<CdLinkedView> views)
        {
            var kindCache = new Dictionary<ElementId, string>();
            string KindCached(Element e)
            {
                if (e == null)
                    return null;
                if (!kindCache.TryGetValue(e.Id, out string k))
                    kindCache[e.Id] = k = KindOf(doc, e);
                return k;
            }

            var facts = new List<KeyValuePair<CdLinkedView, ViewFacts>>();
            foreach (CdLinkedView lv in views)
            {
                if (!(doc.GetElement(lv.ViewId) is View v))
                    continue;
                var f = new ViewFacts { Manual = lv.Manual, ByName = lv.ByName, Dedicated = lv.Dedicated };
                string note = null;
                CdLinks.Record rec = CdLinks.Read(v);
                if (rec != null && rec.Kind == CdLinks.KindView && !string.IsNullOrEmpty(rec.TargetUid))
                {
                    if (string.Equals(rec.TargetUid, info.UniqueId, StringComparison.Ordinal))
                    {
                        f.CloneOfTemplate = true;
                        note = "«" + info.Label + "»-д хувилсан";
                    }
                    else
                    {
                        f.CloneOfOther = true;
                        note = "«" + LabelOfUid(doc, rec.TargetUid) + "»-д хувилсан харагдац";
                    }
                }
                if (lv.Dedicated)
                {
                    string subject = ScanDedicated(doc, info, v, lv, f, KindCached);
                    if (note == null && subject != null)
                        note = subject;
                }
                lv.RelevanceNote = note;
                facts.Add(new KeyValuePair<CdLinkedView, ViewFacts>(lv, f));
            }

            foreach (KeyValuePair<CdLinkedView, ViewFacts> kv in facts)
                kv.Key.Relevance = ViewRelevanceRule.Classify(kv.Value);
            // Өөрийн зургийн callout (B1-ийн уртын зүсэлт дээрх үзүүрийн дэлгэрэнгүй) — өөрийн.  Хоёр давхар callout-д хоёр удаа.
            for (int pass = 0; pass < 2; pass++)
            {
                var own = new HashSet<ElementId>(facts.Where(kv => kv.Key.Relevance == ViewRelevance.Own).Select(kv => kv.Key.ViewId));
                foreach (KeyValuePair<CdLinkedView, ViewFacts> kv in facts)
                {
                    CdLinkedView lv = kv.Key;
                    if (!lv.IsCallout || lv.CalloutParentId == null || !own.Contains(lv.CalloutParentId) || kv.Value.ParentIsOwn)
                        continue;
                    kv.Value.ParentIsOwn = true;
                    lv.Relevance = ViewRelevanceRule.Classify(kv.Value);
                }
            }
            foreach (KeyValuePair<CdLinkedView, ViewFacts> kv in facts)
            {
                CdLinkedView lv = kv.Key;
                ViewFacts f = kv.Value;
                if (lv.Relevance == ViewRelevance.Own)
                {
                    lv.RelevanceNote = f.Manual ? (lv.Found ? "хайж олсон" : "гараар холбосон")
                        : f.CloneOfTemplate ? lv.RelevanceNote
                        : f.ByName ? "нэрэнд «" + info.Label + "»"
                        : f.ParentIsOwn ? "өөрийн зургийн callout"
                        : null;
                }
                else if (lv.Relevance == ViewRelevance.General)
                {
                    lv.RelevanceNote = "ерөнхий харагдац";
                }
                else if (string.IsNullOrEmpty(lv.RelevanceNote))
                {
                    lv.RelevanceNote = "өөр элементийн зураг";
                }
            }
        }

        /// <summary>
        /// Тусгай харагдацын tag/хэмжээсийг уншина: (1) элементийн төрлөөр тоо (цонхны «аль элементийн tag»),
        /// (2) элемент тутмын лавлагааны тоо, (3) тайрах хүрээний төв ямар элемент дээр байна вэ.
        /// Буцаах утга — «бусад» гэж үзэх шалтгааны тайлбар (эсвэл null).
        /// </summary>
        private static string ScanDedicated(Document doc, CdTemplateInfo info, View v, CdLinkedView lv, ViewFacts f,
            Func<Element, string> kindOf)
        {
            var refs = new Dictionary<ElementId, int>();
            var kinds = new Dictionary<string, CdAnnKind>();
            int tplRefs = 0;
            CdAnnKind Get(string kind)
            {
                if (!kinds.TryGetValue(kind, out CdAnnKind a))
                    kinds[kind] = a = new CdAnnKind { Kind = kind, IsTemplate = kind == info.Kind };
                return a;
            }
            void Count(ElementId id, Element e)
            {
                if (info.Related.Contains(id))
                {
                    tplRefs++;
                    return;
                }
                if (e == null || e is Grid || e is Level || e is ReferencePlane || e.ViewSpecific)
                    return;
                refs.TryGetValue(id, out int n);
                refs[id] = n + 1;
            }

            foreach (Element e in new FilteredElementCollector(doc).OwnedByView(v.Id).WhereElementIsNotElementType()
                         .WherePasses(new ElementMulticlassFilter(new List<Type> { typeof(IndependentTag), typeof(Dimension), typeof(SpatialElementTag) })))
            {
                try
                {
                    if (e is IndependentTag t)
                    {
                        foreach (ElementId id in t.GetTaggedLocalElementIds())
                        {
                            Element te = doc.GetElement(id);
                            string k = info.Related.Contains(id) ? info.Kind : kindOf(te);
                            if (k != null)
                                Get(k).Tags++;
                            Count(id, te);
                        }
                    }
                    else if (e is SpatialElementTag)
                    {
                        Get("Өрөө").Tags++;
                    }
                    else if (e is Dimension d && d.References != null)
                    {
                        var ks = new HashSet<string>();
                        foreach (Reference r in d.References)
                        {
                            if (r == null || r.LinkedElementId != ElementId.InvalidElementId)
                                continue;
                            Element re = doc.GetElement(r.ElementId);
                            string k = info.Related.Contains(r.ElementId) ? info.Kind : kindOf(re);
                            if (k != null)
                                ks.Add(k);
                            Count(r.ElementId, re);
                        }
                        foreach (string k in ks)
                            Get(k).Dims++;
                    }
                }
                catch { }
            }
            lv.Kinds = kinds.Values.ToList();

            f.TemplateRefs = tplRefs;
            f.TemplateCentered = Centered(v, info.Frame.WorldCorners());
            string why = null;
            // Хамгийн их лавлагаатай нь эхэнд — эхний төвд байгаа нь «хамгийн их лавлагаатай төвийн элемент».
            foreach (KeyValuePair<ElementId, int> kv in refs.OrderByDescending(x => x.Value).ThenBy(x => x.Key.Value))
            {
                Element oe = doc.GetElement(kv.Key);
                BoundingBoxXYZ bb = oe?.get_BoundingBox(null);
                if (bb == null || !Centered(v, CdFrame.Corners(bb.Min, bb.Max)))
                    continue;
                f.OtherCentered = true;
                f.OtherCenteredRefs = kv.Value;
                why = (KindOf(doc, oe) ?? oe.Category?.Name ?? "Элемент") + " «" + CloneNaming.TargetLabel(Mark(oe), oe.Id.Value) + "»-ийн зураг";
                break;
            }
            if (!f.ByName)
            {
                foreach (ElementId id in refs.Keys.OrderBy(x => x.Value))
                {
                    Element oe = doc.GetElement(id);
                    string mark = oe == null ? null : Mark(oe);
                    if (!CloneNaming.IsReplaceableMark(mark) || string.Equals(mark, info.Mark, StringComparison.Ordinal))
                        continue;
                    if (NameMatch.ContainsMark(v.Name, mark) || NameMatch.ContainsMark(lv.SheetNumber, mark)
                        || NameMatch.ContainsMark(lv.SheetName, mark))
                    {
                        f.NamedForOther = true;
                        why = "нэр нь «" + mark + "»-ийнх";
                        break;
                    }
                }
            }
            return why;
        }

        /// <summary>
        /// Харагдацын тайрах хүрээний (3D-д section box) ТӨВ элемент дээр байна уу, ба элементийн ихэнх нь (≥ 50%)
        /// хүрээн дотор уу.  Хүрээний тэнхлэг бүрт 25%-ийн хүлцэл (зүсэлтийн доод талд хэмжээсийн зай их байдаг).
        /// ⚠️ «ихэнх нь дотор» хэрэгтэй: баганын план callout-ийн төв нь дам нурууны ҮЗҮҮР дээр бас таардаг —
        /// гэхдээ 6 м дам нурууны 1 м л хүрээнд орно, багана бүтнээрээ орно.
        /// </summary>
        internal static bool Centered(View v, IEnumerable<XYZ> worldCorners)
        {
            try
            {
                BoundingBoxXYZ cb;
                int axes;
                if (v is View3D v3)
                {
                    if (!v3.IsSectionBoxActive)
                        return false;
                    cb = v3.GetSectionBox();
                    axes = 3;
                }
                else
                {
                    if (!v.CropBoxActive)
                        return false;
                    cb = v.CropBox;
                    axes = 2;
                }
                Transform inv = cb.Transform.Inverse;
                double[] lo = { double.MaxValue, double.MaxValue, double.MaxValue };
                double[] hi = { double.MinValue, double.MinValue, double.MinValue };
                bool any = false;
                foreach (XYZ p in worldCorners)
                {
                    XYZ q = inv.OfPoint(p);
                    lo[0] = Math.Min(lo[0], q.X); hi[0] = Math.Max(hi[0], q.X);
                    lo[1] = Math.Min(lo[1], q.Y); hi[1] = Math.Max(hi[1], q.Y);
                    lo[2] = Math.Min(lo[2], q.Z); hi[2] = Math.Max(hi[2], q.Z);
                    any = true;
                }
                if (!any)
                    return false;
                double[] cmin = { cb.Min.X, cb.Min.Y, cb.Min.Z };
                double[] cmax = { cb.Max.X, cb.Max.Y, cb.Max.Z };
                for (int i = 0; i < axes; i++)
                {
                    double a = Math.Min(cmin[i], cmax[i]), b = Math.Max(cmin[i], cmax[i]);
                    double center = (a + b) / 2, tol = 0.25 * (b - a);
                    if (center < lo[i] - tol || center > hi[i] + tol)
                        return false;
                    double extent = hi[i] - lo[i];
                    if (extent > 1e-3)
                    {
                        double inside = Math.Min(hi[i], b) - Math.Max(lo[i], a);
                        if (inside / extent < 0.5)
                            return false;
                    }
                }
                return true;
            }
            catch
            {
                return false;
            }
        }

        private static string LabelOfUid(Document doc, string uid)
        {
            try
            {
                Element e = doc.GetElement(uid);
                return e == null ? "устсан элемент" : CloneNaming.TargetLabel(Mark(e), e.Id.Value);
            }
            catch
            {
                return "өөр элемент";
            }
        }

        /// <summary>
        /// Сонгосон тусгай харагдацуудын tag/хэмжээсийг элементийн төрлөөр нэгтгэнэ — «Дам нуруу: tag 3, хэмжээс 4»,
        /// «Ферм: tag 2» …  Цонх харагдацын сонголт өөрчлөгдөх бүрд дахин дуудна (Revit API дуудахгүй — кэшлэсэн тоо).
        /// </summary>
        public static List<CdAnnKind> AggregateKinds(CdTemplateInfo info, IEnumerable<CdLinkedView> views)
        {
            var map = new Dictionary<string, CdAnnKind>();
            CdAnnKind Get(string kind)
            {
                if (!map.TryGetValue(kind, out CdAnnKind a))
                    map[kind] = a = new CdAnnKind { Kind = kind, IsTemplate = kind == info.Kind };
                return a;
            }
            foreach (CdLinkedView lv in views)
            {
                foreach (CdAnnKind k in lv.Kinds ?? new List<CdAnnKind>())
                {
                    CdAnnKind a = Get(k.Kind);
                    a.Tags += k.Tags;
                    a.Dims += k.Dims;
                }
            }
            Get(info.Kind);
            return map.Values.OrderBy(a => a.IsTemplate ? 0 : 1).ThenByDescending(a => a.Tags + a.Dims)
                .ThenBy(a => a.Kind, StringComparer.CurrentCulture).ToList();
        }

        /// <summary>Хамаарлын графаар tag/хэмжээс/spot/MRA тоолно.  Revit татгалзвал false.</summary>
        private static bool CountDependents(Document doc, CdTemplateInfo info, Func<ElementId, CdLinkedView> slot,
            HashSet<ElementId> seenDims)
        {
            var ann = new ElementMulticlassFilter(new List<Type>
                { typeof(IndependentTag), typeof(Dimension), typeof(MultiReferenceAnnotation) });
            var found = new List<Element>();
            try
            {
                foreach (ElementId rid in info.Related)
                {
                    Element re = doc.GetElement(rid);
                    if (re == null)
                        continue;
                    foreach (ElementId id in re.GetDependentElements(ann))
                    {
                        Element e = doc.GetElement(id);
                        if (e != null && e.OwnerViewId != ElementId.InvalidElementId)
                            found.Add(e);
                    }
                }
            }
            catch
            {
                return false;
            }
            // MRA-ийн дотоод tag, хэмжээсийг тусад нь тоолохгүй.
            var mraParts = new HashSet<ElementId>();
            foreach (MultiReferenceAnnotation m in found.OfType<MultiReferenceAnnotation>())
            {
                mraParts.Add(m.DimensionId);
                mraParts.Add(m.TagId);
            }
            var seen = new HashSet<ElementId>();
            foreach (Element e in found)
            {
                if (!seen.Add(e.Id) || mraParts.Contains(e.Id))
                    continue;
                CdLinkedView lv = slot(e.OwnerViewId);
                if (e is MultiReferenceAnnotation) lv.Mra++;
                else if (e is IndependentTag) lv.Tags++;
                else if (e is SpotDimension) { lv.Spots++; seenDims.Add(e.Id); }
                else if (e is Dimension) { lv.Dims++; seenDims.Add(e.Id); }
            }
            foreach (ElementId id in mraParts)
                seenDims.Add(id);
            return true;
        }

        /// <summary>Нөөц зам (хамаарлын граф ажиллахгүй үед): бүх tag, хэмжээсийг гүйлгэнэ.</summary>
        private static void CountByFullScan(Document doc, CdTemplateInfo info, Func<ElementId, CdLinkedView> slot,
            HashSet<ElementId> seenDims)
        {
            foreach (IndependentTag tag in new FilteredElementCollector(doc).OfClass(typeof(IndependentTag)).Cast<IndependentTag>())
            {
                if (tag.OwnerViewId == ElementId.InvalidElementId)
                    continue;
                ICollection<ElementId> ids;
                try { ids = tag.GetTaggedLocalElementIds(); }
                catch { continue; }
                if (ids.Any(info.Related.Contains))
                    slot(tag.OwnerViewId).Tags++;
            }
            HashSet<ElementId> mraDims = MraDimensionIds(doc);
            foreach (Dimension d in new FilteredElementCollector(doc).OfClass(typeof(Dimension)).Cast<Dimension>())
            {
                if (d.OwnerViewId == ElementId.InvalidElementId || !RefersTo(d, info.Related))
                    continue;
                seenDims.Add(d.Id);
                CdLinkedView lv = slot(d.OwnerViewId);
                if (mraDims.Contains(d.Id)) lv.Mra++;
                else if (d is SpotDimension) lv.Spots++;
                else lv.Dims++;
            }
        }

        /// <summary>
        /// Нэрэнд загварын тэмдэг («B1») бүтэн үгээр орсон харагдац + ийм нэр/дугаартай хуудсан
        /// дээрх харагдацууд.  Тэмдэггүй эсвэл «1» шиг хоёрдмол бол хоосон.
        /// </summary>
        public static List<View> ViewsNamedFor(Document doc, string mark)
        {
            var result = new List<View>();
            if (!CloneNaming.IsReplaceableMark(mark))
                return result;
            var ids = new HashSet<ElementId>();
            foreach (View v in new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>())
            {
                if (v.IsTemplate)
                    continue;
                if (v is ViewSheet sh)
                {
                    if (!NameMatch.ContainsMark(sh.SheetNumber, mark) && !NameMatch.ContainsMark(sh.Name, mark))
                        continue;
                    foreach (ElementId vid in sh.GetAllPlacedViews())
                    {
                        if (doc.GetElement(vid) is View pv && !pv.IsTemplate && ids.Add(pv.Id))
                            result.Add(pv);
                    }
                }
                else if (NameMatch.ContainsMark(v.Name, mark) && ids.Add(v.Id))
                {
                    result.Add(v);
                }
            }
            return result;
        }

        /// <summary>Харагдацын тайрах хүрээ / section box загварын хүрээтэй огтлолцох уу (харагдах байдлын тооцоогүй, хурдан).</summary>
        private static bool ShowsRegion(View v, BoundingBoxXYZ box)
        {
            if (v is ViewSheet || v is ViewSchedule || v.ViewType == ViewType.DraftingView || v.ViewType == ViewType.Legend)
                return false;
            if (v is View3D v3)
            {
                if (!v3.IsSectionBoxActive)
                    return true;
                try
                {
                    BoundingBoxXYZ sb = v3.GetSectionBox();
                    Transform inv = sb.Transform.Inverse;
                    var pts = CdFrame.Corners(box.Min, box.Max).Select(inv.OfPoint).ToList();
                    return pts.Max(p => p.X) >= sb.Min.X && pts.Min(p => p.X) <= sb.Max.X
                           && pts.Max(p => p.Y) >= sb.Min.Y && pts.Min(p => p.Y) <= sb.Max.Y
                           && pts.Max(p => p.Z) >= sb.Min.Z && pts.Min(p => p.Z) <= sb.Max.Z;
                }
                catch
                {
                    return true;
                }
            }
            return !v.CropBoxActive || CropIntersects(v, box);
        }

        private static void Describe(Document doc, View v, CdTemplateInfo info, CdLinkedView lv,
            Dictionary<ElementId, ViewSheet> sheetOf)
        {
            lv.UniqueId = v.UniqueId;
            lv.Name = v.Name;
            lv.ViewType = v.ViewType;
            lv.TypeLabel = TypeLabel(v);
            try
            {
                lv.IsCallout = v.IsCallout;
                lv.CalloutParentId = v.IsCallout ? v.GetCalloutParentId() : ElementId.InvalidElementId;
            }
            catch
            {
                lv.CalloutParentId = ElementId.InvalidElementId;
            }
            lv.TypeGroup = ViewTypeGroups.Of(v.ViewType.ToString(), lv.IsCallout);
            if (sheetOf.TryGetValue(v.Id, out ViewSheet sh))
            {
                lv.SheetId = sh.Id;
                lv.SheetNumber = sh.SheetNumber;
                lv.SheetName = sh.Name;
            }
            lv.CanClone = CanCloneType(v);
            lv.Dedicated = lv.CanClone && IsDedicated(v, info.Frame);
            lv.Mode = lv.Dedicated ? CdViewMode.NewView : CdViewMode.InPlace;
            if (lv.Dedicated)
                lv.Details = CdEngine.DetailElements(doc, v).Count;
        }

        public static string TypeLabel(View v)
        {
            string callout = SafeIsCallout(v) ? " (callout)" : "";
            switch (v.ViewType)
            {
                case ViewType.Section: return "Зүсэлт" + callout;
                case ViewType.Detail: return "Дэлгэрэнгүй" + callout;
                case ViewType.Elevation: return "Фасад" + callout;
                case ViewType.CeilingPlan: return "Таазны план" + callout;
                case ViewType.EngineeringPlan: return "Бүтээцийн план" + callout;
                case ViewType.AreaPlan: return "Талбайн план";
                case ViewType.ThreeD: return "3D";
                case ViewType.FloorPlan:
                    return v.GetPrimaryViewId() != ElementId.InvalidElementId ? "План (dependent)" : "План" + callout;
                default: return v.ViewType.ToString();
            }
        }

        private static bool SafeIsCallout(View v)
        {
            try { return v.IsCallout; }
            catch { return false; }
        }

        /// <summary>Зорилт бүрд ШИНЭ харагдац болгож болох төрөл.</summary>
        public static bool CanCloneType(View v)
        {
            switch (v.ViewType)
            {
                case ViewType.FloorPlan:
                case ViewType.CeilingPlan:
                case ViewType.EngineeringPlan:
                case ViewType.Section:
                case ViewType.Detail:
                case ViewType.Elevation:
                    return v.CropBoxActive;
                case ViewType.ThreeD:
                    return v is View3D v3 && !v3.IsPerspective && v3.IsSectionBoxActive;
                default:
                    return false;
            }
        }

        /// <summary>Тайрах хүрээ (3D-д section box) загварын хэмжээнд ойр уу.</summary>
        public static bool IsDedicated(View v, CdFrame frame)
        {
            try
            {
                if (v is View3D v3)
                {
                    BoundingBoxXYZ sb = v3.GetSectionBox();
                    Transform bt = sb.Transform;
                    XYZ size = sb.Max - sb.Min;
                    double[] e = ProjectExtents(frame, new[] { bt.BasisX, bt.BasisY, bt.BasisZ });
                    return DedicatedRule.IsDedicated3(Math.Abs(size.X), Math.Abs(size.Y), Math.Abs(size.Z), e[0], e[1], e[2]);
                }
                if (!v.CropBoxActive)
                    return false;
                BoundingBoxXYZ cb = v.CropBox;
                XYZ s = cb.Max - cb.Min;
                double[] pe = ProjectExtents(frame, new[] { v.RightDirection, v.UpDirection });
                return DedicatedRule.IsDedicated(Math.Abs(s.X), Math.Abs(s.Y), pe[0], pe[1]);
            }
            catch
            {
                return false;
            }
        }

        /// <summary>Хүрээний 8 булангийн тэнхлэг бүр дээрх проекцийн өргөн.</summary>
        private static double[] ProjectExtents(CdFrame frame, XYZ[] axes)
        {
            var r = new double[axes.Length];
            XYZ[] corners = frame.WorldCorners().ToArray();
            for (int i = 0; i < axes.Length; i++)
            {
                double lo = double.MaxValue, hi = double.MinValue;
                foreach (XYZ c in corners)
                {
                    double d = c.DotProduct(axes[i]);
                    lo = Math.Min(lo, d);
                    hi = Math.Max(hi, d);
                }
                r[i] = hi - lo;
            }
            return r;
        }

        /// <summary>
        /// ГҮН ХАЙЛТ (инженер «Бусад харагдац хайх» дарвал л): загварыг ТУСГАЙЛАН харуулдаг, tag/хэмжээсгүй
        /// харагдацууд.  Хурдан шүүлтүүдийг эхэнд (төрөл → тайрах хүрээ огтлолцох → загварын хэмжээнд
        /// ойр), харагдах байдлын тооцоог хамгийн сүүлд, ЗӨВХӨН загвар элементэд (ElementIdSetFilter).
        /// </summary>
        public static List<CdLinkedView> FindCandidates(Document doc, Element tpl, CdTemplateInfo info)
        {
            var result = new List<CdLinkedView>();
            var linked = new HashSet<ElementId>(info.Views.Select(v => v.ViewId).Concat(info.Candidates.Select(v => v.ViewId)));
            BoundingBoxXYZ box = tpl.get_BoundingBox(null);
            if (box == null)
                return result;
            Dictionary<ElementId, ViewSheet> sheetOf = SheetsByView(doc);
            var only = new List<ElementId> { tpl.Id };
            foreach (View v in new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>())
            {
                if (v.IsTemplate || linked.Contains(v.Id) || !CanCloneType(v))
                    continue;
                if (!ShowsRegion(v, box) || !IsDedicated(v, info.Frame))
                    continue;
                // 1.9.1: ӨӨР элементэд хувилсан харагдац (B2-ийн зүсэлтэд B1 хөрш болж харагддаг) нь B1-ийн зураг БИШ.
                CdLinks.Record rec = CdLinks.Read(v);
                if (rec != null && rec.Kind == CdLinks.KindView && !string.IsNullOrEmpty(rec.TargetUid)
                    && !string.Equals(rec.TargetUid, info.UniqueId, StringComparison.Ordinal))
                    continue;
                try
                {
                    if (!new FilteredElementCollector(doc, v.Id).WherePasses(new ElementIdSetFilter(only)).Any())
                        continue;
                }
                catch
                {
                    continue;
                }
                var lv = new CdLinkedView { ViewId = v.Id, Manual = true, Found = true };
                Describe(doc, v, info, lv, sheetOf);
                lv.Mode = CdViewMode.NewView;
                result.Add(lv);
                if (result.Count >= 80)
                    break;
            }
            Classify(doc, info, result);
            return result.OrderBy(v => v.SheetNumber ?? "~").ThenBy(v => v.Name).ToList();
        }

        internal static bool CropIntersects(View v, BoundingBoxXYZ region)
        {
            try
            {
                BoundingBoxXYZ cb = v.CropBox;
                Transform inv = cb.Transform.Inverse;
                double minX = double.MaxValue, minY = double.MaxValue, minZ = double.MaxValue;
                double maxX = double.MinValue, maxY = double.MinValue, maxZ = double.MinValue;
                foreach (XYZ c in CdFrame.Corners(region.Min, region.Max))
                {
                    XYZ q = inv.OfPoint(c);
                    minX = Math.Min(minX, q.X); maxX = Math.Max(maxX, q.X);
                    minY = Math.Min(minY, q.Y); maxY = Math.Max(maxY, q.Y);
                    minZ = Math.Min(minZ, q.Z); maxZ = Math.Max(maxZ, q.Z);
                }
                bool xy = maxX >= cb.Min.X && minX <= cb.Max.X && maxY >= cb.Min.Y && minY <= cb.Max.Y;
                return v is ViewSection ? xy && maxZ >= cb.Min.Z && minZ <= cb.Max.Z : xy;
            }
            catch
            {
                return false;
            }
        }

        public static HashSet<ElementId> MraDimensionIds(Document doc)
        {
            var set = new HashSet<ElementId>();
            try
            {
                foreach (MultiReferenceAnnotation m in new FilteredElementCollector(doc).OfClass(typeof(MultiReferenceAnnotation))
                             .Cast<MultiReferenceAnnotation>())
                {
                    if (m.DimensionId != null && m.DimensionId != ElementId.InvalidElementId)
                        set.Add(m.DimensionId);
                }
            }
            catch { }
            return set;
        }

        public static HashSet<ElementId> MraTagIds(Document doc)
        {
            var set = new HashSet<ElementId>();
            try
            {
                foreach (MultiReferenceAnnotation m in new FilteredElementCollector(doc).OfClass(typeof(MultiReferenceAnnotation))
                             .Cast<MultiReferenceAnnotation>())
                {
                    if (m.TagId != null && m.TagId != ElementId.InvalidElementId)
                        set.Add(m.TagId);
                }
            }
            catch { }
            return set;
        }

        internal static bool RefersTo(Dimension d, HashSet<ElementId> ids)
        {
            try
            {
                ReferenceArray refs = d.References;
                if (refs == null)
                    return false;
                foreach (Reference r in refs)
                {
                    if (r != null && r.LinkedElementId == ElementId.InvalidElementId && ids.Contains(r.ElementId))
                        return true;
                }
            }
            catch { }
            return false;
        }

        public static Dictionary<ElementId, ViewSheet> SheetsByView(Document doc)
        {
            var d = new Dictionary<ElementId, ViewSheet>();
            foreach (Viewport vp in new FilteredElementCollector(doc).OfClass(typeof(Viewport)).Cast<Viewport>())
            {
                if (doc.GetElement(vp.SheetId) is ViewSheet s)
                    d[vp.ViewId] = s;
            }
            return d;
        }

        // ── Зорилт ─────────────────────────────────────────────────────────

        public static CdTargetInfo DescribeTarget(Document doc, CdTemplateInfo tpl, Element t, CdLinks.CloneIndex clones)
        {
            CdFrame fb = CdFrame.Of(t, tpl.Frame);
            var map = new CdMap(tpl.Frame, fb);
            string levelName = LevelName(doc, t);
            var facts = new TargetFacts
            {
                SameType = t.GetTypeId() == tpl.TypeId,
                TypeName = TypeName(doc, t),
                SizeA = new[] { tpl.Frame.Size.X, tpl.Frame.Size.Y, tpl.Frame.Size.Z },
                SizeB = new[] { fb.Size.X, fb.Size.Y, fb.Size.Z },
                PlanAngleDeg = map.PlanAngle * 180.0 / Math.PI,
                Mirrored = !map.IsRigid,
                SameLevel = LevelIdOf(t) == tpl.LevelId,
                FrameKind = fb.Kind == CdFrameKind.Curve ? "curve" : fb.Kind == CdFrameKind.Point ? "point" : "box",
                VerticalAxis = fb.VerticalAxis,
            };
            string mark = Mark(t);
            return new CdTargetInfo
            {
                Id = t.Id,
                UniqueId = t.UniqueId,
                Mark = mark,
                Label = CloneNaming.TargetLabel(mark, t.Id.Value),
                TypeName = facts.TypeName,
                LevelName = levelName,
                GroupKey = TargetGrouping.GroupKey(facts),
                GroupLabel = TargetGrouping.GroupLabel(facts),
                Details = TargetGrouping.Details(facts, levelName),
                ExistingClones = clones.ForTarget(t.UniqueId).Count(id => doc.GetElement(id) != null),
                Facts = facts,
            };
        }

        /// <summary>Загвартай ижил ангиллын (эсвэл ижил төрлийн) бүх элемент — цонхны «+ бүгдийг нэмэх».</summary>
        public static List<Element> SameCategory(Document doc, CdTemplateInfo tpl, bool sameTypeOnly)
        {
            return new FilteredElementCollector(doc).OfCategoryId(tpl.CategoryId).WhereElementIsNotElementType()
                .Where(e => e.Id != tpl.Id && IsCloneable(e) && (!sameTypeOnly || e.GetTypeId() == tpl.TypeId))
                .ToList();
        }
    }
}
