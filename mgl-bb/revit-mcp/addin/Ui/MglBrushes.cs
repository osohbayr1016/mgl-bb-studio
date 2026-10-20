using System.Collections.Generic;
using System.Windows;
using System.Windows.Media;
using RevitMcpAddin.Ui.Core;

namespace RevitMcpAddin.Ui
{
    /// <summary>
    /// Кодоор угсарсан цонхуудын (Reinforcement `RfUi`, Smart `UiKit`, …) ХУВААЛЦСАН «утга бүхий» brush-ууд.
    ///
    /// Яагаад: тэдгээр цонх `Foreground = RfUi.Warn` гэж Brush ОБЪЕКТ шууд онооно — XAML-ийн `DynamicResource` шиг
    /// сэдэв солигдоход дагахгүй, хэт тод/бараан тогтмол өнгө (#6B7280, #B91C1C…) харанхуй сэдэвт уншигдахгүй байв.
    /// Шийдэл: brush ХЭВЭЭР нэг объект (дуудагч код өөрчлөгдөхгүй), харин ӨНГӨ нь `MglTheme` сэдэв солигдох бүрд
    /// шинэчлэгддэг ЗАДЛАГДАЖ БУЙ (frozen БИШ) `SolidColorBrush`.  WPF нь Brush.Color-ын өөрчлөлтийг бүх хэрэглэгч рүү түгээнэ.
    ///
    /// ⚠️ UI thread-ээс л хүрнэ (Revit-ийн нэг Dispatcher).  Frozen brush ЭНД ХЭЗЭЭ Ч ашиглахгүй — өнгө нь шинэчлэгдэх ёстой.
    /// </summary>
    internal static class MglBrushes
    {
        private static readonly object Gate = new object();
        private static readonly Dictionary<string, SolidColorBrush> Live = new Dictionary<string, SolidColorBrush>();

        internal static SolidColorBrush Bg { get { return Get("Bg"); } }
        internal static SolidColorBrush Line { get { return Get("Line"); } }
        internal static SolidColorBrush LineStrong { get { return Get("LineStrong"); } }
        internal static SolidColorBrush Fg { get { return Get("Fg"); } }
        internal static SolidColorBrush FgMuted { get { return Get("FgMuted"); } }
        internal static SolidColorBrush Ok { get { return Get("Ok"); } }
        internal static SolidColorBrush Warn { get { return Get("Warn"); } }
        internal static SolidColorBrush Danger { get { return Get("Danger"); } }
        internal static SolidColorBrush Info { get { return Get("Info"); } }

        private static SolidColorBrush Get(string key)
        {
            lock (Gate)
            {
                SolidColorBrush b;
                if (!Live.TryGetValue(key, out b))
                {
                    b = new SolidColorBrush(ColorFor(key, MglTheme.Resolve()));
                    Live[key] = b;
                }
                return b;
            }
        }

        /// <summary>`MglTheme` сэдэв тавих/солих бүрд дуудна — үүссэн бүх live brush-ийн өнгийг шинэчилнэ.</summary>
        internal static void Update(MglThemeMode mode)
        {
            lock (Gate)
            {
                foreach (KeyValuePair<string, SolidColorBrush> kv in Live)
                {
                    Color c = ColorFor(kv.Key, mode);
                    if (kv.Value.Color != c) kv.Value.Color = c;
                }
            }
        }

        private static Color ColorFor(string key, MglThemeMode mode)
        {
            IReadOnlyDictionary<string, string> map = MglPalette.For(mode);
            // Өндөр контраст: системийн бичвэрийн өнгө (утга нь тэмдэг, үгээр илэрнэ — өнгөөр ганцаараа биш).
            if (map == null) return SystemColors.WindowTextColor;
            int r, g, b;
            if (!MglContrast.TryParseHex(map[key], out r, out g, out b)) return Colors.Magenta;
            return Color.FromRgb((byte)r, (byte)g, (byte)b);
        }
    }
}
