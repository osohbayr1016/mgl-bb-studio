using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using Autodesk.Revit.DB;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement.Ui
{
    /// <summary>
    /// «Түүвэр хувилах» болон «Түүвэр синк хийх» хоёулаа ХУВААЛЦАХ дээд хэсэг: эх түүвэр (ШУУД ХАЙЛТТАЙ) → Partition талбар →
    /// үүсэх түүврийн нэр.  Сонголт өөрчлөгдөх бүрд Partition утга, байгаа түүврүүдийг Revit-ээс (session-ээр) дахин
    /// уншиж <see cref="Changed"/>-ийг дуудна.
    ///
    /// ⚠️ «Түүврийн нэрийн загвар» нь ҮҮСЭХ ТҮҮВРҮҮДИЙН нэрийг гаргах томьёо: <c>{Partition}</c> нь Partition бүрийн утгаар (ж. DN-2), <c>{Template}</c> нь эх түүврийн
    /// нэрээр солигдоно.  Өгөгдмөл нь эх түүврийн нэрнээс автоматаар таагдана тул ихэнх тохиолдолд ХӨНДӨХ ХЭРЭГГҮЙ — тиймээс «Нэмэлт» хэсэгт хураасан,
    /// харин ГАРЧ БУЙ НЭР (жишээ) үргэлж харагдана (бодит нэрийн томьёогоор).
    /// </summary>
    internal sealed class RfScheduleSourcePanel : StackPanel
    {
        private sealed class AddMarker { }

        private readonly RfScheduleSession _s;
        private readonly List<ViewSchedule> _templates;
        private readonly RfSearchBox _tpl;
        private readonly ComboBox _field = new ComboBox { MinWidth = 380 };
        private readonly TextBlock _fieldNote = new TextBlock { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 2, 0, 0) };
        private readonly TextBox _pattern = new TextBox { MinWidth = 380 };
        private readonly TextBlock _patternIssue = new TextBlock { Foreground = RfUi.Bad, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 2, 0, 0) };
        private readonly TextBlock _example = new TextBlock { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 4, 0, 0), FontWeight = FontWeights.SemiBold };
        private readonly Expander _advanced;
        private bool _patternTouched;
        private bool _loading;
        private string _examplePartition;

        public RfTemplateInfo Info { get; private set; }
        public ElementId ParamId { get; private set; }
        public bool AddHidden { get; private set; }
        public RfPartitionSet Partitions { get; private set; }
        public List<RfExistingSchedule> Existing { get; private set; }
        public string TemplateFilterValue { get; private set; }
        public ViewSchedule Template { get; private set; }

        /// <summary>Загвар/талбар өөрчлөгдөж өгөгдөл дахин уншигдсан (эсвэл нэрийн загвар засагдсан).</summary>
        public event EventHandler Changed;

        public string Pattern { get { return _pattern.Text; } }
        public RfNameIssue PatternIssue { get { return RfScheduleNames.Validate(_pattern.Text); } }
        public bool Ready { get { return Template != null && ParamId != null && Partitions != null; } }

        public RfScheduleSourcePanel(RfScheduleSession session, List<ViewSchedule> templates, ViewSchedule preferred)
        {
            _s = session;
            _templates = templates;

            // ── Эх түүвэр: хайлттай.  Жагсаалтыг (session.Templates()) нэг удаа цуглуулсан — бичих бүрд санах ойд л шүүнэ.
            Children.Add(RfUi.Section(RfText.TemplateLabel));
            var choices = new List<RfChoice>();
            foreach (ViewSchedule t in templates)
                choices.Add(new RfChoice(t.Name, t.Name, t));
            _tpl = new RfSearchBox(null, choices, RfText.SearchHintSchedule.TrimEnd('…'), 380);
            Children.Add(_tpl);

            Children.Add(RfUi.Section(RfText.PartitionFieldLabel));
            Children.Add(_field);
            Children.Add(_fieldNote);

            // ── Үүсэх түүврийн нэр: ГАРЧ БУЙ НЭР үргэлж харагдана; загвар нь «Нэмэлт»-д хураагдсан.
            Children.Add(RfUi.Section(RfText.NameExampleHeading));
            Children.Add(_example);

            var adv = new StackPanel { Margin = new Thickness(0, 4, 0, 0) };
            adv.Children.Add(new TextBlock { Text = RfText.NamePatternLabel, FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 4, 0, 4) });
            adv.Children.Add(_pattern);
            adv.Children.Add(RfUi.Hint(RfText.NamePatternHint));
            adv.Children.Add(_patternIssue);
            _advanced = new Expander { Header = RfText.NamePatternAdvanced, IsExpanded = false, Content = adv, Margin = new Thickness(0, 4, 0, 0) };
            Children.Add(_advanced);

            _tpl.SelectionChanged += (s, e) => { if (!_loading) OnTemplateChanged(); };
            _field.SelectionChanged += (s, e) => { if (!_loading) OnFieldChanged(); };
            _pattern.TextChanged += (s, e) =>
            {
                if (_loading) return;
                _patternTouched = true;
                ShowPatternIssue();
                UpdateExample();
                RaiseChanged();
            };

            int pick = 0;
            if (preferred != null)
            {
                for (int i = 0; i < _templates.Count; i++)
                {
                    if (_templates[i].Id == preferred.Id) { pick = i; break; }
                }
            }
            if (_templates.Count > 0)
            {
                _tpl.Select(choices[pick]);
                OnTemplateChanged();
            }
        }

        /// <summary>
        /// «Жишээ» нэрийг үзүүлэх Partition (диалог чагталсан эхний мөрийг дамжуулна).  Нэр нь ЯГ бодит нэрийн томьёогоор
        /// (<see cref="RfScheduleNames.Resolve"/>) — «Үүсгэх» дарахад үүсэх нэртэй ижил.
        /// </summary>
        public void SetExamplePartition(string partition)
        {
            _examplePartition = partition;
            UpdateExample();
        }

        private void UpdateExample()
        {
            RfNameIssue issue = RfScheduleNames.Validate(_pattern.Text);
            if (Template == null)
            {
                _example.Text = string.Empty;
                return;
            }
            if (issue != RfNameIssue.None)
            {
                _example.Foreground = RfUi.Bad;
                _example.Text = RfText.PatternIssue(issue);
                return;
            }
            string part = _examplePartition;
            if (string.IsNullOrWhiteSpace(part) && Partitions != null)
                part = RfScheduleNames.PickExamplePartition(null, Partitions.Values.Select(v => v.Value), TemplateFilterValue);
            if (string.IsNullOrWhiteSpace(part))
            {
                _example.Foreground = RfUi.Muted;
                _example.Text = RfText.NameExampleNone;
                return;
            }
            _example.ClearValue(TextBlock.ForegroundProperty);
            _example.Text = RfText.NameExample(part, RfScheduleNames.Resolve(_pattern.Text, Template.Name, part));
        }

        private void ShowPatternIssue()
        {
            RfNameIssue issue = RfScheduleNames.Validate(_pattern.Text);
            _patternIssue.Text = issue == RfNameIssue.None ? string.Empty : RfText.PatternIssue(issue);
        }

        private void RaiseChanged()
        {
            EventHandler h = Changed;
            if (h != null) h(this, EventArgs.Empty);
        }

        private void OnTemplateChanged()
        {
            RfChoice sel = _tpl.Selected;
            Template = sel == null ? null : sel.Tag as ViewSchedule;
            Info = null;
            Partitions = null;
            ParamId = null;
            AddHidden = false;

            _loading = true;
            _field.Items.Clear();
            _fieldNote.Text = string.Empty;
            if (Template != null)
            {
                Info = _s.Inspect(Template);
                // Partition нэр дэвшигчийг эхэнд, бусдыг нэрээр.
                List<RfFieldInfo> ordered = Info.Fields
                    .OrderByDescending(f => f.IsPartitionCandidate ? 1 : 0)
                    .ThenBy(f => f.Index)
                    .ToList();
                RfFieldInfo detected = Info.DetectedIndex >= 0 ? Info.Fields[Info.DetectedIndex] : null;
                int select = -1;
                foreach (RfFieldInfo f in ordered)
                {
                    string label = (string.IsNullOrEmpty(f.Name) ? "?" : f.Name)
                        + (f.Hidden ? "  · " + Lang.T("нуугдсан", "hidden") : string.Empty)
                        + (ReferenceEquals(f, detected) ? RfText.AutoDetected : string.Empty);
                    _field.Items.Add(new ComboBoxItem { Content = label, Tag = f });
                    if (ReferenceEquals(f, detected)) select = _field.Items.Count - 1;
                }
                if (Info.AddableParameterId != null)
                {
                    _field.Items.Add(new ComboBoxItem { Content = RfText.AddHiddenFieldOption, Tag = new AddMarker() });
                    if (select < 0) select = _field.Items.Count - 1;
                }
                if (select < 0 && _field.Items.Count > 0 && Info.Fields.Count > 0) select = 0;
                if (select >= 0) _field.SelectedIndex = select;
                else _fieldNote.Text = RfText.NoPartitionField;
            }
            _loading = false;
            OnFieldChanged();
        }

        private void OnFieldChanged()
        {
            ComboBoxItem it = _field.SelectedItem as ComboBoxItem;
            ParamId = null;
            AddHidden = false;
            Partitions = null;
            Existing = null;
            TemplateFilterValue = null;
            _fieldNote.Foreground = RfUi.Muted;

            if (it != null && Template != null)
            {
                RfFieldInfo f = it.Tag as RfFieldInfo;
                if (f != null) ParamId = f.ParameterId;
                else if (it.Tag is AddMarker && Info != null && Info.AddableParameterId != null)
                {
                    ParamId = Info.AddableParameterId;
                    AddHidden = true;
                }
            }

            if (ParamId != null && Template != null)
            {
                // Олон мянган арматурын Partition унших нь хэдэн секунд болж болно — хүлээлтийн курсор.
                Cursor previous = Mouse.OverrideCursor;
                Mouse.OverrideCursor = Cursors.Wait;
                try
                {
                    Partitions = _s.Partitions(ParamId);
                    Existing = _s.Snapshot(Template, ParamId);
                    TemplateFilterValue = RfScheduleSession.FilterValueOf(Template.Definition, ParamId);
                }
                finally
                {
                    Mouse.OverrideCursor = previous;
                }

                string note = string.Empty;
                string bip = RfParam.BuiltInName(ParamId);
                if (bip != null) note = RfText.FieldFoundOn(bip);
                if (AddHidden) note = (note.Length > 0 ? note + "\n" : string.Empty) + RfText.AddHiddenFieldNote;
                if (Partitions.BlankCount > 0) note = (note.Length > 0 ? note + "\n" : string.Empty) + RfText.BlankWarning(Partitions.BlankCount);
                _fieldNote.Text = note;

                if (!_patternTouched)
                {
                    _loading = true;
                    _pattern.Text = RfScheduleNames.SuggestPattern(Template.Name, TemplateFilterValue);
                    _loading = false;
                }
            }
            else if (Template != null && _field.Items.Count == 0)
            {
                _fieldNote.Text = RfText.NoPartitionField;
                _fieldNote.Foreground = RfUi.Bad;
            }

            ShowPatternIssue();
            UpdateExample();
            RaiseChanged();
        }
    }
}
