using System.Collections.Generic;
using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using RevitMcpAddin.AutoAnnotate.Core;

namespace RevitMcpAddin.AutoAnnotate
{
    /// <summary>
    /// «Хана, хучилт» таб: хана, хучилт (шал/хавтан) дээрх арматурын ОЛОНЛОГ бүрд — хэрэглэгч ТУС ТУСАД НЬ чагтална (2026-10-08, эзний хүсэлт №3):
    ///   • MRT (multi rebar tag — алхамын хэмжээс + шошго): хэмжээсийн шугам ХАНА/ХУЧИЛТЫН биш, харагдаж буй АРМАТУРЫН хамгийн гаднах цэгээс мм-ээр (<see cref="AaWallSlab"/>);
    ///   • шошго (rebar tag) — олонлог бүрд нэг, MRT-тэй хамт бол эсрэг талд;
    ///   • ерөнхий хэмжээс — хана/хучилтын нийт урт, өндөр/өргөн;
    ///   • зөрүүлэг (давхцал) харагдвал олонлогуудын үргэлжилсэн (гинжин) хэмжээс.
    /// </summary>
    internal sealed class AaWallSlabPanel
    {
        private readonly AaWallSlabInfo _info;
        private readonly AaWallSlabOptions _o;
        private readonly CheckBox _enabled, _walls, _floors, _onlySel, _flip, _mraOn, _tagsOn, _overallOn, _chainOn;
        private readonly ComboBox _mra = new ComboBox { MinWidth = 300 };
        private readonly ComboBox _tag = new ComboBox { MinWidth = 300 };
        private readonly TextBox _offset = Num(), _gap = Num();
        private readonly TextBox _overallOffset, _overallStep;
        private readonly AaPlacementBlock _overallPlace;

        /// <summary>Ерөнхий хэмжээсийн «Байрлал» блок — цонх үүнийг ерөнхий «Байрлал»-тай холбоно (<see cref="AaPlacementBlock.Link"/>).</summary>
        public AaPlacementBlock Placement { get { return _overallPlace; } }
        private readonly TextBlock _msg = new TextBlock { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 4, 0, 0), Visibility = Visibility.Collapsed };
        private readonly StackPanel _mraBox = new StackPanel { Margin = new Thickness(22, 0, 0, 4) };
        private readonly StackPanel _tagBox = new StackPanel { Margin = new Thickness(22, 0, 0, 4) };
        private readonly StackPanel _overallBox = new StackPanel { Margin = new Thickness(22, 0, 0, 4) };

        public ScrollViewer Tab { get; private set; }

        /// <summary>Табын агуулга — цонх «Бас ерөнхий хэмжээс» хэсгийг (арматурын дам нуруу/багана байхгүй үед) доор нь залгана.</summary>
        public StackPanel Body { get; private set; }

        public AaWallSlabPanel(AaWallSlabInfo info, AaRebarInfo rebarInfo, AaWallSlabOptions saved, string rebarMraUid, string rebarTagUid)
        {
            _info = info;
            _o = (saved ?? new AaWallSlabOptions()).Clone();
            _msg.SetResourceReference(TextBlock.ForegroundProperty, "Danger");

            var body = new StackPanel { Margin = new Thickness(2, 0, 8, 6) };
            body.Children.Add(_msg);
            body.Children.Add(Mute(new TextBlock
            {
                Text = "Олдсон: " + info.Walls + " хана, " + info.Floors + " хучилт · " + info.Sets + " арматурын багц (≥ 2 ширхэг, энэ харагдацад харагдаж буй).",
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 4, 0, 0),
            }));
            // Багц олдоогүй ч таб НУУГДАХГҮЙ — шалтгааныг хэлнэ (өмнө нь таб чимээгүй алга болдог байв).
            string why = info.NoWorkReason;
            if (why != null)
            {
                var warn = new TextBlock { Text = "⚠ " + why, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 4, 0, 2) };
                warn.SetResourceReference(TextBlock.ForegroundProperty, "Warn");
                body.Children.Add(warn);
                if (info.HostsWithRebar > 0)
                    body.Children.Add(Mute(new TextBlock
                    {
                        Text = "Арматуртай хана/хучилт: " + info.HostsWithRebar + " (үүнээс зөвхөн ганц ширхэгтэй: " + info.HostsOnlySingleBars + ").  Харагдацын арматурын нийт тоо: " + info.VisibleRebars + ".",
                        TextWrapping = TextWrapping.Wrap,
                    }));
                body.Children.Add(Mute(new TextBlock
                {
                    Text = "Доорх тохиргоо хадгалагдана — багц олдсон харагдац дээр ажиллана.",
                    TextWrapping = TextWrapping.Wrap,
                }));
            }

            _enabled = new CheckBox
            {
                Content = "Хана, хучилтын арматурыг тэмдэглэх (доор сонгосон зүйлсийг тавина)",
                IsChecked = _o.Enabled,
                Margin = new Thickness(0, 8, 0, 2),
                FontWeight = FontWeights.SemiBold,
            };
            body.Children.Add(_enabled);
            _walls = Check("Хана", _o.Walls, 18);
            _floors = Check("Хучилт (шал, хавтан)", _o.Floors, 18);
            body.Children.Add(_walls);
            body.Children.Add(_floors);
            _onlySel = new CheckBox
            {
                Content = info.SelectedValid > 0
                    ? "Зөвхөн сонгосон " + info.SelectedValid + " хана/хучилт дээр"
                    : "Зөвхөн сонгосон хана/хучилт дээр (хүчинтэй сонголт алга)",
                IsChecked = info.SelectedValid > 0 && _o.OnlySelectedHosts,
                IsEnabled = info.SelectedValid > 0,
                Margin = new Thickness(18, 2, 0, 2),
            };
            body.Children.Add(_onlySel);

            body.Children.Add(Section("Юуг тавих — тус бүрийг чагтлаж шийднэ"));

            // ── MRT
            _mraOn = Check("MRT (multi rebar tag) — алхамын хэмжээс + шошго, багц бүрд", _o.Mra, 0);
            _mraOn.FontWeight = FontWeights.SemiBold;
            body.Children.Add(_mraOn);
            _mraBox.Children.Add(Row("MRT төрөл:", _mra));
            Fill(_mra, rebarInfo.MraTypes, _o.MraTypeUid.Length > 0 ? _o.MraTypeUid : !string.IsNullOrEmpty(rebarMraUid) ? rebarMraUid : rebarInfo.DefaultMraUid, null);
            _mraBox.Children.Add(MmRow("Арматураас MRT-ийн хэмжээсийн шугам хүртэл:", _offset, _o.OffsetMm,
                "Олонлогийн хамгийн гаднах ХАРАГДАЖ БУЙ арматураас (ширхгийн төгсгөл) хэмжээсийн шугам хүртэл — хана/хучилтын ирмэгээс БИШ."));
            _mraBox.Children.Add(MmRow("Хэмжээсийн шугамаас шошго хүртэл:", _gap, _o.TagGapMm, null));
            body.Children.Add(_mraBox);

            // ── Шошго
            _tagsOn = Check("Шошго (rebar tag) — багц бүрд нэг (MRT-тэй хамт бол эсрэг талд)", _o.Tags, 0);
            _tagsOn.FontWeight = FontWeights.SemiBold;
            _tagsOn.Margin = new Thickness(0, 10, 0, 3);
            body.Children.Add(_tagsOn);
            _tagBox.Children.Add(Row("Шошгоны төрөл:", _tag));
            Fill(_tag, rebarInfo.BarTagTypes, _o.TagTypeUid.Length > 0 ? _o.TagTypeUid : !string.IsNullOrEmpty(rebarTagUid) ? rebarTagUid : rebarInfo.DefaultBarTagUid, null);
            _tagBox.Children.Add(Mute(new TextBlock
            {
                Text = "Сонгосон MRT төрөл өөрийн шошготой бол хоёуланг асаахад нэг багц хоёр шошготой болно.",
                TextWrapping = TextWrapping.Wrap,
            }));
            body.Children.Add(_tagBox);

            // ── Ерөнхий хэмжээс
            _overallOn = Check("Ерөнхий хэмжээс — хана/хучилтын нийт урт, өндөр (өргөн)", _o.Overall, 0);
            _overallOn.FontWeight = FontWeights.SemiBold;
            _overallOn.Margin = new Thickness(0, 10, 0, 3);
            body.Children.Add(_overallOn);
            // «Байрлал» — ерөнхий хэмжээсийн «Байрлал»-тай ИЖИЛ (2026-10-09, R2.pdf).
            _overallPlace = new AaPlacementBlock("aa-ws-overall", "4 талд", "Элементээс", _o.OverallAllSides, _o.OverallRightSide, _o.OverallOffsetMm, _o.OverallStepMm,
                "Хэвтээ ба босоо тэнхлэгт хамгийн захын хоёр нүүр хооронд.  Эхний гинж = хана/хучилтын ирмэгээс; тэр талд MRT/шошго цухуйж байвал тэдгээрээс «гинж хооронд»-оор цааш.");
            _overallOffset = _overallPlace.First;
            _overallStep = _overallPlace.Step;
            _overallBox.Children.Add(_overallPlace.Panel);
            body.Children.Add(_overallBox);

            // ── Үргэлжилсэн хэмжээс
            _chainOn = Check("Зөрүүлэг (давхцал) харагдвал үргэлжилсэн хэмжээс — «A-ийн урт | давхцал | B-ийн урт»", _o.LapChain, 0);
            _chainOn.FontWeight = FontWeights.SemiBold;
            _chainOn.Margin = new Thickness(0, 10, 0, 3);
            _chainOn.ToolTip = "Ижил давхаргын, хэсэгчлэн давхарласан хоёр (эсвэл олон) багцын төгсгөлүүдийг нэг гинжээр — нийлбэр нь арматурын нийт урт.  Шугам багцын хажууд.";
            body.Children.Add(_chainOn);

            _flip = Check("MRT-ийг эсрэг талд тавих (ерөнхий хэмжээсийн тал нь дээрх «Байрлал»-аар)", _o.Flip, 0);
            _flip.Margin = new Thickness(0, 12, 0, 3);
            body.Children.Add(_flip);
            body.Children.Add(Mute(new TextBlock
            {
                Text = "Зайг зөвхөн ХАРАГДАЖ БУЙ арматураас хэмжинэ: олонлог бүрийн хамгийн гадна ширхгээс шугам хүртэл яг таны оруулсан мм.  Харагдацад нуугдсан ширхэг тооцогдохгүй.",
                TextWrapping = TextWrapping.Wrap,
            }));

            Body = body;
            Tab = new ScrollViewer { Content = body, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
            foreach (TextBox t in new[] { _offset, _gap, _overallOffset, _overallStep }) t.TextChanged += (s, e) => Revalidate();
            foreach (CheckBox c in new[] { _enabled, _mraOn, _tagsOn, _overallOn, _chainOn, _walls, _floors })
            {
                c.Checked += (s, e) => Revalidate();
                c.Unchecked += (s, e) => Revalidate();
            }
            Revalidate();
        }

        private static TextBox Num() { return new TextBox { Width = 52, TextAlignment = TextAlignment.Right, Margin = new Thickness(6, 0, 4, 0) }; }

        private static string Fmt(double v) { return v.ToString("0.#", CultureInfo.InvariantCulture); }

        private static TextBlock Lbl(string t) { return new TextBlock { Text = t, VerticalAlignment = VerticalAlignment.Center }; }

        private static CheckBox Check(string text, bool on, double left)
        {
            return new CheckBox { Content = text, IsChecked = on, Margin = new Thickness(left, 3, 0, 3) };
        }

        private static TextBlock Section(string text)
        {
            return new TextBlock { Text = text, FontWeight = FontWeights.SemiBold, FontSize = 13, Margin = new Thickness(0, 12, 0, 4) };
        }

        private static TextBlock Mute(TextBlock t)
        {
            t.FontSize = 12;
            t.SetResourceReference(TextBlock.ForegroundProperty, "FgMuted");
            return t;
        }

        private static DockPanel Row(string label, ComboBox box)
        {
            var row = new DockPanel { Margin = new Thickness(0, 4, 0, 2) };
            var l = Lbl(label);
            l.Margin = new Thickness(0, 0, 8, 0);
            l.MinWidth = 120;
            row.Children.Add(l);
            row.Children.Add(box);
            return row;
        }

        private static StackPanel MmRow(string label, TextBox box, double value, string tip)
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 4, 0, 2) };
            row.Children.Add(Lbl(label));
            box.Text = Fmt(value);
            if (tip != null) box.ToolTip = tip;
            row.Children.Add(box);
            row.Children.Add(Lbl("мм (цаас)"));
            return row;
        }

        private static void Fill(ComboBox box, List<KeyValuePair<string, string>> items, string selectedUid, string emptyLabel)
        {
            int sel = 0;
            if (emptyLabel != null) box.Items.Add(new ComboBoxItem { Content = emptyLabel, Tag = "" });
            foreach (KeyValuePair<string, string> kv in items)
            {
                box.Items.Add(new ComboBoxItem { Content = kv.Value, Tag = kv.Key });
                if (kv.Key == selectedUid) sel = box.Items.Count - 1;
            }
            if (box.Items.Count == 0) box.Items.Add(new ComboBoxItem { Content = "(төрөл алга)", Tag = "", IsEnabled = false });
            box.SelectedIndex = sel;
        }

        private static string Uid(ComboBox box)
        {
            ComboBoxItem it = box.SelectedItem as ComboBoxItem;
            return it != null && it.Tag is string s ? s : "";
        }

        private AaWallSlabOptions Read(out bool parsed)
        {
            AaWallSlabOptions o = _o.Clone();
            o.Mra = _mraOn.IsChecked == true;
            o.Tags = _tagsOn.IsChecked == true;
            o.Overall = _overallOn.IsChecked == true;
            o.LapChain = _chainOn.IsChecked == true;
            parsed = true;
            double v;
            if (AaPlacement.TryParseMm(_offset.Text, 2, 60, out v)) o.OffsetMm = v; else { o.OffsetMm = double.NaN; parsed = false; }
            if (AaPlacement.TryParseMm(_gap.Text, 0, 40, out v)) o.TagGapMm = v; else { o.TagGapMm = double.NaN; parsed = false; }
            if (AaPlacement.TryParseMm(_overallOffset.Text, 2, 60, out v)) o.OverallOffsetMm = v; else { o.OverallOffsetMm = double.NaN; parsed = false; }
            if (AaPlacement.TryParseMm(_overallStep.Text, 2, 40, out v)) o.OverallStepMm = v; else { o.OverallStepMm = double.NaN; parsed = false; }
            o.OverallAllSides = _overallPlace.IsAllSides;
            o.OverallRightSide = _overallPlace.IsRightSide;
            return o;
        }

        private string ValidateText()
        {
            bool on = _enabled.IsChecked == true;
            _mraBox.IsEnabled = on && _mraOn.IsChecked == true;
            _tagBox.IsEnabled = on && _tagsOn.IsChecked == true;
            _overallBox.IsEnabled = on && _overallOn.IsChecked == true;
            if (!on) return null;
            if (_walls.IsChecked != true && _floors.IsChecked != true) return "Хана эсвэл хучилтын ядаж нэгийг сонгоно уу.";
            bool parsed;
            return Read(out parsed).Validate();
        }

        private void Revalidate()
        {
            string bad = ValidateText();
            _msg.Text = bad == null ? "" : "⚠ " + bad;
            _msg.Visibility = bad == null ? Visibility.Collapsed : Visibility.Visible;
        }

        /// <summary>null = зөв; үгүй бол алдааны мессеж.</summary>
        public string Validate() { return ValidateText(); }

        /// <summary>«Хана, хучилтын арматурыг тэмдэглэх» чагт (түргэн табаас удирдана).</summary>
        public bool Enabled
        {
            get { return _enabled.IsChecked == true; }
            set { _enabled.IsChecked = value; }
        }

        public AaWallSlabOptions ToOptions()
        {
            bool parsed;
            AaWallSlabOptions read = Read(out parsed);
            AaWallSlabOptions o = _o.Clone();
            o.Enabled = _enabled.IsChecked == true;
            o.Walls = _walls.IsChecked == true;
            o.Floors = _floors.IsChecked == true;
            o.OnlySelectedHosts = _onlySel.IsEnabled && _onlySel.IsChecked == true;
            o.Flip = _flip.IsChecked == true;
            o.Mra = read.Mra;
            o.Tags = read.Tags;
            o.Overall = read.Overall;
            o.LapChain = read.LapChain;
            o.OverallAllSides = read.OverallAllSides;
            o.OverallRightSide = read.OverallRightSide;
            o.MraTypeUid = Uid(_mra);
            o.TagTypeUid = Uid(_tag);
            if (parsed)
            {
                o.OffsetMm = read.OffsetMm;
                o.TagGapMm = read.TagGapMm;
                o.OverallOffsetMm = read.OverallOffsetMm;
                o.OverallStepMm = read.OverallStepMm;
            }
            return o;
        }
    }
}
