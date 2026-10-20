using System;
using System.Security.Cryptography;
using System.Text;
using RevitMcpAddin.Licensing.Core;

// Зөвхөн Windows-ийн CNG (add-in ч, тест ч Windows дээр л ажиллана).
#pragma warning disable CA1416

namespace RevitMcpAddin.Licensing
{
    /// <summary>
    /// Төхөөрөмжийн ХУВИЙН түлхүүр (add-in 1.10.0, migration 0375).  Windows CNG дахь ECDSA P-256:
    ///   1) «Microsoft Platform Crypto Provider» — TPM-д хадгалагдсан, ЭКСПОРТЛОГДОХГҮЙ түлхүүр
    ///      (`security_level = tpm`).  Хувийн түлхүүр TPM-ээс ГАРДАГГҮЙ тул DLL, settings.json,
    ///      license.json, токеныг бүгдийг нь хуулсан ч өөр компьютер challenge-д хариулж чадахгүй.
    ///   2) TPM байхгүй / ажиллахгүй бол «Microsoft Software Key Storage Provider» — экспортын
    ///      бодлого `None` (энгийн экспорт боломжгүй) боловч түлхүүр дискэн дээр, тухайн Windows
    ///      хэрэглэгчийн профайлд хадгалагддаг (`security_level = software`).  Энэ нь ТОДОРХОЙ
    ///      бага хамгаалалт: сервер мэдэж, admin-д харуулна, `revit.require_tpm` бодлогоор
    ///      хүлээн авахгүй байж болно.  ЧИМЭЭГҮЙ downgrade ХЭЗЭЭ Ч хийхгүй.
    ///
    /// ⚠️ Хувийн түлхүүр сервер рүү, settings.json, license.json, лог, registry-д ХЭЗЭЭ Ч явахгүй —
    ///    энэ класс зөвхөн НИЙТИЙН хагасыг (X, Y) ба гарын үсгийг гаргана.
    /// ⚠️ Түлхүүрийг ӨӨР компьютер руу шилжүүлэх зам БАЙХГҮЙ (Windows дахин суулгах, TPM цэвэрлэх,
    ///    шинэ PC → admin хуучныг цуцлаад ШИНЭ түлхүүрээр бүртгүүлнэ).
    /// ⚠️ CNG түлхүүр нь Windows хэрэглэгч тус бүрийнх (UserKey) — device_id мөн хэрэглэгчийг агуулдаг.
    /// </summary>
    public sealed class DeviceKeyStore
    {
        /// <summary>Production түлхүүрийн нэрийн угтвар (хувилбар өөрчлөгдвөл `v2` — хуучин түлхүүр хэвээр үлдэнэ).</summary>
        public const string DefaultKeyName = "MGL-Revit-Device-v1";

        private static readonly CngProvider TpmProvider = new CngProvider("Microsoft Platform Crypto Provider");
        private static readonly CngProvider SoftProvider = CngProvider.MicrosoftSoftwareKeyStorageProvider;

        /// <summary>
        /// ERP ажилтан ТУС БҮРИЙН түлхүүр: `MGL-Revit-Device-v1-u&lt;user_id&gt;`.
        ///
        /// ⚠️ ЯАГААД АЖИЛТАН ТУТАМ: сервер нэг түлхүүрийг ГАНЦ (ажилтан × төхөөрөмж) бүртгэлд зөвшөөрдөг.  Түлхүүр
        ///    Windows хэрэглэгч тутам ганц байхад нэг Windows профайлтай компьютерт хоёр дахь ажилтан нэвтэрвэл
        ///    (компьютер өөр ажилтанд шилжих, түр ашиглах) түлхүүр нь «өөр бүртгэлд ашиглагдаж байна» гэж ХЭЗЭЭ Ч
        ///    бүртгэгдэхгүй, admin-ы зөвшөөрөл ч тусгүй байв.  Ажилтан тутам тусдаа түлхүүр нь бие биенийхээ
        ///    бүртгэлд хүрэхгүй.  Хамгаалалт сулраагүй: түлхүүр бүр TPM-д, экспортлогдохгүй, бүртгэл бүр нууц үг
        ///    + төхөөрөмжийн шийдвэр (ажлын PC / admin) шаардсаар.
        /// </summary>
        public static DeviceKeyStore ForUser(long userId)
        {
            if (userId <= 0) throw new ArgumentOutOfRangeException(nameof(userId));
            return new DeviceKeyStore(DefaultKeyName + "-u" + userId.ToString(System.Globalization.CultureInfo.InvariantCulture), true);
        }

        private readonly string _name;
        private readonly bool _allowTpm;

        /// <param name="keyName">CNG түлхүүрийн нэр (тест өөр нэр өгч, Production түлхүүрт хүрэхгүй).</param>
        /// <param name="allowTpm">false бол TPM-ийг оролдохгүй (TPM-гүй CI / тест).</param>
        public DeviceKeyStore(string keyName, bool allowTpm)
        {
            _name = keyName;
            _allowTpm = allowTpm;
        }

        /// <summary>Бүртгэлтэй түлхүүр байвал нээнэ; байхгүй бол `null` (шинэ түлхүүр ҮҮСГЭХГҮЙ).</summary>
        public DeviceSigner TryOpenExisting()
        {
            if (_allowTpm)
            {
                DeviceSigner s = TryOpen(TpmProvider, "tpm");
                if (s != null) return s;
            }
            return TryOpen(SoftProvider, "software");
        }

        /// <summary>
        /// Түлхүүр байвал нээнэ, байхгүй бол ҮҮСГЭНЭ: эхлээд TPM, амжилтгүй бол програмын (software).
        /// Хоёулаа амжилтгүй бол `null` + `error`.
        /// </summary>
        public DeviceSigner OpenOrCreate(out string error)
        {
            error = null;
            DeviceSigner existing = TryOpenExisting();
            if (existing != null) return existing;

            // ⚠️ TPM-д түлхүүр БАЙГАА атлаа нээгдэхгүй байгаа (TPM завгүй, түр алдаа) үед програмын түлхүүр ҮҮСГЭХГҮЙ:
            //    эс бөгөөс чимээгүйхэн хоёр дахь, ДАВХАР бага хамгаалалттай түлхүүр үүсч, сервер өөр key_id хараад
            //    татгалзана.  Хэрэглэгчид ил хэлнэ.
            if (_allowTpm && ExistsSafe(TpmProvider))
            {
                error = "TPM-д хадгалсан төхөөрөмжийн түлхүүр байгаа боловч одоо нээгдсэнгүй. Түр хүлээгээд дахин оролдоно уу.";
                return null;
            }

            string tpmError = null;
            if (_allowTpm)
            {
                // Эхлээд экспортын бодлого `None`-той; Platform provider энэ шинж чанарыг хүлээн авахгүй бол
                // бодлогогүйгээр (TPM түлхүүр өөрөө экспортлогдохгүй) дахин оролдоно.  Хоёулаа унавал л програмын түлхүүр.
                foreach (bool setExportPolicy in new[] { true, false })
                {
                    try
                    {
                        DeviceSigner s = Create(TpmProvider, "tpm", setExportPolicy);
                        if (s != null) return s;
                    }
                    catch (Exception ex)
                    {
                        tpmError = ex.Message;
                        // Эхний оролдлого түлхүүрийг хагас үлдээсэн бол ашиглана (давхар үүсгэхгүй).
                        DeviceSigner left = TryOpen(TpmProvider, "tpm");
                        if (left != null) return left;
                    }
                }
            }
            try
            {
                DeviceSigner s = Create(SoftProvider, "software", true);
                if (s != null)
                {
                    // Чимээгүй downgrade БИШ: яагаад TPM ашиглаагүйг тэмдэглэнэ (цонх харуулна).
                    if (tpmError != null) s.FallbackReason = tpmError;
                    else if (!_allowTpm) s.FallbackReason = "TPM-ийг ашиглаагүй (тохиргоо).";
                    return s;
                }
            }
            catch (Exception ex)
            {
                error = "Төхөөрөмжийн түлхүүр үүсгэж чадсангүй: " + ex.Message +
                        (tpmError != null ? " (TPM: " + tpmError + ")" : string.Empty);
                return null;
            }
            error = "Төхөөрөмжийн түлхүүр үүсгэж чадсангүй.";
            return null;
        }

        private bool ExistsSafe(CngProvider provider)
        {
            try { return CngKey.Exists(_name, provider, CngKeyOpenOptions.UserKey); }
            catch (Exception) { return false; }
        }

        /// <summary>Түлхүүрийг устгана (Тест; admin цуцалсны дараа шинэ түлхүүр хэрэгтэй үед).</summary>
        public void Delete()
        {
            foreach (CngProvider p in new[] { TpmProvider, SoftProvider })
            {
                try
                {
                    if (!CngKey.Exists(_name, p, CngKeyOpenOptions.UserKey)) continue;
                    using (CngKey k = CngKey.Open(_name, p, CngKeyOpenOptions.UserKey)) k.Delete();
                }
                catch (Exception)
                {
                    // Байхгүй / эрхгүй — алгасна.
                }
            }
        }

        private DeviceSigner TryOpen(CngProvider provider, string level)
        {
            try
            {
                if (!CngKey.Exists(_name, provider, CngKeyOpenOptions.UserKey)) return null;
                using (CngKey key = CngKey.Open(_name, provider, CngKeyOpenOptions.UserKey))
                {
                    return DeviceSigner.From(_name, provider, level, key);
                }
            }
            catch (Exception)
            {
                return null;
            }
        }

        private DeviceSigner Create(CngProvider provider, string level, bool setExportPolicy)
        {
            var p = new CngKeyCreationParameters
            {
                Provider = provider,
                KeyUsage = CngKeyUsages.Signing,
                KeyCreationOptions = CngKeyCreationOptions.None,
            };
            // ⚠️ ЭКСПОРТЛОГДОХГҮЙ — хувийн хагас хэзээ ч түлхүүрийн сангаас гарахгүй.
            if (setExportPolicy) p.ExportPolicy = CngExportPolicies.None;
            using (CngKey key = CngKey.Create(CngAlgorithm.ECDsaP256, _name, p))
            {
                return DeviceSigner.From(_name, provider, level, key);
            }
        }
    }

    /// <summary>
    /// Нээгдсэн түлхүүрийн «харагдах нүүр» — нийтийн хагас + гарын үсэг зурах.  Хувийн түлхүүрийг
    /// ХЭЗЭЭ Ч гаргахгүй; гарын үсэг бүрт CNG түлхүүрийг ДАХИН нээнэ (handle удаан барихгүй).
    /// </summary>
    public sealed class DeviceSigner
    {
        private readonly string _name;
        private readonly CngProvider _provider;

        /// <summary>tpm | software</summary>
        public string SecurityLevel { get; private set; }
        public string KeyId { get; private set; }
        /// <summary>TPM-ийн оронд програмын түлхүүр сонгосон шалтгаан (зөвхөн түлхүүр үүсгэсэн агшинд мэдэгдэнэ).</summary>
        public string FallbackReason { get; internal set; }
        /// <summary>Нийтийн түлхүүрийн X (base64url, 32 байт).</summary>
        public string X { get; private set; }
        /// <summary>Нийтийн түлхүүрийн Y (base64url, 32 байт).</summary>
        public string Y { get; private set; }

        private DeviceSigner(string name, CngProvider provider)
        {
            _name = name;
            _provider = provider;
        }

        internal static DeviceSigner From(string name, CngProvider provider, string level, CngKey key)
        {
            byte[] blob = key.Export(CngKeyBlobFormat.EccPublicBlob);
            if (!DeviceProof.TryParseEccPublicBlob(blob, out byte[] x, out byte[] y)) return null;
            return new DeviceSigner(name, provider)
            {
                SecurityLevel = level,
                KeyId = DeviceProof.KeyId(x, y),
                X = Base64Url.Encode(x),
                Y = Base64Url.Encode(y),
            };
        }

        /// <summary>
        /// UTF-8 мөрийг ECDSA P-256 + SHA-256-аар гарын үсэг зурна → base64url (IEEE P1363, 64 байт —
        /// сервер `crypto.subtle.verify`-ийн хэлбэр).  Түлхүүр алга болсон бол шиднэ.
        /// </summary>
        public string Sign(string message)
        {
            using (CngKey key = CngKey.Open(_name, _provider, CngKeyOpenOptions.UserKey))
            using (var ecdsa = new ECDsaCng(key))
            {
                byte[] sig = ecdsa.SignData(Encoding.UTF8.GetBytes(message), HashAlgorithmName.SHA256);
                return Base64Url.Encode(sig);
            }
        }
    }
}
