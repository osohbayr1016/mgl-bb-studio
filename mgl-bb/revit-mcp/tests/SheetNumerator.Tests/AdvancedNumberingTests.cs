using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.SheetNumerator.Core;

namespace RevitMcpAddin.SheetNumerator.Tests
{
    /// <summary>Нарийвчилсан дугаарлалт: 3 хэсэг, тусгаарлагч, өсөх/буурах/тогтмол, хязгаар + wrap (odometer).</summary>
    public static class AdvancedNumberingTests
    {
        private static RenumberSettings Adv(Action<AdvancedNumberingSettings> configure)
        {
            var s = new RenumberSettings { Mode = NumberingMode.Advanced };
            configure(s.Advanced);
            return s;
        }

        private static string[] Run(RenumberSettings s, int count)
        {
            var sheets = new List<SheetSnapshot>();
            for (int i = 0; i < count; i++)
                sheets.Add(Fx.Sheet(i + 1, "x" + (i + 1)));
            return Fx.Numbers(Fx.Plan(sheets, s));
        }

        [Test]
        public static void SinglePart_PrefixIncrementWidth()
        {
            RenumberSettings s = Adv(a =>
            {
                a.Parts[0].Enabled = true;
                a.Parts[0].Prefix = "A";
                a.Parts[0].Width = 2;
            });
            Assert.SeqEq(new[] { "A01", "A02", "A03" }, Run(s, 3));
        }

        [Test]
        public static void TwoParts_FixedThenIncrement_WithSeparator()
        {
            RenumberSettings s = Adv(a =>
            {
                a.Parts[0].Enabled = true;
                a.Parts[0].ValueMode = PartValueMode.Fixed;
                a.Parts[0].Start = 7;
                a.Parts[1].Enabled = true;
                a.Parts[1].Width = 2;
                a.Separators[0] = ".";
            });
            Assert.SeqEq(new[] { "7.01", "7.02" }, Run(s, 2));
        }

        [Test]
        public static void ThreeParts_PrefixSuffixAndSeparators()
        {
            RenumberSettings s = Adv(a =>
            {
                a.Parts[0].Enabled = true; a.Parts[0].ValueMode = PartValueMode.None; a.Parts[0].Prefix = "AR";
                a.Parts[1].Enabled = true; a.Parts[1].Prefix = "L"; a.Parts[1].ValueMode = PartValueMode.Fixed; a.Parts[1].Start = 2;
                a.Parts[2].Enabled = true; a.Parts[2].Width = 3; a.Parts[2].Suffix = "x";
                a.Separators[0] = "-"; a.Separators[1] = "/";
            });
            Assert.SeqEq(new[] { "AR-L2/001x", "AR-L2/002x" }, Run(s, 2));
        }

        [Test]
        public static void Decrement_CountsDown()
        {
            RenumberSettings s = Adv(a =>
            {
                a.Parts[0].Enabled = true;
                a.Parts[0].ValueMode = PartValueMode.Decrement;
                a.Parts[0].Start = 5;
            });
            Assert.SeqEq(new[] { "5", "4", "3" }, Run(s, 3));
        }

        [Test]
        public static void Step_AndZeroCrossing()
        {
            RenumberSettings s = Adv(a =>
            {
                a.Parts[0].Enabled = true;
                a.Parts[0].ValueMode = PartValueMode.Decrement;
                a.Parts[0].Start = 5;
                a.Parts[0].Step = 5;
                a.Parts[0].Width = 2;
            });
            Assert.SeqEq(new[] { "05", "00", "-05" }, Run(s, 3));
        }

        [Test]
        public static void Odometer_WrapAtLimit_CarriesIntoPreviousPart()
        {
            RenumberSettings s = Adv(a =>
            {
                a.Parts[0].Enabled = true;                                  // 1, 2, 3 …
                a.Parts[1].Enabled = true;
                a.Parts[1].Limit = 3;
                a.Parts[1].WrapAtLimit = true;
            });
            Assert.SeqEq(new[] { "1-1", "1-2", "1-3", "2-1", "2-2", "2-3", "3-1" }, Run(s, 7));
        }

        [Test]
        public static void Odometer_ThreeLevels()
        {
            RenumberSettings s = Adv(a =>
            {
                a.Parts[0].Enabled = true;
                a.Parts[1].Enabled = true; a.Parts[1].Limit = 2; a.Parts[1].WrapAtLimit = true;
                a.Parts[2].Enabled = true; a.Parts[2].Limit = 2; a.Parts[2].WrapAtLimit = true;
                a.Separators[0] = "."; a.Separators[1] = ".";
            });
            Assert.SeqEq(new[] { "1.1.1", "1.1.2", "1.2.1", "1.2.2", "2.1.1" }, Run(s, 5));
        }

        [Test]
        public static void Odometer_DecrementWrapsToStart()
        {
            RenumberSettings s = Adv(a =>
            {
                a.Parts[0].Enabled = true;
                a.Parts[1].Enabled = true;
                a.Parts[1].ValueMode = PartValueMode.Decrement;
                a.Parts[1].Start = 3;
                a.Parts[1].Limit = 1;
                a.Parts[1].WrapAtLimit = true;
            });
            Assert.SeqEq(new[] { "1-3", "1-2", "1-1", "2-3" }, Run(s, 4));
        }

        [Test]
        public static void Limit_WithoutWrap_FlagsRowsBeyondTheLimit()
        {
            RenumberSettings s = Adv(a =>
            {
                a.Parts[0].Enabled = true;
                a.Parts[0].Limit = 2;
                a.Parts[0].WrapAtLimit = false;
            });
            var sheets = new List<SheetSnapshot> { Fx.Sheet(1, "x1"), Fx.Sheet(2, "x2"), Fx.Sheet(3, "x3"), Fx.Sheet(4, "x4") };
            RenumberPlan p = Fx.Plan(sheets, s);
            Assert.Eq("1", p.Rows[0].NewNumber);
            Assert.Eq("2", p.Rows[1].NewNumber);
            Assert.True(p.Rows[2].Issues.Any(i => i.Code == IssueCode.PartLimitExceeded));
            Assert.True(p.Rows[3].Issues.Any(i => i.Code == IssueCode.PartLimitExceeded), "хязгаараас хойшхи бүх мөр");
            Assert.Eq("x3", p.Rows[2].NewNumber, "утгыг чимээгүй таслахгүй");
            Assert.True(p.HasBlockingErrors);
        }

        [Test]
        public static void DisabledMiddlePart_DoesNotDoubleTheSeparator()
        {
            RenumberSettings s = Adv(a =>
            {
                a.Parts[0].Enabled = true; a.Parts[0].Prefix = "A";
                a.Parts[1].Enabled = false;
                a.Parts[2].Enabled = true; a.Parts[2].Prefix = "Z";
                a.Separators[0] = "-"; a.Separators[1] = "/";
            });
            Assert.SeqEq(new[] { "A1-Z1" }, Run(s, 1), "1→3 нь Separators[0]-ыг ашиглана");
        }

        [Test]
        public static void EnabledButEmptyPart_IsSkipped()
        {
            RenumberSettings s = Adv(a =>
            {
                a.Parts[0].Enabled = true;
                a.Parts[1].Enabled = true; a.Parts[1].ValueMode = PartValueMode.None;   // юу ч үүсгэхгүй
                a.Parts[2].Enabled = true; a.Parts[2].ValueMode = PartValueMode.Fixed; a.Parts[2].Start = 9;
                a.Separators[0] = "-"; a.Separators[1] = ".";
            });
            // 2-р хэсэг хоосон → алгасна; 1 ба 3-ын хооронд «-» (1-р хэсгийн тусгаарлагч) НЭГ л удаа.
            Assert.SeqEq(new[] { "1-9" }, Run(s, 1));
        }

        [Test]
        public static void CustomMultiCharSeparator_IsAllowed()
        {
            RenumberSettings s = Adv(a =>
            {
                a.Parts[0].Enabled = true;
                a.Parts[1].Enabled = true;
                a.Separators[0] = "__";   // нэгээс олон тэмдэгттэй, дурын бичвэр (өмнө нь жижиг жагсаалтаар хязгаарладаггүй)
            });
            Assert.SeqEq(new[] { "1__1" }, Run(s, 1));
        }

        [Test]
        public static void ProhibitedSeparator_IsSettingsError()
        {
            RenumberSettings s = Adv(a =>
            {
                a.Parts[0].Enabled = true;
                a.Parts[1].Enabled = true;
                a.Separators[0] = "|";
            });
            var p = Fx.Plan(Fx.Sheets("a"), s);
            Assert.True(p.GlobalIssues.Any(i => i.Field == "separator1"));
        }

        [Test]
        public static void InvalidLimit_IsSettingsError()
        {
            RenumberSettings s = Adv(a =>
            {
                a.Parts[0].Enabled = true;
                a.Parts[0].Start = 5;
                a.Parts[0].Limit = 3;   // өсөх, гэвч хязгаар эхлэхээс бага
            });
            var p = Fx.Plan(Fx.Sheets("a"), s);
            Assert.True(p.GlobalIssues.Any(i => i.Field == "part1.limit"));
        }

        [Test]
        public static void NoPartEnabled_IsSettingsError()
        {
            RenumberSettings s = Adv(a => a.Parts[0].Enabled = false);
            var p = Fx.Plan(Fx.Sheets("a"), s);
            Assert.True(p.GlobalIssues.Any(i => i.Field == "part1.enabled"));
        }

        [Test]
        public static void PartSources_FullAndNumber_PerPart()
        {
            ParameterKey target = ParameterKey.Project("Mark");
            List<SheetSnapshot> sheets = Fx.Sheets("a");
            Fx.WithParams(sheets[0], Fx.P(target, ""));
            DocumentSnapshot doc = Fx.Doc(sheets, UniquenessMode.PerSheetCollection, Fx.Param(target, "Mark", ParamValueKind.Text));

            RenumberSettings s = Adv(a =>
            {
                a.Parts[0].Enabled = true; a.Parts[0].Prefix = "AR";
                a.Parts[1].Enabled = true; a.Parts[1].Prefix = "L"; a.Parts[1].Width = 2; a.Parts[1].Start = 4;
                a.Separators[0] = "-";
            });
            s.WriteResultToParameter = true;
            s.ResultParameter = target;

            s.ResultSource = GeneratedValueSource.Part2Full;
            Assert.Eq("L04", Fx.Plan(sheets, s, doc: doc).Rows[0].Writes.Single().Text);
            s.ResultSource = GeneratedValueSource.Part2Number;
            Assert.Eq("04", Fx.Plan(sheets, s, doc: doc).Rows[0].Writes.Single().Text);
            s.ResultSource = GeneratedValueSource.Part1Full;
            Assert.Eq("AR1", Fx.Plan(sheets, s, doc: doc).Rows[0].Writes.Single().Text);
            s.ResultSource = GeneratedValueSource.FullNumber;
            Assert.Eq("AR1-L04", Fx.Plan(sheets, s, doc: doc).Rows[0].Writes.Single().Text);
        }

        [Test]
        public static void StartFromSelected_AppliesToAdvanced_TooAndCounterStartsAtSelection()
        {
            RenumberSettings s = Adv(a =>
            {
                a.Parts[0].Enabled = true;
                a.Parts[0].Prefix = "N";
            });
            s.StartFromSelected = true;
            List<SheetSnapshot> sheets = Fx.Sheets("a", "b", "c");
            RenumberPlan p = Fx.Plan(sheets, s, selected: 1);
            Assert.SeqEq(new[] { "a", "N1", "N2" }, Fx.Numbers(p));
        }
    }
}
