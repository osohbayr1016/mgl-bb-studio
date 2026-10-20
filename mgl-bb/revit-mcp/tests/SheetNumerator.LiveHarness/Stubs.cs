using System;
using System.IO;

// Add-in-ийн `SettingsStore` / `BuildInfo`-ийн хуурамч орлуулагч — зөвхөн лог/тохиргооны замд хэрэглэгдэнэ.
namespace RevitMcpAddin
{
    internal static class SettingsStore
    {
        public static string Dir
        {
            get
            {
                string d = Path.Combine(Path.GetTempPath(), "sn-live-harness");
                Directory.CreateDirectory(d);
                return d;
            }
        }
    }

    internal static class BuildInfo
    {
        public const string Version = "live-harness";
    }

    /// <summary>Add-in-ийн `App` (ribbon, үндсэн цонхны бариул)-ын хуурамч орлуулагч — `SheetNumeratorCommand` үүгээр л хандана.</summary>
    internal static class App
    {
        internal static IntPtr MainWindowHandle { get; private set; }

        internal static void RememberMainWindow(IntPtr handle)
        {
            if (handle != IntPtr.Zero)
                MainWindowHandle = handle;
        }
    }
}
