using System;
using System.IO;

namespace RevitMcpAddin.Smart.Core
{
    /// <summary>
    /// «MGL Smart»-ын локал өгөгдлийн байршил.
    ///
    ///   %APPDATA%\RevitMcpAddin\smart\
    ///       profiles.json, queries.json           — хэрэглэгчийн ГЛОБАЛ тохиргоо
    ///       docs\&lt;docHash&gt;\*.json               — файл (DocumentKey) тус бүрийн түүх, төлөв
    ///       logs\smart.log.jsonl                  — лог (төслийн агуулгагүй)
    ///
    /// Репогийн бусад дэд систем `%APPDATA%\RevitMcpAddin` дотор JSON хадгалдаг
    /// (SettingsStore, ChangeTracker) — үүнийг дагана; Extensible Storage-д
    /// (CdLinks, AaStore шиг) ХАДГАЛАХГҮЙ: тэр нь ЗАГВАРТ бичигдэж, транзакц шаардаж,
    /// файлыг «өөрчлөгдсөн» болгодог.  Clash/Impact түүх загварт орох ёсгүй.
    ///
    /// `MGL_SMART_DIR` орчны хувьсагч байвал ТЭРЭНД (тест, өөр байршил).
    /// </summary>
    public static class SmartPaths
    {
        private static string _overrideRoot;

        /// <summary>Тестэд л: үндсэн хавтсыг солих.  null = анхдагч руу буцна.</summary>
        public static void OverrideRoot(string root)
        {
            _overrideRoot = root;
        }

        public static string Root
        {
            get
            {
                if (!string.IsNullOrEmpty(_overrideRoot)) return _overrideRoot;
                string env = Environment.GetEnvironmentVariable("MGL_SMART_DIR");
                if (!string.IsNullOrWhiteSpace(env)) return env.Trim();
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "RevitMcpAddin",
                    "smart");
            }
        }

        public static string Logs
        {
            get { return Path.Combine(Root, "logs"); }
        }

        /// <summary>Файл (DocumentKey) тус бүрийн хавтас.  Нэр нь түлхүүрийн ХЭШ — зам/нэр ОРОХГҮЙ.</summary>
        public static string DocDir(DocumentKey key)
        {
            string folder = key != null ? key.FolderName : "unknown";
            return Path.Combine(Root, "docs", folder);
        }

        /// <summary>`SmartStore`-д өгөх харьцангуй зам: `docs\&lt;docHash&gt;\&lt;file&gt;`.</summary>
        public static string DocFile(DocumentKey key, string fileName)
        {
            string folder = key != null ? key.FolderName : "unknown";
            return Path.Combine("docs", folder, fileName);
        }
    }
}
