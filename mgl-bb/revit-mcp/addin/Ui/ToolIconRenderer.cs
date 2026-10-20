using System;
using System.Collections.Generic;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using RevitMcpAddin.Ui.Core;

namespace RevitMcpAddin.Ui
{
    /// <summary>
    /// `ToolIcons` (Core, ЦЭВЭР тайлбар) → зураг.  Зурах геометр (DIP/192-DPI төвлөрүүлэлт, фонтын fallback)
    /// нь ӨӨРЧЛӨГДӨӨГҮЙ `GlyphIcons.TryRender`-д — энд зөвхөн түлхүүр → glyph/өнгө + кэш.
    /// Зураг зурагдахгүй бол (фонт байхгүй) null — дуудагч товчийг дүрсгүй үлдээнэ, startup ХЭЗЭЭ Ч унахгүй.
    /// </summary>
    internal static class ToolIconRenderer
    {
        private static readonly object Gate = new object();
        private static readonly Dictionary<string, BitmapSource> Cache = new Dictionary<string, BitmapSource>(StringComparer.Ordinal);

        internal static BitmapSource Render(string key, int size)
        {
            string cacheKey = key + "@" + size;
            lock (Gate)
            {
                BitmapSource cached;
                if (Cache.TryGetValue(cacheKey, out cached)) return cached;
            }

            BitmapSource image = null;
            try
            {
                ToolIconSpec spec = ToolIcons.Find(key);
                if (spec != null)
                {
                    int r, g, b;
                    if (MglContrast.TryParseHex(spec.Hex, out r, out g, out b))
                    {
                        var brush = new SolidColorBrush(Color.FromRgb((byte)r, (byte)g, (byte)b));
                        brush.Freeze();   // ribbon өөр dispatcher context-оос уншиж болно
                        image = GlyphIcons.TryRender(new GlyphIcons.Glyph(spec.CodePoints), size, brush);
                    }
                }
            }
            catch
            {
                image = null;
            }

            // null-ийг ч кэшлэнэ — ижил бүтэлгүй зурахыг давтахгүй.
            lock (Gate) Cache[cacheKey] = image;
            return image;
        }
    }
}
