using System;
using System.Globalization;
using System.Text.Json;

namespace RevitMcpAddin.Licensing.Core
{
    /// <summary>
    /// Токен / лицензийн `sub`-ийг (ERP ажилтны id) ГАРЫН ҮСЭГ ШАЛГАХГҮЙГЭЭР уншина.
    ///
    /// ⚠️ ЗӨВХӨН ТӨХӨӨРӨМЖИЙН ТҮЛХҮҮРИЙН НЭРИЙГ СОНГОХОД (`DeviceKeyStore.ForUser`).  Эрхийн шийдвэр БИШ:
    ///    сервер токен бүрийг өөрөө шалгадаг, лиценз `LicenseLease.Verify`-аар гарын үсэг + `dk`-ээ шалгагддаг —
    ///    хуурамч `sub` нь зөвхөн буруу (байхгүй) түлхүүр сонгуулж, шалгалт унана.
    /// </summary>
    public static class TokenPeek
    {
        /// <summary>JWT (`header.payload.signature`) payload-ын `sub`.  Уншиж чадахгүй бол null.</summary>
        public static long? JwtSub(string jwt)
        {
            if (string.IsNullOrWhiteSpace(jwt)) return null;
            string[] parts = jwt.Split('.');
            return parts.Length == 3 ? SubOf(parts[1]) : null;
        }

        /// <summary>Лиценз (`payload.signature`) payload-ын `sub`.  Уншиж чадахгүй бол null.</summary>
        public static long? LeaseSub(string lease)
        {
            if (string.IsNullOrWhiteSpace(lease)) return null;
            string[] parts = lease.Split('.');
            return parts.Length == 2 ? SubOf(parts[0]) : null;
        }

        private static long? SubOf(string b64url)
        {
            try
            {
                byte[] json = Base64Url.Decode(b64url);
                using (JsonDocument doc = JsonDocument.Parse(json))
                {
                    JsonElement r = doc.RootElement;
                    if (r.ValueKind != JsonValueKind.Object || !r.TryGetProperty("sub", out JsonElement s)) return null;
                    long v;
                    if (s.ValueKind == JsonValueKind.Number && s.TryGetInt64(out v)) return v > 0 ? v : (long?)null;
                    if (s.ValueKind == JsonValueKind.String &&
                        long.TryParse(s.GetString(), NumberStyles.None, CultureInfo.InvariantCulture, out v))
                        return v > 0 ? v : (long?)null;
                    return null;
                }
            }
            catch (Exception)
            {
                return null;
            }
        }
    }
}
