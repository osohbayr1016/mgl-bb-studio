using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Media;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Mechanical;
using Microsoft.Win32;
using RevitMcpAddin.Ventilation.Core;

namespace RevitMcpAddin.Ventilation.Revit
{
    /// <summary>Offline Revit-hosted engineering worksheet. All model writes are explicit.</summary>
    public sealed class VentilationWindow : Window
    {
        private readonly Document _document;
        private readonly List<VentilationRow> _rows;
        private readonly DataGrid _grid;
        private readonly TextBlock _summary;
        private readonly Dictionary<string, TextBox> _bulk = new Dictionary<string, TextBox>();
        private readonly ComboBox _profiles;

        public VentilationWindow(Document doc, List<VentilationRow> rows)
        {
            _document = doc;
            _rows = rows;
            Title = "MGL Smart — Агааржуулалтын тооцоо";
            Width = 1430;
            Height = 770;
            MinWidth = 900;
            MinHeight = 550;
            WindowStartupLocation = WindowStartupLocation.CenterOwner;
            Background = new SolidColorBrush(Color.FromRgb(248, 249, 251));

            var root = new DockPanel { LastChildFill = true, Margin = new Thickness(16) };
            Content = root;
            var top = new StackPanel { Orientation = Orientation.Vertical };
            DockPanel.SetDock(top, Dock.Top);
            root.Children.Add(top);
            top.Children.Add(new TextBlock {
                Text = "Өрөө / Space бүрийн агаарын тооцоо",
                FontSize = 20, FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 0, 0, 8)
            });
            top.Children.Add(new TextBlock {
                Text = "ACH = эзлэхүүн × 1000 × ACH / 3600. Гадна агаар = (хүн × Rp + талбай × Ra) / Ez. " +
                       "Урьдчилсан өгөлт = хамгийн их шаардлага. Энэ нь дулаан/хөргөлтийн тооцоо, олон бүсийн AHU тооцоо, нормын баталгаа БИШ.",
                TextWrapping = TextWrapping.Wrap,
                Foreground = Brushes.DarkSlateGray, Margin = new Thickness(0, 0, 0, 6)
            });
            top.Children.Add(new TextBlock {
                Text = "Цэнхэр биш, засаж болох багануудад батлагдсан утгаа оруулна. " +
                       "Нормын өгөгдмөл утга байхгүй. Space байгаа бол Room давхар тоологдохгүй. " +
                       "Space байхгүй үед Room-ууд зөвхөн тайланд гарна.",
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 0, 0, 12), Foreground = Brushes.DimGray
            });
            var bulkPanel = new WrapPanel { Margin = new Thickness(0, 0, 0, 8) };
            top.Children.Add(bulkPanel);
            bulkPanel.Children.Add(new TextBlock {
                Text = "Бүх өрөөнд ижил коэффициент тавих (хоосон = өөрчлөхгүй):",
                VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 12, 0)
            });
            BulkField(bulkPanel, "ACH", "Ach");
            BulkField(bulkPanel, "Rp L/s·хүн", "Rp");
            BulkField(bulkPanel, "Ra L/s·m²", "Ra");
            BulkField(bulkPanel, "Ez", "Ez");
            BulkField(bulkPanel, "v m/s", "VelocityMs");
            bulkPanel.Children.Add(ActionButton("Түгээх", (s, e) => Distribute(), true));
            var profilePanel = new WrapPanel { Margin = new Thickness(0, 3, 0, 8) };
            top.Children.Add(profilePanel);
            profilePanel.Children.Add(new TextBlock {
                Text = "Инженерийн хянасан нормын профиль:",
                VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 8, 0)
            });
            _profiles = new ComboBox {
                Width = 345, Height = 28, DisplayMemberPath = "Reference",
                Margin = new Thickness(0, 0, 6, 0)
            };
            profilePanel.Children.Add(_profiles);
            profilePanel.Children.Add(ActionButton("CSV профайл нээх…", (s, e) => LoadProfiles(), false));
            profilePanel.Children.Add(ActionButton("Сонгосон өрөөнд хэрэглэх", (s, e) => ApplyProfile(), true));

            _summary = new TextBlock {
                Margin = new Thickness(0, 6, 0, 12), FontWeight = FontWeights.SemiBold,
                Text = _rows.Count + " өрөө. Баталгаажсан тооцооны утга оруулаад «Тооцоолох» дарна."
            };
            DockPanel.SetDock(_summary, Dock.Bottom);
            var footer = new StackPanel { Orientation = Orientation.Vertical };
            DockPanel.SetDock(footer, Dock.Bottom);
            root.Children.Add(footer);
            var actions = new WrapPanel { HorizontalAlignment = HorizontalAlignment.Right };
            footer.Children.Add(actions);
            actions.Children.Add(ActionButton("Тооцоолох", (s, e) => Recalculate(), true));
            actions.Children.Add(ActionButton("CSV тайлан", (s, e) => Export(), false));
            actions.Children.Add(ActionButton("Оролт хадгалах", (s, e) => SaveAssumptions(), false));
            actions.Children.Add(ActionButton("Оролт сэргээх", (s, e) => LoadAssumptions(), false));
            actions.Children.Add(ActionButton("Сувгийн даралт…", (s, e) => new DuctNetworkWindow(_document) { Owner = this }.ShowDialog(), false));
            actions.Children.Add(ActionButton("Space-д өгөлт бичих…", (s, e) => WriteToSpaces(), false));
            actions.Children.Add(ActionButton("Хаах", (s, e) => Close(), false));
            footer.Children.Add(_summary);

            _grid = new DataGrid {
                AutoGenerateColumns = false,
                CanUserAddRows = false,
                CanUserDeleteRows = false,
                IsReadOnly = false,
                SelectionMode = DataGridSelectionMode.Extended,
                GridLinesVisibility = DataGridGridLinesVisibility.Horizontal,
                AlternatingRowBackground = new SolidColorBrush(Color.FromRgb(241, 245, 249)),
                RowHeight = 32,
                ColumnHeaderHeight = 35,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                ItemsSource = _rows,
                FrozenColumnCount = 0
            };
            root.Children.Add(_grid);
            Column("№", "Number", 75, false);
            Column("Өрөө", "Name", 150, false);
            Column("Давхар", "Level", 95, false);
            Column("Эх сурвалж", "Source", 160, false);
            Column("Норм / эх сурвалж", "RuleReference", 270, false);
            Column("Талбай m²", "AreaM2", 90, false);
            Column("Эзлэхүүн m³", "VolumeM3", 110, false);
            Column("Хүн", "Occupants", 75, true);
            Column("ACH 1/ц", "Ach", 75, true);
            Column("Rp L/s·хүн", "Rp", 95, true);
            Column("Ra L/s·m²", "Ra", 95, true);
            Column("Ez", "Ez", 60, true);
            Column("Сорох L/s", "ExhaustLs", 100, true);
            Column("v m/s", "VelocityMs", 75, true);
            Column("Гадна L/s", "OutdoorLs", 105, false);
            Column("Өгөлт L/s", "SupplyLs", 105, false);
            Column("Терминал L/s", "ActualSupplyLs", 105, false);
            Column("Терминал−хэрэгцээ L/s", "ActualVsRequiredLs", 125, false);
            Column("Өгөлт−соролт L/s", "BalanceLs", 105, false);
            Column("Дугуй Ø мм", "RoundDuctMm", 95, false);
            Column("Төлөв / Анхааруулга", "Status", 350, false);
            _grid.FrozenColumnCount = 2;
        }

        private void BulkField(Panel panel, string label, string property)
        {
            panel.Children.Add(new TextBlock {
                Text = label, VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(7, 0, 3, 0)
            });
            var input = new TextBox { Width = 60, Height = 25, Margin = new Thickness(0, 0, 4, 0) };
            _bulk[property] = input;
            panel.Children.Add(input);
        }

        private static Button ActionButton(string label, RoutedEventHandler handler, bool primary)
        {
            var button = new Button {
                Content = label, Padding = new Thickness(12, 6, 12, 6),
                Margin = new Thickness(4, 0, 0, 5), MinWidth = 95
            };
            if (primary) button.FontWeight = FontWeights.SemiBold;
            button.Click += handler;
            return button;
        }

        private void Column(string header, string path, double width, bool editable)
        {
            _grid.Columns.Add(new DataGridTextColumn {
                Header = header, Width = new DataGridLength(width),
                IsReadOnly = !editable,
                Binding = new System.Windows.Data.Binding(path) {
                    Mode = editable ? BindingMode.TwoWay : BindingMode.OneWay,
                    UpdateSourceTrigger = UpdateSourceTrigger.LostFocus,
                    StringFormat = !editable && (path == "AreaM2" || path == "VolumeM3" || path == "OutdoorLs" || path == "SupplyLs" || path == "ActualSupplyLs" || path == "ActualVsRequiredLs" || path == "BalanceLs") ? "{0:0.##}" : null
                }
            });
        }

        private bool CommitPendingEdit()
        {
            if (!_grid.CommitEdit(DataGridEditingUnit.Cell, true) ||
                !_grid.CommitEdit(DataGridEditingUnit.Row, true))
            {
                MessageBox.Show("Хүснэгтийн тоон оролт буруу байна. Улаанаар тэмдэглэгдсэн нүдийг засна уу.", Title);
                return false;
            }
            return true;
        }

        private void LoadProfiles()
        {
            var picker = new OpenFileDialog {
                Title = "Инженерээр баталгаажсан агааржуулалтын профайл CSV",
                Filter = "CSV (*.csv)|*.csv"
            };
            if (picker.ShowDialog(this) != true) return;
            try
            {
                var info = new FileInfo(picker.FileName);
                if (info.Length > 1024 * 1024)
                    throw new FormatException("Файл 1 MiB-ээс их байна.");
                var profiles = VentilationRateProfiles.ParseCsv(File.ReadAllText(picker.FileName, Encoding.UTF8));
                _profiles.ItemsSource = profiles;
                _profiles.SelectedIndex = 0;
                MessageBox.Show(profiles.Count + " профайл ачааллаа. Эдгээр нь инженерийн баталгаа шаардах " +
                    "гаднын өгөгдөл бөгөөд Revit-д автоматаар хэрэглэгдэхгүй.", Title);
            }
            catch (Exception ex)
            {
                _profiles.ItemsSource = null;
                MessageBox.Show("Профайл нээх боломжгүй: " + ex.Message, Title);
            }
        }

        private void ApplyProfile()
        {
            if (!CommitPendingEdit()) return;
            var p = _profiles.SelectedItem as VentilationRateProfile;
            if (p == null)
            {
                MessageBox.Show("Эхлээд шалгасан CSV профиль сонгоно уу.", Title);
                return;
            }
            var selected = _grid.SelectedItems.Cast<VentilationRow>().ToList();
            if (selected.Count == 0)
            {
                MessageBox.Show("Норм хэрэглэх өрөөнүүдийн мөрийг сонгоно уу. Бүх өрөөнд далдуур түгээхгүй.", Title);
                return;
            }
            if (MessageBox.Show(p.Reference + "\n\n" + selected.Count + " өрөөнд ACH/Rp/Ra/Ez/соролтын " +
                    "өгөгдлийг дарж солих уу? Хэрэглэх боломжтой эсэхийг инженер өрөө тус бүрээр шалгана.",
                    Title, MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes)
                return;
            foreach (var row in selected) row.ApplyProfile(p);
            Recalculate();
        }

        private void Distribute()
        {
            if (!CommitPendingEdit()) return;
            var changes = new Dictionary<string, double>();
            foreach (var field in _bulk)
            {
                if (string.IsNullOrWhiteSpace(field.Value.Text)) continue;
                if (!double.TryParse(field.Value.Text, NumberStyles.Float, CultureInfo.CurrentCulture, out double value) &&
                    !double.TryParse(field.Value.Text, NumberStyles.Float, CultureInfo.InvariantCulture, out value))
                {
                    MessageBox.Show("Буруу тоо: " + field.Key, Title);
                    return;
                }
                if (double.IsNaN(value) || double.IsInfinity(value) || value < 0 ||
                    ((field.Key == "Ez" || field.Key == "VelocityMs") && value <= 0))
                {
                    MessageBox.Show("Тохирохгүй утга: " + field.Key, Title);
                    return;
                }
                changes[field.Key] = value;
            }
            if (changes.Count == 0) return;
            foreach (var row in _rows)
            {
                foreach (var c in changes)
                {
                    switch (c.Key)
                    {
                        case "Ach": row.Ach = c.Value; break;
                        case "Rp": row.Rp = c.Value; break;
                        case "Ra": row.Ra = c.Value; break;
                        case "Ez": row.Ez = c.Value; break;
                        case "VelocityMs": row.VelocityMs = c.Value; break;
                    }
                }
            }
            Recalculate();
        }

        private bool Recalculate()
        {
            if (!CommitPendingEdit()) return false;
            foreach (var row in _rows) row.Calculate();
            _grid.Items.Refresh();
            int valid = _rows.Count(r => r.Result != null && r.Result.Valid);
            int warnings = _rows.Count(r => r.Result != null && r.Result.Warnings.Count > 0);
            double total = _rows.Where(r => r.SupplyLs.HasValue).Sum(r => r.SupplyLs.Value);
            _summary.Text = "Тооцсон: " + valid + "/" + _rows.Count +
                " · Дутуу/алдаатай: " + (_rows.Count - valid) +
                " · Анхааруулга: " + warnings +
                " · Урьдчилсан өгөлтийн нийлбэр: " + total.ToString("0.##", CultureInfo.CurrentCulture) +
                " L/s (олон бүсийн AHU-ийн Vot биш)";
            return true;
        }

        private static string Csv(string text)
        {
            string value = text ?? "";
            // Protect Excel/LibreOffice against formula injection in model-authored names.
            string trimmed = value.TrimStart();
            if (trimmed.Length > 0 && "=+-@".IndexOf(trimmed[0]) >= 0) value = "'" + value;
            return "\"" + value.Replace("\"", "\"\"") + "\"";
        }

        private static string N(double? v)
        {
            return v.HasValue ? v.Value.ToString("0.######", CultureInfo.InvariantCulture) : "";
        }

        private void SaveAssumptions()
        {
            if (!CommitPendingEdit()) return;
            var picker = new SaveFileDialog {
                Title = "Модельтэй холбосон агааржуулалтын оролт хадгалах",
                Filter = "CSV (*.csv)|*.csv",
                FileName = "MGL_Ventilation_Assumptions.csv"
            };
            if (picker.ShowDialog(this) != true) return;
            try
            {
                string csv = VentilationAssumptionsCsv.Export(_rows.Select(r => r.Assumptions()));
                File.WriteAllText(picker.FileName, csv, new UTF8Encoding(true));
                MessageBox.Show(_rows.Count + " өрөөний оролт хадгалагдлаа. " +
                                "Нормын баталгаа, өмнөх геометр хадгалахгүй.", Title);
            }
            catch (Exception ex) { MessageBox.Show("Оролт хадгалах алдаа: " + ex.Message, Title); }
        }

        private void LoadAssumptions()
        {
            if (!CommitPendingEdit()) return;
            var picker = new OpenFileDialog {
                Title = "Өмнө хадгалсан агааржуулалтын оролт сэргээх",
                Filter = "CSV (*.csv)|*.csv"
            };
            if (picker.ShowDialog(this) != true) return;
            try
            {
                if (new FileInfo(picker.FileName).Length > 1024 * 1024)
                    throw new FormatException("CSV 1 MiB-ээс их байна.");
                var rows = VentilationAssumptionsCsv.Parse(
                    File.ReadAllText(picker.FileName, Encoding.UTF8));
                var current = _rows.ToDictionary(
                    r => VentilationAssumptionsCsv.Key(r.UniqueId, r.Source),
                    r => r, StringComparer.Ordinal);
                var unknown = rows.Where(r => !current.ContainsKey(
                    VentilationAssumptionsCsv.Key(r.UniqueId, r.Source))).ToList();
                if (unknown.Count > 0)
                    throw new InvalidOperationException(unknown.Count +
                        " мөрийн UniqueId / Source одоогийн модельд байхгүй. " +
                        "Хуучирсан эсвэл өөр модельд хамаарах CSV-г шууд сэргээхгүй.");
                if (MessageBox.Show(rows.Count + " өрөөний хүн, ACH, Rp/Ra, Ez, соролт, " +
                        "хурдыг шинэчлэх үү? Моделийн талбай/эзлэхүүнийг ОДООГИЙН Revit-ээс " +
                        "ашиглана. Хуучин нормын эх сурвалжийг баталгаажсан гэж үзэхгүй.",
                        Title, MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes)
                    return;
                foreach (var x in rows)
                    current[VentilationAssumptionsCsv.Key(x.UniqueId, x.Source)]
                        .ApplyAssumptions(x);
                Recalculate();
            }
            catch (Exception ex) { MessageBox.Show("Оролт сэргээх боломжгүй: " + ex.Message, Title); }
        }

        private void Export()
        {
            if (!Recalculate()) return;
            var picker = new SaveFileDialog {
                Title = "Агааржуулалтын урьдчилсан тооцооны CSV",
                Filter = "CSV (*.csv)|*.csv",
                FileName = "MGL_Ventilation_Preliminary.csv"
            };
            if (picker.ShowDialog(this) != true) return;
            try
            {
                using (var writer = new StreamWriter(picker.FileName, false, new UTF8Encoding(true)))
                {
                    writer.WriteLine("Number,Name,Level,Source,RuleReference,Area_m2,Volume_m3,Occupants,ACH_per_h,Rp_Ls_person,Ra_Ls_m2,Ez,Exhaust_Ls,Velocity_m_s,Outdoor_Ls,SchematicSupply_Ls,ActualSupply_Ls,ActualMinusRequired_Ls,SupplyMinusExhaust_Ls,RoundDuct_mm,Status");
                    foreach (var r in _rows)
                        writer.WriteLine(string.Join(",", new[] {
                            Csv(r.Number), Csv(r.Name), Csv(r.Level), Csv(r.Source), Csv(r.RuleReference),
                            N(r.AreaM2), N(r.VolumeM3), N(r.Occupants), N(r.Ach),
                            N(r.Rp), N(r.Ra), N(r.Ez), N(r.ExhaustLs), N(r.VelocityMs),
                            N(r.OutdoorLs), N(r.SupplyLs), N(r.ActualSupplyLs), N(r.ActualVsRequiredLs), N(r.BalanceLs),
                            r.RoundDuctMm?.ToString(CultureInfo.InvariantCulture) ?? "",
                            Csv(r.Status)
                        }));
                    writer.WriteLine(Csv("DISCLAIMER: preliminary design worksheet; verify code editions, input rates, thermal loads, exhaust/makeup, duct pressure losses and actual duct catalogue before design approval."));
                }
                MessageBox.Show("CSV тайлан хадгалагдлаа. Инженерийн баталгаажуулалт шаардлагатай.", Title);
            }
            catch (Exception ex) { MessageBox.Show("CSV хадгалах алдаа: " + ex.Message, Title); }
        }

        private void WriteToSpaces()
        {
            if (!Recalculate()) return;
            var applicable = _rows.Where(r => r.Writable && r.Result != null && r.Result.Valid &&
                r.SupplyLs.HasValue && (!r.BalanceLs.HasValue || r.BalanceLs.Value >= -1e-6)).ToList();
            if (applicable.Count == 0)
            {
                MessageBox.Show("Бичих боломжтой, өгөгдөл нь бүрэн MEP Space олдсонгүй. Room ба холбоостой Room-г өөрчлөхгүй.", Title);
                return;
            }
            if (MessageBox.Show(
                applicable.Count + " MEP Space-ийн Specified Supply Airflow параметрт урьдчилсан өгөлт (L/s)-ийг бичих үү?\n\n" +
                "Тооцооны утгууд нь инженерийн баталгаажсан оролт байх ёстой. " +
                "Энэ үйлдэл AHU, duct network, pressure loss, smoke control болон БНбД-ийн иж бүрэн баталгааг орлохгүй.\n\n" +
                "Дутуу/алдаатай болон linked Room-г алгасна. Revit-д нэг transaction (Ctrl+Z)-аар буцааж болно.",
                Title, MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes) return;

            // Preflight ALL parameter writes before opening a transaction.
            var writes = new List<Tuple<Parameter, double>>();
            foreach (var row in applicable)
            {
                var element = _document.GetElement(row.UniqueId) as Space;
                if (element == null)
                {
                    MessageBox.Show(row.Number + ": Space өөрчлөгдсөн байна. Дахин нээнэ үү.", Title);
                    return;
                }
                var p = element.get_Parameter(BuiltInParameter.ROOM_DESIGN_SUPPLY_AIRFLOW_PARAM);
                if (p == null || p.IsReadOnly || p.StorageType != StorageType.Double)
                {
                    MessageBox.Show(row.Number + ": Specified Supply Airflow бичих боломжгүй. " +
                        "Space-ийн airflow тохиргоог шалгана уу. Загвар өөрчлөгдөөгүй.", Title);
                    return;
                }
                writes.Add(Tuple.Create(p, UnitUtils.ConvertToInternalUnits(row.SupplyLs.Value, UnitTypeId.LitersPerSecond)));
            }

            using (var t = new Transaction(_document, "MGL — Агааржуулалтын өгөлт"))
            {
                try
                {
                    t.Start();
                    foreach (var w in writes)
                        if (!w.Item1.Set(w.Item2))
                            throw new InvalidOperationException("Revit параметр шинэчлэхээс татгалзлаа.");
                    if (t.Commit() != TransactionStatus.Committed)
                        throw new InvalidOperationException("Revit transaction бүрэн Commit хийгдээгүй.");
                    MessageBox.Show(writes.Count + " MEP Space-ийн өгөлт шинэчлэгдлээ. " +
                        "Тооцооны оролт, агаарын тэнцвэр, нормативыг инженер дахин шалгана.", Title);
                }
                catch (Exception ex)
                {
                    if (t.GetStatus() == TransactionStatus.Started) t.RollBack();
                    MessageBox.Show("Бичилт бүтэлгүй, transaction буцаагдлаа: " + ex.Message, Title);
                }
            }
        }
    }
}
