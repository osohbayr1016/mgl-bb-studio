using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement.Ui
{
    /// <summary>Цонхноос команд руу буцаах үйлдэл — цонх хаагдаж, команд сонголтыг хийгээд ДАХИН нээнэ.</summary>
    internal enum RebarShowAction
    {
        None = 0,
        PickRebars,
        PickBars,
        WholeView,
        ResetPicked,
        ResetView,
    }

    /// <summary>
    /// «Арматурын ширхэг харуулах»-ын тохиргооны цонх.  ⚠️ Энд БИЗНЕС ЛОГИК БАЙХГҮЙ: харагдах ширхгийг <see cref="RfShowPlan"/> (Core, тестлэгдсэн) шийднэ;
    /// цонх зөвхөн утга уншиж, урьдчилан харалтыг мөн ТЭР Core-оор тооцоолно.  Revit-ийн сонголтыг (арматур сонгох, ширхэг дарах)
    /// команд хийнэ — цонх хаагдаад, дууссаны дараа сүүлийн утгуудаараа дахин нээгдэнэ.
    /// </summary>
    internal sealed class RebarShowDialog : Window
    {
        private readonly RfShowPrefs _prefs;
        private readonly CheckBox _first = new CheckBox { Content = RfShowText.First, Margin = new Thickness(0, 4, 18, 0) };
        private readonly CheckBox _last = new CheckBox { Content = RfShowText.Last, Margin = new Thickness(0, 4, 18, 0) };
        private readonly CheckBox _middle = new CheckBox { Content = RfShowText.Middle, Margin = new Thickness(0, 4, 0, 0) };
        private readonly TextBox _offsets = new TextBox { Width = 120 };
        private readonly RadioButton _both = new RadioButton { Content = RfShowText.SideBoth, GroupName = "side", Margin = new Thickness(0, 0, 16, 0) };
        private readonly RadioButton _start = new RadioButton { Content = RfShowText.SideStart, GroupName = "side", Margin = new Thickness(0, 0, 16, 0) };
        private readonly RadioButton _end = new RadioButton { Content = RfShowText.SideEnd, GroupName = "side" };
        private readonly CheckBox _keep = new CheckBox { Content = RfShowText.Keep, Margin = new Thickness(0, 8, 0, 0) };
        private readonly TextBox _previewCount = new TextBox { Width = 60 };
        private readonly TextBlock _preview = new TextBlock { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 4, 0, 0) };
        private readonly TextBlock _error = new TextBlock { Foreground = RfUi.Bad, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 8, 0, 0) };
        private bool _ready;
        private bool _offsetsWasEmpty = true;

        public RebarShowAction Action { get; private set; }

        /// <summary>Баталгаажсан тохиргоо — зөвхөн <see cref="Action"/> ≠ None үед.</summary>
        public RfShowSpec Spec { get; private set; }

        public RebarShowDialog(RfShowPrefs prefs, string lastStatus, int preselectedRebars)
        {
            _prefs = prefs ?? new RfShowPrefs();
            Action = RebarShowAction.None;
            RfUi.Setup(this, RfShowText.PickTitle, 640, 780, 560, 520);

            var root = new StackPanel { Margin = new Thickness(16) };
            root.Children.Add(new TextBlock { Text = RfShowText.DlgHeader, FontSize = 16, FontWeight = FontWeights.SemiBold });
            root.Children.Add(RfUi.Hint(RfShowText.DlgIntro));

            // ── Харуулах ширхэг
            root.Children.Add(RfUi.Section(RfShowText.ShowSection));
            var edges = new StackPanel { Orientation = Orientation.Horizontal };
            edges.Children.Add(_first);
            edges.Children.Add(_last);
            edges.Children.Add(_middle);
            root.Children.Add(edges);

            var off = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 8, 0, 0) };
            off.Children.Add(new TextBlock { Text = RfShowText.OffsetLabel, Margin = new Thickness(0, 0, 8, 0), VerticalAlignment = VerticalAlignment.Center });
            off.Children.Add(_offsets);
            root.Children.Add(off);
            root.Children.Add(RfUi.Hint(RfShowText.OffsetHint));

            var side = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 6, 0, 0) };
            side.Children.Add(new TextBlock { Text = RfShowText.SideLabel, Margin = new Thickness(0, 0, 10, 0), VerticalAlignment = VerticalAlignment.Center });
            side.Children.Add(_both);
            side.Children.Add(_start);
            side.Children.Add(_end);
            root.Children.Add(side);
            root.Children.Add(_keep);

            // ── Урьдчилан харах (Core-ийн ИЖИЛ дүрмээр)
            var prev = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 12, 0, 0) };
            prev.Children.Add(new TextBlock { Text = RfShowText.PreviewLabel, Margin = new Thickness(0, 0, 8, 0), VerticalAlignment = VerticalAlignment.Center });
            prev.Children.Add(_previewCount);
            root.Children.Add(prev);
            root.Children.Add(_preview);
            root.Children.Add(RfUi.Hint(RfShowText.PreviewMiddleNote));

            // ── Хэрэглэх
            root.Children.Add(RfUi.Section(RfShowText.ApplySection));
            if (preselectedRebars > 0) root.Children.Add(RfUi.Hint(RfShowText.PreselectedNote(preselectedRebars)));
            AddAction(root, RfShowText.BtnPickRebars, RfShowText.BtnPickRebarsHint, RebarShowAction.PickRebars, true);
            AddAction(root, RfShowText.BtnClick, RfShowText.BtnClickHint, RebarShowAction.PickBars, true);
            AddAction(root, RfShowText.BtnView, RfShowText.BtnViewHint, RebarShowAction.WholeView, true);

            root.Children.Add(RfUi.Section(RfShowText.ResetSection));
            AddAction(root, RfShowText.BtnResetPicked, string.Empty, RebarShowAction.ResetPicked, false);
            AddAction(root, RfShowText.BtnResetView, string.Empty, RebarShowAction.ResetView, false);

            root.Children.Add(_error);

            if (!string.IsNullOrEmpty(lastStatus))
            {
                root.Children.Add(RfUi.Section(RfShowText.StatusLabel));
                root.Children.Add(new TextBlock { Text = lastStatus, TextWrapping = TextWrapping.Wrap });
            }

            var close = RfUi.MakeButton(RfShowText.Close, false, true);
            close.HorizontalAlignment = HorizontalAlignment.Right;
            close.Margin = new Thickness(0, 16, 0, 0);
            close.Click += delegate { DialogResult = false; };
            root.Children.Add(close);

            Content = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Content = root };

            Load();
            _first.Checked += OnChanged; _first.Unchecked += OnChanged;
            _last.Checked += OnChanged; _last.Unchecked += OnChanged;
            _middle.Checked += OnChanged; _middle.Unchecked += OnChanged;
            _keep.Checked += OnChanged; _keep.Unchecked += OnChanged;
            _both.Checked += OnChanged; _start.Checked += OnChanged; _end.Checked += OnChanged;
            _offsetsWasEmpty = string.IsNullOrWhiteSpace(_offsets.Text);
            _offsets.TextChanged += OnOffsetsChanged;
            _previewCount.TextChanged += OnChanged;
            _ready = true;
            RefreshPreview();
        }

        private void AddAction(StackPanel root, string text, string hint, RebarShowAction action, bool needsSpec)
        {
            var b = new Button
            {
                Content = text,
                Padding = new Thickness(12, 6, 12, 6),
                HorizontalContentAlignment = HorizontalAlignment.Left,
                Margin = new Thickness(0, 6, 0, 0),
            };
            b.Click += delegate { OnAction(action, needsSpec); };
            root.Children.Add(b);
            if (!string.IsNullOrEmpty(hint)) root.Children.Add(RfUi.Hint(hint));
        }

        private void Load()
        {
            _first.IsChecked = _prefs.First;
            _last.IsChecked = _prefs.Last;
            _middle.IsChecked = _prefs.Middle;
            _offsets.Text = _prefs.Offsets ?? string.Empty;
            _keep.IsChecked = _prefs.Keep;
            _both.IsChecked = _prefs.Side == 0;
            _start.IsChecked = _prefs.Side == 1;
            _end.IsChecked = _prefs.Side == 2;
            _previewCount.Text = _prefs.PreviewCount.ToString(CultureInfo.InvariantCulture);
        }

        private RfShowSide SelectedSide()
        {
            if (_start.IsChecked == true) return RfShowSide.Start;
            if (_end.IsChecked == true) return RfShowSide.End;
            return RfShowSide.Both;
        }

        private bool TryBuild(out RfShowSpec spec)
        {
            spec = null;
            List<int> offs;
            if (!RfShowPlan.TryParseOffsets(_offsets.Text, out offs)) return false;
            spec = new RfShowSpec
            {
                First = _first.IsChecked == true,
                Last = _last.IsChecked == true,
                Middle = _middle.IsChecked == true,
                Offsets = offs,
                Side = SelectedSide(),
                KeepVisible = _keep.IsChecked == true,
            };
            return true;
        }

        private void OnChanged(object sender, EventArgs e)
        {
            if (!_ready) return;
            _error.Text = string.Empty;
            RefreshPreview();
        }

        /// <summary>
        /// «Голоос N дэх» ширхэг (хажуу талынх) анх бичигдэхэд голын ширхгийг АВТОМАТААР авна — голын хажуугийн ширхгийг харуулж байгаа бол гол нь
        /// ихэвчлэн хэрэггүй.  Хэрэглэгч «Голын ширхэг»-ийг дахин чагталж болно (дараа нь өөрчлөхгүй).
        /// </summary>
        private void OnOffsetsChanged(object sender, EventArgs e)
        {
            bool empty = string.IsNullOrWhiteSpace(_offsets.Text);
            if (_ready && _offsetsWasEmpty && !empty && _middle.IsChecked == true)
                _middle.IsChecked = false;
            _offsetsWasEmpty = empty;
            OnChanged(sender, e);
        }

        private void RefreshPreview()
        {
            int n;
            if (!int.TryParse(_previewCount.Text, NumberStyles.Integer, CultureInfo.InvariantCulture, out n) || n < RfShowPlan.MinPositions || n > 999)
            {
                _preview.Text = string.Empty;
                return;
            }
            RfShowSpec spec;
            if (!TryBuild(out spec))
            {
                _preview.Text = RfShowText.BadOffsets;
                return;
            }
            // Урьдчилан харахад «одоо харагдаж буй» үл мэдэгдэнэ — зөвхөн тохиргооны өөрийнх нь ширхэг.
            spec.KeepVisible = false;
            List<int> existing = Enumerable.Range(0, n).ToList();
            RfShowDecision d = RfShowPlan.Decide(existing, spec, null, null);
            if (d.Empty)
            {
                _preview.Text = _keep.IsChecked == true ? string.Empty : RfShowText.PreviewNothing;
                return;
            }
            string text = RfShowText.PreviewVisible(n, RfShowPlan.DescribeVisible(existing, d));
            if (d.OutOfRange.Count > 0) text += "\n" + RfShowText.PreviewOutOfRange(string.Join(", ", d.OutOfRange.Select(k => k.ToString(CultureInfo.InvariantCulture))));
            _preview.Text = text;
        }

        private void OnAction(RebarShowAction action, bool needsSpec)
        {
            RfShowSpec spec = null;
            if (needsSpec)
            {
                if (!TryBuild(out spec))
                {
                    _error.Text = RfShowText.BadOffsets;
                    return;
                }
                bool anything = spec.First || spec.Last || spec.Middle || spec.Offsets.Count > 0 || spec.KeepVisible;
                if (!anything)
                {
                    _error.Text = RfShowText.NothingChosen;
                    return;
                }
            }

            // Тохиргоог ҮРГЭЛЖ хадгална (сэргээх үйлдэл ч гэсэн) — дараагийн нээлтэд хэвээр харагдана.
            _prefs.First = _first.IsChecked == true;
            _prefs.Last = _last.IsChecked == true;
            _prefs.Middle = _middle.IsChecked == true;
            _prefs.Offsets = _offsets.Text ?? string.Empty;
            _prefs.Side = (int)SelectedSide();
            _prefs.Keep = _keep.IsChecked == true;
            int n;
            if (int.TryParse(_previewCount.Text, NumberStyles.Integer, CultureInfo.InvariantCulture, out n) && n >= RfShowPlan.MinPositions && n <= 999) _prefs.PreviewCount = n;
            _prefs.Save();

            Spec = spec;
            Action = action;
            DialogResult = true;
        }
    }
}
