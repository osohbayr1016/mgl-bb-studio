using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace RevitMcpAddin.Feedback.Core
{
    /// <summary>
    /// Outbox-ын хүсэлтийн ЛОКАЛ төлөв.  Серверийн төлөв (received, triaged …) <see cref="FeedbackReceipt"/>-д тусдаа.
    ///   queued       — илгээхэд бэлэн (дараагийн тик дээр явна)
    ///   sending      — яг одоо илгээж байна (процесс унавал дараагийн эхлэлд queued гэж үзнэ)
    ///   retry_wait   — түр алдаа (сүлжээ / 5xx / 429) — <see cref="FeedbackItem.NextAttemptAt"/>-д дахин
    ///   auth_required— нэвтрэлт хэрэгтэй (401) — нэвтэрмэгц өөрөө үргэлжилнэ
    ///   failed       — хэрэглэгчийн оролцоо хэрэгтэй (эрх, хязгаар, буруу талбар) — «Дахин оролдох» гараар
    ///   submitted    — сервер хүлээн авч дугаар олгосон (хавсралтын локал хуулбар устна)
    ///   cancelled    — хэрэглэгч цуцалсан
    /// </summary>
    public static class FeedbackStates
    {
        public const string Queued = "queued";
        public const string Sending = "sending";
        public const string RetryWait = "retry_wait";
        public const string AuthRequired = "auth_required";
        public const string Failed = "failed";
        public const string Submitted = "submitted";
        public const string Cancelled = "cancelled";

        public static bool IsTerminal(string s) => s == Submitted || s == Cancelled;

        /// <summary>Автомат илгээгч авч болох төлөв (failed/cancelled/submitted-ийг хэзээ ч өөрөө авахгүй).</summary>
        public static bool IsSendable(string s) => s == Queued || s == Sending || s == RetryWait || s == AuthRequired;

        public static string Label(string s)
        {
            switch (s)
            {
                case Queued: return "Илгээхээр хүлээж байна";
                case Sending: return "Илгээж байна…";
                case RetryWait: return "Сүлжээ — дахин оролдоно";
                case AuthRequired: return "Нэвтрэх шаардлагатай";
                case Failed: return "Илгээгдсэнгүй";
                case Submitted: return "Хүлээн авсан";
                case Cancelled: return "Цуцалсан";
                default: return s ?? "";
            }
        }
    }

    public static class FeedbackTypes
    {
        public const string Bug = "bug";
        public const string Improvement = "improvement";
        public const string Question = "question";
        public static readonly string[] All = { Bug, Improvement, Question };

        public static string Label(string t) =>
            t == Bug ? "Алдаа" : t == Improvement ? "Сайжруулалт" : t == Question ? "Асуулт" : t ?? "";
    }

    public static class FeedbackSources
    {
        public const string WallElevation = "wall_elevation";
        public const string RevitTool = "revit_tool";
        public const string Erp = "erp";
        public const string Other = "other";
    }

    /// <summary>Хүсэлтийн талбарууд — серверийн <c>parseDraftFields</c>-ийн snake_case нэрээр.</summary>
    public sealed class FeedbackFields
    {
        [JsonPropertyName("source")] public string Source { get; set; } = FeedbackSources.RevitTool;
        [JsonPropertyName("tool_id")] public string ToolId { get; set; }
        [JsonPropertyName("source_context")] public string SourceContext { get; set; }
        [JsonPropertyName("type")] public string Type { get; set; } = FeedbackTypes.Bug;
        [JsonPropertyName("title")] public string Title { get; set; } = "";
        [JsonPropertyName("description")] public string Description { get; set; } = "";
        [JsonPropertyName("expected")] public string Expected { get; set; }
        [JsonPropertyName("actual")] public string Actual { get; set; }
        [JsonPropertyName("steps")] public string Steps { get; set; }
        [JsonPropertyName("suggestion")] public string Suggestion { get; set; }
        [JsonPropertyName("impact")] public string Impact { get; set; }
        [JsonPropertyName("revit_year")] public int? RevitYear { get; set; }
        [JsonPropertyName("revit_build")] public string RevitBuild { get; set; }
        [JsonPropertyName("addin_version")] public string AddinVersion { get; set; }
        [JsonPropertyName("addin_sha256")] public string AddinSha256 { get; set; }

        public FeedbackFields Clone() => (FeedbackFields)MemberwiseClone();

        /// <summary>Илгээхээс өмнөх шалгалт (сервертэй ижил: гарчиг ≥ 3, тайлбар ≥ 3).</summary>
        public string Problem()
        {
            if (string.IsNullOrWhiteSpace(Title) || Title.Trim().Length < 3) return "Гарчиг дор хаяж 3 тэмдэгт байна";
            if (string.IsNullOrWhiteSpace(Description) || Description.Trim().Length < 3) return "Тайлбар бичнэ үү";
            if (Title.Length > FeedbackLimits.TitleMax) return "Гарчиг хэт урт";
            return null;
        }
    }

    public sealed class FeedbackAttachment
    {
        /// <summary>Идемпотентын түлхүүр (8–80, [A-Za-z0-9_-]) — хугацаа дуусвал ШИНЭЭР үүснэ.</summary>
        [JsonPropertyName("client_attachment_id")] public string ClientAttachmentId { get; set; }
        /// <summary>Хэрэглэгчийн сонгосон анхны нэр (сервер өөрөө цэвэрлэнэ).</summary>
        [JsonPropertyName("name")] public string Name { get; set; }
        /// <summary>Item хавтсын доторх локал хуулбарын нэр (`files\…`).</summary>
        [JsonPropertyName("local_file")] public string LocalFile { get; set; }
        [JsonPropertyName("size")] public long Size { get; set; }
        /// <summary>Бүтэн файлын SHA-256 (дараалалд оруулах агшинд, stream-ээр бодсон).</summary>
        [JsonPropertyName("sha256")] public string Sha256 { get; set; }
        [JsonPropertyName("kind")] public string Kind { get; set; } = "file";
        [JsonPropertyName("server_id")] public string ServerId { get; set; }
        [JsonPropertyName("mode")] public string Mode { get; set; }
        [JsonPropertyName("part_size")] public int PartSize { get; set; }
        [JsonPropertyName("part_count")] public int PartCount { get; set; }
        [JsonPropertyName("uploaded_parts")] public List<int> UploadedParts { get; set; } = new List<int>();
        [JsonPropertyName("ready")] public bool Ready { get; set; }
    }

    public sealed class FeedbackReceipt
    {
        [JsonPropertyName("request_id")] public string RequestId { get; set; }
        [JsonPropertyName("number")] public int? Number { get; set; }
        [JsonPropertyName("display_number")] public string DisplayNumber { get; set; }
        [JsonPropertyName("status")] public string Status { get; set; }
        [JsonPropertyName("status_label")] public string StatusLabel { get; set; }
        [JsonPropertyName("submitted_at")] public string SubmittedAt { get; set; }
        [JsonPropertyName("note")] public string Note { get; set; }
    }

    public sealed class FeedbackError
    {
        [JsonPropertyName("code")] public string Code { get; set; }
        [JsonPropertyName("message")] public string Message { get; set; }
        [JsonPropertyName("http_status")] public int? HttpStatus { get; set; }
        [JsonPropertyName("at")] public string At { get; set; }
    }

    /// <summary>Outbox-ын нэг хүсэлт (item.json).  Нэг хэрэглэгч × нэг сервер × нэг tenant-ын хүрээнд (<see cref="Scope"/>).</summary>
    public sealed class FeedbackItem
    {
        public const int CurrentSchema = 1;

        [JsonPropertyName("schema")] public int Schema { get; set; } = CurrentSchema;
        /// <summary>= серверийн <c>client_request_id</c> (давтан илгээлт сервер дээр НЭГ мөр).</summary>
        [JsonPropertyName("id")] public string Id { get; set; }
        [JsonPropertyName("scope")] public string Scope { get; set; }
        [JsonPropertyName("host")] public string Host { get; set; }
        [JsonPropertyName("tenant")] public string Tenant { get; set; }
        [JsonPropertyName("user_id")] public long UserId { get; set; }
        [JsonPropertyName("created_at")] public string CreatedAt { get; set; }
        [JsonPropertyName("updated_at")] public string UpdatedAt { get; set; }
        [JsonPropertyName("state")] public string State { get; set; } = FeedbackStates.Queued;
        [JsonPropertyName("fields")] public FeedbackFields Fields { get; set; } = new FeedbackFields();
        /// <summary>Хувилбартай оношилгооны JSON (<c>mgl-diag/1</c>), хэрэглэгч хасаж болно (null).</summary>
        [JsonPropertyName("diagnostics_json")] public string DiagnosticsJson { get; set; }
        [JsonPropertyName("attachments")] public List<FeedbackAttachment> Attachments { get; set; } = new List<FeedbackAttachment>();
        /// <summary>Серверийн ноорог (<c>efr_…</c>).</summary>
        [JsonPropertyName("draft_id")] public string DraftId { get; set; }
        [JsonPropertyName("attempts")] public int Attempts { get; set; }
        [JsonPropertyName("next_attempt_at")] public string NextAttemptAt { get; set; }
        [JsonPropertyName("last_error")] public FeedbackError LastError { get; set; }
        [JsonPropertyName("receipt")] public FeedbackReceipt Receipt { get; set; }

        public static string NewClientId(string prefix)
        {
            return prefix + "_" + Guid.NewGuid().ToString("N");
        }

        public DateTimeOffset? NextAttempt()
        {
            if (string.IsNullOrEmpty(NextAttemptAt)) return null;
            DateTimeOffset t;
            return DateTimeOffset.TryParse(NextAttemptAt, System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.AssumeUniversal, out t) ? t : (DateTimeOffset?)null;
        }

        /// <summary>Энэ агшинд автомат илгээгч авах ёстой эсэх.</summary>
        public bool IsDue(DateTimeOffset now)
        {
            if (!FeedbackStates.IsSendable(State)) return false;
            DateTimeOffset? next = NextAttempt();
            return next == null || next.Value <= now;
        }
    }

    public static class FeedbackTime
    {
        public static string Iso(DateTimeOffset t) => t.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ", System.Globalization.CultureInfo.InvariantCulture);
    }
}
