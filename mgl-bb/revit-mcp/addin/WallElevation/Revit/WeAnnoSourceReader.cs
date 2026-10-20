using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Revit
{
    /// <summary>
    /// Тэмдэглэгээний эх өгөгдөл — сонголтын орчмоос НЭГ удаа, хямд өгөгдлөөр (bounding box, LocationPoint/Curve, параметр):
    /// түвшин, шал/тааз, хананд суусан хаалга/цонх, тэнхлэг, шошголох/хэмжих элемент.  Геометр (get_Geometry) уншихгүй — нүүр
    /// хайх нь зөвхөн үүсгэх үед, дэлгээс бүрийн хэрэгтэй элементэд.  Collector ангилал тус бүрд нэг (bbox шүүлттэй).
    /// </summary>
    internal static class WeAnnoSourceReader
    {
        public static void Read(Document doc, WeRequest req)
        {
            WeAnnoSources s = req.Sources;
            Outline region = Region(req);

            foreach (Level l in new FilteredElementCollector(doc).OfClass(typeof(Level)).Cast<Level>())
                s.Levels.Add(new WeLevelInfo { Id = l.Id.Value, Name = l.Name, Z = LevelZ(l) });
            if (region == null) return;
            var filter = new BoundingBoxIntersectsFilter(region);

            foreach (Element e in new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Floors).WhereElementIsNotElementType().WherePasses(filter))
                AddSlab(s, e, WeSlabKind.Floor);
            foreach (Element e in new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Ceilings).WhereElementIsNotElementType().WherePasses(filter))
                AddSlab(s, e, WeSlabKind.Ceiling);

            foreach (Grid g in new FilteredElementCollector(doc).OfClass(typeof(Grid)).Cast<Grid>())
            {
                var line = g.Curve as Line;
                if (line == null) continue;
                s.Grids.Add(new WeGridInfo { Id = g.Id.Value, Name = g.Name, A = line.GetEndPoint(0).ToWe(), B = line.GetEndPoint(1).ToWe() });
            }

            // Хана: бүх хана (дундах тусгаарлах хана хэвтээ гинжид, дэлгээсийн хана шошгонд).
            var hosts = new HashSet<string>(req.WallLookup.Keys.Concat(req.Walls.Select(w => w.UniqueId)), StringComparer.Ordinal);
            foreach (Wall w in new FilteredElementCollector(doc).OfClass(typeof(Wall)).WherePasses(filter).Cast<Wall>())
            {
                BoundingBoxXYZ bb = w.get_BoundingBox(null);
                if (bb == null) continue;
                var t = new WeTaggable { Id = w.Id.Value, CategoryKey = WeAnno.Walls, Min = bb.Min.ToWe(), Max = bb.Max.ToWe(), WallUid = w.UniqueId, TypeId = TypeOf(w) };
                var lc = w.Location as LocationCurve;
                var line = lc != null ? lc.Curve as Line : null;
                if (line != null)
                {
                    t.HasLine = true;
                    t.LineA = line.GetEndPoint(0).ToWe();
                    t.LineB = line.GetEndPoint(1).ToWe();
                    try { t.Width = w.Width; } catch { t.Width = 0; }
                }
                s.Taggables.Add(t);
                if (hosts.Contains(w.UniqueId)) AddInserts(doc, s, w);
            }
            // Сонгосон хана bbox-оос гадуур байж болохгүй ч (өрөөний хил) — нүхийг заавал уншина.
            var seenWalls = new HashSet<long>(s.Taggables.Where(t => t.CategoryKey == WeAnno.Walls).Select(t => t.Id));
            foreach (string uid in hosts)
            {
                var w = doc.GetElement(uid) as Wall;
                if (w != null && !seenWalls.Contains(w.Id.Value)) AddInserts(doc, s, w);
            }

            var hullWatch = System.Diagnostics.Stopwatch.StartNew();
            var cats = new ElementMulticategoryFilter(WeRevitCategories.Others.Select(kv => kv.Value).ToList());
            var keyOf = WeRevitCategories.Others.ToDictionary(kv => (long)kv.Value, kv => kv.Key);
            foreach (Element e in new FilteredElementCollector(doc).WherePasses(cats).WhereElementIsNotElementType().WherePasses(filter))
            {
                if (e.Category == null) continue;
                string key;
                if (!keyOf.TryGetValue(e.Category.Id.Value, out key)) continue;
                BoundingBoxXYZ bb = e.get_BoundingBox(null);
                if (bb == null) continue;
                if (AddSweepPieces(doc, s, e as WallSweep, key, bb)) continue;
                var tg = new WeTaggable
                {
                    Id = e.Id.Value, CategoryKey = key, Min = bb.Min.ToWe(), Max = bb.Max.ToWe(), TypeId = TypeOf(e),
                    Lighting = e.Category.Id.Value == (long)BuiltInCategory.OST_LightingFixtures,
                };
                if (HullKeys.Contains(key) && hullWatch.ElapsedMilliseconds < HullBudgetMs) AddHull(e, tg);
                s.Taggables.Add(tg);
            }
            if (hullWatch.ElapsedMilliseconds >= HullBudgetMs)
                WeLog.Info("annotate", "тавилгын бүрхүүл: хугацааны хязгаар (" + HullBudgetMs + " мс) — үлдсэн нь хайрцгаар");

            ReadOverheads(doc, s, region);

            // Харах ханад суугаагүй хаалга (АЦӨ-ний тусгаарлах хана, урд талын хана) — шошгонд (жишиг 218D, 227D «Х-6»).  Host ханын бүх
            // нүхийг нэг дор (HostWallUid нь тэр хана тул талын «нүх» болохгүй — зөвхөн шошго).
            try
            {
                foreach (FamilyInstance fi in new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Doors).OfClass(typeof(FamilyInstance))
                                                  .WherePasses(filter).Cast<FamilyInstance>())
                {
                    if (s.Inserts.Any(i => i.Id == fi.Id.Value)) continue;
                    var hw = fi.Host as Wall;
                    if (hw != null) AddInserts(doc, s, hw);
                }
            }
            catch { /* хаалгагүй / уншигдсангүй — шошгогүй */ }
        }

        // ── Тавилгын харагдах геометр (2026-10-14) ───────────────────

        /// <summary>Бодит хэлбэрээр хэмжих ангилал — хайрцаг нь эргүүлсэн/далд геометртэй үед худал болдог.</summary>
        private static readonly HashSet<string> HullKeys = new HashSet<string>(StringComparer.Ordinal)
        {
            "furniture", "casework", "plumbing", "specialty", "generic",
        };

        /// <summary>Нэг дуудлагын нийт хугацааны хязгаар — маш олон/хүнд (импортолсон mesh) тавилгатай өрөөнд хайрцгаар үргэлжилнэ.</summary>
        private const long HullBudgetMs = 4000;
        private const int MaxHullPoints = 200000;
        private static readonly Options HullOptions = new Options { ComputeReferences = false, DetailLevel = ViewDetailLevel.Fine, IncludeNonVisibleObjects = false };

        /// <summary>
        /// Харагдах хатуу бие/mesh-ийн цэгүүдээс план дахь гүдгэр бүрхүүл + босоо муж.  Шугам (symbolic, clearance), далд геометр, нэр нь
        /// «clearance»-тай дэд ангиллын бие орохгүй.  Nested family-г дагана.  Амжилттай бол хайрцгийг ч бодит хэлбэрээр сольж (шошго,
        /// танилт ижил хэмжээгээр), алдаа гарвал хайрцаг хэвээр.
        /// </summary>
        private static void AddHull(Element e, WeTaggable t)
        {
            try
            {
                GeometryElement ge = e.get_Geometry(HullOptions);
                if (ge == null) return;
                var pts = new List<WeV3>();
                double zLo = double.MaxValue, zHi = double.MinValue;
                Collect(e.Document, ge, pts, ref zLo, ref zHi, 0);
                if (pts.Count == 0 || zHi < zLo) return;
                List<WeV3> hull = WeHull.Convex(pts);
                if (hull.Count == 0) return;
                t.Hull = hull;
                t.HullBottomZ = zLo;
                t.HullTopZ = zHi;
                t.Min = new WeV3(hull.Min(h => h.X), hull.Min(h => h.Y), zLo);
                t.Max = new WeV3(hull.Max(h => h.X), hull.Max(h => h.Y), zHi);
            }
            catch (Exception ex)
            {
                WeLog.Info("annotate", "бүрхүүл #" + e.Id.Value + ": " + ex.Message);
            }
        }

        private static void Collect(Document doc, GeometryElement ge, List<WeV3> pts, ref double zLo, ref double zHi, int depth)
        {
            if (ge == null || depth > 8) return;
            foreach (GeometryObject go in ge)
            {
                if (pts.Count >= MaxHullPoints) return;
                if (Clearance(doc, go)) continue;
                var solid = go as Solid;
                if (solid != null)
                {
                    if (solid.Faces.Size == 0 || solid.Volume <= 1e-9) continue;
                    foreach (Edge edge in solid.Edges)
                    {
                        IList<XYZ> tes;
                        try { tes = edge.Tessellate(); } catch { continue; }
                        foreach (XYZ q in tes) Add(q, pts, ref zLo, ref zHi);
                    }
                    continue;
                }
                var mesh = go as Mesh;
                if (mesh != null)
                {
                    foreach (XYZ q in mesh.Vertices) Add(q, pts, ref zLo, ref zHi);
                    continue;
                }
                var gi = go as GeometryInstance;
                if (gi != null)
                {
                    GeometryElement inner;
                    try { inner = gi.GetInstanceGeometry(); } catch { continue; }
                    Collect(doc, inner, pts, ref zLo, ref zHi, depth + 1);
                }
            }
        }

        private static void Add(XYZ q, List<WeV3> pts, ref double zLo, ref double zHi)
        {
            pts.Add(new WeV3(q.X, q.Y, 0));
            if (q.Z < zLo) zLo = q.Z;
            if (q.Z > zHi) zHi = q.Z;
        }

        /// <summary>Тавилгын «Clearance» (суух/нээх зай) дэд ангилал — дэлгээс дээр зурагддаггүй, хэмжээсийг томсгоно.</summary>
        private static bool Clearance(Document doc, GeometryObject go)
        {
            try
            {
                if (go.GraphicsStyleId == null || go.GraphicsStyleId == ElementId.InvalidElementId) return false;
                var gs = doc.GetElement(go.GraphicsStyleId) as GraphicsStyle;
                string name = gs != null && gs.GraphicsStyleCategory != null ? gs.GraphicsStyleCategory.Name : null;
                return !string.IsNullOrEmpty(name) && name.IndexOf("clearance", StringComparison.OrdinalIgnoreCase) >= 0;
            }
            catch { return false; }
        }

        /// <summary>
        /// Олон ханыг дагасан шалны хүрээ (ХЭМЖСЭН MITIC 215: «Карниз Х-8» 6 өнгөлгөөний ханыг L хэлбэрээр тойрно) — хайрцаг нь өрөөг бүхэлд
        /// нь хамарч «гадаргуу дээрх нимгэн элемент» шалгалтад унадаг байв.  Host хана тус бүрээр хэсэг: шугам = ханын location line, өндөр =
        /// хүрээний хайрцгаас, зузаан = хана + хоёр талдаа 40 мм (профиль).  Ганц host-той бол хуучнаараа (хайрцгаар).
        /// </summary>
        private static bool AddSweepPieces(Document doc, WeAnnoSources s, WallSweep ws, string key, BoundingBoxXYZ bb)
        {
            if (ws == null) return false;
            IList<ElementId> hosts;
            try { hosts = ws.GetHostIds(); } catch { return false; }
            if (hosts == null || hosts.Count < 2) return false;
            long type = TypeOf(ws);
            int added = 0;
            foreach (ElementId hid in hosts)
            {
                var w = doc.GetElement(hid) as Wall;
                var line = w != null && w.Location is LocationCurve ? ((LocationCurve)w.Location).Curve as Line : null;
                if (line == null) continue;
                XYZ a = line.GetEndPoint(0), c = line.GetEndPoint(1);
                double width;
                try { width = w.Width; } catch { width = 0; }
                width += 2 * 40 / 304.8;
                s.Taggables.Add(new WeTaggable
                {
                    Id = ws.Id.Value, CategoryKey = key, TypeId = type, HasLine = true, Width = width,
                    LineA = new XYZ(a.X, a.Y, bb.Min.Z).ToWe(), LineB = new XYZ(c.X, c.Y, bb.Min.Z).ToWe(),
                    Min = new XYZ(Math.Min(a.X, c.X), Math.Min(a.Y, c.Y), bb.Min.Z).ToWe(),
                    Max = new XYZ(Math.Max(a.X, c.X), Math.Max(a.Y, c.Y), bb.Max.Z).ToWe(),
                });
                added++;
            }
            return added > 0;
        }

        /// <summary>
        /// Таазны дээрх трибун/шатыг танихад (<see cref="WeAnnoSources.Overheads"/>): host + ачаалагдсан link бүрийн шат, хашлага, налуу
        /// зам, мөн link-ийн шал, тавилга, ерөнхий модел (host-ынх нь Slabs/Taggables-д аль хэдийн байгаа).  ХЭМЖСЭН (MAX ӨРГӨӨ INT_B,
        /// 2026-10-13): интерьерийн файлд трибун, шат архитектурын LINK-д, суудал host-д.  Хайрцаг нь host-ын координатад (link-ийн
        /// хувиргалтын 8 оройгоор тэнхлэгт зэрэгцүүлсэн).  Уншиж чадаагүй бол юу ч нэмэхгүй (таслахгүй — өмнөх зан төлөв).
        /// </summary>
        private static void ReadOverheads(Document doc, WeAnnoSources s, Outline region)
        {
            var stairCats = new List<BuiltInCategory> { BuiltInCategory.OST_Stairs, BuiltInCategory.OST_StairsRailing, BuiltInCategory.OST_Ramps };
            var linkCats = new Dictionary<BuiltInCategory, string>
            {
                { BuiltInCategory.OST_Stairs, "stairs" }, { BuiltInCategory.OST_StairsRailing, "stairs" }, { BuiltInCategory.OST_Ramps, "stairs" },
                { BuiltInCategory.OST_Floors, "floors" }, { BuiltInCategory.OST_Furniture, "other" }, { BuiltInCategory.OST_GenericModel, "other" },
            };
            try
            {
                foreach (Element e in new FilteredElementCollector(doc).WherePasses(new ElementMulticategoryFilter(stairCats))
                                          .WhereElementIsNotElementType().WherePasses(new BoundingBoxIntersectsFilter(region)))
                {
                    BoundingBoxXYZ bb = e.get_BoundingBox(null);
                    if (bb != null) s.Overheads.Add(new WeTaggable { Id = e.Id.Value, CategoryKey = "stairs", Min = bb.Min.ToWe(), Max = bb.Max.ToWe() });
                }
            }
            catch (Exception ex) { WeLog.Info("annotate", "шат, хашлага уншсангүй — " + ex.Message); }

            foreach (RevitLinkInstance li in new FilteredElementCollector(doc).OfClass(typeof(RevitLinkInstance)).Cast<RevitLinkInstance>())
            {
                try
                {
                    Document ld = li.GetLinkDocument();
                    if (ld == null) continue;
                    Transform tf = li.GetTotalTransform();
                    Outline local = BoxOf(tf.Inverse, region.MinimumPoint, region.MaximumPoint);
                    var filter = new BoundingBoxIntersectsFilter(local);
                    var keyOf = linkCats.ToDictionary(kv => (long)kv.Key, kv => kv.Value);
                    foreach (Element e in new FilteredElementCollector(ld).WherePasses(new ElementMulticategoryFilter(linkCats.Keys.ToList()))
                                              .WhereElementIsNotElementType().WherePasses(filter))
                    {
                        string key;
                        if (e.Category == null || !keyOf.TryGetValue(e.Category.Id.Value, out key)) continue;
                        BoundingBoxXYZ bb = e.get_BoundingBox(null);
                        if (bb == null) continue;
                        Outline w = BoxOf(tf, bb.Min, bb.Max);
                        s.Overheads.Add(new WeTaggable { Id = e.Id.Value, CategoryKey = key, Min = w.MinimumPoint.ToWe(), Max = w.MaximumPoint.ToWe() });
                    }
                }
                catch (Exception ex) { WeLog.Info("annotate", "link «" + li.Name + "»-ийн шат, шал уншсангүй — " + ex.Message); }
            }
        }

        /// <summary>Хайрцгийн 8 оройг хувиргаад тэнхлэгт зэрэгцсэн хайрцаг.</summary>
        private static Outline BoxOf(Transform tf, XYZ a, XYZ b)
        {
            double x0 = double.MaxValue, y0 = double.MaxValue, z0 = double.MaxValue, x1 = double.MinValue, y1 = double.MinValue, z1 = double.MinValue;
            foreach (double x in new[] { a.X, b.X })
                foreach (double y in new[] { a.Y, b.Y })
                    foreach (double z in new[] { a.Z, b.Z })
                    {
                        XYZ p = tf.OfPoint(new XYZ(x, y, z));
                        x0 = Math.Min(x0, p.X); y0 = Math.Min(y0, p.Y); z0 = Math.Min(z0, p.Z);
                        x1 = Math.Max(x1, p.X); y1 = Math.Max(y1, p.Y); z1 = Math.Max(z1, p.Z);
                    }
            return new Outline(new XYZ(x0, y0, z0), new XYZ(x1, y1, z1));
        }

        private static long TypeOf(Element e)
        {
            try { ElementId t = e.GetTypeId(); return t != null && t != ElementId.InvalidElementId ? t.Value : 0; }
            catch { return 0; }
        }

        /// <summary>
        /// Түвшний ДОТООД (геометрийн) өндөр.  <c>Level.Elevation</c> нь «Elevation Base» (Survey Point байж болно)-оос хамаардаг тул
        /// геометртэй харьцуулахад <c>ProjectElevation</c> (дотоод эхлэлээс).
        /// </summary>
        public static double LevelZ(Level l)
        {
            try { return l.ProjectElevation; } catch { return l.Elevation; }
        }

        private static Outline Region(WeRequest req)
        {
            var pts = new List<WeV3>();
            double zLo = double.MaxValue, zHi = double.MinValue;
            foreach (WeRoomInfo r in req.Rooms)
            {
                foreach (WeRoomLoop loop in r.Loops)
                    foreach (WeBoundarySegment seg in loop.Segments) { pts.Add(seg.A); pts.Add(seg.B); }
                zLo = Math.Min(zLo, r.BottomZ);
                zHi = Math.Max(zHi, r.TopZ);
            }
            foreach (WeWallInfo w in req.Walls)
            {
                if (!w.HasLocationLine) continue;
                pts.Add(w.Start);
                pts.Add(w.End);
                zLo = Math.Min(zLo, w.BottomZ);
                zHi = Math.Max(zHi, w.TopZ);
            }
            if (pts.Count == 0) return null;
            const double pad = 1.0 / 0.3048;   // 1 м
            double x0 = pts.Min(p => p.X) - pad, x1 = pts.Max(p => p.X) + pad;
            double y0 = pts.Min(p => p.Y) - pad, y1 = pts.Max(p => p.Y) + pad;
            // Доор: шалны хавтан; дээр: дээд давхрын хучилт (давхар ≤ 10 м).
            return new Outline(new XYZ(x0, y0, zLo - 3 / 0.3048), new XYZ(x1, y1, zHi + 10 / 0.3048));
        }

        private static void AddSlab(WeAnnoSources s, Element e, WeSlabKind kind)
        {
            BoundingBoxXYZ bb = e.get_BoundingBox(null);
            if (bb == null) return;
            List<WeSlabPlane> planes;
            List<List<List<WeV3>>> faces = PlanFaces(e as HostObject, kind == WeSlabKind.Floor, out planes);
            s.Slabs.Add(new WeSlabInfo { Id = e.Id.Value, Kind = kind, Min = bb.Min.ToWe(), Max = bb.Max.ToWe(), Faces = faces, Planes = planes });
            var t = new WeTaggable
            {
                Id = e.Id.Value,
                CategoryKey = kind == WeSlabKind.Floor ? WeAnno.Floors : WeAnno.Ceilings,
                Min = bb.Min.ToWe(),
                Max = bb.Max.ToWe(),
            };
            s.Taggables.Add(t);
        }

        /// <summary>
        /// W08: налуу нүүрийг (налуу шал, налуу тааз, налуу зам) хэмжих нүүрт тооцох нормалийн хамгийн бага |Z| — үүнээс эгц нүүр (ирмэг, хана мэт)
        /// шал/тааз биш.  ≈ 84°.
        /// </summary>
        private const double MinSlopeNormalZ = 0.1;

        /// <summary>
        /// Хэмжих нүүрний (шал — дээд, тааз — доод) контурууд план дээр + нүүр бүрийн ХАВТГАЙ (W08: хэвтээ ба налуу; <see cref="WeSlabPlane"/>).
        /// Хавтгай биш (муруй, хэлбэр засварласан) нүүр орохгүй.  Уншиж чадахгүй бол null (хайрцгаар).
        /// </summary>
        private static List<List<List<WeV3>>> PlanFaces(HostObject ho, bool top, out List<WeSlabPlane> planes)
        {
            planes = null;
            if (ho == null) return null;
            try
            {
                IList<Reference> refs = top ? HostObjectUtils.GetTopFaces(ho) : HostObjectUtils.GetBottomFaces(ho);
                var faces = new List<List<List<WeV3>>>();
                var pls = new List<WeSlabPlane>();
                foreach (Reference r in refs ?? new List<Reference>())
                {
                    var pf = ho.GetGeometryObjectFromReference(r) as PlanarFace;
                    if (pf == null || Math.Abs(pf.FaceNormal.Z) < MinSlopeNormalZ) continue;
                    var loops = new List<List<WeV3>>();
                    foreach (EdgeArray ea in pf.EdgeLoops)
                    {
                        var pts = new List<WeV3>();
                        foreach (Edge ed in ea)
                        {
                            IList<XYZ> tes = ed.Tessellate();
                            for (int i = 0; i + 1 < tes.Count; i++) pts.Add(new WeV3(tes[i].X, tes[i].Y, 0));
                        }
                        if (pts.Count >= 3) loops.Add(pts);
                    }
                    if (loops.Count > 0)
                    {
                        faces.Add(loops);
                        pls.Add(new WeSlabPlane { Origin = pf.Origin.ToWe(), Normal = pf.FaceNormal.ToWe() });
                    }
                }
                if (faces.Count == 0) return null;
                planes = pls;
                return faces;
            }
            catch { planes = null; return null; }
        }

        private static void AddInserts(Document doc, WeAnnoSources s, Wall w)
        {
            if (s.Inserts.Any(i => i.HostWallUid == w.UniqueId)) return;
            IList<ElementId> ids;
            try { ids = w.FindInserts(true, false, false, false); } catch { return; }
            var lc = w.Location as LocationCurve;
            var line = lc != null ? lc.Curve as Line : null;
            XYZ tangent = line != null ? line.Direction : XYZ.BasisX;
            foreach (ElementId id in ids)
            {
                var fi = doc.GetElement(id) as FamilyInstance;
                if (fi == null || fi.Category == null) continue;
                long cat = fi.Category.Id.Value;
                WeInsertKind kind;
                if (cat == (long)BuiltInCategory.OST_Doors) kind = WeInsertKind.Door;
                else if (cat == (long)BuiltInCategory.OST_Windows) kind = WeInsertKind.Window;
                else continue;
                BoundingBoxXYZ bb = fi.get_BoundingBox(null);
                var lp = fi.Location as LocationPoint;
                XYZ c = lp != null ? lp.Point : bb != null ? (bb.Min + bb.Max) / 2 : null;
                if (c == null) continue;

                double width = Param(fi, BuiltInParameter.FAMILY_WIDTH_PARAM, BuiltInParameter.DOOR_WIDTH, BuiltInParameter.WINDOW_WIDTH,
                                     BuiltInParameter.FAMILY_ROUGH_WIDTH_PARAM);
                if (!(width > 0) && bb != null)
                {
                    double lo = double.MaxValue, hi = double.MinValue;
                    foreach (XYZ p in new[] { bb.Min, bb.Max, new XYZ(bb.Min.X, bb.Max.Y, 0), new XYZ(bb.Max.X, bb.Min.Y, 0) })
                    {
                        double d = new XYZ(p.X - c.X, p.Y - c.Y, 0).DotProduct(tangent);
                        lo = Math.Min(lo, d);
                        hi = Math.Max(hi, d);
                    }
                    width = hi - lo;
                }
                double baseZ = c.Z;
                var lvl = doc.GetElement(fi.LevelId) as Level;
                if (lvl != null) baseZ = LevelZ(lvl);
                double sill = Param(fi, BuiltInParameter.INSTANCE_SILL_HEIGHT_PARAM);
                double head = Param(fi, BuiltInParameter.INSTANCE_HEAD_HEIGHT_PARAM);
                double bottom = !double.IsNaN(sill) && lvl != null ? baseZ + sill : bb != null ? bb.Min.Z : c.Z;
                double top = head > 0 && lvl != null ? baseZ + head : bb != null ? bb.Max.Z : c.Z;
                s.Inserts.Add(new WeInsertInfo
                {
                    Id = fi.Id.Value, Kind = kind, HostWallUid = w.UniqueId,
                    Center = c.ToWe(), HalfWidth = Math.Max(0, width) / 2, BottomZ = bottom, TopZ = top,
                });
                if (bb != null)
                    s.Taggables.Add(new WeTaggable
                    {
                        Id = fi.Id.Value, CategoryKey = kind == WeInsertKind.Door ? WeAnno.Doors : WeAnno.Windows,
                        Min = bb.Min.ToWe(), Max = bb.Max.ToWe(),
                    });
            }
        }

        /// <summary>Эхний эерэг утга (instance, дараа нь type).  Олдохгүй бол NaN.</summary>
        private static double Param(FamilyInstance fi, params BuiltInParameter[] bips)
        {
            Element type = null;
            try { type = fi.Document.GetElement(fi.GetTypeId()); } catch { }
            foreach (BuiltInParameter bip in bips)
                foreach (Element e in new[] { (Element)fi, type })
                {
                    if (e == null) continue;
                    try
                    {
                        Parameter p = e.get_Parameter(bip);
                        if (p != null && p.HasValue && p.StorageType == StorageType.Double)
                        {
                            double v = p.AsDouble();
                            if (bip == BuiltInParameter.INSTANCE_SILL_HEIGHT_PARAM ? v >= 0 : v > 0) return v;
                        }
                    }
                    catch { }
                }
            return double.NaN;
        }
    }
}
