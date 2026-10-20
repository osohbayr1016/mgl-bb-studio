using System;
using System.Collections.Generic;
using RevitMcpAddin.CloneDrawings.Core;

namespace RevitMcpAddin.CloneDrawings.Tests
{
    public static class ViewRelevanceTests
    {
        private static ViewFacts Dedicated(int tplRefs = 3) => new ViewFacts { Dedicated = true, TemplateCentered = true, TemplateRefs = tplRefs };

        [Test]
        public static void OwnSectionOfTheBeamStaysOwn()
        {
            // B1-ийн уртын зүсэлт: төв нь дам нуруун дээр, баганууд захад (тэдний хэмжээс олон ч төвд биш).
            Assert.Eq(ViewRelevance.Own, ViewRelevanceRule.Classify(Dedicated(3)));
        }

        [Test]
        public static void CloneMadeForAnotherTargetIsOther()
        {
            // 2026-10-01-ний гол шалтгаан: B2-д клонлосон харагдацад B1 хөрш болж tag-лагдсан — тэр нь B1-ийн зураг БИШ.
            ViewFacts f = Dedicated(9);
            f.CloneOfOther = true;
            Assert.Eq(ViewRelevance.Other, ViewRelevanceRule.Classify(f));
            f.ByName = true; // нэрэнд B1 орсон байсан ч (ReplaceMark унтраалттай үеийн нэр) — клон бүртгэл илүү хүчтэй
            Assert.Eq(ViewRelevance.Other, ViewRelevanceRule.Classify(f));
        }

        [Test]
        public static void CloneMadeForTheTemplateItselfIsOwn()
        {
            ViewFacts f = Dedicated(0);
            f.CloneOfTemplate = true;
            f.OtherCentered = true;
            f.OtherCenteredRefs = 10;
            Assert.Eq(ViewRelevance.Own, ViewRelevanceRule.Classify(f));
        }

        [Test]
        public static void ManualLinkAlwaysOwn()
        {
            var f = new ViewFacts { Manual = true, CloneOfOther = true, Dedicated = false };
            Assert.Eq(ViewRelevance.Own, ViewRelevanceRule.Classify(f));
        }

        [Test]
        public static void LargeViewIsGeneral()
        {
            var f = new ViewFacts { Dedicated = false, TemplateRefs = 1 };
            Assert.Eq(ViewRelevance.General, ViewRelevanceRule.Classify(f));
            f.ByName = true; // «B1-B5 дам нурууны фасад» — нэрэнд B1 ч хүрээ том
            Assert.Eq(ViewRelevance.General, ViewRelevanceRule.Classify(f));
        }

        [Test]
        public static void ColumnSectionShowingTheBeamIsOther()
        {
            // Баганы C1 зүсэлт: төв нь баганан дээр, дам нуруу дээд захад (төвд биш).
            var f = new ViewFacts { Dedicated = true, TemplateCentered = false, TemplateRefs = 1, OtherCentered = true, OtherCenteredRefs = 5 };
            Assert.Eq(ViewRelevance.Other, ViewRelevanceRule.Classify(f));
        }

        [Test]
        public static void BothCenteredMoreAnnotationsWins()
        {
            // Баганы план callout: дам нурууны үзүүр ч төвд — гэхдээ баганын хэмжээс олон.
            var f = new ViewFacts { Dedicated = true, TemplateCentered = true, TemplateRefs = 1, OtherCentered = true, OtherCenteredRefs = 6 };
            Assert.Eq(ViewRelevance.Other, ViewRelevanceRule.Classify(f));
            f.OtherCenteredRefs = 1; // тэнцүү бол загвар давуу
            Assert.Eq(ViewRelevance.Own, ViewRelevanceRule.Classify(f));
        }

        [Test]
        public static void CalloutOfOwnViewStaysOwn()
        {
            var f = new ViewFacts { Dedicated = true, TemplateCentered = true, TemplateRefs = 1, OtherCentered = true, OtherCenteredRefs = 6, ParentIsOwn = true };
            Assert.Eq(ViewRelevance.Own, ViewRelevanceRule.Classify(f));
        }

        [Test]
        public static void NameRulesBeatGeometry()
        {
            var f = new ViewFacts { Dedicated = true, TemplateCentered = true, TemplateRefs = 4, NamedForOther = true };
            Assert.Eq(ViewRelevance.Other, ViewRelevanceRule.Classify(f));
            f.ByName = true; // нэрэнд B1 ч, C1 ч — B1 давуу
            Assert.Eq(ViewRelevance.Own, ViewRelevanceRule.Classify(f));
        }

        [Test]
        public static void OnlyOwnIsSelectedByDefault()
        {
            Assert.True(ViewRelevanceRule.DefaultSelected(ViewRelevance.Own));
            Assert.False(ViewRelevanceRule.DefaultSelected(ViewRelevance.General));
            Assert.False(ViewRelevanceRule.DefaultSelected(ViewRelevance.Other));
        }
    }

    public static class ViewFilterTests
    {
        [Test]
        public static void TypeGroups()
        {
            Assert.Eq(ViewTypeGroups.Plan, ViewTypeGroups.Of("FloorPlan", false));
            Assert.Eq(ViewTypeGroups.Plan, ViewTypeGroups.Of("EngineeringPlan", false));
            Assert.Eq(ViewTypeGroups.Detail, ViewTypeGroups.Of("FloorPlan", true));
            Assert.Eq(ViewTypeGroups.Section, ViewTypeGroups.Of("Section", false));
            Assert.Eq(ViewTypeGroups.Detail, ViewTypeGroups.Of("Section", true));
            Assert.Eq(ViewTypeGroups.Detail, ViewTypeGroups.Of("Detail", false));
            Assert.Eq(ViewTypeGroups.Elevation, ViewTypeGroups.Of("Elevation", false));
            Assert.Eq(ViewTypeGroups.ThreeD, ViewTypeGroups.Of("ThreeD", false));
            Assert.Eq(ViewTypeGroups.Other, ViewTypeGroups.Of("DraftingView", false));
        }

        [Test]
        public static void SearchAllTokensAnyField()
        {
            Assert.True(ViewSearch.Matches(null, "B1 - Зүсэлт"));
            Assert.True(ViewSearch.Matches("  ", "B1 - Зүсэлт"));
            Assert.True(ViewSearch.Matches("зүсэлт", "B1 - Зүсэлт 1-1"));
            Assert.True(ViewSearch.Matches("зүс b1", "B1 - Зүсэлт 1-1"));
            Assert.True(ViewSearch.Matches("s-201", "B1 - Зүсэлт", "S-201"));
            Assert.False(ViewSearch.Matches("план", "B1 - Зүсэлт", "S-201"));
            Assert.False(ViewSearch.Matches("зүсэлт план", "B1 - Зүсэлт"));
        }

        [Test]
        public static void SearchFoldsCyrillicLatinLookalikes()
        {
            // Кирилл «В1» ба латин «B1».
            Assert.True(ViewSearch.Matches("b1", "В1 - фасад"));
            Assert.True(ViewSearch.Matches("в1", "B1 - фасад"));
        }

        [Test]
        public static void RecentSetKeepsLastAndCaps()
        {
            var list = new List<string>();
            RecentSet.Set(list, "a", true, 3);
            RecentSet.Set(list, "b", true, 3);
            RecentSet.Set(list, "a", true, 3);
            Assert.Eq("b,a", string.Join(",", list));
            RecentSet.Set(list, "c", true, 3);
            RecentSet.Set(list, "d", true, 3);
            Assert.Eq("a,c,d", string.Join(",", list));
            RecentSet.Set(list, "c", false, 3);
            Assert.Eq("a,d", string.Join(",", list));
            RecentSet.Set(null, "x", true);
            RecentSet.Set(list, null, true);
            Assert.Eq(2, list.Count);
        }
    }

    public static class JobProgressTests
    {
        [Test]
        public static void FractionAndPercent()
        {
            Assert.Near(0.5, JobProgress.Fraction(5, 10), 1e-9);
            Assert.Near(0, JobProgress.Fraction(5, 0), 1e-9);
            Assert.Near(1, JobProgress.Fraction(12, 10), 1e-9);
            Assert.Near(0, JobProgress.Fraction(double.NaN, 10), 1e-9);
            Assert.Eq(33, JobProgress.Percent(1.0 / 3));
            Assert.Eq(100, JobProgress.Percent(1));
            Assert.Eq(0, JobProgress.Percent(-0.2));
            Assert.Eq(99, JobProgress.Percent(0.999));
        }

        [Test]
        public static void RemainingNeedsEnoughData()
        {
            Assert.True(JobProgress.Remaining(1000, 0.5) == null, "1 сек-ээс бага бол таамаглахгүй");
            Assert.True(JobProgress.Remaining(10000, 0.01) == null, "1%-д таамаглахгүй");
            Assert.True(JobProgress.Remaining(10000, 1) == null);
            TimeSpan? r = JobProgress.Remaining(10000, 0.25);
            Assert.NotNull(r);
            Assert.Near(30000, r.Value.TotalMilliseconds, 1);
        }

        [Test]
        public static void DurationText()
        {
            Assert.Eq("0 сек", JobProgress.Duration(TimeSpan.Zero));
            Assert.Eq("45 сек", JobProgress.Duration(TimeSpan.FromSeconds(45)));
            Assert.Eq("3:05", JobProgress.Duration(TimeSpan.FromSeconds(185)));
            Assert.Eq("1:02:07", JobProgress.Duration(TimeSpan.FromSeconds(3727)));
        }

        [Test]
        public static void UnitsPerTarget()
        {
            Assert.Eq(2, JobProgress.UnitsPerTarget(0, 0, 0));
            Assert.Eq(2 + 4 + 5 + 1, JobProgress.UnitsPerTarget(4, 5, 1));
            Assert.Eq(2, JobProgress.UnitsPerTarget(-1, -3, -2));
        }
    }

    public static class JobNamesTests
    {
        [Test]
        public static void StepNamesAreOursAndCarryPosition()
        {
            string n = JobNames.Step(3, 8, "B4", "харагдац " + JobNames.Quote("Зүсэлт 1-1"));
            Assert.Eq("MGL клон 3/8 · B4 · харагдац «Зүсэлт 1-1»", n);
            Assert.True(JobNames.IsOurs(n));
            // Ажлын дугаартай — ижил загварыг дахин клонлох хоёр ажлын нэр давхцахгүй.
            string n2 = JobNames.Step(3, 8, "B4", "харагдац " + JobNames.Quote("Зүсэлт 1-1"), 2);
            Assert.Eq("MGL клон #2 · 3/8 · B4 · харагдац «Зүсэлт 1-1»", n2);
            Assert.True(JobNames.IsOurs(n2));
            Assert.True(n2 != JobNames.Step(3, 8, "B4", "харагдац " + JobNames.Quote("Зүсэлт 1-1"), 3));
            Assert.True(JobNames.IsOurs(JobNames.Job("загварын холбоо")));
            Assert.False(JobNames.IsOurs("Wall"));
            Assert.False(JobNames.IsOurs(null));
        }

        [Test]
        public static void LongNamesAreClipped()
        {
            string longName = new string('x', 300);
            Assert.True(JobNames.Step(1, 1, "B1", longName).Length <= 120);
            Assert.Eq("«" + new string('x', 39) + "…»", JobNames.Quote(new string('x', 80)));
            Assert.Eq("«?»", JobNames.Quote(null));
        }
    }
}
