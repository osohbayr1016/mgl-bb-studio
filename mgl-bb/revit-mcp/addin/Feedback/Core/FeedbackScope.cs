using System;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace RevitMcpAddin.Feedback.Core
{
    /// <summary>
    /// Outbox-ын ХҮРЭЭ = сервер (API host) × tenant × хэрэглэгч.  Хэрэглэгч А-гийн дараалсан хүсэлт хэрэглэгч Б нэвтэрсний
    /// дараа ХЭЗЭЭ Ч илгээгдэхгүй: илгээгч зөвхөн одоогийн токены хүрээний хавтсыг уншина.
    ///
    /// Токены <c>sub</c> / <c>tid</c>-ийг гарын үсэг шалгалгүй УНШИНА — энэ нь зөвхөн хавтас сонгоход (эрхийг сервер шийднэ;
    /// буруу токен бол сервер 401).  Хавтасны нэр нь хэшийн эхний 16 тэмдэгт (хост, нэр замд ил гарахгүй).
    /// </summary>
    public static class FeedbackScope
    {
        public static string NormalizeHost(string host)
        {
            if (string.IsNullOrWhiteSpace(host)) return string.Empty;
            return host.Trim().TrimEnd('/').ToLowerInvariant();
        }

        public static string Key(string host, string tenant, long userId)
        {
            string raw = NormalizeHost(host) + "|" + (tenant ?? string.Empty) + "|" + userId.ToString(CultureInfo.InvariantCulture);
            using (SHA256 sha = SHA256.Create())
            {
                byte[] h = sha.ComputeHash(Encoding.UTF8.GetBytes(raw));
                var sb = new StringBuilder(32);
                for (int i = 0; i < 8; i++) sb.Append(h[i].ToString("x2", CultureInfo.InvariantCulture));
                return sb.ToString();
            }
        }

        /// <summary>JWT-ийн payload-аас <c>sub</c> (заавал, эерэг) ба <c>tid</c> (сонголттой)-ийг уншина.</summary>
        public static bool TryReadToken(string jwt, out long sub, out string tenant)
        {
            sub = 0;
            tenant = null;
            if (string.IsNullOrWhiteSpace(jwt)) return false;
            string[] parts = jwt.Split('.');
            if (parts.Length != 3) return false;
            try
            {
                byte[] json = DecodeBase64Url(parts[1]);
                using (JsonDocument doc = JsonDocument.Parse(json))
                {
                    JsonElement r = doc.RootElement;
                    if (r.ValueKind != JsonValueKind.Object || !r.TryGetProperty("sub", out JsonElement s)) return false;
                    if (s.ValueKind == JsonValueKind.Number && s.TryGetInt64(out long v)) sub = v;
                    else if (s.ValueKind == JsonValueKind.String) long.TryParse(s.GetString(), NumberStyles.None, CultureInfo.InvariantCulture, out sub);
                    if (r.TryGetProperty("tid", out JsonElement t) && t.ValueKind == JsonValueKind.String) tenant = t.GetString();
                    return sub > 0;
                }
            }
            catch (Exception)
            {
                return false;
            }
        }

        private static byte[] DecodeBase64Url(string s)
        {
            string b = s.Replace('-', '+').Replace('_', '/');
            switch (b.Length % 4)
            {
                case 2: b += "=="; break;
                case 3: b += "="; break;
            }
            return Convert.FromBase64String(b);
        }
    }
}
