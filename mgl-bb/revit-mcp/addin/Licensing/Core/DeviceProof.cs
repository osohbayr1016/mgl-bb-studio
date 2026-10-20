using System;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace RevitMcpAddin.Licensing.Core
{
    /// <summary>
    /// Төхөөрөмжийн түлхүүрийн PROOF-ийн ГЭРЭЭ (add-in 1.10.0, migration 0375) — ЦЭВЭР
    /// (Revit / WPF / Windows-аас үл хамаарна; `tests/Licensing.Tests` шууд эмхэтгэнэ).
    ///
    /// ⚠️ `backend/src/lib/revitDeviceKey.ts`-тэй БАЙТ-ИЖИЛ:
    ///   message   = «mgl-revit-device-proof|v1|&lt;purpose&gt;|&lt;challenge_id&gt;|&lt;nonce&gt;|
    ///                &lt;user_id&gt;|&lt;device_id&gt;|&lt;key_id&gt;» (UTF-8)
    ///   signature = ECDSA P-256 + SHA-256, IEEE P1363 (r‖s, 64 байт), base64url
    ///   key_id    = SHA-256(X‖Y) hex (X, Y — нийтийн түлхүүрийн 32 байт тус бүр)
    ///
    /// ЯАГААД device_id ГАНЦААРАА хангалтгүй: license.json + settings.json-г өөр
    /// компьютер руу хуулсан хүн device_id-г мэдэж, хуурамчаар илгээж чадна.  Хувийн
    /// түлхүүр нь TPM / CNG-д (экспортлогдохгүй) тул challenge-д зөвхөн ЭНЭ компьютер
    /// хариулж чадна.  Challenge нэг удаагийн, 2 минутын настай, хэрэглэгч + төхөөрөмж +
    /// зорилгод уяатай — зөвхөн гарын үсэг зурсан мөр нь ямар ч replay-д хэрэггүй.
    /// </summary>
    public static class DeviceProof
    {
        public const string Audience = "mgl-revit-device-proof";
        public const string Version = "v1";
        public const string PurposeEnroll = "enroll";
        public const string PurposeLicense = "license";
        public const string PurposeSession = "session";

        public static string Message(
            string purpose, string challengeId, string nonce, long userId, string deviceId, string keyId)
        {
            return string.Join("|", new[]
            {
                Audience,
                Version,
                purpose,
                challengeId,
                nonce,
                userId.ToString(CultureInfo.InvariantCulture),
                deviceId,
                keyId,
            });
        }

        /// <summary>key_id = SHA-256(X‖Y) hex (64 тэмдэгт).  X, Y — 32 байт тус бүр.</summary>
        public static string KeyId(byte[] x, byte[] y)
        {
            if (x == null || y == null || x.Length != 32 || y.Length != 32)
                throw new ArgumentException("P-256 нийтийн түлхүүрийн x/y 32 байт байх ёстой");
            var all = new byte[64];
            Buffer.BlockCopy(x, 0, all, 0, 32);
            Buffer.BlockCopy(y, 0, all, 32, 32);
            using (SHA256 sha = SHA256.Create())
            {
                byte[] h = sha.ComputeHash(all);
                var sb = new StringBuilder(64);
                foreach (byte b in h) sb.Append(b.ToString("x2", CultureInfo.InvariantCulture));
                return sb.ToString();
            }
        }

        /// <summary>
        /// Windows CNG-ийн ECCPUBLIC_BLOB (magic 4 + cbKey 4 + X + Y) → (X, Y).
        /// P-256 бус / гэмтсэн блок → `false`.
        /// </summary>
        public static bool TryParseEccPublicBlob(byte[] blob, out byte[] x, out byte[] y)
        {
            x = null;
            y = null;
            if (blob == null || blob.Length != 8 + 64) return false;
            int cbKey = blob[4] | (blob[5] << 8) | (blob[6] << 16) | (blob[7] << 24);
            if (cbKey != 32) return false;
            x = new byte[32];
            y = new byte[32];
            Buffer.BlockCopy(blob, 8, x, 0, 32);
            Buffer.BlockCopy(blob, 8 + 32, y, 0, 32);
            return true;
        }
    }

    /// <summary>`POST /api/revit/device/challenge`-ийн хариу.</summary>
    public sealed class ChallengeResult
    {
        public bool Ok { get; internal set; }
        public int Status { get; internal set; }
        public string ChallengeId { get; internal set; }
        public string Nonce { get; internal set; }
        public long UserId { get; internal set; }
        public string KeyId { get; internal set; }
        public string Code { get; internal set; }
        public string Message { get; internal set; }
    }

    /// <summary>`POST /api/revit/device/enroll`-ийн хариу.</summary>
    public sealed class EnrollResult
    {
        public bool Ok { get; internal set; }
        public int Status { get; internal set; }
        /// <summary>auto | approved | pending</summary>
        public string DeviceStatus { get; internal set; }
        public string Reason { get; internal set; }
        public string Code { get; internal set; }
        public string Message { get; internal set; }
        public string Credential { get; internal set; }
        public DateTimeOffset? CredentialExpiresAt { get; internal set; }
    }

    /// <summary>`POST /api/revit/device/session`-ийн хариу.</summary>
    public sealed class SessionResult
    {
        public bool Ok { get; internal set; }
        public int Status { get; internal set; }
        public string Token { get; internal set; }
        public DateTimeOffset? ExpiresAt { get; internal set; }
        public string Credential { get; internal set; }
        public DateTimeOffset? CredentialExpiresAt { get; internal set; }
        public string Code { get; internal set; }
        public string Message { get; internal set; }
    }

    /// <summary>Төхөөрөмжийн замуудын хариуг АНГИЛНА (цэвэр).</summary>
    public static class DeviceResponses
    {
        public static ChallengeResult ParseChallenge(int status, string body)
        {
            var r = new ChallengeResult { Status = status };
            JsonElement root;
            if (!TryRoot(body, out root, out JsonDocument doc))
            {
                return r;
            }
            using (doc)
            {
                r.Code = Str(root, "code");
                r.Message = Str(root, "error");
                if (status != 200 || !Bool(root, "ok")) return r;
                r.ChallengeId = Str(root, "challenge_id");
                r.Nonce = Str(root, "nonce");
                r.KeyId = Str(root, "key_id");
                if (root.TryGetProperty("user_id", out JsonElement u) && u.ValueKind == JsonValueKind.Number)
                    r.UserId = u.GetInt64();
                r.Ok = !string.IsNullOrEmpty(r.ChallengeId) && !string.IsNullOrEmpty(r.Nonce) && r.UserId > 0;
                return r;
            }
        }

        public static EnrollResult ParseEnroll(int status, string body)
        {
            var r = new EnrollResult { Status = status };
            JsonElement root;
            if (!TryRoot(body, out root, out JsonDocument doc)) return r;
            using (doc)
            {
                r.Code = Str(root, "code");
                r.Message = Str(root, "error") ?? Str(root, "message");
                if (status != 200 || !Bool(root, "ok")) return r;
                r.DeviceStatus = Str(root, "status");
                r.Reason = Str(root, "reason");
                if (root.TryGetProperty("credential", out JsonElement c) && c.ValueKind == JsonValueKind.Object)
                {
                    r.Credential = Str(c, "token");
                    r.CredentialExpiresAt = Time(c, "expires_at");
                }
                r.Ok = !string.IsNullOrEmpty(r.DeviceStatus);
                return r;
            }
        }

        public static SessionResult ParseSession(int status, string body)
        {
            var r = new SessionResult { Status = status };
            JsonElement root;
            if (!TryRoot(body, out root, out JsonDocument doc)) return r;
            using (doc)
            {
                r.Code = Str(root, "code");
                r.Message = Str(root, "error");
                if (status != 200 || !Bool(root, "ok")) return r;
                if (root.TryGetProperty("session", out JsonElement s) && s.ValueKind == JsonValueKind.Object)
                {
                    r.Token = Str(s, "token");
                    r.ExpiresAt = Time(s, "expires_at");
                }
                if (root.TryGetProperty("credential", out JsonElement c) && c.ValueKind == JsonValueKind.Object)
                {
                    r.Credential = Str(c, "token");
                    r.CredentialExpiresAt = Time(c, "expires_at");
                }
                r.Ok = !string.IsNullOrEmpty(r.Token);
                return r;
            }
        }

        internal static bool TryRoot(string body, out JsonElement root, out JsonDocument doc)
        {
            root = default(JsonElement);
            doc = null;
            if (string.IsNullOrWhiteSpace(body)) return false;
            try
            {
                doc = JsonDocument.Parse(body);
                root = doc.RootElement;
                if (root.ValueKind != JsonValueKind.Object)
                {
                    doc.Dispose();
                    doc = null;
                    return false;
                }
                return true;
            }
            catch (Exception)
            {
                // JSON биш хариу (Cloudflare-ийн HTML алдаа г.м.).
                doc?.Dispose();
                doc = null;
                return false;
            }
        }

        internal static string Str(JsonElement r, string name)
        {
            return r.TryGetProperty(name, out JsonElement e) && e.ValueKind == JsonValueKind.String ? e.GetString() : null;
        }

        internal static bool Bool(JsonElement r, string name)
        {
            return r.TryGetProperty(name, out JsonElement e) && e.ValueKind == JsonValueKind.True;
        }

        internal static DateTimeOffset? Time(JsonElement r, string name)
        {
            string s = Str(r, name);
            return s != null && DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out DateTimeOffset t)
                ? t
                : (DateTimeOffset?)null;
        }
    }
}
