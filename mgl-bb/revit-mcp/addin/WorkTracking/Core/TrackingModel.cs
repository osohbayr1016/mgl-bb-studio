using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace RevitMcpAddin.WorkTracking.Core
{
    /// <summary>
    /// Бүртгэгчийн төлөв.  Утасны нэр (`Wire`) нь сервер ба админы харагдацтай
    /// ТААРАХ ёстой (`backend/src/lib/revitTracking.ts` `CLIENT_STATES`).
    /// </summary>
    public enum TrackState
    {
        /// <summary>ERP-д нэвтрээгүй — хэнд ч тоолохгүй.</summary>
        SignedOut,
        /// <summary>Нээлттэй / идэвхтэй Revit баримт алга.</summary>
        NoDocument,
        /// <summary>Баримт нээлттэй ч одоогийн таск сонгоогүй (эсвэл баримт төсөлд холбогдоогүй).</summary>
        NoTask,
        /// <summary>Таск сонгосон, Revit урд, оролт идэвхгүй босгоос дотор — ТООЛНО.</summary>
        Working,
        /// <summary>Оролтгүй босгоос удаан, эсвэл дэлгэц түгжигдсэн — тоолохгүй.</summary>
        Idle,
        /// <summary>Хүн идэвхтэй ч Revit урд талд хүлцлээс удаан байхгүй — тоолохгүй.</summary>
        Background,
        /// <summary>Унтах горим / Revit хаагдаж байна.</summary>
        Suspended,
    }

    public static class TrackStateWire
    {
        public static string Of(TrackState s)
        {
            switch (s)
            {
                case TrackState.Working: return "working";
                case TrackState.Idle: return "idle";
                case TrackState.Background: return "background";
                case TrackState.NoTask: return "no_task";
                case TrackState.NoDocument: return "no_document";
                case TrackState.Suspended: return "suspended";
                default: return "signed_out";
            }
        }
    }

    /// <summary>
    /// ОДООГИЙН АЖЛЫН КОНТЕКСТ — хэн, аль таск, аль баримт.  Энэ нь тоологдох
    /// цагийн «эзэн».  null контекст = юу ч тоолохгүй.
    /// </summary>
    public sealed class WorkContext
    {
        public int UserId { get; set; }
        public int TaskId { get; set; }
        public string TaskName { get; set; }
        public int? ProjectId { get; set; }
        public string ProjectName { get; set; }
        /// <summary>Нормчилсон баримтын түлхүүр (`DocKeys.Normalize` — зам нь хэшлэгдсэн).</summary>
        public string DocKey { get; set; }
        /// <summary>`revit_documents.id` (серверт бүртгэгдсэн бол).</summary>
        public int? RevitDocumentId { get; set; }
        public string DocName { get; set; }

        public bool SameWork(WorkContext o)
        {
            return o != null && o.UserId == UserId && o.TaskId == TaskId &&
                   string.Equals(o.DocKey, DocKey, StringComparison.Ordinal);
        }
    }

    /// <summary>OS-оос уншсан дохио — оролтын АГУУЛГА БИШ, зөвхөн хугацаа/төлөв.</summary>
    public struct ActivitySignals
    {
        /// <summary>Урд талын цонх ЭНЭ Revit процессынх эсэх.</summary>
        public bool RevitForeground;
        /// <summary>Windows-ийн сүүлийн оролтоос хойш мс.  &lt;0 = уншиж чадсангүй.</summary>
        public long IdleMs;
        /// <summary>Дэлгэц түгжигдсэн (мэдэгдэж байвал).</summary>
        public bool SessionLocked;

        public static ActivitySignals Active => new ActivitySignals { RevitForeground = true, IdleMs = 0 };
    }

    /// <summary>
    /// ХУРИМТЛАЛЫН СЕГМЕНТ — (сесс, хэрэглэгч, таск, баримт, өдөр) тутамд нэг.
    /// Утгууд нь ХУРИМТЛАГДСАН нийлбэр (delta БИШ) тул сервер `MAX`-аар
    /// хадгална: давтан хүргэлт, дараалал алдагдах нь ХЭЗЭЭ Ч давхар тоолохгүй.
    /// `rev` нь сегмент өөрчлөгдөх бүрд өснө — баталгаа (ack) нь `rev`-ээр.
    /// </summary>
    public sealed class SegmentRecord
    {
        [JsonPropertyName("segment_id")] public string SegmentId { get; set; }
        [JsonPropertyName("session_id")] public string SessionId { get; set; }
        [JsonPropertyName("user_id")] public int UserId { get; set; }
        [JsonPropertyName("task_id")] public int TaskId { get; set; }
        [JsonPropertyName("project_id")] public int? ProjectId { get; set; }
        [JsonPropertyName("doc_key")] public string DocKey { get; set; }
        [JsonPropertyName("revit_document_id")] public int? RevitDocumentId { get; set; }
        [JsonPropertyName("work_date")] public string WorkDate { get; set; }
        [JsonPropertyName("active_ms")] public long ActiveMs { get; set; }
        [JsonPropertyName("idle_ms")] public long IdleMs { get; set; }
        [JsonPropertyName("rev")] public long Rev { get; set; }
        [JsonPropertyName("first_at")] public string FirstAt { get; set; }
        [JsonPropertyName("last_at")] public string LastAt { get; set; }

        public SegmentRecord Clone()
        {
            return (SegmentRecord)MemberwiseClone();
        }
    }

    /// <summary>
    /// Revit-ээс илгээх ӨДРИЙН ТАЙЛАН (явц % + юу хийсэн).  Сүлжээгүй үед
    /// ДАРААЛАЛД хадгалагдана — ажилтны бичсэн текст ХЭЗЭЭ Ч алдагдахгүй.
    /// `DraftUid` нь серверийн idempotency түлхүүр (`revit_submissions`).
    /// </summary>
    public sealed class ReportItem
    {
        [JsonPropertyName("draft_uid")] public string DraftUid { get; set; }
        [JsonPropertyName("user_id")] public int UserId { get; set; }
        [JsonPropertyName("task_id")] public int TaskId { get; set; }
        [JsonPropertyName("task_name")] public string TaskName { get; set; }
        [JsonPropertyName("project_name")] public string ProjectName { get; set; }
        [JsonPropertyName("percentage")] public double Percentage { get; set; }
        [JsonPropertyName("notes")] public string Notes { get; set; }
        [JsonPropertyName("revit_document_id")] public int? RevitDocumentId { get; set; }
        [JsonPropertyName("sheet_uids")] public List<string> SheetUids { get; set; } = new List<string>();
        /// <summary>Ажилтан «Илгээх» дарсан агшин дахь энэ таскийн өнөөдрийн Revit цаг.</summary>
        [JsonPropertyName("revit_active_ms")] public long RevitActiveMs { get; set; }
        /// <summary>Тайлан бичсэн ажлын өдөр — хожим илгээгдсэн ч тэр өдөрт бүртгэгдэнэ.</summary>
        [JsonPropertyName("report_date")] public string ReportDate { get; set; }
        /// <summary>100%-д: вэбийн ижил `completion_questions`-ийн хариу (JSON объект, түүхий).  null = байхгүй.</summary>
        [JsonPropertyName("completion_qa_json")] public string CompletionQaJson { get; set; }
        [JsonPropertyName("created_at")] public string CreatedAt { get; set; }
        /// <summary>pending | failed | sent</summary>
        [JsonPropertyName("state")] public string State { get; set; } = ReportStates.Pending;
        [JsonPropertyName("attempts")] public int Attempts { get; set; }
        [JsonPropertyName("last_error")] public string LastError { get; set; }
        [JsonPropertyName("entry_id")] public int? EntryId { get; set; }
        [JsonPropertyName("sent_at")] public string SentAt { get; set; }

        public ReportItem Clone() { return (ReportItem)MemberwiseClone(); }
    }

    public static class ReportStates
    {
        public const string Pending = "pending";
        /// <summary>Сервер ТОДОРХОЙ татгалзсан (жишээ нь хувь буурсан) — текст хадгалагдана, ажилтан засна.</summary>
        public const string Failed = "failed";
        public const string Sent = "sent";
    }

    /// <summary>UI-д зориулсан агшны зураг — thread-safe хуулбар.</summary>
    public sealed class TrackerSnapshot
    {
        public TrackState State { get; set; }
        public WorkContext Context { get; set; }
        /// <summary>Энэ сесст, ОДООГИЙН таск дээр, ӨНӨӨДӨР хуримтлагдсан идэвхтэй мс.</summary>
        public long CurrentTaskSessionMs { get; set; }
        /// <summary>Энэ сесст өнөөдөр бүх таск дээр хуримтлагдсан идэвхтэй мс.</summary>
        public long SessionTodayMs { get; set; }
        /// <summary>Энэ зураг авсан монотон агшин — UI секунд тутам `+ (now − AtMs)`-ээр гүйлгэнэ.</summary>
        public long AtMs { get; set; }
        public string WorkDate { get; set; }
        /// <summary>Энэ сесст тоологдоогүй (унтах/цаг солих) завсрын тоо — оношилгоо.</summary>
        public int Gaps { get; set; }
    }

    /* ================================================================== */
    /*  Утасны гэрээ — `POST /api/revit/tracking/sync`                      */
    /* ================================================================== */

    public sealed class PresenceDto
    {
        [JsonPropertyName("state")] public string State { get; set; }
        [JsonPropertyName("task_id")] public int? TaskId { get; set; }
        [JsonPropertyName("project_id")] public int? ProjectId { get; set; }
        [JsonPropertyName("revit_document_id")] public int? RevitDocumentId { get; set; }
        [JsonPropertyName("doc_name")] public string DocName { get; set; }
        [JsonPropertyName("client_at")] public string ClientAt { get; set; }
    }

    public sealed class SyncRequest
    {
        [JsonPropertyName("session_id")] public string SessionId { get; set; }
        [JsonPropertyName("addin_version")] public string AddinVersion { get; set; }
        [JsonPropertyName("presence")] public PresenceDto Presence { get; set; }
        [JsonPropertyName("segments")] public List<SegmentRecord> Segments { get; set; } = new List<SegmentRecord>();
        /// <summary>true = Revit хаагдаж / гарч байна — сервер сессийг хаана.</summary>
        [JsonPropertyName("ended")] public bool Ended { get; set; }
        [JsonPropertyName("work_date")] public string WorkDate { get; set; }
    }

    public sealed class SegmentAck
    {
        [JsonPropertyName("segment_id")] public string SegmentId { get; set; }
        [JsonPropertyName("rev")] public long Rev { get; set; }
        /// <summary>accepted | rejected — аль аль нь дарааллаас хасна (rejected = сервер хэзээ ч авахгүй).</summary>
        [JsonPropertyName("status")] public string Status { get; set; }
        [JsonPropertyName("reason")] public string Reason { get; set; }
    }

    public sealed class TodayTaskTotal
    {
        [JsonPropertyName("task_id")] public int TaskId { get; set; }
        /// <summary>ЭНЭ сессээс БУСАД сессийн (өмнөх Revit нээлт, өөр PC) идэвхтэй мс.</summary>
        [JsonPropertyName("other_ms")] public long OtherMs { get; set; }
    }

    public sealed class SyncResponse
    {
        [JsonPropertyName("server_now")] public string ServerNow { get; set; }
        [JsonPropertyName("acks")] public List<SegmentAck> Acks { get; set; } = new List<SegmentAck>();
        [JsonPropertyName("work_date")] public string WorkDate { get; set; }
        [JsonPropertyName("other_sessions")] public List<TodayTaskTotal> OtherSessions { get; set; } = new List<TodayTaskTotal>();
    }

    /// <summary>`POST /api/revit/submissions`-ийн хариуг тайлангийн дараалалд ангилсан дүн.</summary>
    public enum ReportSendKind
    {
        Sent,
        /// <summary>Түр — сүлжээ, 5xx, оффисын сүлжээний 403, 429, `indeterminate`.</summary>
        Retry,
        /// <summary>Нэвтрэлт дууссан — дахин нэвтэрсний дараа илгээнэ.</summary>
        Unauthorized,
        /// <summary>Тодорхой татгалзал (400/404/409/HOURS_PROGRESS) — ажилтан засна.</summary>
        Rejected,
    }

    public sealed class ReportSendResult
    {
        public ReportSendKind Kind { get; set; }
        public int? EntryId { get; set; }
        public string Message { get; set; }
    }

    /// <summary>Тээврийн алдааны ангилал — дарааллаас ЮУ Ч хасахгүй.</summary>
    public sealed class TrackingTransportException : Exception
    {
        public int StatusCode { get; }
        public bool IsUnauthorized => StatusCode == 401;

        public TrackingTransportException(int statusCode, string message) : base(message)
        {
            StatusCode = statusCode;
        }
    }
}
