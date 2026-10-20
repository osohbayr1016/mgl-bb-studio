using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.ChangeImpact.Core;
using static RevitMcpAddin.Smart.Tests.PreChangeFixtures;

namespace RevitMcpAddin.Smart.Tests
{
    /// <summary>Буцаалтыг ЗОРИУЛАЛТТАЙ хурууны хээгээр батлах (бүх элементийн тоо БИШ) — fail-closed.</summary>
    public static class PreChangeRestoreTests
    {
        private static RestoreProbe Probe()
        {
            var p = new RestoreProbe { WallExists = true, WallLocation = new[] { 0.0, 0, 0, 5000, 0, 0 }, WallTypeId = 7, Stamp = "s1" };
            p.Others[30] = new[] { 1300.0, 0, 0 }; p.OthersPresent.Add(30);
            p.Others[40] = new[] { 0.0, 0, 0, 3000, 0, 0 }; p.OthersPresent.Add(40);
            return p;
        }

        [Test]
        public static void IdenticalProbes_AreRestored()
        {
            RestoreResult r = PreChangeRestoreCheck.Compare(Probe(), Probe());
            Assert.True(r.Restored, string.Join("|", r.Problems));
        }

        [Test]
        public static void WallStillMoved_IsNotRestored()
        {
            RestoreProbe a = Probe(); a.WallLocation = new[] { 300.0, 0, 0, 5300, 0, 0 };
            Assert.False(PreChangeRestoreCheck.Compare(Probe(), a).Restored);
        }

        [Test]
        public static void WallMissing_IsNotRestored()
        {
            RestoreProbe a = Probe(); a.WallExists = false;
            Assert.False(PreChangeRestoreCheck.Compare(Probe(), a).Restored);
        }

        [Test]
        public static void HostedElementStillDisplaced_IsNotRestored()
        {
            RestoreProbe a = Probe(); a.Others[30] = new[] { 1600.0, 0, 0 };
            RestoreResult r = PreChangeRestoreCheck.Compare(Probe(), a);
            Assert.False(r.Restored);
            Assert.True(r.Problems.Any(p => p.Contains("хаалга/цонх")));
        }

        [Test]
        public static void JoinedWallStillChanged_IsNotRestored()
        {
            RestoreProbe a = Probe(); a.Others[40] = new[] { 0.0, 0, 0, 3010, 0, 0 };
            Assert.False(PreChangeRestoreCheck.Compare(Probe(), a).Restored);
        }

        [Test]
        public static void HostedElementGone_IsNotRestored()
        {
            RestoreProbe a = Probe(); a.OthersPresent.Remove(30);
            Assert.False(PreChangeRestoreCheck.Compare(Probe(), a).Restored);
        }

        [Test]
        public static void AddedDuringSimulationButStillPresent_IsNotRestored()
        {
            RestoreProbe a = Probe(); a.AddedStillPresent = 2;
            Assert.False(PreChangeRestoreCheck.Compare(Probe(), a).Restored);
        }

        [Test]
        public static void DeletedDuringSimulationButNotBack_IsNotRestored()
        {
            RestoreProbe a = Probe(); a.DeletedStillMissing = 1;
            Assert.False(PreChangeRestoreCheck.Compare(Probe(), a).Restored);
        }

        [Test]
        public static void OpenTransactionLeft_IsNotRestored()
        {
            RestoreProbe a = Probe(); a.DocumentModifiable = true;
            Assert.False(PreChangeRestoreCheck.Compare(Probe(), a).Restored);
        }

        [Test]
        public static void TypeChanged_IsNotRestored()
        {
            RestoreProbe a = Probe(); a.WallTypeId = 8;
            Assert.False(PreChangeRestoreCheck.Compare(Probe(), a).Restored);
        }

        [Test]
        public static void UnreadableProbe_FailsClosed()
        {
            RestoreProbe bad = Probe(); bad.Readable = false;
            Assert.False(PreChangeRestoreCheck.Compare(bad, Probe()).Restored);
            Assert.False(PreChangeRestoreCheck.Compare(Probe(), bad).Restored);
            Assert.False(PreChangeRestoreCheck.Compare(null, Probe()).Restored);
            Assert.False(PreChangeRestoreCheck.Compare(Probe(), null).Restored);
        }

        [Test]
        public static void StampChange_IsANote_NotAFailure()
        {
            RestoreProbe a = Probe(); a.Stamp = "s2";
            RestoreResult r = PreChangeRestoreCheck.Compare(Probe(), a);
            Assert.True(r.Restored);
            Assert.True(r.Notes.Count == 1);
        }

        [Test]
        public static void StrictElementCount_IsOnlyUsedWhenBothCountsPresent()
        {
            RestoreProbe b = Probe(); b.ElementCount = 100;
            RestoreProbe a = Probe(); a.ElementCount = 101;
            Assert.False(PreChangeRestoreCheck.Compare(b, a).Restored);
            Assert.True(PreChangeRestoreCheck.Compare(Probe(), a).Restored, "default горимд бүх элементийн тоо шалгагдахгүй");
        }

        [Test]
        public static void WithinLengthTolerance_IsRestored()
        {
            RestoreProbe a = Probe(); a.WallLocation = new[] { 0.2, 0, 0, 5000.3, 0, 0 };
            Assert.True(PreChangeRestoreCheck.Compare(Probe(), a).Restored);
        }

        /* ---------- Merge + Clone ---------- */

        [Test]
        public static void Merge_TakesDeepPartsAndHostedClearance_KeepsCore()
        {
            StateSnapshot core = Snap().WithRoom(Room(1, 10)).WithHosted(Door(30, 1300));
            StateSnapshot deep = Snap().WithHosted(Door(30, 1300));
            deep.Hosted[30].ClearanceEvaluated = true; deep.Hosted[30].ClearanceMm = 1200;
            deep.Schedules[5] = SchedSnap(5, true, 1);
            deep.Egress.Configured = true;
            deep.IncompleteReasons.Add("d");
            StateSnapshot m = PreChangeSnapshots.Merge(core, deep);
            Assert.Eq(1, m.Rooms.Count);
            Assert.True(m.Hosted[30].ClearanceEvaluated);
            Assert.Eq(1200.0, m.Hosted[30].ClearanceMm.Value);
            Assert.True(m.Schedules.ContainsKey(5));
            Assert.True(m.Egress.Configured);
            Assert.Contains(m.IncompleteReasons, "d");
        }

        [Test]
        public static void Merge_DoesNotMutateEitherInput_SoProvisionalReportKeepsItsSnapshot()
        {
            StateSnapshot core = Snap().WithRoom(Room(1, 10)).WithHosted(Door(30, 1300));
            StateSnapshot deep = Snap().WithHosted(Door(30, 1300));
            deep.Hosted[30].ClearanceEvaluated = true; deep.Hosted[30].ClearanceMm = 1200;
            deep.Schedules[5] = SchedSnap(5, true, 1);
            StateSnapshot m = PreChangeSnapshots.Merge(core, deep);
            Assert.False(ReferenceEquals(m, core));
            Assert.False(core.Hosted[30].ClearanceEvaluated, "core-ийн HostedSnap мутаци хийгдээгүй");
            Assert.False(core.Schedules.ContainsKey(5), "core-д хүснэгт орсонгүй");
            Assert.True(m.Hosted[30].ClearanceEvaluated);
        }

        [Test]
        public static void SettledDifferences_DetectsWallOrHostedMismatchBetweenPasses()
        {
            var a = new RestoreProbe { Readable = true, WallLocation = new[] { 300.0, 0, 0, 5300, 0, 0 } };
            a.Others[30] = new[] { 1600.0, 0, 0 };
            var b = new RestoreProbe { Readable = true, WallLocation = new[] { 300.0, 0, 0, 5300, 0, 0 } };
            b.Others[30] = new[] { 1600.0, 0, 0 };
            Assert.Eq(0, PreChangeRestoreCheck.SettledDifferences(a, b).Count);
            b.Others[30] = new[] { 1700.0, 0, 0 };
            Assert.Eq(1, PreChangeRestoreCheck.SettledDifferences(a, b).Count);
            b.Others[30] = new[] { 1600.0, 0, 0 }; b.WallLocation = new[] { 300.0, 0, 0, 5400, 0, 0 };
            Assert.Eq(1, PreChangeRestoreCheck.SettledDifferences(a, b).Count);
            Assert.Eq(1, PreChangeRestoreCheck.SettledDifferences(null, b).Count);
        }

        [Test]
        public static void Merge_NotCapturedIfEitherNotCaptured()
        {
            StateSnapshot deep = Snap(); deep.Captured = false;
            Assert.False(PreChangeSnapshots.Merge(Snap(), deep).Captured);
        }

        [Test]
        public static void Merge_NullSides_ReturnOther()
        {
            StateSnapshot s = Snap();
            Assert.True(ReferenceEquals(s, PreChangeSnapshots.Merge(s, null)));
            Assert.True(ReferenceEquals(s, PreChangeSnapshots.Merge(null, s)));
        }

        [Test]
        public static void DependenciesClone_DoesNotShareLists_SoCachedCopyIsNeverMutated()
        {
            PreChangeDependencies d = Deps(); d.Views.Add(View(1)); d.DimensionIds.Add(5);
            PreChangeDependencies c = d.Clone();
            c.Views.Add(View(2)); c.DimensionIds.Add(6); c.IncompleteReasons.Add("x");
            Assert.Eq(1, d.Views.Count);
            Assert.Eq(1, d.DimensionIds.Count);
            Assert.Eq(0, d.IncompleteReasons.Count);
            Assert.True(c.VisibilityChecked);
        }
    }
}
