using System;
using System.IO;
using System.Text;

namespace RevitMcpAddin.SheetNumerator.Revit
{
    /// <summary>
    /// «Зургийн хуудас дугаарлах»-ын техникийн лог: `%APPDATA%\RevitMcpAddin\sheet-numerator.log`.
    ///
    /// Хэрэглэгчид Revit/.NET exception-ы түүхий бичвэрийг харуулахгүй (товч Монгол мессеж) — харин ЭНД
    /// exception-ы төрөл, мессеж, stack trace, үйлдэл, хөндөгдсөн хуудас (дугаар/id), Revit-ийн хувилбарыг
    /// бичнэ.  «Дэлгэрэнгүй мэдээллийг MGL Add-in log-оос шалгана уу» гэсэн мессежийн «log» нь ЭНЭ файл.
    ///
    /// ⚠️ Хэзээ ч throw хийхгүй (лог бичих нь ажиллагааг унагаах ёсгүй).  Файл ~1 MB болоход `.1` руу эргэнэ.
    /// ⚠️ Модель өөрчлөх кодод `catch {}` ХИЙЖ ЧИМЭЭГҮЙ НУУХГҮЙ — алдаа бүр энд бичигдэнэ.
    /// </summary>
    internal static class SheetNumeratorLog
    {
        private const long MaxBytes = 1024 * 1024;
        private static readonly object Gate = new object();

        /// <summary>Тест/harness өөр файл руу чиглүүлэх.</summary>
        internal static string PathOverride { get; set; }

        public static string LogPath
        {
            get
            {
                if (!string.IsNullOrEmpty(PathOverride))
                    return PathOverride;
                return Path.Combine(SettingsStore.Dir, "sheet-numerator.log");
            }
        }

        public static void Info(string operation, string message)
        {
            Write("INFO", operation, message, null);
        }

        public static void Error(string operation, string message, Exception ex)
        {
            Write("ERROR", operation, message, ex);
        }

        private static void Write(string level, string operation, string message, Exception ex)
        {
            try
            {
                var sb = new StringBuilder();
                sb.Append(DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff")).Append(' ')
                  .Append(level).Append(" [").Append(operation).Append("] ")
                  .Append("Revit ").Append(RevitInfo.VersionLabel).Append(" · addin ").Append(BuildInfo.Version).Append(" · ")
                  .AppendLine(message ?? string.Empty);
                if (ex != null)
                {
                    sb.Append("    ").Append(ex.GetType().FullName).Append(": ").AppendLine(ex.Message);
                    if (!string.IsNullOrEmpty(ex.StackTrace))
                        sb.AppendLine(ex.StackTrace);
                    Exception inner = ex.InnerException;
                    int depth = 0;
                    while (inner != null && depth++ < 3)
                    {
                        sb.Append("  inner: ").Append(inner.GetType().FullName).Append(": ").AppendLine(inner.Message);
                        inner = inner.InnerException;
                    }
                }

                lock (Gate)
                {
                    string path = LogPath;
                    string dir = Path.GetDirectoryName(path);
                    if (!string.IsNullOrEmpty(dir))
                        Directory.CreateDirectory(dir);
                    try
                    {
                        var fi = new FileInfo(path);
                        if (fi.Exists && fi.Length > MaxBytes)
                        {
                            string old = path + ".1";
                            if (File.Exists(old))
                                File.Delete(old);
                            File.Move(path, old);
                        }
                    }
                    catch (Exception)
                    {
                        // Эргэлт бүтэлгүй — үргэлжлүүлж бичнэ.
                    }
                    File.AppendAllText(path, sb.ToString(), new UTF8Encoding(false));
                }
            }
            catch (Exception)
            {
                // Лог бичиж чадаагүй нь ажиллагаанд саад биш.
            }
        }
    }

    /// <summary>Revit-ийн хувилбарын мэдээлэл (лог, snapshot).  Add-in эхлэхэд командаас тавигдана.</summary>
    internal static class RevitInfo
    {
        /// <summary>«2027» г.м.  Мэдэгдэхгүй бол «?».</summary>
        public static string VersionLabel { get; set; } = "?";

        /// <summary>2024 / 2025 / 2026 / 2027 …  Мэдэгдэхгүй бол 0.</summary>
        public static int VersionNumber { get; set; }

        public static void Set(string versionNumber)
        {
            VersionLabel = string.IsNullOrWhiteSpace(versionNumber) ? "?" : versionNumber.Trim();
            int n;
            VersionNumber = int.TryParse(VersionLabel, out n) ? n : 0;
        }
    }
}
