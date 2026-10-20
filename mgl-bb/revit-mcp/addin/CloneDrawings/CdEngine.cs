using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using RevitMcpAddin.CloneDrawings.Core;

namespace RevitMcpAddin.CloneDrawings
{
    // ══════════════════════════════════════════════════════════════════════
    //  «Зураг хувилах» — UI-гүй цөм (2026-09-30).
    //
    //  GRAITEC PowerPack «Clone Drawings»-ийн санаа: загвар элементийн (жишээ нь
    //  B1 дам нуруу) зурсан зургийг — зүсэлт, callout, план, 3D, хуудас, tag,
    //  хэмжээс, 2D — ИЖИЛ АНГИЛЛЫН бусад элемент рүү (B2…B9) хуулна.  Зорилтын
    //  урт/өндөр, эргэлт өөр байж болно: байрлал бүрийг <see cref="CdMap"/>-аар
    //  «сунгаж» буулгана, хэмжээсийг зорилтын ИЖИЛ нүүр рүү дахин холбоно.
    //
    //  Нэг зорилт = нээлттэй нэг Transaction (команд эзэмшинэ).  Энд зөвхөн
    //  SubTransaction.  Тест харness ч (Revit дотор reflection-оор) ЯГ энэ кодыг дуудна.
    // ══════════════════════════════════════════════════════════════════════

    /// <summary>Нэг ажиллуулалтын бэлтгэл — бүх зорилтод нэг удаа.</summary>
    public sealed class CdPlan
    {
        public Document Doc;
        public Element Template;
        public CdTemplateInfo Info;
        public List<CdLinkedView> Views;
        public CdOptions Options;
        public CdHostIndex Hosts;
        public CdLinks.CloneIndex Clones;
        internal readonly Dictionary<ElementId, CdSourceAnnotations> Sources = new Dictionary<ElementId, CdSourceAnnotations>();
        internal HashSet<string> ViewNames;
        internal HashSet<string> SheetNumbers;
        internal List<Grid> Grids;
        internal List<Level> Levels;
        internal List<Viewport> Viewports;
        internal List<ReferencePlane> RefPlanes;
        /// <summary>Байранд нь нэмэх (ерөнхий) харагдацууд — загвар элементийн харагдах байдал зорилт бүрд ижил.</summary>
        internal HashSet<ElementId> InPlaceViewIds = new HashSet<ElementId>();
        /// <summary>
        /// Ерөнхий харагдац × ангилал → харагдах элементүүд.  ⚠️ ХУРД: планы харагдах байдлыг тооцох
        /// нь нэг удаад ~0.4 с (959 дам нуруутай план) — зорилт бүрд биш, ажиллуулалтад НЭГ удаа.
        /// Тэмдэглэгээ нэмэх нь загвар элементийн харагдах байдлыг өөрчлөхгүй тул аюулгүй.
        /// </summary>
        internal readonly Dictionary<string, HashSet<ElementId>> InPlaceVisible = new Dictionary<string, HashSet<ElementId>>();
        /// <summary>Эх харагдац → нууж болох ангилал/дэд ангилал (CanCategoryBeHidden нь 800 ангилалд ~35 мс).</summary>
        internal readonly Dictionary<ElementId, List<ElementId>> Hideable = new Dictionary<ElementId, List<ElementId>>();
        /// <summary>Эх viewport-ын төв (GetBoxCenter бүр регенераци хийдэг).</summary>
        internal readonly Dictionary<ElementId, XYZ> BoxCenters = new Dictionary<ElementId, XYZ>();

        /// <summary>Эх viewport-ын гарчгийн зай, зураасны урт (уншихад ~50 мс — шошгын геометр тооцдог).</summary>
        internal readonly Dictionary<ElementId, KeyValuePair<XYZ, double>> Labels = new Dictionary<ElementId, KeyValuePair<XYZ, double>>();

        internal XYZ BoxCenter(Viewport vp)
        {
            if (!BoxCenters.TryGetValue(vp.Id, out XYZ p))
                BoxCenters[vp.Id] = p = vp.GetBoxCenter();
            return p;
        }

        /// <summary>Эх харагдацад харагдах бусад харагдацын тэмдэг (зүсэлт, callout, фасадын тэмдэг).</summary>
        internal readonly Dictionary<ElementId, HashSet<ElementId>> ViewersBySource = new Dictionary<ElementId, HashSet<ElementId>>();

        internal HashSet<ElementId> ViewersIn(View src)
        {
            if (!ViewersBySource.TryGetValue(src.Id, out HashSet<ElementId> set))
            {
                set = new HashSet<ElementId>();
                try
                {
                    foreach (ElementId id in new FilteredElementCollector(Doc, src.Id).OfCategory(BuiltInCategory.OST_Viewers)
                                 .WhereElementIsNotElementType().ToElementIds())
                        set.Add(id);
                }
                catch { }
                ViewersBySource[src.Id] = set;
            }
            return set;
        }

        /// <summary>Эх viewport-ын тайрах хүрээ хуудсан дээр: [төв, зүүн доод булан] (null = тооцох боломжгүй).</summary>
        internal readonly Dictionary<ElementId, XYZ[]> CropRects = new Dictionary<ElementId, XYZ[]>();
        /// <summary>Эх viewport-ын хайрцгийн зүүн доод булан (гарчгийн LabelOffset-ын эх цэг).</summary>
        internal readonly Dictionary<ElementId, XYZ> BoxMins = new Dictionary<ElementId, XYZ>();

        internal XYZ[] CropOnSheet(Viewport vp)
        {
            if (!CropRects.TryGetValue(vp.Id, out XYZ[] r))
                CropRects[vp.Id] = r = CdEngine.CropOnSheet(Doc.GetElement(vp.ViewId) as View, vp);
            return r;
        }

        internal XYZ BoxMin(Viewport vp)
        {
            if (!BoxMins.TryGetValue(vp.Id, out XYZ p))
            {
                try { p = vp.GetBoxOutline()?.MinimumPoint; } catch { p = null; }
                BoxMins[vp.Id] = p;
            }
            return p;
        }

        internal KeyValuePair<XYZ, double> Label(Viewport vp)
        {
            if (!Labels.TryGetValue(vp.Id, out KeyValuePair<XYZ, double> l))
            {
                XYZ off = null;
                double len = double.NaN;
                try { off = vp.LabelOffset; } catch { }
                try { len = vp.LabelLineLength; } catch { }
                Labels[vp.Id] = l = new KeyValuePair<XYZ, double>(off, len);
            }
            return l;
        }

        /// <summary>
        /// Ерөнхий (байранд нэмэх) харагдацын одоо байгаа tag-ийн түлхүүр — зорилт бүрд дахин уншихгүй (2000 tag-тай
        /// планд зорилт тутамд ~0.1 с байв).  Шинэ tag бүрийн түлхүүр нэмэгдэнэ — дахин уншсантай ижил.
        /// </summary>
        internal readonly Dictionary<ElementId, HashSet<string>> SharedTagKeys = new Dictionary<ElementId, HashSet<string>>();
        /// <summary>Ерөнхий харагдацын хэмжээсүүд (давхардал шалгалт) — зорилт бүрд дахин уншихгүй, шинэ нь нэмэгдэнэ.</summary>
        internal readonly Dictionary<ElementId, List<Dimension>> SharedViewDims = new Dictionary<ElementId, List<Dimension>>();
        private List<Autodesk.Revit.DB.Architecture.Room> _rooms;

        /// <summary>Талбайтай бүх өрөө — өрөөний tag бүрд дахин цуглуулахгүй (ажиллуулалтад нэг удаа).</summary>
        internal List<Autodesk.Revit.DB.Architecture.Room> Rooms =>
            _rooms ?? (_rooms = new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_Rooms)
                .WhereElementIsNotElementType().OfType<Autodesk.Revit.DB.Architecture.Room>().Where(r => r.Area > 0).ToList());

        /// <summary>
        /// 2026-10-01 арын горим: алхмуудын ХООРОНД хэрэглэгч загварыг засаж (Ctrl+Z, устгах, өөр transaction) болно — тэгвэл
        /// энд хадгалсан Revit-ийн объект, кэш хуучирна.  Файлаас бүгдийг ДАХИН уншина; устсан эх тэмдэглэгээг хасна.
        /// Алхам Revit-д буцаагдсаны дараа ч дуудагдана (тэр алхамд нэмсэн клон бүртгэл, нэр, viewport-ыг цэвэрлэнэ).
        /// </summary>
        internal void Resync()
        {
            Clones = CdLinks.CloneIndex.Build(Doc);
            ViewNames = new HashSet<string>(new FilteredElementCollector(Doc).OfClass(typeof(View)).Cast<View>()
                .Select(v => v.Name), StringComparer.OrdinalIgnoreCase);
            SheetNumbers = new HashSet<string>(new FilteredElementCollector(Doc).OfClass(typeof(ViewSheet)).Cast<ViewSheet>()
                .Select(s => s.SheetNumber), StringComparer.OrdinalIgnoreCase);
            Grids = new FilteredElementCollector(Doc).OfClass(typeof(Grid)).Cast<Grid>().ToList();
            Levels = new FilteredElementCollector(Doc).OfClass(typeof(Level)).Cast<Level>().ToList();
            Viewports = new FilteredElementCollector(Doc).OfClass(typeof(Viewport)).Cast<Viewport>().ToList();
            RefPlanes = new FilteredElementCollector(Doc).OfClass(typeof(ReferencePlane)).Cast<ReferencePlane>().ToList();
            foreach (CdSourceAnnotations a in Sources.Values)
                a.Prune();
            InPlaceVisible.Clear();
            Hideable.Clear();
            BoxCenters.Clear();
            Labels.Clear();
            ViewersBySource.Clear();
            CropRects.Clear();
            BoxMins.Clear();
            SharedTagKeys.Clear();
            SharedViewDims.Clear();
            _rooms = null;
            Hosts = CdHostIndex.Build(Doc);
        }

        /// <summary>
        /// 2026-10-02 ХӨНГӨН шинэчлэлт: хэрэглэгчийн transaction зөвхөн НЭМСЭН/ӨӨРЧИЛСӨН (устгаагүй) бол бүх кэшийг хаяхгүй —
        /// зөвхөн хөндөгдсөн харагдац, ангилал, viewport-ынхийг.  Revit-ийн объект хүчинтэй хэвээр (устгал байхгүй) тул
        /// үлдсэн кэш зөв.  <see cref="CdContext.Forget"/>-той хамт дуудагдана.
        /// </summary>
        internal void Forget(CdTouch t)
        {
            if (t.AnyView)
            {
                // Шинэ/нэр солигдсон харагдац, хуудас (нэрийн мөргөлдөөн), хуулсан клон харагдацын бүртгэл.
                Clones = CdLinks.CloneIndex.Build(Doc);
                ViewNames = new HashSet<string>(new FilteredElementCollector(Doc).OfClass(typeof(View)).Cast<View>()
                    .Select(v => v.Name), StringComparer.OrdinalIgnoreCase);
                SheetNumbers = new HashSet<string>(new FilteredElementCollector(Doc).OfClass(typeof(ViewSheet)).Cast<ViewSheet>()
                    .Select(s => s.SheetNumber), StringComparer.OrdinalIgnoreCase);
                foreach (long v in t.Views)
                    Hideable.Remove(new ElementId(v));
            }
            if (t.ViewportTypes)
            {
                BoxCenters.Clear();
                Labels.Clear();
                CropRects.Clear();
                BoxMins.Clear();
            }
            if (t.AnyView || t.Viewports.Count > 0)
            {
                Viewports = new FilteredElementCollector(Doc).OfClass(typeof(Viewport)).Cast<Viewport>().ToList();
                var vps = new HashSet<long>(t.Viewports);
                foreach (Viewport vp in Viewports)
                {
                    if (t.Views.Contains(vp.ViewId.Value))
                        vps.Add(vp.Id.Value); // харагдацын crop өөрчлөгдсөн бол хуудсан дээрх хайрцаг ч
                }
                foreach (long id in vps)
                {
                    var eid = new ElementId(id);
                    BoxCenters.Remove(eid);
                    Labels.Remove(eid);
                    CropRects.Remove(eid);
                    BoxMins.Remove(eid);
                }
            }
            if (t.AnyView || t.Viewers)
                ViewersBySource.Clear();
            if (t.Datums)
            {
                Grids = new FilteredElementCollector(Doc).OfClass(typeof(Grid)).Cast<Grid>().ToList();
                Levels = new FilteredElementCollector(Doc).OfClass(typeof(Level)).Cast<Level>().ToList();
                RefPlanes = new FilteredElementCollector(Doc).OfClass(typeof(ReferencePlane)).Cast<ReferencePlane>().ToList();
            }
            if (t.Rooms)
                _rooms = null;
            if (t.Hosted)
                Hosts = CdHostIndex.Build(Doc); // залхуу — дараагийн зорилтын арматур/суусан элементийг шинээр
            DropKeys(InPlaceVisible, t);
            foreach (long v in t.Views.Concat(t.AnnotatedViews))
            {
                var eid = new ElementId(v);
                SharedTagKeys.Remove(eid);
                SharedViewDims.Remove(eid);
            }
        }

        /// <summary>«харагдац|ангилал» түлхүүртэй кэшээс хөндөгдсөн харагдац ЭСВЭЛ ангиллынхыг хаяна.</summary>
        internal static void DropKeys<T>(Dictionary<string, T> cache, CdTouch t)
        {
            if (cache.Count == 0 || (t.Views.Count == 0 && t.Categories.Count == 0))
                return;
            foreach (string k in cache.Keys.ToList())
            {
                int bar = k.IndexOf('|');
                if (bar <= 0 || !long.TryParse(k.Substring(0, bar), out long view) || !long.TryParse(k.Substring(bar + 1), out long cat)
                    || t.Views.Contains(view) || t.Categories.Contains(cat))
                    cache.Remove(k);
            }
        }

        public static CdPlan Prepare(Document doc, Element template, CdTemplateInfo info, IEnumerable<CdLinkedView> views,
            CdOptions options, CdHostIndex hosts)
        {
            var plan = new CdPlan
            {
                Doc = doc,
                Template = template,
                Info = info,
                Views = views.Where(v => v.Mode != CdViewMode.Skip).ToList(),
                Options = options ?? new CdOptions(),
                Hosts = hosts ?? CdHostIndex.Build(doc),
                Clones = CdLinks.CloneIndex.Build(doc),
                ViewNames = new HashSet<string>(new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>()
                    .Select(v => v.Name), StringComparer.OrdinalIgnoreCase),
                SheetNumbers = new HashSet<string>(new FilteredElementCollector(doc).OfClass(typeof(ViewSheet)).Cast<ViewSheet>()
                    .Select(s => s.SheetNumber), StringComparer.OrdinalIgnoreCase),
                Grids = new FilteredElementCollector(doc).OfClass(typeof(Grid)).Cast<Grid>().ToList(),
                Levels = new FilteredElementCollector(doc).OfClass(typeof(Level)).Cast<Level>().ToList(),
                Viewports = new FilteredElementCollector(doc).OfClass(typeof(Viewport)).Cast<Viewport>().ToList(),
                RefPlanes = new FilteredElementCollector(doc).OfClass(typeof(ReferencePlane)).Cast<ReferencePlane>().ToList(),
            };
            plan.InPlaceViewIds = new HashSet<ElementId>(plan.Views.Where(v => v.Mode == CdViewMode.InPlace).Select(v => v.ViewId));
            HashSet<ElementId> mra = CdAnalysis.MraDimensionIds(doc);
            HashSet<ElementId> mraTags = CdAnalysis.MraTagIds(doc);
            HashSet<ElementId> rel = info.Related;
            foreach (CdLinkedView lv in plan.Views)
            {
                var a = new CdSourceAnnotations();
                // ХУРД (2026-10-01): ерөнхий (байранд нэмэх) харагдацад зөвхөн ЗАГВАРТ (ба арматурт нь) холбогдсон тэмдэглэгээ
                // клонлогддог (CloneTags/Dims/Spots/Mras-ийн `!dedicated` шалгалт) — бусдыг энд нэг удаа хасна.  2000 tag-тай
                // планд зорилт бүрд 2000 удаа GetTaggedReferences дуудахгүй.  Үр дүн ижил: тэр шалгалтыг яг давтана.
                bool inPlace = lv.Mode == CdViewMode.InPlace;
                foreach (Element e in new FilteredElementCollector(doc).OwnedByView(lv.ViewId).WhereElementIsNotElementType())
                {
                    if (e is MultiReferenceAnnotation m)
                    {
                        if (!inPlace || MraRefersTo(doc, m, rel))
                            a.Mras.Add(m);
                    }
                    else if (e is Autodesk.Revit.DB.Architecture.RoomTag rt)
                    {
                        // Өрөөний tag зөвхөн тусгай харагдацад клонлогддог.
                        if (!inPlace)
                            a.RoomTags.Add(rt);
                    }
                    else if (e is IndependentTag t)
                    {
                        // MRA-ийн дотоод tag-ийг MRA өөрөө үүсгэнэ — тусад нь хуулбал давхар гарна.
                        if (!mraTags.Contains(t.Id) && (!inPlace || TagRefersTo(t, rel)))
                            a.Tags.Add(t);
                    }
                    else if (e is SpotDimension sd)
                    {
                        if (sd.Category?.Id.Value == (long)BuiltInCategory.OST_SpotElevations
                            && (!inPlace || CdAnalysis.RefersTo(sd, rel)))
                            a.Spots.Add(sd);
                    }
                    else if (e is Dimension d)
                    {
                        if (mra.Contains(d.Id) || d.Category?.Id.Value != (long)BuiltInCategory.OST_Dimensions)
                            continue;
                        if (!inPlace || CdAnalysis.RefersTo(d, rel))
                            a.Dims.Add(d);
                    }
                }
                if (lv.Mode == CdViewMode.NewView && doc.GetElement(lv.ViewId) is View v)
                    a.Details = CdEngine.DetailElements(doc, v);
                plan.Sources[lv.ViewId] = a;
            }
            return plan;
        }

        /// <summary>`CloneTags`-ийн ерөнхий харагдацын шалгалт — tag загвар (ба арматур)-ыг локал лавлагаагаар заасан уу.</summary>
        private static bool TagRefersTo(IndependentTag t, HashSet<ElementId> ids)
        {
            IList<Reference> refs;
            try { refs = t.GetTaggedReferences(); }
            catch { return false; }
            return refs != null && refs.Any(r => r != null && r.LinkedElementId == ElementId.InvalidElementId && ids.Contains(r.ElementId));
        }

        /// <summary>`CloneMras`-ийн ерөнхий харагдацын шалгалт — MRA-ийн хэмжээс загварын арматурыг агуулах уу.</summary>
        private static bool MraRefersTo(Document doc, MultiReferenceAnnotation m, HashSet<ElementId> ids)
        {
            try
            {
                if (!(doc.GetElement(m.DimensionId) is Dimension d) || d.References == null)
                    return false;
                return d.References.Cast<Reference>().Any(r => r != null && ids.Contains(r.ElementId));
            }
            catch
            {
                return false;
            }
        }
    }

    internal sealed class CdSourceAnnotations
    {
        public readonly List<IndependentTag> Tags = new List<IndependentTag>();
        public readonly List<Dimension> Dims = new List<Dimension>();
        public readonly List<SpotDimension> Spots = new List<SpotDimension>();
        public readonly List<Autodesk.Revit.DB.Architecture.RoomTag> RoomTags = new List<Autodesk.Revit.DB.Architecture.RoomTag>();
        public readonly List<MultiReferenceAnnotation> Mras = new List<MultiReferenceAnnotation>();
        public List<Element> Details = new List<Element>();

        /// <summary>Хэрэглэгч алхмын хооронд устгасан эх тэмдэглэгээг хасна (хуучирсан объект руу хандвал Revit шиднэ).</summary>
        public void Prune()
        {
            Tags.RemoveAll(x => x == null || !x.IsValidObject);
            Dims.RemoveAll(x => x == null || !x.IsValidObject);
            Spots.RemoveAll(x => x == null || !x.IsValidObject);
            RoomTags.RemoveAll(x => x == null || !x.IsValidObject);
            Mras.RemoveAll(x => x == null || !x.IsValidObject);
            Details.RemoveAll(x => x == null || !x.IsValidObject);
        }
    }

    /// <summary>
    /// Нэг харагдацын тэмдэглэгээний ажил — арын горимд хэд хэдэн алхамд хуваагдаж болно (курсор).  Фазын дараалал
    /// хуучин `Annotate`-ийнхтэй ижил: tag → өрөөний tag → MRA → хэмжээс → spot → 2D → хол байгаа зүсэлтийн тэмдэг нуух.
    /// </summary>
    internal sealed class CdAnnotateWork
    {
        internal const int PhaseCount = 7;

        internal CdLinkedView View;
        internal ElementId SourceId, DestId;
        internal bool Dedicated;
        /// <summary>Шинэ (клон) харагдац — эх зурагт байгаагүй хол зүсэлтийн тэмдгийг нууна.</summary>
        internal bool Stray;
        internal readonly List<IndependentTag> Tags = new List<IndependentTag>();
        internal readonly List<Autodesk.Revit.DB.Architecture.RoomTag> RoomTags = new List<Autodesk.Revit.DB.Architecture.RoomTag>();
        internal readonly List<MultiReferenceAnnotation> Mras = new List<MultiReferenceAnnotation>();
        internal readonly List<Dimension> Dims = new List<Dimension>();
        internal readonly List<SpotDimension> Spots = new List<SpotDimension>();
        internal readonly List<Element> Details = new List<Element>();
        internal int Phase, Index, Done;
        /// <summary>Энэ алхамд үүсгэсэн, хараахан шалгаагүй хэмжээсүүд (<see cref="CdEngine"/>.FinishDims).</summary>
        internal readonly List<CdPendingDim> PendingDims = new List<CdPendingDim>();
        /// <summary>
        /// Алхам Revit-д буцаагдсаны дараа АЮУЛГҮЙ горим: нэг алхамд НЭГ л элемент — ингэснээр шийдэгдэхгүй алдаатай
        /// нэг tag/хэмжээс бусдыгаа дагуулж буцаахгүй, өөрөө л алгасагдана.
        /// </summary>
        internal bool Safe;
        /// <summary>
        /// Аюулгүй горимд алгассан элементийн тоо.  Эхнийх нь олдсоны дараа ердийн (хурдан) горимд буцна; энэ харагдацад
        /// хоёр дахь нь ч олдвол харагдац «асуудалтай» — үлдсэнийг нь нэг нэгээр.
        /// </summary>
        internal int Skipped;
        /// <summary>
        /// Хурдан алхам буцаагдах үед хүрсэн цэг (<see cref="Done"/>) — алдаатай элемент энэ хүртэлх хэсэгт л байна.
        /// Аюулгүй горим үүнийг давмагц (алгассан нь &lt; 2 бол) дахин хурдан горимд буцна (2026-10-02; өмнө нь буцаалтын
        /// дараа бүх элемент нь амжилттай болсон ч харагдацын үлдсэнийг нэг нэгээр хийдэг байв).
        /// </summary>
        internal int SafeUntil;
        /// <summary>Аюулгүй горимын амжилттай алхмын тоо — 0 хэвээр олон элемент буцвал харагдацыг орхино (түгжигдсэн г.м.).</summary>
        internal int SafeOk;
        /// <summary>
        /// Аюулгүй горимд элемент буцаагдахад ЭХЛЭЭД файлаас бүрэн дахин уншаад (хэрэглэгчийн засвараар хуучирсан кэш биш
        /// гэдгийг баталгаажуулж) тэр элементийг нэг удаа дахин оролддог — харагдацад нэг л удаа.
        /// </summary>
        internal bool Resynced;
        private int _markPhase, _markIndex, _markDone;

        internal int Total => Tags.Count + RoomTags.Count + Mras.Count + Dims.Count + Spots.Count + Details.Count + (Stray ? 1 : 0);

        internal double Fraction => Total == 0 ? 1 : Math.Min(1.0, (double)Done / Total);

        internal int CountOf(int phase)
        {
            switch (phase)
            {
                case 0: return Tags.Count;
                case 1: return RoomTags.Count;
                case 2: return Mras.Count;
                case 3: return Dims.Count;
                case 4: return Spots.Count;
                case 5: return Details.Count;
                case 6: return Stray ? 1 : 0;
                default: return 0;
            }
        }

        /// <summary>Дууссан фазуудыг алгасна; бүгд дууссан бол true.</summary>
        internal bool Finished()
        {
            while (Phase < PhaseCount && Index >= CountOf(Phase))
            {
                Phase++;
                Index = 0;
            }
            return Phase >= PhaseCount;
        }

        /// <summary>Алхмын эхлэлийг тэмдэглэнэ — алхам буцаагдвал яг энд буцна (өмнөх алхмуудын commit хэвээр).</summary>
        internal void Mark()
        {
            _markPhase = Phase;
            _markIndex = Index;
            _markDone = Done;
        }

        /// <summary>Буцаагдсан алхмын эхлэл рүү (тэр алхмын бүх үр дүн transaction-тай хамт буцсан).</summary>
        internal void Rewind()
        {
            Phase = _markPhase;
            Index = _markIndex;
            Done = _markDone;
            PendingDims.Clear();
        }

        /// <summary>Аюулгүй горимд буцаагдсан ГАНЦ элементийг алгасна (алдаа нь тайланд бичигдсэн).</summary>
        internal void SkipOne()
        {
            if (!Finished())
            {
                Index++;
                Done++;
            }
        }
    }

    /// <summary>Үүсгэсэн, хараахан шалгаагүй хэмжээс — <c>CdEngine.FinishDims</c> нэг регенерацийн дараа шалгана.</summary>
    internal sealed class CdPendingDim
    {
        public Dimension Source, Created;
        public ElementId CreatedId;
        public List<double> Want;
        public ReferenceArray Mapped;
        public XYZ Dir;
        public bool Exact;
    }

    /// <summary>Нэг зорилтын ажиллах орчин.</summary>
    internal sealed class CdContext
    {
        public readonly CdPlan Plan;
        public readonly Document Doc;
        public readonly Element Tpl, Tgt;
        public readonly CdMap Map;
        public readonly CdReport Rep;
        public readonly string TplMark, TgtMark, TgtLabel;
        /// <summary>Загварын тал → зорилтын тал (загвар, арматур, суусан элемент, хөрш).</summary>
        public readonly Dictionary<ElementId, ElementId> ElementMap = new Dictionary<ElementId, ElementId>();
        /// <summary>Эх харагдац → зорилтын клон харагдац.</summary>
        public readonly Dictionary<ElementId, View> Dest = new Dictionary<ElementId, View>();
        /// <summary>
        /// <see cref="Dest"/>-ийн id хувилбар — алхмын хооронд хэрэглэгч Ctrl+Z хийвэл View объект хүчингүй болно;
        /// <see cref="ResetCaches"/> үүнээс Dest-ийг дахин угсарна.
        /// </summary>
        internal readonly Dictionary<ElementId, ElementId> DestIds = new Dictionary<ElementId, ElementId>();
        public readonly HashSet<ElementId> ReusedViews = new HashSet<ElementId>();
        /// <summary>
        /// Тэмдэглэгээг нь ДАХИН эхлүүлсэн шинэ харагдацууд (алхам буцаагдсан) — 2D-г хуулахын өмнө «байгаа эсэх»-ийг
        /// шалгана (эс бөгөөс өмнөх алхамд хуулсан текст, зураас давхардана).
        /// </summary>
        internal readonly HashSet<ElementId> DetailCheck = new HashSet<ElementId>();
        /// <summary>Арматурын тулгалтыг тайланд нэг л удаа тоолох (алхам дахин эхлэхэд давхар тоолохгүй).</summary>
        internal bool RebarCounted;
        private readonly Dictionary<ElementId, HashSet<string>> _roomTagKeys = new Dictionary<ElementId, HashSet<string>>();
        private readonly Dictionary<string, ElementId> _neighbors = new Dictionary<string, ElementId>();
        private readonly Dictionary<string, HashSet<ElementId>> _visible = new Dictionary<string, HashSet<ElementId>>();
        private readonly Dictionary<ElementId, HashSet<string>> _tagKeys = new Dictionary<ElementId, HashSet<string>>();
        /// <summary>Хөршийн нэр дэвшигч: (харагдац, ангилал) → харагдаж буй элементүүд.  Нэг удаа.</summary>
        public readonly Dictionary<string, List<Element>> Pools = new Dictionary<string, List<Element>>();
        /// <summary>Элементийн нүүрс (хэмжээсийн холбоос бүрд дахин тооцохгүй).</summary>
        internal readonly Dictionary<string, object> Faces = new Dictionary<string, object>();
        /// <summary>Харагдац бүрийн хэмжээсүүд (давхардал шалгахад) — тусгай харагдацад; ерөнхий харагдацынх CdPlan-д.</summary>
        public readonly Dictionary<ElementId, List<Dimension>> ViewDims = new Dictionary<ElementId, List<Dimension>>();
        private readonly Dictionary<ElementId, string> _kinds = new Dictionary<ElementId, string>();

        /// <param name="targetFrame">
        /// 2026-10-02 («Загвар харагдацаас хуулах»): зорилтын хүрээг ГАДНАСАА өгнө — идэвхтэй харагдац загварын харагдацаас
        /// эсрэг талаас харж байвал (дам нурууг нөгөө үзүүрээс) хүрээг эргүүлж өгдөг.  null = урьдчилсан (загварын чиглэлд
        /// ойртуулсан) хүрээ — «Зураг хувилах»-ийн хуучин зан төлөв ХЭВЭЭР.
        /// </param>
        public CdContext(CdPlan plan, Element target, CdReport rep, CdFrame targetFrame = null)
        {
            Plan = plan;
            Doc = plan.Doc;
            Tpl = plan.Template;
            Tgt = target;
            Rep = rep;
            Map = new CdMap(plan.Info.Frame, targetFrame ?? CdFrame.Of(target, plan.Info.Frame));
            TplMark = plan.Info.Mark;
            TgtMark = CdAnalysis.Mark(target);
            TgtLabel = CloneNaming.TargetLabel(TgtMark, target.Id.Value);
        }

        /// <summary>Хэмжээ, чиг ижил — хэмжээсийн утгыг загвартай яг тулгаж болно.</summary>
        public bool Exact => Map.IsRigid && Map.SameSize;

        /// <summary>
        /// Элемент харагдацад харагдах уу.  ⚠️ ХУРД: харагдацын харагдах байдлын тооцоо нь коллектор
        /// бүрд (шүүлтүүрээс үл хамааран) ~0.3 с том планд — тиймээс (харагдац, ангилал) тутамд НЭГ
        /// коллектор; ерөнхий харагдацынх ажиллуулалтад нэг удаа (CdPlan.InPlaceVisible).
        /// </summary>
        public bool Sees(View v, ElementId id)
        {
            Element e = Doc.GetElement(id);
            if (e?.Category == null)
                return false;
            string key = v.Id.Value + "|" + e.Category.Id.Value;
            Dictionary<string, HashSet<ElementId>> cache = Plan.InPlaceViewIds.Contains(v.Id) ? Plan.InPlaceVisible : _visible;
            if (!cache.TryGetValue(key, out HashSet<ElementId> set))
            {
                set = new HashSet<ElementId>(Pool(v, e.Category.Id).Select(x => x.Id));
                cache[key] = set;
            }
            return set.Contains(id);
        }

        /// <summary>Харагдацад харагдах тухайн ангиллын элементүүд (хөрш хайхад) — (харагдац, ангилал) тутамд нэг удаа.</summary>
        public List<Element> Pool(View v, ElementId categoryId)
        {
            string key = v.Id.Value + "|" + categoryId.Value;
            if (!Pools.TryGetValue(key, out List<Element> pool))
            {
                try
                {
                    pool = new FilteredElementCollector(Doc, v.Id).OfCategoryId(categoryId).WhereElementIsNotElementType().ToList();
                }
                catch
                {
                    pool = new List<Element>(); // хэвлэгддэггүй харагдац
                }
                Pools[key] = pool;
            }
            return pool;
        }

        /// <summary>Элементийн төрөл («Дам нуруу», «Ферм» …) — кэштэй.</summary>
        public string KindOf(Element e)
        {
            if (e == null)
                return null;
            if (!_kinds.TryGetValue(e.Id, out string k))
                _kinds[e.Id] = k = CdAnalysis.KindOf(e.Document, e);
            return k;
        }

        /// <summary>
        /// Энэ тэмдэглэгээг инженерийн сонгосон төрлөөр хувилах уу.  Загвар/арматурыг агуулсан бол ҮРГЭЛЖ;
        /// үгүй бол лавлах элемент бүрийн төрөл сонгогдсон байх ёстой (тэнхлэг, түвшин тоологдохгүй).
        /// </summary>
        public bool AllowedKinds(IEnumerable<Element> elements)
        {
            HashSet<string> allow = Plan.Options.AnnotationKinds;
            if (allow == null)
                return true;
            bool ok = true;
            foreach (Element e in elements)
            {
                if (e == null)
                    continue;
                if (Plan.Info.Related.Contains(e.Id))
                    return true;
                string k = KindOf(e);
                if (k != null && !allow.Contains(k))
                    ok = false;
            }
            return ok;
        }

        public void ResetVisibility()
        {
            _visible.Clear();
            Pools.Clear();
        }

        /// <summary>
        /// <see cref="CdPlan.Resync"/>-ийн дараа: элемент, харагдацын кэшийг хаяж, клон харагдацуудыг id-аар нь дахин
        /// олно (Ctrl+Z-ээр буцсаныг хасна).  Арматурын тулгалтыг (ElementMap) дахин хийнэ — тоолохгүйгээр.
        /// </summary>
        internal void ResetCaches()
        {
            _visible.Clear();
            Pools.Clear();
            Faces.Clear();
            ViewDims.Clear();
            _tagKeys.Clear();
            _roomTagKeys.Clear();
            _neighbors.Clear();
            _kinds.Clear();
            Dest.Clear();
            foreach (ElementId key in DestIds.Keys.ToList())
            {
                if (Doc.GetElement(DestIds[key]) is View v && !v.IsTemplate)
                    Dest[key] = v;
                else
                    DestIds.Remove(key);
            }
        }

        /// <summary>
        /// Хөнгөн шинэчлэлт (<see cref="CdPlan.Forget"/>): хөндөгдсөн харагдац/ангиллын харагдах байдал, хөндөгдсөн элементийн
        /// нүүр, тэмдэглэгээ нэмэгдсэн харагдацын давхардал шалгалтын кэшийг л хаяна.
        /// </summary>
        internal void Forget(CdTouch t)
        {
            CdPlan.DropKeys(_visible, t);
            CdPlan.DropKeys(Pools, t);
            foreach (long id in t.Elements)
            {
                string k = id.ToString();
                Faces.Remove(k);
                Faces.Remove(k + "|s");
                _kinds.Remove(new ElementId(id));
            }
            foreach (long v in t.Views.Concat(t.AnnotatedViews))
                ForgetAnnotations(new ElementId(v));
            // Хөршийн ихэр нь харагдах элементийн сангаас хамаарна.
            if (t.Views.Count > 0 || t.Categories.Count > 0)
                _neighbors.Clear();
        }

        /// <summary>Харагдацын tag, өрөөний tag-ийн түлхүүр, хэмжээсийн жагсаалт (давхардал шалгалт) — дараагийн хандалтад дахин уншина.</summary>
        internal void ForgetAnnotations(ElementId viewId)
        {
            ViewDims.Remove(viewId);
            _tagKeys.Remove(viewId);
            _roomTagKeys.Remove(viewId);
            Plan.SharedViewDims.Remove(viewId);
            Plan.SharedTagKeys.Remove(viewId);
        }

        /// <summary>
        /// Тэмдэглэгээний алхам Revit-д БУЦААГДСАНЫ дараа — бүрэн Resync-ийн оронд (2026-10-02).  Тэр алхамд үүсгэсэн
        /// tag/хэмжээсийн түлхүүр, Dimension объект ЗӨВХӨН тэр харагдацын кэшэд үлддэг (эс бөгөөс буцсан tag-ийг «аль хэдийн
        /// байгаа» гэж дахин хийхгүй, хүчингүй хэмжээс рүү хандаж шиднэ) — тэднийг хаяна.  Буцсан алхамд үүсээд устсан
        /// элементийн объект, id-тай (Revit id-г дахин ашиглаж болно) бусад кэшийн мөрийг хасна.  Харагдах байдлын
        /// тооцоо (харагдац × ангилал тутамд ~0.3 с) хөндөгдөхгүй — тэмдэглэгээ нь загварын элементийн харагдах байдлыг өөрчилдөггүй.
        /// </summary>
        internal void ForgetRolledBack(ElementId viewId)
        {
            ForgetAnnotations(viewId);
            foreach (List<Element> pool in Pools.Values)
                pool.RemoveAll(x => x == null || !x.IsValidObject);
            foreach (string k in Faces.Keys.ToList())
            {
                int bar = k.IndexOf('|');
                if (!long.TryParse(bar < 0 ? k : k.Substring(0, bar), out long id) || Doc.GetElement(new ElementId(id)) == null)
                    Faces.Remove(k);
            }
            foreach (ElementId id in _kinds.Keys.ToList())
            {
                if (Doc.GetElement(id) == null)
                    _kinds.Remove(id);
            }
        }

        /// <summary>Харагдацын хэмжээсүүд — ерөнхий харагдацынх ажиллуулалтад нэг (CdPlan), тусгайнх зорилт бүрд.</summary>
        internal List<Dimension> DimsOf(View v)
        {
            Dictionary<ElementId, List<Dimension>> store = Plan.InPlaceViewIds.Contains(v.Id) ? Plan.SharedViewDims : ViewDims;
            if (!store.TryGetValue(v.Id, out List<Dimension> all))
                store[v.Id] = all = new FilteredElementCollector(Doc).OwnedByView(v.Id).OfClass(typeof(Dimension)).Cast<Dimension>().ToList();
            return all;
        }

        /// <summary>Харагдацын өрөөний tag-ийн түлхүүр (төрөл|өрөө) — дахин ажиллуулахад давхардахгүй.</summary>
        internal HashSet<string> RoomTagKeys(View v)
        {
            if (!_roomTagKeys.TryGetValue(v.Id, out HashSet<string> keys))
            {
                keys = new HashSet<string>();
                foreach (var x in new FilteredElementCollector(Doc).OwnedByView(v.Id).OfCategory(BuiltInCategory.OST_RoomTags)
                             .OfType<Autodesk.Revit.DB.Architecture.RoomTag>())
                {
                    try { keys.Add(x.GetTypeId().Value + "|" + x.TaggedLocalRoomId.Value); }
                    catch { }
                }
                _roomTagKeys[v.Id] = keys;
            }
            return keys;
        }

        public bool TryGetNeighbor(ElementId id, View dest, bool relaxed, out ElementId to) =>
            _neighbors.TryGetValue(id.Value + "|" + dest.Id.Value + (relaxed ? "|r" : ""), out to);

        public void SetNeighbor(ElementId id, View dest, bool relaxed, ElementId to) =>
            _neighbors[id.Value + "|" + dest.Id.Value + (relaxed ? "|r" : "")] = to;

        public HashSet<string> TagKeys(View v)
        {
            // Ерөнхий харагдацынх ажиллуулалтад НЭГ (CdPlan) — зорилт бүрд 2000 tag дахин уншихгүй.
            Dictionary<ElementId, HashSet<string>> store = Plan.InPlaceViewIds.Contains(v.Id) ? Plan.SharedTagKeys : _tagKeys;
            if (!store.TryGetValue(v.Id, out HashSet<string> keys))
            {
                keys = new HashSet<string>();
                foreach (IndependentTag t in new FilteredElementCollector(Doc).OwnedByView(v.Id).OfClass(typeof(IndependentTag))
                             .Cast<IndependentTag>())
                {
                    try
                    {
                        foreach (Reference r in t.GetTaggedReferences())
                        {
                            keys.Add(t.GetTypeId().Value + "|" + (r.LinkedElementId != ElementId.InvalidElementId
                                ? "L" + r.ElementId.Value + ":" + r.LinkedElementId.Value
                                : r.ElementId.Value.ToString()));
                        }
                    }
                    catch { }
                }
                store[v.Id] = keys;
            }
            return keys;
        }
    }

    /// <summary>
    /// Алхмын хооронд хэрэглэгчийн transaction-ууд НЭМСЭН/ӨӨРЧИЛСӨН элементийн хураангуй (2026-10-02) —
    /// <see cref="CdPlan.Forget"/>, <see cref="CdContext.Forget"/> зөвхөн эдгээрт хамаарах кэшийг хаяна.  Өмнө нь
    /// хэрэглэгчийн засвар бүр БҮХ кэшийг хаядаг байсан тул (харагдах байдлын тооцоо харагдац × ангилал тутамд ~0.3–0.4 с)
    /// дараагийн алхмууд хэдэн секунд гацдаг байв.  Устгал, Ctrl+Z/Y, өөр хувилалтын алхам — бүрэн Resync хэвээр.
    /// </summary>
    internal sealed class CdTouch
    {
        /// <summary>Тохиргоо нь (харах хүрээ, crop, нуусан элемент, нэр) өөрчлөгдсөн байж болох харагдац, хуудас.</summary>
        internal readonly HashSet<long> Views = new HashSet<long>();
        /// <summary>Тэмдэглэгээ (tag, хэмжээс, 2D) нь нэмэгдсэн/өөрчлөгдсөн харагдацууд — давхардал шалгалтын кэш.</summary>
        internal readonly HashSet<long> AnnotatedViews = new HashSet<long>();
        /// <summary>Аль нэг харагдацад харагдах байдал нь өөрчлөгдсөн байж болох ангиллууд.</summary>
        internal readonly HashSet<long> Categories = new HashSet<long>();
        /// <summary>Геометр нь өөрчлөгдсөн байж болох элементүүд (нүүрний кэш).</summary>
        internal readonly HashSet<long> Elements = new HashSet<long>();
        internal readonly HashSet<long> Viewports = new HashSet<long>();
        internal bool AnyView, Datums, Rooms, Hosted, Viewers, ViewportTypes;

        /// <summary>
        /// null = загвар, одоогийн зорилт эсвэл тэдгээрийн арматур/суусан элемент (тулгалт) хөндөгдсөн → бүрэн Resync
        /// (<see cref="CdEngine.RemapRelated"/>).  Revit API контекстод.
        /// </summary>
        internal static CdTouch Collect(Document doc, IEnumerable<long> ids, CdPlan plan, CdContext ctx)
        {
            long tpl = plan.Template.Id.Value;
            long tgt = ctx?.Tgt != null ? ctx.Tgt.Id.Value : long.MinValue;
            var guard = new HashSet<long> { tpl };
            if (plan.Info?.Related != null)
            {
                foreach (ElementId id in plan.Info.Related)
                    guard.Add(id.Value);
            }
            if (ctx != null)
            {
                guard.Add(tgt);
                foreach (KeyValuePair<ElementId, ElementId> kv in ctx.ElementMap)
                {
                    guard.Add(kv.Key.Value);
                    if (kv.Value != null)
                        guard.Add(kv.Value.Value);
                }
            }
            var t = new CdTouch();
            HashSet<long> vpTypes = null;
            foreach (long v in ids)
            {
                if (guard.Contains(v))
                    return null;
                Element e = doc.GetElement(new ElementId(v));
                if (e == null)
                    continue;
                if (HostedOn(e, tpl, tgt) || ChangesOtherViews(e))
                    return null;
                if (e is ElementType)
                {
                    if (vpTypes == null)
                        vpTypes = ViewportTypeIds(plan);
                    if (vpTypes.Contains(v))
                        t.ViewportTypes = true; // гарчгийн хэлбэр → хуудсан дээрх байрлал
                }
                if (e is View)
                {
                    t.AnyView = true;
                    t.Views.Add(v);
                    continue;
                }
                if (e is Viewport)
                {
                    t.Viewports.Add(v);
                    continue;
                }
                if (e is Grid || e is Level || e is ReferencePlane)
                    t.Datums = true;
                if (e is Rebar || e is FamilyInstance || e is Opening)
                    t.Hosted = true;
                long cat = long.MinValue;
                try { cat = e.Category?.Id.Value ?? long.MinValue; }
                catch { }
                if (cat != long.MinValue)
                {
                    t.Categories.Add(cat);
                    if (cat == (long)BuiltInCategory.OST_Rooms)
                        t.Rooms = true;
                    else if (cat == (long)BuiltInCategory.OST_Viewers)
                        t.Viewers = true;
                }
                t.Elements.Add(v);
                try
                {
                    if (e.ViewSpecific && e.OwnerViewId != null && e.OwnerViewId != ElementId.InvalidElementId)
                        t.AnnotatedViews.Add(e.OwnerViewId.Value);
                }
                catch { }
            }
            return t;
        }

        /// <summary>
        /// Өөрийгөө биш, БУСАД харагдацын харагдах байдлыг өөрчилдөг (тэдгээр харагдац «өөрчлөгдсөн» гэж мэдэгдэхгүй байж
        /// болох) элемент — харагдацын загвар, шүүлтүүр, үе шат, дизайны хувилбар, workset-ийн харагдах байдал, scope box,
        /// түвшин, link — эсвэл ангилалгүй танигдахгүй элемент.  Бүрэн Resync (хямд биш ч зөв).
        /// </summary>
        private static bool ChangesOtherViews(Element e)
        {
            if (e is View view)
                return view.IsTemplate;
            if (e is Viewport)
                return false;
            if (e is FilterElement || e is PhaseFilter || e is Phase || e is DesignOption || e is WorksetDefaultVisibilitySettings
                || e is Level || e is RevitLinkInstance)
                return true;
            Category cat;
            try { cat = e.Category; }
            catch { return true; }
            if (cat == null)
                return !(e is ElementType || e is SketchPlane || e is Autodesk.Revit.DB.ExtensibleStorage.DataStorage); // эдгээр нь харагдах байдалд нөлөөгүй
            return cat.Id.Value == (long)BuiltInCategory.OST_VolumeOfInterest;
        }

        private static HashSet<long> ViewportTypeIds(CdPlan plan)
        {
            var set = new HashSet<long>();
            if (plan.Viewports == null)
                return set;
            foreach (Viewport vp in plan.Viewports)
            {
                try
                {
                    if (vp != null && vp.IsValidObject)
                        set.Add(vp.GetTypeId().Value);
                }
                catch { }
            }
            return set;
        }

        /// <summary>Загвар эсвэл зорилтод суусан (арматур, хаалга/нүх, дэд бүрэлдэхүүн) элемент уу.</summary>
        private static bool HostedOn(Element e, long tpl, long tgt)
        {
            try
            {
                long host;
                switch (e)
                {
                    case Rebar r:
                        host = r.GetHostId().Value;
                        break;
                    case FamilyInstance fi:
                        if (fi.SuperComponent != null && (fi.SuperComponent.Id.Value == tpl || fi.SuperComponent.Id.Value == tgt))
                            return true;
                        host = fi.Host?.Id.Value ?? long.MinValue;
                        break;
                    case Opening o:
                        host = o.Host?.Id.Value ?? long.MinValue;
                        break;
                    default:
                        return false;
                }
                return host == tpl || host == tgt;
            }
            catch
            {
                return true; // тодорхойгүй бол бүрэн шинэчлэлт — аюулгүй тал
            }
        }
    }

    public static class CdEngine
    {
        /// <summary>Хоёр элементийг тулгах нарийвчлал (фут ≈ 15 см) — хөрш, суусан элемент.</summary>
        private const double NeighborTol = 0.5;
        /// <summary>Tag-ийн сул тулгалт (фут ≈ 1 м) — ижил төрлийн хамгийн ойр элемент.</summary>
        private const double RelaxedTol = 3.3;
        /// <summary>Хавтгайг тулгах нарийвчлал (фут ≈ 1.5 см).</summary>
        private const double PlaneTol = 0.05;
        /// <summary>
        /// Тэнхлэг, түвшин олох хүлцэл (фут ≈ 15 см) — хамгийн ОЙРЫГ нь авна.  Дам нуруу
        /// тэнхлэгээс 1-2 см зөрүүтэй зурагдсан байх нь түгээмэл (Snowdon Towers-т хэмжсэн:
        /// 15 мм), харин хоёр тэнхлэгийн хоорондох зай хэдэн метр.
        /// </summary>
        private const double DatumTol = 0.5;
        /// <summary>Хэмжээсийн утгын хүлцэл (≈ 1 мм).</summary>
        private const double DimTol = 0.0033;

        // ══ Гол урсгал ═════════════════════════════════════════════════════

        /// <summary>
        /// Нэг зорилтод зураг клонлоно — бүх алхмыг дараалан (нэг нээлттэй Transaction дотор).  2026-10-01-ээс команд
        /// нь арын горимд <see cref="CdJob"/>-оор АЛХАМ АЛХМААР (алхам тутамд Transaction) ажилладаг; энэ нь ижил
        /// алхмуудын нэгдэл — тест харness-д үлдээв.
        /// </summary>
        public static void CloneTarget(CdPlan plan, Element target, CdReport rep)
        {
            CdContext ctx = BeginTarget(plan, target, rep, plan.Options.Recreate);
            foreach (CdLinkedView lv in ViewsToCreate(plan))
                CreateView(ctx, lv);
            plan.Doc.Regenerate();
            ctx.ResetVisibility();

            foreach (CdLinkedView lv in plan.Views)
            {
                CdAnnotateWork w = BeginAnnotate(ctx, lv);
                if (w != null)
                    ContinueAnnotate(ctx, w, null);
            }

            if (plan.Options.Sheets && ctx.Dest.Count > 0)
            {
                foreach (ElementId sheetId in SheetGroups(ctx))
                    CloneSheet(ctx, sheetId);
            }
            FinishTarget(ctx);
        }

        /// <summary>
        /// Алхам 1: зорилтын орчин (хүрээ, буулгалт) + арматур/суусан элементийн тулгалт.  <paramref name="deleteOld"/>
        /// («Өмнөх клоныг устгаж шинээр») үед нээлттэй Transaction шаардана; эс бөгөөс зөвхөн уншина.
        /// </summary>
        internal static CdContext BeginTarget(CdPlan plan, Element target, CdReport rep, bool deleteOld, CdFrame targetFrame = null)
        {
            var ctx = new CdContext(plan, target, rep, targetFrame);
            if (deleteOld)
                DeleteOldClones(ctx);
            MapRelated(ctx);
            return ctx;
        }

        /// <summary>Шинээр үүсгэх харагдацууд — callout-ыг эх харагдацынх нь ДАРАА (эх нь бас клонлогдох бол клон дээр нь тавина).</summary>
        internal static List<CdLinkedView> ViewsToCreate(CdPlan plan)
        {
            List<CdLinkedView> todo = plan.Views.Where(v => v.Mode == CdViewMode.NewView && v.CanClone).ToList();
            var ids = new HashSet<ElementId>(todo.Select(v => v.ViewId));
            return todo.OrderBy(v => v.IsCallout && ids.Contains(v.CalloutParentId) ? 1 : 0).ToList();
        }

        /// <summary>Алхам 2: нэг эх харагдацын клон (өмнө хувилсан бол түүнийг).  Нээлттэй Transaction дотор.</summary>
        internal static void CreateView(CdContext c, CdLinkedView lv)
        {
            View cv = GetOrCreateView(c, lv);
            if (cv != null)
            {
                c.Dest[lv.ViewId] = cv;
                c.DestIds[lv.ViewId] = cv.Id;
            }
        }

        /// <summary>Сүүлийн алхам: зорилтыг загвартай холбож тэмдэглэнэ.  Нээлттэй Transaction дотор.</summary>
        internal static void FinishTarget(CdContext c)
        {
            CdLinks.MarkTarget(c.Tgt, c.Plan.Template);
            c.Rep.TargetsDone++;
        }

        // ══ Холбоотой элементүүд (арматур, суусан элемент) ══════════════════

        /// <summary>
        /// Хэрэглэгч алхмын хооронд загварыг засварласны дараа (<see cref="CdPlan.Resync"/>) тулгалтыг шинээр хийнэ —
        /// тайланд ДАХИН тоолохгүй.
        /// </summary>
        internal static void RemapRelated(CdContext c)
        {
            c.ElementMap.Clear();
            MapRelated(c);
        }

        private static void MapRelated(CdContext c)
        {
            c.ElementMap[c.Tpl.Id] = c.Tgt.Id;
            CdHostIndex hosts = c.Plan.Hosts;
            // Ctrl+Z-ийн дараа зорилтыг дахин хийхэд (шинэ CdContext) тайланд дахин тоолохгүй.
            bool count = !c.RebarCounted && c.Rep.Once("rebar|" + c.Tgt.Id.Value);
            c.RebarCounted = true;
            if (c.Plan.Options.Rebar)
            {
                List<Element> a = hosts.RebarsOf(c.Tpl.Id).Cast<Element>().ToList();
                List<Element> b = hosts.RebarsOf(c.Tgt.Id).Cast<Element>().ToList();
                if (a.Count > 0)
                {
                    int matched = MatchChildren(c, a, b, true);
                    if (count)
                    {
                        c.Rep.RebarMatched += matched;
                        c.Rep.RebarUnmatched += a.Count - matched;
                    }
                }
            }
            List<Element> ha = hosts.HostedBy(c.Tpl.Id).Select(c.Doc.GetElement).Where(e => e != null && !(e is Rebar)).ToList();
            List<Element> hb = hosts.HostedBy(c.Tgt.Id).Select(c.Doc.GetElement).Where(e => e != null && !(e is Rebar)).ToList();
            if (ha.Count > 0)
                MatchChildren(c, ha, hb, false);
        }

        /// <summary>
        /// Загварт суусан элемент бүрийн ихрийг зорилтоос олно: ижил ангилал, буулгасан
        /// төвтэй хамгийн ойр (ижил төрөл/хэлбэр давуу).  Арматурын «үүрэг» = байрлал + хэлбэр.
        /// </summary>
        private static int MatchChildren(CdContext c, List<Element> src, List<Element> pool, bool rebar)
        {
            var left = new List<Element>(pool);
            double diag = c.Map.B.Size.GetLength();
            double tol = rebar ? Math.Max(0.5, diag * 0.1) : NeighborTol;
            int matched = 0;
            foreach (Element s in src)
            {
                XYZ sc = Center(s);
                if (sc == null)
                    continue;
                XYZ want = c.Map.Point(sc);
                Element best = null;
                double bestD = double.MaxValue;
                foreach (Element t in left)
                {
                    if (t.Category?.Id != s.Category?.Id)
                        continue;
                    XYZ tc = Center(t);
                    if (tc == null)
                        continue;
                    double d = want.DistanceTo(tc);
                    if (t.GetTypeId() != s.GetTypeId())
                        d += tol * 0.5;
                    if (rebar && s is Rebar rs && t is Rebar rt && rs.GetShapeId() != rt.GetShapeId())
                        d += tol * 0.5;
                    if (d < bestD) { bestD = d; best = t; }
                }
                if (best != null && bestD <= tol)
                {
                    c.ElementMap[s.Id] = best.Id;
                    left.Remove(best);
                    matched++;
                }
            }
            return matched;
        }

        private static XYZ Center(Element e)
        {
            BoundingBoxXYZ b = e?.get_BoundingBox(null);
            return b == null ? null : (b.Min + b.Max) / 2;
        }

        // ══ Харагдац ════════════════════════════════════════════════════════

        private static void DeleteOldClones(CdContext c)
        {
            var toDelete = new List<ElementId>();
            var sheetUids = new HashSet<string>();
            foreach (CdLinkedView lv in c.Plan.Views.Where(v => v.Mode == CdViewMode.NewView))
            {
                ElementId ex = c.Plan.Clones.Find(lv.UniqueId, c.Tgt.UniqueId);
                if (ex != null && c.Doc.GetElement(ex) != null)
                    toDelete.Add(ex);
                if (lv.SheetId != null && lv.SheetId != ElementId.InvalidElementId && c.Doc.GetElement(lv.SheetId) is ViewSheet sh)
                    sheetUids.Add(sh.UniqueId);
            }
            foreach (string su in sheetUids)
            {
                ElementId ex = c.Plan.Clones.Find(su, c.Tgt.UniqueId);
                if (ex != null && c.Doc.GetElement(ex) != null)
                    toDelete.Insert(0, ex);
            }
            if (toDelete.Count == 0)
                return;
            var names = new List<string>();
            var numbers = new List<string>();
            foreach (ElementId id in toDelete)
            {
                if (c.Doc.GetElement(id) is ViewSheet vs)
                    numbers.Add(vs.SheetNumber);
                else if (c.Doc.GetElement(id) is View v)
                    names.Add(v.Name);
            }
            try
            {
                c.Doc.Delete(toDelete);
                // Устгасан нэр, дугаарыг чөлөөлнө — эс бөгөөс шинэ клон «… 2», «S-B2.2» болно.
                foreach (string n in names) c.Plan.ViewNames.Remove(n);
                foreach (string n in numbers) c.Plan.SheetNumbers.Remove(n);
                c.Rep.ViewsDeleted += toDelete.Count;
                c.Plan.Clones.Remove(c.Tgt.UniqueId);
                c.Plan.Viewports = new FilteredElementCollector(c.Doc).OfClass(typeof(Viewport)).Cast<Viewport>().ToList();
            }
            catch (Exception ex)
            {
                c.Rep.Note("Өмнөх клоныг устгаж чадсангүй (" + c.TgtLabel + "): " + ex.Message);
            }
        }

        private static View GetOrCreateView(CdContext c, CdLinkedView lv)
        {
            Document doc = c.Doc;
            if (!(doc.GetElement(lv.ViewId) is View src))
                return null;
            ElementId ex = c.Plan.Clones.Find(src.UniqueId, c.Tgt.UniqueId);
            if (ex != null && doc.GetElement(ex) is View old && !old.IsTemplate)
            {
                if (c.Rep.Once(ViewKey(c, old.Id))) // энэ ажилд үүсгэсэн/тоолсныг (Ctrl+Z-ийн дараах дахин хийлт) дахин тоолохгүй
                    c.Rep.ViewsReused++;
                c.ReusedViews.Add(old.Id);
                return old;
            }

            using (var st = new SubTransaction(doc))
            {
                st.Start();
                try
                {
                    View nv = null;
                    if (lv.IsCallout)
                        nv = TryCallout(c, src, lv);
                    if (nv == null)
                    {
                        if (src is ViewPlan vp)
                            nv = ClonePlan(c, vp);
                        else if (src is View3D v3)
                            nv = Clone3D(c, v3);
                        else if (src is ViewSection)
                            nv = CloneSection(c, src);
                    }
                    if (nv == null)
                    {
                        st.RollBack();
                        c.Rep.ViewsFailed++;
                        c.Rep.Note("«" + src.Name + "» төрлийн харагдацыг хувилж болохгүй.");
                        return null;
                    }
                    FinishView(c, src, nv);
                    CdLinks.Write(nv, new CdLinks.Record
                    {
                        Kind = CdLinks.KindView,
                        TemplateUid = c.Tpl.UniqueId,
                        TargetUid = c.Tgt.UniqueId,
                        SourceUid = src.UniqueId,
                    });
                    st.Commit();
                    c.Plan.Clones.Add(src.UniqueId, c.Tgt.UniqueId, nv.Id);
                    c.Rep.Once(ViewKey(c, nv.Id));
                    c.Rep.ViewsCreated++;
                    c.Rep.NewViews.Add(nv.Name);
                    if (c.Rep.FirstViewId == null)
                        c.Rep.FirstViewId = nv.Id;
                    return nv;
                }
                catch (Exception ex2)
                {
                    if (st.HasStarted() && !st.HasEnded())
                        st.RollBack();
                    c.Rep.ViewsFailed++;
                    c.Rep.Note("«" + src.Name + "» харагдацыг " + c.TgtLabel + "-д үүсгэж чадсангүй: " + ex2.Message);
                    return null;
                }
            }
        }

        /// <summary>Зүсэлтийн хүрээ харагдацын чиглэлээр (Revit-ийн дотоод илэрхийллээс үл хамаарна).</summary>
        private sealed class SectionFrame
        {
            public XYZ Center, R, U, V, Half;
        }

        /// <summary>
        /// Эх харагдацын тайрах хүрээний 8 булангийн буулгалт + шинэ чиглэлүүд.  Толин
        /// тусгалд Right-ыг урвуулж баруун гарын систем болгоно (R × U = V).
        /// </summary>
        private static SectionFrame MapSectionFrame(CdContext c, View src)
        {
            XYZ r = c.Map.Vector(src.RightDirection).Normalize();
            XYZ u = c.Map.Vector(src.UpDirection).Normalize();
            XYZ v = c.Map.Vector(src.ViewDirection).Normalize();
            if (!c.Map.IsRigid)
                r = r.Negate();
            BoundingBoxXYZ cb = src.CropBox;
            Transform ct = cb.Transform;
            var pts = CdFrame.Corners(cb.Min, cb.Max).Select(p => c.Map.Point(ct.OfPoint(p))).ToList();
            double[] lo = { double.MaxValue, double.MaxValue, double.MaxValue };
            double[] hi = { double.MinValue, double.MinValue, double.MinValue };
            XYZ[] ax = { r, u, v };
            foreach (XYZ p in pts)
            {
                for (int i = 0; i < 3; i++)
                {
                    double d = p.DotProduct(ax[i]);
                    lo[i] = Math.Min(lo[i], d);
                    hi[i] = Math.Max(hi[i], d);
                }
            }
            XYZ center = r * ((lo[0] + hi[0]) / 2) + u * ((lo[1] + hi[1]) / 2) + v * ((lo[2] + hi[2]) / 2);
            return new SectionFrame
            {
                Center = center,
                R = r,
                U = u,
                V = v,
                Half = new XYZ((hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2, (hi[2] - lo[2]) / 2),
            };
        }

        /// <summary>
        /// Зүсэлт / дэлгэрэнгүй / фасад.  ⚠️ CreateSection-ийн оролтын тэнхлэг =
        /// (−Right, Up, −ViewDirection), төв нь хүрээний төв — «Хуулж тавих»-д Revit 2027
        /// дээр хэмжиж баталсан (CropBox-ыг шууд хувиргаж өгвөл харах чиг урвуу гардаг).
        /// Фасадыг (ElevationMarker шаарддаг) ижил хүрээтэй ЗҮСЭЛТ болгож үүсгэнэ.
        /// </summary>
        private static View CloneSection(CdContext c, View src)
        {
            SectionFrame f = MapSectionFrame(c, src);
            Transform nt = Transform.Identity;
            nt.Origin = f.Center;
            nt.BasisX = f.R.Negate();
            nt.BasisY = f.U;
            nt.BasisZ = f.V.Negate();
            var box = new BoundingBoxXYZ { Transform = nt, Min = f.Half.Negate(), Max = f.Half };

            ElementId typeId = src.GetTypeId();
            var vft = c.Doc.GetElement(typeId) as ViewFamilyType;
            if (vft == null || vft.ViewFamily == ViewFamily.Elevation)
            {
                ViewFamilyType sec = new FilteredElementCollector(c.Doc).OfClass(typeof(ViewFamilyType)).Cast<ViewFamilyType>()
                    .FirstOrDefault(t => t.ViewFamily == ViewFamily.Section);
                if (sec == null)
                    return null;
                typeId = sec.Id;
                vft = sec;
                c.Rep.Note("Фасад харагдацыг ижил хүрээтэй ЗҮСЭЛТ болгож үүсгэв («" + src.Name + "»).");
            }
            ViewSection ns = vft.ViewFamily == ViewFamily.Detail
                ? ViewSection.CreateDetail(c.Doc, typeId, box)
                : ViewSection.CreateSection(c.Doc, typeId, box);
            CopyViewSettings(c, src, ns);
            return ns;
        }

        private static View ClonePlan(CdContext c, ViewPlan src)
        {
            Document doc = c.Doc;
            Level lvl = src.GenLevel;
            Level nl = lvl == null ? null : (MapLevel(c, lvl) ?? doc.GetElement(CdAnalysis.LevelIdOf(c.Tgt)) as Level ?? lvl);
            ElementId primary = src.GetPrimaryViewId();
            View nv = null;
            if (SafeCallout(src) && (nl ?? lvl) != null)
            {
                // Callout-ыг Duplicate хийвэл ЭХ (загварын) план дээр нь шинэ callout үүснэ — тэмдэг нь загварын зурагт
                // үлдэнэ (2026-10-02 хяналт).  Энд ирсэн нь эх план энэ зорилтод клонлогдоогүй гэсэн үг тул бие даасан план.
                ViewPlan np = null;
                try
                {
                    ElementId type = PlanTypeFor(doc, src);
                    if (type != null)
                    {
                        np = ViewPlan.Create(doc, type, (nl ?? lvl).Id);
                        CopyViewSettings(c, src, np);
                        CopyViewRange(src, np);
                        nv = np;
                    }
                }
                catch
                {
                    nv = null;
                    if (np != null)
                    {
                        try { doc.Delete(np.Id); } catch { } // хагас тохируулсан план үлдээхгүй
                    }
                }
                if (nv == null)
                    c.Rep.NoteFor("«" + src.Name + "»: callout-ыг бие даасан план болгож чадсангүй — callout хэвээр хувилав", c.TgtLabel);
            }
            if (nv == null)
            {
                if (lvl == null || nl == null || nl.Id == lvl.Id)
                {
                    ElementId id = primary != ElementId.InvalidElementId
                        ? ((View)doc.GetElement(primary)).Duplicate(ViewDuplicateOption.AsDependent)
                        : src.Duplicate(ViewDuplicateOption.Duplicate);
                    nv = (View)doc.GetElement(id);
                }
                else
                {
                    ViewPlan np = ViewPlan.Create(doc, src.GetTypeId(), nl.Id);
                    CopyViewSettings(c, src, np);
                    CopyViewRange(src, np);
                    nv = np;
                }
            }
            nv.CropBoxActive = true;
            SetMappedCrop(c, src, nv, false);
            return nv;
        }

        /// <summary>
        /// Шинэ харагдацын тайрах хүрээ = эх хүрээний буулгасан булангууд ШИНЭ харагдацын
        /// өөрийн координатад.  Планд Z-ийг хөндөхгүй (түвшний харагдацын гүн өөр).
        /// </summary>
        private static void SetMappedCrop(CdContext c, View src, View dst, bool withDepth)
        {
            BoundingBoxXYZ cb = src.CropBox;
            Transform ct = cb.Transform;
            BoundingBoxXYZ nb = dst.CropBox;
            Transform inv = nb.Transform.Inverse;
            double z = c.Map.A.WorldCenter.Z;
            double minX = double.MaxValue, minY = double.MaxValue, minZ = double.MaxValue;
            double maxX = double.MinValue, maxY = double.MinValue, maxZ = double.MinValue;
            foreach (XYZ corner in CdFrame.Corners(cb.Min, cb.Max))
            {
                XYZ w = ct.OfPoint(corner);
                if (!withDepth)
                    w = new XYZ(w.X, w.Y, z);
                XYZ q = inv.OfPoint(c.Map.Point(w));
                minX = Math.Min(minX, q.X); maxX = Math.Max(maxX, q.X);
                minY = Math.Min(minY, q.Y); maxY = Math.Max(maxY, q.Y);
                minZ = Math.Min(minZ, q.Z); maxZ = Math.Max(maxZ, q.Z);
            }
            var want = new BoundingBoxXYZ
            {
                Transform = nb.Transform,
                Min = new XYZ(minX, minY, withDepth ? minZ : nb.Min.Z),
                Max = new XYZ(maxX, maxY, withDepth ? maxZ : nb.Max.Z),
            };
            dst.CropBox = want;

            // Тэгш өнцөгт биш тайрах хэлбэр — зөвхөн хатуу хувиргалтад (сунгахад хэлбэр эвдэрнэ).
            try
            {
                ViewCropRegionShapeManager sm = src.GetCropRegionShapeManager();
                if (sm != null && sm.ShapeSet && c.Map.IsRigid && c.Map.SameSize)
                {
                    IList<CurveLoop> shape = sm.GetCropShape();
                    if (shape.Count > 0)
                    {
                        CurveLoop mapped = MapLoop(c, shape[0], dst, !withDepth ? z : (double?)null);
                        if (mapped != null)
                            dst.GetCropRegionShapeManager().SetCropShape(mapped);
                    }
                }
            }
            catch
            {
                c.Rep.Note("«" + src.Name + "»-ийн тайрах хүрээний хэлбэрийг тэгш өнцөгт болгосон.");
            }
        }

        private static View Clone3D(CdContext c, View3D src)
        {
            if (src.IsPerspective || !src.IsSectionBoxActive)
                return null;
            // ⚠️ ХУРД: Duplicate ~25 мс (график, түгжээ, section box хамт хуулагдана).  CreateIsometric нь
            // БҮХ загварыг изометрээр харуулж ~0.4 с, дээр нь SetSectionBox ~0.35 с (хэмжсэн, харагдац бүрд).
            // Хэмжээ/тэмдэглэгээ хуулагдахгүй (ViewDuplicateOption.Duplicate) — бид өөрсдөө клонлоно.
            View3D nv = null;
            try
            {
                nv = c.Doc.GetElement(src.Duplicate(ViewDuplicateOption.Duplicate)) as View3D;
            }
            catch
            {
                nv = null;
            }
            if (nv == null)
            {
                nv = View3D.CreateIsometric(c.Doc, src.GetTypeId());
                CopyViewSettings(c, src, nv);
            }
            try { if (nv.IsLocked) nv.Unlock(); } catch { }
            try
            {
                ViewOrientation3D o = src.GetOrientation();
                XYZ up = c.Map.Vector(o.UpDirection).Normalize();
                XYZ fwd = c.Map.Vector(o.ForwardDirection).Normalize();
                nv.SetOrientation(new ViewOrientation3D(c.Map.Point(o.EyePosition), up, fwd));
            }
            catch { }
            // Эх 3D түгжигдсэн бол (tag-тай 3D заавал түгжигдсэн байдаг) клоныг ч түгжинэ —
            // эс бөгөөс 3D дээр tag үүсгэж болохгүй.
            if (src.IsLocked)
            {
                try { nv.SaveOrientationAndLock(); } catch { }
            }

            BoundingBoxXYZ sb = src.GetSectionBox();
            Transform bt = sb.Transform;
            XYZ x = c.Map.Vector(bt.BasisX).Normalize(), y = c.Map.Vector(bt.BasisY).Normalize(), zz = c.Map.Vector(bt.BasisZ).Normalize();
            if (!c.Map.IsRigid)
                x = x.Negate();
            var pts = CdFrame.Corners(sb.Min, sb.Max).Select(p => c.Map.Point(bt.OfPoint(p))).ToList();
            try
            {
                Transform nt = Transform.Identity;
                nt.BasisX = x;
                nt.BasisY = y;
                nt.BasisZ = zz;
                nv.SetSectionBox(BoxIn(nt, pts));
            }
            catch
            {
                // Хэвтээ биш тэнхлэгтэй хайрцгийг Revit татгалзаж болно — ертөнцийн тэнхлэгт.
                nv.SetSectionBox(BoxIn(Transform.Identity, pts));
            }
            return nv;
        }

        private static BoundingBoxXYZ BoxIn(Transform t, IEnumerable<XYZ> world)
        {
            Transform inv = t.Inverse;
            double minX = double.MaxValue, minY = double.MaxValue, minZ = double.MaxValue;
            double maxX = double.MinValue, maxY = double.MinValue, maxZ = double.MinValue;
            foreach (XYZ p in world)
            {
                XYZ q = inv.OfPoint(p);
                minX = Math.Min(minX, q.X); maxX = Math.Max(maxX, q.X);
                minY = Math.Min(minY, q.Y); maxY = Math.Max(maxY, q.Y);
                minZ = Math.Min(minZ, q.Z); maxZ = Math.Max(maxZ, q.Z);
            }
            return new BoundingBoxXYZ { Transform = t, Min = new XYZ(minX, minY, minZ), Max = new XYZ(maxX, maxY, maxZ) };
        }

        /// <summary>
        /// Callout-ыг ЖИНХЭНЭ callout болгож эх харагдац дээр нь (эх нь хувилагдсан бол клон
        /// дээр) үүсгэнэ — эх харагдац дээр callout-ын хүрээ, дугаар гарна.  Бүтэлгүйтвэл
        /// null → энгийн зүсэлт/план болгон клонлоно.
        /// </summary>
        private static View TryCallout(CdContext c, View src, CdLinkedView lv)
        {
            Document doc = c.Doc;
            if (lv.CalloutParentId == null || lv.CalloutParentId == ElementId.InvalidElementId)
                return null;
            bool parentCloned = c.Dest.TryGetValue(lv.CalloutParentId, out View cp);
            View parent = parentCloned ? cp : doc.GetElement(lv.CalloutParentId) as View;
            if (parent == null)
                return null;
            // Эх нь энэ зорилтод клонлогдоогүй (шүүлтээр нуугдсан, сонгоогүй, алхам нь буцаагдсан) бол:
            //  • зүсэлт/фасадын callout эхийнхээ ХАВТГАЙГААР зүсдэг — ЗАГВАРЫН зүсэлт дээр тавивал зорилт биш загварыг
            //    харуулна (мөн загварын зурагт илүү тэмдэг үлдэнэ);
            //  • загварт ЗОРИУЛСАН план дээр тавивал тэмдэг нь загварын зурагт (хүрээнээс гадна) үлдэнэ.
            // Аль алинд нь энгийн зүсэлт/план болгон клонлоно (null → GetOrCreateView).  Ерөнхий план дээрх callout хэвээр.
            if (!parentCloned && (!(parent is ViewPlan) || IsDedicatedSource(c, lv.CalloutParentId)))
                return null;
            if (src is ViewPlan sp && parent is ViewPlan pp)
            {
                Level nl = sp.GenLevel == null ? null : MapLevel(c, sp.GenLevel);
                if (nl != null && pp.GenLevel != null && nl.Id != pp.GenLevel.Id)
                {
                    parent = FindPlanOn(doc, nl, pp);
                    if (parent == null)
                        return null;
                }
            }
            try
            {
                BoundingBoxXYZ cb = src.CropBox;
                Transform ct = cb.Transform;
                XYZ r = parent.RightDirection, u = parent.UpDirection;
                XYZ o = ViewPlaneOrigin(parent);
                double z = c.Map.A.WorldCenter.Z;
                double minR = double.MaxValue, minU = double.MaxValue, maxR = double.MinValue, maxU = double.MinValue;
                foreach (XYZ corner in CdFrame.Corners(cb.Min, cb.Max))
                {
                    XYZ w = ct.OfPoint(corner);
                    if (src is ViewPlan)
                        w = new XYZ(w.X, w.Y, z);
                    XYZ q = c.Map.Point(w) - o;
                    minR = Math.Min(minR, q.DotProduct(r)); maxR = Math.Max(maxR, q.DotProduct(r));
                    minU = Math.Min(minU, q.DotProduct(u)); maxU = Math.Max(maxU, q.DotProduct(u));
                }
                XYZ p1 = o + r * minR + u * minU, p2 = o + r * maxR + u * maxU;
                View nv = ViewSection.CreateCallout(doc, parent.Id, src.GetTypeId(), p1, p2);
                CopyViewSettings(c, src, nv);
                nv.CropBoxActive = true;
                if (!(src is ViewPlan))
                {
                    // Зүсэлтийн callout-ын гүнийг эхийнхтэй адил болгоно.
                    try { SetMappedCrop(c, src, nv, true); } catch { }
                }
                return nv;
            }
            catch
            {
                return null;
            }
        }

        /// <summary>Энэ харагдац загварт ЗОРИУЛСАН (өөрийн) зураг уу — загварын холбоотой харагдац эсвэл хайж олсон нэр дэвшигч.</summary>
        private static bool IsDedicatedSource(CdContext c, ElementId viewId)
        {
            CdTemplateInfo info = c.Plan.Info;
            if (info == null)
                return false;
            return (info.Views != null && info.Views.Any(v => v.ViewId == viewId && v.Dedicated))
                || (info.Candidates != null && info.Candidates.Any(v => v.ViewId == viewId && v.Dedicated));
        }

        private static ViewPlan FindPlanOn(Document doc, Level level, ViewPlan like)
        {
            List<ViewPlan> plans = new FilteredElementCollector(doc).OfClass(typeof(ViewPlan)).Cast<ViewPlan>()
                .Where(p => !p.IsTemplate && p.ViewType == like.ViewType && p.GenLevel != null && p.GenLevel.Id == level.Id
                            && p.GetPrimaryViewId() == ElementId.InvalidElementId && !SafeCallout(p))
                .ToList();
            return plans.FirstOrDefault(p => p.ViewTemplateId == like.ViewTemplateId) ?? plans.FirstOrDefault();
        }

        private static bool SafeCallout(View v)
        {
            try { return v.IsCallout; }
            catch { return false; }
        }

        /// <summary>
        /// Plan callout-ыг бие даасан план болгох төрөл: callout өөрөө план төрөлтэй бол тэр (харагдах тохиргоо ижил), үгүй
        /// бол (жишээ нь «Detail View» төрөл) харагдацын төрөлд таарах анхны план төрөл.  null = олдсонгүй.
        /// </summary>
        private static ElementId PlanTypeFor(Document doc, ViewPlan src)
        {
            ViewFamily want = src.ViewType == ViewType.CeilingPlan ? ViewFamily.CeilingPlan
                : src.ViewType == ViewType.EngineeringPlan ? ViewFamily.StructuralPlan
                : ViewFamily.FloorPlan;
            if (doc.GetElement(src.GetTypeId()) is ViewFamilyType own && own.ViewFamily == want)
                return own.Id;
            return new FilteredElementCollector(doc).OfClass(typeof(ViewFamilyType)).Cast<ViewFamilyType>()
                .FirstOrDefault(t => t.ViewFamily == want)?.Id;
        }

        private static void CopyViewSettings(CdContext c, View src, View dst)
        {
            CopyGraphics(c, src, dst);
            try { if (src.ViewTemplateId != ElementId.InvalidElementId && dst.ViewTemplateId != src.ViewTemplateId) dst.ViewTemplateId = src.ViewTemplateId; } catch { }
            try { if (dst.Scale != src.Scale) dst.Scale = src.Scale; } catch { }
            try { if (dst.DetailLevel != src.DetailLevel) dst.DetailLevel = src.DetailLevel; } catch { }
            try { if (dst.DisplayStyle != src.DisplayStyle) dst.DisplayStyle = src.DisplayStyle; } catch { }
            foreach (BuiltInParameter bip in new[]
                     {
                         BuiltInParameter.VIEWER_BOUND_FAR_CLIPPING, BuiltInParameter.VIEW_DISCIPLINE,
                         BuiltInParameter.VIEWER_ANNOTATION_CROP_ACTIVE,
                     })
            {
                CopyParam(src.get_Parameter(bip), dst.get_Parameter(bip), null);
            }
            try { dst.CropBoxVisible = src.CropBoxVisible; } catch { }
            try
            {
                ViewCropRegionShapeManager a = src.GetCropRegionShapeManager(), b = dst.GetCropRegionShapeManager();
                if (a != null && b != null && a.CanHaveAnnotationCrop && b.CanHaveAnnotationCrop)
                {
                    b.LeftAnnotationCropOffset = a.LeftAnnotationCropOffset;
                    b.RightAnnotationCropOffset = a.RightAnnotationCropOffset;
                    b.TopAnnotationCropOffset = a.TopAnnotationCropOffset;
                    b.BottomAnnotationCropOffset = a.BottomAnnotationCropOffset;
                }
            }
            catch { }
        }

        /// <summary>
        /// Visibility/Graphics — нуусан ангилал, ангиллын override, filter.  CreateSection /
        /// CreateCallout / ViewPlan.Create нь ЭХ ХАРАГДАЦЫН (callout-д parent-ын) тохиргоог авдаг
        /// тул загвар харагдацад инженерийн хийсэн өөрчлөлт (жишээ нь планд баганыг харуулах)
        /// алдагдана — хэмжсэн: «Top of Footing» план баганыг нуудаг тул callout-д багана алга.
        /// View template-тэй бол template өөрөө удирдана — хөндөхгүй.
        /// </summary>
        private static void CopyGraphics(CdContext c, View src, View dst)
        {
            if (src.ViewTemplateId != ElementId.InvalidElementId)
                return;
            if (!c.Plan.Hideable.TryGetValue(src.Id, out List<ElementId> cats))
            {
                cats = new List<ElementId>();
                foreach (Category cat in c.Doc.Settings.Categories)
                {
                    AddHideable(src, cat, cats);
                    try
                    {
                        foreach (Category sub in cat.SubCategories)
                            AddHideable(src, sub, cats);
                    }
                    catch { }
                }
                c.Plan.Hideable[src.Id] = cats;
            }
            foreach (ElementId id in cats)
                CopyCategoryGraphics(src, dst, id);
            try
            {
                foreach (ElementId fid in src.GetFilters())
                {
                    try
                    {
                        if (!dst.IsFilterApplied(fid))
                            dst.AddFilter(fid);
                        dst.SetFilterOverrides(fid, src.GetFilterOverrides(fid));
                        dst.SetFilterVisibility(fid, src.GetFilterVisibility(fid));
                    }
                    catch { }
                }
            }
            catch { }
        }

        private static void AddHideable(View src, Category cat, List<ElementId> into)
        {
            try
            {
                if (src.CanCategoryBeHidden(cat.Id))
                    into.Add(cat.Id);
            }
            catch { }
        }

        /// <summary>
        /// ⚠️ ХУРД: зөрсөн үед л бичнэ — 700 ангилалд ижил override-ыг дахин бичих нь харагдац бүрд ~35 мс
        /// (30 харагдацад 1 с), уншиж харьцуулах нь ~4 мс.
        /// </summary>
        private static void CopyCategoryGraphics(View src, View dst, ElementId id)
        {
            try
            {
                bool hidden = src.GetCategoryHidden(id);
                if (dst.GetCategoryHidden(id) != hidden)
                    dst.SetCategoryHidden(id, hidden);
                OverrideGraphicSettings o = src.GetCategoryOverrides(id);
                if (!SameOverrides(o, dst.GetCategoryOverrides(id)))
                    dst.SetCategoryOverrides(id, o);
            }
            catch { }
        }

        private static bool SameOverrides(OverrideGraphicSettings a, OverrideGraphicSettings b) =>
            a.ProjectionLineWeight == b.ProjectionLineWeight && a.CutLineWeight == b.CutLineWeight
            && a.ProjectionLinePatternId == b.ProjectionLinePatternId && a.CutLinePatternId == b.CutLinePatternId
            && SameColor(a.ProjectionLineColor, b.ProjectionLineColor) && SameColor(a.CutLineColor, b.CutLineColor)
            && a.SurfaceForegroundPatternId == b.SurfaceForegroundPatternId && SameColor(a.SurfaceForegroundPatternColor, b.SurfaceForegroundPatternColor)
            && a.IsSurfaceForegroundPatternVisible == b.IsSurfaceForegroundPatternVisible
            && a.SurfaceBackgroundPatternId == b.SurfaceBackgroundPatternId && SameColor(a.SurfaceBackgroundPatternColor, b.SurfaceBackgroundPatternColor)
            && a.IsSurfaceBackgroundPatternVisible == b.IsSurfaceBackgroundPatternVisible
            && a.CutForegroundPatternId == b.CutForegroundPatternId && SameColor(a.CutForegroundPatternColor, b.CutForegroundPatternColor)
            && a.IsCutForegroundPatternVisible == b.IsCutForegroundPatternVisible
            && a.CutBackgroundPatternId == b.CutBackgroundPatternId && SameColor(a.CutBackgroundPatternColor, b.CutBackgroundPatternColor)
            && a.IsCutBackgroundPatternVisible == b.IsCutBackgroundPatternVisible
            && a.Transparency == b.Transparency && a.Halftone == b.Halftone && a.DetailLevel == b.DetailLevel;

        private static bool SameColor(Color a, Color b)
        {
            if (a == null || b == null)
                return a == null && b == null;
            if (!a.IsValid || !b.IsValid)
                return a.IsValid == b.IsValid;
            return a.Red == b.Red && a.Green == b.Green && a.Blue == b.Blue;
        }

        /// <summary>Өөр түвшинд шинээр үүсгэсэн планд харах мужийг (view range) «одоогийн түвшин»-ээс хамааруулж хуулна.</summary>
        private static void CopyViewRange(ViewPlan src, ViewPlan dst)
        {
            try
            {
                if (dst.ViewTemplateId != ElementId.InvalidElementId)
                    return;
                PlanViewRange a = src.GetViewRange();
                PlanViewRange b = dst.GetViewRange();
                foreach (PlanViewPlane pl in new[] { PlanViewPlane.TopClipPlane, PlanViewPlane.CutPlane, PlanViewPlane.BottomClipPlane, PlanViewPlane.ViewDepthPlane })
                {
                    ElementId lid = a.GetLevelId(pl);
                    if (src.GenLevel != null && lid == src.GenLevel.Id)
                    {
                        b.SetLevelId(pl, dst.GenLevel.Id);
                        b.SetOffset(pl, a.GetOffset(pl));
                    }
                }
                dst.SetViewRange(b);
            }
            catch { }
        }

        private static void FinishView(CdContext c, View src, View nv)
        {
            string name = CloneNaming.ViewName(src.Name, c.TplMark, c.TgtMark, c.TgtLabel);
            if (!c.Plan.Options.ReplaceMark)
                name = src.Name + " - " + c.TgtLabel;
            name = CloneNaming.MakeUnique(name, n => c.Plan.ViewNames.Contains(n));
            try
            {
                nv.Name = name;
                c.Plan.ViewNames.Add(name);
            }
            catch
            {
                // Revit нэрийг хүлээж авсангүй (тусгай тэмдэгт) — Revit-ийн өгсөн нэр үлдэнэ.
            }
            CopyViewParams(c, src, nv);
            // Загвар элемент дээрх view-ийн override (өнгө, зураасны жин) → зорилт дээр.
            try
            {
                OverrideGraphicSettings o = src.GetElementOverrides(c.Tpl.Id);
                if (o != null)
                    nv.SetElementOverrides(c.Tgt.Id, o);
            }
            catch { }
        }

        /// <summary>
        /// Харагдацын «Title on Sheet» болон төслийн/хуваалцсан параметрүүд (хөтөчийн
        /// ангилал г.м.) — шинэ харагдац эх харагдацынхаа бүлэгт харагдана.
        /// </summary>
        private static void CopyViewParams(CdContext c, View src, View dst)
        {
            foreach (Parameter a in src.Parameters)
            {
                try
                {
                    if (a.IsReadOnly || !a.HasValue || a.Definition == null)
                        continue;
                    if (a.Definition is InternalDefinition idf && idf.BuiltInParameter != BuiltInParameter.INVALID
                        && idf.BuiltInParameter != BuiltInParameter.VIEW_DESCRIPTION)
                        continue;
                    CopyParam(a, dst.get_Parameter(a.Definition), c);
                }
                catch { }
            }
        }

        private static void CopyParam(Parameter a, Parameter b, CdContext c)
        {
            try
            {
                if (a == null || b == null || b.IsReadOnly || !a.HasValue)
                    return;
                switch (a.StorageType)
                {
                    case StorageType.String:
                        string s = a.AsString();
                        if (c != null && c.Plan.Options.ReplaceMark && CloneNaming.TryReplaceMark(s, c.TplMark, c.TgtMark, out string r))
                            s = r;
                        if (b.AsString() != s) b.Set(s ?? "");
                        break;
                    case StorageType.Integer:
                        if (b.AsInteger() != a.AsInteger()) b.Set(a.AsInteger());
                        break;
                    case StorageType.Double:
                        if (Math.Abs(b.AsDouble() - a.AsDouble()) > 1e-9) b.Set(a.AsDouble());
                        break;
                    case StorageType.ElementId:
                        if (b.AsElementId() != a.AsElementId()) b.Set(a.AsElementId());
                        break;
                }
            }
            catch { }
        }

        /// <summary>
        /// Шинэ клон харагдацад харагдах, ЭХ харагдацад байгаагүй, тайрах хүрээнээс ХОЛ (хүрээний
        /// хэмжээнээс илүү зайд) орших бусад харагдацын тэмдгийг нууна.  Эх зураг ч тэр тэмдгийг
        /// харуулдаггүй; үлдээвэл viewport-ын хайрцгийг хэдэн метрээр сунгаж хуудсан дээрх байрлал,
        /// гарчгийг эвдэнэ (B3-ийн зүсэлтэд 17 м зайтай «Longitudinal» тэмдэг, 2026-09-30 хэмжсэн).
        /// Ойрхон тэмдэг (клоны өөрийн фасад, зүсэлтийн шугам) хөндөгдөхгүй.
        /// </summary>
        private static void HideStrayViewers(CdContext c, View src, View dest)
        {
            if (dest is View3D || c.ReusedViews.Contains(dest.Id))
                return;
            try
            {
                if (!dest.CropBoxActive)
                    return;
                HashSet<ElementId> inSrc = c.Plan.ViewersIn(src);
                BoundingBoxXYZ cb = dest.CropBox;
                Transform inv = cb.Transform.Inverse;
                double margin = Math.Max(cb.Max.X - cb.Min.X, cb.Max.Y - cb.Min.Y);
                var hide = new List<ElementId>();
                foreach (Element e in new FilteredElementCollector(c.Doc, dest.Id).OfCategory(BuiltInCategory.OST_Viewers)
                             .WhereElementIsNotElementType())
                {
                    if (inSrc.Contains(e.Id) || !e.CanBeHidden(dest))
                        continue;
                    BoundingBoxXYZ bb = e.get_BoundingBox(dest);
                    if (bb == null)
                        continue;
                    double x0 = double.MaxValue, x1 = double.MinValue, y0 = double.MaxValue, y1 = double.MinValue;
                    foreach (XYZ p in CdFrame.Corners(bb.Min, bb.Max))
                    {
                        XYZ q = inv.OfPoint(p);
                        x0 = Math.Min(x0, q.X); x1 = Math.Max(x1, q.X);
                        y0 = Math.Min(y0, q.Y); y1 = Math.Max(y1, q.Y);
                    }
                    if (x1 < cb.Min.X - margin || x0 > cb.Max.X + margin || y1 < cb.Min.Y - margin || y0 > cb.Max.Y + margin)
                        hide.Add(e.Id);
                }
                if (hide.Count > 0)
                {
                    dest.HideElements(hide);
                    c.Rep.StrayViewersHidden += hide.Count;
                }
            }
            catch { }
        }

        // ══ Тэмдэглэгээ ═════════════════════════════════════════════════════

        /// <summary>
        /// Алхам 3 (эхлэл): нэг харагдацын тэмдэглэгээний АЖЛЫН ЖАГСААЛТ.  Ерөнхий харагдацад зорилт харагдахгүй бол null
        /// (тоологдоно).  Revit-ийг өөрчлөхгүй — зөвхөн уншина.  Хуучин `Annotate`-ийн дараалал, нөхцөл ЯГ хэвээр.
        /// </summary>
        internal static CdAnnotateWork BeginAnnotate(CdContext c, CdLinkedView lv)
        {
            if (!(c.Doc.GetElement(lv.ViewId) is View src) || !c.Plan.Sources.TryGetValue(lv.ViewId, out CdSourceAnnotations a))
                return null;
            View dest;
            bool dedicated;
            if (lv.Mode == CdViewMode.NewView)
            {
                if (!c.Dest.TryGetValue(lv.ViewId, out dest))
                    return null;
                dedicated = true;
            }
            else if (lv.Mode == CdViewMode.InPlace)
            {
                bool first = c.Rep.Once("ip|" + c.Tgt.Id.Value + "|" + src.Id.Value); // Ctrl+Z-ийн дараа дахин тоолохгүй
                if (!c.Sees(src, c.Tgt.Id))
                {
                    if (first)
                        c.Rep.InPlaceHidden++;
                    return null;
                }
                dest = src;
                dedicated = false;
                if (first)
                    c.Rep.InPlaceTargets++;
            }
            else
            {
                return null;
            }

            var w = new CdAnnotateWork { View = lv, SourceId = src.Id, DestId = dest.Id, Dedicated = dedicated };
            CdOptions o = c.Plan.Options;
            if (dest is View3D d3)
            {
                // 3D: tag-ийг (түгжигдсэн харагдацад) клонлоно; хэмжээс, spot нь ажлын хавтгай шаарддаг тул үгүй.
                if (o.Tags && d3.IsLocked)
                    w.Tags.AddRange(a.Tags);
                else if (o.Tags && a.Tags.Count > 0)
                    c.Rep.NoteFor("«" + src.Name + "»: 3D харагдац түгжигдээгүй тул tag хувилагдсангүй", c.TgtLabel);
                if (a.Dims.Count > 0)
                    c.Rep.Note("3D харагдацын хэмжээсийг хувилахгүй (ажлын хавтгай шаарддаг).");
            }
            else
            {
                if (o.Tags)
                {
                    w.Tags.AddRange(a.Tags);
                    if (dedicated)
                        w.RoomTags.AddRange(a.RoomTags);
                    w.Mras.AddRange(a.Mras);
                }
                if (o.Dimensions)
                    w.Dims.AddRange(a.Dims);
                if (o.Spots)
                    w.Spots.AddRange(a.Spots);
            }
            if (o.Details && dedicated && !(dest is View3D))
                w.Details.AddRange(a.Details);
            w.Stray = lv.Mode == CdViewMode.NewView;
            return w;
        }

        /// <summary>
        /// Алхам 3 (үргэлжлэл): тэмдэглэгээг НЭГ НЭГЭЭР — <paramref name="timeUp"/> «хугацаа дууссан» гэвэл зогсоод false
        /// буцаана (дараагийн алхам үргэлжлүүлнэ).  Нээлттэй Transaction дотор.  Элемент тус бүрийн алдааг барина — нэг
        /// муу tag бүх харагдацыг буцаахгүй.  Хэрэглэгч алхмын хооронд устгасан эх тэмдэглэгээг алгасна.
        /// </summary>
        internal static bool ContinueAnnotate(CdContext c, CdAnnotateWork w, Func<bool> timeUp)
        {
            View src = c.Doc.GetElement(w.SourceId) as View;
            View dest = c.Doc.GetElement(w.DestId) as View;
            if (src == null || dest == null)
            {
                c.Rep.NoteFor("«" + (w.View?.Name ?? "?") + "»: харагдац устсан тул тэмдэглэгээ нэмсэнгүй", c.TgtLabel);
                w.Phase = CdAnnotateWork.PhaseCount;
                return true;
            }
            try
            {
                while (true)
                {
                    bool done = w.Finished();
                    // Хэмжээсийн фазаас гарахад тэдгээрийг шалгана (хуучин дараалал: хэмжээс бүрэн → spot → 2D).
                    if (w.PendingDims.Count > 0 && (done || w.Phase != 3))
                        FinishDims(c, dest, w.PendingDims);
                    if (done)
                        return true;
                    int phase = w.Phase, i = w.Index;
                    w.Index++;
                    w.Done++;
                    try
                    {
                        RunItem(c, w, phase, i, src, dest);
                    }
                    catch (Exception ex)
                    {
                        CountItemFailure(c.Rep, phase);
                        c.Rep.Error("«" + src.Name + "» (" + c.TgtLabel + "): " + ex.Message.Trim().TrimEnd('.'));
                    }
                    if (timeUp != null && timeUp())
                        return w.Finished();
                }
            }
            finally
            {
                // Алхам дуусахаас өмнө (transaction-ы дотор) үлдсэн хэмжээсийг заавал шалгана.
                if (w.PendingDims.Count > 0)
                    FinishDims(c, dest, w.PendingDims);
            }
        }

        private static void RunItem(CdContext c, CdAnnotateWork w, int phase, int i, View src, View dest)
        {
            switch (phase)
            {
                case 0:
                    if (Valid(w.Tags[i])) CloneTags(c, new List<IndependentTag> { w.Tags[i] }, src, dest, w.Dedicated);
                    break;
                case 1:
                    if (Valid(w.RoomTags[i])) CloneRoomTags(c, new List<Autodesk.Revit.DB.Architecture.RoomTag> { w.RoomTags[i] }, src, dest);
                    break;
                case 2:
                    if (Valid(w.Mras[i])) CloneMras(c, new List<MultiReferenceAnnotation> { w.Mras[i] }, src, dest, w.Dedicated);
                    break;
                case 3:
                    if (Valid(w.Dims[i])) StartDim(c, w.Dims[i], src, dest, w.Dedicated, w.PendingDims);
                    break;
                case 4:
                    if (Valid(w.Spots[i])) CloneSpots(c, new List<SpotDimension> { w.Spots[i] }, dest, w.Dedicated);
                    break;
                case 5:
                    if (Valid(w.Details[i])) CloneDetails(c, src, new List<Element> { w.Details[i] }, dest);
                    break;
                case 6:
                    HideStrayViewers(c, src, dest);
                    break;
            }
        }

        private static bool Valid(Element e) => e != null && e.IsValidObject;

        /// <summary>Тайлангийн «зорилт × харагдац/хуудас» түлхүүр (<see cref="CdReport.Once"/>).</summary>
        private static string ViewKey(CdContext c, ElementId viewId) => "v|" + c.Tgt.Id.Value + "|" + viewId.Value;

        /// <summary>Worksharing: элементийг өөр хүн эзэмшиж (borrow) байна уу — тэр харагдацад юу ч нэмэх боломжгүй.</summary>
        internal static bool OwnedByOtherUser(Document doc, ElementId id)
        {
            try
            {
                return doc.IsWorkshared && WorksharingUtils.GetCheckoutStatus(doc, id) == CheckoutStatus.OwnedByOtherUser;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// Аюулгүй горимын алхмын элемент — transaction-ы нэр, тайланд («хэмжээс 12/40 · ID 123456»): аль эх тэмдэглэгээ
        /// бүтэлгүйтснийг инженер олно.
        /// </summary>
        internal static string ItemLabel(CdAnnotateWork w)
        {
            if (w.Finished())
                return null;
            int i = w.Index;
            string kind;
            Element e;
            switch (w.Phase)
            {
                case 0: kind = "tag"; e = w.Tags[i]; break;
                case 1: kind = "өрөөний tag"; e = w.RoomTags[i]; break;
                case 2: kind = "арматурын MRA"; e = w.Mras[i]; break;
                case 3: kind = "хэмжээс"; e = w.Dims[i]; break;
                case 4: kind = "түвшний тэмдэг"; e = w.Spots[i]; break;
                case 5: kind = "2D"; e = w.Details[i]; break;
                default: return "хол зүсэлтийн тэмдэг нуух";
            }
            string id = null;
            try
            {
                if (Valid(e))
                    id = e.Id.Value.ToString(System.Globalization.CultureInfo.InvariantCulture);
            }
            catch { }
            return kind + " " + (i + 1) + "/" + w.CountOf(w.Phase) + (id != null ? " · ID " + id : "");
        }

        /// <summary>Аюулгүй горимд буцаагдсан ГАНЦ элементийг алгасна — алгассанд тоолно (шалтгаан нь тайлангийн «АЛДАА»-д).</summary>
        internal static void SkipItem(CdContext c, CdAnnotateWork w)
        {
            if (w.Finished())
                return;
            if (w.Phase < CdAnnotateWork.PhaseCount - 1)
                CountItemFailure(c.Rep, w.Phase);
            w.SkipOne();
        }

        /// <summary>Харагдацын үлдсэн тэмдэглэгээг бүгдийг алгасна (алгассанд тоолно) — алгассан элементийн тоо.</summary>
        internal static int AbandonAnnotate(CdContext c, CdAnnotateWork w)
        {
            int n = 0;
            while (!w.Finished())
            {
                if (w.Phase < CdAnnotateWork.PhaseCount - 1)
                {
                    CountItemFailure(c.Rep, w.Phase);
                    n++;
                }
                w.SkipOne();
            }
            w.PendingDims.Clear();
            return n;
        }

        private static void CountItemFailure(CdReport rep, int phase)
        {
            switch (phase)
            {
                case 0: case 1: case 2: rep.TagsSkipped++; break;
                case 3: rep.DimsSkipped++; break;
                case 4: rep.SpotsSkipped++; break;
                case 5: rep.DetailsSkipped++; break;
            }
        }

        /// <summary>
        /// Эх харагдацын элементийн ихэр.  Ерөнхий харагдацад ЗӨВХӨН загвар ба түүний
        /// арматур/суусан элемент; загварт зориулсан харагдацад хөрш элементийг (дам
        /// нурууны үзүүрийн багана, дээрх хавтан) ч байрлалаар нь олно.
        /// </summary>
        private static ElementId MapElement(CdContext c, ElementId id, View dest, bool dedicated, bool relaxed = false)
        {
            if (c.ElementMap.TryGetValue(id, out ElementId to))
                return to;
            if (!dedicated)
                return null;
            if (c.TryGetNeighbor(id, dest, relaxed, out to))
                return to;
            to = MatchNeighbor(c, c.Doc.GetElement(id), dest, relaxed);
            c.SetNeighbor(id, dest, relaxed, to);
            return to;
        }

        /// <summary>
        /// Хөрш элементийн ихэр.  Хатуу (хэмжээст): буулгасан байрлалаас ≤15 см.  Сул (tag-т):
        /// олдохгүй бол ИЖИЛ ТӨРЛИЙН хамгийн ойрыг ≤1 м-т — фермүүд (joist) дам нуруу бүрийн дагуу
        /// өөр шилжилттэй байрладаг тул яг тэр цэгт ихэр байдаггүй, харин зураг ИЖИЛ харагдах ёстой
        /// (tag буруу элементэд очсон ч текст нь тэр төрлийнх — хэмжээс шиг худал тоо гарахгүй).
        /// </summary>
        private static ElementId MatchNeighbor(CdContext c, Element e, View dest, bool relaxed = false)
        {
            if (e?.Category == null || e is Grid || e is Level || e is ReferencePlane || e.ViewSpecific)
                return null;
            XYZ anchor;
            XYZ dir = null;
            if (e.Location is LocationCurve lc && lc.Curve != null && lc.Curve.IsBound)
            {
                anchor = lc.Curve.Evaluate(0.5, true);
                if (lc.Curve is Line ln)
                    dir = ln.Direction;
            }
            else if (e.Location is LocationPoint lp)
            {
                anchor = lp.Point;
            }
            else
            {
                anchor = Center(e);
            }
            if (anchor == null)
                return null;
            XYZ want = c.Map.Point(anchor);
            XYZ wdir = dir == null ? null : c.Map.Vector(dir).Normalize();

            Element best = null;
            double bestD = NeighborTol;
            List<Element> pool = c.Pool(dest, e.Category.Id);
            foreach (Element k in pool)
            {
                double d;
                if (wdir != null && k.Location is LocationCurve kc && kc.Curve is Line kl)
                {
                    if (Math.Abs(kl.Direction.DotProduct(wdir)) < 0.98)
                        continue;
                    d = kl.Distance(want);
                }
                else if (wdir == null && k.Location is LocationPoint kp && e.Location is LocationPoint)
                {
                    d = kp.Point.DistanceTo(want);
                }
                else
                {
                    BoundingBoxXYZ b = k.get_BoundingBox(null);
                    if (b == null)
                        continue;
                    bool inside = want.X >= b.Min.X - 0.1 && want.X <= b.Max.X + 0.1 && want.Y >= b.Min.Y - 0.1
                                  && want.Y <= b.Max.Y + 0.1 && want.Z >= b.Min.Z - 0.1 && want.Z <= b.Max.Z + 0.1;
                    d = inside ? 0 : ((b.Min + b.Max) / 2).DistanceTo(want);
                }
                if (k.GetTypeId() != e.GetTypeId())
                    d += 0.05;
                if (d < bestD)
                {
                    bestD = d;
                    best = k;
                }
            }
            if (best != null)
                return best.Id;
            // Нэг л үргэлжилсэн элемент (хавтан, хана) хоёр зурагт хоёуланд нь харагдана.
            if (c.Sees(dest, e.Id))
                return e.Id;
            if (!relaxed)
                return null;
            // Сул: ≤1 м-т хамгийн ойр — ижил төрөл давуу (өөр төрөлд +15 см торгууль).  Тухайн
            // байрлалд өөр хэмжээтэй ферм байвал ТҮҮНИЙГ tag-лана (зураг ижил харагдана).
            Element near = null;
            double nearD = RelaxedTol;
            foreach (Element k in pool)
            {
                double d = NearestDistance(k, want) + (k.GetTypeId() == e.GetTypeId() ? 0 : NeighborTol);
                if (d < nearD)
                {
                    nearD = d;
                    near = k;
                }
            }
            return near?.Id;
        }

        /// <summary>Элементийн тэнхлэг/цэг/хүрээнээс цэг хүртэлх зай.</summary>
        private static double NearestDistance(Element k, XYZ p)
        {
            try
            {
                if (k.Location is LocationCurve kc && kc.Curve != null)
                    return kc.Curve.Distance(p);
                if (k.Location is LocationPoint kp)
                    return kp.Point.DistanceTo(p);
            }
            catch { }
            BoundingBoxXYZ b = k.get_BoundingBox(null);
            if (b == null)
                return double.MaxValue;
            double dx = Math.Max(0, Math.Max(b.Min.X - p.X, p.X - b.Max.X));
            double dy = Math.Max(0, Math.Max(b.Min.Y - p.Y, p.Y - b.Max.Y));
            double dz = Math.Max(0, Math.Max(b.Min.Z - p.Z, p.Z - b.Max.Z));
            return Math.Sqrt(dx * dx + dy * dy + dz * dz);
        }

        // ── Tag ────────────────────────────────────────────────────────────

        /// <summary>
        /// Tag-ийг ЗАГВАРЫНХТАЙ ИЖИЛ клонлоно: ижил төрөл, чиглэл (планд 90° эргэсэн бол босоо),
        /// буулгасан толгойн байрлал, leader (төгсгөлийн нөхцөл, чөлөөт төгсгөл, тохой), эргэлтийн өнцөг.
        /// Лавлагаа бүрийг тус тусад нь буулгана:
        ///   • элемент — загвар/арматур/суусан элемент, эсвэл (тусгай харагдацад) хөрш элемент;
        ///   • нүүр (материалын tag) — зорилтын ижил нүүр;
        ///   • link файлын элемент — тэр link-ийн доторх ихэр.
        /// Олон элементийн tag (multi-reference)-ийг бүх лавлагаатай нь.
        /// </summary>
        private static void CloneTags(CdContext c, List<IndependentTag> tags, View src, View dest, bool dedicated)
        {
            Document doc = c.Doc;
            HashSet<string> have = c.TagKeys(dest);
            foreach (IndependentTag tag in tags)
            {
                IList<Reference> refs;
                try { refs = tag.GetTaggedReferences(); }
                catch { continue; }
                if (refs == null || refs.Count == 0)
                    continue;
                if (!dedicated && !refs.Any(r => r.LinkedElementId == ElementId.InvalidElementId && c.Plan.Info.Related.Contains(r.ElementId)))
                    continue;
                if (!c.AllowedKinds(refs.Select(r => TaggedElement(doc, r))))
                {
                    c.Rep.KindFiltered++;
                    continue;
                }

                var mapped = new List<Reference>();
                var keys = new List<string>();
                string firstKey = null, why = null;
                foreach (Reference r in refs)
                {
                    Reference nr = MapTagReference(c, r, dest, dedicated, out string k, out why);
                    if (nr == null)
                        break;
                    mapped.Add(nr);
                    keys.Add(k);
                    if (firstKey == null)
                        firstKey = k;
                }
                if (mapped.Count != refs.Count)
                {
                    c.Rep.TagsSkipped++;
                    c.Rep.NoteFor("«" + src.Name + "»: " + (why ?? "tag-ийн элементийн ихэр олдсонгүй"), c.TgtLabel);
                    continue;
                }

                bool material = false;
                try { material = tag.IsMaterialTag; } catch { }
                XYZ head = InView(dest, c.Map.Point(tag.TagHeadPosition));
                string key = tag.GetTypeId().Value + "|" + firstKey;
                if (material ? HasTagNear(c, dest, tag.GetTypeId(), mapped[0].ElementId, head) : have.Contains(key))
                {
                    c.Rep.TagsExisting++;
                    continue;
                }

                using (var st = new SubTransaction(doc))
                {
                    st.Start();
                    try
                    {
                        TagOrientation ori = AdaptOrientation(c, tag.TagOrientation, dest);
                        IndependentTag nt = IndependentTag.Create(doc, tag.GetTypeId(), dest.Id, mapped[0], false, ori, head);
                        if (mapped.Count > 1)
                            nt.AddReferences(mapped.Skip(1).ToList());
                        if (ori == TagOrientation.AnyModelDirection)
                        {
                            try { nt.RotationAngle = tag.RotationAngle + (dest is ViewPlan ? c.Map.PlanAngle : 0); } catch { }
                        }
                        try { if (nt.MergeElbows != tag.MergeElbows) nt.MergeElbows = tag.MergeElbows; } catch { }
                        if (tag.HasLeader)
                        {
                            nt.HasLeader = true;
                            CopyLeaders(c, tag, refs, nt, dest);
                            nt.TagHeadPosition = head;
                        }
                        st.Commit();
                        // Шинэ tag-ийн БҮХ лавлагааны түлхүүр — дахин уншсан (TagKeys) үеийнхтэй ижил олонлог.  Ерөнхий
                        // харагдацын түлхүүр ажиллуулалтад нэг (CdPlan.SharedTagKeys) тул энэ нь чухал.
                        have.Add(key);
                        foreach (string k in keys)
                        {
                            if (k != null)
                                have.Add(tag.GetTypeId().Value + "|" + k);
                        }
                        c.Rep.Tags++;
                    }
                    catch (Exception ex)
                    {
                        if (st.HasStarted() && !st.HasEnded())
                            st.RollBack();
                        c.Rep.TagsSkipped++;
                        c.Rep.NoteFor("«" + src.Name + "»: Revit tag үүсгэхийг татгалзсан (" + ex.Message.Trim().TrimEnd('.') + ")", c.TgtLabel);
                    }
                }
            }
        }

        /// <summary>Tag-ийн лавлах элемент (link-ийнх бол link файлаас).</summary>
        private static Element TaggedElement(Document doc, Reference r)
        {
            try
            {
                if (r.LinkedElementId != ElementId.InvalidElementId)
                    return (doc.GetElement(r.ElementId) as RevitLinkInstance)?.GetLinkDocument()?.GetElement(r.LinkedElementId);
                return doc.GetElement(r.ElementId);
            }
            catch
            {
                return null;
            }
        }

        /// <summary>Tag-ийн нэг лавлагааг зорилт руу.  <paramref name="key"/> — давхардлын түлхүүр, <paramref name="why"/> — олдоогүй шалтгаан.</summary>
        private static Reference MapTagReference(CdContext c, Reference r, View dest, bool dedicated, out string key, out string why)
        {
            key = null;
            why = null;
            Document doc = c.Doc;
            if (r.LinkedElementId != ElementId.InvalidElementId)
            {
                if (!dedicated)
                {
                    why = "ерөнхий харагдацад link-ийн элементийн tag шилжихгүй";
                    return null;
                }
                Reference lr = MapLinkedReference(c, r, out key);
                if (lr == null)
                    why = "link (холбоос) файлын элементийн ихэр олдсонгүй";
                return lr;
            }
            Element e = doc.GetElement(r.ElementId);
            if (e == null)
            {
                why = "tag-ийн элемент устсан байна";
                return null;
            }
            ElementId m = MapElement(c, e.Id, dest, dedicated, true);
            if (m == null)
            {
                why = "tag-ийн элемент (ферм, багана г.м.) зорилтын зурагт тухайн байрлалд байхгүй";
                return null;
            }
            if (!c.Sees(dest, m))
            {
                why = "tag-ийн элемент харагдацад харагдахгүй (нуусан ангилал, тайрах хүрээ, харах муж)";
                return null;
            }
            Element me = doc.GetElement(m);
            key = m.Value.ToString();
            if (me.Id == e.Id)
                return r; // ижил элемент (үргэлжилсэн хавтан г.м.) — анхны лавлагаа хэвээр
            if (r.ElementReferenceType == ElementReferenceType.REFERENCE_TYPE_NONE)
                return new Reference(me);
            // Материалын tag г.м. — нүүр рүү заасан: зорилтын ижил нүүр, олдохгүй бол элемент рүү.
            return MapFaceRef(c, e, r, me, dest) ?? new Reference(me);
        }

        /// <summary>
        /// Link файлын элементийн ихэр — ИЖИЛ link-ийн дотроос: буулгасан байрлалд ойр, ижил ангиллын
        /// (ижил төрөл давуу) элемент.  Нэг л үргэлжилсэн элемент бол өөрөө.
        /// </summary>
        private static Reference MapLinkedReference(CdContext c, Reference r, out string key)
        {
            key = null;
            try
            {
                var li = c.Doc.GetElement(r.ElementId) as RevitLinkInstance;
                Document ld = li?.GetLinkDocument();
                Element le = ld?.GetElement(r.LinkedElementId);
                if (le?.Category == null)
                    return null;
                Transform lt = li.GetTotalTransform();
                XYZ a = AnchorOf(le);
                if (a == null)
                    return null;
                XYZ want = lt.Inverse.OfPoint(c.Map.Point(lt.OfPoint(a)));
                var r3 = new XYZ(RelaxedTol, RelaxedTol, RelaxedTol);
                Element best = null;
                double bestD = RelaxedTol;
                foreach (Element k in new FilteredElementCollector(ld).OfCategoryId(le.Category.Id).WhereElementIsNotElementType()
                             .WherePasses(new BoundingBoxIntersectsFilter(new Outline(want - r3, want + r3))))
                {
                    double d = NearestDistance(k, want) + (k.GetTypeId() == le.GetTypeId() ? 0 : 0.05);
                    if (d < bestD)
                    {
                        bestD = d;
                        best = k;
                    }
                }
                if (best == null)
                    return null;
                key = "L" + li.Id.Value + ":" + best.Id.Value;
                if (best.Id == le.Id)
                    return r;
                return new Reference(best).CreateLinkReference(li);
            }
            catch
            {
                return null;
            }
        }

        private static XYZ AnchorOf(Element e)
        {
            try
            {
                if (e.Location is LocationCurve lc && lc.Curve != null && lc.Curve.IsBound)
                    return lc.Curve.Evaluate(0.5, true);
                if (e.Location is LocationPoint lp)
                    return lp.Point;
            }
            catch { }
            return Center(e);
        }

        /// <summary>Материалын tag: ижил төрөл, ижил элемент дээр, толгой нь ойрхон (≤10 см) tag байна уу.</summary>
        private static bool HasTagNear(CdContext c, View dest, ElementId typeId, ElementId elementId, XYZ head)
        {
            foreach (IndependentTag x in new FilteredElementCollector(c.Doc).OwnedByView(dest.Id).OfClass(typeof(IndependentTag)).Cast<IndependentTag>())
            {
                try
                {
                    if (x.GetTypeId() != typeId || !x.GetTaggedReferences().Any(r => r.ElementId == elementId))
                        continue;
                    XYZ d = x.TagHeadPosition - head;
                    d -= dest.ViewDirection * d.DotProduct(dest.ViewDirection);
                    if (d.GetLength() < 0.3)
                        return true;
                }
                catch { }
            }
            return false;
        }

        /// <summary>
        /// Планд 90°-аар эргэсэн зорилт дээр хэвтээ tag босоо болно (дам нурууны tag
        /// нуруугаа дагана).  Зүсэлт, фасадад харагдац өөрөө эргэдэг тул хэвээр.
        /// </summary>
        private static TagOrientation AdaptOrientation(CdContext c, TagOrientation ori, View dest)
        {
            if (!(dest is ViewPlan))
                return ori;
            if (Math.Abs(Math.Sin(c.Map.PlanAngle)) < 0.7)
                return ori;
            if (ori == TagOrientation.Horizontal) return TagOrientation.Vertical;
            if (ori == TagOrientation.Vertical) return TagOrientation.Horizontal;
            return ori;
        }

        /// <summary>Leader бүрийг (олон элементийн tag-т элемент бүрийнх) — төгсгөлийн нөхцөл, чөлөөт төгсгөл, тохой.</summary>
        private static void CopyLeaders(CdContext c, IndependentTag src, IList<Reference> srcRefs, IndependentTag dst, View dest)
        {
            try { dst.LeaderEndCondition = src.LeaderEndCondition; } catch { }
            IList<Reference> drefs;
            try { drefs = dst.GetTaggedReferences(); }
            catch { return; }
            for (int i = 0; i < srcRefs.Count && i < drefs.Count; i++)
            {
                try
                {
                    if (src.LeaderEndCondition == LeaderEndCondition.Free)
                        dst.SetLeaderEnd(drefs[i], InView(dest, c.Map.Point(src.GetLeaderEnd(srcRefs[i]))));
                    if (src.HasLeaderElbow(srcRefs[i]))
                        dst.SetLeaderElbow(drefs[i], InView(dest, c.Map.Point(src.GetLeaderElbow(srcRefs[i]))));
                }
                catch
                {
                    // Зөвхөн хэлбэр — tag өөрөө зөв элемент дээр үүссэн.
                }
            }
        }

        // ── Өрөөний tag ────────────────────────────────────────────────────

        /// <summary>
        /// Загварт зориулсан харагдац (callout) дахь өрөөний tag — зорилтын талд буулгасан цэгийг
        /// АГУУЛДАГ өрөөг олж tag-лана (өрөөний дугаар, нэр нь тэр өрөөнийх).
        /// </summary>
        private static void CloneRoomTags(CdContext c, List<Autodesk.Revit.DB.Architecture.RoomTag> tags, View src, View dest)
        {
            if (tags.Count == 0)
                return;
            Document doc = c.Doc;
            // Өрөө (ажиллуулалтад нэг) ба харагдацын өрөөний tag (зорилтод нэг) — tag бүрд дахин цуглуулахгүй.
            List<Autodesk.Revit.DB.Architecture.Room> rooms = c.Plan.Rooms;
            HashSet<string> tagged = c.RoomTagKeys(dest);

            HashSet<string> allow = c.Plan.Options.AnnotationKinds;
            foreach (var rt in tags)
            {
                var room = rt.Room;
                if (room == null || rt.IsTaggingLink)
                    continue;
                if (allow != null && !allow.Contains("Өрөө"))
                {
                    c.Rep.KindFiltered++;
                    continue;
                }
                XYZ loc = (rt.Location as LocationPoint)?.Point ?? rt.TagHeadPosition;
                XYZ want = c.Map.Point(loc);
                Level lvl = room.Level == null ? null : MapLevel(c, room.Level) ?? room.Level;
                Autodesk.Revit.DB.Architecture.Room target = rooms.FirstOrDefault(r =>
                    (lvl == null || r.LevelId == lvl.Id)
                    && r.IsPointInRoom(new XYZ(want.X, want.Y, (r.Level?.ProjectElevation ?? want.Z) + 1.0)));
                if (target == null)
                {
                    c.Rep.TagsSkipped++;
                    c.Rep.NoteFor("«" + src.Name + "»: өрөөний tag-ийн өрөө зорилтын талд олдсонгүй", c.TgtLabel);
                    continue;
                }
                string key = rt.GetTypeId().Value + "|" + target.Id.Value;
                if (tagged.Contains(key))
                {
                    c.Rep.TagsExisting++;
                    continue;
                }
                using (var st = new SubTransaction(doc))
                {
                    st.Start();
                    try
                    {
                        var nt = doc.Create.NewRoomTag(new LinkElementId(target.Id), new UV(want.X, want.Y), dest.Id);
                        if (nt.GetTypeId() != rt.GetTypeId())
                            nt.ChangeTypeId(rt.GetTypeId());
                        if (rt.HasLeader)
                        {
                            nt.HasLeader = true;
                            nt.TagHeadPosition = InView(dest, c.Map.Point(rt.TagHeadPosition));
                        }
                        st.Commit();
                        tagged.Add(key);
                        c.Rep.Tags++;
                        c.Rep.RoomTags++;
                    }
                    catch (Exception ex)
                    {
                        if (st.HasStarted() && !st.HasEnded())
                            st.RollBack();
                        c.Rep.TagsSkipped++;
                        c.Rep.NoteFor("«" + src.Name + "»: өрөөний tag үүсгэж чадсангүй (" + ex.Message.Trim().TrimEnd('.') + ")", c.TgtLabel);
                    }
                }
            }
        }

        // ── Арматурын MRA (Multi-Rebar Annotation) ─────────────────────────

        /// <summary>
        /// Арматурын олон-лавлагаат тэмдэглэгээ (MRA) — загварын арматурыг зорилтын тулгасан
        /// арматураар («үүрэг») сольж ижил төрөл, ижил байрлалд үүсгэнэ.
        /// </summary>
        private static void CloneMras(CdContext c, List<MultiReferenceAnnotation> mras, View src, View dest, bool dedicated)
        {
            Document doc = c.Doc;
            foreach (MultiReferenceAnnotation m in mras)
            {
                try
                {
                    if (!(doc.GetElement(m.DimensionId) is Dimension d) || !(d.Curve is Line line))
                        continue;
                    List<ElementId> ids = d.References.Cast<Reference>().Select(r => r.ElementId).Distinct().ToList();
                    if (!dedicated && !ids.Any(c.Plan.Info.Related.Contains))
                        continue;
                    var mapped = new List<ElementId>();
                    foreach (ElementId id in ids)
                    {
                        if (c.ElementMap.TryGetValue(id, out ElementId to))
                            mapped.Add(to);
                    }
                    if (mapped.Count == 0 || mapped.Count != ids.Count)
                    {
                        c.Rep.TagsSkipped++;
                        c.Rep.NoteFor("«" + src.Name + "»: арматурын MRA — зорилтод тохирох арматур олдсонгүй", c.TgtLabel);
                        continue;
                    }
                    if (HasMra(doc, dest, m.GetTypeId(), mapped))
                    {
                        c.Rep.TagsExisting++;
                        continue;
                    }
                    using (var st = new SubTransaction(doc))
                    {
                        st.Start();
                        try
                        {
                            var type = doc.GetElement(m.GetTypeId()) as MultiReferenceAnnotationType;
                            var opt = new MultiReferenceAnnotationOptions(type)
                            {
                                DimensionStyleType = d.DimensionType.StyleType,
                                DimensionLineOrigin = InView(dest, c.Map.Point(line.Origin)),
                                DimensionPlaneNormal = dest.ViewDirection,
                            };
                            XYZ dir = c.Map.Vector(line.Direction);
                            opt.DimensionLineDirection = (dir - dest.ViewDirection * dir.DotProduct(dest.ViewDirection)).Normalize();
                            if (doc.GetElement(m.TagId) is IndependentTag t)
                            {
                                opt.TagHeadPosition = InView(dest, c.Map.Point(t.TagHeadPosition));
                                opt.TagHasLeader = t.HasLeader;
                            }
                            opt.SetElementsToDimension(mapped);
                            MultiReferenceAnnotation.Create(doc, dest.Id, opt);
                            st.Commit();
                            c.Rep.Tags++;
                            c.Rep.Mras++;
                        }
                        catch (Exception ex)
                        {
                            if (st.HasStarted() && !st.HasEnded())
                                st.RollBack();
                            c.Rep.TagsSkipped++;
                            c.Rep.NoteFor("«" + src.Name + "»: арматурын MRA үүсгэж чадсангүй (" + ex.Message.Trim().TrimEnd('.') + ")", c.TgtLabel);
                        }
                    }
                }
                catch { }
            }
        }

        private static bool HasMra(Document doc, View v, ElementId typeId, List<ElementId> rebars)
        {
            foreach (MultiReferenceAnnotation x in new FilteredElementCollector(doc).OwnedByView(v.Id).OfClass(typeof(MultiReferenceAnnotation))
                         .Cast<MultiReferenceAnnotation>())
            {
                try
                {
                    if (x.GetTypeId() != typeId || !(doc.GetElement(x.DimensionId) is Dimension d))
                        continue;
                    var have = new HashSet<ElementId>(d.References.Cast<Reference>().Select(r => r.ElementId));
                    if (rebars.All(have.Contains))
                        return true;
                }
                catch { }
            }
            return false;
        }

        // ── Хэмжээс ────────────────────────────────────────────────────────

        private static void CloneDims(CdContext c, List<Dimension> dims, View src, View dest, bool dedicated)
        {
            var pending = new List<CdPendingDim>();
            foreach (Dimension d in dims)
                StartDim(c, d, src, dest, dedicated, pending);
            FinishDims(c, dest, pending);
        }

        /// <summary>
        /// Хэмжээсийг зорилт дээр ҮҮСГЭНЭ — регенерацигүй.  ХУРД (2026-10-01): хуучин код хэмжээс БҮРИЙН дараа
        /// <c>doc.Regenerate()</c> (файлын шинэчлэл) хийж утгыг уншдаг байв — 20 хэмжээстэй харагдацад 20 удаа.  Одоо
        /// алхмын хэмжээсүүдийг үүсгээд <see cref="FinishDims"/> НЭГ регенерацийн дараа ижил дүрмээр, ижил дарааллаар шалгана.
        /// </summary>
        private static void StartDim(CdContext c, Dimension d, View src, View dest, bool dedicated, List<CdPendingDim> pending)
        {
            Document doc = c.Doc;
            ReferenceArray refs;
            try { refs = d.References; }
            catch { return; }
            if (refs == null || refs.Size < 2)
                return;
            if (!dedicated && !CdAnalysis.RefersTo(d, c.Plan.Info.Related))
                return;
            if (!c.AllowedKinds(refs.Cast<Reference>().Select(r => TaggedElement(doc, r))))
            {
                c.Rep.KindFiltered++;
                return;
            }
            if (d.DimensionShape != DimensionShape.Linear || !(d.Curve is Line line))
            {
                c.Rep.DimsSkipped++;
                c.Rep.Note("Шугаман биш хэмжээс (өнцөг, радиус) хувилагдахгүй.");
                return;
            }

            var mapped = new ReferenceArray();
            bool exact = c.Exact, ok = true;
            foreach (Reference r in refs)
            {
                Reference nr = MapRef(c, r, dest, dedicated, ref exact);
                if (nr == null)
                {
                    ok = false;
                    break;
                }
                mapped.Append(nr);
            }
            if (!ok)
            {
                c.Rep.DimsSkipped++;
                c.Rep.NoteFor("«" + src.Name + "»: хэмжээсийн холбох нүүр/тэнхлэг зорилт дээр олдсонгүй"
                    + (dedicated ? "" : " (ерөнхий харагдацад зөвхөн загвар ба тэнхлэг/түвшинтэй хэмжээс шилждэг)"), c.TgtLabel);
                return;
            }

            List<double> want = SegmentValues(d);
            XYZ dir = c.Map.Vector(line.Direction);
            dir = (dir - dest.ViewDirection * dir.DotProduct(dest.ViewDirection)).Normalize();
            // ⚠️ Харагдацын хэмжээсийн жагсаалтыг ШИНЭ хэмжээсээс ӨМНӨ уншина — эс бөгөөс давхардал шалгалт шинэ
            // хэмжээсийг өөртэй нь «ижил» гэж андуурч устгана (хуучин код ч жагсаалтаа үүсгэхээс өмнө уншдаг байв).
            c.DimsOf(dest);
            using (var st = new SubTransaction(doc))
            {
                st.Start();
                try
                {
                    XYZ o = InView(dest, c.Map.Point(line.Origin));
                    Dimension nd = doc.Create.NewDimension(dest, Line.CreateBound(o, o + dir), mapped, d.DimensionType);
                    st.Commit();
                    pending.Add(new CdPendingDim { Source = d, Created = nd, CreatedId = nd.Id, Want = want, Mapped = mapped, Dir = dir, Exact = exact });
                }
                catch
                {
                    if (st.HasStarted() && !st.HasEnded())
                        st.RollBack();
                    c.Rep.DimsSkipped++;
                }
            }
        }

        /// <summary>
        /// Нэг регенерацийн дараа хүлээгдэж буй хэмжээсүүдийг ҮҮСГЭСЭН ДАРААЛЛААР шалгана — хуучин нэг нэгээр нь
        /// шалгадагтай ИЖИЛ шийдвэр: утгагүй (0) → устгана; ижил элемент, чиглэл, ИЖИЛ УТГАтай хэмжээс аль хэдийн байвал
        /// → устгана (өмнө нь хүлээн авсан, энэ алхамд үүссэн хэмжээс ч тоологдоно; хараахан шалгаагүй нь тоологдохгүй);
        /// хэмжээ нь ижил зорилт дээр утга зөрвөл (буруу нүүр рүү холбогдсон) → устгана; бусад нь текстээ авч үлдэнэ.
        /// Нээлттэй Transaction дотор.
        /// </summary>
        private static void FinishDims(CdContext c, View dest, List<CdPendingDim> pending)
        {
            if (pending == null || pending.Count == 0)
                return;
            Document doc = c.Doc;
            var batch = new List<CdPendingDim>(pending);
            pending.Clear();
            var unchecked_ = new HashSet<ElementId>(batch.Select(x => x.CreatedId));
            doc.Regenerate();
            foreach (CdPendingDim p in batch)
            {
                Dimension nd = p.Created;
                try
                {
                    if (nd == null || !nd.IsValidObject)
                    {
                        c.Rep.DimsSkipped++;
                        continue;
                    }
                    // Revit регенерацийн үед хүчингүй лавлагааг ЧИМЭЭГҮЙ хасдаг (хэмжсэн: [30,440,30] → [440], нүүрнүүд алга).
                    // Хумигдсан хэмжээс нь загвартай өөр зүйл хэмждэг тул үлдээхгүй.
                    int refsNow = -1;
                    try { refsNow = nd.References?.Size ?? -1; }
                    catch { }
                    if (refsNow >= 0 && refsNow < p.Mapped.Size)
                    {
                        Drop(doc, nd);
                        c.Rep.DimsSkipped++;
                        c.Rep.NoteFor("«" + dest.Name + "»: хэмжээсийн " + (p.Mapped.Size - refsNow)
                            + " лавлагаа зорилт дээр хүчингүй болсон тул хэмжээсийг алгасав", c.TgtLabel);
                        continue;
                    }
                    List<double> got = SegmentValues(nd);
                    if (got.Count == 0 || got.Any(v => v < 1e-4))
                    {
                        Drop(doc, nd);
                        c.Rep.DimsSkipped++;
                        continue;
                    }
                    // Дахин ажиллуулалт: ижил элементүүд, ижил чиглэл, ИЖИЛ УТГАтай хэмжээс аль хэдийн байвал давхар
                    // үүсгэхгүй.  Утгаар тулгах нь чухал — нэг баганын бүтэн өргөн ба төвөөс ирмэг хүртэлх хэмжээс ижил
                    // элемент, ижил чигтэй (хэмжсэн).
                    if (SameRefDimensions(c, dest, p.Mapped, p.Dir).Any(x => !unchecked_.Contains(x.Id) && SameValues(SegmentValues(x), got)))
                    {
                        Drop(doc, nd);
                        c.Rep.DimsExisting++;
                        continue;
                    }
                    // НАРИЙВЧЛАЛЫН ХААЛГА: зөвхөн загварын нүүрүүдийн хоорондох, хэмжээ нь ижил зорилт дээр утга ЯГ
                    // тэнцүү байх ёстой — зөрвөл буруу нүүр рүү холбогдсон.
                    bool same = SameValues(p.Want, got);
                    if (p.Exact && !same)
                    {
                        Drop(doc, nd);
                        c.Rep.DimsValueMismatch++;
                        c.Rep.DimsSkipped++;
                        continue;
                    }
                    CopyDimensionText(p.Source, nd, c.Map.IsRigid, same);
                    c.DimsOf(dest).Add(nd);
                    unchecked_.Remove(p.CreatedId); // хүлээн авсан → дараагийнхын давхардал шалгалтад тоологдоно
                    c.Rep.Dims++;
                    if (!same)
                        c.Rep.DimsAdapted++;
                }
                catch
                {
                    Drop(doc, nd);
                    c.Rep.DimsSkipped++;
                }
            }
        }

        /// <summary>Шалгалтад тэнцээгүй шинэ хэмжээсийг устгана (хуучин код SubTransaction-ыг буцаадагтай ижил үр дүн).</summary>
        private static void Drop(Document doc, Element e)
        {
            try
            {
                if (e != null && e.IsValidObject)
                    doc.Delete(e.Id);
            }
            catch { }
        }

        /// <summary>
        /// Хэмжээсийн нэг холбоосыг зорилт руу шилжүүлнэ.  Загварын нүүр → зорилтын ижил
        /// нүүр; тэнхлэг → буулгасан байрлал дахь тэнхлэг; түвшин → буулгасан өндөр дэх
        /// түвшин; туслах хавтгай → буулгасан хавтгай; хөрш элемент → ихрийн ижил нүүр.
        /// Загварын өөрийнх биш холбоос бүр <paramref name="exact"/>-ыг унтраана.
        /// </summary>
        private static Reference MapRef(CdContext c, Reference r, View dest, bool dedicated, ref bool exact)
        {
            if (r == null || r.LinkedElementId != ElementId.InvalidElementId)
                return null;
            Document doc = c.Doc;
            Element e = doc.GetElement(r.ElementId);
            if (e == null)
                return null;

            if (c.ElementMap.TryGetValue(e.Id, out ElementId to))
            {
                if (e.Id != c.Tpl.Id)
                    exact = false;
                return MapFaceRef(c, e, r, doc.GetElement(to), dest);
            }
            if (e is Grid g)
            {
                exact = false;
                Grid ng = FindGrid(c, g);
                return ng == null ? null : new Reference(ng);
            }
            if (e is Level l)
            {
                exact = false;
                Level nl = MapLevel(c, l);
                return nl == null ? null : nl.Id == l.Id ? r : new Reference(nl);
            }
            if (e is ReferencePlane rp)
            {
                exact = false;
                ReferencePlane nrp = FindRefPlane(c, rp);
                return nrp?.GetReference();
            }
            if (!dedicated)
                return null;
            ElementId n = MapElement(c, e.Id, dest, true);
            if (n == null)
                return null;
            exact = false;
            return MapFaceRef(c, e, r, doc.GetElement(n), dest);
        }

        private static Reference MapFaceRef(CdContext c, Element src, Reference r, Element dst, View dest)
        {
            if (dst == null)
                return null;
            if (src.Id == dst.Id)
                return r;
            Document doc = c.Doc;
            bool sameFamily = src is FamilyInstance fa && dst is FamilyInstance fb
                              && fa.Symbol?.Family?.Id == fb.Symbol?.Family?.Id;
            // 1. Ижил family: лавлагааны хавтгай/нүүрний дотоод утга ижил — stable
            //    representation-ийн UniqueId-г солиход л хангалттай (Center (Left/Right) г.м.).
            //    ⚠️ ХЭМЖСЭН (2026-10-05, «ДН-1-1 S 1»): олон алгасалтай (span) дам нурууны нүүрийн дугаар (…:143:SURFACE) нь
            //    instance бүрийн огтлолтоос (баганатай нийлэх) хамаардаг — зорилтод тэр дугаартай нүүр БАЙХГҮЙ байж болно.
            //    Parse нь алдаа өгөхгүй, хүчингүй лавлагааг Revit хэмжээсээс ЧИМЭЭГҮЙ хасаж [30,440,30] → [440] болгосон.
            //    Тиймээс солисон лавлагааг шалгана (CheckSwap): хүчингүй бол хэзээ ч ашиглахгүй; огтлолын хавтгайг дайраагүй
            //    алгасалынх бол геометрийн замыг (огтлолд орсон нүүр давуу) эхэлж оролдоно.
            Reference sw = null;
            SwapCheck chk = SwapCheck.Ok;
            if (sameFamily)
            {
                sw = SwapStable(doc, r, src, dst);
                if (sw != null)
                {
                    chk = CheckSwap(c, src, r, dst, sw, dest);
                    if (chk == SwapCheck.Ok)
                        return sw;
                }
            }
            // 2. Геометрээр — нүүрний хавтгайг буулгаж зорилтын ижил чигтэй нүүрийг олно.
            Reference byGeo = FaceByGeometry(c, src, r, dst, dest);
            if (byGeo != null)
                return byGeo;
            if (sw != null && chk == SwapCheck.OffCut)
                return sw; // хүчинтэй нүүр, зөвхөн огтлолын хавтгайгаас гадуурх алгасалынх — геометр ч олоогүй
            // 3. Системийн family (хана, хавтан) — ижил анги бол солих оролдлого.
            if (!sameFamily && src.GetType() == dst.GetType())
                return SwapStable(doc, r, src, dst);
            return null;
        }

        private enum SwapCheck { Ok, Dangling, OffCut }

        /// <summary>
        /// UniqueId солисон лавлагааг шалгана.  Эх лавлагаа нь загварын ХАВТГАЙ НҮҮР биш (лавлагааны хавтгай, тусгай лавлагаа —
        /// хуучин шигээ итгэнэ) → Ok.  Эх нь хавтгай нүүр атлаа зорилтод ижил stable-тэй хавтгай нүүр алга → Dangling (ашиглахгүй).
        /// Огтлолын харагдацад, огтлолын хавтгайд перпендикуляр (ирмэгээрээ харагддаг) нүүр хавтгайг дайраагүй → OffCut.
        /// </summary>
        private static SwapCheck CheckSwap(CdContext c, Element src, Reference r, Element dst, Reference sw, View dest)
        {
            Document doc = c.Doc;
            string ss, ds;
            try
            {
                ss = r.ConvertToStableRepresentation(doc);
                ds = sw.ConvertToStableRepresentation(doc);
            }
            catch
            {
                return SwapCheck.Ok;
            }
            if (FacesCached(c, src, true).FindIndex(f => f.Stable == ss) < 0)
                return SwapCheck.Ok;
            List<FaceInfo> df = FacesCached(c, dst, true);
            int i = df.FindIndex(f => f.Stable == ds);
            if (i < 0)
                return SwapCheck.Dangling;
            if (IsCutView(dest) && EdgeOn(df[i].N, dest) && !CrossesCut(df[i], dest))
                return SwapCheck.OffCut;
            return SwapCheck.Ok;
        }

        /// <summary>Огтлолын хавтгайтай (Origin-оор, ViewDirection нормалтай) харагдац — огтлол/дэлгэрэнгүй.  Төлөвлөгөө, фасад биш.</summary>
        private static bool IsCutView(View v)
        {
            return v is ViewSection && (v.ViewType == ViewType.Section || v.ViewType == ViewType.Detail);
        }

        /// <summary>Нүүр харагдацын чигт перпендикуляр — огтлол дээр ирмэгээрээ (шугам болж) харагддаг, хэмжээс тавигддаг нүүр.</summary>
        private static bool EdgeOn(XYZ n, View v)
        {
            return Math.Abs(n.DotProduct(v.ViewDirection)) < 1e-3;
        }

        /// <summary>Нүүрийн ирмэгийн цэгүүд огтлолын хавтгайн хоёр талд (эсвэл дээр нь) байна уу.</summary>
        private static bool CrossesCut(FaceInfo f, View v)
        {
            if (f.Pts == null || f.Pts.Count == 0)
                return true; // мэдэхгүй — хасахгүй
            XYZ n = v.ViewDirection, o = v.Origin;
            double min = double.MaxValue, max = double.MinValue;
            foreach (XYZ p in f.Pts)
            {
                double d = (p - o).DotProduct(n);
                if (d < min) min = d;
                if (d > max) max = d;
            }
            return min <= 1e-3 && max >= -1e-3;
        }

        private static Reference SwapStable(Document doc, Reference r, Element src, Element dst)
        {
            try
            {
                string s = r.ConvertToStableRepresentation(doc);
                int at = s.IndexOf(src.UniqueId, StringComparison.Ordinal);
                if (at < 0)
                    return null;
                s = s.Substring(0, at) + dst.UniqueId + s.Substring(at + src.UniqueId.Length);
                return Reference.ParseFromStableRepresentation(doc, s);
            }
            catch
            {
                return null;
            }
        }

        internal struct FaceInfo
        {
            public Reference Ref;
            public XYZ N;
            public XYZ O;
            public double Area;
            public string Stable;

            /// <summary>Ирмэгийн гогцоонуудын цэгүүд (ертөнцийн координат) — огтлолын хавтгайг дайрсан эсэхийг шалгахад.</summary>
            public List<XYZ> Pts;
        }

        private static List<FaceInfo> FacesCached(CdContext c, Element e, bool withStable)
        {
            string key = e.Id.Value + (withStable ? "|s" : "");
            if (!c.Faces.TryGetValue(key, out object o))
                c.Faces[key] = o = Faces(c.Doc, e, withStable);
            return (List<FaceInfo>)o;
        }

        private static List<FaceInfo> Faces(Document doc, Element e, bool withStable)
        {
            var list = new List<FaceInfo>();
            try
            {
                GeometryElement ge = e.get_Geometry(new Options { ComputeReferences = true, DetailLevel = ViewDetailLevel.Fine });
                if (ge != null)
                    WalkFaces(doc, ge, Transform.Identity, list, withStable);
            }
            catch { }
            return list;
        }

        private static void WalkFaces(Document doc, GeometryElement ge, Transform t, List<FaceInfo> list, bool withStable)
        {
            foreach (GeometryObject go in ge)
            {
                if (go is Solid s && s.Volume > 1e-9)
                {
                    foreach (Face f in s.Faces)
                    {
                        if (!(f is PlanarFace pf) || pf.Reference == null)
                            continue;
                        string stable = null;
                        if (withStable)
                        {
                            try { stable = pf.Reference.ConvertToStableRepresentation(doc); }
                            catch { }
                        }
                        list.Add(new FaceInfo
                        {
                            Ref = pf.Reference,
                            N = t.OfVector(pf.FaceNormal).Normalize(),
                            O = t.OfPoint(pf.Origin),
                            Area = pf.Area,
                            Stable = stable,
                            Pts = LoopPoints(pf, t),
                        });
                    }
                }
                else if (go is GeometryInstance gi)
                {
                    GeometryElement sym = gi.GetSymbolGeometry();
                    if (sym != null)
                        WalkFaces(doc, sym, t.Multiply(gi.Transform), list, withStable);
                }
            }
        }

        private static List<XYZ> LoopPoints(PlanarFace pf, Transform t)
        {
            var pts = new List<XYZ>();
            try
            {
                foreach (EdgeArray loop in pf.EdgeLoops)
                {
                    foreach (Edge e in loop)
                    {
                        foreach (XYZ p in e.Tessellate())
                            pts.Add(t.OfPoint(p));
                    }
                }
            }
            catch { }
            return pts;
        }

        /// <summary>
        /// Нүүрийг геометрээр буулгана.  Эх нүүр тухайн чиглэлдээ ХАМГИЙН ЗАХЫН нүүр бол
        /// (дам нурууны доод тал, баганын нүүр) зорилтын мөн захын нүүрийг авна — хэмжээ
        /// өөр байсан ч зөв.  Үгүй бол буулгасан хавтгайд хамгийн ойр нүүр (≤ 1.5 см).
        /// </summary>
        private static Reference FaceByGeometry(CdContext c, Element src, Reference r, Element dst, View dest)
        {
            Document doc = c.Doc;
            string stable;
            try { stable = r.ConvertToStableRepresentation(doc); }
            catch { return null; }
            List<FaceInfo> sf = FacesCached(c, src, true);
            int idx = sf.FindIndex(f => f.Stable == stable);
            FaceInfo face;
            if (idx >= 0)
            {
                face = sf[idx];
            }
            else
            {
                // Лавлагаа нь геометрийн жагсаалтад нийлээгүй — шууд задлана (ертөнцийн координат).
                if (!(src.GetGeometryObjectFromReference(r) is PlanarFace pf) || src is FamilyInstance)
                    return null;
                face = new FaceInfo { N = pf.FaceNormal, O = pf.Origin, Area = pf.Area };
            }

            XYZ n2 = c.Map.Vector(face.N).Normalize();
            List<FaceInfo> df = FacesCached(c, dst, false).Where(f => f.N.DotProduct(n2) > 0.9999).ToList();
            if (df.Count == 0)
                return null;
            // Олон алгасалтай (span) дам нуруу: доод нүүр алгасал бүрд тусдаа, нэг хавтгайд.  Огтлолын харагдацад огтлолын хавтгайг
            // ДАЙРСАН алгасалын нүүр л тэр зурагт харагддаг — байгаа бол зөвхөн тэднээс сонгоно (байхгүй бол хуучин дүрэм).
            if (IsCutView(dest) && EdgeOn(n2, dest))
            {
                List<FaceInfo> cut = df.Where(f => CrossesCut(f, dest)).ToList();
                if (cut.Count > 0)
                    df = cut;
            }
            double off = face.O.DotProduct(face.N);
            bool extreme = sf.Where(f => f.N.DotProduct(face.N) > 0.9999).All(f => f.O.DotProduct(face.N) <= off + 1e-3);
            if (extreme)
            {
                double max = df.Max(f => f.O.DotProduct(n2));
                return df.Where(f => f.O.DotProduct(n2) >= max - 1e-3)
                    .OrderBy(f => Math.Abs(f.Area - face.Area)).First().Ref;
            }
            double want = c.Map.Point(face.O).DotProduct(n2);
            FaceInfo best = df.OrderBy(f => Math.Abs(f.O.DotProduct(n2) - want)).ThenBy(f => Math.Abs(f.Area - face.Area)).First();
            return Math.Abs(best.O.DotProduct(n2) - want) <= PlaneTol ? best.Ref : null;
        }

        /// <summary>
        /// Загварын тэнхлэгийг зорилтод «ижил харьцаатай» тэнхлэгээр солино: загварын төвөөс
        /// тэнхлэг рүү татсан цэгийг буулгаж, тэр цэгийг дайрсан параллель тэнхлэгийг олно
        /// (A-1 дээрх баганын A тэнхлэг → B-3 дээрх баганын B тэнхлэг).
        /// </summary>
        private static Grid FindGrid(CdContext c, Grid g)
        {
            if (!(g.Curve is Line gl))
                return null;
            XYZ center = c.Map.A.WorldCenter;
            XYZ o = gl.GetEndPoint(0), d = gl.Direction;
            XYZ anchor = o + d * (center - o).DotProduct(d);
            anchor = new XYZ(anchor.X, anchor.Y, center.Z);
            XYZ q = c.Map.Point(anchor);
            XYZ dir = c.Map.Vector(d);
            Grid best = null;
            double bestD = DatumTol;
            foreach (Grid k in c.Plan.Grids)
            {
                if (!(k.Curve is Line kl) || Math.Abs(kl.Direction.DotProduct(dir)) < 0.99999)
                    continue;
                XYZ w = new XYZ(q.X, q.Y, kl.GetEndPoint(0).Z) - kl.GetEndPoint(0);
                double dist = (w - kl.Direction * w.DotProduct(kl.Direction)).GetLength();
                if (dist < bestD)
                {
                    bestD = dist;
                    best = k;
                }
            }
            return best;
        }

        /// <summary>Загварын өндрийн харьцаагаар зорилтын түвшин (өөр давхрын багана).</summary>
        private static Level MapLevel(CdContext c, Level l)
        {
            XYZ center = c.Map.A.WorldCenter;
            double z = c.Map.Point(new XYZ(center.X, center.Y, l.ProjectElevation)).Z;
            Level best = null;
            double bestD = DatumTol;
            foreach (Level k in c.Plan.Levels)
            {
                double dd = Math.Abs(k.ProjectElevation - z);
                if (dd < bestD)
                {
                    bestD = dd;
                    best = k;
                }
            }
            return best;
        }

        private static ReferencePlane FindRefPlane(CdContext c, ReferencePlane rp)
        {
            try
            {
                XYZ n = c.Map.Vector(rp.Normal).Normalize();
                XYZ o = c.Map.Point(rp.BubbleEnd);
                foreach (ReferencePlane k in c.Plan.RefPlanes)
                {
                    if (Math.Abs(k.Normal.DotProduct(n)) < 0.99999)
                        continue;
                    if (Math.Abs((k.BubbleEnd - o).DotProduct(k.Normal)) < PlaneTol)
                        return k;
                }
            }
            catch { }
            return null;
        }

        private static List<double> SegmentValues(Dimension d)
        {
            var list = new List<double>();
            try
            {
                if (d.NumberOfSegments > 1)
                {
                    foreach (DimensionSegment s in d.Segments)
                        list.Add(s.Value ?? 0);
                }
                else
                {
                    list.Add(d.Value ?? 0);
                }
            }
            catch { }
            return list;
        }

        /// <summary>Сегментийн утгыг дараалалгүй тулгана (толин тусгал дарааллыг урвуулна).</summary>
        private static bool SameValues(List<double> a, List<double> b)
        {
            if (a.Count != b.Count)
                return false;
            List<double> x = a.OrderBy(v => v).ToList(), y = b.OrderBy(v => v).ToList();
            for (int i = 0; i < x.Count; i++)
            {
                if (Math.Abs(x[i] - y[i]) > DimTol)
                    return false;
            }
            return true;
        }

        /// <summary>
        /// Энэ харагдацад ижил элементүүдийг ижил чиглэлд хэмжсэн хэмжээсүүд — давхардлыг утгаар
        /// нь үүсгэсний дараа тулгана.  ⚠️ Stable representation-оор тулгаж болохгүй: Revit
        /// хадгалсан хэмжээсийн лавлагааг өөр хэлбэрээр буцаадаг (хэмжсэн — 25 давхардал).
        /// </summary>
        private static List<Dimension> SameRefDimensions(CdContext c, View v, ReferenceArray refs, XYZ dir)
        {
            var result = new List<Dimension>();
            var want = refs.Cast<Reference>().Select(r => r.ElementId.Value).OrderBy(x => x).ToList();
            foreach (Dimension x in c.DimsOf(v))
            {
                if (x is SpotDimension || !x.IsValidObject)
                    continue;
                try
                {
                    var have = x.References.Cast<Reference>().Select(r => r.ElementId.Value).OrderBy(i => i).ToList();
                    if (!have.SequenceEqual(want))
                        continue;
                    if (x.Curve is Line xl && Math.Abs(xl.Direction.DotProduct(dir)) < 0.999)
                        continue;
                    result.Add(x);
                }
                catch { }
            }
            return result;
        }

        /// <summary>
        /// Угтвар, дагавар, дээд/доод бичвэр.  Утгын дарж бичилтийг (ValueOverride) зөвхөн
        /// утга ижил үед эсвэл тоо агуулаагүй үед («EQ», «ТЭНЦҮҮ») хуулна — эс бөгөөс хуучин
        /// тоо шинэ хэмжээн дээр худал гарна.
        /// </summary>
        private static void CopyDimensionText(Dimension src, Dimension dst, bool sameOrder, bool sameValues)
        {
            bool OverrideOk(string s) => !string.IsNullOrEmpty(s) && (sameValues || !s.Any(char.IsDigit));
            try
            {
                if (src.NumberOfSegments <= 1)
                {
                    dst.Prefix = src.Prefix;
                    dst.Suffix = src.Suffix;
                    dst.Above = src.Above;
                    dst.Below = src.Below;
                    if (OverrideOk(src.ValueOverride))
                        dst.ValueOverride = src.ValueOverride;
                    return;
                }
                if (!sameOrder || src.NumberOfSegments != dst.NumberOfSegments)
                    return;
                for (int i = 0; i < src.NumberOfSegments; i++)
                {
                    DimensionSegment a = src.Segments.get_Item(i), b = dst.Segments.get_Item(i);
                    b.Prefix = a.Prefix;
                    b.Suffix = a.Suffix;
                    b.Above = a.Above;
                    b.Below = a.Below;
                    if (OverrideOk(a.ValueOverride))
                        b.ValueOverride = a.ValueOverride;
                }
            }
            catch { }
        }

        // ── Түвшний тэмдэг (spot elevation) ───────────────────────────────

        private static void CloneSpots(CdContext c, List<SpotDimension> spots, View dest, bool dedicated)
        {
            Document doc = c.Doc;
            foreach (SpotDimension s in spots)
            {
                ReferenceArray refs;
                try { refs = s.References; }
                catch { continue; }
                if (refs == null || refs.Size != 1)
                    continue;
                if (!dedicated && !CdAnalysis.RefersTo(s, c.Plan.Info.Related))
                    continue;
                if (!c.AllowedKinds(refs.Cast<Reference>().Select(r => TaggedElement(doc, r))))
                {
                    c.Rep.KindFiltered++;
                    continue;
                }
                bool exact = true;
                Reference nr = MapRef(c, refs.get_Item(0), dest, dedicated, ref exact);
                if (nr == null)
                {
                    c.Rep.SpotsSkipped++;
                    continue;
                }
                if (HasSpot(doc, dest, s.GetTypeId(), nr.ElementId))
                {
                    c.Rep.SpotsExisting++;
                    continue;
                }
                using (var st = new SubTransaction(doc))
                {
                    st.Start();
                    try
                    {
                        XYZ origin = InView(dest, c.Map.Point(s.Origin));
                        bool leader = s.HasLeader;
                        XYZ end = origin, bend = origin;
                        if (leader)
                        {
                            end = InView(dest, c.Map.Point(s.LeaderEndPosition));
                            bend = s.LeaderHasShoulder ? InView(dest, c.Map.Point(s.LeaderShoulderPosition)) : end;
                        }
                        SpotDimension ns = doc.Create.NewSpotElevation(dest, nr, origin, bend, end, origin, leader);
                        if (ns.GetTypeId() != s.GetTypeId())
                            ns.ChangeTypeId(s.GetTypeId());
                        st.Commit();
                        c.Rep.Spots++;
                    }
                    catch
                    {
                        if (st.HasStarted() && !st.HasEnded())
                            st.RollBack();
                        c.Rep.SpotsSkipped++;
                    }
                }
            }
        }

        /// <summary>Тухайн элемент дээр ижил төрлийн түвшний тэмдэг аль хэдийн байна уу (дахин ажиллуулахад давхардахгүй).</summary>
        private static bool HasSpot(Document doc, View v, ElementId typeId, ElementId elementId)
        {
            foreach (SpotDimension x in new FilteredElementCollector(doc).OwnedByView(v.Id).OfClass(typeof(SpotDimension)).Cast<SpotDimension>())
            {
                try
                {
                    if (x.GetTypeId() != typeId)
                        continue;
                    foreach (Reference r in x.References)
                    {
                        if (r.ElementId == elementId)
                            return true;
                    }
                }
                catch { }
            }
            return false;
        }

        // ── 2D (текст, зураас, штрих, detail component) ───────────────────

        /// <summary>
        /// Загварт зориулсан харагдацын өөрийн 2D элементүүд.  ⚠️ Зураасыг зөвхөн OST_Lines
        /// ангилалтай бол авна — штрихийн хүрээний «sketch line» ч харагдацын CurveElement
        /// бөгөөд тусад нь хуулбал эвдэрсэн хүрээ үлдэнэ.  Detail group-ын гишүүнийг алгасна.
        /// </summary>
        public static List<Element> DetailElements(Document doc, View v)
        {
            var list = new List<Element>();
            try
            {
                foreach (Element e in new FilteredElementCollector(doc).OwnedByView(v.Id).WhereElementIsNotElementType()
                             .WherePasses(new ElementMulticlassFilter(new List<Type>
                                 { typeof(TextNote), typeof(CurveElement), typeof(FilledRegion), typeof(FamilyInstance) })))
                {
                    if (e.GroupId != null && e.GroupId != ElementId.InvalidElementId)
                        continue;
                    long cat = e.Category?.Id.Value ?? 0;
                    bool ok = e is TextNote || e is FilledRegion
                              || (e is CurveElement && cat == (long)BuiltInCategory.OST_Lines)
                              || (e is FamilyInstance && (cat == (long)BuiltInCategory.OST_DetailComponents
                                                          || cat == (long)BuiltInCategory.OST_GenericAnnotation));
                    if (ok)
                        list.Add(e);
                }
            }
            catch { }
            return list;
        }

        private static void CloneDetails(CdContext c, View src, List<Element> details, View dest)
        {
            Document doc = c.Doc;
            // Өмнө хувилсан харагдац ЭСВЭЛ тэмдэглэгээ нь дахин эхэлсэн шинэ харагдац — байгааг дахин хуулахгүй.
            bool reused = c.ReusedViews.Contains(dest.Id) || c.DetailCheck.Contains(dest.Id);
            foreach (Element e in details)
            {
                if (reused && DetailExists(c, e, src, dest))
                    continue;
                bool done = false;
                using (var st = new SubTransaction(doc))
                {
                    st.Start();
                    try
                    {
                        if (e is DetailCurve dc && dc.GeometryCurve is Line ln)
                        {
                            XYZ a = InView(dest, c.Map.Point(ln.GetEndPoint(0)));
                            XYZ b = InView(dest, c.Map.Point(ln.GetEndPoint(1)));
                            if (a.DistanceTo(b) > 1e-3)
                            {
                                DetailCurve nc = doc.Create.NewDetailCurve(dest, Line.CreateBound(a, b));
                                try { nc.LineStyle = dc.LineStyle; } catch { }
                                done = true;
                            }
                        }
                        else if (e is FilledRegion fr)
                        {
                            var loops = new List<CurveLoop>();
                            foreach (CurveLoop loop in fr.GetBoundaries())
                            {
                                CurveLoop m = MapLoop(c, loop, dest, null);
                                if (m == null) { loops = null; break; }
                                loops.Add(m);
                            }
                            if (loops != null && loops.Count > 0)
                            {
                                FilledRegion.Create(doc, fr.GetTypeId(), dest.Id, loops);
                                done = true;
                            }
                        }
                        if (done)
                        {
                            st.Commit();
                            c.Rep.Details++;
                            continue;
                        }
                        st.RollBack();
                    }
                    catch
                    {
                        if (st.HasStarted() && !st.HasEnded())
                            st.RollBack();
                    }
                }
                // Бусад (текст, нуман зураас, detail component) — хуулаад буулгасан байрлал руу зөөнө.
                if (CopyPlace(c, e, src, dest))
                    c.Rep.Details++;
                else
                    c.Rep.DetailsSkipped++;
            }
        }

        /// <summary>
        /// Харагдац хооронд хуулаад төвийг нь буулгасан цэг рүү зөөнө.  ⚠️ CopyElements-д
        /// Transform.Identity — Revit элементийг эх харагдацтайгаа ИЖИЛ харьцангуй байрлалд
        /// тавьдаг тул хувиргалт өгвөл давхар шилжинэ («Хуулж тавих»-д хэмжсэн).
        /// </summary>
        private static bool CopyPlace(CdContext c, Element e, View src, View dest)
        {
            Document doc = c.Doc;
            using (var st = new SubTransaction(doc))
            {
                st.Start();
                try
                {
                    BoundingBoxXYZ b = e.get_BoundingBox(src);
                    if (b == null)
                    {
                        st.RollBack();
                        return false;
                    }
                    XYZ want = InView(dest, c.Map.Point((b.Min + b.Max) / 2));
                    ICollection<ElementId> n = ElementTransformUtils.CopyElements(src, new List<ElementId> { e.Id }, dest,
                        Transform.Identity, new CopyPasteOptions());
                    if (n.Count == 0)
                    {
                        st.RollBack();
                        return false;
                    }
                    Element ne = doc.GetElement(n.First());
                    doc.Regenerate();
                    BoundingBoxXYZ nb = ne.get_BoundingBox(dest);
                    if (nb != null)
                    {
                        XYZ delta = want - (nb.Min + nb.Max) / 2;
                        delta -= dest.ViewDirection * delta.DotProduct(dest.ViewDirection);
                        if (delta.GetLength() > 1e-6)
                            ElementTransformUtils.MoveElement(doc, ne.Id, delta);
                    }
                    if (ne is TextNote tn)
                        ReplaceMarkInText(c, tn);
                    if (ne.Location is LocationCurve lc && e.Location is LocationCurve olc && olc.Curve is Line ol)
                    {
                        XYZ a = InView(dest, c.Map.Point(ol.GetEndPoint(0)));
                        XYZ bb = InView(dest, c.Map.Point(ol.GetEndPoint(1)));
                        if (a.DistanceTo(bb) > 1e-3)
                        {
                            try { lc.Curve = Line.CreateBound(a, bb); } catch { }
                        }
                    }
                    st.Commit();
                    return true;
                }
                catch
                {
                    if (st.HasStarted() && !st.HasEnded())
                        st.RollBack();
                    return false;
                }
            }
        }

        private static void ReplaceMarkInText(CdContext c, TextNote tn)
        {
            if (!c.Plan.Options.ReplaceMark || !CloneNaming.IsReplaceableMark(c.TplMark) || string.IsNullOrEmpty(c.TgtMark)
                || c.TplMark == c.TgtMark)
                return;
            try
            {
                FormattedText ft = tn.GetFormattedText();
                bool any = false;
                int start = 0;
                for (int guard = 0; guard < 50; guard++)
                {
                    TextRange r = ft.Find(c.TplMark, start, true, true);
                    if (r == null || r.Length == 0)
                        break;
                    ft.SetPlainText(r, c.TgtMark);
                    start = r.Start + c.TgtMark.Length;
                    any = true;
                }
                if (any)
                    tn.SetFormattedText(ft);
            }
            catch { }
        }

        private static bool DetailExists(CdContext c, Element e, View src, View dest)
        {
            BoundingBoxXYZ b = e.get_BoundingBox(src);
            if (b == null)
                return false;
            XYZ want = InView(dest, c.Map.Point((b.Min + b.Max) / 2));
            Type cls = e is TextNote ? typeof(TextNote) : e is FilledRegion ? typeof(FilledRegion)
                : e is CurveElement ? typeof(CurveElement) : typeof(FamilyInstance);
            foreach (Element x in new FilteredElementCollector(c.Doc).OwnedByView(dest.Id).OfClass(cls))
            {
                if (x.GetTypeId() != e.GetTypeId())
                    continue;
                BoundingBoxXYZ xb = x.get_BoundingBox(dest);
                if (xb == null)
                    continue;
                // Харагдацын ХАВТГАЙ дээр л харьцуулна — текстийн хүрээ гүний тэнхлэгт өөр утгатай (хэмжсэн).
                XYZ dlt = (xb.Min + xb.Max) / 2 - want;
                dlt -= dest.ViewDirection * dlt.DotProduct(dest.ViewDirection);
                if (dlt.GetLength() < 0.05)
                    return true;
            }
            return false;
        }

        /// <summary>Хүрээг буулгана (шулуун, нуман).  Хавтгайд буулгасны дараа хаагдахгүй бол null.</summary>
        private static CurveLoop MapLoop(CdContext c, CurveLoop loop, View dest, double? planZ)
        {
            try
            {
                XYZ P(XYZ p)
                {
                    XYZ q = planZ.HasValue ? new XYZ(p.X, p.Y, planZ.Value) : p;
                    XYZ m = c.Map.Point(q);
                    return planZ.HasValue ? new XYZ(m.X, m.Y, p.Z) : InView(dest, m);
                }
                var result = new CurveLoop();
                foreach (Curve cv in loop)
                {
                    if (cv is Line ln)
                        result.Append(Line.CreateBound(P(ln.GetEndPoint(0)), P(ln.GetEndPoint(1))));
                    else if (cv is Arc arc && arc.IsBound)
                        result.Append(Arc.Create(P(arc.GetEndPoint(0)), P(arc.GetEndPoint(1)), P(arc.Evaluate(0.5, true))));
                    else
                        return null;
                }
                return result;
            }
            catch
            {
                return null;
            }
        }

        // ══ Хуудас ══════════════════════════════════════════════════════════

        /// <summary>
        /// Клон харагдацын эх харагдац хуудсан дээр байсан бол: зорилт бүрд ижил гарчгийн
        /// хүрээтэй шинэ хуудас (өмнө үүссэн бол түүнийг) — харагдац бүр ИЖИЛ байрлалд,
        /// legend, хүснэгт, хуудасны 2D-тэй.
        /// </summary>
        internal static List<ElementId> SheetGroups(CdContext c)
        {
            var seen = new HashSet<ElementId>();
            var list = new List<ElementId>();
            foreach (Viewport vp in c.Plan.Viewports)
            {
                if (vp != null && vp.IsValidObject && c.Dest.ContainsKey(vp.ViewId) && seen.Add(vp.SheetId))
                    list.Add(vp.SheetId);
            }
            return list;
        }

        /// <summary>
        /// Алхам 4: нэг эх хуудасны клон (зорилтод).  2026-10-01-ээс хуудас тус бүр тусдаа алхам — шинэ viewport-уудыг
        /// <see cref="CdPlan.Viewports"/>-д нэмнэ (хуучин код зорилт бүрийн төгсгөлд БҮХ viewport-ыг дахин цуглуулдаг байв).
        /// Нээлттэй Transaction дотор.
        /// </summary>
        internal static void CloneSheet(CdContext c, ElementId sheetId)
        {
            Document doc = c.Doc;
            var placedViews = new HashSet<ElementId>(c.Plan.Viewports.Where(vp => vp != null && vp.IsValidObject).Select(vp => vp.ViewId));
            var g = c.Plan.Viewports.Where(vp => vp != null && vp.IsValidObject && vp.SheetId == sheetId && c.Dest.ContainsKey(vp.ViewId)).ToList();
            if (g.Count == 0)
                return;
            if (!(doc.GetElement(sheetId) is ViewSheet sheet))
                return;
            ViewSheet ns = null;
            bool created = false;
            ElementId ex = c.Plan.Clones.Find(sheet.UniqueId, c.Tgt.UniqueId);
            if (ex != null)
                ns = doc.GetElement(ex) as ViewSheet;

            using (var st = new SubTransaction(doc))
            {
                st.Start();
                try
                {
                    if (ns == null)
                    {
                        ns = CreateSheet(c, sheet);
                        created = true;
                    }
                    int placed = 0;
                    var pairs = new List<KeyValuePair<Viewport, Viewport>>();
                    foreach (Viewport vp in g)
                    {
                        View cv = c.Dest[vp.ViewId];
                        if (placedViews.Contains(cv.Id))
                            continue;
                        if (!Viewport.CanAddViewToSheet(doc, ns.Id, cv.Id))
                        {
                            c.Rep.Note("«" + cv.Name + "»-ийг «" + ns.SheetNumber + "» хуудсанд тавьж чадсангүй.");
                            continue;
                        }
                        XYZ center = c.Plan.BoxCenter(vp);
                        Viewport nvp = Viewport.Create(doc, ns.Id, cv.Id, center);
                        CopyViewport(c.Plan, vp, nvp, center);
                        AlignByCrop(c.Plan, vp, nvp, cv);
                        pairs.Add(new KeyValuePair<Viewport, Viewport>(vp, nvp));
                        placedViews.Add(cv.Id);
                        placed++;
                    }
                    if (pairs.Count > 0)
                    {
                        doc.Regenerate();
                        foreach (KeyValuePair<Viewport, Viewport> pr in pairs)
                            PlaceLabel(c.Plan, pr.Key, pr.Value, c.Dest[pr.Key.ViewId]);
                    }
                    if (created)
                        CopySheetExtras(c, sheet, ns);
                    CdLinks.Write(ns, new CdLinks.Record
                    {
                        Kind = CdLinks.KindSheet,
                        TemplateUid = c.Tpl.UniqueId,
                        TargetUid = c.Tgt.UniqueId,
                        SourceUid = sheet.UniqueId,
                    });
                    st.Commit();
                    var known = new HashSet<ElementId>(c.Plan.Viewports.Where(vp => vp != null && vp.IsValidObject).Select(vp => vp.Id));
                    foreach (ElementId vpId in ns.GetAllViewports())
                    {
                        if (!known.Contains(vpId) && doc.GetElement(vpId) is Viewport nvp2)
                            c.Plan.Viewports.Add(nvp2);
                    }
                    c.Rep.Viewports += placed;
                    if (created)
                    {
                        c.Plan.Clones.Add(sheet.UniqueId, c.Tgt.UniqueId, ns.Id);
                        c.Plan.SheetNumbers.Add(ns.SheetNumber);
                        c.Rep.Once(ViewKey(c, ns.Id));
                        c.Rep.SheetsCreated++;
                        c.Rep.NewSheets.Add(ns.SheetNumber + " — " + ns.Name);
                        if (c.Rep.FirstSheetId == null)
                            c.Rep.FirstSheetId = ns.Id;
                    }
                    else if (c.Rep.Once(ViewKey(c, ns.Id)))
                    {
                        c.Rep.SheetsReused++;
                    }
                }
                catch (Exception e)
                {
                    if (st.HasStarted() && !st.HasEnded())
                        st.RollBack();
                    c.Rep.Note("«" + sheet.SheetNumber + "» хуудсыг " + c.TgtLabel + "-д үүсгэж чадсангүй: " + e.Message);
                }
            }
        }

        private static ViewSheet CreateSheet(CdContext c, ViewSheet sheet)
        {
            Document doc = c.Doc;
            // OwnedByView — харагдах байдлыг тооцохгүй (хуудасны коллектор ~0.1 с).
            var tb = new FilteredElementCollector(doc).OwnedByView(sheet.Id).OfCategory(BuiltInCategory.OST_TitleBlocks)
                .WhereElementIsNotElementType().FirstElement() as FamilyInstance;
            ViewSheet ns = ViewSheet.Create(doc, tb?.GetTypeId() ?? ElementId.InvalidElementId);
            CopySheetParameters(c, sheet, ns);
            bool replace = c.Plan.Options.ReplaceMark;
            string number = replace
                ? CloneNaming.SheetNumber(sheet.SheetNumber, c.TplMark, c.TgtMark, c.TgtLabel)
                : sheet.SheetNumber + "-" + CloneNaming.Compact(c.TgtLabel);
            ns.SheetNumber = CloneNaming.MakeUnique(number, n => c.Plan.SheetNumbers.Contains(n), ".");
            ns.Name = replace
                ? CloneNaming.SheetName(sheet.Name, c.TplMark, c.TgtMark, c.TgtLabel)
                : sheet.Name + " (" + c.TgtLabel + ")";

            if (tb != null)
            {
                var ntb = new FilteredElementCollector(doc).OwnedByView(ns.Id).OfCategory(BuiltInCategory.OST_TitleBlocks)
                    .WhereElementIsNotElementType().FirstElement() as FamilyInstance;
                if (ntb != null)
                {
                    try
                    {
                        if (tb.Location is LocationPoint a && ntb.Location is LocationPoint b && !a.Point.IsAlmostEqualTo(b.Point))
                            ElementTransformUtils.MoveElement(doc, ntb.Id, a.Point - b.Point);
                    }
                    catch { }
                    foreach (Parameter p in tb.Parameters)
                    {
                        if (p.Definition is InternalDefinition idf
                            && (idf.BuiltInParameter == BuiltInParameter.SHEET_NUMBER || idf.BuiltInParameter == BuiltInParameter.SHEET_NAME))
                            continue;
                        try { CopyParam(p, ntb.get_Parameter(p.Definition), c); } catch { }
                    }
                }
            }
            return ns;
        }

        /// <summary>
        /// Харагдацын тайрах хүрээ хуудсан дээр (model → projection → sheet): [төв, зүүн доод булан].
        /// null — тайрах хүрээгүй (3D) эсвэл Revit хувиргалт өгөөгүй.
        /// </summary>
        internal static XYZ[] CropOnSheet(View v, Viewport vp)
        {
            try
            {
                if (v == null || !v.CropBoxActive)
                    return null;
                BoundingBoxXYZ cb = v.CropBox;
                IList<TransformWithBoundary> m2p = v.GetModelToProjectionTransforms();
                if (m2p == null || m2p.Count == 0)
                    return null;
                Transform toSheet = vp.GetProjectionToSheetTransform().Multiply(m2p[0].GetModelToProjectionTransform());
                double z = (cb.Min.Z + cb.Max.Z) / 2;
                double minX = double.MaxValue, minY = double.MaxValue;
                foreach (XYZ p in new[] { new XYZ(cb.Min.X, cb.Min.Y, z), new XYZ(cb.Max.X, cb.Min.Y, z), new XYZ(cb.Min.X, cb.Max.Y, z), new XYZ(cb.Max.X, cb.Max.Y, z) })
                {
                    XYZ q = toSheet.OfPoint(cb.Transform.OfPoint(p));
                    minX = Math.Min(minX, q.X);
                    minY = Math.Min(minY, q.Y);
                }
                XYZ center = toSheet.OfPoint(cb.Transform.OfPoint((cb.Min + cb.Max) / 2));
                return new[] { center, new XYZ(minX, minY, 0) };
            }
            catch
            {
                return null;
            }
        }

        /// <summary>
        /// Клон viewport-ыг ЗУРГААР нь (тайрах хүрээний төвөөр) эхтэй ижил байрлалд тавина.
        /// ⚠️ Хайрцгийн төвөөр тавих нь хангалтгүй: хайрцагт тайрахгүй тэмдэглэгээ ордог — B3-ийн
        /// зүсэлтэд 17 м зайтай өөр зүсэлтийн тэмдэг (Longitudinal) харагдаж хайрцгийг 6 фут болгосноор
        /// зураг хуудаснаас гарч байсан (2026-09-30 хэмжсэн); эх B1-ийн хайрцаг ч урт leader-аар хэлбийсэн.
        /// </summary>
        private static void AlignByCrop(CdPlan plan, Viewport src, Viewport dst, View dstView)
        {
            XYZ[] want = plan.CropOnSheet(src);
            if (want == null)
                return;
            XYZ[] got = CropOnSheet(dstView, dst);
            if (got == null)
                return;
            var delta = new XYZ(want[0].X - got[0].X, want[0].Y - got[0].Y, 0);
            if (delta.GetLength() < 1e-6)
                return;
            try { ElementTransformUtils.MoveElement(dst.Document, dst.Id, delta); } catch { }
        }

        /// <summary>
        /// Гарчгийг (view title) зурагтай нь хамт байрлуулна: эх гарчиг эх тайрах хүрээний зүүн доод
        /// булангаас хэр зайтай байсан, клоных ч тэр зайд.  ⚠️ LabelOffset нь viewport-ын ХАЙРЦГИЙН зүүн
        /// доод булангаас хэмжигддэг бөгөөд хайрцаг нь тэмдэглэгээнээс хамаарч эх, клонд ӨӨР (B1-ийн
        /// зүсэлт урт leader-тай 1.62 фут, B3-ийнх 0.61) — шууд хуулахад гарчиг хүснэгт дээр гарч байсан
        /// (2026-09-30 хэмжсэн).  Хуудсан дээрх бүх viewport үүсгэсний ДАРАА (нэг регенераци) дуудна.
        /// </summary>
        private static void PlaceLabel(CdPlan plan, Viewport src, Viewport dst, View dstView)
        {
            KeyValuePair<XYZ, double> label = plan.Label(src);
            if (label.Key == null)
                return;
            XYZ want = label.Key;
            XYZ[] s = plan.CropOnSheet(src);
            XYZ sMin = plan.BoxMin(src);
            XYZ[] d = CropOnSheet(dstView, dst);
            Outline o = null;
            try { o = dst.GetBoxOutline(); } catch { }
            if (s != null && sMin != null && d != null && o != null)
            {
                want = new XYZ(
                    sMin.X + label.Key.X - s[1].X + d[1].X - o.MinimumPoint.X,
                    sMin.Y + label.Key.Y - s[1].Y + d[1].Y - o.MinimumPoint.Y,
                    label.Key.Z);
            }
            try { if (!dst.LabelOffset.IsAlmostEqualTo(want)) dst.LabelOffset = want; } catch { }
        }

        /// <summary>
        /// Viewport-ын тохиргоо.  ⚠️ ХУРД: зөрсөн үед л бичнэ; эх талын утгууд ажиллуулалтад нэг удаа
        /// уншигдана (CdPlan).  Байрлалыг дараа нь AlignByCrop засна; эргүүлсэн бөгөөд тайрах хүрээгүй
        /// бол л хайрцгийн төвийг дахин тавина.
        /// </summary>
        private static void CopyViewport(CdPlan plan, Viewport src, Viewport dst, XYZ srcCenter)
        {
            bool rotated = false;
            try { if (dst.GetTypeId() != src.GetTypeId()) dst.ChangeTypeId(src.GetTypeId()); } catch { }
            try
            {
                if (dst.Rotation != src.Rotation)
                {
                    dst.Rotation = src.Rotation;
                    rotated = true;
                }
            }
            catch { }
            try
            {
                Parameter a = src.get_Parameter(BuiltInParameter.VIEWPORT_DETAIL_NUMBER);
                Parameter b = dst.get_Parameter(BuiltInParameter.VIEWPORT_DETAIL_NUMBER);
                if (a != null && b != null && !b.IsReadOnly && a.AsString() != b.AsString())
                    b.Set(a.AsString());
            }
            catch { }
            KeyValuePair<XYZ, double> label = plan.Label(src);
            try { if (!double.IsNaN(label.Value) && Math.Abs(dst.LabelLineLength - label.Value) > 1e-9) dst.LabelLineLength = label.Value; } catch { }
            if (rotated)
            {
                try { dst.SetBoxCenter(srcCenter); } catch { }
            }
        }

        private static void CopySheetParameters(CdContext c, ViewSheet src, ViewSheet dst)
        {
            foreach (Parameter a in src.Parameters)
            {
                try
                {
                    if (a.IsReadOnly || !a.HasValue || a.Definition == null)
                        continue;
                    if (a.Definition is InternalDefinition idf
                        && (idf.BuiltInParameter == BuiltInParameter.SHEET_NUMBER || idf.BuiltInParameter == BuiltInParameter.SHEET_NAME))
                        continue;
                    CopyParam(a, dst.get_Parameter(a.Definition), c);
                }
                catch { }
            }
        }

        /// <summary>Legend, хүснэгт, хуудасны 2D (текст, зураас, штрих, тэмдэг) — шинэ хуудсанд.</summary>
        private static void CopySheetExtras(CdContext c, ViewSheet sheet, ViewSheet ns)
        {
            Document doc = c.Doc;
            foreach (Viewport vp in c.Plan.Viewports.Where(x => x != null && x.IsValidObject && x.SheetId == sheet.Id))
            {
                if (c.Dest.ContainsKey(vp.ViewId))
                    continue;
                if (doc.GetElement(vp.ViewId) is View lv && lv.ViewType == ViewType.Legend)
                {
                    try
                    {
                        XYZ center = c.Plan.BoxCenter(vp);
                        Viewport lvp = Viewport.Create(doc, ns.Id, lv.Id, center);
                        CopyViewport(c.Plan, vp, lvp, center);
                        PlaceLabel(c.Plan, vp, lvp, lv);
                    }
                    catch { }
                }
                else
                {
                    c.Rep.Note("«" + sheet.SheetNumber + "» хуудасны «" + doc.GetElement(vp.ViewId)?.Name
                        + "» харагдац загварт зориулагдаагүй тул шинэ хуудсанд ороогүй.");
                }
            }
            foreach (ScheduleSheetInstance ssi in new FilteredElementCollector(doc).OwnedByView(sheet.Id).OfClass(typeof(ScheduleSheetInstance))
                         .Cast<ScheduleSheetInstance>())
            {
                if (ssi.IsTitleblockRevisionSchedule)
                    continue;
                try { ScheduleSheetInstance.Create(doc, ns.Id, ssi.ScheduleId, ssi.Point); } catch { }
            }
            try
            {
                List<ElementId> s2d = new FilteredElementCollector(doc).OwnedByView(sheet.Id).WhereElementIsNotElementType()
                    .WherePasses(new ElementMulticlassFilter(new List<Type>
                        { typeof(TextNote), typeof(CurveElement), typeof(FilledRegion), typeof(FamilyInstance) }))
                    .Where(e => !(e is FamilyInstance fi) || fi.Category?.Id.Value == (long)BuiltInCategory.OST_GenericAnnotation)
                    .Where(e => !(e is CurveElement) || e.Category?.Id.Value == (long)BuiltInCategory.OST_Lines)
                    .Select(e => e.Id).ToList();
                if (s2d.Count > 0)
                {
                    ICollection<ElementId> copies = ElementTransformUtils.CopyElements(sheet, s2d, ns, Transform.Identity, new CopyPasteOptions());
                    foreach (ElementId id in copies)
                    {
                        if (doc.GetElement(id) is TextNote tn)
                            ReplaceMarkInText(c, tn);
                    }
                }
            }
            catch { }
        }

        // ══ Туслах ══════════════════════════════════════════════════════════

        /// <summary>Цэгийг харагдацын хавтгай руу проекцлоно (tag, хэмжээс, 2D энэ хавтгайд байх ёстой).</summary>
        internal static XYZ InView(View v, XYZ p)
        {
            // 3D (түгжигдсэн) харагдацад tag-ийн байрлал 3D цэг — хавтгай руу проекцлохгүй.
            if (v is View3D)
                return p;
            XYZ n = v.ViewDirection;
            XYZ o = ViewPlaneOrigin(v);
            return p - n * (p - o).DotProduct(n);
        }

        internal static XYZ ViewPlaneOrigin(View v)
        {
            if (v is ViewPlan vp && vp.GenLevel != null)
                return new XYZ(0, 0, vp.GenLevel.ProjectElevation);
            try
            {
                SketchPlane sp = v.SketchPlane;
                if (sp != null)
                    return sp.GetPlane().Origin;
            }
            catch { }
            return v.Origin;
        }
    }
}
