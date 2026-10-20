using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

namespace RevitMcpAddin.Feedback.Core
{
    /// <summary>
    /// <c>/api/engineering-feedback</c>-ийн илгээгчийн замууд (Revit-ийн төхөөрөмжийн session-д нээлттэй ЗӨВХӨН эдгээр).
    /// HTTP хэрэгжүүлэлт нь <c>Feedback/FeedbackHttpTransport.cs</c>; тест хуурамчаар орлуулна.
    /// Серверийн алдаа → <see cref="FeedbackHttpException"/>, сүлжээ/timeout → <see cref="FeedbackNetworkException"/>.
    /// </summary>
    public interface IFeedbackTransport
    {
        Task<FeedbackDraftResult> CreateDraftAsync(string clientRequestId, FeedbackFields fields, string diagnosticsJson, CancellationToken ct);
        Task<FeedbackReservedAttachment> ReserveAsync(string draftId, FeedbackAttachment a, bool sendHash, CancellationToken ct);
        Task<FeedbackReservedAttachment> PutContentAsync(string attachmentId, Stream content, long length, CancellationToken ct);
        Task<IList<int>> PutPartAsync(string attachmentId, int partNumber, byte[] buffer, int count, string sha256, CancellationToken ct);
        Task<FeedbackReservedAttachment> CompleteAsync(string attachmentId, CancellationToken ct);
        Task<FeedbackSubmitResult> SubmitAsync(string draftId, string clientRequestId, FeedbackFields fields, IList<string> attachmentIds, CancellationToken ct);
    }

    public sealed class FeedbackDraftResult
    {
        public string Id { get; set; }
        public string Status { get; set; }
        public bool Reused { get; set; }
    }

    public sealed class FeedbackReservedAttachment
    {
        public string Id { get; set; }
        public string State { get; set; }
        public string Mode { get; set; }
        public int PartSize { get; set; }
        public int PartCount { get; set; }
        public List<int> UploadedParts { get; set; } = new List<int>();
    }

    public sealed class FeedbackSubmitResult
    {
        public FeedbackReceipt Receipt { get; set; }
        public bool AlreadySubmitted { get; set; }
    }

    /// <summary>Сервер хариулсан (2xx биш).  <see cref="Code"/> = серверийн <c>code</c> (STALE_VERSION г.м.).</summary>
    public sealed class FeedbackHttpException : Exception
    {
        public int Status { get; }
        public string Code { get; }
        public TimeSpan? RetryAfter { get; }
        /// <summary>409 IDEMPOTENCY_CONFLICT-ийн үед серверийн анхны баримт.</summary>
        public FeedbackReceipt Receipt { get; }
        /// <summary>409 PARTS_MISSING-ийн үед дутуу хэсгүүд.</summary>
        public IList<int> Missing { get; }

        public FeedbackHttpException(int status, string code, string message, TimeSpan? retryAfter = null, FeedbackReceipt receipt = null, IList<int> missing = null)
            : base(string.IsNullOrEmpty(message) ? "HTTP " + status : message)
        {
            Status = status;
            Code = code;
            RetryAfter = retryAfter;
            Receipt = receipt;
            Missing = missing;
        }
    }

    /// <summary>Сервер хүрсэнгүй (DNS, TCP, TLS, timeout) — түр алдаа.</summary>
    public sealed class FeedbackNetworkException : Exception
    {
        public FeedbackNetworkException(string message, Exception inner = null) : base(message, inner) { }
    }

    public enum FailureKind
    {
        /// <summary>Түр — ухралттай дахин (сүлжээ, 5xx, 429, 408).</summary>
        Transient,
        /// <summary>401 — нэвтрэх хүртэл хүлээнэ (оролдлого шатаахгүй).</summary>
        AuthRequired,
        /// <summary>Хэрэглэгчийн оролцоо хэрэгтэй (403 эрх, 400/422 талбар, 413 хязгаар).</summary>
        Permanent,
    }

    /// <summary>Ухралт + алдааны ангилал — ЦЭВЭР (цаг/санамсаргүй тоог гаднаас өгнө, тестлэгдэнэ).</summary>
    public static class FeedbackRetry
    {
        public static readonly TimeSpan Base = TimeSpan.FromSeconds(5);
        public static readonly TimeSpan Cap = TimeSpan.FromMinutes(30);

        /// <summary>
        /// «Equal jitter» экспоненциал ухралт: d = min(cap, base·2^(n-1)); буцаах = d/2 + jitter·d/2.
        /// Сервер Retry-After өгвөл түүнийг (1 с – 1 цаг) хүндэтгэнэ.
        /// </summary>
        public static TimeSpan Delay(int attempt, TimeSpan? retryAfter, double jitter01)
        {
            if (retryAfter.HasValue)
            {
                double s = Math.Max(1, Math.Min(3600, retryAfter.Value.TotalSeconds));
                return TimeSpan.FromSeconds(s);
            }
            int n = Math.Max(1, Math.Min(attempt, 12));
            double d = Math.Min(Cap.TotalSeconds, Base.TotalSeconds * Math.Pow(2, n - 1));
            double j = Math.Max(0, Math.Min(1, jitter01));
            return TimeSpan.FromSeconds(d / 2 + j * d / 2);
        }

        public static FailureKind Classify(Exception ex)
        {
            if (ex is FeedbackNetworkException) return FailureKind.Transient;
            if (ex is TimeoutException) return FailureKind.Transient;
            if (ex is IOException) return FailureKind.Transient;
            var h = ex as FeedbackHttpException;
            if (h == null) return FailureKind.Permanent;
            if (h.Status == 401) return FailureKind.AuthRequired;
            if (h.Status == 408 || h.Status == 425 || h.Status == 429 || h.Status >= 500) return FailureKind.Transient;
            switch (h.Code)
            {
                case "SUBMIT_FAILED":
                case "STALE_VERSION":
                case "UPLOAD_FAILED":
                case "COMPLETE_FAILED":
                case "VERIFY_FAILED":
                case "SIZE_MISMATCH":
                case "ATTACHMENTS_PENDING":
                case "NOT_UPLOADING":
                    return FailureKind.Transient;
            }
            return FailureKind.Permanent;
        }

        /// <summary>Хэрэглэгчид харагдах шалтгаан (серверийн монгол мессеж байвал түүнийг).</summary>
        public static string Describe(Exception ex)
        {
            var h = ex as FeedbackHttpException;
            if (h != null)
            {
                if (h.Status == 401) return "Нэвтрэлтийн хугацаа дууссан — «Бүртгэл, эрх»-ээр дахин нэвтэрнэ үү.  Хүсэлт хадгалагдсан, нэвтэрмэгц өөрөө илгээгдэнэ.";
                if (h.Status == 403) return "Энэ бүртгэлээр програмын хүсэлт илгээх эрх алга (" + (h.Message ?? "403") + ").";
                if (h.Status == 503 && h.Code == "STORAGE_UNAVAILABLE") return "Сервер дээр файлын хадгалалт түр бэлэн биш — дахин оролдоно.";
                if (h.Status >= 500) return "Сервер түр алдаа өгсөн (" + h.Status + ") — дахин оролдоно.";
                return h.Message;
            }
            if (ex is FeedbackNetworkException) return "Сервер рүү холбогдож чадсангүй — интернэт сэргэмэгц өөрөө илгээгдэнэ.";
            return ex?.Message ?? "Тодорхойгүй алдаа";
        }
    }
}
