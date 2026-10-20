using System.Windows;
using System.Windows.Controls;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement.Ui
{
    /// <summary>
    /// «Захын, голын арматур» товчны цонх (2026-10-05): харагдацын БҮХ олонлогт хэнийг үлдээхийг сонгоно — эхний / сүүлийн / голын ширхэг.
    /// Сонголт <c>rebar-show.json</c>-д хадгалагдана (дараагийн нээлтэд хэвээр).  Бизнес логик ЭНД БАЙХГҮЙ — <see cref="RfShowPlan"/> шийднэ.
    /// </summary>
    internal sealed class RebarEdgesDialog : Window
    {
        private readonly RfShowPrefs _prefs;
        private readonly CheckBox _first = new CheckBox { Content = RfShowText.First, Margin = new Thickness(0, 4, 0, 0) };
        private readonly CheckBox _last = new CheckBox { Content = RfShowText.Last, Margin = new Thickness(0, 4, 0, 0) };
        private readonly CheckBox _middle = new CheckBox { Content = RfShowText.Middle, Margin = new Thickness(0, 4, 0, 0) };
        private readonly TextBlock _error = new TextBlock { Foreground = RfUi.Bad, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 8, 0, 0) };

        /// <summary>Баталгаажсан тохиргоо — зөвхөн цонх «Хэрэглэх»-ээр хаагдсан үед.</summary>
        public RfShowSpec Spec { get; private set; }

        public RebarEdgesDialog(RfShowPrefs prefs, int rebarCount)
        {
            _prefs = prefs ?? new RfShowPrefs();
            RfUi.Setup(this, RfShowText.EdgesTitle, 440, 330, 380, 300);

            var root = new StackPanel { Margin = new Thickness(16) };
            root.Children.Add(new TextBlock { Text = RfShowText.EdgesHeader, FontSize = 16, FontWeight = FontWeights.SemiBold });
            root.Children.Add(RfUi.Hint(RfShowText.EdgesIntro(rebarCount)));

            root.Children.Add(RfUi.Section(RfShowText.ShowSection));
            root.Children.Add(_first);
            root.Children.Add(_last);
            root.Children.Add(_middle);
            root.Children.Add(RfUi.Hint(RfShowText.PreviewMiddleNote));
            root.Children.Add(_error);

            var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 16, 0, 0) };
            var ok = RfUi.MakeButton(RfShowText.EdgesApply, true, false);
            var cancel = RfUi.MakeButton(RfShowText.Close, false, true);
            cancel.Margin = new Thickness(8, 0, 0, 0);
            ok.Click += delegate { OnOk(); };
            cancel.Click += delegate { DialogResult = false; };
            buttons.Children.Add(ok);
            buttons.Children.Add(cancel);
            root.Children.Add(buttons);

            Content = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Content = root };

            _first.IsChecked = _prefs.EdgeFirst;
            _last.IsChecked = _prefs.EdgeLast;
            _middle.IsChecked = _prefs.EdgeMiddle;
        }

        private void OnOk()
        {
            bool f = _first.IsChecked == true, l = _last.IsChecked == true, m = _middle.IsChecked == true;
            if (!f && !l && !m)
            {
                _error.Text = RfShowText.EdgesNothingChosen;
                return;
            }
            _prefs.EdgeFirst = f;
            _prefs.EdgeLast = l;
            _prefs.EdgeMiddle = m;
            _prefs.Save();
            Spec = new RfShowSpec { First = f, Last = l, Middle = m };
            DialogResult = true;
        }
    }
}
