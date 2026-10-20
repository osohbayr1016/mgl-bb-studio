using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>
    /// Өрөөний 3D тэнхлэгэн (axon) зураг: тайрах хайрцаг (section box) өрөөний гол чиглэлд эргүүлсэн, харагч талын ханыг тайрч
    /// (өрөөний дотор харагдана), тааз доогуур тайрсан; харах чиглэл = изометр (доош 35°).
    /// </summary>
    public sealed class WeAxonPlan
    {
        public string Key;
        /// <summary>Хайрцгийн координат: Origin + AxisX·x + AxisY·y + Z·z (AxisX, AxisY хэвтээ, Z дээш).</summary>
        public WeV3 Origin;
        public WeV3 AxisX;
        public WeV3 AxisY;
        public double MinX, MaxX, MinY, MaxY, MinZ, MaxZ;
        /// <summary>Харах чиглэл (нүднээс зорилт руу), дээш чиглэл, нүдний байрлал — Revit-ийн ViewOrientation3D.</summary>
        public WeV3 Forward;
        public WeV3 Up;
        public WeV3 Eye;
        public int Scale;

        /// <summary>Хайрцгийн 8 орой (дэлхийн).</summary>
        public IEnumerable<WeV3> Corners()
        {
            for (int i = 0; i < 8; i++)
            {
                double x = (i & 1) == 0 ? MinX : MaxX, y = (i & 2) == 0 ? MinY : MaxY, z = (i & 4) == 0 ? MinZ : MaxZ;
                yield return Origin + AxisX * x + AxisY * y + WeV3.UnitZ * z;
            }
        }
    }

    public static class WeAxonPlanner
    {
        public static string KeyOf(string roomUid) { return "axon|room:" + (roomUid ?? string.Empty); }

        /// <summary>
        /// Өрөөний таазны доод өндөр: өрөөний хайрцагтай огтлолцох тааз (шалнаас ≥ 1 м дээр) — хамгийн доод нь.  Байхгүй бол NaN.
        /// </summary>
        public static double CeilingZ(WeRoomInfo room, WeAnnoSources src, IWeUnits u)
        {
            if (room == null || src == null) return double.NaN;
            var pts = room.Loops.SelectMany(l => l.Segments).SelectMany(s => new[] { s.A, s.B }).ToList();
            if (pts.Count == 0) return double.NaN;
            double x0 = pts.Min(p => p.X), x1 = pts.Max(p => p.X), y0 = pts.Min(p => p.Y), y1 = pts.Max(p => p.Y);
            double best = double.NaN;
            foreach (WeSlabInfo c in src.Slabs.Where(s => s.Kind == WeSlabKind.Ceiling))
            {
                if (c.Max.X <= x0 || c.Min.X >= x1 || c.Max.Y <= y0 || c.Min.Y >= y1) continue;
                if (c.Min.Z <= room.BottomZ + u.MmToInternal(1000) || c.Min.Z >= room.TopZ + u.MmToInternal(1000)) continue;
                if (double.IsNaN(best) || c.Min.Z < best) best = c.Min.Z;
            }
            return best;
        }

        public static WeAxonPlan Plan(WeRoomInfo room, double ceilingZ, double wallWidth, WeSettings s, IWeUnits u)
        {
            var ap = new WeAxonPlan { Key = KeyOf(room != null ? room.UniqueId : null), Scale = Math.Max(1, s.AxonScale) };
            if (room == null || room.Loops.Count == 0) return ap;

            // Гол чиглэл = гадна контурын ХАМГИЙН урт шулуун сегмент (эргүүлсэн өрөөнд хайрцаг ч эргэнэ).
            WeRoomLoop outer = room.Loops.OrderByDescending(l => Math.Abs(RoomBoundaryAnalyzer.SignedArea(l.Segments))).First();
            WeBoundarySegment longest = outer.Segments.Where(x => x.IsStraight).OrderByDescending(x => (x.B - x.A).Flat().Length).FirstOrDefault()
                                        ?? outer.Segments.OrderByDescending(x => (x.B - x.A).Flat().Length).FirstOrDefault();
            WeV3 ax = longest != null ? (longest.B - longest.A).Flat().Normalized() : new WeV3(1, 0, 0);
            if (ax.IsZero) ax = new WeV3(1, 0, 0);
            // Контурын чиглэлээс үл хамааран тогтвортой: X нь (−45°, 135°] мужид.
            if (ax.X + ax.Y < -1e-9 || (Math.Abs(ax.X + ax.Y) <= 1e-9 && ax.X < 0)) ax = -ax;
            WeV3 ay = WeV3.UnitZ.Cross(ax).Normalized();
            ap.AxisX = ax;
            ap.AxisY = ay;

            var pts = room.Loops.SelectMany(l => l.Segments).SelectMany(x => new[] { x.A.Flat(), x.B.Flat() }).ToList();
            ap.Origin = new WeV3(pts.Average(p => p.X), pts.Average(p => p.Y), 0);
            double lx0 = pts.Min(p => (p - ap.Origin).Dot(ax)), lx1 = pts.Max(p => (p - ap.Origin).Dot(ax));
            double ly0 = pts.Min(p => (p - ap.Origin).Dot(ay)), ly1 = pts.Max(p => (p - ap.Origin).Dot(ay));
            // Харагч тал (−X, −Y): өрөөний дотор гадаргуунаас 5 мм дотогш тайрна → ойрын хана харагдахгүй (жишээ зургийн тайралт).
            // Цаад тал (+X, +Y): ханын зузаан + 150 мм — хана бүтнээрээ.
            double inset = u.MmToInternal(5), far = Math.Max(0, wallWidth) + u.MmToInternal(150);
            ap.MinX = lx0 + inset;
            ap.MaxX = lx1 + far;
            ap.MinY = ly0 + inset;
            ap.MaxY = ly1 + far;
            ap.MinZ = room.BottomZ - u.MmToInternal(200);
            double cut = !double.IsNaN(ceilingZ) ? ceilingZ - u.MmToInternal(50)
                                                 : Math.Min(room.TopZ - u.MmToInternal(300), room.BottomZ + u.MmToInternal(3500));
            if (cut < room.BottomZ + u.MmToInternal(1000)) cut = Math.Max(room.TopZ, room.BottomZ + u.MmToInternal(1000));
            ap.MaxZ = cut;

            // Изометр: (−X, −Y, +Z) булангаас төв рүү.
            WeV3 fwd = (ax + ay - WeV3.UnitZ).Normalized();
            ap.Forward = fwd;
            ap.Up = (WeV3.UnitZ - fwd * WeV3.UnitZ.Dot(fwd)).Normalized();
            WeV3 c = ap.Origin + ax * ((ap.MinX + ap.MaxX) / 2) + ay * ((ap.MinY + ap.MaxY) / 2) + WeV3.UnitZ * ((ap.MinZ + ap.MaxZ) / 2);
            double diag = Math.Sqrt(Math.Pow(ap.MaxX - ap.MinX, 2) + Math.Pow(ap.MaxY - ap.MinY, 2) + Math.Pow(ap.MaxZ - ap.MinZ, 2));
            ap.Eye = c - fwd * Math.Max(diag * 2, u.MmToInternal(10000));
            return ap;
        }
    }
}
