using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace RevitMcpAddin.Reinforcement.Ui
{
    /// <summary>
    /// «Арматур» цонхнуудын нийтлэг WPF туслахууд (кодоор угсарсан, XAML-гүй — `AutoAnnotateDialog`-ийн хэв маяг).
    /// ⚠️ Энд БИЗНЕС ЛОГИК БАЙХГҮЙ: товчны handler зөвхөн Core/үйлчилгээг дуудаж үр дүнг харуулна.
    /// </summary>
    internal static class RfUi
    {
        // ⚠️ Өнгө нь `Ui/MglBrushes` (сэдэв солигдоход шинэчлэгддэг live brush) — тогтмол #6B7280/#B45F06/#B91C1C харанхуй сэдэвт
        // уншигдахгүй байв.  Утга нь өнгөөр ГАНЦААРАА биш: дуудагч бичвэрт «⚠», «✖» тэмдэг, үг хамт бичнэ.
        public static Brush Muted { get { return global::RevitMcpAddin.Ui.MglBrushes.FgMuted; } }
        public static Brush Warn { get { return global::RevitMcpAddin.Ui.MglBrushes.Warn; } }
        public static Brush Bad { get { return global::RevitMcpAddin.Ui.MglBrushes.Danger; } }

        public static TextBlock Section(string text)
        {
            return new TextBlock
            {
                Text = text,
                FontWeight = FontWeights.SemiBold,
                Margin = new Thickness(0, 10, 0, 4),
            };
        }

        public static TextBlock Hint(string text)
        {
            return new TextBlock
            {
                Text = text,
                Foreground = Muted,
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 2, 0, 0),
            };
        }

        /// <summary>Мэдээллийн хайрцаг — дундын `MglUi.Note` (токен, «ⓘ» тэмдэгтэй); цонхонд `MglTheme.Apply` хийгдсэн байх ёстой.</summary>
        public static Border Note(string text)
        {
            return global::RevitMcpAddin.Ui.MglUi.Note(text);
        }

        public static Button MakeButton(string text, bool isDefault, bool isCancel, int minWidth = 110)
        {
            return new Button
            {
                Content = text,
                IsDefault = isDefault,
                IsCancel = isCancel,
                MinWidth = minWidth,
                Padding = new Thickness(12, 5, 12, 5),
                Margin = new Thickness(8, 0, 0, 0),
            };
        }

        /// <summary>
        /// Цонхны ерөнхий тохиргоо: хэмжээ/байрлал (Revit-ийн дэлгэцийн ажлын талбарт багтана, хил хадгалагдана — түлхүүр = цонхны
        /// класс) + дундын сэдэв (Light/Dark/өндөр контраст).  Эзнийг `App.ShowOwned` тавина.
        /// </summary>
        public static void Setup(Window w, string title, double width, double height, double minWidth, double minHeight)
        {
            global::RevitMcpAddin.Ui.MglWindow.Setup(w, title, width, height, minWidth, minHeight, prefsKey: w.GetType().Name);
            global::RevitMcpAddin.Ui.MglTheme.Apply(w);
        }

        /// <summary>Эерэг тоо уншина (таслал/цэг хоёуланг нь); буруу бол false.</summary>
        public static bool TryParse(string text, out double value)
        {
            // NaN/Infinity-г зөвшөөрөхгүй, Unicode хасах тэмдгийг («−45») хүлээн авна — Core/RfNumber (тестлэгдсэн).
            return Core.RfNumber.TryParse(text, out value);
        }
    }
}
