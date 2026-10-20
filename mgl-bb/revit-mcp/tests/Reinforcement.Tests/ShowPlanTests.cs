using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement.Tests
{
    /// <summary>
    /// «Арматур харуулах» (захын + голын ширхэг, голоос N дэх ширхэг): олонлог (bar set)-ийн харагдах ширхгийн ЦЭВЭР дүрэм.  Revit-гүй.
    /// Эзний дүрэм: ганц, 2 ширхэгтэй олонлогт ХҮРЭХГҮЙ; «гол» тэгш тоотой үед төгсгөлийн талын төв ширхэг.
    /// </summary>
    public static class ShowPlanTests
    {
        private static List<int> Range(int n) { return Enumerable.Range(0, n).ToList(); }

        [Test]
        public static void Single_and_two_bar_sets_are_never_affected()
        {
            Assert.False(RfShowPlan.IsAffected(1));
            Assert.False(RfShowPlan.IsAffected(2));
            Assert.True(RfShowPlan.IsAffected(3));
            Assert.True(RfShowPlan.IsAffected(40));
        }

        [Test]
        public static void Edges_and_middle_for_an_odd_set()
        {
            RfShowDecision d = RfShowPlan.Decide(Range(11), RfShowSpec.EdgesAndMiddle(), null, null);
            Assert.SeqEq(new[] { 0, 5, 10 }, d.Visible);
            Assert.SeqEq(new[] { 1, 2, 3, 4, 6, 7, 8, 9 }, d.Hidden);
            Assert.Eq(RfShowTarget.Select, d.Target);
            Assert.False(d.Empty);
        }

        [Test]
        public static void Even_set_takes_the_end_side_centre_bar_as_middle()
        {
            RfShowDecision d = RfShowPlan.Decide(Range(10), RfShowSpec.EdgesAndMiddle(), null, null);
            Assert.SeqEq(new[] { 0, 5, 9 }, d.Visible);
            Assert.Eq(5, RfShowPlan.MiddleOf(10));
            Assert.Eq(1, RfShowPlan.MiddleOf(3));
        }

        [Test]
        public static void Three_bar_set_with_edges_and_middle_is_just_everything()
        {
            RfShowDecision d = RfShowPlan.Decide(Range(3), RfShowSpec.EdgesAndMiddle(), null, null);
            Assert.SeqEq(new[] { 0, 1, 2 }, d.Visible);
            Assert.Eq(0, d.Hidden.Count);
            Assert.Eq(RfShowTarget.All, d.Target);
        }

        [Test]
        public static void First_and_last_only_uses_the_native_first_last_mode()
        {
            var spec = new RfShowSpec { First = true, Last = true, Middle = false };
            RfShowDecision d = RfShowPlan.Decide(Range(8), spec, null, null);
            Assert.SeqEq(new[] { 0, 7 }, d.Visible);
            Assert.Eq(RfShowTarget.FirstLast, d.Target);
        }

        [Test]
        public static void Middle_is_optional_and_offsets_go_sideways_from_it()
        {
            var spec = new RfShowSpec { First = false, Last = false, Middle = false, Offsets = new List<int> { 2 } };
            RfShowDecision d = RfShowPlan.Decide(Range(11), spec, null, null);
            Assert.SeqEq(new[] { 3, 7 }, d.Visible);      // гол = 5, ±2
            Assert.Eq(RfShowTarget.Select, d.Target);
        }

        [Test]
        public static void Offsets_can_be_limited_to_one_side()
        {
            var start = new RfShowSpec { First = false, Last = false, Middle = true, Offsets = new List<int> { 1, 3 }, Side = RfShowSide.Start };
            Assert.SeqEq(new[] { 2, 4, 5 }, RfShowPlan.Decide(Range(11), start, null, null).Visible);      // гол = 5; 5−1 = 4, 5−3 = 2
            var end = new RfShowSpec { First = false, Last = false, Middle = true, Offsets = new List<int> { 1, 3 }, Side = RfShowSide.End };
            Assert.SeqEq(new[] { 5, 6, 8 }, RfShowPlan.Decide(Range(11), end, null, null).Visible);
        }

        [Test]
        public static void Offset_outside_the_set_is_reported_not_guessed()
        {
            var spec = new RfShowSpec { First = true, Last = true, Middle = false, Offsets = new List<int> { 2, 9 } };
            RfShowDecision d = RfShowPlan.Decide(Range(7), spec, null, null);      // гол = 3, ±2 → 1,5; ±9 хүрээнээс гадуур
            Assert.SeqEq(new[] { 0, 1, 5, 6 }, d.Visible);
            Assert.SeqEq(new[] { 9 }, d.OutOfRange);
        }

        [Test]
        public static void Offset_that_fits_only_one_side_is_not_out_of_range()
        {
            // 5 ширхэг, гол = 2: гол − 3 < 0 боловч гол + 3 = 5 ≥ n → хоёулаа гадуур; гол + 2 = 4 багтана.
            var spec = new RfShowSpec { First = false, Last = false, Middle = false, Offsets = new List<int> { 2, 3 } };
            RfShowDecision d = RfShowPlan.Decide(Range(5), spec, null, null);
            Assert.SeqEq(new[] { 0, 4 }, d.Visible);
            Assert.SeqEq(new[] { 3 }, d.OutOfRange);
        }

        [Test]
        public static void Clicked_bar_is_added_and_uses_the_real_index_of_a_set_with_gaps()
        {
            // Байгаа ширхгүүд: 0,1,3,4,5 (2 дутуу).  Дарсан ширхэг = 4 (жагсаалтын 3-р байрлал).
            var existing = new List<int> { 0, 1, 3, 4, 5 };
            var spec = new RfShowSpec { First = true, Last = false, Middle = false };
            RfShowDecision d = RfShowPlan.Decide(existing, spec, new[] { 4 }, null);
            Assert.SeqEq(new[] { 0, 4 }, d.Visible);
            Assert.SeqEq(new[] { 1, 3, 5 }, d.Hidden);
        }

        [Test]
        public static void Edges_and_middle_on_a_set_with_gaps_use_existing_positions_only()
        {
            var existing = new List<int> { 0, 1, 3, 4, 5 };      // 5 байгаа ширхэг → гол = жагсаалтын 2-р байрлал = индекс 3
            RfShowDecision d = RfShowPlan.Decide(existing, RfShowSpec.EdgesAndMiddle(), null, null);
            Assert.SeqEq(new[] { 0, 3, 5 }, d.Visible);
        }

        [Test]
        public static void Keep_visible_adds_to_what_is_already_shown()
        {
            var spec = new RfShowSpec { First = true, Last = false, Middle = false, KeepVisible = true };
            RfShowDecision d = RfShowPlan.Decide(Range(9), spec, null, new List<int> { 2, 6 });
            Assert.SeqEq(new[] { 0, 2, 6 }, d.Visible);
        }

        [Test]
        public static void Nothing_selected_is_empty_never_hide_everything()
        {
            var spec = new RfShowSpec { First = false, Last = false, Middle = false };
            RfShowDecision d = RfShowPlan.Decide(Range(9), spec, null, null);
            Assert.True(d.Empty);
            Assert.Eq(0, d.Hidden.Count);
        }

        [Test]
        public static void Everything_selected_maps_to_the_native_all_mode()
        {
            var spec = new RfShowSpec { First = true, Last = true, Middle = true, Offsets = new List<int> { 1, 2, 3 } };
            RfShowDecision d = RfShowPlan.Decide(Range(7), spec, null, null);
            Assert.Eq(RfShowTarget.All, d.Target);
            Assert.Eq(7, d.Visible.Count);
        }

        [Test]
        public static void Current_visible_follows_each_presentation_mode()
        {
            List<int> ex = Range(9);
            Assert.SeqEq(Range(9), RfShowPlan.CurrentVisible(RfPresentation.All, ex, null));
            Assert.SeqEq(new[] { 0, 8 }, RfShowPlan.CurrentVisible(RfPresentation.FirstLast, ex, null));
            Assert.SeqEq(new[] { 4 }, RfShowPlan.CurrentVisible(RfPresentation.Middle, ex, null));
            Assert.SeqEq(new[] { 1, 2, 7 }, RfShowPlan.CurrentVisible(RfPresentation.Select, ex, i => i != 1 && i != 2 && i != 7 ? true : false));
        }

        [Test]
        public static void Already_applied_is_detected_only_when_set_and_mode_both_match()
        {
            List<int> ex = Range(9);
            RfShowDecision d = RfShowPlan.Decide(ex, RfShowSpec.EdgesAndMiddle(), null, null);       // 0,4,8 Select
            Assert.True(RfShowPlan.IsAlreadyApplied(d, new List<int> { 0, 4, 8 }, RfPresentation.Select));
            Assert.False(RfShowPlan.IsAlreadyApplied(d, new List<int> { 0, 4, 8 }, RfPresentation.Middle));
            Assert.False(RfShowPlan.IsAlreadyApplied(d, new List<int> { 0, 8 }, RfPresentation.Select));
            Assert.False(RfShowPlan.IsAlreadyApplied(d, null, RfPresentation.Select));
        }

        [Test]
        public static void Offsets_text_parsing()
        {
            List<int> o;
            Assert.True(RfShowPlan.TryParseOffsets("", out o)); Assert.Eq(0, o.Count);
            Assert.True(RfShowPlan.TryParseOffsets("  ", out o)); Assert.Eq(0, o.Count);
            Assert.True(RfShowPlan.TryParseOffsets("2", out o)); Assert.SeqEq(new[] { 2 }, o);
            Assert.True(RfShowPlan.TryParseOffsets("3, 1;2 2", out o)); Assert.SeqEq(new[] { 1, 2, 3 }, o);
            Assert.False(RfShowPlan.TryParseOffsets("0", out o)); Assert.Eq(0, o.Count);
            Assert.False(RfShowPlan.TryParseOffsets("-1", out o));
            Assert.False(RfShowPlan.TryParseOffsets("2a", out o));
            Assert.False(RfShowPlan.TryParseOffsets("1,x", out o));
            Assert.False(RfShowPlan.TryParseOffsets("1000", out o));
        }

        [Test]
        public static void Preview_numbers_are_one_based()
        {
            List<int> ex = Range(11);
            RfShowDecision d = RfShowPlan.Decide(ex, RfShowSpec.EdgesAndMiddle(), null, null);
            Assert.Eq("1, 6, 11", RfShowPlan.DescribeVisible(ex, d));
        }
    }
}
