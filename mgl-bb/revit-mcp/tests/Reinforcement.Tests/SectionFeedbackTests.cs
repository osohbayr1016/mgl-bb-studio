using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement.Tests
{
    /// <summary>
    /// Инженерийн санал (2026-10-02) — «Огтлолын арматурын тэмдэглэгээ»: tag ба хэмжээсийн ТӨЛӨВЛӨГӨӨ, эзэн элементийн сонголтын бодлого,
    /// хуурамч (лавлагаа шугам) хэмжээс ХЭЗЭЭ Ч төлөвлөгдөхгүй байх баталгаа.
    /// ⚠️ Revit дээр бодит Dimension / IndependentTag үүсэх нь ЭНД батлагдахгүй (REQUIRES REVIT QA).
    /// </summary>
    public static class SectionFeedbackTests
    {
        private const double Mm = 1.0 / 304.8;

        private static RfSectionInput BeamWithBars(bool tagLong, bool tagStir, bool group, params string[] groups)
        {
            var input = new RfSectionInput { View = new RfViewFrame(new RfV3(0, 0, 0), new RfV3(1, 0, 0), new RfV3(0, 1, 0), new RfV3(0, 0, 1)) };
            input.Faces.Add(new RfFaceSample { Id = 1, Origin = new RfV2(-150 * Mm, 0), Normal = new RfV2(-1, 0), Area = 500 * 3000 * Mm * Mm });
            input.Faces.Add(new RfFaceSample { Id = 2, Origin = new RfV2(150 * Mm, 0), Normal = new RfV2(1, 0), Area = 500 * 3000 * Mm * Mm });
            input.Faces.Add(new RfFaceSample { Id = 3, Origin = new RfV2(0, -250 * Mm), Normal = new RfV2(0, -1), Area = 300 * 3000 * Mm * Mm });
            input.Faces.Add(new RfFaceSample { Id = 4, Origin = new RfV2(0, 250 * Mm), Normal = new RfV2(0, 1), Area = 300 * 3000 * Mm * Mm });
            var s = new RfBarSample { Id = 77, BarIndex = 0, Diameter = 8 * Mm };
            double hw = 120 * Mm, hh = 220 * Mm;
            foreach (double[] q in new[] { new[] { -hw, -hh }, new[] { hw, -hh }, new[] { hw, hh }, new[] { -hw, hh }, new[] { -hw, -hh } })
                s.Points.Add(new RfV3(q[0], q[1], 0));
            input.Stirrups.Add(s);
            for (int i = 0; i < groups.Length; i++)
                input.Longitudinal.Add(new RfLongBar { Id = 100 + i, Pos = new RfV2((-80 + 80 * i) * Mm, -200 * Mm), Diameter = 20 * Mm, Group = groups[i] });
            input.Options.TagLongitudinal = tagLong;
            input.Options.TagStirrups = tagStir;
            input.Options.GroupTags = group;
            input.Options.DimOffsetFt = 100 * Mm;
            return input;
        }

        // ── Tag ─────────────────────────────────────────────────────────

        [Test]
        public static void Tag_enabled_plans_tag_operations_for_longitudinal_and_stirrups()
        {
            RfSectionPlan plan = RfSectionPlanner.Build(BeamWithBars(true, true, false, "", ""));
            Assert.Eq(2, plan.Tags.Count(t => !t.IsStirrup), "ажлын арматур бүрд tag");
            Assert.Eq(1, plan.Tags.Count(t => t.IsStirrup), "хомутад tag");
            Assert.True(plan.HasContent);
        }

        [Test]
        public static void Tag_disabled_plans_no_tag_operations()
        {
            RfSectionPlan plan = RfSectionPlanner.Build(BeamWithBars(false, false, false, "", ""));
            Assert.Eq(0, plan.Tags.Count);
            Assert.True(plan.Dims.Count > 0, "хэмжээс хэвээр (tag-аас үл хамаарна)");
        }

        [Test]
        public static void Tag_longitudinal_only_and_stirrups_only_are_independent()
        {
            RfSectionPlan longOnly = RfSectionPlanner.Build(BeamWithBars(true, false, false, "", ""));
            Assert.True(longOnly.Tags.All(t => !t.IsStirrup) && longOnly.Tags.Count == 2);
            RfSectionPlan stirOnly = RfSectionPlanner.Build(BeamWithBars(false, true, false, "", ""));
            Assert.True(stirOnly.Tags.All(t => t.IsStirrup) && stirOnly.Tags.Count == 1);
        }

        [Test]
        public static void Tag_different_rebar_numbers_are_never_merged()
        {
            string baseKey = RfSectionGeometry.BarGroupKey(1, 20 * Mm, 5);
            string n1 = RfSectionGeometry.NumberedGroupKey(baseKey, "1", "");
            string n2 = RfSectionGeometry.NumberedGroupKey(baseKey, "2", "");
            Assert.True(n1 != n2, "өөр Rebar Number — өөр түлхүүр");
            // Нэг бүлэглэлттэй (GroupTags) ч өөр дугаартай хоёр арматурыг НЭГ tag болгохгүй.
            RfSectionPlan plan = RfSectionPlanner.Build(BeamWithBars(true, false, true, n1, n2));
            Assert.Eq(2, plan.Tags.Count(t => !t.IsStirrup), "өөр дугаар ⇒ 2 tag");
            Assert.True(plan.Tags.All(t => t.GroupCount == 1));
        }

        [Test]
        public static void Tag_same_rebar_number_on_the_same_side_is_grouped_into_one_tag()
        {
            string key = RfSectionGeometry.NumberedGroupKey(RfSectionGeometry.BarGroupKey(1, 20 * Mm, 5), "7", "");
            RfSectionPlan plan = RfSectionPlanner.Build(BeamWithBars(true, false, true, key, key, key));
            List<RfTagPlan> t = plan.Tags.Where(x => !x.IsStirrup).ToList();
            Assert.Eq(1, t.Count, "ижил дугаар + ижил тал ⇒ нэг tag");
            Assert.Eq(3, t[0].GroupCount);
        }

        [Test]
        public static void Tag_partition_is_part_of_the_merge_key()
        {
            string b = RfSectionGeometry.BarGroupKey(1, 20 * Mm, 5);
            Assert.True(RfSectionGeometry.NumberedGroupKey(b, "1", "DN-1") != RfSectionGeometry.NumberedGroupKey(b, "1", "DN-2"),
                "Rebar Number нь ӨӨРИЙН Partition дотор л давтагдахгүй — өөр Partition ⇒ өөр арматур");
        }

        // ── Эзэн элементийн сонголт ─────────────────────────────────────

        [Test]
        public static void HostPick_one_valid_preselected_host_is_used_without_asking_again()
        {
            Assert.Eq(RfHostPickAction.UsePreselected, RfHostPick.Decide(1));
        }

        [Test]
        public static void HostPick_no_valid_preselection_asks_the_user_to_pick()
        {
            Assert.Eq(RfHostPickAction.PromptPick, RfHostPick.Decide(0));
        }

        [Test]
        public static void HostPick_several_valid_preselected_hosts_never_pick_an_arbitrary_one()
        {
            Assert.Eq(RfHostPickAction.PromptPickAmbiguous, RfHostPick.Decide(2));
            Assert.Eq(RfHostPickAction.PromptPickAmbiguous, RfHostPick.Decide(7));
        }

        [Test]
        public static void HostPick_rejects_random_model_elements_and_non_hosts()
        {
            Assert.True(RfHostPick.Accepts(true, true), "дам нуруу/багана + host боломжтой");
            Assert.False(RfHostPick.Accepts(false, true), "ханан/шал г.м. — өөр ангилал");
            Assert.False(RfHostPick.Accepts(true, false), "дам нуруу боловч арматур агуулах боломжгүй");
            Assert.False(RfHostPick.Accepts(false, false));
        }

        [Test]
        public static void HostPick_describe_uses_mark_type_and_category_not_a_raw_id()
        {
            Assert.Eq("B-12 · RC Beam : 300x500  [Structural Framing]", RfHostPick.Describe("B-12", "RC Beam", "300x500", "Structural Framing"));
            Assert.Eq("300x500  [Structural Columns]", RfHostPick.Describe("", "", "300x500", "Structural Columns"));
            Assert.Eq("K-3 · Column A", RfHostPick.Describe("K-3", "", "Column A", ""));
            Assert.Eq("K-3 · same", RfHostPick.Describe("K-3", "Same", "same", ""), "family = type ⇒ нэг удаа");
            Assert.Eq("", RfHostPick.Describe(null, null, null, null));
        }

        // ── Хуурамч лавлагааны шугам ХЭЗЭЭ Ч төлөвлөгдөхгүй ───────────────

        [Test]
        public static void Plan_has_no_synthetic_witness_line_operation_only_face_and_stirrup_references()
        {
            // Гинжний лавлагаа зөвхөн «бетон нүүр» эсвэл «хомутын (арматурын) ирмэг» — лавлагаа шугам (Proxy/Witness) гэсэн төрөл БАЙХГҮЙ.
            Assert.SeqEq(new[] { "Face", "Stirrup" }, Enum.GetNames(typeof(RfChainRefKind)));
            RfSectionPlan plan = RfSectionPlanner.Build(BeamWithBars(true, true, false, "", ""));
            Assert.True(plan.Chains.SelectMany(c => c.Refs).All(r => r.Kind == RfChainRefKind.Face || r.Kind == RfChainRefKind.Stirrup));
            Assert.True(plan.Chains.SelectMany(c => c.Refs).Where(r => r.Kind == RfChainRefKind.Stirrup).All(r => r.StirrupId == 77), "хомутын лавлагаа арматурын бодит элементээс");
        }

        [Test]
        public static void Renderer_source_never_creates_detail_curves_or_invisible_lines()
        {
            // Эх кодын хамгаалалт: хэмжээсийн лавлагаа шугамыг ДАХИН нэвтрүүлэхээс сэргийлнэ (инженерийн тодорхой шаардлага).
            string src = ReadAddinSource("Revit/RfSectionRenderer.cs");
            foreach (string banned in new[]
            {
                "NewDetailCurve", "NewDetailLine", "NewModelCurve", "NewLineBoundary", "NewReferencePlane", "TextNote.Create", "NewFamilyInstance",
                "OST_InvisibleLines", "ProxyLineRenderer", "InvisibleStyle", "DetailCurve dc", "SketchPlane.Create",
            })
                Assert.False(src.Contains(banned), "RfSectionRenderer.cs-д «" + banned + "» байж болохгүй");
            string svc = ReadAddinSource("Revit/RfSectionService.cs");
            Assert.False(svc.Contains("OST_InvisibleLines"), "RfSectionService.cs-д үл үзэгдэх шугамын хэв маяг үлдэх ёсгүй");
        }

        private static string ReadAddinSource(string relative)
        {
            string dir = AppContext.BaseDirectory;
            for (int i = 0; i < 12 && dir != null; i++)
            {
                string candidate = Path.Combine(dir, "addin", "Reinforcement", relative.Replace('/', Path.DirectorySeparatorChar));
                if (File.Exists(candidate)) return File.ReadAllText(candidate);
                string up = Path.Combine(dir, "..", "..", "addin", "Reinforcement", relative.Replace('/', Path.DirectorySeparatorChar));
                if (File.Exists(up)) return File.ReadAllText(up);
                dir = Path.GetDirectoryName(dir);
            }
            throw new AssertFailed("addin/Reinforcement/" + relative + " олдсонгүй");
        }
    }
}
