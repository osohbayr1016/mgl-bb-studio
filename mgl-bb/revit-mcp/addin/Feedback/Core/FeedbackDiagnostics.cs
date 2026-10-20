using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace RevitMcpAddin.Feedback.Core
{
    /// <summary>
    /// Оношилгооны ОРОЛТ — Revit-ийн тал (<c>FeedbackDiagnosticsCollector</c>) бөглөнө; энэ файл Revit-гүй.
    /// Revit 2024 ↔ 2027-г ялгахад шаардлагатай бүх зүйл: он + бүтэн build, DLL-ийн зам/хувилбар/SHA-256, багц/commit,
    /// runtime/OS/DPI, хэрэгсэл/үе шат, алдааны ангилал.
    /// </summary>
    public sealed class DiagnosticsInput
    {
        public string RevitYear { get; set; }
        public string RevitVersionNumber { get; set; }
        public string RevitVersionBuild { get; set; }
        public string RevitSubVersion { get; set; }
        public string RevitLanguage { get; set; }
        public string AddinVersion { get; set; }
        public string AddinInformationalVersion { get; set; }
        public string AddinDllPath { get; set; }
        public string AddinDllSha256 { get; set; }
        public string AddinFileVersion { get; set; }
        public string AddinBuildConfiguration { get; set; }
        public string PackageVersion { get; set; }
        public string PackageCommit { get; set; }
        public string PackageBuiltAt { get; set; }
        public string Framework { get; set; }
        public string OsDescription { get; set; }
        public bool Is64BitProcess { get; set; }
        public double? DpiScale { get; set; }
        public string Culture { get; set; }
        public string UiCulture { get; set; }
        public string ToolId { get; set; }
        public string Stage { get; set; }
        public string DocumentTitle { get; set; }
        public string DocumentKind { get; set; }
        public bool? IsWorkshared { get; set; }
        public string ActiveViewType { get; set; }
        public string ActiveViewName { get; set; }
        public int? SelectionCount { get; set; }
        public ExceptionInfo Error { get; set; }
        public string ServerHost { get; set; }
        public string LicenseState { get; set; }
        public Dictionary<string, string> Extra { get; set; }
    }

    public sealed class ExceptionInfo
    {
        public string Type { get; set; }
        public string Message { get; set; }
        public string Stack { get; set; }
        /// <summary>addin · revit_api · environment · unknown.</summary>
        public string Classification { get; set; }
        public string Inner { get; set; }
    }

    /// <summary>
    /// <c>mgl-diag/1</c> JSON-ийг бүтээнэ.  Нууц ХЭЗЭЭ Ч орохгүй: токен/нууц үг/cookie/гарын үсэгтэй URL-ийн түлхүүр хасагдана,
    /// хэрэглэгчийн профайлын зам <c>%USERPROFILE%</c> болно, алдааны stack мөрийн тоогоор хязгаарлагдана, нийт ≤ 64 KiB
    /// (сервер ч мөн цэвэрлэнэ — <c>scrubDiagnostics</c>).
    /// </summary>
    public static class FeedbackDiagnostics
    {
        public const string Schema = "mgl-diag/1";
        private const int MaxStackLines = 40;
        private const int MaxMessage = 600;

        private static readonly Regex SecretKey = new Regex(
            @"(token|secret|password|passwd|pwd|authorization|cookie|session|api[_-]?key|signature|credential|private[_-]?key)",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

        private static readonly Regex SignedUrlParam = new Regex(
            @"([?&](?:sig|signature|token|access_token|x-amz-[a-z-]+|se|sp|sv|st)=)[^&\s""']+",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

        private static readonly Regex UserProfilePath = new Regex(
            @"([A-Za-z]:\\Users\\)[^\\/:*?""<>|\r\n]+",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

        public static bool IsSecretKey(string key) => !string.IsNullOrEmpty(key) && SecretKey.IsMatch(key);

        /// <summary>«C:\Users\bat\AppData\…» → «%USERPROFILE%\AppData\…»; гарын үсэгтэй URL-ийн параметрийг «***».</summary>
        public static string Mask(string text)
        {
            if (string.IsNullOrEmpty(text)) return text;
            string s = UserProfilePath.Replace(text, m => "%USERPROFILE%");
            s = SignedUrlParam.Replace(s, m => m.Groups[1].Value + "***");
            return s;
        }

        public static ExceptionInfo Describe(Exception ex)
        {
            if (ex == null) return null;
            string stack = ex.StackTrace ?? string.Empty;
            string[] lines = stack.Replace("\r\n", "\n").Split('\n');
            var kept = new StringBuilder();
            for (int i = 0; i < lines.Length && i < MaxStackLines; i++) kept.Append(lines[i].TrimEnd()).Append('\n');
            if (lines.Length > MaxStackLines) kept.Append("… (+" + (lines.Length - MaxStackLines) + " мөр)");
            return new ExceptionInfo
            {
                Type = ex.GetType().FullName,
                Message = Trim(Mask(ex.Message), MaxMessage),
                Stack = Mask(kept.ToString().TrimEnd()),
                Classification = Classify(ex),
                Inner = ex.InnerException != null ? ex.InnerException.GetType().FullName + ": " + Trim(Mask(ex.InnerException.Message), 300) : null,
            };
        }

        /// <summary>
        /// addin — stack-д манай кодын мөр (RevitMcpAddin.*) байна · revit_api — Autodesk.Revit-ийн exception ·
        /// environment — сүлжээ / диск / эрх / санах ой · unknown — бусад.
        /// </summary>
        public static string Classify(Exception ex)
        {
            if (ex == null) return null;
            string type = ex.GetType().FullName ?? string.Empty;
            if (type.StartsWith("Autodesk.Revit", StringComparison.Ordinal)) return "revit_api";
            if (ex is IOException || ex is UnauthorizedAccessException || ex is OutOfMemoryException || ex is TimeoutException
                || type.StartsWith("System.Net", StringComparison.Ordinal) || type.EndsWith("TaskCanceledException", StringComparison.Ordinal)
                || type.EndsWith("SocketException", StringComparison.Ordinal))
                return "environment";
            string stack = ex.StackTrace ?? string.Empty;
            if (stack.IndexOf("RevitMcpAddin.", StringComparison.Ordinal) >= 0) return "addin";
            return "unknown";
        }

        /// <summary>Оношилгооны JSON (бүтэн ≤ 64 KiB; хэтэрвэл эхлээд stack, дараа нь extra-г тайрна).</summary>
        public static string Build(DiagnosticsInput d, DateTimeOffset now)
        {
            if (d == null) return null;
            string json = Serialize(d, now, MaxStackLines);
            if (Encoding.UTF8.GetByteCount(json) <= FeedbackLimits.DiagnosticsMaxBytes) return json;
            if (d.Error != null) d.Error.Stack = Trim(d.Error.Stack, 4000);
            d.Extra = null;
            json = Serialize(d, now, 10);
            if (Encoding.UTF8.GetByteCount(json) <= FeedbackLimits.DiagnosticsMaxBytes) return json;
            if (d.Error != null) d.Error.Stack = null;
            return Serialize(d, now, 0);
        }

        /// <summary>Хэрэглэгчид харуулах товч хураангуй (юу илгээгдэхийг ИЛ харуулна).</summary>
        public static string Summary(DiagnosticsInput d)
        {
            if (d == null) return "Оношилгоо алга";
            var sb = new StringBuilder();
            sb.Append("Revit ").Append(d.RevitYear ?? "?");
            if (!string.IsNullOrEmpty(d.RevitVersionBuild)) sb.Append(" (build ").Append(d.RevitVersionBuild).Append(')');
            sb.Append(" · MGL add-in ").Append(d.AddinVersion ?? "?");
            if (!string.IsNullOrEmpty(d.AddinDllSha256) && d.AddinDllSha256.Length >= 12) sb.Append(" · DLL ").Append(d.AddinDllSha256.Substring(0, 12));
            sb.Append('\n').Append(d.Framework ?? "").Append(" · ").Append(d.OsDescription ?? "");
            if (d.DpiScale.HasValue) sb.Append(" · DPI ").Append((d.DpiScale.Value * 100).ToString("0", CultureInfo.InvariantCulture)).Append('%');
            if (!string.IsNullOrEmpty(d.ToolId)) sb.Append('\n').Append("Хэрэгсэл: ").Append(d.ToolId).Append(string.IsNullOrEmpty(d.Stage) ? "" : " · " + d.Stage);
            sb.Append('\n').Append(string.IsNullOrEmpty(d.DocumentTitle) ? "Нээлттэй файл алга" : "Файл: " + d.DocumentTitle);
            if (!string.IsNullOrEmpty(d.ActiveViewType)) sb.Append(" · ").Append(d.ActiveViewType);
            if (d.Error != null) sb.Append('\n').Append("Алдаа: ").Append(d.Error.Type).Append(" — ").Append(Trim(d.Error.Message, 160));
            return sb.ToString();
        }

        private static string Serialize(DiagnosticsInput d, DateTimeOffset now, int stackLines)
        {
            var root = new Dictionary<string, object>
            {
                ["schema"] = Schema,
                ["captured_at"] = FeedbackTime.Iso(now),
                ["channel"] = "revit",
                ["revit"] = new Dictionary<string, object>
                {
                    ["year"] = d.RevitYear,
                    ["version_number"] = d.RevitVersionNumber,
                    ["version_build"] = d.RevitVersionBuild,
                    ["sub_version"] = d.RevitSubVersion,
                    ["language"] = d.RevitLanguage,
                },
                ["addin"] = new Dictionary<string, object>
                {
                    ["version"] = d.AddinVersion,
                    ["informational_version"] = d.AddinInformationalVersion,
                    ["file_version"] = d.AddinFileVersion,
                    ["configuration"] = d.AddinBuildConfiguration,
                    ["dll_path"] = Mask(d.AddinDllPath),
                    ["dll_sha256"] = d.AddinDllSha256,
                    ["package_version"] = d.PackageVersion,
                    ["package_commit"] = d.PackageCommit,
                    ["package_built_at"] = d.PackageBuiltAt,
                },
                ["runtime"] = new Dictionary<string, object>
                {
                    ["framework"] = d.Framework,
                    ["os"] = d.OsDescription,
                    ["process_64bit"] = d.Is64BitProcess,
                    ["dpi_scale"] = d.DpiScale,
                    ["culture"] = d.Culture,
                    ["ui_culture"] = d.UiCulture,
                },
                ["context"] = new Dictionary<string, object>
                {
                    ["tool_id"] = d.ToolId,
                    ["stage"] = d.Stage,
                    ["document_title"] = d.DocumentTitle,
                    ["document_kind"] = d.DocumentKind,
                    ["workshared"] = d.IsWorkshared,
                    ["active_view_type"] = d.ActiveViewType,
                    ["active_view_name"] = d.ActiveViewName,
                    ["selection_count"] = d.SelectionCount,
                    ["server_host"] = d.ServerHost,
                    ["license_state"] = d.LicenseState,
                },
            };
            if (d.Error != null)
            {
                string stack = d.Error.Stack;
                if (stack != null && stackLines >= 0)
                {
                    string[] lines = stack.Split('\n');
                    if (lines.Length > stackLines) stack = string.Join("\n", lines, 0, stackLines) + (stackLines > 0 ? "\n…" : "");
                }
                root["error"] = new Dictionary<string, object>
                {
                    ["type"] = d.Error.Type,
                    ["message"] = d.Error.Message,
                    ["classification"] = d.Error.Classification,
                    ["inner"] = d.Error.Inner,
                    ["stack"] = string.IsNullOrEmpty(stack) ? null : stack,
                };
            }
            if (d.Extra != null && d.Extra.Count > 0)
            {
                var extra = new Dictionary<string, object>();
                foreach (KeyValuePair<string, string> kv in d.Extra)
                {
                    if (string.IsNullOrEmpty(kv.Key) || IsSecretKey(kv.Key)) continue;
                    extra[kv.Key.Length > 60 ? kv.Key.Substring(0, 60) : kv.Key] = Trim(Mask(kv.Value), 500);
                    if (extra.Count >= 40) break;
                }
                root["extra"] = extra;
            }
            return JsonSerializer.Serialize(root);
        }

        private static string Trim(string s, int max) => s == null || s.Length <= max ? s : s.Substring(0, max) + "…";
    }
}
