using System;
using System.IO;
using System.Linq;
using System.Threading;
using RevitMcpAddin.WorkTracking.Core;

namespace RevitMcpAddin.WorkTracking.Tests
{
    /// <summary>Офлайн дараалал, дахин хүргэлт, баталгаа, дахин эхлэлт, тайлан.</summary>
    public static class SyncTests
    {
        private static TrackingPolicy P() => new TrackingPolicy();

        private sealed class Rig
        {
            public FakeClock Clock = new FakeClock();
            public FakeServer Server = new FakeServer();
            public WorkTracker Tracker;
            public TrackingOutbox Outbox;
            public TrackingSync Sync;
            public AuthIdentity Who = new AuthIdentity { Token = "t", UserId = 7 };

            public Rig(string session = "sessA", TrackingOutbox outbox = null)
            {
                Tracker = new WorkTracker(P(), Clock, session);
                Outbox = outbox ?? TrackingOutbox.InMemory(session);
                Sync = new TrackingSync(Tracker, Outbox, Server, () => Who, P(), Clock, "1.4.0");
            }

            public void Work(TimeSpan d) => Drive.Run(Tracker, Clock, d, Drive.Busy);

            public void Tick(bool force = false, bool ended = false)
            {
                Sync.RunOnceAsync(force, ended, CancellationToken.None).GetAwaiter().GetResult();
            }

            public string Date => P().WorkDateOf(Clock.UtcNow);
        }

        [Test]
        public static void Online_SyncsAndAcks()
        {
            var r = new Rig();
            r.Tracker.SetContext(Ctx.Task(1));
            r.Work(TimeSpan.FromMinutes(3));
            r.Tick();
            Assert.True(r.Sync.Online);
            Assert.Eq(0, r.Outbox.PendingSegmentCount(7), "acked records leave the queue");
            Assert.Near(3 * 60_000, r.Server.TotalActive(1), 2_000);
            Assert.Eq("working", r.Server.Presence.Last().State);
        }

        [Test]
        public static void Offline_QueuesWork_ThenReconnectDeliversAll()
        {
            var r = new Rig();
            r.Tracker.SetContext(Ctx.Task(1));
            r.Server.Offline = true;
            for (int i = 0; i < 6; i++)
            {
                r.Work(TimeSpan.FromMinutes(5));
                r.Tick(force: true);
            }
            Assert.False(r.Sync.Online);
            Assert.Eq(1, r.Outbox.PendingSegmentCount(7), "cumulative: one queued record per segment");
            Assert.Eq(0L, r.Server.TotalActive(1));

            r.Server.Offline = false;
            r.Tick(force: true);
            Assert.True(r.Sync.Online);
            Assert.Eq(0, r.Outbox.PendingSegmentCount(7));
            Assert.Near(30 * 60_000, r.Server.TotalActive(1), 2_000, "30 offline minutes delivered once");
        }

        [Test]
        public static void ServerErrors_KeepQueue_AndBackOff()
        {
            foreach (int status in new[] { 500, 503, 429, 403 })
            {
                var r = new Rig();
                r.Tracker.SetContext(Ctx.Task(1));
                r.Server.FailStatus = status;               // 403 = оффисын сүлжээний хаалт (гэрээс)
                r.Work(TimeSpan.FromMinutes(1));
                r.Tick(force: true);
                Assert.Eq(1, r.Outbox.PendingSegmentCount(7), "status " + status + " keeps the queue");
                int calls = r.Server.SyncCalls;
                r.Clock.Advance(TimeSpan.FromSeconds(1));
                r.Tick();                                  // ухралтын цонх дотор — оролдохгүй
                Assert.Eq(calls, r.Server.SyncCalls, "backoff respected for " + status);
                r.Server.FailStatus = null;
                r.Clock.Advance(TimeSpan.FromMinutes(3));
                r.Tick();
                Assert.Eq(0, r.Outbox.PendingSegmentCount(7));
            }
        }

        [Test]
        public static void Unauthorized_KeepsQueue_UntilRelogin()
        {
            var r = new Rig();
            r.Tracker.SetContext(Ctx.Task(1));
            r.Server.FailStatus = 401;
            r.Work(TimeSpan.FromMinutes(2));
            r.Tick(force: true);
            Assert.True(r.Sync.AuthRequired);
            Assert.Eq(1, r.Outbox.PendingSegmentCount(7));
            r.Server.FailStatus = null;                   // дахин нэвтэрлээ
            r.Tick(force: true);
            Assert.False(r.Sync.AuthRequired);
            Assert.Near(2 * 60_000, r.Server.TotalActive(1), 2_000);
        }

        [Test]
        public static void DuplicateDelivery_NeverDoubleCounts()
        {
            var r = new Rig();
            r.Tracker.SetContext(Ctx.Task(1));
            r.Work(TimeSpan.FromMinutes(4));
            r.Server.DropResponseOnce = true;             // сервер хадгалсан, хариу алдагдсан
            r.Tick(force: true);
            Assert.Eq(1, r.Outbox.PendingSegmentCount(7), "no ack received → still queued");
            r.Tick(force: true);                          // ИЖИЛ сегментийг дахин илгээнэ
            r.Tick(force: true);
            Assert.Eq(0, r.Outbox.PendingSegmentCount(7));
            Assert.Near(4 * 60_000, r.Server.TotalActive(1), 2_000, "replayed 3 times, counted once");
        }

        [Test]
        public static void AckForOlderRev_DoesNotDropNewerWork()
        {
            var box = TrackingOutbox.InMemory("s");
            var seg = new SegmentRecord { SegmentId = "s-1", SessionId = "s", UserId = 7, TaskId = 1, WorkDate = "2026-09-29", ActiveMs = 1000, Rev = 3 };
            box.UpsertSegments(new[] { seg });
            var newer = seg.Clone(); newer.ActiveMs = 5000; newer.Rev = 5;
            box.UpsertSegments(new[] { newer });
            box.AckSegments(new[] { new SegmentAck { SegmentId = "s-1", Rev = 3, Status = "accepted" } });
            Assert.Eq(1, box.PendingSegmentCount(7), "rev 5 still pending after ack of rev 3");
            var older = seg.Clone(); older.Rev = 2; older.ActiveMs = 1;
            box.UpsertSegments(new[] { older });
            Assert.Eq(5000L, box.PendingSegments(7, 10).Single().ActiveMs, "stale upsert ignored");
            box.AckSegments(new[] { new SegmentAck { SegmentId = "s-1", Rev = 5, Status = "accepted" } });
            Assert.Eq(0, box.PendingSegmentCount(7));
        }

        [Test]
        public static void RejectedSegment_DroppedPermanently()
        {
            var r = new Rig();
            r.Server.DeletedTasks.Add(1);
            r.Tracker.SetContext(Ctx.Task(1));
            r.Work(TimeSpan.FromMinutes(1));
            r.Tick(force: true);
            Assert.True(r.Sync.Online);
            Assert.Eq(0, r.Outbox.PendingSegmentCount(7), "server said never — do not retry forever");
        }

        [Test]
        public static void Logout_OtherUsersQueueNeverSentWithNewToken()
        {
            var r = new Rig();
            r.Tracker.SetContext(Ctx.Task(1));
            r.Server.Offline = true;
            r.Work(TimeSpan.FromMinutes(2));
            r.Tick(force: true);
            r.Tracker.SetContext(null, TrackState.SignedOut);   // гарав
            r.Sync.Persist();
            r.Who = new AuthIdentity { Token = "t2", UserId = 8 };  // өөр хүн нэвтрэв
            r.Server.TokenUserId = 8;
            r.Server.Offline = false;
            r.Tick(force: true);
            Assert.Eq(0L, r.Server.TotalActive(1), "user 7's time is never sent with user 8's token");
            Assert.Eq(1, r.Outbox.PendingSegmentCount(7), "kept for user 7");
            r.Who = new AuthIdentity { Token = "t", UserId = 7 };
            r.Server.TokenUserId = 7;
            r.Tick(force: true);
            Assert.Near(2 * 60_000, r.Server.TotalActive(1), 2_000);
        }

        [Test]
        public static void SignedOut_DoesNotCallServer_ButPersists()
        {
            var r = new Rig();
            r.Tracker.SetContext(Ctx.Task(1));
            r.Work(TimeSpan.FromMinutes(1));
            r.Who = null;
            r.Tick(force: true);
            Assert.Eq(0, r.Server.SyncCalls);
            Assert.Eq(1, r.Outbox.PendingSegmentCount(7));
        }

        [Test]
        public static void OtherSessions_FeedDisplayTotals()
        {
            var r = new Rig("sessNew");
            r.Server.Segments["old-1"] = new FakeServer.Row { UserId = 7, TaskId = 1, Date = r.Date, SessionId = "old", Active = 3_600_000 };
            r.Tracker.SetContext(Ctx.Task(1));
            r.Work(TimeSpan.FromMinutes(1));
            r.Tick(force: true);
            Assert.Eq(3_600_000L, r.Sync.OtherSessionsMs(1, r.Date), "morning session counted in today's total");
            Assert.Eq(0L, r.Sync.OtherSessionsMs(2, r.Date));
        }

        [Test]
        public static void Restart_WithPendingQueue_AdoptsAndDelivers()
        {
            string dir = Path.Combine(Path.GetTempPath(), "mgl-wt-" + Guid.NewGuid().ToString("N"));
            try
            {
                // 1-р сесс: офлайн ажиллаад Revit УНАВ (Dispose ч хийгдээгүй мэт — түгжээг л суллана).
                var box1 = TrackingOutbox.Open(dir, "sess1");
                var r1 = new Rig("sess1", box1);
                r1.Server.Offline = true;
                r1.Tracker.SetContext(Ctx.Task(1));
                r1.Work(TimeSpan.FromMinutes(7));
                r1.Tick(force: true);
                r1.Tracker.SetContext(Ctx.Task(2));
                r1.Work(TimeSpan.FromMinutes(3));
                r1.Tick(force: true);
                box1.Dispose();       // процесс үхэхэд OS түгжээг сулладагтай ижил
                Assert.True(File.Exists(Path.Combine(dir, "outbox-sess1.json")), "unsent work stays on disk");

                // 2-р сесс: шинэ Revit — өнчин файлыг шингээж илгээнэ.
                var box2 = TrackingOutbox.Open(dir, "sess2");
                Assert.Eq(1, box2.AdoptedFiles);
                Assert.Eq(2, box2.PendingSegmentCount(7));
                Assert.False(File.Exists(Path.Combine(dir, "outbox-sess1.json")), "orphan merged and removed");
                var r2 = new Rig("sess2", box2);
                r2.Tick(force: true);
                Assert.Near(7 * 60_000, r2.Server.TotalActive(1), 2_000);
                Assert.Near(3 * 60_000, r2.Server.TotalActive(2), 2_000);
                Assert.Eq(0, box2.PendingSegmentCount(7));
                box2.Dispose();
                Assert.False(File.Exists(Path.Combine(dir, "outbox-sess2.json")), "empty outbox leaves no file");
            }
            finally
            {
                try { Directory.Delete(dir, true); } catch { }
            }
        }

        [Test]
        public static void LiveSecondRevit_FileIsNotStolen()
        {
            string dir = Path.Combine(Path.GetTempPath(), "mgl-wt-" + Guid.NewGuid().ToString("N"));
            try
            {
                var box1 = TrackingOutbox.Open(dir, "live1");
                box1.UpsertSegments(new[] { new SegmentRecord { SegmentId = "live1-1", SessionId = "live1", UserId = 7, TaskId = 1, WorkDate = "2026-09-29", ActiveMs = 5, Rev = 1 } });
                box1.Save();
                var box2 = TrackingOutbox.Open(dir, "live2");      // зэрэг ажиллаж буй хоёр дахь Revit
                Assert.Eq(0, box2.AdoptedFiles, "a live process's queue is not adopted");
                Assert.Eq(0, box2.PendingSegmentCount(7));
                Assert.Eq(1, box1.PendingSegmentCount(7));
                box2.Dispose();
                box1.Dispose();
            }
            finally
            {
                try { Directory.Delete(dir, true); } catch { }
            }
        }

        [Test]
        public static void CorruptOutboxFile_DoesNotBreakStartup()
        {
            string dir = Path.Combine(Path.GetTempPath(), "mgl-wt-" + Guid.NewGuid().ToString("N"));
            try
            {
                Directory.CreateDirectory(dir);
                File.WriteAllText(Path.Combine(dir, "outbox-broken.json"), "{ not json");
                var box = TrackingOutbox.Open(dir, "fresh");
                Assert.Eq(0, box.PendingSegmentCount(7));
                box.Dispose();
            }
            finally
            {
                try { Directory.Delete(dir, true); } catch { }
            }
        }

        [Test]
        public static void Prune_DropsTooOldSegments_NeverUnsentReports()
        {
            var box = TrackingOutbox.InMemory("s");
            box.UpsertSegments(new[]
            {
                new SegmentRecord { SegmentId = "s-1", UserId = 7, TaskId = 1, WorkDate = "2026-07-01", ActiveMs = 1, Rev = 1, LastAt = "2026-07-01T00:00:00.000Z" },
                new SegmentRecord { SegmentId = "s-2", UserId = 7, TaskId = 1, WorkDate = "2026-09-28", ActiveMs = 1, Rev = 1, LastAt = "2026-09-28T00:00:00.000Z" },
            });
            box.AddReport(new ReportItem { DraftUid = "d1", UserId = 7, TaskId = 1, Notes = "old but unsent", CreatedAt = "2026-07-01T00:00:00.000Z" });
            box.Prune(new DateTime(2026, 9, 29, 0, 0, 0, DateTimeKind.Utc));
            Assert.Eq(1, box.PendingSegmentCount(7));
            Assert.Eq(1, box.PendingReports(7, 10).Count, "typed text is never pruned");
        }

        /* ------------------------------ Тайлан ------------------------------ */

        private static ReportItem Report(string uid, int task = 1, double pct = 60) => new ReportItem
        {
            DraftUid = uid,
            UserId = 7,
            TaskId = task,
            Percentage = pct,
            Notes = "Хана, хаалганы тэмдэглэгээ",
            CreatedAt = WorkTracker.Iso(DateTime.UtcNow),
            ReportDate = "2026-09-29",
        };

        [Test]
        public static void Report_Offline_QueuedThenSentOnce()
        {
            var r = new Rig();
            r.Server.Offline = true;
            r.Sync.EnqueueReport(Report("d1"));
            r.Tick(force: true);
            Assert.Eq(1, r.Outbox.PendingReports(7, 10).Count, "kept while offline");
            r.Server.Offline = false;
            r.Tick(force: true);
            Assert.Eq(0, r.Outbox.PendingReports(7, 10).Count);
            ReportItem sent = r.Outbox.Reports(7).Single();
            Assert.Eq(ReportStates.Sent, sent.State);
            Assert.NotNull(sent.EntryId);
            r.Tick(force: true);
            Assert.Eq(1, r.Server.ReportCalls, "offline tick never reached the report path; not re-sent after success");
        }

        [Test]
        public static void Report_Rejected_KeepsTextAsFailed()
        {
            var r = new Rig();
            r.Server.ReportStatus = 409;
            r.Server.ReportBody = "{\"error\":\"percentage_regression\",\"current\":70}";
            r.Sync.EnqueueReport(Report("d1", pct: 50));
            r.Tick(force: true);
            ReportItem it = r.Outbox.Reports(7).Single();
            Assert.Eq(ReportStates.Failed, it.State);
            Assert.Eq("Хана, хаалганы тэмдэглэгээ", it.Notes, "text preserved");
            Assert.Eq("percentage_regression", it.LastError);
            int calls = r.Server.ReportCalls;
            r.Tick(force: true);
            Assert.Eq(calls, r.Server.ReportCalls, "failed report is not auto-retried");
        }

        [Test]
        public static void Report_OfficeNetwork403_IsRetried()
        {
            var r = new Rig();
            r.Server.ReportStatus = 403;
            r.Server.ReportBody = "{\"error\":\"Оффисын сүлжээнд холбогдоно уу\",\"code\":\"office_network_required\"}";
            r.Sync.EnqueueReport(Report("d1"));
            r.Tick(force: true);
            Assert.Eq(ReportStates.Pending, r.Outbox.Reports(7).Single().State);
            r.Server.ReportStatus = null;
            r.Tick(force: true);
            Assert.Eq(ReportStates.Sent, r.Outbox.Reports(7).Single().State);
        }

        [Test]
        public static void Report_SameDraftUid_IsIdempotent()
        {
            var r = new Rig();
            r.Sync.EnqueueReport(Report("d1"));
            r.Sync.EnqueueReport(Report("d1"));          // давхар дарсан
            r.Tick(force: true);
            Assert.Eq(1, r.Outbox.Reports(7).Count);
            Assert.Eq(1, r.Server.ReportsSealed.Count);
        }

        [Test]
        public static void Classifier_Table()
        {
            Assert.Eq(ReportSendKind.Sent, ReportResponseClassifier.Classify(201, "{\"entry_id\":5}").Kind);
            Assert.Eq(5, ReportResponseClassifier.Classify(201, "{\"entry_id\":5}").EntryId ?? 0);
            Assert.Eq(ReportSendKind.Sent, ReportResponseClassifier.Classify(200, "{\"duplicate\":true,\"entry_id\":5}").Kind);
            Assert.Eq(ReportSendKind.Unauthorized, ReportResponseClassifier.Classify(401, "{}").Kind);
            Assert.Eq(ReportSendKind.Rejected, ReportResponseClassifier.Classify(403, "{\"error\":\"HOURS_PROGRESS\",\"message\":\"Цагаар\"}").Kind);
            Assert.Eq("Цагаар", ReportResponseClassifier.Classify(403, "{\"error\":\"HOURS_PROGRESS\",\"message\":\"Цагаар\"}").Message);
            Assert.Eq(ReportSendKind.Retry, ReportResponseClassifier.Classify(403, "{\"code\":\"office_network_required\"}").Kind);
            Assert.Eq(ReportSendKind.Rejected, ReportResponseClassifier.Classify(400, "{\"error\":\"percentage_above_ceiling\"}").Kind);
            Assert.Eq(ReportSendKind.Rejected, ReportResponseClassifier.Classify(409, "{\"error\":\"indeterminate\"}").Kind);
            Assert.Eq(ReportSendKind.Retry, ReportResponseClassifier.Classify(500, "<html>").Kind);
            Assert.Eq(ReportSendKind.Retry, ReportResponseClassifier.Classify(429, null).Kind);
        }

        /* --------------------------- Контекст --------------------------- */

        [Test]
        public static void DocumentAndProjectSwitch_ResolvesRememberedTask()
        {
            var mem = TrackingContextMemory.InMemory();
            mem.RememberDoc("docA", new TrackingContextMemory.DocInfo { ProjectId = 1, ProjectName = "A" });
            mem.RememberDoc("docB", new TrackingContextMemory.DocInfo { ProjectId = 2, ProjectName = "B" });
            mem.RememberTask(7, 1, 11, "Task A");

            var c = new FakeClock();
            var t = new WorkTracker(P(), c, "s1");
            TrackState reason;
            t.SetContext(mem.Resolve(7, "docA", "a.rvt", out reason), reason);
            Assert.Eq(11, t.Context.TaskId);
            Drive.Run(t, c, TimeSpan.FromMinutes(5), Drive.Busy);

            // Б төслийн баримт руу — тэнд таск сонгоогүй тул ЮУ Ч тоолохгүй.
            t.SetContext(mem.Resolve(7, "docB", "b.rvt", out reason), reason);
            Assert.Null(t.Context);
            Assert.Eq(TrackState.NoTask, reason);
            Drive.Run(t, c, TimeSpan.FromMinutes(5), Drive.Busy);
            Assert.Eq(TrackState.NoTask, t.State);

            // А руу буцав — сонгосон таск АВТОМАТААР үргэлжилнэ.
            t.SetContext(mem.Resolve(7, "docA", "a.rvt", out reason), reason);
            Drive.Run(t, c, TimeSpan.FromMinutes(5), Drive.Busy);
            string date = P().WorkDateOf(c.UtcNow);
            Assert.Near(10 * 60_000, t.SessionActiveMs(11, date), 2_000, "only time on doc A counted");

            // Хэрэглэгч солигдоход (өөр хүн) өмнөх хүний сонголт ашиглагдахгүй.
            Assert.Null(mem.Resolve(8, "docA", "a.rvt", out reason));
            Assert.Null(mem.Resolve(null, "docA", "a.rvt", out reason));
            Assert.Eq(TrackState.SignedOut, reason);
            Assert.Null(mem.Resolve(7, null, null, out reason));
            Assert.Eq(TrackState.NoDocument, reason);
        }

        [Test]
        public static void ContextMemory_PersistsAcrossRestart()
        {
            string path = Path.Combine(Path.GetTempPath(), "mgl-wt-ctx-" + Guid.NewGuid().ToString("N") + ".json");
            try
            {
                var m1 = new TrackingContextMemory(path);
                m1.RememberDoc("docA", new TrackingContextMemory.DocInfo { ProjectId = 3, ProjectName = "P", RevitDocumentId = 44 });
                m1.RememberTask(7, 3, 21, "Task X");
                var m2 = new TrackingContextMemory(path);
                TrackState reason;
                WorkContext ctx = m2.Resolve(7, "docA", "a.rvt", out reason);
                Assert.NotNull(ctx);
                Assert.Eq(21, ctx.TaskId);
                Assert.Eq(44, ctx.RevitDocumentId ?? 0);
            }
            finally
            {
                try { File.Delete(path); } catch { }
            }
        }
    }
}
