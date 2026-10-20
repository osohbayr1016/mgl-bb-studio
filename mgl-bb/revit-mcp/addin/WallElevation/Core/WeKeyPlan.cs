using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>Түлхүүр план дээрх нэг талын тэмдэг: «205A» хайрцагтай бичвэр + хана руу заасан leader.</summary>
    public sealed class WeKeyMarker
    {
        /// <summary><see cref="WePlannedElevation.Key"/> — Revit давхарга зөвхөн бодитоор үүссэн дэлгээсийн тэмдгийг зурна.</summary>
        public string ElevationKey;
        public string Label;
        /// <summary>Leader-ийн төгсгөл: харах гадаргуугийн дунд цэг (план, дэлхийн).</summary>
        public WeV3 Target;
        /// <summary>Бичвэрийн төв (план, дэлхийн) — өрөөний ДОТОР, гадаргуунаас дотогш.</summary>
        public WeV3 LabelAt;
        /// <summary>Харах чиглэл (өрөөнөөс хана руу, хэвтээ нэгж).</summary>
        public WeV3 Look;
        /// <summary>
        /// Бичвэрийн мөрийн тоо (W07, 2026-10-16): БИЧВЭР тэмдэг (зүсэлт / хуучин харагдац — Revit-ийн маркергүй) хуудасны горимд 2 — «205A»
        /// доор хуудасны дугаар.  Revit-ийн Elevation маркер (Detail Number + Sheet Number өөрөө) — 1 (хайрцаг, хүрээ өмнөхтэй ЯГ ижил).
        /// </summary>
        public int Lines = 1;
    }

    /// <summary>Нэг өрөөний түлхүүр план: хүрээ (дэлхийн XY) + тэмдгүүд.  Өрөөний хилийг Revit давхарга өрөөнөөс өөрөө уншина.</summary>
    public sealed class WeKeyPlan
    {
        /// <summary>Extensible Storage-ийн түлхүүр — нэрээс үл хамааран дахин ажиллуулахад ижил план олдоно.</summary>
        public string Key;
        public double MinX, MinY, MaxX, MaxY;
        public int Scale;
        public List<WeKeyMarker> Markers = new List<WeKeyMarker>();
        /// <summary>Шинэ Elevation маркеруудын төв (план) — өрөөний шошгыг тэдгээрээс зайдуу тавина.</summary>
        public List<WeV3> Avoid = new List<WeV3>();

        public double Width { get { return MaxX - MinX; } }
        public double Height { get { return MaxY - MinY; } }
    }

    /// <summary>
    /// «Түлхүүр байгуулалт» (жишээ зургийн зүүн дээд блок) — ЦЭВЭР тооцоо: хүрээ ба тал бүрийн тэмдгийн байрлал.
    ///   • Тэмдэг = гадаргуугийн дунд цэгээс өрөөний ДОТОР руу цаасан дээр ~9 мм (нарийн өрөөнд өрөөний гүний 35 %-иас ихгүй);
    ///   • ойрхон хоёр тэмдэг давхцвал хойдыг нь гадаргуугийн дагуу шилжүүлнэ (тодорхой дараалалтай);
    ///   • хүрээ = өрөөний хил + тэмдэг + <see cref="WeSettings.KeyPlanMarginMm"/> (эргэн тойрон, тэнхлэгийн толгой харагдахаар).
    /// </summary>
    public static class WeKeyPlanner
    {
        /// <summary>Тэмдэг гадаргуунаас хэр дотогш (цаасан дээр, мм).</summary>
        public const double LabelOffsetPaperMm = 10;
        /// <summary>Бичвэрийн хайрцгийн ойролцоо хэмжээ (цаас, мм): өндөр, тэмдэгт тутмын өргөн, нэмэлт.</summary>
        public const double LabelHeightPaperMm = 8.5;
        public const double LabelCharPaperMm = 2.4;
        public const double LabelPadPaperMm = 4;

        public static string KeyOf(string roomUid) { return "key|room:" + (roomUid ?? string.Empty); }

        public static WeKeyPlan Plan(WeRoomInfo room, IList<WePlannedElevation> items, WeSettings s, IWeUnits u)
        {
            var kp = new WeKeyPlan { Key = KeyOf(room != null ? room.UniqueId : null), Scale = ExpectedScale(room, s, u) };
            if (room == null) return kp;
            double scale = kp.Scale;
            Func<double, double> paper = mm => u.MmToInternal(mm * scale);

            var pts = new List<WeV3>();
            foreach (WeRoomLoop loop in room.Loops)
                foreach (WeBoundarySegment seg in loop.Segments) { pts.Add(seg.A.Flat()); pts.Add(seg.B.Flat()); }
            bool sheetRefs = s != null && s.Output == WeOutputMode.ViewsAndSheets;

            foreach (WePlannedElevation i in items.Where(i => i.Frame != null).OrderBy(i => i.SideIndex).ThenBy(i => i.Key, StringComparer.Ordinal))
            {
                WeV3 look = i.Frame.Look.Flat().Normalized();
                if (look.IsZero) continue;
                WeV3 interior = -look;
                WeV3 target = new WeV3(i.Frame.Origin.X, i.Frame.Origin.Y, 0);
                string label = string.IsNullOrEmpty(i.Label) ? i.SideLetter : i.Label;
                // W07: бичвэр тэмдэг хуудасны горимд «205A / A-301» хоёр мөр (Revit-ийн маркертай дэлгээс — нэг мөр, өмнөх шигээ).
                int lines = sheetRefs && (s.ViewKind == WeViewKind.Section || i.ExistingIsSection) ? 2 : 1;
                double depth = RoomBoundaryAnalyzer.DepthInFront(room, target, target, interior);
                double off = paper(LabelOffsetPaperMm);
                // Нарийн өрөөнд (коридор): гүний 35 %, гэхдээ хайрцаг хананд наалдахгүй (хагас өндөр + 1 мм), хамгийн ихдээ дунд хүртэл.
                if (!double.IsNaN(depth))
                    off = Math.Min(off, Math.Max(depth * 0.35, Math.Min(depth / 2, HalfSize(label, paper, lines).Y + paper(1))));
                kp.Markers.Add(new WeKeyMarker
                {
                    ElevationKey = i.Key,
                    Label = label,
                    Target = target,
                    LabelAt = target + interior * off,
                    Look = look,
                    Lines = lines,
                });
            }
            Separate(kp.Markers, paper, room);

            foreach (WeKeyMarker m in kp.Markers)
            {
                WeV3 half = HalfSize(m.Label, paper, m.Lines);
                pts.Add(m.LabelAt - half);
                pts.Add(m.LabelAt + half);
            }
            if (pts.Count == 0) return kp;
            double margin = u.MmToInternal(Math.Max(0, s.KeyPlanMarginMm));
            kp.MinX = pts.Min(p => p.X) - margin;
            kp.MaxX = pts.Max(p => p.X) + margin;
            kp.MinY = pts.Min(p => p.Y) - margin;
            kp.MaxY = pts.Max(p => p.Y) + margin;
            return kp;
        }

        /// <summary>Стандарт масштабууд (жижгээс том руу).</summary>
        public static readonly int[] Scales = { 20, 25, 30, 40, 50, 75, 100, 125, 150, 200, 250, 500 };
        /// <summary>
        /// Түлхүүр планы crop цаасан дээр хамгийн ихдээ (мм).  Хуудасны зүүн баганын ≈ 30 % өргөн, ≈ 50 % өндөр (A2-ийн зурах талбай
        /// 563 × 360 мм — GATEWAY) — тэнхлэгийн толгой, гарчгийн зай үлдэнэ.
        /// </summary>
        public const double MaxPaperWidthMm = 150, MaxPaperHeightMm = 180;
        /// <summary>Elevation маркерын тэмдгийн хэмжээ цаасан дээр (мм, сумтай) — хоёр маркерын төв хоорондын хамгийн бага зай.</summary>
        public const double MarkerPaperMm = 16;

        /// <summary>
        /// Түлхүүр планы масштаб — тохиргооны «Түлхүүр планы масштаб» ЯГ (W03, 2026-10-16, архитекторуудын хүсэлт: сонгосон масштаб үүсгэх,
        /// дахин ажиллуулахад хэвээр).  Өмнө нь өрөө + захын зай цаасанд (<see cref="MaxPaperWidthMm"/> × <see cref="MaxPaperHeightMm"/>) багтах
        /// анхны стандарт масштаб руу ТОМРУУЛДАГ байв (GATEWAY 310: 1:50 → 1:125) — нэг хуудасны горимд том план хуудаснаас хальж болно, хэрэглэгч
        /// цэгцэлнэ (тайланд «байрлуулж цэгцлэх»).  Маркерын зай, бичвэрийн байрлал ЭНЭ масштабаар.
        /// </summary>
        public static int ExpectedScale(WeRoomInfo room, WeSettings s, IWeUnits u)
        {
            return Math.Max(1, s != null ? s.KeyPlanScale : 50);
        }

        /// <summary>
        /// Өмнөх хувилбарын «цаасанд багтах» масштаб (хуучин <see cref="ExpectedScale"/>) — ЗӨВХӨН зөвлөмж (цонхонд «1:50-д түлхүүр план ≈ 182 мм
        /// өндөр» гэж сануулахад); үүсгэхэд ХЭРЭГЛЭХГҮЙ.
        /// </summary>
        public static int FittingScale(WeRoomInfo room, WeSettings s, IWeUnits u)
        {
            int min = Math.Max(1, s != null ? s.KeyPlanScale : 50);
            if (room == null || room.Loops.Count == 0 || u == null) return min;
            var pts = room.Loops.SelectMany(l => l.Segments).SelectMany(g => new[] { g.A, g.B }).ToList();
            if (pts.Count == 0) return min;
            double margin = u.MmToInternal(Math.Max(0, s.KeyPlanMarginMm)) * 2;
            double mm = u.MmToInternal(1);
            double w = (pts.Max(p => p.X) - pts.Min(p => p.X) + margin) / mm, h = (pts.Max(p => p.Y) - pts.Min(p => p.Y) + margin) / mm;
            foreach (int sc in Scales)
                if (sc >= min && w / sc <= MaxPaperWidthMm + 1e-9 && h / sc <= MaxPaperHeightMm + 1e-9) return sc;
            return Math.Max(min, Scales[Scales.Length - 1]);
        }

        /// <summary>
        /// Маркеруудын хоорондын зайг тооцох масштаб — <see cref="ExpectedScale"/>-аас НЭГ алхам том.  ХЭМЖСЭН (GATEWAY 508, 2026-10-07):
        /// viewport-ийн бодит хэмжээ crop + annotation crop-оос 30–50 мм илүү гардаг (тэнхлэгийн толгой, Revit-ийн өөрийн зай) тул 1:50 гэж
        /// төлөвлөсөн план хуудсанд 1:75 болж, 1:50-аар тооцсон маркерууд давхарласан.  Нөөцтэй зай — хуудсанд аль ч масштаб гарсан давхцахгүй.
        /// </summary>
        public static int SeparationScale(WeRoomInfo room, WeSettings s, IWeUnits u)
        {
            int e = ExpectedScale(room, s, u);
            int i = Array.IndexOf(Scales, e);
            return i >= 0 && i + 1 < Scales.Length ? Scales[i + 1] : e;
        }

        /// <summary>Хоёр дахь мөрийн (хуудасны дугаар) нэмэлт өндөр (цаас, мм).</summary>
        public const double LabelLinePaperMm = 4.5;
        /// <summary>Хуудасны дугаарын мөрийн хамгийн бага тэмдэгт («A-301»).</summary>
        public const int SheetRefChars = 6;

        /// <summary>Бичвэрийн хайрцгийн хагас хэмжээ (дэлхийн, план).  <paramref name="lines"/> = 2 бол доор хуудасны дугаарын мөр (W07).</summary>
        public static WeV3 HalfSize(string label, Func<double, double> paper, int lines = 1)
        {
            int n = string.IsNullOrEmpty(label) ? 1 : label.Length;
            if (lines > 1) n = Math.Max(n, SheetRefChars);
            double h = LabelHeightPaperMm + Math.Max(0, lines - 1) * LabelLinePaperMm;
            return new WeV3(paper(n * LabelCharPaperMm + LabelPadPaperMm) / 2, paper(h) / 2, 0);
        }

        public static bool Overlap(WeKeyMarker a, WeKeyMarker b, Func<double, double> paper)
        {
            WeV3 ha = HalfSize(a.Label, paper, a.Lines), hb = HalfSize(b.Label, paper, b.Lines);
            return Math.Abs(a.LabelAt.X - b.LabelAt.X) < ha.X + hb.X && Math.Abs(a.LabelAt.Y - b.LabelAt.Y) < ha.Y + hb.Y;
        }

        /// <summary>
        /// Давхцсан эсвэл өрөөнөөс гарсан тэмдгийг (хожмынхыг) шилжүүлнэ: эхлээд гадаргуугийн дагуу (+, −, 2+, 2− …), дараа нь
        /// өрөөний гүн рүү нэг, хоёр алхам — шинэ байр нь өрөөний ДОТОР (хайрцгийн 4 орой), бусадтай давхцахгүй байх ёстой.
        /// Олдохгүй бол анхны байранд (бичвэр уншигдана, давхцал хэвээр).
        /// </summary>
        private static void Separate(List<WeKeyMarker> markers, Func<double, double> paper, WeRoomInfo room)
        {
            for (int i = 0; i < markers.Count; i++)
            {
                WeKeyMarker m = markers[i];
                Func<bool> ok = () => Fits(m, paper, room) && !markers.Take(i).Any(o => Overlap(o, m, paper));
                if (ok()) continue;
                WeV3 baseAt = m.LabelAt;
                var t = new WeV3(-m.Look.Y, m.Look.X, 0);
                WeV3 half = HalfSize(m.Label, paper, m.Lines);
                double stepT = half.X * 2 + paper(1), stepD = half.Y * 2 + paper(1);
                bool found = false;
                // Хагас алхамтай — нарийн далавчинд (L өрөө) бүтэн алхам хананы гадна гарч, хагас нь багтдаг.
                foreach (double d in new[] { 0, 0.5, 1, 1.5, 2 })
                {
                    foreach (double k in new[] { 0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2, 3, -3 })
                    {
                        if (d == 0 && k == 0) continue;
                        m.LabelAt = baseAt - m.Look * (d * stepD) + t * (k * stepT);
                        if (ok()) { found = true; break; }
                    }
                    if (found) break;
                }
                if (!found) m.LabelAt = baseAt;
            }
        }

        /// <summary>Тэмдгийн хайрцаг (4 орой) өрөөний дотор (гадна контурын дотор, аралын гадна) уу.</summary>
        private static bool Fits(WeKeyMarker m, Func<double, double> paper, WeRoomInfo room)
        {
            if (room == null || room.Loops.Count == 0) return true;
            WeV3 h = HalfSize(m.Label, paper, m.Lines) * 0.9;   // бичвэрийн хүрээ нь хайрцгаасаа бага
            foreach (WeV3 c in new[] { new WeV3(-h.X, -h.Y, 0), new WeV3(h.X, -h.Y, 0), new WeV3(h.X, h.Y, 0), new WeV3(-h.X, h.Y, 0) })
                if (!InsideRoom(room, m.LabelAt + c)) return false;
            return true;
        }

        /// <summary>Цэг өрөөнд (план): хамгийн том контурын дотор, бусад (арал) контурын гадна — ray casting.</summary>
        public static bool InsideRoom(WeRoomInfo room, WeV3 p)
        {
            if (room == null || room.Loops.Count == 0) return false;
            WeRoomLoop outer = room.Loops.OrderByDescending(l => Math.Abs(RoomBoundaryAnalyzer.SignedArea(l.Segments))).First();
            if (!Inside(outer, p)) return false;
            foreach (WeRoomLoop l in room.Loops)
                if (l != outer && Inside(l, p)) return false;
            return true;
        }

        private static bool Inside(WeRoomLoop loop, WeV3 p)
        {
            bool inside = false;
            foreach (WeBoundarySegment s in loop.Segments)
            {
                WeV3 a = s.A, b = s.B;
                if ((a.Y > p.Y) != (b.Y > p.Y) && p.X < (b.X - a.X) * (p.Y - a.Y) / (b.Y - a.Y) + a.X) inside = !inside;
            }
            return inside;
        }
    }
}
