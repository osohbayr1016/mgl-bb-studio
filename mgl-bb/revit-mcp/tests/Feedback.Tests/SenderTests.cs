using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using RevitMcpAddin.Feedback.Core;

namespace RevitMcpAddin.Feedback.Tests
{
    public static class SenderTests
    {
        private static readonly DateTimeOffset T0 = new DateTimeOffset(2026, 10, 16, 4, 0, 0, TimeSpan.Zero);

        private sealed class Env
        {
            public FeedbackOutbox Box;
            public FakeServer Server;
            public FeedbackSender Sender;
            public string Scope;
            public string Src;
            public DateTimeOffset Now = T0;
        }

        private static Env Setup()
        {
            FeedbackLimits.ResetToDefaults();
            var e = new Env { Box = new FeedbackOutbox(Tmp.Dir("send")), Server = new FakeServer(), Src = Tmp.Dir("src") };
            e.Scope = FeedbackScope.Key("https://api.example.com", null, 10);
            e.Sender = new FeedbackSender(e.Box, e.Server, () => e.Now, () => 0.5);
            return e;
        }

        private static FeedbackItem Enqueue(Env e, params (string name, int size)[] files)
        {
            var src = files.Select(f => new FeedbackSourceFile { Path = Tmp.File(e.Src, f.name, f.size), Name = f.name }).ToList();
            return e.Box.Enqueue(OutboxTests.NewItem(e.Scope), src);
        }

        private static string Send(Env e, FeedbackItem it)
        {
            using (IDisposable lease = e.Box.TryLease(it))
            {
                Assert.NotNull(lease, "lease");
                return e.Sender.SendAsync(it, CancellationToken.None).GetAwaiter().GetResult();
            }
        }

        [Test]
        public static void Text_only_request_gets_a_number()
        {
            Env e = Setup();
            FeedbackItem it = Enqueue(e);
            Assert.Eq(FeedbackStates.Submitted, Send(e, it));
            FeedbackItem saved = e.Box.Load(e.Scope, it.Id);
            Assert.Eq(FeedbackStates.Submitted, saved.State);
            Assert.Eq("ПХ-0001", saved.Receipt.DisplayNumber);
            Assert.Eq(1, e.Server.Drafts.Count);
            Assert.Eq(it.Id, e.Server.Drafts.Values.Single().Crid, "client_request_id = item.Id");
        }

        [Test]
        public static void Single_and_multipart_attachments_arrive_intact_and_local_copies_are_dropped()
        {
            Env e = Setup();
            int big = 26 * 1024 * 1024 + 123;
            FeedbackItem it = Enqueue(e, ("лог.txt", 3000), ("загвар.rvt", big));
            byte[] rvt = File.ReadAllBytes(e.Box.FilePath(it, it.Attachments[1]));
            Assert.Eq(FeedbackStates.Submitted, Send(e, it));
            FakeServer.Draft d = e.Server.Drafts.Values.Single();
            Assert.Eq(2, d.Atts.Count);
            FakeServer.Att m = d.Atts.Single(a => a.Name == "загвар.rvt");
            Assert.Eq("multipart", m.Mode);
            Assert.Eq(4, m.PartCount);
            Assert.Eq(FakeServer.Hex(rvt), FakeServer.Hex(m.Bytes), "multipart байт бүрэн");
            Assert.Eq("single", d.Atts.Single(a => a.Name == "лог.txt").Mode);
            Assert.False(Directory.Exists(Path.Combine(e.Box.ItemDir(e.Scope, it.Id), "files")), "илгээсний дараа локал хуулбар устсан");
            Assert.NotNull(e.Box.Load(e.Scope, it.Id), "item.json түүх болж үлдсэн");
        }

        [Test]
        public static void Interrupted_multipart_resumes_without_resending_accepted_parts()
        {
            Env e = Setup();
            FeedbackItem it = Enqueue(e, ("загвар.rvt", 26 * 1024 * 1024 + 7));
            e.Server.Fail("part:3", new FeedbackNetworkException("сүлжээ тасарсан"));
            Assert.Eq(FeedbackStates.RetryWait, Send(e, it));
            FeedbackItem mid = e.Box.Load(e.Scope, it.Id);
            Assert.SeqEqInt(new[] { 1, 2 }, mid.Attachments[0].UploadedParts);
            Assert.NotNull(mid.NextAttemptAt);
            Assert.False(mid.IsDue(e.Now), "ухралтын хугацаа дуусаагүй");
            e.Now = e.Now.AddMinutes(5);
            Assert.True(mid.IsDue(e.Now));
            int partCallsBefore = e.Server.Calls.Count(c => c.StartsWith("part:"));
            Assert.Eq(FeedbackStates.Submitted, Send(e, mid));
            int partCallsAfter = e.Server.Calls.Count(c => c.StartsWith("part:"));
            Assert.Eq(2, partCallsAfter - partCallsBefore, "зөвхөн 3, 4-р хэсэг дахин явсан");
            Assert.Eq(1, e.Server.Calls.Count(c => c == "draft"), "ноорог давтагдаагүй");
        }

        [Test]
        public static void Expired_attachment_is_re_reserved_from_the_local_copy()
        {
            Env e = Setup();
            FeedbackItem it = Enqueue(e, ("зураг.png", 5000));
            e.Server.Fail("content", new FeedbackHttpException(410, "UPLOAD_EXPIRED", "Илгээх хугацаа дууссан"));
            Assert.Eq(FeedbackStates.Submitted, Send(e, it));
            FakeServer.Draft d = e.Server.Drafts.Values.Single();
            Assert.Eq(2, d.Atts.Count, "хоёр дахь нөөцлөлт шинэ түлхүүрээр");
            Assert.Eq("ready", d.Atts[1].State);
        }

        [Test]
        public static void Server_side_cleanup_before_submit_is_recovered()
        {
            Env e = Setup();
            FeedbackItem it = Enqueue(e, ("зураг.png", 5000));
            // эхний submit-ийн өмнө хавсралтыг сервер цуцалсан мэт
            e.Server.Fail("submit", new FeedbackHttpException(409, "ATTACHMENTS_PENDING", "pending"));
            Assert.Eq(FeedbackStates.Submitted, Send(e, it));
            Assert.Eq(2, e.Server.Calls.Count(c => c == "submit"));
        }

        [Test]
        public static void Unauthorized_waits_for_sign_in_without_burning_attempts()
        {
            Env e = Setup();
            FeedbackItem it = Enqueue(e);
            e.Server.Fail("draft", new FeedbackHttpException(401, null, "expired"));
            Assert.Eq(FeedbackStates.AuthRequired, Send(e, it));
            FeedbackItem saved = e.Box.Load(e.Scope, it.Id);
            Assert.Eq(0, saved.Attempts);
            Assert.True(saved.LastError.Message.Contains("нэвтэрнэ"), saved.LastError.Message);
            e.Now = e.Now.AddMinutes(2);
            Assert.Eq(FeedbackStates.Submitted, Send(e, saved));
        }

        [Test]
        public static void Forbidden_and_invalid_fields_need_the_user_and_keep_the_text()
        {
            Env e = Setup();
            FeedbackItem it = Enqueue(e);
            e.Server.Fail("draft", new FeedbackHttpException(403, "FORBIDDEN", "Хүсэлт илгээх эрхгүй байна"));
            Assert.Eq(FeedbackStates.Failed, Send(e, it));
            FeedbackItem saved = e.Box.Load(e.Scope, it.Id);
            Assert.Null(saved.NextAttemptAt);
            Assert.False(saved.IsDue(e.Now.AddDays(1)), "failed-ийг автомат илгээгч авахгүй");
            Assert.Eq("Ханын дэлгээс унав", saved.Fields.Title, "текст хадгалагдсан");
            FeedbackSender.ResetForRetry(saved);
            e.Box.Save(saved);
            Assert.Eq(FeedbackStates.Submitted, Send(e, saved));

            FeedbackItem bad = Enqueue(e);
            bad.Fields.Title = "x";
            e.Box.Save(bad);
            Assert.Eq(FeedbackStates.Failed, Send(e, bad));
            Assert.Eq("INCOMPLETE", e.Box.Load(e.Scope, bad.Id).LastError.Code);
        }

        [Test]
        public static void Server_errors_back_off_and_honour_retry_after()
        {
            Env e = Setup();
            FeedbackItem it = Enqueue(e);
            e.Server.Fail("submit", new FeedbackHttpException(503, "UNAVAILABLE", "busy", TimeSpan.FromSeconds(90)));
            Assert.Eq(FeedbackStates.RetryWait, Send(e, it));
            FeedbackItem saved = e.Box.Load(e.Scope, it.Id);
            Assert.Eq(FeedbackTime.Iso(T0.AddSeconds(90)), saved.NextAttemptAt);
            Assert.NotNull(saved.DraftId, "ноорог хадгалагдсан — дахин үүсгэхгүй");
        }

        [Test]
        public static void Lost_response_after_submit_is_idempotent()
        {
            Env e = Setup();
            FeedbackItem it = Enqueue(e, ("зураг.png", 4000));
            Assert.Eq(FeedbackStates.Submitted, Send(e, it));
            // Item-ийг submit өмнөх төлөв рүү буцааж (хариу алдагдсан мэт) дахин илгээнэ.
            FeedbackItem again = e.Box.Load(e.Scope, it.Id);
            again.State = FeedbackStates.Queued;
            again.Receipt = null;
            Assert.Eq(FeedbackStates.Submitted, e.Sender.SendAsync(again, CancellationToken.None).GetAwaiter().GetResult());
            Assert.Eq("ПХ-0001", again.Receipt.DisplayNumber, "ижил дугаар, давхар хүсэлт үгүй");
            Assert.Eq(1, e.Server.Drafts.Count);
        }

        [Test]
        public static void Conflict_returns_the_original_receipt()
        {
            Env e = Setup();
            FeedbackItem it = Enqueue(e);
            Assert.Eq(FeedbackStates.Submitted, Send(e, it));
            FeedbackItem changed = e.Box.Load(e.Scope, it.Id);
            changed.State = FeedbackStates.Queued;
            changed.Fields.Title = "Өөр гарчиг";
            Assert.Eq(FeedbackStates.Submitted, e.Sender.SendAsync(changed, CancellationToken.None).GetAwaiter().GetResult());
            Assert.NotNull(changed.Receipt.Note);
            Assert.Eq("ПХ-0001", changed.Receipt.DisplayNumber);
        }

        [Test]
        public static void Missing_parts_reported_by_complete_are_resent()
        {
            Env e = Setup();
            FeedbackItem it = Enqueue(e, ("загвар.rvt", 26 * 1024 * 1024 + 9));
            e.Server.Fail("complete", new FeedbackHttpException(409, "PARTS_MISSING", "missing", missing: new List<int> { 2 }));
            Assert.Eq(FeedbackStates.Submitted, Send(e, it));
            Assert.Eq(5, e.Server.Calls.Count(c => c.StartsWith("part:")), "4 + дахин илгээсэн 2-р хэсэг");
        }

        [Test]
        public static void Removing_an_item_while_sending_stops_cleanly()
        {
            Env e = Setup();
            FeedbackItem it = Enqueue(e);
            Directory.Delete(e.Box.ItemDir(e.Scope, it.Id), true);
            Assert.Eq(FeedbackStates.Cancelled, e.Sender.SendAsync(it, CancellationToken.None).GetAwaiter().GetResult());
            Assert.Eq(0, e.Box.List(e.Scope).Count, "цуцлагдсан item дахин гарч ирээгүй");
        }

        [Test]
        public static void Cancellation_requeues_without_counting_an_attempt()
        {
            Env e = Setup();
            FeedbackItem it = Enqueue(e);
            using (var cts = new CancellationTokenSource())
            {
                cts.Cancel();
                e.Server.Fail("draft", new OperationCanceledException(cts.Token));
                string s = e.Sender.SendAsync(it, cts.Token).GetAwaiter().GetResult();
                Assert.Eq(FeedbackStates.Queued, s);
                Assert.Eq(0, e.Box.Load(e.Scope, it.Id).Attempts);
            }
        }
    }
}
