using System;
using System.IO;
using System.Text;

namespace RevitMcpAddin.FamilyHub.Core
{
    /// <summary>
    /// Түр файлын хавтас: <c>%LOCALAPPDATA%\MGL\RevitMcpAddin\TempFamilies\&lt;session&gt;\</c>.
    /// Хэрэглэгчийн Downloads хавтас ХЭЗЭЭ Ч хэрэглэгдэхгүй.  Файл нь Revit
    /// ачаалсны дараа (амжилт/алдаа аль ч үед) устгагдана.
    /// </summary>
    public static class TempFiles
    {
        public static string RootDir
        {
            get
            {
                string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                return Path.Combine(local, "MGL", "RevitMcpAddin", "TempFamilies");
            }
        }

        /// <summary>Нэг үйлдлийн тусгаарлагдсан дэд хавтас.</summary>
        public static string NewSessionDir(string root = null)
        {
            string dir = Path.Combine(root ?? RootDir, DateTime.UtcNow.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N").Substring(0, 8));
            Directory.CreateDirectory(dir);
            return dir;
        }

        /// <summary>
        /// Файлын нэрийг АЮУЛГҮЙ болгоно: замын тэмдэгт, `..`, удирдах тэмдэгт,
        /// Windows-ийн нөөц нэр.  Өргөтгөл хадгалагдана.
        /// ⚠️ Revit family-ийн нэр = файлын нэр (өргөтгөлгүй) тул ЗӨВХӨН
        /// зөвшөөрөгдөөгүй тэмдэгтийг л сольж, үлдсэнийг хэвээр үлдээнэ.
        /// </summary>
        public static string SafeFileName(string name, string fallback = "family.rfa")
        {
            if (string.IsNullOrWhiteSpace(name)) return fallback;
            name = name.Replace('\\', '/');
            int slash = name.LastIndexOf('/');
            if (slash >= 0) name = name.Substring(slash + 1);
            var sb = new StringBuilder(name.Length);
            char[] invalid = Path.GetInvalidFileNameChars();
            foreach (char c in name)
            {
                bool bad = c < 32 || Array.IndexOf(invalid, c) >= 0;
                sb.Append(bad ? '_' : c);
            }
            string s = sb.ToString().Trim().TrimEnd('.');
            if (s.Length == 0 || s == "." || s == "..") return fallback;
            string stem = Path.GetFileNameWithoutExtension(s).ToUpperInvariant();
            string[] reserved = { "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9" };
            if (Array.IndexOf(reserved, stem) >= 0) s = "_" + s;
            if (s.Length > 150) s = s.Substring(0, 150 - Path.GetExtension(s).Length) + Path.GetExtension(s);
            return s;
        }

        /// <summary>Хавтсыг бүхэлд нь устгана; алдаа залгина (унтраалт/түгжээ).</summary>
        public static void TryDeleteDir(string dir)
        {
            if (string.IsNullOrEmpty(dir)) return;
            try { if (Directory.Exists(dir)) Directory.Delete(dir, true); }
            catch { /* Revit файлыг түр түгжсэн байж болно — дараагийн цэвэрлэгээ авна */ }
        }

        /// <summary>Хуучин сессийн хавтсуудыг цэвэрлэнэ (өмнөх удаа Revit унасан г.м.).</summary>
        public static void SweepStale(TimeSpan olderThan, string root = null)
        {
            try
            {
                string r = root ?? RootDir;
                if (!Directory.Exists(r)) return;
                foreach (string d in Directory.GetDirectories(r))
                {
                    try
                    {
                        if (DateTime.UtcNow - Directory.GetLastWriteTimeUtc(d) > olderThan)
                            Directory.Delete(d, true);
                    }
                    catch { }
                }
            }
            catch { }
        }
    }
}
