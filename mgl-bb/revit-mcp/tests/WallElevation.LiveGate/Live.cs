using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using Autodesk.Revit.DB.Events;
using Autodesk.Revit.UI;

namespace MglWeGate
{
    /// <summary>Сценари доторх нэг шалгалт.  Status: PASS · FAIL · KNOWN (known-issues.json-ийн id) · BLOCKED · INFO.</summary>
    internal sealed class Check
    {
        public string Id, Status, Detail, KnownId;
    }

    internal sealed class ScenarioResult
    {
        public string Id, Title, Category;
        public readonly List<Check> Checks = new List<Check>();
        public readonly List<string> Evidence = new List<string>();
        public double Seconds;
        public string Note;

        public void Add(string id, string status, string detail, string known = null)
        {
            Checks.Add(new Check { Id = id, Status = status, Detail = detail, KnownId = known });
            GateLog.Info("   [" + status + "] " + Id + "/" + id + " — " + detail);
        }

        public void Expect(bool ok, string id, string detail, string known = null)
        {
            Add(id, ok ? "PASS" : (known != null ? "KNOWN" : "FAIL"), detail, ok ? null : known);
        }

        public void Info(string id, string detail) { Add(id, "INFO", detail); }

        /// <summary>FAIL > BLOCKED > KNOWN > PASS.  INFO нь тооцогдохгүй.</summary>
        public string Status
        {
            get
            {
                if (Checks.Any(c => c.Status == "FAIL")) return "FAIL";
                if (Checks.Any(c => c.Status == "BLOCKED")) return "BLOCKED";
                if (Checks.Any(c => c.Status == "KNOWN")) return "KNOWN";
                return Checks.Any(c => c.Status == "PASS") ? "PASS" : "BLOCKED";
            }
        }
    }

    /// <summary>
    /// Нэг Revit процесс доторх live туршилтын нийтлэг төлөв: production командын id, тараасан DLL-ийн хэш, баримтын өөрчлөлтийн бүртгэл
    /// (DocumentChanged — сценари бүрт юу үүсэж/устсаныг ЯГ мэднэ), driver-ийн файл протокол, production-ийн лог.
    /// </summary>
    internal sealed class LiveContext
    {
        public readonly GateRunner R;
        public RevitCommandId Cmd;
        public string CmdName;
        /// <summary>W09: «Интерьер» самбарын «Ханын дэлгээс» (WallElevationInteriorCommand) — байхгүй бол null (сценари BLOCKED).</summary>
        public RevitCommandId CmdInterior;
        /// <summary>F01: ribbon-ийн «Санал хүсэлт» (FeedbackCommand).</summary>
        public RevitCommandId CmdFeedback;
        public string CmdFeedbackName;
        public string CmdInteriorName;
        public string ProductDll, ProductSha, ProductVersion;
        public readonly List<ScenarioResult> Results = new List<ScenarioResult>();
        public readonly HashSet<long> Added = new HashSet<long>(), Deleted = new HashSet<long>(), Modified = new HashSet<long>();
        public readonly List<string> TxNames = new List<string>();
        public bool Recording;
        public DateTime LastChange = DateTime.MinValue;
        private int _driverSeq;
        public string Interior, ArchCopy;
        public string PrefsBackup;
        /// <summary>Өрөөний дугаар → энэ run-д үүсгэсэн дэлгээс / хуудас (дараагийн сценари — дахин ажиллуулах, засвар — эндээс авна).</summary>
        public readonly Dictionary<string, List<long>> Generated = new Dictionary<string, List<long>>(StringComparer.Ordinal);
        public readonly Dictionary<string, List<long>> GeneratedSheets = new Dictionary<string, List<long>>(StringComparer.Ordinal);

        public LiveContext(GateRunner r) { R = r; }

        public static string ProdDir { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "RevitMcpAddin"); } }
        public static string ProdLog { get { return Path.Combine(ProdDir, "wall-elevations.log"); } }
        public static string ProdPrefs { get { return Path.Combine(ProdDir, "wall-elevations.json"); } }

        public void OnDocChanged(object sender, DocumentChangedEventArgs e)
        {
            if (!Recording) return;
            foreach (ElementId id in e.GetAddedElementIds()) Added.Add(id.Value);
            foreach (ElementId id in e.GetDeletedElementIds()) Deleted.Add(id.Value);
            foreach (ElementId id in e.GetModifiedElementIds()) Modified.Add(id.Value);
            foreach (string n in e.GetTransactionNames()) TxNames.Add(n);
            LastChange = DateTime.Now;
        }

        public void StartRecording()
        {
            Added.Clear(); Deleted.Clear(); Modified.Clear(); TxNames.Clear();
            LastChange = DateTime.MinValue;
            Recording = true;
        }

        // ── Driver ─────────────────────────────────────────────────

        public string DriverDir { get { return Path.Combine(R.Job.RunDir, "driver"); } }

        /// <summary>Скрипт бичээд ack файлын замыг буцаана.</summary>
        public string Drive(IEnumerable<string> lines)
        {
            _driverSeq++;
            string seq = _driverSeq.ToString("000", CultureInfo.InvariantCulture);
            string tmp = Path.Combine(DriverDir, "cmd-" + seq + ".tmp");
            File.WriteAllLines(tmp, lines, new UTF8Encoding(false));
            File.Move(tmp, Path.Combine(DriverDir, "cmd-" + seq + ".txt"));
            return Path.Combine(DriverDir, "ack-" + seq + ".txt");
        }

        public static string AckState(string ackPath)
        {
            if (ackPath == null || !File.Exists(ackPath)) return null;
            string t;
            try { t = File.ReadAllText(ackPath, Encoding.UTF8); } catch { return null; }
            return t.Contains("DONE ok") ? "ok" : t.Contains("DONE fail") ? "fail" : null;
        }

        // ── Production лог ─────────────────────────────────────────

        public long LogLength()
        {
            try { return File.Exists(ProdLog) ? new FileInfo(ProdLog).Length : 0; } catch { return 0; }
        }

        public string LogSince(long offset)
        {
            try
            {
                if (!File.Exists(ProdLog)) return string.Empty;
                using (var fs = new FileStream(ProdLog, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                {
                    if (fs.Length < offset) offset = 0;   // эргэлт (rotation)
                    fs.Seek(offset, SeekOrigin.Begin);
                    using (var sr = new StreamReader(fs, Encoding.UTF8)) return sr.ReadToEnd();
                }
            }
            catch { return string.Empty; }
        }

        // ── Production add-in ──────────────────────────────────────

        /// <summary>Суусан production add-in-ий ачаалагдсан assembly ба «Ханын дэлгээс» товчны командын id (ribbon-оос — хэрэглэгч дардагтай ижил).</summary>
        public void Discover(UIApplication app, ScenarioResult r)
        {
            Assembly prod = AppDomain.CurrentDomain.GetAssemblies().FirstOrDefault(a => a.GetName().Name == "RevitMcpAddin");
            if (prod == null) { r.Add("product.loaded", "BLOCKED", "RevitMcpAddin ачаалагдаагүй — production add-in суугаагүй эсвэл ачаалахаас татгалзсан"); return; }
            ProductDll = prod.Location;
            ProductVersion = FileVersionOf(prod.Location);
            using (var s = File.OpenRead(prod.Location))
            using (var sha = SHA256.Create())
                ProductSha = BitConverter.ToString(sha.ComputeHash(s)).Replace("-", "").ToLowerInvariant();
            r.Add("product.loaded", "PASS", ProductDll + " · " + ProductVersion + " · sha256 " + ProductSha);
            R.Facts["product_dll"] = ProductDll;
            R.Facts["product_sha256"] = ProductSha;
            R.Facts["product_file_version"] = ProductVersion;

            const string target = "RevitMcpAddin.WallElevation.WallElevationCommand";
            string tab = Environment.GetEnvironmentVariable("MGL_RIBBON_TAB");
            if (string.IsNullOrWhiteSpace(tab)) tab = "MGL";
            List<RibbonPanel> panels;
            try { panels = app.GetRibbonPanels(tab); }
            catch (Exception ex) { r.Add("command.ribbon", "BLOCKED", "«" + tab + "» tab алга: " + ex.Message); return; }
            // W09: «Интерьер» товч (заавал биш — олдохгүй бол зөвхөн тэр сценари BLOCKED).
            string interior = FindCommand(panels, tab, "RevitMcpAddin.WallElevation.WallElevationInteriorCommand");
            if (interior != null)
            {
                CmdInteriorName = interior;
                try { CmdInterior = RevitCommandId.LookupCommandId(interior); } catch { CmdInterior = null; }
            }
            r.Info("command.ribbon.interior", interior == null ? "«Интерьер» товч алга" : interior + (CmdInterior != null ? "" : " — LookupCommandId null"));
            string feedback = FindCommand(panels, tab, "RevitMcpAddin.Feedback.FeedbackCommand");
            if (feedback != null)
            {
                CmdFeedbackName = feedback;
                try { CmdFeedback = RevitCommandId.LookupCommandId(feedback); } catch { CmdFeedback = null; }
            }
            r.Info("command.ribbon.feedback", feedback == null ? "«Санал хүсэлт» товч алга" : feedback + (CmdFeedback != null ? "" : " — LookupCommandId null"));
            string plain = FindCommand(panels, tab, target);
            if (plain != null) { Bind(r, plain); return; }
            r.Add("command.ribbon", "BLOCKED", "«Ханын дэлгээс» товч ribbon-оос олдсонгүй (" + panels.Count + " самбар)");
        }

        private static string FindCommand(List<RibbonPanel> panels, string tab, string target)
        {
            foreach (RibbonPanel p in panels)
                foreach (RibbonItem it in p.GetItems())
                {
                    var pb = it as PushButton;
                    if (pb != null && pb.ClassName == target) return "CustomCtrl_%CustomCtrl_%" + tab + "%" + p.Name + "%" + pb.Name;
                    var pd = it as PulldownButton;
                    if (pd != null)
                        foreach (PushButton sub in pd.GetItems().OfType<PushButton>())
                            if (sub.ClassName == target) return "CustomCtrl_%CustomCtrl_%CustomCtrl_%" + tab + "%" + p.Name + "%" + pd.Name + "%" + sub.Name;
                    var sb = it as SplitButton;
                    if (sb != null)
                        foreach (PushButton sub in sb.GetItems().OfType<PushButton>())
                            if (sub.ClassName == target) return "CustomCtrl_%CustomCtrl_%CustomCtrl_%" + tab + "%" + p.Name + "%" + sb.Name + "%" + sub.Name;
                }
            return null;
        }

        private void Bind(ScenarioResult r, string id)
        {
            CmdName = id;
            try { Cmd = RevitCommandId.LookupCommandId(id); } catch { Cmd = null; }
            r.Add("command.ribbon", Cmd != null ? "PASS" : "BLOCKED", id + (Cmd != null ? "" : " — LookupCommandId null"));
        }

        private static string FileVersionOf(string path)
        {
            try { return System.Diagnostics.FileVersionInfo.GetVersionInfo(path).FileVersion; } catch { return "?"; }
        }

        // ── Тохиргоо (production-ийн prefs файл — хэрэглэгч цонхонд сонгодогтой ижил оролт) ─────

        public void BackupPrefs()
        {
            if (PrefsBackup != null) return;
            PrefsBackup = Path.Combine(R.Job.RunDir, "user-wall-elevations.json.bak");
            if (File.Exists(ProdPrefs)) File.Copy(ProdPrefs, PrefsBackup, true);
            else File.WriteAllText(PrefsBackup + ".absent", "");
        }

        public void WritePrefs(params string[] lines)
        {
            Directory.CreateDirectory(ProdDir);
            File.WriteAllLines(ProdPrefs, lines, new UTF8Encoding(false));
        }

        public void RestorePrefs()
        {
            if (PrefsBackup == null) return;
            if (File.Exists(PrefsBackup)) File.Copy(PrefsBackup, ProdPrefs, true);
            else if (File.Exists(PrefsBackup + ".absent") && File.Exists(ProdPrefs)) File.Delete(ProdPrefs);
        }
    }

    /// <summary>Загварын геометрийн туслах: link-ийн өрөө, харагдацын хүрээ, дэлгэцийн координат.</summary>
    internal static class Geo
    {
        public sealed class LinkedRoom
        {
            public Room Room;
            public RevitLinkInstance Link;     // null = host өрөө
            public Transform Tf;
            public string Number { get { return Room.Number; } }
            public XYZ HostLocation { get { var lp = Room.Location as LocationPoint; return lp == null ? null : Tf.OfPoint(lp.Point); } }
            public double LevelZ { get { return Room.Level != null ? Room.Level.Elevation + Tf.Origin.Z : Tf.Origin.Z; } }
            public bool Contains(XYZ hostPoint) { return Room.IsPointInRoom(Tf.Inverse.OfPoint(hostPoint)); }
        }

        public static LinkedRoom FindRoom(Document doc, string linkName, string number)
        {
            if (linkName == null)
            {
                Room r = new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Rooms).Cast<Room>().FirstOrDefault(x => x.Number == number);
                return r == null ? null : new LinkedRoom { Room = r, Tf = Transform.Identity };
            }
            foreach (RevitLinkInstance li in new FilteredElementCollector(doc).OfClass(typeof(RevitLinkInstance)).Cast<RevitLinkInstance>())
            {
                if (li.Id.Value.ToString(CultureInfo.InvariantCulture) != linkName && li.Name.IndexOf(linkName, StringComparison.OrdinalIgnoreCase) < 0) continue;
                Document ld = li.GetLinkDocument();
                if (ld == null) continue;
                Room r = new FilteredElementCollector(ld).OfCategory(BuiltInCategory.OST_Rooms).Cast<Room>().FirstOrDefault(x => x.Number == number);
                if (r != null) return new LinkedRoom { Room = r, Link = li, Tf = li.GetTotalTransform() };
            }
            return null;
        }

        public static RoomTag TagOf(Document doc, ViewPlan plan, LinkedRoom lr)
        {
            // ХЭМЖСЭН (2026-10-13): FilteredElementCollector(doc, plan.Id) нь crop-оос ГАДУУРХ tag-ийг буцаадаггүй (link B 60 м зайтай) — OwnerViewId-аар.
            foreach (RoomTag t in new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_RoomTags).WhereElementIsNotElementType().OfType<RoomTag>()
                         .Where(x => x.OwnerViewId == plan.Id))
            {
                LinkElementId lid = t.TaggedRoomId;
                if (lid == null) continue;
                if (lr.Link == null ? (lid.HostElementId == lr.Room.Id) : (lid.LinkInstanceId == lr.Link.Id && lid.LinkedElementId == lr.Room.Id)) return t;
            }
            return null;
        }

        /// <summary>Харагдацын crop-ийн 8 оройг дэлхийн координатаар.</summary>
        public static List<XYZ> CropCorners(View v)
        {
            BoundingBoxXYZ cb = v.CropBox;
            var list = new List<XYZ>();
            foreach (double x in new[] { cb.Min.X, cb.Max.X })
                foreach (double y in new[] { cb.Min.Y, cb.Max.Y })
                    foreach (double z in new[] { cb.Min.Z, cb.Max.Z })
                        list.Add(cb.Transform.OfPoint(new XYZ(x, y, z)));
            return list;
        }

        /// <summary>Дэлгэцийн пиксел (UIView-ийн цонх + zoom corners) — зөвхөн хэвтээ план/хуудсанд.</summary>
        public static bool ToScreen(UIDocument uidoc, View view, XYZ p, out double sx, out double sy)
        {
            sx = sy = 0;
            UIView uv = uidoc.GetOpenUIViews().FirstOrDefault(x => x.ViewId == view.Id);
            if (uv == null) return false;
            Rectangle r = uv.GetWindowRectangle();
            IList<XYZ> zc = uv.GetZoomCorners();
            if (zc == null || zc.Count < 2) return false;
            XYZ a = zc[0], b = zc[1];
            // Хэвтээ (план, хуудас) — харагдацын баруун = +X, дээш = +Y гэж үзнэ (энэ тестийн план, хуудас эргээгүй).
            double fx = (p.X - a.X) / (b.X - a.X), fy = (p.Y - a.Y) / (b.Y - a.Y);
            sx = r.Left + fx * (r.Right - r.Left);
            sy = r.Bottom - fy * (r.Bottom - r.Top);
            return fx > 0.02 && fx < 0.98 && fy > 0.02 && fy < 0.98;
        }

        public static string S(double v) { return v.ToString("0", CultureInfo.InvariantCulture); }
    }
}
