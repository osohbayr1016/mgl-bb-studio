using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Automation;

namespace MglWeGateDriver
{
    /// <summary>
    /// GUI driver.  Ажлын протокол (файлаар, add-in ↔ driver):
    ///   run\driver\cmd-NNN.txt  — gate бичнэ; мөр бүр нэг алхам (доор)
    ///   run\driver\ack-NNN.txt  — driver бичнэ; алхам бүрийн үр дүн, эцэст «DONE ok» / «DONE fail …»
    /// Алхмууд:
    ///   wait   &lt;title-regex&gt; &lt;sec&gt;              — Revit-ийн top-level цонх гарахыг хүлээнэ
    ///   gone   &lt;title-regex&gt; &lt;sec&gt;              — цонх хаагдахыг хүлээнэ
    ///   invoke &lt;title-regex&gt; &lt;name-regex&gt; &lt;sec&gt; — цонхны доторх товч/холбоосыг дарна (UIA Invoke)
    ///   click x y | dblclick x y                  — дэлгэцийн пиксел (DPI-aware)
    ///   key ESCAPE|RETURN|…                       — товчлуур
    ///   sleep ms · shot name · dump &lt;title-regex&gt;
    /// Үргэлж: Revit-ийн «Unsigned Add-In» асуултад «Always Load»; шинэ, танихгүй цонх бүрийг товч, нэр, screenshot-тай логлоно.
    /// </summary>
    public static class Program
    {
        private static string _dir, _log, _journalDir, _journalPath;
        private static long _journalPos;
        /// <summary>Journal-ын сүүлийн 'E/'C/'H цаг — уншлага хооронд хадгална (мөр хоёр уншлагад хуваагдаж болно).</summary>
        private static DateTime _journalStamp = DateTime.MinValue;
        private static int _pid;
        private static readonly DateTime Started = DateTime.Now;
        private static readonly HashSet<string> SeenWindows = new HashSet<string>(StringComparer.Ordinal);
        /// <summary>Driver-ийн ӨӨРИЙН гараас/хулганаас оруулсан агшнууд — journal дахь оролт бидний биш эсэхийг ялгахад.</summary>
        private static readonly List<DateTime> Injected = new List<DateTime>();
        private static bool _escapePending;
        /// <summary>Хэрэглэгчийн сүүлийн (Revit БИШ) foreground цонх — тестийн Revit focus авбал энэ рүү буцаана.</summary>
        private static IntPtr _lastUserFg = IntPtr.Zero;
        private static volatile bool _injecting;
        private static DateTime _lastFocusRestore = DateTime.MinValue;

        [DllImport("user32.dll")] private static extern bool GetLastInputInfo(ref LASTINPUTINFO li);
        [StructLayout(LayoutKind.Sequential)] private struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
        [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] private static extern bool GetCursorPos(out POINT p);
        [StructLayout(LayoutKind.Sequential)] private struct POINT { public int X, Y; }
        [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(POINT p);
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
        [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint a, uint b, bool attach);
        [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
        [DllImport("user32.dll")] private static extern bool BringWindowToTop(IntPtr h);
        [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr h, int cmd);
        [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr h);

        [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);
        [DllImport("user32.dll")] private static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
        [DllImport("user32.dll")] private static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
        [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr h, uint cmd);
        [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] private static extern IntPtr GetWindowLongPtr(IntPtr h, int index);
        [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr h);
        [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr h, uint flags);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
        [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
        private const uint LDOWN = 0x02, LUP = 0x04, KEYUP = 0x02, GA_ROOT = 2, WM_CLOSE = 0x0010;
        /// <summary>Товших цэгийг халхалбал хааж болох МАНАЙ хөвөгч цонх (W06 үр дүнгийн хөтөч — загварт нөлөөгүй).</summary>
        private const string ResultBrowserTitle = "MGL — Ханын дэлгээсийн үр дүн";

        public static int Main(string[] args)
        {
            for (int i = 0; i + 1 < args.Length; i++)
            {
                if (args[i] == "--pid") _pid = int.Parse(args[i + 1], CultureInfo.InvariantCulture);
                if (args[i] == "--dir") _dir = args[i + 1];
                if (args[i] == "--journal-dir") _journalDir = args[i + 1];
            }
            if (_pid == 0 || _dir == null) { Console.Error.WriteLine("usage: --pid <revit pid> --dir <run\\driver>"); return 2; }
            Directory.CreateDirectory(_dir);
            _log = Path.Combine(_dir, "driver.log");
            Log("start pid=" + _pid);
            // Focus хамгаалалт ТУСДАА thread-д (0.3 с) — скрипт ажиллаж байх хооронд ч (Revit-ийн харилцах цонх гарахдаа focus-ийг ӨӨРӨӨ
            // авдаг; 2026-10-13: хэрэглэгчийн «… Enter» тестийн Revit-д орж сүүлийн командыг давтуулж run-ийг гацаасан).  Зөвхөн driver өөрөө
            // дарж/товчлуур илгээх агшинд (_injecting) түр зогсоно.
            var guard = new Thread(() =>
            {
                while (true)
                {
                    try { if (!_injecting) KeepFocusOffRevit(); } catch { }
                    Thread.Sleep(300);
                }
            }) { IsBackground = true };
            guard.Start();
            int next = 1;
            while (true)
            {
                Process p = null;
                try { p = Process.GetProcessById(_pid); } catch { p = null; }
                if (p == null || p.HasExited) { Log("Revit гарсан — driver зогсов"); return 0; }
                if (File.Exists(Path.Combine(_dir, "STOP"))) { Log("STOP"); return 0; }
                try { Watch(); } catch (Exception ex) { Log("watch алдаа: " + ex.Message); }
                try { CheckJournal(); } catch (Exception ex) { Log("journal алдаа: " + ex.Message); }
                string esc = Path.Combine(_dir, "ESCAPE");
                if (File.Exists(esc)) { try { File.Delete(esc); } catch { } _escapePending = true; Log("ESCAPE хүсэлт (launcher — gate ахиц гаргахгүй байна)"); }
                if (_escapePending) { try { if (EscapeRevit()) _escapePending = false; } catch (Exception ex) { Log("escape алдаа: " + ex.Message); } }
                string cmd = Path.Combine(_dir, "cmd-" + next.ToString("000", CultureInfo.InvariantCulture) + ".txt");
                if (File.Exists(cmd))
                {
                    Thread.Sleep(150);   // gate бичиж дуусах
                    // «busy» — скрипт ажиллаж байх хооронд (хэрэглэгч сул болохыг хүлээх, PickObjects) gate-ийн чимээгүй байдал хэвийн:
                    // launcher энэ үед ESC/abort хийхгүй.  Скриптийн үеэр ирсэн ESCAPE хүсэлт хуучирсан тул устгана.
                    string busy = Path.Combine(_dir, "busy");
                    File.WriteAllText(busy, next.ToString(CultureInfo.InvariantCulture));
                    try { Run(next, File.ReadAllLines(cmd, Encoding.UTF8)); }
                    finally
                    {
                        try { File.Delete(busy); } catch { }
                        try { File.Delete(Path.Combine(_dir, "ESCAPE")); } catch { }
                    }
                    next++;
                }
                Thread.Sleep(200);
            }
        }

        // ── Үргэлжийн ажиглалт ─────────────────────────────────────

        /// <summary>Revit процессын desktop-ийн шууд хүүхэд цонхнууд (UIA).</summary>
        private static List<AutomationElement> TopLevel()
        {
            var cond = new PropertyCondition(AutomationElement.ProcessIdProperty, _pid);
            return AutomationElement.RootElement.FindAll(TreeScope.Children, cond).Cast<AutomationElement>().ToList();
        }

        /// <summary>
        /// Харилцах цонхнууд = Revit-ийн ҮНДСЭН цонхноос бусад бүх цонх.  ХЭМЖСЭН (Revit 2024, 2026-10-13): (1) баримт нээгдсэний дараа үндсэн
        /// цонхны класс «Window» (Afx: биш); (2) owned цонх (production-ий preview — App.ShowOwned, Revit-ийн өөрийн харилцах цонх) UIA-д
        /// үндсэн цонхны ХҮҮХЭД болж харагддаг; (3) preview-ийн UIA нэр = үндсэн цонхны гарчиг.  Тиймээс ялгах цорын ганц найдвартай шинж =
        /// Win32 owner: үндсэн цонх owner-гүй, харилцах цонх owner-тэй.  Үндсэн цонхны доторх WS_CHILD цонх (view-ийн MDI цонх, залгасан
        /// самбар) харилцах цонх БИШ.
        /// </summary>
        private static List<AutomationElement> Dialogs()
        {
            var list = new List<AutomationElement>();
            var seen = new HashSet<IntPtr>();
            foreach (AutomationElement w in TopLevel())
            {
                IntPtr h = Hwnd(w);
                if (IsMain(w))
                {
                    AutomationElementCollection kids;
                    try { kids = w.FindAll(TreeScope.Children, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Window)); }
                    catch { continue; }
                    foreach (AutomationElement k in kids)
                    {
                        IntPtr kh = Hwnd(k);
                        if (kh == IntPtr.Zero || kh == h || !IsWindowVisible(kh)) continue;
                        if ((GetWindowLongPtr(kh, -16).ToInt64() & 0x40000000L) != 0) continue;   // WS_CHILD
                        if (seen.Add(kh)) list.Add(k);
                    }
                    continue;
                }
                if (h != IntPtr.Zero && !IsWindowVisible(h)) continue;
                if (seen.Add(h)) list.Add(w);
            }
            return list;
        }

        private static List<AutomationElement> Mains()
        {
            return TopLevel().Where(IsMain).ToList();
        }

        private static IntPtr Hwnd(AutomationElement w)
        {
            try { return new IntPtr(w.Current.NativeWindowHandle); } catch { return IntPtr.Zero; }
        }

        private static void Watch()
        {
            foreach (AutomationElement w in Mains().Concat(Dialogs()))
            {
                string name = SafeName(w);
                // ХЭМЖСЭН (Revit 2024, 2026-10-13): энэ цонхны гарчиг ХООСОН — агуулгаар нь таньна.
                if (Regex.IsMatch(name, "Unsigned Add-In|Security - ", RegexOptions.IgnoreCase)
                    || Descendants(w).Any(e => SafeName(e).IndexOf("publisher of this add-in could not be verified", StringComparison.OrdinalIgnoreCase) >= 0))
                {
                    if (TryInvoke(w, new Regex("^Always Load", RegexOptions.IgnoreCase))) Log("security: «" + name + "» → Always Load");
                    continue;
                }
                string key = name + "|" + w.Current.NativeWindowHandle;
                if (SeenWindows.Add(key))
                {
                    var names = Descendants(w).Where(e => e.Current.ControlType == ControlType.Button || e.Current.ControlType == ControlType.Text)
                                              .Select(SafeName).Where(n => n.Length > 0).Distinct().Take(25);
                    Log("window «" + name + "» class=" + w.Current.ClassName + " : " + string.Join(" | ", names));
                    Shot("win-" + Clean(name), w);
                }
            }
        }

        // ── Скрипт ─────────────────────────────────────────────────

        private static void Run(int n, string[] lines)
        {
            var ack = new StringBuilder();
            bool ok = true;
            // «finally …» мөрүүд скрипт унасан ч ҮРГЭЛЖ ажиллана — production-ий modal цонх нээлттэй үлдвэл Revit гацна.
            var main = lines.Where(l => !l.TrimStart().StartsWith("finally ", StringComparison.OrdinalIgnoreCase)).ToList();
            var fin = lines.Where(l => l.TrimStart().StartsWith("finally ", StringComparison.OrdinalIgnoreCase))
                           .Select(l => "try-" + l.TrimStart().Substring(8)).ToList();
            foreach (string raw in main.Concat(new[] { "#--finally" }).Concat(fin))
            {
                string line = raw.Trim();
                if (line == "#--finally") { if (fin.Count > 0) ack.AppendLine("-- finally --"); continue; }
                if (line.Length == 0 || line.StartsWith("#")) continue;
                if (!ok && !line.StartsWith("try-", StringComparison.OrdinalIgnoreCase)) continue;
                string res;
                // «try-» угтвар — алхам унавал ч скрипт үргэлжилнэ (заавал биш алхам: гарч болох/болохгүй цонх).
                bool optional = line.StartsWith("try-", StringComparison.OrdinalIgnoreCase);
                try { res = Step(optional ? line.Substring(4) : line); }
                catch (Exception ex) { res = "FAIL " + ex.Message; }
                if (optional && res.StartsWith("FAIL")) res = "skip (" + res + ")";
                Log("[" + n + "] " + line + " → " + res);
                ack.AppendLine(line + " → " + res);
                if (res.StartsWith("FAIL")) ok = false;
            }
            ack.AppendLine(ok ? "DONE ok" : "DONE fail");
            File.WriteAllText(Path.Combine(_dir, "ack-" + n.ToString("000", CultureInfo.InvariantCulture) + ".txt"), ack.ToString(), new UTF8Encoding(false));
        }

        private static string Step(string line)
        {
            List<string> a = Split(line);
            switch (a[0].ToLowerInvariant())
            {
                case "wait":
                {
                    AutomationElement w = WaitWindow(a[1], Sec(a, 2));
                    return w != null ? "ok «" + SafeName(w) + "»" : "FAIL цонх гарсангүй: " + a[1];
                }
                case "waitname":
                {
                    // waitname <title-regex> <name-regex> [sec] — цонхонд нэр нь таарах элемент гартал (урьдчилсан зураг Revit-ээр үүсэх хүртэл).
                    DateTime until = DateTime.Now.AddSeconds(Sec(a, 3));
                    var name = new Regex(a[2], RegexOptions.IgnoreCase);
                    while (DateTime.Now < until)
                    {
                        AutomationElement w = WaitWindow(a[1], 0.5);
                        if (w != null)
                        {
                            AutomationElement hit = Descendants(w).FirstOrDefault(e => name.IsMatch(SafeName(e)));
                            if (hit != null) return "ok «" + SafeName(hit) + "»";
                        }
                        Thread.Sleep(300);
                    }
                    return "FAIL «" + a[2] + "» гарсангүй «" + a[1] + "» цонхонд";
                }
                case "gone":
                {
                    DateTime until = DateTime.Now.AddSeconds(Sec(a, 2));
                    var re = new Regex(a[1], RegexOptions.IgnoreCase);
                    while (DateTime.Now < until)
                    {
                        if (!Candidates(a[1]).Any(w => Matches(w, re))) return "ok";
                        Thread.Sleep(200);
                    }
                    return "FAIL цонх хаагдсангүй: " + a[1];
                }
                case "invoke":
                {
                    DateTime until = DateTime.Now.AddSeconds(Sec(a, 3));
                    var name = new Regex(a[2], RegexOptions.IgnoreCase);
                    while (DateTime.Now < until)
                    {
                        AutomationElement w = WaitWindow(a[1], 0.5);
                        if (w != null && TryInvoke(w, name)) return "ok";
                        Thread.Sleep(250);
                    }
                    return "FAIL «" + a[2] + "» олдсонгүй «" + a[1] + "» цонхонд";
                }
                case "click":
                case "dblclick":
                {
                    int x = (int)Math.Round(double.Parse(a[1], CultureInfo.InvariantCulture)), y = (int)Math.Round(double.Parse(a[2], CultureInfo.InvariantCulture));
                    string idle = WaitUserIdle(4000, 600);
                    if (idle != null) return "FAIL " + idle;
                    IntPtr prevFg = GetForegroundWindow();
                    POINT prevCur; GetCursorPos(out prevCur);
                    _injecting = true;
                    try
                    {
                    // ХАМГААЛАЛТ (2026-10-13): Revit бусад цонхны АРД байхад дэлгэцийн координатаар дарвал хэрэглэгчийн цонх руу орно.  Тэр цэг
                    // дээрх цонх Revit-ийн процессынх биш бол ДАРАХГҮЙ.  2026-10-14: хэрэглэгчийн өөр Revit урд байвал хэд хэдэн удаа (≈ 20 с)
                    // тестийн Revit-ийг урд гаргахыг оролдоно — хэзээ ч хэрэглэгчийн цонх руу дарахгүй.
                    uint owner = 0;
                    string covered = null;
                    for (int attempt = 0; attempt < 10; attempt++)
                    {
                        if (attempt > 0) { Thread.Sleep(2000); if (WaitUserIdle(4000, 600) != null) continue; }
                        if (!BringRevitToFront()) continue;
                        Thread.Sleep(250);
                        GetWindowThreadProcessId(WindowFromPoint(new POINT { X = x, Y = y }), out owner);
                        if (owner != (uint)_pid) continue;
                        covered = CoveringRevitWindow(x, y);
                        if (covered == null) break;
                        owner = 0;
                    }
                    if (covered != null) { Restore(prevFg, prevCur); return "FAIL (" + x + "," + y + ") цэгийг Revit-ийн өөр цонх «" + covered + "» халхалсан — дарсангүй"; }
                    if (owner != (uint)_pid) { Restore(prevFg, prevCur); return "FAIL (" + x + "," + y + ") дээр Revit биш цонх (pid " + owner + ") — дарсангүй"; }
                    SetCursorPos(x, y);
                    Thread.Sleep(120);
                    int times = a[0] == "dblclick" ? 2 : 1;
                    for (int i = 0; i < times; i++)
                    {
                        Injected.Add(DateTime.Now);
                        mouse_event(LDOWN, 0, 0, 0, UIntPtr.Zero);
                        Thread.Sleep(40);
                        mouse_event(LUP, 0, 0, 0, UIntPtr.Zero);
                        Thread.Sleep(90);
                    }
                    Thread.Sleep(200);
                    Restore(prevFg, prevCur);
                    return "ok";
                    }
                    finally { _injecting = false; }
                }
                case "hover":
                {
                    // 1.40.0: курсорыг цэг дээр аваачиж <ms> хүлээгээд зураг авна (дарахгүй) — курсор доорх өрөөний тодруулга.
                    int x = (int)Math.Round(double.Parse(a[1], CultureInfo.InvariantCulture)), y = (int)Math.Round(double.Parse(a[2], CultureInfo.InvariantCulture));
                    int ms = a.Count > 3 ? int.Parse(a[3], CultureInfo.InvariantCulture) : 1500;
                    string idle = WaitUserIdle(4000, 600);
                    if (idle != null) return "FAIL " + idle;
                    IntPtr prevFg = GetForegroundWindow();
                    POINT prevCur; GetCursorPos(out prevCur);
                    _injecting = true;
                    try
                    {
                        if (!BringRevitToFront()) return "FAIL Revit-ийг урд гаргаж чадсангүй";
                        Thread.Sleep(250);
                        uint owner; GetWindowThreadProcessId(WindowFromPoint(new POINT { X = x, Y = y }), out owner);
                        if (owner != (uint)_pid) { Restore(prevFg, prevCur); return "FAIL (" + x + "," + y + ") дээр Revit биш цонх"; }
                        string covered = CoveringRevitWindow(x, y);
                        if (covered != null) { Restore(prevFg, prevCur); return "FAIL (" + x + "," + y + ") цэгийг Revit-ийн өөр цонх «" + covered + "» халхалсан"; }
                        // Хоёр алхмаар ойртуулна (бодит хулгана шиг) — таймер хөдөлгөөнийг барина.
                        SetCursorPos(x - 40, y - 30);
                        Thread.Sleep(200);
                        SetCursorPos(x, y);
                        Thread.Sleep(ms);
                        if (a.Count > 4) Shot(a[4]);
                        Restore(prevFg, prevCur);
                        return "ok";
                    }
                    finally { _injecting = false; }
                }
                case "key":
                {
                    string idle = WaitUserIdle(4000, 600);
                    if (idle != null) return "FAIL " + idle;
                    IntPtr prevFg = GetForegroundWindow();
                    POINT prevCur; GetCursorPos(out prevCur);
                    _injecting = true;
                    try
                    {
                    if (!BringRevitToFront()) return "FAIL Revit-ийг урд гаргаж чадсангүй";
                    byte vk = Vk(a[1]);
                    Injected.Add(DateTime.Now);
                    keybd_event(vk, 0, 0, UIntPtr.Zero);
                    Thread.Sleep(40);
                    keybd_event(vk, 0, KEYUP, UIntPtr.Zero);
                    Thread.Sleep(150);
                    Restore(prevFg, prevCur);
                    return "ok";
                    }
                    finally { _injecting = false; }
                }
                case "focus":
                {
                    AutomationElement w = WaitWindow(a[1], Sec(a, 2));
                    if (w == null) return "FAIL цонх алга";
                    SetForegroundWindow(new IntPtr(w.Current.NativeWindowHandle));
                    return "ok";
                }
                case "setvalue":
                {
                    // setvalue <title-regex> <name-regex> <text> [sec] — UIA ValuePattern (хайлтын талбар, засварлах жагсаалт); гар/хулгана ОРОЛДОХГҮЙ.
                    DateTime until = DateTime.Now.AddSeconds(Sec(a, 4));
                    var name = new Regex(a[2], RegexOptions.IgnoreCase);
                    while (DateTime.Now < until)
                    {
                        AutomationElement w = WaitWindow(a[1], 0.5);
                        if (w != null)
                            foreach (AutomationElement e in Descendants(w))
                            {
                                if (!name.IsMatch(SafeName(e))) continue;
                                object pat;
                                try
                                {
                                    if (!e.Current.IsEnabled || !e.TryGetCurrentPattern(ValuePattern.Pattern, out pat)) continue;
                                    ((ValuePattern)pat).SetValue(a[3]);
                                    return "ok «" + SafeName(e) + "» = «" + a[3] + "»";
                                }
                                catch (Exception ex) { return "FAIL «" + SafeName(e) + "»: " + ex.Message; }
                            }
                        Thread.Sleep(250);
                    }
                    return "FAIL «" + a[2] + "» (ValuePattern) олдсонгүй «" + a[1] + "» цонхонд";
                }
                case "sleep": Thread.Sleep(int.Parse(a[1], CultureInfo.InvariantCulture)); return "ok";
                case "shot": Shot(a[1]); return "ok";
                case "dump":
                {
                    // dump <title-regex> <файлын нэр> [sec] — цонхны бүх элементийн нэр (gate preview-д аль өрөө гарсныг эндээс уншина)
                    AutomationElement w = WaitWindow(a[1], Sec(a, 3));
                    if (w == null) return "FAIL цонх алга";
                    var sb = new StringBuilder();
                    sb.AppendLine("WINDOW «" + SafeName(w) + "»");
                    foreach (AutomationElement e in Descendants(w))
                    {
                        // Засах талбарын агуулга (ж: «Санал хүсэлт»-ийн оношилгоо) — нэр нь хоосон тул ValuePattern-ээс (≤ 8000 тэмдэгт, нэг мөрөөр).
                        string val = string.Empty;
                        object vp;
                        if (e.Current.ControlType == ControlType.Edit && e.TryGetCurrentPattern(ValuePattern.Pattern, out vp))
                        {
                            string v = ((ValuePattern)vp).Current.Value ?? string.Empty;
                            if (v.Length > 8000) v = v.Substring(0, 8000) + "…";
                            if (v.Length > 0) val = " value=«" + v.Replace("\r", "").Replace("\n", " ⏎ ") + "»";
                        }
                        sb.AppendLine(e.Current.ControlType.ProgrammaticName + " «" + SafeName(e) + "» id=" + e.Current.AutomationId + (e.Current.IsEnabled ? "" : " [disabled]") + val);
                    }
                    File.WriteAllText(Path.Combine(_dir, "dump-" + Clean(a.Count > 2 ? a[2] : a[1]) + ".txt"), sb.ToString(), new UTF8Encoding(false));
                    Shot("dump-" + Clean(a.Count > 2 ? a[2] : a[1]), w);
                    return "ok";
                }
                case "dismiss":
                {
                    // dismiss <title-regex> [sec] — Болих / Close / Cancel / OK, эс бөгөөс ESC.  Цонх байхгүй бол ok (аль хэдийн хаагдсан).
                    AutomationElement w = WaitWindow(a[1], Sec(a, 2));
                    if (w == null) return "ok (цонх алга)";
                    if (TryInvoke(w, new Regex("^(Болих|Хаах|Close|Cancel|OK)$", RegexOptions.IgnoreCase))) return "ok (товч)";
                    if (WaitUserIdle(3000, 120) != null) return "FAIL хэрэглэгч идэвхтэй — ESC илгээсэнгүй";
                    IntPtr prevFg = GetForegroundWindow();
                    POINT prevCur; GetCursorPos(out prevCur);
                    _injecting = true;
                    try
                    {
                        SetForegroundWindowForced(new IntPtr(w.Current.NativeWindowHandle));
                        Thread.Sleep(150);
                        Injected.Add(DateTime.Now);
                        keybd_event(0x1B, 0, 0, UIntPtr.Zero); Thread.Sleep(40); keybd_event(0x1B, 0, KEYUP, UIntPtr.Zero);
                        Thread.Sleep(150);
                        Restore(prevFg, prevCur);
                    }
                    finally { _injecting = false; }
                    return "ok (ESC)";
                }
                default: return "FAIL танихгүй алхам " + a[0];
            }
        }

        // ── Хэрэглэгчийг хамгаалах ─────────────────────────────────

        /// <summary>
        /// Хэрэглэгч гар/хулгана ≥ <paramref name="idleMs"/> хөдөлгөөгүй болтол хүлээнэ (бидний өөрсдийн оролт тооцогдохгүй).  ХЭМЖСЭН (2026-10-13):
        /// хэрэглэгч VS Code-д бичиж байх хооронд тестийн Revit focus-тэй үлдэж, «DI» товчлол Dimension хэрэгсэл асааж бүх run-ийг гацаасан.
        /// </summary>
        private static string WaitUserIdle(int idleMs, int maxSec)
        {
            DateTime until = DateTime.Now.AddSeconds(maxSec);
            bool logged = false;
            while (DateTime.Now < until)
            {
                var li = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO)) };
                GetLastInputInfo(ref li);
                long idle = unchecked((uint)Environment.TickCount - li.dwTime);
                DateTime lastInput = DateTime.Now.AddMilliseconds(-idle);
                bool ours = Injected.Any(t => Math.Abs((lastInput - t).TotalMilliseconds) < 1500);
                if (idle >= idleMs || ours) { if (logged) Log("хэрэглэгч сул болов — үргэлжлүүлнэ"); return null; }
                if (!logged) { Log("хэрэглэгч гар/хулгана ашиглаж байна — сул болтол хүлээнэ (" + idleMs + " мс)"); logged = true; }
                Thread.Sleep(500);
            }
            return "хэрэглэгч " + maxSec + " с турш идэвхтэй байсан — оролт илгээсэнгүй";
        }

        private static IntPtr RevitMain()
        {
            // ⚠️ Process.MainWindowHandle ХЭРЭГЛЭХГҮЙ — modal харилцах цонх нээлттэй үед тэр нь харилцах цонхыг заадаг (2026-10-13).
            foreach (AutomationElement w in Mains())
            {
                IntPtr h = Hwnd(w);
                if (h != IntPtr.Zero) return h;
            }
            return IntPtr.Zero;
        }

        private static bool BringRevitToFront()
        {
            IntPtr h = RevitMain();
            if (h == IntPtr.Zero) return false;
            if (IsIconic(h)) ShowWindow(h, 9);
            SetForegroundWindowForced(h);
            Thread.Sleep(150);
            uint fgPid;
            GetWindowThreadProcessId(GetForegroundWindow(), out fgPid);
            return fgPid == (uint)_pid;
        }

        /// <summary>
        /// Цэг дээрх цонх Revit-ийн процессынх ч ҮНДСЭН цонхных биш (Revit-ийн эзэмшсэн өөр дээд цонх) бол түүний гарчиг, үгүй бол null.
        /// ХЭМЖСЭН (live gate 2026-10-16, SEL-HOST-EMPTY-101): W06-ийн үр дүнгийн хөтөч хадгалсан байрлалдаа зургийн талбайг халхалж, товшилт
        /// тэр цонх руу орсон («ok» гэж мэдэгдсэн) — pick хэрэгсэл хүлээсээр gate 5 мин гацаж, бүх run зогссон.  Манай үр дүнгийн хөтөч бол
        /// (загварт нөлөөгүй) хаагаад дахин шалгана; бусад цонхонд хэзээ ч дарахгүй.
        /// </summary>
        private static string CoveringRevitWindow(int x, int y)
        {
            for (int i = 0; i < 3; i++)
            {
                IntPtr hit = WindowFromPoint(new POINT { X = x, Y = y });
                IntPtr root = hit == IntPtr.Zero ? IntPtr.Zero : GetAncestor(hit, GA_ROOT);
                IntPtr main = RevitMain();
                if (root == IntPtr.Zero || main == IntPtr.Zero || root == main) return null;
                var sb = new StringBuilder(256);
                GetWindowText(root, sb, sb.Capacity);
                string title = sb.ToString();
                if (!string.Equals(title, ResultBrowserTitle, StringComparison.Ordinal)) return title.Length > 0 ? title : "(гарчиггүй)";
                PostMessage(root, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
                Log("click: цэгийг «" + title + "» халхалсан — хаав (дахин шалгана)");
                Thread.Sleep(500);
            }
            return ResultBrowserTitle;
        }

        /// <summary>Foreground lock-ийг тойрох стандарт арга: одоогийн foreground thread-ийн input-д түр холбогдож SetForegroundWindow.</summary>
        private static void SetForegroundWindowForced(IntPtr h)
        {
            IntPtr fg = GetForegroundWindow();
            uint dummy;
            uint fgThread = GetWindowThreadProcessId(fg, out dummy), me = GetCurrentThreadId();
            bool attached = fgThread != 0 && fgThread != me && AttachThreadInput(me, fgThread, true);
            BringWindowToTop(h);
            SetForegroundWindow(h);
            if (attached) AttachThreadInput(me, fgThread, false);
        }

        /// <summary>Хэрэглэгчийн өмнөх цонх, курсорыг буцаана — бидний click-ийн дараа хэрэглэгчийн бичвэр Revit руу орохгүй.</summary>
        private static void Restore(IntPtr prevFg, POINT prevCur)
        {
            uint owner = 0;
            if (prevFg != IntPtr.Zero) GetWindowThreadProcessId(prevFg, out owner);
            if (prevFg != IntPtr.Zero && owner != (uint)_pid) SetForegroundWindowForced(prevFg);
            SetCursorPos(prevCur.X, prevCur.Y);
        }

        // ⚠️ Journal-ын мөр ХОЁР зайгаар эхэлдэг («  'E 16-Oct-2026 16:38:58.046;») — `^'` хэзээ ч таардаггүй байсан тул цаг нь УНШСАН агшин
        // болж, Revit journal-ыг 4–38 с хойшлуулж бичихэд driver-ийн ӨӨРИЙН товшилт «хүнийх» гэж бүртгэгдэв (live 2026-10-16, run 2).
        private static readonly Regex JournalStamp = new Regex(@"^\s*'[CEH] (\d{2}-\w{3}-\d{4} \d{2}:\d{2}:\d{2}\.\d{3})");

        /// <summary>
        /// Тестийн Revit-ийн journal-ыг дагана: бидний биш `KeyboardShortcut` / `Jrn.Key` = ХҮНИЙ оролт тестийн Revit-д орсон → interference.log +
        /// Revit-ийн хэрэгслийг ESC×2-оор цуцлах (харилцах цонх нээлттэй бол хийхгүй).  Gate тухайн сценарийг BLOCKED гэж бүртгэнэ.
        /// </summary>
        private static void CheckJournal()
        {
            if (string.IsNullOrEmpty(_journalDir) || !Directory.Exists(_journalDir)) return;
            if (_journalPath == null)
            {
                FileInfo f = new DirectoryInfo(_journalDir).GetFiles("journal.*.txt").Where(x => x.CreationTime >= Started.AddSeconds(-20))
                    .OrderByDescending(x => x.CreationTime).FirstOrDefault();
                if (f == null) return;
                _journalPath = f.FullName;
                Log("journal: " + _journalPath);
            }
            // ⚠️ StreamReader-ийг Dispose хийхэд FileStream хаагддаг — дараа нь fs.Length уншвал «Cannot access a closed file» (run 8-д journal-ын
            // ажиглалт бүхэлдээ үхсэн).  Байтаар уншиж, ЗӨВХӨН бүтэн мөрүүдийг (сүүлийн '\n' хүртэл) авна — хагас бичигдсэн мөр дараагийн удаад.
            string text;
            using (var fs = new FileStream(_journalPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            {
                long len = fs.Length;
                if (len <= _journalPos) return;
                fs.Seek(_journalPos, SeekOrigin.Begin);
                var buf = new byte[len - _journalPos];
                int got = 0, r;
                while (got < buf.Length && (r = fs.Read(buf, got, buf.Length - got)) > 0) got += r;
                if (got <= 0) return;
                int end = Array.LastIndexOf(buf, (byte)'\n', got - 1);
                if (end < 0) return;
                text = Encoding.UTF8.GetString(buf, 0, end + 1);
                _journalPos += end + 1;
            }
            DateTime stamp = _journalStamp == DateTime.MinValue ? DateTime.Now : _journalStamp;
            foreach (string line in text.Split('\n'))
            {
                Match m = JournalStamp.Match(line);
                if (m.Success)
                {
                    DateTime t;
                    if (DateTime.TryParseExact(m.Groups[1].Value, "dd-MMM-yyyy HH:mm:ss.fff", CultureInfo.InvariantCulture, DateTimeStyles.None, out t)) stamp = _journalStamp = t;
                    continue;
                }
                bool shortcut = line.IndexOf("Jrn.Command \"KeyboardShortcut\"", StringComparison.Ordinal) >= 0;
                string tl = line.TrimStart();
                // 2026-10-16 (2027 SEL-TAG-102): хүний ТОВШИЛТ тестийн Revit-ийн pick-ийг (driver-ийн товшилтоос 1.5 с ӨМНӨ, өөр цэгт) авч FAIL
                // болгосон — journal-д Jrn.LButtonDown.  Driver дугуй огт илгээдэггүй тул Jrn.Wheel = хүн (харагдацын томруулалтыг өөрчилнө).
                bool mouse = tl.StartsWith("Jrn.LButtonDown", StringComparison.Ordinal) || tl.StartsWith("Jrn.RButtonDown", StringComparison.Ordinal)
                             || tl.StartsWith("Jrn.MButtonDown", StringComparison.Ordinal) || tl.StartsWith("Jrn.Wheel", StringComparison.Ordinal);
                if (!shortcut && !mouse && !tl.StartsWith("Jrn.Key", StringComparison.Ordinal)) continue;
                // Товшилт: driver-ийн оруулгын ДАРАА −150…+1000 мс дотор л манайх (journal-ын цаг мс-ийн нарийвчлалтай; хүн driver-ээс 1.2 с ӨМНӨ
                // дарсныг 2 с-ийн цонх «манайх» гэж үзэх байв).  Дугуйг driver хэзээ ч илгээдэггүй.  Товчлуур: өмнөх ±2 с.
                bool wheel = tl.StartsWith("Jrn.Wheel", StringComparison.Ordinal);
                bool ours = wheel ? false
                    : mouse ? Injected.Any(t => { double d = (stamp - t).TotalMilliseconds; return d >= -150 && d <= 1000; })
                    : Injected.Any(t => Math.Abs((stamp - t).TotalMilliseconds) < 2000);
                if (ours) continue;
                string rec = stamp.ToString("HH:mm:ss.fff", CultureInfo.InvariantCulture) + " " + line.Trim();
                File.AppendAllText(Path.Combine(_dir, "interference.log"), rec + Environment.NewLine, new UTF8Encoding(false));
                Log("INTERFERENCE (хүний оролт тестийн Revit-д): " + rec);
                if (shortcut) _escapePending = true;
            }
        }

        /// <summary>
        /// Скрипт ажиллаагүй үед тестийн Revit keyboard focus-тэй бол хэрэглэгчийн сүүлийн цонх руу буцаана — хэрэглэгчийн бичвэр тестийн Revit-д
        /// орж товчлол асаахгүй (2026-10-13: «DI» → Dimension хэрэгсэл → run гацсан).  30 с-д нэгээс илүүгүй, логтой.
        /// </summary>
        private static void KeepFocusOffRevit()
        {
            IntPtr fg = GetForegroundWindow();
            if (fg == IntPtr.Zero) return;
            uint owner;
            GetWindowThreadProcessId(fg, out owner);
            if (owner != (uint)_pid)
            {
                if (owner != (uint)Process.GetCurrentProcess().Id) _lastUserFg = fg;
                return;
            }
            if (_lastUserFg == IntPtr.Zero) return;
            SetForegroundWindowForced(_lastUserFg);
            if ((DateTime.Now - _lastFocusRestore).TotalSeconds > 30) Log("focus: тестийн Revit keyboard focus авсан — хэрэглэгчийн цонх руу буцаав");
            _lastFocusRestore = DateTime.Now;
        }

        /// <summary>Revit-ийн идэвхтэй хэрэгслийг ESC×2-оор цуцлах — зөвхөн хэрэглэгч сул, харилцах цонх НЭЭЛТТЭЙ БИШ үед.</summary>
        private static bool EscapeRevit()
        {
            List<AutomationElement> dialogs = Dialogs();
            if (dialogs.Count > 0)
            {
                // Скрипт ажиллаагүй үеийн харилцах цонх = хүлээгдээгүй (хүний Enter-ээр командыг давтсан г.м.) — Cancel/Болих/Close-оор хаана.
                bool any = false;
                foreach (AutomationElement d in dialogs)
                    if (TryInvoke(d, new Regex("^(Cancel|Болих|Close|Хаах)$", RegexOptions.IgnoreCase))) { any = true; Log("escape: хүлээгдээгүй цонх «" + SafeName(d) + "» хаав"); }
                return any;
            }
            if (WaitUserIdle(3000, 1) != null) return false;
            IntPtr prevFg = GetForegroundWindow();
            POINT prevCur;
            GetCursorPos(out prevCur);
            if (!BringRevitToFront()) return false;
            for (int i = 0; i < 2; i++)
            {
                Injected.Add(DateTime.Now);
                keybd_event(0x1B, 0, 0, UIntPtr.Zero); Thread.Sleep(40); keybd_event(0x1B, 0, KEYUP, UIntPtr.Zero); Thread.Sleep(200);
            }
            Restore(prevFg, prevCur);
            Log("escape: Revit-д ESC×2 илгээв (хэрэгслийг цуцлав)");
            // ХЭМЖСЭН (2026-10-16): «Ханын дэлгээс»-ийн өрөө сонгох хэрэгсэлд ESC = «Бусад сонголт» харилцах цонх — хаахгүй бол Revit-ийн
            // API контекст эзлэгдсэн хэвээр gate 5 мин хүлээгээд бүх run-ийг зогсоосон.  ESC-ийн ДАРАА нээгдсэн цонхыг Cancel/Болих-оор хаана.
            DateTime until = DateTime.Now.AddSeconds(6);
            while (DateTime.Now < until)
            {
                Thread.Sleep(400);
                foreach (AutomationElement d in Dialogs())
                    if (TryInvoke(d, new Regex("^(Cancel|Болих|Close|Хаах)$", RegexOptions.IgnoreCase))) Log("escape: ESC-ийн дараах цонх «" + SafeName(d) + "» хаав");
            }
            return true;
        }

        private static AutomationElement WaitWindow(string titleRegex, double sec)
        {
            var re = new Regex(titleRegex, RegexOptions.IgnoreCase);
            DateTime until = DateTime.Now.AddSeconds(sec);
            do
            {
                AutomationElement w = Candidates(titleRegex).FirstOrDefault(x => Matches(x, re));
                if (w != null) return w;
                Thread.Sleep(200);
            } while (DateTime.Now < until);
            return null;
        }

        /// <summary>
        /// Гарчиг, эсвэл (үндсэн Revit цонхноос бусад) цонхны доторх бичвэр таарвал.  ХЭМЖСЭН (2026-10-13): production-ийн WPF preview нь
        /// өөрийн chrome-той тул UIA нэр ХООСОН — гарчгаар олдохгүй, доторх «Ханын дэлгээс» бичвэрээр олдоно.
        /// </summary>
        /// <summary>
        /// Аль цонхнуудаас хайх: «Autodesk Revit…» гэж эхэлсэн target = Revit-ийн ҮНДСЭН цонх (ribbon-ийн «Finish» г.м.), бусад бүх target
        /// = зөвхөн харилцах цонхнууд.  Үндсэн цонхыг бичвэрээр ХЭЗЭЭ Ч таахгүй — ribbon-д «Ханын дэлгээс» товч байдаг (run 8, 2026-10-13:
        /// `gone` үндсэн цонхыг preview гэж үзэж унасан, `dismiss` үндсэн цонх руу ESC илгээсэн).
        /// </summary>
        private static List<AutomationElement> Candidates(string titleRegex)
        {
            return titleRegex.StartsWith("Autodesk Revit", StringComparison.OrdinalIgnoreCase) ? Mains() : Dialogs();
        }

        /// <summary>Гарчиг, эсвэл цонхны доторх бичвэр таарвал.  Production-ий preview-ийн UIA нэр нь Revit-ийн гарчиг — доторх «MGL — Ханын дэлгээс» гарчгийн бичвэрээр олдоно.</summary>
        private static bool Matches(AutomationElement w, Regex re)
        {
            if (re.IsMatch(SafeName(w))) return true;
            if (IsMain(w)) return false;
            return Descendants(w).Any(e => re.IsMatch(SafeName(e)));
        }

        /// <summary>Revit-ийн үндсэн цонх: owner-гүй, «Afx:» класс (баримтгүй үед) эсвэл «Autodesk Revit» гэж эхэлсэн гарчиг (баримт нээгдсэн үед).</summary>
        private static bool IsMain(AutomationElement w)
        {
            IntPtr h = Hwnd(w);
            if (h == IntPtr.Zero || GetWindow(h, 4 /* GW_OWNER */) != IntPtr.Zero) return false;
            string cls;
            try { cls = w.Current.ClassName ?? string.Empty; } catch { return false; }
            return cls.StartsWith("Afx:", StringComparison.Ordinal) || SafeName(w).StartsWith("Autodesk Revit", StringComparison.OrdinalIgnoreCase);
        }

        private static bool TryInvoke(AutomationElement w, Regex name)
        {
            foreach (AutomationElement e in Descendants(w))
            {
                if (!name.IsMatch(SafeName(e))) continue;
                try { if (!e.Current.IsEnabled) continue; } catch { continue; }
                object pat;
                if (e.TryGetCurrentPattern(InvokePattern.Pattern, out pat)) { ((InvokePattern)pat).Invoke(); return true; }
                if (e.TryGetCurrentPattern(TogglePattern.Pattern, out pat)) { ((TogglePattern)pat).Toggle(); return true; }
                if (e.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pat)) { ((SelectionItemPattern)pat).Select(); return true; }
                if (e.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pat))
                {
                    var ec = (ExpandCollapsePattern)pat;
                    if (ec.Current.ExpandCollapseState == ExpandCollapseState.Collapsed) ec.Expand(); else ec.Collapse();
                    return true;
                }
            }
            return false;
        }

        private static IEnumerable<AutomationElement> Descendants(AutomationElement w)
        {
            AutomationElementCollection all;
            try { all = w.FindAll(TreeScope.Descendants, Condition.TrueCondition); }
            catch { yield break; }
            foreach (AutomationElement e in all) yield return e;
        }

        private static string SafeName(AutomationElement e)
        {
            try { return e.Current.Name ?? string.Empty; } catch { return string.Empty; }
        }

        private static double Sec(List<string> a, int i) { return a.Count > i ? double.Parse(a[i], CultureInfo.InvariantCulture) : 30; }

        /// <summary>Хашилт дотрох хоосон зайг хадгалж хуваана: invoke "MGL — Ханын дэлгээс" "үүсгэх" 30.</summary>
        private static List<string> Split(string line)
        {
            var list = new List<string>();
            var sb = new StringBuilder();
            bool q = false;
            foreach (char c in line)
            {
                if (c == '"') { q = !q; continue; }
                if (c == ' ' && !q) { if (sb.Length > 0) { list.Add(sb.ToString()); sb.Clear(); } continue; }
                sb.Append(c);
            }
            if (sb.Length > 0) list.Add(sb.ToString());
            return list;
        }

        private static byte Vk(string k)
        {
            switch (k.ToUpperInvariant())
            {
                case "ESCAPE": case "ESC": return 0x1B;
                case "RETURN": case "ENTER": return 0x0D;
                case "TAB": return 0x09;
                case "SPACE": return 0x20;
                default: return (byte)k[0];
            }
        }

        [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
        [DllImport("user32.dll")] private static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
        [StructLayout(LayoutKind.Sequential)] private struct RECT { public int Left, Top, Right, Bottom; }

        /// <summary>
        /// ЗӨВХӨН Revit-ийн цонхны зураг (өгсөн цонх, эсвэл Revit-ийн үндсэн цонх) — бүтэн дэлгэц ХЭЗЭЭ Ч биш: хэрэглэгчийн бусад цонх
        /// (хөтөч, мессеж) тестийн artifact-д орох ёсгүй (2026-10-13-нд бүтэн дэлгэц авсан алдаагаар засав).
        /// </summary>
        private static void Shot(string name, AutomationElement w = null)
        {
            try
            {
                IntPtr h = IntPtr.Zero;
                if (w != null) h = new IntPtr(w.Current.NativeWindowHandle);
                if (h == IntPtr.Zero) h = RevitMain();
                RECT r;
                if (h == IntPtr.Zero || !GetWindowRect(h, out r) || r.Right - r.Left < 10 || r.Bottom - r.Top < 10) { Log("shot: Revit цонх олдсонгүй — алгасав"); return; }
                // ⚠️ НУУЦЛАЛ (2026-10-14): CopyFromScreen нь тэр БАЙРЛАЛ дахь дэлгэцийг авдаг — хэрэглэгч Revit-ийн дээр өөр цонх (хөтөч г.м.)
                // нээсэн бол ТЭР зурагт ордог байв.  PrintWindow (PW_RENDERFULLCONTENT) нь ЗӨВХӨН энэ цонхны агуулгыг зурна — бусад цонх хэзээ ч
                // орохгүй.  Амжилтгүй бол зураггүй (дэлгэцээс хэзээ ч авахгүй).
                using (var bmp = new Bitmap(r.Right - r.Left, r.Bottom - r.Top))
                {
                    bool ok;
                    using (Graphics g = Graphics.FromImage(bmp))
                    {
                        IntPtr hdc = g.GetHdc();
                        try { ok = PrintWindow(h, hdc, 0x2); }
                        finally { g.ReleaseHdc(hdc); }
                    }
                    if (!ok) { Log("shot: PrintWindow амжилтгүй — зураггүй (дэлгэцээс авахгүй)"); return; }
                    bmp.Save(Path.Combine(_dir, DateTime.Now.ToString("HHmmss", CultureInfo.InvariantCulture) + "-" + name + ".png"), ImageFormat.Png);
                }
            }
            catch (Exception ex) { Log("shot алдаа: " + ex.Message); }
        }

        private static string Clean(string s)
        {
            var sb = new StringBuilder();
            foreach (char c in s ?? "") sb.Append(char.IsLetterOrDigit(c) ? c : '_');
            string r = sb.ToString();
            return r.Length > 40 ? r.Substring(0, 40) : r;
        }

        private static void Log(string msg)
        {
            try { File.AppendAllText(_log, DateTime.Now.ToString("HH:mm:ss.fff", CultureInfo.InvariantCulture) + " " + msg + Environment.NewLine, new UTF8Encoding(false)); }
            catch { }
        }
    }
}
