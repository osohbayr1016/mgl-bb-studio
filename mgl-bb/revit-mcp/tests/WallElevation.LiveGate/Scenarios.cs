using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using Autodesk.Revit.UI;

namespace MglWeGate
{
    /// <summary>Нэг сценарийн тодорхойлолт.  Setup = харагдац/сонголт/тохиргоо/driver скрипт; дараа нь PostCommand → хүлээх → Inspect.</summary>
    internal sealed class Scenario
    {
        public string Id, Title, Category;
        public bool ExpectJob;            // production-ийн арын ажил (дэлгээс үүсгэх) хүлээгдэж байна уу
        public int TimeoutSec = 420;
        public Func<UIApplication, LiveContext, ScenarioResult, ScnState, bool> Setup;
        public Action<UIApplication, LiveContext, ScenarioResult, ScnState> Inspect;
        public bool NoCommand;            // зөвхөн Setup + Inspect (команд дуудахгүй)
        public bool DriverOnly;           // команд дуудахгүй, зөвхөн driver-ийн скрипт (хүний дарсан шиг) — 1.40.0 сонголтын шалгалт
        /// <summary>Setup-аас ӨМНӨХ тусдаа алхам — харагдацыг идэвхжүүлнэ (UIView нь дараагийн алхамд л бэлэн; zoom/дэлгэцийн координат тэнд).</summary>
        public Func<UIApplication, LiveContext, ScenarioResult, ScnState, bool> Activate;
        /// <summary>
        /// W01/W06 (2026-10-16): production-ийн арын ажил ЯВЖ БАЙХ ҮЕД хүн шиг үйлдэл (загвар засах, өөр харагдац руу шилжих).  Хүлээлтийн алхам бүрт
        /// (production-ийн лог дамжуулна) true буцаатал дуудагдана — нэг удаа хийгдэнэ.
        /// </summary>
        public Func<UIApplication, LiveContext, ScenarioResult, ScnState, string, bool> During;
        /// <summary>W09: ribbon-ын «Интерьер» товч (WallElevationInteriorCommand) — өгөгдмөл зориулалт Интерьер.</summary>
        public bool InteriorCommand;
        /// <summary>Өөр production команд (ж: F01 «Санал хүсэлт»); null = «Ханын дэлгээс».</summary>
        public Func<LiveContext, RevitCommandId> CommandOf;
    }

    internal sealed class ScnState
    {
        public readonly List<string> Driver = new List<string>();
        public string Ack, Log, DumpName;
        public long LogOffset;
        public DateTime Posted, PostAt;
        public bool Skip, PostDone, DuringDone;
        public object Data;
        /// <summary>Тестийн Revit-ийн journal — PostCommand-ын татгалзлыг (Revit 2027) илрүүлэхэд; командыг илгээсэн тоо.</summary>
        public string JournalPath;
        public long JournalPos;
        public int Posts;
    }

    internal static class Scenarios
    {
        // Гарчиг (TaskDialog «MGL — Ханын дэлгээс») ЭСВЭЛ WPF preview-ийн доторх бичвэр (UIA нэр хоосон) — хоёуланд таарна.
        private const string T = "Ханын дэлгээс";
        private const string GenerateBtn = "^[0-9]+ дэлгээс|^Хуудсанд байрлуулах";
        internal static readonly string[] DefaultPrefs = { "output=ViewsAndSheets", "scale=50", "updateExisting=1", "reviewPanel=0", "livePreview=0" };

        public static void Enqueue(GateRunner r)
        {
            var L = new LiveContext(r);
            r.Live = L;
            r.Enqueue("scn.discover", app =>
            {
                var res = new ScenarioResult { Id = "ENV", Title = "Тест орчин — суусан add-in, команд", Category = "environment" };
                L.Results.Add(res);
                L.Discover(app, res);
                L.BackupPrefs();
                object v;
                L.Interior = app.ActiveUIDocument.Document.PathName;
                string arch = Path.Combine(r.Job.ModelsDir, "Architecture_Test.rvt");
                L.ArchCopy = Path.Combine(r.Job.ModelsDir, "Architecture_HostRooms_Test.rvt");
                if (File.Exists(arch)) File.Copy(arch, L.ArchCopy, true);
                res.Info("models", "Interior " + L.Interior + " · host-room хуулбар " + L.ArchCopy + (r.Facts.TryGetValue("plan_x", out v) ? " · X план " + v : ""));
                return StepState.Done;
            });

            foreach (Scenario s in All()) Add(r, L, s);

            r.Enqueue("scn.report", app =>
            {
                L.RestorePrefs();
                Report.Write(r, L);
                return StepState.Done;
            });
        }

        // ── Алхмын гинж ────────────────────────────────────────────

        private static void Add(GateRunner r, LiveContext L, Scenario s)
        {
            if (!Selected(r.Job.Scenarios, s.Id)) return;
            ScenarioResult res = null;
            var st = new ScnState();
            DateTime started = DateTime.MinValue;
            if (s.Activate != null)
                r.Enqueue("scn." + s.Id + ".activate", app =>
                {
                    started = DateTime.Now;
                    res = new ScenarioResult { Id = s.Id, Title = s.Title, Category = s.Category };
                    L.Results.Add(res);
                    try { if (!s.Activate(app, L, res, st)) st.Skip = true; }
                    catch (Exception ex) { res.Add("activate", "BLOCKED", ex.GetType().Name + ": " + ex.Message); st.Skip = true; }
                    return StepState.Done;
                });
            r.Enqueue("scn." + s.Id + ".setup", app =>
            {
                if (res == null)
                {
                    started = DateTime.Now;
                    res = new ScenarioResult { Id = s.Id, Title = s.Title, Category = s.Category };
                    L.Results.Add(res);
                }
                if (st.Skip) return StepState.Done;
                if (!s.NoCommand && !s.DriverOnly && s.CommandOf == null && L.Cmd == null) { res.Add("precondition", "BLOCKED", "production «Ханын дэлгээс» команд олдсонгүй"); st.Skip = true; return StepState.Done; }
                if (!s.NoCommand && !s.DriverOnly && s.CommandOf != null && s.CommandOf(L) == null) { res.Add("precondition", "BLOCKED", "production команд ribbon-оос олдсонгүй"); st.Skip = true; return StepState.Done; }
                if (s.InteriorCommand && L.CmdInterior == null) { res.Add("precondition", "BLOCKED", "production «Ханын дэлгээс (Интерьер)» команд ribbon-оос олдсонгүй"); st.Skip = true; return StepState.Done; }
                bool ok;
                try { ok = s.Setup(app, L, res, st); }
                catch (Exception ex) { res.Add("setup", "BLOCKED", ex.GetType().Name + ": " + ex.Message); GateLog.Error("setup " + s.Id, ex); ok = false; }
                if (!ok) { st.Skip = true; return StepState.Done; }
                if (s.NoCommand) return StepState.Done;
                st.LogOffset = L.LogLength();
                L.StartRecording();
                st.Ack = L.Drive(st.Driver);
                // ХЭМЖСЭН (journal 0752/0756): Setup сонголтыг өөрчилсөн (өмнөх сценарийн room tag-ийг цэвэрлэсэн) ИЖИЛ ExternalEvent-д
                // PostCommand хийвэл Revit контекст табаа (Modify | Room Tags → Modify) idle дээр шинэчлэх хооронд «API queue command …
                // cannot be invoked in this context» гэж командыг ХАЯДАГ.  Тиймээс командыг дараагийн алхамд, 0.8 с дараа илгээнэ.
                st.PostDone = s.DriverOnly;
                st.PostAt = DateTime.Now.AddMilliseconds(800);
                st.Posted = DateTime.Now;
                return StepState.Done;
            });
            r.Enqueue("scn." + s.Id + ".wait", app =>
            {
                if (st.Skip || s.NoCommand) return StepState.Done;
                if (!st.PostDone)
                {
                    if (DateTime.Now < st.PostAt) return StepState.Wait;
                    JournalMark(app, st);
                    app.PostCommand(s.CommandOf != null ? s.CommandOf(L) : s.InteriorCommand ? L.CmdInterior : L.Cmd);
                    st.PostDone = true;
                    st.Posts++;
                    st.Posted = DateTime.Now;
                    return StepState.Wait;
                }
                // ХЭМЖСЭН (2027, 2026-10-16, GEN-EXTRA-101): Revit илгээсэн командыг «API queue command … cannot be invoked in this context»
                // гэж journal-д бичээд ХАЯСАН — 0.8 с хүлээлт хангалтгүй; driver 120 с цонх хүлээгээд сценари FAIL болсон.  Татгалзсан бол
                // 1.5 с-ийн дараа дахин илгээнэ (≤ 3 удаа) — хэрэглэгч товчийг дахин дарахтай адил, загварт юу ч болоогүй.
                if (st.Posts > 0 && st.Posts < 4 && !s.DriverOnly && (DateTime.Now - st.Posted).TotalSeconds < 20 && PostRejected(st))
                {
                    res.Info("post.retry." + st.Posts, "Revit командыг хүлээж аваагүй (journal: «cannot be invoked in this context») — дахин илгээнэ");
                    GateLog.Info(s.Id + ": PostCommand татгалзсан — дахин илгээнэ (" + st.Posts + ")");
                    st.PostDone = false;
                    st.PostAt = DateTime.Now.AddMilliseconds(1500);
                    return StepState.Wait;
                }
                string ack = LiveContext.AckState(st.Ack);
                string log = L.LogSince(st.LogOffset);
                if (s.During != null && !st.DuringDone)
                {
                    try { st.DuringDone = s.During(app, L, res, st, log); }
                    catch (Exception ex) { res.Add("during", "BLOCKED", ex.GetType().Name + ": " + ex.Message); GateLog.Error("during " + s.Id, ex); st.DuringDone = true; }
                    if (!st.DuringDone)
                    {
                        if ((DateTime.Now - st.Posted).TotalSeconds <= s.TimeoutSec) return StepState.Wait;
                        res.Add("during", "FAIL", "арын ажлын эхлэл («эхэллээ») " + s.TimeoutSec + " с-д логт гарсангүй (driver ack: " + (ack ?? "алга") + ")");
                        st.DuringDone = true;
                    }
                    log = L.LogSince(st.LogOffset);
                }
                double since = (DateTime.Now - st.Posted).TotalSeconds;
                bool jobDone = log.Contains("арын ажил #") || log.Contains("ERROR [job]") || log.Contains("ERROR [run]");
                if (s.ExpectJob)
                {
                    if (jobDone && ack != null) { st.Log = log; return StepState.Done; }
                    if (ack != null && L.LastChange != DateTime.MinValue && (DateTime.Now - L.LastChange).TotalSeconds > 25) { st.Log = log; return StepState.Done; }
                    if (ack == "fail" && L.LastChange == DateTime.MinValue && since > 45) { st.Log = log; return StepState.Done; }
                }
                else if (ack != null && since > 3) { st.Log = log; return StepState.Done; }
                if (since > s.TimeoutSec)
                {
                    st.Log = log;
                    res.Add("timeout", "FAIL", "хүлээлт " + s.TimeoutSec + " с хэтэрлээ (driver ack: " + (ack ?? "алга") + ")");
                    return StepState.Done;
                }
                return StepState.Wait;
            }, 30);
            r.Enqueue("scn." + s.Id + ".inspect", app =>
            {
                L.Recording = false;
                if (!st.Skip)
                {
                    if (!s.NoCommand)
                    {
                        string ackText = st.Ack != null && File.Exists(st.Ack) ? File.ReadAllText(st.Ack, Encoding.UTF8).Trim() : "(ack алга)";
                        res.Info("driver", ackText.Replace(Environment.NewLine, " ⏎ "));
                        if (!string.IsNullOrEmpty(st.Log)) res.Info("product.log", Trim(st.Log, 700));
                        if (st.Log != null && Regex.IsMatch(st.Log, "ERROR \\[(job|run|create|sheet|anno)"))
                            res.Add("product.errors", "FAIL", "production лог ERROR: " + Trim(Regex.Match(st.Log, "ERROR \\[[^\\n]*").Value, 300));
                        if (LicenseOrForeignWindow(L, out string why)) res.Add("environment", "BLOCKED", why);
                    }
                    try { s.Inspect(app, L, res, st); }
                    catch (Exception ex) { res.Add("inspect", "FAIL", ex.GetType().Name + ": " + ex.Message); GateLog.Error("inspect " + s.Id, ex); }
                }
                // Хүний оролт тестийн Revit-д орсон бол (driver journal-аас) — дүн найдваргүй: FAIL биш BLOCKED.  Дугуй (томруулалт) зөвхөн
                // дэлгэцийн координатаар дарах сценарид нөлөөтэй.
                List<string> hits = Interference(L, started).Where(h => s.Category == "selection" || h.IndexOf("Jrn.Wheel", StringComparison.Ordinal) < 0).ToList();
                if (hits.Count > 0) res.Add("environment.interference", "BLOCKED", "тестийн Revit-д хүний гар/хулганы оролт орсон (" + hits.Count + "): " + Trim(string.Join(" ; ", hits), 300));
                res.Seconds = (DateTime.Now - started).TotalSeconds;
                GateLog.Info("◆ " + s.Id + " → " + res.Status + " (" + U.F(res.Seconds) + " с)");
                return StepState.Done;
            });
        }

        /// <summary>Командыг илгээхийн ӨМНӨ journal-ын урт — татгалзлыг зөвхөн шинэ мөрөөс хайна.</summary>
        private static void JournalMark(UIApplication app, ScnState st)
        {
            try
            {
                st.JournalPath = app.Application.RecordingJournalFilename;
                st.JournalPos = 0;
                if (string.IsNullOrEmpty(st.JournalPath) || !File.Exists(st.JournalPath)) return;
                using (var fs = new FileStream(st.JournalPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete)) st.JournalPos = fs.Length;
            }
            catch { st.JournalPath = null; }
        }

        /// <summary>Илгээснээс хойш journal-д манай командын «cannot be invoked in this context» гарсан уу (уншсан хэсгийг дахин уншихгүй).</summary>
        private static bool PostRejected(ScnState st)
        {
            if (string.IsNullOrEmpty(st.JournalPath)) return false;
            try
            {
                string text;
                using (var fs = new FileStream(st.JournalPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                {
                    if (fs.Length <= st.JournalPos) return false;
                    fs.Seek(st.JournalPos, SeekOrigin.Begin);
                    var buf = new byte[fs.Length - st.JournalPos];
                    int got = 0, r;
                    while (got < buf.Length && (r = fs.Read(buf, got, buf.Length - got)) > 0) got += r;
                    int end = Array.LastIndexOf(buf, (byte)'\n', Math.Max(0, got - 1));
                    if (end < 0) return false;
                    text = Encoding.UTF8.GetString(buf, 0, end + 1);
                    st.JournalPos += end + 1;
                }
                foreach (string line in text.Split('\n'))
                    if (line.IndexOf("cannot be invoked in this context", StringComparison.Ordinal) >= 0 && line.IndexOf("MglWallElevations", StringComparison.Ordinal) >= 0)
                        return true;
            }
            catch { }
            return false;
        }

        private static List<string> Interference(LiveContext L, DateTime since)
        {
            var list = new List<string>();
            string p = Path.Combine(L.DriverDir, "interference.log");
            if (!File.Exists(p) || since == DateTime.MinValue) return list;
            foreach (string line in File.ReadAllLines(p, Encoding.UTF8))
            {
                DateTime t;
                if (line.Length < 12 || !DateTime.TryParseExact(line.Substring(0, 12), "HH:mm:ss.fff", CultureInfo.InvariantCulture, DateTimeStyles.None, out t)) continue;
                t = since.Date + t.TimeOfDay;
                if (t >= since.AddSeconds(-2)) list.Add(line);
            }
            return list;
        }

        /// <summary>
        /// V04: бүх төлөвлөгдсөн сценарийн ID (шүүлтүүрээс үл хамаарна; ENV нь discover алхам).  Тайланд бичигдэж, gate нь
        /// үр дүнгүй үлдсэн сценарийг (дундаас унасан ажиллуулалт) барина.  Scenario-г үүсгэх нь цэвэр — lambda л хадгална.
        /// </summary>
        internal static List<string> PlannedIds()
        {
            var ids = new List<string> { "ENV" };
            foreach (Scenario s in All()) ids.Add(s.Id);
            return ids;
        }

        private static bool Selected(string filter, string id)
        {
            if (string.IsNullOrEmpty(filter) || filter == "*") return true;
            return filter.Split(',').Any(f => f.Trim().EndsWith("*") ? id.StartsWith(f.Trim().TrimEnd('*'), StringComparison.OrdinalIgnoreCase)
                                                                    : string.Equals(f.Trim(), id, StringComparison.OrdinalIgnoreCase));
        }

        private static bool LicenseOrForeignWindow(LiveContext L, out string why)
        {
            why = null;
            string log = Path.Combine(L.DriverDir, "driver.log");
            if (!File.Exists(log)) return false;
            string t = File.ReadAllText(log, Encoding.UTF8);
            Match m = Regex.Match(t, "window «([^»]*(нэвтр|License|Лиценз|Sign in)[^»]*)»", RegexOptions.IgnoreCase);
            if (!m.Success) return false;
            why = "MGL лицензийн/нэвтрэх цонх гарсан («" + m.Groups[1].Value + "») — тестийн PC дээр add-in-д нэвтэрнэ үү";
            return true;
        }

        public static string Trim(string s, int n) { s = (s ?? "").Replace("\r", "").Replace("\n", " ⏎ "); return s.Length > n ? s.Substring(0, n) + "…" : s; }

        // ── Туслах setup ───────────────────────────────────────────

        internal static Document Doc(UIApplication app) { return app.ActiveUIDocument.Document; }

        private static View ViewNamed(Document doc, string name)
        {
            return new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>().FirstOrDefault(v => !v.IsTemplate && v.Name == name);
        }

        internal static bool Activate(UIApplication app, View v, ScenarioResult res)
        {
            if (v == null) { res.Add("setup.view", "BLOCKED", "харагдац олдсонгүй"); return false; }
            UIDocument uidoc = app.ActiveUIDocument;
            if (uidoc.ActiveView.Id != v.Id) uidoc.ActiveView = v;
            return true;
        }

        internal static string[] GenerateScript(string id)
        {
            return new[]
            {
                "wait \"" + T + "\" 120",
                "dump \"" + T + "\" preview-" + id,
                "invoke \"" + T + "\" \"" + GenerateBtn + "\" 20",
                "gone \"" + T + "\" 30",
                "finally dismiss \"" + T + "\" 3",
            };
        }

        /// <summary>Тухайн өрөөний tag-ийг урьдчилан сонгоод (хэрэглэгч планд tag дарсантай ижил) дэлгээс үүсгэх.</summary>
        internal static Scenario Generate(string id, string title, string link, string room, ExpectedViews exp, string category = "generation")
        {
            return new Scenario
            {
                Id = id, Title = title, Category = category, ExpectJob = true,
                Setup = (app, L, res, st) =>
                {
                    Document doc = Doc(app);
                    Geo.LinkedRoom lr = Geo.FindRoom(doc, link, room);
                    if (lr == null) { res.Add("setup.room", "BLOCKED", link + "/" + room + " өрөө олдсонгүй"); return false; }
                    var plan = doc.GetElement(new ElementId(Convert.ToInt64(L.R.Facts["plan_l1"]))) as ViewPlan;
                    if (!Activate(app, plan, res)) return false;
                    RoomTag tag = Geo.TagOf(doc, plan, lr);
                    if (tag == null) { res.Add("setup.tag", "BLOCKED", room + "-ийн tag планд алга"); return false; }
                    app.ActiveUIDocument.Selection.SetElementIds(new List<ElementId> { tag.Id });
                    L.WritePrefs(DefaultPrefs);
                    st.Driver.AddRange(GenerateScript(id));
                    st.Data = lr;
                    return true;
                },
                Inspect = (app, L, res, st) => Inspector.Generation(app, L, res, st, (Geo.LinkedRoom)st.Data, exp),
            };
        }

        internal sealed class ExpectedViews
        {
            public int Min, Max;
            public bool CheckUpper = true;
            /// <summary>Өрөөний бүх нүх/тавилга шинэ дэлгээсүүдийн аль нэгэнд — бүтэн өрөө үүсгэхэд л (нэмэлт тал зөвхөн хэсгийг харуулна).</summary>
            public bool CoverRoom = true;
            public string[] Notes = new string[0];
        }

        // ── Сценариуд ──────────────────────────────────────────────

        private static IEnumerable<Scenario> All()
        {
            // Үүсгэх — link доторх өрөөнүүд (Interior_Test: host-д өрөө 0)
            yield return Generate("GEN-LINK-101", "Link-ийн тэгш өнцөгт өрөө 101 (tag сонгож) → дэлгээс + хуудас", "Architecture_Test", "101", new ExpectedViews { Min = 4, Max = 4 }, "linked-room");
            // 3-р тойрог (2026-10-14): бүдэг давхарга PDF-д (вектор/raster) — пикселийг gate-ийн ДАРАА PyMuPDF-ээр хэмжинэ.
            yield return Round3Checks.PdfExport("PDF-FADE-101", "101");
            // F01–F02 (2026-10-16): «Санал хүсэлт» цонх ribbon-оос, оношилгоонд энэ Revit-ийн он + ачаалагдсан DLL-ийн SHA-256 (хэзээ ч илгээхгүй).
            yield return FeedbackScenarios.FeedbackOpen("FEEDBACK-OPEN-101", "«Санал хүсэлт» цонх ribbon-оос нээгдэж, оношилгоо энэ Revit/DLL-ийг зөв харуулна (илгээхгүй)");
            yield return Rerun("RERUN-101", "101-ийг дахин ажиллуулахад давхардал үүсэхгүй", "Architecture_Test", "101");
            yield return EditProtect("EDIT-PROTECT-101", "Дизайнерын засвар (нэр, шугам, бичвэр, viewport) дахин ажиллуулахад хадгалагдана", "Architecture_Test", "101");
            // «+ Хана нэмэх» (2026-10-14, интерьерийн баг): цонх дотроос шинэ үсэг (E) — план руу шилжихгүй; дахин ажиллуулахад санагдах.
            yield return GenerateExtra("GEN-EXTRA-101", "«+ Хана нэмэх»: цонх хэвээр E гарч → «⇅ Эсрэг» → зөвхөн E үүснэ, A–D хөдлөхгүй", "Architecture_Test", "101");
            yield return RerunExtra("RERUN-EXTRA-101", "Нэмэлт E дахин ажиллуулахад санагдана (давхардалгүй)", "Architecture_Test", "101");
            yield return PreviewExtra("PREVIEW-EXTRA-101", "«+ Хана нэмэх» дармагц шинэ нэмэлт талын урьдчилсан зураг Revit-ээр гарч, «Болих» — загварт юу ч үлдэхгүй", "Architecture_Test", "101");
            // Хэмжилт (WE-BUG-001-ийн засварын сонголт) — загварыг буцаана.
            yield return Diagnostics.CropAtLevel("DIAG-CROP-AT-LEVEL-101", "Architecture_Test", "101");
            // 3-р тойрог (2026-10-14): spot-ын толин дүрс, бүдэгрүүлэх давхарга, бөөрөнхий улаан хүрээ — хэмжилт (буцаана).
            yield return Diagnostics2.SpotFadeFrame("DIAG-SPOT-FADE-FRAME");
            // 1.40.0 (интерьерийн баг: «үүсгэсэн нэр, шошгыг сонгож зөөж болохгүй»): хүний дарсан шиг дарж сонгогдох эсэх.
            yield return LivePreview("PREVIEW-101", "Цонхны доод талын урьдчилсан зураг Revit-ээр гарч, загварт юу ч үлдэхгүй", "Architecture_Test", "101");
            yield return SelectGenerated("SEL-ANNO-ELEV-101", "Дэлгээс дээрх хэрэгслийн тэмдэглэгээ (шошго/хэмжээс/бичвэр) дарахад сонгогдоно", "101", "elev");
            yield return SelectGenerated("SEL-TAG-KEYPLAN-101", "Түлхүүр план дээрх өрөөний шошго дарахад сонгогдоно", "101", "keyplan");
            yield return SelectGenerated("SEL-TITLE-SHEET-101", "Хуудсан дээрх түлхүүр планы гарчиг дарахад viewport сонгогдоно (гарчгийг зөөх)", "101", "sheet");
            yield return GenerateWithOfficePlans("GEN-HIDE-102", "L хэлбэрийн өрөө 102 — шинэ тэмдэг оффисын ХУУДСАН дээрх планд нуугдана, ажлын планд үлдэнэ (1.40.0)", "Architecture_Test", "102", new ExpectedViews { Min = 6, Max = 6 });
            // Үүсээгүй өрөө (103) — урьдчилсан зураг ШИНЭ дэлгээсийг жинхэнэ үүсгэх замаар гаргаад буцаана (101 нь Keep — шууд экспорт).
            yield return LivePreview("PREVIEW-NEW-103", "Үүсээгүй өрөөний урьдчилсан зураг — түр үүсгэж буцаана, загварт юу ч үлдэхгүй", "Architecture_Test", "103");
            yield return Generate("GEN-LINK-103", "Олон жижиг сегменттэй өрөө 103 (шат, пилястр)", "Architecture_Test", "103", new ExpectedViews { Min = 5, Max = 5 }, "geometry");   // 4 үндсэн + хонхрын ар (2000).  Пилястрын (400) ба хонхрын (300) хажуу нүүр — 1 м-ээс богино булангийн хэсэг, 1.40.0-аас дэлгээсгүй (эзний шийдвэр 2026-10-14)
            yield return GenerateTypeDesignator("GEN-LINK-104", "30° эргэсэн өрөө 104 + цонхноос «* Type Designator» = ID (3-р тойрог)", "Architecture_Test", "104", new ExpectedViews { Min = 4, Max = 4 });
            yield return Generate("GEN-LINKB-B101", "30° эргүүлж шилжүүлсэн өөр link (B) доторх өрөө B101", "Architecture_B_Test.rvt : 2", "B101", new ExpectedViews { Min = 4, Max = 4, CheckUpper = false }, "linked-room");
            // W09 (2026-10-16): «Интерьер» товч → өрөө тус бүрийн зориулалт харагдац дээр хадгалагдаж, дараагийн ажиллуулалт (энгийн товч) түүнийг ашиглана.
            yield return FeedbackScenarios.PresetInterior("PRESET-INT-B102", "«Интерьер» товчоор B102 → дэлгээс бүрт зориулалт «interior» хадгалагдана (W09)", "Architecture_B_Test.rvt : 2", "B102");
            yield return FeedbackScenarios.PresetKeep("PRESET-KEEP-B102", "Энгийн товчоор дахин (ерөнхий тэмдэглэгээ өөр) — B102 өөрийн «interior» зориулалтаар, юу ч өөрчлөгдөхгүй (W09)", "Architecture_B_Test.rvt : 2", "B102");
            yield return Generate("GEN-OVERLAP-105", "Өөр link-ийн өрөөтэй давхцсан 105 — зөв өрөө", "Architecture_Test", "105", new ExpectedViews { Min = 4, Max = 4, CheckUpper = false }, "linked-room");
            // W07 (2026-10-16): харагдац дээр хадгалсан босоо хүрээ (0 … 1500 мм) дахин ажиллуулахад сэргэнэ, «хэсэгчилсэн» нь алдаа биш.
            yield return FeedbackScenarios.CropStored("CROP-STORED-105", "Хадгалсан босоо хүрээ (0…1500 мм) дахин ажиллуулахад тэр дэлгээсэнд хэрэгжиж, бусад нь хөдлөхгүй (W07)", "Architecture_Test", "105");
            // W08 (2026-10-16): 201A (L2) — тэгш тааз + налуу тааз, суурь шал + тавцан (host загварт) — бодит нүүрээр spot, налуу нь гинжид биш.
            yield return FeedbackScenarios.Surfaces("SURF-LINK-201A", "201A: хоёр тааз (тэгш 2700 + налуу 2400→2807), тавцан +150 — spot бүр өөрийн нүүр дээр, налуу нь босоо гинжид биш (W08)", "Architecture_Test", "201A");
            // Сонголт — бодит дарах (driver)
            yield return Hover("HOVER-101", "Хэрэгслээ сонгоод курсорыг өрөөнд ойртуулахад тэр өрөө бүтэн хилээрээ тодорно (1.40.0)", "plan_l1", "101");
            yield return Click("SEL-TAG-102", "Планд өрөөний TAG дээр дарж сонгох (102)", "plan_l1", "102", "tag", null);
            yield return Click("SEL-EMPTY-101", "Өрөөний ХООСОН хэсэг дээр дарж сонгох (101, link)", "plan_l1", "101", "empty", "WE-BUG-002");
            yield return Click("SEL-X-101", "Өрөөний Reference (X) дээр дарж сонгох (101, link)", "plan_x", "101", "x", "WE-BUG-002");
            yield return SheetClick("SHEET-EMPTY-101", "Sheet дээр (viewport идэвхжүүлээгүй) өрөөн доторх дарах (101)", "WE-BUG-003");
            // Сөрөг
            yield return Unloaded("NEG-UNLOADED-B101", "Ачаалаагүй link-ийн өрөөний tag → тайлбартай мессеж, загвар өөрчлөгдөхгүй");
            yield return MissingTemplate("NEG-TEMPLATE-107", "Байхгүй view template тохиргоонд → унахгүй, тайлбартай");
            // Link-ийг устгаад ижил байрлалд дахин холбох (1.40.0) — Architecture_Test-ийн tag-ууд устдаг тул interior сценариудын ТӨГСГӨЛД.
            yield return Relink("RELINK-101", "Link-ийг устгаад дахин холбоход 101-ийг өрөөгөөр нь таньж давхардал үүсгэхгүй (1.40.0)", "Architecture_Test", "101");
            // Host өрөө (архитектурын файл)
            yield return OpenArchCopy();
            yield return GenerateHost("GEN-HOST-101", "Host өрөө 101 (Upper Limit = L2) → дэлгээс; дээд давхрын хана/шал орохгүй");
            yield return Click("SEL-HOST-EMPTY-101", "Host өрөөний хоосон хэсэг дээр дарах (101)", "host_l1", "101", "empty", "WE-BUG-002");
            // W01 (2026-10-16): ажил явж байх үед өрөөний хана зөөгдвөл хуучирсан геометрээр дуусгахгүй — дахин төлөвлөж давхардалгүй.
            yield return FeedbackScenarios.ReplanHost("REPLAN-HOST-102", "Ажил явж байх үед 102-ийн хана 300 мм зөөгдөв → дахин төлөвлөж, шинэ геометрээр, давхардалгүй (W01)", "102");
            // W06 (2026-10-16): хэрэглэгч өөр зураг руу шилжсэн бол дууссаны дараа цонх нээхгүй, харагдац солихгүй.
            yield return FeedbackScenarios.NoFocusSteal("FOCUS-HOST-103", "Ажил явж байх үед хэрэглэгч L2 план руу шилжсэн → дуусахад цонх, харагдац хөндөгдөхгүй (W06)", "103");
        }

        /// <summary>
        /// 3-р тойрог (2026-10-14): хуудасны ангилалд «* Type Designator» параметр нэмээд (gate-ийн түр shared parameter) цонхны «Type Designator»
        /// жагсаалтад UIA ValuePattern-аар «ID» бичнэ (гар/хулгана оролдохгүй) → үүссэн хуудас бүр «ID»-тай.
        /// </summary>
        private static Scenario GenerateTypeDesignator(string id, string title, string link, string room, ExpectedViews exp)
        {
            Scenario g = Generate(id, title, link, room, exp, "generation");
            Func<UIApplication, LiveContext, ScenarioResult, ScnState, bool> inner = g.Setup;
            g.Setup = (app, L, res, st) =>
            {
                if (!Round3Checks.EnsureTypeDesignator(app, L, res)) return false;
                Geo.LinkedRoom lr0 = Geo.FindRoom(Doc(app), link, room);
                if (lr0 == null || !Round3Checks.AddFloorUnder(app, L, lr0, res)) return false;
                bool ok = inner(app, L, res, st);
                if (!ok) return false;
                st.Driver.Clear();
                st.Driver.AddRange(new[]
                {
                    "wait \"" + T + "\" 120",
                    "setvalue \"" + T + "\" \"^Type Designator$\" \"ID\" 20",
                    "dump \"" + T + "\" preview-" + id,
                    "invoke \"" + T + "\" \"" + GenerateBtn + "\" 20",
                    "gone \"" + T + "\" 30",
                    "finally dismiss \"" + T + "\" 3",
                });
                return true;
            };
            Action<UIApplication, LiveContext, ScenarioResult, ScnState> inspect = g.Inspect;
            g.Inspect = (app, L, res, st) =>
            {
                inspect(app, L, res, st);
                Document doc = Doc(app);
                List<ViewSheet> sheets = L.Added.Select(x => doc.GetElement(new ElementId(x)) as ViewSheet).Where(s => s != null && s.IsValidObject).ToList();
                Round3Checks.CheckTypeDesignator(doc, sheets, "ID", res);
                // Шал нэмсэн тул дэлгээс бүрт шалны spot (толин) — r3.spot_mirrored дотор тоологдсон; энд тоо нь дэлгээсийн тоотой тэнцүү эсэх.
                List<View> vs = Inspector.NewElevations(doc, L);
                int leaderSpots = vs.Sum(v => new FilteredElementCollector(doc).OfClass(typeof(SpotDimension)).Cast<SpotDimension>()
                    .Count(sd => sd.OwnerViewId == v.Id && LeaderLeft(sd, v)));
                res.Expect(vs.Count > 0 && leaderSpots >= vs.Count, "r3.floor_spots", "шалны (leader-тэй) spot " + leaderSpots + " / дэлгээс " + vs.Count);
            };
            return g;
        }

        /// <summary>
        /// «+ Хана нэмэх» (2026-10-14, ЦОНХ ДОТРООС): 101-ийн (A–D аль хэдийн үүссэн) tag-ийг сонгоод команд → цонхонд «+ Хана нэмэх» (UIA) →
        /// цонх ХЭВЭЭР, шинэ E мөр сонгогдоно → «⇅ Эсрэг» (UIA) → «Үүсгэх».  Хулгана ашиглахгүй — хэрэглэгчийн дэлгэцэд хүрэхгүй.
        /// </summary>
        private static Scenario GenerateExtra(string id, string title, string link, string room)
        {
            // Нэмэлт тал зөвхөн өрөөний НЭГ хэсгийг (шугамын урт) харуулна — өрөөний бүх нүх/тавилга A–D-д (GEN-LINK-101-д шалгагдсан).
            var exp = new ExpectedViews { Min = 1, Max = 1, CoverRoom = false };
            Scenario g = Generate(id, title, link, room, exp, "generation");
            g.TimeoutSec = 300;
            Func<UIApplication, LiveContext, ScenarioResult, ScnState, bool> inner = g.Setup;
            g.Setup = (app, L, res, st) =>
            {
                if (!inner(app, L, res, st)) return false;
                var lr = (Geo.LinkedRoom)st.Data;
                List<long> before = ExtraSideChecks.RoomViewIds(Doc(app), lr.Room);
                if (before.Count < 4) { res.Add("setup.sides", "BLOCKED", room + "-ийн A–D дэлгээс алга (" + before.Count + ") — GEN-LINK-" + room + " эхэлж"); return false; }
                st.Driver.Clear();
                st.Driver.AddRange(new[]
                {
                    "wait \"" + T + "\" 120",
                    "dump \"" + T + "\" first-" + id,
                    "invoke \"" + T + "\" \"^Хана нэмэх\" 20",
                    "sleep 1500",
                    "dump \"" + T + "\" added-" + id,
                    "invoke \"" + T + "\" \"Эсрэг$\" 20",
                    "sleep 1500",
                    "dump \"" + T + "\" preview-" + id,
                    "invoke \"" + T + "\" \"" + GenerateBtn + "\" 20",
                    "gone \"" + T + "\" 30",
                    "finally dismiss \"" + T + "\" 3",
                });
                st.Data = new object[] { lr, before };
                return true;
            };
            g.Inspect = (app, L, res, st) =>
            {
                var lr = (Geo.LinkedRoom)((object[])st.Data)[0];
                // Ердийн шалгалт (харагч өрөөн дотор, гүнд хана, масштаб, нэр …) ЗӨВХӨН шинэ E-д.  Generation нь L.Generated/GeneratedSheets[101]-ийг
                // ШИНЭЭР үүссэнээр солидог — A–D (эхэнд, тэмдэглэгээ сонгох сценари [0]-ийг ашиглана) + E, хуудсыг НЭГТГЭНЭ (дахин ажиллуулахын
                // snapshot E-ийн тэмдэглэгээ, түлхүүр планыг «хэрэгслийнх» гэж тооцно).
                List<long> keep, keepSheets;
                bool had = L.Generated.TryGetValue(lr.Number, out keep), hadSheets = L.GeneratedSheets.TryGetValue(lr.Number, out keepSheets);
                Inspector.Generation(app, L, res, st, lr, exp);
                if (had) L.Generated[lr.Number] = keep.Concat(L.Generated[lr.Number]).Distinct().ToList();
                if (hadSheets) L.GeneratedSheets[lr.Number] = keepSheets.Concat(L.GeneratedSheets[lr.Number]).Distinct().ToList();
                ExtraSideChecks.Inspect(app, L, res, st, id);
                Document d = app.ActiveUIDocument.Document;
                List<View> fresh = Inspector.NewElevations(d, L);
                var ids = new HashSet<long>(fresh.Select(v => v.Id.Value));
                List<ViewSheet> sheets = new FilteredElementCollector(d).OfClass(typeof(Viewport)).Cast<Viewport>()
                    .Where(vp => ids.Contains(vp.ViewId.Value)).Select(vp => d.GetElement(vp.SheetId) as ViewSheet)
                    .Where(s => s != null).GroupBy(s => s.Id.Value).Select(x => x.First()).ToList();
                // Тод/бүдэг, хүрээ, толин spot — нэмэлт дэлгээсэд ч (өрөөний тал шиг).
                if (fresh.Count > 0) Round3Checks.Run(d, L, fresh, sheets, lr, res, false);
            };
            return g;
        }

        /// <summary>
        /// Урьдчилсан зураг + «+ Хана нэмэх» (2026-10-14): цонхны эхний зураг гарсны ДАРАА «+ Хана нэмэх» (UIA) → шинэ нэмэлт тал сонгогдож түүний
        /// зураг Revit-ээр (түр үүсгээд буцаана) гарна → «Болих».  Загварт шинэ харагдац үлдэхгүй, тохиргоо (нэмэлт тал) хадгалагдахгүй.
        /// </summary>
        private static Scenario PreviewExtra(string id, string title, string link, string room)
        {
            Scenario p = LivePreview(id, title, link, room);
            Func<UIApplication, LiveContext, ScenarioResult, ScnState, bool> inner = p.Setup;
            p.Setup = (app, L, res, st) =>
            {
                if (!inner(app, L, res, st)) return false;
                st.Driver.Clear();
                st.Driver.AddRange(new[]
                {
                    "wait \"" + T + "\" 120",
                    "waitname \"" + T + "\" \"^Урьдчилсан зураг бэлэн\" 90",
                    "invoke \"" + T + "\" \"^Хана нэмэх\" 20",
                    // Шинэ мөр (E эсвэл түүнээс хойших үсэг) сонгогдож ТҮҮНИЙ зураг — өмнөх (A …) зураг биш.
                    "waitname \"" + T + "\" \"^Урьдчилсан зураг бэлэн: [E-Z] \" 120",
                    "dump \"" + T + "\" preview-" + id,
                    "finally dismiss \"" + T + "\" 5",
                });
                return true;
            };
            Action<UIApplication, LiveContext, ScenarioResult, ScnState> inspect = p.Inspect;
            p.Inspect = (app, L, res, st) =>
            {
                inspect(app, L, res, st);
                string dump = Inspector.ReadDump(L, "preview-" + id) ?? string.Empty;
                System.Text.RegularExpressions.Match m = System.Text.RegularExpressions.Regex.Match(dump, @"Урьдчилсан зураг бэлэн: [E-Z] [^
]*");
                res.Expect(m.Success, "preview.extra_side", m.Success ? Trim(m.Value, 160) : "нэмэлт талын зураг гарсангүй");
            };
            return p;
        }

        /// <summary>Нэмэлт дэлгээстэй өрөөг дахин ажиллуулах — шинэ дэлгээс 0, цонхонд E «нэмэлт» мөр «өөрчлөлтгүй» (харагдац дээрх шугамаас).</summary>
        private static Scenario RerunExtra(string id, string title, string link, string room)
        {
            Scenario r = Rerun(id, title, link, room);
            Action<UIApplication, LiveContext, ScenarioResult, ScnState> inspect = r.Inspect;
            r.Inspect = (app, L, res, st) =>
            {
                inspect(app, L, res, st);
                string dump = Inspector.ReadDump(L, "preview-" + id) ?? string.Empty;
                System.Text.RegularExpressions.Match m = System.Text.RegularExpressions.Regex.Match(dump, @"[^\r\n]*нэмэлт[^\r\n]*");
                res.Expect(m.Success, "extra.remembered", m.Success ? "цонхонд нэмэлт мөр: " + Trim(m.Value.Trim(), 160) : "нэмэлт мөр алга — өмнө үүссэн E санагдсангүй");
            };
            return r;
        }

        /// <summary>Spot-ын leader-ийн төгсгөл crop-ын зүүн талаас гадна (шал/таазны spot).</summary>
        private static bool LeaderLeft(SpotDimension sd, View v)
        {
            try
            {
                double cx0 = Geo.CropCorners(v).Min(p => p.DotProduct(v.RightDirection));
                return sd.LeaderEndPosition.DotProduct(v.RightDirection) < cx0 - 1e-6;
            }
            catch { return false; }
        }

        /// <summary>
        /// 1.40.0: үүсгэхээс ӨМНӨ оффисын хуудсан дээрх план (L1-ийн бүтэн план, хуудсанд) ба ажлын план (хуудсанд БИШ) үүсгэнэ;
        /// үүсгэсний дараа шинэ дэлгээсийн маркер оффисын планд нуугдсан, ажлын планд харагдсаар эсэх.
        /// </summary>
        private static Scenario GenerateWithOfficePlans(string id, string title, string link, string room, ExpectedViews exp)
        {
            Scenario g = Generate(id, title, link, room, exp, "generation");
            Func<UIApplication, LiveContext, ScenarioResult, ScnState, bool> inner = g.Setup;
            g.Setup = (app, L, res, st) =>
            {
                Document doc = Doc(app);
                var plan = doc.GetElement(new ElementId(Convert.ToInt64(L.R.Facts["plan_l1"]))) as ViewPlan;
                if (plan == null || plan.GenLevel == null) { res.Add("setup.plan", "BLOCKED", "plan_l1 алга"); return false; }
                ElementId office, work;
                using (var t = new Transaction(doc, "gate: оффисын план"))
                {
                    t.Start();
                    ViewFamilyType vft = new FilteredElementCollector(doc).OfClass(typeof(ViewFamilyType)).Cast<ViewFamilyType>()
                        .First(x => x.ViewFamily == ViewFamily.FloorPlan);
                    ViewPlan o = ViewPlan.Create(doc, vft.Id, plan.GenLevel.Id);
                    o.Name = "GATE ОФФИСЫН ТАВИЛГЫН ПЛАН";
                    ViewPlan w = ViewPlan.Create(doc, vft.Id, plan.GenLevel.Id);
                    w.Name = "GATE АЖЛЫН ПЛАН";
                    ViewSheet sh = ViewSheet.Create(doc, ElementId.InvalidElementId);
                    sh.SheetNumber = "GATE-OFFICE-1";
                    sh.Name = "ОФФИСЫН ТАВИЛГЫН ПЛАН";
                    Viewport.Create(doc, sh.Id, o.Id, new XYZ(1, 1, 0));
                    office = o.Id; work = w.Id;
                    t.Commit();
                }
                bool ok = inner(app, L, res, st);
                st.Data = new object[] { st.Data, office, work };
                // 1.40.0: шалгах самбар асаалттай — ажил дуусахад (эхэлсэн зураг дээрээ хүлээж байвал) үр дүнгийн хөтөч нээгдэнэ (W06, 1.46.0-оос
                // «MGL — Ханын дэлгээсийн үр дүн»; өмнө нь «MGL — Дэлгээсийн хуудас шалгах»).
                L.WritePrefs(DefaultPrefs.Where(p => !p.StartsWith("reviewPanel=", StringComparison.Ordinal)).Concat(new[] { "reviewPanel=1" }).ToArray());
                return ok;
            };
            Action<UIApplication, LiveContext, ScenarioResult, ScnState> inspect = g.Inspect;
            g.Inspect = (app, L, res, st) =>
            {
                var arr = (object[])st.Data;
                st.Data = arr[0];
                inspect(app, L, res, st);
                Document doc = Doc(app);
                View office = doc.GetElement((ElementId)arr[1]) as View, work = doc.GetElement((ElementId)arr[2]) as View;
                var mine = new HashSet<long>(Inspector.NewElevations(doc, L).Select(v => v.Id.Value));
                List<ElevationMarker> marks = new FilteredElementCollector(doc).OfClass(typeof(ElevationMarker)).Cast<ElevationMarker>()
                    .Where(m => Enumerable.Range(0, m.MaximumViewCount).Any(i => { try { return mine.Contains(m.GetViewId(i).Value); } catch { return false; } }))
                    .ToList();
                if (marks.Count == 0 || office == null || work == null) { res.Add("hide.office_sheet", "BLOCKED", "маркер " + marks.Count + ", план " + (office != null) + "/" + (work != null)); return; }
                int hiddenOffice = marks.Count(m => m.IsHidden(office)), hiddenWork = marks.Count(m => m.IsHidden(work));
                res.Expect(hiddenOffice == marks.Count, "hide.office_sheet", "оффисын хуудсан дээрх планд нуугдсан маркер " + hiddenOffice + "/" + marks.Count);
                res.Expect(hiddenWork == 0, "hide.work_plan_visible", "ажлын (хуудсанд БИШ) планд нуугдсан маркер " + hiddenWork + "/" + marks.Count);
                string log = L.LogSince(st.LogOffset);
                res.Expect(log.Contains("үр дүнгийн самбар нээгдэв"), "review.panel_opened", log.Contains("үр дүнгийн самбар нээгдэв") ? "самбар нээгдэв" : "лог дээр самбар нээгдсэн бичлэг алга");
                View active = app.ActiveUIDocument.ActiveView;
                res.Info("review.active_view", active != null ? active.ViewType + " «" + active.Name + "»" : "-");
                // Самбарыг Win32 гарчгаар (UIA-д WPF modeless цонх driver-т олдоогүй, 2026-10-14) — байгааг баталж, хаана (дараагийн сценарийн
                // товшилтыг өөр дээрээ авахгүй).
                IntPtr hw = FindWindow(null, "MGL — Ханын дэлгээсийн үр дүн");
                res.Expect(hw != IntPtr.Zero, "review.window", hw != IntPtr.Zero ? "цонх байна" : "цонх олдсонгүй");
                if (hw != IntPtr.Zero) PostMessage(hw, 0x0010 /* WM_CLOSE */, IntPtr.Zero, IntPtr.Zero);
            };
            return g;
        }

        /// <summary>
        /// 1.40.0: өрөөтэй link instance-ийг УСТГААД ижил төрлийг ижил байрлалд дахин холбоно, 101-ийн tag-ийг шинэ instance-д дахин тавина →
        /// «Ханын дэлгээс» дахин ажиллуулахад шинэ дэлгээс, хуудас үүсэхгүй (хуучныг өрөөгөөр нь таньж хэвээр/шинэчилнэ).
        /// </summary>
        private static Scenario Relink(string id, string title, string link, string room)
        {
            return new Scenario
            {
                Id = id, Title = title, Category = "reliability", ExpectJob = true, TimeoutSec = 300,
                Setup = (app, L, res, st) =>
                {
                    Document doc = Doc(app);
                    List<long> made;
                    if (!L.Generated.TryGetValue(room, out made) || made.Count == 0) { res.Add("setup", "BLOCKED", room + "-ийн үүсгэсэн дэлгээс алга (GEN сценари унасан)"); return false; }
                    Geo.LinkedRoom lr = Geo.FindRoom(doc, link, room);
                    var plan = doc.GetElement(new ElementId(Convert.ToInt64(L.R.Facts["plan_l1"]))) as ViewPlan;
                    if (lr == null || lr.Link == null || plan == null) { res.Add("setup.room", "BLOCKED", link + "/" + room + " олдсонгүй"); return false; }
                    Transform tf = lr.Link.GetTotalTransform();
                    ElementId typeId = lr.Link.GetTypeId();
                    string oldUid = lr.Link.UniqueId;
                    using (var t = new Transaction(doc, "gate: link дахин холбох"))
                    {
                        t.Start();
                        // ШИНЭ instance-ийг ЭХЛЭЭД (хуучныг эхэлж устгавал Revit «All instances of link … have been deleted» цонх гаргаж
                        // гүйлгээг зогсоосон — run 2026-10-14 10:24).
                        RevitLinkInstance ni = RevitLinkInstance.Create(doc, typeId);
                        Transform nt = ni.GetTotalTransform();
                        double ang = Math.Atan2(tf.BasisX.Y, tf.BasisX.X) - Math.Atan2(nt.BasisX.Y, nt.BasisX.X);
                        if (Math.Abs(ang) > 1e-9) ElementTransformUtils.RotateElement(doc, ni.Id, Line.CreateBound(nt.Origin, nt.Origin + XYZ.BasisZ), ang);
                        ElementTransformUtils.MoveElement(doc, ni.Id, tf.Origin - ni.GetTotalTransform().Origin);
                        doc.Delete(lr.Link.Id);
                        t.Commit();
                    }
                    Geo.LinkedRoom nr = Geo.FindRoom(doc, link, room);
                    if (nr == null || nr.Link == null || nr.Link.UniqueId == oldUid) { res.Add("setup.relink", "BLOCKED", "шинэ instance олдсонгүй"); return false; }
                    double off = nr.Tf.Origin.DistanceTo(tf.Origin) * 304.8;
                    res.Expect(off < 1 && nr.Tf.BasisX.IsAlmostEqualTo(tf.BasisX), "setup.relink_same_place", "шинэ instance-ийн зөрүү " + Math.Round(off, 2) + " мм");
                    if (!Activate(app, plan, res)) return false;
                    RoomTag tag;
                    using (var t = new Transaction(doc, "gate: өрөөний tag"))
                    {
                        t.Start();
                        XYZ p = nr.Tf.OfPoint(((LocationPoint)nr.Room.Location).Point);
                        tag = doc.Create.NewRoomTag(new LinkElementId(nr.Link.Id, nr.Room.Id), new UV(p.X, p.Y), plan.Id);
                        t.Commit();
                    }
                    st.Data = Inspector.SnapshotToolViews(doc, L, room);
                    app.ActiveUIDocument.Selection.SetElementIds(new List<ElementId> { tag.Id });
                    L.WritePrefs(DefaultPrefs);
                    st.Driver.Add("wait \"" + T + "\" 120");
                    st.Driver.Add("dump \"" + T + "\" preview-" + id);
                    st.Driver.Add("try-invoke \"" + T + "\" \"" + GenerateBtn + "\" 5");
                    st.Driver.Add("sleep 1500");
                    st.Driver.Add("finally dismiss \"" + T + "\" 3");
                    return true;
                },
                Inspect = (app, L, res, st) =>
                {
                    // Хуучин link устахад түүнийг заасан өрөөний шошго, хэмжээс хамт устдаг — хэрэгсэл дахин зурж СЭРГЭЭНЭ (тоо нэмэгдэх нь зөв).
                    var tmp = new ScenarioResult { Id = res.Id };
                    Inspector.NoDuplicates(app, L, tmp, st);
                    foreach (var c in tmp.Checks)
                    {
                        if (c.Id == "rerun.own_annotations_stable" && c.Status == "FAIL" && !Regex.IsMatch(c.Detail ?? "", @"(\d+)→(\d+)") ) { res.Add(c.Id, c.Status, c.Detail); continue; }
                        if (c.Id == "rerun.own_annotations_stable" && c.Status == "FAIL")
                        {
                            bool onlyUp = Regex.Matches(c.Detail ?? "", @"(\d+)→(\d+)").Cast<Match>().All(m => int.Parse(m.Groups[2].Value) >= int.Parse(m.Groups[1].Value));
                            res.Add(c.Id, onlyUp ? "PASS" : "FAIL", (onlyUp ? "устсан link-ийн шошго/хэмжээсийг сэргээсэн: " : "") + c.Detail);
                            continue;
                        }
                        res.Add(c.Id, c.Status, c.Detail);
                    }
                },
            };
        }

        /// <summary>
        /// 1.40.0: хэрэгслийн үүсгэсэн зүйл дээр хүн шиг ДАРЖ сонгогдох эсэх (хэрэгслийг дуудахгүй).  elev = дэлгээсийн тэмдэглэгээ (WeAnnoStore),
        /// keyplan = түлхүүр планы өрөөний шошго, sheet = хуудсан дээрх түлхүүр планы гарчиг (viewport сонгогдох ёстой).
        /// </summary>
        /// <summary>
        /// Урьдчилсан ЗУРАГ (2026-10-14): цонх нээгдмэгц эхний дэлгээсийг Revit-ээр түр үүсгэж PNG болгоод буцаана — зураг гарах, загварт
        /// шинэ харагдац/элемент үлдэхгүй (TransactionGroup.RollBack), Undo-д юу ч нэмэгдэхгүй.  Цонхыг «Болих»-оор хаана.
        /// </summary>
        private static Scenario LivePreview(string id, string title, string link, string room)
        {
            return new Scenario
            {
                Id = id, Title = title, Category = "preview",
                Setup = (app, L, res, st) =>
                {
                    Document doc = Doc(app);
                    Geo.LinkedRoom lr = Geo.FindRoom(doc, link, room);
                    if (lr == null) { res.Add("setup.room", "BLOCKED", link + "/" + room + " өрөө олдсонгүй"); return false; }
                    var plan = doc.GetElement(new ElementId(Convert.ToInt64(L.R.Facts["plan_l1"]))) as ViewPlan;
                    if (!Activate(app, plan, res)) return false;
                    RoomTag tag = Geo.TagOf(doc, plan, lr);
                    if (tag == null) { res.Add("setup.tag", "BLOCKED", room + "-ийн tag планд алга"); return false; }
                    app.ActiveUIDocument.Selection.SetElementIds(new List<ElementId> { tag.Id });
                    L.WritePrefs(DefaultPrefs.Where(p => !p.StartsWith("livePreview=", StringComparison.Ordinal)).Concat(new[] { "livePreview=1" }).ToArray());
                    st.Data = new FilteredElementCollector(doc).OfClass(typeof(View)).GetElementCount();
                    st.Driver.Add("wait \"" + T + "\" 120");
                    st.Driver.Add("waitname \"" + T + "\" \"Урьдчилсан зураг бэлэн\" 90");
                    st.Driver.Add("dump \"" + T + "\" preview-" + id);
                    st.Driver.Add("finally dismiss \"" + T + "\" 5");
                    return true;
                },
                Inspect = (app, L, res, st) =>
                {
                    Document doc = Doc(app);
                    string ack = st.Ack != null && File.Exists(st.Ack) ? File.ReadAllText(st.Ack, Encoding.UTF8) : string.Empty;
                    bool ready = ack.Contains("Урьдчилсан зураг бэлэн");
                    res.Expect(ready, "preview.image", ready ? "зураг гарсан" : "зураг гарсангүй — " + Trim(ack, 300));
                    int views = new FilteredElementCollector(doc).OfClass(typeof(View)).GetElementCount();
                    int before = st.Data is int ? (int)st.Data : -1;
                    res.Expect(views == before, "preview.rolled_back", "харагдац " + before + " → " + views + (views == before ? " (буцаагдсан)" : " — загварт үлдсэн!"));
                    string png = Directory.Exists(Path.Combine(Path.GetTempPath(), "MGL", "we-preview"))
                        ? Directory.GetFiles(Path.Combine(Path.GetTempPath(), "MGL", "we-preview"), "*.png", SearchOption.AllDirectories)
                            .OrderByDescending(File.GetLastWriteTimeUtc).FirstOrDefault()
                        : null;
                    if (png != null) { res.Evidence.Add(png); res.Info("preview.png", png); }
                },
            };
        }

        private static Scenario SelectGenerated(string id, string title, string room, string what)
        {
            return new Scenario
            {
                Id = id, Title = title, Category = "editability", DriverOnly = true, TimeoutSec = 180,
                Activate = (app, L, res, st) =>
                {
                    Document doc = Doc(app);
                    View v; ElementId target; XYZ at;
                    if (!FindTarget(doc, L, room, what, out v, out target, out at, res)) return false;
                    st.Data = new object[] { v.Id, target, at };
                    return Activate(app, v, res);
                },
                Setup = (app, L, res, st) =>
                {
                    var d = (object[])st.Data;
                    View v = Doc(app).GetElement((ElementId)d[0]) as View;
                    var target = (ElementId)d[1];
                    var at = (XYZ)d[2];
                    UIView uv = app.ActiveUIDocument.GetOpenUIViews().FirstOrDefault(x => x.ViewId == v.Id);
                    if (uv == null) { res.Add("setup.view", "BLOCKED", "UIView алга"); return false; }
                    double m = v is ViewSheet ? U.Mm(60) : U.Mm(1500);
                    XYZ r = v.RightDirection, up = v.UpDirection;
                    uv.ZoomAndCenterRectangle(at - r * m - up * m, at + r * m + up * m);
                    app.ActiveUIDocument.RefreshActiveView();
                    app.ActiveUIDocument.Selection.SetElementIds(new List<ElementId>());
                    double sx, sy;
                    if (!ScreenOf(uv, v, at, out sx, out sy)) { res.Add("setup.screen", "BLOCKED", "цэг дэлгэцэнд харагдахгүй"); return false; }
                    Element e = Doc(app).GetElement(target);
                    res.Info("target", (e != null && e.Category != null ? e.Category.Name : "?") + " #" + target.Value + " «" + v.Name + "» → screen (" + Geo.S(sx) + ", " + Geo.S(sy) + ")"
                                       + (e != null ? " · pinned " + e.Pinned : ""));
                    // Сонголтыг товшилтын агшинд бүртгэнэ: хуудсан дээр viewport сонгогдсоныг Revit харуулсан ч (дэлгэцийн зураг: «Modify |
                    // Viewports», «Viewports (1)») inspect хүртэл ~1 минутад цэвэрлэгдсэн байв (gate 2026-10-14, SEL-TITLE-SHEET-101).
                    SeenSelection.Clear();
                    if (!_selHooked) { app.SelectionChanged += OnSelectionChanged; _selHooked = true; }
                    st.Driver.Add("sleep 2000");
                    st.Driver.Add("shot before-" + id);
                    st.Driver.Add("click " + U.F(sx) + " " + U.F(sy));
                    st.Driver.Add("sleep 1200");
                    st.Driver.Add("shot after-" + id);
                    return true;
                },
                Inspect = (app, L, res, st) =>
                {
                    var d = (object[])st.Data;
                    var target = (ElementId)d[1];
                    Document doc = Doc(app);
                    // Хулганаас үл хамаарах шалгалт (2026-10-14): шошгоны доор манай дүүргэлт (FilledRegion) байх ёсгүй — хатуу дүүргэлтийн дотор
                    // тал бүхэлдээ сонгогдох бүс тул шошгон дээр дарахад дүүргэлт сонгогддог байв.
                    if (what == "keyplan") UnderFill(doc, doc.GetElement((ElementId)d[0]) as View, doc.GetElement(target), res);
                    string ack = st.Ack != null && File.Exists(st.Ack) ? File.ReadAllText(st.Ack, Encoding.UTF8) : string.Empty;
                    if (ack.Contains("Revit биш цонх"))
                    {
                        res.Add("select." + what, "BLOCKED", "тестийн Revit-ийн дээр өөр (хэрэглэгчийн) цонх — товшилт хийгдээгүй");
                        return;
                    }
                    ICollection<ElementId> sel = app.ActiveUIDocument.Selection.GetElementIds();
                    string got = string.Join(", ", sel.Take(5).Select(i => { Element e = doc.GetElement(i); return (e != null && e.Category != null ? e.Category.Name : "?") + " #" + i.Value; }));
                    bool now = sel.Contains(target), then = SeenSelection.Contains(target.Value);
                    res.Expect(now || then, "select." + what, now ? "сонгогдсон" : then ? "товшилтоор сонгогдсон (SelectionChanged; inspect хүртэл цэвэрлэгдсэн)"
                                                                       : "сонгогдсонгүй — сонголт: [" + got + "], үйл явдал: [" + string.Join(", ", SeenSelection.Take(5)) + "]");
                    try { app.ActiveUIDocument.Selection.SetElementIds(new List<ElementId>()); } catch { }
                },
            };
        }

        /// <summary>Түлхүүр план: шошго, бичвэр тэмдэг бүрийн төв манай өрөөний дүүргэлтийн ДОТОР биш байх (нүхлэсэн).</summary>
        private static void UnderFill(Document doc, View kp, Element tag, ScenarioResult res)
        {
            if (kp == null) return;
            var fills = new FilteredElementCollector(doc, kp.Id).OfClass(typeof(FilledRegion)).Cast<FilledRegion>()
                .Where(f => f.OwnerViewId == kp.Id && doc.GetElement(f.GetTypeId()) is Element t && t.Name == "MGL — Түлхүүр өрөө").ToList();
            if (fills.Count == 0) { res.Add("keyplan.fill", "BLOCKED", "түлхүүр план дээр манай дүүргэлт алга"); return; }
            var labels = new FilteredElementCollector(doc, kp.Id).WhereElementIsNotElementType()
                .Where(e => e.OwnerViewId == kp.Id && (e is TextNote || e is SpatialElementTag)).ToList();
            if (tag != null && labels.All(e => e.Id != tag.Id)) labels.Add(tag);
            var covered = new List<string>();
            foreach (Element e in labels)
            {
                XYZ c = GripPoint(e, kp);
                if (c == null) continue;
                if (fills.Any(f => Inside(f.GetBoundaries(), c))) covered.Add((e is TextNote ? "бичвэр «" + ((TextNote)e).Text.Trim() + "»" : "шошго") + " #" + e.Id.Value);
            }
            res.Expect(covered.Count == 0, "keyplan.labels_not_under_fill",
                covered.Count == 0 ? labels.Count + " шошго/бичвэрийн доор дүүргэлт алга (дарахад тэр нь сонгогдоно)" : "дүүргэлтийн доор: " + string.Join(", ", covered));
        }

        /// <summary>Тэгш сондгойн дүрэм: нүхтэй хил — цэг гадна хил дотор, нүхний гадна.</summary>
        private static bool Inside(IList<CurveLoop> loops, XYZ p)
        {
            int crossings = 0;
            foreach (CurveLoop loop in loops)
            {
                var pts = new List<XYZ>();
                foreach (Curve c in loop) { IList<XYZ> t = c.Tessellate(); for (int i = 0; i + 1 < t.Count; i++) pts.Add(t[i]); }
                for (int i = 0, j = pts.Count - 1; i < pts.Count; j = i++)
                    if ((pts[i].Y > p.Y) != (pts[j].Y > p.Y) && p.X < (pts[j].X - pts[i].X) * (p.Y - pts[i].Y) / (pts[j].Y - pts[i].Y) + pts[i].X) crossings++;
            }
            return crossings % 2 == 1;
        }

        private static readonly HashSet<long> SeenSelection = new HashSet<long>();
        private static bool _selHooked;

        private static void OnSelectionChanged(object sender, Autodesk.Revit.UI.Events.SelectionChangedEventArgs e)
        {
            try { foreach (ElementId id in e.GetSelectedElements()) SeenSelection.Add(id.Value); } catch { }
        }

        private static bool FindTarget(Document doc, LiveContext L, string room, string what, out View v, out ElementId target, out XYZ at, ScenarioResult res)
        {
            v = null; target = ElementId.InvalidElementId; at = null;
            List<long> made;
            if (!L.Generated.TryGetValue(room, out made) || made.Count == 0) { res.Add("setup", "BLOCKED", room + "-ийн үүсгэсэн дэлгээс алга"); return false; }
            var views = made.Select(i => doc.GetElement(new ElementId(i)) as View).Where(x => x != null).ToList();
            if (what == "elev")
            {
                foreach (View ev in views.Where(x => x.ViewType == ViewType.Elevation || x.ViewType == ViewType.Section))
                {
                    var owned = new FilteredElementCollector(doc, ev.Id).WhereElementIsNotElementType()
                        .Where(e => e.OwnerViewId == ev.Id && (e is IndependentTag || e is TextNote || e is Dimension || e is SpotDimension)).ToList();
                    Element pick = owned.OfType<IndependentTag>().Cast<Element>().FirstOrDefault() ?? owned.OfType<TextNote>().Cast<Element>().FirstOrDefault() ?? owned.FirstOrDefault();
                    if (pick == null) continue;
                    XYZ p = GripPoint(pick, ev);
                    if (p == null) continue;
                    v = ev; target = pick.Id; at = p;
                    return true;
                }
                res.Add("setup.target", "BLOCKED", "дэлгээс дээр хэрэгслийн тэмдэглэгээ олдсонгүй");
                return false;
            }
            View kp = views.FirstOrDefault(x => x.ViewType == ViewType.FloorPlan);
            if (kp == null)
            {
                // Түлхүүр план бичлэгээр (L.Generated-д дэлгээс л байж болно).
                kp = new FilteredElementCollector(doc).OfClass(typeof(ViewPlan)).Cast<ViewPlan>().FirstOrDefault(x => !x.IsTemplate && x.Name.Contains("Түлхүүр байгуулалт") && x.Name.Contains(room));
            }
            if (kp == null) { res.Add("setup.target", "BLOCKED", "түлхүүр план олдсонгүй"); return false; }
            if (what == "keyplan")
            {
                RoomTag t = new FilteredElementCollector(doc, kp.Id).OfCategory(BuiltInCategory.OST_RoomTags).WhereElementIsNotElementType().OfType<RoomTag>().FirstOrDefault();
                XYZ tp = t != null ? GripPoint(t, kp) : null;
                if (tp == null) { res.Add("setup.target", "BLOCKED", "түлхүүр план дээр өрөөний шошго алга"); return false; }
                v = kp; target = t.Id; at = tp;
                return true;
            }
            Viewport vp = new FilteredElementCollector(doc).OfClass(typeof(Viewport)).Cast<Viewport>().FirstOrDefault(x => x.ViewId == kp.Id);
            if (vp == null) { res.Add("setup.target", "BLOCKED", "түлхүүр план хуудсанд байрлаагүй"); return false; }
            Outline lo = vp.GetLabelOutline();
            v = doc.GetElement(vp.SheetId) as View; target = vp.Id;
            // Гарчгийн бичвэр дээр (outline-ийн зүүн гуравны нэг — дугаартай тойргоос баруун тийш).
            at = new XYZ(lo.MinimumPoint.X + (lo.MaximumPoint.X - lo.MinimumPoint.X) * 0.55, (lo.MinimumPoint.Y + lo.MaximumPoint.Y) / 2, 0);
            return true;
        }

        /// <summary>Хүн дарах цэг: шошгоны толгой, хэмжээсийн бичвэр, бичвэрийн төв (хайрцгийн төв биш — хэмжээсийнх загвар дээр унадаг).</summary>
        private static XYZ GripPoint(Element e, View v)
        {
            try
            {
                var rt = e as RoomTag;
                if (rt != null) return rt.TagHeadPosition;
                var it = e as IndependentTag;
                if (it != null) return it.TagHeadPosition;
                var tn = e as TextNote;
                if (tn != null) return tn.Coord;   // бичвэрийн төв (хайрцаг нь leader-ийг агуулна)
                var d = e as Dimension;
                if (d != null && !(d is SpotDimension)) return d.NumberOfSegments > 0 ? d.Segments.get_Item(0).TextPosition : d.TextPosition;
            }
            catch { }
            BoundingBoxXYZ bb = e.get_BoundingBox(v);
            return bb != null ? (bb.Min + bb.Max) * 0.5 : null;
        }

        private static bool ScreenOf(UIView uv, View v, XYZ p, out double sx, out double sy)
        {
            sx = sy = 0;
            Rectangle r = uv.GetWindowRectangle();
            IList<XYZ> zc = uv.GetZoomCorners();
            if (zc == null || zc.Count < 2) return false;
            XYZ a = zc[0], b = zc[1], right = v.RightDirection, up = v.UpDirection;
            double fx = (p - a).DotProduct(right) / (b - a).DotProduct(right), fy = (p - a).DotProduct(up) / (b - a).DotProduct(up);
            sx = r.Left + fx * (r.Right - r.Left);
            sy = r.Bottom - fy * (r.Bottom - r.Top);
            return fx > 0.02 && fx < 0.98 && fy > 0.02 && fy < 0.98;
        }

        internal static Scenario Rerun(string id, string title, string link, string room)
        {
            return new Scenario
            {
                Id = id, Title = title, Category = "reliability", ExpectJob = true, TimeoutSec = 240,
                Setup = (app, L, res, st) =>
                {
                    Document doc = Doc(app);
                    Geo.LinkedRoom lr = Geo.FindRoom(doc, link, room);
                    var plan = doc.GetElement(new ElementId(Convert.ToInt64(L.R.Facts["plan_l1"]))) as ViewPlan;
                    if (lr == null || !Activate(app, plan, res)) return false;
                    RoomTag tag = Geo.TagOf(doc, plan, lr);
                    if (tag == null) { res.Add("setup.tag", "BLOCKED", lr.Number + "-ийн tag планд алга"); return false; }
                    st.Data = Inspector.SnapshotToolViews(doc, L, room);
                    app.ActiveUIDocument.Selection.SetElementIds(new List<ElementId> { tag.Id });
                    L.WritePrefs(DefaultPrefs);
                    // Хийх зүйлгүй үед «Үүсгэх» идэвхгүй байж болно — тэр тохиолдолд preview-г хаана (энэ нь ч хүлээгдэх үр дүн).
                    st.Driver.Add("wait \"" + T + "\" 120");
                    st.Driver.Add("dump \"" + T + "\" preview-" + id);
                    st.Driver.Add("try-invoke \"" + T + "\" \"" + GenerateBtn + "\" 5");
                    st.Driver.Add("sleep 1500");
                    st.Driver.Add("finally dismiss \"" + T + "\" 3");
                    return true;
                },
                Inspect = (app, L, res, st) => Inspector.NoDuplicates(app, L, res, st),
            };
        }

        private static Scenario EditProtect(string id, string title, string link, string room)
        {
            return new Scenario
            {
                Id = id, Title = title, Category = "reliability", ExpectJob = true, TimeoutSec = 300,
                Setup = (app, L, res, st) =>
                {
                    Document doc = Doc(app);
                    List<long> made;
                    if (!L.Generated.TryGetValue(room, out made) || made.Count == 0) { res.Add("setup", "BLOCKED", room + "-ийн үүсгэсэн дэлгээс алга (GEN сценари унасан)"); return false; }
                    var edits = Inspector.MakeDesignerEdits(doc, L, room, res);
                    if (edits == null) return false;
                    st.Data = edits;
                    Geo.LinkedRoom lr = Geo.FindRoom(doc, link, room);
                    var plan = doc.GetElement(new ElementId(Convert.ToInt64(L.R.Facts["plan_l1"]))) as ViewPlan;
                    if (!Activate(app, plan, res)) return false;
                    RoomTag t0 = Geo.TagOf(doc, plan, lr);
                    if (t0 == null) { res.Add("setup.tag", "BLOCKED", lr.Number + "-ийн tag планд алга"); return false; }
                    app.ActiveUIDocument.Selection.SetElementIds(new List<ElementId> { t0.Id });
                    L.WritePrefs(DefaultPrefs);
                    st.Driver.Add("wait \"" + T + "\" 120");
                    st.Driver.Add("dump \"" + T + "\" preview-" + id);
                    st.Driver.Add("try-invoke \"" + T + "\" \"" + GenerateBtn + "\" 5");
                    st.Driver.Add("sleep 1500");
                    st.Driver.Add("finally dismiss \"" + T + "\" 3");
                    return true;
                },
                Inspect = (app, L, res, st) => Inspector.EditsKept(app, L, res, st),
            };
        }

        /// <summary>Production урсгалаар (урьдчилсан сонголтгүй) → шууд БОДИТ нэг дарах (1.38.0: цонхгүй, Esc-гүй) → preview-д аль өрөө гарсныг шалгаж БОЛИХ.</summary>
        private static Scenario Click(string id, string title, string planFact, string room, string where, string known)
        {
            return new Scenario
            {
                Id = id, Title = title, Category = "selection", ExpectJob = false, TimeoutSec = 900,
                Activate = (app, L, res, st) =>
                {
                    Document doc = Doc(app);
                    View plan = planFact == "host_l1" ? (View)new FilteredElementCollector(doc).OfClass(typeof(ViewPlan)).Cast<ViewPlan>().FirstOrDefault(v => !v.IsTemplate && v.Name == "L1")
                                                      : doc.GetElement(new ElementId(Convert.ToInt64(L.R.Facts[planFact]))) as View;
                    return Activate(app, plan, res);
                },
                Setup = (app, L, res, st) =>
                {
                    Document doc = Doc(app);
                    bool host = planFact == "host_l1";
                    Geo.LinkedRoom lr = Geo.FindRoom(doc, host ? null : "Architecture_Test", room);
                    View plan = app.ActiveUIDocument.ActiveView;
                    if (lr == null) { res.Add("setup.room", "BLOCKED", room + " олдсонгүй"); return false; }
                    app.ActiveUIDocument.Selection.SetElementIds(new List<ElementId>());
                    XYZ target = Inspector.ClickPoint(lr, where);
                    if (target == null) { res.Add("setup.point", "BLOCKED", "дарах цэг тооцоолсонгүй"); return false; }
                    Inspector.ZoomTo(app.ActiveUIDocument, plan, lr);
                    double sx, sy;
                    if (!Geo.ToScreen(app.ActiveUIDocument, plan, target, out sx, out sy)) { res.Add("setup.screen", "BLOCKED", "цэг дэлгэцэнд харагдахгүй"); return false; }
                    res.Info("click", where + " @ model (" + Geo.S(U.ToMm(target.X)) + ", " + Geo.S(U.ToMm(target.Y)) + ") мм → screen (" + Geo.S(sx) + ", " + Geo.S(sy) + ")");
                    L.WritePrefs(DefaultPrefs);
                    // 1.38.0: цонхгүйгээр шууд НЭГ товшилт (WeRoomPicker.PickOne) → урьдчилсан дүн.  Esc дарахгүй (Esc = «Бусад сонголт»).
                    st.Driver.Add("sleep 3000");
                    st.Driver.Add("shot before-click-" + id);
                    st.Driver.Add("click " + U.F(sx) + " " + U.F(sy));
                    st.Driver.Add("sleep 1500");
                    st.Driver.Add("shot after-click-" + id);
                    st.Driver.Add("dump \"" + T + "\" result-" + id + " 30");
                    st.Driver.Add("finally dismiss \"" + T + "\" 5");
                    st.DumpName = "result-" + id;
                    st.Data = new object[] { room, known };
                    return true;
                },
                Inspect = (app, L, res, st) => Inspector.Selection(app, L, res, st),
            };
        }

        /// <summary>
        /// 1.40.0: курсорыг өрөөн дотор аваачиж (дарахгүй) хүлээнэ → тодруулга (лог «[hover] → 101 …») + зураг; дараа нь тэр цэг дээр дарж
        /// сонгоно (ердийн сонголт хэвээр).
        /// </summary>
        private static Scenario Hover(string id, string title, string planFact, string room)
        {
            Scenario c = Click(id, title, planFact, room, "empty", null);
            Func<UIApplication, LiveContext, ScenarioResult, ScnState, bool> inner = c.Setup;
            c.Category = "selection";
            c.Setup = (app, L, res, st) =>
            {
                if (!inner(app, L, res, st)) return false;
                // Click-ийн скриптийн «click …» мөрийн өмнө hover оруулна (ижил цэг).
                int i = st.Driver.FindIndex(l => l.StartsWith("click ", StringComparison.Ordinal));
                if (i < 0) { res.Add("setup.hover", "BLOCKED", "click мөр алга"); return false; }
                string[] xy = st.Driver[i].Split(' ');
                st.Driver.Insert(i, "hover " + xy[1] + " " + xy[2] + " 2500 hover-" + id);
                return true;
            };
            c.Inspect = (app, L, res, st) =>
            {
                string log = L.LogSince(st.LogOffset);
                // Дэлгэцийн координат тестийн тооцоонд хэдэн метр зөрж болдог (SEL-TAG-102, 2026-10-14) — гол шалгалт: курсор доорх
                // тодруулсан өрөө = тэр цэг дээр дарахад сонгогдсон өрөө.
                Match pick = Regex.Match(log, @"\[pick\] [^\r\n]*нэг товшилт → ([^\r\n(]*)");
                MatchCollection hovers = Regex.Matches(log, @"\[hover\] [^\r\n]*→ ([^\r\n]*)");
                string lastHover = hovers.Count > 0 ? hovers[hovers.Count - 1].Groups[1].Value : null;
                string picked = pick.Success ? pick.Groups[1].Value.Trim() : null;
                bool same = picked != null && lastHover != null && lastHover.StartsWith(picked.Split(' ')[0] + " ", StringComparison.Ordinal);
                res.Expect(same, "hover.matches_click", "тодруулсан «" + Trim(lastHover, 80) + "» · дарахад «" + Trim(picked, 80) + "»");
                string idx = Regex.Match(log, @"\[hover\] [^\r\n]*индекс: [^\r\n]*").Value;
                res.Info("hover.index", Trim(idx, 200));
                Match m = Regex.Match(log, @"\[hover\] [^\r\n]*→ ([^\r\n]*)");
                res.Expect(m.Success, "hover.room", m.Success ? "тодруулсан: " + Trim(m.Groups[1].Value, 160) : "лог дээр «[hover] →» алга");
                string refresh = Regex.Match(log, @"\[hover\] [^\r\n]*RefreshActiveView[^\r\n]*").Value;
                if (refresh.Length > 0) res.Info("hover.refresh", Trim(refresh, 200));
                string done = Regex.Match(log, @"\[hover\] [^\r\n]*дуусав[^\r\n]*").Value;
                res.Info("hover.done", Trim(done, 200));
            };
            return c;
        }

        [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
        internal static extern IntPtr FindWindow(string cls, string title);
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        internal static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);

        private static Scenario SheetClick(string id, string title, string known)
        {
            return new Scenario
            {
                Id = id, Title = title, Category = "selection", ExpectJob = false, TimeoutSec = 900,
                Activate = (app, L, res, st) => Activate(app, Doc(app).GetElement(new ElementId(Convert.ToInt64(L.R.Facts["sheet_plan"]))) as View, res),
                Setup = (app, L, res, st) =>
                {
                    Document doc = Doc(app);
                    var sheet = app.ActiveUIDocument.ActiveView as ViewSheet;
                    Geo.LinkedRoom lr = Geo.FindRoom(doc, "Architecture_Test", "101");
                    if (sheet == null || lr == null) { res.Add("setup", "BLOCKED", "sheet/өрөө алга"); return false; }
                    app.ActiveUIDocument.Selection.SetElementIds(new List<ElementId>());
                    Viewport vp = sheet.GetAllViewports().Select(i => doc.GetElement(i) as Viewport).FirstOrDefault(v => v != null);
                    if (vp == null) { res.Add("setup.viewport", "BLOCKED", "viewport алга"); return false; }
                    // model → projection (View.GetModelToProjectionTransforms) → sheet (Viewport.GetProjectionToSheetTransform).  ХЭМЖСЭН (run 8,
                    // 2026-10-13): зөвхөн хоёр дахийг хэрэглэхэд цэг хуудаснаас гарч «дэлгэцэнд гарсангүй» (тестийн алдаа).
                    var pv = doc.GetElement(vp.ViewId) as View;
                    XYZ model = Inspector.ClickPoint(lr, "empty");
                    XYZ proj = pv.GetModelToProjectionTransforms()[0].GetModelToProjectionTransform().OfPoint(model);
                    XYZ onSheet = vp.GetProjectionToSheetTransform().OfPoint(proj);
                    UIView uv = app.ActiveUIDocument.GetOpenUIViews().FirstOrDefault(x => x.ViewId == sheet.Id);
                    if (uv != null) { uv.ZoomToFit(); app.ActiveUIDocument.RefreshActiveView(); }
                    double sx, sy;
                    if (!Geo.ToScreen(app.ActiveUIDocument, sheet, onSheet, out sx, out sy)) { res.Add("setup.screen", "BLOCKED", "цэг дэлгэцэнд гарсангүй"); return false; }
                    res.Info("click", "sheet (" + Geo.S(U.ToMm(onSheet.X)) + ", " + Geo.S(U.ToMm(onSheet.Y)) + ") мм → screen (" + Geo.S(sx) + ", " + Geo.S(sy) + ")");
                    L.WritePrefs(DefaultPrefs);
                    // Sheet идэвхтэй үед ч production шууд нэг товшилт руу орно.
                    st.Driver.Add("sleep 3000");
                    st.Driver.Add("shot before-click-" + id);
                    st.Driver.Add("click " + U.F(sx) + " " + U.F(sy));
                    st.Driver.Add("sleep 1500");
                    st.Driver.Add("shot after-click-" + id);
                    st.Driver.Add("dump \"" + T + "\" result-" + id + " 30");
                    st.Driver.Add("finally dismiss \"" + T + "\" 5");
                    st.DumpName = "result-" + id;
                    st.Data = new object[] { "101", known };
                    return true;
                },
                Inspect = (app, L, res, st) => Inspector.Selection(app, L, res, st),
            };
        }

        private static Scenario Unloaded(string id, string title)
        {
            return new Scenario
            {
                Id = id, Title = title, Category = "negative", ExpectJob = false, TimeoutSec = 150,
                Setup = (app, L, res, st) =>
                {
                    Document doc = Doc(app);
                    Geo.LinkedRoom lr = Geo.FindRoom(doc, "Architecture_B_Test.rvt : 2", "B101");
                    var plan = doc.GetElement(new ElementId(Convert.ToInt64(L.R.Facts["plan_l1"]))) as ViewPlan;
                    if (lr == null || !Activate(app, plan, res)) { res.Add("setup", "BLOCKED", "B101 олдсонгүй"); return false; }
                    RoomTag tag = Geo.TagOf(doc, plan, lr);
                    if (tag == null) { res.Add("setup.tag", "BLOCKED", "B101-ийн tag планд алга"); return false; }
                    var lt = doc.GetElement(lr.Link.GetTypeId()) as RevitLinkType;
                    lt.Unload(null);
                    res.Info("setup", "link «" + lt.Name + "» unload хийв");
                    st.Data = lt.Id;
                    app.ActiveUIDocument.Selection.SetElementIds(new List<ElementId> { tag.Id });
                    L.WritePrefs(DefaultPrefs);
                    st.Driver.Add("wait \"" + T + "\" 60");
                    st.Driver.Add("dump \"" + T + "\" result-" + id);
                    st.Driver.Add("finally dismiss \"" + T + "\" 5");
                    st.DumpName = "result-" + id;
                    return true;
                },
                Inspect = (app, L, res, st) =>
                {
                    string dump = Inspector.ReadDump(L, st.DumpName);
                    res.Expect(Regex.IsMatch(dump, "ачаалагдаагүй|Manage Links", RegexOptions.IgnoreCase), "message.unloaded_link",
                               "мессеж: " + Trim(Inspector.DumpTexts(dump), 300));
                    res.Expect(L.Added.Count == 0 && L.Deleted.Count == 0, "model.unchanged", "нэмэгдсэн " + L.Added.Count + ", устсан " + L.Deleted.Count);
                    var lt = Doc(app).GetElement((ElementId)st.Data) as RevitLinkType;
                    try { lt.Load(); res.Info("teardown", "link дахин ачаалав"); } catch (Exception ex) { res.Add("teardown", "FAIL", "link дахин ачаалж чадсангүй: " + ex.Message); }
                },
            };
        }

        private static Scenario MissingTemplate(string id, string title)
        {
            return new Scenario
            {
                Id = id, Title = title, Category = "negative", ExpectJob = true, TimeoutSec = 300,
                Setup = (app, L, res, st) =>
                {
                    Document doc = Doc(app);
                    Geo.LinkedRoom lr = Geo.FindRoom(doc, "Architecture_Test", "107");
                    var plan = doc.GetElement(new ElementId(Convert.ToInt64(L.R.Facts["plan_l1"]))) as ViewPlan;
                    if (lr == null || !Activate(app, plan, res)) return false;
                    RoomTag t0 = Geo.TagOf(doc, plan, lr);
                    if (t0 == null) { res.Add("setup.tag", "BLOCKED", lr.Number + "-ийн tag планд алга"); return false; }
                    app.ActiveUIDocument.Selection.SetElementIds(new List<ElementId> { t0.Id });
                    L.WritePrefs("output=ViewsOnly", "scale=50", "template=ГЕЙТ_БАЙХГҮЙ_ЗАГВАР");
                    st.Driver.Add("wait \"" + T + "\" 90");
                    st.Driver.Add("dump \"" + T + "\" preview-" + id);
                    st.Driver.Add("try-invoke \"" + T + "\" \"" + GenerateBtn + "\" 8");
                    st.Driver.Add("sleep 1500");
                    st.Driver.Add("finally dismiss \"" + T + "\" 3");
                    st.Data = lr;
                    return true;
                },
                Inspect = (app, L, res, st) =>
                {
                    Document doc = Doc(app);
                    List<View> views = Inspector.NewElevations(doc, L);
                    res.Info("views", views.Count + " дэлгээс үүсэв; загвар: " + string.Join(", ", views.Select(v => v.ViewTemplateId == ElementId.InvalidElementId ? "(байхгүй)" : doc.GetElement(v.ViewTemplateId).Name).Distinct()));
                    res.Expect(!Regex.IsMatch(st.Log ?? "", "ERROR"), "no_crash", "production лог-д ERROR алга");
                    res.Expect(views.Count > 0 || Regex.IsMatch(Inspector.DumpTexts(Inspector.ReadDump(L, "preview-" + id)), "загвар|template", RegexOptions.IgnoreCase),
                               "handled", "дэлгээс үүссэн эсвэл загварын талаар тайлбар гарсан");
                },
            };
        }

        private static Scenario OpenArchCopy()
        {
            return new Scenario
            {
                Id = "OPEN-HOST-MODEL", Title = "Host өрөөтэй архитектурын хуулбарыг нээх", Category = "environment", NoCommand = true,
                Setup = (app, L, res, st) =>
                {
                    if (!File.Exists(L.ArchCopy)) { res.Add("open", "BLOCKED", "хуулбар алга"); return false; }
                    UIDocument ui = app.OpenAndActivateDocument(L.ArchCopy);
                    res.Expect(ui != null && ui.Document.PathName == L.ArchCopy, "open", L.ArchCopy);
                    return true;
                },
                Inspect = (app, L, res, st) => { },
            };
        }

        private static Scenario GenerateHost(string id, string title) { return GenerateHost(id, title, "101", 4, "leak"); }

        internal static Scenario GenerateHost(string id, string title, string room, int views, string category)
        {
            return new Scenario
            {
                Id = id, Title = title, Category = category, ExpectJob = true,
                Setup = (app, L, res, st) =>
                {
                    Document doc = Doc(app);
                    Geo.LinkedRoom lr = Geo.FindRoom(doc, null, room);
                    View plan = new FilteredElementCollector(doc).OfClass(typeof(ViewPlan)).Cast<ViewPlan>().FirstOrDefault(v => !v.IsTemplate && v.Name == "L1");
                    if (lr == null || !Activate(app, plan, res)) { res.Add("setup", "BLOCKED", "host өрөө " + room + " / L1 план алга"); return false; }
                    app.ActiveUIDocument.Selection.SetElementIds(new List<ElementId> { lr.Room.Id });
                    L.WritePrefs(DefaultPrefs);
                    st.Driver.AddRange(GenerateScript(id));
                    st.Data = lr;
                    return true;
                },
                Inspect = (app, L, res, st) => Inspector.Generation(app, L, res, st, (Geo.LinkedRoom)st.Data, new ExpectedViews { Min = views, Max = views }),
            };
        }
    }
}
