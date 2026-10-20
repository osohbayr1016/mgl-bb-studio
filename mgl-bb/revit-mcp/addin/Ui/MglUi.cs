using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace RevitMcpAddin.Ui
{
    public enum MglSeverity
    {
        Info = 0,
        Ok = 1,
        Warn = 2,
        Danger = 3,
    }

    /// <summary>
    /// Кодоор бүтээсэн цонхонд (Reinforcement, AutoAnnotate, CloneDrawings…) ДУНДЫН загварыг ашиглах туслахууд.
    /// 5 гараар хуулсан `#4A7FA5` «санамж» хайрцгийг орлоно.  Загвар/токен нь цонхонд `MglTheme.Apply` хийгдсэн
    /// байх ёстой (түлхүүрийг цонхны Resources-оос олно); үгүй бол анхдагч харагдалт — унахгүй.
    /// ⚠️ Утга зөвхөн өнгөөр биш: `prefix` (ⓘ ✓ ⚠ ✖) дүрс + бичвэр хамт.
    /// </summary>
    internal static class MglUi
    {
        internal static Border Note(string text, MglSeverity severity = MglSeverity.Info)
        {
            string styleKey; string prefix; string fgKey;
            switch (severity)
            {
                case MglSeverity.Ok: styleKey = "MglNoteOk"; prefix = "✓ "; fgKey = "Fg"; break;
                case MglSeverity.Warn: styleKey = "MglNoteWarn"; prefix = "⚠ "; fgKey = "Fg"; break;
                case MglSeverity.Danger: styleKey = "MglNoteDanger"; prefix = "✖ "; fgKey = "Fg"; break;
                default: styleKey = "MglNote"; prefix = "ⓘ "; fgKey = "Fg"; break;
            }
            var tb = new TextBlock { Text = prefix + (text ?? string.Empty), TextWrapping = TextWrapping.Wrap };
            tb.SetResourceReference(TextBlock.ForegroundProperty, fgKey);
            var border = new Border { Child = tb };
            border.SetResourceReference(FrameworkElement.StyleProperty, styleKey);
            return border;
        }

        /// <summary>Нэг цонхны ҮНДСЭН үйлдэл (Accent дэвсгэр).</summary>
        internal static Button Primary(Button button)
        {
            if (button != null) button.SetResourceReference(FrameworkElement.StyleProperty, "MglPrimaryButton");
            return button;
        }

        internal static TextBlock Heading(string text)
        {
            var tb = new TextBlock { Text = text };
            tb.SetResourceReference(FrameworkElement.StyleProperty, "MglHeading");
            return tb;
        }

        internal static TextBlock Muted(string text)
        {
            var tb = new TextBlock { Text = text };
            tb.SetResourceReference(FrameworkElement.StyleProperty, "MglMuted");
            return tb;
        }
    }
}
