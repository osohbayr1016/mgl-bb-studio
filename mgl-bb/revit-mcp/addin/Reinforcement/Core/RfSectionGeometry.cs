using System;
using System.Collections.Generic;

namespace RevitMcpAddin.Reinforcement.Core
{
    /// <summary>
    /// Гишүүний ЛОКАЛ тэнхлэг (U, V) — харагдацын 2D координатад.  Эргэсэн багана/дам нуруу, эргэсэн зүсэлтэд
    /// харагдацын Right/Up-тай давхцахгүй байж болно; бүх «зүүн/баруун/дээд/доод» ЭНЭ тэнхлэгээр.
    /// U нь харагдацын Right-тай ойр (U·Right ≥ 0), V нь Up-тай ойр (V·Up ≥ 0).
    /// </summary>
    public struct RfSectionFrame
    {
        public readonly RfV2 U;
        public readonly RfV2 V;

        public RfSectionFrame(RfV2 u, RfV2 v)
        {
            U = u.Normalized();
            V = v.Normalized();
        }

        public static RfSectionFrame Identity { get { return new RfSectionFrame(new RfV2(1, 0), new RfV2(0, 1)); } }

        public RfV2 ToLocal(RfV2 p) { return new RfV2(p.Dot(U), p.Dot(V)); }
        public RfV2 ToView(RfV2 l) { return U * l.X + V * l.Y; }

        /// <summary>Талын ГАДАГШ чиглэл (харагдацын 2D).</summary>
        public RfV2 Outward(RfSide s)
        {
            switch (s)
            {
                case RfSide.Left: return -U;
                case RfSide.Right: return U;
                case RfSide.Top: return V;
                default: return -V;
            }
        }
    }

    /// <summary>Огтлолын геометрийн цэвэр тооцоо: локал тэнхлэг, бетоны хүрээ, арматур ангилал, хомутын ирмэг.</summary>
    public static class RfSectionGeometry
    {
        /// <summary>Нүүрний нормаль тэнхлэгтэй «параллель» гэж үзэх cos = cos(≈1.15°).</summary>
        public const double AlignCos = RfTol.ParallelCos;

        // ── Локал тэнхлэг ──────────────────────────────────────────────

        /// <summary>
        /// Нүүрнүүдийн нормалиас гишүүний локал тэнхлэг.  Хамгийн том нүүрний нормаль = нэг тэнхлэг, түүнд
        /// перпендикуляр = нөгөө.  <paramref name="rectangular"/>: бүх нүүр (талбайгаар) тэнхлэгтэй зэрэгцээ.
        /// </summary>
        public static RfSectionFrame DetectFrame(IList<RfFaceSample> faces, out bool rectangular)
        {
            rectangular = true;
            if (faces == null || faces.Count == 0) return RfSectionFrame.Identity;

            RfFaceSample big = faces[0];
            for (int i = 1; i < faces.Count; i++)
            {
                if (faces[i].Area > big.Area) big = faces[i];
            }
            RfV2 a = big.Normal.Normalized();
            if (a.Length < 0.5) return RfSectionFrame.Identity;
            RfV2 b = a.Perp();

            foreach (RfFaceSample f in faces)
            {
                RfV2 n = f.Normal.Normalized();
                if (Math.Abs(n.Dot(a)) < AlignCos && Math.Abs(n.Dot(b)) < AlignCos)
                {
                    rectangular = false;
                    break;
                }
            }

            RfV2 u, v;
            if (Math.Abs(a.X) >= Math.Abs(b.X)) { u = a; v = b; }
            else { u = b; v = a; }
            if (u.X < 0) u = -u;
            if (v.Y < 0) v = -v;
            return new RfSectionFrame(u, v);
        }

        // ── Бетоны хүрээ ───────────────────────────────────────────────

        /// <summary>
        /// Талбайгаар хамгийн гаднах нүүр тал бүрд.  Тал дээр нүүр олдоогүй бол тухайн Face* = −1 ба хил
        /// утгагүй (NaN) — planner <see cref="FillMissing"/>-ээр нөхнө.
        /// </summary>
        public static RfSectionRect Outline(IList<RfFaceSample> faces, RfSectionFrame fr)
        {
            var r = new RfSectionRect
            {
                MinU = double.NaN, MaxU = double.NaN, MinV = double.NaN, MaxV = double.NaN,
                FaceLeft = -1, FaceRight = -1, FaceBottom = -1, FaceTop = -1,
            };
            double aL = -1, aR = -1, aB = -1, aT = -1;
            // Тал бүрийн (огтлолыг хөвсөн) параллель нүүрнүүдийн байрлалын хамгийн бага/их — хоёр ӨӨР байрлал бол талд хоёрдмол утгатай.
            double rMin = double.NaN, rMax = double.NaN, lMin = double.NaN, lMax = double.NaN;
            double tMin = double.NaN, tMax = double.NaN, bMin = double.NaN, bMax = double.NaN;

            foreach (RfFaceSample f in faces)
            {
                // Огтлолын хавтгайг ХӨВӨӨГҮЙ нүүр (ж: налуу/хазгай гишүүний ӨӨР станцын нүүр) энэ огтлолын бетоны хил биш.
                if (!f.StraddlesCutPlane) continue;
                RfV2 n = fr.ToLocal(f.Normal.Normalized());
                RfV2 o = fr.ToLocal(f.Origin);
                if (n.X >= AlignCos) Track(ref rMin, ref rMax, o.X);
                else if (n.X <= -AlignCos) Track(ref lMin, ref lMax, o.X);
                else if (n.Y >= AlignCos) Track(ref tMin, ref tMax, o.Y);
                else if (n.Y <= -AlignCos) Track(ref bMin, ref bMax, o.Y);
                if (n.X >= AlignCos)
                {
                    if (Better(o.X, f.Area, r.MaxU, aR, true)) { r.MaxU = o.X; r.FaceRight = f.Id; aR = f.Area; }
                }
                else if (n.X <= -AlignCos)
                {
                    if (Better(o.X, f.Area, r.MinU, aL, false)) { r.MinU = o.X; r.FaceLeft = f.Id; aL = f.Area; }
                }
                else if (n.Y >= AlignCos)
                {
                    if (Better(o.Y, f.Area, r.MaxV, aT, true)) { r.MaxV = o.Y; r.FaceTop = f.Id; aT = f.Area; }
                }
                else if (n.Y <= -AlignCos)
                {
                    if (Better(o.Y, f.Area, r.MinV, aB, false)) { r.MinV = o.Y; r.FaceBottom = f.Id; aB = f.Area; }
                }
            }
            r.AmbiguousRight = Spread(rMin, rMax);
            r.AmbiguousLeft = Spread(lMin, lMax);
            r.AmbiguousTop = Spread(tMin, tMax);
            r.AmbiguousBottom = Spread(bMin, bMax);
            return r;
        }

        private static void Track(ref double min, ref double max, double v)
        {
            if (double.IsNaN(min) || v < min) min = v;
            if (double.IsNaN(max) || v > max) max = v;
        }

        /// <summary>Нэг талын параллель нүүрнүүд 1 мм-ээс илүү зайтай хоёр байрлалд байна уу.</summary>
        private static bool Spread(double min, double max)
        {
            return !double.IsNaN(min) && !double.IsNaN(max) && max - min > RfTol.MmToFt(1.0);
        }

        /// <summary>pos нь одоогийн хамгийн гадна утгаас гадна (эсвэл ижил байрлалд том талбайтай) эсэх.</summary>
        private static bool Better(double pos, double area, double current, double currentArea, bool larger)
        {
            if (double.IsNaN(current)) return true;
            double d = larger ? pos - current : current - pos;
            if (d > RfTol.PointFt) return true;
            return Math.Abs(d) <= RfTol.PointFt && area > currentArea;
        }

        /// <summary>
        /// Нүүр олдоогүй талыг бүх нүүрний ЦЭГҮҮДИЙН хүрээгээр нөхнө.  Нөхсөн тал бүрийн жагсаалтыг буцаана
        /// (planner анхааруулна) — ингэхэд тэр талд Reference байхгүй тул хэмжээс тавигдахгүй.
        /// </summary>
        public static List<RfSide> FillMissing(ref RfSectionRect r, IList<RfFaceSample> faces, RfSectionFrame fr)
        {
            var missing = new List<RfSide>();
            if (faces == null || faces.Count == 0) return missing;
            double minU = double.MaxValue, maxU = double.MinValue, minV = double.MaxValue, maxV = double.MinValue;
            foreach (RfFaceSample f in faces)
            {
                RfV2 o = fr.ToLocal(f.Origin);
                if (o.X < minU) minU = o.X;
                if (o.X > maxU) maxU = o.X;
                if (o.Y < minV) minV = o.Y;
                if (o.Y > maxV) maxV = o.Y;
            }
            if (r.FaceLeft < 0) { r.MinU = minU; missing.Add(RfSide.Left); }
            if (r.FaceRight < 0) { r.MaxU = maxU; missing.Add(RfSide.Right); }
            if (r.FaceBottom < 0) { r.MinV = minV; missing.Add(RfSide.Bottom); }
            if (r.FaceTop < 0) { r.MaxV = maxV; missing.Add(RfSide.Top); }
            return missing;
        }

        // ── Арматурын ангилал ──────────────────────────────────────────

        /// <summary>
        /// Цэгүүдийн (хаалттай полигон гэж үзсэн) Newell-ийн нормаль + хавтгайгаас хамгийн их хазайлт.
        /// Шулуун (нэг шугамд) бол false.
        /// </summary>
        public static bool TryPlaneNormal(IList<RfV3> pts, out RfV3 normal, out double maxDev)
        {
            normal = new RfV3(0, 0, 0);
            maxDev = 0;
            if (pts == null || pts.Count < 3) return false;

            RfV3 o = pts[0];
            double nx = 0, ny = 0, nz = 0;
            int n = pts.Count;
            for (int i = 0; i < n; i++)
            {
                RfV3 p = pts[i] - o;
                RfV3 q = pts[(i + 1) % n] - o;
                nx += (p.Y - q.Y) * (p.Z + q.Z);
                ny += (p.Z - q.Z) * (p.X + q.X);
                nz += (p.X - q.X) * (p.Y + q.Y);
            }
            double len = Math.Sqrt(nx * nx + ny * ny + nz * nz);
            double ext = Extent(pts);
            // Туйлын жижиг талбайтай (бараг шулуун) гинж хавтгай тодорхойлж чадахгүй.
            if (len < 1e-9 * Math.Max(1, ext * ext)) return false;
            normal = new RfV3(nx / len, ny / len, nz / len);

            double dev = 0;
            for (int i = 0; i < n; i++)
            {
                double d = Math.Abs((pts[i] - o).Dot(normal));
                if (d > dev) dev = d;
            }
            maxDev = dev;
            return true;
        }

        /// <summary>Хамгийн урт хэрчмийн нэгж чиглэл (хамгийн хол цэгүүдийн хоорондох чиглэл биш — арматурын гол чиглэл).</summary>
        public static RfV3 DominantDirection(IList<RfV3> pts)
        {
            double best = 0;
            RfV3 dir = new RfV3(0, 0, 0);
            for (int i = 0; i + 1 < pts.Count; i++)
            {
                RfV3 d = pts[i + 1] - pts[i];
                double l = d.Length;
                if (l > best)
                {
                    best = l;
                    dir = d;
                }
            }
            return dir.Normalized();
        }

        /// <summary>Цэгүүдийн хамгийн их харилцан зай (bounding хэмжээ).</summary>
        public static double Extent(IList<RfV3> pts)
        {
            if (pts == null || pts.Count == 0) return 0;
            double minX = double.MaxValue, minY = double.MaxValue, minZ = double.MaxValue;
            double maxX = double.MinValue, maxY = double.MinValue, maxZ = double.MinValue;
            foreach (RfV3 p in pts)
            {
                if (p.X < minX) minX = p.X;
                if (p.Y < minY) minY = p.Y;
                if (p.Z < minZ) minZ = p.Z;
                if (p.X > maxX) maxX = p.X;
                if (p.Y > maxY) maxY = p.Y;
                if (p.Z > maxZ) maxZ = p.Z;
            }
            double dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
            return Math.Sqrt(dx * dx + dy * dy + dz * dz);
        }

        /// <summary>
        /// Хомут/боолт (transverse) эсэх, ажлын арматур (longitudinal) эсэх.  ⚠️ Нэр («Stirrup»)-ээр БИШ,
        /// геометрээр: хавтгай гогцоо + хавтгайн нормаль нь огтлолын нормальтай параллель ⇒ хомут; гол чиглэл нь
        /// огтлолын нормальтай параллель ⇒ ажлын арматур.
        /// </summary>
        public static RfBarClass Classify(IList<RfV3> pts, RfV3 viewNormal)
        {
            if (pts == null || pts.Count < 2) return RfBarClass.Other;
            RfV3 vn = viewNormal.Normalized();

            RfV3 n;
            double dev;
            double ext = Extent(pts);
            if (TryPlaneNormal(pts, out n, out dev) && dev <= 1e-4 + 1e-3 * ext)
            {
                if (Math.Abs(n.Dot(vn)) >= RfTol.StirrupPlaneCos) return RfBarClass.Transverse;
            }

            RfV3 d = DominantDirection(pts);
            if (d.Length > 0.5 && Math.Abs(d.Dot(vn)) >= RfTol.LongitudinalCos) return RfBarClass.Longitudinal;
            return RfBarClass.Other;
        }

        /// <summary>
        /// Ангилалын ЭЦСИЙН шийдвэр: Revit-ийн <see cref="RfRebarStyle"/> ЭХЭЛЖ, геометр нь түүнийг БАТАЛНА (shape-ийн
        /// нэрээр БИШ).  Style мэдэгдэхгүй (free-form accessor/shape уншигдаагүй) үед геометр л шийднэ.
        ///
        /// <list type="bullet">
        /// <item>StirrupTie + хавтгай гогцоо огтлолд перпендикуляр ⇒ <see cref="RfBarClass.Transverse"/> (tag + хэмжээс).</item>
        /// <item>Standard + урт нь огтлолын нормалиар ⇒ <see cref="RfBarClass.Longitudinal"/> (ЗӨВХӨН tag).</item>
        /// <item>Standard боловч хомут шиг хавтгай гогцоо ⇒ <see cref="RfBarClass.Transverse"/> + <see cref="RfClassBasis.StandardLoop"/>:
        /// гогцоог tag-лана, ХЭМЖЭЭС тавихгүй (Standard ⇒ зөвхөн tag).</item>
        /// <item>StirrupTie боловч уртааш (огтлолын нормалиар урсах) ⇒ Other + <see cref="RfClassBasis.Mismatch"/>: таамаглахгүй,
        /// алгасаж тайланд хэлнэ.</item>
        /// <item>Геометр «Other» (өөр чиглэлийн хомут, налуу г.м.) ⇒ Other (style ямар ч байсан огтлолд хамаагүй).</item>
        /// </list>
        /// </summary>
        public static RfBarClass Resolve(RfRebarStyle style, RfBarClass geometry, out RfClassBasis basis)
        {
            basis = RfClassBasis.Geometry;
            if (style == RfRebarStyle.Unknown) return geometry;

            basis = RfClassBasis.Style;
            if (geometry == RfBarClass.Other) return RfBarClass.Other;

            if (style == RfRebarStyle.StirrupTie)
            {
                if (geometry == RfBarClass.Transverse) return RfBarClass.Transverse;
            }
            else
            {
                if (geometry == RfBarClass.Longitudinal) return RfBarClass.Longitudinal;
                if (geometry == RfBarClass.Transverse)
                {
                    basis = RfClassBasis.StandardLoop;
                    return RfBarClass.Transverse;
                }
            }
            basis = RfClassBasis.Mismatch;
            return RfBarClass.Other;
        }

        // ── Tag-ийн бүлэглэл ───────────────────────────────────────────

        /// <summary>
        /// Ажлын арматурын бетоны хүрээний АЛЬ ТАЛД хамгийн ойр (ирмэг хүртэлх зайгаар).  Тэнцүү (булан) бол ТОГТМОЛ дараалал:
        /// Доод, Дээд, Зүүн, Баруун — ингэснээр бүлэглэл ажиллуулалт бүрд ижил.
        /// </summary>
        public static RfSide NearestSide(RfV2 localPos, RfSectionRect rect)
        {
            double dB = localPos.Y - rect.MinV, dT = rect.MaxV - localPos.Y;
            double dL = localPos.X - rect.MinU, dR = rect.MaxU - localPos.X;
            RfSide best = RfSide.Bottom;
            double bestD = dB;
            if (dT < bestD - RfTol.PointFt) { best = RfSide.Top; bestD = dT; }
            if (dL < bestD - RfTol.PointFt) { best = RfSide.Left; bestD = dL; }
            if (dR < bestD - RfTol.PointFt) { best = RfSide.Right; }
            return best;
        }

        /// <summary>
        /// Tag-ийн бүлэглэлтийн түлхүүр = арматурын төрөл|голч|shape (Revit талаас) + гишүүний тал.  Арматурын тэг/хоосон
        /// түлхүүртэй бол бүлэглэхгүй — элемент бүр өөрийн түлхүүртэй (<c>id:…</c>).
        /// </summary>
        public static string TagGroupKey(RfLongBar bar, RfSectionRect rect, bool group)
        {
            return TagGroupKey(bar, rect, group, null);
        }

        /// <summary>
        /// <paramref name="setCentre"/> өгөгдвөл (SingleTagPerSet) гишүүний талыг ширхгийн БИШ, олонлогийн (нэг элементийн бүх ширхгийн) төвөөр тогтооно —
        /// ингэснээр нэг олонлогийн бүх ширхэг ЯГ НЭГ бүлэгт орж ЯГ НЭГ tag гарна.
        /// </summary>
        public static string TagGroupKey(RfLongBar bar, RfSectionRect rect, bool group, RfV2? setCentre)
        {
            if (!group || string.IsNullOrEmpty(bar.Group))
                return "id:" + bar.Id.ToString(System.Globalization.CultureInfo.InvariantCulture);
            return bar.Group + "|" + NearestSide(setCentre.HasValue ? setCentre.Value : bar.Pos, rect);
        }

        /// <summary>
        /// Tag-ийн нэгтгэлийн ЭЦСИЙН түлхүүр: Revit-талын түлхүүр + <b>Rebar Number</b> + <b>Partition</b>.  Rebar Number нь ЗӨВХӨН өөрийн Partition дотор давтагдахгүй
        /// (NumberingSchema) — «ДН-1» №1 ба «ДН-2» №1 нь ӨӨР арматур тул нэгтгэхгүй.  Дугаар хоосон бол хоосон түлхүүр (нэгтгэхгүй — элемент бүр өөрийн tag-тай).
        /// </summary>
        public static string NumberedGroupKey(string baseKey, string rebarNumber, string partition)
        {
            if (string.IsNullOrWhiteSpace(rebarNumber) || string.IsNullOrEmpty(baseKey)) return string.Empty;
            return baseKey + "|#" + rebarNumber.Trim() + "|p:" + (partition ?? string.Empty).Trim();
        }

        /// <summary>
        /// Ажлын арматурын Revit-талын түлхүүр: төрөл | голч (0.01 мм-д дугуйлсан) | shape.  Голчийг дугуйлах нь хөвөгч цэгийн
        /// шуугианаар ижил арматурыг хоёр бүлэг болгохоос сэргийлнэ.
        /// </summary>
        public static string BarGroupKey(long typeId, double diameterFt, long shapeId)
        {
            long dia = (long)Math.Round(diameterFt * RfTol.MmPerFoot * 100.0);
            return typeId.ToString(System.Globalization.CultureInfo.InvariantCulture) + "|"
                + dia.ToString(System.Globalization.CultureInfo.InvariantCulture) + "|"
                + shapeId.ToString(System.Globalization.CultureInfo.InvariantCulture);
        }

        /// <summary>
        /// Ажлын арматур харагдацын хавтгайг огтолсон цэг (харагдацын 2D).  Гинжийн хэрчим бүрийн гүн (хавтгайгаас
        /// зай)-ийн тэмдэг солигдсон хамгийн эхний хэрчимд интерполяци хийнэ; огтлоогүй бол false.
        /// </summary>
        public static bool TryCutPoint(IList<RfV3> pts, RfViewFrame view, out RfV2 pos)
        {
            pos = new RfV2(0, 0);
            if (pts == null || pts.Count < 2) return false;
            double prev = view.DepthOf(pts[0]);
            for (int i = 1; i < pts.Count; i++)
            {
                double cur = view.DepthOf(pts[i]);
                // Гүн нь тэг дундуур дайрсан (эсвэл яг тэг дээр).
                if ((prev <= 0 && cur >= 0) || (prev >= 0 && cur <= 0))
                {
                    double d = cur - prev;
                    double t = Math.Abs(d) < 1e-12 ? 0 : -prev / d;
                    RfV3 p = pts[i - 1] + (pts[i] - pts[i - 1]) * t;
                    pos = view.ToView(p);
                    return true;
                }
                prev = cur;
            }
            return false;
        }

        // ── Хомутын гогцоо ба ирмэг ─────────────────────────────────────

        /// <summary>Хомутын голын шугамын локал хүрээ ба огтлолын хавтгайгаас зай.</summary>
        public static RfStirrupLoop LoopOf(RfBarSample s, RfViewFrame view, RfSectionFrame fr)
        {
            var loop = new RfStirrupLoop
            {
                Id = s.Id,
                BarIndex = s.BarIndex,
                Diameter = s.Diameter,
                TagOnly = s.TagOnly,
                MinU = double.MaxValue, MaxU = double.MinValue, MinV = double.MaxValue, MaxV = double.MinValue,
            };
            double depth = 0;
            var local = new List<RfV2>(s.Points.Count);
            foreach (RfV3 p in s.Points)
            {
                RfV2 l = fr.ToLocal(view.ToView(p));
                local.Add(l);
                if (l.X < loop.MinU) loop.MinU = l.X;
                if (l.X > loop.MaxU) loop.MaxU = l.X;
                if (l.Y < loop.MinV) loop.MinV = l.Y;
                if (l.Y > loop.MaxV) loop.MaxV = l.Y;
                depth += view.DepthOf(p);
            }
            loop.Depth = s.Points.Count == 0 ? 0 : depth / s.Points.Count;
            if (local.Count >= 2)
            {
                // Хөлийг хүрээний захаас LegBand дотор хайна (дэгээний давхцал d/2 — хэмжсэн).  Голч мэдэгдэхгүй бол хуучин шиг зөвхөн 1 мм.
                double band = s.Diameter > 0 && RfTol.IsFiniteNumber(s.Diameter) ? LegBandDiameters * s.Diameter : 0;
                double leg;
                loop.CoverLeft = SideLeg(local, true, loop.MinU, -1, loop.MaxV - loop.MinV, band, out leg);
                loop.LegLeft = leg;
                loop.CoverRight = SideLeg(local, true, loop.MaxU, +1, loop.MaxV - loop.MinV, band, out leg);
                loop.LegRight = leg;
                loop.CoverBottom = SideLeg(local, false, loop.MinV, -1, loop.MaxU - loop.MinU, band, out leg);
                loop.LegBottom = leg;
                loop.CoverTop = SideLeg(local, false, loop.MaxV, +1, loop.MaxU - loop.MinU, band, out leg);
                loop.LegTop = leg;
            }
            return loop;
        }

        /// <summary>Хөлийг хүрээний захаас хэдэн голчийн дотор хайх (дэгээний давхцал = d/2; хоёр хөлтэй хомутын дотор хөл ≫ 1.5d).</summary>
        public const double LegBandDiameters = 1.5;

        /// <summary>
        /// Тал дээрх БОДИТ хөл: хүрээний зах (<paramref name="extent"/>)-аас дотогш <paramref name="band"/> зайд, хилтэй параллель шулуун хэрчмүүдийг
        /// координатаар (1 мм) бүлэглэж, хамгийн ГАДНАХ, хамрах хувь нь ≥ <see cref="MinSideCoverage"/> бүлгийг сонгоно.
        /// <paramref name="leg"/> = тэр бүлгийн координат (олдоогүй бол NaN); буцаах утга = хамрах хувь (олдоогүй бол band доторх хамгийн их хувь).
        /// band = 0 бол яг <see cref="SideCoverage"/> (зах ± 1 мм).
        /// </summary>
        /// <param name="outward">−1 = Left/Bottom (min тал), +1 = Right/Top (max тал).</param>
        public static double SideLeg(IList<RfV2> pts, bool vertical, double extent, int outward, double span, double band, out double leg)
        {
            leg = double.NaN;
            if (pts == null || pts.Count < 2 || !(span > 1e-9)) return 0;
            double tol = RfTol.MmToFt(1.0);
            double reach = Math.Max(0, band) + tol;
            var segs = new List<KeyValuePair<double, double>>(); // координат, урт
            for (int i = 0; i + 1 < pts.Count; i++)
            {
                double a = vertical ? pts[i].X : pts[i].Y;
                double b = vertical ? pts[i + 1].X : pts[i + 1].Y;
                if (Math.Abs(a - b) > tol) continue; // хилтэй параллель биш
                double c = (a + b) / 2;
                double inward = (extent - c) * outward; // захаас дотогш зай (≥ 0)
                if (inward < -tol || inward > reach) continue;
                double len = vertical ? Math.Abs(pts[i + 1].Y - pts[i].Y) : Math.Abs(pts[i + 1].X - pts[i].X);
                if (len > 0) segs.Add(new KeyValuePair<double, double>(c, len));
            }
            if (segs.Count == 0) return 0;

            // Гаднаас дотогш эрэмбэлээд 1 мм-ийн бүлэг болгоно.
            segs.Sort((x, y) => (y.Key * outward).CompareTo(x.Key * outward));
            double best = 0;
            int k = 0;
            while (k < segs.Count)
            {
                double head = segs[k].Key, sum = 0, weighted = 0;
                int j = k;
                for (; j < segs.Count && Math.Abs(segs[j].Key - head) <= tol; j++)
                {
                    sum += segs[j].Value;
                    weighted += segs[j].Key * segs[j].Value;
                }
                double cover = Math.Min(1.0, sum / span);
                if (cover >= MinSideCoverage)
                {
                    leg = weighted / sum;
                    return cover;
                }
                if (cover > best) best = cover;
                k = j;
            }
            return best;
        }

        /// <summary>Хомутын тал хамгийн багадаа энэ хувиар (хилийн дагуух шулуун хэсгээр) бодит арматур байх ёстой — үгүй бол хэмжээс тавихгүй.</summary>
        public const double MinSideCoverage = 0.5;

        /// <summary>
        /// Хилийн шугам (<paramref name="vertical"/> бол u = <paramref name="extent"/>, үгүй бол v = extent)-ыг дагасан ЦУГЛУУЛСАН хоёр цэгийн (хоёулаа
        /// 1 мм дотор) хэрчмийн нийт урт ÷ тэр талын дэлгэц (span).  Нээлттэй/хэлбэр буруу талд ≈ 0.
        /// </summary>
        public static double SideCoverage(IList<RfV2> pts, bool vertical, double extent, double span)
        {
            if (pts == null || pts.Count < 2 || !(span > 1e-9)) return 0;
            double tol = RfTol.MmToFt(1.0);
            double sum = 0;
            for (int i = 0; i + 1 < pts.Count; i++)
            {
                double a = vertical ? pts[i].X : pts[i].Y;
                double b = vertical ? pts[i + 1].X : pts[i + 1].Y;
                if (Math.Abs(a - extent) > tol || Math.Abs(b - extent) > tol) continue;
                sum += vertical ? Math.Abs(pts[i + 1].Y - pts[i].Y) : Math.Abs(pts[i + 1].X - pts[i].X);
            }
            return Math.Min(1.0, sum / span);
        }

        /// <summary>Тал дээр хамгийн ГАДНАХ хомут (тэнцүү бол огтлолын хавтгайд ойр нь).  Хомут байхгүй бол null.</summary>
        public static RfStirrupLoop Outermost(IList<RfStirrupLoop> loops, RfSide side)
        {
            RfStirrupLoop best = null;
            foreach (RfStirrupLoop l in loops)
            {
                if (best == null) { best = l; continue; }
                double dl = Outwardness(l, side), db = Outwardness(best, side);
                if (dl > db + RfTol.PointFt || (Math.Abs(dl - db) <= RfTol.PointFt && Math.Abs(l.Depth) < Math.Abs(best.Depth)))
                    best = l;
            }
            return best;
        }

        private static double Outwardness(RfStirrupLoop l, RfSide s)
        {
            double e = l.Extent(s);
            return (s == RfSide.Right || s == RfSide.Top) ? e : -e;
        }

        /// <summary>
        /// Хомутын ирмэгийн координат (талын ГАДАГШ тэнхлэгт).  Голын шугамын хил <paramref name="centerlineExtent"/>,
        /// голч <paramref name="diameter"/>.  Right/Top: гадна = хил + d/2; Left/Bottom: гадна = хил − d/2;
        /// дотор нь эсрэг; тэнхлэг = хил.
        /// </summary>
        public static double EdgePos(RfSide side, RfStirrupRef kind, double centerlineExtent, double diameter)
        {
            if (kind == RfStirrupRef.Center) return centerlineExtent;
            double half = diameter / 2;
            bool positive = side == RfSide.Right || side == RfSide.Top;
            double outer = positive ? centerlineExtent + half : centerlineExtent - half;
            double inner = positive ? centerlineExtent - half : centerlineExtent + half;
            return kind == RfStirrupRef.Outer ? outer : inner;
        }

        /// <summary>Бетон нүүрээс хомутын ирмэг хүртэлх зай (дотогш эерэг).</summary>
        public static double Cover(RfSide side, double facePos, double edgePos)
        {
            bool positive = side == RfSide.Right || side == RfSide.Top;
            return positive ? facePos - edgePos : edgePos - facePos;
        }
    }
}
