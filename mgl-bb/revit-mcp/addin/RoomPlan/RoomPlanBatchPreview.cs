using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Shapes;
using RevitMcpAddin.RoomPlan.Core;
using RevitMcpAddin.Ui;

namespace RevitMcpAddin.RoomPlan
{
    /// <summary>
    /// Independent option per apartment. Explicit choices only; no implicit
    /// best-plan application. Read-only preview. Feedback stays local in SQLite.
    /// </summary>
    internal sealed class RoomPlanBatchPreview : Window
    {
        private readonly PythonBatch _batch;
        private readonly Dictionary<string, PythonOption> _chosen =
            new Dictionary<string, PythonOption>(StringComparer.Ordinal);
        private readonly HashSet<string> _seen = new HashSet<string>(StringComparer.Ordinal);
        private readonly Canvas _canvas = new Canvas
            { Width = 610, Height = 415, Background = Brushes.White };
        private readonly TextBlock _detail = new TextBlock { TextWrapping = TextWrapping.Wrap };
        private readonly ComboBox _reason = new ComboBox { Width = 200 };
        private readonly ComboBox _topologyFilter = new ComboBox { MinWidth = 195, Height = 28 };
        private readonly ComboBox _sort = new ComboBox { MinWidth = 150, Height = 28,
            Margin = new Thickness(14, 0, 0, 0) };
        private readonly TextBlock _galleryCount = new TextBlock {
            VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(12, 0, 0, 0),
            Foreground = Brushes.DimGray };
        private readonly List<string> _filterKeys = new List<string>();
        private readonly WrapPanel _gallery = new WrapPanel { Orientation = Orientation.Horizontal };
        private readonly Dictionary<string, ComboBox> _selectors =
            new Dictionary<string, ComboBox>(StringComparer.Ordinal);
        private string _galleryUnitId;
        private PythonUnitResult _activeUnit;
        private PythonOption _activeOption;

        internal IReadOnlyDictionary<string, PythonOption> Selected { get { return _chosen; } }
        internal RoomPlanBatchPreview(PythonBatch batch)
        {
            _batch = batch;
            Title = "MGL — Python Room Plan · Олон нэгж";
            MglWindow.Setup(this, Title, 1320, 900, 980, 680, prefsKey: "python-roomplan-batch");
            var root = new Grid { Margin = new Thickness(14) };
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var title = new TextBlock
            {
                Text = batch.Units.Count + " нэгж тус бүр өөрийн хувилбартай. Хэрэглэхээр " +
                    "сонгоогүй нэгжийг автоматаар өөрчлөхгүй. Python, SQLite — local only.",
                TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 12)
            };
            Grid.SetRow(title, 0); root.Children.Add(title);

            var body = new Grid();
            body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(380) });
            body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var list = new StackPanel { Margin = new Thickness(0, 0, 12, 0) };
            foreach (PythonUnitResult unit in batch.Units)
            {
                var row = new StackPanel { Margin = new Thickness(0, 0, 0, 12) };
                row.Children.Add(new TextBlock
                {
                    Text = unit.Id + " · " +
                        unit.Boundary.WidthMeters.ToString("0.0") + "×" +
                        unit.Boundary.HeightMeters.ToString("0.0") + " м · " +
                        unit.Bedrooms + " унтлагын · " + unit.Bathrooms + " АЦӨ\n" +
                        unit.Options.Count + " сонголт (" + unit.TotalValid + " шалгагдсанаас)",
                    FontWeight = FontWeights.SemiBold, TextWrapping = TextWrapping.Wrap
                });
                // Python-ий анхааруулгыг (хонгилын өргөн өөрчлөгдсөн, сонголтын сан
                // ашиглах боломжгүй г.м.) архитекторт ИЛ харуулна — өмнө нь хаягддаг байв.
                foreach (string warning in unit.Warnings)
                    row.Children.Add(new TextBlock
                    {
                        Text = "⚠ " + warning,
                        Foreground = new SolidColorBrush(Color.FromRgb(0x9A, 0x5B, 0x00)),
                        TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 3, 0, 0)
                    });
                var combo = new ComboBox { Margin = new Thickness(0, 5, 0, 0), MinHeight = 30 };
                foreach (PythonOption option in unit.Options)
                    combo.Items.Add(option);
                var copiedUnit = unit;
                combo.SelectionChanged += (s, e) =>
                {
                    var chosen = combo.SelectedItem as PythonOption;
                    if (chosen == null) _chosen.Remove(copiedUnit.Id);
                    else
                    {
                        _chosen[copiedUnit.Id] = chosen;
                        RoomPlanPythonBridge.EventInBackground(_batch, copiedUnit, chosen, "selected");
                        Show(copiedUnit, chosen);
                        HighlightCards();
                    }
                };
                row.Children.Add(combo);
                _selectors[unit.Id] = combo;
                var showButton = new Button { Content = "Энэ нэгжийн preview",
                    Margin = new Thickness(0, 4, 0, 0), MinHeight = 25 };
                showButton.Click += (s, e) =>
                {
                    Show(copiedUnit, combo.SelectedItem as PythonOption ??
                        copiedUnit.Options.FirstOrDefault());
                };
                row.Children.Add(showButton);
                list.Children.Add(row);
            }
            var left = new ScrollViewer { Content = list, VerticalScrollBarVisibility =
                ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled };
            Grid.SetColumn(left, 0); body.Children.Add(left);

            var right = new Grid();
            right.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            right.RowDefinitions.Add(new RowDefinition { Height = new GridLength(300) });
            right.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            right.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            right.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var filterLine = new StackPanel { Orientation = Orientation.Horizontal,
                Margin = new Thickness(0, 0, 0, 6) };
            filterLine.Children.Add(new TextBlock { Text = "Загвар:",
                VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0,0,8,0) });
            _topologyFilter.SelectionChanged += (sender, args) => PopulateGallery();
            filterLine.Children.Add(_topologyFilter);
            filterLine.Children.Add(new TextBlock { Text = "Эрэмбэ:",
                VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(14,0,8,0) });
            foreach (string mode in new[] { "Нийт оноо", "Байгалийн гэрэл",
                "Өрөөний хэмжээ", "Талбайн үр ашиг", "Том унтлагын өрөө" })
                _sort.Items.Add(mode);
            _sort.SelectedIndex = 0;
            _sort.SelectionChanged += (sender, args) => PopulateGallery();
            filterLine.Children.Add(_sort);
            filterLine.Children.Add(_galleryCount);
            Grid.SetRow(filterLine,0); right.Children.Add(filterLine);
            var libraryScroll = new ScrollViewer {
                Content = _gallery,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled
            };
            Grid.SetRow(libraryScroll, 1); right.Children.Add(libraryScroll);
            var canvasScroll = new ScrollViewer { Content = _canvas,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
            Grid.SetRow(canvasScroll, 2); right.Children.Add(canvasScroll);
            _detail.Margin = new Thickness(0, 8, 0, 10);
            Grid.SetRow(_detail, 3); right.Children.Add(_detail);
            var feedback = new StackPanel { Orientation = Orientation.Horizontal };
            foreach (var pair in new[]
            {
                ("too_small", "Өрөө жижиг"), ("bad_circulation", "Хөдөлгөөн муу"),
                ("door_conflict", "Хаалганы асуудал"),
                ("bad_furniture", "Тавилга таарахгүй"),
                ("poor_daylight", "Гэрэлтүүлэг муу"),
                ("wet_zone", "Сантехникийн бүс"),
                ("not_preferred", "Таалагдаагүй"), ("other", "Бусад")
            })
                _reason.Items.Add(new ReasonChoice { Key = pair.Item1, Label = pair.Item2 });
            _reason.SelectedIndex = 0;
            feedback.Children.Add(_reason);
            var reject = new Button { Content = "Татгалзсан шалтгааныг хадгалах",
                Margin = new Thickness(8, 0, 0, 0), MinWidth = 190 };
            reject.Click += (s, e) =>
            {
                if (_activeUnit == null || _activeOption == null) return;
                var choice = _reason.SelectedItem as ReasonChoice;
                if (choice != null && Event(_activeUnit, _activeOption, "rejected", choice.Key))
                    MessageBox.Show(this, "Зөвхөн сонгосон хувилбарын татгалзсан шалтгааныг local-д хадгаллаа.",
                        Title, MessageBoxButton.OK, MessageBoxImage.Information);
            };
            feedback.Children.Add(reject);
            Grid.SetRow(feedback, 4); right.Children.Add(feedback);
            Grid.SetColumn(right, 1); body.Children.Add(right);
            Grid.SetRow(body, 1); root.Children.Add(body);

            var footer = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                HorizontalAlignment = HorizontalAlignment.Right,
                Margin = new Thickness(0, 14, 0, 0)
            };
            var stats = new Button { Content = "Хэрэглээний статистик", MinWidth = 150 };
            stats.Click += (s, e) =>
            {
                try { MessageBox.Show(this, RoomPlanPythonBridge.Analytics(), Title); }
                catch (Exception ex) { MessageBox.Show(this, ex.Message, Title); }
            };
            footer.Children.Add(stats);
            // Олон айлтай давхарт айл бүрийг нэг нэгээр сонгох нь удаан (Finch бүтэн давхрыг нэг дор дүүргэдэг).
            // Сонголт ИЛ хэвээр: энэ товч нь архитекторын өөрийн үйлдэл, сонгоогүй айлд л тавина — аль хэдийн сонгосныг
            // хөндөхгүй.  «Шилдэг» = бүх өрөө нь цонхтой хувилбаруудаас хамгийн өндөр оноотой (`BestFirst`).
            var bestAll = new Button { Content = "Бүгдэд шилдгийг сонгох", MinWidth = 170, Margin = new Thickness(12, 0, 0, 0),
                ToolTip = "Сонгоогүй айл бүрт бүх өрөө нь цонхтой хувилбаруудаас хамгийн өндөр оноотойг сонгоно (ийм байхгүй бол хамгийн өндөр оноотой)" };
            bestAll.Click += (s, e) =>
            {
                foreach (var pair in _selectors)
                    if (!_chosen.ContainsKey(pair.Key) && pair.Value.Items.Count > 0)
                        pair.Value.SelectedItem = RoomPlanBatchApply.BestFirst(pair.Value.Items.OfType<PythonOption>()).First();
            };
            footer.Children.Add(bestAll);
            var cancel = new Button { Content = "Цуцлах", IsCancel = true, MinWidth = 95,
                Margin = new Thickness(12, 0, 0, 0) };
            cancel.Click += (s, e) => { DialogResult = false; Close(); };
            footer.Children.Add(cancel);
            var apply = new Button { Content = "Сонгосон бүх нэгжийг хэрэгжүүлэх", MinWidth = 220,
                Margin = new Thickness(12, 0, 0, 0) };
            apply.Click += (s, e) =>
            {
                if (_chosen.Count != _batch.Units.Count)
                {
                    MessageBox.Show(this, "Нэгж бүрийн хувилбарыг ТОДОРХОЙ сонгоно уу. " +
                        "Сонгогдоогүй: " + (_batch.Units.Count - _chosen.Count), Title);
                    return;
                }
                DialogResult = true; Close();
            };
            footer.Children.Add(apply);
            Grid.SetRow(footer, 2); root.Children.Add(footer);
            Content = root;
            MglTheme.Apply(this);
            MglUi.Primary(apply);
            if (batch.Units.Count > 0)
                Show(batch.Units[0], batch.Units[0].Options.FirstOrDefault());
        }

        private sealed class ReasonChoice
        {
            internal string Key, Label;
            public override string ToString() { return Label; }
        }

        private bool Included(PythonOption option)
        {
            int i = _topologyFilter.SelectedIndex;
            if (i <= 0 || i > _filterKeys.Count) return true;
            string key = _filterKeys[i - 1];
            if (key == "saved")
                return option.Template != null && option.Template.StartsWith("saved-", StringComparison.Ordinal);
            if (key == "daylight")
                return option.HabitableRooms > 0 && option.DaylitRooms == option.HabitableRooms;
            return option.Topology == key;
        }

        /// <summary>Filter entries are built from what this unit actually got.</summary>
        private void RebuildFilter()
        {
            _filterKeys.Clear();
            _topologyFilter.Items.Clear();
            _topologyFilter.Items.Add("Бүх төлөвлөлт (" + _activeUnit.Options.Count + ")");
            int full = _activeUnit.Options.Count(o => o.HabitableRooms > 0 && o.DaylitRooms == o.HabitableRooms);
            if (full > 0)
            {
                _filterKeys.Add("daylight");
                _topologyFilter.Items.Add("☀ Бүх өрөө гэрэлтэй (" + full + ")");
            }
            int saved = _activeUnit.Options.Count(o => o.Template != null &&
                o.Template.StartsWith("saved-", StringComparison.Ordinal));
            if (saved > 0)
            {
                _filterKeys.Add("saved");
                _topologyFilter.Items.Add("Өмнө ашигласан (" + saved + ")");
            }
            foreach (var group in _activeUnit.Options.GroupBy(o => o.Topology)
                         .OrderByDescending(g => g.Max(o => o.Score)))
            {
                _filterKeys.Add(group.Key);
                _topologyFilter.Items.Add(RoomPlanLabels.Topology(group.Key) + " (" + group.Count() + ")");
            }
            _topologyFilter.SelectedIndex = 0;
        }

        private IEnumerable<PythonOption> Sorted(IEnumerable<PythonOption> options)
        {
            switch (_sort.SelectedIndex)
            {
                case 1: return options.OrderByDescending(o => o.Part("daylight")).ThenByDescending(o => o.Score);
                case 2: return options.OrderByDescending(o => o.Part("area_fit")).ThenByDescending(o => o.Score);
                case 3: return options.OrderByDescending(o => o.EfficiencyPercent).ThenByDescending(o => o.Score);
                case 4: return options.OrderByDescending(o => o.MinBedroomArea).ThenByDescending(o => o.Score);
                default: return options.OrderByDescending(o => o.Score);
            }
        }

        private readonly Dictionary<PythonOption, Button> _cards = new Dictionary<PythonOption, Button>();

        private void HighlightCards()
        {
            _chosen.TryGetValue(_activeUnit == null ? "" : _activeUnit.Id, out PythonOption chosen);
            foreach (var pair in _cards)
            {
                bool on = ReferenceEquals(pair.Key, chosen);
                pair.Value.BorderBrush = on ? Brushes.ForestGreen :
                    ReferenceEquals(pair.Key, _activeOption) ? Brushes.SteelBlue : Brushes.LightGray;
                pair.Value.BorderThickness = new Thickness(on ? 3 : 1);
            }
        }

        private void PopulateGallery()
        {
            _gallery.Children.Clear();
            _cards.Clear();
            if (_activeUnit == null) return;
            _galleryUnitId = _activeUnit.Id;
            if (!_selectors.TryGetValue(_activeUnit.Id, out ComboBox selector))
                return;
            var options = Sorted(_activeUnit.Options.Where(Included)).ToList();
            _galleryCount.Text = options.Count + " хувилбар";
            if (options.Count == 0)
            {
                _gallery.Children.Add(new TextBlock { Text = "Энэ шүүлтүүрт төлөвлөлт алга.",
                    Margin = new Thickness(6), TextWrapping = TextWrapping.Wrap });
                return;
            }
            foreach (PythonOption option in options)
            {
                var content = new StackPanel { Width = 168 };
                var head = new DockPanel();
                var score = new TextBlock { Text = option.Score.ToString("0") + "%",
                    FontWeight = FontWeights.Bold, FontSize = 13,
                    Foreground = option.Score >= 80 ? Brushes.ForestGreen :
                        option.Score >= 65 ? Brushes.DarkGoldenrod : Brushes.Firebrick };
                head.Children.Add(score);
                var sun = new TextBlock { Text = "☀ " + option.DaylitRooms + "/" + option.HabitableRooms,
                    FontSize = 11, HorizontalAlignment = HorizontalAlignment.Right,
                    Foreground = option.DaylitRooms == option.HabitableRooms ? Brushes.DarkOrange : Brushes.Gray,
                    ToolTip = "Цонхтой (гэрэлтэй) амьдрах өрөө / нийт амьдрах өрөө" };
                DockPanel.SetDock(sun, Dock.Right);
                head.Children.Insert(0, sun);
                content.Children.Add(head);
                content.Children.Add(Miniature(option.Plan, option.Facades, 168, 104));
                content.Children.Add(new TextBlock {
                    Text = RoomPlanLabels.Topology(option.Topology, option.LibraryOrigin),
                    FontSize = 10, TextTrimming = TextTrimming.CharacterEllipsis,
                    Foreground = Brushes.DarkSlateGray
                });
                var card = new Button {
                    Content = content,
                    Width = 184, Height = 142,
                    Margin = new Thickness(3),
                    Padding = new Thickness(4),
                    Background = Brushes.White,
                    ToolTip = option.Explanation
                };
                var target = option;
                card.Click += (sender, args) =>
                {
                    if (ReferenceEquals(selector.SelectedItem, target)) Show(_activeUnit, target);
                    else selector.SelectedItem = target;
                    HighlightCards();
                };
                _cards[option] = card;
                _gallery.Children.Add(card);
            }
            HighlightCards();
        }

        private static Brush RoomColor(PlanRoom room)
        {
            if (room.Name == "Хонгил") return Brushes.Gainsboro;
            if (room.Name.StartsWith("Агуулах", StringComparison.Ordinal))
                return new SolidColorBrush(Color.FromRgb(243, 226, 184));
            if (room.Name.StartsWith("Унтлагын", StringComparison.Ordinal))
                return new SolidColorBrush(Color.FromRgb(218, 211, 245));
            if (room.Name.StartsWith("Ариун", StringComparison.Ordinal))
                return new SolidColorBrush(Color.FromRgb(185, 223, 245));
            return new SolidColorBrush(Color.FromRgb(189, 231, 190));
        }

        private static Canvas Miniature(GeneratedPlan plan, IList<string> facades, double cw, double ch)
        {
            var canvas = new Canvas { Width = cw, Height = ch,
                Background = Brushes.White, ClipToBounds = true };
            const double pad = 6;
            double scale = Math.Min((cw-2*pad)/plan.Width,(ch-2*pad)/plan.Height);
            double ox = (cw - plan.Width*scale)/2, oy = (ch - plan.Height*scale)/2;
            Func<double,double> px = x => ox+x*scale;
            Func<double,double> py = y => ch-oy-y*scale;
            DrawFacades(canvas, plan, facades, px, py, 3);
            foreach (PlanRoom room in plan.Rooms)
            {
                var rectangle = new Rectangle {
                    Width = Math.Max(1,(room.X2-room.X1)*scale),
                    Height = Math.Max(1,(room.Y2-room.Y1)*scale),
                    Fill = RoomColor(room)
                };
                Canvas.SetLeft(rectangle,px(room.X1));
                Canvas.SetTop(rectangle,py(room.Y2));
                canvas.Children.Add(rectangle);
            }
            foreach (PlanWall wall in plan.Walls)
                canvas.Children.Add(new Line {
                    X1=px(wall.Start.X),Y1=py(wall.Start.Y),
                    X2=px(wall.End.X),Y2=py(wall.End.Y),
                    Stroke=Brushes.Black,StrokeThickness=1.8
                });
            foreach (PlanDoor door in plan.Doors)
            {
                var dot = new Ellipse {
                    Width=5,Height=5,Fill=Brushes.White,
                    Stroke=Brushes.ForestGreen,StrokeThickness=1.3
                };
                Canvas.SetLeft(dot,px(door.Center.X)-2.5);
                Canvas.SetTop(dot,py(door.Center.Y)-2.5);
                canvas.Children.Add(dot);
            }
            return canvas;
        }

        private static void DrawFacades(Canvas canvas, GeneratedPlan plan, IList<string> facades,
            Func<double,double> px, Func<double,double> py, double thickness)
        {
            if (facades == null) return;
            var brush = new SolidColorBrush(Color.FromArgb(150, 70, 150, 230));
            foreach (string side in facades)
            {
                double x1 = 0, y1 = 0, x2 = plan.Width, y2 = 0;
                if (side == "north") { y1 = y2 = plan.Height; }
                else if (side == "west") { x2 = 0; y2 = plan.Height; }
                else if (side == "east") { x1 = x2 = plan.Width; y2 = plan.Height; }
                else if (side != "south") continue;
                canvas.Children.Add(new Line { X1 = px(x1), Y1 = py(y1), X2 = px(x2), Y2 = py(y2),
                    Stroke = brush, StrokeThickness = thickness * 2.4 });
            }
        }

        private bool Event(PythonUnitResult unit, PythonOption option, string action, string reason)
        {
            if (option == null) return false;
            if (RoomPlanPythonBridge.TryEvent(_batch, unit, option, action, reason, out string err))
                return true;
            MessageBox.Show(this, "Local статистик бичигдсэнгүй: " + err, Title,
                MessageBoxButton.OK, MessageBoxImage.Warning);
            return false;
        }

        private void Show(PythonUnitResult unit, PythonOption option)
        {
            bool otherUnit = _activeUnit == null || unit == null ||
                _activeUnit.Id != unit.Id;
            _activeUnit = unit; _activeOption = option;
            if (otherUnit && unit != null) { RebuildFilter(); PopulateGallery(); }
            else if (otherUnit) PopulateGallery();
            _canvas.Children.Clear();
            if (unit == null || option == null)
            {
                _detail.Text = "Энэ нэгжид шалгуур давсан хувилбар алга.";
                return;
            }
            string token = unit.Id + ":" + option.OptionId;
            if (_seen.Add(token)) RoomPlanPythonBridge.EventInBackground(_batch, unit, option, "viewed");
            GeneratedPlan plan = option.Plan;
            double pad = 26, scale = Math.Min((_canvas.Width - 2*pad) / plan.Width,
                (_canvas.Height - 2*pad) / plan.Height);
            Func<double, double> px = x => pad + x * scale;
            Func<double, double> py = y => _canvas.Height - pad - y * scale;
            DrawFacades(_canvas, plan, option.Facades, px, py, 4);
            // A corridor may be several rectangles; label only its largest piece.
            PlanRoom hallLabel = plan.Rooms.Where(r => r.Name == "Хонгил")
                .OrderByDescending(r => r.Area).FirstOrDefault();
            double hallArea = plan.Rooms.Where(r => r.Name == "Хонгил").Sum(r => r.Area);
            foreach (PlanRoom room in plan.Rooms)
            {
                var fill = new Rectangle
                {
                    Width = (room.X2 - room.X1)*scale, Height = (room.Y2-room.Y1)*scale,
                    Fill = RoomColor(room)
                };
                Canvas.SetLeft(fill, px(room.X1)); Canvas.SetTop(fill, py(room.Y2));
                _canvas.Children.Add(fill);
                if (room.Name == "Хонгил" && !ReferenceEquals(room, hallLabel)) continue;
                var label = new TextBlock
                {
                    Text = room.Name + "\n" + (room.Name == "Хонгил" ? hallArea : room.Area).ToString("0.0") + " м²",
                    Width = (room.X2 - room.X1)*scale-8,
                    TextWrapping = TextWrapping.Wrap, Foreground = Brushes.Black,
                    TextAlignment = TextAlignment.Center, FontSize = 10
                };
                Canvas.SetLeft(label,px(room.X1)+4);
                Canvas.SetTop(label,py(room.Center.Y)-15);
                _canvas.Children.Add(label);
            }
            foreach (PlanWall wall in plan.Walls)
                _canvas.Children.Add(new Line
                {
                    X1=px(wall.Start.X),Y1=py(wall.Start.Y),
                    X2=px(wall.End.X),Y2=py(wall.End.Y),
                    Stroke=Brushes.DarkSlateGray,StrokeThickness=3
                });
            foreach (FurnitureTarget furnishing in plan.Furnishings)
            {
                var rectangle = new Rectangle
                {
                    Width = furnishing.Width*scale, Height = furnishing.Depth*scale,
                    Fill = new SolidColorBrush(Color.FromArgb(130, 85, 164, 115)),
                    Stroke = Brushes.ForestGreen, StrokeThickness=1
                };
                Canvas.SetLeft(rectangle, px(furnishing.MinX));
                Canvas.SetTop(rectangle, py(furnishing.MaxY));
                _canvas.Children.Add(rectangle);
                var furnishingName = new TextBlock
                {
                    Text = furnishing.Kind.ToString(), FontSize=9,
                    Foreground=Brushes.DarkGreen
                };
                Canvas.SetLeft(furnishingName, px(furnishing.Position.X)-furnishing.Width*scale/2);
                Canvas.SetTop(furnishingName, py(furnishing.Position.Y)-5);
                _canvas.Children.Add(furnishingName);
            }
            foreach (PlanDoor door in plan.Doors)
            {
                var circle = new Ellipse { Width = 11, Height = 11,
                    Fill=Brushes.White, Stroke=Brushes.ForestGreen, StrokeThickness=2 };
                Canvas.SetLeft(circle,px(door.Center.X)-5.5);
                Canvas.SetTop(circle,py(door.Center.Y)-5.5);
                _canvas.Children.Add(circle);
            }
            Func<string, string> pct = k => (option.Part(k) * 100).ToString("0") + "%";
            _detail.Text = unit.Id + " · " + option.Score.ToString("0.0") + "% · " +
                RoomPlanLabels.Topology(option.Topology, option.LibraryOrigin) + "\n" +
                "☀ Гэрэл " + pct("daylight") + " (" + option.DaylitRooms + "/" + option.HabitableRooms +
                " өрөө цонхтой) · Өрөөний хэмжээ " + pct("area_fit") + " · Хэлбэр " + pct("squareness") +
                " · Коридор " + pct("circulation") + " · Бүсчлэл " + pct("zoning") + "\n" +
                "Талбайн үр ашиг " + option.EfficiencyPercent.ToString("0.0") +
                "% · Хамгийн бага унтлагын өрөө " + option.MinBedroomArea.ToString("0.0") + " м² · " +
                "цэнхэр зураас = цонхтой тал\n" +
                "Анхаар: Python-ийн схемчилсэн шүүлтүүр. Бодит Family/хаалга/нормын " +
                "баталгаажуулалт зөвхөн Revit-д apply хийх үед; автоматаар норм хангасан гэхгүй.";
        }
    }
}
