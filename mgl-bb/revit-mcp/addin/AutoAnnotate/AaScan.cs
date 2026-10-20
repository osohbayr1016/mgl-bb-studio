using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using RevitMcpAddin.AutoAnnotate.Core;

namespace RevitMcpAddin.AutoAnnotate
{
    /// <summary>
    /// Холбосон (link) Revit файл.  Элемент нь link-ийн координатад тул цэг/векторыг
    /// <see cref="T"/>-ээр хост руу шилжүүлж, лавлагааг <see cref="Reference.CreateLinkReference"/>-ээр
    /// хостын харагдацад хэмжигдэх болгоно.
    ///
    /// ⚠️ 1.7.1 (2026-10-01): ажилтны төсөлд хана, тэнхлэг нь ихэвчлэн LINK-ээс ирдэг (бүтээцийн,
    /// инженерийн файл архитектурын загварыг холбодог).  `FilteredElementCollector(doc, viewId)` нь
    /// зөвхөн ХОСТЫН элементийг буцаадаг тул 1.7.0 тийм харагдацад «Олдсон 0» гэж бүх хэмжээсийг
    /// идэвхгүй болгож байв (хэмжсэн: link-ээр 244 хана, 28 тэнхлэг харагддаг планд 0).
    ///
    /// ⚠️⚠️ `FilteredElementCollector(doc, viewId, linkId)` (Revit 2024+) -ийг ХЭЗЭЭ Ч БҮҮ ХЭРЭГЛЭ.
    /// Хэмжсэн 2026-10-01 (Revit 2027.2): дэлгэцэнд нээгдээгүй харагдац, эсвэл TransactionGroup буцаасны
    /// дараа `OfClass` дээр нативаар (0xc0000005, coreclr) Revit-ийг БҮХЭЛД НЬ унагадаг — try/catch барихгүй,
    /// хэрэглэгчийн хадгалаагүй ажил алдагдана (3 удаа давтагдсан).  Тиймээс link-ийг өөрийнх нь
    /// баримтаас уншиж, харагдах эсэхийг <see cref="ViewData.Visible"/> өөрөө шүүнэ: хостын VG-ийн
    /// ангилал, View Range (план), Crop/Far clip (зүсэлт).  Link «By linked view» бол тэр харагдацаар.
    /// </summary>
    internal sealed class LinkSrc
    {
        public RevitLinkInstance Inst;
        public Document Doc;
        public Transform T;
        public long Id;
        public string Name;
        /// <summary>Link «By linked view» горимд — link-ийн харагдац (тэр харагдацаар шүүнэ).</summary>
        public ElementId LinkedViewId = ElementId.InvalidElementId;
        /// <summary>Хостын харагдацын үе шаттай (нэрээр) таарах link-ийн үе шат; олдохгүй бол сүүлийнх.</summary>
        public Phase Phase;
    }

    /// <summary>Хост (src == null) эсвэл link-ийн элементийн координат, лавлагаа, түлхүүр.</summary>
    internal static class Lk
    {
        public static XYZ P(LinkSrc s, XYZ p) => s == null || p == null ? p : s.T.OfPoint(p);

        public static XYZ Vec(LinkSrc s, XYZ v) => s == null || v == null ? v : s.T.OfVector(v);

        public static V2 P2(LinkSrc s, XYZ p)
        {
            XYZ q = P(s, p);
            return new V2(q.X, q.Y);
        }

        public static V2 Vec2(LinkSrc s, XYZ v)
        {
            XYZ q = Vec(s, v);
            return new V2(q.X, q.Y);
        }

        /// <summary>Link-ийн лавлагааг хостод хэмжигдэх болгоно.  Чадахгүй бол null (тэр цэг алгасагдана).</summary>
        public static Reference R(LinkSrc s, Reference r)
        {
            if (r == null || s == null)
                return r;
            try
            {
                return r.CreateLinkReference(s.Inst);
            }
            catch
            {
                return null;
            }
        }

        /// <summary>Хост ба link-ийн элементийг ялгах түлхүүр (id нь файл бүрд давхцдаг).</summary>
        public static string K(LinkSrc s, ElementId id) => (s == null ? "0" : s.Id.ToString()) + ":" + id.Value;

        public static string K(long linkId, long id) => linkId + ":" + id;

        public static IEnumerable<XYZ> Corners(BoundingBoxXYZ bb, LinkSrc s) => AaScan.Corners(bb).Select(p => P(s, p));

        /// <summary>Хостын Z хүрээ (link шилжсэн/эргэсэн ч).</summary>
        public static bool ZRange(Element e, LinkSrc s, out double min, out double max)
        {
            min = double.MaxValue;
            max = double.MinValue;
            BoundingBoxXYZ bb = e.get_BoundingBox(null);
            if (bb == null)
                return false;
            foreach (XYZ c in Corners(bb, s))
            {
                if (c.Z < min) min = c.Z;
                if (c.Z > max) max = c.Z;
            }
            return true;
        }

        /// <summary>
        /// Тэнхлэг/түвшний (datum) лавлагаа.  ⚠️ Link-ийн тэнхлэгт `new Reference(g).CreateLinkReference`
        /// нь «Invalid number of references» өгдөг (хэмжсэн 2026-10-01) — stable representation-д
        /// «:0:LINEAR» нэмж дахин задлахад зөв хэмжигдэнэ (8/8 тэнхлэгийн зай яг таарсан).
        /// </summary>
        public static Reference DatumRef(LinkSrc s, Reference r)
        {
            if (r == null || s == null)
                return r;
            try
            {
                Document host = s.Inst.Document;
                string rep = r.CreateLinkReference(s.Inst).ConvertToStableRepresentation(host);
                if (!rep.EndsWith(":LINEAR", StringComparison.Ordinal) && !rep.EndsWith(":SURFACE", StringComparison.Ordinal))
                    rep += ":0:LINEAR";
                return Reference.ParseFromStableRepresentation(host, rep);
            }
            catch
            {
                return null;
            }
        }

        public static Reference FirstRef(FamilyInstance fi, FamilyInstanceReferenceType t, LinkSrc s)
        {
            try
            {
                IList<Reference> refs = fi.GetReferences(t);
                return refs != null && refs.Count > 0 ? R(s, refs[0]) : null;
            }
            catch
            {
                return null;
            }
        }
    }

    /// <summary>Хавтгай нүүрний лавлагаа + 2D байрлал (план XY / харагдацын UV).</summary>
    internal sealed class FaceRef
    {
        public Reference Ref;
        public V2 Origin;
        public V2 Normal;
        public double ZMin, ZMax;
        /// <summary>Хананы нормалийн дагуух хүрээ (дамжуулж буй нүүр хананы аль талд хүрч байна).</summary>
        public double NMin, NMax;
        public double Area;
    }

    internal sealed class WallData
    {
        public Wall Wall;
        public LinkSrc Src;
        public string K;
        public WallSeg Seg;
        public Exposure Exp;
        /// <summary>Шулуун, энгийн (curtain/stacked биш), хоёр талын нүүр олдсон.</summary>
        public bool Dimensionable;
        public bool InScope = true;
        public FaceRef LeftFace, RightFace;
        /// <summary>Нормаль нь хананы чиглэлтэй параллель нүүрүүд — нүхний хажуу (jamb) ба үзүүр.</summary>
        public readonly List<FaceRef> AlongFaces = new List<FaceRef>();
        public readonly List<OpeningData> Openings = new List<OpeningData>();

        public double PosOf(V2 p) => (p - Seg.Line.A).Dot(Seg.Dir);
        public FaceRef SideFace(Exposure e) => e == Exposure.Right ? RightFace : LeftFace;
        /// <summary>Тухайн талын нүүрний хавтгай — хананы зүүн нормалиар хэмжсэн.</summary>
        public double SidePlane(Exposure e) => SideFace(e).Origin.Dot(Seg.LeftNormal);
    }

    internal sealed class GridData
    {
        public Grid Grid;
        public LinkSrc Src;
        public Seg Seg;
        /// <summary>Тэнхлэгийн шугамын чиглэл (тэмдэггүй нормчилсон).</summary>
        public V2 Dir;
        public Reference Ref;
        /// <summary>Зүсэлт: тэнхлэгийн хавтгайн нормаль (Right, ViewDirection) суурьт — гүнээр хазайсныг ялгана.</summary>
        public V2 SectionNormal;
    }

    internal sealed class LevelData
    {
        public Level Level;
        public LinkSrc Src;
        /// <summary>Хостын загварын Z.</summary>
        public double Z;
        public Reference Ref;
    }

    internal sealed class OpeningData
    {
        public FamilyInstance Fi;
        public LinkSrc Src;
        public WallData Host;
        public bool Door;
        public bool InScope = true;
        /// <summary>Хост хананы дагуух төв ба ирмэгүүд (A-аас, фут).</summary>
        public double Pos, Min, Max;
        public readonly List<FaceRef> Jambs = new List<FaceRef>();
        public string K => Lk.K(Src, Fi.Id);
    }

    internal sealed class ColumnData
    {
        public FamilyInstance Fi;
        public LinkSrc Src;
        public V2 Center;
        public V2 BasisX;
        public bool InScope = true;
        /// <summary>Хүрээний тэнхлэгүүдээрх хүрээ.</summary>
        public double MinU, MaxU, MinV, MaxV;
        public string K => Lk.K(Src, Fi.Id);
    }

    internal sealed class RoomData
    {
        public Room Room;
        public LinkSrc Src;
        /// <summary>Өрөөний байршлын цэг (хост).</summary>
        public XYZ Pt;
        public string K => Lk.K(Src, Room.Id);
    }

    internal sealed class FramingData
    {
        public FamilyInstance Fi;
        public LinkSrc Src;
        /// <summary>Тэнхлэгийн хоёр үзүүр ба дунд цэг (хост).</summary>
        public XYZ A, B, Mid;
        public string K => Lk.K(Src, Fi.Id);
    }

    /// <summary>Зүсэлт/фасадын цонх, хаалга.</summary>
    internal sealed class SecOpening
    {
        public FamilyInstance Fi;
        public LinkSrc Src;
        public string K => Lk.K(Src, Fi.Id);
    }

    /// <summary>
    /// Харагдацын нэг удаагийн уншилт — шинжилгээ (цонх) ба гүйцэтгэл хоёулаа ЯГ үүнийг хэрэглэнэ.
    /// Юу ч өөрчлөхгүй (Transaction шаардахгүй).
    /// </summary>
    internal sealed class ViewData
    {
        public Document Doc;
        public View View;
        public AaViewKind Kind;
        public int Scale;
        public bool Structural;
        public AaFrame F;
        /// <summary>План: хэмжээсийн шугамын Z (харагдацын түвшин).</summary>
        public double Z;
        /// <summary>План: огтлолын хавтгай — хана, багана «огтлогдсон» эсэх.</summary>
        public double CutZ;
        public bool ZFilter = true;

        public readonly List<WallData> Walls = new List<WallData>();
        public readonly Dictionary<string, WallData> WallById = new Dictionary<string, WallData>();
        public readonly List<Blocker> Blockers = new List<Blocker>();
        public readonly List<GridData> Grids = new List<GridData>();
        public readonly List<OpeningData> Openings = new List<OpeningData>();
        public readonly List<ColumnData> Columns = new List<ColumnData>();
        public readonly List<FramingData> Framing = new List<FramingData>();
        public readonly List<RoomData> Rooms = new List<RoomData>();
        public readonly List<LevelData> Levels = new List<LevelData>();
        /// <summary>Зүсэлт/фасад: цонх, хаалга (хостгүй ч байж болно).</summary>
        public readonly List<SecOpening> SectionOpenings = new List<SecOpening>();
        public readonly Box Building = new Box();
        public int CurtainWalls, CurvedWalls;

        // ── Оношилгоо (цонхонд «яагаад 0» гэдгийг хэлнэ)
        /// <summary>Харагдацад харагдаж буй link (ачаалагдсан).</summary>
        public readonly List<LinkSrc> Links = new List<LinkSrc>();
        /// <summary>Харагдацад байгаа боловч ачаалагдаагүй link-ийн нэр.</summary>
        public readonly List<string> LinksUnloaded = new List<string>();
        /// <summary>Огтлолын шүүлтээс ӨМНӨХ хана (хост + link).</summary>
        public int RawWalls;
        /// <summary>Огтлолын хавтгайд нэг ч хана таараагүй тул өөр өндрөөр огтолсон.</summary>
        public bool CutFallback;
        /// <summary>Link-ээс уншсан элемент (хана, нүх, багана, тэнхлэг, өрөө, түвшин).</summary>
        public int LinkedElements;

        /// <summary>null = бүх харагдац.  Хостын id; link-ийн элементэд link instance-ийн id.</summary>
        public HashSet<long> Scope;

        /// <summary>«link:id» түлхүүр (<see cref="Lk.K(LinkSrc, ElementId)"/>).</summary>
        public readonly HashSet<string> Tagged = new HashSet<string>();
        public readonly HashSet<string> RoomTagged = new HashSet<string>();

        /// <summary>Сонголтод багтах уу: хостын элемент өөрөө, link-ийн элемент — link instance сонгогдсон бол.</summary>
        public bool In(Element e, LinkSrc s = null)
        {
            if (Scope == null)
                return true;
            if (s != null)
                return Scope.Contains(s.Id);
            return e != null && Scope.Contains(e.Id.Value);
        }

        // Зүсэлт/фасад: харагдацын хавтгай
        public XYZ Origin, Right, Up;

        public V2 ToView(XYZ p)
        {
            if (Kind == AaViewKind.Plan)
                return new V2(p.X, p.Y);
            XYZ d = p - Origin;
            return new V2(d.DotProduct(Right), d.DotProduct(Up));
        }

        /// <summary>Чиглэлийн вектор харагдацын 2D хавтгайд.</summary>
        public V2 ToViewVec(XYZ v)
        {
            if (Kind == AaViewKind.Plan)
                return new V2(v.X, v.Y);
            return new V2(v.DotProduct(Right), v.DotProduct(Up));
        }

        public XYZ ToModel(V2 p)
        {
            if (Kind == AaViewKind.Plan)
                return new XYZ(p.X, p.Y, Z);
            return Origin + Right * p.X + Up * p.Y;
        }

        public double Feet(double paperMm) => Paper.ToFeet(paperMm, Scale);

        /// <summary>Хост (null) дараа нь харагдаж буй link бүр.</summary>
        public IEnumerable<LinkSrc> Sources()
        {
            yield return null;
            foreach (LinkSrc s in Links)
                yield return s;
        }

        /// <summary>
        /// Хост: харагдацаар шүүсэн цуглуулагч.  Link: link-ийн БҮХ баримт (эсвэл «By linked view» бол
        /// тэр харагдац) — дуудагч элемент бүрийг <see cref="Visible"/>-аар шүүнэ.  Алдаа гарвал null.
        /// ⚠️ (doc, viewId, linkId) байгуулагчийг бүү хэрэглэ — <see cref="LinkSrc"/>-ийн тайлбар.
        /// </summary>
        public FilteredElementCollector Collect(LinkSrc s)
        {
            try
            {
                if (s == null)
                    return new FilteredElementCollector(Doc, View.Id);
                if (s.LinkedViewId != ElementId.InvalidElementId)
                {
                    try { return new FilteredElementCollector(s.Doc, s.LinkedViewId); }
                    catch { }
                }
                return new FilteredElementCollector(s.Doc);
            }
            catch
            {
                return null;
            }
        }

        // ── Link-ийн элемент харагдах эсэх (харагдацын хүрээ, хостын координатад)
        /// <summary>План: View Range-ийн доод/дээд Z.</summary>
        public double RangeLo = double.MinValue, RangeHi = double.MaxValue;
        /// <summary>План: View Range-ийн дээд хавтгай — цонх, тавилга, generic model огтлолоос дээш байсан ч
        /// тэр хүртэл харагдана (Revit-ийн дүрэм).</summary>
        public double RangeTop = double.MaxValue;
        /// <summary>Crop (идэвхтэй бол) — тайрах хүрээний локал координатад.</summary>
        public Transform CropInv;
        public XYZ CropMin, CropMax;
        /// <summary>Зүсэлт/фасад: Far clip идэвхтэй (гүний шүүлт).</summary>
        public bool CropDepth;

        /// <summary>
        /// Link-ийн элемент энэ харагдацад харагдах уу (ойролцоо): хостын VG-д ангилал нуугдаагүй,
        /// хүрээ нь View Range / Crop-той огтлолцоно.  Хостын элементэд үргэлж true (цуглуулагч шүүсэн).
        /// </summary>
        public bool Visible(Element e, LinkSrc s)
        {
            if (s == null || e == null)
                return e != null;
            bool byLinkView = s.LinkedViewId != ElementId.InvalidElementId;
            if (!byLinkView && (!CatVisible(e, s) || !PhaseVisible(e, s)))
                return false;
            IEnumerable<XYZ> pts = Extent(e, s);
            if (pts == null)
                return false;
            long cat = e.Category?.Id.Value ?? 0;
            bool aboveCutShown = cat == (long)BuiltInCategory.OST_Windows || cat == (long)BuiltInCategory.OST_Casework
                || cat == (long)BuiltInCategory.OST_GenericModel;
            return Overlaps(pts, !byLinkView, aboveCutShown ? RangeTop : RangeHi);
        }

        /// <summary>Хостын координатын хүрээний 8 орой.  Тэнхлэгт BoundingBox байхгүй байж болно — GetExtents.</summary>
        private static IEnumerable<XYZ> Extent(Element e, LinkSrc s)
        {
            try
            {
                if (e is Grid g)
                {
                    Outline o = g.GetExtents();
                    if (o != null)
                    {
                        var bb0 = new BoundingBoxXYZ { Min = o.MinimumPoint, Max = o.MaximumPoint };
                        return Lk.Corners(bb0, s).ToList();
                    }
                }
                BoundingBoxXYZ bb = e.get_BoundingBox(null);
                return bb == null ? null : Lk.Corners(bb, s).ToList();
            }
            catch
            {
                return null;
            }
        }

        /// <summary>Хостын харагдацын үе шат (Phase) ба Phase Filter-ээр харагдах уу; үндсэн биш Design Option нуугдана.</summary>
        public bool PhaseVisible(Element e, LinkSrc s)
        {
            try
            {
                if (e.DesignOption != null && !e.DesignOption.IsPrimary)
                    return false;
            }
            catch
            {
            }
            if (s.Phase == null)
                return true;
            try
            {
                if (e is SpatialElement)
                {
                    // Өрөө зөвхөн өөрийн үе шатны харагдацад.
                    Parameter rp = e.get_Parameter(BuiltInParameter.ROOM_PHASE);
                    ElementId pid = rp?.AsElementId();
                    return pid == null || pid == ElementId.InvalidElementId || pid == s.Phase.Id;
                }
                ElementOnPhaseStatus st = e.GetPhaseStatus(s.Phase.Id);
                if (st == ElementOnPhaseStatus.Future || st == ElementOnPhaseStatus.Past)
                    return false;
                if (PhaseFilter != null && st != ElementOnPhaseStatus.None
                    && PhaseFilter.GetPhaseStatusPresentation(st) == PhaseStatusPresentation.DontShow)
                    return false;
            }
            catch
            {
            }
            return true;
        }

        /// <summary>Хостын харагдацын Phase Filter (null = бүгд).</summary>
        public PhaseFilter PhaseFilter;

        /// <summary>Link «By host view» бол хостын VG-д ангилал нуугдаагүй эсэх.</summary>
        public bool CatVisible(Element e, LinkSrc s)
        {
            if (s == null || s.LinkedViewId != ElementId.InvalidElementId || e?.Category == null)
                return true;
            try
            {
                return !View.GetCategoryHidden(e.Category.Id);
            }
            catch
            {
                return true;
            }
        }

        /// <summary>
        /// Хостын координатын цэгүүдийн хүрээ харагдацын хүрээтэй огтлолцох уу.  План: View Range
        /// (Revit-тэй тулгасан — огтлолын хавтгайгаас бүхэлдээ ДЭЭШ элемент харагддаггүй, доод хавтгайд
        /// хүрч буй нь харагдана), Crop XY.  Зүсэлт: Crop + Far clip.
        /// </summary>
        public bool Overlaps(IEnumerable<XYZ> pts, bool useRange = true, double? hi = null)
        {
            double rangeHi = hi ?? RangeHi;
            double zMin = double.MaxValue, zMax = double.MinValue;
            double lx0 = double.MaxValue, lx1 = double.MinValue, ly0 = double.MaxValue, ly1 = double.MinValue, lz0 = double.MaxValue, lz1 = double.MinValue;
            foreach (XYZ p in pts)
            {
                zMin = Math.Min(zMin, p.Z);
                zMax = Math.Max(zMax, p.Z);
                if (CropInv != null)
                {
                    XYZ q = CropInv.OfPoint(p);
                    lx0 = Math.Min(lx0, q.X); lx1 = Math.Max(lx1, q.X);
                    ly0 = Math.Min(ly0, q.Y); ly1 = Math.Max(ly1, q.Y);
                    lz0 = Math.Min(lz0, q.Z); lz1 = Math.Max(lz1, q.Z);
                }
            }
            if (zMax < zMin)
                return false;
            if (useRange && Kind == AaViewKind.Plan && (zMax < RangeLo - 0.1 || zMin > rangeHi + 0.02))
                return false;
            if (CropInv != null)
            {
                const double t = 0.01;
                if (lx1 < CropMin.X - t || lx0 > CropMax.X + t || ly1 < CropMin.Y - t || ly0 > CropMax.Y + t)
                    return false;
                if (CropDepth && (lz1 < CropMin.Z - t || lz0 > CropMax.Z + t))
                    return false;
            }
            return true;
        }
    }

    internal static class AaScan
    {
        public static AaViewKind KindOf(View v)
        {
            if (v == null || v.IsTemplate)
                return AaViewKind.Unsupported;
            if (v is ViewPlan)
            {
                ViewType t = v.ViewType;
                return t == ViewType.FloorPlan || t == ViewType.CeilingPlan || t == ViewType.EngineeringPlan || t == ViewType.AreaPlan
                    ? AaViewKind.Plan
                    : AaViewKind.Unsupported;
            }
            if (v is ViewSection)
            {
                if (v.ViewType == ViewType.Elevation)
                    return AaViewKind.Elevation;
                if (v.ViewType == ViewType.Section || v.ViewType == ViewType.Detail)
                    return AaViewKind.Section;
            }
            return AaViewKind.Unsupported;
        }

        /// <param name="ignoreTags">Эдгээр tag-ийг «аль хэдийн tag-тай»-д тооцохгүй — шинжилгээнд өмнөх
        /// автомат tag (дахин ажиллуулахад устгагдах тул).</param>
        public static ViewData Read(Document doc, View view, ICollection<ElementId> selection, bool onlySelection,
            ICollection<ElementId> ignoreTags = null)
        {
            var d = new ViewData
            {
                Doc = doc,
                View = view,
                Kind = KindOf(view),
                Scale = view.Scale > 0 ? view.Scale : 100,
                Structural = view.Discipline == ViewDiscipline.Structural,
            };
            if (onlySelection && selection != null && selection.Count > 0)
                d.Scope = new HashSet<long>(selection.Select(i => i.Value));

            ReadLinks(d);
            ReadExistingTags(d, ignoreTags == null ? null : new HashSet<long>(ignoreTags.Select(i => i.Value)));
            if (d.Kind == AaViewKind.Plan)
                ReadPlan(d);
            else if (d.Kind != AaViewKind.Unsupported)
                ReadSection(d);
            return d;
        }

        /// <summary>Энэ харагдацад ХАРАГДАЖ буй link instance (нуусан link орохгүй).</summary>
        private static void ReadLinks(ViewData d)
        {
            FilteredElementCollector col = d.Collect(null);
            if (col == null)
                return;
            // Харагдацын цуглуулагч ачаалагдаагүй link-ийг буцаадаггүй (харагдахгүй тул) — «Reload хий» гэж
            // хэлэхийн тулд бүх instance-ийг үзэж, энэ харагдацад нуугдаагүйг нь тоолно.
            var visible = new HashSet<long>(col.OfClass(typeof(RevitLinkInstance)).ToElementIds().Select(i => i.Value));
            bool linksHidden = false;
            try { linksHidden = d.View.GetCategoryHidden(new ElementId(BuiltInCategory.OST_RvtLinks)); }
            catch { }
            foreach (RevitLinkInstance li in new FilteredElementCollector(d.Doc).OfClass(typeof(RevitLinkInstance)).Cast<RevitLinkInstance>())
            {
                bool shown = visible.Contains(li.Id.Value);
                if (!shown)
                {
                    bool loaded = false;
                    try { loaded = li.GetLinkDocument() != null; }
                    catch { }
                    bool hidden = linksHidden;
                    try { hidden = hidden || li.IsHidden(d.View); }
                    catch { }
                    if (loaded || hidden)
                        continue; // ачаалагдсан ч энэ харагдацад харагдахгүй, эсвэл зориуд нуусан
                }
                string name = li.Name;
                try
                {
                    if (d.Doc.GetElement(li.GetTypeId()) is RevitLinkType lt)
                        name = lt.Name;
                }
                catch
                {
                }
                Document ld = null;
                try { ld = li.GetLinkDocument(); }
                catch { }
                if (ld == null)
                {
                    d.LinksUnloaded.Add(name);
                    continue;
                }
                Transform t;
                try { t = li.GetTotalTransform(); }
                catch { t = Transform.Identity; }
                var src = new LinkSrc { Inst = li, Doc = ld, T = t, Id = li.Id.Value, Name = name, Phase = LinkPhase(d, ld) };
                try
                {
                    RevitLinkGraphicsSettings g = d.View.GetLinkOverrides(li.Id);
                    if (g != null && g.LinkVisibilityType == LinkVisibility.ByLinkView
                        && g.LinkedViewId != ElementId.InvalidElementId && ld.GetElement(g.LinkedViewId) is View)
                        src.LinkedViewId = g.LinkedViewId;
                }
                catch
                {
                    // Тохиргоо уншигдахгүй — «By host view» гэж үзнэ.
                }
                d.Links.Add(src);
            }
            if (d.Links.Count > 0)
            {
                ReadRegion(d);
                try
                {
                    d.PhaseFilter = d.Doc.GetElement(d.View.get_Parameter(BuiltInParameter.VIEW_PHASE_FILTER)?.AsElementId() ?? ElementId.InvalidElementId) as PhaseFilter;
                }
                catch
                {
                }
            }
        }

        private static Phase LinkPhase(ViewData d, Document ld)
        {
            try
            {
                var hp = d.Doc.GetElement(d.View.get_Parameter(BuiltInParameter.VIEW_PHASE)?.AsElementId() ?? ElementId.InvalidElementId) as Phase;
                List<Phase> phases = ld.Phases.Cast<Phase>().ToList();
                if (phases.Count == 0)
                    return null;
                return (hp == null ? null : phases.FirstOrDefault(x => string.Equals(x.Name, hp.Name, StringComparison.OrdinalIgnoreCase)))
                    ?? phases[phases.Count - 1];
            }
            catch
            {
                return null;
            }
        }

        /// <summary>Link-ийн элементийг шүүх харагдацын хүрээ (View Range, Crop, Far clip).</summary>
        private static void ReadRegion(ViewData d)
        {
            View v = d.View;
            if (v is ViewPlan vp)
            {
                try
                {
                    PlanViewRange vr = vp.GetViewRange();
                    double Z(PlanViewPlane pl, double fallback)
                    {
                        ElementId lid = vr.GetLevelId(pl);
                        return d.Doc.GetElement(lid) is Level l ? l.ProjectElevation + vr.GetOffset(pl) : fallback;
                    }
                    double cut = Z(PlanViewPlane.CutPlane, double.NaN);
                    double bottom = Math.Min(Z(PlanViewPlane.BottomClipPlane, double.MinValue), Z(PlanViewPlane.ViewDepthPlane, double.MinValue));
                    double top = Z(PlanViewPlane.TopClipPlane, double.MaxValue);
                    if (vp.ViewType == ViewType.CeilingPlan)
                    {
                        // Таазны план ДЭЭШ хардаг: огтлолоос дээд хавтгай хүртэл.
                        d.RangeLo = double.IsNaN(cut) ? bottom : cut;
                        d.RangeHi = top;
                        d.RangeTop = top;
                    }
                    else
                    {
                        // Хэмжсэн (Revit-ийн link-ийн харагдах элементтэй тулгав): огтлолоос бүхэлдээ дээш
                        // байгаа элемент планд харагддаггүй; харагдацын гүн хүртэлх нь харагдана.
                        d.RangeLo = bottom;
                        d.RangeHi = double.IsNaN(cut) ? top : cut;
                        d.RangeTop = top;
                    }
                }
                catch
                {
                    // View Range-гүй — бүх өндөр.
                }
            }
            try
            {
                bool section = !(v is ViewPlan);
                if (v.CropBoxActive || section)
                {
                    BoundingBoxXYZ cb = v.CropBox;
                    if (cb != null)
                    {
                        Transform tr = cb.Transform ?? Transform.Identity;
                        d.CropInv = tr.Inverse;
                        XYZ mn = cb.Min, mx = cb.Max;
                        if (!v.CropBoxActive)
                        {
                            // Тайраагүй зүсэлт — хажуу тийш хязгааргүй, зөвхөн гүнээр.
                            mn = new XYZ(-1e9, -1e9, mn.Z);
                            mx = new XYZ(1e9, 1e9, mx.Z);
                        }
                        d.CropMin = mn;
                        d.CropMax = mx;
                        if (section)
                        {
                            // Фасад: «Far Clipping» (0 = хязгааргүй); зүсэлт: «Far Clip Active».
                            Parameter fc = v.get_Parameter(BuiltInParameter.VIEWER_BOUND_FAR_CLIPPING);
                            Parameter af = v.get_Parameter(BuiltInParameter.VIEWER_BOUND_ACTIVE_FAR);
                            if (fc != null && fc.HasValue)
                                d.CropDepth = fc.AsInteger() != 0;
                            else
                                d.CropDepth = af == null || !af.HasValue || af.AsInteger() != 0;
                        }
                        if (!section)
                        {
                            // План: Z-ийг View Range шийднэ.
                            d.CropMin = new XYZ(mn.X, mn.Y, -1e9);
                            d.CropMax = new XYZ(mx.X, mx.Y, 1e9);
                        }
                    }
                }
            }
            catch
            {
                d.CropInv = null;
            }
        }

        // ══════════════════════════════════════════════════════════════════
        //  ПЛАН
        // ══════════════════════════════════════════════════════════════════

        private sealed class RawWall
        {
            public Wall W;
            public LinkSrc Src;
            public double ZMin, ZMax;
        }

        private static void ReadPlan(ViewData d)
        {
            Document doc = d.Doc;
            var vp = (ViewPlan)d.View;
            Level gen = vp.GenLevel;
            d.Z = gen != null ? gen.ProjectElevation : 0;
            d.CutZ = d.Z + 4;
            try
            {
                PlanViewRange vr = vp.GetViewRange();
                ElementId lid = vr.GetLevelId(PlanViewPlane.CutPlane);
                if (doc.GetElement(lid) is Level cl)
                    d.CutZ = cl.ProjectElevation + vr.GetOffset(PlanViewPlane.CutPlane);
                else if (gen != null)
                    d.CutZ = gen.ProjectElevation + vr.GetOffset(PlanViewPlane.CutPlane);
            }
            catch
            {
                // Харагдацын хүрээ уншигдахгүй бол түвшнээс 1.2 м.
            }

            // ── Тэнхлэг (хостынх эхэнд — link-ийнх давхцвал хостынх үлдэнэ)
            foreach (LinkSrc s in d.Sources())
            {
                FilteredElementCollector col = d.Collect(s);
                if (col == null)
                    continue;
                foreach (Grid g in col.OfClass(typeof(Grid)).Cast<Grid>())
                {
                    if (!(g.Curve is Line l) || !d.Visible(g, s))
                        continue;
                    var seg = new Seg(Lk.P2(s, l.GetEndPoint(0)), Lk.P2(s, l.GetEndPoint(1)));
                    if (seg.Length < 1e-6)
                        continue;
                    V2 dir = Dir.Canonical(seg.Dir);
                    if (s != null && d.Grids.Any(x => Dir.Parallel(x.Dir, dir) && x.Seg.DistanceTo(seg.A) < 0.02 && Math.Abs((seg.A - x.Seg.A).Dot(dir.Perp())) < 0.02))
                        continue; // хостод ижил тэнхлэг (copy/monitor) бий
                    Reference r = Lk.DatumRef(s, new Reference(g));
                    if (r == null)
                        continue;
                    d.Grids.Add(new GridData { Grid = g, Src = s, Seg = seg, Dir = dir, Ref = r });
                    if (s != null) d.LinkedElements++;
                }
            }

            // ── Хана: эхлээд харагдацад байгаа бүх ханыг (огтлолын шүүлтгүй) цуглуулна
            var raw = new List<RawWall>();
            foreach (LinkSrc s in d.Sources())
            {
                FilteredElementCollector col = d.Collect(s);
                if (col == null)
                    continue;
                foreach (Wall w in col.OfClass(typeof(Wall)).Cast<Wall>())
                {
                    if (!d.Visible(w, s) || !Lk.ZRange(w, s, out double z0, out double z1))
                        continue;
                    raw.Add(new RawWall { W = w, Src = s, ZMin = z0, ZMax = z1 });
                }
            }
            d.RawWalls = raw.Count;
            ChooseCut(d, raw);

            var opt = new Options { ComputeReferences = true, DetailLevel = ViewDetailLevel.Fine, IncludeNonVisibleObjects = false };
            int key = 0;
            foreach (RawWall rw in raw)
            {
                if (!(rw.ZMin - 0.05 <= d.CutZ && d.CutZ <= rw.ZMax + 0.05))
                    continue;
                Wall w = rw.W;
                LinkSrc s = rw.Src;
                if (!(w.Location is LocationCurve lc) || lc.Curve == null)
                    continue;
                Curve c = lc.Curve;
                WallKind kind = WallKind.Basic;
                try { kind = w.WallType.Kind; } catch { }

                if (!(c is Line))
                {
                    d.CurvedWalls++;
                    IList<XYZ> pts = c.Tessellate();
                    for (int i = 0; i + 1 < pts.Count; i++)
                        d.Blockers.Add(new Blocker(-1 - d.CurvedWalls, new Seg(Lk.P2(s, pts[i]), Lk.P2(s, pts[i + 1]))));
                    continue;
                }
                var seg = new Seg(Lk.P2(s, c.GetEndPoint(0)), Lk.P2(s, c.GetEndPoint(1)));
                if (seg.Length < 0.05)
                    continue;
                var wd = new WallData
                {
                    Wall = w,
                    Src = s,
                    K = Lk.K(s, w.Id),
                    Seg = new WallSeg(key++, seg, w.Width),
                    InScope = d.In(w, s),
                };
                d.Walls.Add(wd);
                d.WallById[wd.K] = wd;
                d.Blockers.Add(new Blocker(wd.Seg.Key, seg));
                if (s != null) d.LinkedElements++;
                if (kind == WallKind.Curtain)
                {
                    d.CurtainWalls++;
                    continue;
                }
                if (kind != WallKind.Basic)
                    continue;
                ReadWallFaces(wd, opt, d);
            }

            // Огтлолын өндөр нүүрүүдтэй таарахгүй бол (Z-ийн тооллын систем өөр) шүүлтийг унтраана.
            if (d.Walls.Count > 0 && !d.Walls.Any(w => w.AlongFaces.Any(f => f.ZMin - 0.1 <= d.CutZ && d.CutZ <= f.ZMax + 0.1)))
                d.ZFilter = false;

            // ── Гадна хана
            foreach (WallData wd in d.Walls)
                wd.Exp = Exterior.Classify(wd.Seg, d.Blockers);

            // ── Нүх (хаалга, цонх) — хост хана нь энэ харагдацад огтлогдсон; багана; дам нуруу
            foreach (LinkSrc s in d.Sources())
            {
                FilteredElementCollector col = d.Collect(s);
                if (col == null)
                    continue;
                var fiCats = new ElementMulticategoryFilter(new List<BuiltInCategory>
                {
                    BuiltInCategory.OST_Doors, BuiltInCategory.OST_Windows, BuiltInCategory.OST_StructuralColumns,
                    BuiltInCategory.OST_Columns, BuiltInCategory.OST_StructuralFraming,
                });
                foreach (FamilyInstance fi in col.OfClass(typeof(FamilyInstance)).WherePasses(fiCats).Cast<FamilyInstance>())
                {
                    if (!d.Visible(fi, s))
                        continue;
                    long cat = fi.Category?.Id.Value ?? 0;
                    if (cat == (long)BuiltInCategory.OST_Doors || cat == (long)BuiltInCategory.OST_Windows)
                    {
                        if (fi.Host is Wall hw && d.WallById.TryGetValue(Lk.K(s, hw.Id), out WallData host))
                            AddOpening(d, fi, s, host, cat == (long)BuiltInCategory.OST_Doors);
                    }
                    else if (cat == (long)BuiltInCategory.OST_StructuralColumns || cat == (long)BuiltInCategory.OST_Columns)
                    {
                        AddColumn(d, fi, s);
                    }
                    else if (cat == (long)BuiltInCategory.OST_StructuralFraming)
                    {
                        if (fi.Location is LocationCurve flc && flc.Curve != null)
                        {
                            d.Framing.Add(new FramingData
                            {
                                Fi = fi,
                                Src = s,
                                A = Lk.P(s, flc.Curve.GetEndPoint(0)),
                                B = Lk.P(s, flc.Curve.GetEndPoint(1)),
                                Mid = Lk.P(s, flc.Curve.Evaluate(0.5, true)),
                            });
                            if (s != null) d.LinkedElements++;
                        }
                    }
                }
            }

            foreach (WallData wd in d.Walls)
                AssignJambs(wd, d);

            // ── Өрөө
            foreach (LinkSrc s in d.Sources())
            {
                FilteredElementCollector col = d.Collect(s);
                if (col == null)
                    continue;
                foreach (Room r in col.OfCategory(BuiltInCategory.OST_Rooms).WhereElementIsNotElementType().OfType<Room>())
                {
                    if (!d.Visible(r, s))
                        continue;
                    if (r.Location is LocationPoint lp && r.Area > 1e-6)
                    {
                        d.Rooms.Add(new RoomData { Room = r, Src = s, Pt = Lk.P(s, lp.Point) });
                        if (s != null) d.LinkedElements++;
                    }
                }
            }

            // ── Хүрээ ба барилгын хүрээ
            var dirs = d.Grids.Select(g => g.Dir).ToList();
            XYZ vr0 = d.View.RightDirection;
            var viewRight = new V2(vr0.X, vr0.Y);
            if (dirs.Count == 0)
            {
                WallData longest = d.Walls.OrderByDescending(w => w.Seg.Line.Length).FirstOrDefault();
                if (longest != null)
                    dirs.Add(longest.Seg.Dir);
            }
            d.F = AaFrame.FromDirections(dirs, viewRight);
            foreach (ColumnData c in d.Columns)
                FillColumnBox(d, c);
            BuildPlanBox(d);
        }

        /// <summary>
        /// Огтлолын хавтгай: харагдацын «Cut plane».  Харагдацад хана байгаа ч НЭГ Ч нь тэр өндөрт
        /// огтлогдохгүй бол (link босоогоор шилжсэн, view range-ийн түвшин өөр г.м.) хамгийн олон хана
        /// огтлох өндрийг сонгоно — эс бөгөөс бүх хэмжээс «0» болдог.
        /// </summary>
        private static void ChooseCut(ViewData d, List<RawWall> raw)
        {
            if (raw.Count == 0)
                return;
            Func<double, int> cuts = z => raw.Count(w => w.ZMin - 0.05 <= z && z <= w.ZMax + 0.05);
            if (cuts(d.CutZ) > 0)
                return;
            var cands = new List<double> { d.Z + 3.94, d.Z + 1 };
            cands.AddRange(raw.Select(w => (w.ZMin + w.ZMax) / 2));
            cands.AddRange(raw.Select(w => w.ZMin + 3.94));
            double best = d.CutZ;
            int bestN = 0;
            foreach (double z in cands)
            {
                int n = cuts(z);
                if (n > bestN || (n == bestN && n > 0 && Math.Abs(z - d.CutZ) < Math.Abs(best - d.CutZ)))
                {
                    bestN = n;
                    best = z;
                }
            }
            if (bestN > 0)
            {
                d.CutZ = best;
                d.CutFallback = true;
            }
        }

        private static void ReadWallFaces(WallData wd, Options opt, ViewData d)
        {
            V2 dir = wd.Seg.Dir, left = wd.Seg.LeftNormal;
            GeometryElement ge;
            try { ge = wd.Wall.get_Geometry(opt); }
            catch { return; }
            if (ge == null)
                return;
            foreach (GeometryObject go in ge)
            {
                if (!(go is Solid s) || s.Faces.Size == 0 || s.Volume <= 1e-9)
                    continue;
                foreach (Face f in s.Faces)
                {
                    if (!(f is PlanarFace pf) || pf.Reference == null)
                        continue;
                    XYZ n = Lk.Vec(wd.Src, pf.FaceNormal);
                    // Бага зэрэг налуу нүүр нь босоо тэнхлэгтэй «параллель биш» — хэмжээс хасагдана.
                    if (Math.Abs(n.Z) > 1e-6)
                        continue;
                    var n2 = new V2(n.X, n.Y).Normalized();
                    bool along = Dir.Parallel(n2, dir);
                    bool side = !along && Dir.Parallel(n2, left);
                    if (!along && !side)
                        continue;
                    FaceRef fr = Measure(pf, n2, along ? left : dir, wd.Src);
                    if (fr == null)
                        continue;
                    if (along)
                    {
                        wd.AlongFaces.Add(fr);
                    }
                    else
                    {
                        bool isLeft = n2.Dot(left) > 0;
                        FaceRef cur = isLeft ? wd.LeftFace : wd.RightFace;
                        if (cur == null || fr.Area > cur.Area)
                        {
                            if (isLeft) wd.LeftFace = fr;
                            else wd.RightFace = fr;
                        }
                    }
                }
            }
            wd.Dimensionable = wd.LeftFace != null && wd.RightFace != null;
        }

        /// <summary>Нүүрний Z-хүрээ ба өгсөн тэнхлэгийн дагуух хүрээ (гурвалжилсан оройгоор), хостын координатад.</summary>
        internal static FaceRef Measure(PlanarFace pf, V2 n2, V2 spanAxis, LinkSrc src = null)
        {
            Reference r = Lk.R(src, pf.Reference);
            if (r == null)
                return null;
            var fr = new FaceRef
            {
                Ref = r,
                Origin = Lk.P2(src, pf.Origin),
                Normal = n2,
                Area = pf.Area,
                ZMin = double.MaxValue,
                ZMax = double.MinValue,
                NMin = double.MaxValue,
                NMax = double.MinValue,
            };
            try
            {
                Mesh m = pf.Triangulate();
                foreach (XYZ v0 in m.Vertices)
                {
                    XYZ v = Lk.P(src, v0);
                    if (v.Z < fr.ZMin) fr.ZMin = v.Z;
                    if (v.Z > fr.ZMax) fr.ZMax = v.Z;
                    double s = v.X * spanAxis.X + v.Y * spanAxis.Y;
                    if (s < fr.NMin) fr.NMin = s;
                    if (s > fr.NMax) fr.NMax = s;
                }
            }
            catch
            {
                fr.ZMin = double.MinValue;
                fr.ZMax = double.MaxValue;
            }
            return fr;
        }

        private static void AddOpening(ViewData d, FamilyInstance fi, LinkSrc s, WallData host, bool door)
        {
            XYZ p0 = (fi.Location as LocationPoint)?.Point;
            if (p0 == null)
                return;
            V2 p = Lk.P2(s, p0);
            double pos = host.PosOf(p);
            double w = OpeningWidth(fi);
            if (w <= 0)
            {
                // Параметргүй бол BoundingBox-оос (хүрээ, тавцантай тул арай өргөн).
                BoundingBoxXYZ bb = fi.get_BoundingBox(null);
                if (bb == null)
                    return;
                double mn = double.MaxValue, mx = double.MinValue;
                foreach (XYZ c in Lk.Corners(bb, s))
                {
                    double t = host.PosOf(new V2(c.X, c.Y));
                    mn = Math.Min(mn, t);
                    mx = Math.Max(mx, t);
                }
                w = mx - mn;
            }
            var od = new OpeningData
            {
                Fi = fi,
                Src = s,
                Host = host,
                Door = door,
                Pos = pos,
                Min = pos - w / 2,
                Max = pos + w / 2,
                InScope = d.In(fi, s),
            };
            host.Openings.Add(od);
            d.Openings.Add(od);
            if (s != null) d.LinkedElements++;
        }

        private static double OpeningWidth(FamilyInstance fi)
        {
            foreach (BuiltInParameter bip in new[] { BuiltInParameter.FAMILY_ROUGH_WIDTH_PARAM, BuiltInParameter.FAMILY_WIDTH_PARAM, BuiltInParameter.DOOR_WIDTH, BuiltInParameter.WINDOW_WIDTH })
            {
                double v = ParamDouble(fi, bip);
                if (v <= 0 && fi.Symbol != null)
                    v = ParamDouble(fi.Symbol, bip);
                if (v > 0)
                    return v;
            }
            return 0;
        }

        private static double ParamDouble(Element e, BuiltInParameter bip)
        {
            try
            {
                Parameter p = e.get_Parameter(bip);
                return p != null && p.HasValue && p.StorageType == StorageType.Double ? p.AsDouble() : 0;
            }
            catch
            {
                return 0;
            }
        }

        /// <summary>
        /// Хананы дагуух нүүрүүдийг нүхэнд хуваарилна: нүхний хүрээнд (±12 см) байгаа нүүр = хажуу (jamb).
        /// Огтлолын хавтгайг хамраагүй нүүр (цонхны доор/дээр) — план дээр харагдахгүй тул орохгүй.
        /// </summary>
        private static void AssignJambs(WallData wd, ViewData d)
        {
            if (wd.Openings.Count == 0 || wd.AlongFaces.Count == 0)
                return;
            const double Slack = 0.4;
            foreach (FaceRef f in wd.AlongFaces)
            {
                if (d.ZFilter && !(f.ZMin - 0.05 <= d.CutZ && d.CutZ <= f.ZMax + 0.05))
                    continue;
                double pos = wd.PosOf(f.Origin);
                OpeningData best = null;
                double bd = double.MaxValue;
                foreach (OpeningData o in wd.Openings)
                {
                    if (pos < o.Min - Slack || pos > o.Max + Slack)
                        continue;
                    double dist = Math.Min(Math.Abs(pos - o.Min), Math.Abs(pos - o.Max));
                    if (dist < bd)
                    {
                        bd = dist;
                        best = o;
                    }
                }
                best?.Jambs.Add(f);
            }
        }

        private static void AddColumn(ViewData d, FamilyInstance fi, LinkSrc s)
        {
            if (!Lk.ZRange(fi, s, out double z0, out double z1) || !(z0 - 0.05 <= d.CutZ && d.CutZ <= z1 + 0.05))
                return;
            if (!(fi.Location is LocationPoint lp))
                return;
            d.Columns.Add(new ColumnData
            {
                Fi = fi,
                Src = s,
                Center = Lk.P2(s, lp.Point),
                BasisX = Lk.Vec2(s, fi.GetTransform().BasisX).Normalized(),
                InScope = d.In(fi, s),
            });
            if (s != null) d.LinkedElements++;
        }

        private static void FillColumnBox(ViewData d, ColumnData c)
        {
            BoundingBoxXYZ bb = c.Fi.get_BoundingBox(null);
            c.MinU = c.MinV = double.MaxValue;
            c.MaxU = c.MaxV = double.MinValue;
            if (bb == null)
            {
                c.MinU = c.MaxU = c.Center.Dot(d.F.U);
                c.MinV = c.MaxV = c.Center.Dot(d.F.V);
                return;
            }
            foreach (XYZ p in Lk.Corners(bb, c.Src))
            {
                var q = new V2(p.X, p.Y);
                double u = q.Dot(d.F.U), v = q.Dot(d.F.V);
                c.MinU = Math.Min(c.MinU, u);
                c.MaxU = Math.Max(c.MaxU, u);
                c.MinV = Math.Min(c.MinV, v);
                c.MaxV = Math.Max(c.MaxV, v);
            }
        }

        private static void BuildPlanBox(ViewData d)
        {
            AaFrame f = d.F;
            foreach (WallData w in d.Walls)
            {
                V2 n = w.Seg.LeftNormal * w.Seg.Half;
                d.Building.Add(f, w.Seg.Line.A + n);
                d.Building.Add(f, w.Seg.Line.A - n);
                d.Building.Add(f, w.Seg.Line.B + n);
                d.Building.Add(f, w.Seg.Line.B - n);
            }
            foreach (ColumnData c in d.Columns)
            {
                d.Building.Add(f, f.U * c.MinU + f.V * c.MinV);
                d.Building.Add(f, f.U * c.MaxU + f.V * c.MaxV);
            }
            foreach (FramingData b in d.Framing)
            {
                d.Building.Add(f, new V2(b.A.X, b.A.Y));
                d.Building.Add(f, new V2(b.B.X, b.B.Y));
            }
            if (!d.Building.IsEmpty)
                return;
            // Модель элемент алга — тэнхлэгийн огтлолцлын хүрээ.
            foreach (GridData g in d.Grids)
            {
                if (Dir.Parallel(g.Dir, f.V))
                {
                    double u = g.Seg.A.Dot(f.U);
                    d.Building.MinU = Math.Min(d.Building.MinU, u);
                    d.Building.MaxU = Math.Max(d.Building.MaxU, u);
                }
                else if (Dir.Parallel(g.Dir, f.U))
                {
                    double v = g.Seg.A.Dot(f.V);
                    d.Building.MinV = Math.Min(d.Building.MinV, v);
                    d.Building.MaxV = Math.Max(d.Building.MaxV, v);
                }
            }
            if (d.Building.MinU > d.Building.MaxU)
            {
                d.Building.MinU = 0;
                d.Building.MaxU = 0;
            }
            if (d.Building.MinV > d.Building.MaxV)
            {
                d.Building.MinV = 0;
                d.Building.MaxV = 0;
            }
        }

        internal static IEnumerable<XYZ> Corners(BoundingBoxXYZ bb)
        {
            Transform t = bb.Transform ?? Transform.Identity;
            XYZ a = bb.Min, b = bb.Max;
            for (int i = 0; i < 8; i++)
            {
                var p = new XYZ((i & 1) == 0 ? a.X : b.X, (i & 2) == 0 ? a.Y : b.Y, (i & 4) == 0 ? a.Z : b.Z);
                yield return t.OfPoint(p);
            }
        }

        // ══════════════════════════════════════════════════════════════════
        //  ЗҮСЭЛТ / ФАСАД
        // ══════════════════════════════════════════════════════════════════

        private static void ReadSection(ViewData d)
        {
            View v = d.View;
            d.Origin = v.Origin;
            d.Right = v.RightDirection.Normalize();
            d.Up = v.UpDirection.Normalize();
            d.F = AaFrame.Axis; // харагдацын UV өөрөө хүрээ

            // ── Түвшин (хостынх эхэнд; link-ийнх ижил өндөрт бол алгасна)
            foreach (LinkSrc s in d.Sources())
            {
                FilteredElementCollector col = d.Collect(s);
                if (col == null)
                    continue;
                foreach (Level l in col.OfClass(typeof(Level)).Cast<Level>())
                {
                    double z = Lk.P(s, new XYZ(0, 0, l.ProjectElevation)).Z;
                    if (s != null && d.Levels.Any(x => Math.Abs(x.Z - z) < 0.01))
                        continue;
                    // Түвшинд BoundingBox байхгүй — харагдацын хавтгай дээрх тэр өндрийн цэгээр.
                    if (s != null && (!d.CatVisible(l, s) || !d.Overlaps(new[] { new XYZ(d.Origin.X, d.Origin.Y, z) })))
                        continue;
                    Reference rf = null;
                    try { rf = l.GetPlaneReference(); }
                    catch { }
                    if (rf == null)
                        rf = new Reference(l);
                    rf = Lk.DatumRef(s, rf);
                    if (rf == null)
                        continue;
                    d.Levels.Add(new LevelData { Level = l, Src = s, Z = z, Ref = rf });
                    if (s != null) d.LinkedElements++;
                }
            }

            // ── Тэнхлэг: зүсэлтэд босоо шугам болж харагдах (харагдацын баруун чиглэлд перпендикуляр)
            foreach (LinkSrc s in d.Sources())
            {
                FilteredElementCollector col = d.Collect(s);
                if (col == null)
                    continue;
                foreach (Grid g in col.OfClass(typeof(Grid)).Cast<Grid>())
                {
                    if (!(g.Curve is Line l) || !d.Visible(g, s))
                        continue;
                    XYZ dir = Lk.Vec(s, l.Direction);
                    if (Math.Abs(dir.DotProduct(d.Right)) > 0.01)
                        continue;
                    V2 p = d.ToView(Lk.P(s, l.GetEndPoint(0)));
                    if (s != null && d.Grids.Any(x => Math.Abs(x.Seg.A.X - p.X) < 0.02))
                        continue;
                    Reference r = Lk.DatumRef(s, new Reference(g));
                    if (r == null)
                        continue;
                    var gn = new XYZ(-dir.Y, dir.X, 0);
                    d.Grids.Add(new GridData
                    {
                        Grid = g,
                        Src = s,
                        Seg = new Seg(p, p + new V2(0, 1)),
                        Dir = new V2(0, 1),
                        Ref = r,
                        SectionNormal = new V2(gn.DotProduct(d.Right), gn.DotProduct(v.ViewDirection)),
                    });
                    if (s != null) d.LinkedElements++;
                }
            }

            var cats = new List<BuiltInCategory>
            {
                BuiltInCategory.OST_Walls, BuiltInCategory.OST_Floors, BuiltInCategory.OST_Roofs,
                BuiltInCategory.OST_StructuralColumns, BuiltInCategory.OST_Columns, BuiltInCategory.OST_StructuralFraming,
                BuiltInCategory.OST_Doors, BuiltInCategory.OST_Windows, BuiltInCategory.OST_StructuralFoundation,
                BuiltInCategory.OST_Stairs, BuiltInCategory.OST_CurtainWallPanels,
            };
            var candidates = new List<SecOpening>();
            var walls = new List<Tuple<string, Seg, double, double>>();
            foreach (LinkSrc s in d.Sources())
            {
                FilteredElementCollector col = d.Collect(s);
                if (col == null)
                    continue;
                foreach (Element e in col.WherePasses(new ElementMulticategoryFilter(cats)).WhereElementIsNotElementType())
                {
                    if (!d.Visible(e, s))
                        continue;
                    BoundingBoxXYZ bb = e.get_BoundingBox(null);
                    if (bb == null)
                        continue;
                    double zMin = double.MaxValue, zMax = double.MinValue;
                    foreach (XYZ c in Lk.Corners(bb, s))
                    {
                        d.Building.Add(d.F, d.ToView(c));
                        zMin = Math.Min(zMin, c.Z);
                        zMax = Math.Max(zMax, c.Z);
                    }
                    long cat = e.Category?.Id.Value ?? 0;
                    if ((cat == (long)BuiltInCategory.OST_Doors || cat == (long)BuiltInCategory.OST_Windows) && e is FamilyInstance fi)
                        candidates.Add(new SecOpening { Fi = fi, Src = s });
                    else if (cat == (long)BuiltInCategory.OST_Walls && e is Wall w && w.Location is LocationCurve lc && lc.Curve != null)
                    {
                        IList<XYZ> pts = lc.Curve.Tessellate();
                        for (int i = 0; i + 1 < pts.Count; i++)
                            walls.Add(Tuple.Create(Lk.K(s, w.Id), new Seg(Lk.P2(s, pts[i]), Lk.P2(s, pts[i + 1])), zMin, zMax));
                    }
                }
            }

            // ⚠️ Фасад/зүсэлтэд FilteredElementCollector нь ХААГДСАН элементийг ч буцаадаг (фасадын ард
            // байгаа дотор хаалга, газар доорх подвалын хаалга).  Хэмжсэн: Snowdon South фасадад 295 tag
            // тавьсан.  Тиймээс нүхний төвөөс харагч руу (харагдацын хавтгай хүртэл) план дээр туяа цацаж,
            // тэр өндөрт өөр хана огтолбол «нуугдсан» гэж алгасна.
            XYZ vd = v.ViewDirection;
            var toViewer = new V2(vd.X, vd.Y);
            bool horizontalView = toViewer.Length > 0.5;
            toViewer = toViewer.Normalized();
            foreach (SecOpening so in candidates)
            {
                if (!horizontalView)
                {
                    d.SectionOpenings.Add(so);
                    continue;
                }
                BoundingBoxXYZ ob = so.Fi.get_BoundingBox(null);
                if (ob == null)
                    continue;
                List<XYZ> oc = Lk.Corners(ob, so.Src).ToList();
                XYZ c = new XYZ(oc.Average(p => p.X), oc.Average(p => p.Y), oc.Average(p => p.Z));
                double reach = (d.Origin - c).DotProduct(vd);
                if (reach < -0.1)
                    continue; // харагдацын хавтгайн өмнө — зурагт гарахгүй
                string host = so.Fi.Host is Wall hw ? Lk.K(so.Src, hw.Id) : null;
                var o2 = new V2(c.X, c.Y);
                bool hidden = false;
                foreach (Tuple<string, Seg, double, double> w in walls)
                {
                    if (w.Item1 == host || c.Z < w.Item3 || c.Z > w.Item4)
                        continue;
                    double? hit = w.Item2.Ray(o2, toViewer);
                    if (hit.HasValue && hit.Value < reach)
                    {
                        hidden = true;
                        break;
                    }
                }
                if (!hidden)
                {
                    d.SectionOpenings.Add(so);
                    if (so.Src != null) d.LinkedElements++;
                }
            }

            // Харагдацын тайрах хүрээ байвал барилгын хүрээг түүгээр хязгаарлана — хол зайд
            // харагдах газрын гадарга, хөрш барилга хэмжээсийг хэт холдуулахгүй.
            try
            {
                if (v.CropBoxActive && !d.Building.IsEmpty)
                {
                    BoundingBoxXYZ cb = v.CropBox;
                    var crop = new Box();
                    foreach (XYZ c in Corners(cb))
                        crop.Add(d.F, d.ToView(c));
                    d.Building.MinU = Math.Max(d.Building.MinU, crop.MinU);
                    d.Building.MaxU = Math.Min(d.Building.MaxU, crop.MaxU);
                    d.Building.MinV = Math.Max(d.Building.MinV, crop.MinV);
                    d.Building.MaxV = Math.Min(d.Building.MaxV, crop.MaxV);
                }
            }
            catch
            {
                // Тайрах хүрээгүй — модель хүрээгээр.
            }
        }

        // ══════════════════════════════════════════════════════════════════
        //  ОДОО БАЙГАА TAG
        // ══════════════════════════════════════════════════════════════════

        private static void ReadExistingTags(ViewData d, HashSet<long> ignore)
        {
            FilteredElementCollector col = d.Collect(null);
            if (col == null)
                return;
            foreach (IndependentTag t in col.OfClass(typeof(IndependentTag)).Cast<IndependentTag>())
            {
                if (ignore != null && ignore.Contains(t.Id.Value))
                    continue;
                try
                {
                    // Link-ийн элементийн tag ч (LinkInstanceId + LinkedElementId) — 2022+.
                    foreach (LinkElementId le in t.GetTaggedElementIds())
                    {
                        if (le.LinkInstanceId != ElementId.InvalidElementId)
                            d.Tagged.Add(Lk.K(le.LinkInstanceId.Value, le.LinkedElementId.Value));
                        else if (le.HostElementId != ElementId.InvalidElementId)
                            d.Tagged.Add(Lk.K(0, le.HostElementId.Value));
                    }
                }
                catch
                {
                    // Уншигдахгүй tag — алгасна.
                }
            }
            col = d.Collect(null);
            if (col == null)
                return;
            foreach (RoomTag rt in col.OfCategory(BuiltInCategory.OST_RoomTags).OfType<RoomTag>())
            {
                if (ignore != null && ignore.Contains(rt.Id.Value))
                    continue;
                try
                {
                    LinkElementId le = rt.TaggedRoomId;
                    if (le == null)
                        continue;
                    if (le.LinkInstanceId != ElementId.InvalidElementId)
                        d.RoomTagged.Add(Lk.K(le.LinkInstanceId.Value, le.LinkedElementId.Value));
                    else if (le.HostElementId != ElementId.InvalidElementId)
                        d.RoomTagged.Add(Lk.K(0, le.HostElementId.Value));
                }
                catch
                {
                }
            }
        }
    }
}
