using System;
using System.IO;
using RevitMcpAddin.Ui.Core;

namespace RevitMcpAddin.Ui
{
    /// <summary>
    /// UI-ийн хувийн сонголтын (цонхны хэмжээ, нэг удаагийн зөвлөмж) хадгалалт:
    /// %APPDATA%\RevitMcpAddin\ui-prefs.json.
    ///
    /// ⚠️ `settings.json`-д БИЧИХГҮЙ (тэнд токен/сессийн зохицуулалт) ба RVT баримтад ч БИЧИХГҮЙ
    /// (цонх зөөх нь загварыг «өөрчлөгдсөн» болгож болохгүй).  Бүх алдааг залгина — UI-ийн сонголт
    /// ямар ч үед хэрэгслийг унагаж болохгүй.  Атом бичилт: түр файл → солих.
    /// </summary>
    internal static class MglUiPrefs
    {
        private static readonly object Gate = new object();
        private static UiPrefs _cache;

        internal static string FilePath
        {
            // = `SettingsStore.Dir` (%APPDATA%\RevitMcpAddin) — ЭНД давтсан: энэ файл Revit/SettingsStore-гүй smoke төслүүдэд ч эмхэтгэгдэнэ.
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "RevitMcpAddin", "ui-prefs.json"); }
        }

        internal static UiPrefs Load()
        {
            lock (Gate)
            {
                if (_cache != null) return _cache;
                try
                {
                    string path = FilePath;
                    _cache = File.Exists(path) ? UiPrefsJson.Parse(File.ReadAllText(path)) : new UiPrefs();
                }
                catch
                {
                    _cache = new UiPrefs();
                }
                return _cache;
            }
        }

        /// <summary>Сонголтыг засаад хадгална.  Бичилт бүтэлгүйтвэл санах ойд үлдэнэ, throw хийхгүй.</summary>
        internal static void Update(Action<UiPrefs> edit)
        {
            if (edit == null) return;
            lock (Gate)
            {
                UiPrefs p = Load();
                try { edit(p); } catch { return; }
                try
                {
                    string path = FilePath;
                    Directory.CreateDirectory(Path.GetDirectoryName(path));
                    string tmp = path + ".tmp";
                    File.WriteAllText(tmp, UiPrefsJson.Serialize(p));
                    if (File.Exists(path)) File.Replace(tmp, path, null);
                    else File.Move(tmp, path);
                }
                catch
                {
                    // Диск бичигдэхгүй/түгжигдсэн — энэ сессэд л хүчинтэй.
                }
            }
        }

        internal static bool GetFlag(string key)
        {
            return Load().GetFlag(key);
        }

        internal static void SetFlag(string key, bool value)
        {
            Update(p => p.SetFlag(key, value));
        }
    }
}
