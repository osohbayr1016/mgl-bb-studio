using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using RevitMcpAddin.RoomPlan;
using RevitMcpAddin.RoomPlan.Core;

namespace MglRpGate
{
    /// <summary>
    /// Apply-ийн дараах моделийг Revit-ийн БОДИТ геометрээр шалгана (Python-ы схем биш): хана төлөвлөгөөтэй таарах, Room
    /// битүү ба нэр, tag, хаалганы host/уулзвар, хаалганы эргэлтийн муж (family-ийн plan дээрх нумаас), тавилгын бодит хэмжээ
    /// өрөөндөө багтах, нэгж бүрийн өрөө бүрт орцоос хүрэх зам, үүсгэсэн элементтэй холбоотой Revit анхааруулга.
    /// Hard = release-ийг зогсооно; Soft = мэдээлэл (архитектор хараад шийднэ).
    /// </summary>
    internal sealed class Verifier
    {
        public readonly List<string> Hard = new List<string>();
        public readonly List<string> Soft = new List<string>();
        public readonly Dictionary<string, object> Facts = new Dictionary<string, object>(StringComparer.Ordinal);

        private readonly Document _doc;
        private readonly Level _level;
        private readonly ViewPlan _view;
        private readonly PythonBatch _batch;
        private readonly IReadOnlyDictionary<string, PythonOption> _selected;
        private readonly RoomPlanApplyResult _made;
        private readonly HashSet<long> _madeIds;
        private readonly double _zRoom, _zLow;
        /// <summary>«Давхрын план»: айлуудын орц нээгддэг нийтийн коридорын Room (-1 = «Олон өрөөний план», орц гадагш).</summary>
        private readonly long _common;

        public Verifier(Document doc, Level level, ViewPlan view, PythonBatch batch,
                        IReadOnlyDictionary<string, PythonOption> selected, RoomPlanApplyResult made,
                        ElementId commonRoom = null, IEnumerable<ElementId> shellWalls = null)
        {
            _doc = doc; _level = level; _view = view; _batch = batch; _selected = selected; _made = made;
            _common = commonRoom == null ? -1 : commonRoom.Value;
            _madeIds = new HashSet<long>(made.Walls.Concat(made.Doors).Concat(made.Rooms).Concat(made.Tags).Concat(made.Furniture)
                .Concat(shellWalls ?? Enumerable.Empty<ElementId>()).Select(i => i.Value));
            _zRoom = level.Elevation + U.Mm(1000);
            _zLow = level.Elevation + U.Mm(300);
        }

        public void Run()
        {
            CheckWalls();
            CheckRooms();
            CheckTags();
            CheckDoors();
            CheckFurniture();
            CheckConnectivity();
            CheckWarnings();
        }

        private PythonUnitResult UnitAt(XYZ p)
        {
            return _batch.Units.FirstOrDefault(u => p.X > u.Boundary.MinX - 0.01 && p.X < u.Boundary.MaxX + 0.01 &&
                                                    p.Y > u.Boundary.MinY - 0.01 && p.Y < u.Boundary.MaxY + 0.01);
        }

        private XYZ Model(PythonUnitResult u, PlanPoint p)
        {
            return new XYZ(u.Boundary.MinX + p.X / 0.3048, u.Boundary.MinY + p.Y / 0.3048, _level.Elevation);
        }

        private static string Name(Element e) { return e == null ? "∅" : e.Name + " #" + e.Id.Value; }

        // ── Хана ───────────────────────────────────────────────────

        private void CheckWalls()
        {
            var planSegs = new List<Tuple<string, XYZ, XYZ>>();
            foreach (PythonUnitResult u in _batch.Units)
                foreach (PlanWall w in _selected[u.Id].Plan.Walls.Where(x => !u.Boundary.Perimeter.ContainsKey(x.Id)))
                    planSegs.Add(Tuple.Create(u.Id + "/" + w.Id, Model(u, w.Start), Model(u, w.End)));
            double tol = U.Mm(2);
            int matched = 0;
            foreach (ElementId id in _made.Walls)
            {
                var w = _doc.GetElement(id) as Wall;
                if (w == null) { Hard.Add("хана #" + id.Value + " алга"); continue; }
                var line = ((LocationCurve)w.Location).Curve as Line;
                XYZ a = line.GetEndPoint(0), b = line.GetEndPoint(1);
                bool ok = planSegs.Any(p => (Flat(a).DistanceTo(Flat(p.Item2)) < tol && Flat(b).DistanceTo(Flat(p.Item3)) < tol) ||
                                            (Flat(a).DistanceTo(Flat(p.Item3)) < tol && Flat(b).DistanceTo(Flat(p.Item2)) < tol));
                if (ok) matched++; else Hard.Add("хана " + Name(w) + " төлөвлөгөөний аль ч хэсэгтэй таарахгүй");
                if (w.LevelId != _level.Id) Hard.Add("хана " + Name(w) + " өөр level дээр");
                if (w.get_Parameter(BuiltInParameter.WALL_ATTR_ROOM_BOUNDING)?.AsInteger() != 1) Hard.Add("хана " + Name(w) + " room-bounding биш");
            }
            Facts["walls.matched"] = matched + "/" + planSegs.Count;
        }

        private static XYZ Flat(XYZ p) { return new XYZ(p.X, p.Y, 0); }

        // ── Room ───────────────────────────────────────────────────

        private readonly Dictionary<long, string> _roomUnit = new Dictionary<long, string>();

        private void CheckRooms()
        {
            var byUnit = new Dictionary<string, List<Room>>(StringComparer.Ordinal);
            foreach (ElementId id in _made.Rooms)
            {
                var room = _doc.GetElement(id) as Room;
                if (room == null) { Hard.Add("room #" + id.Value + " алга"); continue; }
                if (!(room.Area > 1e-6) || room.Location == null) { Hard.Add("room «" + room.Name + "» битүү биш / байрлалгүй"); continue; }
                if (id.Value == _common) continue;   // нийтийн коридорыг FloorScenario тусад нь шалгана
                PythonUnitResult u = UnitAt(((LocationPoint)room.Location).Point);
                if (u == null) { Hard.Add("room «" + room.Name + "» нэгжээс гадна"); continue; }
                _roomUnit[room.Id.Value] = u.Id;
                if (!byUnit.ContainsKey(u.Id)) byUnit[u.Id] = new List<Room>();
                byUnit[u.Id].Add(room);
            }
            foreach (PythonUnitResult u in _batch.Units)
            {
                GeneratedPlan plan = _selected[u.Id].Plan;
                List<Room> rooms = byUnit.ContainsKey(u.Id) ? byUnit[u.Id] : new List<Room>();
                var expected = new HashSet<string>(plan.Rooms.Select(r => r.Name));
                var actual = rooms.Select(r => RoomName(r)).ToList();
                foreach (string n in expected.Where(n => !actual.Contains(n))) Hard.Add(u.Id + ": төлөвлөгөөний «" + n + "» өрөө Revit-д алга");
                foreach (string n in actual.Where(n => !expected.Contains(n))) Hard.Add(u.Id + ": илүү room «" + n + "»");
                if (actual.Count != actual.Distinct().Count()) Hard.Add(u.Id + ": ижил нэртэй давхардсан room");
                double gross = u.Boundary.WidthMeters * u.Boundary.HeightMeters;
                double net = rooms.Sum(r => U.M2(r.Area));
                Facts[u.Id + ".net_area_m2"] = Math.Round(net, 2);
                Facts[u.Id + ".net_to_axis_area"] = Math.Round(net / gross, 3);
                var detail = new List<string>();
                foreach (Room r in rooms)
                {
                    string n = RoomName(r);
                    // Төлөвлөгөөний (хананы тэнхлэгийн) тэгш өнцөгт ↔ Revit-ийн өрөө (хананы нүүр хүртэл).  Хонгил хэд хэдэн хэсгээс бүрдэнэ.
                    double planArea = plan.Rooms.Where(p => p.Name == n).Sum(p => p.Area);
                    double ratio = planArea > 0 ? U.M2(r.Area) / planArea : 0;
                    detail.Add(n + " " + U.F(Math.Round(U.M2(r.Area), 2)) + " м² (" + U.F(Math.Round(ratio * 100)) + "%)");
                    if (ratio > 1.02) Hard.Add(u.Id + ": «" + n + "» төлөвлөгөөнөөс ТОМ (" + U.F(Math.Round(ratio * 100)) + "%) — хана дутуу, өрөө хөрш рүүгээ урссан");
                    else if (ratio < 0.70) Soft.Add(u.Id + ": «" + n + "» хананы зузаанаас болж " + U.F(Math.Round(ratio * 100)) + "% үлдсэн");
                }
                Facts[u.Id + ".rooms"] = string.Join(" · ", detail);
            }
        }

        private static string RoomName(Room r)
        {
            return r.get_Parameter(BuiltInParameter.ROOM_NAME)?.AsString() ?? r.Name;
        }

        // ── Tag ────────────────────────────────────────────────────

        private void CheckTags()
        {
            int tagsOnFurniture = 0;
            var tagged = new Dictionary<long, int>();
            foreach (ElementId id in _made.Tags)
            {
                var tag = _doc.GetElement(id) as RoomTag;
                if (tag == null) { Hard.Add("tag #" + id.Value + " алга"); continue; }
                Room room = tag.Room;
                if (room == null) { Hard.Add("tag #" + id.Value + " өрөөгүй (orphan)"); continue; }
                tagged[room.Id.Value] = tagged.TryGetValue(room.Id.Value, out int n) ? n + 1 : 1;
                if (tag.OwnerViewId != _view.Id) Hard.Add("tag #" + id.Value + " өөр view-д");
                XYZ p = ((LocationPoint)tag.Location).Point;
                if (!room.IsPointInRoom(new XYZ(p.X, p.Y, _zRoom))) Soft.Add("tag «" + RoomName(room) + "» өрөөнийхөө гадна байрласан");
                BoundingBoxXYZ tb = tag.get_BoundingBox(_view);
                int covers = tb == null ? -1 : _made.Furniture.Select(f => _doc.GetElement(f)?.get_BoundingBox(null)).Count(x => x != null &&
                    tb.Min.X < x.Max.X && tb.Max.X > x.Min.X && tb.Min.Y < x.Max.Y && tb.Max.Y > x.Min.Y);
                Facts["tag." + id.Value] = RoomName(room) + " | tag " + (tb == null ? "no bbox" :
                    U.F(Math.Round(U.ToMm(tb.Max.X - tb.Min.X))) + "×" + U.F(Math.Round(U.ToMm(tb.Max.Y - tb.Min.Y))) + " мм") +
                    " | давхцсан тавилга " + covers;
                if (covers > 0) tagsOnFurniture++;
            }
            Facts["tags_on_furniture"] = tagsOnFurniture + "/" + _made.Tags.Count;
            foreach (ElementId id in _made.Rooms)
                if (!tagged.TryGetValue(id.Value, out int n) || n != 1) Hard.Add("room #" + id.Value + " tag " + (tagged.ContainsKey(id.Value) ? tagged[id.Value] : 0) + " (1 байх ёстой)");
        }

        // ── Хаалга ─────────────────────────────────────────────────

        private sealed class Swing
        {
            public FamilyInstance Door;
            public XYZ Center;
            public double Radius, A0, Sweep;
            public string Into = "?";
            public List<XYZ> Samples = new List<XYZ>();

            public bool Contains(XYZ p)
            {
                double dx = p.X - Center.X, dy = p.Y - Center.Y;
                if (dx * dx + dy * dy > Radius * Radius) return false;
                double a = Math.Atan2(dy, dx) - A0;
                while (a < 0) a += 2 * Math.PI;
                while (a >= 2 * Math.PI) a -= 2 * Math.PI;
                return a <= Sweep + 1e-6;
            }
        }

        private readonly List<Swing> _swings = new List<Swing>();
        private readonly List<Tuple<FamilyInstance, Room, Room, bool>> _doorRooms = new List<Tuple<FamilyInstance, Room, Room, bool>>();

        private void CheckDoors()
        {
            var perimeter = new HashSet<long>(_batch.Units.SelectMany(u => u.Boundary.Perimeter.Values).Select(w => w.Id.Value));
            var allWalls = new FilteredElementCollector(_doc).OfClass(typeof(Wall)).Cast<Wall>().Where(w => w.LevelId == _level.Id).ToList();
            int outward = 0;
            foreach (ElementId id in _made.Doors)
            {
                var door = _doc.GetElement(id) as FamilyInstance;
                if (door == null) { Hard.Add("хаалга #" + id.Value + " алга"); continue; }
                var host = door.Host as Wall;
                if (host == null) { Hard.Add("хаалга " + Name(door) + " хананд host-лоогүй"); continue; }
                bool entry = perimeter.Contains(host.Id.Value);
                if (!entry && !_made.Walls.Contains(host.Id)) Hard.Add("хаалга " + Name(door) + " гаднын ханд host-лосон " + Name(host));
                XYZ at = ((LocationPoint)door.Location).Point;
                var line = (Line)((LocationCurve)host.Location).Curve;
                IntersectionResult pr = line.Project(Flat(at) + new XYZ(0, 0, line.GetEndPoint(0).Z));
                double off = pr == null ? double.MaxValue : Flat(pr.XYZPoint).DistanceTo(Flat(at));
                if (off > U.Mm(2)) Hard.Add("хаалга " + Name(door) + " хананы тэнхлэгээс " + U.F(U.ToMm(off)) + " мм зөрсөн");

                double width = DoorWidth(door);
                // Хананы төгсгөл ба T-уулзвар (өөр хана энэ хананд тулсан цэг) хүртэлх зай ≥ хагас өргөн + тулсан хананы хагас зузаан.
                XYZ a = Flat(line.GetEndPoint(0)), b = Flat(line.GetEndPoint(1)), dir = (b - a).Normalize(), c = Flat(at);
                double t = (c - a).DotProduct(dir), len = a.DistanceTo(b);
                var stops = new List<Tuple<double, double, string>> { Tuple.Create(0.0, host.Width / 2, "хананы төгсгөл"), Tuple.Create(len, host.Width / 2, "хананы төгсгөл") };
                foreach (Wall other in allWalls)
                {
                    if (other.Id == host.Id || !(((LocationCurve)other.Location).Curve is Line ol)) continue;
                    foreach (XYZ e in new[] { Flat(ol.GetEndPoint(0)), Flat(ol.GetEndPoint(1)) })
                    {
                        double te = (e - a).DotProduct(dir);
                        double side = (e - (a + dir * te)).GetLength();
                        if (te > -0.01 && te < len + 0.01 && side <= host.Width / 2 + U.Mm(5)) stops.Add(Tuple.Create(te, other.Width / 2, "уулзвар " + Name(other)));
                    }
                }
                foreach (Tuple<double, double, string> st in stops)
                {
                    double gap = Math.Abs(t - st.Item1) - width / 2 - st.Item2;
                    if (gap < U.Mm(20)) Hard.Add("хаалга " + Name(door) + " (" + U.F(Math.Round(width * 0.3048, 2)) + " м) " + st.Item3 + "-тай давхцаж байна (зай " + U.F(Math.Round(U.ToMm(gap))) + " мм)");
                }

                Room from = door.FromRoom, to = door.ToRoom;
                _doorRooms.Add(Tuple.Create(door, from, to, entry));
                if (!entry)
                {
                    if (from == null || to == null) Hard.Add("дотор хаалга " + Name(door) + " хоёр өрөөг холбохгүй (" + RoomLabel(from) + " ↔ " + RoomLabel(to) + ")");
                    else if (from.Id == to.Id) Hard.Add("дотор хаалга " + Name(door) + " нэг өрөөний дотор");
                }
                else if (_common >= 0)
                {
                    // Давхрын план: орц бүр ЯГ айлын өрөө ↔ нийтийн коридор (хөрш айл руу, гадагш биш).
                    bool fromCommon = from != null && from.Id.Value == _common, toCommon = to != null && to.Id.Value == _common;
                    bool linked = fromCommon ? to != null && !toCommon : toCommon && from != null;
                    if (!linked) Hard.Add("орох хаалга " + Name(door) + " айл ↔ нийтийн коридорыг холбохгүй (" + RoomLabel(from) + " ↔ " + RoomLabel(to) + ")");
                }
                else if (from != null && to != null) Hard.Add("гадна хананы хаалга " + Name(door) + " хоёр нэгжийг холбож байна (" + RoomLabel(from) + " ↔ " + RoomLabel(to) + ")");

                Swing sw = SwingOf(door, width);
                if (sw == null) { Soft.Add("хаалга " + Name(door) + ": plan дээр эргэлтийн нум олдсонгүй — эргэлтийг шалгаагүй"); continue; }
                _swings.Add(sw);
                var swungInto = new HashSet<string>();
                foreach (XYZ p in sw.Samples)
                {
                    Room room = _doc.GetRoomAtPoint(p);
                    swungInto.Add(room == null || room.Id.Value == _common ? "гадна" : RoomName(room) + "#" + room.Id.Value);
                }
                sw.Into = string.Join("+", swungInto.Select(x => x.Split('#')[0]));
                if (swungInto.Count > 1)
                    Hard.Add("хаалга " + Name(door) + " эргэхдээ хана мөргөнө (эргэлтийн муж " + string.Join(" + ", swungInto) + ")");
                else if (swungInto.Contains("гадна"))
                {
                    if (entry) outward++;
                    else Hard.Add("дотор хаалга " + Name(door) + " өрөөнөөс гадагш эргэнэ");
                }
            }
            // Тавилга хаалганы эргэлтийн мужид (family-ийн бодит bbox, 10 мм-ээр жижигрүүлсэн).
            foreach (Swing sw in _swings)
                foreach (ElementId fid in _made.Furniture)
                {
                    BoundingBoxXYZ fb = (_doc.GetElement(fid) as FamilyInstance)?.get_BoundingBox(null);
                    if (fb == null) continue;
                    double m = U.Mm(10);
                    if (sw.Samples.Any(p => p.X > fb.Min.X + m && p.X < fb.Max.X - m && p.Y > fb.Min.Y + m && p.Y < fb.Max.Y - m))
                        Hard.Add("хаалга " + Name(sw.Door) + " (→ " + sw.Into + ") эргэхдээ " + Name(_doc.GetElement(fid)) + " мөргөнө");
                }
            if (outward > 0) Soft.Add(outward + " орох хаалга гадагш (нийтийн коридор руу) эргэнэ — family-ийн facing, норм шалгаагүй");
            Facts["doors.swings_measured"] = _swings.Count + "/" + _made.Doors.Count;

            for (int i = 0; i < _swings.Count; i++)
                for (int j = i + 1; j < _swings.Count; j++)
                    if (_swings[i].Samples.Any(_swings[j].Contains) || _swings[j].Samples.Any(_swings[i].Contains))
                        Hard.Add("хаалга " + Name(_swings[i].Door) + " (→ " + _swings[i].Into + ") ба " + Name(_swings[j].Door) +
                                 " (→ " + _swings[j].Into + ") эргэхдээ мөргөлдөнө");
        }

        private static string RoomLabel(Room r) { return r == null ? "гадна" : RoomName(r); }

        private static double DoorWidth(FamilyInstance door)
        {
            Parameter p = door.Symbol.get_Parameter(BuiltInParameter.DOOR_WIDTH) ?? door.Symbol.get_Parameter(BuiltInParameter.FAMILY_WIDTH_PARAM)
                          ?? door.get_Parameter(BuiltInParameter.DOOR_WIDTH) ?? door.LookupParameter("Width");
            return p != null && p.StorageType == StorageType.Double ? p.AsDouble() : U.Mm(900);
        }

        /// <summary>Family-ийн plan дүрслэл дэх эргэлтийн нум (radius ≈ хаалганы өргөн) → эргэлтийн муж.</summary>
        private Swing SwingOf(FamilyInstance door, double width)
        {
            var opt = new Options { View = _view };
            GeometryElement ge = door.get_Geometry(opt);
            if (ge == null) return null;
            Arc best = null;
            foreach (Arc arc in Arcs(ge))
                if (arc.IsBound && Math.Abs(arc.Radius - width) < width * 0.25 && (best == null || arc.Radius > best.Radius)) best = arc;
            if (best == null) return null;
            XYZ c = Flat(best.Center), p0 = Flat(best.GetEndPoint(0)), p1 = Flat(best.GetEndPoint(1));
            double a0 = Math.Atan2(p0.Y - c.Y, p0.X - c.X), a1 = Math.Atan2(p1.Y - c.Y, p1.X - c.X);
            if (best.Normal.Z < 0) { double tmp = a0; a0 = a1; a1 = tmp; }   // нум үргэлж a0 → a1 цагийн зүүний эсрэг
            double sweep = a1 - a0;
            while (sweep <= 0) sweep += 2 * Math.PI;
            var sw = new Swing { Door = door, Center = c, Radius = best.Radius, A0 = a0, Sweep = sweep };
            for (double f = 0.05; f < 1; f += 0.1)
                for (double k = 0.15; k < 0.96; k += 0.1333)
                {
                    double ang = a0 + sweep * f;
                    sw.Samples.Add(new XYZ(c.X + Math.Cos(ang) * best.Radius * k, c.Y + Math.Sin(ang) * best.Radius * k, _zRoom));
                }
            return sw;
        }

        private static IEnumerable<Arc> Arcs(GeometryElement ge)
        {
            foreach (GeometryObject o in ge)
            {
                if (o is Arc a) yield return a;
                else if (o is GeometryInstance gi)
                    foreach (Arc x in Arcs(gi.GetInstanceGeometry())) yield return x;
            }
        }

        // ── Тавилга (family-ийн бодит хэмжээ) ──────────────────────

        private void CheckFurniture()
        {
            var sizes = new List<string>();
            var kinds = new SortedDictionary<string, int>(StringComparer.Ordinal);
            int backed = 0;
            foreach (ElementId id in _made.Furniture)
            {
                var fi = _doc.GetElement(id) as FamilyInstance;
                BoundingBoxXYZ bb = fi?.get_BoundingBox(null);
                if (bb == null) { Hard.Add("тавилга #" + id.Value + " алга/хэмжээгүй"); continue; }
                string label = fi.Symbol.Family.Name;
                XYZ mid = new XYZ((bb.Min.X + bb.Max.X) / 2, (bb.Min.Y + bb.Max.Y) / 2, _zLow);
                Room room = _doc.GetRoomAtPoint(mid);
                sizes.Add(label + " / " + fi.Symbol.Name + " " + U.F(Math.Round((bb.Max.X - bb.Min.X) * 0.3048, 2)) + "×" + U.F(Math.Round((bb.Max.Y - bb.Min.Y) * 0.3048, 2)) + " м → " + RoomLabel(room));
                if (room == null) { Hard.Add(label + " #" + id.Value + " ямар ч өрөөнд биш"); continue; }
                double i = U.Mm(15);
                XYZ[] corners =
                {
                    new XYZ(bb.Min.X + i, bb.Min.Y + i, _zLow), new XYZ(bb.Max.X - i, bb.Min.Y + i, _zLow),
                    new XYZ(bb.Max.X - i, bb.Max.Y - i, _zLow), new XYZ(bb.Min.X + i, bb.Max.Y - i, _zLow),
                };
                if (corners.Any(p => !room.IsPointInRoom(p)))
                    Hard.Add(label + " #" + id.Value + " бодит хэмжээгээрээ «" + RoomName(room) + "» өрөөнөөс хальж хана руу орсон");
                // Нуруутай тавилга (ор, шүүгээ, буйдан, суултуур …) ханыг түшинэ: нурууных нь ард 6 см-т өрөө
                // үргэлжилж байвал хананаас хөндий зогсож байна.
                FurnitureTarget target;
                string kind = _made.FurnitureTargets.TryGetValue(id, out target) ? target.Kind.ToString() : "?";
                kinds[kind] = kinds.TryGetValue(kind, out int n) ? n + 1 : 1;
                if (target != null && target.Back != null)
                {
                    double o = U.Mm(60), cx = mid.X, cy = mid.Y;
                    XYZ behind = target.Back == "south" ? new XYZ(cx, bb.Min.Y - o, _zLow)
                               : target.Back == "north" ? new XYZ(cx, bb.Max.Y + o, _zLow)
                               : target.Back == "west" ? new XYZ(bb.Min.X - o, cy, _zLow)
                               : new XYZ(bb.Max.X + o, cy, _zLow);
                    if (room.IsPointInRoom(behind))
                        Hard.Add(kind + " «" + label + "» #" + id.Value + " хананд тулаагүй (нуруу " + target.Back + ", «" + RoomName(room) + "»)");
                    else backed++;
                }
            }
            Facts["furniture.sizes"] = string.Join(" · ", sizes);
            Facts["furniture.kinds"] = string.Join(", ", kinds.Select(k => k.Key + "×" + k.Value));
            Facts["furniture.backed_to_wall"] = backed;
        }

        // ── Орцоос өрөө бүрт хүрэх зам ─────────────────────────────

        private void CheckConnectivity()
        {
            foreach (PythonUnitResult u in _batch.Units)
            {
                var rooms = new HashSet<long>(_roomUnit.Where(kv => kv.Value == u.Id).Select(kv => kv.Key));
                var edges = new List<Tuple<long, long>>();
                var starts = new HashSet<long>();
                foreach (Tuple<FamilyInstance, Room, Room, bool> d in _doorRooms)
                {
                    long f = d.Item2?.Id.Value ?? -1, t = d.Item3?.Id.Value ?? -1;
                    bool fIn = rooms.Contains(f), tIn = rooms.Contains(t);
                    if (fIn && tIn) edges.Add(Tuple.Create(f, t));
                    else if (d.Item4 && (fIn ^ tIn) && (f == -1 || t == -1 || (_common >= 0 && (f == _common || t == _common)))) starts.Add(fIn ? f : t);
                }
                if (starts.Count == 0) { Hard.Add(u.Id + ": орох хаалга ямар ч өрөөнд нээгдэхгүй"); continue; }
                var seen = new HashSet<long>(starts);
                var queue = new Queue<long>(starts);
                while (queue.Count > 0)
                {
                    long cur = queue.Dequeue();
                    foreach (Tuple<long, long> e in edges)
                    {
                        long next = e.Item1 == cur ? e.Item2 : e.Item2 == cur ? e.Item1 : -1;
                        if (next != -1 && seen.Add(next)) queue.Enqueue(next);
                    }
                }
                foreach (long id in rooms.Where(x => !seen.Contains(x)))
                    Hard.Add(u.Id + ": «" + RoomName((Room)_doc.GetElement(new ElementId(id))) + "» өрөөнд орцоос хаалгаар хүрэх зам алга");
                Facts[u.Id + ".reachable"] = seen.Count + "/" + rooms.Count;
            }
        }

        // ── Revit анхааруулга ──────────────────────────────────────

        private static readonly string[] HardWarnings = { "overlap", "enclosed", "redundant", "cut", "outside", "intersect", "can't", "cannot", "not in" };

        private void CheckWarnings()
        {
            int ours = 0;
            foreach (FailureMessage m in _doc.GetWarnings())
            {
                IEnumerable<ElementId> ids = m.GetFailingElements().Concat(m.GetAdditionalElements());
                if (!ids.Any(x => _madeIds.Contains(x.Value))) continue;
                ours++;
                string text = m.GetDescriptionText() + " [" + string.Join(",", ids.Select(x => x.Value)) + "]";
                if (HardWarnings.Any(k => text.IndexOf(k, StringComparison.OrdinalIgnoreCase) >= 0)) Hard.Add("Revit анхааруулга: " + text);
                else Soft.Add("Revit анхааруулга: " + text);
            }
            Facts["revit_warnings_on_generated"] = ours;
        }
    }
}
