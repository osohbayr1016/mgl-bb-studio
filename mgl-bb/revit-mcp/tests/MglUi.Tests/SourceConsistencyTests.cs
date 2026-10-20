using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;
using RevitMcpAddin.Ui.Core;

namespace RevitMcpAddin.Ui.Tests
{
    /// <summary>
    /// Revit-ийн төрөл шаарддаг (тест эмхэтгэж чадахгүй) `RibbonBuilder`-ийн холбоос хүснэгтийг ЭХ КОДООР нь
    /// метадататай тулгана.  Эх файлыг `[CallerFilePath]`-оор олно — тест хаана ч (scratch OutDir) ажилласан ч зөв.
    /// </summary>
    public static class SourceConsistencyTests
    {
        private static string AddinDir([CallerFilePath] string here = "")
        {
            // …/revit-mcp/tests/MglUi.Tests/SourceConsistencyTests.cs → …/revit-mcp/addin
            string testsDir = Path.GetDirectoryName(Path.GetDirectoryName(here));
            return Path.Combine(Path.GetDirectoryName(testsDir), "addin");
        }

        private static string Read(string relative)
        {
            return File.ReadAllText(Path.Combine(AddinDir(), relative.Replace('/', Path.DirectorySeparatorChar)));
        }

        private const string Net8Marker = "#if NET8_0_OR_GREATER\n            // ── Зөвхөн";

        private static string Normalize(string s) { return s.Replace("\r\n", "\n"); }

        /// <summary>Коммент хасна (// ба /* */) — «pack://» гэж ТАЙЛБАРЛАЖ буй коммент ТАЙЛАНГ унагаахгүй, харин код дахь тэмдэгт мөр (new Uri("pack://…")) баригдана.</summary>
        private static string CodeOnly(string src)
        {
            string noBlock = Regex.Replace(src, @"/\*.*?\*/", string.Empty, RegexOptions.Singleline);
            return Regex.Replace(noBlock, @"(^|\s)//[^\n]*", "$1", RegexOptions.Multiline);
        }

        [Test]
        public static void Every_tool_has_a_ribbon_binding_in_the_right_build_section()
        {
            string rb = Normalize(Read("Ui/Revit/RibbonBuilder.cs"));
            int split = rb.IndexOf(Net8Marker, StringComparison.Ordinal);
            Assert.True(split > 0, "RibbonBuilder-д `#if NET8_0_OR_GREATER` хэсэг олдсонгүй");
            var all = new HashSet<string>(Regex.Matches(rb.Substring(0, split), "d\\[\"(Mgl\\w+)\"\\]").Cast<Match>().Select(m => m.Groups[1].Value));
            var net8 = new HashSet<string>(Regex.Matches(rb.Substring(split), "d\\[\"(Mgl\\w+)\"\\]").Cast<Match>().Select(m => m.Groups[1].Value));

            foreach (ToolMeta t in ToolCatalogData.All)
            {
                if (t.Build == ToolBuild.All) Assert.True(all.Contains(t.Name), t.Name + " R24-д байх ёстой, холбоосгүй");
                else Assert.True(net8.Contains(t.Name) && !all.Contains(t.Name), t.Name + " зөвхөн #if NET8_0_OR_GREATER хэсэгт байх ёстой");
            }
            foreach (string n in all.Concat(net8)) Assert.NotNull(ToolCatalogData.Find(n), "метадатагүй холбоос: " + n);
        }

        [Test]
        public static void Old_hardcoded_ribbon_files_are_gone_and_app_delegates_to_the_builder()
        {
            Assert.False(File.Exists(Path.Combine(AddinDir(), "Smart/Revit/SmartRibbon.cs".Replace('/', Path.DirectorySeparatorChar))), "SmartRibbon.cs устсан байх ёстой");
            Assert.False(File.Exists(Path.Combine(AddinDir(), "Reinforcement/RfRibbon.cs".Replace('/', Path.DirectorySeparatorChar))), "RfRibbon.cs устсан байх ёстой");
            string app = Read("App.cs");
            Assert.True(app.Contains("Ui.Revit.RibbonBuilder.Build("), "App.cs нь RibbonBuilder-ийг дуудах ёстой");
            Assert.False(app.Contains("new PushButtonData("), "App.cs-д товч гараар үүсгэх код үлдэхгүй");
            Assert.False(app.Contains("эргүүлэх, толин тусгал одоохондоо байхгүй"), "хуучин ХУДАЛ tooltip");
        }

        [Test]
        public static void Embedded_control_styles_are_declared_as_resource_not_page()
        {
            string csproj = Normalize(Read("RevitMcpAddin.csproj"));
            Assert.True(csproj.Contains("<Page Remove=\"Ui\\Resources\\**\\*.xaml\" />"), "Ui/Resources/*.xaml Page биш байх ёстой");
            Assert.True(csproj.Contains("LogicalName=\"RevitMcpAddin.Ui.MglControls.xaml\""), "LogicalName");
            Assert.True(Read("Ui/MglStyles.cs").Contains("\"RevitMcpAddin.Ui.MglControls.xaml\""), "MglStyles.ResourceName csproj-тэй таарах ёстой");
        }

        [Test]
        public static void Shared_ui_layer_never_touches_application_resources()
        {
            // Revit/бусад add-in-ийн глобал сэдэвд нөлөөлөхгүй гэсэн амлалт.
            foreach (string f in new[] { "Ui/MglTheme.cs", "Ui/MglStyles.cs", "Ui/MglWindow.cs", "Ui/MglUi.cs", "Ui/ToolCatalogWindow.cs", "Ui/MglBusy.cs", "Ui/MglBrushes.cs" })
            {
                string src = CodeOnly(Read(f));
                Assert.False(src.Contains("Application.Current"), f + " нь Application.Current-д хүрч болохгүй");
                Assert.False(src.Contains("Application.Resources"), f + " нь Application.Resources-д хүрч болохгүй");
            }
        }

        [Test]
        public static void Dock_panes_use_the_shared_tokens_and_keep_no_local_palette()
        {
            // 4 самбар (AssistantPane, WorkPane, Intelligence, Зураг клонлох) хуучин нь тус бүр палитраа хуулбарласан байв.
            foreach (string f in new[] { "AssistantPane.xaml", "WorkPane/WorkPaneView.xaml", "Intelligence/Ui/IntelligencePanel.xaml" })
            {
                string xaml = Read(f);
                Assert.False(Regex.IsMatch(xaml, "<SolidColorBrush\\s+x:Key=\"(Bg|BgRaised|BgInput|Line|Fg|FgMuted|Accent|AccentDim|Warn|Danger|Ok)\""),
                    f + ": токенийг local палитраар ДАХИН тодорхойлж болохгүй (Ui/MglTheme)");
                Assert.False(xaml.Contains("StaticResource Bg") || xaml.Contains("StaticResource Fg") || xaml.Contains("StaticResource Line") || xaml.Contains("StaticResource Accent"),
                    f + ": токен нь DynamicResource байх ёстой (сэдэв солигдоход дагана)");
                Assert.False(Regex.IsMatch(xaml, "\\b(Background|Foreground|BorderBrush|Fill)=\"#[0-9A-Fa-f]{6,8}\""), f + ": hex өнгө шууд бичигдсэн");
            }
            foreach (string f in new[] { "AssistantPane.xaml.cs", "WorkPane/WorkPaneView.xaml.cs", "Intelligence/Ui/IntelligencePanel.xaml.cs" })
                Assert.True(CodeOnly(Read(f)).Contains("MglTheme.Apply("), f + ": MglTheme.Apply дуудаагүй");

            string cd = CodeOnly(Read("CloneDrawings/CdJobPaneView.cs"));
            Assert.True(cd.Contains("MglTheme.Apply("), "CdJobPaneView: MglTheme.Apply дуудаагүй");
            Assert.False(cd.Contains("Frozen(\"#"), "CdJobPaneView: local палитр үлдсэн");
            Assert.False(Regex.IsMatch(cd, "ColorConverter|new SolidColorBrush|Brushes\\.White"), "CdJobPaneView: өнгийг кодоор бүү зохио — токенд холбо");
            Assert.False(Regex.IsMatch(cd, "FontSize = 1[01]\\b"), "CdJobPaneView: бичвэр ≥ 12 DIP");
        }

        [Test]
        public static void Ui_window_layer_does_not_depend_on_the_Revit_App_class()
        {
            // MglWindow/MglTheme/MglBrushes нь Revit-гүй smoke төслүүдэд (SheetNumerator, CloneDrawings) эмхэтгэгдэх ёстой.
            foreach (string f in new[] { "Ui/MglWindow.cs", "Ui/MglTheme.cs", "Ui/MglBrushes.cs", "Ui/MglStyles.cs", "Ui/MglUiPrefs.cs", "Ui/MglNative.cs", "Ui/MglBusy.cs" })
            {
                string src = CodeOnly(Read(f));
                Assert.False(Regex.IsMatch(src, @"(?<![\w.])App\."), f + " нь `App`-д шууд хамаарч болохгүй (Revit-гүй smoke эмхэтгэл)");
                Assert.False(src.Contains("Autodesk.Revit"), f + " нь Revit API-д хамаарч болохгүй");
                Assert.False(src.Contains("SettingsStore"), f + " нь SettingsStore-д хамаарч болохгүй");
            }
        }

        [Test]
        public static void Phase4_windows_use_tokens_not_hardcoded_colours_or_opacity_contrast()
        {
            foreach (string f in new[] { "BindingDialog.xaml", "BatchSheetDialog.xaml", "SheetNumerator/Ui/SheetNumeratorWindow.xaml" })
            {
                string x = Read(f);
                Assert.False(Regex.IsMatch(x, "(Background|Foreground|BorderBrush|Fill|Color)=\"#[0-9A-Fa-f]{6,8}\""), f + ": hex өнгө шууд бичигдсэн");
                Assert.False(Regex.IsMatch(x, "(Background|Foreground|BorderBrush)=\"(White|Gray|Black|LightGray)\""), f + ": нэрлэсэн өнгө — токен ашигла");
                Assert.False(Regex.IsMatch(x, "FontSize=\"(9|10|11)\""), f + ": бичвэр ≥ 12 DIP");
            }
            foreach (string f in new[] { "AutoAnnotate/AutoAnnotateDialog.cs", "CloneDrawings/CloneDrawingsDialog.cs", "CopyToOtherCommand.cs", "Licensing/LicenseDialog.cs" })
            {
                string c = CodeOnly(Read(f));
                Assert.False(c.Contains("new SolidColorBrush"), f + ": өнгө кодоор зохиогдсон — токенд холбо (SetResourceReference/MglUi.Note)");
                Assert.False(Regex.IsMatch(c, "Opacity = 0\\.[0-9]+"), f + ": Opacity-гаар «хоёрдогч бичвэр» хийж болохгүй (контраст) — FgMuted токен");
                Assert.False(Regex.IsMatch(c, "FontSize = (9|10|11)\\b"), f + ": бичвэр ≥ 12 DIP");
            }
        }

        [Test]
        public static void ERP_commands_wait_through_the_busy_window_not_a_silent_freeze()
        {
            // Execute-ийн сүлжээний хүлээлт: `Task.Run(...).GetAwaiter().GetResult()` БИШ, `MglBusy.Run` (400 мс-ээс удвал цонх).
            foreach (string f in new[] { "QtoExportCommand.cs", "ScheduleExportCommand.cs", "PdfViewExportCommand.cs", "BindingCommand.cs" })
            {
                string c = CodeOnly(Read(f));
                Assert.True(c.Contains("MglBusy.Run"), f + ": MglBusy.Run ашиглаагүй");
                Assert.False(Regex.IsMatch(c, @"Task\.Run\(.*?\)\s*\.GetAwaiter\(\)\.GetResult\(\)", RegexOptions.Singleline), f + ": UI thread-ийг ≤180 с хөлдөөдөг хуучин хүлээлт үлдсэн");
            }
            string busy = CodeOnly(Read("Ui/MglBusy.cs"));
            Assert.False(busy.Contains("new Button") || busy.Contains("CancellationToken"), "MglBusy-д «Цуцлах» товч байж болохгүй — ApiClient цуцлах токенгүй тул хуурамч амлалт");
        }

        [Test]
        public static void Smart_windows_prepare_theme_and_placement_through_UiKit()
        {
            foreach (string f in new[] { "SmartCount/Ui/SmartCountWindow.cs", "ClashCheck/Ui/ClashWindow.cs", "ClashCheck/Ui/ClashRuleDialog.cs",
                                          "ChangeImpact/Ui/ChangeImpactWindow.cs", "SmartPublish/Ui/PublishDialog.cs", "SmartPublish/Ui/ProfileEditorDialog.cs",
                                          "SmartPublish/Ui/PublishProgressWindow.cs" })
                Assert.True(CodeOnly(Read(f)).Contains("UiKit.Prepare("), f + ": UiKit.Prepare дуудаагүй (сэдэв + ажлын талбарт багтаах)");
            string kit = CodeOnly(Read("Smart/Ui/SmartUi.cs"));
            Assert.False(kit.Contains("new SolidColorBrush"), "UiKit: тогтмол өнгө үлдсэн — MglBrushes ашигла");
            Assert.False(Regex.IsMatch(Read("SmartPublish/Ui/PublishDialog.cs"), "Header = \"Preflight\""), "«Preflight» → «Гаргахын өмнөх шалгалт»");
        }

        [Test]
        public static void CodeOnly_strips_comments_but_keeps_string_literals()
        {
            Assert.False(CodeOnly("// pack://x\nint a;").Contains("pack://"));
            Assert.False(CodeOnly("/// <summary>pack://x</summary>\nint a;").Contains("pack://"));
            Assert.False(CodeOnly("/* pack://x */ int a;").Contains("pack://"));
            Assert.True(CodeOnly("var u = new Uri(\"pack://application:,,,/x\");").Contains("pack://"));
            Assert.True(CodeOnly("int a; // x\nvar u = \"pack://y\";").Contains("pack://"));
        }

        [Test]
        public static void Shared_ui_layer_has_no_pack_uri()
        {
            foreach (string f in Directory.GetFiles(Path.Combine(AddinDir(), "Ui"), "*.cs", SearchOption.AllDirectories))
                Assert.False(CodeOnly(File.ReadAllText(f)).Contains("pack://"), f + " pack:// хэрэглэж болохгүй");
        }
    }
}
