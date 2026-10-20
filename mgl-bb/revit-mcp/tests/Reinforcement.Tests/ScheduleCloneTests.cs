using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement.Tests
{
    public static class ScheduleCloneTests
    {
        private static string[] Sorted(params string[] values)
        {
            var l = new List<string>(values);
            l.Sort(RfNaturalComparer.Instance);
            return l.ToArray();
        }

        private static List<RfPartitionValue> Chosen(params string[] values)
        {
            return RfPartitionSet.Build(values).Values;
        }

        private static RfExistingSchedule Ex(long id, string name, bool compatible = true, string filter = null, int sheets = 0, string gen = null, bool fromThis = false)
        {
            return new RfExistingSchedule { Id = id, Name = name, Compatible = compatible, FilterValue = filter, SheetPlacements = sheets, GeneratedPartition = gen, GeneratedFromThisTemplate = fromThis };
        }

        // ── Байгалийн эрэмбэ ────────────────────────────────────────────

        [Test]
        public static void Natural_DN2_before_DN10()
        {
            Assert.SeqEq(new[] { "DN-1", "DN-2", "DN-10", "DN-100" }, Sorted("DN-100", "DN-10", "DN-2", "DN-1"));
        }

        [Test]
        public static void Natural_100_partitions_stay_numeric()
        {
            var all = Enumerable.Range(1, 120).Select(i => "DN-" + i).Reverse().ToArray();
            string[] s = Sorted(all);
            for (int i = 0; i < 120; i++) Assert.Eq("DN-" + (i + 1), s[i]);
        }

        [Test]
        public static void Natural_cyrillic_and_case_insensitive()
        {
            Assert.SeqEq(new[] { "ДН-1", "ДН-2", "ДН-10" }, Sorted("ДН-10", "ДН-2", "ДН-1"));
            // том/жижиг үсэг: эхлээд үсэг үл хамааран, дараа нь ordinal-аар тогтвортой.
            string[] s = Sorted("dn-2", "DN-1", "dn-1");
            Assert.Eq("DN-1", s[0]);
            Assert.Eq("dn-1", s[1]);
            Assert.Eq("dn-2", s[2]);
        }

        [Test]
        public static void Natural_leading_zeros_are_stable_not_merged()
        {
            string[] s = Sorted("DN-02", "DN-2", "DN-1");
            Assert.Eq("DN-1", s[0]);
            Assert.True(s.Contains("DN-02") && s.Contains("DN-2"), "ялгаатай утгууд нэгтгэгдсэнгүй");
        }

        [Test]
        public static void Natural_huge_digit_run_does_not_overflow()
        {
            Assert.True(RfNaturalComparer.Instance.Compare("A99999999999999999999999999999999999999", "A100000000000000000000000000000000000000") < 0);
        }

        // ── Partition олонлог ───────────────────────────────────────────

        [Test]
        public static void PartitionSet_distinct_blank_and_counts()
        {
            RfPartitionSet set = RfPartitionSet.Build(new[] { "DN-1", "DN-1", "DN-2", "", null, "   " });
            Assert.Eq(2, set.Values.Count);
            Assert.Eq(3, set.BlankCount);
            Assert.Eq(6, set.TotalRebars);
            Assert.Eq(2, set.Find("DN-1").RebarCount);
        }

        [Test]
        public static void PartitionSet_never_merges_different_engineer_values()
        {
            RfPartitionSet set = RfPartitionSet.Build(new[] { "DN-1", "dn-1", "DN-1 " });
            Assert.Eq(3, set.Values.Count, "ordinal-аар гурвуулаа тусдаа");
            Assert.True(set.Values.All(v => v.CaseOrSpaceCollision), "андуурагдах утгуудыг анхааруулна");
            Assert.True(set.Find("DN-1 ").HasEdgeWhitespace);
            Assert.False(set.Find("DN-1").HasEdgeWhitespace);
        }

        [Test]
        public static void PartitionSet_spaces_inside_are_preserved()
        {
            RfPartitionSet set = RfPartitionSet.Build(new[] { "Дам нуруу 1", "Дам нуруу 1" });
            Assert.Eq(1, set.Values.Count);
            Assert.Eq("Дам нуруу 1", set.Values[0].Value);
        }

        // ── Нэрийн загвар ───────────────────────────────────────────────

        [Test]
        public static void Names_suggest_pattern_from_template_name()
        {
            Assert.Eq("Beam {Partition} Reinforcement", RfScheduleNames.SuggestPattern("Beam DN-1 Reinforcement", "DN-1"));
            Assert.Eq("{Template} — {Partition}", RfScheduleNames.SuggestPattern("Хүснэгт", "DN-1"));
            // «DN-1» нь «DN-10» дотор тохиолдох ёсгүй
            Assert.Eq("{Template} — {Partition}", RfScheduleNames.SuggestPattern("Beam DN-10 list", "DN-1"));
            Assert.Eq("{Template} — {Partition}", RfScheduleNames.SuggestPattern("Beam list", null));
        }

        [Test]
        public static void Names_resolve_tokens_case_insensitive()
        {
            Assert.Eq("Beam DN-2 Reinforcement", RfScheduleNames.Resolve("Beam {partition} Reinforcement", "T", "DN-2"));
            Assert.Eq("T - ДН-3", RfScheduleNames.Resolve("{TEMPLATE} - {PARTITION}", "T", "ДН-3"));
        }

        [Test]
        public static void Names_invalid_characters_are_sanitized_in_value_only()
        {
            Assert.Eq("Beam DN_1 Reinforcement", RfScheduleNames.Resolve("Beam {Partition} Reinforcement", "T", "DN:1"));
            Assert.Eq("A_B_C", RfScheduleNames.Resolve("{Partition}", "T", "A{B}C"));
        }

        [Test]
        public static void Names_pattern_validation()
        {
            Assert.Eq(RfNameIssue.Empty, RfScheduleNames.Validate("  "));
            Assert.Eq(RfNameIssue.NoPartitionToken, RfScheduleNames.Validate("Beam reinforcement"));
            Assert.Eq(RfNameIssue.InvalidChars, RfScheduleNames.Validate("Beam: {Partition}"));
            Assert.Eq(RfNameIssue.None, RfScheduleNames.Validate("Beam {Partition} - {Template}"));
        }

        // ── Төлөвлөгөө ──────────────────────────────────────────────────

        [Test]
        public static void Plan_two_partitions_create()
        {
            var plan = RfClonePlanner.Plan(Chosen("DN-2", "DN-3"), "Beam {Partition} Reinforcement", "Beam DN-1 Reinforcement",
                1, new List<RfExistingSchedule> { Ex(1, "Beam DN-1 Reinforcement", filter: "DN-1") }, RfExistingPolicy.Skip);
            Assert.Eq(2, plan.Count);
            Assert.True(plan.All(p => p.Action == RfCloneAction.Create));
            Assert.Eq("Beam DN-2 Reinforcement", plan[0].ProposedName);
        }

        [Test]
        public static void Plan_template_itself_is_skipped_never_duplicated()
        {
            var plan = RfClonePlanner.Plan(Chosen("DN-1", "DN-2"), "Beam {Partition} Reinforcement", "Beam DN-1 Reinforcement",
                1, new List<RfExistingSchedule> { Ex(1, "Beam DN-1 Reinforcement", filter: "DN-1") }, RfExistingPolicy.Replace);
            Assert.Eq(RfCloneAction.Skip, plan[0].Action);
            Assert.Eq(RfCloneReason.IsTemplate, plan[0].Reason);
            Assert.Eq(RfCloneAction.Create, plan[1].Action);
        }

        [Test]
        public static void Plan_existing_correct_is_uptodate_under_skip_and_update()
        {
            var existing = new List<RfExistingSchedule> { Ex(1, "T DN-1", filter: "DN-1"), Ex(5, "Beam DN-2 Reinforcement", filter: "DN-2") };
            foreach (RfExistingPolicy pol in new[] { RfExistingPolicy.Skip, RfExistingPolicy.UpdateFilter })
            {
                var plan = RfClonePlanner.Plan(Chosen("DN-2"), "Beam {Partition} Reinforcement", "T DN-1", 1, existing, pol);
                Assert.Eq(RfCloneAction.UpToDate, plan[0].Action, pol.ToString());
                Assert.Eq(5L, plan[0].ExistingId);
            }
        }

        [Test]
        public static void Plan_wrong_filter_follows_policy()
        {
            // Энэ хэрэгслийн үүсгэсэн (gen != null) түүвэр: Skip / UpdateFilter / Replace гурвуулаа.
            var existing = new List<RfExistingSchedule> { Ex(1, "T DN-1", filter: "DN-1"), Ex(5, "Beam DN-2 Reinforcement", filter: "DN-9", gen: "DN-9") };
            Assert.Eq(RfCloneAction.Skip, RfClonePlanner.Plan(Chosen("DN-2"), "Beam {Partition} Reinforcement", "T DN-1", 1, existing, RfExistingPolicy.Skip)[0].Action);
            Assert.Eq(RfCloneAction.UpdateFilter, RfClonePlanner.Plan(Chosen("DN-2"), "Beam {Partition} Reinforcement", "T DN-1", 1, existing, RfExistingPolicy.UpdateFilter)[0].Action);
            Assert.Eq(RfCloneAction.Replace, RfClonePlanner.Plan(Chosen("DN-2"), "Beam {Partition} Reinforcement", "T DN-1", 1, existing, RfExistingPolicy.Replace)[0].Action);
        }

        [Test]
        public static void Plan_replace_never_deletes_a_hand_made_schedule()
        {
            // Хэрэглэгчийн ГАРААР хийсэн түүвэр (gen == null): «Солих» → Мөргөлдөөн (ReplaceNotOwned); «Filter шинэчлэх» боломжтой хэвээр.
            var mine = new List<RfExistingSchedule> { Ex(5, "Beam DN-2 Reinforcement", filter: "DN-9") };
            var rep = RfClonePlanner.Plan(Chosen("DN-2"), "Beam {Partition} Reinforcement", "T", 1, mine, RfExistingPolicy.Replace)[0];
            Assert.Eq(RfCloneAction.Conflict, rep.Action);
            Assert.Eq(RfCloneReason.ReplaceNotOwned, rep.Reason);
            Assert.Eq(RfCloneAction.UpdateFilter, RfClonePlanner.Plan(Chosen("DN-2"), "Beam {Partition} Reinforcement", "T", 1, mine, RfExistingPolicy.UpdateFilter)[0].Action);

            // Шүүлтүүр нь аль хэдийн зөв гараар хийсэн түүвэр: «Солих»-д ч ХӨНДӨХГҮЙ (UpToDate).
            var okMine = new List<RfExistingSchedule> { Ex(5, "Beam DN-2 Reinforcement", filter: "DN-2") };
            Assert.Eq(RfCloneAction.UpToDate, RfClonePlanner.Plan(Chosen("DN-2"), "Beam {Partition} Reinforcement", "T", 1, okMine, RfExistingPolicy.Replace)[0].Action);
        }

        [Test]
        public static void Plan_replace_warns_about_sheet_placements()
        {
            var existing = new List<RfExistingSchedule> { Ex(5, "Beam DN-2 Reinforcement", filter: "DN-9", sheets: 2, gen: "DN-9") };
            var item = RfClonePlanner.Plan(Chosen("DN-2"), "Beam {Partition} Reinforcement", "T", 1, existing, RfExistingPolicy.Replace)[0];
            Assert.True(item.Warnings.Contains(RfCloneWarn.ReplaceLosesSheetPlacements));
            Assert.Eq(2, item.SheetPlacements);
        }

        [Test]
        public static void Plan_name_taken_by_unrelated_schedule_is_conflict_not_overwritten()
        {
            var existing = new List<RfExistingSchedule> { Ex(7, "Beam DN-2 Reinforcement", compatible: false) };
            foreach (RfExistingPolicy pol in new[] { RfExistingPolicy.Skip, RfExistingPolicy.UpdateFilter, RfExistingPolicy.Replace })
            {
                var item = RfClonePlanner.Plan(Chosen("DN-2"), "Beam {Partition} Reinforcement", "T", 1, existing, pol)[0];
                Assert.Eq(RfCloneAction.Conflict, item.Action, pol.ToString());
                Assert.Eq(RfCloneReason.NameTakenByOther, item.Reason);
            }
        }

        [Test]
        public static void Plan_name_matching_is_case_insensitive()
        {
            var existing = new List<RfExistingSchedule> { Ex(5, "BEAM dn-2 REINFORCEMENT", filter: "DN-2") };
            var item = RfClonePlanner.Plan(Chosen("DN-2"), "Beam {Partition} Reinforcement", "T", 1, existing, RfExistingPolicy.Skip)[0];
            Assert.Eq(RfCloneAction.UpToDate, item.Action);
        }

        [Test]
        public static void Plan_two_partitions_resolving_to_same_name_conflict()
        {
            // «DN:1» ба «DN;1» хоёул «DN_1» болно.
            var plan = RfClonePlanner.Plan(Chosen("DN:1", "DN;1"), "{Partition}", "T", 1, new List<RfExistingSchedule>(), RfExistingPolicy.Skip);
            Assert.Eq(RfCloneAction.Create, plan[0].Action);
            Assert.Eq(RfCloneAction.Conflict, plan[1].Action);
            Assert.Eq(RfCloneReason.DuplicateName, plan[1].Reason);
        }

        [Test]
        public static void Plan_bad_pattern_makes_every_item_conflict()
        {
            var plan = RfClonePlanner.Plan(Chosen("DN-1", "DN-2"), "no token", "T", 1, new List<RfExistingSchedule>(), RfExistingPolicy.Skip);
            Assert.True(plan.All(p => p.Action == RfCloneAction.Conflict && p.Reason == RfCloneReason.InvalidName));
        }

        [Test]
        public static void Plan_100_plus_partitions_scales()
        {
            var raw = Enumerable.Range(1, 250).Select(i => "DN-" + i).ToList();
            var existing = new List<RfExistingSchedule> { Ex(1, "Beam DN-1 Reinforcement", filter: "DN-1") };
            for (int i = 2; i <= 40; i++) existing.Add(Ex(100 + i, "Beam DN-" + i + " Reinforcement", filter: "DN-" + i));
            var sw = System.Diagnostics.Stopwatch.StartNew();
            var plan = RfClonePlanner.Plan(RfPartitionSet.Build(raw).Values, "Beam {Partition} Reinforcement", "Beam DN-1 Reinforcement", 1, existing, RfExistingPolicy.Skip);
            sw.Stop();
            Assert.Eq(250, plan.Count);
            Assert.Eq(1, plan.Count(p => p.Action == RfCloneAction.Skip));
            Assert.Eq(39, plan.Count(p => p.Action == RfCloneAction.UpToDate));
            Assert.Eq(210, plan.Count(p => p.Action == RfCloneAction.Create));
            Assert.True(sw.ElapsedMilliseconds < 500, "төлөвлөлт удаан: " + sw.ElapsedMilliseconds + " мс");
        }

        // ── Синк ────────────────────────────────────────────────────────

        [Test]
        public static void Sync_reports_every_status_and_never_flags_unrelated_schedules()
        {
            var existing = new List<RfExistingSchedule>
            {
                Ex(1, "Beam DN-1 Reinforcement", filter: "DN-1"),                      // загвар
                Ex(2, "Beam DN-2 Reinforcement", filter: "DN-2"),                      // зөв
                Ex(3, "Beam DN-3 Reinforcement", filter: "DN-7"),                      // буруу зорилт
                Ex(4, "My custom DN-4 list", filter: "DN-4", gen: "DN-4", fromThis: true), // ЭНЭ эх түүврээс үүссэн, нэр нь өөрчлөгдсөн — давхар үүсгэхгүй
                Ex(5, "Beam DN-6 Reinforcement", compatible: false),                   // нэр өөр төрлийн хүснэгтэд
                Ex(6, "Beam DN-9 Reinforcement", filter: "DN-9", gen: "DN-9"),         // загварт DN-9 үгүй болсон
                Ex(7, "Some unrelated rebar schedule", filter: null),                   // хэрэглэгчийн — ХӨНДӨХГҮЙ
            };
            var parts = new List<string> { "DN-1", "DN-2", "DN-3", "DN-4", "DN-5", "DN-6" };
            var rows = RfSyncPlanner.Plan(parts, "Beam {Partition} Reinforcement", "Beam DN-1 Reinforcement", 1, existing);

            Func<string, RfSyncStatus> st = p => rows.First(r => r.Partition == p && r.Status != RfSyncStatus.Orphan).Status;
            Assert.Eq(RfSyncStatus.UpToDate, st("DN-1"));
            Assert.Eq(RfSyncStatus.UpToDate, st("DN-2"));
            Assert.Eq(RfSyncStatus.WrongTarget, st("DN-3"));
            Assert.Eq(RfSyncStatus.UpToDateRenamed, st("DN-4"));
            Assert.Eq(RfSyncStatus.Missing, st("DN-5"));
            Assert.Eq(RfSyncStatus.Conflict, st("DN-6"));

            var orphans = rows.Where(r => r.Status == RfSyncStatus.Orphan).ToList();
            Assert.Eq(1, orphans.Count);
            Assert.Eq(6L, orphans[0].ScheduleId);
            Assert.False(rows.Any(r => r.ScheduleId == 7), "хэрэглэгчийн хүснэгтийг хөндөөгүй");
        }

        [Test]
        public static void Sync_template_is_never_offered_for_filter_fix()
        {
            // Нэрийн загвар эх түүврийн нэртэй давхцаж, эх түүврийн шүүлтүүр өөр Partition-д: «Шүүлтүүр засах»-д ОРОХГҮЙ.
            var existing = new List<RfExistingSchedule> { Ex(1, "Beam DN-2 Reinforcement", filter: "DN-1") };
            var rows = RfSyncPlanner.Plan(new List<string> { "DN-2" }, "Beam {Partition} Reinforcement", "Beam DN-2 Reinforcement", 1, existing);
            Assert.Eq(RfSyncStatus.Conflict, rows[0].Status);
            Assert.False(rows.Any(r => r.Status == RfSyncStatus.WrongTarget));
        }

        [Test]
        public static void Sync_orphan_by_pattern_without_metadata()
        {
            var existing = new List<RfExistingSchedule>
            {
                Ex(1, "Beam DN-1 Reinforcement", filter: "DN-1"),
                Ex(8, "Beam DN-8 Reinforcement", filter: "DN-8"), // метадатагүй, гэхдээ нэр нь загвартай таарна
            };
            var rows = RfSyncPlanner.Plan(new List<string> { "DN-1" }, "Beam {Partition} Reinforcement", "Beam DN-1 Reinforcement", 1, existing);
            Assert.Eq(1, rows.Count(r => r.Status == RfSyncStatus.Orphan && r.ScheduleId == 8));
        }
    }
}
