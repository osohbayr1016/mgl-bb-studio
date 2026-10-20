using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using Autodesk.Revit.DB;
using RevitMcpAddin.Ui.Core;

namespace RevitMcpAddin
{
    /// <summary>Диалогийн нэг параметрийн мөр (checkbox + нэр + утга).</summary>
    public sealed class SheetParamRow : INotifyPropertyChanged
    {
        private bool _include;
        private string _value = string.Empty;

        public string Name { get; set; }
        public List<string> Suggestions { get; set; } = new List<string>();

        public bool IncludeInNumber
        {
            get { return _include; }
            set
            {
                _include = value;
                PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(IncludeInNumber)));
            }
        }

        public string Value
        {
            get { return _value; }
            set
            {
                _value = value;
                PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Value)));
            }
        }

        /// <summary>Дэлгэц уншигчид: мөр бүрийн хяналт өөр өөр нэртэй (толгойн текстээс хамаарахгүй).</summary>
        public string IncludeAutomationName => "«" + Name + "» параметрийг хуудасны дугаарт оруулах";

        public string ValueAutomationName => "«" + Name + "» параметрийн утга";

        public event PropertyChangedEventHandler PropertyChanged;
    }

    /// <summary>
    /// «Хуудас үүсгэх» тохиргооны цонх: параметр бүрийн утга/«дугаарт оруулах»,
    /// эхлэх дугаар + тоо ширхэг, гарчгийн хүснэгт, нэрийн загвар. Үр дүнг public
    /// property-үүдээр гаргана; урьдчилан харах хэсэгт эхний хуудаснуудыг харуулна.
    /// </summary>
    public partial class BatchSheetDialog : Window
    {
        private readonly List<SheetParamRow> _rows = new List<SheetParamRow>();
        private readonly HashSet<string> _existing;
        private bool _ready;

        // ── Үр дүн ──
        public string Separator { get; private set; }
        public int StartNumber { get; private set; }
        public int Count { get; private set; }
        public int PadWidth { get; private set; }
        public ElementId TitleBlockId { get; private set; } = ElementId.InvalidElementId;
        public string TitleBlockLabel { get; private set; }
        public string NameTemplate { get; private set; }
        public List<SheetParamRow> Rows { get; private set; } = new List<SheetParamRow>();

        public BatchSheetDialog(
            List<DiscoveredParam> parameters,
            List<TitleBlockOption> titleBlocks,
            SheetGenPrefs prefs,
            HashSet<string> existingNumbers)
        {
            InitializeComponent();
            Ui.MglWindow.Setup(this, Title, 660, 760, 560, 560, prefsKey: "batch-sheets");
            Ui.MglTheme.Apply(this);
            Ui.MglUi.Primary(CreateBtn);
            Ui.MglAuto.LabelFor(SepLabel, SepBox);
            Ui.MglAuto.LabelFor(StartLabel, StartBox);
            Ui.MglAuto.LabelFor(CountLabel, CountBox);
            Ui.MglAuto.LabelFor(PadLabel, PadBox);
            Ui.MglAuto.LabelFor(TitleBlockCaption, TitleBlockCombo);
            Ui.MglAuto.LabelFor(NameLabel, NameBox);
            Ui.MglAuto.Name(ParamsList, "Хуудасны параметрүүд", "Параметр бүрийн утга, мөн хуудасны дугаарт оруулах эсэх");
            NameHelp.Text = BatchSheetRules.NameTemplateHelp;

            _existing = existingNumbers ?? new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            prefs = prefs ?? new SheetGenPrefs();

            foreach (DiscoveredParam dp in parameters ?? new List<DiscoveredParam>())
            {
                var row = new SheetParamRow
                {
                    Name = dp.Name,
                    Suggestions = dp.Suggestions ?? new List<string>(),
                    IncludeInNumber = dp.DefaultIncludeInNumber,
                };
                if (prefs.IncludeInNumber != null &&
                    prefs.IncludeInNumber.TryGetValue(dp.Name, out bool inc))
                    row.IncludeInNumber = inc;
                if (prefs.Values != null &&
                    prefs.Values.TryGetValue(dp.Name, out string val))
                    row.Value = val ?? string.Empty;

                row.PropertyChanged += (s, e) => UpdatePreview();
                _rows.Add(row);
            }
            ParamsList.ItemsSource = _rows;
            EmptyParamsNote.Visibility = _rows.Count == 0
                ? System.Windows.Visibility.Visible
                : System.Windows.Visibility.Collapsed;

            SepBox.Text = prefs.Separator ?? "-";
            StartBox.Text = "1";
            CountBox.Text = "1";
            PadBox.Text = (prefs.PadWidth > 0 ? prefs.PadWidth : 3).ToString(CultureInfo.InvariantCulture);
            NameBox.Text = string.IsNullOrEmpty(prefs.NameTemplate) ? "Хуудас <n>" : prefs.NameTemplate;

            var options = new List<TitleBlockOption>
            {
                new TitleBlockOption { Label = "(гарчгийн хүснэгтгүй — хоосон хуудас)", Id = ElementId.InvalidElementId },
            };
            if (titleBlocks != null)
                options.AddRange(titleBlocks);
            TitleBlockCombo.ItemsSource = options;

            int sel = 0;
            if (!string.IsNullOrEmpty(prefs.TitleBlockName))
            {
                for (int i = 0; i < options.Count; i++)
                {
                    if (string.Equals(options[i].Label, prefs.TitleBlockName, StringComparison.Ordinal))
                    {
                        sel = i;
                        break;
                    }
                }
            }
            else if (options.Count > 1)
            {
                sel = 1; // анхдагчаар эхний бодит гарчгийн хүснэгт
            }
            TitleBlockCombo.SelectedIndex = sel;

            _ready = true;
            UpdatePreview();
        }

        private void OnInputChanged(object sender, TextChangedEventArgs e)
        {
            UpdatePreview();
        }

        private void OnTitleBlockChanged(object sender, SelectionChangedEventArgs e)
        {
            // «Гарчгийн хүснэгтгүй» нь чимээгүй сонголт биш — рамк, штамп байхгүй гэдгийг ИЛ хэлнэ.
            var tb = TitleBlockCombo.SelectedItem as TitleBlockOption;
            bool none = tb == null || tb.Id == ElementId.InvalidElementId;
            TitleBlockWarning.Text = none ? BatchSheetRules.NoTitleBlockWarning : string.Empty;
            TitleBlockWarning.Visibility = none ? System.Windows.Visibility.Visible : System.Windows.Visibility.Collapsed;
        }

        private static void ShowError(TextBlock box, string error)
        {
            box.Text = error ?? string.Empty;
            box.Visibility = string.IsNullOrEmpty(error) ? System.Windows.Visibility.Collapsed : System.Windows.Visibility.Visible;
        }

        private List<string> IncludedValues()
        {
            return _rows
                .Where(r => r.IncludeInNumber && !string.IsNullOrWhiteSpace(r.Value))
                .Select(r => r.Value.Trim())
                .ToList();
        }

        private void UpdatePreview()
        {
            if (!_ready || PreviewText == null)
                return;

            // Алдаа нь «Үүсгэх» дарсны дараа MessageBox биш — талбарын ДООР шууд, «Үүсгэх» нь шалтгаантайгаар идэвхгүй.
            BatchInput input = BatchSheetRules.Parse(StartBox.Text, CountBox.Text, PadBox.Text);
            ShowError(StartError, input.StartError);
            ShowError(CountError, input.CountError);
            ShowError(PadError, input.PadError);

            string sep = SepBox.Text ?? string.Empty;
            string nameTpl = NameBox.Text ?? string.Empty;
            List<string> included = IncludedValues();

            BatchPreviewCounts counts = BatchSheetRules.Count(included, input, sep, _existing);
            PreviewHeader.Text = "Урьдчилан харах — " + BatchSheetRules.CountsText(counts);

            if (!input.Valid)
            {
                PreviewText.Text = "(тоо, эхлэх дугаар, урт зөв болмогц харагдана)";
            }
            else
            {
                var sb = new StringBuilder();
                int show = Math.Min(input.Count, BatchSheetRules.PreviewRows);
                for (int i = 0; i < show; i++)
                {
                    int num = input.Start + i;
                    string padded = BatchSheetRules.PadNumber(num, input.Pad);
                    string composed = BatchSheetRules.ComposeNumber(included, padded, sep);
                    string name = BatchSheetRules.ResolveName(nameTpl, padded);

                    string line = composed;
                    if (!string.IsNullOrEmpty(name))
                        line += "   " + name;
                    if (_existing.Contains(composed))
                        line += "   (давхцсан — алгасна)";
                    sb.AppendLine(line);
                }
                if (input.Count > show)
                    sb.AppendLine("… өөр " + (input.Count - show) + " хуудас (нийт " + input.Count + ")");
                PreviewText.Text = sb.ToString().TrimEnd();
            }

            string reason = BatchSheetRules.BlockReason(input, counts);
            BlockText.Text = reason ?? string.Empty;
            BlockText.Visibility = reason == null ? System.Windows.Visibility.Collapsed : System.Windows.Visibility.Visible;
            CreateBtn.IsEnabled = reason == null;
        }

        private void CreateBtn_Click(object sender, RoutedEventArgs e)
        {
            // Шалгалт UpdatePreview-д аль хэдийн хийгдсэн (товч идэвхгүй байсан); энд давхар хамгаалалт л.
            BatchInput input = BatchSheetRules.Parse(StartBox.Text, CountBox.Text, PadBox.Text);
            if (!input.Valid)
            {
                UpdatePreview();
                return;
            }
            int start = input.Start, count = input.Count, pad = input.Pad;

            var tb = TitleBlockCombo.SelectedItem as TitleBlockOption;

            Separator = SepBox.Text ?? string.Empty;
            StartNumber = start;
            Count = count;
            PadWidth = pad;
            TitleBlockId = tb != null ? tb.Id : ElementId.InvalidElementId;
            TitleBlockLabel = tb != null ? tb.Label : null;
            NameTemplate = NameBox.Text ?? string.Empty;
            Rows = _rows.ToList();

            DialogResult = true;
        }

        private static int ParseInt(string s, int fallback)
        {
            return int.TryParse((s ?? string.Empty).Trim(), out int v) ? v : fallback;
        }
    }
}
