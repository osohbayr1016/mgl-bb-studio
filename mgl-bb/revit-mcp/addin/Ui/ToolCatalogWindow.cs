using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using RevitMcpAddin.Ui.Core;

namespace RevitMcpAddin.Ui
{
    /// <summary>
    /// «Хэрэгсэл хайх» — MGL-ийн БҮХ хэрэгслийг нэр/үйлдлээр хайж, юу хийдэг, юу өөрчилдөг, ERP руу юм илгээдэг эсэх,
    /// ОДОО яагаад нээгдэхгүй байгааг харуулна.  Модаль; «Нээх» нь цонхыг хаагаад `ChosenTool` буцаана — командыг
    /// `ToolCatalogCommand` (API контекст дотор) `PostCommand`-оор эхлүүлнэ.
    ///
    /// ⚠️ Каталогт харагдах нь ЭРХ БИШ: хэрэгсэл ӨӨРИЙН лиценз/шалгалтыг хийнэ.
    /// ⚠️ Энэ Revit хувилбарт ЭМХЭТГЭГДЭЭГҮЙ хэрэгсэл (R24: Smart, Family сан, Миний ажил) жагсаалтад тайлбартай нь
    ///    харагдана, гэхдээ «Нээх» товч ӨГӨХГҮЙ (эвдэрсэн товч биш).
    /// ⚠️ Хайлт локал (`ToolSearch`), сүлжээ/AI хэрэггүй.  Контекст нэг удаа уншигдсан (`ToolContext`).
    /// </summary>
    internal sealed class ToolCatalogWindow : Window
    {
        internal const string HintFlag = "catalog.hint.dismissed";

        private readonly ToolContext _ctx;
        private readonly List<ToolMeta> _all;
        private readonly Dictionary<string, ToolAvailabilityResult> _avail = new Dictionary<string, ToolAvailabilityResult>(StringComparer.Ordinal);

        private readonly TextBox _search = new TextBox();
        private readonly TextBlock _searchLabel = new TextBlock { Text = "Хайх — нэр эсвэл хийх үйлдэл (жишээ: давхцал, huudas dugaar, clash)" };
        private readonly TextBlock _count = new TextBlock();
        private readonly ListBox _list = new ListBox();
        private readonly StackPanel _detail = new StackPanel { Margin = new Thickness(16, 12, 16, 12) };
        private readonly Button _openBtn = new Button { Content = MglUiText.Open, IsDefault = true, MinWidth = 110 };
        private readonly Button _closeBtn = new Button { Content = MglUiText.Close, IsCancel = true, MinWidth = 90, Margin = new Thickness(8, 0, 0, 0) };
        private readonly TextBlock _openHint = new TextBlock { TextWrapping = TextWrapping.Wrap, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 12, 0) };
        private readonly Border _hint = new Border();
        private bool _rebuilding;

        /// <summary>Хэрэглэгч «Нээх» дарсан хэрэгсэл (null = зөвхөн хаасан).</summary>
        internal ToolMeta ChosenTool { get; private set; }

        internal ToolCatalogWindow(ToolContext context)
        {
            _ctx = context ?? new ToolContext();
            _all = ToolCatalogData.All.ToList();
            foreach (ToolMeta t in _all) _avail[t.Name] = ToolAvailability.Evaluate(t, _ctx);

            Title = "MGL — Хэрэгсэл хайх";
            MglWindow.Setup(this, Title, 1000, 660, 780, 480, prefsKey: "tool-catalog");
            BuildLayout();
            MglTheme.Apply(this);
            MglUi.Primary(_openBtn);
            WireEvents();
            Loaded += (s, e) => { _search.Focus(); };
            Rebuild();
        }

        // ── Бүтэц ────────────────────────────────────────────────────

        private void BuildLayout()
        {
            var root = new Grid { Margin = new Thickness(16) };
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });   // 0 зөвлөмж
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });   // 1 хайлт
            root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });   // 2 агуулга
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });   // 3 товчны мөр

            BuildHint(root);

            var searchRow = new StackPanel { Margin = new Thickness(0, 0, 0, 10) };
            _searchLabel.Margin = new Thickness(0, 0, 0, 4);
            searchRow.Children.Add(_searchLabel);
            searchRow.Children.Add(_search);
            MglAuto.LabelFor(_searchLabel, _search);
            MglAuto.Name(_search, "Хэрэгсэл хайх", "Хэрэгслийн нэр эсвэл хийх үйлдлээ бичнэ. Доош сум дарж жагсаалт руу шилжинэ.");
            MglAuto.Id(_search, "tool-catalog-search");
            Grid.SetRow(searchRow, 1);
            root.Children.Add(searchRow);

            var content = new Grid();
            content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(340), MinWidth = 260 });
            content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star), MinWidth = 300 });

            MglAuto.Name(_list, "MGL хэрэгслийн жагсаалт");
            MglAuto.Id(_list, "tool-catalog-list");
            _list.HorizontalContentAlignment = HorizontalAlignment.Stretch;
            ScrollViewer.SetHorizontalScrollBarVisibility(_list, ScrollBarVisibility.Disabled);
            Grid.SetColumn(_list, 0);
            content.Children.Add(_list);

            var splitter = new GridSplitter { Width = 6, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Stretch, ResizeBehavior = GridResizeBehavior.PreviousAndNext };
            splitter.SetResourceReference(BackgroundProperty, "Line");
            MglAuto.Name(splitter, "Жагсаалт ба тайлбарын хоорондох хуваагч", "Зүүн, баруун сумаар өргөнийг өөрчилнө");
            Grid.SetColumn(splitter, 1);
            content.Children.Add(splitter);

            var detailScroll = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled, Content = _detail, Focusable = false };
            var detailBorder = new Border { BorderThickness = new Thickness(1), Child = detailScroll };
            detailBorder.SetResourceReference(Border.BorderBrushProperty, "LineStrong");
            detailBorder.SetResourceReference(Border.BackgroundProperty, "BgRaised");
            MglAuto.Name(detailBorder, "Сонгосон хэрэгслийн тайлбар");
            Grid.SetColumn(detailBorder, 2);
            content.Children.Add(detailBorder);

            Grid.SetRow(content, 2);
            root.Children.Add(content);

            // Товчны мөр: «Нээх» боломжгүй бол ШАЛТГААНЫГ ил текстээр (tooltip биш) хэлнэ.
            var footer = new Grid { Margin = new Thickness(0, 12, 0, 0) };
            footer.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            footer.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var left = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            _count.Style = null;
            _count.SetResourceReference(StyleProperty, "MglMuted");
            left.Children.Add(_count);
            footer.Children.Add(left);
            var right = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
            _openHint.SetResourceReference(StyleProperty, "MglMuted");
            right.Children.Add(_openHint);
            right.Children.Add(_openBtn);
            right.Children.Add(_closeBtn);
            Grid.SetColumn(right, 1);
            footer.Children.Add(right);
            Grid.SetRow(footer, 3);
            root.Children.Add(footer);

            MglAuto.Id(_openBtn, "tool-catalog-open");
            MglAuto.Id(_closeBtn, "tool-catalog-close");
            Content = root;
        }

        private void BuildHint(Grid root)
        {
            if (MglUiPrefs.GetFlag(HintFlag)) { _hint.Visibility = System.Windows.Visibility.Collapsed; return; }

            var text = new TextBlock
            {
                TextWrapping = TextWrapping.Wrap,
                Text = "Зөвлөмж: хайлтад хэрэгслийн нэр эсвэл хийх үйлдлээ бичнэ (хуучин нэр, англи, латин бичлэг ч болно). "
                     + "Хэрэгсэл бүрийн тайлбарт юу өөрчилдөг, ERP руу юм илгээдэг эсэх, одоо яагаад нээгдэхгүй байгаа нь харагдана. "
                     + "Каталогт харагдах нь эрх биш — хэрэгсэл нээгдэхдээ өөрийн нэвтрэлт, шалгалтыг хийнэ.",
            };
            var dismiss = new Button { Content = "Ойлголоо", Margin = new Thickness(12, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center, MinWidth = 90 };
            MglAuto.Name(dismiss, "Зөвлөмжийг хаах", "Дахиж харуулахгүй");
            dismiss.Click += (s, e) =>
            {
                MglUiPrefs.SetFlag(HintFlag, true);
                _hint.Visibility = System.Windows.Visibility.Collapsed;
            };
            var row = new DockPanel();
            DockPanel.SetDock(dismiss, Dock.Right);
            row.Children.Add(dismiss);
            row.Children.Add(text);
            _hint.Child = row;
            _hint.SetResourceReference(StyleProperty, "MglNote");
            _hint.Margin = new Thickness(0, 0, 0, 10);
            Grid.SetRow(_hint, 0);
            root.Children.Add(_hint);
        }

        private void WireEvents()
        {
            _search.TextChanged += (s, e) => Rebuild();
            _search.PreviewKeyDown += (s, e) =>
            {
                if (e.Key == Key.Down && _list.Items.Count > 0)
                {
                    if (_list.SelectedIndex < 0) _list.SelectedIndex = 0;
                    FocusSelected();
                    e.Handled = true;
                }
            };
            _list.SelectionChanged += (s, e) => { if (!_rebuilding) ShowDetail(SelectedTool()); };
            _list.PreviewKeyDown += (s, e) =>
            {
                if (e.Key == Key.Up && _list.SelectedIndex == 0) { _search.Focus(); e.Handled = true; }
            };
            _list.MouseDoubleClick += (s, e) => { if (_openBtn.IsEnabled) OpenSelected(); };
            _openBtn.Click += (s, e) => OpenSelected();
        }

        // ── Жагсаалт ─────────────────────────────────────────────────

        private void Rebuild()
        {
            _rebuilding = true;
            try
            {
                string selectedName = SelectedTool() == null ? null : SelectedTool().Name;
                IReadOnlyList<ToolMeta> found = ToolSearch.Filter(_all, _search.Text);
                // Энэ хувилбарт байгаа нь түрүүлж, байхгүй нь хойно (харьцангуй дараалал хадгалагдана).
                List<ToolMeta> ordered = found.Where(t => ToolAvailability.IsInBuild(t, _ctx.RunningBuild))
                    .Concat(found.Where(t => !ToolAvailability.IsInBuild(t, _ctx.RunningBuild))).ToList();

                _list.Items.Clear();
                ListBoxItem keep = null;
                foreach (ToolMeta t in ordered)
                {
                    ListBoxItem item = BuildItem(t);
                    _list.Items.Add(item);
                    if (keep == null && t.Name == selectedName) keep = item;
                }
                _count.Text = ordered.Count == _all.Count
                    ? _all.Count + " хэрэгсэл"
                    : ordered.Count + " / " + _all.Count + " хэрэгсэл олдлоо";
                if (keep != null) _list.SelectedItem = keep;
                else if (_list.Items.Count > 0) _list.SelectedIndex = 0;
            }
            finally
            {
                _rebuilding = false;
            }
            ShowDetail(SelectedTool());
        }

        private ListBoxItem BuildItem(ToolMeta t)
        {
            ToolAvailabilityResult a = _avail[t.Name];
            string status = StatusLine(t, a);

            var grid = new Grid();
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            var icon = new Image { Width = 22, Height = 22, Margin = new Thickness(0, 2, 10, 0), VerticalAlignment = VerticalAlignment.Top, Source = ToolIconRenderer.Render(t.IconKey, 22) };
            Grid.SetColumn(icon, 0);
            grid.Children.Add(icon);

            var text = new StackPanel();
            text.Children.Add(new TextBlock { Text = t.LabelOneLine, FontWeight = FontWeights.SemiBold, TextTrimming = TextTrimming.CharacterEllipsis });
            var sub = new TextBlock { Text = RibbonPlan.WhereTitles(t) + " · " + status, TextTrimming = TextTrimming.CharacterEllipsis };
            sub.SetResourceReference(StyleProperty, "MglMuted");
            sub.TextWrapping = TextWrapping.NoWrap;
            text.Children.Add(sub);
            Grid.SetColumn(text, 1);
            grid.Children.Add(text);

            var item = new ListBoxItem { Content = grid, Tag = t, Padding = new Thickness(8, 6, 8, 6), ToolTip = t.FullName };
            MglAuto.Name(item, t.LabelOneLine + ". " + status, t.Purpose);
            return item;
        }

        private static string StatusLine(ToolMeta t, ToolAvailabilityResult a)
        {
            if (a.Block == ToolBlock.NotInThisBuild) return "— энэ Revit-д байхгүй";
            if (a.Block != ToolBlock.None) return "✖ одоо нээгдэхгүй: " + a.Reason.TrimEnd('.');
            if (a.Setup != ToolSetup.None) return "ⓘ " + a.Reason.TrimEnd('.');
            return "✓ бэлэн";
        }

        private ToolMeta SelectedTool()
        {
            ListBoxItem item = _list.SelectedItem as ListBoxItem;
            return item == null ? null : item.Tag as ToolMeta;
        }

        private void FocusSelected()
        {
            ListBoxItem item = _list.SelectedItem as ListBoxItem;
            if (item != null) item.Focus();
        }

        // ── Тайлбар ──────────────────────────────────────────────────

        private void ShowDetail(ToolMeta t)
        {
            _detail.Children.Clear();
            if (t == null)
            {
                _detail.Children.Add(MglUi.Muted("Хайлтад тохирох хэрэгсэл олдсонгүй. Өөр үгээр (жишээ нь «давхцал», «хуудас», «арматур», «ERP») оролдоно уу."));
                UpdateOpenButton(null);
                return;
            }

            ToolAvailabilityResult a = _avail[t.Name];

            _detail.Children.Add(MglUi.Heading(t.FullName));
            string where = "Ribbon: «" + RibbonPlan.WhereTitles(t) + "»"
                + (t.Presentation == ToolPresentation.Pulldown ? " › " + ToolPulldowns.ErpSendFullName : string.Empty)
                + (t.Build == ToolBuild.Net8Plus ? " · Revit 2025+" : string.Empty);
            TextBlock whereText = MglUi.Muted(where);
            whereText.Margin = new Thickness(0, 2, 0, 8);
            _detail.Children.Add(whereText);

            // Одоогийн төлөв — ӨНГӨӨР ГАНЦААРАА БИШ: тэмдэгт + бичвэр.
            if (a.Block == ToolBlock.NotInThisBuild)
                _detail.Children.Add(MglUi.Note(a.Reason + " " + a.Resolution, MglSeverity.Warn));
            else if (a.Block != ToolBlock.None)
                _detail.Children.Add(MglUi.Note("Одоо нээгдэхгүй: " + a.Reason + " " + a.Resolution, MglSeverity.Warn));
            else if (a.Setup != ToolSetup.None)
                _detail.Children.Add(MglUi.Note(a.Reason + " " + a.Resolution, MglSeverity.Info));
            else
                _detail.Children.Add(MglUi.Note("Одоо нээж болно.", MglSeverity.Ok));

            _detail.Children.Add(Body(t.Purpose, new Thickness(0, 8, 0, 6)));

            // Салбар (2026-10-13): нийтлэг биш хэрэгсэлд хэний хэрэгсэл вэ, туузан цэсэнд нуугдсан эсэх.
            // ⚠️ `Ui.Revit.RibbonDisciplines`-ийг энд ДУУДАХГҮЙ — энэ цонх Revit-гүй smoke төсөлд ч эмхэтгэгдэнэ.
            if (!ToolDisciplines.IsAll(t.Disciplines) && t.Disciplines != ToolDiscipline.None)
            {
                ToolDiscipline active = (MglUiPrefs.Load().Ribbon ?? new RibbonPrefs()).Active;
                _detail.Children.Add(Body("Салбар: " + ToolDisciplines.Describe(t.Disciplines), new Thickness(0, 0, 0, 4)));
                if (!ToolDisciplines.IsVisible(t, active))
                    _detail.Children.Add(MglUi.Note("Таны туузан цэсэнд нуугдсан (салбар: " + ToolDisciplines.Describe(active)
                        + "). Харуулах бол «Тохиргоо» → «Туузан цэсэнд харагдах хэрэгсэл».", MglSeverity.Info));
            }

            AddSection("Юу болох вэ");
            foreach (string line in ToolEffectsText.Describe(t)) AddBullet(line);
            if ((t.Effects & (ToolEffects.SendsToErp | ToolEffects.CreatesFiles)) != 0 || (t.Effects & ToolEffects.None) == 0)
                AddBullet("Үр дүн: " + t.Destination);

            if (!string.IsNullOrWhiteSpace(t.Undo))
            {
                AddSection("Буцаах");
                _detail.Children.Add(Body(t.Undo, new Thickness(0, 0, 0, 4)));
            }

            if (t.HowTo != null && t.HowTo.Length > 0)
            {
                AddSection("Хэрхэн ашиглах");
                for (int i = 0; i < t.HowTo.Length; i++) AddBullet((i + 1) + ". " + t.HowTo[i]);
            }

            if (!string.IsNullOrWhiteSpace(t.Confusable))
            {
                AddSection("Андуурахгүй байх");
                _detail.Children.Add(Body(t.Confusable, new Thickness(0, 0, 0, 4)));
            }

            var more = new Expander { Header = "Дэлгэрэнгүй заавар", Margin = new Thickness(0, 10, 0, 0) };
            more.Content = Body(t.LongDescription, new Thickness(2, 4, 0, 0));
            MglAuto.Name(more, "Дэлгэрэнгүй заавар");
            _detail.Children.Add(more);

            UpdateOpenButton(t);
        }

        private void UpdateOpenButton(ToolMeta t)
        {
            if (t == null)
            {
                _openBtn.IsEnabled = false;
                _openHint.Text = string.Empty;
                return;
            }
            ToolAvailabilityResult a = _avail[t.Name];
            _openBtn.IsEnabled = a.CanLaunch;
            // «Нээх» идэвхгүй болсон шалтгаан — товчны хажууд ИЛ бичвэрээр.
            _openHint.Text = a.CanLaunch
                ? (a.Setup != ToolSetup.None ? "ⓘ Нээхэд " + SetupWord(a.Setup) + " цонх өөрөө гарна." : string.Empty)
                : "✖ " + a.Reason;
        }

        private static string SetupWord(ToolSetup s)
        {
            switch (s)
            {
                case ToolSetup.SignIn: return "нэвтрэх";
                case ToolSetup.LicensePending: return "лицензийн мэдээлэл";
                case ToolSetup.ErpProject: return "тохиргооны";
                default: return "шаардлагатай";
            }
        }

        private void AddSection(string title)
        {
            var tb = new TextBlock { Text = title, Margin = new Thickness(0, 10, 0, 4) };
            tb.SetResourceReference(StyleProperty, "MglSubheading");
            _detail.Children.Add(tb);
        }

        private void AddBullet(string text)
        {
            var tb = new TextBlock { Text = (text.Length > 1 && char.IsDigit(text[0]) ? string.Empty : "• ") + text, Margin = new Thickness(8, 1, 0, 1) };
            tb.SetResourceReference(StyleProperty, "MglBody");
            _detail.Children.Add(tb);
        }

        private static TextBlock Body(string text, Thickness margin)
        {
            var tb = new TextBlock { Text = text, Margin = margin };
            tb.SetResourceReference(StyleProperty, "MglBody");
            return tb;
        }

        private void OpenSelected()
        {
            ToolMeta t = SelectedTool();
            if (t == null || !_avail[t.Name].CanLaunch) return;
            ChosenTool = t;
            DialogResult = true;
        }
    }
}
