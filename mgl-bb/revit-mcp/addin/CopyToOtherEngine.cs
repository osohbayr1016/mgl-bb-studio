using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using Autodesk.Revit.DB.Structure;

namespace RevitMcpAddin
{
    // ══════════════════════════════════════════════════════════════════════
    //  «Хуулж тавих» — UI-гүй цөм (v2, 2026-09-28)
    //
    //  GRAITEC PowerPack «Clone Drawings»-той харьцуулж зорьсон зүйл:
    //   • Б-д АЛЬ ХЭДИЙН БАЙГАА элементийг ашиглана (Clone Drawings-ийн үндсэн
    //     санаа — зураг л хуулагдана) ба байхгүйг нь л хуулна.  Тиймээс нэг
    //     үйлдлийг дахин ажиллуулахад ДАВХАРДАЛ үүсэхгүй.
    //   • А-д зориулсан зүсэлт / тайрсан план / dependent view-ийг Б-д шинээр
    //     үүсгэж, хуудсан дээр ижил байрлалд тавина.
    //   • Шилжүүлэх + ЭРГҮҮЛЭХ + ТОЛИН ТУСГАЛ (Clone Drawings-д байхгүй).
    //   • 2D тэмдэглэгээ (зураас, текст, штрих, detail component) хуулна —
    //     Clone Drawings «no symbols will be cloned» гэж хязгаарладаг.
    //   • Хэмжээс бүрийн утгыг эх хэмжээстэй ТУЛГАЖ, зөрвөл үүсгэхгүй.
    //
    //  Команд ч, тест харness ч (Revit дотор эх кодыг нь compile хийдэг) ЯГ энэ
    //  кодыг дуудна.  Нээлттэй Transaction дотор дуудагдах ёстой.
    // ══════════════════════════════════════════════════════════════════════

    public enum CopyPlacementKind { Move, Rotate, Mirror }

    /// <summary>
    /// Нэг байршлын хувиргалт A → B.  Зөвхөн ХЭВТЭЭ: Z хэзээ ч өөрчлөгдөхгүй
    /// (элемент түвшиндээ үлдэнэ), тиймээс эргэлтийн тэнхлэг, толин хавтгай босоо.
    /// </summary>
    public sealed class CopyPlacement
    {
        public CopyPlacementKind Kind;
        /// <summary>Бүрэн хувиргалт (толин тусгалд reflection).</summary>
        public Transform T;
        public XYZ Translation = XYZ.Zero;
        public XYZ Pivot = XYZ.Zero;
        public double Angle;
        public Plane MirrorPlane;
        /// <summary>Шинэ харагдац, хуудасны нэрэнд орох үсэг (Б, В, Г …).</summary>
        public string Letter = "Б";

        public bool IsRigid => Kind != CopyPlacementKind.Mirror;

        public static CopyPlacement Move(XYZ a, XYZ b)
        {
            XYZ t = Flat(b) - Flat(a);
            return new CopyPlacement { Kind = CopyPlacementKind.Move, Translation = t, T = Transform.CreateTranslation(t) };
        }

        /// <summary>A1→B1 шилжээд B1-ийг тойрон (A1A2 → B1B2) өнцгөөр эргэнэ.</summary>
        public static CopyPlacement Rotate(XYZ a1, XYZ a2, XYZ b1, XYZ b2)
        {
            XYZ va = Flat(a2) - Flat(a1), vb = Flat(b2) - Flat(b1);
            if (va.GetLength() < 1e-6 || vb.GetLength() < 1e-6)
                throw new ArgumentException("Хоёр цэг хэт ойрхон байна.");
            double angle = Math.Atan2(va.X * vb.Y - va.Y * vb.X, va.X * vb.X + va.Y * vb.Y);
            XYZ pa = Flat(a1), pb = Flat(b1);
            Transform t = Transform.CreateTranslation(pb)
                .Multiply(Transform.CreateRotation(XYZ.BasisZ, angle))
                .Multiply(Transform.CreateTranslation(-pa));
            return new CopyPlacement
            {
                Kind = CopyPlacementKind.Rotate, T = t, Translation = pb - pa, Pivot = pb, Angle = angle,
            };
        }

        /// <summary>P1-P2 босоо тэнхлэгийн хавтгайгаар толин тусгал.</summary>
        public static CopyPlacement Mirror(XYZ p1, XYZ p2)
        {
            XYZ d = Flat(p2) - Flat(p1);
            if (d.GetLength() < 1e-6)
                throw new ArgumentException("Тэнхлэгийн хоёр цэг хэт ойрхон байна.");
            d = d.Normalize();
            Plane plane = Plane.CreateByNormalAndOrigin(new XYZ(-d.Y, d.X, 0), Flat(p1));
            return new CopyPlacement { Kind = CopyPlacementKind.Mirror, MirrorPlane = plane, T = Transform.CreateReflection(plane) };
        }

        /// <summary>|A1A2| ба |B1B2|-ийн зөрүү (фут) — буруу цэг дарсныг барина.</summary>
        public static double LengthMismatch(XYZ a1, XYZ a2, XYZ b1, XYZ b2) =>
            Math.Abs((Flat(a2) - Flat(a1)).GetLength() - (Flat(b2) - Flat(b1)).GetLength());

        public static XYZ Flat(XYZ p) => new XYZ(p.X, p.Y, 0);
    }

    public sealed class CopyToOtherOptions
    {
        public bool Tags = true;
        public bool RoomTags = true;
        public bool Dimensions = true;
        public bool Details = true;
        public bool CloneViews = true;
        public bool CloneSheets = true;
        /// <summary>Б-д үүсгэх А-гийн харагдацууд.  null = бүгд.</summary>
        public HashSet<ElementId> ViewFilter;
    }

    /// <summary>
    /// Нэг удаагийн тоолуур.  Бүх алгасалт ТООЛОГДОНО — хэрэглэгч «юу шилжээгүй»
    /// гэдгийг мэдэж байж л гараар нөхөж чадна.
    /// </summary>
    public sealed class CopyToOtherReport
    {
        public int Targets;
        public int Copied, Reused, InsertsPlaced, NotMatched;
        public int Tags, TagsExisting, TagsSkipped;
        public int RoomTags, RoomTagsExisting, RoomTagsSkipped;
        public int Dims, DimsExisting, DimsSkipped, DimsValueMismatch;
        public int Details, DetailsSkipped;
        public int ViewsCreated, ViewsReused, SheetsCreated;
        public int WarningsHidden;
        public readonly List<string> NewViews = new List<string>();
        public readonly List<string> NewSheets = new List<string>();
        public readonly List<string> Notes = new List<string>();
        public readonly List<string> Errors = new List<string>();
        public readonly List<ElementId> CreatedModelIds = new List<ElementId>();

        public void Note(string s)
        {
            if (!Notes.Contains(s))
                Notes.Add(s);
        }

        public string Summary()
        {
            var sb = new StringBuilder();
            if (Targets > 0)
                sb.AppendLine(Targets + " байршилд хуулав.").AppendLine();
            sb.AppendLine("ЗАГВАР");
            sb.AppendLine("• Шинээр хуулсан: " + (Copied + InsertsPlaced));
            if (Reused > 0)
                sb.AppendLine("• Б-д аль хэдийн байсан (дахин хуулаагүй): " + Reused);
            if (NotMatched > 0)
                sb.AppendLine("• Тулгаж чадаагүй (тэмдэглэгээ нь дагаагүй): " + NotMatched);
            sb.AppendLine().AppendLine("ЗУРАГ");
            sb.AppendLine("• Tag: " + Tags + Tail(TagsExisting, TagsSkipped));
            sb.AppendLine("• Өрөөний tag: " + RoomTags + Tail(RoomTagsExisting, RoomTagsSkipped));
            sb.AppendLine("• Хэмжээс: " + Dims + Tail(DimsExisting, DimsSkipped));
            if (DimsValueMismatch > 0)
                sb.AppendLine("   ↳ " + DimsValueMismatch + " хэмжээс утга нь А-гаас зөрсөн тул үүсгээгүй");
            sb.AppendLine("• 2D тэмдэглэгээ (зураас, текст, штрих): " + Details + (DetailsSkipped > 0 ? "   (алгассан " + DetailsSkipped + ")" : ""));
            if (ViewsCreated + ViewsReused > 0)
            {
                sb.AppendLine("• Шинэ харагдац: " + ViewsCreated + (ViewsReused > 0 ? "   (өмнө үүссэнийг ашигласан " + ViewsReused + ")" : ""));
                foreach (string v in NewViews.Take(8))
                    sb.AppendLine("     – " + v);
                if (NewViews.Count > 8)
                    sb.AppendLine("     … +" + (NewViews.Count - 8));
            }
            if (SheetsCreated > 0)
            {
                sb.AppendLine("• Шинэ хуудас: " + SheetsCreated);
                foreach (string s in NewSheets.Take(8))
                    sb.AppendLine("     – " + s);
            }
            if (Notes.Count > 0)
            {
                sb.AppendLine().AppendLine("АНХААР");
                foreach (string n in Notes.Take(8))
                    sb.AppendLine("• " + n);
            }
            if (WarningsHidden > 0)
                sb.AppendLine().AppendLine("Revit-ийн анхааруулга (давхцал г.м.) нуусан: " + WarningsHidden);
            if (Errors.Count > 0)
                sb.AppendLine().AppendLine("Алдаа: " + string.Join("; ", Errors));
            sb.AppendLine().Append("Бүгдийг нэг Ctrl+Z-ээр буцаана.");
            return sb.ToString();
        }

        private static string Tail(int existing, int skipped)
        {
            var parts = new List<string>();
            if (existing > 0) parts.Add("байсан " + existing);
            if (skipped > 0) parts.Add("алгассан " + skipped);
            return parts.Count == 0 ? string.Empty : "   (" + string.Join(", ", parts) + ")";
        }
    }

    /// <summary>Хэрэглэгчийн сонгох А-гийн харагдац (цонхонд жагсаана).</summary>
    public sealed class CopySourceView
    {
        public ElementId Id;
        public string Label;
        public string SheetNumber;
    }

    public static class CopyToOtherEngine
    {
        /// <summary>Элементийг тулгах нарийвчлал (фут ≈ 1.5 мм).</summary>
        private const double Tol = 0.005;
        /// <summary>Хэмжээсийн утгын зөрүүний хүлцэл (≈ 1 мм).</summary>
        private const double DimTol = 0.0033;
        private const string Letters = "БВГДЕЖЗИКЛМНОПРСТУФХЦЧШЩЭЮЯ";

        public static string LetterFor(int index) =>
            index < Letters.Length ? Letters[index].ToString() : (index + 2).ToString();

        // ── Сонголт ────────────────────────────────────────────────────────

        /// <summary>Хуулж болох элемент мөн эсэх (ISelectionFilter ч үүнийг дуудна).</summary>
        public static bool IsCopyable(Element e, View activeView)
        {
            if (e == null || e is ElementType || e.Category == null)
                return false;
            if (e is IndependentTag || e is SpatialElementTag || e is Dimension)
                return false;
            if (e.ViewSpecific)
                return e.OwnerViewId == activeView.Id;
            if (e is Level || e is Grid || e is ReferencePlane || e is RevitLinkInstance || e is View)
                return false;
            long cat = e.Category.Id.Value;
            return cat != (long)BuiltInCategory.OST_Viewers
                && cat != (long)BuiltInCategory.OST_VolumeOfInterest
                && cat != (long)BuiltInCategory.OST_Cameras;
        }

        /// <summary>
        /// Сонголтыг «загварын элемент» ба «идэвхтэй харагдацын 2D» гэж хуваана.
        /// Tag, хэмжээсийг ЗОРИУД хасна — эх элементээ дагаж автоматаар дахин
        /// тавигдах тул сонголтод байвал давхар гарна.
        /// </summary>
        public static void SplitSelection(Document doc, View activeView, ICollection<ElementId> picked,
            out List<ElementId> modelIds, out List<ElementId> detailIds)
        {
            modelIds = new List<ElementId>();
            detailIds = new List<ElementId>();
            foreach (ElementId id in picked)
            {
                Element e = doc.GetElement(id);
                if (!IsCopyable(e, activeView))
                    continue;
                if (e.ViewSpecific)
                    detailIds.Add(id);
                else
                    modelIds.Add(id);
            }
        }

        // ── А-гийн харагдацууд ─────────────────────────────────────────────

        /// <summary>
        /// А-г харуулдаг, ТАЙРСАН (crop) план / зүсэлт / detail харагдацууд — Б-д
        /// шинээр үүсгэх нэр дэвшигчид.  Б-г аль хэдийн харуулдаг харагдацыг Run
        /// дотор алгасна (тэнд тэмдэглэгээ шууд тавигдана).
        /// </summary>
        public static List<CopySourceView> FindSourceViews(Document doc, ICollection<ElementId> modelIds)
        {
            var result = new List<CopySourceView>();
            List<Element> src = modelIds.Select(doc.GetElement).Where(e => e != null).ToList();
            BoundingBoxXYZ region = UnionBox(src);
            if (region == null)
                return result;
            var levels = new HashSet<ElementId>(src.Select(e => e.LevelId).Where(l => l != ElementId.InvalidElementId));
            var srcIds = new HashSet<ElementId>(modelIds);
            ElementMulticategoryFilter cats = CategoryFilter(doc, srcIds);
            Dictionary<ElementId, string> sheetOf = SheetNumbersByView(doc);

            foreach (View v in new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>())
            {
                if (v.IsTemplate || !IsCloneableType(v) || !v.CropBoxActive)
                    continue;
                if (v is ViewPlan vp && vp.GenLevel != null && levels.Count > 0 && !levels.Contains(vp.GenLevel.Id))
                    continue;
                if (!CropIntersects(v, region))
                    continue;
                if (!AnyVisible(doc, v, srcIds, cats))
                    continue;
                sheetOf.TryGetValue(v.Id, out string sheet);
                result.Add(new CopySourceView { Id = v.Id, Label = TypeLabel(v) + " — " + v.Name, SheetNumber = sheet });
            }
            return result.OrderBy(r => r.SheetNumber ?? "~").ThenBy(r => r.Label).ToList();
        }

        private static bool IsCloneableType(View v) =>
            v.ViewType == ViewType.FloorPlan || v.ViewType == ViewType.CeilingPlan
            || v.ViewType == ViewType.EngineeringPlan || v.ViewType == ViewType.AreaPlan
            || v.ViewType == ViewType.Section || v.ViewType == ViewType.Detail;

        private static string TypeLabel(View v)
        {
            switch (v.ViewType)
            {
                case ViewType.Section: return "Зүсэлт";
                case ViewType.Detail: return "Дэлгэрэнгүй";
                case ViewType.CeilingPlan: return "Таазны план";
                case ViewType.EngineeringPlan: return "Бүтээцийн план";
                case ViewType.AreaPlan: return "Талбайн план";
                default: return v.GetPrimaryViewId() != ElementId.InvalidElementId ? "План (dependent)" : "План";
            }
        }

        // ── Гол урсгал ─────────────────────────────────────────────────────

        /// <summary>Нэг байршил руу хуулна.  Тоолуурыг <paramref name="rep"/>-д нэмнэ.</summary>
        public static void Run(Document doc, View activeView, ICollection<ElementId> modelIds,
            ICollection<ElementId> detailIds, CopyPlacement p, CopyToOtherOptions opt, CopyToOtherReport rep)
        {
            var map = new Dictionary<ElementId, ElementId>();
            List<ElementId> src = WithInserts(doc, modelIds);

            if (src.Count > 0)
            {
                // 1. Б-д аль хэдийн байгаа элемент — дахин хуулахгүй.
                var srcSet = new HashSet<ElementId>(src);
                var sigs = new Dictionary<ElementId, Sig>();
                foreach (ElementId id in src)
                {
                    Sig s = Sig.Of(doc.GetElement(id));
                    if (s != null)
                        sigs[id] = s;
                }
                foreach (var kv in FindExisting(doc, sigs, p, srcSet))
                    map[kv.Key] = kv.Value;
                rep.Reused += map.Count;

                // 2. Үлдсэнийг хуулна.  Эзэн хана нь Б-д БАЙГАА хаалга/цонхыг
                //    ханатай нь хуулж болохгүй — тэр хана дээр шинээр тавина.
                var toCopy = new List<ElementId>();
                var toHost = new List<FamilyInstance>();
                foreach (ElementId id in src)
                {
                    if (map.ContainsKey(id))
                        continue;
                    if (doc.GetElement(id) is FamilyInstance fi && fi.Host != null && map.ContainsKey(fi.Host.Id))
                        toHost.Add(fi);
                    else
                        toCopy.Add(id);
                }

                if (toCopy.Count > 0)
                {
                    ICollection<ElementId> copies = TransformCopy(doc, toCopy, p, rep);
                    doc.Regenerate();
                    var copySigs = sigs.Where(kv => toCopy.Contains(kv.Key)).ToDictionary(kv => kv.Key, kv => kv.Value);
                    Dictionary<ElementId, ElementId> copied = MatchInCandidates(doc, copySigs, p, copies);
                    foreach (var kv in copied)
                        map[kv.Key] = kv.Value;
                    rep.Copied += copied.Count;
                    rep.CreatedModelIds.AddRange(copies);
                }
                foreach (FamilyInstance fi in toHost)
                {
                    ElementId placed = PlaceInsertOnHost(doc, fi, doc.GetElement(map[fi.Host.Id]), p);
                    if (placed != null)
                    {
                        map[fi.Id] = placed;
                        rep.InsertsPlaced++;
                        rep.CreatedModelIds.Add(placed);
                    }
                }
                rep.NotMatched += src.Count - map.Count;
            }
            rep.Targets++;
            doc.Regenerate();

            var targetSet = new HashSet<ElementId>(map.Values);
            var vis = new VisibilityCache(doc, targetSet.Concat(map.Keys));

            // 3. А-гийн тайрсан харагдацуудыг Б-д үүсгэнэ (Б тэнд харагдахгүй бол).
            var clones = new Dictionary<ElementId, View>();
            if (opt.CloneViews && map.Count > 0)
            {
                foreach (CopySourceView sv in FindSourceViews(doc, map.Keys.ToList()))
                {
                    if (opt.ViewFilter != null && !opt.ViewFilter.Contains(sv.Id))
                        continue;
                    View v = (View)doc.GetElement(sv.Id);
                    // А-гаас энэ харагдацад харагдаж буй БҮХ зүйлийн Б хувилбар ч харагдаж
                    // байвал (жишээ нь бүх давхрыг харуулсан план) шинээр үүсгэхгүй.  «Б-ийн
                    // ЯМАР Ч хэсэг харагдвал» гэж шалгах нь буруу: А-д тайрсан хүрээ захдаа
                    // Б-гийн багахан хэсгийг ч агуулдаг (хэмжсэн, толин тусгал).
                    List<ElementId> seen = map.Keys.Where(s => vis.Sees(v, s)).ToList();
                    if (seen.Count > 0 && seen.All(s => vis.Sees(v, map[s])))
                        continue;
                    View c = GetOrCloneView(doc, v, p, rep);
                    if (c != null)
                        clones[v.Id] = c;
                }
                if (clones.Count > 0)
                {
                    doc.Regenerate();
                    vis.Reset();
                }
            }

            // 4. Тэмдэглэгээ.
            if (map.Count > 0)
            {
                var dest = new DestResolver(doc, vis, clones);
                if (opt.Tags)
                    CloneTags(doc, map, p, dest, rep);
                if (opt.RoomTags)
                    CloneRoomTags(doc, map, p, dest, rep);
                if (opt.Dimensions)
                    CloneDimensions(doc, map, p, dest, rep);
                if (opt.Details)
                    CloneRegionDetails(doc, map, p, dest, activeView, detailIds, rep);
            }
            // Хэрэглэгчийн ИЛ сонгосон 2D нь сонголтоос үл хамааран үргэлж хуулагдана.
            if ((map.Count == 0 || !opt.Details) && detailIds.Count > 0)
                CopyDetailsSameView(doc, activeView, detailIds.ToList(), p, rep);

            // 5. Хуудас.
            if (opt.CloneSheets && clones.Count > 0)
                CloneSheets(doc, clones, p, rep);
        }

        // ── Элемент тулгах (нарийвчилсан) ─────────────────────────────────

        /// <summary>
        /// Элементийн «хувиргалтад тогтвортой» дүр.  Хана: хоёр ҮЗҮҮР (дунд цэг
        /// биш — ижил дундтай өөр урттай ханыг ялгана).  Цэгэн family: байрлал +
        /// нүүрний чиглэл.  Шал, тааз: эзлэхүүний ЖИНГИЙН ТӨВ (bounding box-ийн төв
        /// эргэлтэд хадгалагддаггүй).
        /// </summary>
        private sealed class Sig
        {
            public string Key;
            public ElementId Category;
            public ElementId Level;
            public bool IsCurve, IsRoom;
            public XYZ P0, P1, P, Facing;
            public BoundingBoxXYZ Box;

            public static Sig Of(Element e)
            {
                if (e == null || e.Category == null)
                    return null;
                var s = new Sig
                {
                    Key = e.Category.Id.Value + "|" + e.GetTypeId().Value,
                    Category = e.Category.Id,
                    Level = e.LevelId,
                    IsRoom = e is Room,
                    Box = e.get_BoundingBox(null),
                };
                try
                {
                    if (e.Location is LocationCurve lc)
                    {
                        s.IsCurve = true;
                        s.P0 = lc.Curve.GetEndPoint(0);
                        s.P1 = lc.Curve.GetEndPoint(1);
                        s.P = (s.P0 + s.P1) / 2;
                        return s;
                    }
                    if (e.Location is LocationPoint lp)
                    {
                        s.P = lp.Point;
                        if (e is FamilyInstance fi)
                            s.Facing = fi.FacingOrientation;
                        return s;
                    }
                }
                catch
                {
                    // Location уншихад унадаг элемент — жингийн төв рүү шилжинэ.
                }
                s.P = Centroid(e) ?? (s.Box == null ? null : (s.Box.Min + s.Box.Max) / 2);
                return s.P == null ? null : s;
            }

            public Sig Map(Transform t) => new Sig
            {
                Key = Key, Category = Category, Level = Level, IsCurve = IsCurve, IsRoom = IsRoom,
                P0 = P0 == null ? null : t.OfPoint(P0),
                P1 = P1 == null ? null : t.OfPoint(P1),
                P = P == null ? null : t.OfPoint(P),
                Facing = Facing == null ? null : t.OfVector(Facing),
            };

            /// <summary>Хоёр дүрийн зай (фут).  Ханын чиглэл толин тусгалд эргэдэг тул үзүүрийг дараалалгүй тулгана.</summary>
            public double Distance(Sig other)
            {
                if (IsCurve && other.IsCurve)
                {
                    double a = P0.DistanceTo(other.P0) + P1.DistanceTo(other.P1);
                    double b = P0.DistanceTo(other.P1) + P1.DistanceTo(other.P0);
                    return Math.Min(a, b) / 2;
                }
                if (IsCurve != other.IsCurve || P == null || other.P == null)
                    return double.MaxValue;
                double d = P.DistanceTo(other.P);
                // Нэг цэг дээрх хоёр family-г нүүрний чиглэлээр ялгана (зөвхөн тай-брейк).
                if (Facing != null && other.Facing != null && Facing.DotProduct(other.Facing) < 0.99)
                    d += Tol / 2;
                return d;
            }
        }

        private static XYZ Centroid(Element e)
        {
            try
            {
                GeometryElement ge = e.get_Geometry(new Options { DetailLevel = ViewDetailLevel.Coarse });
                if (ge == null)
                    return null;
                double vol = 0;
                XYZ sum = XYZ.Zero;
                foreach (Solid s in Solids(ge))
                {
                    XYZ c = s.ComputeCentroid();
                    sum += c * s.Volume;
                    vol += s.Volume;
                }
                return vol > 1e-9 ? sum / vol : null;
            }
            catch
            {
                return null;
            }
        }

        private static IEnumerable<Solid> Solids(GeometryElement ge)
        {
            foreach (GeometryObject go in ge)
            {
                if (go is Solid s && s.Volume > 1e-9)
                    yield return s;
                else if (go is GeometryInstance gi)
                {
                    foreach (Solid inner in Solids(gi.GetInstanceGeometry()))
                        yield return inner;
                }
            }
        }

        /// <summary>
        /// Б-д аль хэдийн байгаа харгалзах элемент.  Гурван түвшин: (1) ангилал +
        /// төрөл + дүр яг таарна; (2) өрөө — Б-ийн өрөө тэр цэгийг агуулна; (3) хана
        /// шиг шугаман элемент — Б-ийн урт хана тэр хэрчмийг бүрэн хамарна (секцийг
        /// дамнасан ганц хана).  Эргэлзээтэй бол ТААРСАНГҮЙ гэж үзэж хуулна —
        /// давхардал нь алга болсон тэмдэглэгээнээс илүү харагддаг.
        /// </summary>
        private static Dictionary<ElementId, ElementId> FindExisting(Document doc, Dictionary<ElementId, Sig> sigs,
            CopyPlacement p, HashSet<ElementId> exclude)
        {
            var map = new Dictionary<ElementId, ElementId>();
            var used = new HashSet<ElementId>();
            var byCategory = new Dictionary<ElementId, List<Element>>();

            List<Element> Pool(ElementId cat)
            {
                if (!byCategory.TryGetValue(cat, out List<Element> list))
                {
                    list = new FilteredElementCollector(doc).OfCategoryId(cat).WhereElementIsNotElementType()
                        .Where(e => !exclude.Contains(e.Id)).ToList();
                    byCategory[cat] = list;
                }
                return list;
            }

            foreach (var kv in sigs)
            {
                Sig want = kv.Value.Map(p.T);
                ElementId best = null, coverSameType = null, coverOtherType = null;
                double bestD = Tol;
                foreach (Element c in Pool(want.Category))
                {
                    if (used.Contains(c.Id) || !NearBox(c, want.P, 1.0))
                        continue;
                    if (want.IsRoom)
                    {
                        // Өрөөний цэгийг хэрэглэгч дурын газар дардаг тул цэгээр биш —
                        // «Б-ийн өрөө тэр цэгийг агуулна уу» гэж шалгана (шалнаас 1 фут дээш).
                        if (c is Room r && r.Area > 0 && r.IsPointInRoom(want.P + XYZ.BasisZ))
                        {
                            best = c.Id;
                            break;
                        }
                        continue;
                    }
                    Sig have = Sig.Of(c);
                    if (have == null)
                        continue;
                    if (have.Key == want.Key)
                    {
                        double d = want.Distance(have);
                        if (d < bestD) { bestD = d; best = c.Id; }
                    }
                    // Секцийг дамнасан урт хана: А-гийн хэрчмийг Б-д бүрэн хамарна.
                    if (want.IsCurve && have.IsCurve && Covers(have, want))
                    {
                        if (have.Key == want.Key) coverSameType = coverSameType ?? c.Id;
                        else coverOtherType = coverOtherType ?? c.Id;
                    }
                }
                best = best ?? coverSameType ?? coverOtherType;
                if (best != null)
                {
                    map[kv.Key] = best;
                    used.Add(best);
                }
            }
            return map;
        }

        /// <summary>Шулуун <paramref name="big"/> нь <paramref name="part"/> хэрчмийг бүрэн хамарна уу.</summary>
        private static bool Covers(Sig big, Sig part)
        {
            XYZ d = big.P1 - big.P0;
            double len = d.GetLength();
            XYZ e = part.P1 - part.P0;
            if (len < 1e-6 || e.GetLength() < 1e-6)
                return false;
            XYZ u = d / len;
            if (u.CrossProduct(e.Normalize()).GetLength() > 1e-4)
                return false;
            foreach (XYZ q in new[] { part.P0, part.P1 })
            {
                XYZ w = q - big.P0;
                double t = w.DotProduct(u);
                if (t < -Tol || t > len + Tol || (w - u * t).GetLength() > Tol)
                    return false;
            }
            return true;
        }

        private static bool NearBox(Element e, XYZ p, double margin)
        {
            if (p == null)
                return false;
            BoundingBoxXYZ b = e.get_BoundingBox(null);
            if (b == null)
                return true;
            return p.X > b.Min.X - margin && p.X < b.Max.X + margin
                && p.Y > b.Min.Y - margin && p.Y < b.Max.Y + margin
                && p.Z > b.Min.Z - margin - 50 && p.Z < b.Max.Z + margin + 50;
        }

        /// <summary>Хуулбаруудаас эх элемент бүрийн ихрийг олно.</summary>
        private static Dictionary<ElementId, ElementId> MatchInCandidates(Document doc, Dictionary<ElementId, Sig> sigs,
            CopyPlacement p, ICollection<ElementId> candidates)
        {
            var pool = new List<KeyValuePair<ElementId, Sig>>();
            foreach (ElementId c in candidates)
            {
                Sig s = Sig.Of(doc.GetElement(c));
                if (s != null)
                    pool.Add(new KeyValuePair<ElementId, Sig>(c, s));
            }
            var map = new Dictionary<ElementId, ElementId>();
            foreach (var kv in sigs)
            {
                Sig want = kv.Value.Map(p.T);
                int best = -1;
                double bestD = Tol;
                for (int i = 0; i < pool.Count; i++)
                {
                    if (pool[i].Value.Key != want.Key)
                        continue;
                    double d = want.Distance(pool[i].Value);
                    if (d < bestD) { bestD = d; best = i; }
                }
                if (best < 0)
                    continue;
                map[kv.Key] = pool[best].Key;
                pool.RemoveAt(best);
            }
            return map;
        }

        /// <summary>
        /// Хананд суусан хаалга, цонхыг ИЛ нэмнэ.  Revit ханатай нь хамт хуулдаг ч
        /// tag-ийн тулгалтад эх id нь хэрэгтэй — эс бөгөөс хаалганы tag шилжихгүй.
        /// </summary>
        private static List<ElementId> WithInserts(Document doc, ICollection<ElementId> ids)
        {
            var all = new List<ElementId>(ids);
            var seen = new HashSet<ElementId>(ids);
            foreach (ElementId id in ids)
            {
                if (!(doc.GetElement(id) is HostObject host))
                    continue;
                IList<ElementId> inserts;
                try { inserts = host.FindInserts(true, false, false, false); }
                catch { continue; }
                foreach (ElementId ins in inserts)
                {
                    if (seen.Add(ins) && doc.GetElement(ins) != null)
                        all.Add(ins);
                }
            }
            return all;
        }

        /// <summary>Шилжүүлэх / эргүүлэх / толин тусгалаар хуулж, шинэ id-г буцаана.</summary>
        private static ICollection<ElementId> TransformCopy(Document doc, List<ElementId> ids, CopyPlacement p,
            CopyToOtherReport rep)
        {
            if (p.Kind == CopyPlacementKind.Mirror)
            {
                var ok = ids.Where(id => ElementTransformUtils.CanMirrorElement(doc, id)).ToList();
                if (ok.Count < ids.Count)
                    rep.Note((ids.Count - ok.Count) + " элементийг Revit толин тусгалаар хуулж чадахгүй — алгассан.");
                return ok.Count == 0 ? new List<ElementId>() : ElementTransformUtils.MirrorElements(doc, ok, p.MirrorPlane, true);
            }

            ICollection<ElementId> copies = ElementTransformUtils.CopyElements(doc, ids, p.Translation);
            if (p.Kind == CopyPlacementKind.Rotate && Math.Abs(p.Angle) > 1e-9 && copies.Count > 0)
            {
                Line axis = Line.CreateUnbound(p.Pivot, XYZ.BasisZ);
                try
                {
                    ElementTransformUtils.RotateElements(doc, copies, axis, p.Angle);
                }
                catch
                {
                    // Бүгдийг нэг дор эргүүлж чадахгүй бол нэг бүрчлэн (эргэхгүй нь тулгалтад
                    // таарахгүй → «тулгаж чадаагүй» гэж тоологдоно).
                    foreach (ElementId id in copies)
                    {
                        try { ElementTransformUtils.RotateElement(doc, id, axis, p.Angle); }
                        catch { /* доор тоологдоно */ }
                    }
                }
            }
            return copies;
        }

        /// <summary>Б-д байгаа хана дээр хаалга/цонхыг ижил төрөл, байрлал, эргэлттэй тавина.</summary>
        private static ElementId PlaceInsertOnHost(Document doc, FamilyInstance src, Element host, CopyPlacement p)
        {
            try
            {
                if (!(src.Location is LocationPoint lp))
                    return null;
                Level level = doc.GetElement(src.LevelId) as Level;
                FamilyInstance ni = doc.Create.NewFamilyInstance(p.T.OfPoint(lp.Point), src.Symbol, host, level, StructuralType.NonStructural);
                doc.Regenerate();
                if (ni.CanFlipFacing && ni.FacingOrientation.DotProduct(p.T.OfVector(src.FacingOrientation)) < 0)
                    ni.flipFacing();
                if (ni.CanFlipHand && ni.HandOrientation.DotProduct(p.T.OfVector(src.HandOrientation)) < 0)
                    ni.flipHand();
                Parameter sill = src.get_Parameter(BuiltInParameter.INSTANCE_SILL_HEIGHT_PARAM);
                Parameter nsill = ni.get_Parameter(BuiltInParameter.INSTANCE_SILL_HEIGHT_PARAM);
                if (sill != null && nsill != null && !nsill.IsReadOnly)
                    nsill.Set(sill.AsDouble());
                return ni.Id;
            }
            catch
            {
                return null;
            }
        }

        // ── Харагдац ───────────────────────────────────────────────────────

        /// <summary>
        /// А-гийн харагдацын Б хувилбар.  Аль хэдийн үүссэн (ижил төрөл, ижил тайрах
        /// хүрээ) байвал түүнийг ашиглана — дахин ажиллуулахад давхардахгүй.
        /// </summary>
        private static View GetOrCloneView(Document doc, View v, CopyPlacement p, CopyToOtherReport rep)
        {
            using (var st = new SubTransaction(doc))
            {
                st.Start();
                try
                {
                    View result;
                    if (v is ViewSection)
                        result = CloneSection(doc, v, p, rep);
                    else if (v is ViewPlan)
                        result = ClonePlan(doc, v, p, rep);
                    else
                        result = null;
                    if (result == null)
                    {
                        st.RollBack();
                        return null;
                    }
                    st.Commit();
                    return result;
                }
                catch (Exception ex)
                {
                    st.RollBack();
                    rep.Note("«" + v.Name + "» харагдацыг Б-д үүсгэж чадсангүй: " + ex.Message);
                    return null;
                }
            }
        }

        /// <summary>
        /// Зүсэлтийн Б хувилбар.  ⚠️ CropBox-ыг шууд хувиргаж CreateSection-д өгч
        /// БОЛОХГҮЙ: Revit хадгалсан хүрээгээ өөр тэнхлэгээр илэрхийлдэг тул тийм box
        /// харах чиглэлийг ЭСРЭГ болгодог (хэмжсэн, Revit 2027).  CreateSection-ийн
        /// оролтын тэнхлэг = (−Right, Up, −ViewDirection), төв нь хүрээний төв — энэ нь
        /// А-г яг давтдаг нь туршилтаар батлагдсан.
        /// </summary>
        private static View CloneSection(Document doc, View v, CopyPlacement p, CopyToOtherReport rep)
        {
            SectionFrame want = SectionFrame.Of(v).Map(p);

            // Аль хэдийн үүссэн үү? (ижил төрөл, чиглэл, төв, хэмжээ)
            foreach (ViewSection e in new FilteredElementCollector(doc).OfClass(typeof(ViewSection)).Cast<ViewSection>())
            {
                if (e.Id == v.Id || e.IsTemplate || e.ViewType != v.ViewType || e.GetTypeId() != v.GetTypeId())
                    continue;
                if (SectionFrame.Of(e).SameAs(want))
                {
                    rep.ViewsReused++;
                    return e;
                }
            }

            Transform nt = Transform.Identity;
            nt.Origin = want.Center;
            nt.BasisX = -want.Right;
            nt.BasisY = want.Up;
            nt.BasisZ = -want.View;
            var nb = new BoundingBoxXYZ { Transform = nt, Min = -want.Half, Max = want.Half };
            var vft = doc.GetElement(v.GetTypeId()) as ViewFamilyType;
            ViewSection ns = vft != null && vft.ViewFamily == ViewFamily.Detail
                ? ViewSection.CreateDetail(doc, v.GetTypeId(), nb)
                : ViewSection.CreateSection(doc, v.GetTypeId(), nb);
            CopyViewSettings(v, ns);
            ns.Name = UniqueViewName(doc, NameFor(v.Name, p.Letter));
            rep.ViewsCreated++;
            rep.NewViews.Add(ns.Name);
            return ns;
        }

        /// <summary>Зүсэлтийн хүрээ харагдацын чиглэлээр (Revit-ийн дотоод илэрхийллээс үл хамаарна).</summary>
        private sealed class SectionFrame
        {
            public XYZ Center, Right, Up, View, Half;

            public static SectionFrame Of(View v)
            {
                BoundingBoxXYZ cb = v.CropBox;
                Transform ct = cb.Transform;
                XYZ size = cb.Max - cb.Min;
                return new SectionFrame
                {
                    Center = ct.OfPoint((cb.Min + cb.Max) / 2),
                    Right = v.RightDirection,
                    Up = v.UpDirection,
                    View = v.ViewDirection,
                    Half = new XYZ(Math.Abs(size.X) / 2, Math.Abs(size.Y) / 2, Math.Abs(size.Z) / 2),
                };
            }

            /// <summary>
            /// Толин тусгал зүүн гарын систем үүсгэдэг тул Right-ыг урвуулж (Right × Up = View)
            /// баруун гарынх болгоно — зураг нь А-гийн толин дүр болно (бодит байдалтай ижил).
            /// </summary>
            public SectionFrame Map(CopyPlacement p) => new SectionFrame
            {
                Center = p.T.OfPoint(Center),
                Right = p.IsRigid ? p.T.OfVector(Right) : -p.T.OfVector(Right),
                Up = p.T.OfVector(Up),
                View = p.T.OfVector(View),
                Half = Half,
            };

            public bool SameAs(SectionFrame o) =>
                Center.IsAlmostEqualTo(o.Center, 0.02) && View.IsAlmostEqualTo(o.View) && Right.IsAlmostEqualTo(o.Right)
                && Half.IsAlmostEqualTo(o.Half, 0.02);
        }

        private static View ClonePlan(Document doc, View v, CopyPlacement p, CopyToOtherReport rep)
        {
            ElementId primary = v.GetPrimaryViewId();
            BoundingBoxXYZ box = v.CropBox;
            BoundingBoxXYZ want = TransformedPlanCrop(box, p.T);
            ViewCropRegionShapeManager shp = v.GetCropRegionShapeManager();
            IList<CurveLoop> shape = shp != null && shp.ShapeSet ? shp.GetCropShape() : null;

            // Аль хэдийн үүссэн үү? (ижил эх / ижил түвшин, ижил тайрах хүрээ)
            foreach (ViewPlan e in new FilteredElementCollector(doc).OfClass(typeof(ViewPlan)).Cast<ViewPlan>())
            {
                if (e.Id == v.Id || e.IsTemplate || e.ViewType != v.ViewType || !e.CropBoxActive
                    || e.ViewTemplateId != v.ViewTemplateId || e.Scale != v.Scale)
                    continue;
                if (primary != ElementId.InvalidElementId ? e.GetPrimaryViewId() != primary
                    : (e.GetPrimaryViewId() != ElementId.InvalidElementId || e.GenLevel?.Id != (v as ViewPlan)?.GenLevel?.Id))
                    continue;
                BoundingBoxXYZ eb = e.CropBox;
                if (eb.Min.IsAlmostEqualTo(want.Min, 0.05) && eb.Max.IsAlmostEqualTo(want.Max, 0.05))
                {
                    rep.ViewsReused++;
                    return e;
                }
            }

            ElementId newId;
            if (primary != ElementId.InvalidElementId)
                newId = ((View)doc.GetElement(primary)).Duplicate(ViewDuplicateOption.AsDependent);
            else
                newId = v.Duplicate(ViewDuplicateOption.Duplicate);
            var nv = (View)doc.GetElement(newId);
            nv.CropBoxActive = true;
            nv.CropBox = want;
            nv.CropBoxVisible = v.CropBoxVisible;
            if (shape != null && shape.Count > 0 && p.IsRigid)
            {
                try
                {
                    nv.GetCropRegionShapeManager().SetCropShape(CurveLoop.CreateViaTransform(shape[0], p.T));
                }
                catch
                {
                    rep.Note("«" + v.Name + "»-ийн тайрах хүрээний хэлбэрийг тэгш өнцөгт болгосон.");
                }
            }
            nv.Name = UniqueViewName(doc, NameFor(v.Name, p.Letter));
            rep.ViewsCreated++;
            rep.NewViews.Add(nv.Name);
            return nv;
        }

        /// <summary>
        /// Планы тайрах хүрээг хувиргана.  Хүрээ нь харагдацын тэнхлэгт зэрэгцээ байх
        /// ёстой тул эргүүлсэн булангуудыг хамарсан хамгийн бага тэгш өнцөгт авна
        /// (90°-ын үржвэр эргэлтэд яг таарна).
        /// </summary>
        private static BoundingBoxXYZ TransformedPlanCrop(BoundingBoxXYZ box, Transform t)
        {
            Transform ct = box.Transform;
            Transform inv = ct.Inverse;
            double minX = double.MaxValue, minY = double.MaxValue, maxX = double.MinValue, maxY = double.MinValue;
            foreach (XYZ c in new[]
            {
                new XYZ(box.Min.X, box.Min.Y, box.Min.Z), new XYZ(box.Max.X, box.Min.Y, box.Min.Z),
                new XYZ(box.Max.X, box.Max.Y, box.Min.Z), new XYZ(box.Min.X, box.Max.Y, box.Min.Z),
            })
            {
                XYZ q = inv.OfPoint(t.OfPoint(ct.OfPoint(c)));
                minX = Math.Min(minX, q.X); minY = Math.Min(minY, q.Y);
                maxX = Math.Max(maxX, q.X); maxY = Math.Max(maxY, q.Y);
            }
            return new BoundingBoxXYZ
            {
                Transform = ct,
                Min = new XYZ(minX, minY, box.Min.Z),
                Max = new XYZ(maxX, maxY, box.Max.Z),
            };
        }

        private static void CopyViewSettings(View src, View dst)
        {
            try { dst.ViewTemplateId = src.ViewTemplateId; } catch { }
            try { if (dst.Scale != src.Scale) dst.Scale = src.Scale; } catch { }
            try { dst.DetailLevel = src.DetailLevel; } catch { }
            foreach (BuiltInParameter bip in new[] { BuiltInParameter.VIEWER_BOUND_FAR_CLIPPING, BuiltInParameter.VIEWER_BOUND_OFFSET_FAR })
            {
                try
                {
                    Parameter a = src.get_Parameter(bip), b = dst.get_Parameter(bip);
                    if (a == null || b == null || b.IsReadOnly)
                        continue;
                    if (a.StorageType == StorageType.Integer) b.Set(a.AsInteger());
                    else if (a.StorageType == StorageType.Double) b.Set(a.AsDouble());
                }
                catch { }
            }
        }

        /// <summary>
        /// «… А секц …» → «… Б секц …».  Секцийн үсэг олдохгүй бол ард нь « (Б)».
        /// Кирилл А ба латин A хоёуланг таньна (хоёулаа нэрэнд тааралддаг).
        /// </summary>
        public static string NameFor(string name, string letter)
        {
            const string word = @"(?i:секц|section|блок|block|хэсэг)";
            // Эх нэрэнд ЛАТИН A байвал латин үсгээр (Section A → Section B) — кирилл Б
            // англи нэрэнд харь харагдана.
            string Pick(string matched) => matched == "A" ? LatinFor(letter) : letter;
            var before = new Regex(@"(?<![\p{L}\p{N}])[АA](?=[\s\-_]*" + word + ")");
            if (before.IsMatch(name))
                return before.Replace(name, m => Pick(m.Value), 1);
            var after = new Regex("(" + word + @"[\s\-_]*)([АA])(?![\p{L}\p{N}])");
            if (after.IsMatch(name))
                return after.Replace(name, m => m.Groups[1].Value + Pick(m.Groups[2].Value), 1);
            return name + " (" + letter + ")";
        }

        /// <summary>Б→B, В→C, Г→D … (дарааллаар нь).</summary>
        private static string LatinFor(string letter)
        {
            int i = Letters.IndexOf(letter, StringComparison.Ordinal);
            return i >= 0 && i < 25 ? ((char)('B' + i)).ToString() : letter;
        }

        private static string UniqueViewName(Document doc, string name)
        {
            var names = new HashSet<string>(new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>().Select(x => x.Name));
            string n = name;
            for (int i = 2; names.Contains(n); i++)
                n = name + " " + i;
            return n;
        }

        // ── Тэмдэглэгээ хаана очих вэ ─────────────────────────────────────

        /// <summary>
        /// А-гийн харагдац дахь тэмдэглэгээ Б-д хаана тавигдах: Б тэр харагдацад
        /// харагдвал яг тэнд, үгүй бол Б-д зориулж үүсгэсэн харагдацад.
        /// </summary>
        private sealed class DestResolver
        {
            private readonly Document _doc;
            private readonly VisibilityCache _vis;
            private readonly Dictionary<ElementId, View> _clones;

            public DestResolver(Document doc, VisibilityCache vis, Dictionary<ElementId, View> clones)
            {
                _doc = doc; _vis = vis; _clones = clones;
            }

            public View For(ElementId sourceViewId, IEnumerable<ElementId> targets)
            {
                var v = _doc.GetElement(sourceViewId) as View;
                if (v == null || v.IsTemplate)
                    return null;
                List<ElementId> ts = targets.ToList();
                if (ts.All(t => _vis.Sees(v, t)))
                    return v;
                if (_clones.TryGetValue(v.Id, out View c) && ts.All(t => _vis.Sees(c, t)))
                    return c;
                return null;
            }

            public bool SeesAny(View v, IEnumerable<ElementId> ids) => ids.Any(id => _vis.Sees(v, id));
        }

        // ── Tag ────────────────────────────────────────────────────────────

        private static void CloneTags(Document doc, Dictionary<ElementId, ElementId> map, CopyPlacement p,
            DestResolver dest, CopyToOtherReport rep)
        {
            List<IndependentTag> tags = new FilteredElementCollector(doc)
                .OfClass(typeof(IndependentTag)).Cast<IndependentTag>().ToList();
            var existing = new Dictionary<ElementId, HashSet<string>>();

            foreach (IndependentTag tag in tags)
            {
                List<ElementId> tagged;
                try { tagged = tag.GetTaggedLocalElementIds().ToList(); }
                catch { continue; }
                if (tagged.Count == 0 || !tagged.Any(map.ContainsKey))
                    continue;
                if (!tagged.All(map.ContainsKey))
                {
                    rep.TagsSkipped++;
                    continue;
                }
                List<ElementId> targets = tagged.Select(t => map[t]).ToList();
                View d = dest.For(tag.OwnerViewId, targets);
                if (d == null)
                {
                    rep.TagsSkipped++;
                    continue;
                }

                // Б дээр ижил төрлийн tag аль хэдийн байвал давхарлахгүй.
                if (!existing.TryGetValue(d.Id, out HashSet<string> have))
                {
                    have = new HashSet<string>();
                    foreach (IndependentTag x in tags.Where(x => x.OwnerViewId == d.Id))
                    {
                        try { foreach (ElementId id in x.GetTaggedLocalElementIds()) have.Add(x.GetTypeId().Value + "|" + id.Value); }
                        catch { }
                    }
                    existing[d.Id] = have;
                }
                string key = tag.GetTypeId().Value + "|" + targets[0].Value;
                if (have.Contains(key))
                {
                    rep.TagsExisting++;
                    continue;
                }

                using (var st = new SubTransaction(doc))
                {
                    st.Start();
                    try
                    {
                        IndependentTag nt = IndependentTag.Create(doc, tag.GetTypeId(), d.Id,
                            new Reference(doc.GetElement(targets[0])), tag.HasLeader, tag.TagOrientation,
                            p.T.OfPoint(tag.TagHeadPosition));
                        if (targets.Count > 1)
                            nt.AddReferences(targets.Skip(1).Select(t => new Reference(doc.GetElement(t))).ToList());
                        CopyLeader(tag, nt, p);
                        st.Commit();
                        have.Add(key);
                        rep.Tags++;
                    }
                    catch
                    {
                        st.RollBack();
                        rep.TagsSkipped++;
                    }
                }
            }
        }

        private static void CopyLeader(IndependentTag src, IndependentTag dst, CopyPlacement p)
        {
            if (!src.HasLeader)
                return;
            try
            {
                dst.LeaderEndCondition = src.LeaderEndCondition;
                Reference sr = src.GetTaggedReferences().FirstOrDefault();
                Reference dr = dst.GetTaggedReferences().FirstOrDefault();
                if (sr == null || dr == null)
                    return;
                if (src.LeaderEndCondition == LeaderEndCondition.Free)
                    dst.SetLeaderEnd(dr, p.T.OfPoint(src.GetLeaderEnd(sr)));
                if (src.HasLeaderElbow(sr))
                    dst.SetLeaderElbow(dr, p.T.OfPoint(src.GetLeaderElbow(sr)));
            }
            catch
            {
                // Зөвхөн хэлбэр — tag өөрөө зөв элемент дээр аль хэдийн үүссэн.
            }
        }

        private static void CloneRoomTags(Document doc, Dictionary<ElementId, ElementId> map, CopyPlacement p,
            DestResolver dest, CopyToOtherReport rep)
        {
            List<RoomTag> tags = new FilteredElementCollector(doc)
                .OfCategory(BuiltInCategory.OST_RoomTags).WhereElementIsNotElementType()
                .OfType<RoomTag>().ToList();
            foreach (RoomTag rt in tags)
            {
                if (!map.TryGetValue(rt.TaggedLocalRoomId, out ElementId dstRoom))
                    continue;
                // NewRoomTag-ийн UV нь зөвхөн план дээр XY гэдэг нь тодорхой.
                if (!(dest.For(rt.OwnerViewId, new[] { dstRoom }) is ViewPlan v))
                {
                    rep.RoomTagsSkipped++;
                    continue;
                }
                if (tags.Any(x => x.OwnerViewId == v.Id && x.TaggedLocalRoomId == dstRoom))
                {
                    rep.RoomTagsExisting++;
                    continue;
                }

                using (var st = new SubTransaction(doc))
                {
                    st.Start();
                    try
                    {
                        XYZ at = p.T.OfPoint((rt.Location as LocationPoint)?.Point ?? rt.TagHeadPosition);
                        RoomTag nt = doc.Create.NewRoomTag(new LinkElementId(dstRoom), new UV(at.X, at.Y), v.Id);
                        if (nt.GetTypeId() != rt.GetTypeId())
                            nt.ChangeTypeId(rt.GetTypeId());
                        if (rt.HasLeader)
                        {
                            nt.HasLeader = true;
                            nt.TagHeadPosition = p.T.OfPoint(rt.TagHeadPosition);
                        }
                        st.Commit();
                        rep.RoomTags++;
                    }
                    catch
                    {
                        st.RollBack();
                        rep.RoomTagsSkipped++;
                    }
                }
            }
        }

        // ── Хэмжээс ────────────────────────────────────────────────────────

        private static void CloneDimensions(Document doc, Dictionary<ElementId, ElementId> map, CopyPlacement p,
            DestResolver dest, CopyToOtherReport rep)
        {
            // ⚠️ Зөвхөн OST_Dimensions.  Sketch-ийн түгжээ (OST_Constraints) ч Dimension
            // анги бөгөөд харагдацгүй, утга нь 0 — тэднийг «алгассан» гэж тоолвол тайлан худал болно.
            List<Dimension> dims = new FilteredElementCollector(doc)
                .OfCategory(BuiltInCategory.OST_Dimensions).WhereElementIsNotElementType()
                .OfType<Dimension>()
                .Where(d => !(d is SpotDimension))
                .ToList();
            List<Grid> grids = null;

            foreach (Dimension d in dims)
            {
                ReferenceArray refs;
                try { refs = d.References; }
                catch { continue; }
                if (refs == null || refs.Size < 2 || d.DimensionShape != DimensionShape.Linear)
                    continue;
                if (!refs.Cast<Reference>().Any(r => r != null && map.ContainsKey(r.ElementId)))
                    continue;

                Line line = d.Curve as Line;
                if (line == null)
                {
                    rep.DimsSkipped++;
                    continue;
                }

                var mapped = new ReferenceArray();
                var targets = new List<ElementId>();
                bool ok = true;
                foreach (Reference r in refs)
                {
                    Reference nr = MapReference(doc, r, map, p, ref grids);
                    if (nr == null)
                    {
                        ok = false;
                        break;
                    }
                    if (map.TryGetValue(r.ElementId, out ElementId to))
                        targets.Add(to);
                    mapped.Append(nr);
                }
                View v = ok ? dest.For(d.OwnerViewId, targets) : null;
                if (v == null)
                {
                    rep.DimsSkipped++;
                    continue;
                }

                List<double> want = SegmentValues(d);
                if (HasEquivalentDimension(doc, v, mapped, want))
                {
                    rep.DimsExisting++;
                    continue;
                }

                using (var st = new SubTransaction(doc))
                {
                    st.Start();
                    try
                    {
                        // Хэмжээсийн шугам нь хязгааргүй — байрлал, чиглэл л хэрэгтэй.
                        XYZ o = p.T.OfPoint(line.Origin);
                        Dimension nd = doc.Create.NewDimension(v, Line.CreateBound(o, o + p.T.OfVector(line.Direction)),
                            mapped, d.DimensionType);
                        doc.Regenerate();

                        // НАРИЙВЧЛАЛЫН ХААЛГА: хатуу хувиргалт зайг хадгалдаг тул утга нь
                        // А-гийнхтай ЯГ тэнцүү байх ёстой.  Зөрвөл буруу нүүр рүү холбогдсон
                        // гэсэн үг — ийм хэмжээсийг зурагт үлдээхгүй.
                        List<double> got = SegmentValues(nd);
                        if (!SameValues(want, got))
                        {
                            st.RollBack();
                            rep.DimsValueMismatch++;
                            rep.DimsSkipped++;
                            continue;
                        }
                        CopyDimensionText(d, nd, p.IsRigid);
                        st.Commit();
                        rep.Dims++;
                    }
                    catch
                    {
                        if (st.HasStarted() && !st.HasEnded())
                            st.RollBack();
                        rep.DimsSkipped++;
                    }
                }
            }
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

        /// <summary>Сегментийн утгуудыг дараалалгүй тулгана (толин тусгал дарааллыг урвуулна).</summary>
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

        private static bool HasEquivalentDimension(Document doc, View v, ReferenceArray refs, List<double> values)
        {
            var ids = new HashSet<long>(refs.Cast<Reference>().Select(r => r.ElementId.Value));
            foreach (Dimension x in new FilteredElementCollector(doc, v.Id).OwnedByView(v.Id)
                         .OfClass(typeof(Dimension)).Cast<Dimension>())
            {
                if (x is SpotDimension)
                    continue;
                try
                {
                    var xs = new HashSet<long>(x.References.Cast<Reference>().Select(r => r.ElementId.Value));
                    if (xs.SetEquals(ids) && SameValues(values, SegmentValues(x)))
                        return true;
                }
                catch { }
            }
            return false;
        }

        private static void CopyDimensionText(Dimension src, Dimension dst, bool sameOrder)
        {
            try
            {
                if (src.NumberOfSegments <= 1)
                {
                    dst.Prefix = src.Prefix;
                    dst.Suffix = src.Suffix;
                    dst.Above = src.Above;
                    dst.Below = src.Below;
                    if (!string.IsNullOrEmpty(src.ValueOverride))
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
                    if (!string.IsNullOrEmpty(a.ValueOverride))
                        b.ValueOverride = a.ValueOverride;
                }
            }
            catch
            {
                // Бичвэрийн дарж бичилт — хэмжээс өөрөө зөв үүссэн тул алдааг залгина.
            }
        }

        /// <summary>
        /// Хэмжээсийн нэг холбоосыг Б руу шилжүүлнэ.  Хуулсан элемент → хуулбарынх нь
        /// ижил нүүр (stable representation-ийн UniqueId-г солиод дахин задлана);
        /// тэнхлэг → хувиргалтын дагуу таарах тэнхлэг; түвшин → хэвээр.  Бусад (өөр
        /// элемент, туслах хавтгай, link) → null, хэмжээс бүхэлдээ алгасагдана.
        /// </summary>
        private static Reference MapReference(Document doc, Reference r, Dictionary<ElementId, ElementId> map,
            CopyPlacement p, ref List<Grid> grids)
        {
            if (r == null || r.LinkedElementId != ElementId.InvalidElementId)
                return null;

            ElementId from = r.ElementId;
            if (!map.TryGetValue(from, out ElementId to))
            {
                Element e = doc.GetElement(from);
                if (e is Level)
                    return r;
                if (!(e is Grid g))
                    return null;
                Grid shifted = FindShiftedGrid(doc, g, p, ref grids);
                // ⚠️ Тэнхлэгт stable representation-ийг солих аргыг ХЭРЭГЛЭХГҮЙ: задалсан
                // «uid:0:SURFACE» лавлагааг NewDimension «Invalid number of references»
                // гэж татгалздаг (Revit 2027 дээр хэмжсэн, 2026-09-28).  Шууд лавлагаа ажилладаг.
                return shifted == null ? null : new Reference(shifted);
            }

            // 1-р арга: ГЕОМЕТРЭЭР — А-гийн нүүрний хавтгайг хувиргаж Б-ийн элементийн
            // ижил хавтгайтай, ижил чигтэй нүүрийг олно.  Толин тусгалд нүүрний дугаар
            // солигддог, Б-д байсан урт хананд дугаар огт өөр — тиймээс энэ нь үндсэн зам.
            // Family-ийн лавлагаа (reference plane) геометрийн нүүр биш тул 2-р арга руу.
            Element se = doc.GetElement(from), de = doc.GetElement(to);
            if (!(se is FamilyInstance))
            {
                Reference g = MapFaceByGeometry(se, r, de, p);
                if (g != null)
                    return g;
            }

            // 2-р арга: stable representation-ийн UniqueId-г солих (ижил элементийн хуулбарт).
            try
            {
                string oldUid = doc.GetElement(from).UniqueId;
                string newUid = doc.GetElement(to).UniqueId;
                string s = r.ConvertToStableRepresentation(doc);
                int at = s.IndexOf(oldUid, StringComparison.Ordinal);
                if (at < 0)
                    return null;
                s = s.Substring(0, at) + newUid + s.Substring(at + oldUid.Length);
                return Reference.ParseFromStableRepresentation(doc, s);
            }
            catch
            {
                return null;
            }
        }

        private static Reference MapFaceByGeometry(Element src, Reference r, Element dst, CopyPlacement p)
        {
            try
            {
                if (!(src.GetGeometryObjectFromReference(r) is PlanarFace pf))
                    return null;
                XYZ n = p.T.OfVector(pf.FaceNormal).Normalize();
                XYZ o = p.T.OfPoint(pf.Origin);
                Reference best = null;
                double bestScore = double.MaxValue;
                GeometryElement ge = dst.get_Geometry(new Options { ComputeReferences = true, DetailLevel = ViewDetailLevel.Fine });
                if (ge == null)
                    return null;
                foreach (Solid s in Solids(ge))
                {
                    foreach (Face f in s.Faces)
                    {
                        if (!(f is PlanarFace q) || q.Reference == null || !q.FaceNormal.IsAlmostEqualTo(n, 1e-6))
                            continue;
                        if (Math.Abs((q.Origin - o).DotProduct(n)) > Tol)
                            continue;
                        // Ижил хавтгайд хэд хэдэн нүүр байвал талбай нь хамгийн ойрыг.
                        double score = Math.Abs(q.Area - pf.Area);
                        if (score < bestScore) { bestScore = score; best = q.Reference; }
                    }
                }
                return best;
            }
            catch
            {
                return null;
            }
        }

        /// <summary>А-гийн тэнхлэгийг хувиргахад давхцах тэнхлэг (Б-ийнх, эсвэл өөрөө).</summary>
        private static Grid FindShiftedGrid(Document doc, Grid g, CopyPlacement p, ref List<Grid> grids)
        {
            if (grids == null)
                grids = new FilteredElementCollector(doc).OfClass(typeof(Grid)).Cast<Grid>().ToList();
            if (!(g.Curve is Line gl))
                return null;
            XYZ q = p.T.OfPoint(gl.Evaluate(0.5, true));
            XYZ dir = p.T.OfVector(gl.Direction);
            foreach (Grid c in grids)
            {
                if (!(c.Curve is Line cl))
                    continue;
                if (cl.Direction.CrossProduct(dir).GetLength() > 1e-6)
                    continue;
                XYZ w = q - cl.GetEndPoint(0);
                if ((w - cl.Direction * w.DotProduct(cl.Direction)).GetLength() < Tol)
                    return c;
            }
            return null;
        }

        // ── 2D тэмдэглэгээ (зураас, текст, штрих, detail component) ────────

        /// <summary>
        /// А-гийн бүсэд БҮРЭН багтсан 2D элементийг Б-д хуулна.  GRAITEC «symbol
        /// хуулахгүй» гэдэг; бид хуулна.  Хэрэглэгчийн ил сонгосон 2D ч энд орно.
        /// </summary>
        private static void CloneRegionDetails(Document doc, Dictionary<ElementId, ElementId> map, CopyPlacement p,
            DestResolver dest, View activeView, ICollection<ElementId> explicitIds, CopyToOtherReport rep)
        {
            BoundingBoxXYZ region = UnionBox(map.Keys.Select(doc.GetElement).Where(e => e != null).ToList());
            if (region == null)
                return;
            ElementId sample = map.Values.First();

            var byView = new Dictionary<ElementId, List<ElementId>>();
            foreach (Element e in new FilteredElementCollector(doc).WhereElementIsNotElementType()
                         .WherePasses(new ElementMulticlassFilter(new List<Type>
                             { typeof(TextNote), typeof(CurveElement), typeof(FilledRegion), typeof(FamilyInstance) })))
            {
                if (!e.ViewSpecific || e.OwnerViewId == ElementId.InvalidElementId || !IsDetailLike(e))
                    continue;
                bool isExplicit = explicitIds.Contains(e.Id);
                if (!isExplicit)
                {
                    var ov = doc.GetElement(e.OwnerViewId) as View;
                    BoundingBoxXYZ b = ov == null ? null : e.get_BoundingBox(ov);
                    if (b == null || !InsideInView(ov, b, region, 1.0))
                        continue;
                }
                if (!byView.TryGetValue(e.OwnerViewId, out List<ElementId> list))
                    byView[e.OwnerViewId] = list = new List<ElementId>();
                list.Add(e.Id);
            }

            foreach (var kv in byView)
            {
                var v = doc.GetElement(kv.Key) as View;
                if (v == null || v is ViewSheet)
                    continue;
                // ⚠️ Хавтгай дээрх шалгалт гүнийг үл тоодог тул А-г ОГТ харахгүй зүсэлтийн
                // (өөр хэсгийг огтолсон, ижил X мужтай) зураас ч «А-гийн бүсэд» орж ирдэг
                // (хэмжсэн).  Эзэн харагдац нь А-гийн ядаж нэг элементийг харуулах ёстой.
                if (!explicitIds.Contains(kv.Value[0]) && !dest.SeesAny(v, map.Keys))
                    continue;
                View d = dest.For(kv.Key, new[] { sample });
                if (d == null)
                {
                    rep.DetailsSkipped += kv.Value.Count;
                    rep.Note("«" + v.Name + "» харагдацын " + kv.Value.Count
                        + " 2D тэмдэглэгээ: Б тэнд харагдахгүй, Б-д зориулсан харагдац ч үүсээгүй.");
                    continue;
                }
                List<ElementId> ids = kv.Value.Where(id => !DetailExists(doc, doc.GetElement(id), d, p)).ToList();
                if (ids.Count == 0)
                    continue;
                if (d.Id == v.Id)
                    CopyDetailsSameView(doc, v, ids, p, rep);
                else
                    CopyDetailsToView(doc, v, d, ids, p, rep);
            }
        }

        /// <summary>
        /// Хуулах 2D-ийн цагаан жагсаалт.  ⚠️ Зураасыг зөвхөн OST_Lines ангилалтай бол
        /// авна: штрих / хүрээний «sketch line»-ууд ч view-specific CurveElement байдаг ба
        /// тэднийг тусад нь хуулбал эвдэрсэн хүрээ үлдэнэ.
        /// </summary>
        private static bool IsDetailLike(Element e)
        {
            long cat = e.Category?.Id.Value ?? 0;
            if (e is TextNote || e is FilledRegion)
                return true;
            if (e is CurveElement)
                return cat == (long)BuiltInCategory.OST_Lines;
            if (e is FamilyInstance)
                return cat == (long)BuiltInCategory.OST_DetailComponents || cat == (long)BuiltInCategory.OST_GenericAnnotation;
            return false;
        }

        /// <summary>OfClass нь DetailLine гэх мэт дэд ангийг хүлээж авдаггүй — суурь ангиар шүүнэ.</summary>
        private static Type FilterClassOf(Element e) =>
            e is TextNote ? typeof(TextNote)
            : e is FilledRegion ? typeof(FilledRegion)
            : e is CurveElement ? typeof(CurveElement)
            : typeof(FamilyInstance);

        private static bool DetailExists(Document doc, Element e, View d, CopyPlacement p)
        {
            BoundingBoxXYZ b = e.get_BoundingBox(doc.GetElement(e.OwnerViewId) as View);
            if (b == null)
                return false;
            XYZ want = p.T.OfPoint((b.Min + b.Max) / 2);
            foreach (Element x in new FilteredElementCollector(doc, d.Id).OwnedByView(d.Id).OfClass(FilterClassOf(e)))
            {
                if (x.GetTypeId() != e.GetTypeId() || x.Id == e.Id)
                    continue;
                BoundingBoxXYZ xb = x.get_BoundingBox(d);
                if (xb != null && ((xb.Min + xb.Max) / 2).DistanceTo(want) < Tol * 4)
                    return true;
            }
            return false;
        }

        private static void CopyDetailsSameView(Document doc, View v, List<ElementId> ids, CopyPlacement p,
            CopyToOtherReport rep)
        {
            using (var st = new SubTransaction(doc))
            {
                st.Start();
                try
                {
                    ICollection<ElementId> n;
                    if (p.Kind == CopyPlacementKind.Mirror)
                    {
                        n = ElementTransformUtils.MirrorElements(doc, ids, p.MirrorPlane, true);
                    }
                    else
                    {
                        n = ElementTransformUtils.CopyElements(doc, ids, p.Translation);
                        if (p.Kind == CopyPlacementKind.Rotate && Math.Abs(p.Angle) > 1e-9)
                            ElementTransformUtils.RotateElements(doc, n, Line.CreateUnbound(p.Pivot, XYZ.BasisZ), p.Angle);
                    }
                    st.Commit();
                    rep.Details += n.Count;
                }
                catch
                {
                    st.RollBack();
                    rep.DetailsSkipped += ids.Count;
                }
            }
        }

        /// <summary>
        /// А-гийн харагдацаас Б-д үүсгэсэн харагдац руу 2D хуулна.  Байрлалыг Revit-ийн
        /// харагдац хоорондын зураглалд ИТГЭХГҮЙ: хуулсны дараа бүлгийн төвийг
        /// T(эх төв)-тэй тулгаж зөрүүг нь нэг MoveElements-ээр засна.  Толин тусгалд эхлээд
        /// харагдацын босоо тэнхлэгээр толин тусгана (Б харагдац нь А-гийн толин дүр).
        /// </summary>
        private static void CopyDetailsToView(Document doc, View from, View to, List<ElementId> ids, CopyPlacement p,
            CopyToOtherReport rep)
        {
            using (var st = new SubTransaction(doc))
            {
                st.Start();
                try
                {
                    XYZ want = p.T.OfPoint(CenterOf(doc, ids, from));
                    // ⚠️ Transform.Identity — T БИШ.  Харагдац хоорондын хуулалт элементийг
                    // эх харагдацтайгаа ИЖИЛ харьцангуй байрлалд тавьдаг тул T-г өгвөл давхар
                    // шилжинэ (хэмжсэн: +60 фут → +120).
                    List<ElementId> n = ElementTransformUtils.CopyElements(from, ids, to, Transform.Identity, new CopyPasteOptions()).ToList();
                    if (!p.IsRigid && n.Count > 0)
                    {
                        Plane flip = Plane.CreateByNormalAndOrigin(to.RightDirection, CenterOf(doc, n, to));
                        ElementTransformUtils.MirrorElements(doc, n, flip, false);
                    }
                    doc.Regenerate();
                    XYZ delta = want - CenterOf(doc, n, to);
                    delta -= to.ViewDirection * delta.DotProduct(to.ViewDirection); // хавтгай дээр л
                    if (delta.GetLength() > 1e-6)
                        ElementTransformUtils.MoveElements(doc, n, delta);
                    st.Commit();
                    rep.Details += n.Count;
                }
                catch
                {
                    st.RollBack();
                    rep.DetailsSkipped += ids.Count;
                }
            }
        }

        /// <summary>Элементүүдийн (харагдац дахь) хүрээний төвүүдийн дундаж.</summary>
        private static XYZ CenterOf(Document doc, IEnumerable<ElementId> ids, View v)
        {
            XYZ sum = XYZ.Zero;
            int n = 0;
            foreach (ElementId id in ids)
            {
                BoundingBoxXYZ b = doc.GetElement(id)?.get_BoundingBox(v);
                if (b == null)
                    continue;
                sum += (b.Min + b.Max) / 2;
                n++;
            }
            return n == 0 ? XYZ.Zero : sum / n;
        }

        // ── Хуудас ─────────────────────────────────────────────────────────

        /// <summary>
        /// Б-д үүсгэсэн харагдац А-д хуудсан дээр байсан бол: ижил хүрээтэй шинэ
        /// хуудас үүсгээд харагдац бүрийг ИЖИЛ байрлалд, legend / хүснэгт / хуудасны
        /// 2D-г ч хамт тавина.  Хуудас бүрд нэг удаа (олон харагдацтай ч).
        /// </summary>
        private static void CloneSheets(Document doc, Dictionary<ElementId, View> clones, CopyPlacement p,
            CopyToOtherReport rep)
        {
            List<Viewport> vps = new FilteredElementCollector(doc).OfClass(typeof(Viewport)).Cast<Viewport>().ToList();
            var bySheet = vps.Where(vp => clones.ContainsKey(vp.ViewId)).GroupBy(vp => vp.SheetId);

            foreach (var g in bySheet)
            {
                var sheet = doc.GetElement(g.Key) as ViewSheet;
                if (sheet == null)
                    continue;
                // Бүх Б харагдац аль хэдийн хуудсан дээр бол (дахин ажиллуулалт) — алгасна.
                List<Viewport> todo = g.Where(vp => vps.All(x => x.ViewId != clones[vp.ViewId].Id)).ToList();
                if (todo.Count == 0)
                    continue;

                using (var st = new SubTransaction(doc))
                {
                    st.Start();
                    try
                    {
                        Element tb = new FilteredElementCollector(doc, sheet.Id).OfCategory(BuiltInCategory.OST_TitleBlocks)
                            .WhereElementIsNotElementType().FirstElement();
                        ViewSheet ns = ViewSheet.Create(doc, tb?.GetTypeId() ?? ElementId.InvalidElementId);
                        CopySheetParameters(sheet, ns);
                        ns.SheetNumber = UniqueSheetNumber(doc, sheet.SheetNumber + "-" + p.Letter);
                        ns.Name = NameFor(sheet.Name, p.Letter);

                        foreach (Viewport vp in todo)
                        {
                            View c = clones[vp.ViewId];
                            if (!Viewport.CanAddViewToSheet(doc, ns.Id, c.Id))
                                continue;
                            Viewport nvp = Viewport.Create(doc, ns.Id, c.Id, vp.GetBoxCenter());
                            if (nvp.GetTypeId() != vp.GetTypeId())
                                nvp.ChangeTypeId(vp.GetTypeId());
                        }
                        // Legend (олон хуудсанд тавьж болно).
                        foreach (Viewport vp in vps.Where(x => x.SheetId == sheet.Id))
                        {
                            if (doc.GetElement(vp.ViewId) is View lv && lv.ViewType == ViewType.Legend)
                                Viewport.Create(doc, ns.Id, lv.Id, vp.GetBoxCenter());
                            else if (!clones.ContainsKey(vp.ViewId))
                                rep.Note("«" + sheet.SheetNumber + "» хуудасны «" + doc.GetElement(vp.ViewId)?.Name
                                    + "» харагдац Б-д хамаарахгүй тул шинэ хуудсанд ороогүй.");
                        }
                        // Хүснэгт (гарчгийн хүрээний revision хүснэгтээс бусад).
                        foreach (ScheduleSheetInstance ssi in new FilteredElementCollector(doc, sheet.Id)
                                     .OfClass(typeof(ScheduleSheetInstance)).Cast<ScheduleSheetInstance>())
                        {
                            if (ssi.IsTitleblockRevisionSchedule)
                                continue;
                            try { ScheduleSheetInstance.Create(doc, ns.Id, ssi.ScheduleId, ssi.Point); } catch { }
                        }
                        // Хуудасны 2D (текст, зураас).
                        List<ElementId> sheet2d = new FilteredElementCollector(doc, sheet.Id).OwnedByView(sheet.Id)
                            .WherePasses(new ElementMulticlassFilter(new List<Type> { typeof(TextNote), typeof(CurveElement), typeof(FilledRegion) }))
                            .ToElementIds().ToList();
                        if (sheet2d.Count > 0)
                            ElementTransformUtils.CopyElements(sheet, sheet2d, ns, Transform.Identity, new CopyPasteOptions());

                        st.Commit();
                        rep.SheetsCreated++;
                        rep.NewSheets.Add(ns.SheetNumber + " — " + ns.Name);
                    }
                    catch (Exception ex)
                    {
                        st.RollBack();
                        rep.Note("«" + sheet.SheetNumber + "» хуудсыг Б-д үүсгэж чадсангүй: " + ex.Message);
                    }
                }
            }
        }

        /// <summary>
        /// Хуудасны бичиж болох параметрүүдийг (ангилал, дэд салбар г.м.) хуулна —
        /// шинэ хуудас хөтөч дээр эх хуудасныхаа бүлэгт харагдана.
        /// </summary>
        private static void CopySheetParameters(ViewSheet src, ViewSheet dst)
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
                    Parameter b = dst.get_Parameter(a.Definition);
                    if (b == null || b.IsReadOnly)
                        continue;
                    switch (a.StorageType)
                    {
                        case StorageType.String: b.Set(a.AsString()); break;
                        case StorageType.Integer: b.Set(a.AsInteger()); break;
                        case StorageType.Double: b.Set(a.AsDouble()); break;
                        case StorageType.ElementId: b.Set(a.AsElementId()); break;
                    }
                }
                catch { }
            }
        }

        private static string UniqueSheetNumber(Document doc, string number)
        {
            var nums = new HashSet<string>(new FilteredElementCollector(doc).OfClass(typeof(ViewSheet)).Cast<ViewSheet>()
                .Select(s => s.SheetNumber), StringComparer.OrdinalIgnoreCase);
            string n = number;
            for (int i = 2; nums.Contains(n); i++)
                n = number + "." + i;
            return n;
        }

        private static Dictionary<ElementId, string> SheetNumbersByView(Document doc)
        {
            var d = new Dictionary<ElementId, string>();
            foreach (Viewport vp in new FilteredElementCollector(doc).OfClass(typeof(Viewport)).Cast<Viewport>())
            {
                if (doc.GetElement(vp.SheetId) is ViewSheet s)
                    d[vp.ViewId] = s.SheetNumber;
            }
            return d;
        }

        // ── Туслах ─────────────────────────────────────────────────────────

        private static BoundingBoxXYZ UnionBox(IEnumerable<Element> elements)
        {
            XYZ min = null, max = null;
            foreach (Element e in elements)
            {
                BoundingBoxXYZ b = e.get_BoundingBox(null);
                if (b == null)
                    continue;
                min = min == null ? b.Min : new XYZ(Math.Min(min.X, b.Min.X), Math.Min(min.Y, b.Min.Y), Math.Min(min.Z, b.Min.Z));
                max = max == null ? b.Max : new XYZ(Math.Max(max.X, b.Max.X), Math.Max(max.Y, b.Max.Y), Math.Max(max.Z, b.Max.Z));
            }
            return min == null ? null : new BoundingBoxXYZ { Min = min, Max = max };
        }

        /// <summary>
        /// 2D элемент А-гийн бүсэд багтах уу — ХАРАГДАЦЫН ХАВТГАЙ дээр (Right, Up).
        /// ⚠️ 3D-ээр шалгаж болохгүй: зүсэлтийн хавтгай барилгын гадна байж болох тул
        /// тэр хавтгай дээрх зураас гүний тэнхлэгээр А-гийн бүсээс үргэлж гадна гардаг.
        /// </summary>
        private static bool InsideInView(View v, BoundingBoxXYZ b, BoundingBoxXYZ region, double margin)
        {
            XYZ r = v.RightDirection, u = v.UpDirection;
            Tuple<double, double, double, double> Project(BoundingBoxXYZ box)
            {
                double x0 = double.MaxValue, y0 = double.MaxValue, x1 = double.MinValue, y1 = double.MinValue;
                foreach (double x in new[] { box.Min.X, box.Max.X })
                foreach (double y in new[] { box.Min.Y, box.Max.Y })
                foreach (double z in new[] { box.Min.Z, box.Max.Z })
                {
                    var q = new XYZ(x, y, z);
                    double a = q.DotProduct(r), c = q.DotProduct(u);
                    x0 = Math.Min(x0, a); x1 = Math.Max(x1, a);
                    y0 = Math.Min(y0, c); y1 = Math.Max(y1, c);
                }
                return Tuple.Create(x0, y0, x1, y1);
            }
            var e = Project(b);
            var g = Project(region);
            return e.Item1 >= g.Item1 - margin && e.Item3 <= g.Item3 + margin
                && e.Item2 >= g.Item2 - margin && e.Item4 <= g.Item4 + margin;
        }

        /// <summary>Харагдацын тайрах хүрээ А-гийн бүстэй огтлолцох уу (харагдацын координатад).</summary>
        private static bool CropIntersects(View v, BoundingBoxXYZ region)
        {
            try
            {
                BoundingBoxXYZ cb = v.CropBox;
                Transform inv = cb.Transform.Inverse;
                double minX = double.MaxValue, minY = double.MaxValue, minZ = double.MaxValue;
                double maxX = double.MinValue, maxY = double.MinValue, maxZ = double.MinValue;
                foreach (double x in new[] { region.Min.X, region.Max.X })
                foreach (double y in new[] { region.Min.Y, region.Max.Y })
                foreach (double z in new[] { region.Min.Z, region.Max.Z })
                {
                    XYZ q = inv.OfPoint(new XYZ(x, y, z));
                    minX = Math.Min(minX, q.X); maxX = Math.Max(maxX, q.X);
                    minY = Math.Min(minY, q.Y); maxY = Math.Max(maxY, q.Y);
                    minZ = Math.Min(minZ, q.Z); maxZ = Math.Max(maxZ, q.Z);
                }
                bool xy = maxX >= cb.Min.X && minX <= cb.Max.X && maxY >= cb.Min.Y && minY <= cb.Max.Y;
                // Зүсэлтэд гүнийг ч шалгана; планд тайрах хүрээний Z утгагүй.
                return v is ViewSection ? xy && maxZ >= cb.Min.Z && minZ <= cb.Max.Z : xy;
            }
            catch
            {
                return false;
            }
        }

        private static ElementMulticategoryFilter CategoryFilter(Document doc, IEnumerable<ElementId> ids)
        {
            var cats = new HashSet<ElementId>();
            foreach (ElementId id in ids)
            {
                Category c = doc.GetElement(id)?.Category;
                if (c != null)
                    cats.Add(c.Id);
            }
            // Хоосон жагсаалтаар ElementMulticategoryFilter үүсгэвэл Revit унадаг.
            return cats.Count > 0 ? new ElementMulticategoryFilter(cats) : null;
        }

        private static bool AnyVisible(Document doc, View v, HashSet<ElementId> ids, ElementMulticategoryFilter cats)
        {
            try
            {
                var fec = new FilteredElementCollector(doc, v.Id).WhereElementIsNotElementType();
                if (cats != null)
                    fec = fec.WherePasses(cats);
                return fec.ToElementIds().Any(ids.Contains);
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// Элемент тухайн харагдацад харагдах эсэх (харагдац бүрд нэг удаа тооцно).
        /// ⚠️ Тайрах хүрээг (crop) тооцдог — хүрээнээс гадна орших Б «харагдахгүй».
        /// </summary>
        private sealed class VisibilityCache
        {
            private readonly Document _doc;
            private readonly HashSet<ElementId> _ids;
            private readonly ElementMulticategoryFilter _cats;
            private readonly Dictionary<ElementId, HashSet<ElementId>> _byView =
                new Dictionary<ElementId, HashSet<ElementId>>();

            public VisibilityCache(Document doc, IEnumerable<ElementId> ids)
            {
                _doc = doc;
                _ids = new HashSet<ElementId>(ids);
                _cats = CategoryFilter(doc, _ids);
            }

            public void Reset() => _byView.Clear();

            public bool Sees(View v, ElementId id)
            {
                if (!_byView.TryGetValue(v.Id, out HashSet<ElementId> set))
                {
                    set = new HashSet<ElementId>();
                    try
                    {
                        var fec = new FilteredElementCollector(_doc, v.Id).WhereElementIsNotElementType();
                        if (_cats != null)
                            fec = fec.WherePasses(_cats);
                        foreach (ElementId x in fec.ToElementIds())
                        {
                            if (_ids.Contains(x))
                                set.Add(x);
                        }
                    }
                    catch
                    {
                        // Хэвлэгддэггүй харагдац (хүснэгт г.м.) — юу ч харагдахгүй гэж үзнэ.
                    }
                    _byView[v.Id] = set;
                }
                return set.Contains(id);
            }
        }
    }

    /// <summary>
    /// Хуулахад гарах анхааруулгыг (давхцал, өрөө битүү биш г.м.) диалог болгохгүйгээр
    /// ТООЛЖ нууна — тайланд тоо нь харагдана.  Алдаа (error)-г хөндөхгүй.
    /// </summary>
    internal sealed class CopyWarningCounter : IFailuresPreprocessor
    {
        private readonly CopyToOtherReport _rep;

        public CopyWarningCounter(CopyToOtherReport rep) { _rep = rep; }

        public FailureProcessingResult PreprocessFailures(FailuresAccessor accessor)
        {
            foreach (FailureMessageAccessor f in accessor.GetFailureMessages())
            {
                if (f.GetSeverity() == FailureSeverity.Warning)
                {
                    accessor.DeleteWarning(f);
                    _rep.WarningsHidden++;
                }
            }
            return FailureProcessingResult.Continue;
        }
    }
}
