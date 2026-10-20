using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;

namespace RevitMcpAddin.Licensing
{
    /// <summary>
    /// Төхөөрөмжид уяатай API SESSION токен (add-in 1.10.0, migration 0375) — ЗӨВХӨН САНАХ ОЙД.
    ///
    /// ЯАГААД: өмнө нь add-in 365 хоногийн `mcp` токеныг settings.json-д хадгалж, бүх REST
    /// дуудлагаа тэрээр хийдэг байв — хулгайлагдвал жилийн турш хүчинтэй.  Одоо дуудлага бүр
    /// 30 минутын `purpose:'revit'` session-оор явна; session-ийг ШИНЭЧЛЭХ нь төхөөрөмжийн
    /// түлхүүрийн гарын үсэг (proof) шаарддаг.  Токеныг тал нь хуулсан хүнд ≤ 30 минут л үлдэнэ.
    ///
    /// Session ДИСКЭНД ХЭЗЭЭ Ч бичигдэхгүй — Revit дахин асахад credential-аар шинэчилнэ.
    /// </summary>
    internal static class DeviceSession
    {
        private static readonly object Gate = new object();
        private static string _token;
        private static DateTimeOffset _expires = DateTimeOffset.MinValue;

        /// <summary>
        /// ӨМНӨХ session токенууд (шинэ нь `_token`, хуучин нь энд; хамгийн ихдээ 16, ЗӨВХӨН санах ойд).
        /// Хоёр зорилго: (1) `SettingsStore.Save()` ХУУЧИРСАН session токеныг ч дискэнд бичихгүй
        /// (`Load → цонх → Save` хооронд session шинэчлэгдсэн байж болно), (2) `SessionTokenHandler` урт
        /// ажил (QTO экспорт) эхлэхэд барьсан хуучин токеныг илгээх агшинд ШИНЭ session-оор солино.
        /// </summary>
        private static readonly List<string> Recent = new List<string>();
        private const int MaxRecent = 16;

        /// <summary>Хугацаа дуусахаас ИЙМ хугацааны өмнө арын дэвсгэрт шинэчилнэ.</summary>
        public static readonly TimeSpan RefreshBefore = TimeSpan.FromMinutes(12);

        private static void Remember(string token)
        {
            if (string.IsNullOrEmpty(token) || Recent.Contains(token)) return;
            Recent.Add(token);
            if (Recent.Count > MaxRecent) Recent.RemoveAt(0);
        }

        public static void Set(string token, DateTimeOffset expiresAt)
        {
            if (string.IsNullOrEmpty(token)) return;
            lock (Gate)
            {
                if (_token != null && !string.Equals(_token, token, StringComparison.Ordinal)) Remember(_token);
                _token = token;
                _expires = expiresAt;
            }
        }

        public static void Clear()
        {
            lock (Gate)
            {
                Remember(_token);
                _token = null;
                _expires = DateTimeOffset.MinValue;
            }
        }

        /// <summary>
        /// Хуучин (өмнөх) session токен ирвэл одоогийн хүчинтэй session-оор СОЛИНО; одоогийнх / танихгүй токен /
        /// session байхгүй бол ХӨНДӨХГҮЙ.
        /// </summary>
        public static string Upgrade(string token)
        {
            lock (Gate)
            {
                if (_token == null || string.Equals(token, _token, StringComparison.Ordinal)) return token;
                return Recent.Contains(token) ? _token : token;
            }
        }

        /// <summary>
        /// Одоогийн session токен.  Хугацаа нь дууссан ч (шинэчлэл амжаагүй) токеныг БУЦААНА —
        /// сервер 401 өгч, шинэчлэл дууссаны дараа дараагийн дуудлага шинэ токеноор явна
        /// (null буцаавал дуудагчид «нэвтрээгүй» гэж андуурна).
        /// </summary>
        public static bool TryGetToken(out string token)
        {
            lock (Gate)
            {
                token = _token;
                return !string.IsNullOrEmpty(_token);
            }
        }

        /// <summary>Одоогийн ЭСВЭЛ өмнөх session токен уу (дискэнд ХЭЗЭЭ Ч бичигдэх ёсгүй токен).</summary>
        public static bool IsSessionToken(string token)
        {
            if (string.IsNullOrEmpty(token)) return false;
            lock (Gate) return string.Equals(token, _token, StringComparison.Ordinal) || Recent.Contains(token);
        }

        /// <summary>Session-ийг шинэчлэх цаг болсон уу (токен байхгүй / удахгүй дуусах).</summary>
        public static bool NeedsRefresh(DateTimeOffset now)
        {
            lock (Gate) return string.IsNullOrEmpty(_token) || now >= _expires - RefreshBefore;
        }
    }

    /// <summary>
    /// `ApiClient.Http`-ийн толгойг барьж, хуучин session токеныг ШИНЭ session-оор сольдог handler.  Дуудагч
    /// (QTO экспорт, цонх) токеноо ажлын эхэнд `SettingsStore.Load()`-оос барьж, 30+ минут ажилласны дараа
    /// илгээхэд сервер 401 өгөхөөс сэргийлнэ — дуудагч бүрийг засахгүйгээр.
    /// </summary>
    internal sealed class SessionTokenHandler : DelegatingHandler
    {
        public SessionTokenHandler(HttpMessageHandler inner) : base(inner) { }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            AuthenticationHeaderValue auth = request.Headers.Authorization;
            if (auth != null && string.Equals(auth.Scheme, "Bearer", StringComparison.OrdinalIgnoreCase) &&
                !string.IsNullOrEmpty(auth.Parameter))
            {
                string current = DeviceSession.Upgrade(auth.Parameter);
                if (!string.Equals(current, auth.Parameter, StringComparison.Ordinal))
                    request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", current);
            }
            return base.SendAsync(request, cancellationToken);
        }
    }

    /// <summary>
    /// Renewal CREDENTIAL (`purpose:'revit-refresh'`, 30 хоног) — DPAPI (CurrentUser)-аар шифрлэгдсэн
    /// `%APPDATA%\RevitMcpAddin\device.json`.
    ///
    /// ⚠️ Энэ нь ГАНЦААРАА ЭРХ ӨГӨХГҮЙ: сервер ЗӨВХӨН лиценз / session шинэчлэх 3 замд хүлээн авдаг бөгөөд
    ///    тэр замууд ч төхөөрөмжийн түлхүүрийн гарын үсэг (proof) шаарддаг.  Файлыг хуулсан халдагч
    ///    TPM-д түлхүүргүй тул ямар ч session авч чадахгүй; бусад /api замд 401.
    /// ⚠️ DPAPI нь ХҮЧТЭЙ ХИЛ БИШ (тухайн хэрэглэгчээр ажиллаж буй процесс тайлж чадна) — зөвхөн файл
    ///    хуулах / нөөцлөх эрсдэлийг хаана.  Жинхэнэ хамгаалалт нь TPM түлхүүр.
    /// </summary>
    internal static class DeviceCredentialStore
    {
        private static readonly object Gate = new object();

        private static string FilePath => Path.Combine(SettingsStore.Dir, "device.json");

        public static string Load()
        {
            lock (Gate)
            {
                try
                {
                    if (!File.Exists(FilePath)) return null;
                    DeviceFile f = JsonSerializer.Deserialize<DeviceFile>(File.ReadAllText(FilePath));
                    return SettingsStore.UnprotectString(f?.CredentialEnc);
                }
                catch
                {
                    return null;
                }
            }
        }

        public static bool Has()
        {
            return !string.IsNullOrEmpty(Load());
        }

        public static void Save(string credential)
        {
            if (string.IsNullOrEmpty(credential)) return;
            lock (Gate)
            {
                try
                {
                    string enc = SettingsStore.ProtectString(credential);
                    // ⚠️ DPAPI амжилтгүй бол ИЛ БИЧИХГҮЙ (settings.json-ы нэгэн адил) — энэ сессэд л ажиллана.
                    if (enc == null) return;
                    Directory.CreateDirectory(SettingsStore.Dir);
                    string tmp = FilePath + ".tmp";
                    File.WriteAllText(tmp, JsonSerializer.Serialize(new DeviceFile { CredentialEnc = enc }));
                    if (File.Exists(FilePath)) File.Replace(tmp, FilePath, null);
                    else File.Move(tmp, FilePath);
                }
                catch
                {
                    // Диск бичигдэхгүй — санах ойн session хэвээр.
                }
            }
        }

        public static void Clear()
        {
            lock (Gate)
            {
                try { if (File.Exists(FilePath)) File.Delete(FilePath); } catch { }
            }
        }

        private sealed class DeviceFile
        {
            [JsonPropertyName("credential_enc")] public string CredentialEnc { get; set; }
        }
    }
}
