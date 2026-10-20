using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.AutoAnnotate.Core;

namespace RevitMcpAddin.AutoAnnotate
{
    /// <summary>
    /// ПЛАНЫ ХЭМЖЭЭС — ажлын зургийн (ГОСТ 21.501 / MNS) бүтцээр:
    ///
    ///   Барилгын тал бүрд гаднаас нь гурван гинж:
    ///     1. Гадна хана — булан, цонх/хаалганы нүх, тэнхлэгийн холболт (хамгийн ойр).
    ///     2. Зэргэлдээ тэнхлэг хоорондын зай.
    ///     3. Хамгийн захын тэнхлэг хоорондын нийт хэмжээ (хамгийн гадна).
    ///   Тэнхлэгийн бөмбөлгийг 3-р гинжээс цааш гаргана (зөвхөн энэ харагдацад).
    ///
    ///   Дотор: тэнхлэг хоорондын зайн дундаар хана хөндлөн гарах гинж (хананы зузаан,
    ///   өрөөний цэвэр хэмжээ, тэнхлэгийн холболт); дотор хананы хаалганы нүх ба ойрын
    ///   ханаас холболт; багана бүрийг ойрын тэнхлэгт холбох.
    ///
    /// Бүх зай ЦААСААР (мм) — масштаб солигдоход зураг ижил харагдана.
    /// </summary>
    internal static class AaPlanDims
    {
        public static void Run(ViewData d, AaOptions o, AaReport rep, DimensionType type)
        {
            AaFrame f = d.F;
            Side[] sides = o.AllSides ? AaFrame.AllSides : new[] { Side.Bottom, o.RightSide ? Side.Right : Side.Left };
            var byKey = d.Walls.ToDictionary(w => w.Seg.Key);
            List<WallSeg> straight = d.Walls.Where(w => w.Dimensionable).Select(w => w.Seg).ToList();
            var touchCache = new Dictionary<int, List<Touch>>();
            Func<WallData, List<Touch>> touching = w =>
            {
                if (!touchCache.TryGetValue(w.Seg.Key, out List<Touch> t))
                    touchCache[w.Seg.Key] = t = Walls.Touching(w.Seg, straight);
                return t;
            };

            // «Зөвхөн сонгосон» горимд тэнхлэгийн гинж нь тэнхлэг өөрөө сонгогдсон үед л — 3 хаалга
            // сонгосон хүн бүх тэнхлэгийн гинжийг дахин хүлээхгүй.
            bool gridsInScope = d.Scope == null || d.Grids.Any(g => d.In(g.Grid, g.Src));
            var lastSlot = new Dictionary<Side, int>();
            foreach (Side s in sides)
            {
                int slot = 0;
                V2 along = f.Along(s), outward = f.Outward(s);
                double edge = d.Building.Edge(s);
                List<GridData> perp = d.Grids.Where(g => Dir.Parallel(g.Dir, outward)).ToList();
                // (налуу тэнхлэгийг Chain.KeepParallel AaDim.Create дотор шүүнэ)

                if (o.FacadeDims)
                {
                    List<ChainItem> facade = FacadeChain(d, s, byKey, touching, perp);
                    if (facade.Count >= 2 && facade.Any(i => i.Kind != "grid"))
                    {
                        if (AaDim.Create(d, facade, along, outward, edge + d.Feet(o.FirstMm + o.StepMm * slot), type, rep, "Фасадын хэмжээс (" + SideName(s) + ")") != null)
                        {
                            rep.DimsFacade++;
                            slot++;
                        }
                    }
                }

                if (o.GridDims && gridsInScope && perp.Count >= 2)
                {
                    List<ChainItem> gridChain = perp.Select(g => new ChainItem(g.Seg.A.Dot(along), Chain.PriorityGrid, g.Ref, "grid").WithNormal(g.Dir.Perp())).ToList();
                    List<ChainItem> norm = Chain.Normalize(Chain.KeepParallel(gridChain), AaDim.Tol);
                    if (norm.Count >= 2)
                    {
                        if (o.GridChain && norm.Count > 2
                            && AaDim.Create(d, norm, along, outward, edge + d.Feet(o.FirstMm + o.StepMm * slot), type, rep, "Тэнхлэгийн хэмжээс (" + SideName(s) + ")") != null)
                        {
                            rep.DimsGrid++;
                            slot++;
                        }
                        if (AaDim.Create(d, Chain.Overall(norm), along, outward, edge + d.Feet(o.FirstMm + o.StepMm * slot), type, rep, "Нийт хэмжээс (" + SideName(s) + ")") != null)
                        {
                            rep.DimsOverall++;
                            slot++;
                        }
                    }
                }
                lastSlot[s] = slot - 1;
            }

            if (o.ExtendGrids)
                ExtendGrids(d, o, rep, lastSlot);
            if (o.InteriorDims)
                InteriorChains(d, o, rep, type);
            if (o.DoorDims)
                DoorChains(d, o, rep, type, byKey, touching);
            if (o.ColumnTies)
                ColumnTies(d, o, rep, type);
        }

        internal static string SideName(Side s)
        {
            switch (s)
            {
                case Side.Bottom: return "доод";
                case Side.Top: return "дээд";
                case Side.Left: return "зүүн";
                default: return "баруун";
            }
        }

        // ── 1. Гадна хананы гинж ─────────────────────────────────────────

        private static List<ChainItem> FacadeChain(ViewData d, Side s, Dictionary<int, WallData> byKey,
            Func<WallData, List<Touch>> touching, List<GridData> perpGrids)
        {
            V2 along = d.F.Along(s);
            var items = new List<ChainItem>();
            Func<int, Exposure> expOf = k => byKey.TryGetValue(k, out WallData w) ? w.Exp : Exposure.None;
            foreach (WallData w in d.Walls)
            {
                if (!w.Dimensionable || !w.InScope || w.Exp == Exposure.None)
                    continue;
                foreach (Exposure e in new[] { Exposure.Left, Exposure.Right })
                {
                    if ((w.Exp & e) == 0)
                        continue;
                    V2 n = w.Seg.Normal(e);
                    if (d.F.SideOf(n) != s)
                        continue;

                    List<Touch> t = touching(w);
                    for (int end = 0; end < 2; end++)
                    {
                        List<Touch> atEnd = Walls.AtEnd(w.Seg, t, end);
                        Tuple<WallSeg, Exposure> corner = Walls.ExteriorCorner(w.Seg, atEnd, expOf, end);
                        if (corner != null && byKey.TryGetValue(corner.Item1.Key, out WallData p) && p.Dimensionable)
                        {
                            FaceRef face = p.SideFace(corner.Item2);
                            items.Add(new ChainItem(face.Origin.Dot(along), Chain.PriorityCorner, face.Ref, "corner").WithNormal(face.Normal));
                        }
                        else if (atEnd.Count == 0)
                        {
                            FaceRef own = EndFace(w, end);
                            if (own != null)
                                items.Add(new ChainItem(own.Origin.Dot(along), Chain.PriorityCorner, own.Ref, "end").WithNormal(own.Normal));
                        }
                    }

                    double plane = w.SidePlane(e);
                    foreach (OpeningData od in w.Openings)
                    {
                        if (!od.InScope)
                            continue;
                        V2 mid = w.Seg.Line.A + w.Seg.Dir * od.Pos;
                        if (!Exterior.Escapes(mid + n * (w.Seg.Half + Exterior.Eps), n, d.Blockers, w.Seg.Key))
                            continue; // нүх нь өөр ханын ард — энэ фасадаас харагдахгүй
                        AddOpeningEdges(items, w, od, plane, along);
                    }
                }
            }
            if (items.Count == 0)
                return items;
            double mn = items.Min(i => i.Pos), mx = items.Max(i => i.Pos);
            foreach (GridData g in perpGrids)
            {
                double p = g.Seg.A.Dot(along);
                if (p >= mn - AaDim.Tol && p <= mx + AaDim.Tol)
                    items.Add(new ChainItem(p, Chain.PriorityGrid, g.Ref, "grid").WithNormal(g.Dir.Perp()));
            }
            return Chain.Normalize(Chain.KeepParallel(items), AaDim.Tol);
        }

        /// <summary>Нүхний хоёр ирмэг — хананы тухайн талд хүрч буй хажуу нүүр; олдохгүй бол family-ийн Left/Right хавтгай.</summary>
        private static void AddOpeningEdges(List<ChainItem> items, WallData w, OpeningData od, double plane, V2 along)
        {
            List<FaceRef> jambs = od.Jambs.Where(j => j.NMin - 0.05 <= plane && plane <= j.NMax + 0.05).ToList();
            if (jambs.Count == 0)
                jambs = od.Jambs.ToList();
            if (jambs.Count >= 2)
            {
                // Нүхний хамгийн захын хоёр нүүр (шаталсан хүрээтэй бол тухайн талынх).
                FaceRef lo = jambs.OrderBy(j => w.PosOf(j.Origin)).First();
                FaceRef hi = jambs.OrderBy(j => w.PosOf(j.Origin)).Last();
                items.Add(new ChainItem(lo.Origin.Dot(along), Chain.PriorityFace, lo.Ref, "jamb").WithNormal(lo.Normal));
                items.Add(new ChainItem(hi.Origin.Dot(along), Chain.PriorityFace, hi.Ref, "jamb").WithNormal(hi.Normal));
                return;
            }
            // Нүүр олдоогүй (family ханыг огтолдоггүй г.м.) — Left/Right лавлагааны хавтгай.
            Reference l = Lk.FirstRef(od.Fi, FamilyInstanceReferenceType.Left, od.Src);
            Reference r = Lk.FirstRef(od.Fi, FamilyInstanceReferenceType.Right, od.Src);
            if (l == null || r == null)
                return;
            V2 a = w.Seg.Line.A + w.Seg.Dir * od.Min, b = w.Seg.Line.A + w.Seg.Dir * od.Max;
            // Family-ийн X тэнхлэг хананы чиглэлтэй эсрэг бол Left нь «их» талд.
            V2 hand = Lk.Vec2(od.Src, od.Fi.HandOrientation);
            bool flipped = hand.Dot(w.Seg.Dir) < 0;
            items.Add(new ChainItem((flipped ? b : a).Dot(along), Chain.PriorityFace, l, "jamb").WithNormal(hand));
            items.Add(new ChainItem((flipped ? a : b).Dot(along), Chain.PriorityFace, r, "jamb").WithNormal(hand));
        }

        /// <summary>Чөлөөт үзүүрийн нүүр — нүхэнд хуваарилагдаагүй, үзүүрт хамгийн ойр (≤ 6 см).</summary>
        private static FaceRef EndFace(WallData w, int end)
        {
            double at = end == 0 ? 0 : w.Seg.Line.Length;
            var jambs = new HashSet<FaceRef>(w.Openings.SelectMany(o => o.Jambs));
            FaceRef best = null;
            double bd = 0.2;
            foreach (FaceRef f in w.AlongFaces)
            {
                if (jambs.Contains(f))
                    continue;
                double dist = Math.Abs(w.PosOf(f.Origin) - at);
                if (dist < bd)
                {
                    bd = dist;
                    best = f;
                }
            }
            return best;
        }

        // ── Тэнхлэгийн бөмбөлөг ─────────────────────────────────────────

        private static void ExtendGrids(ViewData d, AaOptions o, AaReport rep, Dictionary<Side, int> lastSlot)
        {
            foreach (KeyValuePair<Side, int> kv in lastSlot)
            {
                if (kv.Value < 0)
                    continue;
                V2 outward = d.F.Outward(kv.Key);
                double need = d.Building.Edge(kv.Key) + d.Feet(o.FirstMm + o.StepMm * kv.Value + 5);
                // Link-ийн тэнхлэгийг энэ файлаас уртасгах боломжгүй — хостынхыг л.
                foreach (GridData g in d.Grids.Where(x => x.Src == null && Dir.Parallel(x.Dir, outward)))
                    AaDim.ExtendDatum(d, g.Grid, outward, need, rep);
            }
        }

        // ── 2. Дотор хөндлөн гинж ───────────────────────────────────────

        private static void InteriorChains(ViewData d, AaOptions o, AaReport rep, DimensionType type)
        {
            AaFrame f = d.F;
            List<V2> roomPts = d.Rooms.Where(r => d.In(r.Room, r.Src)).Select(r => new V2(r.Pt.X, r.Pt.Y)).ToList();
            var seen = new HashSet<string>();
            foreach (V2 t in new[] { f.U, f.V })
            {
                V2 nrm = t.Perp();
                // Тэнхлэгийн алхам: гинжтэй ПАРАЛЛЕЛЬ тэнхлэгүүд (хэвтээ гинж → хэвтээ тэнхлэгүүд хооронд).
                List<double> coords = d.Grids.Where(g => Dir.Parallel(g.Dir, t)).Select(g => g.Seg.A.Dot(nrm))
                    .OrderBy(x => x).ToList();
                if (coords.Count < 2)
                    continue;
                List<GridData> perp = d.Grids.Where(g => Dir.Parallel(g.Dir, nrm)).ToList();
                double clear = d.Feet(5), step = d.Feet(3), margin = d.Feet(6);
                for (int i = 0; i + 1 < coords.Count; i++)
                {
                    double lo = coords[i], hi = coords[i + 1];
                    if (hi - lo < d.Feet(15))
                        continue;
                    List<double> obstacles = roomPts.Where(p => p.Dot(nrm) > lo && p.Dot(nrm) < hi).Select(p => p.Dot(nrm)).ToList();
                    double? c = ScanLines.Avoid((lo + hi) / 2, lo, hi, obstacles, clear, step, margin);
                    if (!c.HasValue)
                        continue;
                    var items = new List<ChainItem>();
                    bool interior = false;
                    foreach (WallData w in d.Walls)
                    {
                        if (!w.Dimensionable || !w.InScope || !Dir.Parallel(w.Seg.Dir, nrm))
                            continue;
                        double s0 = w.Seg.Line.A.Dot(nrm), s1 = w.Seg.Line.B.Dot(nrm);
                        if (c.Value < Math.Min(s0, s1) + 0.02 || c.Value > Math.Max(s0, s1) - 0.02)
                            continue;
                        items.Add(new ChainItem(w.LeftFace.Origin.Dot(t), Chain.PriorityFace, w.LeftFace.Ref, "face").WithNormal(w.LeftFace.Normal));
                        items.Add(new ChainItem(w.RightFace.Origin.Dot(t), Chain.PriorityFace, w.RightFace.Ref, "face").WithNormal(w.RightFace.Normal));
                        if (w.Exp == Exposure.None)
                            interior = true;
                    }
                    if (!interior || items.Count < 4)
                        continue;
                    double mn = items.Min(x => x.Pos), mx = items.Max(x => x.Pos);
                    foreach (GridData g in perp)
                    {
                        double p = g.Seg.A.Dot(t);
                        if (p >= mn - AaDim.Tol && p <= mx + AaDim.Tol)
                            items.Add(new ChainItem(p, Chain.PriorityGrid, g.Ref, "grid").WithNormal(g.Dir.Perp()));
                    }
                    List<ChainItem> norm = Chain.Normalize(Chain.KeepParallel(items), AaDim.Tol);
                    string sig = (t.X > t.Y ? "U" : "V") + Chain.Signature(norm, AaDim.Tol);
                    if (norm.Count < 3 || !seen.Add(sig))
                        continue;
                    if (AaDim.Create(d, norm, t, nrm, c.Value, type, rep, "Дотор хэмжээс") != null)
                        rep.DimsInterior++;
                }
            }
        }

        // ── 3. Дотор хаалганы нүх ───────────────────────────────────────

        private static void DoorChains(ViewData d, AaOptions o, AaReport rep, DimensionType type,
            Dictionary<int, WallData> byKey, Func<WallData, List<Touch>> touching)
        {
            foreach (WallData w in d.Walls)
            {
                if (!w.Dimensionable || w.Exp != Exposure.None)
                    continue;
                List<OpeningData> ops = w.Openings.Where(x => x.InScope).ToList();
                // Зөвхөн хаалгатай хана: цонхтой «дотор» хана нь ихэвчлэн давхар фасадын дотор давхарга —
                // түүний нүх гадна гинжинд аль хэдийн орсон.
                if (!ops.Any(x => x.Door))
                    continue;
                // Хэмжээсийг хаалганы «нүүр» талд (эргэлтийн нуман талын эсрэг) — бөөгнөрөл бага.
                int vote = 0;
                foreach (OpeningData od in ops)
                {
                    vote += Lk.Vec2(od.Src, od.Fi.FacingOrientation).Dot(w.Seg.LeftNormal) >= 0 ? 1 : -1;
                }
                Exposure side = vote >= 0 ? Exposure.Left : Exposure.Right;
                double plane = w.SidePlane(side);
                V2 dir = w.Seg.Dir, left = w.Seg.LeftNormal;

                var items = new List<ChainItem>();
                List<Touch> t = touching(w);
                foreach (OpeningData od in ops)
                {
                    AddOpeningEdges(items, w, od, plane, dir);
                    Touch lo = t.Where(x => x.Pos < od.Min).OrderByDescending(x => x.Pos).FirstOrDefault();
                    Touch hi = t.Where(x => x.Pos > od.Max).OrderBy(x => x.Pos).FirstOrDefault();
                    AddBound(items, w, lo, od, byKey, 0, dir);
                    AddBound(items, w, hi, od, byKey, 1, dir);
                }
                List<ChainItem> norm = Chain.Normalize(Chain.KeepParallel(items), AaDim.Tol);
                if (norm.Count < 3)
                    continue;
                double sgn = side == Exposure.Left ? 1 : -1;
                double c = plane + sgn * d.Feet(8);
                if (AaDim.Create(d, norm, dir, left, c, type, rep, "Хаалганы хэмжээс") != null)
                    rep.DimsDoor++;
            }
        }

        private static void AddBound(List<ChainItem> items, WallData w, Touch t, OpeningData od,
            Dictionary<int, WallData> byKey, int end, V2 dir)
        {
            if (t != null && byKey.TryGetValue(t.Wall.Key, out WallData p) && p.Dimensionable)
            {
                Exposure ex = Walls.FaceToward(w.Seg, t.Wall, t.Pos, od.Pos);
                FaceRef face = p.SideFace(ex);
                items.Add(new ChainItem(face.Origin.Dot(dir), Chain.PriorityCorner, face.Ref, "bound").WithNormal(face.Normal));
                return;
            }
            if (t == null)
            {
                FaceRef own = EndFace(w, end);
                if (own != null)
                    items.Add(new ChainItem(own.Origin.Dot(dir), Chain.PriorityCorner, own.Ref, "end").WithNormal(own.Normal));
            }
        }

        // ── 4. Баганыг тэнхлэгт холбох ───────────────────────────────────

        private static void ColumnTies(ViewData d, AaOptions o, AaReport rep, DimensionType type)
        {
            AaFrame f = d.F;
            int rotated = 0;
            foreach (ColumnData c in d.Columns)
            {
                if (!c.InScope)
                    continue;
                bool aligned = Dir.Parallel(c.BasisX, f.U) || Dir.Parallel(c.BasisX, f.V);
                if (!aligned)
                {
                    rotated++;
                    continue;
                }
                foreach (V2 t in new[] { f.U, f.V })
                {
                    bool isU = t.Dot(f.U) > 0.5;
                    V2 nrm = t.Perp();
                    List<GridData> perp = d.Grids.Where(g => Dir.Parallel(g.Dir, nrm)).ToList();
                    if (perp.Count == 0)
                        continue;
                    List<double> coords = perp.Select(g => g.Seg.A.Dot(t)).ToList();
                    double center = c.Center.Dot(t);
                    int gi = Nearest.Index(coords, center, 6.6);
                    if (gi < 0)
                        continue;
                    double min = isU ? c.MinU : c.MinV, max = isU ? c.MaxU : c.MaxV;
                    Reference rMin, rMax;
                    if (!ColumnFaces(d, c, t, out rMin, out rMax))
                        continue;
                    var items = new List<ChainItem>
                    {
                        new ChainItem(min, Chain.PriorityFace, rMin, "col"),
                        new ChainItem(coords[gi], Chain.PriorityGrid, perp[gi].Ref, "grid").WithNormal(perp[gi].Dir.Perp()),
                        new ChainItem(max, Chain.PriorityFace, rMax, "col"),
                    };
                    // Хэмжээс баганын доор (хэвтээ) / зүүн талд (босоо).
                    double at = (isU ? c.MinV : c.MinU) - d.Feet(6);
                    V2 outward = isU ? f.V : f.U;
                    if (AaDim.Create(d, items, t, outward, at, type, rep, "Баганын холболт") != null)
                        rep.DimsColumn++;
                }
            }
            if (rotated > 0)
                rep.Note(rotated + " багана тэнхлэгт налуу эргэсэн тул холболтын хэмжээс тавиагүй.");
        }

        /// <summary>
        /// Баганын t-д перпендикуляр хоёр нүүр (бага, их талын).  Эхлээд family-ийн Left/Right
        /// (эсвэл Front/Back) хавтгай; байхгүй бол геометрийн нүүр (symbol геометр, CdEngine-тэй ижил арга).
        /// </summary>
        private static bool ColumnFaces(ViewData d, ColumnData c, V2 t, out Reference rMin, out Reference rMax)
        {
            rMin = rMax = null;
            V2 bx = c.BasisX;
            if (Dir.Parallel(bx, t))
            {
                Reference l = Lk.FirstRef(c.Fi, FamilyInstanceReferenceType.Left, c.Src);
                Reference r = Lk.FirstRef(c.Fi, FamilyInstanceReferenceType.Right, c.Src);
                if (l != null && r != null)
                {
                    bool pos = bx.Dot(t) > 0;
                    rMin = pos ? l : r;
                    rMax = pos ? r : l;
                    return true;
                }
            }
            else
            {
                Reference fr = Lk.FirstRef(c.Fi, FamilyInstanceReferenceType.Front, c.Src);
                Reference bk = Lk.FirstRef(c.Fi, FamilyInstanceReferenceType.Back, c.Src);
                if (fr != null && bk != null)
                {
                    bool pos = Lk.Vec2(c.Src, c.Fi.GetTransform().BasisY).Dot(t) > 0;
                    // Front = локал −Y, Back = +Y
                    rMin = pos ? fr : bk;
                    rMax = pos ? bk : fr;
                    return true;
                }
            }

            // Геометрийн нүүр
            var faces = new List<Tuple<double, Reference>>();
            try
            {
                var opt = new Options { ComputeReferences = true, DetailLevel = ViewDetailLevel.Fine };
                WalkFaces(c.Fi.get_Geometry(opt), c.Src?.T ?? Transform.Identity, t, faces, c.Src);
            }
            catch
            {
                return false;
            }
            if (faces.Count < 2)
                return false;
            rMin = Lk.R(c.Src, faces.OrderBy(x => x.Item1).First().Item2);
            rMax = Lk.R(c.Src, faces.OrderBy(x => x.Item1).Last().Item2);
            return rMin != null && rMax != null;
        }

        private static void WalkFaces(GeometryElement ge, Transform tr, V2 t, List<Tuple<double, Reference>> faces, LinkSrc src)
        {
            if (ge == null)
                return;
            foreach (GeometryObject go in ge)
            {
                if (go is Solid s && s.Volume > 1e-9)
                {
                    foreach (Face fc in s.Faces)
                    {
                        if (!(fc is PlanarFace pf) || pf.Reference == null)
                            continue;
                        XYZ n = tr.OfVector(pf.FaceNormal);
                        if (Math.Abs(n.Z) > 0.02 || Math.Abs(new V2(n.X, n.Y).Normalized().Dot(t)) < Dir.ParallelCos)
                            continue;
                        XYZ o = tr.OfPoint(pf.Origin);
                        faces.Add(Tuple.Create(new V2(o.X, o.Y).Dot(t), pf.Reference));
                    }
                }
                else if (go is GeometryInstance gi)
                {
                    WalkFaces(gi.GetSymbolGeometry(), tr.Multiply(gi.Transform), t, faces, src);
                }
            }
        }
    }
}
