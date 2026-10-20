using System;
using System.IO;
using System.Text;
using RevitMcpAddin.SheetNumerator.Core;

namespace RevitMcpAddin.SheetNumerator.Revit
{
    /// <summary>
    /// Тохиргоог `%APPDATA%\RevitMcpAddin\sheet-numerator.json`-д хадгална — MGL-ийн бусад хэрэгслийн (жишээ
    /// `auto-annotate.json`) ИЖИЛ хавтас, <see cref="SettingsStore.Dir"/>.  Агуулга, хувилбар, шилжилт нь
    /// <see cref="PrefsSerializer"/>-т.
    ///
    /// ⚠️ Хэзээ ч throw хийхгүй: уншиж чадахгүй бол өгөгдмөл, бичиж чадахгүй бол чимээгүй (лог).
    /// Бичилт нь АТОМ (түр файл → солих) — Revit унах үед тохиргоо хагас бичигдэхгүй.
    /// </summary>
    internal static class SheetNumeratorPrefsStore
    {
        /// <summary>Тест/harness өөр файл руу чиглүүлэх.</summary>
        internal static string PathOverride { get; set; }

        private static string PathOf
        {
            get
            {
                if (!string.IsNullOrEmpty(PathOverride))
                    return PathOverride;
                return Path.Combine(SettingsStore.Dir, "sheet-numerator.json");
            }
        }

        public static SheetNumeratorPrefs Load()
        {
            try
            {
                string path = PathOf;
                if (File.Exists(path))
                    return PrefsSerializer.Deserialize(File.ReadAllText(path, Encoding.UTF8));
            }
            catch (Exception ex)
            {
                SheetNumeratorLog.Error("prefs", "Тохиргоо уншиж чадсангүй — өгөгдмөлөөр", ex);
            }
            return new SheetNumeratorPrefs();
        }

        public static void Save(SheetNumeratorPrefs prefs)
        {
            try
            {
                string path = PathOf;
                string dir = Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(dir))
                    Directory.CreateDirectory(dir);

                string tmp = path + ".tmp";
                File.WriteAllText(tmp, PrefsSerializer.Serialize(prefs), new UTF8Encoding(false));
                if (File.Exists(path))
                    File.Delete(path);
                File.Move(tmp, path);
            }
            catch (Exception ex)
            {
                SheetNumeratorLog.Error("prefs", "Тохиргоо хадгалж чадсангүй", ex);
            }
        }
    }
}
