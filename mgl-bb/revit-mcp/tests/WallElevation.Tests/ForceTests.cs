using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    /// <summary>
    /// «Үүсэхгүй» гэсэн дэлгээсийг хэрэглэгч чагтлаж ХҮЧЭЭР үүсгэх (2026-10-14, интерьерийн баг): шалгах/дэмжигдэхгүй мөр — хүрээ гарах
    /// боломжтой бол; муруй талыг хөвчөөр.  Алдаа, давхардал хүчлэгдэхгүй.  Бусад мөр хөндөгдөхгүй.
    /// </summary>
    public static class ForceTests
    {
        private static WePlan Plan(WeRequest req, params string[] forced)
        {
            return WallElevationPlanner.Plan(req, Fx.Ctx(s => s.Forced = new HashSet<string>(forced)));
        }

        [Test]
        public static void Curved_side_can_be_forced_and_is_drawn_on_its_chord()
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            req.Rooms[0].Loops[0].Segments[2].IsStraight = false;   // хойд хана муруй
            WePlan before = Plan(req);
            WePlannedElevation c0 = before.Items.Single(i => i.Status == WeStatus.Unsupported);
            Assert.True(c0.CanForce, "муруй тал хүчлэх боломжтой");
            Assert.False(c0.Forced);
            Assert.Null(c0.Frame);
            Assert.Eq(WeAction.Skip, c0.Action);

            WePlan after = Plan(req, c0.Key);
            WePlannedElevation c1 = after.Items.Single(i => i.Key == c0.Key);
            Assert.True(c1.Forced, "хүчилсэн");
            Assert.Eq(WeStatus.Warning, c1.Status);
            Assert.True(c1.Frame != null && c1.Box != null, "хөвчөөр хүрээ гарсан");
            Assert.Eq(WeAction.Create, c1.Action);
            Assert.Eq("B", c1.SideLetter, "үсэг хэвээр");
            Assert.True(c1.Message.StartsWith("Таны сонголтоор"), c1.Message);
            Assert.True(c1.ForcedReason.Contains("Муруй"), c1.ForcedReason);
            // W10: хөвчөөр харсан хавтгай харагдац — «нумын уртаар дэлгэсэн» зураг гэж ХЭЗЭЭ Ч нэрлэхгүй.
            Assert.True(c0.ChordView && c1.ChordView, "муруй тал = хөвчийн харагдац (хүчлэхээс өмнө ч цонхонд сануулна)");
            Assert.True(c1.Message.Contains(WallElevationPlanner.ChordViewNote), c1.Message);
            Assert.True(WallElevationPlanner.ChordViewNote.Contains("дэлгэсэн (unwrapped) зураг БИШ"), "тайлбар нь дэлгэсэн БИШ гэж хэлнэ");
            foreach (string text in new[] { c1.Name, c1.Label, c1.Title })
                Assert.False((text ?? string.Empty).IndexOf("дэлгэсэн", System.StringComparison.OrdinalIgnoreCase) >= 0
                             || (text ?? string.Empty).IndexOf("unwrap", System.StringComparison.OrdinalIgnoreCase) >= 0, "нэр/тэмдэг/гарчигт «дэлгэсэн» үгүй: " + text);
            Assert.False(after.Items.Where(i => i.Key != c0.Key).Any(i => i.ChordView || (i.Message ?? string.Empty).Contains(WallElevationPlanner.ChordViewNote)),
                         "шулуун ханад хөвчийн тайлбар орохгүй");
            Assert.Eq(4, after.Count(WeAction.Create), "бусад гурав + хүчилсэн");
            // Хөвчөөр: гадаргуу хойд ханын шугам, харах чиглэл хойд.
            Assert.Eq("Хойд", WeNaming.CompassName(c1.PlanLook));
            Assert.True(c1.Box.Near < 0 && c1.Box.Far > 0, "гүн хөвчийн хоёр талд");
        }

        [Test]
        public static void Review_side_is_forceable_and_others_do_not_change()
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            req.Rooms[0].Loops[0].Segments[0].InteriorProbe = false;
            WePlan before = Plan(req);
            WePlannedElevation r0 = before.Items.Single(i => i.Status == WeStatus.RequiresReview);
            Assert.True(r0.CanForce && r0.Frame != null, "шалгах мөр хүрээтэй — хүчилж болно");
            Assert.Eq(WeAction.Skip, r0.Action);

            WePlan after = Plan(req, r0.Key);
            WePlannedElevation r1 = after.Items.Single(i => i.Key == r0.Key);
            Assert.True(r1.Forced);
            Assert.Eq(WeAction.Create, r1.Action);
            Assert.False(r1.ChordView || r1.Message.Contains(WallElevationPlanner.ChordViewNote), "шулуун ханын хүчилсэн мөрөнд хөвчийн тайлбар үгүй");
            Assert.True(r1.Annotation != null && r1.Annotation.Rows.Count > 0, "хүчилсэн мөрөнд тэмдэглэгээ төлөвлөгдсөн");
            foreach (WePlannedElevation o in after.Items.Where(i => i.Key != r0.Key))
            {
                WePlannedElevation b = before.Items.Single(i => i.Key == o.Key);
                Assert.Eq(b.Signature, o.Signature, "бусад дэлгээс өөрчлөгдөөгүй " + o.SideLetter);
                Assert.False(o.Forced || o.CanForce);
            }
        }

        [Test]
        public static void Failed_and_duplicated_items_cannot_be_forced()
        {
            // Хилийн хана уншигдаагүй → алдаа: хүчлэхгүй.
            WeRequest req = Fx.SquareRoom(5000, 4000);
            req.Rooms[0].Loops[0].Segments[1].WallUniqueId = "missing-wall";
            WePlan p = Plan(req);
            WePlannedElevation failed = p.Items.Single(i => i.Status == WeStatus.Failed);
            Assert.False(failed.CanForce, "алдаа хүчлэгдэхгүй");
            WePlannedElevation still = Plan(req, failed.Key).Items.Single(i => i.Key == failed.Key);
            Assert.Eq(WeStatus.Failed, still.Status);
            Assert.False(still.Forced);

            // Нэг түлхүүрт хоёр харагдац (давхардал) — хүчлэхэд ч засагдахгүй.
            WeRequest dup = Fx.SquareRoom(5000, 4000);
            WePlan first = Plan(dup);
            List<WeExistingView> ex = Fx.AsExisting(first);
            WeExistingView copy = ex[0];
            ex.Add(new WeExistingView { ViewId = 99999, Key = copy.Key, Signature = copy.Signature, Name = copy.Name + " (2)", WallUid = copy.WallUid, RoomUid = copy.RoomUid,
                                        GeneratorVersion = WeIdentity.GeneratorVersion, SourceWallExists = true, SourceRoomExists = true });
            dup.Existing = ex;
            WePlannedElevation d = Plan(dup, copy.Key).Items.Single(i => i.Key == copy.Key);
            Assert.Eq(WeStatus.RequiresReview, d.Status);
            Assert.False(d.CanForce, "давхардлыг гараар засна");
            Assert.Eq(WeAction.Skip, d.Action);
        }

        [Test]
        public static void Forced_keys_are_not_saved_to_the_settings_file()
        {
            var s = new WeSettings { Forced = new HashSet<string> { "v1|room:x|wall:y|side:curve" } };
            Assert.Eq(0, WeSettings.Deserialize(s.Serialize()).Forced.Count, "өрөө тус бүрийн сонголт — файлд хадгалагдахгүй");
            Assert.Eq(1, s.Clone().Forced.Count, "Clone хуулна");
        }
    }
}
