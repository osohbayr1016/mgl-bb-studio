using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using RevitMcpAddin.Feedback.Core;

namespace RevitMcpAddin.Feedback
{
    /// <summary>
    /// Revit-ийн талаас <see cref="DiagnosticsInput"/>-ийг бөглөнө.  ⚠️ Revit API-ийн хэсэг нь API context-д (командын
    /// <c>Execute</c> / ExternalEvent) дуудагдах ёстой — <see cref="Collect"/> нь тэнд дуудагдана; файл/DLL-ийн хэш нь
    /// кэшлэгдэнэ (процессын турш нэг удаа).  Алхам бүр try/catch: оношилгоо цуглуулах нь хэзээ ч цонхыг унагахгүй.
    /// Нууц (токен, хэрэглэгчийн нэр, нууц үг, машины нэр) ЭНД ОРОХГҮЙ.
    /// </summary>
    internal static class FeedbackDiagnosticsCollector
    {
        private static string _dllSha;
        private static readonly object Gate = new object();

        public static DiagnosticsInput Collect(UIApplication uiapp, string toolId, string stage, Exception error = null, Dictionary<string, string> extra = null)
        {
            var d = new DiagnosticsInput
            {
                ToolId = toolId,
                Stage = stage,
                Extra = extra,
                Error = FeedbackDiagnostics.Describe(error),
            };
            Safe(() => FillRevit(d, uiapp));
            Safe(() => FillDocument(d, uiapp));
            Safe(() => FillAddin(d));
            Safe(() => FillRuntime(d));
            Safe(() =>
            {
                (string host, _) = FeedbackService.CurrentCredentials();
                d.ServerHost = string.IsNullOrEmpty(host) ? null : new Uri(host).Host;
            });
            Safe(() => d.LicenseState = Licensing.LicenseGate.IsLicensedNow() ? "licensed" : "unlicensed");
            return d;
        }

        /// <summary>Хүсэлтийн талбарт орох хувилбарын товч (сервер жагсаалтад шүүнэ: Revit он/build, add-in хувилбар/хэш).</summary>
        public static void FillFields(FeedbackFields f, DiagnosticsInput d)
        {
            if (f == null || d == null) return;
            int year;
            if (int.TryParse(d.RevitYear, NumberStyles.None, CultureInfo.InvariantCulture, out year)) f.RevitYear = year;
            f.RevitBuild = Clip(d.RevitVersionBuild, 64);
            f.AddinVersion = Clip(d.AddinVersion, 40);
            f.AddinSha256 = d.AddinDllSha256;
        }

        private static void FillRevit(DiagnosticsInput d, UIApplication uiapp)
        {
            if (uiapp == null) return;
            Autodesk.Revit.ApplicationServices.Application app = uiapp.Application;
            d.RevitYear = app.VersionNumber;
            d.RevitVersionNumber = app.VersionNumber;
            d.RevitVersionBuild = app.VersionBuild;
            Safe(() => d.RevitSubVersion = app.SubVersionNumber);
            Safe(() => d.RevitLanguage = app.Language.ToString());
        }

        private static void FillDocument(DiagnosticsInput d, UIApplication uiapp)
        {
            UIDocument uidoc = uiapp?.ActiveUIDocument;
            Document doc = uidoc?.Document;
            if (doc == null)
            {
                d.DocumentKind = "none";
                return;
            }
            d.DocumentTitle = Clip(doc.Title, 200);
            d.DocumentKind = doc.IsFamilyDocument ? "family" : "project";
            Safe(() => d.IsWorkshared = doc.IsWorkshared);
            Safe(() =>
            {
                View v = doc.ActiveView;
                if (v == null) return;
                d.ActiveViewType = v.ViewType.ToString();
                d.ActiveViewName = Clip(v.Name, 120);
            });
            Safe(() => d.SelectionCount = uidoc.Selection.GetElementIds().Count);
        }

        private static void FillAddin(DiagnosticsInput d)
        {
            Assembly a = typeof(FeedbackDiagnosticsCollector).Assembly;
            d.AddinVersion = BuildInfo.Version;
            Safe(() => d.AddinInformationalVersion = a.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion);
            string path = a.Location;
            d.AddinDllPath = path;
            Safe(() => d.AddinFileVersion = FileVersionInfo.GetVersionInfo(path).FileVersion);
            Safe(() => d.AddinDllSha256 = DllSha256(path));
#if NET8_0_OR_GREATER
            d.AddinBuildConfiguration = "net8+";
#else
            d.AddinBuildConfiguration = "net48";
#endif
            Safe(() =>
            {
                string rel = Path.Combine(Path.GetDirectoryName(path) ?? "", "release.json");
                if (!File.Exists(rel)) return;
                using (JsonDocument doc = JsonDocument.Parse(File.ReadAllText(rel)))
                {
                    JsonElement r = doc.RootElement;
                    d.PackageVersion = Str(r, "version");
                    d.PackageCommit = Str(r, "git_sha");
                    if (r.TryGetProperty("git_dirty", out JsonElement dirty) && dirty.ValueKind == JsonValueKind.True && d.PackageCommit != null)
                        d.PackageCommit += "+dirty";
                    d.PackageBuiltAt = Str(r, "built_at");
                }
            });
        }

        private static void FillRuntime(DiagnosticsInput d)
        {
            d.Framework = RuntimeInformation.FrameworkDescription;
            d.OsDescription = RuntimeInformation.OSDescription;
            d.Is64BitProcess = Environment.Is64BitProcess;
            d.Culture = CultureInfo.CurrentCulture.Name;
            d.UiCulture = CultureInfo.CurrentUICulture.Name;
            Safe(() =>
            {
                // Revit-ийн үндсэн цонхны DPI (96 = 100 %) — Windows 10 1607+; байхгүй бол WPF-ийн системийн DPI.
                IntPtr hwnd = App.MainWindowHandle;
                uint dpi = hwnd != IntPtr.Zero ? GetDpiForWindow(hwnd) : 0;
                if (dpi == 0)
                {
                    var dpiProp = typeof(System.Windows.SystemParameters).GetProperty("Dpi", BindingFlags.NonPublic | BindingFlags.Static);
                    if (dpiProp?.GetValue(null, null) is int sys && sys > 0) dpi = (uint)sys;
                }
                if (dpi > 0) d.DpiScale = Math.Round(dpi / 96.0, 2);
            });
        }

        [DllImport("user32.dll")]
        private static extern uint GetDpiForWindow(IntPtr hwnd);

        /// <summary>DLL-ийн SHA-256 — процессын турш нэг удаа (Revit ажиллаж байхад DLL солигддоггүй).</summary>
        private static string DllSha256(string path)
        {
            lock (Gate)
            {
                if (_dllSha != null) return _dllSha;
                using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                using (SHA256 sha = SHA256.Create())
                    _dllSha = FeedbackOutbox.Hex(sha.ComputeHash(fs));
                return _dllSha;
            }
        }

        private static string Str(JsonElement o, string name) =>
            o.ValueKind == JsonValueKind.Object && o.TryGetProperty(name, out JsonElement v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

        private static string Clip(string s, int max) => s == null || s.Length <= max ? s : s.Substring(0, max);

        private static void Safe(Action a)
        {
            try { a(); } catch (Exception) { /* оношилгооны нэг талбар алга байх нь цонх унахаас дээр */ }
        }
    }
}
