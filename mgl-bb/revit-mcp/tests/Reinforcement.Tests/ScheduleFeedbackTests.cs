using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement.Tests
{
    /// <summary>
    /// Инженерийн санал (2026-10-02) — «Түүвэр хувилах»: «Түүврийн нэрийн загвар» нь ТОДОРХОЙ болсон (бодит нэрийн томьёогоор жишээ), нэр мөргөлдөх үед
    /// хамааралгүй түүврийг ХЭЗЭЭ Ч дарахгүй.  (Эх түүврийн хайлт: <see cref="SearchTests"/>.)
    /// </summary>
    public static class ScheduleFeedbackTests
    {
        private static List<RfPartitionValue> Chosen(params string[] values)
        {
            return values.Select(v => new RfPartitionValue { Value = v, RebarCount = 1 }).ToList();
        }

        [Test]
        public static void Naming_example_partition_prefers_the_chosen_row()
        {
            string p = RfScheduleNames.PickExamplePartition(new[] { "DN-4" }, new[] { "DN-1", "DN-2", "DN-4" }, "DN-1");
            Assert.Eq("DN-4", p);
        }

        [Test]
        public static void Naming_example_partition_skips_the_template_own_value_and_blanks()
        {
            Assert.Eq("DN-2", RfScheduleNames.PickExamplePartition(new string[0], new[] { "DN-1", "DN-2" }, "DN-1"), "эх түүврийн өөрийн Partition-ийг алгасна");
            Assert.Eq("DN-2", RfScheduleNames.PickExamplePartition(new[] { "", "  " }, new[] { "", "DN-1", "DN-2" }, "DN-1"));
            Assert.Eq("DN-1", RfScheduleNames.PickExamplePartition(null, new[] { "DN-1" }, "DN-1"), "өөр сонголт байхгүй бол ганц Partition");
            Assert.True(RfScheduleNames.PickExamplePartition(null, new string[0], "DN-1") == null, "Partition огт байхгүй");
        }

        [Test]
        public static void Naming_example_uses_the_real_formatter_and_matches_the_planned_schedule_name()
        {
            // Жишээ нэр = бодит нэрийн томьёо (Resolve); «Үүсгэх» дарахад үүсэх түүврийн нэртэй (planner-ийн ProposedName) ЯГ ИЖИЛ.
            string pattern = "Beam {Partition} Reinforcement";
            string template = "Beam DN-1 Reinforcement";
            string example = RfScheduleNames.Resolve(pattern, template, "DN-2");
            RfClonePlanItem planned = RfClonePlanner.Plan(Chosen("DN-2"), pattern, template, 1, new List<RfExistingSchedule>(), RfExistingPolicy.Skip)[0];
            Assert.Eq("Beam DN-2 Reinforcement", example);
            Assert.Eq(example, planned.ProposedName);
        }

        [Test]
        public static void Naming_default_pattern_is_derived_from_the_source_name_and_both_tokens_work()
        {
            string pattern = RfScheduleNames.SuggestPattern("Beam DN-1 Reinforcement", "DN-1");
            Assert.Eq("Beam {Partition} Reinforcement", pattern);
            Assert.Eq("Beam DN-5 Reinforcement", RfScheduleNames.Resolve(pattern, "Beam DN-1 Reinforcement", "DN-5"));
            // Эх нэр Partition-ыг агуулаагүй бол: «{Template} — {Partition}».
            string fallback = RfScheduleNames.SuggestPattern("Арматурын түүвэр", "DN-1");
            Assert.Eq("{Template} — {Partition}", fallback);
            Assert.Eq("Арматурын түүвэр — DN-3", RfScheduleNames.Resolve(fallback, "Арматурын түүвэр", "DN-3"));
        }

        [Test]
        public static void Naming_tokens_are_case_insensitive_and_unsafe_characters_become_underscores()
        {
            Assert.Eq("Beam DN-2", RfScheduleNames.Resolve("Beam {partition}", "T", "DN-2"));
            Assert.Eq("Beam DN_1", RfScheduleNames.Resolve("Beam {Partition}", "T", "DN:1"), "хориотой тэмдэгт «_» болно");
        }

        [Test]
        public static void Naming_collision_with_an_unrelated_schedule_never_overwrites_it()
        {
            // «Beam DN-2 Reinforcement» нэр өөр (гараар хийсэн, Rebar биш) түүвэрт эзлэгдсэн: гурван бодлогоор ч ДАРАХГҮЙ (Мөргөлдөөн).
            string pattern = "Beam {Partition} Reinforcement";
            var existing = new List<RfExistingSchedule> { new RfExistingSchedule { Id = 7, Name = "Beam DN-2 Reinforcement", Compatible = false } };
            foreach (RfExistingPolicy pol in new[] { RfExistingPolicy.Skip, RfExistingPolicy.UpdateFilter, RfExistingPolicy.Replace })
            {
                RfClonePlanItem it = RfClonePlanner.Plan(Chosen("DN-2"), pattern, "Beam DN-1 Reinforcement", 1, existing, pol)[0];
                Assert.Eq(RfCloneAction.Conflict, it.Action, pol.ToString());
                Assert.Eq(RfCloneReason.NameTakenByOther, it.Reason);
                Assert.Eq("Beam DN-2 Reinforcement", it.ProposedName, "урьдчилан харахад нэр харагдаж, мөргөлдөөн нь ИЛ");
            }
        }

        [Test]
        public static void Naming_preview_lists_every_target_name_before_anything_is_created()
        {
            var plan = RfClonePlanner.Plan(Chosen("DN-2", "DN-3", "DN-10"), "{Partition}", "T", 1, new List<RfExistingSchedule>(), RfExistingPolicy.Skip);
            Assert.SeqEq(new[] { "DN-2", "DN-3", "DN-10" }, plan.Select(p => p.ProposedName));
            Assert.True(plan.All(p => p.Action == RfCloneAction.Create));
        }
    }
}
