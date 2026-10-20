using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.ClashCheck;
using RevitMcpAddin.Smart;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ChangeImpact
{
    /// <summary>
    /// Хаалганы ХУУЛСАН контекст + клэш шалгалтын линк slot-ууд.  ⚠️ Зөвхөн ХУУЛСАН өгөгдөл (мм, id) — амьд Revit обьект ЭНД ХЭЗЭЭ Ч ОРОХГҮЙ.
    /// Зөөх зайнаас ХАМААРАХГҮЙ: 300 → 320 мм-д ДАХИН БАРИХГҮЙ.  Загварын өөрчлөлтийн тэмдэг солигдвол хүчингүй.
    /// </summary>
    internal sealed class DoorContextData
    {
        public DoorMoveContext Ctx;
        public List<LinkSlot> Slots = new List<LinkSlot>();
    }

    /// <summary>
    /// «Хаалга зөөх»-ийн Revit-ээс уншилт: хост хана (геометр, зузаан, холбогдсон ханын зузаан), хаалга (өргөн, өндөр, өрөө), ижил хост дээрх бусад нүх, хаалганы
    /// «давхарга»-д (хост ханын хэсэг) багтах саад (багана, бүтэц, хана, тавилга, төхөөрөмж, MEP — линк загвар орно), ойролцоох өрөө.
    ///
    /// ПРИНЦИП: бүх зүйл ЗӨВХӨН УНШИХ.  Нэр дэвшигчийг ХОСТЫН координатад (s, n, z) шүүнэ — хаалга хост дагуу хаана ч очиж болох тул хост БҮХЭЛДЭЭ.
    /// Хязгаар (тоо, хугацаа), unload хийсэн линк, хаалттай workset → `IncompleteReasons` (ЧИМЭЭГҮЙ алгасахгүй; «саад илрээгүй» ≠ «саад байхгүй»).
    /// </summary>
    internal static class PreChangeDoorContext
    {
        internal const int MaxObstacles = 300;
        internal const int MaxOpenings = 80;
        internal const int MaxRooms = 40;
        /// <summary>Саад хайлтад зарцуулах дээд хугацаа (мс).</summary>
        internal const int ObstacleBudgetMs = 1500;
        /// <summary>Хаалганы «давхарга»-ыг тэлэх (мм): хүлцэл.</summary>
        internal const double SlabPadMm = 50;

        internal static readonly PreChangeContextCache<DoorContextData> Cache = new PreChangeContextCache<DoorContextData>(3);

        private static readonly BuiltInCategory[] ColumnCats = { BuiltInCategory.OST_Columns, BuiltInCategory.OST_StructuralColumns };
        private static readonly BuiltInCategory[] StructureCats = { BuiltInCategory.OST_StructuralFraming };
        private static readonly BuiltInCategory[] WallCats = { BuiltInCategory.OST_Walls };
        private static readonly BuiltInCategory[] FurnitureCats = { BuiltInCategory.OST_Furniture, BuiltInCategory.OST_FurnitureSystems, BuiltInCategory.OST_Casework };
        private static readonly BuiltInCategory[] EquipmentCats = { BuiltInCategory.OST_SpecialityEquipment, BuiltInCategory.OST_MechanicalEquipment, BuiltInCategory.OST_ElectricalEquipment };
        private static readonly BuiltInCategory[] FixtureCats = { BuiltInCategory.OST_PlumbingFixtures, BuiltInCategory.OST_ElectricalFixtures, BuiltInCategory.OST_LightingFixtures };
        private static readonly BuiltInCategory[] GenericCats = { BuiltInCategory.OST_GenericModel };

        private static List<KeyValuePair<BuiltInCategory, ObstacleKind>> CategoryMap()
        {
            var m = new List<KeyValuePair<BuiltInCategory, ObstacleKind>>();
            foreach (BuiltInCategory c in ColumnCats) m.Add(new KeyValuePair<BuiltInCategory, ObstacleKind>(c, ObstacleKind.Column));
            foreach (BuiltInCategory c in StructureCats) m.Add(new KeyValuePair<BuiltInCategory, ObstacleKind>(c, ObstacleKind.Structure));
            foreach (BuiltInCategory c in WallCats) m.Add(new KeyValuePair<BuiltInCategory, ObstacleKind>(c, ObstacleKind.Wall));
            foreach (BuiltInCategory c in FurnitureCats) m.Add(new KeyValuePair<BuiltInCategory, ObstacleKind>(c, ObstacleKind.Furniture));
            foreach (BuiltInCategory c in EquipmentCats) m.Add(new KeyValuePair<BuiltInCategory, ObstacleKind>(c, ObstacleKind.Equipment));
            foreach (BuiltInCategory c in FixtureCats) m.Add(new KeyValuePair<BuiltInCategory, ObstacleKind>(c, ObstacleKind.Fixture));
            foreach (BuiltInCategory c in GenericCats) m.Add(new KeyValuePair<BuiltInCategory, ObstacleKind>(c, ObstacleKind.Generic));
            foreach (BuiltInCategory c in PreChangeClashProbe.MepCategories) m.Add(new KeyValuePair<BuiltInCategory, ObstacleKind>(c, ObstacleKind.Mep));
            return m;
        }

        /* ============================== КЭШ + БАРИХ ========================== */

        /// <summary>Кэшээс (ижил файл + тэмдэг + хаалга + линк + тохиргоо) эсвэл ШИНЭЭР барина.  Загварт ХҮРЭХГҮЙ.</summary>
        internal static DoorContextData GetOrBuild(Document doc, DocumentKey key, DoorCheck check, string stamp, out bool fromCache)
        {
            PreChangeCacheKey ck = PreChangePlanCache.KeyOf(doc, key, check.Door.UniqueId, stamp);
            DoorContextData hit;
            if (Cache.TryGet(ck, out hit) && hit.Ctx != null) { fromCache = true; return hit; }
            fromCache = false;
            DoorContextData built = Build(doc, check, stamp);
            Cache.Put(ck, built);
            return built;
        }

        internal static DoorContextData Build(Document doc, DoorCheck check, string stamp)
        {
            var sw = Stopwatch.StartNew();
            FamilyInstance door = check.Door;
            Wall hostWall = check.Host;
            var data = new DoorContextData();
            var ctx = new DoorMoveContext { ModelStamp = stamp };
            data.Ctx = ctx;

            HostGeometry host = ReadHost(hostWall, check.HostLine);
            ctx.Host = host;
            ctx.Door = ReadDoor(door, host, ctx);

            ReadOpenings(doc, hostWall, door, host, ctx);
            ReadObstacles(doc, hostWall, door, host, ctx, data);
            ReadRooms(doc, door, host, ctx);

            ctx.IncompleteReasons = ctx.IncompleteReasons.Distinct(StringComparer.Ordinal).ToList();
            ctx.BuildMs = sw.ElapsedMilliseconds;
            SmartLog.Info("prechange", "door_context_built", new
            {
                ms = ctx.BuildMs, openings = ctx.Openings.Count, obstacles = ctx.Obstacles.Count, rooms = ctx.Rooms.Count, slots = data.Slots.Count,
                incomplete = ctx.IncompleteReasons.Count, widthSource = ctx.Door.WidthSource.ToString(),
            });
            return data;
        }

        /* ============================== ХОСТ ================================ */

        private static HostGeometry ReadHost(Wall wall, Line line)
        {
            XYZ a = line.GetEndPoint(0), b = line.GetEndPoint(1);
            var h = new HostGeometry
            {
                Id = wall.Id.Value, Uid = wall.UniqueId, Label = HostLabel(wall),
                StartX = PcUnits.Mm(a.X), StartY = PcUnits.Mm(a.Y), EndX = PcUnits.Mm(b.X), EndY = PcUnits.Mm(b.Y),
                ThicknessMm = PcUnits.Mm(wall.Width),
            };
            double[] box = PreChangeDoorRules.ReadBoxMm(wall);
            if (box != null) { h.ZMinMm = Math.Min(box[2], box[5]); h.ZMaxMm = Math.Max(box[2], box[5]); }
            else { h.ZMinMm = PcUnits.Mm(a.Z); h.ZMaxMm = h.ZMinMm + 3000; }

            // Хост ханын төгсгөлд холбогдсон хөрш ханын зузаан (мм) — хаалганы нүх тэнд хүрэх эсэхийг шалгана.
            try
            {
                var lc = wall.Location as LocationCurve;
                if (lc != null)
                    for (int end = 0; end < 2; end++)
                    {
                        ElementArray arr = lc.get_ElementsAtJoin(end);
                        if (arr == null) continue;
                        double max = 0;
                        foreach (Element e in arr)
                        {
                            var w = e as Wall;
                            if (w != null && w.Id != wall.Id) max = Math.Max(max, PcUnits.Mm(w.Width));
                        }
                        if (end == 0) h.StartJoinThicknessMm = max; else h.EndJoinThicknessMm = max;
                    }
            }
            catch (Exception) { /* холболт уншигдсангүй — гол шалгалт хэвээр (ханын зах) */ }
            return h;
        }

        private static string HostLabel(Wall wall)
        {
            string t = null;
            try { WallType wt = wall.WallType; t = wt != null ? wt.Name : null; } catch (Exception) { }
            string mark = PreChangeDoorRules.MarkOf(wall);
            return (string.IsNullOrEmpty(t) ? "Хана" : t) + (mark != null ? " [" + mark + "]" : "");
        }

        /* ============================== ХААЛГА ============================== */

        private static DoorBody ReadDoor(FamilyInstance door, HostGeometry host, DoorMoveContext ctx)
        {
            var d = new DoorBody { Id = door.Id.Value, Uid = door.UniqueId, Label = PreChangeDoorRules.LabelOf(door), TypeName = PreChangeDoorRules.TypeNameOf(door) };
            var lp = (LocationPoint)door.Location;
            double px = PcUnits.Mm(lp.Point.X), py = PcUnits.Mm(lp.Point.Y);
            double s, n;
            DoorHostMath.Local(host, px, py, out s, out n);
            d.CenterParamMm = s;
            d.CenterNormalMm = Math.Abs(n) <= host.ThicknessMm ? n : 0;

            WidthSource src;
            double w = PreChangeDoorRules.ReadWidthMm(door, host, out src);
            d.WidthSource = src;
            d.WidthMm = src == WidthSource.Unknown ? 0 : w;
            d.GhostWidthMm = src == WidthSource.Unknown ? 900 : w;
            d.HeightMm = PreChangeDoorRules.ReadHeightMm(door);

            double[] box = PreChangeDoorRules.ReadBoxMm(door);
            if (box != null)
            {
                d.ZMinMm = Math.Min(box[2], box[5]);
                d.ZMaxMm = Math.Max(box[2], box[5]);
                double[] lb = DoorSweep.LocalBox(host, box);
                // Босоо төвийг bbox-оос — байрлалын цэг нь ханын байрлалын шугам дээр БИШ байж болно (finish face гэх мэт).
                if (lb != null && Math.Abs((lb[1] + lb[4]) / 2.0) <= host.ThicknessMm) d.CenterNormalMm = (lb[1] + lb[4]) / 2.0;
                // Зарим family-ийн эх цэг нь нүхний ТӨВ БИШ (бүхээгийн/цоожны тал).  Нүх ЯГ хаана байгааг bbox-ийн хост дагуух төвөөс авна — байрлалын цэгийн төвөөс
                // хол (> өргөнгийн хагас) бол bbox найдваргүй (дүүжин, өргөтгөл орсон) тул байрлалын цэгийг хэвээр авна.  Зөөлтийн ЗАЙ хоёр тохиолдолд ижил (шилжилтийн инвариант).
                if (lb != null && src != WidthSource.Unknown)
                {
                    double bboxCenter = (lb[0] + lb[3]) / 2.0;
                    if (Math.Abs(bboxCenter - s) <= Math.Max(w / 2.0, 1))
                    {
                        if (Math.Abs(bboxCenter - s) > PreChangeTolerance.LengthMm) ctx.Notes.Add("Хаалганы байрлалын цэг нүхний төвөөс " + PreChangeText.Mm(Math.Abs(bboxCenter - s)) + " зөрүүтэй — нүхний төвийг хэмжээнээс авлаа.");
                        d.CenterParamMm = bboxCenter;
                    }
                }
            }
            else
            {
                d.ZMinMm = host.ZMinMm;
                d.ZMaxMm = host.ZMinMm + (d.HeightMm > 0 ? d.HeightMm : 2100);
                ctx.Notes.Add("Хаалганы хэмжээ (bounding box) уншигдсангүй — өндөр, ghost-ийн хэмжээ ойролцоо.");
            }
            d.DepthMm = host.ThicknessMm;
            if (src == WidthSource.Unknown) ctx.IncompleteReasons.Add("Хаалганы нүхний өргөнг найдвартай тодорхойлж чадсангүй — давхцлын шалгалт зөвхөн төвөөр (батлах боломжгүй).");
            else if (src == WidthSource.BBox) ctx.Notes.Add("Нүхний өргөнг параметрээс биш, хаалганы хэмжээнээс (ойролцоо) авсан.");

            long fromId, toId; string fromName, toName; bool readable;
            PreChangeDoorRules.ReadRooms(door, out fromId, out toId, out fromName, out toName, out readable);
            d.FromRoomId = fromId; d.ToRoomId = toId; d.FromRoomLabel = fromName; d.ToRoomLabel = toName; d.RoomsReadable = readable;
            return d;
        }

        /* ============================== БУСАД НҮХ =========================== */

        private static void ReadOpenings(Document doc, Wall hostWall, FamilyInstance door, HostGeometry host, DoorMoveContext ctx)
        {
            int total = 0;
            try
            {
                IList<ElementId> found = hostWall.FindInserts(true, true, true, true);
                if (found == null) return;
                foreach (ElementId id in found)
                {
                    if (id == door.Id) continue;
                    Element el = doc.GetElement(id);
                    if (el == null || !el.IsValidObject) continue;
                    OpeningSpan span = SpanOf(el, host);
                    if (span == null) continue;
                    if (++total > MaxOpenings) { ctx.IncompleteReasons.Add("Хост хананы нүх " + found.Count + " — эхний " + MaxOpenings + "-г л шалгав."); break; }
                    ctx.Openings.Add(span);
                }
            }
            catch (Exception ex)
            {
                ctx.IncompleteReasons.Add("Хост хананы бусад нүхийг (хаалга, цонх) уншиж чадсангүй (" + ex.GetType().Name + ").");
            }
        }

        private static OpeningSpan SpanOf(Element el, HostGeometry host)
        {
            var fi = el as FamilyInstance;
            ObstacleKind kind;
            if (fi != null && fi.Category != null && fi.Category.Id.Value == (long)BuiltInCategory.OST_Doors) kind = ObstacleKind.Door;
            else if (fi != null && fi.Category != null && fi.Category.Id.Value == (long)BuiltInCategory.OST_Windows) kind = ObstacleKind.Window;
            else if (el is Opening) kind = ObstacleKind.Opening;
            else return null;

            double[] box = PreChangeDoorRules.ReadBoxMm(el);
            double[] lb = box != null ? DoorSweep.LocalBox(host, box) : null;
            var span = new OpeningSpan { Id = el.Id.Value, Uid = SafeUid(el), Kind = kind, BoxMm = box, Label = SpanLabel(el, fi, kind) };

            WidthSource src = WidthSource.Unknown;
            double width = 0;
            if (fi != null) width = PreChangeDoorRules.ReadWidthMm(fi, host, out src);
            else if (lb != null && lb[3] - lb[0] > 1) { width = lb[3] - lb[0]; src = WidthSource.BBox; }
            span.WidthSource = src;
            span.WidthMm = src == WidthSource.Unknown ? 0 : width;

            // Төв: family instance бол байрлалын цэг, үгүй бол bbox-ийн төв.
            double center = double.NaN;
            var lp = el.Location as LocationPoint;
            if (lp != null && lp.Point != null) center = DoorHostMath.ParamOf(host, PcUnits.Mm(lp.Point.X), PcUnits.Mm(lp.Point.Y));
            else if (lb != null) center = (lb[0] + lb[3]) / 2.0;
            if (double.IsNaN(center)) return null;
            span.CenterParamMm = center;
            return span;
        }

        private static string SpanLabel(Element el, FamilyInstance fi, ObstacleKind kind)
        {
            string mark = PreChangeDoorRules.MarkOf(el);
            if (mark != null) return mark;
            string t = null;
            try { t = fi != null && fi.Symbol != null ? fi.Symbol.Name : el.Name; } catch (Exception) { }
            return ObstacleKinds.Label(kind) + (string.IsNullOrEmpty(t) ? "" : " · " + t);
        }

        /* ============================== СААД ================================ */

        private static void ReadObstacles(Document doc, Wall hostWall, FamilyInstance door, HostGeometry host, DoorMoveContext ctx, DoorContextData data)
        {
            List<KeyValuePair<BuiltInCategory, ObstacleKind>> map = CategoryMap();
            var filter = new ElementMulticategoryFilter(map.Select(k => k.Key).ToList());
            Dictionary<long, ObstacleKind> kindByCat = map.ToDictionary(k => (long)k.Key, k => k.Value);
            var sw = Stopwatch.StartNew();
            var seen = new HashSet<string>(StringComparer.Ordinal);

            Outline region = SlabRegion(host, ctx.Door);
            try
            {
                CollectFrom(doc, null, null, region, filter, kindByCat, hostWall.Id.Value, door.Id.Value, host, ctx, seen, sw);
                var own = new ClashSpec();
                PreChangeClashProbe.CheckWorksets(doc, "Энэ файл", own);
                ctx.IncompleteReasons.AddRange(own.IncompleteReasons);
            }
            catch (Exception ex)
            {
                ctx.IncompleteReasons.Add("Host файлын саадыг олж чадсангүй (" + ex.GetType().Name + ").");
            }

            int unloaded = 0;
            foreach (RevitLinkInstance inst in new FilteredElementCollector(doc).OfClass(typeof(RevitLinkInstance)).Cast<RevitLinkInstance>())
            {
                if (ctx.Obstacles.Count >= MaxObstacles) break;
                Document ld = null;
                try { ld = inst.GetLinkDocument(); } catch (Exception) { }
                if (ld == null) { unloaded++; continue; }
                try
                {
                    Transform t = inst.GetTotalTransform();
                    Outline linkRegion = PreChangeClashProbe.TransformOutline(region, t.Inverse);
                    var slot = new LinkSlot { InstanceId = inst.Id.Value, InstanceUid = inst.UniqueId, Name = ClashLinks.DisplayName(inst), LinkDocId = RevitDocumentKeys.Of(ld).Id };
                    data.Slots.Add(slot);
                    CollectFrom(ld, inst, t, linkRegion, filter, kindByCat, 0, 0, host, ctx, seen, sw);
                    var tmp = new ClashSpec();
                    PreChangeClashProbe.CheckWorksets(ld, "Линк «" + slot.Name + "»", tmp);
                    ctx.IncompleteReasons.AddRange(tmp.IncompleteReasons);
                }
                catch (Exception ex)
                {
                    ctx.IncompleteReasons.Add("Линкийн саадыг олж чадсангүй (" + ex.GetType().Name + ").");
                }
            }
            if (unloaded > 0)
                ctx.IncompleteReasons.Add(unloaded + " линк unload хийгдсэн — тэдгээрийн саадыг шалгаагүй (саад илрээгүй ≠ саад байхгүй).");
            if (sw.ElapsedMilliseconds > ObstacleBudgetMs)
                ctx.IncompleteReasons.Add("Саадын хайлт хугацааны хязгаараас (" + ObstacleBudgetMs + " мс) болж дутуу.");
        }

        private static void CollectFrom(Document source, RevitLinkInstance link, Transform toHost, Outline region, ElementFilter filter, Dictionary<long, ObstacleKind> kindByCat,
            long excludeA, long excludeB, HostGeometry host, DoorMoveContext ctx, HashSet<string> seen, Stopwatch sw)
        {
            long linkId = link != null ? link.Id.Value : 0;
            string linkName = link != null ? ClashLinks.DisplayName(link) : null;
            DoorBody d = ctx.Door;
            double zLo = d.ZMinMm - SlabPadMm, zHi = d.ZMaxMm + SlabPadMm;
            double nLo = d.CenterNormalMm - host.ThicknessMm / 2.0 - SlabPadMm, nHi = d.CenterNormalMm + host.ThicknessMm / 2.0 + SlabPadMm;
            double len = host.LengthMm;

            foreach (Element e in new FilteredElementCollector(source).WherePasses(filter).WhereElementIsNotElementType().WherePasses(new BoundingBoxIntersectsFilter(region)))
            {
                if (sw.ElapsedMilliseconds > ObstacleBudgetMs) break;
                if (ctx.Obstacles.Count >= MaxObstacles)
                {
                    ctx.IncompleteReasons.Add("Саад " + MaxObstacles + "-аас олон — эхний " + MaxObstacles + "-г л шалгав.");
                    break;
                }
                if (link == null && (e.Id.Value == excludeA || e.Id.Value == excludeB)) continue;
                ObstacleKind kind;
                if (e.Category == null || !kindByCat.TryGetValue(e.Category.Id.Value, out kind)) continue;

                double[] box = BoxInHost(e, toHost);
                if (box == null) continue;
                double[] lb = DoorSweep.LocalBox(host, box);
                if (lb == null) continue;
                // ХАЛГА дагуу (s), хөндлөн (n), босоо (z) — хаалга хост дагуу очиж болох ХЭСЭГТ л багтах саад.
                if (lb[3] < -SlabPadMm || lb[0] > len + SlabPadMm) continue;
                if (lb[4] < nLo || lb[1] > nHi) continue;
                if (lb[5] < zLo || lb[2] > zHi) continue;

                string key = linkId + ":" + e.Id.Value;
                if (!seen.Add(key)) continue;
                ctx.Obstacles.Add(new ObstacleBox
                {
                    Id = e.Id.Value, Uid = SafeUid(e), Label = ObstacleLabel(e, kind), Kind = kind, BoxMm = box, LinkInstanceId = linkId, LinkName = linkName,
                });
            }
        }

        /// <summary>Элементийн bbox-ийг ХОСТ загварын координатад (мм, AABB).  Линкийнх `toHost` transform-оор (8 өнцөг).</summary>
        private static double[] BoxInHost(Element e, Transform toHost)
        {
            try
            {
                BoundingBoxXYZ bb = e.get_BoundingBox(null);
                if (bb == null) return null;
                if (toHost == null)
                    return new[] { PcUnits.Mm(bb.Min.X), PcUnits.Mm(bb.Min.Y), PcUnits.Mm(bb.Min.Z), PcUnits.Mm(bb.Max.X), PcUnits.Mm(bb.Max.Y), PcUnits.Mm(bb.Max.Z) };
                double minX = double.MaxValue, minY = double.MaxValue, minZ = double.MaxValue, maxX = double.MinValue, maxY = double.MinValue, maxZ = double.MinValue;
                for (int i = 0; i < 8; i++)
                {
                    XYZ c = toHost.OfPoint(new XYZ((i & 1) == 0 ? bb.Min.X : bb.Max.X, (i & 2) == 0 ? bb.Min.Y : bb.Max.Y, (i & 4) == 0 ? bb.Min.Z : bb.Max.Z));
                    minX = Math.Min(minX, c.X); minY = Math.Min(minY, c.Y); minZ = Math.Min(minZ, c.Z);
                    maxX = Math.Max(maxX, c.X); maxY = Math.Max(maxY, c.Y); maxZ = Math.Max(maxZ, c.Z);
                }
                return new[] { PcUnits.Mm(minX), PcUnits.Mm(minY), PcUnits.Mm(minZ), PcUnits.Mm(maxX), PcUnits.Mm(maxY), PcUnits.Mm(maxZ) };
            }
            catch (Exception) { return null; }
        }

        /// <summary>Саад хайх ХҮРЭЭ (дотоод нэгж): хост БҮХЭЛДЭЭ (хаалга хаана ч очиж болно), хөндлөн ба босоо хүрээ хаалганых.  Эргэсэн хост → AABB (цаашид хост координатад шүүнэ).</summary>
        private static Outline SlabRegion(HostGeometry host, DoorBody d)
        {
            double pad = SlabPadMm + host.ThicknessMm;
            double minX = Math.Min(host.StartX, host.EndX) - pad, maxX = Math.Max(host.StartX, host.EndX) + pad;
            double minY = Math.Min(host.StartY, host.EndY) - pad, maxY = Math.Max(host.StartY, host.EndY) + pad;
            double minZ = d.ZMinMm - SlabPadMm, maxZ = Math.Max(d.ZMaxMm, host.ZMaxMm) + SlabPadMm;
            return new Outline(
                new XYZ(PcUnits.ToInternalMm(minX), PcUnits.ToInternalMm(minY), PcUnits.ToInternalMm(minZ)),
                new XYZ(PcUnits.ToInternalMm(maxX), PcUnits.ToInternalMm(maxY), PcUnits.ToInternalMm(maxZ)));
        }

        /// <summary>«Ангилал · Төрөл [Mark]» — ElementId ХАРУУЛАХГҮЙ (энгийн хэрэглэгчид).</summary>
        private static string ObstacleLabel(Element e, ObstacleKind kind)
        {
            string cat = null, name = null;
            try { cat = e.Category != null ? e.Category.Name : null; } catch (Exception) { }
            try
            {
                var fi = e as FamilyInstance;
                name = fi != null && fi.Symbol != null ? fi.Symbol.FamilyName + " : " + fi.Symbol.Name : e.Name;
            }
            catch (Exception) { }
            string mark = PreChangeDoorRules.MarkOf(e);
            string head = string.IsNullOrEmpty(cat) ? ObstacleKinds.Label(kind) : cat;
            return head + (string.IsNullOrEmpty(name) ? "" : " · " + name) + (mark != null ? " [" + mark + "]" : "");
        }

        private static string SafeUid(Element e)
        {
            try { return e.UniqueId; } catch (Exception) { return null; }
        }

        /* ============================== ӨРӨӨ ================================ */

        private static void ReadRooms(Document doc, FamilyInstance door, HostGeometry host, DoorMoveContext ctx)
        {
            try
            {
                var ids = new List<long>();
                if (ctx.Door.FromRoomId > 0) ids.Add(ctx.Door.FromRoomId);
                if (ctx.Door.ToRoomId > 0 && !ids.Contains(ctx.Door.ToRoomId)) ids.Add(ctx.Door.ToRoomId);
                Outline region = SlabRegion(host, ctx.Door);
                foreach (ElementId id in new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Rooms).WhereElementIsNotElementType()
                    .WherePasses(new BoundingBoxIntersectsFilter(region)).ToElementIds())
                    if (!ids.Contains(id.Value) && ids.Count < MaxRooms) ids.Add(id.Value);
                foreach (long id in ids.Take(MaxRooms))
                {
                    Element room = doc.GetElement(new ElementId(id));
                    if (room == null) continue;
                    double[] box = PreChangeDoorRules.ReadBoxMm(room);
                    if (box == null) continue;
                    ctx.Rooms.Add(new ObstacleBox
                    {
                        Id = id, Uid = SafeUid(room), Kind = ObstacleKind.Room, BoxMm = box,
                        Label = room is Autodesk.Revit.DB.Architecture.Room r ? PreChangeWallRules.RoomLabel(r) : "Өрөө",
                    });
                }
            }
            catch (Exception ex)
            {
                ctx.IncompleteReasons.Add("Ойролцоох өрөөг (тодруулгад) уншиж чадсангүй (" + ex.GetType().Name + ").");
            }
        }

        /* ============================== EXACT: нэр дэвшигч өрөө, клэш ======== */

        /// <summary>
        /// Хаалга зөөхөд өөрчлөгдөж болох өрөө: хаалганы ОДООГИЙН From/To + хөдөлгөөний хүрээ (хаалга ∪ шинэ байрлал) дахь өрөө + эцсийн, эхний, дундах цэгийн
        /// ХОЁР ТАЛ дахь өрөө (`GetRoomAtPoint`).  Хана, хаалга зөөхөд өрөөний уншилт ИЖИЛ (`PreChangeCapture.ReadRooms`).
        /// </summary>
        internal static List<long> PlanRooms(Document doc, FamilyInstance door, Wall host, XYZ moveFt, UnenclosedRoomIndex unenclosed, List<string> incomplete)
        {
            var seed = new List<long>();
            long fromId, toId; string fn, tn; bool readable;
            PreChangeDoorRules.ReadRooms(door, out fromId, out toId, out fn, out tn, out readable);
            if (!readable) incomplete.Add("Хаалганы хоёр талын өрөөг (From/To) уншиж чадсангүй.");
            if (fromId > 0) seed.Add(fromId);
            if (toId > 0) seed.Add(toId);

            Outline region = null;
            try
            {
                BoundingBoxXYZ bb = door.get_BoundingBox(null);
                if (bb != null)
                {
                    double pad = PcUnits.ToInternalMm(PreChangeClashProbe.RegionPadMm);
                    region = new Outline(
                        new XYZ(Math.Min(bb.Min.X, bb.Min.X + moveFt.X) - pad, Math.Min(bb.Min.Y, bb.Min.Y + moveFt.Y) - pad, bb.Min.Z - pad),
                        new XYZ(Math.Max(bb.Max.X, bb.Max.X + moveFt.X) + pad, Math.Max(bb.Max.Y, bb.Max.Y + moveFt.Y) + pad, bb.Max.Z + pad));
                }
            }
            catch (Exception) { }
            if (region == null)
            {
                incomplete.Add("Хаалганы хэмжээ (bounding box) уншигдсангүй — нэр дэвшигч өрөөг бүрэн олж чадсангүй.");
            }

            try { seed.AddRange(RoomsAtDoorSides(doc, door, host, moveFt)); }
            catch (Exception ex) { incomplete.Add("Хаалганы хоёр талын өрөөг цэгээр олж чадсангүй (" + ex.GetType().Name + ")."); }
            return PreChangeCapture.PlanRoomsIn(doc, region, incomplete, unenclosed, seed);
        }

        private static IEnumerable<long> RoomsAtDoorSides(Document doc, FamilyInstance door, Wall host, XYZ moveFt)
        {
            var found = new List<long>();
            var lc = host.Location as LocationCurve;
            var line = lc != null ? lc.Curve as Line : null;
            var lp = door.Location as LocationPoint;
            if (line == null || lp == null) return found;
            XYZ d = line.Direction;
            var normal = new XYZ(-d.Y, d.X, 0).Normalize();
            double z = lp.Point.Z + PcUnits.ToInternalMm(1000);
            double off = host.Width / 2.0 + PcUnits.ToInternalMm(200);
            Phase phase = null;
            try { phase = doc.GetElement(door.CreatedPhaseId) as Phase; } catch (Exception) { }

            XYZ start = lp.Point, target = lp.Point + moveFt, mid = (start + target) / 2.0;
            foreach (XYZ p in new[] { target, start, mid })
                foreach (double sign in new[] { 1.0, -1.0 })
                {
                    try
                    {
                        var probe = new XYZ(p.X + normal.X * off * sign, p.Y + normal.Y * off * sign, z);
                        Autodesk.Revit.DB.Architecture.Room r = phase != null ? doc.GetRoomAtPoint(probe, phase) : doc.GetRoomAtPoint(probe);
                        if (r != null && !found.Contains(r.Id.Value)) found.Add(r.Id.Value);
                    }
                    catch (Exception) { /* энэ цэг дээр өрөө тодорхойлогдсонгүй */ }
                }
            return found;
        }

        /// <summary>
        /// ЭНЭ зөөлтийн (хаалга ↔ саад) клэш нэр дэвшигчид: контекстийн саадаас хаалганы ЗАМ, ЭХЛЭЛ, ТӨГСГӨЛД хайрцгаар хүрэх л хоёр.  bbox нь ЗӨВХӨН нэр дэвшигч —
        /// батлагдсан клэшийг `GeometryVerifier` (бодит solid + boolean) шийднэ.
        /// </summary>
        internal static ClashSpec ClashSpecFor(DoorContextData data, double offsetMm)
        {
            var spec = new ClashSpec { Slots = data.Slots };
            DoorMoveContext ctx = data.Ctx;
            foreach (SweepHit h in DoorSweep.Scan(ctx, offsetMm))
            {
                ObstacleBox o = h.Obstacle;
                int slot = -1;
                if (o.LinkInstanceId != 0)
                {
                    slot = data.Slots.FindIndex(s => s.InstanceId == o.LinkInstanceId);
                    if (slot < 0) continue;
                }
                spec.Cands.Add(new ClashCand { ElementId = o.Id, Slot = slot, Kind = o.Kind });
            }
            spec.IncompleteReasons.AddRange(ctx.IncompleteReasons);
            return spec;
        }

        internal static string Describe(DoorMoveContext ctx)
        {
            if (ctx == null) return "";
            return ctx.Openings.Count.ToString(CultureInfo.InvariantCulture) + " нүх, " + ctx.Obstacles.Count.ToString(CultureInfo.InvariantCulture) + " саад, "
                + ctx.Rooms.Count.ToString(CultureInfo.InvariantCulture) + " өрөө";
        }
    }
}
