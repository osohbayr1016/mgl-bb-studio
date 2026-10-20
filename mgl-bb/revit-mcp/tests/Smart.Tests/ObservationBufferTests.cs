using System;
using System.Collections.Generic;
using RevitMcpAddin.ChangeImpact.Core;

namespace RevitMcpAddin.Smart.Tests
{
    /// <summary>
    /// «Хойшлуулсан ажиглалт»-ын төлөвийн машин: begin → buffer → commit (нэг удаа нийтэлнэ) ба begin → buffer → discard (юу ч нийтлэхгүй).
    /// </summary>
    public static class ObservationBufferTests
    {
        [Test]
        public static void BeginBufferPublish_DeliversEveryItemInOrder_Exactly_Once()
        {
            var b = new ObservationBuffer<string>();
            Assert.True(b.Begin());
            Assert.True(b.Add("a")); Assert.True(b.Add("b")); Assert.True(b.Add("c"));
            Assert.Eq(3, b.Count);
            var got = new List<string>();
            int failed;
            Assert.Eq(3, b.Publish(got.Add, out failed));
            Assert.SeqEq(new[] { "a", "b", "c" }, got);
            Assert.Eq(0, failed);
            Assert.Eq(DeferralState.Published, b.State);
        }

        [Test]
        public static void BeginBufferDiscard_PublishesNothing()
        {
            var b = new ObservationBuffer<string>();
            b.Begin(); b.Add("a"); b.Add("b");
            Assert.Eq(2, b.Discard());
            Assert.Eq(DeferralState.Discarded, b.State);
            var got = new List<string>(); int failed;
            Assert.Eq(0, b.Publish(got.Add, out failed), "хаясны дараа нийтлэхгүй");
            Assert.Eq(0, got.Count);
        }

        [Test]
        public static void PublishTwice_DeliversOnce_NoDuplicates()
        {
            var b = new ObservationBuffer<int>();
            b.Begin(); b.Add(1); b.Add(2);
            int failed; var got = new List<int>();
            b.Publish(got.Add, out failed);
            Assert.Eq(0, b.Publish(got.Add, out failed));
            Assert.SeqEq(new[] { 1, 2 }, got);
        }

        [Test]
        public static void DiscardTwice_AndPublishAfterDiscard_AreNoOps()
        {
            var b = new ObservationBuffer<int>();
            b.Begin(); b.Add(1);
            Assert.Eq(1, b.Discard());
            Assert.Eq(0, b.Discard());
        }

        [Test]
        public static void AddOutsideDeferring_IsRejected_NotSilentlyKept()
        {
            var b = new ObservationBuffer<int>();
            Assert.False(b.Add(1), "эхлээгүй үед");
            b.Begin(); b.Add(2);
            int failed; b.Publish(x => { }, out failed);
            Assert.False(b.Add(3), "нийтэлсний дараа");
            var c = new ObservationBuffer<int>(); c.Begin(); c.Discard();
            Assert.False(c.Add(4), "хаясны дараа");
        }

        [Test]
        public static void BeginTwice_OnlyFirstSucceeds()
        {
            var b = new ObservationBuffer<int>();
            Assert.True(b.Begin());
            Assert.False(b.Begin());
        }

        [Test]
        public static void FailingSink_DoesNotLoseTheRemainingItems_AndIsCounted()
        {
            var b = new ObservationBuffer<int>();
            b.Begin(); b.Add(1); b.Add(2); b.Add(3);
            var got = new List<int>(); int failed;
            int n = b.Publish(x => { if (x == 2) throw new Exception("sink"); got.Add(x); }, out failed);
            Assert.SeqEq(new[] { 1, 3 }, got);
            Assert.Eq(1, failed);
            Assert.Eq(2, n);
        }

        [Test]
        public static void SinkReentrancy_AddDuringPublish_IsIgnored()
        {
            var b = new ObservationBuffer<int>();
            b.Begin(); b.Add(1);
            int failed; int reentered = 0;
            b.Publish(x => { if (b.Add(99)) reentered++; }, out failed);
            Assert.Eq(0, reentered);
        }

        [Test]
        public static void EmptyCommit_IsFine()
        {
            var b = new ObservationBuffer<int>();
            b.Begin();
            int failed;
            Assert.Eq(0, b.Publish(x => { }, out failed));
            Assert.Eq(DeferralState.Published, b.State);
        }
    }
}
