using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

namespace RevitMcpAddin.Smart.Tests
{
    /// <summary>
    /// «Ямар ч элементийг хулганаар чирж зөөх» simulation-ий (Sim*.cs) ЭХ КОДЫН бүтцийн хамгаалалт — Revit дээр ажиллуулахгүйгээр шалгаж болох амлалтууд:
    ///   • Core ба Ui нь Revit API-г МЭДЭХГҮЙ (Core = цэвэр, Ui = зөвхөн `ISimSession`-оор);
    ///   • хулганы hook, Win32, reflection, сүлжээ/AI/хэрэгслийн төлбөр БАЙХГҮЙ;
    ///   • загварт бичих ГАНЦ газар: sandbox (ҮРГЭЛЖ RollBack, Assimilate үгүй) ба Apply (нэг Undo);
    ///   • «Нормд нийцсэн» гэж ХЭЗЭЭ Ч тэмдэгт мөрөөр хэлэхгүй.
    /// </summary>
    public static class SimGuardTests
    {
        private static string ChangeImpactDir()
        {
            string dir = AppContext.BaseDirectory;
            for (int i = 0; i < 10 && dir != null; i++)
            {
                string cand = Path.Combine(dir, "addin", "ChangeImpact");
                if (Directory.Exists(cand)) return cand;
                dir = Path.GetDirectoryName(dir);
            }
            string env = Environment.CurrentDirectory;
            for (int i = 0; i < 6 && env != null; i++)
            {
                string cand = Path.Combine(env, "addin", "ChangeImpact");
                if (Directory.Exists(cand)) return cand;
                cand = Path.Combine(env, "revit-mcp", "addin", "ChangeImpact");
                if (Directory.Exists(cand)) return cand;
                env = Path.GetDirectoryName(env);
            }
            throw new AssertFailed("addin/ChangeImpact олдсонгүй");
        }

        /// <summary>Sim* файлууд (Core, Revit, Ui) + сессийн давхарга + команд.  Файлын нэр → эх.</summary>
        private static Dictionary<string, string> Sources(string sub = null)
        {
            string root = ChangeImpactDir();
            var files = new List<string>();
            foreach (string s in new[] { "Core", "Revit", "Ui" })
            {
                if (sub != null && s != sub) continue;
                files.AddRange(Directory.GetFiles(Path.Combine(root, s), "Sim*.cs"));
            }
            if (sub == null || sub == "Revit")
            {
                files.Add(Path.Combine(root, "Revit", "RevitSimSession.cs"));
                files.Add(Path.Combine(root, "Revit", "PreChangeCommand.cs"));
            }
            Assert.True(files.Count >= (sub == null ? 18 : 2), "Sim эх файл олдсонгүй (" + files.Count + ")");
            return files.ToDictionary(f => Path.GetFileName(f), f => File.ReadAllText(f));
        }

        private static string CodeOnly(string src)
        {
            string noBlock = Regex.Replace(src, @"/\*.*?\*/", "", RegexOptions.Singleline);
            string noLine = Regex.Replace(noBlock, @"//[^\r\n]*", "");
            return Regex.Replace(noLine, "\"(?:[^\"\\\\]|\\\\.)*\"", "\"\"");
        }

        [Test]
        public static void CoreAndUi_NeverReferenceTheRevitApi()
        {
            foreach (string sub in new[] { "Core", "Ui" })
                foreach (KeyValuePair<string, string> f in Sources(sub))
                    Assert.False(CodeOnly(f.Value).Contains("Autodesk.Revit"), f.Key + ": " + sub + " нь Revit API-г мэдэх ёсгүй (Core = цэвэр; Ui = ISimSession-оор л)");
        }

        [Test]
        public static void NoMouseHooksWin32OrReflection()
        {
            string[] banned =
            {
                "SetWindowsHookEx", "DllImport", "user32", "GetCursorPos", "SetCursorPos", "GetAsyncKeyState", "mouse_event", "SendInput", "CallNextHookEx", "LibraryImport",
                "System.Reflection", "BindingFlags", "Activator.CreateInstance", ".GetMethod(", ".GetField(", ".GetProperty(", "Marshal.GetFunctionPointerForDelegate",
            };
            foreach (KeyValuePair<string, string> f in Sources())
            {
                string code = CodeOnly(f.Value);
                foreach (string b in banned)
                    Assert.False(code.Contains(b), f.Key + " «" + b + "» хэрэглэж байна — хулганы hook, Win32, reflection ХОРИОТОЙ (Revit-ийн албан ёсны API + WPF-ийн хулганы үйл явдал л)");
            }
        }

        [Test]
        public static void NoCloudAiOrNetworkDependency()
        {
            string[] banned = { "HttpClient", "WebRequest", "WebClient", "Anthropic", "OpenAI", "Gemini", "AiHttp", "ApiClient", "CSharpScript", "Microsoft.CodeAnalysis", "System.Net.Http", "Socket", "MglAi", "Process.Start" };
            foreach (KeyValuePair<string, string> f in Sources())
            {
                string code = CodeOnly(f.Value);
                foreach (string b in banned)
                    Assert.False(code.Contains(b), f.Key + " «" + b + "» хэрэглэж байна — энэ функц ЗЭРО ЗАРДЛААР, локал байх ёстой");
            }
        }

        /// <summary>«Revit-д шууд зөөсний дараах» шалгалт: шинжилгээ загварт ХЭЗЭЭ Ч бичихгүй (гүйлгээгүй); «Буцаах» л нэг MGL гүйлгээ; ажиглагч MGL-ийн өөрийн гүйлгээ, sandbox, Undo-г алгасна.</summary>
        [Test]
        public static void NativeMove_AnalyzerNeverWrites_RevertIsTheOnlyWriter_WatcherSkipsOwnAndUndo()
        {
            string dir = Path.Combine(ChangeImpactDir(), "Revit");
            string analyzer = CodeOnly(File.ReadAllText(Path.Combine(dir, "PostMoveAnalyzer.cs")));
            Assert.False(Regex.IsMatch(analyzer, @"new\s+Transaction") || analyzer.Contains("MoveElement") || Regex.IsMatch(analyzer, @"\.Delete\s*\("), "шинжилгээ загварт бичихгүй");
            string watch = CodeOnly(File.ReadAllText(Path.Combine(dir, "PostMoveWatch.cs")));
            Assert.False(Regex.IsMatch(watch, @"new\s+Transaction") || watch.Contains("MoveElement"), "ажиглагч загварт бичихгүй");
            Assert.True(watch.Contains("UndoOperation.TransactionCommitted"), "Undo/Redo-г алгасна");
            Assert.True(watch.Contains("ImpactSimulationScope.IsActive"), "sandbox-ийг алгасна");
            string rawRevert = File.ReadAllText(Path.Combine(dir, "PostMoveRevert.cs"));
            Assert.True(rawRevert.Contains("\"MGL — Зөөлтийг буцаах\""), "буцаалтын гүйлгээ MGL-ээр эхэлнэ (ажиглагч алгасна)");
            foreach (string f in new[] { "PostMoveAnalyzer.cs", "PostMoveWatch.cs", "PostMoveRevert.cs" })
            {
                string code = CodeOnly(File.ReadAllText(Path.Combine(dir, f)));
                foreach (string b in new[] { "HttpClient", "AiHttp", "ApiClient", "Anthropic", "OpenAI" })
                    Assert.False(code.Contains(b), f + " «" + b + "» — шууд зөөлтийн шалгалт сүлжээ хэрэглэхгүй");
            }
        }

        [Test]
        public static void ModelIsWrittenOnlyBySandboxAndApply()
        {
            foreach (KeyValuePair<string, string> f in Sources())
            {
                string code = CodeOnly(f.Value);
                bool allowed = f.Key == "SimExactAnalyzer.cs" || f.Key == "SimApply.cs";
                if (allowed) continue;
                Assert.False(Regex.IsMatch(code, @"new\s+Transaction\s*\("), f.Key + ": Transaction нээж болохгүй (зөвхөн sandbox, apply)");
                Assert.False(Regex.IsMatch(code, @"new\s+TransactionGroup\s*\("), f.Key + ": TransactionGroup нээж болохгүй");
                Assert.False(Regex.IsMatch(code, @"\.Commit\s*\("), f.Key + ": Commit хориотой");
                Assert.False(code.Contains("MoveElement"), f.Key + ": MoveElement зөвхөн sandbox, apply");
                Assert.False(code.Contains("ElementTransformUtils"), f.Key + ": ElementTransformUtils зөвхөн sandbox, apply");
                Assert.False(Regex.IsMatch(code, @"\.Delete\s*\("), f.Key + ": Delete хориотой");
            }
        }

        [Test]
        public static void Sandbox_AlwaysRollsBackInFinally_NeverAssimilates_AndSuppressesMglObservers()
        {
            string src = CodeOnly(Sources("Revit")["SimExactAnalyzer.cs"]);
            int fin = src.LastIndexOf("finally", StringComparison.Ordinal);
            Assert.True(fin >= 0 && src.IndexOf("tg.RollBack(", fin, StringComparison.Ordinal) > fin, "группийн RollBack нь finally дотор байх ёстой");
            Assert.False(src.Contains("Assimilate"), "sandbox группийг ХЭЗЭЭ Ч assimilate хийхгүй (Undo-д орно)");
            Assert.True(src.Contains("ImpactSimulationScope.Begin"), "MGL-ийн ажиглагчдыг хаах scope");
            Assert.True(src.Contains("DocumentChanged -= onChanged"), "түр DocumentChanged-ээс заавал салгана");
            Assert.True(src.Contains("PreChangeRestoreCheck"), "буцаалтыг баталгаажуулдаг (fail-closed)");
            Assert.True(src.Contains("NotRestored"), "буцаалт баталгаажихгүй бол NotRestored");
        }

        [Test]
        public static void Apply_IsOneUndo_VerifiesSettledState_AndRollsBackOnMismatch()
        {
            string raw = Sources("Revit")["SimApply.cs"];
            string src = CodeOnly(raw);
            Assert.True(raw.Contains("MGL — Элемент зөөх"), "Undo-н нэр");
            Assert.True(src.Contains("tg.Assimilate()"), "нэг Undo — TransactionGroup.Assimilate");
            Assert.True(src.Contains("RollBackGroup("), "тулгалт зөрвөл буцаана");
            Assert.True(src.Contains("ObservationDeferral"), "MGL-ийн ажиглагчид хойшлогдоно");
            Assert.True(Regex.Matches(src, @"MoveElements?\s*\(").Count == 2, "Apply зөвхөн ГАНЦ зөөлт (нэг/олон элементийн хоёр хувилбар)");
        }

        [Test]
        public static void NoHandWrittenUnitConversionConstants()
        {
            foreach (KeyValuePair<string, string> f in Sources("Revit"))
            {
                string code = CodeOnly(f.Value);
                Assert.False(Regex.IsMatch(code, @"\b304\.8\b|\b0\.3048\b|\b3\.28084\b|\b10\.7639"), f.Key + ": нэгж хөрвүүлэх тогтмолыг гараар бичсэн — UnitUtils/PcUnits ашиглана");
            }
        }

        [Test]
        public static void NeverClaimsCodeCompliance_InAnyShownText()
        {
            foreach (KeyValuePair<string, string> f in Sources())
            {
                // Тэмдэгт мөрийг (харуулах бичвэр) шалгана — тайлбар (///) дахь «хэзээ ч бичихгүй» гэсэн сануулга зөвшөөрөгдөнө.
                string noComments = Regex.Replace(Regex.Replace(f.Value, @"/\*.*?\*/", "", RegexOptions.Singleline), @"//[^\r\n]*", "");
                Assert.False(noComments.IndexOf("Нормд нийцсэн", StringComparison.OrdinalIgnoreCase) >= 0 || noComments.IndexOf("БНбД-д нийцсэн", StringComparison.OrdinalIgnoreCase) >= 0 || noComments.IndexOf("Compliant", StringComparison.OrdinalIgnoreCase) >= 0,
                    f.Key + ": «норм/код нийцсэн» гэж харуулах бичвэр ХЭЗЭЭ Ч байж болохгүй");
            }
        }

        [Test]
        public static void ReleaseCommand_DoesNotGateTheLicense_Differently()
        {
            string raw = Sources("Revit")["PreChangeCommand.cs"];
            Assert.True(raw.Contains("LicenseGate.Ensure()"), "лиценз шалгалт хэвээр (LicenseGate хөндөгдөөгүй)");
            Assert.False(raw.Contains("TaskDialog.Show(DialogTitle, \"Хаалга зөөх / Хана зөөх"), "цэс, сонголтын диалог БАЙХГҮЙ — шууд simulation цонх");
            Assert.True(raw.Contains("new SimWindow("), "команд шууд simulation цонхыг нээнэ");
        }
    }
}
