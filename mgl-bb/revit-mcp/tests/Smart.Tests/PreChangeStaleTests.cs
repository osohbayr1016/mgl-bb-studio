using System;
using RevitMcpAddin.ChangeImpact.Core;
using static RevitMcpAddin.Smart.Tests.PreChangeFixtures;

namespace RevitMcpAddin.Smart.Tests
{
    /// <summary>Preview хуучирсан эсэх (Apply дарах мөчид).  Хуучирсан preview ХЭЗЭЭ Ч чимээгүй хэрэгжихгүй.</summary>
    public static class PreChangeStaleTests
    {
        private static StaleVerdict Eval(PreChangeFingerprint preview, PreChangeFingerprint current, PreChangeRequest intended)
        {
            return PreChangeStale.Evaluate(preview, current, intended);
        }

        private static void AssertStale(StaleVerdict v, StaleReason expected)
        {
            Assert.True(v.IsStale, "хуучирсан байх ёстой");
            Assert.Eq(expected, v.Reason);
            Assert.True(v.Message.Contains(PreChangeText.StalePreview), "мессеж StalePreview-г агуулна");
        }

        [Test]
        public static void Identical_SameIntendedVector_IsNotStale()
        {
            StaleVerdict v = Eval(Fp(), Fp(), Req(300, 1, 0));
            Assert.False(v.IsStale);
            Assert.Eq(StaleReason.None, v.Reason);
            Assert.Null(v.Message);
        }

        [Test]
        public static void NullIntended_SkipsVectorCheck()
        {
            Assert.False(Eval(Fp(), Fp(), null).IsStale);
        }

        [Test]
        public static void NullPreviewFingerprint_IsStale()
        {
            AssertStale(Eval(null, Fp(), Req()), StaleReason.NoFingerprint);
        }

        [Test]
        public static void NullCurrentFingerprint_IsStale()
        {
            AssertStale(Eval(Fp(), null, Req()), StaleReason.NoFingerprint);
        }

        [Test]
        public static void DocumentIdDiffers_IsDocumentChanged()
        {
            PreChangeFingerprint cur = Fp(); cur.DocumentId = "doc-2";
            AssertStale(Eval(Fp(), cur, Req()), StaleReason.DocumentChanged);
        }

        [Test]
        public static void SourceUidChanged_IsSourceMissing()
        {
            PreChangeFingerprint cur = Fp(); cur.SourceUid = "other";
            AssertStale(Eval(Fp(), cur, Req()), StaleReason.SourceMissing);
        }

        [Test]
        public static void SourceIdChanged_IsSourceMissing()
        {
            PreChangeFingerprint cur = Fp(); cur.SourceId = 101;
            AssertStale(Eval(Fp(), cur, Req()), StaleReason.SourceMissing);
        }

        [Test]
        public static void SourceExistsFalse_IsSourceMissing()
        {
            PreChangeFingerprint cur = Fp(); cur.SourceExists = false;
            AssertStale(Eval(Fp(), cur, Req()), StaleReason.SourceMissing);
        }

        [Test]
        public static void LocationMovedBeyondHalfMm_IsSourceMoved()
        {
            PreChangeFingerprint cur = Fp(); cur.Location = new[] { 0.6, 0, 0, 5000, 0, 0 };
            AssertStale(Eval(Fp(), cur, Req()), StaleReason.SourceMoved);
        }

        [Test]
        public static void LocationMovedWithinTolerance_IsNotStale()
        {
            PreChangeFingerprint cur = Fp(); cur.Location = new[] { 0.4, 0, 0, 5000.4, 0, 0 };
            Assert.False(Eval(Fp(), cur, Req()).IsStale);
        }

        [Test]
        public static void LocationLengthMismatchOrOneSideNull_IsSourceMoved()
        {
            PreChangeFingerprint a = Fp(); a.Location = new[] { 0.0, 0, 0 };
            AssertStale(Eval(Fp(), a, Req()), StaleReason.SourceMoved);
            PreChangeFingerprint b = Fp(); b.Location = null;
            AssertStale(Eval(Fp(), b, Req()), StaleReason.SourceMoved);
        }

        [Test]
        public static void BothLocationsNull_IsNotStale()
        {
            PreChangeFingerprint p = Fp(); p.Location = null;
            PreChangeFingerprint c = Fp(); c.Location = null;
            Assert.False(Eval(p, c, Req()).IsStale);
        }

        [Test]
        public static void TypeIdChanged_IsTypeChanged()
        {
            PreChangeFingerprint cur = Fp(); cur.TypeId = 8;
            AssertStale(Eval(Fp(), cur, Req()), StaleReason.TypeChanged);
        }

        [Test]
        public static void IntendedVectorDiffers_IsVectorChanged()
        {
            AssertStale(Eval(Fp(), Fp(), Req(500, 1, 0)), StaleReason.VectorChanged);
            AssertStale(Eval(Fp(), Fp(), Req(300, 0, 1)), StaleReason.VectorChanged);
        }

        [Test]
        public static void PreviewHasNoVector_ButIntendedGiven_IsVectorChanged()
        {
            PreChangeFingerprint p = Fp(); p.VectorMm = null;
            AssertStale(Eval(p, Fp(), Req()), StaleReason.VectorChanged);
        }

        [Test]
        public static void DependencyHashDiffers_IsDependenciesChanged()
        {
            PreChangeFingerprint cur = Fp(); cur.DependencyHash = "dep-2";
            AssertStale(Eval(Fp(), cur, Req()), StaleReason.DependenciesChanged);
        }

        [Test]
        public static void ModelStampDiffers_IsModelChanged()
        {
            PreChangeFingerprint cur = Fp(); cur.ModelStamp = "stamp-2";
            AssertStale(Eval(Fp(), cur, Req()), StaleReason.ModelChanged);
        }

        [Test]
        public static void MostSpecificReasonWins_WhenSeveralFieldsDiffer()
        {
            PreChangeFingerprint cur = Fp();
            cur.ModelStamp = "x"; cur.DependencyHash = "x"; cur.TypeId = 99; cur.SourceExists = false;
            Assert.Eq(StaleReason.SourceMissing, Eval(Fp(), cur, Req(999, 1, 0)).Reason);
            cur.SourceExists = true;
            Assert.Eq(StaleReason.TypeChanged, Eval(Fp(), cur, Req(999, 1, 0)).Reason);
            cur.TypeId = 7;
            Assert.Eq(StaleReason.VectorChanged, Eval(Fp(), cur, Req(999, 1, 0)).Reason);
            Assert.Eq(StaleReason.DependenciesChanged, Eval(Fp(), cur, Req()).Reason);
            cur.DependencyHash = "dep-1";
            Assert.Eq(StaleReason.ModelChanged, Eval(Fp(), cur, Req()).Reason);
        }

        [Test]
        public static void Hash_IsDeterministic_AndSensitiveToParts()
        {
            Assert.Eq(PreChangeStale.Hash("a", "b"), PreChangeStale.Hash("a", "b"));
            Assert.True(PreChangeStale.Hash("a", "b") != PreChangeStale.Hash("a", "c"));
            Assert.NotNull(PreChangeStale.Hash(null));
        }

        [Test]
        public static void LocationKey_QuantizesToTolerance_AndNullIsDash()
        {
            Assert.Eq("-", PreChangeStale.LocationKey(null));
            Assert.Eq(PreChangeStale.LocationKey(new[] { 1000.0, 2000.0 }), PreChangeStale.LocationKey(new[] { 1000.1, 1999.9 }));
            Assert.True(PreChangeStale.LocationKey(new[] { 1000.0 }) != PreChangeStale.LocationKey(new[] { 1002.0 }));
        }
        [Test]
        public static void LinkSignatureChange_IsStale_EvenWhenModelStampIsSame()
        {
            // Линк unload/шинэчлэх нь host-ын DocumentChanged-д ордоггүй — тэмдэг ижил ч preview хуучирна.
            PreChangeFingerprint prev = Fp(); prev.LinkSignature = "L1";
            PreChangeFingerprint cur = Fp(); cur.LinkSignature = "L2";
            AssertStale(Eval(prev, cur, Req()), StaleReason.ModelChanged);
        }

        [Test]
        public static void ConfigSignatureChange_IsStale()
        {
            PreChangeFingerprint prev = Fp(); prev.ConfigSignature = "exits:a";
            PreChangeFingerprint cur = Fp(); cur.ConfigSignature = "exits:b";
            AssertStale(Eval(prev, cur, Req()), StaleReason.ModelChanged);
        }

        [Test]
        public static void NullAndEmptySignatures_AreEqual_NotStale()
        {
            PreChangeFingerprint prev = Fp(); prev.LinkSignature = null; prev.ConfigSignature = null;
            PreChangeFingerprint cur = Fp(); cur.LinkSignature = ""; cur.ConfigSignature = "";
            Assert.False(Eval(prev, cur, Req()).IsStale);
        }

        [Test]
        public static void SameSignatures_NotStale()
        {
            PreChangeFingerprint prev = Fp(); prev.LinkSignature = "L1"; prev.ConfigSignature = "C1";
            PreChangeFingerprint cur = Fp(); cur.LinkSignature = "L1"; cur.ConfigSignature = "C1";
            Assert.False(Eval(prev, cur, Req()).IsStale);
        }

        [Test]
        public static void UnverifiableSignature_OnBothSides_IsNeverTreatedAsEqual()
        {
            // Линкийг уншиж чадаагүй хоёр талд ИЖИЛ тогтмол тэмдэг бичигдсэн ч «хуучраагүй» гэж батлах боломжгүй (fail-closed).
            PreChangeFingerprint prev = Fp(); prev.LinkSignature = PreChangeCacheKey.Unverifiable; prev.ConfigSignature = "C1";
            PreChangeFingerprint cur = Fp(); cur.LinkSignature = PreChangeCacheKey.Unverifiable; cur.ConfigSignature = "C1";
            StaleVerdict v = Eval(prev, cur, Req());
            Assert.True(v.IsStale);
            Assert.Eq(StaleReason.Unverifiable, v.Reason);
            Assert.Eq(PreChangeFreshness.UnknownNotice, v.Message);
        }

        [Test]
        public static void UnverifiableConfig_OnOneSide_IsUnverifiable()
        {
            PreChangeFingerprint prev = Fp(); prev.LinkSignature = "L1"; prev.ConfigSignature = "C1";
            PreChangeFingerprint cur = Fp(); cur.LinkSignature = "L1"; cur.ConfigSignature = PreChangeCacheKey.Unverifiable;
            Assert.Eq(StaleReason.Unverifiable, Eval(prev, cur, Req()).Reason);
        }
    }
}
