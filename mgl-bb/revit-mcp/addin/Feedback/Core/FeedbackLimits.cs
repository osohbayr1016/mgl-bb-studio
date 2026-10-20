using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text.Json;

namespace RevitMcpAddin.Feedback.Core
{
    /// <summary>
    /// «Санал хүсэлт»-ийн хязгаар — СЕРВЕРИЙН <c>backend/src/lib/engineeringFeedback.ts</c> <c>EF_LIMITS</c> /
    /// <c>EF_EXTENSIONS</c>-ийн ИХЭР.  Өгөгдмөл утгууд энд; сервер <c>GET /api/engineering-feedback/capabilities</c>-ээр
    /// өөр утга буцаавал <see cref="ApplyCapabilities"/> дарж тохируулна (хязгаар серверээс удирдагдана).
    ///
    /// ⚠️ Сервер ҮРГЭЛЖ дахин шалгана (stream-ийн бодит байт, нэр, өргөтгөл, эзэмшил) — энд байгаа нь хэрэглэгчид
    ///    илгээхээс ӨМНӨ ойлгомжтой мессеж өгөх л зорилготой.
    /// ⚠️ Revit/WPF-гүй (net48 + net8/net10 + тестийн net10 бүгдэд эмхэтгэгдэнэ).
    /// </summary>
    public static class FeedbackLimits
    {
        public static int MaxAttachments { get; private set; } = 5;
        public static long MaxTotalBytes { get; private set; } = 100L * 1024 * 1024;
        public static long MaxOrdinaryBytes { get; private set; } = 25L * 1024 * 1024;
        public static int PartBytes { get; private set; } = 8 * 1024 * 1024;
        public const int TitleMax = 200;
        public const int TextMax = 20000;
        public const int ShortMax = 4000;
        public const int DiagnosticsMaxBytes = 64 * 1024;
        public const int FileNameMax = 180;

        private static readonly Dictionary<string, bool> DefaultExtensions = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase)
        {
            // өргөтгөл → «том» (RVT/RFA/ZIP нь 25 MiB-аас дээш multipart-аар)
            { "png", false }, { "jpg", false }, { "jpeg", false }, { "webp", false },
            { "pdf", false }, { "txt", false }, { "log", false }, { "json", false },
            { "zip", true }, { "rvt", true }, { "rfa", true },
        };

        private static Dictionary<string, bool> _extensions = new Dictionary<string, bool>(DefaultExtensions, StringComparer.OrdinalIgnoreCase);

        public static IEnumerable<string> Extensions => _extensions.Keys;

        public static bool IsAllowedExtension(string ext) => !string.IsNullOrEmpty(ext) && _extensions.ContainsKey(ext);

        public static bool IsLarge(string ext) => !string.IsNullOrEmpty(ext) && _extensions.TryGetValue(ext, out bool l) && l;

        /// <summary>«report.final.PDF» → «pdf»; өргөтгөлгүй бол хоосон.</summary>
        public static string ExtensionOf(string name)
        {
            if (string.IsNullOrEmpty(name)) return string.Empty;
            // ⚠️ `Path.GetFileName` нь net48-д буруу тэмдэгттэй нэр дээр шиддэг — гараар таслана.
            string file = name.Replace('/', '\\');
            int slash = file.LastIndexOf('\\');
            if (slash >= 0) file = file.Substring(slash + 1);
            int dot = file.LastIndexOf('.');
            return dot > 0 && dot < file.Length - 1 ? file.Substring(dot + 1).ToLowerInvariant() : string.Empty;
        }

        /// <summary>Сервертэй ИЖИЛ дүрэм: «том» өргөтгөлтэй, 25 MiB-аас их файл л multipart.</summary>
        public static bool IsMultipart(string ext, long size) => IsLarge(ext) && size > MaxOrdinaryBytes;

        public static int PartCount(long size, int partBytes) => (int)Math.Max(1, (size + partBytes - 1) / partBytes);

        public static long ExpectedPartSize(long size, int partNumber, int partBytes)
        {
            int n = PartCount(size, partBytes);
            if (partNumber < 1 || partNumber > n) return -1;
            return partNumber < n ? partBytes : size - (long)partBytes * (n - 1);
        }

        /// <summary>Нэг файлыг одоогийн жагсаалтад нэмж болох эсэх — болохгүй бол монгол шалтгаан.</summary>
        public static string FileProblem(string name, long size, long existingBytes, int existingCount)
        {
            string ext = ExtensionOf(name);
            if (!IsAllowedExtension(ext))
                return string.IsNullOrEmpty(ext) ? "Файлын өргөтгөл алга" : "«." + ext + "» төрлийн файл хүлээн авахгүй";
            if (size <= 0) return "Хоосон файл илгээх боломжгүй";
            if (existingCount >= MaxAttachments) return "Нэг хүсэлтэд " + MaxAttachments + "-аас олон файл хавсаргахгүй";
            if (existingBytes + size > MaxTotalBytes) return "Хавсралтын нийт хэмжээ " + FormatBytes(MaxTotalBytes) + "-аас хэтэрнэ";
            if (!IsLarge(ext) && size > MaxOrdinaryBytes) return "Энэ төрлийн файл " + FormatBytes(MaxOrdinaryBytes) + "-аас том байж болохгүй";
            return null;
        }

        public static string FormatBytes(long n)
        {
            if (n < 1024) return n.ToString(CultureInfo.InvariantCulture) + " B";
            if (n < 1024 * 1024) return (n / 1024.0).ToString(n < 10 * 1024 ? "0.0" : "0", CultureInfo.InvariantCulture) + " KB";
            if (n < 1024L * 1024 * 1024) return (n / (1024.0 * 1024)).ToString(n < 10L * 1024 * 1024 ? "0.0" : "0", CultureInfo.InvariantCulture) + " MB";
            return (n / (1024.0 * 1024 * 1024)).ToString("0.00", CultureInfo.InvariantCulture) + " GB";
        }

        /// <summary>
        /// Серверийн <c>capabilities.limits</c>-ийг хэрэглэнэ (утга бүр боломжит мужид байвал л).  Буруу/дутуу JSON →
        /// өгөгдмөл хэвээр.  Буцаах: хэрэглэгдсэн эсэх.
        /// </summary>
        public static bool ApplyCapabilities(string capabilitiesJson)
        {
            if (string.IsNullOrWhiteSpace(capabilitiesJson)) return false;
            try
            {
                using (JsonDocument doc = JsonDocument.Parse(capabilitiesJson))
                {
                    if (!doc.RootElement.TryGetProperty("limits", out JsonElement l) || l.ValueKind != JsonValueKind.Object) return false;
                    int maxAtt = ReadInt(l, "max_attachments", MaxAttachments, 1, 50);
                    long maxTotal = ReadLong(l, "max_total_bytes", MaxTotalBytes, 1024, 2L * 1024 * 1024 * 1024);
                    long maxOrd = ReadLong(l, "max_ordinary_bytes", MaxOrdinaryBytes, 1024, maxTotal);
                    int part = ReadInt(l, "part_bytes", PartBytes, 5 * 1024 * 1024, 100 * 1024 * 1024);
                    Dictionary<string, bool> ext = null;
                    if (l.TryGetProperty("extensions", out JsonElement e) && e.ValueKind == JsonValueKind.Object)
                    {
                        ext = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
                        foreach (JsonProperty p in e.EnumerateObject())
                        {
                            bool large = p.Value.ValueKind == JsonValueKind.Object && p.Value.TryGetProperty("large", out JsonElement lg) && lg.ValueKind == JsonValueKind.True;
                            if (p.Name.Length > 0 && p.Name.Length <= 10) ext[p.Name] = large;
                        }
                        if (ext.Count == 0) ext = null;
                    }
                    MaxAttachments = maxAtt;
                    MaxTotalBytes = maxTotal;
                    MaxOrdinaryBytes = maxOrd;
                    PartBytes = part;
                    if (ext != null) _extensions = ext;
                    return true;
                }
            }
            catch (JsonException)
            {
                return false;
            }
        }

        /// <summary>Тестэд: өгөгдмөл утга руу буцаана.</summary>
        public static void ResetToDefaults()
        {
            MaxAttachments = 5;
            MaxTotalBytes = 100L * 1024 * 1024;
            MaxOrdinaryBytes = 25L * 1024 * 1024;
            PartBytes = 8 * 1024 * 1024;
            _extensions = new Dictionary<string, bool>(DefaultExtensions, StringComparer.OrdinalIgnoreCase);
        }

        /// <summary>OpenFileDialog-ийн шүүлтүүр (зөвхөн зөвшөөрөгдсөн өргөтгөл).</summary>
        public static string DialogFilter()
        {
            var parts = new List<string>();
            foreach (string e in _extensions.Keys) parts.Add("*." + e);
            string all = string.Join(";", parts);
            return "Зөвшөөрөгдсөн файл (" + all + ")|" + all;
        }

        private static int ReadInt(JsonElement o, string name, int fallback, int min, int max)
        {
            if (o.TryGetProperty(name, out JsonElement v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out int x) && x >= min && x <= max) return x;
            return fallback;
        }

        private static long ReadLong(JsonElement o, string name, long fallback, long min, long max)
        {
            if (o.TryGetProperty(name, out JsonElement v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out long x) && x >= min && x <= max) return x;
            return fallback;
        }
    }
}
