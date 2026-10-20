using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using Autodesk.Revit.DB;
using RevitMcpAddin.CloneDrawings.Core;

namespace RevitMcpAddin.Reinforcement.Ui
{
    /// <summary>Хуулж тавих зорилтот элемент (энэ харагдацын дам нуруу/багана) — цонхны жагсаалтад.</summary>
    internal sealed class RfTemplateTarget
    {
        public Element Host;
        public string Label = string.Empty;
    }

    /// <summary>
    /// «Хуулбарлаж зурах»: гараар зурсан төстэй харагдацаа НЭРЭЭР (шууд хайлттай) сонгож, түүний хэмжээс, арматурын tag, текстийг ИДЭВХТЭЙ харагдацын
    /// дам нуруу/баганад хуулна.  Өмнө нь «Огтлолын тэмдэглэгээ»-ний цонхонд шигтгэгдсэн байсан (<c>SectionAnnotationDialog</c>) — «Хэмжээс, тэмдэглэгээ» хэрэгсэлд
    /// НЭГТГЭХДЭЭ код хуулбарлахгүй, ИЖИЛ хөдөлгүүрээр (<see cref="RfTemplateSource"/> → <see cref="RfTemplateService.Run"/>) тусдаа панел болгов.
    /// Зөвхөн хуулбарлаж зурахад хамаатай тохиргоо: загвар харагдац, загварын/зорилтот элемент, юуг хуулах (хэмжээс, tag, текст).
    ///
    /// ⚠️ ЭНД БИЗНЕС ЛОГИК БАЙХГҮЙ: сонголтыг цуглуулж <see cref="CurrentPick"/>-д өгнө; хуулалтыг <see cref="RfTemplateFlow"/> хийнэ.
    /// </summary>
    internal sealed class RfTemplatePanel : StackPanel
    {
        private readonly Document _doc;
        private readonly RfTemplateSource _templates;
        private readonly List<RfTemplateTarget> _targets;

        private readonly RfSearchBox _search;
        private readonly ComboBox _templateHost = new ComboBox { MinWidth = 400, Margin = new Thickness(0, 2, 0, 0) };
        private readonly TextBlock _templateHostLabel = new TextBlock { Text = RfText.TplHostLabel, FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 8, 0, 0) };
        private readonly ComboBox _target = new ComboBox { MinWidth = 400, Margin = new Thickness(0, 2, 0, 0) };
        private readonly TextBlock _status = new TextBlock { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 4, 0, 0) };
        private readonly CheckBox _dims = new CheckBox { Content = RfText.TplOptDims, IsChecked = true, Margin = new Thickness(0, 6, 0, 0) };
        private readonly CheckBox _tags = new CheckBox { Content = RfText.TplOptTags, IsChecked = true, Margin = new Thickness(0, 2, 0, 0) };
        private readonly CheckBox _details = new CheckBox { Content = RfText.TplOptDetails, IsChecked = true, Margin = new Thickness(0, 2, 0, 0) };

        private OntoViewRules.ViewRow _row;
        private RfTemplateHosts _hosts;
        private bool _usable;

        /// <summary>Сонголт өөрчлөгдөх бүрд (хуулах боломжтой эсэх өөрчлөгдсөн байж болно).</summary>
        public event EventHandler StateChanged;

        /// <param name="usable">false = энэ харагдац дээр хуулбарлаж зурахгүй (фасад) — зөвхөн тайлбар харуулна.</param>
        public RfTemplatePanel(Document doc, RfTemplateSource templates, List<RfTemplateTarget> targets, bool usable)
        {
            _doc = doc;
            _templates = templates;
            _targets = targets ?? new List<RfTemplateTarget>();
            _usable = usable;

            Children.Add(RfUi.Hint(RfText.TplIntro));

            if (!usable)
            {
                Children.Add(new TextBlock { Text = "⛔ " + RfText.TplUnsupportedView, Foreground = RfUi.Warn, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 10, 0, 0) });
                return;
            }

            // ── Зорилтот элемент
            Children.Add(new TextBlock { Text = _targets.Count > 1 ? RfText.TplTargetPick : RfText.TplTargetLabel, FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 10, 0, 0) });
            foreach (RfTemplateTarget t in _targets)
                _target.Items.Add(new ComboBoxItem { Content = t.Label, Tag = t });
            if (_targets.Count > 0) _target.SelectedIndex = 0;
            _target.IsEnabled = _targets.Count > 1;
            _target.SelectionChanged += (s, e) => OnTargetChanged();
            Children.Add(_target);
            if (_targets.Count == 0)
                Children.Add(new TextBlock { Text = "⛔ " + RfText.TplTargetNone, Foreground = RfUi.Bad, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 4, 0, 0) });

            // ── Загвар харагдац (хайлттай)
            Children.Add(new TextBlock { Text = RfText.TplHeading, FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 12, 0, 0) });
            var items = _templates.Rows.Select(r => new RfChoice(
                r.Name + "   ·   " + RfText.TplCounts(r.Dims, r.Tags, r.Notes) + (r.SameKind ? string.Empty : "   (" + r.TypeLabel + ")"),
                OntoViewRules.Haystack(r), r)).ToList();
            var none = new RfChoice(RfText.TplNoneChosen, string.Empty, null);
            _search = new RfSearchBox(new[] { none }, items, RfText.TplSearchHint, 400);
            _search.Margin = new Thickness(0, 6, 0, 0);
            _search.Select(none);
            _search.SelectionChanged += (s, e) => OnTemplateChanged();
            Children.Add(_search);
            if (items.Count == 0)
            {
                _search.SetEnabled(false);
                Children.Add(new TextBlock { Text = RfText.TplNoCandidates, Foreground = RfUi.Warn, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 4, 0, 0) });
            }

            _templateHostLabel.Visibility = System.Windows.Visibility.Collapsed;
            _templateHost.Visibility = System.Windows.Visibility.Collapsed;
            _templateHost.SelectionChanged += (s, e) => OnTemplateHostChanged();
            Children.Add(_templateHostLabel);
            Children.Add(_templateHost);
            Children.Add(_status);

            Children.Add(_dims);
            Children.Add(_tags);
            Children.Add(_details);
            foreach (CheckBox c in new[] { _dims, _tags, _details })
            {
                c.Checked += (s, e) => Update();
                c.Unchecked += (s, e) => Update();
            }
        }

        /// <summary>Хуулах боломжтой (загвар, загварын элемент, зорилтот элемент, ядаж нэг сонголт) болсон бол true.</summary>
        public bool CanCopy
        {
            get
            {
                return _usable && _row != null && SelectedTemplateHost() != null && SelectedTarget() != null
                    && (_dims.IsChecked == true || _tags.IsChecked == true || _details.IsChecked == true);
            }
        }

        public Element TargetHost { get { return SelectedTarget(); } }

        /// <summary>Хуулалтын сонголт; <see cref="CanCopy"/> биш бол null.</summary>
        public RfTemplatePick CurrentPick()
        {
            if (!CanCopy) return null;
            return new RfTemplatePick
            {
                ViewId = _row.Id,
                ViewName = _row.Name,
                HostId = SelectedTemplateHost().Id.Value,
                Options = new RfTemplateOptions
                {
                    Dims = _dims.IsChecked == true,
                    Tags = _tags.IsChecked == true,
                    Details = _details.IsChecked == true,
                },
            };
        }

        private Element SelectedTemplateHost()
        {
            ComboBoxItem it = _templateHost.SelectedItem as ComboBoxItem;
            return it == null ? null : it.Tag as Element;
        }

        private Element SelectedTarget()
        {
            ComboBoxItem it = _target.SelectedItem as ComboBoxItem;
            RfTemplateTarget t = it == null ? null : it.Tag as RfTemplateTarget;
            return t == null ? null : t.Host;
        }

        private void OnTargetChanged()
        {
            OnTemplateHostChanged();
        }

        private void OnTemplateChanged()
        {
            RfChoice sel = _search == null ? null : _search.Selected;
            _row = sel == null ? null : sel.Tag as OntoViewRules.ViewRow;
            _hosts = null;
            _templateHost.Items.Clear();
            _templateHostLabel.Visibility = System.Windows.Visibility.Collapsed;
            _templateHost.Visibility = System.Windows.Visibility.Collapsed;
            _status.Text = string.Empty;
            if (_row == null)
            {
                Raise();
                return;
            }

            _hosts = _templates.Resolve(_row.Id);
            if (_hosts.Hosts.Count == 0)
            {
                _status.Foreground = RfUi.Bad;
                _status.Text = "⛔ " + RfText.TplHostNone;
                Raise();
                return;
            }

            foreach (Element h in _hosts.Hosts)
                _templateHost.Items.Add(new ComboBoxItem { Content = RfSectionAnalyzer.Describe(_doc, h) + "   Id " + h.Id.Value, Tag = h });
            _templateHost.SelectedIndex = 0;
            _templateHostLabel.Text = _hosts.Hosts.Count > 1 ? RfText.TplHostPick : RfText.TplHostLabel;
            _templateHostLabel.Visibility = System.Windows.Visibility.Visible;
            _templateHost.Visibility = System.Windows.Visibility.Visible;
            _templateHost.IsEnabled = _hosts.Hosts.Count > 1;
            OnTemplateHostChanged();
        }

        private void OnTemplateHostChanged()
        {
            Element th = SelectedTemplateHost();
            Element tg = SelectedTarget();
            _status.Text = string.Empty;
            if (th != null && tg != null)
            {
                RfHostKind tk = RfSectionAnalyzer.KindOf(th), gk = RfSectionAnalyzer.KindOf(tg);
                if (gk != RfHostKind.Auto && tk != RfHostKind.Auto && tk != gk)
                {
                    _status.Foreground = RfUi.Warn;
                    _status.Text = "• " + RfText.TplHostKindMismatch(RfText.TplHostKindName(tk), RfText.TplHostKindName(gk));
                }
            }
            Update();
        }

        private void Update()
        {
            bool anyOpt = _dims.IsChecked == true || _tags.IsChecked == true || _details.IsChecked == true;
            if (_row != null && !anyOpt && _status.Text.Length == 0)
            {
                _status.Foreground = RfUi.Warn;
                _status.Text = "• " + RfText.TplNeedOption;
            }
            else if (anyOpt && _status.Text == "• " + RfText.TplNeedOption)
            {
                _status.Text = string.Empty;
            }
            Raise();
        }

        private void Raise()
        {
            EventHandler h = StateChanged;
            if (h != null) h(this, EventArgs.Empty);
        }
    }
}
