using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace RevitMcpAddin.Licensing.Core
{
    /// <summary>
    /// Энэ компьютерын лицензийн таних тэмдэг + техник хангамжийн профайл.
    ///
    /// ⚠️ `DeviceId` нь SHA-256 hex — Windows MachineGuid ба Windows хэрэглэгчийг
    ///    сервер рүү ТҮҮХИЙГЭЭР нь ХЭЗЭЭ Ч илгээхгүй (эзэн 2026-10-01: админд
    ///    компьютерын нэр харагдахгүй).  Лиценз энэ id-д уягдсан тул license.json-ыг
    ///    өөр компьютер руу хуулбал `WrongDevice` болно.
    ///
    /// ⚠️ Профайлын бүрдэл (GPU · цөм · дэлгэц) нь `backend/src/lib/revitLicense.ts`
    ///    `NativeProfile`-тэй ИХЭР — сервер үүнийг ирцийн хөтчийн профайлтай (0328)
    ///    тулгадаг.  Нормчлолыг СЕРВЕР хийнэ; энд зөвхөн түүхий утга.
    /// </summary>
    public sealed class DeviceProfile
    {
        public string DeviceId { get; }
        public IReadOnlyList<string> Gpus { get; }
        public int Cores { get; }
        public IReadOnlyList<string> Screens { get; }

        public DeviceProfile(string deviceId, IEnumerable<string> gpus, int cores, IEnumerable<string> screens)
        {
            DeviceId = deviceId;
            Gpus = Distinct(gpus, 12);
            Cores = cores;
            Screens = Distinct(screens, 12);
        }

        /// <summary>
        /// MachineGuid (Windows суулгац тутамд өвөрмөц) + Windows хэрэглэгч → SHA-256 hex.
        /// Нэг компьютер дээрх хоёр Windows хэрэглэгч = хоёр төхөөрөмж.
        /// </summary>
        public static string ComputeDeviceId(string machineGuid, string windowsUser)
        {
            string raw = "mgl-revit-device|v1|" +
                         (machineGuid ?? string.Empty).Trim().ToLowerInvariant() + "|" +
                         (windowsUser ?? string.Empty).Trim().ToLowerInvariant();
            using (SHA256 sha = SHA256.Create())
            {
                byte[] h = sha.ComputeHash(Encoding.UTF8.GetBytes(raw));
                var sb = new StringBuilder(64);
                foreach (byte b in h) sb.Append(b.ToString("x2"));
                return sb.ToString();
            }
        }

        /// <summary>«WxH» — серверийн `SCREEN_RE`-тэй ижил хэлбэр.</summary>
        public static string ScreenKey(int width, int height)
        {
            return width > 0 && height > 0 ? width + "x" + height : null;
        }

        /// <summary>Админд ба ажилтанд харуулах богино код (сервер ч эхний 8-ыг харуулна).</summary>
        public string ShortId => DeviceId != null && DeviceId.Length >= 8 ? DeviceId.Substring(0, 8) : DeviceId;

        private static IReadOnlyList<string> Distinct(IEnumerable<string> items, int max)
        {
            var list = new List<string>();
            if (items == null) return list;
            foreach (string s in items)
            {
                if (string.IsNullOrWhiteSpace(s)) continue;
                string t = s.Trim();
                if (t.Length > 200) t = t.Substring(0, 200);
                if (!list.Any(x => string.Equals(x, t, StringComparison.OrdinalIgnoreCase))) list.Add(t);
                if (list.Count >= max) break;
            }
            return list;
        }
    }
}
