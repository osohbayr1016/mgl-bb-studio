using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.ChangeImpact.Core;

namespace RevitMcpAddin.Smart.Tests
{
    /// <summary>«Revit-д шууд зөөсөн» зөөлтийг таних, 🔴 үед өөрийн шийдвэрээр зөвшөөрөх, мэргэжлийн ахлагч / төслийн баг — цэвэр дүрэм.</summary>
    public static class SimNativeMoveTests
    {
        private static Dictionary<long, double[]> D(params KeyValuePair<long, double[]>[] kv) { return kv.ToDictionary(k => k.Key, k => k.Value); }
        private static KeyValuePair<long, double[]> P(long id, params double[] v) { return new KeyValuePair<long, double[]>(id, v); }

        [Test]
        public static void PointAndLine_TranslatedTogether_IsOneMove()
        {
            var before = D(P(1, 0, 0, 0), P(2, 0, 0, 0, 5000, 0, 0));
            var after = D(P(1, 1500, 0, 0), P(2, 1500, 0, 0, 6500, 0, 0));
            SimVec d; List<long> moved;
            Assert.True(SimNativeMove.TryTranslation(before, after, out d, out moved));
            Assert.Near(1500, d.X, 1e-9);
            Assert.SeqEq(new long[] { 1, 2 }, moved.OrderBy(x => x));
        }

        [Test]
        public static void StretchedWall_Rotation_OrUnequalMoves_AreNotAMove()
        {
            SimVec d; List<long> m;
            Assert.False(SimNativeMove.TryTranslation(D(P(2, 0, 0, 0, 5000, 0, 0)), D(P(2, 0, 0, 0, 6000, 0, 0)), out d, out m), "үзүүр чирсэн (сунгасан) хана");
            Assert.False(SimNativeMove.TryTranslation(D(P(1, 0, 0, 0), P(2, 0, 0, 0)), D(P(1, 100, 0, 0), P(2, 300, 0, 0)), out d, out m), "өөр өөр хэмжээгээр");
            Assert.False(SimNativeMove.TryTranslation(D(P(1, 0, 0, 0)), D(P(1, 0.4, 0, 0)), out d, out m), "1 мм-ээс бага");
            Assert.False(SimNativeMove.TryTranslation(D(P(1, 0, 0, 0)), D(P(1, 0, 0, 0, 1, 1, 1)), out d, out m), "хэлбэр зөрсөн");
            Assert.False(SimNativeMove.TryTranslation(null, D(P(1, 0, 0, 0)), out d, out m));
        }

        /// <summary>Revit 2027-д хэмжсэн бодит тохиолдол: ханыг Y +800 зөөхөд холбоотой нэг үзүүр нь X дагуу 105 мм тайрагдсан.</summary>
        [Test]
        public static void WallMovedAcross_WithJoinTrimmedEnd_IsStillAMove()
        {
            var before = D(P(7, 12268.2, 12725.4, -5334, 18860.3, 12725.4, -5334));
            var after = D(P(7, 12268.2, 13525.4, -5334, 18755.0, 13525.4, -5334));
            SimVec d; List<long> moved;
            Assert.True(SimNativeMove.TryTranslation(before, after, out d, out moved));
            Assert.Near(0, d.X, 1e-6, "урт дагуу — тайрагдаагүй үзүүрийнх");
            Assert.Near(800, d.Y, 1e-6);
            // Эргүүлсэн (хөндлөн хэсэг өөр) = зөөлт биш.
            Assert.False(SimNativeMove.TryTranslation(D(P(7, 0, 0, 0, 1000, 0, 0)), D(P(7, 0, 0, 0, 1000, 300, 0)), out d, out moved));
        }

        [Test]
        public static void UntouchedSelectedElement_IsIgnored_NotAFailure()
        {
            SimVec d; List<long> moved;
            Assert.True(SimNativeMove.TryTranslation(D(P(1, 0, 0, 0), P(2, 10, 10, 0)), D(P(1, 0, 300, 0), P(2, 10, 10, 0)), out d, out moved));
            Assert.SeqEq(new long[] { 1 }, moved);
            Assert.Near(300, d.Y, 1e-9);
        }

        [Test]
        public static void TooManyElements_IsNotChecked()
        {
            var b = new Dictionary<long, double[]>(); var a = new Dictionary<long, double[]>();
            for (int i = 0; i <= SimNativeMove.MaxElements; i++) { b[i] = new double[] { 0, 0, 0 }; a[i] = new double[] { 100, 0, 0 }; }
            SimVec d; List<long> m;
            Assert.False(SimNativeMove.TryTranslation(b, a, out d, out m));
        }

        private static SimExactResult Final(SimVec off)
        {
            return new SimExactResult { OffsetMm = new[] { off.X, off.Y, off.Z }, Outcome = SandboxOutcome.Simulated, ClashesEvaluated = true, ClashesComplete = true, RoomsEvaluated = true };
        }

        [Test]
        public static void WorthShowing_OnlyWhenSomeoneIsAffected()
        {
            var off = new SimVec(500, 0, 0);
            var scene = new SimScene { MovingName = "Багана", PrimaryId = 1 };
            SimExactResult quiet = Final(off);
            Assert.False(SimNativeMove.WorthShowing(SimNarrative.Build(scene, off, new SimConflictResult(), quiet, SimPhase.Idle)), "юу ч хөндөөгүй — цонх гаргахгүй");
            SimExactResult e = Final(off);
            e.Affected.Add(new SimAffected { Id = 9, Label = "Дам нуруу #9", Kind = SimKind.Framing });
            Assert.True(SimNativeMove.WorthShowing(SimNarrative.Build(scene, off, new SimConflictResult(), e, SimPhase.Idle)), "дагаж өөрчлөгдөх дам нуруу — цонх");
            Assert.False(SimNativeMove.WorthShowing(null));
            Assert.True(SimNativeMove.Headline("Багана", off).StartsWith("Та «Багана»-г Revit-д X +500 мм зөөлөө"), SimNativeMove.Headline("Багана", off));
        }

        /// <summary>Revit «modified» гэж тэмдэглэсэн ч байрлал нь хөдлөөгүй (зөвхөн нэгдэл шинэчлэгдсэн) бие — мэдээлэл, хэнд ч мэдэгдэхгүй.</summary>
        [Test]
        public static void AffectedWithUnchangedLocation_IsInformation_MovedIsReview_UnknownIsReviewWithHonestWording()
        {
            var off = new SimVec(800, 0, 0);
            var scene = new SimScene { MovingName = "Хана", PrimaryId = 1 };
            SimExactResult e = Final(off);
            e.Affected.Add(new SimAffected { Id = 1, Label = "Багана #1", Kind = SimKind.Column, LocationChanged = false });
            e.Affected.Add(new SimAffected { Id = 2, Label = "Дам нуруу #2", Kind = SimKind.Framing, LocationChanged = true });
            e.Affected.Add(new SimAffected { Id = 3, Label = "Хана #3", Kind = SimKind.Wall });
            SimReport r = SimNarrative.Build(scene, off, new SimConflictResult(), e, SimPhase.Idle);
            SimLine col = r.Lines.First(l => l.Keys.Contains("h:1"));
            Assert.Eq(SimSeverity.Info, col.Severity);
            Assert.True(col.Text.Contains("байрлал хэвээр"), col.Text);
            Assert.Eq(SimSeverity.Review, r.Lines.First(l => l.Keys.Contains("h:2")).Severity);
            SimLine wall = r.Lines.First(l => l.Keys.Contains("h:3"));
            Assert.Eq(SimSeverity.Review, wall.Severity);
            Assert.True(wall.Text.Contains("шалгана уу"), wall.Text);
            Assert.False(r.HighlightKeys.Contains("h:2") || r.HighlightKeys.Contains("h:3"), "дагаж өөрчлөгдөх нь УЛААН (мөргөлдөөн) биш");
        }

        [Test]
        public static void RedVerdict_CanBeForced_OnlyWhenRevitAcceptedTheMove()
        {
            var off = new SimVec(500, 0, 0);
            var scene = new SimScene { MovingName = "Хана", PrimaryId = 1 };
            SimExactResult e = Final(off);
            e.Rooms.Add(new SimRoomChange { Id = 5, Name = "101", BeforeM2 = 20, Deleted = true });
            SimReport r = SimNarrative.Build(scene, off, new SimConflictResult(), e, SimPhase.Idle);
            Assert.Eq(MoveVerdict.DoNotMove, r.Verdict);
            Assert.False(r.CanApply);
            Assert.True(r.CanForce, "Revit зөвшөөрсөн 🔴 — шалтгаантайгаар зөвшөөрч болно");
            SimExactResult refused = Final(off);
            refused.Outcome = SandboxOutcome.Blocked;
            refused.BlockReasons.Add("Revit зөвшөөрөхгүй");
            SimReport rr = SimNarrative.Build(scene, off, new SimConflictResult(), refused, SimPhase.Idle);
            Assert.False(rr.CanForce, "Revit өөрөө татгалзсан — хэзээ ч");
            Assert.False(rr.CanApply);
        }

        [Test]
        public static void NativeGhost_HasOldNewBoxesArrowAndHits()
        {
            var moved = new SimBox { MinX = 0, MinY = 0, MinZ = 0, MaxX = 400, MaxY = 400, MaxZ = 3000 };
            GhostScene g = SimGhostScene.ForNativeMove(moved, new SimVec(1500, 0, 0), new double[] { 1000, 0, 0 }, MoveVerdict.MoveWithReview,
                new List<double[]> { new double[] { 0, 0, 2800, 400, 400, 3000 } }, 1.0);
            Assert.SeqEq(new[] { "sim.new", "sim.old", "sim.arrow", "sim.hits" }, g.Layers.Select(l => l.Name));
            GhostLayer old = g.Layers[1];
            Assert.Near(-500, old.Xyz[0], 1e-9, "хуучин хүрээ = одоогийнх − шилжилт (+origin)");
            Assert.True(SimGhostScene.ForNativeMove(SimBox.Empty(), new SimVec(1, 0, 0), new double[3], MoveVerdict.MoveOk, null, 1).IsEmpty);
        }
    }
}
