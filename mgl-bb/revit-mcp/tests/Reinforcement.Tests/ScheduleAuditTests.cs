using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement.Tests
{
    /// <summary>
    /// Хоёр дахь шатны аудитын (2026-10-02) түүвэр клонлох/синкийн хамгаалалтууд: нэрийн мөргөлдөөн, «renamed» таних дүрэм,
    /// Replace-ийн layout хамгаалалт, Workset-ийг Partition гэж андуурахгүй байх.
    /// </summary>
    public static class ScheduleAuditTests
    {
        private const string Pat = "Beam {Partition} Reinforcement";
        private const string Tpl = "Beam DN-1 Reinforcement";

        private static RfExistingSchedule Ex(long id, string name, string filter = null, string gen = null, bool fromThis = false,
            bool compatible = true, int segments = 1, bool bySheet = false, int sheets = 0)
        {
            return new RfExistingSchedule
            {
                Id = id,
                Name = name,
                Compatible = compatible,
                FilterValue = filter,
                GeneratedPartition = gen,
                GeneratedFromThisTemplate = fromThis,
                SegmentCount = segments,
                FilteredBySheet = bySheet,
                SheetPlacements = sheets,
            };
        }

        private static List<RfPartitionValue> Chosen(params string[] v) { return RfPartitionSet.Build(v).Values; }

        // ── Нэрийн мөргөлдөөн ───────────────────────────────────────────

        [Test]
        public static void Collisions_find_case_sanitised_and_edge_space_groups()
        {
            HashSet<string> c = RfNameCollisions.Find(Pat, Tpl, new[] { "DN-2", "dn-2", "DN:1", "DN_1", "DN-3", "DN-4", "DN-4 " });
            Assert.True(c.Contains("Beam DN-2 Reinforcement"), "том/жижиг үсэг");
            Assert.True(c.Contains("Beam DN_1 Reinforcement"), "хориотой тэмдэгт «_» болно");
            Assert.True(c.Contains("Beam DN-4 Reinforcement"), "захын зай тайрагдана");
            Assert.False(c.Contains("Beam DN-3 Reinforcement"), "давхцаагүй нэр орохгүй");
            Assert.Eq(3, c.Count);
        }

        [Test]
        public static void Collisions_same_value_twice_is_not_a_collision()
        {
            Assert.Eq(0, RfNameCollisions.Find(Pat, Tpl, new[] { "DN-1", "DN-1", "DN-2" }).Count);
        }

        [Test]
        public static void Collisions_bad_pattern_or_null_is_empty()
        {
            Assert.Eq(0, RfNameCollisions.Find("no token", Tpl, new[] { "A", "a" }).Count);
            Assert.Eq(0, RfNameCollisions.Find(Pat, Tpl, null).Count);
        }

        [Test]
        public static void Plan_update_never_retargets_a_name_shared_by_two_partitions()
        {
            // «DN:1» ба «DN_1» хоёулаа «Beam DN_1 Reinforcement» болно; түүвэр нь «DN_1»-ийнх.  «DN:1»-ийг сонгоход «шинэчлэх» гэж
            // тэр түүврийг буцааж чиглүүлж БОЛОХГҮЙ (flip-flop).
            var existing = new List<RfExistingSchedule> { Ex(10, "Beam DN_1 Reinforcement", filter: "DN_1", gen: "DN_1", fromThis: true) };
            List<RfClonePlanItem> plan = RfClonePlanner.Plan(Chosen("DN:1"), Pat, Tpl, 1, existing, RfExistingPolicy.UpdateFilter,
                new[] { "DN:1", "DN_1" });
            Assert.Eq(1, plan.Count);
            Assert.Eq(RfCloneAction.Conflict, plan[0].Action);
            Assert.Eq(RfCloneReason.DuplicateName, plan[0].Reason);
        }

        [Test]
        public static void Plan_collision_with_unselected_partition_still_blocks_replace()
        {
            var existing = new List<RfExistingSchedule> { Ex(10, "Beam DN-2 Reinforcement", filter: "dn-2", gen: "dn-2", fromThis: true) };
            List<RfClonePlanItem> plan = RfClonePlanner.Plan(Chosen("DN-2"), Pat, Tpl, 1, existing, RfExistingPolicy.Replace, new[] { "DN-2", "dn-2" });
            Assert.Eq(RfCloneAction.Conflict, plan[0].Action);
            Assert.Eq(RfCloneReason.DuplicateName, plan[0].Reason);
        }

        [Test]
        public static void Plan_without_collision_still_updates_as_before()
        {
            var existing = new List<RfExistingSchedule> { Ex(10, "Beam DN-2 Reinforcement", filter: "DN-3", gen: "DN-3", fromThis: true) };
            List<RfClonePlanItem> plan = RfClonePlanner.Plan(Chosen("DN-2"), Pat, Tpl, 1, existing, RfExistingPolicy.UpdateFilter, new[] { "DN-2", "DN-3" });
            Assert.Eq(RfCloneAction.UpdateFilter, plan[0].Action);
        }

        [Test]
        public static void Plan_bad_pattern_makes_every_item_conflict_and_keeps_count()
        {
            List<RfClonePlanItem> plan = RfClonePlanner.Plan(Chosen("DN-1", "DN-2", "DN-3"), "no token", "T", 1, new List<RfExistingSchedule>(), RfExistingPolicy.Skip);
            Assert.Eq(3, plan.Count, "жагсаалт хоосрох ёсгүй");
            Assert.True(plan.All(p => p.Action == RfCloneAction.Conflict && p.Reason == RfCloneReason.InvalidName));
        }

        [Test]
        public static void Sync_two_partitions_one_name_are_conflicts_not_wrong_target()
        {
            // «DN-2» ба «dn-2» → ижил нэр.  Байгаа түүвэр нь «DN-2»-ийнх.  Аль аль нь «Мөргөлдөөн» — «шүүлтүүр засах»-д ОРОХГҮЙ.
            var existing = new List<RfExistingSchedule> { Ex(10, "Beam DN-2 Reinforcement", filter: "DN-2", gen: "DN-2", fromThis: true) };
            List<RfSyncRow> rows = RfSyncPlanner.Plan(new[] { "DN-2", "dn-2" }, Pat, Tpl, 1, existing);
            Assert.Eq(2, rows.Count(r => r.Status == RfSyncStatus.Conflict));
            Assert.Eq(0, rows.Count(r => r.Status == RfSyncStatus.WrongTarget));
        }

        [Test]
        public static void Sync_edge_space_value_is_a_conflict_with_the_trimmed_one()
        {
            var existing = new List<RfExistingSchedule> { Ex(10, "Beam DN-1 Reinforcement", filter: "DN-1", gen: "DN-1", fromThis: true) };
            List<RfSyncRow> rows = RfSyncPlanner.Plan(new[] { "DN-1", "DN-1 " }, Pat, Tpl, 1, existing);
            Assert.Eq(2, rows.Count(r => r.Status == RfSyncStatus.Conflict));
        }

        // ── «Нэр өөр» таних ─────────────────────────────────────────────

        [Test]
        public static void Sync_renamed_needs_a_marker_from_THIS_template()
        {
            // Гараар хийсэн (тэмдэглэгээгүй) ижил шүүлтүүртэй түүвэр → «Дутуу» хэвээр (өөр түүврийн нэрээр дам түүврийг орлуулахгүй).
            var handMade = new List<RfExistingSchedule> { Ex(20, "My column DN-1", filter: "DN-1") };
            Assert.Eq(RfSyncStatus.Missing, RfSyncPlanner.Plan(new[] { "DN-1" }, Pat, Tpl, 1, handMade)[0].Status);

            // Өөр эх түүвэр (Багана)-аас үүссэн.
            var other = new List<RfExistingSchedule> { Ex(21, "Column DN-1", filter: "DN-1", gen: "DN-1", fromThis: false) };
            Assert.Eq(RfSyncStatus.Missing, RfSyncPlanner.Plan(new[] { "DN-1" }, Pat, Tpl, 1, other)[0].Status);

            // Энэ эх түүврээс үүссэн, хэрэглэгч нэрийг нь өөрчилсөн.
            var mine = new List<RfExistingSchedule> { Ex(22, "Renamed by user", filter: "DN-1", gen: "DN-1", fromThis: true) };
            RfSyncRow row = RfSyncPlanner.Plan(new[] { "DN-1" }, Pat, Tpl, 1, mine)[0];
            Assert.Eq(RfSyncStatus.UpToDateRenamed, row.Status);
            Assert.Eq(22L, row.ScheduleId);
        }

        // ── Replace-ийн layout ──────────────────────────────────────────

        [Test]
        public static void Plan_replace_split_or_sheet_filtered_schedule_is_a_conflict()
        {
            foreach (var layout in new[] { new[] { 2, 0 }, new[] { 1, 1 } })
            {
                var existing = new List<RfExistingSchedule>
                {
                    Ex(10, "Beam DN-2 Reinforcement", filter: "DN-9", gen: "DN-9", fromThis: true, segments: layout[0], bySheet: layout[1] == 1, sheets: 1),
                };
                List<RfClonePlanItem> plan = RfClonePlanner.Plan(Chosen("DN-2"), Pat, Tpl, 1, existing, RfExistingPolicy.Replace, new[] { "DN-2" });
                Assert.Eq(RfCloneAction.Conflict, plan[0].Action);
                Assert.Eq(RfCloneReason.ReplaceUnsupportedLayout, plan[0].Reason);
            }
        }

        [Test]
        public static void Plan_replace_plain_schedule_still_replaces()
        {
            var existing = new List<RfExistingSchedule> { Ex(10, "Beam DN-2 Reinforcement", filter: "DN-9", gen: "DN-9", fromThis: true, sheets: 2) };
            List<RfClonePlanItem> plan = RfClonePlanner.Plan(Chosen("DN-2"), Pat, Tpl, 1, existing, RfExistingPolicy.Replace, new[] { "DN-2" });
            Assert.Eq(RfCloneAction.Replace, plan[0].Action);
            Assert.True(plan[0].Warnings.Contains(RfCloneWarn.ReplaceLosesSheetPlacements));
        }

        // ── Нэр, эрэмбэ ────────────────────────────────────────────────

        [Test]
        public static void Sanitize_replaces_every_forbidden_char_and_resolve_cannot_reexpand_tokens()
        {
            foreach (char ch in RfScheduleNames.InvalidChars)
            {
                string s = RfScheduleNames.Sanitize("a" + ch + "b");
                Assert.Eq("a_b", s, "хориотой тэмдэгт: " + ch);
            }
            // Partition утга нь токен агуулсан ч дахин задрахгүй (хаалт нь «_» болно).
            string name = RfScheduleNames.Resolve("X {Partition} {Template}", "T1", "{Template}");
            Assert.Eq("X _Template_ T1", name);
        }

        [Test]
        public static void Natural_comparer_is_a_consistent_total_order_on_random_input()
        {
            var rnd = new Random(12345);
            string[] atoms = { "DN-", "dn-", "ДН-", "дн-", "0", "00", "1", "2", "10", "100", "A", "a", "Ё", "ё", "Ө", "ү", " ", "_" };
            var items = new List<string>();
            for (int i = 0; i < 160; i++)
            {
                var sb = new System.Text.StringBuilder();
                int n = rnd.Next(1, 5);
                for (int k = 0; k < n; k++) sb.Append(atoms[rnd.Next(atoms.Length)]);
                items.Add(sb.ToString());
            }
            items = items.Distinct().ToList();
            var cmp = RfNaturalComparer.Instance;

            // Antisymmetry + transitivity (бүх гурвалжин).
            foreach (string a in items)
            {
                Assert.Eq(0, cmp.Compare(a, a));
                foreach (string b in items)
                {
                    int ab = cmp.Compare(a, b), ba = cmp.Compare(b, a);
                    Assert.Eq(Math.Sign(ab), -Math.Sign(ba), "antisymmetry: " + a + " / " + b);
                    if (ab == 0) Assert.Eq(a, b, "ялгаатай мөр тэнцүү гарч болохгүй");
                }
            }
            for (int i = 0; i < 4000; i++)
            {
                string a = items[rnd.Next(items.Count)], b = items[rnd.Next(items.Count)], c = items[rnd.Next(items.Count)];
                if (cmp.Compare(a, b) <= 0 && cmp.Compare(b, c) <= 0)
                    Assert.True(cmp.Compare(a, c) <= 0, "transitivity: " + a + " <= " + b + " <= " + c);
            }

            // Дараалал оролтын эрэмбээс үл хамаарна.
            var s1 = new List<string>(items); s1.Sort(cmp);
            var shuffled = items.OrderBy(_ => rnd.Next()).ToList(); shuffled.Sort(cmp);
            Assert.SeqEq(s1, shuffled);
        }
    }
}
