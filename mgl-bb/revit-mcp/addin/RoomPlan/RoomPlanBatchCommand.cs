using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using Autodesk.Revit.DB.Structure;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Selection;
using RevitMcpAddin.RoomPlan.Core;
using RevitMcpAddin.Ui;

namespace RevitMcpAddin.RoomPlan
{
    /// <summary>
    /// One local Python generation call for multiple existing Floor elements.
    /// ONE Revit transaction for ALL selected unit applications: all-or-nothing.
    /// Does not call MGL AI, inference services, cloud APIs or the Revit MCP.
    /// Existing add-in company license gate is intentionally preserved.
    /// </summary>
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public sealed class RoomPlanBatchCommand : IExternalCommand
    {
        private const string Title = "MGL — Олон өрөөний план (Python)";

        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            if (!Licensing.LicenseGate.Ensure()) return Result.Cancelled;
            UIDocument ui = commandData.Application.ActiveUIDocument;
            Document doc = ui == null ? null : ui.Document;
            ViewPlan view = ui == null ? null : ui.ActiveView as ViewPlan;
            if (doc == null || view == null || view.ViewType != ViewType.FloorPlan ||
                view.IsTemplate || doc.IsFamilyDocument || doc.IsReadOnly || view.GenLevel == null)
            {
                TaskDialog.Show(Title, "Засварлаж болох Revit Floor Plan нээгээд дахин оролдоно уу.");
                return Result.Cancelled;
            }
            Level level = view.GenLevel;

            // «Давхрын план»-аар тавьсан, тавилгагүй давхар: асуулт, цонхгүйгээр тавилгыг шууд байрлуулна (эзэн 2026-10-14 —
            // «room plan дарж нэг товчоор тавилга»).  Бусад тохиолдолд айл бүрийн шалаар ажилладаг хуучин урсгал хэвээр.
            if (FloorStudioEngine.HasUnfurnished(doc, level.Id))
            {
                StudioApplyOutcome outcome = FloorStudioEngine.Furnish(FloorStudioEngine.Capture(ui));
                FloorStudioPaneProvider.Show(commandData.Application);
                FloorStudioPaneProvider.View.ShowOutcome(outcome);
                if (!outcome.Ok) message = outcome.Message;
                return outcome.Ok ? Result.Succeeded : Result.Cancelled;
            }

            // Хоосон БҮТЭН давхар (нэг айлаас том шал — 30 м-ээс урт эсвэл 250 м²-аас том): айл бүрээр биш, давхрын студиор —
            // цонх, асуултгүй.  Өмнө нь бүтэн давхрыг нэг айл гэж Python-д илгээж «Нэгжийн өргөн 7.8–30 м» гэж унадаг байв
            // (эзэн 2026-10-14).  Архитектор айл бүрийн шалыг зурсан бол (хамгийн том шал нь нэг айл) доорх хуучин урсгал.
            if (OpenStudioForStorey(commandData.Application, ui)) return Result.Succeeded;

            IList<Reference> refs;
            try
            {
                refs = ui.Selection.PickObjects(ObjectType.Element, new FloorFilter(),
                    "Нэг эсвэл олон тусдаа тэгш өнцөгт Floor-ыг Ctrl-ээр сонгоод Finish дарна уу (24 хүртэл).");
            }
            catch (Autodesk.Revit.Exceptions.OperationCanceledException) { return Result.Cancelled; }
            if (refs == null || refs.Count == 0 || refs.Count > 24)
            {
                TaskDialog.Show(Title, "1–24 Floor сонгоно уу.");
                return Result.Cancelled;
            }
            var floors = refs.Select(r => doc.GetElement(r) as Floor).ToList();
            if (floors.Any(f => f == null) || floors.Select(f => f.Id).Distinct().Count() != floors.Count)
            {
                TaskDialog.Show(Title, "Сонголтод давхардсан эсвэл буруу Floor байна.");
                return Result.Cancelled;
            }

            var requests = new List<PythonUnitRequest>();
            try
            {
                for (int i = 0; i < floors.Count; i++)
                {
                    var boundary = ExistingFloorBoundary.Read(doc, floors[i], level);
                    requests.Add(new PythonUnitRequest
                    {
                        Id = "U" + (i + 1).ToString("00"),
                        Boundary = boundary, Bedrooms = 2
                    });
                }
            }
            catch (ArgumentException ex)
            {
                TaskDialog.Show(Title, "Floor таних алдаа: " + ex.Message +
                    "\nОдоохондоо дөрвөн шулуун гадна ханатай нэгжүүдийг л дэмжинэ.");
                return Result.Cancelled;
            }
            if (requests.Any(r => IsStoreySized(r.Boundary.WidthMeters, r.Boundary.HeightMeters)))
            {
                FloorStudioPaneProvider.Show(commandData.Application);
                FloorStudioPaneProvider.View.Start(FloorStudioEngine.Capture(ui));
                return Result.Succeeded;
            }
            // Do not accept coincident / overlapping floor footprints as distinct apartments.
            for (int i = 0; i < requests.Count; i++)
                for (int j = i + 1; j < requests.Count; j++)
                    if (RoomPlanBatchApply.FootprintsOverlap(requests[i].Boundary, requests[j].Boundary))
                    {
                        TaskDialog.Show(Title, "Нэгжийн шалнууд давхацсан байна: " +
                            requests[i].Id + " / " + requests[j].Id);
                        return Result.Cancelled;
                    }
            if (RoomPlanBatchApply.HasOccupied(doc, level, requests))
            {
                TaskDialog.Show(Title, "Сонгосон нэгжүүдэд өмнө нь дотор хана, Room, Door, " +
                    "цонх, тавилга эсвэл багана байна. Давхар элемент үүсгэхгүй.");
                return Result.Cancelled;
            }

            try
            {
                // Entrance is selected independently for each floor.
                foreach (var request in requests)
                {
                    TaskDialog.Show(Title, request.Id + " — орох хаалга байрлуулах 4 гадна ханын нэгийг сонгоно уу.");
                    request.Entry = request.Boundary.PickEntrance(ui);
                }
            }
            catch (Autodesk.Revit.Exceptions.OperationCanceledException) { return Result.Cancelled; }

            // Finch-style defaults: daylight on every side that is neither the
            // entrance nor a wall shared with another selected apartment; a
            // bedroom count that suits the floor area.  All editable next.
            foreach (var request in requests)
            {
                request.Facades = RoomPlanBatchApply.DetectFacades(request, requests);
                RoomPlanBatchApply.SuggestProgram(request);
                request.ExteriorWallThickness = RoomPlanBatchApply.ExteriorThickness(request.Boundary);
            }
            return RunPipeline(commandData, doc, level, view, requests, ref message, true, out _);
        }

        /// <summary>
        /// Нэгж бүрийн хөтөлбөр → Python хувилбарууд → сонголт → Family → НЭГ transaction-оор хэрэгжүүлэх.
        /// «Олон өрөөний план» (айл бүр тусдаа Floor) ба «Давхрын план» (давхрыг айлуудад хуваасан) хоёулаа энд.
        /// <paramref name="summary"/> = false бол дуудагч өөрийн дүнгийн цонхыг харуулна.
        /// </summary>
        /// <summary>Нэг айлд хэт том шал: аль нэг тал нь Python-ы дээд хэмжээ 30 м-ээс урт, эсвэл 250 м²-аас том.</summary>
        internal static bool IsStoreySized(double widthM, double heightM)
        {
            return widthM > 30 || heightM > 30 || widthM * heightM > 250;
        }

        /// <summary>Идэвхтэй давхрын хамгийн том шал бүтэн давхар бөгөөд хоосон бол «Давхрын план» самбарыг нээгээд true.</summary>
        private static bool OpenStudioForStorey(UIApplication app, UIDocument ui)
        {
            StudioStorey storey = FloorStudioEngine.Capture(ui);
            if (storey.Problem != null || !IsStoreySized(storey.WidthM, storey.HeightM)) return false;
            FloorStudioPaneProvider.Show(app);
            FloorStudioPaneProvider.View.Start(storey);
            return true;
        }

        internal static Result RunPipeline(ExternalCommandData commandData, Document doc, Level level, ViewPlan view,
            List<PythonUnitRequest> requests, ref string message, bool summary, out RoomPlanApplyResult made)
        {
            made = null;
            var setup = new BatchBedroomsWindow(requests);
            if (App.ShowOwned(setup, commandData.Application.MainWindowHandle) != true)
                return Result.Cancelled;

            PythonBatch batch;
            var progress = new RoomPlanProgressWindow(requests);
            App.ShowOwned(progress, commandData.Application.MainWindowHandle);
            if (progress.Failure != null)
            {
                TaskDialog.Show(Title, "Python локал хөдөлгүүр ажилласангүй:\n" + progress.Failure.Message);
                return Result.Failed;
            }
            batch = progress.Result;
            if (batch == null) return Result.Cancelled;
            if (batch.Units.Count != requests.Count)
            {
                TaskDialog.Show(Title, "Python хариу нэгжийн тоотой таарахгүй. RVT өөрчлөгдөөгүй.");
                return Result.Failed;
            }
            var empty = batch.Units.Where(u => u.Options.Count == 0).ToList();
            if (empty.Count > 0)
            {
                string why = string.Join("\n", empty.Select(u => u.Id + " (" +
                    u.Boundary.WidthMeters.ToString("0.0") + "×" + u.Boundary.HeightMeters.ToString("0.0") +
                    " м, " + u.Bedrooms + " унтлагын, " + u.Bathrooms + " АЦӨ): " +
                    (u.Error ?? "энэ хэмжээнд шалгуур давсан төлөвлөлт олдсонгүй — өрөөний тоог багасгана уу")));
                if (empty.Count == batch.Units.Count)
                {
                    TaskDialog.Show(Title, "Төлөвлөлт олдсонгүй:\n" + why + "\nRVT өөрчлөгдөөгүй.");
                    return Result.Cancelled;
                }
                var ask = new TaskDialog(Title)
                {
                    MainInstruction = empty.Count + " нэгжид төлөвлөлт олдсонгүй",
                    MainContent = why + "\n\nҮлдсэн " + (batch.Units.Count - empty.Count) +
                        " нэгжээр үргэлжлүүлэх үү?",
                    CommonButtons = TaskDialogCommonButtons.Yes | TaskDialogCommonButtons.No,
                    DefaultButton = TaskDialogResult.Yes
                };
                if (ask.Show() != TaskDialogResult.Yes) return Result.Cancelled;
                var skip = new HashSet<string>(empty.Select(u => u.Id), StringComparer.Ordinal);
                batch.Units.RemoveAll(u => skip.Contains(u.Id));
                requests.RemoveAll(r => skip.Contains(r.Id));
            }

            var preview = new RoomPlanBatchPreview(batch);
            if (App.ShowOwned(preview, commandData.Application.MainWindowHandle) != true)
                return Result.Cancelled;
            var selected = preview.Selected;
            if (selected.Count != requests.Count) return Result.Cancelled;
            string crossUnitIssue = RoomPlanBatchApply.CheckSharedBoundaryDoorConflicts(batch, selected);
            if (crossUnitIssue != null)
            {
                TaskDialog.Show(Title, crossUnitIssue +
                    "\nСонголтоо өөрчилж, дахин үүсгэнэ үү. RVT-д өөрчлөлт хийгдээгүй.");
                return Result.Cancelled;
            }

            // Confirm prerequisites BEFORE even starting Revit transaction.
            Element roomTagType = new FilteredElementCollector(doc)
                .OfCategory(BuiltInCategory.OST_RoomTags).WhereElementIsElementType().FirstOrDefault();
            if (roomTagType == null)
            {
                TaskDialog.Show(Title, "Room Tag Family байхгүй.");
                return Result.Cancelled;
            }
            var picker = new RoomPlanFamilyPicker(doc, selected.Values.SelectMany(o => o.Plan.Furnishings));
            if (App.ShowOwned(picker, commandData.Application.MainWindowHandle) != true ||
                picker.Selected == null) return Result.Cancelled;
            WallType wallType = doc.GetElement(picker.WallTypeId) as WallType;
            if (wallType == null || wallType.Kind != WallKind.Basic)
            {
                TaskDialog.Show(Title, "Дотор ханын төрөл хүчингүй. Өөрчлөлт хийгдээгүй.");
                return Result.Cancelled;
            }
            FamilySymbol doorType = doc.GetElement(picker.DoorSymbolId) as FamilySymbol;
            if (doorType == null || doorType.Family == null ||
                doorType.Family.FamilyPlacementType != FamilyPlacementType.OneLevelBasedHosted)
            {
                TaskDialog.Show(Title, "Door Family сонголт хүчингүй.");
                return Result.Cancelled;
            }
            // Interior doors go into the chosen partition type, entry doors into the
            // existing perimeter walls: prove Revit can build the door in each BEFORE
            // anything is created (a failure at commit rolls back every unit).
            string doorProblem = RoomPlanBatchApply.DoorHostProblem(doc, level,
                new[] { wallType }.Concat(requests.SelectMany(r => r.Boundary.Perimeter.Values)
                    .Select(w => w.WallType)), doorType);
            if (doorProblem != null)
            {
                TaskDialog.Show(Title, doorProblem + "\nRVT өөрчлөгдөөгүй.");
                return Result.Cancelled;
            }

            // Re-check every floor and every perimeter wall after modal dialogs.
            try
            {
                foreach (var request in requests)
                {
                    var old = request.Boundary;
                    if (old.Virtual)
                    {
                        // Давхрын планы айл: өөрийн шалгүй — хүрээний хана бүр хэвээр, тэнхлэг нь хөдлөөгүй эсэх.
                        if (old.Perimeter.Values.Any(w => w == null || !w.IsValidObject) || !old.AxesStillMatch())
                            throw new InvalidOperationException(request.Id + " — коридор/айл хоорондын хана өөрчлөгдсөн.");
                        continue;
                    }
                    var fresh = ExistingFloorBoundary.Read(doc, old.Floor, level);
                    if (Math.Abs(old.MinX - fresh.MinX) > 0.01 ||
                        Math.Abs(old.MinY - fresh.MinY) > 0.01 ||
                        Math.Abs(old.MaxX - fresh.MaxX) > 0.01 ||
                        Math.Abs(old.MaxY - fresh.MaxY) > 0.01 ||
                        old.Perimeter.Any(k => fresh.Perimeter[k.Key].Id != k.Value.Id))
                        throw new InvalidOperationException(request.Id + " — гадна хана/шал өөрчлөгдсөн.");
                }
                if (doc.IsReadOnly || RoomPlanBatchApply.HasOccupied(doc, level, requests))
                    throw new InvalidOperationException("Нэгжүүдийн одоогийн загвар өөрчлөгдсөн.");
            }
            catch (Exception ex)
            {
                TaskDialog.Show(Title, ex.Message + "\nДахин Generate хийнэ үү.");
                return Result.Cancelled;
            }

            try
            {
                made = RoomPlanBatchApply.Apply(doc, level, view, batch, selected,
                    wallType, doorType, picker.Selected);
            }
            catch (Exception ex)
            {
                message = ex.Message;
                foreach (var unit in batch.Units)
                    RoomPlanPythonBridge.TryEvent(batch,unit,selected[unit.Id],"apply_failed",null,out _);
                TaskDialog.Show(Title, "Batch бүтэлгүй. Бүх нэгжийн transaction буцаагдсан.\n" + ex.Message);
                return Result.Failed;
            }

            var failedLogs = new List<string>();
            // 'Applied' is emitted ONLY after the entire transaction commits.
            foreach (var unit in batch.Units)
                if (!RoomPlanPythonBridge.TryEvent(batch,unit,selected[unit.Id],"applied",null,out string err))
                    failedLogs.Add(unit.Id + ": " + err);
            made.FeedbackErrors.AddRange(failedLogs);
            if (!summary) return Result.Succeeded;
            TaskDialog.Show(Title, batch.Units.Count + " нэгжийн plan-ыг нэг transaction-аар үүсгэлээ.\n" +
                made.Walls.Count + " дотор хана · " + made.Rooms.Count + " Room/Tag · " +
                made.Doors.Count + " Door · " + made.Furniture.Count + " Furniture.\n" +
                "Нэг Ctrl+Z: бүх нэгжийг буцаана.\n" +
                (made.FurnitureDropped.Count == 0 ? "" : "Family-ийн хэмжээ багтаагүй тул орхисон: " +
                    string.Join("; ", made.FurnitureDropped) + "\n") +
                (failedLogs.Count == 0 ? "Local хэрэглээний тэмдэглэл хадгалагдсан." :
                    "⚠ SQLite feedback бичихэд алдаа гарлаа:\n" + string.Join("\n", failedLogs)));
            return Result.Succeeded;
        }

        private sealed class FloorFilter : ISelectionFilter
        {
            public bool AllowElement(Element element) { return element is Floor; }
            public bool AllowReference(Reference r, XYZ p) { return false; }
        }
    }

    internal sealed class BatchBedroomsWindow : Window
    {
        private static readonly string[] Sides = { "north", "east", "south", "west" };
        private static readonly string[] SideLabels = { "Хойд", "Зүүн", "Урд", "Баруун" };
        private static readonly string[] Tiers = { "economy", "standard", "luxury" };
        private static readonly string[] TierLabels = { "Энгийн", "Дунд", "Тансаг" };

        internal BatchBedroomsWindow(List<PythonUnitRequest> requests)
        {
            Title = "MGL — Нэгж бүрийн хөтөлбөр";
            MglWindow.Setup(this, Title, 1000, 640, 700, 380, prefsKey:"roomplan-bedroom-setup");
            var layout = new DockPanel { Margin = new Thickness(16) };
            var footer = new StackPanel { Orientation = Orientation.Horizontal,
                HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0,12,0,0) };
            footer.Children.Add(new TextBlock { Text = "Коридорын өргөн:",
                VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0,0,6,0) });
            var hall = new System.Windows.Controls.ComboBox { Width = 90, MinHeight = 28 };
            foreach (string value in new[] { "1.2 м", "1.4 м", "1.6 м" }) hall.Items.Add(value);
            hall.SelectedIndex = 1;
            hall.SelectionChanged += (s, e) =>
            {
                double w = 1.2 + 0.2 * hall.SelectedIndex;
                foreach (var r in requests) r.HallWidth = w;
            };
            footer.Children.Add(hall);
            var cancel = new Button { Content = "Цуцлах", IsCancel = true, MinWidth = 85,
                Margin = new Thickness(24,0,0,0) };
            cancel.Click += (s,e) => { DialogResult=false; Close(); };
            var next = new Button { Content = "Төлөвлөлт үүсгэх", IsDefault = true,
                Margin = new Thickness(12,0,0,0), MinWidth=150 };
            next.Click += (s,e) => { DialogResult=true; Close(); };
            footer.Children.Add(cancel); footer.Children.Add(next);
            DockPanel.SetDock(footer,Dock.Bottom); layout.Children.Add(footer);
            var list = new StackPanel { Margin = new Thickness(0,0,0,6) };
            list.Children.Add(new TextBlock { Text = "Нэгж бүрийн өрөөний тоог талбайгаас нь санал болгосон. " +
                "Цонх гаргаж болох (гэрэл тусах) талуудыг сонгосон нэгжүүдийн хуваалцсан хана, орох " +
                "хаалганаас автоматаар тогтоосон — шаардлагатай бол засна. Гэрэлтэй өрөө ихтэй хувилбар " +
                "дээгүүр эрэмбэлэгдэнэ.", TextWrapping=TextWrapping.Wrap, Margin=new Thickness(0,0,0,12) });
            foreach (var unit in requests)
            {
                var row = new WrapPanel { Margin=new Thickness(0,0,0,10) };
                row.Children.Add(new TextBlock { Text=unit.Id + " · " +
                    unit.Boundary.WidthMeters.ToString("0.0") + " × " +
                    unit.Boundary.HeightMeters.ToString("0.0") + " м · " +
                    (unit.Boundary.WidthMeters * unit.Boundary.HeightMeters).ToString("0") + " м²",
                    Width=200,VerticalAlignment=VerticalAlignment.Center });
                var beds = new System.Windows.Controls.ComboBox { Width=150,MinHeight=28 };
                for (int i = 1; i <= 4; i++) beds.Items.Add(i + " унтлагын өрөө");
                beds.SelectedIndex = Math.Max(0, Math.Min(3, unit.Bedrooms - 1));
                var baths = new System.Windows.Controls.ComboBox { Width=110,MinHeight=28,
                    Margin = new Thickness(8,0,0,0) };
                baths.Items.Add("1 АЦӨ"); baths.Items.Add("2 АЦӨ");
                baths.SelectedIndex = Math.Max(0, Math.Min(1, unit.Bathrooms - 1));
                // Furniture class: sizes and the set of furniture (python plan_furniture.TIERS).
                var tier = new System.Windows.Controls.ComboBox { Width=120,MinHeight=28,
                    Margin = new Thickness(8,0,0,0), ToolTip = "Тавилгын зэрэглэл: хэмжээ ба багц" };
                foreach (string t in TierLabels) tier.Items.Add(t);
                tier.SelectedIndex = Math.Max(0, Array.IndexOf(Tiers, unit.Tier));
                var selectedUnit=unit;
                beds.SelectionChanged += (s,e) => selectedUnit.Bedrooms=beds.SelectedIndex+1;
                baths.SelectionChanged += (s,e) => selectedUnit.Bathrooms=baths.SelectedIndex+1;
                tier.SelectionChanged += (s,e) => selectedUnit.Tier=Tiers[Math.Max(0, tier.SelectedIndex)];
                row.Children.Add(beds); row.Children.Add(baths); row.Children.Add(tier);
                var light = new StackPanel { Orientation = Orientation.Horizontal,
                    Margin = new Thickness(14,0,0,0), VerticalAlignment = VerticalAlignment.Center };
                light.Children.Add(new TextBlock { Text = "☀ цонхтой тал:", Margin = new Thickness(0,0,6,0),
                    VerticalAlignment = VerticalAlignment.Center });
                string entry = unit.Entry.ToString().ToLowerInvariant();
                for (int i = 0; i < Sides.Length; i++)
                {
                    string side = Sides[i];
                    var box = new CheckBox { Content = SideLabels[i] + (side == entry ? " (орц)" : ""),
                        IsChecked = unit.Facades.Contains(side), Margin = new Thickness(0,0,8,0),
                        VerticalAlignment = VerticalAlignment.Center };
                    box.Checked += (s,e) => { if (!selectedUnit.Facades.Contains(side)) selectedUnit.Facades.Add(side); };
                    box.Unchecked += (s,e) => selectedUnit.Facades.Remove(side);
                    light.Children.Add(box);
                }
                row.Children.Add(light);
                list.Children.Add(row);
            }
            layout.Children.Add(new ScrollViewer { Content=list,
                VerticalScrollBarVisibility=ScrollBarVisibility.Auto });
            Content=layout;
            MglTheme.Apply(this); MglUi.Primary(next);
        }
    }

    /// <summary>
    /// Runs the local Python generation on a worker thread while Revit's UI
    /// keeps repainting.  The Python call touches no Revit API, so this is
    /// safe; the Revit transaction still happens on the API thread later.
    /// </summary>
    internal sealed class RoomPlanProgressWindow : Window
    {
        internal PythonBatch Result;
        internal Exception Failure;

        internal RoomPlanProgressWindow(List<PythonUnitRequest> requests)
        {
            Title = "MGL — Төлөвлөлт үүсгэж байна";
            MglWindow.Setup(this, Title, 460, 170, 380, 150, prefsKey: "roomplan-progress");
            ResizeMode = ResizeMode.NoResize;
            var panel = new StackPanel { Margin = new Thickness(18) };
            panel.Children.Add(new TextBlock { Text = requests.Count + " нэгжид олон төрлийн төлөвлөлт " +
                "үүсгэж, шалгаж, эрэмбэлж байна… (локал Python, интернэтгүй)", TextWrapping = TextWrapping.Wrap });
            panel.Children.Add(new ProgressBar { IsIndeterminate = true, Height = 16,
                Margin = new Thickness(0, 14, 0, 0) });
            Content = panel;
            MglTheme.Apply(this);
            var snapshot = requests.ToList();
            bool finished = false;
            // The worker cannot be cancelled mid-way (it is one short local
            // process with its own 60 s timeout), so the window stays until it
            // reports back instead of leaving an orphaned result.
            Closing += (s, e) => { if (!finished) e.Cancel = true; };
            Loaded += (s, e) =>
            {
                System.Threading.Tasks.Task.Run(() => RoomPlanPythonBridge.Generate(snapshot))
                    .ContinueWith(t => Dispatcher.BeginInvoke(new Action(() =>
                    {
                        if (t.IsFaulted) Failure = t.Exception.GetBaseException();
                        else Result = t.Result;
                        finished = true;
                        DialogResult = Failure == null;
                    })));
            };
        }
    }
}
