using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using RevitMcpAddin.RoomPlan;
using RevitMcpAddin.RoomPlan.Core;
using WpfGrid = System.Windows.Controls.Grid;

namespace MglRpGate
{
    /// <summary>
    /// «Давхрын план» студи (нэг товч, цонхгүй) — production-ий `FloorStudioEngine`-ийг самбаргүйгээр:
    /// хоосон давхар → `Capture` → `Generate` (олон зуун бүтэн давхрын хувилбар, Python зэрэгцээ) → шилдэг 20 (PNG) →
    /// №1-ийг тавих → шалгах → тавилга (нэг товч) → шалгах → №2-оор солих → шалгах → Ctrl+Z нь тавилгатай №1-ийг сэргээнэ.
    /// </summary>
    internal static class StudioScenario
    {
        private sealed class St
        {
            public readonly Scenario.State S = new Scenario.State();
            public StudioStorey Storey;
            public StudioGeneration Gen;
            public List<StudioCandidate> Top;
            public StudioApplyOutcome First, Furnished, Second;
        }

        public static void Build(GateRunner r)
        {
            var t = new St();
            r.Enqueue("studio.plate.build", app => { t.S.PlatePath = PlateFactory.BuildFloor(app.Application, r.Job, r.Facts); return StepState.Done; }, 15, true);
            r.Enqueue("studio.open", app => Scenario.Open(r, t.S, app), 10, true);
            r.Enqueue("studio.capture", app => Capture(r, t, app), 2, true);
            r.Enqueue("studio.generate", app => Generate(r, t), 10, true);
            r.Enqueue("studio.top20-sheet", app => ContactSheet(r, t));
            r.Enqueue("studio.apply-1", app => Apply(r, t, 0), 10, true);
            r.Enqueue("studio.verify-plan", app => Verify(r, t, "plan"));
            r.Enqueue("studio.furnish", app => Furnish(r, t), 10, true);
            r.Enqueue("studio.verify-furnished", app => Verify(r, t, "furnished"));
            r.Enqueue("studio.export", app => Scenario.Export(r, t.S, app));
            r.Enqueue("studio.replace-2", app => Apply(r, t, 1), 10, true);
            r.Enqueue("studio.verify-replaced", app => Verify(r, t, "replaced"));
            r.Enqueue("studio.undo", app => Scenario.PostEdit(r, app, true));
            r.Enqueue("studio.undo-check", app => AfterUndo(r, t), 2);
            r.Enqueue("studio.save", app => Scenario.Save(r, t.S, app));
        }

        private static StepState Capture(GateRunner r, St t, UIApplication app)
        {
            t.Storey = FloorStudioEngine.Capture(app.ActiveUIDocument);
            r.Facts["capture.title"] = t.Storey.Title;
            r.Facts["capture.partition_m"] = Math.Round(t.Storey.PartitionM, 3);
            r.Facts["capture.exterior_m"] = Math.Round(t.Storey.ExteriorM, 3);
            return t.Storey.Problem == null ? StepState.Done : r.Fail(t.Storey.Problem);
        }

        private static StepState Generate(GateRunner r, St t)
        {
            int last = -1;
            t.Gen = FloorStudioEngine.Generate(t.Storey, (text, v) =>
            {
                int q = (int)(v * 4);
                if (q != last) { last = q; GateLog.Info("studio: " + text); }
            }, CancellationToken.None);
            StudioGeneration g = t.Gen;
            r.Facts["generate.splits"] = g.Splits.Count;
            r.Facts["generate.unit_requests"] = g.UnitRequests;
            r.Facts["generate.python_batches"] = g.PythonBatches;
            r.Facts["generate.failed_units"] = g.FailedUnits;
            r.Facts["generate.seconds"] = Math.Round(g.Seconds, 2);
            r.Facts["generate.pool"] = g.Pool.Count;
            r.Facts["generate.pool_fully_lit"] = g.Pool.Count(c => c.LitUnits == c.Split.Layout.Units.Count);
            r.Facts["generate.pool_by_tier"] = string.Join(" · ", g.Pool.GroupBy(c => c.Split.Tier).Select(x => x.Key + " " + x.Count()));
            r.Facts["generate.pool_by_mix"] = string.Join(" · ", g.Pool.GroupBy(c => c.Split.Preset.Key).Select(x => x.Key + " " + x.Count()));
            r.Facts["generate.score_range"] = g.Pool.Count == 0 ? "—" : g.Pool.Min(c => c.Score).ToString("0.0") + " … " + g.Pool.Max(c => c.Score).ToString("0.0");
            if (g.Error != null && g.Pool.Count == 0) return r.Fail(g.Error);
            var problems = new List<string>();
            if (g.Pool.Count < 100) problems.Add("хувилбар " + g.Pool.Count + " (≥ 100 байх ёстой)");
            if (g.Pool.Count > FloorStudio.MaxPool) problems.Add("хувилбар " + g.Pool.Count + " > " + FloorStudio.MaxPool);
            if (g.Pool.Select(c => c.Signature).Distinct().Count() != g.Pool.Count) problems.Add("давхардсан хувилбар бий");
            t.Top = FloorStudio.Recommend(g.Pool, 20);
            if (t.Top.Count != 20) problems.Add("санал болгосон " + t.Top.Count + " (20 байх ёстой)");
            foreach (StudioCandidate c in t.Top)
            {
                FloorPlateLayout l = c.Split.Layout;
                r.Facts["top." + c.Rank.ToString("00")] = c.Score.ToString("0.0") + " · " + FloorStudio.Describe(c.Split) + " · " + l.Units.Count + " айл " +
                    FloorStudio.MixText(l) + " · ☀" + c.LitUnits + "/" + l.Units.Count + " · ↔" + c.DualAspectUnits + " · үр ашиг " +
                    (l.Efficiency * 100).ToString("0") + "% · " + c.Style;
            }
            r.Facts["top.fully_lit"] = t.Top.Count(c => c.LitUnits == c.Split.Layout.Units.Count) + "/" + t.Top.Count;
            r.Facts["top.distinct_splits"] = t.Top.Select(c => c.Split.Signature).Distinct().Count();
            return problems.Count == 0 ? StepState.Done : r.Fail(string.Join("; ", problems));
        }

        /// <summary>Шилдэг 20-ын план нэг PNG дээр — самбарын картын ижил зураг.</summary>
        private static StepState ContactSheet(GateRunner r, St t)
        {
            const int cols = 4;
            var sheet = new WpfGrid { Background = Brushes.White };
            int rows = (t.Top.Count + cols - 1) / cols;
            for (int i = 0; i < cols; i++) sheet.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(440) });
            for (int i = 0; i < rows; i++) sheet.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            for (int i = 0; i < t.Top.Count; i++)
            {
                StudioCandidate c = t.Top[i];
                FloorPlateLayout l = c.Split.Layout;
                var cell = new StackPanel { Margin = new Thickness(10) };
                cell.Children.Add(new TextBlock { Text = "№" + c.Rank + "  " + c.Score.ToString("0.0") + " оноо", FontWeight = FontWeights.Bold, FontSize = 14 });
                cell.Children.Add(new TextBlock { Text = FloorStudio.Describe(c.Split), FontSize = 12, TextWrapping = TextWrapping.Wrap });
                cell.Children.Add(new Viewbox { Child = FloorStudioDrawing.Build(c), Width = 420, MaxHeight = 300, Stretch = Stretch.Uniform, Margin = new Thickness(0, 4, 0, 4) });
                cell.Children.Add(new TextBlock
                {
                    Text = l.Units.Count + " айл " + FloorStudio.MixText(l) + " · ☀" + c.LitUnits + "/" + l.Units.Count + " · ↔" + c.DualAspectUnits +
                           " · үр ашиг " + (l.Efficiency * 100).ToString("0") + "%",
                    FontSize = 12, TextWrapping = TextWrapping.Wrap,
                });
                WpfGrid.SetColumn(cell, i % cols);
                WpfGrid.SetRow(cell, i / cols);
                sheet.Children.Add(cell);
            }
            sheet.Measure(new System.Windows.Size(double.PositiveInfinity, double.PositiveInfinity));
            sheet.Arrange(new Rect(sheet.DesiredSize));
            sheet.UpdateLayout();
            var bmp = new RenderTargetBitmap((int)Math.Ceiling(sheet.ActualWidth), (int)Math.Ceiling(sheet.ActualHeight), 96, 96, PixelFormats.Pbgra32);
            bmp.Render(sheet);
            string path = Path.Combine(r.Job.RunDir, "studio-top20.png");
            var enc = new PngBitmapEncoder();
            enc.Frames.Add(BitmapFrame.Create(bmp));
            using (FileStream fs = File.Create(path)) enc.Save(fs);
            r.Facts["sheet.png"] = path;
            return StepState.Done;
        }

        private static StepState Apply(GateRunner r, St t, int index)
        {
            StudioCandidate c = t.Top[index];
            List<ElementId> before = index == 0 ? new List<ElementId>() : AllIds(t.Furnished);
            if (index == 0) t.S.BeforeApply = Scenario.Snapshot(t.S.Doc);
            var names = new List<string>();
            r.ChangeListener = e => names.AddRange(e.GetTransactionNames());
            StudioApplyOutcome o;
            try { o = FloorStudioEngine.Apply(t.Storey, c, false); }
            finally { r.ChangeListener = null; }
            string tag = index == 0 ? "apply1" : "replace2";
            r.Facts[tag + ".message"] = o.Message;
            r.Facts[tag + ".seconds"] = Math.Round(o.Seconds, 2);
            r.Facts[tag + ".transactions"] = string.Join(" | ", names.Distinct());
            if (o.Notes.Count > 0) r.Facts[tag + ".notes"] = string.Join(" | ", o.Notes);
            if (!o.Ok) return r.Fail(o.Message);
            var problems = new List<string>();
            if (o.Made.Furniture.Count != 0) problems.Add("тавилгагүй байх ёстой: " + o.Made.Furniture.Count);
            int stale = before.Count(id => t.S.Doc.GetElement(id) != null);
            if (stale > 0) problems.Add("өмнөх хувилбарын " + stale + " элемент үлдсэн (солих ёстой)");
            if (index > 0 && o.Replaced == 0) problems.Add("өмнөх хувилбарыг солиогүй");
            if (index == 0) t.First = o; else t.Second = o;
            SetState(t, c, o);
            return problems.Count == 0 ? StepState.Done : r.Fail(string.Join("; ", problems));
        }

        private static StepState Furnish(GateRunner r, St t)
        {
            StudioApplyOutcome o = FloorStudioEngine.Furnish(t.Storey);
            r.Facts["furnish.message"] = o.Message;
            r.Facts["furnish.seconds"] = Math.Round(o.Seconds, 2);
            if (o.Notes.Count > 0) r.Facts["furnish.notes"] = string.Join(" | ", o.Notes);
            if (!o.Ok) return r.Fail(o.Message);
            var problems = new List<string>();
            if (o.Made.Furniture.Count == 0) problems.Add("тавилга байрласангүй");
            int stale = AllIds(t.First).Count(id => t.S.Doc.GetElement(id) != null);
            if (stale > 0) problems.Add("тавилгагүй хувилбарын " + stale + " элемент үлдсэн");
            if (!ReferenceEquals(o.Candidate, t.Top[0])) problems.Add("тавилгыг өөр хувилбарт байрлуулав");
            r.Facts["furnish.furniture"] = o.Made.Furniture.Count + " (хасагдсан " + o.Made.FurnitureDropped.Count + ")";
            if (o.Made.FurnitureDropped.Count > 0) r.Facts["furnish.dropped"] = string.Join(" | ", o.Made.FurnitureDropped);
            t.Furnished = o;
            SetState(t, o.Candidate, o);
            return problems.Count == 0 ? StepState.Done : r.Fail(string.Join("; ", problems));
        }

        private static void SetState(St t, StudioCandidate c, StudioApplyOutcome o)
        {
            Scenario.State s = t.S;
            s.Batch = o.Batch;
            s.Selected = o.Selected;
            s.Made = o.Made;
            s.ShellWalls = o.Shell;
            s.CommonRoom = o.CommonRoom;
            s.Layout = c.Split.Layout;
            s.Storey = ExistingFloorBoundary.Read(s.Doc, (Floor)s.Doc.GetElement(t.Storey.FloorId), s.Level);
        }

        private static StepState Verify(GateRunner r, St t, string tag)
        {
            StepState a = Scenario.Verify(r, t.S);
            CopyIfExists(Path.Combine(r.Job.RunDir, "verify.json"), Path.Combine(r.Job.RunDir, "verify-" + tag + ".json"));
            StepState b = FloorScenario.VerifyStorey(r, t.S);
            r.Facts[tag + ".verify_hard"] = r.Facts.TryGetValue("verify.hard", out object h) ? h : "?";
            r.Facts[tag + ".storey_hard"] = r.Facts.TryGetValue("storey.hard", out object sh) ? sh : "?";
            return a == StepState.Done && b == StepState.Done ? StepState.Done : StepState.Failed;
        }

        private static StepState AfterUndo(GateRunner r, St t)
        {
            Document doc = t.S.Doc;
            if (AllIds(t.Second).Any(id => doc.GetElement(id) != null)) return StepState.Wait;   // Revit post хийсэн командаа дараа ажиллуулна
            List<ElementId> back = AllIds(t.Furnished);
            int restored = back.Count(id => doc.GetElement(id) != null);
            r.Facts["undo.restored_furnished"] = restored + "/" + back.Count;
            StudioCandidate applied = FloorStudioEngine.Applied(doc, t.S.Level.Id, out bool furnished);
            r.Facts["undo.applied_is_first"] = ReferenceEquals(applied, t.Top[0]) && furnished;
            if (restored != back.Count) return r.Fail("Ctrl+Z-ийн дараа тавилгатай №1 бүрэн сэргээгүй (" + restored + "/" + back.Count + ")");
            if (!ReferenceEquals(applied, t.Top[0]) || !furnished) return r.Fail("Ctrl+Z-ийн дараа самбар өмнөх хувилбарыг танихгүй");
            return StepState.Done;
        }

        private static List<ElementId> AllIds(StudioApplyOutcome o)
        {
            if (o == null || o.Made == null) return new List<ElementId>();
            return o.Shell.Concat(o.Made.Walls).Concat(o.Made.Doors).Concat(o.Made.Rooms).Concat(o.Made.Tags).Concat(o.Made.Furniture).ToList();
        }

        private static void CopyIfExists(string from, string to)
        {
            try { if (File.Exists(from)) File.Copy(from, to, true); } catch { }
        }
    }
}
