using System;
using System.Collections.Generic;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    /// <summary>
    /// «Өрөөн дотор дарж сонгох» (WE-BUG-002/003) — нэг цэгт хэд хэдэн өрөө олдоход аль нь хожих, дахин дарахад хасах, төлөвийн мөр.
    /// Revit-ийн цэг → өрөө уншилтыг live gate (SEL-*) шалгана; энэ нь шийдвэрийн дүрэм.
    /// </summary>
    public static class PickRulesTests
    {
        private static WePickCandidate Room(string key, bool host, bool tagged, double area, int order)
        {
            return new WePickCandidate { Key = key, Label = key, IsRoom = true, IsHost = host, TaggedInView = tagged, Area = area, Order = order };
        }

        [Test]
        public static void Host_room_wins_over_a_linked_room_at_the_same_point()
        {
            WePickCandidate c = WePickRules.Choose(new[] { Room("link|a|1", false, true, 10, 0), Room("host-101", true, false, 50, 1) });
            Assert.Eq("host-101", c.Key);
        }

        [Test]
        public static void Overlapping_links_prefer_the_room_tagged_in_the_active_plan()
        {
            // GEN-OVERLAP-105: LinkB2 нь 105-ыг давхардуулдаг — планд tag-тай нь хэрэглэгчийн харж буй өрөө.
            WePickCandidate c = WePickRules.Choose(new[] { Room("link|b2|105", false, false, 5, 0), Room("link|a|105", false, true, 20, 1) });
            Assert.Eq("link|a|105", c.Key);
        }

        [Test]
        public static void Without_tags_the_smaller_room_wins_then_the_first_found()
        {
            Assert.Eq("small", WePickRules.Choose(new[] { Room("big", false, false, 30, 0), Room("small", false, false, 12, 1) }).Key);
            Assert.Eq("first", WePickRules.Choose(new[] { Room("first", false, false, 12, 0), Room("second", false, false, 12, 1) }).Key);
        }

        [Test]
        public static void A_room_always_wins_over_a_wall()
        {
            var wall = new WePickCandidate { Key = "wall-1", Label = "хана", IsRoom = false, IsHost = true };
            Assert.Eq("link|a|7", WePickRules.Choose(new[] { wall, Room("link|a|7", false, false, 9, 1) }).Key);
        }

        [Test]
        public static void Nothing_found_returns_null()
        {
            Assert.Null(WePickRules.Choose(new WePickCandidate[0]));
            Assert.Null(WePickRules.Choose(null));
        }

        [Test]
        public static void Clicking_a_picked_room_again_removes_it_and_keeps_order()
        {
            var set = new WePickSet();
            Assert.True(set.Toggle(Room("101", true, false, 1, 0)));
            Assert.True(set.Toggle(Room("102", true, false, 1, 0)));
            Assert.True(set.Toggle(Room("103", true, false, 1, 0)));
            Assert.False(set.Toggle(Room("102", true, false, 1, 0)));
            Assert.SeqEq(new[] { "101", "103" }, set.Labels);
            Assert.Throws<ArgumentException>(() => set.Toggle(new WePickCandidate()));
        }

        [Test]
        public static void Prompt_says_how_to_finish_and_what_is_selected()
        {
            var set = new WePickSet();
            string empty = WePickRules.Prompt(set, null);
            Assert.True(empty.Contains("Esc = болих"), empty);
            for (int i = 1; i <= 8; i++) set.Toggle(Room("R" + i, true, false, 1, 0));
            string p = WePickRules.Prompt(set, "тэр цэгт өрөө, хана олдсонгүй");
            Assert.True(p.StartsWith("⚠ тэр цэгт"), p);
            Assert.True(p.Contains("Сонгосон 8: R1, R2, R3, R4, R5, R6 … (+2)"), p);
            Assert.True(p.EndsWith(WePickRules.PromptFinish), p);
        }

        [Test]
        public static void One_click_prompt_needs_no_tag_and_says_esc_opens_other_options()
        {
            // Эзэн 2026-10-13: «өрөөн дээр дармагц автоматаар таниад шууд» — шошго хэрэггүй, Esc нь болих биш бусад сонголт.
            string p = WePickRules.PromptOne(null);
            Assert.True(p.StartsWith(WePickRules.PromptOneBase), p);
            Assert.True(p.Contains("шошго хэрэггүй"), p);
            Assert.True(p.EndsWith(WePickRules.PromptOneEsc), p);
            string again = WePickRules.PromptOne("тэр цэг ямар ч өрөөний хил дотор биш");
            Assert.True(again.StartsWith("⚠ тэр цэг ямар ч өрөөний хил дотор биш · "), again);
        }

        [Test]
        public static void Ctrl_click_multi_mode_prompt_and_set_membership()
        {
            // 2026-10-14 (интерьерийн баг: «олон өрөө сонгоход 1 л гардаг»): нэг товшилтын мөр Ctrl-ийг заана; олон өрөөний мөр нэмэх/дуусгахыг.
            Assert.True(WePickRules.PromptOne(null).Contains(WePickRules.PromptOneMulti), "Ctrl+дарж олон өрөө — мөрөнд");
            var set = new WePickSet();
            WePickCandidate a = Room("101", true, false, 1, 0), b = Room("102", true, false, 1, 1);
            set.Toggle(a);
            Assert.True(set.Contains(a) && !set.Contains(b));
            string p = WePickRules.PromptAdd(set, null);
            Assert.True(p.StartsWith(WePickRules.PromptAddBase), p);
            Assert.True(p.Contains("Сонгосон 1: 101"), p);
            Assert.True(p.EndsWith(WePickRules.PromptAddFinish), p);
        }

        [Test]
        public static void Linked_level_matches_the_nearest_within_tolerance_only()
        {
            // Link-ийн давхрууд host-ын координатад: 0, 3.6 м, 7.2 м (фут).  Планы давхар 3.65 м → «L2»; 5.4 м → хүлцлээс гадуур → null.
            double m = 1 / 0.3048;
            var levels = new[]
            {
                new KeyValuePair<string, double>("L1", 0),
                new KeyValuePair<string, double>("L2", 3.6 * m),
                new KeyValuePair<string, double>("L3", 7.2 * m),
            };
            Assert.Eq("L2", WeLevelMatch.Nearest(levels, 3.65 * m, 0.6 * m));
            Assert.Null(WeLevelMatch.Nearest(levels, 5.4 * m, 0.6 * m));
            Assert.Eq("L3", WeLevelMatch.Nearest(levels, 5.5 * m, double.MaxValue));
            Assert.Null(WeLevelMatch.Nearest(null, 0, 1));
        }

        [Test]
        public static void Equal_level_distance_keeps_the_first()
        {
            var levels = new[] { new KeyValuePair<string, double>("A", 1), new KeyValuePair<string, double>("B", 3) };
            Assert.Eq("A", WeLevelMatch.Nearest(levels, 2, 5));
        }
    }
}
