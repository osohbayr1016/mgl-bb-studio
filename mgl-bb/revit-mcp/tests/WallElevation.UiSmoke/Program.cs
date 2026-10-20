using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using RevitMcpAddin.WallElevation.Core;
using RevitMcpAddin.WallElevation.Ui;
using Kit = RevitMcpAddin.Smart.UiSmoke.Ui;

namespace RevitMcpAddin.WallElevation.UiSmoke
{
    public static class Program
    {
        private static readonly IWeUnits U = new WeFixedUnits();

        private static WeV3 P(double xMm, double yMm) { return new WeV3(U.MmToInternal(xMm), U.MmToInternal(yMm), 0); }

        private static WeWallInfo Wall(long id, WeV3 a, WeV3 b, WeV3 ext, WeWallKind kind = WeWallKind.Basic, bool curved = false, bool slanted = false)
        {
            return new WeWallInfo
            {
                UniqueId = "w" + id, Id = id, Mark = "", TypeName = kind == WeWallKind.Curtain ? "Curtain Wall" : "Generic - 200",
                LevelName = "L01", Kind = kind, HasLocationLine = true, IsCurved = curved, IsSlanted = slanted, LocationIsCenterline = true,
                Start = a, End = b, Width = kind == WeWallKind.Curtain ? 0 : U.MmToInternal(200), BottomZ = 0, TopZ = U.MmToInternal(3000), OrientationHint = ext,
            };
        }

        private static WeRoomInfo Room(string uid, string number, string name, double ox, double oy, double w, double h, WeRequest req, long firstId, bool curvedNorth = false)
        {
            WeV3 a = P(ox, oy), b = P(ox + w, oy), c = P(ox + w, oy + h), d = P(ox, oy + h);
            var walls = new[]
            {
                Wall(firstId, a, b, new WeV3(0, -1, 0)), Wall(firstId + 1, b, c, new WeV3(1, 0, 0)),
                Wall(firstId + 2, c, d, new WeV3(0, 1, 0), curved: curvedNorth), Wall(firstId + 3, d, a, new WeV3(-1, 0, 0)),
            };
            var loop = new WeRoomLoop();
            WeV3[][] segs = { new[] { a, b }, new[] { b, c }, new[] { c, d }, new[] { d, a } };
            for (int i = 0; i < 4; i++)
            {
                req.WallLookup[walls[i].UniqueId] = walls[i];
                loop.Segments.Add(new WeBoundarySegment { Host = WeBoundaryHost.Wall, WallUniqueId = walls[i].UniqueId, IsStraight = !(curvedNorth && i == 2), A = segs[i][0], B = segs[i][1] });
            }
            return new WeRoomInfo
            {
                UniqueId = uid, Id = firstId * 10, Number = number, Name = name, LevelName = "L01", BottomZ = 0, TopZ = U.MmToInternal(2800),
                IsPlaced = true, IsEnclosed = true, Loops = { loop },
            };
        }

        public static WeRequest Request()
        {
            var req = new WeRequest();
            req.Rooms.Add(Room("r101", "101", "Оффис", 0, 0, 5000, 4000, req, 100));
            req.Rooms.Add(Room("r102", "102", "Хурлын өрөө", 6000, 0, 6000, 4500, req, 200, curvedNorth: true));
            req.Walls.Add(Wall(300, P(0, 8000), P(4000, 8000), new WeV3(0, -1, 0), WeWallKind.Curtain));
            req.Walls.Add(Wall(301, P(0, 12000), P(4000, 12000), new WeV3(0, -1, 0), slanted: true));
            foreach (string n in new[] { "Section 1", "Section 2" }) req.ExistingViewNames.Add(n);
            return req;
        }

        /// <summary>
        /// W06: үр дүнгийн хөтөч (Revit-гүй харагдац) — өрөө → дэлгээс → хуудас, төлөв, товчны идэвх, «Шалгасан · Дараах», дахин уншихад шалгасан
        /// тэмдэг хадгалагдах, үйлдлийн зорилт (id) зөв.
        /// </summary>
        private static void ResultBrowser()
        {
            Func<string, string, string, long, long, string, bool, WeResultViewInfo> V = (room, key, label, viewId, sheetId, sheetNo, off) => new WeResultViewInfo
            {
                Kind = WeResultKind.Elevation, Key = key, RoomUid = room, ViewId = viewId, ViewName = "WE-" + label, DetailNumber = sheetId != 0 ? label : null,
                ViewportId = sheetId != 0 ? viewId + 1000 : 0, SheetId = sheetId, SheetNumber = sheetNo, OutOfFrame = off,
            };
            var views = new List<WeResultViewInfo>
            {
                V("r205", "kA", "205A", 10, 500, "A-301", false),
                V("r205", "kB", "205B", 11, 500, "A-301", true),
                V("r205", "kC", "205C", 12, 0, null, false),
                V("r101", "k1", "101A", 20, 600, "A-201", false),
            };
            var run = new List<WeResultRunInfo>
            {
                new WeResultRunInfo { Key = "kA", RoomUid = "r205", Label = "205A", Change = WeResultChange.New },
                new WeResultRunInfo { Key = "kF", RoomUid = "r205", Label = "205F", Failed = true, Message = "Үүсгээгүй: Муруй хана — дэмжигдэхгүй" },
            };
            Func<string, string> labels = uid => uid == "r205" ? "Өрөө 205 — Гал тогоо" : "Өрөө 101 — Оффис";
            var view = new WeResultView();
            var acts = new List<KeyValuePair<WeResultAction, WeResultTarget>>();
            view.ActionRequested += (a, t) => acts.Add(new KeyValuePair<WeResultAction, WeResultTarget>(a, t));
            view.SetIndex(WeResultIndex.Build(views, run, labels), id => id == 500 ? "Гал тогоо" : "Оффис", 0);
            Func<string, System.Windows.Controls.Button> btn = name => Kit.All<System.Windows.Controls.Button>(view)
                .First(b => System.Windows.Automation.AutomationProperties.GetName(b) == name);
            Kit.RunModal(view, () =>
            {
                Kit.Wait(150);
                string all = Kit.AllText(view);
                Kit.True(all.Contains("2 өрөө") && all.Contains("1 цэгцлэх") && all.Contains("1 хуудасгүй") && all.Contains("1 алдаа"), "хураангуй: " + all);
                Kit.True(view.Rooms.Count == 2 && view.Review.Items.Count == 2, "2 өрөө, шалгах 2 хуудас");
                // Хуудасгүй мөр: хуудас/viewport идэвхгүй, харагдац нээх идэвхтэй.
                Kit.True(view.SelectByKey("kC"), "хуудасгүй мөр сонгогдов");
                Kit.Pump();
                Kit.True(!btn("Хуудас нээх").IsEnabled && !btn("Viewport сонгох").IsEnabled && btn("Харагдац нээх").IsEnabled, "хуудасгүй мөрийн товчнууд");
                // Алдаатай мөр: харагдацгүй — зөвхөн планд харуулах.
                Kit.True(view.SelectByKey("kF"), "алдаатай мөр");
                Kit.Pump();
                Kit.True(!btn("Харагдац нээх").IsEnabled && !btn("Хуудас нээх").IsEnabled && btn("Планд харуулах").IsEnabled, "алдаатай мөрийн товчнууд");
                Kit.True(view.StatusText.Contains("дэмжигдэхгүй"), "алдааны шалтгаан мэдэгдэлд: " + view.StatusText);
                // Цэгцлэх мөр: viewport сонгох → зорилт зөв.
                Kit.True(view.SelectByKey("kB"), "цэгцлэх мөр");
                Kit.Pump();
                btn("Viewport сонгох").RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Primitives.ButtonBase.ClickEvent));
                KeyValuePair<WeResultAction, WeResultTarget> last = acts.Last();
                Kit.True(last.Key == WeResultAction.SelectViewport && last.Value.ViewportId == 1011 && last.Value.SheetId == 500, "viewport сонгох зорилт: " + last.Value.ViewportId + "/" + last.Value.SheetId);
                btn("Project Browser-т олох").RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Primitives.ButtonBase.ClickEvent));
                Kit.True(acts.Last().Key == WeResultAction.Locate && acts.Last().Value.ViewId == 11, "Project Browser-т олох зорилт");
                Kit.Shot(view, "we-results-1");
                // «Шалгасан · Дараах» — хуудас нээх хүсэлт, шалгасан тэмдэг.
                int before = acts.Count;
                view.Next();
                Kit.True(acts.Count == before + 1 && acts.Last().Key == WeResultAction.OpenSheet, "дараагийн хуудас нээх хүсэлт");
                Kit.True(view.Review.CheckedCount == 1, "1 хуудас шалгасан");
                // Дахин уншина (хэрэглэгч 205C-г хуудсанд оруулсан) — шалгасан тэмдэг хадгалагдана, төлөв шинэчлэгдэнэ.
                views[2] = V("r205", "kC", "205C", 12, 500, "A-301", false);
                view.SetIndex(WeResultIndex.Build(views, run, labels), id => null, 0);
                Kit.Pump();
                Kit.True(view.Review.CheckedCount == 1, "дахин уншихад шалгасан тэмдэг хэвээр");
                Kit.True(!Kit.AllText(view).Contains("хуудасгүй"), "205C одоо хуудсанд");
                Kit.Shot(view, "we-results-2-refreshed");
                Console.WriteLine("  ok   result browser: " + string.Join(", ", acts.Select(a => a.Key)));
            });
        }

        private static System.Windows.Controls.Button DefaultButton(Window w)
        {
            return Kit.All<System.Windows.Controls.Button>(w).First(b => b.IsDefault);
        }

        [STAThread]
        public static int Main(string[] args)
        {
            Console.OutputEncoding = System.Text.Encoding.UTF8;
            int fail = 0;
            try
            {
                WeRequest req = Request();
                // Өмнө нь үүсгэсэн: 101-ийн хоёр дэлгээс (нэг нь хэвээр, нэг нь өөрчлөгдсөн) — «шинэчлэх / хэвээр» мөрийг харуулах.
                WePlan first = WallElevationPlanner.Plan(req, new WePlanContext { Units = U });
                foreach (WePlannedElevation p in first.Items.Where(i => i.RoomUid == "r101").Take(2))
                    req.Existing.Add(new WeExistingView
                    {
                        ViewId = 9000 + req.Existing.Count, Key = p.Key, Signature = req.Existing.Count == 0 ? p.Signature : "old", Name = p.Name, GeneratedName = p.Name,
                        WallUid = p.WallUid, RoomUid = p.RoomUid, GeneratorVersion = 1, SourceWallExists = true, SourceRoomExists = true,
                    });
                req.Existing.Add(new WeExistingView { ViewId = 9100, Key = "v1|room:gone|wall:x|side:int", Name = "WE-L01-099-A", WallUid = "x", RoomUid = "gone", SourceWallExists = false, SourceRoomExists = false });

                Func<WeSettings, WePlan> planner = s => WallElevationPlanner.Plan(req, new WePlanContext { Settings = s, Units = U, ViewSetupToken = "t|" + s.Scale + "|" + s.TemplateName });
                // Тэмдэглэгээний эх өгөгдөл: 101-ийн урд ханад хаалга — өгөгдмөлөөр хаалганы spot + шошго, хананы гинж.
                req.Sources.Levels.Add(new WeLevelInfo { Id = 1, Name = "L01", Z = 0 });
                req.Sources.Levels.Add(new WeLevelInfo { Id = 2, Name = "L02", Z = U.MmToInternal(3600) });
                req.Sources.Inserts.Add(new WeInsertInfo { Id = 500, Kind = WeInsertKind.Door, HostWallUid = "w100", Center = P(1500, 0), HalfWidth = U.MmToInternal(450), BottomZ = 0, TopZ = U.MmToInternal(2100) });
                var dlg = new WallElevationDialog(new WeSettings(), new[] { "Section", "Interior Elevation" }, new[] { "Architectural Elevation", "Interior Elevation 1:50" },
                    new[] { "A1 Horizontal : MGL", "A3 : MGL" }, req.Rooms.Count, req.Walls.Count, planner, U,
                    new[] { "Linear - 2.5mm Arial" }, new[] { "Spot Elevation - Target" }, new[] { "Keynote Number - Boxed - Small" });
                bool? r = Kit.RunModal(dlg, () =>
                {
                    Kit.Wait(200);
                    Kit.Shot(dlg, "we-dialog-1-default");
                    Console.WriteLine("  ok   default: " + DefaultButton(dlg).Content);
                    // Нэг мөрийг хасах → товчны тоо буурна, план бүдгэрнэ.
                    var box = Kit.All<System.Windows.Controls.CheckBox>(dlg)
                        .First(c => c.IsEnabled && c.IsChecked == true && System.Windows.Automation.AutomationProperties.GetName(c).StartsWith("B"));
                    box.IsChecked = false;
                    Kit.Pump();
                    Console.WriteLine("  ok   after exclude: " + DefaultButton(dlg).Content + " · excluded " + dlg.ExcludedKeys.Count);
                    Kit.True(dlg.ExcludedKeys.Count == 1, "хассан түлхүүр 1");
                    Kit.Shot(dlg, "we-dialog-2-excluded");
                    // Тэмдэглэгээний хүснэгт: өгөгдмөлөөр нээлттэй, хураангуйд тоо; «Хана — Keynote» асаахад keynote нэмэгдэнэ.
                    var annoExp = Kit.All<System.Windows.Controls.Expander>(dlg).First(x => (x.Header as string) == "Тэмдэглэгээ");
                    Kit.True(annoExp.IsExpanded, "тэмдэглэгээний хэсэг нээлттэй");
                    string sum0 = Kit.AllText(dlg);
                    Kit.True(sum0.Contains("Тэмдэглэгээ:") && sum0.Contains("spot level"), "хураангуйд тэмдэглэгээний тоо");
                    Kit.True(!sum0.Contains("keynote"), "өгөгдмөлөөр keynote байхгүй");
                    var wallKey = Kit.All<System.Windows.Controls.CheckBox>(dlg).First(c => System.Windows.Automation.AutomationProperties.GetName(c) == "Хана — Keynote");
                    wallKey.IsChecked = true;
                    Kit.Pump();
                    Kit.Wait(100);
                    Kit.True(Kit.AllText(dlg).Contains("keynote"), "хананы keynote асаахад хураангуйд keynote гарна");
                    Kit.Shot(dlg, "we-dialog-4-annotations");
                    Console.WriteLine("  ok   annotations: " + Kit.AllText(dlg).Split(new[] { Environment.NewLine, "\n" }, StringSplitOptions.None)
                        .FirstOrDefault(l => l.Contains("Тэмдэглэгээ:")));
                    // Хуудас горим + нарийвчилсан нээх.
                    Kit.All<System.Windows.Controls.RadioButton>(dlg).First(r => ((string)r.Content).StartsWith("Харагдац +")).IsChecked = true;
                    Kit.All<System.Windows.Controls.Expander>(dlg).First(x => (x.Header as string) == "Нарийвчилсан").IsExpanded = true;
                    Kit.Wait(150);
                    Kit.Shot(dlg, "we-dialog-3-sheets-advanced");
                    Console.WriteLine("  ok   sheets: " + DefaultButton(dlg).Content);

                    // W07: сонгосон дэлгээсийн босоо хүрээ — «Дээд» 2400 → тохиргоонд, мөрөнд «↕»; «Авто» → арилна.
                    Func<string, System.Windows.Controls.TextBox> cropBox = prefix => Kit.All<System.Windows.Controls.TextBox>(dlg)
                        .First(t => System.Windows.Automation.AutomationProperties.GetName(t).StartsWith(prefix, StringComparison.Ordinal));
                    System.Windows.Controls.TextBox upper = cropBox("Босоо хүрээний дээд хил");
                    string autoUpper = upper.Text;
                    upper.Text = "2400";
                    upper.RaiseEvent(new RoutedEventArgs(UIElement.LostFocusEvent));
                    Kit.Pump();
                    Kit.Wait(100);
                    KeyValuePair<string, WeCropOverride> set = dlg.Settings.Crops.Single();
                    Kit.True(Math.Abs(set.Value.UpperMm - 2400) < 0.5, "дээд хил 2400 тохиргоонд: " + set.Value.UpperMm);
                    Kit.True(double.IsNaN(set.Value.LowerMm), "засаагүй доод тал авто хэвээр");
                    Kit.True(cropBox("Босоо хүрээний дээд хил").Text == "2400", "дахин зурсан талбарт 2400 (авто байсан: " + autoUpper + ")");
                    Kit.True(Kit.AllText(dlg).Contains("таны тохируулсан"), "толгойд «таны тохируулсан»");
                    Kit.Shot(dlg, "we-dialog-5-crop");
                    System.Windows.Controls.TextBox lower = cropBox("Босоо хүрээний доод хил");
                    lower.Text = "2350";
                    lower.RaiseEvent(new RoutedEventArgs(UIElement.LostFocusEvent));
                    Kit.Pump();
                    Kit.True(double.IsNaN(dlg.Settings.Crops[set.Key].LowerMm), "100 мм-ээс бага хүрээ хүлээн авахгүй (доод тал авто хэвээр)");
                    Kit.True(Kit.AllText(dlg).Contains("100 мм"), "шалтгаан хураангуйд");
                    var autoBtn = Kit.All<System.Windows.Controls.Button>(dlg)
                        .First(b => System.Windows.Automation.AutomationProperties.GetName(b).StartsWith("Босоо хүрээг авто болгох", StringComparison.Ordinal));
                    autoBtn.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Primitives.ButtonBase.ClickEvent));
                    Kit.Pump();
                    Kit.True(dlg.Settings.Crops[set.Key].IsAuto, "«Авто» — хоёр тал авто");
                    Kit.True(cropBox("Босоо хүрээний дээд хил").Text == autoUpper, "авто хил сэргэв: " + cropBox("Босоо хүрээний дээд хил").Text);
                    Console.WriteLine("  ok   vertical crop: 2400 → авто " + autoUpper);

                    // W09: зориулалт — өгөгдмөл «Тусгай»; өрөө 101-ийг «Интерьер» болгоход доорх удирдлагууд тэр зориулалтыг засна; 102 → ариун
                    // цэврийн өрөө (жишээ хүлээгдэж буй тэмдэгтэй); тэмдэглэгээний мөрөнд англи ангиллын нэр.
                    // Шошго нь Run-уудаас (монгол + бүдэг англи) — TextBlock.Text биш, Inlines-ийг уншина.
                    string all9 = string.Join("\n", Kit.All<System.Windows.Controls.TextBlock>(dlg)
                        .Select(t => t.Text + string.Concat(t.Inlines.OfType<System.Windows.Documents.Run>().Select(r => r.Text))));
                    Kit.True(all9.Contains("Plumbing Fixtures") && all9.Contains("Group: electrical & devices") && all9.Contains("Casework"), "англи ангиллын нэр харагдана");
                    Kit.True(Kit.All<System.Windows.Controls.TextBlock>(dlg).Any(t => (t.ToolTip as string ?? string.Empty).StartsWith("БҮЛЭГ — нэг Revit ангилал БИШ: Electrical Fixtures", StringComparison.Ordinal)),
                        "цахилгааны бүлгийн яг ангиллууд tooltip-д (нэг ангилал мэт биш)");
                    Kit.True(dlg.Settings.DefaultPreset == WePresetId.Custom, "өгөгдмөл — «Тусгай» (өмнөх зан төлөв)");
                    Func<string, System.Windows.Controls.ComboBox> roomPreset = room => Kit.All<System.Windows.Controls.ComboBox>(dlg)
                        .First(c => System.Windows.Automation.AutomationProperties.GetName(c).StartsWith("Өрөөний зориулалт Өрөө " + room, StringComparison.Ordinal));
                    string customBefore = dlg.Settings.Annotations;
                    roomPreset("101").SelectedIndex = Array.IndexOf(WePresetId.All, WePresetId.Interior);
                    Kit.Pump();
                    Kit.Wait(100);
                    Kit.True(dlg.Settings.RoomPresets["r101"] == WePresetId.Interior, "101 = Интерьер");
                    Kit.True(Kit.AllText(dlg).Contains("«Интерьер» зориулалтын тохиргоо — өрөө 101"), "засаж буй зориулалт = сонгосон өрөөнийх");
                    var furnitureTag = Kit.All<System.Windows.Controls.CheckBox>(dlg).First(c => System.Windows.Automation.AutomationProperties.GetName(c) == "Тавилга — Шошго");
                    bool had = furnitureTag.IsChecked == true;
                    furnitureTag.IsChecked = !had;
                    Kit.Pump();
                    Kit.True(dlg.Settings.PresetOf(WePresetId.Interior).Annotations.Contains("furniture:tag") == !had, "хүснэгт «Интерьер» зориулалтыг засав");
                    Kit.True(dlg.Settings.Annotations == customBefore, "«Тусгай» (бусад өрөө) хөндөгдсөнгүй");
                    roomPreset("102").SelectedIndex = Array.IndexOf(WePresetId.All, WePresetId.Bathroom);
                    Kit.Pump();
                    Kit.Wait(100);
                    string all10 = Kit.AllText(dlg);
                    Kit.True(all10.Contains("«Ариун цэврийн өрөө» зориулалтын тохиргоо") && all10.Contains("жишээ хүлээгдэж байна"), "ариун цэврийн өрөө — суурь, жишээ хүлээгдэж буй");
                    Kit.True(Kit.All<System.Windows.Controls.CheckBox>(dlg).First(c => System.Windows.Automation.AutomationProperties.GetName(c) == "Сантехник — Хэмжээс").IsChecked == true,
                        "ариун цэврийн өрөөний хүснэгт (сантехникийн хэмжээс)");
                    Kit.Shot(dlg, "we-dialog-6-presets");
                    var matrix = Kit.All<System.Windows.Controls.Expander>(dlg).First(x => (x.Header as string) == "Тэмдэглэгээ");
                    matrix.BringIntoView();
                    Kit.Wait(150);
                    Kit.Shot(dlg, "we-dialog-7-matrix");
                    roomPreset("101").SelectedIndex = Array.IndexOf(WePresetId.All, WePresetId.Interior);
                    Kit.Pump();
                    Kit.True(Kit.All<System.Windows.Controls.CheckBox>(dlg).First(c => System.Windows.Automation.AutomationProperties.GetName(c) == "Тавилга — Шошго").IsChecked == !had,
                        "101 руу буцахад «Интерьер»-ийн засвар хэвээр");
                    Console.WriteLine("  ok   presets: 101=" + dlg.Settings.RoomPresets["r101"] + ", 102=" + dlg.Settings.RoomPresets["r102"]);
                });
            }
            catch (Exception ex)
            {
                fail++;
                Console.WriteLine("  FAIL " + ex);
            }
            try { ResultBrowser(); }
            catch (Exception ex)
            {
                fail++;
                Console.WriteLine("  FAIL result browser " + ex);
            }
            Console.WriteLine(fail == 0 ? "PASS" : "FAIL");
            Console.WriteLine("Зураг: " + Kit.OutDir);
            return fail == 0 ? 0 : 1;
        }
    }
}
