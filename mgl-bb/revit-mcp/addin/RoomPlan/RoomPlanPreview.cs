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
    /// <summary>Read-only WPF drawing; Revit model is never touched until Confirm.</summary>
    internal sealed class RoomPlanPreview : Window
    {
        private readonly double _width, _height;
        private readonly PlanEntrySide _entry;
        private readonly ComboBox _bedrooms = new ComboBox { Width = 160, Margin = new Thickness(0, 0, 16, 0) };
        private readonly ComboBox _variant = new ComboBox { Width = 455, Margin = new Thickness(0, 0, 16, 0) };
        private readonly Canvas _canvas = new Canvas { Width = 630, Height = 445, Background = Brushes.White };
        private readonly TextBlock _summary = new TextBlock { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 8, 0, 8) };
        private readonly Button _confirm = new Button { Content = "Хэрэгжүүлэх", MinWidth = 120, Margin = new Thickness(10, 0, 0, 0) };

        private IReadOnlyList<RankedPlan> _options = new List<RankedPlan>();
        internal GeneratedPlan SelectedPlan { get; private set; }

        internal RoomPlanPreview(double width, double height, PlanEntrySide entry)
        {
            _width = width; _height = height; _entry = entry;
            Title = "MGL — Өрөөний план үүсгэх · MVP";
            MglWindow.Setup(this, Title, 820, 710, 685, 555, prefsKey: "room-plan-generator");
            var root = new Grid { Margin = new Thickness(16) };
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            var caption = new TextBlock
            {
                Text = "Танигдсан гадна дөрвөн ханын доторх талбай: " + width.ToString("0.0") + " × " +
                    height.ToString("0.0") + " м · Орох хаалга: " + _entry +
                    ". Энэ бол АВТОМАТ НОРМ ШАЛГАЛТ БИШ.",
                Margin = new Thickness(0, 0, 0, 12), TextWrapping = TextWrapping.Wrap
            };
            Grid.SetRow(caption, 0); root.Children.Add(caption);

            var selectors = new StackPanel { Orientation = Orientation.Horizontal };
            selectors.Children.Add(new TextBlock { Text = "Унтлагын өрөө", VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 8, 0) });
            _bedrooms.Items.Add("1 унтлагын өрөө");
            _bedrooms.Items.Add("2 унтлагын өрөө");
            _bedrooms.Items.Add("3 унтлагын өрөө");
            selectors.Children.Add(_bedrooms);
            selectors.Children.Add(new TextBlock { Text = "Хувилбар", VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 8, 0) });
            // Filled with valid scored alternatives after bedroom selection.
            selectors.Children.Add(_variant);
            Grid.SetRow(selectors, 1); root.Children.Add(selectors);

            var scroll = new ScrollViewer { Content = _canvas, Margin = new Thickness(0, 12, 0, 0),
                HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
            Grid.SetRow(scroll, 2); root.Children.Add(scroll);
            Grid.SetRow(_summary, 3); root.Children.Add(_summary);
            var actions = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
            var cancel = new Button { Content = "Цуцлах", MinWidth = 90, IsCancel = true };
            cancel.Click += (s, e) => { DialogResult = false; Close(); };
            _confirm.Click += (s, e) => { if (SelectedPlan != null) { DialogResult = true; Close(); } };
            actions.Children.Add(cancel); actions.Children.Add(_confirm);
            Grid.SetRow(actions, 4); root.Children.Add(actions);
            Content = root;
            MglTheme.Apply(this);
            MglUi.Primary(_confirm);
            _bedrooms.SelectionChanged += (s, e) => ReloadOptions();
            _variant.SelectionChanged += (s, e) => Render();
            _bedrooms.SelectedIndex = 1;
            ReloadOptions();
        }

        private void ReloadOptions()
        {
            _variant.Items.Clear();
            SelectedPlan = null;
            _options = _bedrooms.SelectedIndex < 0
                ? new List<RankedPlan>()
                : RoomPlanRanking.GenerateOptions(_width, _height, _bedrooms.SelectedIndex + 1, _entry);
            foreach (RankedPlan option in _options) _variant.Items.Add(option);
            _variant.SelectedIndex = _options.Count > 0 ? 0 : -1;
            if (_options.Count == 0)
            {
                _canvas.Children.Clear();
                _confirm.IsEnabled = false;
                _summary.Text = "Энэ талбайд одоогийн хатуу геометрийн шалгуурт тэнцсэн төлөвлөлт олдсонгүй.";
            }
        }

        private void Render()
        {
            if (_bedrooms.SelectedIndex < 0 || _variant.SelectedIndex < 0) return;
            SelectedPlan = null; _canvas.Children.Clear(); _confirm.IsEnabled = false;
            try
            {
                RankedPlan chosen = (RankedPlan)_variant.SelectedItem;
                var plan = chosen.Plan;
                SelectedPlan = plan;
                const double pad = 24;
                double scale = Math.Min((_canvas.Width - 2 * pad) / plan.Width,
                    (_canvas.Height - 2 * pad) / plan.Height);
                Func<double, double> px = x => pad + x * scale;
                Func<double, double> py = y => _canvas.Height - pad - y * scale;

                foreach (PlanRoom room in plan.Rooms)
                {
                    var rect = new Rectangle
                    {
                        Width = (room.X2 - room.X1) * scale,
                        Height = (room.Y2 - room.Y1) * scale,
                        Fill = room.Name == "Хонгил" ?
                            new SolidColorBrush(Color.FromRgb(231, 235, 240)) :
                            new SolidColorBrush(Color.FromRgb(237, 244, 250))
                    };
                    Canvas.SetLeft(rect, px(room.X1)); Canvas.SetTop(rect, py(room.Y2));
                    _canvas.Children.Add(rect);
                    var label = new TextBlock
                    {
                        Text = room.Name + "\n" + room.Area.ToString("0.0") + " м²",
                        Foreground = Brushes.Black, FontSize = 11, TextAlignment = TextAlignment.Center,
                        TextWrapping = TextWrapping.Wrap,
                        Width = Math.Max(44, (room.X2 - room.X1) * scale - 10)
                    };
                    Canvas.SetLeft(label, px(room.X1) + 5);
                    Canvas.SetTop(label, py(room.Center.Y) - 19);
                    _canvas.Children.Add(label);
                }
                foreach (PlanWall wall in plan.Walls)
                {
                    var line = new Line { X1 = px(wall.Start.X), Y1 = py(wall.Start.Y),
                        X2 = px(wall.End.X), Y2 = py(wall.End.Y),
                        Stroke = Brushes.DarkSlateGray, StrokeThickness = 5 };
                    _canvas.Children.Add(line);
                }
                foreach (FurnitureTarget furniture in FurniturePlanner.Create(plan))
                {
                    var rect = new Rectangle
                    {
                        Width = furniture.Width * scale,
                        Height = furniture.Depth * scale,
                        Fill = new SolidColorBrush(Color.FromArgb(130, 102, 168, 121)),
                        Stroke = Brushes.DarkGreen,
                        StrokeThickness = 1
                    };
                    Canvas.SetLeft(rect, px(furniture.MinX));
                    Canvas.SetTop(rect, py(furniture.MaxY));
                    _canvas.Children.Add(rect);
                    var name = new TextBlock
                    {
                        Text = furniture.Kind.ToString(),
                        FontSize = 9, Foreground = Brushes.DarkGreen
                    };
                    Canvas.SetLeft(name, px(furniture.Position.X) - furniture.Width * scale / 2);
                    Canvas.SetTop(name, py(furniture.Position.Y) - 5);
                    _canvas.Children.Add(name);
                }
                foreach (PlanDoor door in plan.Doors)
                {
                    // Symbolic opening marker only; the actual opening depends on loaded door Family.
                    var circle = new Ellipse { Width = 12, Height = 12, Fill = Brushes.White,
                        Stroke = Brushes.SeaGreen, StrokeThickness = 2 };
                    Canvas.SetLeft(circle, px(door.Center.X) - 6);
                    Canvas.SetTop(circle, py(door.Center.Y) - 6);
                    _canvas.Children.Add(circle);
                }
                _summary.Text = _options.Count + " шалгуур давсан хувилбар · Сонгосон " +
                    chosen.Score.ToString("0") + "/100 (дизайны ойролцоо оноо). " +
                    plan.Rooms.Count + " Room, " + (plan.Walls.Count - 4) +
                    " дотор хана, " + plan.Doors.Count + " Door санал. " +
                    "Байгаа 4 гадна ханыг дахин үүсгэхгүй. " +
                    "Family зурагт ногооноор харагдана (бодит Revit хэмжээ дараа нь шалгагдана). " +
                    "⚠ Тавилга, цонх, гарц, БНбД/MNS баталгаажуулалт хийгдээгүй.";
                _confirm.IsEnabled = true;
            }
            catch (ArgumentException ex)
            {
                _summary.Text = ex.Message; // disabled confirm
            }
        }
    }
}
