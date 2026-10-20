using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Win32;
using Autodesk.Revit.DB;
using RevitMcpAddin.Ventilation.Core;

namespace RevitMcpAddin.Ventilation.Revit
{
    /// <summary>
    /// Explicit manual radial-network input and report. No changes to Revit
    /// geometry or airflow parameters. No default engineering assumptions.
    /// </summary>
    public sealed class DuctNetworkWindow : Window
    {
        private readonly Dictionary<string, TextBox> _settings =
            new Dictionary<string, TextBox>();
        private readonly TextBlock _fileLabel;
        private readonly TextBox _report;
        private DuctNetworkResult _latest;
        private string _networkCsv;
        private string _auditCsv;
        private readonly Document _document;

        public DuctNetworkWindow(Document document)
        {
            _document = document;
            Title = "MGL — Сувгийн сүлжээний урьдчилсан даралт";
            Width = 890;
            Height = 700;
            MinWidth = 650;
            MinHeight = 560;
            WindowStartupLocation = WindowStartupLocation.CenterOwner;
            var root = new DockPanel { Margin = new Thickness(16) };
            Content = root;
            var top = new StackPanel { Orientation = Orientation.Vertical };
            DockPanel.SetDock(top, Dock.Top);
            root.Children.Add(top);
            top.Children.Add(new TextBlock {
                Text = "Радиал сувгийн сүлжээ — урьдчилсан гидравлик тооцоо",
                FontWeight = FontWeights.SemiBold, FontSize = 19,
                Margin = new Thickness(0, 0, 0, 10)
            });
            top.Children.Add(new TextBlock {
                Text = "CSV: id,parent_id,terminal_ls,length_m,roughness_mm,loss_k. " +
                       "Root-ийн parent_id хоосон. terminal_ls нь тухайн мөчир дээрх агаарын төгсгөлийн хэрэглээ. " +
                       "Бодит Revit connector, fitting, AHU загвар болон норм автоматаар танигдахгүй.",
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 0, 0, 9)
            });
            var settings = new WrapPanel { Margin = new Thickness(0, 0, 0, 8) };
            top.Children.Add(settings);
            AddSetting(settings, "Агаарын нягт kg/m³", "rho");
            AddSetting(settings, "Динамик зуурамтгай Pa·s", "mu");
            AddSetting(settings, "Хамгийн их хурд m/s", "velocity");
            AddSetting(settings, "Сэнсний нөөц Pa", "reserve");
            AddSetting(settings, "Нийт КПД 0–1 (сонголттой)", "efficiency");
            var buttons = new WrapPanel { Margin = new Thickness(0, 0, 0, 8) };
            top.Children.Add(buttons);
            var open = new Button { Content = "CSV сүлжээ нээх…", Padding = new Thickness(12, 6, 12, 6),
                                    Margin = new Thickness(0, 0, 7, 0) };
            open.Click += (s, e) => OpenCsv();
            buttons.Children.Add(open);
            var calculate = new Button { Content = "Тооцоолох", Padding = new Thickness(12, 6, 12, 6),
                                         Margin = new Thickness(0, 0, 7, 0) };
            calculate.Click += (s, e) => Calculate();
            buttons.Children.Add(calculate);
            var save = new Button { Content = "CSV тайлан хадгалах…", Padding = new Thickness(12, 6, 12, 6) };
            save.Click += (s, e) => Export();
            buttons.Children.Add(save);
            var audit = new Button {
                Content = "Revit систем аудит", Padding = new Thickness(12, 6, 12, 6),
                Margin = new Thickness(7, 0, 0, 0)
            };
            audit.Click += (s, e) => AuditModel();
            buttons.Children.Add(audit);
            var auditSave = new Button {
                Content = "Аудит CSV", Padding = new Thickness(12, 6, 12, 6),
                Margin = new Thickness(7, 0, 0, 0)
            };
            auditSave.Click += (s, e) => ExportAudit();
            buttons.Children.Add(auditSave);
            _fileLabel = new TextBlock {
                Text = "CSV сүлжээ ачаалаагүй.", Margin = new Thickness(0, 0, 0, 8)
            };
            top.Children.Add(_fileLabel);
            _report = new TextBox {
                IsReadOnly = true, FontFamily = new System.Windows.Media.FontFamily("Consolas"),
                FontSize = 12, VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
                TextWrapping = TextWrapping.NoWrap, AcceptsReturn = true,
                Text = "Мэдэгдэл: инженер бүх өгөгдөл, fitting loss, акустик, " +
                       "fan curve, галын шаардлага болон нормативыг тусад нь шалгана."
            };
            root.Children.Add(_report);
        }

        private void AddSetting(Panel panel, string title, string key)
        {
            var stack = new StackPanel { Width = 168, Margin = new Thickness(0, 0, 8, 7) };
            stack.Children.Add(new TextBlock { Text = title, FontSize = 11 });
            var box = new TextBox { Height = 26, MinWidth = 115 };
            _settings.Add(key, box);
            stack.Children.Add(box);
            panel.Children.Add(stack);
        }

        private void OpenCsv()
        {
            var picker = new OpenFileDialog {
                Filter = "CSV (*.csv)|*.csv", Title = "Радиал сувгийн сүлжээний CSV"
            };
            if (picker.ShowDialog(this) != true) return;
            try
            {
                if (new FileInfo(picker.FileName).Length > 1024 * 1024)
                    throw new FormatException("CSV 1 MiB-ээс их байна.");
                string csv = File.ReadAllText(picker.FileName, Encoding.UTF8);
                var branches = DuctNetworkCsv.Parse(csv);
                _networkCsv = csv;
                _latest = null;
                _fileLabel.Text = Path.GetFileName(picker.FileName) + ": " +
                                  branches.Count + " мөчир.";
                _report.Text = "CSV бүтэц шалгагдлаа. Агаарын шинж чанар, хурд, нөөцөө " +
                               "баталгаажуулан «Тооцоолох» дарна уу.";
            }
            catch (Exception ex)
            {
                _networkCsv = null; _latest = null;
                _fileLabel.Text = "CSV буруу.";
                _report.Text = ex.Message;
            }
        }

        private double? ParseSetting(string key, bool optional)
        {
            string value = _settings[key].Text.Trim();
            if (optional && value.Length == 0) return null;
            if (!double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out double n) &&
                !double.TryParse(value, NumberStyles.Float, CultureInfo.CurrentCulture, out n))
                throw new FormatException(key + ": тоон утга оруулна уу (жишээ: 1.2).");
            if (double.IsNaN(n) || double.IsInfinity(n))
                throw new FormatException(key + ": NaN/Infinity зөвшөөрөхгүй.");
            return n;
        }

        private void Calculate()
        {
            _latest = null;
            if (_networkCsv == null)
            {
                _report.Text = "Эхлээд сүлжээний CSV нээнэ үү.";
                return;
            }
            try
            {
                var input = new DuctNetworkInput {
                    DensityKgM3 = ParseSetting("rho", false),
                    DynamicViscosityPaS = ParseSetting("mu", false),
                    MaxDesignVelocityMs = ParseSetting("velocity", false),
                    ExplicitFanReservePa = ParseSetting("reserve", false),
                    FanTotalEfficiency = ParseSetting("efficiency", true),
                    Branches = DuctNetworkCsv.Parse(_networkCsv)
                };
                var result = DuctNetworkCalculator.Calculate(input);
                if (!result.Valid)
                {
                    _report.Text = "Тооцоог зөвшөөрөөгүй:\n" + string.Join("\n", result.Errors);
                    return;
                }
                _latest = result;
                var s = new StringBuilder();
                s.AppendLine("ТӨСЛИЙН / УРЬДЧИЛСАН ТООЦОО — НОРМЫН БАТАЛГАА БИШ");
                s.AppendLine("Нийт өгөлт: " + result.HeaderFlowLs.Value.ToString("0.##") + " L/s");
                s.AppendLine("Критик замын даралт: " + result.CriticalPathPressurePa.Value.ToString("0.##") + " Pa");
                s.AppendLine("Нөөцтэй шаардлагатай урьдчилсан даралт: " +
                    result.PreliminaryFanPressurePa.Value.ToString("0.##") + " Pa");
                s.AppendLine("Критик зам: " + string.Join(" → ", result.CriticalPathIds));
                if (result.EstimatedElectricPowerW.HasValue)
                    s.AppendLine("Ойролцоо чадал: " +
                        result.EstimatedElectricPowerW.Value.ToString("0.##") + " W");
                s.AppendLine();
                foreach (var b in result.Branches)
                    s.AppendLine(b.Id + " [" + b.ParentId + "] " +
                        b.FlowLs.ToString("0.##") + " L/s, Ø" + b.DiameterMm +
                        " mm, " + b.VelocityMs.ToString("0.##") + " m/s, Δp=" +
                        b.PressureDropPa.ToString("0.##") + " Pa");
                s.AppendLine();
                foreach (var warning in result.Warnings)
                    s.AppendLine("АНХААР: " + warning);
                _report.Text = s.ToString();
            }
            catch (Exception ex) { _report.Text = "Тооцооны алдаа: " + ex.Message; }
        }

        private void AuditModel()
        {
            _auditCsv = null;
            try
            {
                _auditCsv = RevitHvacAudit.ReadCsv(_document);
                _report.Text = _auditCsv;
            }
            catch (Exception ex)
            {
                _report.Text = "Revit MEP аудит хийх боломжгүй: " + ex.Message;
            }
        }

        private void ExportAudit()
        {
            if (_auditCsv == null)
            {
                MessageBox.Show("Эхлээд «Revit систем аудит» дарна уу.", Title);
                return;
            }
            var picker = new SaveFileDialog {
                Filter = "CSV (*.csv)|*.csv", FileName = "MGL_Revit_HVAC_ReadOnly_Audit.csv"
            };
            if (picker.ShowDialog(this) != true) return;
            try
            {
                File.WriteAllText(picker.FileName, _auditCsv, new UTF8Encoding(true));
                MessageBox.Show("Revit-ийн уншсан мэдээллийн аудит хадгалагдлаа.", Title);
            }
            catch (Exception ex) { MessageBox.Show("Аудит хадгалах алдаа: " + ex.Message, Title); }
        }

        private void Export()
        {
            if (_latest == null || !_latest.Valid)
            {
                MessageBox.Show("Эхлээд хүчинтэй урьдчилсан тооцоо хийнэ үү.", Title);
                return;
            }
            var picker = new SaveFileDialog {
                Filter = "CSV (*.csv)|*.csv", FileName = "MGL_Duct_Network_Preliminary.csv"
            };
            if (picker.ShowDialog(this) != true) return;
            try
            {
                File.WriteAllText(picker.FileName, DuctNetworkCsv.Report(_latest), new UTF8Encoding(true));
                MessageBox.Show("Тайлан хадгалагдлаа. Зөвшөөрөгдсөн зураг төсөл биш.", Title);
            }
            catch (Exception ex) { MessageBox.Show("Хадгалах алдаа: " + ex.Message, Title); }
        }
    }
}
