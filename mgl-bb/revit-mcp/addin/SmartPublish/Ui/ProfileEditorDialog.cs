using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using RevitMcpAddin.Smart.Ui;
using RevitMcpAddin.SmartPublish.Core;

namespace RevitMcpAddin.SmartPublish.Ui
{
    /// <summary>
    /// Гаргалтын профайл засварлагч (кодоор угсарсан WPF).  Профайлын БҮХ тохиргоо: формат, нэршил
    /// (амьд урьдчилсан харалттай), хавтас, PDF/DWG/IFC, сонголтын дүрэм, preflight-ийн ноцтой байдал.
    ///
    /// Revit-ийн төрлийг мэдэхгүй — `IPublishSession`-аас DWG setup, 3D харагдацын нэрсийг авна.
    /// «OK» дарахад л `Edited` буцна; Cancel = өөрчлөлтгүй.  Хадгалалтыг дуудагч (PublishDialog) хийнэ.
    /// </summary>
    internal sealed class ProfileEditorDialog : Window
    {
        private readonly IPublishSession _s;
        private readonly PublishProfile _p;

        // Ерөнхий
        private readonly TextBox _name = UiKit.Box(), _desc = UiKit.Box(multiline: true), _required = UiKit.Box(multiline: true);
        private readonly CheckBox _fPdf = UiKit.Check("PDF"), _fDwg = UiKit.Check("DWG"), _fIfc = UiKit.Check("IFC");
        private readonly ComboBox _overwrite;
        private readonly CheckBox _reqRevision = UiKit.Check("Хуудас бүр ревизтэй байх ёстой");

        // Нэршил ба хавтас
        private readonly TextBox _sheetTpl = UiKit.Box(), _combTpl = UiKit.Box(), _modelTpl = UiKit.Box(), _subTpl = UiKit.Box(), _base = UiKit.Box(), _maxLen = UiKit.Box(), _missingText = UiKit.Box();
        private readonly ComboBox _onMissing, _dups;
        private readonly CheckBox _createMissing = UiKit.Check("Хавтас байхгүй бол үүсгэх");
        private readonly TextBlock _preview = UiKit.Text("", wrap: true);

        // PDF
        private readonly CheckBox _pdfCombine = UiKit.Check("Бүх хуудсыг НЭГ PDF-д нэгтгэх (хуудас тутмын алдаа тусгаарлагдахгүй)");
        private readonly ComboBox _paper, _orient, _place, _zoom, _color, _raster, _quality;
        private readonly TextBox _zoomPct = UiKit.Box("100", 60);
        private readonly CheckBox _alwaysRaster = UiKit.Check("Үргэлж растер"), _stopOnError = UiKit.Check("Алдаа гарвал зогсох"),
            _hideScope = UiKit.Check("Scope box нуух", true), _hideCrop = UiKit.Check("Crop хүрээ нуух", true),
            _hideRef = UiKit.Check("Reference plane нуух", true), _hideTags = UiKit.Check("Лавлагаагүй view tag нуух", true),
            _linksBlue = UiKit.Check("View холбоос цэнхэр"), _thinLines = UiKit.Check("Halftone-ийг нарийн шугамаар солих"), _maskLines = UiKit.Check("Давхцсан шугамыг далдлах");

        // DWG / IFC
        private readonly ComboBox _dwgSetup, _ifcVersion, _ifcView;
        private readonly CheckBox _dwgMerged = UiKit.Check("Харагдацуудыг нэг файлд (XRef)");
        private readonly CheckBox _ifcQty = UiKit.Check("Base quantities экспортлох"), _ifcSplit = UiKit.Check("Олон давхар хана/баганыг давхараар хуваах");
        private readonly TextBox _ifcBoundary = UiKit.Box("1", 40), _ifcExtra = UiKit.Box(multiline: true);

        // Сонголт
        private readonly CheckBox _incViews = UiKit.Check("Хуудсаас гадна харагдацыг (план, 3D...) жагсаалтад оруулах"), _incPlaceholders = UiKit.Check("Placeholder хуудсыг оруулах");
        private readonly StackPanel _condPanel = new StackPanel();
        private readonly List<CondRow> _conds = new List<CondRow>();

        // Preflight
        private readonly List<SevRow> _sevRows = new List<SevRow>();

        private sealed class CondRow { public ComboBox Field, Op; public TextBox Value; public StackPanel Panel; }
        private sealed class SevRow { public string RuleId; public ComboBox Combo; }

        private static readonly string[] OverwriteLabels = { "Шинэ дугаар өгөх (_v2, _v3)", "Дарж бичих", "Алгасах", "Блоклох (файл байвал)" };
        private static readonly OverwriteMode[] OverwriteValues = { OverwriteMode.Version, OverwriteMode.Overwrite, OverwriteMode.Skip, OverwriteMode.Fail };
        private static readonly string[] MissingLabels = { "Блоклох (алдаа)", "Хоосноор орлуулах", "«NA» гэх мэт бичвэр оруулах" };
        private static readonly MissingTokenPolicy[] MissingValues = { MissingTokenPolicy.Error, MissingTokenPolicy.Empty, MissingTokenPolicy.Placeholder };
        private static readonly string[] DupLabels = { "Блоклох", "Дагавар нэмэх (_2, _3)" };
        private static readonly DuplicateNamePolicy[] DupValues = { DuplicateNamePolicy.Block, DuplicateNamePolicy.Suffix };
        private static readonly string[] OpLabels = { "тэнцүү", "тэнцүү биш", "агуулна", "эхэлнэ", "төгснө", "хоосон биш", "хоосон" };
        private static readonly ConditionOp[] OpValues = { ConditionOp.Equals, ConditionOp.NotEquals, ConditionOp.Contains, ConditionOp.StartsWith, ConditionOp.EndsWith, ConditionOp.NotEmpty, ConditionOp.IsEmpty };
        private static readonly string[] SevLabels = { "Анхдагч", "Мэдээлэл", "Анхааруулга", "Блоклох" };

        /// <summary>«OK» дарсны дараах засварласан профайл (null = цуцалсан).</summary>
        public PublishProfile Edited { get; private set; }

        public ProfileEditorDialog(IPublishSession session, PublishProfile profile)
        {
            _s = session;
            _p = profile;
            Title = "Гаргалтын профайл";
            Width = 780;
            Height = 700;
            MinWidth = 640;
            MinHeight = 520;
            WindowStartupLocation = WindowStartupLocation.CenterOwner;
            UiKit.Prepare(this, "publish-profile");

            _overwrite = UiKit.Combo(OverwriteLabels, null, 240);
            _onMissing = UiKit.Combo(MissingLabels, null, 240);
            _dups = UiKit.Combo(DupLabels, null, 240);
            _paper = UiKit.Combo(PublishChoices.PaperFormats);
            _orient = UiKit.Combo(PublishChoices.Orientations);
            _place = UiKit.Combo(PublishChoices.Placements);
            _zoom = UiKit.Combo(PublishChoices.ZoomTypes);
            _color = UiKit.Combo(PublishChoices.ColorDepths);
            _raster = UiKit.Combo(PublishChoices.RasterQualities);
            _quality = UiKit.Combo(PublishChoices.ExportQualities);
            _quality.IsEditable = true;
            _dwgSetup = UiKit.Combo(new[] { "" }.Concat(session.DwgSetupNames.OrderBy(x => x, StringComparer.OrdinalIgnoreCase)), null, 260);
            _dwgSetup.IsEditable = true;
            _ifcVersion = UiKit.Combo(PublishChoices.IfcVersions, null, 160);
            _ifcVersion.IsEditable = true;
            _ifcView = UiKit.Combo(new[] { "" }.Concat(session.ThreeDViewNames.OrderBy(x => x, StringComparer.OrdinalIgnoreCase)), null, 260);
            _ifcView.IsEditable = true;

            var tabs = new TabControl { Margin = new Thickness(8) };
            tabs.Items.Add(new TabItem { Header = "Ерөнхий", Content = Scroll(BuildGeneral()) });
            tabs.Items.Add(new TabItem { Header = "Нэршил, хавтас", Content = Scroll(BuildNaming()) });
            tabs.Items.Add(new TabItem { Header = "PDF", Content = Scroll(BuildPdf()) });
            tabs.Items.Add(new TabItem { Header = "DWG · IFC", Content = Scroll(BuildDwgIfc()) });
            tabs.Items.Add(new TabItem { Header = "Сонголт", Content = Scroll(BuildSelection()) });
            tabs.Items.Add(new TabItem { Header = "Гаргахын өмнөх шалгалт", Content = Scroll(BuildPreflight()) });

            var ok = UiKit.Btn("Хадгалах", OnOk, 90);
            ok.IsDefault = true;
            var cancel = UiKit.Btn("Болих", (s, e) => { Edited = null; DialogResult = false; }, 90);
            cancel.IsCancel = true;
            var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(8) };
            buttons.Children.Add(ok);
            buttons.Children.Add(cancel);

            var root = new DockPanel();
            DockPanel.SetDock(buttons, Dock.Bottom);
            root.Children.Add(buttons);
            root.Children.Add(tabs);
            Content = root;

            Load();
        }

        private static ScrollViewer Scroll(UIElement e)
        {
            return new ScrollViewer { Content = e, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Padding = new Thickness(8) };
        }

        /* ============================== UI ================================= */

        private UIElement BuildGeneral()
        {
            _desc.Height = 52;
            _required.Height = 70;
            return UiKit.Col(
                UiKit.Form(
                    UiKit.F("Нэр", _name),
                    UiKit.F("Тайлбар", _desc),
                    UiKit.F("Формат", UiKit.Row(_fPdf, _fDwg, _fIfc)),
                    UiKit.F("Байгаа файл байвал", _overwrite),
                    UiKit.F("Ревиз", _reqRevision),
                    UiKit.F("Заавал бөглөх хуудасны параметр (мөр тутамд нэг)", _required)),
                UiKit.Text("Гаргахын өмнөх шалгалт хоосон параметртэй хуудсыг блоклоно.", brush: UiKit.MutedBrush));
        }

        private UIElement BuildNaming()
        {
            foreach (TextBox t in new[] { _sheetTpl, _combTpl, _modelTpl, _subTpl })
                t.TextChanged += (s, e) => UpdatePreview();
            _base.TextChanged += (s, e) => { };
            var browse = UiKit.Btn("Сонгох…", (s, e) =>
            {
                string picked = FolderPicker.Pick(this, _base.Text, "Гаргах үндсэн хавтас");
                if (picked != null) _base.Text = picked;
            });
            var baseRow = new DockPanel();
            DockPanel.SetDock(browse, Dock.Right);
            baseRow.Children.Add(browse);
            baseRow.Children.Add(_base);

            _preview.Margin = new Thickness(4);
            return UiKit.Col(
                UiKit.Form(
                    UiKit.F("Хуудас тутмын нэр", _sheetTpl),
                    UiKit.F("Нэгтгэсэн PDF/DWG-ийн нэр", _combTpl),
                    UiKit.F("IFC-ийн нэр", _modelTpl),
                    UiKit.F("Токен хоосон байвал", _onMissing),
                    UiKit.F("«Хоосон байвал» бичвэр", _missingText),
                    UiKit.F("Давхардсан нэр", _dups),
                    UiKit.F("Нэрийн дээд урт", _maxLen),
                    UiKit.F("Үндсэн хавтас", baseRow),
                    UiKit.F("Дэд хавтас (/-ээр түвшинтэй)", _subTpl),
                    UiKit.F("", _createMissing)),
                UiKit.Section("Урьдчилсан харалт (эхний хуудсаар)", _preview),
                UiKit.Text(PublishChoices.TokenHelp, brush: UiKit.MutedBrush, wrap: true));
        }

        private UIElement BuildPdf()
        {
            return UiKit.Col(
                _pdfCombine,
                UiKit.Form(
                    UiKit.F("Цаасны хэмжээ", _paper),
                    UiKit.F("Чиглэл", _orient),
                    UiKit.F("Байрлал", _place),
                    UiKit.F("Масштаб", _zoom),
                    UiKit.F("Масштабын хувь (Zoom үед)", _zoomPct),
                    UiKit.F("Өнгө", _color),
                    UiKit.F("Чанар (DPI)", _quality),
                    UiKit.F("Растерын чанар", _raster)),
                _alwaysRaster, _stopOnError, _hideScope, _hideCrop, _hideRef, _hideTags, _linksBlue, _thinLines, _maskLines,
                UiKit.Text("«Хуудасны хэмжээгээр» (Default) = Revit хуудас бүрийн өөрийн хэмжээг ашиглана.", brush: UiKit.MutedBrush, wrap: true));
        }

        private UIElement BuildDwgIfc()
        {
            _ifcExtra.Height = 80;
            return UiKit.Col(
                UiKit.Section("DWG", UiKit.Col(
                    UiKit.Form(UiKit.F("Export setup (загвар доторх)", _dwgSetup)),
                    _dwgMerged,
                    UiKit.Text("Компанийн setup-ыг ЧИМЭЭГҮЙ өөрчлөхгүй — сонгосон setup яг хэвээр хэрэглэгдэнэ.", brush: UiKit.MutedBrush, wrap: true))),
                UiKit.Section("IFC", UiKit.Col(
                    UiKit.Form(
                        UiKit.F("IFC хувилбар", _ifcVersion),
                        UiKit.F("Шүүлтүүр 3D харагдац", _ifcView),
                        UiKit.F("Space boundary (0–2)", _ifcBoundary),
                        UiKit.F("Нэмэлт тохиргоо (name=value, мөр тутамд)", _ifcExtra)),
                    _ifcQty, _ifcSplit)));
        }

        private UIElement BuildSelection()
        {
            var add = UiKit.Btn("+ Нөхцөл нэмэх", (s, e) => AddCondition(null));
            return UiKit.Col(
                UiKit.Text("Профайл сонгогдоход эдгээр нөхцөлийг БҮГДИЙГ хангасан хуудас автоматаар тэмдэглэгдэнэ (дараа нь гараар өөрчилж болно).", brush: UiKit.MutedBrush, wrap: true),
                _condPanel,
                add,
                _incViews,
                _incPlaceholders);
        }

        private UIElement BuildPreflight()
        {
            var panel = new StackPanel();
            panel.Children.Add(UiKit.Text("Дүрэм бүрийн ноцтой байдлыг өөрчилж болно. Бүтцийн алдаа (хоосон багц, замын урт, DWG setup гэх мэт) блоклохоос буурахгүй.", brush: UiKit.MutedBrush, wrap: true));
            foreach (IPreflightRule rule in PreflightEngine.DefaultRules)
            {
                var combo = UiKit.Combo(SevLabels, SevLabels[0], 130);
                combo.IsEnabled = true;
                var label = UiKit.Text(rule.Id + (rule.Downgradable ? "" : "  (буурах боломжгүй)"));
                label.Width = 260;
                panel.Children.Add(UiKit.Row(label, combo));
                _sevRows.Add(new SevRow { RuleId = rule.Id, Combo = combo });
            }
            return panel;
        }

        private void AddCondition(ItemCondition c)
        {
            var row = new CondRow
            {
                Field = UiKit.Combo(PublishChoices.SelectionFields, c != null ? c.Field : "SheetNumber", 160),
                Op = UiKit.Combo(OpLabels, OpLabels[OpIndex(c != null ? c.Op : ConditionOp.StartsWith)], 110),
                Value = UiKit.Box(c != null ? c.Value : "", 180),
            };
            row.Field.IsEditable = true;   // «Param:Нэр» бичих боломжтой
            var remove = UiKit.Btn("✕", null);
            row.Panel = UiKit.Row(row.Field, row.Op, row.Value, remove);
            remove.Click += (s, e) => { _condPanel.Children.Remove(row.Panel); _conds.Remove(row); };
            _conds.Add(row);
            _condPanel.Children.Add(row.Panel);
        }

        private static int OpIndex(ConditionOp op)
        {
            int i = Array.IndexOf(OpValues, op);
            return i < 0 ? 0 : i;
        }

        /* ============================== LOAD / SAVE ======================== */

        private void Load()
        {
            _name.Text = _p.Name;
            _desc.Text = _p.Description ?? "";
            _fPdf.IsChecked = _p.Formats.Contains(PublishFormat.Pdf);
            _fDwg.IsChecked = _p.Formats.Contains(PublishFormat.Dwg);
            _fIfc.IsChecked = _p.Formats.Contains(PublishFormat.Ifc);
            _overwrite.SelectedIndex = Math.Max(0, Array.IndexOf(OverwriteValues, _p.Overwrite));
            _reqRevision.IsChecked = _p.Revision.Required;
            _required.Text = string.Join("\n", _p.RequiredParameters);

            _sheetTpl.Text = _p.Naming.SheetTemplate;
            _combTpl.Text = _p.Naming.CombinedTemplate;
            _modelTpl.Text = _p.Naming.ModelTemplate;
            _onMissing.SelectedIndex = Math.Max(0, Array.IndexOf(MissingValues, _p.Naming.OnMissing));
            _missingText.Text = _p.Naming.MissingText ?? "NA";
            _dups.SelectedIndex = Math.Max(0, Array.IndexOf(DupValues, _p.Naming.Duplicates));
            _maxLen.Text = _p.Naming.MaxLength.ToString();
            _base.Text = _p.Destination.BaseFolder ?? "";
            _subTpl.Text = _p.Destination.SubfolderTemplate ?? "";
            _createMissing.IsChecked = _p.Destination.CreateMissing;

            _pdfCombine.IsChecked = _p.Pdf.Combine;
            Pick(_paper, _p.Pdf.PaperFormat);
            Pick(_orient, _p.Pdf.Orientation);
            Pick(_place, _p.Pdf.Placement);
            Pick(_zoom, _p.Pdf.ZoomType);
            Pick(_color, _p.Pdf.ColorDepth);
            Pick(_raster, _p.Pdf.RasterQuality);
            _quality.Text = _p.Pdf.ExportQuality ?? "";
            _zoomPct.Text = _p.Pdf.ZoomPercent.ToString();
            _alwaysRaster.IsChecked = _p.Pdf.AlwaysUseRaster;
            _stopOnError.IsChecked = _p.Pdf.StopOnError;
            _hideScope.IsChecked = _p.Pdf.HideScopeBoxes;
            _hideCrop.IsChecked = _p.Pdf.HideCropBoundaries;
            _hideRef.IsChecked = _p.Pdf.HideReferencePlanes;
            _hideTags.IsChecked = _p.Pdf.HideUnreferencedViewTags;
            _linksBlue.IsChecked = _p.Pdf.ViewLinksInBlue;
            _thinLines.IsChecked = _p.Pdf.ReplaceHalftoneWithThinLines;
            _maskLines.IsChecked = _p.Pdf.MaskCoincidentLines;

            _dwgSetup.Text = _p.Dwg.SetupName ?? "";
            _dwgMerged.IsChecked = _p.Dwg.MergedViews;
            _ifcVersion.Text = _p.Ifc.Version ?? "IFC4";
            _ifcView.Text = _p.Ifc.FilterViewName ?? "";
            _ifcBoundary.Text = _p.Ifc.SpaceBoundaryLevel.ToString();
            _ifcQty.IsChecked = _p.Ifc.ExportBaseQuantities;
            _ifcSplit.IsChecked = _p.Ifc.SplitWallsAndColumns;
            _ifcExtra.Text = string.Join("\n", _p.Ifc.ExtraOptions.Select(kv => kv.Key + "=" + kv.Value));

            _incViews.IsChecked = _p.Selection.IncludeViews;
            _incPlaceholders.IsChecked = _p.Selection.IncludePlaceholders;
            foreach (ItemCondition c in _p.Selection.Conditions) AddCondition(c);

            foreach (SevRow r in _sevRows)
            {
                PreflightSeverity sev;
                if (_p.SeverityOverrides.TryGetValue(r.RuleId, out sev)) r.Combo.SelectedIndex = 1 + (int)sev;
            }
            UpdatePreview();
        }

        private static void Pick(ComboBox c, string value)
        {
            c.SelectedItem = c.Items.Cast<string>().FirstOrDefault(i => string.Equals(i, value, StringComparison.OrdinalIgnoreCase));
            if (c.SelectedItem == null && c.IsEditable) c.Text = value ?? "";
            if (c.SelectedItem == null && !c.IsEditable && c.Items.Count > 0) c.SelectedIndex = 0;
        }

        private static string Txt(ComboBox c)
        {
            return c.IsEditable ? (c.Text ?? "").Trim() : (c.SelectedItem as string ?? "");
        }

        private void OnOk(object sender, RoutedEventArgs e)
        {
            string name = _name.Text.Trim();
            if (name.Length == 0)
            {
                MessageBox.Show(this, "Профайлын нэрийг оруулна уу.", Title, MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            PublishProfile p = _p.Clone();
            p.Name = name;
            p.Description = string.IsNullOrWhiteSpace(_desc.Text) ? null : _desc.Text.Trim();
            p.Formats = new List<PublishFormat>();
            if (_fPdf.IsChecked == true) p.Formats.Add(PublishFormat.Pdf);
            if (_fDwg.IsChecked == true) p.Formats.Add(PublishFormat.Dwg);
            if (_fIfc.IsChecked == true) p.Formats.Add(PublishFormat.Ifc);
            p.Overwrite = OverwriteValues[Math.Max(0, _overwrite.SelectedIndex)];
            p.Revision.Required = _reqRevision.IsChecked == true;
            p.RequiredParameters = _required.Text.Split(new[] { '\n', '\r' }, StringSplitOptions.RemoveEmptyEntries).Select(x => x.Trim()).Where(x => x.Length > 0).Distinct().ToList();

            p.Naming.SheetTemplate = _sheetTpl.Text.Trim();
            p.Naming.CombinedTemplate = _combTpl.Text.Trim();
            p.Naming.ModelTemplate = _modelTpl.Text.Trim();
            p.Naming.OnMissing = MissingValues[Math.Max(0, _onMissing.SelectedIndex)];
            p.Naming.MissingText = string.IsNullOrWhiteSpace(_missingText.Text) ? "NA" : _missingText.Text.Trim();
            p.Naming.Duplicates = DupValues[Math.Max(0, _dups.SelectedIndex)];
            int max;
            p.Naming.MaxLength = int.TryParse(_maxLen.Text, out max) && max >= 20 && max <= 200 ? max : 120;
            p.Destination.BaseFolder = string.IsNullOrWhiteSpace(_base.Text) ? null : _base.Text.Trim();
            p.Destination.SubfolderTemplate = _subTpl.Text.Trim();
            p.Destination.CreateMissing = _createMissing.IsChecked == true;

            p.Pdf.Combine = _pdfCombine.IsChecked == true;
            p.Pdf.PaperFormat = Txt(_paper);
            p.Pdf.Orientation = Txt(_orient);
            p.Pdf.Placement = Txt(_place);
            p.Pdf.ZoomType = Txt(_zoom);
            p.Pdf.ColorDepth = Txt(_color);
            p.Pdf.RasterQuality = Txt(_raster);
            p.Pdf.ExportQuality = string.IsNullOrWhiteSpace(_quality.Text) ? null : _quality.Text.Trim();
            int zp;
            p.Pdf.ZoomPercent = int.TryParse(_zoomPct.Text, out zp) ? zp : 100;
            p.Pdf.AlwaysUseRaster = _alwaysRaster.IsChecked == true;
            p.Pdf.StopOnError = _stopOnError.IsChecked == true;
            p.Pdf.HideScopeBoxes = _hideScope.IsChecked == true;
            p.Pdf.HideCropBoundaries = _hideCrop.IsChecked == true;
            p.Pdf.HideReferencePlanes = _hideRef.IsChecked == true;
            p.Pdf.HideUnreferencedViewTags = _hideTags.IsChecked == true;
            p.Pdf.ViewLinksInBlue = _linksBlue.IsChecked == true;
            p.Pdf.ReplaceHalftoneWithThinLines = _thinLines.IsChecked == true;
            p.Pdf.MaskCoincidentLines = _maskLines.IsChecked == true;

            p.Dwg.SetupName = string.IsNullOrWhiteSpace(_dwgSetup.Text) ? null : _dwgSetup.Text.Trim();
            p.Dwg.MergedViews = _dwgMerged.IsChecked == true;
            p.Ifc.Version = string.IsNullOrWhiteSpace(_ifcVersion.Text) ? "IFC4" : _ifcVersion.Text.Trim();
            p.Ifc.FilterViewName = string.IsNullOrWhiteSpace(_ifcView.Text) ? null : _ifcView.Text.Trim();
            int sb;
            p.Ifc.SpaceBoundaryLevel = int.TryParse(_ifcBoundary.Text, out sb) ? Math.Max(0, Math.Min(2, sb)) : 1;
            p.Ifc.ExportBaseQuantities = _ifcQty.IsChecked == true;
            p.Ifc.SplitWallsAndColumns = _ifcSplit.IsChecked == true;
            p.Ifc.ExtraOptions = new Dictionary<string, string>();
            foreach (string line in _ifcExtra.Text.Split(new[] { '\n', '\r' }, StringSplitOptions.RemoveEmptyEntries))
            {
                int eq = line.IndexOf('=');
                if (eq > 0) p.Ifc.ExtraOptions[line.Substring(0, eq).Trim()] = line.Substring(eq + 1).Trim();
            }

            p.Selection.IncludeViews = _incViews.IsChecked == true;
            p.Selection.IncludePlaceholders = _incPlaceholders.IsChecked == true;
            p.Selection.Conditions = _conds
                .Select(c => new ItemCondition { Field = (c.Field.Text ?? "").Trim(), Op = OpValues[Math.Max(0, c.Op.SelectedIndex)], Value = c.Value.Text })
                .Where(c => c.Field.Length > 0).ToList();

            p.SeverityOverrides = new Dictionary<string, PreflightSeverity>();
            foreach (SevRow r in _sevRows)
                if (r.Combo.SelectedIndex > 0) p.SeverityOverrides[r.RuleId] = (PreflightSeverity)(r.Combo.SelectedIndex - 1);

            if (p.Formats.Count == 0)
            {
                MessageBox.Show(this, "Ядаж нэг формат (PDF, DWG, IFC) сонгоно уу.", Title, MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }
            foreach (string t in new[] { p.Naming.SheetTemplate, p.Naming.CombinedTemplate, p.Naming.ModelTemplate })
            {
                ParsedTemplate parsed = NamingEngine.Parse(t);
                if (!parsed.IsValid)
                {
                    MessageBox.Show(this, "Нэршлийн загварт алдаа байна:\n" + string.Join("\n", parsed.Errors), Title, MessageBoxButton.OK, MessageBoxImage.Warning);
                    return;
                }
            }

            Edited = p;
            DialogResult = true;
        }

        /* ============================== PREVIEW ============================ */

        private void UpdatePreview()
        {
            try
            {
                PublishItem sample = _s.Items.FirstOrDefault(i => i.Kind == PublishItemKind.Sheet) ?? _s.Items.FirstOrDefault();
                if (sample == null) { _preview.Text = "(жишээ хуудас байхгүй)"; return; }

                var naming = new NamingSettings
                {
                    OnMissing = MissingValues[Math.Max(0, _onMissing.SelectedIndex)],
                    MissingText = string.IsNullOrWhiteSpace(_missingText.Text) ? "NA" : _missingText.Text,
                    MaxLength = 120,
                };
                var lines = new List<string>();
                ParsedTemplate t = NamingEngine.Parse(_sheetTpl.Text);
                if (!t.IsValid) lines.Add("⚠ " + string.Join(" ", t.Errors));
                else
                {
                    NameResult r = NamingEngine.Evaluate(t, PublishTokens.ForItem(_s.Project, sample, PublishFormat.Pdf, 1), naming);
                    lines.Add("Файл: " + (r.IsEmpty ? "(хоосон!)" : r.Name + ".pdf") + (r.MissingTokens.Count > 0 ? "   ⚠ хоосон: " + string.Join(", ", r.MissingTokens) : ""));
                }
                if (!string.IsNullOrWhiteSpace(_subTpl.Text))
                {
                    var folderNaming = new NamingSettings { OnMissing = naming.OnMissing, MissingText = naming.MissingText, MaxLength = 60 };
                    var segs = new List<string>();
                    foreach (ParsedTemplate seg in PublishPlanner.ParseSubfolder(_subTpl.Text))
                    {
                        if (!seg.IsValid) { segs.Add("⚠ " + string.Join(" ", seg.Errors)); continue; }
                        NameResult sr = NamingEngine.Evaluate(seg, PublishTokens.ForItem(_s.Project, sample, PublishFormat.Pdf, 1), folderNaming);
                        if (!sr.IsEmpty) segs.Add(sr.Name);
                    }
                    lines.Add("Дэд хавтас: " + (segs.Count == 0 ? "(хоосон)" : string.Join("\\", segs)));
                }
                lines.Add("(" + sample.Label + ")");
                _preview.Text = string.Join("\n", lines);
            }
            catch (Exception ex)
            {
                _preview.Text = "Урьдчилан харах боломжгүй (" + ex.GetType().Name + ")";
            }
        }
    }
}
