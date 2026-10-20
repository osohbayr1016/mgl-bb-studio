using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using WpfGrid = System.Windows.Controls.Grid;
using Autodesk.Revit.DB;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement.Ui
{
    /// <summary>
    /// «Арматурын төгсгөлийн тэмдэг»-ийн тохиргоо.  Бүх утгыг <see cref="OnOk"/> нэг газраас гаргана —
    /// handler нь зөвхөн утга уншиж шалгана (бизнес логик <c>EndSymbolService</c>/<c>RfEndSymbolMath</c>-д).
    ///
    /// * Тэмдгийн сонгогч ШУУД ХАЙЛТТАЙ (Family / Type): жагсаалтыг нэг удаа цуглуулж, санах ойд шүүнэ.
    /// * Олонлог: «Бүх ширхэг» / «Эхний ширхэг» / «Эхний ба сүүлийн ширхэг» (+ дарсан цэгт ойр).
    /// * Эхлэл ба Төгсгөлийн эргэлт ТУСДАА (хоёр талбар).
    /// </summary>
    internal sealed class EndSymbolDialog : Window
    {
        private readonly Document _doc;
        private readonly RfEndSymbolPrefs _prefs;
        private readonly RfSearchBox _symbol;
        private readonly RfChoice _markerChoice = new RfChoice(RfText.MarkerOption, RfText.MarkerOption, null);
        private readonly List<RfChoice> _symbolChoices = new List<RfChoice>();
        private readonly ComboBox _markerStyle = new ComboBox { Width = 200 };
        private readonly TextBox _markerSize = new TextBox { Width = 60, TextAlignment = TextAlignment.Right };

        private readonly RadioButton _both, _start, _end;
        private readonly RadioButton _auto, _fixed;
        private readonly TextBox _startRot = new TextBox { Width = 70, TextAlignment = TextAlignment.Right };
        private readonly TextBox _endRot = new TextBox { Width = 70, TextAlignment = TextAlignment.Right };
        private readonly TextBlock _rotHint = new TextBlock { Foreground = RfUi.Muted, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 2, 0, 0) };
        private readonly TextBox _natural = new TextBox { Width = 60, TextAlignment = TextAlignment.Right };
        private readonly TextBox _offset = new TextBox { Width = 80, TextAlignment = TextAlignment.Right };
        private readonly CheckBox _hooks = new CheckBox { Content = RfText.IncludeHooks, Margin = new Thickness(0, 6, 0, 0) };
        private readonly ComboBox _barSet = new ComboBox { Width = 320 };
        private readonly CheckBox _dups = new CheckBox { Content = RfText.AllowDuplicates, Margin = new Thickness(0, 6, 0, 0) };
        private readonly CheckBox _remember = new CheckBox { Content = RfText.Remember, Margin = new Thickness(0, 10, 0, 0) };
        private readonly TextBlock _error = new TextBlock { Foreground = RfUi.Bad, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 6, 0, 0) };
        private readonly List<FamilySymbol> _symbols;

        public EndSymbolDialog(Document doc, List<FamilySymbol> symbols, RfEndSymbolPrefs prefs, int preRebars, int preNotRebar)
        {
            _doc = doc;
            _symbols = symbols;
            _prefs = prefs ?? new RfEndSymbolPrefs();
            RfUi.Setup(this, RfText.EndTitle, 680, 860, 600, 560);

            var root = new StackPanel { Margin = new Thickness(16) };
            root.Children.Add(new TextBlock { Text = RfText.EndHeader, FontSize = 16, FontWeight = FontWeights.SemiBold });
            root.Children.Add(RfUi.Hint(RfText.EndIntro));

            // ── Тэмдэг (ШУУД ХАЙЛТТАЙ)
            root.Children.Add(RfUi.Section(RfText.SymbolLabel));
            // Эхний (ҮРГЭЛЖ харагдах) сонголт: family-гүй, код-оор зурах тэмдэг.  Тохирох family байхгүй ч ЭНЭ үргэлж боломжтой.
            foreach (FamilySymbol s in symbols)
            {
                string haystack = RfSearch.SymbolHaystack(s.FamilyName, s.Name) + " " + (s.Category == null ? string.Empty : s.Category.Name);
                _symbolChoices.Add(new RfChoice(EndSymbolService.Label(s), haystack, s));
            }
            _symbol = new RfSearchBox(new[] { _markerChoice }, _symbolChoices, RfText.SearchHintSymbol.TrimEnd('…'), 420);
            root.Children.Add(_symbol);
            if (symbols.Count == 0) root.Children.Add(RfUi.Hint(RfText.NoSymbols));

            var marker = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 6, 0, 0) };
            marker.Children.Add(new TextBlock { Text = RfText.MarkerStyleLabel, Margin = new Thickness(0, 0, 8, 0), VerticalAlignment = VerticalAlignment.Center });
            _markerStyle.Items.Add(new ComboBoxItem { Content = RfText.MarkerCircle, Tag = RfMarkerStyle.Circle });
            _markerStyle.Items.Add(new ComboBoxItem { Content = RfText.MarkerCross, Tag = RfMarkerStyle.Cross });
            _markerStyle.Items.Add(new ComboBoxItem { Content = RfText.MarkerSlash, Tag = RfMarkerStyle.Slash });
            marker.Children.Add(_markerStyle);
            marker.Children.Add(new TextBlock { Text = RfText.MarkerSizeLabel, Margin = new Thickness(16, 0, 8, 0), VerticalAlignment = VerticalAlignment.Center });
            marker.Children.Add(_markerSize);
            root.Children.Add(marker);

            // ── Байрлуулах
            root.Children.Add(RfUi.Section(RfText.PlaceLabel));
            var place = new StackPanel { Orientation = Orientation.Horizontal };
            _both = new RadioButton { Content = RfText.PlaceBoth, Margin = new Thickness(0, 0, 18, 0), GroupName = "place" };
            _start = new RadioButton { Content = RfText.PlaceStart, Margin = new Thickness(0, 0, 18, 0), GroupName = "place" };
            _end = new RadioButton { Content = RfText.PlaceEnd, GroupName = "place" };
            place.Children.Add(_both);
            place.Children.Add(_start);
            place.Children.Add(_end);
            root.Children.Add(place);

            // ── Эргэлт: чиглэл (автомат/тогтмол) + Эхлэл, Төгсгөлийн БИЕ ДААСАН өнцөг
            root.Children.Add(RfUi.Section(RfText.OrientLabel));
            var orient = new StackPanel { Orientation = Orientation.Horizontal };
            _auto = new RadioButton { Content = RfText.OrientAuto, Margin = new Thickness(0, 0, 18, 0), GroupName = "orient" };
            _fixed = new RadioButton { Content = RfText.OrientFixed, Margin = new Thickness(0, 0, 8, 0), GroupName = "orient" };
            orient.Children.Add(_auto);
            orient.Children.Add(_fixed);
            root.Children.Add(orient);

            var rot = new WpfGrid { Margin = new Thickness(0, 6, 0, 0) };
            rot.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            rot.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            rot.RowDefinitions.Add(new RowDefinition());
            rot.RowDefinitions.Add(new RowDefinition());
            var sl = new TextBlock { Text = RfText.StartRotLabel, Margin = new Thickness(0, 0, 10, 4), VerticalAlignment = VerticalAlignment.Center };
            var el = new TextBlock { Text = RfText.EndRotLabel, Margin = new Thickness(0, 0, 10, 0), VerticalAlignment = VerticalAlignment.Center };
            _startRot.Margin = new Thickness(0, 0, 0, 4);
            WpfGrid.SetRow(sl, 0); WpfGrid.SetColumn(sl, 0);
            WpfGrid.SetRow(_startRot, 0); WpfGrid.SetColumn(_startRot, 1);
            WpfGrid.SetRow(el, 1); WpfGrid.SetColumn(el, 0);
            WpfGrid.SetRow(_endRot, 1); WpfGrid.SetColumn(_endRot, 1);
            rot.Children.Add(sl);
            rot.Children.Add(_startRot);
            rot.Children.Add(el);
            rot.Children.Add(_endRot);
            root.Children.Add(rot);
            root.Children.Add(_rotHint);

            var natural = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 6, 0, 0) };
            natural.Children.Add(new TextBlock { Text = RfText.NaturalLabel, Margin = new Thickness(0, 0, 8, 0), VerticalAlignment = VerticalAlignment.Center });
            natural.Children.Add(_natural);
            root.Children.Add(natural);
            root.Children.Add(RfUi.Hint(RfText.NaturalHint));

            // ── Оффсет
            string unit = RfUnits.LengthLabel(doc);
            var off = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 10, 0, 0) };
            off.Children.Add(new TextBlock { Text = RfText.OffsetLabel(unit), Margin = new Thickness(0, 0, 8, 0), VerticalAlignment = VerticalAlignment.Center });
            off.Children.Add(_offset);
            root.Children.Add(off);
            root.Children.Add(RfUi.Hint(RfText.OffsetHint));

            root.Children.Add(_hooks);

            root.Children.Add(RfUi.Section(RfText.BarSetLabel));
            _barSet.Items.Add(new ComboBoxItem { Content = RfText.BarSetNearest, Tag = RfBarSetMode.Nearest });
            _barSet.Items.Add(new ComboBoxItem { Content = RfText.BarSetAll, Tag = RfBarSetMode.All });
            _barSet.Items.Add(new ComboBoxItem { Content = RfText.BarSetFirst, Tag = RfBarSetMode.First });
            _barSet.Items.Add(new ComboBoxItem { Content = RfText.BarSetFirstLast, Tag = RfBarSetMode.FirstLast });
            root.Children.Add(_barSet);
            root.Children.Add(RfUi.Hint(RfText.BarSetHint));

            root.Children.Add(_dups);
            root.Children.Add(_remember);

            // ── Доод хэсэг: ГҮЙЛГЭГДЭХ агуулгаас ГАДУУР (бага дэлгэц дээр ч товч, алдаа, «дараа нь юу болох» үргэлж харагдана).
            var bottom = new StackPanel { Margin = new Thickness(16, 6, 16, 14) };
            // «Арматур сонгох» дарсны дараа Revit-д хийх зүйлийг ХАРАГДАХ байдлаар (өмнө нь гүйлгэх хэсгийн дунд нэг мөр байв).
            string after = RfText.SelectionInfo(preRebars, preNotRebar);
            if (preRebars == 0) after += "  " + RfText.CtrlzPerPick;
            bottom.Children.Add(RfUi.Note(after));
            _error.Margin = new Thickness(0, 6, 0, 0);
            bottom.Children.Add(_error);
            var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 10, 0, 0) };
            Button ok = RfUi.MakeButton(preRebars > 0 ? RfText.PlaceNow : RfText.PickRebars, true, false, 130);
            global::RevitMcpAddin.Ui.MglUi.Primary(ok);
            ok.Click += OnOk;
            Button cancel = RfUi.MakeButton(RfText.Cancel, false, true, 80);
            buttons.Children.Add(ok);
            buttons.Children.Add(cancel);
            bottom.Children.Add(buttons);

            var dock = new DockPanel();
            DockPanel.SetDock(bottom, Dock.Bottom);
            dock.Children.Add(bottom);
            dock.Children.Add(new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Content = root });
            Content = dock;

            Load();
            _fixed.Checked += (s, e) => SyncRotationHint();
            _auto.Checked += (s, e) => SyncRotationHint();
            _symbol.SelectionChanged += (s, e) => SyncMarkerControls();
            SyncRotationHint();
            SyncMarkerControls();
        }

        private bool MarkerSelected()
        {
            return ReferenceEquals(_symbol.Selected, _markerChoice);
        }

        /// <summary>Код-оор зурах тэмдгийн хэв маяг/хэмжээ ЗӨВХӨН түүнийг сонгосон үед; family-ийн «заах чиглэл» зөвхөн family-д.</summary>
        private void SyncMarkerControls()
        {
            bool m = MarkerSelected();
            _markerStyle.IsEnabled = m;
            _markerSize.IsEnabled = m;
            _natural.IsEnabled = !m;
        }

        /// <summary>Эргэлтийн тайлбар «Арматур дагуу» (offset) ба «Тогтмол» (абсолют) хоёрт өөр — утга учир нь ИЛ.</summary>
        private void SyncRotationHint()
        {
            _rotHint.Text = _fixed.IsChecked == true ? RfText.RotHintFixed : RfText.RotHintAuto;
        }

        private void Load()
        {
            // Сонголт: хадгалсан Family + Type НЭР (эхний удаа: «MGL» угтвартай эсвэл эхний family; family огт байхгүй бол код-оор зурах тэмдэг).
            FamilySymbol pick = null;
            bool marker = _prefs.UseMarker;
            if (!marker)
            {
                pick = EndSymbolService.Resolve(_symbols, _prefs.SymbolFamily, _prefs.SymbolType, _prefs.SymbolName);
                if (pick == null) pick = EndSymbolService.Preferred(_symbols);
                if (pick == null) marker = true;
            }
            if (marker) _symbol.Select(_markerChoice);
            else _symbol.Select(_symbolChoices.FirstOrDefault(c => ReferenceEquals(c.Tag, pick)) ?? _markerChoice);

            RfMarkerStyle ms;
            if (!RfMarkerGeometry.TryParse(_prefs.MarkerStyle, out ms)) ms = RfMarkerStyle.Circle;
            _markerStyle.SelectedIndex = ms == RfMarkerStyle.Cross ? 1 : ms == RfMarkerStyle.Slash ? 2 : 0;
            _markerSize.Text = Num(_prefs.MarkerSizeMm > 0 ? _prefs.MarkerSizeMm : RfMarkerGeometry.DefaultSizeMm);

            _both.IsChecked = _prefs.Place == "both" || (_prefs.Place != "start" && _prefs.Place != "end");
            _start.IsChecked = _prefs.Place == "start";
            _end.IsChecked = _prefs.Place == "end";
            _auto.IsChecked = _prefs.Orientation != "fixed";
            _fixed.IsChecked = _prefs.Orientation == "fixed";
            // Хуучин тохиргоо (нэг өнцөг) RfPrefs.Load-д шилжсэн; шууд (Remember-гүй) үүссэн тохиргоонд null байж болно.
            double legacy = _prefs.Orientation == "fixed" ? _prefs.FixedAngleDeg : 0.0;
            _startRot.Text = Num(_prefs.StartRotationDeg ?? legacy);
            _endRot.Text = Num(_prefs.EndRotationDeg ?? legacy);
            _natural.Text = Num(_prefs.SymbolAngleOffsetDeg);
            _offset.Text = Num(RfUnits.MmToProject(_doc, _prefs.OffsetMm));
            _hooks.IsChecked = _prefs.IncludeHooks;
            _barSet.SelectedIndex = _prefs.BarSet == "all" ? 1 : _prefs.BarSet == "first" ? 2 : _prefs.BarSet == "firstlast" ? 3 : 0;
            _dups.IsChecked = _prefs.AllowDuplicates;
            _remember.IsChecked = _prefs.Remember;
        }

        private static string Num(double v)
        {
            return Math.Round(v, 3).ToString("0.###", System.Globalization.CultureInfo.InvariantCulture);
        }

        /// <summary>Remember тэмдэглэгээтэй эсэх — тэмдэглээгүй бол сонголтыг хадгалахгүй.</summary>
        public bool Remember { get { return _remember.IsChecked == true; } }

        public RfEndSymbolOptions Options { get; private set; }

        /// <summary>Цонхны сонголтыг prefs руу (хадгалахад).</summary>
        public void ApplyTo(RfEndSymbolPrefs p)
        {
            FamilySymbol s = SelectedSymbol();
            p.UseMarker = MarkerSelected();
            // ⚠️ ElementId/UniqueId хадгалахгүй — зөвхөн Family + Type нэр.
            p.SymbolFamily = s == null ? string.Empty : s.FamilyName;
            p.SymbolType = s == null ? string.Empty : s.Name;
            p.SymbolName = string.Empty;
            p.MarkerStyle = RfMarkerGeometry.Code(SelectedMarkerStyle());
            double sz;
            if (RfUi.TryParse(_markerSize.Text, out sz) && sz > 0) p.MarkerSizeMm = sz;
            p.Place = _start.IsChecked == true ? "start" : _end.IsChecked == true ? "end" : "both";
            p.Orientation = _fixed.IsChecked == true ? "fixed" : "auto";
            double v;
            // Эхлэл, Төгсгөл — ТУСДАА хоёр утга (нэг тохиргоог хуваалцахгүй).
            if (RfUi.TryParse(_startRot.Text, out v)) p.StartRotationDeg = v;
            if (RfUi.TryParse(_endRot.Text, out v)) p.EndRotationDeg = v;
            if (RfUi.TryParse(_natural.Text, out v)) p.SymbolAngleOffsetDeg = v;
            if (RfUi.TryParse(_offset.Text, out v)) p.OffsetMm = RfUnits.ProjectToMm(_doc, v);
            p.IncludeHooks = _hooks.IsChecked == true;
            p.BarSet = SelectedBarSet() == RfBarSetMode.All ? "all"
                : SelectedBarSet() == RfBarSetMode.First ? "first"
                : SelectedBarSet() == RfBarSetMode.FirstLast ? "firstlast" : "nearest";
            p.AllowDuplicates = _dups.IsChecked == true;
            p.Remember = Remember;
        }

        private FamilySymbol SelectedSymbol()
        {
            RfChoice c = _symbol.Selected;
            return c == null ? null : c.Tag as FamilySymbol;
        }

        private RfMarkerStyle SelectedMarkerStyle()
        {
            ComboBoxItem it = _markerStyle.SelectedItem as ComboBoxItem;
            return it != null && it.Tag is RfMarkerStyle ? (RfMarkerStyle)it.Tag : RfMarkerStyle.Circle;
        }

        private RfBarSetMode SelectedBarSet()
        {
            ComboBoxItem it = _barSet.SelectedItem as ComboBoxItem;
            return it != null && it.Tag is RfBarSetMode ? (RfBarSetMode)it.Tag : RfBarSetMode.Nearest;
        }

        private void OnOk(object sender, RoutedEventArgs e)
        {
            FamilySymbol s = SelectedSymbol();
            bool useMarker = MarkerSelected();
            if (s == null && !useMarker)
            {
                _error.Text = RfText.NoSymbolChosen;
                return;
            }
            double markerSize = RfMarkerGeometry.DefaultSizeMm;
            if (useMarker && (!RfUi.TryParse(_markerSize.Text, out markerSize) || markerSize < RfMarkerGeometry.MinSizeMm || markerSize > RfMarkerGeometry.MaxSizeMm))
            {
                _error.Text = RfText.MarkerSizeInvalid(RfMarkerGeometry.MinSizeMm, RfMarkerGeometry.MaxSizeMm);
                return;
            }
            double startRot, endRot, natural = 0, offset = 0;
            if (!RfUi.TryParse(_startRot.Text, out startRot))
            {
                _error.Text = RfText.RotationInvalid(RfText.StartRotLabel);
                return;
            }
            if (!RfUi.TryParse(_endRot.Text, out endRot))
            {
                _error.Text = RfText.RotationInvalid(RfText.EndRotLabel);
                return;
            }
            if (!useMarker && !RfUi.TryParse(_natural.Text, out natural))
            {
                _error.Text = RfText.NaturalLabel + ": ?";
                return;
            }
            if (!RfUi.TryParse(_offset.Text, out offset))
            {
                _error.Text = RfText.OffsetLabel(RfUnits.LengthLabel(_doc)) + ": ?";
                return;
            }

            Options = new RfEndSymbolOptions
            {
                Symbol = useMarker ? null : s,
                UseMarker = useMarker,
                Marker = SelectedMarkerStyle(),
                MarkerSizeMm = markerSize,
                Place = _start.IsChecked == true ? RfPlaceMode.StartOnly : _end.IsChecked == true ? RfPlaceMode.EndOnly : RfPlaceMode.Both,
                AutoOrient = _fixed.IsChecked != true,
                StartRotationDeg = startRot,
                EndRotationDeg = endRot,
                SymbolNaturalDeg = natural,
                OffsetFt = RfUnits.ProjectToMm(_doc, offset) / RfTol.MmPerFoot,
                IncludeHooks = _hooks.IsChecked == true,
                BarSet = SelectedBarSet(),
                AllowDuplicates = _dups.IsChecked == true,
            };
            DialogResult = true;
        }
    }
}
