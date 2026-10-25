using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace MglBb
{
    /// <summary>
    /// Арматурын цонхнуудын нийтлэг өнгө / хэлбэр (хэрэглэгчийн хүсэлт: «цэвэрхэн, ойлгомжтой, өнгөлөг», бусад нэмэлтийн цэнхэр толгой / карт /
    /// товчны хэв маягаар, ББ Студийн бүтцийг өөрчлөхгүй): цэнхэр толгой мөр, цайвар дэвсгэр, цагаан карт хэсэг, үндсэн / туслах товч, хүснэгт.
    /// </summary>
    internal static class BbTheme
    {
        public static readonly SolidColorBrush Accent = Brush(0x1E, 0x6F, 0xD9), AccentDark = Brush(0x15, 0x55, 0xAD), AccentSoft = Brush(0xE8, 0xF1, 0xFC),
            Back = Brush(0xF3, 0xF6, 0xFA), CardBack = Brushes.White, Line = Brush(0xD6, 0xDE, 0xE8), Text = Brush(0x22, 0x2B, 0x36), Muted = Brush(0x5F, 0x6B, 0x7A);

        static SolidColorBrush Brush(byte r, byte g, byte b)
        {
            var s = new SolidColorBrush(Color.FromRgb(r, g, b));
            s.Freeze();
            return s;
        }

        /// <summary>Цонхны агуулгыг цэнхэр толгой мөр + цайвар дэвсгэрт ороож буцаана (<paramref name="body"/> = хуучин root).</summary>
        public static UIElement Frame(Window w, string title, string subtitle, UIElement body)
        {
            w.Background = Back;
            w.Foreground = Text;
            var dock = new DockPanel();
            var head = new Border { Background = Accent, Padding = new Thickness(18, 10, 18, 10) };
            var hs = new StackPanel();
            hs.Children.Add(new TextBlock { Text = title, Foreground = Brushes.White, FontSize = 17, FontWeight = FontWeights.SemiBold });
            if (!string.IsNullOrEmpty(subtitle))
                hs.Children.Add(new TextBlock { Text = subtitle, Foreground = new SolidColorBrush(Color.FromRgb(0xD7, 0xE7, 0xFB)), FontSize = 12, Margin = new Thickness(0, 2, 0, 0) });
            head.Child = hs;
            DockPanel.SetDock(head, Dock.Top);
            dock.Children.Add(head);
            dock.Children.Add(body);
            return dock;
        }

        /// <summary>Цагаан карт (гарчигтай): <paramref name="dock"/> = DockPanel-д байрлах тал (null = үлдсэн хэсэг).</summary>
        public static Border Card(string header, UIElement content, Dock? dock = null, double bottom = 8)
        {
            var sp = new DockPanel();
            if (!string.IsNullOrEmpty(header))
            {
                var h = new TextBlock { Text = header, FontWeight = FontWeights.SemiBold, Foreground = AccentDark, Margin = new Thickness(0, 0, 0, 6) };
                DockPanel.SetDock(h, Dock.Top);
                sp.Children.Add(h);
            }
            sp.Children.Add(content);
            var b = new Border
            {
                Background = CardBack, BorderBrush = Line, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(6),
                Padding = new Thickness(12, 10, 12, 10), Margin = new Thickness(0, 0, 0, bottom), Child = sp,
            };
            if (dock.HasValue) DockPanel.SetDock(b, dock.Value);
            return b;
        }

        /// <summary>Үндсэн товч (цэнхэр) эсвэл туслах (цагаан, цэнхэр хүрээ).</summary>
        public static void Button(Button b, bool primary)
        {
            b.Background = primary ? Accent : Brushes.White;
            b.Foreground = primary ? Brushes.White : AccentDark;
            b.BorderBrush = primary ? AccentDark : Accent;
            b.BorderThickness = new Thickness(1);
            b.FontWeight = primary ? FontWeights.SemiBold : FontWeights.Normal;
            if (b.Padding.Left < 12) b.Padding = new Thickness(14, 5, 14, 5);
            b.Cursor = System.Windows.Input.Cursors.Hand;
        }

        /// <summary>Самбар доторх бүх товчийг: <paramref name="primaryText"/> агуулгатай нь үндсэн, бусад нь туслах.</summary>
        public static void Buttons(Panel p, string primaryText)
        {
            foreach (Button b in p.Children.OfType<Button>()) Button(b, (b.Content as string) == primaryText);
            foreach (Panel inner in p.Children.OfType<Panel>()) Buttons(inner, primaryText);
        }

        /// <summary>Хүснэгт: цайвар цэнхэр толгой, ээлжлэх мөр, нимгэн шугам.</summary>
        public static void Grid(DataGrid g)
        {
            g.Background = Brushes.White;
            g.BorderBrush = Line;
            g.RowBackground = Brushes.White;
            g.AlternatingRowBackground = Brush(0xF7, 0xFA, 0xFE);
            g.HorizontalGridLinesBrush = Brush(0xE6, 0xEB, 0xF2);
            g.VerticalGridLinesBrush = Brush(0xE6, 0xEB, 0xF2);
            var hs = new Style(typeof(System.Windows.Controls.Primitives.DataGridColumnHeader));
            hs.Setters.Add(new Setter(Control.BackgroundProperty, AccentSoft));
            hs.Setters.Add(new Setter(Control.ForegroundProperty, AccentDark));
            hs.Setters.Add(new Setter(Control.FontWeightProperty, FontWeights.SemiBold));
            hs.Setters.Add(new Setter(Control.PaddingProperty, new Thickness(6, 4, 6, 4)));
            hs.Setters.Add(new Setter(Control.BorderBrushProperty, Line));
            hs.Setters.Add(new Setter(Control.BorderThicknessProperty, new Thickness(0, 0, 1, 1)));
            g.ColumnHeaderStyle = hs;
        }
    }
}
