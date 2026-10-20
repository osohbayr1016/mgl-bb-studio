using System;
using System.Linq;
using System.Threading;
using RevitMcpAddin.ChangeImpact.Core;

namespace RevitMcpAddin.Smart.Tests
{
    /// <summary>Шатны хугацаа нь ҮНЭН (шат тус бүрийн) хугацаа — хуримтлагдсан stopwatch БИШ.</summary>
    public static class StageClockTests
    {
        [Test]
        public static void StageDuration_IsTheStageOnly_NotCumulative()
        {
            var c = new StageClock();
            c.Measure("a", () => Thread.Sleep(60));
            c.Measure("b", () => Thread.Sleep(60));
            var s = c.Snapshot();
            Assert.True(s["a"] >= 50 && s["a"] < 110, "a=" + s["a"]);
            // Өмнөх алдаа: b = a + b (≈120) болдог байв.
            Assert.True(s["b"] >= 50 && s["b"] < 110, "b=" + s["b"]);
        }

        [Test]
        public static void SameStageMeasuredTwice_Sums()
        {
            var c = new StageClock();
            c.Measure("x", () => Thread.Sleep(30)); c.Measure("x", () => Thread.Sleep(30));
            Assert.True(c.Snapshot()["x"] >= 50);
        }

        [Test]
        public static void StageSum_NeverExceedsTotal()
        {
            var c = new StageClock();
            c.Measure("a", () => Thread.Sleep(20)); Thread.Sleep(20); c.Measure("b", () => Thread.Sleep(20));
            var s = c.Snapshot();
            Assert.True(c.StagesSumMs() <= s["total"]);
            Assert.True(s["total"] >= c.StagesSumMs() + 15, "завсар хүлээлт шатад орохгүй");
        }

        [Test]
        public static void Mark_RecordsFirstElapsedOnly()
        {
            var c = new StageClock();
            Thread.Sleep(25); c.Mark("first_result");
            long first = c.Snapshot()["first_result"];
            Thread.Sleep(25); c.Mark("first_result");
            Assert.Eq(first, c.Snapshot()["first_result"]);
            Assert.True(first >= 20);
        }

        [Test]
        public static void ThrowingWork_StillRecordsTheDuration()
        {
            var c = new StageClock();
            Assert.Throws<InvalidOperationException>(() => c.Measure("boom", () => { Thread.Sleep(30); throw new InvalidOperationException(); }));
            Assert.True(c.Snapshot()["boom"] >= 25);
        }

        [Test]
        public static void InvalidStageOrNegative_IsIgnored()
        {
            var c = new StageClock();
            c.Add(null, 5); c.Add("", 5); c.Add("n", -1);
            Assert.False(c.Snapshot().ContainsKey("n"));
        }

        [Test]
        public static void MeasureWithResult_ReturnsValue()
        {
            Assert.Eq(42, new StageClock().Measure("v", () => 42));
        }

        [Test]
        public static void Merge_SumsStagesByName()
        {
            var m = StageClock.Merge(new[] { new System.Collections.Generic.Dictionary<string, long> { { "a", 5 } }, new System.Collections.Generic.Dictionary<string, long> { { "a", 7 }, { "b", 1 } } });
            Assert.Eq(12L, m["a"]); Assert.Eq(1L, m["b"]);
        }
    }
}
