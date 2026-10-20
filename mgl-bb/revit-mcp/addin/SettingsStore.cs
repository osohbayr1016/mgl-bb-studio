using System;
using System.IO;
using System.Text.Json;

namespace RevitMcpAddin
{
    /// <summary>
    /// Persists add-in settings under %APPDATA%\RevitMcpAddin\settings.json.
    /// A missing or corrupt file falls back to defaults instead of throwing.
    /// </summary>
    public static class SettingsStore
    {
        private static readonly JsonSerializerOptions WriteOptions = new JsonSerializerOptions
        {
            WriteIndented = true
        };

        internal static string Dir =>
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "RevitMcpAddin");

        private static string SettingsPath => Path.Combine(Dir, "settings.json");

        private static AddinSettings _cache;
        private static readonly object CacheGate = new object();

        /// <summary>
        /// Тохиргоог КЭШЭЭС уншина.
        ///
        /// ⚠️ ЯАГААД: `LoadFromDisk()` нь дуудлага БҮРТ файл уншиж, DPAPI
        /// `Unprotect` хийдэг.  `AssistantPane.Settings` нь PROPERTY тул нэг
        /// мессежид ДОР ХАЯЖ ХОЁР удаа ажилладаг (ноорог бэлдэх зам ба
        /// `FlushLogsSoon`); репо даяар 16 дуудагчтай.  Локал SSD дээр хор
        /// хоргүй; ROAMING PROFILE (домэйны хэрэглэгч, сүлжээний %APPDATA%)
        /// дээр энэ нь ХЯЗГААРГҮЙ сааталт — мессеж бүр сүлжээ хүлээнэ.
        ///
        /// ⚠️ `Save()` нь кэшийг ЗААВАЛ хүчингүй болгоно, эс бөгөөс Тохиргоо
        /// цонхноос шинэ токен бичсний дараа самбар ХУУЧИН токеноор явна.
        ///
        /// ⚠️ ХУУЛБАР буцаана — дуудагчид объектыг өөрчилдөг (`ShallowCopy`
        /// дээрх тайлбарыг үз).
        /// </summary>
        public static AddinSettings Load()
        {
            AddinSettings copy;
            lock (CacheGate)
            {
                if (_cache == null) _cache = LoadFromDisk();
                copy = _cache.ShallowCopy();
            }
            // ⚠️ ТӨХӨӨРӨМЖИД УЯАТАЙ SESSION (1.10.0, migration 0375): add-in-ий ~25 дуудагч `st.Token`-ийг
            // шууд уншдаг.  Төхөөрөмжийн session идэвхтэй бол тэдэнд 365 хоногийн токены оронд 30 минутын
            // session токеныг өгнө — дуудагч бүрийг засахгүйгээр.  Session ДИСКЭНД ХЭЗЭЭ Ч бичигдэхгүй
            // (`Save()` шалгана).  Дуусахад ойртсон бол арын дэвсгэрт шинэчлэгдэнэ (UI thread-ийг саатуулахгүй).
            if (Licensing.DeviceSession.TryGetToken(out string session)) copy.Token = session;
            Licensing.LicenseGate.OnSettingsRead();
            return copy;
        }

        /// <summary>
        /// Дискэнд хадгалагдсан (хуучин 365 хоногийн) токеныг УСТГАНА.  `Save(st)` нь session токеныг
        /// дискэнд хадгалахгүйн тулд хуучин токеныг хэвээр үлдээдэг тул ЭНЭ ЗАМААР л цэвэрлэнэ
        /// (гарах, төхөөрөмжийн горимд шилжихэд).
        /// </summary>
        public static void ClearStoredToken()
        {
            Directory.CreateDirectory(Dir);
            AddinSettings s;
            lock (CacheGate)
            {
                if (_cache == null) _cache = LoadFromDisk();
                s = _cache.ShallowCopy();
            }
            s.Token = null;
            s.TokenEnc = null;
            File.WriteAllText(SettingsPath, JsonSerializer.Serialize(s, WriteOptions));
            Invalidate();
        }

        /// <summary>Дискэнд хадгалагдсан токен (session БИШ) — `Save()` үүнийг хэвээр үлдээнэ.</summary>
        private static string StoredToken()
        {
            lock (CacheGate)
            {
                if (_cache == null) _cache = LoadFromDisk();
                return _cache.Token;
            }
        }

        /// <summary>Дискэнд хадгалагдсан хуучин (365 хоногийн) токен — session БИШ.</summary>
        internal static string LegacyToken() => StoredToken();

        internal static string ProtectString(string plain) => Protect(plain);

        internal static string UnprotectString(string b64) => Unprotect(b64);

        /// <summary>
        /// Кэшийг хаяна — дараагийн `Load()` дискнээс уншина.
        ///
        /// ⚠️ Тохиргоог ГАДНААС (өөр процесс, гараар засварласан файл)
        /// өөрчилсөн бол мөн энийг дуудна.  Add-in дотор `Save()` өөрөө дууддаг.
        /// </summary>
        public static void Invalidate()
        {
            lock (CacheGate) { _cache = null; }
        }

        private static AddinSettings LoadFromDisk()
        {
            try
            {
                if (File.Exists(SettingsPath))
                {
                    AddinSettings settings =
                        JsonSerializer.Deserialize<AddinSettings>(File.ReadAllText(SettingsPath));
                    if (settings != null)
                    {
                        if (string.IsNullOrWhiteSpace(settings.ApiHost))
                            settings.ApiHost = AddinSettings.DefaultApiHost;

                        // Шифрлэгдсэн токеныг тайлна.  Тайлж чадахгүй бол
                        // (файлыг өөр хэрэглэгч/машин руу хуулсан) чимээгүй
                        // хоосон үлдээнэ — хэрэглэгч дахин нэвтэрнэ.
                        if (!string.IsNullOrEmpty(settings.TokenEnc) &&
                            string.IsNullOrEmpty(settings.Token))
                        {
                            settings.Token = Unprotect(settings.TokenEnc);
                        }
                        return settings;
                    }
                }
            }
            catch
            {
                // Гэмтсэн файл — default тохиргоогоор үргэлжлүүлнэ.
            }
            return new AddinSettings();
        }

        /// <summary>
        /// Тохиргоог хадгална.
        ///
        /// ⚠️ ТОКЕНЫГ ИЛ БИЧИХГҮЙ.  Урьд нь ~1 ЖИЛИЙН хугацаатай API токен
        /// settings.json-д ил бичигдэж байсан — тэр файлыг уншсан ямар ч зүйл
        /// MGL-ийн API-г бүрэн эзэмшинэ.  Одоо DPAPI-аар (CurrentUser) шифрлэж
        /// token_enc-д бичнэ: тухайн Windows хэрэглэгч + тухайн машинд л
        /// тайлагдана, файлыг хуулбарлаад өөр газар ашиглах боломжгүй.
        ///
        /// ⚠️ Энэ нь ХҮЧТЭЙ ХИЛ БИШ: ТУХАЙН хэрэглэгчээр ажиллаж буй процесс
        /// DPAPI-г мөн дуудаж чадна.  Файл хуулагдах/нөөцлөгдөх эрсдэлийг л
        /// хаана.  Токеныг цуцлах ганц арга нь JWT_SECRET сэлгэх хэвээр.
        /// </summary>
        public static void Save(AddinSettings settings)
        {
            Directory.CreateDirectory(Dir);

            string plain = settings.Token;
            // ⚠️ Төхөөрөмжийн SESSION токеныг (30 минут) дискэнд ХЭЗЭЭ Ч бичихгүй: `Load()` нь түүнийг
            // `Token` талбарт шигтгэдэг тул `Load → засах → Save` хийсэн дуудагч санамсаргүй бичих байсан.
            // Тэр үед дискэн дээрх (хуучин) токен хэвээр үлдэнэ.
            string toPersist = Licensing.DeviceSession.IsSessionToken(plain) ? StoredToken() : plain;
            string enc = Protect(toPersist);
            string prevEnc = settings.TokenEnc;
            try
            {
                settings.TokenEnc = enc;
                // Шифрлэж чадсан үед л ил токеныг устгана — DPAPI боломжгүй
                // орчинд add-in ажиллахаа болих ёсгүй.
                settings.Token = enc != null ? null : toPersist;
                File.WriteAllText(SettingsPath, JsonSerializer.Serialize(settings, WriteOptions));
            }
            finally
            {
                // Дуудагчийн объект хэвээрээ ажиллана.
                settings.Token = plain;
                settings.TokenEnc = enc ?? prevEnc;
                // ⚠️ ЗААВАЛ.  Үүнгүйгээр Тохиргоо цонхноос шинэ токен бичсний
                // дараа самбар ХУУЧИН токеноор явж, бүх хүсэлт 401 өгнө.
                Invalidate();
            }
        }

        /// <summary>DPAPI (CurrentUser) -> base64.  Амжилтгүй бол null.</summary>
        private static string Protect(string plain)
        {
            if (string.IsNullOrEmpty(plain)) return null;
            try
            {
                byte[] bytes = System.Text.Encoding.UTF8.GetBytes(plain);
                byte[] enc = System.Security.Cryptography.ProtectedData.Protect(
                    bytes, null, System.Security.Cryptography.DataProtectionScope.CurrentUser);
                return Convert.ToBase64String(enc);
            }
            catch
            {
                return null;
            }
        }

        /// <summary>base64 -> DPAPI тайлалт.  Амжилтгүй бол null.</summary>
        private static string Unprotect(string b64)
        {
            if (string.IsNullOrEmpty(b64)) return null;
            try
            {
                byte[] enc = Convert.FromBase64String(b64);
                byte[] bytes = System.Security.Cryptography.ProtectedData.Unprotect(
                    enc, null, System.Security.Cryptography.DataProtectionScope.CurrentUser);
                return System.Text.Encoding.UTF8.GetString(bytes);
            }
            catch
            {
                return null;
            }
        }

        /// <summary>
        /// Сүлжээгүй үед payload-оо алдахгүйн тулд settings.json-ы хажууд
        /// last-run.json болгож хадгална. Returns the written file path.
        /// </summary>
        public static string SaveLastPayload(string json)
        {
            Directory.CreateDirectory(Dir);
            string path = Path.Combine(Dir, "last-run.json");
            File.WriteAllText(path, json);
            return path;
        }
    }
}
