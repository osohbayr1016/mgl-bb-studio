using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using RevitMcpAddin.WorkTracking.Core;

namespace RevitMcpAddin.WorkTracking.Tests
{
    /// <summary>Гараар урагшлуулдаг цаг.  Монотон ба ханын цаг тусдаа — унтах горим, цаг солихыг загварчилна.</summary>
    public sealed class FakeClock : ITrackingClock
    {
        public long MonotonicMs { get; set; } = 1_000_000;
        public DateTime UtcNow { get; set; } = new DateTime(2026, 9, 29, 1, 0, 0, DateTimeKind.Utc); // 09:00 УБ

        public void Advance(TimeSpan d)
        {
            MonotonicMs += (long)d.TotalMilliseconds;
            UtcNow = UtcNow + d;
        }
    }

    /// <summary>
    /// Серверийн ХУУРАМЧ — `routes/revitTracking.ts`-ийн ЯГ ижил семантик:
    /// сегмент тутамд `MAX(active_ms)`, `MAX(rev)`; давтан хүргэлт давхар тоолохгүй.
    /// </summary>
    public sealed class FakeServer : ITrackingTransport
    {
        public sealed class Row { public int UserId; public int TaskId; public string Date; public string SessionId; public long Active; public long Idle; public long Rev; }

        public readonly Dictionary<string, Row> Segments = new Dictionary<string, Row>();
        public readonly List<PresenceDto> Presence = new List<PresenceDto>();
        public readonly List<string> ReportDraftsSeen = new List<string>();
        public readonly Dictionary<string, int> ReportsSealed = new Dictionary<string, int>();
        public int SyncCalls;
        public int ReportCalls;

        /// <summary>true = сүлжээ тасарсан.</summary>
        public bool Offline;
        /// <summary>Энэ статусаар унана (жишээ 401, 500, 403-оффис).</summary>
        public int? FailStatus;
        /// <summary>Тайлан хүлээж авахгүй статус + бие (тайлангийн замд).</summary>
        public int? ReportStatus;
        public string ReportBody;
        /// <summary>Сервер хадгалаад ХАРИУ алдагдсан мэт (сүлжээ тасрах) — дахин хүргэлтийг загварчилна.</summary>
        public bool DropResponseOnce;
        public HashSet<int> DeletedTasks = new HashSet<int>();
        public int TokenUserId = 7;

        public Task<SyncResponse> SyncAsync(string token, SyncRequest request, CancellationToken ct)
        {
            SyncCalls++;
            if (Offline) throw new HttpRequestException("offline");
            if (FailStatus.HasValue) throw new TrackingTransportException(FailStatus.Value, "fail");
            var res = new SyncResponse { ServerNow = DateTime.UtcNow.ToString("o"), WorkDate = request.WorkDate };
            if (request.Presence != null) Presence.Add(request.Presence);
            foreach (SegmentRecord s in request.Segments)
            {
                if (s.UserId != TokenUserId || DeletedTasks.Contains(s.TaskId))
                {
                    res.Acks.Add(new SegmentAck { SegmentId = s.SegmentId, Rev = s.Rev, Status = "rejected", Reason = "x" });
                    continue;
                }
                Row r;
                if (!Segments.TryGetValue(s.SegmentId, out r))
                {
                    r = new Row { UserId = s.UserId, TaskId = s.TaskId, Date = s.WorkDate, SessionId = s.SessionId };
                    Segments[s.SegmentId] = r;
                }
                r.Active = Math.Max(r.Active, s.ActiveMs);
                r.Idle = Math.Max(r.Idle, s.IdleMs);
                r.Rev = Math.Max(r.Rev, s.Rev);
                res.Acks.Add(new SegmentAck { SegmentId = s.SegmentId, Rev = s.Rev, Status = "accepted" });
            }
            foreach (var g in Segments.Values.Where(v => v.Date == request.WorkDate && v.SessionId != request.SessionId && v.UserId == TokenUserId)
                         .GroupBy(v => v.TaskId))
                res.OtherSessions.Add(new TodayTaskTotal { TaskId = g.Key, OtherMs = g.Sum(v => v.Active) });
            if (DropResponseOnce)
            {
                DropResponseOnce = false;
                throw new HttpRequestException("connection reset after commit");
            }
            return Task.FromResult(res);
        }

        public Task<ReportSendResult> SubmitReportAsync(string token, ReportItem report, CancellationToken ct)
        {
            ReportCalls++;
            if (Offline) throw new HttpRequestException("offline");
            ReportDraftsSeen.Add(report.DraftUid);
            if (ReportStatus.HasValue) return Task.FromResult(ReportResponseClassifier.Classify(ReportStatus.Value, ReportBody));
            if (!ReportsSealed.ContainsKey(report.DraftUid)) ReportsSealed[report.DraftUid] = 1000 + ReportsSealed.Count;
            return Task.FromResult(new ReportSendResult { Kind = ReportSendKind.Sent, EntryId = ReportsSealed[report.DraftUid] });
        }

        public long TotalActive(int taskId, string date = null) =>
            Segments.Values.Where(r => r.TaskId == taskId && (date == null || r.Date == date)).Sum(r => r.Active);
    }

    public static class Ctx
    {
        public static WorkContext Task(int taskId, int projectId = 1, string doc = "docA", int userId = 7) =>
            new WorkContext
            {
                UserId = userId,
                TaskId = taskId,
                TaskName = "Task " + taskId,
                ProjectId = projectId,
                ProjectName = "Project " + projectId,
                DocKey = doc,
                DocName = doc + ".rvt",
            };
    }

    /// <summary>Хост шиг `SampleInterval` тутам дохио өгч цагийг урагшлуулна.</summary>
    public static class Drive
    {
        public static void Run(WorkTracker t, FakeClock c, TimeSpan duration, Func<ActivitySignals> signals, TimeSpan? step = null)
        {
            TimeSpan s = step ?? TimeSpan.FromSeconds(2);
            TimeSpan done = TimeSpan.Zero;
            while (done < duration)
            {
                TimeSpan d = duration - done < s ? duration - done : s;
                c.Advance(d);
                done += d;
                t.Sample(signals());
            }
        }

        /// <summary>Хүн тасралтгүй ажиллаж байна: Revit урд, оролт шинэ.</summary>
        public static ActivitySignals Busy() => new ActivitySignals { RevitForeground = true, IdleMs = 500 };
    }
}
