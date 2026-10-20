using System;
using System.Collections.Generic;
using System.Globalization;
using Autodesk.Revit.DB;

namespace RevitMcpAddin.WallElevation.Revit
{
    /// <summary>
    /// TextNote-ийн бичвэрийн өргөнийг Revit-ийн regenerate-гүйгээр хэмжинэ (байрлал төлөвлөхөд).  ХЭМЖСЭН (Revit 2027, ISOCPEUR MON 2.5 мм,
    /// 2026-10-07): Revit-ийн «Text Size» = ТОМ ҮСГИЙН өндөр, тиймээс шрифтийн em = size / CapsHeight; WPF FormattedText-ийн өргөн ×
    /// «Width Factor» нь regenerate-ийн дараах <c>TextNote.Width</c>-тэй 0.05 мм-ийн дотор таарсан (6 бичвэр, 3–75 мм).  Шрифт олдохгүй бол
    /// тэмдэгтийн тоогоор ойролцоолно.  Үр дүн ЦААСНЫ футаар (харагдацын масштабаар үржүүлж загварт шилжүүлнэ).
    /// </summary>
    internal static class WeTextMeasure
    {
        private static readonly Dictionary<string, System.Windows.Media.Typeface> Faces = new Dictionary<string, System.Windows.Media.Typeface>(StringComparer.OrdinalIgnoreCase);
        private static readonly Dictionary<string, double> Caps = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);

        /// <summary>Нэг мөр бичвэрийн өргөн ба мөрийн өндөр (цаасны фут).</summary>
        public static void Measure(TextNoteType t, string text, out double width, out double height)
        {
            double size = 2.5 / 304.8, factor = 1;
            string font = null;
            try
            {
                Parameter p = t.get_Parameter(BuiltInParameter.TEXT_SIZE);
                if (p != null && p.AsDouble() > 0) size = p.AsDouble();
                p = t.get_Parameter(BuiltInParameter.TEXT_WIDTH_SCALE);
                if (p != null && p.AsDouble() > 0) factor = p.AsDouble();
                p = t.get_Parameter(BuiltInParameter.TEXT_FONT);
                if (p != null) font = p.AsString();
            }
            catch { }
            double sizeMm = size * 304.8;
            try
            {
                System.Windows.Media.Typeface face;
                double caps;
                if (!string.IsNullOrEmpty(font) && Face(font, out face, out caps))
                {
                    var ft = new System.Windows.Media.FormattedText(text ?? "", CultureInfo.InvariantCulture, System.Windows.FlowDirection.LeftToRight,
                                                                     face, sizeMm / caps, System.Windows.Media.Brushes.Black, 1.0);
                    width = ft.WidthIncludingTrailingWhitespace * factor / 304.8;
                    height = Math.Max(ft.Height, sizeMm * 1.6) / 304.8;
                    return;
                }
            }
            catch { }
            width = (text ?? "").Length * sizeMm * 0.85 * factor / 304.8;
            height = sizeMm * 1.96 / 304.8;
        }

        private static bool Face(string font, out System.Windows.Media.Typeface face, out double caps)
        {
            if (!Faces.TryGetValue(font, out face))
            {
                face = new System.Windows.Media.Typeface(font);
                System.Windows.Media.GlyphTypeface g;
                double c = 0;
                if (face.TryGetGlyphTypeface(out g) && g.CapsHeight > 0.2) c = g.CapsHeight;
                Faces[font] = c > 0 ? face : null;
                Caps[font] = c;
                face = Faces[font];
            }
            caps = Caps.ContainsKey(font) ? Caps[font] : 0;
            return face != null && caps > 0;
        }
    }
}
