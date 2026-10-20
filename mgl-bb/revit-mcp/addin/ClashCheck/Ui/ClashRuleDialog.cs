using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using RevitMcpAddin.ClashCheck.Core;
using RevitMcpAddin.Smart.Core;
using RevitMcpAddin.Smart.Ui;

namespace RevitMcpAddin.ClashCheck.Ui
{
    /// <summary>
    /// Clash дүрэм засах/шинээр үүсгэх (модаль).  Редакц нь ХУУЛБАР дээр — «Болих» дарахад дүрэм өөрчлөгдөхгүй.
    ///
    /// «Зай (clearance)» горим: загвар бэлэн боловч геометрийн шалгагч БАЙХГҮЙ тул СОНГОХ боломжгүй
    /// (идэвхгүй хэлбэрээр, тайлбартай) — «зай шалгадаг» мэт харагдуулахгүй.
    /// Дүрмийн ТОХИРГОО (сонгогч, горим, босго, зориудын давхцлыг алгасах) өөрчлөгдвөл хуучин clash-ууд
    /// «хуучин тохиргоо»-ны түүх болж үлдэнэ (шинэ тохиргооны үр дүн биш) — үүнийг тайлбарлана.
    /// </summary>
    internal sealed class ClashRuleDialog : Window
    {
        private readonly ClashRule _rule;
        private readonly string _hashAtOpen;
        private readonly bool _isExisting;
        private readonly TextBox _name;
        private readonly CheckBox _enabled;
        private readonly ComboBox _severity;
        private readonly ComboBox _mode;
        private readonly TextBox _minVolume;
        private readonly CheckBox _joined, _hosted, _connected;
        private readonly SelectorEditor _a, _b;
        private readonly TextBlock _issues = UiKit.Text("", wrap: true);
        private readonly TextBlock _hashNote = UiKit.Text("", brush: UiKit.WarningBrush, wrap: true);
        private readonly Button _ok;

        private static readonly string[] SeverityLabels = { "Мэдээлэл", "Анхааруулга", "Ноцтой" };
        private static readonly ClashSeverity[] SeverityValues = { ClashSeverity.Info, ClashSeverity.Warning, ClashSeverity.Critical };
        private static readonly string[] SourceLabels = { "Энэ загвар", "Холбосон линкүүд", "Энэ загвар + линкүүд" };
        private static readonly ClashSource[] SourceValues = { ClashSource.Host, ClashSource.Links, ClashSource.Both };

        /// <summary>Хадгалагдсан дүрэм (OK дарсан бол); Болих бол null.</summary>
        internal ClashRule Result { get; private set; }

        internal ClashRuleDialog(Window owner, ClashRule rule, IReadOnlyList<CategoryInfo> categories, bool isExisting)
        {
            _rule = rule.Clone();
            ClashRuleStore.Normalize(_rule);
            _hashAtOpen = ClashRuleLogic.SemanticHash(_rule);
            _isExisting = isExisting;

            Title = isExisting ? "Давхцлын дүрэм засах" : "Давхцлын шинэ дүрэм";
            Owner = owner;
            WindowStartupLocation = WindowStartupLocation.CenterOwner;
            Width = 900;
            Height = 780;
            MinWidth = 700;
            MinHeight = 520;
            ShowInTaskbar = false;
            UiKit.Prepare(this, "clash-rule");

            _name = UiKit.Box(_rule.Name, 280);
            _enabled = UiKit.Check("Идэвхтэй (бүх дүрмийг шалгахад оролцоно)", _rule.Enabled);
            _severity = UiKit.Combo(SeverityLabels, SeverityLabels[Math.Max(0, Array.IndexOf(SeverityValues, _rule.Severity))], 140);

            _mode = new ComboBox { MinWidth = 280, Margin = new Thickness(2) };
            _mode.Items.Add("Хатуу огтлолцол (boolean intersect)");
            _mode.Items.Add(new ComboBoxItem { Content = "Зай (clearance) — ДЭМЖИГДЭХГҮЙ", IsEnabled = false });
            _mode.SelectedIndex = _rule.Mode == ClashMode.Clearance ? 1 : 0;

            _minVolume = UiKit.Box(_rule.MinVolumeCm3.ToString("0.###", CultureInfo.InvariantCulture), 80);
            _joined = UiKit.Check("Join Geometry хийсэн хосыг алгасах (зориудын давхцал)", _rule.IgnoreJoined);
            _hosted = UiKit.Check("Хост ба түүнд суурилсан элемент (хананд хаалга) хосыг алгасах", _rule.IgnoreHosted);
            _connected = UiKit.Check("Шууд холбогдсон MEP (хоолой ↔ холбох хэрэгсэл) хосыг алгасах", _rule.IgnoreConnected);

            _a = new SelectorEditor("A тал", _rule.A, categories, Refresh);
            _b = new SelectorEditor("B тал", _rule.B, categories, Refresh);

            _ok = UiKit.Btn("Хадгалах", OnOk, 100);
            _ok.IsDefault = true;
            Button cancel = UiKit.Btn("Болих", (s, e) => { Result = null; DialogResult = false; }, 80);
            cancel.IsCancel = true;

            Content = BuildLayout(cancel);

            _name.TextChanged += (s, e) => Refresh();
            _minVolume.TextChanged += (s, e) => Refresh();
            foreach (CheckBox c in new[] { _enabled, _joined, _hosted, _connected })
            {
                c.Checked += (s, e) => Refresh();
                c.Unchecked += (s, e) => Refresh();
            }
            _severity.SelectionChanged += (s, e) => Refresh();
            _mode.SelectionChanged += (s, e) => Refresh();
            Refresh();
        }

        private UIElement BuildLayout(Button cancel)
        {
            var general = UiKit.Form(
                UiKit.F("Нэр", _name),
                UiKit.F("Ноцтой байдал", _severity),
                UiKit.F("Горим", UiKit.Col(_mode, UiKit.Text(
                    "«Зай (clearance)» горимын загвар бэлтгэгдсэн ч геометрийн шалгагч хэрэгжээгүй — «зай шалгасан» гэж хуурахгүйн тулд сонгох боломжгүй.",
                    brush: UiKit.MutedBrush, wrap: true))),
                UiKit.F("Хамгийн бага огтлолцол (см³)", UiKit.Col(_minVolume, UiKit.Text(
                    "Үүнээс бага эзлэхүүнтэй давхцлыг clash гэж тооцохгүй (тооцооны алдаа, хэт жижиг давхцал).",
                    brush: UiKit.MutedBrush, wrap: true))),
                UiKit.F("", _enabled));

            var ignore = UiKit.Col(_joined, _hosted, _connected);

            var body = new StackPanel { Margin = new Thickness(10) };
            body.Children.Add(UiKit.Section("Ерөнхий", general));
            body.Children.Add(_a.Root);
            body.Children.Add(_b.Root);
            body.Children.Add(UiKit.Section("Зориудын давхцлыг алгасах", ignore));
            body.Children.Add(_hashNote);
            body.Children.Add(_issues);

            var scroll = new ScrollViewer { Content = body, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled };
            var buttons = UiKit.Row(_ok, cancel);
            buttons.HorizontalAlignment = HorizontalAlignment.Right;
            buttons.Margin = new Thickness(10, 6, 10, 10);

            var root = new DockPanel();
            DockPanel.SetDock(buttons, Dock.Bottom);
            root.Children.Add(buttons);
            root.Children.Add(scroll);
            return root;
        }

        /* ============================== SYNC =============================== */

        private bool TryReadVolume(out double v)
        {
            string t = (_minVolume.Text ?? "").Trim().Replace(',', '.');
            return double.TryParse(t, NumberStyles.Float, CultureInfo.InvariantCulture, out v);
        }

        /// <summary>Талбаруудаас `_rule`-г шинэчилж, баталгаажуулалтыг дахин үзүүлнэ.</summary>
        private void Refresh()
        {
            _rule.Name = (_name.Text ?? "").Trim();
            _rule.Enabled = _enabled.IsChecked == true;
            _rule.Severity = SeverityValues[Math.Max(0, _severity.SelectedIndex)];
            _rule.Mode = _mode.SelectedIndex == 1 ? ClashMode.Clearance : ClashMode.HardIntersection;
            _rule.IgnoreJoined = _joined.IsChecked == true;
            _rule.IgnoreHosted = _hosted.IsChecked == true;
            _rule.IgnoreConnected = _connected.IsChecked == true;
            _a.WriteTo(_rule.A);
            _b.WriteTo(_rule.B);

            double vol;
            bool volOk = TryReadVolume(out vol);
            if (volOk) _rule.MinVolumeCm3 = vol;

            List<RuleIssue> issues = ClashRuleLogic.Validate(_rule);
            if (!volOk) issues.Add(new RuleIssue { IsError = true, Message = "Хамгийн бага огтлолцол тоо биш байна." });

            _issues.Text = string.Join("\n", issues.Select(i => (i.IsError ? "⛔ " : "⚠ ") + i.Message));
            _issues.Foreground = issues.Any(i => i.IsError) ? UiKit.BlockingBrush : UiKit.WarningBrush;
            _ok.IsEnabled = ClashRuleLogic.IsRunnable(issues);

            bool changed = _isExisting && ClashRuleLogic.SemanticHash(_rule) != _hashAtOpen;
            _hashNote.Text = changed
                ? "⚠ Дүрмийн ТОХИРГОО (сонгогч / босго / алгасах) өөрчлөгдсөн — энэ дүрмийн хуучин clash-ууд «хуучин тохиргоо»-ны түүх болж үлдэж, шинэ шалгалт өөрийн clash-уудыг шинээр гаргана. Нэр, ноцтой байдлыг өөрчилбөл хуучин clash-ууд хэвээр үргэлжилнэ."
                : "";
        }

        private void OnOk(object sender, RoutedEventArgs e)
        {
            Refresh();
            if (!_ok.IsEnabled) return;
            Result = _rule.Clone();
            DialogResult = true;
        }

        /* ============================== SELECTOR =========================== */

        /// <summary>Нэг талын (A эсвэл B) сонгогч засварлагч — ангилал, эх үүсвэр, нэрийн шүүлтүүр.</summary>
        private sealed class SelectorEditor
        {
            internal readonly UIElement Root;
            private readonly ComboBox _source;
            private readonly TextBox _nameContains, _linkContains, _filter;
            private readonly StackPanel _list = new StackPanel();
            private readonly TextBlock _count = UiKit.Text("", brush: UiKit.MutedBrush);
            private readonly Action _changed;
            private bool _loading;

            internal SelectorEditor(string title, ClashSelector sel, IReadOnlyList<CategoryInfo> categories, Action changed)
            {
                _changed = changed;
                _loading = true;

                _source = UiKit.Combo(SourceLabels, SourceLabels[Math.Max(0, Array.IndexOf(SourceValues, sel.Source))], 200);
                _nameContains = UiKit.Box(sel.NameContains ?? "", 200);
                _linkContains = UiKit.Box(sel.LinkContains ?? "", 200);
                _filter = UiKit.Box("", 160);

                var known = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (CategoryInfo c in categories)
                {
                    known.Add(c.Id);
                    AddItem(c.Id, c.Name, sel.Categories.Contains(c.Id, StringComparer.OrdinalIgnoreCase));
                }
                // Дүрэмд байгаа ч жагсаалтад үгүй ангилал (өөр Revit хувилбар/жагсаалт ачаалагдаагүй) — ЧИМЭЭГҮЙ хаяхгүй.
                foreach (string id in sel.Categories.Where(x => !string.IsNullOrWhiteSpace(x)))
                    if (!known.Contains(id)) AddItem(id, id + " (жагсаалтад алга)", true);

                var scroll = new ScrollViewer
                {
                    Content = _list, Height = 150, VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                    BorderThickness = new Thickness(1), BorderBrush = UiKit.LineBrush,
                };

                var form = UiKit.Form(
                    UiKit.F("Эх үүсвэр", _source),
                    UiKit.F("Ангилал хайх", UiKit.Row(_filter, _count)),
                    UiKit.F("Ангилал", scroll),
                    UiKit.F("Гэр бүл/төрлийн нэр агуулсан", _nameContains),
                    UiKit.F("Линкийн нэр агуулсан", _linkContains));
                Root = UiKit.Section(title, form);

                _filter.TextChanged += (s, e) => ApplyFilter();
                _nameContains.TextChanged += (s, e) => Notify();
                _linkContains.TextChanged += (s, e) => Notify();
                _source.SelectionChanged += (s, e) => { UpdateLinkEnabled(); Notify(); };
                UpdateLinkEnabled();
                UpdateCount();
                _loading = false;
            }

            private void AddItem(string id, string name, bool isChecked)
            {
                var cb = new CheckBox { Content = name, Tag = id, IsChecked = isChecked, Margin = new Thickness(2, 1, 2, 1) };
                cb.Checked += (s, e) => { UpdateCount(); Notify(); };
                cb.Unchecked += (s, e) => { UpdateCount(); Notify(); };
                _list.Children.Add(cb);
            }

            private void ApplyFilter()
            {
                string f = (_filter.Text ?? "").Trim();
                foreach (CheckBox cb in _list.Children.OfType<CheckBox>())
                    cb.Visibility = f.Length == 0 || ((string)cb.Content).IndexOf(f, StringComparison.CurrentCultureIgnoreCase) >= 0 ? Visibility.Visible : Visibility.Collapsed;
            }

            private void UpdateLinkEnabled()
            {
                _linkContains.IsEnabled = SourceValues[Math.Max(0, _source.SelectedIndex)] != ClashSource.Host;
            }

            private void UpdateCount()
            {
                int n = _list.Children.OfType<CheckBox>().Count(c => c.IsChecked == true);
                _count.Text = "  сонгосон: " + n;
            }

            private void Notify()
            {
                if (!_loading && _changed != null) _changed();
            }

            internal void WriteTo(ClashSelector sel)
            {
                sel.Source = SourceValues[Math.Max(0, _source.SelectedIndex)];
                sel.NameContains = string.IsNullOrWhiteSpace(_nameContains.Text) ? null : _nameContains.Text.Trim();
                sel.LinkContains = string.IsNullOrWhiteSpace(_linkContains.Text) ? null : _linkContains.Text.Trim();
                sel.Categories = _list.Children.OfType<CheckBox>().Where(c => c.IsChecked == true).Select(c => (string)c.Tag).ToList();
            }
        }
    }
}
