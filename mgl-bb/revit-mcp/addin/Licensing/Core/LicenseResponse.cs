using System;
using System.Globalization;
using System.Text.Json;

namespace RevitMcpAddin.Licensing.Core
{
    /// <summary>
    /// `POST /api/revit/license` (ба `/device/session`)-ийн хариуг АНГИЛНА (цэвэр — `tests/Licensing.Tests`).
    ///
    ///   Ok         — 200 + {ok:true, lease}  → лицензийг ШАЛГААД хадгална
    ///                (+ түлхүүртэй төхөөрөмжид `session`, `credential`)
    ///   Denied     — сервер «үгүй» гэв (хаасан, идэвхгүй, ажлын компьютер биш, эрхгүй, хувилбар хуучирсан,
    ///                proof буруу) → хадгалсан лицензийг ШУУД устгана
    ///   NeedEnroll — төхөөрөмж энэ түлхүүрээр бүртгэгдээгүй / түлхүүр шаардлагатай / нууц үгээр
    ///                дахин нэвтрэх хэрэгтэй → «MGL нэвтрэлт» цонх (нууц үгээр бүртгүүлнэ)
    ///   Unauthorized — 401: токен хүчингүй → лиценз устна, дахин нэвтэрнэ
    ///   Soft       — сүлжээ / оффисын сүлжээ / 5xx / танихгүй хариу → хуучин лиценз
    ///                хугацаа дуустал ажилласаар (интернэтгүй горим)
    ///   NotReady   — 404 (сервер шинэчлэгдээгүй) эсвэл 503 (түлхүүр / аюулгүй байдлын шалгалт) → Soft-той ижил
    ///
    /// ⚠️ Хатуу татгалзлын кодууд `backend/src/lib/revitLicense.ts` `DenyCode`-той ИХЭР.
    /// </summary>
    public static class LicenseResponse
    {
        public static readonly string[] HardDenyCodes =
        {
            "USER_INACTIVE", "ROLE_NOT_ALLOWED", "DEVICE_BLOCKED", "NO_HW_PROFILE", "NO_WORK_PC_PROFILE", "NOT_WORK_PC",
            "DEVICE_REVOKED", "DEVICE_PENDING", "DEVICE_LIMIT_REACHED", "DEVICE_KEY_MISMATCH", "DEVICE_KEY_WEAK",
            "DEVICE_PROOF_REQUIRED", "DEVICE_PROOF_INVALID",
            "ADDIN_UPDATE_REQUIRED", "ADDIN_VERSION_BLOCKED", "REVIT_LICENSES_DISABLED",
        };

        /// <summary>Нууц үгээр (дахин) бүртгүүлэх шаардлагатай кодууд.</summary>
        public static readonly string[] EnrollCodes =
        {
            "DEVICE_NOT_ENROLLED", "DEVICE_KEY_REQUIRED", "REAUTH_REQUIRED",
        };

        public enum Kind { Ok, Denied, NeedEnroll, Unauthorized, Soft, NotReady }

        public sealed class Result
        {
            public Kind Kind { get; internal set; }
            public string Lease { get; internal set; }
            public string Code { get; internal set; }
            /// <summary>Ажилтанд харуулах мессеж (сервер монголоор өгсөн бол түүнийг).</summary>
            public string Message { get; internal set; }
            /// <summary>Төхөөрөмжид уяатай 30 минутын API session (`purpose:'revit'`).</summary>
            public string SessionToken { get; internal set; }
            public DateTimeOffset? SessionExpiresAt { get; internal set; }
            /// <summary>Renewal credential (`purpose:'revit-refresh'`, 30 хоног) — ГАНЦААРАА эрх өгөхгүй.</summary>
            public string Credential { get; internal set; }
            public DateTimeOffset? CredentialExpiresAt { get; internal set; }
            /// <summary>tpm | software | legacy</summary>
            public string Security { get; internal set; }
        }

        public static Result Classify(int status, string body)
        {
            Parse(body, out bool ok, out string lease, out string code, out string error,
                out string sessionToken, out DateTimeOffset? sessionExp,
                out string credential, out DateTimeOffset? credentialExp, out string sec);

            if (status == 200 && ok && !string.IsNullOrEmpty(lease))
            {
                return new Result
                {
                    Kind = Kind.Ok,
                    Lease = lease,
                    SessionToken = sessionToken,
                    SessionExpiresAt = sessionExp,
                    Credential = credential,
                    CredentialExpiresAt = credentialExp,
                    Security = sec,
                };
            }

            if (status == 401)
            {
                return new Result
                {
                    Kind = Kind.Unauthorized,
                    Code = "UNAUTHORIZED",
                    Message = "Нэвтрэлтийн хугацаа дууссан эсвэл хүчингүй — дахин нэвтэрнэ үү.",
                };
            }

            if (status == 403 || status == 409)
            {
                // Оффисын сүлжээний хаалт (OFFICE_ACCESS_ENFORCED) — орчны асуудал, татгалзал БИШ.
                if (code == "office_network_required")
                {
                    return new Result
                    {
                        Kind = Kind.Soft,
                        Code = code,
                        Message = string.IsNullOrEmpty(error) ? "Оффисын сүлжээнд холбогдоно уу." : error,
                    };
                }
                if (code != null && Array.IndexOf(EnrollCodes, code) >= 0)
                {
                    return new Result
                    {
                        Kind = Kind.NeedEnroll,
                        Code = code,
                        Message = !string.IsNullOrEmpty(error) && HasCyrillic(error)
                            ? error
                            : "Энэ төхөөрөмжийг бүртгүүлэхийн тулд нэвтрэх нэр, нууц үгээрээ нэвтэрнэ үү.",
                    };
                }
                // Танигдсан код эсвэл КОДГҮЙ 403 (эрхгүй role — workerScope/clientScope) — хоёулаа хатуу.
                return new Result
                {
                    Kind = Kind.Denied,
                    Code = code ?? "FORBIDDEN",
                    Message = !string.IsNullOrEmpty(error) && HasCyrillic(error)
                        ? error
                        : "Таны бүртгэлээр MGL add-in ашиглах эрхгүй.",
                };
            }

            if (status == 404 || status == 503)
            {
                return new Result
                {
                    Kind = Kind.NotReady,
                    Code = code ?? status.ToString(CultureInfo.InvariantCulture),
                    Message = status == 503 && !string.IsNullOrEmpty(error) && HasCyrillic(error)
                        ? error
                        : "Лицензийн сервер бэлэн биш байна. Admin-д хандана уу.",
                };
            }

            return new Result
            {
                Kind = Kind.Soft,
                Code = status.ToString(CultureInfo.InvariantCulture),
                Message = status == 200
                    ? "Серверийн хариу ойлгомжгүй байна. Дараа дахин оролдоно уу."
                    : "Сервер алдаа өглөө (" + status + "). Дараа дахин оролдоно уу.",
            };
        }

        public static bool IsHardDeny(string code) => code != null && Array.IndexOf(HardDenyCodes, code) >= 0;

        private static bool HasCyrillic(string s)
        {
            foreach (char ch in s) if (ch >= 'Ѐ' && ch <= 'ӿ') return true;
            return false;
        }

        private static void Parse(
            string text, out bool ok, out string lease, out string code, out string error,
            out string sessionToken, out DateTimeOffset? sessionExp,
            out string credential, out DateTimeOffset? credentialExp, out string sec)
        {
            ok = false;
            lease = code = error = sessionToken = credential = sec = null;
            sessionExp = null;
            credentialExp = null;
            if (string.IsNullOrWhiteSpace(text)) return;
            try
            {
                using (JsonDocument doc = JsonDocument.Parse(text))
                {
                    JsonElement r = doc.RootElement;
                    if (r.ValueKind != JsonValueKind.Object) return;
                    if (r.TryGetProperty("ok", out JsonElement o) && o.ValueKind == JsonValueKind.True) ok = true;
                    if (r.TryGetProperty("lease", out JsonElement l) && l.ValueKind == JsonValueKind.String) lease = l.GetString();
                    if (r.TryGetProperty("code", out JsonElement c) && c.ValueKind == JsonValueKind.String) code = c.GetString();
                    if (r.TryGetProperty("error", out JsonElement e) && e.ValueKind == JsonValueKind.String) error = e.GetString();
                    if (r.TryGetProperty("sec", out JsonElement sc) && sc.ValueKind == JsonValueKind.String) sec = sc.GetString();
                    if (r.TryGetProperty("session", out JsonElement s) && s.ValueKind == JsonValueKind.Object)
                    {
                        sessionToken = DeviceResponses.Str(s, "token");
                        sessionExp = DeviceResponses.Time(s, "expires_at");
                    }
                    if (r.TryGetProperty("credential", out JsonElement cr) && cr.ValueKind == JsonValueKind.Object)
                    {
                        credential = DeviceResponses.Str(cr, "token");
                        credentialExp = DeviceResponses.Time(cr, "expires_at");
                    }
                }
            }
            catch (Exception)
            {
                // JSON биш хариу (Cloudflare-ийн HTML алдаа г.м.) — Soft.
                ok = false;
                lease = code = error = sessionToken = credential = sec = null;
                sessionExp = null;
                credentialExp = null;
            }
        }
    }
}
