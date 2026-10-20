using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>Нэг ШИНЭ Elevation харагдацын маркер.  Ижил <see cref="Group"/>-тэй дэлгээсүүд НЭГ маркерыг хуваалцана.</summary>
    public sealed class WeMarkerPlacement
    {
        /// <summary>Маркерын түлхүүр («m:&lt;өрөө&gt;:1») — coordinator нэг маркерыг нэг л удаа үүсгэнэ.</summary>
        public string Group;
        /// <summary>Маркерын индекс 0–3.</summary>
        public int Slot;
        /// <summary>Маркерын төв (план; Z-ийг Revit давхарга түвшингээс авна).</summary>
        public WeV3 Position;
        /// <summary>Үүсгэсний дараа маркерыг босоо тэнхлэгээр эргүүлэх өнцөг (радиан, цагийн зүүний эсрэг).</summary>
        public double Rotation;
        /// <summary>Энэ маркерыг хуваалцах дэлгээсийн тоо (1–4).</summary>
        public int Shared = 1;
        /// <summary>
        /// W04 (2026-10-16): байрлал БҮХ шалгалтыг давсан — сум ханаа харна, ханын өргөний дотор, ханаас өмнө, өрөөн дотор (арал/нүхийн гадна).
        /// false бол <see cref="Note"/> — тэмдгийг гараар зөөнө (дэлгээс өөрөө төлөвлөгөөгөөр зөв).
        /// </summary>
        public bool Validated = true;
        public string Note;
    }

    /// <summary>
    /// Elevation маркерын төлөвлөгч (Revit-гүй, тесттэй).
    ///
    /// Revit 2027 дээр ХЭМЖСЭН (2026-10-06, <c>ElevationMarker.CreateElevationMarker</c> + <c>CreateElevation</c>):
    ///   • эргүүлээгүй маркерын индекс → харах чиглэл: 0 = −X, 1 = +Y, 2 = +X, 3 = −Y (<c>ViewDirection</c> = эсрэг);
    ///   • маркерыг босоо тэнхлэгээр эргүүлэхэд түүний БҮХ харагдац хамт эргэнэ;
    ///   • харагдацын хавтгай маркерын төвийг дайрна, гэхдээ crop-ийн Max.Z-ээр хүссэн газарт зөөгдөнө (far clip нь параметрээр).
    /// Тиймээс маркер нь зөвхөн план дээрх ТЭМДЭГ — дэлгээсний хавтгай, хүрээ, гүн нь төлөвлөгөөнийх хэвээр.
    ///
    /// Дүрэм: тэгш өнцөгт өрөөнд НЭГ маркер 4 сумтай (ердийн дотоод дэлгээсийн тэмдэг).  L, налуу, олон талт өрөөнд сум бүр ӨӨРИЙН
    /// ханаа заах ёстой: маркер ханын өргөний дотор (хажуугийн 25 %, ≤ 300 мм-ээс бусад), ханаас ≥ 300 мм өмнө, өрөөн дотор —
    /// эс бөгөөс тэр тал шинэ маркер авна.  Хана горимд дэлгээс бүр өөрийн маркертай.
    /// </summary>
    public static class WeMarkerPlanner
    {
        private const double AngleTol = 0.5 * Math.PI / 180;

        /// <summary>Индексийн харах чиглэлийн өнцөг (радиан, +X-ээс цагийн зүүний эсрэг).</summary>
        public static double SlotLookAngle(int slot, double rotation)
        {
            return Wrap(rotation + Math.PI - slot * Math.PI / 2);
        }

        public static WeV3 SlotLook(int slot, double rotation)
        {
            double a = SlotLookAngle(slot, rotation);
            return new WeV3(Math.Cos(a), Math.Sin(a), 0);
        }

        /// <summary>Шинэ маркер: харах чиглэлд хамгийн бага эргэлттэй — (−45°, 45°] — индекс.</summary>
        public static void ChooseSlot(WeV3 look, out int slot, out double rotation)
        {
            double phi = Math.Atan2(look.Y, look.X);
            slot = 0;
            rotation = double.MaxValue;
            for (int i = 0; i < 4; i++)
            {
                double r = Wrap(phi - (Math.PI - i * Math.PI / 2));
                if (Math.Abs(r) < Math.Abs(rotation) - 1e-9) { rotation = r; slot = i; }
            }
        }

        public static double Wrap(double a)
        {
            while (a <= -Math.PI) a += 2 * Math.PI;
            while (a > Math.PI) a -= 2 * Math.PI;
            return a;
        }

        private sealed class Req
        {
            public WePlannedElevation Item;
            public WeV3 Look;
            /// <summary>Харагдацын хавтгай дээрх ханын төвийн цэг.</summary>
            public WeV3 Cut;
            /// <summary>Ханын гадаргуугийн төв.</summary>
            public WeV3 Face;
            public double Half;
        }

        private sealed class Mk
        {
            public string Group;
            public double Rotation;
            public WeV3 Position;
            public readonly Req[] Slots = new Req[4];
            public IEnumerable<Req> Members { get { return Slots.Where(s => s != null); } }
        }

        /// <summary>
        /// ШИНЭ (Create) дэлгээсүүдэд маркер оноох — <see cref="WePlannedElevation.Marker"/>.  Шинэчлэх/хэвээр дэлгээс өөрийн маркертай
        /// хэвээр (энд хамаарахгүй).  <paramref name="rooms"/> = өрөөний UniqueId → мэдээлэл (өрөөн дотор эсэхийг шалгана).
        /// </summary>
        /// <param name="minSeparation">
        /// Хоёр маркерын төвийн хоорондох хамгийн бага зай (дэлхийн; 0 = шалгахгүй).  ХЭМЖСЭН (GATEWAY 310, L хэлбэрийн өрөө, 2026-10-07):
        /// маркер бүр өөрийн хананы дундаж хавтгайд — гурван маркерын хоёр нь бие биенийхээ дээр, сумны «310B/310H/310E» бичвэр давхцсан.
        /// </param>
        public static void Assign(IList<WePlannedElevation> items, IDictionary<string, WeRoomInfo> rooms, IWeUnits u, Func<WeRoomInfo, double> minSeparation = null)
        {
            if (items == null) return;
            double minFront = u.MmToInternal(300), edge = u.MmToInternal(300);
            List<WePlannedElevation> fresh = items.Where(i => i.Action == WeAction.Create && i.Frame != null && i.Box != null && i.Status <= WeStatus.Warning).ToList();
            foreach (WePlannedElevation i in items) i.Marker = null;

            foreach (IGrouping<string, WePlannedElevation> g in fresh.GroupBy(i => i.GroupKey ?? string.Empty))
            {
                List<Req> reqs = g.Select(ToReq).Where(r => r != null)
                                  .OrderByDescending(r => Math.Round(r.Item.FaceLength, 6))
                                  .ThenBy(r => r.Item.Key, StringComparer.Ordinal)
                                  .ToList();
                WeRoomInfo room = null;
                string roomUid = g.First().RoomUid;
                if (g.First().Kind == WeSourceKind.Room && !string.IsNullOrEmpty(roomUid) && rooms != null) rooms.TryGetValue(roomUid, out room);
                bool share = g.First().Kind == WeSourceKind.Room;

                var markers = new List<Mk>();
                foreach (Req r in reqs)
                {
                    bool placed = false;
                    if (share)
                        foreach (Mk m in markers)
                        {
                            int slot = FreeSlot(m, r.Look);
                            if (slot < 0) continue;
                            m.Slots[slot] = r;
                            WeV3 old = m.Position;
                            m.Position = PositionOf(m);
                            if (m.Members.All(x => Fits(x, m.Position, room, minFront, edge))) { placed = true; break; }
                            m.Slots[slot] = null;
                            m.Position = old;
                        }
                    if (placed) continue;
                    int s;
                    double rot;
                    ChooseSlot(r.Look, out s, out rot);
                    var nm = new Mk
                    {
                        Group = "m:" + (share ? g.Key : r.Item.Key) + ":" + (markers.Count + 1).ToString(CultureInfo.InvariantCulture),
                        Rotation = rot,
                    };
                    nm.Slots[s] = r;
                    nm.Position = PositionOf(nm);
                    markers.Add(nm);
                }

                double sep = minSeparation != null && room != null ? minSeparation(room) : 0;
                if (sep > 0 && markers.Count > 1) Spread(markers, room, minFront, edge, sep);
                // W04 (2026-10-16): маркер БҮРИЙГ (шинэ ганц, хуваалцсан, зөөсөн) батална — өмнө нь шинэ ганц маркерыг огт шалгадаггүй байсан тул арал /
                // нүхтэй өрөөнд тэмдэг баганын дотор, U өрөөнд гадна гарч болдог байв.  Өрөөний Location / шошгыг ХЭРЭГЛЭХГҮЙ (хэрэглэгчийн зөөсөн
                // шошго төвийг хөдөлгөхгүй), өрөө, хана, эх загварыг хөндөхгүй.
                var invalid = new HashSet<Mk>();
                Repair(markers, room, minFront, edge, sep, share ? g.Key : null, invalid);

                foreach (Mk m in markers)
                {
                    int shared = m.Members.Count();
                    bool ok = !invalid.Contains(m);
                    for (int s = 0; s < 4; s++)
                        if (m.Slots[s] != null)
                        {
                            WePlannedElevation item = m.Slots[s].Item;
                            item.Marker = new WeMarkerPlacement { Group = m.Group, Slot = s, Position = m.Position, Rotation = m.Rotation, Shared = shared, Validated = ok };
                            if (ok) continue;
                            item.Marker.Note = "Elevation маркерыг өрөөн дотор, ханаа харсан байрлалд тавих цэг олдсонгүй — тэмдгийг планд гараар зөөнө үү (дэлгээс өөрөө зөв)";
                            if (item.Status < WeStatus.Warning) item.Status = WeStatus.Warning;
                            item.Message = string.IsNullOrEmpty(item.Message) ? item.Marker.Note : item.Message + "; " + item.Marker.Note;
                        }
                }
            }
        }

        /// <summary>
        /// W04: маркер бүрийн байрлалыг батална.  Анхны байр (хуваалцсан маркерт — тэнхлэгийн дундаж, ганцад — зүсэх хавтгай дээрх ханын төв) бүх
        /// гишүүнд <see cref="Fits"/> бол хэвээр.  Үгүй бол бүх гишүүнд <see cref="Fits"/> + <see cref="KeepsDepth"/> болох ХАМГИЙН ОЙР өрөөн доторх
        /// цэг (бусад маркераас ≥ <paramref name="sep"/> байвал илүү); олдохгүй бол хуваалцсан маркерыг ХУВААНА (гишүүн бүр өөрийн маркер, дахин
        /// баталгаажуулна); ганц маркерт ч олдохгүй бол <paramref name="invalid"/>-д (анхны байрандаа, тайланд анхааруулга).  Детерминист.
        /// </summary>
        private static void Repair(List<Mk> markers, WeRoomInfo room, double minFront, double edge, double sep, string shareKey, HashSet<Mk> invalid)
        {
            for (int i = 0; i < markers.Count; i++)
            {
                Mk m = markers[i];
                if (m.Members.All(x => Fits(x, m.Position, room, minFront, edge))) continue;
                WeV3? p = Nearest(m, room, minFront, edge, markers, sep);
                if (p.HasValue) { m.Position = p.Value; continue; }
                List<Req> members = m.Members.ToList();
                if (members.Count > 1)
                {
                    // Нэг цэгээс бүх хана харагдахгүй — гишүүн бүр өөрийн маркер (жишээ: U өрөө, хоёр далавч).
                    for (int s = 0; s < 4; s++) if (m.Slots[s] != null && !ReferenceEquals(m.Slots[s], members[0])) m.Slots[s] = null;
                    m.Position = PositionOf(m);
                    foreach (Req r in members.Skip(1))
                    {
                        int slot; double rot;
                        ChooseSlot(r.Look, out slot, out rot);
                        var nm = new Mk { Group = "m:" + (shareKey ?? r.Item.Key) + ":" + (markers.Count + 1).ToString(CultureInfo.InvariantCulture), Rotation = rot };
                        nm.Slots[slot] = r;
                        nm.Position = PositionOf(nm);
                        markers.Add(nm);
                    }
                    i--;   // энэ маркерыг (одоо ганц гишүүнтэй) дахин шалгана
                    continue;
                }
                invalid.Add(m);
            }
        }

        /// <summary>
        /// Бүх гишүүнд <see cref="Fits"/> + <see cref="KeepsDepth"/> болох цэгүүдээс анхны байранд хамгийн ойрыг (бусад маркерын зайг хангасан нь
        /// түрүүлнэ).  Хайх муж = өрөөний хүрээ + гишүүдийн хана (маркерын тэнхлэгээр), 32 × 32 тор.  Олдохгүй бол null.
        /// </summary>
        private static WeV3? Nearest(Mk m, WeRoomInfo room, double minFront, double edge, List<Mk> markers, double sep)
        {
            var ax = new WeV3(Math.Cos(m.Rotation), Math.Sin(m.Rotation), 0);
            var ay = new WeV3(-Math.Sin(m.Rotation), Math.Cos(m.Rotation), 0);
            var pts = new List<WeV3>();
            if (room != null) foreach (WeRoomLoop l in room.Loops) foreach (WeBoundarySegment s in l.Segments) { pts.Add(s.A); pts.Add(s.B); }
            foreach (Req r in m.Members) { pts.Add(r.Cut); pts.Add(r.Face); }
            if (pts.Count == 0) return null;
            double x0 = pts.Min(p => p.Dot(ax)), x1 = pts.Max(p => p.Dot(ax)), y0 = pts.Min(p => p.Dot(ay)), y1 = pts.Max(p => p.Dot(ay));
            const int N = 32;
            WeV3 orig = m.Position;
            WeV3? bestSep = null, bestAny = null;
            double dSep = double.MaxValue, dAny = double.MaxValue;
            for (int a = 0; a <= N; a++)
                for (int b = 0; b <= N; b++)
                {
                    WeV3 q = ax * (x0 + (x1 - x0) * a / N) + ay * (y0 + (y1 - y0) * b / N);
                    q = new WeV3(q.X, q.Y, orig.Z);
                    if (!m.Members.All(r => Fits(r, q, room, minFront, edge) && KeepsDepth(r, q))) continue;
                    double mv = (q - orig).Flat().Length;
                    if (mv < dAny - 1e-9) { dAny = mv; bestAny = q; }
                    if ((sep <= 0 || Clearance(q, m, markers) >= sep - 1e-9) && mv < dSep - 1e-9) { dSep = mv; bestSep = q; }
                }
            return bestSep ?? bestAny;
        }

        private static Req ToReq(WePlannedElevation i)
        {
            WeV3 look = i.Frame.Look.Flat().Normalized();
            if (look.IsZero) return null;
            return new Req
            {
                Item = i,
                Look = look,
                Cut = i.Frame.ToWorld(0, 0, i.Box.Near),
                Face = i.Frame.ToWorld(0, 0, 0),
                Half = Math.Max(0, i.FaceLength / 2),
            };
        }

        private static int FreeSlot(Mk m, WeV3 look)
        {
            double phi = Math.Atan2(look.Y, look.X);
            for (int s = 0; s < 4; s++)
                if (m.Slots[s] == null && Math.Abs(Wrap(SlotLookAngle(s, m.Rotation) - phi)) < AngleTol) return s;
            return -1;
        }

        /// <summary>
        /// Маркерын төв: маркерын тэнхлэг бүрийн дагуух харагдацын хавтгайн дундаж (тэгш өнцөгт + «өрөөний дунд хүртэл» горимд
        /// эсрэг хоёр талын хавтгай давхцаж яг төвд); тэр тэнхлэгт хавтгай байхгүй бол хажуугийн ханын төв.
        /// </summary>
        private static WeV3 PositionOf(Mk m)
        {
            var ax = new WeV3(Math.Cos(m.Rotation), Math.Sin(m.Rotation), 0);
            var ay = new WeV3(-Math.Sin(m.Rotation), Math.Cos(m.Rotation), 0);
            var alongX = new List<double>(); var latX = new List<double>();
            var alongY = new List<double>(); var latY = new List<double>();
            double z = 0;
            foreach (Req r in m.Members)
            {
                z = r.Cut.Z;
                if (Math.Abs(r.Look.Dot(ax)) > 0.5) { alongX.Add(r.Cut.Dot(ax)); latY.Add(r.Cut.Dot(ay)); }
                else { alongY.Add(r.Cut.Dot(ay)); latX.Add(r.Cut.Dot(ax)); }
            }
            double cx = alongX.Count > 0 ? alongX.Average() : latX.DefaultIfEmpty(0).Average();
            double cy = alongY.Count > 0 ? alongY.Average() : latY.DefaultIfEmpty(0).Average();
            WeV3 p = ax * cx + ay * cy;
            return new WeV3(p.X, p.Y, z);
        }

        /// <summary>
        /// Хэт ойр маркеруудыг салгана: ойрхон хосын (бага гишүүнтэй, эсвэл хожуу) нэгийг нь өөрийн бүх сум ханаа заасаар (<see cref="Fits"/>)
        /// өрөөн доторх өөр цэг рүү — бусад маркераас хамгийн хол, тэнцвэл анхны байрандаа хамгийн ойр.  Зай хүрэхгүй ч хамгийн сайныг авна;
        /// сайжрахгүй бол хөдөлгөхгүй.  Детерминист (тор + тогтвортой дараалал).
        /// </summary>
        private static void Spread(List<Mk> markers, WeRoomInfo room, double minFront, double edge, double minSep)
        {
            for (int pass = 0; pass < 3; pass++)
            {
                bool movedAny = false;
                for (int i = 0; i < markers.Count; i++)
                    for (int j = i + 1; j < markers.Count; j++)
                    {
                        if ((markers[i].Position - markers[j].Position).Flat().Length >= minSep - 1e-9) continue;
                        Mk mv = markers[j].Members.Count() <= markers[i].Members.Count() ? markers[j] : markers[i];
                        if (Relocate(mv, markers, room, minFront, edge, minSep)) movedAny = true;
                    }
                if (!movedAny) return;
            }
        }

        private static double Clearance(WeV3 p, Mk self, List<Mk> markers)
        {
            double d = double.MaxValue;
            foreach (Mk o in markers) if (o != self) d = Math.Min(d, (o.Position - p).Flat().Length);
            return d;
        }

        /// <summary>Зай хүрэх (≥ <paramref name="minSep"/>) цэгүүдээс хамгийн бага шилжилттэйг; аль нь ч хүрэхгүй бол хамгийн хол зайтайг.</summary>
        private static bool Relocate(Mk m, List<Mk> markers, WeRoomInfo room, double minFront, double edge, double minSep)
        {
            // Хайх муж: гишүүдийн хананы өргөний давхцал + өрөөний хүрээ (маркерын тэнхлэгүүдээр).
            var ax = new WeV3(Math.Cos(m.Rotation), Math.Sin(m.Rotation), 0);
            var ay = new WeV3(-Math.Sin(m.Rotation), Math.Cos(m.Rotation), 0);
            var pts = new List<WeV3>();
            if (room != null) foreach (WeRoomLoop l in room.Loops) foreach (WeBoundarySegment s in l.Segments) { pts.Add(s.A); pts.Add(s.B); }
            foreach (Req r in m.Members) { pts.Add(r.Cut); pts.Add(r.Face); }
            if (pts.Count == 0) return false;
            double x0 = pts.Min(p => p.Dot(ax)), x1 = pts.Max(p => p.Dot(ax)), y0 = pts.Min(p => p.Dot(ay)), y1 = pts.Max(p => p.Dot(ay));
            const int N = 24;
            WeV3 orig = m.Position;
            double origClear = Clearance(orig, m, markers);
            if (origClear >= minSep - 1e-9) return false;
            WeV3? good = null;
            WeV3 far = orig;
            double goodMove = double.MaxValue, farClear = origClear;
            for (int a = 0; a <= N; a++)
                for (int b = 0; b <= N; b++)
                {
                    WeV3 q = ax * (x0 + (x1 - x0) * a / N) + ay * (y0 + (y1 - y0) * b / N);
                    q = new WeV3(q.X, q.Y, orig.Z);
                    if (!m.Members.All(r => Fits(r, q, room, minFront, edge) && KeepsDepth(r, q))) continue;
                    double c = Clearance(q, m, markers), mvd = (q - orig).Flat().Length;
                    if (c >= minSep - 1e-9) { if (mvd < goodMove - 1e-9) { goodMove = mvd; good = q; } }
                    else if (c > farClear + 1e-6) { farClear = c; far = q; }
                }
            WeV3 best = good ?? far;
            if ((best - orig).Flat().Length < 1e-9) return false;
            m.Position = best;
            return true;
        }

        /// <summary>Сум ханаа заах уу: ханын өргөний дотор, ханаас өмнө, өрөөн дотор.</summary>
        /// <summary>
        /// Зөөсөн маркер ханаас төлөвлөсөн зүсэх хавтгайгаас ЦААШ холдохгүй, хамгийн ихдээ хагас хүртэл ойртоно.  ХЭМЖСЭН (we-test 301E,
        /// пилястрын нүүр, 2026-10-07): маркерыг 2.2 → 3.6 м холдуулахад дэлгээс «хана хүрээ/гүнд багтсангүй» гэж шалгалтад унаж устсан.
        /// </summary>
        private static bool KeepsDepth(Req r, WeV3 p)
        {
            double d0 = (r.Face - r.Cut).Flat().Dot(r.Look), d = (r.Face - p).Flat().Dot(r.Look);
            return d <= d0 + WeTol.Length && d >= d0 * 0.5 - WeTol.Length;
        }

        private static bool Fits(Req r, WeV3 p, WeRoomInfo room, double minFront, double edge)
        {
            var t = new WeV3(-r.Look.Y, r.Look.X, 0);
            double lateral = Math.Abs((p - r.Cut).Flat().Dot(t));
            double margin = Math.Min(edge, r.Half * 0.25);
            if (lateral > Math.Max(0, r.Half - margin) + WeTol.Length) return false;
            if ((r.Face - p).Flat().Dot(r.Look) < minFront) return false;
            if (room != null && !WeKeyPlanner.InsideRoom(room, p)) return false;
            return true;
        }
    }
}
