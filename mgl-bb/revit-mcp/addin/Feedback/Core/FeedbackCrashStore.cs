using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace RevitMcpAddin.Feedback.Core
{
    /// <summary>
    /// MGL add-in-ий барьж чадаагүй алдааны ЛОКАЛ бүртгэл (<c>%APPDATA%\RevitMcpAddin\feedback\crash\</c>).
    /// Юу ч автоматаар ИЛГЭЭГДЭХГҮЙ — дараагийн нээлтэд хэрэглэгчээс «санал хүсэлтээр илгээх үү?» гэж асууна.
    /// Хязгаар: файл тутам ≤ 32 KiB, ≤ 5 файл (хуучныг устгана), 14 хоногоос хуучныг санал болгохгүй.
    /// </summary>
    public static class FeedbackCrashStore
    {
        public const int MaxFiles = 5;
        public const int MaxBytes = 32 * 1024;
        public static readonly TimeSpan OfferWindow = TimeSpan.FromDays(14);

        public sealed class CrashRecord
        {
            [JsonPropertyName("schema")] public string Schema { get; set; } = "mgl-crash/1";
            [JsonPropertyName("at")] public string At { get; set; }
            [JsonPropertyName("addin_version")] public string AddinVersion { get; set; }
            [JsonPropertyName("revit_year")] public string RevitYear { get; set; }
            [JsonPropertyName("tool_id")] public string ToolId { get; set; }
            [JsonPropertyName("error")] public ExceptionInfo Error { get; set; }
            [JsonPropertyName("handled")] public bool Handled { get; set; }
            [JsonIgnore] public string Path { get; set; }
        }

        public static string DefaultDir() => System.IO.Path.Combine(FeedbackOutbox.DefaultRoot(), "crash");

        public static string Write(string dir, Exception ex, string addinVersion, string revitYear, string toolId, DateTimeOffset now)
        {
            if (ex == null || string.IsNullOrEmpty(dir)) return null;
            try
            {
                Directory.CreateDirectory(dir);
                var rec = new CrashRecord
                {
                    At = FeedbackTime.Iso(now),
                    AddinVersion = addinVersion,
                    RevitYear = revitYear,
                    ToolId = toolId,
                    Error = FeedbackDiagnostics.Describe(ex),
                };
                string json = JsonSerializer.Serialize(rec);
                if (Encoding.UTF8.GetByteCount(json) > MaxBytes && rec.Error != null)
                {
                    rec.Error.Stack = rec.Error.Stack != null && rec.Error.Stack.Length > 8000 ? rec.Error.Stack.Substring(0, 8000) + "…" : rec.Error.Stack;
                    json = JsonSerializer.Serialize(rec);
                }
                string path = System.IO.Path.Combine(dir, "crash-" + now.ToUniversalTime().ToString("yyyyMMdd-HHmmss-fff", CultureInfo.InvariantCulture) + ".json");
                FeedbackOutbox.WriteAtomic(path, json);
                Prune(dir);
                return path;
            }
            catch (Exception)
            {
                return null;   // алдаа бүртгэх нь өөрөө алдаа үүсгэж болохгүй
            }
        }

        /// <summary>Санал болгох (handled биш, 14 хоногоос шинэ) бүртгэлүүд — шинэ нь эхэнд.</summary>
        public static List<CrashRecord> Pending(string dir, DateTimeOffset now)
        {
            var list = new List<CrashRecord>();
            if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) return list;
            foreach (string f in Directory.GetFiles(dir, "crash-*.json"))
            {
                try
                {
                    CrashRecord r = JsonSerializer.Deserialize<CrashRecord>(File.ReadAllText(f, Encoding.UTF8));
                    if (r == null || r.Handled) continue;
                    DateTimeOffset at;
                    if (!DateTimeOffset.TryParse(r.At, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out at)) continue;
                    if (now - at > OfferWindow) continue;
                    r.Path = f;
                    list.Add(r);
                }
                catch (Exception)
                {
                    // эвдэрсэн файл — алгасна
                }
            }
            list.Sort((a, b) => string.CompareOrdinal(b.At ?? "", a.At ?? ""));
            return list;
        }

        public static void MarkHandled(CrashRecord r)
        {
            if (r == null || string.IsNullOrEmpty(r.Path)) return;
            try
            {
                r.Handled = true;
                FeedbackOutbox.WriteAtomic(r.Path, JsonSerializer.Serialize(r));
            }
            catch (Exception) { }
        }

        private static void Prune(string dir)
        {
            string[] files = Directory.GetFiles(dir, "crash-*.json");
            if (files.Length <= MaxFiles) return;
            Array.Sort(files, StringComparer.Ordinal);
            for (int i = 0; i < files.Length - MaxFiles; i++)
            {
                try { File.Delete(files[i]); } catch (Exception) { }
            }
        }
    }
}
