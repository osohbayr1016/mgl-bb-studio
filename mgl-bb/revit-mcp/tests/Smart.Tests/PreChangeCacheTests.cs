using System;
using RevitMcpAddin.ChangeImpact.Core;

namespace RevitMcpAddin.Smart.Tests
{
    /// <summary>Кэш: түлхүүр таарвал л буцна; тэмдэг өөрчлөгдвөл хуучин нь хаягдана; тодорхойгүй түлхүүрээр кэш ХЭЗЭЭ Ч хэрэглэгдэхгүй.</summary>
    public static class PreChangeCacheTests
    {
        private static PreChangeCacheKey Key(string doc = "d1", string stamp = "s1", string wall = "w1", string link = "L", string cfg = "C")
        {
            return new PreChangeCacheKey { DocumentId = doc, ModelStamp = stamp, WallUid = wall, LinkSignature = link, ConfigSignature = cfg };
        }

        [Test]
        public static void SameKey_Hits_DifferentStamp_Misses()
        {
            var c = new PreChangeContextCache<string>();
            c.Put(Key(), "plan");
            string e;
            Assert.True(c.TryGet(Key(), out e)); Assert.Eq("plan", e);
            Assert.False(c.TryGet(Key(stamp: "s2"), out e), "загвар өөрчлөгдсөн");
        }

        [Test]
        public static void UnverifiableSignature_KeyIsNeverUsable_PutAndGetAreNoOps()
        {
            // Линк/тохиргоог уншиж чадаагүй тогтмол тэмдэг хоёр дуудлагад ТЭНЦҮҮ → түлхүүр хэрэглэгдэхгүй, эс бөгөөс буруу кэш таарна.
            var c = new PreChangeContextCache<string>();
            PreChangeCacheKey bad = Key(link: PreChangeCacheKey.Unverifiable);
            Assert.False(bad.IsUsable);
            Assert.False(Key(cfg: PreChangeCacheKey.Unverifiable).IsUsable);
            c.Put(bad, "plan");
            string e;
            Assert.False(c.TryGet(bad, out e), "unverifiable түлхүүрээр кэш таарч болохгүй");
            Assert.True(Key().IsUsable);
        }

        [Test]
        public static void ChangingAnyKeyPart_Misses()
        {
            var c = new PreChangeContextCache<string>();
            c.Put(Key(), "plan");
            string e;
            Assert.False(c.TryGet(Key(doc: "d2"), out e));
            Assert.False(c.TryGet(Key(wall: "w2"), out e));
            Assert.False(c.TryGet(Key(link: "L2"), out e), "линк unload/зөөгдсөн");
            Assert.False(c.TryGet(Key(cfg: "C2"), out e), "гарцын тохиргоо өөрчлөгдсөн");
        }

        [Test]
        public static void PutWithNewStamp_EvictsTheStaleEntryOfTheSameWall()
        {
            var c = new PreChangeContextCache<string>();
            c.Put(Key(stamp: "s1"), "old");
            c.Put(Key(stamp: "s2"), "new");
            Assert.Eq(1, c.Count);
            string e;
            Assert.False(c.TryGet(Key(stamp: "s1"), out e));
            Assert.True(c.TryGet(Key(stamp: "s2"), out e));
        }

        [Test]
        public static void UnknownKey_IsNeverCached_NeverServed()
        {
            var c = new PreChangeContextCache<string>();
            c.Put(Key(stamp: null), "x");
            c.Put(Key(stamp: ""), "x");
            c.Put(Key(wall: null), "x");
            c.Put(null, "x");
            Assert.Eq(0, c.Count);
            string e;
            Assert.False(c.TryGet(Key(stamp: null), out e));
            Assert.False(c.TryGet(null, out e));
        }

        [Test]
        public static void LruEvictsOldest_WhenOverCapacity()
        {
            var c = new PreChangeContextCache<string>(2);
            c.Put(Key(wall: "a"), "A"); c.Put(Key(wall: "b"), "B");
            string e; c.TryGet(Key(wall: "a"), out e);          // a-г дахин ашиглав
            c.Put(Key(wall: "c"), "C");
            Assert.True(c.TryGet(Key(wall: "a"), out e));
            Assert.False(c.TryGet(Key(wall: "b"), out e));
            Assert.True(c.TryGet(Key(wall: "c"), out e));
        }

        [Test]
        public static void PurgeDocument_RemovesOnlyThatDocument()
        {
            var c = new PreChangeContextCache<string>();
            c.Put(Key(doc: "d1", wall: "a"), "A"); c.Put(Key(doc: "d2", wall: "a"), "B");
            c.PurgeDocument("d1");
            string e;
            Assert.False(c.TryGet(Key(doc: "d1", wall: "a"), out e));
            Assert.True(c.TryGet(Key(doc: "d2", wall: "a"), out e));
        }

        [Test]
        public static void HitAndMissCountersAreReal()
        {
            var c = new PreChangeContextCache<string>();
            string e;
            c.TryGet(Key(), out e);
            c.Put(Key(), "p");
            c.TryGet(Key(), out e);
            Assert.Eq(1, c.Hits); Assert.Eq(1, c.Misses);
        }

        [Test]
        public static void ScheduleMemoClone_IsIndependentOfTheCachedCopy()
        {
            var s = new ScheduleSnap { Id = 1, Name = "n", Evaluated = true, Members = new System.Collections.Generic.HashSet<long> { 1, 2 } };
            ScheduleSnap c = BeforeMemo.CloneSchedule(s);
            c.Evaluated = false; c.Members.Add(3);
            Assert.True(s.Evaluated);
            Assert.Eq(2, s.Members.Count);
        }

        [Test]
        public static void ClashKey_IsSlotAndElement()
        {
            Assert.Eq("-1:55", BeforeMemo.ClashKey(-1, 55));
            Assert.Eq("2:55", BeforeMemo.ClashKey(2, 55));
        }
    }
}
