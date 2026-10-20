using System;
using System.Collections.Generic;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>Хоёр хэмжээст нум: төв, радиус, эхлэх/дуусах өнцөг (радиан, цагийн зүүний эсрэг).</summary>
    public struct WeArc2
    {
        public double Cx, Cy, R, A0, A1;
        public WeArc2(double cx, double cy, double r, double a0, double a1) { Cx = cx; Cy = cy; R = r; A0 = a0; A1 = a1; }
        public double X0 { get { return Cx + R * Math.Cos(A0); } }
        public double Y0 { get { return Cy + R * Math.Sin(A0); } }
        public double X1 { get { return Cx + R * Math.Cos(A1); } }
        public double Y1 { get { return Cy + R * Math.Sin(A1); } }
    }

    /// <summary>
    /// Бөөрөнхий өнцөгтэй тэгш өнцөгт (2026-10-14, интерьерийн баг 3-р тойрог: «бүгдийн гадуур улаан тасархай зураас», жишээ хуудас 232/236/238).
    /// ЦЭВЭР тооцоо — Revit давхарга (дэлгээсийн хүрээ, түлхүүр планы хүрээ) тэнхлэгээ өгч муруй болгоно.  Дараалал: доод → баруун → дээд → зүүн
    /// шулуун, нум бүр хоёр шулууны хооронд (битүү гинж).  Радиус нь богино талын хагасаас бага болтол багасна; маш жижиг тэгш өнцөгтөд нумгүй.
    /// </summary>
    public static class WeRoundedRect
    {
        public sealed class Outline
        {
            public readonly List<WeSegment2> Lines = new List<WeSegment2>();
            public readonly List<WeArc2> Arcs = new List<WeArc2>();
            public double Radius;
        }

        /// <returns>null — тэгш өнцөгт хоосон (өргөн/өндөр ≤ <paramref name="minSide"/>).</returns>
        public static Outline Of(double minX, double minY, double maxX, double maxY, double radius, double minSide)
        {
            double w = maxX - minX, h = maxY - minY;
            if (double.IsNaN(w) || double.IsNaN(h) || w <= minSide || h <= minSide) return null;
            double r = Math.Max(0, Math.Min(radius, Math.Min(w, h) / 2 * 0.9));
            // Шулуун бүр Revit-ийн хамгийн богино муруйгаас урт байх ёстой — эс бөгөөс нумгүй тэгш өнцөгт.
            if (r > 0 && (w - 2 * r <= minSide || h - 2 * r <= minSide)) r = 0;
            var o = new Outline { Radius = r };
            o.Lines.Add(new WeSegment2(minX + r, minY, maxX - r, minY));
            o.Lines.Add(new WeSegment2(maxX, minY + r, maxX, maxY - r));
            o.Lines.Add(new WeSegment2(maxX - r, maxY, minX + r, maxY));
            o.Lines.Add(new WeSegment2(minX, maxY - r, minX, minY + r));
            if (r > 0)
            {
                o.Arcs.Add(new WeArc2(maxX - r, minY + r, r, -Math.PI / 2, 0));
                o.Arcs.Add(new WeArc2(maxX - r, maxY - r, r, 0, Math.PI / 2));
                o.Arcs.Add(new WeArc2(minX + r, maxY - r, r, Math.PI / 2, Math.PI));
                o.Arcs.Add(new WeArc2(minX + r, minY + r, r, Math.PI, 1.5 * Math.PI));
            }
            return o;
        }
    }
}
