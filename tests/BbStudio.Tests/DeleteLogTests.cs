using System;
using System.Linq;
using MglBb.Core;

namespace MglBb.Tests
{
    public static class DeleteLogTests
    {
        private static BbDeleteBatch Batch(string key, string user, string when)
        {
            var b = new BbDeleteBatch { Key = key, User = user, WhenUtc = when, View = "1 давхар" };
            b.Items.Add(new BbDeletedItem { Id = 12345, UniqueId = "u-1", Category = "Багана", Name = "M_Concrete: 400x400", Mark = "К-1", Level = "1 давхар", Creator = "dorj" });
            return b;
        }

        [Test]
        public static void BatchRoundTripsThroughModelText()
        {
            BbDeleteBatch b = Batch("k1", "bat", "2026-10-22T06:03:00.0000000Z");
            b.Dependents = 3;
            b.Truncated = 2;
            BbDeleteBatch back = BbDeleteBatch.Parse(BbJson.Write(b.ToJson(), false));
            Assert.Eq("bat", back.User);
            Assert.Eq(12345L, back.Items.Single().Id);
            Assert.Eq("dorj", back.Items[0].Creator);
            Assert.Eq(3, back.Dependents);
            Assert.Eq(3, back.Count, "нэрээр 1 + тоогоор 2");
            Assert.Eq(new DateTime(2026, 10, 22, 6, 3, 0, DateTimeKind.Utc), back.When);
            Assert.Eq(null, BbDeleteBatch.Parse("{oops"), "эвдэрсэн бичвэр");
            Assert.Eq(null, BbDeleteBatch.Parse("{}"), "түлхүүргүй");
        }

        [Test]
        public static void SentenceSaysWhichElementWhoDeleted()
        {
            BbDeleteBatch b = Batch("k1", "bat", "2026-10-22T06:03:00Z");
            Assert.Eq("«Багана: M_Concrete: 400x400 · К-1 · 1 давхар · id 12345» элементийг bat устгалаа (үүсгэсэн: dorj)", BbDeleteLog.Sentence(b, b.Items[0]));
            b.Items[0].Creator = "BAT";
            Assert.False(BbDeleteLog.Sentence(b, b.Items[0]).Contains("үүсгэсэн"), "өөрөө үүсгэсэн бол хэлэхгүй");
            Assert.Eq("Элемент · id 7", BbDeleteLog.Describe(new BbDeletedItem { Id = 7 }));
        }

        [Test]
        public static void UnseenSkipsOwnAndAlreadyShown()
        {
            var all = new[] { Batch("b", "dorj", "2026-10-22T08:00:00Z"), Batch("a", "dorj", "2026-10-22T07:00:00Z"), Batch("c", "Bat ", "2026-10-22T09:00:00Z"), Batch("d", "tuya", "2026-10-22T06:00:00Z") };
            var st = new BbDeleteWatchState();
            st.MarkSeen("P", new[] { "d" });
            var un = BbDeleteLog.Unseen(all, k => st.Seen("P", k), "bat");
            Assert.Eq("a,b", string.Join(",", un.Select(x => x.Key)), "өөрийнх (c) ба харсан (d) орохгүй, эртнээс нь");

            var lines = BbDeleteLog.Lines(un, t => t, 3);
            Assert.True(lines[0].StartsWith("2026-10-22 07:00 — dorj 1 элемент устгалаа"), lines[0]);
            Assert.Eq("… өөр 1 элемент («Устгалтын түүх»-ээс харна уу)", lines.Last());
        }

        [Test]
        public static void WatchStateRoundTripsAndCaps()
        {
            var st = new BbDeleteWatchState { WarnBeforeDelete = false };
            Assert.False(st.Knows("P"));
            st.MarkSeen("P", Enumerable.Range(0, BbDeleteWatchState.MaxSeenPerProject + 5).Select(i => "k" + i));
            BbDeleteWatchState back = BbDeleteWatchState.FromJson(BbJson.Parse(BbJson.Write(st.ToJson())));
            Assert.False(back.WarnBeforeDelete);
            Assert.True(back.Knows("p"), "төслийн түлхүүр том жижиг үсэг ялгахгүй");
            Assert.False(back.Seen("P", "k0"), "хамгийн хуучин нь хаягдсан");
            Assert.True(back.Seen("P", "k" + (BbDeleteWatchState.MaxSeenPerProject + 4)));
            Assert.True(new BbDeleteWatchState().WarnBeforeDelete, "өгөгдмөл = анхааруулна");
        }
    }
}
