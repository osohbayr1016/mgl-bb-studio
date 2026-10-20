using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Shapes;
using RevitMcpAddin.AutoAnnotate.Core;

namespace RevitMcpAddin.AutoAnnotate
{
    /// <summary>
    /// «Тэнхлэг, түвшин — crop-оос» цонх (кодоор угсарсан WPF).  Тэнхлэгийн доод (1) / дээд (2), түвшний зүүн / баруун үзүүрийн crop-ийн хилээс зай
    /// (цаасан мм; эерэг = гадагш, сөрөг = дотогш).  Зүүн талд жижиг схем — ямар үзүүр аль утгыг авахыг харуулна.
    /// </summary>
    internal sealed class AaDatumCropDialog : Window
    {
        private readonly AaDatumCropOptions _o;
        private readonly CheckBox _grids, _levels;
        private readonly TextBox _gBottom = Num(), _gTop = Num(), _lLeft = Num(), _lRight = Num();
        private readonly TextBlock _msg = new TextBlock { TextWrapping = TextWrapping.Wrap, Visibility = Visibility.Collapsed, Margin = new Thickness(0, 6, 0, 0) };
        private readonly Button _ok;

        public AaDatumCropOptions Result { get; private set; }

        public AaDatumCropDialog(AaDatumCropInfo info, AaDatumCropOptions saved)
        {
            _o = (saved ?? new AaDatumCropOptions()).Clone();
            Ui.MglWindow.Setup(this, DatumCropCommand.Title, 760, 520, 640, 440, prefsKey: "datum-crop");
            Ui.MglTheme.Apply(this);
            _msg.SetResourceReference(TextBlock.ForegroundProperty, "Danger");

            var root = new DockPanel { Margin = new Thickness(14) };

            var head = new StackPanel { Margin = new Thickness(0, 0, 0, 10) };
            head.Children.Add(new TextBlock { Text = "Тэнхлэг, түвшний үзүүрийг crop region-оос заасан зайд тавих", FontSize = 16, FontWeight = FontWeights.SemiBold });
            head.Children.Add(Mute(new TextBlock
            {
                Text = info.ViewName + " · 1:" + info.Scale + " · " + info.Grids + " тэнхлэг, " + info.Levels + " түвшин"
                    + (info.SelectedDatums > 0 ? " (сонгосон " + info.SelectedDatums + ")" : " (харагдацын бүгд)"),
                Margin = new Thickness(0, 2, 0, 0),
            }));
            DockPanel.SetDock(head, Dock.Top);
            root.Children.Add(head);

            var bottom = new DockPanel { Margin = new Thickness(0, 10, 0, 0) };
            var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
            _ok = new Button { Content = "Тавих", IsDefault = true, MinWidth = 120, Padding = new Thickness(12, 5, 12, 5) };
            Ui.MglUi.Primary(_ok);
            _ok.Click += OnOk;
            var cancel = new Button { Content = "Болих", IsCancel = true, MinWidth = 80, Margin = new Thickness(8, 0, 0, 0), Padding = new Thickness(12, 5, 12, 5) };
            buttons.Children.Add(_ok);
            buttons.Children.Add(cancel);
            DockPanel.SetDock(buttons, Dock.Right);
            bottom.Children.Add(buttons);
            Border note = Ui.MglUi.Note("Зөвхөн ЭНЭ харагдацын шугамын 2D үзүүр өөрчлөгдөнө — бусад харагдац, 3D үзүүр хөндөгдөхгүй.  Нэг Ctrl+Z-ээр буцна.  "
                + "Зай нь цаасан дээрх мм (1:" + info.Scale + " масштабт 10 мм = " + (info.Scale / 100.0).ToString("0.##", CultureInfo.InvariantCulture) + " м).");
            note.Margin = new Thickness(0, 0, 12, 0);
            bottom.Children.Add(note);
            DockPanel.SetDock(bottom, Dock.Bottom);
            root.Children.Add(bottom);

            var body = new Grid();
            body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(230) });
            body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(18) });
            body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            FrameworkElement sketch = Sketch();
            Grid.SetColumn(sketch, 0);
            body.Children.Add(sketch);

            var form = new StackPanel();
            _grids = new CheckBox { Content = "Тэнхлэг (огтлол/дэлгээсэд босоо шугам)", IsChecked = _o.Grids, FontWeight = FontWeights.SemiBold, IsEnabled = info.Grids > 0 };
            form.Children.Add(_grids);
            form.Children.Add(Row("Доод үзүүр (1) — crop-ийн доод хилээс:", _gBottom, _o.GridBottomMm));
            form.Children.Add(Row("Дээд үзүүр (2) — crop-ийн дээд хилээс:", _gTop, _o.GridTopMm));
            _levels = new CheckBox { Content = "Түвшин (хэвтээ шугам)", IsChecked = _o.Levels, FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 14, 0, 0), IsEnabled = info.Levels > 0 };
            form.Children.Add(_levels);
            form.Children.Add(Row("Зүүн үзүүр — crop-ийн зүүн хилээс:", _lLeft, _o.LevelLeftMm));
            form.Children.Add(Row("Баруун үзүүр — crop-ийн баруун хилээс:", _lRight, _o.LevelRightMm));
            form.Children.Add(Mute(new TextBlock
            {
                Text = "Эерэг утга = crop-оос ГАДАГШ (бөмбөлөг, тэмдэг crop-ийн гадна), сөрөг = ДОТОГШ, 0 = яг crop-ийн хил дээр.  "
                    + "Crop-ийн хүрээнд харагдахгүй (гадна байгаа) тэнхлэг, түвшин хөндөгдөхгүй.  Тэнхлэг, түвшин сонгосон бол зөвхөн тэдгээрт.",
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 14, 0, 0),
            }));
            if (info.AnnotationCropActive)
            {
                Border warn = Ui.MglUi.Note("Annotation crop асаалттай — crop-оос гадагш гаргасан үзүүр annotation crop-ийн хилээс хэтэрвэл харагдахгүй.", Ui.MglSeverity.Warn);
                warn.Margin = new Thickness(0, 10, 0, 0);
                form.Children.Add(warn);
            }
            form.Children.Add(_msg);
            var scroll = new ScrollViewer { Content = form, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
            Grid.SetColumn(scroll, 2);
            body.Children.Add(scroll);
            root.Children.Add(body);
            Content = root;

            foreach (TextBox t in new[] { _gBottom, _gTop, _lLeft, _lRight }) t.TextChanged += (s, e) => Revalidate();
            foreach (CheckBox c in new[] { _grids, _levels })
            {
                c.Checked += (s, e) => Revalidate();
                c.Unchecked += (s, e) => Revalidate();
            }
            Revalidate();
        }

        /// <summary>Жижиг схем: тасархай crop, босоо тэнхлэг (доод «1» бөмбөлөгтэй, дээд «2»), хэвтээ түвшин — зай нь хилээс гадагш.</summary>
        private static FrameworkElement Sketch()
        {
            var c = new Canvas { Width = 220, Height = 300, ClipToBounds = true };
            Brush line = new SolidColorBrush(Color.FromRgb(0x3B, 0x8F, 0xD9));
            Brush red = new SolidColorBrush(Color.FromRgb(0xD9, 0x53, 0x4F));
            var muted = new SolidColorBrush(Color.FromRgb(0x8B, 0x94, 0xA0));
            // Crop: x 40..180, y 60..230
            var crop = new Rectangle { Width = 140, Height = 170, Stroke = muted, StrokeThickness = 1.2, StrokeDashArray = new DoubleCollection { 4, 3 } };
            Canvas.SetLeft(crop, 40);
            Canvas.SetTop(crop, 60);
            c.Children.Add(crop);
            Add(c, Text("crop", muted, 11), 44, 62);
            // Тэнхлэг: x 110, дээд үзүүр y 40 (crop-оос 20 дээш), доод y 255 + бөмбөлөг
            c.Children.Add(new Line { X1 = 110, Y1 = 40, X2 = 110, Y2 = 255, Stroke = line, StrokeThickness = 1.4, StrokeDashArray = new DoubleCollection { 8, 3, 2, 3 } });
            var bubble = new Ellipse { Width = 22, Height = 22, Stroke = line, StrokeThickness = 1.4 };
            Canvas.SetLeft(bubble, 99);
            Canvas.SetTop(bubble, 255);
            c.Children.Add(bubble);
            Add(c, Text("2", red, 15), 118, 30);
            Add(c, Text("1", red, 15), 125, 262);
            // Зайны тэмдэг (дээд, доод)
            c.Children.Add(new Line { X1 = 92, Y1 = 40, X2 = 92, Y2 = 60, Stroke = red, StrokeThickness = 1 });
            c.Children.Add(new Line { X1 = 92, Y1 = 230, X2 = 92, Y2 = 255, Stroke = red, StrokeThickness = 1 });
            // Түвшин: y 150, зүүн x 15, баруун x 205
            c.Children.Add(new Line { X1 = 15, Y1 = 150, X2 = 205, Y2 = 150, Stroke = line, StrokeThickness = 1.4 });
            Add(c, Text("түвшин", line, 11), 150, 132);
            c.Children.Add(new Line { X1 = 15, Y1 = 162, X2 = 40, Y2 = 162, Stroke = red, StrokeThickness = 1 });
            c.Children.Add(new Line { X1 = 180, Y1 = 162, X2 = 205, Y2 = 162, Stroke = red, StrokeThickness = 1 });
            return new Border { Child = c, VerticalAlignment = VerticalAlignment.Top };
        }

        private static TextBlock Text(string s, Brush b, double size)
        {
            return new TextBlock { Text = s, Foreground = b, FontSize = size, FontWeight = FontWeights.SemiBold };
        }

        private static void Add(Canvas c, UIElement e, double x, double y)
        {
            Canvas.SetLeft(e, x);
            Canvas.SetTop(e, y);
            c.Children.Add(e);
        }

        private static TextBox Num()
        {
            return new TextBox { Width = 60, TextAlignment = TextAlignment.Right, Margin = new Thickness(6, 0, 4, 0) };
        }

        private static FrameworkElement Row(string label, TextBox box, double value)
        {
            box.Text = value.ToString("0.#", CultureInfo.InvariantCulture);
            var row = new DockPanel { Margin = new Thickness(18, 6, 0, 0) };
            var unit = new TextBlock { Text = "мм", VerticalAlignment = VerticalAlignment.Center };
            DockPanel.SetDock(unit, Dock.Right);
            DockPanel.SetDock(box, Dock.Right);
            row.Children.Add(unit);
            row.Children.Add(box);
            row.Children.Add(new TextBlock { Text = label, VerticalAlignment = VerticalAlignment.Center, TextWrapping = TextWrapping.Wrap });
            return row;
        }

        private static TextBlock Mute(TextBlock t)
        {
            t.FontSize = 12;
            t.SetResourceReference(TextBlock.ForegroundProperty, "FgMuted");
            return t;
        }

        private AaDatumCropOptions Read(out bool parsed)
        {
            AaDatumCropOptions o = _o.Clone();
            o.Grids = _grids.IsChecked == true && _grids.IsEnabled;
            o.Levels = _levels.IsChecked == true && _levels.IsEnabled;
            parsed = true;
            double v;
            double max = AaDatumCropOptions.MaxAbsMm;
            if (AaPlacement.TryParseMm(_gBottom.Text, -max, max, out v)) o.GridBottomMm = v; else if (o.Grids) parsed = false;
            if (AaPlacement.TryParseMm(_gTop.Text, -max, max, out v)) o.GridTopMm = v; else if (o.Grids) parsed = false;
            if (AaPlacement.TryParseMm(_lLeft.Text, -max, max, out v)) o.LevelLeftMm = v; else if (o.Levels) parsed = false;
            if (AaPlacement.TryParseMm(_lRight.Text, -max, max, out v)) o.LevelRightMm = v; else if (o.Levels) parsed = false;
            return o;
        }

        private string Problem()
        {
            bool parsed;
            AaDatumCropOptions o = Read(out parsed);
            if (!parsed) return "Зай нь тоо байх ёстой (−" + AaDatumCropOptions.MaxAbsMm + "…" + AaDatumCropOptions.MaxAbsMm + " мм).";
            return o.Validate();
        }

        private void Revalidate()
        {
            string bad = Problem();
            _msg.Text = bad == null ? "" : "⚠ " + bad;
            _msg.Visibility = bad == null ? Visibility.Collapsed : Visibility.Visible;
            _ok.IsEnabled = bad == null;
        }

        private void OnOk(object sender, RoutedEventArgs e)
        {
            if (Problem() != null) return;
            bool parsed;
            Result = Read(out parsed);
            DialogResult = true;
        }
    }
}
