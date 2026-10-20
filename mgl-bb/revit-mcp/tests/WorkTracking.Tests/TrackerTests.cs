using System;
using System.Linq;
using RevitMcpAddin.WorkTracking.Core;

namespace RevitMcpAddin.WorkTracking.Tests
{
    /// <summary>Төлөвийн шилжилт — Revit API-гүй, хуурамч цагаар.</summary>
    public static class TrackerTests
    {
        private static TrackingPolicy P() => new TrackingPolicy();

        /// <summary>Хүн тодорхой агшинд оролтоо зогсоосныг загварчилна.</summary>
        private sealed class Person
        {
            private readonly FakeClock _c;
            private long _lastInput;
            public bool Foreground = true;
            public bool Locked;
            public Person(FakeClock c) { _c = c; _lastInput = c.MonotonicMs; }
            public void Touch() => _lastInput = _c.MonotonicMs;
            public ActivitySignals Signals() => new ActivitySignals
            {
                RevitForeground = Foreground,
                IdleMs = _c.MonotonicMs - _lastInput,
                SessionLocked = Locked,
            };
        }

        private static void Work(WorkTracker t, FakeClock c, Person p, TimeSpan d)
        {
            Drive.Run(t, c, d, () => { p.Touch(); return p.Signals(); });
        }

        private static void Away(WorkTracker t, FakeClock c, Person p, TimeSpan d)
        {
            Drive.Run(t, c, d, p.Signals);
        }

        [Test]
        public static void NoTask_NeverCounts()
        {
            var c = new FakeClock();
            var t = new WorkTracker(P(), c, "s1");
            t.SetContext(null, TrackState.NoTask);
            Drive.Run(t, c, TimeSpan.FromMinutes(10), Drive.Busy);
            Assert.Eq(TrackState.NoTask, t.State);
            Assert.Eq(0, t.DrainDirty().Count, "no segments without a task");
        }

        [Test]
        public static void Working_ToIdle_AtThreshold_GraceCounts()
        {
            var c = new FakeClock();
            var p = new Person(c);
            var t = new WorkTracker(P(), c, "s1");
            t.SetContext(Ctx.Task(1));
            t.Sample(p.Signals());

            Work(t, c, p, TimeSpan.FromMinutes(60));            // 09:00–10:00 ажиллав
            Assert.Eq(TrackState.Working, t.State);
            Away(t, c, p, TimeSpan.FromMinutes(4) + TimeSpan.FromSeconds(58));
            Assert.Eq(TrackState.Working, t.State, "grace: still working at 10:04:58");
            Away(t, c, p, TimeSpan.FromSeconds(4));
            Assert.Eq(TrackState.Idle, t.State, "idle after 5 min");
            Away(t, c, p, TimeSpan.FromMinutes(30));
            Assert.Eq(TrackState.Idle, t.State);

            string date = P().WorkDateOf(c.UtcNow);
            long active = t.SessionActiveMs(1, date);
            // 60 мин ажил + 5 мин бодох хүлцэл — хагас минутын ч илүү/дутуу БИШ (2 с алхам).
            Assert.Near(65 * 60_000, active, 2_000, "active = work + grace");
            var seg = t.DrainDirty().Single();
            Assert.Near(seg.ActiveMs + seg.IdleMs, (60 + 4 + 58.0 / 60 + 4.0 / 60 + 30) * 60_000, 1, "active+idle = elapsed");
        }

        [Test]
        public static void Idle_ToWorking_ContinuesSameTaskAutomatically()
        {
            var c = new FakeClock();
            var p = new Person(c);
            var t = new WorkTracker(P(), c, "s1");
            t.SetContext(Ctx.Task(1));
            t.Sample(p.Signals());
            Work(t, c, p, TimeSpan.FromMinutes(10));
            Away(t, c, p, TimeSpan.FromMinutes(20));
            Assert.Eq(TrackState.Idle, t.State);
            string date = P().WorkDateOf(c.UtcNow);
            long beforeReturn = t.SessionActiveMs(1, date);

            Work(t, c, p, TimeSpan.FromMinutes(10));             // буцаж ирэв — товч дарахгүй
            Assert.Eq(TrackState.Working, t.State, "resumes without a button");
            long after = t.SessionActiveMs(1, date);
            Assert.Near(10 * 60_000, after - beforeReturn, 2_000, "only the new 10 minutes");
            Assert.Near(15 * 60_000, beforeReturn, 2_000, "10 min work + 5 min grace");
            Assert.Eq(1, t.DrainDirty().Count, "still one segment for the same task");
        }

        [Test]
        public static void TaskA_ToTaskB_AStopsGrowing_BAccumulates()
        {
            var c = new FakeClock();
            var p = new Person(c);
            var t = new WorkTracker(P(), c, "s1");
            t.SetContext(Ctx.Task(1));
            t.Sample(p.Signals());
            Work(t, c, p, TimeSpan.FromMinutes(20));
            string date = P().WorkDateOf(c.UtcNow);

            t.SetContext(Ctx.Task(2));
            long aAtSwitch = t.SessionActiveMs(1, date);
            Work(t, c, p, TimeSpan.FromMinutes(30));

            Assert.Eq(aAtSwitch, t.SessionActiveMs(1, date), "A frozen after switch");
            Assert.Near(20 * 60_000, aAtSwitch, 2_000);
            Assert.Near(30 * 60_000, t.SessionActiveMs(2, date), 2_000);
            var segs = t.DrainDirty();
            Assert.Eq(2, segs.Count);
            Assert.Eq(2, segs.Select(s => s.SegmentId).Distinct().Count(), "distinct segment ids");
        }

        [Test]
        public static void SwitchMidInterval_CreditsUpToSwitchMoment()
        {
            var c = new FakeClock();
            var p = new Person(c);
            var t = new WorkTracker(P(), c, "s1");
            t.SetContext(Ctx.Task(1));
            t.Sample(p.Signals());
            c.Advance(TimeSpan.FromSeconds(1)); p.Touch();      // уншилтын ДУНД сольж байна
            t.SetContext(Ctx.Task(2));
            c.Advance(TimeSpan.FromSeconds(1)); p.Touch();
            t.Sample(p.Signals());
            string date = P().WorkDateOf(c.UtcNow);
            Assert.Eq(1000L, t.SessionActiveMs(1, date));
            Assert.Eq(1000L, t.SessionActiveMs(2, date));
        }

        [Test]
        public static void SameWork_ContextRefresh_DoesNotResetOrSplit()
        {
            var c = new FakeClock();
            var p = new Person(c);
            var t = new WorkTracker(P(), c, "s1");
            t.SetContext(Ctx.Task(1));
            t.Sample(p.Signals());
            Work(t, c, p, TimeSpan.FromMinutes(1));
            var again = Ctx.Task(1);
            again.RevitDocumentId = 55;       // сервер баримтын id хожим ирлээ
            t.SetContext(again);
            Work(t, c, p, TimeSpan.FromMinutes(1));
            var segs = t.DrainDirty();
            Assert.Eq(1, segs.Count);
            Assert.Eq(55, segs[0].RevitDocumentId ?? 0);
            Assert.Near(120_000, segs[0].ActiveMs, 1);
        }

        [Test]
        public static void ForegroundGrace_BriefSwitchCounts_LongSwitchDoesNot()
        {
            var c = new FakeClock();
            var p = new Person(c);
            var t = new WorkTracker(P(), c, "s1");
            t.SetContext(Ctx.Task(1));
            t.Sample(p.Signals());
            string date = P().WorkDateOf(c.UtcNow);

            p.Foreground = false;                                   // Explorer-т файл хайх 20 с
            Work(t, c, p, TimeSpan.FromSeconds(20));
            Assert.Eq(TrackState.Working, t.State, "no thrash on a brief switch");
            p.Foreground = true;
            Work(t, c, p, TimeSpan.FromSeconds(10));
            Assert.Near(30_000, t.SessionActiveMs(1, date), 1, "brief switch fully counted");

            p.Foreground = false;                                   // хөтөчид 3 минут
            Work(t, c, p, TimeSpan.FromMinutes(3));
            Assert.Eq(TrackState.Background, t.State);
            long afterLong = t.SessionActiveMs(1, date);
            Assert.Near(30_000 + 30_000, afterLong, 2_000, "only the 30 s grace of the long switch");

            p.Foreground = true;
            Work(t, c, p, TimeSpan.FromMinutes(1));
            Assert.Eq(TrackState.Working, t.State);
            Assert.Near(afterLong + 60_000, t.SessionActiveMs(1, date), 2_000);
        }

        [Test]
        public static void SessionLock_StopsCreditImmediately()
        {
            var c = new FakeClock();
            var p = new Person(c);
            var t = new WorkTracker(P(), c, "s1");
            t.SetContext(Ctx.Task(1));
            t.Sample(p.Signals());
            Work(t, c, p, TimeSpan.FromMinutes(5));
            p.Locked = true;
            Away(t, c, p, TimeSpan.FromMinutes(3));
            Assert.Eq(TrackState.Idle, t.State);
            string date = P().WorkDateOf(c.UtcNow);
            Assert.Near(5 * 60_000, t.SessionActiveMs(1, date), 2_000, "lock does not get the 5-minute grace");
        }

        [Test]
        public static void Sleep_LargeMonotonicGap_NotCounted()
        {
            var c = new FakeClock();
            var p = new Person(c);
            var t = new WorkTracker(P(), c, "s1");
            t.SetContext(Ctx.Task(1));
            t.Sample(p.Signals());
            Work(t, c, p, TimeSpan.FromMinutes(5));
            string date = P().WorkDateOf(c.UtcNow);
            long before = t.SessionActiveMs(1, date);

            c.Advance(TimeSpan.FromHours(2));                  // зөөврийн компьютер унтав
            p.Touch();                                         // сэрээх товч — «шинэ» оролт
            t.Sample(p.Signals());
            Assert.Eq(before, t.SessionActiveMs(1, date), "2 hours of sleep never counted");
            Assert.Eq(1, t.Snapshot().Gaps);
            Work(t, c, p, TimeSpan.FromMinutes(1));
            Assert.Near(before + 60_000, t.SessionActiveMs(1, date), 2_000, "counts again after wake");
        }

        [Test]
        public static void WallClockJump_WithoutMonotonicGap_TreatedAsGap()
        {
            var c = new FakeClock();
            var p = new Person(c);
            var t = new WorkTracker(P(), c, "s1");
            t.SetContext(Ctx.Task(1));
            t.Sample(p.Signals());
            Work(t, c, p, TimeSpan.FromMinutes(1));
            c.UtcNow = c.UtcNow.AddHours(3);                   // хэрэглэгч Windows-ийн цагийг сольсон
            c.MonotonicMs += 2000; p.Touch();
            t.Sample(p.Signals());
            var seg = t.DrainDirty().Single();
            Assert.Near(60_000, seg.ActiveMs, 1, "duration is never derived from the wall clock");
        }

        [Test]
        public static void SuspendResume_GapNotCounted()
        {
            var c = new FakeClock();
            var p = new Person(c);
            var t = new WorkTracker(P(), c, "s1");
            t.SetContext(Ctx.Task(1));
            t.Sample(p.Signals());
            Work(t, c, p, TimeSpan.FromMinutes(2));
            t.Suspend();
            Assert.Eq(TrackState.Suspended, t.State);
            c.Advance(TimeSpan.FromSeconds(40));               // MaxSampleGap-ээс бага ч унтсан
            t.Resume();
            p.Touch();
            t.Sample(p.Signals());
            Work(t, c, p, TimeSpan.FromMinutes(1));
            string date = P().WorkDateOf(c.UtcNow);
            Assert.Near(3 * 60_000, t.SessionActiveMs(1, date), 2_000);
        }

        [Test]
        public static void Logout_StopsCounting()
        {
            var c = new FakeClock();
            var p = new Person(c);
            var t = new WorkTracker(P(), c, "s1");
            t.SetContext(Ctx.Task(1));
            t.Sample(p.Signals());
            Work(t, c, p, TimeSpan.FromMinutes(3));
            t.SetContext(null, TrackState.SignedOut);
            Work(t, c, p, TimeSpan.FromMinutes(10));
            Assert.Eq(TrackState.SignedOut, t.State);
            string date = P().WorkDateOf(c.UtcNow);
            Assert.Near(3 * 60_000, t.SessionActiveMs(1, date), 2_000, "nothing after logout");
        }

        [Test]
        public static void Midnight_SplitsIntoTwoWorkDates()
        {
            var c = new FakeClock { UtcNow = new DateTime(2026, 9, 29, 15, 50, 0, DateTimeKind.Utc) }; // 23:50 УБ
            var p = new Person(c);
            var t = new WorkTracker(P(), c, "s1");
            t.SetContext(Ctx.Task(1));
            t.Sample(p.Signals());
            Work(t, c, p, TimeSpan.FromMinutes(20));
            var segs = t.DrainDirty().OrderBy(s => s.WorkDate).ToList();
            Assert.Eq(2, segs.Count);
            Assert.Eq("2026-09-29", segs[0].WorkDate);
            Assert.Eq("2026-09-30", segs[1].WorkDate);
            Assert.Near(10 * 60_000, segs[0].ActiveMs, 2_000);
            Assert.Near(10 * 60_000, segs[1].ActiveMs, 2_000);
        }

        [Test]
        public static void Revisions_IncreaseOnlyWhenChanged()
        {
            var c = new FakeClock();
            var p = new Person(c);
            var t = new WorkTracker(P(), c, "s1");
            t.SetContext(Ctx.Task(1));
            t.Sample(p.Signals());
            Work(t, c, p, TimeSpan.FromSeconds(10));
            var a = t.DrainDirty().Single();
            Assert.Eq(0, t.DrainDirty().Count, "drain clears dirty");
            Work(t, c, p, TimeSpan.FromSeconds(10));
            var b = t.DrainDirty().Single();
            Assert.Eq(a.SegmentId, b.SegmentId);
            Assert.True(b.Rev > a.Rev);
            Assert.True(b.ActiveMs > a.ActiveMs, "cumulative, not delta");
        }

        [Test]
        public static void Presence_ReflectsStateAndTask()
        {
            var c = new FakeClock();
            var p = new Person(c);
            var t = new WorkTracker(P(), c, "s1");
            t.SetContext(Ctx.Task(9, projectId: 4));
            t.Sample(p.Signals());
            Work(t, c, p, TimeSpan.FromSeconds(4));
            PresenceDto pr = t.Presence();
            Assert.Eq("working", pr.State);
            Assert.Eq(9, pr.TaskId ?? 0);
            Assert.Eq(4, pr.ProjectId ?? 0);
            Away(t, c, p, TimeSpan.FromMinutes(6));
            Assert.Eq("idle", t.Presence().State);
            t.SetContext(null, TrackState.NoTask);
            Assert.Eq("no_task", t.Presence().State);
            Assert.Null(t.Presence().TaskId);
        }
    }
}
