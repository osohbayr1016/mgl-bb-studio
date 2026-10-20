using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    /// <summary>Хэрэглэгчийн тохируулсан дэлгээсийн байрлал (2026-10-14).</summary>
    public static class OverrideTests
    {
        private static double Mm(double ft) { return Math.Round(ft * WeFixedUnits.MmPerFoot, 1); }

        [Test]
        public static void Override_round_trips_and_rejects_garbage()
        {
            WeSideOverride o = WeSideOverride.Line(Fx.P(1000, 500), Fx.P(4000, 500), new WeV3(0, -1, 0));
            WeSideOverride back = WeSideOverride.Parse(o.Serialize());
            Assert.True(back != null && (back.A - o.A).Length < 1e-9 && (back.B - o.B).Length < 1e-9 && (back.Look - o.Look).Length < 1e-9);
            Assert.True(WeSideOverride.Parse("reset").Reset);
            Assert.True(WeSideOverride.Parse("v1;1;2;3") == null);
            Assert.True(WeSideOverride.Parse("v1;0;0;1;0;1;0") == null, "харах чиглэл шугамтай перпендикуляр биш — хүчингүй");
            WeSideOverride r = o.Rotated90();
            Assert.True(((r.A + r.B) * 0.5 - (o.A + o.B) * 0.5).Length < 1e-9, "эргүүлэхэд төв хэвээр");
            Assert.True(Math.Abs(r.Look.Dot(o.Look)) < 1e-9);
        }

        [Test]
        public static void Moved_cut_line_looks_from_the_new_place_and_keeps_the_letters()
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            WePlan basePlan = WallElevationPlanner.Plan(req, Fx.Ctx());
            WePlannedElevation south = basePlan.Items.Single(i => i.Frame != null && i.Frame.Look.AlmostEquals(new WeV3(0, -1, 0), 1e-6));
            string letters = string.Join(",", basePlan.Items.Select(i => i.Key + "=" + i.SideLetter));

            // Урд хананаас 1500 мм өрөө рүү, баруун 3000 мм-ийг л (1000…4000).
            WeSideOverride ov = WeSideOverride.Line(Fx.P(1000, 1500), Fx.P(4000, 1500), new WeV3(0, -1, 0));
            WePlan p = WallElevationPlanner.Plan(req, Fx.Ctx(s => s.Overrides[south.Key] = ov));
            WePlannedElevation it = p.Items.Single(i => i.Key == south.Key);
            Assert.True(it.Override != null, "тохируулга хэрэглэгдсэн");
            Assert.Eq(1500.0, Mm(it.Frame.Origin.Y), "шинэ шугам дээр");
            Assert.Eq(2500.0, Mm(it.Frame.Origin.X));
            Assert.True(it.FaceLength > Fx.Mm(2999) && it.FaceLength < Fx.Mm(3001), "урт 3000: " + Mm(it.FaceLength));
            Assert.True(it.Box.Far >= Fx.Mm(1500), "ар тал урд хана хүртэл: far " + Mm(it.Box.Far));
            Assert.False(it.Signature == south.Signature, "тэмдэг өөрчлөгдсөн (харагдац шинэчлэгдэнэ)");
            Assert.Eq(letters, string.Join(",", p.Items.Select(i => i.Key + "=" + i.SideLetter)), "үсэг солигдохгүй");
            Assert.True((it.OrigA - south.PlanA).Length < 1e-6 || (it.OrigA - south.PlanB).Length < 1e-6, "анхны гадаргуу хадгалагдсан");
        }

        [Test]
        public static void Stored_override_is_used_on_rerun_and_reset_clears_it()
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            WePlan first = WallElevationPlanner.Plan(req, Fx.Ctx());
            WePlannedElevation south = first.Items.Single(i => i.Frame != null && i.Frame.Look.AlmostEquals(new WeV3(0, -1, 0), 1e-6));
            WeSideOverride ov = WeSideOverride.Line(Fx.P(1000, 1500), Fx.P(4000, 1500), new WeV3(0, -1, 0));
            WePlan custom = WallElevationPlanner.Plan(req, Fx.Ctx(s => s.Overrides[south.Key] = ov));
            req.Existing = Fx.AsExisting(custom);
            foreach (WeExistingView e in req.Existing) if (e.Key == south.Key) e.Override = ov.Serialize();

            WePlannedElevation again = WallElevationPlanner.Plan(req, Fx.Ctx()).Items.Single(i => i.Key == south.Key);
            Assert.True(again.Override != null, "хадгалсан тохируулга дахин ажиллуулахад хэрэглэгдэнэ");
            Assert.Eq(WeAction.Keep, again.Action, "өөрчлөлтгүй — харагдацад хүрэхгүй");

            WePlannedElevation reset = WallElevationPlanner.Plan(req, Fx.Ctx(s => s.Overrides[south.Key] = new WeSideOverride { Reset = true }))
                                                          .Items.Single(i => i.Key == south.Key);
            Assert.True(reset.Override == null && reset.ClearStoredOverride, "анхны байрлал руу — хадгалсныг арилгана");
            Assert.Eq(WeAction.Update, reset.Action);
        }

        [Test]
        public static void Room_outline_is_exported_for_the_plan_editor()
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            WePlan p = WallElevationPlanner.Plan(req, Fx.Ctx());
            List<List<WeV3>> loops;
            Assert.True(p.Outlines.TryGetValue(p.Items[0].GroupKey, out loops) && loops.Count == 1 && loops[0].Count == 4);
        }
    }
}
