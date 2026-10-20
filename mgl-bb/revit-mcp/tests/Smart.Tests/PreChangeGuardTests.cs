using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

namespace RevitMcpAddin.Smart.Tests
{
    /// <summary>
    /// «Өөрчлөхөөс өмнө шалгах»-ын ЭХ КОДЫН бүтцийн хамгаалалт — Revit дээр ажиллуулахгүйгээр шалгаж болох амлалтууд:
    ///   • ЗЭРО ЗАРДАЛ: AI/cloud/сүлжээний хэрэгсэл ЭНЭ функцэд ОРООГҮЙ;
    ///   • нэгж хөрвүүлэлт: «304.8» гэх мэт гараар бичсэн тогтмол ОРООГҮЙ (Revit-ийн `UnitUtils`);
    ///   • ЗАГВАР ӨӨРЧЛӨХ ГАНЦ ЗАМ: транзакц ЗӨВХӨН sandbox (буцаадаг) ба apply-д; preview-д commit-аар үлдэх зам байхгүй;
    ///   • sandbox нь ҮРГЭЛЖ буцаалттай, MGL-ийн ажиглагчдыг хаадаг.
    /// Эх кодыг `addin/ChangeImpact`-аас олж уншина (олдохгүй бол тест унана — чимээгүй алгасахгүй).
    /// </summary>
    public static class PreChangeGuardTests
    {
        private static string AddinDir()
        {
            string dir = AppContext.BaseDirectory;
            for (int i = 0; i < 10 && dir != null; i++)
            {
                string cand = Path.Combine(dir, "addin", "ChangeImpact");
                if (Directory.Exists(cand)) return Path.Combine(dir, "addin");
                string up = Path.Combine(dir, "..", "..", "addin", "ChangeImpact");
                dir = Path.GetDirectoryName(dir);
            }
            string env = Environment.CurrentDirectory;
            for (int i = 0; i < 6 && env != null; i++)
            {
                string cand = Path.Combine(env, "addin", "ChangeImpact");
                if (Directory.Exists(cand)) return Path.Combine(env, "addin");
                cand = Path.Combine(env, "revit-mcp", "addin", "ChangeImpact");
                if (Directory.Exists(cand)) return Path.Combine(env, "revit-mcp", "addin");
                env = Path.GetDirectoryName(env);
            }
            throw new AssertFailed("addin/ChangeImpact олдсонгүй");
        }

        private static Dictionary<string, string> Sources()
        {
            string root = AddinDir();
            var files = new List<string>();
            foreach (string sub in new[] { "Core", "Revit", "Ui" })
            {
                files.AddRange(Directory.GetFiles(Path.Combine(root, "ChangeImpact", sub), "*PreChange*.cs"));
                // «Хаалга зөөх» симуляци (Door*.cs) — зэро зардал, Transaction/Commit/MoveElement хориг, нэгж хөрвүүлэлтийн хамгаалалт ЯГ ИЖИЛ үйлчилнэ.
                files.AddRange(Directory.GetFiles(Path.Combine(root, "ChangeImpact", sub), "Door*.cs"));
            }
            files.Add(Path.Combine(root, "SimulationScope.cs"));
            files.Add(Path.Combine(root, "DocChange.cs"));
            // PreChange нэртэй биш ч ЭНЭ функцийн шинэ файлууд — зэро зардлын хамгаалалт тэдгээрт ч үйлчилнэ.
            foreach (string extra in new[] { Path.Combine("Core", "ObservationBuffer.cs"), Path.Combine("Core", "StageClock.cs"), Path.Combine("Core", "ItemCodes.cs"), Path.Combine("Revit", "ObservationDeferral.cs") })
                files.Add(Path.Combine(root, "ChangeImpact", extra));
            Assert.True(files.Count >= 25, "PreChange эх файл олдсонгүй (" + files.Count + ")");
            return files.ToDictionary(f => Path.GetFileName(f), f => File.ReadAllText(f));
        }

        private static string CodeOnly(string src)
        {
            // Тайлбар (// ба /* */) болон тэмдэгт мөрийг хасч код л үлдээнэ — тайлбар дахь нэр хориг мөрийг барихгүй.
            string noBlock = Regex.Replace(src, @"/\*.*?\*/", "", RegexOptions.Singleline);
            string noLine = Regex.Replace(noBlock, @"//[^\r\n]*", "");
            return Regex.Replace(noLine, "\"(?:[^\"\\\\]|\\\\.)*\"", "\"\"");
        }

        [Test]
        public static void NoCloudAiOrNetworkDependency_InPreChangeCode()
        {
            string[] banned = { "HttpClient", "WebRequest", "WebClient", "Anthropic", "OpenAI", "Gemini", "AiHttp", "ApiClient", "CSharpScript", "Microsoft.CodeAnalysis", "System.Net.Http", "Socket", "MglAi" };
            foreach (KeyValuePair<string, string> f in Sources())
            {
                string code = CodeOnly(f.Value);
                foreach (string b in banned)
                    Assert.False(code.Contains(b), f.Key + " «" + b + "» хэрэглэж байна — энэ функц ЗЭРО ЗАРДЛААР, локал байх ёстой");
            }
        }

        [Test]
        public static void NoHandWrittenUnitConversionConstants()
        {
            foreach (KeyValuePair<string, string> f in Sources())
            {
                string code = CodeOnly(f.Value);
                Assert.False(Regex.IsMatch(code, @"\b304\.8\b|\b0\.3048\b|\b3\.28084\b|\b25\.4\b|\b10\.7639"), f.Key + ": нэгж хөрвүүлэх тогтмолыг гараар бичсэн — UnitUtils ашиглана");
            }
        }

        [Test]
        public static void Transactions_ExistOnlyInSandboxAndApply()
        {
            foreach (KeyValuePair<string, string> f in Sources())
            {
                string code = CodeOnly(f.Value);
                bool allowed = f.Key == "PreChangeSandbox.cs" || f.Key == "PreChangeApply.cs";
                if (!allowed)
                {
                    Assert.False(Regex.IsMatch(code, @"new\s+Transaction\s*\("), f.Key + ": Transaction нээж болохгүй (зөвхөн sandbox, apply)");
                    Assert.False(Regex.IsMatch(code, @"new\s+TransactionGroup\s*\("), f.Key + ": TransactionGroup нээж болохгүй");
                    Assert.False(Regex.IsMatch(code, @"\.Commit\s*\("), f.Key + ": Commit хориотой");
                    Assert.False(code.Contains("MoveElement"), f.Key + ": MoveElement зөвхөн sandbox, apply");
                    Assert.False(Regex.IsMatch(code, @"\.Delete\s*\("), f.Key + ": Delete хориотой");
                }
            }
        }

        [Test]
        public static void Sandbox_AlwaysRollsBackTheGroup_InFinally_AndSuppressesMglObservers()
        {
            string src = CodeOnly(Sources()["PreChangeSandbox.cs"]);
            // `finally` блок дотор үүрлэсэн `}` байдаг тул `[^}]*` ашиглахгүй — ХАМГИЙН СҮҮЛИЙН `finally`-аас хойш RollBack байх ёстой.
            int fin = src.LastIndexOf("finally", StringComparison.Ordinal);
            Assert.True(fin >= 0 && src.IndexOf("tg.RollBack(", fin, StringComparison.Ordinal) > fin, "группийн RollBack нь finally дотор байх ёстой");
            Assert.False(src.Contains("Assimilate"), "sandbox группийг ХЭЗЭЭ Ч assimilate хийхгүй (Undo-д орно)");
            Assert.True(src.Contains("ImpactSimulationScope.Begin"), "MGL-ийн ажиглагчдыг хаах scope");
            Assert.True(src.Contains("DocumentChanged -= onChanged"), "түр DocumentChanged-ээс заавал салгана");
            Assert.True(src.Contains("NotRestored"), "буцаалтыг баталгаажуулдаг");
        }

        [Test]
        public static void Apply_ReadsSettledStateAfterCommit_ThenAssimilatesOrRollsBack_InOneUndo()
        {
            string src = CodeOnly(Sources()["PreChangeApply.cs"]);
            Assert.True(src.Contains("PreChangeStale.Evaluate"), "хуучирсан эсэхийг заавал шалгана");
            Assert.True(src.Contains("PreChangeFreshness.UnknownNotice"), "хурууны хээг уншиж чадаагүй бол fail-closed (Stale)");
            Assert.Eq(1, Regex.Matches(src, @"new\s+TransactionGroup\s*\(").Count, "Apply-д яг нэг TransactionGroup (нэг Undo)");
            Assert.Eq(1, Regex.Matches(src, @"new\s+Transaction\s*\(").Count, "Apply-д яг нэг дотоод Transaction");

            // ДАРААЛАЛ: commit → SETTLED унших → preview-тэй тулгах → Assimilate.
            int commit = src.IndexOf(".Commit(", StringComparison.Ordinal);
            int settled = src.IndexOf("PreChangeCapture.Read(", StringComparison.Ordinal);
            int decide = src.IndexOf("PreChangePostCommitGate.Decide", StringComparison.Ordinal);
            int assim = src.IndexOf(".Assimilate(", StringComparison.Ordinal);
            Assert.True(commit > 0 && settled > commit, "бодит төлвийг commit-ИЙН ДАРАА (settled) уншина");
            Assert.True(decide > settled, "preview-тэй тулгалт settled уншилтын ДАРАА");
            Assert.True(assim > decide, "Assimilate нь тулгалтын ДАРАА л");
            Assert.Eq(1, Regex.Matches(src, @"\.Assimilate\(").Count, "Assimilate ганц газар");
            Assert.True(src.Contains("PostCommitAction.RollBack"), "таарахгүй бол группийг БҮТНЭЭР буцаана");
            Assert.True(src.Contains("tg.RollBack("), "RollBack зам байна");

            // Ажиглагчийг хойшлуулна: transaction-оос ӨМНӨ эхэлж, Assimilate АМЖИЛТТАЙ болсны дараа л нийтэлнэ, буцвал хаяна.
            int begin = src.IndexOf("ObservationDeferral.Begin(", StringComparison.Ordinal);
            int group = src.IndexOf("new TransactionGroup", StringComparison.Ordinal);
            Assert.True(begin > 0 && begin < group, "ажиглалтын хойшлуулалт группээс ӨМНӨ эхэлнэ");
            int publish = src.IndexOf("deferral.Publish()", StringComparison.Ordinal);
            Assert.True(publish > assim, "хуримтлуулсан өөрчлөлтийг Assimilate-ийн ДАРАА л нийтэлнэ");
            Assert.True(src.Contains("deferral.Discard()"), "буцсан бол хойшлуулсныг хаяна");
            Assert.True(src.Contains("deferral.Dispose()"), "ямар ч замд хойшлуулалт цэвэрлэгдэнэ");
        }

        [Test]
        public static void Sandbox_ReadsSettledAfterState_InsideTheOpenGroup_BeforeRollback()
        {
            string src = CodeOnly(Sources()["PreChangeSandbox.cs"]);
            int commit = src.IndexOf("SimulateMove(", src.IndexOf("groupStarted = true", StringComparison.Ordinal), StringComparison.Ordinal);
            int after = src.IndexOf("PreChangeCapture.Read(", StringComparison.Ordinal);
            int rollback = src.LastIndexOf("tg.RollBack(", StringComparison.Ordinal);
            Assert.True(commit > 0 && after > commit && rollback > after, "ДАРАА төлвийг commit-ийн дараа, бүлгийг буцаахаас ӨМНӨ уншина (Apply-тай ИЖИЛ цэг)");
            Assert.False(src.Contains("ModelChangeCounter.Stamp(doc) !="), "stamp-ыг тусад нь жишихгүй — зориулалттай RestoreProbe-оор");
            Assert.False(Regex.IsMatch(src, @"WhereElementIsNotElementType\(\)\.GetElementCount\(\)[^;]*;\s*\r?\n\s*p\.ElementCount") && !src.Contains("if (strict)"),
                "бүх элементийн тоо нь ЗӨВХӨН STRICT оношилгооны горимд");
            Assert.True(src.Contains("if (strict) p.ElementCount"), "элементийн тоо STRICT горимд л");
        }

        [Test]
        public static void MglObservers_SkipSimulation_AndReplayOnlyAfterAssimilate()
        {
            string root = AddinDir();
            foreach (string rel in new[] { "ChangeTracker.cs", @"Smart/Revit/ModelChangeCounter.cs", @"Intelligence/Revit/RevitIntelligenceHost.cs", @"CloneDrawings/CdJobHost.cs" })
            {
                string text = File.ReadAllText(Path.Combine(root, rel.Replace('/', Path.DirectorySeparatorChar)));
                Assert.True(text.Contains("ImpactSimulationScope.Suppressed"), rel + ": sandbox-ийн БА хойшлуулсан (Apply-ийн) үйл явдлыг алгасах ёстой");
                Assert.False(text.Contains("ImpactSimulationScope.IsActive"), rel + ": зөвхөн sandbox-ийг шалгавал Apply-ийн буцсан commit түүхэнд үлдэнэ — `Suppressed` ашиглана");
            }
            // Дахин тоглуулах sink-тэй (Assimilate АМЖИЛТТАЙ болсны дараа л):
            foreach (string rel in new[] { "ChangeTracker.cs", @"Smart/Revit/ModelChangeCounter.cs", @"Intelligence/Revit/RevitIntelligenceHost.cs", @"ChangeImpact/Revit/ImpactCapture.cs" })
            {
                string text = File.ReadAllText(Path.Combine(root, rel.Replace('/', Path.DirectorySeparatorChar)));
                Assert.True(text.Contains("ImpactObservationSinks.Register("), rel + ": баталгаажсан commit-ийг нэг удаа дахин тоглуулах sink бүртгээгүй");
            }
            string impact = File.ReadAllText(Path.Combine(root, "ChangeImpact", "Revit", "ImpactCapture.cs"));
            Assert.True(impact.Contains("_suppress > 0"), "ImpactCapture-ийн Suppress хэвээр");
        }

        [Test]
        public static void Ghost_NeverWritesToTheModel_AndAlwaysUnregisters()
        {
            string src = CodeOnly(Sources()["PreChangeGhost.cs"]);
            foreach (string banned in new[] { "new Transaction", "new TransactionGroup", ".Commit(", "DirectShape", "ElementTransformUtils", "SetElementIds", "Selection.", "Delete(", "Parameter" })
                Assert.False(src.Contains(banned), "сүүдэр загварт/сонголтод хүрэхгүй: «" + banned + "»");
            Assert.True(src.Contains("RemoveServer("), "сервер бүрэн хасагдана");
            Assert.True(src.Contains("DocumentClosing -="), "баримт хаагдах hook-ийг салгана");
            Assert.True(src.Contains("ImpactSimulationScope.Suppressed"), "sandbox/Apply-ийн commit сүүдрийг арилгахгүй");
            string host = File.ReadAllText(Path.Combine(AddinDir(), "Smart", "Revit", "SmartHost.cs"));
            Assert.True(host.Contains("PreChangeGhost.Shutdown()"), "Revit унтрахад сүүдэр цэвэрлэгдэнэ");
        }

        [Test]
        public static void Window_AndCore_DoNotTouchRevitApi_AndWindowNeverCallsApplyWithoutTheGate()
        {
            string root = AddinDir();
            foreach (string f in Directory.GetFiles(Path.Combine(root, "ChangeImpact", "Ui"), "PreChange*.cs"))
            {
                string code = CodeOnly(File.ReadAllText(f));
                Assert.False(code.Contains("Autodesk.Revit"), Path.GetFileName(f) + ": цонх Revit-ийн төрөл мэдэхгүй");
            }
            string win = CodeOnly(File.ReadAllText(Path.Combine(root, "ChangeImpact", "Ui", "PreChangeWindow.cs")));
            Assert.True(win.Contains("Gate.PrimaryEnabled"), "зөөх товч зөвхөн цэвэр Gate-ээр идэвхжинэ");
            Assert.Eq(1, Regex.Matches(win, @"_s\.ApplyAsync\(").Count, "Apply ганц газар");
        }

        [Test]
        public static void DoorSimulation_UsesNoMouseHooksWin32OrReflection_AndNeverDragsTheRealDoor()
        {
            // «Хулганы глобал hook, Win32, reflection БАЙХГҮЙ» — зөвхөн Revit-ийн албан ёсны PickPoint/PickObject + ghost.
            string[] banned = { "DllImport", "SetWindowsHookEx", "user32", "GetAsyncKeyState", "GetCursorPos", "mouse_event", "SendInput", "System.Reflection", "BindingFlags", "GetMethod(", "MakeGenericMethod", "Marshal.GetDelegateForFunctionPointer" };
            string root = AddinDir();
            var files = new List<string>();
            foreach (string sub in new[] { "Core", "Revit", "Ui" })
            {
                files.AddRange(Directory.GetFiles(Path.Combine(root, "ChangeImpact", sub), "Door*.cs"));
                files.AddRange(Directory.GetFiles(Path.Combine(root, "ChangeImpact", sub), "*PreChange*.cs"));
            }
            files.Add(Path.Combine(root, "ChangeImpact", "Core", "GhostScene.cs"));
            files.Add(Path.Combine(root, "ChangeImpact", "Core", "IDoorMoveSession.cs"));
            foreach (string f in files)
            {
                string code = CodeOnly(File.ReadAllText(f));
                foreach (string b in banned)
                    Assert.False(code.Contains(b), Path.GetFileName(f) + ": «" + b + "» — хулганы hook/Win32/reflection хориотой");
            }
            // Бодит хаалгыг simulation-ийн явцад ХЭЗЭЭ Ч хөдөлгөхгүй: MoveElement зөвхөн sandbox, apply (бусад нь Transactions_ExistOnlyInSandboxAndApply-д).
            string session = CodeOnly(File.ReadAllText(Path.Combine(root, "ChangeImpact", "Revit", "RevitPreChangeSession.cs")));
            Assert.False(session.Contains("MoveElement"), "session нь элемент хөдөлгөхгүй");
            Assert.False(session.Contains("new Transaction"), "session транзакц нээхгүй");
        }

        [Test]
        public static void DoorWindow_DoesNotTouchRevitApi_AndAppliesOnlyThroughTheControllerGate()
        {
            string root = AddinDir();
            string win = CodeOnly(File.ReadAllText(Path.Combine(root, "ChangeImpact", "Ui", "DoorMoveWindow.cs")));
            Assert.False(win.Contains("Autodesk.Revit"), "цонх Revit-ийн төрөл мэдэхгүй");
            Assert.True(win.Contains("Gate.PrimaryEnabled"), "зөөх товч зөвхөн цэвэр Gate-ээр идэвхжинэ");
            Assert.True(win.Contains("TryBeginApply("), "Approve нь яг ОДООГИЙН generation-ийн эцсийн дүнг шаардана");
            Assert.Eq(1, Regex.Matches(win, @"_s\.ApplyAsync\(").Count, "Apply ганц газар");
            // Apply-ийн өмнө TryBeginApply, дараа нь ApplyAsync
            Assert.True(win.IndexOf("TryBeginApply(", StringComparison.Ordinal) < win.IndexOf("_s.ApplyAsync(", StringComparison.Ordinal), "TryBeginApply → ApplyAsync дараалал");
            Assert.True(win.Contains("ClearVisual()") && win.Contains("Closed += (s, e) => ShutDown()"), "цонх хаагдахад ghost арилна");
            Assert.True(win.Contains("_c.Close()"), "цонх хаагдахад симуляци хаагдана");
        }

        [Test]
        public static void DoorApply_UsesTheOperationUndoName_AndThePreviewSandboxStillAlwaysRollsBack()
        {
            string root = AddinDir();
            string apply = CodeOnly(File.ReadAllText(Path.Combine(root, "ChangeImpact", "Revit", "PreChangeApply.cs")));
            Assert.True(apply.Contains("PreChangeOperations.UndoName(kind)"), "Undo жагсаалтад «MGL — Хаалга зөөх»");
            Assert.Eq(1, Regex.Matches(apply, @"new\s+TransactionGroup\s*\(").Count, "Apply ганц TransactionGroup");
            Assert.Eq(1, Regex.Matches(apply, @"new\s+Transaction\s*\(").Count, "Apply ганц Transaction");
            string sandbox = CodeOnly(File.ReadAllText(Path.Combine(root, "ChangeImpact", "Revit", "PreChangeSandbox.cs")));
            Assert.False(sandbox.Contains("Assimilate"), "preview ХЭЗЭЭ Ч Undo-д орохгүй");
            Assert.True(sandbox.Contains("tg.RollBack("), "preview ҮРГЭЛЖ буцаана");
        }

        [Test]
        public static void CoreStaysRevitFree()
        {
            string root = AddinDir();
            foreach (string f in Directory.GetFiles(Path.Combine(root, "ChangeImpact", "Core"), "*.cs"))
            {
                string code = CodeOnly(File.ReadAllText(f));
                Assert.False(code.Contains("Autodesk.Revit"), Path.GetFileName(f) + " Revit төрөл оруулсан");
                Assert.False(code.Contains("System.Windows"), Path.GetFileName(f) + " WPF төрөл оруулсан");
            }
        }

        [Test]
        public static void R24_ExcludesChangeImpact_AndSimulationScopeStaysCompilableThere()
        {
            string csproj = File.ReadAllText(Path.Combine(AddinDir(), "RevitMcpAddin.csproj"));
            Assert.True(csproj.Contains("<Compile Remove=\"ChangeImpact/**\" />"), "R24-д ChangeImpact хасагдсан хэвээр");
            string scope = File.ReadAllText(Path.Combine(AddinDir(), "SimulationScope.cs"));
            Assert.True(scope.Contains("#if MGL_SMART"), "ImpactCapture-ийн залгаас #if MGL_SMART-ээр хамгаалагдсан (R24 бүтнэ)");
        }
    }
}
