using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using RevitMcpAddin.AutoAnnotate.Core;

namespace RevitMcpAddin.AutoAnnotate
{
    /// <summary>
    /// Арматурын горимын ТОХИРГОО — хоёр таб (нэг тохиргооны объект, давхар хайрцаггүй):
    ///   • <see cref="TagsTab"/> «Дам нурууны арматурын хэмжээс» (2026-10-08-аас; өмнө «Арматур (огтлол, дэлгээс)»): аль гишүүнд ажиллах, шошгоны төрөл, олонлог бүрд нэг шошго, гишүүнээс шошго хүртэлх зай, шошго хоорондын зай.
    ///   • <see cref="DimsTab"/> «Баганын арматурын хэмжээс»: огтлолын хомутын гинж, дэлгээсийн хомутын MRA / давхцал / тэнхлэг (багана = түвшин)-ийн гинж, хэмжээсийн зай,
    ///     хомутын хэмжээс хүртэлх зай.  Дам нуруу, багана хоёуланд ИЖИЛ — хэмжээсийн ТӨРӨЛ нь цонхны дээд талын НЭГ сонголт (бүх хэмжээсэд).
    /// «Үндсэн шошго» хэсэгт хэрэглэгчийн оруулсан мм л шошгоны зай болно — хэрэгсэл өөрөөсөө зай нэмэхгүй.  Сонголт %APPDATA%\RevitMcpAddin\auto-annotate.json-д.
    /// </summary>
    internal sealed class AaRebarPanel
    {
        private readonly AaRebarInfo _info;
        private readonly AaRebarOptions _o;
        private readonly string _hostWord;

        private readonly CheckBox _enabled, _onlySel, _singleSet, _multiLeader, _mergeLeader;
        private readonly CheckBox _secDims, _secTagLong, _secTagStir, _secGroup, _left, _right, _top, _bottom;
        private readonly RadioButton _inner, _outer, _center;
        private readonly AaPlacementBlock _secPlace;
        private readonly CheckBox _eTags, _eMra, _eLaps, _eSpans, _secMember;
        private readonly ComboBox _barTag = new ComboBox { MinWidth = 300 };
        private readonly ComboBox _stirTag = new ComboBox { MinWidth = 300 };
        private readonly ComboBox _mra = new ComboBox { MinWidth = 300 };
        private readonly TextBox _hostOffset = Num(), _tagGap = Num(), _dimPitch = Num(), _stirDimOffset = Num();
        private readonly TextBox _secDimOffset, _secStep;
        private readonly TextBox _leaderLanding = Num(), _leaderRun = Num();
        private readonly TextBlock _msgTags = Msg(), _msgDims = Msg();

        /// <summary>Эхний нарийвчилсан табын нэр (эзний хүсэлт 2026-10-08: «Арматур (огтлол, дэлгээс)» → «Дам нурууны арматурын хэмжээс»).</summary>
        public const string TagsTabHeader = "Дам нурууны арматурын хэмжээс";

        /// <summary>Огтлолын «Байрлал» блок — цонх үүнийг ерөнхий «Байрлал»-тай холбоно (<see cref="AaPlacementBlock.Link"/>).</summary>
        public AaPlacementBlock Placement { get { return _secPlace; } }

        public ScrollViewer TagsTab { get; private set; }
        public ScrollViewer DimsTab { get; private set; }

        /// <summary>«Арматур» табын агуулга — цонх «Бас ерөнхий хэмжээс» хэсгийг (өөр тохиргоо) доор нь залгана.</summary>
        public StackPanel TagsBody { get; private set; }

        public AaRebarPanel(AaRebarInfo info, AaRebarOptions saved)
        {
            _info = info;
            _o = (saved ?? new AaRebarOptions()).Clone();
            _hostWord = AaPlacement.HostWord(info.BeamHosts, info.ColumnHosts);

            // ══ Таб 1: Дам нурууны арматурын хэмжээс (өмнө «Арматур (огтлол, дэлгээс)») ══
            var tags = new StackPanel { Margin = new Thickness(2, 0, 8, 6) };
            tags.Children.Add(_msgTags);

            tags.Children.Add(Mute(new TextBlock
            {
                Text = "Олдсон: " + HostsText(info) + " · " + info.Rebars + " арматур",
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 4, 0, 0),
            }));
            string selText = SelectionText(info);
            if (selText != null)
            {
                var sel = Mute(new TextBlock { Text = selText, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 2, 0, 0) });
                if (info.SelectedInvalid + info.SelectedLinked + info.SelectedNotInView > 0)
                    sel.SetResourceReference(TextBlock.ForegroundProperty, "Warn");
                tags.Children.Add(sel);
            }

            _enabled = new CheckBox
            {
                Content = "Арматурын горимоор ажиллах (энэ харагдацын дам нуруу, баганыг огтлол/дэлгээсээр автоматаар таних)",
                IsChecked = _o.Enabled,
                Margin = new Thickness(0, 8, 0, 2),
                FontWeight = FontWeights.SemiBold,
            };
            tags.Children.Add(_enabled);
            _onlySel = new CheckBox
            {
                Content = info.SelectedValid > 0
                    ? "Зөвхөн сонгосон " + info.SelectedValid + " дам нуруу/багана дээр"
                    : "Зөвхөн сонгосон дам нуруу/багана дээр (хүчинтэй сонголт алга)",
                IsChecked = info.SelectedValid > 0 && _o.OnlySelectedHosts,
                IsEnabled = info.SelectedValid > 0,
                Margin = new Thickness(18, 2, 0, 2),
                ToolTip = "Харагдацын бүх гишүүнийг биш, зөвхөн сонгосон арматур агуулах дам нуруу/багана дээр тавина.",
            };
            tags.Children.Add(_onlySel);

            tags.Children.Add(Section("Үндсэн шошго"));
            tags.Children.Add(Row("Ажлын арматурын шошго:", _barTag));
            Fill(_barTag, info.BarTagTypes, _o.BarTagTypeUid.Length > 0 ? _o.BarTagTypeUid : info.DefaultBarTagUid, null);
            tags.Children.Add(Row("Хомутын шошго (огтлол):", _stirTag));
            Fill(_stirTag, info.BarTagTypes, _o.StirrupTagTypeUid, "(үндсэн шошгоор)");
            tags.Children.Add(Row("Хомутын MRA — алхам + шошго (дэлгээс):", _mra));
            Fill(_mra, info.MraTypes, _o.MraTypeUid.Length > 0 ? _o.MraTypeUid : info.DefaultMraUid, null);

            var stir = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 4, 0, 2) };
            stir.Children.Add(Lbl(_hostWord + " хомутын MRA (multi rebar tag) хүртэл:"));
            _stirDimOffset.Text = Fmt(_o.StirrupDimOffsetMm);
            _stirDimOffset.ToolTip = "Гишүүний ирмэгээс хомутын MRA-ийн хэмжээсийн шугам хүртэл.  0 = автомат (бусад эгнээний ард давхарлаж тавина).";
            stir.Children.Add(_stirDimOffset);
            stir.Children.Add(Lbl("мм (цаас; 0 = автомат)"));
            tags.Children.Add(stir);
            tags.Children.Add(Mute(new TextBlock
            {
                Text = "0-ээс их утга оруулбал MRA (multi rebar tag)-ийн хэмжээсийн шугам дам нуруу/баганын ирмэгээс ЯГ тэр зайд тавигдана (шошго нь шугамаас гадагш).  "
                    + "Энэ зай доод талын арматурын шошго/давхцлын эгнээнээс ойр бол MRA гишүүнд хамгийн ойр эгнээ болж, тэдгээр нь MRA-ийн гадна зөөгдөнө — давхцахгүй.  0 = автомат (бусад эгнээний ард).",
                TextWrapping = TextWrapping.Wrap,
            }));

            _singleSet = Check("Арматурын багцыг (Rebar set) нэг шошгоор тэмдэглэх", _o.SingleTagPerSet);
            _singleSet.ToolTip = "Олон ширхэгтэй НЭГ арматурын элемент (Rebar set) бүрд ЯГ НЭГ шошго тавина — ширхэг бүрд биш.  Унтраавал өмнөх зан төлөв.";
            tags.Children.Add(_singleSet);
            _multiLeader = Check("Багцын БҮХ харагдаж буй ширхэг рүү нэг шошгоор leader татах (multi tag)", _o.MultiLeaderPerSet);
            _multiLeader.Margin = new Thickness(18, 2, 0, 2);
            _multiLeader.ToolTip = "Нэг шошго багцын ширхэг бүрийг (огтлол дээрх цэг бүрийг) заана.  Унтраавал шошго зөвхөн нэг ширхэг рүү заана.";
            tags.Children.Add(_multiLeader);
            _mergeLeader = Check("Leader-үүдийг нэгтгэх (Merge leader)", _o.MergeLeaders);
            _mergeLeader.Margin = new Thickness(36, 2, 0, 2);
            _mergeLeader.ToolTip = "Олон leader-ийг нэг үндсэн шугам болгон нэгтгэнэ (Revit-ийн Merge Elbows).  Хэрэв Revit энэ шошгонд дэмжихгүй бол тайланд тэмдэглэнэ.";
            tags.Children.Add(_mergeLeader);
            Action syncSet = () =>
            {
                bool on = _singleSet.IsChecked == true;
                _multiLeader.IsEnabled = on;
                _mergeLeader.IsEnabled = on && _multiLeader.IsChecked == true;
            };
            _singleSet.Checked += (s, e) => syncSet();
            _singleSet.Unchecked += (s, e) => syncSet();
            _multiLeader.Checked += (s, e) => syncSet();
            _multiLeader.Unchecked += (s, e) => syncSet();
            syncSet();
            _secGroup = Check("Ижил дугаартай арматурын элементүүдийг нэг шошгоор (огтлол)", _o.SecGroupTags);
            tags.Children.Add(_secGroup);

            var gaps = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 6, 0, 2) };
            gaps.Children.Add(Lbl(_hostWord + " шошго хүртэл:"));
            _hostOffset.Text = Fmt(_o.TagOffsetMm);
            gaps.Children.Add(_hostOffset);
            gaps.Children.Add(Lbl("мм,  шошго хоорондын зай:"));
            _tagGap.Text = Fmt(_o.TagGapMm);
            gaps.Children.Add(_tagGap);
            gaps.Children.Add(Lbl("мм (цаас)"));
            tags.Children.Add(gaps);
            tags.Children.Add(Mute(new TextBlock
            {
                Text = "Шошго хоорондын зай нь хөрш шошгоны ХАРАГДАХ хажуугийн зай — яг таны оруулсан утга (хэрэгсэл өөрөөсөө нэмэхгүй).",
                TextWrapping = TextWrapping.Wrap,
            }));

            // Leader-ийн ГУРВАН цэг: 1 = арматур, 2 = elbow (хугарал), 3 = шошго.
            tags.Children.Add(Section("Leader-ийн зай (3 цэг: 1 арматур · 2 хугарал · 3 шошго)"));
            var leader = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 4, 0, 2) };
            leader.Children.Add(Lbl("Шошгоноос хугарал хүртэл (3→2):"));
            _leaderLanding.Text = Fmt(_o.LeaderLandingMm);
            _leaderLanding.ToolTip = "Шошгоны ирмэгээс хугарал (elbow) хүртэлх ХЭВТЭЭ хэсгийн урт.  0 = Revit-ийн автомат.";
            leader.Children.Add(_leaderLanding);
            leader.Children.Add(Lbl("мм,  хугарлаас арматур хүртэл (2→1):"));
            _leaderRun.Text = Fmt(_o.LeaderRunMm);
            _leaderRun.ToolTip = "Хугарлаас арматур хүртэлх налуу хэсгийн ХЭВТЭЭ зай.  0 = Revit-ийн автомат.";
            leader.Children.Add(_leaderRun);
            leader.Children.Add(Lbl("мм (цаас; 0 = автомат)"));
            tags.Children.Add(leader);
            tags.Children.Add(Mute(new TextBlock
            {
                Text = "Хоёр зайг ХОЁУЛАНГ нь заавал шошго хэвтээ чиглэлд зөөгдөж, «шошго хүртэлх зай»-г дарна (хоёр зайг яг биелүүлэх цорын ганц арга). Нэгийг л заавал шошго хөдлөхгүй, хугарал л шилжинэ. Шошго нягт эгнээнд байвал хоёуланг заахад давхцаж болно.",
                TextWrapping = TextWrapping.Wrap,
            }));

            tags.Children.Add(Section("Аль шошгыг тавих"));
            _secTagLong = Check("Огтлол: ажлын арматурын шошго", _o.SecTagLong);
            _secTagStir = Check("Огтлол: хомутын шошго", _o.SecTagStirrups);
            _eTags = Check("Дэлгээс: ажлын арматурын шошго (дээд/доод эсвэл хажуу талд)", _o.ElevTagBars);
            foreach (CheckBox c in new[] { _secTagLong, _secTagStir, _eTags }) tags.Children.Add(c);

            // ══ Таб 2: Баганын арматурын хэмжээс ══════════════════════════════
            var dims = new StackPanel { Margin = new Thickness(2, 0, 8, 6) };
            dims.Children.Add(_msgDims);
            dims.Children.Add(Mute(new TextBlock
            {
                Text = "Дам нуруу, баганад ИЖИЛ ажиллана (багана: огтлол — план дээр, дэлгээс — босоо харагдацад).  Хэмжээсийн төрлийг цонхны дээд талын НЭГ сонголтоор өгнө — бүх хэмжээсэд (хомутын MRA-ийн хэмжээс ч) хамаарна.",
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 4, 0, 0),
            }));

            dims.Children.Add(Section("Огтлол — хомутын гинжин хэмжээс" + (info.SectionHosts == 0 ? "   (энэ харагдацад огтлол алга)" : "")));
            _secDims = Check("Хомутаас бетон хүрээ хүртэл гинжин хэмжээс («30 | 240 | 30»)", _o.SecDims);
            dims.Children.Add(_secDims);
            var refRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 4, 0, 2) };
            refRow.Children.Add(Lbl("Хомутын ирмэг:"));
            _inner = new RadioButton { Content = "Дотор", IsChecked = _o.StirrupRef == "inner", Margin = new Thickness(8, 0, 0, 0), ToolTip = "Гараар «30 | 240 | 30» гэж зурдаг бол энэ." };
            _outer = new RadioButton { Content = "Гадна", IsChecked = _o.StirrupRef == "outer", Margin = new Thickness(12, 0, 0, 0) };
            _center = new RadioButton { Content = "Тэнхлэг", IsChecked = _o.StirrupRef == "center", Margin = new Thickness(12, 0, 0, 0) };
            if (_inner.IsChecked != true && _outer.IsChecked != true && _center.IsChecked != true) _inner.IsChecked = true;
            refRow.Children.Add(_inner);
            refRow.Children.Add(_outer);
            refRow.Children.Add(_center);
            dims.Children.Add(refRow);
            var sides = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 4, 0, 2) };
            sides.Children.Add(Lbl("Хамгаалалт хэмжих тал:"));
            _left = SideCheck("Зүүн", _o.Left);
            _right = SideCheck("Баруун", _o.Right);
            _top = SideCheck("Дээд", _o.Top);
            _bottom = SideCheck("Доод", _o.Bottom);
            foreach (CheckBox c in new[] { _left, _right, _top, _bottom }) sides.Children.Add(c);
            dims.Children.Add(sides);

            // «Байрлал» — ерөнхий хэмжээсийн «Байрлал»-тай ИЖИЛ (2026-10-09, R2.pdf): 4 талд / зөвхөн зүүн ба доод; элементээс эхний гинж; гинж хооронд.
            // Хомутын гинж эхний эгнээнд, гишүүний гадна гинж (тэнхлэг, хана, хучилт) түүнээс «гинж хооронд»-оор цааш; шошго тэдгээрээс цааш.
            _secPlace = new AaPlacementBlock("aa-sec-place", "4 талд", "Элементээс", _o.SecAllSides, _o.SecRightSide, _o.SecDimOffsetMm, _o.SecStepMm,
                "Огтлолын хэвтээ хэмжээс доор (4 талд бол дээр ч), босоо хэмжээс зүүн эсвэл баруун (4 талд бол хоёуланд) талд.  Зай нь цаасан мм — масштабаас үл хамааран ижил харагдана.");
            _secDimOffset = _secPlace.First;
            _secStep = _secPlace.Step;
            dims.Children.Add(_secPlace.Panel);
            _secMember = Check("Гишүүний хэмжээсийг тэнхлэг, хана, хучилттай уялдуулах — гадна гинж («150 | 150», «170 | 330»)", _o.SecMemberDims);
            _secMember.ToolTip = "Дам нуруу/баганын огтлол дээр хомутын гинжний гадна: хэвтээ — нүүр | тэнхлэг | нүүр; босоо — дээд нүүр | хучилтын доод | доод нүүр; "
                + "шүргэлцсэн хана байвал ханын нүүр ч орно.  Хомутын гинжээс «Байрлал»-ын «гинж хооронд»-оор цааш, ижил тал(ууд)-д.";
            dims.Children.Add(_secMember);

            dims.Children.Add(Section("Дэлгээс — дам нуруу (хэвтээ), багана (босоо)" + (info.ElevationHosts == 0 ? "   (энэ харагдацад дэлгээс алга)" : "")));
            _eMra = Check("Хомутын MRA — алхамын хэмжээс + шошго", _o.ElevMra);
            _eLaps = Check("Бэхэлгээ/давхцлын хэмжээс (арматурын төгсгөл хоорондын)", _o.ElevLaps);
            _eSpans = Check("Гинж ба нийт хэмжээ: дам нуруу — тэнхлэг, багана — давхрын түвшин", _o.ElevSpans);
            foreach (CheckBox c in new[] { _eMra, _eLaps, _eSpans }) dims.Children.Add(c);

            var pitch = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 8, 0, 2) };
            pitch.Children.Add(Lbl("Дэлгээс: хэмжээсийн эгнээ хоорондын зай:"));
            _dimPitch.Text = Fmt(_o.DimPitchMm);
            pitch.Children.Add(_dimPitch);
            pitch.Children.Add(Lbl("мм (цаас)"));
            dims.Children.Add(pitch);

            HookQuick();
            TagsBody = tags;
            TagsTab = new ScrollViewer { Content = tags, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
            DimsTab = new ScrollViewer { Content = dims, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };

            // Шууд шалгалт: буруу утга оруулмагц улаан тайлбар (OK дарахыг хүлээхгүй).
            foreach (TextBox t in new[] { _hostOffset, _tagGap, _dimPitch, _secDimOffset, _secStep, _stirDimOffset, _leaderLanding, _leaderRun })
                t.TextChanged += (s, e) => Revalidate();
            _enabled.Checked += (s, e) => Revalidate();
            _enabled.Unchecked += (s, e) => Revalidate();
            Revalidate();
        }

        // ── «Түргэн» таб (шошго ✓ / хэмжээс ✓) ──────────────────────────────
        // Ганц үнэн: доорх нарийвчилсан чагтууд.  «Түргэн» таб тэдгээрийг л нэг дор удирдана (давхар төлөв ҮГҮЙ).

        /// <summary>Нарийвчилсан чагт өөрчлөгдөх бүрд (түргэн табын хоёр чагтыг шинэчлэхэд).</summary>
        public event System.EventHandler QuickChanged;

        /// <summary>Шошго тавих чагтуудын ядаж нэг нь асаалттай (огтлолын ажлын/хомутын шошго, дэлгээсийн шошго).</summary>
        public bool AnyTags { get { return _secTagLong.IsChecked == true || _secTagStir.IsChecked == true || _eTags.IsChecked == true; } }

        /// <summary>Хэмжээс тавих чагтуудын ядаж нэг нь асаалттай (хомутын гинж, давхцал, тэнхлэг/түвшний гинж).</summary>
        public bool AnyDims { get { return _secDims.IsChecked == true || _eLaps.IsChecked == true || _eSpans.IsChecked == true; } }

        /// <summary>MRA (хомутын алхмын хэмжээс + шошго нэг дор) — шошго БА хэмжээс хоёулаа сонгогдсон үед л.</summary>
        public bool MraOn { get { return _eMra.IsChecked == true; } }

        public void SetTags(bool on)
        {
            _secTagLong.IsChecked = on;
            _secTagStir.IsChecked = on;
            _eTags.IsChecked = on;
        }

        public void SetDims(bool on)
        {
            _secDims.IsChecked = on;
            _eLaps.IsChecked = on;
            _eSpans.IsChecked = on;
        }

        public void SetMra(bool on)
        {
            _eMra.IsChecked = on;
        }

        /// <summary>«Гишүүний хэмжээсийг тэнхлэг, хана, хучилттай уялдуулах» (огтлол) — «Түргэн» табын тусдаа чагт энийг шууд удирдана.</summary>
        public bool MemberDims
        {
            get { return _secMember.IsChecked == true; }
            set { _secMember.IsChecked = value; }
        }

        private void HookQuick()
        {
            foreach (CheckBox c in new[] { _secTagLong, _secTagStir, _eTags, _secDims, _eLaps, _eSpans, _eMra, _secMember })
            {
                c.Checked += (s, e) => RaiseQuick();
                c.Unchecked += (s, e) => RaiseQuick();
            }
        }

        private void RaiseQuick()
        {
            System.EventHandler h = QuickChanged;
            if (h != null) h(this, System.EventArgs.Empty);
        }

        // ── Мэдээлэл ────────────────────────────────────────────────────

        private static string HostsText(AaRebarInfo info)
        {
            var parts = new List<string>();
            if (info.BeamHosts > 0) parts.Add(info.BeamHosts + " дам нуруу");
            if (info.ColumnHosts > 0) parts.Add(info.ColumnHosts + " багана");
            string hosts = parts.Count > 0 ? string.Join(", ", parts) : "арматурын гишүүн алга";
            return hosts + " (огтлол " + info.SectionHosts + ", дэлгээс " + info.ElevationHosts + ")";
        }

        /// <summary>Сонголтын дүн: хүчинтэй / хүчингүй / холбосон файл / энэ харагдацад таниагдаагүй.  Сонголт алга бол null.</summary>
        private static string SelectionText(AaRebarInfo info)
        {
            int total = info.SelectedValid + info.SelectedInvalid + info.SelectedLinked + info.SelectedNotInView;
            if (total == 0) return null;
            var parts = new List<string>();
            if (info.SelectedValid > 0) parts.Add(info.SelectedValid + " хүчинтэй");
            if (info.SelectedInvalid > 0) parts.Add(info.SelectedInvalid + " нь арматур агуулах дам нуруу/багана биш (алгасна)");
            if (info.SelectedLinked > 0) parts.Add(info.SelectedLinked + " холбосон файлын (link) элемент — дэмжигдэхгүй");
            if (info.SelectedNotInView > 0) parts.Add(info.SelectedNotInView + " нь энэ харагдацад огтлол/дэлгээсээр харагдахгүй");
            return "Сонгосон " + total + ": " + string.Join(" · ", parts);
        }

        // ── UI тусламж ─────────────────────────────────────────────────

        private static TextBox Num()
        {
            return new TextBox { Width = 52, TextAlignment = TextAlignment.Right, Margin = new Thickness(6, 0, 4, 0) };
        }

        private static TextBlock Msg()
        {
            var t = new TextBlock { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 4, 0, 0), Visibility = Visibility.Collapsed };
            t.SetResourceReference(TextBlock.ForegroundProperty, "Danger");
            return t;
        }

        private static string Fmt(double v)
        {
            return v.ToString("0.#", CultureInfo.InvariantCulture);
        }

        private static TextBlock Lbl(string t)
        {
            return new TextBlock { Text = t, VerticalAlignment = VerticalAlignment.Center };
        }

        private static CheckBox Check(string text, bool on)
        {
            return new CheckBox { Content = text, IsChecked = on, Margin = new Thickness(0, 3, 0, 3) };
        }

        private static CheckBox SideCheck(string text, bool on)
        {
            return new CheckBox { Content = text, IsChecked = on, Margin = new Thickness(8, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center };
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
            var d = new DockPanel { Margin = new Thickness(0, 4, 0, 2) };
            var l = Lbl(label);
            l.Margin = new Thickness(0, 0, 8, 0);
            l.MinWidth = 210;
            d.Children.Add(l);
            d.Children.Add(box);
            return d;
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

        // ── Шалгалт ба буцаах ───────────────────────────────────────

        private AaPlacement ReadPlacement(out bool allParsed)
        {
            allParsed = true;
            var p = new AaPlacement();
            double v;
            if (AaPlacement.TryParseMm(_hostOffset.Text, 0, AaPlacement.HostOffsetMax, out v)) p.HostOffsetMm = v; else { allParsed = false; p.HostOffsetMm = double.NaN; }
            if (AaPlacement.TryParseMm(_tagGap.Text, 0, AaPlacement.TagGapMax, out v)) p.TagGapMm = v; else { allParsed = false; p.TagGapMm = double.NaN; }
            if (AaPlacement.TryParseMm(_dimPitch.Text, AaPlacement.DimPitchMin, AaPlacement.DimPitchMax, out v)) p.DimPitchMm = v; else { allParsed = false; p.DimPitchMm = double.NaN; }
            if (AaPlacement.TryParseMm(_secDimOffset.Text, AaPlacement.SectionDimOffsetMin, AaPlacement.SectionDimOffsetMax, out v)) p.SectionDimOffsetMm = v; else { allParsed = false; p.SectionDimOffsetMm = double.NaN; }
            if (AaPlacement.TryParseMm(_stirDimOffset.Text, 0, AaPlacement.StirrupDimOffsetMax, out v)) p.StirrupDimOffsetMm = v; else { allParsed = false; p.StirrupDimOffsetMm = double.NaN; }
            if (AaPlacement.TryParseMm(_leaderLanding.Text, 0, AaPlacement.LeaderMax, out v)) p.LeaderLandingMm = v; else { allParsed = false; p.LeaderLandingMm = double.NaN; }
            if (AaPlacement.TryParseMm(_leaderRun.Text, 0, AaPlacement.LeaderMax, out v)) p.LeaderRunMm = v; else { allParsed = false; p.LeaderRunMm = double.NaN; }
            return p;
        }

        private void Revalidate()
        {
            Show(_msgTags, ValidateTags());
            Show(_msgDims, ValidateDims());
        }

        /// <summary>«Арматур» таб: гишүүнээс шошго хүртэл, шошго хоорондын зай.</summary>
        private string ValidateTags()
        {
            if (_enabled.IsChecked != true) return null;
            bool ok;
            AaPlacement p = ReadPlacement(out ok);
            // Нөгөө таб дээрх утгуудыг энд шалгахгүй — тэдгээрийг хүчинтэй өгөгдмөлөөр орлуулна.
            p.DimPitchMm = AaPlacement.DimPitchMin;
            p.SectionDimOffsetMm = AaPlacement.SectionDimOffsetMin;
            return p.Validate(_hostWord, false);
        }

        /// <summary>«Баганын арматурын хэмжээс» таб: хэмжээсийн зай, хомутын хэмжээс хүртэл, огтлолын тал.</summary>
        private string ValidateDims()
        {
            if (_enabled.IsChecked != true) return null;
            bool ok;
            AaPlacement p = ReadPlacement(out ok);
            p.HostOffsetMm = 0;
            p.TagGapMm = 0;
            p.StirrupDimOffsetMm = 0;
            p.LeaderLandingMm = 0;
            p.LeaderRunMm = 0;
            string bad = p.Validate(_hostWord, _info.SectionHosts > 0);
            if (bad != null) return bad;
            double step;
            if (_info.SectionHosts > 0 && !AaPlacement.TryParseMm(_secStep.Text, AaPlacement.DimPitchMin, AaPlacement.DimPitchMax, out step))
                return "Огтлолын «гинж хооронд» " + AaPlacement.DimPitchMin + "–" + AaPlacement.DimPitchMax + " мм байна.";
            if (_info.SectionHosts > 0 && _secDims.IsChecked == true && _left.IsChecked != true && _right.IsChecked != true && _top.IsChecked != true && _bottom.IsChecked != true)
                return "Огтлолын хэмжээсэд ядаж нэг тал (зүүн/баруун/дээд/доод) сонгоно уу.";
            return null;
        }

        private static void Show(TextBlock t, string text)
        {
            t.Text = text == null ? "" : "⚠ " + text;
            t.Visibility = text == null ? Visibility.Collapsed : Visibility.Visible;
        }

        /// <summary>null = зөв; үгүй бол алдааны мессеж.</summary>
        public string Validate()
        {
            return ValidateTags() ?? ValidateDims();
        }

        public AaRebarOptions ToOptions()
        {
            AaRebarOptions o = _o.Clone();
            o.Enabled = _enabled.IsChecked == true;
            o.OnlySelectedHosts = _onlySel.IsEnabled && _onlySel.IsChecked == true;
            o.SingleTagPerSet = _singleSet.IsChecked == true;
            o.MultiLeaderPerSet = _multiLeader.IsChecked == true;
            o.MergeLeaders = _mergeLeader.IsChecked == true;
            o.BarTagTypeUid = Uid(_barTag);
            o.StirrupTagTypeUid = Uid(_stirTag);
            o.MraTypeUid = Uid(_mra);
            double v;
            if (AaPlacement.TryParseMm(_hostOffset.Text, 0, AaPlacement.HostOffsetMax, out v)) o.TagOffsetMm = v;
            if (AaPlacement.TryParseMm(_tagGap.Text, 0, AaPlacement.TagGapMax, out v)) o.TagGapMm = v;
            if (AaPlacement.TryParseMm(_dimPitch.Text, AaPlacement.DimPitchMin, AaPlacement.DimPitchMax, out v)) o.DimPitchMm = v;
            if (AaPlacement.TryParseMm(_secDimOffset.Text, AaPlacement.SectionDimOffsetMin, AaPlacement.SectionDimOffsetMax, out v)) o.SecDimOffsetMm = v;
            if (AaPlacement.TryParseMm(_secStep.Text, AaPlacement.DimPitchMin, AaPlacement.DimPitchMax, out v)) o.SecStepMm = v;
            if (AaPlacement.TryParseMm(_stirDimOffset.Text, 0, AaPlacement.StirrupDimOffsetMax, out v)) o.StirrupDimOffsetMm = v;
            if (AaPlacement.TryParseMm(_leaderLanding.Text, 0, AaPlacement.LeaderMax, out v)) o.LeaderLandingMm = v;
            if (AaPlacement.TryParseMm(_leaderRun.Text, 0, AaPlacement.LeaderMax, out v)) o.LeaderRunMm = v;
            // Энэ харагдацад байхгүй (огтлол/дэлгээс алга) бүлгийн сонголтыг өөрчлөхгүй — хадгалсан утга хэвээр.
            if (_info.SectionHosts > 0)
            {
                o.SecDims = _secDims.IsChecked == true;
                o.SecTagLong = _secTagLong.IsChecked == true;
                o.SecTagStirrups = _secTagStir.IsChecked == true;
                o.SecGroupTags = _secGroup.IsChecked == true;
                o.StirrupRef = _outer.IsChecked == true ? "outer" : _center.IsChecked == true ? "center" : "inner";
                o.Left = _left.IsChecked == true;
                o.Right = _right.IsChecked == true;
                o.Top = _top.IsChecked == true;
                o.Bottom = _bottom.IsChecked == true;
                o.SecAllSides = _secPlace.IsAllSides;
                o.SecRightSide = _secPlace.IsRightSide;
                o.SecMemberDims = _secMember.IsChecked == true;
            }
            if (_info.ElevationHosts > 0)
            {
                o.ElevTagBars = _eTags.IsChecked == true;
                o.ElevMra = _eMra.IsChecked == true;
                o.ElevLaps = _eLaps.IsChecked == true;
                o.ElevSpans = _eSpans.IsChecked == true;
            }
            return o;
        }
    }
}
