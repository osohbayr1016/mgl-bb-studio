using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.ChangeImpact.Core;

namespace RevitMcpAddin.ChangeImpact
{
    internal sealed class ScheduleHit
    {
        public long ScheduleId;
        public bool Verified;
    }

    /// <summary>
    /// Резольверуудын ИНДЕКС (лавлах хүснэгт).  Бүгд id-аар (Revit обьект хадгалахгүй), нэг удаа бүтээгдэнэ.
    ///
    ///   Бүтцийн индекс (хурдан, нэг скан):  viewport/хуудас · харагдац (template, давхар) · tag · хэмжээс
    ///   Дараах индекс (ХУРДАН БИШ, ХЭСЭГЛЭСЭН, цуцлах боломжтой):  өрөөний хил · харагдацын харагдалт · хүснэгтийн мөр
    ///
    /// ⚠️ Харагдацын харагдалт (`FilteredElementCollector(doc, viewId)`): Revit өөрөө «харагдацын геометрийг
    /// дахин бүтээж болзошгүй, анх удаа ихээхэн удаан» гэж баримтжуулсан — тиймээс харагдац бүрийг ТУСДАА Step-д,
    /// хугацааны хязгаартай.  «Харагдаж болзошгүй» гэж үр дүнд хэзээ ч «харагдаж байна» гэж тэмдэглэхгүй (итгэл C).
    /// </summary>
    internal sealed partial class ResolverHub
    {
        private Dictionary<long, List<long>> _viewportsByView;
        private Dictionary<long, long> _viewportSheet;
        private Dictionary<long, List<long>> _scheduleInstances;
        private List<long> _sheetIds;
        private Dictionary<long, List<long>> _viewsByTemplate, _viewsByLevel;
        private Dictionary<long, List<long>> _tagsByHost, _dimsByRef;
        private const int MaxIndexed = 80000;

        internal Dictionary<long, List<long>> RoomsByBoundary = new Dictionary<long, List<long>>();
        internal Dictionary<long, List<long>> VisibleViews = new Dictionary<long, List<long>>();
        internal Dictionary<long, List<ScheduleHit>> ScheduleHits = new Dictionary<long, List<ScheduleHit>>();

        private static void Add(Dictionary<long, List<long>> map, long key, long value)
        {
            List<long> l;
            if (!map.TryGetValue(key, out l)) { l = new List<long>(2); map[key] = l; }
            if (!l.Contains(value)) l.Add(value);
        }

        /* ============================== STRUCTURAL ========================= */

        internal void EnsureViewportIndex()
        {
            if (_viewportsByView != null) return;
            _viewportsByView = new Dictionary<long, List<long>>();
            _viewportSheet = new Dictionary<long, long>();
            _scheduleInstances = new Dictionary<long, List<long>>();
            _sheetIds = new List<long>();

            foreach (ElementId sid in new FilteredElementCollector(_doc).OfClass(typeof(ViewSheet)).ToElementIds())
                _sheetIds.Add(sid.Value);

            foreach (Element e in new FilteredElementCollector(_doc).OfClass(typeof(Viewport)))
            {
                try
                {
                    var vp = (Viewport)e;
                    if (vp.SheetId == ElementId.InvalidElementId) continue;
                    Add(_viewportsByView, vp.ViewId.Value, vp.Id.Value);
                    _viewportSheet[vp.Id.Value] = vp.SheetId.Value;
                }
                catch (Exception) { }
            }

            foreach (Element e in new FilteredElementCollector(_doc).OfClass(typeof(ScheduleSheetInstance)))
            {
                try
                {
                    var si = (ScheduleSheetInstance)e;
                    if (si.ScheduleId == ElementId.InvalidElementId) continue;
                    Add(_scheduleInstances, si.ScheduleId.Value, si.Id.Value);
                }
                catch (Exception) { }
            }
        }

        internal void EnsureViewIndex()
        {
            if (_viewsByTemplate != null) return;
            _viewsByTemplate = new Dictionary<long, List<long>>();
            _viewsByLevel = new Dictionary<long, List<long>>();
            int n = 0;
            foreach (Element e in new FilteredElementCollector(_doc).OfClass(typeof(View)))
            {
                if (++n > MaxIndexed) { Truncated("view_index", "Харагдацын индекс " + MaxIndexed + "-аар таслагдав — зарим харагдац шинжлэгдээгүй."); break; }
                try
                {
                    var v = (View)e;
                    if (v.IsTemplate) continue;
                    ElementId vt = v.ViewTemplateId;
                    if (vt != null && vt != ElementId.InvalidElementId) Add(_viewsByTemplate, vt.Value, v.Id.Value);
                    var plan = v as ViewPlan;
                    if (plan != null && plan.GenLevel != null) Add(_viewsByLevel, plan.GenLevel.Id.Value, v.Id.Value);
                }
                catch (Exception) { }
            }
        }

        internal void EnsureTagIndex()
        {
            if (_tagsByHost != null) return;
            _tagsByHost = new Dictionary<long, List<long>>();
            int n = 0;
            foreach (Element e in new FilteredElementCollector(_doc).OfClass(typeof(IndependentTag)))
            {
                if (++n > MaxIndexed) { Truncated("tag_index", "Tag-ийн индекс " + MaxIndexed + "-аар таслагдав — зарим tag шинжлэгдээгүй."); break; }
                try
                {
                    var tag = (IndependentTag)e;
                    foreach (ElementId host in tag.GetTaggedLocalElementIds())
                        if (host != ElementId.InvalidElementId) Add(_tagsByHost, host.Value, tag.Id.Value);
                }
                catch (Exception) { }
            }
            foreach (Element e in new FilteredElementCollector(_doc).OfCategory(BuiltInCategory.OST_RoomTags).WhereElementIsNotElementType())
            {
                try
                {
                    var rt = e as Autodesk.Revit.DB.Architecture.RoomTag;
                    if (rt != null && rt.Room != null) Add(_tagsByHost, rt.Room.Id.Value, rt.Id.Value);
                }
                catch (Exception) { }
            }
        }

        internal void EnsureDimensionIndex()
        {
            if (_dimsByRef != null) return;
            _dimsByRef = new Dictionary<long, List<long>>();
            int n = 0;
            foreach (Element e in new FilteredElementCollector(_doc).OfClass(typeof(Dimension)))
            {
                if (++n > MaxIndexed) { Truncated("dimension_index", "Хэмжээсийн индекс " + MaxIndexed + "-аар таслагдав — зарим хэмжээс шинжлэгдээгүй."); break; }
                try
                {
                    var dim = (Dimension)e;
                    ReferenceArray refs = dim.References;
                    if (refs == null) continue;
                    foreach (Reference r in refs)
                    {
                        ElementId id = r.ElementId;
                        if (id != null && id != ElementId.InvalidElementId && id != dim.Id) Add(_dimsByRef, id.Value, dim.Id.Value);
                    }
                }
                catch (Exception) { /* зарим хэмжээс (spot) лавлагаагүй */ }
            }
        }

        /// <summary>Бүтцийн индексүүдийг НЭГ нэгээр нь (Step бүрд нэг) бэлдэнэ.  Нэр буцаана; null = бүгд бэлэн.</summary>
        internal string NextStructuralIndex()
        {
            if (_viewportsByView == null) { EnsureViewportIndex(); return "хуудас/viewport"; }
            if (_viewsByTemplate == null) { EnsureViewIndex(); return "харагдац"; }
            if (_tagsByHost == null) { EnsureTagIndex(); return "tag"; }
            if (_dimsByRef == null) { EnsureDimensionIndex(); return "хэмжээс"; }
            return null;
        }

        /* ============================== POST (STEPPED) ===================== */

        private List<long> _roomIds;
        private int _roomPos;
        private List<long> _visViews;
        private int _visPos;
        private List<ElementId> _candidateIds;
        private List<long> _candidates;
        private List<long> _schedIds;
        private int _schedPos;
        private bool _roomsOn, _visOn, _schedOn;

        internal string PostStage { get; private set; }
        internal int PostDone { get; private set; }
        internal int PostTotal { get; private set; }

        private static readonly HashSet<long> RoomBounding = new HashSet<long>
        {
            (long)BuiltInCategory.OST_Walls, (long)BuiltInCategory.OST_Floors, (long)BuiltInCategory.OST_Ceilings,
            (long)BuiltInCategory.OST_Roofs, (long)BuiltInCategory.OST_Columns, (long)BuiltInCategory.OST_StructuralColumns,
            (long)BuiltInCategory.OST_RoomSeparationLines, (long)BuiltInCategory.OST_RvtLinks,
        };

        /// <summary>
        /// «Дараах индекс»-ийн ажлыг төлөвлөнө.  `candidateIds` = графаар хүрсэн АМЬД загварын элементүүд (view-specific биш).
        /// Өрөөний индекс нь ЗӨВХӨН өрөөний хил үүсгэж болох ангилалын элемент байвал л бүтээгдэнэ.
        /// </summary>
        internal void BeginPost(IReadOnlyList<long> candidateIds, bool rooms, bool visibility, bool schedules, int maxCandidates)
        {
            _candidates = candidateIds.Take(maxCandidates).ToList();
            if (candidateIds.Count > maxCandidates)
                Truncated("post_candidates", "Харагдалт/хүснэгтийн шинжилгээнд " + candidateIds.Count + " элементээс хамгийн хүчтэй " + maxCandidates + "-г л авав.");
            _candidateIds = _candidates.Select(i => new ElementId(i)).ToList();

            EnsureViewportIndex();

            _roomsOn = rooms && _candidates.Any(c => RoomBounding.Contains(Node(c).CategoryId));
            if (_roomsOn)
            {
                _roomIds = new FilteredElementCollector(_doc).OfCategory(BuiltInCategory.OST_Rooms).WhereElementIsNotElementType()
                    .ToElementIds().Select(i => i.Value).ToList();
                if (_roomIds.Count > 6000) { Truncated("rooms", "Өрөө " + _roomIds.Count + " — эхний 6000-г л шалгав."); _roomIds = _roomIds.Take(6000).ToList(); }
            }
            else _roomIds = new List<long>();
            _roomPos = 0;

            _visOn = visibility && _candidates.Count > 0;
            _visViews = new List<long>();
            if (_visOn)
            {
                foreach (long vid in _viewportsByView.Keys)
                {
                    var v = Live(vid) as View;
                    if (v != null && IsModelView(v)) _visViews.Add(vid);
                }
                if (_visViews.Count > 400) { Truncated("visibility_views", "Хуудсанд байрласан " + _visViews.Count + " харагдацаас эхний 400-г л шалгав."); _visViews = _visViews.Take(400).ToList(); }
            }
            _visPos = 0;

            _schedOn = schedules && _candidates.Count > 0;
            _schedIds = _schedOn ? _scheduleInstances.Keys.ToList() : new List<long>();
            _schedPos = 0;

            PostTotal = _roomIds.Count + _visViews.Count + _schedIds.Count;
            PostDone = 0;
            PostStage = null;
        }

        private static bool IsModelView(View v)
        {
            if (v.IsTemplate) return false;
            switch (v.ViewType)
            {
                case ViewType.FloorPlan:
                case ViewType.CeilingPlan:
                case ViewType.Elevation:
                case ViewType.Section:
                case ViewType.ThreeD:
                case ViewType.Detail:
                case ViewType.AreaPlan:
                case ViewType.EngineeringPlan:
                    return true;
                default:
                    return false;
            }
        }

        /// <summary>Хугацааны хязгаартай (`budgetMs`) ажиллана.  true = дараах индекс бүгд ДУУССАН.</summary>
        internal bool PostStep(int budgetMs)
        {
            var sw = Stopwatch.StartNew();
            ElementIdSetFilter filter = null;
            while (sw.ElapsedMilliseconds < budgetMs)
            {
                if (_roomPos < _roomIds.Count)
                {
                    PostStage = "Өрөөний хил";
                    RoomStep(_roomIds[_roomPos++]);
                    PostDone++;
                    continue;
                }
                if (_visPos < _visViews.Count)
                {
                    PostStage = "Харагдалт";
                    if (filter == null) filter = new ElementIdSetFilter(_candidateIds);
                    VisibilityStep(_visViews[_visPos++], filter);
                    PostDone++;
                    continue;
                }
                if (_schedPos < _schedIds.Count)
                {
                    PostStage = "Хүснэгт";
                    if (filter == null) filter = new ElementIdSetFilter(_candidateIds);
                    ScheduleStep(_schedIds[_schedPos++], filter);
                    PostDone++;
                    continue;
                }
                return true;
            }
            return _roomPos >= _roomIds.Count && _visPos >= _visViews.Count && _schedPos >= _schedIds.Count;
        }

        private void RoomStep(long roomId)
        {
            try
            {
                var room = Live(roomId) as SpatialElement;
                if (room == null || room.Area <= 0) return;
                IList<IList<BoundarySegment>> loops = room.GetBoundarySegments(new SpatialElementBoundaryOptions());
                if (loops == null) return;
                foreach (IList<BoundarySegment> loop in loops)
                    foreach (BoundarySegment seg in loop)
                    {
                        ElementId id = seg.ElementId;
                        if (id != null && id != ElementId.InvalidElementId) Add(RoomsByBoundary, id.Value, roomId);
                    }
            }
            catch (Exception ex) { Fail("rooms", ex); }
        }

        private void VisibilityStep(long viewId, ElementIdSetFilter filter)
        {
            try
            {
                foreach (ElementId id in new FilteredElementCollector(_doc, new ElementId(viewId)).WherePasses(filter).ToElementIds())
                    Add(VisibleViews, id.Value, viewId);
            }
            catch (Exception ex) { Fail("visibility", ex); }
        }

        private void ScheduleStep(long scheduleId, ElementIdSetFilter filter)
        {
            try
            {
                var sched = Live(scheduleId) as ViewSchedule;
                if (sched == null) return;

                var verified = new HashSet<long>();
                try
                {
                    foreach (ElementId id in new FilteredElementCollector(_doc, sched.Id).WherePasses(filter).ToElementIds()) verified.Add(id.Value);
                }
                catch (Exception) { /* энэ хүснэгтийг элементээр нь давтах боломжгүй — доор ангиллаар таамаглана */ }

                // ⚠️ `FilteredElementCollector(doc, scheduleViewId)`-ийн хүснэгтийн мөрийг буцаах зан төлөв Revit-ийн баримтжуулалтад
                // БАЙХГҮЙ.  Хоосон үр дүн нь «нэр дэвшигч нэг ч мөрөнд ороогүй» ч, «энэ арга хүснэгтэд ажиллахгүй» ч байж болно —
                // ялгах аргагүй тул хоосон бол ангиллаар (D, сул таамаг) ХЭЗЭЭ Ч чимээгүй алгасахгүй.
                bool verifiedOk = verified.Count > 0;

                long catId = 0;
                try
                {
                    ElementId c = sched.Definition.CategoryId;
                    if (c != null && c != ElementId.InvalidElementId) catId = c.Value;
                }
                catch (Exception) { }

                // Олон ангилалтай (multi-category) хүснэгтэд `CategoryId` хүчингүй (баримтжуулсан) — ангиллаар шалгаж БОЛОХГҮЙ тул
                // бүх нэр дэвшигчийг сул таамаг (D) гэж үзнэ: «ямар ч холбоо алга» гэж чимээгүй дүгнэхгүй.
                bool multiCategory = catId == 0 && !verifiedOk;
                foreach (long cand in _candidates)
                {
                    bool isVerified = verified.Contains(cand);
                    // Мөрөнд орсон нь батлагдсан бол (C); хоосон/боломжгүй үед л ангиллын таарцаар (D).
                    if (!isVerified && !multiCategory && (verifiedOk || Node(cand).CategoryId != catId)) continue;
                    List<ScheduleHit> hits;
                    if (!ScheduleHits.TryGetValue(cand, out hits)) { hits = new List<ScheduleHit>(1); ScheduleHits[cand] = hits; }
                    hits.Add(new ScheduleHit { ScheduleId = scheduleId, Verified = isVerified });
                }
                if (!verifiedOk) Note("Зарим хүснэгтийн мөрийг (элементээр) батлах боломжгүй байсан — ангиллын таарцаар (сул таамаг D) тэмдэглэв.");
            }
            catch (Exception ex) { Fail("schedules", ex); }
        }

        /// <summary>Хуудсанд байрласан бүх харагдац (view id → хуудас).  Нийтлэх интеграцид хэрэгтэй.</summary>
        internal IReadOnlyList<long> AllSheetIds
        {
            get
            {
                EnsureViewportIndex();
                return _sheetIds;
            }
        }
    }
}
