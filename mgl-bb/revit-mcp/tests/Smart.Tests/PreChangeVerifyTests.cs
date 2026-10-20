using System;
using System.Linq;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.ClashCheck.Core;
using static RevitMcpAddin.Smart.Tests.PreChangeFixtures;

namespace RevitMcpAddin.Smart.Tests
{
    /// <summary>Apply-ийн бодит үр дүн ↔ preview.  Тулгаж чадаагүйг «баталгаажсан» гэж ХЭЗЭЭ Ч хэлэхгүй.</summary>
    public static class PreChangeVerifyTests
    {
        private static StateSnapshot Full()
        {
            StateSnapshot s = Snap().WithRoom(Room(1, 35.33)).WithDim(Dim(10, 4200)).WithHosted(Door(30, 1300));
            s.Clash.Evaluated = true;
            s.WithEgress(Route(1, 10.0));
            return s;
        }

        [Test]
        public static void Identical_Snapshots_Match()
        {
            VerifyResult v = PreChangeVerifier.Compare(Full(), Full());
            Assert.True(v.Matches);
            Assert.Eq(0, v.Differences.Count);
            Assert.False(v.NothingCompared);
            Assert.Contains(v.Compared, "өрөө");
            Assert.Contains(v.Compared, "хэмжээс");
            Assert.Contains(v.Compared, "хаалга/цонх");
            Assert.Contains(v.Compared, "MEP clash");
            Assert.Contains(v.Compared, "гарцын зам");
        }

        [Test]
        public static void RoomArea_BeyondVerifyTolerance_IsDifference()
        {
            StateSnapshot a = Full();
            a.Rooms[1].AreaM2 = 35.33 + PreChangeTolerance.VerifyAreaM2 * 2;
            VerifyResult v = PreChangeVerifier.Compare(Full(), a);
            Assert.False(v.Matches);
            Assert.True(v.Differences.Any(d => d.Contains("талбай")));
        }

        [Test]
        public static void RoomArea_WithinVerifyTolerance_StillMatches()
        {
            StateSnapshot a = Full();
            a.Rooms[1].AreaM2 = 35.33 + PreChangeTolerance.VerifyAreaM2 * 0.5;
            Assert.True(PreChangeVerifier.Compare(Full(), a).Matches);
        }

        [Test]
        public static void RoomEnclosureDiffers_IsDifference()
        {
            StateSnapshot a = Full();
            a.Rooms[1].Enclosed = false;
            Assert.True(PreChangeVerifier.Compare(Full(), a).Differences.Any(d => d.Contains("хаалттай")));
        }

        [Test]
        public static void RoomPresenceDiffers_IsDifference()
        {
            StateSnapshot a = Full();
            a.Rooms.Remove(1);
            VerifyResult v = PreChangeVerifier.Compare(Full(), a);
            Assert.False(v.Matches);
            Assert.True(v.Differences.Any(d => d.Contains("алга боллоо")));
        }

        [Test]
        public static void Dimension_BeyondVerifyTolerance_IsDifference()
        {
            StateSnapshot a = Full();
            a.Dimensions[10].SegmentsMm[0] = 4202;
            VerifyResult v = PreChangeVerifier.Compare(Full(), a);
            Assert.False(v.Matches);
            Assert.True(v.Differences.Any(d => d.Contains("Хэмжээс #10")));
        }

        [Test]
        public static void Dimension_WithinVerifyTolerance_Matches()
        {
            StateSnapshot a = Full();
            a.Dimensions[10].SegmentsMm[0] = 4200.5;
            Assert.True(PreChangeVerifier.Compare(Full(), a).Matches);
        }

        [Test]
        public static void Dimension_SegmentCountDiffers_IsDifference()
        {
            StateSnapshot a = Full();
            a.Dimensions[10].SegmentsMm.Add(100);
            Assert.True(PreChangeVerifier.Compare(Full(), a).Differences.Any(d => d.Contains("сегментийн тоо")));
        }

        [Test]
        public static void Hosted_PositionDiffers_IsDifference()
        {
            StateSnapshot a = Full();
            a.Hosted[30].LocationMm = new[] { 1305.0, 0, 0 };
            Assert.True(PreChangeVerifier.Compare(Full(), a).Differences.Any(d => d.Contains("Хаалга/цонх #30")));
        }

        [Test]
        public static void Clash_SetDiffers_IsDifference()
        {
            StateSnapshot p = Full();
            StateSnapshot a = Full().WithPair(Pair("k1", ClashVerdict.ConfirmedClash));
            VerifyResult v = PreChangeVerifier.Compare(p, a);
            Assert.False(v.Matches);
            Assert.True(v.Differences.Any(d => d.Contains("MEP clash")));
        }

        [Test]
        public static void Clash_SameSetIgnoringNoClashPairs_Matches()
        {
            StateSnapshot p = Full().WithPair(Pair("k1", ClashVerdict.ConfirmedClash)).WithPair(Pair("k2", ClashVerdict.NoClash));
            StateSnapshot a = Full().WithPair(Pair("k1", ClashVerdict.ConfirmedClash));
            Assert.True(PreChangeVerifier.Compare(p, a).Matches);
        }

        [Test]
        public static void Clash_NotEvaluatedEitherSide_IsNotCompared_NotMatchedSilently()
        {
            StateSnapshot a = Full();
            a.Clash.Evaluated = false;
            VerifyResult v = PreChangeVerifier.Compare(Full(), a);
            Assert.Contains(v.NotCompared, "MEP clash");
            Assert.False(v.Compared.Contains("MEP clash"));
        }

        [Test]
        public static void Egress_RouteDiffers_IsDifference_AndPassabilityDiffers()
        {
            StateSnapshot a = Full();
            a.Egress.Routes[1].LengthM = 10.5;
            Assert.True(PreChangeVerifier.Compare(Full(), a).Differences.Any(d => d.Contains("Гарцын зам")));
            StateSnapshot b = Full();
            b.Egress.Routes[1].LengthM = null;
            Assert.True(PreChangeVerifier.Compare(Full(), b).Differences.Any(d => d.Contains("боломжтой эсэх")));
        }

        [Test]
        public static void Egress_NotConfigured_IsNotCompared()
        {
            StateSnapshot p = Full(); p.Egress.Configured = false;
            VerifyResult v = PreChangeVerifier.Compare(p, Full());
            Assert.Contains(v.NotCompared, "гарцын зам");
        }

        [Test]
        public static void Schedules_MembershipDiffers_IsDifference()
        {
            StateSnapshot p = Full(); p.Schedules[50] = SchedSnap(50, true, 1, 2);
            StateSnapshot a = Full(); a.Schedules[50] = SchedSnap(50, true, 1, 3);
            VerifyResult v = PreChangeVerifier.Compare(p, a);
            Assert.False(v.Matches);
            Assert.True(v.Differences.Any(d => d.Contains("Хүснэгт")));
        }

        [Test]
        public static void Schedules_NotEvaluated_IsNotCompared()
        {
            StateSnapshot p = Full(); p.Schedules[50] = SchedSnap(50, false);
            StateSnapshot a = Full(); a.Schedules[50] = SchedSnap(50, true, 1);
            Assert.Contains(PreChangeVerifier.Compare(p, a).NotCompared, "хүснэгт");
        }

        [Test]
        public static void Joined_ChangedShape_IsDifference()
        {
            StateSnapshot p = Full(); p.Joined[40] = new ElementPlace { Id = 40, Location = new[] { 0.0, 0, 0, 3000, 0, 0 } };
            StateSnapshot a = Full(); a.Joined[40] = new ElementPlace { Id = 40, Location = new[] { 0.0, 0, 0, 3010, 0, 0 } };
            Assert.True(PreChangeVerifier.Compare(p, a).Differences.Any(d => d.Contains("Холбогдсон хана")));
        }

        [Test]
        public static void Joined_MissingInTheActualState_IsDifference_NotSilentlySkipped()
        {
            StateSnapshot p = Full(); p.Joined[40] = new ElementPlace { Id = 40, Location = new[] { 0.0, 0, 0, 3000, 0, 0 } };
            StateSnapshot a = Full();       // холбогдсон хана бодит settled төлөвт алга
            VerifyResult v = PreChangeVerifier.Compare(p, a);
            Assert.False(v.Matches);
            Assert.True(v.Differences.Any(d => d.Contains("Холбогдсон хана #40") && d.Contains("олдсонгүй")));
        }

        [Test]
        public static void NothingComparable_IsNothingCompared_AndNeverMatches()
        {
            StateSnapshot p = Snap(), a = Snap();
            p.Clash.Evaluated = false; a.Clash.Evaluated = false;             // Captured, гэхдээ тулгах зүйл алга
            VerifyResult v = PreChangeVerifier.Compare(p, a);
            Assert.True(v.NothingCompared);
            Assert.False(v.Matches, "ЮУ Ч тулгаагүй бол «баталгаажсан» гэж хэлж болохгүй");
            Assert.Eq(0, v.Differences.Count);
            Assert.True(v.NotCompared.Count > 0);
        }

        [Test]
        public static void SnapshotNotCaptured_NotComparedContainsEverything()
        {
            StateSnapshot bad = Full(); bad.Captured = false;
            foreach (VerifyResult v in new[] { PreChangeVerifier.Compare(bad, Full()), PreChangeVerifier.Compare(Full(), bad) })
            {
                Assert.False(v.Matches);
                Assert.True(v.NothingCompared);
                Assert.Eq(1, v.NotCompared.Count);
                Assert.True(v.NotCompared[0].StartsWith("бүгд"));
            }
        }

        [Test]
        public static void NullSnapshots_NeverMatch()
        {
            Assert.False(PreChangeVerifier.Compare(null, Full()).Matches);
            Assert.False(PreChangeVerifier.Compare(Full(), null).Matches);
            Assert.False(PreChangeVerifier.Compare(null, null).Matches);
        }

        [Test]
        public static void UnreadableRoomsAndDimensions_AreSkipped_NotReportedAsDifferences()
        {
            StateSnapshot a = Full();
            a.Rooms[1].Readable = false;
            a.Dimensions[10].Readable = false;
            Assert.Eq(0, PreChangeVerifier.Compare(Full(), a).Differences.Count);
        }

        [Test]
        public static void ApplyOutcome_Moved_OnlyWhenApplied()
        {
            Assert.True(new ApplyOutcome { Status = ApplyStatus.AppliedVerified }.Moved);
            Assert.True(new ApplyOutcome { Status = ApplyStatus.AppliedUnverified }.Moved);
            foreach (ApplyStatus s in new[] { ApplyStatus.Stale, ApplyStatus.RolledBackMismatch, ApplyStatus.Failed, ApplyStatus.Cancelled, ApplyStatus.Unknown })
                Assert.False(new ApplyOutcome { Status = s }.Moved, s.ToString());
        }
    }
}
