using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    /// <summary>2026-10-06-ны дайсагнасан аудитын олдвор бүрийн давталт (засварын өмнө унадаг байсныг аудиторын probe-оор баталсан).</summary>
    public static class AuditTests
    {
        private static double Mm(double ft) { return Math.Round(ft * WeFixedUnits.MmPerFoot, 1); }

        [Test]
        public static void Anchor_switch_keeps_the_existing_view_instead_of_duplicating()
        {
            // s1 3050 > s2 2950 → зангуу s1; хоорондын заагийг 100 мм зөөхөд s2 урт болно.
            WeRequest before = Poly.Room(Poly.P(0, 0, 3050, 0, 6000, 0, 6000, 4000, 0, 4000), new[] { "s1", "s2", "e", "n", "w" });
            WePlan old = Poly.Plan(before);
            Assert.Eq("wall-s1", old.Items.Single(i => i.WallUids.Count == 2).WallUid);

            WeRequest after = Poly.Room(Poly.P(0, 0, 2950, 0, 6000, 0, 6000, 4000, 0, 4000), new[] { "s1", "s2", "e", "n", "w" });
            after.Existing = Fx.AsExisting(old);
            WePlan now = Poly.Plan(after);
            WePlannedElevation south = now.Items.Single(i => i.WallUids.Count == 2);
            Assert.Eq("wall-s1", south.WallUid, "хуучин дэлгээсийн хана зангуу хэвээр");
            Assert.Eq("wall-s1", south.WallUids[0], "зангуу эхэнд");
            Assert.Eq(0, now.Items.Count(i => i.Action == WeAction.Create), "шинэ (давхар) дэлгээс үүсэхгүй");
            Assert.Eq(0, now.Orphans.Count, "өнчин алга");
        }

        [Test]
        public static void Half_room_depth_ignores_a_tiny_offset_in_the_merged_line()
        {
            // s2 нь s1-ээс 3 мм өрөө рүү (5 мм хүлцэлд — нэг тал).  Өмнө нь цацраг s2-ыг мөргөж гүн 3 мм → зүсэх хавтгай 100 мм.
            WeRequest req = Poly.Room(Poly.P(0, 0, 3000, 0, 3000, 3, 6000, 3, 6000, 4000, 0, 4000), new[] { "s1", "s2", "s2", "e", "n", "w" });
            WePlannedElevation south = Poly.Plan(req).Items.Single(i => i.WallUids.Contains("wall-s1"));
            Assert.Eq(2, south.WallUids.Count, "нэг тал");
            Assert.True(-Mm(south.Box.Near) > 1900, "зүсэх хавтгай өрөөний дунд орчим (" + Mm(south.Box.Near) + " мм)");
        }

        [Test]
        public static void A_problem_member_wall_does_not_block_the_merged_side()
        {
            WeRequest req = Poly.Room(Poly.P(0, 0, 5500, 0, 6000, 0, 6000, 4000, 0, 4000), new[] { "s1", "s2", "e", "n", "w" });
            req.WallLookup["wall-s2"].IsSlanted = true;
            WePlannedElevation south = Poly.Plan(req).Items.Single(i => i.WallUids.Count == 2);
            Assert.Eq("wall-s1", south.WallUid);
            Assert.Eq(WeStatus.Warning, south.Status, south.Message);
            Assert.Eq(WeAction.Create, south.Action);

            // Хамгийн урт нь асуудалтай бол асуудалгүй нь зангуу болно.
            WeRequest req2 = Poly.Room(Poly.P(0, 0, 5500, 0, 6000, 0, 6000, 4000, 0, 4000), new[] { "s1", "s2", "e", "n", "w" });
            req2.WallLookup["wall-s1"].IsSlanted = true;
            WePlannedElevation s2 = Poly.Plan(req2).Items.Single(i => i.WallUids.Count == 2);
            Assert.Eq("wall-s2", s2.WallUid, "асуудалгүй хана зангуу");
            Assert.Eq(WeStatus.Warning, s2.Status, s2.Message);
        }

        [Test]
        public static void Curved_gap_segment_is_not_bridged()
        {
            WeRequest req = Poly.Room(Poly.P(0, 0, 2000, 0, 4000, 0, 6000, 0, 6000, 4000, 0, 4000), new[] { "s1", "arc", "s2", "e", "n", "w" });
            req.Rooms[0].Loops[0].Segments[1].IsStraight = false;
            List<WeRoomSide> sides = Poly.Sides(req);
            Assert.False(sides.Any(s => s.Walls.Any(w => w.WallUniqueId == "wall-s1") && s.Walls.Any(w => w.WallUniqueId == "wall-s2")),
                         "муруй завсрыг давж нэгтгэхгүй");
        }

        [Test]
        public static void Merged_side_tags_every_member_wall_over_its_own_span()
        {
            WeRequest req = Poly.Room(Poly.P(0, 0, 3000, 0, 7000, 0, 7000, 4000, 0, 4000), new[] { "s1", "s2", "e", "n", "w" });
            req.Sources.Levels.Add(new WeLevelInfo { Id = 1, Name = "L02", Z = 0 });
            WeWallInfo w1 = req.WallLookup["wall-s1"], w2 = req.WallLookup["wall-s2"];
            req.Sources.Taggables.Add(new WeTaggable { Id = w1.Id, CategoryKey = WeAnno.Walls, WallUid = w1.UniqueId, Min = Fx.P(0, -100, 0), Max = Fx.P(3000, 100, 2800) });
            req.Sources.Taggables.Add(new WeTaggable { Id = w2.Id, CategoryKey = WeAnno.Walls, WallUid = w2.UniqueId, Min = Fx.P(3000, -100, 0), Max = Fx.P(7000, 100, 2800) });
            WePlannedElevation south = Poly.Plan(req, s => s.Annotations = WeAnno.Format(new[] { WeAnno.Cell(WeAnno.Walls, WeAnno.Tag) }))
                                           .Items.Single(i => i.WallUids.Count == 2);
            List<WeTagItem> tags = south.Annotation.Tags.Where(t => t.CategoryKey == WeAnno.Walls).ToList();
            Assert.SeqEq(new[] { w1.Id, w2.Id }.OrderBy(x => x), tags.Select(t => t.ElementId).OrderBy(x => x), "хана бүрт шошго");
            foreach (WeTagItem t in tags)
            {
                double a = south.Frame.ToLocal(t.ElementId == w1.Id ? Fx.P(0, 0) : Fx.P(3000, 0)).X;
                double b = south.Frame.ToLocal(t.ElementId == w1.Id ? Fx.P(3000, 0) : Fx.P(7000, 0)).X;
                Assert.True(t.HeadX >= Math.Min(a, b) - 1e-6 && t.HeadX <= Math.Max(a, b) + 1e-6, "шошго өөрийн хананы дээр (" + t.ElementId + ")");
            }
        }
    }
}
