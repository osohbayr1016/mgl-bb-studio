using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace RevitMcpAddin.Licensing.Core
{
    /// <summary>
    /// Серверийн олгосон, ГАРЫН ҮСЭГТЭЙ лиценз (add-in 1.9.0, migration 0374).
    ///
    /// ⚠️ ГЭРЭЭ — `backend/src/lib/revitLicense.ts`-тэй ИХЭР:
    ///   токен   = base64url(payload JSON) + "." + base64url(гарын үсэг)
    ///   гарын үсэг = ECDSA P-256 + SHA-256, IEEE P1363 (r‖s, 64 байт) — ЭХНИЙ ХЭСГИЙН
    ///                ASCII байт дээр (JWS-тэй ижил)
    ///   payload = { v, kid, aud, sub, un, nm, rl, dev, via, [sec], [dk], iat, exp, rfa }
    ///     sec = tpm | software | legacy (төхөөрөмжийн түлхүүрийн хамгаалалт, 0375)
    ///     dk  = төхөөрөмжийн түлхүүрийн key_id — лиценз ЭНЭ түлхүүрт уяатай (хуулбарласан PC-д түлхүүр байхгүй)
    ///
    /// ⚠️ ЯАГААД ГАРЫН ҮСЭГ: серверийн хаяг хэрэглэгчийн тохиргоонд байдаг тул
    ///    «сервер тийм гэв» гэдэгт итгэх нь хуурамч сервер тавиад тойрох зам болно.
    ///    Хувийн түлхүүр зөвхөн Worker-ийн secret-д — хуурамч сервер хүчинтэй
    ///    гарын үсэг зурж чадахгүй.
    ///
    /// Revit / WPF-ээс ҮЛ ХАМААРНА — `tests/Licensing.Tests` шууд эмхэтгэнэ
    /// (net48 · net8 · net10 гурвуулаа: `ECDsa.Create(ECParameters)` нь .NET Framework
    /// 4.7-оос хойш байдаг).
    /// </summary>
    public static class LicenseLease
    {
        public const int Version = 1;
        public const string Audience = "mgl-revit-addin";

        /// <summary>Компьютерын цаг сервертэй зөрөх зөвшөөрөгдөх хэмжээ.</summary>
        public static readonly TimeSpan ClockSkew = TimeSpan.FromMinutes(10);

        /// <summary>
        /// Лицензийг шалгана.  `maxSeenUtc` = энэ компьютер дээр өмнө нь харсан
        /// ХАМГИЙН ХОЖУУ цаг (license.json) — цагийг ухрааж хугацаа сунгахыг барина.
        /// </summary>
        public static LeaseStatus Verify(
            string token,
            IReadOnlyDictionary<string, TrustedKey> keys,
            string deviceId,
            DateTimeOffset nowUtc,
            DateTimeOffset? maxSeenUtc,
            out LeaseInfo info)
        {
            // Төхөөрөмжийн түлхүүрийн уяаг ШАЛГАХГҮЙ (хуучин дуудагчид, тест).
            return VerifyCore(token, keys, deviceId, false, null, nowUtc, maxSeenUtc, out info);
        }

        /// <summary>
        /// Төхөөрөмжийн түлхүүрийн уяатай шалгалт (add-in 1.10.0).  Лиценз `dk` агуулдаг бол
        /// `localKeyId` (энэ компьютерын TPM / CNG түлхүүрийн key_id) ЯГ таарах ёстой —
        /// license.json-ийг түлхүүргүй / өөр түлхүүртэй PC руу хуулбал `WrongDevice`.
        /// `localKeyId == null` (энэ PC-д түлхүүр байхгүй) + лиценз `dk`-тай → `WrongDevice`.
        /// </summary>
        public static LeaseStatus Verify(
            string token,
            IReadOnlyDictionary<string, TrustedKey> keys,
            string deviceId,
            string localKeyId,
            DateTimeOffset nowUtc,
            DateTimeOffset? maxSeenUtc,
            out LeaseInfo info)
        {
            return VerifyCore(token, keys, deviceId, true, localKeyId, nowUtc, maxSeenUtc, out info);
        }

        private static LeaseStatus VerifyCore(
            string token,
            IReadOnlyDictionary<string, TrustedKey> keys,
            string deviceId,
            bool checkKey,
            string localKeyId,
            DateTimeOffset nowUtc,
            DateTimeOffset? maxSeenUtc,
            out LeaseInfo info)
        {
            info = null;
            if (string.IsNullOrWhiteSpace(token)) return LeaseStatus.Missing;

            int dot = token.IndexOf('.');
            if (dot <= 0 || dot != token.LastIndexOf('.') || dot == token.Length - 1)
                return LeaseStatus.Malformed;
            string head = token.Substring(0, dot);

            byte[] payloadBytes, sig;
            try
            {
                payloadBytes = Base64Url.Decode(head);
                sig = Base64Url.Decode(token.Substring(dot + 1));
            }
            catch (FormatException)
            {
                return LeaseStatus.Malformed;
            }

            LeaseInfo parsed;
            try
            {
                parsed = LeaseInfo.Parse(payloadBytes);
            }
            catch (Exception)
            {
                // JsonException, KeyNotFound, InvalidOperation (буруу төрөл),
                // ArgumentException (давхардсан түлхүүр — JsonNode-ийн хэв маяг).
                return LeaseStatus.Malformed;
            }
            if (parsed == null) return LeaseStatus.Malformed;

            if (keys == null || parsed.Kid == null || !keys.TryGetValue(parsed.Kid, out TrustedKey key))
                return LeaseStatus.UnknownKey;
            if (sig.Length != 64 || !key.Verify(Encoding.ASCII.GetBytes(head), sig))
                return LeaseStatus.BadSignature;

            // ⚠️ Гарын үсэг ЗӨВ болсны ДАРАА л агуулгад итгэнэ.
            if (parsed.V != Version || !string.Equals(parsed.Aud, Audience, StringComparison.Ordinal))
                return LeaseStatus.WrongAudience;
            if (string.IsNullOrEmpty(deviceId) ||
                !string.Equals(parsed.DeviceId, deviceId, StringComparison.OrdinalIgnoreCase))
                return LeaseStatus.WrongDevice;
            // ⚠️ Төхөөрөмжийн түлхүүрийн уяа: лиценз `dk`-тэй бол ЭНЭ компьютерын түлхүүртэй таарах ёстой.
            if (checkKey && !string.IsNullOrEmpty(parsed.DeviceKeyId) &&
                (string.IsNullOrEmpty(localKeyId) ||
                 !string.Equals(parsed.DeviceKeyId, localKeyId, StringComparison.OrdinalIgnoreCase)))
                return LeaseStatus.WrongDevice;

            info = parsed;
            if (nowUtc < parsed.IssuedAt - ClockSkew) return LeaseStatus.NotYetValid;
            if (maxSeenUtc.HasValue && nowUtc < maxSeenUtc.Value - ClockSkew) return LeaseStatus.ClockRolledBack;
            if (nowUtc >= parsed.ExpiresAt) return LeaseStatus.Expired;
            return LeaseStatus.Valid;
        }

        /// <summary>Хүчинтэй лицензийг арын дэвсгэрт шинэчлэх цаг болсон уу.</summary>
        public static bool NeedsRefresh(LeaseInfo info, DateTimeOffset nowUtc)
        {
            return info == null || nowUtc >= info.RefreshAfter;
        }
    }

    public enum LeaseStatus
    {
        Valid,
        Missing,
        Malformed,
        UnknownKey,
        BadSignature,
        WrongAudience,
        WrongDevice,
        NotYetValid,
        ClockRolledBack,
        Expired,
    }

    /// <summary>Гарын үсэг нь шалгагдсан лицензийн агуулга.</summary>
    public sealed class LeaseInfo
    {
        public int V { get; private set; }
        public string Kid { get; private set; }
        public string Aud { get; private set; }
        public long Sub { get; private set; }
        public string UserName { get; private set; }
        public string Name { get; private set; }
        public string Role { get; private set; }
        public string DeviceId { get; private set; }
        public string Via { get; private set; }
        /// <summary>tpm | software | legacy (хоосон = хуучин лиценз).</summary>
        public string Security { get; private set; }
        /// <summary>Лицензийн уяатай төхөөрөмжийн түлхүүрийн key_id (хуучин лицензэд хоосон).</summary>
        public string DeviceKeyId { get; private set; }
        public DateTimeOffset IssuedAt { get; private set; }
        public DateTimeOffset ExpiresAt { get; private set; }
        public DateTimeOffset RefreshAfter { get; private set; }

        internal static LeaseInfo Parse(byte[] utf8Json)
        {
            using (JsonDocument doc = JsonDocument.Parse(utf8Json))
            {
                JsonElement r = doc.RootElement;
                if (r.ValueKind != JsonValueKind.Object) return null;
                var info = new LeaseInfo
                {
                    V = r.GetProperty("v").GetInt32(),
                    Kid = r.GetProperty("kid").GetString(),
                    Aud = r.GetProperty("aud").GetString(),
                    Sub = r.GetProperty("sub").GetInt64(),
                    UserName = OptString(r, "un"),
                    Name = OptString(r, "nm"),
                    Role = OptString(r, "rl"),
                    DeviceId = r.GetProperty("dev").GetString(),
                    Via = OptString(r, "via"),
                    Security = OptString(r, "sec"),
                    DeviceKeyId = OptString(r, "dk"),
                    IssuedAt = DateTimeOffset.FromUnixTimeSeconds(r.GetProperty("iat").GetInt64()),
                    ExpiresAt = DateTimeOffset.FromUnixTimeSeconds(r.GetProperty("exp").GetInt64()),
                };
                info.RefreshAfter = r.TryGetProperty("rfa", out JsonElement rfa) && rfa.ValueKind == JsonValueKind.Number
                    ? DateTimeOffset.FromUnixTimeSeconds(rfa.GetInt64())
                    : info.IssuedAt.AddHours(1);
                return info;
            }
        }

        private static string OptString(JsonElement r, string name)
        {
            return r.TryGetProperty(name, out JsonElement e) && e.ValueKind == JsonValueKind.String
                ? e.GetString()
                : null;
        }
    }

    /// <summary>Итгэмжлэгдсэн нийтийн түлхүүр (P-256, JWK-ийн x/y).</summary>
    public sealed class TrustedKey
    {
        public string Kid { get; }
        private readonly byte[] _x;
        private readonly byte[] _y;

        public TrustedKey(string kid, string xB64Url, string yB64Url)
        {
            Kid = kid;
            _x = Base64Url.Decode(xB64Url);
            _y = Base64Url.Decode(yB64Url);
            if (_x.Length != 32 || _y.Length != 32)
                throw new ArgumentException("P-256 нийтийн түлхүүрийн x/y 32 байт байх ёстой", nameof(kid));
        }

        public bool Verify(byte[] data, byte[] signatureP1363)
        {
            try
            {
                using (ECDsa ecdsa = ECDsa.Create(new ECParameters
                {
                    Curve = ECCurve.NamedCurves.nistP256,
                    Q = new ECPoint { X = _x, Y = _y },
                }))
                {
                    return ecdsa.VerifyData(data, signatureP1363, HashAlgorithmName.SHA256);
                }
            }
            catch (CryptographicException)
            {
                return false;
            }
        }
    }

    public static class Base64Url
    {
        public static byte[] Decode(string s)
        {
            if (s == null) throw new FormatException("null");
            string b = s.Replace('-', '+').Replace('_', '/');
            switch (b.Length % 4)
            {
                case 0: break;
                case 2: b += "=="; break;
                case 3: b += "="; break;
                default: throw new FormatException("base64url урт буруу");
            }
            return Convert.FromBase64String(b);
        }

        public static string Encode(byte[] bytes)
        {
            return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        }
    }
}
