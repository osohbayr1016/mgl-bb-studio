using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Selection;

namespace RevitMcpAddin
{
    /// <summary>
    /// «Хуулж тавих» ribbon команд (v2, 2026-09-28).  Инженер А хэсэгт (секц,
    /// давхрын нэг хэсэг) хийсэн зүйлээ Б хэсэг рүү ЗУРАГТАЙ нь хуулна:
    ///
    ///   1. Давхрын план нээнэ, хуулах элементүүдээ сонгоно.
    ///   2. Цонхноос арга (шилжүүлэх / эргүүлэх / толин тусгал), юуг хуулах,
    ///      Б-д үүсгэх А-гийн харагдацуудаа сонгоно.
    ///   3. Цэгүүдээ дарна.
    ///
    /// Б-д аль хэдийн байгаа элементийг дахин хуулахгүй (зөвхөн зураг нь хуулагдана)
    /// тул нэг үйлдлийг дахин ажиллуулахад давхардал үүсэхгүй.  Бүх байршил нэг
    /// TransactionGroup → нэг Ctrl+Z.  Цөм нь <see cref="CopyToOtherEngine"/>.
    /// </summary>
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public class CopyToOtherCommand : IExternalCommand
    {
        private const string DialogTitle = "MGL — Элемент хуулах";

        private const ObjectSnapTypes Snaps =
            ObjectSnapTypes.Endpoints | ObjectSnapTypes.Intersections | ObjectSnapTypes.Midpoints
            | ObjectSnapTypes.Centers | ObjectSnapTypes.Perpendicular;

        /// <summary>Эргүүлэх горимд A1A2 ба B1B2-ийн уртын зөвшөөрөгдөх зөрүү (≈ 6 мм).</summary>
        private const double LengthTol = 0.02;

        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            // ⚠️ ЛИЦЕНЗ (1.9.0): зөвхөн компанийн бүртгэлээр, ажлын компьютер дээр — Licensing/LicenseGate.cs.
            if (!global::RevitMcpAddin.Licensing.LicenseGate.Ensure()) return Result.Cancelled;
            UIDocument uidoc = commandData.Application.ActiveUIDocument;
            if (uidoc == null || uidoc.Document == null)
                return Result.Cancelled;
            Document doc = uidoc.Document;
            if (doc.IsFamilyDocument)
            {
                TaskDialog.Show(DialogTitle, "Зөвхөн төслийн файл дээр ажиллана. Family засварлаж байгаа бол төслийн файл руу шилжинэ үү.");
                return Result.Cancelled;
            }

            View view = doc.ActiveView;
            if (!(view is ViewPlan) || view.IsTemplate)
            {
                TaskDialog.Show(DialogTitle,
                    "Давхрын план (Floor Plan) харагдац нээгээд дахин дарна уу.\n\n"
                    + "Цэгүүдийг план дээр дардаг тул зүсэлт, 3D, хуудсан дээр ажиллахгүй.");
                return Result.Cancelled;
            }

            var report = new CopyToOtherReport();
            try
            {
                // ── 1. Сонголт
                ICollection<ElementId> picked = uidoc.Selection.GetElementIds();
                if (picked.Count == 0)
                {
                    IList<Reference> refs = uidoc.Selection.PickObjects(ObjectType.Element, new CopySelectionFilter(view),
                        "A хэсгийн хуулах зүйлээ сонгоод (цонхоор хүрээлж болно) дээд талын «Finish» товч дарна уу");
                    picked = refs.Select(r => r.ElementId).ToList();
                }
                CopyToOtherEngine.SplitSelection(doc, view, picked,
                    out List<ElementId> modelIds, out List<ElementId> detailIds);
                if (modelIds.Count == 0 && detailIds.Count == 0)
                {
                    TaskDialog.Show(DialogTitle,
                        "Хуулах элемент сонгогдсонгүй.\n\nТэнхлэг, түвшин, tag, хэмжээсийг ганцаарчилж хуулдаггүй — "
                        + "хана, хаалга, өрөө, тавилга зэрэг элементээ сонгоно уу.  Тэдгээрийн tag, хэмжээс автоматаар дагана.");
                    return Result.Cancelled;
                }

                // ── 2. Тохиргооны цонх
                AddinSettings settings = SettingsStore.Load();
                CopyToOtherPrefs prefs = settings.CopyToOther ?? new CopyToOtherPrefs();
                List<CopySourceView> sourceViews = modelIds.Count > 0
                    ? CopyToOtherEngine.FindSourceViews(doc, modelIds)
                    : new List<CopySourceView>();
                var dlg = new CopyToOtherDialog(Describe(doc, modelIds, detailIds), sourceViews, prefs);
                if (App.ShowOwned(dlg, commandData.Application.MainWindowHandle) != true)
                    return Result.Cancelled;
                try
                {
                    settings.CopyToOther = dlg.ToPrefs();
                    SettingsStore.Save(settings);
                }
                catch
                {
                    // Тохиргоо хадгалагдахгүй байх нь хуулахад саад болохгүй.
                }
                CopyToOtherOptions options = dlg.ToOptions();

                // ── 3. Цэгүүд + гүйцэтгэл
                using (var tg = new TransactionGroup(doc, "MGL: Хуулж тавих"))
                {
                    tg.Start();
                    switch (dlg.Mode)
                    {
                        case CopyPlacementKind.Move:
                            RunMove(uidoc, view, modelIds, detailIds, options, report);
                            break;
                        case CopyPlacementKind.Rotate:
                            RunRotate(uidoc, view, modelIds, detailIds, options, report);
                            break;
                        default:
                            RunMirror(uidoc, view, modelIds, detailIds, options, report);
                            break;
                    }
                    if (report.Targets > 0)
                        tg.Assimilate();
                    else
                        tg.RollBack();
                }
            }
            catch (Autodesk.Revit.Exceptions.OperationCanceledException)
            {
                if (report.Targets == 0)
                    return Result.Cancelled;
            }

            if (report.Targets == 0 && report.Errors.Count == 0)
                return Result.Cancelled;

            // Үүссэнийг сонгож харуулна — хэрэглэгч шууд нүдээр шалгана.
            try
            {
                List<ElementId> show = report.CreatedModelIds.Where(id => doc.GetElement(id) != null).ToList();
                if (show.Count > 0)
                    uidoc.Selection.SetElementIds(show);
            }
            catch
            {
                // Сонголт бол зөвхөн тав тух.
            }
            TaskDialog.Show(DialogTitle, report.Summary());
            return report.Targets > 0 ? Result.Succeeded : Result.Failed;
        }

        // ── Горим бүрийн цэг дарах урсгал ─────────────────────────────────

        private static void RunMove(UIDocument uidoc, View view, List<ElementId> modelIds, List<ElementId> detailIds,
            CopyToOtherOptions options, CopyToOtherReport report)
        {
            XYZ a = uidoc.Selection.PickPoint(Snaps, "A: суурь цэгээ дарна уу — жишээ нь тэнхлэгийн огтлолцол");
            while (true)
            {
                XYZ b = PickOrNull(uidoc, report.Targets == 0
                    ? "B: харгалзах цэгийг дарна уу"
                    : "Дараагийн байршлын цэгийг дарна уу — эсвэл Esc дарж дуусгана");
                if (b == null)
                    return;
                CopyPlacement p = CopyPlacement.Move(a, b);
                if (p.Translation.GetLength() < 1e-6)
                    continue;
                if (!Execute(uidoc, view, modelIds, detailIds, p, options, report))
                    return;
            }
        }

        private static void RunRotate(UIDocument uidoc, View view, List<ElementId> modelIds, List<ElementId> detailIds,
            CopyToOtherOptions options, CopyToOtherReport report)
        {
            XYZ a1 = uidoc.Selection.PickPoint(Snaps, "A: 1-р цэг (жишээ нь тэнхлэгийн огтлолцол)");
            XYZ a2 = uidoc.Selection.PickPoint(Snaps, "A: 2-р цэг — чиглэлийг тодорхойлно (өөр огтлолцол)");
            while (true)
            {
                XYZ b1 = PickOrNull(uidoc, report.Targets == 0
                    ? "B: A-гийн 1-р цэгт харгалзах цэг"
                    : "Дараагийн байршлын 1-р цэг — эсвэл Esc дарж дуусгана");
                if (b1 == null)
                    return;
                XYZ b2 = PickOrNull(uidoc, "B: A-гийн 2-р цэгт харгалзах цэг");
                if (b2 == null)
                    return;
                double mismatch = CopyPlacement.LengthMismatch(a1, a2, b1, b2);
                if (mismatch > LengthTol)
                {
                    double mm = UnitUtils.ConvertFromInternalUnits(mismatch, UnitTypeId.Millimeters);
                    TaskDialogResult r = TaskDialog.Show(DialogTitle,
                        "A-гийн хоёр цэгийн зай ба B-гийн хоёр цэгийн зай " + mm.ToString("0") + " мм зөрж байна.\n\n"
                        + "Ихэвчлэн буруу огтлолцол дээр дарсан гэсэн үг.  Энэ байршлыг алгасах уу?",
                        TaskDialogCommonButtons.Yes | TaskDialogCommonButtons.No);
                    if (r == TaskDialogResult.Yes)
                        continue;
                }
                if (!Execute(uidoc, view, modelIds, detailIds, CopyPlacement.Rotate(a1, a2, b1, b2), options, report))
                    return;
            }
        }

        private static void RunMirror(UIDocument uidoc, View view, List<ElementId> modelIds, List<ElementId> detailIds,
            CopyToOtherOptions options, CopyToOtherReport report)
        {
            XYZ p1 = uidoc.Selection.PickPoint(Snaps, "Толин тусгалын тэнхлэг: 1-р цэг (жишээ нь А, Б-г заагласан хананы тэнхлэг)");
            XYZ p2 = uidoc.Selection.PickPoint(Snaps, "Толин тусгалын тэнхлэг: 2-р цэг");
            Execute(uidoc, view, modelIds, detailIds, CopyPlacement.Mirror(p1, p2), options, report);
        }

        private static XYZ PickOrNull(UIDocument uidoc, string prompt)
        {
            try
            {
                return uidoc.Selection.PickPoint(Snaps, prompt);
            }
            catch (Autodesk.Revit.Exceptions.OperationCanceledException)
            {
                return null;
            }
        }

        /// <summary>Нэг байршлыг өөрийн Transaction-д гүйцэтгэнэ.  Алдаа гарвал false.</summary>
        private static bool Execute(UIDocument uidoc, View view, List<ElementId> modelIds, List<ElementId> detailIds,
            CopyPlacement p, CopyToOtherOptions options, CopyToOtherReport report)
        {
            Document doc = uidoc.Document;
            p.Letter = CopyToOtherEngine.LetterFor(report.Targets);
            using (var t = new Transaction(doc, "MGL: Хуулж тавих"))
            {
                t.Start();
                FailureHandlingOptions fho = t.GetFailureHandlingOptions();
                fho.SetFailuresPreprocessor(new CopyWarningCounter(report));
                t.SetFailureHandlingOptions(fho);
                try
                {
                    CopyToOtherEngine.Run(doc, view, modelIds, detailIds, p, options, report);
                    t.Commit();
                }
                catch (Exception ex)
                {
                    if (t.HasStarted() && !t.HasEnded())
                        t.RollBack();
                    report.Errors.Add(ex.Message);
                    return false;
                }
            }
            uidoc.RefreshActiveView();
            return true;
        }

        /// <summary>«Хана 4 · Хаалга 2 · Өрөө 1» — цонхны толгойд.</summary>
        private static string Describe(Document doc, List<ElementId> modelIds, List<ElementId> detailIds)
        {
            string model = string.Join(" · ", modelIds
                .Select(id => doc.GetElement(id)?.Category?.Name ?? "?")
                .GroupBy(n => n)
                .OrderByDescending(g => g.Count())
                .Take(6)
                .Select(g => g.Key + " " + g.Count()));
            string s = "Сонгосон: " + (modelIds.Count + detailIds.Count) + " элемент";
            if (model.Length > 0)
                s += "  (" + model + ")";
            if (detailIds.Count > 0)
                s += "  + 2D " + detailIds.Count;
            return s;
        }
    }

    /// <summary>Хуулахгүй зүйлийг (тэнхлэг, түвшин, харагдац, link) сонголтоос шууд хасна.</summary>
    internal sealed class CopySelectionFilter : ISelectionFilter
    {
        private readonly View _view;

        public CopySelectionFilter(View view) { _view = view; }

        public bool AllowElement(Element elem) => CopyToOtherEngine.IsCopyable(elem, _view);

        public bool AllowReference(Reference reference, XYZ position) => false;
    }

    /// <summary>
    /// «Хуулж тавих»-ын тохиргооны цонх (кодоор угсарсан WPF — XAML-гүй, жижиг).
    /// GRAITEC-ийн Clone Drawings шиг «аль харагдацыг, аль тэмдэглэгээг» сонгуулна.
    /// </summary>
    internal sealed class CopyToOtherDialog : Window
    {
        private readonly RadioButton _move, _rotate, _mirror;
        private readonly CheckBox _tags, _roomTags, _dims, _details, _views, _sheets;
        private readonly List<KeyValuePair<CheckBox, CopySourceView>> _viewChecks = new List<KeyValuePair<CheckBox, CopySourceView>>();

        public CopyToOtherDialog(string summary, List<CopySourceView> views, CopyToOtherPrefs prefs)
        {
            // Хэмжээ/байрлал (дэлгэцийн ажлын талбарт багтана) + дундын сэдэв; агуулга гүйлгэгддэг, товчнууд ҮРГЭЛЖ харагдана.
            Ui.MglWindow.Setup(this, "MGL — Элемент хуулах", 560, 0, 480, 0, sizeToContentHeight: true, resizable: true);
            Ui.MglTheme.Apply(this);

            var root = new StackPanel { Margin = new Thickness(16, 16, 16, 8) };
            var heading = Ui.MglUi.Heading("А хэсэгт хийснээ Б хэсэг рүү хуулах");
            heading.Margin = new Thickness(0, 0, 0, 4);
            root.Children.Add(heading);
            root.Children.Add(Ui.MglUi.Muted(summary));
            root.Children.Add(Ui.MglUi.Muted("Дараагийн алхам: «Үргэлжлүүлэх» дарсны дараа Revit-ийн план дээр цэг сонгоно."));
            ((TextBlock)root.Children[root.Children.Count - 1]).Margin = new Thickness(0, 2, 0, 0);

            // Арга
            var mode = new StackPanel();
            _move = Radio(mode, "Шилжүүлэх", "A цэг → B цэг.  Олон байршилд дараалан тавьж болно.");
            _rotate = Radio(mode, "Эргүүлж байрлуулах", "A дээр 2 цэг → B дээр харгалзах 2 цэг.  Өнцгийг автоматаар тооцно.");
            _mirror = Radio(mode, "Толин тусгал", "Тэнхлэгийн 2 цэг — А ба Б нь хоорондоо толин дүр бол.");
            (prefs.Mode == "rotate" ? _rotate : prefs.Mode == "mirror" ? _mirror : _move).IsChecked = true;
            root.Children.Add(Group("Байрлуулах арга", mode));

            // Тэмдэглэгээ
            var what = new StackPanel();
            _tags = Check(what, "Tag (хаалга, хана, тавилга …)", prefs.Tags);
            _roomTags = Check(what, "Өрөөний tag", prefs.RoomTags);
            _dims = Check(what, "Хэмжээс — утгыг нь А-тай тулгаж шалгана", prefs.Dimensions);
            _details = Check(what, "2D тэмдэглэгээ — зураас, текст, штрих, detail component", prefs.Details);
            what.Children.Add(Hint("Б-д аль хэдийн байгаа элементийг дахин хуулахгүй — зөвхөн зураг нь нэмэгдэнэ."));
            root.Children.Add(Group("Юуг хуулах", what));

            // Харагдац, хуудас
            var draw = new StackPanel();
            _views = Check(draw, "А-гийн зүсэлт, планыг Б-д шинээр үүсгэх", prefs.CloneViews);
            if (views.Count == 0)
            {
                draw.Children.Add(Hint("А-г тусгайлан харуулдаг (тайрсан) харагдац олдсонгүй."));
            }
            else
            {
                var list = new StackPanel();
                foreach (CopySourceView v in views)
                {
                    var cb = new CheckBox
                    {
                        Content = v.Label + (string.IsNullOrEmpty(v.SheetNumber) ? "" : "   [хуудас " + v.SheetNumber + "]"),
                        IsChecked = true,
                        Margin = new Thickness(18, 2, 0, 2),
                    };
                    list.Children.Add(cb);
                    _viewChecks.Add(new KeyValuePair<CheckBox, CopySourceView>(cb, v));
                }
                draw.Children.Add(new ScrollViewer
                {
                    Content = list,
                    MaxHeight = 170,
                    VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                });
                _views.Checked += (s, e) => list.IsEnabled = true;
                _views.Unchecked += (s, e) => list.IsEnabled = false;
                list.IsEnabled = _views.IsChecked == true;
            }
            _sheets = Check(draw, "Эх харагдац хуудсан дээр байвал Б-д шинэ хуудас үүсгэх", prefs.CloneSheets);
            draw.Children.Add(Hint("Б тухайн харагдацад аль хэдийн харагдаж байвал шинээр үүсгэхгүй — тэмдэглэгээ тэнд нь нэмэгдэнэ."));
            root.Children.Add(Group("Зураг", draw));

            // Товч — гүйлгэгддэг агуулгаас ГАДУУР (доод талд тогтмол), жижиг дэлгэц дээр ч хүрнэ.
            var buttons = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                HorizontalAlignment = HorizontalAlignment.Right,
                Margin = new Thickness(16, 8, 16, 14),
            };
            var ok = new Button { Content = "Үргэлжлүүлэх", IsDefault = true, MinWidth = 120, Padding = new Thickness(10, 4, 10, 4) };
            ok.Click += (s, e) => DialogResult = true;
            Ui.MglUi.Primary(ok);
            var cancel = new Button { Content = "Болих", IsCancel = true, MinWidth = 90, Margin = new Thickness(8, 0, 0, 0), Padding = new Thickness(10, 4, 10, 4) };
            buttons.Children.Add(ok);
            buttons.Children.Add(cancel);

            root.Children.Add(Ui.MglUi.Muted("Бүх хуулалт нэг Ctrl+Z-ээр буцна."));
            ((TextBlock)root.Children[root.Children.Count - 1]).Margin = new Thickness(0, 12, 0, 0);

            var dock = new DockPanel();
            DockPanel.SetDock(buttons, Dock.Bottom);
            dock.Children.Add(buttons);
            dock.Children.Add(new ScrollViewer
            {
                Content = root,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            });
            Content = dock;
        }

        public CopyPlacementKind Mode =>
            _rotate.IsChecked == true ? CopyPlacementKind.Rotate
            : _mirror.IsChecked == true ? CopyPlacementKind.Mirror
            : CopyPlacementKind.Move;

        public CopyToOtherOptions ToOptions() => new CopyToOtherOptions
        {
            Tags = _tags.IsChecked == true,
            RoomTags = _roomTags.IsChecked == true,
            Dimensions = _dims.IsChecked == true,
            Details = _details.IsChecked == true,
            CloneViews = _views.IsChecked == true,
            CloneSheets = _sheets.IsChecked == true && _views.IsChecked == true,
            ViewFilter = new HashSet<ElementId>(_viewChecks.Where(kv => kv.Key.IsChecked == true).Select(kv => kv.Value.Id)),
        };

        public CopyToOtherPrefs ToPrefs() => new CopyToOtherPrefs
        {
            Mode = Mode == CopyPlacementKind.Rotate ? "rotate" : Mode == CopyPlacementKind.Mirror ? "mirror" : "move",
            Tags = _tags.IsChecked == true,
            RoomTags = _roomTags.IsChecked == true,
            Dimensions = _dims.IsChecked == true,
            Details = _details.IsChecked == true,
            CloneViews = _views.IsChecked == true,
            CloneSheets = _sheets.IsChecked == true,
        };

        private static GroupBox Group(string header, UIElement content) => new GroupBox
        {
            Header = header,
            Content = content,
            Margin = new Thickness(0, 12, 0, 0),
            Padding = new Thickness(8, 6, 8, 6),
        };

        private static RadioButton Radio(System.Windows.Controls.Panel parent, string text, string hint)
        {
            var rb = new RadioButton { GroupName = "mode", Margin = new Thickness(0, 3, 0, 0) };
            var body = new StackPanel();
            body.Children.Add(new TextBlock { Text = text, FontWeight = FontWeights.SemiBold });
            body.Children.Add(Ui.MglUi.Muted(hint));
            rb.Content = body;
            AutomationProperties.SetName(rb, text);
            AutomationProperties.SetHelpText(rb, hint);
            parent.Children.Add(rb);
            return rb;
        }

        private static CheckBox Check(System.Windows.Controls.Panel parent, string text, bool value)
        {
            var cb = new CheckBox { Content = text, IsChecked = value, Margin = new Thickness(0, 3, 0, 0) };
            parent.Children.Add(cb);
            return cb;
        }

        private static TextBlock Hint(string text)
        {
            TextBlock t = Ui.MglUi.Muted(text);
            t.Margin = new Thickness(0, 6, 0, 0);
            return t;
        }
    }
}
