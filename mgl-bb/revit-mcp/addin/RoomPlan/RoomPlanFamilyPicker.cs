using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using Autodesk.Revit.DB;
using RevitMcpAddin.RoomPlan.Core;
using RevitMcpAddin.Ui;

namespace RevitMcpAddin.RoomPlan
{
    /// <summary>
    /// Explicit per-project Family Type mapping. No accidental use of the
    /// first loaded door/furniture family as a silently "correct" semantic.
    /// Currently supports OneLevelBased non-hosted families only.
    /// </summary>
    internal sealed class RoomPlanFamilyPicker : Window
    {
        private sealed class Option
        {
            internal readonly FamilySymbol Symbol;
            internal Option(FamilySymbol symbol) { Symbol = symbol; }
            public override string ToString() { return Symbol == null ? "— ашиглахгүй —" : Symbol.Family.Name + " — " + Symbol.Name; }
        }

        private sealed class WallOption
        {
            internal readonly WallType Type;
            internal WallOption(WallType type) { Type = type; }
            public override string ToString() { return Type.Name; }
        }

        private readonly ComboBox _wallSelector = new ComboBox { MinWidth = 440, Height = 30 };
        internal ElementId WallTypeId { get; private set; }
        private readonly Dictionary<FurnitureKind, ComboBox> _selectors =
            new Dictionary<FurnitureKind, ComboBox>();
        private readonly ComboBox _doorSelector = new ComboBox { MinWidth = 440, Height = 30 };
        internal ElementId DoorSymbolId { get; private set; }
        internal Dictionary<FurnitureKind, ElementId> Selected { get; private set; }

        internal RoomPlanFamilyPicker(Document doc, IEnumerable<FurnitureTarget> planned = null)
        {
            List<FurnitureTarget> targets = planned?.ToList() ?? new List<FurnitureTarget>();
            Title = "MGL — Room Plan Family сонгох";
            MglWindow.Setup(this, Title, 760, 760, 620, 465, prefsKey: "room-plan-families");
            var root = new DockPanel { Margin = new Thickness(18) };
            var title = new TextBlock
            {
                Text = "Дотор хана, хаалга, тавилгын Family Type-уудыг өөрөө батална. Төслийн ачаалсан " +
                    "Family-гаас нэр, хэмжээгээр нь санал болгосон — шалгаад өөрчилж болно." +
                    "\nОр, буйдан, гал тогоо, суултуур, угаалтуур заавал. Бусдыг «— ашиглахгүй —» болговол тэр тавилга орохгүй." +
                    "\nСонгосон Family-д өөр хэмжээтэй төрөл байвал өрөө бүрт тохирохыг нь авна (тансаг өрөөнд том ор, буйдан).",
                TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 14)
            };
            DockPanel.SetDock(title, Dock.Top); root.Children.Add(title);

            var actions = new StackPanel
            {
                Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right,
                Margin = new Thickness(0, 14, 0, 0)
            };
            var cancel = new Button { Content = "Цуцлах", IsCancel = true, MinWidth = 100 };
            var apply = new Button { Content = "Family-уудыг батлах", IsDefault = true, MinWidth = 160,
                Margin = new Thickness(10, 0, 0, 0) };
            cancel.Click += (s, e) => { DialogResult = false; Close(); };
            apply.Click += (s, e) =>
            {
                if (!(_wallSelector.SelectedItem is WallOption) ||
                    !(_doorSelector.SelectedItem is Option) ||
                    _selectors.Any(c => FurniturePlanner.Required(c.Key) &&
                        !(c.Value.SelectedItem is Option o && o.Symbol != null)))
                {
                    MessageBox.Show(this, "Дотор хана, хаалга, ор, буйдан, гал тогоо, суултуур, угаалтуурын Family-г " +
                        "заавал сонгоно. Байхгүй бол Project-д Load Family хийнэ.",
                        Title, MessageBoxButton.OK, MessageBoxImage.Warning);
                    return;
                }
                WallTypeId = ((WallOption)_wallSelector.SelectedItem).Type.Id;
                DoorSymbolId = ((Option)_doorSelector.SelectedItem).Symbol.Id;
                Selected = _selectors.Where(v => v.Value.SelectedItem is Option o && o.Symbol != null)
                    .ToDictionary(k => k.Key, v => ((Option)v.Value.SelectedItem).Symbol.Id);
                DialogResult = true; Close();
            };
            actions.Children.Add(cancel); actions.Children.Add(apply);
            DockPanel.SetDock(actions, Dock.Bottom); root.Children.Add(actions);

            var list = new StackPanel();
            var wallLabel = new TextBlock { Text = "Дотор ханын төрөл (Basic Wall Type)",
                Margin = new Thickness(0,6,0,4) };
            list.Children.Add(wallLabel);
            var basicWalls = new FilteredElementCollector(doc).OfClass(typeof(WallType))
                .Cast<WallType>().Where(x => x.Kind == WallKind.Basic)
                .OrderBy(x => x.Name, StringComparer.OrdinalIgnoreCase).ToList();
            foreach (WallType wallType in basicWalls)
                _wallSelector.Items.Add(new WallOption(wallType));
            if (basicWalls.Count == 1) _wallSelector.SelectedIndex = 0;
            list.Children.Add(_wallSelector);
            MglAuto.LabelFor(wallLabel,_wallSelector);
            if (basicWalls.Count == 0)
                list.Children.Add(new TextBlock { Text = "  ✗ Basic Wall Type байхгүй — шалгаад Load хийнэ үү." });

            var doorLabel = new TextBlock { Text = "Орох болон дотор хаалга (Doors · hosted)", Margin = new Thickness(0, 6, 0, 4) };
            list.Children.Add(doorLabel);
            var doors = new FilteredElementCollector(doc).OfClass(typeof(FamilySymbol))
                .OfCategory(BuiltInCategory.OST_Doors).Cast<FamilySymbol>()
                .Where(x => x.Family != null &&
                    x.Family.FamilyPlacementType == FamilyPlacementType.OneLevelBasedHosted)
                .OrderBy(x => x.Family.Name, StringComparer.OrdinalIgnoreCase)
                .ThenBy(x => x.Name, StringComparer.OrdinalIgnoreCase).ToList();
            foreach (FamilySymbol door in doors) _doorSelector.Items.Add(new Option(door));
            if (_doorSelector.Items.Count == 1) _doorSelector.SelectedIndex = 0;
            list.Children.Add(_doorSelector);
            MglAuto.LabelFor(doorLabel, _doorSelector);
            if (doors.Count == 0)
                list.Children.Add(new TextBlock { Text = "  ✗ Hosted Door Family алга — Load Family шаардлагатай." });

            foreach (FurnitureKind kind in Enum.GetValues(typeof(FurnitureKind)))
            {
                var label = new TextBlock { Text = RoomPlanFurnitureRevit.Label(kind),
                    Margin = new Thickness(0, 6, 0, 4) };
                list.Children.Add(label);
                var combo = new ComboBox { MinWidth = 440, Height = 30 };
                var candidates = RoomPlanFurnitureRevit.Candidates(doc, kind);
                bool required = FurniturePlanner.Required(kind);
                var none = new Option(null);
                if (!required) combo.Items.Add(none);   // companions may be left out
                foreach (FamilySymbol symbol in candidates)
                    combo.Items.Add(new Option(symbol));
                // Keyword match, then the size that suits the kind (double vs single bed);
                // the architect sees and can change every default before applying.
                FamilySymbol suggested = RoomPlanFurnitureRevit.Suggest(kind, candidates, targets);
                combo.SelectedItem = suggested != null
                    ? combo.Items.Cast<Option>().First(o => o.Symbol != null && o.Symbol.Id == suggested.Id)
                    : required ? null : none;
                if (candidates.Count == 0)
                    list.Children.Add(new TextBlock
                    {
                        Text = "  ✗ Тохирох OneLevelBased Family алга — Load Family шаардлагатай.",
                        TextWrapping = TextWrapping.Wrap
                    });
                _selectors.Add(kind, combo);
                list.Children.Add(combo);
                MglAuto.LabelFor(label, combo);
            }
            var scroll = new ScrollViewer { Content = list,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
            root.Children.Add(scroll);
            Content = root;
            MglTheme.Apply(this);
            MglUi.Primary(apply);
        }
    }
}
