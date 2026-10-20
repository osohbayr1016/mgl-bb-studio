using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement.Tests
{
    /// <summary>Түүвэр клонлох: Partition-ийн ЯГ тэнцүү дүрэм, нэр, 8 шүүлтүүрийн хязгаар, параметрийн сонголт.</summary>
    public static class PartitionRulesTests
    {
        private static RfExistingSchedule Ex(long id, string name, bool compat = true, string filter = null, string gen = null)
        {
            return new RfExistingSchedule { Id = id, Name = name, Compatible = compat, FilterValue = filter, GeneratedPartition = gen };
        }

        // ── Шүүлтүүр = ЯГ тэнцүү (Equal), Contains БИШ ──────────────────

        [Test]
        public static void Equal_DN1_never_matches_DN10()
        {
            Assert.True(RfScheduleNames.SameValue("ДН-1", "ДН-1"));
            Assert.False(RfScheduleNames.SameValue("ДН-1", "ДН-10"), "ДН-1 ≠ ДН-10");
            Assert.False(RfScheduleNames.SameValue("ДН-10", "ДН-1"));
            Assert.False(RfScheduleNames.SameValue("ДН-1", "ДН-11"));
            Assert.False(RfScheduleNames.SameValue("DN-1", "DN-1 "), "захын зай ялгаатай утга");
            Assert.False(RfScheduleNames.SameValue("dn-1", "DN-1"), "том/жижиг үсэг ялгаатай");
            Assert.False(RfScheduleNames.SameValue(null, "ДН-1"));
        }

        [Test]
        public static void Planner_does_not_treat_DN10_schedule_as_up_to_date_for_DN1()
        {
            // «ДН-1 …» нэртэй боловч шүүлтүүр нь ДН-10 — зөв гэж үзэж БОЛОХГҮЙ.
            var existing = new List<RfExistingSchedule> { Ex(50, "ДН-1 Арматурын түүвэр", filter: "ДН-10") };
            List<RfClonePlanItem> plan = RfClonePlanner.Plan(RfPartitionSet.Build(new[] { "ДН-1" }).Values,
                "{Partition} Арматурын түүвэр", "ДН-1 Арматурын түүвэр", 1, existing, RfExistingPolicy.Skip);
            Assert.Eq(RfCloneAction.Skip, plan[0].Action, "шүүлтүүр буруу ⇒ UpToDate БИШ (Алгасах бодлого)");
            Assert.Eq(RfCloneReason.WrongTargetExists, plan[0].Reason);
        }

        // ── Нэр ────────────────────────────────────────────────────────

        [Test]
        public static void Name_replaces_source_partition_token_with_target()
        {
            string pat = RfScheduleNames.SuggestPattern("ДН-1 Арматурын түүвэр", "ДН-1");
            Assert.Eq("{Partition} Арматурын түүвэр", pat);
            Assert.Eq("ДН-2 Арматурын түүвэр", RfScheduleNames.Resolve(pat, "ДН-1 Арматурын түүвэр", "ДН-2"));
            Assert.Eq("ДН-10 Арматурын түүвэр", RfScheduleNames.Resolve(pat, "ДН-1 Арматурын түүвэр", "ДН-10"));
        }

        [Test]
        public static void Name_does_not_replace_inside_longer_token()
        {
            // Эх нэрэнд «ДН-10» байгаа ч эх Partition «ДН-1» — токен биш (хэсэгчилсэн) ⇒ fallback.
            Assert.Eq("{Template} — {Partition}", RfScheduleNames.SuggestPattern("ДН-10 Арматурын түүвэр", "ДН-1"));
        }

        [Test]
        public static void Name_without_token_appends_target_with_em_dash()
        {
            string pat = RfScheduleNames.SuggestPattern("Арматурын түүвэр", "ДН-1");
            Assert.Eq("{Template} — {Partition}", pat);
            Assert.Eq("Арматурын түүвэр — ДН-2", RfScheduleNames.Resolve(pat, "Арматурын түүвэр", "ДН-2"));
        }

        [Test]
        public static void Name_sanitizes_invalid_revit_characters_in_partition()
        {
            Assert.Eq("Beam DN_1 R", RfScheduleNames.Resolve("Beam {Partition} R", "x", "DN:1"));
            Assert.Eq("DN_1_a", RfScheduleNames.Resolve("{Partition}", "x", "DN{1}a"));
        }

        [Test]
        public static void Duplicate_target_names_are_reported_not_overwritten()
        {
            // «DN:1» ба «DN_1» ижил нэр болно ⇒ хоёр дахь нь Conflict.
            List<RfClonePlanItem> plan = RfClonePlanner.Plan(RfPartitionSet.Build(new[] { "DN:1", "DN_1" }).Values,
                "{Partition} Т", "Эх", 1, new List<RfExistingSchedule>(), RfExistingPolicy.Skip);
            Assert.Eq(1, plan.Count(p => p.Action == RfCloneAction.Create));
            Assert.Eq(1, plan.Count(p => p.Reason == RfCloneReason.DuplicateName));
        }

        [Test]
        public static void Existing_target_default_is_skip_and_update_is_opt_in_replace_never_default()
        {
            var existing = new List<RfExistingSchedule> { Ex(50, "ДН-2 Т", filter: "ДН-9", gen: null) };
            var chosen = RfPartitionSet.Build(new[] { "ДН-2" }).Values;
            Assert.Eq(RfCloneAction.Skip, RfClonePlanner.Plan(chosen, "{Partition} Т", "ДН-1 Т", 1, existing, RfExistingPolicy.Skip)[0].Action);
            Assert.Eq(RfCloneAction.UpdateFilter, RfClonePlanner.Plan(chosen, "{Partition} Т", "ДН-1 Т", 1, existing, RfExistingPolicy.UpdateFilter)[0].Action);
            // Гараар хийсэн (энэ хэрэгслийн биш) түүврийг «Солих» ХЭЗЭЭ Ч устгахгүй.
            Assert.Eq(RfCloneAction.Conflict, RfClonePlanner.Plan(chosen, "{Partition} Т", "ДН-1 Т", 1, existing, RfExistingPolicy.Replace)[0].Action);
        }

        // ── Хөндөхгүй байх дүрэм (production аюулгүй байдал) ───────────

        [Test]
        public static void UpdateFilter_never_adds_a_filter_to_a_hand_made_schedule_without_partition_filter()
        {
            // Нэр яг таарсан ГАРААР хийсэн түүвэр: Partition шүүлтүүргүй ⇒ өөр зорилготой байж болно, шүүлтүүр НЭМЭХГҮЙ.
            var noFilter = new List<RfExistingSchedule> { Ex(5, "ДН-2 Т", filter: null, gen: null) };
            var chosen = RfPartitionSet.Build(new[] { "ДН-2" }).Values;
            RfClonePlanItem it = RfClonePlanner.Plan(chosen, "{Partition} Т", "ДН-1 Т", 1, noFilter, RfExistingPolicy.UpdateFilter)[0];
            Assert.Eq(RfCloneAction.Conflict, it.Action);
            Assert.Eq(RfCloneReason.HandMadeNoPartitionFilter, it.Reason);

            // Харин ЭНЭ хэрэгслийн үүсгэсэн (gen) эсвэл аль хэдийн Partition шүүлтүүртэй (утга нь буруу) бол шинэчилнэ.
            var tool = new List<RfExistingSchedule> { Ex(5, "ДН-2 Т", filter: null, gen: "ДН-2") };
            Assert.Eq(RfCloneAction.UpdateFilter, RfClonePlanner.Plan(chosen, "{Partition} Т", "ДН-1 Т", 1, tool, RfExistingPolicy.UpdateFilter)[0].Action);
            var wrongValue = new List<RfExistingSchedule> { Ex(5, "ДН-2 Т", filter: "ДН-9", gen: null) };
            Assert.Eq(RfCloneAction.UpdateFilter, RfClonePlanner.Plan(chosen, "{Partition} Т", "ДН-1 Т", 1, wrongValue, RfExistingPolicy.UpdateFilter)[0].Action);
        }

        [Test]
        public static void Sync_never_offers_filter_fix_for_hand_made_schedule_without_partition_filter()
        {
            var existing = new List<RfExistingSchedule> { Ex(5, "ДН-2 Т", filter: null, gen: null) };
            var rows = RfSyncPlanner.Plan(new List<string> { "ДН-2" }, "{Partition} Т", "Эх", 1, existing);
            Assert.Eq(RfSyncStatus.Conflict, rows.First(r => r.Partition == "ДН-2").Status);
            Assert.False(rows.Any(r => r.Status == RfSyncStatus.WrongTarget), "«Шүүлтүүр засах» жагсаалтад орохгүй");
        }

        [Test]
        public static void Similar_but_not_identical_names_never_match_an_existing_schedule()
        {
            // Зөвхөн ойролцоо нэр (захын зай, нэмэлт тэмдэгт, өөр тоо) ⇒ байгаа түүвэртэй ХЭЗЭЭ Ч таарахгүй, Create.
            var existing = new List<RfExistingSchedule>
            {
                Ex(5, "ДН-2 Т ", filter: "ДН-9"),      // төгсгөлд зай
                Ex(6, "ДН-2  Т", filter: "ДН-9"),      // давхар зай
                Ex(7, "ДН-20 Т", filter: "ДН-20"),
                Ex(8, "ДН-2 Т2", filter: "ДН-9"),
            };
            RfClonePlanItem it = RfClonePlanner.Plan(RfPartitionSet.Build(new[] { "ДН-2" }).Values, "{Partition} Т", "ДН-1 Т", 1, existing, RfExistingPolicy.UpdateFilter)[0];
            Assert.Eq(RfCloneAction.Create, it.Action);
            Assert.Eq(0L, it.ExistingId);
        }

        // ── 8 шүүлтүүрийн хязгаар ──────────────────────────────────────

        [Test]
        public static void Filter_limit_blocks_ninth_filter_but_allows_replacing_existing_partition_filter()
        {
            Assert.Eq(8, RfScheduleLimits.MaxFilters);
            Assert.True(RfScheduleLimits.CanApplyPartitionFilter(0, false));
            Assert.True(RfScheduleLimits.CanApplyPartitionFilter(7, false), "8 дахь нь зөвшөөрөгдөнө");
            Assert.False(RfScheduleLimits.CanApplyPartitionFilter(8, false), "9 дэх нь Revit-д байхгүй");
            Assert.False(RfScheduleLimits.CanApplyPartitionFilter(12, false));
            Assert.True(RfScheduleLimits.CanApplyPartitionFilter(8, true), "байгаа Partition шүүлтүүрийг СОЛИНО — тоо нэмэгдэхгүй");
        }

        // ── Шүүлтүүр тавих шийдвэр: бусад шүүлтүүр хөндөгдөхгүй ──────────

        [Test]
        public static void FilterPlan_replaces_only_the_partition_filter_by_index()
        {
            // [A, B, Partition(7), C] ⇒ индекс 2-ыг л солино; A, B, C хөндөгдөхгүй.
            RfFilterDecision d = RfFilterPlan.Decide(new[] { 1, 2, 7, 3 }, 7);
            Assert.Eq(RfFilterOp.Set, d.Op);
            Assert.Eq(2, d.Index);
        }

        [Test]
        public static void FilterPlan_adds_when_no_partition_filter_and_room_left()
        {
            Assert.Eq(RfFilterOp.Add, RfFilterPlan.Decide(new int[0], 7).Op);
            Assert.Eq(RfFilterOp.Add, RfFilterPlan.Decide(new[] { 1, 2 }, 7).Op);
            Assert.Eq(RfFilterOp.Add, RfFilterPlan.Decide(new[] { 1, 2, 3, 4, 5, 6, 8 }, 7).Op, "7 шүүлтүүр ⇒ 8 дахь нь болно");
            Assert.Eq(RfFilterOp.Add, RfFilterPlan.Decide(null, 7).Op);
        }

        [Test]
        public static void FilterPlan_refuses_ninth_filter_but_still_sets_existing_at_eight()
        {
            var eight = new[] { 1, 2, 3, 4, 5, 6, 8, 9 };
            Assert.Eq(RfFilterOp.TooMany, RfFilterPlan.Decide(eight, 7).Op, "8 шүүлтүүр, Partition алга ⇒ 9 дэх боломжгүй");
            var eightWith = new[] { 1, 2, 3, 4, 5, 7, 8, 9 };
            RfFilterDecision d = RfFilterPlan.Decide(eightWith, 7);
            Assert.Eq(RfFilterOp.Set, d.Op, "8 шүүлтүүр, Partition бий ⇒ солино");
            Assert.Eq(5, d.Index);
        }

        [Test]
        public static void FilterPlan_with_two_filters_on_same_field_sets_the_first()
        {
            RfFilterDecision d = RfFilterPlan.Decide(new[] { 7, 3, 7 }, 7);
            Assert.Eq(RfFilterOp.Set, d.Op);
            Assert.Eq(0, d.Index);
        }

        [Test]
        public static void FilterPlan_unknown_partition_field_is_treated_as_new_hidden_field()
        {
            // Partition талбар түүвэрт байхгүй (нуугдсан талбар шинээр нэмэгдэнэ) ⇒ шүүлтүүр таарахгүй, зөвхөн хязгаар.
            Assert.Eq(RfFilterOp.Add, RfFilterPlan.Decide(new[] { 1, 2, 3 }, int.MinValue).Op);
            Assert.Eq(RfFilterOp.TooMany, RfFilterPlan.Decide(new[] { 1, 2, 3, 4, 5, 6, 7, 8 }, int.MinValue).Op);
        }

        // ── Параметрийн сонголт (нэг scan-ы дүнгээс) ───────────────────

        [Test]
        public static void Partition_param_choice_is_NUMBER_only_never_workset()
        {
            Assert.Eq(RfPartitionParam.Number, RfPartitionChoice.Choose(5));
            Assert.Eq(RfPartitionParam.Number, RfPartitionChoice.Choose(1));
            Assert.Eq(RfPartitionParam.None, RfPartitionChoice.Choose(0), "Partition хоосон бол Workset руу НӨӨЦЛӨХГҮЙ");
            Assert.Eq(1, Enum.GetValues(typeof(RfPartitionParam)).Length - 1, "Number-ээс өөр сонголт байхгүй");
        }

        // ── Partition индекс (нэг scan-ы үр дүн) ───────────────────────

        [Test]
        public static void Partition_index_counts_each_distinct_value_once_blank_ignored()
        {
            var raw = new List<string>();
            raw.AddRange(Enumerable.Repeat("ДН-1", 40));
            raw.AddRange(Enumerable.Repeat("ДН-2", 25));
            raw.AddRange(Enumerable.Repeat("ДН-10", 5));
            raw.AddRange(new[] { null, "", "   " });
            RfPartitionSet set = RfPartitionSet.Build(raw);
            Assert.SeqEq(new[] { "ДН-1", "ДН-2", "ДН-10" }, set.Values.Select(v => v.Value));
            Assert.SeqEq(new[] { 40, 25, 5 }, set.Values.Select(v => v.RebarCount));
            Assert.Eq(3, set.BlankCount);
            Assert.Eq(73, set.TotalRebars);
        }

        [Test]
        public static void Partition_index_and_plan_handle_150_partitions()
        {
            // 150 Partition × 20 арматур = 3 000 арматурын утгаас индекс + төлөвлөгөө (Revit-ийн scan-ын тоо тусдаа — RfParam.ScanPartitions).
            var raw = new List<string>();
            for (int p = 1; p <= 150; p++)
                for (int k = 0; k < 20; k++) raw.Add("ДН-" + p);
            RfPartitionSet set = RfPartitionSet.Build(raw);
            Assert.Eq(150, set.Values.Count);
            Assert.True(set.Values.All(v => v.RebarCount == 20));
            Assert.Eq("ДН-1", set.Values[0].Value);
            Assert.Eq("ДН-150", set.Values[149].Value, "байгалийн эрэмбэ");

            var items = RfClonePlanner.Plan(set.Values, "{Partition} Т", "ДН-1 Т", 1, new List<RfExistingSchedule>(), RfExistingPolicy.Skip);
            Assert.Eq(150, items.Count);
            Assert.True(items.All(i => i.Action == RfCloneAction.Create));
        }
    }
}
