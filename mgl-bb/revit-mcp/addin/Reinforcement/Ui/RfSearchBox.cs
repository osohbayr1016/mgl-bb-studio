using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement.Ui
{
    /// <summary>Сонгогчийн нэг сонголт.  <see cref="Haystack"/> = хайлтын текст (Family + Type, эсвэл түүврийн нэр).</summary>
    internal sealed class RfChoice
    {
        public string Label;
        public string Haystack;
        public object Tag;

        public RfChoice(string label, string haystack, object tag)
        {
            Label = label;
            Haystack = haystack ?? label;
            Tag = tag;
        }
    }

    /// <summary>
    /// ШУУД ХАЙЛТТАЙ сонгогч: дээр нь хайлтын талбар, доор нь шүүгдсэн жагсаалт (ComboBox) ба төлөв.  Тэмдгийн сонгогч ба эх түүврийн сонгогч
    /// ХОЁУЛАА үүнийг ашиглана — ижил дүрэм (<see cref="RfSearch"/>), ижил зан төлөв.
    ///
    /// * Жагсаалтыг Revit-ээс НЭГ удаа (дуудагч) цуглуулж өгнө; бичих бүрд ЗӨВХӨН санах ойн жагсаалтыг шүүнэ (collector дахин ажиллуулахгүй).
    /// * Сонголт хайлтаар нуугдсан ч ӨӨРЧЛӨГДӨХГҮЙ (хадгалсан тохиргоог чимээгүй солихгүй) — «хайлтаар нуугдсан» гэж ИЛ харуулна.
    /// * <see cref="Pinned"/> сонголтууд (ж: «Код-оор зурах тэмдэг») хайлтаас үл хамааран ҮРГЭЛЖ харагдана.
    /// * Тохирох зүйл байхгүй бол «Илэрц олдсонгүй».
    /// </summary>
    internal sealed class RfSearchBox : StackPanel
    {
        private readonly TextBox _search = new TextBox { Margin = new Thickness(0, 0, 0, 3), VerticalContentAlignment = VerticalAlignment.Center };
        private readonly TextBlock _hint = new TextBlock { IsHitTestVisible = false, Foreground = RfUi.Muted, Margin = new Thickness(6, 0, 0, 3), VerticalAlignment = VerticalAlignment.Center };
        private readonly ComboBox _combo = new ComboBox();
        private readonly TextBlock _status = new TextBlock { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 2, 0, 0) };
        private readonly List<RfChoice> _pinned;
        private readonly RfFilteredList<RfChoice> _list;
        private bool _loading;

        /// <summary>Хэрэглэгч (эсвэл <see cref="Select"/>) сонголтыг өөрчилсөн.  Хайлтаар жагсаалт шүүгдэхэд ГАРАХГҮЙ.</summary>
        public event EventHandler SelectionChanged;

        public RfSearchBox(IEnumerable<RfChoice> pinned, IEnumerable<RfChoice> items, string hint, double minWidth)
        {
            _pinned = new List<RfChoice>(pinned ?? new RfChoice[0]);
            _list = new RfFilteredList<RfChoice>(items, c => c.Haystack);
            _combo.MinWidth = minWidth;
            _hint.Text = "🔍 " + hint;

            var searchHost = new Grid();
            searchHost.Children.Add(_search);
            searchHost.Children.Add(_hint);
            Children.Add(searchHost);
            Children.Add(_combo);
            Children.Add(_status);

            _search.TextChanged += (s, e) =>
            {
                _hint.Visibility = _search.Text.Length == 0 ? Visibility.Visible : Visibility.Collapsed;
                _list.SetQuery(_search.Text);
                Rebuild();
            };
            _combo.SelectionChanged += (s, e) =>
            {
                if (_loading) return;
                ComboBoxItem it = _combo.SelectedItem as ComboBoxItem;
                RfChoice c = it == null ? null : it.Tag as RfChoice;
                if (c == null) return;
                _list.Select(c);
                RefreshStatus();
                EventHandler h = SelectionChanged;
                if (h != null) h(this, EventArgs.Empty);
            };
            Rebuild();
        }

        /// <summary>Сонгосон зүйл (хайлтаар нуугдсан ч).</summary>
        public RfChoice Selected { get { return _list.Selected; } }

        public string Query { get { return _search.Text; } }

        public int VisibleCount { get { return _list.Items.Count; } }

        public bool NoMatch { get { return _list.NoMatch; } }

        /// <summary>Сонголтыг програмаар тавина (ачаалахад).  <see cref="SelectionChanged"/>-ийг ДУУДАХГҮЙ.</summary>
        public void Select(RfChoice choice)
        {
            _list.Select(choice);
            Rebuild();
        }

        public void SetEnabled(bool enabled)
        {
            _combo.IsEnabled = enabled;
            _search.IsEnabled = enabled;
        }

        private void Rebuild()
        {
            _loading = true;
            try
            {
                _combo.Items.Clear();
                foreach (RfChoice p in _pinned) _combo.Items.Add(new ComboBoxItem { Content = p.Label, Tag = p });
                foreach (RfChoice c in _list.Items) _combo.Items.Add(new ComboBoxItem { Content = c.Label, Tag = c });

                // Сонголт харагдаж байвал ЯГ ТЭРЭНД (зөөгдсөн байрлалд) байлгана; нуугдсан бол комбо хоосон, сонголт нь хэвээр.
                RfChoice sel = _list.Selected;
                _combo.SelectedIndex = -1;
                if (sel != null)
                {
                    for (int i = 0; i < _combo.Items.Count; i++)
                    {
                        ComboBoxItem it = _combo.Items[i] as ComboBoxItem;
                        if (it != null && ReferenceEquals(it.Tag, sel))
                        {
                            _combo.SelectedIndex = i;
                            break;
                        }
                    }
                }
            }
            finally
            {
                _loading = false;
            }
            RefreshStatus();
        }

        private void RefreshStatus()
        {
            RfChoice sel = _list.Selected;
            bool visible = sel != null && (_pinned.Contains(sel) || _list.SelectedVisible);
            if (_list.NoMatch)
            {
                _status.Foreground = RfUi.Warn;
                _status.Text = RfText.SearchNoResults + (sel != null && !visible ? "  ·  " + RfText.SearchSelectedHidden(sel.Label) : string.Empty);
            }
            else if (sel != null && !visible)
            {
                _status.Foreground = RfUi.Muted;
                _status.Text = RfText.SearchSelectedHidden(sel.Label);
            }
            else
            {
                _status.Foreground = RfUi.Muted;
                _status.Text = string.IsNullOrWhiteSpace(_search.Text)
                    ? string.Empty
                    : RfText.SearchCount(_list.Items.Count, _list.TotalCount);
            }
            _status.Visibility = _status.Text.Length == 0 ? Visibility.Collapsed : Visibility.Visible;
        }
    }
}
