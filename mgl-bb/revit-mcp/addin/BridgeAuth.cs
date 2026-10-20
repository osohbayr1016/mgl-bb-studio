using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;

namespace RevitMcpAddin
{
    /// <summary>
    /// Локал bridge-ийн session токен.
    ///
    /// ⚠️ ЮУ ЗАСАЖ БАЙГАА ВЭ: өнөөдрийг хүртэл `POST http://localhost:5005/execute`
    /// нь ТОКЕНГҮЙ дурын C#-ыг хүлээж авч, Roslyn-оор эмхэтгэж, амьд Revit
    /// `Transaction` дотор ажиллуулдаг байсан.  Тэр компьютер дээр MGL-ийн
    /// ~1 жилийн хугацаатай API токен сууж байдаг.  Өөрөөр хэлбэл ямар ч
    /// локал процесс (эсвэл хортой вэб хуудас) Revit болон MGL-ийн API-г
    /// бүрэн эзэмшиж чадна байсан.
    ///
    /// ⚠️ ЭНЭ НЬ ХҮЧТЭЙ ХИЛ БИШ.  Тухайн Windows хэрэглэгчээр ажиллаж буй
    /// ямар ч процесс `bridge.json`-ыг уншиж чадна.  Энэ бол гүн хамгаалалт
    /// (defence in depth), тусгаарлалт биш:
    ///   • өөр Windows хэрэглэгч хүрэхгүй (%APPDATA%-гийн ACL)
    ///   • хөтчийн хуудас drive-by хийж чадахгүй (токен мэдэхгүй)
    ///   • дурын код АНХДАГЧААР УНТРААЛТТАЙ (`MGL_ALLOW_EXEC=1` шаардана)
    /// Хэн асуусан ч үүнийг ШУДАРГААР хэл.
    /// </summary>
    public static class BridgeAuth
    {
        private static string _token;

        /// <summary>BOM-гүй UTF-8 — Python клиент BOM дээр унадаг.</summary>
        private static readonly UTF8Encoding NoBomUtf8 = new UTF8Encoding(false);

        private static string Dir =>
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "RevitMcpAddin");

        private static string HandshakePath => Path.Combine(Dir, "bridge.json");

        /// <summary>
        /// Revit асах бүрт ШИНЭ токен үүсгэж, MCP клиентийн уншдаг файлд бичнэ.
        /// %APPDATA%\Roaming нь Windows дээр анхдагчаар зөвхөн тухайн
        /// хэрэглэгч + SYSTEM + Administrators-д нээлттэй тул нэмэлт ACL
        /// тавихгүй (тэр нь `System.IO.FileSystem.AccessControl` пакет
        /// шаардах ба ашиг нь ялимгүй).
        /// </summary>
        public static void Issue(int port)
        {
            _token = Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N");
            try
            {
                Directory.CreateDirectory(Dir);
                var payload = new
                {
                    port,
                    token = _token,
                    pid = Process.GetCurrentProcess().Id,
                    issued_at = DateTime.UtcNow.ToString("o"),
                };
                // ⚠️ BOM-ГҮЙ бичнэ.  `Encoding.UTF8` нь BOM нэмдэг ба Python-ий
                // `json.loads` түүнийг тэмдэгт гэж үзэж унадаг — MCP гүүр
                // "bridge.json уншиж чадсангүй" гэж хэлж эхэлдэг байв.
                File.WriteAllText(HandshakePath, JsonSerializer.Serialize(payload), NoBomUtf8);
            }
            catch
            {
                // Файл бичиж чадсангүй — токен санах ойд хэвээр.  Bridge
                // ажиллана, гэхдээ MCP клиент токеноо олохгүй.  Add-in
                // ачаалагдахаа болих ёсгүй.
            }
        }

        /// <summary>Revit хаагдахад токеныг хүчингүй болгож, файлыг устгана.</summary>
        public static void Revoke()
        {
            _token = null;
            try { File.Delete(HandshakePath); } catch { }
        }

        /// <summary>true = зөвшөөрөв.  Тогтмол хугацааны харьцуулалт.</summary>
        public static bool Check(System.Net.HttpListenerContext ctx)
        {
            if (string.IsNullOrEmpty(_token)) return false;
            string h = ctx?.Request?.Headers?["Authorization"];
            if (h == null || !h.StartsWith("Bearer ", StringComparison.Ordinal)) return false;
            return FixedTimeEquals(h.Substring(7), _token);
        }

        /// <summary>
        /// Дурын C# гүйцэтгэх нь ӨГӨӨМӨР эрх — АНХДАГЧААР УНТРААЛТТАЙ.
        /// Дибаг хийхдээ `MGL_ALLOW_EXEC=1` тавина.
        /// </summary>
        public static bool ArbitraryCodeAllowed =>
            string.Equals(
                Environment.GetEnvironmentVariable("MGL_ALLOW_EXEC"),
                "1",
                StringComparison.Ordinal);

        /// <summary>
        /// Уртын ялгааг ч нуухгүй (урт нь нууц биш), гэхдээ агуулгыг эрт
        /// таслахгүй — тэмдэгт тус бүрийн ялгааг хуримтлуулна.
        /// </summary>
        private static bool FixedTimeEquals(string a, string b)
        {
            if (a == null || b == null) return false;
            if (a.Length != b.Length) return false;
            int diff = 0;
            for (int i = 0; i < a.Length; i++) diff |= a[i] ^ b[i];
            return diff == 0;
        }
    }
}
