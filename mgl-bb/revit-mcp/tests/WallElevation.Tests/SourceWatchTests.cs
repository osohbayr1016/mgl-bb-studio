using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    /// <summary>
    /// W01 (2026-10-16): арын ажил явж байх үед эх өрөө/хана/шал/тааз/link өөрчлөгдвөл хуучирсан геометрээр ДУУСГАХГҮЙ — шалтгааныг хэлж
    /// дахин төлөвлөнө; тасралтгүй засварт түр зогсооно.  Дундаас зогссон ажлын тэмдэглэгээгүй харагдацыг дараагийн ажиллуулалт танина.
    /// </summary>
    public static class SourceWatchTests
    {
        private static WeRequest RoomWithSources()
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            req.Sources.Slabs.Add(new WeSlabInfo { Id = 700, Kind = WeSlabKind.Ceiling, Min = Fx.P(0, 0, 2700), Max = Fx.P(5000, 4000, 2720) });
            req.Sources.Inserts.Add(new WeInsertInfo { Id = 710, Kind = WeInsertKind.Door, HostWallUid = req.Rooms[0].Loops[0].Segments[0].WallUniqueId });
            req.Sources.Levels.Add(new WeLevelInfo { Id = 720, Name = "L01", Z = 0 });
            req.Sources.Taggables.Add(new WeTaggable { Id = 730, CategoryKey = "furniture", Min = Fx.P(1000, 1000), Max = Fx.P(1600, 1600, 750) });
            return req;
        }

        private static WeAddedElement Added(long id, double x0, double y0, double z0, double x1, double y1, double z1, string cat = "Furniture")
        {
            return new WeAddedElement { Id = id, Category = cat, HasBox = true, Min = Fx.P(x0, y0, z0), Max = Fx.P(x1, y1, z1) };
        }

        [Test]
        public static void Watch_lists_the_job_sources_with_readable_labels()
        {
            WeRequest req = RoomWithSources();
            WeSourceWatch w = WeSourceWatch.From(req, Fx.Units);
            Assert.Eq("өрөө «101 Office»", w.Ids[500]);
            foreach (WeWallInfo wall in req.WallLookup.Values)
                Assert.True(w.Ids.ContainsKey(wall.Id) && w.Ids[wall.Id].StartsWith("хана"), "хилийн хана " + wall.Id);
            Assert.True(w.Ids[700].StartsWith("тааз"), w.Ids[700]);
            Assert.True(w.Ids[710].StartsWith("хаалга"), w.Ids[710]);
            Assert.Eq("түвшин «L01»", w.Ids[720]);
            Assert.True(w.Ids[730].StartsWith("Тавилга"), w.Ids[730]);
            Assert.False(w.UsesLinks);
            Assert.Eq(1, w.Boxes.Count, "өрөөний хайрцаг");
        }

        [Test]
        public static void Only_changes_to_the_job_sources_make_the_plan_stale()
        {
            WeRequest req = RoomWithSources();
            WeSourceWatch w = WeSourceWatch.From(req, Fx.Units);
            long wallId = req.WallLookup.Values.First().Id;
            Assert.Null(w.Why(new List<long> { 12345, 99999 }, new List<long>(), new List<WeAddedElement>()), "өөр газрын загварчлал хөндөхгүй");
            Assert.Null(w.Why(null, null, null));
            Assert.Eq("өрөө «101 Office» өөрчлөгдсөн", w.Why(new List<long> { 12345, 500 }, null, null));
            string why = w.Why(new List<long> { 500 }, new List<long> { wallId }, null);
            Assert.True(why.StartsWith("хана") && why.EndsWith("устгагдсан"), "устгасныг түрүүлж хэлнэ: " + why);
            Assert.True(w.Why(new List<long> { 700 }, null, null).StartsWith("тааз"), "тааз өөрчлөгдсөн");
        }

        [Test]
        public static void A_new_model_element_inside_the_room_is_stale_one_elsewhere_is_not()
        {
            WeSourceWatch w = WeSourceWatch.From(RoomWithSources(), Fx.Units);
            string inside = w.Why(null, null, new List<WeAddedElement> { Added(900, 2000, 1500, 0, 2600, 2100, 900) });
            Assert.True(inside != null && inside.Contains("Furniture") && inside.Contains("900"), inside ?? "null");
            Assert.Null(w.Why(null, null, new List<WeAddedElement> { Added(901, 9000, 9000, 0, 9500, 9500, 900) }), "өөр өрөө");
            Assert.Null(w.Why(null, null, new List<WeAddedElement> { Added(902, 1000, 1000, 9000, 1500, 1500, 9900) }), "дээд давхар");
            Assert.True(w.Why(null, null, new List<WeAddedElement> { Added(903, 5200, 1000, 0, 5600, 1500, 900, "Walls") }) != null,
                        "хилийн гадна талын 300 мм дотор (хана) — өрөөний хил өөрчлөгдөж болно");
            Assert.Null(w.Why(null, null, new List<WeAddedElement> { new WeAddedElement { Id = 904, Category = "Furniture", HasBox = false } }), "хайрцаггүй");
        }

        [Test]
        public static void A_bulk_paste_is_treated_as_stale_without_checking_each_element()
        {
            WeSourceWatch w = WeSourceWatch.From(RoomWithSources(), Fx.Units);
            var many = new List<WeAddedElement>();
            for (int i = 0; i <= WeSourceWatch.MaxAddedChecked; i++) many.Add(Added(10000 + i, 90000, 90000, 0, 90100, 90100, 100));
            string why = w.Why(null, null, many);
            Assert.True(why != null && why.Contains("нэг дор"), why ?? "null");
        }

        [Test]
        public static void A_linked_room_is_watched_through_the_link_instance_not_a_foreign_id()
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            req.Rooms[0].UniqueId = "link|inst-1|room-1";
            req.Rooms[0].Id = 0;
            WeSourceWatch w = WeSourceWatch.From(req, Fx.Units);
            Assert.True(w.UsesLinks, "link-ийн өрөө");
            Assert.False(w.Ids.ContainsKey(0), "link-ийн элемент host-д id-гүй");
            w.LinkIds.Add(42);
            string why = w.Why(new List<long> { 42 }, null, null);
            Assert.True(why != null && why.Contains("link"), why ?? "null");
            Assert.True(w.Why(null, new List<long> { 42 }, null).Contains("буулгагдсан"));
        }

        [Test]
        public static void Replanning_pauses_after_five_automatic_replans_in_a_minute()
        {
            var now = new DateTime(2026, 10, 16, 10, 0, 0);
            var times = new List<DateTime> { now.AddSeconds(-50), now.AddSeconds(-40), now.AddSeconds(-30), now.AddSeconds(-20) };
            Assert.False(WeReplan.ShouldPause(times, now), "4 удаа — үргэлжилнэ");
            times.Add(now.AddSeconds(-1));
            Assert.True(WeReplan.ShouldPause(times, now), "5 удаа минутад — түр зогсооно");
            times.Insert(0, now.AddSeconds(-300));
            WeReplan.Prune(times, now);
            Assert.Eq(5, times.Count, "хуучин тэмдэглэл хасагдана");
            Assert.False(WeReplan.ShouldPause(times, now.AddSeconds(55)), "цонх шилжсэн");
            Assert.False(WeReplan.ShouldPause(null, now));
        }

        [Test]
        public static void Merged_report_keeps_what_this_job_created_and_updated()
        {
            Assert.Eq("Үүсгэв", WeReplan.MergeOutcome("Үүсгэв", "Хэвээр"));
            Assert.Eq("Үүсгэв", WeReplan.MergeOutcome("Үүсгэв", "Шинэчлэв"), "энэ ажлын харагдацыг дахин төлөвлөлт шинэчилсэн — шинэ хэвээр");
            Assert.Eq("Шинэчлэв", WeReplan.MergeOutcome("Шинэчлэв", "Хэвээр"));
            Assert.Eq("Шинэчлэв", WeReplan.MergeOutcome("Хэвээр", "Шинэчлэв"));
            Assert.Eq("Үүсгэв", WeReplan.MergeOutcome(null, "Үүсгэв"));
            Assert.Eq("Алгасав", WeReplan.MergeOutcome("Үүсгэв", "Алгасав"), "эх нь устсан бол шинэ төлөвлөгөөний үр дүн");
            Assert.Eq(0, WeReplan.MergeUpdated(2, 0, 2), "өмнө үүсгэсэн 2 түлхүүр планыг «шинэчилсэн» гэж тоолохгүй");
            Assert.Eq(3, WeReplan.MergeUpdated(1, 1, 3));
            Assert.Eq(1, WeReplan.MergeUpdated(0, 0, 1));
        }

        [Test]
        public static void Slow_steps_keep_the_five_longest_and_flag_long_ones()
        {
            var s = new WeSlowSteps();
            long[] ms = { 120, 900, 40, 2600, 300, 75, 1400 };
            bool flagged = false;
            for (int i = 0; i < ms.Length; i++) flagged |= s.Add("алхам " + i, ms[i]);
            Assert.True(flagged, "1500 мс-ээс урт алхам логт");
            Assert.Eq(WeSlowSteps.Keep, s.Top.Count);
            Assert.Eq(2600L, s.Top[0].Value);
            Assert.Eq(120L, s.Top[4].Value);
            Assert.Eq(7, s.Steps);
            Assert.Eq(2600L, s.MaxMs);
            Assert.False(new WeSlowSteps().Add("богино", 100));
            Assert.True(s.ToString().Contains("хамгийн урт"), s.ToString());
        }

        [Test]
        public static void Pending_signature_drops_only_the_annotation_part()
        {
            string geo = WeIdentity.WithCrop("o:1,2,3|l:0,1|b:0,1,0,1,0,1|s:t", 100, double.NaN);
            string full = WeIdentity.WithAnnotation(geo, "abc123");
            Assert.Eq(geo, WeIdentity.Pending(full));
            Assert.Eq(geo, WeIdentity.Pending(geo), "тэмдэглэгээгүй тэмдэг хэвээр");
            Assert.Eq(string.Empty, WeIdentity.Pending(null));
        }

        [Test]
        public static void A_view_left_without_annotation_is_re_annotated_on_the_next_run()
        {
            // Ажил харагдац үүсгээд тэмдэглэгээнээс ӨМНӨ зогссон (цуцлах, дахин төлөвлөх, Revit унах): бичлэгт «хүлээгдэж буй» тэмдэг.
            WeRequest req = Fx.SquareRoom(5000, 4000);
            WePlan first = WallElevationPlanner.Plan(req, Fx.Ctx());
            Assert.True(first.Items.Any(i => (i.Signature ?? string.Empty).Contains(WeIdentity.AnnotationMarker)), "тэмдэглэгээ төлөвлөгдсөн (тест хоосон биш)");
            List<WeExistingView> ex = Fx.AsExisting(first);
            foreach (WeExistingView e in ex) e.Signature = WeIdentity.Pending(e.Signature);
            req.Existing = ex;
            WePlan again = WallElevationPlanner.Plan(req, Fx.Ctx());
            foreach (WePlannedElevation p in again.Items.Where(i => i.ExistingViewId != 0))
            {
                bool annotated = (p.Signature ?? string.Empty).Contains(WeIdentity.AnnotationMarker);
                if (annotated)
                {
                    Assert.Eq(WeAction.Update, p.Action, p.SideLetter);
                    Assert.Eq("Тэмдэглэгээ шинэчлэгдэнэ", p.ActionNote, p.SideLetter);
                }
                else Assert.Eq(WeAction.Keep, p.Action, p.SideLetter);
            }
            // Тэмдэглэгээ амжилттай тавигдсан (бүтэн тэмдэг) бол «өөрчлөлтгүй».
            req.Existing = Fx.AsExisting(first);
            Assert.True(WallElevationPlanner.Plan(req, Fx.Ctx()).Items.Where(i => i.ExistingViewId != 0).All(i => i.Action == WeAction.Keep), "бүтэн тэмдэг → хэвээр");
        }
    }
}
