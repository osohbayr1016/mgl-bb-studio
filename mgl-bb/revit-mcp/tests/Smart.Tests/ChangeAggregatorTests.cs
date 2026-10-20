using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.ChangeImpact.Core;

namespace RevitMcpAddin.Smart.Tests
{
    public static class ChangeAggregatorTests
    {
        private static ChangeBatch B(long seq, params ChangeEntry[] entries)
        {
            var b = new ChangeBatch { Seq = seq, Utc = new DateTime(2026, 10, 1, 9, 0, 0, DateTimeKind.Utc).AddSeconds(seq), Resolved = true };
            b.Entries.AddRange(entries);
            b.Added = entries.Count(e => e.Kind == ChangeKind.Added);
            b.Modified = entries.Count(e => e.Kind == ChangeKind.Modified);
            b.Deleted = entries.Count(e => e.Kind == ChangeKind.Deleted);
            return b;
        }

        private static ChangeEntry E(long id, ChangeKind k, bool known = true)
        {
            return new ChangeEntry { Id = id, Kind = k, Known = known, Uid = known ? "u" + id : null, Category = known ? "Walls" : null };
        }

        private static AggregatedChanges Agg(List<ChangeBatch> all, long from = 0, long to = long.MaxValue, long[] only = null, int max = 1000, IEnumerable<ExtraChange> extra = null)
        {
            return ChangeAggregator.Aggregate(all, from, to, only, max, extra);
        }

        [Test]
        public static void Range_FromIsExclusive_ToIsInclusive_AndOnlySelectionNarrows()
        {
            var all = new List<ChangeBatch> { B(10, E(1, ChangeKind.Modified)), B(20, E(2, ChangeKind.Modified)), B(30, E(3, ChangeKind.Modified)) };
            Assert.SeqEq(new long[] { 2, 3 }, Agg(all, from: 10).Sources.Select(s => s.Id), "from хасагдсан (checkpoint-ийн дугаар өөрөө орохгүй)");
            Assert.SeqEq(new long[] { 1, 2 }, Agg(all, to: 20).Sources.Select(s => s.Id), "to орно");
            Assert.SeqEq(new long[] { 3 }, Agg(all, only: new long[] { 30 }).Sources.Select(s => s.Id));
            Assert.SeqEq(new long[] { 2 }, Agg(all, from: 10, only: new long[] { 10, 20 }).Sources.Select(s => s.Id), "сонголт ба муж хоёулаа");
            Assert.Eq(30L, Agg(all).ToSeq);
            Assert.Eq(99L, Agg(all, from: 99).ToSeq, "багц олдоогүй бол ToSeq = From");
            Assert.Eq(0, Agg(all, from: 99).Sources.Count);
        }

        [Test]
        public static void SameElementChangedManyTimes_IsOneSource_WithLatestSeq()
        {
            var all = new List<ChangeBatch> { B(10, E(1, ChangeKind.Modified)), B(20, E(1, ChangeKind.Modified), E(2, ChangeKind.Modified)), B(30, E(1, ChangeKind.Modified)) };
            AggregatedChanges r = Agg(all);
            Assert.Eq(2, r.Sources.Count);
            Assert.Eq(30L, r.Sources.Single(s => s.Id == 1).Seq);
            Assert.Eq(20L, r.Sources.Single(s => s.Id == 2).Seq);
            Assert.Eq(2, r.Modified);
        }

        [Test]
        public static void KindMerge_FollowsDocumentedRules()
        {
            var all = new List<ChangeBatch>
            {
                B(10, E(1, ChangeKind.Added), E(2, ChangeKind.Added), E(3, ChangeKind.Modified), E(4, ChangeKind.Deleted), E(5, ChangeKind.Added)),
                B(20, E(1, ChangeKind.Modified), E(2, ChangeKind.Deleted), E(3, ChangeKind.Deleted), E(4, ChangeKind.Added), E(5, ChangeKind.Deleted)),
                B(30, E(5, ChangeKind.Added)),
            };
            AggregatedChanges r = Agg(all);
            Assert.Eq(ChangeKind.Added, r.Sources.Single(s => s.Id == 1).Kind, "Нэмэгдээд засагдсан = Нэмэгдсэн");
            Assert.False(r.Sources.Any(s => s.Id == 2), "Нэмэгдээд устсан = цэвэр өөрчлөлтгүй");
            Assert.Eq(ChangeKind.Deleted, r.Sources.Single(s => s.Id == 3).Kind, "Засагдаад устсан = Устсан");
            Assert.Eq(ChangeKind.Modified, r.Sources.Single(s => s.Id == 4).Kind, "Устаад сэргээгдсэн (undo) = Өөрчлөгдсөн");
            Assert.Eq(ChangeKind.Added, r.Sources.Single(s => s.Id == 5).Kind, "Нэмэгдээд устаад дахин нэмэгдсэн (undo/redo) = Нэмэгдсэн");
            Assert.Eq(1, r.NetZero);
            Assert.True(r.Notes.Any(n => n.Contains("цэвэр өөрчлөлтгүй")));
            Assert.Eq(2, r.Added);
            Assert.Eq(1, r.Deleted);
            Assert.Eq(1, r.Modified);
        }

        [Test]
        public static void UnresolvedDeleted_IsCounted_OnlyWhenIdentityUnknown()
        {
            var all = new List<ChangeBatch>
            {
                B(10, E(1, ChangeKind.Deleted, known: true), E(2, ChangeKind.Deleted, known: false), E(3, ChangeKind.Modified, known: false)),
            };
            AggregatedChanges r = Agg(all);
            Assert.Eq(2, r.Deleted);
            Assert.Eq(1, r.UnresolvedDeleted, "зөвхөн мэдээлэлгүй УСТСАН нь");
            Assert.True(r.Entries[1].Known);
        }

        [Test]
        public static void Entry_PrefersKnownIdentityAcrossBatches()
        {
            var all = new List<ChangeBatch>
            {
                B(10, E(1, ChangeKind.Modified, known: true)),
                B(20, E(1, ChangeKind.Deleted, known: false)),        // сүүлд мэдээлэлгүй устсан бичлэг
            };
            AggregatedChanges r = Agg(all);
            Assert.Eq(ChangeKind.Deleted, r.Sources.Single().Kind);
            Assert.True(r.Entries[1].Known, "өмнө мэдэгдсэн идентитиг хадгална");
            Assert.Eq(0, r.UnresolvedDeleted, "өмнөх бичлэгээс мэдэгдэж байна");
        }

        [Test]
        public static void MaxSources_KeepsMostRecent_AndSaysSo()
        {
            var all = new List<ChangeBatch>();
            for (int i = 1; i <= 50; i++) all.Add(B(i * 10, E(i, ChangeKind.Modified)));
            AggregatedChanges r = Agg(all, max: 20);
            Assert.True(r.Truncated);
            Assert.Eq(20, r.Sources.Count);
            Assert.True(r.Sources.All(s => s.Id > 30), "хамгийн сүүлийн 20");
            Assert.Eq(50, r.TotalElements);
            Assert.True(r.Notes.Any(n => n.Contains("хамгийн сүүлийн 20")));
        }

        [Test]
        public static void ExtraChanges_AreMergedOnlyWhenAbsentFromLog()
        {
            var all = new List<ChangeBatch> { B(10, E(1, ChangeKind.Modified)) };
            var extra = new[]
            {
                new ExtraChange { Id = 1, Kind = ChangeKind.Deleted, Seq = 99 },     // бүртгэлд байгаа — нарийвчилсан нь давамгайлна
                new ExtraChange { Id = 2, Kind = ChangeKind.Modified, Seq = 99 },
                new ExtraChange { Id = 3, Kind = ChangeKind.Deleted, Seq = 99 },
            };
            AggregatedChanges r = Agg(all, extra: extra);
            Assert.Eq(3, r.Sources.Count);
            Assert.Eq(ChangeKind.Modified, r.Sources.Single(s => s.Id == 1).Kind, "бүртгэлийн мэдээлэл дарагдахгүй");
            Assert.Eq(1, r.UnresolvedDeleted, "Revit-ийн түүхээс ирсэн устсан нь идентитигүй");
            Assert.Eq(99L, r.Sources.Single(s => s.Id == 2).Seq);
        }

        [Test]
        public static void TruncatedBatch_AddsNote_AndSourcesAreDeterministicallyOrdered()
        {
            var b = B(10, E(30, ChangeKind.Modified), E(10, ChangeKind.Modified), E(20, ChangeKind.Modified));
            b.Truncated = true;
            b.Modified = 6000;
            AggregatedChanges r = Agg(new List<ChangeBatch> { b });
            Assert.True(r.Notes.Any(n => n.Contains("хэт олон өөрчлөлттэй") && n.Contains("6000")), string.Join("|", r.Notes));
            Assert.SeqEq(new long[] { 10, 20, 30 }, r.Sources.Select(s => s.Id), "id-аар эрэмбэлэгдсэн (тогтвортой үр дүн)");
        }

        [Test]
        public static void NullOrEmptyInput_IsSafe()
        {
            AggregatedChanges r = ChangeAggregator.Aggregate(null, 0, long.MaxValue, null, 10);
            Assert.Eq(0, r.Sources.Count);
            Assert.Eq(0, r.BatchCount);
            var emptyBatch = new ChangeBatch { Seq = 5 };
            emptyBatch.Entries = null;
            AggregatedChanges r2 = ChangeAggregator.Aggregate(new List<ChangeBatch> { emptyBatch }, 0, long.MaxValue, null, 10);
            Assert.Eq(0, r2.Sources.Count);
            Assert.Eq(5L, r2.ToSeq);
        }
    }
}
